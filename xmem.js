/**
 * XMEM v1 — searchable on-chain memory overlay for Base hitch UTF-8
 * ─────────────────────────────────────────────────────────────────────────────
 * Live leftover hitch stays dense VITA KEY+LOC (`§$STORE§ §KEY§…§LOC§…`).
 * Cuborg could not find Eureka/Kai/Koda/Krystian because it searched token
 * transfers, not UTF-8 input data (including swap-prefix garbage / mojibake).
 *
 * This module:
 *   - encodes/parses canonical XMEM|v1|k=v records
 *   - adapts existing STORE / §KEY§ / §LOC§ / CUBORG-MEMORY payloads
 *   - searches by prefix → ns → type → id → tags → note → ref
 *   - never invents missing fields; append-only (no overwrite helper)
 *
 * x402 = authenticated / verified retrieval (webhook secret).
 * x404 = unresolved pointer / no match (do not invent a record).
 *
 * Payment leg is the leftover-covered swap (LOSE-ZERO). Memory rides input
 * data. Large media stays off-chain; ref holds a pointer. Live hitch encoding
 * is unchanged — XMEM is the retrieval + agent handoff layer.
 */

import { parseVitaPacket } from "./vita-parse.js";

export const XMEM_PREFIX = "XMEM";
export const XMEM_VERSION = "v1";
export const CUBORG_PREFIX = "CUBORG-MEMORY";

export const XMEM_TYPES = Object.freeze([
  "trade", "intent", "signal", "summary", "link", "warning", "note", "media", "memory",
]);

export const XMEM_STATES = Object.freeze(["pending", "active", "settled"]);

export const XMEM_FIELD_KEYS = Object.freeze([
  "ns", "type", "id", "tags", "ref", "state", "target", "note", "src", "role", "scope",
]);

/** Love-note names already hitch in §KEY§ — search even if order/spelling drifts. */
export const XMEM_LOVE_TAGS = Object.freeze(["eureka", "kai", "koda", "krystian"]);

export const XMEM_NAME_ALIASES = Object.freeze({
  eureka: ["eureka", "eureeka", "eureca"],
  kai: ["kai", "kay"],
  koda: ["koda", "coda"],
  krystian: ["krystian", "kristian", "krystan", "christian"],
});

const PIPE = "|";
const XMEM_LINE_RE = /(?:XMEM|CUBORG-MEMORY)\|v\d+\|[^\n\r]*/i;
const STORE_MARK_RE = /(?:§\$STORE§|\$STORE\$|Â§\$STOREÂ§)/;
const KEY_TOKEN_RE = /(?:§KEY§|Â§KEYÂ§)/i;
const HEX_RE = /^0x[0-9a-fA-F]+$/i;
const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;

export const AGENT_INSTRUCTIONS = `SYSTEM: XMEM v1 retrieval and logging protocol

GOAL:
Store and retrieve small searchable memory records from Base transaction input data (UTF-8 hitch / dedicated 0-ETH calldata). Do not search token transfer lists for text — decode input data as UTF-8, including trailers after Uniswap exactInputSingle (228 bytes) and Latin-1 mojibake of UTF-8.

RECORD FORMAT:
XMEM|v1|ns=<namespace>|type=<type>|id=<unique_id>|tags=<tag1,tag2,tag3>|ref=<ref>|state=<state>|target=<target>|note=<short_text>

REQUIRED FIELDS (new writes):
- prefix: XMEM
- version: v1
- ns: namespace (e.g. base-trade, media, intent)
- type: trade|intent|signal|summary|link|warning|note|media|memory
- id: unique stable id
- tags: comma-separated lowercase tags
- note: short human-readable text (no raw | pipes)

OPTIONAL FIELDS:
- ref: tx hash, address, prior record id, IPFS/HTTPS pointer
- state: pending|active|settled
- target: price, condition, or milestone (label only — not a trading signal executor)
- src, role, scope

LEGACY LIVE HITCH (already on Base leftover swaps — map, do not rewrite):
§$STORE§ §KEY§eureka♥Krystian,Kai,Koda§LOC§n=<count>|t=<tip>|r=<root>
Treat STORE/KEY/LOC as an XMEM overlay: ns=base-trade type=trade tags from KEY names, ref=LOC. Never invent an id for legacy records.

WRITE RULES:
- Append-only. Never overwrite chain history.
- Keep on-chain records short (prefer < 256 bytes). Clip note to leftover budget.
- Live leftover hitch stays KEY+LOC (denser). XMEM is for dedicated notes + retrieval.
- Large media: upload off-chain; store pointer in ref. On-chain = proof/timestamp/index.
- Prefer lowercase tags. Unique id per new record.
- Do not lose money to insert storage (LOSE-ZERO / leftover cover).

READ RULES:
1. Search prefix XMEM (and STORE / CUBORG-MEMORY / §KEY§)
2. Filter ns, type, id, tags, ref, note
3. Missing fields are absent, not empty
4. Prefer exact id matches
5. Tags case-insensitive; name fragments match any order
6. Repair UTF-8 mojibake (Â§ → §) before parse
7. Do not invent missing values. Do not assume a match without evidence.

QUERY EXAMPLES:
- find all XMEM records
- load record id=<id>
- list records tagged koda
- list records in namespace base-trade
- show records referencing <ref>
- search eureka kai koda krystian (any order)

OUTPUT:
Return matched records with id, ns, type, tags, ref, state, target, note, source, txHash when known.

LINKS:
- x402 = authenticated / verified retrieval (webhook secret on GET /vita/xmem)
- x404 = unresolved / no match — return found=false, never a fake record

SAFETY:
- Do not invent missing values
- Do not modify chain history
- Do not assume records exist unless found
- Do not design profit-extraction or market-manipulation around hitch bytes
`;

export const AGENT_SPEC = Object.freeze({
  protocol: XMEM_PREFIX,
  version: XMEM_VERSION,
  payload: "XMEM|v1|ns=<namespace>|type=<type>|id=<unique_id>|tags=<tag1,tag2>|ref=<ref>|state=<state>|target=<target>|note=<text>",
  requiredWrite: ["prefix", "version", "ns", "type", "id", "tags", "note"],
  optional: ["ref", "state", "target", "src", "role", "scope"],
  types: XMEM_TYPES,
  states: XMEM_STATES,
  liveHitch: "leftover KEY+LOC under §$STORE§ — XMEM overlays retrieval, does not replace leftover encoding",
  searchOrder: ["prefix", "ns", "type", "id", "tags", "note", "ref"],
  links: {
    x402: "authenticated retrieval / verified request",
    x404: "pointer missing / unresolved / fallback",
  },
  wallet: "0x50e1C4608c48b0c52E1EA5FBabc1c9126eA17915",
  chain: "base",
  endpoints: {
    spec: "GET /vita/xmem/spec",
    decode: "GET|POST /vita/xmem/decode",
    search: "GET /vita/xmem (x402 — secret)",
    telegram: "/xmem [query]",
  },
});

function utf8Bytes(text) {
  const s = String(text || "");
  if (typeof Buffer !== "undefined") return Buffer.byteLength(s, "utf8");
  return new TextEncoder().encode(s).length;
}

function latin1ToUtf8(text) {
  const s = String(text || "");
  if (typeof Buffer !== "undefined") return Buffer.from(s, "latin1").toString("utf8");
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i) & 0xff;
  return new TextDecoder("utf-8").decode(bytes);
}

function hexToUtf8(body) {
  if (typeof Buffer !== "undefined") return Buffer.from(body, "hex").toString("utf8");
  const bytes = new Uint8Array(body.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(body.slice(i * 2, i * 2 + 2), 16);
  return new TextDecoder("utf-8").decode(bytes);
}

function looksLikeHexCalldata(data) {
  const s = String(data || "").trim();
  return HEX_RE.test(s) && s.length >= 10;
}

function decodeHexUtf8(hex) {
  const body = String(hex || "").replace(/^0x/i, "");
  if (!body || body.length % 2) return "";
  try {
    return hexToUtf8(body);
  } catch {
    return "";
  }
}

/** Latin-1 / Windows-1252 view of UTF-8 (Â§$STOREÂ§, â™¥) → real UTF-8. */
export function repairUtf8Mojibake(text) {
  const s = String(text || "");
  if (!s) return s;
  if (s.includes("§") && s.includes("§$STORE§")) return s;
  if (!/Â§|â™¥|Ã.|Â /.test(s)) return s;
  try {
    const repaired = latin1ToUtf8(s);
    if (repaired.includes("§") || repaired.includes("♥") || /XMEM\|/i.test(repaired)) {
      return repaired;
    }
  } catch { /* keep original */ }
  return s;
}

export function findMemorySlice(text) {
  const s = repairUtf8Mojibake(String(text || ""));
  if (!s) return "";
  const idxs = [];
  const push = (i) => { if (i >= 0) idxs.push(i); };
  push(s.indexOf("§$STORE§"));
  push(s.search(/XMEM\|v\d+/i));
  push(s.search(/CUBORG-MEMORY\|/i));
  push(s.search(/\$STORE\$/));
  push(s.search(/(?:^|[^A-Za-z])STORE\s+KEY\s+/i));
  push(s.search(/§(SESS|WHO|STACK|BUILT|PROVED|ARCH|VISION|NEXT|KEY|LEARN|LOC|HAT)§/));
  if (!idxs.length) return "";
  return s.slice(Math.min(...idxs));
}

export function decodeCalldataUtf8(input) {
  const raw = String(input || "");
  if (!raw || raw === "0x") return "";
  if (looksLikeHexCalldata(raw)) return decodeHexUtf8(raw);
  return raw;
}

function sanitizeValue(value) {
  return String(value ?? "")
    .replace(/\|/g, "/")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTags(tags) {
  const src = Array.isArray(tags)
    ? tags
    : String(tags || "").split(",");
  const out = [];
  const seen = new Set();
  for (const t of src) {
    const tag = String(t || "").trim().toLowerCase().replace(/\s+/g, "-");
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

function omitEmpty(record) {
  const out = {};
  for (const [k, v] of Object.entries(record)) {
    if (v == null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (typeof v === "string" && v === "") continue;
    out[k] = v;
  }
  return out;
}

/**
 * Encode a new XMEM record. Missing required fields → { ok:false }.
 * Does not invent ids.
 */
export function encodeXmem(fields = {}, { requireId = true, maxBytes = null } = {}) {
  const ns = sanitizeValue(fields.ns);
  const type = sanitizeValue(fields.type).toLowerCase();
  const id = sanitizeValue(fields.id);
  const note = sanitizeValue(fields.note);
  const tags = normalizeTags(fields.tags);
  if (!ns) return { ok: false, error: "ns required", packed: "" };
  if (!type) return { ok: false, error: "type required", packed: "" };
  if (requireId && !id) return { ok: false, error: "id required — do not invent", packed: "" };
  if (!note && !tags.length && !sanitizeValue(fields.ref)) {
    return { ok: false, error: "note, tags, or ref required", packed: "" };
  }

  const parts = [XMEM_PREFIX, XMEM_VERSION, `ns=${ns}`, `type=${type}`];
  if (id) parts.push(`id=${id}`);
  if (tags.length) parts.push(`tags=${tags.join(",")}`);
  for (const key of ["ref", "state", "target", "src", "role", "scope"]) {
    const val = sanitizeValue(fields[key]);
    if (val) parts.push(`${key}=${val}`);
  }
  if (note) parts.push(`note=${note}`);
  let packed = parts.join(PIPE);
  if (maxBytes != null) packed = clipPackedToBudget(packed, maxBytes);
  return { ok: Boolean(packed), packed, bytes: utf8Bytes(packed) };
}

function clipPackedToBudget(packed, maxBytes) {
  const cap = Math.floor(Number(maxBytes));
  if (!Number.isFinite(cap) || cap <= 0) return "";
  if (utf8Bytes(packed) <= cap) return packed;
  const parsed = parseXmemLine(packed);
  if (!parsed) return "";
  let note = parsed.note || "";
  let tags = Array.isArray(parsed.tags) ? parsed.tags.slice() : [];
  while (utf8Bytes(encodeXmem({ ...parsed, note, tags }, { requireId: false }).packed) > cap) {
    if (note.length > 8) {
      note = note.slice(0, Math.max(0, note.length - 8)).trim();
      continue;
    }
    if (tags.length > 1) {
      tags.pop();
      continue;
    }
    if (note) {
      note = "";
      continue;
    }
    break;
  }
  const next = encodeXmem({ ...parsed, note, tags }, { requireId: false });
  if (!next.ok || utf8Bytes(next.packed) > cap) return "";
  return next.packed;
}

export function clipXmemToBudget(fields, maxBytes) {
  const encoded = encodeXmem(fields, { requireId: false });
  if (!encoded.ok) return encoded;
  const packed = clipPackedToBudget(encoded.packed, maxBytes);
  return { ok: Boolean(packed), packed, bytes: utf8Bytes(packed) };
}

export function parseXmemLine(text) {
  const raw = String(text || "").trim();
  const m = raw.match(XMEM_LINE_RE);
  if (!m) return null;
  const line = m[0].trim();
  const parts = line.split(PIPE);
  if (parts.length < 2) return null;
  const prefix = parts[0].toUpperCase() === CUBORG_PREFIX ? XMEM_PREFIX : parts[0].toUpperCase();
  if (prefix !== XMEM_PREFIX && parts[0].toUpperCase() !== CUBORG_PREFIX) return null;
  const version = String(parts[1] || "").toLowerCase();
  if (!/^v\d+$/.test(version)) return null;
  const rec = { prefix: XMEM_PREFIX, version, source: parts[0].toUpperCase() === CUBORG_PREFIX ? "cuborg-memory" : "xmem" };
  for (let i = 2; i < parts.length; i++) {
    const chunk = parts[i];
    const eq = chunk.indexOf("=");
    if (eq <= 0) continue;
    const key = chunk.slice(0, eq).trim().toLowerCase();
    const val = chunk.slice(eq + 1).trim();
    if (!XMEM_FIELD_KEYS.includes(key) || !val) continue;
    rec[key] = key === "tags" ? normalizeTags(val) : val;
  }
  if (rec.source === "cuborg-memory" && !rec.ns) rec.ns = "cuborg";
  if (!rec.ns && !rec.type && !rec.id && !rec.note && !rec.tags) return null;
  return omitEmpty(rec);
}

function tagsFromKeyText(key) {
  const hay = String(key || "");
  const tags = [];
  for (const name of XMEM_LOVE_TAGS) {
    if (hay.toLowerCase().includes(name) || aliasesHit(hay, name)) tags.push(name);
  }
  return tags;
}

function aliasesHit(hay, name) {
  const h = normalizeText(hay);
  for (const alias of XMEM_NAME_ALIASES[name] || [name]) {
    if (h.includes(alias)) return true;
  }
  return false;
}

export function xmemFromStoreKeyLoc(utf8, meta = {}) {
  const slice = findMemorySlice(utf8) || String(utf8 || "");
  if (!slice) return null;
  const repaired = repairUtf8Mojibake(slice);
  const hasStore = STORE_MARK_RE.test(repaired) || /STORE\s+KEY/i.test(repaired) || KEY_TOKEN_RE.test(repaired);
  if (!hasStore && !/§KEY§/.test(repaired) && !/KEY\s+eureka/i.test(repaired)) return null;
  const vita = parseVitaPacket(repaired.replace(/STORE\s+KEY/i, "§KEY§").replace(/\s+LOC\s+/i, "§LOC§"));
  let key = vita.fields.KEY || "";
  let loc = vita.fields.LOC || "";
  if (!key) {
    const km = repaired.match(/(?:§KEY§|KEY)\s*([^\n§]+?)(?=(?:§LOC§|\sLOC\s|$))/i);
    if (km) key = km[1].replace(/^[:\s]+/, "").trim();
  }
  if (!loc) {
    const lm = repaired.match(/(?:§LOC§|LOC)\s*(n=\d+[^\n§]*)/i);
    if (lm) loc = lm[1].trim();
  }
  if (!key && !loc) return null;
  // Tags only from a real KEY payload — never invent names from VITA_KEY_NAMES.
  const tags = tagsFromKeyText(key);
  return omitEmpty({
    prefix: XMEM_PREFIX,
    version: XMEM_VERSION,
    ns: "base-trade",
    type: "trade",
    tags,
    ref: loc || meta.txHash || undefined,
    note: key || undefined,
    source: "store-key-loc",
    txHash: TX_HASH_RE.test(String(meta.txHash || "")) ? meta.txHash : undefined,
    timestamp: meta.timestamp || undefined,
  });
}

export function parseAnyMemory(text, meta = {}) {
  const slice = findMemorySlice(text) || String(text || "");
  if (!slice) return [];
  const repaired = repairUtf8Mojibake(slice);
  const records = [];
  const seen = new Set();
  const push = (rec) => {
    if (!rec) return;
    const key = JSON.stringify({
      id: rec.id || "",
      note: rec.note || "",
      tags: rec.tags || [],
      ref: rec.ref || "",
      source: rec.source || "",
    });
    if (seen.has(key)) return;
    seen.add(key);
    records.push(omitEmpty({
      ...rec,
      txHash: rec.txHash || (TX_HASH_RE.test(String(meta.txHash || "")) ? meta.txHash : undefined),
      timestamp: rec.timestamp || meta.timestamp || undefined,
    }));
  };
  const xmemMatch = repaired.match(new RegExp(XMEM_LINE_RE.source, "gi"));
  if (xmemMatch) {
    for (const line of xmemMatch) push(parseXmemLine(line));
  }
  push(xmemFromStoreKeyLoc(repaired, meta));
  return records;
}

export function extractMemoryRecords(input, meta = {}) {
  const utf8 = decodeCalldataUtf8(input);
  const slice = findMemorySlice(utf8) || utf8;
  return parseAnyMemory(slice, meta);
}

export function recordsFromTransactions(txs = []) {
  const records = [];
  for (const tx of txs) {
    const found = extractMemoryRecords(tx.input || tx.raw_input || tx.utf8 || "", {
      txHash: tx.hash,
      timestamp: tx.timestamp,
      to: tx.to,
    });
    for (const rec of found) records.push(rec);
  }
  return records;
}

function normalizeText(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[♥♡❤]/g, " ")
    .replace(/[^a-z0-9,=|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function recordBlob(rec) {
  const tags = Array.isArray(rec.tags) ? rec.tags.join(",") : (rec.tags || "");
  return normalizeText([
    rec.prefix, rec.version, rec.ns, rec.type, rec.id, tags,
    rec.ref, rec.state, rec.target, rec.note, rec.source, rec.txHash,
  ].filter(Boolean).join(" "));
}

export function parseXmemQuery(raw) {
  const q = String(raw || "").trim();
  const out = { raw: q };
  if (!q || /^(all|find all xmem( records)?|list all)$/i.test(q)) {
    out.prefix = XMEM_PREFIX;
    return out;
  }
  const id = q.match(/\bid\s*=\s*([A-Za-z0-9._:-]+)/i);
  if (id) out.id = id[1];
  const ns = q.match(/\bns\s*=\s*([A-Za-z0-9._:-]+)/i);
  if (ns) out.ns = ns[1];
  const nsWord = q.match(/\bnamespace\s+([A-Za-z0-9._:-]+)/i);
  if (nsWord) out.ns = nsWord[1];
  const type = q.match(/\btype\s*=\s*([A-Za-z0-9._:-]+)/i);
  if (type) out.type = type[1].toLowerCase();
  const ref = q.match(/\bref\s*=\s*(\S+)/i);
  if (ref) out.ref = ref[1].replace(/[|,]$/, "");
  const tagged = q.match(/\b(?:tag(?:ged|s)?)\s+(?:with\s+)?([A-Za-z0-9,_-]+)/i);
  if (tagged) out.tags = normalizeTags(tagged[1]);
  const tagEq = q.match(/\btags?\s*=\s*([A-Za-z0-9,_-]+)/i);
  if (tagEq) out.tags = normalizeTags([...(out.tags || []), ...tagEq[1].split(",")]);
  const leftover = q
    .replace(/\b(find|show|list|load|search|records?|memory|xmem|tagged|tag|namespace|in|for|all|with|containing|mentioning)\b/gi, " ")
    .replace(/\b(id|ns|type|ref|tags?)\s*=\s*\S+/gi, " ")
    .trim();
  if (leftover) {
    const fragments = leftover.split(/[\s,]+/).map((s) => s.trim()).filter((s) => s.length >= 2);
    if (fragments.length) out.fragments = fragments.map((s) => s.toLowerCase());
  }
  if (out.id || out.ns || out.type || out.tags || out.ref || out.fragments) return out;
  out.fragments = q.toLowerCase().split(/[\s,]+/).filter(Boolean);
  return out;
}

function tagMatches(recTags, want) {
  const have = new Set((recTags || []).map((t) => String(t).toLowerCase()));
  const blob = have;
  return want.every((t) => {
    const w = String(t).toLowerCase();
    if (blob.has(w)) return true;
    for (const [canon, aliases] of Object.entries(XMEM_NAME_ALIASES)) {
      if (aliases.includes(w) && (blob.has(canon) || aliases.some((a) => blob.has(a)))) return true;
    }
    return false;
  });
}

function fragmentsMatchRecord(rec, fragments) {
  const blob = recordBlob(rec);
  return fragments.every((frag) => {
    const f = normalizeText(frag);
    if (!f) return true;
    if (blob.includes(f)) return true;
    for (const [canon, aliases] of Object.entries(XMEM_NAME_ALIASES)) {
      if (aliases.includes(f) || f === canon) {
        if (aliases.some((a) => blob.includes(a)) || blob.includes(canon)) return true;
      }
    }
    if (f.length >= 4) {
      for (const token of blob.split(" ")) {
        if (token.includes(f) || f.includes(token) && token.length >= 4) return true;
      }
    }
    return false;
  });
}

/**
 * Filter records. Missing query fields are not treated as empty equals.
 * Exact id wins; otherwise Cuborg search order.
 */
export function searchXmem(records, query) {
  const parsed = typeof query === "string" ? parseXmemQuery(query) : (query || {});
  const rows = Array.isArray(records) ? records : [];
  if (parsed.id) {
    const exact = rows.filter((r) => String(r.id || "") === parsed.id);
    return { parsed, matches: exact, exactId: true };
  }
  const matches = rows.filter((r) => {
    if (parsed.ns && String(r.ns || "").toLowerCase() !== String(parsed.ns).toLowerCase()) return false;
    if (parsed.type && String(r.type || "").toLowerCase() !== String(parsed.type).toLowerCase()) return false;
    if (parsed.ref) {
      const ref = String(r.ref || "").toLowerCase();
      const tx = String(r.txHash || "").toLowerCase();
      const want = String(parsed.ref).toLowerCase();
      if (!ref.includes(want) && !tx.includes(want)) return false;
    }
    if (parsed.tags && parsed.tags.length && !tagMatches(r.tags, parsed.tags)) return false;
    if (parsed.fragments && parsed.fragments.length && !fragmentsMatchRecord(r, parsed.fragments)) return false;
    return true;
  });
  return { parsed, matches, exactId: false };
}

export function retrieveXmem(records, query, { protocol = "xmem" } = {}) {
  const { parsed, matches, exactId } = searchXmem(records, query);
  if (!matches.length) {
    return {
      ok: true,
      found: false,
      protocol: "x404",
      count: 0,
      records: [],
      query: parsed,
      fallback: "Search XMEM prefix, then STORE/KEY/LOC hitch UTF-8, then tags, then note. Do not invent a record.",
    };
  }
  return {
    ok: true,
    found: true,
    protocol,
    count: matches.length,
    exactId,
    records: matches.map((r) => omitEmpty({
      id: r.id,
      ns: r.ns,
      type: r.type,
      tags: r.tags,
      ref: r.ref,
      state: r.state,
      target: r.target,
      note: r.note,
      source: r.source,
      txHash: r.txHash,
      timestamp: r.timestamp,
    })),
    query: parsed,
  };
}

export function formatXmemMatches(result, { max = 8 } = {}) {
  if (!result?.found) {
    return (
      "XMEM x404 — no records matched.\n" +
      "Search UTF-8 input data for XMEM, §$STORE§, §KEY§, then tags.\n" +
      "Do not invent values. Live leftover hitch is KEY+LOC, not transfer lists."
    );
  }
  const rows = (result.records || []).slice(0, max);
  const lines = [
    `XMEM ${result.protocol} — ${result.count} record(s)` + (result.exactId ? " (exact id)" : ""),
  ];
  for (const r of rows) {
    const tags = Array.isArray(r.tags) ? r.tags.join(",") : "";
    lines.push(
      [r.id && `id=${r.id}`, r.ns && `ns=${r.ns}`, r.type && `type=${r.type}`, tags && `tags=${tags}`]
        .filter(Boolean)
        .join(" "),
    );
    if (r.note) lines.push("  note " + r.note);
    if (r.ref) lines.push("  ref " + r.ref);
    if (r.txHash) lines.push("  tx " + r.txHash);
  }
  if (result.count > rows.length) lines.push(`… ${result.count - rows.length} more`);
  return lines.join("\n");
}

export function xmemHelpText() {
  return [
    "XMEM v1 — search Base UTF-8 input data (not token transfers).",
    "Live leftover hitch is §$STORE§ KEY+LOC. XMEM overlays retrieval.",
    "",
    "/xmem koda",
    "/xmem id=20260912-0001",
    "/xmem ns=base-trade tags=eureka,krystian",
    "/xmem spec",
    "/xmem encode ns=base-trade type=note id=demo-1 tags=koda note=hello",
    "",
    "Agents: GET /vita/xmem/spec  ·  decode pasted hitch: /vita/xmem/decode",
    "x402 = authenticated chain search  ·  x404 = not found (do not invent)",
  ].join("\n");
}

export function parseEncodeCommand(raw) {
  const s = String(raw || "").trim();
  const fields = {};
  const re = /\b(ns|type|id|tags|ref|state|target|note|src|role|scope)\s*=\s*("[^"]*"|'[^']*'|\S+)/gi;
  let m;
  while ((m = re.exec(s))) {
    fields[m[1].toLowerCase()] = String(m[2] || "").replace(/^["']|["']$/g, "");
  }
  return fields;
}
