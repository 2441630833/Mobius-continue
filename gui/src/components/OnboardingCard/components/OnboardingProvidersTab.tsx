import { OnboardingModes } from "core/protocol/core";
import { useContext, useState } from "react";
import { Button, Input } from "../../index";
import { IdeMessengerContext } from "../../../context/IdeMessenger";
import { useAppDispatch } from "../../../redux/hooks";
import { setConfigResult } from "../../../redux/slices/configSlice";
import {
  setProfiles,
  setSelectedProfile,
} from "../../../redux/slices/profilesSlice";
import { updateSelectedModelByRole } from "../../../redux/thunks/updateSelectedModelByRole";
import { setDialogMessage, setShowDialog } from "../../../redux/slices/uiSlice";
import { useSubmitOnboarding } from "../hooks/useSubmitOnboarding";

interface OnboardingProvidersTabProps {
  isDialog?: boolean;
}

interface ProviderOption {
  id: string;
  label: string;
  baseUrl: string;
  defaultModel: string;
  apiKeyUrl?: string;
}

// No defaultApiKey — every provider requires the user's own key.
const PROVIDER_OPTIONS: ProviderOption[] = [
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o",
    apiKeyUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    defaultModel: "claude-sonnet-4-6",
    apiKeyUrl: "https://console.anthropic.com/settings/keys",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    apiKeyUrl: "https://platform.deepseek.com/api_keys",
  },
  {
    id: "siliconflow",
    label: "SiliconFlow",
    baseUrl: "https://api.siliconflow.cn/v1",
    defaultModel: "deepseek-ai/DeepSeek-V3",
    apiKeyUrl: "https://cloud.siliconflow.cn/account/ak",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "anthropic/claude-sonnet-4",
    apiKeyUrl: "https://openrouter.ai/keys",
  },
];

export function OnboardingProvidersTab({
  isDialog,
}: OnboardingProvidersTabProps) {
  const dispatch = useAppDispatch();
  const ideMessenger = useContext(IdeMessengerContext);
  const { submitOnboarding } = useSubmitOnboarding(
    OnboardingModes.API_KEY,
    isDialog,
  );

  const [providerId, setProviderId] = useState<string>("openai");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState<string>(PROVIDER_OPTIONS[0].baseUrl);
  const [model, setModel] = useState<string>(PROVIDER_OPTIONS[0].defaultModel);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected =
    PROVIDER_OPTIONS.find((p) => p.id === providerId) ?? PROVIDER_OPTIONS[0];

  function handleProviderChange(id: string) {
    const next = PROVIDER_OPTIONS.find((p) => p.id === id);
    if (!next) return;
    setProviderId(id);
    setBaseUrl(next.baseUrl);
    setModel(next.defaultModel);
    setError(null);
  }

  async function handleConnect() {
    const trimmedKey = apiKey.trim();
    if (!trimmedKey) {
      setError("Please enter your API key.");
      return;
    }
    setConnecting(true);
    setError(null);
    try {
      const result = await ideMessenger.request("physicalAI/saveModelEnv", {
        provider: providerId,
        baseUrl: baseUrl.trim(),
        apiKey: trimmedKey,
        model: model.trim(),
        profileId: "default",
      });

      if (result.status === "error" || !result.content?.ok) {
        setError(
          (result.status === "success" && result.content?.error) ||
            (result.status === "error" ? result.error : undefined) ||
            "Failed to save model settings.",
        );
        return;
      }

      const profileInfo = await ideMessenger.request(
        "config/getSerializedProfileInfo",
        undefined,
      );
      if (profileInfo.status === "success") {
        dispatch(setProfiles(profileInfo.content.profiles));
        dispatch(setSelectedProfile(profileInfo.content.profileId));
        dispatch(setConfigResult(profileInfo.content.result));
        const profile =
          profileInfo.content.profiles?.find(
            (p) => p.id === profileInfo.content.profileId,
          ) ?? null;
        if (profile) {
          await dispatch(
            updateSelectedModelByRole({
              role: "chat",
              modelTitle: "default",
              selectedProfile: profile,
            }),
          );
        }
      }

      submitOnboarding(providerId, trimmedKey);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setConnecting(false);
    }
  }

  function openSettings() {
    submitOnboarding();
    ideMessenger.post("config/openProfile", { profileId: undefined });
    if (isDialog) {
      dispatch(setDialogMessage(undefined));
      dispatch(setShowDialog(false));
    }
  }

  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="w-full max-w-md px-2">
        <div className="mt-5 space-y-4">
          <p className="text-description text-center text-xs">
            Mobius has no built-in AI provider. Enter an API key from your
            preferred provider to get started. You can change this later in
            Settings.
          </p>

          <label className="flex flex-col gap-1">
            <span className="text-foreground text-sm font-medium">
              Provider
            </span>
            <select
              value={providerId}
              onChange={(e) => handleProviderChange(e.target.value)}
              className="border-command-border bg-vsc-input-background text-vsc-foreground rounded-md border px-2 py-1.5 text-sm outline-none focus:ring-1"
            >
              {PROVIDER_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-foreground text-sm font-medium">API Key</span>
            <Input
              id={`${providerId}_apiKey`}
              type="password"
              value={apiKey}
              placeholder="sk-..."
              onChange={(e) => setApiKey(e.target.value)}
              className="w-full"
            />
            {selected.apiKeyUrl && (
              <span className="text-description-muted text-input-placeholder mt-1 block text-xs">
                <a
                  href={selected.apiKeyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="cursor-pointer text-inherit underline hover:text-inherit hover:brightness-125"
                >
                  Click here
                </a>{" "}
                to create a {selected.label} API key
              </span>
            )}
          </label>

          <details className="text-xs">
            <summary className="text-description-muted cursor-pointer">
              Advanced: Base URL / Model
            </summary>
            <div className="mt-2 space-y-2">
              <label className="flex flex-col gap-1">
                <span className="text-foreground text-xs font-medium">
                  Base URL
                </span>
                <Input
                  type="text"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  className="w-full"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-foreground text-xs font-medium">
                  Model
                </span>
                <Input
                  type="text"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="w-full"
                />
              </label>
            </div>
          </details>

          {error && (
            <p className="text-xs text-red-400" role="alert">
              {error}
            </p>
          )}

          <Button
            type="button"
            onClick={handleConnect}
            disabled={connecting || !apiKey.trim()}
            className="w-full cursor-pointer hover:opacity-90"
          >
            {connecting ? "Connecting..." : "Connect"}
          </Button>

          <div className="w-full text-center">
            <span
              className="text-description text-input-placeholder cursor-pointer underline hover:brightness-125"
              onClick={openSettings}
            >
              Skip and configure manually in Settings
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
