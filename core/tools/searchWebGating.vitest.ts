import { expect, test } from "vitest";
import { BuiltInToolNames } from "./builtIn";
import { getBaseToolDefinitions } from "./index";

test("searchWeb tool is always available", () => {
  const tools = getBaseToolDefinitions();

  const searchWebTool = tools.find(
    (tool) => tool.function.name === BuiltInToolNames.SearchWeb,
  );
  expect(searchWebTool).toBeDefined();
  expect(searchWebTool?.displayTitle).toBe("Search Web");
});
