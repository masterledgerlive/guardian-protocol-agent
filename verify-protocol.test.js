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

  it("sell floor defaults to 2× hitch — leftover that only covers 1× skips hitch and still sells", () => {
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
    assert.equal(oneX.allow, true);
    assert.equal(oneX.skipHitch, true);
    assert.equal(twoX.allow, true);
    assert.equal(encodingDoesNotLoseMoney({ leftoverEth: hitch, hitchCostEth: hitch * 2 }), false);
    assert.equal(encodingDoesNotLoseMoney({ leftoverEth: hitch * 2, hitchCostEth: hitch * 2 }), true);
  });

  it("unprofitable leftover after fees still holds — we do not sell at a loss", () => {
    const d = evaluateSellGate({
      projectedProceedsEth: 0.0005,
      entryEth: 0.001,
      sellPct: 1,
      gwei: 1,
      wantedHitchBytes: STORE_HITCH_BYTES,
      symbol: "KEYCAT",
      reason: "🎯 MAX PEAK",
    });
    assert.equal(d.allow, false);
    assert.match(d.log, /leftover after fees/);
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

  it("adds top-100 Uni V3 majors LINK AAVE UNI and thaws VVV ZORA BNKR", () => {
    assert.ok(src.includes("0x88Fb150BDc53A65fe94Dea0c9BA0a6dAf8C6e196"), "LINK");
    assert.ok(src.includes("0x63706e401c06ac8513145b7687A14804d17f814b"), "AAVE");
    assert.ok(src.includes("0xc3De830EA07524a0761646a6a4e4be0e114a3C83"), "UNI");
    for (const sym of ["LINK", "UNI", "VVV", "ZORA", "BNKR"]) {
      const base = src.indexOf(`symbol: "${sym}"`);
      assert.ok(base >= 0, `${sym} in catalog`);
      const next = src.indexOf("{ symbol:", base + 1);
      const row = src.slice(base, next > 0 ? next : base + 500);
      assert.ok(!row.includes("frozen: true"), `${sym} must be tradeable for injection`);
    }
    for (const sym of ["CBBTC", "AAVE"]) {
      const base = src.indexOf(`symbol: "${sym}"`);
      assert.ok(base >= 0, `${sym} in catalog`);
      const next = src.indexOf("{ symbol:", base + 1);
      const row = src.slice(base, next > 0 ? next : base + 500);
      assert.ok(row.includes("frozen: true"), `${sym} locked-closed — exits only`);
    }
    const uni = src.indexOf('symbol: "UNI"');
    assert.match(src.slice(uni, uni + 200), /feeTier:\s*10000/);
    const vvv = src.indexOf('symbol: "VVV"');
    assert.match(src.slice(vvv, vvv + 200), /feeTier:\s*10000/);
    assert.ok(src.includes('t.symbol === "AAVE"'), "AAVE high unit-price entry sanity");
  });

  it("boot banner and scoring make new majors injection-ready", () => {
    assert.ok(src.includes("bootActive.join"), "boot banner lists live active symbols");
    assert.ok(src.includes("Inject-surface boost"), "deep Uni books get capital before trade history");
    assert.ok(src.includes("score?.liquidity"), "inject boost uses catalog liquidity");
  });

  it("reserves UNI as a Tier-1 inject main player", () => {
    assert.ok(src.includes('INJECT_MAIN_PLAYERS = ["UNI"'), "UNI is first inject main");
    assert.ok(src.includes("injectMain: true"), "UNI row marked injectMain");
    assert.ok(src.includes("reservedMain"), "tier assign reserves inject main seat");
    assert.ok(src.includes('if (activeMains.includes("UNI")) reservedMain = "UNI"'), "UNI preferred for T1 seat");
    const uni = src.indexOf('symbol: "UNI"');
    assert.ok(uni >= 0);
    const row = src.slice(uni, src.indexOf("{ symbol:", uni + 1));
    assert.ok(row.includes("injectMain: true"));
    assert.ok(!row.includes("frozen: true"));
  });
});

describe("verification: operator /buy is honest and chain is the ledger", () => {
  it("operator leftover-0 buy is allowed as a plain swap (test path)", () => {
    const d = evaluateBuyGate({
      leftover: 0,
      hasEdge: false,
      symbol: "TOSHI",
      reason: "MANUAL BUY (operator) $1",
      env: { LOSE_ZERO: "yes" },
    });
    assert.equal(d.allow, true);
    assert.equal(d.skipHitch, true);
  });

  it("executeBuy telegrams operator skips; receipts still wait for fill", () => {
    assert.ok(src.includes("operatorBuySkipTelegram"));
    assert.ok(src.includes("async function skipBuy"));
    const buyFn = src.indexOf("async function executeBuy(");
    const body = src.slice(buyFn, src.indexOf("\nasync function executeSell", buyFn));
    assert.ok(body.indexOf("isSuccessfulBuyFill") < body.indexOf("BOUGHT"));
  });

  it("does not invent invested ETH from a live mark", () => {
    assert.ok(src.includes("applyUnknownChainHolding"));
    assert.ok(src.includes("costBasisEth(token)"));
    assert.ok(!src.includes("UNKNOWN ENTRY resolved from live market"));
  });

  it("netPositions is module-scoped so processToken and chain recon can read the ledger", () => {
    assert.match(src, /^let netPositions\s*=/m);
    const scan = src.indexOf("ON-CHAIN POSITION RECOVERY");
    const scanBody = src.slice(scan, src.indexOf("Start VITA webhook", scan));
    assert.ok(!scanBody.includes("const netPositions"), "boot scan must not shadow netPositions in a block");
    const proc = src.indexOf("async function processToken");
    const procBody = src.slice(proc, src.indexOf("\nasync function runPredFundTick", proc));
    assert.ok(procBody.includes("netPositions[token.symbol]"));
    assert.ok(src.includes("CHAIN RECONCILIATION"));
  });
});
