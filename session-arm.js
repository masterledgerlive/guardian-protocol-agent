/**
 * Session-range arm — live ticks can prime a micro seat when 2P/2T
 * history was wiped (GitHub 401) or is still BUILDING.
 *
 * Does not invent a second peak. Uses session high/low only.
 * Caller still runs LOSE-ZERO / always-plus / COST_EDGE.
 */

export const SESSION_ARM_MIN_READINGS = 8;
/** After fees, a thin live range can still micro-earn. 2.5% catalog floor stays on 2P/2T. */
export const SESSION_ARM_MIN_NET = 0.006;

function readingPrice(r) {
  if (r == null) return NaN;
  if (typeof r === "number") return r;
  return Number(r.price ?? r.p);
}

export function sessionRangeNet({
  high,
  low,
  feePct = 0.006,
  gasCostEth = 0,
  tradeEth = 0,
  impactPct = 0.006,
} = {}) {
  const hi = Number(high);
  const lo = Number(low);
  if (!(hi > lo) || !(lo > 0)) return null;
  const grossPct = (hi - lo) / lo;
  const fee = Math.max(0, Number(feePct) || 0);
  const impact = Math.max(0, Number(impactPct) || 0);
  const gas = Math.max(0, Number(gasCostEth) || 0);
  const trade = Math.max(0, Number(tradeEth) || 0);
  const gasPct = trade > 0 ? (gas * 2) / trade : 0;
  return grossPct - fee * 2 - impact - gasPct;
}

/**
 * @returns {{ ok: boolean, reason: string, net?: number, high?: number, low?: number, readings?: number }}
 */
export function sessionRangeCanArm(readings, {
  minNetMargin = SESSION_ARM_MIN_NET,
  minReadings = SESSION_ARM_MIN_READINGS,
  feePct = 0.006,
  gasCostEth = 0,
  tradeEth = 0,
  impactPct = 0.006,
  liveOnly = true,
} = {}) {
  if (!Array.isArray(readings) || readings.length < minReadings) {
    return { ok: false, reason: "thin-session", readings: readings?.length || 0 };
  }
  const prices = readings
    .filter((r) => !liveOnly || !r?.synthetic)
    .map(readingPrice)
    .filter((p) => Number.isFinite(p) && p > 0);
  if (prices.length < minReadings) {
    return { ok: false, reason: "thin-live", readings: prices.length };
  }
  const high = Math.max(...prices);
  const low = Math.min(...prices);
  const net = sessionRangeNet({
    high,
    low,
    feePct,
    gasCostEth,
    tradeEth,
    impactPct,
  });
  const floor = Number(minNetMargin);
  const need = Number.isFinite(floor) && floor > 0 ? floor : SESSION_ARM_MIN_NET;
  if (net == null || net < need) {
    return { ok: false, reason: "session-thin-net", net, high, low, readings: prices.length };
  }
  return { ok: true, reason: "SESSION_RANGE", net, high, low, readings: prices.length };
}
