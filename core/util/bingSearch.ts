/**
 * Parse Bing HTML SERP (cn.bing.com / www.bing.com) without an API key.
 * Structure is unofficial and may change; keep parsing defensive.
 */

export type BingSearchResult = {
  title: string;
  url: string;
  snippet: string;
};

export const BING_CN_ENDPOINT = "https://cn.bing.com/search";
export const BING_WWW_ENDPOINT = "https://www.bing.com/search";

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&ensp;/gi, " ")
    .replace(/&emsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
}

function stripTags(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function isHttpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Extract organic results from Bing HTML (`li.b_algo` blocks).
 */
export function parseBingHtml(html: string): BingSearchResult[] {
  const results: BingSearchResult[] = [];
  const blockRe = /<li class="b_algo"[\s\S]*?<\/li>/gi;

  for (const m of html.matchAll(blockRe)) {
    const block = m[0];
    const h2 = block.match(
      /<h2[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i,
    );
    if (!h2) {
      continue;
    }

    const url = h2[1]?.trim() ?? "";
    const title = stripTags(h2[2] ?? "");
    if (!isHttpUrl(url) || !title) {
      continue;
    }

    const snipMatch =
      block.match(/<p class="b_lineclamp[^"]*"[^>]*>([\s\S]*?)<\/p>/i) ||
      block.match(/class="b_caption"[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i);

    results.push({
      title,
      url,
      snippet: snipMatch ? stripTags(snipMatch[1]) : "",
    });
  }

  return results;
}

export function buildBingSearchUrl(
  endpoint: string,
  query: string,
  setlang = "zh-cn",
): string {
  const url = new URL(endpoint);
  url.searchParams.set("q", query);
  url.searchParams.set("setlang", setlang);
  return url.toString();
}

export function bingSearchHeaders(): Record<string, string> {
  return {
    "User-Agent": DEFAULT_USER_AGENT,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7",
    "Cache-Control": "no-cache",
  };
}
