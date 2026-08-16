import { Editor, JSONContent } from "@tiptap/react";
import { hasValidEditorContent } from "../components/mainInput/TipTapEditor/utils/editorConfig";
import { AppDispatch } from "../redux/store";
import {
  clearMainEditorDraftContent,
  setMainEditorDraftContent,
} from "../redux/slices/sessionSlice";

export function saveMainEditorDraft(
  dispatch: AppDispatch,
  editor: Editor | null | undefined,
) {
  if (!editor || editor.isDestroyed) {
    return;
  }
  const content = editor.getJSON();
  if (hasValidEditorContent(content)) {
    dispatch(setMainEditorDraftContent(content));
  } else {
    dispatch(clearMainEditorDraftContent());
  }
}

export function restoreMainEditorDraft(
  editor: Editor | null | undefined,
  draft: JSONContent | undefined,
) {
  if (!editor || editor.isDestroyed || !draft) {
    return;
  }
  const current = editor.getJSON();
  if (!hasValidEditorContent(current)) {
    editor.commands.setContent(draft);
  }
}
