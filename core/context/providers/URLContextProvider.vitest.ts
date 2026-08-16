import { describe, expect, test } from "vitest";
import { normalizeUrlInput } from "./URLContextProvider";

describe("normalizeUrlInput", () => {
  test("accepts absolute https urls", () => {
    expect(normalizeUrlInput("https://ollama.com/library").href).toBe(
      "https://ollama.com/library",
    );
  });

  test("adds https scheme when missing", () => {
    expect(normalizeUrlInput("ollama.com/library").href).toBe(
      "https://ollama.com/library",
    );
  });

  test("throws on empty input", () => {
    expect(() => normalizeUrlInput("   ")).toThrow("URL is empty");
  });
});
