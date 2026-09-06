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

/**
 * `PIGGY_BANK_PCT` — fraction in (0, 1). Also accepts `2` as 2%.
 * Invalid / missing → 2%.
 */
export function piggyBankPct(env = process.env) {
  const raw = env?.PIGGY_BANK_PCT;
  if (raw == null || String(raw).trim() === "") return DEFAULT_PIGGY_BANK_PCT;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_PIGGY_BANK_PCT;
  if (n === 0) return 0;
  if (n > 0 && n < 1) return n;
  if (n >= 1 && n <= 50) return n / 100;
  return DEFAULT_PIGGY_BANK_PCT;
}

/**
 * `PIGGY_BANK_MIN_USD` — USD floor converted to token units via live price.
 * Invalid / missing → $0.05. `0` disables the floor.
 */
export function piggyBankMinUsd(env = process.env) {
  const raw = env?.PIGGY_BANK_MIN_USD;
  if (raw == null || String(raw).trim() === "") return DEFAULT_PIGGY_BANK_MIN_USD;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_PIGGY_BANK_MIN_USD;
  return n;
}

export function sanitizePiggyReserve(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Target reserve from *current* balance (not the persisted high-water mark).
 * max(pct × balance, minUsd / price), never more than balance.
 */
export function computePiggyTarget(balance, priceUsd, env = process.env) {
  const bal = Math.max(0, Number(balance) || 0);
  if (bal <= 0) return 0;
  const fromPct = bal * piggyBankPct(env);
  const price = Number(priceUsd);
  const minUsd = piggyBankMinUsd(env);
  const fromUsd = Number.isFinite(price) && price > 0 && minUsd > 0
    ? minUsd / price
    : 0;
  return Math.min(bal, Math.max(fromPct, fromUsd));
}

/**
 * Floor-up ratchet. Never auto-decreases. Capped at current balance so a
 * persisted reserve cannot exceed what the wallet still holds.
 */
export function ratchetPiggyReserve(existingReserve, balance, priceUsd, env = process.env) {
  const existing = sanitizePiggyReserve(existingReserve);
  const bal = Math.max(0, Number(balance) || 0);
  if (bal <= 0) return existing > 0 ? 0 : 0;
  const target = computePiggyTarget(bal, priceUsd, env);
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
} = {}) {
  const bal = Math.max(0, Number(balance) || 0);
  const pct = Math.max(0, Math.min(1, Number(sellPct) || 0));
  const unlock = isPiggyUnlock(reason);
  const reserve = ratchetPiggyReserve(piggyReserve, bal, priceUsd, env);
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
