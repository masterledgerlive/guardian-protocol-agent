/**
 * VITA URL directory — curated YouTube URL mirrors for the closed-garden player.
 *
 * Operator files a playlist as a URL directory (URLs only — never media copies).
 * Telegram `/vitafeed dir KIDS` lists it; `/vitafeed play kids` loads the player
 * with only those URLs. Dual paths:
 *   HUMAN   = exact plain URL list (`/vitafeed dual kids`)
 *   MACHINE = ZK-short ID stream of the same commit
 *   GitHub  = `/vita dual vita/memory/kids-url-directory.json` (availability|proven)
 *
 * Closed garden: player never offers YouTube search, related videos, or other
 * channels. Next/prev only walk this directory. Never invent tx hashes.
 * Mother brain / vitaSave untouched.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FORMULA_ID, MAINFRAME_ANCHORS } from "./mainframe.js";
import { provenKidsOnChain } from "./chain-dir.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const MEMORY_DIR = join(HERE, "memory");
const KIDS_CATALOG_PATH = join(MEMORY_DIR, "kids-url-directory.json");

export const URLDIR_ID = "vita-url-dir-v1";
export const URLDIR_MAGIC = "§VITAURLDIR§";
export const URLDIR_LABEL = "URLDIR";
export const URLDIR_SUBDIR = "KIDS";
export const KIDS_DIR_ID = "kids";
export const KIDS_PLAYER_PATH = "/vita/kids-player";
export const KIDS_FEED_PLAYER_PATH = "/vita/feed-player";
export const VITA_PRODUCTION_ORIGIN =
  "https://guardian-protocol-agent-production.up.railway.app";

/** Public HTTPS origin for Telegram url / web_app buttons. */
export function vitaPublicOrigin(env = process.env) {
  const explicit = String(env?.VITA_PUBLIC_URL || env?.VITA_PUBLIC_ORIGIN || "").trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const railway = String(env?.RAILWAY_PUBLIC_DOMAIN || "").trim();
  if (railway) {
    return /^https?:\/\//i.test(railway)
      ? railway.replace(/\/+$/, "")
      : "https://" + railway.replace(/\/+$/, "");
  }
  return VITA_PRODUCTION_ORIGIN;
}

/** Absolute player URL Telegram can tap (popup=1 for compact Mini App / pop-out). */
export function vitaPlayerHref(path = KIDS_PLAYER_PATH, { popup = true, env = process.env } = {}) {
  const origin = vitaPublicOrigin(env);
  let rel = String(path || KIDS_PLAYER_PATH).trim() || KIDS_PLAYER_PATH;
  if (/^https?:\/\//i.test(rel)) {
    const u = new URL(rel);
    if (popup) u.searchParams.set("popup", "1");
    return u.toString();
  }
  if (!rel.startsWith("/")) rel = "/" + rel;
  const u = new URL(origin + rel);
  if (popup) u.searchParams.set("popup", "1");
  return u.toString();
}

const YT_ID = /^[A-Za-z0-9_-]{11}$/;

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

function safeReadJson(path) {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function catalogBytes() {
  try {
    return statSync(KIDS_CATALOG_PATH).size;
  } catch {
    return 0;
  }
}

function normalizeItem(row, n) {
  const videoId = String(row?.videoId || "").trim();
  const title = String(row?.title || videoId).trim() || videoId;
  const url = row?.url || (videoId ? "https://www.youtube.com/watch?v=" + videoId : "");
  return {
    n: Number(row?.n) > 0 ? Number(row.n) : n,
    videoId,
    title,
    url,
    shortUrl: row?.shortUrl || (videoId ? "https://youtu.be/" + videoId : ""),
  };
}

/**
 * Closed-garden YouTube embed params — no related / other-channel chrome.
 * Player JS still auto-advances inside OUR list on ENDED so YouTube's
 * end-screen recommendations never get a chance to show.
 */
export function closedGardenEmbedQuery(extra = {}) {
  const q = new URLSearchParams({
    rel: "0",
    modestbranding: "1",
    playsinline: "1",
    iv_load_policy: "3",
    controls: "1",
    disablekb: "0",
    fs: "1",
    autoplay: extra.autoplay === false ? "0" : "1",
    enablejsapi: "1",
  });
  if (extra.origin) q.set("origin", String(extra.origin));
  return q.toString();
}

export function closedGardenEmbedUrl(videoId, extra = {}) {
  const id = String(videoId || "").trim();
  if (!YT_ID.test(id)) return null;
  return "https://www.youtube-nocookie.com/embed/" + id + "?" + closedGardenEmbedQuery(extra);
}

export function isKidsPlaySelector(sel) {
  const s = String(sel || "").trim();
  if (!s) return false;
  return /^(?:kids|k|urldir|url-dir)(?:\b|[/?#]|$)/i.test(s);
}

/** Empty / demo / wav → Tailwind demo player (synthetic WAV), not the PD song. */
export function isDemoPlaySelector(sel) {
  const s = String(sel || "").trim();
  return !s || /^(?:demo|wav|feed-player|player)$/i.test(s);
}

export function demoPlayerOpen() {
  const playerPath = KIDS_FEED_PLAYER_PATH + "?demo=1";
  const playerHref = vitaPlayerHref(playerPath);
  return {
    ok: true,
    demo: true,
    playerPath,
    playerHref,
    play: { kind: "audio", name: "demo-song.wav", demo: true },
    reply: [
      "VITAFEED DEMO PLAYER",
      "Tap Watch popup — small window while you work.",
      "href=" + playerHref,
      "Playlists: /vitafeed play kids  ·  /vitafeed play maple",
    ].join("\n"),
  };
}

/**
 * Expand Telegram `/vitafeed dual kids` into the exact HUMAN URL list.
 * Leaves other dual bodies untouched (including already-expanded lists).
 */
export function maybeKidsDualHumanBody(text) {
  const s = String(text || "").trim();
  if (!s) return s;
  if (s.includes("\n") || s.length >= 120) return s;
  if (isKidsPlaySelector(s)) return kidsDualHumanBody();
  return s;
}

export function parseKidsPlayIndex(sel) {
  const s = String(sel || "").trim();
  const m =
    s.match(/[?&#]i=(\d+)/i) ||
    s.match(/[?&#]n=(\d+)/i) ||
    s.match(/#(\d+)/) ||
    s.match(/(?:kids|k|urldir|url-dir)\s+(\d+)/i);
  const n = m ? Number(m[1]) : 1;
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function loadKidsCatalogRaw() {
  return safeReadJson(KIDS_CATALOG_PATH);
}

/**
 * Load a named URL directory. Seed catalog is KIDS (operator kids playlist).
 */
export function loadUrlDirectory(id = KIDS_DIR_ID) {
  const want = String(id || KIDS_DIR_ID).trim().toLowerCase() || KIDS_DIR_ID;
  if (want !== KIDS_DIR_ID && want !== "k" && want !== URLDIR_SUBDIR.toLowerCase()) {
    return { ok: false, reason: "unknown url directory — try kids" };
  }
  const raw = loadKidsCatalogRaw();
  if (!raw || !Array.isArray(raw.items) || !raw.items.length) {
    return { ok: false, reason: "KIDS url directory catalog missing" };
  }
  const items = raw.items
    .map((row, i) => normalizeItem(row, i + 1))
    .filter((row) => YT_ID.test(row.videoId));
  if (!items.length) {
    return { ok: false, reason: "KIDS catalog has no valid video ids" };
  }
  const ids = items.map((it) => it.videoId);
  const human = kidsDualHumanBodyFrom(raw, items);
  const contentCommit = sha256Hex(human);
  return {
    ok: true,
    id: KIDS_DIR_ID,
    label: URLDIR_SUBDIR,
    title: raw.title || "Kids",
    filingLabel: URLDIR_LABEL,
    formula: FORMULA_ID,
    neverInventHashes: true,
    closedGarden: true,
    count: items.length,
    items,
    ids,
    sourcePlaylist: raw.sourcePlaylist || null,
    player: KIDS_PLAYER_PATH + "?dir=kids",
    feedPlayer: KIDS_FEED_PLAYER_PATH + "?dir=kids",
    catalogPath: "vita/memory/kids-url-directory.json",
    contentCommit,
    contentCommit8: shortHex(contentCommit, 8),
    bytes: catalogBytes() || Buffer.byteLength(human, "utf8"),
    pulledAt: raw.pulledAt || null,
    note: raw.note || null,
    telegram: raw.telegram || [
      "/vitafeed dir KIDS",
      "/vitafeed play kids",
      "/vitafeed dual kids",
    ],
    locations: MAINFRAME_ANCHORS.known.map((a) => a.tx),
  };
}

export function listUrlDirectories() {
  const kids = loadUrlDirectory(KIDS_DIR_ID);
  return {
    ok: true,
    id: URLDIR_ID,
    filingLabel: URLDIR_LABEL,
    formula: FORMULA_ID,
    neverInventHashes: true,
    closedGarden: true,
    dirs: kids.ok
      ? [{
          id: kids.id,
          label: kids.label,
          title: kids.title,
          count: kids.count,
          kind: "youtube",
          player: kids.player,
          playerHref: vitaPlayerHref(kids.player),
        }]
      : [],
  };
}

/** Playlists already loaded in the system — picker + Telegram popup. */
export function systemPlaylists() {
  const demoPath = KIDS_FEED_PLAYER_PATH + "?demo=1";
  const out = [];
  // Growing free-catalog library from catalog JSON (avoid circular import with free-music.js).
  try {
    const cat = JSON.parse(readFileSync(join(HERE, "memory/free-music-catalog.json"), "utf8"));
    const songs = Object.values(cat.songs || {});
    const ordered = [
      ...songs.filter((s) => s.id === "judy"),
      ...songs.filter((s) => s.id !== "judy"),
    ];
    for (const s of ordered) {
      const path = s.player || (KIDS_FEED_PLAYER_PATH + "?music=" + s.id);
      out.push({
        id: s.id,
        label: "MUSIC",
        title: (s.title || s.id) + (s.performer ? " — " + s.performer : ""),
        kind: "audio",
        count: 1,
        player: path,
        playerHref: vitaPlayerHref(path),
      });
    }
  } catch {
    const maplePath = KIDS_FEED_PLAYER_PATH + "?music=maple";
    const judyPath = KIDS_FEED_PLAYER_PATH + "?music=judy";
    out.push(
      {
        id: "judy",
        label: "MUSIC",
        title: "I'm Always Chasing Rainbows (Judy Garland lane · PD 1918)",
        kind: "audio",
        count: 1,
        player: judyPath,
        playerHref: vitaPlayerHref(judyPath),
      },
      {
        id: "maple",
        label: "MUSIC",
        title: "Maple Leaf Rag (Scott Joplin)",
        kind: "audio",
        count: 1,
        player: maplePath,
        playerHref: vitaPlayerHref(maplePath),
      },
    );
  }
  out.push({
    id: "demo",
    label: "DEMO",
    title: "Demo beep (WAV)",
    kind: "audio",
    count: 1,
    player: demoPath,
    playerHref: vitaPlayerHref(demoPath),
  });
  for (const d of listUrlDirectories().dirs) out.push(d);
  return out;
}

function kidsDualHumanBodyFrom(raw, items) {
  const playlistId = raw?.sourcePlaylist?.id || "";
  const lines = [
    URLDIR_MAGIC +
      "v1|id=" +
      KIDS_DIR_ID +
      "|n=" +
      items.length +
      "|playlist=" +
      playlistId +
      "§",
    "KIDS URL DIRECTORY — closed garden (no YouTube recommendations)",
    "formula=" + FORMULA_ID,
    "player=" + KIDS_PLAYER_PATH + "?dir=kids",
    "source=" + (raw?.sourcePlaylist?.url || ""),
    "",
  ];
  for (const it of items) {
    lines.push(
      String(it.n).padStart(3, "0") +
        " " +
        it.videoId +
        " " +
        it.shortUrl +
        " " +
        clip(it.title, 80),
    );
  }
  return lines.join("\n");
}

/** Exact HUMAN lane body for `/vitafeed dual kids`. */
export function kidsDualHumanBody() {
  const dir = loadUrlDirectory(KIDS_DIR_ID);
  if (!dir.ok) return "";
  return kidsDualHumanBodyFrom(
    { sourcePlaylist: dir.sourcePlaylist, title: dir.title },
    dir.items,
  );
}

export function kidsMachineIdsLine(dir = loadUrlDirectory(KIDS_DIR_ID)) {
  if (!dir?.ok) return "";
  return (
    "URLDIR lane=MACHINE id=" +
    dir.id +
    " n=" +
    dir.count +
    " commit=" +
    dir.contentCommit8 +
    " closedGarden=1 | " +
    dir.ids.join(",")
  );
}

export function urlDirEntriesFor() {
  const dir = loadUrlDirectory(KIDS_DIR_ID);
  const out = [];
  if (!dir.ok) return out;

  out.push({
    n: 1,
    name: "kids-url-dir.json",
    kind: "youtube",
    bytes: dir.bytes,
    unlockName: "kids-url-dir.json",
    english:
      "KIDS closed-garden YouTube URL directory (" +
      dir.count +
      " urls). Player loads only this list — no recommendations or other channels.",
    machine:
      "URLDIR id=kids n=" +
      dir.count +
      " player=/vita/kids-player?dir=kids commit=" +
      dir.contentCommit8,
    locations: dir.locations,
    trueName: "kids-url-dir",
    mime: "application/json",
    playKind: "youtube",
    dirId: KIDS_DIR_ID,
  });
  out.push({
    n: 2,
    name: "kids.m3u",
    kind: "youtube",
    bytes: dir.ids.join("\n").length,
    unlockName: "kids.m3u",
    english:
      "KIDS URL playlist (m3u-style). Play via /vitafeed play kids — closed garden player.",
    machine: "M3U id=kids n=" + dir.count + " " + dir.ids.slice(0, 8).join(",") + ",…",
    locations: dir.locations,
    trueName: "kids-m3u",
    mime: "audio/x-mpegurl",
    playKind: "youtube",
    dirId: KIDS_DIR_ID,
  });

  for (const it of dir.items) {
    out.push({
      n: out.length + 1,
      name: String(it.n).padStart(3, "0") + "-" + it.videoId + ".url",
      kind: "youtube",
      bytes: Buffer.byteLength(it.url + " " + it.title, "utf8"),
      unlockName: it.videoId + ".url",
      english: "#" + it.n + " " + it.title + " — " + it.url,
      machine: "YT " + it.videoId + " n=" + it.n + " closedGarden=1",
      locations: dir.locations,
      trueName: it.videoId,
      mime: "text/uri-list",
      playKind: "youtube",
      dirId: KIDS_DIR_ID,
      videoId: it.videoId,
      playIndex: it.n,
      url: it.url,
    });
  }
  return out;
}

export function formatKidsDirCard(dir = loadUrlDirectory(KIDS_DIR_ID)) {
  if (!dir?.ok) {
    return URLDIR_MAGIC + " MISS\n" + (dir?.reason || "missing");
  }
  const lines = [];
  lines.push(URLDIR_MAGIC + "v1|id=" + dir.id + "|n=" + dir.count + "§");
  lines.push("KIDS URL DIRECTORY (closed garden)");
  lines.push("title=" + dir.title + "  ·  urls=" + dir.count);
  lines.push("player=" + dir.player);
  lines.push("feed-player=" + dir.feedPlayer);
  lines.push("commit=" + dir.contentCommit8 + "  ·  privateKey=NO");
  lines.push("no recommendations · no other channels · URLs only");
  if (dir.sourcePlaylist?.id) {
    lines.push("source playlist=" + dir.sourcePlaylist.id);
  }
  lines.push("");
  for (const it of dir.items.slice(0, 12)) {
    lines.push(String(it.n).padStart(3, "0") + "  " + it.videoId + "  " + clip(it.title, 48));
  }
  if (dir.items.length > 12) {
    lines.push("  … +" + (dir.items.length - 12) + " more");
  }
  lines.push("");
  lines.push("play:  /vitafeed play kids");
  lines.push("popup: tap Watch popup in Telegram (small window)");
  lines.push("href:  " + vitaPlayerHref("/vita/kids-player?dir=kids"));
  lines.push("dual:  /vitafeed dual kids   (HUMAN urls + MACHINE ids → confirm)");
  lines.push("path:  /vita dual vita/memory/kids-url-directory.json");
  lines.push("dir:   /vitafeed dir KIDS");
  return lines.join("\n");
}

export function playKidsDirectory(selector = "kids") {
  const dir = loadUrlDirectory(KIDS_DIR_ID);
  if (!dir.ok) {
    return { ok: false, reason: dir.reason || "KIDS directory missing" };
  }
  const index = Math.min(dir.count, parseKidsPlayIndex(selector));
  const item = dir.items[index - 1] || dir.items[0];
  const embedUrl = closedGardenEmbedUrl(item.videoId, { autoplay: true });
  const playerPath =
    KIDS_PLAYER_PATH + "?dir=kids&i=" + encodeURIComponent(String(item.n));
  const feedPlayerPath =
    KIDS_FEED_PLAYER_PATH + "?dir=kids&i=" + encodeURIComponent(String(item.n));
  const playerHref = vitaPlayerHref(playerPath);
  const lines = [
    URLDIR_MAGIC + " PLAY · CLOSED GARDEN",
    "KIDS  #" + item.n + "/" + dir.count + "  " + item.title,
    "video=" + item.videoId,
    "url=" + item.url,
    "embed=youtube-nocookie · rel=0 · modestbranding · no related",
    "player " + playerHref,
    "also   " + vitaPlayerHref(feedPlayerPath),
    "Telegram: tap Watch popup (small window while you work)",
    "next/prev only walk this directory — child cannot pick other channels",
    "dual-path test: /vitafeed dual kids  then confirm|override",
  ];
  return {
    ok: true,
    dirId: dir.id,
    n: item.n,
    count: dir.count,
    item,
    directory: {
      id: dir.id,
      title: dir.title,
      count: dir.count,
      closedGarden: true,
      contentCommit: dir.contentCommit,
      ids: dir.ids,
    },
    playerPath,
    feedPlayerPath,
    playerHref,
    play: {
      kind: "youtube",
      closedGarden: true,
      mime: "text/uri-list",
      name: item.title,
      videoId: item.videoId,
      title: item.title,
      url: item.url,
      embedUrl,
      playlist: dir.ids,
      index: item.n,
    },
    reply: lines.join("\n"),
  };
}

export function publicUrlDirState(id = KIDS_DIR_ID) {
  const dir = loadUrlDirectory(id);
  if (!dir.ok) {
    return { ok: false, error: dir.reason || "missing" };
  }
  const playlists = systemPlaylists();
  return {
    ok: true,
    id: URLDIR_ID,
    filingLabel: URLDIR_LABEL,
    formula: FORMULA_ID,
    neverInventHashes: true,
    closedGarden: true,
    playlists,
    dirs: listUrlDirectories().dirs,
    onChain: provenKidsOnChain(),
    dir: {
      id: dir.id,
      label: dir.label,
      title: dir.title,
      count: dir.count,
      contentCommit: dir.contentCommit,
      catalogPath: dir.catalogPath,
      sourcePlaylist: dir.sourcePlaylist,
      player: dir.player,
      playerHref: vitaPlayerHref(dir.player),
      feedPlayer: dir.feedPlayer,
      telegram: dir.telegram,
      items: dir.items.map((it) => ({
        n: it.n,
        videoId: it.videoId,
        title: it.title,
        url: it.url,
        embedUrl: closedGardenEmbedUrl(it.videoId, { autoplay: false }),
      })),
    },
    playerVars: {
      rel: 0,
      modestbranding: 1,
      playsinline: 1,
      iv_load_policy: 3,
      controls: 1,
      host: "https://www.youtube-nocookie.com",
    },
    note: "Closed garden — play listed urls. Proven only after dual kids seals Input Data. Telegram Watch popup. Dual: /vitafeed dual kids.",
  };
}

export function formatKidsPlayCard(opened) {
  if (!opened?.ok) return URLDIR_MAGIC + " PLAY MISS\n" + (opened?.reason || "miss");
  return opened.reply;
}
