/**
 * Cascade min-entry + continuous rollover math.
 *
 * Live Railway 2026-09-08: tradeable fell 0.0024 → 0.000485 after four tiny
 * buys. Chain ETH+WETH matched the bot (~$5 liquid) — capital sat in bags,
 * BALANCE LOW fired, buys denied as Insufficient. Fragmented entries cannot
 * clear round-trip fees + hitch and still seed the next low.
 *
 * Rules:
 *   1. Minimum entry covers buy+sell gas, pool fees, hitch, and a cascade seed.
 *   2. Thin books inject ALL tradeable into ONE seat (not split T1/T2).
 *   3. Cascade deploys only after a profitable exit, sized ≥ next min entry.
 *   4. Piggy dust is never part of deployable proceeds.
 *   5. Liquid-thin + bags deployed ≠ empty wallet — recycle, don't panic top-up.
 */

export const INJECT_ALL_USD = 12;
export const CASCADE_SEED_USD = 0.75;
export const ROUND_TRIP_BUFFER = 1.35;
export const DEFAULT_IMPACT_PCT = 0.003;
export const LIQUID_STARVE_USD = 2.5;
export const DEPLOYED_BAGS_WARN_USD = 1.5;
/** Full sell reserve only when the book can afford it. */
export const FULL_SELL_RESERVE_ETH = 0.001;
export const THIN_BOOK_ETH = 0.01;

/**
 * Round-trip floor in ETH so a fill can exit, hitch, and still leave cascade seed.
 *
 * tradeEth * (1 - 2*fee - impact) - 2*gas - hitch >= seed
 * tradeEth >= (2*gas + hitch + seed) / (1 - costPct) * buffer
 */
export function minEntryEth({
  gasCostEth = 0,
  hitchCostEth = 0,
  feePct = 0.006,
  impactPct = DEFAULT_IMPACT_PCT,
  cascadeSeedEth = 0,
  buffer = ROUND_TRIP_BUFFER,
} = {}) {
  const gas = Math.max(0, Number(gasCostEth) || 0);
  const hitch = Math.max(0, Number(hitchCostEth) || 0);
  const seed = Math.max(0, Number(cascadeSeedEth) || 0);
  const fee = Math.max(0, Number(feePct) || 0);
  const impact = Math.max(0, Number(impactPct) || 0);
  const costPct = 2 * fee + impact;
  const denom = 1 - costPct;
  if (!(denom > 0.5)) {
    // Pathological fee book — refuse tiny probes
    return Number.POSITIVE_INFINITY;
  }
  const raw = (2 * gas + hitch + seed) / denom;
  const buf = Number(buffer);
  const mult = Number.isFinite(buf) && buf >= 1 ? buf : ROUND_TRIP_BUFFER;
  return Math.max(0, raw * mult);
}

export function cascadeSeedEth(ethUsd, seedUsd = CASCADE_SEED_USD) {
  const px = Number(ethUsd);
  const usd = Number(seedUsd);
  if (!(px > 0) || !(usd >= 0)) return 0;
  return usd / px;
}

/**
 * Effective minimum entry for a token: max(computed floor, catalog/token min, MIN_POS).
 */
export function effectiveMinEntryEth({
  gasCostEth,
  hitchCostEth,
  feePct,
  impactPct,
  ethUsd,
  tokenMinBuyUsd = 0,
  minPosUsd = 0.5,
  cascadeSeedUsd = CASCADE_SEED_USD,
  buffer = ROUND_TRIP_BUFFER,
} = {}) {
  const seed = cascadeSeedEth(ethUsd, cascadeSeedUsd);
  const computed = minEntryEth({
    gasCostEth,
    hitchCostEth,
    feePct,
    impactPct,
    cascadeSeedEth: seed,
    buffer,
  });
  const px = Number(ethUsd);
  const floorUsd = Math.max(Number(tokenMinBuyUsd) || 0, Number(minPosUsd) || 0);
  const fromUsd = px > 0 ? floorUsd / px : 0;
  if (!Number.isFinite(computed)) return fromUsd;
  return Math.max(computed, fromUsd);
}

/**
 * Thin-book / inject-all tier params — one seat, 100% of tradeable.
 * Larger books keep the caller defaults (small-book or classic).
 */
export function injectAllBookParams(tradeableUsd, base = {}) {
  const usd = Number(tradeableUsd);
  if (Number.isFinite(usd) && usd > 0 && usd < INJECT_ALL_USD) {
    return {
      ...base,
      smallBook: true,
      injectAll: true,
      tier1Count: 1,
      tier1Pct: 1,
      tier2Pct: 0,
      tier2MinSlotUsd: Number.POSITIVE_INFINITY,
      tier2MaxSlots: 0,
    };
  }
  return { ...base, injectAll: false };
}

/**
 * How much of sell proceeds to cascade into the next low.
 * Leaves nothing for piggy (piggy is token-side). Caps at avail.
 * Requires proceeds ≥ target min entry or returns 0 (hold cash for next cycle).
 */
export function cascadeDeployEth({
  proceedsEth = 0,
  targetMinEntryEth = 0,
  netMargin = 0,
  deployPct = null,
} = {}) {
  const proceeds = Math.max(0, Number(proceedsEth) || 0);
  const minE = Math.max(0, Number(targetMinEntryEth) || 0);
  if (!(proceeds > 0)) return 0;
  if (minE > 0 && proceeds + 1e-12 < minE) return 0;

  let pct = Number(deployPct);
  if (!Number.isFinite(pct) || pct <= 0) {
    const net = Number(netMargin) || 0;
    if (net >= 0.05) pct = 1;
    else if (net >= 0.03) pct = 0.85;
    else if (net >= 0.015) pct = 0.7;
    else pct = 0.55;
  }
  pct = Math.min(1, Math.max(0, pct));
  const deploy = proceeds * pct;
  // Prefer meeting min entry even if pct would undershoot
  if (minE > 0 && deploy < minE && proceeds >= minE) return Math.min(proceeds, Math.max(deploy, minE));
  return deploy;
}

/**
 * Liquid vs deployed status for BALANCE LOW / starve handling.
 */
export function liquidBalanceStatus({
  eth = 0,
  weth = 0,
  tradeableWithWeth = 0,
  ethUsd = 0,
  deployedTokenUsd = 0,
  minEntryEth = 0,
  liquidStarveUsd = LIQUID_STARVE_USD,
  bagsWarnUsd = DEPLOYED_BAGS_WARN_USD,
} = {}) {
  const liquid = Math.max(0, Number(eth) || 0) + Math.max(0, Number(weth) || 0);
  const tradeable = Math.max(0, Number(tradeableWithWeth) || 0);
  const px = Number(ethUsd) || 0;
  const liquidUsd = liquid * px;
  const tradeableUsd = tradeable * px;
  const bags = Math.max(0, Number(deployedTokenUsd) || 0);
  const need = Math.max(0, Number(minEntryEth) || 0);
  const liquidStarved = tradeableUsd < liquidStarveUsd || (need > 0 && tradeable + 1e-12 < need);
  const capitalDeployed = bags >= bagsWarnUsd;
  const trulyEmpty = liquidUsd < 0.5 && bags < bagsWarnUsd;

  let action = "ok";
  let message = "liquid ok";
  if (trulyEmpty) {
    action = "top_up";
    message = "BALANCE LOW — wallet empty on chain (ETH+WETH+bags)";
  } else if (liquidStarved && capitalDeployed) {
    action = "recycle_cascade";
    message = `liquid thin ($${tradeableUsd.toFixed(2)}) — $${bags.toFixed(2)} in bags; recycle→cascade (not a top-up)`;
  } else if (liquidStarved) {
    action = "wait_or_top_up";
    message = `liquid thin ($${tradeableUsd.toFixed(2)}) — need ≥$${liquidStarveUsd} or min entry to inject`;
  }

  return {
    liquid,
    tradeable,
    liquidUsd,
    tradeableUsd,
    bagsUsd: bags,
    liquidStarved,
    capitalDeployed,
    trulyEmpty,
    action,
    message,
  };
}

/**
 * When liquid is starved, recycle smaller unknown bags so cascade can restart.
 * Still never sells piggy (caller applies piggy reserve).
 */
export function shouldRecycleForCascadeFuel({
  unknownEntry = false,
  posUsd = 0,
  liquidStarved = false,
  moonshotHoldUsd = 0.5,
  minUsd = 0.12,
  starveMinUsd = 0.18,
} = {}) {
  if (!unknownEntry) return false;
  const usd = Number(posUsd);
  if (!(usd >= 0)) return false;
  const floor = liquidStarved
    ? Math.min(Number(starveMinUsd) || 0.18, Number(moonshotHoldUsd) || 0.5)
    : Math.max(Number(minUsd) || 0.12, Number(moonshotHoldUsd) * 1.2);
  return usd >= floor && (liquidStarved ? usd > floor * 0.9 : usd > Number(moonshotHoldUsd) * 1.2);
}

/**
 * Thin books must not park a full $2–3 sell reserve — that is what made a live
 * ~0.002 ETH wallet report tradeable 0.000485 and deny every buy.
 * Keep a small native-gas cushion; scale up to FULL_SELL_RESERVE when richer.
 */
export function effectiveSellReserve(totalEth, fullReserve = FULL_SELL_RESERVE_ETH) {
  const total = Math.max(0, Number(totalEth) || 0);
  const full = Math.max(0, Number(fullReserve) || FULL_SELL_RESERVE_ETH);
  if (total >= THIN_BOOK_ETH) return full;
  // ~8% of book, floored so one Base sell still has gas headroom
  return Math.min(full, Math.max(0.00025, total * 0.08));
}

/** Buy skip reason when sized below rollover floor (auto / cascade). */
export function belowMinEntrySkip({ symbol, ethToSpend, minEntry, ethUsd } = {}) {
  const spend = Number(ethToSpend);
  const need = Number(minEntry);
  if (!(need > 0) || !(spend >= 0)) return null;
  if (spend + 1e-12 >= need) return null;
  const px = Number(ethUsd) || 0;
  const haveUsd = px > 0 ? spend * px : 0;
  const needUsd = px > 0 ? need * px : 0;
  return `🛑 ${String(symbol || "?").toUpperCase()} below min entry $${needUsd.toFixed(2)} (got $${haveUsd.toFixed(2)}) — need size to cover fees+hitch+cascade seed`;
}
