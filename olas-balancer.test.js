import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { encodeFunctionData } from "viem";
import {
  OLAS_TOKEN,
  OLAS_SYMBOL,
  BALANCER_V2_VAULT,
  OLAS_BALANCER_WETH_POOL,
  OLAS_BALANCER_WETH_POOL_ID,
  BALANCER_SWAP_SELECTOR,
  BALANCER_SWAP_BYTES,
  BALANCER_VAULT_ABI,
  olasBuyUsesBalancer,
  olasBuyBypassesV3Freeze,
  olasBalancerBuyPath,
  isOlasBalancerBuyPath,
  encodeBalancerVaultSwap,
  balancerApproveSpenders,
  balancerDeadline,
  amountOutFromBatchDeltas,
  balancerPoolDepthFromTokens,
} from "./olas-balancer.js";
import { BASE_WETH } from "./price-oracle.js";
import {
  hitchPreservesSwapPrefix,
  appendUtf8Hitch,
  BALANCER_VAULT_SWAP_SELECTOR,
  BALANCER_VAULT_SWAP_BYTES,
  UNISWAP_SWAP_ROUTER02_BASE,
} from "./swap-minout.js";

const RISK = "0x50e1C4608c48b0c52E1EA5FBabc1c9126eA17915";

describe("OLAS Balancer V2 buy path", () => {
  it("locks Autonolas + Balancer Vault poolId on Base", () => {
    assert.equal(OLAS_TOKEN, "0x54330d28ca3357F294334BDC454a032e7f353416");
    assert.equal(OLAS_SYMBOL, "OLAS");
    assert.equal(BALANCER_V2_VAULT, "0xBA12222222228d8Ba445958a75a0704d566BF2C8");
    assert.equal(OLAS_BALANCER_WETH_POOL.toLowerCase(), "0x2da6e67c45af2aaa539294d9fa27ea50ce4e2c5f");
    assert.equal(
      OLAS_BALANCER_WETH_POOL_ID.toLowerCase(),
      "0x2da6e67c45af2aaa539294d9fa27ea50ce4e2c5f0002000000000000000001a3",
    );
    assert.notEqual(BALANCER_V2_VAULT.toLowerCase(), UNISWAP_SWAP_ROUTER02_BASE.toLowerCase());
  });

  it("OLAS always selects Balancer, never Uni SwapRouter02", () => {
    const path = olasBalancerBuyPath();
    assert.equal(isOlasBalancerBuyPath(path), true);
    assert.equal(path.venue, "balancer-v2");
    assert.equal(path.tokenIn.toLowerCase(), BASE_WETH.toLowerCase());
    assert.equal(path.tokenOut, OLAS_TOKEN);
    assert.equal(path.uniQuoterV2, null);
    assert.equal(olasBuyUsesBalancer("MANUAL BUY (operator) $4", "OLAS"), true);
    assert.equal(olasBuyUsesBalancer("WAVE BUY", "OLAS"), true);
    assert.equal(olasBuyUsesBalancer("MANUAL BUY (operator) $4", "AERO"), false);
    assert.equal(olasBuyBypassesV3Freeze("cascade", "OLAS"), true);
    assert.deepEqual(balancerApproveSpenders(), [BALANCER_V2_VAULT]);
  });

  it("encodes Vault.swap matching viem ABI (empty userData)", () => {
    const amountIn = 1480000000000000n; // ~$4 @ $2700
    const minOut = 1n;
    const deadline = 1_700_000_000n;
    const data = encodeBalancerVaultSwap({
      assetIn: BASE_WETH,
      assetOut: OLAS_TOKEN,
      amountIn,
      amountOutMinimum: minOut,
      sender: RISK,
      recipient: RISK,
      deadline,
    });
    assert.equal(data.slice(0, 10), "0x" + BALANCER_SWAP_SELECTOR);
    assert.equal((data.length - 2) / 2, BALANCER_SWAP_BYTES);
    assert.equal(BALANCER_SWAP_SELECTOR, BALANCER_VAULT_SWAP_SELECTOR);
    assert.equal(BALANCER_SWAP_BYTES, BALANCER_VAULT_SWAP_BYTES);
    const viem = encodeFunctionData({
      abi: BALANCER_VAULT_ABI,
      functionName: "swap",
      args: [
        {
          poolId: OLAS_BALANCER_WETH_POOL_ID,
          kind: 0,
          assetIn: BASE_WETH,
          assetOut: OLAS_TOKEN,
          amount: amountIn,
          userData: "0x",
        },
        {
          sender: RISK,
          fromInternalBalance: false,
          recipient: RISK,
          toInternalBalance: false,
        },
        minOut,
        deadline,
      ],
    });
    assert.equal(data.toLowerCase(), viem.toLowerCase());
    assert.equal(data.includes("04e45aaf"), false, "must not pack SwapRouter02 selector");
  });

  it("hitch may append after Balancer prefix without overwriting limit", () => {
    const swap = encodeBalancerVaultSwap({
      assetIn: BASE_WETH,
      assetOut: OLAS_TOKEN,
      amountIn: 1n,
      amountOutMinimum: 42n,
      sender: RISK,
      recipient: RISK,
      deadline: balancerDeadline(1_700_000_000_000),
    });
    const hitch = appendUtf8Hitch(swap, "§$STORE§");
    assert.equal(hitch.ok, true);
    assert.equal(hitch.onChain, true);
    assert.equal(hitchPreservesSwapPrefix(swap, hitch.data).ok, true);
  });

  it("parses queryBatchSwap deltas and pool depth", () => {
    assert.equal(amountOutFromBatchDeltas([-10n, 88n], 1), 88n);
    assert.equal(amountOutFromBatchDeltas([-10n, 0n], 1), null);
    const depth = balancerPoolDepthFromTokens(
      [BASE_WETH, OLAS_TOKEN],
      [11n * 10n ** 18n, 671658n * 10n ** 18n],
    );
    assert.equal(depth.empty, false);
    assert.ok(depth.liquidity > 0n);
    assert.equal(
      balancerPoolDepthFromTokens([BASE_WETH, OLAS_TOKEN], [0n, 1n]).empty,
      true,
    );
  });

  it("catalog + cascade MAIN + INJECT_MAIN include OLAS", () => {
    const agent = readFileSync(new URL("./agent.js", import.meta.url), "utf8");
    assert.match(agent, /symbol: "OLAS"/);
    assert.match(agent, /INJECT_MAIN_PLAYERS = \[[^\]]*OLAS/);
    assert.match(agent, /olasBuyUsesBalancer/);
    assert.match(agent, /quoteBalancerOlasBuy/);
    const cascade = readFileSync(new URL("./vita/base-cascade-program.js", import.meta.url), "utf8");
    assert.match(cascade, /"OLAS"/);
    const mins = readFileSync(new URL("./token-mins.js", import.meta.url), "utf8");
    assert.match(mins, /OLAS:\s*0\.50/);
  });
});
