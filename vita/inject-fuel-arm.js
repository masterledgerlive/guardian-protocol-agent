/**
 * INJECT FUEL HOLD arm — known bag is recycle-ready but LOSE-ZERO red.
 *
 * Never sell red to place code. Arm a learn shard so the moment leftover
 * clears PLUS, recycle fires with message-first KEY+LOC memory hitch.
 * Storage Token can charge the transmission delta. Mother brain untouched.
 */

export const INJECT_FUEL_ARM_ID = "inject-fuel-memory-arm";

/**
 * % mark rise needed so USD-mark proceeds clear entrySold after fee+impact.
 * Null when already clear or inputs unusable. Never invents P&L.
 */
export function injectFuelPctToGreen({
  markProceedsEth = 0,
  entrySoldEth = 0,
  feePct = 0.01,
  impactPct = 0.003,
} = {}) {
  const mark = Number(markProceedsEth);
  const entry = Number(entrySoldEth);
  if (!(mark > 0) || !(entry > 0)) return null;
  const keep = 1 - Math.max(0, Number(feePct) || 0) - Math.max(0, Number(impactPct) || 0);
  if (!(keep > 0)) return null;
  const netMark = mark * keep;
  if (netMark + 1e-18 >= entry) return 0;
  return (entry / netMark) - 1;
}

/**
 * Arm memory hitch for a known inject-fuel bag stuck on HOLD.
 * Does not sell. Does not call vitaSave / inscribeChunk / mother-genesis.
 */
export function armInjectFuelMemoryHitch({
  symbol = "?",
  posUsd = 0,
  leftoverEth = 0,
  entrySoldEth = 0,
  markProceedsEth = 0,
  feePct = 0.01,
  impactPct = 0.003,
  reason = "INJECT FUEL HOLD — wait PLUS for memory hitch",
} = {}) {
  const pct = injectFuelPctToGreen({
    markProceedsEth,
    entrySoldEth,
    feePct,
    impactPct,
  });
  const sym = String(symbol || "?").toUpperCase();
  const left = Number(leftoverEth);
  return {
    id: INJECT_FUEL_ARM_ID,
    symbol: sym,
    posUsd: Number.isFinite(Number(posUsd)) ? Number(posUsd) : 0,
    leftoverEth: Number.isFinite(left) ? left : 0,
    entrySoldEth: Number(entrySoldEth) > 0 ? Number(entrySoldEth) : 0,
    markProceedsEth: Number(markProceedsEth) > 0 ? Number(markProceedsEth) : 0,
    pctToGreen: pct,
    armed: true,
    sellRed: false,
    hitchWhenPlus: true,
    formula: "original-message-first",
    motherBrain: "untouched",
    neverSellRedToInject: true,
    storageTokenChargeable: true,
    reason: String(reason || "INJECT FUEL HOLD"),
    text:
      `${sym} inject-fuel armed — LOSE-ZERO HOLD (do not sell red). `
      + "Recycle + KEY+LOC memory hitch when leftover clears PLUS. "
      + "Storage Token can charge transmission delta. Mother brain untouched.",
  };
}

export function formatInjectFuelHoldArmLog(arm) {
  if (!arm || !arm.armed) return "";
  const usd = Number(arm.posUsd);
  const pct = arm.pctToGreen;
  const pctNote = pct == null
    ? "pct-to-green unknown"
    : pct <= 0
      ? "mark already clears fees — gate may still HOLD on gas"
      : `~${(pct * 100).toFixed(1)}% mark rise to clear fees for PLUS`;
  const bag = Number.isFinite(usd) && usd > 0 ? `$${usd.toFixed(2)}` : "bag";
  return (
    `🌙 INJECT FUEL ${arm.symbol}: HOLD ${bag} — wait PLUS (${pctNote}); `
    + "memory hitch armed (never sell red to inject)"
  );
}
