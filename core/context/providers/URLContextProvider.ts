import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import { NodeHtmlMarkdown } from "node-html-markdown";

import { BaseContextProvider } from "../";
import {
  ContextItem,
  ContextProviderDescription,
  ContextProviderExtras,
  FetchFunction,
} from "../../index.js";
import { fetchFavicon } from "../../util/fetchFavicon";

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const BODY_TEXT_FALLBACK_LIMIT = 20000;

class URLContextProvider extends BaseContextProvider {
  static description: ContextProviderDescription = {
    title: "url",
    displayTitle: "URL",
    description: "Reference a webpage at a given URL",
    type: "query",
  };

  async getContextItems(
    query: string,
    extras: ContextProviderExtras,
  ): Promise<ContextItem[]> {
    return await getUrlContextItems(query, extras.fetch);
  }
}

export default URLContextProvider;

function urlFetchHeaders(): Record<string, string> {
  return {
    "User-Agent": DEFAULT_USER_AGENT,
    Accept: "text/html,application/xhtml+xml",
    "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7",
  };
}

export function normalizeUrlInput(input: string): URL {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("URL is empty.");
  }
  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  return new URL(withScheme);
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function htmlToMarkdown(html: string): { title: string; markdown: string } {
  const dom = new JSDOM(html);
  const document = dom.window.document;
  const article = new Readability(document).parse();
  const readableHtml = article?.content ?? "";
  let markdown = readableHtml
    ? NodeHtmlMarkdown.translate(readableHtml, {}, undefined, undefined)
    : "";

  if (!markdown.trim()) {
    markdown = collapseWhitespace(document.body?.textContent ?? "").slice(
      0,
      BODY_TEXT_FALLBACK_LIMIT,
    );
  }

  const title =
    article?.title?.trim() ||
    document.title?.trim() ||
    document.querySelector("h1")?.textContent?.trim() ||
    "";

  return { title, markdown };
}

export async function getUrlContextItems(
  query: string,
  fetchFn: FetchFunction,
): Promise<ContextItem[]> {
  const url = normalizeUrlInput(query);
  const icon = await fetchFavicon(url);
  const resp = await fetchFn(url.toString(), {
    method: "GET",
    headers: urlFetchHeaders(),
  });

  if (!resp.ok) {
    throw new Error(
      `HTTP ${resp.status} ${resp.statusText} fetching ${url.toString()}`,
    );
  }

  const html = await resp.text();
  const { title, markdown } = htmlToMarkdown(html);

  if (!markdown.trim()) {
    throw new Error(
      `No readable text extracted from ${url.toString()}. The page may require JavaScript or block automated access.`,
    );
  }

  return [
    {
      icon,
      description: url.toString(),
      content: markdown,
      name: title || url.pathname,
      uri: {
        type: "url",
        value: url.toString(),
      },
    },
  ];
}
