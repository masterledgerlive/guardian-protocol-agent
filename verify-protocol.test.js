/**
 * Protocol verification — math, fill honesty, Eureka hitch, no invented buys.
 * Does not send live txs. Chain fixture KEYCAT 0x5c0a93e4… is encoded in
 * swap-minout.js (228-byte exactInputSingle, no trailing UTF-8).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  leftoverCoversInject,
  computeLeftover,
  computeFairExit,
  injectCostSpread,
  estimateInjectHitchCostEth,
  STORE_HITCH_BYTES,
  hitchCostMult,
  evaluateSellGate,
  evaluateBuyGate,
} from "./lose-zero-gate.js";
import {
  KEYCAT_PLAIN_SWAP,
  EXACT_INPUT_SINGLE_BYTES,
  decodeTrailingUtf8,
  appendUtf8Hitch,
  buildStoreVoice,
  encodingDoesNotLoseMoney,
  VITA_PROOF_FULL,
} from "./swap-minout.js";
import {
  isSuccessfulBuyFill,
  isSuccessfulSellFill,
} from "./price-insane.js";

const root = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(root, "agent.js"), "utf8");

describe("verification: math actually covers hitch without losing money", () => {
  it("leftover covering 1× hitch allows a buy; thinner leftover blocks", () => {
    const fair = computeFairExit(1, { feePct: 0.006, gasCostEth: 0.0001, tradeEth: 0.01, impactPct: 0.002 });
    const spread = injectCostSpread(1, 0.01, 1, 0);
    const leftoverOk = computeLeftover(fair + spread + 0.0001, fair, spread);
    const leftoverThin = computeLeftover(fair + spread - 0.0001, fair, spread);
    assert.equal(leftoverCoversInject(leftoverOk), true);
    assert.equal(leftoverCoversInject(leftoverThin), false);
  });

  it("sell floor defaults to 2× hitch — leftover that only covers 1× must hold", () => {
    assert.equal(hitchCostMult({}), 2);
    const hitch = estimateInjectHitchCostEth({ hitchBytes: STORE_HITCH_BYTES, gwei: 1 });
    const oneX = evaluateSellGate({
      projectedProceedsEth: 0.01 + hitch,
      entryEth: 0.01,
      sellPct: 1,
      gwei: 1,
      wantedHitchBytes: STORE_HITCH_BYTES,
      symbol: "AERO",
      reason: "🌙 MOONSHOT TRIM — not in active tiers",
    });
    const twoX = evaluateSellGate({
      projectedProceedsEth: 0.01 + hitch * 2 + 1e-12,
      entryEth: 0.01,
      sellPct: 1,
      gwei: 1,
      wantedHitchBytes: STORE_HITCH_BYTES,
      symbol: "AERO",
      reason: "🌙 MOONSHOT TRIM — not in active tiers",
    });
    assert.equal(oneX.allow, false);
    assert.equal(twoX.allow, true);
    assert.equal(encodingDoesNotLoseMoney({ leftoverEth: hitch, hitchCostEth: hitch * 2 }), false);
    assert.equal(encodingDoesNotLoseMoney({ leftoverEth: hitch * 2, hitchCostEth: hitch * 2 }), true);
  });

  it("LOSE_ZERO auto buy still needs leftover + edge — cascade is not a free pass", () => {
    const blocked = evaluateBuyGate({
      isCascade: true,
      leftover: 0,
      hasEdge: true,
      symbol: "REI",
      reason: "CASCADE",
      env: { LOSE_ZERO: "yes" },
    });
    assert.equal(blocked.allow, false);
  });
});

describe("verification: Eureka hitch is real UTF-8 or we admit it is not", () => {
  it("KEYCAT 0x5c0a93e4… fixture is a plain 228-byte swap — the letter was never mined", () => {
    assert.equal((KEYCAT_PLAIN_SWAP.length - 2) / 2, EXACT_INPUT_SINGLE_BYTES);
    assert.equal(decodeTrailingUtf8(KEYCAT_PLAIN_SWAP), "");
    assert.ok(!decodeTrailingUtf8(KEYCAT_PLAIN_SWAP).includes("Eureka"));
  });

  it("appendUtf8Hitch puts Eureka in trailing UTF-8 without changing minOut", () => {
    const hitched = appendUtf8Hitch(KEYCAT_PLAIN_SWAP, buildStoreVoice({ message: VITA_PROOF_FULL }));
    assert.equal(hitched.onChain, true);
    assert.match(hitched.utf8, /Eureka! VITA lives/);
    assert.match(decodeTrailingUtf8(hitched.data), /The truth is the chain/);
  });

  it("Telegram footer only quotes the letter when hitch.onChain", () => {
    assert.ok(src.includes("hitchTelegramFooter"));
    assert.ok(src.includes("the letter is not on-chain"));
    assert.ok(src.includes("sendStoreVoiceProof"));
  });

  it("sell ledger does not stamp Eureka unless hitch.onChain", () => {
    const sellFn = src.indexOf("async function executeSell(");
    const sellEnd = src.indexOf("\nasync function ", sellFn + 1);
    const body = src.slice(sellFn, sellEnd);
    assert.ok(body.includes("hitchLedgerSignature(sellVoice)"));
    assert.ok(!/"Eureka! VITA lives/.test(body), "sell ledger must not hardcode the letter");
    assert.ok(body.includes("hitchTelegramFooter(sellVoice"));
  });

  it("/prove waits for a success receipt before claiming the letter", () => {
    const fn = src.indexOf("async function sendStoreVoiceProof");
    const end = src.indexOf("\nfunction encodeApprove", fn);
    const body = src.slice(fn, end);
    assert.ok(body.includes("getSwapReceiptStatus"));
    assert.ok(body.indexOf("getSwapReceiptStatus") < body.lastIndexOf("onChain: true"));
    assert.ok(body.includes('receiptStatus !== "success"'));
  });
});

describe("verification: buys are not hallucinated", () => {
  it("0-token / reverted receipts are not wins", () => {
    assert.equal(isSuccessfulBuyFill({ receivedTokens: 0, receiptStatus: "success" }), false);
    assert.equal(isSuccessfulBuyFill({ receivedTokens: 10, receiptStatus: "reverted" }), false);
    assert.equal(isSuccessfulSellFill({ received: 0, receiptStatus: "success" }), false);
  });

  it("executeBuy waits for receipt + token delta before tradeCount / BTP / Eureka", () => {
    const buyFn = src.indexOf("async function executeBuy(");
    const buyEnd = src.indexOf("\nasync function ", buyFn + 1);
    const body = src.slice(buyFn, buyEnd);
    const fill = body.indexOf("isSuccessfulBuyFill");
    const tradeCount = body.indexOf("tradeCount++");
    const btp = body.indexOf("BTP STRAND RECEIPT");
    const telegram = body.indexOf("BOUGHT");
    assert.ok(fill >= 0, "must call isSuccessfulBuyFill");
    assert.ok(tradeCount > fill, "tradeCount only after fill");
    assert.ok(btp > fill, "BTP only after fill");
    assert.ok(telegram > fill, "BOUGHT telegram only after fill");
    assert.ok(body.includes("getTokenBalance"), "must measure token delta");
    assert.ok(body.includes("getSwapReceiptStatus"), "must read receipt");
    assert.ok(body.includes("hitchTelegramFooter"), "must not print Eureka unless hitch is on the tx");
  });

  it("does not Telegram a buy/sell receipt before the swap is sent", () => {
    assert.ok(!src.includes("BUY TRIGGERED"));
    assert.ok(!src.includes("⚡ Executing now..."));
    const buyZone = src.indexOf("// ── BUY AT MIN TROUGH");
    const buyCall = src.indexOf("await executeBuy", buyZone);
    const buyTg = src.indexOf("await tg(", buyZone);
    assert.ok(buyCall > 0, "trough still calls executeBuy");
    assert.ok(buyTg < 0 || buyTg > buyCall + 400, "no Telegram receipt before executeBuy");
  });

  it("fib rung is latched only after a real sell fill", () => {
    const fib = src.indexOf("if (shouldFibExit)");
    const body = src.slice(fib, src.indexOf("// ── SELL AT MAX PEAK", fib));
    assert.ok(body.indexOf("await executeSell") < body.indexOf("recordFibLevelExecuted"));
  });

  it("MIN_POS_USD default is $0.50 so a $2.59 book is not frozen", () => {
    assert.ok(src.includes("DEFAULT_MIN_POS_USD = 0.50"));
    assert.ok(src.includes("function minPosUsd("));
    assert.ok(!src.includes("const MIN_POS_USD       = 3.00"));
  });
});

describe("verification: new live Uni V3 books are catalogued", () => {
  it("adds REI and CLANKER as tradeable Uni V3 names", () => {
    assert.ok(src.includes('symbol: "REI"'));
    assert.ok(src.includes("0x6B2504A03ca4D43d0D73776F6aD46dAb2F2a4cFD"));
    assert.ok(src.includes("0x1bc0c42215582d5A085795f4baDbaC3ff36d1Bcb"));
    const rei = src.indexOf('symbol: "REI"');
    const next = src.indexOf("{ symbol:", rei + 1);
    const row = src.slice(rei, next);
    assert.ok(!row.includes("frozen: true"), "REI must be tradeable");
  });
});
