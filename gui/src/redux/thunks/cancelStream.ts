import { createAsyncThunk } from "@reduxjs/toolkit";
import { withStreamSession } from "../../util/sessionBackgroundCache";
import {
  abortStream,
  clearDanglingMessages,
  setInactive,
} from "../slices/sessionSlice";
import { ThunkApiType } from "../store";

export const cancelStream = createAsyncThunk<
  void,
  { sessionId?: string } | undefined,
  ThunkApiType
>("chat/cancelStream", async (arg, { dispatch: rawDispatch, extra }) => {
  const sessionId = arg?.sessionId ?? extra.getVisibleState().session.id;
  const { dispatch } = withStreamSession(
    sessionId,
    rawDispatch,
    extra.getVisibleState,
  );

  dispatch(setInactive());
  dispatch(abortStream());

  // Clear any dangling incomplete tool calls, thinking messages, etc.
  dispatch(clearDanglingMessages());
});
