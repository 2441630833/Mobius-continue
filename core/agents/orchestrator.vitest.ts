import { describe, expect, it, vi } from "vitest";
import {
  AGENT_LIMITS,
  formatAgentContributionReport,
  orchestrateAgents,
  parseAgentAssessment,
  parseAgentPlan,
  resolveMaxAgents,
} from "./orchestrator";
import type { AgentTask, OrchestratorHost } from "./orchestrator";

const assessment = (n = 10) =>
  JSON.stringify({
    difficulty: "very_complex",
    workerCount: n,
    reason: "Independent specialist work",
  });
const plan = (n: number) =>
  JSON.stringify({
    tasks: Array.from({ length: n }, (_, i) => ({
      role: "specialist-" + (i + 1),
      title: "Topic " + (i + 1),
      prompt: "Investigate topic " + (i + 1),
    })),
  });
function host(overrides: Partial<OrchestratorHost> = {}): OrchestratorHost {
  return {
    assess: async () => assessment(),
    plan: async () => plan(1),
    work: async (task) => "Evidence for " + task.id,
    summarizeTask: async (task, artifact) =>
      task.role + ": " + artifact.status + ": " + artifact.content,
    summarizeRun: async (_request, _assessment, contributions) =>
      contributions.map((c) => c.taskId + ": " + c.summary).join("\n"),
    ...overrides,
  };
}

describe("adaptive LangGraph professional team", () => {
  it.each([5, 10])(
    "actually overlaps %i specialists within the configured ceiling",
    async (maximum) => {
      let active = 0;
      let peak = 0;
      const result = await orchestrateAgents(
        "Research the design",
        "shared facts",
        host({
          plan: async (_request, _context, _signal, assessed) => {
            expect(assessed.workerCount).toBe(maximum);
            return plan(maximum);
          },
          work: async (task, context) => {
            expect(context).toBe("shared facts");
            peak = Math.max(peak, ++active);
            await new Promise((resolve) => setTimeout(resolve, 30));
            active--;
            return task.id;
          },
        }),
        { maxAgents: maximum },
      );
      expect(peak).toBe(maximum);
      expect(result.concurrency).toBe(maximum);
      expect(result.artifacts).toHaveLength(maximum);
      expect(result.artifacts.map((a) => a.taskId)).toEqual(
        Array.from({ length: maximum }, (_, i) => "task-" + (i + 1)),
      );
    },
  );

  it("assesses first, preserves specialized roles, summarizes each execution, then synthesizes exactly once", async () => {
    const events: string[] = [];
    const result = await orchestrateAgents(
      "Research",
      "",
      host({
        assess: async () => {
          events.push("assess");
          return assessment(3);
        },
        plan: async () => {
          events.push("plan");
          return plan(3);
        },
        work: async (task) => {
          events.push("work:" + task.id);
          return task.role;
        },
        summarizeTask: async (task, artifact) => {
          expect(artifact.taskId).toBe(task.id);
          expect(artifact.content).toBe(task.role);
          events.push("summary:" + task.id);
          return task.role + " contribution";
        },
        summarizeRun: async (_request, _assessment, contributions) => {
          expect(contributions).toHaveLength(3);
          expect(events.filter((e) => e.startsWith("summary:"))).toHaveLength(
            3,
          );
          events.push("final");
          return "All specialist findings reviewed";
        },
      }),
    );
    expect(events.slice(0, 2)).toEqual(["assess", "plan"]);
    expect(events.filter((e) => e === "final")).toHaveLength(1);
    expect(events.at(-1)).toBe("final");
    for (const c of result.contributions) {
      expect(events.indexOf("summary:" + c.taskId)).toBeGreaterThan(
        events.indexOf("work:" + c.taskId),
      );
      expect(c.role).toMatch(/^specialist-/);
    }
    expect(result.taskCompleted).toBe(false);
    expect(result.phase).toBe("research");
    expect(result.overallStatus).toBe("completed");
  });

  it("uses fewer agents for simple work rather than padding to five", async () => {
    const result = await orchestrateAgents(
      "One question",
      "",
      host({
        assess: async () =>
          JSON.stringify({
            difficulty: "simple",
            workerCount: 1,
            reason: "One independent question",
          }),
      }),
      { maxAgents: 10 },
    );
    expect(result.tasks).toHaveLength(1);
    expect(result.concurrency).toBe(1);
  });

  it("rejects a planner that exceeds the assessed budget before executing anything", async () => {
    const work = vi.fn();
    await expect(
      orchestrateAgents(
        "Research",
        "",
        host({
          assess: async () => assessment(2),
          plan: async () => plan(3),
          work,
        }),
      ),
    ).rejects.toThrow("1-2 tasks");
    expect(work).not.toHaveBeenCalled();
  });

  it("preserves worker failures even if summaries claim success", async () => {
    const result = await orchestrateAgents(
      "Research",
      "",
      host({
        plan: async () => plan(2),
        work: async (task) => {
          if (task.id === "task-1") {
            throw new Error("network down");
          }
          return "evidence";
        },
        summarizeTask: async () => "Everything completed",
        summarizeRun: async () => "Everything completed",
      }),
    );
    expect(result.artifacts.map((a) => a.status)).toEqual([
      "failed",
      "completed",
    ]);
    expect(result.overallStatus).toBe("partial");
    expect(result.contributions[0].executionStatus).toBe("failed");
    expect(formatAgentContributionReport(result)).toContain("执行失败");
    expect(result.taskCompleted).toBe(false);
  });

  it("retains evidence if an individual summarizer or final summarizer fails", async () => {
    const result = await orchestrateAgents(
      "Research",
      "",
      host({
        summarizeTask: async () => {
          throw new Error("summary model down");
        },
        summarizeRun: async () => {
          throw new Error("final model down");
        },
      }),
    );
    expect(result.artifacts[0].status).toBe("completed");
    expect(result.summaries[0].status).toBe("failed");
    expect(result.summaries[0].content).toContain("Evidence");
    expect(result.finalSummaryStatus).toBe("failed");
    expect(result.overallStatus).toBe("partial");
  });

  it("keeps failed overall execution failed even when every summarizer succeeds", async () => {
    const result = await orchestrateAgents(
      "Research",
      "",
      host({
        work: async () => {
          throw new Error("failed");
        },
      }),
    );
    expect(result.overallStatus).toBe("failed");
  });

  it("bounds shared context, evidence and summaries and isolates requests", async () => {
    const work = vi.fn(async (_task: AgentTask, _context: string) =>
      "x".repeat(10_000),
    );
    const team = host({ work, summarizeTask: async () => "s".repeat(3000) });
    const [a, b] = await Promise.all([
      orchestrateAgents("one", "a".repeat(12_000), team),
      orchestrateAgents("two", "b", team),
    ]);
    expect(a.contextId).not.toBe(b.contextId);
    expect(
      work.mock.calls
        .map(([, context]) => context.length)
        .sort((x, y) => x - y),
    ).toEqual([1, AGENT_LIMITS.contextChars]);
    expect(a.artifacts[0].content).toHaveLength(AGENT_LIMITS.resultChars);
    expect(a.summaries[0].content).toHaveLength(AGENT_LIMITS.summaryChars);
  });

  it("times out a stuck assessor without planning or starting workers", async () => {
    const planner = vi.fn();
    const work = vi.fn();
    await expect(
      orchestrateAgents(
        "research",
        "",
        host({ assess: () => new Promise(() => {}), plan: planner, work }),
        { timeoutMs: 20 },
      ),
    ).rejects.toThrow();
    expect(planner).not.toHaveBeenCalled();
    expect(work).not.toHaveBeenCalled();
  });

  it("cancels running specialists without starting summaries or adopting late results", async () => {
    const controller = new AbortController();
    let started = 0;
    const summarizeTask = vi.fn();
    const summarizeRun = vi.fn();
    const run = orchestrateAgents(
      "research",
      "",
      host({
        plan: async () => plan(10),
        work: async () => {
          if (++started === 3) {
            controller.abort(new Error("user stopped"));
          }
          return new Promise<string>(() => {});
        },
        summarizeTask,
        summarizeRun,
      }),
      { signal: controller.signal },
    );
    await expect(run).rejects.toThrow("user stopped");
    expect(started).toBe(3);
    expect(summarizeTask).not.toHaveBeenCalled();
    expect(summarizeRun).not.toHaveBeenCalled();
  });

  it("times out an individual summary and does not start final synthesis", async () => {
    const summarizeRun = vi.fn();
    await expect(
      orchestrateAgents(
        "Research",
        "",
        host({ summarizeTask: () => new Promise(() => {}), summarizeRun }),
        { timeoutMs: 40 },
      ),
    ).rejects.toThrow();
    expect(summarizeRun).not.toHaveBeenCalled();
  });

  it("rejects empty findings instead of reporting false success", async () => {
    const result = await orchestrateAgents(
      "Research",
      "",
      host({ work: async () => " " }),
    );
    expect(result.artifacts[0].status).toBe("failed");
  });

  it("validates difficulty, professional plans and the configurable ceiling", () => {
    expect(parseAgentPlan(plan(10))).toHaveLength(10);
    expect(parseAgentAssessment(assessment(10), 5).workerCount).toBe(5);
    for (const invalid of [
      "not json",
      plan(0),
      plan(11),
      '{"tasks":[{"prompt":"question"}]}',
    ]) {
      expect(() => parseAgentPlan(invalid)).toThrow();
    }
    for (const invalid of [
      "null",
      '{"difficulty":"simple","workerCount":10,"reason":"bad"}',
      '{"difficulty":"unknown","workerCount":1,"reason":"bad"}',
    ]) {
      expect(() => parseAgentAssessment(invalid, 10)).toThrow();
    }
    for (const invalid of [4, 11, 5.5, "10", NaN]) {
      expect(() => resolveMaxAgents(invalid)).toThrow();
    }
    expect(resolveMaxAgents()).toBe(10);
  });
});
