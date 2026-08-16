/**
 * Map Copilot / IDE Agents window tool names → Continue built-in names.
 * Models often emit the former when rules/prompts mention them; GUI Agent mode
 * only registers Continue names in config.tools.
 */
const COPILOT_TO_CONTINUE_TOOL_NAMES: Record<string, string> = {
  create_file: "create_new_file",
  list_dir: "ls",
  semantic_search: "codebase",
  file_search: "file_glob_search",
  replace_string_in_file: "single_find_and_replace",
  multi_replace_string_in_file: "multi_edit",
  insert_edit_into_file: "edit_existing_file",
  fetch_webpage: "fetch_url_content",
  run_in_terminal: "run_terminal_command",
  // get_errors / get_problems are workbench-local — no Continue core tool
};

export function resolveContinueToolName(
  name: string | undefined | null,
): string {
  const raw = typeof name === "string" ? name.trim() : "";
  if (!raw) {
    return "";
  }
  return COPILOT_TO_CONTINUE_TOOL_NAMES[raw] ?? raw;
}
