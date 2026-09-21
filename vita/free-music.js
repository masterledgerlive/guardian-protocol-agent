/**
 * Free-catalog song → grouped VIN injections → original blockchain playback.
 *
 * Maple Leaf Rag (Scott Joplin, 1899) from Wikimedia Commons public-domain
 * catalog. Full OGG bytes (not a synthetic demo WAV, not a URL blob) split
 * into §VITAFILE§ groups that each fit the hourly VIN cap (24). Player
 * concatenates sealed Input Data (or local packet reconstruction) and plays
 * the original audio/ogg. Never invent tx hashes. Mother brain untouched.
 *
 * Telegram: /vitafeed play maple · /vitafeed music · /vitafeed enqueue maple
 * · /vitafeed dual maple · /vitafeed dir MUSIC
 * Player: /vita/feed-player?music=maple
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
const MAPLE_PATH = join(SONG_DIR, "Maple_Leaf_Rag.ogg");

export const FREEMUSIC_ID = "vita-free-music-v1";
export const FREEMUSIC_MAGIC = "§VITAMUSIC§";
export const FREEMUSIC_LABEL = "FREEMUSIC";
export const FREEMUSIC_SUBDIR = "MUSIC";
export const MAPLE_ID = "maple";
export const MUSIC_PLAYER_PATH = "/vita/feed-player?music=maple";
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

function loadCatalogMeta() {
  return safeReadJson(CATALOG_PATH) || {};
}

export function isMusicPlaySelector(sel) {
  const s = String(sel || "").trim();
  if (!s) return false;
  return /^(?:maple|music|joplin|rag|song|maple-leaf|mapleleafrag)(?:\b|[/?#]|$)/i.test(s);
}

export function maybeMusicDualHumanBody(text) {
  const s = String(text || "").trim();
  if (!s) return s;
  if (s.includes("\n") || s.length >= 80) return s;
  if (isMusicPlaySelector(s)) return musicDualHumanBody();
  return s;
}

function groupFileName(fileName, n) {
  return String(fileName || "song.bin").replace(/[^\w.\- ]+/g, "_") + ".g" + pad2(n);
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
      name: "Maple_Leaf_Rag.ogg.g99",
      mime: "application/octet-stream",
      bytes: probe,
    });
    if (prep.ok && prep.totalChunks <= maxChunks) return raw;
    raw = Math.floor(raw * 0.95);
    raw -= raw % 3;
  }
  return 4095;
}

function readSongBytes() {
  if (!existsSync(MAPLE_PATH)) {
    return { ok: false, reason: "Maple Leaf Rag OGG missing — vita/memory/free-music/Maple_Leaf_Rag.ogg" };
  }
  const bytes = readFileSync(MAPLE_PATH);
  if (bytes.length < 4 || bytes.subarray(0, 4).toString("ascii") !== "OggS") {
    return { ok: false, reason: "Maple Leaf Rag is not an Ogg bitstream" };
  }
  return { ok: true, bytes, sha256: sha256HexBuf(bytes), size: bytes.length };
}

/**
 * Packetize the PD recording into grouped §VITAFILE§ VIN injections.
 * Each group is independently drainable (≤24 VIN). Concat = original OGG.
 */
export function packetizeFreeMusic(id = MAPLE_ID) {
  const want = String(id || MAPLE_ID).trim().toLowerCase() || MAPLE_ID;
  if (want !== MAPLE_ID && want !== "music" && want !== "song" && want !== "joplin" && want !== "rag") {
    return { ok: false, reason: "unknown free-catalog song — try maple" };
  }
  const song = readSongBytes();
  if (!song.ok) return song;
  const meta = loadCatalogMeta();
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
  const fileName = meta.fileName || "Maple_Leaf_Rag.ogg";
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
    const prepared = prepareVitaFeed(enc.body);
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
  return {
    ok: true,
    id: MAPLE_ID,
    filingLabel: FREEMUSIC_LABEL,
    formula: FORMULA_ID,
    neverInventHashes: true,
    title: meta.title || "Maple Leaf Rag",
    composer: meta.composer || "Scott Joplin",
    license: meta.license || "Public domain",
    sourcePage: meta.sourcePage || null,
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
    player: MUSIC_PLAYER_PATH,
    note:
      "Full PD performance → " + groups.length +
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

export function musicDualHumanBody(plan = null) {
  const packed = plan?.ok ? plan : packetizeFreeMusic();
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
    "FREE CATALOG SONG — Maple Leaf Rag (Scott Joplin, 1899)",
    "public domain · Wikimedia Commons OGG · not a demo WAV · not a URL blob",
    "formula=" + FORMULA_ID,
    "player=" + MUSIC_PLAYER_PATH,
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
        " name=" + g.name,
    );
  }
  return lines.join("\n");
}

export function musicMachineGroupsLine(plan = null) {
  const packed = plan?.ok ? plan : packetizeFreeMusic();
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
  };
}

export function loadFreeMusic(id = MAPLE_ID) {
  const packed = packetizeFreeMusic(id);
  if (!packed.ok) return packed;
  const onChain = provenMusicOnChain();
  return {
    ok: true,
    id: packed.id,
    label: FREEMUSIC_SUBDIR,
    title: packed.title,
    composer: packed.composer,
    filingLabel: FREEMUSIC_LABEL,
    formula: packed.formula,
    neverInventHashes: true,
    freeCatalog: true,
    mime: packed.mime,
    playKind: packed.playKind,
    fileName: packed.fileName,
    rawBytes: packed.rawBytes,
    sha256: packed.sha256,
    durationSec: packed.durationSec,
    license: packed.license,
    sourcePage: packed.sourcePage,
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
    telegram: [
      "/vitafeed play maple",
      "/vitafeed music",
      "/vitafeed dir MUSIC",
      "/vitafeed enqueue maple",
      "/vitafeed dual maple",
    ],
    note: packed.note,
  };
}

export function freeMusicEntriesFor() {
  const dir = loadFreeMusic();
  const out = [];
  if (!dir.ok) return out;
  out.push({
    n: 1,
    name: "Maple_Leaf_Rag.ogg",
    kind: "audio",
    bytes: dir.rawBytes,
    unlockName: "Maple_Leaf_Rag.ogg",
    english:
      "Maple Leaf Rag (Scott Joplin, 1899) — popular public-domain ragtime. Full OGG (" +
      dir.rawBytes +
      " B, " +
      (dir.durationSec || "?") +
      "s) grouped into " +
      dir.groupCount +
      " VIN injections. Original blockchain playback concatenates sealed slices.",
    machine:
      "MUSIC id=maple groups=" +
      dir.groupCount +
      " vin=" +
      dir.totalVin +
      " mime=audio/ogg commit=" +
      dir.contentCommit8,
    locations: dir.locations,
    trueName: "maple-leaf-rag",
    mime: "audio/ogg",
    playKind: "audio",
    dirId: MAPLE_ID,
  });
  out.push({
    n: 2,
    name: "free-music-catalog.json",
    kind: "catalog",
    bytes: (() => {
      try { return statSync(CATALOG_PATH).size; } catch { return 0; }
    })(),
    unlockName: "free-music-catalog.json",
    english: "Free-catalog metadata + grouped inject plan. Proven only after every group loc seals.",
    machine: "CATALOG id=maple groups=" + dir.groupCount + " vinCap=" + dir.vinCap,
    locations: dir.locations,
    trueName: "free-music-catalog",
    mime: "application/json",
    playKind: "text",
    dirId: MAPLE_ID,
  });
  for (const g of dir.groups) {
    out.push({
      n: out.length + 1,
      name: g.name,
      kind: "vitafile-group",
      bytes: g.len,
      unlockName: g.name,
      english:
        "VIN group " + g.n + "/" + dir.groupCount +
        " · " + g.len + " B slice · " + g.totalChunks + " packets · off=" + g.off,
      machine:
        "GROUP n=" + g.n + " vin=" + g.totalChunks + " sha=" + shortHex(g.sha256, 8),
      locations: dir.locations,
      trueName: "maple-g" + pad2(g.n),
      mime: "application/octet-stream",
      playKind: "file",
      dirId: MAPLE_ID,
      groupN: g.n,
    });
  }
  return out;
}

export function formatFreeMusicCard(dir = loadFreeMusic()) {
  if (!dir?.ok) {
    return FREEMUSIC_MAGIC + " MISS\n" + (dir?.reason || "missing");
  }
  const onChain = dir.onChain || provenMusicOnChain();
  const lines = [];
  lines.push(FREEMUSIC_MAGIC + "v1|id=" + dir.id + "|n=" + dir.groupCount + "§");
  lines.push("FREE CATALOG · " + dir.title + " — " + dir.composer);
  lines.push("public domain · popular ragtime · original OGG (not demo WAV)");
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
  lines.push("play:     /vitafeed play maple");
  lines.push("enqueue:  /vitafeed enqueue maple   (grouped VIN drain)");
  lines.push("dual:     /vitafeed dual maple      (HUMAN catalog + MACHINE group shas)");
  lines.push("dir:      /vitafeed dir MUSIC");
  lines.push("href:     " + (dir.playerHref || vitaPlayerHref(dir.player)));
  return lines.join("\n");
}

/**
 * Original playback payload. Reconstructs from grouped VITAFILE packets.
 * Proven flag is true only when CHAINDIR maple line is complete AND we are
 * not falling back to local bytes. Local reconstruct is availability.
 */
export function playFreeMusic(selector = "maple") {
  const packed = packetizeFreeMusic(selector);
  if (!packed.ok) {
    return { ok: false, reason: packed.reason || "music missing" };
  }
  const rebuilt = reconstructFreeMusicFromGroups(packed.groups);
  if (!rebuilt.ok) return { ok: false, reason: rebuilt.reason };
  const onChain = provenMusicOnChain();
  const playerPath = MUSIC_PLAYER_PATH;
  const playerHref = vitaPlayerHref(playerPath);
  const dataUrl = "data:audio/ogg;base64," + rebuilt.data.toString("base64");
  const proven = Boolean(onChain?.proven);
  const lines = [
    FREEMUSIC_MAGIC + " PLAY · ORIGINAL OGG",
    packed.title + " — " + packed.composer + " (1899, public domain)",
    "bytes=" + rebuilt.rawBytes + " sha256=" + rebuilt.sha256,
    "groups=" + packed.groupCount + "  VIN packets=" + packed.totalVin,
    proven
      ? "PROVEN — play from sealed Input Data groups (CHAINDIR complete)"
      : "availability — reconstructed from grouped VIN packets (local). Seal via /vitafeed enqueue maple then confirm|override. Formula anchors are class proof, not this body.",
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
    onChain,
    reply: lines.join("\n"),
  };
}

export function enqueueFreeMusicGroups({
  enqueueFn = null,
  includeManifest = true,
} = {}) {
  const packed = packetizeFreeMusic();
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
    const manifest = musicDualHumanBody(packed);
    const r = enqueueFn({
      body: manifest,
      topic: "maple-leaf-rag-manifest",
      name: "maple-leaf-rag.txt",
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
      topic: "maple-g" + pad2(g.n),
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

export function publicFreeMusicState(id = MAPLE_ID) {
  const dir = loadFreeMusic(id);
  if (!dir.ok) return { ok: false, error: dir.reason || "missing" };
  return {
    ok: true,
    id: FREEMUSIC_ID,
    filingLabel: FREEMUSIC_LABEL,
    formula: FORMULA_ID,
    neverInventHashes: true,
    freeCatalog: true,
    playlists: [
      {
        id: MAPLE_ID,
        label: "MUSIC",
        title: dir.title + " — " + dir.composer,
        kind: "audio",
        count: 1,
        player: dir.player,
        playerHref: dir.playerHref,
      },
    ],
    onChain: dir.onChain,
    song: {
      id: dir.id,
      title: dir.title,
      composer: dir.composer,
      mime: dir.mime,
      fileName: dir.fileName,
      rawBytes: dir.rawBytes,
      sha256: dir.sha256,
      durationSec: dir.durationSec,
      license: dir.license,
      sourcePage: dir.sourcePage,
      groupCount: dir.groupCount,
      totalVin: dir.totalVin,
      vinCap: dir.vinCap,
      groups: dir.groups,
      player: dir.player,
      playerHref: dir.playerHref,
      telegram: dir.telegram,
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
    onChain: opened.onChain,
    player: opened.playerPath,
    neverInventHashes: true,
  };
}
