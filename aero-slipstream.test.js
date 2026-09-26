import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { encodeFunctionData } from "viem";
import {
  SLIPSTREAM_SWAP_ROUTER,
  SLIPSTREAM_QUOTER_V2,
  SLIPSTREAM_FACTORY,
  HOME_SLIPSTREAM_TICK_SPACING,
  SLIPSTREAM_EXACT_INPUT_SINGLE_SELECTOR,
  SLIPSTREAM_EXACT_INPUT_SINGLE_BYTES,
  encodeSlipstreamExactInputSingle,
  decodeSlipstreamExactInputSingle,
  rotateHomeSlipstreamBuyPath,
  isSlipstreamHomeBuyPath,
  slipstreamApproveSpenders,
  slipstreamDeadline,
} from "./aero-slipstream.js";
import {
  VERIFIED_HOME_ADDRESS,
  HOME_AERO_SLIPSTREAM_POOL,
  HOME_FEE_TIER,
  OPERATOR_ROTATE_BUY_REASON,
  rotateHomeBuyUsesSlipstream,
} from "./operator-rotate.js";
import { BASE_WETH } from "./price-oracle.js";
import { BASE_QUOTER_V2 } from "./price-insane.js";
import {
  UNISWAP_SWAP_ROUTER02_BASE,
  hitchPreservesSwapPrefix,
  appendUtf8Hitch,
  SLIPSTREAM_EXACT_INPUT_SINGLE_SELECTOR as MINOUT_SLIP_SEL,
} from "./swap-minout.js";

const RISK = "0x50e1C4608c48b0c52E1EA5FBabc1c9126eA17915";

describe("Aerodrome Slipstream HOME buy path", () => {
  it("locks official Base Slipstream router/quoter and HOME pool tickSpacing 200", () => {
    assert.equal(SLIPSTREAM_SWAP_ROUTER, "0xBE6D8f0d05cC4be24d5167a3eF062215bE6D18a5");
    assert.equal(SLIPSTREAM_QUOTER_V2, "0x254cF9E1E6e233aa1AC962CB9B05b2cfeAaE15b0");
    assert.equal(SLIPSTREAM_FACTORY, "0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A");
    assert.equal(HOME_SLIPSTREAM_TICK_SPACING, 200);
    assert.equal(HOME_AERO_SLIPSTREAM_POOL.toLowerCase(), "0x098a4de96305bafaea0c0ce07cf6456e2c64982a");
    assert.equal(VERIFIED_HOME_ADDRESS, "0x4BfAa776991E85e5f8b1255461cbbd216cFc714f");
    assert.equal(HOME_FEE_TIER, 3000);
    assert.notEqual(SLIPSTREAM_QUOTER_V2.toLowerCase(), BASE_QUOTER_V2.toLowerCase());
    assert.notEqual(SLIPSTREAM_SWAP_ROUTER.toLowerCase(), UNISWAP_SWAP_ROUTER02_BASE.toLowerCase());
  });

  it("rotate HOME WETH→HOME selects Slipstream, not Uni QuoterV2", () => {
    const path = rotateHomeSlipstreamBuyPath();
    assert.equal(isSlipstreamHomeBuyPath(path), true);
    assert.equal(path.venue, "aerodrome-slipstream");
    assert.equal(path.tickSpacing, 200);
    assert.equal(path.tokenIn.toLowerCase(), BASE_WETH.toLowerCase());
    assert.equal(path.tokenOut, VERIFIED_HOME_ADDRESS);
    assert.equal(path.pool.toLowerCase(), HOME_AERO_SLIPSTREAM_POOL.toLowerCase());
    assert.equal(path.uniQuoterV2, null);
    assert.equal(rotateHomeBuyUsesSlipstream(OPERATOR_ROTATE_BUY_REASON, "HOME"), true);
    assert.equal(rotateHomeBuyUsesSlipstream("MANUAL BUY (operator) $2.56", "HOME"), true);
    assert.equal(rotateHomeBuyUsesSlipstream("MANUAL BUY (operator) $2.56", "AERO"), false);
    assert.equal(rotateHomeBuyUsesSlipstream("WAVE BUY", "HOME"), false);
    assert.deepEqual(slipstreamApproveSpenders(), [SLIPSTREAM_SWAP_ROUTER]);
  });

  it("encodes exactInputSingle with tickSpacing 200, not Uni fee 3000", () => {
    const amountIn = 1940000000000000n;
    const minOut = 1n;
    const deadline = 1_700_000_000n;
    const data = encodeSlipstreamExactInputSingle({
      tokenIn: BASE_WETH,
      tokenOut: VERIFIED_HOME_ADDRESS,
      tickSpacing: HOME_SLIPSTREAM_TICK_SPACING,
      recipient: RISK,
      deadline,
      amountIn,
      amountOutMinimum: minOut,
    });
    assert.equal(data.slice(0, 10), "0x" + SLIPSTREAM_EXACT_INPUT_SINGLE_SELECTOR);
    assert.equal((data.length - 2) / 2, SLIPSTREAM_EXACT_INPUT_SINGLE_BYTES);
    const dec = decodeSlipstreamExactInputSingle(data);
    assert.equal(dec.tickSpacing, 200);
    assert.notEqual(dec.tickSpacing, 3000);
    assert.equal(dec.tokenIn, BASE_WETH.toLowerCase());
    assert.equal(dec.tokenOut, VERIFIED_HOME_ADDRESS.toLowerCase());
    assert.equal(dec.recipient, RISK.toLowerCase());
    assert.equal(dec.amountIn, amountIn);
    assert.equal(dec.amountOutMinimum, minOut);
    assert.equal(dec.deadline, deadline);
    assert.equal(SLIPSTREAM_EXACT_INPUT_SINGLE_SELECTOR, MINOUT_SLIP_SEL);
    assert.equal(data.includes("04e45aaf"), false, "must not pack SwapRouter02 selector");
    const viem = encodeFunctionData({
      abi: [{
        name: "exactInputSingle",
        type: "function",
        stateMutability: "payable",
        inputs: [{
          name: "params",
          type: "tuple",
          components: [
            { name: "tokenIn", type: "address" },
            { name: "tokenOut", type: "address" },
            { name: "tickSpacing", type: "int24" },
            { name: "recipient", type: "address" },
            { name: "deadline", type: "uint256" },
            { name: "amountIn", type: "uint256" },
            { name: "amountOutMinimum", type: "uint256" },
            { name: "sqrtPriceLimitX96", type: "uint160" },
          ],
        }],
        outputs: [{ name: "amountOut", type: "uint256" }],
      }],
      functionName: "exactInputSingle",
      args: [{
        tokenIn: BASE_WETH,
        tokenOut: VERIFIED_HOME_ADDRESS,
        tickSpacing: HOME_SLIPSTREAM_TICK_SPACING,
        recipient: RISK,
        deadline,
        amountIn,
        amountOutMinimum: minOut,
        sqrtPriceLimitX96: 0n,
      }],
    });
    assert.equal(data.toLowerCase(), viem.toLowerCase(), "must match viem ABI encoding");
  });

  it("hitch may append after Slipstream prefix without changing minOut", () => {
    const swap = encodeSlipstreamExactInputSingle({
      tokenIn: BASE_WETH,
      tokenOut: VERIFIED_HOME_ADDRESS,
      tickSpacing: 200,
      recipient: RISK,
      deadline: slipstreamDeadline(1_700_000_000_000),
      amountIn: 1n,
      amountOutMinimum: 42n,
    });
    const hitch = appendUtf8Hitch(swap, "§$STORE§");
    assert.equal(hitch.ok, true);
    assert.equal(hitch.onChain, true);
    assert.equal(hitchPreservesSwapPrefix(swap, hitch.data).ok, true);
    assert.equal(decodeSlipstreamExactInputSingle(hitch.data).amountOutMinimum, 42n);
    assert.ok(decodeSlipstreamExactInputSingle(hitch.data).trailingBytes > 0);
  });
});
