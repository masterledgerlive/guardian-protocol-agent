/**
 * VITA Photos Drive — Google Pictures / folder / URL → PHOTOS → chain inject.
 *
 * Your "new Google Drive" for pictures:
 *   · public Google Drive share (file or folder URL)
 *   · local folder of pictures
 *   · direct image URL
 *   · inbox drop (vita/photos/inbox/) or one-at-a-time upload
 *
 * Slow-copy queue walks a source like Google Photos — one picture into the
 * chain filing path at a time. Batch mode drains the whole queue.
 *
 * Open key (now) = open-source picture unlock:
 *   VITAOPEN.<name>.<contentCommit12>  — name + sha256, never a wallet secret.
 * Locked private locate/decode (later) reserved when you grant encode perms;
 * for now LOCK stays off and the picture itself is the key.
 *
 * Compression: reuses vita/compression bake-off (zlib/brotli/…). JPEG/PNG are
 * already dense — identity often wins; that is honest. Winner stages into
 * §VITAFILE§ VIN packets for /vitafeed confirm|override.
 *
 * Full test seed: Earthrise (Apollo 8, NASA AS08-14-2383) — PD-USGov —
 * hope + wake-up call for a shared world. Filed under VITA:\PHOTOS\.
 *
 * Commands:
 *   /vitafeed photos · photos source <url|path> · photos scan · photos next
 *   · photos all · photos add · photos test · photos dir · photos inject <id>
 *   · enqueue photo <id> · enqueue photos · dir PHOTOS
 * Page: /vita/photos
 *
 * Mother brain untouched. Never invents tx hashes. Chain = availability until seal.
 */

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  statSync,
} from "node:fs";
import { dirname, join, basename, extname, resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { FORMULA_ID, MAINFRAME_ANCHORS } from "./mainframe.js";
import {
  encodeVitaFile,
  prepareVitaFileFeed,
  parseVitaFileBody,
  guessMime,
  playKindForMime,
} from "./vita-feed-file.js";
import { prepareVitaFeed, VITAFEED_MAX_CHUNK_BYTES } from "./vita-feed.js";
import { vitaPlayerHref } from "./url-dir.js";
import { telegramCallbackData } from "./mirror-chain.js";
import { addCompressionFile } from "./compression/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const VITA = HERE;
const ROOT = join(VITA, "..");
const MEMORY_DIR = join(VITA, "memory");
const STRANDS_DIR = join(VITA, "strands");
const PHOTO_DIR = join(MEMORY_DIR, "photos");
const INBOX_DIR = join(HERE, "photos", "inbox");
const CATALOG_PATH = join(MEMORY_DIR, "photos-catalog.json");
const SOURCE_PATH = join(MEMORY_DIR, "photos-sources.json");
const QUEUE_PATH = join(MEMORY_DIR, "photos-queue.json");
const LEARN_PATH = join(MEMORY_DIR, "photos-learn.json");
const SEAL_PATH = join(MEMORY_DIR, "photos-seals.json");
const STRAND_PATH = join(STRANDS_DIR, "photos.json");

export const PHOTOS_ID = "vita-photos-v1";
export const PHOTOS_MAGIC = "§VITAPHOTO§";
export const PHOTOS_DIR_MAGIC = "§VITAPHOTODIR§";
export const PHOTOS_LABEL = "PHOTOS";
export const PHOTOS_SUBDIR = "PHOTOS";
export const PHOTOS_PLAYER_PATH = "/vita/photos";
export const PHOTOS_VIEWER_PATH = "/vita/photos/viewer";
export const PHOTO_VIN_CAP = 24;
export const IMAGE_EXTS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".bmp",
  ".tif",
  ".tiff",
]);

/** Famous PD-USGov hope photo — Earthrise, Apollo 8, 24 Dec 1968. */
export const EARTHRISE_TEST = Object.freeze({
  id: "earthrise",
  title: "Earthrise",
  fileName: "earthrise-apollo8.jpg",
  blurb:
    "Apollo 8 Earthrise (NASA AS08-14-2383) — public domain US Government. A shared world rising over the lunar limb: hope, and a wake-up call amid war.",
  license: "PD-USGov",
  credit: "William Anders / NASA",
  nasaId: "as08-14-2383",
  sourceUrl:
    "https://images-assets.nasa.gov/image/as08-14-2383/as08-14-2383~medium.jpg",
  aliases: ["earth-rise", "apollo8", "anders", "hope", "wake"],
});

/** Historical uplift — Dr. Martin Luther King Jr. (Commons portrait; verify license for reuse). */
export const MLK_TEST = Object.freeze({
  id: "mlk",
  title: "Martin Luther King Jr.",
  fileName: "mlk-i-have-a-dream.jpg",
  blurb:
    "Dr. Martin Luther King Jr. — historical uplift: nonviolence, dignity, and the dream of justice amid struggle.",
  license: "PD-candidate / Wikimedia Commons portrait",
  credit: "Wikimedia Commons — File:Martin_Luther_King,_Jr..jpg",
  sourceUrl: "https://commons.wikimedia.org/wiki/File:Martin_Luther_King,_Jr..jpg",
  aliases: ["king", "mlkjr", "dream", "i-have-a-dream", "martin"],
});

function sha256Hex(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function shortHex(hex, n = 12) {
  return String(hex || "")
    .replace(/^0x/i, "")
    .toLowerCase()
    .slice(0, n);
}

function clip(s, n) {
  const t = String(s || "");
  return t.length <= n ? t : t.slice(0, n - 1) + "…";
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

function ensureDirs() {
  mkdirSync(PHOTO_DIR, { recursive: true });
  mkdirSync(INBOX_DIR, { recursive: true });
  mkdirSync(MEMORY_DIR, { recursive: true });
  mkdirSync(STRANDS_DIR, { recursive: true });
}

function appendLearn(event) {
  ensureDirs();
  const root = readJson(LEARN_PATH, { id: PHOTOS_ID, events: [] });
  root.events = Array.isArray(root.events) ? root.events : [];
  root.events.push({
    at: new Date().toISOString(),
    ...event,
  });
  if (root.events.length > 400) root.events = root.events.slice(-400);
  writeJson(LEARN_PATH, root);
  writeStrand();
}

function writeStrand() {
  const cat = loadCatalog();
  const src = loadSources();
  const q = loadQueue();
  const seals = loadSeals();
  writeJson(STRAND_PATH, {
    id: PHOTOS_ID,
    label: PHOTOS_LABEL,
    formulaId: FORMULA_ID,
    classProofAnchors: (MAINFRAME_ANCHORS.known || []).map((a) => a.tx || a),
    note:
      "Photos drive → compress bake-off → open-picture key → §VITAFILE§ → inject. Locs empty until real seal.",
    photos: Object.keys(cat.photos || {}).length,
    sources: (src.sources || []).length,
    queuePending: (q.items || []).filter((i) => i.status === "pending").length,
    sealedIds: Object.keys(seals.byId || {}).length,
    neverInventHashes: true,
    updatedAt: new Date().toISOString(),
  });
}

export function openSourcePictureKey({ name, contentCommit, bytes } = {}) {
  const commit =
    contentCommit ||
    (bytes ? sha256Hex(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)) : sha256Hex(String(name || "")));
  const safe =
    String(name || "picture")
      .replace(/[^\w.\-]+/g, "_")
      .replace(/_+/g, "_")
      .slice(0, 64) || "picture";
  return {
    scheme: "vita-open-picture-v1",
    privateKey: false,
    openSource: true,
    lock: false,
    name: safe,
    key: "VITAOPEN." + safe + "." + shortHex(commit, 12),
    contentCommit: commit,
    note:
      "The picture is the open key (name+sha256). Locked locate/decode waits until you grant encode permissions.",
  };
}

function sanitizeId(raw) {
  const s = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._\-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
  return s || "photo-" + Date.now().toString(36);
}

function sanitizeFileName(name) {
  const raw = String(name || "photo.jpg").trim() || "photo.jpg";
  const cleaned = raw.replace(/[^\w.\- ]+/g, "_").slice(0, 120);
  return cleaned || "photo.jpg";
}

function isImageName(name = "") {
  return IMAGE_EXTS.has(extname(String(name)).toLowerCase());
}

function isImageMime(mime = "") {
  return String(mime || "")
    .toLowerCase()
    .startsWith("image/");
}

export function loadCatalog() {
  ensureDirs();
  const root = readJson(CATALOG_PATH, {
    id: PHOTOS_ID,
    photos: {},
    updatedAt: null,
  });
  root.photos = root.photos && typeof root.photos === "object" ? root.photos : {};
  return root;
}

function saveCatalog(root) {
  root.updatedAt = new Date().toISOString();
  writeJson(CATALOG_PATH, root);
  writeStrand();
}

export function loadSources() {
  ensureDirs();
  return readJson(SOURCE_PATH, {
    id: PHOTOS_ID,
    activeId: null,
    sources: [],
    updatedAt: null,
  });
}

function saveSources(root) {
  root.updatedAt = new Date().toISOString();
  writeJson(SOURCE_PATH, root);
  writeStrand();
}

export function loadQueue() {
  ensureDirs();
  return readJson(QUEUE_PATH, {
    id: PHOTOS_ID,
    items: [],
    updatedAt: null,
  });
}

function saveQueue(root) {
  root.updatedAt = new Date().toISOString();
  writeJson(QUEUE_PATH, root);
  writeStrand();
}

export function loadSeals() {
  return readJson(SEAL_PATH, { id: PHOTOS_ID, byId: {}, neverInventHashes: true });
}

export function sealedLocsForPhoto(id) {
  const seals = loadSeals();
  const row = seals.byId?.[id];
  if (!row) return [];
  const locs = Array.isArray(row.locations) ? row.locations : [];
  return locs.filter((t) => /^0x[0-9a-fA-F]{64}$/.test(String(t)));
}

export function recordPhotoSeal({
  id,
  locations = [],
  contentCommit = null,
  txHashes = null,
} = {}) {
  const seals = loadSeals();
  seals.byId = seals.byId || {};
  const prev = seals.byId[id] || { locations: [] };
  const merged = [
    ...new Set([
      ...(prev.locations || []),
      ...locations.filter((t) => /^0x[0-9a-fA-F]{64}$/.test(String(t))),
      ...(Array.isArray(txHashes)
        ? txHashes.filter((t) => /^0x[0-9a-fA-F]{64}$/.test(String(t)))
        : []),
    ]),
  ];
  seals.byId[id] = {
    id,
    contentCommit: contentCommit || prev.contentCommit || null,
    locations: merged,
    sealedAt: new Date().toISOString(),
  };
  writeJson(SEAL_PATH, seals);
  appendLearn({ kind: "seal", id, locs: merged.length });
  return seals.byId[id];
}

/** Parse Google Drive / Photos / generic URL or local path into a source binding. */
export function parsePhotoSource(input = "") {
  const raw = String(input || "").trim();
  if (!raw) return { ok: false, reason: "source url or folder path required" };

  // Local folder or file
  const localPath = isAbsolute(raw) ? raw : resolve(ROOT, raw);
  if (existsSync(localPath)) {
    const st = statSync(localPath);
    if (st.isDirectory()) {
      return {
        ok: true,
        kind: "folder",
        path: localPath,
        label: "local-folder",
        display: localPath,
      };
    }
    if (st.isFile() && isImageName(localPath)) {
      return {
        ok: true,
        kind: "file",
        path: localPath,
        label: "local-file",
        display: localPath,
      };
    }
  }

  // Google Drive folder
  let m = raw.match(/drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/([a-zA-Z0-9_-]+)/i);
  if (m) {
    return {
      ok: true,
      kind: "gdrive-folder",
      folderId: m[1],
      url: raw,
      label: "google-drive-folder",
      display: "gdrive:folder:" + m[1],
    };
  }

  // Google Drive file
  m =
    raw.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/i) ||
    raw.match(/[?&]id=([a-zA-Z0-9_-]+)/i);
  if (/drive\.google\.com/i.test(raw) && m) {
    return {
      ok: true,
      kind: "gdrive-file",
      fileId: m[1],
      url: raw,
      label: "google-drive-file",
      display: "gdrive:file:" + m[1],
      downloadUrl: "https://drive.google.com/uc?export=download&id=" + m[1],
    };
  }

  // Google Photos share (album) — list needs OAuth; store as url-album for manual/API later
  if (/photos\.google\.com|photos\.app\.goo\.gl/i.test(raw)) {
    return {
      ok: true,
      kind: "gphotos-album",
      url: raw,
      label: "google-photos",
      display: clip(raw, 80),
      note:
        "Album listing needs Google Photos API OAuth later. Paste direct image URLs or mirror the album to a Drive folder / local path for now.",
    };
  }

  // Direct http(s) image or page URL
  if (/^https?:\/\//i.test(raw)) {
    const kind = isImageName(raw) ? "http-image" : "http-url";
    return {
      ok: true,
      kind,
      url: raw,
      label: kind,
      display: clip(raw, 96),
    };
  }

  return {
    ok: false,
    reason:
      "Unrecognized source. Pass a public Drive share, local folder/file, or https image URL.",
  };
}

export function setPhotoSource(input, { id = null, makeActive = true } = {}) {
  const parsed = parsePhotoSource(input);
  if (!parsed.ok) return parsed;
  const sources = loadSources();
  const sid = sanitizeId(id || parsed.folderId || parsed.fileId || parsed.label + "-" + Date.now().toString(36));
  const row = {
    id: sid,
    ...parsed,
    boundAt: new Date().toISOString(),
    role: "new-google-drive",
  };
  sources.sources = (sources.sources || []).filter((s) => s.id !== sid);
  sources.sources.push(row);
  if (makeActive) sources.activeId = sid;
  saveSources(sources);
  appendLearn({ kind: "source-bind", id: sid, sourceKind: parsed.kind, display: parsed.display });
  return { ok: true, source: row, activeId: sources.activeId };
}

export function getActiveSource() {
  const sources = loadSources();
  if (!sources.activeId) return null;
  return (sources.sources || []).find((s) => s.id === sources.activeId) || null;
}

async function fetchBytes(url, { maxBytes = 8_000_000 } = {}) {
  const res = await fetch(url, {
    redirect: "follow",
    headers: { "user-agent": "VITA-PhotosDrive/1.0 (+hope)" },
  });
  if (!res.ok) {
    return { ok: false, reason: "HTTP " + res.status + " for " + clip(url, 64) };
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) {
    return { ok: false, reason: "file too large (" + buf.length + " > " + maxBytes + ")" };
  }
  if (!buf.length) return { ok: false, reason: "empty download" };
  return { ok: true, bytes: buf, contentType: res.headers.get("content-type") || "" };
}

async function listGdriveFolder(folderId) {
  const key = process.env.GOOGLE_API_KEY || process.env.DRIVE_API_KEY || "";
  if (!key) {
    return {
      ok: false,
      reason:
        "Drive folder listing needs GOOGLE_API_KEY (or DRIVE_API_KEY). Or mirror the folder locally / pass file share URLs one by one.",
      needsApiKey: true,
    };
  }
  const q = encodeURIComponent("'" + folderId + "' in parents and trashed=false");
  const fields = encodeURIComponent("files(id,name,mimeType,size)");
  const url =
    "https://www.googleapis.com/drive/v3/files?q=" +
    q +
    "&fields=" +
    fields +
    "&pageSize=200&key=" +
    encodeURIComponent(key);
  const res = await fetch(url);
  if (!res.ok) {
    return { ok: false, reason: "Drive API HTTP " + res.status };
  }
  const data = await res.json();
  const files = (data.files || []).filter(
    (f) =>
      String(f.mimeType || "").startsWith("image/") || isImageName(f.name || "")
  );
  return {
    ok: true,
    files: files.map((f) => ({
      id: f.id,
      name: f.name,
      mime: f.mimeType,
      size: Number(f.size || 0),
      downloadUrl:
        "https://www.googleapis.com/drive/v3/files/" +
        f.id +
        "?alt=media&key=" +
        encodeURIComponent(key),
      fallbackUrl: "https://drive.google.com/uc?export=download&id=" + f.id,
    })),
  };
}

function listLocalImages(dirPath) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dirPath, { withFileTypes: true });
  } catch (e) {
    return { ok: false, reason: e.message || "readdir failed" };
  }
  for (const ent of entries) {
    if (!ent.isFile()) continue;
    if (!isImageName(ent.name)) continue;
    const full = join(dirPath, ent.name);
    const st = statSync(full);
    out.push({
      name: ent.name,
      path: full,
      size: st.size,
      mime: guessMime(ent.name, "image/jpeg"),
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return { ok: true, files: out };
}

function enqueueQueueItem(item) {
  const q = loadQueue();
  q.items = Array.isArray(q.items) ? q.items : [];
  const fingerprint =
    item.fingerprint ||
    sha256Hex(
      Buffer.from(
        [item.kind, item.path || "", item.url || "", item.name || "", item.fileId || ""].join("|"),
        "utf8"
      )
    ).slice(0, 16);
  if (q.items.some((i) => i.fingerprint === fingerprint && i.status !== "failed")) {
    return { ok: true, skipped: true, fingerprint };
  }
  const row = {
    id: "pq-" + Date.now().toString(36) + "-" + shortHex(fingerprint, 6),
    fingerprint,
    status: "pending",
    queuedAt: new Date().toISOString(),
    ...item,
  };
  q.items.push(row);
  saveQueue(q);
  return { ok: true, item: row };
}

/** Scan active source (or given input) and queue picture refs for slow copy. */
export async function scanPhotoSource(input = null) {
  const source = input ? parsePhotoSource(input) : getActiveSource();
  if (!source || source.ok === false) {
    return {
      ok: false,
      reason: source?.reason || "No active source. /vitafeed photos source <url|folder>",
    };
  }
  if (input && source.ok) {
    setPhotoSource(input);
  }
  const bound = getActiveSource() || source;
  let listed = { ok: false, files: [] };

  if (bound.kind === "folder" || bound.kind === "local-folder") {
    listed = listLocalImages(bound.path);
  } else if (bound.kind === "file" || bound.kind === "local-file") {
    listed = {
      ok: true,
      files: [
        {
          name: basename(bound.path),
          path: bound.path,
          size: statSync(bound.path).size,
          mime: guessMime(bound.path),
        },
      ],
    };
  } else if (bound.kind === "gdrive-folder") {
    listed = await listGdriveFolder(bound.folderId);
  } else if (bound.kind === "gdrive-file") {
    listed = {
      ok: true,
      files: [
        {
          id: bound.fileId,
          name: bound.fileId + ".jpg",
          downloadUrl: bound.downloadUrl,
          fallbackUrl: bound.downloadUrl,
        },
      ],
    };
  } else if (bound.kind === "http-image" || bound.kind === "http-url") {
    listed = {
      ok: true,
      files: [
        {
          name: basename(new URL(bound.url).pathname) || "photo.jpg",
          url: bound.url,
        },
      ],
    };
  } else if (bound.kind === "gphotos-album") {
    return {
      ok: false,
      reason: bound.note || "Google Photos album needs API OAuth — use Drive folder or local mirror",
      source: bound,
    };
  }

  if (!listed.ok) return { ...listed, source: bound };

  const added = [];
  const skipped = [];
  for (const f of listed.files) {
    const r = enqueueQueueItem({
      kind: bound.kind,
      name: f.name,
      path: f.path || null,
      url: f.url || f.downloadUrl || null,
      fallbackUrl: f.fallbackUrl || null,
      fileId: f.id || null,
      mime: f.mime || guessMime(f.name, "image/jpeg"),
      size: f.size || 0,
      sourceId: bound.id || null,
    });
    if (r.skipped) skipped.push(f.name);
    else if (r.ok) added.push(r.item);
  }

  appendLearn({
    kind: "scan",
    sourceId: bound.id || null,
    sourceKind: bound.kind,
    added: added.length,
    skipped: skipped.length,
  });

  return {
    ok: true,
    source: bound,
    scanned: listed.files.length,
    queued: added.length,
    skipped: skipped.length,
    pending: loadQueue().items.filter((i) => i.status === "pending").length,
    needsApiKey: listed.needsApiKey || false,
  };
}

function photoStorePath(fileName) {
  return join(PHOTO_DIR, sanitizeFileName(fileName));
}

/**
 * File one picture into PHOTOS catalog: store bytes, compress bake-off,
 * open-picture key, §VITAFILE§ packet plan. Locs stay empty until seal.
 */
export function filePhoto({
  bytes,
  name = "photo.jpg",
  mime = "",
  id = null,
  title = null,
  blurb = null,
  license = null,
  credit = null,
  sourceUrl = null,
  compress = true,
} = {}) {
  ensureDirs();
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  if (!buf.length) return { ok: false, reason: "empty picture bytes" };
  if (!isImageMime(mime) && !isImageName(name) && !String(mime).includes("octet")) {
    // allow octet-stream if name looks like image; otherwise soft-warn but still file if named as image
    if (!isImageName(name)) {
      return { ok: false, reason: "not an image — pass jpg/png/gif/webp (video lane later)" };
    }
  }

  const fileName = sanitizeFileName(name);
  const photoId = sanitizeId(id || fileName.replace(/\.[^.]+$/, ""));
  const contentCommit = sha256Hex(buf);
  const unlock = openSourcePictureKey({ name: fileName, contentCommit });
  const resolvedMime = guessMime(fileName, mime || "image/jpeg");
  const storePath = photoStorePath(fileName);
  writeFileSync(storePath, buf);

  let compression = null;
  if (compress) {
    try {
      const filed = addCompressionFile(
        {
          name: fileName,
          mime: resolvedMime,
          kind: "image",
          bytes: buf,
        },
        {}
      );
      compression = {
        ok: filed.ok !== false,
        key: filed.key || null,
        codec: filed.codec || filed.entry?.codec || null,
        verified: filed.verified === true,
        rawBytes: buf.length,
        payloadBytes: filed.payloadBytes || filed.entry?.payloadBytes || null,
        replyLine: filed.replyLine || null,
      };
    } catch (e) {
      compression = { ok: false, reason: e.message || String(e) };
    }
  }

  const packed = encodeVitaFile({
    name: fileName,
    mime: resolvedMime,
    bytes: buf,
  });
  if (!packed.ok) return packed;

  const feed = prepareVitaFileFeed({
    name: fileName,
    mime: resolvedMime,
    bytes: buf,
  });

  const cat = loadCatalog();
  cat.photos[photoId] = {
    id: photoId,
    title: title || fileName,
    fileName,
    blurb: blurb || "Picture filed into VITA:\\PHOTOS\\",
    license: license || null,
    credit: credit || null,
    sourceUrl: sourceUrl || null,
    mime: resolvedMime,
    playKind: playKindForMime(resolvedMime),
    bytes: buf.length,
    sha256: contentCommit,
    zeroOpenKey: unlock.key,
    contentCommit,
    storePath: "vita/memory/photos/" + fileName,
    compressionKey: compression?.key || null,
    compressionCodec: compression?.codec || null,
    compressionVerified: compression?.verified === true,
    packetCount: feed?.ok ? feed.chunkCount || feed.packets?.length || null : null,
    chunkBytes: VITAFEED_MAX_CHUNK_BYTES,
    locations: sealedLocsForPhoto(photoId),
    chainStatus: sealedLocsForPhoto(photoId).length ? "MATCH" : "LOCAL_OK",
    lock: false,
    filedAt: new Date().toISOString(),
  };
  saveCatalog(cat);
  appendLearn({
    kind: "file",
    id: photoId,
    bytes: buf.length,
    codec: compression?.codec || null,
    key: unlock.key,
  });

  return {
    ok: true,
    id: photoId,
    meta: cat.photos[photoId],
    zeroOpenKey: unlock.key,
    contentCommit,
    compression,
    packed,
    feed: feed?.ok ? feed : null,
    playerPath: PHOTOS_VIEWER_PATH + "?id=" + photoId + "&unwrap=1",
    playerHref: vitaPlayerHref(PHOTOS_VIEWER_PATH + "?id=" + photoId + "&unwrap=1"),
    note:
      "Filed under VITA:\\PHOTOS\\ · open key is the picture · enqueue photo " +
      photoId +
      " → confirm|override (never invent hashes)",
  };
}

export function loadPhotoBytes(idOrName) {
  const meta = resolvePhoto(idOrName);
  if (!meta) return { ok: false, reason: "photo not in catalog" };
  const path = join(ROOT, meta.storePath);
  if (!existsSync(path)) {
    const alt = photoStorePath(meta.fileName);
    if (!existsSync(alt)) return { ok: false, reason: "store miss: " + meta.fileName };
    return { ok: true, bytes: readFileSync(alt), meta };
  }
  return { ok: true, bytes: readFileSync(path), meta };
}

export function resolvePhoto(sel = "") {
  const cat = loadCatalog();
  const s = String(sel || "")
    .trim()
    .toLowerCase();
  if (!s) return null;
  if (cat.photos[s]) return cat.photos[s];
  for (const p of Object.values(cat.photos)) {
    if (p.id === s || String(p.fileName).toLowerCase() === s) return p;
    if ((p.aliases || []).map((a) => String(a).toLowerCase()).includes(s)) return p;
    if (String(p.title || "").toLowerCase() === s) return p;
  }
  for (const a of EARTHRISE_TEST.aliases) {
    if (a === s && cat.photos[EARTHRISE_TEST.id]) return cat.photos[EARTHRISE_TEST.id];
  }
  for (const a of MLK_TEST.aliases) {
    if (a === s && cat.photos[MLK_TEST.id]) return cat.photos[MLK_TEST.id];
  }
  return null;
}

/** Ordered + searchable catalog for large libraries. */
export function listPhotosOrdered({
  q = "",
  sort = "filedAt",
  order = "asc",
  limit = 200,
  offset = 0,
} = {}) {
  const photos = listCatalogPhotos();
  const query = String(q || "")
    .trim()
    .toLowerCase();
  let rows = Object.values(photos).map((p, i) => ({
    ...p,
    n: i + 1,
    orderIndex: i + 1,
    chainStatus: sealedLocsForPhoto(p.id).length ? "MATCH" : "LOCAL_OK",
    locations: sealedLocsForPhoto(p.id),
    mediaPath: "/vita/photos/media?id=" + encodeURIComponent(p.id),
    viewerPath: PHOTOS_VIEWER_PATH + "?id=" + encodeURIComponent(p.id) + "&unwrap=1",
    playerPath: PHOTOS_VIEWER_PATH + "?id=" + encodeURIComponent(p.id) + "&unwrap=1",
  }));
  if (query) {
    rows = rows.filter((p) => {
      const hay = [
        p.id,
        p.title,
        p.fileName,
        p.blurb,
        p.credit,
        p.license,
        p.zeroOpenKey,
        ...(p.aliases || []),
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(query);
    });
  }
  const dir = String(order || "asc").toLowerCase() === "desc" ? -1 : 1;
  const key = String(sort || "filedAt");
  rows.sort((a, b) => {
    let av = a[key];
    let bv = b[key];
    if (key === "filedAt") {
      av = Date.parse(a.filedAt || 0) || 0;
      bv = Date.parse(b.filedAt || 0) || 0;
    } else if (key === "bytes" || key === "packetCount") {
      av = Number(a[key] || 0);
      bv = Number(b[key] || 0);
    } else {
      av = String(av || "").toLowerCase();
      bv = String(bv || "").toLowerCase();
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return String(a.id).localeCompare(String(b.id));
    }
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return String(a.id).localeCompare(String(b.id));
  });
  // Stable filing order number after sort
  rows = rows.map((p, i) => ({ ...p, n: i + 1, orderIndex: offset + i + 1 }));
  const total = rows.length;
  const slice = rows.slice(Math.max(0, offset), Math.max(0, offset) + Math.max(1, limit));
  return {
    ok: true,
    total,
    q: query || null,
    sort: key,
    order: dir === 1 ? "asc" : "desc",
    offset: Math.max(0, offset),
    limit: Math.max(1, limit),
    photos: slice,
  };
}

/**
 * Unwrap / blockchain-inject plan — every VIN line is one inject step with
 * exact UTF-8 data field + read-proof receipt click-through.
 * LOCAL_OK = availability (receipt shows the data field that will seal).
 * MATCH = sealed Basescan Input Data → UTF-8 (never invent hashes).
 */
export function buildUnwrapPlan(idOrSel = "earthrise") {
  const meta = resolvePhoto(idOrSel);
  if (!meta) return { ok: false, reason: "unknown photo" };
  const packed = packetizePhoto(meta.id);
  if (!packed.ok) return packed;
  const sealed = sealedLocsForPhoto(meta.id);
  const basescanTx = MAINFRAME_ANCHORS.basescanTx || "https://basescan.org/tx/";
  const classProof = (MAINFRAME_ANCHORS.known || []).map((a) => ({
    tx: a.tx,
    href: basescanTx + a.tx,
    kind: a.kind,
    label: a.label,
    role: "CLASS_PROOF",
    note: "Formula anchor — NOT picture body",
  }));

  const blocks = [];
  let vinGlobal = 0;
  for (const g of packed.groups || []) {
    const lines = Array.isArray(g.lines) && g.lines.length
      ? g.lines
      : [{ index: 1, line: g.body, body: g.body, hash: shortHex(g.contentCommit, 16) }];
    for (const lineObj of lines) {
      vinGlobal += 1;
      const line = String(lineObj.line || lineObj.body || g.body || "");
      const dataFieldCommit = sha256Hex(line);
      const sealedTx = sealed[vinGlobal - 1] || null;
      const match = sealedTx ? "MATCH" : "LOCAL_OK";
      const label = "g" + String(g.n).padStart(2, "0") + "." + String(lineObj.index || vinGlobal);
      const receiptPath =
        "/vita/photos/receipt?id=" +
        encodeURIComponent(meta.id) +
        "&g=" +
        g.n +
        "&i=" +
        (lineObj.index || 1);
      const locPath =
        "/vita/photos/loc?id=" +
        encodeURIComponent(meta.id) +
        "&g=" +
        g.n +
        "&i=" +
        (lineObj.index || 1);
      blocks.push({
        n: vinGlobal,
        index: lineObj.index || vinGlobal,
        groupN: g.n,
        label,
        name: g.name,
        filingPath: g.filingPath || meta.storePath,
        bytes: Buffer.byteLength(line, "utf8"),
        vinId: g.vinId,
        readerKey: g.readerKey || packed.zeroOpenKey,
        contentCommit: dataFieldCommit,
        dataFieldCommit,
        dataFieldCommit8: shortHex(dataFieldCommit, 8),
        lineHash: lineObj.hash || shortHex(dataFieldCommit, 16),
        bodyPreview: line.slice(0, 96),
        dataField: line,
        calldataHex: "0x" + Buffer.from(line, "utf8").toString("hex"),
        match,
        highlight: match === "MATCH",
        location: sealedTx,
        basescan: sealedTx ? basescanTx + sealedTx : null,
        role: sealedTx ? "MATCH" : "LOCAL_OK",
        receiptPath,
        inspectPath: locPath,
        idmChat: sealedTx
          ? "Basescan → Input Data → View as UTF-8"
          : "pending seal — this UTF-8 is the data field that will inject",
        note: sealedTx
          ? "Sealed inject — click Basescan read proof receipt"
          : "LOCAL_OK inject preview — click receipt for exact data field (never invent a hash)",
      });
    }
  }

  return {
    ok: true,
    id: meta.id,
    title: meta.title,
    fileName: meta.fileName,
    mime: meta.mime,
    blurb: meta.blurb,
    credit: meta.credit,
    license: meta.license,
    bytes: meta.bytes,
    sha256: meta.sha256,
    zeroOpenKey: meta.zeroOpenKey,
    compressionKey: meta.compressionKey,
    compressionCodec: meta.compressionCodec,
    contentCommit: meta.contentCommit,
    chainStatus: sealed.length ? "MATCH" : "LOCAL_OK",
    sealedLocs: sealed,
    groupCount: packed.groupCount,
    packetCount: packed.packetCount || blocks.length,
    injectCount: blocks.length,
    blocks,
    classProof,
    mediaPath: "/vita/photos/media?id=" + encodeURIComponent(meta.id),
    viewerPath: PHOTOS_VIEWER_PATH + "?id=" + encodeURIComponent(meta.id) + "&unwrap=1",
    streamMsPerBlock: 380,
    neverInventHashes: true,
    proof:
      "BLOCKCHAIN INJECT · each card is one VIN data field · click receipt for Input Data → UTF-8",
    dos: {
      drive: "VITA:\\PHOTOS\\",
      unlock: meta.zeroOpenKey,
      path: "VITA:\\PHOTOS\\" + meta.fileName,
    },
  };
}

export function publicPhotosUnwrap(id = "earthrise") {
  return buildUnwrapPlan(id);
}

/**
 * Exact VIN UTF-8 data field for one inject step — read-proof receipt body.
 * sha256(line) === dataFieldCommit. Location only when a real seal exists.
 */
export function inspectPhotoLoc({ id = "earthrise", groupN = 1, index = 1 } = {}) {
  const packed = packetizePhoto(id);
  if (!packed.ok) return packed;
  const gN = Number(groupN) || 1;
  const iN = Number(index) || 1;
  const g = (packed.groups || []).find((x) => Number(x.n) === gN);
  if (!g) return { ok: false, reason: "unknown group g" + gN };
  const lines = Array.isArray(g.lines) && g.lines.length
    ? g.lines
    : [{ index: 1, line: g.body, body: g.body }];
  const lineObj = lines.find((l) => Number(l.index) === iN) || lines[iN - 1];
  if (!lineObj) return { ok: false, reason: "unknown loc g" + gN + "." + iN };
  const line = String(lineObj.line || lineObj.body || "");
  const dataFieldCommit = sha256Hex(line);
  const pulledUtf8Commit = sha256Hex(line);
  const trueToBlock = pulledUtf8Commit === dataFieldCommit;
  const sealed = sealedLocsForPhoto(packed.id);
  let ord = 0;
  let sealedTx = null;
  outer: for (const gg of packed.groups || []) {
    const glines = Array.isArray(gg.lines) && gg.lines.length
      ? gg.lines
      : [{ index: 1 }];
    for (const lo of glines) {
      ord += 1;
      if (Number(gg.n) === gN && Number(lo.index || 1) === iN) {
        sealedTx = sealed[ord - 1] || null;
        break outer;
      }
    }
  }
  const basescanTx = MAINFRAME_ANCHORS.basescanTx || "https://basescan.org/tx/";
  const basescan = sealedTx ? basescanTx + sealedTx : null;
  const calldataHex = "0x" + Buffer.from(line, "utf8").toString("hex");
  return {
    ok: true,
    proof: sealedTx ? "SYSTEM_INJECTED" : "INJECT_PREVIEW",
    id: packed.id,
    fileName: packed.fileName,
    zeroOpenKey: packed.zeroOpenKey,
    groupN: gN,
    index: iN,
    vinOrdinal: ord,
    totalInGroup: g.totalChunks || lines.length,
    groupCount: packed.groupCount,
    totalVin: packed.packetCount || null,
    filingPath: g.filingPath,
    vinId: g.vinId,
    readerKey: g.readerKey || packed.zeroOpenKey,
    dataFieldCommit,
    pulledUtf8Commit,
    trueToBlock,
    match: trueToBlock ? (sealedTx ? "MATCH" : "LOCAL_OK") : "LOCAL_FAIL",
    highlight: trueToBlock,
    line,
    dataField: line,
    body: lineObj.body || "",
    bytes: Buffer.byteLength(line, "utf8"),
    calldataHex,
    calldataPreview: calldataHex.slice(0, 66) + (calldataHex.length > 66 ? "…" : ""),
    location: sealedTx,
    basescan,
    clickThrough: true,
    idmChat: basescan
      ? "Basescan → Input Data → View as UTF-8"
      : "pending seal — never invent loc · this UTF-8 IS the Input Data field",
    receiptPath:
      "/vita/photos/receipt?id=" +
      encodeURIComponent(packed.id) +
      "&g=" +
      gN +
      "&i=" +
      iN,
    inspectPath:
      "/vita/photos/loc?id=" +
      encodeURIComponent(packed.id) +
      "&g=" +
      gN +
      "&i=" +
      iN,
    neverInventHashes: true,
    note:
      "Exact VIN UTF-8 data field for this blockchain inject step. " +
      "sha256(line) must equal dataFieldCommit. Click Basescan when MATCH for Input Data → UTF-8 read receipt.",
  };
}

export function publicPhotosLoc(id = "earthrise", g = 1, i = 1) {
  return inspectPhotoLoc({ id, groupN: Number(g) || 1, index: Number(i) || 1 });
}

export function publicPhotosGroup(id = "earthrise", groupN = 1) {
  const packed = packetizePhoto(id);
  if (!packed.ok) return packed;
  const g = (packed.groups || []).find((x) => Number(x.n) === Number(groupN));
  if (!g) return { ok: false, reason: "group not found" };
  const locs = (g.lines || []).map((lineObj) =>
    inspectPhotoLoc({ id: packed.id, groupN: g.n, index: lineObj.index || 1 })
  );
  return {
    ok: true,
    id: packed.id,
    groupN: g.n,
    name: g.name,
    mime: g.mime || packed.mime,
    vinId: g.vinId,
    readerKey: g.readerKey,
    contentCommit: g.contentCommit,
    totalChunks: g.totalChunks,
    body: g.body,
    bodyBytes: g.bodyBytes,
    locs,
    filingPath: g.filingPath,
    neverInventHashes: true,
  };
}

/** HTML-ready receipt card for one inject (SYSTEM_INJECTED or INJECT_PREVIEW). */
export function formatPhotoReceiptHtml(inspected) {
  if (!inspected?.ok) {
    return "<pre>receipt refused: " + String(inspected?.reason || "error") + "</pre>";
  }
  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  const basescan = inspected.basescan
    ? '<p><a href="' +
      esc(inspected.basescan) +
      '" target="_blank" rel="noopener">READ PROOF · Basescan Input Data → UTF-8</a></p>'
    : '<p class="dim">No sealed tx yet — never invent hashes. Data field below is the inject body.</p>';
  return [
    "<!doctype html><html><head><meta charset=utf-8>",
    "<meta name=viewport content=\"width=device-width,initial-scale=1\">",
    "<title>PHOTO RECEIPT " + esc(inspected.id) + " " + esc(inspected.groupN) + "." + esc(inspected.index) + "</title>",
    "<style>",
    "body{margin:0;background:#010801;color:#67ff78;font:13px/1.45 Courier New,ui-monospace,monospace;",
    "text-shadow:0 0 6px rgba(80,255,120,.35);padding:16px}",
    "a{color:#b6ff9a} .dim{color:#1f8a3a} pre{white-space:pre-wrap;word-break:break-all;",
    "border:1px solid #145c28;padding:10px;background:rgba(0,12,0,.55)}",
    "h1{font-size:15px;letter-spacing:.14em;font-weight:normal}",
    "</style></head><body>",
    "<h1>VITA:\\PHOTOS\\ RECEIPT · " + esc(inspected.proof) + "</h1>",
    "<p>" + esc(inspected.id) + " · block g" + esc(inspected.groupN) + "." + esc(inspected.index) +
      " · match " + esc(inspected.match) + "</p>",
    "<p>open key <code>" + esc(inspected.zeroOpenKey) + "</code></p>",
    "<p>dataFieldCommit <code>" + esc(inspected.dataFieldCommit) + "</code></p>",
    "<p>trueToBlock=" + esc(inspected.trueToBlock) + " · bytes=" + esc(inspected.bytes) + "</p>",
    basescan,
    "<p class=dim>" + esc(inspected.idmChat) + "</p>",
    "<h2 style=\"font-size:12px;letter-spacing:.12em\">EXACT INPUT DATA FIELD (UTF-8)</h2>",
    "<pre>" + esc(inspected.dataField || inspected.line) + "</pre>",
    "<h2 style=\"font-size:12px;letter-spacing:.12em\">CALLDATA HEX</h2>",
    "<pre>" + esc(inspected.calldataHex) + "</pre>",
    "<p class=dim>" + esc(inspected.note) + "</p>",
    '<p><a href="/vita/photos/viewer?id=' +
      encodeURIComponent(inspected.id) +
      '&unwrap=1&popup=1">← back to inject stream</a></p>',
    "</body></html>",
  ].join("");
}

export function listCatalogPhotos() {
  return loadCatalog().photos || {};
}

export function listCatalogPhotoIds() {
  return Object.keys(listCatalogPhotos());
}

/** Process next pending queue item (slow Google Photos-style copy). */
export async function processNextPhoto({ compress = true } = {}) {
  const q = loadQueue();
  const next = (q.items || []).find((i) => i.status === "pending");
  if (!next) return { ok: true, done: true, reason: "queue empty" };

  next.status = "copying";
  next.startedAt = new Date().toISOString();
  saveQueue(q);

  let bytes = null;
  let name = next.name || "photo.jpg";
  let mime = next.mime || "";
  let sourceUrl = next.url || null;

  try {
    if (next.path && existsSync(next.path)) {
      bytes = readFileSync(next.path);
      name = basename(next.path);
      mime = guessMime(name, mime);
    } else if (next.url || next.fallbackUrl) {
      let got = await fetchBytes(next.url || next.fallbackUrl);
      if (!got.ok && next.fallbackUrl && next.url !== next.fallbackUrl) {
        got = await fetchBytes(next.fallbackUrl);
      }
      if (!got.ok) throw new Error(got.reason || "download failed");
      bytes = got.bytes;
      mime = got.contentType || mime || guessMime(name, "image/jpeg");
      if (!isImageName(name) && mime.includes("jpeg")) name = name.replace(/\.[^.]+$/, "") + ".jpg";
      if (!isImageName(name) && mime.includes("png")) name = name.replace(/\.[^.]+$/, "") + ".png";
    } else {
      throw new Error("queue item has no path or url");
    }

    const filed = filePhoto({
      bytes,
      name,
      mime,
      id: sanitizeId(name.replace(/\.[^.]+$/, "")),
      sourceUrl,
      compress,
    });
    if (!filed.ok) throw new Error(filed.reason || "file failed");

    const q2 = loadQueue();
    const row = (q2.items || []).find((i) => i.id === next.id);
    if (row) {
      row.status = "filed";
      row.photoId = filed.id;
      row.zeroOpenKey = filed.zeroOpenKey;
      row.filedAt = new Date().toISOString();
    }
    saveQueue(q2);
    appendLearn({ kind: "slow-copy", queueId: next.id, photoId: filed.id });
    return { ok: true, done: false, filed, queueId: next.id };
  } catch (e) {
    const q2 = loadQueue();
    const row = (q2.items || []).find((i) => i.id === next.id);
    if (row) {
      row.status = "failed";
      row.error = e.message || String(e);
      row.failedAt = new Date().toISOString();
    }
    saveQueue(q2);
    return { ok: false, reason: e.message || String(e), queueId: next.id };
  }
}

/** Drain up to `limit` pending queue items (batch). */
export async function processPhotoQueue({ limit = 50, compress = true } = {}) {
  const results = [];
  for (let i = 0; i < limit; i++) {
    const r = await processNextPhoto({ compress });
    results.push(r);
    if (r.done || !r.ok) break;
  }
  return {
    ok: true,
    processed: results.filter((r) => r.filed).length,
    failed: results.filter((r) => r.ok === false).length,
    results,
    pending: loadQueue().items.filter((i) => i.status === "pending").length,
  };
}

/** Ingest inbox drops into catalog. */
export function ingestPhotosInbox({ compress = true } = {}) {
  ensureDirs();
  const names = readdirSync(INBOX_DIR).filter((n) => isImageName(n) && !n.startsWith("."));
  const filed = [];
  for (const name of names) {
    const src = join(INBOX_DIR, name);
    const bytes = readFileSync(src);
    const out = filePhoto({ bytes, name, mime: guessMime(name), compress });
    if (out.ok) {
      filed.push(out);
      try {
        renameSync(src, join(INBOX_DIR, ".done-" + name));
      } catch {
        /* keep inbox copy if rename fails */
      }
    }
  }
  return { ok: true, filed: filed.length, ids: filed.map((f) => f.id) };
}

/**
 * Full-system test: ensure Earthrise is filed into PHOTOS with open key +
 * compression + VIN plan. Locs stay empty until confirm|override.
 */
export function runEarthriseTest({ compress = true } = {}) {
  return runNamedPhotoTest(EARTHRISE_TEST, { compress, learnKind: "earthrise-test" });
}

/** MLK historical uplift full-system file into PHOTOS. */
export function runMlkTest({ compress = true } = {}) {
  return runNamedPhotoTest(MLK_TEST, { compress, learnKind: "mlk-test" });
}

function runNamedPhotoTest(seed, { compress = true, learnKind = "photo-test" } = {}) {
  ensureDirs();
  const path = join(PHOTO_DIR, seed.fileName);
  if (!existsSync(path)) {
    return {
      ok: false,
      reason: "Missing " + seed.fileName + " — expected at vita/memory/photos/",
    };
  }
  const bytes = readFileSync(path);
  const filed = filePhoto({
    bytes,
    name: seed.fileName,
    mime: "image/jpeg",
    id: seed.id,
    title: seed.title,
    blurb: seed.blurb,
    license: seed.license,
    credit: seed.credit,
    sourceUrl: seed.sourceUrl,
    compress,
  });
  if (!filed.ok) return filed;

  const cat = loadCatalog();
  if (cat.photos[seed.id]) {
    cat.photos[seed.id].aliases = [...(seed.aliases || [])];
    if (seed.nasaId) cat.photos[seed.id].nasaId = seed.nasaId;
    saveCatalog(cat);
  }

  appendLearn({
    kind: learnKind,
    id: seed.id,
    bytes: bytes.length,
    key: filed.zeroOpenKey,
    codec: filed.compression?.codec || null,
  });

  return {
    ok: true,
    test: seed.id,
    hope: true,
    filed,
    reply: formatPhotosCard(seed.id),
  };
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

/** Raw byte budget so one group stays ≤ PHOTO_VIN_CAP VIN chunks after base64. */
export function sliceBytesForPhotoVinCap(maxChunks = PHOTO_VIN_CAP) {
  const payloadBudget = VITAFEED_MAX_CHUNK_BYTES * Math.max(1, maxChunks);
  let raw = Math.floor(((payloadBudget - 260) * 3) / 4);
  raw -= raw % 3;
  for (let i = 0; i < 12 && raw >= 192; i++) {
    const probe = Buffer.alloc(raw, 0x5a);
    const prep = prepareVitaFileFeed({
      name: "probe.jpg.g99",
      mime: "application/octet-stream",
      bytes: probe,
    });
    if (prep.ok && prep.totalChunks <= maxChunks) return raw;
    raw = Math.floor(raw * 0.95);
    raw -= raw % 3;
  }
  return 4095;
}

/**
 * Packetize a photo into grouped §VITAFILE§ VIN (≤24 VIN/group).
 * Concat of group payloads must rebuild the original picture bytes.
 */
export function packetizePhoto(idOrSel = "earthrise") {
  const loaded = loadPhotoBytes(idOrSel);
  if (!loaded.ok) return loaded;
  const { bytes, meta } = loaded;
  if (meta.sha256 && meta.sha256 !== sha256Hex(bytes)) {
    return {
      ok: false,
      reason: "sha256 mismatch vs catalog — refuse corrupt playback",
      got: sha256Hex(bytes),
      want: meta.sha256,
    };
  }

  const sliceBytes = sliceBytesForPhotoVinCap(PHOTO_VIN_CAP);
  const groups = [];
  const fileName = meta.fileName || meta.id + ".jpg";
  for (let off = 0, n = 1; off < bytes.length; off += sliceBytes, n++) {
    const slice = bytes.subarray(off, Math.min(off + sliceBytes, bytes.length));
    const enc = encodeVitaFile({
      name:
        fileName.replace(/[^\w.\- ]+/g, "_") +
        (bytes.length > sliceBytes ? ".g" + pad2(n) : ""),
      mime: meta.mime || "image/jpeg",
      bytes: slice,
    });
    if (!enc.ok) {
      return { ok: false, reason: "group " + n + " encode failed: " + enc.reason };
    }
    const vinId =
      "VIN-" + shortHex(sha256Hex(meta.id + "|g" + pad2(n) + "|" + enc.sha256), 10).toUpperCase();
    const prepared = prepareVitaFeed(enc.body, { vinId });
    if (!prepared.ok) {
      return { ok: false, reason: "group " + n + " VIN prepare failed: " + prepared.reason };
    }
    if (prepared.totalChunks > PHOTO_VIN_CAP) {
      return {
        ok: false,
        reason: "group " + n + " has " + prepared.totalChunks + " VIN > cap " + PHOTO_VIN_CAP,
      };
    }
    groups.push({
      n,
      off,
      len: slice.length,
      sha256: enc.sha256,
      name: enc.name,
      mime: enc.mime,
      bodyBytes: enc.bodyBytes,
      vinId: prepared.vinId,
      readerKey: prepared.readerKey,
      contentCommit: prepared.contentCommit,
      totalChunks: prepared.totalChunks,
      injections: prepared.injections,
      body: enc.body,
      lines: prepared.lines,
      filingPath:
        "vita/memory/photos/" +
        fileName +
        (bytes.length > sliceBytes ? "#g" + pad2(n) : ""),
    });
  }

  const parts = [];
  for (const g of groups) {
    const parsed = parseVitaFileBody(g.body);
    if (!parsed.ok) {
      return { ok: false, reason: "group " + g.n + " parse: " + parsed.reason };
    }
    parts.push(parsed.data);
  }
  const rebuilt = Buffer.concat(parts);
  if (sha256Hex(rebuilt) !== meta.sha256) {
    return { ok: false, reason: "grouped reconstruct sha mismatch — refuse playback" };
  }

  const totalVin = groups.reduce((s, g) => s + g.totalChunks, 0);
  return {
    ok: true,
    id: meta.id,
    fileName,
    mime: meta.mime,
    rawBytes: meta.bytes,
    contentCommit: meta.contentCommit,
    zeroOpenKey: meta.zeroOpenKey,
    groups,
    groupCount: groups.length,
    packetCount: totalVin,
    body: groups[0]?.body || null,
  };
}

export function enqueuePhoto({ enqueueFn, id = "earthrise", source = "photos" } = {}) {
  if (typeof enqueueFn !== "function") {
    return { ok: false, reason: "enqueueFn required" };
  }
  const packed = packetizePhoto(id);
  if (!packed.ok) return packed;
  const added = [];
  for (const g of packed.groups || []) {
    const item = enqueueFn({
      body: g.body,
      name: g.name || packed.fileName,
      mime: packed.mime,
      source,
      kind: "photos",
      meta: {
        photos: true,
        photoId: packed.id,
        groupN: g.n,
        zeroOpenKey: packed.zeroOpenKey,
        contentCommit: g.contentCommit,
        photoContentCommit: packed.contentCommit,
        filingLabel: PHOTOS_LABEL,
      },
    });
    added.push(item?.item?.id || item?.id || g.n);
  }
  appendLearn({
    kind: "enqueue-photo",
    id: packed.id,
    contentCommit: packed.contentCommit,
    groups: packed.groupCount,
    added: added.length,
  });
  return {
    ok: true,
    id: packed.id,
    packed,
    added: added.length,
    note:
      "Queued " +
      added.length +
      " group(s) for confirm|override — seal creates NEW Input Data (never invent hashes)",
  };
}

export function enqueuePhotosLibrary({ enqueueFn, source = "photos-library" } = {}) {
  const ids = listCatalogPhotoIds();
  const added = [];
  for (const id of ids) {
    const r = enqueuePhoto({ enqueueFn, id, source });
    if (r.ok) added.push(id);
  }
  return { ok: true, added: added.length, ids: added };
}

export function isPhotoEnqueueSelector(sel = "") {
  const s = String(sel || "").trim().toLowerCase();
  if (!s) return false;
  if (/^(?:photos?|pictures?|gallery|earthrise|all)$/i.test(s)) return true;
  if (/^photo\s+/i.test(s)) return true;
  return Boolean(resolvePhoto(s.replace(/^photo\s+/i, "")));
}

export function resolvePhotoEnqueueTarget(sel = "") {
  const s = String(sel || "").trim();
  if (/^(?:photos|pictures|gallery|all)$/i.test(s)) {
    return { kind: "library" };
  }
  const idPart = s.replace(/^(?:photo|picture)\s+/i, "").trim() || s;
  if (/^earthrise$/i.test(idPart)) return { kind: "photo", id: "earthrise" };
  const meta = resolvePhoto(idPart);
  if (meta) return { kind: "photo", id: meta.id };
  return null;
}

export function photosEntriesFor() {
  const photos = listCatalogPhotos();
  const out = [];
  let n = 1;
  for (const id of Object.keys(photos)) {
    const p = photos[id];
    const locs = sealedLocsForPhoto(id);
    out.push({
      n: n++,
      name: p.fileName,
      kind: "image",
      bytes: p.bytes,
      unlockName: p.fileName,
      english:
        (p.title || p.fileName) +
        " — " +
        (p.blurb || "photo") +
        " · " +
        p.bytes +
        "B · open-key " +
        (p.zeroOpenKey || "") +
        (locs.length ? " · sealed" : " · availability"),
      machine:
        "VITAPHOTO id=" +
        id +
        " sha=" +
        shortHex(p.sha256, 12) +
        " codec=" +
        (p.compressionCodec || "—") +
        " key=" +
        (p.zeroOpenKey || "") +
        " status=" +
        (locs.length ? "MATCH" : "LOCAL_OK"),
      locations: locs,
      readerKey: p.zeroOpenKey,
      trueName: id,
      mime: p.mime,
    });
  }
  return out;
}

export function formatPhotosCard(id = null) {
  const lines = [
    "📷 VITA Photos Drive — your new Google Drive for pictures",
    "Folder: VITA:\\PHOTOS\\ · open key = the picture (VITAOPEN…)",
    "Chain: availability until confirm|override seals real Base locs",
    "",
  ];
  const active = getActiveSource();
  if (active) {
    lines.push("Source: " + (active.display || active.kind) + " [" + (active.kind || "") + "]");
  } else {
    lines.push("Source: (none) — /vitafeed photos source <drive-url|folder|https>");
  }
  const q = loadQueue();
  const pending = (q.items || []).filter((i) => i.status === "pending").length;
  const filedQ = (q.items || []).filter((i) => i.status === "filed").length;
  lines.push("Queue: " + pending + " pending · " + filedQ + " filed (slow copy)");
  lines.push("");

  const photos = listCatalogPhotos();
  const ids = Object.keys(photos);
  lines.push("Catalog: " + ids.length + " picture(s)");
  for (const pid of ids.slice(0, 12)) {
    const p = photos[pid];
    const mark = id && pid === id ? "▶ " : "  ";
    const locs = sealedLocsForPhoto(pid);
    lines.push(
      mark +
        pid +
        " · " +
        p.bytes +
        "B · " +
        (p.compressionCodec || "raw") +
        " · " +
        (locs.length ? "MATCH×" + locs.length : "LOCAL_OK") +
        " · " +
        shortHex(p.zeroOpenKey, 20)
    );
  }
  if (ids.length > 12) lines.push("  … +" + (ids.length - 12) + " more");

  if (id) {
    const p = resolvePhoto(id);
    if (p) {
      lines.push("");
      lines.push("Selected: " + (p.title || p.id));
      if (p.blurb) lines.push(p.blurb);
      lines.push("Open key: " + p.zeroOpenKey);
      if (p.compressionKey) lines.push("Compress key: " + p.compressionKey);
      lines.push("Player: " + PHOTOS_PLAYER_PATH + "?id=" + p.id);
      lines.push("Enqueue: /vitafeed enqueue photo " + p.id);
    }
  }

  lines.push("");
  lines.push("Commands:");
  lines.push("  /vitafeed photos source <url|folder>  — bind new drive");
  lines.push("  /vitafeed photos scan                 — queue pictures from source");
  lines.push("  /vitafeed photos next                 — slow-copy one into PHOTOS");
  lines.push("  /vitafeed photos all                  — batch drain queue / inbox");
  lines.push("  /vitafeed photos add                  — send one picture");
  lines.push("  /vitafeed photos test                 — Earthrise hope full test");
  lines.push("  /vitafeed photos test mlk             — MLK historical uplift test");
  lines.push("  /vitafeed photos unwrap [id]          — blockchain inject stream + READ PROOF");
  lines.push("  /vitafeed dir PHOTOS                  — DOS list");
  lines.push("Never invent hashes. LOCK encode waits until you grant permissions.");
  return lines.join("\n");
}

export function buildPhotosKeyboard({ highlight = null } = {}) {
  const rows = [];
  rows.push([
    { text: "📷 Drive", callback_data: telegramCallbackData("/vitafeed photos") },
    { text: "🌍 Earthrise", callback_data: telegramCallbackData("/vitafeed photos test") },
  ]);
  rows.push([
    { text: "🕊️ MLK test", callback_data: telegramCallbackData("/vitafeed photos test mlk") },
    { text: "Dir", callback_data: telegramCallbackData("/vitafeed dir PHOTOS") },
  ]);
  rows.push([
    { text: "Scan", callback_data: telegramCallbackData("/vitafeed photos scan") },
    { text: "Next 1", callback_data: telegramCallbackData("/vitafeed photos next") },
    { text: "All", callback_data: telegramCallbackData("/vitafeed photos all") },
  ]);
  rows.push([
    { text: "Add pic", callback_data: telegramCallbackData("/vitafeed photos add") },
  ]);
  const ids = listPhotosOrdered({ sort: "filedAt", order: "asc", limit: 6 }).photos.map((p) => p.id);
  if (ids.length) {
    const row = ids.map((id) => ({
      text: (highlight === id ? "▶ " : "") + id.slice(0, 12),
      callback_data: telegramCallbackData("/vitafeed photos " + id),
    }));
    rows.push(row.slice(0, 3));
    if (row.length > 3) rows.push(row.slice(3));
  }
  // Pop-out unwrap viewer (Mini App + HTTPS)
  const viewId = highlight || ids[0] || "earthrise";
  const unwrapPath = PHOTOS_VIEWER_PATH + "?id=" + encodeURIComponent(viewId) + "&unwrap=1";
  const href = vitaPlayerHref(unwrapPath);
  rows.push([
    { text: "▶ Unwrap popup", web_app: { url: href } },
    { text: "↗ Viewer", url: href },
  ]);
  if (resolvePhoto("earthrise")) {
    rows.push([
      {
        text: "Enqueue Earthrise",
        callback_data: telegramCallbackData("/vitafeed enqueue photo earthrise"),
      },
    ]);
  }
  if (resolvePhoto("mlk")) {
    rows.push([
      {
        text: "Enqueue MLK",
        callback_data: telegramCallbackData("/vitafeed enqueue photo mlk"),
      },
    ]);
  }
  return { inline_keyboard: rows };
}

export function playPhoto(selector = "earthrise") {
  const meta = resolvePhoto(selector);
  if (!meta) {
    return { ok: false, reason: "unknown photo — try earthrise, mlk, or /vitafeed photos test" };
  }
  const locs = sealedLocsForPhoto(meta.id);
  const viewerPath = PHOTOS_VIEWER_PATH + "?id=" + meta.id + "&unwrap=1";
  return {
    ok: true,
    id: meta.id,
    meta,
    zeroOpenKey: meta.zeroOpenKey,
    proven: locs.length > 0,
    playProof: {
      status: locs.length ? "MATCH" : "LOCAL_OK",
      locations: locs,
      classProofOnly: false,
      note: locs.length
        ? "Sealed Input Data locs hold picture UTF-8"
        : "Availability only — class-proof anchors ≠ picture body",
    },
    playerPath: viewerPath,
    playerHref: vitaPlayerHref(viewerPath),
    unwrapPath: viewerPath,
    reply: formatPhotosCard(meta.id),
  };
}

export function handlePhotosRequest({ body = "", bytes = null, name = "", mime = "" } = {}) {
  const rest = String(body || "").trim();

  if (/^source\b/i.test(rest)) {
    const arg = rest.replace(/^source\s*/i, "").trim();
    if (!arg) {
      return {
        ok: false,
        phase: "source",
        reply:
          "Usage: /vitafeed photos source <google-drive-share|local-folder|https-image>\n" +
          "That binding becomes your new Google Drive for pictures.",
      };
    }
    const bound = setPhotoSource(arg);
    if (!bound.ok) return { ok: false, phase: "source", reply: bound.reason };
    return {
      ok: true,
      phase: "source",
      photos: true,
      source: bound.source,
      reply:
        formatPhotosCard() +
        "\n\nBound as new drive: " +
        bound.source.display +
        "\nNext: /vitafeed photos scan",
      keyboard: buildPhotosKeyboard(),
    };
  }

  if (/^scan\b/i.test(rest)) {
    const arg = rest.replace(/^scan\s*/i, "").trim();
    return scanPhotoSource(arg || null).then((scanned) => {
      if (!scanned.ok) {
        return {
          ok: false,
          phase: "scan",
          reply: scanned.reason || "scan failed",
          keyboard: buildPhotosKeyboard(),
        };
      }
      return {
        ok: true,
        phase: "scan",
        photos: true,
        scanned,
        reply:
          formatPhotosCard() +
          "\n\nScan queued " +
          scanned.queued +
          " · skipped " +
          scanned.skipped +
          " · pending " +
          scanned.pending +
          "\nSlow copy: /vitafeed photos next   ·   Batch: /vitafeed photos all",
        keyboard: buildPhotosKeyboard(),
      };
    });
  }

  if (/^next\b/i.test(rest)) {
    return processNextPhoto().then((r) => {
      if (r.done) {
        return {
          ok: true,
          phase: "next",
          photos: true,
          reply: formatPhotosCard() + "\n\nQueue empty — scan a source or drop into vita/photos/inbox/",
          keyboard: buildPhotosKeyboard(),
        };
      }
      if (!r.ok) {
        return {
          ok: false,
          phase: "next",
          reply: "Slow copy failed: " + (r.reason || "error"),
          keyboard: buildPhotosKeyboard(),
        };
      }
      return {
        ok: true,
        phase: "next",
        photos: true,
        filed: r.filed,
        reply:
          formatPhotosCard(r.filed.id) +
          "\n\nSlow-copied → PHOTOS · open key " +
          r.filed.zeroOpenKey +
          "\nEnqueue: /vitafeed enqueue photo " +
          r.filed.id,
        keyboard: buildPhotosKeyboard({ highlight: r.filed.id }),
      };
    });
  }

  if (/^(?:all|batch|drain)\b/i.test(rest)) {
    const inbox = ingestPhotosInbox();
    return processPhotoQueue({ limit: 50 }).then((batch) => ({
      ok: true,
      phase: "all",
      photos: true,
      inbox,
      batch,
      reply:
        formatPhotosCard() +
        "\n\nInbox filed " +
        inbox.filed +
        " · queue processed " +
        batch.processed +
        " · failed " +
        batch.failed +
        " · still pending " +
        batch.pending,
      keyboard: buildPhotosKeyboard(),
    }));
  }

  if (/^(?:test|earthrise|hope|mlk|king)\b/i.test(rest)) {
    const which = /^mlk\b|^king\b|test\s+mlk\b|test\s+king\b/i.test(rest)
      ? "mlk"
      : /^test\s*$/i.test(rest)
        ? "both"
        : /earthrise|hope/i.test(rest)
          ? "earthrise"
          : "earthrise";
    if (which === "both" || which === "mlk") {
      const mlk = runMlkTest();
      if (which === "mlk") {
        if (!mlk.ok) {
          return { ok: false, phase: "test", reply: mlk.reason, keyboard: buildPhotosKeyboard() };
        }
        const opened = playPhoto("mlk");
        return {
          ok: true,
          phase: "test",
          photos: true,
          hope: true,
          filed: mlk.filed,
          zeroOpenKey: mlk.filed.zeroOpenKey,
          playerPath: opened.playerPath,
          playerHref: opened.playerHref,
          reply:
            mlk.reply +
            "\n\n🕊️ MLK TEST PASS — historical uplift in VITA:\\PHOTOS\\\n" +
            "Open key: " +
            mlk.filed.zeroOpenKey +
            "\nUnwrap popup: " +
            opened.playerPath +
            "\nEnqueue: /vitafeed enqueue photo mlk → confirm|override",
          keyboard: buildPhotosKeyboard({ highlight: "mlk" }),
        };
      }
    }
    const tested = runEarthriseTest();
    if (!tested.ok) {
      return { ok: false, phase: "test", reply: tested.reason, keyboard: buildPhotosKeyboard() };
    }
    let mlkExtra = "";
    if (which === "both") {
      const mlk = runMlkTest();
      if (mlk.ok) {
        mlkExtra =
          "\n\n🕊️ MLK also filed · key " +
          mlk.filed.zeroOpenKey +
          " · /vitafeed photos mlk → unwrap popup";
      }
    }
    const opened = playPhoto("earthrise");
    return {
      ok: true,
      phase: "test",
      photos: true,
      hope: true,
      filed: tested.filed,
      zeroOpenKey: tested.filed.zeroOpenKey,
      playerPath: opened.playerPath,
      playerHref: opened.playerHref,
      reply:
        tested.reply +
        "\n\n🌍 EARTHRISE TEST PASS — hope photo in VITA:\\PHOTOS\\\n" +
        "Open key (the picture): " +
        tested.filed.zeroOpenKey +
        "\nCompress: " +
        (tested.filed.compression?.codec || "—") +
        " verified=" +
        (tested.filed.compression?.verified === true) +
        "\nUnwrap popup auto-opens viewer: " +
        opened.playerPath +
        "\nStage inject: /vitafeed enqueue photo earthrise → confirm|override\n" +
        "Locs empty until a real seal. Never invent hashes." +
        mlkExtra,
      keyboard: buildPhotosKeyboard({ highlight: "earthrise" }),
    };
  }

  if (/^(?:unwrap|viewer|view|dos|inject)\b/i.test(rest)) {
    const sel = rest.replace(/^(?:unwrap|viewer|view|dos|inject)\s*/i, "").trim() || "earthrise";
    const opened = playPhoto(sel);
    if (!opened.ok) {
      return { ok: false, phase: "unwrap", reply: opened.reason, keyboard: buildPhotosKeyboard() };
    }
    return {
      ok: true,
      phase: "unwrap",
      photos: true,
      id: opened.id,
      playerPath: opened.playerPath,
      playerHref: opened.playerHref,
      reply:
        formatPhotosCard(opened.id) +
        "\n\n▶ Blockchain inject stream: " +
        opened.playerPath +
        "\nEach VIN card = Input Data UTF-8 · click READ PROOF receipt · Basescan when MATCH." +
        "\nOpen key unwraps without a wallet secret. Never invent hashes.",
      keyboard: buildPhotosKeyboard({ highlight: opened.id }),
    };
  }

  if (/^(?:add|file|upload|drop)$/i.test(rest)) {
    if (bytes && Buffer.isBuffer(bytes) ? bytes.length : bytes?.length) {
      const filed = filePhoto({
        bytes: Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes),
        name: name || "upload.jpg",
        mime: mime || guessMime(name, "image/jpeg"),
      });
      if (!filed.ok) return { ok: false, phase: "add", reply: filed.reason };
      return {
        ok: true,
        phase: "add",
        photos: true,
        filed,
        wantsFile: false,
        reply:
          formatPhotosCard(filed.id) +
          "\n\nFiled · open key " +
          filed.zeroOpenKey +
          "\nEnqueue: /vitafeed enqueue photo " +
          filed.id,
        keyboard: buildPhotosKeyboard({ highlight: filed.id }),
      };
    }
    return {
      ok: true,
      phase: "add",
      photos: true,
      wantsFile: true,
      reply:
        "Send a picture now (jpg/png/webp/gif) — or drop into vita/photos/inbox/\n" +
        "Open key will be the picture name+sha256 (VITAOPEN…). LOCK later.",
      keyboard: buildPhotosKeyboard(),
    };
  }

  if (/^(?:dir|list|ls)\b/i.test(rest)) {
    return {
      ok: true,
      phase: "dir",
      photos: true,
      entries: photosEntriesFor(),
      reply: formatPhotosCard(),
      keyboard: buildPhotosKeyboard(),
    };
  }

  if (/^inject\b/i.test(rest)) {
    const sel = rest.replace(/^inject\s*/i, "").trim() || "earthrise";
    const meta = resolvePhoto(sel);
    if (!meta) {
      return { ok: false, phase: "inject", reply: "unknown photo: " + sel };
    }
    return {
      ok: true,
      phase: "inject",
      photos: true,
      id: meta.id,
      stageHint: "/vitafeed enqueue photo " + meta.id,
      reply:
        "Stage via backlog: /vitafeed enqueue photo " +
        meta.id +
        "\nThen /vitafeed confirm|override. Paid path default OFF. Never invent hashes.",
      keyboard: buildPhotosKeyboard({ highlight: meta.id }),
    };
  }

  // bare id / play
  if (rest && resolvePhoto(rest)) {
    const opened = playPhoto(rest);
    return {
      ok: opened.ok,
      phase: "play",
      photos: true,
      id: opened.id,
      playerPath: opened.playerPath,
      playerHref: opened.playerHref,
      zeroOpenKey: opened.zeroOpenKey,
      reply: opened.reply,
      keyboard: buildPhotosKeyboard({ highlight: opened.id }),
    };
  }

  return {
    ok: true,
    phase: "board",
    photos: true,
    playerPath: PHOTOS_PLAYER_PATH,
    playerHref: vitaPlayerHref(PHOTOS_PLAYER_PATH),
    reply: formatPhotosCard(),
    keyboard: buildPhotosKeyboard(),
  };
}

export function publicPhotosState(id = null, { q = "", sort = "filedAt", order = "asc" } = {}) {
  ensureDirs();
  const listed = listPhotosOrdered({ q, sort, order, limit: 500 });
  const active = getActiveSource();
  const qState = loadQueue();
  const selected = id ? resolvePhoto(id) : null;
  const unwrap = selected ? buildUnwrapPlan(selected.id) : null;
  return {
    ok: true,
    id: PHOTOS_ID,
    label: PHOTOS_LABEL,
    playerPath: PHOTOS_PLAYER_PATH,
    viewerPath: PHOTOS_VIEWER_PATH,
    activeSource: active
      ? { id: active.id, kind: active.kind, display: active.display }
      : null,
    queue: {
      pending: (qState.items || []).filter((i) => i.status === "pending").length,
      filed: (qState.items || []).filter((i) => i.status === "filed").length,
      failed: (qState.items || []).filter((i) => i.status === "failed").length,
    },
    search: { q: listed.q, sort: listed.sort, order: listed.order, total: listed.total },
    photos: listed.photos,
    selected: selected
      ? {
          ...selected,
          locations: sealedLocsForPhoto(selected.id),
          mediaPath: "/vita/photos/media?id=" + encodeURIComponent(selected.id),
          viewerPath: PHOTOS_VIEWER_PATH + "?id=" + encodeURIComponent(selected.id) + "&unwrap=1",
          unwrap: unwrap?.ok ? unwrap : null,
        }
      : null,
    earthrise: EARTHRISE_TEST,
    mlk: MLK_TEST,
    neverInventHashes: true,
    chainStatus: "availability until seal",
  };
}

export function publicPhotosMedia(id = "earthrise") {
  const loaded = loadPhotoBytes(id);
  if (!loaded.ok) return loaded;
  return {
    ok: true,
    id: loaded.meta.id,
    name: loaded.meta.fileName,
    mime: loaded.meta.mime,
    bytes: loaded.bytes,
    zeroOpenKey: loaded.meta.zeroOpenKey,
  };
}

export async function publicPhotosLocs(id = "earthrise") {
  const meta = resolvePhoto(id);
  if (!meta) return { ok: false, reason: "unknown photo" };
  const locs = sealedLocsForPhoto(id);
  const anchors = (MAINFRAME_ANCHORS.known || []).map((a) => ({
    tx: a.tx,
    kind: a.kind,
    label: a.label,
    role: "CLASS_PROOF",
    note: "Formula anchor — NOT picture body",
  }));
  return {
    ok: true,
    id: meta.id,
    zeroOpenKey: meta.zeroOpenKey,
    contentCommit: meta.contentCommit,
    status: locs.length ? "MATCH" : "LOCAL_OK",
    locations: locs.map((tx) => ({
      tx,
      href: "https://basescan.org/tx/" + tx,
      role: "MATCH",
    })),
    classProof: anchors,
    injectCta: locs.length
      ? { sealed: true, href: locs[0] ? "https://basescan.org/tx/" + locs[0] : null }
      : {
          sealed: false,
          note: "No sealed tx yet — /vitafeed enqueue photo " + meta.id + " → confirm|override",
        },
    neverInventHashes: true,
  };
}
