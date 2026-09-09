/**
 * second-inject.js — paid first portion + surplus → second READY inject.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  firstInjectPaid,
  canSecondInject,
  planSuccessionInjections,
  isInstantPeakSell,
  isPrimedBottomEntry,
  formatSuccessionPlan,
  MAX_SUCCESSION_INJECTS,
  PIGGY_MATH_BUFFER_PCT,
} from "./second-inject.js";

const root = dirname(fileURLToPath(import.meta.url));
const agentSrc = readFileSync(join(root, "agent.js"), "utf8");

describe("second-inject: first portion paid + piggy runway", () => {
  it("requires proceeds ≥ min entry × (1 + piggy buffer)", () => {
    const min = 0.001;
    const need = min * (1 + PIGGY_MATH_BUFFER_PCT);
    const short = firstInjectPaid({ proceedsEth: need * 0.9, firstMinEntryEth: min });
    assert.equal(short.paid, false);
    const ok = firstInjectPaid({ proceedsEth: need, firstMinEntryEth: min, netProfitEth: 0.0001 });
    assert.equal(ok.paid, true);
    assert.ok(ok.surplusEth >= 0);
  });

  it("refuses when net profit is non-positive", () => {
    const r = firstInjectPaid({
      proceedsEth: 0.01,
      firstMinEntryEth: 0.001,
      netProfitEth: 0,
    });
    assert.equal(r.paid, false);
  });
});

describe("second-inject: second gate", () => {
  it("fires when first paid, next READY, surplus clears min without gas wipe", () => {
    const gate = canSecondInject({
      proceedsEth: 0.006,
      firstMinEntryEth: 0.002,
      secondMinEntryEth: 0.002,
      liquidEth: 0.008,
      gasFloorEth: 0.001,
      firstDeployEth: 0.0025,
      nextReady: true,
      nextAllow: true,
      netProfitEth: 0.001,
    });
    assert.equal(gate.allow, true);
    assert.ok(gate.deployEth >= 0.002);
  });

  it("holds when next avenue is not READY and not near bottom", () => {
    const gate = canSecondInject({
      proceedsEth: 0.006,
      firstMinEntryEth: 0.002,
      secondMinEntryEth: 0.002,
      liquidEth: 0.008,
      gasFloorEth: 0.001,
      firstDeployEth: 0.0025,
      nextReady: false,
      nextNearBottom: false,
      nextAllow: true,
      netProfitEth: 0.001,
    });
    assert.equal(gate.allow, false);
    assert.match(gate.reason, /READY|near bottom/i);
  });

  it("fires second inject when next is near-bottom even if not READY", () => {
    const gate = canSecondInject({
      proceedsEth: 0.006,
      firstMinEntryEth: 0.002,
      secondMinEntryEth: 0.002,
      liquidEth: 0.008,
      gasFloorEth: 0.001,
      firstDeployEth: 0.0025,
      nextReady: false,
      nextNearBottom: true,
      nextAllow: true,
      netProfitEth: 0.001,
    });
    assert.equal(gate.allow, true);
    assert.ok(gate.deployEth >= 0.002);
  });

  it("holds when surplus would deplete gas floor", () => {
    const gate = canSecondInject({
      proceedsEth: 0.0035,
      firstMinEntryEth: 0.002,
      secondMinEntryEth: 0.002,
      liquidEth: 0.0035,
      gasFloorEth: 0.0015,
      firstDeployEth: 0.002,
      nextReady: true,
      nextAllow: true,
      netProfitEth: 0.0005,
    });
    assert.equal(gate.allow, false);
  });
});

describe("second-inject: succession plan", () => {
  it("plans first + second READY seats when surplus pays both", () => {
    const plan = planSuccessionInjections({
      proceedsEth: 0.007,
      liquidEth: 0.009,
      gasFloorEth: 0.001,
      netProfitEth: 0.0015,
      excludeSymbol: "KEYCAT",
      candidates: [
        {
          symbol: "UNI",
          minEntryEth: 0.002,
          readyNow: true,
          allow: true,
          outcomeScore: 90,
          netMargin: 0.05,
        },
        {
          symbol: "LINK",
          minEntryEth: 0.002,
          readyNow: true,
          allow: true,
          outcomeScore: 80,
          netMargin: 0.045,
        },
        {
          symbol: "SKI",
          minEntryEth: 0.002,
          readyNow: false,
          allow: true,
          outcomeScore: 40,
          netMargin: 0.03,
        },
      ],
    });
    assert.equal(plan.injections.length, MAX_SUCCESSION_INJECTS);
    assert.equal(plan.secondFired, true);
    assert.equal(plan.injections[0].symbol, "UNI");
    assert.equal(plan.injections[1].symbol, "LINK");
    assert.equal(plan.injections[1].secondInject, true);
    assert.match(formatSuccessionPlan(plan), /2ND/);
  });

  it("stops at first inject when second not READY and not near bottom", () => {
    const plan = planSuccessionInjections({
      proceedsEth: 0.007,
      liquidEth: 0.009,
      gasFloorEth: 0.001,
      netProfitEth: 0.001,
      candidates: [
        {
          symbol: "AERO",
          minEntryEth: 0.002,
          readyNow: true,
          allow: true,
          outcomeScore: 70,
          netMargin: 0.04,
        },
        {
          symbol: "DEGEN",
          minEntryEth: 0.002,
          readyNow: false,
          nearBottom: false,
          allow: true,
          outcomeScore: 60,
          netMargin: 0.04,
        },
      ],
    });
    assert.equal(plan.injections.length, 1);
    assert.equal(plan.secondFired, false);
  });

  it("plans second inject into lower near-bottom when READY absent", () => {
    const plan = planSuccessionInjections({
      proceedsEth: 0.007,
      liquidEth: 0.009,
      gasFloorEth: 0.001,
      netProfitEth: 0.0015,
      candidates: [
        {
          symbol: "UNI",
          minEntryEth: 0.002,
          readyNow: true,
          allow: true,
          outcomeScore: 90,
          netMargin: 0.05,
          pctAboveTrough: 0.01,
        },
        {
          symbol: "LINK",
          minEntryEth: 0.002,
          readyNow: false,
          nearBottom: true,
          allow: true,
          outcomeScore: 80,
          netMargin: 0.045,
          pctAboveTrough: 0.02,
        },
      ],
    });
    assert.equal(plan.injections.length, MAX_SUCCESSION_INJECTS);
    assert.equal(plan.secondFired, true);
    assert.equal(plan.injections[1].symbol, "LINK");
  });

  it("prefers lowest pct-above-trough when ranking succession seats", () => {
    const plan = planSuccessionInjections({
      proceedsEth: 0.004,
      liquidEth: 0.006,
      gasFloorEth: 0.001,
      netProfitEth: 0.001,
      candidates: [
        {
          symbol: "HIGH",
          minEntryEth: 0.002,
          readyNow: true,
          nearBottom: true,
          allow: true,
          outcomeScore: 99,
          netMargin: 0.06,
          pctAboveTrough: 0.04,
        },
        {
          symbol: "LOW",
          minEntryEth: 0.002,
          readyNow: true,
          nearBottom: true,
          allow: true,
          outcomeScore: 50,
          netMargin: 0.04,
          pctAboveTrough: 0.005,
        },
      ],
    });
    assert.equal(plan.injections[0].symbol, "LOW");
  });
});

describe("second-inject: instant peak + primed bottom", () => {
  it("sells instantly at max peak only when turning (tick-down)", () => {
    assert.equal(
      isInstantPeakSell({
        atMaxPeak: true,
        netUsd: 0.5,
        breakEvenBuffer: 0.05,
        sellableUsdOk: true,
        recentTickDown: false,
      }),
      false,
      "hist max touch alone must not sell — ride breakouts",
    );
    assert.equal(
      isInstantPeakSell({
        atMaxPeak: true,
        price: 10,
        maxPeak: 10,
        rideHigh: 10,
        recentTickDown: true,
        netUsd: 0.5,
        breakEvenBuffer: 0.05,
        sellableUsdOk: true,
      }),
      true,
    );
    assert.equal(
      isInstantPeakSell({
        atMaxPeak: true,
        netUsd: 0.01,
        breakEvenBuffer: 0.05,
        sellableUsdOk: true,
        recentTickDown: true,
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
    assert.equal(
      isInstantPeakSell({
        price: 10,
        maxPeak: 10.05,
        recentTickDown: false,
        netUsd: 1,
        breakEvenBuffer: 0.1,
        sellableUsdOk: true,
      }),
      false,
    );
  });

  it("fires primed bottom near recent low", () => {
    assert.equal(
      isPrimedBottomEntry({
        primedReady: true,
        primedAllow: true,
        price: 1.01,
        recentLow: 1,
        recentReadings: 12,
      }),
      true,
    );
    assert.equal(
      isPrimedBottomEntry({
        primedReady: false,
        primedAllow: true,
        price: 1.015,
        recentLow: 1,
        recentReadings: 12,
      }),
      false,
    );
    assert.equal(
      isPrimedBottomEntry({
        primedAllow: false,
        primedReady: true,
        price: 1.0,
        recentLow: 1,
        recentReadings: 12,
      }),
      false,
    );
  });
});

describe("second-inject: wired into agent.js", () => {
  it("imports succession planner and peak/bottom helpers", () => {
    assert.ok(agentSrc.includes('from "./second-inject.js"'));
    assert.ok(agentSrc.includes("planSuccessionInjections"));
    assert.ok(agentSrc.includes("isInstantPeakSell"));
    assert.ok(agentSrc.includes("isPrimedBottomEntry"));
    assert.ok(agentSrc.includes("formatSuccessionPlan"));
    assert.ok(agentSrc.includes('from "./peak-ride.js"'));
    assert.ok(agentSrc.includes("evaluatePeakRideExit"));
  });
});
