import { inferResolvedUriFromRelativePath } from "../../util/ideUtils";
import { resolveInputPath } from "../../util/pathResolver";

import { ToolImpl } from ".";
import { throwIfFileIsSecurityConcern } from "../../indexing/ignore";
import { getCleanUriPath, getUriPathBasename } from "../../util/uri";
import { getStringArg } from "../parseArgs";
import { ContinueError, ContinueErrorReason } from "../../util/errors";

export const createNewFileImpl: ToolImpl = async (args, extras) => {
  const filepath = getStringArg(args, "filepath");
  const contents = getStringArg(args, "contents", true);

  // Absolute / tilde / file:// resolve even when the target does not exist yet.
  // Relative paths only resolve via resolveInputPath when they already exist —
  // for brand-new relative files, fall back to workspace-relative inference.
  const resolvedPath = await resolveInputPath(extras.ide, filepath);
  const resolvedFileUri =
    resolvedPath?.uri ??
    (await inferResolvedUriFromRelativePath(filepath, extras.ide));

  if (!resolvedFileUri) {
    throw new ContinueError(
      ContinueErrorReason.PathResolutionFailed,
      "Failed to resolve path",
    );
  }

  const displayPath =
    resolvedPath?.displayPath ?? getCleanUriPath(resolvedFileUri);

  throwIfFileIsSecurityConcern(displayPath);
  const exists = await extras.ide.fileExists(resolvedFileUri);
  if (exists) {
    throw new ContinueError(
      ContinueErrorReason.FileAlreadyExists,
      `File ${filepath} already exists. Use the edit tool to edit this file`,
    );
  }
  await extras.ide.writeFile(resolvedFileUri, contents);
  // Opening/saving is best-effort — especially for paths outside the workspace.
  try {
    await extras.ide.openFile(resolvedFileUri);
    await extras.ide.saveFile(resolvedFileUri);
  } catch {
    // File was written; ignore editor open/save failures.
  }
  if (extras.codeBaseIndexer) {
    void extras.codeBaseIndexer?.refreshCodebaseIndexFiles([resolvedFileUri]);
  }
  return [
    {
      name: getUriPathBasename(resolvedFileUri),
      description: displayPath,
      content: "File created successfuly",
      uri: {
        type: "file",
        value: resolvedFileUri,
      },
    },
  ];
};
