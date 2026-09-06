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
    assert.equal(hasUsableCostBasis({ entryPrice: 0.000001, unknownEntry: false }), true);
    assert.equal(hasUsableCostBasis({ entryPrice: 2.54 }), true);
  });
});
