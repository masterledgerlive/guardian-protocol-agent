/**
 * Avenue priming — projected costs per path, keep the 2–3 best ready for cascade.
 *
 * Goal: before a sell frees capital, the next avenues are already ranked by
 * expected outcome vs cost. Thin books refuse paths that cannot clear fees+hitch
 * without losing money. As capital grows, the path that makes the most *and*
 * can fit the most hitch code for the least cost wins, then cascades into the
 * next primed seat without a long cold search.
 */

import {
  effectiveMinEntryEth,
  CASCADE_SEED_USD,
  DEFAULT_IMPACT_PCT,
} from "./cascade-rollover.js";
import {
  CALLDATA_GAS_PER_NONZERO_BYTE,
  STORE_HITCH_BYTES,
  DEFAULT_HITCH_COST_MULT,
  hitchCostMult,
} from "./lose-zero-gate.js";
import {
  evaluateCostEdgeGate,
  MAX_ROUND_TRIP_COST_PCT,
} from "./cost-edge-gate.js";

export const PRIMED_TOP_N = 3;
export const PRIMED_MIN_N = 2;

/**
 * Round-trip cost projection in ETH for a given spend size.
 * Includes buy+sell pool fees, impact, gas both ways, and hitch insert.
 */
export function projectRoundTripCostEth({
  tradeEth = 0,
  gasCostEth = 0,
  hitchCostEth = 0,
  feePct = 0.006,
  impactPct = DEFAULT_IMPACT_PCT,
} = {}) {
  const trade = Math.max(0, Number(tradeEth) || 0);
  const gas = Math.max(0, Number(gasCostEth) || 0);
  const hitch = Math.max(0, Number(hitchCostEth) || 0);
  const fee = Math.max(0, Number(feePct) || 0);
  const impact = Math.max(0, Number(impactPct) || 0);
  // Round-trip: fee + impact on buy AND sell (match calcNetMargin / COST_EDGE).
  const feeEth = trade * fee * 2;
  const impactEth = trade * impact * 2;
  const gasEth = gas * 2;
  const costEth = feeEth + impactEth + gasEth + hitch;
  const costPct = trade > 0 ? costEth / trade : Number.POSITIVE_INFINITY;
  return {
    costEth,
    costPct,
    feeEth,
    impactEth,
    gasEth,
    hitchEth: hitch,
  };
}

/** How many hitch bytes leftover can pay for (L2 calldata + optional L1/byte). */
export function hitchBytesAffordable({
  leftoverEth = 0,
  gwei = 0,
  hitchCostMult: mult = DEFAULT_HITCH_COST_MULT,
  l1FeePerByteEth = 0,
  providerFeeEth = 0,
} = {}) {
  const leftover = Number(leftoverEth);
  const m = Number.isFinite(Number(mult)) && Number(mult) > 0 ? Number(mult) : DEFAULT_HITCH_COST_MULT;
  if (!Number.isFinite(leftover) || leftover <= 0) return 0;
  const budget = leftover / m - Math.max(0, Number(providerFeeEth) || 0);
  if (!(budget > 0)) return 0;
  const g = Number(gwei);
  const l2 = Number.isFinite(g) && g > 0 ? CALLDATA_GAS_PER_NONZERO_BYTE * g * 1e-9 : 0;
  const l1 = Math.max(0, Number(l1FeePerByteEth) || 0);
  const perByte = l2 + l1;
  if (!(perByte > 0)) return Number.MAX_SAFE_INTEGER;
  return Math.max(0, Math.floor(budget / perByte));
}

/**
 * Project one avenue. `allow=false` when spend cannot clear costs / would lose.
 */
export function projectAvenue({
  symbol,
  tradeEth = 0,
  gasCostEth = 0,
  hitchCostEth = 0,
  feePct = 0.006,
  impactPct = DEFAULT_IMPACT_PCT,
  netMargin = 0,
  minNetMargin = 0.025,
  armed = false,
  nearEntry = false,
  injectMain = false,
  tokenScore = 0,
  gwei = 0,
  hitchBytesWanted = STORE_HITCH_BYTES,
  ethUsd = 0,
  tokenMinBuyUsd = 0,
  minPosUsd = 0.5,
  cascadeSeedUsd = CASCADE_SEED_USD,
  hitchMult,
  l1FeePerByteEth = 0,
  price = 0,
  recentHigh = 0,
  tradeableUsd = 0,
  env = process.env,
} = {}) {
  const sym = String(symbol || "?").toUpperCase();
  const trade = Math.max(0, Number(tradeEth) || 0);
  const net = Number(netMargin) || 0;
  const minNm = Number(minNetMargin) || 0;
  const costs = projectRoundTripCostEth({
    tradeEth: trade,
    gasCostEth,
    hitchCostEth,
    feePct,
    impactPct,
  });
  const minEntry = effectiveMinEntryEth({
    gasCostEth,
    hitchCostEth,
    feePct,
    impactPct,
    ethUsd,
    tokenMinBuyUsd,
    minPosUsd,
    cascadeSeedUsd,
  });

  const expectedGrossEth = trade * Math.max(0, net);
  // Net after explicit hitch (arm.net already strips fees/gas; still subtract hitch insert)
  const expectedNetEth = expectedGrossEth - Math.max(0, Number(hitchCostEth) || 0);
  const leftoverAfterCostEth = expectedNetEth;
  const mult = hitchMult != null ? hitchMult : hitchCostMult(env);
  const wanted = Math.max(1, Math.floor(Number(hitchBytesWanted) || STORE_HITCH_BYTES));
  const bytesFit = hitchBytesAffordable({
    leftoverEth: Math.max(0, leftoverAfterCostEth),
    gwei,
    hitchCostMult: mult,
    l1FeePerByteEth,
  });
  const hitchBytesFit = Math.min(wanted, bytesFit === Number.MAX_SAFE_INTEGER ? wanted : bytesFit);

  const costEdge = evaluateCostEdgeGate({
    symbol: sym,
    tradeEth: trade,
    hitchCostEth,
    gasCostEth,
    feePct,
    impactPct,
    price,
    recentHigh,
    ethUsd,
    tradeableUsd: tradeableUsd || trade * (Number(ethUsd) || 0),
    maxRoundTripPct: MAX_ROUND_TRIP_COST_PCT,
  });

  let allow = true;
  let refuseReason = null;
  if (!(trade > 0)) {
    allow = false;
    refuseReason = "no trade size";
  } else if (minEntry > 0 && trade + 1e-12 < minEntry) {
    allow = false;
    refuseReason = "below min entry (fees+hitch+cascade seed)";
  } else if (!armed && !nearEntry) {
    allow = false;
    refuseReason = "not armed / not near entry";
  } else if (net > 0 && net < minNm && !nearEntry) {
    allow = false;
    refuseReason = "net margin below floor";
  } else if (!(expectedNetEth > 0)) {
    // Would cost more than any projected leftover — refuse (lose-zero)
    allow = false;
    refuseReason = "projected costs wipe leftover (would lose)";
  } else if (!costEdge.allow) {
    allow = false;
    refuseReason = costEdge.reason;
  } else if (costs.costPct > MAX_ROUND_TRIP_COST_PCT) {
    allow = false;
    refuseReason = "round-trip cost dominates stake";
  }

  const readyNow = !!(nearEntry || (armed && nearEntry !== false && net >= minNm));
  // Prefer ready near-entry; still score armed waves so cascade has a bench.
  const readyBoost = nearEntry ? 1.6 : armed ? 1.15 : 1;
  const codeFit = hitchBytesFit / wanted; // 0..1 how much Eureka/code fits
  const costEff = costs.costEth > 0 ? expectedNetEth / costs.costEth : expectedNetEth;
  const px = Number(ethUsd) || 0;
  const expectedNetUsd = expectedNetEth * px;
  // Growing capital: most profit × most code / least cost wins.
  const outcomeScore = allow
    ? Math.max(
        0,
        (expectedNetUsd + Math.max(0, Number(tokenScore) || 0) * 0.01) *
          (1 + codeFit) *
          Math.max(0.05, costEff) *
          readyBoost *
          (injectMain ? 1.25 : 1)
      )
    : -1;

  return {
    symbol: sym,
    allow,
    refuseReason,
    tradeEth: trade,
    minEntryEth: minEntry,
    projectedCostEth: costs.costEth,
    projectedCostPct: costs.costPct,
    expectedNetEth,
    expectedNetUsd,
    leftoverAfterCostEth,
    hitchBytesWanted: wanted,
    hitchBytesFit,
    codeFit,
    costEff,
    readyNow: allow && (nearEntry || armed),
    nearEntry: !!nearEntry,
    injectMain: !!injectMain,
    armed: !!armed,
    netMargin: net,
    tokenScore: Number(tokenScore) || 0,
    outcomeScore,
  };
}

/**
 * Rank candidates and keep the top 2–3 allowed avenues primed for cascade.
 */
export function primeAvenues(candidates = [], { topN = PRIMED_TOP_N, minN = PRIMED_MIN_N } = {}) {
  const n = Math.max(minN, Math.min(PRIMED_TOP_N, Math.floor(Number(topN) || PRIMED_TOP_N)));
  const projected = (Array.isArray(candidates) ? candidates : []).map((c) =>
    c && typeof c.outcomeScore === "number" && c.symbol ? c : projectAvenue(c)
  );
  const allowed = projected.filter((a) => a.allow).sort((a, b) => b.outcomeScore - a.outcomeScore);
  const refused = projected.filter((a) => !a.allow);
  const primed = allowed.slice(0, n);
  return {
    primed,
    refused,
    best: primed[0] || null,
    next: primed[1] || null,
    topN: n,
    kind: "avenue_prime",
  };
}

/**
 * How far price sits above the confirmed MIN trough (0 = at bottom).
 * null when math cannot score the seat.
 */
export function pctAboveTrough(price, minTrough) {
  const px = Number(price);
  const lo = Number(minTrough);
  if (!(px > 0) || !(lo > 0)) return null;
  return Math.max(0, (px - lo) / lo);
}

/**
 * Cascade entry band above trough — wider when the projected net is large /
 * the seat is already primed READY. High-% primed opportunities should not
 * wait for a perfect 1% print while proceeds park as ETH.
 */
export const CASCADE_BOTTOM_BAND_BASE = 0.025; // 2.5%
export const CASCADE_BOTTOM_BAND_STANDARD = 0.04; // 4%
export const CASCADE_BOTTOM_BAND_PRIORITY = 0.055; // 5.5%
export const CASCADE_BOTTOM_BAND_PRIMED = 0.045; // 4.5% primed READY / near-entry

export function cascadeBottomBand({
  netMargin = 0,
  primedReady = false,
  nearEntry = false,
  priorityMargin = 0.05,
} = {}) {
  if (primedReady || nearEntry) return CASCADE_BOTTOM_BAND_PRIMED;
  const net = Number(netMargin) || 0;
  if (net >= Number(priorityMargin) || net >= 0.05) return CASCADE_BOTTOM_BAND_PRIORITY;
  if (net >= 0.03) return CASCADE_BOTTOM_BAND_STANDARD;
  return CASCADE_BOTTOM_BAND_BASE;
}

/**
 * Eligible cascade bottom: within band of MIN trough, or already primed near-entry.
 * ETH is fee/gas fuel only — we score bottoms so capital redeploys instead of waiting.
 */
export function isCascadeBottomEligible({
  price = 0,
  minTrough = 0,
  netMargin = 0,
  primedReady = false,
  nearEntry = false,
  priorityMargin = 0.05,
  maxBand = null,
} = {}) {
  if (nearEntry && (primedReady || (Number(netMargin) || 0) > 0)) return true;
  const pct = pctAboveTrough(price, minTrough);
  if (pct == null) return false;
  const band =
    maxBand != null && Number.isFinite(Number(maxBand))
      ? Math.max(0, Number(maxBand))
      : cascadeBottomBand({ netMargin, primedReady, nearEntry, priorityMargin });
  return pct <= band + 1e-12;
}

/**
 * Rank score: lowest % above trough wins, then highest projected net / outcome.
 * Primed READY seats get a small boost so cost-checked avenues beat cold scans.
 */
export function scoreCascadeBottom({
  price = 0,
  minTrough = 0,
  netMargin = 0,
  outcomeScore = 0,
  primedReady = false,
  nearEntry = false,
  priorityMargin = 0.05,
} = {}) {
  if (
    !isCascadeBottomEligible({
      price,
      minTrough,
      netMargin,
      primedReady,
      nearEntry,
      priorityMargin,
    })
  ) {
    return -1;
  }
  const pct = pctAboveTrough(price, minTrough);
  // Invert distance-to-bottom (0% above → ~1.0; far → smaller).
  // Primed near-entry without a live print still outranks idle ETH parking.
  const closeness =
    pct == null
      ? primedReady || nearEntry
        ? 0.85
        : 0
      : 1 / (1 + pct * 40);
  const net = Math.max(0, Number(netMargin) || 0);
  const outcome = Math.max(0, Number(outcomeScore) || 0);
  const readyBoost = primedReady || nearEntry ? 1.25 : 1;
  // Primary: closest bottom; secondary: projected upside math already set on the avenue
  return (closeness * 10 + net * 8 + outcome * 0.002) * readyBoost;
}

/**
 * Rank cascade candidates: direct into next-best lowest bottoms with upside.
 * Each item: { symbol, price, minTrough, netMargin, outcomeScore, readyNow, nearEntry, allow }.
 */
export function rankCascadeBottoms(candidates = [], { excludeSymbol = null, requireReady = false } = {}) {
  const exclude = excludeSymbol ? String(excludeSymbol).toUpperCase() : null;
  const scored = (Array.isArray(candidates) ? candidates : [])
    .filter((a) => a && a.allow !== false && a.symbol && String(a.symbol).toUpperCase() !== exclude)
    .map((a) => {
      const score = scoreCascadeBottom({
        price: a.price,
        minTrough: a.minTrough,
        netMargin: a.netMargin,
        outcomeScore: a.outcomeScore,
        primedReady: !!(a.readyNow || a.primedReady),
        nearEntry: !!a.nearEntry,
      });
      return { ...a, cascadeBottomScore: score, pctAboveTrough: pctAboveTrough(a.price, a.minTrough) };
    })
    .filter((a) => a.cascadeBottomScore >= 0);
  const ready = scored.filter((a) => a.readyNow || a.primedReady || a.nearEntry);
  const pool = requireReady ? ready : scored;
  return pool.slice().sort((a, b) => {
    // Lowest % above trough first among similar scores; else higher cascadeBottomScore
    const s = (b.cascadeBottomScore || 0) - (a.cascadeBottomScore || 0);
    if (Math.abs(s) > 1e-9) return s;
    const pA = a.pctAboveTrough == null ? 99 : a.pctAboveTrough;
    const pB = b.pctAboveTrough == null ? 99 : b.pctAboveTrough;
    if (pA !== pB) return pA - pB;
    return (Number(b.netMargin) || 0) - (Number(a.netMargin) || 0);
  });
}

/**
 * Pick the next cascade target from a primed list (already cost-checked).
 * Prefer lowest-% bottoms with projected upside; fall back to outcomeScore.
 */
export function pickCascadeFromPrimed(primed = [], { excludeSymbol = null, requireReady = false } = {}) {
  const exclude = excludeSymbol ? String(excludeSymbol).toUpperCase() : null;
  const list = (Array.isArray(primed) ? primed : []).filter(
    (a) => a && a.allow && a.symbol && a.symbol !== exclude
  );
  if (!list.length) return null;
  // When price/trough are present, rank by lowest bottom + projected net
  const withBottom = list.filter((a) => Number(a.price) > 0 && Number(a.minTrough) > 0);
  if (withBottom.length) {
    const ranked = rankCascadeBottoms(withBottom, { excludeSymbol, requireReady });
    if (ranked.length) return ranked[0];
  }
  const ready = list.filter((a) => a.readyNow);
  const pool = requireReady ? ready : ready.length ? ready : list;
  if (!pool.length) return null;
  return pool.slice().sort((a, b) => b.outcomeScore - a.outcomeScore)[0];
}

/**
 * How many seats to prime for this book size.
 * Thin / inject-all → 1–2; normal → 3; rich → still 3 (focus).
 */
export function primedSeatCount(tradeableUsd, { injectAll = false, smallBook = false } = {}) {
  const usd = Number(tradeableUsd);
  if (injectAll || (Number.isFinite(usd) && usd > 0 && usd < 12)) return 1;
  if (smallBook || (Number.isFinite(usd) && usd < 15)) return 2;
  return PRIMED_TOP_N;
}

/** Compact log line for the main loop. */
export function formatPrimedAvenues(primeResult) {
  const list = primeResult?.primed || [];
  if (!list.length) return "🎯 PRIMED: none (all avenues refuse cost / not ready)";
  return (
    "🎯 PRIMED: " +
    list
      .map(
        (a, i) =>
          `${i + 1}.${a.symbol}` +
          `(net~$${a.expectedNetUsd.toFixed(2)}` +
          ` cost${(a.projectedCostPct * 100).toFixed(1)}%` +
          ` code${a.hitchBytesFit}B` +
          `${a.readyNow ? " READY" : ""})`
      )
      .join(" › ")
  );
}
