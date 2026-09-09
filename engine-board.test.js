import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classifyWavePhase,
  piggyPaymentLights,
  buildEngineOptions,
  tuneTargets,
  normalizeWaveSeries,
  demoEngineSnapshot,
} from "./engine-board.js";

describe("classifyWavePhase", () => {
  it("marks paddle near predicted trough when flat", () => {
    const p = classifyWavePhase({ price: 10, predEntry: 10.1, trough: 10, holding: false });
    assert.equal(p.phase, "PADDLE");
  });

  it("marks riding while printing highs", () => {
    const p = classifyWavePhase({
      price: 11.0,
      entry: 10,
      rideHigh: 11.0,
      holding: true,
    });
    assert.equal(p.phase, "RIDING");
  });

  it("marks peak zone after turn off ride high", () => {
    const p = classifyWavePhase({
      price: 11.6,
      entry: 10,
      rideHigh: 12,
      holding: true,
    });
    assert.equal(p.phase, "PEAK");
  });

  it("marks trick when exiting", () => {
    const p = classifyWavePhase({ price: 11, holding: true, exiting: true });
    assert.equal(p.phase, "TRICK");
  });
});

describe("piggyPaymentLights", () => {
  it("lights message when leftover covers fees + hitch", () => {
    const lights = piggyPaymentLights({
      leftoverUsd: 0.35,
      feesUsd: 0.1,
      hitchCostUsd: 0.2,
      firstMinEntryUsd: 2,
      proceedsUsd: 0,
    });
    assert.equal(lights.messagePaid, true);
    assert.equal(lights.levels.find((l) => l.id === "message").paid, true);
    assert.equal(lights.levels.find((l) => l.id === "cushion").paid, false);
  });

  it("flags early wipeout when message unpaid but fees paid", () => {
    const lights = piggyPaymentLights({
      leftoverUsd: 0.15,
      feesUsd: 0.1,
      hitchCostUsd: 0.2,
    });
    assert.equal(lights.levels.find((l) => l.id === "fees").paid, true);
    assert.equal(lights.messagePaid, false);
    assert.equal(lights.wipeoutSafe, false);
  });

  it("lights first inject when proceeds clear buffer", () => {
    const lights = piggyPaymentLights({
      leftoverUsd: 1,
      feesUsd: 0.1,
      hitchCostUsd: 0.1,
      firstMinEntryUsd: 2,
      proceedsUsd: 2.4, // clears 8% piggy math buffer + skim runway
      netProfitUsd: 0.15,
      skimUsd: 0.05,
      agentShareUsd: 0.02,
    });
    assert.equal(lights.levels.find((l) => l.id === "inject").paid, true);
    assert.equal(lights.levels.find((l) => l.id === "skim").paid, true);
  });
});

describe("buildEngineOptions", () => {
  it("lists ride / rider / message / both / trickout with costs", () => {
    const board = buildEngineOptions({
      tradeUsd: 2,
      hitchCostUsd: 0.2,
      feesUsd: 0.1,
      leftoverUsd: 0.5,
      holding: false,
      piggyPct: 0.08,
    });
    assert.equal(board.options.length, 5);
    assert.ok(board.options.find((o) => o.id === "ride").enabled);
    assert.ok(board.options.find((o) => o.id === "trickout").enabled === false);
    assert.equal(board.buyCover, true);
  });

  it("enables trickout when holding and fees covered", () => {
    const board = buildEngineOptions({
      tradeUsd: 2,
      hitchCostUsd: 0.2,
      feesUsd: 0.1,
      leftoverUsd: 0.5,
      holding: true,
    });
    const trick = board.options.find((o) => o.id === "trickout");
    assert.equal(trick.enabled, true);
    assert.equal(trick.payload.action, "trickout");
  });
});

describe("tuneTargets", () => {
  it("clamps hand targets within skew of prediction", () => {
    const t = tuneTargets({
      predEntry: 10,
      predExit: 12,
      handEntry: 8,
      handExit: 20,
      maxSkewPct: 0.08,
    });
    assert.ok(t.entry.value >= 10 * 0.92);
    assert.ok(t.exit.value <= 12 * 1.08);
    assert.equal(t.entry.clamped, true);
  });
});

describe("normalizeWaveSeries + demo", () => {
  it("normalizes prices to 0..1", () => {
    const { points, min, max } = normalizeWaveSeries([1, 2, 3]);
    assert.equal(min, 1);
    assert.equal(max, 3);
    assert.equal(points[0].y, 1);
    assert.equal(points[2].y, 0);
  });

  it("builds a demo snapshot with waves and options", () => {
    const snap = demoEngineSnapshot();
    assert.equal(snap.demo, true);
    assert.ok(snap.waves.length >= 3);
    assert.ok(snap.waves[0].options.options.length === 5);
    assert.ok(snap.modules.some((m) => m.id === "wave"));
  });
});
