/**
 * /vitafeed — Storage Token game (plain paid inject from RISK).
 *
 * Thin helper only. Does NOT rewrite vitaSave / inscribeChunk / memory-engine
 * / mainframe / mother-genesis core. Telegram handler may CALL existing
 * sendTransaction after an explicit confirm.
 *
 * Exact UTF-8 body (no summarization, no §SESS§ unless the operator typed it).
 * VIN/tailwind headers sit outside the payload budget so AI readers can follow
 * prev-hash → next-index like a VIN. Cost card first, then `/vitafeed confirm`.
 */

import { createHash, randomBytes } from "node:crypto";
import { formatVitaFeedBuyInCard, planVitaFeedBuyIns } from "./vita-feed-buyin.js";

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

export function resetVitaFeedPending() {
  pending.clear();
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
  return {
    ok: true,
    mode: "plain",
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
    note: "plain UTF-8 — VIN header + verbatim body; RISK pay after confirm",
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
  lines.push("plain UTF-8 (no encode, no §SESS§ unless you typed it)");
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
  lines.push("payer=" + VITAFEED_PAYER + "  vault=never  save-bucket=never");
  if (locs.length) {
    lines.push("locations:");
    locs.forEach((tx, i) => {
      lines.push("  " + (i + 1) + ". " + tx);
      lines.push("     " + VITAFEED_BASESCAN_TX + tx);
    });
  }
  if (s.readerKey) lines.push("reader key: " + s.readerKey);
  if (result?.banked) {
    lines.push("banked " + (result.sealedCount || 0) + "/" + result.needed + " — never invent hashes");
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
  if (/^cancel$/i.test(trimmed)) {
    return { ok: true, action: "cancel", body: "", source: "cancel" };
  }
  return { ok: true, action: "preview", body, source: "args" };
}

export function vitaFeedUsageText() {
  return [
    "usage: /vitafeed [exact plain text]",
    "or reply to a message with /vitafeed",
    "Cost card first (chars/bytes/bits + injections + ETH/$).",
    "Buy-in: low ≤3% of wave + predicted up; stake from character cost;",
    "leave $0.10 AI + $0.10 human + 1.5% tax; sell same % up + cost overlay.",
    "Then /vitafeed confirm — pays RISK only (never vault / save bucket).",
    "/vitafeed cancel drops the staged payload.",
    "Plain UTF-8 → hex calldata. VIN headers link chunks (prev/next).",
    "Max payload/chunk = " + VITAFEED_MAX_CHUNK_BYTES + " bytes (VITAFEED_MAX_CHUNK_BYTES).",
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

/**
 * Send each VIN line via sendTx(hex, line) → txHash | null.
 * Never invents hashes. Caller must already have passed the confirm gate.
 */
export async function runVitaFeedInscribe(prepared, sendTx) {
  if (!prepared?.ok) return prepared;
  const chunks = [];
  const txHashes = [];
  for (const line of prepared.lines) {
    const hex = line.hex || utf8ToHex(line.line);
    const txHash = await sendTx(hex, line);
    if (txHash && !/^0x[0-9a-fA-F]{64}$/.test(String(txHash))) {
      return { ok: false, reason: "sender returned non-hash — refuse invent", chunks, txHashes };
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
      txHash: txHash || null,
      sealed: Boolean(txHash),
      location: txHash || null,
      basescan: txHash ? VITAFEED_BASESCAN_TX + txHash : null,
    });
    if (txHash) txHashes.push(txHash);
  }

  const strand = {
    vinId: prepared.vinId,
    mode: "plain",
    contentCommit: prepared.contentCommit,
    readerKey: prepared.readerKey,
    payer: VITAFEED_PAYER,
    wallet: VITAFEED_WALLET,
    totalChars: prepared.totalChars,
    totalBytes: prepared.totalBytes,
    totalBits: prepared.totalBits,
    totalChunks: prepared.totalChunks,
    inBytes: prepared.totalBytes,
    chunks,
    locations: txHashes.slice(),
    at: new Date().toISOString(),
  };

  return {
    ok: true,
    banked: txHashes.length < prepared.totalChunks,
    sealedCount: txHashes.length,
    needed: prepared.totalChunks,
    strand,
    reason: txHashes.length === prepared.totalChunks
      ? "sealed — every injection returned a real hash"
      : txHashes.length
        ? "partial seal — remaining chunks not hashed (never invent)"
        : "no hashes yet — never invent txs",
  };
}

/**
 * Thin Telegram/HTML action router. Paid send only when confirm + sendTx.
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
} = {}) {
  if (action === "usage") {
    return { ok: true, phase: "usage", reply: vitaFeedUsageText() };
  }
  if (action === "cancel") {
    const had = clearVitaFeed(chatId);
    return {
      ok: true,
      phase: "cancel",
      reply: had ? "VITAFEED cancelled — staged payload dropped. RISK unspent." : "VITAFEED: nothing staged.",
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
  if (action === "confirm") {
    const row = peekVitaFeed(chatId);
    if (!maySendVitaFeed({ confirmed: true, pendingRow: row })) {
      return {
        ok: false,
        phase: "confirm",
        reply: "VITAFEED: nothing staged. Send /vitafeed [text] (or reply) for a cost card first.",
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
    const stakeEth = (reserveBuyStake !== false && buyIn?.ok)
      ? Math.max(0, Number(buyIn.totalStakeEth) || 0)
      : 0;
    const need = (cost.totalEth || 0) + stakeEth + Number(gasReserveEth || 0);
    if (riskBalanceEth != null && Number(riskBalanceEth) < need) {
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
          " + gas reserve). Vault/save never spend.",
      };
    }
    if (typeof sendTx !== "function") {
      return {
        ok: false,
        phase: "confirm",
        prepared: row.prepared,
        cost,
        buyIn,
        reply:
          formatVitaFeedCostCard(cost, row.prepared, { phase: "after" }) +
          "\n\n" + formatVitaFeedBuyInCard(buyIn) +
          "\nPaid RISK path needs a sender (Telegram /vitafeed confirm on the live bot).",
      };
    }
    const result = await runVitaFeedInscribe(row.prepared, sendTx);
    takeVitaFeed(chatId);
    const card = formatVitaFeedCostCard(cost, row.prepared, { phase: "after" });
    const receipt = formatVitaFeedReceipt(result, cost);
    const buyCard = formatVitaFeedBuyInCard(buyIn);
    return {
      ok: result.ok !== false,
      phase: "after",
      prepared: row.prepared,
      cost,
      buyIn,
      result,
      reply: card + "\n\n" + buyCard + "\n\n" + receipt,
    };
  }
  return { ok: false, phase: "unknown", reply: vitaFeedUsageText() };
}
