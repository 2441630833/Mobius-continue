import { EventEmitter } from "node:events";
import fs from "node:fs";
import { fork } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GlmOcrForkClient } from "./TransformersJsGlmOcrClient";

vi.mock("child_process", () => ({ fork: vi.fn() }));

function fakeChild() {
  return Object.assign(new EventEmitter(), {
    stderr: new EventEmitter(),
    connected: true,
    killed: false,
    pid: 42,
    send: vi.fn(),
    kill: vi.fn(() => true),
  });
}

describe("GLM-OCR process lifecycle", () => {
  beforeEach(() => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("reports loader stderr arriving after exit instead of only code=1", async () => {
    const child = fakeChild();
    vi.mocked(fork).mockReturnValue(child as never);
    const client = new GlmOcrForkClient("/models");
    const pending = client.ocr({ base64: "image", mimeType: "image/png" });
    const rejected = expect(pending).rejects.toThrow(
      "Cannot find module '@huggingface/transformers'"
    );
    child.emit("exit", 1, null);
    child.stderr.emit(
      "data",
      Buffer.from("Error: Cannot find module '@huggingface/transformers'")
    );
    child.emit("close", 1, null);
    await rejected;
  });

  it("bounds diagnostics while preserving the last native loader error", async () => {
    const child = fakeChild();
    vi.mocked(fork).mockReturnValue(child as never);
    const pending = new GlmOcrForkClient("/models").ocr({
      base64: "image",
      mimeType: "image/png",
    });
    const error = pending.then(
      () => {
        throw new Error("Expected worker failure");
      },
      (e) => e as Error
    );
    child.stderr.emit(
      "data",
      Buffer.from("x".repeat(30_000) + "native library missing")
    );
    child.emit("close", 1, null);
    expect((await error).message.length).toBeLessThan(6500);
    expect((await error).message).toContain("native library missing");
  });

  it("ignores a previous worker closing after a new OCR request starts", async () => {
    const old = fakeChild(),
      fresh = fakeChild();
    vi.mocked(fork)
      .mockReturnValueOnce(old as never)
      .mockReturnValueOnce(fresh as never);
    const client = new GlmOcrForkClient("/models");
    const first = client.ocr({ base64: "first", mimeType: "image/png" });
    const rejected = expect(first).rejects.toThrow("Canceled");
    client.reset("Canceled");
    await rejected;
    const second = client.ocr({ base64: "second", mimeType: "image/png" });
    old.emit("close", 1, null);
    old.emit("message", { type: "init-error", error: "late error" });
    fresh.emit("message", { type: "ready" });
    expect(fresh.send).toHaveBeenCalledOnce();
    fresh.emit("message", { id: 2, ok: true, text: "recognized text" });
    await expect(second).resolves.toBe("recognized text");
    fresh.emit("close", 0, null);
  });
});
