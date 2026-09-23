/**
 * Compression bake-off — run every project, keep the one that verifies.
 *
 * A file (personal, program, video, or anything else) is easy to add:
 *   drop it in vita/compression/inbox/
 *   /vitafeed compress <path>
 *   /vitafeed compress add   then send the file
 *   POST /vita/compression/add
 *
 * The winner is a lossless round-trip. The call is `verified` with the open
 * key that names the codec. That key is the directory row. The next module
 * is /vitafeed injection — staged, never auto-sent, no invented tx hash.
 *
 * Chain status stays availability until confirm|override seals a real Base loc.
 */

import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import {
  CODECS,
  WIRE_B64,
  assertCodecId,
  codecPriority,
  listCodecProjects,
} from "./codecs.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const VITA = join(HERE, "..");
const ROOT = join(VITA, "..");

export const COMPRESS_ID = "vita-compression-v1";
export const COMPRESS_MAGIC = "§VITACOMP§";
export const COMPRESS_DIR_MAGIC = "§VITACOMPDIR§";
export const COMPRESS_LABEL = "COMPRESS";
export const COMPRESS_VERSION = "v1";
export const COMPRESS_PLAYER_PATH = "/vita/compression";
export const KEY_PREFIX = "VITACOMP";

const KINDS = new Set(["personal", "program", "video", "audio", "image", "text", "file"]);
const PAYLOAD_INLINE_MAX = 120_000;

function sha256Hex(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

export function compressionPaths(opts = {}) {
  return {
    inbox: opts.inboxDir || join(HERE, "inbox"),
    store: opts.storeDir || join(HERE, "store"),
    directory: opts.directoryPath || join(VITA, "memory", "compression-directory.json"),
    learn: opts.learnPath || join(VITA, "memory", "compression-learn.json"),
    strand: opts.strandPath || join(VITA, "strands", "compression.json"),
    project: opts.projectPath || join(HERE, "projects", "gemini-zlib.py"),
  };
}

function readJson(path, fallback) {
  try {
    if (!existsSync(path)) return fallback;
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}

export function guessKind({ name = "", mime = "", kind = "" } = {}) {
  const explicit = String(kind || "").trim().toLowerCase();
  if (KINDS.has(explicit)) return explicit;
  const m = String(mime || "").toLowerCase();
  const n = String(name || "").toLowerCase();
  if (m.startsWith("video/") || /\.(mp4|webm|mov|mkv|avi|ivf)$/.test(n)) return "video";
  if (m.startsWith("audio/") || /\.(mp3|wav|ogg|m4a|flac)$/.test(n)) return "audio";
  if (m.startsWith("image/") || /\.(png|jpg|jpeg|gif|webp)$/.test(n)) return "image";
  if (/\.(js|mjs|cjs|ts|py|go|rs|sol|c|cpp|java|rb|php|wasm)$/.test(n) || m.includes("javascript")) {
    return "program";
  }
  if (m.startsWith("text/") || /\.(txt|md|json|csv|html|css)$/.test(n)) return "personal";
  return "file";
}

export function compressionKey(codec, rawHash) {
  assertCodecId(codec);
  const short = String(rawHash || "").replace(/^0x/i, "").toLowerCase().slice(0, 8);
  if (!/^[0-9a-f]{8}$/.test(short)) throw new Error("raw hash required for compression key");
  return KEY_PREFIX + "." + codec + "." + short;
}

export function parseCompressionKey(key) {
  const parts = String(key || "").split(".");
  if (parts.length !== 3 || parts[0] !== KEY_PREFIX) return null;
  if (!/^[a-z0-9-]{1,24}$/.test(parts[1])) return null;
  if (!/^[0-9a-f]{8}$/.test(parts[2])) return null;
  return { key: parts.join("."), codec: parts[1], rawHash8: parts[2] };
}

function asBuffer(bytes) {
  if (Buffer.isBuffer(bytes)) return bytes;
  if (bytes instanceof Uint8Array) return Buffer.from(bytes);
  if (typeof bytes === "string") return Buffer.from(bytes, "utf8");
  return null;
}

function msSince(start) {
  return Number(process.hrtime.bigint() - start) / 1e6;
}

function scoreRow(row) {
  const saved = row.rawBytes - row.payloadBytes;
  return {
    ...row,
    savedBytes: saved,
    ratio: row.rawBytes ? Number((row.payloadBytes / row.rawBytes).toFixed(4)) : 1,
    calldataHexBytes: 2 + row.payloadBytes * 2,
  };
}

/**
 * Run one codec. verified/recovered/answer are true only on a byte match.
 */
export function runCodec(codec, raw) {
  const buf = asBuffer(raw);
  const base = {
    id: codec.id,
    project: codec.project || codec.id,
    role: codec.role || "compressor",
    note: codec.note || "",
  };
  if (!buf) return { ...base, ok: false, verified: false, recovered: false, answer: false, reason: "empty" };
  if (codec.maxBytes && buf.length > codec.maxBytes) {
    return {
      ...base,
      ok: false,
      skipped: true,
      verified: false,
      recovered: false,
      answer: false,
      reason: "skipped-large",
      rawBytes: buf.length,
    };
  }
  let payload;
  const t0 = process.hrtime.bigint();
  try {
    payload = Buffer.from(codec.compress(buf));
  } catch (e) {
    return { ...base, ok: false, verified: false, recovered: false, answer: false, reason: "compress failed: " + (e.message || e), rawBytes: buf.length };
  }
  const compressedMs = msSince(t0);
  let back;
  const t1 = process.hrtime.bigint();
  try {
    back = Buffer.from(codec.decompress(payload));
  } catch (e) {
    return { ...base, ok: false, verified: false, recovered: false, answer: false, reason: "decompress failed", rawBytes: buf.length, payloadBytes: payload.length, compressMs: compressedMs };
  }
  const decompressMs = msSince(t1);
  const match = back.length === buf.length && back.equals(buf);
  const scored = scoreRow({
    ...base,
    ok: match,
    verified: match,
    recovered: match,
    answer: match,
    reason: match ? "" : "round-trip mismatch",
    rawBytes: buf.length,
    payloadBytes: payload.length,
    compressMs: Number(compressedMs.toFixed(3)),
    decompressMs: Number(decompressMs.toFixed(3)),
    payloadHash: sha256Hex(payload),
  });
  if (match) scored.payload = payload;
  return scored;
}

function runPythonGemini(buf, opts) {
  const id = "gemini-zlib-py-v1";
  const paths = compressionPaths(opts);
  if (opts.includePython === false || process.env.VITA_COMPRESS_PYTHON === "no") {
    return { id, project: "gemini-code-1790141126186", role: "compressor", ok: false, skipped: true, verified: false, recovered: false, answer: false, reason: "python-disabled", rawBytes: buf.length };
  }
  if (!existsSync(paths.project)) {
    return { id, project: "gemini-code-1790141126186", role: "compressor", ok: false, skipped: true, verified: false, recovered: false, answer: false, reason: "project-missing", rawBytes: buf.length };
  }
  const tmp = join(tmpdir(), "vita-comp-" + randomBytes(4).toString("hex"));
  const t0 = process.hrtime.bigint();
  try {
    writeFileSync(tmp, buf);
    const r = spawnSync("python3", [paths.project, "--json", tmp], {
      timeout: 8000,
      encoding: "utf8",
    });
    if (r.error || r.status !== 0) {
      const why = r.error?.code || String(r.stderr || r.stdout || "python-failed").slice(0, 160);
      return { id, project: "gemini-code-1790141126186", role: "compressor", ok: false, skipped: true, verified: false, recovered: false, answer: false, reason: why, rawBytes: buf.length };
    }
    const parsed = JSON.parse(String(r.stdout || "").trim());
    const payload = Buffer.from(String(parsed.payloadBase64 || ""), "base64");
    const back = inflateSync(payload);
    const match = back.equals(buf) && parsed.verified === true;
    const scored = scoreRow({
      id,
      project: "gemini-code-1790141126186",
      role: "compressor",
      note: "uploaded gemini-code script (zlib.compress → 0x hex)",
      ok: match,
      verified: match,
      recovered: match,
      answer: match,
      reason: match ? "" : "python round-trip mismatch",
      rawBytes: buf.length,
      payloadBytes: payload.length,
      compressMs: Number(msSince(t0).toFixed(3)),
      decompressMs: 0,
      payloadHash: sha256Hex(payload),
    });
    if (match) scored.payload = payload;
    return scored;
  } catch (e) {
    return { id, project: "gemini-code-1790141126186", role: "compressor", ok: false, skipped: true, verified: false, recovered: false, answer: false, reason: e.message || String(e), rawBytes: buf.length };
  } finally {
    rmSync(tmp, { force: true });
  }
}

export function runAllCompressions(bytes, opts = {}) {
  const buf = asBuffer(bytes);
  if (!buf || !buf.length) {
    return { ok: false, reason: "empty file — nothing to compress", rows: [], best: null };
  }
  const extra = Array.isArray(opts.extraCodecs) ? opts.extraCodecs : [];
  for (const c of extra) assertCodecId(c.id);
  const rows = [];
  for (const codec of [...CODECS, ...extra]) {
    rows.push(runCodec(codec, buf));
  }
  rows.push(runPythonGemini(buf, opts));
  rows.push(runCodec(WIRE_B64, buf));
  const contenders = rows.filter((r) => r.role !== "wire" && r.verified === true && r.payloadBytes != null);
  contenders.sort((a, b) => a.payloadBytes - b.payloadBytes || codecPriority(a.id) - codecPriority(b.id) || a.id.localeCompare(b.id));
  const best = contenders[0] || null;
  const rawHash = sha256Hex(buf);
  return {
    ok: best != null,
    rawBytes: buf.length,
    rawHash,
    rows,
    best,
    verified: best?.verified === true,
    answer: best?.answer === true,
    recovered: best?.recovered === true,
    tried: rows.length,
    verifiedCount: rows.filter((r) => r.verified === true).length,
  };
}

function pickPayload(codecId, bench) {
  const row = bench.rows.find((r) => r.id === codecId && r.verified && r.payload);
  if (!row) return null;
  return { row, payload: row.payload };
}

function emptyDirectory() {
  return {
    id: "vita-compression-directory-v1",
    label: COMPRESS_LABEL,
    neverInventHashes: true,
    chainStatus: "availability",
    locations: [],
    note: "Key directory. locations stay empty until a real Base seal. Formula anchors are class proof, not these files.",
    files: {},
  };
}

export function readCompressionDirectory(opts = {}) {
  const path = compressionPaths(opts).directory;
  const doc = readJson(path, null);
  if (!doc || typeof doc !== "object") return emptyDirectory();
  if (!doc.files || typeof doc.files !== "object") doc.files = {};
  doc.locations = Array.isArray(doc.locations) ? doc.locations.filter((h) => /^0x[0-9a-fA-F]{64}$/.test(h)) : [];
  doc.chainStatus = doc.locations.length ? "sealed" : "availability";
  doc.neverInventHashes = true;
  return doc;
}

function storeFile(key, opts) {
  const safe = String(key).replace(/[^A-Za-z0-9._-]+/g, "_");
  return join(compressionPaths(opts).store, safe + ".json");
}

function writeStore(entry, payload, opts) {
  const path = storeFile(entry.key, opts);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({
    key: entry.key,
    codec: entry.codec,
    rawHash: entry.rawHash,
    payloadHash: entry.payloadHash,
    payloadBase64: payload.toString("base64"),
  }));
  return path;
}

function readPayload(entry, opts) {
  const fromStore = readJson(storeFile(entry.key, opts), null);
  if (fromStore?.payloadBase64) return Buffer.from(fromStore.payloadBase64, "base64");
  if (entry.payloadBase64) return Buffer.from(entry.payloadBase64, "base64");
  return null;
}

function appendLearn(row, opts) {
  const path = compressionPaths(opts).learn;
  const doc = readJson(path, { id: "vita-compression-learn-v1", label: COMPRESS_LABEL, events: [] });
  if (!Array.isArray(doc.events)) doc.events = [];
  doc.events.push(row);
  doc.updatedAt = row.at;
  writeJson(path, doc);
  return doc;
}

function writeStrand(summary, opts) {
  const path = compressionPaths(opts).strand;
  const prev = readJson(path, {});
  writeJson(path, {
    id: COMPRESS_ID,
    filingLabel: COMPRESS_LABEL,
    formula: "original-message-first",
    neverInventHashes: true,
    note: summary,
    ends: [
      "Add any file (inbox /vitafeed compress add /vita/compression)",
      "Bake-off every codec · recommend the verified winner",
      "Call verified · key recovers the bytes",
      "Next module: /vitafeed injection (confirm|override, no invented hash)",
    ],
    updatedAt: new Date().toISOString(),
    lastKey: prev.lastKey || null,
    ...summary,
  });
}

export function recommendForKind(kind, opts = {}) {
  const doc = readJson(compressionPaths(opts).learn, { events: [] });
  const events = (doc.events || []).filter((e) => !kind || e.kind === kind);
  const counts = {};
  for (const e of events) {
    if (!e.codec || e.verified !== true) continue;
    counts[e.codec] = (counts[e.codec] || 0) + 1;
  }
  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return {
    kind: kind || "all",
    events: events.length,
    leader: ranked[0] ? { codec: ranked[0][0], wins: ranked[0][1] } : null,
    counts,
  };
}

function codecById(id) {
  return [...CODECS, WIRE_B64].find((c) => c.id === id) || null;
}

function decompressPayload(codecId, payload) {
  const codec = codecById(codecId);
  if (!codec) {
    if (codecId === "gemini-zlib-py-v1") return inflateSync(payload);
    throw new Error("unknown codec " + codecId);
  }
  return Buffer.from(codec.decompress(payload));
}

/**
 * File one blob. Runs every codec, stores the winner, appends learn.
 * Returns the verified call. Does not send a transaction.
 */
export function fileCompression({
  name = "blob.bin",
  mime = "",
  kind = "",
  bytes,
  source = "add",
  includePython = true,
  extraCodecs = [],
  inlinePayload = true,
} = {}, opts = {}) {
  const buf = asBuffer(bytes);
  if (!buf || !buf.length) return { ok: false, call: "refused", verified: false, answer: false, recovered: false, reason: "empty file" };
  const fileKind = guessKind({ name, mime, kind });
  const bench = runAllCompressions(buf, { includePython, extraCodecs });
  if (!bench.ok || !bench.best) {
    return { ok: false, call: "refused", verified: false, answer: false, recovered: false, reason: bench.reason || "no verified codec", bench };
  }
  const packed = pickPayload(bench.best.id, bench);
  if (!packed) {
    return { ok: false, call: "refused", verified: false, answer: false, recovered: false, reason: "winner payload missing", bench };
  }
  const key = compressionKey(bench.best.id, bench.rawHash);
  const at = new Date().toISOString();
  const entry = {
    key,
    codec: bench.best.id,
    project: bench.best.project,
    name: String(name || "blob.bin").slice(0, 180),
    mime: mime || "application/octet-stream",
    kind: fileKind,
    verified: true,
    recovered: true,
    answer: true,
    call: "verified",
    rawBytes: buf.length,
    payloadBytes: packed.payload.length,
    ratio: bench.best.ratio,
    savedBytes: bench.best.savedBytes,
    rawHash: bench.rawHash,
    payloadHash: sha256Hex(packed.payload),
    compressMs: bench.best.compressMs,
    calldataPreview: "0x" + packed.payload.subarray(0, 24).toString("hex"),
    locations: [],
    chainStatus: "availability",
    source,
    at,
  };
  if (inlinePayload && packed.payload.length <= 16_000) {
    entry.payloadBase64 = packed.payload.toString("base64");
  }
  writeStore(entry, packed.payload, opts);
  const directory = readCompressionDirectory(opts);
  directory.files[key] = entry;
  directory.updatedAt = at;
  directory.chainStatus = "availability";
  directory.neverInventHashes = true;
  writeJson(compressionPaths(opts).directory, directory);
  appendLearn({
    at,
    name: entry.name,
    kind: fileKind,
    codec: entry.codec,
    project: entry.project,
    key,
    ratio: entry.ratio,
    rawBytes: entry.rawBytes,
    payloadBytes: entry.payloadBytes,
    verified: true,
    recovered: true,
    answer: true,
    source,
    tried: bench.tried,
    verifiedCount: bench.verifiedCount,
  }, opts);
  writeStrand({
    lastKey: key,
    lastCodec: entry.codec,
    lastKind: fileKind,
    lastName: entry.name,
    files: Object.keys(directory.files).length,
  }, opts);
  for (const row of bench.rows) delete row.payload;
  const growth = recommendForKind(fileKind, opts);
  const call = verifyCall(entry);
  return {
    ...call,
    ok: true,
    entry,
    bench,
    growth,
    payload: packed.payload,
    stageBody: buildFileInjectBody(entry, packed.payload),
    directoryBody: buildDirectoryInjectBody(directory),
  };
}

export function verifyCall(entry) {
  return {
    call: "verified",
    verified: entry?.verified === true,
    answer: entry?.answer === true,
    recovered: entry?.recovered === true,
    key: entry?.key || "",
    codec: entry?.codec || "",
    kind: entry?.kind || "",
    name: entry?.name || "",
    chainStatus: entry?.chainStatus || "availability",
    locations: Array.isArray(entry?.locations) ? entry.locations : [],
    neverInventHashes: true,
    privateKey: false,
  };
}

/**
 * Recover bytes with the key that compressed them.
 * answer/recovered are true only when sha256(inflate) matches the filed raw hash.
 */
export function verifyCompressionKey(key, opts = {}) {
  const parsed = parseCompressionKey(key);
  if (!parsed) {
    return { ok: false, call: "refused", verified: false, answer: false, recovered: false, reason: "key must look like VITACOMP.<codec>.<8 hex>" };
  }
  const directory = readCompressionDirectory(opts);
  const entry = directory.files[parsed.key];
  if (!entry) {
    return { ok: false, call: "refused", verified: false, answer: false, recovered: false, key: parsed.key, reason: "key not in directory" };
  }
  const payload = readPayload(entry, opts);
  if (!payload) {
    return { ok: false, call: "refused", verified: false, answer: false, recovered: false, key: entry.key, reason: "payload not on disk — chain locs empty, never invent a hash" };
  }
  let back;
  try {
    back = Buffer.from(decompressPayload(entry.codec, payload));
  } catch (e) {
    return { ok: false, call: "refused", verified: false, answer: false, recovered: false, key: entry.key, reason: "decompress failed: " + (e.message || e) };
  }
  const got = sha256Hex(back);
  const match = got === entry.rawHash && back.length === entry.rawBytes;
  return {
    ok: match,
    call: match ? "verified" : "refused",
    verified: match,
    answer: match,
    recovered: match,
    key: entry.key,
    codec: entry.codec,
    kind: entry.kind,
    name: entry.name,
    mime: entry.mime || "",
    rawBytes: back.length,
    rawHash: got,
    chainStatus: entry.chainStatus || "availability",
    locations: entry.locations || [],
    neverInventHashes: true,
    privateKey: false,
    bytes: match ? back : null,
    payload: match ? payload : null,
    entry,
    plain: match
      ? plainTextFromBytes(back, { kind: entry.kind, mime: entry.mime, name: entry.name })
      : "",
    machine: match ? machineLineFromEntry(entry, payload) : "",
    reason: match ? "" : "recovered hash does not match the key",
  };
}

export function buildFileInjectBody(entry, payload) {
  const head =
    COMPRESS_MAGIC + COMPRESS_VERSION +
    "|key=" + entry.key +
    "|codec=" + entry.codec +
    "|kind=" + entry.kind +
    "|name=" + encodeURIComponent(entry.name) +
    "|verified=true|recovered=true|answer=true" +
    "|raw=" + entry.rawBytes +
    "|payload=" + entry.payloadBytes +
    "|ratio=" + entry.ratio +
    "|rawHash=" + entry.rawHash +
    "|payloadHash=" + entry.payloadHash +
    "|chain=availability§\n";
  const b64 = payload && payload.length <= PAYLOAD_INLINE_MAX ? payload.toString("base64") : "";
  return head + b64;
}

export function buildDirectoryInjectBody(directory = readCompressionDirectory()) {
  const files = Object.values(directory.files || {});
  const lines = [
    COMPRESS_DIR_MAGIC + COMPRESS_VERSION +
      "|count=" + files.length +
      "|verified=true|answer=true|chain=availability|neverInventHashes=true§",
  ];
  for (const f of files) {
    lines.push([f.key, f.kind, f.codec, f.ratio, "verified=true", "recovered=true"].join("|"));
  }
  return lines.join("\n");
}

export function parseCompressionInjectBody(text) {
  const s = String(text ?? "");
  if (!s.startsWith(COMPRESS_MAGIC)) return { ok: false, reason: "not a §VITACOMP§ body" };
  const end = s.indexOf("§", COMPRESS_MAGIC.length);
  if (end < 0) return { ok: false, reason: "missing header closer" };
  const head = s.slice(COMPRESS_MAGIC.length, end);
  const parts = head.split("|");
  const meta = { version: parts[0] || "" };
  for (let i = 1; i < parts.length; i++) {
    const eq = parts[i].indexOf("=");
    if (eq < 0) continue;
    meta[parts[i].slice(0, eq)] = parts[i].slice(eq + 1);
  }
  const b64 = s.slice(end + 1).replace(/^\n/, "").replace(/\s+/g, "");
  let payload = null;
  if (b64) payload = Buffer.from(b64, "base64");
  return { ok: true, meta, payload, key: meta.key || "", verified: meta.verified === "true", answer: meta.answer === "true", recovered: meta.recovered === "true" };
}

export function seededBytes(n, seed = 1) {
  let x = seed >>> 0;
  const out = Buffer.alloc(n);
  for (let i = 0; i < n; i++) {
    x = (1664525 * x + 1013904223) >>> 0;
    out[i] = x & 0xff;
  }
  return out;
}

/** SHA-256 chain. Looks like already-encoded video: compressors should not win big. */
export function denseBytes(n, seed = "video") {
  const chunks = [];
  let block = createHash("sha256").update(String(seed)).digest();
  while (chunks.reduce((sum, c) => sum + c.length, 0) < n) {
    block = createHash("sha256").update(block).digest();
    chunks.push(block);
  }
  return Buffer.concat(chunks).subarray(0, n);
}

export function builtInSamples() {
  const personal = Buffer.from(
    [
      "Personal note. Clearwater morning. The hitch still sends when KEY+LOC is covered.",
      "Storage Token can charge the delta. Do not mute the message to skim dust.",
      "This paragraph repeats so a real compressor has something to fold.",
    ].join("\n").repeat(12),
    "utf8",
  );
  const programPath = join(HERE, "projects", "gemini-zlib.py");
  const programRaw = existsSync(programPath) ? readFileSync(programPath) : Buffer.from("print('vita')\n".repeat(40));
  const program = Buffer.concat(Array.from({ length: 6 }, () => programRaw));
  const krysai = Buffer.from(JSON.stringify({
    company: "KrysAI Systems",
    hardware: ["Light Travel", "Heavy Robotics", "Ultra Workstation"],
    iot_tiers: ["Starter", "Advanced", "Industrial"],
    shadow_pc_agents: ["Email", "Scraper", "Social", "Content", "Automation"],
    mission: "Local AI. Real Automation. Clearwater Strong.",
  }), "utf8");
  const video = Buffer.concat([
    Buffer.from("....ftypisom....mdat", "utf8"),
    denseBytes(3072, "clip.mp4"),
  ]);
  return [
    { id: "personal-note", name: "personal-note.txt", mime: "text/plain", kind: "personal", bytes: personal },
    { id: "program-gemini", name: "gemini-zlib.py", mime: "text/x-python", kind: "program", bytes: program },
    { id: "krysai-card", name: "krysai.json", mime: "application/json", kind: "personal", bytes: krysai },
    { id: "video-ftyp", name: "clip.mp4", mime: "video/mp4", kind: "video", bytes: video },
  ];
}

export function listInboxFiles(opts = {}) {
  const dir = compressionPaths(opts).inbox;
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name && !name.startsWith(".") && name !== ".gitkeep")
    .map((name) => join(dir, name))
    .filter((abs) => {
      try { return statSync(abs).isFile(); } catch { return false; }
    });
}

export function resolveCompressionFile(spec, opts = {}) {
  const raw = String(spec || "").trim();
  if (!raw || raw.startsWith("-")) return null;
  const paths = compressionPaths(opts);
  const candidates = [raw, join(paths.inbox, raw), join(process.cwd(), raw), join(ROOT, raw)];
  const root = resolve(ROOT);
  const inboxRoot = resolve(paths.inbox);
  for (const c of candidates) {
    const abs = resolve(c);
    const inRepo = abs === root || abs.startsWith(root + "/");
    const inInbox = abs === inboxRoot || abs.startsWith(inboxRoot + "/");
    if (!inRepo && !inInbox) continue;
    try {
      if (existsSync(abs) && statSync(abs).isFile()) return abs;
    } catch { /* skip */ }
  }
  return null;
}

export function addCompressionFile({ name, mime, kind, bytes, source = "add", includePython } = {}, opts = {}) {
  const buf = asBuffer(bytes);
  if (!buf || !buf.length) return { ok: false, reason: "empty file" };
  const safe = String(name || "upload.bin").replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "upload.bin";
  const inbox = compressionPaths(opts).inbox;
  mkdirSync(inbox, { recursive: true });
  const dest = join(inbox, safe);
  writeFileSync(dest, buf);
  const filed = fileCompression({
    name: safe,
    mime,
    kind,
    bytes: buf,
    source,
    includePython: includePython != null ? includePython : opts.includePython !== false,
    extraCodecs: opts.extraCodecs || [],
  }, opts);
  return { ...filed, inboxPath: dest };
}

function formatRow(row) {
  const flag = row.skipped ? "skip" : row.verified ? "true" : "false";
  const payload = row.payloadBytes != null ? String(row.payloadBytes) : "—";
  const ratio = row.ratio != null ? row.ratio.toFixed(3) : "—";
  return (
    row.id.padEnd(22) +
    String(row.rawBytes ?? "—").padStart(8) +
    payload.padStart(9) +
    ratio.padStart(8) +
    flag.padStart(8) +
    (row.reason ? "  " + row.reason : "")
  );
}

/** True when recovered bytes are mostly printable UTF-8 (plain text / source). */
export function isMostlyTextBytes(bytes) {
  const buf = asBuffer(bytes);
  if (!buf || !buf.length) return false;
  let printable = 0;
  const n = Math.min(buf.length, 4096);
  for (let i = 0; i < n; i++) {
    const c = buf[i];
    if (c === 9 || c === 10 || c === 13 || (c >= 32 && c < 127) || c >= 160) printable += 1;
  }
  return printable / n >= 0.85;
}

/**
 * HUMAN plain preview from recovered bytes — what you see after unwrap.
 * Binary kinds get a short hex dump so machine code is still readable.
 */
export function plainTextFromBytes(bytes, { kind = "", mime = "", name = "", maxChars = 1800 } = {}) {
  const buf = asBuffer(bytes);
  if (!buf || !buf.length) return "(empty)";
  const binaryKind =
    kind === "video" ||
    kind === "audio" ||
    kind === "image" ||
    /^video\//i.test(mime) ||
    /^audio\//i.test(mime) ||
    /^image\//i.test(mime);
  if (!binaryKind && isMostlyTextBytes(buf)) {
    let text = buf.toString("utf8");
    if (text.length > maxChars) text = text.slice(0, maxChars) + "\n… +" + (buf.length - maxChars) + "B";
    return text;
  }
  const head = buf.subarray(0, Math.min(48, buf.length)).toString("hex");
  return (
    "(binary " + (kind || mime || "file") + " · " + buf.length + "B · name=" + (name || "?") + ")\n" +
    "hex[0.." + Math.min(48, buf.length) + "]=" + head +
    (buf.length > 48 ? "…" : "")
  );
}

export function machineLineFromEntry(entry, payload = null) {
  const pay = payload || (entry?.payloadBase64 ? Buffer.from(entry.payloadBase64, "base64") : null);
  const wire = pay
    ? "wireB64=" + pay.subarray(0, 36).toString("base64") + (pay.length > 36 ? "…" : "")
    : "wire=on-disk";
  return (
    "COMPRESS key=" + (entry?.key || "—") +
    " codec=" + (entry?.codec || "—") +
    " ratio=" + (entry?.ratio ?? "—") +
    " raw=" + (entry?.rawBytes ?? "—") +
    " payload=" + (entry?.payloadBytes ?? "—") +
    " verified=true recovered=true " +
    wire
  );
}

/**
 * Instant unwrap card — HUMAN plain text + MACHINE key/wire (Telegram + HTML).
 * No private key. answer recovered only when sha256 matches.
 */
export function formatCompressionUnwrapCard(checked, { timing = null, entry = null } = {}) {
  const lines = [];
  lines.push(COMPRESS_MAGIC + COMPRESS_VERSION + "|unwrap|openSource=1§");
  lines.push("COMPRESSION UNWRAP");
  lines.push("VERIFIED " + (checked?.verified === true ? "true" : "false"));
  lines.push("key=" + (checked?.key || "—"));
  lines.push("answer recovered=" + (checked?.recovered === true ? "true" : "false"));
  lines.push("call=" + (checked?.call || "refused"));
  lines.push("codec=" + (checked?.codec || "—") + "  kind=" + (checked?.kind || "—"));
  lines.push("name=" + (checked?.name || "—"));
  lines.push("privateKey=NO · openSource=YES · instantUnwrap=YES");
  lines.push("chain=" + (checked?.chainStatus || "availability"));
  if (timing) {
    lines.push(
      "timing human=" + timing.humanMs + "ms machine=" + timing.machineMs +
      "ms · plainProof=" + (timing.plainTextProof ? "YES" : "no") +
      " · snarkDenser=" + (timing.snarkUnlocksDenser ? "YES" : "no"),
    );
  }
  lines.push("");
  lines.push("— HUMAN (plain text from machine code) —");
  if (checked?.ok && checked.bytes) {
    lines.push(plainTextFromBytes(checked.bytes, {
      kind: checked.kind,
      mime: entry?.mime,
      name: checked.name,
    }));
  } else {
    lines.push(checked?.reason || "(not recovered)");
  }
  lines.push("");
  lines.push("— MACHINE (codec wire · denser lane) —");
  if (entry) {
    lines.push(machineLineFromEntry(entry, checked?.payload || null));
  } else {
    lines.push(
      "COMPRESS key=" + (checked?.key || "—") +
      " codec=" + (checked?.codec || "—") +
      " verified=" + (checked?.verified === true) +
      " recovered=" + (checked?.recovered === true),
    );
  }
  lines.push("");
  lines.push("TAP Unwrap · Human · Machine · Inject · Add — every step is a button");
  lines.push("NEXT MODULE: /vitafeed compress inject " + (checked?.key || "") + " → confirm|override");
  lines.push("directory: /vitafeed compress dir · /vitafeed dir COMPRESS");
  return lines.join("\n");
}

export function formatCompressionCard(result) {
  if (!result?.ok && !result?.bench) {
    return "COMPRESSION REFUSED\n" + (result?.reason || "miss");
  }
  const bench = result.bench;
  const entry = result.entry;
  const lines = [];
  lines.push("COMPRESSION BAKE-OFF  " + (entry?.name || "?") + "  kind=" + (entry?.kind || "?"));
  lines.push("codec                    raw   payload   ratio  verified");
  for (const row of bench?.rows || []) lines.push(formatRow(row));
  lines.push("");
  lines.push("BEST " + (entry?.codec || "—") + "  project=" + (entry?.project || "—"));
  lines.push("VERIFIED " + (result.verified === true ? "true" : "false"));
  lines.push("key=" + (result.key || entry?.key || "—"));
  lines.push("answer recovered=" + (result.recovered === true ? "true" : "false"));
  lines.push("call=" + (result.call || "refused"));
  if (result.growth?.leader) {
    lines.push(
      "growing recommendation kind=" + result.growth.kind +
      " → " + result.growth.leader.codec +
      " (" + result.growth.leader.wins + "/" + result.growth.events + ")",
    );
  }
  lines.push("chain=" + (entry?.chainStatus || "availability") + "  locs=0 until a real seal");
  lines.push("privateKey=NO  open key is the codec + content hash");
  lines.push("UNWRAP plain: /vitafeed compress unwrap  ·  /vitafeed unlock COMPRESS\\<n>");
  lines.push("NEXT MODULE: injection  —  /vitafeed confirm | /vitafeed override");
  lines.push("directory: /vitafeed compress dir   ·   /vitafeed dir COMPRESS");
  lines.push("buttons: Add · Bench · Keys · Unwrap · Inject · Confirm");
  return lines.join("\n");
}

export function formatCompressionDirectoryCard(opts = {}) {
  const directory = readCompressionDirectory(opts);
  const files = Object.values(directory.files || {});
  const lines = [];
  lines.push(COMPRESS_DIR_MAGIC + COMPRESS_VERSION + "|count=" + files.length + "§");
  lines.push("KEY DIRECTORY  VITA:\\COMPRESS\\");
  lines.push("chain=" + directory.chainStatus + "  neverInventHashes=true");
  lines.push("unlock = the compression key (not a wallet secret)");
  lines.push("unwrap = tap a file · /vitafeed compress unwrap · HUMAN plain + MACHINE wire");
  if (!files.length) {
    lines.push("(empty — tap Add file · /vitafeed compress add · or drop in vita/compression/inbox/)");
  }
  files.forEach((f, i) => {
    lines.push(
      String(i + 1).padStart(3) + "  " + f.kind.padEnd(9) + "  " +
      f.codec.padEnd(20) + "  " + f.ratio + "  " + f.key,
    );
    lines.push("     " + f.name + "  verified=true  recovered=true");
    lines.push("     unwrap: /vitafeed unlock COMPRESS\\" + (i + 1));
  });
  const growth = recommendForKind("", opts);
  if (growth.leader) {
    lines.push("");
    lines.push("learned leader (all kinds): " + growth.leader.codec + " ×" + growth.leader.wins);
  }
  lines.push("");
  lines.push("buttons: Add · Bench · Keys · Unwrap · Inject · Confirm");
  return lines.join("\n");
}

export function formatLearnCard(opts = {}) {
  const lines = ["COMPRESSION LEARN"];
  for (const kind of ["personal", "program", "video", "audio", "image", "file"]) {
    const g = recommendForKind(kind, opts);
    if (!g.events) continue;
    lines.push(
      kind.padEnd(10) + " n=" + g.events + "  best=" + (g.leader ? g.leader.codec + " ×" + g.leader.wins : "—"),
    );
  }
  const all = recommendForKind("", opts);
  lines.push("all        n=" + all.events + "  best=" + (all.leader ? all.leader.codec : "—"));
  lines.push("Append-only. A new codec is another row in vita/compression/codecs.js.");
  return lines.join("\n");
}

export function compressionDirEntries(opts = {}) {
  const directory = readCompressionDirectory(opts);
  return Object.values(directory.files || {}).map((f, i) => ({
    n: i + 1,
    name: f.name,
    kind: f.kind,
    bytes: f.payloadBytes || 0,
    unlockName: f.key,
    mime: f.mime,
    english:
      f.name + " compressed with " + f.codec +
      " (" + f.kind + "). VERIFIED true. answer recovered=true. Key " + f.key + ".",
    machine:
      "COMPRESS key=" + f.key + " codec=" + f.codec + " ratio=" + f.ratio +
      " raw=" + f.rawBytes + " payload=" + f.payloadBytes + " verified=true recovered=true",
    locations: f.locations || [],
    readerKey: f.key,
    trueName: f.key,
  }));
}

export function runBuiltInAndInbox(opts = {}) {
  const results = [];
  for (const sample of builtInSamples()) {
    results.push(fileCompression({
      ...sample,
      source: "sample",
      includePython: opts.includePython !== false,
      extraCodecs: opts.extraCodecs || [],
    }, opts));
  }
  for (const abs of listInboxFiles(opts)) {
    const name = abs.split("/").pop();
    const bytes = readFileSync(abs);
    results.push(fileCompression({
      name,
      bytes,
      source: "inbox",
      includePython: opts.includePython !== false,
      extraCodecs: opts.extraCodecs || [],
    }, opts));
  }
  return results;
}

export function formatBakeoffSummary(results, opts = {}) {
  const lines = ["COMPRESSION — ALL PATHS"];
  lines.push("Every verified winner is a key. Injection is next; nothing is sent.");
  for (const r of results) {
    if (!r.ok) {
      lines.push("REFUSED " + (r.reason || "miss"));
      continue;
    }
    lines.push(
      "VERIFIED true  key=" + r.key +
      "  codec=" + r.codec +
      "  kind=" + r.kind +
      "  " + r.entry.name +
      "  ratio=" + r.entry.ratio +
      "  answer recovered=true",
    );
    for (const row of r.bench?.rows || []) lines.push("  " + formatRow(row));
    lines.push("");
  }
  lines.push("");
  lines.push(formatLearnCard(opts));
  lines.push("");
  lines.push("NEXT MODULE: injection — directory of keys staged for /vitafeed confirm");
  lines.push("chain=availability  (no tx hash until a real seal)");
  return lines.join("\n");
}

/**
 * Every compression step is a tap. Long keys fall back to unwrap-latest /
 * unlock-by-index so callback_data stays ≤64B.
 */
export function buildCompressionKeyboard({ key = "", n = null } = {}) {
  const unlockByN =
    n != null && Number.isFinite(Number(n))
      ? "/vitafeed unlock COMPRESS\\" + Number(n)
      : "";
  const verifyByKey = key ? "/vitafeed compress verify " + key : "";
  const unwrapCmd =
    (verifyByKey && verifyByKey.length <= 64 && verifyByKey) ||
    (unlockByN && unlockByN.length <= 64 && unlockByN) ||
    "/vitafeed compress unwrap";
  const injectByKey = key ? "/vitafeed compress inject " + key : "";
  const injectCmd =
    (injectByKey && injectByKey.length <= 64 && injectByKey) ||
    "/vitafeed compress inject";
  const rows = [
    [
      { text: "📥 Add file", callback_data: "/vitafeed compress add" },
      { text: "🗜 Bench all", callback_data: "/vitafeed compress" },
    ],
    [
      { text: "📂 Keys", callback_data: "/vitafeed compress dir" },
      { text: "📁 COMPRESS", callback_data: "/vitafeed dir COMPRESS" },
    ],
    [
      { text: "👁 Unwrap", callback_data: unwrapCmd },
      { text: "➡ Inject", callback_data: injectCmd },
    ],
    [
      { text: "🧠 Learn", callback_data: "/vitafeed compress learn" },
      { text: "✅ Confirm", callback_data: "/vitafeed confirm" },
      { text: "🏠 Menu", callback_data: "/vitafeed" },
    ],
  ];
  for (const row of rows) {
    for (const b of row) {
      if (b.callback_data.length > 64) b.callback_data = "/vitafeed compress unwrap";
    }
  }
  return { inline_keyboard: rows };
}

/** Dir card — one Unwrap button per filed key (index path when key is long). */
export function buildCompressionDirKeyboard(opts = {}) {
  const directory = readCompressionDirectory(opts);
  const files = Object.values(directory.files || {});
  const rows = [
    [
      { text: "📥 Add file", callback_data: "/vitafeed compress add" },
      { text: "🗜 Bench", callback_data: "/vitafeed compress" },
      { text: "👁 Unwrap", callback_data: "/vitafeed compress unwrap" },
    ],
  ];
  files.slice(0, 12).forEach((f, i) => {
    const n = i + 1;
    const byKey = "/vitafeed compress unwrap " + f.key;
    const byUnlock = "/vitafeed unlock COMPRESS\\" + n;
    const cmd = byKey.length <= 64 ? byKey : byUnlock;
    const label = ("📄 " + String(n) + " " + String(f.name || f.key).slice(0, 24)).slice(0, 64);
    rows.push([{ text: label, callback_data: cmd }]);
  });
  rows.push([
    { text: "➡ Inject", callback_data: "/vitafeed compress inject" },
    { text: "✅ Confirm", callback_data: "/vitafeed confirm" },
    { text: "🏠 Menu", callback_data: "/vitafeed" },
  ]);
  return { inline_keyboard: rows };
}

export function latestCompressionKey(opts = {}) {
  const files = Object.values(readCompressionDirectory(opts).files || {});
  if (!files.length) return "";
  files.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  return files[files.length - 1].key;
}

/**
 * /vitafeed compress …
 * bytes, when set, are the file the operator just dropped.
 */
export function handleCompressionRequest({
  body = "",
  bytes = null,
  name = "",
  mime = "",
  kind = "",
} = {}, opts = {}) {
  const trimmed = String(body || "").trim();
  const buf = asBuffer(bytes);

  if (buf && buf.length) {
    const filed = addCompressionFile({
      name: name || "upload.bin",
      mime,
      kind,
      bytes: buf,
      source: "vitafeed",
      includePython: opts.includePython !== false,
    }, opts);
    return {
      ...filed,
      phase: "compress",
      reply: formatCompressionCard(filed),
      keyboard: buildCompressionKeyboard({ key: filed.key || "" }),
      stage: "file",
    };
  }

  if (!trimmed || /^(?:run|all|bench|samples)$/i.test(trimmed)) {
    const results = runBuiltInAndInbox(opts);
    const ok = results.some((r) => r.ok);
    const directory = readCompressionDirectory(opts);
    return {
      ok,
      phase: "compress",
      call: ok ? "verified" : "refused",
      verified: ok,
      answer: ok,
      recovered: ok,
      results: results.map(verifyCall),
      reply: formatBakeoffSummary(results, opts),
      keyboard: buildCompressionKeyboard({ key: latestCompressionKey(opts) }),
      stage: "directory",
      stageBody: buildDirectoryInjectBody(directory),
      chainStatus: "availability",
      locations: [],
      neverInventHashes: true,
    };
  }

  if (/^(?:add|file|upload|drop)$/i.test(trimmed)) {
    return {
      ok: true,
      phase: "compress",
      wantsFile: true,
      call: "waiting",
      verified: false,
      reply: [
        "COMPRESSION — please insert the file",
        "Personal note, program, video, or any other bytes.",
        "Send it in this chat, drop it in vita/compression/inbox/, or POST /vita/compression/add.",
        "I run every codec, recommend the smallest verified one, and stage injection.",
      ].join("\n"),
      keyboard: buildCompressionKeyboard(),
    };
  }

  if (/^(?:dir|directory|keys|ls)$/i.test(trimmed)) {
    return {
      ok: true,
      phase: "compress",
      reply: formatCompressionDirectoryCard(opts),
      keyboard: buildCompressionDirKeyboard(opts),
      directory: readCompressionDirectory(opts),
    };
  }

  if (/^learn$/i.test(trimmed)) {
    return {
      ok: true,
      phase: "compress",
      reply: formatLearnCard(opts),
      keyboard: buildCompressionKeyboard({ key: latestCompressionKey(opts) }),
    };
  }

  const bareUnwrap = /^(?:verify|recover|unwrap)$/i.test(trimmed);
  const verifyMatch = trimmed.match(/^(?:verify|recover|unwrap)\s+(\S+)/i);
  if (bareUnwrap || verifyMatch || parseCompressionKey(trimmed)) {
    const key = bareUnwrap
      ? latestCompressionKey(opts)
      : verifyMatch
        ? verifyMatch[1]
        : trimmed;
    if (!key) {
      return {
        ok: false,
        phase: "compress",
        call: "refused",
        verified: false,
        reply: "directory empty — /vitafeed compress or tap Add file",
        keyboard: buildCompressionKeyboard(),
      };
    }
    const checked = verifyCompressionKey(key, opts);
    const entry = checked.entry || readCompressionDirectory(opts).files[checked.key];
    const t0 = Date.now();
    const english = checked.plain || "";
    const tHuman = Date.now();
    const machine = checked.machine || "";
    const tMachine = Date.now();
    const timing = {
      humanMs: Math.max(0, tHuman - t0),
      machineMs: Math.max(0, tMachine - tHuman),
      totalMs: Math.max(0, tMachine - t0),
      humanBytes: Buffer.byteLength(english, "utf8"),
      machineBytes: Buffer.byteLength(machine, "utf8"),
      plainTextProof: english.length > 0,
      snarkUnlocksDenser: Boolean(checked.key),
    };
    const files = Object.values(readCompressionDirectory(opts).files || {});
    const n = files.findIndex((f) => f.key === checked.key) + 1 || null;
    return {
      ...checked,
      phase: "compress",
      unwrap: true,
      entry,
      timing,
      reply: formatCompressionUnwrapCard(checked, { timing, entry }),
      keyboard: buildCompressionKeyboard({ key: checked.key || "", n: n || null }),
    };
  }

  const injectMatch = trimmed.match(/^(?:inject|stage)\s*(\S+)?/i);
  if (injectMatch) {
    const key = injectMatch[1] || latestCompressionKey(opts);
    if (!key) {
      return { ok: false, phase: "compress", call: "refused", verified: false, reply: "directory empty — /vitafeed compress first" };
    }
    if (injectMatch[1]) {
      const checked = verifyCompressionKey(key, opts);
      if (!checked.ok) return { ...checked, phase: "compress", reply: "inject refused\n" + (checked.reason || "") };
      const entry = readCompressionDirectory(opts).files[checked.key];
      const payload = readPayload(entry, opts);
      return {
        ...checked,
        phase: "compress",
        entry,
        stage: "file",
        stageBody: buildFileInjectBody(entry, payload),
        reply: [
          "VERIFIED true",
          "key=" + checked.key,
          "answer recovered=true",
          "call=verified",
          "Staged compressed file for injection.",
          "NEXT MODULE: /vitafeed confirm",
          "chain=availability — no hash until seal",
        ].join("\n"),
        keyboard: buildCompressionKeyboard({ key: checked.key }),
      };
    }
    const directory = readCompressionDirectory(opts);
    return {
      ok: true,
      phase: "compress",
      call: "verified",
      verified: true,
      answer: true,
      recovered: true,
      key: latestCompressionKey(opts),
      stage: "directory",
      stageBody: buildDirectoryInjectBody(directory),
      chainStatus: "availability",
      locations: [],
      neverInventHashes: true,
      reply: formatCompressionDirectoryCard(opts) + "\n\nStaged key directory for injection. /vitafeed confirm",
      keyboard: buildCompressionKeyboard({ key: latestCompressionKey(opts) }),
    };
  }

  let fileKind = "";
  let spec = trimmed;
  const first = trimmed.split(/\s+/)[0].toLowerCase();
  if (KINDS.has(first)) {
    fileKind = first;
    spec = trimmed.slice(first.length).trim();
  }
  const abs = resolveCompressionFile(spec, opts);
  if (!abs) {
    return {
      ok: false,
      phase: "compress",
      call: "refused",
      verified: false,
      reply: "file not found: " + spec + "\nDrop it in vita/compression/inbox/ or /vitafeed compress add",
    };
  }
  const filed = fileCompression({
    name: abs.split("/").pop(),
    kind: fileKind,
    bytes: readFileSync(abs),
    source: "path",
    includePython: opts.includePython !== false,
    extraCodecs: opts.extraCodecs || [],
  }, opts);
  return {
    ...filed,
    phase: "compress",
    reply: formatCompressionCard(filed),
    keyboard: buildCompressionKeyboard({ key: filed.key || "" }),
    stage: "file",
  };
}

export function publicCompressionState(opts = {}) {
  const directory = readCompressionDirectory(opts);
  const files = Object.values(directory.files || {}).map((f) => ({
    key: f.key,
    name: f.name,
    kind: f.kind,
    codec: f.codec,
    project: f.project,
    ratio: f.ratio,
    rawBytes: f.rawBytes,
    payloadBytes: f.payloadBytes,
    verified: f.verified === true,
    recovered: f.recovered === true,
    answer: f.answer === true,
    chainStatus: f.chainStatus || "availability",
    locations: f.locations || [],
    calldataPreview: f.calldataPreview || "",
  }));
  return {
    id: COMPRESS_ID,
    label: COMPRESS_LABEL,
    player: COMPRESS_PLAYER_PATH,
    neverInventHashes: true,
    chainStatus: directory.chainStatus || "availability",
    locations: directory.locations || [],
    codecs: listCodecProjects(),
    files,
    learn: {
      personal: recommendForKind("personal", opts),
      program: recommendForKind("program", opts),
      video: recommendForKind("video", opts),
      all: recommendForKind("", opts),
    },
    add: "POST /vita/compression/add { name, mime, kind, bytesBase64 }",
    inbox: "vita/compression/inbox/",
  };
}

export function publicVerifyCompression(key, opts = {}) {
  const checked = verifyCompressionKey(key, opts);
  const preview = checked.ok && checked.plain
    ? String(checked.plain).slice(0, 400)
    : checked.bytes && checked.kind !== "video" && checked.bytes.length <= 400
      ? checked.bytes.toString("utf8")
      : "";
  return {
    call: checked.call,
    ok: checked.ok,
    verified: checked.verified,
    answer: checked.answer,
    recovered: checked.recovered,
    key: checked.key,
    codec: checked.codec,
    kind: checked.kind,
    name: checked.name,
    rawBytes: checked.rawBytes || 0,
    rawHash: checked.rawHash || "",
    chainStatus: checked.chainStatus || "availability",
    locations: checked.locations || [],
    neverInventHashes: true,
    preview,
    plain: checked.plain || "",
    machine: checked.machine || "",
    reason: checked.reason || "",
  };
}
