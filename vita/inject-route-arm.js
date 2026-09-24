/**
 * Inject route arm — our Data-field writer and reader.
 *
 * The hitch is calldata on a swap we already send. A bake-off picks the
 * verified codec whose UTF-8 wire is smallest. Identity stays when a
 * codec does not pay for itself. Chains compete only after a real gas
 * quote. A seat with no chain id waits. Nothing here sends a transaction.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CODECS } from "./compression/codecs.js";
import { runAllCompressions } from "./compression/index.js";
import { MULTICHAIN_SEATS } from "./multichain-portfolio.js";

export const INJECT_ROUTE_ID = "inject-route-arm-v1";
export const INJECT_METHOD = "data-field";
export const INJECT_OWNER = "vita";
export const INJECT_MAGIC = "§IX§v1";
export const INJECT_ROUTE_FILE = "vita/memory/inject-route-book.json";
export const DATA_GAS_PER_BYTE = 16;
export const MAX_QUOTES = 96;

function num(v, d = NaN) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function seatById(id) {
  return MULTICHAIN_SEATS.find((s) => s.id === String(id || "").toLowerCase()) || null;
}

export function createInjectRouteBook(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const quotes = (Array.isArray(src.quotes) ? src.quotes : [])
    .map((q) => {
      const seat = seatById(q?.chain);
      const gwei = num(q?.gwei);
      if (!seat || seat.chainId == null || !(gwei > 0)) return null;
      const l1 = num(q.l1DataFeeEth, 0);
      const ms = num(q.inclusionMs);
      return {
        chain: seat.id,
        chainId: seat.chainId,
        gwei,
        l1DataFeeEth: l1 > 0 ? l1 : 0,
        inclusionMs: ms > 0 ? ms : null,
        at: q.at || null,
      };
    })
    .filter(Boolean)
    .slice(-MAX_QUOTES);
  return { id: INJECT_ROUTE_ID, owner: INJECT_OWNER, method: INJECT_METHOD, quotes, updatedAt: src.updatedAt || null };
}

export function loadInjectRouteBook({ cwd = process.cwd() } = {}) {
  const path = join(cwd, INJECT_ROUTE_FILE);
  if (!existsSync(path)) return createInjectRouteBook();
  try {
    return createInjectRouteBook(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return createInjectRouteBook();
  }
}

export function saveInjectRouteBook(book, { cwd = process.cwd() } = {}) {
  const path = join(cwd, INJECT_ROUTE_FILE);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(book, null, 2));
  renameSync(tmp, path);
  return path;
}

export function fileRouteQuote(book, quote) {
  const seat = seatById(quote?.chain);
  const gwei = num(quote?.gwei);
  if (!seat || seat.chainId == null) return { ok: false, reason: "chain has no id" };
  if (!(gwei > 0)) return { ok: false, reason: "gwei missing" };
  const l1 = num(quote.l1DataFeeEth, 0);
  const ms = num(quote.inclusionMs);
  book.quotes.push({
    chain: seat.id,
    chainId: seat.chainId,
    gwei,
    l1DataFeeEth: l1 > 0 ? l1 : 0,
    inclusionMs: ms > 0 ? ms : null,
    at: quote.at || new Date().toISOString(),
  });
  while (book.quotes.length > MAX_QUOTES) book.quotes.shift();
  book.updatedAt = new Date().toISOString();
  return { ok: true, chain: seat.id, gwei };
}

export function latestQuotes(book) {
  const map = new Map();
  for (const q of book?.quotes || []) map.set(q.chain, q);
  return [...map.values()];
}

export function contestFromHistory(samples, gwei) {
  const xs = (samples || []).map(Number).filter((n) => n > 0).sort((a, b) => a - b);
  if (xs.length < 3 || !(gwei > 0)) return 1;
  const mid = xs[Math.floor(xs.length / 2)];
  if (!(mid > 0)) return 1;
  return gwei / mid;
}

/**
 * Bake-off, then keep the wire that is cheapest inside a UTF-8 Data field.
 * Hex-wrapped codecs only win when they beat the raw line.
 */
export function chooseInjectWire(text, { includePython = false } = {}) {
  const raw = String(text || "");
  const rawBytes = Buffer.byteLength(raw, "utf8");
  const bench = rawBytes
    ? runAllCompressions(Buffer.from(raw, "utf8"), { includePython })
    : { best: null, rows: [] };
  let best = {
    codec: "identity-v1",
    wire: raw,
    wireBytes: rawBytes,
    indexedCodec: bench.best?.id || "identity-v1",
    indexedBytes: bench.best?.payloadBytes ?? rawBytes,
    method: INJECT_METHOD,
    owner: INJECT_OWNER,
  };
  for (const row of bench.rows || []) {
    if (row.role === "wire" || row.verified !== true || !row.payload || row.id === "identity-v1") continue;
    const wire = `${INJECT_MAGIC}|codec=${row.id}|${Buffer.from(row.payload).toString("hex")}`;
    const wireBytes = Buffer.byteLength(wire, "utf8");
    if (wireBytes < best.wireBytes) {
      best = {
        codec: row.id,
        wire,
        wireBytes,
        indexedCodec: bench.best?.id || row.id,
        indexedBytes: bench.best?.payloadBytes ?? row.payloadBytes,
        method: INJECT_METHOD,
        owner: INJECT_OWNER,
      };
    }
  }
  return best;
}

export function unwrapInjectDataField(text) {
  const src = String(text || "");
  if (!src.includes(INJECT_MAGIC)) return src;
  return src.replace(
    new RegExp(INJECT_MAGIC.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\|codec=([a-z0-9-]{1,24})\\|([0-9a-fA-F]+)", "g"),
    (full, id, hex) => {
      const codec = CODECS.find((c) => c.id === id);
      if (!codec || hex.length % 2) return full;
      try {
        return Buffer.from(codec.decompress(Buffer.from(hex, "hex"))).toString("utf8");
      } catch {
        return full;
      }
    },
  );
}

export function dataFieldEth({ bytes, gwei, contest = 1, l1DataFeeEth = 0 } = {}) {
  const b = Math.max(0, num(bytes, 0));
  const g = num(gwei);
  const c = num(contest, 1);
  if (!(g >= 0) || !(c > 0)) return null;
  const l2 = b * DATA_GAS_PER_BYTE * g * 1e-9 * c;
  const l1 = num(l1DataFeeEth, 0);
  return l2 + (l1 > 0 ? l1 : 0);
}

export function rankInjectRoutes({ wireBytes, quotes = [], history = [] } = {}) {
  const ranked = [];
  const waiting = [];
  for (const q of quotes || []) {
    const seat = seatById(q?.chain);
    const gwei = num(q?.gwei);
    if (!seat || seat.chainId == null || !(gwei > 0)) {
      waiting.push(String(q?.chain || seat?.id || "unknown"));
      continue;
    }
    const samples = (history || []).filter((h) => h.chain === seat.id).map((h) => h.gwei);
    const contest = q.contest != null && num(q.contest) > 0
      ? num(q.contest)
      : contestFromHistory(samples, gwei);
    const eth = dataFieldEth({
      bytes: wireBytes,
      gwei,
      contest,
      l1DataFeeEth: q.l1DataFeeEth,
    });
    const inclusionMs = num(q.inclusionMs);
    ranked.push({
      chain: seat.id,
      chainId: seat.chainId,
      gwei,
      contest,
      eth,
      inclusionMs: inclusionMs > 0 ? inclusionMs : null,
      method: INJECT_METHOD,
    });
  }
  ranked.sort((a, b) => a.eth - b.eth || (a.inclusionMs ?? 1e15) - (b.inclusionMs ?? 1e15) || a.chain.localeCompare(b.chain));
  return {
    ranked,
    winner: ranked[0] || null,
    waiting,
    method: INJECT_METHOD,
    executes: false,
  };
}

/**
 * Move a cascade seat ahead only when its chain's data-field cost is cheaper.
 * Equal cost keeps the order the caller already ranked.
 */
export function applyRouteOrder(candidates, rows) {
  const cost = new Map((rows || []).map((r) => [r.symbol, r.dataFieldEth]));
  const known = (candidates || []).map((c) => cost.get(c.symbol)).filter((n) => n != null);
  if (known.length < 2) return (candidates || []).slice();
  const lo = Math.min(...known);
  const hi = Math.max(...known);
  if (!(hi > lo * 1.05) && !(hi - lo > 1e-8)) return candidates.slice();
  return candidates
    .map((c, i) => ({ c, i, cost: cost.get(c.symbol) ?? hi }))
    .sort((a, b) => a.cost - b.cost || a.i - b.i)
    .map((x) => x.c);
}

export function rankCascadeByDataRoute(seats, { wireBytes, quotes, history } = {}) {
  const routes = rankInjectRoutes({ wireBytes, quotes, history });
  const byChain = new Map(routes.ranked.map((r) => [r.chain, r]));
  const rows = (seats || []).map((s) => {
    const chain = String(s.chain || "base").toLowerCase();
    const route = byChain.get(chain) || null;
    return {
      symbol: s.symbol,
      chain,
      score: num(s.score ?? s.cascadeBottomScore, 0),
      dataFieldEth: route ? route.eth : null,
      route,
      routeWait: !route,
    };
  });
  return { rows, routes, executes: false, method: INJECT_METHOD };
}

function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function formatInjectRoutes({ wire, routes, book } = {}) {
  const lines = [
    "💉 <b>INJECT ROUTES</b>",
    "Method: our Data field. Owner vita.",
  ];
  if (wire) {
    lines.push(`Codec <b>${esc(wire.codec)}</b> · wire ${wire.wireBytes} B · raw index ${wire.indexedCodec} ${wire.indexedBytes} B`);
  }
  const ranked = routes?.ranked || [];
  if (!ranked.length) {
    lines.push("No chain has a gas quote yet. A route waits until gwei is filed.");
  } else {
    for (const row of ranked.slice(0, 6)) {
      const ms = row.inclusionMs != null ? ` · ${Math.round(row.inclusionMs)} ms` : "";
      lines.push(`${esc(row.chain)} ${row.gwei} gwei · data ${row.eth.toExponential(3)} ETH · contest ${row.contest.toFixed(2)}${ms}`);
    }
    if (routes.winner) lines.push(`Winner <b>${esc(routes.winner.chain)}</b>`);
  }
  if (routes?.waiting?.length) lines.push("Waiting: " + routes.waiting.map(esc).join(", "));
  const n = book?.quotes?.length || 0;
  lines.push(`${n} filed quote(s). Cascade keeps its order until a chain is cheaper.`);
  lines.push("Nothing is sent from this board.");
  return lines.join("\n");
}
