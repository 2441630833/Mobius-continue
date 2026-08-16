import { parse } from "partial-json";

/**
 * Returns true when `raw` is non-empty and parses as JSON.
 */
export function isValidToolCallArguments(raw: string | undefined): boolean {
  if (!raw?.trim()) {
    return false;
  }
  try {
    JSON.parse(raw);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensures tool call `arguments` are valid JSON before sending to providers
 * (LiteLLM/vLLM reject malformed strings and return 400 for the whole request).
 *
 * - Valid JSON is returned unchanged.
 * - Partially streamed JSON is repaired via partial-json when possible.
 * - Otherwise falls back to "{}" so later turns can continue in the same session.
 */
export function ensureValidToolCallArguments(raw: string | undefined): string {
  if (!raw?.trim()) {
    return "{}";
  }

  if (isValidToolCallArguments(raw)) {
    return raw;
  }

  try {
    const parsed = parse(raw);
    if (parsed !== undefined && parsed !== null && typeof parsed === "object") {
      return JSON.stringify(parsed);
    }
  } catch {
    // fall through to empty object
  }

  return "{}";
}
