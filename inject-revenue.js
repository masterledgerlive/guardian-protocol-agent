/**
 * Inject-revenue helpers — concentrate capital and make hitch surfaces tradeable
 * without selling at a loss.
 *
 * Live Railway (2026-09-07): ~$6 tradeable, T1 reserved UNI/CBBTC/LINK but buy
 * triggers sat at 90d candle lows (UNI buy@$3.17 while mark~$7) → zero fills.
 * Meanwhile SKI/DRB passed LOSE_ZERO every minute then "not in active tiers".
 * Dragnet scans burn RPC; inject never lands; revenue stays flat.
 *
 * Live Railway (2026-09-08): tradeable ~$0.71, bags ~$7 (LINK ~$4.35 / MORPHO
 * ~$1.98). INJECT-ALL reserved UNI with a sub-min seat → PRIMED none every
 * cycle. Moonshot allowed MORPHO then executeSell held — sellPct vs piggy
 * tokensToSell mismatch made leftover flip ≤ 0. Snowball needs capital
 * velocity: free profitable bags, never reserve a dead seat, then inject.
 */

export const SMALL_BOOK_USD = 15;
export const SMALL_TIER1_COUNT = 2;
export const SMALL_TIER1_PCT = 0.85;
export const SMALL_TIER2_PCT = 0.15;
export const SMALL_TIER2_MIN_SLOT_USD = 1.5;
export const INJECT_PULLBACK_BAND = 0.025; // buy within 2.5% of recent low
export const STALE_TROUGH_GAP = 0.18; // 90d min >18% below mark → ignore for entry
/** Known bags this large can fuel inject when liquid is starved. */
export const INJECT_FUEL_MIN_USD = 0.75;
/** Velocity names that historically compounded on thin Base books. */
export const INJECT_VELOCITY_SYMBOLS = Object.freeze([
  "DEGEN", "AERO", "BRETT", "KEYCAT", "VIRTUAL", "AIXBT",
]);

/**
 * Pick tier sizing for the current book. Tiny wallets concentrate so each
 * leftover-covered swap can hitch; large books keep the classic 65/35 split.
 */
export function tierBookParams(tradeableUsd, {
  tier1Count = 3,
  tier1Pct = 0.65,
  tier2Pct = 0.35,
  tier2MinSlotUsd = 4,
  tier2MaxSlots = 6,
} = {}) {
  const usd = Number(tradeableUsd);
  const small = Number.isFinite(usd) && usd > 0 && usd < SMALL_BOOK_USD;
  if (!small) {
    return {
      smallBook: false,
      tier1Count,
      tier1Pct,
      tier2Pct,
      tier2MinSlotUsd,
      tier2MaxSlots,
    };
  }
  return {
    smallBook: true,
    tier1Count: SMALL_TIER1_COUNT,
    tier1Pct: SMALL_TIER1_PCT,
    tier2Pct: SMALL_TIER2_PCT,
    tier2MinSlotUsd: SMALL_TIER2_MIN_SLOT_USD,
    tier2MaxSlots,
  };
}

/**
 * Entry trough for buys. Inject mains / deep books use recent session low when
 * the armed MIN trough is an ancient candle extreme the mark will never revisit.
 */
export function entryTroughForBuy({
  minTrough,
  recentLow,
  price,
  preferRecent = false,
  staleGap = STALE_TROUGH_GAP,
} = {}) {
  const minT = Number(minTrough);
  const recent = Number(recentLow);
  const px = Number(price);
  const hasMin = Number.isFinite(minT) && minT > 0;
  const hasRecent = Number.isFinite(recent) && recent > 0;
  const hasPx = Number.isFinite(px) && px > 0;

  if (!preferRecent) return hasMin ? minT : null;

  if (hasMin && hasPx && (px - minT) / px > staleGap && hasRecent) {
    // Ancient trough — climb to the recent low so we can actually buy+hitch.
    return Math.max(minT, recent);
  }
  if (hasMin && hasRecent) return Math.max(minT, recent * 0.995);
  if (hasRecent) return recent;
  return hasMin ? minT : null;
}

/**
 * Pullback entry on inject mains: near recent low, not free-falling.
 * Does not require sitting on a multi-week MIN.
 */
export function isInjectPullbackEntry({
  isInjectMain = false,
  price,
  recentLow,
  recentReadings = 0,
  priceFallingFast = false,
  band = INJECT_PULLBACK_BAND,
} = {}) {
  if (!isInjectMain || priceFallingFast) return false;
  if (Number(recentReadings) < 8) return false;
  const px = Number(price);
  const low = Number(recentLow);
  if (!(px > 0) || !(low > 0)) return false;
  return px <= low * (1 + band);
}

/** Score nudge when an inject main is close enough to buy this cycle. */
export function nearEntryScoreBoost({ isInjectMain = false, pullback = false } = {}) {
  if (!isInjectMain) return 0;
  return pullback ? 18 : 6;
}

/**
 * Dust-recycle / inject-fuel: proven FIFO ETH is known cost even with no
 * USD entryPrice. Do not block recycle as "unknown" solely for missing USD.
 */
export function classifyRecycleBag({
  unknownEntry = false,
  totalInvestedEth = 0,
  entryPrice = null,
  hasUsdBasis = false,
  operatorLotEth = 0,
} = {}) {
  const fifoEth = Number(totalInvestedEth) > 0
    ? Number(totalInvestedEth)
    : (Number(operatorLotEth) > 0 ? Number(operatorLotEth) : 0);
  const fifoKnown = unknownEntry !== true && fifoEth > 0;
  const usdKnown = unknownEntry !== true && !!hasUsdBasis && Number(entryPrice) > 0;
  const hasKnownPos = fifoKnown || usdKnown;
  return {
    unknownBag: !hasKnownPos,
    hasKnownPos,
    fifoKnown,
    fifoEth: fifoKnown ? fifoEth : 0,
  };
}

/**
 * Unknown-cost dust recycle: free ETH for inject trades without inventing P&L.
 * Bag must clear fees (caller enforces sell gate); we only decide if size qualifies.
 */
export function shouldRecycleUnknownDust({
  unknownEntry = false,
  posUsd = 0,
  moonshotHoldUsd = 0.5,
  minUsd = 0.12,
} = {}) {
  if (!unknownEntry) return false;
  const usd = Number(posUsd);
  if (!(usd >= minUsd)) return false;
  // Trim anything above lottery floor; tiny dust stays as piggy.
  return usd > Number(moonshotHoldUsd) * 1.2;
}

/**
 * Actual bag fraction sold after piggy. LOSE_ZERO entrySlice must use this —
 * not the requested sellPct — or leftover flips from allow → hold.
 */
export function sellFractionAfterPiggy({ balance, tokensToSell } = {}) {
  const bal = Number(balance);
  const sold = Number(tokensToSell);
  if (!(bal > 0) || !(sold > 0)) return 0;
  return Math.min(1, sold / bal);
}

/**
 * Known-cost bags stuck outside the inject seat while liquid is starved.
 * Still never sells at a loss — caller runs LOSE_ZERO on piggy-aligned size.
 */
export function shouldRecycleKnownForInjectFuel({
  knownEntry = false,
  posUsd = 0,
  liquidStarved = false,
  injectAll = false,
  moonshotHoldUsd = 0.5,
  minUsd = INJECT_FUEL_MIN_USD,
} = {}) {
  if (!knownEntry || !liquidStarved) return false;
  const usd = Number(posUsd);
  if (!(usd >= Number(minUsd))) return false;
  if (injectAll) return usd >= Number(minUsd);
  return usd > Number(moonshotHoldUsd) * 1.5;
}

/**
 * Hard-reserve UNI only when the seat can clear min entry. Sub-min inject-all
 * books that reserve UNI with $0.71 get PRIMED:none forever.
 */
export function injectReserveViable({
  tradeableUsd = 0,
  minEntryUsd = 0,
  injectAll = false,
} = {}) {
  const t = Number(tradeableUsd);
  if (!(t > 0)) return false;
  const need = Number(minEntryUsd);
  if (Number.isFinite(need) && need > 0 && t + 1e-9 < need) return false;
  // Inject-all with a sub-$2 book cannot pay RT+hitch+seed — don't fake a seat.
  if (injectAll && t < 2) return false;
  return true;
}

/**
 * When liquid-starved, keep only piggy dust — not the $0.50 lottery floor —
 * so a green bag frees a cascade-sized stake.
 */
export function injectFuelKeepUsd({
  liquidStarved = false,
  recycleFuel = false,
  moonshotHoldUsd = 0.5,
  piggyMinUsd = 0.05,
} = {}) {
  if (liquidStarved && recycleFuel) {
    return Math.max(0, Number(piggyMinUsd) || 0);
  }
  return Math.max(0, Number(moonshotHoldUsd) || 0);
}

/** Score nudge for names that historically snowballed on thin books. */
export function injectVelocityScoreBoost({
  symbol,
  injectAll = false,
  liquidStarved = false,
} = {}) {
  if (!injectAll && !liquidStarved) return 0;
  const s = String(symbol || "").toUpperCase();
  if (!INJECT_VELOCITY_SYMBOLS.includes(s)) return 0;
  return injectAll ? 12 : 6;
}

/** Largest bags first so one recycle can clear min entry. */
export function sortRecycleCandidatesByUsd(candidates = []) {
  return [...candidates].sort((a, b) => (Number(b?.posUsd) || 0) - (Number(a?.posUsd) || 0));
}

/**
 * Fill T1 seats. Sub-min inject-all must not velocity-pick a name we cannot
 * fund (live: $0.14 liquid → T1 AERO while PRIMED none and FIFO-red HOLD).
 */
export function fillTier1Seats({
  scored = [],
  reservedMain = null,
  tier1Count = 1,
  injectAll = false,
  reserveOk = true,
} = {}) {
  const cap = Math.max(0, Math.floor(Number(tier1Count) || 0));
  if (injectAll && !reserveOk) {
    return { tier1: [], blocked: true, reason: "sub-min-inject-all" };
  }
  const tier1 = [];
  const reserved = reservedMain ? String(reservedMain).toUpperCase() : "";
  const same = (a, b) => String(a || "").toUpperCase() === String(b || "").toUpperCase();
  if (reserved) {
    const hit = scored.find((s) => same(s?.symbol, reserved));
    tier1.push(hit?.symbol || reservedMain);
  }
  for (const s of scored) {
    if (tier1.length >= cap) break;
    const sym = s?.symbol;
    if (!sym || tier1.some((x) => same(x, sym))) continue;
    tier1.push(sym);
  }
  return { tier1, blocked: false, reason: null };
}

/**
 * Whether recycle should skip bags already seated in T1/T2.
 * When liquid is starved and there is no fundable / primed inject seat, T1 is
 * not a real job — PLUS bags (including the former velocity name) must recycle.
 * FIFO-red still HOLDs at the sell gate. Never sell underwater.
 */
export function recycleSkipsActiveTier({
  liquidStarved = false,
  injectSeatViable = true,
  primedAllowCount = 0,
} = {}) {
  if (liquidStarved && !injectSeatViable) return false;
  if (liquidStarved && !(Number(primedAllowCount) > 0)) return false;
  return true;
}
