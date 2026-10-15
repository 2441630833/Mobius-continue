import {
  ClientFactory,
  DefaultAgentCardResolver,
  JsonRpcTransportFactory,
} from "@a2a-js/sdk/client";
import { Message, SendMessageRequest, Task, TaskState } from "@a2a-js/sdk";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { AGENT_LIMITS } from "./orchestrator";

export interface RemoteAgent {
  id: string;
  description: string;
  cardUrl: string;
  tokenEnv?: string;
  allowDelegation?: boolean;
}

export interface RemoteAgentReply {
  content: string;
  contextId: string;
  taskId?: string;
}

/** User-owned config, never taken from model output or a workspace file. */
export async function loadRemoteAgents(): Promise<RemoteAgent[]> {
  let raw: string;
  try {
    raw = await readFile(
      join(homedir(), ".continue", "a2a-agents.json"),
      "utf8",
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const agents: unknown = JSON.parse(raw).agents;
  if (!Array.isArray(agents) || agents.length > 20) {
    throw new Error("a2a-agents.json requires an agents array (maximum 20)");
  }
  const seen = new Set<string>();
  for (const agent of agents) {
    if (
      !agent ||
      typeof agent.id !== "string" ||
      !/^[a-zA-Z0-9_-]{1,64}$/.test(agent.id) ||
      seen.has(agent.id) ||
      typeof agent.description !== "string" ||
      typeof agent.cardUrl !== "string" ||
      (agent.tokenEnv !== undefined && typeof agent.tokenEnv !== "string")
    ) {
      throw new Error("Invalid or duplicate configured A2A agent");
    }
    validateAgentUrl(agent.cardUrl);
    seen.add(agent.id);
  }
  return agents;
}

function validateAgentUrl(value: string): URL {
  const url = new URL(value);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.hash ||
    (url.protocol !== "https:" && !(loopback && url.protocol === "http:"))
  ) {
    throw new Error(
      "A2A URLs require HTTPS (HTTP allowed only on loopback), without URL credentials or fragments",
    );
  }
  return url;
}

function messageText(message?: Message): string {
  return (
    message?.parts
      .map((part) => (part.content?.$case === "text" ? part.content.value : ""))
      .filter(Boolean)
      .join("\n") ?? ""
  );
}

/** Official A2A 1.0 SDK; restrict both discovery and advertised transport to the configured origin. */
export async function callRemoteAgent(
  agent: RemoteAgent,
  prompt: string,
  contextId: string | undefined,
  signal: AbortSignal,
  runId?: string,
): Promise<RemoteAgentReply> {
  signal.throwIfAborted();
  const origin = validateAgentUrl(agent.cardUrl).origin;
  const token = agent.tokenEnv ? process.env[agent.tokenEnv] : undefined;
  if (agent.tokenEnv && !token) {
    throw new Error(
      `Missing A2A credential environment variable: ${agent.tokenEnv}`,
    );
  }
  const guardedFetch: typeof fetch = async (input, init) => {
    const url = validateAgentUrl(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    if (url.origin !== origin) {
      throw new Error("A2A card attempted to use an unconfigured origin");
    }
    const headers = new Headers(init?.headers);
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
    return fetch(input, {
      ...init,
      headers,
      redirect: "error",
      signal: init?.signal ?? signal,
    });
  };
  const factory = new ClientFactory({
    transports: [new JsonRpcTransportFactory({ fetchImpl: guardedFetch })],
    cardResolver: new DefaultAgentCardResolver({ fetchImpl: guardedFetch }),
  });
  const client = await factory.createFromUrl(agent.cardUrl, "");
  const result = await client.sendMessage(
    SendMessageRequest.fromJSON({
      message: {
        messageId: randomUUID(),
        contextId,
        role: "ROLE_USER",
        parts: [{ text: prompt.slice(0, AGENT_LIMITS.contextChars) }],
      },
      metadata: runId ? { mobiusRunId: runId } : undefined,
    }),
    { signal },
  );
  if ("parts" in result) {
    const content = messageText(result).slice(0, AGENT_LIMITS.resultChars);
    if (!content.trim()) {
      throw new Error("A2A message returned no text");
    }
    return { content, contextId: result.contextId };
  }
  let task: Task = result;
  try {
    while (
      [TaskState.TASK_STATE_SUBMITTED, TaskState.TASK_STATE_WORKING].includes(
        task.status?.state ?? TaskState.TASK_STATE_UNSPECIFIED,
      )
    ) {
      await delay(500, undefined, { signal });
      task = await client.getTask(
        { id: task.id, historyLength: 0, tenant: "" },
        { signal },
      );
    }
    const text =
      task.artifacts
        .flatMap((artifact) =>
          artifact.parts.map((part) =>
            part.content?.$case === "text" ? part.content.value : "",
          ),
        )
        .filter(Boolean)
        .join("\n") || messageText(task.status?.message);
    if (task.status?.state !== TaskState.TASK_STATE_COMPLETED) {
      throw new Error(
        `A2A task ${task.id} ended in ${TaskState[task.status?.state ?? 0]}: ${text.slice(0, 1000)}`,
      );
    }
    if (!text.trim()) {
      throw new Error(`A2A task ${task.id} completed without text artifacts`);
    }
    return {
      content: text.slice(0, AGENT_LIMITS.resultChars),
      contextId: task.contextId,
      taskId: task.id,
    };
  } finally {
    if (signal.aborted) {
      // Cancellation is best-effort at the remote endpoint, with its own short deadline.
      try {
        await client.cancelTask(
          { id: task.id, tenant: "", metadata: undefined },
          { signal: AbortSignal.timeout(2000) },
        );
      } catch {
        /* remote may already be terminal */
      }
    }
  }
}
