import { IDE } from "..";
import { resolveRelativePathInDir } from "./ideUtils";
import { findUriInDirs } from "./uri";

export interface ResolvedPath {
  uri: string;
  displayPath: string;
  isAbsolute: boolean;
  isWithinWorkspace: boolean;
}

/**
 * Browser + Node safe helpers (GUI Vite build cannot import node:url / path / untildify).
 */

function expandTilde(inputPath: string): string {
  if (
    inputPath !== "~" &&
    !inputPath.startsWith("~/") &&
    !inputPath.startsWith("~\\")
  ) {
    return inputPath;
  }

  const home =
    typeof process !== "undefined"
      ? process.env.HOME || process.env.USERPROFILE || ""
      : "";
  if (!home) {
    return inputPath;
  }

  if (inputPath === "~") {
    return home;
  }

  const rest = inputPath.slice(2).replace(/\\/g, "/");
  const homeNormalized = home.replace(/[\\/]+$/, "").replace(/\\/g, "/");
  return `${homeNormalized}/${rest}`;
}

function isAbsolutePath(p: string): boolean {
  return (
    p.startsWith("/") ||
    p.startsWith("\\\\") ||
    p.startsWith("//") ||
    /^[a-zA-Z]:[\\/]/.test(p) ||
    /^[a-zA-Z]:$/.test(p)
  );
}

/** Convert an absolute OS path to a file:// URI (Node pathToFileURL-compatible for common cases). */
export function pathToFileUri(absolutePath: string): string {
  let normalized = absolutePath.replace(/\\/g, "/");

  // UNC //server/share/path -> file://server/share/path
  if (normalized.startsWith("//")) {
    const body = normalized
      .slice(2)
      .split("/")
      .map((part, index) => (index < 2 ? part : encodeURIComponent(part)))
      .join("/");
    return `file://${body}`;
  }

  // Windows drive letter
  if (/^[a-zA-Z]:/.test(normalized)) {
    if (normalized.length === 2) {
      normalized += "/";
    }
    const parts = normalized.split("/");
    const drive = parts[0];
    const rest = parts
      .slice(1)
      .filter((p) => p.length > 0)
      .map(encodeURIComponent)
      .join("/");
    return rest ? `file:///${drive}/${rest}` : `file:///${drive}/`;
  }

  // POSIX absolute
  const encoded = normalized
    .split("/")
    .map((segment) => (segment ? encodeURIComponent(segment) : ""))
    .join("/");
  return `file://${encoded}`;
}

/** Convert a file:// URI to a display filesystem path. */
export function fileUriToPath(fileUri: string): string {
  try {
    const url = new URL(fileUri);
    let pathname = decodeURIComponent(url.pathname);

    // Windows: file:///D:/foo -> /D:/foo -> D:/foo
    if (/^\/[a-zA-Z]:/.test(pathname)) {
      pathname = pathname.slice(1);
    }

    // UNC: file://server/share/path -> //server/share/path
    if (url.host) {
      pathname = `//${url.host}${pathname}`;
    }

    if (
      typeof process !== "undefined" &&
      process.platform === "win32" &&
      !pathname.startsWith("//")
    ) {
      return pathname.replace(/\//g, "\\");
    }
    return pathname;
  } catch {
    return fileUri;
  }
}

/**
 * Checks if a URI is within any of the workspace directories
 * Also verifies the file actually exists, matching the behavior of resolveRelativePathInDir
 */
async function isUriWithinWorkspace(ide: IDE, uri: string): Promise<boolean> {
  const workspaceDirs = await ide.getWorkspaceDirs();
  const { foundInDir } = findUriInDirs(uri, workspaceDirs);

  // Check both: within workspace path AND file exists
  if (foundInDir !== null) {
    return await ide.fileExists(uri);
  }

  return false;
}

export async function resolveInputPath(
  ide: IDE,
  inputPath: string,
): Promise<ResolvedPath | null> {
  const trimmedPath = inputPath.trim();

  // Handle file:// URIs
  if (trimmedPath.startsWith("file://")) {
    const displayPath = fileUriToPath(trimmedPath);
    const isWithinWorkspace = await isUriWithinWorkspace(ide, trimmedPath);
    return {
      uri: trimmedPath,
      displayPath,
      isAbsolute: true,
      isWithinWorkspace,
    };
  }

  // Expand tilde paths (handles ~/ when HOME/USERPROFILE is available)
  const expandedPath = expandTilde(trimmedPath);

  const isAbsolute = isAbsolutePath(expandedPath);

  if (isAbsolute) {
    const uri = pathToFileUri(expandedPath);
    const isWithinWorkspace = await isUriWithinWorkspace(ide, uri);
    return {
      uri,
      displayPath: expandedPath,
      isAbsolute: true,
      isWithinWorkspace,
    };
  }

  // Handle relative paths...
  const workspaceUri = await resolveRelativePathInDir(expandedPath, ide);
  if (workspaceUri) {
    return {
      uri: workspaceUri,
      displayPath: expandedPath,
      isAbsolute: false,
      isWithinWorkspace: true,
    };
  }

  return null;
}
