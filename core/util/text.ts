export const capitalizeFirstLetter = (val: string) => {
  if (val.length === 0) {
    return "";
  }
  return val[0].toUpperCase() + val.slice(1);
};

const DEFAULT_SESSION_TITLE_MAX = 48;

/** Strip markdown/list noise so tab titles stay readable. */
export function sanitizeSessionTitle(
  raw: string,
  maxLength = DEFAULT_SESSION_TITLE_MAX,
): string {
  let title = raw.trim();
  if (!title) {
    return "";
  }

  // Use the first meaningful line only.
  title =
    title
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? "";

  // Markdown emphasis / headings
  title = title.replace(/\*\*([^*]+)\*\*/g, "$1");
  title = title.replace(/\*([^*]+)\*/g, "$1");
  title = title.replace(/__([^_]+)__/g, "$1");
  title = title.replace(/_([^_]+)_/g, "$1");
  title = title.replace(/^#+\s*/, "");

  // Ordered / bullet list prefixes (e.g. "1. Analyze the request")
  title = title.replace(/^\d+[\.\)]\s+/, "");
  title = title.replace(/^[-*•]\s+/, "");

  title = title.replace(/\s+/g, " ").trim();

  if (title.length > maxLength) {
    return title.slice(0, maxLength - 3) + "...";
  }
  return title;
}

/** Detect titles that look like raw assistant markdown instead of a summary. */
export function isLowQualitySessionTitle(title: string): boolean {
  const trimmed = title.trim();
  if (!trimmed || trimmed.length < 2) {
    return true;
  }
  if (/^\d+[\.\)]\s/.test(trimmed)) {
    return true;
  }
  if (/^[-*•]\s/.test(trimmed)) {
    return true;
  }
  if (/\*\*|__/.test(trimmed)) {
    return true;
  }
  if (/^#+\s/.test(trimmed)) {
    return true;
  }
  return false;
}

export function replaceEscapedCharacters(str: string): string {
  return str.replaceAll(/\\(n|t|r|\\|"|')/g, (match, p1) => {
    switch (p1) {
      case "n":
        return "\n";
      case "t":
        return "\t";
      case "r":
        return "\r";
      case "\\":
        return "\\";
      case '"':
        return '"';
      case "'":
        return "'";
      default:
        return match; // NOTE: Handle unexpected escapes better than this.
    }
  });
}

export function escapeForSVG(text: string): string {
  return text
    .replace(/&/g, "&amp;") // must be first
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    .replace(/\n/g, "\\n") // newlines
    .replace(/\t/g, "\\t") // tabs
    .replace(/\r/g, "\\r"); // carriage returns
}

export function kebabOfStr(str: string): string {
  return str
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2") // handle camelCase, PascalCase, and numbers followed by uppercase
    .replace(/[\s_]+/g, "-") // replace spaces and underscores with hyphens
    .toLowerCase();
}

export function kebabOfThemeStr(str: string): string {
  return str
    .toLowerCase()
    .replace(/[\s_]+/g, "-") // replace spaces and underscores with hyphens
    .replace(/\(|\)/g, ""); // remove parentheses
}
