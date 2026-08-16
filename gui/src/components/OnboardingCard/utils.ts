import { BrowserSerializedContinueConfig } from "core";
import { getLocalStorage, setLocalStorage } from "../../util/localStorage";
import { OnboardingCardState } from "./OnboardingCard";

// Mobius: first launch shows Onboarding so users enter their own API key.
// Once a chat model is configured, the card hides itself.
export const API_KEYS_FROM_ENV = false;

export function hasPreconfiguredChatModels(
  config: BrowserSerializedContinueConfig,
): boolean {
  return config.modelsByRole.chat.length > 0;
}

export function markOnboardingCompletedForPreconfiguredModels(
  config: BrowserSerializedContinueConfig,
): void {
  if (!hasPreconfiguredChatModels(config)) {
    return;
  }
  setLocalStorage("onboardingStatus", "Completed");
  setLocalStorage("hasDismissedOnboardingCard", true);
}

export function shouldShowOnboardingCard(
  config: BrowserSerializedContinueConfig,
  configLoading: boolean,
): boolean {
  if (
    API_KEYS_FROM_ENV ||
    configLoading ||
    hasPreconfiguredChatModels(config)
  ) {
    return false;
  }
  return true;
}

// Note that there is no "NotStarted" status since the
// local storage value is null until onboarding begins
export type OnboardingStatus = "Started" | "Completed";

// If there is no value in local storage for "onboardingStatus",
// it implies that the user has not begun or completed onboarding.
export function isNewUserOnboarding() {
  // We used to use "onboardingComplete", but switched to "onboardingStatus"
  const onboardingCompleteLegacyValue =
    localStorage.getItem("onboardingComplete");

  if (onboardingCompleteLegacyValue === "true") {
    setLocalStorage("onboardingStatus", "Completed");
    localStorage.removeItem("onboardingComplete");
  }

  const onboardingStatus = getLocalStorage("onboardingStatus");

  return onboardingStatus === undefined;
}

export const defaultOnboardingCardState: OnboardingCardState = {
  show: false,
  activeTab: undefined,
};

export enum OllamaConnectionStatuses {
  WaitingToDownload = "WaitingToDownload",
  Downloading = "Downloading",
  Connected = "Connected",
}
