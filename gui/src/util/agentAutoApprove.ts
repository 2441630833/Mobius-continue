import { ToolPolicy } from "@continuedev/terminal-security";
import { MessageModes } from "core";

/**
 * Mobius: in Agent mode, auto-approve tool calls and diffs for the
 * duration of a task so the user is not prompted on every terminal run or edit.
 * Disabled tools (security policy) are never auto-approved.
 */
export function shouldAutoApproveDuringAgentTask(
  mode: MessageModes,
  policy: ToolPolicy,
): boolean {
  return mode === "agent" && policy !== "disabled";
}

export function isAgentTaskAutoApproveEnabled(mode: MessageModes): boolean {
  return mode === "agent";
}
