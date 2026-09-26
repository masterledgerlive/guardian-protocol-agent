/**
 * VITAFEED library — named save → list → pull → play from Telegram.
 *
 * Content packets stay on the file VIN chain (§VITAFILE§). Reader keys +
 * names + locations live in this library ("keys chain") so Telegram can
 * list what you sealed and open any row into the Tailwind player instantly.
 *
 * Thin helper. Mother brain / vitaSave / mainframe hitch formula untouched.
 * Never invents tx hashes — only stores real sealed locations + fullLines
 * when the inscribe path already returned them.
 *
 * Keys-catalog wire (optional second seal via /vitafeed keys):
 *   §VITALIB§v1|id=LIB-…|n=N§
 *   name=…|mime=…|play=audio|key=VITAFEED.VIN-…|vin=VIN-…|locs=0x…,0x…|
 */

import { createHash, randomBytes } from "node:crypto";
import { prepareVitaFeed, VITAFEED_READER_PREFIX } from "./vita-feed.js";

export const VITALIB_ID = "vita-feed-library-v1";
export const VITALIB_MAGIC = "§VITALIB§";
export const VITALIB_VERSION = "v1";
export const VITALIB_READER_PREFIX = "VITALIB.";

/** @type {Map<string, object>} id → entry */
const entries = new Map();
/** Display order (append-only). */
const order = [];

function sha256Hex(text) {
  return createHash("sha256").update(String(text || ""), "utf8").digest("hex");
}

function shortHex(hex, n = 8) {
  return String(hex || "").replace(/^0x/i, "").toLowerCase().slice(0, n);
}

function sanitizeName(name) {
  const raw = String(name || "blob.bin").trim() || "blob.bin";
  return raw.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "blob.bin";
}

function isTxHash(h) {
  return /^0x[0-9a-fA-F]{64}$/.test(String(h || ""));
}

export function resetVitaFeedLibrary() {
  entries.clear();
  order.length = 0;
  return 0;
}

export function librarySize() {
  return order.length;
}

export function listLibraryEntries() {
  return order.map((id, i) => {
    const e = entries.get(id);
    return e ? { n: i + 1, ...publicEntry(e) } : null;
  }).filter(Boolean);
}

function publicEntry(e) {
  return {
    id: e.id,
    name: e.name,
    mime: e.mime,
    playKind: e.playKind,
    readerKey: e.readerKey,
    vinId: e.vinId,
    locations: (e.locations || []).slice(),
    locationCount: (e.locations || []).length,
    totalChunks: e.totalChunks || 0,
    rawBytes: e.rawBytes ?? null,
    contentCommit: e.contentCommit || null,
    chatId: e.chatId || null,
    at: e.at,
    hasFullLines: Boolean(e.fullLines?.length),
  };
}

/**
 * Save a sealed strand into the named library.
 * Prefer VITAFILE name; plain text falls back to body.txt / vin id.
 */
export function saveLibraryFromSeal({
  strand = {},
  body = null,
  chatId = null,
  playProof = null,
} = {}) {
  const locs = (strand.locations || [])
    .map((t) => String(t || ""))
    .filter(isTxHash);
  const chunks = strand.chunks || [];
  const fullLines = chunks
    .map((c) => c.fullLine || c.line || null)
    .filter((l) => typeof l === "string" && l.length);

  const file = strand.file || playProof?.file || playProof?.play || null;
  const name = sanitizeName(
    file?.name ||
    (strand.mode === "vitafile" ? "file.bin" : null) ||
    (strand.vinId ? "plain-" + shortHex(strand.vinId, 8) + ".txt" : "body.txt"),
  );
  const mime = file?.mime || (playProof?.play?.mime) || "application/octet-stream";
  const playKind =
    file?.playKind ||
    playProof?.play?.kind ||
    (String(mime).startsWith("audio/")
      ? "audio"
      : String(mime).startsWith("video/")
        ? "video"
        : String(mime).startsWith("image/")
          ? "image"
          : strand.mode === "vitafile"
            ? "file"
            : "text");

  const readerKey =
    strand.readerKey ||
    (strand.vinId ? VITAFEED_READER_PREFIX + strand.vinId : null);
  if (!readerKey && !locs.length && !fullLines.length) {
    return { ok: false, reason: "nothing to save — need reader key, locations, or full lines" };
  }

  // Upsert by readerKey so re-seal of same VIN updates the row.
  let existingId = null;
  if (readerKey) {
    for (const id of order) {
      const row = entries.get(id);
      if (row?.readerKey === readerKey) {
        existingId = id;
        break;
      }
    }
  }

  const id = existingId || ("LIB-" + randomBytes(4).toString("hex").toUpperCase());
  const entry = {
    id,
    name,
    mime,
    playKind,
    readerKey,
    vinId: strand.vinId || null,
    locations: locs,
    totalChunks: strand.totalChunks || chunks.length || locs.length,
    rawBytes: file?.rawBytes ?? playProof?.file?.rawBytes ?? null,
    contentCommit: strand.contentCommit || null,
    fullLines,
    chatId: chatId != null ? String(chatId) : null,
    at: new Date().toISOString(),
    bodyHint: body && String(body).startsWith("§VITAFILE§") ? "vitafile" : body ? "plain" : null,
  };
  entries.set(id, entry);
  if (!existingId) order.push(id);

  const n = order.indexOf(id) + 1;
  return {
    ok: true,
    n,
    entry: publicEntry(entry),
    upserted: Boolean(existingId),
  };
}

/**
 * Resolve by 1-based index, exact name (case-insensitive), reader key, vin, or id.
 */
export function resolveLibraryEntry(selector) {
  const raw = String(selector ?? "").trim();
  if (!raw) return { ok: false, reason: "empty selector — use /vitafeed play <n|name>" };

  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    const id = order[n - 1];
    if (!id) return { ok: false, reason: "no library slot #" + n };
    return { ok: true, n, entry: entries.get(id), public: publicEntry(entries.get(id)) };
  }

  const lower = raw.toLowerCase();
  for (let i = 0; i < order.length; i++) {
    const e = entries.get(order[i]);
    if (!e) continue;
    if (
      e.name.toLowerCase() === lower ||
      e.id.toLowerCase() === lower ||
      (e.readerKey && e.readerKey.toLowerCase() === lower) ||
      (e.vinId && e.vinId.toLowerCase() === lower) ||
      (e.vinId && (VITAFEED_READER_PREFIX + e.vinId).toLowerCase() === lower)
    ) {
      return { ok: true, n: i + 1, entry: e, public: publicEntry(e) };
    }
  }

  // Partial name match (unique)
  const hits = [];
  for (let i = 0; i < order.length; i++) {
    const e = entries.get(order[i]);
    if (e && e.name.toLowerCase().includes(lower)) hits.push({ n: i + 1, entry: e });
  }
  if (hits.length === 1) {
    return {
      ok: true,
      n: hits[0].n,
      entry: hits[0].entry,
      public: publicEntry(hits[0].entry),
    };
  }
  if (hits.length > 1) {
    return {
      ok: false,
      reason: "ambiguous name — match " + hits.map((h) => "#" + h.n + " " + h.entry.name).join(", "),
    };
  }
  return { ok: false, reason: "not found: " + raw };
}

export function formatLibraryListCard({ limit = 40 } = {}) {
  const rows = listLibraryEntries();
  const lines = [];
  lines.push("VITAFEED FILES · " + rows.length + " saved");
  lines.push("Keys chain = name + reader key + locations (quick open)");
  lines.push("Content chain = §VITAFILE§ VIN packets on Base");
  if (!rows.length) {
    lines.push("empty — seal a song/video/file with /vitafeed file then confirm|override");
    lines.push("then /vitafeed files  ·  /vitafeed play <n|name>");
    return lines.join("\n");
  }
  const show = rows.slice(0, Math.max(1, limit));
  for (const r of show) {
    lines.push(
      "#" + r.n + "  " + r.name +
      "  · " + (r.playKind || "?") +
      "  · locs " + (r.locationCount || 0) + "/" + (r.totalChunks || 0) +
      (r.readerKey ? "  · " + r.readerKey : ""),
    );
  }
  if (rows.length > show.length) {
    lines.push("… +" + (rows.length - show.length) + " more");
  }
  lines.push("Open: /vitafeed play <n|name>   or   /vitafeed open <n|name>");
  lines.push("Player: /vita/feed-player?lib=<n>");
  return lines.join("\n");
}

/**
 * Rebuild play proof from a library row (local fullLines preferred).
 * Optional fetchUtf8(txHash) → UTF-8 calldata for chain pull when lines missing.
 */
export async function playFromLibrary(selector, {
  fetchUtf8 = null,
  label = "LIBRARY",
} = {}) {
  const hit = resolveLibraryEntry(selector);
  if (!hit.ok) return { ok: false, reason: hit.reason, reply: hit.reason };

  const e = hit.entry;
  let lines = (e.fullLines || []).slice();
  const locs = (e.locations || []).filter(isTxHash);

  if ((!lines.length || lines.length < (e.totalChunks || 0)) && typeof fetchUtf8 === "function" && locs.length) {
    const pulled = [];
    for (const tx of locs) {
      const utf8 = await fetchUtf8(tx);
      if (typeof utf8 === "string" && utf8.length) pulled.push(utf8);
    }
    if (pulled.length) lines = pulled;
  }

  const { buildVitaFeedPlayProof } = await import("./vita-feed-player.js");
  const strand = {
    vinId: e.vinId,
    readerKey: e.readerKey,
    totalChunks: e.totalChunks || lines.length || locs.length,
    contentCommit: e.contentCommit,
    file: {
      name: e.name,
      mime: e.mime,
      playKind: e.playKind,
      rawBytes: e.rawBytes,
    },
    locations: locs,
    chunks: lines.map((line, i) => ({
      index: i + 1,
      total: lines.length,
      fullLine: line,
      line,
      txHash: locs[i] || null,
      location: locs[i] || null,
      sealed: Boolean(locs[i]),
    })),
  };

  const proof = buildVitaFeedPlayProof({
    strand,
    lines: lines.length ? lines : null,
    label,
  });

  const playerPath =
    "/vita/feed-player?lib=" + encodeURIComponent(String(hit.n)) +
    (e.readerKey ? "&key=" + encodeURIComponent(e.readerKey) : "");

  const reply = [
    "VITAFEED OPEN #" + hit.n + " · " + e.name,
    e.readerKey ? "reader " + e.readerKey : null,
    "locs " + locs.length + "/" + (e.totalChunks || locs.length),
    proof?.card || null,
    proof?.complete
      ? "PLAY — open " + playerPath
      : "IN PROGRESS — need full sealed locations (never invent hashes)",
  ].filter(Boolean).join("\n");

  return {
    ok: proof?.ok !== false && (proof?.complete || lines.length > 0),
    n: hit.n,
    entry: publicEntry(e),
    playProof: proof,
    playerPath,
    reply,
  };
}

/**
 * Encode the keys catalog (names + reader keys + locs) as §VITALIB§ body.
 * This is the "other chain" payload — full code for the reader to quick-access.
 */
export function encodeKeysCatalogBody({ libId = null } = {}) {
  const rows = listLibraryEntries();
  const id = libId || ("LIBCAT-" + shortHex(sha256Hex(String(Date.now())), 8).toUpperCase());
  const header =
    VITALIB_MAGIC + VITALIB_VERSION +
    "|id=" + id +
    "|n=" + rows.length +
    "§";
  const lines = rows.map((r) => {
    const locs = (r.locations || []).filter(isTxHash).join(",");
    return (
      "name=" + encodeURIComponent(r.name) +
      "|mime=" + encodeURIComponent(r.mime || "") +
      "|play=" + (r.playKind || "file") +
      "|key=" + (r.readerKey || "") +
      "|vin=" + (r.vinId || "") +
      "|locs=" + locs +
      "|chunks=" + (r.totalChunks || 0)
    );
  });
  return {
    ok: true,
    libId: id,
    readerKey: VITALIB_READER_PREFIX + id,
    count: rows.length,
    body: header + (lines.length ? "\n" + lines.join("\n") : ""),
  };
}

export function parseKeysCatalogBody(body) {
  const s = String(body ?? "");
  if (!s.startsWith(VITALIB_MAGIC)) {
    return { ok: false, reason: "not §VITALIB§" };
  }
  const end = s.indexOf("§", VITALIB_MAGIC.length);
  if (end < 0) return { ok: false, reason: "missing VITALIB header closer" };
  const head = s.slice(VITALIB_MAGIC.length, end);
  const parts = head.split("|");
  const meta = { version: parts[0] || "" };
  for (let i = 1; i < parts.length; i++) {
    const eq = parts[i].indexOf("=");
    if (eq < 0) continue;
    meta[parts[i].slice(0, eq)] = parts[i].slice(eq + 1);
  }
  const rest = s.slice(end + 1).replace(/^\n/, "");
  const items = [];
  for (const line of rest.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    const row = {};
    for (const piece of t.split("|")) {
      const eq = piece.indexOf("=");
      if (eq < 0) continue;
      const k = piece.slice(0, eq);
      let v = piece.slice(eq + 1);
      if (k === "name" || k === "mime") {
        try { v = decodeURIComponent(v); } catch { /* keep raw */ }
      }
      row[k] = v;
    }
    items.push({
      name: row.name || "blob.bin",
      mime: row.mime || "application/octet-stream",
      playKind: row.play || "file",
      readerKey: row.key || null,
      vinId: row.vin || null,
      locations: String(row.locs || "").split(",").filter(isTxHash),
      totalChunks: Number(row.chunks) || 0,
    });
  }
  return {
    ok: true,
    libId: meta.id || null,
    version: meta.version,
    count: Number(meta.n) || items.length,
    items,
  };
}

/** Stage keys catalog as a normal /vitafeed plain body for RISK seal. */
export function prepareKeysCatalogFeed(opts = {}) {
  const enc = encodeKeysCatalogBody(opts);
  if (!enc.ok) return enc;
  if (!enc.count) {
    return { ok: false, reason: "library empty — seal a file first, then /vitafeed keys" };
  }
  const prepared = prepareVitaFeed(enc.body);
  if (!prepared.ok) return prepared;
  return {
    ...prepared,
    mode: "vitalib",
    keysCatalog: {
      libId: enc.libId,
      readerKey: enc.readerKey,
      count: enc.count,
    },
    file: {
      name: "vitalib-" + enc.libId + ".keys",
      mime: "text/plain",
      playKind: "text",
      rawBytes: Buffer.byteLength(enc.body, "utf8"),
    },
  };
}

/**
 * Import keys from a parsed §VITALIB§ catalog (merge append — never invent locs).
 */
export function importKeysCatalog(parsed, { chatId = null } = {}) {
  if (!parsed?.ok || !parsed.items?.length) {
    return { ok: false, reason: parsed?.reason || "empty catalog" };
  }
  const saved = [];
  for (const item of parsed.items) {
    const r = saveLibraryFromSeal({
      strand: {
        vinId: item.vinId,
        readerKey: item.readerKey,
        locations: item.locations,
        totalChunks: item.totalChunks || item.locations?.length || 0,
        file: {
          name: item.name,
          mime: item.mime,
          playKind: item.playKind,
        },
        mode: "vitafile",
        chunks: [],
      },
      chatId,
    });
    if (r.ok) saved.push(r);
  }
  return { ok: true, imported: saved.length, entries: saved };
}

export function formatKeysCatalogCard(enc) {
  if (!enc?.ok) return "VITALIB keys — nothing to encode";
  return [
    "VITALIB KEYS CHAIN · " + enc.count + " names",
    "catalog id " + enc.libId,
    "reader " + enc.readerKey,
    "This body is the full reader index (name → key → locs).",
    "Seal with /vitafeed confirm|override after /vitafeed keys stages it.",
    "List anytime: /vitafeed files",
  ].join("\n");
}
