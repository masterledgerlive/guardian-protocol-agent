import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  VERIFIED_HOME_ADDRESS,
  VERIFIED_HOME_SYMBOL,
  HOME_FEE_TIER,
  HOME_AERO_SLIPSTREAM_POOL,
  HOME_UNI_V3_WETH_POOL,
  OPERATOR_ROTATE_BUY_REASON,
  VAULT_NEVER_ADDRESS,
  ROTATE_GAS_FLOOR_ETH,
  parseOperatorRotateTo,
  isOperatorRotateArmed,
  isRotateTarget,
  isVaultNeverAddress,
  rotateWalletAllowed,
  shouldSkipRotateSell,
  excessWethToSell,
  ROTATE_MIN_BALANCE,
  queueOperatorRotateOnce,
  markOperatorRotateSellExecuted,
  maybeQueueRotateHomeBuy,
  finishOperatorRotate,
  canFinishOperatorRotate,
  shouldHoldAllowLossyForRotate,
  rotateAllowsLossySell,
  rotateBypassesPiggyDustHold,
  rotateSellCommand,
  isRotateRemBag,
  rotateSellsOutstanding,
  applyRotateQuoterMiss,
  applyRotateUnquotedSkip,
  isRotateSellSkipped,
  isRotateNoQuote,
  isOperatorRotateBuyReason,
  rotateHomeBuyBypassesV3Freeze,
  rotateHomeBuyAllowsRouteCode,
  rotateHomeBuyUsesSlipstream,
  rotateHomeBuyBypassesQuoterCooldown,
  rotateHomeBuyIgnoresUniQuoterMiss,
  clearRotateHomeQuoterCooldown,
  ROTATE_QUOTER_MISS_SKIP,
  verifiedHomeCatalogRow,
} from "./operator-rotate.js";
import { isBuyFrozen, freezeNewBuys, recordSlippageFail, isSlippageCooledDown, clearSlippageFails, BASE_QUOTER_V2 } from "./price-insane.js";
import { evaluateSwapRouterRoute, MIN_SWAP_POOL_LIQ_USD } from "./quote-swap-guard.js";
import {
  canBypassSellLossGate,
  consumeAllowLossyOperatorSell,
  evaluateSellGate,
} from "./lose-zero-gate.js";
import { applyPiggyToSell } from "./piggy-bank.js";
import { hasSellableUsd, SELLABLE_MIN_USD } from "./cost-edge-gate.js";
import {
  rotateHomeSlipstreamBuyPath,
  isSlipstreamHomeBuyPath,
  HOME_SLIPSTREAM_TICK_SPACING,
  SLIPSTREAM_QUOTER_V2,
  SLIPSTREAM_SWAP_ROUTER,
} from "./aero-slipstream.js";
import { UNISWAP_SWAP_ROUTER02_BASE } from "./swap-minout.js";

const agentSrc = readFileSync(new URL("./agent.js", import.meta.url), "utf8");

describe("HOME catalog — verified defi.app address", () => {
  it("locks the official Base HOME address and 0.3% liquid fee", () => {
    const row = verifiedHomeCatalogRow();
    assert.equal(row.symbol, "HOME");
    assert.equal(row.address, "0x4BfAa776991E85e5f8b1255461cbbd216cFc714f");
    assert.equal(row.address, VERIFIED_HOME_ADDRESS);
    assert.equal(row.feeTier, 3000);
    assert.equal(HOME_FEE_TIER, 3000);
    assert.ok(agentSrc.includes("VERIFIED_HOME_ADDRESS"));
    assert.match(agentSrc, /symbol:\s*"HOME"/);
  });

  it("rejects any other OPERATOR_ROTATE_TO ticker", () => {
    assert.deepEqual(parseOperatorRotateTo("HOME"), {
      symbol: "HOME",
      address: VERIFIED_HOME_ADDRESS,
    });
    assert.equal(parseOperatorRotateTo("ETH"), null);
    assert.equal(parseOperatorRotateTo("AERO"), null);
    assert.equal(parseOperatorRotateTo(""), null);
    assert.equal(isOperatorRotateArmed({ OPERATOR_ROTATE_TO: "HOME" }), true);
    assert.equal(isOperatorRotateArmed({ OPERATOR_ROTATE_TO: "WETH" }), false);
  });
});

describe("OPERATOR_ROTATE_TO=HOME gate", () => {
  it("will not sell HOME and will not touch the vault", () => {
    const env = { OPERATOR_ROTATE_TO: "HOME" };
    assert.equal(isRotateTarget("HOME", env), true);
    assert.equal(shouldSkipRotateSell({ symbol: "HOME", env }), true);
    assert.equal(shouldSkipRotateSell({ symbol: "AERO", env }), false);
    assert.equal(isVaultNeverAddress(VAULT_NEVER_ADDRESS), true);
    assert.equal(rotateWalletAllowed(VAULT_NEVER_ADDRESS), false);
    assert.equal(rotateWalletAllowed("0x50e1C4608c48b0c52E1EA5FBabc1c9126eA17915"), true);
    assert.equal(shouldSkipRotateSell({
      symbol: "AERO",
      wallet: VAULT_NEVER_ADDRESS,
      env,
    }), true);

    const vaultCmds = [];
    const vault = queueOperatorRotateOnce(
      vaultCmds,
      "HOME",
      new Set(["AERO", "HOME", "TOSHI"]),
      { done: false },
      { wallet: VAULT_NEVER_ADDRESS, env: { OPERATOR_ROTATE_TO: "HOME" } },
    );
    assert.equal(vault.reason, "vault-never");
    assert.equal(vaultCmds.length, 0);

    const commands = [];
    const state = { done: false };
    const env2 = { OPERATOR_ROTATE_TO: "HOME" };
    const r = queueOperatorRotateOnce(
      commands,
      "HOME",
      new Set(["AERO", "HOME", "TOSHI", "USDG", "WETH"]),
      state,
      { wallet: "0x50e1C4608c48b0c52E1EA5FBabc1c9126eA17915", env: env2 },
    );
    assert.equal(r.queued, true);
    assert.equal(commands.some((c) => c.symbol === "HOME" && c.action === "sell"), false);
    assert.equal(commands.some((c) => c.symbol === "USDG"), false);
    assert.ok(commands.some((c) => c.symbol === "AERO" && c.action === "sell" && c.unlockPiggy === true));
    assert.ok(commands.some((c) => c.symbol === "TOSHI" && c.action === "sell" && c.unlockPiggy === true));
    assert.equal(env2.HALT_NEW_ENTRIES, "yes");
    assert.equal(env2.ALLOW_LOSSY_OPERATOR_SELL, "yes");
  });

  it("keeps ≥0.0005 ETH native as the gas floor", () => {
    assert.equal(ROTATE_GAS_FLOOR_ETH, 0.0005);
    // Live RISK: 0.000680 ETH + 0.001545 WETH — spend all WETH, keep native.
    assert.equal(excessWethToSell({
      nativeEth: 0.000680,
      wethEth: 0.001545,
    }), 0.001545);
    // Native below floor: hold enough WETH to top up to 0.0005.
    assert.equal(excessWethToSell({
      nativeEth: 0.0002,
      wethEth: 0.001545,
    }), 0.001245);
    assert.equal(excessWethToSell({
      nativeEth: 0.0005,
      wethEth: 0.001,
    }), 0.001);
    assert.equal(excessWethToSell({
      nativeEth: 0,
      wethEth: 0.0004,
    }), 0);
  });

  it("holds ALLOW_LOSSY until every non-HOME sell finishes, then clears", () => {
    const env = { OPERATOR_ROTATE_TO: "HOME", ALLOW_LOSSY_OPERATOR_SELL: "yes" };
    assert.equal(shouldHoldAllowLossyForRotate(env), true);
    assert.equal(rotateAllowsLossySell("TOSHI", env), true);
    assert.equal(rotateAllowsLossySell("HOME", env), false);
    assert.equal(canBypassSellLossGate("MANUAL SELL (operator) ROTATE", env, "TOSHI"), true);
    assert.equal(canBypassSellLossGate("MANUAL SELL (operator) ROTATE", env, "HOME"), false);
    assert.equal(consumeAllowLossyOperatorSell(env), false, "must not consume mid-rotate");
    assert.equal(env.ALLOW_LOSSY_OPERATOR_SELL, "yes");

    const red = {
      symbol: "TOSHI",
      reason: "MANUAL SELL (operator) ROTATE",
      sellPct: 1,
      entryEth: 0.001,
      lotCostEth: 0.001,
      operatorLot: true,
      freshLot: true,
      projectedProceedsEth: 0.0007,
      usdMarkProceedsEth: 0.0007,
      feePct: 0.01,
      gasCostEth: 0.00002,
      impactPct: 0.003,
      gwei: 0.05,
      env,
    };
    const first = evaluateSellGate(red);
    assert.equal(first.allow, true);
    assert.equal(consumeAllowLossyOperatorSell(env), false);
    const second = evaluateSellGate({ ...red, symbol: "AERO" });
    assert.equal(second.allow, true);

    const commands = [];
    const state = { done: false, pendingSells: ["AERO"] };
    markOperatorRotateSellExecuted(state, "AERO");
    const buy = maybeQueueRotateHomeBuy(commands, state, { env, wallet: "0x50e1C4608c48b0c52E1EA5FBabc1c9126eA17915" });
    assert.equal(buy.queued, true);
    assert.equal(commands[0].symbol, VERIFIED_HOME_SYMBOL);
    assert.equal(commands[0].action, "buy");

    const done = finishOperatorRotate(env, state, { homeBuyAttempted: true });
    assert.equal(done.consumed, true);
    assert.equal(env.ALLOW_LOSSY_OPERATOR_SELL, "no");
    assert.equal(env.OPERATOR_ROTATE_TO, "");
    assert.equal(shouldHoldAllowLossyForRotate(env, state), false);
  });

  it("queues the live RISK bags and does not consume ALLOW_LOSSY mid-list", () => {
    // Desk addendum bags (Base RISK). USDG skip-hold. HOME never sold.
    const live = ["AERO", "MORPHO", "VIRTUAL", "TOSHI", "BASECAT", "USDG", "KEYCAT", "REI", "STONKEX", "AIXBT", "HOME"];
    const env = { OPERATOR_ROTATE_TO: "HOME", ALLOW_LOSSY_OPERATOR_SELL: "yes" };
    const commands = [];
    const state = { done: false };
    const r = queueOperatorRotateOnce(
      commands,
      "HOME",
      new Set(live),
      state,
      { wallet: "0x50e1C4608c48b0c52E1EA5FBabc1c9126eA17915", env },
    );
    assert.equal(r.queued, true);
    const sells = commands.filter((c) => c.action === "sell").map((c) => c.symbol);
    assert.deepEqual(sells.sort(), ["AERO", "AIXBT", "BASECAT", "KEYCAT", "MORPHO", "REI", "STONKEX", "TOSHI", "VIRTUAL"]);
    assert.equal(sells.includes("HOME"), false);
    assert.equal(sells.includes("USDG"), false);
    for (const symbol of sells) {
      const gate = evaluateSellGate({
        symbol,
        reason: "MANUAL SELL (operator) ROTATE",
        sellPct: 1,
        entryEth: 0.001,
        lotCostEth: 0.001,
        operatorLot: true,
        freshLot: true,
        projectedProceedsEth: 0.0007,
        usdMarkProceedsEth: 0.0007,
        feePct: 0.01,
        gasCostEth: 0.00002,
        impactPct: 0.003,
        gwei: 0.05,
        env,
      });
      assert.equal(gate.allow, true, `${symbol} FIFO-red must sell during rotate`);
      assert.equal(consumeAllowLossyOperatorSell(env), false, `${symbol} must not consume mid-bag`);
      assert.equal(env.ALLOW_LOSSY_OPERATOR_SELL, "yes");
      markOperatorRotateSellExecuted(state, symbol);
    }
    assert.equal(excessWethToSell({ nativeEth: 0.000680, wethEth: 0.001545 }), 0.001545);
    const buy = maybeQueueRotateHomeBuy(commands, state, {
      env,
      wallet: "0x50e1C4608c48b0c52E1EA5FBabc1c9126eA17915",
    });
    assert.equal(buy.queued, true);
    assert.equal(buy.symbol, "HOME");
    const done = finishOperatorRotate(env, state, { homeBuyAttempted: true });
    assert.equal(done.consumed, true);
    assert.equal(env.ALLOW_LOSSY_OPERATOR_SELL, "no");
  });
});

describe("OPERATOR_ROTATE rem piggy-dust unlock", () => {
  it("queues every rem bag above 1e-9 with unlockPiggy even when USD < SELLABLE_MIN", () => {
    assert.equal(ROTATE_MIN_BALANCE, 1e-9);
    assert.equal(isRotateRemBag(1e-9), false);
    assert.equal(isRotateRemBag(1.000000001e-9), true);
    assert.equal(isRotateRemBag(81.19), true);
    assert.equal(isRotateRemBag(0.044), true);

    const env = { OPERATOR_ROTATE_TO: "HOME" };
    assert.equal(rotateBypassesPiggyDustHold("MANUAL SELL (operator) ROTATE", env), true);
    assert.equal(rotateBypassesPiggyDustHold("", { OPERATOR_ROTATE_TO: "" }), false);

    // Live rem: TOSHI 81.19 / KEYCAT 77.48 / AIXBT 0.044 mark under ~$0.15.
    const rem = {
      TOSHI: { bal: 81.19, px: 0.0003 },
      KEYCAT: { bal: 77.48, px: 0.0004 },
      AIXBT: { bal: 0.044, px: 0.05 },
      REI: { bal: 3.11, px: 0.02 },
      STONKEX: { bal: 1.41, px: 0.04 },
    };
    for (const [symbol, { bal, px }] of Object.entries(rem)) {
      const usd = bal * px;
      assert.ok(usd < SELLABLE_MIN_USD, `${symbol} $${usd} must be under SELLABLE_MIN`);
      assert.equal(hasSellableUsd(bal, px, SELLABLE_MIN_USD), false);
      const cmd = rotateSellCommand(symbol);
      assert.equal(cmd.unlockPiggy, true);
      assert.equal(cmd.action, "sell");
      const piggy = applyPiggyToSell({
        balance: bal,
        sellPct: 1,
        piggyReserve: bal,
        priceUsd: px,
        reason: "MANUAL SELL (operator) ROTATE",
        forceUnlock: rotateBypassesPiggyDustHold("MANUAL SELL (operator) ROTATE", env),
      });
      assert.equal(piggy.unlock, true, `${symbol} rotate must unlock piggy`);
      assert.ok(piggy.tokensToSell > 0, `${symbol} must sell rem units`);
      assert.ok(Math.abs(piggy.tokensToSell - bal) < 1e-9, `${symbol} sells the full rem bag`);
    }

    const commands = [];
    const state = { done: false, doneBySymbol: { TOSHI: true, AERO: true } };
    const r = queueOperatorRotateOnce(
      commands,
      "HOME",
      new Set(["TOSHI", "KEYCAT", "AIXBT", "REI", "STONKEX", "AERO", "HOME", "USDG"]),
      state,
      {
        wallet: "0x50e1C4608c48b0c52E1EA5FBabc1c9126eA17915",
        env,
        balances: {
          TOSHI: 81.19,
          KEYCAT: 77.48,
          AIXBT: 0.044,
          REI: 3.11,
          STONKEX: 1.41,
          AERO: 0,
          HOME: 0,
          USDG: 15,
        },
      },
    );
    assert.equal(r.queued, true);
    const sells = commands.filter((c) => c.action === "sell");
    assert.deepEqual(sells.map((c) => c.symbol).sort(), ["AIXBT", "KEYCAT", "REI", "STONKEX", "TOSHI"]);
    for (const c of sells) {
      assert.equal(c.unlockPiggy, true, `${c.symbol} must unlock piggy`);
      assert.equal(c.source, "OPERATOR_ROTATE");
    }
    assert.equal(commands.some((c) => c.symbol === "AERO"), false, "sold AERO rem=0 stays done");
    assert.equal(state.doneBySymbol.TOSHI, undefined, "TOSHI rem >1e-9 re-queues after false done latch");
  });

  it("does not clear OPERATOR_ROTATE_TO until HOME buy attempted", () => {
    const env = { OPERATOR_ROTATE_TO: "HOME", ALLOW_LOSSY_OPERATOR_SELL: "yes" };
    const state = { done: false };
    assert.equal(canFinishOperatorRotate({
      homeBuyAttempted: false,
      nativeEth: 0.000680,
      wethEth: 0.001545,
    }), false);
    assert.equal(canFinishOperatorRotate({
      homeBuyAttempted: false,
      nativeEth: 0.000680,
      wethEth: 0,
    }), false);
    const held = finishOperatorRotate(env, state, {
      homeBuyAttempted: false,
      nativeEth: 0.000680,
      wethEth: 0,
    });
    assert.equal(held.finished, false);
    assert.equal(held.reason, "home-buy-pending");
    assert.equal(env.OPERATOR_ROTATE_TO, "HOME");
    assert.equal(env.ALLOW_LOSSY_OPERATOR_SELL, "yes");

    assert.equal(canFinishOperatorRotate({ homeBuyAttempted: true }), true);

    const done = finishOperatorRotate(env, state, { homeBuyAttempted: true });
    assert.equal(done.finished, true);
    assert.equal(env.OPERATOR_ROTATE_TO, "");
    assert.equal(env.ALLOW_LOSSY_OPERATOR_SELL, "no");
  });

  it("executeSell skips piggy-only dust hold and latches rem at 1e-9 during rotate", () => {
    assert.ok(agentSrc.includes("rotateBypassesPiggyDustHold"));
    assert.ok(agentSrc.includes("ROTATE_MIN_BALANCE"));
    const sellFn = agentSrc.indexOf("async function executeSell(");
    const sellEnd = agentSrc.indexOf("\nasync function ", sellFn + 1);
    const body = agentSrc.slice(sellFn, sellEnd > 0 ? sellEnd : sellFn + 12000);
    const bypass = body.indexOf("rotateBypassesPiggyDustHold(reason)");
    const dustHold = body.indexOf("piggy-only dust");
    assert.ok(bypass >= 0, "executeSell must consult rotate dust bypass");
    assert.ok(dustHold > bypass, "rotate bypass must sit before piggy-only dust return");
    assert.ok(body.includes("forceUnlock: overrideSell || rotateUnlock"));
    assert.match(agentSrc, /remain <= ROTATE_MIN_BALANCE/);
    assert.ok(agentSrc.includes("balances: tokenBalanceCache"));
    assert.ok(agentSrc.includes("homeBuyAttempted: true"));
  });
});

describe("OPERATOR_ROTATE Quoter-miss rem does not block HOME", () => {
  it("drops Quoter-miss rem from outstanding and opens the HOME buy gate", () => {
    assert.equal(ROTATE_QUOTER_MISS_SKIP, 3);
    const env = { OPERATOR_ROTATE_TO: "HOME" };
    const wallet = "0x50e1C4608c48b0c52E1EA5FBabc1c9126eA17915";
    const commands = [];
    const state = { done: false, pendingSells: ["TYBG", "MIGGLES", "TOBY"] };
    markOperatorRotateSellExecuted(state, "TYBG");
    commands.push(rotateSellCommand("MIGGLES"));
    commands.push(rotateSellCommand("TOBY"));
    assert.deepEqual(rotateSellsOutstanding(commands, state).sort(), ["MIGGLES", "TOBY"]);

    // Live rem leftovers: first QuoterV2 miss drops the bag.
    const miggles = applyRotateQuoterMiss({
      commands,
      state,
      symbol: "MIGGLES",
      remBag: true,
      kind: "QuoterV2 miss",
      code: "QUOTE_MISS",
    });
    assert.equal(miggles.dropped, true);
    assert.equal(isRotateSellSkipped(state, "MIGGLES"), true);
    assert.equal(rotateSellsOutstanding(commands, state).includes("MIGGLES"), false);
    assert.equal(commands.some((c) => c.symbol === "MIGGLES"), false);

    const stillBlocked = maybeQueueRotateHomeBuy(commands, state, { env, wallet });
    assert.equal(stillBlocked.queued, false);
    assert.equal(stillBlocked.reason, "sells-pending");

    const toby = applyRotateQuoterMiss({
      commands,
      state,
      symbol: "TOBY",
      remBag: true,
      kind: "QuoterV2 miss",
    });
    assert.equal(toby.dropped, true);
    assert.deepEqual(rotateSellsOutstanding(commands, state), []);

    const buy = maybeQueueRotateHomeBuy(commands, state, { env, wallet });
    assert.equal(buy.queued, true);
    assert.equal(buy.symbol, "HOME");
    assert.equal(commands.some((c) => c.symbol === "HOME" && c.action === "buy"), true);

    // Rem rematch must not re-queue a Quoter-skipped leftover.
    const again = queueOperatorRotateOnce(
      commands,
      "HOME",
      new Set(["MIGGLES", "TOBY", "HOME", "TYBG"]),
      state,
      { wallet, env, balances: { MIGGLES: 12, TOBY: 4, TYBG: 0, HOME: 0 } },
    );
    assert.equal(commands.some((c) => c.symbol === "MIGGLES" && c.action === "sell"), false);
    assert.equal(commands.some((c) => c.symbol === "TOBY" && c.action === "sell"), false);
    assert.ok(again.reason === "already-queued" || again.homeBuy || !again.queued);
  });

  it("drops a non-rem bag only after 3 QuoterV2 misses", () => {
    const env = { OPERATOR_ROTATE_TO: "HOME" };
    const wallet = "0x50e1C4608c48b0c52E1EA5FBabc1c9126eA17915";
    const commands = [rotateSellCommand("AERO")];
    const state = { done: false, pendingSells: ["AERO"] };
    for (let i = 1; i <= 2; i++) {
      const r = applyRotateQuoterMiss({
        commands,
        state,
        symbol: "AERO",
        remBag: false,
        kind: "QuoterV2 miss",
      });
      assert.equal(r.dropped, false, `miss ${i} must keep outstanding`);
      assert.deepEqual(rotateSellsOutstanding(commands, state), ["AERO"]);
      assert.equal(maybeQueueRotateHomeBuy(commands, state, { env, wallet }).reason, "sells-pending");
    }
    const third = applyRotateQuoterMiss({
      commands,
      state,
      symbol: "AERO",
      remBag: false,
      kind: "QuoterV2 miss",
    });
    assert.equal(third.dropped, true);
    assert.equal(third.misses, 3);
    assert.deepEqual(rotateSellsOutstanding(commands, state), []);
    const buy = maybeQueueRotateHomeBuy(commands, state, { env, wallet });
    assert.equal(buy.queued, true);
    assert.equal(buy.symbol, "HOME");
  });

  it("executeSell rotate path notes Quoter miss and will not re-queue skipped rem", () => {
    assert.ok(agentSrc.includes("applyRotateQuoterMiss"));
    assert.ok(agentSrc.includes("isRotateSellSkipped"));
    const sellFn = agentSrc.indexOf("async function executeSell(");
    const sellEnd = agentSrc.indexOf("\nasync function ", sellFn + 1);
    const body = agentSrc.slice(sellFn, sellEnd > 0 ? sellEnd : sellFn + 14000);
    assert.ok(body.includes("applyRotateQuoterMiss"), "executeSell must drop rotate Quoter-miss rem");
    assert.ok(body.includes("HOME must not wait"));
    assert.ok(agentSrc.includes("isRotateSellSkipped(operatorRotateState, token.symbol)"));
  });
});

describe("OPERATOR_ROTATE NO-QUOTE / zero-bal rem does not block HOME", () => {
  const UNQUOTED = ["KITE", "CRASH", "BRIUN", "NORMIE", "OGGY", "FREN", "ROOST"];
  const wallet = "0x50e1C4608c48b0c52E1EA5FBabc1c9126eA17915";

  it("drops NO-QUOTE rem from outstanding and opens the HOME buy gate", () => {
    assert.equal(isRotateNoQuote("NO QUOTE", "NO_QUOTE"), true);
    assert.equal(isRotateNoQuote("missing DexScreener mark", ""), true);
    const env = { OPERATOR_ROTATE_TO: "HOME" };
    const commands = [];
    const state = { done: false, pendingSells: ["TYBG", ...UNQUOTED] };
    markOperatorRotateSellExecuted(state, "TYBG");
    for (const symbol of UNQUOTED) commands.push(rotateSellCommand(symbol));
    assert.deepEqual(rotateSellsOutstanding(commands, state).sort(), [...UNQUOTED].sort());

    for (const symbol of UNQUOTED) {
      const r = applyRotateUnquotedSkip({
        commands,
        state,
        symbol,
        remBag: true,
        kind: "NO QUOTE",
        code: "NO_QUOTE",
      });
      assert.equal(r.dropped, true, `${symbol} NO-QUOTE rem must drop`);
      assert.equal(r.reason, "no-quote");
      assert.equal(isRotateSellSkipped(state, symbol), true);
    }
    assert.deepEqual(rotateSellsOutstanding(commands, state), []);
    const buy = maybeQueueRotateHomeBuy(commands, state, { env, wallet });
    assert.equal(buy.queued, true);
    assert.equal(buy.symbol, "HOME");
    assert.equal(commands.some((c) => c.symbol === "HOME" && c.action === "buy"), true);

    const again = queueOperatorRotateOnce(
      commands,
      "HOME",
      new Set([...UNQUOTED, "HOME", "TYBG"]),
      state,
      { wallet, env, balances: Object.fromEntries(UNQUOTED.map((s) => [s, 12])) },
    );
    for (const symbol of UNQUOTED) {
      assert.equal(commands.some((c) => c.symbol === symbol && c.action === "sell"), false);
    }
    assert.ok(again.reason === "already-queued" || again.homeBuy || !again.queued);
  });

  it("drops zero-bal leftovers from outstanding and opens the HOME buy gate", () => {
    const env = { OPERATOR_ROTATE_TO: "HOME" };
    const commands = [rotateSellCommand("KITE"), rotateSellCommand("CRASH")];
    const state = { done: false, pendingSells: ["KITE", "CRASH"] };
    assert.deepEqual(rotateSellsOutstanding(commands, state).sort(), ["CRASH", "KITE"]);

    const kite = applyRotateUnquotedSkip({
      commands,
      state,
      symbol: "KITE",
      remBag: false,
      kind: "NO QUOTE",
      code: "NO_QUOTE",
      balance: 0,
    });
    assert.equal(kite.dropped, true);
    assert.equal(kite.reason, "zero-bal");
    assert.equal(rotateSellsOutstanding(commands, state).includes("KITE"), false);

    const stillBlocked = maybeQueueRotateHomeBuy(commands, state, { env, wallet });
    assert.equal(stillBlocked.queued, false);
    assert.equal(stillBlocked.reason, "sells-pending");

    const crash = applyRotateUnquotedSkip({
      commands,
      state,
      symbol: "CRASH",
      remBag: false,
      kind: "missing DexScreener-or-Quoter mark",
      balance: 0,
    });
    assert.equal(crash.dropped, true);
    assert.equal(crash.reason, "zero-bal");
    assert.deepEqual(rotateSellsOutstanding(commands, state), []);

    const buy = maybeQueueRotateHomeBuy(commands, state, { env, wallet });
    assert.equal(buy.queued, true);
    assert.equal(buy.symbol, "HOME");
  });

  it("processToken NO QUOTE / disabled rotate path marks skip so HOME can queue", () => {
    assert.ok(agentSrc.includes("applyRotateUnquotedSkip"));
    assert.ok(agentSrc.includes("noteRotateUnquotedSkip"));
    const procFn = agentSrc.indexOf("async function processToken(");
    const procEnd = agentSrc.indexOf("\nasync function ", procFn + 1);
    const body = agentSrc.slice(procFn, procEnd > 0 ? procEnd : procFn + 8000);
    assert.ok(body.includes("noteRotateUnquotedSkip"), "processToken must drop rotate NO-QUOTE rem");
    assert.ok(body.includes("NO QUOTE"));
    const sellFn = agentSrc.indexOf("async function executeSell(");
    const sellEnd = agentSrc.indexOf("\nasync function ", sellFn + 1);
    const sellBody = agentSrc.slice(sellFn, sellEnd > 0 ? sellEnd : sellFn + 14000);
    assert.ok(sellBody.includes("applyRotateUnquotedSkip"), "executeSell must drop rotate NO-QUOTE / zero-bal");
  });
});

const HOME_DEX_PAIRS = [
  {
    chainId: "base",
    dexId: "aerodrome",
    labels: ["slipstream", "v3"],
    pairAddress: HOME_AERO_SLIPSTREAM_POOL,
    liquidity: { usd: 12_500 },
    volume: { h24: 8_000 },
    baseToken: { address: VERIFIED_HOME_ADDRESS, symbol: "HOME" },
    quoteToken: { address: "0x4200000000000000000000000000000000000006", symbol: "WETH" },
  },
  {
    chainId: "base",
    dexId: "uniswap",
    labels: ["v3"],
    pairAddress: HOME_UNI_V3_WETH_POOL,
    liquidity: { usd: 18 },
    volume: { h24: 1 },
    baseToken: { address: VERIFIED_HOME_ADDRESS, symbol: "HOME" },
    quoteToken: { address: "0x4200000000000000000000000000000000000006", symbol: "WETH" },
  },
];

describe("OPERATOR_ROTATE HOME buy vs THIN_V3_WETH freeze", () => {
  it("rotate HOME buy is not frozen by THIN_V3_WETH; normal HOME buy still is", () => {
    const store = Object.create(null);
    freezeNewBuys("HOME", "THIN_V3_WETH", store);
    freezeNewBuys("GAME", "THIN_V3_WETH", store);
    assert.equal(isBuyFrozen("HOME", store), true);
    assert.equal(isBuyFrozen("GAME", store), true);

    assert.equal(isOperatorRotateBuyReason(OPERATOR_ROTATE_BUY_REASON), true);
    assert.equal(rotateHomeBuyBypassesV3Freeze(OPERATOR_ROTATE_BUY_REASON, "HOME"), true);
    assert.equal(rotateHomeBuyBypassesV3Freeze(OPERATOR_ROTATE_BUY_REASON, "home"), true);
    assert.equal(
      rotateHomeBuyBypassesV3Freeze("MANUAL BUY (operator) ROTATE HOME", "HOME"),
      true,
    );

    // Normal operator /buy and auto path still honor the freeze.
    assert.equal(rotateHomeBuyBypassesV3Freeze("MANUAL BUY (operator) $3", "HOME"), false);
    assert.equal(rotateHomeBuyBypassesV3Freeze("🎯 MIN TROUGH [PRIORITY]", "HOME"), false);
    assert.equal(rotateHomeBuyBypassesV3Freeze(OPERATOR_ROTATE_BUY_REASON, "GAME"), false);
    assert.equal(isBuyFrozen("GAME", store), true, "do not unfreeze other tokens");
    assert.equal(isBuyFrozen("HOME", store), true, "HOME freeze row stays; rotate only bypasses");
  });

  it("HOME DexScreener Uni V3 ghost is THIN_V3_WETH; rotate allows catalog fee 3000", () => {
    const r = evaluateSwapRouterRoute({
      pairs: HOME_DEX_PAIRS,
      tokenAddress: VERIFIED_HOME_ADDRESS,
      tradeUsd: 5,
      symbol: "HOME",
    });
    assert.equal(r.allow, false);
    assert.equal(r.freezeBuys, true);
    assert.equal(r.code, "THIN_V3_WETH");
    assert.ok(r.swap.liqUsd < MIN_SWAP_POOL_LIQ_USD);
    assert.equal(r.swap.pairAddress.toLowerCase(), HOME_UNI_V3_WETH_POOL.toLowerCase());
    assert.equal(r.primary.pairAddress.toLowerCase(), HOME_AERO_SLIPSTREAM_POOL.toLowerCase());

    assert.equal(rotateHomeBuyAllowsRouteCode(r.code), true);
    assert.equal(rotateHomeBuyAllowsRouteCode("NO_V3_WETH"), true);
    assert.equal(rotateHomeBuyAllowsRouteCode("PRIMARY_NOT_V3_WETH"), true);
    assert.equal(rotateHomeBuyAllowsRouteCode("EMPTY_V3_POOL"), false);
    assert.equal(rotateHomeBuyAllowsRouteCode("TRADE_TOO_BIG"), false);

    assert.equal(HOME_FEE_TIER, 3000);
    assert.equal(HOME_AERO_SLIPSTREAM_POOL.toLowerCase(), "0x098a4de96305bafaea0c0ce07cf6456e2c64982a");
    assert.equal(VERIFIED_HOME_ADDRESS, "0x4BfAa776991E85e5f8b1255461cbbd216cFc714f");
  });

  it("executeBuy rotate HOME bypasses freeze and does not bind the Uni V3 ghost", () => {
    const buyFn = agentSrc.indexOf("async function executeBuy(");
    const buyEnd = agentSrc.indexOf("\nasync function ", buyFn + 1);
    const buyBody = agentSrc.slice(buyFn, buyEnd > 0 ? buyEnd : buyFn + 16000);
    assert.ok(buyFn >= 0 && buyEnd > buyFn, "executeBuy must exist");
    assert.ok(buyBody.includes("rotateHomeBuyBypassesV3Freeze"), "rotate HOME must bypass isBuyFrozen");
    assert.ok(buyBody.includes("isBuyFrozen(token.symbol) && !rotateHomeBuy"), "normal HOME buy still freezes");
    assert.ok(buyBody.includes("rotateHomeBuyUsesSlipstream") || buyBody.includes("getSlipstreamHomeBuyQuote"), "THIN_V3 must not bind Uni quote on rotate HOME");
    assert.ok(buyBody.includes("HOME_SLIPSTREAM_TICK_SPACING") || buyBody.includes("encodeSlipstreamExactInputSingle"), "rotate HOME prefers Slipstream tickSpacing 200");
    assert.ok(buyBody.includes("getSlipstreamHomeBuyQuote"), "rotate HOME must quote Slipstream, not Uni QuoterV2");
    assert.ok(buyBody.includes("clearRotateHomeQuoterCooldown"), "must clear QuoterV2 miss cooldown");
    assert.ok(buyBody.includes("rotateHomeBuyBypassesQuoterCooldown"), "cooldown must not skipBuy rotate HOME");
    assert.ok(!buyBody.includes("skipPools: rotateHomeBuy ? [HOME_UNI_V3_WETH_POOL] : []"));
    assert.ok(buyBody.includes("OPERATOR_ROTATE_BUY_REASON") || agentSrc.includes("OPERATOR_ROTATE_BUY_REASON"));
    assert.equal(ROTATE_GAS_FLOOR_ETH, 0.0005);
  });
});

describe("OPERATOR_ROTATE HOME buy uses Slipstream, not Uni QuoterV2", () => {
  it("selects Slipstream path without Uni QuoterV2 success", () => {
    const path = rotateHomeSlipstreamBuyPath();
    assert.equal(rotateHomeBuyUsesSlipstream(OPERATOR_ROTATE_BUY_REASON, "HOME"), true);
    assert.equal(rotateHomeBuyUsesSlipstream("MANUAL BUY (operator) $3", "HOME"), false);
    assert.equal(isSlipstreamHomeBuyPath(path), true);
    assert.equal(path.tickSpacing, 200);
    assert.equal(path.tickSpacing, HOME_SLIPSTREAM_TICK_SPACING);
    assert.equal(path.pool.toLowerCase(), HOME_AERO_SLIPSTREAM_POOL.toLowerCase());
    assert.equal(path.tokenOut, VERIFIED_HOME_ADDRESS);
    assert.equal(path.quoter.toLowerCase(), SLIPSTREAM_QUOTER_V2.toLowerCase());
    assert.equal(path.router.toLowerCase(), SLIPSTREAM_SWAP_ROUTER.toLowerCase());
    assert.notEqual(path.quoter.toLowerCase(), BASE_QUOTER_V2.toLowerCase());
    assert.notEqual(path.router.toLowerCase(), UNISWAP_SWAP_ROUTER02_BASE.toLowerCase());
    assert.equal(path.uniQuoterV2, null);

    const uniMiss = { amountOut: 0n };
    const slipOk = { amountOut: 123n };
    const chosen = rotateHomeBuyUsesSlipstream(OPERATOR_ROTATE_BUY_REASON, "HOME")
      ? slipOk
      : uniMiss;
    assert.equal(chosen.amountOut, 123n, "rotate HOME buy must not depend on QuoterV2 success");
  });

  it("QuoterV2 miss cooldown does not block rotate HOME", () => {
    const store = Object.create(null);
    const t0 = 1_700_000_000_000;
    recordSlippageFail("HOME", t0, { max: 3, cooldownMs: 27 * 60 * 1000, store });
    recordSlippageFail("HOME", t0 + 1, { max: 3, cooldownMs: 27 * 60 * 1000, store });
    const rec = recordSlippageFail("HOME", t0 + 2, { max: 3, cooldownMs: 27 * 60 * 1000, store });
    assert.equal(rec.cooled, true);
    assert.equal(isSlippageCooledDown("HOME", t0 + 3, store), true);

    assert.equal(rotateHomeBuyBypassesQuoterCooldown(OPERATOR_ROTATE_BUY_REASON, "HOME"), true);
    assert.equal(rotateHomeBuyBypassesQuoterCooldown("MANUAL BUY (operator) $3", "HOME"), false);
    assert.equal(rotateHomeBuyIgnoresUniQuoterMiss(OPERATOR_ROTATE_BUY_REASON, "HOME"), true);
    assert.equal(rotateHomeBuyIgnoresUniQuoterMiss("🎯 MIN TROUGH", "HOME"), false);

    clearRotateHomeQuoterCooldown("HOME", (sym) => clearSlippageFails(sym, store));
    assert.equal(isSlippageCooledDown("HOME", t0 + 3, store), false, "cooldown cleared so rotate can fire immediately");
    assert.equal(isBuyFrozen("HOME", store), true, "HOME freeze row stays; rotate only bypasses");
  });
});

