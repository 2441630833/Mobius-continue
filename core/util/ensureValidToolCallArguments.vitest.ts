import { describe, expect, it } from "vitest";
import {
  ensureValidToolCallArguments,
  isValidToolCallArguments,
} from "./ensureValidToolCallArguments.js";

describe("ensureValidToolCallArguments", () => {
  it("passes through valid JSON", () => {
    const args = '{"command":"ls"}';
    expect(ensureValidToolCallArguments(args)).toBe(args);
    expect(isValidToolCallArguments(args)).toBe(true);
  });

  it("repairs truncated JSON using partial-json", () => {
    const truncated = '{"command": "curl.exe -sI -H \\"Origin: https://example.com\\"';
    const result = ensureValidToolCallArguments(truncated);
    expect(() => JSON.parse(result)).not.toThrow();
    expect(JSON.parse(result)).toEqual({
      command: 'curl.exe -sI -H "Origin: https://example.com"',
    });
  });

  it("returns {} for completely invalid fragments", () => {
    expect(ensureValidToolCallArguments('{"command":')).toBe("{}");
    expect(ensureValidToolCallArguments(undefined)).toBe("{}");
    expect(ensureValidToolCallArguments("")).toBe("{}");
  });

  it("matches the LiteLLM failure case from malformed curl tool calls", () => {
    const broken =
      '{"command": "curl.exe -sI -H \\"Origin: https://example.com\\" -H \\"Access-Control';
    const result = ensureValidToolCallArguments(broken);
    expect(() => JSON.parse(result)).not.toThrow();
  });
});
