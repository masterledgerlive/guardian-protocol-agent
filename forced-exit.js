/**
 * Forced exit for locked high-unit majors (CBBTC / AAVE) and Game priority
 * bags listed in FORCE_EXIT_SYMBOLS (AERO / DRB / BNKR).
 *
 * Live lesson: fractional CBBTC locked most of the RISK book. Goal is free the
 * cash with a CLEAN EXIT (no cascade redeploy), freeze the name so it cannot
 * re-enter, then hunt only profitable liquid books.
 *
 * Live lesson #2 (Railway after #91/#97): FORCE_EXIT leaves 1 wei (lottery-safe).
 * After redeploy the in-memory latch clears, so bal=3.5e-14 DRB re-queued every
 * cycle forever — exit fails / returns 0, never marks done, spam blocks real
 * message-carrying exits. Dust must latch done, not re-queue.
 *
 * Env:
 *   FORCE_EXIT_LOCKED_MAJORS=yes  — enable one-shot free (default yes when unset
 *                                   only if caller passes defaultYes; agent uses yes)
 *   FORCE_EXIT_SYMBOLS=CBBTC,AAVE — override list
 */

import {
  isHighUnitPriceSymbol,
  HIGH_UNIT_PRICE_SYMBOLS,
  hasSellableUsd,
  SELLABLE_MIN_USD,
} from "./cost-edge-gate.js";
import { piggyUnlockReason } from "./piggy-bank.js";

export const DEFAULT_FORCE_EXIT_SYMBOLS = Object.freeze(["CBBTC", "AAVE"]);

/**
 * Absolute float floor — 1-wei leftovers (DRB 3.5e-14 after lottery leave-behind)
 * must never re-arm FORCE EXIT. Below this = dust-latched.
 */
export const FORCE_EXIT_MIN_BALANCE = 1e-9;

export function forceExitLockedEnabled(env = process.env) {
  const raw = env?.FORCE_EXIT_LOCKED_MAJORS;
  if (raw == null || String(raw).trim() === "") return true; // default ON — free stranded BTC
  const v = String(raw).trim().toLowerCase();
  if (v === "no" || v === "0" || v === "false" || v === "off") return false;
  return v === "yes" || v === "1" || v === "true" || v === "on";
}

export function forceExitSymbols(env = process.env) {
  const raw = env?.FORCE_EXIT_SYMBOLS;
  if (raw != null && String(raw).trim() !== "") {
    return String(raw)
      .split(/[,;\s]+/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
  }
  return [...DEFAULT_FORCE_EXIT_SYMBOLS];
}

/**
 * True when the bag is worth a FORCE EXIT swap (not lottery 1-wei dust).
 * Price-aware when USD mark is known; absolute float floor always applies.
 */
export function isForceExitBagWorthQueuing(balance, priceUsd = 0, minUsd = SELLABLE_MIN_USD) {
  const bal = Number(balance) || 0;
  if (!(bal > 0)) return false;
  if (bal < FORCE_EXIT_MIN_BALANCE) return false;
  const px = Number(priceUsd) || 0;
  if (px > 0) return hasSellableUsd(bal, px, minUsd);
  // Unknown mark: still allow real float bags (CBBTC ~6e-5), block micro-dust.
  return bal >= FORCE_EXIT_MIN_BALANCE;
}

/**
 * Build exitonly command that unlocks piggy and suppresses cascade.
 */
export function forcedExitCommand(symbol) {
  const sym = String(symbol || "").toUpperCase();
  if (!sym) return null;
  return {
    symbol: sym,
    action: "exitonly",
    pct: 1,
    unlockPiggy: true,
    source: "FORCE_EXIT_LOCKED",
    reason: `${piggyUnlockReason(sym)} — FORCE EXIT LOCKED (cash free, no cascade)`,
  };
}

/**
 * Queue one forced exit per symbol that still has a sellable on-chain bag.
 * Latch `state.done[symbol]=true` after a successful fill (caller) OR when only
 * lottery/dust wei remains (so redeploy cannot re-spam forever).
 *
 * @param {object[]} commands — shared manualCommands queue
 * @param {Record<string, number>} balances — symbol → token balance
 * @param {{ done?: Record<string, boolean> }} state
 * @param {object} [opts]
 * @param {Record<string, number>} [opts.prices] — symbol → USD mark
 */
export function queueForcedLockedExits(
  commands,
  balances = {},
  state = { done: {} },
  opts = {},
) {
  const env = opts.env || process.env;
  if (!forceExitLockedEnabled(env)) {
    return { queued: [], skipped: [], reason: "disabled" };
  }
  if (!state.done || typeof state.done !== "object") state.done = {};
  const prices = opts.prices && typeof opts.prices === "object" ? opts.prices : {};
  const queued = [];
  const skipped = [];
  for (const sym of forceExitSymbols(env)) {
    if (state.done[sym]) {
      skipped.push({ symbol: sym, reason: "already-exited" });
      continue;
    }
    const bal = Number(balances[sym]) || 0;
    if (!(bal > 0)) {
      skipped.push({ symbol: sym, reason: "no-balance" });
      continue;
    }
    const px = Number(prices[sym]) || 0;
    if (!isForceExitBagWorthQueuing(bal, px)) {
      // Lottery 1-wei / unsellable dust after prior FORCE_EXIT — latch done.
      state.done[sym] = true;
      skipped.push({ symbol: sym, reason: "dust-latched", balance: bal });
      continue;
    }
    if (commands.some((c) => c.symbol === sym && (c.action === "exitonly" || c.source === "FORCE_EXIT_LOCKED"))) {
      skipped.push({ symbol: sym, reason: "already-queued" });
      continue;
    }
    const cmd = forcedExitCommand(sym);
    commands.push(cmd);
    queued.push({ symbol: sym, balance: bal });
  }
  return { queued, skipped, reason: queued.length ? "queued" : "none" };
}

export function markForcedExitExecuted(state, symbol) {
  if (!state.done || typeof state.done !== "object") state.done = {};
  state.done[String(symbol || "").toUpperCase()] = true;
  return state;
}

/**
 * After a failed / zero-proceed FORCE EXIT attempt, latch if only dust remains
 * so the next cycle does not re-queue (live DRB 3.5e-14 loop).
 */
export function latchForcedExitIfDust(state, symbol, balance, priceUsd = 0) {
  const sym = String(symbol || "").toUpperCase();
  if (!sym) return false;
  const bal = Number(balance) || 0;
  if (bal > 0 && isForceExitBagWorthQueuing(bal, priceUsd)) return false;
  markForcedExitExecuted(state, sym);
  return true;
}

/** Catalog freeze helper for locked majors. */
export function lockedMajorFreezeMeta(symbol) {
  const sym = String(symbol || "").toUpperCase();
  if (!isHighUnitPriceSymbol(sym) && !DEFAULT_FORCE_EXIT_SYMBOLS.includes(sym)) {
    return null;
  }
  return {
    frozen: true,
    injectMain: false,
    frozenReason:
      `${sym} LOCKED CLOSED — high unit-price stranded the RISK book. ` +
      `Exits allowed; new buys forbidden until capital + COST_EDGE explicitly reopen.`,
  };
}

export { HIGH_UNIT_PRICE_SYMBOLS };
