/**
 * Robinhood WAVE DATA overlay for the Base cascade program.
 *
 * RH (MCP / Agentic quotes) only auto-populates marks + wave envelopes.
 * Execution stays on the original Base RISK path
 * (`vita/base-cascade-program.js` — LOWER snowball → dividend → MAIN).
 * Locs stay empty until a real covered leftover sell seals the trail.
 *
 * Hubs:
 *   $HOME — piggy / fuel (rotate never sells; APPROVE_HOME_SELL unset)
 *   AERO  — main in/out bridge on Base
 *
 * Never invents tx hashes. Never sells red to place code.
 * Mother brain untouched.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stampTripleTime } from "../modules/phosphor/blocks.js";
import { clearHoldAllSells, holdAllSellsStatusLine } from "../operator-sell-hold.js";
import { VERIFIED_HOME_SYMBOL } from "../operator-rotate.js";
import { ROBINHOOD_QUOTE_MIRROR } from "./wave-agent-bank.js";
import {
  hyphenUsd,
  quoteFromRhResult,
  readQuoteWave,
  ingestSourceQuotes,
  createFlowBook,
  buildFlowRouteLine,
  bankFlowRoute,
} from "./wave-flow-arm.js";
import {
  HOME_CASCADE_PIGGY_HOLDER,
  AERO_CASCADE_INOUT,
  loadWavePointsFromToken,
  armSellOnMoveUp,
  CASCADE_CHEAP_RANGE_MAX,
  CASCADE_MOVE_UP_RANGE_POS,
} from "./message-cascade.js";
import {
  planBaseCascadeProgram,
  formatBaseCascadeProgramCard,
  formatCascadePredictionCard,
  formatCascadeHierarchyCard,
  parseBaseCascadeCommand,
  cascadeTierOf,
} from "./base-cascade-program.js";

export { AERO_CASCADE_INOUT };
export {
  planBaseCascadeProgram,
  formatBaseCascadeProgramCard,
  formatCascadePredictionCard,
  formatCascadeHierarchyCard,
  parseBaseCascadeCommand,
};

const HERE = dirname(fileURLToPath(import.meta.url));
const MEMORY_DIR = join(HERE, "memory");
const STRANDS_DIR = join(HERE, "strands");
const LEARN_PATH = join(MEMORY_DIR, "rh-cascade-rail-learn.json");
const LEDGER_PATH = join(MEMORY_DIR, "rh-cascade-rail-ledger.json");
const TRAIL_PATH = join(MEMORY_DIR, "rh-cascade-trail.json");
const STRAND_PATH = join(STRANDS_DIR, "rh-cascade-rail.json");

export const RH_CASCADE_RAIL_ID = "rh-cascade-rail-v1";
export const RH_CASCADE_MAGIC = "§CASCTRAIL§v1";
export const RH_CASCADE_LABEL = "RH_CASCADE_RAIL";
export const RH_CASCADE_MAX_BYTES = 360;

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

function ensureDir(p) {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

function readJson(path, fallback) {
  try {
    if (!existsSync(path)) return fallback;
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(path, data) {
  ensureDir(dirname(path));
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

function shortHex(text, n = 8) {
  return createHash("sha256").update(String(text || ""), "utf8").digest("hex").slice(0, n);
}

function px(n) {
  const x = num(n);
  if (!(x > 0)) return "-";
  if (x >= 100) return x.toFixed(2);
  if (x >= 1) return x.toFixed(4);
  return x.toPrecision(4);
}

/**
 * Unlock the global sell barrier in-process. HOME stays never-sell unless
 * APPROVE_HOME_SELL=yes (we do not set that here).
 */
export function unlockSellBarrier(env = process.env) {
  clearHoldAllSells(env);
  return {
    ok: true,
    holdAllSells: false,
    homeNeverSell: String(env?.APPROVE_HOME_SELL || "").trim().toLowerCase() !== "yes",
    status: holdAllSellsStatusLine(env),
    note: "Other bags may sell when gated green. $HOME stays never-sell.",
  };
}

/**
 * Map Robinhood quote rows → Base cascade seats with instant wave envelope.
 * prevClose ↔ trough bias, mark↔peak stretch when rising; reverse when falling.
 */
export function seatsFromRhQuotes(rows = [], {
  catalog = null,
  at = Date.now(),
} = {}) {
  const byPair = new Map();
  for (const row of rows || []) {
    const q = quoteFromRhResult(row);
    if (!q) continue;
    byPair.set(q.pair, q);
  }

  const mirrors = ROBINHOOD_QUOTE_MIRROR.filter((m) => m.symbol !== "USDC");
  const seats = [];
  for (const m of mirrors) {
    const q = byPair.get(m.pair);
    if (!q) continue;
    const wave = readQuoteWave(q);
    const mark = num(q.mark);
    const prev = num(q.prevClose, mark);
    const amp = wave.amp != null ? wave.amp : 0;
    // Instant HL from RH tape: trough = min(mark,prev)*(1-soft), peak = max*(1+soft)
    const soft = Math.max(0.02, Math.min(0.12, amp || 0.03));
    const lo = Math.min(mark, prev) * (1 - soft * 0.35);
    const hi = Math.max(mark, prev) * (1 + soft);
    const rangePos = hi > lo ? (mark - lo) / (hi - lo) : 0.5;
    const predictedUp = wave.leg === "crash" || rangePos <= CASCADE_CHEAP_RANGE_MAX;
    const movingUp = wave.leg === "rise" && rangePos >= CASCADE_MOVE_UP_RANGE_POS;
    const stagnant = wave.amp != null && wave.amp < 0.008 && !wave.large;
    const cat = Array.isArray(catalog)
      ? catalog.find((t) => normSym(t.symbol) === m.symbol)
      : null;
    const seat = {
      symbol: m.symbol,
      address: cat?.address || null,
      price: mark,
      lastPrice: mark,
      minTrough: lo,
      maxPeak: hi,
      troughs: [lo, Math.min(mark, prev)],
      peaks: [Math.max(mark, prev), hi],
      predictedUp,
      movingUp,
      // Only set when true — armSellOnMoveUp treats goingDown===false as predictedUp.
      ...(wave.leg === "crash" && wave.large ? { goingDown: true } : {}),
      stagnant,
      frozen: cat?.frozen === true,
      revenueUsd: num(cat?.revenueUsd, 0),
      rhPair: m.pair,
      rhMark: mark,
      rhPrevClose: prev > 0 ? prev : null,
      rhAmp: wave.amp,
      rhLeg: wave.leg,
      rhGlyph: wave.glyph,
      rhAdvice: wave.advice,
      dataSource: "robinhood",
      rail: "base",
      sameToken: m.sameToken !== false,
      quoteAt: q.at || null,
      populatedAt: new Date(at).toISOString(),
    };
    if (m.symbol === AERO_CASCADE_INOUT.symbol) {
      seat.aeroMain = true;
      seat.role = AERO_CASCADE_INOUT.role;
    }
    if (m.symbol === VERIFIED_HOME_SYMBOL) {
      seat.home = true;
      seat.piggyHolder = true;
      seat.role = HOME_CASCADE_PIGGY_HOLDER.role;
    }
    seats.push(seat);
  }
  return seats;
}

/**
 * Next outcomes: which seats are ready long (enter) vs ready exit (cascade out).
 */
export function nextCascadeOutcomes(seats = []) {
  const enter = [];
  const exit = [];
  const hold = [];
  for (const seat of seats || []) {
    const wave = loadWavePointsFromToken(seat);
    const sell = armSellOnMoveUp({
      ...seat,
      wave,
      // Require explicit move-up for exit arm (ignore goingDown===false quirk).
      movingUp: seat.movingUp === true,
      predictedUp: seat.predictedUp === true && seat.movingUp === true,
      recentMovePct: seat.movingUp ? 0.01 : 0,
    });
    const sym = normSym(seat.symbol);
    const waitingUp = wave.ready && wave.rangePos != null && wave.rangePos <= CASCADE_CHEAP_RANGE_MAX;
    const readyExit = sell.armed === true && seat.movingUp === true;
    const readyEnter = !readyExit && (waitingUp || (seat.rhLeg === "crash" && seat.predictedUp));
    const row = {
      symbol: sym,
      price: seat.price,
      rangePos: wave.rangePos,
      rhLeg: seat.rhLeg,
      rhAmp: seat.rhAmp,
      waitingUp,
      sellArmed: readyExit,
      exitAt: sell.exitAt || null,
      aeroMain: seat.aeroMain === true || sym === "AERO",
      home: sym === VERIFIED_HOME_SYMBOL,
      action: null,
    };
    if (row.home) {
      row.action = "home-piggy-hold";
      hold.push(row);
      continue;
    }
    if (readyExit) {
      row.action = row.aeroMain ? "aero-cascade-out" : "cascade-out";
      exit.push(row);
    } else if (readyEnter) {
      row.action = row.aeroMain ? "aero-cascade-in" : "cascade-in";
      enter.push(row);
    } else {
      row.action = "watch";
      hold.push(row);
    }
  }
  // Prefer LOWER snowball then AERO bridge (Base hierarchy — not RH rank)
  const tierRank = (r) => {
    const t = cascadeTierOf(r.symbol);
    if (t === "LOWER") return 0;
    if (t === "BRIDGE") return 1;
    if (t === "MAIN") return 2;
    return 3;
  };
  const sortLane = (a, b) => tierRank(a) - tierRank(b)
    || (a.rangePos ?? 1) - (b.rangePos ?? 1)
    || a.symbol.localeCompare(b.symbol);
  for (const row of [...enter, ...exit, ...hold]) {
    row.tier = cascadeTierOf(row.symbol);
  }
  enter.sort(sortLane);
  exit.sort(sortLane);
  return { enter, exit, hold, readyCount: enter.length + exit.length };
}

/**
 * Short machine trail for blockchain hitch. loc=- until a real Base sell hash.
 */
export function buildCascadeTrailLine({
  seats = [],
  outcomes = null,
  at = Date.now(),
  src = "robinhood",
} = {}) {
  const stamp = stampTripleTime(at);
  const out = outcomes || nextCascadeOutcomes(seats);
  const topIn = out.enter.slice(0, 3).map((r) => `${r.symbol}@${px(r.price)}`).join(",") || "-";
  const topOut = out.exit.slice(0, 3).map((r) => `${r.symbol}@${px(r.price)}`).join(",") || "-";
  let keepIn = 3;
  let keepOut = 3;
  let line = "";
  do {
    const tin = out.enter.slice(0, keepIn).map((r) => `${r.symbol}@${px(r.price)}`).join(",") || "-";
    const tout = out.exit.slice(0, keepOut).map((r) => `${r.symbol}@${px(r.price)}`).join(",") || "-";
    line = [
      RH_CASCADE_MAGIC,
      `utc=${stamp.utc}`,
      `local=${stamp.local}`,
      `unix=${stamp.unix}`,
      `label=${RH_CASCADE_LABEL}`,
      `src=${src}`,
      `rail=base`,
      `hubs=HOME,AERO`,
      `n=${seats.length}`,
      `in=${tin}`,
      `out=${tout}`,
      "loc=-",
      "next=END",
    ].join("|");
    if (Buffer.byteLength(line, "utf8") <= RH_CASCADE_MAX_BYTES) break;
    if (keepOut > 0) keepOut -= 1;
    else if (keepIn > 0) keepIn -= 1;
    else break;
  } while (keepIn >= 0 || keepOut >= 0);
  void topIn;
  void topOut;
  return {
    line,
    bytes: Buffer.byteLength(line, "utf8"),
    stamp,
    txHash: null,
    commit8: shortHex(line, 8),
    neverInventHashes: true,
  };
}

export function fileCascadeTrail(built, {
  seats = [],
  outcomes = null,
  at = null,
} = {}) {
  if (!built?.line) return { ok: false };
  const when = at || built.stamp?.utc || new Date().toISOString();
  const trail = readJson(TRAIL_PATH, {
    id: RH_CASCADE_RAIL_ID,
    filingLabel: RH_CASCADE_LABEL,
    magic: RH_CASCADE_MAGIC,
    entries: [],
  });
  const entry = {
    at: when,
    line: built.line,
    commit8: built.commit8,
    bytes: built.bytes,
    txHash: null,
    seats: (seats || []).map((s) => ({
      symbol: s.symbol,
      price: s.price,
      rhPair: s.rhPair,
      rhLeg: s.rhLeg,
      rangePos: loadWavePointsFromToken(s).rangePos,
    })),
    outcomes: outcomes || nextCascadeOutcomes(seats),
    availability: "local",
    proven: false,
  };
  trail.entries.push(entry);
  while (trail.entries.length > 48) trail.entries.shift();
  trail.updatedAt = when;
  writeJson(TRAIL_PATH, trail);

  const ledger = readJson(LEDGER_PATH, { id: RH_CASCADE_RAIL_ID, entries: [] });
  ledger.entries.push({
    at: when,
    kind: "trail",
    commit8: built.commit8,
    seatCount: seats.length,
    enter: entry.outcomes.enter.map((r) => r.symbol),
    exit: entry.outcomes.exit.map((r) => r.symbol),
    loc: null,
  });
  writeJson(LEDGER_PATH, ledger);
  return { ok: true, entry, trail };
}

/**
 * Seal trail with a real Base tx hash only (never invent).
 */
export function commitCascadeTrailHash({ line, txHash }) {
  const TX_RE = /^0x[0-9a-fA-F]{64}$/;
  if (!TX_RE.test(String(txHash || ""))) return { ok: false, reason: "invalid_hash" };
  const trail = readJson(TRAIL_PATH, null);
  if (!trail?.entries?.length) return { ok: false, reason: "no_trail" };
  const row = [...trail.entries].reverse().find((e) => e.line === line && !e.txHash);
  if (!row) return { ok: false, reason: "line_not_found" };
  row.txHash = String(txHash);
  row.proven = true;
  row.availability = "proven";
  trail.updatedAt = new Date().toISOString();
  writeJson(TRAIL_PATH, trail);
  return { ok: true, txHash: row.txHash };
}

/**
 * Full plan: RH wave overlay → Base program (snowball→dividend→main) → trail.
 */
export function planRhBaseCascade({
  rhRows = [],
  catalog = null,
  hopTimestamps = [],
  message,
  maxHops = null,
  flowBook = null,
  unlockSells = false,
  env = process.env,
  at = Date.now(),
  liquidUsd = 0,
  homeBagUsd = 11,
  ethUsd = 2700,
  bagsDividendUsd = 0,
} = {}) {
  const unlock = unlockSells ? unlockSellBarrier(env) : {
    ok: false,
    status: holdAllSellsStatusLine(env),
    note: "pass unlockSells:true to clear HOLD_ALL_SELLS",
  };

  let book = flowBook;
  let flowFiled = null;
  if (book && rhRows.length) {
    flowFiled = ingestSourceQuotes(book, "robinhood", rhRows, { at });
    if (flowFiled?.ok) {
      const route = buildFlowRouteLine(book, { at });
      bankFlowRoute(book, route);
    }
  } else if (!book && rhRows.length) {
    book = createFlowBook();
    flowFiled = ingestSourceQuotes(book, "robinhood", rhRows, { at });
  }

  const seats = seatsFromRhQuotes(rhRows, { catalog, at });
  // Merge catalog-only Base seats (velocity/mains missing from RH mirror)
  if (Array.isArray(catalog)) {
    const have = new Set(seats.map((s) => normSym(s.symbol)));
    for (const t of catalog) {
      const sym = normSym(t.symbol);
      if (!sym || have.has(sym) || !(t.price > 0)) continue;
      if (t.frozen === true) continue;
      seats.push({
        ...t,
        symbol: sym,
        dataSource: "base-catalog",
        rail: "base",
        waveDataSource: "token-embedded",
        predictedUp: t.predictedUp !== false,
      });
      have.add(sym);
    }
  }
  if (!seats.some((s) => s.symbol === "AERO") && Array.isArray(catalog)) {
    const aero = catalog.find((t) => normSym(t.symbol) === "AERO");
    if (aero?.price > 0) {
      seats.push({
        ...aero,
        symbol: "AERO",
        aeroMain: true,
        role: AERO_CASCADE_INOUT.role,
        dataSource: "catalog-fallback",
        rail: "base",
        predictedUp: true,
      });
    }
  }

  const outcomes = nextCascadeOutcomes(seats);
  const program = planBaseCascadeProgram({
    seats,
    liquidUsd,
    homeBagUsd,
    ethUsd,
    bagsDividendUsd,
    hopTimestamps,
    message,
    maxHops,
  });

  const trail = buildCascadeTrailLine({
    seats,
    outcomes,
    at,
    src: "rh-wave+base-program",
  });
  return {
    id: RH_CASCADE_RAIL_ID,
    magic: RH_CASCADE_MAGIC,
    label: RH_CASCADE_LABEL,
    dataSource: "robinhood-wave-only",
    rail: "base",
    execution: "base-risk-original-path",
    unlock,
    hubs: {
      home: HOME_CASCADE_PIGGY_HOLDER,
      aero: AERO_CASCADE_INOUT,
    },
    seatCount: seats.length,
    seats,
    outcomes,
    program,
    cascade: program.cascade,
    capital: program.capital,
    prediction: program.prediction,
    trail,
    flowFiled,
    neverInventHashes: true,
    neverSellRedToInject: true,
    neverSellHome: true,
  };
}

export function fileRhCascadeLearn(plan, { at = new Date().toISOString(), operatorText = "" } = {}) {
  const learn = readJson(LEARN_PATH, { id: "rh-cascade-rail-learn-v1", filingLabel: RH_CASCADE_LABEL, notes: [] });
  const next = plan.prediction?.next;
  learn.notes.push({
    at,
    topic: "rh-wave-base-program",
    text: operatorText
      || `RH wave overlay → Base program phase=${plan.prediction?.phase} · deployable $${Number(plan.capital?.deployableUsd || 0).toFixed(2)} · next ${next ? `${next.symbol} $${next.usd}` : "—"} · trail ${plan.trail?.commit8} loc empty. HOME never-sell. RH never executes.`,
    locations: [],
  });
  writeJson(LEARN_PATH, learn);
  fileCascadeTrail(plan.trail, { seats: plan.seats, outcomes: plan.outcomes, at });
  writeJson(STRAND_PATH, {
    id: RH_CASCADE_RAIL_ID,
    filingLabel: RH_CASCADE_LABEL,
    magic: RH_CASCADE_MAGIC,
    at,
    sparse: true,
    dataSource: "robinhood-wave-only",
    rail: "base",
    execution: "base-risk-original-path",
    hubs: ["HOME", "AERO"],
    lastCommit8: plan.trail?.commit8 || null,
    learn:
      "Robinhood is wave data only. Base original path runs LOWER snowball → dividend 10–30% → MAIN goal. " +
      "AERO bridges in/out; HOME is piggy never-sell. §CASCTRAIL§ loc empty until real Base hash. " +
      "Never invent hashes. Never sell red to place code.",
  });
  return { ok: true };
}

export function formatRhCascadeCard(plan) {
  if (!plan) return "RH_CASCADE_RAIL — empty";
  if (plan.program) {
    const head = [
      esc(plan.unlock?.status || ""),
      `Wave seats ${plan.seatCount} · trail <code>${esc(plan.trail?.commit8 || "")}</code>`,
      "",
    ].filter(Boolean);
    return `${head.join("\n")}\n${formatBaseCascadeProgramCard(plan.program)}`;
  }
  return formatBaseCascadeProgramCard(plan);
}

function formatOutcomesLane(plan) {
  if (!plan?.outcomes) return "No outcomes.";
  const lines = ["📡 <b>WAVE LANES</b> (RH data · Base act)"];
  for (const r of plan.outcomes.enter.slice(0, 10)) {
    const tier = r.tier || cascadeTierOf(r.symbol);
    lines.push(
      `↑ IN  <b>${esc(r.symbol)}</b> [${esc(tier)}] ${px(r.price)} pos=${r.rangePos != null ? r.rangePos.toFixed(2) : "?"}`,
    );
  }
  for (const r of plan.outcomes.exit.slice(0, 10)) {
    const tier = r.tier || cascadeTierOf(r.symbol);
    lines.push(
      `↓ OUT <b>${esc(r.symbol)}</b> [${esc(tier)}] ${px(r.price)} sell@${r.exitAt != null ? px(r.exitAt) : "?"}`,
    );
  }
  if (!plan.outcomes.enter.length && !plan.outcomes.exit.length) {
    lines.push("No ready in/out — waiting wave HL on Base hierarchy seats.");
  }
  if (plan.trail?.line) lines.push("", `<code>${esc(plan.trail.line)}</code>`);
  return lines.join("\n");
}

export function formatRhCascadeOutcomes(plan) {
  if (plan?.prediction) {
    return `${formatCascadePredictionCard(plan)}\n\n${formatOutcomesLane(plan)}`;
  }
  return formatOutcomesLane(plan);
}

/** Prefer Base program parser; keep RH alias. */
export function parseRhCascadeCommand(raw) {
  const base = parseBaseCascadeCommand(raw);
  if (base.ok) {
    if (base.action === "program") return { ok: true, action: "board" };
    return base;
  }
  const low = String(raw || "").trim().toLowerCase();
  if (low === "/rhcascade" || low === "/cascade rh") {
    return { ok: true, action: "board" };
  }
  return { ok: false };
}
