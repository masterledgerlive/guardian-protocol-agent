/**
 * Per-token piggy-bank dust reserve.
 *
 * Every position keeps a growing never-sell pile. Wave / moonshot / cascade /
 * operator /sell / sellhalf / fib / stale / stop-loss must leave that dust
 * behind. Dust is sold only when Game/operator explicitly unlocks it
 * (reason prefix `PIGGY UNLOCK` or Telegram `/piggyunlock SYMBOL`).
 *
 * Sizing hypothesis (sane defaults, env-overridable):
 *   PIGGY_BANK_PCT      = 2% of current token units (matches the old lottery %).
 *   PIGGY_BANK_MIN_USD  = $0.05 floor so a tiny bag still leaves a real pile
 *                         if 2% would be dust-of-dust. No min-token-count floor
 *                         (1 TOSHI is worthless; 1 CBBTC would trap the bag).
 *
 * Ratchet: reserve floors up when balance grows. It never auto-decreases.
 * After a partial sell the persisted reserve stays at the high-water mark
 * (capped only at remaining on-chain units). Unlock is the only path that
 * may shrink or clear the pile.
 *
 * Ledger rule: peak gates and post-fill PnL must charge only the sold fraction
 * of entry cost (`previewPiggySellNetUsd` / `costBasisForSoldFraction`). Leaving
 * dust behind leaves that cost behind — otherwise succession math fails.
 *
 * Nested ledgers (`buildTokenPiggyLedger`): dust + ETH contrib + agent share
 * per inject seat. Agent share funds future AI piggy banks; dust stays locked.
 *
 * This does not replace the ETH skim `piggyBank` in positions.json — that is
 * a different pool. This module is token-unit dust on each bag.
 */

export const PIGGY_UNLOCK_PREFIX = "PIGGY UNLOCK";
export const DEFAULT_PIGGY_BANK_PCT = 0.02;
export const DEFAULT_PIGGY_BANK_MIN_USD = 0.05;

/** True iff reason starts with `PIGGY UNLOCK` (case-insensitive). */
export function isPiggyUnlock(reason = "") {
  return String(reason || "").toUpperCase().startsWith(PIGGY_UNLOCK_PREFIX);
}

export function piggyUnlockReason(symbol = "") {
  const sym = String(symbol || "").trim().toUpperCase();
  return sym ? `${PIGGY_UNLOCK_PREFIX} ${sym}` : PIGGY_UNLOCK_PREFIX;
}

/** Parse `0.08` / `8` / `8%` style percents into a fraction in [0, 0.5]. */
export function parsePiggyPctValue(raw, fallback = DEFAULT_PIGGY_BANK_PCT) {
  if (raw == null || String(raw).trim() === "") return fallback;
  let s = String(raw).trim();
  if (s.endsWith("%")) s = s.slice(0, -1).trim();
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return fallback;
  if (n === 0) return 0;
  if (n > 0 && n < 1) return n;
  if (n >= 1 && n <= 50) return n / 100;
  return fallback;
}

/**
 * `PIGGY_BANK_PCT` — fraction in (0, 1). Also accepts `2` as 2%.
 * Invalid / missing → 2%.
 *
 * Per-token override order (highest wins):
 *   1. `opts.piggyBankPct` from the catalog row
 *   2. env `PIGGY_BANK_PCT_<SYMBOL>` (e.g. `PIGGY_BANK_PCT_LINK=8`)
 *   3. global `PIGGY_BANK_PCT`
 */
export function piggyBankPct(env = process.env, opts = {}) {
  if (opts?.piggyBankPct != null && opts.piggyBankPct !== "") {
    return parsePiggyPctValue(opts.piggyBankPct, DEFAULT_PIGGY_BANK_PCT);
  }
  const sym = String(opts?.symbol || "").trim().toUpperCase();
  if (sym) {
    const key = `PIGGY_BANK_PCT_${sym}`;
    if (env?.[key] != null && String(env[key]).trim() !== "") {
      return parsePiggyPctValue(env[key], DEFAULT_PIGGY_BANK_PCT);
    }
  }
  return parsePiggyPctValue(env?.PIGGY_BANK_PCT, DEFAULT_PIGGY_BANK_PCT);
}

/**
 * `PIGGY_BANK_MIN_USD` — USD floor converted to token units via live price.
 * Invalid / missing → $0.05. `0` disables the floor.
 * Per-token: catalog `piggyBankMinUsd` or env `PIGGY_BANK_MIN_USD_<SYMBOL>`.
 */
export function piggyBankMinUsd(env = process.env, opts = {}) {
  if (opts?.piggyBankMinUsd != null && opts.piggyBankMinUsd !== "") {
    const n = Number(opts.piggyBankMinUsd);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  const sym = String(opts?.symbol || "").trim().toUpperCase();
  if (sym) {
    const key = `PIGGY_BANK_MIN_USD_${sym}`;
    if (env?.[key] != null && String(env[key]).trim() !== "") {
      const n = Number(env[key]);
      if (Number.isFinite(n) && n >= 0) return n;
    }
  }
  const raw = env?.PIGGY_BANK_MIN_USD;
  if (raw == null || String(raw).trim() === "") return DEFAULT_PIGGY_BANK_MIN_USD;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_PIGGY_BANK_MIN_USD;
  return n;
}

/** Bundle catalog + symbol opts for piggy helpers. */
export function piggyOptsFromToken(token = {}, extra = {}) {
  return {
    symbol: token?.symbol,
    piggyBankPct: token?.piggyBankPct,
    piggyBankMinUsd: token?.piggyBankMinUsd,
    ...extra,
  };
}

export function sanitizePiggyReserve(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Target reserve from *current* balance (not the persisted high-water mark).
 * max(pct × balance, minUsd / price), never more than balance.
 * Pass `opts` (`symbol` / catalog pct) for per-token leave-behind (LINK = 8%).
 */
export function computePiggyTarget(balance, priceUsd, env = process.env, opts = {}) {
  const bal = Math.max(0, Number(balance) || 0);
  if (bal <= 0) return 0;
  const fromPct = bal * piggyBankPct(env, opts);
  const price = Number(priceUsd);
  const minUsd = piggyBankMinUsd(env, opts);
  const fromUsd = Number.isFinite(price) && price > 0 && minUsd > 0
    ? minUsd / price
    : 0;
  return Math.min(bal, Math.max(fromPct, fromUsd));
}

/**
 * Floor-up ratchet. Never auto-decreases. Capped at current balance so a
 * persisted reserve cannot exceed what the wallet still holds.
 */
export function ratchetPiggyReserve(existingReserve, balance, priceUsd, env = process.env, opts = {}) {
  const existing = sanitizePiggyReserve(existingReserve);
  const bal = Math.max(0, Number(balance) || 0);
  if (bal <= 0) return existing > 0 ? 0 : 0;
  const target = computePiggyTarget(bal, priceUsd, env, opts);
  return Math.min(bal, Math.max(existing, target));
}

/**
 * sellable = balance − piggyReserve unless unlock.
 */
export function computeSellable(balance, piggyReserve, { unlock = false } = {}) {
  const bal = Math.max(0, Number(balance) || 0);
  if (unlock) return bal;
  return Math.max(0, bal - sanitizePiggyReserve(piggyReserve));
}

/**
 * After a fill: unlock may shrink the pile to remaining units.
 * Non-unlock keeps the high-water mark, capped at remaining units.
 */
export function remainingPiggyAfterSell(existingReserve, remainingBalance, { unlock = false } = {}) {
  const existing = sanitizePiggyReserve(existingReserve);
  const remain = Math.max(0, Number(remainingBalance) || 0);
  if (remain <= 0) return 0;
  if (unlock) return Math.min(existing, remain);
  return Math.min(remain, existing);
}

/**
 * Single decision used by every sell path.
 *
 * `sellPct` is applied to *sellable* units (not the full bag) so a 100%
 * request still leaves dust unless `reason` is a piggy unlock.
 */
export function applyPiggyToSell({
  balance,
  sellPct = 1,
  piggyReserve = 0,
  priceUsd,
  reason = "",
  env = process.env,
  symbol,
  piggyBankPct: catalogPct,
  piggyBankMinUsd: catalogMinUsd,
  token,
} = {}) {
  const opts = piggyOptsFromToken(token || {}, {
    symbol: symbol || token?.symbol,
    piggyBankPct: catalogPct ?? token?.piggyBankPct,
    piggyBankMinUsd: catalogMinUsd ?? token?.piggyBankMinUsd,
  });
  const bal = Math.max(0, Number(balance) || 0);
  const pct = Math.max(0, Math.min(1, Number(sellPct) || 0));
  const unlock = isPiggyUnlock(reason);
  const reserve = ratchetPiggyReserve(piggyReserve, bal, priceUsd, env, opts);
  const sellable = computeSellable(bal, reserve, { unlock });
  const tokensToSell = sellable * pct;
  const remainingBalance = Math.max(0, bal - tokensToSell);
  const remainingReserve = remainingPiggyAfterSell(reserve, remainingBalance, { unlock });
  return {
    unlock,
    reserve,
    sellable,
    tokensToSell,
    remainingBalance,
    remainingReserve,
    blocked: tokensToSell <= 0,
    soldAll: remainingBalance <= 1e-12,
    piggyPct: piggyBankPct(env, opts),
    piggyMinUsd: piggyBankMinUsd(env, opts),
  };
}

/**
 * Parse `/piggyunlock SYMBOL`. Does not match `/piggy`.
 * @returns {{ symbol: string } | null}
 */
export function parsePiggyUnlockCommand(raw) {
  const parts = String(raw || "").trim().split(/\s+/);
  const verb = (parts[0] || "").toLowerCase();
  if (verb !== "/piggyunlock") return null;
  const symbol = (parts[1] || "").toUpperCase();
  if (!symbol) return null;
  return { symbol };
}

/** Restore persisted reserve from tokens.json and/or positions.json. */
export function loadPiggyReserve(token, positionsMap) {
  const fromToken = sanitizePiggyReserve(token?.piggyReserve);
  const sym = token?.symbol;
  const fromPos = sym ? sanitizePiggyReserve(positionsMap?.[sym]) : 0;
  return Math.max(fromToken, fromPos);
}

/**
 * Cost basis for tokens actually sold after piggy.
 * Dust left behind keeps its slice of entry — charging 100% cost against a
 * piggy-capped sell flips real profits into fake losses on the ledger.
 */
export function costBasisForSoldFraction(totalInvestedEth, soldFrac) {
  const inv = Math.max(0, Number(totalInvestedEth) || 0);
  const f = Math.max(0, Math.min(1, Number(soldFrac) || 0));
  return inv * f;
}

/**
 * Preview net USD when selling `sellable` and leaving the piggy pile untouched.
 * Peak / fib / early-sell gates must use this so succession math matches
 * executeSell (soldFrac × entry, fees/skim on sold proceeds only).
 */
export function previewPiggySellNetUsd({
  balance,
  sellable,
  investedEth = 0,
  priceUsd,
  ethUsd,
  feePct = 0.006,
  skimPct = 0.01,
} = {}) {
  const bal = Math.max(0, Number(balance) || 0);
  const sell = Math.max(0, Number(sellable) || 0);
  const px = Number(priceUsd);
  const eth = Number(ethUsd);
  if (!(bal > 0) || !(sell > 0) || !(px > 0) || !(eth > 0)) {
    return {
      soldFrac: 0,
      proceedsUsd: 0,
      costUsd: 0,
      feesUsd: 0,
      skimUsd: 0,
      netUsd: 0,
    };
  }
  const soldFrac = Math.min(1, sell / bal);
  const proceedsUsd = sell * px;
  const costUsd = costBasisForSoldFraction(investedEth, soldFrac) * eth;
  const feesUsd = proceedsUsd * Math.max(0, Number(feePct) || 0);
  const skimUsd = proceedsUsd * Math.max(0, Number(skimPct) || 0);
  return {
    soldFrac,
    proceedsUsd,
    costUsd,
    feesUsd,
    skimUsd,
    netUsd: proceedsUsd - costUsd - feesUsd - skimUsd,
  };
}

/**
 * Nested per-token piggy ledger — dust on each inject seat, plus ETH/agent
 * shares skimmed from that token's profitable exits. AI piggy banks later
 * draw from agentShare; dust stays untouched unless explicit unlock.
 */
export function buildTokenPiggyLedger({
  symbol = "",
  dustReserve = 0,
  dustUsd = 0,
  ethContrib = 0,
  agentShare = 0,
} = {}) {
  return {
    symbol: String(symbol || "").trim().toUpperCase(),
    dustReserve: sanitizePiggyReserve(dustReserve),
    dustUsd: Math.max(0, Number(dustUsd) || 0),
    ethContrib: Math.max(0, Number(ethContrib) || 0),
    agentShare: Math.max(0, Number(agentShare) || 0),
  };
}

/** Credit ETH piggy / agent slices onto a per-token nested ledger row. */
export function creditTokenPiggyPools(ledger, { ethContrib = 0, agentShare = 0, symbol } = {}) {
  const base = ledger && typeof ledger === "object"
    ? { ...ledger }
    : buildTokenPiggyLedger({ symbol });
  if (symbol && !base.symbol) base.symbol = String(symbol).trim().toUpperCase();
  base.ethContrib = Math.max(0, (Number(base.ethContrib) || 0) + Math.max(0, Number(ethContrib) || 0));
  base.agentShare = Math.max(0, (Number(base.agentShare) || 0) + Math.max(0, Number(agentShare) || 0));
  base.dustReserve = sanitizePiggyReserve(base.dustReserve);
  base.dustUsd = Math.max(0, Number(base.dustUsd) || 0);
  return base;
}

/** Unrealized co-invest mark (tokens × price − ethIn × ethUsd). */
export function piggyCoInvestMarkUsd({ tokens = 0, priceUsd = 0, ethIn = 0, ethUsd = 0 } = {}) {
  const mark = Math.max(0, Number(tokens) || 0) * Math.max(0, Number(priceUsd) || 0);
  const cost = Math.max(0, Number(ethIn) || 0) * Math.max(0, Number(ethUsd) || 0);
  return mark - cost;
}
