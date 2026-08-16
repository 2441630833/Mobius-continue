import styled from "styled-components";
import {
  lightGray,
  vscBadgeBackground,
  vscForeground,
  vscInputBackground,
} from ".";

const OverlayBackdrop = styled.div`
  position: absolute;
  inset: 0;
  z-index: 1000;
  pointer-events: none;
  background-color: ${vscBadgeBackground};
  opacity: 0.55;
  outline: 2px dashed ${lightGray};
  outline-offset: -8px;
`;

const OverlayLabel = styled.div`
  position: absolute;
  inset: 0;
  z-index: 1001;
  pointer-events: none;
  display: flex;
  align-items: center;
  justify-content: center;
  color: ${vscForeground};
  font-size: 13px;
`;

const OverlayLabelInner = styled.div`
  padding: 8px 14px;
  background-color: ${vscInputBackground};
  border-radius: 4px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
`;

export function FileDropOverlay() {
  return (
    <>
      <OverlayBackdrop />
      <OverlayLabel>
        <OverlayLabelInner>Drop files to add as context</OverlayLabelInner>
      </OverlayLabel>
    </>
  );
}
