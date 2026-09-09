/**
 * Guardian Engine board — shared option / piggy / wave-phase math.
 *
 * Powers the /engine UI so humans and agentic bots see the same equations
 * the live injector uses (peak-ride, hitch cover, piggy leave-behind,
 * first-inject paid, early wipeout = message paid when leftover covers).
 *
 * Pure functions only — no Telegram, no chain I/O.
 */

import {
  PEAK_ZONE_PCT,
  FAST_CRASH_PCT,
  nearRideHigh,
  dropFromRideHigh,
  rideHighRisen,
  isMakingNewHighs,
} from "./peak-ride.js";
import { firstInjectPaid, PIGGY_MATH_BUFFER_PCT } from "./second-inject.js";

/** Mirrors lose-zero-gate DEFAULT_HITCH_COST_MULT (avoid importing L1 oracle → viem). */
export const DEFAULT_HITCH_COST_MULT = 2;
/** Mirrors piggy-bank DEFAULT_PIGGY_BANK_PCT. */
export const DEFAULT_PIGGY_BANK_PCT = 0.02;

/** Ride phases for the trough↔peak dance. */
export const WAVE_PHASES = Object.freeze([
  "PADDLE",   // waiting / near predicted trough
  "INJECT",   // entering / just entered
  "RIDING",   // climbing toward ride high
  "PEAK",     // in peak zone — trick-out armed
  "TRICK",    // exit / wipeout in progress
  "RELOAD",   // after exit — wave down, ready to paddle again
]);

/**
 * Classify where price sits in the back-and-forth dance.
 */
export function classifyWavePhase({
  price = 0,
  entry = 0,
  rideHigh = 0,
  trough = 0,
  peak = 0,
  predEntry = 0,
  predExit = 0,
  holding = false,
  exiting = false,
} = {}) {
  const px = Number(price) || 0;
  if (exiting) return { phase: "TRICK", label: "Trick out", dance: "exit" };
  if (!holding && !entry) {
    const target = Number(predEntry) || Number(trough) || 0;
    if (target > 0 && px > 0 && px <= target * 1.02) {
      return { phase: "PADDLE", label: "Paddle in", dance: "enter" };
    }
    if (target > 0 && px > target * 1.02) {
      return { phase: "RELOAD", label: "Wait for set", dance: "wait" };
    }
    return { phase: "PADDLE", label: "Scan waves", dance: "wait" };
  }

  const hi = Number(rideHigh) || Number(peak) || Number(predExit) || px;
  const en = Number(entry) || 0;
  const risen = rideHighRisen({ rideHigh: hi, entry: en });
  const near = nearRideHigh({ price: px, rideHigh: hi, band: PEAK_ZONE_PCT });
  const drop = dropFromRideHigh({ price: px, rideHigh: hi });
  const printingHighs = isMakingNewHighs({ price: px, rideHigh: hi });

  // Still climbing / printing highs = RIDING (do not trick just for touching high-water).
  if (en > 0 && px >= en && printingHighs && drop < FAST_CRASH_PCT * 0.4) {
    return { phase: "RIDING", label: "Riding up", dance: "hold", risen, dropPct: drop };
  }
  // Peak made / turning / fast drop off a risen high — trick armed.
  if ((near && risen && !printingHighs) || (risen && drop >= FAST_CRASH_PCT * 0.5)) {
    return {
      phase: "PEAK",
      label: drop >= FAST_CRASH_PCT ? "Peak turning — fast drop" : "Peak zone — trick armed",
      dance: "exit",
      risen,
      dropPct: drop,
    };
  }
  if (en > 0 && px >= en) {
    return { phase: "RIDING", label: "Riding up", dance: "hold", risen, dropPct: drop };
  }
  return { phase: "INJECT", label: "Injected — settle", dance: "hold", risen, dropPct: drop };
}

/**
 * Piggy / payment lights — what is paid vs not if you wipe out now.
 *
 * Levels (left → right):
 *   fees → hitch1x (message) → hitch2x (sell cushion) → firstInject → skim → agent
 */
export function piggyPaymentLights({
  leftoverUsd = 0,
  feesUsd = 0,
  hitchCostUsd = 0,
  hitchMult = DEFAULT_HITCH_COST_MULT,
  firstMinEntryUsd = 0,
  proceedsUsd = 0,
  netProfitUsd = null,
  piggyBufferPct = PIGGY_MATH_BUFFER_PCT,
  skimUsd = 0,
  agentShareUsd = 0,
} = {}) {
  const left = Math.max(0, Number(leftoverUsd) || 0);
  const fees = Math.max(0, Number(feesUsd) || 0);
  const hitch = Math.max(0, Number(hitchCostUsd) || 0);
  const mult = Math.max(0, Number(hitchMult) || DEFAULT_HITCH_COST_MULT);
  const hitch2 = hitch * mult;

  const feesPaid = left + 1e-12 >= fees;
  const messagePaid = left + 1e-12 >= fees + hitch;
  const sellCushionPaid = left + 1e-12 >= fees + hitch2;

  const paid = firstInjectPaid({
    proceedsEth: Number(proceedsUsd) || 0,
    firstMinEntryEth: Number(firstMinEntryUsd) || 0,
    piggyBufferPct,
    netProfitEth: netProfitUsd,
  });

  const skimNeed = Math.max(0, Number(skimUsd) || 0);
  const agentNeed = Math.max(0, Number(agentShareUsd) || 0);
  const afterFirst = Math.max(0, (Number(proceedsUsd) || 0) - (paid.needEth || 0));
  const skimPaid = paid.paid && afterFirst + 1e-12 >= skimNeed;
  const agentPaid = skimPaid && afterFirst - skimNeed + 1e-12 >= agentNeed;

  const levels = [
    { id: "fees", label: "Fees", paid: feesPaid, needUsd: fees },
    { id: "message", label: "Message paid", paid: messagePaid, needUsd: fees + hitch },
    { id: "cushion", label: "Sell cushion 2×", paid: sellCushionPaid, needUsd: fees + hitch2 },
    { id: "inject", label: "First inject", paid: !!paid.paid, needUsd: paid.needEth || 0 },
    { id: "skim", label: "Piggy skim", paid: skimPaid, needUsd: skimNeed },
    { id: "agent", label: "Agent share", paid: agentPaid, needUsd: agentNeed },
  ];

  const lit = levels.filter((l) => l.paid).length;
  return {
    levels,
    lit,
    total: levels.length,
    messagePaid,
    wipeoutSafe: messagePaid,
    firstInject: paid,
  };
}

/**
 * Options shown when operator presses a button — costs at press time.
 *
 * Modes:
 *   ride     — rider + hitch message if leftover covers (else plain rider)
 *   rider    — plain swap only
 *   message  — dedicated /prove letter (0-ETH self-tx), no position change
 *   both     — plan hitch on entry AND require sell cushion for exit hitch
 *   trickout — exit now; prefer hitch if message paid, else plain sell if fees paid
 */
export function buildEngineOptions({
  tradeUsd = 0,
  hitchCostUsd = 0,
  feesUsd = 0,
  gasUsd = 0,
  leftoverUsd = 0,
  holding = false,
  piggyPct = DEFAULT_PIGGY_BANK_PCT,
  hitchMult = DEFAULT_HITCH_COST_MULT,
  ethUsd = 3000,
} = {}) {
  const trade = Math.max(0, Number(tradeUsd) || 0);
  const hitch = Math.max(0, Number(hitchCostUsd) || 0);
  const fees = Math.max(0, Number(feesUsd) || 0) + Math.max(0, Number(gasUsd) || 0);
  const left = Math.max(0, Number(leftoverUsd) || 0);
  const pct = Math.max(0, Math.min(0.5, Number(piggyPct) || DEFAULT_PIGGY_BANK_PCT));
  const mult = Math.max(0, Number(hitchMult) || DEFAULT_HITCH_COST_MULT);
  const dustUsd = trade * pct;

  const buyCover = left + 1e-12 >= hitch;
  const sellCover = left + 1e-12 >= hitch * mult;
  const feesCover = left + 1e-12 >= fees;

  const options = [
    {
      id: "ride",
      label: "Ride wave",
      blurb: "Paddle in — rider + Eureka hitch when leftover covers",
      costUsd: trade + fees + (buyCover ? hitch : 0),
      hitch: buyCover ? "on" : "skip (leftover thin)",
      enabled: trade > 0 && !holding,
      payload: { action: "ride", hitchMode: buyCover ? "hitch" : "plain" },
    },
    {
      id: "rider",
      label: "Rider only",
      blurb: "Plain swap — no message bytes on this fill",
      costUsd: trade + fees,
      hitch: "off",
      enabled: trade > 0 && !holding,
      payload: { action: "rider", hitchMode: "plain" },
    },
    {
      id: "message",
      label: "Message only",
      blurb: "Dedicated §$STORE§ proof tx (0 ETH value) — Basescan UTF-8",
      costUsd: hitch + fees * 0.35,
      hitch: "prove",
      enabled: true,
      payload: { action: "message" },
    },
    {
      id: "both",
      label: "Both ends",
      blurb: "Hitch on entry when covered; hold sell until 2× cushion for exit hitch",
      costUsd: trade + fees + hitch + hitch * mult,
      hitch: "entry+exit",
      enabled: trade > 0 && !holding,
      payload: { action: "both", hitchMode: "both" },
    },
    {
      id: "trickout",
      label: "Trick out",
      blurb: feesCover
        ? (sellCover
          ? "Exit with message — cushion paid"
          : "Exit plain — fees paid, message not covered (early wipeout still pays fees)")
        : "Hold — leftover ≤ 0 after fees (would lose)",
      costUsd: fees + (sellCover ? hitch * mult : 0),
      hitch: sellCover ? "on" : feesCover ? "skip — message unpaid" : "blocked",
      enabled: holding && feesCover,
      messagePaid: sellCover || (feesCover && left >= fees + hitch),
      payload: { action: "trickout", hitchMode: sellCover ? "hitch" : "plain" },
    },
  ];

  return {
    tradeUsd: trade,
    hitchCostUsd: hitch,
    feesUsd: fees,
    leftoverUsd: left,
    piggyDustUsd: dustUsd,
    piggyPct: pct,
    ethUsd: Number(ethUsd) || 0,
    buyCover,
    sellCover,
    feesCover,
    options,
  };
}

/**
 * Fine-tune targets — clamp hand-set entry/exit around live predictions.
 */
export function tuneTargets({
  predEntry = 0,
  predExit = 0,
  handEntry = null,
  handExit = null,
  maxSkewPct = 0.08,
} = {}) {
  const pe = Number(predEntry) || 0;
  const px = Number(predExit) || 0;
  const skew = Math.max(0, Math.min(0.5, Number(maxSkewPct) || 0.08));

  function clamp(hand, pred) {
    if (hand == null || !Number.isFinite(Number(hand)) || !(pred > 0)) {
      return { value: pred > 0 ? pred : Number(hand) || 0, tuned: false, source: pred > 0 ? "pred" : "hand" };
    }
    const h = Number(hand);
    const lo = pred * (1 - skew);
    const hi = pred * (1 + skew);
    const value = Math.min(hi, Math.max(lo, h));
    return { value, tuned: Math.abs(value - pred) / pred > 1e-9, source: "hand", clamped: value !== h };
  }

  const entry = clamp(handEntry, pe);
  const exit = clamp(handExit, px);
  return { entry, exit, maxSkewPct: skew };
}

/**
 * Normalize a waveform series for canvas (0..1 y).
 */
export function normalizeWaveSeries(prices = []) {
  const arr = (prices || []).map(Number).filter((p) => Number.isFinite(p) && p > 0);
  if (!arr.length) return { points: [], min: 0, max: 0 };
  const min = Math.min(...arr);
  const max = Math.max(...arr);
  const span = max - min || 1;
  const points = arr.map((p, i) => ({
    i,
    price: p,
    x: arr.length === 1 ? 0.5 : i / (arr.length - 1),
    y: 1 - (p - min) / span,
  }));
  return { points, min, max };
}

/**
 * Demo catalog for offline engine UI (no webhook secret).
 */
export function demoEngineSnapshot() {
  const now = Date.now();
  const mkWave = (base, amp, n = 48, phase = 0) =>
    Array.from({ length: n }, (_, i) => {
      const t = i / n;
      return base * (1 + amp * Math.sin((t * Math.PI * 2) + phase) + amp * 0.15 * Math.sin(t * 11 + phase));
    });

  const tokens = [
    { symbol: "LINK", base: 14.2, amp: 0.035, piggyPct: 0.08, holding: true, phase: 0.4 },
    { symbol: "UNI", base: 8.1, amp: 0.04, piggyPct: 0.02, holding: false, phase: 1.2 },
    { symbol: "AERO", base: 1.05, amp: 0.06, piggyPct: 0.02, holding: true, phase: 2.1 },
    { symbol: "DEGEN", base: 0.0062, amp: 0.08, piggyPct: 0.02, holding: false, phase: 0.8 },
    { symbol: "VVV", base: 2.4, amp: 0.05, piggyPct: 0.02, holding: false, phase: 1.7 },
  ];

  const ethUsd = 3200;
  const hitchCostUsd = 0.18;
  const feesUsd = 0.12;

  return {
    ok: true,
    demo: true,
    running: false,
    walletAddress: null,
    ethUsd,
    hitchCostUsd,
    feesUsd,
    hitchProve: { count: 7, target: 20, profitUsd: 1.42 },
    favorite: "LINK",
    injectMains: ["LINK", "UNI", "VVV", "ZORA", "BNKR", "AERO", "MORPHO"],
    modules: [
      { id: "wave", label: "Wave engine", lit: true },
      { id: "peak", label: "Peak ride", lit: true },
      { id: "hitch", label: "Hitch message", lit: true },
      { id: "cost", label: "Cost edge", lit: true },
      { id: "piggy", label: "Piggy banks", lit: true },
      { id: "surfer", label: "Surfer pool", lit: true },
      { id: "v4", label: "V4 offshoot", lit: false, note: "npm run start:v4" },
    ],
    surfers: [
      { name: "KAHUNA", status: "RIDING", symbol: "LINK", usdAlloc: 4, pnlUsd: 0.22 },
      { name: "PIPELINE", status: "WAITING", symbol: "UNI", usdAlloc: 3, pnlUsd: 0 },
    ],
    waves: tokens.map((t) => {
      const series = mkWave(t.base, t.amp, 48, t.phase);
      const price = series[series.length - 1];
      const trough = Math.min(...series.slice(-24));
      const peak = Math.max(...series.slice(-24));
      const entry = t.holding ? trough * 1.01 : null;
      const rideHigh = t.holding ? Math.max(entry, ...series.slice(-12)) : 0;
      const predEntry = trough * 0.998;
      const predExit = peak * 0.995;
      const phase = classifyWavePhase({
        price,
        entry,
        rideHigh,
        trough,
        peak,
        predEntry,
        predExit,
        holding: t.holding,
      });
      const leftoverUsd = t.holding ? Math.max(0, (price - entry) / entry * 4 - feesUsd) : 2.5;
      const lights = piggyPaymentLights({
        leftoverUsd,
        feesUsd,
        hitchCostUsd,
        firstMinEntryUsd: 2.2,
        proceedsUsd: t.holding ? 4.4 : 0,
        netProfitUsd: t.holding ? leftoverUsd : null,
        skimUsd: 0.04,
        agentShareUsd: 0.02,
      });
      const options = buildEngineOptions({
        tradeUsd: 2,
        hitchCostUsd,
        feesUsd,
        leftoverUsd,
        holding: t.holding,
        piggyPct: t.piggyPct,
        ethUsd,
      });
      return {
        symbol: t.symbol,
        price,
        series,
        trough,
        peak,
        entry,
        rideHigh,
        predEntry,
        predExit,
        piggyPct: t.piggyPct,
        holding: t.holding,
        phase,
        lights,
        options,
        updatedAt: new Date(now).toISOString(),
      };
    }),
    timestamp: new Date(now).toISOString(),
  };
}
