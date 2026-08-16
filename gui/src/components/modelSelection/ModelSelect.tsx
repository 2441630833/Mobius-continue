import {
  CheckIcon,
  ChevronDownIcon,
  Cog6ToothIcon,
  MagnifyingGlassIcon,
  PlusIcon,
} from "@heroicons/react/24/outline";
import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/Auth";
import { useMainEditor } from "../mainInput/TipTapEditor";
import { useAppDispatch, useAppSelector } from "../../redux/hooks";
import { CONFIG_ROUTES } from "../../util/navigation";
import { saveMainEditorDraft } from "../../util/mainEditorDraft";
import { selectChatModelForActiveSession } from "../../redux/slices/configSlice";
import { setChatModelTitle } from "../../redux/slices/sessionSlice";
import { updateSelectedModelByRole } from "../../redux/thunks/updateSelectedModelByRole";
import {
  Button,
  Listbox,
  ListboxButton,
  ListboxOption,
  ListboxOptions,
} from "../ui";
import { isLocalBundledModel } from "../../util/bundledOllama";

type CloudModelOption = {
  value: string;
  title: string;
  modelName: string;
  profileLabel: string;
  apiKey?: string;
  contextLength?: number;
};

function modelSelectTitle(
  model: {
    title?: string;
    model?: string;
    class_name?: string;
  } | null,
): string {
  if (!model) {
    return "";
  }
  if (model.title && model.model && model.title !== model.model) {
    return `${model.title} (${model.model})`;
  }
  if (model?.title) {
    return model.title;
  }
  if (model?.model !== undefined && model.model.trim() !== "") {
    if (model?.class_name) {
      return `${model.class_name} - ${model.model}`;
    }
    return model.model;
  }
  return model?.class_name ?? "";
}

function formatContextLength(n?: number): string | undefined {
  if (!n || n <= 0) {
    return undefined;
  }
  if (n >= 1000) {
    const k = n / 1000;
    const rounded = k >= 10 ? Math.round(k) : Math.round(k * 10) / 10;
    return `${rounded}K`;
  }
  return String(n);
}

function PinIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M9.828.722a.5.5 0 0 1 .354.146l4.95 4.95a.5.5 0 0 1 0 .707l-1.06 1.06a.5.5 0 0 1-.708 0l-.528-.528L9.5 10.5l.146.146a.5.5 0 0 1 0 .708l-1.06 1.06a.5.5 0 0 1-.708 0L6.354 11l-3.89 3.89a.5.5 0 0 1-.707-.708L5.646 10.3 4.122 8.778a.5.5 0 0 1 0-.708l1.06-1.06a.5.5 0 0 1 .708 0L6.036 7.156 9.472 3.72l-.528-.528a.5.5 0 0 1 0-.707l1.06-1.06a.5.5 0 0 1 .354-.146z" />
    </svg>
  );
}

/** Cloud chat models only (bundled Ollama is embed/OCR, not chat). */
function ModelSelect() {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { mainEditor } = useMainEditor();
  const { selectedProfile } = useAuth();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const isInEdit = useAppSelector((store) => store.session.isInEdit);
  const config = useAppSelector((state) => state.config.config);
  const [searchQuery, setSearchQuery] = useState("");

  const role = isInEdit ? "edit" : "chat";
  const allModels = config.modelsByRole[role]?.length
    ? config.modelsByRole[role]
    : config.modelsByRole.chat;

  const sessionChatModel = useAppSelector(selectChatModelForActiveSession);
  let selectedModel =
    role === "chat"
      ? sessionChatModel
      : (config.selectedModelByRole[role] ?? sessionChatModel);
  if (!selectedModel || isLocalBundledModel(selectedModel)) {
    const cloud =
      allModels?.find((model) => !isLocalBundledModel(model)) ??
      (sessionChatModel && !isLocalBundledModel(sessionChatModel)
        ? sessionChatModel
        : config.selectedModelByRole.chat &&
            !isLocalBundledModel(config.selectedModelByRole.chat)
          ? config.selectedModelByRole.chat
          : null);
    selectedModel = cloud;
  }

  // Every cloud .env profile is pinned by default (Pinned section).
  const pinnedOptions = useMemo((): CloudModelOption[] => {
    const cloudModels = (allModels ?? []).filter(
      (model) => !isLocalBundledModel(model),
    );
    return cloudModels.map((model) => {
      const title = model.title ?? model.model ?? "";
      return {
        value: title,
        title,
        modelName: model.model ?? title,
        profileLabel: title,
        apiKey: model.apiKey,
        contextLength: model.contextLength,
      };
    });
  }, [allModels]);

  const filteredPinned = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) {
      return pinnedOptions;
    }
    return pinnedOptions.filter((option) => {
      const hay =
        `${option.title} ${option.modelName} ${option.profileLabel}`.toLowerCase();
      return hay.includes(q);
    });
  }, [pinnedOptions, searchQuery]);

  const selectedContext = formatContextLength(selectedModel?.contextLength);

  function openAddProvider() {
    saveMainEditorDraft(dispatch, mainEditor);
    navigate(CONFIG_ROUTES.SETTINGS_ADD_PROVIDER);
  }

  function openSettings() {
    saveMainEditorDraft(dispatch, mainEditor);
    navigate(CONFIG_ROUTES.SETTINGS);
  }

  if (!pinnedOptions.length) {
    return (
      <div className="relative flex items-center gap-0.5">
        <span
          data-testid="model-select-button"
          className="text-description line-clamp-1 h-[18px] max-w-[140px] break-all"
          title="No model configured"
        >
          No model
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="text-description hover:enabled:text-foreground my-0 h-[18px] w-[18px] p-0"
          title="Add provider"
          onClick={openAddProvider}
        >
          <PlusIcon className="h-3 w-3 flex-shrink-0" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-description hover:enabled:text-foreground my-0 h-[18px] w-[18px] p-0"
          title="Open Model Provider settings"
          onClick={openSettings}
        >
          <Cog6ToothIcon className="h-3 w-3 flex-shrink-0" />
        </Button>
      </div>
    );
  }

  return (
    <div className="relative flex items-center gap-0.5">
      <Listbox
        value={selectedModel?.title ?? ""}
        onChange={(val: string) => {
          if (val === "__add_provider__") {
            openAddProvider();
            return;
          }
          if (!selectedProfile || val === selectedModel?.title) {
            return;
          }
          void (async () => {
            // Bind provider/model to this chat tab so other tabs keep theirs.
            dispatch(setChatModelTitle(val));
            const roles = ["chat", "edit", "apply", "autocomplete"] as const;
            for (const modelRole of roles) {
              await dispatch(
                updateSelectedModelByRole({
                  selectedProfile,
                  role: modelRole,
                  modelTitle: val,
                }),
              );
            }
          })();
        }}
      >
        <ListboxButton
          data-testid="model-select-button"
          ref={buttonRef}
          className="text-description flex h-[18px] max-w-[200px] items-center gap-0.5 border-none bg-transparent p-0"
        >
          <span
            className="line-clamp-1 break-all hover:brightness-110"
            title={modelSelectTitle(selectedModel) || "Select model"}
          >
            {modelSelectTitle(selectedModel) || "Select model"}
          </span>
          <ChevronDownIcon
            className="h-2 w-2 flex-shrink-0 hover:brightness-110"
            aria-hidden="true"
          />
        </ListboxButton>
        <ListboxOptions
          className="min-w-[280px] max-w-[360px] p-0"
          onFocus={() => {
            // Focus search when the menu opens.
            window.setTimeout(() => searchRef.current?.focus(), 0);
          }}
        >
          <div
            className="border-border sticky top-0 z-10 border-b p-2"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <div className="bg-background border-border flex items-center rounded border pl-2">
              <MagnifyingGlassIcon className="text-description-muted h-3.5 w-3.5 flex-shrink-0" />
              <input
                ref={searchRef}
                type="text"
                placeholder="Search models"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-background text-foreground placeholder-description-muted w-full border-0 px-2 py-1.5 text-xs outline-none"
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          </div>

          <div className="text-description-muted flex items-center justify-between px-3 pb-0.5 pt-2 text-[10px] font-medium uppercase tracking-wider">
            <span>Pinned</span>
            {selectedContext && (
              <span className="normal-case tracking-normal">
                Max context {selectedContext}
              </span>
            )}
          </div>

          <div className="max-h-[240px] overflow-y-auto py-1">
            {filteredPinned.length === 0 ? (
              <div className="text-description-muted px-3 py-3 text-center text-xs">
                No models match &quot;{searchQuery}&quot;
              </div>
            ) : (
              filteredPinned.map((option) => {
                const isSelected =
                  option.value === (selectedModel?.title ?? "");
                const label = `${option.title} (${option.modelName})`;
                return (
                  <ListboxOption
                    key={option.value}
                    value={option.value}
                    className={`mx-1 mb-0.5 rounded-md px-2 py-1.5 ${
                      isSelected
                        ? "bg-list-active text-list-active-foreground ring-1 ring-inset ring-purple-500/70"
                        : ""
                    }`}
                  >
                    <div className="flex w-full min-w-0 items-center gap-2">
                      <span className="flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center">
                        {isSelected ? (
                          <CheckIcon
                            className="h-3.5 w-3.5"
                            aria-hidden="true"
                          />
                        ) : null}
                      </span>
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-xs" title={label}>
                          {label}
                        </span>
                        <span className="text-description-muted truncate text-[10px]">
                          Profile: {option.profileLabel}
                          {!option.apiKey ? " · missing API key" : ""}
                        </span>
                      </div>
                      <PinIcon className="text-description-muted h-3 w-3 flex-shrink-0 opacity-80" />
                    </div>
                  </ListboxOption>
                );
              })
            )}
          </div>

          <div className="border-border border-t p-1">
            <ListboxOption
              value="__add_provider__"
              className="mx-0 rounded-md px-2 py-1.5"
            >
              <div className="text-description flex w-full items-center gap-2 text-xs">
                <PlusIcon className="h-3.5 w-3.5 flex-shrink-0" />
                <span>Add provider</span>
              </div>
            </ListboxOption>
          </div>
        </ListboxOptions>
      </Listbox>
      <Button
        variant="ghost"
        size="sm"
        className="text-description hover:enabled:text-foreground my-0 h-[18px] w-[18px] p-0"
        title="Open Model Provider settings"
        onClick={openSettings}
      >
        <Cog6ToothIcon className="h-3 w-3 flex-shrink-0" />
      </Button>
    </div>
  );
}

export default ModelSelect;
