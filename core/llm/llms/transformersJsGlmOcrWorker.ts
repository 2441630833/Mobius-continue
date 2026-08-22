/**
 * GLM-OCR Worker (worker_threads).
 * Loaded as a separate esbuild bundle so ONNX inference does not block the extension host.
 */
import path from "path";
import { parentPort, workerData } from "worker_threads";

import {
  AutoModelForImageTextToText,
  AutoProcessor,
  RawImage,
  env,
} from "@huggingface/transformers";

const MODEL_ID = "onnx-community/GLM-OCR-ONNX";
const DEFAULT_PROMPT = `Text Recognition: Extract all readable text from this image in reading order.
Preserve simple table structure with plain text or a single markdown table when helpful.
Return ONLY the extracted text. Do not wrap in markdown code fences. Do not repeat blank lines or fences.
If there is no text, reply exactly: (no text found)`;

type OcrRequest = {
  id: number;
  op: "ocr";
  base64: string;
  mimeType: string;
  prompt?: string;
  maxNewTokens?: number;
};

type ReadyMessage = { type: "ready" };
type OcrOk = { id: number; ok: true; text: string };
type OcrErr = { id: number; ok: false; error: string };

let processorPromise: ReturnType<typeof AutoProcessor.from_pretrained> | null =
  null;
let modelPromise: ReturnType<
  typeof AutoModelForImageTextToText.from_pretrained
> | null = null;
let initPromise: Promise<void> | null = null;

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

async function ensureInitialized(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      env.allowLocalModels = true;
      env.allowRemoteModels = false;
      env.localModelPath = localModelPath();

      processorPromise = AutoProcessor.from_pretrained(MODEL_ID);
      modelPromise = AutoModelForImageTextToText.from_pretrained(MODEL_ID, {
        dtype: "q4f16",
        device: "cpu",
      });
      await Promise.all([processorPromise, modelPromise]);
      const ready: ReadyMessage = { type: "ready" };
      parentPort?.postMessage(ready);
    })();
  }
  await initPromise;
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
  const image = await RawImage.fromBlob(blob);

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
    outputs.slice(null, [promptLength, null]),
    { skip_special_tokens: true },
  );
  return decoded[0] ?? "";
}

parentPort?.on("message", async (msg: OcrRequest) => {
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
    parentPort?.postMessage(ok);
  } catch (err) {
    const fail: OcrErr = {
      id: msg.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
    parentPort?.postMessage(fail);
  }
});

void ensureInitialized().catch((err) => {
  parentPort?.postMessage({
    type: "init-error",
    error: err instanceof Error ? err.message : String(err),
  });
});
