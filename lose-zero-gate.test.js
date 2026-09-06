import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  STORE_HITCH_TAG,
  STORE_HITCH_BYTES,
  CALLDATA_GAS_PER_NONZERO_BYTE,
  envFlagYes,
  isLoseZeroMode,
  isInjectCoverRequired,
  estimateStoreHitchGasUnits,
  estimateInjectCostEth,
  injectCostSpread,
  computeFairExit,
  computePennyPinchSellTarget,
  computeLeftover,
  leftoverCoversInject,
  hasClearEdge,
  isManualOperatorBuy,
  parseBuyUsdArg,
  parseManualBuyCommand,
  usdToForcedEth,
  manualBuyReason,
  evaluateBuyGate,
  buildBuyGateDecision,
} from "./lose-zero-gate.js";

describe("env flags", () => {
  it("honors yes case-insensitively and ignores other values", () => {
    assert.equal(envFlagYes("LOSE_ZERO", { LOSE_ZERO: "yes" }), true);
    assert.equal(envFlagYes("LOSE_ZERO", { LOSE_ZERO: "YES" }), true);
    assert.equal(envFlagYes("LOSE_ZERO", { LOSE_ZERO: "true" }), false);
    assert.equal(envFlagYes("LOSE_ZERO", {}), false);
  });

  it("HALT_NEW_ENTRIES enables lose-zero mode", () => {
    assert.equal(isLoseZeroMode({ HALT_NEW_ENTRIES: "yes" }), true);
    assert.equal(isLoseZeroMode({ LOSE_ZERO: "yes" }), true);
    assert.equal(isLoseZeroMode({}), false);
  });

  it("REQUIRE_INJECT_COVER is mandatory even when LOSE_ZERO is unset", () => {
    assert.equal(isInjectCoverRequired({ REQUIRE_INJECT_COVER: "yes" }), true);
    assert.equal(isInjectCoverRequired({ LOSE_ZERO: "yes" }), true);
    assert.equal(isInjectCoverRequired({}), false);
  });
});

describe("§$STORE§ hitch cost", () => {
  it("tags ~10 UTF-8 bytes and prices calldata at 16 gas/byte", () => {
    assert.equal(Buffer.byteLength(STORE_HITCH_TAG, "utf8"), 10);
    assert.equal(STORE_HITCH_BYTES, 10);
    assert.equal(estimateStoreHitchGasUnits(), 10 * CALLDATA_GAS_PER_NONZERO_BYTE);
    assert.equal(estimateInjectCostEth(1), 160 * 1e-9);
  });
});

describe("penny-pinch leftover", () => {
  it("sell_target = fair_exit + inject_cost_spread", () => {
    assert.equal(computePennyPinchSellTarget(1.0, 0.01), 1.01);
  });

  it("leftover 0 does not cover inject", () => {
    assert.equal(leftoverCoversInject(0), false);
    assert.equal(leftoverCoversInject(-0.001), false);
    assert.equal(computeLeftover(null, 1, 0.01), 0);
    assert.equal(computeLeftover(1.01, 1.0, 0.01), 0);
    assert.ok(computeLeftover(1.02, 1.0, 0.01) > 0);
  });

  it("fair_exit applies sell-side costs only", () => {
    assert.equal(computeFairExit(1, { feePct: 0.006, gasCostEth: 0, tradeEth: 1, impactPct: 0.002 }), 1.008);
  });

  it("inject_cost_spread scales hitch ETH into token price", () => {
    const spread = injectCostSpread(2, 1, 1);
    assert.equal(spread, estimateInjectCostEth(1) * 2);
  });
});

describe("evaluateBuyGate", () => {
  it("LOSE_ZERO blocks when leftover is 0", () => {
    const env = { LOSE_ZERO: "yes" };
    const d = evaluateBuyGate({ leftover: 0, hasEdge: true, symbol: "AERO", env });
    assert.equal(d.allow, false);
    assert.match(d.log, /^LOSE_ZERO: block buy AERO leftover is 0$/);
  });

  it("LOSE_ZERO blocks speculative buys with no clear edge", () => {
    const d = evaluateBuyGate({ leftover: 0.05, hasEdge: false, symbol: "AERO", env: { LOSE_ZERO: "yes" } });
    assert.equal(d.allow, false);
    assert.match(d.log, /^LOSE_ZERO: block buy AERO no clear edge$/);
  });

  it("LOSE_ZERO allows buy when leftover covers inject and edge is clear", () => {
    const d = evaluateBuyGate({ leftover: 0.05, hasEdge: true, symbol: "AERO", env: { LOSE_ZERO: "yes" } });
    assert.equal(d.allow, true);
    assert.equal(d.log, "LOSE_ZERO: allow buy AERO leftover covers inject");
  });

  it("HALT_NEW_ENTRIES matches LOSE_ZERO", () => {
    const d = evaluateBuyGate({ leftover: 0, hasEdge: true, symbol: "AERO", env: { HALT_NEW_ENTRIES: "yes" } });
    assert.equal(d.allow, false);
    assert.match(d.log, /^LOSE_ZERO: block buy/);
  });

  it("cascade buys are never blocked by the gate", () => {
    const d = evaluateBuyGate({
      isCascade: true,
      leftover: 0,
      hasEdge: false,
      symbol: "AERO",
      env: { LOSE_ZERO: "yes" },
    });
    assert.equal(d.allow, true);
    assert.equal(d.log, null);
  });

  it("REQUIRE_INJECT_COVER blocks leftover 0 even when LOSE_ZERO is unset", () => {
    const d = evaluateBuyGate({ leftover: 0, hasEdge: true, symbol: "AERO", env: { REQUIRE_INJECT_COVER: "yes" } });
    assert.equal(d.allow, false);
    assert.match(d.log, /^REQUIRE_INJECT_COVER: block buy AERO leftover is 0$/);
  });

  it("gate is off when no flags are set", () => {
    const d = evaluateBuyGate({ leftover: 0, hasEdge: false, symbol: "AERO", env: {} });
    assert.equal(d.allow, true);
    assert.equal(d.log, null);
  });

  it("LOSE_ZERO allows when reason starts with MANUAL BUY (operator)", () => {
    const d = evaluateBuyGate({
      leftover: 0,
      hasEdge: false,
      symbol: "TOSHI",
      reason: "MANUAL BUY (operator) $3",
      env: { LOSE_ZERO: "yes" },
    });
    assert.equal(d.allow, true);
    assert.equal(d.log, "LOSE_ZERO: allow buy TOSHI MANUAL BUY (operator)");
  });

  it("LOSE_ZERO still gates auto buys (MANUAL BUY without operator prefix)", () => {
    const d = evaluateBuyGate({
      leftover: 0,
      hasEdge: false,
      symbol: "TOSHI",
      reason: "MANUAL BUY",
      env: { LOSE_ZERO: "yes" },
    });
    assert.equal(d.allow, false);
    assert.match(d.log, /^LOSE_ZERO: block buy TOSHI no clear edge$/);
  });

  it("LOSE_ZERO still gates predicted-trough auto buys with leftover 0", () => {
    const d = evaluateBuyGate({
      leftover: 0,
      hasEdge: true,
      symbol: "AERO",
      reason: "🧠 PREDICTED TROUGH [80% conf]",
      env: { LOSE_ZERO: "yes" },
    });
    assert.equal(d.allow, false);
    assert.match(d.log, /^LOSE_ZERO: block buy AERO leftover is 0$/);
  });
});

describe("buildBuyGateDecision", () => {
  it("LOSE_ZERO blocks when there is no sell target (leftover 0)", () => {
    const d = buildBuyGateDecision({
      symbol: "AERO",
      reason: "🎯 MIN TROUGH [PRIORITY]",
      price: 1,
      existingSellTarget: null,
      feePct: 0.006,
      armed: true,
      net: 0.05,
      env: { LOSE_ZERO: "yes" },
    });
    assert.equal(d.allow, false);
    assert.equal(d.leftover, 0);
    assert.match(d.log, /LOSE_ZERO: block buy AERO leftover is 0/);
  });

  it("allows when max peak sits above fair_exit + hitch spread", () => {
    const d = buildBuyGateDecision({
      symbol: "AERO",
      reason: "🎯 MIN TROUGH [PRIORITY]",
      price: 1,
      existingSellTarget: 1.05,
      feePct: 0.006,
      impactPct: 0.002,
      gasCostEth: 0,
      tradeEth: 0.01,
      gwei: 0.05,
      armed: true,
      net: 0.04,
      env: { LOSE_ZERO: "yes" },
    });
    assert.equal(d.allow, true);
    assert.ok(d.leftover > 0);
    assert.equal(d.log, "LOSE_ZERO: allow buy AERO leftover covers inject");
  });

  it("hasClearEdge requires armed/net or a known signal plus positive net", () => {
    assert.equal(hasClearEdge({ armed: true, net: 0.03 }), true);
    assert.equal(hasClearEdge({ armed: false, net: 0, reason: "MIN TROUGH" }), false);
    assert.equal(hasClearEdge({ armed: false, net: 0.03, reason: "🎯 MIN TROUGH" }), true);
  });

  it("operator /buy bypasses leftover-0 even without edge", () => {
    const d = buildBuyGateDecision({
      symbol: "TOSHI",
      reason: manualBuyReason(3),
      price: 0.0002,
      existingSellTarget: null,
      armed: false,
      net: 0,
      env: { LOSE_ZERO: "yes" },
    });
    assert.equal(d.allow, true);
    assert.equal(d.reason, "manual-operator");
    assert.match(d.log, /MANUAL BUY \(operator\)/);
  });
});

describe("manual /buy parse", () => {
  it("parses /buy SYMBOL and /buy SYMBOL 3 / $3", () => {
    assert.deepEqual(parseManualBuyCommand("/buy TOSHI"), { symbol: "TOSHI", usd: 0 });
    assert.deepEqual(parseManualBuyCommand("/buy TOSHI 3"), { symbol: "TOSHI", usd: 3 });
    assert.deepEqual(parseManualBuyCommand("/buy TOSHI $3"), { symbol: "TOSHI", usd: 3 });
    assert.deepEqual(parseManualBuyCommand("/buy toshi $3.50"), { symbol: "TOSHI", usd: 3.5 });
    assert.equal(parseManualBuyCommand("/buy"), null);
    assert.equal(parseManualBuyCommand("/sell TOSHI"), null);
  });

  it("parseBuyUsdArg accepts 3 and $3", () => {
    assert.equal(parseBuyUsdArg("3"), 3);
    assert.equal(parseBuyUsdArg("$3"), 3);
    assert.equal(parseBuyUsdArg("$3.00"), 3);
    assert.equal(parseBuyUsdArg("nope"), 0);
    assert.equal(parseBuyUsdArg("0"), 0);
  });

  it("forcedEth = usd / ethUsd", () => {
    assert.equal(usdToForcedEth(3, 3000), 0.001);
    assert.equal(usdToForcedEth(0, 3000), 0);
    assert.equal(usdToForcedEth(3, 0), 0);
  });

  it("manualBuyReason starts with MANUAL BUY (operator)", () => {
    assert.equal(isManualOperatorBuy(manualBuyReason()), true);
    assert.equal(isManualOperatorBuy(manualBuyReason(3)), true);
    assert.equal(manualBuyReason(3), "MANUAL BUY (operator) $3");
    assert.equal(isManualOperatorBuy("MANUAL BUY"), false);
    assert.equal(isManualOperatorBuy("🎯 MIN TROUGH [PRIORITY]"), false);
  });
});
