import { getMarkdownLanguageTagForFile } from "core/util";
import StyledMarkdownPreview from "../../../components/StyledMarkdownPreview";

interface CreateFileToolCallProps {
  relativeFilepath: string;
  fileContents: unknown;
  historyIndex: number;
}

function normalizeFileContents(contents: unknown): string {
  if (contents == null) {
    return "";
  }
  if (typeof contents === "string") {
    return contents;
  }
  if (typeof contents === "object") {
    try {
      return JSON.stringify(contents, null, 2);
    } catch {
      return String(contents);
    }
  }
  return String(contents);
}

export function CreateFile(props: CreateFileToolCallProps) {
  const fileContents = normalizeFileContents(props.fileContents);
  if (!fileContents) {
    return null;
  }

  const src = `\`\`\`${getMarkdownLanguageTagForFile(props.relativeFilepath ?? "output.txt")} ${props.relativeFilepath}\n${fileContents}\n\`\`\``;

  return props.relativeFilepath ? (
    <StyledMarkdownPreview
      isRenderingInStepContainer
      disableManualApply
      source={src}
      itemIndex={props.historyIndex}
    />
  ) : null;
}
