import { describe, expect, test } from "vitest";
import { parseBingHtml } from "./bingSearch";

const SAMPLE_HTML = `
<!DOCTYPE html>
<html>
<body>
  <ol id="b_results">
    <li class="b_algo" data-id="1">
      <h2><a href="https://ollama.com/">Ollama</a></h2>
      <div class="b_caption">
        <p class="b_lineclamp2">Run open models locally with Ollama.</p>
      </div>
    </li>
    <li class="b_algo" data-id="2">
      <h2 class=""><a target="_blank" href="https://ollama.com/library">Ollama Library</a></h2>
      <div class="b_caption">
        <p class="b_lineclamp3">Browse vision and VLM models&ensp;&#0183;&ensp;updated weekly.</p>
      </div>
    </li>
    <li class="b_algo">
      <div>no h2 link</div>
    </li>
  </ol>
</body>
</html>
`;

describe("parseBingHtml", () => {
  test("extracts organic results with titles urls and snippets", () => {
    const results = parseBingHtml(SAMPLE_HTML);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      title: "Ollama",
      url: "https://ollama.com/",
      snippet: "Run open models locally with Ollama.",
    });
    expect(results[1].title).toBe("Ollama Library");
    expect(results[1].url).toBe("https://ollama.com/library");
    expect(results[1].snippet).toContain("vision and VLM models");
    expect(results[1].snippet).toContain("updated weekly");
  });

  test("returns empty array for empty html", () => {
    expect(parseBingHtml("")).toEqual([]);
    expect(parseBingHtml("<html><body>no results</body></html>")).toEqual([]);
  });
});
