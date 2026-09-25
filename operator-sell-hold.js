/**
 * Operator sell hold — freeze every bag sell until Game approves.
 *
 * HOLD_ALL_SELLS=yes blocks auto / cascade / fib / stale / stop-loss /
 * OPERATOR_SELL / Telegram /sell /exit / FORCE EXIT. Lift only when the
 * operator sets HOLD_ALL_SELLS=no (or unset) after explicit approve.
 *
 * $HOME is never sold while this hold is on, and stays never-sell even
 * after other bags reopen unless APPROVE_HOME_SELL=yes (default off).
 * Rotate already skips HOME; this gate is the hard stop for every path.
 *
 * Never invents tx hashes. Never sells red to place code.
 */

import { VERIFIED_HOME_SYMBOL } from "./operator-rotate.js";

export const HOLD_ALL_SELLS_ENV = "HOLD_ALL_SELLS";
export const APPROVE_HOME_SELL_ENV = "APPROVE_HOME_SELL";
export const HOLD_ALL_SELLS_REASON = "HOLD_ALL_SELLS — no sells until operator approves";
export const HOLD_HOME_SELL_REASON = "HOME hold — never sell until operator approves APPROVE_HOME_SELL";

function normSym(symbol) {
  return String(symbol || "").trim().toUpperCase();
}

function envYes(name, env = process.env) {
  return String(env?.[name] ?? "").trim().toLowerCase() === "yes";
}

function envNo(name, env = process.env) {
  const s = String(env?.[name] ?? "").trim().toLowerCase();
  return s === "no" || s === "0" || s === "false" || s === "off";
}

/** True when Game armed a global no-sell freeze. */
export function isHoldAllSells(env = process.env) {
  if (envNo(HOLD_ALL_SELLS_ENV, env)) return false;
  return envYes(HOLD_ALL_SELLS_ENV, env);
}

/** Arm the freeze in-process (and for Railway set-variables callers). */
export function armHoldAllSells(env = process.env) {
  if (!env || typeof env !== "object") return env;
  env[HOLD_ALL_SELLS_ENV] = "yes";
  return env;
}

/** Lift only after explicit operator approve. */
export function clearHoldAllSells(env = process.env) {
  if (!env || typeof env !== "object") return env;
  env[HOLD_ALL_SELLS_ENV] = "no";
  return env;
}

export function isHomeSymbol(symbol) {
  return normSym(symbol) === VERIFIED_HOME_SYMBOL;
}

/**
 * HOME stays locked unless APPROVE_HOME_SELL=yes.
 * Default / unset = never sell HOME (matches catalog + rotate policy).
 */
export function isHomeSellApproved(env = process.env) {
  return envYes(APPROVE_HOME_SELL_ENV, env);
}

export function shouldNeverSellHome(symbol, env = process.env) {
  if (!isHomeSymbol(symbol)) return false;
  return !isHomeSellApproved(env);
}

/**
 * Hard sell block. Returns { block, why, code } when the swap must not send.
 * HOME never-sell is checked first so an accidental APPROVE path still
 * cannot dump the cascade piggy holder without APPROVE_HOME_SELL.
 */
export function shouldBlockSell({
  symbol = "",
  reason = "",
  env = process.env,
} = {}) {
  void reason;
  if (shouldNeverSellHome(symbol, env)) {
    return {
      block: true,
      why: HOLD_HOME_SELL_REASON,
      code: "HOLD_HOME",
      symbol: VERIFIED_HOME_SYMBOL,
    };
  }
  if (isHoldAllSells(env)) {
    return {
      block: true,
      why: HOLD_ALL_SELLS_REASON,
      code: "HOLD_ALL_SELLS",
      symbol: normSym(symbol) || "?",
    };
  }
  return { block: false, why: "", code: "", symbol: normSym(symbol) || "?" };
}

/** Telegram / boot log line. */
export function holdAllSellsStatusLine(env = process.env) {
  const all = isHoldAllSells(env);
  const home = !isHomeSellApproved(env);
  if (all) {
    return `🛑 HOLD_ALL_SELLS=yes — no token sells until you approve (HOME never-sell ${home ? "on" : "lifted"})`;
  }
  if (home) {
    return `🏠 HOME never-sell on (APPROVE_HOME_SELL unset) — other bags may sell when gated green`;
  }
  return `HOLD_ALL_SELLS off · APPROVE_HOME_SELL=yes (HOME sells allowed)`;
}
