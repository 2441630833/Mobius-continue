import { IDE } from "../..";
import { ContinueError, ContinueErrorReason } from "../../util/errors";
import { resolveInputPath } from "../../util/pathResolver";

export async function validateSearchAndReplaceFilepath(
  filepath: unknown,
  ide: IDE,
) {
  if (!filepath || typeof filepath !== "string") {
    throw new ContinueError(
      ContinueErrorReason.FindAndReplaceMissingFilepath,
      "filepath (string) is required",
    );
  }

  const resolvedPath = await resolveInputPath(ide, filepath);
  if (!resolvedPath || !(await ide.fileExists(resolvedPath.uri))) {
    throw new ContinueError(
      ContinueErrorReason.FileNotFound,
      `File ${filepath} does not exist`,
    );
  }

  return resolvedPath.uri;
}
