import { BuiltInToolNames } from "core/tools/builtIn";
import { useContext, useEffect, type ReactNode } from "react";
import { IdeMessengerContext } from "../../../../context/IdeMessenger";
import { useAgentAutoAcceptPendingToolCalls } from "../../../../hooks/useAgentAutoAcceptPendingToolCalls";
import { useAppDispatch, useAppSelector } from "../../../../redux/hooks";
import {
  selectFirstPendingToolCall,
  selectPendingToolCalls,
  selectToolCallsByStatus,
} from "../../../../redux/selectors/selectToolCalls";
import { cancelToolCall } from "../../../../redux/slices/sessionSlice";
import { callToolById } from "../../../../redux/thunks/callToolById";
import { cancelStream } from "../../../../redux/thunks/cancelStream";
import { logToolUsage } from "../../../../redux/util";
import { isJetBrains } from "../../../../util";
import { isAgentTaskAutoApproveEnabled } from "../../../../util/agentAutoApprove";
import { useMainEditor } from "../../TipTapEditor";
import { EditOutcomeToolbar } from "./EditOutcomeToolbar";
import { EditToolbar } from "./EditToolbar";
import { IsApplyingToolbar } from "./IsApplyingToolbar";
import { PendingApplyStatesToolbar } from "./PendingApplyStatesToolbar";
import { PendingToolCallToolbar } from "./PendingToolCallToolbar";
import { StreamingToolbar } from "./StreamingToolbar";
import { TtsActiveToolbar } from "./TtsActiveToolbar";

/** Border chrome only when a runtime toolbar is visible (not idle). */
function wrapLumpChrome(content: ReactNode) {
  return (
    <div className="bg-input rounded-t-default border-command-border mx-1.5 border-l border-r border-t">
      <div className="xs:px-2 px-1 py-0.5">{content}</div>
    </div>
  );
}

// Keyboard shortcut detection utilities
const isExecuteToolCallShortcut = (event: KeyboardEvent) => {
  const metaKey = event.metaKey || event.ctrlKey;
  return metaKey && event.key === "Enter";
};

const isCancelToolCallShortcut = (
  event: KeyboardEvent,
  isJetBrains: boolean,
) => {
  const metaKey = event.metaKey || event.ctrlKey;
  const altKey = event.altKey;
  const modifierKey = isJetBrains ? altKey : metaKey;
  return modifierKey && event.key === "Backspace";
};

// Check if a tool call is a terminal command
const isTerminalCommand = (toolCallState: any) => {
  return (
    toolCallState?.toolCall?.function?.name ===
    BuiltInToolNames.RunTerminalCommand
  );
};

export function LumpToolbar() {
  const dispatch = useAppDispatch();
  const ideMessenger = useContext(IdeMessengerContext);
  const ttsActive = useAppSelector((state) => state.ui.ttsActive);
  const isStreaming = useAppSelector((state) => state.session.isStreaming);
  const mode = useAppSelector((state) => state.session.mode);
  const isInEdit = useAppSelector((state) => state.session.isInEdit);
  const jetbrains = isJetBrains();
  const pendingToolCalls = useAppSelector(selectPendingToolCalls);
  const agentAutoAccept = isAgentTaskAutoApproveEnabled(mode);
  useAgentAutoAcceptPendingToolCalls();
  const firstPendingToolCall = useAppSelector(selectFirstPendingToolCall);
  const editApplyState = useAppSelector(
    (state) => state.editModeState.applyState,
  );
  const applyStates = useAppSelector(
    (state) => state.session.codeBlockApplyStates.states,
  );
  const pendingApplyStates = applyStates.filter(
    (state) => state.status === "done",
  );
  const isApplying = applyStates.some((state) => state.status === "streaming");
  const editor = useMainEditor();

  // Get ALL running terminal commands
  const runningToolCalls = useAppSelector((state) =>
    selectToolCallsByStatus(state, "calling"),
  );
  const runningTerminalCalls = runningToolCalls.filter(isTerminalCommand);
  const hasRunningTerminalCommand = runningTerminalCalls.length > 0;

  // Simple handler: stop ALL running terminal commands
  const handleStopAllTerminalCommands = async () => {
    if (runningTerminalCalls.length === 0) {
      return;
    }

    // Stop all terminal commands concurrently
    const stopPromises = runningTerminalCalls.map(async (terminalCall) => {
      try {
        // Cancel the process on the backend
        await ideMessenger.request("process/killTerminalProcess", {
          toolCallId: terminalCall.toolCallId,
        });

        // Cancel the tool call in the UI
        dispatch(
          cancelToolCall({
            toolCallId: terminalCall.toolCallId,
          }),
        );

        logToolUsage(terminalCall, false, true, ideMessenger);
      } catch (error) {
        console.error(
          `Failed to cancel terminal command ${terminalCall.toolCallId}:`,
          error,
        );
      }
    });

    // Wait for all cancellations to complete
    await Promise.all(stopPromises);
  };

  // Combined stop handler
  const handleStopAction = async () => {
    // Stop all terminal commands if any are running
    if (hasRunningTerminalCommand) {
      await handleStopAllTerminalCommands();
    }

    // Also stop regular streaming if it's happening
    if (isStreaming) {
      dispatch(cancelStream());
    }
  };

  useEffect(() => {
    if (!firstPendingToolCall && !hasRunningTerminalCommand) {
      return;
    }

    const handleToolCallKeyboardShortcuts = (event: KeyboardEvent) => {
      if (isExecuteToolCallShortcut(event) && firstPendingToolCall) {
        event.preventDefault();
        event.stopPropagation();

        void dispatch(
          callToolById({ toolCallId: firstPendingToolCall.toolCallId }),
        );
      } else if (isCancelToolCallShortcut(event, jetbrains)) {
        event.preventDefault();
        event.stopPropagation();

        if (hasRunningTerminalCommand) {
          // Stop running terminal commands
          void handleStopAction();
        } else if (firstPendingToolCall) {
          // Cancel pending tool call. If last call, focus editor
          if (pendingToolCalls.length === 1) {
            editor.mainEditor?.commands.focus();
          }
          void dispatch(
            cancelToolCall({
              toolCallId: firstPendingToolCall.toolCallId,
            }),
          );
          logToolUsage(firstPendingToolCall, false, true, ideMessenger);
        }
      }
    };

    document.addEventListener("keydown", handleToolCallKeyboardShortcuts);
    return () => {
      document.removeEventListener("keydown", handleToolCallKeyboardShortcuts);
    };
  }, [
    firstPendingToolCall,
    pendingToolCalls,
    editor,
    hasRunningTerminalCommand,
    runningTerminalCalls,
  ]);

  let content: ReactNode = null;

  if (isApplying) {
    content = <IsApplyingToolbar />;
  } else if (isInEdit) {
    content =
      editApplyState.status === "done" ? (
        <EditOutcomeToolbar />
      ) : (
        <EditToolbar />
      );
  } else if (ttsActive) {
    content = <TtsActiveToolbar />;
  } else if (hasRunningTerminalCommand) {
    // Only show terminal streaming for actual terminal commands
    const count = runningTerminalCalls.length;
    const stopText = `Stop Terminal${count > 1 ? ` (${count})` : ""}`;
    content = (
      <StreamingToolbar onStop={handleStopAction} displayText={stopText} />
    );
  } else if (isStreaming) {
    // Regular streaming (non-terminal)
    content = <StreamingToolbar onStop={() => dispatch(cancelStream())} />;
  } else if (pendingToolCalls.length > 0) {
    content = agentAutoAccept ? (
      <StreamingToolbar
        onStop={() => dispatch(cancelStream())}
        displayText="Running tools..."
      />
    ) : (
      <PendingToolCallToolbar />
    );
  } else if (pendingApplyStates.length > 0) {
    content = (
      <PendingApplyStatesToolbar pendingApplyStates={pendingApplyStates} />
    );
  }

  // Idle: hide BlockSettingsTopToolbar (Main Config / rules/tools/models) — Cursor-style.
  if (!content) {
    return null;
  }

  return wrapLumpChrome(content);
}
