import { describe, expect, it } from "vitest";
import {
  isAgentTaskAutoApproveEnabled,
  shouldAutoApproveDuringAgentTask,
} from "./agentAutoApprove";

describe("agentAutoApprove", () => {
  it("auto-approves non-disabled tools in agent mode", () => {
    expect(
      shouldAutoApproveDuringAgentTask("agent", "allowedWithPermission"),
    ).toBe(true);
    expect(
      shouldAutoApproveDuringAgentTask("agent", "allowedWithoutPermission"),
    ).toBe(true);
  });

  it("never auto-approves disabled tools", () => {
    expect(shouldAutoApproveDuringAgentTask("agent", "disabled")).toBe(false);
  });

  it("requires manual approval outside agent mode", () => {
    expect(
      shouldAutoApproveDuringAgentTask("chat", "allowedWithPermission"),
    ).toBe(false);
    expect(isAgentTaskAutoApproveEnabled("chat")).toBe(false);
  });

  it("enables agent task auto-approve only in agent mode", () => {
    expect(isAgentTaskAutoApproveEnabled("agent")).toBe(true);
  });
});
