/**
 * Live USD quotes for Base tokens.
 *
 * Order of authority:
 *   1. DexScreener batch (verified Base WETH/USDC pool — never a ghost pair)
 *   2. GeckoTerminal simple price (chunks of 10 — GT silently drops extras)
 *   3. DexScreener / GeckoTerminal per-token fallback
 *
 * Never treats a missing quote as $0. Callers must skip the token when
 * fetchTokenUsdQuote / prefetchMarketPrices returns no price.
 *
 * Live bug (PR #19 follow-up): DexScreener `/latest/dex/tokens/TOSHI` ranks a
 * PancakeSwap TOSHI/VIRTUAL ghost first ($69729.86, ~$70M liq, $0 vol). The
 * real Uniswap v3 TOSHI/WETH book is ~$0.00012. Pair selection must prefer
 * Uniswap/Aerodrome WETH or USDC and drop zero-volume mega-liq junk.
 */

export const GECKO_TERMINAL_CHUNK = 10;
export const DEXSCREENER_CHUNK = 15;
export const MIN_USD_PRICE = 1e-12;

/** Base quote assets we will take a USD mark from. */
export const BASE_WETH = "0x4200000000000000000000000000000000000006";
export const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const BASE_USDBC = "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA";
export const NATIVE_ETH = "0x0000000000000000000000000000000000000000";

export const TRUSTED_QUOTE_TOKENS = new Set([
  BASE_WETH.toLowerCase(),
  BASE_USDC.toLowerCase(),
  BASE_USDBC.toLowerCase(),
  NATIVE_ETH.toLowerCase(),
]);

export const PREFERRED_DEX_IDS = new Set(["uniswap", "aerodrome"]);

/** Live RISK TOSHI — used by tests and as a verified-pool pin. */
export const TOSHI_BASE = "0xAC1Bd2486aAf3B5C0fc3Fd868558b082a531B2B4";
export const TOSHI_UNI_WETH_PAIR = "0x4b0Aaf3EBb163dd45F663b38b6d93f6093EBC2d3";
export const TOSHI_CAKE_VIRTUAL_JUNK_PAIR = "0xCDBA300Fffb66499339182339d2CBc19313580DB";
export const TOSHI_JUNK_DEX_USD = 69729.86;
export const TOSHI_SANE_SPOT_USD = 0.0001216;

/**
 * Known-good Base pools. If DexScreener returns this pair, prefer it over
 * a deeper-looking ghost. Not the only source — Uni/Aero WETH/USDC still win
 * when the pin is missing from the payload.
 */
export const VERIFIED_BASE_POOLS = {
  [TOSHI_BASE.toLowerCase()]: new Set([TOSHI_UNI_WETH_PAIR.toLowerCase()]),
};

const GT_SIMPLE =
  "https://api.geckoterminal.com/api/v2/simple/networks/base/token_price/";
const DS_BATCH = "https://api.dexscreener.com/tokens/v1/base/";
const DS_TOKEN = "https://api.dexscreener.com/latest/dex/tokens/";

const FETCH_HEADERS = {
  Accept: "application/json",
  "User-Agent": "guardian-protocol-agent/price-oracle",
};

export function isTrustedQuoteToken(address) {
  return TRUSTED_QUOTE_TOKENS.has(String(address || "").toLowerCase());
}

export function isPreferredDex(dexId) {
  return PREFERRED_DEX_IDS.has(String(dexId || "").toLowerCase());
}

export function isVerifiedBasePool(tokenAddress, pairAddress) {
  const pins = VERIFIED_BASE_POOLS[String(tokenAddress || "").toLowerCase()];
  if (!pins) return false;
  return pins.has(String(pairAddress || "").toLowerCase());
}

/**
 * Pancake TOSHI/VIRTUAL reported ~$70M liq and $0 volume at $69729.
 * A book that deep with no prints is a ghost / inverted / wrong-token pair.
 */
export function isGhostDexPair({ liqUsd = 0, volUsd = 0 } = {}) {
  const liq = Number(liqUsd) || 0;
  const vol = Number(volUsd) || 0;
  if (liq >= 1_000_000 && vol < 100) return true;
  if (liq >= 100_000 && vol <= 0) return true;
  return false;
}

export function isTrustedWethOrUsdcQuote(quoteAddress) {
  const q = String(quoteAddress || "").toLowerCase();
  return q === BASE_WETH.toLowerCase()
    || q === BASE_USDC.toLowerCase()
    || q === BASE_USDBC.toLowerCase()
    || q === NATIVE_ETH.toLowerCase();
}

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

function pairQuoteAddress(pair) {
  return pair?.quoteToken?.address || pair?.quoteToken?.id || null;
}

function pairBaseAddress(pair) {
  return pair?.baseToken?.address || pair?.baseToken?.id || null;
}

function dropPriceOutliers(rows) {
  if (!Array.isArray(rows) || rows.length < 2) return rows;
  const prices = rows.map((r) => r.priceUsd).sort((a, b) => a - b);
  const median = prices[Math.floor(prices.length / 2)];
  if (!isValidUsdPrice(median)) return rows;
  const kept = rows.filter((r) => {
    const ratio = r.priceUsd / median;
    return ratio >= 0.01 && ratio <= 100;
  });
  return kept.length ? kept : rows;
}

function rankDexPairs(rows) {
  return [...rows].sort((a, b) => {
    if (b.verified !== a.verified) return (b.verified ? 1 : 0) - (a.verified ? 1 : 0);
    if (b.preferred !== a.preferred) return (b.preferred ? 1 : 0) - (a.preferred ? 1 : 0);
    if (b.trustedQuote !== a.trustedQuote) return (b.trustedQuote ? 1 : 0) - (a.trustedQuote ? 1 : 0);
    if (b.liqUsd !== a.liqUsd) return b.liqUsd - a.liqUsd;
    return b.volUsd - a.volUsd;
  });
}

function toQuoteResult(best) {
  if (!best) return null;
  const quoteAddr = pairQuoteAddress(best.pair);
  return {
    priceUsd: best.priceUsd,
    pairAddress: best.pair.pairAddress || null,
    dexId: best.pair.dexId || null,
    liquidityUsd: best.liqUsd,
    volumeUsd: best.volUsd,
    priceNative: Number.isFinite(best.priceNative) ? best.priceNative : null,
    quoteToken: quoteAddr,
    trustedQuote: best.trustedQuote,
    preferredDex: best.preferred,
    verifiedPool: best.verified,
    source: "dexscreener",
  };
}

/**
 * Pick a verified Base USD quote.
 *
 * Prefer Uniswap/Aerodrome WETH or USDC (or native ETH / USDbC). Never take
 * a zero-volume mega-liq ghost (live TOSHI/VIRTUAL Pancake @ $69729.86).
 * When `tokenAddress` is set, only pairs whose baseToken is that address —
 * priceUsd is the base token. A pair that has TOSHI as quote would report
 * the other token's USD.
 */
export function selectBestDexScreenerPair(pairs, opts = {}) {
  if (!Array.isArray(pairs) || !pairs.length) return null;
  const wanted = typeof opts.tokenAddress === "string"
    ? opts.tokenAddress.toLowerCase()
    : null;

  const ranked = pairs
    .filter((p) => p && (p.chainId === "base" || !p.chainId))
    .map((p) => {
      const priceUsd = parseFloat(p.priceUsd);
      const liqUsd = parseFloat(p.liquidity?.usd ?? 0);
      const volUsd = parseFloat(p.volume?.h24 ?? 0);
      const priceNative = parseFloat(p.priceNative);
      const baseAddr = pairBaseAddress(p);
      const quoteAddr = pairQuoteAddress(p);
      const trustedQuote = isTrustedQuoteToken(quoteAddr);
      const preferred = isPreferredDex(p.dexId);
      const verified = isVerifiedBasePool(wanted || baseAddr, p.pairAddress);
      return {
        pair: p, priceUsd, liqUsd, volUsd, priceNative,
        baseAddr, quoteAddr, trustedQuote, preferred, verified,
      };
    })
    .filter((x) => isValidUsdPrice(x.priceUsd))
    .filter((x) => !wanted || (x.baseAddr && x.baseAddr.toLowerCase() === wanted))
    .filter((x) => !isGhostDexPair(x));

  if (!ranked.length) return null;

  const trusted = dropPriceOutliers(ranked.filter((x) => x.trustedQuote));
  const preferredTrusted = trusted.filter((x) => x.preferred || x.verified);
  const pool = preferredTrusted.length
    ? preferredTrusted
    : (trusted.length ? trusted : dropPriceOutliers(ranked));

  const best = rankDexPairs(pool)[0];
  return toQuoteResult(best);
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
        const best = selectBestDexScreenerPair(list, { tokenAddress: addr });
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
    return selectBestDexScreenerPair(data?.pairs || [], { tokenAddress: address });
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
    return {
      priceUsd: p,
      pairAddress: null,
      dexId: null,
      liquidityUsd: null,
      volumeUsd: null,
      priceNative: null,
      quoteToken: null,
      trustedQuote: false,
      preferredDex: false,
      verifiedPool: false,
      source: "geckoterminal",
    };
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
        meta[addr] = {
          priceUsd: p,
          source: "geckoterminal",
          pairAddress: null,
          trustedQuote: false,
        };
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

/**
 * Invested ETH used by leftover / P&L. Unknown bags (chain truth, no fill
 * receipt) contribute 0 — never a live mark invented as "what we paid."
 */
export function costBasisEth(token) {
  if (!hasUsableCostBasis(token)) return 0;
  const n = Number(token.totalInvestedEth);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Trust a saved entry only when a fill receipt / ledger buy exists.
 * Live-market "UNKNOWN ENTRY" copies are not cost basis.
 */
export function shouldTrustSavedCostBasis(token, { net, tradeLog } = {}) {
  if (!token || token.unknownEntry) return false;
  if (!isValidUsdPrice(token.entryPrice)) return false;
  if (Number(net?.lastBuyPrice) > 0) return true;
  if (Array.isArray(tradeLog) && tradeLog.some((t) =>
    t && t.symbol === token.symbol && String(t.type || "").toUpperCase() === "BUY" && t.tx
  )) return true;
  return false;
}

/**
 * Bag is on-chain but we do not know what was paid. Keep a display mark so
 * processToken still treats it as a holding; leftover = proceeds − fees.
 */
export function applyUnknownChainHolding(token, { units, priceUsd } = {}) {
  if (!token) return token;
  token.unknownEntry = true;
  token.totalInvestedEth = 0;
  token.entryTime = token.entryTime || Date.now();
  const u = Number(units);
  if (Number.isFinite(u) && u > 0) token.chainUnits = u;
  if (isValidUsdPrice(priceUsd) && !isValidUsdPrice(token.entryPrice)) {
    token.entryPrice = priceUsd;
  }
  return token;
}

// ── Historical seed: never let a CEX ticker overwrite a Base token ───────────
// Binance SYMBOLUSDT is only safe when the CEX listing is the same asset as
// our Base contract. LUNAUSDT is Terra; KITEUSDT is L1 KITE — not Virtuals/Base.
export const BINANCE_OHLC_ALLOWLIST = new Set([
  "AERO", "BRETT", "VIRTUAL", "DEGEN", "TOSHI", "MORPHO", "AIXBT", "ZORA", "WELL",
  // Top-100 majors on Base — same CEX asset as the Uni V3 catalog contracts
  "LINK", "AAVE", "UNI",
  // Onyxcoin — same CEX asset; Base WETH book is dead but we still want wave OHLC
  "XCN",
]);

export const BINANCE_OHLC_DENYLIST = new Set([
  "LUNA", "KITE", "GAME", "HIGHER", "MIGGLES", "MOCHI", "KEYCAT", "DOGINME",
  "SKI", "MOG", "BASE", "TYBG", "BNKR", "BENJI", "ROOST", "TALENT", "TOBY",
  "SIMBA", "CRASH", "BRIUN", "NORMIE", "OGGY", "FREN", "PRIME", "SEAM",
  "CBBTC", "BASECAT", "DRB", "VVV", "TIBBIR", "STONKEX", "BLUECHIP", "VELVET", "KTA",
  "CLANKER", "REI", "FAI",
]);

export function allowBinanceOhlcSeed(symbol) {
  const s = String(symbol || "").toUpperCase();
  if (!s) return false;
  if (BINANCE_OHLC_DENYLIST.has(s)) return false;
  return BINANCE_OHLC_ALLOWLIST.has(s);
}

/** No-pool / wrong-token catalog rows must not burn the 8s OHLC seed budget. */
export function shouldSkipOhlcSeed(token) {
  return Boolean(token?.noBasePool || token?.brokenQuote);
}

/**
 * Prefer Base DEX candles whenever they exist, even if Binance has a longer
 * history. Binance is last-resort and only for allowlisted CEX-equivalent assets.
 */
export function pickHistoricalSeedSource({ gt, ds, binance, allowBinance } = {}) {
  const base = [
    { src: "GeckoTerminal", data: gt },
    { src: "DexScreener", data: ds },
  ].filter((s) => Array.isArray(s.data) && s.data.length >= 5);

  if (base.length) {
    base.sort((a, b) => b.data.length - a.data.length);
    return base[0];
  }

  if (allowBinance && Array.isArray(binance) && binance.length >= 5) {
    return { src: "Binance", data: binance };
  }
  return null;
}

/**
 * Live Base quote wins lastPrice when the seed close is missing or a different asset.
 * An untrusted 100×+ jump (Pancake TOSHI/VIRTUAL $69729 vs seed ~$0.00012) is junk —
 * keep the seed rather than pinning the fantasy into lastPrice.
 */
export function preferBaseQuoteForLastPrice(seedClose, baseQuoteUsd, { trusted = true } = {}) {
  if (!isValidUsdPrice(baseQuoteUsd)) return null;
  if (!isValidUsdPrice(seedClose)) return trusted ? baseQuoteUsd : null;
  const ratio = baseQuoteUsd / seedClose;
  if (ratio < 0.75 || ratio > 1.25) {
    if (!trusted && (ratio < 0.01 || ratio > 100)) return seedClose;
    return baseQuoteUsd;
  }
  return seedClose;
}

export function pickGeckoTerminalPool(pools) {
  if (!Array.isArray(pools) || !pools.length) return null;
  const scored = pools.map((p) => {
    const a = p?.attributes || {};
    const liq = parseFloat(a.reserve_in_usd ?? a.reserve_usd ?? 0);
    const vol = parseFloat(a.volume_usd?.h24 ?? 0);
    return { pool: p, liq, vol, address: a.address || null };
  }).filter((x) => x.address);
  if (!scored.length) return null;
  scored.sort((a, b) => (b.liq - a.liq) || (b.vol - a.vol));
  return scored[0].pool;
}
