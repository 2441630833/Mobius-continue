/** Sync with config/ollama.port and physicalAiModelEnv.ts BUNDLED_OLLAMA_PORT */
export const BUNDLED_OLLAMA_PORT = 25137;

export function isBundledOllamaApiBase(apiBase?: string): boolean {
  if (!apiBase) {
    return false;
  }
  return new RegExp(
    `(?:localhost|127\\.0\\.0\\.1):${BUNDLED_OLLAMA_PORT}`,
  ).test(apiBase);
}

/**
 * Retired local chat models on the IDE-managed Ollama instance.
 * Used to hide them from the chat picker (Ollama is OCR only).
 */
export function isLocalBundledModel(model: {
  title?: string;
  model?: string;
  provider?: string;
  underlyingProviderName?: string;
  apiBase?: string;
}): boolean {
  if (model.model === "nomic-embed-text" || model.model === "glm-ocr") {
    return false;
  }
  if (
    model.title &&
    /\(Local\)$/i.test(model.title) &&
    /^Qwen/i.test(model.title)
  ) {
    return true;
  }
  if (model.model && /^qwen3\.5:/i.test(model.model)) {
    return true;
  }
  const provider = (
    model.provider ??
    model.underlyingProviderName ??
    ""
  ).toLowerCase();
  if (provider !== "ollama") {
    return false;
  }
  return isBundledOllamaApiBase(model.apiBase);
}
