import { Tool } from "../..";
import { BUILT_IN_GROUP_NAME } from "../builtIn";

export const orchestrateAgentsTool: Tool = {
  type: "function",
  displayTitle: "Parallel research agents",
  readonly: true,
  group: BUILT_IN_GROUP_NAME,
  defaultToolPolicy: "allowedWithoutPermission",
  function: {
    name: "orchestrate_agents",
    description:
      "Run a difficulty assessor, task orchestrator, up to 10 professional read-only specialists, a separate summarizer for each task and a final summarizer. Actual team size follows difficulty and useful independent work. Returns per-agent roles, contributions, summaries and truthful failure statuses. Explain each agent's work in your final answer after actual implementation and verification. Use once for complex tasks; pass only relevant non-secret context.",
    parameters: {
      type: "object",
      required: ["request"],
      properties: {
        request: { type: "string", maxLength: 8000 },
        max_agents: {
          type: "integer",
          minimum: 5,
          maximum: 10,
          default: 10,
          description:
            "Maximum simultaneous specialists, from 5 to 10. The assessor may choose a smaller team for simpler tasks.",
        },
        shared_context: {
          type: "string",
          maxLength: 8000,
          description:
            "Explicit task context shared with local workers; never raw chat history or credentials",
        },
        allow_web: {
          type: "boolean",
          description: "Allow worker web search (false when offline)",
        },
      },
    },
  },
};

export const listA2aAgentsTool: Tool = {
  type: "function",
  displayTitle: "Available remote agents",
  readonly: true,
  group: BUILT_IN_GROUP_NAME,
  defaultToolPolicy: "allowedWithoutPermission",
  function: {
    name: "list_a2a_agents",
    description:
      "List user-configured A2A agents. Empty until ~/.continue/a2a-agents.json is configured. Does not access the network.",
    parameters: { type: "object", properties: {} },
  },
};

export const callA2aAgentTool: Tool = {
  type: "function",
  displayTitle: "Consult remote agent",
  readonly: false,
  group: BUILT_IN_GROUP_NAME,
  defaultToolPolicy: "allowedWithPermission",
  function: {
    name: "call_a2a_agent",
    description:
      "Send an explicit task to a user-configured A2A agent by ID. Sends only prompt, not workspace files/history. Returns final text or a task-state error. context_id groups related messages; it is not shared memory.",
    parameters: {
      type: "object",
      required: ["agent_id", "prompt"],
      properties: {
        agent_id: { type: "string" },
        prompt: { type: "string", maxLength: 8000 },
        context_id: {
          type: "string",
          description:
            "Optional ID from an earlier result for this remote agent",
        },
      },
    },
  },
};
