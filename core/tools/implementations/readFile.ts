import { resolveInputPath } from "../../util/pathResolver";
import { getUriPathBasename } from "../../util/uri";

import { ToolImpl } from ".";
import { throwIfFileIsSecurityConcern } from "../../indexing/ignore";
import { getStringArg } from "../parseArgs";
import { throwIfFileExceedsHalfOfContext } from "./readFileLimit";
import { ContinueError, ContinueErrorReason } from "../../util/errors";

/** Normalize common parameter name variants the model may emit for the filepath. */
function resolveFilepathArg(args: any): any {
  if (!args || "filepath" in args) return args;
  // Accept common case-variant / snake_case aliases the model may generate
  const aliases = ["FilePath", "file_path", "path", "filename", "file"];
  for (const alias of aliases) {
    if (alias in args) {
      return { ...args, filepath: args[alias] };
    }
  }
  return args;
}

export const readFileImpl: ToolImpl = async (args, extras) => {
  const normalizedArgs = resolveFilepathArg(args);
  const filepath = getStringArg(normalizedArgs, "filepath");

  // Resolve the path first to get the actual path for security check
  const resolvedPath = await resolveInputPath(extras.ide, filepath);
  if (!resolvedPath) {
    throw new ContinueError(
      ContinueErrorReason.FileNotFound,
      `File "${filepath}" does not exist or is not accessible. You might want to check the path and try again.`,
    );
  }

  // Security check on the resolved display path
  throwIfFileIsSecurityConcern(resolvedPath.displayPath);

  const content = await extras.ide.readFile(resolvedPath.uri);

  await throwIfFileExceedsHalfOfContext(
    resolvedPath.displayPath,
    content,
    extras.config.selectedModelByRole.chat,
  );

  return [
    {
      name: getUriPathBasename(resolvedPath.uri),
      description: resolvedPath.displayPath,
      content,
      uri: {
        type: "file",
        value: resolvedPath.uri,
      },
    },
  ];
};
