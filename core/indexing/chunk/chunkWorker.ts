/**
 * Tree-sitter Worker (worker_threads).
 * Loaded as a separate esbuild bundle so tree-sitter WASM parsing never runs on
 * the extension-host event loop. Handles chunking, symbol extraction and
 * snippet extraction. A pathological file can make `ts_parser_parse_wasm` loop
 * forever (observed with a 642-byte CRLF bash script), and repeated Parser
 * creation can wedge `ts_parser_new_wasm` inside malloc once the shared WASM
 * heap is exhausted; inside this worker the host client can terminate it after
 * a timeout and fall back instead of freezing the IDE.
 */
import { MessagePort, parentPort } from "worker_threads";

import {
  computeSnippetsForFile,
  computeSymbolsForFile,
} from "../../util/treeSitter.js";
import { chunkDocumentWithoutId } from "./chunk.js";
import type { TreeSitterWorkerRequest } from "./chunkWorkerClient.js";

type WorkerOk = { id: number; ok: true; result: unknown };
type WorkerErr = { id: number; ok: false; error: string };

const port: MessagePort | null = parentPort;

if (port) {
  port.on("message", async (msg: TreeSitterWorkerRequest) => {
    if (!msg || typeof msg.id !== "number") {
      return;
    }
    try {
      let result: unknown;
      switch (msg.op) {
        case "chunk": {
          const chunks = [];
          for await (const chunk of chunkDocumentWithoutId(
            msg.fileUri,
            msg.contents,
            msg.maxChunkSize,
          )) {
            chunks.push(chunk);
          }
          result = chunks;
          break;
        }
        case "symbols": {
          result = await computeSymbolsForFile(msg.filepath, msg.contents);
          break;
        }
        case "snippets": {
          result = await computeSnippetsForFile(msg.filepath, msg.contents);
          break;
        }
        default:
          return;
      }
      const ok: WorkerOk = { id: msg.id, ok: true, result };
      port.postMessage(ok);
    } catch (err) {
      const fail: WorkerErr = {
        id: msg.id,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
      port.postMessage(fail);
    }
  });
}
