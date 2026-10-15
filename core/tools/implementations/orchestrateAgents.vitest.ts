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

function extras(
  streamChat: ILLM["streamChat"],
  tools: Tool[] = [searchTool],
): ToolExtras {
  const llm = {
    title: "Configured model",
    model: "model-1",
    streamChat,
  } as ILLM;
  return {
    llm,
    ide: {},
    tool: orchestrateAgentsTool,
    config: { tools, modelsByRole: { chat: [llm] }, selectedModelByRole: {} },
  } as ToolExtras;
}

describe("Continue orchestration adapter", () => {
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
          content:
            '{"tasks":[{"prompt":"Find protocol sources"},{"prompt":"Check framework capabilities"}]}',
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
          ? { role: "assistant", content: '{"tasks":[{"prompt":"Research"}]}' }
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
            content: '{"tasks":[{"prompt":"Research offline"}]}',
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
