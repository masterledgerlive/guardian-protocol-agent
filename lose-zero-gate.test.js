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
  takeQueuedManualBuys,
  settleFlushedOperatorBuy,
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
  isDisableDowBias,
  applyDowBiasDisable,
  isFridayCloseWindow,
  latchFreshLot,
  clearFreshLot,
  freshLotCostFloor,
  sellEntryEthWithLotFloor,
  usdMarkBelowBreakeven,
  isAllowAddOnFifoRed,
  bagMarkProceedsEth,
  isExistingKnownFifoBag,
  isFifoRedLot,
  evaluateAddOnFifoRedGate,
  addOnRemainingFifoEth,
  estimateCalldataHitchEth,
  estimateBtpInscribeEth,
  estimateInjectHitchCostEth,
  minSellProceedsEth,
  leftoverAfterFeesEth,
  plusAfterHitchEth,
  conservativeSellProceedsEth,
  wei18ToEth,
  formatAlwaysPlusLog,
  MIN_PLUS_ETH,
  cashFlowNetEth,
  fifoRemainingCostEth,
  plusFloorOutWei,
  applySellPlusFloorMinOut,
  isForceExitLockedReason,
  coversHitchAndEntry,
  maxHitchBytesForLeftover,
  sizeHitchForSell,
  evaluateSellGate,
  buildSellGateDecision,
  BTP_INSCRIBE_GAS_UNITS,
  DEFAULT_HITCH_COST_MULT,
  hitchCostMult,
  isMoonshotTrimReason,
  isStopLossReason,
  shouldArmStopLoss,
  investedEthWithCosts,
  unknownCostMinLeftoverEth,
  netUsdAfterSkim,
  netAfterSkimEth,
  UNKNOWN_COST_GAS_EDGE_MULT,
} from "./lose-zero-gate.js";
import { sizeHatBytesForWave } from "./hat-wave-inject.js";

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

  it("inject_cost_spread leftover uses planned VITA hitch bytes, not only the 10-byte tag", () => {
    const tag = injectCostSpread(2, 1, 1);
    const vita = injectCostSpread(2, 1, 1, undefined, 69);
    assert.equal(tag, estimateInjectCostEth(1) * 2);
    assert.equal(vita, estimateInjectCostEth(1, undefined, 69) * 2);
    assert.ok(vita > tag, "names-only KEY+LOC (69B) must cost more L2 than the 10-byte tag");
    assert.equal(estimateInjectCostEth(1, undefined, 10), estimateInjectCostEth(1));
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

  it("buy L2 hitch fee sizes against planned VITA hitch bytes", () => {
    const args = {
      symbol: "AERO",
      reason: "🎯 MIN TROUGH [PRIORITY]",
      price: 1,
      existingSellTarget: 1.05,
      feePct: 0.006,
      impactPct: 0.002,
      gasCostEth: 0,
      tradeEth: 0.01,
      gwei: 1,
      armed: true,
      net: 0.04,
      env: { LOSE_ZERO: "yes" },
    };
    const tag = buildBuyGateDecision({ ...args, hitchBytes: STORE_HITCH_BYTES });
    const vita = buildBuyGateDecision({ ...args, hitchBytes: 102 });
    assert.ok(vita.l2FeeEth > tag.l2FeeEth);
    assert.equal(vita.l2FeeEth, estimateCalldataHitchEth(102, 1));
    assert.ok(vita.leftover < tag.leftover, "leftover leftover must reserve VITA hitch L2, not only the 10-byte tag");
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

  it("operator /buy with leftover covering hitch still hitch VITA leftover", () => {
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
    const known = new Set(["STONKEX", "TOSHI", "GAME"]);
    const frozen = new Set(["STONKEX", "GAME"]);
    const result = queueOperatorBuyOnce(commands, "STONKEX:3", known, { done: false }, frozen);
    assert.equal(result.queued, false);
    assert.equal(result.reason, "frozen");
    const game = queueOperatorBuyOnce(commands, "GAME:3", known, { done: false }, frozen);
    assert.equal(game.queued, false);
    assert.equal(game.reason, "frozen");
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

  it("takeQueuedManualBuys pulls buys and leaves sells", () => {
    const commands = [
      { symbol: "AERO", action: "buy", usd: 2, source: "OPERATOR_BUY" },
      { symbol: "TOSHI", action: "sellhalf", source: "OPERATOR_SELL" },
      { symbol: "UNI", action: "buy", usd: 3 },
    ];
    const buys = takeQueuedManualBuys(commands);
    assert.deepEqual(buys.map((c) => c.symbol), ["AERO", "UNI"]);
    assert.equal(commands.length, 1);
    assert.equal(commands[0].action, "sellhalf");
  });

  it("settleFlushedOperatorBuy re-queues unspent OPERATOR_BUY and not a fill", () => {
    const commands = [];
    const cmd = { symbol: "AERO", action: "buy", usd: 2, source: "OPERATOR_BUY" };
    const skip = settleFlushedOperatorBuy(commands, cmd, false);
    assert.equal(skip.requeued, true);
    assert.equal(skip.reason, "unspent");
    assert.equal(commands.length, 1);
    const again = settleFlushedOperatorBuy(commands, cmd, false);
    assert.equal(again.requeued, false);
    assert.equal(again.reason, "already-queued");
    const fill = settleFlushedOperatorBuy([], cmd, 0.0008);
    assert.equal(fill.requeued, false);
    assert.equal(fill.reason, "spent");
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

  it("STOP LOSS holds when leftover after fees ≤ 0 — no loss bypass", () => {
    assert.equal(isStopLossReason("STOP LOSS"), true);
    const d = evaluateSellGate({
      ...toshiMoonshot,
      reason: "STOP LOSS",
      symbol: "DEGEN",
    });
    assert.equal(d.allow, false);
    assert.equal(d.sellNow, false);
    assert.match(d.log, /hold sell DEGEN leftover after fees/);
    assert.match(d.log, /STOP LOSS floor held/);
  });

  it("STOP LOSS allows plus sale when leftover after fees is green", () => {
    const hitch = estimateInjectHitchCostEth({ hitchBytes: STORE_HITCH_BYTES, gwei: 1 });
    const leftover = hitch * 1.2;
    const d = evaluateSellGate({
      projectedProceedsEth: 0.01 + leftover,
      entryEth: 0.01,
      sellPct: 1,
      gwei: 1,
      wantedHitchBytes: STORE_HITCH_BYTES,
      reason: "STOP LOSS",
      symbol: "DEGEN",
    });
    assert.equal(d.allow, true);
    assert.ok(d.plusNetEth > 0, "green STOP LOSS must stay plus after 1× hitch or skip");
    assert.ok(d.verdict === "PLUS" || d.verdict === "SKIP_HITCH");
    assert.match(d.log, /allow sell DEGEN|plain|hitch \+ edge/);
  });

  it("shouldArmStopLoss requires trusted cost — skips unknown/frozen", () => {
    assert.equal(shouldArmStopLoss({
      price: 0.009, stopLossPrice: 0.01, hasTrustedCostBasis: true,
    }), true);
    assert.equal(shouldArmStopLoss({
      price: 0.009, stopLossPrice: 0.01, hasTrustedCostBasis: true, unknownEntry: true,
    }), false);
    assert.equal(shouldArmStopLoss({
      price: 0.009, stopLossPrice: 0.01, hasTrustedCostBasis: true, frozen: true,
    }), false);
    assert.equal(shouldArmStopLoss({
      price: 0.009, stopLossPrice: 0.01, hasTrustedCostBasis: false,
    }), false);
    assert.equal(shouldArmStopLoss({
      price: 0.011, stopLossPrice: 0.01, hasTrustedCostBasis: true,
    }), false);
  });

  it("sell hitches at 1× when leftover covers 1× hitch but not 2× (buy hitch already in basis)", () => {
    const hitch = estimateInjectHitchCostEth({ hitchBytes: STORE_HITCH_BYTES, gwei: 1 });
    // leftover after fees = 1.5× hitch — enough for 1× this-tx hitch, not 2× size cushion
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
    assert.equal(d.skipHitch, false);
    assert.ok(d.hitchBytes > 0);
    assert.ok(d.plusNetEth > 0);
    assert.equal(d.verdict, "PLUS");
    assert.match(d.alwaysPlusLog, /PLUS/);
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
    assert.ok(d.plusNetEth > 0);
    assert.equal(d.verdict, "PLUS");
    assert.match(d.log, /leftover covers hitch \+ edge/);
    assert.match(d.log, /sell now/);
    assert.match(d.alwaysPlusLog, /PLUS/);
  });

  it("piggy earnings buffer skips hitch so message cannot wipe listed gains", () => {
    const hitch = estimateInjectHitchCostEth({ hitchBytes: STORE_HITCH_BYTES, gwei: 0.05 });
    const leftover = hitch * 2 + 0.0001; // would cover 2× hitch alone
    const proceeds = 0.01 + leftover;
    const d = evaluateSellGate({
      projectedProceedsEth: proceeds,
      entryEth: 0.01,
      sellPct: 1,
      feePct: 0,
      gasCostEth: 0,
      gwei: 0.05,
      wantedHitchBytes: STORE_HITCH_BYTES,
      piggyEarningsBufferEth: leftover, // entire leftover reserved for piggy earnings
      reason: "🎯 MAX PEAK",
      symbol: "LINK",
    });
    assert.equal(d.allow, true);
    assert.equal(d.skipHitch, true);
    assert.match(d.log, /plain|piggy earnings/i);
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

  it("MANUAL SELL (operator) cannot sell red — ALLOW_LOSSY_OPERATOR_SELL is not a plus bypass", () => {
    const blocked = evaluateSellGate({
      ...toshiMoonshot,
      reason: "MANUAL SELL (operator) 50%",
      env: {},
    });
    assert.equal(blocked.allow, false);
    assert.equal(blocked.verdict, "HOLD");
    const stillHeld = evaluateSellGate({
      ...toshiMoonshot,
      reason: "MANUAL SELL (operator) 50%",
      env: { ALLOW_LOSSY_OPERATOR_SELL: "yes" },
    });
    assert.equal(stillHeld.allow, false);
    assert.equal(stillHeld.verdict, "HOLD");
  });

  it("FORCE EXIT LOCKED recovers stranded majors even when underwater", () => {
    const d = evaluateSellGate({
      ...toshiMoonshot,
      reason: "PIGGY UNLOCK CBBTC — FORCE EXIT LOCKED (cash free, no cascade)",
      env: {},
    });
    assert.equal(d.allow, true);
    assert.equal(d.skipHitch, true);
    assert.equal(d.verdict, "FORCE_EXIT");
    assert.ok(isForceExitLockedReason(d.log) || d.reason.includes("FORCE EXIT"));
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

describe("never-lose fee/gas leak plugs", () => {
  it("investedEthWithCosts adds buy gas and hitch when on-chain", () => {
    assert.equal(investedEthWithCosts({ ethSpent: 0.01, gasCostEth: 0.0001 }), 0.0101);
    assert.equal(
      investedEthWithCosts({ ethSpent: 0.01, gasCostEth: 0.0001, hitchCostEth: 0.00005, hitchOnChain: true }),
      0.01015,
    );
    assert.equal(
      investedEthWithCosts({ ethSpent: 0.01, gasCostEth: 0.0001, hitchCostEth: 0.00005, hitchOnChain: false }),
      0.0101,
    );
  });

  it("unknown-cost sells HOLD — leftover without basis is not plus vs entry", () => {
    const gas = 0.0002;
    const d = evaluateSellGate({
      projectedProceedsEth: 0.00025,
      entryEth: 0, // unknown
      sellPct: 1,
      feePct: 0.006,
      gasCostEth: gas,
      impactPct: 0.003,
      gwei: 0.05,
      symbol: "DUST",
      reason: "🌙 DUST RECYCLE — unknown cost basis",
      unknownEntry: true,
    });
    assert.equal(d.allow, false);
    assert.equal(d.verdict, "HOLD");
    assert.match(d.log, /unknown cost|lose money|leftover/);
    assert.match(d.alwaysPlusLog, /HOLD/);
    assert.ok(unknownCostMinLeftoverEth(gas) === gas * UNKNOWN_COST_GAS_EDGE_MULT);
  });

  it("unknown-cost sells HOLD even when leftover would clear 2× gas edge", () => {
    const gas = 0.00002;
    const d = evaluateSellGate({
      projectedProceedsEth: 0.01,
      entryEth: 0,
      sellPct: 1,
      feePct: 0.006,
      gasCostEth: gas,
      impactPct: 0.003,
      gwei: 0.05,
      symbol: "KEYCAT",
      reason: "🌙 DUST RECYCLE — unknown cost basis",
      unknownEntry: true,
    });
    assert.equal(d.allow, false);
    assert.equal(d.verdict, "HOLD");
    assert.match(d.log, /unknown cost/);
    assert.match(d.alwaysPlusLog, /HOLD/);
  });

  it("oracle fallback forces plain sale (never hitch without live L1)", () => {
    const d = evaluateSellGate({
      projectedProceedsEth: 0.02,
      entryEth: 0.01,
      sellPct: 1,
      feePct: 0.006,
      gasCostEth: 0.00005,
      impactPct: 0.003,
      gwei: 1,
      wantedHitchBytes: STORE_HITCH_BYTES,
      hitchFeeSource: "fallback",
      symbol: "AERO",
      reason: "MAX PEAK",
    });
    assert.equal(d.allow, true);
    assert.equal(d.skipHitch, true);
    assert.match(d.log, /L1 fee unknown|plain/);
  });

  it("oracle fallback never hitches even if leftoverWouldCoverHitch (L1 undercover hole)", () => {
    const l2Hitch = estimateInjectHitchCostEth({ hitchBytes: STORE_HITCH_BYTES, gwei: 1 });
    const leftover = l2Hitch * 2 + 1e-12;
    const d = evaluateSellGate({
      projectedProceedsEth: 0.01 + leftover,
      entryEth: 0.01,
      sellPct: 1,
      gwei: 1,
      wantedHitchBytes: STORE_HITCH_BYTES,
      hitchFeeSource: "fallback",
      leftoverWouldCoverHitch: true,
      symbol: "AERO",
      reason: "MAX PEAK",
    });
    assert.equal(d.allow, true);
    assert.equal(d.skipHitch, true);
    assert.equal(d.verdict, "SKIP_HITCH");
    assert.match(d.log, /L1 fee unknown|plain/);
    assert.match(d.alwaysPlusLog, /SKIP_HITCH/);
  });

  it("net after skim never lists a wiped edge as profit", () => {
    const wiped = netUsdAfterSkim({
      receivedEth: 0.01005,
      investedEth: 0.01,
      skimEth: 0.0002, // skim > edge
      ethUsd: 2500,
      trustedCostBasis: true,
    });
    assert.ok(wiped.netUsd < 0 || wiped.netUsd === 0 || wiped.redeployableEth < 0.01);
    const unknown = netUsdAfterSkim({
      receivedEth: 0.01,
      investedEth: 0,
      skimEth: 0,
      ethUsd: 2500,
      trustedCostBasis: false,
    });
    assert.equal(unknown.netUsd, 0);
    assert.equal(unknown.unknownCost, true);
    assert.equal(netAfterSkimEth(0.01, 0.0001), 0.0099);
  });
});

describe("always-plus exit — large hitch must not flip a green sell red", () => {
  it("10KB wanted hitch on a thin leftover skips or shrinks — leftover stays plus", () => {
    const leftover = 0.0002; // green after fees
    const d = evaluateSellGate({
      projectedProceedsEth: 0.01 + leftover,
      entryEth: 0.01,
      sellPct: 1,
      feePct: 0,
      gasCostEth: 0,
      gwei: 0.05,
      wantedHitchBytes: 10_000,
      l1FeeEth: 0.001, // 10KB L1 would wipe leftover many times over
      l1FeePerByteEth: 0.001 / 10_000,
      reservedL1FeeEth: 0.001 * 10 / 10_000,
      hitchFeeSource: "getL1Fee",
      reason: "🎯 MAX PEAK",
      symbol: "GAME",
    });
    assert.equal(d.allow, true, "green leftover must still sell");
    assert.ok(d.leftover > 0);
    if (d.skipHitch) {
      assert.equal(d.verdict, "SKIP_HITCH");
      assert.equal(d.injectCostEth, 0);
      assert.ok(d.leftover > 0);
      assert.match(d.alwaysPlusLog, /SKIP_HITCH/);
    } else {
      assert.ok(d.hitchBytes < 10_000, "must shrink 10KB wave");
      assert.ok(d.plusNetEth > 0, "1× hitch this tx must leave plus");
      assert.ok(plusAfterHitchEth(d.leftover, d.injectCostEth) > 0);
      assert.equal(d.verdict, "PLUS");
    }
  });

  it("HAT earnings fuel cannot size hitch past leftover (would flip green red)", () => {
    const leftover = 0.0001;
    const sized = sizeHatBytesForWave({
      leftoverEth: leftover,
      earningsEth: 0.002, // used to add 50% as extra hitch fuel
      gwei: 0.05,
      wantedBytes: 10_000,
      hitchCostMult: 1,
    });
    assert.ok(
      sized.skipHitch || plusAfterHitchEth(leftover, sized.injectCostEth) > 0,
      "hitch cost must not exceed leftover",
    );
    assert.ok(sized.spendableEth <= leftover + 1e-18);
  });

  it("conservative proceeds take min(mark, quote) so Dex cannot paint a Uni fill green", () => {
    assert.equal(conservativeSellProceedsEth({ markEth: 0.01, quotedEth: 0.008 }), 0.008);
    assert.equal(conservativeSellProceedsEth({ markEth: 0.008, quotedEth: 0.01 }), 0.008);
    assert.equal(conservativeSellProceedsEth({ markEth: 0.01, quotedEth: 0 }), 0.01);
    assert.equal(wei18ToEth(10n ** 15n), 0.001);
    assert.ok(MIN_PLUS_ETH > 0);
    assert.match(formatAlwaysPlusLog({
      verdict: "PLUS", symbol: "GAME", leftover: 1e-5, entrySold: 0.01, feesEth: 1e-6, hitchCostEth: 1e-8, netEth: 9.99e-6, hitchBytes: 69,
    }), /PLUS sell GAME/);
  });
});

describe("always-plus exit — BASECAT/DRB FIFO red-sell classes", () => {
  // Risk-desk FIFO: 31 red sells (proceeds < buy cost).
  // BASECAT 12, MORPHO 4, SKI 4, LINK 3, UNI 3, AERO 2, VVV 2, DRB 1.
  // Worst BASECAT: 0xe53b1f70… 0xd42cca53… 0x753ce264…
  // DRB hitch-prove 0xb495213f… tiny red (−5.4e-7 ETH).
  // Numbers below are class mirrors (proceeds < soldFrac×entry, or hitch would
  // flip a hair of plus red). Not invented live P&L for those hashes.
  const FIFO_RED_SYMBOLS = ["BASECAT", "MORPHO", "SKI", "LINK", "UNI", "AERO", "VVV", "DRB"];
  const basecatUnderwater = {
    symbol: "BASECAT",
    reason: "🎯 MAX PEAK",
    sellPct: 0.98, // piggy leave-behind
    entryEth: 0.001,
    projectedProceedsEth: 0.00070, // proceeds < soldFrac × entry
    feePct: 0.010, // catalog BASECAT Uni v3 1%
    gasCostEth: 0.00002,
    impactPct: 0.003,
    gwei: 0.05,
    wantedHitchBytes: STORE_HITCH_BYTES,
  };

  it("BASECAT 0xe53b1f70 / 0xd42cca53 / 0x753ce264 class: proceeds < buy cost HOLDs", () => {
    const d = evaluateSellGate(basecatUnderwater);
    assert.equal(d.allow, false);
    assert.equal(d.verdict, "HOLD");
    assert.ok(d.leftover <= 0);
    assert.equal(d.skipHitch, true);
    assert.match(d.alwaysPlusLog, /HOLD/);
  });

  it("BASECAT STOP LOSS, moonshot trim, and operator ALLOW_LOSSY still HOLD underwater", () => {
    for (const reason of ["STOP LOSS", "MANUAL SELL (operator) 50%", "🌙 MOONSHOT TRIM — not in active tiers"]) {
      const d = evaluateSellGate({
        ...basecatUnderwater,
        reason,
        env: { ALLOW_LOSSY_OPERATOR_SELL: "yes" },
      });
      assert.equal(d.allow, false, reason);
      assert.equal(d.verdict, "HOLD", reason);
    }
  });

  it("Dex mark cannot paint BASECAT green when Uni quote is underwater", () => {
    const markEth = 0.00120; // looks plus vs 0.001 entry
    const quotedEth = 0.00072; // fill thinner than soldFrac × entry
    const proc = conservativeSellProceedsEth({ markEth, quotedEth });
    assert.equal(proc, quotedEth);
    const d = evaluateSellGate({
      ...basecatUnderwater,
      projectedProceedsEth: proc,
      reason: "🎯 MAX PEAK",
    });
    assert.equal(d.allow, false);
    assert.equal(d.verdict, "HOLD");
  });

  it("FIFO red symbols (31 sells) HOLD the same underwater class", () => {
    for (const symbol of FIFO_RED_SYMBOLS) {
      const d = evaluateSellGate({ ...basecatUnderwater, symbol });
      assert.equal(d.allow, false, symbol);
      assert.equal(d.verdict, "HOLD", symbol);
    }
  });

  it("DRB 0xb495213f class: leftover after fees already −5.4e-7 HOLDs", () => {
    const d = evaluateSellGate({
      projectedProceedsEth: 0.01 - 5.4e-7,
      entryEth: 0.01,
      sellPct: 1,
      feePct: 0,
      gasCostEth: 0,
      impactPct: 0,
      gwei: 0.05,
      wantedHitchBytes: 400,
      reason: "🎯 MAX PEAK",
      symbol: "DRB",
    });
    assert.equal(d.allow, false);
    assert.equal(d.verdict, "HOLD");
    assert.ok(d.leftover < 0);
    assert.match(d.alwaysPlusLog, /HOLD/);
  });

  it("DRB 0xb495213f hitch-prove: hitch that would print −5.4e-7 sizes DOWN or SKIP", () => {
    // leftover after fees is a hair of plus; planned VITA packet L1 would flip red.
    const leftover = 1e-7;
    const hitchWould = leftover + 5.4e-7;
    const d = evaluateSellGate({
      projectedProceedsEth: 0.01 + leftover,
      entryEth: 0.01,
      sellPct: 1,
      feePct: 0,
      gasCostEth: 0,
      impactPct: 0,
      gwei: 0.05,
      wantedHitchBytes: 400, // planned KEY+LOC packet, not 10-byte §$STORE§
      l1FeeEth: hitchWould,
      l1FeePerByteEth: hitchWould / 400,
      reservedL1FeeEth: hitchWould * STORE_HITCH_BYTES / 400,
      hitchFeeSource: "getL1Fee",
      reason: "🎯 MAX PEAK",
      symbol: "DRB",
    });
    assert.equal(d.allow, true, "must still take the plus — never HOLD a green leftover");
    assert.ok(d.leftover > 0);
    assert.ok(d.plusNetEth > 0, "net after 1× this-tx hitch (or skip) must stay plus");
    if (d.skipHitch) {
      assert.equal(d.verdict, "SKIP_HITCH");
      assert.equal(d.injectCostEth, 0);
      assert.match(d.alwaysPlusLog, /SKIP_HITCH/);
    } else {
      // size hitch DOWN so the 400B packet cannot print −5.4e-7
      assert.ok(d.hitchBytes < 400, "must not send the full packet that would go red");
      assert.ok(plusAfterHitchEth(d.leftover, d.injectCostEth) > 0);
      assert.equal(d.verdict, "PLUS");
    }
  });

  it("VITA planned packet sizes DOWN to leftover-after-plus (not 10-byte tag floor)", () => {
    const leftover = 0.00005;
    const d = evaluateSellGate({
      projectedProceedsEth: 0.01 + leftover,
      entryEth: 0.01,
      sellPct: 1,
      feePct: 0,
      gasCostEth: 0,
      gwei: 0.05,
      wantedHitchBytes: 400,
      l1FeeEth: 0.00002,
      l1FeePerByteEth: 0.00002 / 400,
      hitchFeeSource: "getL1Fee",
      reason: "🎯 MAX PEAK",
      symbol: "DRB",
    });
    assert.equal(d.allow, true);
    assert.ok(d.leftover > 0);
    if (d.skipHitch) {
      assert.equal(d.verdict, "SKIP_HITCH");
      assert.ok(d.plusNetEth > 0);
    } else {
      assert.ok(d.hitchBytes > 0);
      assert.ok(d.hitchBytes <= 400);
      assert.ok(plusAfterHitchEth(d.leftover, d.injectCostEth) > 0);
      assert.equal(d.verdict, "PLUS");
    }
  });

  it("hitch-embedded FIFO red (UNI10/DRB5/BASECAT2/LINK2) cannot send — HOLD or SKIP hitch", () => {
    // Live tip 977e839 after #62 opened: 19 new reds, all hitch-embedded.
    // Class mirrors — not invented live P&L for 0xadd3b2e4… 0x1d2a7c29…
    // 0x4f8c461a… 0xc304e13a…
    const hitchEmbedded = [
      { symbol: "BASECAT", hash: "0xadd3b2e4", feePct: 0.010 },
      { symbol: "UNI", hash: "0x1d2a7c29", feePct: 0.003 },
      { symbol: "DRB", hash: "0x4f8c461a", feePct: 0.010 },
      { symbol: "LINK", hash: "0xc304e13a", feePct: 0.003 },
    ];
    for (const row of hitchEmbedded) {
      const underwater = evaluateSellGate({
        ...basecatUnderwater,
        symbol: row.symbol,
        feePct: row.feePct,
        wantedHitchBytes: 400,
        reason: "🎯 PEAK RIDE",
      });
      assert.equal(underwater.allow, false, `${row.hash} ${row.symbol} proceeds < buy cost`);
      assert.equal(underwater.verdict, "HOLD", row.hash);
      assert.equal(underwater.skipHitch, true, `${row.hash} must not hitch-embed a red exit`);

      const leftover = 1e-7;
      const hitchWould = leftover + 5.4e-7;
      const thinPlus = evaluateSellGate({
        projectedProceedsEth: 0.01 + leftover,
        entryEth: 0.01,
        sellPct: 1,
        feePct: 0,
        gasCostEth: 0,
        gwei: 0.05,
        wantedHitchBytes: 400,
        l1FeeEth: hitchWould,
        l1FeePerByteEth: hitchWould / 400,
        hitchFeeSource: "getL1Fee",
        reason: "🎯 PEAK RIDE",
        symbol: row.symbol,
      });
      assert.equal(thinPlus.allow, true, `${row.hash} plain plus must still sell`);
      assert.ok(thinPlus.plusNetEth > 0, `${row.hash} net after hitch/skip must stay plus`);
      if (thinPlus.skipHitch) {
        assert.equal(thinPlus.verdict, "SKIP_HITCH");
        assert.equal(thinPlus.injectCostEth, 0);
      } else {
        assert.ok(thinPlus.hitchBytes < 400, `${row.hash} must not send full KEY+LOC that would go red`);
        assert.ok(plusAfterHitchEth(thinPlus.leftover, thinPlus.injectCostEth) > 0);
      }
    }
  });
});

describe("always-plus harden — FIFO remaining cost + plus floor (defense in depth)", () => {
  // PRE-#62 Online class (mined before Railway 66158bd6 Online 2026-09-11T16:04:54Z).
  // Sell times ET: BASECAT 0xef4d… 11:55:07; UNI 0xeca2… 11:56:33;
  // BASECAT 0x1cb9… 11:58:53; DRB 0x5622… 11:59:01. Not a #62 tip leak after Online.
  // Class still proves exits-only / HOLD-if-thin / unknown-cost could sell red
  // on the old tip. Current main already has #62–#64; these tests close leftover
  // holes (cash-flow leftover as remaining cost, unknown lots, plus-floor minOut).

  it("known-cost red (proceeds < buy cost) HOLDs", () => {
    const d = evaluateSellGate({
      symbol: "UNI",
      reason: "🎯 MAX PEAK",
      sellPct: 1,
      entryEth: 0.01,
      projectedProceedsEth: 0.008,
      feePct: 0.003,
      gasCostEth: 0.00002,
      gwei: 0.05,
      wantedHitchBytes: STORE_HITCH_BYTES,
    });
    assert.equal(d.allow, false);
    assert.equal(d.verdict, "HOLD");
    assert.match(d.log, /leftover after fees|FIFO red|lose money/i);
    assert.match(d.alwaysPlusLog, /HOLD/);
  });

  it("hitch would wipe plus → SKIP_HITCH; still HOLD if leftover is red", () => {
    const leftover = 1e-7;
    const hitchWould = leftover + 5.4e-7;
    const skip = evaluateSellGate({
      projectedProceedsEth: 0.01 + leftover,
      entryEth: 0.01,
      sellPct: 1,
      feePct: 0,
      gasCostEth: 0,
      gwei: 0.05,
      wantedHitchBytes: 400,
      l1FeeEth: hitchWould,
      l1FeePerByteEth: hitchWould / 400,
      hitchFeeSource: "getL1Fee",
      reason: "🎯 PEAK RIDE",
      symbol: "DRB",
    });
    assert.equal(skip.allow, true);
    assert.ok(skip.verdict === "SKIP_HITCH" || skip.verdict === "PLUS");
    assert.ok(skip.plusNetEth > 0);
    if (skip.skipHitch) {
      assert.equal(skip.verdict, "SKIP_HITCH");
      assert.equal(skip.injectCostEth, 0);
    } else {
      assert.ok(skip.hitchBytes < 400);
      assert.ok(plusAfterHitchEth(skip.leftover, skip.injectCostEth) > 0);
    }

    const stillRed = evaluateSellGate({
      projectedProceedsEth: 0.01 - 5.4e-7,
      entryEth: 0.01,
      sellPct: 1,
      feePct: 0,
      gasCostEth: 0,
      gwei: 0.05,
      wantedHitchBytes: 400,
      l1FeeEth: hitchWould,
      l1FeePerByteEth: hitchWould / 400,
      hitchFeeSource: "getL1Fee",
      reason: "🎯 PEAK RIDE",
      symbol: "DRB",
    });
    assert.equal(stillRed.allow, false);
    assert.equal(stillRed.verdict, "HOLD");
    assert.equal(stillRed.skipHitch, true);
    assert.match(stillRed.alwaysPlusLog, /HOLD/);
  });

  it("unknown cost HOLDs — do not sell red to discover", () => {
    const d = evaluateSellGate({
      projectedProceedsEth: 0.004,
      entryEth: 0,
      sellPct: 1,
      unknownEntry: true,
      reason: "🌙 DUST RECYCLE — unknown cost basis",
      symbol: "BASECAT",
      gwei: 0.05,
    });
    assert.equal(d.allow, false);
    assert.equal(d.verdict, "HOLD");
    assert.match(d.log, /unknown cost/);
  });

  it("exits-only BASECAT cannot bypass always-plus", () => {
    const d = evaluateSellGate({
      symbol: "BASECAT",
      reason: "🎯 MAX PEAK",
      sellPct: 0.98,
      entryEth: 0.001,
      projectedProceedsEth: 0.00070,
      feePct: 0.010,
      gasCostEth: 0.00002,
      impactPct: 0.003,
      gwei: 0.05,
      wantedHitchBytes: STORE_HITCH_BYTES,
      exitsOnly: true,
    });
    assert.equal(d.allow, false);
    assert.equal(d.verdict, "HOLD");
    assert.match(d.log, /FIFO red|lose money|unknown cost|exits-only/i);

    const unknownExits = evaluateSellGate({
      symbol: "BASECAT",
      reason: "🎯 PEAK RIDE",
      sellPct: 1,
      entryEth: 0,
      projectedProceedsEth: 0.0005,
      unknownEntry: true,
      exitsOnly: true,
      gwei: 0.05,
    });
    assert.equal(unknownExits.allow, false);
    assert.equal(unknownExits.verdict, "HOLD");
  });

  it("cash-flow leftover after a plus partial must not paint remaining FIFO red as PLUS", () => {
    const ethIn = 0.01;
    const tokensIn = 1000;
    const remaining = 500;
    const ethOut = 0.008; // sold half for a plus (lot cost 0.005)
    const lie = cashFlowNetEth(ethIn, ethOut); // 0.002 — understates remaining FIFO 0.005
    const fifo = fifoRemainingCostEth({ ethIn, tokensIn, remainingTokens: remaining });
    assert.equal(fifo.unknown, false);
    assert.ok(Math.abs(fifo.investedEth - 0.005) < 1e-12);
    assert.ok(lie < fifo.investedEth, "cash-flow leftover is the cheap lie");

    const proceeds = 0.004; // remaining half now below FIFO, above the lie
    const painted = evaluateSellGate({
      projectedProceedsEth: proceeds,
      entryEth: lie,
      sellPct: 1,
      feePct: 0,
      gasCostEth: 0,
      gwei: 0.05,
      symbol: "BASECAT",
      reason: "🎯 MAX PEAK",
      exitsOnly: true,
    });
    assert.equal(painted.allow, true, "documents the leftover hole: understated cash-flow entry looks PLUS");

    const honest = evaluateSellGate({
      projectedProceedsEth: proceeds,
      entryEth: fifo.investedEth,
      sellPct: 1,
      feePct: 0,
      gasCostEth: 0,
      gwei: 0.05,
      symbol: "BASECAT",
      reason: "🎯 MAX PEAK",
      exitsOnly: true,
    });
    assert.equal(honest.allow, false);
    assert.equal(honest.verdict, "HOLD");
    assert.match(honest.log, /FIFO red|leftover after fees|proceeds/);
  });

  it("missing tokensIn does not trust persisted cash-flow leftover", () => {
    const persistedLie = 0.002; // old boot ethIn−ethOut after a plus partial
    const fifo = fifoRemainingCostEth({
      ethIn: 0.01,
      tokensIn: 0,
      remainingTokens: 500,
      persistedInvestedEth: persistedLie,
    });
    assert.equal(fifo.unknown, true);
    assert.equal(fifo.investedEth, 0);
    assert.equal(fifo.reason, "unknown-cost");
    const d = evaluateSellGate({
      projectedProceedsEth: 0.004,
      entryEth: fifo.investedEth,
      unknownEntry: fifo.unknown,
      sellPct: 1,
      symbol: "BASECAT",
      reason: "🎯 MAX PEAK",
      exitsOnly: true,
    });
    assert.equal(d.allow, false);
    assert.equal(d.verdict, "HOLD");
    assert.match(d.log, /unknown cost/);
  });

  it("unknown lots (remaining > recorded buys) HOLDs", () => {
    const fifo = fifoRemainingCostEth({
      ethIn: 0.01,
      tokensIn: 100,
      remainingTokens: 250,
    });
    assert.equal(fifo.unknown, true);
    assert.equal(fifo.reason, "unknown-lots");
    const d = evaluateSellGate({
      projectedProceedsEth: 0.02,
      entryEth: fifo.investedEth,
      unknownEntry: fifo.unknown,
      sellPct: 1,
      symbol: "UNI",
      reason: "🎯 MAX PEAK",
    });
    assert.equal(d.allow, false);
    assert.equal(d.verdict, "HOLD");
  });

  it("plus floor HOLDs when quote is below FIFO cost; raises minOut otherwise", () => {
    const entry = 0.01;
    const floor = plusFloorOutWei(entry);
    assert.ok(floor > 0n);
    const below = applySellPlusFloorMinOut({
      minOutWei: 1n,
      quotedWei: floor - 1n,
      entrySoldEth: entry,
    });
    assert.equal(below.allow, false);
    assert.equal(below.reason, "quote-below-cost");

    const unknown = applySellPlusFloorMinOut({
      minOutWei: 1n,
      quotedWei: 10n ** 16n,
      entrySoldEth: 0,
    });
    assert.equal(unknown.allow, false);
    assert.equal(unknown.reason, "unknown-cost");

    const quote = 12n * 10n ** 15n; // 0.012 ETH
    const slip = 85n * quote / 100n; // 0.0102 — still above cost
    const raised = applySellPlusFloorMinOut({
      minOutWei: slip,
      quotedWei: quote,
      entrySoldEth: entry,
    });
    assert.equal(raised.allow, true);
    assert.ok(raised.minOutWei >= floor);
    assert.ok(raised.minOutWei <= quote);
  });
});

describe("DISABLE_DOW_BIAS + operator/fresh-lot FIFO HOLD", () => {
  // Live AERO 0x326f41af / DRB 0x808acc7d: Friday sellMod +0.08 + Fri-close
  // UTC 19–22 flipped operator lots FIFO red (tiny eth). Desk cannot set an
  // env that does not exist yet — unset must kill Friday without Railway.

  it("isDisableDowBias is ON when unset (hotfix default)", () => {
    assert.equal(isDisableDowBias({}), true);
    assert.equal(isDisableDowBias({ DISABLE_DOW_BIAS: "" }), true);
    assert.equal(isDisableDowBias({ DISABLE_DOW_BIAS: "yes" }), true);
    assert.equal(isDisableDowBias({ DISABLE_DOW_BIAS: "true" }), true);
    assert.equal(isDisableDowBias({ DISABLE_DOW_BIAS: "1" }), true);
    assert.equal(isDisableDowBias({ DISABLE_DOW_BIAS: "on" }), true);
    assert.equal(isDisableDowBias({ DISABLE_DOW_BIAS: "no" }), false);
    assert.equal(isDisableDowBias({ DISABLE_DOW_BIAS: "false" }), false);
    assert.equal(isDisableDowBias({ DISABLE_DOW_BIAS: "0" }), false);
    assert.equal(isDisableDowBias({ DISABLE_DOW_BIAS: "off" }), false);
  });

  it("zeros Friday sellMod +0.08 and skips Fri-close when unset", () => {
    const friday = { name: "Friday", buyMod: -0.04, sellMod: +0.08, note: "Weekend de-risk" };
    const killed = applyDowBiasDisable(friday, {});
    assert.equal(killed.sellMod, 0);
    assert.equal(killed.buyMod, 0);
    const restored = applyDowBiasDisable(friday, { DISABLE_DOW_BIAS: "no" });
    assert.equal(restored.sellMod, 0.08);
    const friClose = new Date(Date.UTC(2026, 8, 11, 20, 0, 0)); // Fri Sep 11 2026 20:00 UTC
    assert.equal(friClose.getUTCDay(), 5);
    assert.equal(isFridayCloseWindow({ now: friClose, env: {} }), false);
    assert.equal(isFridayCloseWindow({ now: friClose, env: { DISABLE_DOW_BIAS: "no" } }), true);
  });

  it("operator buy lot that would exit FIFO red HOLDs — Friday de-risk cannot sell", () => {
    const lot = latchFreshLot({}, {
      fillCostEth: 0.00045,
      tokens: 2,
      reason: "MANUAL BUY (operator) $2",
    });
    assert.equal(freshLotCostFloor(lot), 0.00045);
    const understated = 0.00001; // pre-latch leftover that painted PLUS
    const entry = sellEntryEthWithLotFloor(understated, lot);
    assert.equal(entry, 0.00045);
    const proceeds = 0.00045 - 0.0000036; // live-class tiny FIFO red
    const d = buildSellGateDecision({
      symbol: "AERO",
      reason: "📅 Friday weekend de-risk sell+8%",
      sellPct: 0.98,
      entryEth: understated,
      lotCostEth: freshLotCostFloor(lot),
      usdMarkProceedsEth: 0.00045 * 0.705, // −29.5% USD-mark
      operatorLot: true,
      freshLot: true,
      projectedProceedsEth: proceeds,
      feePct: 0,
      gasCostEth: 0,
      gwei: 0.05,
    });
    assert.equal(d.allow, false);
    assert.equal(d.verdict, "HOLD");
    assert.match(d.log, /operator\/fresh lot|FIFO red|lose money|USD-mark/i);

    const fifoOnly = evaluateSellGate({
      symbol: "DRB",
      reason: "📅 Friday weekend de-risk sell+8%",
      sellPct: 1,
      entryEth: 0.00001,
      lotCostEth: 0.00045,
      operatorLot: true,
      freshLot: true,
      projectedProceedsEth: 0.00045 - 0.0000036,
      feePct: 0,
      gasCostEth: 0,
      gwei: 0.05,
    });
    assert.equal(fifoOnly.allow, false, "tiny FIFO eth red must HOLD with no USD mark");
    assert.equal(fifoOnly.verdict, "HOLD");
  });

  it("USD-mark below breakeven HOLDs even if a quote leftover looks plus", () => {
    const d = evaluateSellGate({
      symbol: "DRB",
      reason: "🎯 PEAK RIDE",
      sellPct: 1,
      entryEth: 0.00045,
      lotCostEth: 0.00045,
      usdMarkProceedsEth: 0.00045 * 0.705,
      operatorLot: true,
      freshLot: true,
      projectedProceedsEth: 0.00046, // quote looks plus vs fill
      feePct: 0,
      gasCostEth: 0,
      gwei: 0.05,
    });
    assert.equal(d.allow, false);
    assert.equal(d.verdict, "HOLD");
    assert.match(d.log, /USD-mark below breakeven|operator\/fresh lot/i);
  });

  it("green operator/fresh exit still sells (SKIP_HITCH or PLUS)", () => {
    const d = evaluateSellGate({
      symbol: "AERO",
      reason: "📅 Friday weekend de-risk sell+8%",
      sellPct: 1,
      entryEth: 0.00045,
      lotCostEth: 0.00045,
      usdMarkProceedsEth: 0.00055,
      operatorLot: true,
      freshLot: true,
      projectedProceedsEth: 0.00055,
      feePct: 0,
      gasCostEth: 0,
      gwei: 0.05,
    });
    assert.equal(d.allow, true);
    assert.ok(d.verdict === "SKIP_HITCH" || d.verdict === "PLUS");
    assert.ok(d.leftover > 0);
    clearFreshLot({ operatorLot: { fillCostEth: 1 } });
    assert.equal(usdMarkBelowBreakeven({ markProceedsEth: 0.001, entrySoldEth: 0.002 }), true);
    assert.equal(usdMarkBelowBreakeven({ markProceedsEth: 0.002, entrySoldEth: 0.001 }), false);
  });
});

describe("ADD_ON_FIFO_RED — block stacking into a red known FIFO lot", () => {
  // Live after #83: auto DRB trough add-on filled 0x53a00788… into a
  // FIFO-red bag. Game wants wait PLUS+hitch only unless override.

  const redBag = {
    symbol: "DRB",
    tokenBal: 2844,
    remainingFifoEth: 0.00045,
    markProceedsEth: 0.00045 * 0.70,
    unknownEntry: false,
  };

  it("ALLOW_ADD_ON_FIFO_RED defaults OFF (unset / no block; yes/true/1/on allow)", () => {
    assert.equal(isAllowAddOnFifoRed({}), false);
    assert.equal(isAllowAddOnFifoRed({ ALLOW_ADD_ON_FIFO_RED: "" }), false);
    assert.equal(isAllowAddOnFifoRed({ ALLOW_ADD_ON_FIFO_RED: "no" }), false);
    assert.equal(isAllowAddOnFifoRed({ ALLOW_ADD_ON_FIFO_RED: "false" }), false);
    assert.equal(isAllowAddOnFifoRed({ ALLOW_ADD_ON_FIFO_RED: "0" }), false);
    assert.equal(isAllowAddOnFifoRed({ ALLOW_ADD_ON_FIFO_RED: "off" }), false);
    assert.equal(isAllowAddOnFifoRed({ ALLOW_ADD_ON_FIFO_RED: "yes" }), true);
    assert.equal(isAllowAddOnFifoRed({ ALLOW_ADD_ON_FIFO_RED: "true" }), true);
    assert.equal(isAllowAddOnFifoRed({ ALLOW_ADD_ON_FIFO_RED: "1" }), true);
    assert.equal(isAllowAddOnFifoRed({ ALLOW_ADD_ON_FIFO_RED: "on" }), true);
  });

  it("bag mark proceeds is units × USD / ETHUSD (same as executeSell)", () => {
    assert.equal(bagMarkProceedsEth({ tokenBal: 100, priceUsd: 2, ethUsd: 4000 }), 0.05);
    assert.equal(bagMarkProceedsEth({ tokenBal: 0, priceUsd: 2, ethUsd: 4000 }), 0);
    assert.equal(bagMarkProceedsEth({ tokenBal: 100, priceUsd: 0, ethUsd: 4000 }), 0);
  });

  it("FIFO-red inject-pullback add-on is blocked by default", () => {
    const d = evaluateAddOnFifoRedGate({
      ...redBag,
      reason: "💉 INJECT PULLBACK [PRIORITY]",
      env: {},
    });
    assert.equal(d.allow, false);
    assert.equal(d.blocked, true);
    assert.equal(d.reason, "fifo-red");
    assert.match(d.log, /ADD_ON_FIFO_RED: skip add-on DRB/);
    assert.match(d.log, /existing FIFO lot is red/);
    assert.match(d.log, /wait PLUS\+hitch/);
    assert.equal(isFifoRedLot({
      markProceedsEth: redBag.markProceedsEth,
      remainingFifoEth: redBag.remainingFifoEth,
    }), true);
  });

  it("FIFO-red OPERATOR_BUY / Telegram /buy add-on is blocked (operator leftover bypass does not apply)", () => {
    const d = evaluateAddOnFifoRedGate({
      ...redBag,
      reason: "MANUAL BUY (operator) $2",
      env: {},
    });
    assert.equal(d.allow, false);
    assert.equal(d.blocked, true);
    assert.equal(d.reason, "fifo-red");
    assert.match(d.log, /skip add-on DRB/);
    // leftover+edge still allows operator first-buys; this gate is separate.
    const leftover = evaluateBuyGate({
      leftover: 0,
      hasEdge: false,
      symbol: "DRB",
      reason: "MANUAL BUY (operator) $2",
      env: { LOSE_ZERO: "yes" },
    });
    assert.equal(leftover.allow, true);
  });

  it("first buy into empty/flat is allowed", () => {
    const empty = evaluateAddOnFifoRedGate({
      symbol: "DRB",
      tokenBal: 0,
      remainingFifoEth: 0,
      markProceedsEth: 0,
      reason: "🎯 MIN TROUGH [PRIORITY]",
      env: {},
    });
    assert.equal(empty.allow, true);
    assert.equal(empty.reason, "flat-or-empty");
    assert.equal(empty.log, null);

    const dust = evaluateAddOnFifoRedGate({
      symbol: "DRB",
      tokenBal: 0.0004,
      remainingFifoEth: 0,
      markProceedsEth: 0,
      reason: "💉 INJECT PULLBACK [PRIORITY]",
      env: {},
    });
    assert.equal(dust.allow, true);
    assert.equal(dust.reason, "flat-or-empty");

    const unknown = evaluateAddOnFifoRedGate({
      symbol: "DRB",
      tokenBal: 2844,
      remainingFifoEth: 0,
      markProceedsEth: 0.0002,
      unknownEntry: true,
      reason: "MANUAL BUY (operator) $2",
      env: {},
    });
    assert.equal(unknown.allow, true);
    assert.equal(unknown.reason, "flat-or-empty");
    assert.equal(isExistingKnownFifoBag({
      tokenBal: 2844,
      remainingFifoEth: 0,
      unknownEntry: true,
    }), false);
  });

  it("green / not-red known FIFO lot may still add on", () => {
    const d = evaluateAddOnFifoRedGate({
      symbol: "DRB",
      tokenBal: 2844,
      remainingFifoEth: 0.00045,
      markProceedsEth: 0.00055,
      reason: "🎯 MIN TROUGH [PRIORITY]",
      env: {},
    });
    assert.equal(d.allow, true);
    assert.equal(d.blocked, false);
    assert.equal(d.reason, "fifo-not-red");
    assert.equal(d.log, null);
  });

  it("ALLOW_ADD_ON_FIFO_RED override allows add-on into a red lot", () => {
    const d = evaluateAddOnFifoRedGate({
      ...redBag,
      reason: "💉 INJECT PULLBACK [PRIORITY]",
      env: { ALLOW_ADD_ON_FIFO_RED: "yes" },
    });
    assert.equal(d.allow, true);
    assert.equal(d.blocked, false);
    assert.equal(d.reason, "override");
    assert.match(d.log, /Game override ALLOW_ADD_ON_FIFO_RED/);
  });

  it("leftover after plus partial uses remaining FIFO, not unshrunk lot floor", () => {
    const leftover = latchFreshLot({
      totalInvestedEth: 0.000045,
      unknownEntry: false,
    }, {
      fillCostEth: 0.00045,
      tokens: 284,
      reason: "MANUAL BUY (operator) $2",
    });
    assert.equal(sellEntryEthWithLotFloor(leftover.totalInvestedEth, leftover), 0.00045);
    assert.equal(addOnRemainingFifoEth(leftover), 0.000045);
    const leftoverMark = 0.00005;
    const vsFloor = evaluateAddOnFifoRedGate({
      symbol: "DRB",
      tokenBal: 284,
      remainingFifoEth: sellEntryEthWithLotFloor(leftover.totalInvestedEth, leftover),
      markProceedsEth: leftoverMark,
      env: {},
    });
    assert.equal(vsFloor.allow, false, "unshrunk floor would wrongly paint leftover red");
    const vsRemain = evaluateAddOnFifoRedGate({
      symbol: "DRB",
      tokenBal: 284,
      remainingFifoEth: addOnRemainingFifoEth(leftover),
      markProceedsEth: leftoverMark,
      reason: "💉 INJECT PULLBACK [PRIORITY]",
      env: {},
    });
    assert.equal(vsRemain.allow, true);
    assert.equal(vsRemain.reason, "fifo-not-red");

    const dustCleared = latchFreshLot({
      totalInvestedEth: 0,
      unknownEntry: false,
    }, {
      fillCostEth: 0.00045,
      tokens: 2,
      reason: "MANUAL BUY (operator) $2",
    });
    assert.equal(addOnRemainingFifoEth(dustCleared), 0);
    const dust = evaluateAddOnFifoRedGate({
      symbol: "DRB",
      tokenBal: 0.0004,
      remainingFifoEth: addOnRemainingFifoEth(dustCleared),
      markProceedsEth: 1e-6,
      reason: "🎯 MIN TROUGH [PRIORITY]",
      env: {},
    });
    assert.equal(dust.allow, true);
    assert.equal(dust.reason, "flat-or-empty");
  });
});
