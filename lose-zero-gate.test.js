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
  isCatalogFrozen,
  frozenBuySkipLog,
  hasClearEdge,
  isManualOperatorBuy,
  parseBuyUsdArg,
  parseManualBuyCommand,
  usdToForcedEth,
  manualBuyReason,
  parseOperatorBuyEnv,
  queueOperatorBuyOnce,
  markOperatorBuyExecuted,
  clearOperatorBuyIfNotExecuted,
  isManualOperatorSell,
  parseSellPctArg,
  parseManualSellCommand,
  parseOperatorSellEnv,
  queueOperatorSellOnce,
  markOperatorSellExecuted,
  clearOperatorSellIfNotExecuted,
  operatorSellCommand,
  resolveManualSellPct,
  isMatchingManualSell,
  manualSellReason,
  SEED_TOKEN_TIMEOUT_MS,
  raceTimeout,
  evaluateBuyGate,
  buildBuyGateDecision,
  isAllowLossyOperatorBuy,
  canBypassBuyLossGate,
  isAllowLossyOperatorSell,
  canBypassSellLossGate,
  estimateCalldataHitchEth,
  estimateBtpInscribeEth,
  estimateInjectHitchCostEth,
  minSellProceedsEth,
  leftoverAfterFeesEth,
  coversHitchAndEntry,
  maxHitchBytesForLeftover,
  sizeHitchForSell,
  evaluateSellGate,
  buildSellGateDecision,
  BTP_INSCRIBE_GAS_UNITS,
  DEFAULT_HITCH_COST_MULT,
  hitchCostMult,
  isMoonshotTrimReason,
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

  it("ALLOW_LOSSY_OPERATOR_BUY defaults off and mirrors sell (yes only)", () => {
    assert.equal(isAllowLossyOperatorBuy({}), false);
    assert.equal(isAllowLossyOperatorBuy({ ALLOW_LOSSY_OPERATOR_BUY: "yes" }), true);
    assert.equal(isAllowLossyOperatorBuy({ ALLOW_LOSSY_OPERATOR_BUY: "true" }), false);
    assert.equal(canBypassBuyLossGate("MANUAL BUY (operator) $3", {}), true);
    assert.equal(canBypassBuyLossGate("MANUAL BUY (operator) $3", { ALLOW_LOSSY_OPERATOR_BUY: "yes" }), true);
    assert.equal(canBypassBuyLossGate("🎯 MIN TROUGH", { ALLOW_LOSSY_OPERATOR_BUY: "yes" }), false);
  });

  it("HITCH_COST_MULT defaults to 2 and is env-overridable", () => {
    assert.equal(DEFAULT_HITCH_COST_MULT, 2);
    assert.equal(hitchCostMult({}), 2);
    assert.equal(hitchCostMult({ HITCH_COST_MULT: "2" }), 2);
    assert.equal(hitchCostMult({ HITCH_COST_MULT: "3" }), 3);
    assert.equal(hitchCostMult({ HITCH_COST_MULT: "1" }), 1);
    assert.equal(hitchCostMult({ HITCH_COST_MULT: "nope" }), 2);
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

  it("isCascade=true does NOT auto-allow under LOSE_ZERO", () => {
    const d = evaluateBuyGate({
      isCascade: true,
      leftover: 0,
      hasEdge: false,
      symbol: "AERO",
      env: { LOSE_ZERO: "yes" },
    });
    assert.equal(d.allow, false);
    assert.match(d.log, /^LOSE_ZERO: block buy AERO no clear edge$/);
  });

  it("cascade still allows when leftover covers hitch and edge is clear", () => {
    const d = evaluateBuyGate({
      isCascade: true,
      leftover: 0.05,
      hasEdge: true,
      symbol: "AERO",
      env: { LOSE_ZERO: "yes" },
    });
    assert.equal(d.allow, true);
    assert.equal(d.log, "LOSE_ZERO: allow buy AERO leftover covers inject");
  });

  it("REQUIRE_INJECT_COVER blocks cascade leftover 0 (no silent allow)", () => {
    const d = evaluateBuyGate({
      isCascade: true,
      leftover: 0,
      hasEdge: true,
      symbol: "AERO",
      env: { REQUIRE_INJECT_COVER: "yes" },
    });
    assert.equal(d.allow, false);
    assert.match(d.log, /^REQUIRE_INJECT_COVER: block buy AERO leftover is 0$/);
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

  it("operator /buy is an explicit test — leftover+edge never block; hitch only if leftover covers", () => {
    const plain = evaluateBuyGate({
      leftover: 0,
      hasEdge: false,
      symbol: "TOSHI",
      reason: "MANUAL BUY (operator) $3",
      env: { LOSE_ZERO: "yes" },
    });
    assert.equal(plain.allow, true);
    assert.equal(plain.skipHitch, true);
    assert.equal(plain.reason, "operator-plain");
    assert.match(plain.log, /MANUAL BUY \(operator\) plain swap/);

    const hitch = evaluateBuyGate({
      leftover: 0.05,
      hasEdge: false,
      symbol: "TOSHI",
      reason: "MANUAL BUY (operator) $3",
      env: { LOSE_ZERO: "yes" },
    });
    assert.equal(hitch.allow, true);
    assert.equal(hitch.skipHitch, false);
    assert.equal(hitch.reason, "operator-hitch");
    assert.match(hitch.log, /MANUAL BUY \(operator\) hitch covered/);
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

  it("operator /buy leftover-0 is allowed as a plain swap (test path)", () => {
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
    assert.equal(d.leftover, 0);
    assert.equal(d.skipHitch, true);
    assert.equal(d.reason, "operator-plain");
    assert.match(d.log, /MANUAL BUY \(operator\) plain swap/);
  });

  it("operator /buy with leftover covering hitch still hitch Eureka", () => {
    const d = buildBuyGateDecision({
      symbol: "TOSHI",
      reason: manualBuyReason(3),
      price: 1,
      existingSellTarget: 1.05,
      feePct: 0,
      impactPct: 0,
      gasCostEth: 0,
      tradeEth: 1,
      gwei: 0,
      armed: false,
      net: 0,
      env: { LOSE_ZERO: "yes" },
    });
    assert.equal(d.allow, true);
    assert.ok(d.leftover > 0);
    assert.equal(d.skipHitch, false);
    assert.equal(d.reason, "operator-hitch");
    assert.match(d.log, /MANUAL BUY \(operator\) hitch covered/);
  });

  it("buildBuyGateDecision computes leftover for isCascade=true (no skip)", () => {
    const blocked = buildBuyGateDecision({
      symbol: "AERO",
      reason: "🌊 CASCADE from TOSHI [PRIORITY]",
      price: 1,
      existingSellTarget: null,
      feePct: 0.006,
      armed: true,
      net: 0.05,
      isCascade: true,
      env: { LOSE_ZERO: "yes" },
    });
    assert.equal(blocked.allow, false);
    assert.equal(blocked.leftover, 0);
    assert.match(blocked.log, /LOSE_ZERO: block buy AERO leftover is 0/);

    const allowed = buildBuyGateDecision({
      symbol: "AERO",
      reason: "🌊 CASCADE from TOSHI [PRIORITY]",
      price: 1,
      existingSellTarget: 1.05,
      feePct: 0.006,
      impactPct: 0.002,
      gasCostEth: 0,
      tradeEth: 0.01,
      gwei: 0.05,
      armed: true,
      net: 0.04,
      isCascade: true,
      env: { LOSE_ZERO: "yes" },
    });
    assert.equal(allowed.allow, true);
    assert.ok(allowed.leftover > 0);
    assert.equal(allowed.log, "LOSE_ZERO: allow buy AERO leftover covers inject");
  });
});

describe("catalog freeze — buy-side gate", () => {
  it("treats frozen:true and string/number equivalents as frozen", () => {
    assert.equal(isCatalogFrozen({ frozen: true }), true);
    assert.equal(isCatalogFrozen({ frozen: 1 }), true);
    assert.equal(isCatalogFrozen({ frozen: "true" }), true);
    assert.equal(isCatalogFrozen({ frozen: "YES" }), true);
    assert.equal(isCatalogFrozen({ frozen: "1" }), true);
  });

  it("does not freeze BASECAT-style tradeable rows or missing flags", () => {
    assert.equal(isCatalogFrozen({ symbol: "BASECAT" }), false);
    assert.equal(isCatalogFrozen({ frozen: false }), false);
    assert.equal(isCatalogFrozen({ frozen: "false" }), false);
    assert.equal(isCatalogFrozen({}), false);
    assert.equal(isCatalogFrozen(null), false);
  });

  it("still frozen when a position already exists (no averaging-in)", () => {
    assert.equal(isCatalogFrozen({ symbol: "STONKEX", frozen: true, entryPrice: 0.01 }), true);
  });

  it("logs a clear skip reason for frozen buys", () => {
    const line = frozenBuySkipLog({
      symbol: "BLUECHIP",
      frozen: true,
      frozenReason: "Desk greenlight overnight — data-only until Uni V3 proven.",
    });
    assert.match(line, /BLUECHIP/);
    assert.match(line, /FROZEN/);
    assert.match(line, /skip NEW buy/i);
    assert.match(line, /Exits\/sells remain allowed/);
    assert.match(line, /data-only/);
  });

  it("OPERATOR_BUY refuses to queue a frozen catalog name", () => {
    const commands = [];
    const known = new Set(["STONKEX", "TOSHI"]);
    const frozen = new Set(["STONKEX"]);
    const result = queueOperatorBuyOnce(commands, "STONKEX:3", known, { done: false }, frozen);
    assert.equal(result.queued, false);
    assert.equal(result.reason, "frozen");
    assert.equal(commands.length, 0);
  });

  it("OPERATOR_BUY still queues a tradeable name (BASECAT)", () => {
    const commands = [];
    const known = new Set(["BASECAT", "STONKEX"]);
    const frozen = new Set(["STONKEX"]);
    const result = queueOperatorBuyOnce(commands, "BASECAT:3", known, { done: false }, frozen);
    assert.equal(result.queued, true);
    assert.deepEqual(commands, [{ symbol: "BASECAT", action: "buy", usd: 3, source: "OPERATOR_BUY" }]);
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

describe("OPERATOR_BUY env", () => {
  it("parses TOSHI:3 and TOSHI:$3", () => {
    assert.deepEqual(parseOperatorBuyEnv("TOSHI:3"), { symbol: "TOSHI", usd: 3 });
    assert.deepEqual(parseOperatorBuyEnv("TOSHI:$3"), { symbol: "TOSHI", usd: 3 });
    assert.deepEqual(parseOperatorBuyEnv("toshi:3.50"), { symbol: "TOSHI", usd: 3.5 });
    assert.equal(parseOperatorBuyEnv(""), null);
    assert.equal(parseOperatorBuyEnv("TOSHI"), null);
    assert.equal(parseOperatorBuyEnv("TOSHI:0"), null);
  });

  it("queues {symbol, action:buy, usd} without latching until execute", () => {
    const commands = [];
    const known = new Set(["TOSHI", "AERO"]);
    const state = { done: false };
    const first = queueOperatorBuyOnce(commands, "TOSHI:3", known, state);
    assert.equal(first.queued, true);
    assert.equal(state.done, false);
    assert.deepEqual(commands, [{ symbol: "TOSHI", action: "buy", usd: 3, source: "OPERATOR_BUY" }]);
    const second = queueOperatorBuyOnce(commands, "TOSHI:3", known, state);
    assert.equal(second.queued, false);
    assert.equal(second.reason, "already-queued");
    assert.equal(commands.length, 1);
  });

  it("does not double-queue if a buy is already in the list", () => {
    const commands = [{ symbol: "TOSHI", action: "buy", usd: 3 }];
    const r = queueOperatorBuyOnce(commands, "TOSHI:3", new Set(["TOSHI"]), { done: false });
    assert.equal(r.queued, false);
    assert.equal(r.reason, "already-queued");
    assert.equal(commands.length, 1);
  });

  it("latches done only after markOperatorBuyExecuted", () => {
    const state = { done: false, executed: false };
    const commands = [];
    queueOperatorBuyOnce(commands, "TOSHI:3", new Set(["TOSHI"]), state);
    assert.equal(state.done, false);
    markOperatorBuyExecuted(state);
    assert.equal(state.done, true);
    assert.equal(state.executed, true);
    clearOperatorBuyIfNotExecuted(state);
    assert.equal(state.done, true);
  });
});

describe("manual /sell parse", () => {
  it("parses /sell SYMBOL and /sell SYMBOL 50 / 50% / all", () => {
    assert.deepEqual(parseManualSellCommand("/sell TOSHI"), { symbol: "TOSHI", pct: 1 });
    assert.deepEqual(parseManualSellCommand("/sell TOSHI 50"), { symbol: "TOSHI", pct: 0.5 });
    assert.deepEqual(parseManualSellCommand("/sell TOSHI 50%"), { symbol: "TOSHI", pct: 0.5 });
    assert.deepEqual(parseManualSellCommand("/sell toshi half"), { symbol: "TOSHI", pct: 0.5 });
    assert.deepEqual(parseManualSellCommand("/sell TOSHI all"), { symbol: "TOSHI", pct: 1 });
    assert.deepEqual(parseManualSellCommand("/sell TOSHI 25"), { symbol: "TOSHI", pct: 0.25 });
    assert.equal(parseManualSellCommand("/sell"), null);
    assert.equal(parseManualSellCommand("/buy TOSHI"), null);
    assert.equal(parseManualSellCommand("/sellhalf TOSHI"), null);
    assert.equal(parseManualSellCommand("/sell TOSHI 0"), null);
    assert.equal(parseManualSellCommand("/sell TOSHI 101"), null);
  });

  it("parseSellPctArg accepts percent, all, and half", () => {
    assert.equal(parseSellPctArg(), 1);
    assert.equal(parseSellPctArg(""), 1);
    assert.equal(parseSellPctArg("all"), 1);
    assert.equal(parseSellPctArg("half"), 0.5);
    assert.equal(parseSellPctArg("50"), 0.5);
    assert.equal(parseSellPctArg("50%"), 0.5);
    assert.equal(parseSellPctArg("100"), 1);
    assert.equal(parseSellPctArg("nope"), 0);
    assert.equal(parseSellPctArg("", { required: true }), 0);
  });

  it("manualSellReason starts with MANUAL SELL (operator)", () => {
    assert.equal(isManualOperatorSell(manualSellReason()), true);
    assert.equal(isManualOperatorSell(manualSellReason(0.5)), true);
    assert.equal(manualSellReason(0.5), "MANUAL SELL (operator) 50%");
    assert.equal(manualSellReason(1), "MANUAL SELL (operator)");
    assert.equal(isManualOperatorSell("MANUAL SELL"), false);
    assert.equal(isManualOperatorSell("MANUAL SELL HALF"), false);
  });

  it("isMatchingManualSell treats /sellhalf as 50%", () => {
    assert.equal(isMatchingManualSell({ symbol: "TOSHI", action: "sellhalf" }, { symbol: "TOSHI", pct: 0.5 }), true);
    assert.equal(isMatchingManualSell({ symbol: "TOSHI", action: "sell" }, { symbol: "TOSHI", pct: 1 }), true);
    assert.equal(isMatchingManualSell({ symbol: "TOSHI", action: "sell", pct: 0.25 }, { symbol: "TOSHI", pct: 0.25 }), true);
    assert.equal(isMatchingManualSell({ symbol: "TOSHI", action: "sellhalf" }, { symbol: "TOSHI", pct: 1 }), false);
    assert.equal(isMatchingManualSell({ symbol: "TOSHI", action: "buy" }, { symbol: "TOSHI", pct: 0.5 }), false);
  });
});

describe("OPERATOR_SELL env", () => {
  it("parses TOSHI:50 and TOSHI:50% as half", () => {
    assert.deepEqual(parseOperatorSellEnv("TOSHI:50"), { symbol: "TOSHI", pct: 0.5 });
    assert.deepEqual(parseOperatorSellEnv("TOSHI:50%"), { symbol: "TOSHI", pct: 0.5 });
    assert.deepEqual(parseOperatorSellEnv("toshi:half"), { symbol: "TOSHI", pct: 0.5 });
    assert.deepEqual(parseOperatorSellEnv("TOSHI:all"), { symbol: "TOSHI", pct: 1 });
    assert.deepEqual(parseOperatorSellEnv("TOSHI:25"), { symbol: "TOSHI", pct: 0.25 });
    assert.equal(parseOperatorSellEnv(""), null);
    assert.equal(parseOperatorSellEnv("TOSHI"), null);
    assert.equal(parseOperatorSellEnv("TOSHI:0"), null);
  });

  it("TOSHI:50 queues existing sellhalf action (MANUAL SELL HALF-style)", () => {
    assert.deepEqual(operatorSellCommand({ symbol: "TOSHI", pct: 0.5 }), {
      symbol: "TOSHI",
      action: "sellhalf",
      source: "OPERATOR_SELL",
    });
    assert.deepEqual(operatorSellCommand({ symbol: "TOSHI", pct: 1 }), {
      symbol: "TOSHI",
      action: "sell",
      source: "OPERATOR_SELL",
    });
    assert.deepEqual(operatorSellCommand({ symbol: "TOSHI", pct: 0.25 }), {
      symbol: "TOSHI",
      action: "sell",
      pct: 0.25,
      source: "OPERATOR_SELL",
    });
    assert.equal(resolveManualSellPct({ action: "sellhalf" }), 0.5);
    assert.equal(resolveManualSellPct({ action: "sell" }), 0.98);
    assert.equal(resolveManualSellPct({ action: "sell", pct: 0.25 }), 0.25);
  });

  it("queues TOSHI:50 as sellhalf once without latching until execute", () => {
    const commands = [];
    const known = new Set(["TOSHI", "AERO"]);
    const state = { done: false };
    const first = queueOperatorSellOnce(commands, "TOSHI:50", known, state);
    assert.equal(first.queued, true);
    assert.equal(state.done, false);
    assert.deepEqual(commands, [{ symbol: "TOSHI", action: "sellhalf", source: "OPERATOR_SELL" }]);
    const second = queueOperatorSellOnce(commands, "TOSHI:50", known, state);
    assert.equal(second.queued, false);
    assert.equal(second.reason, "already-queued");
    assert.equal(commands.length, 1);
  });

  it("does not double-queue if /sellhalf TOSHI is already in the list", () => {
    const commands = [{ symbol: "TOSHI", action: "sellhalf" }];
    const r = queueOperatorSellOnce(commands, "TOSHI:50", new Set(["TOSHI"]), { done: false });
    assert.equal(r.queued, false);
    assert.equal(r.reason, "already-queued");
    assert.equal(commands.length, 1);
  });

  it("does not double-queue if /sell TOSHI (full) is already in the list", () => {
    const commands = [{ symbol: "TOSHI", action: "sell" }];
    const r = queueOperatorSellOnce(commands, "TOSHI:all", new Set(["TOSHI"]), { done: false });
    assert.equal(r.queued, false);
    assert.equal(r.reason, "already-queued");
    assert.equal(commands.length, 1);
  });

  it("latches done only after markOperatorSellExecuted", () => {
    const state = { done: false, executed: false };
    const commands = [];
    queueOperatorSellOnce(commands, "TOSHI:50", new Set(["TOSHI"]), state);
    assert.equal(state.done, false);
    markOperatorSellExecuted(state);
    assert.equal(state.done, true);
    assert.equal(state.executed, true);
    clearOperatorSellIfNotExecuted(state);
    assert.equal(state.done, true);
  });

  it("does not queue a buy — re-buy only if OPERATOR_BUY env is set separately", () => {
    const commands = [];
    queueOperatorSellOnce(commands, "TOSHI:50", new Set(["TOSHI"]), { done: false });
    assert.equal(commands.some((c) => c.action === "buy"), false);
    assert.equal(commands[0].action, "sellhalf");
  });
});

describe("OHLC seed timeout", () => {
  it("SEED_TOKEN_TIMEOUT_MS is 8s", () => {
    assert.equal(SEED_TOKEN_TIMEOUT_MS, 8000);
  });

  it("raceTimeout rejects a hung promise so one DexScreener call cannot stall forever", async () => {
    const hung = new Promise(() => {});
    await assert.rejects(
      () => raceTimeout(hung, 20, "TOSHI OHLC seed"),
      /TOSHI OHLC seed timeout 20ms/,
    );
  });

  it("raceTimeout resolves the winner", async () => {
    const v = await raceTimeout(Promise.resolve(42), 50, "fast");
    assert.equal(v, 42);
  });
});

describe("LOSE-ZERO sell + 2× hitch cover", () => {
  const toshiMoonshot = {
    symbol: "TOSHI",
    reason: "🌙 MOONSHOT TRIM — not in active tiers",
    sellPct: 0.78,
    entryEth: 0.001,
    projectedProceedsEth: 0.00070, // below 78% of 0.001 ETH entry — live trim was a net loss
    feePct: 0.006,
    gasCostEth: 0.00002,
    impactPct: 0.002,
    gwei: 0.05,
    wantedHitchBytes: STORE_HITCH_BYTES,
    wantBtpInscribe: true,
  };

  it("minSellProceedsEth = entry + fees + (2 × hitch)", () => {
    const hitch = estimateInjectHitchCostEth({ hitchBytes: 10, gwei: 1, btpInscribe: false });
    const min = minSellProceedsEth({
      entryEth: 0.01,
      sellPct: 1,
      projectedProceedsEth: 0.02,
      feePct: 0,
      gasCostEth: 0,
      hitchBytes: 10,
      gwei: 1,
      hitchCostMult: 2,
    });
    assert.equal(min, 0.01 + 2 * hitch);
    assert.equal(DEFAULT_HITCH_COST_MULT, 2);
  });

  it("coversHitchAndEntry is false when hitch would wipe edge", () => {
    const r = coversHitchAndEntry({
      projectedProceedsEth: 0.01001,
      entryEth: 0.01,
      sellPct: 1,
      hitchBytes: 10,
      gwei: 1e6, // 160 * 1e6 * 1e-9 = 0.16 ETH hitch; 2× = 0.32
    });
    assert.equal(r.covers, false);
    assert.ok(r.hitchCoverEth > r.leftover);
  });

  it("coversHitchAndEntry is true when leftover covers 2× hitch + edge", () => {
    const hitch = estimateInjectHitchCostEth({ hitchBytes: 10, gwei: 0.05 });
    const r = coversHitchAndEntry({
      projectedProceedsEth: 0.02,
      entryEth: 0.01,
      sellPct: 1,
      hitchBytes: 10,
      gwei: 0.05,
    });
    assert.equal(r.covers, true);
    assert.ok(r.leftover > 2 * hitch);
    assert.ok(r.edge > 0);
  });

  it("sell blocked when leftover after fees is ≤ 0 (TOSHI moonshot trim)", () => {
    assert.equal(isMoonshotTrimReason(toshiMoonshot.reason), true);
    const d = evaluateSellGate(toshiMoonshot);
    assert.equal(d.allow, false);
    assert.equal(d.sellNow, false);
    assert.match(d.log, /hold sell TOSHI leftover after fees/);
    assert.ok(d.leftover <= 0 || d.leftover <= d.hitchCoverEth);
  });

  it("sell allowed plain when leftover covers 1× hitch but not 2×", () => {
    const hitch = estimateInjectHitchCostEth({ hitchBytes: STORE_HITCH_BYTES, gwei: 1 });
    // leftover after fees = 1.5× hitch — enough for 1× buy cover, not 2× sell hitch
    const leftover = hitch * 1.5;
    const d = evaluateSellGate({
      projectedProceedsEth: 0.01 + leftover,
      entryEth: 0.01,
      sellPct: 1,
      feePct: 0,
      gasCostEth: 0,
      gwei: 1,
      wantedHitchBytes: STORE_HITCH_BYTES,
      reason: "🌙 MOONSHOT TRIM — not in active tiers",
      symbol: "TOSHI",
    });
    assert.equal(d.allow, true);
    assert.equal(d.skipHitch, true);
    assert.match(d.log, /plain/);
  });

  it("sell allowed when leftover covers hitch + edge (2×)", () => {
    const hitch = estimateInjectHitchCostEth({ hitchBytes: STORE_HITCH_BYTES, gwei: 0.05 });
    const leftover = hitch * 2 + 0.001;
    const d = evaluateSellGate({
      projectedProceedsEth: 0.01 + leftover,
      entryEth: 0.01,
      sellPct: 1,
      feePct: 0,
      gasCostEth: 0,
      gwei: 0.05,
      wantedHitchBytes: STORE_HITCH_BYTES,
      reason: "🌙 MOONSHOT TRIM — not in active tiers",
      symbol: "TOSHI",
    });
    assert.equal(d.allow, true);
    assert.equal(d.sellNow, true);
    assert.ok(d.hitchBytes > 0);
    assert.match(d.log, /leftover covers hitch \+ edge/);
    assert.match(d.log, /sell now/);
  });

  it("sizes extra hitch down so inject_cost × 2 ≤ leftover (skip extra rather than sell at a loss)", () => {
    const store = estimateInjectHitchCostEth({ hitchBytes: STORE_HITCH_BYTES, gwei: 1 });
    const leftover = store * 2 + 1e-12; // covers 2× STORE, not a 10KB chunk
    const sized = sizeHitchForSell({
      leftoverEth: leftover,
      wantedBytes: 10_000,
      gwei: 1,
      hitchCostMult: 2,
    });
    assert.ok(sized.hitchBytes < 10_000);
    assert.ok(2 * sized.injectCostEth <= leftover + 1e-18);
  });

  it("MANUAL SELL (operator) still gated unless ALLOW_LOSSY_OPERATOR_SELL=yes", () => {
    const blocked = evaluateSellGate({
      ...toshiMoonshot,
      reason: "MANUAL SELL (operator) 50%",
      env: {},
    });
    assert.equal(blocked.allow, false);
    const allowed = evaluateSellGate({
      ...toshiMoonshot,
      reason: "MANUAL SELL (operator) 50%",
      env: { ALLOW_LOSSY_OPERATOR_SELL: "yes" },
    });
    assert.equal(allowed.allow, true);
    assert.equal(allowed.reason, "lossy-operator");
  });

  it("HITCH_COST_MULT=1 lets a 1× leftover sell through (env override)", () => {
    const hitch = estimateInjectHitchCostEth({ hitchBytes: STORE_HITCH_BYTES, gwei: 1 });
    const leftover = hitch * 1.5;
    const d = evaluateSellGate({
      projectedProceedsEth: 0.01 + leftover,
      entryEth: 0.01,
      sellPct: 1,
      gwei: 1,
      reason: "🌙 MOONSHOT TRIM — not in active tiers",
      symbol: "TOSHI",
      env: { HITCH_COST_MULT: "1" },
    });
    assert.equal(d.allow, true);
    assert.equal(d.hitchCostMult, 1);
  });

  it("buildSellGateDecision matches evaluateSellGate for moonshot hold", () => {
    const d = buildSellGateDecision(toshiMoonshot);
    assert.equal(d.allow, false);
    assert.match(d.log, /hold sell TOSHI/);
  });

  it("estimateInjectHitchCostEth adds live L1 on top of L2 calldata", () => {
    const l2 = estimateInjectHitchCostEth({ hitchBytes: 10, gwei: 1 });
    const both = estimateInjectHitchCostEth({ hitchBytes: 10, gwei: 1, l1FeeEth: 0.00001 });
    assert.ok(Math.abs(both - (l2 + 0.00001)) < 1e-18);
    const l2Only = estimateInjectHitchCostEth({ hitchBytes: 10, gwei: 1 });
    assert.equal(l2Only, estimateCalldataHitchEth(10, 1));
  });

  it("adds BTP L1 when inscribing", () => {
    const noBtpL1 = estimateInjectHitchCostEth({
      hitchBytes: 10, gwei: 1, btpInscribe: true, btpL1FeeEth: 0.00002,
    });
    const l2 = estimateInjectHitchCostEth({ hitchBytes: 10, gwei: 1, btpInscribe: true });
    assert.ok(Math.abs(noBtpL1 - (l2 + 0.00002)) < 1e-18);
  });

  it("sell skips hitch when live L1 would wipe leftover but fees are still covered", () => {
    const l2Hitch = estimateInjectHitchCostEth({ hitchBytes: STORE_HITCH_BYTES, gwei: 1 });
    const leftover = l2Hitch * 2 + 1e-12;
    const l2Only = evaluateSellGate({
      projectedProceedsEth: 0.01 + leftover,
      entryEth: 0.01,
      sellPct: 1,
      gwei: 1,
      wantedHitchBytes: STORE_HITCH_BYTES,
      symbol: "TOSHI",
      reason: "🌙 MOONSHOT TRIM — not in active tiers",
    });
    assert.equal(l2Only.allow, true);

    const liveL1 = 0.001; // hitch L1 dominates leftover — skip letter, still take the wave
    const withL1 = evaluateSellGate({
      projectedProceedsEth: 0.01 + leftover,
      entryEth: 0.01,
      sellPct: 1,
      gwei: 1,
      wantedHitchBytes: STORE_HITCH_BYTES,
      l1FeeEth: liveL1,
      reservedL1FeeEth: liveL1,
      hitchFeeSource: "getL1Fee",
      symbol: "TOSHI",
      reason: "🌙 MOONSHOT TRIM — not in active tiers",
    });
    assert.equal(withL1.allow, true);
    assert.equal(withL1.skipHitch, true);
    assert.match(withL1.log, /plain/);
    assert.match(withL1.feeSplitLog, /HITCH FEE — L1 /);
    assert.match(withL1.feeSplitLog, /getL1Fee/);
    assert.equal(withL1.hitchFeeSource, "getL1Fee");
  });

  it("sizeHitchForSell shrinks extra bytes when L1 per-byte is high", () => {
    const store = estimateInjectHitchCostEth({ hitchBytes: STORE_HITCH_BYTES, gwei: 1, l1FeeEth: 0 });
    const leftover = store * 2 + 0.000002;
    const sized = sizeHitchForSell({
      leftoverEth: leftover,
      wantedBytes: 10_000,
      gwei: 1,
      hitchCostMult: 2,
      l1FeePerByteEth: 1e-9, // 1 nETH / byte
    });
    assert.ok(sized.hitchBytes < 10_000);
    assert.ok(sized.hitchBytes > 0);
    assert.ok(2 * sized.injectCostEth <= leftover + 1e-18);
  });

  it("buy leftover spread includes live L1 hitch fee", () => {
    const noL1 = injectCostSpread(2, 1, 1);
    const withL1 = injectCostSpread(2, 1, 1, 0.0005);
    assert.ok(withL1 > noL1);
    const d = buildBuyGateDecision({
      symbol: "AERO",
      reason: "MIN TROUGH",
      price: 1,
      existingSellTarget: 1.001,
      tradeEth: 1,
      gwei: 0.05,
      l1FeeEth: 0.01, // spread 0.01 — leftover cannot cover
      armed: true,
      net: 1,
      env: { LOSE_ZERO: "yes" },
    });
    assert.equal(d.allow, false);
    assert.match(d.feeSplitLog, /HITCH FEE/);
    assert.equal(d.hitchFeeSource, "oracle");
  });
});

