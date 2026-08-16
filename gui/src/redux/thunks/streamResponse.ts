import { createAsyncThunk, unwrapResult } from "@reduxjs/toolkit";
import { JSONContent } from "@tiptap/core";
import { InputModifiers } from "core";

import { v4 as uuidv4 } from "uuid";
import { resolveEditorContent } from "../../components/mainInput/TipTapEditor/utils/resolveEditorContent";
import { withStreamSession } from "../../util/sessionBackgroundCache";
import { selectChatModelForActiveSession } from "../slices/configSlice";
import {
  resetNextCodeBlockToApplyIndex,
  setChatModelTitle,
  submitEditorAndInitAtIndex,
  updateHistoryItemAtIndex,
} from "../slices/sessionSlice";
import { ThunkApiType } from "../store";
import { streamNormalInput } from "./streamNormalInput";
import { streamThunkWrapper } from "./streamThunkWrapper";
import { updateFileSymbolsFromFiles } from "./updateFileSymbols";

export const streamResponseThunk = createAsyncThunk<
  void,
  {
    editorState: JSONContent;
    modifiers: InputModifiers;
    index?: number;
  },
  ThunkApiType
>(
  "chat/streamResponse",
  async (
    { editorState, modifiers, index },
    { dispatch: rawDispatch, extra },
  ) => {
    // Always bind to the *visible* tab — never inherit a background stream's context.
    const visible = extra.getVisibleState();
    const sessionId = visible.session.id;
    const { dispatch, getState } = withStreamSession(
      sessionId,
      rawDispatch,
      extra.getVisibleState,
    );

    await dispatch(
      streamThunkWrapper({
        sessionId,
        run: async () => {
          const state = getState();
          const selectedChatModel = selectChatModelForActiveSession(state);
          const inputIndex = index ?? state.session.history.length;

          if (!selectedChatModel) {
            throw new Error("No chat model selected");
          }
          // Bind the provider used for this send to the chat tab.
          if (!state.session.chatModelTitle && selectedChatModel.title) {
            dispatch(setChatModelTitle(selectedChatModel.title));
          }
          dispatch(
            submitEditorAndInitAtIndex({ index: inputIndex, editorState }),
          );

          dispatch(resetNextCodeBlockToApplyIndex());

          const defaultContextProviders =
            state.config.config.experimental?.defaultContext ?? [];

          const {
            selectedContextItems,
            selectedCode,
            content,
            legacyCommandWithInput,
          } = await resolveEditorContent({
            editorState,
            modifiers,
            ideMessenger: extra.ideMessenger,
            defaultContextProviders,
            availableSlashCommands: state.config.config.slashCommands,
            dispatch: dispatch as any,
            getState: getState as any,
          });

          const filesForSymbols = [
            ...selectedContextItems
              .filter((item) => item.uri?.type === "file" && item?.uri?.value)
              .map((item) => item.uri!.value),
            ...selectedCode.map((rif) => rif.filepath),
          ];
          void dispatch(updateFileSymbolsFromFiles(filesForSymbols));

          dispatch(
            updateHistoryItemAtIndex({
              index: inputIndex,
              updates: {
                message: {
                  role: "user",
                  content,
                  id: uuidv4(),
                },
                contextItems: selectedContextItems,
              },
            }),
          );

          unwrapResult(
            await dispatch(
              streamNormalInput({
                sessionId,
                legacySlashCommandData: legacyCommandWithInput
                  ? {
                      command: legacyCommandWithInput.command,
                      contextItems: selectedContextItems,
                      historyIndex: inputIndex,
                      input: legacyCommandWithInput.input,
                      selectedCode,
                    }
                  : undefined,
              }),
            ),
          );
        },
      }),
    );
  },
);
