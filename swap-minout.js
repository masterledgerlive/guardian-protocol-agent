/**
 * Uniswap V3 exactInputSingle amountOutMinimum sanity.
 *
 * Impossible floors brick exits: RISK TOSHI→WETH sells
 *   0x134bb40c9807fe2ebc48ab77a5a69cdbc29dea15c636a19acd43a7458521d3c6
 *   0x693af50a02fd00cfb69ffee9e59c8a38bd86ea1f24a44be22dcdcd563033d8d3
 * packed amountIn ≈ 4424 TOSHI but amountOutMinimum ≈ 93.2k–93.6k WETH.
 * Hitch/BTP was trailing LIBM (did not overwrite the slot) — quote/slippage
 * math produced the floor. This helper refuses that class of calldata.
 *
 * Does not size trades, hitch cover, LOSE_ZERO, or the frozen buy gate.
 */

export const EXACT_INPUT_SINGLE_SELECTOR = "04e45aaf";
export const EXACT_INPUT_SINGLE_BYTES = 228; // 4 + 7*32
export const SLIPPAGE_GUARD_DEFAULT = 0.85;
export const FALLBACK_SLIPPAGE = 0.75;

/** Clamp when minOut is only modestly above trusted expected (rounding / stale cache). */
export const MINOUT_CLAMP_RATIO = 2n;
/** Quote this many times spot is treated as garbage — do not clamp toward it. */
export const QUOTE_INSANE_VS_SPOT = 10n;
/** minOut this many times spot is an impossible floor. */
export const MINOUT_REJECT_VS_SPOT = 10n;

export function asBigInt(v) {
  if (typeof v === "bigint") return v;
  if (v == null || v === "") return null;
  try {
    if (typeof v === "number") {
      if (!Number.isFinite(v) || v < 0) return null;
      return BigInt(Math.floor(v));
    }
    return BigInt(v);
  } catch {
    return null;
  }
}

/** Human units → wei. Same shape as the old `Math.floor(x * 1e18)` but honors decimals. */
export function toWei(human, decimals = 18) {
  const n = Number(human);
  const d = Number(decimals);
  if (!Number.isFinite(n) || n <= 0 || !Number.isFinite(d) || d < 0 || d > 36) return 0n;
  return BigInt(Math.floor(n * 10 ** d));
}

/**
 * Spot expected out in wei: inAmount * inUsd / outUsd.
 * Sell: token human * tokenUsd / ethUsd → WETH wei (18).
 * Buy:  ETH human * ethUsd / tokenUsd → token wei (token decimals).
 */
export function spotOutWei({ amountInHuman, inUsd, outUsd, outDecimals = 18 } = {}) {
  const amt = Number(amountInHuman);
  const inn = Number(inUsd);
  const out = Number(outUsd);
  const dec = Number(outDecimals);
  if (![amt, inn, out, dec].every(Number.isFinite)) return 0n;
  if (amt <= 0 || inn <= 0 || out <= 0 || dec < 0) return 0n;
  return toWei(amt * inn / out, dec);
}

export function slippageFloor(expectedWei, slippage = SLIPPAGE_GUARD_DEFAULT) {
  const exp = asBigInt(expectedWei);
  if (exp == null || exp <= 0n) return 0n;
  const s = Number(slippage);
  if (!Number.isFinite(s) || s <= 0 || s > 1) return exp * 85n / 100n;
  return exp * BigInt(Math.round(s * 1000)) / 1000n;
}

export function formatWei18(wei) {
  const v = asBigInt(wei);
  if (v == null) return "?";
  const neg = v < 0n;
  const a = neg ? -v : v;
  const whole = a / 10n ** 18n;
  const frac = (a % 10n ** 18n).toString().padStart(18, "0").slice(0, 6);
  return `${neg ? "-" : ""}${whole}.${frac}`;
}

function padWord(hex) {
  if (hex.length > 64) {
    throw new Error(`MINOUT: uint256 overflow encoding (${hex.length} hex chars)`);
  }
  return hex.padStart(64, "0");
}

function word(v, isAddr = false) {
  if (isAddr) {
    const h = String(v || "").replace(/^0x/i, "").toLowerCase();
    if (!/^[0-9a-f]{40}$/.test(h)) throw new Error("MINOUT: invalid address for exactInputSingle");
    return padWord(h);
  }
  const n = asBigInt(v);
  if (n == null || n < 0n) throw new Error("MINOUT: invalid uint256 for exactInputSingle");
  return padWord(n.toString(16));
}

/**
 * SwapRouter02 exactInputSingle (no deadline) — selector 0x04e45aaf.
 * 7 static words; trailing bytes (hitch / BTP) are ignored by the router
 * only if they start AFTER these 228 bytes.
 */
export function encodeExactInputSingle({
  tokenIn,
  tokenOut,
  fee = 3000,
  recipient,
  amountIn,
  amountOutMinimum = 0n,
  sqrtPriceLimitX96 = 0n,
} = {}) {
  return (
    "0x" +
    EXACT_INPUT_SINGLE_SELECTOR +
    word(tokenIn, true) +
    word(tokenOut, true) +
    word(fee) +
    word(recipient, true) +
    word(amountIn) +
    word(amountOutMinimum) +
    word(sqrtPriceLimitX96)
  );
}

export function decodeExactInputSingle(data) {
  const h = String(data || "").replace(/^0x/i, "").toLowerCase();
  if (h.length < 8 + 7 * 64) return null;
  if (h.slice(0, 8) !== EXACT_INPUT_SINGLE_SELECTOR) return null;
  const w = (i) => h.slice(8 + i * 64, 8 + (i + 1) * 64);
  return {
    tokenIn: "0x" + w(0).slice(24),
    tokenOut: "0x" + w(1).slice(24),
    fee: Number(BigInt("0x" + w(2))),
    recipient: "0x" + w(3).slice(24),
    amountIn: BigInt("0x" + w(4)),
    amountOutMinimum: BigInt("0x" + w(5)),
    sqrtPriceLimitX96: BigInt("0x" + w(6)),
    swapBytes: EXACT_INPUT_SINGLE_BYTES,
    trailingBytes: Math.floor((h.length - (8 + 7 * 64)) / 2),
  };
}

/** Hitch/BTP must APPEND after the 228-byte swap. Overwriting amountOutMinimum is a refuse. */
export function hitchPreservesSwapPrefix(originalData, injectedData) {
  const norm = (d) => {
    const s = String(d || "").toLowerCase();
    return s.startsWith("0x") ? s : `0x${s}`;
  };
  const orig = norm(originalData);
  const inj = norm(injectedData);
  if (orig.length < 2 + EXACT_INPUT_SINGLE_BYTES * 2) {
    return { ok: false, log: "MINOUT: hitch check — original swap calldata too short" };
  }
  if (!orig.startsWith("0x" + EXACT_INPUT_SINGLE_SELECTOR)) {
    return { ok: false, log: "MINOUT: hitch check — original is not exactInputSingle" };
  }
  if (!inj.startsWith(orig)) {
    const decO = decodeExactInputSingle(orig);
    const decI = decodeExactInputSingle(inj);
    const minChanged = decO && decI && decO.amountOutMinimum !== decI.amountOutMinimum;
    const detail = minChanged
      ? ` (amountOutMinimum ${formatWei18(decO.amountOutMinimum)} → ${formatWei18(decI.amountOutMinimum)})`
      : "";
    return {
      ok: false,
      log: `MINOUT: hitch/BTP packing overwrote swap prefix${detail} — refusing hitch`,
    };
  }
  return { ok: true, log: null };
}

/**
 * Genesis / $STORE voice: hitch is UTF-8 after the 228-byte swap so Basescan
 * "View Input As UTF-8" shows the letter. Never invent a hash. Never claim
 * Telegram text is on-chain unless this trailer is actually in the sent tx.
 *
 * Live KEYCAT sell 0x5c0a93e4… was 228 bytes, no trailer — Telegram lied.
 */
export const STORE_VOICE_TAG = "§$STORE§";
export const VITA_PROOF_MESSAGE =
  "Eureka! VITA lives \u2665 love you Krystian, Kai & Koda!";

/** KEYCAT→WETH 0x5c0a93e4707a4dcf49afd4c785cb2829bce11ed026e08ba08435272d19122adf */
export const KEYCAT_PLAIN_SWAP =
  "0x04e45aaf" +
  "0000000000000000000000009a26f5433671751c3276a065f57e5a02d2817973" +
  "0000000000000000000000004200000000000000000000000000000000000006" +
  "0000000000000000000000000000000000000000000000000000000000002710" +
  "00000000000000000000000050e1c4608c48b0c52e1ea5fbabc1c9126ea17915" +
  "00000000000000000000000000000000000000000000008a9a9fb5d27da80000" +
  "000000000000000000000000000000000000000000000000000241b69d13937f" +
  "0000000000000000000000000000000000000000000000000000000000000000";

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
  message = VITA_PROOF_MESSAGE,
  maxBytes,
} = {}) {
  const body = message ? `${tag} ${message}` : String(tag || "");
  return clipUtf8(body, maxBytes);
}

export function decodeTrailingUtf8(data) {
  const hex = String(data || "").replace(/^0x/i, "").toLowerCase();
  if (hex.length < EXACT_INPUT_SINGLE_BYTES * 2) return "";
  if (!hex.startsWith(EXACT_INPUT_SINGLE_SELECTOR)) return "";
  const trail = hex.slice(EXACT_INPUT_SINGLE_BYTES * 2);
  if (!trail || trail.length % 2) return "";
  try {
    return Buffer.from(trail, "hex").toString("utf8");
  } catch {
    return "";
  }
}

/**
 * Append UTF-8 hitch after exactInputSingle. Refuses if it would smash the
 * 228-byte prefix / amountOutMinimum. Truncates to maxBytes.
 */
export function appendUtf8Hitch(swapData, text, { maxBytes } = {}) {
  const orig = String(swapData || "").toLowerCase().startsWith("0x")
    ? String(swapData)
    : `0x${swapData || ""}`;
  const clipped = clipUtf8(text, maxBytes);
  if (!clipped) {
    return { ok: true, data: orig, hitchBytes: 0, utf8: "", onChain: false, log: null };
  }
  const data = orig + Buffer.from(clipped, "utf8").toString("hex");
  const prefix = hitchPreservesSwapPrefix(orig, data);
  if (!prefix.ok) {
    return { ok: false, data: orig, hitchBytes: 0, utf8: "", onChain: false, log: prefix.log };
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

/**
 * Before submit: amountOutMinimum must sit under a quoted expected out (preferred)
 * or a USD spot estimate, inside a sane slippage band.
 *
 * @returns {{ allow: boolean, amountOutMinimum: bigint, action: 'ok'|'clamp'|'reject', log: string|null }}
 *
 * - minOut == 0: allow (protective / quote-error path). Does not weaken hitch or LOSE_ZERO.
 * - minOut <= trusted expected: allow as-is.
 * - minOut > trusted but we have a quote/spot: clamp to slippage*trusted and allow
 *   (do not send the impossible floor; send the sane one so exits are not bricked).
 * - no quote and no spot, minOut > 0: reject — do not send.
 */
export function sanitizeAmountOutMinimum({
  minOut,
  expectedOut = null,
  spotOut = null,
  slippage = SLIPPAGE_GUARD_DEFAULT,
  side = "swap",
  symbol = "?",
} = {}) {
  const min = asBigInt(minOut) ?? 0n;
  const quote = asBigInt(expectedOut);
  const spot = asBigInt(spotOut);

  if (min === 0n) {
    return { allow: true, amountOutMinimum: 0n, action: "ok", log: null };
  }

  let trusted = null;
  let trustedSrc = null;
  if (quote != null && quote > 0n && spot != null && spot > 0n) {
    if (quote > spot * QUOTE_INSANE_VS_SPOT) {
      trusted = spot;
      trustedSrc = "spot (quote insane vs spot)";
    } else {
      trusted = quote;
      trustedSrc = "quote";
    }
  } else if (quote != null && quote > 0n) {
    trusted = quote;
    trustedSrc = "quote";
  } else if (spot != null && spot > 0n) {
    trusted = spot;
    trustedSrc = "spot";
  }

  if (trusted == null) {
    return {
      allow: false,
      amountOutMinimum: 0n,
      action: "reject",
      log: `MINOUT: reject ${side} ${symbol} — minOut=${formatWei18(min)} with no quote or spot; refusing to send`,
    };
  }

  if (spot != null && spot > 0n && min > spot * MINOUT_REJECT_VS_SPOT) {
    const clamped = slippageFloor(trusted, slippage);
    return {
      allow: true,
      amountOutMinimum: clamped,
      action: "clamp",
      log:
        `MINOUT: clamp ${side} ${symbol} — minOut ${formatWei18(min)} is >${MINOUT_REJECT_VS_SPOT}× ` +
        `spot ${formatWei18(spot)} (impossible floor). Using ${formatWei18(clamped)} ` +
        `(${Math.round(Number(slippage) * 100)}% of ${trustedSrc}). Not sending the absurd floor.`,
    };
  }

  if (min > trusted) {
    const clamped = slippageFloor(trusted, slippage);
    const huge = min > trusted * MINOUT_CLAMP_RATIO;
    return {
      allow: true,
      amountOutMinimum: clamped,
      action: "clamp",
      log:
        `MINOUT: clamp ${side} ${symbol} — minOut ${formatWei18(min)} > ${trustedSrc} ` +
        `${formatWei18(trusted)}${huge ? " (orders of magnitude / >2×)" : ""}. ` +
        `Using ${formatWei18(clamped)}. Not sending the impossible floor.`,
    };
  }

  return { allow: true, amountOutMinimum: min, action: "ok", log: null };
}

/** Live RISK TOSHI→WETH bricks — used as regression fixtures. */
export const TOSHI_FAILED_SELLS = [
  {
    tx: "0x134bb40c9807fe2ebc48ab77a5a69cdbc29dea15c636a19acd43a7458521d3c6",
    amountIn: 4424634735468239388672n,
    amountOutMinimum: 93556434008871811416064n,
  },
  {
    tx: "0x693af50a02fd00cfb69ffee9e59c8a38bd86ea1f24a44be22dcdcd563033d8d3",
    amountIn: 4424634735468239388672n,
    amountOutMinimum: 93196585628643654369280n,
  },
];
