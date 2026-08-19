/**
 * MiniLM embedding Worker (worker_threads).
 * Loaded as a separate esbuild bundle so ONNX does not run on the extension-host event loop.
 */
import path from "path";
import { parentPort, workerData } from "worker_threads";

// @ts-ignore
// prettier-ignore
import { env, pipeline } from "../../vendor/modules/@xenova/transformers/src/transformers.js";

type EmbedRequest = {
  id: number;
  op: "embed";
  chunks: string[];
};

type ReadyMessage = { type: "ready" };
type EmbedOk = { id: number; ok: true; vectors: number[][] };
type EmbedErr = { id: number; ok: false; error: string };

let extractorPromise: Promise<any> | null = null;

function localModelPath(): string {
  const fromData =
    workerData && typeof workerData === "object"
      ? (workerData as { localModelPath?: string }).localModelPath
      : undefined;
  if (fromData) {
    return fromData;
  }
  return path.join(__dirname, "..", "models");
}

function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      env.allowLocalModels = true;
      env.allowRemoteModels = false;
      env.localModelPath = localModelPath();
      const ex = await pipeline("feature-extraction", "all-MiniLM-L6-v2");
      const ready: ReadyMessage = { type: "ready" };
      parentPort?.postMessage(ready);
      return ex;
    })();
  }
  return extractorPromise;
}

parentPort?.on("message", async (msg: EmbedRequest) => {
  if (!msg || msg.op !== "embed") {
    return;
  }
  try {
    const ex = await getExtractor();
    const output = await ex(msg.chunks, {
      pooling: "mean",
      normalize: true,
    });
    const ok: EmbedOk = { id: msg.id, ok: true, vectors: output.tolist() };
    parentPort?.postMessage(ok);
  } catch (err) {
    const fail: EmbedErr = {
      id: msg.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
    parentPort?.postMessage(fail);
  }
});

void getExtractor().catch((err) => {
  parentPort?.postMessage({
    type: "init-error",
    error: err instanceof Error ? err.message : String(err),
  });
});
