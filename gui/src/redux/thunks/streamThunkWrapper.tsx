import { createAsyncThunk } from "@reduxjs/toolkit";

import StreamErrorDialog from "../../pages/gui/StreamError";
import { analyzeError } from "../../util/errorAnalysis";
import { withStreamSession } from "../../util/sessionBackgroundCache";
import { selectChatModelForActiveSession } from "../slices/configSlice";
import { setDialogMessage, setShowDialog } from "../slices/uiSlice";
import { ThunkApiType } from "../store";
import { cancelStream } from "./cancelStream";
import { saveCurrentSession } from "./session";

const OVERLOADED_RETRIES = 3;
const OVERLOADED_DELAY_MS = 2000;

function isOverloadedErrorMessage(message?: string): boolean {
  if (!message) return false;
  const lower = message.toLowerCase();
  return lower.includes("overloaded") || lower.includes("529");
}

export type StreamThunkWrapperArg =
  | (() => Promise<void>)
  | { run: () => Promise<void>; sessionId: string };

export const streamThunkWrapper = createAsyncThunk<
  void,
  StreamThunkWrapperArg,
  ThunkApiType
>("chat/streamWrapper", async (arg, { dispatch: rawDispatch, extra }) => {
  const runStream = typeof arg === "function" ? arg : arg.run;
  const sessionId =
    typeof arg === "function"
      ? extra.getVisibleState().session.id
      : arg.sessionId;

  const { dispatch, getState } = withStreamSession(
    sessionId,
    rawDispatch,
    extra.getVisibleState,
  );

  for (let attempt = 0; attempt <= OVERLOADED_RETRIES; attempt++) {
    try {
      await runStream();
      const state = getState();
      if (!state.session.isInEdit) {
        await dispatch(
          saveCurrentSession({
            openNewSession: false,
            generateTitle: true,
            sessionId,
          }),
        );
      }
      return;
    } catch (e) {
      const state = getState();
      const selectedModel = selectChatModelForActiveSession(state);
      const { message } = analyzeError(e, selectedModel);

      const shouldRetry =
        isOverloadedErrorMessage(message) && attempt < OVERLOADED_RETRIES;

      if (shouldRetry) {
        await dispatch(cancelStream({ sessionId }));
        const delayMs = OVERLOADED_DELAY_MS * 2 ** attempt;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        await dispatch(cancelStream({ sessionId }));
      } else {
        await dispatch(cancelStream({ sessionId }));
        const visible = extra.getVisibleState();
        if (visible.session.id === sessionId) {
          dispatch(setDialogMessage(<StreamErrorDialog error={e} />));
          dispatch(setShowDialog(true));
        } else {
          console.error(
            `Background session ${sessionId} stream error:`,
            message,
            e,
          );
        }

        return;
      }
    }
  }
});
