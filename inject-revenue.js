/**
 * Inject-revenue helpers — concentrate capital and make hitch surfaces tradeable
 * without selling at a loss.
 *
 * Live Railway (2026-09-07): ~$6 tradeable, T1 reserved UNI/CBBTC/LINK but buy
 * triggers sat at 90d candle lows (UNI buy@$3.17 while mark~$7) → zero fills.
 * Meanwhile SKI/DRB passed LOSE_ZERO every minute then "not in active tiers".
 * Dragnet scans burn RPC; inject never lands; revenue stays flat.
 */

export const SMALL_BOOK_USD = 15;
export const SMALL_TIER1_COUNT = 2;
export const SMALL_TIER1_PCT = 0.85;
export const SMALL_TIER2_PCT = 0.15;
export const SMALL_TIER2_MIN_SLOT_USD = 1.5;
export const INJECT_PULLBACK_BAND = 0.025; // buy within 2.5% of recent low
export const STALE_TROUGH_GAP = 0.18; // 90d min >18% below mark → ignore for entry

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
