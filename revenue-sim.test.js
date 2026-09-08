/**
 * revenue-sim.js + adaptive thin-book COST_EDGE — research pack.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  adaptiveNearTermEdgeMult,
  evaluateCostEdgeGate,
  MIN_NEAR_TERM_EDGE_MULT,
  THIN_BOOK_NEAR_TERM_MULT,
} from "./cost-edge-gate.js";
import {
  LIVE_ASSUMPTIONS,
  evaluateCostEdgeGateAdaptive,
  evaluateCostEdgeGateBaseline,
  simulateCostEdgeSweep,
  simulateSeatFragmentation,
  simulateUnknownCostRecycle,
  simulateHitchBudget,
  simulateCapitalLadder,
  simulateAdaptiveVsBaseline,
  runRevenueResearch,
} from "./revenue-sim.js";

const root = dirname(fileURLToPath(import.meta.url));
const agentSrc = readFileSync(join(root, "agent.js"), "utf8");
const costSrc = readFileSync(join(root, "cost-edge-gate.js"), "utf8");

describe("adaptiveNearTermEdgeMult", () => {
  it("softens to 1.15 on thin book + cheap hitch", () => {
    const m = adaptiveNearTermEdgeMult({
      tradeableUsd: 2.24,
      hitchPct: 0.00001,
      symbol: "LINK",
    });
    assert.equal(m, THIN_BOOK_NEAR_TERM_MULT);
    assert.ok(m < MIN_NEAR_TERM_EDGE_MULT);
  });

  it("keeps 1.35 for CBBTC even on thin books", () => {
    const m = adaptiveNearTermEdgeMult({
      tradeableUsd: 5,
      hitchPct: 0.001,
      symbol: "CBBTC",
    });
    assert.equal(m, MIN_NEAR_TERM_EDGE_MULT);
  });

  it("keeps 1.35 when hitch is expensive", () => {
    const m = adaptiveNearTermEdgeMult({
      tradeableUsd: 5,
      hitchPct: 0.05,
      symbol: "UNI",
    });
    assert.equal(m, MIN_NEAR_TERM_EDGE_MULT);
  });

  it("wires adaptiveNearTerm into evaluateCostEdgeGate", () => {
    assert.match(costSrc, /adaptiveNearTerm/);
    assert.match(costSrc, /THIN_BOOK_NEAR_TERM_MULT/);
    assert.match(agentSrc, /evaluateCostEdgeGate/);
  });
});

describe("COST_EDGE adaptive vs baseline on live $2.24 book", () => {
  const common = {
    symbol: "LINK",
    tradeEth: LIVE_ASSUMPTIONS.tradeableUsd / LIVE_ASSUMPTIONS.ethUsd,
    hitchCostEth: 8e-9,
    gasCostEth: LIVE_ASSUMPTIONS.gasCostEth,
    price: 14,
    recentHigh: 14 * 1.05, // 5% room — live squeeze days
    ethUsd: LIVE_ASSUMPTIONS.ethUsd,
    tradeableUsd: LIVE_ASSUMPTIONS.tradeableUsd,
  };

  it("baseline 1.35× refuses 5% upside on $2.24", () => {
    const d = evaluateCostEdgeGateBaseline(common);
    assert.equal(d.allow, false);
    assert.equal(d.code, "near_term");
    assert.equal(d.nearTermEdgeMult, 1.35);
  });

  it("adaptive 1.15× allows 5% upside on $2.24 when hitch cheap", () => {
    const d = evaluateCostEdgeGateAdaptive(common);
    assert.equal(d.allow, true);
    assert.ok(d.nearTermEdgeMult <= 1.15 + 1e-9);
  });

  it("still refuses when upside cannot clear break-even (lose-zero)", () => {
    const d = evaluateCostEdgeGate({
      ...common,
      recentHigh: 14 * 1.01, // 1% << required ~3.8%
      adaptiveNearTerm: true,
    });
    assert.equal(d.allow, false);
    assert.equal(d.code, "near_term");
  });
});

describe("revenue research theories", () => {
  it("T1 sweep returns allow rates by book size", () => {
    const r = simulateCostEdgeSweep({ bookSizesUsd: [2.24, 15, 100], useAdaptive: true });
    assert.equal(r.theory, "T1_cost_edge_sweep");
    assert.ok(r.summary["100"].allowRate >= r.summary["2.24"].allowRate);
  });

  it("T2 prefers inject-all on thin books without lose-zero violations", () => {
    const r = simulateSeatFragmentation({ bookUsd: 6, cycles: 10 });
    assert.ok(r.ranking.every((x) => x.loseZeroViolations === 0));
    assert.ok(r.ranking.some((x) => x.mode === "inject_all_1"));
  });

  it("T3 never ranks force_underwater as best safe policy", () => {
    const r = simulateUnknownCostRecycle({ cycles: 5 });
    assert.notEqual(r.bestSafePolicy, "force_underwater");
    const forced = r.policies.find((p) => p.policy === "force_underwater");
    assert.equal(forced.loseZeroOk, false);
  });

  it("T4 tier-before-hitch beats legacy OUT fee waste", () => {
    const on = simulateHitchBudget({ hitchOnlyWhenTiered: true, attemptsPerDay: 100 });
    const off = simulateHitchBudget({ hitchOnlyWhenTiered: false, attemptsPerDay: 100 });
    assert.ok(on.wastedOutFeesUsd <= off.wastedOutFeesUsd);
    assert.ok(on.bytesPerDollar >= off.bytesPerDollar - 1e-9);
  });

  it("T5 ladder marks majors unlock at $50", () => {
    const r = simulateCapitalLadder({ startUsd: 5, cyclesPerStep: 5 });
    assert.equal(r.milestones.unlockMajorsUsd, 50);
    assert.ok(r.endUsd >= r.startUsd);
  });

  it("adaptive A/B recommends adopt or keep with numeric deltas", () => {
    const r = simulateAdaptiveVsBaseline({ trials: 50, bookUsd: 2.24 });
    assert.ok(["ADOPT_ADAPTIVE_THIN_BOOK_MULT", "KEEP_BASELINE_1_35"].includes(r.recommendation));
    assert.equal(typeof r.deltaFills, "number");
  });

  it("full research pack emits verdicts", () => {
    const report = runRevenueResearch();
    assert.ok(report.verdicts.loseZeroInvariant.includes("leftover"));
    assert.equal(typeof report.verdicts.adoptAdaptiveThinMult, "boolean");
    assert.ok(Array.isArray(report.verdicts.nextCodeTune));
    assert.ok(report.assumptions.hitchUsd >= 0);
  });
});
