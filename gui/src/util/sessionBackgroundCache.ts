import type { UnknownAction } from "@reduxjs/toolkit";

/**
 * Module-level cache so a chat stream can keep running after the user switches tabs.
 * Redux `session` always reflects the *visible* tab; parked sessions live here.
 *
 * IMPORTANT: This file must NOT import sessionSlice or store at module top-level —
 * that creates a circular dependency and crashes the GUI bundle at startup
 * ("Cannot access before initialization").
 *
 * Concurrency model:
 * - Multiple agents may stream at once.
 * - `streamSessionStack` is ONLY pushed around synchronous `dispatch` calls
 *   (see `withStreamSession`), never around `await`s — so concurrent streams
 *   do not steal each other's session context.
 */

/** Minimal parked-session shape (compatible with SessionState). */
export type ParkedSession = {
  id: string;
  isStreaming: boolean;
  streamAborter: AbortController;
  history: unknown[];
  title: string;
  [key: string]: unknown;
};

type SessionReducer = (
  state: ParkedSession | undefined,
  action: UnknownAction,
) => ParkedSession;

let sessionReducer: SessionReducer | null = null;

/** Called once from store.ts after sessionSlice is fully initialized. */
export function bindSessionReducer(reducer: SessionReducer): void {
  sessionReducer = reducer;
}

const backgroundSessions = new Map<string, ParkedSession>();

/**
 * Session id bound to the *current synchronous dispatch* only.
 * Must not span awaits — concurrent streams would corrupt each other.
 */
const streamSessionStack: string[] = [];

type StreamingListener = (sessionId: string, isStreaming: boolean) => void;
const streamingListeners = new Set<StreamingListener>();

export function subscribeStreamingStatus(
  listener: StreamingListener,
): () => void {
  streamingListeners.add(listener);
  return () => {
    streamingListeners.delete(listener);
  };
}

function notifyStreaming(sessionId: string, isStreaming: boolean): void {
  for (const listener of streamingListeners) {
    try {
      listener(sessionId, isStreaming);
    } catch (e) {
      console.error("streaming status listener error", e);
    }
  }
}

export function getCurrentStreamSessionId(): string | undefined {
  return streamSessionStack[streamSessionStack.length - 1];
}

type AnyState = {
  session: ParkedSession | { id: string; [key: string]: unknown };
  [key: string]: unknown;
};

/** Resolve Redux-shaped state for a specific session (visible or parked). */
export function resolveStateForSession<S extends AnyState>(
  sessionId: string,
  visibleState: S,
): S {
  if (visibleState.session.id === sessionId) {
    return visibleState;
  }
  const bg = backgroundSessions.get(sessionId);
  if (bg) {
    return { ...visibleState, session: bg } as S;
  }
  return visibleState;
}

/**
 * Bind dispatch/getState to a session so concurrent agents stay isolated.
 * Dispatch tags the session only for the synchronous middleware hop.
 */
export function withStreamSession<
  S extends AnyState,
  D extends (action: any) => any,
>(
  sessionId: string,
  dispatch: D,
  getVisibleState: () => S,
): {
  dispatch: D;
  getState: () => S;
} {
  const wrappedDispatch = ((action: any) => {
    streamSessionStack.push(sessionId);
    try {
      return dispatch(action);
    } finally {
      streamSessionStack.pop();
    }
  }) as D;

  return {
    dispatch: wrappedDispatch,
    getState: () => resolveStateForSession(sessionId, getVisibleState()),
  };
}

export function parkSession(session: ParkedSession): void {
  // Keep the same AbortController reference so an in-flight stream stays alive.
  backgroundSessions.set(session.id, session);
  notifyStreaming(session.id, session.isStreaming);
}

export function getBackgroundSession(
  sessionId: string,
): ParkedSession | undefined {
  return backgroundSessions.get(sessionId);
}

export function takeBackgroundSession(
  sessionId: string,
): ParkedSession | undefined {
  const session = backgroundSessions.get(sessionId);
  if (session) {
    backgroundSessions.delete(sessionId);
  }
  return session;
}

export function hasBackgroundSession(sessionId: string): boolean {
  return backgroundSessions.has(sessionId);
}

export function abortBackgroundSession(sessionId: string): void {
  const session = backgroundSessions.get(sessionId);
  if (!session) {
    return;
  }
  try {
    session.streamAborter.abort();
  } catch {
    // ignore
  }
  session.isStreaming = false;
  session.streamAborter = new AbortController();
  backgroundSessions.set(sessionId, session);
  notifyStreaming(sessionId, false);
}

export function applyActionToBackgroundSession(
  sessionId: string,
  action: UnknownAction,
): ParkedSession | undefined {
  const current = backgroundSessions.get(sessionId);
  if (!current || !sessionReducer) {
    return undefined;
  }
  const next = sessionReducer(current, action);
  backgroundSessions.set(sessionId, next);

  if (typeof action.type === "string") {
    if (action.type === "session/setActive") {
      notifyStreaming(sessionId, true);
    } else if (
      action.type === "session/setInactive" ||
      action.type === "session/abortStream" ||
      action.type === "session/newSession" ||
      action.type === "session/replaceSession"
    ) {
      notifyStreaming(sessionId, next.isStreaming);
    }
  }

  return next;
}

export function isSessionSliceAction(action: UnknownAction): boolean {
  return typeof action.type === "string" && action.type.startsWith("session/");
}

/** Actions that intentionally replace the visible session — never redirect to cache. */
const ACTIVE_SESSION_SWAP_ACTIONS = new Set([
  "session/newSession",
  "session/replaceSession",
]);

export function shouldRedirectSessionActionToBackground(
  action: UnknownAction,
  activeSessionId: string,
): boolean {
  const streamId = getCurrentStreamSessionId();
  if (!streamId || streamId === activeSessionId) {
    return false;
  }
  if (!isSessionSliceAction(action)) {
    return false;
  }
  if (ACTIVE_SESSION_SWAP_ACTIONS.has(action.type as string)) {
    return false;
  }
  return backgroundSessions.has(streamId);
}
