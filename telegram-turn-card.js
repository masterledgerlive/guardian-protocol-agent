/**
 * Telegram turn cards + bag recall — real fills only, never invented P&L.
 *
 * Extends the existing buy/sell receipt helpers with a thin card:
 * token, short tx, FIFO eth in/out when known, hitch bytes/cost when
 * present, leftover vs PLUS (sell), liquid ETH+WETH after fill.
 *
 * Cascade/turn P&L is FIFO eth delta on closed legs (USD mark only if
 * already computed). Usage is fills + hitch events ("usage units") —
 * no fake dollar Grok costs.
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync, renameSync } from "node:fs";
import { dirname } from "node:path";
import { detectHitchKind } from "./vita-parse.js";
import { MIN_PLUS_ETH } from "./lose-zero-gate.js";

export const DEFAULT_RECALL_N = 8;
export const MAX_RECALL_N = 20;
export const MAX_TURN_HISTORY = 50;
export const RECALL_SLEEVES = Object.freeze(["AERO", "DRB", "BNKR"]);
export const TURN_RECALL_FILENAME = "turn-recall.json";

export function finiteEth(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function knownPositiveEth(value) {
  const n = finiteEth(value);
  return n != null && n > 0 ? n : null;
}

export function shortTxHash(hash) {
  const raw = String(hash || "").trim();
  if (!raw) return "";
  const h = raw.startsWith("0x") || raw.startsWith("0X") ? raw : `0x${raw}`;
  if (h.length <= 12) return h;
  return `${h.slice(0, 10)}…`;
}

export function formatEthAmt(value) {
  const n = finiteEth(value);
  if (n == null) return null;
  if (n === 0) return "0";
  const a = Math.abs(n);
  if (a >= 0.001) return n.toFixed(6);
  return n.toExponential(2);
}

/** KEY+LOC / §$STORE§ only when hitch bytes or UTF-8 are actually present. */
export function hitchClassLabel({ utf8 = "", hitchBytes = 0, kind = "" } = {}) {
  const bytes = Math.max(0, Number(hitchBytes) || 0);
  const detected = detectHitchKind(utf8);
  const k = String(kind || detected.kind || "").toLowerCase();
  if (bytes <= 0 && !detected.storeTag && detected.kind === "none") return "";
  if (detected.vita || k === "vita" || k === "key-loc" || k.includes("key")) return "KEY+LOC";
  if (detected.eureka || detected.storeTag || String(utf8).includes("§$STORE§") || k === "eureka" || k === "tag") {
    return "§$STORE§";
  }
  if (bytes > 0 && bytes <= 90) return "KEY+LOC";
  if (bytes > 0) return "§$STORE§";
  return "";
}

/**
 * leftover vs PLUS — leftover is FIFO eth delta on a closed sell
 * (out − sold-slice in). PLUS is leftover > 0 (1 wei). Omit when unknown.
 */
export function leftoverVsPlus({ leftoverEth = null, fifoKnown = false } = {}) {
  if (!fifoKnown) {
    return { leftoverEth: null, deltaEth: null, verdict: "unknown" };
  }
  const leftover = finiteEth(leftoverEth);
  if (leftover == null) {
    return { leftoverEth: null, deltaEth: null, verdict: "unknown" };
  }
  return {
    leftoverEth: leftover,
    deltaEth: leftover,
    verdict: leftover > MIN_PLUS_ETH ? "PLUS" : "SHORT",
  };
}

/**
 * Closed-leg P&L from real fills only. Never invents USD or FIFO.
 * `usdMark` is included only when the caller already computed it.
 */
export function closedLegPnl({
  side = "",
  fifoEthIn = null,
  fifoEthOut = null,
  usdMark = null,
  fifoKnown = false,
} = {}) {
  if (String(side || "").toUpperCase() !== "SELL" || !fifoKnown) {
    return { fifoDeltaEth: null, usdMark: null, known: false };
  }
  const inn = finiteEth(fifoEthIn);
  const out = finiteEth(fifoEthOut);
  if (inn == null || out == null) {
    return { fifoDeltaEth: null, usdMark: null, known: false };
  }
  const usd = finiteEth(usdMark);
  return {
    fifoDeltaEth: out - inn,
    usdMark: usd,
    known: true,
  };
}

export function sleeveDistanceToPlus({
  symbol = "?",
  remainingFifoEth = null,
  markProceedsEth = null,
  fifoKnown = false,
} = {}) {
  const sym = String(symbol || "?").toUpperCase();
  if (!fifoKnown) {
    return {
      symbol: sym,
      fifoKnown: false,
      remainingFifoEth: null,
      markProceedsEth: null,
      distanceEth: null,
      status: "fifo-unknown",
    };
  }
  const rem = knownPositiveEth(remainingFifoEth);
  if (rem == null) {
    return {
      symbol: sym,
      fifoKnown: false,
      remainingFifoEth: null,
      markProceedsEth: null,
      distanceEth: null,
      status: "fifo-unknown",
    };
  }
  const mark = knownPositiveEth(markProceedsEth);
  if (mark == null) {
    return {
      symbol: sym,
      fifoKnown: true,
      remainingFifoEth: rem,
      markProceedsEth: null,
      distanceEth: null,
      status: "mark-unknown",
    };
  }
  const distanceEth = rem - mark;
  return {
    symbol: sym,
    fifoKnown: true,
    remainingFifoEth: rem,
    markProceedsEth: mark,
    distanceEth,
    status: mark + MIN_PLUS_ETH > rem ? "plus" : "short",
  };
}

export function usageUnitsFrom({ fills = 0, hitchEvents = 0 } = {}) {
  const f = Math.max(0, Math.floor(Number(fills) || 0));
  const h = Math.max(0, Math.floor(Number(hitchEvents) || 0));
  return { fills: f, hitchEvents: h, units: f + h };
}

export function formatUsageRecallLine({
  fills = 0,
  hitchEvents = 0,
  hitchBytes = 0,
  hitchCostEth = null,
} = {}) {
  const u = usageUnitsFrom({ fills, hitchEvents });
  const parts = [
    `usage: ${u.fills} fills · ${u.hitchEvents} hitch · ${u.units} units toward piggy cover`,
  ];
  const bytes = Math.max(0, Number(hitchBytes) || 0);
  const cost = knownPositiveEth(hitchCostEth);
  if (bytes > 0 && cost != null) {
    parts.push(`hitch spent: ${bytes} B · ${formatEthAmt(cost)} ETH`);
  } else if (bytes > 0) {
    parts.push(`hitch spent: ${bytes} B`);
  }
  return parts.join("\n");
}

export function emptyTurnRecallStore() {
  return {
    turns: [],
    fills: 0,
    hitchEvents: 0,
    hitchBytes: 0,
    hitchCostEth: 0,
    updatedAt: 0,
  };
}

function sanitizeTurn(raw = {}) {
  const side = String(raw.side || "").toUpperCase() === "SELL" ? "SELL" : "BUY";
  const hitchBytes = Math.max(0, Math.floor(Number(raw.hitchBytes) || 0));
  const hitchOnChain = !!raw.hitchOnChain && hitchBytes > 0;
  const fifoKnown = raw.fifoKnown === true;
  const fifoEthIn = fifoKnown ? finiteEth(raw.fifoEthIn) : null;
  const fifoEthOut = fifoKnown ? finiteEth(raw.fifoEthOut) : null;
  const leftover = leftoverVsPlus({
    leftoverEth: side === "SELL" ? finiteEth(raw.leftoverEth) : null,
    fifoKnown: fifoKnown && side === "SELL",
  });
  const pnl = closedLegPnl({
    side,
    fifoEthIn,
    fifoEthOut,
    usdMark: raw.usdMark,
    fifoKnown: fifoKnown && side === "SELL",
  });
  return {
    side,
    symbol: String(raw.symbol || "?").toUpperCase(),
    txHash: String(raw.txHash || ""),
    shortTx: shortTxHash(raw.txHash),
    fifoKnown,
    fifoEthIn,
    fifoEthOut,
    hitchOnChain,
    hitchBytes: hitchOnChain ? hitchBytes : 0,
    hitchCostEth: hitchOnChain ? knownPositiveEth(raw.hitchCostEth) : null,
    hitchClass: hitchOnChain
      ? hitchClassLabel({ utf8: raw.hitchUtf8, hitchBytes, kind: raw.hitchKind })
      : "",
    leftoverVsPlus: leftover,
    closedPnl: pnl,
    liquidEth: finiteEth(raw.liquidEth),
    liquidWeth: finiteEth(raw.liquidWeth),
    at: Number(raw.at) || Date.now(),
  };
}

export function buildTurnRecord(raw = {}) {
  return sanitizeTurn(raw);
}

let _store = emptyTurnRecallStore();

export function getTurnRecallStore() {
  return _store;
}

export function resetTurnRecallStore(next = emptyTurnRecallStore()) {
  _store = next && typeof next === "object" ? { ...emptyTurnRecallStore(), ...next, turns: [...(next.turns || [])] } : emptyTurnRecallStore();
  return _store;
}

export function serializeTurnRecallStore(store = _store) {
  const s = store && typeof store === "object" ? store : emptyTurnRecallStore();
  return {
    turns: Array.isArray(s.turns) ? s.turns.slice(-MAX_TURN_HISTORY) : [],
    fills: Math.max(0, Math.floor(Number(s.fills) || 0)),
    hitchEvents: Math.max(0, Math.floor(Number(s.hitchEvents) || 0)),
    hitchBytes: Math.max(0, Math.floor(Number(s.hitchBytes) || 0)),
    hitchCostEth: Math.max(0, Number(s.hitchCostEth) || 0),
    updatedAt: Number(s.updatedAt) || 0,
  };
}

export function deserializeTurnRecallStore(raw) {
  if (!raw || typeof raw !== "object") return emptyTurnRecallStore();
  const turns = Array.isArray(raw.turns) ? raw.turns.map((t) => sanitizeTurn(t)).filter((t) => t.txHash || t.symbol) : [];
  return {
    turns: turns.slice(-MAX_TURN_HISTORY),
    fills: Math.max(0, Math.floor(Number(raw.fills) || turns.length)),
    hitchEvents: Math.max(0, Math.floor(Number(raw.hitchEvents) || 0)),
    hitchBytes: Math.max(0, Math.floor(Number(raw.hitchBytes) || 0)),
    hitchCostEth: Math.max(0, Number(raw.hitchCostEth) || 0),
    updatedAt: Number(raw.updatedAt) || 0,
  };
}

export function writeTurnRecallSync(filePath, store = _store) {
  const path = String(filePath || TURN_RECALL_FILENAME);
  const dir = dirname(path);
  if (dir && dir !== "." && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  const body = JSON.stringify(serializeTurnRecallStore(store), null, 2);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, body, "utf8");
  renameSync(tmp, path);
  return path;
}

export function readTurnRecallSync(filePath) {
  const path = String(filePath || TURN_RECALL_FILENAME);
  try {
    return deserializeTurnRecallStore(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return emptyTurnRecallStore();
  }
}

export function loadTurnRecallStore(filePath = TURN_RECALL_FILENAME) {
  _store = readTurnRecallSync(filePath);
  return _store;
}

export function recordTurnFill(raw, { persist = true, filePath = TURN_RECALL_FILENAME } = {}) {
  const turn = sanitizeTurn(raw);
  if (!_store || typeof _store !== "object") _store = emptyTurnRecallStore();
  if (!Array.isArray(_store.turns)) _store.turns = [];
  _store.turns.push(turn);
  if (_store.turns.length > MAX_TURN_HISTORY) _store.turns = _store.turns.slice(-MAX_TURN_HISTORY);
  _store.fills = (Number(_store.fills) || 0) + 1;
  if (turn.hitchOnChain) {
    _store.hitchEvents = (Number(_store.hitchEvents) || 0) + 1;
    _store.hitchBytes = (Number(_store.hitchBytes) || 0) + turn.hitchBytes;
    if (turn.hitchCostEth != null) {
      _store.hitchCostEth = (Number(_store.hitchCostEth) || 0) + turn.hitchCostEth;
    }
  }
  _store.updatedAt = turn.at;
  if (persist) {
    try { writeTurnRecallSync(filePath, _store); } catch { /* disk optional */ }
  }
  return turn;
}

export function lastTurns(n = DEFAULT_RECALL_N, store = _store) {
  const take = Math.min(MAX_RECALL_N, Math.max(1, Math.floor(Number(n) || DEFAULT_RECALL_N)));
  const turns = Array.isArray(store?.turns) ? store.turns : [];
  return turns.slice(-take);
}

export function usageFromTurns(turns = []) {
  let fills = 0;
  let hitchEvents = 0;
  let hitchBytes = 0;
  let hitchCostEth = 0;
  let costKnown = false;
  for (const t of turns) {
    fills += 1;
    if (t?.hitchOnChain && Number(t.hitchBytes) > 0) {
      hitchEvents += 1;
      hitchBytes += Number(t.hitchBytes) || 0;
      if (t.hitchCostEth != null && Number.isFinite(Number(t.hitchCostEth))) {
        hitchCostEth += Number(t.hitchCostEth);
        costKnown = true;
      }
    }
  }
  return {
    fills,
    hitchEvents,
    hitchBytes,
    hitchCostEth: costKnown ? hitchCostEth : null,
    ...usageUnitsFrom({ fills, hitchEvents }),
  };
}

export function parseBagOrRecallCommand(raw) {
  const parts = String(raw || "").trim().split(/\s+/);
  const verb = (parts[0] || "").toLowerCase().replace(/@\w+$/, "");
  if (verb !== "/bag" && verb !== "/recall") return null;
  if (parts.length >= 2 && !/^\d+$/.test(parts[1])) return null;
  const n = parts[1] != null
    ? Math.min(MAX_RECALL_N, Math.max(1, parseInt(parts[1], 10)))
    : DEFAULT_RECALL_N;
  return { kind: "bag", n, verb };
}

export function buildRecallPayload({
  store = _store,
  n = DEFAULT_RECALL_N,
  liquidEth = null,
  liquidWeth = null,
  sleeves = [],
} = {}) {
  const take = Math.min(MAX_RECALL_N, Math.max(1, Math.floor(Number(n) || DEFAULT_RECALL_N)));
  const turns = lastTurns(take, store);
  const windowUsage = usageFromTurns(turns);
  const life = usageUnitsFrom({ fills: store?.fills, hitchEvents: store?.hitchEvents });
  const hitchBytes = Math.max(windowUsage.hitchBytes, 0);
  const hitchCost = windowUsage.hitchCostEth != null
    ? windowUsage.hitchCostEth
    : (Number(store?.hitchCostEth) > 0 ? Number(store.hitchCostEth) : null);
  return {
    n: take,
    turns,
    usage: windowUsage,
    lifetime: life,
    hitchBytes,
    hitchCostEth: hitchCost,
    liquidEth: finiteEth(liquidEth),
    liquidWeth: finiteEth(liquidWeth),
    sleeves: Array.isArray(sleeves) ? sleeves : [],
  };
}

function fmtSignedEth(value) {
  const n = finiteEth(value);
  if (n == null) return null;
  const body = formatEthAmt(n);
  if (n > 0) return `+${body}`;
  return body;
}

/** Telegram HTML block appended to existing buy/sell receipts. */
export function formatTurnCardHtml(card = {}) {
  const t = card.side && card.symbol ? card : sanitizeTurn(card);
  const side = t.side === "SELL" ? "SELL" : "BUY";
  const lines = [
    ``,
    `<b>TURN CARD — ${side} ${t.symbol}</b>`,
    t.shortTx ? `tx ${t.shortTx}` : `tx —`,
  ];
  if (side === "BUY" && t.fifoKnown && t.fifoEthIn != null) {
    lines.push(`FIFO in  ${formatEthAmt(t.fifoEthIn)} ETH`);
  } else if (side === "SELL" && t.fifoKnown && t.fifoEthOut != null) {
    lines.push(`FIFO out ${formatEthAmt(t.fifoEthOut)} ETH`);
  } else if (!t.fifoKnown) {
    lines.push(`FIFO — unknown (not invented)`);
  }
  if (t.hitchOnChain && t.hitchBytes > 0) {
    const klass = t.hitchClass || hitchClassLabel({
      utf8: t.hitchUtf8,
      hitchBytes: t.hitchBytes,
      kind: t.hitchKind,
    });
    const cost = t.hitchCostEth != null ? ` · ${formatEthAmt(t.hitchCostEth)} ETH` : "";
    lines.push(`hitch ${t.hitchBytes} B${klass ? ` ${klass}` : ""}${cost}`);
  }
  if (side === "SELL" && t.leftoverVsPlus?.verdict && t.leftoverVsPlus.verdict !== "unknown") {
    const left = formatEthAmt(t.leftoverVsPlus.leftoverEth);
    lines.push(`leftover ${left} ETH vs PLUS · ${t.leftoverVsPlus.verdict}`);
  }
  if (side === "SELL" && t.closedPnl?.known) {
    const d = fmtSignedEth(t.closedPnl.fifoDeltaEth);
    const usd = finiteEth(t.closedPnl.usdMark);
    const usdStr = usd != null ? ` · ${usd >= 0 ? "+" : ""}$${usd.toFixed(2)}` : "";
    lines.push(`closed FIFO Δ ${d} ETH${usdStr}`);
  }
  const liqE = finiteEth(t.liquidEth);
  const liqW = finiteEth(t.liquidWeth);
  if (liqE != null || liqW != null) {
    const e = liqE != null ? formatEthAmt(liqE) : "?";
    const w = liqW != null ? formatEthAmt(liqW) : "?";
    const tot = liqE != null && liqW != null ? formatEthAmt(liqE + liqW) : null;
    lines.push(`liquid ${e} ETH + ${w} WETH${tot ? ` ≈ ${tot}` : ""}`);
  }
  return lines.join("\n");
}

function formatSleeveLine(row) {
  const sym = row?.symbol || "?";
  if (!row?.fifoKnown || row.status === "fifo-unknown") {
    return `${sym}: FIFO unknown`;
  }
  const rem = formatEthAmt(row.remainingFifoEth);
  if (row.status === "mark-unknown") {
    return `${sym}: FIFO ${rem} ETH · mark unknown`;
  }
  const dist = fmtSignedEth(row.distanceEth);
  const tag = row.status === "plus" ? "PLUS" : "to PLUS";
  return `${sym}: ${dist} ETH ${tag} (FIFO ${rem})`;
}

/** Telegram HTML for `/bag` / `/recall` (no topic). */
export function formatRecallHtml(payload = {}) {
  const n = Math.max(1, Number(payload.n) || DEFAULT_RECALL_N);
  const turns = Array.isArray(payload.turns) ? payload.turns : [];
  const lines = [
    `🎒 <b>BAG RECALL — last ${turns.length || n}</b>`,
    `━━━━━━━━━━━━━━━━━━━━`,
  ];
  if (turns.length === 0) {
    lines.push(`No real fills yet — nothing invented.`);
  } else {
    for (const t of turns) {
      const side = t.side === "SELL" ? "SELL" : "BUY";
      const fifo = t.fifoKnown
        ? (side === "BUY"
          ? (t.fifoEthIn != null ? ` in ${formatEthAmt(t.fifoEthIn)}` : "")
          : (t.fifoEthOut != null ? ` out ${formatEthAmt(t.fifoEthOut)}` : ""))
        : " FIFO?";
      const hitch = t.hitchOnChain && t.hitchBytes > 0
        ? ` · ${t.hitchBytes}B${t.hitchClass ? ` ${t.hitchClass}` : ""}`
        : "";
      const plus = side === "SELL" && t.leftoverVsPlus?.verdict && t.leftoverVsPlus.verdict !== "unknown"
        ? ` · ${t.leftoverVsPlus.verdict}`
        : "";
      const pnl = side === "SELL" && t.closedPnl?.known
        ? ` · Δ ${fmtSignedEth(t.closedPnl.fifoDeltaEth)}`
        : "";
      lines.push(`${side} <b>${t.symbol}</b> ${t.shortTx || "—"}${fifo}${hitch}${plus}${pnl}`);
    }
  }
  lines.push(`━━━━━━━━━━━━━━━━━━━━`);
  lines.push(formatUsageRecallLine({
    fills: payload.usage?.fills ?? 0,
    hitchEvents: payload.usage?.hitchEvents ?? 0,
    hitchBytes: payload.hitchBytes ?? payload.usage?.hitchBytes ?? 0,
    hitchCostEth: payload.hitchCostEth ?? payload.usage?.hitchCostEth,
  }));
  const liqE = finiteEth(payload.liquidEth);
  const liqW = finiteEth(payload.liquidWeth);
  if (liqE != null || liqW != null) {
    const e = liqE != null ? formatEthAmt(liqE) : "?";
    const w = liqW != null ? formatEthAmt(liqW) : "?";
    const tot = liqE != null && liqW != null ? formatEthAmt(liqE + liqW) : null;
    lines.push(`liquid ${e} ETH + ${w} WETH${tot ? ` ≈ ${tot}` : ""}`);
  }
  const sleeves = Array.isArray(payload.sleeves) ? payload.sleeves : [];
  if (sleeves.length) {
    lines.push(``);
    lines.push(`<b>OPEN SLEEVES — distance to PLUS</b>`);
    for (const row of sleeves) lines.push(formatSleeveLine(row));
  }
  return lines.join("\n");
}
