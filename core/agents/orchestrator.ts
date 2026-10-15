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
  return JSON.parse(
    text
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, ""),
  );
}

export function resolveMaxAgents(
  value: unknown = AGENT_LIMITS.workers,
): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 5 ||
    value > AGENT_LIMITS.workers
  ) {
    throw new Error("max_agents must be an integer between 5 and 10");
  }
  return value;
}

export function parseAgentAssessment(
  text: string,
  maximum: number,
): AgentAssessment {
  const parsed = parseJson(text) as Partial<AgentAssessment> | null;
  const budgets = { simple: 2, moderate: 4, complex: 7, very_complex: 10 };
  if (
    !parsed ||
    !Object.prototype.hasOwnProperty.call(budgets, parsed.difficulty ?? "") ||
    !Number.isInteger(parsed.workerCount) ||
    parsed.workerCount! < 1 ||
    parsed.workerCount! > budgets[parsed.difficulty!] ||
    typeof parsed.reason !== "string" ||
    !parsed.reason.trim() ||
    parsed.reason.length > 1000
  ) {
    throw new Error(
      "Assessor must return difficulty, a valid workerCount budget and reason",
    );
  }
  return {
    difficulty: parsed.difficulty!,
    workerCount: Math.min(parsed.workerCount!, maximum),
    reason: parsed.reason,
  };
}

export function parseAgentPlan(
  text: string,
  maximum: number = AGENT_LIMITS.workers,
): AgentTask[] {
  const parsed = parseJson(text);
  const tasks = (parsed as { tasks?: unknown })?.tasks;
  if (!Array.isArray(tasks) || tasks.length < 1 || tasks.length > maximum) {
    throw new Error(`Orchestrator must return 1-${maximum} tasks`);
  }
  return tasks.map((task, i) => {
    if (
      !task ||
      typeof task.prompt !== "string" ||
      !task.prompt.trim() ||
      task.prompt.length > AGENT_LIMITS.taskChars ||
      typeof task.role !== "string" ||
      !task.role.trim() ||
      task.role.length > 80 ||
      typeof task.title !== "string" ||
      !task.title.trim() ||
      task.title.length > 120
    ) {
      throw new Error(`Invalid supervisor task ${i + 1}`);
    }
    if (task.agentId !== undefined && typeof task.agentId !== "string") {
      throw new Error(`Invalid agentId for task ${i + 1}`);
    }
    return {
      id: `task-${i + 1}`,
      prompt: task.prompt,
      role: task.role,
      title: task.title,
      agentId: task.agentId,
    };
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
