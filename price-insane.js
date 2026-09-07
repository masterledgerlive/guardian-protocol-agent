/**
 * PRICE_INSANE — refuse trades whose USD mark is fantasy.
 *
 * Live RISK TOSHI (0x50e1…7915): mark ~$69729 while DexScreener/Gecko
 * spot ~$0.000122. Quote-fallback then built amountOutMinimum ~91k–93k WETH
 * on ~4335 TOSHI. sanitizeAmountOutMinimum could not save that path because
 * expected/spot were derived from the same insane mark (or Quoter missed).
 *
 * This gate runs BEFORE hitch / LOSE_ZERO / piggy sizing / minOut so those
 * never compute leftover or floors from a moonshot mark.
 *
 * Independent DexScreener/Gecko must itself be a verified Uni/Aero WETH or
 * USDC pool. A $69729 “dex” print (Pancake TOSHI/VIRTUAL ghost) is rejected
 * as independent; if mark and independent are both fantasy vs last sane /
 * ETH-normalized, still refuse — do not cache the moonshot into both slots.
 *
 * Does not weaken LOSE_ZERO, frozen buy, 2× hitch, piggy dust, or minOut sanitize.
 */

import { isValidUsdPrice } from "./price-oracle.js";

/** Official Uniswap V3 QuoterV2 on Base mainnet (docs.uniswap.org Base deployments). */
export const BASE_QUOTER_V2 = "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a";

/**
 * Address that was wired as "Base QuoterV2" — invalid on Base.
 * Shares the 0x3d4e44Eb1374240CE5F1B prefix with the real Base Quoter but
 * the rest is wrong-chain / garbled. Do not call this.
 */
export const INVALID_BASE_QUOTER_V2 = "0x3d4e44Eb1374240CE5F1B136041212501e4a098e";

/** Ethereum mainnet QuoterV2 — must never be used on Base. */
export const ETHEREUM_QUOTER_V2 = "0x61fFE014bA17989E743c5F6cB21bF9697530B21e";

export const PRICE_INSANE_MIN_RATIO = 0.01;  // mark / ref < 0.01×
export const PRICE_INSANE_MAX_RATIO = 100;   // mark / ref > 100×
export const RISK_START_USD_DEFAULT = 15;    // ~$3–11 RISK bag, padded
export const BAG_VS_RISK_MULT = 100;         // implied bag ≫ RISK start
export const SLIP_RETRY_MAX = 3;
export const SLIP_COOLDOWN_MS = 30 * 60 * 1000;
/** After a PRICE_INSANE refuse, skip re-fetch / re-attempt for this window. Still refuse. */
export const PRICE_INSANE_RETRY_COOLDOWN_MS = 10 * 60 * 1000;
/** Do not reprint the same PRICE_INSANE line every loop minute. */
export const PRICE_INSANE_LOG_COOLDOWN_MS = 15 * 60 * 1000;

/** Live incident fixtures — regression. */
export const TOSHI_MOONSHOT_MARK_USD = 69729;
export const TOSHI_GECKO_SPOT_USD = 0.000122;
export const TOSHI_BAG_UNITS = 4335;

const lastSaneUsd = Object.create(null); // { [symbol]: number }
const lastSaneTrusted = new WeakMap();   // store → { [symbol]: bool }
const slipFails = Object.create(null);   // { [symbol]: { count, cooledUntil } }
const insaneBackoff = Object.create(null); // { [symbol]: { cooledUntil, lastLogAt, lastDecision } }

function trustedMapFor(store) {
  let m = lastSaneTrusted.get(store);
  if (!m) {
    m = Object.create(null);
    lastSaneTrusted.set(store, m);
  }
  return m;
}

export function envNumber(name, fallback, env = process.env) {
  const n = Number(env?.[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function priceInsaneMinRatio(env = process.env) {
  return envNumber("PRICE_INSANE_MIN_RATIO", PRICE_INSANE_MIN_RATIO, env);
}

export function priceInsaneMaxRatio(env = process.env) {
  return envNumber("PRICE_INSANE_MAX_RATIO", PRICE_INSANE_MAX_RATIO, env);
}

export function riskStartUsd(env = process.env) {
  return envNumber("RISK_START_USD", RISK_START_USD_DEFAULT, env);
}

export function bagVsRiskMult(env = process.env) {
  return envNumber("BAG_VS_RISK_MULT", BAG_VS_RISK_MULT, env);
}

export function slipRetryMax(env = process.env) {
  const n = Number(env?.SLIP_RETRY_MAX);
  if (Number.isFinite(n) && n >= 1) return Math.floor(n);
  return SLIP_RETRY_MAX;
}

export function slipCooldownMs(env = process.env) {
  return envNumber("SLIP_COOLDOWN_MS", SLIP_COOLDOWN_MS, env);
}

export function markRatio(markUsd, referenceUsd) {
  const m = Number(markUsd);
  const r = Number(referenceUsd);
  if (!isValidUsdPrice(m) || !isValidUsdPrice(r)) return null;
  return m / r;
}

export function impliedBagUsd(balance, markUsd) {
  const bal = Number(balance);
  const mark = Number(markUsd);
  if (!Number.isFinite(bal) || bal <= 0 || !isValidUsdPrice(mark)) return 0;
  return bal * mark;
}

export function getLastSaneUsd(symbol, store = lastSaneUsd) {
  const p = store?.[String(symbol || "").toUpperCase()];
  return isValidUsdPrice(p) ? p : null;
}

/**
 * Remember a DexScreener/Gecko (or other independent) quote as the last sane seed.
 * Refuses to store a quote that is itself insane vs the previous seed — unless
 * the new quote is from a verified WETH/USDC pool and the previous seed was not
 * (recovers from a cached $69729 fantasy).
 */
export function noteLastSaneUsd(symbol, usd, store = lastSaneUsd, { trusted = false } = {}) {
  const sym = String(symbol || "").toUpperCase();
  if (!sym || !isValidUsdPrice(usd)) return false;
  const flags = trustedMapFor(store);
  const prev = getLastSaneUsd(sym, store);
  if (prev != null) {
    const ratio = usd / prev;
    if (ratio < PRICE_INSANE_MIN_RATIO || ratio > PRICE_INSANE_MAX_RATIO) {
      if (trusted && !flags[sym]) {
        store[sym] = usd;
        flags[sym] = true;
        return true;
      }
      return false;
    }
  }
  store[sym] = usd;
  if (trusted) flags[sym] = true;
  return true;
}

/**
 * Drop an independent quote that is 100×+ off last sane or ETH-normalized spot.
 * A $69729 “dex” TOSHI print vs ~$0.00012 seed is rejected; ~1.2e-4 is kept.
 */
export function sanitizeIndependentUsd(independentUsd, {
  lastSaneUsd: seed = null,
  ethNormalizedUsd = null,
  minRatio = PRICE_INSANE_MIN_RATIO,
  maxRatio = PRICE_INSANE_MAX_RATIO,
} = {}) {
  if (!isValidUsdPrice(independentUsd)) {
    return { usd: null, rejected: false, vs: null, anchorUsd: null, ratio: null };
  }
  const ind = Number(independentUsd);
  const anchors = [
    { usd: seed, src: "last-sane" },
    { usd: ethNormalizedUsd, src: "eth-normalized" },
  ].filter((a) => isValidUsdPrice(a.usd));
  for (const a of anchors) {
    const ratio = ind / Number(a.usd);
    if (ratio < minRatio || ratio > maxRatio) {
      return { usd: null, rejected: true, vs: a.src, anchorUsd: Number(a.usd), ratio };
    }
  }
  return { usd: ind, rejected: false, vs: null, anchorUsd: null, ratio: null };
}

export function isPriceJumpInsane(nextUsd, prevUsd, {
  minRatio = PRICE_INSANE_MIN_RATIO,
  maxRatio = PRICE_INSANE_MAX_RATIO,
} = {}) {
  if (!isValidUsdPrice(nextUsd) || !isValidUsdPrice(prevUsd)) return false;
  const ratio = Number(nextUsd) / Number(prevUsd);
  return ratio < minRatio || ratio > maxRatio;
}

export function pickPriceReference({
  independentUsd,
  lastSaneUsd: seed,
  ethNormalizedUsd = null,
} = {}) {
  if (isValidUsdPrice(independentUsd)) {
    return { usd: Number(independentUsd), src: "dex/gecko" };
  }
  if (isValidUsdPrice(seed)) {
    return { usd: Number(seed), src: "last-sane" };
  }
  if (isValidUsdPrice(ethNormalizedUsd)) {
    return { usd: Number(ethNormalizedUsd), src: "eth-normalized" };
  }
  return { usd: null, src: null };
}

/**
 * @returns {{ allow: boolean, code: string|null, log: string, reason: string,
 *             ratio: number|null, bagUsd: number, refUsd: number|null, refSrc: string|null }}
 */
export function evaluatePriceInsane({
  symbol = "?",
  markUsd,
  independentUsd = null,
  lastSaneUsd: seed = null,
  ethNormalizedUsd = null,
  balance = 0,
  riskStart = RISK_START_USD_DEFAULT,
  bagMult = BAG_VS_RISK_MULT,
  minRatio = PRICE_INSANE_MIN_RATIO,
  maxRatio = PRICE_INSANE_MAX_RATIO,
  side = "trade",
} = {}) {
  const sym = String(symbol || "?").toUpperCase();
  const mark = Number(markUsd);
  const bagUsd = impliedBagUsd(balance, mark);
  const start = Number(riskStart);
  const mult = Number(bagMult);
  const bagCap = (Number.isFinite(start) && start > 0 && Number.isFinite(mult) && mult > 0)
    ? start * mult
    : RISK_START_USD_DEFAULT * BAG_VS_RISK_MULT;

  const saneInd = sanitizeIndependentUsd(independentUsd, {
    lastSaneUsd: seed,
    ethNormalizedUsd,
    minRatio,
    maxRatio,
  });

  if (!isValidUsdPrice(mark)) {
    return {
      allow: false,
      code: "PRICE_INSANE",
      reason: "no-mark",
      ratio: null,
      bagUsd,
      refUsd: null,
      refSrc: null,
      independentRejected: saneInd.rejected,
      independentUsd: saneInd.usd,
      log: `🛑 PRICE_INSANE ${side} ${sym} — no usable USD mark — refuse (do not compute hitch/minOut from fantasy)`,
    };
  }

  const ref = pickPriceReference({
    independentUsd: saneInd.usd,
    lastSaneUsd: seed,
    ethNormalizedUsd,
  });
  const ratio = ref.usd != null ? markRatio(mark, ref.usd) : null;

  if (ratio != null && (ratio < minRatio || ratio > maxRatio)) {
    return {
      allow: false,
      code: "PRICE_INSANE",
      reason: "ratio",
      ratio,
      bagUsd,
      refUsd: ref.usd,
      refSrc: ref.src,
      independentRejected: saneInd.rejected,
      independentUsd: saneInd.usd,
      log:
        `🛑 PRICE_INSANE ${side} ${sym} — mark $${mark} vs ${ref.src} $${ref.usd} ` +
        `is ${ratio.toExponential(2)}× (band ${minRatio}×–${maxRatio}×). ` +
        `Refuse — do not compute hitch/minOut from fantasy.`,
    };
  }

  if (bagUsd > bagCap) {
    return {
      allow: false,
      code: "PRICE_INSANE",
      reason: "bag",
      ratio,
      bagUsd,
      refUsd: ref.usd,
      refSrc: ref.src,
      independentRejected: saneInd.rejected,
      independentUsd: saneInd.usd,
      log:
        `🛑 PRICE_INSANE ${side} ${sym} — implied bag $${bagUsd.toFixed(2)} ` +
        `≫ RISK start $${start} (cap $${bagCap.toFixed(0)} = ${mult}×). ` +
        `Mark $${mark}${ref.usd != null ? ` vs ${ref.src} $${ref.usd}` : " (no independent ref)"}. ` +
        `Refuse — do not compute hitch/minOut from fantasy.`,
    };
  }

  return {
    allow: true,
    code: null,
    reason: "ok",
    ratio,
    bagUsd,
    refUsd: ref.usd,
    refSrc: ref.src,
    independentRejected: saneInd.rejected,
    independentUsd: saneInd.usd,
    log: null,
  };
}

export function isTooLittleReceived(err) {
  const s = String(err?.message || err || "");
  return /too little received/i.test(s);
}

export function isSlippageCooledDown(symbol, now = Date.now(), store = slipFails) {
  const row = store[String(symbol || "").toUpperCase()];
  if (!row || !row.cooledUntil) return false;
  return now < row.cooledUntil;
}

export function slippageCooldownLog(symbol, now = Date.now(), store = slipFails) {
  const sym = String(symbol || "?").toUpperCase();
  const row = store[sym];
  const leftMs = row?.cooledUntil ? Math.max(0, row.cooledUntil - now) : 0;
  const leftMin = (leftMs / 60000).toFixed(1);
  return `🧊 SELL SKIPPED [${sym}]: Too little received cooldown (${leftMin}m left) — not burning more gas`;
}

/**
 * Record a consecutive Too-little-received (or 0-fill revert) failure.
 * After N fails, arm a cooldown so the retry loop stops paying gas.
 */
export function recordSlippageFail(symbol, now = Date.now(), {
  max = SLIP_RETRY_MAX,
  cooldownMs = SLIP_COOLDOWN_MS,
  store = slipFails,
} = {}) {
  const sym = String(symbol || "?").toUpperCase();
  const row = store[sym] || { count: 0, cooledUntil: 0 };
  if (row.cooledUntil && now < row.cooledUntil) {
    return { count: row.count, cooled: true, cooledUntil: row.cooledUntil, store };
  }
  if (row.cooledUntil && now >= row.cooledUntil) {
    row.count = 0;
    row.cooledUntil = 0;
  }
  row.count += 1;
  let cooled = false;
  if (row.count >= max) {
    row.cooledUntil = now + cooldownMs;
    cooled = true;
  }
  store[sym] = row;
  return { count: row.count, cooled, cooledUntil: row.cooledUntil, max, store };
}

export function clearSlippageFails(symbol, store = slipFails) {
  const sym = String(symbol || "").toUpperCase();
  if (sym) delete store[sym];
}

export function slippageFailLog(symbol, rec) {
  const sym = String(symbol || "?").toUpperCase();
  const n = rec?.count || 0;
  const max = rec?.max || SLIP_RETRY_MAX;
  if (rec?.cooled) {
    return `🧊 [${sym}] Too little received ×${n} — cooldown armed, stop burning gas`;
  }
  return `⚠️  [${sym}] Too little received (${n}/${max}) — will cooldown after ${max}`;
}

/**
 * A swap that mined but delivered 0 ETH / reverted is a FAIL, not a win.
 * receiptStatus: 'success' | 'reverted' | 'unknown'
 */
export function isSuccessfulSellFill({ received, receiptStatus } = {}) {
  if (receiptStatus === "reverted" || receiptStatus === 0 || receiptStatus === "0x0") {
    return false;
  }
  const got = Number(received);
  return Number.isFinite(got) && got > 0;
}

export function failedFillLog(symbol, { received = 0, receiptStatus = "unknown", txHash = "" } = {}) {
  const got = Number(received) || 0;
  const tx = txHash ? ` tx=${txHash}` : "";
  return (
    `❌ SELL FAILED [${symbol}]: ${receiptStatus === "reverted" ? "swap reverted" : "Received 0.000000 ETH"} ` +
    `(got ${got.toFixed(6)} ETH${tx}) — not a win, not logging success`
  );
}

/**
 * A buy that mined but delivered 0 tokens / reverted is a FAIL, not a win.
 * Telegram / ledger / Eureka letter must not fire on a hallucinated fill.
 */
export function isSuccessfulBuyFill({ receivedTokens, receiptStatus } = {}) {
  if (receiptStatus === "reverted" || receiptStatus === 0 || receiptStatus === "0x0") {
    return false;
  }
  const got = Number(receivedTokens);
  return Number.isFinite(got) && got > 0;
}

export function failedBuyFillLog(symbol, { receivedTokens = 0, receiptStatus = "unknown", txHash = "" } = {}) {
  const got = Number(receivedTokens) || 0;
  const tx = txHash ? ` tx=${txHash}` : "";
  return (
    `❌ BUY FAILED [${symbol}]: ${receiptStatus === "reverted" ? "swap reverted" : "Received 0 tokens"} ` +
    `(got ${got.toFixed(6)} tokens${tx}) — not a win, not logging success, letter not claimed`
  );
}

/** Console helper used by log-formatter: 0 ETH is never a profit checkmark. */
export function sellFillIsWin(received, netUsd) {
  return Number(received) > 0 && Number(netUsd) >= 0;
}

export function isBaseQuoterV2(address) {
  return String(address || "").toLowerCase() === BASE_QUOTER_V2.toLowerCase();
}

export function priceInsaneRetryCooldownMs(env = process.env) {
  return envNumber("PRICE_INSANE_RETRY_COOLDOWN_MS", PRICE_INSANE_RETRY_COOLDOWN_MS, env);
}

export function priceInsaneLogCooldownMs(env = process.env) {
  return envNumber("PRICE_INSANE_LOG_COOLDOWN_MS", PRICE_INSANE_LOG_COOLDOWN_MS, env);
}

export function recordPriceInsaneRefuse(symbol, decision, now = Date.now(), {
  retryMs = PRICE_INSANE_RETRY_COOLDOWN_MS,
  store = insaneBackoff,
} = {}) {
  const sym = String(symbol || "?").toUpperCase();
  const prev = store[sym];
  store[sym] = {
    cooledUntil: now + retryMs,
    lastLogAt: prev?.lastLogAt || 0,
    lastDecision: decision || prev?.lastDecision || null,
  };
  return store[sym];
}

export function isPriceInsaneCooledDown(symbol, now = Date.now(), store = insaneBackoff) {
  const row = store[String(symbol || "").toUpperCase()];
  if (!row || !row.cooledUntil) return false;
  return now < row.cooledUntil;
}

export function shouldLogPriceInsane(symbol, now = Date.now(), {
  logMs = PRICE_INSANE_LOG_COOLDOWN_MS,
  store = insaneBackoff,
} = {}) {
  const row = store[String(symbol || "").toUpperCase()];
  if (!row || !row.lastLogAt) return true;
  return now - row.lastLogAt >= logMs;
}

export function markPriceInsaneLogged(symbol, now = Date.now(), store = insaneBackoff) {
  const sym = String(symbol || "").toUpperCase();
  if (!sym) return;
  const row = store[sym] || { cooledUntil: 0, lastDecision: null };
  row.lastLogAt = now;
  store[sym] = row;
}

export function peekPriceInsaneBackoff(symbol, store = insaneBackoff) {
  return store[String(symbol || "").toUpperCase()] || null;
}

export function clearPriceInsaneBackoff(symbol, store = insaneBackoff) {
  const sym = String(symbol || "").toUpperCase();
  if (sym) delete store[sym];
}

export function priceInsaneBackoffLog(symbol, now = Date.now(), store = insaneBackoff) {
  const sym = String(symbol || "?").toUpperCase();
  const row = store[sym];
  const leftMs = row?.cooledUntil ? Math.max(0, row.cooledUntil - now) : 0;
  const leftMin = (leftMs / 60000).toFixed(1);
  return `🛑 PRICE_INSANE ${sym} — still refused (${leftMin}m backoff, skip re-attempt) — do not compute hitch/minOut from fantasy`;
}
