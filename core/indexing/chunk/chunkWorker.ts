/**
 * Code-chunking Worker (worker_threads).
 * Loaded as a separate esbuild bundle so tree-sitter WASM parsing never runs on
 * the extension-host event loop. A pathological file can make
 * `ts_parser_parse_wasm` loop forever (observed with a 642-byte CRLF bash
 * script); inside this worker the host client can terminate it after a timeout
 * and fall back to basic chunking instead of freezing the IDE.
 */
import { MessagePort, parentPort } from "worker_threads";

import { ChunkWithoutID } from "../../index.js";
import { chunkDocumentWithoutId } from "./chunk.js";

type ChunkRequest = {
  id: number;
  op: "chunk";
  fileUri: string;
  contents: string;
  maxChunkSize: number;
};

type ChunkOk = { id: number; ok: true; chunks: ChunkWithoutID[] };
type ChunkErr = { id: number; ok: false; error: string };

const port: MessagePort | null = parentPort;

if (port) {
  port.on("message", async (msg: ChunkRequest) => {
    if (!msg || msg.op !== "chunk") {
      return;
    }
    try {
      const chunks: ChunkWithoutID[] = [];
      for await (const chunk of chunkDocumentWithoutId(
        msg.fileUri,
        msg.contents,
        msg.maxChunkSize,
      )) {
        chunks.push(chunk);
      }
      const ok: ChunkOk = { id: msg.id, ok: true, chunks };
      port.postMessage(ok);
    } catch (err) {
      const fail: ChunkErr = {
        id: msg.id,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
      port.postMessage(fail);
    }
  });
}
