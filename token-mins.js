/**
 * Per-token minimum buy USD — smoke-test floors for Telegram `/buy` and
 * OPERATOR_BUY so a $1 probe cannot burn gas on a dead / exotic book.
 *
 * Live Railway 2026-09-07: `/buy XCN $1` queued then processToken TDZ'd.
 * Separately, XCN's Uni V3 WETH book is ~$212 while USDC is the real pool —
 * bot routes exactInputSingle WETH-only, so XCN must not take test capital.
 *
 * Defaults are intentionally tiny for deep inject mains and higher for thin
 * meme books. Catalog `minBuyUsd` / env TOKEN_MIN_BUY_USD_JSON override.
 */

export const DEFAULT_MIN_BUY_USD = 0.50;

/** Floor by symbol when catalog / env do not set one. */
export const TOKEN_MIN_BUY_USD = Object.freeze({
  // Inject mains — deep Uni V3 WETH books; $0.50 smoke is fine for mid-unit
  UNI: 0.50,
  // CBBTC needs larger stake for productive BTC margins at RISK — discourage $4–5 locks
  CBBTC: 15,
  LINK: 0.50,
  AAVE: 12,
  AERO: 0.50,
  MORPHO: 0.50,
  // Liquid Base memes / keep books
  BRETT: 0.50,
  VIRTUAL: 0.50,
  DEGEN: 0.50,
  TOSHI: 0.50,
  KEYCAT: 0.50,
  DOGINME: 0.50,
  SKI: 0.50,
  LUNA: 0.50,
  GAME: 0.50,
  BASECAT: 0.50,
  DRB: 0.50,
  REI: 0.50,
  CLANKER: 0.75,
  VVV: 0.75,
  ZORA: 0.75,
  BNKR: 0.50,
  AIXBT: 0.75,
  // Thin / exotic — raise floor so accidental $1 probes die early
  XCN: 25, // WETH book dead; never smoke-test until USDC route or deeper WETH
  SEAM: 25,
  MOG: 25,
  BASE: 25,
});

/**
 * Parse `TOKEN_MIN_BUY_USD_JSON={"TOSHI":1,"UNI":0.5}` overrides.
 * Invalid JSON / bad values ignored per key.
 */
export function parseTokenMinBuyEnv(raw, env = process.env) {
  const src = raw != null ? raw : env?.TOKEN_MIN_BUY_USD_JSON;
  if (src == null || String(src).trim() === "") return {};
  try {
    const obj = typeof src === "object" ? src : JSON.parse(String(src));
    if (!obj || typeof obj !== "object") return {};
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      const n = Number(v);
      if (Number.isFinite(n) && n >= 0) out[String(k).toUpperCase()] = n;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Resolve min buy USD for a token.
 * Priority: catalog.minBuyUsd → env JSON → TOKEN_MIN_BUY_USD map → default.
 */
export function minBuyUsdForToken(tokenOrSymbol, env = process.env) {
  const sym = typeof tokenOrSymbol === "string"
    ? String(tokenOrSymbol).toUpperCase()
    : String(tokenOrSymbol?.symbol || "").toUpperCase();
  const catalog = typeof tokenOrSymbol === "object" && tokenOrSymbol
    ? Number(tokenOrSymbol.minBuyUsd)
    : NaN;
  if (Number.isFinite(catalog) && catalog >= 0) return catalog;

  const fromEnv = parseTokenMinBuyEnv(undefined, env)[sym];
  if (Number.isFinite(fromEnv) && fromEnv >= 0) return fromEnv;

  if (sym && Object.prototype.hasOwnProperty.call(TOKEN_MIN_BUY_USD, sym)) {
    return TOKEN_MIN_BUY_USD[sym];
  }
  return DEFAULT_MIN_BUY_USD;
}

/**
 * Operator /buy size check. Returns skip reason or null if ok.
 * usd=0 means "use default sizing" — still must clear the floor via wallet path.
 */
export function operatorBuyBelowMin({ symbol, usd, token, env = process.env } = {}) {
  const floor = minBuyUsdForToken(token || symbol, env);
  const u = Number(usd);
  if (!Number.isFinite(u) || u <= 0) return null; // sized later from wallet / tier
  if (u + 1e-9 < floor) {
    return `🛑 ${String(symbol || "?").toUpperCase()} min buy $${floor.toFixed(2)} (got $${u.toFixed(2)}) — too small for this book`;
  }
  return null;
}

/**
 * Uni V3 WETH-only bot: tokens whose deepest live book is USDC (or thinner
 * than RISK) must stay frozen / data-only until a USDC route exists.
 */
export const WETH_DEAD_USDC_PRIMARY = Object.freeze({
  XCN: {
    frozenReason:
      "DEAD WETH book — Uni V3 XCN/USDC ~$173k is live; XCN/WETH ~$212. Bot is WETH exactInputSingle only. Wave data OK; no new buys until USDC route or deeper WETH.",
  },
});

export function applyWethDeadFreeze(token) {
  const sym = String(token?.symbol || "").toUpperCase();
  const meta = WETH_DEAD_USDC_PRIMARY[sym];
  if (!meta) return token;
  return {
    ...token,
    frozen: true,
    frozenReason: meta.frozenReason,
    minBuyUsd: Math.max(Number(token.minBuyUsd) || 0, TOKEN_MIN_BUY_USD[sym] || 25),
  };
}
