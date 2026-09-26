/**
 * Durable wave high/low ledger + short machine ride-along.
 *
 * Every confirmed high and low is logged (the live wave window of 8 is not
 * the memory). Telegram reads stage, arrow, confidence, predicted bottom
 * and exit high, and a 10–30% dividend that leaves the rest of the bag.
 *
 * The chain copy is one short machine line (§WHL§v1) stamped with the three
 * times utc|local|unix. It rides on a covered leftover sell after KEY+LOC.
 * It never solo-sends and never invents a tx hash. Until a real sell tx
 * returns, loc stays empty and the line stays local memory.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { applyPiggyToSell } from "../piggy-bank.js";
import { stampTripleTime } from "../modules/phosphor/blocks.js";

export const WAVE_HL_LEDGER_ID = "wave-hl-ledger-v1";
export const WAVE_HL_MAGIC = "§WHL§v1";
export const WAVE_HL_LABEL = "WAVE_HL";
export const WAVE_HL_FILE = "vita/memory/wave-hl-ledger.json";
export const WAVE_HL_RUNTIME_FILE = "wave-hl-ledger.runtime.json";
export const SWING_MIN_MOVE = 0.004;
export const MAX_PRINTS = 96;
export const MAX_RIDES = 32;
export const DIVIDEND_FLOOR = 0.1;
export const DIVIDEND_CAP = 0.3;
export const WAVE_HL_MAX_BYTES = 360;

const TX_RE = /^0x[0-9a-fA-F]{64}$/;

function num(v, d = NaN) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function normSym(s) {
  return String(s || "").trim().toUpperCase();
}

function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function latest(arr) {
  if (!arr?.length) return null;
  return arr.reduce((a, b) => (a.t > b.t ? a : b));
}

export function fmtWavePx(n) {
  const x = num(n);
  if (!(x > 0)) return "";
  if (x >= 1) {
    const r = Math.round(x * 1e6) / 1e6;
    return String(r);
  }
  const p = Number(x.toPrecision(6));
  return String(p);
}

export function fmtWavePxDisplay(n) {
  const x = num(n);
  if (!(x > 0)) return "?";
  if (x >= 100) return "$" + x.toFixed(2);
  if (x >= 1) return "$" + x.toFixed(4);
  return "$" + x.toFixed(8);
}

function emptySlot() {
  return {
    highs: [],
    lows: [],
    ath: null,
    atl: null,
    highCount: 0,
    lowCount: 0,
    rides: [],
  };
}

function copyPrint(x) {
  const p = num(x?.p ?? x?.price);
  const t = num(x?.t ?? x?.at, 0);
  if (!(p > 0)) return null;
  return { p, t, src: String(x?.src || x?.source || "live") };
}

export function createWaveHlLedger(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const tokensIn = src.tokens && typeof src.tokens === "object" ? src.tokens : {};
  const tokens = {};
  for (const [k, v] of Object.entries(tokensIn)) {
    const sym = normSym(k);
    if (!sym || !v || typeof v !== "object") continue;
    const slot = emptySlot();
    slot.highs = (Array.isArray(v.highs) ? v.highs : []).map(copyPrint).filter(Boolean);
    slot.lows = (Array.isArray(v.lows) ? v.lows : []).map(copyPrint).filter(Boolean);
    slot.highs.sort((a, b) => a.t - b.t);
    slot.lows.sort((a, b) => a.t - b.t);
    const ath = num(v.ath);
    const atl = num(v.atl);
    const highPrices = slot.highs.map((h) => h.p);
    const lowPrices = slot.lows.map((h) => h.p);
    slot.ath = [ath, ...highPrices].filter((n) => n > 0).reduce((a, b) => Math.max(a, b), 0) || null;
    const lowCands = [atl, ...lowPrices].filter((n) => n > 0);
    slot.atl = lowCands.length ? Math.min(...lowCands) : null;
    slot.highCount = Math.max(num(v.highCount, 0), slot.highs.length);
    slot.lowCount = Math.max(num(v.lowCount, 0), slot.lows.length);
    slot.rides = (Array.isArray(v.rides) ? v.rides : [])
      .map((r) => {
        if (!r?.machine) return null;
        const tx = TX_RE.test(String(r.txHash || "")) ? String(r.txHash) : null;
        return {
          machine: String(r.machine),
          utc: r.utc || null,
          local: r.local || null,
          unix: num(r.unix, null),
          prev: r.prev || null,
          txHash: tx,
          at: num(r.at, r.unix),
        };
      })
      .filter(Boolean)
      .slice(-MAX_RIDES);
    tokens[sym] = slot;
  }
  return {
    id: WAVE_HL_LEDGER_ID,
    updatedAt: src.updatedAt || null,
    tokens,
  };
}

function ensureSlot(ledger, symbol) {
  const sym = normSym(symbol);
  if (!ledger.tokens[sym]) ledger.tokens[sym] = emptySlot();
  return ledger.tokens[sym];
}

function touchExtreme(slot, side, price) {
  if (side === "high") {
    if (slot.ath == null || price > slot.ath) slot.ath = price;
  } else if (slot.atl == null || price < slot.atl) {
    slot.atl = price;
  }
}

/**
 * Append one confirmed swing. ATH/ATL are kept even after the series trims.
 * Boot seeds dedupe by price. Live ticks dedupe against the latest same-side
 * print inside SWING_MIN_MOVE, and against the same timestamp.
 */
export function recordWaveExtreme(ledger, {
  symbol,
  side,
  price,
  at,
  source = "live",
  minMove = SWING_MIN_MOVE,
} = {}) {
  const sym = normSym(symbol);
  const px = num(price);
  const sd = side === "high" || side === "H" ? "high" : side === "low" || side === "L" ? "low" : null;
  if (!sym || !sd || !(px > 0)) return { accepted: false, reason: "bad-print" };
  const slot = ensureSlot(ledger, sym);
  const arr = sd === "high" ? slot.highs : slot.lows;
  const when = Number.isFinite(num(at)) ? num(at) : Date.now();
  const src = String(source || "live");
  const fromChain = src === "chain";
  touchExtreme(slot, sd, px);
  const near = (x) => Math.abs(x.p - px) / px < minMove;
  if (src.startsWith("boot") || fromChain) {
    if (arr.some(near)) {
      return { accepted: false, reason: fromChain ? "chain-dupe" : "boot-dupe", symbol: sym, side: sd };
    }
  } else if (arr.some((x) => x.t === when && near(x))) {
    return { accepted: false, reason: "time-dupe", symbol: sym, side: sd };
  } else {
    const last = latest(arr);
    if (last && when >= last.t && Math.abs(px - last.p) / last.p < minMove) {
      return { accepted: false, reason: "inside-min-move", symbol: sym, side: sd };
    }
  }
  arr.push({ p: px, t: when, src });
  arr.sort((a, b) => a.t - b.t);
  if (!fromChain) {
    if (sd === "high") slot.highCount += 1;
    else slot.lowCount += 1;
  }
  while (arr.length > MAX_PRINTS) arr.shift();
  ledger.updatedAt = new Date().toISOString();
  return { accepted: true, symbol: sym, side: sd, price: px, at: when };
}

export function ingestPriceList(ledger, symbol, prices, side, source) {
  let added = 0;
  (prices || []).forEach((p, i) => {
    const rec = recordWaveExtreme(ledger, {
      symbol,
      side,
      price: p,
      at: i + 1,
      source,
    });
    if (rec.accepted) added += 1;
  });
  return added;
}

/** Same 5-tick swing rule as the live wave window. Timestamps keep a re-scan from doubling. */
export function backfillWaveSwings(ledger, symbol, readings, minMove = SWING_MIN_MOVE) {
  const rows = (Array.isArray(readings) ? readings : [])
    .map((r) => ({ price: num(r?.price), time: num(r?.time ?? r?.t, 0) }))
    .filter((r) => r.price > 0);
  let added = 0;
  if (rows.length < 5) return { added: 0 };
  for (let i = 2; i < rows.length - 2; i++) {
    const m = rows[i].price;
    const w = [rows[i - 2], rows[i - 1], rows[i], rows[i + 1], rows[i + 2]];
    const isHigh = m > w[0].price && m > w[1].price && m > w[3].price && m > w[4].price;
    const isLow = m < w[0].price && m < w[1].price && m < w[3].price && m < w[4].price;
    if (!isHigh && !isLow) continue;
    const rec = recordWaveExtreme(ledger, {
      symbol,
      side: isHigh ? "high" : "low",
      price: m,
      at: w[2].time || i,
      source: "history",
      minMove,
    });
    if (rec.accepted) added += 1;
  }
  return { added };
}

function unionPrints(a, b) {
  const map = new Map();
  for (const x of [...(a || []), ...(b || [])]) {
    const p = copyPrint(x);
    if (!p) continue;
    const key = `${p.t}|${p.p.toPrecision(8)}`;
    if (!map.has(key)) map.set(key, p);
  }
  return [...map.values()].sort((x, y) => x.t - y.t);
}

export function mergeWaveHlLedgers(a, b) {
  const left = createWaveHlLedger(a);
  const right = createWaveHlLedger(b);
  const symbols = new Set([...Object.keys(left.tokens), ...Object.keys(right.tokens)]);
  const tokens = {};
  for (const sym of symbols) {
    const A = left.tokens[sym] || emptySlot();
    const B = right.tokens[sym] || emptySlot();
    const highsAll = unionPrints(A.highs, B.highs);
    const lowsAll = unionPrints(A.lows, B.lows);
    const highCount = Math.max(A.highCount, B.highCount, highsAll.length);
    const lowCount = Math.max(A.lowCount, B.lowCount, lowsAll.length);
    const athCands = [A.ath, B.ath, ...highsAll.map((h) => h.p)].filter((n) => n > 0);
    const atlCands = [A.atl, B.atl, ...lowsAll.map((h) => h.p)].filter((n) => n > 0);
    const rides = [];
    const seen = new Set();
    for (const r of [...(A.rides || []), ...(B.rides || [])]) {
      if (!r?.machine || seen.has(r.machine)) {
        if (r?.machine && seen.has(r.machine)) {
          const prev = rides.find((x) => x.machine === r.machine);
          if (prev && !prev.txHash && r.txHash) prev.txHash = r.txHash;
        }
        continue;
      }
      seen.add(r.machine);
      rides.push({ ...r });
    }
    tokens[sym] = {
      highs: highsAll.slice(-MAX_PRINTS),
      lows: lowsAll.slice(-MAX_PRINTS),
      ath: athCands.length ? Math.max(...athCands) : null,
      atl: atlCands.length ? Math.min(...atlCands) : null,
      highCount,
      lowCount,
      rides: rides.slice(-MAX_RIDES),
    };
  }
  const updated = [left.updatedAt, right.updatedAt].filter(Boolean).sort().at(-1) || null;
  return { id: WAVE_HL_LEDGER_ID, updatedAt: updated, tokens };
}

function readJsonFile(path) {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function loadWaveHlLedger({
  cwd = process.cwd(),
  positionsBlob = null,
} = {}) {
  const disk = readJsonFile(join(cwd, WAVE_HL_FILE));
  const runtime = readJsonFile(join(cwd, WAVE_HL_RUNTIME_FILE));
  const fromPos = positionsBlob?.waveHlLedger
    ? positionsBlob.waveHlLedger
    : positionsBlob?.tokens
      ? positionsBlob
      : null;
  return mergeWaveHlLedgers(mergeWaveHlLedgers(disk, runtime), fromPos);
}

export function saveWaveHlLedger(ledger, { cwd = process.cwd() } = {}) {
  const body = createWaveHlLedger(ledger);
  body.updatedAt = new Date().toISOString();
  const text = JSON.stringify(body, null, 2);
  const targets = [join(cwd, WAVE_HL_FILE), join(cwd, WAVE_HL_RUNTIME_FILE)];
  for (const path of targets) {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = path + ".tmp";
    writeFileSync(tmp, text, "utf8");
    renameSync(tmp, path);
  }
  ledger.updatedAt = body.updatedAt;
  return body;
}

export function recentExtreme(ledger, symbol, side, { keep = 8, skipLast = false } = {}) {
  const slot = createWaveHlLedger(ledger).tokens[normSym(symbol)];
  if (!slot) return null;
  let arr = (side === "high" ? slot.highs : slot.lows).map((h) => h.p).filter((p) => p > 0);
  if (skipLast && arr.length > 1) arr = arr.slice(0, -1);
  arr = arr.slice(-Math.max(1, keep));
  if (!arr.length) return null;
  return side === "high" ? Math.max(...arr) : Math.min(...arr);
}

export function rehydrateWaveWindow(ledger, initSlot, keep = 8) {
  const book = createWaveHlLedger(ledger);
  const k = Math.max(1, keep | 0);
  for (const symbol of Object.keys(book.tokens)) {
    const slot = book.tokens[symbol];
    const ws = typeof initSlot === "function" ? initSlot(symbol) : null;
    if (!ws) continue;
    const highs = slot.highs.map((h) => h.p).filter((p) => p > 0).slice(-k);
    const lows = slot.lows.map((h) => h.p).filter((p) => p > 0).slice(-k);
    if (!Array.isArray(ws.peaks)) ws.peaks = [];
    if (!Array.isArray(ws.troughs)) ws.troughs = [];
    if (highs.length > ws.peaks.length) ws.peaks = highs.slice();
    if (lows.length > ws.troughs.length) ws.troughs = lows.slice();
  }
  return book;
}

function swingAmp(highs, lows) {
  const n = Math.min(highs.length, lows.length, 6);
  const amps = [];
  for (let i = 0; i < n; i++) {
    const hi = highs[highs.length - 1 - i];
    const lo = lows[lows.length - 1 - i];
    if (hi > lo && lo > 0) {
      const a = (hi - lo) / lo;
      if (a > 0 && a < 5) amps.push(a);
    }
  }
  if (!amps.length) return 0.05;
  return amps.reduce((s, a) => s + a, 0) / amps.length;
}

function directionOf(slot, price) {
  const h = latest(slot.highs);
  const l = latest(slot.lows);
  if (!h && !l) return { arrow: "·", machineArrow: ".", goingDown: false };
  if (h && (!l || h.t >= l.t)) {
    if (price > h.p * 1.002) return { arrow: "↑", machineArrow: "U", goingDown: false };
    return { arrow: "↓", machineArrow: "D", goingDown: true };
  }
  if (l && price < l.p * 0.998) return { arrow: "↓", machineArrow: "D", goingDown: true };
  return { arrow: "↑", machineArrow: "U", goingDown: false };
}

/**
 * Stage, arrow, confidence, predicted bottom/high, and the exit rule.
 * Exit is a 10–30% dividend. The rest of the bag stays.
 * Hard target made → 30%. Failed higher-high or a lower base → scaled slice.
 * Below entry, or unknown cost, withholds the sell.
 */
export function assessWaveToken(ledger, {
  symbol,
  price,
  entryPrice = null,
} = {}) {
  const book = createWaveHlLedger(ledger);
  const sym = normSym(symbol);
  const slot = book.tokens[sym] || emptySlot();
  const px = num(price, 0);
  const highs = slot.highs.map((h) => h.p);
  const lows = slot.lows.map((h) => h.p);
  const ready = highs.length >= 1 && lows.length >= 1 && px > 0;
  const exitArmed = highs.length >= 2 && lows.length >= 2 && px > 0;
  const dir = px > 0 ? directionOf(slot, px) : { arrow: "·", machineArrow: ".", goingDown: false };
  const recentHigh = highs.length ? Math.max(...highs.slice(-4)) : null;
  const recentLow = lows.length ? Math.min(...lows.slice(-4)) : null;
  const range = ready && recentHigh > recentLow ? recentHigh - recentLow : 0;
  const rangePos = range > 0 ? clamp((px - recentLow) / range, 0, 1) : null;
  const lastHigh = highs.at(-1) ?? null;
  const prevHigh = highs.at(-2) ?? null;
  const lastLow = lows.at(-1) ?? null;
  const prevLow = lows.at(-2) ?? null;
  const higherHigh = lastHigh != null && prevHigh != null ? lastHigh > prevHigh : null;
  const lowerHigh = lastHigh != null && prevHigh != null ? lastHigh < prevHigh : null;
  const higherLow = lastLow != null && prevLow != null ? lastLow > prevLow : null;
  const lowerLow = lastLow != null && prevLow != null ? lastLow < prevLow : null;
  const amp = swingAmp(highs, lows);
  const exitTarget = lastLow > 0 ? lastLow * (1 + amp) : null;
  const predictedLow = lastHigh > 0 ? lastHigh / (1 + amp) : px > 0 ? px * (1 - amp) : null;
  const predictedHigh = exitTarget;

  let stage = "LOGGING";
  if (ready && rangePos != null) {
    if (rangePos <= 0.2 && dir.arrow === "↑") stage = "TROUGH";
    else if (rangePos <= 0.2) stage = "BASE";
    else if (rangePos >= 0.8) stage = "PEAK";
    else if (dir.arrow === "↑" && rangePos < 0.45) stage = "BASE";
    else if (dir.arrow === "↑") stage = "RISING";
    else if (dir.arrow === "↓" && rangePos > 0.45) stage = "FALLING";
    else stage = "BASE";
  }

  let confidence = 28;
  const pairs = Math.min(highs.length, lows.length);
  if (pairs >= 2) confidence += 12;
  if (pairs >= 4) confidence += 10;
  if (pairs >= 8) confidence += 8;
  if (dir.arrow === "↑" && higherHigh && higherLow) confidence += 18;
  else if (dir.arrow === "↓" && lowerHigh && lowerLow) confidence += 18;
  else if (higherHigh === false && higherLow === false) confidence -= 8;
  if (stage === "TROUGH" || stage === "PEAK") confidence += 8;
  if (slot.highCount + slot.lowCount >= 12) confidence += 6;
  confidence = Math.round(clamp(confidence, 8, 92));

  let exitMode = "HOLD";
  let exitReason = "structure still intact — leave the bag";
  if (!exitArmed) {
    exitMode = "HOLD";
    exitReason = "logging swings — need 2 highs and 2 lows before an exit";
  } else if (exitTarget && px >= exitTarget * 0.995) {
    exitMode = "HARD_TARGET";
    exitReason = "exit target made — take the dividend, leave the rest";
  } else if (lowerLow || (lowerHigh && dir.goingDown)) {
    exitMode = "STRUCTURE";
    exitReason = lowerLow
      ? "lower base — not holding a broken trough"
      : "not making a new higher target";
  }

  const entry = num(entryPrice);
  const inProfit = entry > 0 && px > 0 ? px > entry * 1.002 : null;
  if ((exitMode === "HARD_TARGET" || exitMode === "STRUCTURE") && inProfit === false) {
    exitMode = "HOLD_RED";
    exitReason = "target or structure says exit, price is below entry — dividend withheld";
  } else if ((exitMode === "HARD_TARGET" || exitMode === "STRUCTURE") && inProfit == null) {
    exitMode = "HOLD_BASIS";
    exitReason = "cost basis unknown — dividend withheld";
  }

  let dividendPct = 0;
  if (exitMode === "HARD_TARGET") dividendPct = DIVIDEND_CAP;
  else if (exitMode === "STRUCTURE") {
    const peakiness = rangePos == null ? 0.5 : rangePos;
    const raw = DIVIDEND_FLOOR + (DIVIDEND_CAP - DIVIDEND_FLOOR) * (0.6 * peakiness + 0.4 * (confidence / 100));
    dividendPct = Math.round(clamp(raw, DIVIDEND_FLOOR, DIVIDEND_CAP) * 100) / 100;
  }
  const leavePct = dividendPct > 0 ? Math.round((1 - dividendPct) * 100) / 100 : 1;

  const buyZone = exitMode === "HOLD"
    && dir.arrow === "↑"
    && (stage === "TROUGH" || stage === "BASE")
    && confidence >= 55
    && lowerLow !== true;

  let cascadeScore = 0;
  if (ready && px > 0 && dir.arrow === "↑" && exitMode === "HOLD") {
    if (stage === "TROUGH" || stage === "BASE" || (stage === "RISING" && (rangePos ?? 1) <= 0.45)) {
      cascadeScore = Math.round(confidence * (1.2 - (rangePos ?? 0.5)));
    }
  }

  return {
    symbol: sym,
    stage,
    arrow: dir.arrow,
    machineArrow: dir.machineArrow,
    confidence,
    price: px > 0 ? px : null,
    predictedLow,
    predictedHigh,
    exitTarget,
    exitMode,
    exitReason,
    dividendPct,
    leavePct,
    inProfit,
    higherHigh,
    higherLow,
    lowerHigh,
    lowerLow,
    buyZone,
    cascadeScore,
    rangePos,
    ready,
    highs: highs.slice(-4),
    lows: lows.slice(-4),
    ath: slot.ath,
    atl: slot.atl,
    highCount: slot.highCount,
    lowCount: slot.lowCount,
    storedHighs: slot.highs.length,
    storedLows: slot.lows.length,
  };
}

export function pickCascadeToken(rows, { excludeSymbol = null } = {}) {
  const ex = normSym(excludeSymbol);
  const ranked = (rows || [])
    .filter((r) => r?.symbol && r.symbol !== ex && r.cascadeScore > 0)
    .sort((a, b) => b.cascadeScore - a.cascadeScore || a.symbol.localeCompare(b.symbol));
  return ranked[0] || null;
}

export function planDividendWithdraw({
  balance,
  priceUsd,
  dividendPct,
  piggyReserve = 0,
  symbol,
  savedEarningsUsd = 0,
  token,
  env = process.env,
} = {}) {
  const bal = Math.max(0, num(balance, 0));
  const px = num(priceUsd, 0);
  const pct = num(dividendPct, 0);
  if (!(pct > 0) || !(px > 0) || !(bal > 0)) {
    return {
      tokensToSell: 0,
      withdrawUsd: 0,
      leaveTokens: bal,
      leaveUsd: bal > 0 && px > 0 ? bal * px : 0,
      blocked: true,
      sellPct: 0,
    };
  }
  const applied = applyPiggyToSell({
    balance: bal,
    sellPct: pct,
    priceUsd: px,
    piggyReserve,
    symbol,
    savedEarningsUsd,
    token: token || { symbol, piggyBankPct: token?.piggyBankPct, piggyBankMinUsd: token?.piggyBankMinUsd },
    env,
    reason: "WAVE DIVIDEND",
  });
  return {
    tokensToSell: applied.tokensToSell,
    withdrawUsd: applied.tokensToSell * px,
    leaveTokens: applied.remainingBalance,
    leaveUsd: applied.remainingBalance * px,
    blocked: applied.blocked,
    sellPct: pct,
  };
}

function content8(line) {
  return createHash("sha256").update(String(line || ""), "utf8").digest("hex").slice(0, 8);
}

/** Prior ride's content tag for prev=. Not a transaction hash. */
export function ridePrevTag(ride) {
  if (!ride?.machine) return "00000000";
  return content8(ride.machine);
}

function shrinkPrices(prices, n) {
  return (prices || []).slice(-n).map(fmtWavePx).filter(Boolean);
}

/**
 * One short machine line. Triple time is utc|local|unix.
 * prev is the prior line's content hash, never a made-up tx.
 * loc is a real 0x hash or "-".
 */
export function buildWaveHlMachine(row, {
  at = Date.now(),
  prev = "00000000",
  loc = "-",
  from = "-",
  next = "END",
  cascadeSymbol = null,
} = {}) {
  const stamp = stampTripleTime(at);
  const sym = normSym(row?.symbol) || "NA";
  const locField = TX_RE.test(String(loc || "")) ? String(loc) : "-";
  const fromField = TX_RE.test(String(from || "")) ? String(from) : "-";
  const prevField = String(prev || "00000000").replace(/^0x/i, "").toLowerCase().slice(0, 8).padEnd(8, "0");
  const k = normSym(cascadeSymbol) || "-";
  let highN = 4;
  let lowN = 4;
  let line = "";
  do {
    const highs = shrinkPrices(row?.highs, highN).join(",") || "-";
    const lows = shrinkPrices(row?.lows, lowN).join(",") || "-";
    line = [
      WAVE_HL_MAGIC,
      `utc=${stamp.utc}`,
      `local=${stamp.local}`,
      `unix=${stamp.unix}`,
      sym,
      `H=${highs}`,
      `L=${lows}`,
      `S=${row?.stage || "LOGGING"}`,
      `A=${row?.machineArrow || "."}`,
      `C=${Math.round(num(row?.confidence, 0))}`,
      `X=${fmtWavePx(row?.exitTarget) || "-"}`,
      `B=${fmtWavePx(row?.predictedLow) || "-"}`,
      `D=${Math.round(num(row?.dividendPct, 0) * 100)}`,
      `K=${k}`,
      `N=${Math.max(0, num(row?.highCount, 0))}/${Math.max(0, num(row?.lowCount, 0))}`,
      `prev=${prevField}`,
      `from=${fromField}`,
      `loc=${locField}`,
      `next=${next === "END" ? "END" : String(next)}`,
    ].join("|");
    if (Buffer.byteLength(line, "utf8") <= WAVE_HL_MAX_BYTES) break;
    if (highN > 1) highN -= 1;
    else if (lowN > 1) lowN -= 1;
    else break;
  } while (highN >= 1);
  return {
    line,
    bytes: Buffer.byteLength(line, "utf8"),
    stamp,
    prev: prevField,
    content8: content8(line),
    txHash: null,
  };
}

export function lastWaveHlRide(ledger, symbol) {
  const slot = createWaveHlLedger(ledger).tokens[normSym(symbol)];
  if (!slot?.rides?.length) return null;
  return slot.rides[slot.rides.length - 1];
}

export function bankWaveHlRide(ledger, built, { symbol } = {}) {
  if (!built?.line) return null;
  const slot = ensureSlot(ledger, symbol || built.line.split("|")[4]);
  const existing = slot.rides.find((r) => r.machine === built.line);
  if (existing) return existing;
  const row = {
    machine: built.line,
    utc: built.stamp?.utc || null,
    local: built.stamp?.local || null,
    unix: built.stamp?.unix ?? null,
    prev: built.prev || null,
    txHash: null,
    at: built.stamp?.unix ?? Date.now(),
  };
  slot.rides.push(row);
  while (slot.rides.length > MAX_RIDES) slot.rides.shift();
  ledger.updatedAt = new Date().toISOString();
  return row;
}

export function commitWaveHlRideHash(ledger, { symbol, machine, txHash }) {
  if (!TX_RE.test(String(txHash || ""))) return false;
  const slot = ledger?.tokens?.[normSym(symbol)];
  if (!slot) return false;
  const ride = [...slot.rides].reverse().find((r) => r.machine === machine && !r.txHash);
  if (!ride) return false;
  ride.txHash = String(txHash);
  ledger.updatedAt = new Date().toISOString();
  return true;
}

/**
 * Ride on a paired plus sell only when leftover still covers this short line.
 * send stays false — never a solo injection. Uncovered lines stay banked.
 */
export function planWaveHlRide({
  leftoverEth,
  hitchCostEth,
  pairedPlus = true,
  machine,
} = {}) {
  if (!machine) {
    return { hitch: false, banked: true, send: false, txHash: null, reason: "no WHL machine line" };
  }
  if (!pairedPlus) {
    return { hitch: false, banked: true, send: false, txHash: null, utf8: machine, reason: "not a plus paired sell — bank the WHL line" };
  }
  const left = num(leftoverEth, 0);
  const cost = num(hitchCostEth, 0);
  if (!(left > 0) || !(cost > 0) || left + 1e-18 < cost) {
    return {
      hitch: false,
      banked: true,
      send: false,
      txHash: null,
      utf8: machine,
      reason: "leftover does not cover the short WHL ride — bank locally",
    };
  }
  return {
    hitch: true,
    banked: false,
    send: false,
    txHash: null,
    utf8: machine,
    reason: "short WHL ride-along on covered leftover (utc|local|unix)",
  };
}

export function parseWaveHlMachine(text) {
  const raw = String(text || "").trim();
  const start = raw.indexOf(WAVE_HL_MAGIC);
  if (start < 0) return null;
  const line = raw.slice(start).split(/\s/)[0];
  const parts = line.split("|");
  if (parts[0] !== WAVE_HL_MAGIC) return null;
  const fields = {};
  for (const part of parts.slice(1)) {
    const i = part.indexOf("=");
    if (i <= 0) continue;
    fields[part.slice(0, i)] = part.slice(i + 1);
  }
  const sym = parts.find((p) => /^[A-Z0-9_]{1,16}$/.test(p) && !p.includes("=")) || null;
  const nums = (s) => String(s || "").split(",").map(Number).filter((n) => n > 0);
  const nParts = String(fields.N || "0/0").split("/");
  const loc = fields.loc && TX_RE.test(fields.loc) ? fields.loc : null;
  return {
    line,
    symbol: sym,
    utc: fields.utc || null,
    local: fields.local || null,
    unix: fields.unix != null ? Number(fields.unix) : null,
    highs: nums(fields.H),
    lows: nums(fields.L),
    stage: fields.S || null,
    machineArrow: fields.A || null,
    arrow: fields.A === "U" ? "↑" : fields.A === "D" ? "↓" : "·",
    confidence: num(fields.C, null),
    exitTarget: num(fields.X, null),
    predictedLow: num(fields.B, null),
    dividendPct: num(fields.D, 0) / 100,
    cascadeSymbol: fields.K && fields.K !== "-" ? fields.K : null,
    highCount: num(nParts[0], 0),
    lowCount: num(nParts[1], 0),
    prev: fields.prev || null,
    from: fields.from && TX_RE.test(fields.from) ? fields.from : null,
    loc,
    next: fields.next || null,
  };
}

export function extractWaveHlMachines(utf8) {
  const text = String(utf8 || "");
  const out = [];
  let from = 0;
  while (from < text.length) {
    const at = text.indexOf(WAVE_HL_MAGIC, from);
    if (at < 0) break;
    const parsed = parseWaveHlMachine(text.slice(at));
    if (parsed) out.push(parsed);
    from = at + WAVE_HL_MAGIC.length;
  }
  return out;
}

export function readWaveHlFromHex(hex) {
  const h = String(hex || "").replace(/^0x/i, "");
  if (!h || h.length % 2) return [];
  try {
    return extractWaveHlMachines(Buffer.from(h, "hex").toString("utf8"));
  } catch {
    return [];
  }
}

export function formatWaveStageSnippet(row) {
  if (!row) return "· logging";
  const exit = row.dividendPct > 0
    ? `EXIT ${(row.dividendPct * 100).toFixed(0)}%`
    : row.exitMode === "HOLD_RED"
      ? "HOLD (below entry)"
      : row.exitMode === "HOLD_BASIS"
        ? "HOLD (no cost basis)"
        : "HOLD";
  const tgt = fmtWavePxDisplay(row.exitTarget);
  return `${row.arrow} ${row.confidence}% ${esc(row.stage)} · ${exit} · target ${tgt} · H${row.highCount}/L${row.lowCount}`;
}

function formatRowBlock(row) {
  const plan = row.plan;
  const lines = [];
  lines.push(`${row.arrow} ${row.confidence}% <b>${esc(row.symbol)}</b> ${esc(row.stage)} · H${row.highCount}/L${row.lowCount}`);
  lines.push(`   bottom ${fmtWavePxDisplay(row.predictedLow)} · high ${fmtWavePxDisplay(row.predictedHigh)} · target ${fmtWavePxDisplay(row.exitTarget)}`);
  if (row.dividendPct > 0 && plan && !plan.blocked) {
    lines.push(`   EXIT ${(row.dividendPct * 100).toFixed(0)}% · withdraw ≈ $${plan.withdrawUsd.toFixed(2)} gross · leave ${(row.leavePct * 100).toFixed(0)}% (≈ $${plan.leaveUsd.toFixed(2)})`);
    lines.push(`   /dividend ${esc(row.symbol)}`);
  } else if (row.dividendPct > 0 && plan?.blocked) {
    lines.push(`   EXIT armed — sellable is dust/seed, slice withheld`);
  } else {
    lines.push(`   ${esc(row.exitReason)}`);
  }
  return lines.join("\n");
}

export function formatWaveBoardTelegram(rows, { cascade = null, now = new Date() } = {}) {
  const lines = [];
  lines.push("🌊 <b>WAVE BOARD</b>");
  lines.push(`🕐 ${esc(now.toLocaleTimeString())}`);
  lines.push("Highs and lows stay logged. Chain copy is a short §WHL§ line with utc|local|unix.");
  if (cascade) {
    lines.push(`Cascade into <b>${esc(cascade.symbol)}</b> ${cascade.arrow} ${cascade.confidence}% ${esc(cascade.stage)}`);
  } else {
    lines.push("Cascade: no rising trough yet — still logging swings.");
  }
  lines.push("");
  const ordered = [...(rows || [])].sort((a, b) => {
    const ae = a.dividendPct > 0 ? 1 : 0;
    const be = b.dividendPct > 0 ? 1 : 0;
    return be - ae || (b.cascadeScore || 0) - (a.cascadeScore || 0) || a.symbol.localeCompare(b.symbol);
  });
  for (const row of ordered) lines.push(formatRowBlock(row), "");
  lines.push("/waveboard SYMBOL · /dividend SYMBOL · /waves");
  return lines.join("\n").trim();
}

export function formatWaveTokenTelegram(row, { ride = null, cascade = null } = {}) {
  if (!row) return "No wave row.";
  const lines = [formatRowBlock(row), ""];
  if (row.buyZone) lines.push("Buy zone: arrow up at the base/trough.", "");
  if (cascade && cascade.symbol !== row.symbol) {
    lines.push(`Cascade seat: <b>${esc(cascade.symbol)}</b> ${cascade.arrow} ${cascade.confidence}%`, "");
  }
  lines.push(`ATH ${fmtWavePxDisplay(row.ath)} · ATL ${fmtWavePxDisplay(row.atl)}`);
  lines.push(`Stored ${row.storedHighs} highs / ${row.storedLows} lows · logged ${row.highCount}/${row.lowCount}`);
  lines.push("");
  lines.push("Machine ride (follows prev=, loc only after a real sell tx):");
  if (ride?.machine) {
    lines.push(`<code>${esc(ride.machine)}</code>`);
  } else {
    const preview = buildWaveHlMachine(row, {
      prev: "00000000",
      loc: "-",
      cascadeSymbol: cascade?.symbol && cascade.symbol !== row.symbol ? cascade.symbol : null,
    });
    lines.push(`<code>${esc(preview.line)}</code>`);
  }
  if (ride?.txHash) {
    lines.push(`<a href="https://basescan.org/tx/${ride.txHash}">Basescan Input Data</a> · unix ${ride.unix ?? "?"}`);
  } else {
    lines.push("loc: no sealed tx yet — line banks locally until leftover covers the ride.");
  }
  return lines.join("\n");
}

export function formatDividendMenu(rows, { cascade = null } = {}) {
  const ready = (rows || []).filter((r) => r.dividendPct > 0 && r.plan && !r.plan.blocked);
  const lines = ["💸 <b>WAVE DIVIDEND</b>", "10–30% of the sellable bag. The rest stays. Piggy dust and the $0.05 seed stay.", ""];
  if (cascade) lines.push(`Next cascade seat: <b>${esc(cascade.symbol)}</b> ${cascade.arrow} ${cascade.confidence}% ${esc(cascade.stage)}`, "");
  if (!ready.length) {
    lines.push("No dividend armed. Targets are not made, or the slice would sell red.");
    return lines.join("\n");
  }
  for (const r of ready) {
    lines.push(`<b>${esc(r.symbol)}</b> ${(r.dividendPct * 100).toFixed(0)}% · ≈ $${r.plan.withdrawUsd.toFixed(2)} gross · leave ≈ $${r.plan.leaveUsd.toFixed(2)}`);
    lines.push(`/dividend ${esc(r.symbol)}`);
  }
  return lines.join("\n");
}
