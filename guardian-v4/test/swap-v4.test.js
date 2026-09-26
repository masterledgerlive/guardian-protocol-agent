import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ACTION_SETTLE_ALL,
  ACTION_SWAP_EXACT_IN_SINGLE,
  ACTION_TAKE_ALL,
  CMD_V4_SWAP,
  STORE_VOICE_TAG,
  VITA_PROOF_FULL,
  VITA_PROOF_MESSAGE,
  appendUtf8Hitch,
  buildPoolKey,
  buildStoreVoice,
  encodeV4ExactInSwap,
  encodingDoesNotLoseMoney,
  feePctToUint24,
  hitchSwapIfCovered,
} from "../swap-v4.js";
import { injectAllBookParams, rankAvenues } from "../inject-v4.js";
import { V4_AVENUES, injectableAvenues, isV4PoolId, listAvenues } from "../tokens.js";
import { NATIVE_ETH } from "../config.js";

describe("guardian-v4 catalog", () => {
  it("includes DOT and POLKADOT_BASE inject avenues with real V4 pool ids", () => {
    const dot = V4_AVENUES.find((t) => t.symbol === "DOT");
    const polka = V4_AVENUES.find((t) => t.symbol === "POLKADOT_BASE");
    assert.ok(dot?.poolId && isV4PoolId(dot.poolId));
    assert.ok(polka?.poolId && isV4PoolId(polka.poolId));
    assert.equal(dot.injectMain, true);
    assert.equal(polka.injectMain, true);
  });

  it("defers XPL (Plasma) instead of faking a Base V4 book", () => {
    const xpl = V4_AVENUES.find((t) => t.symbol === "XPL");
    assert.equal(xpl.status, "deferred");
  });

  it("lists many popular injectable avenues", () => {
    const inj = injectableAvenues(1);
    assert.ok(inj.length >= 8, `expected >=8 injectables, got ${inj.length}`);
    const symbols = listAvenues().map((t) => t.symbol);
    for (const s of ["DOT", "AERO", "TOSHI", "VIRTUAL", "BASECAT", "HABIBI", "CBBTC"]) {
      assert.ok(symbols.includes(s), `missing ${s}`);
    }
  });

  it("rejects non-32-byte pool ids", () => {
    assert.equal(isV4PoolId("0x846E89Cffc54160A7E4ACBeECC4f99C2528d1ca8"), false);
    assert.equal(
      isV4PoolId("0x5f547579519beaa158cddd3543604029165f66e86a00c373d0ee90c38784921b"),
      true,
    );
  });
});

describe("guardian-v4 swap + eureka hitch", () => {
  it("feePct maps to Uniswap uint24", () => {
    assert.equal(feePctToUint24(0.3), 3000);
    assert.equal(feePctToUint24(1), 10000);
    assert.equal(feePctToUint24(0.01), 100);
  });

  it("sorts pool currencies and builds DOT/ETH key", () => {
    const key = buildPoolKey({
      currencyA: "0x23a2847d772803f9efc64b4277b782b06296fe51",
      currencyB: NATIVE_ETH,
      fee: 10000,
    });
    assert.equal(key.currency0, NATIVE_ETH);
    assert.equal(key.fee, 10000);
    assert.equal(key.tickSpacing, 200);
  });

  it("encodes V4 execute calldata with V4_SWAP command selector path", () => {
    const enc = encodeV4ExactInSwap({
      tokenIn: NATIVE_ETH,
      tokenOut: "0x23a2847d772803f9efc64b4277b782b06296fe51",
      fee: 10000,
      amountIn: 10n ** 15n,
      amountOutMinimum: 0n,
    });
    assert.equal(enc.to.toLowerCase(), "0x6ff5693b99212da76ad316178a184ab56d299b43");
    assert.equal(enc.value, 10n ** 15n);
    assert.ok(enc.data.startsWith("0x3593564c"));
    assert.ok(enc.data.length > 20);
    assert.equal(CMD_V4_SWAP, 0x10);
    assert.equal(ACTION_SWAP_EXACT_IN_SINGLE, 0x06);
    assert.equal(ACTION_SETTLE_ALL, 0x0c);
    assert.equal(ACTION_TAKE_ALL, 0x0f);
  });

  it("hitches Eureka after swap prefix without overwriting it", () => {
    const enc = encodeV4ExactInSwap({
      tokenIn: NATIVE_ETH,
      tokenOut: "0x23a2847d772803f9efc64b4277b782b06296fe51",
      fee: 10000,
      amountIn: 10n ** 15n,
    });
    const voice = buildStoreVoice({ message: VITA_PROOF_MESSAGE });
    assert.ok(voice.includes(STORE_VOICE_TAG));
    assert.match(voice, /Eureka! VITA lives/);
    const hitch = appendUtf8Hitch(enc.data, voice);
    assert.equal(hitch.ok, true);
    assert.equal(hitch.onChain, true);
    assert.ok(hitch.data.toLowerCase().startsWith(enc.data.toLowerCase()));
    assert.match(hitch.utf8, /Krystian, Kai & Koda/);
  });

  it("skips hitch when leftover cannot cover (never lose for the letter)", () => {
    assert.equal(encodingDoesNotLoseMoney({ leftoverEth: 0.0001, hitchCostEth: 0.001 }), false);
    const enc = encodeV4ExactInSwap({
      tokenIn: NATIVE_ETH,
      tokenOut: "0x23a2847d772803f9efc64b4277b782b06296fe51",
      fee: 10000,
      amountIn: 10n ** 15n,
    });
    const r = hitchSwapIfCovered({
      swapData: enc.data,
      leftoverEth: 0,
      hitchCostEth: 0.001,
      message: VITA_PROOF_FULL,
    });
    assert.equal(r.onChain, false);
    assert.equal(r.skipped, true);
    assert.equal(r.data, enc.data);
  });

  it("utf8 override hitches VITA §TOKEN§ without overwriting swap prefix", () => {
    const enc = encodeV4ExactInSwap({
      tokenIn: NATIVE_ETH,
      tokenOut: "0x23a2847d772803f9efc64b4277b782b06296fe51",
      fee: 10000,
      amountIn: 10n ** 15n,
    });
    const r = hitchSwapIfCovered({
      swapData: enc.data,
      leftoverEth: 1,
      hitchCostEth: 0.0001,
      utf8: "§$STORE§\n§KEY§eureka♥Krystian,Kai,Koda",
    });
    assert.equal(r.onChain, true);
    assert.ok(r.utf8.includes("§KEY§"));
    assert.ok(r.data.toLowerCase().startsWith(enc.data.toLowerCase()));
    assert.doesNotMatch(r.utf8, /We did it! xoxo/);
  });

  it("leftover hitch defaults to VITA parse, not Eureka letter", () => {
    const enc = encodeV4ExactInSwap({
      tokenIn: NATIVE_ETH,
      tokenOut: "0x23a2847d772803f9efc64b4277b782b06296fe51",
      fee: 10000,
      amountIn: 10n ** 15n,
    });
    const r = hitchSwapIfCovered({
      swapData: enc.data,
      leftoverEth: 1,
      hitchCostEth: 0.0001,
    });
    assert.equal(r.onChain, true);
    assert.ok(r.utf8.includes("§KEY§"));
    assert.ok(r.utf8.includes("Krystian"));
    assert.doesNotMatch(r.utf8, /We did it! xoxo/);
    assert.doesNotMatch(r.utf8, /Eureka!/);
    assert.ok(r.data.toLowerCase().startsWith(enc.data.toLowerCase()));
    const src = readFileSync(new URL("../swap-v4.js", import.meta.url), "utf8");
    assert.ok(src.includes('planSecondaryHitch({ leftoverEth, hitchCostEth, mode: "vita" })'), "V4 leftover hitch must plan VITA KEY+LOC, not Eureka leftover");
    assert.ok(src.includes("kind.eureka && !kind.vita"), "V4 leftover hitch must refuse leftover Eureka");
  });
});

describe("guardian-v4 inject ranking", () => {
  it("concentrates thin books to inject-all", () => {
    const book = injectAllBookParams(6);
    assert.equal(book.injectAll, true);
    assert.equal(book.tier1Count, 1);
  });

  it("ranks DOT among primed inject mains on healthy book", () => {
    const ranked = rankAvenues(injectableAvenues(1), { tradeableUsd: 50 });
    assert.ok(ranked.primed.length >= 1);
    assert.ok(ranked.all.some((t) => t.symbol === "DOT"));
  });
});
