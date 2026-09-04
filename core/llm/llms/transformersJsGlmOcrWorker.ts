/**
 * GLM-OCR child process / worker entry.
 * Prefer child_process.fork (+ ELECTRON_RUN_AS_NODE) so ONNX does not share the
 * Electron extension-host process with MiniLM's onnxruntime-node session.
 */
import path from "path";
import { parentPort, workerData } from "worker_threads";

import {
  AutoModelForImageTextToText,
  AutoProcessor,
  RawImage,
  Tensor,
  env,
} from "@huggingface/transformers";

const MODEL_ID = "onnx-community/GLM-OCR-ONNX";
/** Cap long edge — vision encode cost scales with pixels on CPU. */
const MAX_IMAGE_EDGE = 1568;
/** 1×1 PNG — used to reject EPs that load but fail on MultiHeadAttention (e.g. DML+q4f16). */
const WARMUP_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const DEFAULT_PROMPT = `Text Recognition: Extract all readable text from this image in reading order.
Preserve simple table structure with plain text or a single markdown table when helpful.
Return ONLY the extracted text. Do not wrap in markdown code fences. Do not repeat blank lines or fences.
If there is no text, reply exactly: (no text found)`;

/** Single ORT EP only — combining dml+webgpu throws "DML EP can only be used with CPU EPs". */
type OcrDevice = "dml" | "cuda" | "coreml" | "webgpu" | "cpu";

type OcrRequest = {
  id: number;
  op: "ocr";
  base64: string;
  mimeType: string;
  prompt?: string;
  maxNewTokens?: number;
};

type ReadyMessage = { type: "ready"; device?: string };
type OcrOk = { id: number; ok: true; text: string };
type OcrErr = { id: number; ok: false; error: string };

type IpcPort = {
  postMessage: (msg: unknown) => void;
  onMessage: (handler: (msg: OcrRequest) => void) => void;
};

type GlmProcessor = Awaited<ReturnType<typeof AutoProcessor.from_pretrained>>;
type GlmModel = Awaited<
  ReturnType<typeof AutoModelForImageTextToText.from_pretrained>
>;

let processorPromise: Promise<GlmProcessor> | null = null;
let modelPromise: Promise<GlmModel> | null = null;
let initPromise: Promise<void> | null = null;
let selectedDevice: OcrDevice = "cpu";

function ipcPort(): IpcPort {
  if (parentPort) {
    return {
      postMessage: (msg) => parentPort!.postMessage(msg),
      onMessage: (handler) => {
        parentPort!.on("message", handler);
      },
    };
  }
  return {
    postMessage: (msg) => {
      if (typeof process.send === "function") {
        process.send(msg);
      }
    },
    onMessage: (handler) => {
      process.on("message", (msg) => handler(msg as OcrRequest));
    },
  };
}

const port = ipcPort();

function log(msg: string) {
  console.error(`[MobiusOCR] ${msg}`);
}

/** generate() is typed Tensor | ModelOutput; default path is a Tensor of token ids. */
function generatedTokenIds(outputs: unknown): Tensor {
  if (outputs instanceof Tensor) {
    return outputs;
  }
  if (
    outputs !== null &&
    typeof outputs === "object" &&
    "sequences" in outputs &&
    (outputs as { sequences: unknown }).sequences instanceof Tensor
  ) {
    return (outputs as { sequences: Tensor }).sequences;
  }
  throw new Error("GLM-OCR generate() did not return a Tensor of token ids");
}

function localModelPath(): string {
  const fromEnv = process.env.GLM_OCR_LOCAL_MODEL_PATH?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  const fromData =
    workerData && typeof workerData === "object"
      ? (workerData as { localModelPath?: string }).localModelPath
      : undefined;
  if (fromData) {
    return fromData;
  }
  return path.join(__dirname, "..", "models");
}

/**
 * Platform-ordered GPU-first candidates. Never return "gpu"/"auto" — those pass
 * multiple GPU EPs and break DirectML ("DML EP can only be used with CPU EPs").
 */
function deviceCandidates(): OcrDevice[] {
  const override = process.env.MOBIUS_GLM_OCR_DEVICE?.trim().toLowerCase();
  if (override) {
    const allowed: OcrDevice[] = ["dml", "cuda", "coreml", "webgpu", "cpu"];
    if ((allowed as string[]).includes(override)) {
      return [override as OcrDevice];
    }
    log(`ignoring invalid MOBIUS_GLM_OCR_DEVICE=${override}`);
  }

  switch (process.platform) {
    case "win32":
      // CPU first: WebGPU/DML under ELECTRON_RUN_AS_NODE often hang or refuse
      // a local GPU IPC socket (net::ERR_CONNECTION_REFUSED) until the 180s UI
      // timeout. GPU EPs remain as optional upgrades after a working CPU path.
      return ["cpu", "webgpu", "dml"];
    case "linux":
      return ["cpu", "cuda", "webgpu"];
    case "darwin":
      return ["cpu", "coreml", "webgpu"];
    default:
      return ["cpu"];
  }
}

async function disposeModel(model: GlmModel | null | undefined): Promise<void> {
  if (!model) {
    return;
  }
  try {
    await (model as unknown as { dispose?: () => unknown }).dispose?.();
  } catch {
    /* ignore dispose errors between EP attempts */
  }
}

/** Tiny generate — some EPs load q4f16 then crash on MultiHeadAttention. */
async function warmupInference(
  processor: GlmProcessor,
  model: GlmModel,
): Promise<void> {
  const bytes = Buffer.from(WARMUP_PNG_BASE64, "base64");
  const blob = new Blob([bytes], { type: "image/png" });
  const image = await RawImage.fromBlob(blob);
  const messages = [
    {
      role: "user",
      content: [{ type: "image" }, { type: "text", text: "Text Recognition:" }],
    },
  ];
  const textPrompt = processor.apply_chat_template(messages, {
    add_generation_prompt: true,
  });
  const inputs = await processor(textPrompt, image, {
    add_special_tokens: false,
  });
  await model.generate({
    ...inputs,
    max_new_tokens: 1,
  });
}

async function loadModelWithGpuFallback(
  processor: GlmProcessor,
): Promise<{ model: GlmModel; device: OcrDevice }> {
  const candidates = deviceCandidates();
  const errors: string[] = [];

  for (const device of candidates) {
    const t0 = Date.now();
    let model: GlmModel | undefined;
    try {
      model = await AutoModelForImageTextToText.from_pretrained(MODEL_ID, {
        dtype: "q4f16",
        device,
      });
      await warmupInference(processor, model);
      log(`using device=${device} (ready ${Date.now() - t0}ms, warmup ok)`);
      return { model, device };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${device}: ${msg}`);
      log(
        `device=${device} failed after ${Date.now() - t0}ms: ${msg.slice(0, 240)}`,
      );
      await disposeModel(model);
    }
  }

  throw new Error(
    `GLM-OCR could not run on any device [${candidates.join(", ")}]: ${errors.join(" | ")}`,
  );
}

async function ensureInitialized(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      // Forked process is isolated from MiniLM's ORT — a few threads are OK for CPU EP.
      process.env.OMP_NUM_THREADS ??= "4";
      process.env.ORT_INTRA_OP_NUM_THREADS ??= "4";
      process.env.ORT_INTER_OP_NUM_THREADS ??= "1";

      env.allowLocalModels = true;
      env.allowRemoteModels = false;
      env.localModelPath = localModelPath();

      processorPromise = AutoProcessor.from_pretrained(MODEL_ID);
      const processor = await processorPromise;
      const loaded = await loadModelWithGpuFallback(processor);
      modelPromise = Promise.resolve(loaded.model);
      selectedDevice = loaded.device;

      const ready: ReadyMessage = { type: "ready", device: selectedDevice };
      port.postMessage(ready);
    })();
  }
  await initPromise;
}

async function maybeDownscale(image: RawImage): Promise<RawImage> {
  const w = image.width;
  const h = image.height;
  const longEdge = Math.max(w, h);
  if (longEdge <= MAX_IMAGE_EDGE) {
    return image;
  }
  const scale = MAX_IMAGE_EDGE / longEdge;
  const nw = Math.max(1, Math.round(w * scale));
  const nh = Math.max(1, Math.round(h * scale));
  return image.resize(nw, nh);
}

async function runOcr(
  base64: string,
  mimeType: string,
  prompt: string,
  maxNewTokens: number,
): Promise<string> {
  await ensureInitialized();
  const processor = await processorPromise!;
  const model = await modelPromise!;

  const bytes = Buffer.from(base64, "base64");
  const blob = new Blob([bytes], { type: mimeType || "image/png" });
  const image = await maybeDownscale(await RawImage.fromBlob(blob));

  const messages = [
    {
      role: "user",
      content: [{ type: "image" }, { type: "text", text: prompt }],
    },
  ];
  const textPrompt = processor.apply_chat_template(messages, {
    add_generation_prompt: true,
  });
  const inputs = await processor(textPrompt, image, {
    add_special_tokens: false,
  });
  const outputs = await model.generate({
    ...inputs,
    max_new_tokens: maxNewTokens,
  });
  const promptLength = inputs.input_ids.dims.at(-1) ?? 0;
  const decoded = processor.batch_decode(
    generatedTokenIds(outputs).slice(null, [promptLength, null]),
    { skip_special_tokens: true },
  );
  return decoded[0] ?? "";
}

port.onMessage(async (msg: OcrRequest) => {
  if (!msg || msg.op !== "ocr") {
    return;
  }
  try {
    const text = await runOcr(
      msg.base64,
      msg.mimeType,
      msg.prompt?.trim() || DEFAULT_PROMPT,
      msg.maxNewTokens ?? 512,
    );
    const ok: OcrOk = { id: msg.id, ok: true, text };
    port.postMessage(ok);
  } catch (err) {
    const fail: OcrErr = {
      id: msg.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
    port.postMessage(fail);
  }
});

void ensureInitialized().catch((err) => {
  port.postMessage({
    type: "init-error",
    error: err instanceof Error ? err.message : String(err),
  });
});
