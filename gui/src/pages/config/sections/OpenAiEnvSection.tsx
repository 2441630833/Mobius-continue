import { CheckIcon, PlusIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { useContext, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ToolTip } from "../../../components/gui/Tooltip";
import { Card } from "../../../components/ui";
import { IdeMessengerContext } from "../../../context/IdeMessenger";
import { useAppDispatch } from "../../../redux/hooks";
import { setConfigResult } from "../../../redux/slices/configSlice";
import {
  setProfiles,
  setSelectedProfile,
} from "../../../redux/slices/profilesSlice";
import { updateSelectedModelByRole } from "../../../redux/thunks/updateSelectedModelByRole";
import { ConfigHeader } from "../components/ConfigHeader";

interface ModelEnvForm {
  profileId: string;
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

interface EnvProfileOption {
  id: string;
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

const PROVIDER_OPTIONS = [
  { id: "siliconflow", label: "SiliconFlow" },
  { id: "openai", label: "OpenAI" },
  { id: "anthropic", label: "Anthropic" },
  { id: "gemini", label: "Google Gemini" },
  { id: "openrouter", label: "OpenRouter" },
  { id: "deepseek", label: "DeepSeek" },
  { id: "groq", label: "Groq" },
  { id: "xai", label: "xAI (Grok)" },
  { id: "mistral", label: "Mistral" },
] as const;

const PROVIDER_DEFAULTS: Record<
  string,
  { baseUrl: string; defaultModel: string; defaultApiKey?: string }
> = {
  openai: {
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o",
  },
  anthropic: {
    baseUrl: "https://api.anthropic.com/v1",
    defaultModel: "claude-sonnet-4-6",
  },
  gemini: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    defaultModel: "gemini-2.0-flash",
  },
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "anthropic/claude-sonnet-4",
  },
  deepseek: {
    baseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
  },
  groq: {
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
  },
  xai: {
    baseUrl: "https://api.x.ai/v1",
    defaultModel: "grok-3",
  },
  mistral: {
    baseUrl: "https://api.mistral.ai/v1",
    defaultModel: "mistral-large-latest",
  },
  siliconflow: {
    baseUrl: "https://api.siliconflow.cn/v1",
    defaultModel: "deepseek-ai/DeepSeek-V3",
  },
};

const EMPTY_FORM: ModelEnvForm = {
  profileId: "default",
  provider: "openai",
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4o",
};

const PROFILE_ID_RE = /^[a-zA-Z][a-zA-Z0-9_.-]*$/;

function formsEqual(a: ModelEnvForm, b: ModelEnvForm): boolean {
  return (
    a.profileId === b.profileId &&
    a.provider === b.provider &&
    a.baseUrl === b.baseUrl &&
    a.apiKey === b.apiKey &&
    a.model === b.model
  );
}

/** Config.yaml model `name` is the profile id (see profileModelTitle). */
function profileModelTitle(profileId: string): string {
  return profileId;
}

function suggestNewProfileId(existing: readonly EnvProfileOption[]): string {
  const base = "custom";
  if (!existing.some((p) => p.id === base)) {
    return base;
  }
  let i = 2;
  while (existing.some((p) => p.id === `${base}${i}`)) {
    i += 1;
  }
  return `${base}${i}`;
}

export function OpenAiEnvSection() {
  const ideMessenger = useContext(IdeMessengerContext);
  const dispatch = useAppDispatch();
  const [searchParams, setSearchParams] = useSearchParams();
  const [form, setForm] = useState<ModelEnvForm>(EMPTY_FORM);
  const [savedForm, setSavedForm] = useState<ModelEnvForm>(EMPTY_FORM);
  const [profiles, setEnvProfiles] = useState<EnvProfileOption[]>([]);
  const [activeProfileId, setActiveProfileId] = useState("default");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  function handleClosePanel() {
    // Close the secondary side bar (where this settings panel lives).
    void ideMessenger.post("closeAuxiliaryBar", undefined);
  }

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const result = await ideMessenger.request(
        "physicalAI/getModelEnv",
        undefined,
      );
      if (cancelled) {
        return;
      }

      if (result.status === "success" && result.content) {
        const list = result.content.profiles?.length
          ? result.content.profiles
          : [
              {
                id: result.content.profileId ?? "default",
                provider: result.content.provider,
                baseUrl: result.content.baseUrl,
                apiKey: result.content.apiKey,
                model: result.content.model,
              },
            ];
        setEnvProfiles(list);
        const activeId =
          result.content.activeProfileId ??
          result.content.profileId ??
          list[0]?.id ??
          "default";
        setActiveProfileId(activeId);
        const active = list.find((p) => p.id === activeId) ??
          list[0] ?? {
            id: "default",
            provider: result.content.provider,
            baseUrl: result.content.baseUrl,
            apiKey: result.content.apiKey,
            model: result.content.model,
          };
        const next: ModelEnvForm = {
          profileId: active.id,
          provider: active.provider,
          baseUrl: active.baseUrl,
          apiKey: active.apiKey,
          model: active.model,
        };
        setForm(next);
        setSavedForm(next);

        // Deep-link from ModelSelect "Add provider".
        if (searchParams.get("addProvider") === "1") {
          const newId = suggestNewProfileId(list);
          const defaults = PROVIDER_DEFAULTS.openai;
          const createForm: ModelEnvForm = {
            profileId: newId,
            provider: "openai",
            baseUrl: defaults.baseUrl,
            apiKey: "",
            model: defaults.defaultModel,
          };
          setForm(createForm);
          setSavedForm(createForm);
          setIsCreating(true);
          const nextParams = new URLSearchParams(searchParams);
          nextParams.delete("addProvider");
          setSearchParams(nextParams, { replace: true });
        }
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
    // Only run on mount / messenger change; addProvider is consumed once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ideMessenger]);

  const isDirty = isCreating || !formsEqual(form, savedForm);
  const profileIdValid = PROFILE_ID_RE.test(form.profileId.trim());
  const profileIdTaken =
    isCreating &&
    profiles.some(
      (p) => p.id.toLowerCase() === form.profileId.trim().toLowerCase(),
    );
  const isValid =
    profileIdValid &&
    !profileIdTaken &&
    form.provider.trim().length > 0 &&
    form.baseUrl.trim().length > 0 &&
    form.model.trim().length > 0 &&
    form.apiKey.trim().length > 0;

  function startCreateProvider() {
    const newId = suggestNewProfileId(profiles);
    const defaults = PROVIDER_DEFAULTS.openai;
    const createForm: ModelEnvForm = {
      profileId: newId,
      provider: "openai",
      baseUrl: defaults.baseUrl,
      apiKey: "",
      model: defaults.defaultModel,
    };
    setForm(createForm);
    setSavedForm(createForm);
    setIsCreating(true);
  }

  function handleEnvProfileChange(profileId: string) {
    if (isCreating) {
      return;
    }
    const existing = profiles.find((p) => p.id === profileId);
    if (existing) {
      const next: ModelEnvForm = {
        profileId: existing.id,
        provider: existing.provider,
        baseUrl: existing.baseUrl,
        apiKey: existing.apiKey,
        model: existing.model,
      };
      setForm(next);
      setSavedForm(next);
      // Session-only: switch IDE chat model without writing AI_ACTIVE_PROFILE.
      void (async () => {
        const profileInfo = await ideMessenger.request(
          "config/getSerializedProfileInfo",
          undefined,
        );
        if (profileInfo.status !== "success") {
          return;
        }
        dispatch(setProfiles(profileInfo.content.profiles));
        dispatch(setSelectedProfile(profileInfo.content.profileId));
        dispatch(setConfigResult(profileInfo.content.result));
        const profile =
          profileInfo.content.profiles?.find(
            (p) => p.id === profileInfo.content.profileId,
          ) ?? null;
        if (profile && existing.id) {
          await dispatch(
            updateSelectedModelByRole({
              role: "chat",
              modelTitle: profileModelTitle(existing.id),
              selectedProfile: profile,
            }),
          );
        }
      })();
      return;
    }
    setForm((current) => ({ ...current, profileId }));
  }

  function handleProviderChange(provider: string) {
    const defaults = PROVIDER_DEFAULTS[provider];
    setForm((current) => ({
      ...current,
      provider,
      baseUrl: defaults?.baseUrl ?? current.baseUrl,
      model: defaults?.defaultModel ?? current.model,
      apiKey:
        defaults?.defaultApiKey !== undefined
          ? defaults.defaultApiKey
          : current.apiKey,
    }));
  }

  async function handleSave() {
    if (!isValid) {
      return;
    }

    const wasCreating = isCreating;
    setSaving(true);
    const result = await ideMessenger.request("physicalAI/saveModelEnv", {
      provider: form.provider.trim(),
      baseUrl: form.baseUrl.trim(),
      apiKey: form.apiKey.trim(),
      model: form.model.trim(),
      profileId: form.profileId.trim(),
    });
    setSaving(false);

    if (result.status === "success" && result.content.ok) {
      const next: ModelEnvForm = {
        profileId: form.profileId.trim(),
        provider: form.provider.trim(),
        baseUrl: form.baseUrl.trim(),
        apiKey: form.apiKey.trim(),
        model: form.model.trim(),
      };
      setSavedForm(next);
      setForm(next);
      setIsCreating(false);
      setEnvProfiles((current) => {
        const others = current.filter((p) => p.id !== next.profileId);
        return [...others, { ...next, id: next.profileId }];
      });

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
        if (profile && next.profileId) {
          await dispatch(
            updateSelectedModelByRole({
              role: "chat",
              modelTitle: profileModelTitle(next.profileId),
              selectedProfile: profile,
            }),
          );
        }
      }

      void ideMessenger.request("showToast", [
        "info",
        wasCreating
          ? `Provider "${next.profileId}" added and synced to Continue.`
          : "Model settings saved and synced to Continue.",
      ]);
      return;
    }

    const errorMessage =
      result.status === "success" ? result.content.error : result.error;
    void ideMessenger.request("showToast", [
      "error",
      errorMessage || "Failed to save model settings.",
    ]);
  }

  function handleCancel() {
    if (isCreating) {
      setIsCreating(false);
      setForm(savedForm);
      // Restore to last non-create saved profile if available.
      const existing =
        profiles.find((p) => p.id === activeProfileId) ?? profiles[0];
      if (existing) {
        const next: ModelEnvForm = {
          profileId: existing.id,
          provider: existing.provider,
          baseUrl: existing.baseUrl,
          apiKey: existing.apiKey,
          model: existing.model,
        };
        setForm(next);
        setSavedForm(next);
      }
      return;
    }
    setForm(savedForm);
  }

  const profileOptions =
    profiles.length > 0
      ? profiles
      : [{ id: form.profileId || "default", ...form }];

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <ConfigHeader title="Model Provider" variant="sm" className="mb-0" />
        <button
          type="button"
          onClick={handleClosePanel}
          title="Close provider panel"
          aria-label="Close provider panel"
          className="text-description hover:bg-list-active hover:text-vsc-foreground flex h-6 w-6 items-center justify-center rounded-md border-0 bg-transparent p-0"
        >
          <XMarkIcon className="h-4 w-4" />
        </button>
      </div>
      <Card>
        <div className="flex flex-col gap-4">
          <p className="text-description-muted text-xs">
            Named profiles come from <code>.env</code> (
            <code>AI_ACTIVE_PROFILE</code> + <code>[profile]</code> sections).
            All profiles appear as pinned options in the chat model picker. Use
            Add provider to create a new profile without editing{" "}
            <code>.env</code> by hand. Switching profile here only changes this
            session — edit <code>AI_ACTIVE_PROFILE</code> to change the default.
          </p>
          <p className="text-description-muted text-xs">
            Default profile in <code>.env</code>: <code>{activeProfileId}</code>
          </p>

          <div className="flex items-end gap-2">
            <label className="flex flex-1 flex-col gap-1">
              <span className="text-sm font-medium">
                Profile{isCreating ? " (new)" : ""}
              </span>
              {isCreating ? (
                <input
                  type="text"
                  value={form.profileId}
                  disabled={loading || saving}
                  placeholder="my-provider"
                  onChange={(e) =>
                    setForm((current) => ({
                      ...current,
                      profileId: e.target.value.trim(),
                    }))
                  }
                  className="border-command-border bg-vsc-input-background text-vsc-foreground rounded-md border px-2 py-1 text-sm outline-none focus:ring-1"
                />
              ) : (
                <select
                  value={form.profileId}
                  disabled={loading || saving}
                  onChange={(e) => handleEnvProfileChange(e.target.value)}
                  className="border-command-border bg-vsc-input-background text-vsc-foreground rounded-md border px-2 py-1 text-sm outline-none focus:ring-1"
                >
                  {profileOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.id}
                      {option.id === activeProfileId ? " (default)" : ""}
                    </option>
                  ))}
                </select>
              )}
            </label>
            {!isCreating && (
              <button
                type="button"
                disabled={loading || saving}
                onClick={startCreateProvider}
                className="border-command-border bg-vsc-input-background text-vsc-foreground hover:bg-list-active flex h-[30px] items-center gap-1 rounded-md border px-2 text-xs disabled:cursor-not-allowed disabled:opacity-40"
                title="Add a new provider profile"
              >
                <PlusIcon className="h-3.5 w-3.5" />
                Add provider
              </button>
            )}
          </div>

          {isCreating && !profileIdValid && form.profileId.trim() && (
            <p className="text-xs text-red-400">
              Profile id must start with a letter and use only letters, digits,
              <code>_</code>, <code>.</code>, or <code>-</code>.
            </p>
          )}
          {profileIdTaken && (
            <p className="text-xs text-red-400">
              Profile <code>{form.profileId}</code> already exists. Choose
              another id.
            </p>
          )}

          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Provider</span>
            <select
              value={form.provider}
              disabled={loading || saving}
              onChange={(e) => handleProviderChange(e.target.value)}
              className="border-command-border bg-vsc-input-background text-vsc-foreground rounded-md border px-2 py-1 text-sm outline-none focus:ring-1"
            >
              {PROVIDER_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Base URL</span>
            <input
              type="text"
              value={form.baseUrl}
              disabled={loading || saving}
              placeholder="https://api.openai.com/v1"
              onChange={(e) =>
                setForm((current) => ({
                  ...current,
                  baseUrl: e.target.value,
                }))
              }
              className="border-command-border bg-vsc-input-background text-vsc-foreground rounded-md border px-2 py-1 text-sm outline-none focus:ring-1"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">API Key</span>
            <input
              type="password"
              value={form.apiKey}
              disabled={loading || saving}
              placeholder="sk-..."
              onChange={(e) =>
                setForm((current) => ({
                  ...current,
                  apiKey: e.target.value,
                }))
              }
              className="border-command-border bg-vsc-input-background text-vsc-foreground rounded-md border px-2 py-1 text-sm outline-none focus:ring-1"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Model</span>
            <input
              type="text"
              value={form.model}
              disabled={loading || saving}
              placeholder="gpt-4o"
              onChange={(e) =>
                setForm((current) => ({
                  ...current,
                  model: e.target.value,
                }))
              }
              className="border-command-border bg-vsc-input-background text-vsc-foreground rounded-md border px-2 py-1 text-sm outline-none focus:ring-1"
            />
          </label>

          {isDirty && (
            <div className="flex items-center gap-2">
              <ToolTip content={isCreating ? "Create provider" : "Save"}>
                <button
                  type="button"
                  disabled={!isValid || saving}
                  onClick={() => void handleSave()}
                  className="text-green-500 hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <CheckIcon className="h-4 w-4" />
                </button>
              </ToolTip>
              <ToolTip content="Cancel">
                <button
                  type="button"
                  disabled={saving}
                  onClick={handleCancel}
                  className="text-red-500 hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <XMarkIcon className="h-4 w-4" />
                </button>
              </ToolTip>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
