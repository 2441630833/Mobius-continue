import { ToolCallState } from "core";
import { UnifiedTerminalCommand } from "../../../components/UnifiedTerminal/UnifiedTerminal";

interface RunTerminalCommandToolCallProps {
  command: string;
  toolCallState: ToolCallState;
  toolCallId: string | undefined;
}

function resolveTerminalOutput(toolCallState: ToolCallState): {
  content: string;
  statusMessage: string;
} {
  const isErrored = toolCallState.status === "errored";

  if (isErrored) {
    const outputItem = toolCallState.output?.[0];
    return {
      content: outputItem?.content || "",
      statusMessage: outputItem?.description || outputItem?.name || "failed",
    };
  }

  const terminalItem = toolCallState.output?.find(
    (item) => item.name === "Terminal",
  );
  if (terminalItem) {
    return {
      content: terminalItem.content || "",
      statusMessage: terminalItem.status || "",
    };
  }

  const combined = (toolCallState.output ?? [])
    .filter((item) => !item.hidden)
    .map((item) => item.content)
    .filter(Boolean)
    .join("\n");

  return {
    content: combined,
    statusMessage: toolCallState.output?.[0]?.status || "",
  };
}

function resolveTerminalStatus(
  toolCallState: ToolCallState,
  statusMessage: string,
): "running" | "completed" | "failed" | "background" | "pending" {
  const { status } = toolCallState;

  if (status === "generating" || status === "generated") {
    return "pending";
  }
  if (status === "calling") {
    return "running";
  }
  if (status === "errored" || statusMessage?.toLowerCase().includes("fail")) {
    return "failed";
  }
  if (statusMessage?.includes("background")) {
    return "background";
  }
  return "completed";
}

export function RunTerminalCommand(props: RunTerminalCommandToolCallProps) {
  const command =
    props.command ||
    (props.toolCallState.parsedArgs?.command as string | undefined) ||
    "";

  const { content: terminalContent, statusMessage } = resolveTerminalOutput(
    props.toolCallState,
  );
  const statusType = resolveTerminalStatus(
    props.toolCallState,
    statusMessage,
  );

  return (
    <UnifiedTerminalCommand
      command={command}
      output={terminalContent}
      status={statusType}
      statusMessage={statusMessage}
      toolCallState={props.toolCallState}
      toolCallId={props.toolCallId}
      inlinePanel
      shellLabel="PowerShell"
    />
  );
}
