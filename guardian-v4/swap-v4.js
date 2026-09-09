/**
 * Uniswap V4 Universal Router encoding + Eureka hitch for Guardian V4.
 *
 * Hitch rule (same as V3 live bot): UTF-8 Eureka trailer APPENDS after the
 * complete `execute` calldata. Never overwrite the swap prefix. Only hitch
 * when leftover covers cost — never lose money to insert the love note.
 */

import { encodeAbiParameters, encodeFunctionData, encodePacked, parseAbiParameters } from "viem";
import {
  HOOKS_NONE,
  NATIVE_ETH,
  SLIPPAGE,
  UNIVERSAL_ROUTER,
  WETH,
} from "./config.js";

/** Universal Router Commands */
export const CMD_V4_SWAP = 0x10;

/** V4Router Actions */
export const ACTION_SWAP_EXACT_IN_SINGLE = 0x06;
export const ACTION_SETTLE_ALL = 0x0c;
export const ACTION_TAKE_ALL = 0x0f;

export const STORE_VOICE_TAG = "§$STORE§";
export const VITA_PROOF_MESSAGE =
  "Eureka! VITA lives \u2665 love you Krystian, Kai & Koda!";
export const VITA_PROOF_FULL =
  `Eureka! VITA lives \u2665 love you Krystian, Kai & Koda! We did it! xoxo` +
  ` \u2014 Love, DA | \u16DE\u16A8\u16A1\u16AA\u16DE` +
  ` | "The truth is the chain. The chain is alive. The heartbeat never stops."` +
  ` \u2014 INFINITUM \u00D7 IKN \u00D7 The Living Network`;

export const EXECUTE_ABI = [
  {
    type: "function",
    name: "execute",
    stateMutability: "payable",
    inputs: [
      { name: "commands", type: "bytes" },
      { name: "inputs", type: "bytes[]" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [],
  },
];

export function utf8ByteLength(text) {
  return Buffer.byteLength(String(text ?? ""), "utf8");
}

export function clipUtf8(text, maxBytes) {
  let s = String(text ?? "");
  if (maxBytes == null || !Number.isFinite(Number(maxBytes))) return s;
  const cap = Math.floor(Number(maxBytes));
  if (cap <= 0) return "";
  let buf = Buffer.from(s, "utf8");
  if (buf.length <= cap) return s;
  while (buf.length > cap && s.length) {
    s = s.slice(0, -1);
    buf = Buffer.from(s, "utf8");
  }
  return s;
}

export function buildStoreVoice({
  tag = STORE_VOICE_TAG,
  message = VITA_PROOF_FULL,
  maxBytes,
} = {}) {
  const body = message ? `${tag} ${message}` : String(tag || "");
  return clipUtf8(body, maxBytes);
}

export function encodingDoesNotLoseMoney({ leftoverEth, hitchCostEth } = {}) {
  const left = Number(leftoverEth);
  const cost = Number(hitchCostEth);
  if (!Number.isFinite(left) || left <= 0) return false;
  if (!Number.isFinite(cost) || cost < 0) return false;
  return left >= cost;
}

/** Append UTF-8 hitch after any complete swap calldata; refuse if prefix would change. */
export function appendUtf8Hitch(swapData, text, { maxBytes } = {}) {
  const orig = String(swapData || "").toLowerCase().startsWith("0x")
    ? String(swapData)
    : `0x${swapData || ""}`;
  const clipped = clipUtf8(text, maxBytes);
  if (!clipped) {
    return { ok: true, data: orig, hitchBytes: 0, utf8: "", onChain: false, log: null };
  }
  if (orig.length < 10) {
    return {
      ok: false,
      data: orig,
      hitchBytes: 0,
      utf8: "",
      onChain: false,
      log: "V4 hitch: swap calldata too short",
    };
  }
  const data = orig + Buffer.from(clipped, "utf8").toString("hex");
  if (!data.toLowerCase().startsWith(orig.toLowerCase())) {
    return {
      ok: false,
      data: orig,
      hitchBytes: 0,
      utf8: "",
      onChain: false,
      log: "V4 hitch: packing would overwrite swap prefix — refuse",
    };
  }
  return {
    ok: true,
    data,
    hitchBytes: utf8ByteLength(clipped),
    utf8: clipped,
    onChain: true,
    log: null,
  };
}

export function decodeTrailingUtf8(data, prefixHexLen) {
  const hex = String(data || "").replace(/^0x/i, "").toLowerCase();
  const start = Number(prefixHexLen);
  if (!Number.isFinite(start) || start <= 0 || hex.length <= start) return "";
  const trail = hex.slice(start);
  if (!trail || trail.length % 2) return "";
  try {
    return Buffer.from(trail, "hex").toString("utf8");
  } catch {
    return "";
  }
}

export function encodeStoreVoiceCalldata(text) {
  return "0x" + Buffer.from(String(text ?? ""), "utf8").toString("hex");
}

export function feePctToUint24(feePct) {
  const n = Number(feePct);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 10000);
}

export function defaultTickSpacing(fee) {
  const f = Number(fee);
  if (f <= 100) return 1;
  if (f <= 500) return 10;
  if (f <= 3000) return 60;
  if (f <= 10000) return 200;
  return 200;
}

export function sortCurrencies(a, b) {
  const A = String(a).toLowerCase();
  const B = String(b).toLowerCase();
  return BigInt(A) < BigInt(B) ? [A, B] : [B, A];
}

export function normalizeCurrency(addr) {
  const a = String(addr || "").toLowerCase();
  if (a === "eth" || a === "native") return NATIVE_ETH;
  return a;
}

/**
 * Build a V4 PoolKey. Native ETH pools use currency = address(0), not WETH.
 */
export function buildPoolKey({
  currencyA,
  currencyB,
  fee,
  tickSpacing,
  hooks = HOOKS_NONE,
} = {}) {
  const a = normalizeCurrency(currencyA);
  const b = normalizeCurrency(currencyB);
  if (!a || !b) throw new Error("V4 pool key: missing currency");
  const feeN = Number(fee);
  if (!Number.isFinite(feeN) || feeN < 0) throw new Error("V4 pool key: bad fee");
  const [currency0, currency1] = sortCurrencies(a, b);
  const spacing = tickSpacing == null ? defaultTickSpacing(feeN) : Number(tickSpacing);
  return {
    currency0,
    currency1,
    fee: feeN,
    tickSpacing: spacing,
    hooks: String(hooks || HOOKS_NONE).toLowerCase(),
  };
}

/** abi.encode(ExactInputSingleParams) */
export function encodeExactInputSingleParams({
  poolKey,
  zeroForOne,
  amountIn,
  amountOutMinimum,
  hookData = "0x",
} = {}) {
  return encodeAbiParameters(
    [
      {
        type: "tuple",
        components: [
          {
            type: "tuple",
            name: "poolKey",
            components: [
              { type: "address", name: "currency0" },
              { type: "address", name: "currency1" },
              { type: "uint24", name: "fee" },
              { type: "int24", name: "tickSpacing" },
              { type: "address", name: "hooks" },
            ],
          },
          { type: "bool", name: "zeroForOne" },
          { type: "uint128", name: "amountIn" },
          { type: "uint128", name: "amountOutMinimum" },
          { type: "bytes", name: "hookData" },
        ],
      },
    ],
    [
      {
        poolKey: {
          currency0: poolKey.currency0,
          currency1: poolKey.currency1,
          fee: poolKey.fee,
          tickSpacing: poolKey.tickSpacing,
          hooks: poolKey.hooks,
        },
        zeroForOne: !!zeroForOne,
        amountIn: BigInt(amountIn),
        amountOutMinimum: BigInt(amountOutMinimum),
        hookData: hookData || "0x",
      },
    ],
  );
}

/**
 * Encode UniversalRouter.execute calldata for a single-hop V4 exact-in swap.
 */
export function encodeV4ExactInSwap({
  tokenIn,
  tokenOut,
  fee,
  tickSpacing,
  hooks = HOOKS_NONE,
  amountIn,
  amountOutMinimum = 0n,
  deadline,
  hookData = "0x",
} = {}) {
  const inC = normalizeCurrency(tokenIn);
  const outC = normalizeCurrency(tokenOut);
  const poolKey = buildPoolKey({
    currencyA: inC,
    currencyB: outC,
    fee,
    tickSpacing,
    hooks,
  });
  const zeroForOne = inC.toLowerCase() === poolKey.currency0.toLowerCase();
  const amountInBn = BigInt(amountIn);
  const minOutBn = BigInt(amountOutMinimum ?? 0n);
  const dl = BigInt(deadline ?? Math.floor(Date.now() / 1000) + 300);

  const actions = encodePacked(
    ["uint8", "uint8", "uint8"],
    [ACTION_SWAP_EXACT_IN_SINGLE, ACTION_SETTLE_ALL, ACTION_TAKE_ALL],
  );

  const swapParams = encodeExactInputSingleParams({
    poolKey,
    zeroForOne,
    amountIn: amountInBn,
    amountOutMinimum: minOutBn,
    hookData,
  });
  const settleParams = encodeAbiParameters(parseAbiParameters("address, uint256"), [
    inC,
    amountInBn,
  ]);
  const takeParams = encodeAbiParameters(parseAbiParameters("address, uint256"), [
    outC,
    minOutBn,
  ]);

  const v4Input = encodeAbiParameters(parseAbiParameters("bytes, bytes[]"), [
    actions,
    [swapParams, settleParams, takeParams],
  ]);

  const commands = encodePacked(["uint8"], [CMD_V4_SWAP]);
  const calldata = encodeFunctionData({
    abi: EXECUTE_ABI,
    functionName: "execute",
    args: [commands, [v4Input], dl],
  });

  return {
    to: UNIVERSAL_ROUTER,
    data: calldata,
    value: inC === NATIVE_ETH ? amountInBn : 0n,
    poolKey,
    zeroForOne,
    commands,
    prefixHexLen: (calldata.length - 2) / 1, // hex char count without 0x — for hitch decode use length-2
    swapPrefix: calldata,
  };
}

export function hitchSwapIfCovered({
  swapData,
  leftoverEth,
  hitchCostEth,
  message = VITA_PROOF_FULL,
  tag = STORE_VOICE_TAG,
  utf8 = null,
} = {}) {
  const voice = utf8 != null && utf8 !== "" ? String(utf8) : buildStoreVoice({ tag, message });
  if (!encodingDoesNotLoseMoney({ leftoverEth, hitchCostEth })) {
    return {
      data: swapData,
      hitchBytes: 0,
      utf8: "",
      onChain: false,
      skipped: true,
      reason: "leftover cannot cover hitch — plain swap (letter skipped, no loss)",
    };
  }
  const hitch = appendUtf8Hitch(swapData, voice);
  if (!hitch.ok || !hitch.onChain) {
    return {
      data: swapData,
      hitchBytes: 0,
      utf8: "",
      onChain: false,
      skipped: true,
      reason: hitch.log || "hitch refused",
    };
  }
  return {
    data: hitch.data,
    hitchBytes: hitch.hitchBytes,
    utf8: hitch.utf8,
    onChain: true,
    skipped: false,
    reason: null,
  };
}

export function slippageFloor(expectedWei, slippage = SLIPPAGE) {
  const exp = BigInt(expectedWei);
  if (exp <= 0n) return 0n;
  const s = Number(slippage);
  if (!Number.isFinite(s) || s <= 0 || s > 1) return (exp * 85n) / 100n;
  return (exp * BigInt(Math.round(s * 1000))) / 1000n;
}

export { UNIVERSAL_ROUTER, WETH };
