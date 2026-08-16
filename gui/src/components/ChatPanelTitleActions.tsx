import {
  ArrowsPointingOutIcon,
  ClockIcon,
  Cog6ToothIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { useContext } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import styled from "styled-components";
import { IdeMessengerContext } from "../context/IdeMessenger";
import { ROUTES } from "../util/navigation";
import { defaultBorderRadius } from ".";
import { varWithFallback } from "../styles/theme";

const muted = varWithFallback("description");
const foreground = varWithFallback("foreground");
const hoverBg = varWithFallback("list-hover");

const ActionsRow = styled.div`
  display: flex;
  align-items: center;
  gap: 2px;
  height: 35px;
  padding: 0 4px;
  flex-shrink: 0;
`;

const IconButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  color: ${muted};
  cursor: pointer;
  border-radius: ${defaultBorderRadius};
  padding: 0;

  &:hover {
    color: ${foreground};
    background-color: ${hoverBg};
  }
`;

const Separator = styled.div`
  width: 1px;
  height: 16px;
  margin: 0 4px;
  background: ${varWithFallback("border")};
  opacity: 0.7;
`;

/**
 * Native auxiliary-bar title actions, rendered inside the webview so Chat can
 * use a single Cursor-style header row with the session TabBar.
 */
export function ChatPanelTitleActions() {
  const navigate = useNavigate();
  const location = useLocation();
  const ideMessenger = useContext(IdeMessengerContext);

  return (
    <ActionsRow className="mobius-chat-panel-title-actions">
      <IconButton
        type="button"
        aria-label="View History"
        title="View History"
        onClick={() => {
          if (location.pathname === "/history") {
            navigate(ROUTES.HOME);
          } else {
            navigate("/history");
          }
        }}
      >
        <ClockIcon width={16} height={16} />
      </IconButton>
      <IconButton
        type="button"
        aria-label="Open Settings"
        title="Open Settings"
        onClick={() => navigate(ROUTES.CONFIG)}
      >
        <Cog6ToothIcon width={16} height={16} />
      </IconButton>
      <Separator aria-hidden />
      <IconButton
        type="button"
        aria-label="Toggle Maximized Chat"
        title="Toggle Maximized Chat"
        onClick={() =>
          ideMessenger.post("toggleMaximizedAuxiliaryBar", undefined)
        }
      >
        <ArrowsPointingOutIcon width={16} height={16} />
      </IconButton>
      <IconButton
        type="button"
        aria-label="Close Chat"
        title="Close Chat"
        onClick={() => ideMessenger.post("closeAuxiliaryBar", undefined)}
      >
        <XMarkIcon width={16} height={16} />
      </IconButton>
    </ActionsRow>
  );
}
