import { describe, expect, it } from "vitest";

import { executeFindAndReplace } from "./performReplace";
import { findSearchMatch, findSearchMatches } from "./findSearchMatch";

const LF_FILE =
  "function a() {\n  return 1;\n}\n\nfunction b() {\n  return 1;\n}\n";
const CRLF_FILE = LF_FILE.replace(/\n/g, "\r\n");

const OLD_STRING = "function b() {\n  return 1;\n}";
const NEW_STRING = "function b() {\n  return 2;\n}";

describe("line ending handling in find/replace", () => {
  it("matches a multi-line old_string in a CRLF file with a precise strategy", () => {
    const lfMatch = findSearchMatch(LF_FILE, OLD_STRING);
    expect(lfMatch?.strategyName).toBe("exactMatch");

    const crlfMatch = findSearchMatch(CRLF_FILE, OLD_STRING);
    // Before the fix this falls through to the lossy whitespaceIgnoredMatch,
    // which strips \r and \n and therefore matches BOTH functions.
    expect(crlfMatch?.strategyName).not.toBe("whitespaceIgnoredMatch");
    expect(crlfMatch).not.toBeNull();
    expect(
      CRLF_FILE.slice(crlfMatch!.startIndex, crlfMatch!.endIndex),
    ).toContain("function b");
  });

  it("finds exactly one match for a multi-line old_string in a CRLF file", () => {
    const lfMatches = findSearchMatches(LF_FILE, OLD_STRING);
    expect(lfMatches.length).toBe(1);

    const crlfMatches = findSearchMatches(CRLF_FILE, OLD_STRING);
    // Two similarly-shaped functions are indistinguishable once whitespace is
    // stripped, so without line-ending normalization this returns 2 and the
    // edit hard-fails with "appears 2 times in the file".
    expect(crlfMatches.length).toBe(1);
  });

  it("replaces in a CRLF file and preserves CRLF line endings", () => {
    const result = executeFindAndReplace(
      CRLF_FILE,
      OLD_STRING,
      NEW_STRING,
      false,
    );
    expect(result).toContain("function b() {\r\n  return 2;\r\n}");
    expect(result).toContain("function a() {\r\n  return 1;\r\n}");
    // No mixed line endings introduced
    expect(result.split("\r\n").length).toBe(CRLF_FILE.split("\r\n").length);
  });

  it("still works for single-line edits in CRLF files", () => {
    const result = executeFindAndReplace(
      CRLF_FILE,
      "return 1;",
      "return 42;",
      true,
    );
    expect(result).toBe(
      "function a() {\r\n  return 42;\r\n}\r\n\r\nfunction b() {\r\n  return 42;\r\n}\r\n",
    );
  });
});
