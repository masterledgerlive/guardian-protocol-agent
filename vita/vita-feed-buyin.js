/**
 * /vitafeed buy-in math — NEW this thread only.
 *
 * Isolated from live-trader piggy-bank.js (5% / $0.15) and wave peak-ride.
 * Does not rewrite vitaSave / inscribeChunk / mother-genesis / lose-zero.
 *
 * Per injection (character-sized):
 *   1. Qualify: token in the lowest 3% of peak–trough range AND predicted up.
 *   2. Entry must be negative vs peak (bought while down).
 *   3. Leftover piggies (pre-injected, left behind):
 *        AI $0.10 + human $0.10 + lottery $0.05 (≥ $0.25 always left behind).
 *   4. 1.5% savings tax on the WHOLE cost at inject time:
 *        transmission/chars + piggies + gwei + other fees + hidden costs.
 *   5. Stake sized from that injection’s character cost so a same-% bounce
 *      covers the stack. Target = mirror % up + cost overlay. Sell ASAP when
 *      green / revenue prints — leave piggies+tax parked for the next earn.
 *   6. Each injection prefers a *different* red seat: deepest low-3% first,
 *      then fewest prior trades (least churn to flip green).
 */

export const VITAFEED_BUYIN_ID = "vita-feed-buyin-v2";
export const VITAFEED_AI_PIGGY_USD = 0.10;
export const VITAFEED_HUMAN_PIGGY_USD = 0.10;
export const VITAFEED_LOTTERY_PIGGY_USD = 0.05;
export const VITAFEED_LEAVE_BEHIND_MIN_USD =
  VITAFEED_AI_PIGGY_USD + VITAFEED_HUMAN_PIGGY_USD + VITAFEED_LOTTERY_PIGGY_USD;
export const VITAFEED_SAVINGS_TAX_PCT = 0.015;
export const VITAFEED_LOW_RANGE_MAX = 0.03;
/** Documented Uni V3 round-trip fee class for “other fees we know”. */
export const VITAFEED_OTHER_FEE_PCT = 0.006;
/**
 * Default hidden-cost buffer as a fraction of (transmission + gwei + other).
 * Covers slippage / oracle soft-fail / unpriced L1 spikes — taxed with the stack.
 */
export const VITAFEED_HIDDEN_COST_PCT = 0.01;

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
 * Whole-cost stack for one injection (pre-inject leave-behind).
 * tax = 1.5% of (transmission/chars + gwei + other + hidden + AI + human + lottery).
 * leaveBehind = piggy floor (≥ $0.25) + tax — parked until green exit earns.
 */
export function computeVitaFeedWholeCost({
  charCostUsd = 0,
  transmissionUsd = null,
  gweiUsd = 0,
  otherFeesUsd = 0,
  hiddenCostUsd = null,
  hiddenCostPct = VITAFEED_HIDDEN_COST_PCT,
  aiPiggyUsd = VITAFEED_AI_PIGGY_USD,
  humanPiggyUsd = VITAFEED_HUMAN_PIGGY_USD,
  lotteryPiggyUsd = VITAFEED_LOTTERY_PIGGY_USD,
  taxPct = VITAFEED_SAVINGS_TAX_PCT,
} = {}) {
  const chars = Math.max(0, num(charCostUsd));
  // Transmission is the message path cost; defaults to character/calldata cost.
  const transmission = Math.max(
    0,
    transmissionUsd == null ? chars : num(transmissionUsd),
  );
  const gwei = Math.max(0, num(gweiUsd));
  const other = Math.max(0, num(otherFeesUsd));
  const knownWire = transmission + gwei + other;
  const hidden = Math.max(
    0,
    hiddenCostUsd == null
      ? knownWire * Math.max(0, num(hiddenCostPct, VITAFEED_HIDDEN_COST_PCT))
      : num(hiddenCostUsd),
  );
  const ai = Math.max(0, num(aiPiggyUsd, VITAFEED_AI_PIGGY_USD));
  const human = Math.max(0, num(humanPiggyUsd, VITAFEED_HUMAN_PIGGY_USD));
  const lottery = Math.max(0, num(lotteryPiggyUsd, VITAFEED_LOTTERY_PIGGY_USD));
  const piggies = ai + human + lottery;
  const leaveMin = VITAFEED_LEAVE_BEHIND_MIN_USD;
  const piggyFloor = Math.max(piggies, leaveMin);
  const subtotal = transmission + gwei + other + hidden + piggyFloor;
  const tax = subtotal * Math.max(0, num(taxPct, VITAFEED_SAVINGS_TAX_PCT));
  const wholeCostUsd = subtotal + tax;
  const leaveBehindUsd = piggyFloor + tax;
  return {
    charCostUsd: chars,
    transmissionUsd: transmission,
    gweiUsd: gwei,
    otherFeesUsd: other,
    hiddenCostUsd: hidden,
    aiPiggyUsd: ai,
    humanPiggyUsd: human,
    lotteryPiggyUsd: lottery,
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
  const trough = num(seat.minTrough, num(seat.trough));
  const peak = num(seat.maxPeak, num(seat.peak));
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
  const tradeCount = Math.max(0, Math.floor(num(seat.tradeCount, 0)));
  const red = belowPeak && dipPct > 0;
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
      tradeCount,
      predictedUp,
      red: false,
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
      tradeCount,
      predictedUp: false,
      red,
    };
  }
  if (!red) {
    return {
      ok: false,
      reason: "entry is not red/negative vs peak",
      symbol: seat.symbol,
      price,
      trough,
      peak,
      rangePos,
      dipPct,
      tradeCount,
      predictedUp,
      red: false,
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
    tradeCount,
    predictedUp: true,
    red: true,
    reason:
      "red low " + (rangePos * 100).toFixed(2) +
      "% of range + predicted up + negative vs peak (trades=" + tradeCount + ")",
  };
}

/**
 * Rank qualifying RED seats: deepest low-3% first, then fewest prior trades.
 * excludeSymbols keeps each injection on a different token when possible.
 */
export function rankVitaFeedBuyInSeats(seats = [], { excludeSymbols = [] } = {}) {
  const ban = new Set(
    (excludeSymbols || []).map((x) => String(x || "").toUpperCase()).filter(Boolean),
  );
  const qualified = (seats || [])
    .map((s) => ({ raw: s, wave: evaluateVitaFeedWaveSeat(s) }))
    .filter((row) => row.wave.ok)
    .filter((row) => !ban.has(String(row.wave.symbol || "").toUpperCase()));
  qualified.sort((a, b) => {
    const rp = a.wave.rangePos - b.wave.rangePos;
    if (Math.abs(rp) > 1e-12) return rp;
    const tc = (a.wave.tradeCount || 0) - (b.wave.tradeCount || 0);
    if (tc !== 0) return tc;
    return String(a.wave.symbol || "").localeCompare(String(b.wave.symbol || ""));
  });
  return qualified.map((row) => ({ ...row.raw, ...row.wave }));
}

export function pickVitaFeedBuyInSeat(seats = [], opts = {}) {
  const ranked = rankVitaFeedBuyInSeats(seats, opts);
  return ranked[0] || null;
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
      transmissionUsd: charCostUsd,
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
    tradeCount: wave.tradeCount || 0,
    red: true,
    cost,
    leaveBehindUsd: cost.leaveBehindUsd,
    reason: wave.reason,
  };
}

export function planVitaFeedBuyIns({ prepared, cost, seats = [], quotes = {} } = {}) {
  const ethUsd = num(quotes.ethUsd, cost?.quotes?.ethUsd || 2481);
  const swapGasUsd = num(quotes.gasCostEth, 0) * ethUsd;
  const lines = prepared?.lines || [];
  const perLine = cost?.perLine || [];
  const injections = [];
  const usedSymbols = [];
  const chosenSeats = [];

  // Open tickets already hold a red bag — prefer other names for new injections.
  for (const t of tickets.values()) {
    if (t.open && t.symbol) usedSymbols.push(String(t.symbol));
  }

  if (!pickVitaFeedBuyInSeat(seats, { excludeSymbols: usedSymbols }) &&
      !pickVitaFeedBuyInSeat(seats)) {
    const sample = (seats || []).map((s) => evaluateVitaFeedWaveSeat(s)).find((s) => !s.ok);
    return {
      ok: false,
      skipBuy: true,
      reason: sample?.reason || "no red seat in low 3% + predicted up",
      seat: null,
      seats: [],
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
    // Transmission/chars = calldata; gwei = self-tx exec + L1. Do not double-count per.eth.
    const charCostUsd = (calldataUsd > 0 || execUsd > 0) ? calldataUsd : fullUsd;
    const gweiUsd = (calldataUsd > 0 || execUsd > 0) ? execUsd : 0;

    // Different red token per injection when the book has enough low-3% seats.
    let seat = pickVitaFeedBuyInSeat(seats, { excludeSymbols: usedSymbols });
    if (!seat) seat = pickVitaFeedBuyInSeat(seats);
    if (!seat) {
      return {
        ok: false,
        skipBuy: true,
        reason: "no red seat in low 3% + predicted up",
        seat: null,
        seats: chosenSeats,
        injections,
        totalStakeUsd,
        totalStakeEth,
        leaveBehindUsd: injections[0]?.leaveBehindUsd || VITAFEED_LEAVE_BEHIND_MIN_USD,
      };
    }

    const plan = planVitaFeedInjectionBuyIn({
      charCostUsd,
      gweiUsd,
      swapGasUsd,
      seat,
      ethUsd,
    });
    if (!plan.ok) {
      return { ok: false, skipBuy: true, reason: plan.reason, seat, seats: chosenSeats, injections: [] };
    }
    usedSymbols.push(String(plan.symbol));
    chosenSeats.push(seat);
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
    seat: chosenSeats[0] || null,
    seats: chosenSeats,
    injections,
    totalStakeUsd,
    totalStakeEth,
    leaveBehindUsd: injections[0]?.leaveBehindUsd || VITAFEED_LEAVE_BEHIND_MIN_USD,
    reason: chosenSeats[0]?.reason || "red seats assigned per injection",
  };
}

export function formatVitaFeedBuyInCard(plan) {
  const lines = [];
  lines.push("VITAFEED BUY-IN · " + VITAFEED_BUYIN_ID);
  lines.push("new math this thread — not live-trader piggy 5%/$0.15");
  lines.push(
    "qualify: RED low ≤" + (VITAFEED_LOW_RANGE_MAX * 100).toFixed(0) +
    "% of peak–trough + predicted up + negative vs peak",
  );
  lines.push(
    "piggies left behind: AI $" + VITAFEED_AI_PIGGY_USD.toFixed(2) +
    " + human $" + VITAFEED_HUMAN_PIGGY_USD.toFixed(2) +
    " + lottery $" + VITAFEED_LOTTERY_PIGGY_USD.toFixed(2) +
    " (≥ $" + VITAFEED_LEAVE_BEHIND_MIN_USD.toFixed(2) + ")",
  );
  lines.push(
    "tax: " + (VITAFEED_SAVINGS_TAX_PCT * 100).toFixed(1) +
    "% of whole cost (transmission+piggies+gwei+other+hidden)",
  );
  lines.push(
    "seat pick: deepest red first, then fewest trades; each injection a different token",
  );
  if (!plan?.ok) {
    lines.push("BUY SKIP — " + (plan?.reason || "no qualifying seat"));
    lines.push("inscription still pays RISK after confirm (message-first)");
    return lines.join("\n");
  }
  const seatSyms = [...new Set((plan.injections || []).map((inj) => inj.symbol).filter(Boolean))];
  lines.push(
    "seats " + (seatSyms.join(",") || plan.seat?.symbol || "?") +
    "  (deepest red / fewest trades)",
  );
  if (plan.seat) {
    lines.push(
      "first rangePos=" + (plan.seat.rangePos * 100).toFixed(2) +
      "%  dip=" + (plan.seat.dipPct * 100).toFixed(2) + "%",
    );
  }
  lines.push("dip → target = same % up + cost overlay (exit ASAP when green / revenue)");
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
      " (piggies+tax pre-injected)",
    );
    lines.push(
      "  txmit $" + Number(c.transmissionUsd || c.charCostUsd).toFixed(4) +
      "  hidden $" + Number(c.hiddenCostUsd || 0).toFixed(4) +
      "  tax $" + c.taxUsd.toFixed(4),
    );
    lines.push(
      "  AI $" + c.aiPiggyUsd.toFixed(2) +
      "  human $" + c.humanPiggyUsd.toFixed(2) +
      "  lottery $" + Number(c.lotteryPiggyUsd || 0).toFixed(2),
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
