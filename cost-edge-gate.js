/**
 * Cost-edge gate — refuse entries where hitch / round-trip cost already
 * dominates the stake or needs an unrealistic wait for a far peak.
 *
 * Live lesson (CBBTC / high unit-price majors on a ~$5–15 RISK book):
 * LOSE_ZERO leftover vs 90d BTC peak looked fine, hitch was "covered" in
 * price-space, then a fractional bag (< 1 unit) never hit sellable > 1 and
 * capital sat underwater waiting forever. Math must catch this *before* buy.
 *
 * Algorithms incorporated (practical Kelly / break-even execution cost):
 *   1. Hitch cost as % of trade — refuse if insert alone eats too much stake.
 *   2. Full round-trip cost % — refuse if fees+gas+hitch+impact > max.
 *   3. Near-term break-even — required move must clear costs vs recent high /
 *      short target, NOT a multi-month peak that may never return soon.
 *   4. Min notional from hitch — stake must be ≥ hitch / maxHitchPct.
 *   5. High unit-price demotion — CBBTC/AAVE-class need larger floors.
 *
 * Mistakes are recorded so the agent can learn and tighten caps over time.
 *
 * Operator / Telegram /buy skip the near-term upside check so KEEP ~$2
 * hitch/cascade probes can fill. Algo / wave / avenue still require it.
 */

export const MAX_HITCH_COST_PCT = 0.08;       // hitch alone ≤ 8% of trade
export const MAX_ROUND_TRIP_COST_PCT = 0.22;  // full RT ≤ 22% of stake (was 95%!)
export const MIN_NEAR_TERM_EDGE_MULT = 1.35;  // need ≥1.35× costs in near-term room
/** Thin books + cheap hitch: 1.15× BE (still never < 1×). Research 2026-09-08. */
export const THIN_BOOK_NEAR_TERM_MULT = 1.15;
export const THIN_BOOK_EDGE_USD = 15;
export const CHEAP_HITCH_PCT = 0.02;
export const HIGH_UNIT_MIN_BUY_USD = 25;      // CBBTC-class floor on small books
export const BAG_DUST_USD = 0.08;             // USD dust — never clear ledger below this without sell
export const SELLABLE_MIN_USD = 0.12;         // exit paths use USD, not token count > 1

/** Symbols whose unit price makes token-count gates lethal on small stakes. */
export const HIGH_UNIT_PRICE_SYMBOLS = Object.freeze([
  "CBBTC", "AAVE", "WBTC", "TBTC",
]);

const MISTAKE_RING_MAX = 40;
/** In-memory mistake ring (also persisted by agent when wired). */
export const costMistakeLog = [];

export function isHighUnitPriceSymbol(symbol) {
  const s = String(symbol || "").toUpperCase();
  return HIGH_UNIT_PRICE_SYMBOLS.includes(s) || s === "CBBTC";
}

/**
 * Adaptive near-term edge mult.
 * Thin books (<$15) with cheap hitch (<2% of stake): demand 1.15× break-even
 * instead of 1.35× so gas-dominated seats can still fill when hitch is nearly
 * free. High-unit majors keep the strict 1.35×. Never returns < 1.
 */
export function adaptiveNearTermEdgeMult({
  tradeableUsd = Infinity,
  hitchPct = 0,
  symbol = "",
  baseMult = MIN_NEAR_TERM_EDGE_MULT,
  thinMult = THIN_BOOK_NEAR_TERM_MULT,
  thinUsd = THIN_BOOK_EDGE_USD,
  cheapHitchPct = CHEAP_HITCH_PCT,
} = {}) {
  const base = Number(baseMult);
  const safeBase = Number.isFinite(base) && base >= 1 ? base : MIN_NEAR_TERM_EDGE_MULT;
  if (isHighUnitPriceSymbol(symbol)) return safeBase;
  const usd = Number(tradeableUsd);
  const hp = Number(hitchPct);
  const thin = Number.isFinite(usd) && usd > 0 && usd < thinUsd;
  const cheap = Number.isFinite(hp) && hp >= 0 && hp < cheapHitchPct;
  if (thin && cheap) {
    const t = Number(thinMult);
    const thinSafe = Number.isFinite(t) && t >= 1 ? t : THIN_BOOK_NEAR_TERM_MULT;
    return Math.min(safeBase, thinSafe);
  }
  return safeBase;
}

/**
 * Hitch / RT cost fractions of the actual trade size.
 */
export function costFractions({
  tradeEth = 0,
  hitchCostEth = 0,
  gasCostEth = 0,
  feePct = 0.006,
  impactPct = 0.003,
} = {}) {
  const trade = Math.max(0, Number(tradeEth) || 0);
  const hitch = Math.max(0, Number(hitchCostEth) || 0);
  const gas = Math.max(0, Number(gasCostEth) || 0);
  const fee = Math.max(0, Number(feePct) || 0);
  const impact = Math.max(0, Number(impactPct) || 0);
  // Both legs: buy + sell. Charging impact once understated RT and let thin
  // books arm seats that bleed after the exit (live $10→$6 leak).
  const feeEth = trade * fee * 2;
  const impactEth = trade * impact * 2;
  const gasEth = gas * 2;
  const rtEth = feeEth + impactEth + gasEth + hitch;
  return {
    tradeEth: trade,
    hitchEth: hitch,
    roundTripEth: rtEth,
    hitchPct: trade > 0 ? hitch / trade : Number.POSITIVE_INFINITY,
    roundTripPct: trade > 0 ? rtEth / trade : Number.POSITIVE_INFINITY,
  };
}

/**
 * Minimum trade ETH so hitch stays under maxHitchPct.
 */
export function minTradeEthForHitch(hitchCostEth, maxHitchPct = MAX_HITCH_COST_PCT) {
  const hitch = Math.max(0, Number(hitchCostEth) || 0);
  const cap = Number(maxHitchPct);
  if (!(hitch > 0)) return 0;
  if (!(cap > 0) || !(cap < 1)) return hitch * 12.5; // fallback ~8%
  return hitch / cap;
}

/**
 * Near-term upside room as a fraction of entry.
 * Prefer recent session high; fall back to a short fib-style +3% if flat.
 */
export function nearTermUpsidePct({
  price = 0,
  recentHigh = 0,
  shortTargetPct = 0.03,
} = {}) {
  const px = Number(price);
  if (!(px > 0)) return 0;
  const hi = Number(recentHigh);
  if (Number.isFinite(hi) && hi > px) return (hi - px) / px;
  const short = Number(shortTargetPct);
  return Number.isFinite(short) && short > 0 ? short : 0.03;
}

/**
 * Required price move to break even on round-trip costs (bps → pct).
 * required ≈ rt / (trade - rt) when rt < trade.
 */
export function requiredMovePctForCosts({ tradeEth = 0, roundTripEth = 0 } = {}) {
  const trade = Math.max(0, Number(tradeEth) || 0);
  const rt = Math.max(0, Number(roundTripEth) || 0);
  if (!(trade > 0)) return Number.POSITIVE_INFINITY;
  if (rt + 1e-12 >= trade) return Number.POSITIVE_INFINITY;
  return rt / (trade - rt);
}

/**
 * Core gate: allow only when costs leave real near-term edge.
 */
export function evaluateCostEdgeGate({
  symbol,
  tradeEth = 0,
  hitchCostEth = 0,
  gasCostEth = 0,
  feePct = 0.006,
  impactPct = 0.003,
  price = 0,
  recentHigh = 0,
  maxHitchPct = MAX_HITCH_COST_PCT,
  maxRoundTripPct = MAX_ROUND_TRIP_COST_PCT,
  nearTermEdgeMult = MIN_NEAR_TERM_EDGE_MULT,
  ethUsd = 0,
  tradeableUsd = 0,
  highUnitMinBuyUsd = HIGH_UNIT_MIN_BUY_USD,
  isManualOperator = false,
  /** When false, use nearTermEdgeMult as-is (A/B baseline). Default adapts thin+cheap. */
  adaptiveNearTerm = true,
  /**
   * Operator / Telegram /buy: skip the near-term upside (COST_EDGE) check.
   * Algo / wave / avenue keep the full gate. Hitch% + RT% still apply.
   */
  skipNearTermForOperator = true,
} = {}) {
  const sym = String(symbol || "?").toUpperCase();
  const fr = costFractions({ tradeEth, hitchCostEth, gasCostEth, feePct, impactPct });
  const needMove = requiredMovePctForCosts({
    tradeEth: fr.tradeEth,
    roundTripEth: fr.roundTripEth,
  });
  const nearUpside = nearTermUpsidePct({ price, recentHigh });
  const tradeUsd = fr.tradeEth * (Number(ethUsd) || 0);
  const highUnit = isHighUnitPriceSymbol(sym);
  // Caller may pass an explicit mult; otherwise adapt for thin+cheap-hitch books.
  const edgeMult = adaptiveNearTerm
    ? adaptiveNearTermEdgeMult({
        tradeableUsd,
        hitchPct: fr.hitchPct,
        symbol: sym,
        baseMult: nearTermEdgeMult,
      })
    : (Number.isFinite(Number(nearTermEdgeMult)) && Number(nearTermEdgeMult) >= 1
        ? Number(nearTermEdgeMult)
        : MIN_NEAR_TERM_EDGE_MULT);

  let allow = true;
  let reason = "ok";
  let code = "ok";

  // Operator /buy is the hitch/cascade test path: leftover+edge (LOSE-ZERO)
  // never block, and near-term COST_EDGE does not block either. Still refuse
  // catastrophic hitch% / RT% and high-unit smoke into CBBTC on pennies
  // (high-unit floors already waived via isManualOperator).
  const skipNearTerm = !!(isManualOperator && skipNearTermForOperator);
  const nearTermClears = nearUpside + 1e-12 >= needMove * edgeMult;
  if (!(fr.tradeEth > 0)) {
    allow = false;
    code = "no_size";
    reason = "no trade size";
  } else if (fr.hitchPct > maxHitchPct) {
    allow = false;
    code = "hitch_pct";
    reason = `hitch ${(fr.hitchPct * 100).toFixed(1)}% of stake > max ${(maxHitchPct * 100).toFixed(0)}% — insert costs more than edge room`;
  } else if (fr.roundTripPct > maxRoundTripPct) {
    allow = false;
    code = "rt_pct";
    reason = `round-trip ${(fr.roundTripPct * 100).toFixed(1)}% of stake > max ${(maxRoundTripPct * 100).toFixed(0)}%`;
  } else if (!skipNearTerm && !nearTermClears) {
    allow = false;
    code = "near_term";
    reason = `near-term upside ${(nearUpside * 100).toFixed(2)}% < ${(edgeMult).toFixed(2)}× required ${(needMove * 100).toFixed(2)}% — would wait forever on a far peak`;
  } else if (highUnit && tradeUsd > 0 && tradeUsd + 1e-9 < highUnitMinBuyUsd && !isManualOperator) {
    allow = false;
    code = "high_unit_floor";
    reason = `${sym} high unit-price needs ≥$${highUnitMinBuyUsd} (got $${tradeUsd.toFixed(2)}) — fractional bags strand exits`;
  } else if (
    highUnit &&
    Number(tradeableUsd) > 0 &&
    Number(tradeableUsd) < highUnitMinBuyUsd * 2 &&
    !isManualOperator
  ) {
    // Thin RISK book: never auto-allocate into CBBTC-class even if one slot looks sized
    allow = false;
    code = "high_unit_thin_book";
    reason = `${sym} blocked on thin book ($${Number(tradeableUsd).toFixed(2)} < $${(highUnitMinBuyUsd * 2).toFixed(0)}) — majors need larger capital`;
  }

  return {
    allow,
    code,
    reason,
    symbol: sym,
    hitchPct: fr.hitchPct,
    roundTripPct: fr.roundTripPct,
    requiredMovePct: needMove,
    nearTermUpsidePct: nearUpside,
    nearTermEdgeMult: edgeMult,
    tradeEth: fr.tradeEth,
    tradeUsd,
    highUnit,
    skipNearTerm,
    nearTermClears,
    log: allow
      ? (skipNearTerm && !nearTermClears
          ? `COST_EDGE ${sym}: operator skipped near-term (upside ${(nearUpside * 100).toFixed(2)}% < ${(edgeMult).toFixed(2)}× required ${(needMove * 100).toFixed(2)}%)`
          : null)
      : `🛑 COST_EDGE ${sym}: ${reason}`,
  };
}

/**
 * USD-aware bag checks — replace token-count > 1 / < 0.01 death traps.
 */
export function bagUsdValue(balance, priceUsd) {
  const b = Number(balance);
  const p = Number(priceUsd);
  if (!(b > 0) || !(p > 0)) return 0;
  return b * p;
}

export function isDustBagUsd(balance, priceUsd, dustUsd = BAG_DUST_USD) {
  const usd = bagUsdValue(balance, priceUsd);
  const floor = Math.max(0, Number(dustUsd) || BAG_DUST_USD);
  return usd > 0 && usd < floor;
}

/** True when bag has enough USD to run exit / cascade / fib paths. */
export function hasSellableUsd(balance, priceUsd, minUsd = SELLABLE_MIN_USD) {
  return bagUsdValue(balance, priceUsd) >= Math.max(0, Number(minUsd) || SELLABLE_MIN_USD);
}

/**
 * Record a refused or realized bad entry for forward learning.
 */
export function recordCostMistake(entry = {}) {
  const row = {
    at: new Date().toISOString(),
    symbol: String(entry.symbol || "?").toUpperCase(),
    code: entry.code || "unknown",
    reason: entry.reason || "",
    hitchPct: Number(entry.hitchPct) || 0,
    roundTripPct: Number(entry.roundTripPct) || 0,
    tradeUsd: Number(entry.tradeUsd) || 0,
    netUsd: entry.netUsd != null ? Number(entry.netUsd) : null,
    source: entry.source || "gate",
  };
  costMistakeLog.push(row);
  while (costMistakeLog.length > MISTAKE_RING_MAX) costMistakeLog.shift();
  return row;
}

export function summarizeCostMistakes(log = costMistakeLog) {
  const rows = Array.isArray(log) ? log : [];
  const byCode = {};
  const bySym = {};
  for (const r of rows) {
    byCode[r.code] = (byCode[r.code] || 0) + 1;
    bySym[r.symbol] = (bySym[r.symbol] || 0) + 1;
  }
  const topSym = Object.entries(bySym).sort((a, b) => b[1] - a[1])[0];
  const topCode = Object.entries(byCode).sort((a, b) => b[1] - a[1])[0];
  return {
    count: rows.length,
    byCode,
    bySym,
    topSymbol: topSym ? topSym[0] : null,
    topCode: topCode ? topCode[0] : null,
    message:
      rows.length === 0
        ? "No cost-edge mistakes recorded yet"
        : `COST_EDGE lessons: ${rows.length} · top ${topSym ? topSym[0] : "?"} (${topSym ? topSym[1] : 0}) · ${topCode ? topCode[0] : "?"}`,
  };
}

/**
 * Avenue-prime helper — same refuse codes for projected seats.
 */
export function avenueCostEdgeRefuse(args = {}) {
  const d = evaluateCostEdgeGate(args);
  if (d.allow) return null;
  return d.reason;
}
