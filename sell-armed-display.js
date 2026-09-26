/**
 * Peak / board SELLING is green only when the fill is sendable.
 *
 * Green = Quoter-executable AND always-plus would pass as PLUS.
 * Otherwise HOLD + exact code. SKIP_HITCH still sells plain (gate.allow)
 * but must not paint armed green — leftover is too thin for hitch.
 * Does not size P&L. Does not import the L1 oracle (board stays viem-free).
 */

export const SELL_HOLD_FIFO_RED = "FIFO_RED";
export const SELL_HOLD_UNKNOWN_COST = "UNKNOWN_COST";
export const SELL_HOLD_SKIP_HITCH = "SKIP_HITCH";
export const SELL_HOLD_THIN_LIQUID = "THIN_LIQUID";

export const SELL_HOLD_CODES = Object.freeze([
  SELL_HOLD_FIFO_RED,
  SELL_HOLD_UNKNOWN_COST,
  SELL_HOLD_SKIP_HITCH,
  SELL_HOLD_THIN_LIQUID,
]);

/**
 * Classify peak/board armed state from the same facts executeSell uses.
 * @returns {{ armed: boolean, green: boolean, label: string, code: string|null }}
 */
export function classifySellArmedDisplay({
  peakWantsSell = false,
  quoterExecutable = false,
  verdict = "HOLD",
  allow = false,
  unknownEntry = false,
  reason = "",
} = {}) {
  const v = String(verdict || "HOLD").toUpperCase();
  const why = String(reason || "");
  let code = null;
  if (!quoterExecutable) code = SELL_HOLD_THIN_LIQUID;
  else if (unknownEntry || /unknown cost/i.test(why)) code = SELL_HOLD_UNKNOWN_COST;
  else if (v === SELL_HOLD_SKIP_HITCH) code = SELL_HOLD_SKIP_HITCH;
  else if (
    v === "HOLD"
    || !allow
    || /FIFO red|proceeds below|would lose|USD-mark below/i.test(why)
  ) {
    code = SELL_HOLD_FIFO_RED;
  }

  const sendablePlus = quoterExecutable === true
    && allow === true
    && v === "PLUS"
    && !unknownEntry;
  if (peakWantsSell && sendablePlus) {
    return { armed: true, green: true, label: "SELLING", code: null };
  }
  if (!peakWantsSell) {
    return { armed: false, green: false, label: "HOLD", code: null };
  }
  return {
    armed: false,
    green: false,
    label: code ? `HOLD ${code}` : "HOLD",
    code: code || "HOLD",
  };
}
