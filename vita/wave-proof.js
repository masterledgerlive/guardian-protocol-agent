/**
 * Capped 3-token WAVE proof — gas-only self-txs, then reconstruct-from-chain.
 *
 * Exactly 3 least-size (8B) Heraclitus shards, SYM = VIRTUAL|CLANKER|AERO.
 * Live only when WAVE_PROOF_LIVE=yes (default OFF). Max 3 sends, then latch.
 * Does NOT enable VITAFEED_PAID / WAVE_MIRROR_PAID. Mother brain untouched.
 * Never invents tx hashes. LOSE-ZERO: no ALLOW_LOSSY sells.
 */

import {
  WAVE_MIN_BODY_BYTES,
  WAVE_WISE_MESSAGE,
  WAVE_WISE_KEY_ID,
  buildWaveLine,
  createWaveSimChain,
  loadWaveAnswerKey,
  mintWaveVin,
  parseWaveLine,
  planWaveShards,
  readWaveFromLocations,
  sanitizeWaveSym,
  sha256HexUtf8,
  shortHex,
  splitUtf8ByBytes,
  utf8ByteLength,
  utf8ToHex,
} from "./wave-wrap.js";

export const WAVE_PROOF_ID = "wave-proof-v1";
export const WAVE_PROOF_LIVE_ENV = "WAVE_PROOF_LIVE";
export const WAVE_PROOF_MIN_LIQUID_USD_ENV = "WAVE_PROOF_MIN_LIQUID_USD";
export const WAVE_PROOF_MIN_LIQUID_USD_DEFAULT = 1;
export const WAVE_PROOF_MAX_SENDS = 3;
export const WAVE_PROOF_DEFAULT_SYMS = Object.freeze(["VIRTUAL", "CLANKER", "AERO"]);
export const WAVE_PROOF_SYMS_ENV = "WAVE_PROOF_SYMS";
export const WAVE_PROOF_BASESCAN_TX = "https://basescan.org/tx/";

const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const CALLDATA_GAS_PER_NONZERO_BYTE = 16;
const BTP_INSCRIBE_GAS_UNITS = 50_000;

let _waveProofLiveSpent = false;

function envFlagOnExplicit(raw) {
  const v = String(raw ?? "").trim().toLowerCase();
  return v === "yes" || v === "true" || v === "1";
}

function envNumber(raw, fallback) {
  if (raw == null || String(raw).trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** WAVE_PROOF_LIVE must be yes|true|1. Default OFF. Does not touch VITAFEED_PAID. */
export function waveProofLiveEnabled(env = process.env) {
  return envFlagOnExplicit(env?.[WAVE_PROOF_LIVE_ENV] ?? "");
}

/** Default $1. WAVE_PROOF_MIN_LIQUID_USD, else VITAFEED_MIN_LIQUID_USD, else 1. Set 0 to disable. */
export function waveProofMinLiquidUsd(env = process.env) {
  const proof = envNumber(env?.[WAVE_PROOF_MIN_LIQUID_USD_ENV], null);
  if (proof != null) return proof < 0 ? WAVE_PROOF_MIN_LIQUID_USD_DEFAULT : proof;
  const feed = envNumber(env?.VITAFEED_MIN_LIQUID_USD, null);
  if (feed != null) return feed < 0 ? WAVE_PROOF_MIN_LIQUID_USD_DEFAULT : feed;
  return WAVE_PROOF_MIN_LIQUID_USD_DEFAULT;
}

export function waveProofLiveSpent() {
  return _waveProofLiveSpent;
}

export function resetWaveProofLiveLatch() {
  _waveProofLiveSpent = false;
}

export function markWaveProofLiveSpent(env = null) {
  _waveProofLiveSpent = true;
  if (env && typeof env === "object") env[WAVE_PROOF_LIVE_ENV] = "no";
}

export function parseWaveProofSymbols(raw = "", env = process.env) {
  const arg = String(raw || "").trim();
  const fromEnv = String(env?.[WAVE_PROOF_SYMS_ENV] || "").trim();
  const src = arg || fromEnv || WAVE_PROOF_DEFAULT_SYMS.join(",");
  const parts = src.split(/[\s,;]+/).map((s) => sanitizeWaveSym(s, "")).filter(Boolean);
  const unique = [];
  for (const p of parts) {
    if (!unique.includes(p)) unique.push(p);
    if (unique.length === WAVE_PROOF_MAX_SENDS) break;
  }
  for (const fallback of WAVE_PROOF_DEFAULT_SYMS) {
    if (unique.length >= WAVE_PROOF_MAX_SENDS) break;
    if (!unique.includes(fallback)) unique.push(fallback);
  }
  return unique.slice(0, WAVE_PROOF_MAX_SENDS);
}

export function parseWaveProofCommand(raw = "") {
  const s = String(raw || "").trim();
  if (!/^\/waveproof(?:@\w+)?(?:\s|$)/i.test(s) && !/^\/waveproof$/i.test(s)) {
    return { ok: false, action: null, symbols: "" };
  }
  const after = s.replace(/^\/waveproof(?:@\w+)?/i, "").trim();
  if (/^help$/i.test(after)) return { ok: true, action: "help", symbols: "" };
  return { ok: true, action: "run", symbols: after };
}

export function waveProofUsageText() {
  return [
    "usage: /waveproof [SYM SYM SYM]",
    "Capped 3-token WAVE proof: least-size 8B Heraclitus shards, SYM in header.",
    "Default SYMs: VIRTUAL CLANKER AERO. Max 3 gas-only self-txs.",
    "Live needs WAVE_PROOF_LIVE=yes (default OFF). Auto-disables after the batch.",
    "Does NOT enable VITAFEED_PAID / WAVE_MIRROR_PAID. Mother brain untouched.",
  ].join("\n");
}

export function estimateWaveProofSendUsd({ calldataBytes, gwei = 0.05, ethUsd = 2481 } = {}) {
  const b = Math.max(0, Number(calldataBytes) || 0);
  const g = Number(gwei);
  const px = Number(ethUsd);
  if (!Number.isFinite(g) || g < 0 || !Number.isFinite(px) || px < 0) return 0;
  const eth = b * CALLDATA_GAS_PER_NONZERO_BYTE * g * 1e-9
    + BTP_INSCRIBE_GAS_UNITS * g * 1e-9;
  return eth * px;
}

export function evaluateWaveProofGate({
  live = false,
  env = process.env,
  liquidUsd = null,
  sendTx = null,
} = {}) {
  if (!live) {
    return { ok: true, live: false, code: "sim", reason: "SIM — WAVE_PROOF_LIVE default off" };
  }
  if (_waveProofLiveSpent) {
    return {
      ok: false,
      live: false,
      send: false,
      code: "spent",
      reason: "WAVE_PROOF_LIVE already spent this process — refuse further until reset",
    };
  }
  if (!waveProofLiveEnabled(env)) {
    return {
      ok: true,
      live: false,
      code: "live-off",
      reason: "WAVE_PROOF_LIVE default off — SIM only; VITAFEED_PAID untouched",
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
  const floor = waveProofMinLiquidUsd(env);
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
        + " (WAVE_PROOF_MIN_LIQUID_USD, default 1)",
    };
  }
  if (floor > 0 && (liquidUsd == null || !Number.isFinite(Number(liquidUsd)))) {
    return {
      ok: false,
      live: false,
      send: false,
      code: "liquid-unknown",
      reason: "live WAVE proof needs RISK liquid USD to check WAVE_PROOF_MIN_LIQUID_USD",
    };
  }
  return { ok: true, live: true, send: true, code: "live-ok", floor };
}

/**
 * Plan exactly 3 least-size Heraclitus shards. KEY8 = full-message answer key.
 * Headers are 01/03…03/03 (capped proof, not the 28-shard dump).
 */
export function planWaveProof({
  body = WAVE_WISE_MESSAGE,
  symbols,
  env = process.env,
  vinId,
} = {}) {
  const text = String(body ?? WAVE_WISE_MESSAGE);
  const syms = parseWaveProofSymbols(
    Array.isArray(symbols) ? symbols.join(" ") : (symbols || ""),
    env,
  );
  const planned = planWaveShards(text, { maxBytes: WAVE_MIN_BODY_BYTES });
  if (!planned.ok || planned.chunks.length < WAVE_PROOF_MAX_SENDS) {
    return { ok: false, reason: planned.reason || "need ≥3 least-size shards", lines: [] };
  }
  const key = loadWaveAnswerKey();
  const key8 = key.ok ? key.key8 : shortHex(sha256HexUtf8(text));
  const vin = vinId ? { vinId } : mintWaveVin();
  const lines = [];
  let prev = "00000000";
  for (let i = 0; i < WAVE_PROOF_MAX_SENDS; i++) {
    const index = i + 1;
    const shardBody = planned.chunks[i];
    const loc8 = shortHex(sha256HexUtf8(shardBody));
    const nextIndex = index < WAVE_PROOF_MAX_SENDS ? index + 1 : null;
    const line = buildWaveLine({
      symbol: syms[i],
      vinId: vin.vinId,
      index,
      total: WAVE_PROOF_MAX_SENDS,
      prevHash: prev,
      nextIndex,
      key8,
      loc8,
      body: shardBody,
    });
    const hash = shortHex(sha256HexUtf8(line));
    lines.push({
      index,
      total: WAVE_PROOF_MAX_SENDS,
      vinId: vin.vinId,
      symbol: syms[i],
      prevHash: prev,
      nextIndex,
      nextPtr: nextIndex == null ? "END" : String(nextIndex),
      key8,
      loc8,
      body: shardBody,
      bodyBytes: utf8ByteLength(shardBody),
      line,
      hex: utf8ToHex(line),
      hash,
      calldataBytes: utf8ByteLength(line),
    });
    prev = hash;
  }
  return {
    ok: true,
    id: WAVE_PROOF_ID,
    vinId: vin.vinId,
    symbols: syms.slice(),
    key8,
    contentCommit: key.ok ? key.sha256 : sha256HexUtf8(text),
    maxSends: WAVE_PROOF_MAX_SENDS,
    maxBytes: WAVE_MIN_BODY_BYTES,
    lines,
    note: "exactly 3 gas-only WAVE shards — not a 28-shard dump, not /vitafeed paid",
  };
}

export function compareProofShardsToAnswerKey(lines, answerKey) {
  const rows = Array.isArray(lines) ? lines : [];
  const expect = Array.isArray(answerKey?.shards)
    ? answerKey.shards.slice(0, WAVE_PROOF_MAX_SENDS)
    : [];
  const shardResults = [];
  let shardsMatch = expect.length === WAVE_PROOF_MAX_SENDS && rows.length === WAVE_PROOF_MAX_SENDS;
  for (let i = 0; i < WAVE_PROOF_MAX_SENDS; i++) {
    const body = rows[i]?.body != null
      ? rows[i].body
      : parseWaveLine(rows[i]?.line || rows[i]?.utf8 || "")?.body || "";
    const digest = sha256HexUtf8(body);
    const expected = expect[i]?.sha256 || "";
    const ok = expected.length === 64 && digest === expected;
    if (!ok) shardsMatch = false;
    shardResults.push({
      index: expect[i]?.index || i + 1,
      ok,
      sha256: digest,
      expected,
      loc8: rows[i]?.loc8 || shortHex(digest),
      symbol: rows[i]?.symbol || parseWaveLine(rows[i]?.line || "")?.symbol || "",
    });
  }
  const reconstructed = rows.map((r) => {
    if (r?.body != null) return r.body;
    return parseWaveLine(r?.line || r?.utf8 || "")?.body || "";
  }).join("");
  const prefix = splitUtf8ByBytes(
    String(answerKey?.messageUtf8 || WAVE_WISE_MESSAGE),
    answerKey?.bodyBudget?.used || WAVE_MIN_BODY_BYTES,
  ).slice(0, WAVE_PROOF_MAX_SENDS).join("");
  const prefixMatch = reconstructed === prefix && prefix.length > 0;
  return {
    ok: shardsMatch && prefixMatch,
    shardsMatch,
    prefixMatch,
    reconstructed,
    prefix,
    shardResults,
  };
}

export async function runCappedWaveProofSends(planned, sendTx, {
  liquidUsd = null,
  costUsdPerSend = 0,
  floor = 0,
  maxSends = WAVE_PROOF_MAX_SENDS,
} = {}) {
  if (!planned?.ok) return planned;
  if (typeof sendTx !== "function") {
    return { ok: false, reason: "no sendTx — refuse invent", chunks: [], txHashes: [] };
  }
  const cap = Math.min(WAVE_PROOF_MAX_SENDS, Math.max(0, Math.floor(Number(maxSends) || 0)), planned.lines.length);
  const chunks = [];
  const txHashes = [];
  let remaining = liquidUsd == null ? null : Number(liquidUsd);
  let aborted = null;
  for (let i = 0; i < cap; i++) {
    const cost = Number(costUsdPerSend) || 0;
    if (floor > 0 && remaining != null && Number.isFinite(remaining)) {
      if (remaining < floor || remaining - cost < floor) {
        aborted = "abort mid-batch — liquid would breach WAVE_PROOF_MIN_LIQUID_USD";
        break;
      }
    }
    const line = planned.lines[i];
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
      key8: line.key8,
      loc8: line.loc8,
      body: line.body,
      bodyBytes: line.bodyBytes,
      line: line.line,
      hex,
      txHash: txHash || null,
      sealed,
      basescan: txHash ? WAVE_PROOF_BASESCAN_TX + txHash : null,
    });
    if (remaining != null && Number.isFinite(remaining) && cost) remaining -= cost;
  }
  return {
    ok: true,
    aborted,
    banked: txHashes.length < cap || Boolean(aborted),
    sealedCount: txHashes.length,
    needed: cap,
    remainingUsd: remaining,
    vinId: planned.vinId,
    chunks,
    txHashes: txHashes.slice(),
    reason: aborted
      || (txHashes.length === cap
        ? "sealed — 3 gas-only WAVE shards returned real hashes"
        : txHashes.length
          ? "partial seal — remaining chunks not hashed (never invent)"
          : "no hashes yet — never invent txs"),
  };
}

export async function runWaveProof({
  body = WAVE_WISE_MESSAGE,
  symbols,
  env = process.env,
  live = false,
  sendTx = null,
  fetchCalldata = null,
  liquidUsd = null,
  quotes = null,
  vinId,
} = {}) {
  const planned = planWaveProof({ body, symbols, env, vinId });
  if (!planned.ok) return { ok: false, pass: false, reason: planned.reason };

  const wantLive = live === true;
  const gate = evaluateWaveProofGate({
    live: wantLive,
    env,
    liquidUsd,
    sendTx,
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

  const costUsdPerSend = estimateWaveProofSendUsd({
    calldataBytes: planned.lines[0]?.calldataBytes || 80,
    gwei: quotes?.gwei,
    ethUsd: quotes?.ethUsd,
  });
  const floor = waveProofMinLiquidUsd(env);

  let inscribed;
  try {
    inscribed = await runCappedWaveProofSends(planned, sender, {
      liquidUsd: isLive ? liquidUsd : null,
      costUsdPerSend: isLive ? costUsdPerSend : 0,
      floor: isLive ? floor : 0,
      maxSends: WAVE_PROOF_MAX_SENDS,
    });
  } finally {
    if (isLive) markWaveProofLiveSpent(env);
  }

  if (!inscribed?.ok) return { ok: false, pass: false, live: isLive, sim: !isLive, gate, inscribed, reason: inscribed?.reason };

  const key = loadWaveAnswerKey();
  const sealedHashes = inscribed.txHashes;
  const fullRead = sealedHashes.length === WAVE_PROOF_MAX_SENDS
    ? await readWaveFromLocations(sealedHashes, reader)
    : { ok: false, reason: inscribed.aborted || "incomplete seal — cannot reconstruct from chain only", body: "", lines: [] };

  const compared = fullRead.ok
    ? compareProofShardsToAnswerKey(fullRead.lines, key)
    : { ok: false, shardsMatch: false, prefixMatch: false, reconstructed: fullRead.body || "", shardResults: [] };

  const pass = inscribed.sealedCount === WAVE_PROOF_MAX_SENDS
    && !inscribed.aborted
    && compared.ok === true;

  return {
    ok: true,
    pass,
    live: isLive,
    sim: !isLive,
    gate,
    vinId: planned.vinId,
    symbols: planned.symbols,
    key8: planned.key8,
    answerKey: { id: WAVE_WISE_KEY_ID, sha256: key.sha256, key8: key.key8 },
    inscribed,
    reconstructed: compared.reconstructed || "",
    compared,
    reason: pass
      ? (isLive
        ? "WAVE proof PASS — 3 Base hashes, reconstruct-from-chain-only matches per-shard digests"
        : "WAVE proof PASS — SIM reconstruct matches per-shard digests (not Base)")
      : compared.ok
        ? (inscribed.aborted || inscribed.reason || "incomplete seal")
        : "reconstruct does not match answer-key per-shard digests",
  };
}

export function formatWaveProofCard(result) {
  const lines = [
    "WAVE PROOF · " + WAVE_PROOF_ID,
    "SYMs " + (result.symbols || WAVE_PROOF_DEFAULT_SYMS).join(" ") + " · 3×8B Heraclitus",
    "VIN " + (result.vinId || ""),
    "KEY8=" + (result.key8 || result.answerKey?.key8 || ""),
    result.sim ? "SIM chain (not Base)" : result.live ? "LIVE gas-only self-txs" : "banked",
  ];
  for (const chunk of result.inscribed?.chunks || []) {
    const loc = chunk.txHash ? chunk.txHash : "null";
    const link = chunk.basescan ? " " + chunk.basescan : "";
    lines.push(
      "  " + chunk.symbol + " " + String(chunk.index).padStart(2, "0") + "/03 loc=" + loc + link,
    );
  }
  lines.push(result.pass ? "PASS — reconstruct-from-chain-only matches answer-key shard digests" : "FAIL — " + (result.reason || "mismatch"));
  lines.push("WAVE_PROOF_LIVE default off; auto-disable after live batch. VITAFEED_PAID untouched. Mother brain untouched.");
  return lines.join("\n");
}

export async function handleWaveProofAction({
  action = "run",
  symbols = "",
  env = process.env,
  live = false,
  sendTx = null,
  fetchCalldata = null,
  liquidUsd = null,
  quotes = null,
} = {}) {
  if (action === "help") {
    return { ok: true, send: false, reply: waveProofUsageText() };
  }
  const result = await runWaveProof({
    body: WAVE_WISE_MESSAGE,
    symbols,
    env,
    live,
    sendTx,
    fetchCalldata,
    liquidUsd,
    quotes,
  });
  return {
    ok: result.ok,
    pass: result.pass === true,
    send: result.live === true,
    result,
    reply: result.ok === false && !result.inscribed
      ? "WAVE PROOF REFUSE\n" + (result.reason || "gate")
      : formatWaveProofCard(result),
  };
}
