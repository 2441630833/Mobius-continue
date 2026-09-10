import { EditOperation } from "../../tools/definitions/multiEdit";
import { ContinueError, ContinueErrorReason } from "../../util/errors";
import { SearchMatchResult, findSearchMatches } from "./findSearchMatch";

/**
 * Get the leading whitespace of the first non-empty line in a string.
 */
function getLeadingIndent(text: string): string {
  const lines = text.split("\n");
  for (const line of lines) {
    if (line.trim().length > 0) {
      const match = line.match(/^(\s*)/);
      return match ? match[1] : "";
    }
  }
  return "";
}

/**
 * Get the indentation of the file line containing a given character position.
 */
function getLineIndentAtPosition(
  fileContent: string,
  position: number,
): string {
  const lineStart = fileContent.lastIndexOf("\n", position - 1) + 1;
  const lineEnd = fileContent.indexOf("\n", lineStart);
  const line = fileContent.substring(
    lineStart,
    lineEnd === -1 ? fileContent.length : lineEnd,
  );
  const match = line.match(/^(\s*)/);
  return match ? match[1] : "";
}

/**
 * When a fuzzy match strategy (trimmedMatch, whitespaceIgnoredMatch, etc.)
 * finds a match, the indentation of the matched region in the file may
 * differ from the indentation in the search string provided by the LLM.
 * This function adjusts newString so its indentation is relative to the
 * actual matched text in the file rather than the LLM-provided oldString.
 */
function adjustReplacementIndentation(
  fileContent: string,
  match: SearchMatchResult,
  oldString: string,
  newString: string,
): string {
  if (PRECISE_STRATEGIES.has(match.strategyName)) {
    return newString;
  }

  const matchedIndent = getLineIndentAtPosition(fileContent, match.startIndex);
  const oldIndent = getLeadingIndent(oldString);

  if (matchedIndent === oldIndent) {
    return newString;
  }

  const lines = newString.split("\n");
  const adjusted = lines.map((line, index) => {
    if (line.trim().length === 0) {
      return line;
    }
    if (index === 0) {
      // First line: the file content before startIndex already provides
      // indentation, so strip the old indent rather than adding new
      if (oldIndent && line.startsWith(oldIndent)) {
        return line.slice(oldIndent.length);
      }
      return line;
    }
    // Subsequent lines: replace oldIndent prefix with matchedIndent
    if (line.startsWith(oldIndent)) {
      return matchedIndent + line.slice(oldIndent.length);
    }
    return line;
  });
  return adjusted.join("\n");
}

/**
 * Keep the file's line endings consistent when inserting new text.
 *
 * Without this, replacing a region of a CRLF file with an LLM-provided
 * newString (which uses \n) leaves the file with mixed line endings. The next
 * edit then has to match against a file whose endings no longer match what the
 * model saw, which is a common cause of cascading "string not found" failures.
 */
function preserveLineEndings(matchedText: string, newString: string): string {
  if (!/[\r\n]/.test(newString)) {
    return newString;
  }
  const normalizedNew = newString.replace(/\r\n?/g, "\n");
  return matchedText.includes("\r\n")
    ? normalizedNew.replace(/\n/g, "\r\n")
    : normalizedNew;
}

/** Strategies that reflect the literal file contents (not a fuzzy match). */
const PRECISE_STRATEGIES = new Set([
  "exactMatch",
  "emptySearch",
  "lineEndingNormalizedMatch",
]);

export function executeFindAndReplace(
  fileContent: string,
  oldString: string,
  newString: string,
  replaceAll: boolean,
  editIndex = 0,
): string {
  const matches = findSearchMatches(fileContent, oldString);

  if (matches.length === 0) {
    throw new ContinueError(
      ContinueErrorReason.FindAndReplaceOldStringNotFound,
      `Edit at index ${editIndex}: string not found in file: "${oldString}"`,
    );
  }

  if (replaceAll) {
    // Apply replacements in reverse order to maintain correct positions
    let result = fileContent;
    for (let i = matches.length - 1; i >= 0; i--) {
      const match = matches[i];
      const adjustedNew = preserveLineEndings(
        fileContent.substring(match.startIndex, match.endIndex),
        adjustReplacementIndentation(result, match, oldString, newString),
      );
      result =
        result.substring(0, match.startIndex) +
        adjustedNew +
        result.substring(match.endIndex);
    }
    return result;
  } else {
    let match = matches[0];

    // For single replacement, check for multiple matches first
    if (matches.length > 1) {
      // Prefer a literal (non-fuzzy) match: if the string occurs exactly once
      // verbatim, that is unambiguously the intended target even when a looser
      // strategy also matched other places. Only fail when it is genuinely
      // ambiguous.
      const preciseMatches = matches.filter((m) =>
        PRECISE_STRATEGIES.has(m.strategyName),
      );
      if (preciseMatches.length !== 1) {
        throw new ContinueError(
          ContinueErrorReason.FindAndReplaceMultipleOccurrences,
          `Edit at index ${editIndex}: String "${oldString}" appears ${matches.length} times in the file. Either provide a more specific string with surrounding context to make it unique, or use replace_all=true to replace all occurrences.`,
        );
      }
      match = preciseMatches[0];
    }

    // Apply single replacement
    const adjustedNew = preserveLineEndings(
      fileContent.substring(match.startIndex, match.endIndex),
      adjustReplacementIndentation(fileContent, match, oldString, newString),
    );
    return (
      fileContent.substring(0, match.startIndex) +
      adjustedNew +
      fileContent.substring(match.endIndex)
    );
  }
}

export function executeMultiFindAndReplace(
  fileContent: string,
  edits: EditOperation[],
): string {
  let result = fileContent;

  // Apply edits in sequence
  for (let editIndex = 0; editIndex < edits.length; editIndex++) {
    const edit = edits[editIndex];
    result = executeFindAndReplace(
      result,
      edit.old_string,
      edit.new_string,
      edit.replace_all ?? false,
      editIndex,
    );
  }

  return result;
}
