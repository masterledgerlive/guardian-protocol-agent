import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isValidEvmAddress,
  isValidUsdPrice,
  chunkAddresses,
  selectBestDexScreenerPair,
  parseGeckoTerminalPrices,
  hasUsableCostBasis,
  GECKO_TERMINAL_CHUNK,
  costBasisEth,
  shouldTrustSavedCostBasis,
  applyUnknownChainHolding,
  allowBinanceOhlcSeed,
  pickHistoricalSeedSource,
  preferBaseQuoteForLastPrice,
  pickGeckoTerminalPool,
  shouldSkipOhlcSeed,
  isSkipOhlcSeed,
  planOhlcSeed,
  isGhostDexPair,
  isTrustedQuoteToken,
  TOSHI_BASE,
  TOSHI_UNI_WETH_PAIR,
  TOSHI_CAKE_VIRTUAL_JUNK_PAIR,
  TOSHI_JUNK_DEX_USD,
  TOSHI_SANE_SPOT_USD,
  BASE_WETH,
  BASE_USDC,
} from "./price-oracle.js";

describe("address + price guards", () => {
  it("rejects truncated or non-hex addresses", () => {
    assert.equal(isValidEvmAddress("0xF6e932Ca12afa26665dC4dDE7e27be02A6C8e14"), false);
    assert.equal(isValidEvmAddress("0xBAa5CC21fd487B8Fcc2F632f8F4e4b1E7a67bA9f"), true);
    assert.equal(isValidEvmAddress("not-an-address"), false);
    assert.equal(isValidEvmAddress(""), false);
  });

  it("never treats missing / zero as a USD quote", () => {
    assert.equal(isValidUsdPrice(0), false);
    assert.equal(isValidUsdPrice(0.000001), true);
    assert.equal(isValidUsdPrice(null), false);
    assert.equal(isValidUsdPrice(undefined), false);
    assert.equal(isValidUsdPrice(NaN), false);
    assert.equal(isValidUsdPrice(-1), false);
    assert.equal(isValidUsdPrice(2.54), true);
  });
});

describe("DexScreener pair selection", () => {
  it("picks the deepest Base pool, not the first pair", () => {
    const pairs = [
      { chainId: "base", priceUsd: "0.0069", liquidity: { usd: 331 }, volume: { h24: 28 }, pairAddress: "dry", dexId: "aerodrome" },
      { chainId: "base", priceUsd: "0.00644", liquidity: { usd: 2_493_932 }, volume: { h24: 83951 }, pairAddress: "deep", dexId: "uniswap" },
      { chainId: "base", priceUsd: "0", liquidity: { usd: 9_000_000 }, pairAddress: "zero-price", dexId: "uniswap" },
      { chainId: "ethereum", priceUsd: "1.00", liquidity: { usd: 99_000_000 }, pairAddress: "wrong-chain", dexId: "uniswap" },
    ];
    const best = selectBestDexScreenerPair(pairs);
    assert.equal(best.pairAddress, "deep");
    assert.equal(best.priceUsd, 0.00644);
    assert.equal(best.source, "dexscreener");
  });

  it("returns null when every pool is dry or unpriced", () => {
    assert.equal(selectBestDexScreenerPair([]), null);
    assert.equal(selectBestDexScreenerPair([
      { chainId: "base", priceUsd: "0", liquidity: { usd: 100 } },
      { chainId: "base", priceUsd: null, liquidity: { usd: 100 } },
    ]), null);
  });

  it("rejects the live TOSHI Pancake VIRTUAL ghost ($69729) and keeps Uni/Aero WETH ~1.2e-4", () => {
    const pairs = [
      {
        chainId: "base",
        dexId: "pancakeswap",
        priceUsd: String(TOSHI_JUNK_DEX_USD),
        priceNative: "100009.8899",
        liquidity: { usd: 69_729_870.52 },
        volume: { h24: 0 },
        pairAddress: TOSHI_CAKE_VIRTUAL_JUNK_PAIR,
        baseToken: { address: TOSHI_BASE, symbol: "TOSHI" },
        quoteToken: { address: "0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b", symbol: "VIRTUAL" },
      },
      {
        chainId: "base",
        dexId: "uniswap",
        priceUsd: String(TOSHI_SANE_SPOT_USD),
        priceNative: "0.00000004901",
        liquidity: { usd: 1_144_685.42 },
        volume: { h24: 47_634.97 },
        pairAddress: TOSHI_UNI_WETH_PAIR,
        baseToken: { address: TOSHI_BASE, symbol: "TOSHI" },
        quoteToken: { address: BASE_WETH, symbol: "WETH" },
      },
      {
        chainId: "base",
        dexId: "aerodrome",
        priceUsd: "0.0001225",
        priceNative: "0.00000004936",
        liquidity: { usd: 41_793.56 },
        volume: { h24: 134_812.33 },
        pairAddress: "0x74E4c08Bb50619b70550733D32b7e60424E9628e",
        baseToken: { address: TOSHI_BASE, symbol: "TOSHI" },
        quoteToken: { address: BASE_WETH, symbol: "WETH" },
      },
      {
        chainId: "base",
        dexId: "uniswap",
        priceUsd: "0.0001219",
        priceNative: "0.0001219",
        liquidity: { usd: 36_455.6 },
        volume: { h24: 3_528.02 },
        pairAddress: "0xFc131B9981fB053C2cAb7373DAf70DeF1436c4BB",
        baseToken: { address: TOSHI_BASE, symbol: "TOSHI" },
        quoteToken: { address: BASE_USDC, symbol: "USDC" },
      },
    ];
    const best = selectBestDexScreenerPair(pairs, { tokenAddress: TOSHI_BASE });
    assert.ok(best);
    assert.equal(best.pairAddress.toLowerCase(), TOSHI_UNI_WETH_PAIR.toLowerCase());
    assert.ok(best.priceUsd > 1e-4 && best.priceUsd < 1.5e-4, `sane spot, got ${best.priceUsd}`);
    assert.notEqual(best.priceUsd, TOSHI_JUNK_DEX_USD);
    assert.equal(best.trustedQuote, true);
    assert.equal(best.verifiedPool, true);
    assert.ok(isGhostDexPair({ liqUsd: 69_729_870.52, volUsd: 0 }));
    assert.equal(isTrustedQuoteToken("0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b"), false);
    assert.equal(isTrustedQuoteToken(BASE_WETH), true);
  });

  it("never returns a $69729 independent when only the junk pair is present", () => {
    const onlyJunk = [{
      chainId: "base",
      dexId: "pancakeswap",
      priceUsd: String(TOSHI_JUNK_DEX_USD),
      liquidity: { usd: 69_729_870.52 },
      volume: { h24: 0 },
      pairAddress: TOSHI_CAKE_VIRTUAL_JUNK_PAIR,
      baseToken: { address: TOSHI_BASE, symbol: "TOSHI" },
      quoteToken: { address: "0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b", symbol: "VIRTUAL" },
    }];
    assert.equal(selectBestDexScreenerPair(onlyJunk, { tokenAddress: TOSHI_BASE }), null);
  });
});

describe("GeckoTerminal parse + chunking", () => {
  it("drops empty / zero GT prices", () => {
    const parsed = parseGeckoTerminalPrices({
      data: {
        attributes: {
          token_prices: {
            "0xbaa5cc21fd487b8fcc2f632f3f4e8d37262a0842": "2.54",
            "0x45a8b3be0d9e3caff4325b0bddd786b9b56b3ca8": "0",
            "not-an-address": "1.00",
          },
        },
      },
    });
    assert.equal(parsed["0xbaa5cc21fd487b8fcc2f632f3f4e8d37262a0842"], 2.54);
    assert.equal(parsed["0x45a8b3be0d9e3caff4325b0bddd786b9b56b3ca8"], undefined);
  });

  it("chunks at GT's useful limit so the 11th address is not silently dropped", () => {
    const addrs = Array.from({ length: 28 }, (_, i) =>
      "0x" + (i + 1).toString(16).padStart(40, "0")
    );
    const chunks = chunkAddresses(addrs, GECKO_TERMINAL_CHUNK);
    assert.equal(chunks.length, 3);
    assert.equal(chunks[0].length, 10);
    assert.equal(chunks[2].length, 8);
    assert.equal(chunkAddresses(["0xdead", ...addrs], 10)[0].length, 10);
  });
});

describe("cost basis", () => {
  it("excludes UNKNOWN entries from margin math", () => {
    assert.equal(hasUsableCostBasis({ entryPrice: 0.0026, unknownEntry: true }), false);
    assert.equal(hasUsableCostBasis({ entryPrice: 0, unknownEntry: false }), false);
    assert.equal(hasUsableCostBasis({ entryPrice: 0.000001, unknownEntry: false }), false);
    assert.equal(hasUsableCostBasis({ entryPrice: 0.000001, unknownEntry: false, totalInvestedEth: 0.0002 }), true);
    assert.equal(hasUsableCostBasis({ entryPrice: 2.54, totalInvestedEth: 0.01 }), true);
    assert.equal(hasUsableCostBasis({ entryPrice: 2.54, totalInvestedEth: 0 }), false);
    assert.equal(costBasisEth({ entryPrice: 0.000129, unknownEntry: true, totalInvestedEth: 0.0002 }), 0);
    assert.equal(costBasisEth({ entryPrice: 0.000129, unknownEntry: false, totalInvestedEth: 0.0002 }), 0.0002);
    const invented = { symbol: "TOSHI", entryPrice: 0.000129, totalInvestedEth: 0.0002, unknownEntry: false };
    assert.equal(shouldTrustSavedCostBasis(invented, {}), false);
    assert.equal(shouldTrustSavedCostBasis(invented, {
      fifoLot: { ethIn: 0.0002, tokensIn: 4514, fillCostEth: 0.0002 },
    }), true);
    applyUnknownChainHolding(invented, { units: 4514, priceUsd: 0.000129 });
    assert.equal(invented.unknownEntry, true);
    assert.equal(invented.totalInvestedEth, 0);
  });
});

describe("Binance must not overwrite Base", () => {
  it("blocks LUNA/KITE/GAME/HIGHER/MIGGLES CEX tickers", () => {
    for (const s of ["LUNA", "KITE", "GAME", "HIGHER", "MIGGLES", "BASECAT", "DRB", "VVV", "TIBBIR", "STONKEX", "BLUECHIP", "VELVET", "KTA"]) {
      assert.equal(allowBinanceOhlcSeed(s), false, s);
    }
    assert.equal(allowBinanceOhlcSeed("AERO"), true);
    assert.equal(allowBinanceOhlcSeed("BRETT"), true);
    assert.equal(allowBinanceOhlcSeed("LINK"), true);
    assert.equal(allowBinanceOhlcSeed("AAVE"), true);
    assert.equal(allowBinanceOhlcSeed("UNI"), true);
    assert.equal(allowBinanceOhlcSeed("ZORA"), true);
    assert.equal(allowBinanceOhlcSeed("XCN"), true); // Onyxcoin — wave OHLC even while WETH-buy frozen
    assert.equal(allowBinanceOhlcSeed("CBBTC"), false);
    assert.equal(allowBinanceOhlcSeed("BNKR"), false);
    assert.equal(allowBinanceOhlcSeed("VVV"), false);
  });

  it("prefers shorter Base history over a longer CEX LUNA series", () => {
    const gt = Array.from({ length: 20 }, (_, i) => ({ c: 0.005 + i * 0.00001 }));
    const binance = Array.from({ length: 90 }, (_, i) => ({ c: 0.046 + i * 0.0001 }));
    const picked = pickHistoricalSeedSource({
      gt, ds: null, binance, allowBinance: false,
    });
    assert.equal(picked.src, "GeckoTerminal");
    assert.equal(picked.data[0].c, 0.005);
  });

  it("never falls through to Binance for denied symbols even if Base is empty", () => {
    const binance = Array.from({ length: 90 }, () => ({ c: 0.129 }));
    assert.equal(pickHistoricalSeedSource({
      gt: null, ds: null, binance, allowBinance: false,
    }), null);
  });

  it("pins lastPrice to Base when CEX seed close is a different asset", () => {
    assert.equal(preferBaseQuoteForLastPrice(0.0468, 0.005356), 0.005356);
    assert.equal(preferBaseQuoteForLastPrice(0.129, 0.005), 0.005);
    assert.equal(preferBaseQuoteForLastPrice(0.0053, 0.0054), 0.0053);
    assert.equal(preferBaseQuoteForLastPrice(null, 0.00644), 0.00644);
    assert.equal(
      preferBaseQuoteForLastPrice(TOSHI_SANE_SPOT_USD, TOSHI_JUNK_DEX_USD, { trusted: false }),
      TOSHI_SANE_SPOT_USD
    );
  });

  it("picks the deepest GT pool, not the first row", () => {
    const pools = [
      { attributes: { address: "0x" + "1".repeat(40), reserve_in_usd: "1000", volume_usd: { h24: "99999" } } },
      { attributes: { address: "0x" + "2".repeat(40), reserve_in_usd: "1684697", volume_usd: { h24: "4989" } } },
    ];
    const pool = pickGeckoTerminalPool(pools);
    assert.equal(pool.attributes.address, "0x" + "2".repeat(40));
  });

  it("skips OHLC seed for no-pool and broken-quote catalog rows", () => {
    assert.equal(shouldSkipOhlcSeed({ symbol: "KITE", noBasePool: true }), true);
    assert.equal(shouldSkipOhlcSeed({ symbol: "SIMBA", brokenQuote: true }), true);
    assert.equal(shouldSkipOhlcSeed({ symbol: "TOSHI" }), false);
    assert.equal(shouldSkipOhlcSeed({ symbol: "SEAM", frozen: true }), false);
  });

  it("SKIP_OHLC_SEED=yes/true/1/on skips the entire seed pass", () => {
    assert.equal(isSkipOhlcSeed({ SKIP_OHLC_SEED: "yes" }), true);
    assert.equal(isSkipOhlcSeed({ SKIP_OHLC_SEED: "true" }), true);
    assert.equal(isSkipOhlcSeed({ SKIP_OHLC_SEED: "1" }), true);
    assert.equal(isSkipOhlcSeed({ SKIP_OHLC_SEED: "on" }), true);
    assert.equal(isSkipOhlcSeed({ SKIP_OHLC_SEED: "no" }), false);
    assert.equal(isSkipOhlcSeed({}), false);
    const tokens = [
      { symbol: "AERO", address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631" },
      { symbol: "KITE", noBasePool: true },
    ];
    const skipped = planOhlcSeed(tokens, { SKIP_OHLC_SEED: "yes" });
    assert.equal(skipped.skipAll, true);
    assert.equal(skipped.seedTokens.length, 0);
    assert.equal(skipped.reason, "SKIP_OHLC_SEED");
    const normal = planOhlcSeed(tokens, {});
    assert.equal(normal.skipAll, false);
    assert.equal(normal.seedTokens.some((t) => t.symbol === "AERO"), true);
  });
});
