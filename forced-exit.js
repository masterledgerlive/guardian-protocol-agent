/**
 * Forced exit for locked high-unit majors (CBBTC / AAVE).
 *
 * Live lesson: fractional CBBTC locked most of the RISK book. Goal is free the
 * cash with a CLEAN EXIT (no cascade redeploy), freeze the name so it cannot
 * re-enter, then hunt only profitable liquid books.
 *
 * Env:
 *   FORCE_EXIT_LOCKED_MAJORS=yes  — enable one-shot free (default yes when unset
 *                                   only if caller passes defaultYes; agent uses yes)
 *   FORCE_EXIT_SYMBOLS=CBBTC,AAVE — override list
 */

import { isHighUnitPriceSymbol, HIGH_UNIT_PRICE_SYMBOLS } from "./cost-edge-gate.js";
import { piggyUnlockReason } from "./piggy-bank.js";

export const DEFAULT_FORCE_EXIT_SYMBOLS = Object.freeze(["CBBTC", "AAVE"]);

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
 * Queue one forced exit per symbol that still has an on-chain bag.
 * Latch `state.done[symbol]=true` only after a successful fill (caller marks).
 *
 * @param {object[]} commands — shared manualCommands queue
 * @param {Record<string, number>} balances — symbol → token balance
 * @param {{ done?: Record<string, boolean> }} state
 * @param {object} [opts]
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
