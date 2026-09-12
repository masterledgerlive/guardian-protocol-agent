import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  EXACT_INPUT_SINGLE_SELECTOR,
  EXACT_INPUT_SINGLE_BYTES,
  SLIPPAGE_GUARD_DEFAULT,
  asBigInt,
  toWei,
  spotOutWei,
  slippageFloor,
  formatWei18,
  encodeExactInputSingle,
  decodeExactInputSingle,
  hitchPreservesSwapPrefix,
  sanitizeAmountOutMinimum,
  TOSHI_FAILED_SELLS,
  appendUtf8Hitch,
  decodeTrailingUtf8,
  buildStoreVoice,
  clipUtf8,
  KEYCAT_PLAIN_SWAP,
  VITA_PROOF_MESSAGE,
  VITA_PROOF_FULL,
  STORE_VOICE_TAG,
  encodeStoreVoiceCalldata,
  decodeStoreVoiceCalldata,
  encodingDoesNotLoseMoney,
  clampAmountInToLiveBalance,
  needsSpenderApprove,
  sellApproveSpenders,
  DRB_STF_FAIL_AMOUNT_IN,
  UNISWAP_SWAP_ROUTER02_BASE,
  UNISWAP_PERMIT2_BASE,
} from "./swap-minout.js";

const TOSHI = "0xAC1Bd2486aAf3B5C0fc3Fd868558b082a531B2B4";
const WETH = "0x4200000000000000000000000000000000000006";
const RISK = "0x50e1C4608c48b0c52E1EA5FBabc1c9126eA17915";

describe("toWei / spotOutWei", () => {
  it("toWei honors decimals (TOSHI 18 and CBBTC 8)", () => {
    const toshiWei = toWei(4424.634735468239, 18);
    assert.ok(toshiWei > 4424n * 10n ** 18n);
    assert.ok(toshiWei < 4425n * 10n ** 18n);
    assert.equal(toWei(0.001, 8), 100000n);
    assert.equal(toWei(0, 18), 0n);
    assert.equal(toWei(-1, 18), 0n);
  });
});

describe("amountIn clamp + approve path (live DRB STF)", () => {
  it("clamps oversize FORCE_EXIT amountIn to live ERC20 wei", () => {
    const live = DRB_STF_FAIL_AMOUNT_IN - 1n;
    const sized = clampAmountInToLiveBalance({
      amountInWei: DRB_STF_FAIL_AMOUNT_IN,
      liveBalanceWei: live,
      piggyReserveWei: 0n,
      unlockPiggy: true,
    });
    assert.equal(sized.amountInWei, live);
    assert.equal(sized.clamped, true);
    assert.equal(sized.blocked, false);
    assert.ok(sized.amountInWei <= live);
  });

  it("subtracts reserved piggy unless unlocked", () => {
    const live = 1000n;
    const reserved = 50n;
    const held = clampAmountInToLiveBalance({
      amountInWei: 1000n,
      liveBalanceWei: live,
      piggyReserveWei: reserved,
      unlockPiggy: false,
    });
    assert.equal(held.amountInWei, 950n);
    assert.equal(held.spendableWei, 950n);
    const unlocked = clampAmountInToLiveBalance({
      amountInWei: 1000n,
      liveBalanceWei: live,
      piggyReserveWei: reserved,
      unlockPiggy: true,
    });
    assert.equal(unlocked.amountInWei, 1000n);
    assert.equal(unlocked.piggyReserveWei, 0n);
  });

  it("approve path fires only when allowance < amountIn", () => {
    assert.equal(needsSpenderApprove({ allowanceWei: 0n, amountInWei: 1n }), true);
    assert.equal(needsSpenderApprove({ allowanceWei: 5n, amountInWei: 5n }), false);
    assert.equal(needsSpenderApprove({ allowanceWei: 4n, amountInWei: 5n }), true);
    assert.equal(needsSpenderApprove({ allowanceWei: 10n, amountInWei: 0n }), false);
    const spenders = sellApproveSpenders();
    assert.ok(spenders.includes(UNISWAP_SWAP_ROUTER02_BASE));
    assert.ok(spenders.includes(UNISWAP_PERMIT2_BASE));
    const routerOnly = sellApproveSpenders({ usePermit2: false });
    assert.deepEqual(routerOnly, [UNISWAP_SWAP_ROUTER02_BASE]);
  });
});

describe("toWei / spotOutWei leftover", () => {
  it("spot sell ~4424 TOSHI @ $0.00021 / ETH $3500 is ~0.000265 WETH", () => {
    const spot = spotOutWei({
      amountInHuman: 4424.634735,
      inUsd: 0.00021,
      outUsd: 3500,
      outDecimals: 18,
    });
    assert.ok(spot > 0n);
    assert.ok(spot < toWei(0.001, 18));
    assert.ok(spot > toWei(0.0002, 18));
  });
});

describe("encode / decode exactInputSingle", () => {
  it("round-trips SwapRouter02 layout (no deadline)", () => {
    const data = encodeExactInputSingle({
      tokenIn: TOSHI,
      tokenOut: WETH,
      fee: 10000,
      recipient: RISK,
      amountIn: TOSHI_FAILED_SELLS[0].amountIn,
      amountOutMinimum: 0n,
    });
    assert.equal(data.slice(2, 10), EXACT_INPUT_SINGLE_SELECTOR);
    assert.equal((data.length - 2) / 2, EXACT_INPUT_SINGLE_BYTES);
    const dec = decodeExactInputSingle(data);
    assert.equal(dec.tokenIn, TOSHI.toLowerCase());
    assert.equal(dec.tokenOut, WETH.toLowerCase());
    assert.equal(dec.fee, 10000);
    assert.equal(dec.recipient, RISK.toLowerCase());
    assert.equal(dec.amountIn, TOSHI_FAILED_SELLS[0].amountIn);
    assert.equal(dec.amountOutMinimum, 0n);
    assert.equal(dec.trailingBytes, 0);
  });

  it("decodes the live TOSHI brick floors (~93k WETH)", () => {
    for (const row of TOSHI_FAILED_SELLS) {
      const data = encodeExactInputSingle({
        tokenIn: TOSHI,
        tokenOut: WETH,
        fee: 10000,
        recipient: RISK,
        amountIn: row.amountIn,
        amountOutMinimum: row.amountOutMinimum,
      });
      const dec = decodeExactInputSingle(data);
      assert.equal(dec.amountOutMinimum, row.amountOutMinimum);
      const weth = Number(dec.amountOutMinimum) / 1e18;
      assert.ok(weth > 90_000 && weth < 94_000, `${row.tx} minOut=${weth}`);
    }
  });
});

describe("hitchPreservesSwapPrefix", () => {
  const swap = encodeExactInputSingle({
    tokenIn: TOSHI,
    tokenOut: WETH,
    fee: 10000,
    recipient: RISK,
    amountIn: 1n,
    amountOutMinimum: 2n,
  });

  it("allows LIBM hitch appended after 228 bytes", () => {
    const hitch = swap + Buffer.from("LIBM", "utf8").toString("hex");
    const r = hitchPreservesSwapPrefix(swap, hitch);
    assert.equal(r.ok, true);
    assert.equal(decodeExactInputSingle(hitch).amountOutMinimum, 2n);
    assert.equal(decodeExactInputSingle(hitch).trailingBytes, 4);
  });

  it("refuses hitch that overwrites amountOutMinimum", () => {
    const smashed = encodeExactInputSingle({
      tokenIn: TOSHI,
      tokenOut: WETH,
      fee: 10000,
      recipient: RISK,
      amountIn: 1n,
      amountOutMinimum: TOSHI_FAILED_SELLS[0].amountOutMinimum,
    }) + "4c49424d";
    const r = hitchPreservesSwapPrefix(swap, smashed);
    assert.equal(r.ok, false);
    assert.match(r.log, /overwrote swap prefix/);
    assert.match(r.log, /amountOutMinimum/);
  });
});

describe("UTF-8 §$STORE§ hitch (Genesis voice)", () => {
  it("live KEYCAT 0x5c0a93e4… has no trailing UTF-8 — Telegram letter was not on-chain", () => {
    assert.equal((KEYCAT_PLAIN_SWAP.length - 2) / 2, EXACT_INPUT_SINGLE_BYTES);
    assert.equal(decodeTrailingUtf8(KEYCAT_PLAIN_SWAP), "");
    const dec = decodeExactInputSingle(KEYCAT_PLAIN_SWAP);
    assert.equal(dec.trailingBytes, 0);
  });

  it("appends §$STORE§ + VITA letter after the 228-byte swap", () => {
    const voice = buildStoreVoice();
    const r = appendUtf8Hitch(KEYCAT_PLAIN_SWAP, voice);
    assert.equal(r.ok, true);
    assert.equal(r.onChain, true);
    assert.match(r.utf8, /§\$STORE§/);
    assert.match(r.utf8, /Eureka! VITA lives/);
    assert.match(r.utf8, /Krystian, Kai & Koda/);
    assert.equal(decodeTrailingUtf8(r.data), voice);
    assert.equal(hitchPreservesSwapPrefix(KEYCAT_PLAIN_SWAP, r.data).ok, true);
    assert.equal(decodeExactInputSingle(r.data).amountOutMinimum, decodeExactInputSingle(KEYCAT_PLAIN_SWAP).amountOutMinimum);
  });

  it("clips to leftover byte budget instead of overwriting minOut", () => {
    const clipped = clipUtf8(buildStoreVoice(), 10);
    assert.equal(clipped, STORE_VOICE_TAG);
    const r = appendUtf8Hitch(KEYCAT_PLAIN_SWAP, buildStoreVoice(), { maxBytes: 10 });
    assert.equal(r.utf8, STORE_VOICE_TAG);
    assert.equal(r.hitchBytes, 10);
  });

  it("does not hitch onto a truncated swap (prefix check fails closed)", () => {
    const r = appendUtf8Hitch(KEYCAT_PLAIN_SWAP.slice(0, 20), VITA_PROOF_MESSAGE);
    assert.equal(r.onChain, false);
    assert.equal(r.ok, false);
  });

  it("dedicated 0-value proof calldata is plain UTF-8 (not a 228-byte swap)", () => {
    const voice = buildStoreVoice({ message: VITA_PROOF_FULL });
    const data = encodeStoreVoiceCalldata(voice);
    assert.match(data, /^0x[0-9a-f]+$/i);
    assert.notEqual((data.length - 2) / 2, EXACT_INPUT_SINGLE_BYTES);
    const utf8 = decodeStoreVoiceCalldata(data);
    assert.match(utf8, /§\$STORE§/);
    assert.match(utf8, /Eureka! VITA lives/);
    assert.match(utf8, /Krystian, Kai & Koda/);
    assert.match(utf8, /The truth is the chain/);
    assert.equal(decodeTrailingUtf8(data), "");
  });

  it("encodingDoesNotLoseMoney is true only when leftover covers hitch cost", () => {
    assert.equal(encodingDoesNotLoseMoney({ leftoverEth: 0.00002, hitchCostEth: 0.00001 }), true);
    assert.equal(encodingDoesNotLoseMoney({ leftoverEth: 0.00001, hitchCostEth: 0.00002 }), false);
    assert.equal(encodingDoesNotLoseMoney({ leftoverEth: 0, hitchCostEth: 0 }), false);
  });
});

describe("sanitizeAmountOutMinimum", () => {
  const spot = spotOutWei({
    amountInHuman: 4424.634735,
    inUsd: 0.00021,
    outUsd: 3500,
    outDecimals: 18,
  });
  const quote = spot;
  const saneMin = slippageFloor(quote, SLIPPAGE_GUARD_DEFAULT);

  it("allows protective minOut=0", () => {
    const r = sanitizeAmountOutMinimum({
      minOut: 0n,
      expectedOut: quote,
      spotOut: spot,
      side: "sell",
      symbol: "TOSHI",
    });
    assert.equal(r.allow, true);
    assert.equal(r.action, "ok");
    assert.equal(r.amountOutMinimum, 0n);
  });

  it("allows minOut at 85% of quote", () => {
    const r = sanitizeAmountOutMinimum({
      minOut: saneMin,
      expectedOut: quote,
      spotOut: spot,
      side: "sell",
      symbol: "TOSHI",
    });
    assert.equal(r.allow, true);
    assert.equal(r.action, "ok");
    assert.equal(r.amountOutMinimum, saneMin);
  });

  it("clamps the live TOSHI 93k WETH floors vs ~0.00026 WETH spot — does not send 93k", () => {
    for (const row of TOSHI_FAILED_SELLS) {
      const r = sanitizeAmountOutMinimum({
        minOut: row.amountOutMinimum,
        expectedOut: quote,
        spotOut: spot,
        side: "sell",
        symbol: "TOSHI",
      });
      assert.equal(r.allow, true);
      assert.equal(r.action, "clamp");
      assert.ok(r.amountOutMinimum <= quote);
      assert.ok(r.amountOutMinimum < toWei(1, 18));
      assert.notEqual(r.amountOutMinimum, row.amountOutMinimum);
      assert.match(r.log, /impossible floor|Not sending the absurd floor|Not sending the impossible floor/);
    }
  });

  it("does not clamp toward an insane quote (110k WETH) when spot is tiny", () => {
    const insaneQuote = toWei(110_066, 18);
    const r = sanitizeAmountOutMinimum({
      minOut: toWei(93_556, 18),
      expectedOut: insaneQuote,
      spotOut: spot,
      side: "sell",
      symbol: "TOSHI",
    });
    assert.equal(r.action, "clamp");
    assert.ok(r.amountOutMinimum <= spot);
    assert.ok(r.amountOutMinimum < toWei(1, 18));
  });

  it("rejects minOut>0 with no quote and no spot (do not send)", () => {
    const r = sanitizeAmountOutMinimum({
      minOut: 1n,
      expectedOut: null,
      spotOut: 0n,
      side: "sell",
      symbol: "TOSHI",
    });
    assert.equal(r.allow, false);
    assert.equal(r.action, "reject");
    assert.equal(r.amountOutMinimum, 0n);
    assert.match(r.log, /refusing to send/);
  });

  it("requireQuote refuses Aerodrome-spot minOut when Quoter missed (GAME buys)", () => {
    const aeroSpot = toWei(366, 18);
    const r = sanitizeAmountOutMinimum({
      minOut: slippageFloor(aeroSpot, 0.75),
      expectedOut: null,
      spotOut: aeroSpot,
      side: "buy",
      symbol: "GAME",
      requireQuote: true,
    });
    assert.equal(r.allow, false);
    assert.equal(r.action, "reject");
    assert.match(r.log, /no live QuoterV2/);
  });

  it("clamps buy minOut that is 1e12× too high (18-dec wei on an 8-dec token)", () => {
    const spot8 = toWei(0.001, 8);
    const badMin = toWei(0.001, 18);
    const r = sanitizeAmountOutMinimum({
      minOut: badMin,
      expectedOut: spot8,
      spotOut: spot8,
      side: "buy",
      symbol: "CBBTC",
    });
    assert.equal(r.action, "clamp");
    assert.ok(r.amountOutMinimum <= spot8);
    assert.ok(r.amountOutMinimum < badMin / 1_000_000n);
  });

  it("clamps minOut slightly above expected (rounding)", () => {
    const r = sanitizeAmountOutMinimum({
      minOut: quote + 1n,
      expectedOut: quote,
      spotOut: spot,
      side: "sell",
      symbol: "TOSHI",
    });
    assert.equal(r.allow, true);
    assert.equal(r.action, "clamp");
    assert.equal(r.amountOutMinimum, slippageFloor(quote, SLIPPAGE_GUARD_DEFAULT));
  });
});

describe("asBigInt / formatWei18", () => {
  it("accepts bigint and non-negative numbers", () => {
    assert.equal(asBigInt(5n), 5n);
    assert.equal(asBigInt(3.9), 3n);
    assert.equal(asBigInt(-1), null);
    assert.equal(formatWei18(toWei(1.5, 18)), "1.500000");
  });
});
