import styled, { keyframes } from "styled-components";
import { vscFocusBorder } from "..";

const gradient = keyframes`
  0% {
    background-position: 0px 0;
  }
  100% {
    background-position: 100em 0;
  }
`;

const loadingBorderGradient = `repeating-linear-gradient(
  101.79deg,
  color-mix(in srgb, ${vscFocusBorder} 45%, transparent) 0%,
  color-mix(in srgb, ${vscFocusBorder} 75%, transparent) 20%,
  ${vscFocusBorder} 40%,
  color-mix(in srgb, ${vscFocusBorder} 80%, #ffffff) 55%,
  ${vscFocusBorder} 70%,
  color-mix(in srgb, ${vscFocusBorder} 75%, transparent) 85%,
  color-mix(in srgb, ${vscFocusBorder} 45%, transparent) 99%
)`;

export const GradientBorder = styled.div<{
  borderRadius?: string;
  borderColor?: string;
  loading: 0 | 1;
}>`
  border-radius: ${(props) => props.borderRadius || "0"};
  padding: 1px;
  background: ${(props) =>
    props.borderColor ? props.borderColor : loadingBorderGradient};
  animation: ${(props) => (props.loading ? gradient : "")} 6s linear infinite;
  background-size: 200% 200%;
  width: 100%;
  display: flex;
  flex-direction: row;
  align-items: center;
  margin-top: ${(props) => (props.loading ? "8px" : "")};
`;
