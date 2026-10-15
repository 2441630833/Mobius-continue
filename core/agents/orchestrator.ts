import { Annotation, END, Send, START, StateGraph } from "@langchain/langgraph";
import { randomUUID } from "node:crypto";

export const AGENT_LIMITS = Object.freeze({
  workers: 4,
  concurrency: 3,
  steps: 5,
  contextChars: 8000,
  taskChars: 2000,
  resultChars: 6000,
  timeoutMs: 120_000,
});

export interface AgentTask {
  id: string;
  prompt: string;
  agentId?: string;
}
export interface AgentArtifact {
  taskId: string;
  agentId: string;
  status: "completed" | "failed";
  content: string;
}
export interface AgentRun {
  contextId: string;
  tasks: AgentTask[];
  artifacts: AgentArtifact[];
}
export interface OrchestratorHost {
  plan(request: string, context: string, signal: AbortSignal): Promise<string>;
  work(
    task: AgentTask,
    context: string,
    contextId: string,
    signal: AbortSignal,
  ): Promise<string>;
  progress?(message: string): void;
}

export function parseAgentPlan(text: string): AgentTask[] {
  const parsed: unknown = JSON.parse(
    text
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, ""),
  );
  const tasks = (parsed as { tasks?: unknown })?.tasks;
  if (
    !Array.isArray(tasks) ||
    tasks.length < 1 ||
    tasks.length > AGENT_LIMITS.workers
  ) {
    throw new Error(`Supervisor must return 1-${AGENT_LIMITS.workers} tasks`);
  }
  return tasks.map((task, i) => {
    if (
      !task ||
      typeof task.prompt !== "string" ||
      !task.prompt.trim() ||
      task.prompt.length > AGENT_LIMITS.taskChars
    ) {
      throw new Error(`Invalid supervisor task ${i + 1}`);
    }
    if (task.agentId !== undefined && typeof task.agentId !== "string") {
      throw new Error(`Invalid agentId for task ${i + 1}`);
    }
    return { id: `task-${i + 1}`, prompt: task.prompt, agentId: task.agentId };
  });
}

/** Bounds waits even when a provider ignores AbortSignal. No new steps start after abort. */
export async function abortable<T>(
  operation: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) {
    void operation.catch(() => {});
    signal.throwIfAborted();
  }
  let listener: () => void = () => {};
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        listener = () =>
          reject(signal.reason ?? new Error("Agent run canceled"));
        signal.addEventListener("abort", listener, { once: true });
      }),
    ]);
  } finally {
    signal.removeEventListener("abort", listener);
  }
}

/** Request-local graph: supervisor -> dynamically fanned-out workers -> reducer barrier. */
export async function orchestrateAgents(
  request: string,
  sharedContext: string,
  host: OrchestratorHost,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<AgentRun> {
  if (!request.trim() || request.length > AGENT_LIMITS.contextChars) {
    throw new Error(
      `Request must contain 1-${AGENT_LIMITS.contextChars} characters`,
    );
  }
  const signal = AbortSignal.any([
    options.signal ?? new AbortController().signal,
    AbortSignal.timeout(
      Math.min(
        options.timeoutMs ?? AGENT_LIMITS.timeoutMs,
        AGENT_LIMITS.timeoutMs,
      ),
    ),
  ]);
  signal.throwIfAborted();
  const context = sharedContext.slice(0, AGENT_LIMITS.contextChars);
  const contextId = randomUUID();
  const State = Annotation.Root({
    tasks: Annotation<AgentTask[]>(),
    artifacts: Annotation<AgentArtifact[]>({
      reducer: (a, b) => a.concat(b),
      default: () => [],
    }),
    task: Annotation<AgentTask>(),
  });
  // LangGraph's runnable concurrency alone does not bound dynamic Send nodes.
  let active = 0;
  const waiting: Array<() => void> = [];
  const graph = new StateGraph(State)
    .addNode("supervisor", async () => {
      signal.throwIfAborted();
      host.progress?.("Planning parallel research");
      const tasks = parseAgentPlan(
        await abortable(host.plan(request, context, signal), signal),
      );
      return { tasks };
    })
    .addNode("worker", async (state) => {
      if (active >= AGENT_LIMITS.concurrency) {
        await abortable(
          new Promise<void>((resolve) => waiting.push(resolve)),
          signal,
        );
      }
      signal.throwIfAborted();
      active++;
      const task = state.task;
      try {
        host.progress?.(`Researching ${task.id}`);
        const content = await abortable(
          host.work(task, context, contextId, signal),
          signal,
        );
        if (!content.trim()) {
          throw new Error("Worker returned no findings");
        }
        return {
          artifacts: [
            {
              taskId: task.id,
              agentId: task.agentId ?? "local",
              status: "completed" as const,
              content: content.slice(0, AGENT_LIMITS.resultChars),
            },
          ],
        };
      } catch (error) {
        signal.throwIfAborted();
        return {
          artifacts: [
            {
              taskId: task.id,
              agentId: task.agentId ?? "local",
              status: "failed" as const,
              content: String(error).slice(0, 1000),
            },
          ],
        };
      } finally {
        active--;
        waiting.shift()?.();
      }
    })
    .addEdge(START, "supervisor")
    .addConditionalEdges(
      "supervisor",
      (state) => state.tasks.map((task) => new Send("worker", { task })),
      ["worker"],
    )
    .addEdge("worker", END)
    .compile();
  const result = await abortable(
    graph.invoke({}, { signal, recursionLimit: 8 }),
    signal,
  );
  host.progress?.("Parallel research finished");
  return {
    contextId,
    tasks: result.tasks,
    artifacts: result.artifacts.sort((a, b) =>
      a.taskId.localeCompare(b.taskId),
    ),
  };
}
