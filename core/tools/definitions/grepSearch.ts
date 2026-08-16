import { Tool } from "../..";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn";

export const grepSearchTool: Tool = {
  type: "function",
  displayTitle: "Grep Search",
  wouldLikeTo: 'search for "{{{ query }}}"',
  isCurrently: 'searching for "{{{ query }}}"',
  hasAlready: 'searched for "{{{ query }}}"',
  readonly: true,
  isInstant: true,
  group: BUILT_IN_GROUP_NAME,
  function: {
    name: BuiltInToolNames.GrepSearch,
    description:
      "Search file contents with ripgrep. Prefer a short literal symbol or path fragment. Avoid broad regex with many | alternatives over the whole repo. Output may be truncated — use targeted queries.",
    parameters: {
      type: "object",
      required: ["query"],
      properties: {
        query: {
          type: "string",
          description:
            "Literal string or simple regex to find in file contents. Prefer exact symbols (e.g. 'world-physical-model/splash') over alternation groups.",
        },
      },
    },
  },
  defaultToolPolicy: "allowedWithoutPermission",
  systemMessageDescription: {
    prefix: `To perform a grep search within the project, call the ${BuiltInToolNames.GrepSearch} tool with the query pattern to match. Prefer short literal queries. For example:`,
    exampleArgs: [["query", "main_services"]],
  },
  toolCallIcon: "MagnifyingGlassIcon",
};
