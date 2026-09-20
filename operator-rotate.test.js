import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  VERIFIED_HOME_ADDRESS,
  VERIFIED_HOME_SYMBOL,
  HOME_FEE_TIER,
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
  verifiedHomeCatalogRow,
} from "./operator-rotate.js";
import {
  canBypassSellLossGate,
  consumeAllowLossyOperatorSell,
  evaluateSellGate,
} from "./lose-zero-gate.js";
import { applyPiggyToSell } from "./piggy-bank.js";
import { hasSellableUsd, SELLABLE_MIN_USD } from "./cost-edge-gate.js";

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
