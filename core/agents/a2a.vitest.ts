import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { callRemoteAgent } from "./a2a";

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

async function fixture(
  handler: (body: any, req: IncomingMessage, res: ServerResponse) => void,
  endpoint?: string,
) {
  let base = "";
  const server = createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.method === "GET") {
      res.end(
        JSON.stringify({
          name: "Fixture",
          description: "test",
          version: "1",
          capabilities: {},
          defaultInputModes: ["text/plain"],
          defaultOutputModes: ["text/plain"],
          skills: [],
          supportedInterfaces: [
            {
              url: endpoint ?? `${base}/rpc`,
              protocolBinding: "JSONRPC",
              protocolVersion: "1.0",
            },
          ],
        }),
      );
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    handler(JSON.parse(Buffer.concat(chunks).toString()), req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  closers.push(
    () =>
      new Promise<void>((resolve) => {
        (
          server as typeof server & { closeAllConnections?: () => void }
        ).closeAllConnections?.();
        server.close(() => resolve());
      }),
  );
  return {
    id: "fixture",
    description: "fixture",
    cardUrl: `${base}/.well-known/agent-card.json`,
  };
}

describe("official A2A SDK transport", () => {
  it("lets the remote assign the first context ID and uses metadata for local correlation", async () => {
    const agent = await fixture((body, _req, res) => {
      expect(body.params.message.contextId).toBeUndefined();
      expect(body.params.metadata).toEqual({ mobiusRunId: "local-run" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            message: {
              role: "ROLE_AGENT",
              messageId: "response",
              contextId: "remote-context",
              parts: [{ text: "findings" }],
            },
          },
        }),
      );
    });
    const reply = await callRemoteAgent(
      agent,
      "research",
      undefined,
      AbortSignal.timeout(3000),
      "local-run",
    );
    expect(reply.contextId).toBe("remote-context");
  });

  it("attempts remote task cancellation with a fresh deadline after local cancellation", async () => {
    const controller = new AbortController();
    let canceled = false;
    const agent = await fixture((body, _req, res) => {
      if (body.method === "CancelTask") {
        canceled = true;
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: { id: "pending", status: { state: "TASK_STATE_CANCELED" } },
          }),
        );
        return;
      }
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            task: { id: "pending", status: { state: "TASK_STATE_WORKING" } },
          },
        }),
      );
      setTimeout(() => controller.abort(), 20);
    });
    await expect(
      callRemoteAgent(agent, "research", undefined, controller.signal),
    ).rejects.toThrow();
    expect(canceled).toBe(true);
  });

  it("discovers an agent and sends A2A 1.0 text with the explicit context only", async () => {
    const agent = await fixture((body, req, res) => {
      expect(body.method).toBe("SendMessage");
      expect(body.params.message.contextId).toBe("context-123");
      expect(body.params.message.parts).toEqual([{ text: "research task" }]);
      expect(req.headers.authorization).toBeUndefined();
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            message: {
              role: "ROLE_AGENT",
              messageId: "response-1",
              parts: [{ text: "verified evidence" }],
            },
          },
        }),
      );
    });
    expect(
      (
        await callRemoteAgent(
          agent,
          "research task",
          "context-123",
          AbortSignal.timeout(3000),
        )
      ).content,
    ).toBe("verified evidence");
  });

  it("polls submitted tasks and returns final artifacts", async () => {
    let requests = 0;
    const agent = await fixture((body, _req, res) => {
      requests++;
      const task = {
        id: "task-1",
        contextId: "context-123",
        status: {
          state: requests === 1 ? "TASK_STATE_WORKING" : "TASK_STATE_COMPLETED",
        },
        artifacts:
          requests === 1
            ? []
            : [{ artifactId: "report", parts: [{ text: "final report" }] }],
      };
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: requests === 1 ? { task } : task,
        }),
      );
    });
    expect(
      (
        await callRemoteAgent(
          agent,
          "research",
          "context-123",
          AbortSignal.timeout(3000),
        )
      ).content,
    ).toBe("final report");
    expect(requests).toBe(2);
  });

  it("does not call input-required a completed task", async () => {
    const agent = await fixture((body, _req, res) =>
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            task: {
              id: "needs-input",
              status: {
                state: "TASK_STATE_INPUT_REQUIRED",
                message: { parts: [{ text: "Which project?" }] },
              },
            },
          },
        }),
      ),
    );
    await expect(
      callRemoteAgent(agent, "research", "ctx", AbortSignal.timeout(3000)),
    ).rejects.toThrow("INPUT_REQUIRED");
  });

  it("rejects an advertised transport on another origin", async () => {
    const agent = await fixture(() => {
      throw new Error("must not invoke");
    }, "http://127.0.0.1:1/rpc");
    await expect(
      callRemoteAgent(agent, "research", "ctx", AbortSignal.timeout(3000)),
    ).rejects.toThrow("unconfigured origin");
  });

  it("rejects unsafe URL schemes and missing independent credentials", async () => {
    await expect(
      callRemoteAgent(
        { id: "bad", description: "", cardUrl: "http://example.com/card" },
        "x",
        "ctx",
        AbortSignal.timeout(1000),
      ),
    ).rejects.toThrow("HTTPS");
    await expect(
      callRemoteAgent(
        {
          id: "bad",
          description: "",
          cardUrl: "https://example.com/card",
          tokenEnv: "MOBIUS_TEST_MISSING_A2A_TOKEN",
        },
        "x",
        "ctx",
        AbortSignal.timeout(1000),
      ),
    ).rejects.toThrow("Missing A2A credential");
  });
});
