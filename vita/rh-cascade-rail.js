/**
 * Robinhood data → Base cascade rail.
 *
 * RH (MCP / Agentic quotes) auto-populates marks + wave envelopes.
 * Base rail executes cascade in/out (RISK /buy · /sell). Locs stay empty
 * until a real covered leftover sell seals the trail line.
 *
 * Hubs:
 *   $HOME — piggy / fuel (rotate never sells; APPROVE_HOME_SELL unset)
 *   AERO  — main in/out cascade (buy + pre-arm sell when wave ready)
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
  planMessageCascade,
  formatMessageCascadeCard,
  loadWavePointsFromToken,
  armSellOnMoveUp,
  CASCADE_CHEAP_RANGE_MAX,
  CASCADE_MOVE_UP_RANGE_POS,
} from "./message-cascade.js";

export { AERO_CASCADE_INOUT };

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
  // Prefer AERO first in each lane
  const aeroFirst = (a, b) => Number(b.aeroMain) - Number(a.aeroMain)
    || (a.rangePos ?? 1) - (b.rangePos ?? 1)
    || a.symbol.localeCompare(b.symbol);
  enter.sort(aeroFirst);
  exit.sort(aeroFirst);
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
 * Full plan: ingest RH → seats → cascade hops → trail → optional flow book.
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
  // Ensure AERO seat exists even if RH miss — mark from catalog if any
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
  const cascade = planMessageCascade({
    tokens: seats,
    hopTimestamps,
    message,
    maxHops: maxHops != null ? maxHops : Math.max(8, seats.length),
  });
  // Annotate AERO hops as main in/out
  for (const hop of cascade.hops || []) {
    if (normSym(hop.symbol) === "AERO") {
      hop.aeroMain = true;
      hop.action = hop.sellArm?.armed
        ? "cascade-aero-out"
        : hop.waitingUp || hop.cheap
          ? "cascade-aero-in"
          : "cascade-aero-hop";
    }
  }

  const trail = buildCascadeTrailLine({ seats, outcomes, at, src: "robinhood" });
  return {
    id: RH_CASCADE_RAIL_ID,
    magic: RH_CASCADE_MAGIC,
    label: RH_CASCADE_LABEL,
    dataSource: "robinhood",
    rail: "base",
    unlock,
    hubs: {
      home: HOME_CASCADE_PIGGY_HOLDER,
      aero: AERO_CASCADE_INOUT,
    },
    seatCount: seats.length,
    seats,
    outcomes,
    cascade,
    trail,
    flowFiled,
    neverInventHashes: true,
    neverSellRedToInject: true,
    neverSellHome: true,
  };
}

export function fileRhCascadeLearn(plan, { at = new Date().toISOString(), operatorText = "" } = {}) {
  const learn = readJson(LEARN_PATH, { id: "rh-cascade-rail-learn-v1", filingLabel: RH_CASCADE_LABEL, notes: [] });
  learn.notes.push({
    at,
    topic: "rh-cascade-rail",
    text: operatorText
      || `RH→Base cascade: ${plan.seatCount} seats · enter ${plan.outcomes.enter.map((r) => r.symbol).join(",") || "-"} · exit ${plan.outcomes.exit.map((r) => r.symbol).join(",") || "-"} · trail ${plan.trail.commit8} loc empty until seal. AERO main in/out. HOME never-sell. HOLD unlock=${plan.unlock?.ok === true}.`,
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
    dataSource: "robinhood",
    rail: "base",
    hubs: ["HOME", "AERO"],
    lastCommit8: plan.trail?.commit8 || null,
    learn:
      "Robinhood quotes auto-populate wave envelopes. Base rail cascades in/out. " +
      "AERO is main in/out; HOME is piggy never-sell. §CASCTRAIL§ loc empty until real Base hash. " +
      "Never invent hashes. Never sell red to place code.",
  });
  return { ok: true };
}

export function formatRhCascadeCard(plan) {
  if (!plan) return "RH_CASCADE_RAIL — empty";
  const lines = [
    `⚡ <b>RH → BASE CASCADE</b>`,
    `Data: Robinhood · Rail: Base · seats ${plan.seatCount}`,
    esc(plan.unlock?.status || ""),
    `Hubs: 🏠 HOME piggy · ✈ AERO main in/out`,
    `Ready in: ${plan.outcomes.enter.slice(0, 6).map((r) => r.symbol).join(" ") || "—"}`,
    `Ready out: ${plan.outcomes.exit.slice(0, 6).map((r) => r.symbol).join(" ") || "—"}`,
    `Trail <code>${esc(plan.trail.commit8)}</code> · loc empty until seal`,
    "",
    formatMessageCascadeCard(plan.cascade),
  ];
  return lines.filter(Boolean).join("\n");
}

export function formatRhCascadeOutcomes(plan) {
  if (!plan?.outcomes) return "No outcomes.";
  const lines = ["📡 <b>NEXT CASCADE OUTCOMES</b> (RH wave → Base)"];
  for (const r of plan.outcomes.enter.slice(0, 10)) {
    const mark = r.aeroMain ? " ✈" : "";
    lines.push(
      `↑ IN  <b>${esc(r.symbol)}</b>${mark} ${px(r.price)} pos=${r.rangePos != null ? r.rangePos.toFixed(2) : "?"} ${esc(r.rhLeg || "")}`,
    );
  }
  for (const r of plan.outcomes.exit.slice(0, 10)) {
    const mark = r.aeroMain ? " ✈" : "";
    lines.push(
      `↓ OUT <b>${esc(r.symbol)}</b>${mark} ${px(r.price)} sell@${r.exitAt != null ? px(r.exitAt) : "?"} ${esc(r.rhLeg || "")}`,
    );
  }
  if (!plan.outcomes.enter.length && !plan.outcomes.exit.length) {
    lines.push("No ready in/out yet — waiting for RH HL envelope.");
  }
  lines.push("", `<code>${esc(plan.trail?.line || "")}</code>`);
  return lines.join("\n");
}

export function parseRhCascadeCommand(raw) {
  const src = String(raw || "").trim();
  const low = src.toLowerCase();
  if (low === "/cascade" || low === "/rhcascade" || low === "/cascade rh") {
    return { ok: true, action: "board" };
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
  if (low.startsWith("/cascade ")) {
    return { ok: true, action: "board", arg: src.slice(9).trim() };
  }
  return { ok: false };
}
