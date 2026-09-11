/**
 * Quote → SwapRouter02 exactInputSingle guard.
 *
 * Live GAME buys (RISK 0x50e1…7915, blocks 51106117–51106192):
 *   0x2644773a875e2cfb67f8d85ec329f326a68406b5f66c327250b8404ffcacfef0
 *   0x2589e0a31f898e1166c490570025f25853d6d8c98b7f81846d50ab2405d45421
 *   0x280e898e641e52b1463db16de656bc67b583bdc7d97b9ebe4b3206a167b26b87
 *
 * Catalog fee 3000 pointed at an empty Uni V3 GAME/WETH pool (liquidity=0).
 * QuoterV2 reverted on every RPC; executeBuy still sent exactInputSingle with
 * DexScreener/Aerodrome spot minOut + UTF-8 hitch. SwapRouter02 reverted
 * (~788k of 800k gas). Cooldown armed after the third mined revert — too late.
 *
 * Live Uni V3 GAME/WETH book is fee 10000 (pool 0xE5Ff…77a3).
 * GAME catalog freeze (exits-only) landed on main in #60 — this module does
 * not re-freeze GAME; it stops *other* names from buying a ghost/thin V3 fee.
 *
 * Does not size P&L. Does not touch Uni V4.
 */

import {
  asBigInt,
  formatWei18,
  QUOTE_INSANE_VS_SPOT,
  encodingDoesNotLoseMoney,
} from "./swap-minout.js";
import { BASE_WETH, BASE_USDC, BASE_USDBC, NATIVE_ETH } from "./price-oracle.js";

export const V3_FEE_TIERS = [100, 500, 3000, 10000];
/** After catalog miss, try wider fees first — 100/500 ghosts quote before the live 1% book. */
export const V3_FEE_PROBE_ORDER = [10000, 3000, 500, 100];
export const UNISWAP_V3_FACTORY_BASE = "0x33128a8fC17869897dcE68Ed026d694621f6FDfD";
/** Below this, a $3–11 RISK fill eats the Uni V3 WETH book (GAME 1% ~$2.8k). */
export const MIN_SWAP_POOL_LIQ_USD = 25_000;
/** Refuse a fill that is this fraction of the SwapRouter pool. */
export const MAX_TRADE_FRAC_OF_POOL = 0.05;
/**
 * If the Uni V3 WETH pool is a small fraction of the deepest DexScreener
 * book, that book is not the SwapRouter path (GAME Uni V2 VIRTUAL ~$2.1M vs
 * V3 WETH ~$2.8k).
 */
export const MIN_SWAP_VS_PRIMARY_FRAC = 0.25;

/** Empty Uni V3 GAME/WETH 0.3% — catalog used to send here. */
export const GAME_EMPTY_FEE_3000_POOL = "0x70fbffe313d4a40909dba7129e0b2f4a45a645b5";
/** Live Uni V3 GAME/WETH 1% (DexScreener Uniswap v3 WETH). */
export const GAME_LIVE_FEE_10000_POOL = "0xe5ff624bc6c0f85c5e1e27f94366b5829b1877a3";
export const GAME_TOKEN = "0x1C4CcA7C5DB003824208aDDA61Bd749e55F463a3";

/** First failed GAME buy — WETH→GAME fee 3000 + §$STORE§ hitch, status=0. */
export const GAME_FAILED_BUY = {
  tx: "0x2644773a875e2cfb67f8d85ec329f326a68406b5f66c327250b8404ffcacfef0",
  block: 51106117,
  fee: 3000,
  amountIn: 741707684889136n,
  amountOutMinimum: 274910004669641932800n,
  hitchBytes: 229,
  gasUsed: 788060,
  gasLimit: 800000,
};

/** Live DexScreener GAME books — primary is Uni V2 VIRTUAL, not V3 WETH. */
export const GAME_DEX_PAIRS = [
  {
    chainId: "base",
    dexId: "uniswap",
    labels: ["v2"],
    pairAddress: "0xD418dfE7670c21F682E041F34250c114DB5D7789",
    liquidity: { usd: 2_135_557 },
    volume: { h24: 35_968 },
    priceUsd: "0.004953",
    baseToken: { address: GAME_TOKEN },
    quoteToken: { address: "0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b", symbol: "VIRTUAL" },
  },
  {
    chainId: "base",
    dexId: "aerodrome",
    pairAddress: "0x2A36148a416cBa81699B555120Bd65f4682BDFD2",
    liquidity: { usd: 6_620 },
    volume: { h24: 767 },
    priceUsd: "0.004926",
    baseToken: { address: GAME_TOKEN },
    quoteToken: { address: BASE_WETH, symbol: "WETH" },
  },
  {
    chainId: "base",
    dexId: "uniswap",
    labels: ["v3"],
    pairAddress: GAME_LIVE_FEE_10000_POOL,
    liquidity: { usd: 2_795 },
    volume: { h24: 25 },
    priceUsd: "0.005026",
    baseToken: { address: GAME_TOKEN },
    quoteToken: { address: BASE_WETH, symbol: "WETH" },
  },
];

function pairQuoteAddress(p) {
  return String(p?.quoteToken?.address || "").toLowerCase();
}

function pairBaseAddress(p) {
  return String(p?.baseToken?.address || "").toLowerCase();
}

export function isUniswapV3Pair(pair) {
  if (String(pair?.dexId || "").toLowerCase() !== "uniswap") return false;
  const labels = pair?.labels;
  if (Array.isArray(labels)) {
    return labels.some((l) => String(l).toLowerCase() === "v3");
  }
  return false;
}

function isWethAddress(addr) {
  const q = String(addr || "").toLowerCase();
  return q === BASE_WETH.toLowerCase() || q === NATIVE_ETH.toLowerCase();
}

function isWethOrUsdcAddress(addr) {
  const q = String(addr || "").toLowerCase();
  return isWethAddress(addr)
    || q === BASE_USDC.toLowerCase()
    || q === BASE_USDBC.toLowerCase();
}

export function isWethQuotePair(pair) {
  return isWethAddress(pairQuoteAddress(pair))
    || isWethAddress(pairBaseAddress(pair));
}

export function isWethOrUsdcQuotePair(pair) {
  return isWethOrUsdcAddress(pairQuoteAddress(pair))
    || isWethOrUsdcAddress(pairBaseAddress(pair));
}

export function summarizeDexPair(pair) {
  if (!pair) return null;
  return {
    dexId: pair.dexId || null,
    labels: Array.isArray(pair.labels) ? pair.labels : [],
    pairAddress: pair.pairAddress || null,
    quoteAddress: pair.quoteToken?.address || null,
    quoteSymbol: pair.quoteToken?.symbol || null,
    baseAddress: pair.baseToken?.address || null,
    liqUsd: Number(pair.liquidity?.usd) || 0,
    volUsd: Number(pair.volume?.h24) || 0,
    uniV3: isUniswapV3Pair(pair),
    weth: isWethQuotePair(pair),
    wethUsdc: isWethOrUsdcQuotePair(pair),
  };
}

function matchingBasePairs(pairs, tokenAddress) {
  const wanted = String(tokenAddress || "").toLowerCase();
  return (Array.isArray(pairs) ? pairs : []).filter((p) => {
    if (!p) return false;
    const chain = String(p.chainId || "base").toLowerCase();
    if (chain && chain !== "base") return false;
    if (!wanted) return true;
    const base = pairBaseAddress(p);
    const quote = pairQuoteAddress(p);
    if (base && quote) return base === wanted || quote === wanted;
    if (base) return base === wanted;
    return true;
  });
}

/** Deepest DexScreener book (any DEX) — the "liquid book" humans see. */
export function deepestDexPair(pairs, tokenAddress) {
  const rows = matchingBasePairs(pairs, tokenAddress)
    .map(summarizeDexPair)
    .filter((r) => r && r.liqUsd > 0);
  rows.sort((a, b) => b.liqUsd - a.liqUsd);
  return rows[0] || null;
}

/**
 * SwapRouter02 encodeSwap is WETH↔token only. A deep Uni V3 USDC book is not
 * the pool that exactInputSingle will hit — do not treat USDC as the route.
 */
export function selectUniV3WethUsdcPair(pairs, tokenAddress) {
  const rows = matchingBasePairs(pairs, tokenAddress)
    .map(summarizeDexPair)
    .filter((r) => r && r.uniV3 && r.weth && r.liqUsd > 0);
  rows.sort((a, b) => b.liqUsd - a.liqUsd);
  return rows[0] || null;
}

/** Structural book mismatch — freeze new buys immediately, not after N clips. */
export function shouldFreezeOnRouteReject(code) {
  return code === "PRIMARY_NOT_V3_WETH"
    || code === "THIN_V3_WETH"
    || code === "NO_V3_WETH"
    || code === "EMPTY_V3_POOL";
}

export function requireFactoryLiquidity({ liquidity, symbol = "?", fee = "?" } = {}) {
  if (liquidity == null || liquidity === "") {
    return {
      allow: true,
      code: "NO_FACTORY_READ",
      liquidity: null,
      freezeBuys: false,
      log: null,
    };
  }
  const liq = asBigInt(liquidity) ?? 0n;
  const sym = String(symbol || "?").toUpperCase();
  if (liq <= 0n) {
    return {
      allow: false,
      code: "EMPTY_V3_POOL",
      liquidity: 0n,
      freezeBuys: true,
      log:
        `🛑 EMPTY V3 POOL buy ${sym} fee ${fee} — factory liquidity=0 ` +
        `(ghost/uninitialized). Not sending SwapRouter02.`,
    };
  }
  return { allow: true, code: null, liquidity: liq, freezeBuys: false, log: null };
}

/**
 * SwapRouter02 can only fill Uni V3 WETH. Aerodrome / Uni V2 VIRTUAL / Uni V3
 * USDC books are not a route. A Quoter number on a thin/ghost V3 pool is not enough.
 */
export function evaluateSwapRouterRoute({
  pairs,
  tokenAddress,
  tradeUsd = 0,
  factoryLiquidity = null,
  symbol = "?",
  minPoolLiqUsd = MIN_SWAP_POOL_LIQ_USD,
  maxTradeFrac = MAX_TRADE_FRAC_OF_POOL,
  minVsPrimary = MIN_SWAP_VS_PRIMARY_FRAC,
} = {}) {
  const sym = String(symbol || "?").toUpperCase();
  const rows = Array.isArray(pairs) ? pairs : [];
  const trade = Number(tradeUsd) || 0;
  const factory = asBigInt(factoryLiquidity);

  if (factory != null && factory <= 0n) {
    return requireFactoryLiquidity({ liquidity: factory, symbol: sym, fee: "quoted" });
  }

  // DexScreener outage must not freeze the whole book — factory + Quoter still gate the send.
  if (rows.length === 0) {
    return {
      allow: true,
      code: "NO_DEX_PAIRS",
      freezeBuys: false,
      primary: null,
      swap: null,
      log: null,
    };
  }
  const primary = deepestDexPair(rows, tokenAddress);
  const swap = selectUniV3WethUsdcPair(rows, tokenAddress);

  if (!swap) {
    const via = primary
      ? `${primary.dexId || "?"} ${primary.quoteSymbol || "?"} $${primary.liqUsd.toFixed(0)}`
      : "no DexScreener book";
    return {
      allow: false,
      code: "NO_V3_WETH",
      freezeBuys: true,
      primary,
      swap: null,
      log:
        `🛑 NO V3 WETH ${sym} — primary book is ${via}. ` +
        `SwapRouter02 exactInputSingle cannot fill Uni V2 / Aerodrome / VIRTUAL. Freeze new buys.`,
    };
  }

  if (swap.liqUsd + 1e-9 < minPoolLiqUsd) {
    return {
      allow: false,
      code: "THIN_V3_WETH",
      freezeBuys: true,
      primary,
      swap,
      log:
        `🛑 THIN V3 WETH ${sym} — Uni V3 ${swap.quoteSymbol || "WETH"} pool ` +
        `$${swap.liqUsd.toFixed(0)} < $${minPoolLiqUsd} (SwapRouter book too thin for RISK). Freeze new buys.`,
    };
  }

  if (trade > 0 && swap.liqUsd > 0 && trade > swap.liqUsd * maxTradeFrac) {
    return {
      allow: false,
      code: "TRADE_TOO_BIG",
      freezeBuys: false,
      primary,
      swap,
      log:
        `🛑 TRADE TOO BIG ${sym} — $${trade.toFixed(2)} is >${(maxTradeFrac * 100).toFixed(0)}% ` +
        `of Uni V3 ${swap.quoteSymbol} $${swap.liqUsd.toFixed(0)}. Not sending.`,
    };
  }

  if (
    primary
    && primary.pairAddress
    && swap.pairAddress
    && primary.pairAddress.toLowerCase() !== swap.pairAddress.toLowerCase()
    && swap.liqUsd < primary.liqUsd * minVsPrimary
  ) {
    return {
      allow: false,
      code: "PRIMARY_NOT_V3_WETH",
      freezeBuys: true,
      primary,
      swap,
      log:
        `🛑 PRIMARY NOT V3 WETH ${sym} — liquid book is ${primary.dexId} ` +
        `${primary.quoteSymbol || "?"} $${primary.liqUsd.toFixed(0)}, Uni V3 WETH ` +
        `only $${swap.liqUsd.toFixed(0)}. Quoter on the thin V3 pool is not the book. Freeze new buys.`,
    };
  }

  return { allow: true, code: null, freezeBuys: false, primary, swap, log: null };
}

export function feeTierCandidates(preferred) {
  const p = Number(preferred);
  const pref = V3_FEE_TIERS.includes(p) ? p : 3000;
  return [pref, ...V3_FEE_PROBE_ORDER.filter((f) => f !== pref)];
}

export function poolAddr(v) {
  const s = String(v || "").toLowerCase();
  if (!s.startsWith("0x") || /^0x0+$/.test(s)) return null;
  return s;
}

/**
 * Bind the SwapRouter fee to the DexScreener Uni V3 WETH book, not a
 * permissionless fee that happens to quote. Factory `liquidity()` is
 * gameable — never rank by it.
 *
 * preferredPool set → that pool or null.
 * Else catalog fee if it quoted, else insertion order (wider fees first).
 */
export function pickQuotedPool(candidates, { preferredPool = null, catalogFee = null } = {}) {
  const rows = (Array.isArray(candidates) ? candidates : []).filter((c) => {
    const out = asBigInt(c?.amountOut);
    return out != null && out > 0n;
  });
  if (!rows.length) return null;
  const wanted = poolAddr(preferredPool);
  if (wanted) {
    return rows.find((c) => poolAddr(c.pool) === wanted) || null;
  }
  const cat = Number(catalogFee);
  if (V3_FEE_TIERS.includes(cat)) {
    const hit = rows.find((c) => Number(c.fee) === cat);
    if (hit) return hit;
  }
  return rows[0];
}

/** Catalog poolFeePct convention (0.3% listed as 0.006 RT; 1% as 0.010). */
export function catalogPoolFeePct(fee) {
  const f = Number(fee);
  if (f === 10000) return 0.010;
  if (f === 3000) return 0.006;
  if (f === 500) return 0.001;
  if (f === 100) return 0.0002;
  return 0.006;
}

export function adoptLivePoolFee(token, fee) {
  const f = Number(fee);
  if (!token || !V3_FEE_TIERS.includes(f)) {
    return { changed: false, fee: token?.feeTier ?? null };
  }
  const prev = Number(token.feeTier);
  if (prev === f) return { changed: false, fee: f };
  token.feeTier = f;
  token.poolFeePct = catalogPoolFeePct(f);
  return { changed: true, fee: f, prev };
}

/** Live Uni V3 fee must not be more expensive than the RT% cost gates already used. */
export function liveFeeWithinGatedCost(gatedPct, liveFee) {
  const livePct = catalogPoolFeePct(liveFee);
  const gated = Number(gatedPct);
  const gatedOk = Number.isFinite(gated) ? gated : 0;
  if (livePct <= gatedOk + 1e-12) {
    return { allow: true, livePct, gatedPct: gatedOk, log: null };
  }
  return {
    allow: false,
    livePct,
    gatedPct: gatedOk,
    log:
      `🛑 LIVE FEE ${liveFee} poolFeePct ${livePct} > gated ${gatedOk} — ` +
      `cost gates sized this clip at the cheaper catalog rate. Not sending.`,
  };
}

/**
 * Contract revert on QuoterV2 / SwapRouter02 — the pool cannot fill.
 * Not an RPC outage (do not rotate the whole public list).
 */
export function isQuoteContractRevert(err) {
  const s = String(err?.message || err?.shortMessage || err?.details || err || "").toLowerCase();
  if (!s) return false;
  if (/timeout|521|502|503|504|429|fetch failed|econnreset|etimedout|enotfound|network/.test(s)) {
    return false;
  }
  return /revert|unexpected error|too little received|spl/.test(s);
}

/**
 * A Uni V3 exactInputSingle must have a live QuoterV2 fill for the same
 * token/fee/amount. DexScreener/Aerodrome spot cannot clear an empty Uni pool.
 *
 * @returns {{ allow: boolean, code: string|null, quotedOut: bigint, log: string|null }}
 */
export function requireLiveQuoterFill({
  quotedOut,
  spotOut = null,
  symbol = "?",
  side = "swap",
  quoteInsaneVsSpot = QUOTE_INSANE_VS_SPOT,
} = {}) {
  const quote = asBigInt(quotedOut);
  const sym = String(symbol || "?").toUpperCase();
  if (quote == null || quote <= 0n) {
    return {
      allow: false,
      code: "QUOTE_MISS",
      quotedOut: 0n,
      log:
        `🛑 QUOTE MISS ${side} ${sym} — QuoterV2 returned no fill (wrong fee / empty pool). ` +
        `Not sending SwapRouter02 — spot fallback cannot clear a pool that does not quote.`,
    };
  }
  const spot = asBigInt(spotOut);
  const band = quoteInsaneVsSpot > 0n ? quoteInsaneVsSpot : QUOTE_INSANE_VS_SPOT;
  if (spot != null && spot > 0n && quote > spot * band) {
    return {
      allow: false,
      code: "PRICE_INSANE",
      quotedOut: quote,
      log:
        `🛑 PRICE_INSANE ${side} ${sym} — QuoterV2 ${formatWei18(quote)} is >${band}× ` +
        `spot ${formatWei18(spot)}. Refuse — do not send minOut from a fantasy quote.`,
    };
  }
  return { allow: true, code: null, quotedOut: quote, log: null };
}

/**
 * Hitch only when leftover covers the actual hitch cost.
 * Otherwise strip to the original swap (plain sale) so we don't revert or
 * insert undercovered. Never sells underwater — caller still holds LOSE_ZERO.
 */
export function plainSaleIfHitchTooThin(hitch, originalData, {
  leftoverEth = 0,
  hitchCostEth = 0,
} = {}) {
  const orig = originalData || hitch?.data;
  if (!hitch?.onChain) {
    return hitch && typeof hitch === "object"
      ? hitch
      : { data: orig, utf8: "", hitchBytes: 0, onChain: false, kind: "none", log: null };
  }
  if (encodingDoesNotLoseMoney({ leftoverEth, hitchCostEth })) {
    return hitch;
  }
  return {
    data: orig,
    utf8: "",
    hitchBytes: 0,
    onChain: false,
    kind: "plain-thin",
    log:
      `HITCH: leftover too thin for ${hitch.hitchBytes || 0} B hitch ` +
      `(need ${hitchCostEth} ETH, have ${leftoverEth} ETH) — plain sale (no hitch)`,
  };
}
