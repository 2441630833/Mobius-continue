import {
  ArrowPathIcon,
  ChatBubbleOvalLeftIcon,
  PlusIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import React, { useCallback, useEffect, useState } from "react";
import styled, { css, keyframes } from "styled-components";
import { defaultBorderRadius } from "..";
import { useAppDispatch, useAppSelector } from "../../redux/hooks";
import { newSession } from "../../redux/slices/sessionSlice";
import {
  handleSessionChange,
  removeTab,
  setTabs,
} from "../../redux/slices/tabsSlice";
import { cancelStream } from "../../redux/thunks/cancelStream";
import {
  abortSessionIfBackground,
  openNewChatTab,
  switchChatSession,
} from "../../redux/thunks/switchChatSession";
import { varWithFallback } from "../../styles/theme";
import { generateChatTabId, NEW_AGENT_TAB_TITLE } from "../../util/newChatTab";
import { ChatPanelTitleActions } from "../ChatPanelTitleActions";

const tabForegroundVar = varWithFallback("foreground");
const tabHoverBackgroundVar = varWithFallback("list-hover");
const tabSelectedBackgroundVar = varWithFallback("input-background");
const tabMutedForegroundVar = varWithFallback("description");
const tabAccentVar = varWithFallback("accent");
const tabBorderVar = varWithFallback("border");

/** Match VS Code PartLayout.TITLE_HEIGHT for a Cursor-style single header row. */
const MOBIUS_SESSION_TAB_HEIGHT = 35;

const spin = keyframes`
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
`;

const TabBarContainer = styled.div`
  display: flex;
  align-items: stretch;
  flex-shrink: 0;
  flex-grow: 0;
  height: ${MOBIUS_SESSION_TAB_HEIGHT}px;
  min-height: ${MOBIUS_SESSION_TAB_HEIGHT}px;
  max-height: ${MOBIUS_SESSION_TAB_HEIGHT}px;
  background-color: transparent;
  overflow: hidden;
  box-sizing: border-box;
  padding: 0 4px 0 4px;
  border-bottom: 1px solid ${tabBorderVar};
`;

const TabList = styled.div`
  display: flex;
  align-items: stretch;
  flex: 1;
  min-width: 0;
  gap: 2px;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }
`;

const Tab = styled.div<{ isActive: boolean; $streaming?: boolean }>`
  position: relative;
  display: flex;
  align-items: center;
  box-sizing: border-box;
  padding: 0 8px 0 10px;
  flex: 0 1 auto;
  min-width: 88px;
  max-width: 200px;
  height: ${MOBIUS_SESSION_TAB_HEIGHT}px;
  background-color: ${(props) =>
    props.isActive ? tabSelectedBackgroundVar : "transparent"};
  color: ${(props) =>
    props.isActive ? tabForegroundVar : tabMutedForegroundVar};
  cursor: pointer;
  border: none;
  user-select: none;
  transition:
    background-color 0.15s ease,
    color 0.15s ease,
    opacity 0.15s ease;
  border-top-left-radius: ${defaultBorderRadius};
  border-top-right-radius: ${defaultBorderRadius};
  opacity: ${(props) => (props.isActive ? 1 : 0.78)};
  font-weight: ${(props) => (props.isActive ? 600 : 400)};

  ${(props) =>
    props.isActive &&
    css`
      &::after {
        content: "";
        position: absolute;
        left: 8px;
        right: 8px;
        bottom: 0;
        height: 2px;
        border-radius: 1px;
        background-color: ${tabAccentVar};
      }
    `}

  ${(props) =>
    props.$streaming &&
    !props.isActive &&
    css`
      color: ${tabAccentVar};
      opacity: 0.95;
    `}

  &:hover {
    background-color: ${(props) =>
      props.isActive ? tabSelectedBackgroundVar : tabHoverBackgroundVar};
    color: ${tabForegroundVar};
    opacity: 1;
  }
`;

const TabTitle = styled.span<{ $active?: boolean }>`
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 12px;
  line-height: 1.2;
  letter-spacing: ${(props) => (props.$active ? "0.01em" : "0")};
`;

const CloseButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  margin-left: 4px;
  border: none;
  background: transparent;
  color: inherit;
  opacity: 0.55;
  cursor: pointer;
  border-radius: ${defaultBorderRadius};
  padding: 0;
  flex-shrink: 0;

  &:hover {
    opacity: 1;
    background-color: ${tabHoverBackgroundVar};
  }
`;

const TabIcon = styled.span<{ $streaming?: boolean; $active?: boolean }>`
  display: flex;
  align-items: center;
  margin-right: 6px;
  opacity: ${(props) => (props.$active || props.$streaming ? 1 : 0.75)};
  flex-shrink: 0;
  color: ${(props) => (props.$streaming ? tabAccentVar : "inherit")};

  svg.streaming-spinner {
    animation: ${spin} 1s linear infinite;
  }
`;

const NewTabButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  margin: auto 0 auto 4px;
  border: none;
  background: transparent;
  color: ${tabMutedForegroundVar};
  cursor: pointer;
  border-radius: ${defaultBorderRadius};
  flex-shrink: 0;

  &:hover {
    color: ${tabForegroundVar};
    background-color: ${tabHoverBackgroundVar};
  }
`;

function createBlankTab() {
  return {
    id: generateChatTabId(),
    title: NEW_AGENT_TAB_TITLE,
    isActive: true,
    sessionId: undefined,
  } as const;
}

/** Make identical "New Agent" titles distinguishable in the tab strip. */
function getDisplayTitle(
  title: string,
  index: number,
  titles: string[],
): string {
  if (title !== NEW_AGENT_TAB_TITLE) {
    return title;
  }
  const sameTitleCount = titles
    .slice(0, index + 1)
    .filter((t) => t === NEW_AGENT_TAB_TITLE).length;
  return sameTitleCount <= 1
    ? title
    : `${NEW_AGENT_TAB_TITLE} ${sameTitleCount}`;
}

export const TabBar = React.forwardRef<HTMLDivElement>((_, ref) => {
  const dispatch = useAppDispatch();
  const currentSessionId = useAppSelector((state) => state.session.id);
  const currentSessionTitle = useAppSelector((state) => state.session.title);
  const tabs = useAppSelector((state) => state.tabs.tabs);
  const streamingSessionIds = useAppSelector(
    (state) => state.tabs.streamingSessionIds,
  );
  const [switchingTabId, setSwitchingTabId] = useState<string | null>(null);

  const generateId = useCallback(() => generateChatTabId(), []);

  useEffect(() => {
    if (!currentSessionId) return;

    dispatch(
      handleSessionChange({
        currentSessionId,
        currentSessionTitle,
        newTabId: generateId(),
      }),
    );
  }, [currentSessionId, currentSessionTitle, dispatch, generateId]);

  useEffect(() => {
    setSwitchingTabId(null);
  }, [currentSessionId]);

  const handleNewTab = () => {
    void dispatch(openNewChatTab());
  };

  const handleTabClick = async (id: string) => {
    const targetTab = tabs.find((tab) => tab.id === id);
    if (!targetTab || targetTab.isActive) return;

    setSwitchingTabId(id);
    try {
      await dispatch(
        switchChatSession({
          tabId: id,
          sessionId: targetTab.sessionId,
        }),
      );
    } finally {
      setSwitchingTabId(null);
    }
  };

  const handleTabClose = async (id: string) => {
    const closing = tabs.find((t) => t.id === id);
    if (!closing) return;

    const isClosingActive = closing.isActive;
    const filtered = tabs.filter((t) => t.id !== id);

    // Stop agent only when closing that session's tab (not when switching).
    if (closing.sessionId) {
      const isStreaming = streamingSessionIds.includes(closing.sessionId);
      if (isStreaming) {
        if (isClosingActive) {
          await dispatch(cancelStream());
        } else {
          void dispatch(abortSessionIfBackground(closing.sessionId));
        }
      }
    }

    if (isClosingActive) {
      if (filtered.length) {
        const lastTab = filtered[filtered.length - 1];
        setSwitchingTabId(lastTab.id);
        try {
          await dispatch(
            switchChatSession({
              tabId: lastTab.id,
              sessionId: lastTab.sessionId,
            }),
          );
          dispatch(
            setTabs(
              filtered.map((tab, i) => ({
                ...tab,
                isActive: i === filtered.length - 1,
              })),
            ),
          );
        } finally {
          setSwitchingTabId(null);
        }
      } else {
        dispatch(setTabs([createBlankTab()]));
        dispatch(newSession());
      }
    } else {
      dispatch(removeTab(id));
    }
  };

  if (!tabs.length) {
    return null;
  }

  const titles = tabs.map((t) => t.title);

  return (
    <TabBarContainer ref={ref} className="mobius-session-tab-bar">
      <TabList>
        {tabs.map((tab, index) => {
          const isStreaming = !!(
            tab.sessionId && streamingSessionIds.includes(tab.sessionId)
          );
          const isSwitching = switchingTabId === tab.id;
          const displayTitle = getDisplayTitle(tab.title, index, titles);
          return (
            <Tab
              key={tab.id}
              isActive={tab.isActive}
              $streaming={isStreaming}
              aria-selected={tab.isActive}
              aria-label={`${displayTitle}${isStreaming ? " (running)" : ""}`}
              title={isStreaming ? `${displayTitle} — running` : displayTitle}
              onClick={() => handleTabClick(tab.id)}
              onAuxClick={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  handleTabClose(tab.id);
                }
              }}
            >
              <TabIcon
                $streaming={isStreaming || isSwitching}
                $active={tab.isActive}
                title={isStreaming ? "Running" : undefined}
              >
                {isStreaming || isSwitching ? (
                  <ArrowPathIcon
                    className="streaming-spinner"
                    width={14}
                    height={14}
                  />
                ) : (
                  <ChatBubbleOvalLeftIcon width={14} height={14} />
                )}
              </TabIcon>
              <TabTitle $active={tab.isActive}>{displayTitle}</TabTitle>
              <CloseButton
                aria-label={`Close ${displayTitle}`}
                onClick={(e) => {
                  e.stopPropagation();
                  handleTabClose(tab.id);
                }}
              >
                <XMarkIcon width={12} height={12} />
              </CloseButton>
            </Tab>
          );
        })}
      </TabList>
      <NewTabButton
        aria-label="New Agent"
        title="New Agent"
        onClick={handleNewTab}
      >
        <PlusIcon width={16} height={16} />
      </NewTabButton>
      <ChatPanelTitleActions />
    </TabBarContainer>
  );
});
