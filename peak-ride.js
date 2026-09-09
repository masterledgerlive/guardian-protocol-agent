/**
 * Peak-ride / perfect-injection exit protocol.
 *
 * Operator brief (ledger lessons):
 *   - Do not sell just because price touched a historical MAX peak — breakouts
 *     must ratchet a ride high-water mark and keep climbing.
 *   - Sell when the peak has been MADE: stagnant near the ride high + signs
 *     to lower (tick-down / MACD / RSI roll).
 *   - Sell lower than the absolute tip only when the peak rose and price
 *     crashed too fast to wait for a full top confirmation.
 *   - Safety-net ladder on drastic drops from the ride high (not from entry)
 *     so an "ultimate high" ride survives shallow dips but still dumps on
 *     cliff falls.
 *   - Predicted peak/trough from wave math guide the zones; they never eject
 *     alone mid-range (AIXBT PREDICTED PEAK mid-bag then +100% miss).
 *   - After exit → inject at predicted / primed bottoms (second-inject.js).
 *
 * Still never sells when leftover / piggy-aligned net ≤ break-even buffer
 * (caller enforces lose-zero).
 */

/** Fraction of ride-high that counts as "at the top zone". */
export const PEAK_ZONE_PCT = 0.985; // within 1.5% of ride high

/** Historical maxPeak touch alone is NOT a sell — need turn or crash. */
export const HIST_PEAK_TOUCH_PCT = 0.995;

/** Tick-down within this of ride high = confirmed turn (instant). */
export const TURN_NEAR_HIGH_PCT = 0.99;

/** Minimum rise of ride high above entry before fast-crash / deep nets arm. */
export const RISEN_PEAK_MIN_PCT = 0.012; // 1.2% above entry

/** Fast crash from risen peak — too fast to wait for RSI/MACD stack. */
export const FAST_CRASH_PCT = 0.025; // 2.5% off ride high in recent window

/** Stagnation: max |move| vs ride high over the stale window to count as flat-top. */
export const STAGNANT_MOVE_PCT = 0.004; // 0.4% — matches WAVE_MIN_MOVE / STALE_MOVE

/**
 * Safety-net ladder from ride high (deepest first for matching).
 * Armed only after ride high has risen above entry (ultimate-high case:
 * shallow dips do not eject while still making highs).
 */
export const SAFETY_NETS = Object.freeze([
  { id: "cliff", dropPct: 0.08, requireRisen: true, requireTickDown: false },
  { id: "hard", dropPct: 0.05, requireRisen: true, requireTickDown: true },
  { id: "soft", dropPct: 0.03, requireRisen: true, requireTickDown: true },
]);

/**
 * Ratchet the per-position ride high-water mark.
 * Call every tick while holding; reset on flat/exit.
 */
export function updateRideHigh(prevHigh = 0, price = 0) {
  const px = Number(price);
  const hi = Number(prevHigh);
  if (!(px > 0)) return Number.isFinite(hi) && hi > 0 ? hi : 0;
  if (!(hi > 0)) return px;
  return px > hi ? px : hi;
}

export function rideHighRisen({ rideHigh = 0, entry = 0, minPct = RISEN_PEAK_MIN_PCT } = {}) {
  const hi = Number(rideHigh);
  const en = Number(entry);
  if (!(hi > 0) || !(en > 0)) return false;
  return hi >= en * (1 + Math.max(0, Number(minPct) || 0));
}

export function dropFromRideHigh({ price = 0, rideHigh = 0 } = {}) {
  const px = Number(price);
  const hi = Number(rideHigh);
  if (!(px > 0) || !(hi > 0)) return 0;
  return Math.max(0, (hi - px) / hi);
}

export function nearRideHigh({ price = 0, rideHigh = 0, band = PEAK_ZONE_PCT } = {}) {
  const px = Number(price);
  const hi = Number(rideHigh);
  if (!(px > 0) || !(hi > 0)) return false;
  return px >= hi * Math.max(0, Math.min(1, Number(band) || PEAK_ZONE_PCT));
}

export function isMakingNewHighs({ price = 0, rideHigh = 0, epsilonPct = 0.0005 } = {}) {
  const px = Number(price);
  const hi = Number(rideHigh);
  if (!(px > 0) || !(hi > 0)) return false;
  // At or within epsilon of the high-water — still climbing / printing tops
  return px >= hi * (1 - Math.max(0, Number(epsilonPct) || 0));
}

/**
 * Turn signs after a peak print: tick-down, MACD cross-down, RSI rolling off
 * overbought, or stagnant-at-high then any down tick.
 */
export function peakTurnSigns({
  recentTickDown = false,
  macdCrossDown = false,
  rsi = null,
  rsiWasOverbought = false,
  stagnantNearHigh = false,
  priceFallingFast = false,
} = {}) {
  const rsiVal = rsi == null ? null : Number(rsi);
  const rsiRolling =
    rsiVal != null &&
    Number.isFinite(rsiVal) &&
    ((rsiWasOverbought && rsiVal < 60) || (rsiVal >= 55 && rsiVal < 70 && recentTickDown));
  const signs = {
    tickDown: !!recentTickDown,
    macd: !!macdCrossDown,
    rsiRoll: !!rsiRolling,
    stagnantTurn: !!stagnantNearHigh && (!!recentTickDown || !!macdCrossDown || !!priceFallingFast),
    fastFall: !!priceFallingFast,
  };
  const hit = Object.entries(signs).filter(([, v]) => v).map(([k]) => k);
  return { count: hit.length, hit, signs };
}

/**
 * Predicted-peak sells are allowed only inside the peak zone (ride high or
 * model predicted peak). Mid-range pre-sell is how AIXBT left +100% on the table.
 */
export function allowPredictedPeakSell({
  predSell = false,
  price = 0,
  rideHigh = 0,
  predictedPeak = null,
  histMaxPeak = null,
  band = PEAK_ZONE_PCT,
} = {}) {
  if (!predSell) return false;
  const px = Number(price);
  if (!(px > 0)) return false;
  const targets = [rideHigh, predictedPeak, histMaxPeak]
    .map((x) => Number(x))
    .filter((x) => x > 0);
  if (!targets.length) return false;
  const top = Math.max(...targets);
  return px >= top * Math.max(0, Math.min(1, Number(band) || PEAK_ZONE_PCT));
}

/**
 * Stale / sideways exits: only when near the ride high (peak made + flat) or
 * after turn signs. Mid-climb stagnant must HOLD so capital rides the wave.
 */
export function allowStalePeakExit({
  stagnant = false,
  nearHigh = false,
  turnCount = 0,
  risen = false,
  netUsdOk = false,
} = {}) {
  if (!stagnant || !netUsdOk) return false;
  if (nearHigh && (turnCount > 0 || risen)) return true;
  if (nearHigh && risen) return true;
  return false;
}

/**
 * Match the deepest armed safety net for a drop from ride high.
 */
export function matchSafetyNet({
  dropPct = 0,
  risen = false,
  recentTickDown = false,
  nets = SAFETY_NETS,
} = {}) {
  const drop = Math.max(0, Number(dropPct) || 0);
  const list = Array.isArray(nets) ? nets : SAFETY_NETS;
  for (const net of list) {
    const need = Number(net.dropPct) || 0;
    if (!(drop + 1e-12 >= need)) continue;
    if (net.requireRisen && !risen) continue;
    if (net.requireTickDown && !recentTickDown) continue;
    return net;
  }
  return null;
}

/**
 * Core decision — should this hold exit now?
 *
 * @returns {{
 *   sell: boolean,
 *   kind: string|null,
 *   reason: string,
 *   rideHigh: number,
 *   dropPct: number,
 *   risen: boolean,
 *   nearHigh: boolean,
 *   turn: object,
 *   safetyNet: object|null,
 * }}
 */
export function evaluatePeakRideExit({
  price = 0,
  entry = 0,
  rideHigh = 0,
  histMaxPeak = null,
  predictedPeak = null,
  recentTickDown = false,
  macdCrossDown = false,
  rsi = null,
  rsiWasOverbought = false,
  stagnantNearHigh = false,
  priceFallingFast = false,
  netUsd = 0,
  breakEvenBuffer = 0,
  sellableUsdOk = false,
  predSell = false,
  earlySellSignal = false,
  profitableSell = false,
} = {}) {
  const px = Number(price);
  const hi = updateRideHigh(rideHigh, px);
  const buf = Math.max(0, Number(breakEvenBuffer) || 0);
  const net = Number(netUsd);
  const netOk = sellableUsdOk && Number.isFinite(net) && net > buf;
  const risen = rideHighRisen({ rideHigh: hi, entry });
  const dropPct = dropFromRideHigh({ price: px, rideHigh: hi });
  const nearHigh = nearRideHigh({ price: px, rideHigh: hi });
  const makingHighs = isMakingNewHighs({ price: px, rideHigh: hi });
  const turn = peakTurnSigns({
    recentTickDown,
    macdCrossDown,
    rsi,
    rsiWasOverbought,
    stagnantNearHigh,
    priceFallingFast,
  });

  const base = {
    sell: false,
    kind: null,
    reason: "hold — ride",
    rideHigh: hi,
    dropPct,
    risen,
    nearHigh,
    turn,
    safetyNet: null,
  };

  if (!netOk || !(px > 0) || !(hi > 0)) {
    return { ...base, reason: !sellableUsdOk ? "no sellable usd" : "net ≤ buffer / lose-zero" };
  }

  // ── 1. Peak confirmed: at/near ride high + turn signs (or stagnant turn) ──
  if (nearHigh && turn.count > 0 && !makingHighs) {
    return {
      ...base,
      sell: true,
      kind: "peak_turn",
      reason: `peak turn @ ride high ($${hi}) [${turn.hit.join("+")}]`,
    };
  }
  // Still printing the high — only eject on strong multi-sign turn
  if (nearHigh && makingHighs && turn.count >= 2) {
    return {
      ...base,
      sell: true,
      kind: "peak_confirm",
      reason: `peak confirmed at high ($${hi}) [${turn.hit.join("+")}]`,
    };
  }
  // Stagnant at the top with any down sign
  if (stagnantNearHigh && turn.signs.stagnantTurn) {
    return {
      ...base,
      sell: true,
      kind: "stagnant_top",
      reason: `stagnant at peak then lower ($${hi})`,
    };
  }

  // ── 2. Fast crash from a risen peak — tip already printed, too fast to wait ─
  if (risen && (dropPct >= FAST_CRASH_PCT || priceFallingFast) && (recentTickDown || priceFallingFast)) {
    return {
      ...base,
      sell: true,
      kind: "fast_crash",
      reason: `fast crash ${(dropPct * 100).toFixed(1)}% off ride high $${hi}`,
    };
  }

  // ── 3. Safety-net ladder on drastic drops from ride high ─────────────────
  const netHit = matchSafetyNet({ dropPct, risen, recentTickDown });
  if (netHit) {
    return {
      ...base,
      sell: true,
      kind: `safety_${netHit.id}`,
      reason: `safety net ${netHit.id} (−${(netHit.dropPct * 100).toFixed(0)}% from $${hi})`,
      safetyNet: netHit,
    };
  }

  // ── 4. Indicator early / profitable sell — only inside peak zone ─────────
  if ((earlySellSignal || profitableSell) && nearHigh) {
    return {
      ...base,
      sell: true,
      kind: earlySellSignal ? "early_peak" : "profitable_peak",
      reason: earlySellSignal
        ? `early sell near ride high $${hi}`
        : `profitable turn near ride high $${hi}`,
    };
  }

  // ── 5. Predicted peak — only when price is in the model/ride peak zone ───
  if (
    allowPredictedPeakSell({
      predSell,
      price: px,
      rideHigh: hi,
      predictedPeak,
      histMaxPeak,
    })
  ) {
    return {
      ...base,
      sell: true,
      kind: "predicted_peak",
      reason: `predicted peak zone (ride $${hi})`,
    };
  }

  // Historical maxPeak touch alone never sells while still making highs.
  const hist = Number(histMaxPeak);
  if (hist > 0 && px >= hist * HIST_PEAK_TOUCH_PCT && nearHigh && turn.count > 0 && !makingHighs) {
    return {
      ...base,
      sell: true,
      kind: "hist_peak_turn",
      reason: `hist max $${hist} + turn [${turn.hit.join("+")}]`,
    };
  }

  return {
    ...base,
    reason: makingHighs
      ? "riding new highs — hold"
      : risen
        ? "risen peak — waiting turn / net"
        : "below risen threshold — hold for wave",
  };
}

/**
 * Instant peak helper — replaces bare atMaxPeak auto-sell.
 * Touching hist max or ride high is not enough; need tick-down (or multi-sign).
 */
export function isInstantPeakSell({
  atMaxPeak = false,
  price = 0,
  maxPeak = 0,
  rideHigh = 0,
  recentTickDown = false,
  netUsd = 0,
  breakEvenBuffer = 0,
  sellableUsdOk = false,
  turnCount = 0,
} = {}) {
  if (!sellableUsdOk) return false;
  const net = Number(netUsd);
  const buf = Math.max(0, Number(breakEvenBuffer) || 0);
  if (!(Number.isFinite(net) && net > buf)) return false;

  const px = Number(price);
  const hi = updateRideHigh(rideHigh || maxPeak, px);
  const near = nearRideHigh({ price: px, rideHigh: hi, band: TURN_NEAR_HIGH_PCT });
  const histTouch = atMaxPeak || (Number(maxPeak) > 0 && px >= Number(maxPeak) * HIST_PEAK_TOUCH_PCT);

  // Must be near the (ride) top AND turning — never eject on touch alone
  if (!(near || histTouch)) return false;
  if (recentTickDown || turnCount >= 2) return near || histTouch;
  return false;
}

/** Compact Telegram / log label from evaluatePeakRideExit result. */
export function formatPeakRideDecision(dec) {
  if (!dec) return "peak-ride: ?";
  if (!dec.sell) return `🛡️ HOLD ${dec.reason}`;
  return `🎯 SELL [${dec.kind}] ${dec.reason}`;
}
