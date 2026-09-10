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
 *
 * Does not size P&L. Does not touch Uni V4.
 */

import {
  asBigInt,
  formatWei18,
  QUOTE_INSANE_VS_SPOT,
  encodingDoesNotLoseMoney,
} from "./swap-minout.js";

export const V3_FEE_TIERS = [100, 500, 3000, 10000];

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

export function feeTierCandidates(preferred) {
  const p = Number(preferred);
  const pref = V3_FEE_TIERS.includes(p) ? p : 3000;
  return [pref, ...V3_FEE_TIERS.filter((f) => f !== pref)];
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
