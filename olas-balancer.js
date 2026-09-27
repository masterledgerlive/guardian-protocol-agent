/**
 * Balancer V2 Vault WETH↔OLAS path for Autonolas on Base.
 *
 * Uni V3 factory has OLAS/WETH fee 3000 / 10000 pools, but DexScreener has no
 * books there (ghost). Liquid book is Balancer V2 OLAS/WETH
 * `0x2da6e67C…` (~$60k) — SwapRouter02 cannot fill it.
 *
 * OPERATOR_BUY / Telegram /buy OLAS + cascade MAIN seat use this Vault swap,
 * never Uni QuoterV2. HOME piggy never-sell stays (RISK ETH/WETH funds the
 * $4 seat). Never invents hashes. Vault never. Mother brain untouched.
 */

import { encodeFunctionData, decodeFunctionResult } from "viem";
import { BASE_WETH } from "./price-oracle.js";
import { UNISWAP_SWAP_ROUTER02_BASE, asBigInt } from "./swap-minout.js";

/** Autonolas (OLAS) on Base — official Autonolas deployment. */
export const OLAS_TOKEN = "0x54330d28ca3357F294334BDC454a032e7f353416";
export const OLAS_SYMBOL = "OLAS";

/** Balancer V2 Vault (same address on Base as Ethereum). */
export const BALANCER_V2_VAULT = "0xBA12222222228d8Ba445958a75a0704d566BF2C8";

/** Balancer V2 weighted OLAS/WETH pool on Base (DexScreener ~$60k). */
export const OLAS_BALANCER_WETH_POOL = "0x2da6e67C45aF2aaA539294D9FA27ea50CE4e2C5f";

/**
 * On-chain getPoolId() for OLAS/WETH pool.
 * `0x2da6…1a3` = pool address || specialization 0x0002 || poolId 0x01a3.
 */
export const OLAS_BALANCER_WETH_POOL_ID =
  "0x2da6e67c45af2aaa539294d9fa27ea50ce4e2c5f0002000000000000000001a3";

/** Catalog feeTier placeholder — Balancer has no Uni fee; cost gates use 0.3%. */
export const OLAS_POOL_FEE_TIER = 3000;
export const OLAS_POOL_FEE_PCT = 0.003;

/** SwapKind.GIVEN_IN */
export const BALANCER_GIVEN_IN = 0;

/** vault.swap selector — Basescan MethodID 0x52bbbe29 */
export const BALANCER_SWAP_SELECTOR = "52bbbe29";

/** Empty userData → fixed ABI size for hitch append (viem-measured). */
export const BALANCER_SWAP_BYTES = 452; // 4 + ABI head with empty userData

export const BALANCER_DEADLINE_TTL_SEC = 1200;

export const BALANCER_VAULT_ABI = Object.freeze([
  {
    name: "swap",
    type: "function",
    stateMutability: "payable",
    inputs: [
      {
        name: "singleSwap",
        type: "tuple",
        components: [
          { name: "poolId", type: "bytes32" },
          { name: "kind", type: "uint8" },
          { name: "assetIn", type: "address" },
          { name: "assetOut", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "userData", type: "bytes" },
        ],
      },
      {
        name: "funds",
        type: "tuple",
        components: [
          { name: "sender", type: "address" },
          { name: "fromInternalBalance", type: "bool" },
          { name: "recipient", type: "address" },
          { name: "toInternalBalance", type: "bool" },
        ],
      },
      { name: "limit", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ name: "amountCalculated", type: "uint256" }],
  },
  {
    name: "queryBatchSwap",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "kind", type: "uint8" },
      {
        name: "swaps",
        type: "tuple[]",
        components: [
          { name: "poolId", type: "bytes32" },
          { name: "assetInIndex", type: "uint256" },
          { name: "assetOutIndex", type: "uint256" },
          { name: "amount", type: "uint256" },
          { name: "userData", type: "bytes" },
        ],
      },
      { name: "assets", type: "address[]" },
      {
        name: "funds",
        type: "tuple",
        components: [
          { name: "sender", type: "address" },
          { name: "fromInternalBalance", type: "bool" },
          { name: "recipient", type: "address" },
          { name: "toInternalBalance", type: "bool" },
        ],
      },
    ],
    outputs: [{ name: "assetDeltas", type: "int256[]" }],
  },
  {
    name: "getPoolTokens",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [
      { name: "tokens", type: "address[]" },
      { name: "balances", type: "uint256[]" },
      { name: "lastChangeBlock", type: "uint256" },
    ],
  },
]);

function normSym(s) {
  return String(s || "").trim().toUpperCase();
}

export function isOlasSymbol(symbol) {
  return normSym(symbol) === OLAS_SYMBOL;
}

/**
 * OLAS fills Balancer Vault (not Uni QuoterV2 ghost V3).
 * OPERATOR_BUY / Telegram /buy + cascade / wave when symbol is OLAS.
 */
export function olasBuyUsesBalancer(reason, symbol) {
  if (!isOlasSymbol(symbol)) return false;
  // Always — no liquid Uni V3 WETH book; DexScreener V3 pairs are empty.
  void reason;
  return true;
}

export function olasBuyBypassesV3Freeze(reason, symbol) {
  return olasBuyUsesBalancer(reason, symbol);
}

export function olasBuyBypassesQuoterCooldown(reason, symbol) {
  return olasBuyUsesBalancer(reason, symbol);
}

export function olasBuyIgnoresUniQuoterMiss(reason, symbol) {
  return olasBuyUsesBalancer(reason, symbol);
}

export function balancerDeadline(nowMs = Date.now()) {
  return BigInt(Math.floor(Number(nowMs) / 1000) + BALANCER_DEADLINE_TTL_SEC);
}

/**
 * Encode Vault.swap GIVEN_IN. assetIn may be WETH or address(0) for native ETH.
 * Empty userData keeps a stable hitch prefix length.
 */
export function encodeBalancerVaultSwap({
  poolId = OLAS_BALANCER_WETH_POOL_ID,
  assetIn,
  assetOut,
  amountIn,
  amountOutMinimum = 0n,
  sender,
  recipient,
  deadline,
  kind = BALANCER_GIVEN_IN,
} = {}) {
  const data = encodeFunctionData({
    abi: BALANCER_VAULT_ABI,
    functionName: "swap",
    args: [
      {
        poolId,
        kind,
        assetIn,
        assetOut,
        amount: asBigInt(amountIn) ?? 0n,
        userData: "0x",
      },
      {
        sender,
        fromInternalBalance: false,
        recipient,
        toInternalBalance: false,
      },
      asBigInt(amountOutMinimum) ?? 0n,
      asBigInt(deadline) ?? balancerDeadline(),
    ],
  });
  return data;
}

export function decodeBalancerVaultSwap(data) {
  const h = String(data || "").replace(/^0x/i, "").toLowerCase();
  if (h.length < 8 + 64) return null;
  if (h.slice(0, 8) !== BALANCER_SWAP_SELECTOR) return null;
  try {
    // Manual decode of static head after offsets — prefer length check.
    const bytes = Math.floor(h.length / 2);
    return {
      selector: BALANCER_SWAP_SELECTOR,
      swapBytes: BALANCER_SWAP_BYTES,
      trailingBytes: Math.max(0, bytes - BALANCER_SWAP_BYTES),
      raw: "0x" + h,
    };
  } catch {
    return null;
  }
}

/** WETH→OLAS buy path descriptor (never Uni). */
export function olasBalancerBuyPath() {
  return {
    venue: "balancer-v2",
    symbol: OLAS_SYMBOL,
    tokenIn: BASE_WETH,
    tokenOut: OLAS_TOKEN,
    pool: OLAS_BALANCER_WETH_POOL,
    poolId: OLAS_BALANCER_WETH_POOL_ID,
    router: BALANCER_V2_VAULT,
    vault: BALANCER_V2_VAULT,
    fee: OLAS_POOL_FEE_TIER,
    poolFeePct: OLAS_POOL_FEE_PCT,
    uniQuoterV2: null,
    uniSwapRouter02: null,
  };
}

export function isOlasBalancerBuyPath(path) {
  if (!path || typeof path !== "object") return false;
  return String(path.venue || "") === "balancer-v2"
    && String(path.router || "").toLowerCase() === BALANCER_V2_VAULT.toLowerCase()
    && String(path.poolId || "").toLowerCase() === OLAS_BALANCER_WETH_POOL_ID.toLowerCase()
    && String(path.tokenOut || "").toLowerCase() === OLAS_TOKEN.toLowerCase()
    && path.uniQuoterV2 == null
    && String(path.router || "").toLowerCase() !== UNISWAP_SWAP_ROUTER02_BASE.toLowerCase();
}

export function balancerApproveSpenders() {
  return [BALANCER_V2_VAULT];
}

/**
 * Parse queryBatchSwap deltas → amountOut for GIVEN_IN.
 * Balancer: negative delta = assets into Vault; positive = assets to user.
 */
export function amountOutFromBatchDeltas(deltas, assetOutIndex) {
  const idx = Number(assetOutIndex);
  if (!Array.isArray(deltas) || idx < 0 || idx >= deltas.length) return null;
  const d = deltas[idx];
  if (typeof d !== "bigint") return null;
  // User receives → positive delta
  if (d > 0n) return d;
  // Some RPC wrappers flip sign — accept absolute if only one non-zero out
  if (d < 0n) return -d;
  return null;
}

export function encodeQueryBatchSwapGivenIn({
  poolId = OLAS_BALANCER_WETH_POOL_ID,
  assetIn,
  assetOut,
  amountIn,
  sender,
  recipient,
} = {}) {
  return encodeFunctionData({
    abi: BALANCER_VAULT_ABI,
    functionName: "queryBatchSwap",
    args: [
      BALANCER_GIVEN_IN,
      [{
        poolId,
        assetInIndex: 0n,
        assetOutIndex: 1n,
        amount: asBigInt(amountIn) ?? 0n,
        userData: "0x",
      }],
      [assetIn, assetOut],
      {
        sender,
        fromInternalBalance: false,
        recipient,
        toInternalBalance: false,
      },
    ],
  });
}

export function decodeQueryBatchSwapResult(data) {
  try {
    const deltas = decodeFunctionResult({
      abi: BALANCER_VAULT_ABI,
      functionName: "queryBatchSwap",
      data,
    });
    return Array.isArray(deltas) ? deltas : null;
  } catch {
    return null;
  }
}

/** Encode getPoolTokens for depth checks. */
export function encodeGetPoolTokens(poolId = OLAS_BALANCER_WETH_POOL_ID) {
  return encodeFunctionData({
    abi: BALANCER_VAULT_ABI,
    functionName: "getPoolTokens",
    args: [poolId],
  });
}

/**
 * Minimal depth gate: both token balances > 0.
 * Returns synthetic liquidity = min(balances) for factory-style gates.
 */
export function balancerPoolDepthFromTokens(tokens, balances, { weth = BASE_WETH, olas = OLAS_TOKEN } = {}) {
  const list = Array.isArray(tokens) ? tokens : [];
  const bals = Array.isArray(balances) ? balances : [];
  let wethBal = 0n;
  let olasBal = 0n;
  for (let i = 0; i < list.length; i++) {
    const t = String(list[i] || "").toLowerCase();
    const b = typeof bals[i] === "bigint" ? bals[i] : 0n;
    if (t === String(weth).toLowerCase()) wethBal = b;
    if (t === String(olas).toLowerCase()) olasBal = b;
  }
  const empty = wethBal <= 0n || olasBal <= 0n;
  const liquidity = wethBal < olasBal ? wethBal : olasBal;
  return { wethBal, olasBal, empty, liquidity };
}
