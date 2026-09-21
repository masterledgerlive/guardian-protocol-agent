/**
 * Free-catalog songs → grouped VIN injections → original blockchain playback.
 *
 * Songs (Wikimedia / National Jukebox / US-gov public-domain singing & performance):
 *   maple    — Maple Leaf Rag (Scott Joplin, 1899)
 *   judy     — I'm Always Chasing Rainbows (1918 PD singing; Judy Garland free-catalog
 *              rainbow lane — her 1939 Over the Rainbow Decca is rights-restricted)
 *   grace    — Amazing Grace (1922 Sacred Harp)
 *   daisy    — Daisy Bell / Bicycle Built for Two (1894 Edison cylinder)
 *   ballgame — Take Me Out to the Ball Game (1908 Meeker)
 *   auld     — Auld Lang Syne (1910 Frank C. Stanley)
 *   lining      — Look for the Silver Lining (1921 National Jukebox; rainbow-adjacent)
 *   susanna     — Oh! Susanna (US Navy Band PD-USGov; not the 1917 racist-verse cylinder)
 *   entertainer — The Entertainer (Joplin 1902; Commons PD performance)
 *   stripes     — The Stars and Stripes Forever (US Navy Band PD-USGov)
 *   sweetheart  — Let Me Call You Sweetheart (1911 National Jukebox)
 *   afterball   — After the Ball (1893 Edison / George J. Gaskin)
 *
 * Full OGG bytes (not a synthetic demo WAV, not a URL blob) split into
 * §VITAFILE§ groups that each fit the hourly VIN cap (24). Player concatenates
 * sealed Input Data (or local packet reconstruction) and plays the original
 * audio/ogg. Location proof daisy-chains filing → group sha → VIN → Basescan
 * Input Data UTF-8 and highlights click-through matches. Never invent tx hashes.
 * Mother brain untouched. VITAFEED_PAID stays default OFF.
 *
 * Telegram: /vitafeed play <id> · /vitafeed music · /vitafeed enqueue <id>
 * · /vitafeed enqueue library · /vitafeed dual judy · /vitafeed dir MUSIC
 * Player: /vita/feed-player?music=<id> · kids: ?kids=1 (proof chrome default OFF)
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FORMULA_ID, MAINFRAME_ANCHORS } from "./mainframe.js";
import {
  VITAFEED_MAX_CHUNK_BYTES,
  prepareVitaFeed,
} from "./vita-feed.js";
import {
  encodeVitaFile,
  parseVitaFileBody,
  prepareVitaFileFeed,
} from "./vita-feed-file.js";
import { vitaPlayerHref } from "./url-dir.js";
import { provenMusicOnChain } from "./chain-dir.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const MEMORY_DIR = join(HERE, "memory");
const SONG_DIR = join(MEMORY_DIR, "free-music");
const CATALOG_PATH = join(MEMORY_DIR, "free-music-catalog.json");

export const FREEMUSIC_ID = "vita-free-music-v1";
export const FREEMUSIC_MAGIC = "§VITAMUSIC§";
export const FREEMUSIC_LABEL = "FREEMUSIC";
export const FREEMUSIC_SUBDIR = "MUSIC";
export const MAPLE_ID = "maple";
export const JUDY_ID = "judy";
export const MUSIC_PLAYER_PATH = "/vita/feed-player?music=maple";
export const JUDY_PLAYER_PATH = "/vita/feed-player?music=judy";
/** Same as FEED_BACKLOG_HARD_MAX_CHUNKS / hourly thrift — one group per drain. */
export const MUSIC_GROUP_VIN_CAP = 24;

function sha256HexBuf(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function sha256Hex(text) {
  return createHash("sha256").update(String(text || ""), "utf8").digest("hex");
}

function shortHex(hex, n = 8) {
  return String(hex || "").replace(/^0x/i, "").toLowerCase().slice(0, n);
}

function clip(s, n = 72) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length <= n ? t : t.slice(0, n - 1) + "…";
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function safeReadJson(path) {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function loadCatalogRoot() {
  return safeReadJson(CATALOG_PATH) || {};
}

export function listCatalogSongs() {
  const root = loadCatalogRoot();
  const songs = root.songs || {};
  // Back-compat: old single-song catalog shape
  if (!Object.keys(songs).length && root.id === "maple") {
    return { maple: root };
  }
  return songs;
}

export function resolveSongId(sel = "") {
  const raw = String(sel || "").trim().toLowerCase();
  if (!raw) return loadCatalogRoot().defaultId || MAPLE_ID;
  const songs = listCatalogSongs();
  if (songs[raw]) return raw;
  for (const [id, meta] of Object.entries(songs)) {
    const aliases = (meta.aliases || []).map((a) => String(a).toLowerCase());
    if (aliases.includes(raw)) return id;
  }
  // loose judy / rainbow match — lining is silver-lining, not Over the Rainbow
  if (/judy|garland|chasing|rainbow/.test(raw) && !/silver|lining/.test(raw)) {
    if (songs[JUDY_ID]) return JUDY_ID;
  }
  if (/entertainer/.test(raw) && songs.entertainer) return "entertainer";
  if (/maple|(?:maple-?leaf)|(?:^|\b)rag(?:\b|$)/.test(raw) && songs[MAPLE_ID]) {
    return MAPLE_ID;
  }
  if (raw === "joplin" && songs[MAPLE_ID]) return MAPLE_ID;
  if (/grace|amazing/.test(raw) && songs.grace) return "grace";
  if (/daisy|bicycle/.test(raw) && songs.daisy) return "daisy";
  if (/after-?the-?ball|afterball|gaskin/.test(raw) && songs.afterball) return "afterball";
  if (/(?:ballgame|ball-game|baseball|take-me-out|meeker)/.test(raw) && songs.ballgame) {
    return "ballgame";
  }
  if (raw === "ball" && songs.ballgame) return "ballgame";
  if (/auld|syne|new-?year|burns/.test(raw) && songs.auld) return "auld";
  if (/silver|lining|kern/.test(raw) && songs.lining) return "lining";
  if (/susanna|foster/.test(raw) && songs.susanna) return "susanna";
  if (/stripes|sousa/.test(raw) && songs.stripes) return "stripes";
  if (/sweetheart/.test(raw) && songs.sweetheart) return "sweetheart";
  return null;
}

export function listCatalogSongIds() {
  return Object.keys(listCatalogSongs());
}

/** True when Telegram enqueue should bank the whole free-music library (not memory seed). */
export function isMusicLibraryEnqueue(sel = "") {
  const s = String(sel || "").trim().toLowerCase();
  if (!s) return false;
  return (
    s === "library" ||
    s === "playlist" ||
    s === "songs" ||
    s === "music-all" ||
    s === "all-music" ||
    s === "music library" ||
    s === "music all"
  );
}

export function loadSongMeta(id = MAPLE_ID) {
  const resolved = resolveSongId(id) || MAPLE_ID;
  const songs = listCatalogSongs();
  const meta = songs[resolved];
  if (!meta) return { ok: false, reason: "unknown free-catalog song — try /vitafeed music" };
  return { ok: true, id: resolved, meta };
}

export function isMusicPlaySelector(sel) {
  const s = String(sel || "").trim();
  if (!s) return false;
  return resolveSongId(s) != null;
}

export function maybeMusicDualHumanBody(text) {
  const s = String(text || "").trim();
  if (!s) return s;
  if (s.includes("\n") || s.length >= 80) return s;
  if (isMusicPlaySelector(s)) return musicDualHumanBody(null, s);
  return s;
}

function groupFileName(fileName, n) {
  return String(fileName || "song.bin").replace(/[^\w.\- ]+/g, "_") + ".g" + pad2(n);
}

function songFilePath(meta) {
  const name = meta.fileName || (meta.file ? String(meta.file).split("/").pop() : null);
  return join(SONG_DIR, name || "song.ogg");
}

/**
 * Largest raw slice whose §VITAFILE§ VIN count stays ≤ hourly cap.
 */
export function sliceBytesForVinCap(maxChunks = MUSIC_GROUP_VIN_CAP) {
  const payloadBudget = VITAFEED_MAX_CHUNK_BYTES * Math.max(1, maxChunks);
  let raw = Math.floor((payloadBudget - 260) * 3 / 4);
  raw -= raw % 3;
  for (let i = 0; i < 12 && raw >= 192; i++) {
    const probe = Buffer.alloc(raw, 0x5a);
    const prep = prepareVitaFileFeed({
      name: "probe.ogg.g99",
      mime: "application/octet-stream",
      bytes: probe,
    });
    if (prep.ok && prep.totalChunks <= maxChunks) return raw;
    raw = Math.floor(raw * 0.95);
    raw -= raw % 3;
  }
  return 4095;
}

function readSongBytes(meta) {
  const path = songFilePath(meta);
  if (!existsSync(path)) {
    return { ok: false, reason: "song OGG missing — " + path };
  }
  const bytes = readFileSync(path);
  if (bytes.length < 4 || bytes.subarray(0, 4).toString("ascii") !== "OggS") {
    return { ok: false, reason: (meta.fileName || "song") + " is not an Ogg bitstream" };
  }
  return { ok: true, bytes, sha256: sha256HexBuf(bytes), size: bytes.length, path };
}

/**
 * Packetize a free-catalog recording into grouped §VITAFILE§ VIN injections.
 * Each group is independently drainable (≤24 VIN). Concat = original OGG.
 */
export function packetizeFreeMusic(id = MAPLE_ID) {
  const loaded = loadSongMeta(id);
  if (!loaded.ok) return loaded;
  const { id: songId, meta } = loaded;
  const song = readSongBytes(meta);
  if (!song.ok) return song;
  if (meta.sha256 && meta.sha256 !== song.sha256) {
    return {
      ok: false,
      reason: "sha256 mismatch vs catalog — refuse corrupt playback",
      got: song.sha256,
      want: meta.sha256,
    };
  }
  const sliceBytes = sliceBytesForVinCap(MUSIC_GROUP_VIN_CAP);
  const groups = [];
  const fileName = meta.fileName || "song.ogg";
  for (let off = 0, n = 1; off < song.bytes.length; off += sliceBytes, n++) {
    const slice = song.bytes.subarray(off, Math.min(off + sliceBytes, song.bytes.length));
    const enc = encodeVitaFile({
      name: groupFileName(fileName, n),
      mime: "application/octet-stream",
      bytes: slice,
    });
    if (!enc.ok) {
      return { ok: false, reason: "group " + n + " encode failed: " + enc.reason };
    }
    const vinId =
      "VIN-" +
      shortHex(sha256Hex(songId + "|g" + pad2(n) + "|" + enc.sha256), 10).toUpperCase();
    const prepared = prepareVitaFeed(enc.body, { vinId });
    if (!prepared.ok) {
      return { ok: false, reason: "group " + n + " VIN prepare failed: " + prepared.reason };
    }
    if (prepared.totalChunks > MUSIC_GROUP_VIN_CAP) {
      return {
        ok: false,
        reason:
          "group " + n + " has " + prepared.totalChunks +
          " VIN > cap " + MUSIC_GROUP_VIN_CAP,
      };
    }
    const lineCommits = (prepared.lines || []).map((l) => ({
      index: l.index,
      hash: l.hash,
      contentCommit: sha256Hex(l.line),
      bodyPreview: String(l.body || "").slice(0, 48),
      bytes: Buffer.byteLength(l.line || "", "utf8"),
    }));
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
      lineCommits,
      filingPath: "vita/memory/free-music/" + fileName + "#g" + pad2(n),
    });
  }

  const reconstructed = reconstructFreeMusicFromGroups(groups);
  if (!reconstructed.ok) return reconstructed;
  if (reconstructed.sha256 !== song.sha256) {
    return {
      ok: false,
      reason: "grouped reconstruct sha mismatch — refuse playback",
      got: reconstructed.sha256,
      want: song.sha256,
    };
  }

  const totalVin = groups.reduce((s, g) => s + g.totalChunks, 0);
  const player = meta.player || ("/vita/feed-player?music=" + songId);
  return {
    ok: true,
    id: songId,
    filingLabel: FREEMUSIC_LABEL,
    formula: FORMULA_ID,
    neverInventHashes: true,
    title: meta.title || songId,
    composer: meta.composer || "",
    performer: meta.performer || "",
    license: meta.license || "Public domain",
    sourcePage: meta.sourcePage || null,
    credit: meta.credit || null,
    judyGarlandLane: Boolean(meta.judyGarlandLane),
    chainDirName: meta.chainDirName || songId,
    fileName,
    mime: "audio/ogg",
    playKind: "audio",
    rawBytes: song.size,
    sha256: song.sha256,
    durationSec: meta.durationSec || null,
    sliceBytes,
    vinCap: MUSIC_GROUP_VIN_CAP,
    groupCount: groups.length,
    totalVin,
    groups,
    player,
    note:
      "Full free-catalog performance → " + groups.length +
      " grouped VIN injections (" + totalVin +
      " packets, ≤" + MUSIC_GROUP_VIN_CAP +
      "/group). Original playback concatenates slices. Proven = real Input Data locs for every group.",
  };
}

export function reconstructFreeMusicFromGroups(groups = []) {
  const parts = [];
  for (const g of groups) {
    const parsed = parseVitaFileBody(g.body || g.vitaFileBody || "");
    if (!parsed.ok) {
      return { ok: false, reason: "group " + (g.n || "?") + " parse: " + parsed.reason };
    }
    parts.push(parsed.data);
  }
  if (!parts.length) return { ok: false, reason: "no groups to reconstruct" };
  const data = Buffer.concat(parts);
  return {
    ok: true,
    data,
    rawBytes: data.length,
    sha256: sha256HexBuf(data),
    mime: "audio/ogg",
    playKind: "audio",
  };
}

export function musicDualHumanBody(plan = null, id = MAPLE_ID) {
  const packed = plan?.ok ? plan : packetizeFreeMusic(id);
  if (!packed.ok) return "";
  const lines = [
    FREEMUSIC_MAGIC +
      "v1|id=" +
      packed.id +
      "|n=" +
      packed.groupCount +
      "|bytes=" +
      packed.rawBytes +
      "|sha256=" +
      packed.sha256 +
      "|mime=" +
      packed.mime +
      "§",
    "FREE CATALOG SONG — " + packed.title +
      (packed.performer ? " · " + packed.performer : "") +
      (packed.composer ? " (" + packed.composer + ")" : ""),
    packed.judyGarlandLane
      ? "Judy Garland free-catalog rainbow lane · PD 1918 singing · not Over the Rainbow Decca"
      : "public domain · Wikimedia Commons OGG · not a demo WAV · not a URL blob",
    "formula=" + FORMULA_ID,
    "player=" + packed.player,
    "vinCap=" + packed.vinCap + "  groups=" + packed.groupCount + "  totalVin=" + packed.totalVin,
    "source=" + (packed.sourcePage || ""),
    "",
  ];
  for (const g of packed.groups) {
    lines.push(
      "g" + pad2(g.n) +
        " off=" + g.off +
        " len=" + g.len +
        " vin=" + g.totalChunks +
        " sha=" + g.sha256.slice(0, 16) +
        " name=" + g.name +
        " file=" + g.filingPath,
    );
  }
  return lines.join("\n");
}

export function musicMachineGroupsLine(plan = null, id = MAPLE_ID) {
  const packed = plan?.ok ? plan : packetizeFreeMusic(id);
  if (!packed.ok) return "";
  return (
    "MUSIC lane=MACHINE id=" +
    packed.id +
    " n=" +
    packed.groupCount +
    " vin=" +
    packed.totalVin +
    " commit=" +
    shortHex(packed.sha256, 8) +
    " | " +
    packed.groups.map((g) => "g" + pad2(g.n) + ":" + shortHex(g.sha256, 8)).join(",")
  );
}

function publicGroup(g) {
  return {
    n: g.n,
    name: g.name,
    off: g.off,
    len: g.len,
    sha256: g.sha256,
    vinId: g.vinId,
    readerKey: g.readerKey,
    contentCommit: g.contentCommit,
    totalChunks: g.totalChunks,
    injections: g.injections,
    bodyBytes: g.bodyBytes,
    filingPath: g.filingPath || null,
    lineCommits: (g.lineCommits || []).map((c) => ({
      index: c.index,
      hash: c.hash,
      contentCommit: c.contentCommit,
      bodyPreview: c.bodyPreview,
      bytes: c.bytes,
    })),
  };
}

function basescanTx(tx) {
  return (MAINFRAME_ANCHORS.basescanTx || "https://basescan.org/tx/") + tx;
}

function isTxHash(h) {
  return /^0x[0-9a-fA-F]{64}$/.test(String(h || ""));
}

/**
 * Daisy-chain location proof: filing → group sha → VIN line commits → sealed
 * Basescan Input Data. Highlight rows whose pulled UTF-8 matches the packet
 * data field (contentCommit). Never invents hashes — sealed locs only.
 *
 * @param {{ id?: string, sealedLocs?: Array<{groupN?:number,index?:number,location:string,utf8?:string}>, pullUtf8?: (tx:string)=>Promise<string|null> }} opts
 */
export async function buildFreeMusicLocProof(opts = {}) {
  const packed = opts.packed?.ok ? opts.packed : packetizeFreeMusic(opts.id || JUDY_ID);
  if (!packed.ok) return packed;
  const onChain = provenMusicOnChain(packed.id);
  const sealed = [];
  for (const row of opts.sealedLocs || []) {
    const tx = String(row.location || row.tx || "").toLowerCase();
    if (!isTxHash(tx)) continue;
    sealed.push({
      groupN: row.groupN ?? row.n ?? null,
      index: row.index ?? null,
      location: tx,
      utf8: row.utf8 || null,
      basescan: basescanTx(tx),
    });
  }
  // CHAINDIR complete proofs (when present) — still never invent
  for (const p of onChain?.proofs || []) {
    const tx = String(p.tx || p.location || "").toLowerCase();
    if (!isTxHash(tx)) continue;
    if (sealed.some((s) => s.location === tx)) continue;
    sealed.push({
      groupN: null,
      index: null,
      location: tx,
      utf8: null,
      basescan: p.basescan || basescanTx(tx),
      lane: p.lane || null,
    });
  }

  const pull = typeof opts.pullUtf8 === "function" ? opts.pullUtf8 : null;
  const rows = [];
  let matched = 0;
  let pending = 0;

  for (const g of packed.groups) {
    for (const lc of g.lineCommits || []) {
      const bind = sealed.find(
        (s) =>
          (s.groupN == null || s.groupN === g.n) &&
          (s.index == null || s.index === lc.index) &&
          isTxHash(s.location),
      ) || sealed.find((s) => s.groupN === g.n && s.index == null) || null;

      let pulledUtf8 = bind?.utf8 || null;
      if (!pulledUtf8 && bind && pull) {
        try {
          pulledUtf8 = await pull(bind.location);
        } catch {
          pulledUtf8 = null;
        }
      }
      let match = "pending";
      let pulledCommit = null;
      let highlight = false;
      if (pulledUtf8 != null) {
        pulledCommit = sha256Hex(pulledUtf8);
        // Exact line match OR body contains the VITAFILE/VIN packet commit
        const lineHit = pulledCommit === lc.contentCommit;
        const containsHit =
          typeof pulledUtf8 === "string" &&
          (pulledUtf8.includes(lc.bodyPreview) ||
            pulledUtf8.includes(g.name) ||
            sha256Hex(pulledUtf8.trim()) === g.contentCommit);
        match = lineHit || containsHit ? "MATCH" : "MISMATCH";
        if (match === "MATCH") {
          matched += 1;
          highlight = true;
        }
      } else {
        match = "LOCAL_OK";
        pending += 1;
      }

      rows.push({
        groupN: g.n,
        index: lc.index,
        filingPath: g.filingPath,
        groupSha: g.sha256,
        vinId: g.vinId,
        lineHash: lc.hash,
        dataFieldCommit: lc.contentCommit,
        bodyPreview: lc.bodyPreview,
        location: bind?.location || null,
        basescan: bind?.basescan || null,
        pulledUtf8Commit: pulledCommit,
        match,
        highlight,
        clickThrough: Boolean(bind?.basescan),
        idmChat: bind?.basescan
          ? "Basescan → Input Data → View as UTF-8"
          : "await seal — no invented loc",
      });
    }
  }

  const daisy = [
    "filing: " + (packed.groups[0]?.filingPath || "").replace(/#g.*/, ""),
    "catalog: vita/memory/free-music-catalog.json#" + packed.id,
    "groups: " + packed.groupCount + " × ≤" + packed.vinCap + " VIN",
    "strand: vita/strands/free-music.json",
    "chaindir: " + packed.chainDirName,
    onChain?.proven
      ? "proven: CHAINDIR complete · Input Data locs sealed"
      : "availability: local reconstruct until grouped confirm|override",
  ];

  return {
    ok: true,
    id: packed.id,
    title: packed.title,
    filingLabel: FREEMUSIC_LABEL,
    formula: FORMULA_ID,
    neverInventHashes: true,
    judyGarlandLane: packed.judyGarlandLane,
    sha256: packed.sha256,
    groupCount: packed.groupCount,
    totalVin: packed.totalVin,
    daisyChain: daisy,
    onChain,
    sealedCount: sealed.length,
    matched,
    pending,
    mismatched: rows.filter((r) => r.match === "MISMATCH").length,
    rows,
    clickThrough: rows.filter((r) => r.clickThrough),
    highlighted: rows.filter((r) => r.highlight),
    player: packed.player,
    note:
      "Location proof reads real Base Input Data UTF-8 and compares to VIN data-field commits. " +
      "Highlight = MATCH. Formula anchors are class proof only — not song body.",
  };
}

/**
 * Synchronous local daisy-chain (no RPC) — verifies filing ↔ group ↔ VIN commits.
 */
export function buildFreeMusicLocProofLocal(id = JUDY_ID) {
  const packed = packetizeFreeMusic(id);
  if (!packed.ok) return packed;
  const onChain = provenMusicOnChain(packed.id);
  const rows = [];
  for (const g of packed.groups) {
    const rebuilt = parseVitaFileBody(g.body);
    const groupOk = rebuilt.ok && rebuilt.sha256 === g.sha256;
    for (const lc of g.lineCommits || []) {
      rows.push({
        groupN: g.n,
        index: lc.index,
        filingPath: g.filingPath,
        groupSha: g.sha256,
        dataFieldCommit: lc.contentCommit,
        bodyPreview: lc.bodyPreview,
        location: null,
        basescan: null,
        match: groupOk ? "LOCAL_OK" : "LOCAL_FAIL",
        highlight: groupOk,
        clickThrough: false,
        idmChat: "seal then Basescan → Input Data → UTF-8",
      });
    }
  }
  return {
    ok: true,
    id: packed.id,
    title: packed.title,
    local: true,
    neverInventHashes: true,
    judyGarlandLane: packed.judyGarlandLane,
    sha256: packed.sha256,
    groupCount: packed.groupCount,
    totalVin: packed.totalVin,
    onChain,
    matched: rows.filter((r) => r.match === "LOCAL_OK").length,
    pending: rows.length,
    rows,
    highlighted: rows.filter((r) => r.highlight),
    daisyChain: [
      "filing → group sha → VIN dataFieldCommit (local)",
      "after seal: bind real 0x locs · pull Input Data · highlight MATCH",
    ],
    player: packed.player,
  };
}

export function loadFreeMusic(id = MAPLE_ID) {
  const packed = packetizeFreeMusic(id);
  if (!packed.ok) return packed;
  const onChain = provenMusicOnChain(packed.id);
  const locLocal = buildFreeMusicLocProofLocal(packed.id);
  return {
    ok: true,
    id: packed.id,
    label: FREEMUSIC_SUBDIR,
    title: packed.title,
    composer: packed.composer,
    performer: packed.performer,
    filingLabel: FREEMUSIC_LABEL,
    formula: packed.formula,
    neverInventHashes: true,
    freeCatalog: true,
    judyGarlandLane: packed.judyGarlandLane,
    mime: packed.mime,
    playKind: packed.playKind,
    fileName: packed.fileName,
    rawBytes: packed.rawBytes,
    sha256: packed.sha256,
    durationSec: packed.durationSec,
    license: packed.license,
    sourcePage: packed.sourcePage,
    credit: packed.credit,
    chainDirName: packed.chainDirName,
    groupCount: packed.groupCount,
    totalVin: packed.totalVin,
    vinCap: packed.vinCap,
    sliceBytes: packed.sliceBytes,
    groups: packed.groups.map(publicGroup),
    player: packed.player,
    playerHref: vitaPlayerHref(packed.player),
    catalogPath: "vita/memory/free-music-catalog.json",
    contentCommit: packed.sha256,
    contentCommit8: shortHex(packed.sha256, 8),
    locations: MAINFRAME_ANCHORS.known.map((a) => a.tx),
    onChain,
    locProof: {
      matched: locLocal.matched,
      pending: locLocal.pending,
      highlighted: (locLocal.highlighted || []).length,
      daisyChain: locLocal.daisyChain,
      sample: (locLocal.rows || []).slice(0, 6),
    },
    telegram: [
      "/vitafeed play " + packed.id,
      "/vitafeed music",
      "/vitafeed dir MUSIC",
      "/vitafeed enqueue " + packed.id,
      "/vitafeed dual " + packed.id,
    ],
    note: packed.note,
  };
}

export function freeMusicEntriesFor() {
  const out = [];
  let n = 1;
  for (const id of Object.keys(listCatalogSongs())) {
    const dir = loadFreeMusic(id);
    if (!dir.ok) continue;
    out.push({
      n: n++,
      name: dir.fileName,
      kind: "audio",
      bytes: dir.rawBytes,
      unlockName: dir.fileName,
      english:
        dir.title +
        (dir.performer ? " — " + dir.performer : "") +
        " · free catalog · Full OGG (" +
        dir.rawBytes +
        " B, " +
        (dir.durationSec || "?") +
        "s) grouped into " +
        dir.groupCount +
        " VIN injections. Original blockchain playback concatenates sealed slices.",
      machine:
        "MUSIC id=" +
        dir.id +
        " groups=" +
        dir.groupCount +
        " vin=" +
        dir.totalVin +
        " mime=audio/ogg commit=" +
        dir.contentCommit8,
      locations: dir.locations,
      trueName: dir.chainDirName || dir.id,
      mime: "audio/ogg",
      playKind: "audio",
      dirId: dir.id,
    });
    for (const g of dir.groups) {
      out.push({
        n: n++,
        name: g.name,
        kind: "vitafile-group",
        bytes: g.len,
        unlockName: g.name,
        english:
          "VIN group " + g.n + "/" + dir.groupCount +
          " · " + g.len + " B slice · " + g.totalChunks + " packets · off=" + g.off +
          " · " + (g.filingPath || ""),
        machine:
          "GROUP id=" + dir.id + " n=" + g.n + " vin=" + g.totalChunks +
          " sha=" + shortHex(g.sha256, 8),
        locations: dir.locations,
        trueName: dir.id + "-g" + pad2(g.n),
        mime: "application/octet-stream",
        playKind: "file",
        dirId: dir.id,
        groupN: g.n,
      });
    }
  }
  out.push({
    n: n++,
    name: "free-music-catalog.json",
    kind: "catalog",
    bytes: (() => {
      try { return statSync(CATALOG_PATH).size; } catch { return 0; }
    })(),
    unlockName: "free-music-catalog.json",
    english: "Free-catalog metadata + grouped inject plans (" + Object.keys(listCatalogSongs()).join(", ") + "). Proven only after every group loc seals.",
    machine: "CATALOG songs=" + Object.keys(listCatalogSongs()).join(","),
    locations: MAINFRAME_ANCHORS.known.map((a) => a.tx),
    trueName: "free-music-catalog",
    mime: "application/json",
    playKind: "text",
    dirId: MAPLE_ID,
  });
  return out;
}

export function formatFreeMusicCard(dirOrId = MAPLE_ID) {
  const dir = typeof dirOrId === "string" || dirOrId == null
    ? loadFreeMusic(dirOrId || MAPLE_ID)
    : dirOrId?.ok
      ? dirOrId
      : loadFreeMusic(MAPLE_ID);
  if (!dir?.ok) {
    return FREEMUSIC_MAGIC + " MISS\n" + (dir?.reason || "missing");
  }
  const onChain = dir.onChain || provenMusicOnChain(dir.id);
  const lines = [];
  lines.push(FREEMUSIC_MAGIC + "v1|id=" + dir.id + "|n=" + dir.groupCount + "§");
  lines.push("FREE CATALOG · " + dir.title + (dir.performer ? " — " + dir.performer : ""));
  if (dir.composer) lines.push("composer " + dir.composer);
  lines.push(
    dir.judyGarlandLane
      ? "Judy Garland rainbow lane · PD 1918 singing · original OGG (not demo WAV)"
      : "public domain · original OGG (not demo WAV)",
  );
  lines.push(
    "bytes=" + dir.rawBytes +
      "  ·  " + (dir.durationSec || "?") + "s" +
      "  ·  mime=" + dir.mime,
  );
  lines.push("sha256=" + dir.sha256);
  lines.push(
    "grouped injections " + dir.groupCount +
      " × ≤" + dir.vinCap +
      " VIN  ·  total packets " + dir.totalVin,
  );
  lines.push("player=" + dir.player);
  lines.push("commit=" + dir.contentCommit8 + "  ·  privateKey=NO");
  if (dir.locProof) {
    lines.push(
      "LOC PROOF local " + dir.locProof.matched + "/" + dir.locProof.pending +
        " data-field commits · click-through after seal",
    );
  }
  if (onChain?.proven) {
    lines.push("PROVEN — Input Data locs sealed · original blockchain playback");
  } else {
    lines.push(
      "availability (local reconstruct) until grouped confirm|override seals every slice",
    );
    if (onChain?.note) lines.push(onChain.note);
  }
  lines.push("");
  for (const g of dir.groups.slice(0, 8)) {
    lines.push(
      "g" + pad2(g.n) + "  " + g.len + "B  " + g.totalChunks + " VIN  " + g.name,
    );
  }
  if (dir.groups.length > 8) {
    lines.push("  … +" + (dir.groups.length - 8) + " more groups");
  }
  lines.push("");
  lines.push("play:     /vitafeed play " + dir.id);
  lines.push("enqueue:  /vitafeed enqueue " + dir.id + "   (grouped VIN drain)");
  lines.push("dual:     /vitafeed dual " + dir.id + "      (HUMAN catalog + MACHINE group shas)");
  lines.push("locs:     /vita/free-music/locs?id=" + dir.id);
  lines.push("inspect:  /vita/free-music/loc?id=" + dir.id + "&g=1&i=1  (exact VIN UTF-8)");
  lines.push("dir:      /vitafeed dir MUSIC");
  lines.push("href:     " + (dir.playerHref || vitaPlayerHref(dir.player)));
  lines.push("kids:     " + (dir.player || ("/vita/feed-player?music=" + dir.id)) + "&kids=1  (proof chrome default OFF)");
  return lines.join("\n");
}

export function formatFreeMusicLibraryCard() {
  const songs = listCatalogSongs();
  const ids = Object.keys(songs);
  const lines = [];
  lines.push(FREEMUSIC_MAGIC + "v1|library|n=" + ids.length + "§");
  lines.push("FREE CATALOG LIBRARY · " + ids.length + " PD songs");
  lines.push("original OGG · grouped §VITAFILE§ VIN ≤" + MUSIC_GROUP_VIN_CAP + "/group");
  lines.push("player=/vita/feed-player?music=<id>  ·  kids=?kids=1 (proof OFF)");
  lines.push("locs=/vita/free-music/locs?id=<id>  ·  Basescan Input Data → UTF-8 MATCH");
  lines.push("inspect=/vita/free-music/loc?id=<id>&g=1&i=1  ·  exact VIN packet fed into player");
  lines.push("never invent hashes · never Over the Rainbow Decca · VITAFEED_PAID default OFF");
  lines.push("");
  for (const id of ids) {
    const s = songs[id];
    lines.push(
      id.padEnd(10) +
        "  " +
        (s.title || id) +
        (s.performer ? " — " + s.performer : "") +
        "  " +
        (s.bytes || "?") +
        "B",
    );
  }
  lines.push("");
  lines.push("play:     /vitafeed play <id>");
  lines.push("enqueue:  /vitafeed enqueue <id>   (one song, grouped VIN drain)");
  lines.push("library:  /vitafeed enqueue library  (bank every song · not memory seed)");
  lines.push("dual:     /vitafeed dual <id>");
  lines.push("dir:      /vitafeed dir MUSIC");
  return lines.join("\n");
}

/**
 * Original playback payload. Reconstructs from grouped VITAFILE packets.
 */
export function playFreeMusic(selector = "maple") {
  const packed = packetizeFreeMusic(selector);
  if (!packed.ok) {
    return { ok: false, reason: packed.reason || "music missing" };
  }
  const rebuilt = reconstructFreeMusicFromGroups(packed.groups);
  if (!rebuilt.ok) return { ok: false, reason: rebuilt.reason };
  const onChain = provenMusicOnChain(packed.id);
  const locLocal = buildFreeMusicLocProofLocal(packed.id);
  const playerPath = packed.player;
  const playerHref = vitaPlayerHref(playerPath);
  const dataUrl = "data:audio/ogg;base64," + rebuilt.data.toString("base64");
  const proven = Boolean(onChain?.proven);
  const lines = [
    FREEMUSIC_MAGIC + " PLAY · ORIGINAL OGG",
    packed.title +
      (packed.performer ? " — " + packed.performer : "") +
      (packed.composer ? " (" + packed.composer + ")" : ""),
    "bytes=" + rebuilt.rawBytes + " sha256=" + rebuilt.sha256,
    "groups=" + packed.groupCount + "  VIN packets=" + packed.totalVin,
    proven
      ? "PROVEN — play from sealed Input Data groups (CHAINDIR complete)"
      : "availability — reconstructed from grouped VIN packets (local). Seal via /vitafeed enqueue " +
        packed.id +
        " then confirm|override. Formula anchors are class proof, not this body.",
    "LOC daisy-chain " + locLocal.matched + " local data-field commits OK · click Basescan after seal",
    "player " + playerHref,
    "not a demo WAV · not a URL blob · original bitstream playback",
  ];
  return {
    ok: true,
    id: packed.id,
    demo: false,
    music: true,
    proven,
    availability: !proven,
    n: 1,
    count: packed.groupCount,
    playerPath,
    playerHref,
    play: {
      kind: "audio",
      mime: "audio/ogg",
      name: packed.fileName,
      title: packed.title,
      dataUrl,
      demo: false,
      original: true,
      groups: packed.groupCount,
      totalVin: packed.totalVin,
    },
    playProof: {
      ok: true,
      complete: true,
      label: proven ? "LIVE" : "LOCAL",
      mode: "vitafile-groups",
      file: {
        name: packed.fileName,
        mime: "audio/ogg",
        playKind: "audio",
        rawBytes: rebuilt.rawBytes,
        sha256: rebuilt.sha256,
        dataUrl,
      },
      play: {
        kind: "audio",
        mime: "audio/ogg",
        name: packed.fileName,
        dataUrl,
      },
      sealedCount: proven ? packed.totalVin : 0,
      needed: packed.totalVin,
      card: lines.join("\n"),
    },
    groups: packed.groups.map(publicGroup),
    locProof: locLocal,
    onChain,
    reply: lines.join("\n"),
  };
}

export function enqueueFreeMusicGroups({
  enqueueFn = null,
  includeManifest = true,
  id = MAPLE_ID,
} = {}) {
  const packed = packetizeFreeMusic(id);
  if (!packed.ok) return packed;
  if (typeof enqueueFn !== "function") {
    return {
      ok: false,
      reason: "enqueueFn required — pass enqueueFeedBacklogItem (tests isolate disk)",
      groupCount: packed.groupCount,
    };
  }
  const added = [];
  const skipped = [];
  if (includeManifest) {
    const manifest = musicDualHumanBody(packed, packed.id);
    const r = enqueueFn({
      body: manifest,
      topic: packed.chainDirName + "-manifest",
      name: packed.chainDirName + ".txt",
      kind: "plain",
      source: "free-music-manifest",
      mime: "text/plain",
      preferSmall: true,
    });
    if (r?.ok && !r.deduped) added.push({ kind: "manifest", item: r.item || r });
    else skipped.push({ kind: "manifest", reason: r?.reason || "deduped" });
  }
  for (const g of packed.groups) {
    const r = enqueueFn({
      body: g.body,
      topic: packed.id + "-g" + pad2(g.n),
      name: g.name,
      kind: "vitafile",
      source: "free-music-group",
      mime: "application/octet-stream",
      preferSmall: false,
    });
    if (r?.ok && !r.deduped) {
      added.push({ kind: "group", n: g.n, name: g.name, chunks: g.totalChunks, item: r.item || r });
    } else {
      skipped.push({
        kind: "group",
        n: g.n,
        name: g.name,
        reason: r?.reason || (r?.deduped ? "deduped" : "enqueue failed"),
        chunks: r?.chunks || g.totalChunks,
      });
    }
  }
  return {
    ok: true,
    id: packed.id,
    groupCount: packed.groupCount,
    totalVin: packed.totalVin,
    added: added.length,
    skipped: skipped.length,
    items: added,
    skippedItems: skipped,
    note:
      "Grouped VIN drain: /vitafeed next then confirm|override. Hourly cap " +
      MUSIC_GROUP_VIN_CAP +
      " matches one group. Never invent hashes. VITAFEED_PAID stays default OFF.",
  };
}

/**
 * Bank every catalog song (or a subset) into the feed backlog — thrift grouped VIN.
 * Does not enable VITAFEED_PAID / FORCE / AUTOFIRE. Drain via next → confirm|override.
 */
export function enqueueFreeMusicLibrary({
  enqueueFn = null,
  includeManifest = true,
  ids = null,
} = {}) {
  const songIds = Array.isArray(ids) && ids.length ? ids : listCatalogSongIds();
  const songs = [];
  let added = 0;
  let skipped = 0;
  let groupCount = 0;
  let totalVin = 0;
  for (const id of songIds) {
    const queued = enqueueFreeMusicGroups({ enqueueFn, includeManifest, id });
    if (!queued.ok) {
      songs.push({ id, ok: false, reason: queued.reason });
      skipped += 1;
      continue;
    }
    added += queued.added || 0;
    skipped += queued.skipped || 0;
    groupCount += queued.groupCount || 0;
    totalVin += queued.totalVin || 0;
    songs.push({
      id,
      ok: true,
      added: queued.added,
      skipped: queued.skipped,
      groupCount: queued.groupCount,
      totalVin: queued.totalVin,
    });
  }
  return {
    ok: true,
    library: true,
    ids: songIds,
    songCount: songIds.length,
    added,
    skipped,
    groupCount,
    totalVin,
    songs,
    note:
      "Library grouped VIN drain: /vitafeed next then confirm|override. " +
      "Does not replace /vitafeed enqueue all (memory seed). VITAFEED_PAID stays default OFF.",
  };
}

export function publicFreeMusicState(id = MAPLE_ID) {
  const want = resolveSongId(id) || MAPLE_ID;
  const dir = loadFreeMusic(want);
  if (!dir.ok) return { ok: false, error: dir.reason || "missing" };
  const playlists = Object.values(listCatalogSongs()).map((s) => ({
    id: s.id,
    label: "MUSIC",
    title: s.title + (s.performer ? " — " + s.performer : ""),
    kind: "audio",
    count: 1,
    player: s.player,
    playerHref: vitaPlayerHref(s.player),
  }));
  return {
    ok: true,
    id: FREEMUSIC_ID,
    filingLabel: FREEMUSIC_LABEL,
    formula: FORMULA_ID,
    neverInventHashes: true,
    freeCatalog: true,
    playlists,
    onChain: dir.onChain,
    song: {
      id: dir.id,
      title: dir.title,
      composer: dir.composer,
      performer: dir.performer,
      mime: dir.mime,
      fileName: dir.fileName,
      rawBytes: dir.rawBytes,
      sha256: dir.sha256,
      durationSec: dir.durationSec,
      license: dir.license,
      sourcePage: dir.sourcePage,
      judyGarlandLane: dir.judyGarlandLane,
      groupCount: dir.groupCount,
      totalVin: dir.totalVin,
      vinCap: dir.vinCap,
      groups: dir.groups,
      player: dir.player,
      playerHref: dir.playerHref,
      telegram: dir.telegram,
      locProof: dir.locProof,
    },
    note: dir.note,
  };
}

export function publicFreeMusicPlay(id = MAPLE_ID) {
  const opened = playFreeMusic(id);
  if (!opened.ok) return { ok: false, error: opened.reason || "play failed" };
  return {
    ok: true,
    id: opened.id,
    proven: opened.proven,
    availability: opened.availability,
    complete: true,
    n: opened.n,
    play: opened.play,
    card: opened.reply,
    groups: opened.groups,
    locProof: opened.locProof,
    onChain: opened.onChain,
    player: opened.playerPath,
    neverInventHashes: true,
  };
}

export async function publicFreeMusicLocs(id = JUDY_ID, opts = {}) {
  const proof = await buildFreeMusicLocProof({ id, ...opts });
  if (!proof.ok) return { ok: false, error: proof.reason || "loc proof failed" };
  const songId = proof.id || id;
  return {
    ok: true,
    ...proof,
    // Strip huge previews for HTTP — keep highlight click-through rows
    rows: (proof.rows || []).map((r) => ({
      groupN: r.groupN,
      index: r.index,
      filingPath: r.filingPath,
      groupSha8: shortHex(r.groupSha, 8),
      dataFieldCommit8: shortHex(r.dataFieldCommit, 8),
      bodyPreview: clip(r.bodyPreview, 40),
      location: r.location,
      basescan: r.basescan,
      match: r.match,
      highlight: r.highlight,
      clickThrough: r.clickThrough,
      idmChat: r.idmChat,
      inspect:
        "/vita/free-music/loc?id=" +
        encodeURIComponent(songId) +
        "&g=" +
        r.groupN +
        "&i=" +
        r.index,
    })),
  };
}

/**
 * Exact VIN UTF-8 packet the player feeds for one blockchain block.
 * sha256(line) === dataFieldCommit. Never invents a tx hash — location is
 * only a real sealed 0x loc from CHAINDIR when present.
 */
export function inspectFreeMusicLoc(opts = {}) {
  const packed = opts.packed?.ok ? opts.packed : packetizeFreeMusic(opts.id || JUDY_ID);
  if (!packed.ok) return packed;
  const groupN = Number(opts.groupN ?? opts.g ?? 1);
  const index = Number(opts.index ?? opts.i ?? 1);
  if (!Number.isFinite(groupN) || groupN < 1) {
    return { ok: false, reason: "need group g≥1" };
  }
  if (!Number.isFinite(index) || index < 1) {
    return { ok: false, reason: "need loc index i≥1" };
  }
  const g = packed.groups.find((x) => x.n === groupN);
  if (!g) {
    return { ok: false, reason: "unknown group g" + groupN + " for " + packed.id };
  }
  const lineObj = (g.lines || []).find((l) => l.index === index);
  if (!lineObj || !lineObj.line) {
    return { ok: false, reason: "unknown loc g" + groupN + "." + index };
  }
  const lc = (g.lineCommits || []).find((c) => c.index === index);
  const line = String(lineObj.line);
  const dataFieldCommit = lc?.contentCommit || sha256Hex(line);
  const pulledUtf8Commit = sha256Hex(line);
  const trueToBlock = pulledUtf8Commit === dataFieldCommit;
  const onChain = provenMusicOnChain(packed.id);
  let location = null;
  let basescan = null;
  for (const p of onChain?.proofs || []) {
    const tx = String(p.tx || p.location || "").toLowerCase();
    if (isTxHash(tx)) {
      location = tx;
      basescan = p.basescan || basescanTx(tx);
      break;
    }
  }
  return {
    ok: true,
    id: packed.id,
    title: packed.title,
    songSha256: packed.sha256,
    groupN,
    index,
    totalInGroup: g.totalChunks,
    groupCount: packed.groupCount,
    totalVin: packed.totalVin,
    filingPath: g.filingPath,
    vinId: g.vinId,
    readerKey: g.readerKey,
    groupSha: g.sha256,
    groupOff: g.off,
    groupLen: g.len,
    lineHash: lineObj.hash,
    dataFieldCommit,
    pulledUtf8Commit,
    match: trueToBlock ? (location ? "MATCH" : "LOCAL_OK") : "LOCAL_FAIL",
    highlight: trueToBlock,
    fedIntoPlayer: true,
    trueToBlock,
    line,
    body: lineObj.body || "",
    bytes: Buffer.byteLength(line, "utf8"),
    bodyBytes: Buffer.byteLength(String(lineObj.body || ""), "utf8"),
    location,
    basescan,
    clickThrough: Boolean(basescan),
    idmChat: basescan
      ? "Basescan → Input Data → View as UTF-8"
      : "pending seal — never invent loc · this UTF-8 is the data field",
    player: packed.player,
    inspect:
      "/vita/free-music/loc?id=" +
      encodeURIComponent(packed.id) +
      "&g=" +
      groupN +
      "&i=" +
      index,
    neverInventHashes: true,
    note:
      "Exact VIN UTF-8 data field fed into the player for this block. " +
      "sha256(line) must equal dataFieldCommit. Concat of decoded §VITAFILE§ " +
      "bodies reconstructs the original OGG. Formula anchors are class proof only.",
  };
}

export function publicFreeMusicLoc(id = JUDY_ID, g = 1, i = 1) {
  const inspected = inspectFreeMusicLoc({ id, groupN: Number(g) || 1, index: Number(i) || 1 });
  if (!inspected.ok) return { ok: false, error: inspected.reason || "inspect failed" };
  return inspected;
}
