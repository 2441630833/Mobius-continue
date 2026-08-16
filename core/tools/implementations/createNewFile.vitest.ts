import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as pathResolver from "../../util/pathResolver";
import { createNewFileImpl } from "./createNewFile";

describe("createNewFileImpl", () => {
  const writeFile = vi.fn();
  const openFile = vi.fn();
  const saveFile = vi.fn();
  const fileExists = vi.fn();
  const getWorkspaceDirs = vi.fn();
  const getCurrentFile = vi.fn();

  const mockExtras = () => ({
    ide: {
      writeFile,
      openFile,
      saveFile,
      fileExists,
      getWorkspaceDirs,
      getCurrentFile,
    },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    writeFile.mockResolvedValue(undefined);
    openFile.mockResolvedValue(undefined);
    saveFile.mockResolvedValue(undefined);
    fileExists.mockResolvedValue(false);
    getWorkspaceDirs.mockResolvedValue(["file:///d%3A/AI/workspace"]);
    getCurrentFile.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses resolveInputPath URI for Windows absolute filepath", async () => {
    const absUri = "file:///D:/png-to-pdf/main.py";
    vi.spyOn(pathResolver, "resolveInputPath").mockResolvedValue({
      uri: absUri,
      displayPath: "D:\\png-to-pdf\\main.py",
      isAbsolute: true,
      isWithinWorkspace: false,
    });

    const result = await createNewFileImpl(
      { filepath: "D:\\png-to-pdf\\main.py", contents: "print(1)\n" },
      mockExtras() as any,
    );

    expect(pathResolver.resolveInputPath).toHaveBeenCalledWith(
      expect.anything(),
      "D:\\png-to-pdf\\main.py",
    );
    expect(writeFile).toHaveBeenCalledWith(absUri, "print(1)\n");
    // Must not nest the drive path under the workspace (the previous bug).
    expect(writeFile.mock.calls[0][0]).not.toContain("workspace");
    expect(result[0]?.uri?.value).toBe(absUri);
    expect(result[0]?.description).toBe("D:\\png-to-pdf\\main.py");
  });

  it.runIf(process.platform === "win32")(
    "resolves a real Windows absolute path outside the workspace",
    async () => {
      await createNewFileImpl(
        { filepath: "D:\\png-to-pdf\\main.py", contents: "x" },
        mockExtras() as any,
      );

      expect(writeFile).toHaveBeenCalledOnce();
      expect(writeFile.mock.calls[0][0]).toBe("file:///D:/png-to-pdf/main.py");
      expect(writeFile.mock.calls[0][0]).not.toContain("workspace");
    },
  );

  it("still creates workspace-relative new files when path does not exist yet", async () => {
    await createNewFileImpl(
      { filepath: "src/new_file.py", contents: "x" },
      mockExtras() as any,
    );

    expect(writeFile).toHaveBeenCalledOnce();
    const uri = writeFile.mock.calls[0][0] as string;
    expect(uri).toContain("workspace");
    expect(uri).toContain("new_file.py");
  });
});
