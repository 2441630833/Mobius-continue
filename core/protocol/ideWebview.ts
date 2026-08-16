import { ToIdeFromWebviewOrCoreProtocol } from "./ide";
import { ToWebviewFromIdeOrCoreProtocol } from "./webview";

import {
  AcceptOrRejectDiffPayload,
  AddToChatPayload,
  ApplyState,
  ApplyToFilePayload,
  HighlightedCodePayload,
  MessageContent,
  RangeInFileWithContents,
  SetCodeToEditPayload,
  ShowFilePayload,
} from "../";

export type ToIdeFromWebviewProtocol = ToIdeFromWebviewOrCoreProtocol & {
  openUrl: [string, void];
  applyToFile: [ApplyToFilePayload, void];
  overwriteFile: [{ filepath: string; prevFileContent: string | null }, void];
  showTutorial: [undefined, void];
  showFile: [ShowFilePayload, void];
  toggleDevTools: [undefined, void];
  reloadWindow: [undefined, void];
  focusEditor: [undefined, void];
  toggleFullScreen: [{ newWindow?: boolean } | undefined, void];
  /** Maximize / restore the secondary side bar (Chat panel). */
  toggleMaximizedAuxiliaryBar: [undefined, void];
  /** Hide the secondary side bar (Chat panel). */
  closeAuxiliaryBar: [undefined, void];
  insertAtCursor: [{ text: string }, void];
  copyText: [{ text: string }, void];
  "jetbrains/isOSREnabled": [undefined, boolean];
  "jetbrains/onLoad": [
    undefined,
    {
      windowId: string;
      serverUrl: string;
      workspacePaths: string[];
      vscMachineId: string;
      vscMediaUrl: string;
    },
  ];
  "jetbrains/getColors": [undefined, Record<string, string | null | undefined>];
  "vscode/openMoveRightMarkdown": [undefined, void];
  acceptDiff: [AcceptOrRejectDiffPayload, void];
  rejectDiff: [AcceptOrRejectDiffPayload, void];
  "edit/sendPrompt": [
    {
      prompt: MessageContent;
      range: RangeInFileWithContents;
    },
    string | undefined,
  ];
  "edit/addCurrentSelection": [undefined, void];
  "edit/clearDecorations": [undefined, void];
  "session/share": [{ sessionId: string }, void];
  "physicalAI/getModelEnv": [
    undefined,
    {
      provider: string;
      baseUrl: string;
      apiKey: string;
      model: string;
      profileId?: string;
      activeProfileId?: string;
      profiles?: Array<{
        id: string;
        provider: string;
        baseUrl: string;
        apiKey: string;
        model: string;
      }>;
    } | null,
  ];
  "physicalAI/saveModelEnv": [
    {
      provider: string;
      baseUrl: string;
      apiKey: string;
      model: string;
      /** Named .env profile to upsert; does not change AI_ACTIVE_PROFILE. */
      profileId?: string;
    },
    { ok: boolean; error?: string; model?: string; profileId?: string },
  ];
  "physicalAI/resetModelEnv": [
    undefined,
    {
      ok: boolean;
      error?: string;
      settings?: {
        provider: string;
        baseUrl: string;
        apiKey: string;
        model: string;
      };
    },
  ];
  /** @deprecated use physicalAI/getModelEnv */
  "physicalAI/getOpenAiEnv": [
    undefined,
    {
      baseUrl: string;
      apiKey: string;
      model: string;
    } | null,
  ];
  /** @deprecated use physicalAI/saveModelEnv */
  "physicalAI/saveOpenAiEnv": [
    { baseUrl: string; apiKey: string; model: string },
    { ok: boolean; error?: string },
  ];
};

export type ToWebviewFromIdeProtocol = ToWebviewFromIdeOrCoreProtocol & {
  setInactive: [undefined, void];
  newSessionWithPrompt: [{ prompt: string }, void];
  userInput: [{ input: string }, void];
  focusContinueInput: [undefined, void];
  focusContinueInputWithoutClear: [undefined, void];
  focusContinueInputWithNewSession: [undefined, void];
  highlightedCode: [HighlightedCodePayload, void];
  setCodeToEdit: [SetCodeToEditPayload, void];
  navigateTo: [{ path: string; toggle?: boolean }, void];
  addModel: [undefined, void];

  focusContinueSessionId: [{ sessionId: string | undefined }, void];
  newSession: [undefined, void];
  setTheme: [{ theme: any }, void];
  setColors: [{ [key: string]: string }, void];
  "jetbrains/editorInsetRefresh": [undefined, void];
  "jetbrains/isOSREnabled": [boolean, void];
  setupApiKey: [undefined, void];
  setupLocalConfig: [undefined, void];
  incrementFtc: [undefined, void];
  openOnboardingCard: [undefined, void];
  applyCodeFromChat: [undefined, void];
  updateApplyState: [ApplyState, void];
  exitEditMode: [undefined, void];
  focusEdit: [undefined, void];
  addToChat: [AddToChatPayload, void];
  setFileDropOverlay: [{ show: boolean }, void];
};
