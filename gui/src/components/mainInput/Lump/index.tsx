import { LumpToolbar } from "./LumpToolbar/LumpToolbar";

/**
 * Runtime toolbar above the input (streaming / tools / edit).
 * Idle state renders nothing — no Main Config / block-settings strip.
 */
export function Lump() {
  return <LumpToolbar />;
}
