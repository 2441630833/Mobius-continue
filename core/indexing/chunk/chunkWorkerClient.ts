/**
 * Client for the tree-sitter worker (chunkWorker.ts).
 *
 * Guarantees: a pathological file can make tree-sitter's WASM parser loop
 * forever, and web-tree-sitter allocations can wedge inside malloc once the
 * shared WASM heap is exhausted. Running all index-volume tree-sitter work
 * (chunking, symbols, snippets) on a worker thread means the worst case is a
 * terminated worker + fallback, never a frozen extension host.
 */
import path from "path";
import { Worker } from "worker_threads";

import type { ChunkWithoutID, SymbolWithRange } from "../../index.js";
import type { SnippetChunk } from "../../util/treeSitter.js";

const TREE_SITTER_WORKER_TIMEOUT_MS = 30_000;

export type TreeSitterWorkerRequest =
  | {
      id: number;
      op: "chunk";
      fileUri: string;
      contents: string;
      maxChunkSize: number;
    }
  | { id: number; op: "symbols"; filepath: string; contents: string }
  | { id: number; op: "snippets"; filepath: string; contents: string };

type WorkerOk = { id: number; ok: true; result: unknown };
type WorkerErr = { id: number; ok: false; error: string };
type WorkerResponse = WorkerOk | WorkerErr;

type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

class TreeSitterWorkerClient {
  private worker: Worker | null = null;
  private workerPath: string | null = null;
  private failed = false;
  private nextId = 1;
  private pending = new Map<number, Pending>();

  get available(): boolean {
    return !this.failed && this.resolveWorkerPath() !== null;
  }

  private request<T>(payload: TreeSitterWorkerRequest): Promise<T> {
    const worker = this.ensureWorker();
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        // The worker is wedged (e.g. infinite tree-sitter parse, or malloc
        // stuck on an exhausted WASM heap). Kill it, fail every pending
        // request, and let the caller fall back. A fresh worker is spawned
        // on the next request.
        this.failAll(
          new Error(
            `Tree-sitter worker timed out after ${TREE_SITTER_WORKER_TIMEOUT_MS}ms for op=${payload.op}`,
          ),
        );
      }, TREE_SITTER_WORKER_TIMEOUT_MS);
      this.pending.set(id, {
        resolve: resolve as unknown as (value: unknown) => void,
        reject,
        timer,
      });
      worker.postMessage({ ...payload, id });
    });
  }

  async chunk(
    fileUri: string,
    contents: string,
    maxChunkSize: number,
  ): Promise<ChunkWithoutID[]> {
    return this.request<ChunkWithoutID[]>({
      id: 0, // overwritten in request()
      op: "chunk",
      fileUri,
      contents,
      maxChunkSize,
    });
  }

  async symbols(
    filepath: string,
    contents: string,
  ): Promise<SymbolWithRange[] | undefined> {
    return this.request<SymbolWithRange[] | undefined>({
      id: 0,
      op: "symbols",
      filepath,
      contents,
    });
  }

  async snippets(filepath: string, contents: string): Promise<SnippetChunk[]> {
    return this.request<SnippetChunk[]>({
      id: 0,
      op: "snippets",
      filepath,
      contents,
    });
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
      throw new Error("Tree-sitter worker unavailable");
    }
    if (this.worker) {
      return this.worker;
    }
    const workerPath = this.resolveWorkerPath();
    if (!workerPath) {
      this.failed = true;
      throw new Error("Tree-sitter worker bundle not found");
    }
    const worker = new Worker(workerPath);
    worker.on("message", (msg: WorkerResponse) => {
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
        pending.resolve(msg.result);
      } else {
        pending.reject(new Error(msg.error));
      }
    });
    worker.on("error", (err) => {
      this.failAll(err instanceof Error ? err : new Error(String(err)));
    });
    worker.on("exit", (code) => {
      if (code !== 0) {
        this.failAll(new Error(`Tree-sitter worker exited with code ${code}`));
      }
    });
    this.worker = worker;
    console.log(`[MobiusTreeSitter] worker_threads at ${workerPath}`);
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

let client: TreeSitterWorkerClient | null = null;

function getClient(): TreeSitterWorkerClient {
  if (!client) {
    client = new TreeSitterWorkerClient();
  }
  return client;
}

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
  return getClient().chunk(fileUri, contents, maxChunkSize);
}

/**
 * Extract symbols on the worker thread. Throws on timeout/error — callers
 * fall back to the pooled main-thread parser.
 */
export async function symbolsInWorker(
  filepath: string,
  contents: string,
): Promise<SymbolWithRange[] | undefined> {
  return getClient().symbols(filepath, contents);
}

/**
 * Extract code snippets on the worker thread. Throws on timeout/error —
 * callers fall back to the pooled main-thread parser.
 */
export async function snippetsInWorker(
  filepath: string,
  contents: string,
): Promise<SnippetChunk[]> {
  return getClient().snippets(filepath, contents);
}
