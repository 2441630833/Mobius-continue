import {
  combineReducers,
  configureStore,
  Middleware,
  ThunkDispatch,
  UnknownAction,
} from "@reduxjs/toolkit";
import {
  createMigrate,
  MigrationManifest,
  persistReducer,
  persistStore,
} from "redux-persist";
import { createFilter } from "redux-persist-transform-filter";
import autoMergeLevel2 from "redux-persist/lib/stateReconciler/autoMergeLevel2";
import storage from "redux-persist/lib/storage";
import { IdeMessenger, IIdeMessenger } from "../context/IdeMessenger";
import {
  applyActionToBackgroundSession,
  bindSessionReducer,
  getBackgroundSession,
  getCurrentStreamSessionId,
  shouldRedirectSessionActionToBackground,
  subscribeStreamingStatus,
} from "../util/sessionBackgroundCache";
import configReducer from "./slices/configSlice";
import editModeStateReducer from "./slices/editState";
import indexingReducer from "./slices/indexingSlice";
import { profilesReducer } from "./slices/profilesSlice";
import sessionReducer from "./slices/sessionSlice";
import tabsReducer, { setSessionStreaming } from "./slices/tabsSlice";
import uiReducer from "./slices/uiSlice";

// Bind after sessionSlice has finished initializing (breaks circular import).
bindSessionReducer(sessionReducer as any);

const rootReducer = combineReducers({
  session: sessionReducer,
  ui: uiReducer,
  editModeState: editModeStateReducer,
  config: configReducer,
  indexing: indexingReducer,
  tabs: tabsReducer,
  profiles: profilesReducer,
});

const saveSubsetFilters = [
  createFilter("session", [
    "id",
    "lastSessionId",
    "title",

    // Persist edit mode in case closes in middle
    "mode",

    // Per-chat AI provider/model binding
    "chatModelTitle",

    // higher risk to persist
    // codeBlockApplyStates
    // symbols
  ]),
  createFilter("editModeState", [
    "returnToMode",
    "lastNonEditSessionWasEmpty",
    "codeToEdit",
  ]),
  createFilter("config", []),
  createFilter("ui", [
    "toolSettings",
    "toolGroupSettings",
    "ruleSettings",
    "reasoningSettings",
  ]),
  createFilter("indexing", []),
  createFilter("tabs", ["tabs"]),
  createFilter("profiles", ["preferencesByProfileId", "selectedProfileId"]),
];

const migrations: MigrationManifest = {
  "0": (state) => {
    const oldState = state as any;

    return {
      config: {
        defaultModelTitle: oldState?.state?.defaultModelTitle ?? undefined,
      },
      session: {
        id: oldState?.state?.sessionId ?? "",
      },
      tabs: {
        tabs: [
          {
            id:
              Date.now().toString(36) + Math.random().toString(36).substring(2),
            title: "Chat 1",
            isActive: true,
          },
        ],
      },
      _persist: oldState?._persist,
    };
  },
};

const persistConfig = {
  version: 1,
  key: "root",
  storage,
  transforms: [...saveSubsetFilters],
  stateReconciler: autoMergeLevel2,
  migrate: createMigrate(migrations, { debug: false }),
};

const persistedReducer = persistReducer<ReturnType<typeof rootReducer>>(
  persistConfig,
  rootReducer,
);

/**
 * Redirect session-slice mutations from a background stream onto the parked
 * session cache instead of the currently visible Redux session.
 *
 * IMPORTANT: store.getState() must always return the *visible* session so
 * React-Redux and this middleware see the real UI state. Background streams
 * get a session-aware getState only via backgroundAwareThunkMiddleware.
 */
const backgroundSessionMiddleware: Middleware =
  (storeApi) => (next) => (action) => {
    const unknownAction = action as UnknownAction;
    const stateBefore = storeApi.getState() as {
      session: { id: string; lastSessionId?: string };
    };
    const activeId = stateBefore.session.id;

    if (shouldRedirectSessionActionToBackground(unknownAction, activeId)) {
      const streamId = getCurrentStreamSessionId()!;
      applyActionToBackgroundSession(streamId, unknownAction);

      if (unknownAction.type === "session/setActive") {
        storeApi.dispatch(
          setSessionStreaming({ sessionId: streamId, isStreaming: true }),
        );
      } else if (
        unknownAction.type === "session/setInactive" ||
        unknownAction.type === "session/abortStream"
      ) {
        const bg = getBackgroundSession(streamId);
        storeApi.dispatch(
          setSessionStreaming({
            sessionId: streamId,
            isStreaming: bg?.isStreaming ?? false,
          }),
        );
      }
      return unknownAction;
    }

    const result = next(action);

    // Keep tab streaming badges in sync for the *visible* session.
    if (typeof unknownAction.type === "string") {
      const stateAfter = storeApi.getState() as {
        session: { id: string; lastSessionId?: string };
      };
      if (unknownAction.type === "session/setActive") {
        storeApi.dispatch(
          setSessionStreaming({
            sessionId: stateAfter.session.id,
            isStreaming: true,
          }),
        );
      } else if (unknownAction.type === "session/setInactive") {
        storeApi.dispatch(
          setSessionStreaming({
            sessionId: stateAfter.session.id,
            isStreaming: false,
          }),
        );
      } else if (unknownAction.type === "session/newSession") {
        const prevId = stateAfter.session.lastSessionId;
        if (prevId) {
          storeApi.dispatch(
            setSessionStreaming({ sessionId: prevId, isStreaming: false }),
          );
        }
        storeApi.dispatch(
          setSessionStreaming({
            sessionId: stateAfter.session.id,
            isStreaming: false,
          }),
        );
      }
    }

    return result;
  };

function createBackgroundAwareThunkMiddleware(
  ideMessenger: IIdeMessenger,
): Middleware {
  return ({ dispatch, getState }) =>
    (next) =>
    (action) => {
      if (typeof action === "function") {
        // getState is always the *visible* Redux state. Stream thunks that need a
        // parked session must use withStreamSession(sessionId, ...) instead.
        return action(dispatch, getState, {
          ideMessenger,
          getVisibleState: getState,
        });
      }
      return next(action);
    };
}

export function setupStore(options: { ideMessenger?: IIdeMessenger }) {
  const ideMessenger = options.ideMessenger ?? new IdeMessenger();

  const configured = configureStore({
    reducer: persistedReducer as unknown as typeof rootReducer,
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({
        serializableCheck: false,
        // Custom thunk middleware supplies getVisibleState for multi-session streams.
        thunk: false,
      })
        .concat(createBackgroundAwareThunkMiddleware(ideMessenger))
        .concat(backgroundSessionMiddleware),
  });

  subscribeStreamingStatus((sessionId, isStreaming) => {
    configured.dispatch(setSessionStreaming({ sessionId, isStreaming }));
  });

  return configured;
}

export type RootState = ReturnType<typeof rootReducer>;

export type ThunkExtrasType = {
  ideMessenger: IIdeMessenger;
  getVisibleState: () => RootState;
};

export type ThunkApiType = {
  state: RootState;
  extra: ThunkExtrasType;
};

export type AppThunkDispatch = ThunkDispatch<
  RootState,
  ThunkExtrasType,
  UnknownAction
>;

export const store = setupStore({});

/** Explicit thunk typing — default thunk middleware is replaced by a custom one. */
export type AppDispatch = ThunkDispatch<
  RootState,
  ThunkExtrasType,
  UnknownAction
>;

export const persistor = persistStore(store);
