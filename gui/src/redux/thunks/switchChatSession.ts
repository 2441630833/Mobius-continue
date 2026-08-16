import { createAsyncThunk } from "@reduxjs/toolkit";
import {
  abortBackgroundSession,
  hasBackgroundSession,
  parkSession,
  takeBackgroundSession,
} from "../../util/sessionBackgroundCache";
import { generateChatTabId, NEW_AGENT_TAB_TITLE } from "../../util/newChatTab";
import { selectChatModelForActiveSession } from "../slices/configSlice";
import {
  replaceSession,
  setChatModelTitle,
  type SessionState,
} from "../slices/sessionSlice";
import { addTab, setActiveTab } from "../slices/tabsSlice";
import { AppDispatch, ThunkApiType } from "../store";
import {
  getSession,
  saveCurrentSession,
  selectChatModelForProfile,
} from "./session";

function stampChatModelTitle(
  session: SessionState,
  modelTitle?: string | null,
) {
  return {
    ...session,
    chatModelTitle: session.chatModelTitle ?? modelTitle ?? null,
  };
}

async function restoreChatModel(
  dispatch: AppDispatch,
  chatModelTitle?: string | null,
) {
  if (chatModelTitle) {
    dispatch(setChatModelTitle(chatModelTitle));
    await dispatch(selectChatModelForProfile(chatModelTitle));
  }
}

/**
 * Switch the visible chat tab without aborting a running agent on the previous tab.
 * Running sessions are parked in a module-level cache and keep receiving stream updates.
 * Each chat keeps its own AI provider/model via session.chatModelTitle.
 */
export const switchChatSession = createAsyncThunk<
  void,
  { tabId: string; sessionId?: string },
  ThunkApiType
>(
  "session/switchChat",
  async ({ tabId, sessionId }, { dispatch, getState, extra }) => {
    const state = getState();
    const current = state.session;
    const currentModelTitle =
      current.chatModelTitle ??
      selectChatModelForActiveSession(state)?.title ??
      null;

    if (sessionId && sessionId === current.id) {
      if (!current.chatModelTitle && currentModelTitle) {
        dispatch(setChatModelTitle(currentModelTitle));
      }
      dispatch(setActiveTab(tabId));
      return;
    }

    // Park the current visible session (keeps AbortController alive if streaming).
    parkSession(stampChatModelTitle(current, currentModelTitle));

    // Optionally persist a non-streaming session in the background.
    if (!current.isStreaming && current.history.length > 0) {
      void dispatch(
        saveCurrentSession({ openNewSession: false, generateTitle: true }),
      );
    }

    if (!sessionId) {
      dispatch(replaceSession(undefined));
      // New empty tab starts with the previously visible chat's provider.
      if (currentModelTitle) {
        dispatch(setChatModelTitle(currentModelTitle));
        void dispatch(selectChatModelForProfile(currentModelTitle));
      }
      dispatch(setActiveTab(tabId));
      return;
    }

    const parked = takeBackgroundSession(sessionId);
    if (parked) {
      dispatch(replaceSession(parked as SessionState));
      await restoreChatModel(
        dispatch,
        (parked as SessionState).chatModelTitle ?? null,
      );
      dispatch(setActiveTab(tabId));
      return;
    }

    // Not in cache — load from disk without aborting parked streams.
    const session = await getSession(extra.ideMessenger, sessionId);
    dispatch(replaceSession(session));
    await restoreChatModel(dispatch, session.chatModelTitle);
    dispatch(setActiveTab(tabId));
  },
);

/**
 * Save/park the current chat and open a fresh tab without aborting a running agent.
 */
export const openNewChatTab = createAsyncThunk<void, void, ThunkApiType>(
  "session/openNewChatTab",
  async (_, { dispatch, getState }) => {
    const state = getState();
    const session = state.session;
    const currentModelTitle =
      session.chatModelTitle ??
      selectChatModelForActiveSession(state)?.title ??
      null;

    parkSession(stampChatModelTitle(session, currentModelTitle));

    if (!session.isStreaming && session.history.length > 0) {
      void dispatch(
        saveCurrentSession({ openNewSession: false, generateTitle: true }),
      );
    }

    dispatch(replaceSession(undefined));
    // Seed the new chat with the current provider so the picker stays stable,
    // while still allowing this tab to diverge later.
    if (currentModelTitle) {
      dispatch(setChatModelTitle(currentModelTitle));
    }
    dispatch(
      addTab({
        id: generateChatTabId(),
        title: NEW_AGENT_TAB_TITLE,
        isActive: true,
        sessionId: undefined,
      }),
    );
  },
);

/**
 * Abort a background session stream when its tab is closed.
 */
export const abortSessionIfBackground = createAsyncThunk<
  void,
  string,
  ThunkApiType
>("session/abortIfBackground", async (sessionId, { getState }) => {
  const state = getState();
  if (state.session.id === sessionId && state.session.isStreaming) {
    // Active — caller should use cancelStream.
    return;
  }
  if (hasBackgroundSession(sessionId)) {
    abortBackgroundSession(sessionId);
  }
});
