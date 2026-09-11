/**
 * Outlet scoreboard — KEEP / CUT / CAUTION per catalog symbol.
 *
 * Hitch success / fail / revert rates use *observed on-chain receipts only*.
 * Missing rates stay null — never invent P&L or fill a win from hitchProve.
 *
 * GAME ghost Uni V3 (liquidity()=0 at fee 3000, three mined STF reverts) is
 * the CUT class. Catalog freeze stays; always-plus leftover sells stay open.
 *
 * Sibling always-plus (LOSE-ZERO sell floor) + quote-gate PR: do not fight.
 * CUT freezes new buys. Green leftover exits remain allowed.
 */

import { ALWAYS_PLUS_EXIT } from "./always-plus-exit.js";
import { GAME_EMPTY_FEE_3000_POOL, GAME_LIVE_FEE_10000_POOL } from "./v3-fee-routes.js";

export const SCOREBOARD_KIND = "outlet-scoreboard|observed+catalog";

/** Proven loser class — ghost Uni V3 / wrong book. Catalog freeze is the gate. */
export const CUT_CLASS = "CUT";
export const KEEP_CLASS = "KEEP";
export const CAUTION_CLASS = "CAUTION";

export const GAME_TOKEN = "0x1C4CcA7C5DB003824208aDDA61Bd749e55F463a3";

/** Three mined GAME buys — SwapRouter02 WETH→GAME fee 3000 + Eureka hitch, status 0. */
export const GAME_OBSERVED_REVERTS = Object.freeze([
  { tx: "0x2644773a875e2cfb67f8d85ec329f326a68406b5f66c327250b8404ffcacfef0", block: 51106117, status: 0 },
  { tx: "0x2589e0a31f898e1166c490570025f25853d6d8c98b7f81846d50ab2405d45421", block: 51106153, status: 0 },
  { tx: "0x280e898e641e52b1463db16de656bc67b583bdc7d97b9ebe4b3206a167b26b87", block: 51106192, status: 0 },
]);

export const GAME_GHOST_CUT = Object.freeze({
  symbol: "GAME",
  class: CUT_CLASS,
  address: GAME_TOKEN,
  catalogFee: 3000,
  ghostPool: GAME_EMPTY_FEE_3000_POOL,
  liveV3Fee: 10000,
  liveV3Pool: GAME_LIVE_FEE_10000_POOL,
  liquidDepthUsd: 2795,
  primaryBook: "Uni V2 GAME/VIRTUAL 0xD418dfE7670c21F682E041F34250c114DB5D7789 ~$2.14M — SwapRouter02 cannot fill it",
  hitchAttempts: GAME_OBSERVED_REVERTS.length,
  hitchSuccess: 0,
  failRevertCount: GAME_OBSERVED_REVERTS.length,
  hitchSuccessRate: 0,
  failRevertRate: 1,
  hitchBytes: 229,
  evidence: GAME_OBSERVED_REVERTS,
  pnlUsd: null,
  note:
    "Observed mined reverts — not invented P&L. CUT class. Catalog frozen exits-only. Always-plus leftover sells remain allowed.",
});

/**
 * Catalog freeze list for proven losers (wrong book / no Uni V3 fill).
 * GAME is the ghost CUT prototype. WELL/KITE already disabled.
 */
export const CATALOG_CUT_FREEZES = Object.freeze([
  {
    symbol: "GAME",
    gate: "frozen",
    class: CUT_CLASS,
    reason: "ghost Uni V3 WETH fee 3000 liquidity()=0; liquid book is Uni V2 VIRTUAL",
  },
  {
    symbol: "WELL",
    gate: "disabled",
    class: CUT_CLASS,
    reason: "Aerodrome-primary — Uniswap V3 reverts",
  },
  {
    symbol: "KITE",
    gate: "disabled",
    class: CUT_CLASS,
    reason: "no verified Base pool",
  },
]);

const CUT_SYMBOLS = new Set(CATALOG_CUT_FREEZES.map((r) => r.symbol));

function rate(success, attempts) {
  const a = Number(attempts);
  const s = Number(success);
  if (!Number.isFinite(a) || a <= 0) return null;
  if (!Number.isFinite(s) || s < 0) return null;
  return s / a;
}

function observedFor(symbol) {
  if (String(symbol || "").toUpperCase() === "GAME") {
    return {
      hitchAttempts: GAME_GHOST_CUT.hitchAttempts,
      hitchSuccess: GAME_GHOST_CUT.hitchSuccess,
      failRevertCount: GAME_GHOST_CUT.failRevertCount,
      hitchSuccessRate: GAME_GHOST_CUT.hitchSuccessRate,
      failRevertRate: GAME_GHOST_CUT.failRevertRate,
      liquidDepthUsd: GAME_GHOST_CUT.liquidDepthUsd,
      hitchBytes: GAME_GHOST_CUT.hitchBytes,
      evidence: GAME_GHOST_CUT.evidence,
      pnlUsd: null,
    };
  }
  return {
    hitchAttempts: null,
    hitchSuccess: null,
    failRevertCount: null,
    hitchSuccessRate: null,
    failRevertRate: null,
    liquidDepthUsd: null,
    hitchBytes: null,
    evidence: [],
    pnlUsd: null,
  };
}

/**
 * Recommend KEEP / CUT / CAUTION from catalog row + optional observed stats.
 * Does not invent hitch rates. CUT never blocks a leftover-green sell.
 */
export function recommendOutlet(row = {}, observed = null) {
  const symbol = String(row.symbol || "").toUpperCase();
  const stats = observed || observedFor(symbol);
  const cutRow = CATALOG_CUT_FREEZES.find((r) => r.symbol === symbol);
  let rec = KEEP_CLASS;
  let why = "tradeable Uni V3 hitch surface — hitch only if leftover covers";

  if (cutRow || CUT_SYMBOLS.has(symbol)) {
    rec = CUT_CLASS;
    why = cutRow?.reason || "proven loser / no SwapRouter02 book";
  } else if (row.disabled) {
    rec = CUT_CLASS;
    why = row.disabledReason || "disabled — Uni V3 does not fill";
  } else if (row.frozen) {
    rec = CAUTION_CLASS;
    why = row.frozenReason || "frozen exits-only — no new hitch buys";
  } else if (row.injectMain) {
    rec = KEEP_CLASS;
    why = "inject main — leftover-covered V3 hitch seat";
  }

  const attempts = stats.hitchAttempts;
  const successRate = stats.hitchSuccessRate != null
    ? stats.hitchSuccessRate
    : rate(stats.hitchSuccess, attempts);
  const failRate = stats.failRevertRate != null
    ? stats.failRevertRate
    : rate(stats.failRevertCount, attempts);

  return {
    symbol,
    address: row.address || null,
    recommend: rec,
    feeTier: row.feeTier ?? null,
    frozen: !!row.frozen,
    disabled: !!row.disabled,
    injectMain: !!row.injectMain,
    hitchSuccessRate: successRate,
    failRevertRate: failRate,
    hitchAttempts: attempts,
    hitchSuccess: stats.hitchSuccess,
    failRevertCount: stats.failRevertCount,
    liquidDepthUsd: stats.liquidDepthUsd,
    hitchBytes: stats.hitchBytes,
    evidence: stats.evidence || [],
    pnlUsd: null,
    alwaysPlusExitOpen: rec === CUT_CLASS || rec === CAUTION_CLASS,
    why,
  };
}

export function buildOutletScoreboard(catalogRows = [], { injectMains = [] } = {}) {
  const mains = new Set((injectMains || []).map((s) => String(s).toUpperCase()));
  const rows = (Array.isArray(catalogRows) ? catalogRows : []).map((t) =>
    recommendOutlet({
      ...t,
      injectMain: t.injectMain || mains.has(String(t.symbol || "").toUpperCase()),
    }),
  );
  const keep = rows.filter((r) => r.recommend === KEEP_CLASS);
  const cut = rows.filter((r) => r.recommend === CUT_CLASS);
  const caution = rows.filter((r) => r.recommend === CAUTION_CLASS);
  return {
    kind: SCOREBOARD_KIND,
    generatedAt: new Date().toISOString(),
    dex: "uniswap-v3",
    chain: "base",
    v4Deferred: true,
    alwaysPlus: ALWAYS_PLUS_EXIT,
    gameGhost: GAME_GHOST_CUT,
    catalogCutFreezes: CATALOG_CUT_FREEZES,
    counts: { keep: keep.length, cut: cut.length, caution: caution.length, total: rows.length },
    keep: keep.map((r) => r.symbol),
    cut: cut.map((r) => r.symbol),
    caution: caution.map((r) => r.symbol),
    rows,
    note:
      "Hitch rates are null unless observed on-chain receipts exist (GAME CUT). " +
      "Never invent P&L. CUT/CAUTION freeze new buys; leftover-green sells stay open (always-plus).",
  };
}
