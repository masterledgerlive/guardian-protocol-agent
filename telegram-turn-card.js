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

/** Same 1 wei floor as always-plus — do not import the gate (keeps receipts viem-free). */
const MIN_PLUS_ETH = 1e-18;

export const DEFAULT_RECALL_N = 8;
export const MAX_RECALL_N = 20;
export const MAX_TURN_HISTORY = 50;
export const RECALL_SLEEVES = Object.freeze(["AERO", "DRB", "BNKR"]);
export const TURN_RECALL_FILENAME = "turn-recall.json";

export function finiteEth(value) {
  if (value == null || value === "") return null;
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
  // Zero/missing entry is unknown — do not list proceeds as a closed-leg win.
  if (inn == null || out == null || !(inn > 0)) {
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
  hitchSkipped = 0,
  hitchBytes = 0,
  hitchCostEth = null,
  hitchBankedEth = null,
} = {}) {
  const u = usageUnitsFrom({ fills, hitchEvents });
  const skipped = Math.max(0, Math.floor(Number(hitchSkipped) || 0));
  const skipBit = skipped > 0 ? ` · ${skipped} hitch skipped` : "";
  const parts = [
    `usage: ${u.fills} fills · ${u.hitchEvents} hitch${skipBit} · ${u.units} units toward piggy cover`,
  ];
  const bytes = Math.max(0, Number(hitchBytes) || 0);
  const cost = knownPositiveEth(hitchCostEth);
  if (bytes > 0 && cost != null) {
    parts.push(`hitch sent: ${bytes} B · ${formatEthAmt(cost)} ETH`);
  } else if (bytes > 0) {
    parts.push(`hitch sent: ${bytes} B`);
  }
  const banked = knownPositiveEth(hitchBankedEth);
  if (banked != null) {
    parts.push(`hitch banked: ${formatEthAmt(banked)} ETH (next message; not P&L)`);
  }
  return parts.join("\n");
}

export function emptyTurnRecallStore() {
  return {
    turns: [],
    fills: 0,
    hitchEvents: 0,
    hitchSkipped: 0,
    hitchBytes: 0,
    hitchCostEth: 0,
    hitchBankedEth: 0,
    updatedAt: 0,
  };
}

function storedHitchClass(value) {
  const klass = String(value || "");
  return klass === "KEY+LOC" || klass === "§$STORE§" ? klass : "";
}

function sanitizeTurn(raw = {}) {
  const side = String(raw.side || "").toUpperCase() === "SELL" ? "SELL" : "BUY";
  const hitchBytes = Math.max(0, Math.floor(Number(raw.hitchBytes) || 0));
  const hitchOnChain = !!raw.hitchOnChain && hitchBytes > 0;
  const fifoKnown = raw.fifoKnown === true;
  const fifoEthIn = fifoKnown ? finiteEth(raw.fifoEthIn) : null;
  const fifoEthOut = fifoKnown ? finiteEth(raw.fifoEthOut) : null;
  // Persist leftover/usdMark/hitch utf8+kind so a later deserialize→sanitize
  // does not drop leftover vs PLUS, closed-leg USD mark, or hitchClass.
  const leftoverEth = side === "SELL"
    ? finiteEth(raw.leftoverEth ?? raw.leftoverVsPlus?.leftoverEth ?? raw.leftoverVsPlus?.deltaEth)
    : null;
  const usdMark = side === "SELL"
    ? finiteEth(raw.usdMark ?? raw.closedPnl?.usdMark)
    : null;
  const leftover = leftoverVsPlus({
    leftoverEth,
    fifoKnown: fifoKnown && side === "SELL",
  });
  const pnl = closedLegPnl({
    side,
    fifoEthIn,
    fifoEthOut,
    usdMark,
    fifoKnown: fifoKnown && side === "SELL",
  });
  const hitchUtf8 = hitchOnChain ? String(raw.hitchUtf8 || "") : "";
  const hitchKind = hitchOnChain ? String(raw.hitchKind || "") : "";
  let hitchClass = "";
  if (hitchOnChain) {
    hitchClass = hitchClassLabel({ utf8: hitchUtf8, hitchBytes, kind: hitchKind });
    if (!hitchUtf8 && !hitchKind) {
      hitchClass = storedHitchClass(raw.hitchClass) || hitchClass;
    }
  }
  const hitchSkipped = !hitchOnChain && (raw.hitchSkipped === true || raw.verdict === "SKIP_HITCH");
  const hitchBankedEth = hitchSkipped ? knownPositiveEth(raw.hitchBankedEth) : null;
  return {
    side,
    symbol: String(raw.symbol || "?").toUpperCase(),
    txHash: String(raw.txHash || ""),
    shortTx: shortTxHash(raw.txHash),
    fifoKnown,
    fifoEthIn,
    fifoEthOut,
    leftoverEth,
    usdMark,
    hitchOnChain,
    hitchBytes: hitchOnChain ? hitchBytes : 0,
    hitchCostEth: hitchOnChain ? knownPositiveEth(raw.hitchCostEth) : null,
    hitchUtf8,
    hitchKind,
    hitchClass,
    hitchSkipped,
    hitchBankedEth,
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
    hitchSkipped: Math.max(0, Math.floor(Number(s.hitchSkipped) || 0)),
    hitchBytes: Math.max(0, Math.floor(Number(s.hitchBytes) || 0)),
    hitchCostEth: Math.max(0, Number(s.hitchCostEth) || 0),
    hitchBankedEth: Math.max(0, Number(s.hitchBankedEth) || 0),
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
    hitchSkipped: Math.max(0, Math.floor(Number(raw.hitchSkipped) || 0)),
    hitchBytes: Math.max(0, Math.floor(Number(raw.hitchBytes) || 0)),
    hitchCostEth: Math.max(0, Number(raw.hitchCostEth) || 0),
    hitchBankedEth: Math.max(0, Number(raw.hitchBankedEth) || 0),
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
  } else if (turn.hitchSkipped) {
    _store.hitchSkipped = (Number(_store.hitchSkipped) || 0) + 1;
    if (turn.hitchBankedEth != null) {
      _store.hitchBankedEth = (Number(_store.hitchBankedEth) || 0) + turn.hitchBankedEth;
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
  let hitchSkipped = 0;
  let hitchBytes = 0;
  let hitchCostEth = 0;
  let hitchBankedEth = 0;
  let costKnown = false;
  let bankKnown = false;
  for (const t of turns) {
    fills += 1;
    if (t?.hitchOnChain && Number(t.hitchBytes) > 0) {
      hitchEvents += 1;
      hitchBytes += Number(t.hitchBytes) || 0;
      if (t.hitchCostEth != null && Number.isFinite(Number(t.hitchCostEth))) {
        hitchCostEth += Number(t.hitchCostEth);
        costKnown = true;
      }
    } else if (t?.hitchSkipped) {
      hitchSkipped += 1;
      if (t.hitchBankedEth != null && Number.isFinite(Number(t.hitchBankedEth))) {
        hitchBankedEth += Number(t.hitchBankedEth);
        bankKnown = true;
      }
    }
  }
  return {
    fills,
    hitchEvents,
    hitchSkipped,
    hitchBytes,
    hitchCostEth: costKnown ? hitchCostEth : null,
    hitchBankedEth: bankKnown ? hitchBankedEth : null,
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
  // Window hitch cost is only the per-turn hitchCostEth recorded in last N.
  // Never pair window bytes with lifetime store.hitchCostEth (invents cost).
  return {
    n: take,
    turns,
    usage: windowUsage,
    lifetime: life,
    hitchBytes,
    hitchCostEth: windowUsage.hitchCostEth,
    hitchSkipped: windowUsage.hitchSkipped,
    hitchBankedEth: windowUsage.hitchBankedEth,
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
    lines.push(`hitch sent ${t.hitchBytes} B${klass ? ` ${klass}` : ""}${cost}`);
  } else if (side === "SELL" && t.hitchSkipped) {
    const banked = t.hitchBankedEth != null ? formatEthAmt(t.hitchBankedEth) : null;
    lines.push(banked
      ? `hitch skipped · banked ${banked} ETH`
      : `hitch skipped · banked`);
  }
  if (side === "SELL" && t.leftoverVsPlus?.verdict && t.leftoverVsPlus.verdict !== "unknown") {
    const left = formatEthAmt(t.leftoverVsPlus.leftoverEth);
    lines.push(`leftover ${left} ETH vs PLUS · ${t.leftoverVsPlus.verdict}`);
  }
  if (side === "SELL" && t.closedPnl?.known) {
    const d = fmtSignedEth(t.closedPnl.fifoDeltaEth);
    const usd = finiteEth(t.closedPnl.usdMark);
    const usdStr = usd != null ? ` · ${usd >= 0 ? "+" : ""}$${usd.toFixed(2)}` : "";
    lines.push(`micro P&L ${d} ETH${usdStr}`);
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
  if (row.status === "plus") {
    return `${sym}: PLUS (mark covers FIFO ${rem})`;
  }
  const need = formatEthAmt(row.distanceEth);
  return `${sym}: need ${need} ETH to PLUS (FIFO ${rem})`;
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
        ? ` · hitch sent ${t.hitchBytes}B${t.hitchClass ? ` ${t.hitchClass}` : ""}`
        : (side === "SELL" && t.hitchSkipped ? " · hitch skipped" : "");
      const plus = side === "SELL" && t.leftoverVsPlus?.verdict && t.leftoverVsPlus.verdict !== "unknown"
        ? ` · ${t.leftoverVsPlus.verdict}`
        : "";
      const pnl = side === "SELL" && t.closedPnl?.known
        ? ` · micro ${fmtSignedEth(t.closedPnl.fifoDeltaEth)}`
        : "";
      lines.push(`${side} <b>${t.symbol}</b> ${t.shortTx || "—"}${fifo}${hitch}${plus}${pnl}`);
    }
  }
  lines.push(`━━━━━━━━━━━━━━━━━━━━`);
  lines.push(formatUsageRecallLine({
    fills: payload.usage?.fills ?? 0,
    hitchEvents: payload.usage?.hitchEvents ?? 0,
    hitchSkipped: payload.hitchSkipped ?? payload.usage?.hitchSkipped ?? 0,
    hitchBytes: payload.hitchBytes ?? payload.usage?.hitchBytes ?? 0,
    hitchCostEth: payload.hitchCostEth ?? payload.usage?.hitchCostEth,
    hitchBankedEth: payload.hitchBankedEth ?? payload.usage?.hitchBankedEth,
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
