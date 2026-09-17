/**
 * WAVE memory wrap — blockchain as a memory mirror (thin helper).
 *
 * Hex-only token/wave/filing shards:
 *   [W:v1:SYM]|<vinId>|<ii>/<nn>|prev=<8hex>|next=<ii|END>|<KEY8>|<LOC8>]<utf8 body>
 *
 * VIN/tailwind prev/next like /vitafeed. KEY8 = sha256(full message)[:8].
 * LOC8 = sha256(shard body)[:8]. Body budget 8–128 B (least-size default 8).
 *
 * Does NOT rewrite vitaSave / inscribeChunk / memory-engine / mainframe /
 * mother-genesis core. Does NOT re-enable VITAFEED_PAID. Live one-shot send
 * only when WAVE_MIRROR_PAID=yes (default OFF). Tests hitch on leftover or
 * simulate inject; record a txHash only when sendTx returns one.
 */

import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const WAVE_WRAP_ID = "wave-wrap-v1";
export const WAVE_HEADER = "[W:v1:";
export const WAVE_VERSION = "v1";
export const WAVE_MIN_BODY_BYTES = 8;
export const WAVE_MAX_BODY_BYTES = 128;
export const WAVE_DEFAULT_BODY_BYTES = WAVE_MIN_BODY_BYTES;
export const WAVE_MIRROR_PAID_ENV = "WAVE_MIRROR_PAID";
export const WAVE_READER_PREFIX = "WAVE.";
export const WAVE_EXACT_INPUT_BYTES = 228;
export const WAVE_ROUND_SYMS = Object.freeze(["PING", "PONG", "ACK"]);
export const WAVE_MIN_ROUNDS = 3;

/** Ancient wisdom / gift of recursive memory — exact UTF-8 body for the mirror test. */
export const WAVE_WISE_MESSAGE =
  "Heraclitus: No one steps in the same river twice, for it is not the same river and they are not the same person. We gift recursive memory: what is written in the stream can be read again, refined, and never forgotten.";

export const WAVE_WISE_SYM = "WISE";
export const WAVE_WISE_KEY_ID = "wave-heraclitus-v1";

const HERE = dirname(fileURLToPath(import.meta.url));
export const WAVE_ANSWER_KEY_PATH = join(HERE, "memory", "wave-heraclitus-key.json");

const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const WAVE_LINE_RE =
  /^\[W:v1:([A-Z0-9_]{1,12})\|([^|]+)\|(\d+)\/(\d+)\|prev=([0-9a-fA-F]+)\|next=(\d+|END)\|([0-9a-fA-F]{8})\|([0-9a-fA-F]{8})\]([\s\S]*)$/;

function envFlagOnExplicit(raw) {
  const v = String(raw ?? "").trim().toLowerCase();
  return v === "yes" || v === "true" || v === "1";
}

/** WAVE_MIRROR_PAID must be yes|true|1. Default OFF. Does not touch VITAFEED_PAID. */
export function waveMirrorPaidEnabled(env = process.env) {
  return envFlagOnExplicit(env?.[WAVE_MIRROR_PAID_ENV] ?? "");
}

export function utf8ByteLength(text) {
  return Buffer.byteLength(String(text ?? ""), "utf8");
}

export function utf8ToHex(text) {
  return "0x" + Buffer.from(String(text ?? ""), "utf8").toString("hex");
}

export function hexToUtf8(hex) {
  const h = String(hex || "").replace(/^0x/i, "");
  if (!h || h.length % 2) return "";
  try {
    return Buffer.from(h, "hex").toString("utf8");
  } catch {
    return "";
  }
}

export function sha256Hex(text, encoding = "utf8") {
  if (Buffer.isBuffer(text) || text instanceof Uint8Array) {
    return createHash("sha256").update(text).digest("hex");
  }
  return createHash("sha256").update(String(text ?? ""), encoding).digest("hex");
}

export function sha256HexUtf8(text) {
  return sha256Hex(String(text ?? ""), "utf8");
}

export function shortHex(hex, n = 8) {
  return String(hex || "").replace(/^0x/i, "").toLowerCase().slice(0, n);
}

export function clampWaveBodyBudget(n) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0) return WAVE_DEFAULT_BODY_BYTES;
  return Math.min(WAVE_MAX_BODY_BYTES, Math.max(WAVE_MIN_BODY_BYTES, v));
}

/**
 * Least-size body budget in [8, 128]. Default 8 so a wise message yields
 * N small shards (enough for ≥3 ping/pong ACK rounds).
 */
export function leastSizeBodyBudget(text, { minBytes = WAVE_MIN_BODY_BYTES, maxBytes = WAVE_MAX_BODY_BYTES } = {}) {
  const lo = clampWaveBodyBudget(minBytes);
  const hi = clampWaveBodyBudget(maxBytes);
  const cap = Math.min(lo, hi);
  void utf8ByteLength(text);
  return cap;
}

/**
 * Split on UTF-8 byte budget without tearing a code point.
 * @returns {string[]}
 */
export function splitUtf8ByBytes(text, maxBytes = WAVE_DEFAULT_BODY_BYTES) {
  const raw = String(text ?? "");
  const cap = clampWaveBodyBudget(maxBytes);
  const buf = Buffer.from(raw, "utf8");
  if (!buf.length) return [];
  const chunks = [];
  let i = 0;
  while (i < buf.length) {
    let end = Math.min(i + cap, buf.length);
    if (end < buf.length) {
      while (end > i && (buf[end] & 0xc0) === 0x80) end--;
    }
    if (end === i) {
      end = Math.min(i + 4, buf.length);
      while (end < buf.length && (buf[end] & 0xc0) === 0x80) end++;
    }
    chunks.push(buf.subarray(i, end).toString("utf8"));
    i = end;
  }
  return chunks;
}

export function planWaveShards(body, { maxBytes, minBytes } = {}) {
  const text = String(body ?? "");
  const size = leastSizeBodyBudget(text, {
    minBytes: maxBytes != null ? maxBytes : minBytes,
    maxBytes: maxBytes != null ? maxBytes : WAVE_MAX_BODY_BYTES,
  });
  if (!text.length) {
    return {
      ok: false,
      reason: "empty body — nothing to shard",
      chunks: [],
      totalChunks: 0,
      maxBytes: size,
    };
  }
  const chunks = splitUtf8ByBytes(text, size);
  return {
    ok: true,
    totalChars: text.length,
    totalBytes: utf8ByteLength(text),
    totalBits: utf8ByteLength(text) * 8,
    maxBytes: size,
    minBytes: WAVE_MIN_BODY_BYTES,
    maxPayloadConstant: "WAVE_MIN_BODY_BYTES..WAVE_MAX_BODY_BYTES",
    rule: "least-size",
    totalChunks: chunks.length,
    injections: chunks.length,
    chunks,
  };
}

export function mintWaveVin() {
  const nonce = randomBytes(8).toString("hex");
  const vinId = "VIN-" + nonce.slice(0, 10).toUpperCase();
  return { vinId, nonce };
}

function padIndex(i, total) {
  const width = Math.max(2, String(total).length);
  return String(i).padStart(width, "0") + "/" + String(total).padStart(width, "0");
}

export function formatWaveReaderKey(vinId) {
  return WAVE_READER_PREFIX + String(vinId || "").toUpperCase();
}

export function sanitizeWaveSym(sym, fallback = "WAVE") {
  const s = String(sym || fallback).trim().toUpperCase().replace(/[^A-Z0-9_]/g, "");
  return s.slice(0, 12) || fallback;
}

/**
 * VIN/tailwind header + KEY8/LOC8 answer-key fingerprints.
 */
export function buildWaveHeader({ symbol, vinId, index, total, prevHash, nextIndex, key8, loc8 }) {
  const next = nextIndex == null || nextIndex === 0 ? "END" : String(nextIndex);
  return (
    WAVE_HEADER +
    sanitizeWaveSym(symbol) +
    "|" +
    vinId +
    "|" +
    padIndex(index, total) +
    "|prev=" +
    shortHex(prevHash) +
    "|next=" +
    next +
    "|" +
    shortHex(key8) +
    "|" +
    shortHex(loc8) +
    "]"
  );
}

export function buildWaveLine(opts) {
  return buildWaveHeader(opts) + String(opts.body ?? "");
}

export function parseWaveLine(utf8) {
  const s = String(utf8 || "");
  const m = s.match(WAVE_LINE_RE);
  if (!m) return null;
  return {
    kind: "wave",
    version: WAVE_VERSION,
    symbol: m[1],
    vinId: m[2],
    index: Number(m[3]),
    total: Number(m[4]),
    prevHash: m[5].toLowerCase(),
    nextIndex: m[6] === "END" ? null : Number(m[6]),
    nextPtr: m[6],
    key8: m[7].toLowerCase(),
    loc8: m[8].toLowerCase(),
    body: m[9],
    header: s.slice(0, s.length - m[9].length),
  };
}

/**
 * Recover a WAVE line from self-tx hex or a Uniswap V3 leftover trailer.
 * Does not import the chain reader / mother brain.
 */
export function utf8FromWaveCalldata(hex) {
  const raw = String(hex || "").trim();
  if (!raw) return "";
  if (!/^0x[0-9a-fA-F]+$/i.test(raw)) {
    const idx = raw.indexOf(WAVE_HEADER);
    return idx >= 0 ? raw.slice(idx) : raw;
  }
  const h = raw.replace(/^0x/i, "");
  const tryDecode = (slice) => {
    if (!slice || slice.length % 2) return "";
    try {
      return Buffer.from(slice, "hex").toString("utf8");
    } catch {
      return "";
    }
  };
  const full = tryDecode(h);
  const fullIdx = full.indexOf(WAVE_HEADER);
  if (fullIdx >= 0) return full.slice(fullIdx);
  if (h.length > WAVE_EXACT_INPUT_BYTES * 2) {
    const trail = tryDecode(h.slice(WAVE_EXACT_INPUT_BYTES * 2));
    const tIdx = trail.indexOf(WAVE_HEADER);
    if (tIdx >= 0) return trail.slice(tIdx);
  }
  return full;
}

export function parseWaveCalldata(hex) {
  return parseWaveLine(utf8FromWaveCalldata(hex));
}

export function reconstructWaveBody(lines) {
  const pieces = [];
  for (const row of lines || []) {
    const utf8 = typeof row === "string"
      ? row
      : row?.line || row?.fullLine || row?.utf8 || "";
    const parsed = typeof row === "object" && row?.body != null && row?.index
      ? row
      : parseWaveLine(utf8);
    if (!parsed || parsed.body == null) {
      return { ok: false, reason: "line is not WAVE v1 format", body: "" };
    }
    pieces.push({ index: parsed.index, body: parsed.body, parsed });
  }
  pieces.sort((a, b) => a.index - b.index);
  const body = pieces.map((p) => p.body).join("");
  return { ok: true, body, pieces };
}

export function prepareWaveWrap(body, opts = {}) {
  const text = String(body ?? "");
  const planned = planWaveShards(text, opts);
  if (!planned.ok) return planned;
  const { vinId, nonce } = opts.vinId
    ? { vinId: opts.vinId, nonce: opts.nonce || "" }
    : mintWaveVin();
  const contentCommit = sha256HexUtf8(text);
  const key8 = shortHex(contentCommit);
  const defaultSym = sanitizeWaveSym(opts.symbol || "WAVE");
  const roundSyms = Array.isArray(opts.roundSyms) ? opts.roundSyms : null;
  const lines = [];
  let prev = "00000000";
  for (let i = 0; i < planned.chunks.length; i++) {
    const index = i + 1;
    const nextIndex = index < planned.totalChunks ? index + 1 : null;
    const shardBody = planned.chunks[i];
    const loc8 = shortHex(sha256HexUtf8(shardBody));
    const symbol = roundSyms && roundSyms[i]
      ? sanitizeWaveSym(roundSyms[i], defaultSym)
      : defaultSym;
    const line = buildWaveLine({
      symbol,
      vinId,
      index,
      total: planned.totalChunks,
      prevHash: prev,
      nextIndex,
      key8,
      loc8,
      body: shardBody,
    });
    const hash = shortHex(sha256HexUtf8(line));
    const hex = utf8ToHex(line);
    lines.push({
      index,
      total: planned.totalChunks,
      vinId,
      symbol,
      prevHash: prev,
      nextIndex,
      nextPtr: nextIndex == null ? "END" : String(nextIndex),
      key8,
      loc8,
      body: shardBody,
      bodyBytes: utf8ByteLength(shardBody),
      line,
      hex,
      hash,
      calldataBytes: utf8ByteLength(line),
    });
    prev = hash;
  }
  return {
    ok: true,
    id: WAVE_WRAP_ID,
    vinId,
    nonce,
    symbol: defaultSym,
    contentCommit,
    key8,
    readerKey: formatWaveReaderKey(vinId),
    maxBytes: planned.maxBytes,
    rule: planned.rule,
    totalChars: planned.totalChars,
    totalBytes: planned.totalBytes,
    totalBits: planned.totalBits,
    totalChunks: planned.totalChunks,
    injections: planned.injections,
    lines,
    note: "WAVE hex shards — VIN/tailwind prev/next; KEY8=sha256(full)[:8]; LOC8=sha256(body)[:8]; never invent tx hashes",
  };
}

export function buildWaveAnswerKey(body, opts = {}) {
  const text = String(body ?? "");
  const prepared = opts.prepared?.ok ? opts.prepared : prepareWaveWrap(text, opts);
  if (!prepared?.ok) {
    return { ok: false, reason: prepared?.reason || "cannot build answer key" };
  }
  const shards = prepared.lines.map((line) => ({
    index: line.index,
    total: line.total,
    bodyBytes: line.bodyBytes,
    sha256: sha256HexUtf8(line.body),
    loc8: line.loc8,
  }));
  return {
    ok: true,
    id: opts.id || WAVE_WISE_KEY_ID,
    kind: "answer-key",
    neverInventHashes: true,
    symbol: prepared.symbol,
    messageUtf8: text,
    messageBytes: prepared.totalBytes,
    messageBits: prepared.totalBits,
    sha256: prepared.contentCommit,
    key8: prepared.key8,
    bodyBudget: {
      min: WAVE_MIN_BODY_BYTES,
      max: WAVE_MAX_BODY_BYTES,
      used: prepared.maxBytes,
      rule: "least-size",
    },
    totalShards: prepared.totalChunks,
    shards,
    note: "Pass reconstruct-from-chain-only iff sha256(joined bodies) matches and each shard digest matches. VIN headers are not part of the answer. Never invent tx hashes.",
  };
}

export function loadWaveAnswerKey(path = WAVE_ANSWER_KEY_PATH) {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const recomputed = sha256HexUtf8(raw.messageUtf8 || "");
  if (raw.sha256 && raw.sha256 !== recomputed) {
    return {
      ok: false,
      reason: "answer-key sha256 does not match messageUtf8 — refuse invented/stale hash",
      sha256: recomputed,
      stored: raw.sha256,
    };
  }
  const shards = Array.isArray(raw.shards) ? raw.shards : [];
  for (const shard of shards) {
    if (!shard?.sha256 || !/^[0-9a-f]{64}$/.test(String(shard.sha256))) {
      return { ok: false, reason: "answer-key shard digest missing or not sha256 hex", shard };
    }
  }
  return { ok: true, ...raw, sha256: recomputed };
}

export function compareToAnswerKey(reconstructedBody, answerKey) {
  const body = String(reconstructedBody ?? "");
  const got = sha256HexUtf8(body);
  const want = String(answerKey?.sha256 || "");
  const messageMatch = want.length === 64 && got === want;
  const shardResults = [];
  const planned = splitUtf8ByBytes(body, answerKey?.bodyBudget?.used || WAVE_DEFAULT_BODY_BYTES);
  const expectShards = Array.isArray(answerKey?.shards) ? answerKey.shards : [];
  let shardsMatch = expectShards.length > 0 && planned.length === expectShards.length;
  for (let i = 0; i < expectShards.length; i++) {
    const piece = planned[i] || "";
    const digest = sha256HexUtf8(piece);
    const ok = digest === expectShards[i].sha256;
    if (!ok) shardsMatch = false;
    shardResults.push({
      index: expectShards[i].index || i + 1,
      ok,
      sha256: digest,
      expected: expectShards[i].sha256,
    });
  }
  return {
    ok: messageMatch && shardsMatch,
    messageMatch,
    shardsMatch,
    sha256: got,
    expected: want,
    shardResults,
    body,
  };
}

function leftoverCovers(input = {}) {
  if (input.keyLocCovered === true) return true;
  const leftover = Number(input.leftoverEth);
  const hitch = Number(input.hitchCostEth);
  return leftover > 0 && hitch > 0 && leftover + 1e-18 >= hitch;
}

function isPairedRide(input = {}) {
  return input.pairedUniswapSell === true
    || input.sameTxTradeLeftover === true
    || input.pairedDataTx === true;
}

/**
 * Thin leftover attach. Hitch WAVE hex when leftover covers on a paired sell.
 * Gated one-shot send only if WAVE_MIRROR_PAID=yes. Never broadcasts here.
 * Never invents tx hashes. Does not replace KEY+LOC leftover hitch.
 */
export function attachWaveOnCoveredLeftover(input = {}) {
  const text = String(input.line || input.utf8 || input.text || "");
  const hex = input.data && /^0x[0-9a-fA-F]+$/.test(String(input.data))
    ? String(input.data)
    : utf8ToHex(text);
  const env = input.env || process.env;
  if (leftoverCovers(input) && isPairedRide(input)) {
    return {
      hitch: true,
      send: false,
      banked: false,
      hex,
      utf8: text,
      txHash: null,
      reason: "hitch WAVE shard on covered leftover / paired data tx — do not solo-send",
    };
  }
  if (waveMirrorPaidEnabled(env) && input.oneShot === true) {
    return {
      hitch: false,
      send: true,
      banked: false,
      hex,
      utf8: text,
      txHash: null,
      reason: "gated one-shot WAVE_MIRROR_PAID — caller may sendTx; VITAFEED_PAID untouched",
    };
  }
  return {
    hitch: false,
    send: false,
    banked: true,
    hex,
    utf8: text,
    txHash: null,
    reason: "bank WAVE hex — leftover uncovered; WAVE_MIRROR_PAID default off; VITAFEED_PAID untouched",
  };
}

/**
 * Next Heraclitus WAVE shard for the sell leftover hitch loop.
 * Cursor stays put until commitWaveHitchShard after the trailer actually lands.
 * Does not replace KEY+LOC. Never solo-sends.
 */
let _waveHitchPlan = null;
let _waveHitchIndex = 0;

export function resetWaveHitchCursor() {
  _waveHitchPlan = null;
  _waveHitchIndex = 0;
}

export function ensureWaveHitchPlan(opts = {}) {
  if (_waveHitchPlan?.ok && !opts.force) return _waveHitchPlan;
  _waveHitchPlan = prepareWaveWrap(opts.body || WAVE_WISE_MESSAGE, {
    symbol: opts.symbol || WAVE_WISE_SYM,
    vinId: opts.vinId,
    maxBytes: opts.maxBytes,
  });
  _waveHitchIndex = 0;
  return _waveHitchPlan;
}

export function peekNextWaveHitchShard(opts = {}) {
  const plan = ensureWaveHitchPlan(opts);
  if (!plan?.ok) return null;
  if (_waveHitchIndex >= plan.lines.length) return null;
  return plan.lines[_waveHitchIndex];
}

export function waveHitchCursorIndex() {
  return _waveHitchIndex;
}

/**
 * Sell leftover hitch wrap: invoke attachWaveOnCoveredLeftover for the next
 * Heraclitus shard. Hitch when leftover covers on a paired sell; bank when
 * uncovered. WAVE_MIRROR_PAID stays default off — this path never one-shots.
 */
export function hitchWaveOnSellLeftover(input = {}) {
  const attach = typeof input.attach === "function" ? input.attach : attachWaveOnCoveredLeftover;
  const shard = input.shard !== undefined ? input.shard : peekNextWaveHitchShard();
  if (!shard?.line) {
    const decision = attach({
      line: "",
      leftoverEth: 0,
      hitchCostEth: Number(input.hitchCostEth) > 0 ? input.hitchCostEth : 1,
      pairedUniswapSell: input.pairedUniswapSell !== false,
      env: input.env,
    });
    return {
      ...decision,
      hitch: false,
      send: false,
      banked: true,
      shard: null,
      utf8: "",
      txHash: null,
      reason: "no pending WAVE shard — bank; WAVE_MIRROR_PAID default off; VITAFEED_PAID untouched",
    };
  }
  const decision = attach({
    line: shard.line,
    leftoverEth: input.leftoverEth,
    hitchCostEth: input.hitchCostEth,
    pairedUniswapSell: input.pairedUniswapSell !== false,
    sameTxTradeLeftover: input.sameTxTradeLeftover,
    pairedDataTx: input.pairedDataTx,
    env: input.env,
  });
  return { ...decision, shard, utf8: shard.line };
}

export function commitWaveHitchShard(decision) {
  if (decision?.hitch && decision?.shard && decision.send !== true) {
    _waveHitchIndex += 1;
    return true;
  }
  return false;
}

export function wrapWaveSelfCall(input = {}) {
  return attachWaveOnCoveredLeftover({ ...input, topic: input.topic || "wave" });
}

/**
 * Simulated chain: sendTx records hex and returns a content-addressed hash.
 * Labeled sim — never claimed as a Base tx, never written to anchors.
 * Real Base hashes exist only when a live sendTx returns one.
 */
export function createWaveSimChain() {
  const store = new Map();
  async function sendTx(hex) {
    const h = String(hex || "");
    if (!/^0x[0-9a-fA-F]+$/.test(h) || h.length < 4) return null;
    const hash = "0x" + sha256Hex(h.toLowerCase(), "utf8");
    store.set(hash.toLowerCase(), h);
    return hash;
  }
  async function fetchCalldata(txHash) {
    const key = String(txHash || "").toLowerCase();
    if (!TX_HASH_RE.test(key)) throw new Error("need 0x + 64 hex");
    const hex = store.get(key);
    if (!hex) throw new Error("sim chain has no calldata for " + key.slice(0, 10));
    return hex;
  }
  return { sendTx, fetchCalldata, store, live: false, kind: "sim" };
}

/**
 * Send each WAVE line via sendTx(hex, line) → txHash | null.
 * Never invents hashes. Partial seals keep null locations.
 */
export async function runWaveInscribe(prepared, sendTx) {
  if (!prepared?.ok) return prepared;
  if (typeof sendTx !== "function") {
    return { ok: false, reason: "no sendTx — refuse invent", chunks: [], txHashes: [] };
  }
  const chunks = [];
  const txHashes = [];
  for (const line of prepared.lines) {
    const hex = line.hex || utf8ToHex(line.line);
    const txHash = await sendTx(hex, line);
    if (txHash && !TX_HASH_RE.test(String(txHash))) {
      return { ok: false, reason: "sender returned non-hash — refuse invent", chunks, txHashes };
    }
    const sealed = Boolean(txHash);
    if (txHash) txHashes.push(txHash);
    chunks.push({
      index: line.index,
      total: line.total,
      vinId: line.vinId,
      symbol: line.symbol,
      prevHash: line.prevHash,
      nextIndex: line.nextIndex,
      nextPtr: line.nextPtr,
      key8: line.key8,
      loc8: line.loc8,
      hash: line.hash,
      body: line.body,
      bodyBytes: line.bodyBytes,
      calldataBytes: line.calldataBytes,
      line: line.line,
      hex,
      txHash: txHash || null,
      sealed,
      location: txHash || null,
    });
  }
  return {
    ok: true,
    banked: txHashes.length < prepared.totalChunks,
    sealedCount: txHashes.length,
    needed: prepared.totalChunks,
    contentCommit: prepared.contentCommit,
    vinId: prepared.vinId,
    readerKey: prepared.readerKey,
    chunks,
    txHashes: txHashes.slice(),
    reason: txHashes.length === prepared.totalChunks
      ? "sealed — every injection returned a real hash"
      : txHashes.length
        ? "partial seal — remaining chunks not hashed (never invent)"
        : "no hashes yet — never invent txs",
  };
}

/**
 * Read path: given only txHashes, fetch/decode calldata (or fixture hex),
 * reconstruct UTF-8 bodies. Pass only if chain bytes match the answer key.
 */
export async function readWaveFromLocations(txHashes, fetchCalldata, { fixtures } = {}) {
  const lines = [];
  const hashes = Array.isArray(txHashes) ? txHashes : [];
  if (!hashes.length && Array.isArray(fixtures) && fixtures.length) {
    for (const row of fixtures) {
      const hex = typeof row === "string" ? row : row?.hex;
      const utf8 = utf8FromWaveCalldata(hex);
      const parsed = parseWaveLine(utf8);
      if (!parsed) {
        return { ok: false, reason: "fixture hex is not WAVE v1", lines, body: "" };
      }
      lines.push({ ...parsed, line: utf8, hex, txHash: row?.txHash || null });
    }
  } else {
    if (typeof fetchCalldata !== "function") {
      return { ok: false, reason: "no fetchCalldata — cannot read chain", lines, body: "" };
    }
    for (const txHash of hashes) {
      if (!TX_HASH_RE.test(String(txHash || ""))) {
        return { ok: false, reason: "need 0x + 64 hex — refuse invented location", lines, body: "" };
      }
      let hex;
      try {
        hex = await fetchCalldata(txHash);
      } catch (e) {
        return { ok: false, reason: e.message || "fetch failed", txHash, lines, body: "" };
      }
      const utf8 = utf8FromWaveCalldata(hex);
      const parsed = parseWaveLine(utf8);
      if (!parsed) {
        return { ok: false, reason: "calldata is not WAVE v1", txHash, lines, body: "" };
      }
      lines.push({ ...parsed, line: utf8, hex, txHash });
    }
  }
  const reconstructed = reconstructWaveBody(lines);
  return {
    ok: reconstructed.ok,
    reason: reconstructed.reason,
    body: reconstructed.body,
    lines,
    locations: hashes.slice(),
  };
}

function roundSym(i) {
  return WAVE_ROUND_SYMS[i % WAVE_ROUND_SYMS.length];
}

/**
 * Autonomous file+read rounds. ≥3 ping/pong shard ACKs, then full reconstruct
 * vs answer key. Pass only if chain/fixture bytes match.
 */
export async function runWaveMirrorTest({
  body = WAVE_WISE_MESSAGE,
  maxBytes = WAVE_DEFAULT_BODY_BYTES,
  sendTx = null,
  fetchCalldata = null,
  answerKey = null,
  rounds = WAVE_MIN_ROUNDS,
  live = false,
  env = process.env,
} = {}) {
  const text = String(body ?? "");
  const roundCount = Math.max(WAVE_MIN_ROUNDS, Math.floor(Number(rounds) || WAVE_MIN_ROUNDS));
  const prepared = prepareWaveWrap(text, {
    maxBytes,
    symbol: WAVE_WISE_SYM,
    roundSyms: WAVE_ROUND_SYMS,
  });
  if (!prepared.ok) return { ok: false, pass: false, reason: prepared.reason };

  let chain = null;
  let sender = sendTx;
  let reader = fetchCalldata;
  if (typeof sender !== "function") {
    if (live) {
      if (!waveMirrorPaidEnabled(env)) {
        return {
          ok: false,
          pass: false,
          live: false,
          reason: "WAVE_MIRROR_PAID default off — simulate only; VITAFEED_PAID untouched",
        };
      }
      return {
        ok: false,
        pass: false,
        live: false,
        reason: "no sendTx — refuse invent live hashes",
      };
    }
    chain = createWaveSimChain();
    sender = chain.sendTx;
    reader = chain.fetchCalldata;
  }
  if (typeof reader !== "function" && chain) reader = chain.fetchCalldata;

  const inscribed = await runWaveInscribe(prepared, sender);
  if (!inscribed.ok) return { ok: false, pass: false, ...inscribed };

  const key = answerKey?.ok ? answerKey : buildWaveAnswerKey(text, { prepared, id: WAVE_WISE_KEY_ID });
  const acks = [];
  const nRounds = Math.min(Math.max(roundCount, WAVE_MIN_ROUNDS), prepared.totalChunks);
  for (let i = 0; i < nRounds; i++) {
    const chunk = inscribed.chunks[i];
    const role = roundSym(i);
    if (!chunk?.txHash) {
      acks.push({
        round: i + 1,
        role,
        ack: false,
        reason: "no txHash — never invent; sendTx returned null",
        index: chunk?.index,
      });
      continue;
    }
    const read = await readWaveFromLocations([chunk.txHash], reader);
    const expectDigest = key.shards[i]?.sha256;
    const gotDigest = sha256HexUtf8(read.body || "");
    const ack = read.ok && expectDigest && gotDigest === expectDigest;
    acks.push({
      round: i + 1,
      role,
      ack,
      index: chunk.index,
      txHash: chunk.txHash,
      sha256: gotDigest,
      expected: expectDigest,
      symbol: read.lines?.[0]?.symbol || chunk.symbol,
    });
  }

  const sealedHashes = inscribed.txHashes;
  const fullRead = sealedHashes.length === prepared.totalChunks
    ? await readWaveFromLocations(sealedHashes, reader)
    : { ok: false, reason: "incomplete seal — cannot reconstruct from chain only", body: "" };
  const compared = fullRead.ok
    ? compareToAnswerKey(fullRead.body, key)
    : { ok: false, messageMatch: false, shardsMatch: false, sha256: "", expected: key.sha256, body: fullRead.body || "" };

  const acksOk = acks.length >= WAVE_MIN_ROUNDS && acks.every((a) => a.ack === true);
  const pass = acksOk && compared.ok === true;

  return {
    ok: true,
    pass,
    live: live === true && chain == null,
    sim: chain != null,
    vinId: prepared.vinId,
    readerKey: prepared.readerKey,
    totalChunks: prepared.totalChunks,
    maxBytes: prepared.maxBytes,
    contentCommit: prepared.contentCommit,
    answerKey: {
      id: key.id,
      sha256: key.sha256,
      key8: key.key8,
      totalShards: key.totalShards,
    },
    inscribed,
    acks,
    rounds: acks.length,
    reconstructed: fullRead.body || "",
    compared,
    reason: pass
      ? "WAVE mirror pass — chain/fixture bytes match answer key after ≥3 ping/pong ACKs"
      : acksOk
        ? "ACK rounds ok but full reconstruct does not match answer key"
        : "ping/pong ACK failed — shard bytes did not match answer-key digest",
  };
}

export function formatWaveMirrorCard(result) {
  const lines = [
    "WAVE MIRROR · " + WAVE_WRAP_ID,
    "message sha256=" + (result.answerKey?.sha256 || ""),
    "shards=" + (result.totalChunks || 0) +
      " · budget=" + (result.maxBytes || WAVE_DEFAULT_BODY_BYTES) + "B least-size",
    "reader " + (result.readerKey || ""),
    "rounds=" + (result.rounds || 0) + (result.sim ? " · SIM chain (not Base)" : result.live ? " · LIVE" : ""),
  ];
  for (const ack of result.acks || []) {
    lines.push(
      "  " + ack.role + " " + ack.round + "/" + (result.rounds || "?") +
        " shard " + ack.index +
        (ack.ack ? " ACK" : " NAK") +
        (ack.txHash ? " loc=" + ack.txHash.slice(0, 10) + "…" : " loc=null"),
    );
  }
  lines.push(result.pass ? "PASS — reconstruct-from-chain-only matches answer key" : "FAIL — " + (result.reason || "mismatch"));
  lines.push("VITAFEED_PAID default off. WAVE_MIRROR_PAID default off. Mother brain untouched.");
  lines.push("Hitch WAVE on covered leftover via attachWaveOnCoveredLeftover; do not solo-send.");
  return lines.join("\n");
}

export function parseWaveTestCommand(raw = "") {
  const s = String(raw || "").trim();
  if (!/^\/wavetest(?:@\w+)?(?:\s|$)/i.test(s) && !/^\/wavetest$/i.test(s)) {
    return { ok: false, action: null };
  }
  const after = s.replace(/^\/wavetest(?:@\w+)?/i, "").trim();
  if (!after || /^help$/i.test(after)) return { ok: true, action: "run" };
  if (/^(run|mirror|test)$/i.test(after)) return { ok: true, action: "run" };
  if (/^hitch$/i.test(after)) return { ok: true, action: "hitch" };
  return { ok: true, action: "run" };
}

export function waveTestUsageText() {
  return [
    "usage: /wavetest",
    "Autonomous WAVE memory-mirror: shard the Heraclitus gift → file hex → read-back vs answer key.",
    "SIM by default (content-addressed locations). Live one-shot needs WAVE_MIRROR_PAID=yes.",
    "Does NOT enable VITAFEED_PAID. Mother brain (/vitasave) untouched.",
    "Covered leftover: attachWaveOnCoveredLeftover hitch — never solo-send.",
    "CLI: node scripts/wave-mirror-test.js",
  ].join("\n");
}

export async function handleWaveTestAction({
  action = "run",
  env = process.env,
  sendTx = null,
  fetchCalldata = null,
  live = false,
} = {}) {
  if (action === "hitch") {
    const prepared = prepareWaveWrap(WAVE_WISE_MESSAGE, { symbol: WAVE_WISE_SYM });
    const demo = attachWaveOnCoveredLeftover({
      line: prepared.lines[0]?.line,
      leftoverEth: 0,
      hitchCostEth: 0.0001,
      pairedUniswapSell: false,
      env,
    });
    return {
      ok: true,
      send: false,
      reply: [
        "WAVE leftover hitch (thin wrap — KEY+LOC leftover hitch stays).",
        "Covered paired leftover → hitch WAVE trailer (send=false).",
        "Uncovered → bank hex. WAVE_MIRROR_PAID default off (one-shot gated).",
        "VITAFEED_PAID untouched / still default off.",
        demo.reason,
      ].join("\n"),
    };
  }
  if (action !== "run") {
    return { ok: true, send: false, reply: waveTestUsageText() };
  }
  const result = await runWaveMirrorTest({
    body: WAVE_WISE_MESSAGE,
    env,
    sendTx,
    fetchCalldata,
    live: live === true && waveMirrorPaidEnabled(env),
  });
  return {
    ok: result.ok,
    pass: result.pass === true,
    send: false,
    result,
    reply: formatWaveMirrorCard(result),
  };
}
