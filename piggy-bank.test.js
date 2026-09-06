import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PIGGY_UNLOCK_PREFIX,
  DEFAULT_PIGGY_BANK_PCT,
  DEFAULT_PIGGY_BANK_MIN_USD,
  isPiggyUnlock,
  piggyUnlockReason,
  piggyBankPct,
  piggyBankMinUsd,
  sanitizePiggyReserve,
  computePiggyTarget,
  ratchetPiggyReserve,
  computeSellable,
  remainingPiggyAfterSell,
  applyPiggyToSell,
  parsePiggyUnlockCommand,
  loadPiggyReserve,
} from "./piggy-bank.js";

const root = dirname(fileURLToPath(import.meta.url));

describe("piggy config defaults", () => {
  it("defaults to 2% and a $0.05 USD floor", () => {
    assert.equal(DEFAULT_PIGGY_BANK_PCT, 0.02);
    assert.equal(DEFAULT_PIGGY_BANK_MIN_USD, 0.05);
    assert.equal(piggyBankPct({}), 0.02);
    assert.equal(piggyBankMinUsd({}), 0.05);
  });

  it("accepts fraction or percent for PIGGY_BANK_PCT", () => {
    assert.equal(piggyBankPct({ PIGGY_BANK_PCT: "0.03" }), 0.03);
    assert.equal(piggyBankPct({ PIGGY_BANK_PCT: "2" }), 0.02);
    assert.equal(piggyBankPct({ PIGGY_BANK_PCT: "5" }), 0.05);
    assert.equal(piggyBankPct({ PIGGY_BANK_PCT: "nope" }), 0.02);
    assert.equal(piggyBankPct({ PIGGY_BANK_PCT: "0" }), 0);
  });

  it("honors PIGGY_BANK_MIN_USD including 0 to disable the floor", () => {
    assert.equal(piggyBankMinUsd({ PIGGY_BANK_MIN_USD: "0.10" }), 0.10);
    assert.equal(piggyBankMinUsd({ PIGGY_BANK_MIN_USD: "0" }), 0);
    assert.equal(piggyBankMinUsd({ PIGGY_BANK_MIN_USD: "nope" }), 0.05);
  });
});

describe("sell leaves dust", () => {
  const env = { PIGGY_BANK_PCT: "0.02", PIGGY_BANK_MIN_USD: "0" };

  it("a 50% sell leaves the reserve untouched", () => {
    const d = applyPiggyToSell({
      balance: 1000,
      sellPct: 0.5,
      piggyReserve: 20,
      priceUsd: 1,
      reason: "🎯 MAX PEAK",
      env,
    });
    assert.equal(d.unlock, false);
    assert.equal(d.reserve, 20);
    assert.equal(d.sellable, 980);
    assert.equal(d.tokensToSell, 490);
    assert.equal(d.remainingBalance, 510);
    assert.equal(d.remainingReserve, 20);
    assert.ok(d.remainingBalance - d.tokensToSell >= d.remainingReserve - 1e-9);
  });

  it("wave / fib / stale / moonshot reasons cannot eat the reserve", () => {
    for (const reason of [
      "🎯 MAX PEAK $1",
      "📐 FIB 1.618",
      "⏰ STALE CASCADE — 8min no movement",
      "🌙 MOONSHOT TRIM — not in active tiers",
      "MANUAL SELL (operator)",
      "MANUAL SELL HALF",
      "CLEAN EXIT 100%",
      "STOP LOSS",
    ]) {
      const d = applyPiggyToSell({
        balance: 500,
        sellPct: 1,
        piggyReserve: 10,
        priceUsd: 1,
        reason,
        env,
      });
      assert.equal(d.tokensToSell, 490, reason);
      assert.equal(d.remainingReserve, 10, reason);
      assert.equal(d.remainingBalance, 10, reason);
    }
  });
});

describe("cannot sell 100% if piggy set", () => {
  const env = { PIGGY_BANK_PCT: "0.02", PIGGY_BANK_MIN_USD: "0" };

  it("sellPct=1 still leaves the dust pile", () => {
    const d = applyPiggyToSell({
      balance: 1000,
      sellPct: 1,
      piggyReserve: 20,
      priceUsd: 1,
      reason: "MANUAL SELL (operator)",
      env,
    });
    assert.ok(d.tokensToSell < 1000);
    assert.equal(d.tokensToSell, 980);
    assert.equal(d.soldAll, false);
    assert.equal(d.remainingReserve, 20);
    assert.equal(d.blocked, false);
  });

  it("blocks when only the piggy pile remains", () => {
    const d = applyPiggyToSell({
      balance: 20,
      sellPct: 1,
      piggyReserve: 20,
      priceUsd: 1,
      reason: "🎯 MAX PEAK",
      env,
    });
    assert.equal(d.sellable, 0);
    assert.equal(d.tokensToSell, 0);
    assert.equal(d.blocked, true);
    assert.equal(d.remainingReserve, 20);
  });
});

describe("unlock path works", () => {
  const env = { PIGGY_BANK_PCT: "0.02", PIGGY_BANK_MIN_USD: "0" };

  it("PIGGY UNLOCK prefix is required and case-insensitive", () => {
    assert.equal(isPiggyUnlock("PIGGY UNLOCK TOSHI"), true);
    assert.equal(isPiggyUnlock("piggy unlock TOSHI"), true);
    assert.equal(isPiggyUnlock("PIGGY UNLOCK"), true);
    assert.equal(isPiggyUnlock("MANUAL SELL (operator)"), false);
    assert.equal(isPiggyUnlock("CLEAN EXIT 100%"), false);
    assert.equal(piggyUnlockReason("toshi"), "PIGGY UNLOCK TOSHI");
    assert.equal(PIGGY_UNLOCK_PREFIX, "PIGGY UNLOCK");
  });

  it("unlock sellPct=1 sells the full bag including dust", () => {
    const d = applyPiggyToSell({
      balance: 1000,
      sellPct: 1,
      piggyReserve: 20,
      priceUsd: 1,
      reason: "PIGGY UNLOCK TOSHI",
      env,
    });
    assert.equal(d.unlock, true);
    assert.equal(d.sellable, 1000);
    assert.equal(d.tokensToSell, 1000);
    assert.equal(d.remainingBalance, 0);
    assert.equal(d.remainingReserve, 0);
    assert.equal(d.soldAll, true);
    assert.equal(d.blocked, false);
  });

  it("unlock partial sell may shrink reserve to remaining units", () => {
    const d = applyPiggyToSell({
      balance: 20,
      sellPct: 0.5,
      piggyReserve: 20,
      priceUsd: 1,
      reason: piggyUnlockReason("AERO"),
      env,
    });
    assert.equal(d.unlock, true);
    assert.equal(d.tokensToSell, 10);
    assert.equal(d.remainingReserve, 10);
  });

  it("parses /piggyunlock SYMBOL and ignores /piggy", () => {
    assert.deepEqual(parsePiggyUnlockCommand("/piggyunlock TOSHI"), { symbol: "TOSHI" });
    assert.deepEqual(parsePiggyUnlockCommand("/piggyunlock toshi"), { symbol: "TOSHI" });
    assert.equal(parsePiggyUnlockCommand("/piggy"), null);
    assert.equal(parsePiggyUnlockCommand("/piggyunlock"), null);
    assert.equal(parsePiggyUnlockCommand("/sell TOSHI"), null);
  });
});

describe("reserve grows with buys and never auto-shrinks", () => {
  const env = { PIGGY_BANK_PCT: "0.02", PIGGY_BANK_MIN_USD: "0" };

  it("floors up when balance grows (buy / cascade in)", () => {
    const afterOpen = ratchetPiggyReserve(0, 1000, 1, env);
    assert.equal(afterOpen, 20);
    const afterBuy = ratchetPiggyReserve(afterOpen, 2000, 1, env);
    assert.equal(afterBuy, 40);
  });

  it("does not shrink after a partial sell (high-water mark)", () => {
    const reserved = ratchetPiggyReserve(40, 1500, 1, env);
    // 2% of 1500 is 30 — existing 40 wins
    assert.equal(reserved, 40);
    const afterSell = remainingPiggyAfterSell(40, 1510, { unlock: false });
    assert.equal(afterSell, 40);
  });

  it("USD floor can lift a tiny bag above 2%", () => {
    const envFloor = { PIGGY_BANK_PCT: "0.02", PIGGY_BANK_MIN_USD: "0.05" };
    // 100 tokens @ $0.001 = $0.10 bag. 2% = 2 tokens ($0.002). Floor $0.05 = 50 tokens.
    assert.equal(computePiggyTarget(100, 0.001, envFloor), 50);
    const grown = ratchetPiggyReserve(50, 200, 0.001, envFloor);
    assert.equal(grown, 50); // $0.05 / 0.001 = 50, 2% of 200 = 4 → stay 50
  });

  it("load takes the max of tokens.json and positions.json", () => {
    assert.equal(loadPiggyReserve({ symbol: "TOSHI", piggyReserve: 10 }, { TOSHI: 25 }), 25);
    assert.equal(loadPiggyReserve({ symbol: "TOSHI", piggyReserve: 40 }, { TOSHI: 25 }), 40);
    assert.equal(sanitizePiggyReserve("nope"), 0);
    assert.equal(sanitizePiggyReserve(-3), 0);
  });
});

describe("agent.js wires piggy into every sell path", () => {
  const src = readFileSync(join(root, "agent.js"), "utf8");

  it("imports applyPiggyToSell and uses it inside executeSell", () => {
    assert.ok(src.includes("applyPiggyToSell"), "must import applyPiggyToSell");
    assert.ok(src.includes("isPiggyUnlock") || src.includes("piggyUnlockReason"), "must know the unlock reason");
    const sellFn = src.indexOf("async function executeSell(");
    const sellEnd = src.indexOf("\nasync function ", sellFn + 1);
    const body = src.slice(sellFn, sellEnd > 0 ? sellEnd : sellFn + 8000);
    assert.ok(body.includes("applyPiggyToSell"), "executeSell must call applyPiggyToSell");
    assert.ok(body.includes("buildSellGateDecision"), "hitch sell floor must stay after piggy sizing");
    assert.ok(body.includes("piggy.tokensToSell"), "sell size must be piggy-capped tokens");
    assert.ok(body.includes("toWei"), "minOut amount-in must use real decimals");
    assert.ok(body.includes("sanitizeAmountOutMinimum"), "minOut sanity must stay after piggy sizing");
  });

  it("does not skip hitch / minOut / freeze gates", () => {
    assert.ok(src.includes("buildSellGateDecision"), "2× hitch floor stays");
    assert.ok(src.includes("sanitizeAmountOutMinimum"), "minOut sanity stays");
    assert.ok(src.includes("SLIPPAGE_GUARD"), "slippage band stays");
    assert.ok(src.includes("isCatalogFrozen(token)"), "frozen buy gate stays");
    assert.ok(src.includes("buildBuyGateDecision"), "LOSE_ZERO buy gate stays");
    const sellFn = src.indexOf("async function executeSell(");
    const sellEnd = src.indexOf("\nasync function ", sellFn + 1);
    const body = src.slice(sellFn, sellEnd > 0 ? sellEnd : sellFn + 8000);
    assert.ok(!body.includes("isCatalogFrozen"), "executeSell must stay open on frozen names");
    const piggy = body.indexOf("applyPiggyToSell");
    const hitch = body.indexOf("buildSellGateDecision");
    const minOut = body.indexOf("sanitizeAmountOutMinimum");
    const encode = body.indexOf("encodeSwap(");
    assert.ok(piggy >= 0 && hitch > piggy, "piggy sizes the bag before the hitch floor");
    assert.ok(minOut > hitch, "minOut sanity runs after hitch");
    assert.ok(encode > minOut, "encodeSwap must not fire before minOut sanity");
  });

  it("Telegram /piggyunlock queues the unlock sell", () => {
    assert.ok(src.includes("parsePiggyUnlockCommand"), "telegram must parse /piggyunlock");
    assert.ok(src.includes('action: "piggyunlock"') || src.includes('action:"piggyunlock"'), "must queue piggyunlock");
    const fnStart = src.indexOf("async function processToken(");
    assert.ok(fnStart >= 0);
    const fnEnd = src.indexOf("\nasync function runPredFundTick(", fnStart);
    const fn = src.slice(fnStart, fnEnd > 0 ? fnEnd : fnStart + 80000);
    assert.ok(fn.includes('cmd.action === "piggyunlock"'), "processToken must handle piggyunlock");
  });

  it("executeBuy ratchets the reserve after a fill", () => {
    const buyFn = src.indexOf("async function executeBuy(");
    const nextFn = src.indexOf("\nasync function ", buyFn + 1);
    const body = src.slice(buyFn, nextFn > 0 ? nextFn : buyFn + 4000);
    assert.ok(body.includes("ratchetPiggyReserve"), "buy path must floor-up piggy");
  });
});
