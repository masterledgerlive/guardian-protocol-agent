/**
 * VITA revealer — KEY + LOCS → follow-the-leader stitch → original download.
 *
 * Anyone with the open reader key and the sealed Base locations can rebuild
 * the file like a normal pull. Machine handoff is one denseline anyone can
 * paste or open as `/vita/reveal?key=…&locs=0x…,0x…`.
 *
 * VIN headers already carry prev= / next= (follow-leader). This module walks
 * that chain, verifies order, joins §VITAFILE§ bodies, and returns bytes.
 *
 * Chain status stays availability until real seals — never invent tx hashes.
 * Local fullLines / compression open keys recover before seal.
 */

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  VITAFEED_BASESCAN_TX,
  VITAFEED_READER_PREFIX,
  parseVitaFeedLine,
  reconstructVitaFeedBody,
} from "./vita-feed.js";
import {
  isVitaFileBody,
  parseVitaFileBody,
  reconstructVitaFileFromLines,
} from "./vita-feed-file.js";
import { FORMULA_ID } from "./mainframe.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const MEMORY_DIR = join(HERE, "memory");
const STRANDS_DIR = join(HERE, "strands");

export const REVEAL_ID = "vita-reveal-v1";
export const REVEAL_MAGIC = "§VITAREVEAL§";
export const REVEAL_VERSION = "v1";
export const REVEAL_LABEL = "REVEAL";
export const REVEAL_DIR = "REVEAL";
export const REVEAL_PLAYER = "/vita/reveal";
export const REVEAL_API = "/vita/reveal/pull";
export const REVEAL_DOWNLOAD = "/vita/reveal/download";

function sha256Hex(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function isTxHash(h) {
  return /^0x[0-9a-fA-F]{64}$/.test(String(h || ""));
}

function clip(s, n = 160) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  if (t.length <= n) return t;
  return t.slice(0, Math.max(0, n - 1)) + "…";
}

function ensureDirs() {
  if (!existsSync(MEMORY_DIR)) mkdirSync(MEMORY_DIR, { recursive: true });
  if (!existsSync(STRANDS_DIR)) mkdirSync(STRANDS_DIR, { recursive: true });
}

function readJson(path, fallback) {
  try {
    if (!existsSync(path)) return fallback;
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}

export function revealPaths(opts = {}) {
  return {
    catalog: opts.catalogPath || join(MEMORY_DIR, "reveal-catalog.json"),
    learn: opts.learnPath || join(MEMORY_DIR, "reveal-learn.json"),
    strand: opts.strandPath || join(STRANDS_DIR, "reveal.json"),
  };
}

/**
 * Normalize locs from comma / space / newline lists.
 */
export function parseLocList(raw) {
  const s = String(raw || "").trim();
  if (!s) return [];
  return s
    .split(/[\s,;|]+/)
    .map((t) => t.trim())
    .filter(isTxHash);
}

/**
 * Accept VITAFEED.VIN-… or bare VIN-…
 */
export function normalizeReaderKey(key) {
  const k = String(key || "").trim();
  if (!k) return null;
  if (/^VITAFEED\.VIN-[0-9A-F]+$/i.test(k)) return k.toUpperCase().replace(/^VITAFEED\./i, "VITAFEED.");
  if (/^VIN-[0-9A-F]+$/i.test(k)) return VITAFEED_READER_PREFIX + k.toUpperCase();
  if (/^VITACOMP\./i.test(k)) return k; // compression open key (availability)
  if (/^VITAOPEN\./i.test(k)) return k;
  return k;
}

/**
 * Machine denseline — anyone can read / paste / share.
 * KEY + ordered LOCS (+ optional name/sha for integrity).
 */
export function encodeRevealHandoff({
  key,
  locs = [],
  name = "",
  mime = "",
  sha256 = "",
  chunks = 0,
  vinId = "",
} = {}) {
  const readerKey = normalizeReaderKey(key) || "";
  const cleanLocs = (locs || []).map(String).filter(isTxHash);
  const vin =
    vinId ||
    (readerKey.startsWith(VITAFEED_READER_PREFIX)
      ? readerKey.slice(VITAFEED_READER_PREFIX.length)
      : "");
  const header =
    REVEAL_MAGIC +
    REVEAL_VERSION +
    "|key=" + readerKey +
    (vin ? "|vin=" + vin : "") +
    (name ? "|name=" + encodeURIComponent(name) : "") +
    (mime ? "|mime=" + encodeURIComponent(mime) : "") +
    (sha256 ? "|sha256=" + String(sha256).toLowerCase() : "") +
    (chunks ? "|chunks=" + Number(chunks) : "") +
    "|locs=" + cleanLocs.join(",") +
    "§";
  return {
    ok: true,
    magic: REVEAL_MAGIC,
    version: REVEAL_VERSION,
    key: readerKey,
    vinId: vin || null,
    name: name || null,
    mime: mime || null,
    sha256: sha256 || null,
    chunks: Number(chunks) || cleanLocs.length,
    locations: cleanLocs,
    machine: header,
    denseline:
      "KEY=" + readerKey +
      "|LOCS=" + cleanLocs.join(",") +
      (name ? "|NAME=" + name : "") +
      "|FOLLOW=leader",
    sharePath: buildRevealSharePath({ key: readerKey, locs: cleanLocs, name }),
  };
}

export function parseRevealHandoff(text) {
  const s = String(text || "").trim();
  if (!s) return { ok: false, reason: "empty handoff" };

  // §VITAREVEAL§ denseline
  if (s.startsWith(REVEAL_MAGIC)) {
    const end = s.indexOf("§", REVEAL_MAGIC.length);
    if (end < 0) return { ok: false, reason: "missing REVEAL closer" };
    const head = s.slice(REVEAL_MAGIC.length, end);
    const parts = head.split("|");
    const meta = { version: parts[0] || "" };
    for (let i = 1; i < parts.length; i++) {
      const eq = parts[i].indexOf("=");
      if (eq < 0) continue;
      meta[parts[i].slice(0, eq)] = parts[i].slice(eq + 1);
    }
    let name = meta.name || "";
    let mime = meta.mime || "";
    try {
      if (name) name = decodeURIComponent(name);
      if (mime) mime = decodeURIComponent(mime);
    } catch { /* keep raw */ }
    return {
      ok: true,
      format: "vitareveal",
      key: normalizeReaderKey(meta.key),
      vinId: meta.vin || null,
      name: name || null,
      mime: mime || null,
      sha256: meta.sha256 || null,
      chunks: Number(meta.chunks) || 0,
      locations: parseLocList(meta.locs),
    };
  }

  // KEY=…|LOCS=… denseline (or loose paste)
  if (/KEY=/i.test(s) || /LOCS=/i.test(s) || /VITAFEED\.VIN-/i.test(s)) {
    const row = {};
    for (const piece of s.split(/[|\n]+/)) {
      const eq = piece.indexOf("=");
      if (eq < 0) continue;
      row[piece.slice(0, eq).trim().toUpperCase()] = piece.slice(eq + 1).trim();
    }
    const key = normalizeReaderKey(row.KEY || row.READER || row.READERKEY);
    const locs = parseLocList(row.LOCS || row.LOC || row.LOCATIONS || "");
    // bare key on its own line + locs elsewhere
    const bareKey = s.match(/\b(VITAFEED\.VIN-[0-9A-Fa-f]+|VITACOMP\.[A-Za-z0-9.\-]+)/);
    return {
      ok: Boolean(key || bareKey || locs.length),
      format: "denseline",
      key: key || (bareKey ? normalizeReaderKey(bareKey[1]) : null),
      vinId: row.VIN || null,
      name: row.NAME || null,
      mime: row.MIME || null,
      sha256: row.SHA256 || row.SHA || null,
      chunks: Number(row.CHUNKS) || 0,
      locations: locs,
      reason: key || bareKey || locs.length ? undefined : "need KEY and/or LOCS",
    };
  }

  return { ok: false, reason: "not a reveal handoff — paste §VITAREVEAL§ or KEY=…|LOCS=…" };
}

export function buildRevealSharePath({ key, locs = [], name = "" } = {}) {
  const q = new URLSearchParams();
  if (key) q.set("key", String(key));
  if (locs.length) q.set("locs", locs.filter(isTxHash).join(","));
  if (name) q.set("name", String(name));
  const qs = q.toString();
  return REVEAL_PLAYER + (qs ? "?" + qs : "");
}

/**
 * Walk VIN follow-the-leader: sort by index, verify prev→next chain.
 * Leader = index 1 with prev=00000000 (or lowest index present).
 */
export function followLeaderOrder(utf8Lines = []) {
  const parsed = [];
  for (let i = 0; i < utf8Lines.length; i++) {
    const utf8 = typeof utf8Lines[i] === "string"
      ? utf8Lines[i]
      : utf8Lines[i]?.fullLine || utf8Lines[i]?.line || utf8Lines[i]?.utf8 || "";
    const p = parseVitaFeedLine(utf8);
    if (!p) {
      return {
        ok: false,
        reason: "chunk " + (i + 1) + " is not VITAFEED VIN format — refuse stitch",
        ordered: [],
      };
    }
    parsed.push({ ...p, fullLine: utf8, sourceIndex: i });
  }
  if (!parsed.length) {
    return { ok: false, reason: "no VIN lines to follow", ordered: [] };
  }

  parsed.sort((a, b) => a.index - b.index);
  const total = parsed[0].total;
  const vinId = parsed[0].vinId;
  const gaps = [];
  const broken = [];

  for (let i = 0; i < parsed.length; i++) {
    const row = parsed[i];
    if (row.vinId !== vinId) {
      broken.push({ index: row.index, reason: "vin mismatch " + row.vinId });
    }
    if (row.total !== total) {
      broken.push({ index: row.index, reason: "total mismatch" });
    }
    const expectIndex = i + 1;
    if (row.index !== expectIndex) {
      gaps.push(expectIndex);
    }
    if (i === 0) {
      if (row.prevHash !== "00000000" && row.index === 1) {
        broken.push({ index: row.index, reason: "leader prev should be 00000000" });
      }
    } else {
      const prev = parsed[i - 1];
      const expectNext = prev.nextIndex;
      if (expectNext != null && expectNext !== row.index) {
        broken.push({
          index: row.index,
          reason: "follow-leader break: prev.next=" + prev.nextPtr + " but got " + row.index,
        });
      }
    }
    if (i === parsed.length - 1 && row.nextPtr !== "END" && parsed.length >= total) {
      broken.push({ index: row.index, reason: "last chunk next should be END" });
    }
  }

  const complete = gaps.length === 0 && broken.length === 0 && parsed.length === total;
  return {
    ok: gaps.length === 0 && broken.length === 0,
    complete,
    vinId,
    total,
    ordered: parsed,
    gaps,
    broken,
    leader: parsed[0] || null,
    followTag: "prev→next VIN leader · " + vinId + " · " + parsed.length + "/" + total,
  };
}

/**
 * Pull UTF-8 from sealed locs (Input Data), follow leader, rebuild file.
 */
export async function revealFromKeyAndLocs({
  key = "",
  locs = [],
  lines = null,
  name = "",
  mime = "",
  sha256 = "",
  fetchCalldata = null,
  fetchUtf8 = null,
  label = "REVEAL",
} = {}) {
  const readerKey = normalizeReaderKey(key);
  const cleanLocs = (locs || []).map(String).filter(isTxHash);
  let utf8Lines = Array.isArray(lines) && lines.length
    ? lines.map((l) => (typeof l === "string" ? l : l?.fullLine || l?.line || ""))
    : [];

  // Chain pull when lines missing
  if ((!utf8Lines.length || utf8Lines.length < cleanLocs.length) && cleanLocs.length) {
    const pulled = [];
    for (const tx of cleanLocs) {
      let utf8 = null;
      if (typeof fetchUtf8 === "function") {
        utf8 = await fetchUtf8(tx);
      } else if (typeof fetchCalldata === "function") {
        const hex = await fetchCalldata(tx);
        utf8 = hexToUtf8Loose(hex);
      }
      if (typeof utf8 === "string" && utf8.length) pulled.push(utf8);
    }
    if (pulled.length) utf8Lines = pulled;
  }

  if (!utf8Lines.length) {
    // Compression / open-key availability path (no locs yet)
    if (readerKey && /^VITACOMP\./i.test(readerKey)) {
      try {
        const { verifyCompressionKey } = await import("./compression/index.js");
        const checked = verifyCompressionKey(readerKey);
        if (checked.ok && checked.bytes) {
          const handoff = encodeRevealHandoff({
            key: readerKey,
            locs: cleanLocs,
            name: name || checked.name || "file.bin",
            mime: mime || checked.mime || "application/octet-stream",
            sha256: sha256 || checked.rawHash || "",
            chunks: 0,
          });
          return {
            ok: true,
            mode: "compress-key",
            chainStatus: cleanLocs.length ? "proven" : "availability",
            label,
            readerKey,
            locations: cleanLocs.map(locRow),
            follow: null,
            file: {
              name: name || checked.name || "file.bin",
              mime: mime || checked.mime || "application/octet-stream",
              playKind: "file",
              rawBytes: checked.bytes.length,
              sha256: sha256Hex(checked.bytes),
              data: checked.bytes,
              dataUrl:
                "data:" +
                (mime || checked.mime || "application/octet-stream") +
                ";base64," +
                checked.bytes.toString("base64"),
            },
            handoff,
            downloadPath: REVEAL_DOWNLOAD + "?key=" + encodeURIComponent(readerKey),
            sharePath: handoff.sharePath,
            card: formatRevealCard({
              complete: true,
              mode: "compress-key",
              readerKey,
              fileName: name || checked.name,
              locCount: cleanLocs.length,
              followTag: "availability · compression open key (locs empty until seal)",
              label,
            }),
            neverInventHashes: true,
          };
        }
      } catch {
        /* fall through to local file / catalog */
      }
    }

    // Local availability: catalog row or vita/memory/files/<name>
    const local = tryLocalAvailabilityFile({ key: readerKey, name, sha256 });
    if (local.ok) {
      const handoff = encodeRevealHandoff({
        key: readerKey || ("LOCAL." + local.sha256.slice(0, 8)),
        locs: cleanLocs,
        name: local.name,
        mime: local.mime,
        sha256: local.sha256,
        chunks: 0,
      });
      return {
        ok: true,
        mode: "local-file",
        chainStatus: cleanLocs.length ? "proven" : "availability",
        label,
        readerKey: handoff.key,
        locations: cleanLocs.map(locRow),
        follow: null,
        file: local.file,
        handoff,
        downloadPath:
          REVEAL_DOWNLOAD +
          "?key=" + encodeURIComponent(handoff.key) +
          (local.name ? "&name=" + encodeURIComponent(local.name) : ""),
        sharePath: handoff.sharePath,
        card: formatRevealCard({
          complete: true,
          mode: "local-file",
          readerKey: handoff.key,
          fileName: local.name,
          locCount: cleanLocs.length,
          followTag: "availability · local memory file (locs empty until seal)",
          label,
        }),
        neverInventHashes: true,
      };
    }

    return {
      ok: false,
      reason: cleanLocs.length
        ? "could not pull UTF-8 from locs — need fetchCalldata or local fullLines"
        : "need LOCS (sealed Base hashes) or a VITACOMP open key / local file for availability",
      readerKey,
      locations: cleanLocs.map(locRow),
      neverInventHashes: true,
    };
  }

  const follow = followLeaderOrder(utf8Lines);
  if (!follow.ok && follow.ordered.length === 0) {
    return {
      ok: false,
      reason: follow.reason || "follow-leader refused",
      readerKey,
      locations: cleanLocs.map(locRow),
      neverInventHashes: true,
    };
  }

  const orderedLines = follow.ordered.map((r) => r.fullLine);
  const rebuilt = reconstructVitaFileFromLines(orderedLines);
  let file = null;
  let plainBody = null;

  if (rebuilt.isVitaFile) {
    if (!rebuilt.ok) {
      return {
        ok: false,
        reason: rebuilt.reason || "VITAFILE rebuild failed",
        readerKey,
        follow,
        locations: cleanLocs.map(locRow),
        neverInventHashes: true,
      };
    }
    if (sha256 && rebuilt.sha256 && sha256.toLowerCase() !== rebuilt.sha256.toLowerCase()) {
      return {
        ok: false,
        reason: "sha256 mismatch — refuse corrupt download",
        readerKey,
        follow,
        expected: sha256,
        got: rebuilt.sha256,
        neverInventHashes: true,
      };
    }
    file = {
      name: name || rebuilt.name,
      mime: mime || rebuilt.mime,
      playKind: rebuilt.playKind,
      rawBytes: rebuilt.rawBytes,
      sha256: rebuilt.sha256,
      data: rebuilt.data,
      dataUrl: rebuilt.dataUrl,
      text: rebuilt.text,
    };
  } else if (rebuilt.ok) {
    plainBody = rebuilt.body;
    file = {
      name: name || "body.txt",
      mime: mime || "text/plain",
      playKind: "text",
      rawBytes: Buffer.byteLength(plainBody, "utf8"),
      sha256: sha256Hex(Buffer.from(plainBody, "utf8")),
      data: Buffer.from(plainBody, "utf8"),
      dataUrl: "data:text/plain;base64," + Buffer.from(plainBody, "utf8").toString("base64"),
      text: plainBody,
    };
  } else {
    // Maybe raw joined body is already §VITAFILE§ without needing VIN (local)
    const joined = reconstructVitaFeedBody(orderedLines);
    if (joined.ok && isVitaFileBody(joined.body)) {
      const parsed = parseVitaFileBody(joined.body);
      if (!parsed.ok) {
        return { ok: false, reason: parsed.reason, neverInventHashes: true };
      }
      file = {
        name: name || parsed.name,
        mime: mime || parsed.mime,
        playKind: parsed.playKind,
        rawBytes: parsed.rawBytes,
        sha256: parsed.sha256,
        data: parsed.data,
        dataUrl: parsed.dataUrl,
        text: parsed.text,
      };
    } else {
      return {
        ok: false,
        reason: rebuilt.reason || "could not rebuild body",
        neverInventHashes: true,
      };
    }
  }

  const handoff = encodeRevealHandoff({
    key: readerKey || (follow.vinId ? VITAFEED_READER_PREFIX + follow.vinId : ""),
    locs: cleanLocs,
    name: file.name,
    mime: file.mime,
    sha256: file.sha256,
    chunks: follow.total || orderedLines.length,
    vinId: follow.vinId,
  });

  const complete = follow.complete === true || (
    follow.ordered.length > 0 &&
    follow.gaps.length === 0 &&
    Boolean(file?.data)
  );

  return {
    ok: complete,
    mode: "vitafeed-vin",
    chainStatus: cleanLocs.length ? "proven" : "availability",
    label,
    readerKey: handoff.key,
    vinId: follow.vinId,
    locations: cleanLocs.map((tx, i) => ({
      ...locRow(tx),
      index: follow.ordered[i]?.index ?? i + 1,
      nextPtr: follow.ordered[i]?.nextPtr ?? null,
      prevHash: follow.ordered[i]?.prevHash ?? null,
    })),
    follow: {
      ok: follow.ok,
      complete: follow.complete,
      tag: follow.followTag,
      gaps: follow.gaps,
      broken: follow.broken,
      total: follow.total,
      got: follow.ordered.length,
    },
    file,
    handoff,
    downloadPath:
      REVEAL_DOWNLOAD +
      "?key=" + encodeURIComponent(handoff.key) +
      (cleanLocs.length ? "&locs=" + cleanLocs.join(",") : ""),
    sharePath: handoff.sharePath,
    card: formatRevealCard({
      complete,
      mode: "vitafeed-vin",
      readerKey: handoff.key,
      fileName: file.name,
      locCount: cleanLocs.length,
      followTag: follow.followTag,
      label,
    }),
    neverInventHashes: true,
  };
}

function locRow(tx) {
  return {
    location: tx,
    basescan: VITAFEED_BASESCAN_TX + tx,
    sealed: true,
  };
}

/** Availability fallback — catalog denseline or vita/memory/files/<name>. */
function tryLocalAvailabilityFile({ key = "", name = "", sha256 = "" } = {}) {
  const wantName = String(name || "").trim();
  const catalogHit = key || wantName
    ? (() => {
        try {
          return getRevealCatalogEntry(key || wantName);
        } catch {
          return { ok: false };
        }
      })()
    : { ok: false };

  const candidates = [];
  if (wantName) candidates.push(join(MEMORY_DIR, "files", wantName));
  if (catalogHit.ok && catalogHit.entry?.name) {
    candidates.push(join(MEMORY_DIR, "files", catalogHit.entry.name));
  }
  if (catalogHit.ok && catalogHit.entry?.localPath) {
    const p = catalogHit.entry.localPath;
    candidates.push(p.startsWith("/") ? p : join(HERE, "..", p));
  }
  // Helius default
  candidates.push(join(MEMORY_DIR, "files", "helius-handoff.pdf"));

  for (const path of candidates) {
    try {
      if (!existsSync(path)) continue;
      const data = readFileSync(path);
      if (!data.length) continue;
      const got = sha256Hex(data);
      if (sha256 && sha256.toLowerCase() !== got.toLowerCase()) continue;
      if (catalogHit.ok && catalogHit.entry?.sha256 && catalogHit.entry.sha256.toLowerCase() !== got.toLowerCase()) {
        continue;
      }
      const fname = wantName || catalogHit.entry?.name || path.split("/").pop() || "file.bin";
      const mime =
        catalogHit.entry?.mime ||
        (fname.toLowerCase().endsWith(".pdf") ? "application/pdf" : "application/octet-stream");
      return {
        ok: true,
        name: fname,
        mime,
        sha256: got,
        file: {
          name: fname,
          mime,
          playKind: "file",
          rawBytes: data.length,
          sha256: got,
          data,
          dataUrl: "data:" + mime + ";base64," + data.toString("base64"),
        },
      };
    } catch {
      /* next */
    }
  }
  return { ok: false };
}

function hexToUtf8Loose(hex) {
  let h = String(hex || "").replace(/^0x/i, "");
  if (!h || h.length % 2) return "";
  try {
    return Buffer.from(h, "hex").toString("utf8");
  } catch {
    return "";
  }
}

export function formatRevealCard({
  complete,
  mode,
  readerKey,
  fileName,
  locCount,
  followTag,
  label = "REVEAL",
} = {}) {
  const lines = [];
  lines.push("VITA REVEAL · " + label + (complete ? " · READY" : " · INCOMPLETE"));
  if (readerKey) lines.push("KEY  " + readerKey);
  if (fileName) lines.push("FILE " + fileName);
  lines.push("LOCS " + (locCount || 0) + (mode === "compress-key" ? " (availability until seal)" : " sealed"));
  if (followTag) lines.push("FOLLOW " + followTag);
  lines.push(
    complete
      ? "PULL — stitch follow-leader → download original like a file"
      : "Wait for every VIN loc — never invent a missing hash",
  );
  lines.push("Share: " + REVEAL_PLAYER + "?key=…&locs=0x…");
  return lines.join("\n");
}

/**
 * Format Telegram / dual human+machine reply.
 */
export function formatRevealReply(result) {
  if (!result?.ok && !result?.handoff) {
    return "REVEAL refused — " + (result?.reason || "miss");
  }
  const lines = [];
  lines.push(result.card || "VITA REVEAL");
  lines.push("");
  lines.push("HUMAN denseline (anyone can read):");
  lines.push(result.handoff?.denseline || "—");
  lines.push("");
  lines.push("MACHINE handoff (§VITAREVEAL§):");
  lines.push(clip(result.handoff?.machine || "—", 280));
  lines.push("");
  lines.push("Share link: " + (result.sharePath || REVEAL_PLAYER));
  if (result.downloadPath) lines.push("Download: " + result.downloadPath);
  if (result.locations?.length) {
    lines.push("Basescan Input Data → UTF-8:");
    for (const loc of result.locations.slice(0, 8)) {
      lines.push("  " + (loc.basescan || loc.location));
    }
    if (result.locations.length > 8) {
      lines.push("  … +" + (result.locations.length - 8) + " more");
    }
  }
  return lines.join("\n");
}

/**
 * File a local availability reveal row (before or after seal).
 */
export function fileRevealCatalog(entry = {}, opts = {}) {
  ensureDirs();
  const paths = revealPaths(opts);
  const doc = readJson(paths.catalog, {
    id: REVEAL_ID,
    filingLabel: REVEAL_LABEL,
    formula: FORMULA_ID,
    neverInventHashes: true,
    chainStatus: "availability",
    files: {},
    updatedAt: null,
  });
  const key = normalizeReaderKey(entry.key || entry.readerKey);
  if (!key) return { ok: false, reason: "key required" };
  const locs = (entry.locations || entry.locs || []).filter(isTxHash);
  const handoff = encodeRevealHandoff({
    key,
    locs,
    name: entry.name || "",
    mime: entry.mime || "",
    sha256: entry.sha256 || "",
    chunks: entry.chunks || locs.length,
    vinId: entry.vinId || "",
  });
  const row = {
    key,
    name: entry.name || null,
    mime: entry.mime || null,
    sha256: entry.sha256 || null,
    vinId: entry.vinId || handoff.vinId,
    chunks: entry.chunks || locs.length,
    locations: locs,
    chainStatus: locs.length ? "proven" : "availability",
    compressKey: entry.compressKey || null,
    contentCommit: entry.contentCommit || null,
    rawBytes: entry.rawBytes ?? null,
    handoff: handoff.machine,
    denseline: handoff.denseline,
    sharePath: handoff.sharePath,
    source: entry.source || "file",
    note: entry.note || null,
    at: new Date().toISOString(),
  };
  doc.files[key] = row;
  doc.updatedAt = row.at;
  doc.chainStatus = Object.values(doc.files).some((f) => f.locations?.length)
    ? "mixed"
    : "availability";
  writeJson(paths.catalog, doc);

  const learn = readJson(paths.learn, {
    id: "vita-reveal-learn-v1",
    label: REVEAL_LABEL,
    events: [],
  });
  learn.events.push({
    at: row.at,
    kind: "file",
    key,
    name: row.name,
    locs: locs.length,
    chainStatus: row.chainStatus,
  });
  if (learn.events.length > 200) learn.events = learn.events.slice(-200);
  writeJson(paths.learn, learn);

  writeJson(paths.strand, {
    id: REVEAL_ID,
    filingLabel: REVEAL_LABEL,
    formula: FORMULA_ID,
    neverInventHashes: true,
    ends: [
      "Paste KEY + LOCS (or §VITAREVEAL§ denseline)",
      "Follow VIN prev→next leader headers on Base Input Data",
      "Stitch §VITAFILE§ → download original like a file pull",
    ],
    lastKey: key,
    lastName: row.name,
    files: Object.keys(doc.files).length,
    updatedAt: row.at,
  });

  return { ok: true, entry: row, handoff, catalog: paths.catalog };
}

export function listRevealCatalog(opts = {}) {
  const doc = readJson(revealPaths(opts).catalog, { files: {} });
  return Object.values(doc.files || {}).sort((a, b) =>
    String(b.at || "").localeCompare(String(a.at || "")),
  );
}

export function getRevealCatalogEntry(selector, opts = {}) {
  const raw = String(selector || "").trim();
  if (!raw) return { ok: false, reason: "empty selector" };
  const files = listRevealCatalog(opts);
  const key = normalizeReaderKey(raw);
  const hit =
    files.find((f) => f.key === key) ||
    files.find((f) => f.name && f.name.toLowerCase() === raw.toLowerCase()) ||
    files.find((f) => f.name && f.name.toLowerCase().includes(raw.toLowerCase()));
  if (!hit) return { ok: false, reason: "not in reveal catalog: " + raw };
  return { ok: true, entry: hit };
}

/**
 * Telegram /vitafeed reveal …
 */
export function parseRevealCommand(args = "") {
  const raw = String(args || "").trim();
  if (!raw || /^(help|\?)$/i.test(raw)) {
    return { ok: true, action: "help" };
  }
  if (/^(dir|list|files)$/i.test(raw)) {
    return { ok: true, action: "list" };
  }
  // reveal <name|key>
  const handoff = parseRevealHandoff(raw);
  if (handoff.ok && (handoff.key || handoff.locations?.length)) {
    return { ok: true, action: "pull", ...handoff };
  }
  // reveal key=… locs=…
  const keyMatch = raw.match(/(?:key[=:\s]+)(VITAFEED\.VIN-\S+|VITACOMP\.\S+|VIN-\S+)/i);
  const locsMatch = raw.match(/(?:locs?[=:\s]+)([0-9a-fxX,\s]+)/i);
  if (keyMatch || locsMatch) {
    return {
      ok: true,
      action: "pull",
      key: keyMatch ? normalizeReaderKey(keyMatch[1]) : null,
      locations: locsMatch ? parseLocList(locsMatch[1]) : [],
    };
  }
  return {
    ok: true,
    action: "pull",
    selector: raw,
  };
}

export function formatRevealHelp() {
  return [
    "VITA REVEAL — KEY + LOCS → follow-leader stitch → download original",
    "",
    "  /vitafeed reveal                  — help",
    "  /vitafeed reveal list             — filed handoffs",
    "  /vitafeed reveal <name|key>       — open catalog row",
    "  /vitafeed reveal KEY=…|LOCS=0x…   — paste denseline",
    "  /vitafeed reveal §VITAREVEAL§…    — paste machine handoff",
    "",
    "Share link (anyone): /vita/reveal?key=VITAFEED.VIN-…&locs=0x…,0x…",
    "Download button stitches VIN prev→next then saves the original file.",
    "Basescan each loc → Input Data → View as UTF-8 to read the machine line.",
    "Never invent tx hashes — locs empty until /vitafeed confirm|override seals.",
  ].join("\n");
}

export function formatRevealListCard(opts = {}) {
  const rows = listRevealCatalog(opts);
  const lines = ["VITA:\\REVEAL\\ · " + rows.length + " handoff(s)"];
  if (!rows.length) {
    lines.push("empty — /vitafeed file then confirm|override, or compress add a PDF");
    return lines.join("\n");
  }
  for (const r of rows.slice(0, 24)) {
    lines.push(
      "  " + (r.name || "?") +
      "  · " + (r.chainStatus || "?") +
      "  · locs " + (r.locations?.length || 0) + "/" + (r.chunks || 0) +
      "  · " + (r.key || ""),
    );
  }
  lines.push("Open: /vitafeed reveal <name>  ·  page " + REVEAL_PLAYER);
  return lines.join("\n");
}
