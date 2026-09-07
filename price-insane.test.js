import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { spotOutWei, toWei } from "./swap-minout.js";
import {
  BASE_QUOTER_V2,
  INVALID_BASE_QUOTER_V2,
  ETHEREUM_QUOTER_V2,
  PRICE_INSANE_MIN_RATIO,
  PRICE_INSANE_MAX_RATIO,
  RISK_START_USD_DEFAULT,
  BAG_VS_RISK_MULT,
  SLIP_RETRY_MAX,
  TOSHI_MOONSHOT_MARK_USD,
  TOSHI_GECKO_SPOT_USD,
  TOSHI_BAG_UNITS,
  markRatio,
  impliedBagUsd,
  evaluatePriceInsane,
  noteLastSaneUsd,
  getLastSaneUsd,
  pickPriceReference,
  sanitizeIndependentUsd,
  isPriceJumpInsane,
  recordPriceInsaneRefuse,
  isPriceInsaneCooledDown,
  shouldLogPriceInsane,
  markPriceInsaneLogged,
  peekPriceInsaneBackoff,
  clearPriceInsaneBackoff,
  isTooLittleReceived,
  isSlippageCooledDown,
  recordSlippageFail,
  clearSlippageFails,
  slippageFailLog,
  slippageCooldownLog,
  isSuccessfulSellFill,
  failedFillLog,
  isSuccessfulBuyFill,
  failedBuyFillLog,
  sellFillIsWin,
  isBaseQuoterV2,
} from "./price-insane.js";

const root = dirname(fileURLToPath(import.meta.url));

describe("Base QuoterV2 address (Uniswap official Base deployments)", () => {
  it("is the documented Uniswap V3 QuoterV2 on Base mainnet", () => {
    // https://developers.uniswap.org/docs/protocols/v3/deployments/v3-base-deployments
    assert.equal(
      BASE_QUOTER_V2.toLowerCase(),
      "0x3d4e44eb1374240ce5f1b871ab261cd16335b76a"
    );
    assert.ok(isBaseQuoterV2(BASE_QUOTER_V2));
    assert.ok(isBaseQuoterV2("0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a"));
  });

  it("rejects the garbled / wrong-chain address that was calling Base", () => {
    assert.notEqual(
      BASE_QUOTER_V2.toLowerCase(),
      INVALID_BASE_QUOTER_V2.toLowerCase()
    );
    assert.equal(
      INVALID_BASE_QUOTER_V2.toLowerCase(),
      "0x3d4e44eb1374240ce5f1b136041212501e4a098e"
    );
    assert.equal(isBaseQuoterV2(INVALID_BASE_QUOTER_V2), false);
    assert.equal(isBaseQuoterV2(ETHEREUM_QUOTER_V2), false);
  });
});

describe("PRICE_INSANE — live TOSHI $69729 moonshot", () => {
  it("rejects mark $69729 vs Gecko/Dex $0.000122 (would have blocked the 91k WETH floor)", () => {
    const r = evaluatePriceInsane({
      symbol: "TOSHI",
      markUsd: TOSHI_MOONSHOT_MARK_USD,
      independentUsd: TOSHI_GECKO_SPOT_USD,
      balance: TOSHI_BAG_UNITS,
      side: "sell",
    });
    assert.equal(r.allow, false);
    assert.equal(r.code, "PRICE_INSANE");
    assert.equal(r.reason, "ratio");
    assert.ok(r.ratio > PRICE_INSANE_MAX_RATIO);
    assert.match(r.log, /PRICE_INSANE/);
    assert.match(r.log, /fantasy/);
    // Prove the quote-fallback that this gate must never let run:
    const fantasyOut = spotOutWei({
      amountInHuman: TOSHI_BAG_UNITS,
      inUsd: TOSHI_MOONSHOT_MARK_USD,
      outUsd: 3250,
      outDecimals: 18,
    });
    assert.ok(fantasyOut > toWei(90_000, 18), "insane mark implies ~91k WETH");
    assert.ok(fantasyOut < toWei(95_000, 18));
  });

  it("rejects implied bag ≫ RISK start even without an independent quote", () => {
    const r = evaluatePriceInsane({
      symbol: "TOSHI",
      markUsd: TOSHI_MOONSHOT_MARK_USD,
      independentUsd: null,
      lastSaneUsd: null,
      balance: TOSHI_BAG_UNITS,
      riskStart: RISK_START_USD_DEFAULT,
      bagMult: BAG_VS_RISK_MULT,
      side: "sell",
    });
    assert.equal(r.allow, false);
    assert.equal(r.reason, "bag");
    assert.ok(r.bagUsd > RISK_START_USD_DEFAULT * BAG_VS_RISK_MULT);
    assert.match(r.log, /implied bag/);
  });

  it("rejects mark vs last sane seed when Dex/Gecko is missing this cycle", () => {
    const r = evaluatePriceInsane({
      symbol: "TOSHI",
      markUsd: TOSHI_MOONSHOT_MARK_USD,
      independentUsd: null,
      lastSaneUsd: TOSHI_GECKO_SPOT_USD,
      balance: TOSHI_BAG_UNITS,
      side: "sell",
    });
    assert.equal(r.allow, false);
    assert.equal(r.reason, "ratio");
    assert.equal(r.refSrc, "last-sane");
  });

  it("allows a sane TOSHI mark vs Gecko/Dex in-band", () => {
    const r = evaluatePriceInsane({
      symbol: "TOSHI",
      markUsd: 0.000125,
      independentUsd: TOSHI_GECKO_SPOT_USD,
      balance: TOSHI_BAG_UNITS,
      side: "sell",
    });
    assert.equal(r.allow, true);
    assert.equal(r.code, null);
    assert.equal(r.log, null);
    assert.ok(r.ratio >= PRICE_INSANE_MIN_RATIO);
    assert.ok(r.ratio <= PRICE_INSANE_MAX_RATIO);
    assert.ok(r.bagUsd < RISK_START_USD_DEFAULT * BAG_VS_RISK_MULT);
  });

  it("allows a high unit price when independent agrees (CBBTC-class)", () => {
    const r = evaluatePriceInsane({
      symbol: "CBBTC",
      markUsd: 110_000,
      independentUsd: 108_000,
      balance: 0.0002, // ~$22 bag
      side: "buy",
    });
    assert.equal(r.allow, true);
    assert.ok(r.ratio > 0.9 && r.ratio < 1.1);
  });

  it("refuses a missing/zero mark so hitch cannot run on $0", () => {
    const r = evaluatePriceInsane({ symbol: "TOSHI", markUsd: 0, balance: 100 });
    assert.equal(r.allow, false);
    assert.equal(r.reason, "no-mark");
  });

  it("prefers live Dex/Gecko over last sane when both exist", () => {
    const ref = pickPriceReference({
      independentUsd: TOSHI_GECKO_SPOT_USD,
      lastSaneUsd: 0.0002,
    });
    assert.equal(ref.src, "dex/gecko");
    assert.equal(ref.usd, TOSHI_GECKO_SPOT_USD);
  });

  it("rejects a $69729 dex quote as independent; accepts sane ~1.2e-4", () => {
    const junk = sanitizeIndependentUsd(TOSHI_MOONSHOT_MARK_USD, {
      lastSaneUsd: TOSHI_GECKO_SPOT_USD,
    });
    assert.equal(junk.rejected, true);
    assert.equal(junk.usd, null);
    assert.equal(junk.vs, "last-sane");

    const sane = sanitizeIndependentUsd(0.0001216, {
      lastSaneUsd: TOSHI_GECKO_SPOT_USD,
    });
    assert.equal(sane.rejected, false);
    assert.ok(sane.usd > 1e-4 && sane.usd < 1.5e-4);

    const vsEth = sanitizeIndependentUsd(TOSHI_MOONSHOT_MARK_USD, {
      ethNormalizedUsd: 0.0001216,
    });
    assert.equal(vsEth.rejected, true);
    assert.equal(vsEth.vs, "eth-normalized");
  });

  it("refuses when mark and independent are both $69729 vs last sane / ETH-normalized", () => {
    const r = evaluatePriceInsane({
      symbol: "TOSHI",
      markUsd: TOSHI_MOONSHOT_MARK_USD,
      independentUsd: TOSHI_MOONSHOT_MARK_USD,
      lastSaneUsd: TOSHI_GECKO_SPOT_USD,
      ethNormalizedUsd: TOSHI_GECKO_SPOT_USD,
      balance: TOSHI_BAG_UNITS,
      side: "sell",
    });
    assert.equal(r.allow, false);
    assert.equal(r.code, "PRICE_INSANE");
    assert.equal(r.reason, "ratio");
    assert.equal(r.independentRejected, true);
    assert.ok(r.refSrc === "last-sane" || r.refSrc === "eth-normalized");
    assert.notEqual(r.refSrc, "dex/gecko");
    assert.ok(r.refUsd < 0.001);
    assert.match(r.log, /last-sane|eth-normalized/);
    assert.doesNotMatch(r.log, /dex\/gecko \$69729/);
  });

  it("does not treat junk independent as the reference when last sane exists", () => {
    const ref = pickPriceReference({
      independentUsd: null, // already sanitized away
      lastSaneUsd: TOSHI_GECKO_SPOT_USD,
      ethNormalizedUsd: TOSHI_GECKO_SPOT_USD,
    });
    assert.equal(ref.src, "last-sane");
    assert.equal(ref.usd, TOSHI_GECKO_SPOT_USD);
  });
});

describe("last sane seed store", () => {
  it("stores a first good quote and refuses to overwrite with a moonshot", () => {
    const store = Object.create(null);
    assert.equal(noteLastSaneUsd("TOSHI", TOSHI_GECKO_SPOT_USD, store), true);
    assert.equal(getLastSaneUsd("toshi", store), TOSHI_GECKO_SPOT_USD);
    assert.equal(noteLastSaneUsd("TOSHI", TOSHI_MOONSHOT_MARK_USD, store), false);
    assert.equal(getLastSaneUsd("TOSHI", store), TOSHI_GECKO_SPOT_USD);
  });

  it("lets a trusted WETH/USDC pool replace an untrusted cached fantasy", () => {
    const store = Object.create(null);
    assert.equal(noteLastSaneUsd("TOSHI", TOSHI_MOONSHOT_MARK_USD, store, { trusted: false }), true);
    assert.equal(noteLastSaneUsd("TOSHI", TOSHI_GECKO_SPOT_USD, store, { trusted: true }), true);
    assert.equal(getLastSaneUsd("TOSHI", store), TOSHI_GECKO_SPOT_USD);
    assert.equal(noteLastSaneUsd("TOSHI", TOSHI_MOONSHOT_MARK_USD, store, { trusted: true }), false);
    assert.equal(getLastSaneUsd("TOSHI", store), TOSHI_GECKO_SPOT_USD);
  });
});

describe("PRICE_INSANE log / retry backoff", () => {
  it("still refuses during backoff and does not re-log every minute", () => {
    const store = Object.create(null);
    const t0 = 5_000_000;
    const decision = { allow: false, code: "PRICE_INSANE", reason: "ratio" };
    recordPriceInsaneRefuse("TOSHI", decision, t0, { retryMs: 10 * 60 * 1000, store });
    markPriceInsaneLogged("TOSHI", t0, store);
    assert.equal(isPriceInsaneCooledDown("TOSHI", t0 + 60_000, store), true);
    assert.equal(shouldLogPriceInsane("TOSHI", t0 + 60_000, { logMs: 15 * 60 * 1000, store }), false);
    assert.equal(peekPriceInsaneBackoff("TOSHI", store).lastDecision.code, "PRICE_INSANE");
    assert.equal(isPriceInsaneCooledDown("TOSHI", t0 + 11 * 60 * 1000, store), false);
    assert.equal(shouldLogPriceInsane("TOSHI", t0 + 16 * 60 * 1000, { logMs: 15 * 60 * 1000, store }), true);
    clearPriceInsaneBackoff("TOSHI", store);
    assert.equal(isPriceInsaneCooledDown("TOSHI", t0 + 12 * 60 * 1000, store), false);
  });

  it("flags a 100× mark jump as insane", () => {
    assert.equal(isPriceJumpInsane(TOSHI_MOONSHOT_MARK_USD, TOSHI_GECKO_SPOT_USD), true);
    assert.equal(isPriceJumpInsane(0.000125, TOSHI_GECKO_SPOT_USD), false);
    assert.equal(isPriceJumpInsane(0, TOSHI_GECKO_SPOT_USD), false);
  });
});

describe("Too little received retry cooldown", () => {
  it("cools down after N=3 consecutive fails and lifts after the window", () => {
    const store = Object.create(null);
    const t0 = 1_000_000;
    const a = recordSlippageFail("TOSHI", t0, { max: 3, cooldownMs: 60_000, store });
    assert.equal(a.count, 1);
    assert.equal(a.cooled, false);
    assert.equal(isSlippageCooledDown("TOSHI", t0, store), false);
    const b = recordSlippageFail("TOSHI", t0 + 1000, { max: 3, cooldownMs: 60_000, store });
    assert.equal(b.count, 2);
    const c = recordSlippageFail("TOSHI", t0 + 2000, { max: 3, cooldownMs: 60_000, store });
    assert.equal(c.count, 3);
    assert.equal(c.cooled, true);
    assert.equal(isSlippageCooledDown("TOSHI", t0 + 2000, store), true);
    assert.match(slippageCooldownLog("TOSHI", t0 + 2000, store), /cooldown/);
    assert.match(slippageFailLog("TOSHI", c), /cooldown armed/);
    // still cooled mid-window
    assert.equal(isSlippageCooledDown("TOSHI", t0 + 30_000, store), true);
    // after window (armed at t0+2000 for 60s → expires t0+62000), next fail starts fresh
    const d = recordSlippageFail("TOSHI", t0 + 63_000, { max: 3, cooldownMs: 60_000, store });
    assert.equal(d.count, 1);
    assert.equal(d.cooled, false);
    assert.equal(isSlippageCooledDown("TOSHI", t0 + 63_000, store), false);
  });

  it("clears on a successful fill so a later isolated revert does not inherit the streak", () => {
    const store = Object.create(null);
    recordSlippageFail("TOSHI", 1, { max: 3, store });
    recordSlippageFail("TOSHI", 2, { max: 3, store });
    clearSlippageFails("TOSHI", store);
    assert.equal(isSlippageCooledDown("TOSHI", 3, store), false);
    const r = recordSlippageFail("TOSHI", 4, { max: 3, store });
    assert.equal(r.count, 1);
  });

  it("matches the Uniswap Too little received revert text", () => {
    assert.equal(isTooLittleReceived(new Error("execution reverted: Too little received")), true);
    assert.equal(isTooLittleReceived("Too little received"), true);
    assert.equal(isTooLittleReceived(new Error("insufficient funds")), false);
  });
});

describe("failed swap is never a win", () => {
  it("0 ETH received is not a successful fill", () => {
    assert.equal(isSuccessfulSellFill({ received: 0, receiptStatus: "success" }), false);
    assert.equal(isSuccessfulSellFill({ received: 0.000000, receiptStatus: "unknown" }), false);
    assert.equal(isSuccessfulSellFill({ received: 0.001, receiptStatus: "reverted" }), false);
    assert.equal(isSuccessfulSellFill({ received: 0.001, receiptStatus: "success" }), true);
    assert.equal(isSuccessfulBuyFill({ receivedTokens: 0, receiptStatus: "success" }), false);
    assert.equal(isSuccessfulBuyFill({ receivedTokens: 0, receiptStatus: "unknown" }), false);
    assert.equal(isSuccessfulBuyFill({ receivedTokens: 12, receiptStatus: "reverted" }), false);
    assert.equal(isSuccessfulBuyFill({ receivedTokens: 12, receiptStatus: "success" }), true);
    assert.equal(sellFillIsWin(0, 12), false);
    assert.equal(sellFillIsWin(0.01, -1), false);
    assert.equal(sellFillIsWin(0.01, 0.5), true);
    assert.match(failedFillLog("TOSHI", { received: 0, txHash: "0xabc" }), /not a win/);
    assert.match(failedBuyFillLog("AERO", { receivedTokens: 0, txHash: "0xdef" }), /not a win/);
  });
});

describe("helpers", () => {
  it("markRatio / impliedBagUsd guard junk", () => {
    assert.equal(markRatio(69729, 0.000122) > 1e8, true);
    assert.equal(markRatio(0, 1), null);
    assert.equal(impliedBagUsd(TOSHI_BAG_UNITS, TOSHI_MOONSHOT_MARK_USD) > 300_000_000, true);
    assert.equal(impliedBagUsd(0, 1), 0);
  });
});

describe("agent.js wiring — PRICE_INSANE before hitch / minOut, no 0-ETH win", () => {
  const src = readFileSync(join(root, "agent.js"), "utf8");

  it("imports PRICE_INSANE + Base QuoterV2 and does not hardcode the invalid address", () => {
    assert.ok(src.includes("evaluatePriceInsane"), "must import evaluatePriceInsane");
    assert.ok(src.includes("BASE_QUOTER_V2"), "must use BASE_QUOTER_V2");
    assert.ok(!src.includes(INVALID_BASE_QUOTER_V2), "must not call the garbled Quoter address");
    assert.match(src, /QUOTER_V2\s*=\s*BASE_QUOTER_V2/);
  });

  it("runs PRICE_INSANE in executeBuy and executeSell before hitch / minOut", () => {
    const sellFn = src.indexOf("async function executeSell(");
    const buyFn = src.indexOf("async function executeBuy(");
    const sellEnd = src.indexOf("\nasync function ", sellFn + 1);
    const buyEnd = src.indexOf("\nasync function ", buyFn + 1);
    const sellBody = src.slice(sellFn, sellEnd);
    const buyBody = src.slice(buyFn, buyEnd);
    const sellInsane = sellBody.indexOf("gatePriceInsane");
    const buyInsane = buyBody.indexOf("gatePriceInsane");
    const sellPiggy = sellBody.indexOf("applyPiggyToSell");
    const sellHitch = sellBody.indexOf("buildSellGateDecision");
    const buyHitch = buyBody.indexOf("buildBuyGateDecision");
    const sellMin = sellBody.indexOf("sanitizeAmountOutMinimum");
    const buyMin = buyBody.indexOf("sanitizeAmountOutMinimum");
    assert.ok(sellInsane >= 0 && sellInsane < sellPiggy, "sell PRICE_INSANE before piggy");
    assert.ok(sellInsane < sellHitch, "sell PRICE_INSANE before hitch");
    assert.ok(sellInsane < sellMin, "sell PRICE_INSANE before minOut");
    assert.ok(buyInsane >= 0 && buyInsane < buyHitch, "buy PRICE_INSANE before hitch");
    assert.ok(buyInsane < buyMin, "buy PRICE_INSANE before minOut");
    assert.ok(sellBody.includes("isSlippageCooledDown"), "sell must honor Too-little-received cooldown");
    assert.ok(sellBody.includes("isSuccessfulSellFill"), "sell must refuse 0-ETH success");
    assert.ok(buyBody.includes("isSuccessfulBuyFill"), "buy must refuse 0-token success");
    assert.ok(buyBody.includes("getSwapReceiptStatus"), "buy must wait for receipt");
    assert.ok(sellBody.includes("recordSlippageFail"), "Too little received must increment the streak");
    assert.ok(src.includes("isPriceInsaneCooledDown"), "PRICE_INSANE backoff must skip re-attempt");
    assert.ok(src.includes("trustedQuote") || src.includes("verifiedPool"), "must honor verified WETH/USDC pool quotes");
    assert.ok(src.includes("isPriceJumpInsane"), "must not cache a 100× fantasy into the mark");
    assert.ok(src.includes("buildSellGateDecision"), "2× hitch stays");
    assert.ok(src.includes("isCatalogFrozen(token)"), "frozen buy gate stays");
    assert.ok(src.includes("sanitizeAmountOutMinimum"), "minOut sanitize stays");
    assert.ok(src.includes("applyPiggyToSell"), "piggy dust stays");
  });

  it("declares netUsd / received before the BTP strand sell block (no TDZ)", () => {
    const sellFn = src.indexOf("async function executeSell(");
    const sellEnd = src.indexOf("\nasync function ", sellFn + 1);
    const body = src.slice(sellFn, sellEnd);
    const receivedDecl = body.search(/\b(let|const) received\b/);
    const recUsdDecl = body.search(/\bconst recUsd\b/);
    const netUsdDecl = body.search(/\bconst netUsd\b/);
    const btpBlock = body.indexOf("BTP STRAND RECEIPT — sell");
    assert.ok(receivedDecl >= 0 && recUsdDecl >= 0 && netUsdDecl >= 0, "fill math must be declared");
    assert.ok(btpBlock >= 0, "BTP strand sell block must remain");
    assert.ok(receivedDecl < btpBlock, "received before BTP");
    assert.ok(recUsdDecl < btpBlock, "recUsd before BTP");
    assert.ok(netUsdDecl < btpBlock, "netUsd before BTP (TDZ fix)");
  });
});
