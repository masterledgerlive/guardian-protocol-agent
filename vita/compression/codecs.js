/**
 * Compression projects — every lossless codec the bake-off is allowed to run.
 *
 * Add one by pushing an object:
 *   { id, project, compress(buf)->Buffer, decompress(buf)->Buffer, maxBytes? }
 * id must match /^[a-z0-9-]{1,24}$/ so the directory key fits a Telegram
 * callback. A codec that does not return the original bytes is not verified
 * and cannot be recommended.
 *
 * gemini-zlib-v1 is the Node twin of
 * vita/compression/projects/gemini-zlib.py (Python zlib.compress, level 6,
 * then 0x hex calldata).
 */

import {
  brotliCompressSync,
  brotliDecompressSync,
  constants,
  deflateRawSync,
  deflateSync,
  gunzipSync,
  gzipSync,
  inflateRawSync,
  inflateSync,
} from "node:zlib";

export const CODEC_ID_RE = /^[a-z0-9-]{1,24}$/;

function brotli(buf, quality) {
  return brotliCompressSync(buf, {
    params: { [constants.BROTLI_PARAM_QUALITY]: quality },
  });
}

export const CODECS = [
  {
    id: "identity-v1",
    project: "identity",
    note: "raw bytes — honest winner when the file is already dense (video)",
    compress: (buf) => Buffer.from(buf),
    decompress: (buf) => Buffer.from(buf),
  },
  {
    id: "gemini-zlib-v1",
    project: "gemini-code-1790141126186",
    note: "Python zlib.compress default (level 6) → 0x hex calldata",
    compress: (buf) => deflateSync(buf, { level: 6 }),
    decompress: (buf) => inflateSync(buf),
  },
  {
    id: "zlib-9-v1",
    project: "zlib",
    note: "zlib wrapper, max level",
    compress: (buf) => deflateSync(buf, { level: 9 }),
    decompress: (buf) => inflateSync(buf),
  },
  {
    id: "deflate-raw-9-v1",
    project: "deflate-raw",
    note: "raw deflate, no zlib header",
    compress: (buf) => deflateRawSync(buf, { level: 9 }),
    decompress: (buf) => inflateRawSync(buf),
  },
  {
    id: "gzip-9-v1",
    project: "gzip",
    note: "gzip wrapper, max level",
    compress: (buf) => gzipSync(buf, { level: 9 }),
    decompress: (buf) => gunzipSync(buf),
  },
  {
    id: "brotli-4-v1",
    project: "brotli",
    note: "brotli quality 4 — fast path for larger files",
    maxBytes: 512 * 1024,
    compress: (buf) => brotli(buf, 4),
    decompress: (buf) => brotliDecompressSync(buf),
  },
  {
    id: "brotli-11-v1",
    project: "brotli",
    note: "brotli quality 11 — small files only (large bodies stall)",
    maxBytes: 48 * 1024,
    compress: (buf) => brotli(buf, 11),
    decompress: (buf) => brotliDecompressSync(buf),
  },
];

/** Current /vitafeed wire (base64). Compared, never chosen as the compressor. */
export const WIRE_B64 = {
  id: "wire-b64-v1",
  project: "vitafile",
  role: "wire",
  note: "base64 expansion used by §VITAFILE§ before a compressor is chosen",
  compress: (buf) => Buffer.from(Buffer.from(buf).toString("base64"), "utf8"),
  decompress: (buf) => Buffer.from(String(buf), "base64"),
};

const PRIORITY = {
  "brotli-11-v1": 10,
  "brotli-4-v1": 20,
  "zlib-9-v1": 30,
  "gemini-zlib-v1": 40,
  "gemini-zlib-py-v1": 41,
  "deflate-raw-9-v1": 50,
  "gzip-9-v1": 60,
  "identity-v1": 90,
};

export function codecPriority(id) {
  return PRIORITY[id] ?? 70;
}

export function assertCodecId(id) {
  if (!CODEC_ID_RE.test(String(id || ""))) {
    throw new Error("codec id must match " + CODEC_ID_RE + " — got " + id);
  }
}

export function listCodecProjects() {
  return [...CODECS, WIRE_B64].map((c) => ({
    id: c.id,
    project: c.project,
    role: c.role || "compressor",
    note: c.note || "",
    maxBytes: c.maxBytes || null,
  }));
}
