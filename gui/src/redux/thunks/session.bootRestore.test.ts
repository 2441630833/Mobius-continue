import { describe, expect, it } from "vitest";
import { shouldSkipBootSessionRestore } from "./session";

describe("shouldSkipBootSessionRestore", () => {
  it("skips when user started a new empty session before boot restore finished", () => {
    const getState = () => ({
      session: {
        id: "new-session-id",
        history: [],
        lastSessionId: "old-session-id",
      },
    });

    expect(
      shouldSkipBootSessionRestore(getState, "old-session-id"),
    ).toBe(true);
  });

  it("allows boot restore when current id still matches persisted session", () => {
    const getState = () => ({
      session: {
        id: "old-session-id",
        history: [],
        lastSessionId: "older-session-id",
      },
    });

    expect(
      shouldSkipBootSessionRestore(getState, "old-session-id"),
    ).toBe(false);
  });

  it("allows explicit session load when history is not empty", () => {
    const getState = () => ({
      session: {
        id: "other-id",
        history: [{ message: { role: "user" } }],
        lastSessionId: "target-id",
      },
    });

    expect(shouldSkipBootSessionRestore(getState, "target-id")).toBe(false);
  });
});
