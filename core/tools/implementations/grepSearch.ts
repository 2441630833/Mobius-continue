import { ToolImpl } from ".";
import { ContextItem } from "../..";
import { ContinueError, ContinueErrorReason } from "../../util/errors";
import { formatGrepSearchResults } from "../../util/grepSearch";
import {
  escapeLiteralForRegex,
  prepareQueryForRipgrep,
} from "../../util/regexValidator";
import { getStringArg } from "../parseArgs";

const DEFAULT_GREP_SEARCH_RESULTS_LIMIT = 100;
const DEFAULT_GREP_SEARCH_CHAR_LIMIT = 7500; // ~1500 tokens, will keep truncation simply for now

function splitGrepResultsByFile(content: string): ContextItem[] {
  const matches = [...content.matchAll(/^\.\/([^\n]+)$/gm)];

  const contextItems: ContextItem[] = [];

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const filepath = match[1];
    const startIndex = match.index!;
    const endIndex =
      i < matches.length - 1 ? matches[i + 1].index! : content.length;

    // Extract grepped content for this file
    const fileContent = content
      .substring(startIndex, endIndex)
      .replace(/^\.\/[^\n]+\n/, "") // remove the line with file path
      .trim();

    if (fileContent) {
      contextItems.push({
        name: `Search results in ${filepath}`,
        description: `Grep search results from ${filepath}`,
        content: fileContent,
        uri: { type: "file", value: filepath },
      });
    }
  }

  return contextItems;
}

export const grepSearchImpl: ToolImpl = async (args, extras) => {
  const rawQuery = getStringArg(args, "query");

  const prepared = prepareQueryForRipgrep(rawQuery);
  let query = prepared.query;
  let warning = prepared.warning;

  let results: string;
  try {
    results = await extras.ide.getSearchResults(
      query,
      DEFAULT_GREP_SEARCH_RESULTS_LIMIT,
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Exit code 2 = ripgrep regex parse error. Retry once as a fully escaped literal.
    if (errorMessage.includes("Process exited with code 2")) {
      const literalQuery = escapeLiteralForRegex(rawQuery);
      if (literalQuery !== query) {
        try {
          results = await extras.ide.getSearchResults(
            literalQuery,
            DEFAULT_GREP_SEARCH_RESULTS_LIMIT,
          );
          query = literalQuery;
          warning = [
            warning,
            "Retry succeeded after escaping query as a literal string",
          ]
            .filter(Boolean)
            .join("; ");
        } catch (retryError) {
          const retryMessage =
            retryError instanceof Error
              ? retryError.message
              : String(retryError);
          return [
            {
              name: "Search error",
              description: "The search query could not be processed",
              content: `The search failed due to an invalid regex pattern.\n\nOriginal query: ${rawQuery}\nProcessed query: ${query}\nLiteral retry: ${literalQuery}\n\nError: ${errorMessage}\nRetry error: ${retryMessage}\n\nTip: Prefer a short literal symbol without incomplete regex quantifiers (e.g. avoid unclosed '{').`,
            },
          ];
        }
      } else {
        return [
          {
            name: "Search error",
            description: "The search query could not be processed",
            content: `The search failed due to an invalid regex pattern.\n\nOriginal query: ${rawQuery}\nProcessed query: ${query}\n\nError: ${errorMessage}\n\nTip: Prefer a short literal symbol. Incomplete regex quantifiers (e.g. 'so{') must be escaped or avoided.`,
          },
        ];
      }
    } else {
      throw new ContinueError(
        ContinueErrorReason.SearchExecutionFailed,
        errorMessage,
      );
    }
  }

  const { formatted, numResults, truncated } = formatGrepSearchResults(
    results,
    DEFAULT_GREP_SEARCH_CHAR_LIMIT,
  );

  if (numResults === 0) {
    return [
      {
        name: "Search results",
        description: "Results from grep search",
        content: "The search returned no results.",
      },
    ];
  }

  const truncationReasons: string[] = [];
  if (numResults === DEFAULT_GREP_SEARCH_RESULTS_LIMIT) {
    truncationReasons.push(
      `the number of results exceeded ${DEFAULT_GREP_SEARCH_RESULTS_LIMIT}`,
    );
  }
  if (truncated) {
    truncationReasons.push(
      `the number of characters exceeded ${DEFAULT_GREP_SEARCH_CHAR_LIMIT}`,
    );
  }

  let contextItems: ContextItem[];

  const splitByFile: boolean = args?.splitByFile || false;
  if (splitByFile) {
    contextItems = splitGrepResultsByFile(formatted);
  } else {
    contextItems = [
      {
        name: "Search results",
        description: "Results from grep search",
        content: formatted,
      },
    ];
  }

  // Add warnings about query modifications or truncation
  const warnings: string[] = [];
  if (warning) {
    warnings.push(warning);
  }
  if (truncationReasons.length > 0) {
    warnings.push(
      `Results were truncated because ${truncationReasons.join(" and ")}`,
    );
  }

  if (truncationReasons.length > 0) {
    contextItems.push({
      name: "Truncation warning",
      description: "",
      content: `The above search results were truncated because ${truncationReasons.join(" and ")}. If the results are not satisfactory, try refining your search query.`,
    });
  }
  return contextItems;
};
