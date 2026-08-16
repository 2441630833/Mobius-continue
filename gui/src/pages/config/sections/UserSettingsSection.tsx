import {
  SharedConfigSchema,
  modifyAnyConfigWithSharedConfig,
} from "core/config/sharedConfig";
import { useContext, useEffect, useState } from "react";
import { Card, useFontSize } from "../../../components/ui";
import { IdeMessengerContext } from "../../../context/IdeMessenger";
import { useAppDispatch, useAppSelector } from "../../../redux/hooks";
import {
  setConfigResult,
  updateConfig,
} from "../../../redux/slices/configSlice";
import {
  setProfiles,
  setSelectedProfile,
} from "../../../redux/slices/profilesSlice";
import { updateSelectedModelByRole } from "../../../redux/thunks/updateSelectedModelByRole";
import { setLocalStorage } from "../../../util/localStorage";
import { ConfigHeader } from "../components/ConfigHeader";
import { UserSetting } from "../components/UserSetting";
import { OpenAiEnvSection } from "./OpenAiEnvSection";

const DEFAULT_USER_SETTINGS: SharedConfigSchema = {
  showSessionTabs: false,
  codeWrap: false,
  showChatScrollbar: false,
  readResponseTTS: false,
  disableSessionTitles: false,
  displayRawMarkdown: false,
  fontSize: 14,
  useAutocompleteMultilineCompletions: "auto",
  modelTimeout: 150,
  debounceDelay: 250,
  disableAutocompleteInFiles: [],
};

export function UserSettingsSection() {
  /////// User settings section //////
  const dispatch = useAppDispatch();
  const ideMessenger = useContext(IdeMessengerContext);
  const config = useAppSelector((state) => state.config.config);
  const [modelEnvReloadKey, setModelEnvReloadKey] = useState(0);
  const [resetting, setResetting] = useState(false);

  function handleUpdate(sharedConfig: SharedConfigSchema) {
    // Optimistic update
    const updatedConfig = modifyAnyConfigWithSharedConfig(config, sharedConfig);
    dispatch(updateConfig(updatedConfig));
    // IMPORTANT no need for model role updates (separate logic for selected model roles)
    // simply because this function won't be used to update model roles

    // Actual update to core which propagates back with config update event
    ideMessenger.post("config/updateSharedConfig", sharedConfig);
  }

  // Disable autocomplete
  const disableAutocompleteInFiles = (
    config.tabAutocompleteOptions?.disableInFiles ?? []
  ).join(", ");
  const [formDisableAutocomplete, setFormDisableAutocomplete] = useState(
    disableAutocompleteInFiles,
  );

  useEffect(() => {
    // Necessary so that reformatted/trimmed values don't cause dirty state
    setFormDisableAutocomplete(disableAutocompleteInFiles);
  }, [disableAutocompleteInFiles]);

  // Workspace prompts
  // TODO defaults are in multiple places, should be consolidated and probably not explicit here
  const showSessionTabs = config.ui?.showSessionTabs ?? false;
  const codeWrap = config.ui?.codeWrap ?? false;
  const showChatScrollbar = config.ui?.showChatScrollbar ?? false;
  const readResponseTTS = config.experimental?.readResponseTTS ?? false;
  const displayRawMarkdown = config.ui?.displayRawMarkdown ?? false;
  const disableSessionTitles = config.disableSessionTitles ?? false;

  const useAutocompleteMultilineCompletions =
    config.tabAutocompleteOptions?.multilineCompletions ?? "auto";
  const modelTimeout = config.tabAutocompleteOptions?.modelTimeout ?? 150;
  const debounceDelay = config.tabAutocompleteOptions?.debounceDelay ?? 250;
  const fontSize = useFontSize();

  const cancelChangeDisableAutocomplete = () => {
    setFormDisableAutocomplete(disableAutocompleteInFiles);
  };
  const handleDisableAutocompleteSubmit = () => {
    handleUpdate({
      disableAutocompleteInFiles: formDisableAutocomplete
        .split(",")
        .map((val) => val.trim())
        .filter((val) => !!val),
    });
  };

  async function handleResetToDefaults() {
    if (
      !window.confirm(
        "Reset User Settings to defaults? This restores the Model Provider / Continue config and Chat, Appearance, and Autocomplete preferences.",
      )
    ) {
      return;
    }

    setResetting(true);
    try {
      const result = await ideMessenger.request(
        "physicalAI/resetModelEnv",
        undefined,
      );
      if (result.status !== "success" || !result.content.ok) {
        const errorMessage =
          result.status === "success" ? result.content.error : result.error;
        void ideMessenger.request("showToast", [
          "error",
          errorMessage || "Failed to reset model settings.",
        ]);
        return;
      }

      setLocalStorage("fontSize", DEFAULT_USER_SETTINGS.fontSize!);
      handleUpdate(DEFAULT_USER_SETTINGS);
      setFormDisableAutocomplete("");
      setModelEnvReloadKey((key) => key + 1);

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
        const modelTitle = result.content.settings?.model;
        if (profile && modelTitle) {
          await dispatch(
            updateSelectedModelByRole({
              role: "chat",
              modelTitle,
              selectedProfile: profile,
            }),
          );
        }
      }

      void ideMessenger.request("showToast", [
        "info",
        "User Settings reset to defaults.",
      ]);
    } finally {
      setResetting(false);
    }
  }

  return (
    <div>
      <div className="flex flex-col">
        <ConfigHeader
          title="User Settings"
          onResetClick={() => {
            if (!resetting) {
              void handleResetToDefaults();
            }
          }}
          resetButtonTooltip="Reset to default config"
        />
        <div className="space-y-6">
          <OpenAiEnvSection key={modelEnvReloadKey} />

          {/* Chat Interface Settings */}
          <div>
            <ConfigHeader title="Chat" variant="sm" />
            <Card>
              <div className="flex flex-col gap-4">
                <UserSetting
                  type="toggle"
                  title="Show Session Tabs"
                  description="Displays tabs above the chat as an alternative way to organize and access your sessions."
                  value={showSessionTabs}
                  onChange={(value) => handleUpdate({ showSessionTabs: value })}
                />
                <UserSetting
                  type="toggle"
                  title="Wrap Codeblocks"
                  description="Wraps long lines in code blocks instead of showing horizontal scroll."
                  value={codeWrap}
                  onChange={(value) => handleUpdate({ codeWrap: value })}
                />
                <UserSetting
                  type="toggle"
                  title="Show Chat Scrollbar"
                  description="Enables a scrollbar in the chat window."
                  value={showChatScrollbar}
                  onChange={(value) =>
                    handleUpdate({ showChatScrollbar: value })
                  }
                />
                <UserSetting
                  type="toggle"
                  title="Text-to-Speech Output"
                  description="Reads LLM responses aloud with TTS."
                  value={readResponseTTS}
                  onChange={(value) => handleUpdate({ readResponseTTS: value })}
                />
                <UserSetting
                  type="toggle"
                  title="Enable Session Titles"
                  description="Generates summary titles for each chat session after the first message, using the current Chat model."
                  value={!disableSessionTitles}
                  onChange={(value) =>
                    handleUpdate({ disableSessionTitles: !value })
                  }
                />
                <UserSetting
                  type="toggle"
                  title="Format Markdown"
                  description="If off, shows responses as raw text."
                  value={!displayRawMarkdown}
                  onChange={(value) =>
                    handleUpdate({ displayRawMarkdown: !value })
                  }
                />
              </div>
            </Card>
          </div>

          {/* Appearance Settings */}
          <div>
            <ConfigHeader title="Appearance" variant="sm" />
            <Card>
              <div className="flex flex-col gap-4">
                <UserSetting
                  type="number"
                  title="Font Size"
                  description="Specifies base font size for UI elements."
                  value={fontSize}
                  onChange={(val) => {
                    setLocalStorage("fontSize", val);
                    handleUpdate({ fontSize: val });
                  }}
                  min={7}
                  max={50}
                />
              </div>
            </Card>
          </div>

          {/* Autocomplete Settings */}
          <div>
            <ConfigHeader title="Autocomplete" variant="sm" />
            <Card>
              <div className="flex flex-col gap-4">
                <UserSetting
                  type="select"
                  title="Multiline Autocompletions"
                  description="Controls multiline completions for autocomplete."
                  value={useAutocompleteMultilineCompletions}
                  onChange={(value) =>
                    handleUpdate({
                      useAutocompleteMultilineCompletions: value as
                        | "auto"
                        | "always"
                        | "never",
                    })
                  }
                  options={[
                    { label: "Auto", value: "auto" },
                    { label: "Always", value: "always" },
                    { label: "Never", value: "never" },
                  ]}
                />
                <UserSetting
                  type="number"
                  title="Autocomplete Timeout (ms)"
                  description="Maximum time in milliseconds for autocomplete request/retrieval."
                  value={modelTimeout}
                  onChange={(val) => handleUpdate({ modelTimeout: val })}
                  min={100}
                  max={5000}
                />
                <UserSetting
                  type="number"
                  title="Autocomplete Debounce (ms)"
                  description="Minimum time in milliseconds to trigger an autocomplete request after a change."
                  value={debounceDelay}
                  onChange={(val) => handleUpdate({ debounceDelay: val })}
                  min={0}
                  max={2500}
                />
                <UserSetting
                  type="input"
                  title="Disable autocomplete in files"
                  description="List of comma-separated glob pattern to disable autocomplete in matching files."
                  placeholder="**/*.(txt,md)"
                  value={formDisableAutocomplete}
                  onChange={setFormDisableAutocomplete}
                  onSubmit={handleDisableAutocompleteSubmit}
                  onCancel={cancelChangeDisableAutocomplete}
                  isDirty={
                    formDisableAutocomplete !== disableAutocompleteInFiles
                  }
                  isValid={formDisableAutocomplete.trim() !== ""}
                />
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
