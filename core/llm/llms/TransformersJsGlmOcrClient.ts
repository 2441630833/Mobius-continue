import path from "path";
import { Worker } from "worker_threads";

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

class GlmOcrWorkerClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (text: string) => void; reject: (e: unknown) => void }
  >();
  private failed = false;
  private ready = false;
  private readonly queue: Array<{
    id: number;
    request: GlmOcrRequest;
  }> = [];

  constructor(private readonly localModelPath: string) {}

  async ocr(request: GlmOcrRequest): Promise<string> {
    const worker = this.ensureWorker();
    const id = this.nextId++;
    return new Promise<string>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.queue.push({ id, request });
      this.flushQueue(worker);
    });
  }

  private flushQueue(worker: Worker) {
    if (!this.ready) {
      return;
    }
    while (this.queue.length > 0) {
      const job = this.queue.shift()!;
      worker.postMessage({
        id: job.id,
        op: "ocr",
        base64: job.request.base64,
        mimeType: job.request.mimeType,
        prompt: job.request.prompt,
        maxNewTokens: job.request.maxNewTokens,
      });
    }
  }

  private ensureWorker(): Worker {
    if (this.failed) {
      throw new Error("GLM-OCR worker unavailable");
    }
    if (this.worker) {
      return this.worker;
    }
    const workerPath = resolveWorkerPath();
    if (!workerPath) {
      this.failed = true;
      throw new Error("GLM-OCR worker bundle not found");
    }
    const worker = new Worker(workerPath, {
      workerData: { localModelPath: this.localModelPath },
      env: workerNodeEnv(),
    });
    worker.on("message", (msg: WorkerResponse) => {
      if (!msg || typeof msg !== "object") {
        return;
      }
      if ("type" in msg && msg.type === "init-error") {
        this.failAll(new Error(msg.error));
        return;
      }
      if ("type" in msg && msg.type === "ready") {
        this.ready = true;
        this.flushQueue(worker);
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
    worker.on("error", (err) => {
      this.failAll(err instanceof Error ? err : new Error(String(err)));
    });
    worker.on("exit", (code) => {
      if (code !== 0) {
        this.failAll(new Error(`GLM-OCR worker exited with code ${code}`));
      }
    });
    this.worker = worker;
    console.log(
      `[MobiusOCR] GLM-OCR worker_threads pid-thread at ${workerPath}`,
    );
    return worker;
  }

  private failAll(err: Error) {
    this.failed = true;
    for (const pending of this.pending.values()) {
      pending.reject(err);
    }
    this.pending.clear();
    this.queue.length = 0;
    try {
      this.worker?.terminate();
    } catch {
      /* ignore */
    }
    this.worker = null;
  }
}

let sharedClient: GlmOcrWorkerClient | null = null;

function workerNodeEnv(): NodeJS.Dict<string> {
  const fs = require("fs") as typeof import("fs");
  const extra = [
    path.join(__dirname, "..", "node_modules"),
    path.join(
      __dirname,
      "..",
      "node_modules",
      "@huggingface",
      "transformers",
      "node_modules",
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
    "models",
  );
}

export async function runGlmOcrViaWorker(
  request: GlmOcrRequest,
): Promise<string> {
  if (!sharedClient) {
    sharedClient = new GlmOcrWorkerClient(resolveLocalModelPath());
  }
  return sharedClient.ocr(request);
}
