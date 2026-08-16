import { BaseContextProvider } from "..";
import {
  ContextItem,
  ContextProviderDescription,
  ContextProviderExtras,
  FetchFunction,
} from "../..";
import {
  BING_CN_ENDPOINT,
  BING_WWW_ENDPOINT,
  bingSearchHeaders,
  buildBingSearchUrl,
  parseBingHtml,
} from "../../util/bingSearch";

type SearchHit = {
  title: string;
  url: string;
  snippet: string;
};

function toContextItems(parsed: SearchHit[]): ContextItem[] {
  return parsed.map((r) => ({
    name: r.title,
    description: r.url,
    content: [r.snippet, r.url].filter(Boolean).join("\n"),
  }));
}

async function searchBing(
  query: string,
  n: number,
  fetchFn: FetchFunction,
  endpoint: string,
  setlang: string,
): Promise<ContextItem[]> {
  const url = buildBingSearchUrl(endpoint, query, setlang);
  const resp = await fetchFn(url, {
    method: "GET",
    headers: bingSearchHeaders(),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(
      `Bing search failed (${resp.status}${resp.statusText ? ` ${resp.statusText}` : ""}) via ${endpoint}. ${text.slice(0, 200)}`.trim(),
    );
  }

  const html = await resp.text();
  const parsed = parseBingHtml(html).slice(0, Math.max(1, n));
  if (parsed.length === 0) {
    throw new Error(`Bing returned no results via ${endpoint}.`);
  }
  return toContextItems(parsed);
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

export const fetchSearchResults = async (
  query: string,
  n: number,
  fetchFn: FetchFunction,
): Promise<ContextItem[]> => {
  const trimmed = query.trim();
  if (!trimmed) {
    throw new Error("Search query is empty.");
  }

  const attempts: Array<() => Promise<ContextItem[]>> = [
    () => searchBing(trimmed, n, fetchFn, BING_CN_ENDPOINT, "zh-cn"),
    () => searchBing(trimmed, n, fetchFn, BING_WWW_ENDPOINT, "en-us"),
  ];

  const errors: string[] = [];
  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (err) {
      errors.push(errorMessage(err));
    }
  }

  throw new Error(`Web search failed after trying Bing. ${errors.join(" | ")}`);
};

export default class WebContextProvider extends BaseContextProvider {
  private static DEFAULT_N = 6;

  static description: ContextProviderDescription = {
    title: "web",
    displayTitle: "Web",
    description: "Search the web",
    type: "normal",
    renderInlineAs: "",
  };

  async getContextItems(
    query: string,
    extras: ContextProviderExtras,
  ): Promise<ContextItem[]> {
    return await fetchSearchResults(
      extras.fullInput,
      this.options.n ?? WebContextProvider.DEFAULT_N,
      extras.fetch,
    );
  }
}
