import { ArrowLeftIcon } from "@heroicons/react/24/outline";
import ContinueInputBox from "./mainInput/ContinueInputBox";
import { NewSessionButton } from "./mainInput/belowMainInput/NewSessionButton";
import { FatalErrorIndicator } from "./config/FatalErrorNotice";
import { useOnboardingCard } from "./OnboardingCard";
import { EmptyChatBody } from "../pages/gui/EmptyChatBody";
import { ExploreDialogWatcher } from "../pages/gui/ExploreDialogWatcher";
import { MAIN_EDITOR_INPUT_ID } from "../pages/gui/Chat";
import { useSendChatInput } from "../hooks/useSendChatInput";
import { useAppDispatch, useAppSelector } from "../redux/hooks";
import { loadLastSession } from "../redux/thunks/session";

export function ChatMainInput() {
  const dispatch = useAppDispatch();
  const sendInput = useSendChatInput();
  const onboardingCard = useOnboardingCard();
  const isStreaming = useAppSelector((state) => state.session.isStreaming);
  const history = useAppSelector((state) => state.session.history);
  const lastSessionId = useAppSelector((state) => state.session.lastSessionId);
  const isInEdit = useAppSelector((store) => store.session.isInEdit);
  const hasDismissedExploreDialog = useAppSelector(
    (state) => state.ui.hasDismissedExploreDialog,
  );

  return (
    <div className="relative shrink-0">
      <ContinueInputBox
        isMainInput
        isLastUserInput={false}
        onEnter={(editorState, modifiers, editor) =>
          sendInput(editorState, modifiers, undefined, editor)
        }
        inputId={MAIN_EDITOR_INPUT_ID}
      />

      <div
        style={{
          pointerEvents: isStreaming ? "none" : "auto",
        }}
      >
        <div className="flex flex-row items-center justify-between pb-1 pl-0.5 pr-2">
          <div className="xs:inline hidden">
            {history.length === 0 && lastSessionId && !isInEdit && (
              <NewSessionButton
                onClick={async () => {
                  await dispatch(loadLastSession());
                }}
                className="flex items-center gap-2"
              >
                <ArrowLeftIcon className="h-3 w-3" />
                <span className="text-xs">Last Session</span>
              </NewSessionButton>
            )}
          </div>
        </div>
        <FatalErrorIndicator />
        {!hasDismissedExploreDialog && <ExploreDialogWatcher />}
        {history.length === 0 && (
          <EmptyChatBody showOnboardingCard={onboardingCard.show} />
        )}
      </div>
    </div>
  );
}
