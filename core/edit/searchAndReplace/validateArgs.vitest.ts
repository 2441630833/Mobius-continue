import { describe, expect, it, vi } from "vitest";
import { ContinueError, ContinueErrorReason } from "../../util/errors";
import { validateSearchAndReplaceFilepath } from "./validateArgs";

describe("validateSearchAndReplaceFilepath", () => {
  it("resolves Windows absolute paths via resolveInputPath", async () => {
    const absUri = "file:///D:/png-to-pdf/main.py";
    const ide = {
      getWorkspaceDirs: vi
        .fn()
        .mockResolvedValue(["file:///d%3A/AI/workspace"]),
      fileExists: vi.fn(async (uri: string) => uri === absUri),
    };

    const resolved = await validateSearchAndReplaceFilepath(
      "D:\\png-to-pdf\\main.py",
      ide as any,
    );

    expect(resolved).toBe(absUri);
    expect(resolved).not.toContain("workspace");
  });

  it("throws FileNotFound for missing absolute paths", async () => {
    const ide = {
      getWorkspaceDirs: vi
        .fn()
        .mockResolvedValue(["file:///d%3A/AI/workspace"]),
      fileExists: vi.fn().mockResolvedValue(false),
    };

    try {
      await validateSearchAndReplaceFilepath(
        "D:\\missing\\file.py",
        ide as any,
      );
      expect.fail("should throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ContinueError);
      expect((error as ContinueError).reason).toBe(
        ContinueErrorReason.FileNotFound,
      );
    }
  });

  it.runIf(process.platform === "win32")(
    "resolves a real existing Windows absolute path outside the workspace",
    async () => {
      const fs = await import("node:fs/promises");
      const os = await import("node:os");
      const path = await import("node:path");
      const { pathToFileURL } = await import("node:url");

      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mobius-edit-"));
      const filePath = path.join(dir, "sample.py");
      await fs.writeFile(filePath, "x = 1\n", "utf8");

      try {
        const expectedUri = pathToFileURL(filePath).href;
        const ide = {
          getWorkspaceDirs: vi
            .fn()
            .mockResolvedValue(["file:///d%3A/AI/workspace"]),
          fileExists: vi.fn(async (uri: string) => uri === expectedUri),
        };

        const resolved = await validateSearchAndReplaceFilepath(
          filePath,
          ide as any,
        );
        expect(resolved).toBe(expectedUri);
        expect(resolved).not.toContain("workspace");
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    },
  );
});
