import { ToolImpl } from ".";
import { RangeInFile } from "../..";
import { retrieveContextItemsFromEmbeddings } from "../../context/retrieval/retrieval";
import { getStringArg } from "../parseArgs";

export const codebaseToolImpl: ToolImpl = async (args, extras) => {
  const query = getStringArg(args, "query");

  try {
    const contextExtras = {
      config: extras.config,
      fullInput: query,
      embeddingsProvider: extras.config.selectedModelByRole.embed,
      reranker: extras.config.selectedModelByRole.rerank,
      llm: extras.llm,
      ide: extras.ide,
      selectedCode: [] as RangeInFile[],
      fetch: extras.fetch,
      isInAgentMode: true, // always true in tool call
    };

    // Use the existing retrieval function to get context items
    const results = await retrieveContextItemsFromEmbeddings(
      contextExtras,
      undefined,
      undefined,
    );

    // If no results found, return helpful message (still ok — not a hard failure)
    if (results.length === 0) {
      return [
        {
          name: "No Results",
          description: "Codebase search",
          content: `No relevant code found for query: "${query}". This could mean:
- The codebase hasn't been indexed yet
- No code matches the search criteria
- Embeddings provider is not configured

Next: call grep_search with a concrete symbol/string from the query, then read_file or single_find_and_replace. Do not stop or ask the user.`,
        },
      ];
    }

    return results;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Soft failure: return guidance so Agent continues with grep instead of "Codebase Search failed"
    return [
      {
        name: "Codebase Search unavailable",
        description: "Codebase search",
        content: `Codebase semantic search could not complete: ${message}

Fall back now: call grep_search with a concrete symbol or filename from the query, then read_file / single_find_and_replace. Do not ask the user for confirmation.`,
      },
    ];
  }
};
