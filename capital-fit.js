/**
 * Capital-fit for wrapped majors vs fast inject aisles.
 *
 * Live: ~$4.78 in CBBTC locks RISK capital on a BTC-speed wave. Absolute $
 * profit on a few dollars of BTC rarely clears fees+hitch as fast as UNI /
 * LINK / AERO at the same stake. Prebuilt math:
 *   - list which wrappers/majors we can actually trade on Uni V3 Base
 *   - refuse NEW buys into slow majors until the book is large enough
 *   - recycle thin slow-major bags into already-primed faster cascade seats
 *   - when capital grows, slow majors re-enter the prime board
 */

export const SLOW_MAJOR_MIN_BOOK_USD = 40;
/** Recycle an existing slow-major bag below this USD when a faster primed path exists. */
export const SLOW_MAJOR_RECYCLE_BELOW_USD = 25;
/** Keep a tiny piggy/lottery remnant after slow-major recycle (USD). */
export const SLOW_MAJOR_KEEP_USD = 0.35;

/**
 * Coinbase-style wraps + majors on Base that matter for inject.
 * status: active | watchlist | skip
 */
export const WRAPPER_AND_MAJOR_AVENUES = Object.freeze([
  {
    symbol: "CBBTC",
    kind: "coinbase_wrapped",
    status: "active",
    unit: "btc",
    slowMajor: true,
    minBookUsd: SLOW_MAJOR_MIN_BOOK_USD,
    note: "Coinbase Wrapped BTC — deep Uni V3 WETH. Fast book, slow RISK turnover under ~$40.",
  },
  {
    symbol: "WBTC",
    kind: "wrapped",
    status: "skip",
    unit: "btc",
    prefer: "CBBTC",
    note: "Thin vs CBBTC on Base — use CBBTC.",
  },
  {
    symbol: "CBETH",
    kind: "coinbase_wrapped",
    status: "watchlist",
    unit: "eth",
    slowMajor: true,
    note: "Coinbase Wrapped ETH — Uni V3 thin / V4 primary. Not a RISK inject seat yet.",
  },
  {
    symbol: "AAVE",
    kind: "major",
    status: "active",
    unit: "high",
    slowMajor: true,
    minBookUsd: SLOW_MAJOR_MIN_BOOK_USD,
    note: "High unit price (~$100+) — same thin-book lock risk as CBBTC.",
  },
  {
    symbol: "UNI",
    kind: "major",
    status: "active",
    unit: "mid",
    slowMajor: false,
    note: "Uniswap’s own token — preferred inject main / cascade seat.",
  },
  {
    symbol: "LINK",
    kind: "major",
    status: "active",
    unit: "mid",
    slowMajor: false,
    note: "Deep Uni V3 WETH — fast RISK aisle.",
  },
  {
    symbol: "AERO",
    kind: "major",
    status: "active",
    unit: "mid",
    slowMajor: false,
    note: "Base-native liquid — fast cascade aisle.",
  },
  {
    symbol: "MORPHO",
    kind: "major",
    status: "active",
    unit: "mid",
    slowMajor: false,
    note: "Inject main — mid unit, good hitch surface.",
  },
  {
    symbol: "VVV",
    kind: "major",
    status: "active",
    unit: "mid",
    slowMajor: false,
    note: "Thawed Uni V3 — usable when primed.",
  },
  {
    symbol: "ZORA",
    kind: "major",
    status: "active",
    unit: "mid",
    slowMajor: false,
    note: "Thawed Uni V3 — usable when primed.",
  },
  {
    symbol: "BNKR",
    kind: "major",
    status: "active",
    unit: "low",
    slowMajor: false,
    note: "Deep Uni V3 WETH — fast when primed.",
  },
]);

const BY_SYM = Object.freeze(
  Object.fromEntries(WRAPPER_AND_MAJOR_AVENUES.map((a) => [a.symbol, a]))
);

export function wrapperMajorMeta(symbol) {
  return BY_SYM[String(symbol || "").toUpperCase()] || null;
}

export function isSlowMajor(symbol) {
  const m = wrapperMajorMeta(symbol);
  if (m) return !!m.slowMajor;
  const sym = String(symbol || "").toUpperCase();
  return sym === "CBBTC" || sym === "AAVE" || sym === "CBETH";
}

export function listTradeableWrappersAndMajors() {
  return WRAPPER_AND_MAJOR_AVENUES.filter((a) => a.status === "active");
}

export function listSkippedWrappers() {
  return WRAPPER_AND_MAJOR_AVENUES.filter((a) => a.status !== "active");
}

/**
 * Can this book size use a slow major as a NEW buy without locking RISK?
 */
export function slowMajorFitsBook(symbol, tradeableUsd, { minBookUsd = null } = {}) {
  if (!isSlowMajor(symbol)) return true;
  const m = wrapperMajorMeta(symbol);
  const override = Number(minBookUsd);
  const need =
    minBookUsd != null && Number.isFinite(override)
      ? override
      : Number(m?.minBookUsd) || SLOW_MAJOR_MIN_BOOK_USD;
  const usd = Number(tradeableUsd);
  return Number.isFinite(usd) && usd >= need;
}

/**
 * Existing bag: recycle into faster primed cascade when the wrapper is too
 * small for BTC-speed margins (e.g. $4.78 CBBTC on a ~$10 book).
 */
export function shouldRecycleSlowMajorForCascade({
  symbol,
  posUsd = 0,
  tradeableUsd = 0,
  hasFasterPrimed = false,
  recycleBelowUsd = SLOW_MAJOR_RECYCLE_BELOW_USD,
  minBookUsd = SLOW_MAJOR_MIN_BOOK_USD,
} = {}) {
  if (!isSlowMajor(symbol)) return false;
  if (!hasFasterPrimed) return false;
  const pos = Number(posUsd);
  const book = Number(tradeableUsd);
  if (!(pos > 0)) return false;
  // Recycle when bag is under the slow-major productive floor, or the whole
  // liquid book is still in the RISK band that cannot feed BTC margins.
  const belowBag = pos < (Number(recycleBelowUsd) || SLOW_MAJOR_RECYCLE_BELOW_USD);
  const bookTooThin = Number.isFinite(book) && book > 0 && book < (Number(minBookUsd) || SLOW_MAJOR_MIN_BOOK_USD);
  return belowBag || (bookTooThin && pos < minBookUsd);
}

/**
 * Score multiplier: penalize slow majors on thin books; boost fast aisles.
 * Used by avenue-prime outcome ranking.
 */
export function turnoverBias({
  symbol,
  tradeableUsd = 0,
  injectMain = false,
} = {}) {
  const usd = Number(tradeableUsd) || 0;
  if (isSlowMajor(symbol)) {
    if (!slowMajorFitsBook(symbol, usd)) return 0.35; // still rankable but heavily deprioritized
    if (usd < SLOW_MAJOR_MIN_BOOK_USD * 2) return 0.7;
    return 1.05; // large book — BTC aisle is fine
  }
  // Fast mid/low unit inject surfaces
  const fast = ["UNI", "LINK", "AERO", "MORPHO", "VVV", "ZORA", "BNKR", "BRETT", "VIRTUAL", "DEGEN"];
  const sym = String(symbol || "").toUpperCase();
  if (fast.includes(sym)) return injectMain || sym === "UNI" ? 1.35 : 1.2;
  return 1;
}

/**
 * Refuse NEW buys into slow majors when the book cannot productively hold them.
 */
export function refuseSlowMajorNewBuy({ symbol, tradeableUsd = 0 } = {}) {
  if (!isSlowMajor(symbol)) return null;
  if (slowMajorFitsBook(symbol, tradeableUsd)) return null;
  const need = wrapperMajorMeta(symbol)?.minBookUsd || SLOW_MAJOR_MIN_BOOK_USD;
  return `🛑 ${String(symbol).toUpperCase()} needs ~$${need}+ book for productive BTC/high-unit margins — recycle to fast primed aisle (UNI/LINK/AERO) at RISK size`;
}

/** Compact operator-facing summary of wrap options. */
export function formatWrapperAvenueGuide() {
  const active = listTradeableWrappersAndMajors()
    .map((a) => `${a.symbol}${a.slowMajor ? " (slow@RISK)" : " (fast)"}`)
    .join(" · ");
  const skipped = listSkippedWrappers()
    .map((a) => `${a.symbol}=${a.status}${a.prefer ? `→${a.prefer}` : ""}`)
    .join(" · ");
  return {
    activeLine: `Wrappers/majors active: ${active}`,
    skippedLine: `Not RISK seats: ${skipped}`,
    tip: `CBBTC/AAVE shine after ~$${SLOW_MAJOR_MIN_BOOK_USD}+; under that, cascade thin bags into UNI/LINK/AERO primed seats.`,
  };
}
