/**
 * /vitafeed file packets — any bytes (song / video / code / blob) → spaced UTF-8.
 *
 * Thin helper. Does NOT touch mother brain / vitaSave / mainframe hitch formula.
 * Binary becomes exact UTF-8 text (base64) so prepareVitaFeed / VIN headers /
 * RISK confirm|override stay the same path. Reader reconstructs from sealed
 * locations and plays — no local file hold required after seal.
 *
 * Wire (verbatim body inside [VITAFEED:…] packets):
 *   §VITAFILE§v1|name=…|mime=…|bytes=N|sha256=hex|enc=b64§
 *   <base64 payload>
 */

import { createHash } from "node:crypto";
import {
  VITAFEED_MAX_CHUNK_BYTES,
  prepareVitaFeed,
  reconstructVitaFeedBody,
  parseVitaFeedLine,
} from "./vita-feed.js";

export const VITAFILE_ID = "vita-file-v1";
export const VITAFILE_MAGIC = "§VITAFILE§";
export const VITAFILE_VERSION = "v1";
export const VITAFILE_ENC = "b64";

/** Soft warn — Telegram getFile is ~20 MiB; large songs = many 720 B injections. */
export const VITAFILE_SOFT_MAX_BYTES = 512 * 1024;

const SAFE_NAME = /^[A-Za-z0-9._\- ]{1,120}$/;

function sha256HexBuf(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

export function utf8ToBytes(text) {
  return Buffer.from(String(text ?? ""), "utf8");
}

export function guessMime(name = "", hint = "") {
  const h = String(hint || "").trim().toLowerCase();
  if (h && h.includes("/")) return h;
  const n = String(name || "").toLowerCase();
  if (n.endsWith(".mp3")) return "audio/mpeg";
  if (n.endsWith(".wav")) return "audio/wav";
  if (n.endsWith(".ogg")) return "audio/ogg";
  if (n.endsWith(".m4a") || n.endsWith(".mp4") && n.includes("audio")) return "audio/mp4";
  if (n.endsWith(".mp4")) return "video/mp4";
  if (n.endsWith(".webm")) return "video/webm";
  if (n.endsWith(".png")) return "image/png";
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
  if (n.endsWith(".gif")) return "image/gif";
  if (n.endsWith(".webp")) return "image/webp";
  if (n.endsWith(".pdf")) return "application/pdf";
  if (n.endsWith(".js") || n.endsWith(".mjs")) return "text/javascript";
  if (n.endsWith(".json")) return "application/json";
  if (n.endsWith(".html") || n.endsWith(".htm")) return "text/html";
  if (n.endsWith(".css")) return "text/css";
  if (n.endsWith(".md") || n.endsWith(".txt")) return "text/plain";
  return "application/octet-stream";
}

export function playKindForMime(mime) {
  const m = String(mime || "").toLowerCase();
  if (m.startsWith("audio/")) return "audio";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("text/") || m === "application/json" || m === "application/javascript") {
    return "text";
  }
  return "file";
}

function sanitizeName(name) {
  const raw = String(name || "blob.bin").trim() || "blob.bin";
  const cleaned = raw.replace(/[^\w.\- ]+/g, "_").slice(0, 120);
  return SAFE_NAME.test(cleaned) ? cleaned : "blob.bin";
}

/**
 * Build the exact UTF-8 body that /vitafeed will split into spaced VIN packets.
 * @param {{ name?: string, mime?: string, bytes: Buffer|Uint8Array|string }} input
 */
export function encodeVitaFile(input = {}) {
  let buf;
  if (Buffer.isBuffer(input.bytes)) {
    buf = input.bytes;
  } else if (input.bytes instanceof Uint8Array) {
    buf = Buffer.from(input.bytes);
  } else if (typeof input.bytes === "string") {
    buf = Buffer.from(input.bytes, "utf8");
  } else if (input.data != null) {
    return encodeVitaFile({ ...input, bytes: input.data });
  } else {
    return { ok: false, reason: "empty bytes — pass file bytes / song / blob" };
  }
  if (!buf.length) {
    return { ok: false, reason: "empty file — nothing to packetize" };
  }
  const name = sanitizeName(input.name);
  const mime = guessMime(name, input.mime);
  const sha256 = sha256HexBuf(buf);
  const b64 = buf.toString("base64");
  const header =
    VITAFILE_MAGIC +
    VITAFILE_VERSION +
    "|name=" + name +
    "|mime=" + mime +
    "|bytes=" + buf.length +
    "|sha256=" + sha256 +
    "|enc=" + VITAFILE_ENC +
    "§\n";
  const body = header + b64;
  return {
    ok: true,
    id: VITAFILE_ID,
    name,
    mime,
    playKind: playKindForMime(mime),
    rawBytes: buf.length,
    sha256,
    enc: VITAFILE_ENC,
    body,
    bodyChars: body.length,
    bodyBytes: Buffer.byteLength(body, "utf8"),
    softWarn: buf.length > VITAFILE_SOFT_MAX_BYTES,
    note: "exact base64 — prepareVitaFeed splits into spaced VIN packets (code-ready UTF-8)",
  };
}

/**
 * Parse a reconstructed VITAFILE body (after VIN strip + join).
 */
export function parseVitaFileBody(text) {
  const s = String(text ?? "");
  if (!s.startsWith(VITAFILE_MAGIC)) {
    return { ok: false, reason: "not a §VITAFILE§ body", isVitaFile: false };
  }
  const end = s.indexOf("§", VITAFILE_MAGIC.length);
  if (end < 0) return { ok: false, reason: "missing VITAFILE header closer", isVitaFile: true };
  const head = s.slice(VITAFILE_MAGIC.length, end);
  const payload = s.slice(end + 1).replace(/^\n/, "");
  const parts = head.split("|");
  const version = parts[0] || "";
  const meta = { version };
  for (let i = 1; i < parts.length; i++) {
    const eq = parts[i].indexOf("=");
    if (eq < 0) continue;
    meta[parts[i].slice(0, eq)] = parts[i].slice(eq + 1);
  }
  if (version !== VITAFILE_VERSION) {
    return { ok: false, reason: "unsupported VITAFILE version " + version, isVitaFile: true, meta };
  }
  if (meta.enc && meta.enc !== VITAFILE_ENC) {
    return { ok: false, reason: "unsupported enc " + meta.enc, isVitaFile: true, meta };
  }
  let data;
  try {
    data = Buffer.from(payload.replace(/\s+/g, ""), "base64");
  } catch {
    return { ok: false, reason: "base64 decode failed", isVitaFile: true, meta };
  }
  const expect = Number(meta.bytes);
  if (Number.isFinite(expect) && expect > 0 && data.length !== expect) {
    return {
      ok: false,
      reason: "byte length mismatch got=" + data.length + " want=" + expect,
      isVitaFile: true,
      meta,
      data,
    };
  }
  const sha = sha256HexBuf(data);
  if (meta.sha256 && meta.sha256 !== sha) {
    return {
      ok: false,
      reason: "sha256 mismatch — refuse corrupt playback",
      isVitaFile: true,
      meta,
      data,
      sha256: sha,
    };
  }
  const name = sanitizeName(meta.name || "blob.bin");
  const mime = guessMime(name, meta.mime);
  return {
    ok: true,
    isVitaFile: true,
    name,
    mime,
    playKind: playKindForMime(mime),
    rawBytes: data.length,
    sha256: sha,
    enc: VITAFILE_ENC,
    meta,
    data,
    dataUrl: "data:" + mime + ";base64," + data.toString("base64"),
  };
}

export function isVitaFileBody(text) {
  return String(text ?? "").startsWith(VITAFILE_MAGIC);
}

/**
 * Encode any file → prepareVitaFeed (VIN spaced packets).
 */
export function prepareVitaFileFeed(input = {}, opts = {}) {
  const enc = encodeVitaFile(input);
  if (!enc.ok) return enc;
  const prepared = prepareVitaFeed(enc.body, opts);
  if (!prepared.ok) return prepared;
  return {
    ...prepared,
    mode: "vitafile",
    file: {
      id: VITAFILE_ID,
      name: enc.name,
      mime: enc.mime,
      playKind: enc.playKind,
      rawBytes: enc.rawBytes,
      sha256: enc.sha256,
      softWarn: enc.softWarn,
    },
    note:
      "VITAFILE → plain UTF-8 packets · max " +
      (prepared.maxBytes || VITAFEED_MAX_CHUNK_BYTES) +
      " B payload/chunk · reader plays after all locations seal",
  };
}

/**
 * Rebuild file from VIN lines (fullLine / line / string).
 */
export function reconstructVitaFileFromLines(lines) {
  const rebuilt = reconstructVitaFeedBody(lines);
  if (!rebuilt.ok) return { ...rebuilt, isVitaFile: false };
  if (!isVitaFileBody(rebuilt.body)) {
    return {
      ok: true,
      isVitaFile: false,
      body: rebuilt.body,
      reason: "plain UTF-8 body (not §VITAFILE§) — use as text",
    };
  }
  const parsed = parseVitaFileBody(rebuilt.body);
  return { ...parsed, body: rebuilt.body };
}

/** chatId → { chatId, at, prompt } — wait for next Telegram attachment after /vitafeed file */
const fileAwaitByChat = new Map();

export function beginVitaFeedFileAwait(chatId, meta = {}) {
  const key = String(chatId || "default");
  const row = {
    chatId: key,
    at: new Date().toISOString(),
    prompt: "please_insert_file",
    ...meta,
  };
  fileAwaitByChat.set(key, row);
  return row;
}

export function peekVitaFeedFileAwait(chatId) {
  return fileAwaitByChat.get(String(chatId || "default")) || null;
}

export function clearVitaFeedFileAwait(chatId) {
  return fileAwaitByChat.delete(String(chatId || "default"));
}

export function takeVitaFeedFileAwait(chatId) {
  const row = peekVitaFeedFileAwait(chatId);
  if (row) clearVitaFeedFileAwait(chatId);
  return row;
}

export function resetVitaFeedFileAwait() {
  fileAwaitByChat.clear();
  return fileAwaitByChat.size;
}

/** Telegram copy when /vitafeed file is waiting for the attachment. */
export function vitaFeedPleaseInsertFileText() {
  return [
    "📡 VITAFEED FILE — please insert the file now",
    "Send a song, video, photo, voice note, or document in this chat.",
    "Or reply to an existing attachment with /vitafeed file",
    "I convert it to spaced VIN packets (§VITAFILE§) for the Tailwind reader.",
    "Then /vitafeed confirm  or  /vitafeed override  to seal on-chain.",
    "/vitafeed cancel aborts the wait.",
  ].join("\n");
}

/**
 * Pick media on a Telegram message, download, encode → §VITAFILE§ body.
 * Never invents bytes. Caller must pass a real message with an attachment.
 */
export async function packetizeTelegramMessageForVitaFeed(message, opts = {}) {
  const media = pickTelegramMedia(message || {});
  if (!media.ok) return { ok: false, reason: media.reason || "no attachment on message" };
  const dl = await downloadTelegramFileBytes(media.fileId, opts);
  if (!dl.ok) return { ok: false, reason: dl.reason || "download failed", media };
  const enc = encodeVitaFile({
    name: media.name,
    mime: media.mime,
    bytes: dl.bytes,
  });
  if (!enc.ok) return { ok: false, reason: enc.reason || "encode failed", media };
  let compression = null;
  if (opts.recommend === true) {
    compression = await recommendCompressionForFeed({
      name: enc.name,
      mime: enc.mime,
      bytes: dl.bytes,
    });
  }
  return {
    ok: true,
    media,
    body: enc.body,
    name: enc.name,
    mime: enc.mime,
    playKind: enc.playKind,
    rawBytes: enc.rawBytes,
    bodyBytes: enc.bodyBytes,
    sha256: enc.sha256,
    softWarn: enc.softWarn,
    compression,
  };
}

/** Best verified codec for a /vitafeed file. Does not replace the §VITAFILE§ body. */
export async function recommendCompressionForFeed({ name, mime, bytes } = {}) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  if (!buf.length) return null;
  if (buf.length > 256 * 1024) {
    return {
      verified: false,
      replyLine: "file is above the auto bake-off cap (256KB) — /vitafeed compress add still accepts it on the compression path",
    };
  }
  const { fileCompression } = await import("./compression/index.js");
  const filed = fileCompression({
    name: name || "upload.bin",
    mime: mime || "",
    bytes: buf,
    source: "vitafeed-file",
    includePython: buf.length <= 48 * 1024,
  });
  if (!filed.ok) {
    return { verified: false, replyLine: "compression bench refused — " + (filed.reason || "miss") };
  }
  return {
    verified: true,
    answer: true,
    recovered: true,
    call: "verified",
    key: filed.key,
    codec: filed.codec,
    ratio: filed.entry?.ratio,
    replyLine:
      "BEST " + filed.codec +
      "  VERIFIED true  key=" + filed.key +
      "  answer recovered=true  ratio=" + filed.entry?.ratio +
      "  · next inject /vitafeed compress inject " + filed.key,
  };
}

/**
 * Classify Telegram attachment for /vitafeed file path.
 */
export function pickTelegramMedia(message = {}) {
  const m = message || {};
  if (m.document) {
    return {
      ok: true,
      kind: "document",
      fileId: m.document.file_id,
      name: m.document.file_name || "document.bin",
      mime: m.document.mime_type || guessMime(m.document.file_name),
      size: m.document.file_size || 0,
    };
  }
  if (m.audio) {
    return {
      ok: true,
      kind: "audio",
      fileId: m.audio.file_id,
      name: m.audio.file_name || (m.audio.title ? m.audio.title + ".mp3" : "audio.mp3"),
      mime: m.audio.mime_type || "audio/mpeg",
      size: m.audio.file_size || 0,
    };
  }
  if (m.voice) {
    return {
      ok: true,
      kind: "voice",
      fileId: m.voice.file_id,
      name: "voice.ogg",
      mime: m.voice.mime_type || "audio/ogg",
      size: m.voice.file_size || 0,
    };
  }
  if (m.video) {
    return {
      ok: true,
      kind: "video",
      fileId: m.video.file_id,
      name: m.video.file_name || "video.mp4",
      mime: m.video.mime_type || "video/mp4",
      size: m.video.file_size || 0,
    };
  }
  if (m.video_note) {
    return {
      ok: true,
      kind: "video_note",
      fileId: m.video_note.file_id,
      name: "video_note.mp4",
      mime: "video/mp4",
      size: m.video_note.file_size || 0,
    };
  }
  if (m.photo?.length) {
    const best = m.photo[m.photo.length - 1];
    return {
      ok: true,
      kind: "photo",
      fileId: best.file_id,
      name: "photo.jpg",
      mime: "image/jpeg",
      size: best.file_size || 0,
    };
  }
  return { ok: false, reason: "no document/audio/voice/video/photo on message" };
}

/**
 * Download Telegram file bytes (caller supplies token). Never invents content.
 */
export async function downloadTelegramFileBytes(fileId, {
  token = process.env.TELEGRAM_BOT_TOKEN,
  fetchImpl = fetch,
  maxBytes = VITAFILE_SOFT_MAX_BYTES * 4,
} = {}) {
  const tok = String(token || "").trim();
  if (!tok) return { ok: false, reason: "TELEGRAM_BOT_TOKEN missing" };
  if (!fileId) return { ok: false, reason: "missing file_id" };
  const metaRes = await fetchImpl(
    "https://api.telegram.org/bot" + tok + "/getFile?file_id=" + encodeURIComponent(fileId),
  );
  const meta = await metaRes.json().catch(() => null);
  if (!meta?.ok || !meta.result?.file_path) {
    return { ok: false, reason: "getFile failed — " + (meta?.description || metaRes.status) };
  }
  const path = meta.result.file_path;
  const size = Number(meta.result.file_size) || 0;
  if (size > maxBytes) {
    return {
      ok: false,
      reason: "file too large for packet upload (" + size + " > " + maxBytes + ")",
      size,
    };
  }
  const binRes = await fetchImpl("https://api.telegram.org/file/bot" + tok + "/" + path);
  if (!binRes.ok) {
    return { ok: false, reason: "file download HTTP " + binRes.status };
  }
  const ab = await binRes.arrayBuffer();
  const bytes = Buffer.from(ab);
  if (bytes.length > maxBytes) {
    return { ok: false, reason: "downloaded bytes exceed max", size: bytes.length };
  }
  return { ok: true, bytes, size: bytes.length, filePath: path };
}

/** Tiny valid WAV (silence) — demo song for player tests without holding media. */
export function makeDemoWavBytes({ seconds = 0.15, sampleRate = 8000, freq = 440 } = {}) {
  const n = Math.max(1, Math.floor(seconds * sampleRate));
  const dataSize = n * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const sample = Math.sin(2 * Math.PI * freq * t) * 0.35 * 32767;
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, sample | 0)), 44 + i * 2);
  }
  return buf;
}

export function summarizeVitaFileForCard(fileMeta) {
  if (!fileMeta) return "";
  return (
    "VITAFILE · " + (fileMeta.name || "?") +
    " · mime=" + (fileMeta.mime || "?") +
    " · raw=" + (fileMeta.rawBytes ?? 0) + "B" +
    " · play=" + (fileMeta.playKind || "file") +
    (fileMeta.softWarn ? " · WARN soft-size" : "")
  );
}

/** Extract VIN bodies from mixed strand chunks (sealed or prepared). */
export function vitaFeedLinesFromStrand(strand) {
  const chunks = strand?.chunks || strand?.lines || [];
  return chunks.map((c) => {
    if (typeof c === "string") return c;
    return c.fullLine || c.line || "";
  }).filter(Boolean);
}

export function parseAnyVitaFeedUtf8(utf8) {
  const parsed = parseVitaFeedLine(utf8);
  if (!parsed) return { ok: false, reason: "not VITAFEED line" };
  return { ok: true, ...parsed };
}
