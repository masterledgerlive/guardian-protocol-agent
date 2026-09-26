/**
 * /vitafeed — Storage Token game (plain paid inject from RISK).
 *
 * Thin helper only. Does NOT rewrite vitaSave / inscribeChunk / memory-engine
 * / mainframe / mother-genesis core. Telegram handler may CALL existing
 * sendTransaction after an explicit confirm **and** VITAFEED_PAID=yes.
 *
 * Exact UTF-8 body (no summarization, no §SESS§ unless the operator typed it).
 * VIN/tailwind headers sit outside the payload budget so AI readers can follow
 * prev-hash → next-index like a VIN. Cost card first, then `/vitafeed confirm`.
 *
 * Emergency thrift (n5624→6007 +383 self-call class): paid confirm/override
 * default OFF. /vitafeed override cannot bypass VITAFEED_PAID=no unless
 * VITAFEED_FORCE=yes **or** `/vitafeed override force` (command latch — then
 * also skips rate limit; liquid floor already bypassed). Override alone DOES
 * bypass liquid floor + RISK balance REFUSE (money stall) but not thrift.
 * Media/players on disk are availability (LOCAL_OK) until confirm|override
 * seals real Base Input Data — never invent hashes. `/vitafeed check` audits.
 * Inscribe sends what it can before an error, then restages the remainder.
 */

import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { formatVitaFeedBuyInCard, planVitaFeedBuyIns } from "./vita-feed-buyin.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const MEMORY_DIR = join(HERE, "memory");

const VITAFILE_MAGIC = "§VITAFILE§";

/** Sync peek at §VITAFILE§ header for cost cards (no circular import). */
function peekVitaFileMeta(body) {
  const s = String(body ?? "");
  if (!s.startsWith(VITAFILE_MAGIC)) return null;
  const end = s.indexOf("§", VITAFILE_MAGIC.length);
  if (end < 0) return { error: "missing VITAFILE header closer", isVitaFile: true };
  const head = s.slice(VITAFILE_MAGIC.length, end);
  const parts = head.split("|");
  const meta = { version: parts[0] || "" };
  for (let i = 1; i < parts.length; i++) {
    const eq = parts[i].indexOf("=");
    if (eq < 0) continue;
    meta[parts[i].slice(0, eq)] = parts[i].slice(eq + 1);
  }
  return {
    name: meta.name || "blob.bin",
    mime: meta.mime || "application/octet-stream",
    playKind: String(meta.mime || "").startsWith("audio/")
      ? "audio"
      : String(meta.mime || "").startsWith("video/")
        ? "video"
        : String(meta.mime || "").startsWith("image/")
          ? "image"
          : "file",
    rawBytes: Number(meta.bytes) || 0,
    sha256: meta.sha256 || null,
  };
}

function summarizeFileLine(fileMeta) {
  if (!fileMeta || fileMeta.error) return "";
  return (
    "VITAFILE · " + (fileMeta.name || "?") +
    " · mime=" + (fileMeta.mime || "?") +
    " · raw=" + (fileMeta.rawBytes ?? 0) + "B" +
    " · play=" + (fileMeta.playKind || "file")
  );
}

/** EIP-2028 nonzero calldata gas — same class as lose-zero-gate (do not import that module). */
const CALLDATA_GAS_PER_NONZERO_BYTE = 16;
/** Documented 0-ETH self-tx gas class (BTP_INSCRIBE_GAS_UNITS). */
const BTP_INSCRIBE_GAS_UNITS = 50_000;

function estimateCalldataHitchEth(bytes, gwei) {
  const b = Math.max(0, Number(bytes) || 0);
  const g = Number(gwei);
  if (!Number.isFinite(g) || g < 0) return 0;
  return b * CALLDATA_GAS_PER_NONZERO_BYTE * g * 1e-9;
}

function estimateBtpInscribeEth(gwei, gasUnits = BTP_INSCRIBE_GAS_UNITS) {
  const g = Number(gwei);
  const u = Number(gasUnits);
  if (!Number.isFinite(g) || g < 0 || !Number.isFinite(u) || u <= 0) return 0;
  return u * g * 1e-9;
}

export const VITAFEED_ID = "vita-feed-v1";
export const VITAFEED_HEADER = "[VITAFEED:";
export const VITAFEED_READER_PREFIX = "VITAFEED.";

/**
 * Max verbatim UTF-8 payload bytes per injection (header sits outside).
 * Same class as MG_CHUNK_CHARS (720) — documented for the cost card.
 */
export const VITAFEED_MAX_CHUNK_BYTES = 720;

/**
 * Confirm is always required (cost preview then `/vitafeed confirm`).
 * Also the “N chars” burn warning used on the card when body exceeds this.
 */
export const VITAFEED_CONFIRM_CHARS = 1000;

export const VITAFEED_PAYER = "RISK";
export const VITAFEED_WALLET = "0x50e1C4608c48b0c52E1EA5FBabc1c9126eA17915";
export const VITAFEED_BASESCAN_TX = "https://basescan.org/tx/";
export const VITAFEED_TX_GAS_UNITS = BTP_INSCRIBE_GAS_UNITS;
export const VITAFEED_CALLDATA_GAS_PER_BYTE = CALLDATA_GAS_PER_NONZERO_BYTE;

/** Paid sendTransaction kill-switch — default OFF. Override cannot bypass unless VITAFEED_FORCE. */
export const VITAFEED_PAID_ENV = "VITAFEED_PAID";
export const VITAFEED_ENABLED_ENV = "VITAFEED_ENABLED";
export const VITAFEED_FORCE_ENV = "VITAFEED_FORCE";
export const VITAFEED_AUTOFIRE_ENV = "VITAFEED_AUTOFIRE";
export const VITAFEED_AUTOFIRE_BODY_ENV = "VITAFEED_AUTOFIRE_BODY";
export const VITAFEED_MIN_LIQUID_USD_ENV = "VITAFEED_MIN_LIQUID_USD";
export const VITAFEED_MIN_LIQUID_USD_DEFAULT = 5;
export const VITAFEED_CONFIRM_COOLDOWN_SEC_ENV = "VITAFEED_CONFIRM_COOLDOWN_SEC";
export const VITAFEED_CONFIRM_COOLDOWN_SEC_DEFAULT = 60;
export const VITAFEED_MAX_CHUNKS_PER_HOUR_ENV = "VITAFEED_MAX_CHUNKS_PER_HOUR";
export const VITAFEED_MAX_CHUNKS_PER_HOUR_DEFAULT = 24;
export const VITAFEED_RATE_LIMIT_ENV = "VITAFEED_RATE_LIMIT";
export const VITAFEED_MAX_CONFIRM_AGE_SEC_ENV = "VITAFEED_MAX_CONFIRM_AGE_SEC";
export const VITAFEED_MAX_CONFIRM_AGE_SEC_DEFAULT = 180;

/** Desk/boot chat id — plain body, no BL- backlog block id. */
export const VITAFEED_AUTOFIRE_CHAT_ID = "vitafeed-autofire";

let _vitaFeedAutofireSpent = false;

/** Documented Base DEMO quotes (Railway 2026-09-08 class — labeled, not live). */
export const VITAFEED_DEMO_QUOTES = Object.freeze({
  gwei: 0.05,
  ethUsd: 2481,
  l1FeeEth: 0,
  label: "DEMO",
  source: "documented Base estimates (LIVE_ASSUMPTIONS 2026-09-08 class)",
});

/** @type {Map<string, object>} */
const pending = new Map();

/** @type {{ chatId: string, atMs: number, chunks: number }[]} */
const paidSends = [];

function sha256Hex(text) {
  return createHash("sha256").update(String(text || ""), "utf8").digest("hex");
}

function shortHex(hex, n = 8) {
  return String(hex || "").replace(/^0x/i, "").toLowerCase().slice(0, n);
}

function padIndex(i, total) {
  const width = Math.max(2, String(total).length);
  return String(i).padStart(width, "0") + "/" + String(total).padStart(width, "0");
}

export function resetVitaFeedPaidLog() {
  paidSends.length = 0;
  return paidSends.length;
}

export function resetVitaFeedPending() {
  pending.clear();
  resetVitaFeedPaidLog();
  return pending.size;
}

export function utf8ByteLength(text) {
  return Buffer.byteLength(String(text ?? ""), "utf8");
}

export function utf8BitCount(text) {
  return utf8ByteLength(text) * 8;
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

/**
 * Map buy-in seats / token bags → restart-money exit list (≥ $0.50).
 * Accepts seats with {symbol,price,balance|tokens|usd|bagUsd}.
 */
export function seatsToBags(seats = []) {
  return (seats || []).map((s) => {
    const symbol = String(s?.symbol || s?.sym || "").toUpperCase();
    const price = Number(s?.price ?? s?.px ?? 0);
    const tokens = Number(s?.balance ?? s?.tokens ?? s?.qty ?? 0);
    let usd = Number(s?.usd ?? s?.bagUsd ?? s?.valueUsd);
    if (!Number.isFinite(usd) || usd <= 0) {
      usd = Number.isFinite(price) && Number.isFinite(tokens) ? price * tokens : 0;
    }
    return { symbol, usd, tokens, price };
  }).filter((b) => b.symbol);
}

export function measurePlainText(text) {
  const raw = String(text ?? "");
  const bytes = utf8ByteLength(raw);
  return {
    chars: raw.length,
    bytes,
    bits: bytes * 8,
    exact: true,
    encoding: "utf8",
  };
}

/**
 * Split on UTF-8 byte budget without tearing a code point.
 * @returns {string[]}
 */
export function splitUtf8ByBytes(text, maxBytes = VITAFEED_MAX_CHUNK_BYTES) {
  const raw = String(text ?? "");
  const cap = Math.max(1, Math.floor(Number(maxBytes) || VITAFEED_MAX_CHUNK_BYTES));
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

export function planVitaFeedChunks(body, { maxBytes = VITAFEED_MAX_CHUNK_BYTES } = {}) {
  const text = String(body ?? "");
  const size = Math.max(1, Math.floor(Number(maxBytes) || VITAFEED_MAX_CHUNK_BYTES));
  if (!text.length) {
    return {
      ok: false,
      reason: "empty body — paste text after /vitafeed or reply to a message",
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
    totalBits: utf8BitCount(text),
    maxBytes: size,
    maxPayloadConstant: "VITAFEED_MAX_CHUNK_BYTES",
    totalChunks: chunks.length,
    injections: chunks.length,
    chunks,
  };
}

export function mintVitaFeedVin() {
  const nonce = randomBytes(8).toString("hex");
  const vinId = "VIN-" + nonce.slice(0, 10).toUpperCase();
  return { vinId, nonce };
}

export function formatVitaFeedReaderKey(vinId) {
  return VITAFEED_READER_PREFIX + String(vinId || "").toUpperCase();
}

/**
 * VIN/tailwind header — strand id + prev hash + next index (END on last).
 */
export function buildVitaFeedHeader({ vinId, index, total, prevHash, nextIndex }) {
  const next = nextIndex == null || nextIndex === 0 ? "END" : String(nextIndex);
  return (
    VITAFEED_HEADER +
    vinId +
    ":" +
    padIndex(index, total) +
    ":prev=" +
    shortHex(prevHash) +
    ":next=" +
    next +
    "]"
  );
}

export function buildVitaFeedLine({ vinId, index, total, prevHash, nextIndex, body }) {
  return buildVitaFeedHeader({ vinId, index, total, prevHash, nextIndex }) + body;
}

export function parseVitaFeedLine(utf8) {
  const s = String(utf8 || "");
  const m = s.match(
    /^\[VITAFEED:([^:\]]+):(\d+)\/(\d+):prev=([0-9a-fA-F]+):next=(\d+|END)\]([\s\S]*)$/,
  );
  if (!m) return null;
  return {
    kind: "vitafeed",
    vinId: m[1],
    index: Number(m[2]),
    total: Number(m[3]),
    prevHash: m[4].toLowerCase(),
    nextIndex: m[5] === "END" ? null : Number(m[5]),
    nextPtr: m[5],
    body: m[6],
    header: s.slice(0, s.length - m[6].length),
  };
}

export function reconstructVitaFeedBody(lines) {
  const pieces = [];
  for (const row of lines || []) {
    const utf8 = typeof row === "string" ? row : row?.line || row?.fullLine || "";
    const parsed = parseVitaFeedLine(utf8);
    if (!parsed) return { ok: false, reason: "line is not VITAFEED VIN format", body: "" };
    pieces.push(parsed.body);
  }
  return { ok: true, body: pieces.join("") };
}

export function prepareVitaFeed(body, opts = {}) {
  const planned = planVitaFeedChunks(body, opts);
  if (!planned.ok) return planned;
  const { vinId, nonce } = opts.vinId
    ? { vinId: opts.vinId, nonce: opts.nonce || "" }
    : mintVitaFeedVin();
  const contentCommit = sha256Hex(String(body));
  const lines = [];
  let prev = "00000000";
  for (let i = 0; i < planned.chunks.length; i++) {
    const index = i + 1;
    const nextIndex = index < planned.totalChunks ? index + 1 : null;
    const line = buildVitaFeedLine({
      vinId,
      index,
      total: planned.totalChunks,
      prevHash: prev,
      nextIndex,
      body: planned.chunks[i],
    });
    const hash = shortHex(sha256Hex(line));
    const hex = utf8ToHex(line);
    lines.push({
      index,
      total: planned.totalChunks,
      vinId,
      prevHash: prev,
      nextIndex,
      nextPtr: nextIndex == null ? "END" : String(nextIndex),
      body: planned.chunks[i],
      bodyBytes: utf8ByteLength(planned.chunks[i]),
      line,
      hex,
      hash,
      calldataBytes: utf8ByteLength(line),
    });
    prev = hash;
  }
  let file = peekVitaFileMeta(String(body));
  return {
    ok: true,
    mode: file && !file.error ? "vitafile" : "plain",
    vinId,
    nonce,
    contentCommit,
    readerKey: formatVitaFeedReaderKey(vinId),
    payer: VITAFEED_PAYER,
    wallet: VITAFEED_WALLET,
    vault: "never",
    saveBucket: "never",
    maxBytes: planned.maxBytes,
    maxPayloadConstant: planned.maxPayloadConstant,
    totalChars: planned.totalChars,
    totalBytes: planned.totalBytes,
    totalBits: planned.totalBits,
    totalChunks: planned.totalChunks,
    injections: planned.injections,
    lines,
    file,
    note: file && !file.error
      ? "VITAFILE UTF-8 packets — VIN header + base64 body; RISK pay after confirm|override; reader plays when complete"
      : "plain UTF-8 — VIN header + verbatim body; RISK pay after confirm",
  };
}

export function resolveVitaFeedQuotes(input = {}) {
  const liveGwei = Number(input.gwei);
  const liveUsd = Number(input.ethUsd);
  const liveL1 = Number(input.l1FeeEth);
  const hasLive = input.live === true
    || (Number.isFinite(liveGwei) && liveGwei > 0 && Number.isFinite(liveUsd) && liveUsd > 0);
  if (hasLive) {
    return {
      gwei: liveGwei,
      ethUsd: liveUsd,
      l1FeeEth: Number.isFinite(liveL1) && liveL1 >= 0 ? liveL1 : 0,
      label: "LIVE",
      source: input.source || "live Base gas + ETH mark",
    };
  }
  return { ...VITAFEED_DEMO_QUOTES };
}

/**
 * Per-injection ETH: L2 calldata (EIP-2028) + documented 50k self-tx gas + L1.
 */
export function estimateOneInjectionEth(calldataBytes, quotes) {
  const q = resolveVitaFeedQuotes(quotes);
  const bytes = Math.max(0, Math.floor(Number(calldataBytes) || 0));
  const l2CalldataEth = estimateCalldataHitchEth(bytes, q.gwei);
  const l2ExecEth = estimateBtpInscribeEth(q.gwei, VITAFEED_TX_GAS_UNITS);
  const l1Eth = Number(q.l1FeeEth) > 0 ? Number(q.l1FeeEth) : 0;
  return {
    calldataBytes: bytes,
    l2CalldataEth,
    l2ExecEth,
    l1Eth,
    eth: l2CalldataEth + l2ExecEth + l1Eth,
    gasUnits: VITAFEED_TX_GAS_UNITS + bytes * VITAFEED_CALLDATA_GAS_PER_BYTE,
  };
}

export function estimateVitaFeedCost(prepared, quotes = {}) {
  const q = resolveVitaFeedQuotes(quotes);
  if (!prepared?.ok || !prepared.lines?.length) {
    return { ok: false, reason: prepared?.reason || "nothing to price", quotes: q };
  }
  const perLine = prepared.lines.map((line) => estimateOneInjectionEth(line.calldataBytes, q));
  const perInjectionEth = perLine.reduce((s, r) => s + r.eth, 0) / perLine.length;
  const totalEth = perLine.reduce((s, r) => s + r.eth, 0);
  const totalUsd = totalEth * q.ethUsd;
  return {
    ok: true,
    quotes: q,
    label: q.label,
    source: q.source,
    payer: VITAFEED_PAYER,
    wallet: VITAFEED_WALLET,
    vault: "never",
    saveBucket: "never",
    chars: prepared.totalChars,
    bytes: prepared.totalBytes,
    bits: prepared.totalBits,
    maxBytes: prepared.maxBytes,
    maxPayloadConstant: prepared.maxPayloadConstant,
    injections: prepared.injections,
    gasUnitsPerInjection: VITAFEED_TX_GAS_UNITS,
    calldataGasPerByte: VITAFEED_CALLDATA_GAS_PER_BYTE,
    perInjectionEth,
    perInjectionUsd: perInjectionEth * q.ethUsd,
    totalEth,
    totalUsd,
    perLine,
    confirmRequired: true,
    confirmChars: VITAFEED_CONFIRM_CHARS,
    warnLarge: prepared.totalChars > VITAFEED_CONFIRM_CHARS,
  };
}

export function formatVitaFeedCostCard(cost, prepared, { phase = "before" } = {}) {
  if (!cost?.ok) return "VITAFEED: " + (cost?.reason || "cannot price");
  const q = cost.quotes || VITAFEED_DEMO_QUOTES;
  const lines = [];
  lines.push("VITAFEED COST CARD · " + q.label + " · " + phase.toUpperCase());
  if (prepared?.file && !prepared.file.error) {
    lines.push(summarizeFileLine(prepared.file));
    lines.push("spaced UTF-8 packets (base64) — code-ready for Tailwind reader play");
  } else {
    lines.push("plain UTF-8 (no encode, no §SESS§ unless you typed it)");
  }
  lines.push("IN  chars=" + cost.chars + "  bytes=" + cost.bytes + "  bits=" + cost.bits);
  lines.push(
    "max payload/chunk = " + cost.maxBytes + " bytes (" + cost.maxPayloadConstant + ")",
  );
  lines.push("injections/blocks = " + cost.injections);
  lines.push(
    "gas/injection ≈ " + VITAFEED_TX_GAS_UNITS + "u + " +
    VITAFEED_CALLDATA_GAS_PER_BYTE + " gas/byte calldata",
  );
  lines.push(
    "ETH/injection ≈ " + cost.perInjectionEth.toFixed(8) +
    "  × " + cost.injections +
    "  = " + cost.totalEth.toFixed(8) + " ETH",
  );
  lines.push(
    "USD total ≈ $" + cost.totalUsd.toFixed(4) +
    "  (ETH $" + q.ethUsd + " · " + q.gwei + " gwei)",
  );
  lines.push("quotes: " + q.label + " — " + q.source);
  lines.push("payer=" + VITAFEED_PAYER + " wallet=" + VITAFEED_WALLET);
  lines.push("vault=never  save-bucket=never  (LOSE-ZERO)");
  if (prepared?.vinId) {
    lines.push("VIN " + prepared.vinId + "  reader " + prepared.readerKey);
    for (const line of prepared.lines || []) {
      lines.push(
        "  " + padIndex(line.index, line.total) +
        " prev=" + line.prevHash +
        " next=" + line.nextPtr +
        " body=" + line.bodyBytes + "B" +
        " loc=header+payload",
      );
    }
  }
  if (cost.warnLarge) {
    lines.push("WARN: body > " + VITAFEED_CONFIRM_CHARS + " chars — confirm to avoid a burn");
  }
  lines.push("CONFIRM required: /vitafeed confirm   (or /vitafeed cancel)");
  lines.push(
    "OVERRIDE: /vitafeed override — bypass RISK balance REFUSE + liquid floor; " +
    "send chunks until gas/error, keep sealed locs, restage remainder",
  );
  return lines.join("\n");
}

export function formatVitaFeedReceipt(result, cost) {
  const s = result?.strand || result || {};
  const lines = [];
  lines.push("VITAFEED RECEIPT · " + (cost?.label || "—"));
  lines.push("VIN " + (s.vinId || "—"));
  lines.push("IN  bytes=" + (s.totalBytes ?? s.inBytes ?? 0) + "  chars=" + (s.totalChars ?? 0));
  const locs = (s.locations || []).filter((h) => /^0x[0-9a-fA-F]{64}$/.test(String(h)));
  lines.push("OUT txs=" + locs.length + "/" + (s.totalChunks || s.lines?.length || 0));
  if (cost?.ok) {
    lines.push(
      "paid ≈ " + cost.totalEth.toFixed(8) + " ETH  ($" + cost.totalUsd.toFixed(4) +
      ") · " + cost.label,
    );
  }
  if (cost?.dualCombinedUsd != null && Number.isFinite(Number(cost.dualCombinedUsd))) {
    lines.push(
      "dual both lanes $≈" + Number(cost.dualCombinedUsd).toFixed(4) +
      " ETH≈" + Number(cost.dualCombinedEth || 0).toFixed(8),
    );
  }
  lines.push("payer=" + VITAFEED_PAYER + "  vault=never  save-bucket=never");
  if (locs.length) {
    lines.push("locations (spaced / bunched):");
    locs.forEach((tx, i) => {
      lines.push("  " + (i + 1) + "/" + locs.length + "  " + tx);
      lines.push("     " + VITAFEED_BASESCAN_TX + tx);
    });
  }
  if (s.readerKey) lines.push("reader key: " + s.readerKey);
  if (s.file && !s.file.error) lines.push(summarizeFileLine(s.file));
  if (result?.banked) {
    lines.push("banked " + (result.sealedCount || 0) + "/" + result.needed + " — never invent hashes");
  }
  // Basescan read receipt — Input Data → UTF-8 is the on-chain chat of the data.
  lines.push("");
  lines.push("BASESCAN READ RECEIPT");
  lines.push("read: Basescan → Input Data → View as UTF-8  (on-chain chat)");
  if (locs.length) {
    lines.push("open each link above to read the sealed chat of this inject");
  } else {
    lines.push("(no sealed locations yet — never invent hashes)");
  }
  if (result?.playProof?.card) {
    lines.push("");
    lines.push(result.playProof.card);
  }
  return lines.join("\n");
}

export function parseVitaFeedCommand(raw, { replyBody = "" } = {}) {
  const s = String(raw ?? "");
  if (!/^\/vitafeed(?:@\w+)?(?:\s|$)/i.test(s) && !/^\/vitafeed$/i.test(s.trim())) {
    return { ok: false, action: null, body: "" };
  }
  const after = s.replace(/^\/vitafeed(?:@\w+)?/i, "");
  const body = after.startsWith(" ") || after.startsWith("\n") || after.startsWith("\t")
    ? after.slice(1)
    : after;
  const trimmed = body.trim();
  if (!trimmed) {
    const reply = String(replyBody ?? "");
    if (reply.length) return { ok: true, action: "preview", body: reply, source: "reply" };
    return { ok: true, action: "usage", body: "", source: "empty" };
  }
  if (/^confirm(?:ed)?$/i.test(trimmed)) {
    return { ok: true, action: "confirm", body: "", source: "confirm" };
  }
  // Operator force-through of the RISK balance REFUSE (typo "overide" accepted).
  // `/vitafeed override force` (also `/vitafeed force`) is the thrift latch:
  // bypasses paid-off + rate limit for this seal only — same as VITAFEED_FORCE=yes.
  if (/^(?:override|overide)(?:\s+force)?$/i.test(trimmed) || /^(?:force|forceoverride|overrideforce)$/i.test(trimmed)) {
    const commandForce =
      /\bforce\b/i.test(trimmed) || /^(?:force|forceoverride|overrideforce)$/i.test(trimmed);
    return {
      ok: true,
      action: "override",
      body: "",
      source: commandForce ? "override-force" : "override",
      forceOverride: true,
      forceLatch: commandForce === true,
    };
  }
  // Systems check: local files / players vs sealed Base mirrors (honest).
  if (/^(?:check|mirror|syscheck|systems?)(?:\s|$)/i.test(trimmed)) {
    const rest = trimmed.replace(/^(?:check|mirror|syscheck|systems?)\s*/i, "").trim();
    return { ok: true, action: "check", body: rest, source: "check" };
  }
  if (/^cancel$/i.test(trimmed)) {
    return { ok: true, action: "cancel", body: "", source: "cancel" };
  }
  // Blockchain brain seed — formula + anchors + recall for recursive AI.
  if (/^brain(?:\s|$)/i.test(trimmed)) {
    return { ok: true, action: "brain", body: "", source: "brain" };
  }
  // Learn cycle card / zero-proof growth (no new stage unless brain).
  if (/^learn(?:\s|$)/i.test(trimmed)) {
    return { ok: true, action: "learn", body: "", source: "learn" };
  }
  if (/^(?:proof|zeroproof|zero-proof)(?:\s|$)/i.test(trimmed)) {
    return { ok: true, action: "proof", body: "", source: "proof" };
  }
  // Dual-lane human ↔ machine translate / side-by-side cost proof.
  if (/^(?:translate|xlat|humanmachine|hm)\b/i.test(trimmed)) {
    const rest = trimmed.replace(/^(?:translate|xlat|humanmachine|hm)\s*/i, "").trim();
    return { ok: true, action: "translate", body: rest, source: "translate" };
  }
  if (/^(?:dual|bothlanes|lanes)\b/i.test(trimmed)) {
    const rest = trimmed.replace(/^(?:dual|bothlanes|lanes)\s*/i, "").trim();
    return { ok: true, action: "dual", body: rest, source: "dual" };
  }
  // Exit bags ≥ $0.50 to restart RISK for more inject tests.
  if (/^(?:restart|restartmoney|exitfuel)(?:\s|$)/i.test(trimmed)) {
    return { ok: true, action: "restart", body: "", source: "restart" };
  }
  // Curated knowledge loader → backlog + did-you-know / capability recall.
  if (/^(?:load|loader|preload|feedload)\b/i.test(trimmed)) {
    const rest = trimmed.replace(/^(?:load|loader|preload|feedload)\s*/i, "").trim();
    return { ok: true, action: "load", body: rest, source: "load" };
  }
  if (/^(?:know|didyouknow|hey|funfact)\b/i.test(trimmed)) {
    const rest = trimmed.replace(/^(?:know|didyouknow|hey|funfact)\s*/i, "").trim();
    return { ok: true, action: "know", body: rest, source: "know" };
  }
  if (/^(?:recall|capability|canido|skills)\b/i.test(trimmed)) {
    const rest = trimmed.replace(/^(?:recall|capability|canido|skills)\s*/i, "").trim();
    return { ok: true, action: "recall", body: rest, source: "recall" };
  }
  if (/^(?:cipher|ciphers|encoding)\b/i.test(trimmed)) {
    return { ok: true, action: "cipher", body: "", source: "cipher" };
  }
  // Reference memory search — calculator true-name + translator codex (ask|self).
  if (/^(?:ref|ask|recallref)\b/i.test(trimmed)) {
    const rest = trimmed.replace(/^(?:ref|ask|recallref)\s*/i, "").trim();
    return { ok: true, action: "ref", body: rest, source: "ref" };
  }
  if (/^(?:proven|tests|proventest|proven-tests)(?:\s|$)/i.test(trimmed)) {
    return { ok: true, action: "proven", body: "", source: "proven" };
  }
  // DOS-style master directory — browse + open-source unlock (no private key).
  if (/^(?:dir|directory|tree|ls|cd)(?:\s|$)/i.test(trimmed)) {
    const rest = trimmed.replace(/^(?:dir|directory|tree|ls|cd)\s*/i, "").trim();
    return { ok: true, action: "dir", body: rest, source: "dir" };
  }
  if (/^(?:unlock|openfile|reveal)\b/i.test(trimmed)) {
    const rest = trimmed.replace(/^(?:unlock|openfile|reveal)\s*/i, "").trim();
    return { ok: true, action: "unlock", body: rest, source: "unlock" };
  }
  // KIDS closed-garden YouTube URL directory.
  if (/^(?:kids|urldir|url-dir|kplaylist)(?:\s|$)/i.test(trimmed)) {
    const rest = trimmed.replace(/^(?:kids|urldir|url-dir|kplaylist)\s*/i, "").trim();
    return { ok: true, action: "kids", body: rest, source: "kids" };
  }
  if (/^(?:music|maple|freemusic|joplin|judy|garland|rainbow|chasing|grace|amazing|daisy|bicycle|ballgame|ball|auld|syne|susanna|foster|lining|silver|entertainer|stripes|sousa|sweetheart|afterball|gaskin)(?:\s|$)/i.test(trimmed)) {
    const first = trimmed.split(/\s+/)[0];
    const rest = trimmed.replace(/^\S+\s*/, "").trim();
    return {
      ok: true,
      action: "music",
      body: /^(?:music|freemusic)$/i.test(first) ? rest : (rest || first),
      source: "music",
    };
  }
  // Photos drive — Google Drive / folder / URL → PHOTOS → chain.
  if (/^(?:photos?|pictures?|gallery|gdrive|gphotos)(?:\s|$)/i.test(trimmed)) {
    const rest = trimmed.replace(/^(?:photos?|pictures?|gallery|gdrive|gphotos)\s*/i, "").trim();
    const wantsFile = /^(?:add|file|upload|drop)$/i.test(rest);
    return {
      ok: true,
      action: "photos",
      body: rest,
      source: "photos",
      wantsFile,
    };
  }
  // DJ soundboard — pads, prompted bites, uploads.
  if (/^(?:board|soundboard|pads|dj)(?:\s|$)/i.test(trimmed)) {
    const rest = trimmed.replace(/^(?:board|soundboard|pads|dj)\s*/i, "").trim();
    return { ok: true, action: "board", body: rest, source: "board" };
  }
  if (/^(?:pad|hit|trigger)\b/i.test(trimmed)) {
    const rest = trimmed.replace(/^(?:pad|hit|trigger)\s*/i, "").trim();
    return { ok: true, action: "pad", body: rest, selector: rest, source: "pad" };
  }
  if (/^(?:prompt|bite|synth)\b/i.test(trimmed)) {
    const rest = trimmed.replace(/^(?:prompt|bite|synth)\s*/i, "").trim();
    return { ok: true, action: "prompt", body: rest, source: "prompt" };
  }
  // Voxel spatial soundbites — bird prints + xyz + one-block goal.
  if (/^(?:spatial|voxel|voxels|birds?)(?:\s|$)/i.test(trimmed)) {
    const rest = trimmed.replace(/^(?:spatial|voxel|voxels|birds?)\s*/i, "").trim();
    return { ok: true, action: "spatial", body: rest, source: "spatial" };
  }
  if (/^(?:soundtrack|score|chorus)\b/i.test(trimmed)) {
    const rest = trimmed.replace(/^(?:soundtrack|score|chorus)\s*/i, "").trim();
    return { ok: true, action: "soundtrack", body: rest || "0,0,0", source: "soundtrack" };
  }
  if (/^(?:bird)\b/i.test(trimmed)) {
    const rest = trimmed.replace(/^(?:bird)\s*/i, "").trim();
    return { ok: true, action: "spatial", body: rest ? "bird " + rest : "", source: "bird" };
  }
  if (/^(?:chaindir|chain-dir|chdir)(?:\s|$)/i.test(trimmed)) {
    const rest = trimmed.replace(/^(?:chaindir|chain-dir|chdir)\s*/i, "").trim();
    return { ok: true, action: "chaindir", body: rest, source: "chaindir" };
  }
  if (/^(?:cycle|grease|nextcycle)(?:\s|$)/i.test(trimmed)) {
    return { ok: true, action: "cycle", body: "", source: "cycle" };
  }
  if (/^(?:loc|location|inputdata)\b/i.test(trimmed)) {
    const rest = trimmed.replace(/^(?:loc|location|inputdata)\s*/i, "").trim();
    return { ok: true, action: "loc", body: rest, source: "loc" };
  }
  // Inject / message-sent tracking — prove click-through + running code path.
  if (/^(?:track|trackinject|clicktrack)(?:\s|$)/i.test(trimmed)) {
    const rest = trimmed.replace(/^(?:track|trackinject|clicktrack)\s*/i, "").trim();
    return { ok: true, action: "track", body: rest, source: "track" };
  }
  if (/^(?:demo|playerpopup|popup)(?:\s|$)/i.test(trimmed)) {
    return { ok: true, action: "play", body: "demo", selector: "demo", source: "demo" };
  }
  // Named library: list sealed files, open one into the player, seal keys catalog.
  if (/^(?:files|list)$/i.test(trimmed)) {
    return { ok: true, action: "files", body: "", source: "files" };
  }
  if (/^(?:play|open|pull)\b/i.test(trimmed)) {
    const sel = trimmed.replace(/^(?:play|open|pull)\s*/i, "").trim();
    return {
      ok: true,
      action: "play",
      body: sel,
      selector: sel,
      source: "play",
    };
  }
  if (/^keys(?:\s|$)/i.test(trimmed)) {
    const rest = trimmed.replace(/^keys\s*/i, "").trim();
    return { ok: true, action: "keys", body: rest, source: "keys" };
  }
  // Offline brain feed queue — enqueue memory/files, drain without agent AI.
  if (/^(?:backlog|queue)(?:\s|$)/i.test(trimmed)) {
    const rest = trimmed.replace(/^(?:backlog|queue)\s*/i, "").trim();
    return { ok: true, action: "backlog", body: rest, source: "backlog" };
  }
  if (/^(?:enqueue|enque|feedqueue)\b/i.test(trimmed)) {
    const rest = trimmed.replace(/^(?:enqueue|enque|feedqueue)\s*/i, "").trim();
    return { ok: true, action: "enqueue", body: rest, source: "enqueue" };
  }
  if (/^(?:next|drain)\b/i.test(trimmed)) {
    const rest = trimmed.replace(/^(?:next|drain)\s*/i, "").trim();
    return { ok: true, action: "next", body: rest, source: "next" };
  }
  // Compression bake-off — every codec, verified key, then injection.
  if (/^(?:compress|compression|squash|codec)(?:\s|$)/i.test(trimmed)) {
    const rest = trimmed.replace(/^(?:compress|compression|squash|codec)\s*/i, "").trim();
    const wantsFile = /^(?:add|file|upload|drop)$/i.test(rest);
    return {
      ok: true,
      action: "compress",
      body: rest,
      source: "compress",
      wantsFile,
    };
  }
  // Proof-of-logs trail — creation-order verification log + Telegram tabs.
  if (/^(?:log|trail|prooflog|proof-log|proofs)(?:\s|$)/i.test(trimmed)) {
    const rest = trimmed.replace(/^(?:log|trail|prooflog|proof-log|proofs)\s*/i, "").trim();
    return { ok: true, action: "log", body: rest, source: "log" };
  }
  // Reply-to-file / explicit file cue — Telegram handler encodes attachment.
  if (/^file(?:\s|$)/i.test(trimmed) || /^upload(?:\s|$)/i.test(trimmed)) {
    const rest = trimmed.replace(/^(?:file|upload)\s*/i, "");
    return {
      ok: true,
      action: "file",
      body: rest,
      source: "file",
      wantsFile: true,
    };
  }
  return { ok: true, action: "preview", body, source: "args" };
}

export function vitaFeedUsageText() {
  return [
    "usage: /vitafeed [exact plain text]",
    "or reply to a message with /vitafeed",
    "FILE (Telegram — either works):",
    "  1) /vitafeed file  → bot says please insert file → send song/video/doc",
    "  2) reply to an attachment with /vitafeed file (or /vitafeed)",
    "  → bytes become §VITAFILE§ base64 text packets (spaced VIN chunks)",
    "Cost card first (chars/bytes/bits + injections + ETH/$).",
    "Buy-in: low ≤3% of wave + predicted up; stake from character cost;",
    "leave $0.10 AI + $0.10 human + 1.5% tax; sell same % up + cost overlay.",
    "Then /vitafeed confirm — pays RISK only (never vault / save bucket).",
    "PAID PATH DEFAULT OFF: set VITAFEED_PAID=yes (or VITAFEED_ENABLED=yes|true|1)",
    "  or confirm/override BANKS (no sendTransaction). Override cannot bypass paid-off",
    "  unless VITAFEED_FORCE=yes or /vitafeed override force (then also skips rate limit).",
    "Liquid floor: VITAFEED_MIN_LIQUID_USD default $5 (confirm blocked; override bypasses).",
    "Rate limit: one confirm / chat / 60s and max 24 chunks/hour",
    "  (VITAFEED_RATE_LIMIT=no disables). Override does not bypass rate limit unless FORCE.",
    "FORCE: VITAFEED_FORCE=yes + /vitafeed override — OR /vitafeed override force",
    "  (command latch, no env) — thrift block id off; plain body seal.",
    "AUTOFIRE: VITAFEED_AUTOFIRE=yes + VITAFEED_AUTOFIRE_BODY=… one-shot (no BL- id).",
    "/vitafeed override — force-through money stalls:",
    "  bypasses RISK balance REFUSE + liquid floor; still needs VITAFEED_PAID=yes (or FORCE).",
    "  /vitafeed override force — ALSO bypasses paid-off + hourly chunk cap (media dumps).",
    "  Sends each VIN chunk until on-chain/gas error — keeps sealed locs,",
    "  restages remainder so you can override again when funded.",
    "  When complete: PLAY PROOF — Tailwind reader peaces locations + plays blob.",
    "/vitafeed check — systems check: files/players LOCAL_OK vs sealed Base MATCH.",
    "BRAIN: /vitafeed brain — activate learn cycle (old→new + peer review +",
    "  zero-proof growth + library + vita-save packet) then stage for override.",
    "  /vitafeed learn  — last cycle old→new card (no restage).",
    "  /vitafeed proof  — squashed zero-proof retrieval growth + backlog growth.",
    "DUAL LANE (human text ↔ machine language — same knowledge, both costs):",
    "  /vitafeed translate [text] — side-by-side HUMAN vs MACHINE sizes + ETH/$",
    "  /vitafeed dual [text]      — stage both lanes; confirm seals HUMAN then MACHINE",
    "  Receipt lists spaced Basescan locs + Input Data → UTF-8 read receipt (chat).",
    "  /vitafeed restart          — bags ≥ $0.50 → exit to refill RISK for inject tests",
    "LOADER (curated knowledge → backlog; rides existing queue):",
    "  /vitafeed load [pack|all]  — preload cipher/prog/LLM packs + dual cost mirror",
    "  /vitafeed know [n|id]      — Hey did you know… + on-chain library recall",
    "  /vitafeed recall           — proof of new things chains-of-data can do",
    "  /vitafeed cipher           — CIPHER:\\ encode↔decode hierarchy",
    "  Animate: /vita/feed-loader — file stack preload (batch now or later)",
    "REF MEMORY (proven recursive search from packaged ledger):",
    "  /vitafeed ref <q>   — search true-name (calculator/calc/calculadora/電卓/…)",
    "  /vitafeed ask <q>   — same as ref (ask|self label from query)",
    "  /vitafeed proven    — run calculator proven-test series (never invent)",
    "DIRECTORY (DOS-style filing — prove what AI stored on-chain):",
    "  /vitafeed dir              — master VITA:\\ subdirs (TAP buttons)",
    "  /vitafeed dir MEMORY       — list a subdir (TAP each file)",
    "  /vitafeed unlock CODEX\\math-euler.txt — open-source unlock (no private key)",
    "  Instant ZK-short unwrap → SNARK first · Human plain · Machine key (+ timing)",
    "  /vitafeed track [sym]      — stage inject/message proof for Confirm|Override",
    "  /tokens · /tok SYMBOL      — token catalog → buy/sell/exit/dual/track",
    "KIDS URL DIRECTORY (closed-garden YouTube playlist — no recommendations):",
    "  /vitafeed kids             — KIDS url dir card + player link",
    "  /vitafeed dir KIDS         — DOS list of curated urls",
    "  /vitafeed play kids [n]    — load directory in closed-garden player",
    "  /vitafeed play demo        — Tailwind demo WAV player (Telegram popup)",
    "  /vitafeed play maple|judy|grace|daisy|ballgame|auld|lining|susanna|entertainer|stripes|sweetheart|afterball",
    "  /vitafeed music            — growing PD library card (Maple, Judy rainbow lane, …)",
    "  /vitafeed music <id>       — one-song grouped inject plan + loc proof",
    "  /vitafeed photos           — Photos Drive (new Google Drive for pictures)",
    "  /vitafeed photos source <url|folder> — bind public Drive / local / https",
    "  /vitafeed photos scan      — queue pictures from source (slow-copy ready)",
    "  /vitafeed photos next      — copy one picture into VITA:\\PHOTOS\\",
    "  /vitafeed photos all       — batch drain queue + inbox",
    "  /vitafeed photos add       — send one picture (open key = the picture)",
    "  /vitafeed photos test      — Earthrise (NASA PD) hope full-system test",
    "  /vitafeed photos test mlk  — MLK historical uplift full-system test",
    "  /vitafeed photos unwrap [id] — blockchain inject stream + READ PROOF receipts",
    "  /vitafeed dir PHOTOS       — DOS list · open-picture unlock",
    "  /vitafeed enqueue photo <id> — queue picture §VITAFILE§ groups for confirm|override",
    "  /vitafeed enqueue photos   — bank every catalog picture",
    "  /vitafeed board            — DJ soundboard pad grid (Telegram buttons)",
    "  /vitafeed pad <id>         — hit a pad · play + zero-open-key + loc rail",
    "  /vitafeed prompt <recipe>  — prompted music bite → catalog → inject",
    "  /vitafeed dir BOARD        — DOS list of pads",
    "  /vitafeed enqueue pad <id> — queue pad §VITAFILE§ groups for confirm|override",
    "  /vitafeed enqueue board    — bank every built-in pad",
    "  /vitafeed spatial          — voxel spatial bird-print microbites (ONE-BLOCK goal)",
    "  /vitafeed spatial <id>     — play bite · inject proof CTA (sealed only)",
    "  /vitafeed spatial new <print> <x> <y> <z> — place a print in xyz",
    "  /vitafeed soundtrack <vx,vy,vz> — agentic soundtrack from nearby voxels",
    "  /vitafeed enqueue spatial  — bank every one-block spatial bite",
    "  /vitafeed enqueue spatial <id> — queue one §VITASPATIAL§ (≤720B when possible)",
    "  /vitafeed dir VOXEL        — DOS list of spatial bites",
    "  /vitafeed dir MUSIC        — DOS list of VIN groups",
    "  /vitafeed enqueue <id>     — queue grouped §VITAFILE§ slices (≤24 VIN/group)",
    "  /vitafeed enqueue library  — bank every catalog song (not memory seed; enqueue all stays seed)",
    "  /vitafeed dual pad <id>    — HUMAN pad card + MACHINE zero-open-key",
    "  /vitafeed dual <id>        — HUMAN catalog + MACHINE group shas (Telegram dual path)",
    "  /vitafeed dual kids        — HUMAN url list + MACHINE ids (Telegram dual path)",
    "  Telegram: tap Watch popup (Mini App + HTTPS) — small window while you work",
    "  Player: /vita/kids-player?dir=kids&popup=1  ·  /vita/feed-player?demo=1&popup=1",
    "  Photos: /vita/photos · viewer /vita/photos/viewer?id=<id>&unwrap=1 · media · locs",
    "  Board: /vita/soundboard · locs /vita/soundboard/locs?id=<id> · inspect ?i=1&g=1",
    "  Spatial: /vita/spatial · locs /vita/spatial/locs?id=<id> · soundtrack ?voxel=0,0,0",
    "  CLASS_PROOF anchors ≠ photo/pad/spatial body — new Inputs only after seal MATCH",
    "  Inject click-through appears ONLY after confirm|override seals real tx (VITAFEED_PAID=yes)",
    "  Loc proof: /vita/free-music/locs?id=<id> — click-through Basescan · data-field MATCH",
    "  Inspect: /vita/free-music/loc?id=<id>&g=1&i=1 — exact VIN UTF-8 fed into the player",
    "  Kids player: /vita/feed-player?music=<id>&kids=1 — proof chrome default OFF (Show blockchain toggle)",
    "CHAIN DIRECTORY (Input Data loc proofs · HUMAN + MACHINE · order of completion):",
    "  /vitafeed chaindir         — top=routing/waiting · bottom=complete clickable proofs",
    "  /vitafeed loc 0x…          — search directory by sealed location",
    "  /vitafeed cycle            — complete pair triggers next dual inject (self-check)",
    "  /vitafeed dir CHAIN        — DOS line-for-line log",
    "BACKLOG (feed brain without agentic AI):",
    "  /vitafeed backlog        — pending→sealed growth card",
    "  /vitafeed enqueue seed   — queue brain seed + memory files (no send)",
    "  /vitafeed next           — stage next pending for confirm|override",
    "COMPRESSION (every codec · verified key · then injection):",
    "  /vitafeed compress         — bench personal + program + video + inbox",
    "  /vitafeed compress add     — drop any file; recommend the best verified codec",
    "  /vitafeed compress <path>  — one file (kind optional: personal|program|video)",
    "  /vitafeed compress dir     — key directory (VITA:\\COMPRESS\\)",
    "  /vitafeed compress unwrap [key] — HUMAN plain text from MACHINE wire",
    "  /vitafeed compress verify <key> — VERIFIED true · answer recovered",
    "  /vitafeed compress inject [key] — stage winner for confirm|override",
    "  /vitafeed unlock COMPRESS\\1 — same unwrap via telegram directory",
    "  Inbox: vita/compression/inbox/   ·   page: /vita/compression",
    "  Buttons: HOME→Compress · Feed→Comp add · dir COMPRESS — every step is a tap",
    "  Call returns verified + the open key that compressed the file.",
    "PROOF-OF-LOGS (creation-order trail · key+root on every row):",
    "  /vitafeed trail            — rolling log of filed/verified/message-out",
    "  /vitafeed log <n>          — open trail file · tabs Plain|Machine|Original",
    "  /vitafeed log plain <n>    — HUMAN plain text",
    "  /vitafeed log machine <n>  — MACHINE handoff for agentic AI",
    "  /vitafeed log original <n> — original format + download",
    "  /vitafeed log race <n>     — who proofed/injected first (slots 1–3+)",
    "  /vitafeed log chains <n> [base,ethereum,…] — memory credit seats",
    "  Dir: /vitafeed dir PROOFLOG  ·  page: /vita/proof-log",
    "  Never invents hashes. Sealed locs only after confirm|override.",
    "  Chain stays availability until a real seal. Never invent hashes.",
    "LIBRARY (Telegram quick pull):",
    "  /vitafeed files          — list saved names (auto-saved on seal)",
    "  /vitafeed play <n|name>  — open from keys → player (also: open|pull)",
    "  /vitafeed keys           — stage §VITALIB§ keys catalog (name→key→locs)",
    "/vitafeed cancel drops the staged payload (and clears a file wait).",
    "Plain UTF-8 or VITAFILE → hex calldata. VIN headers link chunks (prev/next).",
    "Max payload/chunk = " + VITAFEED_MAX_CHUNK_BYTES + " bytes (VITAFEED_MAX_CHUNK_BYTES).",
    "Player: /vita/feed-player — upload any data, demo seal, play from locations.",
    "  or /vita/feed-player?lib=<n> after /vitafeed files.",
    "  or /vita/feed-player?music=<id> — PD library · click-through loc MATCH.",
    "  or /vita/feed-player?music=<id>&kids=1 — clean play UI; Proof toggle shows blockchain.",
    "  or /vita/photos?id=<id> — Photos Drive · open-picture key · Earthrise hope test.",
    "  or /vita/soundboard?pad=<id> — DJ soundboard · waveform · zero-open-key loc rail.",
    "  or /vita/spatial?id=<id> — voxel spatial bird prints · one-block SNARK filing goal.",
    "Does not touch /vitasave mother brain. Does not set VITA_AUTO_INSCRIBE.",
  ].join("\n");
}

export function stageVitaFeed(chatId, row) {
  const key = String(chatId || "default");
  const entry = {
    ...row,
    chatId: key,
    at: new Date().toISOString(),
    confirmed: false,
  };
  pending.set(key, entry);
  return entry;
}

export function peekVitaFeed(chatId) {
  return pending.get(String(chatId || "default")) || null;
}

export function takeVitaFeed(chatId) {
  const key = String(chatId || "default");
  const row = pending.get(key) || null;
  if (row) pending.delete(key);
  return row;
}

export function clearVitaFeed(chatId) {
  return pending.delete(String(chatId || "default"));
}

export function requiresVitaFeedConfirm() {
  return true;
}

export function maySendVitaFeed({ confirmed = false, pendingRow = null } = {}) {
  if (confirmed !== true) return false;
  if (!pendingRow?.prepared?.ok) return false;
  if (!pendingRow.prepared.lines?.length) return false;
  return true;
}

function envFlagOnExplicit(raw) {
  const v = String(raw ?? "").trim().toLowerCase();
  return v === "yes" || v === "true" || v === "1";
}

function envFlagOffExplicit(raw) {
  const v = String(raw ?? "").trim().toLowerCase();
  return v === "no" || v === "off" || v === "0" || v === "false";
}

function envNumber(raw, fallback) {
  if (raw == null || String(raw).trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** VITAFEED_PAID or VITAFEED_ENABLED must be yes|true|1. Default OFF. */
export function vitaFeedPaidEnabled(env = process.env) {
  return envFlagOnExplicit(env?.[VITAFEED_PAID_ENV] ?? env?.[VITAFEED_ENABLED_ENV] ?? "");
}

/**
 * Operator force latch — when yes, /vitafeed override bypasses paid-off + rate
 * limit (and already bypasses liquid floor / RISK REFUSE). Default OFF.
 * Does not re-enable confirm under paid-off; only override + autofire.
 */
export function vitaFeedForceEnabled(env = process.env) {
  return envFlagOnExplicit(env?.[VITAFEED_FORCE_ENV] ?? "");
}

function readJsonSafe(path) {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function countSealMap(byId) {
  if (!byId || typeof byId !== "object") return { ids: 0, locs: 0 };
  let ids = 0;
  let locs = 0;
  for (const row of Object.values(byId)) {
    ids += 1;
    const list = row?.locs || row?.locations || row?.sealedLocs || [];
    locs += Array.isArray(list) ? list.length : 0;
  }
  return { ids, locs };
}

/**
 * Honest mirror audit: disk/library availability vs sealed Base body locs.
 * Media players that play from local OGG/WAV are LOCAL_OK until every VIN
 * group has a real Input Data hash — formula anchors are class proof only.
 */
export function auditVitaFeedChainMirror({ memoryDir = MEMORY_DIR } = {}) {
  const music = readJsonSafe(join(memoryDir, "free-music-catalog.json"));
  const songs = music?.songs && typeof music.songs === "object" ? music.songs : {};
  const songIds = Object.keys(songs);
  let musicLocalFiles = 0;
  for (const s of Object.values(songs)) {
    const rel = String(s?.file || "");
    if (rel && existsSync(join(HERE, "..", rel))) musicLocalFiles += 1;
    else if (rel && existsSync(rel)) musicLocalFiles += 1;
  }

  const boardSeals = readJsonSafe(join(memoryDir, "soundboard-seals.json"));
  const spatialSeals = readJsonSafe(join(memoryDir, "spatial-sound-seals.json"));
  const boardCat = readJsonSafe(join(memoryDir, "soundboard-catalog.json"));
  const spatialCat = readJsonSafe(join(memoryDir, "spatial-sound-catalog.json"));
  const backlog = readJsonSafe(join(memoryDir, "vitafeed-backlog.json"));
  const inject = readJsonSafe(join(memoryDir, "chain-layer-inject.json"));

  const boardCount = countSealMap(boardSeals?.byId);
  const spatialCount = countSealMap(spatialSeals?.byId);
  const padIds = Object.keys(boardCat?.pads || boardCat?.byId || {}).length
    || (Array.isArray(boardCat?.pads) ? boardCat.pads.length : 0);
  const spatialIds = Object.keys(spatialCat?.bites || spatialCat?.byId || {}).length
    || (Array.isArray(spatialCat?.bites) ? spatialCat.bites.length : 0);

  const items = Array.isArray(backlog?.items) ? backlog.items : [];
  const pending = items.filter((i) => i?.status === "pending" || i?.status === "staged").length;
  const sealed = items.filter((i) => i?.status === "sealed").length;

  const injectSealed = Number(inject?.sealedCount || 0);
  const injectPending = Number(inject?.pendingCount || inject?.totalChunks || 0);
  const musicSealedOnChain = 0; // catalog never invents locs; CHAINDIR proven only after seal

  const mediaLocalOnly =
    musicLocalFiles > 0 && boardCount.locs === 0 && spatialCount.locs === 0 && musicSealedOnChain === 0;

  return {
    ok: true,
    neverInventHashes: true,
    formulaAnchorsAreClassProofOnly: true,
    mediaLocalOnly,
    music: {
      songs: songIds.length,
      localFiles: musicLocalFiles,
      sealedBodyLocs: musicSealedOnChain,
      status: musicSealedOnChain > 0 ? "MATCH" : "LOCAL_OK",
      note: "OGG on disk = availability until /vitafeed enqueue <id> → override force seals VIN groups",
    },
    soundboard: {
      pads: padIds,
      sealedIds: boardCount.ids,
      sealedLocs: boardCount.locs,
      status: boardCount.locs > 0 ? "MATCH" : "LOCAL_OK",
    },
    spatial: {
      bites: spatialIds,
      sealedIds: spatialCount.ids,
      sealedLocs: spatialCount.locs,
      status: spatialCount.locs > 0 ? "MATCH" : "LOCAL_OK",
    },
    backlog: {
      pending,
      sealed,
      total: items.length,
      status: sealed > 0 && pending === 0 ? "DRAINED" : pending > 0 ? "PENDING" : "EMPTY",
    },
    spacedInject: {
      sealed: injectSealed,
      pending: injectPending,
      status: injectSealed > 0 ? "PARTIAL_OR_MATCH" : "LOCAL_ONLY",
    },
    next:
      "Stage: /vitafeed next (or enqueue maple|board) → /vitafeed override force to seal past paid-off + hourly cap",
  };
}

export function formatVitaFeedMirrorCheckCard(audit = auditVitaFeedChainMirror()) {
  const a = audit || {};
  const lines = [
    "VITAFEED SYSTEMS CHECK — chain mirror (honest)",
    "class-proof anchors ≠ file/song/pad body — never invent Basescan hashes",
    "",
    "MUSIC  songs=" + (a.music?.songs ?? 0) +
      " localFiles=" + (a.music?.localFiles ?? 0) +
      " sealedBodyLocs=" + (a.music?.sealedBodyLocs ?? 0) +
      " · " + (a.music?.status || "LOCAL_OK"),
    "BOARD  pads=" + (a.soundboard?.pads ?? 0) +
      " sealedLocs=" + (a.soundboard?.sealedLocs ?? 0) +
      " · " + (a.soundboard?.status || "LOCAL_OK"),
    "SPATIAL bites=" + (a.spatial?.bites ?? 0) +
      " sealedLocs=" + (a.spatial?.sealedLocs ?? 0) +
      " · " + (a.spatial?.status || "LOCAL_OK"),
    "BACKLOG pending=" + (a.backlog?.pending ?? 0) +
      " sealed=" + (a.backlog?.sealed ?? 0) +
      " · " + (a.backlog?.status || "?"),
    "INJECT  sealed=" + (a.spacedInject?.sealed ?? 0) +
      " pendingChunks≈" + (a.spacedInject?.pending ?? 0) +
      " · " + (a.spacedInject?.status || "LOCAL_ONLY"),
    "",
  ];
  if (a.mediaLocalOnly) {
    lines.push(
      "VERDICT: media players are SAVED on disk / GitHub — NOT yet mirrored as Input Data.",
      "Playback from LOCAL_OK is expected until confirm|override seals every VIN group.",
    );
  } else {
    lines.push("VERDICT: some body locs sealed — pull Basescan Input Data → UTF-8 to verify MATCH.");
  }
  lines.push("");
  lines.push("UNSTICK: " + (a.next || "/vitafeed override force"));
  lines.push(
    "Thrift: plain /vitafeed override bypasses money floor only;",
    "  paid-off + rate-limit need FORCE env or /vitafeed override force.",
  );
  return lines.join("\n");
}

/** VITAFEED_AUTOFIRE must be yes|true|1. Default OFF. One-shot boot/desk fire. */
export function vitaFeedAutofireEnabled(env = process.env) {
  return envFlagOnExplicit(env?.[VITAFEED_AUTOFIRE_ENV] ?? "");
}

/** Exact plain UTF-8 body for autofire — no BL- backlog id, no §VITABACKLOG§ wrap. */
export function vitaFeedAutofireBody(env = process.env) {
  return String(env?.[VITAFEED_AUTOFIRE_BODY_ENV] ?? "").trim();
}

export function vitaFeedAutofireSpent() {
  return _vitaFeedAutofireSpent;
}

export function resetVitaFeedAutofireSpent() {
  _vitaFeedAutofireSpent = false;
}

export function markVitaFeedAutofireSpent(env = process.env) {
  _vitaFeedAutofireSpent = true;
  if (env && typeof env === "object") env[VITAFEED_AUTOFIRE_ENV] = "no";
}

/** Default $5. Set 0 to disable the floor. Negative/NaN → default. */
export function vitaFeedMinLiquidUsd(env = process.env) {
  const n = envNumber(env?.[VITAFEED_MIN_LIQUID_USD_ENV], VITAFEED_MIN_LIQUID_USD_DEFAULT);
  if (n < 0) return VITAFEED_MIN_LIQUID_USD_DEFAULT;
  return n;
}

/** Rate limit default ON. VITAFEED_RATE_LIMIT=no|0|off|false disables. */
export function vitaFeedRateLimitEnabled(env = process.env) {
  return !envFlagOffExplicit(env?.[VITAFEED_RATE_LIMIT_ENV]);
}

export function vitaFeedConfirmCooldownSec(env = process.env) {
  const n = envNumber(env?.[VITAFEED_CONFIRM_COOLDOWN_SEC_ENV], VITAFEED_CONFIRM_COOLDOWN_SEC_DEFAULT);
  return n < 0 ? VITAFEED_CONFIRM_COOLDOWN_SEC_DEFAULT : n;
}

export function vitaFeedMaxChunksPerHour(env = process.env) {
  const n = envNumber(env?.[VITAFEED_MAX_CHUNKS_PER_HOUR_ENV], VITAFEED_MAX_CHUNKS_PER_HOUR_DEFAULT);
  if (n < 0) return VITAFEED_MAX_CHUNKS_PER_HOUR_DEFAULT;
  return Math.floor(n);
}

export function vitaFeedMaxConfirmAgeSec(env = process.env) {
  const n = envNumber(env?.[VITAFEED_MAX_CONFIRM_AGE_SEC_ENV], VITAFEED_MAX_CONFIRM_AGE_SEC_DEFAULT);
  return n < 0 ? VITAFEED_MAX_CONFIRM_AGE_SEC_DEFAULT : n;
}

export function peekVitaFeedPaidLog() {
  return paidSends.map((row) => ({ ...row }));
}

export function noteVitaFeedPaidSend({ chatId = "default", chunks = 1, now = Date.now() } = {}) {
  const row = {
    chatId: String(chatId || "default"),
    atMs: Number(now) || Date.now(),
    chunks: Math.max(1, Math.floor(Number(chunks) || 1)),
  };
  paidSends.push(row);
  return row;
}

export function formatVitaFeedPaidOffReply({ action = "confirm" } = {}) {
  return [
    "VITAFEED BANK — paid confirm is OFF",
    "VITAFEED_PAID / VITAFEED_ENABLED must be yes|true|1 to call sendTransaction.",
    "/vitafeed override alone cannot bypass this kill-switch (action=" + action + ").",
    "FORCE through thrift: /vitafeed override force  (or set VITAFEED_FORCE=yes).",
    "That also skips the hourly chunk / rate-limit cap (needed for song/video dumps).",
    "Cost card / preview still works. Staged payload kept. /vitafeed cancel to drop.",
    "Stops runaway RISK self-calls (n5624→6007 +383 class).",
  ].join("\n");
}

export function formatVitaFeedLiquidFloorReply({ liquidUsd, floor }) {
  return [
    "VITAFEED REFUSE — liquid floor",
    "RISK liquid ≈ $" + Number(liquidUsd).toFixed(2) +
      " < $" + Number(floor).toFixed(2) + " (VITAFEED_MIN_LIQUID_USD, default 5).",
    "confirm blocked to stop drain. /vitafeed override bypasses this money floor.",
    "Set VITAFEED_MIN_LIQUID_USD=0 to disable floor for confirm too.",
  ].join("\n");
}

export function formatVitaFeedRateLimitReply({ reason, cooldownSec, cap, used, next, ageSec, maxAgeSec }) {
  const lines = ["VITAFEED REFUSE — rate limit"];
  if (reason === "stale-confirm") {
    lines.push(
      "Telegram confirm is stale (" + Math.floor(ageSec) + "s old, max " + maxAgeSec +
        "s) — possible getUpdates replay after restart. Send a fresh /vitafeed confirm.",
    );
  } else if (reason === "cooldown") {
    lines.push("Same chat already confirmed within " + cooldownSec + "s. Wait or cancel.");
  } else if (reason === "chunk-cap") {
    lines.push(
      "Hourly chunks " + used + "/" + cap + " + this batch " + next +
        " would exceed VITAFEED_MAX_CHUNKS_PER_HOUR (default 24).",
    );
  }
  lines.push("Flood / loop guard. Set VITAFEED_RATE_LIMIT=no to disable.");
  lines.push("Or /vitafeed override force (FORCE latch) to seal media dumps past the hourly cap.");
  return lines.join("\n");
}

/**
 * Kill-switch + liquid floor + rate limit for confirm/override.
 * /vitafeed override cannot bypass paid-off or rate limit unless VITAFEED_FORCE=yes
 * OR command forceLatch (/vitafeed override force).
 * Override DOES bypass liquid floor (money stall) when forceOverride/action=override.
 * FORCE + override also bypasses paid-off + rate limit (block id / thrift off).
 */
export function evaluateVitaFeedThriftGate({
  action,
  chatId = "default",
  env = process.env,
  liquidUsd = null,
  chunkCount = 1,
  now = Date.now(),
  messageAtMs = null,
  forceOverride = false,
  /** Partial-seal resume: skip per-chat cooldown so remainder can continue. */
  skipCooldown = false,
  /** /vitafeed override force — one-shot thrift latch (same as VITAFEED_FORCE=yes). */
  forceLatch: commandForceLatch = false,
} = {}) {
  const paidAction = action === "confirm" || action === "override";
  const override = forceOverride === true || action === "override";
  const forceLatch = (override && vitaFeedForceEnabled(env)) || (override && commandForceLatch === true);
  if (!paidAction) {
    return { ok: true, send: false, code: "not-paid-action" };
  }

  if (!vitaFeedPaidEnabled(env) && !forceLatch) {
    return {
      ok: false,
      send: false,
      code: "paid-off",
      reply: formatVitaFeedPaidOffReply({ action }),
    };
  }

  const floor = vitaFeedMinLiquidUsd(env);
  if (
    !override &&
    floor > 0 &&
    liquidUsd != null &&
    Number.isFinite(Number(liquidUsd)) &&
    Number(liquidUsd) < floor
  ) {
    return {
      ok: false,
      send: false,
      code: "liquid-floor",
      reply: formatVitaFeedLiquidFloorReply({ liquidUsd: Number(liquidUsd), floor }),
    };
  }

  if (!vitaFeedRateLimitEnabled(env) || forceLatch) {
    return {
      ok: true,
      send: true,
      code: forceLatch ? "force-ok" : "thrift-ok",
      forced: forceLatch === true,
    };
  }

  const nowMs = Number(now) || Date.now();
  const maxAgeSec = vitaFeedMaxConfirmAgeSec(env);
  if (maxAgeSec > 0 && messageAtMs != null && Number.isFinite(Number(messageAtMs))) {
    const ageSec = (nowMs - Number(messageAtMs)) / 1000;
    if (ageSec > maxAgeSec) {
      return {
        ok: false,
        send: false,
        code: "stale-confirm",
        reply: formatVitaFeedRateLimitReply({
          reason: "stale-confirm",
          ageSec,
          maxAgeSec,
        }),
      };
    }
  }

  const key = String(chatId || "default");
  const cooldownSec = vitaFeedConfirmCooldownSec(env);
  if (cooldownSec > 0 && !skipCooldown) {
    let lastAt = 0;
    for (const row of paidSends) {
      if (row.chatId === key && row.atMs > lastAt) lastAt = row.atMs;
    }
    if (lastAt > 0 && nowMs - lastAt < cooldownSec * 1000) {
      return {
        ok: false,
        send: false,
        code: "cooldown",
        reply: formatVitaFeedRateLimitReply({ reason: "cooldown", cooldownSec }),
      };
    }
  }

  const cap = vitaFeedMaxChunksPerHour(env);
  const next = Math.max(1, Math.floor(Number(chunkCount) || 1));
  if (cap > 0) {
    const hourAgo = nowMs - 60 * 60 * 1000;
    let used = 0;
    for (const row of paidSends) {
      if (row.atMs >= hourAgo) used += row.chunks;
    }
    if (used + next > cap) {
      return {
        ok: false,
        send: false,
        code: "chunk-cap",
        reply: formatVitaFeedRateLimitReply({ reason: "chunk-cap", cap, used, next }),
      };
    }
  }

  return { ok: true, send: true, code: "thrift-ok" };
}

/**
 * Send each VIN line via sendTx(hex, line) → txHash | null.
 * Never invents hashes. Caller must already have passed the confirm gate.
 * On throw / null / non-hash: stop further sends, keep sealed locs (partial).
 */
export async function runVitaFeedInscribe(prepared, sendTx) {
  if (!prepared?.ok) return prepared;
  const chunks = [];
  const txHashes = [];
  let stopReason = null;
  let stoppedAt = null;
  for (const line of prepared.lines) {
    if (stopReason) {
      chunks.push({
        index: line.index,
        total: line.total,
        vinId: line.vinId,
        prevHash: line.prevHash,
        nextIndex: line.nextIndex,
        nextPtr: line.nextPtr,
        hash: line.hash,
        bodyBytes: line.bodyBytes,
        calldataBytes: line.calldataBytes,
        linePreview: line.line.slice(0, 80),
        fullLine: line.line,
        body: line.body,
        txHash: null,
        sealed: false,
        location: null,
        basescan: null,
        skipped: true,
        error: stopReason,
      });
      continue;
    }
    const hex = line.hex || utf8ToHex(line.line);
    let txHash = null;
    try {
      txHash = await sendTx(hex, line);
    } catch (e) {
      stopReason = String(e?.message || e || "sendTx threw");
      stoppedAt = line.index;
      chunks.push({
        index: line.index,
        total: line.total,
        vinId: line.vinId,
        prevHash: line.prevHash,
        nextIndex: line.nextIndex,
        nextPtr: line.nextPtr,
        hash: line.hash,
        bodyBytes: line.bodyBytes,
        calldataBytes: line.calldataBytes,
        linePreview: line.line.slice(0, 80),
        fullLine: line.line,
        body: line.body,
        txHash: null,
        sealed: false,
        location: null,
        basescan: null,
        error: stopReason,
      });
      continue;
    }
    if (txHash && !/^0x[0-9a-fA-F]{64}$/.test(String(txHash))) {
      stopReason = "sender returned non-hash — refuse invent";
      stoppedAt = line.index;
      chunks.push({
        index: line.index,
        total: line.total,
        vinId: line.vinId,
        prevHash: line.prevHash,
        nextIndex: line.nextIndex,
        nextPtr: line.nextPtr,
        hash: line.hash,
        bodyBytes: line.bodyBytes,
        calldataBytes: line.calldataBytes,
        linePreview: line.line.slice(0, 80),
        fullLine: line.line,
        body: line.body,
        txHash: null,
        sealed: false,
        location: null,
        basescan: null,
        error: stopReason,
      });
      continue;
    }
    if (!txHash) {
      stopReason = "send returned null — stop; keep sealed locs";
      stoppedAt = line.index;
      chunks.push({
        index: line.index,
        total: line.total,
        vinId: line.vinId,
        prevHash: line.prevHash,
        nextIndex: line.nextIndex,
        nextPtr: line.nextPtr,
        hash: line.hash,
        bodyBytes: line.bodyBytes,
        calldataBytes: line.calldataBytes,
        linePreview: line.line.slice(0, 80),
        fullLine: line.line,
        body: line.body,
        txHash: null,
        sealed: false,
        location: null,
        basescan: null,
        error: stopReason,
      });
      continue;
    }
    chunks.push({
      index: line.index,
      total: line.total,
      vinId: line.vinId,
      prevHash: line.prevHash,
      nextIndex: line.nextIndex,
      nextPtr: line.nextPtr,
      hash: line.hash,
      bodyBytes: line.bodyBytes,
      calldataBytes: line.calldataBytes,
      linePreview: line.line.slice(0, 80),
      fullLine: line.line,
      body: line.body,
      txHash,
      sealed: true,
      location: txHash,
      basescan: VITAFEED_BASESCAN_TX + txHash,
    });
    txHashes.push(txHash);
  }

  const remainingBody = chunks
    .filter((c) => !c.sealed)
    .map((c) => c.body ?? "")
    .join("");
  const priorLocations = txHashes.slice();

  const strand = {
    vinId: prepared.vinId,
    mode: prepared.mode || "plain",
    contentCommit: prepared.contentCommit,
    readerKey: prepared.readerKey,
    payer: VITAFEED_PAYER,
    wallet: VITAFEED_WALLET,
    totalChars: prepared.totalChars,
    totalBytes: prepared.totalBytes,
    totalBits: prepared.totalBits,
    totalChunks: prepared.totalChunks,
    inBytes: prepared.totalBytes,
    file: prepared.file || null,
    chunks,
    locations: txHashes.slice(),
    at: new Date().toISOString(),
    stopReason: stopReason || null,
    stoppedAt,
  };

  const banked = txHashes.length < prepared.totalChunks;
  return {
    ok: true,
    banked,
    sealedCount: txHashes.length,
    needed: prepared.totalChunks,
    strand,
    remainingBody: banked && remainingBody.length ? remainingBody : "",
    priorLocations,
    stopReason: stopReason || null,
    stoppedAt,
    reason: txHashes.length === prepared.totalChunks
      ? "sealed — every injection returned a real hash"
      : txHashes.length
        ? "partial seal — kept " + txHashes.length + "/" + prepared.totalChunks +
          " locs" + (stopReason ? " (stop: " + stopReason + ")" : "") +
          "; remainder restaged — never invent"
        : "no hashes yet — never invent txs" +
          (stopReason ? " (stop: " + stopReason + ")" : ""),
  };
}

/**
 * Thin Telegram/HTML action router. Paid send only when confirm + sendTx
 * AND VITAFEED_PAID=yes. Override alone cannot bypass the paid kill-switch;
 * `/vitafeed override force` (or VITAFEED_FORCE=yes) can. Override bypasses
 * liquid floor + RISK balance REFUSE; partial seal restages.
 */
export async function handleVitaFeedAction({
  action,
  body = "",
  chatId = "default",
  quotes = {},
  sendTx = null,
  riskBalanceEth = null,
  gasReserveEth = 0.0005,
  seats = [],
  /** When false, RISK need is inscription+gas only (buy-in already spent). */
  reserveBuyStake = true,
  /** /vitafeed override — bypass RISK balance REFUSE + liquid floor. */
  forceOverride = false,
  /** /vitafeed override force — one-shot thrift latch (paid-off + rate limit). */
  forceLatch = false,
  /** Env snapshot (tests pass {}). Default process.env. */
  env = process.env,
  /** RISK ETH+WETH mark USD. Null skips the liquid floor. */
  liquidUsd = null,
  now = Date.now(),
  /** Telegram message.date * 1000 — stale confirm / getUpdates replay guard. */
  messageAtMs = null,
  /** Bytes from a dropped file on the compression path. */
  compressionBytes = null,
  compressionName = "",
  compressionMime = "",
  /** Isolated dirs for tests. Production uses vita/memory + vita/compression. */
  compressionOpts = null,
  /** Picture bytes for /vitafeed photos add */
  photoBytes = null,
  photoName = "",
  photoMime = "",
} = {}) {
  if (action === "check") {
    const audit = auditVitaFeedChainMirror();
    return {
      ok: true,
      phase: "check",
      audit,
      reply: formatVitaFeedMirrorCheckCard(audit),
    };
  }
  if (action === "usage" || action === "file") {
    // "file" without Telegram attachment bytes → usage (agent encodes attachment first).
    const { buildVitaFeedRootKeyboard } = await import("./telegram-clickthrough.js");
    return {
      ok: true,
      phase: "usage",
      reply: vitaFeedUsageText(),
      keyboard: buildVitaFeedRootKeyboard(),
    };
  }
  if (action === "cancel") {
    const had = clearVitaFeed(chatId);
    return {
      ok: true,
      phase: "cancel",
      reply: had ? "VITAFEED cancelled — staged payload dropped. RISK unspent." : "VITAFEED: nothing staged.",
    };
  }
  // Blockchain brain activate — learn cycle + peer review + zero-proof + stage.
  if (action === "brain") {
    const { listLibraryEntries, formatLibraryListCard } = await import("./vita-feed-library.js");
    const {
      activateBrainLearnCycle,
      researchNotesForFiling,
    } = await import("./brain-learn.js");
    const libraryEntries = listLibraryEntries();
    const cycle = activateBrainLearnCycle({ libraryEntries });
    const seedBody = cycle.stageBody || cycle.seedBody;
    const prepared = prepareVitaFeed(seedBody);
    if (!prepared.ok) {
      return {
        ok: false,
        phase: "brain",
        reply: prepared.reason || "brain seed empty",
        cycle,
      };
    }
    const cost = estimateVitaFeedCost(prepared, quotes);
    const buyIn = planVitaFeedBuyIns({ prepared, cost, seats, quotes });
    // Park same stage on disk backlog so drain can continue without agent AI.
    let backlogPark = null;
    try {
      const { enqueueBrainStageOnBacklog, formatFeedBacklogCard } =
        await import("./vita-feed-backlog.js");
      backlogPark = enqueueBrainStageOnBacklog({
        stageBody: seedBody,
        cycleIndex: cycle.cycleIndex,
      });
      backlogPark.card = formatFeedBacklogCard();
    } catch { /* backlog is best-effort */ }
    stageVitaFeed(chatId, {
      prepared,
      cost,
      body: seedBody,
      quotes,
      buyIn,
      seats,
      brain: true,
      backlogId: backlogPark?.item?.id || null,
      brainLearn: {
        cycleIndex: cycle.cycleIndex,
        zeroProofRoot: cycle.zeroProof?.root,
        peerVerdict: cycle.peer?.verdict,
        vitaSaveCommit: cycle.vitaSave?.contentCommit,
      },
    });
    return {
      ok: true,
      phase: "before",
      staged: true,
      prepared,
      cost,
      buyIn,
      brain: cycle.localSeed,
      brainLearn: cycle,
      backlog: backlogPark,
      reply:
        cycle.card +
        "\n\n" + formatLibraryListCard() +
        "\n\n" + researchNotesForFiling() +
        (backlogPark?.card ? "\n\n" + backlogPark.card : "") +
        "\n\n" +
        formatVitaFeedCostCard(cost, prepared, { phase: "before" }) +
        "\n\n" + formatVitaFeedBuyInCard(buyIn) +
        "\n\nNext: /vitafeed override (money stall OK) · /vitafeed next · /vitafeed proof",
    };
  }
  if (action === "learn") {
    const { loadBrainLearnLog, formatBrainLearnCard, formatZeroProofGrowthCard } =
      await import("./brain-learn.js");
    const { formatLibraryListCard, listLibraryEntries } = await import("./vita-feed-library.js");
    const log = loadBrainLearnLog();
    if (!log.cycles?.length) {
      return {
        ok: true,
        phase: "learn",
        reply:
          "VITA BRAIN LEARN — no cycles yet.\nRun /vitafeed brain to activate.\n\n" +
          formatLibraryListCard() +
          "\n\n" + formatZeroProofGrowthCard(),
      };
    }
    const last = log.cycles[log.cycles.length - 1];
    const card = formatBrainLearnCard({
      cycleIndex: last.cycleIndex,
      old: last.old,
      new: last.new,
      diff: last.diff,
      peer: { verdict: last.peerVerdict, pass: [], fail: [] },
      zeroProof: {
        cycleIndex: last.cycleIndex,
        root: last.zeroProofRoot,
        prevRoot: log.zeroProof?.roots?.[log.zeroProof.roots.length - 2] ||
          log.zeroProof?.genesis,
        growth: {
          memoryCount: last.new?.memoryCount,
          strandCount: last.new?.strandCount,
          libraryCount: last.new?.libraryCount,
          sealedLocCount: last.new?.sealedLocCount,
        },
      },
      vitaSave: { chars: 0, contentCommit: last.vitaSaveCommit },
      filingRefine: { added: [] },
    });
    return {
      ok: true,
      phase: "learn",
      cycle: last,
      library: listLibraryEntries(),
      reply:
        card +
        "\n\n" + formatLibraryListCard() +
        "\n\n" + formatZeroProofGrowthCard() +
        "\n\nRe-activate: /vitafeed brain",
    };
  }
  if (action === "proof") {
    const { formatZeroProofGrowthCard, loadBrainLearnLog, researchNotesForFiling } =
      await import("./brain-learn.js");
    const { formatLibraryListCard } = await import("./vita-feed-library.js");
    const { formatFeedBacklogGrowthProof, formatFeedBacklogCard } =
      await import("./vita-feed-backlog.js");
    const {
      formatDualLaneSideBySideCard,
      prepareDualLaneCompare,
      formatRestartMoneyExitHint,
    } = await import("./vita-feed-dual.js");
    const { formatFeedFlowProofCard } = await import("./feed-flow.js");
    const log = loadBrainLearnLog();
    // Demo dual compare of a short proof note so Telegram always shows both lanes.
    const dualNote =
      "VITAFEED dual-lane proof: human plain vs machine ZK-short of the same knowledge. " +
      "Basescan Input Data → UTF-8 is the on-chain chat.";
    const dual = prepareDualLaneCompare(dualNote, quotes);
    const restart = formatRestartMoneyExitHint({ bags: seatsToBags(seats) });
    return {
      ok: true,
      phase: "proof",
      cycles: log.cycles?.length || 0,
      roots: log.zeroProof?.roots || [],
      dual,
      reply:
        formatZeroProofGrowthCard() +
        "\n\n" + formatFeedFlowProofCard() +
        "\n\n" + formatFeedBacklogGrowthProof() +
        "\n\n" + formatFeedBacklogCard() +
        "\n\n" + formatLibraryListCard() +
        "\n\n" + researchNotesForFiling() +
        (dual.ok ? "\n\n" + formatDualLaneSideBySideCard(dual, { phase: "proof" }) : "") +
        "\n\n" + restart.card +
        "\n\nActivate/grow: /vitafeed brain · /vitafeed dual [text] · /vitafeed enqueue seed · /vitafeed next",
    };
  }
  if (action === "translate") {
    const {
      prepareDualLaneCompare,
      formatDualLaneSideBySideCard,
    } = await import("./vita-feed-dual.js");
    let text = String(body || "").trim();
    if (!text) {
      const staged = peekVitaFeed(chatId);
      text = staged?.body || "";
    }
    {
      const { maybeKidsDualHumanBody } = await import("./url-dir.js");
      text = maybeKidsDualHumanBody(text);
      const { maybeMusicDualHumanBody } = await import("./free-music.js");
      const { maybePadDualHumanBody } = await import("./soundboard.js");
      text = maybePadDualHumanBody(maybeMusicDualHumanBody(text));
    }
    if (!text) {
      return {
        ok: false,
        phase: "translate",
        reply:
          "VITADUAL TRANSLATE: need text.\n" +
          "usage: /vitafeed translate [exact plain]\n" +
          "or stage with /vitafeed [text] then /vitafeed translate",
      };
    }
    const dual = prepareDualLaneCompare(text, quotes);
    return {
      ok: dual.ok,
      phase: "translate",
      dual,
      reply: dual.ok
        ? formatDualLaneSideBySideCard(dual, { phase: "translate" }) +
          "\n\nStage both for seal: /vitafeed dual " +
          (text.length > 80 ? "(re-paste body)" : text)
        : "VITADUAL: " + (dual.reason || "translate failed"),
    };
  }
  if (action === "dual") {
    const {
      buildDualStagePayload,
      formatRestartMoneyExitHint,
    } = await import("./vita-feed-dual.js");
    let text = String(body || "").trim();
    if (!text) {
      const staged = peekVitaFeed(chatId);
      text = staged?.body || "";
    }
    {
      const { maybeKidsDualHumanBody } = await import("./url-dir.js");
      text = maybeKidsDualHumanBody(text);
      const { maybeMusicDualHumanBody } = await import("./free-music.js");
      const { maybePadDualHumanBody } = await import("./soundboard.js");
      text = maybePadDualHumanBody(maybeMusicDualHumanBody(text));
    }
    if (!text) {
      return {
        ok: false,
        phase: "dual",
        reply:
          "VITADUAL: need human text.\n" +
          "usage: /vitafeed dual [exact plain knowledge]\n" +
          "Then /vitafeed confirm — seals HUMAN then MACHINE with Basescan receipts.",
      };
    }
    const dualStage = buildDualStagePayload(text, quotes);
    if (!dualStage.ok) {
      return {
        ok: false,
        phase: "dual",
        reply: "VITADUAL: " + (dualStage.reason || "prepare failed"),
      };
    }
    const buyIn = planVitaFeedBuyIns({
      prepared: dualStage.prepared,
      cost: dualStage.cost,
      seats,
      quotes,
    });
    stageVitaFeed(chatId, {
      prepared: dualStage.prepared,
      cost: dualStage.cost,
      body: dualStage.body,
      quotes: dualStage.quotes,
      buyIn,
      seats,
      dual: true,
      dualCompare: dualStage.compare,
      machineBody: dualStage.machineBody,
      machinePrepared: dualStage.machinePrepared,
    });
    let chainDirExtra = "";
    try {
      const { routeTransmission, guessTransmissionName, formatChainDirCard } =
        await import("./chain-dir.js");
      routeTransmission({
        name: guessTransmissionName(dualStage.body),
        humanBody: dualStage.body,
        machineBody: dualStage.machineBody,
      });
      chainDirExtra =
        "\n\n" + formatChainDirCard() +
        "\nRouting — two ends talking. Confirm seals HUMAN then MACHINE into Input Data.";
    } catch { /* chain dir is best-effort */ }
    const restart = formatRestartMoneyExitHint({ bags: seatsToBags(seats) });
    return {
      ok: true,
      phase: "before",
      staged: true,
      dual: true,
      prepared: dualStage.prepared,
      cost: dualStage.cost,
      buyIn,
      compare: dualStage.compare,
      reply:
        dualStage.card +
        "\n\n" + formatVitaFeedBuyInCard(buyIn) +
        "\n\n" + restart.card +
        chainDirExtra +
        "\n\nNext: /vitafeed confirm (or override) — HUMAN then MACHINE · Basescan read receipts",
    };
  }
  if (action === "restart") {
    const { formatRestartMoneyExitHint } = await import("./vita-feed-dual.js");
    const restart = formatRestartMoneyExitHint({ bags: seatsToBags(seats) });
    return {
      ok: true,
      phase: "restart",
      hits: restart.hits,
      reply:
        restart.card +
        "\n\nMoney is for proof — exit ≥$0.50 bags to refill RISK, then /vitafeed dual [knowledge]",
    };
  }
  if (action === "load") {
    const {
      preloadKnowledgePacks,
      ensureLoaderMemorySeeds,
      listKnowledgePacks,
      getKnowledgePack,
      LOADER_THOUGHT_NOTE,
    } = await import("./vita-feed-loader.js");
    ensureLoaderMemorySeeds();
    const arg = String(body || "").trim().toLowerCase();
    let packIds = null;
    let includeAll = true;
    if (arg && arg !== "all" && arg !== "seed") {
      const one = getKnowledgePack(arg);
      if (!one) {
        const list = listKnowledgePacks();
        return {
          ok: false,
          phase: "load",
          reply:
            "VITALOAD: unknown pack " +
            arg +
            "\npacks: " +
            list.map((p) => p.id).join(", ") +
            "\nTry: /vitafeed load   or /vitafeed load cipher-aes-gcm",
        };
      }
      packIds = [one.id];
      includeAll = false;
    }
    const result = preloadKnowledgePacks({ packIds, includeAll, quotes });
    return {
      ok: true,
      phase: "load",
      result,
      reply:
        (result.animation?.card || "") +
        "\n\n" +
        result.card +
        "\n\nTHOUGHT: " +
        LOADER_THOUGHT_NOTE.thought +
        "\n\nNext: /vitafeed next · /vitafeed know · /vitafeed recall · /vita/feed-loader",
    };
  }
  if (action === "know") {
    const { formatDidYouKnowCard, ensureLoaderMemorySeeds, getKnowledgePack } =
      await import("./vita-feed-loader.js");
    ensureLoaderMemorySeeds();
    const arg = String(body || "").trim();
    const asNum = Number(arg);
    const pack = getKnowledgePack(arg);
    const card = formatDidYouKnowCard({
      packId: pack?.id || null,
      rotate: Number.isFinite(asNum) ? asNum : 0,
    });
    return { ok: true, phase: "know", reply: card };
  }
  if (action === "recall") {
    const { formatCapabilityRecallCard, ensureLoaderMemorySeeds, getKnowledgePack } =
      await import("./vita-feed-loader.js");
    ensureLoaderMemorySeeds();
    const pack = getKnowledgePack(String(body || "").trim());
    return {
      ok: true,
      phase: "recall",
      reply: formatCapabilityRecallCard({ packId: pack?.id || null }),
    };
  }
  if (action === "cipher") {
    const { formatCipherHierarchyCard, ensureLoaderMemorySeeds } =
      await import("./vita-feed-loader.js");
    ensureLoaderMemorySeeds();
    return {
      ok: true,
      phase: "cipher",
      reply: formatCipherHierarchyCard(),
    };
  }
  if (action === "ref") {
    const {
      searchRefMemory,
      formatRefMemoryCard,
      buildRefMemoryFeedBody,
    } = await import("./ref-memory.js");
    const q = String(body || "").trim() || "calculator";
    const found = searchRefMemory(q);
    return {
      ok: found.ok || found.invent === false,
      phase: "ref",
      query: q,
      result: found,
      feedBody: buildRefMemoryFeedBody(),
      reply:
        formatRefMemoryCard(found) +
        "\n\nSeries: /vitafeed proven  ·  Seal: /vitafeed enqueue topic ref-lib-calculator",
    };
  }
  if (action === "proven") {
    const {
      runProvenTests,
      formatProvenTestCard,
      buildRefMemoryFeedBody,
    } = await import("./ref-memory.js");
    const report = runProvenTests();
    return {
      ok: report.ok,
      phase: "proven",
      report,
      feedBody: buildRefMemoryFeedBody(),
      reply:
        formatProvenTestCard(report) +
        "\n\nTry: /vitafeed ref calculadora  ·  /vitafeed ask I built a calc for payroll",
    };
  }
  if (action === "chaindir") {
    const {
      formatChainDirCard,
      formatChainDirSearchCard,
      searchByLocation,
      publicChainDirState,
    } = await import("./chain-dir.js");
    const { buildChainDirKeyboard } = await import("./telegram-clickthrough.js");
    const rest = String(body || "").trim();
    if (/^0x[0-9a-fA-F]{64}$/.test(rest)) {
      const found = searchByLocation(rest);
      return {
        ok: found.ok,
        phase: "chaindir",
        found,
        reply: formatChainDirSearchCard(found),
        keyboard: buildChainDirKeyboard(publicChainDirState()),
      };
    }
    const state = publicChainDirState();
    return {
      ok: true,
      phase: "chaindir",
      state,
      reply: formatChainDirCard(),
      keyboard: buildChainDirKeyboard(state),
    };
  }
  if (action === "loc") {
    const { searchByLocation, formatChainDirSearchCard, publicChainDirState } =
      await import("./chain-dir.js");
    const { buildChainDirKeyboard } = await import("./telegram-clickthrough.js");
    const found = searchByLocation(body);
    return {
      ok: found.ok,
      phase: "loc",
      found,
      reply: formatChainDirSearchCard(found),
      keyboard: buildChainDirKeyboard(publicChainDirState()),
    };
  }
  if (action === "cycle") {
    const {
      formatChainDirCard,
      formatCycleCard,
      listCompleteLines,
      triggerCycle,
      publicChainDirState,
      routeTransmission,
      guessTransmissionName,
    } = await import("./chain-dir.js");
    const { peekNextFeedBacklogItem } = await import("./vita-feed-backlog.js");
    const { buildChainDirKeyboard } = await import("./telegram-clickthrough.js");
    const done = listCompleteLines();
    const last = done.at(-1);
    const cycle = last ? triggerCycle({ n: last.n, status: "complete", completedAt: last.completedAt, name: last.name }) : { triggered: false, reason: "no complete pair yet — dual then confirm" };
    const next = peekNextFeedBacklogItem();
    if (last && next?.ok && next.item?.body) {
      routeTransmission({
        name: guessTransmissionName(next.item.body, next.public?.name || next.item?.name),
        humanBody: next.item.body,
      });
    }
    const state = publicChainDirState();
    return {
      ok: true,
      phase: "cycle",
      cycle,
      next: next?.ok ? next.public : null,
      reply:
        formatCycleCard(cycle, last) +
        "\n\n" +
        formatChainDirCard() +
        "\n\n" +
        (next?.ok
          ? "Next backlog staged as routing — /vitafeed next then confirm|override (HUMAN then MACHINE)."
          : "Backlog empty — /vitafeed dual maple or /vitafeed enqueue maple to keep grouped song injects streaming."),
      keyboard: buildChainDirKeyboard(state),
    };
  }
  if (action === "music") {
    const {
      formatFreeMusicCard,
      formatFreeMusicLibraryCard,
      loadFreeMusic,
      playFreeMusic,
      resolveSongId,
      listCatalogSongIds,
    } = await import("./free-music.js");
    const { buildPlayerPopupKeyboard } = await import("./telegram-clickthrough.js");
    const rest = String(body || "").trim();
    if (!rest || /^(?:library|list|all|songs)$/i.test(rest)) {
      const playerPath = "/vita/feed-player?music=maple";
      return {
        ok: true,
        phase: "music",
        library: true,
        songs: listCatalogSongIds(),
        playerPath,
        playerHref: (await import("./url-dir.js")).vitaPlayerHref(playerPath),
        reply: formatFreeMusicLibraryCard(),
        keyboard: buildPlayerPopupKeyboard({ playerPath }),
      };
    }
    const songId = resolveSongId(/^(?:play|open)$/i.test(rest) ? "maple" : rest) || "maple";
    if (/^(?:play|open)/i.test(rest)) {
      const opened = playFreeMusic(songId);
      return {
        ok: opened.ok !== false,
        phase: "play",
        music: true,
        proven: opened.proven === true,
        play: opened.play || null,
        playProof: opened.playProof || null,
        playerPath: opened.playerPath || null,
        playerHref: opened.playerHref || null,
        reply: opened.reply || opened.reason || "open failed",
        keyboard: opened.ok
          ? buildPlayerPopupKeyboard({ playerPath: opened.playerPath })
          : undefined,
      };
    }
    const dir = loadFreeMusic(songId);
    const playerPath = dir.player || ("/vita/feed-player?music=" + songId);
    return {
      ok: dir.ok !== false,
      phase: "music",
      directory: dir.ok ? { id: dir.id, groupCount: dir.groupCount, player: dir.player } : null,
      playerPath,
      playerHref: (await import("./url-dir.js")).vitaPlayerHref(playerPath),
      reply: formatFreeMusicCard(dir),
      keyboard: buildPlayerPopupKeyboard({ playerPath }),
    };
  }
  if (action === "photos" || action === "photo" || action === "pictures") {
    const { handlePhotosRequest, PHOTOS_PLAYER_PATH } = await import("./photos.js");
    const { vitaPlayerHref } = await import("./url-dir.js");
    const picBytes = photoBytes || compressionBytes;
    const picName = photoName || compressionName || "";
    const picMime = photoMime || compressionMime || "";
    const out = await handlePhotosRequest({
      body,
      bytes: picBytes,
      name: picName,
      mime: picMime,
    });
    if (out?.wantsFile) {
      return {
        ...out,
        awaitUpload: true,
        photos: true,
        playerPath: out.playerPath || PHOTOS_PLAYER_PATH,
        playerHref: out.playerHref || vitaPlayerHref(out.playerPath || PHOTOS_PLAYER_PATH),
      };
    }
    return {
      ...out,
      photos: true,
      playerPath: out.playerPath || PHOTOS_PLAYER_PATH,
      playerHref: out.playerHref || vitaPlayerHref(out.playerPath || PHOTOS_PLAYER_PATH),
    };
  }
  if (action === "board" || action === "pad" || action === "prompt") {
    const {
      formatSoundboardCard,
      playPad,
      resolvePadId,
      createPromptPad,
      addUploadedPad,
      buildSoundboardKeyboard,
      SOUNDBOARD_PLAYER_PATH,
      listCatalogPadIds,
    } = await import("./soundboard.js");
    const { vitaPlayerHref } = await import("./url-dir.js");
    const rest = String(body || "").trim();
    if (action === "prompt") {
      if (!rest) {
        return {
          ok: false,
          phase: "prompt",
          reply: "Usage: /vitafeed prompt saw rise 220→880 0.32s",
        };
      }
      const made = createPromptPad(rest);
      if (!made.ok) {
        return { ok: false, phase: "prompt", reply: made.reason || "prompt failed" };
      }
      const opened = playPad(made.id);
      return {
        ok: true,
        phase: "prompt",
        soundboard: true,
        id: made.id,
        zeroOpenKey: made.zeroOpenKey,
        playerPath: opened.playerPath || SOUNDBOARD_PLAYER_PATH + "?pad=" + made.id,
        playerHref: opened.playerHref || vitaPlayerHref(SOUNDBOARD_PLAYER_PATH + "?pad=" + made.id),
        reply:
          formatSoundboardCard(made.id) +
          "\n\nPROMPT filed · zeroOpenKey=" +
          made.zeroOpenKey +
          "\nEnqueue: /vitafeed enqueue pad " +
          made.id +
          " → confirm|override creates NEW Input Data (class-proof ≠ body)",
        keyboard: buildSoundboardKeyboard({ highlight: made.id }),
      };
    }
    if (action === "pad" || /^(?:play|open|hit)\b/i.test(rest)) {
      const sel = action === "pad" ? rest : rest.replace(/^(?:play|open|hit)\s*/i, "").trim();
      const id = resolvePadId(sel) || sel || "airhorn";
      const opened = playPad(id);
      return {
        ok: opened.ok !== false,
        phase: "play",
        soundboard: true,
        id: opened.id,
        proven: false,
        play: opened.play || null,
        playProof: opened.playProof || null,
        playerPath: opened.playerPath || null,
        playerHref: opened.playerHref || null,
        zeroOpenKey: opened.zeroOpenKey || null,
        reply: opened.reply || opened.reason || "pad miss",
        keyboard: opened.ok
          ? buildSoundboardKeyboard({ highlight: opened.id })
          : buildSoundboardKeyboard(),
      };
    }
    if (/^add\b/i.test(rest)) {
      return {
        ok: true,
        phase: "board",
        soundboard: true,
        reply:
          "Reply to an audio file with /vitafeed board add — bytes → catalog → enqueue pad <id>.\n" +
          "Or upload on /vita/soundboard. Zero-open-key = name+contentCommit.",
        keyboard: buildSoundboardKeyboard(),
        awaitUpload: true,
      };
    }
    const playerPath = SOUNDBOARD_PLAYER_PATH;
    return {
      ok: true,
      phase: "board",
      soundboard: true,
      pads: listCatalogPadIds(),
      playerPath,
      playerHref: vitaPlayerHref(playerPath),
      reply: formatSoundboardCard(rest && resolvePadId(rest) ? resolvePadId(rest) : null),
      keyboard: buildSoundboardKeyboard({
        highlight: rest && resolvePadId(rest) ? resolvePadId(rest) : null,
      }),
    };
  }
  if (action === "spatial" || action === "soundtrack") {
    const {
      formatSpatialCard,
      playSpatial,
      resolveSpatialId,
      createSpatialBite,
      BIRD_PRINTS,
      planSoundtrackFromVoxel,
      playSoundtrack,
      buildSpatialKeyboard,
      SPATIAL_PLAYER_PATH,
      listSpatialBites,
      ensureSpatialSeedBites,
    } = await import("./spatial-sound.js");
    const { vitaPlayerHref } = await import("./url-dir.js");
    ensureSpatialSeedBites();
    const rest = String(body || "").trim();
    if (action === "soundtrack") {
      const plan = playSoundtrack(rest || "0,0,0");
      return {
        ok: plan.ok !== false,
        phase: "soundtrack",
        spatial: true,
        plan,
        playerPath: plan.player || SPATIAL_PLAYER_PATH + "?soundtrack=1&voxel=" + encodeURIComponent(rest || "0,0,0"),
        playerHref: vitaPlayerHref(
          plan.player || SPATIAL_PLAYER_PATH + "?soundtrack=1&voxel=" + encodeURIComponent(rest || "0,0,0"),
        ),
        reply:
          formatSpatialCard() +
          "\n\nSOUNDTRACK voxel=" +
          (rest || "0,0,0") +
          " · bites=" +
          (plan.count || 0) +
          "\n" +
          (plan.note || "") +
          "\nOpen /vita/spatial?soundtrack=1&voxel=" +
          (rest || "0,0,0"),
        keyboard: buildSpatialKeyboard(),
      };
    }
    if (/^new\b/i.test(rest)) {
      const parts = rest.replace(/^new\s*/i, "").trim().split(/\s+/);
      const printId = parts[0] && BIRD_PRINTS[parts[0]] ? parts[0] : "bird.sparrow.a";
      const x = Number(parts[1] ?? 0) || 0;
      const y = Number(parts[2] ?? 0) || 0;
      const z = Number(parts[3] ?? 0) || 0;
      const made = createSpatialBite({ printId, x, y, z });
      if (!made.ok) {
        return { ok: false, phase: "spatial", reply: made.reason || "create failed" };
      }
      const opened = playSpatial(made.packed?.id || made.meta?.id);
      return {
        ok: true,
        phase: "spatial",
        spatial: true,
        id: made.meta?.id,
        oneBlock: made.packed?.oneBlock,
        zeroOpenKey: made.packed?.zeroOpenKey,
        playerPath: opened.playerPath,
        playerHref: opened.playerHref,
        inject: opened.inject,
        reply:
          formatSpatialCard(made.meta?.id) +
          "\n\nFiled · oneBlock=" +
          (made.packed?.oneBlock ? "YES" : "NO") +
          " · Enqueue: /vitafeed enqueue spatial " +
          made.meta?.id,
        keyboard: buildSpatialKeyboard({ highlight: made.meta?.id }),
      };
    }
    if (rest) {
      const id = resolveSpatialId(rest.replace(/^(?:play|open|hit|bird)\s*/i, "").trim()) || rest;
      const opened = playSpatial(id);
      return {
        ok: opened.ok !== false,
        phase: "play",
        spatial: true,
        id: opened.id,
        proven: opened.proven,
        inject: opened.inject,
        play: opened.play,
        playerPath: opened.playerPath,
        playerHref: opened.playerHref,
        zeroOpenKey: opened.zeroOpenKey,
        reply: opened.reply || opened.reason || "spatial miss",
        keyboard: buildSpatialKeyboard({ highlight: opened.id }),
      };
    }
    const playerPath = SPATIAL_PLAYER_PATH;
    return {
      ok: true,
      phase: "spatial",
      spatial: true,
      bites: Object.keys(listSpatialBites()),
      playerPath,
      playerHref: vitaPlayerHref(playerPath),
      reply: formatSpatialCard(),
      keyboard: buildSpatialKeyboard(),
    };
  }
  if (action === "kids") {
    const {
      formatKidsDirCard,
      loadUrlDirectory,
      playKidsDirectory,
    } = await import("./url-dir.js");
    const rest = String(body || "").trim();
    if (/^\d+$/.test(rest)) {
      const { buildPlayerPopupKeyboard } = await import("./telegram-clickthrough.js");
      const opened = playKidsDirectory("kids " + rest);
      return {
        ok: opened.ok !== false,
        phase: "play",
        n: opened.n,
        play: opened.play || null,
        playProof: opened.ok
          ? { play: opened.play, complete: true, card: opened.reply }
          : null,
        playerPath: opened.playerPath || null,
        playerHref: opened.playerHref || null,
        reply: opened.reply || opened.reason || "open failed",
        keyboard: opened.ok
          ? buildPlayerPopupKeyboard({ playerPath: opened.playerPath })
          : undefined,
      };
    }
    const dir = loadUrlDirectory("kids");
    const playerPath = "/vita/kids-player?dir=kids";
    const { buildPlayerPopupKeyboard } = await import("./telegram-clickthrough.js");
    return {
      ok: dir.ok !== false,
      phase: "kids",
      directory: dir.ok ? { id: dir.id, count: dir.count, player: dir.player } : null,
      playerPath,
      playerHref: (await import("./url-dir.js")).vitaPlayerHref(playerPath),
      reply: formatKidsDirCard(dir),
      keyboard: buildPlayerPopupKeyboard({ playerPath }),
    };
  }
  if (action === "dir") {
    const {
      listMasterDirectory,
      listSubDirectory,
      formatMasterDirCard,
      formatSubDirCard,
      formatDirStatsCard,
      directoryStats,
    } = await import("./vita-dir.js");
    const {
      buildDirMasterKeyboard,
      buildDirSubKeyboard,
    } = await import("./telegram-clickthrough.js");
    const arg = String(body || "").trim();
    if (!arg) {
      const master = listMasterDirectory();
      return {
        ok: true,
        phase: "dir",
        master,
        reply:
          formatMasterDirCard(master) +
          "\n\n" +
          formatDirStatsCard(directoryStats()),
        keyboard: buildDirMasterKeyboard(master),
      };
    }
    const listed = listSubDirectory(arg);
    return {
      ok: listed.ok !== false,
      phase: "dir",
      listed,
      reply: formatSubDirCard(listed),
      keyboard: listed.ok !== false ? buildDirSubKeyboard(listed) : buildDirMasterKeyboard(),
    };
  }
  if (action === "unlock") {
    const { unlockDirectoryEntry, formatUnlockCard } = await import("./vita-dir.js");
    const {
      buildUnlockKeyboard,
      buildDirMasterKeyboard,
      timeDualRoutes,
    } = await import("./telegram-clickthrough.js");
    const sel = String(body || "").trim();
    const unlocked = unlockDirectoryEntry(sel);
    const timing = unlocked.ok
      ? timeDualRoutes({
          english: unlocked.reveal?.english,
          machine: unlocked.reveal?.machine,
          packed: unlocked.packed,
        })
      : null;
    return {
      ok: unlocked.ok,
      phase: "unlock",
      unlocked,
      timing,
      reply: formatUnlockCard(unlocked, { timing }),
      keyboard: unlocked.ok ? buildUnlockKeyboard(unlocked) : buildDirMasterKeyboard(),
    };
  }
  if (action === "track") {
    const {
      buildTrackInjectBody,
      buildVitaFeedStagedKeyboard,
      timeDualRoutes,
      CLICKTHROUGH_MAGIC,
    } = await import("./telegram-clickthrough.js");
    const { buildMachineLaneBody } = await import("./vita-feed-dual.js");
    const trackBody = buildTrackInjectBody({
      symbol: String(body || "").split(/\s+/)[0] || "",
      note: String(body || "").trim() || undefined,
    });
    const machine = buildMachineLaneBody(trackBody);
    const timing = timeDualRoutes({
      english: trackBody,
      machine: machine.machine || machine.body,
      packed: machine.packed,
    });
    const prepared = prepareVitaFeed(trackBody, quotes);
    const staged = stageVitaFeed(chatId, {
      body: trackBody,
      prepared,
      quotes: resolveVitaFeedQuotes(quotes),
      source: "track",
      dual: machine.ok ? machine : null,
      timing,
    });
    const cost = estimateVitaFeedCost(prepared, resolveVitaFeedQuotes(quotes));
    const lines = [
      CLICKTHROUGH_MAGIC + " TRACK INJECT",
      "Staged click-through proof body (message + running code path).",
      "timing human=" + timing.humanMs + "ms machine=" + timing.machineMs + "ms",
      "plainProof=YES · snarkDenser=" + (timing.snarkUnlocksDenser ? "YES" : "no"),
      "HUMAN bytes=" + timing.humanBytes + " · MACHINE bytes=" + timing.machineBytes,
      "",
      formatVitaFeedCostCard(cost, prepared),
      "",
      "Next: tap Confirm or Override — never invents tx hashes.",
      "After seal: Basescan Input Data → UTF-8 is the chat proof.",
    ];
    return {
      ok: true,
      phase: "track",
      staged: true,
      pending: staged,
      prepared,
      timing,
      reply: lines.join("\n"),
      keyboard: buildVitaFeedStagedKeyboard(),
    };
  }
  if (action === "backlog") {
    const {
      listFeedBacklog,
      formatFeedBacklogCard,
      formatFeedBacklogGrowthProof,
    } = await import("./vita-feed-backlog.js");
    const list = listFeedBacklog({ limit: 40 });
    return {
      ok: true,
      phase: "backlog",
      growth: list.growth,
      items: list.items,
      reply:
        formatFeedBacklogCard(list) +
        "\n\n" + formatFeedBacklogGrowthProof() +
        "\n\nSeed: /vitafeed enqueue seed  ·  Drain: /vitafeed next",
    };
  }
  if (action === "enqueue") {
    const {
      seedFeedBacklogFromMemory,
      enqueueFeedBacklogItem,
      formatFeedBacklogCard,
      buildMemoryTopicFeedBody,
    } = await import("./vita-feed-backlog.js");
    const { readFileSync, existsSync } = await import("node:fs");
    const { join, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const arg = String(body || "").trim().toLowerCase();
    let result;
    const {
      enqueueFreeMusicGroups,
      enqueueFreeMusicLibrary,
      resolveSongId,
      isMusicLibraryEnqueue,
    } = await import("./free-music.js");
    if (isMusicLibraryEnqueue(arg)) {
      const { enqueueFeedBacklogItem, formatFeedBacklogCard } = await import("./vita-feed-backlog.js");
      const queued = enqueueFreeMusicLibrary({
        enqueueFn: enqueueFeedBacklogItem,
        includeManifest: true,
      });
      return {
        ok: queued.ok !== false,
        phase: "enqueue",
        added: queued.added || 0,
        skipped: queued.skipped || 0,
        music: true,
        library: true,
        songIds: queued.ids,
        groupCount: queued.groupCount,
        totalVin: queued.totalVin,
        reply:
          formatFeedBacklogCard() +
          "\n\nMUSIC LIBRARY grouped enqueue +" +
          (queued.added || 0) +
          " · skipped " +
          (queued.skipped || 0) +
          " · songs " +
          (queued.songCount || 0) +
          " · groups " +
          (queued.groupCount || 0) +
          " · VIN " +
          (queued.totalVin || 0) +
          "\n" +
          (queued.note || "") +
          "\n\nNext: /vitafeed next → /vitafeed confirm|override (one group per hourly cap)." +
          "\nVITAFEED_PAID stays default OFF. /vitafeed enqueue all is still memory seed.",
      };
    }
    {
      const {
        resolvePhotoEnqueueTarget,
        enqueuePhoto,
        enqueuePhotosLibrary,
      } = await import("./photos.js");
      const photoTarget = resolvePhotoEnqueueTarget(arg);
      if (photoTarget?.kind === "library") {
        const { enqueueFeedBacklogItem, formatFeedBacklogCard } = await import("./vita-feed-backlog.js");
        const queued = enqueuePhotosLibrary({ enqueueFn: enqueueFeedBacklogItem });
        return {
          ok: queued.ok !== false,
          phase: "enqueue",
          photos: true,
          library: true,
          added: queued.added || 0,
          ids: queued.ids,
          reply:
            formatFeedBacklogCard() +
            "\n\nPHOTOS library enqueue +" +
            (queued.added || 0) +
            " pictures\nNext: /vitafeed next → confirm|override — NEW photo Input Data (class-proof ≠ body)",
        };
      }
      if (photoTarget?.kind === "photo") {
        const { enqueueFeedBacklogItem, formatFeedBacklogCard } = await import("./vita-feed-backlog.js");
        const queued = enqueuePhoto({
          enqueueFn: enqueueFeedBacklogItem,
          id: photoTarget.id,
        });
        return {
          ok: queued.ok !== false,
          phase: "enqueue",
          photos: true,
          id: photoTarget.id,
          added: queued.added || 0,
          zeroOpenKey: queued.packed?.zeroOpenKey,
          reply:
            formatFeedBacklogCard() +
            "\n\nPHOTO " +
            photoTarget.id +
            " enqueue +" +
            (queued.added || 0) +
            " group(s)\nOpen key: " +
            (queued.packed?.zeroOpenKey || "—") +
            "\n" +
            (queued.note || "") +
            "\nNext: /vitafeed next → confirm|override. Locs empty until real seal.",
        };
      }
    }
    {
      const {
        resolveBoardEnqueueTarget,
        enqueuePad,
        enqueueBoardLibrary,
        padDualHumanBody,
        padMachineLine,
        packetizePad,
      } = await import("./soundboard.js");
      const boardTarget = resolveBoardEnqueueTarget(arg);
      if (boardTarget?.kind === "library") {
        const { enqueueFeedBacklogItem, formatFeedBacklogCard } = await import("./vita-feed-backlog.js");
        const queued = enqueueBoardLibrary({ enqueueFn: enqueueFeedBacklogItem });
        return {
          ok: queued.ok !== false,
          phase: "enqueue",
          soundboard: true,
          library: true,
          added: queued.added || 0,
          ids: queued.ids,
          reply:
            formatFeedBacklogCard() +
            "\n\nSOUNDBOARD library enqueue +" +
            (queued.added || 0) +
            " pads\nNext: /vitafeed next → confirm|override — NEW pad Input Data (class-proof ≠ body)",
        };
      }
      if (boardTarget?.kind === "pad") {
        const { enqueueFeedBacklogItem, formatFeedBacklogCard } = await import("./vita-feed-backlog.js");
        const queued = enqueuePad({
          enqueueFn: enqueueFeedBacklogItem,
          id: boardTarget.id,
        });
        try {
          const { routeTransmission } = await import("./chain-dir.js");
          const packed = packetizePad(boardTarget.id);
          if (packed.ok) {
            routeTransmission({
              name: "board-" + packed.id,
              humanBody: padDualHumanBody(packed, packed.id),
              machineBody: padMachineLine(packed, packed.id),
            });
          }
        } catch { /* best-effort */ }
        return {
          ok: queued.ok !== false,
          phase: "enqueue",
          soundboard: true,
          id: boardTarget.id,
          added: queued.added || 0,
          zeroOpenKey: queued.packed?.zeroOpenKey,
          reply:
            formatFeedBacklogCard() +
            "\n\nPAD " +
            boardTarget.id +
            " enqueue +" +
            (queued.added || 0) +
            " group(s) · key=" +
            (queued.packed?.zeroOpenKey || "—") +
            "\n" +
            (queued.note || "") +
            "\nNext: /vitafeed next → confirm|override",
        };
      }
    }
    {
      const {
        resolveSpatialEnqueueTarget,
        enqueueSpatial,
        enqueueSpatialLibrary,
        packetizeSpatial,
        formatSpatialCard,
      } = await import("./spatial-sound.js");
      const spatialTarget = resolveSpatialEnqueueTarget(arg);
      if (spatialTarget?.kind === "library") {
        const { enqueueFeedBacklogItem, formatFeedBacklogCard } = await import("./vita-feed-backlog.js");
        const queued = enqueueSpatialLibrary({ enqueueFn: enqueueFeedBacklogItem });
        return {
          ok: queued.ok !== false,
          phase: "enqueue",
          spatial: true,
          library: true,
          added: queued.added || 0,
          ids: queued.ids,
          reply:
            formatFeedBacklogCard() +
            "\n\nSPATIAL library enqueue +" +
            (queued.added || 0) +
            " one-block bites\nNext: /vitafeed next → confirm|override — Basescan inject proof only after seal",
        };
      }
      if (spatialTarget?.kind === "spatial") {
        const { enqueueFeedBacklogItem, formatFeedBacklogCard } = await import("./vita-feed-backlog.js");
        const queued = enqueueSpatial({
          enqueueFn: enqueueFeedBacklogItem,
          id: spatialTarget.id,
          printId: spatialTarget.printId || null,
        });
        return {
          ok: queued.ok !== false,
          phase: "enqueue",
          spatial: true,
          id: spatialTarget.id,
          oneBlock: queued.packed?.oneBlock,
          zeroOpenKey: queued.packed?.zeroOpenKey,
          added: 1,
          reply:
            formatFeedBacklogCard() +
            "\n\n" +
            formatSpatialCard(spatialTarget.id) +
            "\n\nenqueue " +
            (queued.note || "") +
            "\nNext: /vitafeed next → confirm|override (VITAFEED_PAID=yes for real Basescan tx)",
        };
      }
      if (spatialTarget?.kind === "miss") {
        return {
          ok: false,
          phase: "enqueue",
          reply: spatialTarget.reason || "unknown spatial",
        };
      }
    }
    const songId = arg ? resolveSongId(arg) : null;
    if (songId && arg && arg !== "seed" && arg !== "memory" && arg !== "all" && arg !== "brain") {
      const { enqueueFeedBacklogItem, formatFeedBacklogCard } = await import("./vita-feed-backlog.js");
      const { routeTransmission } = await import("./chain-dir.js");
      const queued = enqueueFreeMusicGroups({
        enqueueFn: enqueueFeedBacklogItem,
        includeManifest: true,
        id: songId,
      });
      try {
        const { musicDualHumanBody, musicMachineGroupsLine, packetizeFreeMusic } = await import("./free-music.js");
        const packed = packetizeFreeMusic(songId);
        if (packed.ok) {
          routeTransmission({
            name: packed.chainDirName || songId,
            humanBody: musicDualHumanBody(packed, songId),
            machineBody: musicMachineGroupsLine(packed, songId),
          });
        }
      } catch { /* routing is best-effort */ }
      return {
        ok: queued.ok !== false,
        phase: "enqueue",
        added: queued.added || 0,
        skipped: queued.skipped || 0,
        music: true,
        songId,
        groupCount: queued.groupCount,
        totalVin: queued.totalVin,
        reply:
          formatFeedBacklogCard() +
          "\n\n" + String(songId).toUpperCase() + " grouped enqueue +" +
          (queued.added || 0) +
          " · skipped " +
          (queued.skipped || 0) +
          " · groups " +
          (queued.groupCount || 0) +
          " · VIN " +
          (queued.totalVin || 0) +
          "\n" +
          (queued.note || "") +
          "\n\nNext: /vitafeed next → /vitafeed confirm|override (one group per hourly cap).",
      };
    }
    if (!arg || arg === "seed" || arg === "all" || arg === "memory") {
      result = seedFeedBacklogFromMemory({
        includeBrainSeed: true,
        includeTopics: true,
        maxTopics: arg === "all" ? 48 : 24,
      });
    } else if (arg === "brain" || arg === "brain-seed") {
      const { buildBrainSeedBody } = await import("./brain-seed.js");
      result = enqueueFeedBacklogItem({
        body: buildBrainSeedBody(),
        topic: "brain-seed",
        name: "brain-seed.txt",
        kind: "brain",
        source: "enqueue-brain",
      });
      result.card = formatFeedBacklogCard();
    } else {
      const memDir = join(dirname(fileURLToPath(import.meta.url)), "memory");
      const topic = arg.replace(/\.json$/i, "");
      const path = join(memDir, topic + ".json");
      if (!existsSync(path)) {
        return {
          ok: false,
          phase: "enqueue",
          reply: "VITAFEED ENQUEUE: no memory topic " + topic + "\nTry: /vitafeed enqueue seed",
        };
      }
      let obj;
      try {
        obj = JSON.parse(readFileSync(path, "utf8"));
      } catch (e) {
        return { ok: false, phase: "enqueue", reply: "bad json: " + (e.message || e) };
      }
      result = enqueueFeedBacklogItem({
        body: buildMemoryTopicFeedBody(topic, obj),
        topic,
        name: topic + ".txt",
        kind: "plain",
        source: "enqueue-topic",
      });
      result.card = formatFeedBacklogCard();
    }
    return {
      ok: result.ok !== false,
      phase: "enqueue",
      added: result.added ?? (result.item && !result.deduped ? 1 : 0),
      growth: result.growth,
      reply:
        (result.card || formatFeedBacklogCard()) +
        (result.added != null
          ? "\n\nenqueued +" + result.added + " · skipped " + (result.skipped || 0)
          : result.deduped
            ? "\n\ndeduped — already on backlog"
            : result.item
              ? "\n\nenqueued " + result.item.id
              : "") +
        "\n\nNext: /vitafeed next → /vitafeed override",
    };
  }
  if (action === "next") {
    const {
      takeNextFeedBacklogForStage,
      formatFeedBacklogCard,
    } = await import("./vita-feed-backlog.js");
    const taken = takeNextFeedBacklogForStage();
    if (!taken.ok) {
      return {
        ok: false,
        phase: "next",
        reply: (taken.reason || "backlog empty") + "\n\n" + formatFeedBacklogCard(),
      };
    }
    const prepared = prepareVitaFeed(taken.body);
    if (!prepared.ok) {
      return {
        ok: false,
        phase: "next",
        reply: prepared.reason || "prepare failed for backlog item " + taken.backlogId,
      };
    }
    const cost = estimateVitaFeedCost(prepared, quotes);
    const buyIn = planVitaFeedBuyIns({ prepared, cost, seats, quotes });
    stageVitaFeed(chatId, {
      prepared,
      cost,
      body: taken.body,
      quotes,
      buyIn,
      seats,
      backlogId: taken.backlogId,
      backlogItem: taken.item,
    });
    return {
      ok: true,
      phase: "before",
      staged: true,
      prepared,
      cost,
      buyIn,
      backlogId: taken.backlogId,
      backlogItem: taken.item,
      reply:
        "VITAFEED NEXT · " + taken.backlogId + " · " + (taken.item?.name || "?") +
        " · " + (taken.item?.chunks || "?") + " chunks\n" +
        formatFeedBacklogCard() +
        "\n\n" +
        formatVitaFeedCostCard(cost, prepared, { phase: "before" }) +
        "\n\n" + formatVitaFeedBuyInCard(buyIn) +
        "\n\nNext: /vitafeed override (or confirm) — then /vitafeed next again",
    };
  }
  // Named library — list / open / stage keys catalog (lazy import avoids cycle).
  if (action === "files") {
    const { formatLibraryListCard, listLibraryEntries } = await import("./vita-feed-library.js");
    const { buildLibraryFilesKeyboard } = await import("./telegram-clickthrough.js");
    const entries = listLibraryEntries();
    return {
      ok: true,
      phase: "files",
      entries,
      reply: formatLibraryListCard(),
      keyboard: buildLibraryFilesKeyboard(entries),
    };
  }
  if (action === "play") {
    const {
      isKidsPlaySelector,
      isDemoPlaySelector,
      playKidsDirectory,
      demoPlayerOpen,
    } = await import("./url-dir.js");
    const { isMusicPlaySelector, playFreeMusic } = await import("./free-music.js");
    const { isSoundboardPlaySelector, playPad, resolvePadId } = await import("./soundboard.js");
    const { buildPlayerPopupKeyboard } = await import("./telegram-clickthrough.js");
    const { buildSoundboardKeyboard } = await import("./soundboard.js");
    if (isSoundboardPlaySelector(body) && !isMusicPlaySelector(body)) {
      const sel = String(body || "").replace(/^(?:board|soundboard|pads|dj|pad)\s*/i, "").trim() || "airhorn";
      const id = resolvePadId(sel) || (sel === "" || /^(?:board|soundboard|pads|dj)$/i.test(String(body || "")) ? "airhorn" : sel);
      if (/^(?:board|soundboard|pads|dj)$/i.test(String(body || "").trim())) {
        const { formatSoundboardCard, SOUNDBOARD_PLAYER_PATH } = await import("./soundboard.js");
        const { vitaPlayerHref } = await import("./url-dir.js");
        return {
          ok: true,
          phase: "board",
          soundboard: true,
          playerPath: SOUNDBOARD_PLAYER_PATH,
          playerHref: vitaPlayerHref(SOUNDBOARD_PLAYER_PATH),
          reply: formatSoundboardCard(),
          keyboard: buildSoundboardKeyboard(),
        };
      }
      const opened = playPad(id);
      return {
        ok: opened.ok !== false,
        phase: "play",
        soundboard: true,
        id: opened.id,
        play: opened.play || null,
        playProof: opened.playProof || null,
        playerPath: opened.playerPath || null,
        playerHref: opened.playerHref || null,
        zeroOpenKey: opened.zeroOpenKey || null,
        reply: opened.reply || opened.reason || "open failed",
        keyboard: opened.ok
          ? buildSoundboardKeyboard({ highlight: opened.id })
          : undefined,
      };
    }
    if (isMusicPlaySelector(body)) {
      const opened = playFreeMusic(body);
      return {
        ok: opened.ok !== false,
        phase: "play",
        music: true,
        proven: opened.proven === true,
        play: opened.play || null,
        playProof: opened.playProof || null,
        playerPath: opened.playerPath || null,
        playerHref: opened.playerHref || null,
        reply: opened.reply || opened.reason || "open failed",
        keyboard: opened.ok
          ? buildPlayerPopupKeyboard({ playerPath: opened.playerPath })
          : undefined,
      };
    }
    if (isDemoPlaySelector(body)) {
      const opened = demoPlayerOpen();
      return {
        ok: true,
        phase: "play",
        demo: true,
        play: opened.play,
        playerPath: opened.playerPath,
        playerHref: opened.playerHref,
        reply: opened.reply,
        keyboard: buildPlayerPopupKeyboard({ playerPath: opened.playerPath, includeDemo: false }),
      };
    }
    if (isKidsPlaySelector(body)) {
      const opened = playKidsDirectory(body);
      return {
        ok: opened.ok !== false,
        phase: "play",
        n: opened.n,
        play: opened.play || null,
        playProof: opened.ok
          ? { play: opened.play, complete: true, card: opened.reply }
          : null,
        playerPath: opened.playerPath || null,
        playerHref: opened.playerHref || null,
        reply: opened.reply || opened.reason || "open failed",
        keyboard: opened.ok
          ? buildPlayerPopupKeyboard({ playerPath: opened.playerPath })
          : undefined,
      };
    }
    const { playFromLibrary } = await import("./vita-feed-library.js");
    const { vitaPlayerHref } = await import("./url-dir.js");
    const opened = await playFromLibrary(body, { label: "LIBRARY" });
    const playerHref = opened.playerPath ? vitaPlayerHref(opened.playerPath) : null;
    return {
      ok: opened.ok !== false,
      phase: "play",
      n: opened.n,
      entry: opened.entry || null,
      playProof: opened.playProof || null,
      playerPath: opened.playerPath || null,
      playerHref,
      reply: opened.reply || opened.reason || "open failed",
      keyboard: opened.playerPath
        ? buildPlayerPopupKeyboard({ playerPath: opened.playerPath })
        : undefined,
    };
  }
  if (action === "keys") {
    const {
      prepareKeysCatalogFeed,
      formatKeysCatalogCard,
      encodeKeysCatalogBody,
    } = await import("./vita-feed-library.js");
    const prepared = prepareKeysCatalogFeed();
    if (!prepared.ok) {
      return {
        ok: false,
        phase: "keys",
        reply: prepared.reason || "keys catalog empty",
      };
    }
    const enc = encodeKeysCatalogBody({ libId: prepared.keysCatalog?.libId });
    const cost = estimateVitaFeedCost(prepared, quotes);
    const buyIn = planVitaFeedBuyIns({ prepared, cost, seats, quotes });
    stageVitaFeed(chatId, {
      prepared,
      cost,
      body: enc.body,
      quotes,
      buyIn,
      seats,
      keysCatalog: prepared.keysCatalog,
    });
    return {
      ok: true,
      phase: "before",
      staged: true,
      prepared,
      cost,
      buyIn,
      keysCatalog: prepared.keysCatalog,
      reply:
        formatKeysCatalogCard(enc) +
        "\n\n" +
        formatVitaFeedCostCard(cost, prepared, { phase: "before" }) +
        "\n\n" + formatVitaFeedBuyInCard(buyIn),
    };
  }
  if (action === "compress") {
    const { handleCompressionRequest } = await import("./compression/index.js");
    const out = handleCompressionRequest({
      body,
      bytes: compressionBytes,
      name: compressionName,
      mime: compressionMime,
    }, compressionOpts || {});
    let reply = out.reply || out.reason || "";
    let staged = false;
    let prepared = null;
    let cost = null;
    let buyIn = null;
    if (out.stageBody) {
      prepared = prepareVitaFeed(out.stageBody);
      if (prepared.ok) {
        cost = estimateVitaFeedCost(prepared, quotes);
        buyIn = planVitaFeedBuyIns({ prepared, cost, seats, quotes });
        stageVitaFeed(chatId, {
          prepared,
          cost,
          body: out.stageBody,
          quotes,
          buyIn,
          seats,
          compressionKey: out.key || out.entry?.key || null,
        });
        staged = true;
        reply += "\n\n" + formatVitaFeedCostCard(cost, prepared, { phase: "before" });
        reply += "\n\nInjection staged. Paid path stays off until /vitafeed confirm and VITAFEED_PAID=yes.";
      } else {
        reply += "\n\ninject stage refused: " + (prepared.reason || "prepare failed");
      }
    }
    return {
      ok: out.ok !== false,
      phase: "compress",
      call: out.call || (out.verified ? "verified" : out.wantsFile ? "waiting" : "refused"),
      verified: out.verified === true,
      answer: out.answer === true,
      recovered: out.recovered === true,
      key: out.key || out.entry?.key || "",
      codec: out.codec || out.entry?.codec || "",
      staged,
      prepared,
      cost,
      buyIn,
      wantsFile: out.wantsFile === true,
      chainStatus: "availability",
      locations: [],
      neverInventHashes: true,
      proofLog: out.proofLog || null,
      reply,
      keyboard: out.keyboard,
    };
  }
  if (action === "log" || action === "trail") {
    const { handleProofLogRequest } = await import("./proof-log.js");
    const out = handleProofLogRequest({ body }, compressionOpts?.proofLog || {});
    return {
      ok: out.ok !== false,
      phase: "log",
      tab: out.tab || null,
      entry: out.entry || null,
      trail: out.trail || null,
      neverInventHashes: true,
      reply: out.reply || out.reason || "",
      keyboard: out.keyboard,
    };
  }
  if (action === "preview") {
    const prepared = prepareVitaFeed(body);
    if (!prepared.ok) {
      return { ok: false, phase: "preview", reply: vitaFeedUsageText() + "\n" + (prepared.reason || "") };
    }
    const cost = estimateVitaFeedCost(prepared, quotes);
    const buyIn = planVitaFeedBuyIns({ prepared, cost, seats, quotes });
    stageVitaFeed(chatId, { prepared, cost, body, quotes, buyIn, seats });
    return {
      ok: true,
      phase: "before",
      staged: true,
      prepared,
      cost,
      buyIn,
      reply:
        formatVitaFeedCostCard(cost, prepared, { phase: "before" }) +
        "\n\n" + formatVitaFeedBuyInCard(buyIn),
    };
  }
  // confirm = normal paid path; override = same path but skip RISK balance REFUSE
  if (action === "confirm" || action === "override") {
    const override = forceOverride === true || action === "override";
    const row = peekVitaFeed(chatId);
    if (!maySendVitaFeed({ confirmed: true, pendingRow: row })) {
      return {
        ok: false,
        phase: override ? "override" : "confirm",
        reply: "VITAFEED: nothing staged. Send /vitafeed [text] (or reply) for a cost card first.",
      };
    }
    const chunkCount = row.prepared.totalChunks || row.prepared.lines?.length || 1;
    const thrift = evaluateVitaFeedThriftGate({
      action: override ? "override" : "confirm",
      chatId,
      env,
      liquidUsd,
      chunkCount,
      now,
      messageAtMs,
      forceOverride: override,
      forceLatch: forceLatch === true,
      skipCooldown: Boolean(override && row.resume),
    });
    if (!thrift.ok) {
      const quotesNowEarly = Object.keys(quotes || {}).length ? quotes : (row.quotes || {});
      const costEarly = estimateVitaFeedCost(row.prepared, quotesNowEarly);
      return {
        ok: false,
        phase: override ? "override" : "confirm",
        thrift: thrift.code,
        send: false,
        prepared: row.prepared,
        cost: costEarly,
        buyIn: row.buyIn || null,
        reply: thrift.reply,
      };
    }
    const quotesNow = Object.keys(quotes || {}).length ? quotes : (row.quotes || {});
    const seatsNow = (seats && seats.length) ? seats : (row.seats || []);
    const cost = estimateVitaFeedCost(row.prepared, quotesNow);
    // Reuse the wrap plan shown on the cost card so confirm buys the same
    // tokens + range % the operator already reviewed.
    const buyIn = (row.buyIn && row.buyIn.ok)
      ? row.buyIn
      : planVitaFeedBuyIns({
          prepared: row.prepared,
          cost,
          seats: seatsNow,
          quotes: quotesNow,
        });
    // Inscription + buy-in stake + gas — refuse if RISK cannot fund token buys
    // for each wrap (leave ≥$0.25 behind) together with the message path.
    // Agent buys first then sets reserveBuyStake=false so stake is not double-counted.
    // /vitafeed override skips this REFUSE and proceeds despite underfunded RISK.
    const stakeEth = (reserveBuyStake !== false && buyIn?.ok)
      ? Math.max(0, Number(buyIn.totalStakeEth) || 0)
      : 0;
    const need = (cost.totalEth || 0) + stakeEth + Number(gasReserveEth || 0);
    let overrideNote = "";
    if (riskBalanceEth != null && Number(riskBalanceEth) < need) {
      if (!override) {
        return {
          ok: false,
          phase: "confirm",
          prepared: row.prepared,
          cost,
          buyIn,
          reply:
            "VITAFEED REFUSE — RISK ETH " + Number(riskBalanceEth).toFixed(6) +
            " < need " + need.toFixed(6) +
            " (inscription " + Number(cost.totalEth || 0).toFixed(6) +
            (stakeEth > 0 ? " + buy-in stake " + stakeEth.toFixed(6) : " (buy-in already reserved)") +
            " + gas reserve). Vault/save never spend.\n" +
            "Use /vitafeed override to proceed anyway.",
        };
      }
      overrideNote =
        "VITAFEED OVERRIDE — proceeding despite RISK ETH " +
        Number(riskBalanceEth).toFixed(6) + " < need " + need.toFixed(6) +
        " (inscription + buy-in + gas). Sends what gas allows; remainder restaged.";
    }
    if (liquidUsd != null && Number.isFinite(Number(liquidUsd))) {
      const floor = vitaFeedMinLiquidUsd(env);
      if (override && floor > 0 && Number(liquidUsd) < floor) {
        overrideNote =
          (overrideNote ? overrideNote + "\n" : "") +
          "VITAFEED OVERRIDE — liquid ≈ $" + Number(liquidUsd).toFixed(2) +
          " < floor $" + Number(floor).toFixed(2) +
          "; money floor bypassed. Partial seal OK.";
      }
    }
    if (typeof sendTx !== "function") {
      return {
        ok: false,
        phase: override ? "override" : "confirm",
        prepared: row.prepared,
        cost,
        buyIn,
        reply:
          formatVitaFeedCostCard(cost, row.prepared, { phase: "after" }) +
          "\n\n" + formatVitaFeedBuyInCard(buyIn) +
          (overrideNote ? "\n\n" + overrideNote : "") +
          "\nPaid RISK path needs a sender (Telegram /vitafeed confirm|override on the live bot).",
      };
    }
    noteVitaFeedPaidSend({ chatId, chunks: chunkCount, now });
    const result = await runVitaFeedInscribe(row.prepared, sendTx);
    // Dual lane: after HUMAN seals (or partial), also seal MACHINE when staged.
    let machineResult = null;
    let dualReceiptExtra = "";
    if (row.dual && row.machinePrepared?.ok && typeof sendTx === "function") {
      const humanSealed = Number(result?.sealedCount || 0) > 0;
      if (humanSealed && !result?.banked) {
        // Full human seal — continue with machine lane.
        machineResult = await runVitaFeedInscribe(row.machinePrepared, sendTx);
      } else if (humanSealed && result?.banked) {
        // Partial human — do not start machine until human completes.
        dualReceiptExtra =
          "\n\nVITADUAL: HUMAN partial — MACHINE held until HUMAN finishes" +
          " (/vitafeed override again).";
      }
    }
    // Partial seal: restage remainder so override can continue when funded.
    // Full seal or zero progress with no remainder: clear / keep as appropriate.
    let restaged = false;
    if (result?.banked && result.remainingBody) {
      const nextPrepared = prepareVitaFeed(result.remainingBody);
      if (nextPrepared.ok) {
        const nextCost = estimateVitaFeedCost(nextPrepared, quotesNow);
        const nextBuyIn = planVitaFeedBuyIns({
          prepared: nextPrepared,
          cost: nextCost,
          seats: seatsNow,
          quotes: quotesNow,
        });
        stageVitaFeed(chatId, {
          prepared: nextPrepared,
          cost: nextCost,
          body: result.remainingBody,
          quotes: quotesNow,
          buyIn: nextBuyIn,
          seats: seatsNow,
          backlogId: row.backlogId || null,
          backlogItem: row.backlogItem || null,
          dual: Boolean(row.dual),
          dualCompare: row.dualCompare || null,
          machineBody: row.machineBody || null,
          machinePrepared: row.machinePrepared || null,
          resume: {
            priorVinId: row.prepared.vinId,
            priorLocations: result.priorLocations || [],
            sealedCount: result.sealedCount,
            stopReason: result.stopReason,
          },
        });
        restaged = true;
      } else {
        takeVitaFeed(chatId);
      }
    } else if (result?.sealedCount === 0 && result?.banked) {
      // Nothing landed — keep original staged for retry.
      restaged = false;
    } else {
      takeVitaFeed(chatId);
    }
    // Lazy import — avoid ESM cycle (player → file → feed).
    const { playProofFromInscribeResult } = await import("./vita-feed-player.js");
    const playProof = playProofFromInscribeResult(result, {
      body: row.body || null,
      label: override ? "OVERRIDE" : "LIVE",
    });
    if (result && typeof result === "object") {
      result.playProof = playProof;
      result.restaged = restaged;
    }
    // Auto-save name + reader key + locations into the keys library.
    let librarySave = null;
    try {
      const { saveLibraryFromSeal } = await import("./vita-feed-library.js");
      if (result?.strand && (result.sealedCount > 0 || playProof?.complete)) {
        librarySave = saveLibraryFromSeal({
          strand: result.strand,
          body: row.body || null,
          chatId,
          playProof,
        });
        if (librarySave?.ok && result && typeof result === "object") {
          result.library = librarySave;
        }
      }
      if (
        machineResult?.strand &&
        Number(machineResult.sealedCount || 0) > 0
      ) {
        const machineLib = saveLibraryFromSeal({
          strand: machineResult.strand,
          body: row.machineBody || null,
          chatId,
        });
        if (machineLib?.ok && machineResult && typeof machineResult === "object") {
          machineResult.library = machineLib;
        }
      }
    } catch { /* library is best-effort — never block seal receipt */ }
    // Backlog growth proof — record real sealed locs when this stage came from queue/brain.
    let backlogSeal = null;
    try {
      if (row.backlogId && result?.sealedCount > 0) {
        const { markFeedBacklogSeal, formatFeedBacklogCard } =
          await import("./vita-feed-backlog.js");
        const locs = (result.strand?.locations || result.priorLocations || [])
          .map(String)
          .filter((h) => /^0x[0-9a-fA-F]{64}$/.test(h));
        backlogSeal = markFeedBacklogSeal({
          backlogId: row.backlogId,
          locations: locs,
          vinId: result.strand?.vinId || row.prepared?.vinId || null,
          readerKey: result.strand?.readerKey || null,
          partial: Boolean(restaged || result.banked),
          sealedCount: result.sealedCount,
          needed: result.needed,
        });
        if (backlogSeal?.ok) {
          backlogSeal.card = formatFeedBacklogCard();
        }
      }
    } catch { /* backlog seal is best-effort */ }
    // Pad / spatial inject click-through — record real sealed locs only.
    let soundSeal = null;
    try {
      if (result?.sealedCount > 0) {
        const { maybeRecordSoundSeals } = await import("./spatial-sound.js");
        const locs = (result.strand?.locations || result.priorLocations || [])
          .map(String)
          .filter((h) => /^0x[0-9a-fA-F]{64}$/.test(h));
        soundSeal = maybeRecordSoundSeals({
          body: row.body || "",
          backlogItem: row.backlogItem || null,
          locations: locs,
          vinId: result.strand?.vinId || row.prepared?.vinId || null,
          contentCommit: row.prepared?.contentCommit || row.backlogItem?.contentCommit || null,
        });
        if (soundSeal?.ok && result && typeof result === "object") {
          result.soundSeal = soundSeal;
        }
      }
    } catch { /* sound seal is best-effort — never invent hashes */ }
    let chainDirSeal = null;
    try {
      const {
        recordDualSealIntoChainDir,
        formatChainDirCard,
        formatCycleCard,
        guessTransmissionName,
      } = await import("./chain-dir.js");
      const hLocs = (result.strand?.locations || result.priorLocations || [])
        .map(String)
        .filter((h) => /^0x[0-9a-fA-F]{64}$/.test(h));
      const mLocs = (machineResult?.strand?.locations || [])
        .map(String)
        .filter((h) => /^0x[0-9a-fA-F]{64}$/.test(h));
      if (hLocs.length || row.dual) {
        chainDirSeal = recordDualSealIntoChainDir({
          name: guessTransmissionName(row.body || "", row.backlogItem?.name),
          humanBody: row.body || "",
          machineBody: row.machineBody || "",
          humanLocs: hLocs,
          machineLocs: mLocs,
          humanVin: result.strand?.vinId || row.prepared?.vinId,
          machineVin: machineResult?.strand?.vinId,
          humanReaderKey: result.strand?.readerKey,
          machineReaderKey: machineResult?.strand?.readerKey,
          humanPartial: Boolean(restaged || result.banked),
          machinePartial: Boolean(machineResult?.banked),
        });
      }
      if (chainDirSeal?.ok) {
        chainDirSeal.card =
          formatChainDirCard() +
          (chainDirSeal.cycle
            ? "\n\n" + formatCycleCard(chainDirSeal.cycle, chainDirSeal.line)
            : "");
      }
    } catch { /* chain dir seal is best-effort */ }
    const card = formatVitaFeedCostCard(cost, row.prepared, { phase: "after" });
    const receipt = formatVitaFeedReceipt(result, cost);
    const buyCard = formatVitaFeedBuyInCard(buyIn);
    let dualExtra = dualReceiptExtra || "";
    if (row.dual && row.dualCompare) {
      try {
        const { formatDualLaneReceipt, formatDualLaneSideBySideCard } =
          await import("./vita-feed-dual.js");
        dualExtra +=
          "\n\n" +
          formatDualLaneSideBySideCard(row.dualCompare, { phase: "after" }) +
          "\n\n" +
          formatDualLaneReceipt({
            compare: row.dualCompare,
            humanResult: result,
            machineResult,
            humanLocs: result?.strand?.locations || [],
            machineLocs: machineResult?.strand?.locations || [],
          });
      } catch { /* dual card best-effort */ }
    }
    const playExtra = playProof?.card
      ? "\n\n" + playProof.card +
        (playProof.complete && playProof.play
          ? "\nOpen /vita/feed-player — locations peaced · ready to play " +
            (playProof.play.name || playProof.play.kind || "blob")
          : "")
      : "";
    const libExtra = librarySave?.ok
      ? "\n\nSAVED #" + librarySave.n + " · " + (librarySave.entry?.name || "?") +
        "\n/vitafeed files  ·  /vitafeed play " + librarySave.n +
        "  ·  /vita/feed-player?lib=" + librarySave.n
      : "";
    const backlogExtra = backlogSeal?.card
      ? "\n\n" + backlogSeal.card +
        (restaged ? "" : "\nDrain more: /vitafeed next")
      : "";
    const soundExtra = soundSeal?.ok
      ? "\n\nINJECT PROOF sealed · Basescan click-through live" +
        (soundSeal.locations?.[0]
          ? "\n" + VITAFEED_BASESCAN_TX + soundSeal.locations[0]
          : "") +
        "\n" + (soundSeal.note || "")
      : "";
    const chainDirExtra = chainDirSeal?.card
      ? "\n\n" + chainDirSeal.card
      : "";
    const resumeExtra = restaged
      ? "\n\nPARTIAL — sealed " + result.sealedCount + "/" + result.needed +
        ". Remainder restaged. /vitafeed override again when RISK has gas."
      : "";
    return {
      ok: result.ok !== false,
      phase: "after",
      prepared: row.prepared,
      cost,
      buyIn,
      result,
      machineResult,
      dual: Boolean(row.dual),
      playProof,
      library: librarySave,
      backlog: backlogSeal,
      soundSeal,
      chainDir: chainDirSeal,
      forcedOverride: override,
      restaged,
      reply:
        (overrideNote ? overrideNote + "\n\n" : "") +
        card + "\n\n" + buyCard + "\n\n" + receipt + dualExtra + playExtra +
        libExtra + backlogExtra + soundExtra + chainDirExtra + resumeExtra,
    };
  }
  return { ok: false, phase: "unknown", reply: vitaFeedUsageText() };
}

/**
 * One-shot boot/desk fire. Stages exact plain VITAFEED_AUTOFIRE_BODY (no BL-
 * backlog block id) then /vitafeed override. Requires VITAFEED_AUTOFIRE=yes and
 * (VITAFEED_PAID=yes or VITAFEED_FORCE=yes). Clears autofire before send so a
 * retry cannot burn twice. Default OFF.
 */
export async function maybeAutofireVitaFeed({
  env = process.env,
  sendTx = null,
  liquidUsd = null,
  riskBalanceEth = null,
  quotes = null,
  chatId = VITAFEED_AUTOFIRE_CHAT_ID,
} = {}) {
  if (!vitaFeedAutofireEnabled(env)) {
    return { ok: true, fired: false, autofire: false, reason: "VITAFEED_AUTOFIRE default off" };
  }
  if (_vitaFeedAutofireSpent) {
    return {
      ok: true,
      fired: false,
      autofire: false,
      reason: "VITAFEED_AUTOFIRE already spent this process — refuse further",
    };
  }
  markVitaFeedAutofireSpent(env);

  const body = vitaFeedAutofireBody(env);
  if (!body) {
    return {
      ok: true,
      fired: false,
      autofire: false,
      reason: "VITAFEED_AUTOFIRE_BODY empty — cleared autofire, no send",
    };
  }
  if (!vitaFeedPaidEnabled(env) && !vitaFeedForceEnabled(env)) {
    return {
      ok: true,
      fired: false,
      autofire: false,
      reason: "VITAFEED_AUTOFIRE needs VITAFEED_PAID=yes or VITAFEED_FORCE=yes — cleared autofire, no send",
    };
  }

  const cid = String(chatId || VITAFEED_AUTOFIRE_CHAT_ID);
  // Plain body only — never wrap with §VITABACKLOG§ / BL- id.
  const preview = await handleVitaFeedAction({
    action: "preview",
    body,
    chatId: cid,
    quotes: quotes || {},
    env,
  });
  if (!preview?.ok && !preview?.staged) {
    return {
      ok: false,
      fired: false,
      autofire: true,
      reason: preview?.reply || "autofire preview failed",
      preview,
    };
  }
  // Strip any accidental backlog id from the staged row.
  const staged = peekVitaFeed(cid);
  if (staged) {
    staged.backlogId = null;
    staged.backlogItem = null;
  }

  const out = await handleVitaFeedAction({
    action: "override",
    chatId: cid,
    env,
    sendTx,
    liquidUsd,
    riskBalanceEth,
    quotes: quotes || {},
    forceOverride: true,
    gasReserveEth: 0,
    reserveBuyStake: false,
  });
  const locs = (out?.result?.strand?.locations || out?.result?.priorLocations || [])
    .map(String)
    .filter((h) => /^0x[0-9a-fA-F]{64}$/.test(h));
  return {
    ...out,
    fired: locs.length > 0 || out?.result?.sealedCount > 0,
    autofire: true,
    plainBody: true,
    backlogId: null,
    locations: locs,
    reason: out?.reply || out?.reason || (locs.length ? "sealed" : "no-hash"),
  };
}
