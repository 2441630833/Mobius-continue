import { ModelRole } from "@continuedev/config-yaml";
import { ModelDescription } from "core";
import { useNavigate } from "react-router-dom";
import { useState } from "react";
import Shortcut from "../../../components/gui/Shortcut";
import { useEditModel } from "../../../components/mainInput/Lump/useEditBlock";
import { Card, Divider, Toggle } from "../../../components/ui";
import { useAppSelector } from "../../../redux/hooks";
import { isJetBrains } from "../../../util";
import { CONFIG_ROUTES } from "../../../util/navigation";
import { ConfigHeader } from "../components/ConfigHeader";
import { ModelRoleRow } from "../components/ModelRoleRow";

const MODEL_DOCS_URLS = {
  chat: {
    learnMore: "https://docs.continue.dev/ide-extensions/chat/quick-start",
    setup: "https://docs.continue.dev/ide-extensions/chat/model-setup",
  },
  autocomplete: {
    learnMore:
      "https://docs.continue.dev/ide-extensions/autocomplete/quick-start",
    setup: "https://docs.continue.dev/ide-extensions/autocomplete/model-setup",
  },
  edit: {
    learnMore: "https://docs.continue.dev/ide-extensions/edit/quick-start",
    setup: "https://docs.continue.dev/ide-extensions/edit/model-setup",
  },
} as const;

export function ModelsSection() {
  const navigate = useNavigate();

  const config = useAppSelector((state) => state.config.config);
  const jetbrains = isJetBrains();
  const [showAdditionalRoles, setShowAdditionalRoles] = useState(false);

  function handleRoleUpdate(_role: ModelRole, _model: ModelDescription | null) {
    // Mobius: model is configured only in Settings > Model Provider.
    navigate(CONFIG_ROUTES.SETTINGS);
  }

  const handleConfigureModel = useEditModel();

  return (
    <div className="space-y-4">
      <ConfigHeader title="Models" />

      <Card>
        <p className="text-description text-sm">
          The active model is set in{" "}
          <button
            type="button"
            className="text-inherit underline hover:brightness-125"
            onClick={() => navigate(CONFIG_ROUTES.SETTINGS)}
          >
            User Settings {" > "} Model Provider
          </button>
          . Switching models from this page is disabled.
        </p>
      </Card>

      <Card>
        <ModelRoleRow
          role="chat"
          displayName="Chat"
          shortcut={
            <span className="text-2xs text-description-muted">
              (<Shortcut>{`cmd ${jetbrains ? "J" : "L"}`}</Shortcut>)
            </span>
          }
          description={
            <span>
              Used in Chat, Plan, Agent mode (
              <a
                href={MODEL_DOCS_URLS.chat.learnMore}
                target="_blank"
                rel="noopener noreferrer"
                className="text-inherit underline hover:brightness-125"
              >
                Learn more
              </a>
              )
            </span>
          }
          models={config.modelsByRole.chat}
          selectedModel={config.selectedModelByRole.chat ?? undefined}
          onSelect={(model) => handleRoleUpdate("chat", model)}
          onConfigure={handleConfigureModel}
          setupURL={MODEL_DOCS_URLS.chat.setup}
          readOnly
        />

        <Divider />

        <ModelRoleRow
          role="autocomplete"
          displayName="Autocomplete"
          description={
            <span>
              Used in inline code completions as you type (
              <a
                href={MODEL_DOCS_URLS.autocomplete.learnMore}
                target="_blank"
                rel="noopener noreferrer"
                className="text-inherit underline hover:brightness-125"
              >
                Learn more
              </a>
              )
            </span>
          }
          models={config.modelsByRole.autocomplete}
          selectedModel={config.selectedModelByRole.autocomplete ?? undefined}
          onSelect={(model) => handleRoleUpdate("autocomplete", model)}
          onConfigure={handleConfigureModel}
          setupURL={MODEL_DOCS_URLS.autocomplete.setup}
          readOnly
        />

        {/* Jetbrains has a model selector inline */}
        {!jetbrains && (
          <>
            <Divider />
            <ModelRoleRow
              role="edit"
              displayName="Edit"
              shortcut={
                <span className="text-2xs text-description-muted">
                  (<Shortcut>cmd I</Shortcut>)
                </span>
              }
              description={
                <span>
                  Used to transform a selected section of code (
                  <a
                    href={MODEL_DOCS_URLS.edit.learnMore}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-inherit underline hover:brightness-125"
                  >
                    Learn more
                  </a>
                  )
                </span>
              }
              models={config.modelsByRole.edit}
              selectedModel={config.selectedModelByRole.edit ?? undefined}
              onSelect={(model) => handleRoleUpdate("edit", model)}
              onConfigure={handleConfigureModel}
              setupURL={MODEL_DOCS_URLS.edit.setup}
              readOnly
            />
          </>
        )}
      </Card>

      <Card>
        <Toggle
          isOpen={showAdditionalRoles}
          onToggle={() => setShowAdditionalRoles(!showAdditionalRoles)}
          title="Additional model roles"
          subtitle="Apply, Embed, Rerank"
        >
          <div className="flex flex-col">
            <ModelRoleRow
              role="apply"
              displayName="Apply"
              description="Used to apply generated codeblocks to files"
              models={config.modelsByRole.apply}
              selectedModel={config.selectedModelByRole.apply ?? undefined}
              onSelect={(model) => handleRoleUpdate("apply", model)}
              onConfigure={handleConfigureModel}
              setupURL="https://docs.continue.dev/customize/model-roles/apply"
              readOnly
            />

            <Divider />

            <ModelRoleRow
              role="embed"
              displayName="Embed"
              description="Used to generate and query embeddings for the @codebase and @docs context providers"
              models={config.modelsByRole.embed}
              selectedModel={config.selectedModelByRole.embed ?? undefined}
              onSelect={(model) => handleRoleUpdate("embed", model)}
              onConfigure={handleConfigureModel}
              setupURL="https://docs.continue.dev/customize/model-roles/embeddings"
              readOnly
            />

            <Divider />

            <ModelRoleRow
              role="rerank"
              displayName="Rerank"
              description="Used for reranking results from the @codebase and @docs context providers"
              models={config.modelsByRole.rerank}
              selectedModel={config.selectedModelByRole.rerank ?? undefined}
              onSelect={(model) => handleRoleUpdate("rerank", model)}
              onConfigure={handleConfigureModel}
              setupURL="https://docs.continue.dev/customize/model-roles/reranking"
              readOnly
            />
          </div>
        </Toggle>
      </Card>
    </div>
  );
}
