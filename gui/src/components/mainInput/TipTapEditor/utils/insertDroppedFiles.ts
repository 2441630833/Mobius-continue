import { Editor } from "@tiptap/core";
import { IIdeMessenger } from "../../../../context/IdeMessenger";
import { ComboBoxItemType } from "../../types";
import { Mention } from "../extensions";

export interface DroppedFileInfo {
  path: string;
  title: string;
  isFolder: boolean;
}

async function isFileTooBig(
  ideMessenger: IIdeMessenger,
  filepath: string,
): Promise<[boolean, number]> {
  const contextResult = await ideMessenger.request("context/getContextItems", {
    name: "file",
    query: filepath,
    fullInput: "",
    selectedCode: [],
    isInAgentMode: false,
  });

  if (contextResult.status === "error") {
    return [false, -1];
  }

  const item = contextResult.content[0];
  const result = await ideMessenger.request("isItemTooBig", { item });

  if (result.status === "error") {
    return [false, -1];
  }

  const size = new Blob([item.content]).size;
  return [result.content, size];
}

function insertFileMention(
  editor: Editor,
  file: DroppedFileInfo,
  itemType: ComboBoxItemType,
) {
  editor
    .chain()
    .focus("end")
    .insertContent([
      {
        type: Mention.name,
        attrs: {
          title: file.title,
          label: file.title,
          itemType,
          query: file.path,
        },
      },
      { type: "text", text: " " },
    ])
    .run();
}

export async function insertDroppedFiles(
  editor: Editor,
  ideMessenger: IIdeMessenger,
  files: DroppedFileInfo[],
): Promise<void> {
  for (const file of files) {
    const itemType: ComboBoxItemType = file.isFolder ? "folder" : "file";

    if (itemType === "file") {
      const [fileExceeds, fileSize] = await isFileTooBig(
        ideMessenger,
        file.path,
      );

      if (fileExceeds) {
        void ideMessenger.ide.showToast(
          "warning",
          fileSize > 0
            ? "File exceeds model's context length"
            : "Error loading file",
          {
            modal: true,
            detail:
              fileSize > 0
                ? `'${file.title}' cannot be added because it exceeds the model's allowed context length.`
                : `'${file.title}' could not be loaded. Please check if the file exists and has the correct permissions.`,
          },
        );
        continue;
      }
    }

    insertFileMention(editor, file, itemType);
  }
}
