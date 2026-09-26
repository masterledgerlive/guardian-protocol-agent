/**
 * Base Uniswap V3 fee-route awareness.
 *
 * SwapRouter02 exactInputSingle can fill fee 100 / 500 / 3000 / 10000.
 * Catalog stores one fee. Before a buy, enumerate tiers that actually
 * quote, skip factory liquidity()=0 ghosts, and pick the deepest/cheapest
 * effective path.
 *
 * Live send-path hardening (Quoter miss never submits, factory read on
 * the injector) is on main via #61 `quote-swap-guard.js` — this module is
 * the ranking policy so we do not fight that send path. V4 is deferred.
 */

export const V3_FEE_TIERS = Object.freeze([100, 500, 3000, 10000]);
export const UNISWAP_V3_FACTORY_BASE = "0x33128a8fC17869897dcE68Ed026d694621f6FDfD";

/** Empty Uni V3 GAME/WETH 0.3% — catalog used to send here. */
export const GAME_EMPTY_FEE_3000_POOL = "0x70fbffe313d4a40909dba7129e0b2f4a45a645b5";
/** Live Uni V3 GAME/WETH 1% (DexScreener). Still too thin for RISK — CUT. */
export const GAME_LIVE_FEE_10000_POOL = "0xe5ff624bc6c0f85c5e1e27f94366b5829b1877a3";

export function feeTierCandidates(preferred) {
  const p = Number(preferred);
  const pref = V3_FEE_TIERS.includes(p) ? p : 3000;
  return [pref, ...V3_FEE_TIERS.filter((f) => f !== pref)];
}

function asBig(v) {
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

/** A pool with liquidity()=0 cannot fill exactInputSingle. */
export function isEmptyV3Liquidity(liquidity) {
  const liq = asBig(liquidity);
  return liq != null && liq <= 0n;
}

/**
 * Drop fee rows that cannot fill: no quote, zero out, or liquidity()=0.
 * Missing liquidity (RPC flake) is allowed through so Quoter can still try.
 */
export function enumerateViableFeeRoutes(quotes = []) {
  const rows = [];
  for (const q of Array.isArray(quotes) ? quotes : []) {
    const fee = Number(q?.fee);
    if (!V3_FEE_TIERS.includes(fee)) continue;
    if (isEmptyV3Liquidity(q.liquidity)) {
      rows.push({
        fee,
        amountOut: 0n,
        liquidity: 0n,
        quoted: false,
        viable: false,
        code: "EMPTY_V3_POOL",
        pool: q.pool || null,
      });
      continue;
    }
    const out = asBig(q.amountOut);
    const quoted = out != null && out > 0n && q.quoted !== false;
    rows.push({
      fee,
      amountOut: quoted ? out : 0n,
      liquidity: asBig(q.liquidity),
      quoted,
      viable: quoted,
      code: quoted ? null : "QUOTE_MISS",
      pool: q.pool || null,
    });
  }
  return rows;
}

/**
 * Deepest/cheapest effective path among viable quotes.
 * Effective = most amountOut (what the fill actually returns), then lower
 * pool fee, then deeper factory liquidity. Never returns a liquidity()=0 row.
 */
export function pickDeepestCheapestPath(quotes = []) {
  const enumerated = enumerateViableFeeRoutes(quotes);
  const viable = enumerated.filter((r) => r.viable);
  if (!viable.length) {
    return {
      allow: false,
      code: "NO_VIABLE_FEE",
      fee: null,
      pick: null,
      viable: [],
      skippedEmpty: enumerated.filter((r) => r.code === "EMPTY_V3_POOL").map((r) => r.fee),
      log: "NO VIABLE V3 FEE — Quoter miss / liquidity()=0 on every tier. Not sending.",
    };
  }
  viable.sort((a, b) => {
    if (b.amountOut !== a.amountOut) return b.amountOut > a.amountOut ? 1 : -1;
    if (a.fee !== b.fee) return a.fee - b.fee;
    const la = a.liquidity ?? 0n;
    const lb = b.liquidity ?? 0n;
    if (lb !== la) return lb > la ? 1 : -1;
    return 0;
  });
  const pick = viable[0];
  return {
    allow: true,
    code: null,
    fee: pick.fee,
    pick,
    viable,
    skippedEmpty: enumerated.filter((r) => r.code === "EMPTY_V3_POOL").map((r) => r.fee),
    log: null,
  };
}

/** GAME 0.3% ghost must never be selected even if a spot number exists. */
export function gameGhostFee3000Quote(overrides = {}) {
  return {
    fee: 3000,
    amountOut: 0n,
    liquidity: 0n,
    quoted: false,
    pool: GAME_EMPTY_FEE_3000_POOL,
    ...overrides,
  };
}
