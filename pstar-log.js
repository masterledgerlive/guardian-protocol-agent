/**
 * P*_MKT paper logger — PAPER ONLY, zero broadcast.
 *
 * Maps Game's quantum-threshold idea onto the desk:
 *   p = 24h realized vol (stdev of the last 96 15m log returns × √96)
 *   d = size tier (1×, 3×, 5× of a $5 micro base)
 *   logical error = hypothetical net PnL after pool fee + gas + slippage
 *
 * This module never signs, never quotes, never touches the network, vault,
 * VITA brain or env flags. It only observes prices the agent already
 * recorded and keeps an in-memory ring of per-cycle records (snapshot file
 * served by the existing webhook). Flag: PSTAR_LOG (default "yes"; "no"/"0"/
 * "off"/"false" disables observation + records).
 *
 * Spec + locked band: docs/MARKET_THRESHOLD_PREREG.md,
 * results: docs/MARKET_THRESHOLD_RESULTS.md.
 *
 * Wiring: history-slot.js `recordPriceInto` calls `pstarTick` (try/catch) so
 * every live price the agent already records feeds this logger; no edit to
 * agent.js. Read it at GET /vita/read?f=pstar-log.json (snapshot file,
 * rewritten at most once per 60s; skipped under node --test).
 */

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const PSTAR_FILE = join(HERE, "pstar-log.json");

export const PSTAR_SPEC = Object.freeze({
  barMs: 15 * 60 * 1000,
  volWindow: 96,
  scale: Math.sqrt(96),
  baseUsd: 5,
  tiers: [1, 3, 5],
  gasRoundTripUsd: 0.12,
  volSlipCoef: 0.25,
  holdBars: 192,
  troughBars: 16,
  pullBars: 96,
  rsiN: 14,
  minReturnsForVol: 8,
  maxBars: 400,
  maxRecords: 600,
});

/** Locked (pre-registered, commit cbfdaad9) and measured bands. Set via setPstarBands. */
export const PSTAR_DEFAULT_BANDS = Object.freeze({
  prereg: { commit: "cbfdaad9", band: [0.08, 0.13], point: 0.10 },
  // Backtest 2026-09-27 (research/pstar, Coinbase 15m, AERO/DEGEN/TOSHI/VIRTUAL/WETH, 90d, 259 cycles).
  measured: {
    detected: false,
    degenerateCrossing: 0.0183,
    bootCI95: [0.0177, 0.0620],
    bootNoCrossReps: 184,
    chop: null,
    verdict: "no robust threshold in observed vol range: d5 net < d1 net in every bucket with p >= 0.02 (15m) and in every bucket (1h). Classification below uses the prereg band.",
  },
});

let bands = { ...PSTAR_DEFAULT_BANDS };
const bars = new Map(); // sym -> [{t,o,h,l,c}]
const paper = new Map(); // sym -> open paper cycle
const records = [];
const closed = [];
let cycles = 0;
let lastCycleAt = 0;
let lastFileAt = 0;
let metaCache = null;

export function pstarEnabled(env = process.env) {
  const v = String(env?.PSTAR_LOG ?? "yes").trim().toLowerCase();
  return !(v === "no" || v === "0" || v === "off" || v === "false");
}

export function setPstarBands(next = {}) {
  bands = { ...bands, ...next };
  return bands;
}

export function resetPstar() {
  bars.clear(); paper.clear(); records.length = 0; closed.length = 0; cycles = 0; lastCycleAt = 0; lastFileAt = 0; metaCache = null;
  bands = { ...PSTAR_DEFAULT_BANDS };
}

/** Feed one price sample (USD). Aggregates into 15m OHLC bars. */
export function pstarObserve(symbol, price, now = Date.now(), env = process.env) {
  if (!pstarEnabled(env)) return false;
  const px = Number(price);
  const sym = String(symbol || "").toUpperCase();
  if (!sym || !Number.isFinite(px) || px <= 0) return false;
  const t = Math.floor(now / PSTAR_SPEC.barMs) * PSTAR_SPEC.barMs;
  let arr = bars.get(sym);
  if (!arr) { arr = []; bars.set(sym, arr); }
  const last = arr[arr.length - 1];
  if (last && last.t === t) {
    if (px > last.h) last.h = px;
    if (px < last.l) last.l = px;
    last.c = px;
  } else if (!last || t > last.t) {
    // forward-fill silent bars at prior close (matches backtest)
    if (last) {
      for (let tt = last.t + PSTAR_SPEC.barMs; tt < t && arr.length < PSTAR_SPEC.maxBars * 2; tt += PSTAR_SPEC.barMs) {
        arr.push({ t: tt, o: last.c, h: last.c, l: last.c, c: last.c });
      }
    }
    arr.push({ t, o: px, h: px, l: px, c: px });
    while (arr.length > PSTAR_SPEC.maxBars) arr.shift();
  }
  return true;
}

/** 24h-scaled realized vol from closed bars (excludes the forming bar). */
export function realizedVol(closes, spec = PSTAR_SPEC) {
  const c = (closes || []).filter((x) => Number(x) > 0);
  const lr = [];
  for (let i = 1; i < c.length; i++) lr.push(Math.log(c[i] / c[i - 1]));
  const w = lr.slice(-spec.volWindow);
  if (w.length < spec.minReturnsForVol) return { p: null, n: w.length, warming: true };
  const m = w.reduce((a, b) => a + b, 0) / w.length;
  const v = w.reduce((a, b) => a + (b - m) ** 2, 0) / (w.length - 1);
  return { p: Math.sqrt(v) * spec.scale, n: w.length, warming: w.length < spec.volWindow };
}

/**
 * inside  = within the measured chop band (else prereg band if no measurement)
 * edge    = within ±25% of the band half-width outside it
 * outside = everything else ("below" / "above" side reported)
 */
export function classifyBand(p, b = bands) {
  if (!(p > 0)) return { cls: "unknown", side: null, band: null };
  const src = b?.measured?.chop || b?.prereg?.band;
  if (!Array.isArray(src)) return { cls: "unknown", side: null, band: null };
  const [lo, hi] = src;
  const pad = ((hi - lo) / 2) * 0.25;
  const side = p < lo ? "below" : p > hi ? "above" : "in";
  if (p >= lo && p <= hi) return { cls: "inside", side, band: src };
  if (p >= lo - pad && p <= hi + pad) return { cls: "edge", side, band: src };
  return { cls: "outside", side, band: src };
}

function rsi(closes, n) {
  if (closes.length < n + 1) return 50;
  let au = 0, ad = 0;
  for (let i = 1; i <= n; i++) {
    const d = closes[i] - closes[i - 1];
    au += Math.max(d, 0); ad += Math.max(-d, 0);
  }
  au /= n; ad /= n;
  for (let i = n + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    au = (au * (n - 1) + Math.max(d, 0)) / n;
    ad = (ad * (n - 1) + Math.max(-d, 0)) / n;
  }
  if (ad === 0) return 100;
  return 100 - 100 / (1 + au / ad);
}

/** Same net formula as research/pstar/backtest.py `net`. */
export function tierNetUsd(grossReturn, d, { fee = 0.006, sigmaBar = 0, liqUsd = Infinity, spec = PSTAR_SPEC } = {}) {
  const N = d * spec.baseUsd;
  const impact = Number.isFinite(liqUsd) && liqUsd > 0 ? (2 * N) / liqUsd : 0;
  const slipSide = N * (spec.volSlipCoef * sigmaBar + impact);
  return N * grossReturn - N * fee - spec.gasRoundTripUsd - 2 * slipSide;
}

function tierMap(r, opts) {
  const out = {};
  for (const d of PSTAR_SPEC.tiers) out[`d${d}`] = Number(tierNetUsd(r, d, opts).toFixed(4));
  return out;
}

/**
 * One paper cycle for all observed symbols. `meta[sym] = { fee, tp, liqUsd }`
 * optional. Returns the records appended this cycle.
 */
export function pstarCycle({ now = Date.now(), meta = {}, env = process.env } = {}) {
  if (!pstarEnabled(env)) return [];
  cycles += 1; lastCycleAt = now;
  const out = [];
  const curBar = Math.floor(now / PSTAR_SPEC.barMs) * PSTAR_SPEC.barMs;
  for (const [sym, arr] of bars) {
    const done = arr.filter((b) => b.t < curBar);
    if (done.length < 2) continue;
    const m = meta[sym] || {};
    const fee = Number(m.fee) > 0 ? Number(m.fee) : 0.006;
    const tp = Number(m.tp) > 0 ? Number(m.tp) : 0.031;
    const liqUsd = Number(m.liqUsd) > 0 ? Number(m.liqUsd) : Infinity;
    const closes = done.map((b) => b.c);
    const vol = realizedVol(closes);
    const sigmaBar = vol.p ? vol.p / PSTAR_SPEC.scale : 0;
    const band = classifyBand(vol.p);
    const last = done[done.length - 1];
    const px = arr[arr.length - 1].c;

    // paper position management (evaluated once per closed bar)
    let pos = paper.get(sym);
    let event = null;
    if (pos && last.t > pos.lastEvalBar) {
      for (const b of done.filter((x) => x.t > pos.lastEvalBar)) {
        pos.lastEvalBar = b.t; pos.bars += 1;
        if (b.h >= pos.entry * (1 + pos.tp)) { pos.exit = pos.entry * (1 + pos.tp); pos.reason = "tp"; break; }
        if (pos.bars >= PSTAR_SPEC.holdBars) { pos.exit = b.c; pos.reason = "time"; break; }
      }
      if (pos.exit) {
        const r = pos.exit / pos.entry - 1;
        const res = { sym, openedAt: pos.openedAt, closedAt: now, pEntry: pos.p, band: pos.band, reason: pos.reason, gross: r,
          net: tierMap(r, { fee: pos.fee, sigmaBar: pos.sigmaBar, liqUsd: pos.liqUsd }) };
        closed.push(res); while (closed.length > 200) closed.shift();
        paper.delete(sym); pos = null; event = { type: "paper-exit", ...res };
      }
    }
    if (!pos && vol.p && !vol.warming && done.length > PSTAR_SPEC.pullBars + 1 && (!event)) {
      const i = done.length - 1;
      const lowPrior = Math.min(...done.slice(i - PSTAR_SPEC.troughBars, i).map((b) => b.l));
      const highPrior = Math.max(...done.slice(i - PSTAR_SPEC.pullBars, i).map((b) => b.h));
      const trough = last.c <= 1.005 * lowPrior;
      const mom = rsi(closes.slice(-120), PSTAR_SPEC.rsiN) <= 35;
      const pull = last.c <= 0.97 * highPrior;
      const lrLast = Math.log(last.c / done[i - 1].c);
      const falling = lrLast < -3 * sigmaBar;
      if (trough + mom + pull >= 2 && !falling) {
        pos = { entry: px, openedAt: now, lastEvalBar: last.t, bars: 0, tp, fee, liqUsd, sigmaBar, p: vol.p, band: band.cls };
        paper.set(sym, pos);
        event = { type: "paper-entry", sym, entry: px, p: vol.p, band: band.cls, signals: { trough, mom, pull } };
      }
    }
    const open = paper.get(sym);
    const markR = open ? px / open.entry - 1 : null;
    const rec = {
      at: new Date(now).toISOString(),
      sym,
      price: px,
      p: vol.p != null ? Number(vol.p.toFixed(5)) : null,
      volReturns: vol.n,
      warming: vol.warming,
      band: band.cls,
      side: band.side,
      paperOpen: !!open,
      hypothetical: open
        ? { markGross: Number(markR.toFixed(5)), netIfClosedNow: tierMap(markR, { fee: open.fee, sigmaBar: open.sigmaBar, liqUsd: open.liqUsd }) }
        : null,
      event,
    };
    records.push(rec); out.push(rec);
  }
  while (records.length > PSTAR_SPEC.maxRecords) records.shift();
  return out;
}

export function pstarSnapshot({ limit = 120 } = {}) {
  const latest = {};
  for (const r of records) latest[r.sym] = r;
  const byTier = { d1: 0, d3: 0, d5: 0 };
  for (const c of closed) for (const k of Object.keys(byTier)) byTier[k] += c.net[k] || 0;
  return {
    paperOnly: true,
    broadcast: false,
    enabled: pstarEnabled(),
    spec: { vol: "stdev(last 96 x 15m log returns) x sqrt(96)", tiersUsd: PSTAR_SPEC.tiers.map((d) => d * PSTAR_SPEC.baseUsd),
      gasRoundTripUsd: PSTAR_SPEC.gasRoundTripUsd, exit: "TP=minNetMargin+poolFee, no SL, 48h time stop" },
    bands,
    cycles,
    lastCycleAt: lastCycleAt ? new Date(lastCycleAt).toISOString() : null,
    latest,
    openPaper: Object.fromEntries([...paper].map(([k, v]) => [k, { entry: v.entry, p: v.p, band: v.band, bars: v.bars }])),
    closedPaper: { n: closed.length, sumNetUsd: byTier, last: closed.slice(-20) },
    records: records.slice(-Math.max(1, Math.min(600, Number(limit) || 120))),
  };
}

/** Compact line for the engine board. */
export function pstarBoardField() {
  const s = pstarSnapshot({ limit: 1 });
  const rows = Object.values(s.latest).map((r) => ({ sym: r.sym, p: r.p, band: r.band, paperOpen: r.paperOpen }));
  return { paperOnly: true, bands: s.bands, rows, closedPaper: s.closedPaper.sumNetUsd, cycles: s.cycles };
}

/** Per-symbol fee / TP from tokens.json (read-only, cached). */
export function pstarMetaFromTokens(file = join(HERE, "tokens.json")) {
  if (metaCache) return metaCache;
  const meta = {};
  try {
    if (existsSync(file)) {
      const list = JSON.parse(readFileSync(file, "utf8"))?.tokens || [];
      for (const t of list) {
        const fee = Number(t.poolFeePct) > 0 ? Number(t.poolFeePct) : 0.006;
        const mnm = Number(t.minNetMargin) > 0 ? Number(t.minNetMargin) : 0.025;
        meta[String(t.symbol).toUpperCase()] = { fee, tp: mnm + fee };
      }
    }
  } catch { /* defaults */ }
  metaCache = meta;
  return meta;
}

/**
 * Hook entry (called from history-slot.recordPriceInto). Observe the price,
 * run at most one paper cycle per 15s, write the snapshot file at most once
 * per 60s. Never throws to the caller's caller (caller also wraps).
 */
export function pstarTick(symbol, price, now = Date.now(), env = process.env) {
  if (!pstarEnabled(env)) return false;
  pstarObserve(symbol, price, now, env);
  if (now - lastCycleAt >= 15_000) {
    pstarCycle({ now, meta: pstarMetaFromTokens(), env });
    if (!env?.NODE_TEST_CONTEXT && now - lastFileAt >= 60_000) {
      lastFileAt = now;
      try {
        writeFileSync(PSTAR_FILE, JSON.stringify(pstarSnapshot({ limit: 60 }), null, 1));
      } catch { /* read-only fs: in-memory only */ }
    }
  }
  return true;
}
