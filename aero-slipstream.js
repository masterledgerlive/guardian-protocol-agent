/**
 * Aerodrome Slipstream (CL) WETH→HOME path for OPERATOR_ROTATE_TO=HOME.
 *
 * Uni SwapRouter02 / QuoterV2 cannot fill HOME: the liquid book is
 * Slipstream HOME/WETH 0.3% `0x098A4dE9…` (on-chain tickSpacing 200),
 * not Uni V3 fee-probe 3000/10000/500/100. Official Base deployments:
 * https://github.com/aerodrome-finance/slipstream
 *
 * Does not invent tx hashes. Vault never. Mother brain untouched.
 */

import {
  VERIFIED_HOME_ADDRESS,
  VERIFIED_HOME_SYMBOL,
  HOME_FEE_TIER,
  HOME_AERO_SLIPSTREAM_POOL,
} from "./operator-rotate.js";
import { BASE_WETH } from "./price-oracle.js";
import { BASE_QUOTER_V2 } from "./price-insane.js";
import { UNISWAP_SWAP_ROUTER02_BASE, asBigInt } from "./swap-minout.js";

/** Aerodrome Slipstream SwapRouter on Base (verified bytecode selector 0xa026383e). */
export const SLIPSTREAM_SWAP_ROUTER = "0xBE6D8f0d05cC4be24d5167a3eF062215bE6D18a5";
/** Aerodrome Slipstream QuoterV2 on Base (verified bytecode selector 0x9e7defe6). */
export const SLIPSTREAM_QUOTER_V2 = "0x254cF9E1E6e233aa1AC962CB9B05b2cfeAaE15b0";
/** Aerodrome Slipstream CL pool factory on Base. */
export const SLIPSTREAM_FACTORY = "0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A";

/**
 * Live HOME/WETH CL pool tickSpacing() = 200 (0xC8).
 * Slipstream routes by tickSpacing, not Uni V3 uint24 fee.
 * Catalog HOME_FEE_TIER 3000 still means 0.3% for cost gates.
 */
export const HOME_SLIPSTREAM_TICK_SPACING = 200;

/** ISwapRouter.exactInputSingle((address,address,int24,address,uint256,uint256,uint256,uint160)) */
export const SLIPSTREAM_EXACT_INPUT_SINGLE_SELECTOR = "a026383e";
/** selector + 8 static fields (in-place tuple; no offset word) */
export const SLIPSTREAM_EXACT_INPUT_SINGLE_BYTES = 260;

export const SLIPSTREAM_DEADLINE_TTL_SEC = 1200;

export const SLIPSTREAM_QUOTER_ABI = Object.freeze([
  {
    name: "quoteExactInputSingle",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{
      name: "params",
      type: "tuple",
      components: [
        { name: "tokenIn", type: "address" },
        { name: "tokenOut", type: "address" },
        { name: "amountIn", type: "uint256" },
        { name: "tickSpacing", type: "int24" },
        { name: "sqrtPriceLimitX96", type: "uint160" },
      ],
    }],
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "sqrtPriceX96After", type: "uint160" },
      { name: "initializedTicksCrossed", type: "uint32" },
      { name: "gasEstimate", type: "uint256" },
    ],
  },
]);

function padWord(hex) {
  const h = String(hex || "").replace(/^0x/i, "").toLowerCase();
  if (h.length > 64) throw new Error(`SLIPSTREAM: uint256 overflow (${h.length} hex chars)`);
  return h.padStart(64, "0");
}

function wordAddr(addr) {
  const h = String(addr || "").replace(/^0x/i, "").toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(h)) throw new Error("SLIPSTREAM: invalid address");
  return padWord(h);
}

function wordUint(v) {
  const n = asBigInt(v);
  if (n == null || n < 0n) throw new Error("SLIPSTREAM: invalid uint256");
  return padWord(n.toString(16));
}

function wordInt24(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < -8388608 || n > 8388607) {
    throw new Error("SLIPSTREAM: invalid int24");
  }
  const big = BigInt(n);
  const asU = big < 0n ? (1n << 256n) + big : big;
  return padWord(asU.toString(16));
}

export function slipstreamDeadline(nowMs = Date.now(), ttlSec = SLIPSTREAM_DEADLINE_TTL_SEC) {
  const now = Number(nowMs);
  const ttl = Number(ttlSec);
  const sec = Number.isFinite(now) && now > 0 ? Math.floor(now / 1000) : Math.floor(Date.now() / 1000);
  const pad = Number.isFinite(ttl) && ttl > 0 ? Math.floor(ttl) : SLIPSTREAM_DEADLINE_TTL_SEC;
  return BigInt(sec + pad);
}

/**
 * Standard ABI exactInputSingle for Aerodrome Slipstream SwapRouter.
 * Trailing hitch bytes may append after these 292 bytes (router ignores extra).
 */
export function encodeSlipstreamExactInputSingle({
  tokenIn,
  tokenOut,
  tickSpacing = HOME_SLIPSTREAM_TICK_SPACING,
  recipient,
  deadline,
  amountIn,
  amountOutMinimum = 0n,
  sqrtPriceLimitX96 = 0n,
} = {}) {
  const dl = deadline == null ? slipstreamDeadline() : deadline;
  return (
    "0x" +
    SLIPSTREAM_EXACT_INPUT_SINGLE_SELECTOR +
    wordAddr(tokenIn) +
    wordAddr(tokenOut) +
    wordInt24(tickSpacing) +
    wordAddr(recipient) +
    wordUint(dl) +
    wordUint(amountIn) +
    wordUint(amountOutMinimum) +
    wordUint(sqrtPriceLimitX96)
  );
}

export function decodeSlipstreamExactInputSingle(data) {
  const h = String(data || "").replace(/^0x/i, "").toLowerCase();
  const need = SLIPSTREAM_EXACT_INPUT_SINGLE_BYTES * 2;
  if (h.length < need) return null;
  if (h.slice(0, 8) !== SLIPSTREAM_EXACT_INPUT_SINGLE_SELECTOR) return null;
  const w = (i) => h.slice(8 + i * 64, 8 + (i + 1) * 64);
  const tickWord = BigInt("0x" + w(2));
  const tickSpacing = tickWord >= (1n << 255n) ? Number(tickWord - (1n << 256n)) : Number(tickWord);
  return {
    tokenIn: "0x" + w(0).slice(24),
    tokenOut: "0x" + w(1).slice(24),
    tickSpacing,
    recipient: "0x" + w(3).slice(24),
    deadline: BigInt("0x" + w(4)),
    amountIn: BigInt("0x" + w(5)),
    amountOutMinimum: BigInt("0x" + w(6)),
    sqrtPriceLimitX96: BigInt("0x" + w(7)),
    swapBytes: SLIPSTREAM_EXACT_INPUT_SINGLE_BYTES,
    trailingBytes: Math.floor((h.length - need) / 2),
  };
}

/**
 * WETH→HOME rotate fill. Never Uni QuoterV2 / SwapRouter02.
 */
export function rotateHomeSlipstreamBuyPath() {
  return {
    venue: "aerodrome-slipstream",
    symbol: VERIFIED_HOME_SYMBOL,
    tokenIn: BASE_WETH,
    tokenOut: VERIFIED_HOME_ADDRESS,
    pool: HOME_AERO_SLIPSTREAM_POOL,
    router: SLIPSTREAM_SWAP_ROUTER,
    quoter: SLIPSTREAM_QUOTER_V2,
    factory: SLIPSTREAM_FACTORY,
    tickSpacing: HOME_SLIPSTREAM_TICK_SPACING,
    fee: HOME_FEE_TIER,
    uniQuoterV2: null,
    uniSwapRouter02: null,
  };
}

export function isSlipstreamHomeBuyPath(path) {
  if (!path || typeof path !== "object") return false;
  return String(path.venue || "") === "aerodrome-slipstream"
    && String(path.router || "").toLowerCase() === SLIPSTREAM_SWAP_ROUTER.toLowerCase()
    && String(path.quoter || "").toLowerCase() === SLIPSTREAM_QUOTER_V2.toLowerCase()
    && String(path.pool || "").toLowerCase() === HOME_AERO_SLIPSTREAM_POOL.toLowerCase()
    && Number(path.tickSpacing) === HOME_SLIPSTREAM_TICK_SPACING
    && path.uniQuoterV2 == null
    && String(path.quoter || "").toLowerCase() !== BASE_QUOTER_V2.toLowerCase()
    && String(path.router || "").toLowerCase() !== UNISWAP_SWAP_ROUTER02_BASE.toLowerCase();
}

export function slipstreamApproveSpenders() {
  return [SLIPSTREAM_SWAP_ROUTER];
}
