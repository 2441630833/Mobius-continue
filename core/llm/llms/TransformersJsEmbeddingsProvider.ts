import path from "path";
import { Worker } from "worker_threads";

import { LLMOptions } from "../../index.js";
import { BaseLLM } from "../../llm/index.js";
// @ts-ignore
// prettier-ignore
import { type PipelineType } from "../../vendor/modules/@xenova/transformers/src/transformers.js";

type EmbedJob<T> = {
  fn: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};

/** Query / retrieval: short lists. Indexing: long lists split into these groups. */
const INTERACTIVE_MAX_CHUNKS = 8;
const BACKGROUND_GROUP_SIZE = 8;

type WorkerResponse =
  | { type: "ready" }
  | { type: "init-error"; error: string }
  | { id: number; ok: true; vectors: number[][] }
  | { id: number; ok: false; error: string };

class MiniLmWorkerClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (v: number[][]) => void; reject: (e: unknown) => void }
  >();
  private failed = false;

  constructor(private readonly localModelPath: string) {}

  async embed(chunks: string[]): Promise<number[][]> {
    const worker = this.ensureWorker();
    const id = this.nextId++;
    return new Promise<number[][]>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ id, op: "embed", chunks });
    });
  }

  get available(): boolean {
    return !this.failed && this.ensureWorker() !== null;
  }

  private ensureWorker(): Worker {
    if (this.failed) {
      throw new Error("MiniLM worker unavailable");
    }
    if (this.worker) {
      return this.worker;
    }
    const workerPath = resolveWorkerPath();
    if (!workerPath) {
      this.failed = true;
      throw new Error("MiniLM worker bundle not found");
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
      if ("id" in msg) {
        const pending = this.pending.get(msg.id);
        if (!pending) {
          return;
        }
        this.pending.delete(msg.id);
        if (msg.ok) {
          pending.resolve(msg.vectors);
        } else {
          pending.reject(new Error(msg.error));
        }
      }
    });
    worker.on("error", (err) => {
      this.failAll(err);
    });
    worker.on("exit", (code) => {
      if (code !== 0) {
        this.failAll(new Error(`MiniLM worker exited with code ${code}`));
      }
    });
    this.worker = worker;
    console.log(
      `[MobiusEmbed] MiniLM worker_threads pid-thread at ${workerPath}`,
    );
    return worker;
  }

  private failAll(err: Error) {
    this.failed = true;
    for (const pending of this.pending.values()) {
      pending.reject(err);
    }
    this.pending.clear();
    try {
      this.worker?.terminate();
    } catch {
      /* ignore */
    }
    this.worker = null;
  }
}

function workerNodeEnv(): NodeJS.Dict<string> {
  const fs = require("fs") as typeof import("fs");
  const extra = [
    path.join(__dirname, "..", "node_modules"),
    path.join(__dirname, "..", "..", "..", "core", "node_modules"),
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
    path.join(__dirname, "transformersJsEmbedWorker.js"),
    path.join(__dirname, "llms", "transformersJsEmbedWorker.js"),
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
      ? // @ts-ignore
        path.dirname(new URL(import.meta.url).pathname)
      : __dirname,
    "..",
    "models",
  );
}

class EmbeddingsPipeline {
  static task: PipelineType = "feature-extraction";
  static model = "all-MiniLM-L6-v2";
  static instance: any | null = null;
  static workerClient: MiniLmWorkerClient | null = null;
  static workerDisabled = false;
  /** Interactive jobs (agent @codebase query) run before background indexing. */
  static high: EmbedJob<any>[] = [];
  static low: EmbedJob<any>[] = [];
  static running = false;
  static backgroundPaused = false;

  static setBackgroundPaused(paused: boolean) {
    EmbeddingsPipeline.backgroundPaused = paused;
    if (!paused) {
      void EmbeddingsPipeline.pump();
    }
  }

  static async embedChunks(group: string[]): Promise<number[][]> {
    if (!EmbeddingsPipeline.workerDisabled) {
      try {
        if (!EmbeddingsPipeline.workerClient) {
          EmbeddingsPipeline.workerClient = new MiniLmWorkerClient(
            resolveLocalModelPath(),
          );
        }
        return await EmbeddingsPipeline.workerClient.embed(group);
      } catch (err) {
        EmbeddingsPipeline.workerDisabled = true;
        console.warn(
          "[MobiusEmbed] MiniLM worker unavailable, falling back to in-process ONNX",
          err,
        );
      }
    }
    return EmbeddingsPipeline.embedInProcess(group);
  }

  static async getInstance() {
    if (EmbeddingsPipeline.instance === null) {
      // @ts-ignore
      // prettier-ignore
      const { env, pipeline } = await import("../../vendor/modules/@xenova/transformers/src/transformers.js");

      env.allowLocalModels = true;
      env.allowRemoteModels = false;
      env.localModelPath = resolveLocalModelPath();

      EmbeddingsPipeline.instance = await pipeline(
        EmbeddingsPipeline.task,
        EmbeddingsPipeline.model,
      );
    }

    return EmbeddingsPipeline.instance;
  }

  private static async embedInProcess(group: string[]): Promise<number[][]> {
    const extractor = await EmbeddingsPipeline.getInstance();
    if (!extractor) {
      throw new Error("TransformerJS embeddings pipeline is not initialized");
    }
    const output = await extractor(group, {
      pooling: "mean",
      normalize: true,
    });
    return output.tolist();
  }

  static enqueue<T>(fn: () => Promise<T>, interactive: boolean): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const job: EmbedJob<T> = { fn, resolve, reject };
      if (interactive) {
        EmbeddingsPipeline.high.push(job);
      } else {
        EmbeddingsPipeline.low.push(job);
      }
      void EmbeddingsPipeline.pump();
    });
  }

  private static async pump() {
    if (EmbeddingsPipeline.running) {
      return;
    }
    EmbeddingsPipeline.running = true;
    try {
      while (
        EmbeddingsPipeline.high.length > 0 ||
        (!EmbeddingsPipeline.backgroundPaused &&
          EmbeddingsPipeline.low.length > 0)
      ) {
        const job = EmbeddingsPipeline.high.shift()
          ?? (EmbeddingsPipeline.backgroundPaused
            ? undefined
            : EmbeddingsPipeline.low.shift());
        if (!job) {
          break;
        }
        try {
          job.resolve(await job.fn());
        } catch (err) {
          job.reject(err);
        }
      }
    } finally {
      EmbeddingsPipeline.running = false;
      if (
        EmbeddingsPipeline.high.length > 0 ||
        (!EmbeddingsPipeline.backgroundPaused &&
          EmbeddingsPipeline.low.length > 0)
      ) {
        void EmbeddingsPipeline.pump();
      }
    }
  }
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof setImmediate === "function") {
      setImmediate(resolve);
    } else {
      setTimeout(resolve, 0);
    }
  });
}

/** Pause bulk codebase indexing embeds; interactive query embeds still run. */
export function setTransformersJsBackgroundPaused(paused: boolean): void {
  EmbeddingsPipeline.setBackgroundPaused(paused);
  console.log(
    `[MobiusEmbed] background MiniLM queue ${paused ? "paused" : "resumed"}`,
  );
}

export class TransformersJsEmbeddingsProvider extends BaseLLM {
  static providerName = "transformers.js";
  static maxGroupSize: number = 8;
  static model: string = "all-MiniLM-L6-v2";
  static mockVector: number[] = Array.from({ length: 384 }).fill(2) as number[];

  static defaultOptions: Partial<LLMOptions> | undefined = {
    model: TransformersJsEmbeddingsProvider.model,
  };

  constructor() {
    super({
      model: TransformersJsEmbeddingsProvider.model,
      title: "Transformers.js (Built-In)",
    });
    console.log(
      "[MobiusEmbed] provider=transformers.js model=all-MiniLM-L6-v2 (worker_threads ONNX)",
    );
  }

  async embed(chunks: string[]) {
    if (process.env.NODE_ENV === "test") {
      return chunks.map(() => TransformersJsEmbeddingsProvider.mockVector);
    }

    if (chunks.length === 0) {
      return [];
    }

    const runGroup = async (group: string[]) => {
      const started = Date.now();
      const outputs: number[][] = [];
      for (
        let i = 0;
        i < group.length;
        i += TransformersJsEmbeddingsProvider.maxGroupSize
      ) {
        const chunkGroup = group.slice(
          i,
          i + TransformersJsEmbeddingsProvider.maxGroupSize,
        );
        outputs.push(...(await EmbeddingsPipeline.embedChunks(chunkGroup)));
        await yieldToEventLoop();
      }
      console.log(
        `[MobiusEmbed] onnx chunks=${group.length} ms=${Date.now() - started} worker=${!EmbeddingsPipeline.workerDisabled}`,
      );
      return outputs;
    };

    if (chunks.length <= INTERACTIVE_MAX_CHUNKS) {
      console.log(
        `[MobiusEmbed] enqueue interactive=true chunks=${chunks.length}`,
      );
      return EmbeddingsPipeline.enqueue(() => runGroup(chunks), true);
    }

    console.log(
      `[MobiusEmbed] enqueue interactive=false chunks=${chunks.length}`,
    );

    const out: number[][] = [];
    for (let i = 0; i < chunks.length; i += BACKGROUND_GROUP_SIZE) {
      const group = chunks.slice(i, i + BACKGROUND_GROUP_SIZE);
      const part = await EmbeddingsPipeline.enqueue(
        () => runGroup(group),
        false,
      );
      out.push(...part);
    }
    return out;
  }
}

export default TransformersJsEmbeddingsProvider;
