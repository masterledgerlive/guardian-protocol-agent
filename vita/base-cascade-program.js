/**
 * Base cascade program — original path (pre-Robinhood execution).
 *
 * Robinhood is wave DATA only. Execution stays on Base RISK
 * (avenue bottoms → velocity snowball → dividend pool → inject mains).
 *
 * Hierarchy:
 *   HOME     — piggy / fuel (~$11 park); never sold for hops
 *   LOWER    — velocity snowball starters (small book inject-all)
 *   MAIN     — inject mains (goal when dividend/pooled size clears)
 *   AERO     — bridges lower↔main (main in/out on Base)
 *
 * Thin book (&lt; $12): one seat, 100% tradeable into LOWER first.
 * Dividend floor 10% / cap 30% — least withdraw that still seeds next hop.
 * Never invents hashes. Never sells red to place code. Mother brain untouched.
 */

import {
  INJECT_ALL_USD,
  CASCADE_SEED_USD,
  CASCADE_LEAVE_DUST_USD,
  CASCADE_GAS_FLOOR_ETH,
  CASCADE_TARGET_HOPS,
} from "../cascade-rollover.js";
import { INJECT_VELOCITY_SYMBOLS } from "../inject-revenue.js";
import { TOKEN_MIN_BUY_USD, DEFAULT_MIN_BUY_USD } from "../token-mins.js";
import { DIVIDEND_FLOOR, DIVIDEND_CAP } from "./wave-hl-ledger.js";
import {
  HOME_CASCADE_PIGGY_HOLDER,
  AERO_CASCADE_INOUT,
  loadWavePointsFromToken,
  planMessageCascade,
  formatMessageCascadeCard,
  CASCADE_CHEAP_RANGE_MAX,
} from "./message-cascade.js";
import { VERIFIED_HOME_SYMBOL } from "../operator-rotate.js";

export const BASE_CASCADE_PROGRAM_ID = "base-cascade-program-v1";
export const BASE_CASCADE_LABEL = "BASE_CASCADE_PROGRAM";

/** Top of main cascade — inject / hitch surfaces (original agent path). */
export const CASCADE_MAIN_SYMBOLS = Object.freeze([
  "LINK", "UNI", "VVV", "ZORA", "BNKR", "AERO", "MORPHO",
]);

/** Lower / velocity — snowball starters on thin Base books. */
export const CASCADE_LOWER_SYMBOLS = Object.freeze([
  ...INJECT_VELOCITY_SYMBOLS.filter((s) => s !== "AERO"),
  "TOSHI",
  "DOGINME",
]);

/** Deferred majors — not for $11 snowball (unit price strands). */
export const CASCADE_DEFERRED_MAJORS = Object.freeze(["CBBTC", "AAVE"]);

export const PHASES = Object.freeze({
  SNOWBALL_SMALL: "SNOWBALL_SMALL",
  DIVIDEND_POOL: "DIVIDEND_POOL",
  GOAL_MAIN: "GOAL_MAIN",
  HOLD_HOME: "HOLD_HOME",
});

function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function normSym(s) {
  return String(s || "").trim().toUpperCase();
}

function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function cascadeTierOf(symbol) {
  const sym = normSym(symbol);
  if (sym === VERIFIED_HOME_SYMBOL) return "HOME";
  if (CASCADE_DEFERRED_MAJORS.includes(sym)) return "DEFERRED";
  if (sym === "AERO") return "BRIDGE"; // main in/out + velocity
  if (CASCADE_MAIN_SYMBOLS.includes(sym)) return "MAIN";
  if (CASCADE_LOWER_SYMBOLS.includes(sym) || INJECT_VELOCITY_SYMBOLS.includes(sym)) return "LOWER";
  return "OTHER";
}

export function minBuyUsdFor(symbol) {
  const sym = normSym(symbol);
  const v = TOKEN_MIN_BUY_USD[sym];
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_MIN_BUY_USD;
}

/**
 * Viable cascade capital from liquid ETH/WETH book (HOME bag is NOT spent).
 * homeBagUsd is parked piggy — shown for context, not deployable.
 */
export function viableCascadeCapital({
  liquidUsd = 0,
  homeBagUsd = 11,
  ethUsd = 2700,
  bagsDividendUsd = 0,
} = {}) {
  const ethPx = Math.max(1, num(ethUsd, 2700));
  const gasFloorUsd = CASCADE_GAS_FLOOR_ETH * ethPx;
  const liquid = Math.max(0, num(liquidUsd, 0));
  const home = Math.max(0, num(homeBagUsd, 0));
  const dividendPool = Math.max(0, num(bagsDividendUsd, 0));
  const tradeable = Math.max(0, liquid - gasFloorUsd);
  const thinBook = tradeable > 0 && tradeable < INJECT_ALL_USD;
  const injectAll = thinBook || (tradeable + home > 0 && tradeable < INJECT_ALL_USD);
  // HOME is never sold into hops — only liquid + dividend withdraw fuels cascade.
  const deployableUsd = tradeable + dividendPool;
  const minHopUsd = Math.max(CASCADE_SEED_USD, DEFAULT_MIN_BUY_USD);
  const hopsAffordable = minHopUsd > 0 ? Math.floor(deployableUsd / minHopUsd) : 0;
  return {
    homeBagUsd: home,
    homeSpendable: false,
    liquidUsd: liquid,
    gasFloorUsd,
    tradeableUsd: tradeable,
    dividendPoolUsd: dividendPool,
    deployableUsd,
    thinBook: injectAll,
    injectAllSeat: injectAll,
    minHopUsd,
    cascadeSeedUsd: CASCADE_SEED_USD,
    leaveDustUsd: CASCADE_LEAVE_DUST_USD,
    dividendFloorPct: DIVIDEND_FLOOR,
    dividendCapPct: DIVIDEND_CAP,
    hopsAffordable,
    cadenceTarget: CASCADE_TARGET_HOPS,
    note: "HOME bag parks fuel/piggy — cascade spends liquid ETH/WETH + dividend withdraws only",
  };
}

/**
 * Tag seats with Base hierarchy + merge RH wave fields when present.
 */
export function tagCascadeHierarchy(seats = []) {
  return (seats || []).map((s) => {
    const sym = normSym(s.symbol);
    const tier = cascadeTierOf(sym);
    const wave = loadWavePointsFromToken(s);
    return {
      ...s,
      symbol: sym,
      tier,
      isMain: tier === "MAIN" || tier === "BRIDGE",
      isLower: tier === "LOWER" || tier === "BRIDGE",
      isHome: tier === "HOME",
      deferred: tier === "DEFERRED",
      aeroMain: sym === "AERO" || s.aeroMain === true,
      minBuyUsd: minBuyUsdFor(sym),
      wave,
      rangePos: wave.rangePos,
      waveReady: wave.ready,
      rail: "base",
      waveDataSource: s.dataSource || s.waveDataSource || "token-embedded",
    };
  });
}

/**
 * Prediction model: next hop into LOWER (snowball) or MAIN (goal) with $ amounts.
 */
export function predictCascadeHops({
  seats = [],
  capital = null,
  liquidUsd = 0,
  homeBagUsd = 11,
  ethUsd = 2700,
  bagsDividendUsd = 0,
} = {}) {
  const cap = capital || viableCascadeCapital({ liquidUsd, homeBagUsd, ethUsd, bagsDividendUsd });
  const tagged = tagCascadeHierarchy(seats).filter((s) => !s.frozen && !s.deferred && !s.isHome);
  const deploy = cap.deployableUsd;

  const lowerReady = tagged
    .filter((s) => s.isLower && s.waveReady && (s.predictedUp || (s.rangePos != null && s.rangePos <= CASCADE_CHEAP_RANGE_MAX)))
    .sort((a, b) => (a.rangePos ?? 1) - (b.rangePos ?? 1) || a.symbol.localeCompare(b.symbol));

  const mainReady = tagged
    .filter((s) => (s.tier === "MAIN" || s.tier === "BRIDGE") && s.waveReady
      && (s.predictedUp || (s.rangePos != null && s.rangePos <= CASCADE_CHEAP_RANGE_MAX)))
    .sort((a, b) => {
      // AERO bridge preferred among mains when thin; else cheaper rangePos
      if (a.aeroMain && !b.aeroMain) return -1;
      if (b.aeroMain && !a.aeroMain) return 1;
      return (a.rangePos ?? 1) - (b.rangePos ?? 1) || a.symbol.localeCompare(b.symbol);
    });

  const dividendReady = tagged
    .filter((s) => num(s.dividendPct, 0) >= DIVIDEND_FLOOR && num(s.bagUsd, 0) > 0)
    .map((s) => {
      const bag = num(s.bagUsd, 0);
      const pct = Math.min(DIVIDEND_CAP, Math.max(DIVIDEND_FLOOR, num(s.dividendPct)));
      const withdrawUsd = bag * pct;
      const leaveUsd = bag - withdrawUsd;
      return {
        symbol: s.symbol,
        tier: s.tier,
        bagUsd: bag,
        dividendPct: pct,
        withdrawUsd,
        leaveUsd,
        viableNextHop: withdrawUsd >= Math.max(cap.minHopUsd, s.minBuyUsd),
      };
    })
    .sort((a, b) => b.withdrawUsd - a.withdrawUsd);

  let phase = PHASES.HOLD_HOME;
  let next = null;
  let goal = null;

  if (cap.thinBook || deploy < INJECT_ALL_USD) {
    phase = PHASES.SNOWBALL_SMALL;
    const pick = lowerReady[0] || (mainReady.find((s) => s.aeroMain) || null);
    if (pick) {
      const need = Math.max(cap.minHopUsd, pick.minBuyUsd);
      const funded = deploy >= need;
      const usd = funded
        ? (cap.injectAllSeat ? deploy : Math.min(deploy, need))
        : need;
      next = {
        symbol: pick.symbol,
        tier: pick.tier,
        action: pick.aeroMain ? "cascade-aero-in" : "cascade-lower-in",
        usd: Math.round(usd * 100) / 100,
        needUsd: Math.round(need * 100) / 100,
        viable: funded,
        rangePos: pick.rangePos,
        waveDataSource: pick.waveDataSource,
        reason: funded
          ? "thin book — inject-all into lower/velocity snowball seat"
          : `snowball seat ready — need $${need.toFixed(2)} deployable (have $${deploy.toFixed(2)}; HOME $${cap.homeBagUsd.toFixed(2)} locked)`,
      };
    }
    goal = mainReady[0] || tagged.find((s) => s.tier === "MAIN") || null;
  }

  if (dividendReady.some((d) => d.viableNextHop)) {
    phase = PHASES.DIVIDEND_POOL;
    const d = dividendReady.find((x) => x.viableNextHop);
    const target = mainReady[0] || lowerReady[0];
    if (d && target) {
      next = {
        symbol: target.symbol,
        tier: target.tier,
        action: target.tier === "MAIN" || target.aeroMain ? "cascade-main-in" : "cascade-lower-in",
        usd: Math.round(Math.min(d.withdrawUsd, deploy + d.withdrawUsd) * 100) / 100,
        fromDividend: d.symbol,
        dividendPct: d.dividendPct,
        rangePos: target.rangePos,
        waveDataSource: target.waveDataSource,
        reason: `dividend ${(d.dividendPct * 100).toFixed(0)}% from ${d.symbol} → pool toward ${target.symbol}`,
      };
      goal = target;
    }
  }

  // Goal main when deployable clears a main min (snowball grown)
  const mainTarget = mainReady[0];
  if (mainTarget && deploy >= Math.max(INJECT_ALL_USD * 0.5, mainTarget.minBuyUsd, 2)) {
    if (phase === PHASES.SNOWBALL_SMALL && deploy >= mainTarget.minBuyUsd * 2) {
      phase = PHASES.GOAL_MAIN;
      next = {
        symbol: mainTarget.symbol,
        tier: mainTarget.tier,
        action: mainTarget.aeroMain ? "cascade-aero-in" : "cascade-main-in",
        usd: Math.round(Math.min(deploy * 0.65, deploy) * 100) / 100,
        rangePos: mainTarget.rangePos,
        waveDataSource: mainTarget.waveDataSource,
        reason: "snowball cleared main entry — goal into inject main",
      };
      goal = mainTarget;
    } else if (!goal) {
      goal = mainTarget;
    }
  }

  if (!goal && tagged.length) {
    goal = tagged.find((s) => s.tier === "MAIN") || tagged.find((s) => s.aeroMain) || null;
  }

  return {
    phase,
    capital: cap,
    next,
    goal: goal
      ? {
          symbol: goal.symbol,
          tier: goal.tier,
          minBuyUsd: goal.minBuyUsd,
          rangePos: goal.rangePos,
          aeroMain: goal.aeroMain === true,
        }
      : null,
    lowerReady: lowerReady.map((s) => ({
      symbol: s.symbol,
      tier: s.tier,
      price: s.price,
      rangePos: s.rangePos,
      minBuyUsd: s.minBuyUsd,
      waveDataSource: s.waveDataSource,
    })),
    mainReady: mainReady.map((s) => ({
      symbol: s.symbol,
      tier: s.tier,
      price: s.price,
      rangePos: s.rangePos,
      minBuyUsd: s.minBuyUsd,
      aeroMain: s.aeroMain === true,
      waveDataSource: s.waveDataSource,
    })),
    dividendReady,
    hierarchy: {
      home: HOME_CASCADE_PIGGY_HOLDER,
      aero: AERO_CASCADE_INOUT,
      main: CASCADE_MAIN_SYMBOLS.slice(),
      lower: CASCADE_LOWER_SYMBOLS.slice(),
      deferred: CASCADE_DEFERRED_MAJORS.slice(),
    },
  };
}

/**
 * Full Base program plan. Optional RH seats only supply wave envelopes.
 */
export function planBaseCascadeProgram({
  seats = [],
  liquidUsd = 0,
  homeBagUsd = 11,
  ethUsd = 2700,
  bagsDividendUsd = 0,
  hopTimestamps = [],
  message,
  maxHops = null,
} = {}) {
  const capital = viableCascadeCapital({ liquidUsd, homeBagUsd, ethUsd, bagsDividendUsd });
  const tagged = tagCascadeHierarchy(seats);
  const prediction = predictCascadeHops({
    seats: tagged,
    capital,
  });

  // Order tokens for message-cascade: LOWER first on thin book, else mains boosted later
  const ordered = tagged.slice().sort((a, b) => {
    if (a.isHome && !b.isHome) return 1;
    if (b.isHome && !a.isHome) return -1;
    if (a.deferred && !b.deferred) return 1;
    if (b.deferred && !a.deferred) return -1;
    if (capital.thinBook) {
      // snowball: lower/bridge before pure mains
      const ar = a.isLower ? 0 : a.isMain ? 1 : 2;
      const br = b.isLower ? 0 : b.isMain ? 1 : 2;
      if (ar !== br) return ar - br;
      return (a.rangePos ?? 1) - (b.rangePos ?? 1);
    }
    // grown book: mains first
    const ar = a.isMain ? 0 : a.isLower ? 1 : 2;
    const br = b.isMain ? 0 : b.isLower ? 1 : 2;
    if (ar !== br) return ar - br;
    return (a.rangePos ?? 1) - (b.rangePos ?? 1);
  });

  // Bias revenue score so ranking matches phase
  const forPlan = ordered.map((s) => ({
    ...s,
    revenueUsd: num(s.revenueUsd, 0) + (
      capital.thinBook
        ? (s.isLower ? 0.5 : s.isMain ? 0.1 : 0)
        : (s.isMain ? 0.5 : s.isLower ? 0.2 : 0)
    ),
  }));

  const cascade = planMessageCascade({
    tokens: forPlan,
    hopTimestamps,
    message,
    maxHops: maxHops != null ? maxHops : Math.min(CASCADE_TARGET_HOPS, Math.max(1, capital.hopsAffordable || CASCADE_TARGET_HOPS)),
  });

  for (const hop of cascade.hops || []) {
    const tier = cascadeTierOf(hop.symbol);
    hop.tier = tier;
    if (normSym(hop.symbol) === "AERO") {
      hop.aeroMain = true;
      hop.action = hop.sellArm?.armed
        ? "cascade-aero-out"
        : hop.waitingUp || hop.cheap
          ? "cascade-aero-in"
          : "cascade-aero-hop";
    } else if (tier === "LOWER" && (hop.waitingUp || hop.cheap)) {
      hop.action = "cascade-lower-in";
    } else if (tier === "MAIN" && (hop.waitingUp || hop.cheap)) {
      hop.action = "cascade-main-in";
    }
  }

  return {
    id: BASE_CASCADE_PROGRAM_ID,
    label: BASE_CASCADE_LABEL,
    rail: "base",
    waveData: "robinhood-or-token-embedded",
    execution: "base-risk-original-path",
    capital,
    prediction,
    cascade,
    seats: tagged,
    neverInventHashes: true,
    neverSellRedToInject: true,
    neverSellHome: true,
    home: HOME_CASCADE_PIGGY_HOLDER,
    aero: AERO_CASCADE_INOUT,
  };
}

export function formatBaseCascadeProgramCard(plan) {
  if (!plan) return "BASE_CASCADE_PROGRAM — empty";
  const c = plan.capital;
  const p = plan.prediction;
  const lines = [
    `🟦 <b>BASE CASCADE PROGRAM</b>`,
    `Rail: Base RISK (original path) · Wave data: RH overlay only`,
    `Phase: <b>${esc(p.phase)}</b>`,
    "",
    `💰 <b>Viable capital</b>`,
    `HOME piggy $${c.homeBagUsd.toFixed(2)} (never spend) · liquid $${c.liquidUsd.toFixed(2)}`,
    `Gas floor ~$${c.gasFloorUsd.toFixed(2)} · tradeable $${c.tradeableUsd.toFixed(2)}`,
    `Dividend pool $${c.dividendPoolUsd.toFixed(2)} · <b>deployable $${c.deployableUsd.toFixed(2)}</b>`,
    `Thin/inject-all: ${c.thinBook ? "YES" : "no"} · min hop $${c.minHopUsd.toFixed(2)} · hops≈${c.hopsAffordable}`,
    `Dividend band ${(c.dividendFloorPct * 100).toFixed(0)}–${(c.dividendCapPct * 100).toFixed(0)}% · dust $${c.leaveDustUsd.toFixed(2)}`,
    "",
    `🏷 MAIN: ${CASCADE_MAIN_SYMBOLS.join(" ")}`,
    `❄ LOWER: ${CASCADE_LOWER_SYMBOLS.join(" ")}`,
    `⏸ DEFERRED: ${CASCADE_DEFERRED_MAJORS.join(" ")}`,
    "",
  ];
  if (p.next) {
    const viv = p.next.viable === false ? " ⚠ underfunded" : " ✓ viable";
    lines.push(
      `▶ NEXT <b>${esc(p.next.symbol)}</b> [${esc(p.next.tier)}] $${Number(p.next.usd).toFixed(2)} · ${esc(p.next.action)}${viv}`,
      `  ${esc(p.next.reason)}`,
    );
  } else {
    lines.push("▶ NEXT — waiting wave-ready lower seat or dividend withdraw");
  }
  if (p.goal) {
    lines.push(
      `🎯 GOAL <b>${esc(p.goal.symbol)}</b> [${esc(p.goal.tier)}] min $${Number(p.goal.minBuyUsd).toFixed(2)}`,
    );
  }
  if (p.lowerReady.length) {
    lines.push(`LOWER ready: ${p.lowerReady.slice(0, 6).map((s) => s.symbol).join(" ")}`);
  }
  if (p.mainReady.length) {
    lines.push(`MAIN ready: ${p.mainReady.slice(0, 6).map((s) => s.symbol).join(" ")}`);
  }
  if (p.dividendReady.length) {
    for (const d of p.dividendReady.slice(0, 4)) {
      lines.push(
        `💸 DIV ${esc(d.symbol)} ${(d.dividendPct * 100).toFixed(0)}% → $${d.withdrawUsd.toFixed(2)} (leave $${d.leaveUsd.toFixed(2)})${d.viableNextHop ? " ✓ hop" : ""}`,
      );
    }
  }
  lines.push("", formatMessageCascadeCard(plan.cascade));
  return lines.join("\n");
}

export function formatCascadePredictionCard(plan) {
  if (!plan?.prediction) return "No prediction.";
  const p = plan.prediction;
  const c = plan.capital;
  const lines = [
    `🔮 <b>CASCADE PREDICTION</b>`,
    `Phase ${esc(p.phase)} · deployable <b>$${c.deployableUsd.toFixed(2)}</b> · HOME $${c.homeBagUsd.toFixed(2)} locked`,
  ];
  if (p.next) {
    const viv = p.next.viable === false ? "underfunded" : "viable";
    lines.push(
      `Next hop: <b>${esc(p.next.symbol)}</b> $${Number(p.next.usd).toFixed(2)} (${esc(p.next.tier)}) · ${viv}`,
      esc(p.next.reason),
    );
  } else {
    lines.push("Next hop: none ready — waiting wave-ready LOWER or dividend ≥ seed");
  }
  if (p.goal) {
    lines.push(`Goal main: <b>${esc(p.goal.symbol)}</b> when pool ≥ $${Number(p.goal.minBuyUsd).toFixed(2)}`);
  }
  lines.push(
    "",
    `Model: snowball LOWER → dividend ${(DIVIDEND_FLOOR * 100).toFixed(0)}–${(DIVIDEND_CAP * 100).toFixed(0)}% → GOAL MAIN`,
    `RH marks feed wave only · swaps stay Base`,
  );
  return lines.join("\n");
}

export function parseBaseCascadeCommand(raw) {
  const src = String(raw || "").trim();
  const low = src.toLowerCase();
  if (low === "/cascade" || low === "/cascade base" || low === "/cascade program") {
    return { ok: true, action: "program" };
  }
  if (low === "/cascade predict" || low === "/cascade prediction" || low === "/cascade model") {
    return { ok: true, action: "predict" };
  }
  if (low === "/cascade outcomes" || low === "/cascade next") {
    return { ok: true, action: "outcomes" };
  }
  if (low === "/cascade trail" || low === "/cascade route") {
    return { ok: true, action: "trail" };
  }
  if (low === "/cascade unlock" || low === "/cascade sells") {
    return { ok: true, action: "unlock" };
  }
  if (low === "/cascade hierarchy" || low === "/cascade tiers") {
    return { ok: true, action: "hierarchy" };
  }
  if (low.startsWith("/cascade ")) {
    return { ok: true, action: "program", arg: src.slice(9).trim() };
  }
  return { ok: false };
}

export function formatCascadeHierarchyCard() {
  return [
    `🏷 <b>CASCADE HIERARCHY</b> (Base rail)`,
    `🏠 HOME — piggy/fuel, never sell`,
    `✈ AERO — main in/out bridge`,
    `⬆ MAIN — ${CASCADE_MAIN_SYMBOLS.join(" ")}`,
    `❄ LOWER — ${CASCADE_LOWER_SYMBOLS.join(" ")}`,
    `⏸ DEFERRED — ${CASCADE_DEFERRED_MAJORS.join(" ")} (not for $11 snowball)`,
    "",
    `Path: LOWER snowball → dividend 10–30% → MAIN goal`,
    `Wave data may come from Robinhood; execution never leaves Base.`,
  ].join("\n");
}
