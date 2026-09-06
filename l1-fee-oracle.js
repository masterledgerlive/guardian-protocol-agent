/**
 * Base L1 data-fee helper via the OP-Stack GasPriceOracle predeploy
 * `0x420000000000000000000000000000000000000F`.
 *
 * Prefer `getL1Fee(unsigned RLP)`. When full bytes are not available,
 * use `getL1FeeUpperBound(txSize)`. Failures return `{ ok: false }` so
 * hitch leftover math can fall back to L2 calldata-gas.
 *
 * Hitch cost is the *incremental* L1 fee of extra hitch/BTP bytes on a
 * typical SwapRouter02 exactInputSingle envelope — what we actually pay
 * to insert the message, not the whole swap's L1 fee.
 */

import { serializeTransaction } from "viem";

export const GAS_PRICE_ORACLE = "0x420000000000000000000000000000000000000F";
export const BASE_CHAIN_ID = 8453;
export const SWAP_ROUTER_BASE = "0x2626664c2603336E57B271c5C0b26F421741e481";
export const EXACT_INPUT_SINGLE_CALLDATA_BYTES = 228;
/** Conservative unsigned EIP-1559 envelope (measured ~45 on a typical swap). */
export const UNSIGNED_TX_OVERHEAD_BYTES = 50;
/** Lean BTP self-send inscription (header + short chunk). */
export const DEFAULT_BTP_CALLDATA_BYTES = 256;
export const DUMMY_SWAP_SELECTOR = "04e45aaf";

export const GAS_PRICE_ORACLE_ABI = [
  {
    name: "getL1Fee",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "_data", type: "bytes" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getL1FeeUpperBound",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "_unsignedTxSize", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
];

export function weiToEth(wei) {
  try {
    const w = typeof wei === "bigint" ? wei : BigInt(wei);
    if (w <= 0n) return 0;
    return Number(w) / 1e18;
  } catch {
    return 0;
  }
}

export function hexByteLength(hex) {
  const h = String(hex ?? "").replace(/^0x/i, "");
  if (!h || h.length % 2 !== 0) return 0;
  return h.length / 2;
}

export function estimateUnsignedTxSize({
  calldataBytes = EXACT_INPUT_SINGLE_CALLDATA_BYTES,
  hitchBytes = 0,
  overheadBytes = UNSIGNED_TX_OVERHEAD_BYTES,
} = {}) {
  return (
    Math.max(0, Number(overheadBytes) || 0)
    + Math.max(0, Number(calldataBytes) || 0)
    + Math.max(0, Number(hitchBytes) || 0)
  );
}

export function dummySwapCalldata(hitchBytes = 0, hitchData) {
  const base = DUMMY_SWAP_SELECTOR + "00".repeat(224);
  if (hitchData) return "0x" + base + String(hitchData).replace(/^0x/i, "");
  const n = Math.max(0, Math.floor(Number(hitchBytes) || 0));
  // Non-zero padding (0x4c = 'L' of LIBM) so compression matches hitch.
  return "0x" + base + "4c".repeat(n);
}

export function asWei(v) {
  if (typeof v === "bigint") return v;
  if (v == null || v === "") return 0n;
  try {
    return BigInt(v);
  } catch {
    return 0n;
  }
}

/**
 * Unsigned EIP-1559 RLP for a typical Base SwapRouter02 swap + hitch.
 * Used as `getL1Fee` input when the live swap is not serialized yet.
 */
export function serializeUnsignedSwapTx({
  hitchBytes = 0,
  hitchData,
  to = SWAP_ROUTER_BASE,
  nonce = 0,
  gas = 500_000n,
  maxFeePerGas = 1_000_000n,
  maxPriorityFeePerGas = 1_000_000n,
  value = 0n,
  chainId = BASE_CHAIN_ID,
} = {}) {
  return serializeTransaction({
    chainId,
    type: "eip1559",
    nonce,
    to,
    value,
    data: dummySwapCalldata(hitchBytes, hitchData),
    gas,
    maxFeePerGas,
    maxPriorityFeePerGas,
  });
}

export function trySerializeUnsignedSwapTx(opts) {
  try {
    return serializeUnsignedSwapTx(opts);
  } catch {
    return null;
  }
}

/**
 * Live oracle read. Prefers `getL1Fee(bytes)`; falls through to
 * `getL1FeeUpperBound(txSize)` when RLP is missing or getL1Fee fails.
 */
export async function readL1FeeWei(readContract, { unsignedTx, txSize } = {}) {
  const hex = typeof unsignedTx === "string" && unsignedTx.startsWith("0x")
    ? unsignedTx
    : null;
  const sizeFromHex = hex ? hexByteLength(hex) : 0;
  const size = Number(txSize > 0 ? txSize : sizeFromHex);

  if (hex) {
    try {
      const wei = await readContract({
        address: GAS_PRICE_ORACLE,
        abi: GAS_PRICE_ORACLE_ABI,
        functionName: "getL1Fee",
        args: [hex],
      });
      return { wei, source: "getL1Fee", txSize: sizeFromHex || size };
    } catch {
      // Fjord upper bound when full RLP call fails.
    }
  }

  if (!Number.isFinite(size) || size <= 0) {
    throw new Error("L1 fee: need unsignedTx or txSize");
  }
  const wei = await readContract({
    address: GAS_PRICE_ORACLE,
    abi: GAS_PRICE_ORACLE_ABI,
    functionName: "getL1FeeUpperBound",
    args: [BigInt(Math.floor(size))],
  });
  return { wei, source: "getL1FeeUpperBound", txSize: Math.floor(size) };
}

async function feeForHitchBytes(readContract, hitchBytes) {
  const serialized = trySerializeUnsignedSwapTx({ hitchBytes });
  if (serialized) {
    return readL1FeeWei(readContract, {
      unsignedTx: serialized,
      txSize: hexByteLength(serialized),
    });
  }
  return readL1FeeWei(readContract, {
    txSize: estimateUnsignedTxSize({ hitchBytes }),
  });
}

/**
 * Incremental L1 ETH of `hitchBytes` on a typical swap, plus optional
 * full L1 of a separate BTP self-send inscription.
 *
 * @param {object} opts
 * @param {Function} opts.readContract  viem-style `client.readContract`
 * @param {string}   [opts.unsignedTx]  full unsigned RLP hex when available
 */
export async function estimateHitchL1FeeEth({
  hitchBytes = 10,
  storeBytes = 10,
  btpInscribe = false,
  btpCalldataBytes = DEFAULT_BTP_CALLDATA_BYTES,
  unsignedTx,
  readContract,
} = {}) {
  const wanted = Math.max(0, Math.floor(Number(hitchBytes) || 0));
  const store = Math.max(0, Math.floor(Number(storeBytes) || 0));
  if (typeof readContract !== "function") {
    return emptyL1Quote("fallback");
  }

  try {
    let bearing;
    if (unsignedTx) {
      bearing = await readL1FeeWei(readContract, { unsignedTx });
    } else {
      bearing = await feeForHitchBytes(readContract, wanted);
    }

    let hitchWei = asWei(bearing.wei);
    let incremental = false;
    if (!unsignedTx && wanted > 0) {
      try {
        const base = await feeForHitchBytes(readContract, 0);
        const delta = hitchWei - asWei(base.wei);
        hitchWei = delta > 0n ? delta : 0n;
        incremental = true;
      } catch {
        // Keep full hitch-bearing fee — conservative, never under-cover.
      }
    }

    let btpL1FeeEth = 0;
    if (btpInscribe) {
      try {
        const btp = await readL1FeeWei(readContract, {
          txSize: estimateUnsignedTxSize({
            calldataBytes: btpCalldataBytes,
            hitchBytes: 0,
          }),
        });
        btpL1FeeEth = weiToEth(btp.wei);
      } catch {
        btpL1FeeEth = 0;
      }
    }

    const l1FeeEth = weiToEth(hitchWei);
    const perByte = wanted > 0 ? l1FeeEth / wanted : 0;
    const reservedL1FeeEth = wanted > 0 && store !== wanted
      ? perByte * store
      : l1FeeEth;

    return {
      ok: true,
      l1FeeEth,
      reservedL1FeeEth,
      l1FeePerByteEth: perByte,
      btpL1FeeEth,
      source: bearing.source,
      incremental,
      txSize: bearing.txSize,
      wei: hitchWei,
    };
  } catch (e) {
    const q = emptyL1Quote("fallback");
    q.error = e?.message || String(e);
    return q;
  }
}

function emptyL1Quote(source) {
  return {
    ok: false,
    source,
    l1FeeEth: 0,
    reservedL1FeeEth: 0,
    l1FeePerByteEth: 0,
    btpL1FeeEth: 0,
    incremental: false,
    txSize: 0,
  };
}

export function formatHitchFeeSplit({
  l1FeeEth = 0,
  l2FeeEth = 0,
  btpL1FeeEth = 0,
  source = "fallback",
} = {}) {
  const l1 = Number(l1FeeEth) || 0;
  const l2 = Number(l2FeeEth) || 0;
  const btp = Number(btpL1FeeEth) || 0;
  const btpBit = btp > 0 ? ` + BTP L1 ${btp.toExponential(2)} ETH` : "";
  return `HITCH FEE — L1 ${l1.toExponential(2)} ETH (${source}) + L2 ${l2.toExponential(2)} ETH${btpBit}`;
}
