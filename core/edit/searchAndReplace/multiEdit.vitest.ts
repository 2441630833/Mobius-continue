import { describe, expect, it } from "vitest";
import { EditOperation } from "../../tools/definitions/multiEdit";
import { ContinueErrorReason } from "../../util/errors";
import { validateMultiEdit } from "./multiEditValidation";
import {
  executeMultiFindAndReplace,
  simulateMultiFindAndReplace,
} from "./performReplace";

describe("multiEdit shared validation", () => {
  describe("validateMultiEdit", () => {
    it("should throw error if edits is not an array", () => {
      expect(() => validateMultiEdit({ edits: "not an array" })).toThrowError(
        expect.objectContaining({
          reason: ContinueErrorReason.MultiEditEditsArrayRequired,
        }),
      );
    });

    it("should throw error if edits is missing", () => {
      expect(() => validateMultiEdit({})).toThrowError(
        expect.objectContaining({
          reason: ContinueErrorReason.MultiEditEditsArrayRequired,
        }),
      );
    });

    it("should throw error if edits array is empty", () => {
      expect(() => validateMultiEdit({ edits: [] })).toThrowError(
        expect.objectContaining({
          reason: ContinueErrorReason.MultiEditEditsArrayEmpty,
        }),
      );
    });

    it("should return valid edits", () => {
      const edits: EditOperation[] = [
        { old_string: "hello", new_string: "world" },
      ];
      const result = validateMultiEdit({ edits });
      expect(result.edits).toEqual(edits);
    });
  });

  describe("validateMultiEdit - individual edit validation", () => {
    it("should throw error if edit has missing old_string", () => {
      const args = {
        edits: [
          {
            old_string: undefined as any,
            new_string: "Hi there",
          },
        ],
      };

      expect(() => validateMultiEdit(args)).toThrowError(
        expect.objectContaining({
          reason: ContinueErrorReason.FindAndReplaceMissingOldString,
        }),
      );
    });

    it("should throw error if edit has missing new_string", () => {
      const args = {
        edits: [
          {
            old_string: "Hello world",
            new_string: undefined as any,
          },
        ],
      };

      expect(() => validateMultiEdit(args)).toThrowError(
        expect.objectContaining({
          reason: ContinueErrorReason.FindAndReplaceMissingNewString,
        }),
      );
    });

    it("should throw error if old_string and new_string are the same", () => {
      const args = {
        edits: [
          {
            old_string: "Hello world",
            new_string: "Hello world",
          },
        ],
      };

      expect(() => validateMultiEdit(args)).toThrowError(
        expect.objectContaining({
          reason: ContinueErrorReason.FindAndReplaceIdenticalOldAndNewStrings,
        }),
      );
    });

    it("should throw error if non-first edit has empty old_string", () => {
      const args = {
        edits: [
          {
            old_string: "Hello world",
            new_string: "Hi there",
          },
          {
            old_string: "",
            new_string: "Invalid insertion",
          },
        ],
      };

      expect(() => validateMultiEdit(args)).toThrowError(
        expect.objectContaining({
          reason: ContinueErrorReason.FindAndReplaceNonFirstEmptyOldString,
        }),
      );
    });

    it("should allow first edit to have empty old_string", () => {
      const args = {
        edits: [
          {
            old_string: "",
            new_string: "New content",
          },
        ],
      };

      expect(() => validateMultiEdit(args)).not.toThrow();
    });
  });

  describe("executeMultiFindAndReplace", () => {
    const originalContent = "Hello world\nThis is a test file\nGoodbye world";

    it("should handle single edit", () => {
      const edits = [
        {
          old_string: "Hello world",
          new_string: "Hi there",
        },
      ];

      const result = executeMultiFindAndReplace(originalContent, edits);
      expect(result).toBe("Hi there\nThis is a test file\nGoodbye world");
    });

    it("should handle multiple edits", () => {
      const edits = [
        {
          old_string: "Hello world",
          new_string: "Hi there",
        },
        {
          old_string: "Goodbye world",
          new_string: "See you later",
        },
      ];

      const result = executeMultiFindAndReplace(originalContent, edits);
      expect(result).toBe("Hi there\nThis is a test file\nSee you later");
    });

    it("should handle replace_all", () => {
      const edits = [
        {
          old_string: "world",
          new_string: "universe",
          replace_all: true,
        },
      ];

      const result = executeMultiFindAndReplace(originalContent, edits);
      expect(result).toBe(
        "Hello universe\nThis is a test file\nGoodbye universe",
      );
    });

    it("should handle empty old_string as insertion at beginning", () => {
      const edits = [
        {
          old_string: "",
          new_string: "New first line\n",
        },
      ];

      const result = executeMultiFindAndReplace(originalContent, edits);
      expect(result).toBe(
        "New first line\nHello world\nThis is a test file\nGoodbye world",
      );
    });

    it("should handle empty string in empty file", () => {
      const edits = [
        {
          old_string: "",
          new_string: "Content for empty file",
        },
      ];

      // Empty old_string matches at position 0 (beginning of file)
      const result = executeMultiFindAndReplace("", edits);
      expect(result).toBe("Content for empty file");
    });

    it("should apply edits sequentially", () => {
      const edits = [
        {
          old_string: "Hello world",
          new_string: "Hi universe",
        },
        {
          old_string: "Hi universe",
          new_string: "Greetings cosmos",
        },
      ];

      const result = executeMultiFindAndReplace(originalContent, edits);
      expect(result).toBe(
        "Greetings cosmos\nThis is a test file\nGoodbye world",
      );
    });

    it("should throw error if old_string is not found", () => {
      const edits = [
        {
          old_string: "Not found",
          new_string: "Hi there",
        },
      ];

      expect(() =>
        executeMultiFindAndReplace(originalContent, edits),
      ).toThrowError(
        expect.objectContaining({
          reason: ContinueErrorReason.FindAndReplaceOldStringNotFound,
        }),
      );
    });

    it("should throw error if old_string appears multiple times and replace_all is false", () => {
      const edits = [
        {
          old_string: "world",
          new_string: "universe",
          replace_all: false,
        },
      ];

      expect(() =>
        executeMultiFindAndReplace(originalContent, edits),
      ).toThrowError(
        expect.objectContaining({
          reason: ContinueErrorReason.FindAndReplaceMultipleOccurrences,
        }),
      );
    });

    it("should throw if string not found in edit sequence", () => {
      const content = "Hello world";
      const edits = [
        { old_string: "Hello", new_string: "Hi" },
        { old_string: "not found", new_string: "test" },
      ];

      expect(() => executeMultiFindAndReplace(content, edits)).toThrowError(
        expect.objectContaining({
          reason: ContinueErrorReason.FindAndReplaceOldStringNotFound,
        }),
      );
    });

    it("should handle whitespace differences using findSearchMatch", () => {
      const content = "function test() {\n  return true;\n}";
      const edits = [
        {
          old_string: "function test(){return true;}",
          new_string: "function test() { return false; }",
        },
      ];

      const result = executeMultiFindAndReplace(content, edits);
      expect(result).toBe("function test() { return false; }");
    });

    it("should handle mixed replace_all settings", () => {
      const content = "x y x z x";
      const edits = [
        { old_string: "x", new_string: "a", replace_all: true },
        { old_string: "y", new_string: "b" },
      ];

      const result = executeMultiFindAndReplace(content, edits);
      expect(result).toBe("a b a z a");
    });
  });

  describe("batch resilience (no-op rows + all-failure reporting)", () => {
    const fileContent = "alpha\nbeta\ngamma\n";

    it("drops no-op rows instead of rejecting the whole batch", () => {
      const args = {
        filepath: "a.ts",
        edits: [
          { old_string: "alpha", new_string: "ALPHA" },
          // A model slip: identical old/new changes nothing.
          { old_string: "beta", new_string: "beta" },
          { old_string: "gamma", new_string: "GAMMA" },
        ],
      };

      const { edits, skippedNoOps } = validateMultiEdit(args);
      expect(skippedNoOps).toEqual([1]);
      expect(edits).toHaveLength(2);
      expect(executeMultiFindAndReplace(fileContent, edits)).toBe(
        "ALPHA\nbeta\nGAMMA\n",
      );
    });

    it("still rejects a batch where every row is a no-op", () => {
      const args = {
        edits: [
          { old_string: "alpha", new_string: "alpha" },
          { old_string: "beta", new_string: "beta" },
        ],
      };

      expect(() => validateMultiEdit(args)).toThrowError(
        expect.objectContaining({
          reason: ContinueErrorReason.FindAndReplaceIdenticalOldAndNewStrings,
        }),
      );
    });

    it("reports every failing index in one message and says the file is unchanged", () => {
      const edits: EditOperation[] = [
        { old_string: "alpha", new_string: "ALPHA" },
        { old_string: "does-not-exist", new_string: "x" },
        { old_string: "gamma", new_string: "gamma\n", replace_all: true },
        { old_string: "also-missing", new_string: "y" },
      ];

      let message = "";
      try {
        executeMultiFindAndReplace(fileContent, edits);
      } catch (error) {
        message = (error as Error).message;
      }

      expect(message).toContain("2 of 4 edit(s) could not be applied");
      expect(message).toContain("NO edits were written");
      expect(message).toContain("Edit at index 1");
      expect(message).toContain("Edit at index 3");
      // Successful indices must not be reported as failures.
      expect(message).not.toContain("Edit at index 0");
      expect(message).not.toContain("Edit at index 2");
    });

    it("simulateMultiFindAndReplace leaves the input untouched and lists failures", () => {
      const edits: EditOperation[] = [
        { old_string: "beta", new_string: "BETA" },
        { old_string: "missing", new_string: "x" },
      ];

      const { content, failures } = simulateMultiFindAndReplace(
        fileContent,
        edits,
      );

      expect(failures.map((failure) => failure.index)).toEqual([1]);
      expect(failures[0].reason).toBe(
        ContinueErrorReason.FindAndReplaceOldStringNotFound,
      );
      // Applied-in-memory preview; the caller only writes when failures is empty.
      expect(content).toBe("alpha\nBETA\ngamma\n");
      expect(fileContent).toBe("alpha\nbeta\ngamma\n");
    });
  });

  describe("preprocessing logic", () => {
    const originalContent = "Hello world\nThis is a test file\nGoodbye world";

    it("should handle single edit preprocessing", () => {
      const edits = [
        {
          old_string: "Hello world",
          new_string: "Hi there",
        },
      ];

      const newContent = executeMultiFindAndReplace(originalContent, edits);

      expect(newContent).toBe("Hi there\nThis is a test file\nGoodbye world");
    });

    it("should handle multiple edits preprocessing", () => {
      const edits = [
        {
          old_string: "Hello world",
          new_string: "Hi there",
        },
        {
          old_string: "Goodbye world",
          new_string: "See you later",
        },
      ];

      const newContent = executeMultiFindAndReplace(originalContent, edits);

      expect(newContent).toBe("Hi there\nThis is a test file\nSee you later");
    });

    it("should count edits correctly", () => {
      const edits = [
        { old_string: "Hello", new_string: "Hi" },
        { old_string: "world", new_string: "universe", replace_all: true },
      ];

      const newContent = executeMultiFindAndReplace(originalContent, edits);

      expect(newContent).toBe(
        "Hi universe\nThis is a test file\nGoodbye universe",
      );
      expect(edits.length).toBe(2);
    });
  });
});
