import { describe, expect, it } from "vitest";
import type { ToolExtras } from "..";
import { callBuiltInTool } from "./callTool";
import { getBaseToolDefinitions } from ".";
import { DEFAULT_AGENT_SYSTEM_MESSAGE } from "../llm/defaultSystemMessages";

describe("removed parallel research", () => {
  it.each(["orchestrate_agents", "list_a2a_agents", "call_a2a_agent"])(
    "does not advertise or execute %s, including restored calls",
    async (name) => {
      expect(
        getBaseToolDefinitions().some((tool) => tool.function.name === name),
      ).toBe(false);
      expect(DEFAULT_AGENT_SYSTEM_MESSAGE).not.toContain(name);
      await expect(
        callBuiltInTool(name, { request: "Research" }, {} as ToolExtras),
      ).rejects.toThrow(`Tool "${name}" not found`);
    },
  );

  it("keeps normal file and terminal tools available", () => {
    const names = getBaseToolDefinitions().map((tool) => tool.function.name);
    expect(names).toContain("read_file");
    expect(names).toContain("run_terminal_command");
  });
});
