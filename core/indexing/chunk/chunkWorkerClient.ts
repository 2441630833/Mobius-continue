/**
 * Client for the code-chunking worker (chunkWorker.ts).
 *
 * Guarantees: a pathological file can make tree-sitter's WASM parser loop
 * forever. Running chunking on a worker thread means the worst case is a
 * terminated worker + basicChunker fallback, never a frozen extension host.
 */
import path from "path";
import { Worker } from "worker_threads";

import { ChunkWithoutID } from "../../index.js";

const CHUNK_WORKER_TIMEOUT_MS = 30_000;

type ChunkRequest = {
  id: number;
  op: "chunk";
  fileUri: string;
  contents: string;
  maxChunkSize: number;
};

type ChunkOk = { id: number; ok: true; chunks: ChunkWithoutID[] };
type ChunkErr = { id: number; ok: false; error: string };
type ChunkResponse = ChunkOk | ChunkErr;

type Pending = {
  resolve: (chunks: ChunkWithoutID[]) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

class ChunkWorkerClient {
  private worker: Worker | null = null;
  private workerPath: string | null = null;
  private failed = false;
  private nextId = 1;
  private pending = new Map<number, Pending>();

  async chunk(
    fileUri: string,
    contents: string,
    maxChunkSize: number,
  ): Promise<ChunkWithoutID[]> {
    const worker = this.ensureWorker();
    const id = this.nextId++;
    return new Promise<ChunkWithoutID[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        // The worker is wedged (e.g. infinite tree-sitter parse on this file).
        // Kill it, fail every pending request, and let the caller fall back.
        this.failAll(
          new Error(
            `Chunking timed out after ${CHUNK_WORKER_TIMEOUT_MS}ms for ${fileUri}`,
          ),
        );
      }, CHUNK_WORKER_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      worker.postMessage({
        id,
        op: "chunk",
        fileUri,
        contents,
        maxChunkSize,
      } satisfies ChunkRequest);
    });
  }

  get available(): boolean {
    return !this.failed && this.resolveWorkerPath() !== null;
  }

  private resolveWorkerPath(): string | null {
    if (this.workerPath) {
      return this.workerPath;
    }
    const fs = require("fs") as typeof import("fs");
    for (const candidate of [
      path.join(__dirname, "chunkWorker.js"),
      path.join(__dirname, "indexing", "chunk", "chunkWorker.js"),
    ]) {
      try {
        if (fs.existsSync(candidate)) {
          this.workerPath = candidate;
          return candidate;
        }
      } catch {
        // ignore
      }
    }
    return null;
  }

  private ensureWorker(): Worker {
    if (this.failed) {
      throw new Error("Chunk worker unavailable");
    }
    if (this.worker) {
      return this.worker;
    }
    const workerPath = this.resolveWorkerPath();
    if (!workerPath) {
      this.failed = true;
      throw new Error("Chunk worker bundle not found");
    }
    const worker = new Worker(workerPath);
    worker.on("message", (msg: ChunkResponse) => {
      if (!msg || typeof msg !== "object" || !("id" in msg)) {
        return;
      }
      const pending = this.pending.get(msg.id);
      if (!pending) {
        return;
      }
      this.pending.delete(msg.id);
      clearTimeout(pending.timer);
      if (msg.ok) {
        pending.resolve(msg.chunks);
      } else {
        pending.reject(new Error(msg.error));
      }
    });
    worker.on("error", (err) => {
      this.failAll(err instanceof Error ? err : new Error(String(err)));
    });
    worker.on("exit", (code) => {
      if (code !== 0) {
        this.failAll(new Error(`Chunk worker exited with code ${code}`));
      }
    });
    this.worker = worker;
    console.log(`[MobiusChunk] chunk worker_threads at ${workerPath}`);
    return worker;
  }

  private failAll(err: Error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(err);
    }
    this.pending.clear();
    if (this.worker) {
      try {
        void this.worker.terminate();
      } catch {
        // ignore
      }
    }
    this.worker = null;
  }
}

let client: ChunkWorkerClient | null = null;

/**
 * Chunk a document on the worker thread. Throws if the worker is unavailable,
 * errored, or the chunking exceeded the timeout — callers fall back to the
 * main-thread codeChunker / basicChunker paths.
 */
export async function chunkInWorker(
  fileUri: string,
  contents: string,
  maxChunkSize: number,
): Promise<ChunkWithoutID[]> {
  if (!client) {
    client = new ChunkWorkerClient();
  }
  return client.chunk(fileUri, contents, maxChunkSize);
}
