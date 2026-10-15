import { describe, expect, it, vi } from "vitest";
import {
  AGENT_LIMITS,
  orchestrateAgents,
  parseAgentPlan,
} from "./orchestrator";
import type { AgentTask } from "./orchestrator";

const plan = (n: number) =>
  JSON.stringify({
    tasks: Array.from({ length: n }, (_, i) => ({
      prompt: `Investigate topic ${i}`,
    })),
  });

describe("LangGraph supervisor", () => {
  it("actually overlaps workers, enforces concurrency and gathers every artifact", async () => {
    let active = 0;
    let max = 0;
    const result = await orchestrateAgents(
      "Research the design",
      "shared facts",
      {
        plan: async () => plan(4),
        work: async (task, context) => {
          expect(context).toBe("shared facts");
          max = Math.max(max, ++active);
          await new Promise((resolve) => setTimeout(resolve, 20));
          active--;
          return task.id;
        },
      },
    );
    expect(max).toBe(3);
    expect(result.tasks).toHaveLength(4);
    expect(result.artifacts.map((a) => a.taskId)).toEqual([
      "task-1",
      "task-2",
      "task-3",
      "task-4",
    ]);
  });

  it("preserves successful siblings when one worker fails", async () => {
    const result = await orchestrateAgents("research", "", {
      plan: async () => plan(2),
      work: async (task) => {
        if (task.id === "task-1") {
          throw new Error("network down");
        }
        return "evidence";
      },
    });
    expect(result.artifacts.map((a) => a.status)).toEqual([
      "failed",
      "completed",
    ]);
    expect(result.artifacts[0].content).toContain("network down");
  });

  it("bounds shared context and output and isolates request context IDs", async () => {
    const host = {
      plan: async () => plan(1),
      work: vi.fn(async (_task: AgentTask, _context: string) =>
        "x".repeat(10_000),
      ),
    };
    const [a, b] = await Promise.all([
      orchestrateAgents("one", "a".repeat(12_000), host),
      orchestrateAgents("two", "b", host),
    ]);
    expect(a.contextId).not.toBe(b.contextId);
    expect(host.work.mock.calls).toHaveLength(2);
    expect(
      host.work.mock.calls
        .map(([, context]) => context.length)
        .sort((x, y) => x - y),
    ).toEqual([1, AGENT_LIMITS.contextChars]);
    expect(a.artifacts[0].content).toHaveLength(AGENT_LIMITS.resultChars);
  });

  it("times out a supervisor even when its provider ignores cancellation", async () => {
    const work = vi.fn();
    await expect(
      orchestrateAgents(
        "research",
        "",
        {
          plan: () => new Promise(() => {}),
          work,
        },
        { timeoutMs: 20 },
      ),
    ).rejects.toThrow();
    expect(work).not.toHaveBeenCalled();
  });

  it("cancels running workers and never starts queued workers", async () => {
    const controller = new AbortController();
    let started = 0;
    const run = orchestrateAgents(
      "research",
      "",
      {
        plan: async () => plan(4),
        work: async () => {
          started++;
          if (started === 3) {
            controller.abort(new Error("user stopped"));
          }
          return new Promise<string>(() => {});
        },
      },
      { signal: controller.signal },
    );
    await expect(run).rejects.toThrow("user stopped");
    expect(started).toBe(3);
  });

  it("rejects empty findings instead of reporting false success", async () => {
    const result = await orchestrateAgents("research", "", {
      plan: async () => plan(1),
      work: async () => " ",
    });
    expect(result.artifacts[0].status).toBe("failed");
  });

  it("validates planner JSON and prevents unbounded fanout", () => {
    expect(parseAgentPlan(`\`\`\`json\n${plan(2)}\n\`\`\``)).toHaveLength(2);
    for (const invalid of [
      "not json",
      plan(0),
      plan(5),
      '{"tasks":[{"prompt":""}]}',
      JSON.stringify({ tasks: [{ prompt: "x".repeat(2001) }] }),
    ]) {
      expect(() => parseAgentPlan(invalid)).toThrow();
    }
  });
});
