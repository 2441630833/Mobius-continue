import { describe, expect, it, vi } from "vitest";
import type { ChatMessage, ILLM, Tool, ToolExtras } from "../..";
import { orchestrateAgentsTool } from "../definitions/orchestrateAgents";
import {
  collectAgentReply,
  orchestrateAgentsImpl,
  selectAgentModel,
} from "./orchestrateAgents";

vi.mock("../../agents/a2a", () => ({
  loadRemoteAgents: async () => [],
  callRemoteAgent: vi.fn(),
}));
vi.mock("./searchWeb", () => ({
  searchWebImpl: vi.fn(async () => [
    {
      name: "Source",
      description: "https://example.com/official",
      content: "verified source",
    },
  ]),
}));
import { searchWebImpl } from "./searchWeb";
import { fromChatCompletionChunk } from "../../llm/openaiTypeConverters";

const searchTool: Tool = {
  ...orchestrateAgentsTool,
  function: { name: "search_web", parameters: { type: "object" } },
};

const professionalPlan = (prompts: string[]) =>
  JSON.stringify({
    tasks: prompts.map((prompt, i) => ({
      role: `specialist-${i + 1}`,
      title: prompt,
      prompt,
    })),
  });

function extras(
  streamChat: ILLM["streamChat"],
  tools: Tool[] = [searchTool],
): ToolExtras {
  const llm = {
    title: "Configured model",
    model: "model-1",
    streamChat: async function* (messages, signal, options) {
      const system = String(messages[0]?.content ?? "");
      if (system.includes("difficulty assessor")) {
        yield {
          role: "assistant",
          content:
            '{"difficulty":"complex","workerCount":5,"reason":"Independent questions"}',
        };
      } else if (
        system.includes("task summarizer") ||
        system.includes("final summarizer")
      ) {
        yield {
          role: "assistant",
          content: "Summarized specialist evidence and remaining work",
        };
      } else {
        return yield* streamChat(messages, signal, options);
      }
      return {} as never;
    } as ILLM["streamChat"],
  } as ILLM;
  return {
    llm,
    ide: {},
    tool: orchestrateAgentsTool,
    config: { tools, modelsByRole: { chat: [llm] }, selectedModelByRole: {} },
  } as ToolExtras;
}

describe("Continue orchestration adapter", () => {
  it.each([5, 10])(
    "invokes all model stages with %i specialists and a sufficient planning budget",
    async (maximum) => {
      const stages: string[] = [];
      const env = extras(async function* () {
        return {} as never;
      } as ILLM["streamChat"]);
      env.llm.streamChat = async function* (messages, _signal, options) {
        const system = String(messages[0].content);
        if (system.includes("difficulty assessor")) {
          stages.push("assess");
          yield {
            role: "assistant",
            content: JSON.stringify({
              difficulty: maximum === 5 ? "complex" : "very_complex",
              workerCount: maximum,
              reason: "Independent professional questions",
            }),
          };
        } else if (system.includes("supervisor")) {
          stages.push("plan");
          expect(
            JSON.parse(String(messages[1].content)).assessment.workerCount,
          ).toBe(maximum);
          expect(options?.maxTokens).toBeGreaterThan(1600);
          const tasks = JSON.parse(
            professionalPlan(
              [
                "Architecture",
                "Tests",
                "Security",
                "Performance",
                "Integration",
                "Protocols",
                "Documentation",
                "Compatibility",
                "Reliability",
                "Accessibility",
              ].slice(0, maximum),
            ),
          ).tasks;
          if (maximum === 10) {
            for (const task of tasks) {
              task.prompt = task.prompt.padEnd(2000, "x");
            }
          }
          yield {
            role: "assistant",
            content: JSON.stringify({ tasks }),
          };
        } else if (system.includes("task summarizer")) {
          const input = JSON.parse(String(messages[1].content));
          stages.push("summary:" + input.task.id);
          expect(input.artifact.status).toBe("completed");
          expect(options?.tools).toEqual([]);
          yield {
            role: "assistant",
            content: input.task.title + " findings summarized",
          };
        } else if (system.includes("final summarizer")) {
          stages.push("final");
          expect(
            JSON.parse(String(messages[1].content)).contributions,
          ).toHaveLength(maximum);
          expect(
            stages.filter((stage) => stage.startsWith("summary:")),
          ).toHaveLength(maximum);
          yield {
            role: "assistant",
            content:
              "Five specialist contributions reviewed; implementation remains",
          };
        } else {
          const input = JSON.parse(String(messages[1].content));
          stages.push("work:" + input.task);
          expect(system).toContain("professional specialist");
          yield { role: "assistant", content: "Evidence for " + input.task };
        }
        return {} as never;
      } as ILLM["streamChat"];
      const run = JSON.parse(
        (
          await orchestrateAgentsImpl(
            { request: "Complex feature", max_agents: maximum },
            env,
          )
        )[0].content,
      );
      expect(stages.slice(0, 2)).toEqual(["assess", "plan"]);
      expect(stages.filter((stage) => stage.startsWith("work:"))).toHaveLength(
        maximum,
      );
      expect(stages.at(-1)).toBe("final");
      expect(stages.filter((stage) => stage === "final")).toHaveLength(1);
      expect(run.contributionReport).toContain("Architecture");
      expect(run.contributionReport).toContain("Integration");
      expect(run.taskCompleted).toBe(false);
    },
  );

  it("keeps Anthropic tool IDs separate and does not concatenate repeated names", async () => {
    const env = extras(async function* () {
      for (const id of ["a", "b"]) {
        yield {
          role: "assistant",
          content: "",
          toolCalls: [
            { id, function: { name: "search_web", arguments: '{"query":' } },
          ],
        };
        yield {
          role: "assistant",
          content: "",
          toolCalls: [
            { id, function: { name: "search_web", arguments: '"docs"}' } },
          ],
        };
      }
      return {};
    } as ILLM["streamChat"]);
    const reply = await collectAgentReply(
      env.llm,
      [],
      new AbortController().signal,
    );
    expect(reply.calls.map((c) => c.id)).toEqual(["a", "b"]);
    expect(
      reply.calls.every(
        (c) =>
          c.function.name === "search_web" &&
          c.function.arguments === '{"query":"docs"}',
      ),
    ).toBe(true);
  });

  it("preserves OpenAI indices when argument fragments for two calls interleave", async () => {
    const env = extras(async function* () {
      for (const delta of [
        {
          index: 0,
          id: "a",
          function: { name: "search_web", arguments: '{"query":' },
        },
        {
          index: 1,
          id: "b",
          function: { name: "search_web", arguments: '{"query":' },
        },
        { index: 1, function: { arguments: '"B"}' } },
        { index: 0, function: { arguments: '"A"}' } },
      ]) {
        const chunk = fromChatCompletionChunk({
          choices: [{ delta: { tool_calls: [delta] } }],
        } as any);
        if (chunk) {
          yield chunk;
        }
      }
      return {};
    } as ILLM["streamChat"]);
    const reply = await collectAgentReply(
      env.llm,
      [],
      new AbortController().signal,
    );
    expect(
      reply.calls.map((c) => JSON.parse(c.function.arguments).query),
    ).toEqual(["A", "B"]);
  });
  it("collects fragmented tool calls instead of losing them in BaseLLM.chat", async () => {
    const env = extras(async function* () {
      yield {
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "call-1",
            function: { name: "search_web", arguments: '{"query":' },
          },
        ],
      };
      yield {
        role: "assistant",
        content: "",
        toolCalls: [{ function: { arguments: '"protocol"}' } }],
      };
      return {};
    } as ILLM["streamChat"]);
    const reply = await collectAgentReply(
      env.llm,
      [],
      new AbortController().signal,
      [searchTool],
    );
    expect(reply.calls[0]).toEqual({
      id: "call-1",
      type: "function",
      function: { name: "search_web", arguments: '{"query":"protocol"}' },
    });
  });

  it("runs real planning and tool-using workers through LangGraph", async () => {
    const env = extras(async function* (
      messages: ChatMessage[],
      _signal,
      options,
    ) {
      if (String(messages[0].content).includes("supervisor")) {
        yield {
          role: "assistant",
          content: professionalPlan([
            "Find protocol sources",
            "Check framework capabilities",
          ]),
        };
      } else if (messages.some((m) => m.role === "tool")) {
        expect(JSON.stringify(messages)).toContain("verified source");
        yield {
          role: "assistant",
          content: "Evidence: https://example.com/official",
        };
      } else {
        expect(options?.tools?.map((t) => t.function.name)).toEqual([
          "search_web",
        ]);
        yield {
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: "search-1",
              type: "function",
              function: {
                name: "search_web",
                arguments: '{"query":"official docs"}',
              },
            },
          ],
        };
      }
      return {};
    } as ILLM["streamChat"]);
    const result = await orchestrateAgentsImpl(
      { request: "Research frameworks" },
      env,
    );
    const run = JSON.parse(result[0].content);
    expect(run.artifacts).toHaveLength(2);
    expect(
      run.artifacts.every((a: { status: string }) => a.status === "completed"),
    ).toBe(true);
  });

  it("never executes write tools even when a worker tries to call one", async () => {
    const env = extras(
      async function* (messages) {
        yield String(messages[0].content).includes("supervisor")
          ? { role: "assistant", content: professionalPlan(["Research"]) }
          : messages.some((m) => m.role === "tool")
            ? {
                role: "assistant",
                content: "Write attempt denied; no changes made",
              }
            : {
                role: "assistant",
                content: "",
                toolCalls: [
                  {
                    id: "bad",
                    function: {
                      name: "run_terminal_command",
                      arguments: '{"command":"do not run"}',
                    },
                  },
                ],
              };
        return {};
      } as ILLM["streamChat"],
      [
        {
          ...searchTool,
          readonly: false,
          function: { name: "run_terminal_command" },
        },
      ],
    );
    const run = JSON.parse(
      (await orchestrateAgentsImpl({ request: "Research" }, env))[0].content,
    );
    expect(run.artifacts[0].content).toContain("denied");
  });

  it("does not advertise tools that require approval or web tools when offline", async () => {
    const env = extras(
      async function* (messages, _signal, options) {
        if (String(messages[0].content).includes("supervisor")) {
          yield {
            role: "assistant",
            content: professionalPlan(["Research offline"]),
          };
        } else {
          expect(options?.tools).toEqual([]);
          yield { role: "assistant", content: "No web tools available" };
        }
        return {};
      } as ILLM["streamChat"],
      [
        searchTool,
        {
          ...searchTool,
          function: { name: "read_file" },
          defaultToolPolicy: "allowedWithPermission",
        },
      ],
    );
    await orchestrateAgentsImpl({ request: "Research", allow_web: false }, env);
  });

  it("uses the explicitly selected workbench model and rejects missing models", () => {
    const env = extras(async function* () {
      return {};
    } as ILLM["streamChat"]);
    expect(selectAgentModel(env, "continue:Configured model")).toBe(env.llm);
    expect(() => selectAgentModel(env, "unknown")).toThrow("not available");
  });

  it("stops before further model calls when canceled", async () => {
    const controller = new AbortController();
    controller.abort();
    const stream = vi.fn();
    const env = extras(stream);
    env.abortSignal = controller.signal;
    await expect(
      orchestrateAgentsImpl({ request: "Research" }, env),
    ).rejects.toThrow();
    expect(stream).not.toHaveBeenCalled();
  });
});
