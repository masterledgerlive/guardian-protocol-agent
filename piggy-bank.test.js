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
  costBasisForSoldFraction,
  previewPiggySellNetUsd,
  buildTokenPiggyLedger,
  creditTokenPiggyPools,
  piggyCoInvestMarkUsd,
  piggyEarningsBufferPct,
  piggyEarningsAfterMessage,
  DEFAULT_PIGGY_EARNINGS_BUFFER_PCT,
  earningsToBankUsd,
  projectBuyEarningsPlan,
  effectiveSavedEarningsUsd,
  creditPiggySavedEarnings,
  formatBuyReceiptHtml,
  formatSellReceiptHtml,
} from "./piggy-bank.js";

const root = dirname(fileURLToPath(import.meta.url));

describe("piggy config defaults", () => {
  it("defaults to 5% dust, $0.15 floor, and 5% earnings buffer", () => {
    assert.equal(DEFAULT_PIGGY_BANK_PCT, 0.05);
    assert.equal(DEFAULT_PIGGY_BANK_MIN_USD, 0.15);
    assert.equal(DEFAULT_PIGGY_EARNINGS_BUFFER_PCT, 0.05);
    assert.equal(piggyBankPct({}), 0.05);
    assert.equal(piggyBankMinUsd({}), 0.15);
    assert.equal(piggyEarningsBufferPct({}), 0.05);
  });

  it("accepts fraction or percent for PIGGY_BANK_PCT", () => {
    assert.equal(piggyBankPct({ PIGGY_BANK_PCT: "0.03" }), 0.03);
    assert.equal(piggyBankPct({ PIGGY_BANK_PCT: "2" }), 0.02);
    assert.equal(piggyBankPct({ PIGGY_BANK_PCT: "5" }), 0.05);
    assert.equal(piggyBankPct({ PIGGY_BANK_PCT: "nope" }), 0.05);
    assert.equal(piggyBankPct({ PIGGY_BANK_PCT: "0" }), 0);
  });

  it("honors per-symbol env and catalog overrides (LINK favorite 8%)", () => {
    assert.equal(piggyBankPct({ PIGGY_BANK_PCT: "5", PIGGY_BANK_PCT_LINK: "8" }, { symbol: "LINK" }), 0.08);
    assert.equal(piggyBankPct({ PIGGY_BANK_PCT: "5" }, { symbol: "LINK", piggyBankPct: 0.08 }), 0.08);
    assert.equal(piggyBankPct({ PIGGY_BANK_PCT: "5", PIGGY_BANK_PCT_LINK: "8" }, { symbol: "UNI" }), 0.05);
    assert.equal(piggyBankMinUsd({ PIGGY_BANK_MIN_USD: "0.15", PIGGY_BANK_MIN_USD_LINK: "0.25" }, { symbol: "LINK" }), 0.25);
    const target = computePiggyTarget(100, 1, { PIGGY_BANK_PCT: "5", PIGGY_BANK_MIN_USD: "0" }, { symbol: "LINK", piggyBankPct: 0.08 });
    assert.equal(target, 8);
  });

  it("honors PIGGY_BANK_MIN_USD including 0 to disable the floor", () => {
    assert.equal(piggyBankMinUsd({ PIGGY_BANK_MIN_USD: "0.10" }), 0.10);
    assert.equal(piggyBankMinUsd({ PIGGY_BANK_MIN_USD: "0" }), 0);
    assert.equal(piggyBankMinUsd({ PIGGY_BANK_MIN_USD: "nope" }), 0.15);
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

  it("USD floor lifts bags that can afford it; crumbs stay pct-only", () => {
    const envFloor = { PIGGY_BANK_PCT: "0.05", PIGGY_BANK_MIN_USD: "0.15" };
    // $5 bag @ $1 — 5% = 0.25, floor $0.15 → 0.25 tokens
    assert.equal(computePiggyTarget(5, 1, envFloor), 0.25);
    // Live crumb $0.02 — floor must NOT 100%-lock the bag (was listing money, sellable 0)
    const crumb = computePiggyTarget(119, 0.0001707, envFloor);
    assert.ok(crumb < 119, "crumb must remain partially sellable");
    assert.equal(crumb, 119 * 0.05);
    const d = applyPiggyToSell({
      balance: 119,
      sellPct: 1,
      piggyReserve: 0,
      priceUsd: 0.0001707,
      reason: "🎯 MAX PEAK",
      env: envFloor,
    });
    assert.equal(d.blocked, false);
    assert.ok(d.tokensToSell > 0);
  });

  it("earnings-after-message never lists a wiped gain", () => {
    const wiped = piggyEarningsAfterMessage({
      netUsd: 0.04,
      hitchCostUsd: 0.05,
      proceedsUsd: 5,
      bufferPct: 0.05,
    });
    assert.ok(wiped.earningsUsd < 0);
    assert.equal(wiped.gains, false);
    assert.equal(wiped.neverLose, false);

    const clear = piggyEarningsAfterMessage({
      netUsd: 0.40,
      hitchCostUsd: 0.05,
      proceedsUsd: 5,
      bufferPct: 0.05,
    });
    assert.ok(clear.earningsUsd > clear.needUsd);
    assert.equal(clear.gains, true);
  });

  it("preview includes hitch earnings so peak gates refuse message-wiped nets", () => {
    const preview = previewPiggySellNetUsd({
      balance: 100,
      sellable: 95,
      investedEth: 0.002,
      priceUsd: 1,
      ethUsd: 2500,
      feePct: 0.006,
      skimPct: 0.01,
      hitchCostUsd: 0.20,
      earningsBufferPct: 0.05,
    });
    assert.equal(preview.soldFrac, 0.95);
    assert.equal(preview.hitchCostUsd, 0.20);
    assert.equal(preview.earningsUsd, preview.netUsd - 0.20);
    assert.equal(preview.gains, preview.earningsUsd > preview.earningsNeedUsd && preview.earningsUsd > 0);
  });

  it("saved earnings ratchet leaves more than the $0.15 floor (AERO $0.27 case)", () => {
    // Prior piggy at floor $0.15; bank +$0.12 bear-min → target $0.27 of AERO dust.
    const price = 0.50;
    const bal = 10; // $5 bag — can afford floor + savings
    const env = { PIGGY_BANK_PCT: "0.05", PIGGY_BANK_MIN_USD: "0.15" };
    const floorOnly = computePiggyTarget(bal, price, env, {});
    assert.ok(Math.abs(floorOnly * price - 0.15) < 1e-9 || floorOnly * price >= 0.15);

    const targetSaved = 0.27;
    const withSaved = computePiggyTarget(bal, price, env, { savedEarningsUsd: targetSaved });
    assert.ok(withSaved * price + 1e-9 >= 0.27, `dust USD ${withSaved * price} should cover $0.27`);
    assert.ok(withSaved > floorOnly, "saved earnings must size above the floor alone");

    const d = applyPiggyToSell({
      balance: bal,
      sellPct: 1,
      piggyReserve: floorOnly,
      priceUsd: price,
      reason: "🎯 MAX PEAK",
      env,
      savedEarningsUsd: targetSaved,
    });
    assert.ok(d.remainingReserve * price + 1e-9 >= 0.27);
    assert.ok(d.tokensToSell < bal - floorOnly + 1e-9 || d.remainingReserve >= targetSaved / price - 1e-9);
  });

  it("earningsToBankUsd banks bear min not full wave profit", () => {
    assert.equal(earningsToBankUsd({ earningsUsd: 1.0, needUsd: 0.12, gains: true }), 0.12);
    assert.equal(earningsToBankUsd({ earningsUsd: 0.08, needUsd: 0.12, gains: true }), 0.08);
    assert.equal(earningsToBankUsd({ earningsUsd: 1.0, needUsd: 0.12, gains: false }), 0);
    assert.equal(
      earningsToBankUsd({
        earningsUsd: 0.40,
        needUsd: 0.10,
        gains: true,
        projectedEarningsUsd: 0.12,
      }),
      0.12,
    );
  });

  it("buy plan projects sell-at so fees + message + buffer never lose", () => {
    const plan = projectBuyEarningsPlan({
      entryPrice: 1,
      ethSpent: 0.001,
      ethUsd: 3000,
      tokensReceived: 3,
      feePct: 0.006,
      skimPct: 0.01,
      hitchCostUsd: 0.05,
      hitchMult: 2,
      earningsBufferPct: 0.05,
      piggyPct: 0.05,
      piggyMinUsd: 0.15,
      priorSavedUsd: 0.15,
    });
    assert.ok(plan.sellAtMin > plan.entryPrice, "sell-at must clear entry + costs");
    assert.ok(plan.projectedEarningsUsd > 0);
    assert.ok(plan.piggyAfterUsd + 1e-9 >= 0.15 + plan.projectedEarningsUsd - 1e-6 || plan.piggyAfterUsd >= plan.dustUsd);
    assert.equal(plan.neverLose, true);
    assert.ok(plan.dustUsd + 1e-9 >= 0.15, "prior saved / floor stays in dust");
  });

  it("creditPiggySavedEarnings counting add matches dust after bank", () => {
    const row = buildTokenPiggyLedger({ symbol: "AERO", dustReserve: 0.3, dustUsd: 0.15, savedEarningsUsd: 0.15 });
    assert.equal(row.savedEarningsUsd, 0.15);
    const next = creditPiggySavedEarnings(row, {
      bankedUsd: 0.12,
      dustReserve: 0.54,
      dustUsd: 0.27,
      symbol: "AERO",
    });
    assert.equal(next.savedEarningsUsd, 0.27);
    assert.equal(next.dustUsd, 0.27);
    assert.equal(effectiveSavedEarningsUsd({
      savedEarningsUsd: next.savedEarningsUsd,
      dustUsd: next.dustUsd,
      piggyMinUsd: 0.15,
    }), 0.27);
  });

  it("Telegram receipts show buy math and sell bought→sold→piggy count", () => {
    const buy = formatBuyReceiptHtml({
      symbol: "AERO",
      tradeNum: 1,
      entryPrice: 0.5,
      ethSpent: 0.001,
      spentUsd: 3,
      tokensReceived: 6,
      plan: {
        sellAtMin: 0.55,
        projectedEarningsUsd: 0.12,
        piggyAfterUsd: 0.27,
        priorSavedUsd: 0.15,
        dustUsd: 0.15,
        hitchNeedUsd: 0.10,
      },
      hitchFooter: "🔗 basescan",
    });
    assert.match(buy, /RECEIPT — buy math/);
    assert.match(buy, /Bought at/);
    assert.match(buy, /Sell at ≥/);
    assert.match(buy, /Min earn/);
    assert.match(buy, /After bank/);

    const sell = formatSellReceiptHtml({
      symbol: "AERO",
      tradeNum: 2,
      entryPrice: 0.5,
      exitPrice: 0.56,
      investedUsd: 2.5,
      receivedEth: 0.001,
      receivedUsd: 3,
      netUsd: 0.5,
      earningsUsd: 0.4,
      bankedUsd: 0.12,
      piggyDustTokens: 0.54,
      piggyDustUsd: 0.27,
      piggySavedUsd: 0.27,
      hitchFooter: "🔗 x",
    });
    assert.match(sell, /RECEIPT — bought → sold/);
    assert.match(sell, /Bought at/);
    assert.match(sell, /Sold at/);
    assert.match(sell, /Banked/);
    assert.match(sell, /Counted:\s+\$0\.270/);
    assert.match(sell, /Count matches dust/);
  });

  it("load takes the max of tokens.json and positions.json", () => {
    assert.equal(loadPiggyReserve({ symbol: "TOSHI", piggyReserve: 10 }, { TOSHI: 25 }), 25);
    assert.equal(loadPiggyReserve({ symbol: "TOSHI", piggyReserve: 40 }, { TOSHI: 25 }), 40);
    assert.equal(sanitizePiggyReserve("nope"), 0);
    assert.equal(sanitizePiggyReserve(-3), 0);
  });
});

describe("ledger math leaves dust cost behind", () => {
  it("soldFrac cost basis is proportional — not full entry", () => {
    assert.equal(costBasisForSoldFraction(1.0, 0.98), 0.98);
    assert.equal(costBasisForSoldFraction(1.0, 1), 1);
    assert.equal(costBasisForSoldFraction(1.0, 0), 0);
  });

  it("peak preview charges only sellable cost/fees so profits still clear", () => {
    // 1000 tokens, 2% piggy locked, entry 1 ETH, ETH=$2000, price=$2.10
    // Full-bag cost would look worse; sellable-only must stay green.
    const bal = 1000;
    const sellable = 980;
    const investedEth = 1;
    const priceUsd = 2.10;
    const ethUsd = 2000;
    const wrongFullCost = sellable * priceUsd - investedEth * ethUsd; // charges 100% entry
    const preview = previewPiggySellNetUsd({
      balance: bal,
      sellable,
      investedEth,
      priceUsd,
      ethUsd,
      feePct: 0.006,
      skimPct: 0.01,
    });
    assert.equal(preview.soldFrac, 0.98);
    assert.ok(preview.netUsd > 0, "piggy-aligned net should be profitable");
    assert.ok(wrongFullCost < preview.netUsd, "full-entry charge understates profit");
    assert.equal(preview.costUsd, 0.98 * ethUsd);
  });

  it("nested per-token piggy ledger accumulates eth + agent shares", () => {
    const row = buildTokenPiggyLedger({ symbol: "toshi", dustReserve: 20, dustUsd: 0.05 });
    assert.equal(row.symbol, "TOSHI");
    assert.equal(row.dustReserve, 20);
    const credited = creditTokenPiggyPools(row, { ethContrib: 0.001, agentShare: 0.0005 });
    assert.equal(credited.ethContrib, 0.001);
    assert.equal(credited.agentShare, 0.0005);
    const again = creditTokenPiggyPools(credited, { ethContrib: 0.001, agentShare: 0.0005 });
    assert.equal(again.ethContrib, 0.002);
    assert.equal(again.agentShare, 0.001);
  });

  it("co-invest mark uses tokens×price, not tokens×0", () => {
    assert.equal(piggyCoInvestMarkUsd({ tokens: 100, priceUsd: 0.05, ethIn: 0.001, ethUsd: 2000 }), 3);
    assert.equal(piggyCoInvestMarkUsd({ tokens: 100, priceUsd: 0, ethIn: 0.001, ethUsd: 2000 }), -2);
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
    assert.ok(src.includes("piggyEarningsBufferEth"), "sell gate must reserve piggy earnings buffer before hitch");
    assert.ok(src.includes("piggyEarningsAfterMessage"), "Telegram/ledger must use earnings after message");
    assert.ok(src.includes("costBasisForSoldFraction") || body.includes("entryEthSold"), "PnL must use piggy soldFrac");
    assert.ok(body.includes("soldFrac"), "ledger must record piggy-aligned soldFrac");
    assert.ok(body.includes("toWei"), "minOut amount-in must use real decimals");
    assert.ok(body.includes("sanitizeAmountOutMinimum"), "minOut sanity must stay after piggy sizing");
    assert.ok(body.includes("gatePriceInsane") || body.includes("evaluatePriceInsane"), "PRICE_INSANE must run before piggy uses the mark");
  });

  it("peak gates use previewPiggySellNetUsd so dust cost stays behind", () => {
    assert.ok(src.includes("previewPiggySellNetUsd"), "processToken must preview piggy-aligned net");
    assert.ok(src.includes("PIGGY_COINVEST_ENABLED"), "co-invest must be gated for AI reserve");
    assert.ok(src.includes("tokenPiggyLedgers"), "nested per-token piggy ledger required");
    assert.ok(src.includes("piggyCoInvestMarkUsd"), "/piggy must mark co-invest with tokens×price");
    assert.ok(!src.includes("p.tokens*0"), "must not zero co-invest mark");
  });

  it("does not skip hitch / minOut / freeze gates", () => {
    assert.ok(src.includes("buildSellGateDecision"), "2× hitch floor stays");
    assert.ok(src.includes("estimateHitchL1FeeEth") || src.includes("quoteHitchL1ForGates"), "live L1 hitch fee stays");
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
    const insane = Math.max(body.indexOf("gatePriceInsane"), body.indexOf("evaluatePriceInsane"));
    assert.ok(insane >= 0 && piggy > insane, "PRICE_INSANE before piggy uses the mark");
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
    assert.ok(body.includes("syncTokenPiggy") || body.includes("ratchetPiggyReserve"), "buy path must floor-up piggy");
    assert.ok(body.includes("projectBuyEarningsPlan"), "buy must project sell-at + bear-min earnings");
    assert.ok(body.includes("formatBuyReceiptHtml"), "buy Telegram must be a full math receipt");
  });

  it("executeSell banks earnings into piggy and sends a bought→sold receipt", () => {
    const sellFn = src.indexOf("async function executeSell(");
    const sellEnd = src.indexOf("\nasync function ", sellFn + 1);
    const body = src.slice(sellFn, sellEnd > 0 ? sellEnd : sellFn + 12000);
    assert.ok(body.includes("earningsToBankUsd"), "sell must bank bear-min earnings");
    assert.ok(body.includes("creditPiggySavedEarnings"), "sell must credit saved earnings ledger");
    assert.ok(body.includes("formatSellReceiptHtml"), "sell Telegram must be a bought→sold receipt");
    assert.ok(body.includes("savedEarningsUsd"), "piggy sizing must include saved earnings target");
  });
});
