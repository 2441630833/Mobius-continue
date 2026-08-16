import { describe, expect, it } from "vitest";
import { fileUriToPath, pathToFileUri } from "./pathResolver";

describe("pathResolver browser-safe URI helpers", () => {
  it("converts Windows absolute paths like Node pathToFileURL", () => {
    expect(pathToFileUri("D:\\png-to-pdf\\main.py")).toBe(
      "file:///D:/png-to-pdf/main.py",
    );
    expect(pathToFileUri("D:/png-to-pdf/main.py")).toBe(
      "file:///D:/png-to-pdf/main.py",
    );
  });

  it("encodes spaces in path segments", () => {
    expect(pathToFileUri("D:\\my folder\\a b.py")).toBe(
      "file:///D:/my%20folder/a%20b.py",
    );
  });

  it("converts POSIX absolute paths", () => {
    expect(pathToFileUri("/tmp/foo.py")).toBe("file:///tmp/foo.py");
  });

  it("round-trips Windows file URIs for display", () => {
    const uri = "file:///D:/png-to-pdf/main.py";
    const display = fileUriToPath(uri);
    if (process.platform === "win32") {
      expect(display).toBe("D:\\png-to-pdf\\main.py");
    } else {
      expect(display).toBe("D:/png-to-pdf/main.py");
    }
  });
});
