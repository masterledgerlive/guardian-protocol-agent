/**
 * Flow arm — our quote snapshot and our injection route.
 *
 * Robinhood (and any later source) is a place we read marks from.
 * The IDM route is the §RHD§ line we author. loc stays empty until
 * one of our covered leftover sells returns a real hash.
 * This arm does not send orders and does not sell the Base bag.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { stampTripleTime } from "../modules/phosphor/blocks.js";
import { ROBINHOOD_QUOTE_MIRROR } from "./wave-agent-bank.js";

export const WAVE_FLOW_ID = "wave-flow-arm-v1";
export const FLOW_MAGIC = "§RHD§v1";
export const FLOW_LABEL = "ROBINHOOD_CRYPTO";
export const FLOW_OWNER = "vita";
export const FLOW_FILE = "vita/memory/wave-flow-book.json";
export const LARGE_WAVE = 0.08;
export const FLOW_MAX_BYTES = 320;
export const MAX_SNAPSHOTS = 32;

const TX_RE = /^0x[0-9a-fA-F]{64}$/;

const sources = new Map();

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

export function hyphenUsd(symbol) {
  const s = normSym(symbol).replace(/-/g, "");
  if (s.endsWith("USD") && s.length > 3) return s.slice(0, -3) + "-USD";
  if (s.includes("-")) return s;
  return s.endsWith("-USD") ? s : s + "-USD";
}

function mirrorHits(pair) {
  const p = hyphenUsd(pair);
  return ROBINHOOD_QUOTE_MIRROR.filter((row) => row.pair === p);
}

export function registerFlowSource({ id, label, normalize }) {
  const key = String(id || "").trim().toLowerCase();
  if (!key || typeof normalize !== "function") return false;
  sources.set(key, { id: key, label: String(label || key), normalize });
  return true;
}

export function listFlowSources() {
  return [...sources.values()].map((s) => ({ id: s.id, label: s.label }));
}

export function quoteFromRhResult(row) {
  const pair = hyphenUsd(row?.symbol || row?.pair || "");
  const mark = num(row?.mark_price ?? row?.mark);
  if (!pair || !(mark > 0)) return null;
  const bid = num(row?.bid_price ?? row?.bid);
  const ask = num(row?.ask_price ?? row?.ask);
  const prev = num(row?.open_price ?? row?.prevClose);
  const hits = mirrorHits(pair);
  return {
    pair,
    mark,
    bid: bid > 0 ? bid : null,
    ask: ask > 0 ? ask : null,
    prevClose: prev > 0 ? prev : null,
    at: row?.updated_at || row?.at || null,
    routing: row?.routing || null,
    bookSymbols: hits.map((h) => h.symbol),
    sameToken: hits.length ? hits.every((h) => h.sameToken) : null,
  };
}

registerFlowSource({
  id: "robinhood",
  label: "Robinhood crypto quotes",
  normalize: quoteFromRhResult,
});

function emptyBook() {
  return {
    id: WAVE_FLOW_ID,
    owner: FLOW_OWNER,
    label: FLOW_LABEL,
    watch: [...new Set(ROBINHOOD_QUOTE_MIRROR.map((r) => r.pair))],
    snapshots: [],
    routes: [],
    updatedAt: null,
  };
}

export function createFlowBook(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const book = emptyBook();
  if (Array.isArray(src.watch) && src.watch.length) {
    book.watch = [...new Set(src.watch.map((p) => hyphenUsd(p)).filter(Boolean))];
  }
  book.snapshots = (Array.isArray(src.snapshots) ? src.snapshots : []).slice(-MAX_SNAPSHOTS);
  book.routes = (Array.isArray(src.routes) ? src.routes : [])
    .filter((r) => r?.line)
    .map((r) => ({
      line: String(r.line),
      at: r.at || null,
      txHash: TX_RE.test(String(r.txHash || "")) ? String(r.txHash) : null,
    }));
  book.updatedAt = src.updatedAt || null;
  return book;
}

export function loadFlowBook({ cwd = process.cwd() } = {}) {
  const path = join(cwd, FLOW_FILE);
  if (!existsSync(path)) return createFlowBook();
  try {
    return createFlowBook(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return createFlowBook();
  }
}

export function saveFlowBook(book, { cwd = process.cwd() } = {}) {
  const path = join(cwd, FLOW_FILE);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(book, null, 2));
  renameSync(tmp, path);
  return path;
}

export function catalogPairs() {
  return [...new Set(ROBINHOOD_QUOTE_MIRROR.map((r) => r.pair))];
}

export function watchPair(book, symbolOrPair) {
  const pair = hyphenUsd(symbolOrPair);
  if (!pair) return { ok: false, reason: "empty" };
  if (!book.watch.includes(pair)) book.watch.push(pair);
  book.updatedAt = new Date().toISOString();
  return { ok: true, pair, watched: true };
}

export function dropPair(book, symbolOrPair) {
  const pair = hyphenUsd(symbolOrPair);
  const before = book.watch.length;
  book.watch = book.watch.filter((p) => p !== pair);
  book.updatedAt = new Date().toISOString();
  return { ok: book.watch.length !== before, pair };
}

export function waveGlyph(prev, mark) {
  if (!(prev > 0) || !(mark > 0)) return "········";
  return mark < prev ? "▇▆▅▄▃▂▁·" : "·▁▂▃▄▅▆▇";
}

export function readQuoteWave(quote) {
  const mark = num(quote?.mark);
  const prev = num(quote?.prevClose);
  const bid = num(quote?.bid);
  const ask = num(quote?.ask);
  const spread = ask > bid && bid > 0 && mark > 0 ? (ask - bid) / mark : 0;
  if (!(mark > 0) || !(prev > 0)) {
    return {
      amp: null,
      large: false,
      leg: "mark",
      crashSeen: false,
      crashAt: null,
      spread,
      counter: false,
      glyph: "········",
      advice: "Mark filed. Prior close is missing, so the wave body waits.",
      executes: false,
    };
  }
  const amp = Math.abs(mark - prev) / prev;
  const large = amp >= LARGE_WAVE;
  const down = mark < prev;
  const crashAt = down ? mark : mark * (1 - amp);
  const counter = spread > 0 && spread > Math.max(0.025, amp * 0.5);
  let advice;
  if (down && large) {
    advice = "Big wave. The crash leg is on this tape. Base keeps the 10–30% dividend and leaves the bag.";
  } else if (!down && large) {
    advice = "Big rise. The counterpart crash sits near the give-back of this amplitude. Leave before the crowd gives it back.";
  } else if (counter) {
    advice = "The spread is wider than this move. Treat it as a second-scale quote and keep the wave.";
  } else if (down) {
    advice = "Dip off the prior close. The wave is still small.";
  } else {
    advice = "Lift off the prior close. The wave is still small.";
  }
  return {
    amp,
    large,
    leg: down ? "crash" : "rise",
    crashSeen: down && large,
    crashAt,
    spread,
    counter,
    glyph: waveGlyph(prev, mark),
    advice,
    executes: false,
  };
}

function watchedQuote(book, quote) {
  return book.watch.includes(quote.pair);
}

export function ingestSourceQuotes(book, sourceId, rows, { at = Date.now() } = {}) {
  const src = sources.get(String(sourceId || "").toLowerCase());
  if (!src) return { ok: false, reason: "unknown-source", filed: 0 };
  const quotes = [];
  let rejected = 0;
  for (const row of rows || []) {
    const q = src.normalize(row);
    if (!q) {
      rejected += 1;
      continue;
    }
    if (!watchedQuote(book, q)) continue;
    quotes.push(q);
  }
  if (!quotes.length) return { ok: false, reason: "no-watched-marks", filed: 0, rejected };
  const stamp = stampTripleTime(at);
  const snap = {
    source: src.id,
    at: stamp.utc,
    unix: stamp.unix,
    quotes,
  };
  book.snapshots.push(snap);
  while (book.snapshots.length > MAX_SNAPSHOTS) book.snapshots.shift();
  book.updatedAt = stamp.utc;
  return { ok: true, filed: quotes.length, rejected, snap };
}

export function latestSnapshot(book) {
  const list = book?.snapshots || [];
  return list.length ? list[list.length - 1] : null;
}

export function latestQuoteFor(book, symbolOrPair) {
  const snap = latestSnapshot(book);
  if (!snap) return null;
  const raw = normSym(symbolOrPair).replace(/-/g, "");
  const asPair = raw.endsWith("USD") ? hyphenUsd(raw) : null;
  const base = asPair ? asPair.split("-")[0] : normSym(symbolOrPair);
  return snap.quotes.find((q) => {
    if (asPair && q.pair === asPair) return true;
    if (q.pair.split("-")[0] === base) return true;
    return (q.bookSymbols || []).includes(normSym(symbolOrPair));
  }) || null;
}

function pct(amp) {
  if (!(amp >= 0)) return "-";
  return (amp * 100).toFixed(1);
}

function px(n) {
  const x = num(n);
  if (!(x > 0)) return "-";
  if (x >= 100) return x.toFixed(2);
  if (x >= 1) return x.toFixed(4);
  return x.toPrecision(4);
}

export function buildFlowRouteLine(book, { at = Date.now() } = {}) {
  const snap = latestSnapshot(book);
  const stamp = stampTripleTime(at);
  const ranked = (snap?.quotes || [])
    .map((q) => ({ q, w: readQuoteWave(q) }))
    .filter((row) => row.w.amp != null)
    .sort((a, b) => b.w.amp - a.w.amp || a.q.pair.localeCompare(b.q.pair));
  let keep = Math.min(4, ranked.length);
  let line = "";
  do {
    const top = ranked.slice(0, keep).map((row) => {
      const sign = row.w.leg === "crash" ? "-" : "+";
      return `${row.q.pair.split("-")[0]}@${px(row.q.mark)}:${sign}${pct(row.w.amp)}`;
    }).join(",") || "-";
    const wide = ranked.filter((row) => row.w.counter).map((row) => row.q.pair.split("-")[0]).slice(0, 3).join(",") || "-";
    line = [
      FLOW_MAGIC,
      `utc=${stamp.utc}`,
      `local=${stamp.local}`,
      `unix=${stamp.unix}`,
      `label=${FLOW_LABEL}`,
      `owner=${FLOW_OWNER}`,
      `src=${snap?.source || "robinhood"}`,
      `n=${snap?.quotes?.length || 0}`,
      `top=${top}`,
      `wide=${wide}`,
      "loc=-",
      "next=END",
    ].join("|");
    if (Buffer.byteLength(line, "utf8") <= FLOW_MAX_BYTES) break;
    keep -= 1;
  } while (keep >= 0);
  return {
    line,
    bytes: Buffer.byteLength(line, "utf8"),
    stamp,
    txHash: null,
    owner: FLOW_OWNER,
  };
}

export function bankFlowRoute(book, built) {
  if (!built?.line) return null;
  const existing = book.routes.find((r) => r.line === built.line);
  if (existing) return existing;
  const row = { line: built.line, at: built.stamp?.utc || null, txHash: null };
  book.routes.push(row);
  while (book.routes.length > 16) book.routes.shift();
  book.updatedAt = new Date().toISOString();
  return row;
}

export function commitFlowRouteHash(book, { line, txHash }) {
  if (!TX_RE.test(String(txHash || ""))) return false;
  const ride = [...(book.routes || [])].reverse().find((r) => r.line === line && !r.txHash);
  if (!ride) return false;
  ride.txHash = String(txHash);
  book.updatedAt = new Date().toISOString();
  return true;
}

export function planFlowRouteRide({ leftoverEth, hitchCostEth, pairedPlus = true, machine } = {}) {
  if (!machine) return { hitch: false, banked: true, send: false, reason: "no flow route line" };
  if (!pairedPlus) return { hitch: false, banked: true, send: false, utf8: machine, reason: "bank our route until a paired plus sell" };
  const left = num(leftoverEth, 0);
  const cost = num(hitchCostEth, 0);
  if (!(left > 0) || !(cost > 0) || left + 1e-18 < cost) {
    return { hitch: false, banked: true, send: false, utf8: machine, reason: "leftover does not cover our flow route" };
  }
  return { hitch: true, banked: false, send: false, utf8: machine, reason: "our §RHD§ route on covered leftover" };
}

export function flowRouteIdm(book) {
  const sealed = (book?.routes || []).filter((r) => TX_RE.test(String(r.txHash || "")));
  return {
    owner: FLOW_OWNER,
    label: FLOW_LABEL,
    sealed: sealed.map((r) => r.txHash),
    text: sealed.length
      ? `Our injection, owner vita. ${sealed.length} sealed loc(s) on this route.`
      : "Our injection §RHD§v1, label ROBINHOOD_CRYPTO, owner vita. Robinhood is the quote source. loc stays empty until our sell returns a hash.",
  };
}

function content8(line) {
  return createHash("sha256").update(String(line || ""), "utf8").digest("hex").slice(0, 8);
}

export function formatFlowBoard(book) {
  const snap = latestSnapshot(book);
  const idm = flowRouteIdm(book);
  const lines = [
    "🌊 <b>FLOW ARM</b>",
    esc(idm.text),
    `Watch ${book.watch.length} · catalog ${catalogPairs().length}`,
  ];
  if (!snap) {
    lines.push("No snapshot filed yet. A mark is stored only after a source returns one.");
    lines.push("/flow watch SYMBOL · /flow drop SYMBOL");
    return lines.join("\n");
  }
  lines.push(`Snapshot ${esc(snap.at)} · source ${esc(snap.source)}`);
  const rows = snap.quotes
    .map((q) => ({ q, w: readQuoteWave(q) }))
    .sort((a, b) => (b.w.amp || 0) - (a.w.amp || 0) || a.q.pair.localeCompare(b.q.pair));
  for (const row of rows.slice(0, 12)) {
    const amp = row.w.amp == null ? "mark" : `${row.w.leg} ${(row.w.amp * 100).toFixed(1)}%`;
    const flag = row.w.crashSeen ? " crash" : row.w.counter ? " wide" : "";
    lines.push(`${row.w.glyph} <b>${esc(row.q.pair)}</b> ${amp}${flag} · ${px(row.q.mark)}`);
  }
  if (rows.length > 12) lines.push(`… ${rows.length - 12} more on the watch`);
  const crest = rows.find((r) => r.w.crashSeen || r.w.large);
  if (crest) lines.push("", esc(crest.w.advice));
  lines.push("", "/flow watch SYMBOL · /flow drop SYMBOL · /flow route");
  return lines.join("\n");
}

export function formatFlowRoute(book) {
  const built = buildFlowRouteLine(book);
  const idm = flowRouteIdm(book);
  return [
    "💉 <b>OUR FLOW ROUTE</b>",
    esc(idm.text),
    `commit ${content8(built.line)}`,
    `<code>${esc(built.line)}</code>`,
  ].join("\n");
}

export function formatFlowSymbolNote(book, symbol) {
  const q = latestQuoteFor(book, symbol);
  if (!q) return "";
  const w = readQuoteWave(q);
  const amp = w.amp == null ? "mark only" : `${w.leg} ${(w.amp * 100).toFixed(1)}%`;
  return `Flow ${esc(q.pair)} ${w.glyph} ${amp}\n${esc(w.advice)}`;
}

export function formatFlowIndex(book) {
  const watch = new Set(book.watch);
  const lines = ["📇 <b>FLOW INDEX</b>", "Pick the pairs this arm watches. A pair with no filed mark stays blank.", ""];
  const pairs = [...new Set([...catalogPairs(), ...book.watch])].sort();
  for (const pair of pairs) {
    lines.push(`${watch.has(pair) ? "●" : "○"} ${esc(pair)}`);
  }
  lines.push("", "Sources: " + listFlowSources().map((s) => s.id).join(", "));
  return lines.join("\n");
}
