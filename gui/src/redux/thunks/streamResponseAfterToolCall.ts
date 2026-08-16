import { createAsyncThunk, unwrapResult } from "@reduxjs/toolkit";
import { ChatMessage } from "core";
import { renderContextItems } from "core/util/messageContent";
import { withStreamSession } from "../../util/sessionBackgroundCache";
import { selectCurrentToolCalls } from "../selectors/selectToolCalls";
import {
  ChatHistoryItemWithMessageId,
  resetNextCodeBlockToApplyIndex,
  streamUpdate,
} from "../slices/sessionSlice";
import { ThunkApiType } from "../store";
import { streamNormalInput } from "./streamNormalInput";
import { streamThunkWrapper } from "./streamThunkWrapper";

/**
 * Determines if we should continue streaming based on tool call completion status.
 */
function areAllToolsDoneStreaming(
  assistantMessage: ChatHistoryItemWithMessageId,
  continueAfterToolRejection: boolean | undefined,
): boolean {
  if (!assistantMessage.toolCallStates) {
    return true;
  }

  const completedToolCalls = assistantMessage.toolCallStates.filter(
    (tc) =>
      tc.status === "done" ||
      tc.status === "errored" ||
      (continueAfterToolRejection && tc.status === "canceled"),
  );

  return completedToolCalls.length === assistantMessage.toolCallStates.length;
}

export const streamResponseAfterToolCall = createAsyncThunk<
  void,
  { toolCallId: string; depth?: number; sessionId?: string },
  ThunkApiType
>(
  "chat/streamAfterToolCall",
  async (
    { toolCallId, depth = 0, sessionId: passedSessionId },
    { dispatch: rawDispatch, extra },
  ) => {
    const sessionId = passedSessionId ?? extra.getVisibleState().session.id;
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
          const currentToolCalls = selectCurrentToolCalls(state);
          const toolCallState = currentToolCalls.find(
            (tc) => tc.toolCallId === toolCallId,
          );

          if (!toolCallState) {
            return;
          }

          const toolOutput = toolCallState.output ?? [];

          dispatch(resetNextCodeBlockToApplyIndex());

          const newMessage: ChatMessage = {
            role: "tool",
            content: renderContextItems(toolOutput),
            toolCallId,
          };
          dispatch(streamUpdate([newMessage]));

          const history = getState().session.history;
          const assistantMessage = history.findLast(
            (item) =>
              item.message.role === "assistant" &&
              item.toolCallStates?.some((tc) => tc.toolCallId === toolCallId),
          );

          if (
            assistantMessage &&
            areAllToolsDoneStreaming(
              assistantMessage,
              state.config.config.ui?.continueAfterToolRejection,
            )
          ) {
            unwrapResult(
              await dispatch(
                streamNormalInput({ depth: depth + 1, sessionId }),
              ),
            );
          }
        },
      }),
    );
  },
);
