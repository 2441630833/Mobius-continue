import { createAsyncThunk, unwrapResult } from "@reduxjs/toolkit";
import { BaseSessionMetadata, ChatMessage, Session } from "core";
import { NEW_SESSION_TITLE } from "core/util/constants";
import { renderChatMessage } from "core/util/messageContent";
import { isLowQualitySessionTitle, sanitizeSessionTitle } from "core/util/text";
import { IIdeMessenger } from "../../context/IdeMessenger";
import {
  selectChatModelForActiveSession,
  selectSelectedChatModel,
} from "../slices/configSlice";
import { selectSelectedProfile } from "../slices/profilesSlice";
import {
  deleteSessionMetadata,
  newSession,
  setAllSessionMetadata,
  setChatModelTitle,
  setIsSessionMetadataLoading,
  updateSessionMetadata,
} from "../slices/sessionSlice";
import { getBackgroundSession } from "../../util/sessionBackgroundCache";
import {
  AppDispatch,
  RootState,
  ThunkApiType,
  ThunkExtrasType,
} from "../store";
import { updateSelectedModelByRole } from "../thunks/updateSelectedModelByRole";

const MAX_TITLE_LENGTH = 100;

/** After "New Session", a delayed boot restore must not reload the previous chat. */
export function shouldSkipBootSessionRestore(
  getState: () => {
    session: { id: string; history: unknown[]; lastSessionId?: string };
  },
  requestedSessionId: string,
): boolean {
  const { id, history, lastSessionId } = getState().session;
  return (
    history.length === 0 &&
    id !== requestedSessionId &&
    lastSessionId === requestedSessionId
  );
}

// Async session functions live in thunks (because of IDE messaging mostly)
// see sessionSlice for sync redux session functions

export async function getSession(
  ideMessenger: IIdeMessenger,
  id: string,
): Promise<Session> {
  const result = await ideMessenger.request("history/load", { id });
  if (result.status === "error") {
    throw new Error(result.error);
  }
  return result.content;
}

export const refreshSessionMetadata = createAsyncThunk<
  BaseSessionMetadata[],
  {
    offset?: number;
    limit?: number;
  },
  ThunkApiType
>("session/refreshMetadata", async ({ offset, limit }, { dispatch, extra }) => {
  const result = await extra.ideMessenger.request("history/list", {
    limit,
    offset,
  });
  if (result.status === "error") {
    throw new Error(result.error);
  }
  dispatch(setIsSessionMetadataLoading(false));
  dispatch(setAllSessionMetadata(result.content));
  return result.content;
});

export const deleteSession = createAsyncThunk<void, string, ThunkApiType>(
  "session/delete",
  async (id, { getState, dispatch, extra }) => {
    dispatch(deleteSessionMetadata(id)); // optimistic
    const state = getState();
    if (id === state.session.id) {
      await dispatch(loadLastSession());
    }
    const result = await extra.ideMessenger.request("history/delete", { id });
    if (result.status === "error") {
      throw new Error(result.error);
    }
    void dispatch(refreshSessionMetadata({}));
  },
);

export const updateSession = createAsyncThunk<void, Session, ThunkApiType>(
  "session/update",
  async (session, { extra, dispatch }) => {
    dispatch(
      updateSessionMetadata({
        sessionId: session.sessionId,
        title: session.title,
      }),
    ); // optimistic session metadata update
    await extra.ideMessenger.request("history/save", session);
    await dispatch(refreshSessionMetadata({}));
  },
);

/*
 this is only used for the custom focusContinueSessionId command at the moment
*/
export const loadSession = createAsyncThunk<
  void,
  {
    sessionId: string;
    saveCurrentSession: boolean;
    /** True only for the one-time startup restore in ParallelListeners */
    bootRestore?: boolean;
  },
  ThunkApiType
>(
  "session/load",
  async (
    { sessionId, saveCurrentSession: save, bootRestore = false },
    { extra, dispatch, getState },
  ) => {
    if (bootRestore && shouldSkipBootSessionRestore(getState, sessionId)) {
      return;
    }

    if (save) {
      // save the session in the background
      void dispatch(
        saveCurrentSession({
          openNewSession: false,
          generateTitle: true,
        }),
      );
    }
    const session = await getSession(extra.ideMessenger, sessionId);

    if (bootRestore && shouldSkipBootSessionRestore(getState, sessionId)) {
      return;
    }

    dispatch(newSession(session));

    // Restore selected chat model from session, if present
    if (session.chatModelTitle) {
      void dispatch(selectChatModelForProfile(session.chatModelTitle));
    }
  },
);

export const selectChatModelForProfile = createAsyncThunk<
  void,
  string,
  ThunkApiType
>(
  "session/selectModelForCurrentProfile",
  async (modelTitle, { dispatch, getState }) => {
    const state = getState();
    const modelMatch = state.config.config?.modelsByRole?.chat?.find(
      (m) => m.title === modelTitle || m.model === modelTitle,
    );
    dispatch(setChatModelTitle(modelTitle));
    const selectedProfile = selectSelectedProfile(state);
    if (selectedProfile && modelMatch) {
      const roles = ["chat", "edit", "apply", "autocomplete"] as const;
      for (const role of roles) {
        await dispatch(
          updateSelectedModelByRole({
            role,
            modelTitle: modelTitle,
            selectedProfile,
          }),
        );
      }
    }
  },
);

export const loadLastSession = createAsyncThunk<void, void, ThunkApiType>(
  "session/loadLast",
  async (_, { extra, dispatch, getState }) => {
    let lastSessionId = getState().session.lastSessionId;

    // const lastSessionResult = await extra.ideMessenger.request("history/list", {
    //   limit: 1,
    // });
    // if (lastSessionResult.status === "success") {
    //   lastSessionId = lastSessionResult.content.at(0)?.sessionId;
    // }

    if (!lastSessionId) {
      dispatch(newSession());
      return;
    }

    let session: Session;
    try {
      session = await getSession(extra.ideMessenger, lastSessionId);
    } catch {
      // retry again after 1 sec
      await new Promise((resolve) => setTimeout(resolve, 1000));
      session = await getSession(extra.ideMessenger, lastSessionId);
    }
    dispatch(newSession(session));
    if (session.chatModelTitle) {
      dispatch(selectChatModelForProfile(session.chatModelTitle));
    }
  },
);

function getChatTitleFromMessage(message: ChatMessage) {
  const firstLine =
    renderChatMessage(message)
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? "";

  return sanitizeSessionTitle(firstLine, MAX_TITLE_LENGTH);
}

function getTitleFromUserHistory(
  history: RootState["session"]["history"],
): string {
  const userMessage = history.find(
    (item) => item.message.role === "user",
  )?.message;
  if (!userMessage) {
    return "";
  }
  return getChatTitleFromMessage(userMessage);
}

async function persistSession(
  session: RootState["session"],
  generateTitle: boolean,
  dispatch: AppDispatch,
  extra: ThunkExtrasType,
  getState: () => RootState,
) {
  const rootState = getState();
  const selectedChatModel =
    selectChatModelForActiveSession({
      session,
      config: rootState.config,
    }) ?? selectSelectedChatModel(rootState);

  // Save previous session and update chat title if relevant
  let title = session.title;
  if (title === NEW_SESSION_TITLE) {
    const userTitle = getTitleFromUserHistory(session.history);

    if (!getState().config.config?.disableSessionTitles && selectedChatModel) {
      let assistantResponse = session.history
        ?.filter((h) => h.message.role === "assistant")[0]
        ?.message?.content?.toString();

      if (assistantResponse && generateTitle) {
        try {
          const result = await extra.ideMessenger.request(
            "chatDescriber/describe",
            {
              text: assistantResponse,
            },
          );
          if (result.status === "success" && result.content) {
            const cleaned = sanitizeSessionTitle(
              result.content,
              MAX_TITLE_LENGTH,
            );
            if (cleaned && !isLowQualitySessionTitle(cleaned)) {
              title = cleaned;
            }
          }
        } catch (e) {
          console.error("Error generating chat title", e);
        }
      }
    }
    // Prefer the user's first message when LLM title is missing or low quality.
    if (title === NEW_SESSION_TITLE && userTitle) {
      title = userTitle;
    }
  } else {
    title = sanitizeSessionTitle(title, MAX_TITLE_LENGTH) || NEW_SESSION_TITLE;
  }
  // More fallbacks in case of no title
  if (!title.length) {
    const metadata = session.allSessionMetadata.find(
      (m) => m.sessionId === session.id,
    );
    if (metadata?.title) {
      title = metadata.title;
    }
  }
  if (!title.length) {
    title = NEW_SESSION_TITLE;
  }

  const updatedSession: Session = {
    sessionId: session.id,
    title,
    workspaceDirectory: window.workspacePaths?.[0] || "",
    history: session.history,
    mode: session.mode,
    chatModelTitle: session.chatModelTitle ?? selectedChatModel?.title ?? null,
  };

  const result = await dispatch(updateSession(updatedSession));
  unwrapResult(result);
}

export const saveCurrentSession = createAsyncThunk<
  void,
  { openNewSession: boolean; generateTitle: boolean; sessionId?: string },
  ThunkApiType
>(
  "session/saveCurrent",
  async (
    { openNewSession, generateTitle, sessionId },
    { dispatch, extra, getState },
  ) => {
    const visible = extra.getVisibleState?.() ?? getState();
    let session = visible.session;
    if (sessionId && session.id !== sessionId) {
      const bg = getBackgroundSession(sessionId);
      if (bg) {
        session = bg as typeof session;
      }
    }

    // Capture before newSession so persistence still has the previous chat
    if (session.history.length === 0) {
      if (openNewSession) {
        dispatch(newSession());
      }
      return;
    }

    if (openNewSession) {
      // Switch UI immediately; LLM title + disk save must not block the empty chat
      dispatch(newSession());
      void persistSession(
        session,
        generateTitle,
        dispatch,
        extra,
        getState,
      ).catch((e) => {
        console.error("Error saving previous session in background", e);
      });
      return;
    }

    await persistSession(session, generateTitle, dispatch, extra, getState);
  },
);
