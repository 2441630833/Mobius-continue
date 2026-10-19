import { Annotation, END, Send, START, StateGraph } from "@langchain/langgraph";
import { randomUUID } from "node:crypto";

export const AGENT_LIMITS = Object.freeze({
  workers: 10,
  concurrency: 10,
  steps: 5,
  contextChars: 8000,
  taskChars: 2000,
  resultChars: 6000,
  summaryChars: 1200,
  timeoutMs: 300_000,
});

export interface AgentAssessment {
  difficulty: "simple" | "moderate" | "complex" | "very_complex";
  workerCount: number;
  reason: string;
}

export interface AgentTask {
  id: string;
  prompt: string;
  role: string;
  title: string;
  agentId?: string;
}
export interface AgentArtifact {
  taskId: string;
  agentId: string;
  status: "completed" | "failed";
  content: string;
}
export interface AgentTaskSummary {
  taskId: string;
  status: "completed" | "failed";
  content: string;
}
export interface AgentContribution {
  taskId: string;
  role: string;
  title: string;
  agentId: string;
  executionStatus: AgentArtifact["status"];
  summaryStatus: AgentTaskSummary["status"];
  summary: string;
}
export interface AgentRun {
  contextId: string;
  phase: "research";
  taskCompleted: false;
  assessment: AgentAssessment;
  concurrency: number;
  tasks: AgentTask[];
  artifacts: AgentArtifact[];
  summaries: AgentTaskSummary[];
  contributions: AgentContribution[];
  finalSummary: string;
  finalSummaryStatus: "completed" | "failed";
  overallStatus: "completed" | "partial" | "failed";
}
export interface OrchestratorHost {
  assess(
    request: string,
    context: string,
    signal: AbortSignal,
  ): Promise<string>;
  plan(
    request: string,
    context: string,
    signal: AbortSignal,
    assessment: AgentAssessment,
  ): Promise<string>;
  work(
    task: AgentTask,
    context: string,
    contextId: string,
    signal: AbortSignal,
  ): Promise<string>;
  summarizeTask(
    task: AgentTask,
    artifact: AgentArtifact,
    signal: AbortSignal,
  ): Promise<string>;
  summarizeRun(
    request: string,
    assessment: AgentAssessment,
    contributions: AgentContribution[],
    signal: AbortSignal,
  ): Promise<string>;
  progress?(message: string): void;
}

function parseJson(text: string): unknown {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  try {
    return JSON.parse(cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
  } catch {
    // Some chat providers surround structured responses with prose. Extract a
    // balanced object without changing strings or accepting an incomplete plan.
    let start = -1;
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let i = 0; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (start < 0) {
        if (ch === "{") { start = i; depth = 1; }
        continue;
      }
      if (quoted) {
        if (escaped) { escaped = false; }
        else if (ch === "\\") { escaped = true; }
        else if (ch === '"') { quoted = false; }
        continue;
      }
      if (ch === '"') { quoted = true; }
      else if (ch === "{") { depth++; }
      else if (ch === "}" && --depth === 0) {
        return JSON.parse(cleaned.slice(start, i + 1));
      }
    }
    throw new Error("Research model did not return a complete JSON object");
  }
}

export function resolveMaxAgents(
  value: unknown = AGENT_LIMITS.workers,
): number {
  // Treat missing/non-integer gracefully: use the default workers limit.
  if (value === undefined || value === null) {
    return AGENT_LIMITS.workers;
  }
  const n =
    typeof value === "string" ? parseInt(value as string, 10) : (value as number);
  if (!Number.isInteger(n) || n < 1 || n > AGENT_LIMITS.workers) {
    // Invalid value: fall back to default rather than aborting the whole run.
    return AGENT_LIMITS.workers;
  }
  return n;
}

export function parseAgentAssessment(
  text: string,
  maximum: number,
): AgentAssessment {
  const parsed = parseJson(text) as Partial<AgentAssessment> | null;
  const budgets: Record<string, number> = {
    simple: 2,
    moderate: 4,
    complex: 7,
    very_complex: 10,
  };
  // Clamp workerCount to its difficulty budget and the run maximum instead
  // of throwing when the model returns a slightly out-of-range value.
  const difficulty = parsed?.difficulty;
  const hasDifficulty =
    typeof difficulty === "string" &&
    Object.prototype.hasOwnProperty.call(budgets, difficulty);
  const rawCount =
    typeof parsed?.workerCount === "number" ? parsed.workerCount : 1;
  const budget = hasDifficulty ? budgets[difficulty!] : 1;
  const workerCount = Math.min(
    Math.max(1, Math.floor(rawCount)),
    budget,
    maximum,
  );
  // If the assessor returned something completely unparseable, degrade to
  // a single-worker simple run rather than aborting the whole operation.
  if (!hasDifficulty || typeof parsed?.reason !== "string" || !parsed.reason.trim()) {
    return {
      difficulty: "simple",
      workerCount: 1,
      reason: `Assessor returned invalid or unparseable response; defaulted to single-worker simple run. Raw: ${text.slice(0, 200)}`,
    };
  }
  return {
    difficulty: difficulty as AgentAssessment["difficulty"],
    workerCount,
    reason: parsed!.reason,
  };
}

export function parseAgentPlan(
  text: string,
  maximum: number = AGENT_LIMITS.workers,
): AgentTask[] {
  let parsed: unknown;
  try {
    parsed = parseJson(text);
  } catch {
    // If the orchestrator returned something completely unparseable, fall
    // back to a single generic research task so the run can continue.
    return [
      {
        id: "task-1",
        prompt: "Perform a general analysis of the request using available tools.",
        role: "General Researcher",
        title: "General research",
      },
    ];
  }
  const rawTasks = (parsed as { tasks?: unknown })?.tasks;
  const taskArray = Array.isArray(rawTasks) ? rawTasks : [];
  // Clamp to maximum instead of throwing
  const tasks = taskArray.slice(0, maximum);
  if (tasks.length === 0) {
    return [
      {
        id: "task-1",
        prompt: "Perform a general analysis of the request using available tools.",
        role: "General Researcher",
        title: "General research",
      },
    ];
  }
  const result: AgentTask[] = [];
  for (let i = 0; i < tasks.length; i++) {
    const task: any = tasks[i];
    if (!task || typeof task !== "object") continue;
    const prompt =
      typeof task.prompt === "string" && task.prompt.trim()
        ? task.prompt.slice(0, AGENT_LIMITS.taskChars)
        : "Perform a general analysis of the request using available tools.";
    const role =
      typeof task.role === "string" && task.role.trim()
        ? task.role.slice(0, 80)
        : "General Researcher";
    const title =
      typeof task.title === "string" && task.title.trim()
        ? task.title.slice(0, 120)
        : "Research task";
    const agentId =
      typeof task.agentId === "string" ? task.agentId : undefined;
    result.push({
      id: `task-${i + 1}`,
      prompt,
      role,
      title,
      agentId,
    });
  }
  return result.length > 0
    ? result
    : [
        {
          id: "task-1",
          prompt: "Perform a general analysis of the request using available tools.",
          role: "General Researcher",
          title: "General research",
        },
      ];
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

/** Each branch executes then summarizes; the global synthesis waits for the full team. */
export async function orchestrateAgents(
  request: string,
  sharedContext: string,
  host: OrchestratorHost,
  options: {
    signal?: AbortSignal;
    timeoutMs?: number;
    maxAgents?: number;
  } = {},
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
  const maximum = resolveMaxAgents(options.maxAgents);
  const State = Annotation.Root({
    assessment: Annotation<AgentAssessment>(),
    tasks: Annotation<AgentTask[]>(),
    artifacts: Annotation<AgentArtifact[]>({
      reducer: (a, b) => a.concat(b),
      default: () => [],
    }),
    task: Annotation<AgentTask>(),
    summaries: Annotation<AgentTaskSummary[]>({
      reducer: (a, b) => a.concat(b),
      default: () => [],
    }),
    finalSummary: Annotation<string>(),
    finalSummaryStatus: Annotation<"completed" | "failed">(),
  });
  const Branch = Annotation.Root({
    task: Annotation<AgentTask>(),
    artifact: Annotation<AgentArtifact>(),
    summary: Annotation<AgentTaskSummary>(),
  });
  const branch = new StateGraph(Branch)
    .addNode("execute", async (state) => {
      const task = state.task;
      try {
        signal.throwIfAborted();
        host.progress?.(`Working ${task.role}: ${task.title}`);
        const content = await abortable(
          host.work(task, context, contextId, signal),
          signal,
        );
        if (!content.trim()) {
          throw new Error("Worker returned no findings");
        }
        return {
          artifact: {
            taskId: task.id,
            agentId: task.agentId ?? "local",
            status: "completed" as const,
            content: content.slice(0, AGENT_LIMITS.resultChars),
          },
        };
      } catch (error) {
        signal.throwIfAborted();
        return {
          artifact: {
            taskId: task.id,
            agentId: task.agentId ?? "local",
            status: "failed" as const,
            content: String(error).slice(0, 1000),
          },
        };
      }
    })
    .addNode("task_summary", async (state) => {
      signal.throwIfAborted();
      host.progress?.(`Summarizing ${state.task.id}`);
      try {
        const content = await abortable(
          host.summarizeTask(state.task, state.artifact, signal),
          signal,
        );
        if (!content.trim()) {
          throw new Error("Task summary was empty");
        }
        return {
          summary: {
            taskId: state.task.id,
            status: "completed" as const,
            content: content.slice(0, AGENT_LIMITS.summaryChars),
          },
        };
      } catch (error) {
        signal.throwIfAborted();
        return {
          summary: {
            taskId: state.task.id,
            status: "failed" as const,
            content:
              `Summary unavailable: ${String(error).slice(0, 200)}. Execution ${state.artifact.status}: ${state.artifact.content}`.slice(
                0,
                AGENT_LIMITS.summaryChars,
              ),
          },
        };
      }
    })
    .addEdge(START, "execute")
    .addEdge("execute", "task_summary")
    .addEdge("task_summary", END)
    .compile();
  const contributions = (
    tasks: AgentTask[],
    artifacts: AgentArtifact[],
    summaries: AgentTaskSummary[],
  ): AgentContribution[] =>
    tasks.map((task) => {
      const artifact = artifacts.find((a) => a.taskId === task.id)!;
      const summary = summaries.find((s) => s.taskId === task.id)!;
      return {
        taskId: task.id,
        role: task.role,
        title: task.title,
        agentId: artifact.agentId,
        executionStatus: artifact.status,
        summaryStatus: summary.status,
        summary: summary.content,
      };
    });
  const graph = new StateGraph(State)
    .addNode("assessor", async () => {
      signal.throwIfAborted();
      host.progress?.("Assessing task difficulty");
      return {
        assessment: parseAgentAssessment(
          await abortable(host.assess(request, context, signal), signal),
          maximum,
        ),
      };
    })
    .addNode("orchestrator", async (state) => {
      signal.throwIfAborted();
      host.progress?.(
        `Planning up to ${state.assessment.workerCount} professional agents`,
      );
      return {
        tasks: parseAgentPlan(
          await abortable(
            host.plan(request, context, signal, state.assessment),
            signal,
          ),
          state.assessment.workerCount,
        ),
      };
    })
    .addNode("specialist", async (state) => {
      signal.throwIfAborted();
      const result = await abortable(
        branch.invoke({ task: state.task }, { signal }),
        signal,
      );
      return { artifacts: [result.artifact], summaries: [result.summary] };
    })
    .addNode("final_summary", async (state) => {
      signal.throwIfAborted();
      host.progress?.("Synthesizing all specialist contributions");
      try {
        const report = await abortable(
          host.summarizeRun(
            request,
            state.assessment,
            contributions(state.tasks, state.artifacts, state.summaries),
            signal,
          ),
          signal,
        );
        if (!report.trim()) {
          throw new Error("Final synthesis was empty");
        }
        return {
          finalSummary: report.slice(0, AGENT_LIMITS.resultChars),
          finalSummaryStatus: "completed" as const,
        };
      } catch (error) {
        signal.throwIfAborted();
        return {
          finalSummary: `Final synthesis unavailable: ${String(error).slice(0, 1000)}. Use the attributed contributions and raw evidence.`,
          finalSummaryStatus: "failed" as const,
        };
      }
    })
    .addEdge(START, "assessor")
    .addEdge("assessor", "orchestrator")
    .addConditionalEdges(
      "orchestrator",
      (state) => state.tasks.map((task) => new Send("specialist", { task })),
      ["specialist"],
    )
    .addEdge("specialist", "final_summary")
    .addEdge("final_summary", END)
    .compile();
  const result = await abortable(
    graph.invoke({}, { signal, recursionLimit: 12, maxConcurrency: maximum }),
    signal,
  );
  host.progress?.("Parallel research finished");
  return {
    contextId,
    phase: "research",
    taskCompleted: false,
    assessment: result.assessment,
    concurrency: Math.min(
      result.tasks.length,
      result.assessment.workerCount,
      maximum,
    ),
    tasks: result.tasks,
    artifacts: result.tasks.map(
      (task) => result.artifacts.find((a) => a.taskId === task.id)!,
    ),
    summaries: result.tasks.map(
      (task) => result.summaries.find((s) => s.taskId === task.id)!,
    ),
    contributions: contributions(
      result.tasks,
      result.artifacts,
      result.summaries,
    ),
    finalSummary: result.finalSummary,
    finalSummaryStatus: result.finalSummaryStatus,
    overallStatus: result.artifacts.every((a) => a.status === "failed")
      ? "failed"
      : result.artifacts.some((a) => a.status === "failed") ||
          result.summaries.some((s) => s.status === "failed") ||
          result.finalSummaryStatus === "failed"
        ? "partial"
        : "completed",
  };
}

/** Status/attribution comes from execution records, never from the summarizer's claims. */
export function formatAgentContributionReport(run: AgentRun): string {
  const cell = (value: string) =>
    value
      .replace(/\|/g, "\\|")
      .replace(/[\r\n]+/g, " ")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  const rows = run.contributions.map(
    (c) =>
      `| ${cell(c.taskId)} | ${cell(c.role)} | ${cell(c.title)} | ${c.executionStatus === "completed" ? "已执行" : "执行失败"} / ${c.summaryStatus === "completed" ? "已总结" : "总结失败"} | ${cell(c.summary.slice(0, 350))} |`,
  );
  return `专业子智能体阶段报告（${run.contributions.length} 个，阶段状态：${run.overallStatus}）\n\n| 子任务 | 专业角色 | 任务 | 状态 | 完成内容 |\n| --- | --- | --- | --- | --- |\n${rows.join("\n")}\n\n总总结（${run.finalSummaryStatus}）：\n${run.finalSummary}\n\n以上为子任务阶段成果；主任务是否完成，以主智能体后续实际实施和验证结果为准。`;
}
