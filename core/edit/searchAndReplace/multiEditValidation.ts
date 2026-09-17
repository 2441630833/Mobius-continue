import { EditOperation } from "../../tools/definitions/multiEdit";
import { ContinueError, ContinueErrorReason } from "../../util/errors";
import { validateSingleEdit } from "./findAndReplaceUtils";

/**
 * Validates multi-edit arguments and all edits in a single pass
 * @param args - The arguments object containing the edits array
 * @returns Validated edits array plus the indices of dropped no-op rows
 * @throws ContinueError if validation fails
 */
export function validateMultiEdit(args: unknown): {
  edits: EditOperation[];
  /** Indices of rows dropped because old_string === new_string (they change nothing). */
  skippedNoOps: number[];
} {
  if (typeof args !== "object" || !args || !("edits" in args)) {
    throw new ContinueError(
      ContinueErrorReason.MultiEditEditsArrayRequired,
      "invalid multi-edit args",
    );
  }

  // Validate that edits is a non-empty array
  if (!Array.isArray(args.edits)) {
    throw new ContinueError(
      ContinueErrorReason.MultiEditEditsArrayRequired,
      "edits array is required",
    );
  }
  const { edits } = args;

  if (edits.length === 0) {
    throw new ContinueError(
      ContinueErrorReason.MultiEditEditsArrayEmpty,
      "edits array must contain at least one edit",
    );
  }

  const kept: EditOperation[] = [];
  const skippedNoOps: number[] = [];

  // Validate each individual edit
  for (let i = 0; i < edits.length; i++) {
    const edit = edits[i];

    // A row whose old_string equals its new_string is a no-op. Rejecting the whole
    // batch over it discarded every other — valid — edit, and the model could not
    // tell from the error whether anything had been applied. Drop the row and
    // report it in the result text instead.
    if (
      edit &&
      typeof edit.old_string === "string" &&
      typeof edit.new_string === "string" &&
      edit.old_string === edit.new_string
    ) {
      skippedNoOps.push(i);
      continue;
    }

    // Use existing single edit validation
    validateSingleEdit(
      edit?.old_string,
      edit?.new_string,
      edit?.replace_all,
      i,
    );

    // Only the first surviving edit can have empty old_string (for insertion at beginning)
    if (kept.length > 0 && edit.old_string === "") {
      throw new ContinueError(
        ContinueErrorReason.FindAndReplaceNonFirstEmptyOldString,
        `Edit at index ${i}: old_string cannot be empty. Only the first edit can have an empty old_string for insertion at the beginning of the file.`,
      );
    }

    kept.push(edit);
  }

  if (kept.length === 0) {
    throw new ContinueError(
      ContinueErrorReason.FindAndReplaceIdenticalOldAndNewStrings,
      `all ${edits.length} edit(s) are no-ops (old_string === new_string) — nothing to apply`,
    );
  }

  return { edits: kept, skippedNoOps };
}
