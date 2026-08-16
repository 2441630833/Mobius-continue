import crypto from "crypto";
import { ChildProcess, exec, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { IDE } from "..";

export interface ModelInfo {
  id: string;
  size: number;
  digest: string;
}

export type StartLocalOllamaOptions = {
  appRoot?: string;
  workspaceRoot?: string;
};

export const BUNDLED_OLLAMA_PORT = 25137;
const BUNDLED_OLLAMA_HOST = `127.0.0.1:${BUNDLED_OLLAMA_PORT}`;

export async function isOllamaInstalled(
  options: StartLocalOllamaOptions = {},
): Promise<boolean> {
  if (
    resolveBundledOllamaDir({
      appRoot: options.appRoot ?? process.env.VSCODE_APP_ROOT,
      workspaceRoot: options.workspaceRoot,
    })
  ) {
    return true;
  }

  return new Promise((resolve) => {
    const command =
      process.platform === "win32" ? "where.exe ollama" : "which ollama";
    exec(command, (error) => {
      resolve(!error);
    });
  });
}

export async function getRemoteModelInfo(
  modelId: string,
  signal?: AbortSignal,
): Promise<ModelInfo | undefined> {
  const start = Date.now();
  const [modelName, tag = "latest"] = modelId.split(":");
  const url = `https://registry.ollama.ai/v2/library/${modelName}/manifests/${tag}`;
  try {
    const sig = signal ?? AbortSignal.timeout(3000);
    const response = await fetch(url, { signal: sig });

    if (!response.ok) {
      throw new Error(`Failed to fetch the model page: ${response.statusText}`);
    }

    const buffer = await response.arrayBuffer();
    const digest = getDigest(buffer);

    const text = new TextDecoder().decode(buffer);
    const manifest = JSON.parse(text) as {
      config: { size: number };
      layers: { size: number }[];
    };
    const modelSize =
      manifest.config.size +
      manifest.layers.reduce((sum, layer) => sum + layer.size, 0);

    return {
      id: modelId,
      size: modelSize,
      digest,
    };
  } catch (error) {
    console.error(`Error fetching or parsing model info: ${error}`);
  } finally {
    const elapsed = Date.now() - start;
    console.log(`Fetched remote information for ${modelId} in ${elapsed} ms`);
  }
  return undefined;
}

function getDigest(buffer: ArrayBuffer): string {
  const hash = crypto.createHash("sha256");
  hash.update(new Uint8Array(buffer));
  return hash.digest("hex");
}

let serveProcess: ChildProcess | null = null;
let startPromise: Promise<void> | null = null;

function fileUriToPath(uri: string): string {
  try {
    if (uri.startsWith("file://")) {
      return decodeURIComponent(
        new URL(uri).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
      );
    }
  } catch {
    // fall through
  }
  return uri;
}

function dirHasBundledOllama(dir: string): boolean {
  return (
    fs.existsSync(path.join(dir, "bin-amd64", "ollama.exe")) ||
    fs.existsSync(path.join(dir, "bin-arm64", "ollama.exe")) ||
    fs.existsSync(path.join(dir, "bin-amd64", "ollama")) ||
    fs.existsSync(path.join(dir, "bin-arm64", "ollama"))
  );
}

export function resolveBundledOllamaDir(
  options: StartLocalOllamaOptions = {},
): string | undefined {
  const candidates: string[] = [];

  if (options.appRoot) {
    candidates.push(path.join(options.appRoot, "..", "ollama"));
    candidates.push(
      path.join(options.appRoot, "..", "..", "resources", "ollama"),
    );
  }

  if (options.workspaceRoot) {
    candidates.push(path.join(options.workspaceRoot, "resources", "ollama"));
  }

  if (process.env.MOBIUS_ROOT) {
    candidates.push(path.join(process.env.MOBIUS_ROOT, "resources", "ollama"));
  }

  candidates.push(path.join(process.cwd(), "resources", "ollama"));

  for (const candidate of candidates) {
    const normalized = path.normalize(candidate);
    if (dirHasBundledOllama(normalized)) {
      return normalized;
    }
  }

  return undefined;
}

function getWindowsCpuArch(): "amd64" | "arm64" {
  if (process.arch === "arm64") {
    return "arm64";
  }
  return "amd64";
}

function getOllamaExe(ollamaRoot: string): string | undefined {
  const arch = getWindowsCpuArch();
  const binDir = path.join(ollamaRoot, `bin-${arch}`);
  const winExe = path.join(binDir, "ollama.exe");
  if (fs.existsSync(winExe)) {
    return winExe;
  }
  const unixBin = path.join(binDir, "ollama");
  if (fs.existsSync(unixBin)) {
    return unixBin;
  }
  return undefined;
}

async function isOllamaServerRunning(): Promise<boolean> {
  try {
    const response = await fetch(`http://${BUNDLED_OLLAMA_HOST}/api/version`, {
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForOllamaServer(timeoutMs = 120_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isOllamaServerRunning()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

/**
 * User-writable OLLAMA_HOME. Install-dir home fails under Program Files
 * (system setup) because non-admin users cannot write there.
 */
export function resolveWritableOllamaHome(): string {
  if (process.platform === "win32") {
    const appData =
      process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, "Mobius", "ollama", "home");
  }
  return path.join(os.homedir(), ".mobius", "ollama", "home");
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function ensureOllamaRuntimeDirs(ollamaRoot: string, ollamaHome: string): void {
  ensureDir(ollamaHome);
  // Models stay in the install tree (read by Ollama); only create if missing
  // in writable locations (dev tree). Ignore EPERM under Program Files.
  for (const name of ["models", `bin-${getWindowsCpuArch()}`]) {
    const dir = path.join(ollamaRoot, name);
    try {
      ensureDir(dir);
    } catch (err) {
      if (!fs.existsSync(dir)) {
        throw err;
      }
    }
  }
}

async function startBundledOllamaServer(
  options: StartLocalOllamaOptions,
): Promise<void> {
  if (await isOllamaServerRunning()) {
    return;
  }

  const ollamaRoot = resolveBundledOllamaDir(options);
  if (!ollamaRoot) {
    console.warn(
      "[Ollama] Bundled runtime not found. Looked relative to appRoot=",
      options.appRoot,
      "workspaceRoot=",
      options.workspaceRoot,
    );
    return;
  }

  const exe = getOllamaExe(ollamaRoot);
  if (!exe) {
    console.warn(
      `[Ollama] Bundled ollama executable missing under ${ollamaRoot} (arch=${getWindowsCpuArch()})`,
    );
    return;
  }

  const ollamaHome = resolveWritableOllamaHome();
  const ollamaModels = path.join(ollamaRoot, "models");
  ensureOllamaRuntimeDirs(ollamaRoot, ollamaHome);

  const env = {
    ...process.env,
    OLLAMA_HOME: ollamaHome,
    OLLAMA_MODELS: ollamaModels,
    OLLAMA_HOST: BUNDLED_OLLAMA_HOST,
  };

  if (serveProcess && !serveProcess.killed) {
    return;
  }

  console.log(
    `[Ollama] Starting bundled server: exe=${exe} host=${BUNDLED_OLLAMA_HOST} home=${ollamaHome} models=${ollamaModels}`,
  );

  serveProcess = spawn(exe, ["serve"], {
    cwd: path.dirname(exe),
    env,
    stdio: "ignore",
    detached: false,
    windowsHide: true,
  });

  serveProcess.on("error", (err) => {
    console.warn("[Ollama] Failed to spawn bundled server:", err);
    serveProcess = null;
  });

  serveProcess.on("exit", (code, signal) => {
    if (code !== 0 && code !== null) {
      console.warn(
        `[Ollama] Bundled server exited unexpectedly (code=${code}, signal=${signal})`,
      );
    }
    serveProcess = null;
  });

  const ready = await waitForOllamaServer();
  if (!ready) {
    if (serveProcess && !serveProcess.killed) {
      serveProcess.kill();
      serveProcess = null;
    }
    throw new Error(
      `Timed out waiting for bundled Ollama at http://${BUNDLED_OLLAMA_HOST}`,
    );
  }
}

export async function startLocalOllama(
  ideOrOptions?: IDE | StartLocalOllamaOptions,
): Promise<void> {
  if (startPromise) {
    return startPromise;
  }

  startPromise = (async () => {
    const options: StartLocalOllamaOptions = {};

    if (ideOrOptions && "getWorkspaceDirs" in ideOrOptions) {
      const dirs = await ideOrOptions.getWorkspaceDirs().catch(() => []);
      if (dirs[0]) {
        options.workspaceRoot = fileUriToPath(dirs[0]);
      }
    } else if (ideOrOptions) {
      Object.assign(options, ideOrOptions);
    }

    if (
      os.platform() !== "win32" &&
      !options.appRoot &&
      !options.workspaceRoot
    ) {
      return;
    }

    await startBundledOllamaServer(options);
  })();

  try {
    await startPromise;
  } catch (err) {
    console.warn("Failed to start bundled Ollama:", err);
    throw err;
  } finally {
    startPromise = null;
  }
}

function resolvePackagedConfigPath(
  fileName: string,
  appRoot?: string,
): string | undefined {
  const candidates: string[] = [];
  if (appRoot) {
    candidates.push(path.join(appRoot, "..", "..", "config", fileName));
  }
  if (process.env.MOBIUS_ROOT) {
    candidates.push(path.join(process.env.MOBIUS_ROOT, "config", fileName));
  }
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

export function resolvePackagedContinueConfigTemplate(
  appRoot?: string,
): string | undefined {
  return resolvePackagedConfigPath("continue-config.yaml", appRoot);
}

/** Packaged installer default Cloud settings (`config/.env` next to resources/). */
export function resolvePackagedModelEnvPath(
  appRoot?: string,
): string | undefined {
  return resolvePackagedConfigPath(".env", appRoot);
}
