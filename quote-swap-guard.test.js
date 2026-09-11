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
  isBuyFrozen,
  freezeNewBuys,
  clearBuyFreeze,
  clearSlippageFails,
  buyFrozenLog,
} from "./price-insane.js";
import {
  V3_FEE_TIERS,
  GAME_EMPTY_FEE_3000_POOL,
  GAME_LIVE_FEE_10000_POOL,
  GAME_TOKEN,
  GAME_FAILED_BUY,
  GAME_DEX_PAIRS,
  feeTierCandidates,
  catalogPoolFeePct,
  adoptLivePoolFee,
  isQuoteContractRevert,
  requireLiveQuoterFill,
  plainSaleIfHitchTooThin,
  evaluateSwapRouterRoute,
  requireFactoryLiquidity,
  shouldFreezeOnRouteReject,
  MIN_SWAP_POOL_LIQ_USD,
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
        assert.equal(rec.buyFrozen, true);
        assert.equal(isBuyFrozen("GAME", store), true);
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
    assert.match(row, /frozen:\s*true/);
    assert.ok(!/feeTier:\s*3000/.test(row), "GAME must not stay on empty 3000");
  });

  it("GAME is catalog-frozen exits-only — no FREEZE_GAME env, injector stays up", () => {
    const i = src.indexOf('symbol: "GAME"');
    assert.ok(i >= 0);
    const row = src.slice(i, src.indexOf("{ symbol:", i + 1));
    assert.match(row, /address:\s*"0x1C4CcA7C5DB003824208aDDA61Bd749e55F463a3"/);
    assert.equal(GAME_TOKEN.toLowerCase(), "0x1c4cca7c5db003824208adda61bd749e55f463a3");
    assert.match(row, /frozen:\s*true/);
    assert.ok(!/disabled:\s*true/.test(row), "GAME must stay exits-capable, not disabled");
    assert.ok(!/process\.env\.FREEZE_GAME/.test(src) && !/\bFREEZE_GAME\s*=/.test(src),
      "Railway has no FREEZE_GAME env — catalog is the gate");
    assert.ok(src.includes("catalogFreezeIsSticky"), "catalog freeze must win over /unfreeze");
    assert.ok(src.includes("applyStickyCatalogFreeze"), "executeBuy must re-apply catalog freeze");
    const buyFn = src.indexOf("async function executeBuy(");
    const sellFn = src.indexOf("async function executeSell(");
    const buyEnd = src.indexOf("\nasync function ", buyFn + 1);
    const sellEnd = src.indexOf("\nasync function ", sellFn + 1);
    const buyBody = src.slice(buyFn, buyEnd);
    const sellBody = src.slice(sellFn, sellEnd);
    assert.ok(buyBody.includes("applyStickyCatalogFreeze"), "new buys cannot arm GAME");
    assert.ok(!sellBody.includes("isCatalogFrozen"), "residual GAME sells stay open");
    assert.ok(!sellBody.includes("applyStickyCatalogFreeze"), "sticky freeze is buy-side only");
    assert.ok(src.includes('INJECT_MAIN_PLAYERS = ["LINK"'), "do not disable the whole injector");
    const unfreeze = src.indexOf('text.startsWith("/unfreeze ")');
    const unfreezeEnd = src.indexOf('text.startsWith("/freeze ")', unfreeze);
    const unfreezeBody = src.slice(unfreeze, unfreezeEnd > 0 ? unfreezeEnd : unfreeze + 800);
    assert.ok(unfreezeBody.includes("catalogFreezeIsSticky"), "/unfreeze GAME must refuse");
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
    assert.ok(buyBody.includes("evaluateSwapRouterRoute"), "buy must refuse Uni V2 / thin V3 books");
    assert.ok(buyBody.includes("requireFactoryLiquidity"), "buy must check factory liquidity");
    assert.ok(buyBody.includes("isBuyFrozen"), "buy must honor per-symbol freeze");
    assert.ok(buyBody.includes("clearBuyFreeze"), "successful fill may reopen buys");
    assert.ok(src.includes("readV3PoolLiquidity"), "must skip empty Uni V3 fees");
    assert.ok(!sellBody.includes("evaluateSwapRouterRoute"), "sells must not freeze on primary-book mismatch");
    assert.ok(!sellBody.includes("isSlippageCooledDown"), "sells stay open during buy cooldown");
    assert.ok(!sellBody.includes("isBuyFrozen"), "buy freeze must not block leftover exits");
    assert.ok(sellBody.includes("requireFactoryLiquidity"), "sell still skips empty V3 fees");
    assert.ok(src.includes("clearBuyFreeze(sym)"), "/unfreeze must lift runtime buy freeze");
    assert.ok(src.includes("isQuoteContractRevert"), "quote revert must not drain the RPC pool");
    assert.ok(!src.includes("using cached price with wider slippage"), "spot fallback send path must die");
  });
});

describe("SwapRouter route vs DexScreener primary book", () => {
  it("refuses GAME — liquid book is Uni V2 VIRTUAL, V3 WETH is a $2.8k ghost", () => {
    const r = evaluateSwapRouterRoute({
      pairs: GAME_DEX_PAIRS,
      tokenAddress: GAME_TOKEN,
      tradeUsd: 2,
      symbol: "GAME",
    });
    assert.equal(r.allow, false);
    assert.equal(r.freezeBuys, true);
    assert.ok(
      r.code === "THIN_V3_WETH" || r.code === "PRIMARY_NOT_V3_WETH",
      `expected THIN_V3_WETH or PRIMARY_NOT_V3_WETH, got ${r.code}`,
    );
    assert.equal(shouldFreezeOnRouteReject(r.code), true);
    assert.ok(r.primary.liqUsd > 2_000_000);
    assert.equal(r.primary.quoteSymbol, "VIRTUAL");
    assert.ok(r.swap.liqUsd < MIN_SWAP_POOL_LIQ_USD);
    assert.match(r.log, /Freeze new buys/);
  });

  it("refuses when Uni V3 WETH exists but is a fraction of the V2 VIRTUAL book", () => {
    const pairs = GAME_DEX_PAIRS.map((p) => {
      if (p.pairAddress === GAME_LIVE_FEE_10000_POOL) {
        return { ...p, liquidity: { usd: 80_000 } };
      }
      return p;
    });
    const r = evaluateSwapRouterRoute({
      pairs,
      tokenAddress: GAME_TOKEN,
      tradeUsd: 5,
      symbol: "GAME",
    });
    assert.equal(r.allow, false);
    assert.equal(r.code, "PRIMARY_NOT_V3_WETH");
    assert.equal(r.freezeBuys, true);
  });

  it("allows a deep Uni V3 WETH book that is the primary DexScreener pair", () => {
    const r = evaluateSwapRouterRoute({
      pairs: [{
        chainId: "base",
        dexId: "uniswap",
        labels: ["v3"],
        pairAddress: "0x1111111111111111111111111111111111111111",
        liquidity: { usd: 400_000 },
        volume: { h24: 50_000 },
        baseToken: { address: GAME_TOKEN },
        quoteToken: { address: "0x4200000000000000000000000000000000000006", symbol: "WETH" },
      }],
      tokenAddress: GAME_TOKEN,
      tradeUsd: 8,
      symbol: "TOKS",
    });
    assert.equal(r.allow, true);
    assert.equal(r.freezeBuys, false);
  });

  it("does not freeze the book when DexScreener returns no pairs", () => {
    const r = evaluateSwapRouterRoute({
      pairs: [],
      tokenAddress: GAME_TOKEN,
      tradeUsd: 5,
      symbol: "GAME",
    });
    assert.equal(r.allow, true);
    assert.equal(r.code, "NO_DEX_PAIRS");
    assert.equal(r.freezeBuys, false);
  });

  it("refuses factory liquidity=0 even without DexScreener pairs", () => {
    const r = evaluateSwapRouterRoute({
      pairs: [],
      tokenAddress: GAME_TOKEN,
      factoryLiquidity: 0n,
      symbol: "GAME",
    });
    assert.equal(r.allow, false);
    assert.equal(r.code, "EMPTY_V3_POOL");
    assert.equal(r.freezeBuys, true);
  });

  it("TRADE_TOO_BIG skips the clip without freezing new buys", () => {
    const r = evaluateSwapRouterRoute({
      pairs: [{
        chainId: "base",
        dexId: "uniswap",
        labels: ["v3"],
        pairAddress: "0x2222222222222222222222222222222222222222",
        liquidity: { usd: 40_000 },
        volume: { h24: 10_000 },
        baseToken: { address: GAME_TOKEN },
        quoteToken: { address: "0x4200000000000000000000000000000000000006", symbol: "WETH" },
      }],
      tokenAddress: GAME_TOKEN,
      tradeUsd: 8_000,
      symbol: "TOKS",
    });
    assert.equal(r.allow, false);
    assert.equal(r.code, "TRADE_TOO_BIG");
    assert.equal(r.freezeBuys, false);
    assert.equal(shouldFreezeOnRouteReject(r.code), false);
  });
});

describe("factory liquidity vs ghost Uni V3 fee", () => {
  it("refuses liquidity=0 (GAME empty 3000)", () => {
    const r = requireFactoryLiquidity({ liquidity: 0n, symbol: "GAME", fee: 3000 });
    assert.equal(r.allow, false);
    assert.equal(r.code, "EMPTY_V3_POOL");
    assert.equal(r.freezeBuys, true);
    assert.match(r.log, /liquidity=0/);
  });

  it("allows a missing factory read so Quoter can still try", () => {
    const r = requireFactoryLiquidity({ liquidity: null, symbol: "GAME", fee: 3000 });
    assert.equal(r.allow, true);
    assert.equal(r.code, "NO_FACTORY_READ");
  });

  it("allows non-zero factory liquidity", () => {
    const r = requireFactoryLiquidity({ liquidity: 123456n, symbol: "GAME", fee: 10000 });
    assert.equal(r.allow, true);
  });
});

describe("buy freeze after N quote/swap fails", () => {
  it("freezes new buys at N=3 and cooldown expiry does not reopen them", () => {
    const store = Object.create(null);
    const t0 = 9_000_000;
    recordSlippageFail("GAME", t0, { max: 3, cooldownMs: 60_000, store });
    recordSlippageFail("GAME", t0 + 1, { max: 3, cooldownMs: 60_000, store });
    const rec = recordSlippageFail("GAME", t0 + 2, { max: 3, cooldownMs: 60_000, store });
    assert.equal(rec.buyFrozen, true);
    assert.equal(isBuyFrozen("GAME", store), true);
    assert.match(buyFrozenLog("GAME", store), /BUY FROZEN/);
    // cooldown window ends — next fail starts a fresh count, freeze sticks
    const later = recordSlippageFail("GAME", t0 + 70_000, { max: 3, cooldownMs: 60_000, store });
    assert.equal(later.count, 1);
    assert.equal(isBuyFrozen("GAME", store), true);
    clearSlippageFails("GAME", store);
    assert.equal(isBuyFrozen("GAME", store), true, "successful sell must not reopen buys");
    clearBuyFreeze("GAME", store);
    assert.equal(isBuyFrozen("GAME", store), false);
  });

  it("freezeNewBuys sticks until an operator/successful-buy clear", () => {
    const store = Object.create(null);
    freezeNewBuys("GAME", "PRIMARY_NOT_V3_WETH", store);
    assert.equal(isBuyFrozen("GAME", store), true);
    clearSlippageFails("GAME", store);
    assert.equal(isBuyFrozen("GAME", store), true);
    clearBuyFreeze("GAME", store);
    assert.equal(isBuyFrozen("GAME", store), false);
  });
});

