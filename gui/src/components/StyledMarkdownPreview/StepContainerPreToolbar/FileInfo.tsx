import { getLastNPathParts } from "core/util/uri";
import { MouseEventHandler } from "react";
import FileIcon from "../../FileIcon";
import { ToolTip } from "../../gui/Tooltip";

export interface FileInfoProps {
  filepath: string;
  onClick?: MouseEventHandler<HTMLDivElement>;
  range?: string;
}

export const FileInfo = ({ filepath, range, onClick }: FileInfoProps) => {
  return (
    <ToolTip
      style={{
        maxWidth: "200px",
        textAlign: "left",
        whiteSpace: "normal",
        wordBreak: "break-word",
      }}
      content={filepath}
      place="top-end"
    >
      <div
        className={`flex min-w-0 flex-1 flex-row items-center gap-0.5 ${onClick && "cursor-pointer hover:underline"}`}
        onClick={onClick}
      >
        <div className="shrink-0">
          <FileIcon height="20px" width="20px" filename={filepath} />
        </div>
        <span className="min-w-0 truncate">
          {getLastNPathParts(filepath, 1)}
          {range && ` ${range}`}
        </span>
      </div>
    </ToolTip>
  );
};
