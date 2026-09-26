/**
 * V3 vs V4 race scoreboard — file snapshots only, never invented P&L.
 *
 * Safe cross-process: reads V3 `turn-recall.json` and V4 `guardian-v4/state/race.json`.
 * Does not import `agent.js` or `guardian-v4/agent.js`. Closed-leg revenue is
 * FIFO eth delta (USD mark only when already stored on a real SELL fill).
 *
 * Invokers:
 *   - V4 cycle (`guardian-v4/agent.js`) every N cycles / GUARDIAN_RACE_REPORT_MS
 *   - V3 10-min / hourly "thrift" report via `sendRaceScoreboardIfDue({ send: tg })`
 *   - CLI: `node race-scoreboard.js` (print) or `node race-scoreboard.js --send`
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  deserializeTurnRecallStore,
  finiteEth,
  formatEthAmt,
  TURN_RECALL_FILENAME,
} from "./telegram-turn-card.js";
import { formatRaceEurekaLeadHtml, raceEurekaUtf8 } from "./race-eureka.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const RACE_HEADER = "V3 vs V4 RACE";
export const DEFAULT_RACE_REPORT_MS = 600_000;
export const DEFAULT_RACE_EVERY_CYCLES = 10;
export const V3_TURN_RECALL_PATH = join(__dirname, TURN_RECALL_FILENAME);
export const V4_RACE_STATE_PATH = join(__dirname, "guardian-v4", "state", "race.json");
export const RACE_SENT_PATH = join(__dirname, "guardian-v4", "state", "race-last-sent.json");

export function raceReportMs(env = process.env) {
  const raw = env.GUARDIAN_RACE_REPORT_MS ?? env.GUARDIAN_V4_RACE_REPORT_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_RACE_REPORT_MS;
}

export function raceEveryCycles(env = process.env) {
  const raw = env.GUARDIAN_RACE_EVERY_CYCLES ?? env.GUARDIAN_V4_RACE_EVERY_CYCLES;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_RACE_EVERY_CYCLES;
}

export function emptyV4RaceState() {
  return {
    track: "guardian-v4",
    dryRun: true,
    cycles: 0,
    turns: [],
    hitchPlanned: 0,
    hitchSkipped: 0,
    hitchBankedEth: 0,
    liquidEth: null,
    liquidWeth: null,
    lastRaceSentAt: 0,
    lastRaceSentCycle: 0,
    updatedAt: 0,
  };
}

function finiteOrNull(value) {
  const n = finiteEth(value);
  return n;
}

function readJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(filePath, payload) {
  const dir = dirname(filePath);
  if (dir && dir !== "." && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, JSON.stringify(payload, null, 2));
}

/** Per-symbol closed-leg / hitch totals from real turn records only. */
export function tokenRaceRows(turns = []) {
  const by = new Map();
  for (const raw of turns || []) {
    const symbol = String(raw?.symbol || "?").toUpperCase();
    if (!by.has(symbol)) {
      by.set(symbol, {
        symbol,
        fills: 0,
        closedCount: 0,
        closedDeltaEth: null,
        usdMark: null,
        hitchSent: 0,
        hitchBankedEth: null,
      });
    }
    const row = by.get(symbol);
    row.fills += 1;
    const side = String(raw.side || "").toUpperCase();
    const fifoKnown = raw.fifoKnown === true;
    const pnl = raw.closedPnl && raw.closedPnl.known === true
      ? raw.closedPnl
      : null;
    if (side === "SELL" && fifoKnown && pnl && Number.isFinite(Number(pnl.fifoDeltaEth))) {
      row.closedCount += 1;
      row.closedDeltaEth = (row.closedDeltaEth || 0) + Number(pnl.fifoDeltaEth);
      const usd = finiteOrNull(pnl.usdMark);
      if (usd != null) row.usdMark = (row.usdMark || 0) + usd;
    }
    if (raw.hitchOnChain && Number(raw.hitchBytes) > 0) {
      row.hitchSent += 1;
    } else if (raw.hitchSkipped) {
      const banked = finiteOrNull(raw.hitchBankedEth);
      if (banked != null) row.hitchBankedEth = (row.hitchBankedEth || 0) + banked;
    }
  }
  return [...by.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
}

export function summarizeRaceSide({
  tag = "[V3]",
  available = true,
  dryRun = false,
  cycles = null,
  turns = [],
  liquidEth = null,
  liquidWeth = null,
  hitchPlanned = null,
  hitchBankedEth = null,
} = {}) {
  const rows = tokenRaceRows(turns);
  let closedCount = 0;
  let closedDeltaEth = null;
  let usdMark = null;
  let hitchSent = 0;
  let hitchSkipped = 0;
  let banked = finiteOrNull(hitchBankedEth);
  for (const t of turns || []) {
    const side = String(t?.side || "").toUpperCase();
    const pnl = t?.closedPnl;
    if (side === "SELL" && t?.fifoKnown === true && pnl?.known === true && Number.isFinite(Number(pnl.fifoDeltaEth))) {
      closedCount += 1;
      closedDeltaEth = (closedDeltaEth || 0) + Number(pnl.fifoDeltaEth);
      const usd = finiteOrNull(pnl.usdMark);
      if (usd != null) usdMark = (usdMark || 0) + usd;
    }
    if (t?.hitchOnChain && Number(t.hitchBytes) > 0) hitchSent += 1;
    else if (t?.hitchSkipped) hitchSkipped += 1;
  }
  if (banked == null) {
    let sum = 0;
    let any = false;
    for (const row of rows) {
      if (row.hitchBankedEth != null) {
        sum += row.hitchBankedEth;
        any = true;
      }
    }
    banked = any ? sum : null;
  }
  const planned = hitchPlanned != null ? Math.max(0, Math.floor(Number(hitchPlanned) || 0)) : null;
  let best = null;
  for (const row of rows) {
    if (row.closedDeltaEth == null) continue;
    if (!best || row.closedDeltaEth > best.closedDeltaEth) best = row;
  }
  const last = Array.isArray(turns) && turns.length ? turns[turns.length - 1] : null;
  const liqE = finiteOrNull(liquidEth) ?? finiteOrNull(last?.liquidEth);
  const liqW = finiteOrNull(liquidWeth) ?? finiteOrNull(last?.liquidWeth);
  return {
    tag,
    available: !!available,
    dryRun: !!dryRun,
    cycles: cycles == null ? null : Math.max(0, Math.floor(Number(cycles) || 0)),
    fills: Array.isArray(turns) ? turns.length : 0,
    closedCount,
    closedKnown: closedCount > 0,
    closedDeltaEth,
    usdMark,
    hitchSent,
    hitchSkipped,
    hitchPlanned: planned,
    hitchBankedEth: banked,
    liquidEth: liqE,
    liquidWeth: liqW,
    tokens: rows,
    bestToken: best,
  };
}

export function pickRaceWinner(v3, v4) {
  const a = v3?.closedKnown === true;
  const b = v4?.closedKnown === true;
  if (!a && !b) {
    return { winner: "TIE", line: "TIE / insufficient data" };
  }
  if (a && !b) {
    return { winner: "V3", line: "[V3] ahead on real closed-leg plus (V4 no closed-leg yet)" };
  }
  if (!a && b) {
    return { winner: "V4", line: "[V4] ahead on real closed-leg plus (V3 no closed-leg yet)" };
  }
  const d3 = Number(v3.closedDeltaEth);
  const d4 = Number(v4.closedDeltaEth);
  if (Math.abs(d3 - d4) < 1e-18) {
    return { winner: "TIE", line: "TIE on real closed-leg plus" };
  }
  if (d3 > d4) {
    return { winner: "V3", line: "[V3] ahead on real closed-leg plus" };
  }
  return { winner: "V4", line: "[V4] ahead on real closed-leg plus" };
}

function fmtSigned(value) {
  const n = finiteOrNull(value);
  if (n == null) return null;
  const body = formatEthAmt(n);
  return n > 0 ? `+${body}` : body;
}

function liquidLine(side) {
  if (side.dryRun) return `${side.tag} dry-run yes — liquid unknown (not invented)`;
  const e = formatEthAmt(side.liquidEth);
  const w = formatEthAmt(side.liquidWeth);
  if (e == null && w == null) return `${side.tag} liquid — unknown (not invented)`;
  return `${side.tag} liquid ${e ?? "?"} ETH + ${w ?? "?"} WETH`;
}

function roundsLine(side) {
  if (side.tag === "[V4]") {
    const cyc = side.cycles != null ? `${side.cycles} cycles` : "cycles unknown";
    return `${side.tag} ${cyc} · ${side.closedCount} closed-leg`;
  }
  const rounds = side.cycles != null
    ? `${side.cycles} rounds`
    : `${side.fills} fills`;
  return `${side.tag} ${rounds} · ${side.closedCount} closed-leg`;
}

function revenueLine(side) {
  if (!side.closedKnown) {
    return `${side.tag} closed-leg — unknown (not invented)`;
  }
  const eth = fmtSigned(side.closedDeltaEth);
  const usd = finiteOrNull(side.usdMark);
  const usdStr = usd != null ? ` · ${usd >= 0 ? "+" : ""}$${usd.toFixed(2)}` : "";
  return `${side.tag} closed-leg ${eth} ETH${usdStr}`;
}

function hitchLine(side) {
  const sent = side.dryRun && side.hitchPlanned != null
    ? `hitch planned ${side.hitchPlanned}`
    : `hitch sent ${side.hitchSent}`;
  const banked = side.hitchBankedEth != null
    ? formatEthAmt(side.hitchBankedEth)
    : "0";
  return `${side.tag} ${sent} · banked ${banked} ETH`;
}

function tokenLine(side, row) {
  const rev = row.closedDeltaEth == null
    ? "closed —"
    : `closed ${fmtSigned(row.closedDeltaEth)} ETH`;
  const banked = row.hitchBankedEth != null ? formatEthAmt(row.hitchBankedEth) : "0";
  return `${side.tag} ${row.symbol} ${row.fills} fills · ${rev} · hitch sent ${row.hitchSent} / banked ${banked}`;
}

function bestLine(side) {
  if (!side.bestToken) return `${side.tag} best — none (no closed-leg)`;
  return `${side.tag} best ${side.bestToken.symbol} ${fmtSigned(side.bestToken.closedDeltaEth)} ETH`;
}

function sideUnavailable(tag) {
  return [
    `${tag} unavailable (separate process / no snapshot)`,
    `${tag} closed-leg — unknown (not invented)`,
  ];
}

function formatSideBlock(side) {
  if (!side?.available) return sideUnavailable(side?.tag || "[?]");
  const lines = [
    liquidLine(side),
    roundsLine(side),
    revenueLine(side),
    hitchLine(side),
  ];
  if (!side.tokens.length) {
    lines.push(`${side.tag} no closed-leg tokens yet`);
  } else {
    for (const row of side.tokens) lines.push(tokenLine(side, row));
  }
  lines.push(bestLine(side));
  return lines;
}

/** Telegram HTML — full Eureka love note first, then [V3]/[V4] + winner. */
export function formatRaceScoreboardHtml({ v3, v4, includeEureka = true } = {}) {
  const left = v3 && typeof v3 === "object" ? v3 : summarizeRaceSide({ tag: "[V3]", available: false });
  const right = v4 && typeof v4 === "object" ? v4 : summarizeRaceSide({ tag: "[V4]", available: false });
  const win = pickRaceWinner(left, right);
  const lead = includeEureka !== false ? formatRaceEurekaLeadHtml(raceEurekaUtf8()) : "";
  return [
    `🏁 <b>${RACE_HEADER}</b>`,
    ...(lead ? [lead, `━━━━━━━━━━━━━━━━━━━━`] : []),
    ...formatSideBlock(left),
    `━━━━━━━━━━━━━━━━━━━━`,
    ...formatSideBlock(right),
    `━━━━━━━━━━━━━━━━━━━━`,
    `🏆 winner: ${win.line}`,
  ].join("\n");
}

export function loadV3RaceSide({
  turnRecallPath = V3_TURN_RECALL_PATH,
  liquidEth = null,
  liquidWeth = null,
  cycles = null,
} = {}) {
  if (!existsSync(turnRecallPath)) {
    return summarizeRaceSide({
      tag: "[V3]",
      available: false,
      liquidEth,
      liquidWeth,
      cycles,
    });
  }
  const store = deserializeTurnRecallStore(readJson(turnRecallPath) || {});
  return summarizeRaceSide({
    tag: "[V3]",
    available: true,
    dryRun: false,
    cycles,
    turns: store.turns,
    liquidEth,
    liquidWeth,
    hitchBankedEth: store.hitchBankedEth > 0 ? store.hitchBankedEth : null,
  });
}

export function loadV4RaceSide({
  racePath = V4_RACE_STATE_PATH,
  liquidEth = null,
  liquidWeth = null,
} = {}) {
  const raw = existsSync(racePath) ? readJson(racePath) : null;
  if (!raw || typeof raw !== "object") {
    return summarizeRaceSide({ tag: "[V4]", available: false, dryRun: true });
  }
  return summarizeRaceSide({
    tag: "[V4]",
    available: true,
    dryRun: raw.dryRun !== false,
    cycles: raw.cycles,
    turns: Array.isArray(raw.turns) ? raw.turns : [],
    liquidEth: liquidEth ?? raw.liquidEth,
    liquidWeth: liquidWeth ?? raw.liquidWeth,
    hitchPlanned: raw.hitchPlanned,
    hitchBankedEth: raw.hitchBankedEth > 0 ? raw.hitchBankedEth : null,
  });
}

export function persistV4RaceSnapshot(partial = {}, { racePath = V4_RACE_STATE_PATH } = {}) {
  const prev = existsSync(racePath) && readJson(racePath);
  const next = {
    ...emptyV4RaceState(),
    ...(prev && typeof prev === "object" ? prev : {}),
    ...partial,
    track: "guardian-v4",
    updatedAt: Date.now(),
  };
  if (!Array.isArray(next.turns)) next.turns = [];
  writeJson(racePath, next);
  return next;
}

export function readRaceLastSent({ sentPath = RACE_SENT_PATH } = {}) {
  const raw = existsSync(sentPath) ? readJson(sentPath) : null;
  return {
    at: Number(raw?.at) || 0,
    cycle: Number(raw?.cycle) || 0,
  };
}

export function markRaceReportSent({ now = Date.now(), cycle = 0, sentPath = RACE_SENT_PATH } = {}) {
  writeJson(sentPath, { at: now, cycle: Math.max(0, Math.floor(Number(cycle) || 0)) });
  return { at: now, cycle };
}

export function shouldSendRaceReport({
  now = Date.now(),
  cycles = 0,
  sentPath = RACE_SENT_PATH,
  env = process.env,
  force = false,
} = {}) {
  if (force) return true;
  const last = readRaceLastSent({ sentPath });
  const msDue = now - last.at >= raceReportMs(env);
  const cyc = Math.max(0, Math.floor(Number(cycles) || 0));
  const cycleDue = cyc > 0 && cyc - last.cycle >= raceEveryCycles(env);
  if (last.at <= 0 && last.cycle <= 0) return cyc >= 1 || msDue;
  return msDue || cycleDue;
}

export function buildRaceScoreboard({
  v3,
  v4,
  v3LiquidEth = null,
  v3LiquidWeth = null,
  v3Cycles = null,
  turnRecallPath = V3_TURN_RECALL_PATH,
  racePath = V4_RACE_STATE_PATH,
} = {}) {
  const left = v3 || loadV3RaceSide({ turnRecallPath, liquidEth: v3LiquidEth, liquidWeth: v3LiquidWeth, cycles: v3Cycles });
  const right = v4 || loadV4RaceSide({ racePath });
  const winner = pickRaceWinner(left, right);
  return {
    v3: left,
    v4: right,
    winner: winner.winner,
    winnerLine: winner.line,
    html: formatRaceScoreboardHtml({ v3: left, v4: right }),
  };
}

/**
 * Build + optionally send. Used by V4 loop and V3 10-min/hourly thrift report.
 * `send` should be tg() / sendV4Telegram(..., { prefix: false }).
 */
export async function sendRaceScoreboardIfDue({
  send,
  now = Date.now(),
  cycles = 0,
  force = false,
  v3LiquidEth = null,
  v3LiquidWeth = null,
  v3Cycles = null,
  sentPath = RACE_SENT_PATH,
  turnRecallPath = V3_TURN_RECALL_PATH,
  racePath = V4_RACE_STATE_PATH,
  env = process.env,
} = {}) {
  if (!shouldSendRaceReport({ now, cycles, sentPath, env, force })) {
    return { sent: false, reason: "not-due" };
  }
  const board = buildRaceScoreboard({
    v3LiquidEth,
    v3LiquidWeth,
    v3Cycles,
    turnRecallPath,
    racePath,
  });
  if (typeof send === "function") {
    await send(board.html);
  }
  markRaceReportSent({ now, cycle: cycles, sentPath });
  return { sent: true, html: board.html, winner: board.winner };
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isCli) {
  const board = buildRaceScoreboard();
  console.log(board.html);
}
