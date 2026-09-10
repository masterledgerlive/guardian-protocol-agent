import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { toWei, spotOutWei, encodeExactInputSingle, appendUtf8Hitch } from "./swap-minout.js";
import {
  recordSlippageFail,
  isSlippageCooledDown,
  slippageCooldownLog,
  slippageFailLog,
} from "./price-insane.js";
import {
  V3_FEE_TIERS,
  GAME_EMPTY_FEE_3000_POOL,
  GAME_LIVE_FEE_10000_POOL,
  GAME_TOKEN,
  GAME_FAILED_BUY,
  feeTierCandidates,
  catalogPoolFeePct,
  adoptLivePoolFee,
  isQuoteContractRevert,
  requireLiveQuoterFill,
  plainSaleIfHitchTooThin,
} from "./quote-swap-guard.js";

const root = dirname(fileURLToPath(import.meta.url));

describe("fee tier candidates", () => {
  it("tries catalog fee first, then the other Uni V3 fees", () => {
    assert.deepEqual(feeTierCandidates(3000), [3000, 100, 500, 10000]);
    assert.deepEqual(feeTierCandidates(10000), [10000, 100, 500, 3000]);
    assert.ok(V3_FEE_TIERS.includes(10000));
  });

  it("maps live fee to catalog poolFeePct", () => {
    assert.equal(catalogPoolFeePct(10000), 0.010);
    assert.equal(catalogPoolFeePct(3000), 0.006);
    const token = { symbol: "GAME", feeTier: 3000, poolFeePct: 0.006 };
    const r = adoptLivePoolFee(token, 10000);
    assert.equal(r.changed, true);
    assert.equal(token.feeTier, 10000);
    assert.equal(token.poolFeePct, 0.010);
    assert.equal(adoptLivePoolFee(token, 10000).changed, false);
  });
});

describe("GAME live revert class — empty fee 3000 vs live 10000", () => {
  it("records the mined exactInputSingle that used empty 3000 + hitch", () => {
    assert.equal(GAME_FAILED_BUY.fee, 3000);
    assert.equal(GAME_FAILED_BUY.hitchBytes, 229);
    assert.ok(GAME_FAILED_BUY.gasUsed > 700_000, "OOG-class gas on empty pool");
    assert.ok(GAME_FAILED_BUY.amountOutMinimum > 200n * 10n ** 18n);
    assert.equal(
      GAME_EMPTY_FEE_3000_POOL.toLowerCase(),
      "0x70fbffe313d4a40909dba7129e0b2f4a45a645b5"
    );
    assert.equal(
      GAME_LIVE_FEE_10000_POOL.toLowerCase(),
      "0xe5ff624bc6c0f85c5e1e27f94366b5829b1877a3"
    );
    assert.equal(GAME_TOKEN.toLowerCase(), "0x1c4cca7c5db003824208adda61bd749e55f463a3");
  });

  it("refuses to send when QuoterV2 misses (the live GAME buy path)", () => {
    const r = requireLiveQuoterFill({
      quotedOut: null,
      spotOut: toWei(366, 18),
      symbol: "GAME",
      side: "buy",
    });
    assert.equal(r.allow, false);
    assert.equal(r.code, "QUOTE_MISS");
    assert.match(r.log, /QUOTE MISS/);
    assert.match(r.log, /Not sending/);
  });

  it("allows a live 10000 quote that sits next to Aerodrome spot", () => {
    const quote = toWei(358.13, 18);
    const spot = spotOutWei({
      amountInHuman: 0.00074,
      inUsd: 2470,
      outUsd: 0.00495,
      outDecimals: 18,
    });
    const r = requireLiveQuoterFill({
      quotedOut: quote,
      spotOut: spot,
      symbol: "GAME",
      side: "buy",
    });
    assert.equal(r.allow, true);
    assert.equal(r.quotedOut, quote);
    assert.ok(spot > 0n);
  });

  it("refuses a fantasy Quoter print 10×+ vs spot", () => {
    const r = requireLiveQuoterFill({
      quotedOut: toWei(110_000, 18),
      spotOut: toWei(0.00026, 18),
      symbol: "TOSHI",
      side: "sell",
    });
    assert.equal(r.allow, false);
    assert.equal(r.code, "PRICE_INSANE");
    assert.match(r.log, /PRICE_INSANE/);
  });
});

describe("quote miss cooldown — stop sending after N fails", () => {
  it("arms cooldown after 3 QuoterV2 misses without sending a swap", () => {
    const store = Object.create(null);
    const t0 = 5_000_000;
    for (let i = 0; i < 3; i++) {
      const miss = requireLiveQuoterFill({
        quotedOut: null,
        spotOut: toWei(366, 18),
        symbol: "GAME",
        side: "buy",
      });
      assert.equal(miss.allow, false);
      const rec = recordSlippageFail("GAME", t0 + i, { max: 3, cooldownMs: 30 * 60 * 1000, store });
      if (i < 2) {
        assert.equal(rec.cooled, false);
        assert.match(slippageFailLog("GAME", rec, { kind: "QuoterV2 miss" }), /QuoterV2 miss/);
      } else {
        assert.equal(rec.cooled, true);
        assert.equal(isSlippageCooledDown("GAME", t0 + i, store), true);
        assert.match(slippageFailLog("GAME", rec, { kind: "QuoterV2 miss" }), /cooldown armed/);
        assert.match(
          slippageCooldownLog("GAME", t0 + i, store, { side: "buy" }),
          /BUY SKIPPED[\s\S]*cooldown/
        );
      }
    }
  });
});

describe("quote revert vs RPC outage", () => {
  it("treats QuoterV2 / Too little received as a pool miss, not RPC failover", () => {
    assert.equal(isQuoteContractRevert(new Error("The contract function \"quoteExactInputSingle\" reverted")), true);
    assert.equal(isQuoteContractRevert("execution reverted: Unexpected error"), true);
    assert.equal(isQuoteContractRevert(new Error("execution reverted: Too little received")), true);
    assert.equal(isQuoteContractRevert(new Error("rpc timeout 6s")), false);
    assert.equal(isQuoteContractRevert(new Error("fetch failed")), false);
  });
});

describe("plain sale when hitch leftover is too thin", () => {
  it("strips hitch when leftover cannot cover hitch cost", () => {
    const swap = encodeExactInputSingle({
      tokenIn: "0x4200000000000000000000000000000000000006",
      tokenOut: GAME_TOKEN,
      fee: 10000,
      recipient: "0x50e1C4608c48b0c52E1EA5FBabc1c9126eA17915",
      amountIn: GAME_FAILED_BUY.amountIn,
      amountOutMinimum: 1n,
    });
    const packed = appendUtf8Hitch(swap, "§$STORE§ Eureka!");
    assert.equal(packed.onChain, true);
    const plain = plainSaleIfHitchTooThin(packed, swap, {
      leftoverEth: 0.000001,
      hitchCostEth: 0.00001,
    });
    assert.equal(plain.onChain, false);
    assert.equal(plain.hitchBytes, 0);
    assert.equal(plain.data, swap);
    assert.match(plain.log, /plain sale/);
  });

  it("keeps hitch when leftover covers", () => {
    const swap = encodeExactInputSingle({
      tokenIn: "0x4200000000000000000000000000000000000006",
      tokenOut: GAME_TOKEN,
      fee: 10000,
      recipient: "0x50e1C4608c48b0c52E1EA5FBabc1c9126eA17915",
      amountIn: 1n,
      amountOutMinimum: 1n,
    });
    const packed = appendUtf8Hitch(swap, "§$STORE§");
    const keep = plainSaleIfHitchTooThin(packed, swap, {
      leftoverEth: 0.00002,
      hitchCostEth: 0.00001,
    });
    assert.equal(keep.onChain, true);
    assert.ok(keep.hitchBytes > 0);
  });
});

describe("agent.js wiring — quote miss never sends", () => {
  const src = readFileSync(join(root, "agent.js"), "utf8");

  it("GAME catalog fee is the live Uni V3 10000 pool, not empty 3000", () => {
    const i = src.indexOf('symbol: "GAME"');
    assert.ok(i >= 0);
    const row = src.slice(i, src.indexOf("{ symbol:", i + 1));
    assert.match(row, /feeTier:\s*10000/);
    assert.match(row, /poolFeePct:\s*0\.010/);
    assert.ok(!/feeTier:\s*3000/.test(row), "GAME must not stay on empty 3000");
  });

  it("executeBuy and executeSell require a live Quoter fill and fee fallback", () => {
    assert.ok(src.includes("requireLiveQuoterFill"), "must gate on live Quoter");
    assert.ok(src.includes("feeTierCandidates"), "must probe other V3 fees");
    assert.ok(src.includes("plainSaleIfHitchTooThin"), "must strip hitch when leftover is thin");
    assert.ok(src.includes("adoptLivePoolFee"), "must remember the fee that quoted");
    const buyFn = src.indexOf("async function executeBuy(");
    const sellFn = src.indexOf("async function executeSell(");
    const buyEnd = src.indexOf("\nasync function ", buyFn + 1);
    const sellEnd = src.indexOf("\nasync function ", sellFn + 1);
    const buyBody = src.slice(buyFn, buyEnd);
    const sellBody = src.slice(sellFn, sellEnd);
    assert.ok(buyBody.includes("requireLiveQuoterFill"), "buy must refuse quote miss");
    assert.ok(sellBody.includes("requireLiveQuoterFill"), "sell must refuse quote miss");
    assert.ok(buyBody.includes("recordSlippageFail"), "quote miss counts toward cooldown");
    assert.ok(sellBody.includes("recordSlippageFail"), "sell quote miss counts toward cooldown");
    assert.ok(buyBody.includes("plainSaleIfHitchTooThin"), "buy strips thin hitch");
    assert.ok(sellBody.includes("plainSaleIfHitchTooThin"), "sell strips thin hitch");
    assert.ok(
      buyBody.includes("skipHitch: buySkipHitch || buyVoice.onChain")
        || buyBody.includes("skipHitch: buySkipHitch|| buyVoice.onChain"),
      "orch must not hitch when leftover skipped hitch"
    );
    assert.ok(src.includes("isQuoteContractRevert"), "quote revert must not drain the RPC pool");
    assert.ok(!src.includes("using cached price with wider slippage"), "spot fallback send path must die");
  });
});
