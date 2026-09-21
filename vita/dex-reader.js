/**
 * VITA DEX reader — our own per-token Base book + dual 3rd-party refs.
 *
 * Primary: DexScreener verified Uni/Aero WETH|USDC (price-oracle pair rank).
 * Secondary: GeckoTerminal simple price (independent check).
 * Tertiary links: Basescan · DexScreener page · GeckoTerminal page ·
 * CoinGecko when a known id is mapped (never invented).
 *
 * Never invents a USD quote or a tx hash. Missing quote = miss, not $0.
 * Mother brain untouched. Message-first formula untouched.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BASE_USDC,
  BASE_WETH,
  fetchGeckoTerminalToken,
  fetchTokenUsdQuote,
  isGhostDexPair,
  isValidEvmAddress,
  isValidUsdPrice,
  selectBestDexScreenerPair,
} from "../price-oracle.js";
import { MAINFRAME_ANCHORS, FORMULA_ID } from "./mainframe.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const MEMORY_DIR = join(HERE, "memory");
const LEARN_PATH = join(MEMORY_DIR, "token-dex-reader.json");

export const DEX_READER_ID = "vita-dex-reader-v1";
export const DEX_READER_MAGIC = "§VITADEX§";
export const DEX_READER_LABEL = "DEX_READER";
export const TOKEN_PLAYER_PATH = "/vita/token-player";

/** Dual-check: primary vs secondary may diverge this far before FLAG. */
export const DUAL_DIVERGE_RATIO = 0.20;

/**
 * Known CoinGecko ids for catalog majors — secondary human reference only.
 * Unlisted symbols get Basescan + DexScreener + GeckoTerminal (no fake id).
 */
export const COINGECKO_IDS = Object.freeze({
  AERO: "aerodrome-finance",
  BRETT: "based-brett",
  VIRTUAL: "virtual-protocol",
  MORPHO: "morpho",
  LINK: "chainlink",
  UNI: "uniswap",
  AAVE: "aave",
  CBBTC: "coinbase-wrapped-btc",
  DEGEN: "degen-base",
  TOSHI: "toshi",
  WELL: "moonwell-artemis",
  ZORA: "zora",
  VVV: "venice-token",
  BNKR: "bankrcoin",
  HOME: "home",
  AIXBT: "aixbt",
  CLANKER: "tokenbot",
  SEAM: "seamless-protocol",
});

function sha256Hex(text) {
  return createHash("sha256").update(String(text || ""), "utf8").digest("hex");
}

function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function normSym(s) {
  return String(s || "").trim().toUpperCase();
}

function clip(s, n = 160) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length <= n ? t : t.slice(0, n - 1) + "…";
}

function addrOf(tokenOrAddress) {
  if (typeof tokenOrAddress === "string") return tokenOrAddress;
  return tokenOrAddress?.address || "";
}

/** Public explorer / screener URLs for a Base ERC-20 — no invented hashes. */
export function thirdPartyRefs(token = {}) {
  const address = String(token.address || "").trim();
  const valid = isValidEvmAddress(address);
  const sym = normSym(token.symbol);
  const cg = COINGECKO_IDS[sym] || null;
  const wallet = MAINFRAME_ANCHORS.wallet;
  const pair = token.pairAddress || token.dex?.pairAddress || null;
  return {
    basescanToken: valid ? "https://basescan.org/token/" + address : null,
    basescanWallet: valid
      ? "https://basescan.org/token/" + address + "?a=" + wallet
      : null,
    dexscreener: valid ? "https://dexscreener.com/base/" + address : null,
    dexscreenerPair: isValidEvmAddress(pair)
      ? "https://dexscreener.com/base/" + pair
      : null,
    geckoterminal: valid
      ? "https://www.geckoterminal.com/base/tokens/" + address.toLowerCase()
      : null,
    coingecko: cg ? "https://www.coingecko.com/en/coins/" + cg : null,
    coingeckoId: cg,
    wallet,
    chain: "base",
    chainId: 8453,
  };
}

/**
 * Dual check + balances: our DexScreener reader vs GeckoTerminal.
 * Ratio outside DUAL_DIVERGE_RATIO → QUESTIONABLE (never pick a fake mean).
 */
export function dualCheckQuotes({ primary = null, secondary = null } = {}) {
  const a = isValidUsdPrice(primary?.priceUsd) ? primary.priceUsd : null;
  const b = isValidUsdPrice(secondary?.priceUsd) ? secondary.priceUsd : null;
  if (a == null && b == null) {
    return {
      ok: false,
      verdict: "FAIL",
      reason: "no USD quote from DexScreener or GeckoTerminal — will not invent $0",
      ratio: null,
      agree: false,
    };
  }
  if (a == null || b == null) {
    return {
      ok: true,
      verdict: "QUESTIONABLE",
      reason: a == null
        ? "primary DexScreener miss — secondary Gecko only"
        : "secondary Gecko miss — primary DexScreener only",
      ratio: null,
      agree: false,
      priceUsd: a != null ? a : b,
    };
  }
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  const ratio = lo > 0 ? (hi - lo) / lo : Infinity;
  const agree = ratio <= DUAL_DIVERGE_RATIO + 1e-12;
  return {
    ok: true,
    verdict: agree ? "PASS" : "QUESTIONABLE",
    reason: agree
      ? "DexScreener ↔ GeckoTerminal within " + Math.round(DUAL_DIVERGE_RATIO * 100) + "%"
      : "DexScreener $" + a + " vs Gecko $" + b + " diverge " + (ratio * 100).toFixed(1) + "%",
    ratio,
    agree,
    priceUsd: a, // primary wins; never average a ghost
    primaryUsd: a,
    secondaryUsd: b,
  };
}

/**
 * Rank a live (or fixture) DexScreener pairs payload into our reader snapshot.
 * Ghost / inverted / wrong-token pairs are dropped by selectBestDexScreenerPair.
 */
export function readDexSnapshotFromPairs(pairs, token = {}) {
  const address = addrOf(token);
  const best = selectBestDexScreenerPair(pairs, { tokenAddress: address });
  if (!best || !isValidUsdPrice(best.priceUsd)) {
    return {
      ok: false,
      symbol: normSym(token.symbol),
      address: isValidEvmAddress(address) ? address : null,
      miss: true,
      reason: "no trusted Base Uni/Aero WETH|USDC quote",
      refs: thirdPartyRefs(token),
    };
  }
  const ghost = isGhostDexPair({
    liqUsd: best.liquidityUsd,
    volUsd: best.volumeUsd,
  });
  return {
    ok: !ghost,
    miss: false,
    symbol: normSym(token.symbol),
    address: isValidEvmAddress(address) ? address : null,
    priceUsd: best.priceUsd,
    pairAddress: best.pairAddress,
    dexId: best.dexId,
    liquidityUsd: best.liquidityUsd,
    volumeUsd24h: best.volumeUsd,
    quoteToken: best.quoteToken,
    trustedQuote: best.trustedQuote === true,
    preferredDex: best.preferredDex === true,
    verifiedPool: best.verifiedPool === true,
    ghost,
    source: best.source || "dexscreener",
    weth: BASE_WETH,
    usdc: BASE_USDC,
    refs: thirdPartyRefs({ ...token, pairAddress: best.pairAddress }),
  };
}

export async function readDexForToken(token = {}, { fetchLive = true } = {}) {
  const address = addrOf(token);
  const symbol = normSym(token.symbol);
  const refs = thirdPartyRefs(token);
  if (!isValidEvmAddress(address)) {
    return {
      ok: false,
      miss: true,
      symbol,
      address: null,
      reason: "invalid address — will not invent a pool",
      refs,
      dual: dualCheckQuotes({}),
    };
  }
  if (!fetchLive) {
    return {
      ok: true,
      live: false,
      miss: true,
      symbol,
      address,
      reason: "catalog-only — live DexScreener not requested",
      refs,
      dual: dualCheckQuotes({}),
    };
  }
  let primary = null;
  let secondary = null;
  try {
    primary = await fetchTokenUsdQuote(address);
  } catch {
    primary = null;
  }
  try {
    secondary = await fetchGeckoTerminalToken(address);
  } catch {
    secondary = null;
  }
  const dual = dualCheckQuotes({ primary, secondary });
  const snap = primary && isValidUsdPrice(primary.priceUsd)
    ? {
        ok: dual.verdict !== "FAIL",
        live: true,
        miss: false,
        symbol,
        address,
        priceUsd: primary.priceUsd,
        pairAddress: primary.pairAddress,
        dexId: primary.dexId,
        liquidityUsd: primary.liquidityUsd,
        volumeUsd24h: primary.volumeUsd,
        quoteToken: primary.quoteToken,
        trustedQuote: primary.trustedQuote === true,
        preferredDex: primary.preferredDex === true,
        verifiedPool: primary.verifiedPool === true,
        ghost: isGhostDexPair({
          liqUsd: primary.liquidityUsd,
          volUsd: primary.volumeUsd,
        }),
        source: primary.source || "dexscreener",
        secondaryUsd: isValidUsdPrice(secondary?.priceUsd) ? secondary.priceUsd : null,
        secondarySource: secondary?.source || null,
        dual,
        refs: thirdPartyRefs({ ...token, pairAddress: primary.pairAddress }),
        reason: dual.reason,
      }
    : {
        ok: false,
        live: true,
        miss: true,
        symbol,
        address,
        priceUsd: null,
        secondaryUsd: isValidUsdPrice(secondary?.priceUsd) ? secondary.priceUsd : null,
        dual,
        refs,
        reason: dual.reason,
      };
  return snap;
}

export function formatDexReaderCard(snap = {}, { dualLine = true } = {}) {
  const sym = snap.symbol || "?";
  const lines = [
    DEX_READER_MAGIC + "v1|dex=" + sym + "§",
    "📡 DEX READER — " + sym,
    "━━━━━━━━━━━━━━━━━━━━",
  ];
  if (snap.miss || !isValidUsdPrice(snap.priceUsd)) {
    lines.push("USD: miss (will not invent $0)");
  } else {
    lines.push("USD: $" + snap.priceUsd);
    if (snap.liquidityUsd != null) lines.push("Liq: $" + Number(snap.liquidityUsd).toFixed(0));
    if (snap.volumeUsd24h != null) lines.push("Vol 24h: $" + Number(snap.volumeUsd24h).toFixed(0));
    if (snap.dexId) lines.push("DEX: " + snap.dexId + (snap.preferredDex ? " (preferred)" : ""));
    if (snap.trustedQuote) lines.push("Quote: trusted WETH|USDC");
    if (snap.pairAddress) lines.push("Pair: " + snap.pairAddress);
  }
  if (dualLine && snap.dual) {
    lines.push("Dual: " + snap.dual.verdict + " — " + clip(snap.dual.reason, 90));
  }
  const refs = snap.refs || {};
  if (refs.basescanToken) lines.push("Basescan: " + refs.basescanToken);
  if (refs.dexscreener) lines.push("DexScreener: " + refs.dexscreener);
  if (refs.geckoterminal) lines.push("GeckoTerminal: " + refs.geckoterminal);
  if (refs.coingecko) lines.push("CoinGecko: " + refs.coingecko);
  lines.push("Never invent hashes. Primary = DexScreener; secondary = Gecko.");
  return lines.join("\n");
}

export function appendDexReaderLearn(event = {}) {
  try {
    mkdirSync(MEMORY_DIR, { recursive: true });
    let cur = { id: DEX_READER_ID, events: [] };
    if (existsSync(LEARN_PATH)) {
      cur = JSON.parse(readFileSync(LEARN_PATH, "utf8"));
      if (!Array.isArray(cur.events)) cur.events = [];
    }
    const row = {
      at: new Date().toISOString(),
      formula: FORMULA_ID,
      symbol: normSym(event.symbol),
      verdict: event.verdict || event.dual?.verdict || null,
      miss: event.miss === true,
      priceUsd: isValidUsdPrice(event.priceUsd) ? event.priceUsd : null,
      commit: sha256Hex(JSON.stringify({
        s: event.symbol,
        v: event.verdict,
        p: event.priceUsd,
      })),
    };
    cur.events.push(row);
    if (cur.events.length > 200) cur.events = cur.events.slice(-200);
    cur.last = row;
    writeFileSync(LEARN_PATH, JSON.stringify(cur, null, 2) + "\n");
    return row;
  } catch {
    return null;
  }
}

export function dexReaderPublicState(token = {}, snap = null) {
  return {
    ok: true,
    id: DEX_READER_ID,
    magic: DEX_READER_MAGIC,
    formula: FORMULA_ID,
    neverInventHashes: true,
    token: {
      symbol: normSym(token.symbol),
      address: token.address || null,
    },
    dex: snap,
    refs: snap?.refs || thirdPartyRefs(token),
  };
}

void num;
void sha256Hex;
