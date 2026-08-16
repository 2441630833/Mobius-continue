import { ChatBubbleOvalLeftIcon } from "@heroicons/react/24/outline";
import { ChatHistoryItem } from "core";
import { renderChatMessage } from "core/util/messageContent";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ErrorBoundary } from "react-error-boundary";
import styled, { keyframes } from "styled-components";
import { Button, lightGray, vscBackground } from "../../components";
import { ChatMainInput } from "../../components/ChatMainInput";
import { useFindWidget } from "../../components/find/FindWidget";
import TimelineItem from "../../components/gui/TimelineItem";
import ThinkingBlockPeek from "../../components/mainInput/belowMainInput/ThinkingBlockPeek";
import ContinueInputBox from "../../components/mainInput/ContinueInputBox";
import StepContainer from "../../components/StepContainer";
import { TabBar } from "../../components/TabBar/TabBar";
import { useSendChatInput } from "../../hooks/useSendChatInput";
import { useWebviewListener } from "../../hooks/useWebviewListener";
import { useAppDispatch, useAppSelector } from "../../redux/hooks";
import {
  ChatHistoryItemWithMessageId,
  newSession,
  updateToolCallOutput,
} from "../../redux/slices/sessionSlice";
import { isJetBrains, isMetaEquivalentKeyPressed } from "../../util";
import { ToolCallDiv } from "./ToolCallDiv";

import { DeprecationBanner } from "../../components/DeprecationBanner";
import { FileDropOverlay } from "../../components/FileDropOverlay";
import InlineErrorMessage from "../../components/mainInput/InlineErrorMessage";
import { cancelStream } from "../../redux/thunks/cancelStream";
import { useAutoScroll } from "./useAutoScroll";

const sessionFadeIn = keyframes`
  from {
    opacity: 0.35;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
`;

const SessionPane = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  min-width: 0;
  animation: ${sessionFadeIn} 0.18s ease-out;
`;

function findLatestSummaryIndex(history: ChatHistoryItem[]): number {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].conversationSummary) {
      return i;
    }
  }
  return -1;
}

const StepsDiv = styled.div`
  position: relative;
  background-color: transparent;
  width: 100%;
  min-width: 0;
  max-width: 100%;

  & > * {
    position: relative;
    min-width: 0;
    max-width: 100%;
  }

  .thread-message {
    margin: 0 0 0 1px;
  }
`;

export const MAIN_EDITOR_INPUT_ID = "main-editor-input";

function fallbackRender({ error, resetErrorBoundary }: any) {
  return (
    <div
      role="alert"
      className="px-2"
      style={{ backgroundColor: vscBackground }}
    >
      <p>Something went wrong:</p>
      <pre style={{ color: "red" }}>{error.message}</pre>
      <pre style={{ color: lightGray }}>{error.stack}</pre>

      <div className="text-center">
        <Button onClick={resetErrorBoundary}>Restart</Button>
      </div>
    </div>
  );
}

export function Chat() {
  const dispatch = useAppDispatch();
  const sendInput = useSendChatInput();
  const showSessionTabs = useAppSelector(
    (store) => store.config.config.ui?.showSessionTabs ?? true,
  );
  const isStreaming = useAppSelector((state) => state.session.isStreaming);
  const sessionId = useAppSelector((state) => state.session.id);
  const [stepsOpen] = useState<(boolean | undefined)[]>([]);
  const stepsDivRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const history = useAppSelector((state) => state.session.history);
  const showChatScrollbar = useAppSelector(
    (state) => state.config.config.ui?.showChatScrollbar,
  );
  const isInEdit = useAppSelector((store) => store.session.isInEdit);
  const configLoading = useAppSelector((store) => store.config.loading);

  const jetbrains = useMemo(() => {
    return isJetBrains();
  }, []);

  const [showFileDropOverlay, setShowFileDropOverlay] = useState(false);

  useWebviewListener(
    "setFileDropOverlay",
    async (data) => {
      setShowFileDropOverlay(data.show);
    },
    [],
  );

  useAutoScroll(stepsDivRef, history);

  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (
        e.key === "Backspace" &&
        (jetbrains ? e.altKey : isMetaEquivalentKeyPressed(e)) &&
        !e.shiftKey
      ) {
        void dispatch(cancelStream());
      }
    };
    window.addEventListener("keydown", listener);

    return () => {
      window.removeEventListener("keydown", listener);
    };
  }, [isStreaming, jetbrains, isInEdit, dispatch]);

  const { widget, highlights } = useFindWidget(
    stepsDivRef,
    tabsRef,
    isStreaming,
  );

  useWebviewListener(
    "toolCallPartialOutput",
    async (data) => {
      dispatch(
        updateToolCallOutput({
          toolCallId: data.toolCallId,
          contextItems: data.contextItems,
        }),
      );
    },
    [dispatch],
  );

  const isLastUserInput = useCallback(
    (index: number): boolean => {
      return !history
        .slice(index + 1)
        .some((entry) => entry.message.role === "user");
    },
    [history],
  );

  const renderChatHistoryItem = useCallback(
    (item: ChatHistoryItemWithMessageId, index: number) => {
      const {
        message,
        editorState,
        contextItems,
        appliedRules,
        toolCallStates,
      } = item;

      const latestSummaryIndex = findLatestSummaryIndex(history);
      const isBeforeLatestSummary =
        latestSummaryIndex !== -1 && index < latestSummaryIndex;

      if (message.role === "user") {
        return (
          <ContinueInputBox
            onEnter={(editorState, modifiers) =>
              sendInput(editorState, modifiers, index)
            }
            isLastUserInput={isLastUserInput(index)}
            isMainInput={false}
            editorState={editorState ?? item.message.content}
            contextItems={contextItems}
            appliedRules={appliedRules}
            inputId={message.id}
          />
        );
      }

      if (message.role === "tool") {
        return null;
      }

      if (message.role === "assistant") {
        return (
          <>
            <div className="thread-message">
              <TimelineItem
                item={item}
                iconElement={
                  <ChatBubbleOvalLeftIcon width="16px" height="16px" />
                }
                open={
                  typeof stepsOpen[index] === "undefined"
                    ? true
                    : stepsOpen[index]!
                }
                onToggle={() => {}}
              >
                <StepContainer
                  index={index}
                  isLast={index === history.length - 1}
                  item={item}
                  latestSummaryIndex={latestSummaryIndex}
                />
              </TimelineItem>
            </div>

            {toolCallStates && (
              <ToolCallDiv
                toolCallStates={toolCallStates}
                historyIndex={index}
              />
            )}
          </>
        );
      }

      if (message.role === "thinking") {
        const thinkingContent = renderChatMessage(message);
        if (!thinkingContent?.trim()) {
          return null;
        }
        return (
          <div className={isBeforeLatestSummary ? "opacity-50" : ""}>
            <ThinkingBlockPeek
              content={thinkingContent}
              redactedThinking={message.redactedThinking}
              index={index}
              prevItem={index > 0 ? history[index - 1] : null}
              inProgress={index === history.length - 1 && isStreaming}
              signature={message.signature}
            />
          </div>
        );
      }

      return (
        <div className="thread-message">
          <TimelineItem
            item={item}
            iconElement={<ChatBubbleOvalLeftIcon width="16px" height="16px" />}
            open={
              typeof stepsOpen[index] === "undefined" ? true : stepsOpen[index]!
            }
            onToggle={() => {}}
          >
            <StepContainer
              index={index}
              isLast={index === history.length - 1}
              item={item}
              latestSummaryIndex={latestSummaryIndex}
            />
          </TimelineItem>
        </div>
      );
    },
    [sendInput, isLastUserInput, history, stepsOpen, isStreaming],
  );

  const showScrollbar = showChatScrollbar ?? window.innerHeight > 5000;

  return (
    <div className="relative flex h-full min-h-0 w-full min-w-0 max-w-full flex-col">
      {showFileDropOverlay && <FileDropOverlay />}
      {!!showSessionTabs && !configLoading && !isInEdit && (
        <TabBar ref={tabsRef} />
      )}
      {widget}

      <SessionPane key={sessionId}>
        <StepsDiv
          ref={stepsDivRef}
          className={`pt-[8px] ${showScrollbar ? "thin-scrollbar" : "no-scrollbar"} ${
            history.length > 0
              ? "min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-scroll"
              : "shrink-0"
          }`}
        >
          <DeprecationBanner dismissable={true} />
          {highlights}
          {history
            .filter((item) => item.message.role !== "system")
            .map((item, index: number) => (
              <div
                key={item.message.id}
                style={{
                  minHeight: index === history.length - 1 ? "200px" : 0,
                }}
              >
                <ErrorBoundary
                  FallbackComponent={fallbackRender}
                  onReset={() => {
                    dispatch(newSession());
                  }}
                >
                  {renderChatHistoryItem(item, index)}
                </ErrorBoundary>
                {index === history.length - 1 && <InlineErrorMessage />}
              </div>
            ))}
        </StepsDiv>
        <ChatMainInput />
      </SessionPane>
    </div>
  );
}

/** Chat page including main input -- used by tests. */
export function ChatWithMainInput() {
  return <Chat />;
}
