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
 *   3. Cascade deploys after a profitable exit into the next lowest primed
 *      bottoms (projected upside); ETH retained is the gas/fee floor only.
 *   4. Piggy dust is never part of deployable proceeds.
 *   5. Liquid-thin + bags deployed ≠ empty wallet — recycle, don't panic top-up.
 *   6. Cascade never spends the native-gas floor — highest deploy without loss
 *      still leaves enough ETH (unwrap WETH if needed) for the next N moves so
 *      the book cannot strand itself past a depletion threshold.
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
 * Native ETH that must survive every cascade hop.
 * Documented default is **0.001** (not 0.00125). Reserve + 3×0.00025 would
 * print 0.00125 and stall a ~$2 book (full unwrap ETH ~0.000904 still under
 * 0.00125). Cap at this floor so micro-cascade can run without vault top-up.
 * Thin books still scale toward GAS_RESERVE via effectiveCascadeGasFloor.
 */
export const CASCADE_GAS_FLOOR_ETH = 0.001;
/** Thrift floor for ~$2 liquid books — one Base tx of gas, vault never. */
export const THRIFT_CASCADE_GAS_FLOOR_ETH = 0.0005;
/** How many future Base txs we always keep fuel for (buy + sell + next cascade). */
export const CASCADE_MOVES_RESERVE = 3;
/** Per-move native cushion when live gas quote is missing (conservative Base). */
export const CASCADE_GAS_PER_MOVE_ETH = 0.00025;
/** Dust below this is not worth an unwrap tx (gas of withdraw itself). */
export const MIN_PARTIAL_UNWRAP_ETH = 0.00012;
/** Prove milestone: successful on-chain hitch injections before capital top-up. */
export const INJECT_PROVE_TARGET = 20;

/**
 * Round-trip floor in ETH so a fill can exit, hitch, and still leave cascade seed.
 *
 * tradeEth * (1 - 2*fee - 2*impact) - 2*gas - hitch >= seed
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
  // Impact hits both legs — single-sided understated the floor and stranded RT.
  const costPct = 2 * fee + 2 * impact;
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
 * Unified ETH+WETH spendable after gas keep (and piggy). Thin books must
 * not park a 20% + sell-reserve tax that logs T1 ~$3.80 against a ~$5.67
 * book and then refuse every avenue as below inject min-entry.
 * Native gas stay; WETH is spendable (unwrap if needed).
 */
export function microSpendableEth({
  eth = 0,
  weth = 0,
  gasFloorEth = 0.0005,
  piggyEth = 0,
} = {}) {
  const total = Math.max(0, Number(eth) || 0) + Math.max(0, Number(weth) || 0);
  const keep = Math.max(0, Number(gasFloorEth) || 0) + Math.max(0, Number(piggyEth) || 0);
  return Math.max(0, total - keep);
}

/**
 * When the full inject floor (hitch + $0.75 cascade seed + 1.35× buffer)
 * does not fit spendable, drop seed/buffer so a trade-only micro can fire.
 * Prefer leftover ≥ 1× hitch; if hitch itself cannot fit, bank hitch (#89).
 *
 * mode:
 *   inject — full floor fits
 *   micro-hitch — seed dropped, hitch still in the floor
 *   micro-bank — hitch also dropped (SKIP_HITCH / bank)
 */
export function resolveMinEntryForBook({
  gasCostEth,
  hitchCostEth,
  feePct,
  impactPct,
  ethUsd,
  tokenMinBuyUsd = 0,
  minPosUsd = 0.5,
  cascadeSeedUsd = CASCADE_SEED_USD,
  buffer = ROUND_TRIP_BUFFER,
  tradeableEth = 0,
} = {}) {
  const spendable = Math.max(0, Number(tradeableEth) || 0);
  const base = {
    gasCostEth,
    hitchCostEth,
    feePct,
    impactPct,
    ethUsd,
    tokenMinBuyUsd,
    minPosUsd,
  };
  const full = effectiveMinEntryEth({ ...base, cascadeSeedUsd, buffer });
  if (spendable + 1e-12 >= full) {
    return { minEntryEth: full, mode: "inject", skipHitch: false, skipCascadeSeed: false };
  }
  const hitchOn = effectiveMinEntryEth({
    ...base,
    cascadeSeedUsd: 0,
    buffer: 1,
  });
  if (spendable + 1e-12 >= hitchOn) {
    return { minEntryEth: hitchOn, mode: "micro-hitch", skipHitch: false, skipCascadeSeed: true };
  }
  const bank = effectiveMinEntryEth({
    ...base,
    hitchCostEth: 0,
    cascadeSeedUsd: 0,
    buffer: 1,
  });
  return { minEntryEth: bank, mode: "micro-bank", skipHitch: true, skipCascadeSeed: true };
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
 * Native ETH floor that must remain for the next N cascade moves.
 * Never cross this — highest deploy without loss still leaves this cushion.
 */
export function cascadeGasFloorEth({
  gasReserveEth = 0.0005,
  movesReserve = CASCADE_MOVES_RESERVE,
  perMoveEth = CASCADE_GAS_PER_MOVE_ETH,
  absoluteFloorEth = CASCADE_GAS_FLOOR_ETH,
} = {}) {
  const base = Math.max(0, Number(gasReserveEth) || 0);
  const moves = Math.max(0, Math.floor(Number(movesReserve) || 0));
  const per = Math.max(0, Number(perMoveEth) || 0);
  const abs = Math.max(0, Number(absoluteFloorEth) || 0);
  const raw = base + moves * per;
  const cap = abs > 0 ? abs : CASCADE_GAS_FLOOR_ETH;
  // Documented default 0.001 caps reserve+3×0.00025 (0.00125) so a ~$2
  // full unwrap (~0.000904) can still feed thrift micro-cascade.
  return Math.max(THRIFT_CASCADE_GAS_FLOOR_ETH, Math.min(cap, Math.max(raw, cap)));
}

/**
 * Thin books cannot park a full cascade gas floor or nothing cascades.
 * Scale down toward GAS_RESERVE while richer books keep the full floor.
 */
export function effectiveCascadeGasFloor(totalLiquidEth, opts = {}) {
  const total = Math.max(0, Number(totalLiquidEth) || 0);
  const gasReserve = Math.max(0, Number(opts.gasReserveEth) || 0.0005);
  const full = cascadeGasFloorEth(opts);
  if (total >= THIN_BOOK_ETH) return full;
  // ~15% of book, never below hard gas reserve, never above full floor
  return Math.min(full, Math.max(gasReserve, total * 0.15));
}

/**
 * How much WETH→ETH unwrap is needed so native ETH can fund the next moves.
 *
 * Thrift partial: if WETH cannot cover the full gap, still unwrap what we
 * have toward the floor (always-plus / safe — unwrap is not a red sell).
 * Old gate required avail ≥ need (or WETH > 0.003 in manageEthWethBalance)
 * and stalled when ETH~0.000904 after a full unwrap sat under 0.00125.
 *
 * operatorUnlock: desk/operator one-shot (`OPERATOR_UNWRAP`) may unwrap
 * even a thin leftover toward the thrift floor.
 */
export function unwrapForCascadeGas({
  nativeEth = 0,
  weth = 0,
  floorEth = CASCADE_GAS_FLOOR_ETH,
  keepWethMin = 0,
  allowPartial = true,
  operatorUnlock = false,
  minPartialEth = MIN_PARTIAL_UNWRAP_ETH,
} = {}) {
  const native = Math.max(0, Number(nativeEth) || 0);
  const w = Math.max(0, Number(weth) || 0);
  const floor = Math.max(0, Number(floorEth) || 0);
  const keep = Math.max(0, Number(keepWethMin) || 0);
  if (native + 1e-12 >= floor) return 0;
  const need = floor - native;
  const avail = Math.max(0, w - keep);
  if (!(avail > 0)) return 0;
  const minPartial = Math.max(0, Number(minPartialEth) || 0);
  if (avail + 1e-12 >= need) {
    return Math.min(avail, need + 0.00015);
  }
  if (!allowPartial && !operatorUnlock) return 0;
  if (avail + 1e-12 < minPartial && !operatorUnlock) return 0;
  return avail;
}

/** Parse desk/operator one-shot unwrap latch. yes/true/1/on or ETH amount. */
export function parseOperatorUnwrapEnv(raw) {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return { armed: false, amountEth: null };
  if (s === "yes" || s === "true" || s === "1" || s === "on") {
    return { armed: true, amountEth: null };
  }
  if (s === "no" || s === "false" || s === "0" || s === "off") {
    return { armed: false, amountEth: null };
  }
  const n = Number(s);
  if (Number.isFinite(n) && n > 0) return { armed: true, amountEth: n };
  return { armed: false, amountEth: null };
}

export function isOperatorUnwrapArmed(env = process.env) {
  return parseOperatorUnwrapEnv(env?.OPERATOR_UNWRAP).armed === true;
}

/**
 * Max ETH that may leave liquid without crossing the depletion threshold.
 * Floor is on total liquid (ETH+WETH), not on proceeds alone — extra WETH
 * can back gas via unwrap so more of sell proceeds may cascade.
 * Returns 0 when the safe cap cannot clear next min entry.
 */
export function maxCascadeDeployWithoutDepletion({
  proceedsEth = 0,
  liquidEth = 0,
  gasFloorEth = CASCADE_GAS_FLOOR_ETH,
  nextMinEntryEth = 0,
} = {}) {
  const proceeds = Math.max(0, Number(proceedsEth) || 0);
  const liquid = Math.max(0, Number(liquidEth) || 0);
  const floor = Math.max(0, Number(gasFloorEth) || 0);
  const seed = Math.max(0, Number(nextMinEntryEth) || 0);
  const headroom = Math.max(0, liquid - floor);
  const cap = Math.min(proceeds, headroom);
  if (seed > 0 && cap + 1e-12 < seed) return 0;
  return Math.max(0, cap);
}

/**
 * How much of sell proceeds to cascade into the next low.
 * Leaves nothing for piggy (piggy is token-side). Caps at avail.
 * Requires proceeds ≥ target min entry or returns 0 (hold cash for next cycle).
 * Never depletes the cascade gas floor — highest without loss still leaves fuel.
 */
export function cascadeDeployEth({
  proceedsEth = 0,
  targetMinEntryEth = 0,
  netMargin = 0,
  deployPct = null,
  gasFloorEth = CASCADE_GAS_FLOOR_ETH,
  liquidEth = null,
} = {}) {
  const proceeds = Math.max(0, Number(proceedsEth) || 0);
  const minE = Math.max(0, Number(targetMinEntryEth) || 0);
  if (!(proceeds > 0)) return 0;
  if (minE > 0 && proceeds + 1e-12 < minE) return 0;

  const liquid = liquidEth == null ? proceeds : Math.max(0, Number(liquidEth) || 0);
  const floor = Math.max(0, Number(gasFloorEth) || 0);
  const maxSafe = maxCascadeDeployWithoutDepletion({
    proceedsEth: proceeds,
    liquidEth: liquid,
    gasFloorEth: floor,
    nextMinEntryEth: minE,
  });
  if (!(maxSafe > 0)) return 0;

  let pct = Number(deployPct);
  if (!Number.isFinite(pct) || pct <= 0) {
    // Fee-fuel mode: park only the gas floor in ETH; redeploy the rest into
    // the next lowest primed bottom. maxSafe already leaves the floor.
    const net = Number(netMargin) || 0;
    if (net >= 0.03) pct = 1;
    else if (net >= 0.015) pct = 0.95;
    else pct = 0.9;
  }
  pct = Math.min(1, Math.max(0, pct));
  let deploy = proceeds * pct;
  // Prefer meeting min entry even if pct would undershoot
  if (minE > 0 && deploy < minE && proceeds >= minE) deploy = Math.min(proceeds, Math.max(deploy, minE));
  // Hard ceiling: never cross gas depletion threshold
  deploy = Math.min(deploy, maxSafe);
  if (minE > 0 && deploy + 1e-12 < minE) return 0;
  return deploy;
}

/**
 * Injection prove progress — count successful hitch-on-chain fills with profit.
 * Capital top-up is gated until target (default 20) is met with net profit > 0.
 */
export function injectProveStatus({
  successfulInjections = 0,
  netProfitUsd = 0,
  target = INJECT_PROVE_TARGET,
} = {}) {
  const n = Math.max(0, Math.floor(Number(successfulInjections) || 0));
  const profit = Number(netProfitUsd) || 0;
  const need = Math.max(1, Math.floor(Number(target) || INJECT_PROVE_TARGET));
  const injectionsMet = n >= need;
  const profitMet = profit > 0;
  const ready = injectionsMet && profitMet;
  return {
    count: n,
    target: need,
    remaining: Math.max(0, need - n),
    netProfitUsd: profit,
    injectionsMet,
    profitMet,
    ready,
    message: ready
      ? `PROVE MET — ${n}/${need} hitch injections, profit $${profit.toFixed(2)} — capital may increase`
      : `PROVE ${n}/${need} hitch injections · profit $${profit.toFixed(2)}${profitMet ? "" : " (need > $0)"} — hold capital size`,
  };
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
