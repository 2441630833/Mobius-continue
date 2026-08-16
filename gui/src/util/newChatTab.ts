import { NEW_SESSION_TITLE } from "core/util/constants";

/** Display title for an empty chat tab (same as core NEW_SESSION_TITLE). */
export const NEW_AGENT_TAB_TITLE = NEW_SESSION_TITLE;

export function generateChatTabId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
}
