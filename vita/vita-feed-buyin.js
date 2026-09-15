/**
 * /vitafeed buy-in math — NEW this thread only.
 *
 * Isolated from live-trader piggy-bank.js (5% / $0.15) and wave peak-ride.
 * Does not rewrite vitaSave / inscribeChunk / mother-genesis / lose-zero.
 *
 * Per injection (character-sized):
 *   1. Qualify: token in the lowest 3% of peak–trough range AND predicted up.
 *   2. Entry must be negative vs peak (bought while down).
 *   3. Two leftover piggies: AI $0.10 + human $0.10 (≥ $0.20 always left behind).
 *   4. 1.5% savings tax on the WHOLE cost (chars + piggies + gwei + other fees).
 *   5. Stake sized from that injection’s character cost so a same-% bounce
 *      covers the stack. Target = mirror % up + cost overlay. Sell ASAP.
 */

export const VITAFEED_BUYIN_ID = "vita-feed-buyin-v1";
export const VITAFEED_AI_PIGGY_USD = 0.10;
export const VITAFEED_HUMAN_PIGGY_USD = 0.10;
export const VITAFEED_LEAVE_BEHIND_MIN_USD = 0.20;
export const VITAFEED_SAVINGS_TAX_PCT = 0.015;
export const VITAFEED_LOW_RANGE_MAX = 0.03;
/** Documented Uni V3 round-trip fee class for “other fees we know”. */
export const VITAFEED_OTHER_FEE_PCT = 0.006;

/** @type {Map<string, object>} */
const tickets = new Map();
let ticketSeq = 0;

function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

export function resetVitaFeedTickets() {
  tickets.clear();
  ticketSeq = 0;
  return tickets.size;
}

export function listVitaFeedTickets() {
  return [...tickets.values()].map((t) => ({ ...t }));
}

export function hasOpenVitaFeedTicket(symbol) {
  const sym = String(symbol || "");
  if (!sym) return false;
  for (const t of tickets.values()) {
    if (t.open && String(t.symbol) === sym) return true;
  }
  return false;
}

/**
 * Whole-cost stack for one injection.
 * tax = 1.5% of (chars + gwei + other + AI piggy + human piggy).
 */
export function computeVitaFeedWholeCost({
  charCostUsd = 0,
  gweiUsd = 0,
  otherFeesUsd = 0,
  aiPiggyUsd = VITAFEED_AI_PIGGY_USD,
  humanPiggyUsd = VITAFEED_HUMAN_PIGGY_USD,
  taxPct = VITAFEED_SAVINGS_TAX_PCT,
} = {}) {
  const chars = Math.max(0, num(charCostUsd));
  const gwei = Math.max(0, num(gweiUsd));
  const other = Math.max(0, num(otherFeesUsd));
  const ai = Math.max(0, num(aiPiggyUsd, VITAFEED_AI_PIGGY_USD));
  const human = Math.max(0, num(humanPiggyUsd, VITAFEED_HUMAN_PIGGY_USD));
  const piggies = ai + human;
  const leaveMin = VITAFEED_LEAVE_BEHIND_MIN_USD;
  const piggyFloor = Math.max(piggies, leaveMin);
  const subtotal = chars + gwei + other + piggyFloor;
  const tax = subtotal * Math.max(0, num(taxPct, VITAFEED_SAVINGS_TAX_PCT));
  const wholeCostUsd = subtotal + tax;
  const leaveBehindUsd = piggyFloor + tax;
  return {
    charCostUsd: chars,
    gweiUsd: gwei,
    otherFeesUsd: other,
    aiPiggyUsd: ai,
    humanPiggyUsd: human,
    piggyFloorUsd: piggyFloor,
    subtotalUsd: subtotal,
    taxPct: Math.max(0, num(taxPct, VITAFEED_SAVINGS_TAX_PCT)),
    taxUsd: tax,
    wholeCostUsd,
    leaveBehindUsd,
    leaveBehindMinUsd: leaveMin,
  };
}

/**
 * Wave seat: lowest 3% of range (or lower) + predicted coming up + still below peak.
 */
export function evaluateVitaFeedWaveSeat(seat = {}) {
  const price = num(seat.price);
  const trough = num(seat.minTrough);
  const peak = num(seat.maxPeak);
  const predictedUp = seat.predictedUp === true;
  if (!(price > 0) || !(trough > 0) || !(peak > trough)) {
    return { ok: false, reason: "need live price + peak > trough", symbol: seat.symbol || null };
  }
  if (seat.frozen === true || seat.disabled === true) {
    return { ok: false, reason: "frozen/disabled — not a vitafeed buy-in seat", symbol: seat.symbol };
  }
  const range = peak - trough;
  const rangePos = (price - trough) / range;
  const inLow3 = rangePos <= VITAFEED_LOW_RANGE_MAX + 1e-12;
  const belowPeak = price < peak - 1e-12;
  const dipPct = belowPeak ? (peak - price) / price : 0;
  if (!inLow3) {
    return {
      ok: false,
      reason: "not in low 3% of wave range (rangePos=" + rangePos.toFixed(4) + ")",
      symbol: seat.symbol,
      price,
      trough,
      peak,
      rangePos,
      dipPct,
      predictedUp,
    };
  }
  if (!predictedUp) {
    return {
      ok: false,
      reason: "wave not predicted coming up from low",
      symbol: seat.symbol,
      price,
      trough,
      peak,
      rangePos,
      dipPct,
      predictedUp: false,
    };
  }
  if (!belowPeak || dipPct <= 0) {
    return {
      ok: false,
      reason: "entry is not negative vs peak",
      symbol: seat.symbol,
      price,
      trough,
      peak,
      rangePos,
      dipPct,
      predictedUp,
    };
  }
  return {
    ok: true,
    symbol: seat.symbol,
    price,
    trough,
    peak,
    rangePos,
    dipPct,
    predictedUp: true,
    reason: "low " + (rangePos * 100).toFixed(2) + "% of range + predicted up + negative vs peak",
  };
}

export function pickVitaFeedBuyInSeat(seats = []) {
  const qualified = (seats || [])
    .map((s) => evaluateVitaFeedWaveSeat(s))
    .filter((s) => s.ok);
  qualified.sort((a, b) => a.rangePos - b.rangePos);
  return qualified[0] || null;
}

/**
 * Size stake from this injection’s whole cost so a same-% bounce covers it.
 * Target = mirror % (same as the dip) PLUS cost overlay (baked-in math).
 */
export function planVitaFeedInjectionBuyIn({
  charCostUsd,
  gweiUsd = 0,
  otherFeePct = VITAFEED_OTHER_FEE_PCT,
  swapGasUsd = 0,
  seat,
  ethUsd = 2481,
} = {}) {
  const wave = evaluateVitaFeedWaveSeat(seat || {});
  if (!wave.ok) {
    return { ok: false, skipBuy: true, wave, reason: wave.reason };
  }
  const dipPct = wave.dipPct;
  const usd = Math.max(1, num(ethUsd, 2481));

  function stack(otherFeesUsd) {
    return computeVitaFeedWholeCost({
      charCostUsd,
      gweiUsd,
      otherFeesUsd,
    });
  }

  const feePct = Math.max(0, num(otherFeePct, VITAFEED_OTHER_FEE_PCT));
  const swapGas = Math.max(0, num(swapGasUsd));
  let other = swapGas;
  let cost = stack(other);
  let stakeUsd = cost.wholeCostUsd / dipPct;
  for (let i = 0; i < 8; i++) {
    other = stakeUsd * feePct + swapGas;
    cost = stack(other);
    stakeUsd = cost.wholeCostUsd / dipPct;
  }

  const costPct = cost.wholeCostUsd / stakeUsd;
  const targetPct = dipPct + costPct;
  const entry = wave.price;
  const targetPrice = entry * (1 + targetPct);
  const stakeEth = stakeUsd / usd;

  return {
    ok: true,
    skipBuy: false,
    id: VITAFEED_BUYIN_ID,
    symbol: wave.symbol,
    entryPrice: entry,
    peak: wave.peak,
    trough: wave.trough,
    rangePos: wave.rangePos,
    dipPct,
    mirrorPct: dipPct,
    costPct,
    targetPct,
    targetPrice,
    stakeUsd,
    stakeEth,
    ethUsd: usd,
    cost,
    leaveBehindUsd: cost.leaveBehindUsd,
    reason: wave.reason,
  };
}

export function planVitaFeedBuyIns({ prepared, cost, seats = [], quotes = {} } = {}) {
  const ethUsd = num(quotes.ethUsd, cost?.quotes?.ethUsd || 2481);
  const swapGasUsd = num(quotes.gasCostEth, 0) * ethUsd;
  const seat = pickVitaFeedBuyInSeat(seats);
  const lines = prepared?.lines || [];
  const perLine = cost?.perLine || [];
  const injections = [];

  if (!seat) {
    const sample = (seats || []).map((s) => evaluateVitaFeedWaveSeat(s)).find((s) => !s.ok);
    return {
      ok: false,
      skipBuy: true,
      reason: sample?.reason || "no seat in low 3% + predicted up",
      seat: null,
      injections: [],
      totalStakeUsd: 0,
      totalStakeEth: 0,
      leaveBehindUsd: VITAFEED_LEAVE_BEHIND_MIN_USD,
    };
  }

  let totalStakeUsd = 0;
  let totalStakeEth = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const per = perLine[i] || {};
    const calldataUsd = num(per.l2CalldataEth) * ethUsd;
    const execUsd = (num(per.l2ExecEth) + num(per.l1Eth)) * ethUsd;
    const fullUsd = num(per.eth) * ethUsd;
    // Characters = calldata; gwei = self-tx exec + L1. Do not double-count per.eth.
    const charCostUsd = (calldataUsd > 0 || execUsd > 0) ? calldataUsd : fullUsd;
    const gweiUsd = (calldataUsd > 0 || execUsd > 0) ? execUsd : 0;
    const plan = planVitaFeedInjectionBuyIn({
      charCostUsd,
      gweiUsd,
      swapGasUsd,
      seat,
      ethUsd,
    });
    if (!plan.ok) {
      return { ok: false, skipBuy: true, reason: plan.reason, seat, injections: [] };
    }
    injections.push({
      index: line.index,
      vinId: line.vinId,
      charCostUsd,
      ...plan,
    });
    totalStakeUsd += plan.stakeUsd;
    totalStakeEth += plan.stakeEth;
  }

  return {
    ok: true,
    skipBuy: false,
    seat,
    injections,
    totalStakeUsd,
    totalStakeEth,
    leaveBehindUsd: injections[0]?.leaveBehindUsd || VITAFEED_LEAVE_BEHIND_MIN_USD,
    reason: seat.reason,
  };
}

export function formatVitaFeedBuyInCard(plan) {
  const lines = [];
  lines.push("VITAFEED BUY-IN · " + VITAFEED_BUYIN_ID);
  lines.push("new math this thread — not live-trader piggy 5%/$0.15");
  lines.push(
    "qualify: low ≤" + (VITAFEED_LOW_RANGE_MAX * 100).toFixed(0) +
    "% of peak–trough + predicted up + negative vs peak",
  );
  lines.push(
    "piggies: AI $" + VITAFEED_AI_PIGGY_USD.toFixed(2) +
    " + human $" + VITAFEED_HUMAN_PIGGY_USD.toFixed(2) +
    " (≥ $" + VITAFEED_LEAVE_BEHIND_MIN_USD.toFixed(2) + " always left behind)",
  );
  lines.push("tax: " + (VITAFEED_SAVINGS_TAX_PCT * 100).toFixed(1) + "% of whole cost (chars+piggies+gwei+other)");
  if (!plan?.ok) {
    lines.push("BUY SKIP — " + (plan?.reason || "no qualifying seat"));
    lines.push("inscription still pays RISK after confirm (message-first)");
    return lines.join("\n");
  }
  lines.push("seat " + plan.seat.symbol + " rangePos=" + (plan.seat.rangePos * 100).toFixed(2) + "%");
  lines.push(
    "dip=" + (plan.seat.dipPct * 100).toFixed(2) +
    "% → target = same % up + cost overlay",
  );
  lines.push(
    "injections=" + plan.injections.length +
    "  stake $" + plan.totalStakeUsd.toFixed(4) +
    " (" + plan.totalStakeEth.toFixed(6) + " ETH)",
  );
  const first = plan.injections[0];
  if (first?.cost) {
    const c = first.cost;
    lines.push(
      "per inject whole $" + c.wholeCostUsd.toFixed(4) +
      "  leave $" + c.leaveBehindUsd.toFixed(4) +
      " (piggies+tax)",
    );
    lines.push(
      "  chars $" + c.charCostUsd.toFixed(4) +
      "  tax $" + c.taxUsd.toFixed(4) +
      "  AI $" + c.aiPiggyUsd.toFixed(2) +
      "  human $" + c.humanPiggyUsd.toFixed(2),
    );
    lines.push(
      "exit ASAP @ $" + first.targetPrice.toFixed(8) +
      "  (+" + (first.targetPct * 100).toFixed(2) + "%)",
    );
  }
  return lines.join("\n");
}

export function openVitaFeedTicket(row) {
  ticketSeq += 1;
  const id = "VFBUY-" + ticketSeq;
  const ticket = {
    id,
    ...row,
    open: true,
    at: new Date().toISOString(),
  };
  tickets.set(id, ticket);
  return ticket;
}

export function closeVitaFeedTicket(id) {
  const t = tickets.get(String(id || ""));
  if (!t) return null;
  t.open = false;
  t.closedAt = new Date().toISOString();
  tickets.set(t.id, t);
  return t;
}

export function dueVitaFeedExit({ symbol, price } = {}) {
  const px = num(price);
  const sym = String(symbol || "");
  for (const t of tickets.values()) {
    if (!t.open) continue;
    if (String(t.symbol) !== sym) continue;
    if (px + 1e-12 >= num(t.targetPrice)) return { ...t, due: true };
  }
  return null;
}

/**
 * Sell fraction 0–1 of the *bag* that realizes this ticket’s lot and still
 * leaves leaveBehindUsd (piggies + tax). Sized from the ticket stake so a
 * mixed live-trader bag is not dumped.
 */
export function vitaFeedExitSellPct({
  balance,
  price,
  leaveBehindUsd,
  stakeUsd = 0,
  entryPrice = 0,
} = {}) {
  const bal = num(balance);
  const px = num(price);
  const leave = Math.max(VITAFEED_LEAVE_BEHIND_MIN_USD, num(leaveBehindUsd));
  if (!(bal > 0) || !(px > 0)) return 0;
  const bagUsd = bal * px;
  const stake = num(stakeUsd);
  const entry = num(entryPrice);
  let sellUsd;
  if (stake > 0 && entry > 0) {
    const lotUsdNow = stake * (px / entry);
    sellUsd = Math.max(0, lotUsdNow - leave);
  } else {
    sellUsd = Math.max(0, bagUsd - leave);
  }
  const bagCap = Math.max(0, bagUsd - leave);
  sellUsd = Math.min(sellUsd, bagCap);
  if (sellUsd <= 0) return 0;
  return Math.min(0.99, sellUsd / bagUsd);
}
