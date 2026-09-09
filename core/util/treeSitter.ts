import fs from "node:fs";
import path from "path";
import { isMainThread } from "worker_threads";

import Parser, { Language } from "web-tree-sitter";
import { ChunkWithoutID, FileSymbolMap, IDE, SymbolWithRange } from "..";
import {
  symbolsInWorker,
  snippetsInWorker,
} from "../indexing/chunk/chunkWorkerClient.js";
import { getUriFileExtension } from "./uri";

export enum LanguageName {
  CPP = "cpp",
  C_SHARP = "c_sharp",
  C = "c",
  CSS = "css",
  PHP = "php",
  BASH = "bash",
  JSON = "json",
  TYPESCRIPT = "typescript",
  TSX = "tsx",
  ELM = "elm",
  JAVASCRIPT = "javascript",
  PYTHON = "python",
  ELISP = "elisp",
  ELIXIR = "elixir",
  GO = "go",
  EMBEDDED_TEMPLATE = "embedded_template",
  HTML = "html",
  JAVA = "java",
  LUA = "lua",
  OCAML = "ocaml",
  QL = "ql",
  RESCRIPT = "rescript",
  RUBY = "ruby",
  RUST = "rust",
  SYSTEMRDL = "systemrdl",
  TOML = "toml",
  SOLIDITY = "solidity",
}

export const supportedLanguages: { [key: string]: LanguageName } = {
  cpp: LanguageName.CPP,
  hpp: LanguageName.CPP,
  cc: LanguageName.CPP,
  cxx: LanguageName.CPP,
  hxx: LanguageName.CPP,
  cp: LanguageName.CPP,
  hh: LanguageName.CPP,
  inc: LanguageName.CPP,
  // Depended on this PR: https://github.com/tree-sitter/tree-sitter-cpp/pull/173
  // ccm: LanguageName.CPP,
  // c++m: LanguageName.CPP,
  // cppm: LanguageName.CPP,
  // cxxm: LanguageName.CPP,
  cs: LanguageName.C_SHARP,
  c: LanguageName.C,
  h: LanguageName.C,
  css: LanguageName.CSS,
  php: LanguageName.PHP,
  phtml: LanguageName.PHP,
  php3: LanguageName.PHP,
  php4: LanguageName.PHP,
  php5: LanguageName.PHP,
  php7: LanguageName.PHP,
  phps: LanguageName.PHP,
  "php-s": LanguageName.PHP,
  bash: LanguageName.BASH,
  sh: LanguageName.BASH,
  json: LanguageName.JSON,
  ts: LanguageName.TYPESCRIPT,
  mts: LanguageName.TYPESCRIPT,
  cts: LanguageName.TYPESCRIPT,
  tsx: LanguageName.TSX,
  // vue: LanguageName.VUE,  // tree-sitter-vue parser is broken
  // The .wasm file being used is faulty, and yaml is split line-by-line anyway for the most part
  // yaml: LanguageName.YAML,
  // yml: LanguageName.YAML,
  elm: LanguageName.ELM,
  js: LanguageName.JAVASCRIPT,
  jsx: LanguageName.JAVASCRIPT,
  mjs: LanguageName.JAVASCRIPT,
  cjs: LanguageName.JAVASCRIPT,
  py: LanguageName.PYTHON,
  // ipynb: LanguageName.PYTHON, // It contains Python, but the file format is a ton of JSON.
  pyw: LanguageName.PYTHON,
  pyi: LanguageName.PYTHON,
  el: LanguageName.ELISP,
  emacs: LanguageName.ELISP,
  ex: LanguageName.ELIXIR,
  exs: LanguageName.ELIXIR,
  go: LanguageName.GO,
  eex: LanguageName.EMBEDDED_TEMPLATE,
  heex: LanguageName.EMBEDDED_TEMPLATE,
  leex: LanguageName.EMBEDDED_TEMPLATE,
  html: LanguageName.HTML,
  htm: LanguageName.HTML,
  java: LanguageName.JAVA,
  lua: LanguageName.LUA,
  luau: LanguageName.LUA,
  ocaml: LanguageName.OCAML,
  ml: LanguageName.OCAML,
  mli: LanguageName.OCAML,
  ql: LanguageName.QL,
  res: LanguageName.RESCRIPT,
  resi: LanguageName.RESCRIPT,
  rb: LanguageName.RUBY,
  erb: LanguageName.RUBY,
  rs: LanguageName.RUST,
  rdl: LanguageName.SYSTEMRDL,
  toml: LanguageName.TOML,
  sol: LanguageName.SOLIDITY,

  // jl: LanguageName.JULIA,
  // swift: LanguageName.SWIFT,
  // kt: LanguageName.KOTLIN,
  // scala: LanguageName.SCALA,
};

export const IGNORE_PATH_PATTERNS: Partial<Record<LanguageName, RegExp[]>> = {
  [LanguageName.TYPESCRIPT]: [/.*node_modules/],
  [LanguageName.JAVASCRIPT]: [/.*node_modules/],
};

// A Parser allocates on the shared tree-sitter WASM heap and web-tree-sitter
// never frees it on GC (no FinalizationRegistry). Creating one per call leaked
// that heap until `ts_parser_new_wasm` wedged inside malloc and froze the
// extension host (observed 2026-09-09: exthost stuck in
// malloc <- calloc <- ts_parser_new_wasm <- Parser.init <- getParserForFile
// a few minutes after codebase indexing resumed). Parsers are reusable
// across sequential parse() calls on the same thread, so pool one per
// language instead of allocating per call.
const nameToParser = new Map<string, Parser>();

export async function getParserForFile(filepath: string) {
  try {
    await Parser.init();

    const extension = getUriFileExtension(filepath);
    const languageName = supportedLanguages[extension];
    if (!languageName) {
      return undefined;
    }

    const language = await getLanguageForFile(filepath);
    if (!language) {
      return undefined;
    }

    let parser = nameToParser.get(languageName);
    if (!parser) {
      parser = new Parser();
      parser.setLanguage(language);
      nameToParser.set(languageName, parser);
    }

    return parser;
  } catch (e) {
    console.debug("Unable to load language for file", filepath, e);
    return undefined;
  }
}

// Loading the wasm files to create a Language object is an expensive operation and with
// sufficient number of files can result in errors, instead keep a map of language name
// to Language object
const nameToLanguage = new Map<string, Language>();

export async function getLanguageForFile(
  filepath: string,
): Promise<Language | undefined> {
  try {
    await Parser.init();
    const extension = getUriFileExtension(filepath);

    const languageName = supportedLanguages[extension];
    if (!languageName) {
      return undefined;
    }
    let language = nameToLanguage.get(languageName);

    if (!language) {
      language = await loadLanguageForFileExt(extension);
      nameToLanguage.set(languageName, language);
    }
    return language;
  } catch (e) {
    console.debug("Unable to load language for file", filepath, e);
    return undefined;
  }
}

export const getFullLanguageName = (filepath: string) => {
  const extension = getUriFileExtension(filepath);
  return supportedLanguages[extension];
};

export async function getQueryForFile(
  filepath: string,
  queryPath: string,
): Promise<Parser.Query | undefined> {
  const language = await getLanguageForFile(filepath);
  if (!language) {
    return undefined;
  }

  const sourcePath = path.join(
    process.env.NODE_ENV === "test" ? process.cwd() : __dirname,
    "..",
    ...(process.env.NODE_ENV === "test"
      ? ["extensions", "vscode", "tree-sitter"]
      : ["tree-sitter"]),
    queryPath,
  );
  if (!fs.existsSync(sourcePath)) {
    return undefined;
  }
  const querySource = fs.readFileSync(sourcePath).toString();

  const query = language.query(querySource);
  return query;
}

async function loadLanguageForFileExt(
  fileExtension: string,
): Promise<Language> {
  const wasmPath = path.join(
    process.env.NODE_ENV === "test" ? process.cwd() : __dirname,
    ...(process.env.NODE_ENV === "test"
      ? ["node_modules", "tree-sitter-wasms", "out"]
      : ["tree-sitter-wasms"]),
    `tree-sitter-${supportedLanguages[fileExtension]}.wasm`,
  );
  return await Parser.Language.load(wasmPath);
}

// See https://tree-sitter.github.io/tree-sitter/using-parsers
const GET_SYMBOLS_FOR_NODE_TYPES: Parser.SyntaxNode["type"][] = [
  "class_declaration",
  "class_definition",
  "function_item", // function name = first "identifier" child
  "function_definition",
  "method_declaration", // method name = first "identifier" child
  "method_definition",
  "generator_function_declaration",
  // property_identifier
  // field_declaration
  // "arrow_function",
];

/**
 * Pure main-thread symbol extraction on the pooled parser. Used as the
 * worker fallback by getSymbolsForFile, and directly inside chunkWorker.
 */
export async function computeSymbolsForFile(
  filepath: string,
  contents: string,
): Promise<SymbolWithRange[] | undefined> {
  const parser = await getParserForFile(filepath);
  if (!parser) {
    return;
  }

  let tree: Parser.Tree;
  try {
    // Same \r\n guard as codeChunker: some grammars can loop forever on CRLF
    // input, which would freeze the extension host.
    tree = parser.parse(contents.replace(/\r\n/g, "\n"));
  } catch (e) {
    console.log(`Error parsing file: ${filepath}`);
    return;
  }
  // console.log(`file: ${filepath}`);

  // Function to recursively find all named nodes (classes and functions)
  const symbols: SymbolWithRange[] = [];
  function findNamedNodesRecursive(node: Parser.SyntaxNode) {
    // console.log(`node: ${node.type}, ${node.text}`);
    if (GET_SYMBOLS_FOR_NODE_TYPES.includes(node.type)) {
      // console.log(`parent: ${node.type}, ${node.text.substring(0, 200)}`);
      // node.children.forEach((child) => {
      //   console.log(`child: ${child.type}, ${child.text}`);
      // });

      // Empirically, the actual name is the last identifier in the node
      // Especially with languages where return type is declared before the name
      // TODO use findLast in newer version of node target
      let identifier: Parser.SyntaxNode | undefined = undefined;
      for (let i = node.children.length - 1; i >= 0; i--) {
        if (
          node.children[i].type === "identifier" ||
          node.children[i].type === "property_identifier"
        ) {
          identifier = node.children[i];
          break;
        }
      }

      if (identifier?.text) {
        symbols.push({
          filepath,
          type: node.type,
          name: identifier.text,
          range: {
            start: {
              character: node.startPosition.column,
              line: node.startPosition.row,
            },
            end: {
              character: node.endPosition.column + 1,
              line: node.endPosition.row + 1,
            },
          },
          content: node.text,
        });
      }
    }
    node.children.forEach(findNamedNodesRecursive);
  }
  findNamedNodesRecursive(tree.rootNode);
  return symbols;
}

export async function getSymbolsForFile(
  filepath: string,
  contents: string,
): Promise<SymbolWithRange[] | undefined> {
  // Worker-first: indexing walks thousands of files, so keep tree-sitter off
  // the extension-host loop (same isolation as chunking). Falls back to the
  // pooled main-thread parser if the worker is unavailable.
  if (process.env.NODE_ENV !== "test" && isMainThread) {
    try {
      return await symbolsInWorker(filepath, contents);
    } catch (e) {
      console.warn(
        `[MobiusTreeSitter] symbols worker failed for ${filepath}, falling back to main thread: ${
          e instanceof Error ? e.message : e
        }`,
      );
    }
  }
  return computeSymbolsForFile(filepath, contents);
}

// ─── Code snippets (moved from CodeSnippetsIndex so the worker can reuse it) ──

export type SnippetChunk = ChunkWithoutID & {
  title: string;
  signature: string;
};

function snippetsFromMatch(match: Parser.QueryMatch): SnippetChunk {
  const bodyTypesToTreatAsSignatures = [
    "interface_declaration", // TypeScript, Java
    "struct_item", // Rust
    "type_spec", // Go
  ];

  const bodyCaptureGroupPrefixes = ["definition", "reference"];

  let title = "",
    content = "",
    signature = "",
    startLine = 0,
    endLine = 0,
    hasSeenBody = false;

  // This loop assumes that the ordering of the capture groups is representative
  // of the structure of the language, e.g. for a TypeScript match on a function,
  // `function myFunc(param: string): string`, the first capture would be the `myFunc`
  // the second capture would be the `(param: string)`, etc
  for (const { name, node } of match.captures) {
    // Assume we are capturing groups using a dot syntax for more precise groupings
    // However, for this case, we only care about the first substring
    const trimmedCaptureName = name.split(".")[0];

    const nodeText = node.text;
    const nodeType = node.type;

    if (bodyCaptureGroupPrefixes.includes(trimmedCaptureName)) {
      if (bodyTypesToTreatAsSignatures.includes(nodeType)) {
        // Note we override whatever existing value there is here
        signature = nodeText;
        hasSeenBody = true;
      }

      content = nodeText;
      startLine = node.startPosition.row;
      endLine = node.endPosition.row;
    } else {
      if (trimmedCaptureName === "name") {
        title = nodeText;
      }

      if (!hasSeenBody) {
        signature += nodeText + " ";

        if (trimmedCaptureName === "comment") {
          signature += "\n";
        }
      }
    }
  }

  return { title, content, signature, startLine, endLine };
}

/**
 * Pure main-thread snippet extraction on the pooled parser. Used as the
 * worker fallback by CodeSnippetsIndex.getSnippetsInFile, and directly
 * inside chunkWorker.
 */
export async function computeSnippetsForFile(
  filepath: string,
  contents: string,
): Promise<SnippetChunk[]> {
  const parser = await getParserForFile(filepath);
  if (!parser) {
    return [];
  }

  // Same \r\n guard as codeChunker (row positions are unaffected by this).
  const ast = parser.parse(contents.replace(/\r\n/g, "\n"));

  const language = getFullLanguageName(filepath);
  if (!language) {
    return [];
  }
  const query = await getQueryForFile(
    filepath,
    `code-snippet-queries/${language}.scm`,
  );
  const matches = query?.matches(ast.rootNode);
  if (!matches) {
    return [];
  }
  return matches.map(snippetsFromMatch);
}

export async function getSymbolsForManyFiles(
  uris: string[],
  ide: IDE,
): Promise<FileSymbolMap> {
  const filesAndSymbols = await Promise.all(
    uris.map(async (uri): Promise<[string, SymbolWithRange[]]> => {
      const contents = await ide.readFile(uri);
      let symbols = undefined;
      try {
        symbols = await getSymbolsForFile(uri, contents);
      } catch (e) {
        console.error(`Failed to get symbols for ${uri}:`, e);
      }
      return [uri, symbols ?? []];
    }),
  );
  return Object.fromEntries(filesAndSymbols);
}
