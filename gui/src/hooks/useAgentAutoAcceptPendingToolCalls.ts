import { useEffect, useRef } from "react";
import { useAppDispatch, useAppSelector } from "../redux/hooks";
import { selectPendingToolCalls } from "../redux/selectors/selectToolCalls";
import { callToolById } from "../redux/thunks/callToolById";
import { isAgentTaskAutoApproveEnabled } from "../util/agentAutoApprove";

/**
 * Mobius: when Agent mode leaves tool calls awaiting approval, accept
 * and run them immediately so the user is not prompted on every step.
 */
export function useAgentAutoAcceptPendingToolCalls() {
  const dispatch = useAppDispatch();
  const mode = useAppSelector((state) => state.session.mode);
  const sessionId = useAppSelector((state) => state.session.id);
  const pendingToolCalls = useAppSelector(selectPendingToolCalls);
  const inFlight = useRef(new Set<string>());

  const pendingIds = pendingToolCalls.map((tc) => tc.toolCallId).join(",");

  useEffect(() => {
    if (!isAgentTaskAutoApproveEnabled(mode) || pendingToolCalls.length === 0) {
      return;
    }

    for (const toolCall of pendingToolCalls) {
      const { toolCallId } = toolCall;
      if (inFlight.current.has(toolCallId)) {
        continue;
      }
      inFlight.current.add(toolCallId);
      void dispatch(
        callToolById({ toolCallId, isAutoApproved: true, sessionId }),
      ).finally(() => {
        inFlight.current.delete(toolCallId);
      });
    }
  }, [dispatch, mode, pendingIds, pendingToolCalls, sessionId]);
}
