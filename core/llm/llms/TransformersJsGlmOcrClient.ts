/**
 * GLM-OCR client — runs inference in a forked Node process so onnxruntime-node
 * does not share the Electron extension-host with MiniLM's worker_threads ORT.
 */
import { ChildProcess, fork } from "child_process";
import path from "path";

export type GlmOcrRequest = {
  base64: string;
  mimeType: string;
  prompt?: string;
  maxNewTokens?: number;
};

type WorkerResponse =
  | { type: "ready" }
  | { type: "init-error"; error: string }
  | { id: number; ok: true; text: string }
  | { id: number; ok: false; error: string };

/** How long to wait for the forked worker to finish ONNX init + warmup. */
const GLM_OCR_READY_TIMEOUT_MS = 45_000;

export class GlmOcrForkClient {
  private child: ChildProcess | null = null;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (text: string) => void; reject: (e: unknown) => void }
  >();
  private failed = false;
  private ready = false;
  private readyTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly queue: Array<{
    id: number;
    request: GlmOcrRequest;
  }> = [];

  constructor(private readonly localModelPath: string) {}

  async ocr(request: GlmOcrRequest): Promise<string> {
    const child = this.ensureChild();
    const id = this.nextId++;
    return new Promise<string>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.queue.push({ id, request });
      this.flushQueue(child);
    });
  }

  /** Kill the child and reject in-flight work (e.g. parent timeout). */
  reset(reason = "GLM-OCR canceled"): void {
    this.failAll(new Error(reason));
  }

  private flushQueue(child: ChildProcess) {
    if (!this.ready || !child.connected) {
      return;
    }
    while (this.queue.length > 0) {
      const job = this.queue.shift()!;
      child.send({
        id: job.id,
        op: "ocr",
        base64: job.request.base64,
        mimeType: job.request.mimeType,
        prompt: job.request.prompt,
        maxNewTokens: job.request.maxNewTokens,
      });
    }
  }

  private ensureChild(): ChildProcess {
    if (this.failed) {
      throw new Error("GLM-OCR worker unavailable");
    }
    if (this.child && !this.child.killed) {
      return this.child;
    }
    const workerPath = resolveWorkerPath();
    if (!workerPath) {
      this.failed = true;
      throw new Error("GLM-OCR worker bundle not found");
    }

    const env = workerNodeEnv(this.localModelPath);
    let stderrTail = "";
    const child = fork(workerPath, [], {
      env,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      // Electron extension host: fork(Mobius.exe) without this opens a new UI.
      execArgv: [],
    });

    this.clearReadyTimer();
    this.readyTimer = setTimeout(() => {
      if (this.ready || this.child !== child) {
        return;
      }
      this.failAll(
        new Error(
          `GLM-OCR worker did not become ready within ${GLM_OCR_READY_TIMEOUT_MS}ms (ONNX init hang or missing models). Set MOBIUS_GLM_OCR_DEVICE=cpu if GPU EPs fail.${
            stderrTail ? `\n${stderrTail}` : ""
          }`
        )
      );
    }, GLM_OCR_READY_TIMEOUT_MS);
    this.readyTimer.unref?.();

    child.on("message", (msg: WorkerResponse) => {
      if (this.child !== child) return;
      if (!msg || typeof msg !== "object") {
        return;
      }
      if ("type" in msg && msg.type === "init-error") {
        this.clearReadyTimer();
        this.failAll(new Error(msg.error));
        return;
      }
      if ("type" in msg && msg.type === "ready") {
        this.clearReadyTimer();
        this.ready = true;
        if (
          "device" in msg &&
          typeof (msg as { device?: string }).device === "string"
        ) {
          console.log(
            `[MobiusOCR] child ready device=${
              (msg as { device: string }).device
            }`
          );
        }
        this.flushQueue(child);
        return;
      }
      if ("id" in msg) {
        const pending = this.pending.get(msg.id);
        if (!pending) {
          return;
        }
        this.pending.delete(msg.id);
        if (msg.ok) {
          pending.resolve(msg.text);
        } else {
          pending.reject(new Error(msg.error));
        }
      }
    });
    child.on("error", (err) => {
      if (this.child !== child) return;
      this.failAll(err instanceof Error ? err : new Error(String(err)));
    });
    // close follows drained stderr; exit may precede the useful loader error.
    child.on("close", (code, signal) => {
      if (this.child !== child) return;
      this.clearReadyTimer();
      if (this.pending.size > 0 || this.queue.length > 0) {
        this.failAll(
          new Error(
            `GLM-OCR process exited (code=${code ?? "null"} signal=${
              signal ?? "null"
            }) on ${process.platform}/${process.arch}${
              stderrTail ? `\n${stderrTail}` : ""
            }`
          )
        );
      } else {
        this.child = null;
        this.ready = false;
      }
    });
    child.stderr?.on("data", (buf: Buffer) => {
      stderrTail = (stderrTail + buf.toString("utf8")).slice(-6000);
      const line = buf.toString("utf8").trim();
      if (line) {
        console.warn(`[MobiusOCR] child stderr: ${line.slice(0, 500)}`);
      }
    });

    this.child = child;
    this.ready = false;
    console.log(
      `[MobiusOCR] GLM-OCR forked pid=${child.pid} at ${workerPath} (ELECTRON_RUN_AS_NODE)`
    );
    return child;
  }

  private clearReadyTimer() {
    if (this.readyTimer) {
      clearTimeout(this.readyTimer);
      this.readyTimer = null;
    }
  }

  private failAll(err: Error) {
    this.clearReadyTimer();
    this.failed = true;
    this.ready = false;
    for (const pending of this.pending.values()) {
      pending.reject(err);
    }
    this.pending.clear();
    this.queue.length = 0;
    const child = this.child;
    this.child = null;
    if (child && !child.killed) {
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      setTimeout(() => {
        try {
          if (!child.killed) {
            child.kill("SIGKILL");
          }
        } catch {
          /* ignore */
        }
      }, 2_000).unref?.();
    }
    // Allow a later request to spawn a fresh process.
    this.failed = false;
  }
}

let sharedClient: GlmOcrForkClient | null = null;

function workerNodeEnv(localModelPath: string): NodeJS.Dict<string> {
  const fs = require("fs") as typeof import("fs");
  const extra = [
    path.join(__dirname, "glm-ocr-runtime", "node_modules"),
    // Worker lives in out/ — prefer out/node_modules for @huggingface/transformers.
    path.join(__dirname, "node_modules"),
    path.join(__dirname, "..", "node_modules"),
    path.join(
      __dirname,
      "node_modules",
      "@huggingface",
      "transformers",
      "node_modules"
    ),
    path.join(
      __dirname,
      "..",
      "node_modules",
      "@huggingface",
      "transformers",
      "node_modules"
    ),
    path.join(__dirname, "..", "..", "..", "core", "node_modules"),
    path.join(__dirname, "..", "..", "node_modules"),
  ].filter((candidate) => {
    try {
      return fs.existsSync(candidate);
    } catch {
      return false;
    }
  });
  const existing = process.env.NODE_PATH
    ? process.env.NODE_PATH.split(path.delimiter)
    : [];
  return {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    GLM_OCR_LOCAL_MODEL_PATH: localModelPath,
    // Mild cap — full default can oversubscribe; 1 was too slow for the 180s UI budget.
    OMP_NUM_THREADS: process.env.OMP_NUM_THREADS ?? "4",
    ORT_INTRA_OP_NUM_THREADS: process.env.ORT_INTRA_OP_NUM_THREADS ?? "4",
    ORT_INTER_OP_NUM_THREADS: process.env.ORT_INTER_OP_NUM_THREADS ?? "1",
    NODE_PATH: [...extra, ...existing].filter(Boolean).join(path.delimiter),
  };
}

function resolveWorkerPath(): string | null {
  const fs = require("fs") as typeof import("fs");
  const candidates = [
    path.join(__dirname, "transformersJsGlmOcrWorker.js"),
    path.join(__dirname, "llms", "transformersJsGlmOcrWorker.js"),
    path.join(__dirname, "..", "..", "out", "transformersJsGlmOcrWorker.js"),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

function resolveLocalModelPath(): string {
  return path.join(
    typeof __dirname === "undefined"
      ? path.dirname(new URL(import.meta.url).pathname)
      : __dirname,
    "..",
    "models"
  );
}

function getSharedClient(): GlmOcrForkClient {
  if (!sharedClient) {
    sharedClient = new GlmOcrForkClient(resolveLocalModelPath());
  }
  return sharedClient;
}

export async function runGlmOcrViaWorker(
  request: GlmOcrRequest
): Promise<string> {
  return getSharedClient().ocr(request);
}

/** Terminate in-flight OCR (timeout / cancel). Next call spawns a fresh process. */
export function cancelGlmOcrViaWorker(reason?: string): void {
  if (!sharedClient) {
    return;
  }
  sharedClient.reset(reason ?? "GLM-OCR canceled");
}
