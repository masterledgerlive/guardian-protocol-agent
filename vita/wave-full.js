/**
 * Full-quote WAVE inject — all 28 least-size Heraclitus shards.
 *
 * New VIN (never pretends the 01/03 thrift VIN is 28). SYM rotates
 * VIRTUAL/CLANKER/AERO like /waveproof. 0-ETH gas-only self-txs.
 * Live only when WAVE_FULL_LIVE=yes (default OFF). Optional
 * WAVE_FULL_AUTOFIRE=yes one-shot boot, then self-clear + disable LIVE.
 * Does NOT enable VITAFEED_PAID / WAVE_MIRROR_PAID. Does NOT change
 * /waveproof (still capped at 3). Mother brain untouched.
 * Never invents tx hashes. LOSE-ZERO: no ALLOW_LOSSY sells. Vault never.
 */

import {
  WAVE_MIN_BODY_BYTES,
  WAVE_WISE_MESSAGE,
  WAVE_WISE_KEY_ID,
  createWaveSimChain,
  loadWaveAnswerKey,
  mintWaveVin,
  parseWaveLine,
  prepareWaveWrap,
  sanitizeWaveSym,
  sha256HexUtf8,
  shortHex,
  utf8ToHex,
  readWaveFromLocations,
} from "./wave-wrap.js";

export const WAVE_FULL_ID = "wave-full-v1";
export const WAVE_FULL_LIVE_ENV = "WAVE_FULL_LIVE";
export const WAVE_FULL_AUTOFIRE_ENV = "WAVE_FULL_AUTOFIRE";
export const WAVE_FULL_MIN_LIQUID_USD_ENV = "WAVE_FULL_MIN_LIQUID_USD";
export const WAVE_FULL_MIN_LIQUID_USD_DEFAULT = 1;
export const WAVE_FULL_EXPECTED_SHARDS = 28;
export const WAVE_FULL_DEFAULT_SYMS = Object.freeze(["VIRTUAL", "CLANKER", "AERO"]);
export const WAVE_FULL_SYMS_ENV = "WAVE_FULL_SYMS";
export const WAVE_FULL_RESUME_VIN_ENV = "WAVE_FULL_RESUME_VIN";
export const WAVE_FULL_RESUME_FROM_ENV = "WAVE_FULL_RESUME_FROM";
export const WAVE_FULL_RESUME_TXS_ENV = "WAVE_FULL_RESUME_TXS";
export const WAVE_FULL_SEND_RETRIES_ENV = "WAVE_FULL_SEND_RETRIES";
export const WAVE_FULL_RETRY_MS_ENV = "WAVE_FULL_RETRY_MS";
export const WAVE_FULL_SEND_RETRIES_DEFAULT = 3;
export const WAVE_FULL_RETRY_MS_DEFAULT = 400;
export const WAVE_FULL_BASESCAN_TX = "https://basescan.org/tx/";

const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const VIN_RE = /^VIN-[A-Z0-9]+$/i;
const CALLDATA_GAS_PER_NONZERO_BYTE = 16;
const BTP_INSCRIBE_GAS_UNITS = 50_000;
const WAVE_PROOF_MIN_LIQUID_USD_ENV = "WAVE_PROOF_MIN_LIQUID_USD";

let _waveFullLiveSpent = false;
let _waveFullAutofireSpent = false;
let _waveFullPartial = null;

function envFlagOnExplicit(raw) {
  const v = String(raw ?? "").trim().toLowerCase();
  return v === "yes" || v === "true" || v === "1";
}

function envNumber(raw, fallback) {
  if (raw == null || String(raw).trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** WAVE_FULL_LIVE must be yes|true|1. Default OFF. Does not touch VITAFEED_PAID. */
export function waveFullLiveEnabled(env = process.env) {
  return envFlagOnExplicit(env?.[WAVE_FULL_LIVE_ENV] ?? "");
}

/** WAVE_FULL_AUTOFIRE must be yes|true|1. Default OFF. One-shot boot fire. */
export function waveFullAutofireEnabled(env = process.env) {
  return envFlagOnExplicit(env?.[WAVE_FULL_AUTOFIRE_ENV] ?? "");
}

/**
 * Default $1. WAVE_FULL_MIN_LIQUID_USD, else WAVE_PROOF_MIN_LIQUID_USD,
 * else VITAFEED_MIN_LIQUID_USD, else 1. Set 0 to disable.
 */
export function waveFullMinLiquidUsd(env = process.env) {
  const full = envNumber(env?.[WAVE_FULL_MIN_LIQUID_USD_ENV], null);
  if (full != null) return full < 0 ? WAVE_FULL_MIN_LIQUID_USD_DEFAULT : full;
  const proof = envNumber(env?.[WAVE_PROOF_MIN_LIQUID_USD_ENV], null);
  if (proof != null) return proof < 0 ? WAVE_FULL_MIN_LIQUID_USD_DEFAULT : proof;
  const feed = envNumber(env?.VITAFEED_MIN_LIQUID_USD, null);
  if (feed != null) return feed < 0 ? WAVE_FULL_MIN_LIQUID_USD_DEFAULT : feed;
  return WAVE_FULL_MIN_LIQUID_USD_DEFAULT;
}

export function waveFullLiveSpent() {
  return _waveFullLiveSpent;
}

export function resetWaveFullLiveLatch() {
  _waveFullLiveSpent = false;
  _waveFullPartial = null;
}

export function peekWaveFullPartial() {
  return _waveFullPartial
    ? {
        vinId: _waveFullPartial.vinId,
        fromIndex: _waveFullPartial.fromIndex,
        txHashes: _waveFullPartial.txHashes.slice(),
        symbols: _waveFullPartial.symbols ? _waveFullPartial.symbols.slice() : [],
        sealedCount: _waveFullPartial.txHashes.length,
      }
    : null;
}

export function rememberWaveFullPartial(row = {}) {
  const txHashes = parseWaveFullTxHashes(row.txHashes);
  const fromIndex = Math.max(
    1,
    Math.floor(Number(row.fromIndex) || (txHashes.length + 1)),
  );
  _waveFullPartial = {
    vinId: sanitizeWaveFullVin(row.vinId),
    fromIndex,
    txHashes,
    symbols: Array.isArray(row.symbols) ? row.symbols.slice() : [],
  };
  return peekWaveFullPartial();
}

export function clearWaveFullPartial() {
  _waveFullPartial = null;
}

export function markWaveFullLiveSpent(env = null) {
  _waveFullLiveSpent = true;
  if (env && typeof env === "object") env[WAVE_FULL_LIVE_ENV] = "no";
}

export function waveFullAutofireSpent() {
  return _waveFullAutofireSpent;
}

export function resetWaveFullAutofireLatch() {
  _waveFullAutofireSpent = false;
}

export function markWaveFullAutofireSpent(env = null) {
  _waveFullAutofireSpent = true;
  if (env && typeof env === "object") env[WAVE_FULL_AUTOFIRE_ENV] = "no";
}

/** True for desk POST or GET ?live=1|yes|true — not public GET SIM. */
export function wantsDeskWaveFullLive({ method = "GET", searchParams, body } = {}) {
  const m = String(method || "GET").toUpperCase();
  if (m === "POST") return true;
  const q = searchParams && typeof searchParams.get === "function"
    ? String(searchParams.get("live") || "")
    : String(searchParams?.live || "");
  const b = body && typeof body === "object" ? String(body.live || "") : "";
  return envFlagOnExplicit(q) || envFlagOnExplicit(b);
}

/** Unique rotate list (3 liquid majors). Not a 3-send cap — used as a cycle. */
export function parseWaveFullSymbols(raw = "", env = process.env) {
  const arg = String(raw || "").trim();
  const fromEnv = String(env?.[WAVE_FULL_SYMS_ENV] || "").trim();
  const src = arg || fromEnv || WAVE_FULL_DEFAULT_SYMS.join(",");
  const parts = src.split(/[\s,;]+/).map((s) => sanitizeWaveSym(s, "")).filter(Boolean);
  const unique = [];
  for (const p of parts) {
    if (!unique.includes(p)) unique.push(p);
    if (unique.length === WAVE_FULL_DEFAULT_SYMS.length) break;
  }
  for (const fallback of WAVE_FULL_DEFAULT_SYMS) {
    if (unique.length >= WAVE_FULL_DEFAULT_SYMS.length) break;
    if (!unique.includes(fallback)) unique.push(fallback);
  }
  return unique.slice(0, WAVE_FULL_DEFAULT_SYMS.length);
}

export function rotateWaveFullSymbols(count, unique = WAVE_FULL_DEFAULT_SYMS) {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  const cycle = Array.isArray(unique) && unique.length ? unique : WAVE_FULL_DEFAULT_SYMS;
  const out = [];
  for (let i = 0; i < n; i++) out.push(cycle[i % cycle.length]);
  return out;
}

export function parseWaveFullCommand(raw = "") {
  const s = String(raw || "").trim();
  if (!/^\/wavefull(?:@\w+)?(?:\s|$)/i.test(s) && !/^\/wavefull$/i.test(s)) {
    return { ok: false, action: null, symbols: "" };
  }
  const after = s.replace(/^\/wavefull(?:@\w+)?/i, "").trim();
  if (/^help$/i.test(after)) return { ok: true, action: "help", symbols: "" };
  if (/^resume\b/i.test(after)) {
    const parts = after.replace(/^resume\b/i, "").trim().split(/[\s,;]+/).filter(Boolean);
    return {
      ok: true,
      action: "run",
      symbols: "",
      vinId: sanitizeWaveFullVin(parts[0] || ""),
      fromIndex: parseWaveFullFromIndex(parts[1], 0) || 0,
    };
  }
  return { ok: true, action: "run", symbols: after };
}

export function waveFullUsageText() {
  return [
    "usage: /wavefull [SYM SYM SYM]",
    "Full-quote WAVE inject: all 28 least-size Heraclitus shards, new VIN, SYM rotates.",
    "Default SYMs: VIRTUAL CLANKER AERO (cycle across 01/28…28/28). Last shard is 1B.",
    "Live needs WAVE_FULL_LIVE=yes (default OFF). Auto-disables after a FULL 28.",
    "Partial (CDP/RPC) leaves LIVE armed. Resume: POST { vinId, fromIndex, txHashes } or WAVE_FULL_RESUME_VIN.",
    "Desk: POST /vita/wavefull or GET ?live=1 with VITA_WEBHOOK_SECRET (x-vita-secret / x-vita-webhook-secret).",
    "WAVE_FULL_AUTOFIRE=yes fires once on boot (new VIN). Resume is desk POST — not a second autofire.",
    "Does NOT change /waveproof (still exactly 3). Does NOT enable VITAFEED_PAID / WAVE_MIRROR_PAID.",
    "Mother brain untouched. Vault never spends.",
  ].join("\n");
}

export function estimateWaveFullSendUsd({ calldataBytes, gwei = 0.05, ethUsd = 2481 } = {}) {
  const b = Math.max(0, Number(calldataBytes) || 0);
  const g = Number(gwei);
  const px = Number(ethUsd);
  if (!Number.isFinite(g) || g < 0 || !Number.isFinite(px) || px < 0) return 0;
  const eth = b * CALLDATA_GAS_PER_NONZERO_BYTE * g * 1e-9
    + BTP_INSCRIBE_GAS_UNITS * g * 1e-9;
  return eth * px;
}

export function sanitizeWaveFullVin(raw = "") {
  const s = String(raw || "").trim().toUpperCase();
  return VIN_RE.test(s) ? s : "";
}

export function parseWaveFullFromIndex(raw, fallback = 1) {
  if (raw == null || String(raw).trim() === "") return fallback;
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(WAVE_FULL_EXPECTED_SHARDS + 1, n);
}

export function parseWaveFullTxHashes(raw) {
  const parts = Array.isArray(raw)
    ? raw
    : String(raw || "").split(/[\s,;]+/);
  const out = [];
  for (const p of parts) {
    const h = String(p || "").trim();
    if (TX_HASH_RE.test(h) && !out.includes(h)) out.push(h);
  }
  return out;
}

export function isTransientWaveSendError(err) {
  if (err == null) return false;
  const status = Number(err.status || err.statusCode || err.code || 0);
  if (status === 429 || status === 502 || status === 503 || status === 504) return true;
  const code = String(err.code || "").toUpperCase();
  if (/^(ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|ECONNREFUSED)$/.test(code)) return true;
  const s = String(err.message || err || "");
  return /service unavailable|unavailable|too many requests|429|502|503|504|econnreset|etimedout|timeout|temporar|try again|rate limit|fetch failed|network/i.test(s);
}

export function waveFullSendRetries(env = process.env) {
  const n = envNumber(env?.[WAVE_FULL_SEND_RETRIES_ENV], WAVE_FULL_SEND_RETRIES_DEFAULT);
  if (!Number.isFinite(n) || n < 1) return WAVE_FULL_SEND_RETRIES_DEFAULT;
  return Math.min(8, Math.floor(n));
}

export function waveFullRetryMs(env = process.env) {
  const n = envNumber(env?.[WAVE_FULL_RETRY_MS_ENV], WAVE_FULL_RETRY_MS_DEFAULT);
  if (!Number.isFinite(n) || n < 0) return WAVE_FULL_RETRY_MS_DEFAULT;
  return Math.min(10_000, Math.floor(n));
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 3 attempts by default (initial + 2 retries) on transient CDP/RPC errors. */
export async function sendWaveTxWithRetry(sendTx, hex, line, {
  retries = WAVE_FULL_SEND_RETRIES_DEFAULT,
  backoffMs = WAVE_FULL_RETRY_MS_DEFAULT,
  sleep = defaultSleep,
} = {}) {
  const attempts = Math.max(1, Math.floor(Number(retries) || WAVE_FULL_SEND_RETRIES_DEFAULT));
  const base = Math.max(0, Number(backoffMs) || 0);
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    try {
      return await sendTx(hex, line);
    } catch (e) {
      lastErr = e;
      const more = i < attempts - 1 && isTransientWaveSendError(e);
      if (!more) throw e;
      if (base > 0 && typeof sleep === "function") {
        await sleep(base * (2 ** i));
      }
    }
  }
  throw lastErr;
}

/**
 * Autofire never resumes (avoids a second full 28). Desk/env resume
 * continues an incomplete VIN from fromIndex with the same prev chain.
 */
export function resolveWaveFullResume({
  vinId,
  fromIndex,
  sealedHashes,
  env = process.env,
  autofire = false,
  fresh = false,
} = {}) {
  if (autofire === true || fresh === true) {
    return {
      resume: false,
      vinId: sanitizeWaveFullVin(vinId) || "",
      fromIndex: 1,
      sealedHashes: [],
    };
  }
  const bodyVin = sanitizeWaveFullVin(vinId);
  const envVin = sanitizeWaveFullVin(env?.[WAVE_FULL_RESUME_VIN_ENV]);
  const partial = peekWaveFullPartial();
  const resolvedVin = bodyVin || envVin || partial?.vinId || "";
  const hashes = (() => {
    const fromArg = parseWaveFullTxHashes(sealedHashes);
    if (fromArg.length) return fromArg;
    const fromEnv = parseWaveFullTxHashes(env?.[WAVE_FULL_RESUME_TXS_ENV]);
    if (fromEnv.length) return fromEnv;
    if (partial && resolvedVin && partial.vinId === resolvedVin) return partial.txHashes.slice();
    return [];
  })();
  let from = parseWaveFullFromIndex(fromIndex, 0)
    || parseWaveFullFromIndex(env?.[WAVE_FULL_RESUME_FROM_ENV], 0);
  if (!from && hashes.length) from = hashes.length + 1;
  if (!from && partial && resolvedVin && partial.vinId === resolvedVin) from = partial.fromIndex;
  if (!from) from = 1;
  return {
    resume: Boolean(resolvedVin && from > 1),
    vinId: resolvedVin,
    fromIndex: from,
    sealedHashes: hashes,
  };
}

export function evaluateWaveFullGate({
  live = false,
  env = process.env,
  liquidUsd = null,
  sendTx = null,
  resume = false,
} = {}) {
  if (!live) {
    return { ok: true, live: false, code: "sim", reason: "SIM — WAVE_FULL_LIVE default off" };
  }
  if (_waveFullLiveSpent && resume !== true) {
    return {
      ok: false,
      live: false,
      send: false,
      code: "spent",
      reason: "WAVE_FULL_LIVE already spent this process — refuse further until reset",
    };
  }
  if (!waveFullLiveEnabled(env)) {
    return {
      ok: true,
      live: false,
      code: "live-off",
      reason: "WAVE_FULL_LIVE default off — SIM only; VITAFEED_PAID untouched",
    };
  }
  if (typeof sendTx !== "function") {
    return {
      ok: false,
      live: false,
      send: false,
      code: "no-sendTx",
      reason: "no sendTx — refuse invent live hashes",
    };
  }
  const floor = waveFullMinLiquidUsd(env);
  if (
    floor > 0
    && liquidUsd != null
    && Number.isFinite(Number(liquidUsd))
    && Number(liquidUsd) < floor
  ) {
    return {
      ok: false,
      live: false,
      send: false,
      code: "liquid-floor",
      reason: "RISK liquid ≈ $" + Number(liquidUsd).toFixed(2)
        + " < $" + Number(floor).toFixed(2)
        + " (WAVE_FULL_MIN_LIQUID_USD / WAVE_PROOF_MIN_LIQUID_USD, default 1)",
    };
  }
  if (floor > 0 && (liquidUsd == null || !Number.isFinite(Number(liquidUsd)))) {
    return {
      ok: false,
      live: false,
      send: false,
      code: "liquid-unknown",
      reason: "live WAVE full quote needs RISK liquid USD to check WAVE_FULL_MIN_LIQUID_USD",
    };
  }
  return { ok: true, live: true, send: true, code: "live-ok", floor };
}

/**
 * Plan all 28 least-size Heraclitus shards. KEY8 = full-message answer key.
 * Headers are 01/28…28/28 on a NEW VIN (not the 01/03 thrift VIN).
 */
export function planWaveFull({
  body = WAVE_WISE_MESSAGE,
  symbols,
  env = process.env,
  vinId,
} = {}) {
  const text = String(body ?? WAVE_WISE_MESSAGE);
  const unique = parseWaveFullSymbols(
    Array.isArray(symbols) ? symbols.join(" ") : (symbols || ""),
    env,
  );
  const key = loadWaveAnswerKey();
  const expected = key.ok && Number(key.totalShards) > 0
    ? Number(key.totalShards)
    : WAVE_FULL_EXPECTED_SHARDS;
  const vin = vinId ? { vinId } : mintWaveVin();
  const prepared = prepareWaveWrap(text, {
    maxBytes: WAVE_MIN_BODY_BYTES,
    symbol: unique[0],
    roundSyms: rotateWaveFullSymbols(expected, unique),
    vinId: vin.vinId,
  });
  if (!prepared?.ok) {
    return { ok: false, reason: prepared?.reason || "cannot plan full quote", lines: [] };
  }
  if (prepared.totalChunks !== expected) {
    return {
      ok: false,
      reason: "need exactly " + expected + " least-size shards, got " + prepared.totalChunks,
      lines: [],
    };
  }
  return {
    ok: true,
    id: WAVE_FULL_ID,
    vinId: prepared.vinId,
    symbols: unique.slice(),
    rotated: prepared.lines.map((line) => line.symbol),
    key8: key.ok ? key.key8 : prepared.key8,
    contentCommit: key.ok ? key.sha256 : prepared.contentCommit,
    expectedShards: expected,
    maxBytes: WAVE_MIN_BODY_BYTES,
    lines: prepared.lines,
    note: "all 28 gas-only WAVE shards on a new VIN — not the 01/03 thrift proof, not /vitafeed paid",
  };
}

/**
 * Reconstruct PASS only if joined bodies match message sha256 AND each LOC8
 * matches the answer key (and sha256(body)[:8]). Never invent hashes.
 */
export function compareFullQuoteToAnswerKey(lines, answerKey) {
  const rows = Array.isArray(lines) ? lines : [];
  const expect = Array.isArray(answerKey?.shards) ? answerKey.shards : [];
  const expectedTotal = expect.length || WAVE_FULL_EXPECTED_SHARDS;
  const bodies = [];
  const shardResults = [];
  let shardsMatch = expect.length === expectedTotal && rows.length === expectedTotal;
  let loc8Match = shardsMatch;
  for (let i = 0; i < expectedTotal; i++) {
    const raw = rows[i] || {};
    const parsed = raw.body != null && raw.loc8
      ? raw
      : parseWaveLine(raw.line || raw.utf8 || "") || {};
    const body = parsed.body != null ? parsed.body : "";
    bodies.push(body);
    const digest = sha256HexUtf8(body);
    const loc8 = shortHex(parsed.loc8 || digest);
    const expectedDigest = expect[i]?.sha256 || "";
    const expectedLoc8 = shortHex(expect[i]?.loc8 || expectedDigest);
    const digestOk = expectedDigest.length === 64 && digest === expectedDigest;
    const locOk = expectedLoc8.length === 8
      && loc8 === expectedLoc8
      && loc8 === shortHex(digest);
    if (!digestOk) shardsMatch = false;
    if (!locOk) loc8Match = false;
    shardResults.push({
      index: expect[i]?.index || i + 1,
      ok: digestOk && locOk,
      sha256: digest,
      expected: expectedDigest,
      loc8,
      expectedLoc8,
      symbol: parsed.symbol || raw.symbol || "",
    });
  }
  const reconstructed = bodies.join("");
  const got = sha256HexUtf8(reconstructed);
  const want = String(answerKey?.sha256 || "");
  const message = String(answerKey?.messageUtf8 || WAVE_WISE_MESSAGE);
  const messageMatch = want.length === 64 && got === want && reconstructed === message;
  return {
    ok: messageMatch && shardsMatch && loc8Match,
    messageMatch,
    shardsMatch,
    loc8Match,
    sha256: got,
    expected: want,
    reconstructed,
    shardResults,
  };
}

export async function runFullWaveSends(planned, sendTx, {
  liquidUsd = null,
  costUsdPerSend = 0,
  floor = 0,
  fromIndex = 1,
  priorTxHashes = [],
  retries = WAVE_FULL_SEND_RETRIES_DEFAULT,
  backoffMs = WAVE_FULL_RETRY_MS_DEFAULT,
  sleep = defaultSleep,
} = {}) {
  if (!planned?.ok) return planned;
  if (typeof sendTx !== "function") {
    return { ok: false, reason: "no sendTx — refuse invent", chunks: [], txHashes: [] };
  }
  const needed = planned.lines.length;
  const start = Math.min(needed + 1, Math.max(1, Math.floor(Number(fromIndex) || 1)));
  const prior = parseWaveFullTxHashes(priorTxHashes);
  const chunks = [];
  const txHashes = [];
  let remaining = liquidUsd == null ? null : Number(liquidUsd);
  let aborted = null;
  let sentThisRun = 0;
  for (let i = 0; i < start - 1; i++) {
    const line = planned.lines[i];
    const txHash = prior[i] || null;
    const sealed = Boolean(txHash);
    if (txHash) txHashes.push(txHash);
    chunks.push({
      index: line.index,
      total: line.total,
      vinId: line.vinId,
      symbol: line.symbol,
      key8: line.key8,
      loc8: line.loc8,
      body: line.body,
      bodyBytes: line.bodyBytes,
      line: line.line,
      hex: line.hex || utf8ToHex(line.line),
      txHash: txHash || null,
      sealed,
      resumed: true,
      basescan: txHash ? WAVE_FULL_BASESCAN_TX + txHash : null,
    });
  }
  for (let i = start - 1; i < needed; i++) {
    const cost = Number(costUsdPerSend) || 0;
    if (floor > 0 && remaining != null && Number.isFinite(remaining)) {
      if (remaining < floor || remaining - cost < floor) {
        aborted = "abort mid-batch — liquid would breach WAVE_FULL_MIN_LIQUID_USD";
        break;
      }
    }
    const line = planned.lines[i];
    const hex = line.hex || utf8ToHex(line.line);
    let txHash;
    try {
      txHash = await sendWaveTxWithRetry(sendTx, hex, line, { retries, backoffMs, sleep });
    } catch (e) {
      aborted = isTransientWaveSendError(e)
        ? "abort mid-batch — transient send error after retries: " + (e.message || e)
        : "abort mid-batch — sendTx threw: " + (e.message || e);
      break;
    }
    if (txHash && !TX_HASH_RE.test(String(txHash))) {
      return { ok: false, reason: "sender returned non-hash — refuse invent", chunks, txHashes };
    }
    const sealed = Boolean(txHash);
    if (txHash) txHashes.push(txHash);
    sentThisRun += 1;
    chunks.push({
      index: line.index,
      total: line.total,
      vinId: line.vinId,
      symbol: line.symbol,
      key8: line.key8,
      loc8: line.loc8,
      body: line.body,
      bodyBytes: line.bodyBytes,
      line: line.line,
      hex,
      txHash: txHash || null,
      sealed,
      resumed: false,
      basescan: txHash ? WAVE_FULL_BASESCAN_TX + txHash : null,
    });
    if (remaining != null && Number.isFinite(remaining) && cost) remaining -= cost;
    if (!txHash) {
      aborted = "abort mid-batch — sendTx returned null (never invent)";
      break;
    }
  }
  return {
    ok: true,
    aborted,
    resume: start > 1,
    fromIndex: start,
    sentThisRun,
    banked: txHashes.length < needed || Boolean(aborted),
    sealedCount: txHashes.length,
    needed,
    remainingUsd: remaining,
    vinId: planned.vinId,
    chunks,
    txHashes: txHashes.slice(),
    reason: aborted
      || (txHashes.length === needed
        ? "sealed — 28 gas-only WAVE shards returned real hashes"
        : txHashes.length
          ? "partial seal — remaining chunks not hashed (never invent)"
          : "no hashes yet — never invent txs"),
  };
}

export async function runWaveFull({
  body = WAVE_WISE_MESSAGE,
  symbols,
  env = process.env,
  live = false,
  sendTx = null,
  fetchCalldata = null,
  liquidUsd = null,
  quotes = null,
  vinId,
  fromIndex,
  sealedHashes,
  autofire = false,
  fresh = false,
  sleep,
} = {}) {
  const resolved = resolveWaveFullResume({
    vinId,
    fromIndex,
    sealedHashes,
    env,
    autofire,
    fresh,
  });
  const planned = planWaveFull({
    body,
    symbols,
    env,
    vinId: resolved.vinId || vinId,
  });
  if (!planned.ok) return { ok: false, pass: false, reason: planned.reason };

  const wantLive = live === true;
  const gate = evaluateWaveFullGate({
    live: wantLive,
    env,
    liquidUsd,
    sendTx,
    resume: resolved.resume,
  });

  let chain = null;
  let sender = sendTx;
  let reader = fetchCalldata;
  let isLive = false;

  if (wantLive && gate.code === "live-ok") {
    isLive = true;
  } else if (wantLive && !gate.ok) {
    return { ok: false, pass: false, live: false, gate, reason: gate.reason };
  } else {
    chain = createWaveSimChain();
    sender = chain.sendTx;
    reader = chain.fetchCalldata;
  }

  if (typeof reader !== "function" && chain) reader = chain.fetchCalldata;

  const costUsdPerSend = estimateWaveFullSendUsd({
    calldataBytes: planned.lines[0]?.calldataBytes || 80,
    gwei: quotes?.gwei,
    ethUsd: quotes?.ethUsd,
  });
  const floor = waveFullMinLiquidUsd(env);

  let inscribed;
  try {
    inscribed = await runFullWaveSends(planned, sender, {
      liquidUsd: isLive ? liquidUsd : null,
      costUsdPerSend: isLive ? costUsdPerSend : 0,
      floor: isLive ? floor : 0,
      fromIndex: resolved.fromIndex,
      priorTxHashes: resolved.sealedHashes,
      retries: waveFullSendRetries(env),
      backoffMs: isLive ? waveFullRetryMs(env) : 0,
      sleep,
    });
  } catch (e) {
    return {
      ok: false,
      pass: false,
      live: isLive,
      sim: !isLive,
      gate,
      resume: resolved.resume,
      vinId: planned.vinId,
      reason: "send batch threw — LIVE left armed: " + (e.message || e),
    };
  }

  const complete = inscribed?.ok
    && inscribed.sealedCount === planned.expectedShards
    && !inscribed.aborted;
  if (isLive && complete) {
    markWaveFullLiveSpent(env);
    clearWaveFullPartial();
  } else if (isLive && inscribed?.ok && inscribed.sealedCount > 0 && inscribed.sealedCount < planned.expectedShards) {
    rememberWaveFullPartial({
      vinId: planned.vinId,
      fromIndex: inscribed.sealedCount + 1,
      txHashes: inscribed.txHashes,
      symbols: planned.symbols,
    });
  }

  if (!inscribed?.ok) {
    return { ok: false, pass: false, live: isLive, sim: !isLive, gate, inscribed, reason: inscribed?.reason };
  }

  const key = loadWaveAnswerKey();
  const chainHashes = inscribed.txHashes;
  const fullRead = chainHashes.length === planned.expectedShards
    ? await readWaveFromLocations(chainHashes, reader)
    : { ok: false, reason: inscribed.aborted || "incomplete seal — cannot reconstruct from chain only", body: "", lines: [] };

  const compared = fullRead.ok
    ? compareFullQuoteToAnswerKey(fullRead.lines, key)
    : {
        ok: false,
        messageMatch: false,
        shardsMatch: false,
        loc8Match: false,
        reconstructed: fullRead.body || "",
        shardResults: [],
      };

  const pass = inscribed.sealedCount === planned.expectedShards
    && !inscribed.aborted
    && compared.ok === true;

  const nextFrom = !complete && inscribed.sealedCount > 0
    ? inscribed.sealedCount + 1
    : resolved.fromIndex;
  return {
    ok: true,
    pass,
    live: isLive,
    sim: !isLive,
    gate,
    resume: resolved.resume || inscribed.resume === true,
    fromIndex: inscribed.fromIndex || resolved.fromIndex,
    nextFromIndex: complete ? null : nextFrom,
    partial: !complete,
    vinId: planned.vinId,
    symbols: planned.symbols,
    rotated: planned.rotated,
    key8: planned.key8,
    expectedShards: planned.expectedShards,
    answerKey: { id: WAVE_WISE_KEY_ID, sha256: key.sha256, key8: key.key8 },
    inscribed,
    reconstructed: compared.reconstructed || "",
    compared,
    reason: pass
      ? (isLive
        ? "WAVE full-quote PASS — 28 Base hashes, reconstruct-from-chain-only matches message sha256 + LOC8"
        : "WAVE full-quote PASS — SIM reconstruct matches message sha256 + LOC8 (not Base)")
      : compared.ok
        ? (inscribed.aborted || inscribed.reason || "incomplete seal")
        : inscribed.aborted
          ? inscribed.aborted + " — LIVE left armed; resume POST { vinId, fromIndex, txHashes }"
          : "reconstruct does not match answer-key sha256 and/or LOC8",
  };
}

export function formatWaveFullCard(result) {
  const total = result.expectedShards || WAVE_FULL_EXPECTED_SHARDS;
  const lines = [
    "WAVE FULL · " + WAVE_FULL_ID,
    "SYMs rotate " + (result.symbols || WAVE_FULL_DEFAULT_SYMS).join(" ")
      + " · " + total + " least-size Heraclitus shards",
    "VIN " + (result.vinId || ""),
    "KEY8=" + (result.key8 || result.answerKey?.key8 || ""),
    result.sim ? "SIM chain (not Base)" : result.live ? "LIVE gas-only self-txs" : "banked",
  ];
  for (const chunk of result.inscribed?.chunks || []) {
    const loc = chunk.txHash ? chunk.txHash : "null";
    const link = chunk.basescan ? " " + chunk.basescan : "";
    lines.push(
      "  " + chunk.symbol + " "
        + String(chunk.index).padStart(2, "0") + "/"
        + String(chunk.total).padStart(2, "0")
        + " loc=" + loc + link,
    );
  }
  lines.push(
    result.pass
      ? "PASS — reconstruct-from-chain-only matches message sha256 + each LOC8"
      : "FAIL — " + (result.reason || "mismatch"),
  );
  if (result.partial && result.vinId) {
    lines.push(
      "RESUME desk POST { \"vinId\": \"" + result.vinId
        + "\", \"fromIndex\": " + (result.nextFromIndex || result.fromIndex || 1)
        + ", \"txHashes\": [<sealed>] } — LIVE left armed. Autofire will not re-send 28.",
    );
  }
  lines.push(
    "WAVE_FULL_LIVE default off; auto-disable after a FULL 28. Desk POST /vita/wavefull (auth). "
      + "/waveproof stays 3. VITAFEED_PAID untouched. Mother brain untouched.",
  );
  return lines.join("\n");
}

/** JSON desk/board payload — VIN + all 28 hashes + reconstruct PASS/FAIL. */
export function formatWaveFullHttpResult(out = {}) {
  const result = out.result || null;
  const inscribed = result?.inscribed || null;
  const chunks = (inscribed?.chunks || []).map((c) => ({
    symbol: c.symbol,
    index: c.index,
    total: c.total,
    txHash: c.txHash || null,
    basescan: c.basescan || null,
    loc8: c.loc8,
    bodyBytes: c.bodyBytes,
  }));
  const txHashes = (inscribed?.txHashes || []).filter(Boolean);
  const basescan = chunks.map((c) => c.basescan).filter(Boolean);
  const live = result?.live === true;
  const pass = out.pass === true;
  return {
    ok: out.ok !== false,
    pass,
    send: out.send === true,
    live,
    sim: result ? result.sim === true : !live,
    vitafeedPaidDefault: "off",
    waveFullLiveDefault: "off",
    waveFullAutofireDefault: "off",
    waveProofUnchanged: true,
    motherBrain: "untouched",
    expectedShards: WAVE_FULL_EXPECTED_SHARDS,
    telegram: ["/wavefull"],
    desk: ["POST /vita/wavefull", "GET /vita/wavefull?live=1"],
    vinId: result?.vinId || null,
    key8: result?.key8 || result?.answerKey?.key8 || null,
    reconstruct: pass ? "PASS" : "FAIL",
    resume: result?.resume === true,
    fromIndex: result?.fromIndex || 1,
    nextFromIndex: result?.nextFromIndex || null,
    partial: result?.partial === true,
    txHashes,
    basescan,
    reply: out.reply,
    result: result
      ? {
          pass: result.pass,
          sim: result.sim,
          live: result.live,
          vinId: result.vinId,
          symbols: result.symbols,
          key8: result.key8,
          expectedShards: result.expectedShards,
          txHashes,
          chunks,
          compared: result.compared
            ? {
                ok: result.compared.ok,
                messageMatch: result.compared.messageMatch,
                shardsMatch: result.compared.shardsMatch,
                loc8Match: result.compared.loc8Match,
                sha256: result.compared.sha256,
                expected: result.compared.expected,
              }
            : null,
          reason: result.reason,
        }
      : null,
  };
}

export async function handleWaveFullAction({
  action = "run",
  symbols = "",
  env = process.env,
  live = false,
  sendTx = null,
  fetchCalldata = null,
  liquidUsd = null,
  quotes = null,
  vinId,
  fromIndex,
  sealedHashes,
  autofire = false,
  fresh = false,
  sleep,
} = {}) {
  if (action === "help") {
    return { ok: true, send: false, reply: waveFullUsageText() };
  }
  const result = await runWaveFull({
    body: WAVE_WISE_MESSAGE,
    symbols,
    env,
    live,
    sendTx,
    fetchCalldata,
    liquidUsd,
    quotes,
    vinId,
    fromIndex,
    sealedHashes,
    autofire,
    fresh,
    sleep,
  });
  return {
    ok: result.ok,
    pass: result.pass === true,
    send: result.live === true,
    result,
    reply: result.ok === false && !result.inscribed
      ? "WAVE FULL REFUSE\n" + (result.reason || "gate")
      : formatWaveFullCard(result),
  };
}

/**
 * One-shot boot fire. Requires WAVE_FULL_AUTOFIRE=yes AND WAVE_FULL_LIVE=yes.
 * Clears autofire before the batch so a retry cannot burn twice. Always a
 * new VIN — never resumes WAVE_FULL_RESUME_VIN (desk POST resumes).
 * Live latch only disables WAVE_FULL_LIVE after a FULL 28. Default OFF.
 */
export async function maybeAutofireWaveFull({
  env = process.env,
  sendTx = null,
  fetchCalldata = null,
  liquidUsd = null,
  quotes = null,
  symbols = "",
} = {}) {
  if (!waveFullAutofireEnabled(env)) {
    return { ok: true, fired: false, autofire: false, reason: "WAVE_FULL_AUTOFIRE default off" };
  }
  if (_waveFullAutofireSpent) {
    return {
      ok: true,
      fired: false,
      autofire: false,
      reason: "WAVE_FULL_AUTOFIRE already spent this process — refuse further",
    };
  }
  markWaveFullAutofireSpent(env);
  if (!waveFullLiveEnabled(env)) {
    return {
      ok: true,
      fired: false,
      autofire: false,
      reason: "WAVE_FULL_AUTOFIRE needs WAVE_FULL_LIVE=yes — cleared autofire, no send",
    };
  }
  const out = await handleWaveFullAction({
    action: "run",
    symbols,
    env,
    live: true,
    sendTx,
    fetchCalldata,
    liquidUsd,
    quotes,
    autofire: true,
    fresh: true,
  });
  return {
    ...out,
    fired: out.send === true,
    autofire: true,
    reason: out.result?.reason || out.reply || out.reason,
  };
}
