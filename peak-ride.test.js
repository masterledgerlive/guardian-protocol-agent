/**
 * peak-ride.js — ride high-water, sell on turn / fast crash / safety nets.
 * Ledger lessons: hist-max touch + mid-range predSell left large upside.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  updateRideHigh,
  rideHighRisen,
  dropFromRideHigh,
  nearRideHigh,
  isMakingNewHighs,
  peakTurnSigns,
  allowPredictedPeakSell,
  allowStalePeakExit,
  matchSafetyNet,
  evaluatePeakRideExit,
  isInstantPeakSell,
  formatPeakRideDecision,
  SAFETY_NETS,
  FAST_CRASH_PCT,
} from "./peak-ride.js";

const root = dirname(fileURLToPath(import.meta.url));
const agentSrc = readFileSync(join(root, "agent.js"), "utf8");

describe("peak-ride: ride high-water ratchet", () => {
  it("ratchets up and never down", () => {
    assert.equal(updateRideHigh(0, 10), 10);
    assert.equal(updateRideHigh(10, 11), 11);
    assert.equal(updateRideHigh(11, 10.5), 11);
  });

  it("marks risen only after meaningful lift above entry", () => {
    assert.equal(rideHighRisen({ rideHigh: 1.005, entry: 1 }), false);
    assert.equal(rideHighRisen({ rideHigh: 1.02, entry: 1 }), true);
  });
});

describe("peak-ride: do not sell hist max on breakout", () => {
  it("holds when price touches hist max but keeps printing highs", () => {
    const dec = evaluatePeakRideExit({
      price: 10.0,
      entry: 9.0,
      rideHigh: 10.0, // still at the high
      histMaxPeak: 9.95,
      recentTickDown: false,
      netUsd: 2,
      breakEvenBuffer: 0.1,
      sellableUsdOk: true,
      predSell: false,
    });
    assert.equal(dec.sell, false);
    assert.match(dec.reason, /riding new highs|hold/i);
  });

  it("sells hist max only after turn off the high", () => {
    const dec = evaluatePeakRideExit({
      price: 9.96,
      entry: 9.0,
      rideHigh: 10.0,
      histMaxPeak: 9.95,
      recentTickDown: true,
      netUsd: 2,
      breakEvenBuffer: 0.1,
      sellableUsdOk: true,
    });
    assert.equal(dec.sell, true);
    assert.ok(["peak_turn", "hist_peak_turn", "fast_crash"].includes(dec.kind));
  });
});

describe("peak-ride: predicted peak mid-range must HOLD (AIXBT lesson)", () => {
  it("refuses predSell when price is far below ride/predicted peak", () => {
    assert.equal(
      allowPredictedPeakSell({
        predSell: true,
        price: 0.02523,
        rideHigh: 0.0278,
        predictedPeak: 0.028,
        histMaxPeak: 0.02785,
      }),
      false,
    );
    const dec = evaluatePeakRideExit({
      price: 0.02523,
      entry: 0.02554,
      rideHigh: 0.02554,
      histMaxPeak: 0.02785,
      predictedPeak: 0.028,
      predSell: true,
      netUsd: 0.05,
      breakEvenBuffer: 0.01,
      sellableUsdOk: true,
    });
    assert.equal(dec.sell, false);
  });

  it("allows predSell inside peak zone", () => {
    assert.equal(
      allowPredictedPeakSell({
        predSell: true,
        price: 0.0277,
        rideHigh: 0.0278,
        predictedPeak: 0.028,
      }),
      true,
    );
  });
});

describe("peak-ride: stagnant at top + signs lower → sell", () => {
  it("sells stagnant top after tick-down", () => {
    const dec = evaluatePeakRideExit({
      price: 10.0,
      entry: 9.0,
      rideHigh: 10.02,
      stagnantNearHigh: true,
      recentTickDown: true,
      netUsd: 1,
      breakEvenBuffer: 0.05,
      sellableUsdOk: true,
    });
    assert.equal(dec.sell, true);
    assert.ok(["stagnant_top", "peak_turn", "peak_confirm"].includes(dec.kind));
  });

  it("stale mid-climb does not qualify", () => {
    assert.equal(
      allowStalePeakExit({
        stagnant: true,
        nearHigh: false,
        turnCount: 0,
        risen: true,
        netUsdOk: true,
      }),
      false,
    );
    assert.equal(
      allowStalePeakExit({
        stagnant: true,
        nearHigh: true,
        turnCount: 1,
        risen: true,
        netUsdOk: true,
      }),
      true,
    );
  });
});

describe("peak-ride: fast crash + safety nets from risen peak", () => {
  it("sells fast crash off risen high", () => {
    const hi = 10;
    const px = hi * (1 - FAST_CRASH_PCT - 0.001);
    const dec = evaluatePeakRideExit({
      price: px,
      entry: 9,
      rideHigh: hi,
      recentTickDown: true,
      netUsd: 1,
      breakEvenBuffer: 0.05,
      sellableUsdOk: true,
    });
    assert.equal(dec.sell, true);
    assert.equal(dec.kind, "fast_crash");
  });

  it("cliff safety net fires without tick-down after risen peak", () => {
    const net = matchSafetyNet({
      dropPct: 0.09,
      risen: true,
      recentTickDown: false,
    });
    assert.equal(net?.id, "cliff");
    const dec = evaluatePeakRideExit({
      price: 9.1,
      entry: 9.0,
      rideHigh: 10.0,
      recentTickDown: false,
      netUsd: 0.5,
      breakEvenBuffer: 0.05,
      sellableUsdOk: true,
    });
    assert.equal(dec.sell, true);
    assert.equal(dec.kind, "safety_cliff");
  });

  it("shallow dip without risen peak does not arm nets (ultimate-high ride)", () => {
    // Nets themselves stay cold until the ride high has risen
    assert.equal(matchSafetyNet({ dropPct: 0.04, risen: false, recentTickDown: true }), null);
    assert.equal(matchSafetyNet({ dropPct: 0.09, risen: false, recentTickDown: false }), null);
    assert.equal(rideHighRisen({ rideHigh: 1.005, entry: 1.0 }), false);
    // Mid-climb, still near the rising high, no turn → hold (ride the wave)
    const climbing = evaluatePeakRideExit({
      price: 1.05,
      entry: 1.0,
      rideHigh: 1.05,
      recentTickDown: false,
      netUsd: 0.5,
      breakEvenBuffer: 0.01,
      sellableUsdOk: true,
    });
    assert.equal(climbing.sell, false);
    assert.match(climbing.reason, /riding new highs|hold/i);
  });

  it("exports ordered safety nets deepest first", () => {
    assert.ok(SAFETY_NETS[0].dropPct >= SAFETY_NETS[1].dropPct);
  });
});

describe("peak-ride: isInstantPeakSell requires turn", () => {
  it("does not sell on atMaxPeak alone", () => {
    assert.equal(
      isInstantPeakSell({
        atMaxPeak: true,
        netUsd: 1,
        breakEvenBuffer: 0.1,
        sellableUsdOk: true,
        recentTickDown: false,
      }),
      false,
    );
  });

  it("sells on tick-down within 1% of peak", () => {
    assert.equal(
      isInstantPeakSell({
        price: 10,
        maxPeak: 10.05,
        rideHigh: 10.05,
        recentTickDown: true,
        netUsd: 1,
        breakEvenBuffer: 0.1,
        sellableUsdOk: true,
      }),
      true,
    );
  });
});

describe("peak-ride: helpers + agent wiring", () => {
  it("formats decisions", () => {
    assert.match(formatPeakRideDecision({ sell: false, reason: "riding" }), /HOLD/);
    assert.match(formatPeakRideDecision({ sell: true, kind: "peak_turn", reason: "x" }), /SELL/);
  });

  it("drop / near / making-highs math", () => {
    assert.ok(Math.abs(dropFromRideHigh({ price: 9, rideHigh: 10 }) - 0.1) < 1e-9);
    assert.equal(nearRideHigh({ price: 9.9, rideHigh: 10 }), true);
    assert.equal(isMakingNewHighs({ price: 10, rideHigh: 10 }), true);
    assert.equal(peakTurnSigns({ recentTickDown: true }).count >= 1, true);
  });

  it("agent.js imports peak-ride protocol", () => {
    assert.ok(agentSrc.includes('from "./peak-ride.js"') || agentSrc.includes("peak-ride"));
    assert.ok(agentSrc.includes("evaluatePeakRideExit"));
  });
});
