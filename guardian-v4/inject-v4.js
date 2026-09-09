/**
 * Inject-book helpers for Guardian V4 — mirrored from root inject-revenue
 * but isolated (no shared mutable state with the V3 agent).
 */

export const SMALL_BOOK_USD = 15;
export const INJECT_ALL_USD = 12;
export const INJECT_PULLBACK_BAND = 0.025;
export const STALE_TROUGH_GAP = 0.18;

export function tierBookParams(tradeableUsd, {
  tier1Count = 3,
  tier1Pct = 0.65,
  tier2Pct = 0.35,
  tier2MinSlotUsd = 4,
  tier2MaxSlots = 8,
} = {}) {
  const usd = Number(tradeableUsd);
  const small = Number.isFinite(usd) && usd > 0 && usd < SMALL_BOOK_USD;
  if (!small) {
    return { smallBook: false, tier1Count, tier1Pct, tier2Pct, tier2MinSlotUsd, tier2MaxSlots };
  }
  return {
    smallBook: true,
    tier1Count: 2,
    tier1Pct: 0.85,
    tier2Pct: 0.15,
    tier2MinSlotUsd: 1.5,
    tier2MaxSlots,
  };
}

export function injectAllBookParams(tradeableUsd, base = tierBookParams(tradeableUsd)) {
  const usd = Number(tradeableUsd);
  if (Number.isFinite(usd) && usd > 0 && usd < INJECT_ALL_USD) {
    return {
      ...base,
      injectAll: true,
      tier1Count: 1,
      tier1Pct: 1,
      tier2Pct: 0,
      tier2MaxSlots: 0,
    };
  }
  return { ...base, injectAll: false };
}

export function entryTroughForBuy({
  minTrough,
  recentLow,
  price,
  preferRecent = true,
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
    return Math.max(minT, recent);
  }
  if (hasMin && hasRecent) return Math.max(minT, recent * 0.995);
  if (hasRecent) return recent;
  return hasMin ? minT : null;
}

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

export function rankAvenues(tokens, { tradeableUsd = 0 } = {}) {
  const book = injectAllBookParams(tradeableUsd);
  const active = (tokens || []).filter(
    (t) => t && t.status !== "frozen" && t.status !== "deferred" && t.address,
  );
  const scored = active
    .map((t) => {
      const liq = Number(t.liqUsd) || 0;
      const vol = Number(t.volUsd24h) || 0;
      const injectBoost = t.injectMain ? 25 : 0;
      const score = Math.log10(1 + liq) * 12 + Math.log10(1 + vol) * 8 + injectBoost;
      return { ...t, avenueScore: score };
    })
    .sort((a, b) => b.avenueScore - a.avenueScore);

  const seats = book.injectAll ? 1 : book.tier1Count;
  return {
    book,
    primed: scored.slice(0, seats),
    watch: scored.slice(seats),
    all: scored,
  };
}

export function injectProveStatus({ successfulInjections = 0, netProfitUsd = 0 } = {}) {
  const need = 20;
  const inj = Math.max(0, Number(successfulInjections) || 0);
  const pnl = Number(netProfitUsd) || 0;
  const ready = inj >= need && pnl > 0;
  return {
    ready,
    successfulInjections: inj,
    need,
    remaining: Math.max(0, need - inj),
    netProfitUsd: pnl,
    message: ready
      ? `V4 inject prove clear — ${inj} hitch fills, +$${pnl.toFixed(2)}`
      : `V4 inject prove ${inj}/${need} hitch fills; profit $${pnl.toFixed(2)} (need > 0)`,
  };
}
