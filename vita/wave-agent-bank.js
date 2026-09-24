/**
 * Classical wave desk the main agent can read.
 *
 * Token click answers from the saved high/low ledger immediately:
 * the next prediction needs 2 highs and 2 lows.
 * Quality is accrued token units per sector, plus sealed rides
 * versus wipeouts. A ride or wipeout counts only when a SELL has
 * a real 0x+64 tx hash and a finite non-zero netUsd.
 *
 * Chain copy is a §WHL§ pebble inside calldata. Anything else
 * (VITAFEED, Eureka, a plain swap) is left alone.
 * Robinhood is a quote mirror. This desk never sends an order.
 */

import {
  KNOWN_CHAIN_ANCHORS,
  fetchRecentWalletTransactions,
  fetchTxCalldataHex,
} from "../vita-chain-reader.js";
import {
  bankWaveHlRide,
  commitWaveHlRideHash,
  fmtWavePxDisplay,
  readWaveHlFromHex,
  recordWaveExtreme,
} from "./wave-hl-ledger.js";

export const WAVE_AGENT_BANK_ID = "wave-agent-bank-v1";
export const PREDICT_HIGHS = 2;
export const PREDICT_LOWS = 2;
export const LULL_RED_RATIO = 0.7;
export const LULL_MAX_RISING = 2;
export const LULL_MIN_STAGED = 3;
export const CHAIN_PULL_TTL_MS = 60_000;
export const ROBINHOOD_MIRROR_VERIFIED = "2026-09-24";

const TX_RE = /^0x[0-9a-fA-F]{64}$/;
const MAJORS = ["LINK", "AAVE", "UNI", "CBBTC"];

const SECTOR_OF = {
  AERO: "dex",
  LINK: "major",
  AAVE: "major",
  UNI: "major",
  CBBTC: "major",
  WETH: "quote",
  ETH: "quote",
  USDC: "stable",
  VIRTUAL: "ai",
  AIXBT: "ai",
  VVV: "ai",
  LUNA: "ai",
  GAME: "ai",
  TIBBIR: "ai",
  REI: "ai",
  DRB: "ai",
  ZORA: "creator",
  DEGEN: "social",
  TOSHI: "social",
  BRETT: "meme",
  KEYCAT: "meme",
  DOGINME: "meme",
  MOG: "meme",
  BASECAT: "meme",
  SKI: "meme",
  MORPHO: "credit",
  WELL: "credit",
  SEAM: "credit",
  CLANKER: "launch",
  BNKR: "launch",
  HOME: "home",
};

/**
 * Exact Robinhood currency-pair hits from a read-only search on
 * 2026-09-24. Quote mirror only. CBBTC and WETH are asset-class
 * mirrors. A missing ticker stays off this list.
 */
export const ROBINHOOD_QUOTE_MIRROR = Object.freeze([
  { symbol: "ETH", pair: "ETH-USD", sameToken: true },
  { symbol: "WETH", pair: "ETH-USD", sameToken: false, note: "WETH on Base, ETH-USD quote" },
  { symbol: "CBBTC", pair: "BTC-USD", sameToken: false, note: "same asset class, different token" },
  { symbol: "LINK", pair: "LINK-USD", sameToken: true },
  { symbol: "UNI", pair: "UNI-USD", sameToken: true },
  { symbol: "AAVE", pair: "AAVE-USD", sameToken: true },
  { symbol: "AERO", pair: "AERO-USD", sameToken: true },
  { symbol: "BRETT", pair: "BRETT-USD", sameToken: true },
  { symbol: "VIRTUAL", pair: "VIRTUAL-USD", sameToken: true },
  { symbol: "MORPHO", pair: "MORPHO-USD", sameToken: true },
  { symbol: "ZORA", pair: "ZORA-USD", sameToken: true },
  { symbol: "TOSHI", pair: "TOSHI-USD", sameToken: true },
  { symbol: "AIXBT", pair: "AIXBT-USD", sameToken: true },
  { symbol: "KEYCAT", pair: "KEYCAT-USD", sameToken: true },
  { symbol: "CLANKER", pair: "CLANKER-USD", sameToken: true },
  { symbol: "VVV", pair: "VVV-USD", sameToken: true },
  { symbol: "DOGINME", pair: "DOGINME-USD", sameToken: true },
  { symbol: "USDC", pair: "USDC-USD", sameToken: false, note: "dollar stable quote; Base USDC stays the shelter seat" },
]);

const MIRROR_BY_SYMBOL = new Map(ROBINHOOD_QUOTE_MIRROR.map((row) => [row.symbol, row]));

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

function trimUnits(n) {
  const x = num(n, 0);
  if (x >= 1000) return x.toFixed(2);
  if (x >= 1) return x.toFixed(4);
  return x.toFixed(8);
}

export function sectorOf(symbol) {
  const sym = normSym(symbol);
  return SECTOR_OF[sym] || "other";
}

export function robinhoodMirror(symbol) {
  return MIRROR_BY_SYMBOL.get(normSym(symbol)) || null;
}

export function wavesNeeded(row) {
  const haveHighs = Number.isFinite(num(row?.storedHighs))
    ? num(row.storedHighs)
    : Array.isArray(row?.highs) ? row.highs.length : 0;
  const haveLows = Number.isFinite(num(row?.storedLows))
    ? num(row.storedLows)
    : Array.isArray(row?.lows) ? row.lows.length : 0;
  const highsStill = Math.max(0, PREDICT_HIGHS - haveHighs);
  const lowsStill = Math.max(0, PREDICT_LOWS - haveLows);
  return {
    needHighs: PREDICT_HIGHS,
    needLows: PREDICT_LOWS,
    haveHighs,
    haveLows,
    highsStill,
    lowsStill,
    ready: highsStill === 0 && lowsStill === 0,
  };
}

function isRedSeat(row) {
  return row?.arrow === "↓"
    || row?.stage === "FALLING"
    || row?.stage === "BASE"
    || row?.exitMode === "HOLD_RED";
}

function isRisingSeat(row) {
  return row?.arrow === "↑"
    && (row?.stage === "RISING" || row?.stage === "TROUGH" || row?.stage === "PEAK");
}

export function scoreFills(trades) {
  const bySymbol = {};
  let rides = 0;
  let wipeouts = 0;
  let skipped = 0;
  for (const t of trades || []) {
    if (String(t?.type || "").toUpperCase() !== "SELL") {
      skipped += 1;
      continue;
    }
    const net = num(t.netUsd);
    const tx = String(t.tx || t.txHash || "");
    if (!TX_RE.test(tx) || !Number.isFinite(net) || net === 0) {
      skipped += 1;
      continue;
    }
    const sym = normSym(t.symbol);
    if (!sym) {
      skipped += 1;
      continue;
    }
    if (!bySymbol[sym]) bySymbol[sym] = { rides: 0, wipeouts: 0 };
    if (net > 0) {
      bySymbol[sym].rides += 1;
      rides += 1;
    } else {
      bySymbol[sym].wipeouts += 1;
      wipeouts += 1;
    }
  }
  return { rides, wipeouts, skipped, bySymbol };
}

export function buildSectorBanks({ balances = {}, prices = {}, symbols = null } = {}) {
  const uniq = [];
  const push = (s) => {
    const sym = normSym(s);
    if (sym && !uniq.includes(sym)) uniq.push(sym);
  };
  for (const s of symbols || []) push(s?.symbol || s);
  for (const s of Object.keys(balances || {})) push(s);
  const grouped = {};
  let totalUnits = 0;
  for (const sym of uniq) {
    const units = Math.max(0, num(balances[sym], 0));
    const px = num(prices[sym], 0);
    const usd = px > 0 && units > 0 ? units * px : null;
    const sector = sectorOf(sym);
    if (!grouped[sector]) grouped[sector] = { sector, units: 0, markedUsd: 0, partial: false, tokens: [] };
    grouped[sector].units += units;
    if (units > 0 && usd == null) grouped[sector].partial = true;
    else if (usd != null) grouped[sector].markedUsd += usd;
    grouped[sector].tokens.push({ symbol: sym, units, usd });
    totalUnits += units;
  }
  const sectors = Object.values(grouped).map((s) => {
    const lead = [...s.tokens].sort((a, b) => b.units - a.units || a.symbol.localeCompare(b.symbol))[0];
    return {
      sector: s.sector,
      units: s.units,
      usd: s.partial ? null : s.markedUsd,
      share: totalUnits > 0 ? s.units / totalUnits : 0,
      leadSymbol: lead && lead.units > 0 ? lead.symbol : null,
    };
  }).sort((a, b) => b.units - a.units || a.sector.localeCompare(b.sector));
  return { sectors, totalUnits };
}

export function detectLull(rows) {
  const staged = (rows || []).filter((r) => num(r?.price) > 0 && r?.stage && r.stage !== "LOGGING");
  const red = staged.filter(isRedSeat).length;
  const rising = staged.filter(isRisingSeat).length;
  const ratio = staged.length ? red / staged.length : 0;
  return {
    active: staged.length >= LULL_MIN_STAGED && ratio >= LULL_RED_RATIO && rising <= LULL_MAX_RISING,
    staged: staged.length,
    red,
    rising,
    ratio,
  };
}

export function pickShelter({ rows = [], balances = {} } = {}) {
  const usdc = Math.max(0, num(balances.USDC, 0));
  if (usdc > 0) return [{ symbol: "USDC", why: "stable units on the book" }];
  const rising = (rows || [])
    .filter(isRisingSeat)
    .sort((a, b) => (b.confidence || 0) - (a.confidence || 0) || a.symbol.localeCompare(b.symbol))
    .slice(0, 2);
  if (rising.length) {
    return rising.map((r) => ({ symbol: r.symbol, why: `${r.arrow} ${r.stage}` }));
  }
  const majors = MAJORS
    .map((s) => (rows || []).find((r) => r.symbol === s))
    .filter(Boolean)
    .sort((a, b) => {
      const ar = isRedSeat(a) ? 1 : 0;
      const br = isRedSeat(b) ? 1 : 0;
      return ar - br || (b.confidence || 0) - (a.confidence || 0) || a.symbol.localeCompare(b.symbol);
    });
  return majors.slice(0, 2).map((r) => ({
    symbol: r.symbol,
    why: isRedSeat(r) ? "major still on the book" : `${r.arrow} ${r.stage}`,
  }));
}

function provenCycles(rows, fills) {
  return (rows || [])
    .filter((r) => wavesNeeded(r).ready && (fills.bySymbol[r.symbol]?.rides || 0) > 0)
    .map((r) => ({
      symbol: r.symbol,
      rides: fills.bySymbol[r.symbol].rides,
      wipeouts: fills.bySymbol[r.symbol].wipeouts,
      stage: r.stage,
      arrow: r.arrow,
    }))
    .sort((a, b) => b.rides - a.rides || a.symbol.localeCompare(b.symbol));
}

export function rankClassicalAgents({ rows = [], fills, banks, lull, shelter = [] } = {}) {
  const book = fills || scoreFills([]);
  const readyUp = rows.filter((r) => wavesNeeded(r).ready && r.arrow === "↑" && r.exitMode !== "HOLD_RED");
  const best = [...readyUp].sort((a, b) => b.confidence - a.confidence || a.symbol.localeCompare(b.symbol))[0] || null;
  const rideSum = book.rides || 0;
  const wipeSum = book.wipeouts || 0;
  const riderScore = readyUp.length
    ? clamp(Math.round(
      (readyUp.reduce((s, r) => s + (r.confidence || 0), 0) / readyUp.length)
      + Math.min(20, rideSum)
      - Math.min(20, wipeSum),
    ), 0, 100)
    : clamp(rideSum > 0 ? 20 + Math.min(20, rideSum) : 8, 0, 100);
  const vaultScore = lull?.active ? clamp(60 + shelter.length * 10, 0, 100) : 12;
  const top = (banks?.sectors || []).find((s) => s.units > 0) || null;
  const bankScore = top ? clamp(Math.round(top.share * 100), 0, 100) : 0;
  const agents = [
    {
      id: "wave-rider",
      name: "Wave rider",
      executes: false,
      score: riderScore,
      pick: best?.symbol || null,
      thesis: best
        ? `${best.symbol} is ready, ${best.arrow} ${best.confidence}% ${best.stage}. Sealed rides ${rideSum}, wipeouts ${wipeSum}.`
        : `Waiting on 2 highs and 2 lows with an up arrow. Sealed rides ${rideSum}, wipeouts ${wipeSum}.`,
    },
    {
      id: "lull-vault",
      name: "Lull vault",
      executes: false,
      score: vaultScore,
      pick: lull?.active ? (shelter[0]?.symbol || null) : null,
      thesis: lull?.active
        ? `Lull: ${lull.red} of ${lull.staged} seats waiting, ${lull.rising} rising. Shelter ${shelter.map((s) => s.symbol).join(", ") || "none"}.`
        : `Book is moving (${lull?.rising || 0} rising of ${lull?.staged || 0} staged). Vault waits.`,
    },
    {
      id: "sector-bank",
      name: "Sector bank",
      executes: false,
      score: bankScore,
      pick: top?.leadSymbol || null,
      thesis: top
        ? `${top.sector} holds ${trimUnits(top.units)} units (${Math.round(top.share * 100)}% of the bank). Lead ${top.leadSymbol}.`
        : "No accrued token units on the book.",
    },
  ];
  agents.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return agents;
}

export function chainPullView(chain) {
  if (!chain?.at) {
    return {
      scanned: false,
      whl: null,
      text: "Chain pull has not returned in this process. The next prediction uses the saved ledger.",
    };
  }
  if (chain.error) {
    return {
      scanned: false,
      whl: num(chain.whl, 0),
      text: `Chain pull error: ${chain.error}. The next prediction uses the saved ledger.`,
    };
  }
  const whl = num(chain.whl, 0);
  const anchors = num(chain.anchors, 0);
  const trails = num(chain.trails, 0);
  const text = whl > 0
    ? `Chain pull: ${anchors} anchors, ${trails} wallet trails, ${whl} §WHL§ pebble(s).`
    : `Chain pull: ${anchors} anchors, ${trails} wallet trails, 0 §WHL§ pebbles. Saved swings stay local until a covered leftover sell seals a line.`;
  return { scanned: true, whl, text };
}

export function buildWaveAgentDesk({
  rows = [],
  trades = [],
  balances = {},
  prices = {},
  chain = null,
  symbols = [],
} = {}) {
  const fills = scoreFills(trades);
  const banks = buildSectorBanks({ balances, prices, symbols });
  const lull = detectLull(rows);
  const shelter = pickShelter({ rows, balances });
  const agents = rankClassicalAgents({ rows, fills, banks, lull, shelter });
  const proven = provenCycles(rows, fills);
  return {
    id: WAVE_AGENT_BANK_ID,
    executes: false,
    fills,
    banks,
    lull,
    shelter,
    agents,
    proven,
    chain: chainPullView(chain),
  };
}

export function formatWaveClickCard({
  symbol,
  row,
  chain = null,
  trades = [],
  balances = {},
  prices = {},
} = {}) {
  const sym = normSym(symbol || row?.symbol);
  const need = wavesNeeded(row);
  const lines = [`🌊 <b>${esc(sym)} WAVE</b>`];
  if (!row) {
    lines.push("No saved swing row for this symbol.");
  } else if (!need.ready) {
    lines.push(`Next prediction needs ${need.needHighs} highs and ${need.needLows} lows.`);
    lines.push(`Saved now: ${need.haveHighs} highs, ${need.haveLows} lows.`);
    lines.push(`Still ${need.highsStill} high(s) and ${need.lowsStill} low(s).`);
  } else {
    lines.push("Ready. Next prediction uses the saved swings.");
    lines.push(`${row.arrow} ${row.confidence}% ${esc(row.stage)}`);
    lines.push(`Bottom ${fmtWavePxDisplay(row.predictedLow)} · exit high ${fmtWavePxDisplay(row.exitTarget)}`);
    lines.push(esc(row.exitReason || ""));
  }
  lines.push(chainPullView(chain).text);
  const units = Math.max(0, num(balances[sym], 0));
  const px = num(prices[sym] ?? row?.price, 0);
  const marked = units > 0 && px > 0 ? ` · marked $${(units * px).toFixed(2)}` : "";
  lines.push(`Sector <b>${esc(sectorOf(sym))}</b> · accrued units ${trimUnits(units)}${marked}`);
  const fill = scoreFills(trades).bySymbol[sym] || { rides: 0, wipeouts: 0 };
  lines.push(`Sealed rides ${fill.rides} · wipeouts ${fill.wipeouts}`);
  const rh = robinhoodMirror(sym);
  if (rh) {
    const kind = rh.sameToken ? "quote mirror" : "asset-class quote";
    lines.push(`Robinhood ${esc(rh.pair)} ${kind} (${ROBINHOOD_MIRROR_VERIFIED}). Quote only. Base injection bank stays here.`);
    if (rh.note) lines.push(esc(rh.note));
  } else {
    lines.push("No verified Robinhood pair for this ticker. Injection bank stays on Base.");
  }
  return lines.join("\n");
}

export function formatLullTelegram(desk) {
  const l = desk?.lull || { active: false, staged: 0, red: 0, rising: 0 };
  const lines = ["🌙 <b>WAVE LULL</b>"];
  if (l.active) {
    lines.push(`${l.red} of ${l.staged} staged seats are waiting. ${l.rising} still rising.`);
    lines.push("Shelter is advice. This board does not sell.");
  } else {
    lines.push(`Book is moving: ${l.rising} rising, ${l.red} waiting, ${l.staged} staged.`);
  }
  lines.push("", "Shelter:");
  if (!desk?.shelter?.length) lines.push("USDC when units are on the book. No rising seat and no major row yet.");
  else for (const s of desk.shelter) lines.push(`${esc(s.symbol)} — ${esc(s.why)}`);
  if (desk?.proven?.length) {
    lines.push("", "Sealed cycles still on the book:");
    for (const p of desk.proven.slice(0, 8)) {
      lines.push(`${esc(p.symbol)} ${p.arrow || ""} rides ${p.rides} · wipeouts ${p.wipeouts}`);
    }
  }
  lines.push("", desk?.chain?.text || "");
  return lines.join("\n").trim();
}

export function formatWaveAgentsTelegram(desk) {
  const lines = [
    "🤖 <b>CLASSICAL WAVE AGENTS</b>",
    "Wave rider, lull vault, and sector bank compete on this board. They do not send transactions.",
    "",
  ];
  const agents = desk?.agents || [];
  agents.forEach((a, i) => {
    lines.push(`${i === 0 ? "★ " : ""}<b>${esc(a.name)}</b> ${a.score}`);
    lines.push(esc(a.thesis));
    if (a.pick) lines.push(`Seat: ${esc(a.pick)}`);
    lines.push("");
  });
  if (desk?.proven?.length) {
    lines.push("Proven cycles (sealed ride, 2 highs and 2 lows):");
    for (const p of desk.proven) {
      lines.push(`${esc(p.symbol)} ${p.arrow || ""} rides ${p.rides} · wipeouts ${p.wipeouts}`);
    }
  } else {
    lines.push("Proven cycles: none yet. A cycle counts after a real sell hash with net above zero.");
  }
  lines.push("", "Sectors:");
  const held = (desk?.banks?.sectors || []).filter((s) => s.units > 0);
  if (!held.length) lines.push("No accrued units in the balance cache.");
  for (const s of held) {
    lines.push(`${esc(s.sector)} ${trimUnits(s.units)} units${s.leadSymbol ? " · " + esc(s.leadSymbol) : ""}`);
  }
  lines.push("", desk?.chain?.text || "");
  return lines.join("\n").trim();
}

export function pebblesFromCalldata(hex, txHash) {
  if (!TX_RE.test(String(txHash || ""))) return [];
  return readWaveHlFromHex(hex).map((p) => ({
    ...p,
    txHash: String(txHash),
    source: "chain",
  }));
}

export function applyWavePebbles(ledger, pebbles) {
  let accepted = 0;
  let refused = 0;
  let ridesSealed = 0;
  const symbols = [];
  for (const p of pebbles || []) {
    if (!TX_RE.test(String(p?.txHash || "")) || !p?.symbol || !p?.line) {
      refused += 1;
      continue;
    }
    const sym = normSym(p.symbol);
    const at = num(p.unix) > 1e12 ? num(p.unix) : num(p.unix) > 0 ? num(p.unix) * 1000 : Date.now();
    for (const price of p.highs || []) {
      const rec = recordWaveExtreme(ledger, { symbol: sym, side: "high", price, at, source: "chain" });
      if (rec.accepted) accepted += 1;
    }
    for (const price of p.lows || []) {
      const rec = recordWaveExtreme(ledger, { symbol: sym, side: "low", price, at, source: "chain" });
      if (rec.accepted) accepted += 1;
    }
    const slot = ledger?.tokens?.[sym];
    if (slot) {
      slot.highCount = Math.max(slot.highCount, num(p.highCount, 0), slot.highs.length);
      slot.lowCount = Math.max(slot.lowCount, num(p.lowCount, 0), slot.lows.length);
    }
    bankWaveHlRide(ledger, {
      line: p.line,
      stamp: { utc: p.utc, local: p.local, unix: p.unix },
      prev: p.prev,
    }, { symbol: sym });
    if (commitWaveHlRideHash(ledger, { symbol: sym, machine: p.line, txHash: p.txHash })) {
      ridesSealed += 1;
    }
    symbols.push(sym);
  }
  return { accepted, refused, ridesSealed, symbols: [...new Set(symbols)] };
}

export async function pullWavePebbles({
  anchors = KNOWN_CHAIN_ANCHORS,
  fetchTxs = fetchRecentWalletTransactions,
  fetchCalldata = fetchTxCalldataHex,
  limit = 40,
} = {}) {
  const txs = await fetchTxs(undefined, { limit, maxPages: 2 });
  const parsed = new Set();
  const pebbles = [];
  const take = (hex, hash) => {
    const h = String(hash || "");
    if (!TX_RE.test(h)) return;
    const key = h.toLowerCase();
    if (parsed.has(key)) return;
    parsed.add(key);
    pebbles.push(...pebblesFromCalldata(hex, h));
  };
  let extra = 0;
  for (const tx of txs || []) {
    if (tx?.input) take(tx.input, tx.hash);
    else if (extra < 8 && TX_RE.test(String(tx?.hash || ""))) {
      extra += 1;
      take(await fetchCalldata(tx.hash), tx.hash);
    }
  }
  for (const anchor of anchors || []) {
    const hash = anchor?.tx || anchor;
    if (parsed.has(String(hash || "").toLowerCase())) continue;
    take(await fetchCalldata(hash), hash);
  }
  return {
    anchors: (anchors || []).length,
    trails: (txs || []).length,
    whl: pebbles.length,
    pebbles,
  };
}
