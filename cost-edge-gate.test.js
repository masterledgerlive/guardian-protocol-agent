/**
 * cost-edge-gate.js — hitch/RT % refuse, near-term break-even, USD bag checks.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  costFractions,
  minTradeEthForHitch,
  nearTermUpsidePct,
  requiredMovePctForCosts,
  evaluateCostEdgeGate,
  isHighUnitPriceSymbol,
  hasSellableUsd,
  isDustBagUsd,
  recordCostMistake,
  summarizeCostMistakes,
  costMistakeLog,
  MAX_HITCH_COST_PCT,
  MAX_ROUND_TRIP_COST_PCT,
  HIGH_UNIT_MIN_BUY_USD,
} from "./cost-edge-gate.js";

const root = dirname(fileURLToPath(import.meta.url));
const agentSrc = readFileSync(join(root, "agent.js"), "utf8");

describe("cost-edge-gate: fractions + min trade", () => {
  it("flags hitch that eats too much of a tiny stake", () => {
    const fr = costFractions({
      tradeEth: 0.0004, // ~$1
      hitchCostEth: 0.00008, // 20% hitch
      gasCostEth: 0.00002,
      feePct: 0.006,
    });
    assert.ok(fr.hitchPct > MAX_HITCH_COST_PCT);
    assert.ok(minTradeEthForHitch(0.00008) >= 0.00008 / MAX_HITCH_COST_PCT - 1e-12);
  });

  it("required move grows as RT approaches stake", () => {
    const low = requiredMovePctForCosts({ tradeEth: 0.01, roundTripEth: 0.001 });
    const high = requiredMovePctForCosts({ tradeEth: 0.01, roundTripEth: 0.004 });
    assert.ok(high > low);
  });
});

describe("cost-edge-gate: CBBTC-class refuse", () => {
  it("refuses CBBTC when hitch% dominates (the live loss pattern)", () => {
    const d = evaluateCostEdgeGate({
      symbol: "CBBTC",
      tradeEth: 0.0005,
      hitchCostEth: 0.00008,
      gasCostEth: 0.00003,
      feePct: 0.006,
      price: 95000,
      recentHigh: 95200, // almost no near-term room
      ethUsd: 2500,
      tradeableUsd: 6,
    });
    assert.equal(d.allow, false);
    assert.ok(["hitch_pct", "rt_pct", "near_term", "high_unit_floor", "high_unit_thin_book"].includes(d.code));
    assert.ok(d.log.includes("COST_EDGE"));
  });

  it("refuses high-unit on thin book even if hitch% looks ok", () => {
    const d = evaluateCostEdgeGate({
      symbol: "CBBTC",
      tradeEth: 0.01,
      hitchCostEth: 0.00002,
      gasCostEth: 0.00002,
      feePct: 0.003,
      price: 95000,
      recentHigh: 98000,
      ethUsd: 2500,
      tradeableUsd: 20, // < 2× HIGH_UNIT_MIN
    });
    assert.equal(d.allow, false);
    assert.equal(d.code, "high_unit_thin_book");
  });

  it("allows a liquid meme with real near-term upside and small hitch%", () => {
    const d = evaluateCostEdgeGate({
      symbol: "KEYCAT",
      tradeEth: 0.002,
      hitchCostEth: 0.00002,
      gasCostEth: 0.00003,
      feePct: 0.01,
      price: 0.001,
      recentHigh: 0.0012, // +20% room
      ethUsd: 2500,
      tradeableUsd: 8,
    });
    assert.equal(d.allow, true);
    assert.equal(d.code, "ok");
  });

  it("marks CBBTC/AAVE as high unit-price", () => {
    assert.equal(isHighUnitPriceSymbol("CBBTC"), true);
    assert.equal(isHighUnitPriceSymbol("AAVE"), true);
    assert.equal(isHighUnitPriceSymbol("KEYCAT"), false);
  });
});

describe("cost-edge-gate: USD bag exits", () => {
  it("treats fractional CBBTC as sellable by USD not unit count", () => {
    // $6 of CBBTC ≈ 0.000063 tokens — old gate sellable > 1 would skip forever
    assert.equal(hasSellableUsd(0.000063, 95000, 0.12), true);
    assert.equal(isDustBagUsd(0.0000001, 95000, 0.08), true);
    assert.equal(isDustBagUsd(0.000063, 95000, 0.08), false);
  });
});

describe("cost-edge-gate: mistake learning", () => {
  it("records and summarizes refusals", async () => {
    const { resetHypothesisGraph, queryHypotheses } = await import("./finetune-memory.js");
    costMistakeLog.length = 0;
    resetHypothesisGraph();
    recordCostMistake({
      symbol: "CBBTC",
      code: "hitch_pct",
      reason: "test",
      hitchPct: 0.2,
      tradeUsd: 1.2,
    });
    const s = summarizeCostMistakes();
    assert.equal(s.count, 1);
    assert.equal(s.topSymbol, "CBBTC");
    assert.ok(s.message.includes("CBBTC"));
    assert.ok(queryHypotheses({ symbol: "CBBTC", status: "failed" }).length >= 1);
  });
});

describe("cost-edge-gate: near-term upside", () => {
  it("uses recent high when above mark", () => {
    assert.ok(Math.abs(nearTermUpsidePct({ price: 100, recentHigh: 110 }) - 0.1) < 1e-12);
  });
  it("falls back to short target when flat", () => {
    assert.ok(Math.abs(nearTermUpsidePct({ price: 100, recentHigh: 99, shortTargetPct: 0.03 }) - 0.03) < 1e-12);
  });
});

describe("cost-edge-gate: wired into agent + avenue", () => {
  it("agent imports and enforces COST_EDGE", () => {
    assert.ok(agentSrc.includes('from "./cost-edge-gate.js"'));
    assert.ok(agentSrc.includes("evaluateCostEdgeGate"));
    assert.ok(agentSrc.includes("hasSellableUsd"));
  });
  it("avenue-prime uses tightened RT cap constant from cost-edge", () => {
    const ave = readFileSync(join(root, "avenue-prime.js"), "utf8");
    assert.ok(ave.includes("MAX_ROUND_TRIP_COST_PCT") || ave.includes("cost-edge-gate"));
  });
  it("CBBTC min buy raised above smoke pennies", () => {
    const mins = readFileSync(join(root, "token-mins.js"), "utf8");
    assert.ok(/CBBTC:\s*2[5-9]|CBBTC:\s*[3-9]\d/.test(mins));
  });
});

describe("cost-edge-gate: caps exported", () => {
  it("keeps hitch and RT caps strict vs old 95% avenue refuse", () => {
    assert.ok(MAX_HITCH_COST_PCT <= 0.1);
    assert.ok(MAX_ROUND_TRIP_COST_PCT <= 0.25);
    assert.ok(HIGH_UNIT_MIN_BUY_USD >= 15);
  });
});

describe("cost-edge-gate: adaptive thin-book near-term mult", () => {
  it("softens 1.35→1.15 on $2.24 + cheap hitch and allows 5% upside", () => {
    const d = evaluateCostEdgeGate({
      symbol: "LINK",
      tradeEth: 2.24 / 2481,
      hitchCostEth: 8e-9,
      gasCostEth: 0.00001,
      price: 14,
      recentHigh: 14 * 1.05,
      ethUsd: 2481,
      tradeableUsd: 2.24,
    });
    assert.equal(d.allow, true);
    assert.ok(d.nearTermEdgeMult <= 1.15 + 1e-9);
  });

  it("baseline flag keeps 1.35 and refuses the same 5% upside", () => {
    const d = evaluateCostEdgeGate({
      symbol: "LINK",
      tradeEth: 2.24 / 2481,
      hitchCostEth: 8e-9,
      gasCostEth: 0.00001,
      price: 14,
      recentHigh: 14 * 1.05,
      ethUsd: 2481,
      tradeableUsd: 2.24,
      adaptiveNearTerm: false,
    });
    assert.equal(d.allow, false);
    assert.equal(d.code, "near_term");
  });
});

describe("cost-edge-gate: round-trip impact ×2", () => {
  it("impact is charged on both legs (never understate RT)", () => {
    const fr = costFractions({
      tradeEth: 1,
      hitchCostEth: 0,
      gasCostEth: 0,
      feePct: 0.01,
      impactPct: 0.003,
    });
    // fee×2 + impact×2 = 0.02 + 0.006
    assert.ok(Math.abs(fr.roundTripEth - 0.026) < 1e-12);
  });
});

describe("cost-edge-gate: agent never-lose wiring", () => {
  it("buys add gas/hitch to cost basis; sells pass unknownEntry; L1 fallback skips hitch", () => {
    assert.ok(agentSrc.includes("investedEthWithCosts"));
    assert.ok(agentSrc.includes("unknownEntry:"));
    assert.ok(agentSrc.includes('hitchFeeSource: "fallback"'));
    assert.ok(agentSrc.includes("netUsdAfterSkim"));
    assert.ok(agentSrc.includes("DEFAULT_IMPACT_PCT"));
  });
});

/** Live after #74: LOSE_ZERO allow then COST_EDGE AERO 3.00% < 1.15× required 2.63%. */
const AERO_OPERATOR_NEAR_TERM = Object.freeze({
  symbol: "AERO",
  tradeEth: 2 / 2481,
  hitchCostEth: 8e-9,
  gasCostEth: 0.00001,
  feePct: 0.003,
  impactPct: 0.003,
  price: 0.5886,
  recentHigh: 0.5886, // flat → 3% short-target fallback
  ethUsd: 2481,
  tradeableUsd: 8,
});

describe("cost-edge-gate: operator /buy bypasses near-term; auto still gated", () => {
  it("auto / wave refuses live AERO $2 near-term (3% < 1.15× required)", () => {
    const d = evaluateCostEdgeGate(AERO_OPERATOR_NEAR_TERM);
    assert.equal(d.allow, false);
    assert.equal(d.code, "near_term");
    assert.ok(d.nearTermEdgeMult <= 1.15 + 1e-9);
    assert.ok(d.log.includes("would wait forever on a far peak"));
    assert.match(d.log, /3\.00%/);
  });

  it("OPERATOR_BUY / MANUAL BUY (operator) allows the same AERO $2 book", () => {
    const d = evaluateCostEdgeGate({ ...AERO_OPERATOR_NEAR_TERM, isManualOperator: true });
    assert.equal(d.allow, true);
    assert.equal(d.code, "ok");
    assert.equal(d.log, null);
  });

  it("auto still refuses hitch% even when operator would skip near-term", () => {
    const auto = evaluateCostEdgeGate({
      ...AERO_OPERATOR_NEAR_TERM,
      hitchCostEth: 0.0002, // ~25% of $2 stake
    });
    assert.equal(auto.allow, false);
    assert.equal(auto.code, "hitch_pct");
  });

  it("executeBuy skips COST_EDGE refuse on operator reason; auto still evaluates", () => {
    const buyFn = agentSrc.indexOf("async function executeBuy(");
    assert.ok(buyFn >= 0);
    const nextFn = agentSrc.indexOf("\nasync function ", buyFn + 1);
    const body = agentSrc.slice(buyFn, nextFn > 0 ? nextFn : buyFn + 8000);
    assert.ok(body.includes("evaluateCostEdgeGate"), "auto path must still call COST_EDGE");
    assert.ok(body.includes("COST_EDGE blocked"), "auto path must still skipBuy on COST_EDGE");
    const edgeIdx = body.indexOf("evaluateCostEdgeGate");
    const prelude = body.slice(Math.max(0, edgeIdx - 600), edgeIdx);
    assert.match(
      prelude,
      /if\s*\(\s*!isManualOperatorBuy\(reason\)\s*\)/,
      "operator / Telegram /buy must bypass COST_EDGE",
    );
    assert.ok(
      body.includes("AERO_UNI_V3_WETH_POOL") || agentSrc.includes("0x3d5D143381916280ff91407FeBEB52f2b60f33Cf"),
      "AERO Uni V3 WETH bind stays",
    );
  });
});
