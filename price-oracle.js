/**
 * Live USD quotes for Base tokens.
 *
 * Order of authority:
 *   1. DexScreener batch (highest-liquidity Base pair)
 *   2. GeckoTerminal simple price (chunks of 10 — GT silently drops extras)
 *   3. DexScreener / GeckoTerminal per-token fallback
 *
 * Never treats a missing quote as $0. Callers must skip the token when
 * fetchTokenUsdQuote / prefetchMarketPrices returns no price.
 */

export const GECKO_TERMINAL_CHUNK = 10;
export const DEXSCREENER_CHUNK = 15;
export const MIN_USD_PRICE = 1e-12;

const GT_SIMPLE =
  "https://api.geckoterminal.com/api/v2/simple/networks/base/token_price/";
const DS_BATCH = "https://api.dexscreener.com/tokens/v1/base/";
const DS_TOKEN = "https://api.dexscreener.com/latest/dex/tokens/";

const FETCH_HEADERS = {
  Accept: "application/json",
  "User-Agent": "guardian-protocol-agent/price-oracle",
};

export function isValidEvmAddress(address) {
  return typeof address === "string" && /^0x[a-fA-F0-9]{40}$/.test(address);
}

export function isValidUsdPrice(price) {
  return typeof price === "number" && Number.isFinite(price) && price > MIN_USD_PRICE;
}

export function chunkAddresses(addresses, size) {
  const valid = [...new Set(
    (addresses || [])
      .filter(isValidEvmAddress)
      .map((a) => a.toLowerCase())
  )];
  const chunks = [];
  for (let i = 0; i < valid.length; i += size) chunks.push(valid.slice(i, i + size));
  return chunks;
}

/** Pick the deepest Base USD quote. Dry / zero-liq pairs lose to liquid ones. */
export function selectBestDexScreenerPair(pairs) {
  if (!Array.isArray(pairs) || !pairs.length) return null;
  const ranked = pairs
    .filter((p) => p && (p.chainId === "base" || !p.chainId))
    .map((p) => {
      const priceUsd = parseFloat(p.priceUsd);
      const liqUsd = parseFloat(p.liquidity?.usd ?? 0);
      const volUsd = parseFloat(p.volume?.h24 ?? 0);
      return { pair: p, priceUsd, liqUsd, volUsd };
    })
    .filter((x) => isValidUsdPrice(x.priceUsd));
  if (!ranked.length) return null;
  ranked.sort((a, b) => {
    if (b.liqUsd !== a.liqUsd) return b.liqUsd - a.liqUsd;
    return b.volUsd - a.volUsd;
  });
  const best = ranked[0];
  return {
    priceUsd: best.priceUsd,
    pairAddress: best.pair.pairAddress || null,
    dexId: best.pair.dexId || null,
    liquidityUsd: best.liqUsd,
    source: "dexscreener",
  };
}

export function parseGeckoTerminalPrices(payload) {
  const raw = payload?.data?.attributes?.token_prices || {};
  const out = {};
  for (const [addr, priceStr] of Object.entries(raw)) {
    const p = parseFloat(priceStr);
    if (isValidEvmAddress(addr) && isValidUsdPrice(p)) out[addr.toLowerCase()] = p;
  }
  return out;
}

async function fetchJson(url, timeoutMs = 8000) {
  const r = await fetch(url, {
    headers: FETCH_HEADERS,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) {
    const err = new Error(`HTTP ${r.status}`);
    err.status = r.status;
    throw err;
  }
  return r.json();
}

export async function fetchDexScreenerBatch(addresses) {
  const prices = {};
  const meta = {};
  for (const chunk of chunkAddresses(addresses, DEXSCREENER_CHUNK)) {
    try {
      const data = await fetchJson(DS_BATCH + chunk.join(","));
      const pairs = Array.isArray(data) ? data : data?.pairs || [];
      const byToken = new Map();
      for (const pair of pairs) {
        const addr = pair?.baseToken?.address?.toLowerCase();
        if (!addr) continue;
        if (!byToken.has(addr)) byToken.set(addr, []);
        byToken.get(addr).push(pair);
      }
      for (const [addr, list] of byToken) {
        const best = selectBestDexScreenerPair(list);
        if (best) {
          prices[addr] = best.priceUsd;
          meta[addr] = best;
        }
      }
    } catch {
      // chunk failed — per-token fallback later
    }
  }
  return { prices, meta };
}

export async function fetchGeckoTerminalBatch(addresses) {
  const prices = {};
  for (const chunk of chunkAddresses(addresses, GECKO_TERMINAL_CHUNK)) {
    try {
      const data = await fetchJson(GT_SIMPLE + chunk.join(","));
      Object.assign(prices, parseGeckoTerminalPrices(data));
    } catch {
      // chunk failed
    }
  }
  return prices;
}

export async function fetchDexScreenerToken(address) {
  if (!isValidEvmAddress(address)) return null;
  try {
    const data = await fetchJson(DS_TOKEN + address, 6000);
    return selectBestDexScreenerPair(data?.pairs || []);
  } catch {
    return null;
  }
}

export async function fetchGeckoTerminalToken(address) {
  if (!isValidEvmAddress(address)) return null;
  try {
    const data = await fetchJson(GT_SIMPLE + address.toLowerCase(), 5000);
    const prices = parseGeckoTerminalPrices(data);
    const p = prices[address.toLowerCase()];
    if (!isValidUsdPrice(p)) return null;
    return { priceUsd: p, pairAddress: null, dexId: null, liquidityUsd: null, source: "geckoterminal" };
  } catch {
    return null;
  }
}

/**
 * Batch prefetch. DexScreener is authoritative for liquid Base pairs.
 * GeckoTerminal fills gaps. Returns { prices, meta, misses }.
 */
export async function prefetchMarketPrices(addresses) {
  const wanted = chunkAddresses(addresses, 10_000).flat();
  const prices = {};
  const meta = {};

  const ds = await fetchDexScreenerBatch(wanted);
  Object.assign(prices, ds.prices);
  Object.assign(meta, ds.meta);

  const missingAfterDs = wanted.filter((a) => !isValidUsdPrice(prices[a]));
  if (missingAfterDs.length) {
    const gt = await fetchGeckoTerminalBatch(missingAfterDs);
    for (const [addr, p] of Object.entries(gt)) {
      if (!isValidUsdPrice(prices[addr]) && isValidUsdPrice(p)) {
        prices[addr] = p;
        meta[addr] = { priceUsd: p, source: "geckoterminal", pairAddress: null };
      }
    }
  }

  // Leftovers stay misses — getTokenPrice / boot scan do a single-token lookup.
  // Do not hammer DexScreener every cycle for permanently unquoted addresses (e.g. KITE).
  const misses = wanted.filter((a) => !isValidUsdPrice(prices[a]));
  return { prices, meta, misses };
}

/** Single-token quote. DexScreener (best pool) first, then GeckoTerminal. */
export async function fetchTokenUsdQuote(address) {
  if (!isValidEvmAddress(address)) return null;
  const ds = await fetchDexScreenerToken(address);
  if (ds && isValidUsdPrice(ds.priceUsd)) return ds;
  const gt = await fetchGeckoTerminalToken(address);
  if (gt && isValidUsdPrice(gt.priceUsd)) return gt;
  return null;
}

export function hasUsableCostBasis(token) {
  if (!token || token.unknownEntry) return false;
  return isValidUsdPrice(token.entryPrice);
}
