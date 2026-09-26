/**
 * VITA voxel spatial sound — bird-print microbites → one-block VIN (goal).
 *
 * Industry notes (research → filing):
 *   - SonicMotion / FOA spatial gen: position + motion as first-class condition
 *   - MRSAudio / score→spatial: symbolic prints drive placement
 *   - Multi-species bird DSP: chirp patterning + 3D trajectories (no recordings)
 *   - Syrinx dual-oscillator = fine-tuned vocal "print" agents can mimic
 *
 * On-chain goal: each microbite lives in ONE Base Input Data message
 * (§VITASPATIAL§ recipe ≤720B VIN). Space only when oversized (WAV attach).
 * Z-SNARK short = name+contentCommit machine lane (zero-snark open key).
 *
 * Agentic AI: pull sealed prints in a voxel neighborhood → mimic nearby
 * data points → synth soundtrack / spatial chorus from blockchain recipes.
 *
 * Never invents tx hashes. VITAFEED_PAID default OFF — no Basescan body
 * until confirm|override seals. Class-proof ≠ inject proof.
 *
 * Telegram: /vitafeed spatial · /vitafeed voxel · /vitafeed bird <id>
 * · /vitafeed enqueue spatial · /vitafeed soundtrack <voxel>
 * UI: /vita/spatial · locs /vita/spatial/locs?id=<id>
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
import { FORMULA_ID, MAINFRAME_ANCHORS } from "./mainframe.js";
import { prepareVitaFeed, VITAFEED_MAX_CHUNK_BYTES } from "./vita-feed.js";
import { encodeVitaFile, parseVitaFileBody } from "./vita-feed-file.js";
import { snarkCompressBlob, telegramCallbackData } from "./mirror-chain.js";
import { vitaPlayerHref } from "./url-dir.js";
import {
  SAMPLE_RATE,
  synthesizePadWav,
  parsePromptRecipe,
  renderRecipeSamples,
  samplesToWav,
  waveformPeaks,
  openSourceUnlockKeySync,
  recordPadSeal,
} from "./soundboard.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const MEMORY_DIR = join(HERE, "memory");
const STRANDS_DIR = join(HERE, "strands");
const CATALOG_PATH = join(MEMORY_DIR, "spatial-sound-catalog.json");
const SEAL_PATH = join(MEMORY_DIR, "spatial-sound-seals.json");
const LEARN_PATH = join(MEMORY_DIR, "spatial-sound-learn.json");
const STRAND_PATH = join(STRANDS_DIR, "spatial-sound.json");
const BOARD_SEAL_PATH = join(MEMORY_DIR, "soundboard-seals.json");

export const SPATIAL_ID = "vita-spatial-sound-v1";
export const SPATIAL_MAGIC = "§VITASPATIAL§";
export const SPATIAL_LABEL = "SPATIAL_SOUND";
export const SPATIAL_SUBDIR = "VOXEL";
export const SPATIAL_PLAYER_PATH = "/vita/spatial";
export const ONE_BLOCK_GOAL_BYTES = VITAFEED_MAX_CHUNK_BYTES;

/** Bird / creature vocal prints — syrinx-style dual FM chirp recipes (DSP, not samples). */
export const BIRD_PRINTS = Object.freeze({
  "bird.sparrow.a": {
    id: "bird.sparrow.a",
    species: "sparrow",
    title: "Sparrow chip",
    blurb: "Fast ascending chip — syrinx print A",
    recipe: "chirp rise 3200→4800 0.08s gain=0.5",
    f0: 3200,
    f1: 4800,
    ms: 80,
    color: "#f4a261",
  },
  "bird.sparrow.b": {
    id: "bird.sparrow.b",
    species: "sparrow",
    title: "Sparrow reply",
    blurb: "Soft descending answer — print B for mimic",
    recipe: "chirp drop 4200→2800 0.09s gain=0.45",
    f0: 4200,
    f1: 2800,
    ms: 90,
    color: "#e76f51",
  },
  "bird.thrush.a": {
    id: "bird.thrush.a",
    species: "thrush",
    title: "Thrush flute",
    blurb: "Liquid flute phrase — longer print",
    recipe: "chirp rise 1800→3400 0.14s gain=0.48",
    f0: 1800,
    f1: 3400,
    ms: 140,
    color: "#2a9d8f",
  },
  "bird.crow.a": {
    id: "bird.crow.a",
    species: "crow",
    title: "Crow caw",
    blurb: "Rough mid caw — noise+tone print",
    recipe: "noise+tone 480hz 0.12s gain=0.55",
    f0: 480,
    f1: 420,
    ms: 120,
    color: "#264653",
  },
  "bird.wren.a": {
    id: "bird.wren.a",
    species: "wren",
    title: "Wren trill",
    blurb: "Rapid trill — dense FM print",
    recipe: "saw siren 0.1s gain=0.4",
    f0: 4500,
    f1: 5200,
    ms: 100,
    color: "#e9c46a",
  },
  "ambi.wind.a": {
    id: "ambi.wind.a",
    species: "ambi",
    title: "Wind hush",
    blurb: "Soft whoosh atmosphere print",
    recipe: "noise whoosh 0.18s gain=0.28",
    f0: 400,
    f1: 200,
    ms: 180,
    color: "#90e0ef",
  },
  "ambi.drop.a": {
    id: "ambi.drop.a",
    species: "ambi",
    title: "Water drop",
    blurb: "Point source drip — spatial ping",
    recipe: "sine coin 1200→800 0.06s gain=0.4",
    f0: 1200,
    f1: 800,
    ms: 60,
    color: "#48cae4",
  },
  "tone.pad.a": {
    id: "tone.pad.a",
    species: "tone",
    title: "Soft pad tone",
    blurb: "AI-music seed tone for agent soundtrack",
    recipe: "sine beep 440hz 0.1s gain=0.35",
    f0: 440,
    f1: 440,
    ms: 100,
    color: "#c77dff",
  },
});

/** Default voxel lattice (world units → integer cells). */
export const VOXEL_SCALE = 2; // world unit → cell
export const VOXEL_ORIGIN = Object.freeze({ x: 0, y: 0, z: 0 });

function sha256Hex(text) {
  return createHash("sha256").update(String(text || ""), "utf8").digest("hex");
}

function sha256HexBuf(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function shortHex(hex, n = 8) {
  return String(hex || "").replace(/^0x/i, "").toLowerCase().slice(0, n);
}

function clip(s, n = 72) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length <= n ? t : t.slice(0, n - 1) + "…";
}

function ensureDirs() {
  for (const d of [MEMORY_DIR, STRANDS_DIR]) {
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
  }
}

function safeReadJson(path) {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function appendLearn(event) {
  ensureDirs();
  const root = safeReadJson(LEARN_PATH) || {
    id: "spatial-sound-learn-v1",
    filingLabel: SPATIAL_LABEL,
    events: [],
  };
  root.events = root.events || [];
  root.events.push({ at: new Date().toISOString(), ...event });
  if (root.events.length > 200) root.events = root.events.slice(-200);
  root.updatedAt = new Date().toISOString();
  writeFileSync(LEARN_PATH, JSON.stringify(root, null, 2) + "\n");
}

function writeStrand(note) {
  ensureDirs();
  const strand = {
    id: SPATIAL_ID,
    filingLabel: SPATIAL_LABEL,
    formula: FORMULA_ID,
    neverInventHashes: true,
    oneBlockGoal: true,
    note:
      note ||
      "Spatial microbites → §VITASPATIAL§ one-block VIN when ≤720B; space only if oversized. Bird prints + xyz voxel. Seal for Basescan MATCH click-through.",
    ends: [
      "Bird/syrinx print catalog",
      "Voxel xyz placement",
      "One-block inject goal",
      "Agent soundtrack mimic from neighborhood seals",
    ],
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(STRAND_PATH, JSON.stringify(strand, null, 2) + "\n");
  return strand;
}

function isTxHash(h) {
  return /^0x[0-9a-fA-F]{64}$/.test(String(h || ""));
}

function basescanTx(tx) {
  return (MAINFRAME_ANCHORS.basescanTx || "https://basescan.org/tx/") + tx;
}

/** World xyz → integer voxel cell. */
export function worldToVoxel(x = 0, y = 0, z = 0, scale = VOXEL_SCALE) {
  const s = Number(scale) || VOXEL_SCALE;
  return {
    vx: Math.floor((Number(x) - VOXEL_ORIGIN.x) * s),
    vy: Math.floor((Number(y) - VOXEL_ORIGIN.y) * s),
    vz: Math.floor((Number(z) - VOXEL_ORIGIN.z) * s),
  };
}

export function voxelKey({ vx, vy, vz }) {
  return `${vx},${vy},${vz}`;
}

export function parseVoxelKey(key = "0,0,0") {
  const [a, b, c] = String(key).split(",").map((n) => Number(n) || 0);
  return { vx: a, vy: b, vz: c };
}

/**
 * Chirp / bird synth — FM + dual envelope (syrinx-inspired), not copyrighted samples.
 */
export function renderBirdPrintSamples(printOrId, { durationMs = null } = {}) {
  const print =
    typeof printOrId === "string"
      ? BIRD_PRINTS[printOrId] || null
      : printOrId;
  if (!print) {
    return { ok: false, reason: "unknown bird print — try bird.sparrow.a" };
  }
  const ms = Math.max(30, Math.min(280, Number(durationMs || print.ms) || 80));
  const durationSec = ms / 1000;
  const f0 = Number(print.f0) || 2000;
  const f1 = Number(print.f1) || f0 * 1.3;
  const recipe = parsePromptRecipe(
    print.recipe || `chirp rise ${f0}→${f1} ${durationSec}s gain=0.5`,
  );
  // Force chirp-like style for bird prints
  if (print.species === "bird" || String(print.id || "").startsWith("bird.")) {
    recipe.style = /drop|reply/.test(print.recipe || "") ? "zap" : "rise";
    recipe.wave = recipe.wave === "noise" ? "saw" : recipe.wave || "saw";
    recipe.f0 = f0;
    recipe.f1 = f1;
    recipe.durationSec = durationSec;
    recipe.ok = true;
  }
  const rendered = renderRecipeSamples(recipe);
  if (!rendered.ok) return rendered;

  // Syrinx dual-source: mix second detuned oscillator lightly
  const samples = rendered.samples;
  const sr = rendered.sampleRate || SAMPLE_RATE;
  let phase2 = 0;
  for (let i = 0; i < samples.length; i++) {
    const u = i / Math.max(1, samples.length - 1);
    const freq2 = (f0 + (f1 - f0) * u) * 1.03;
    phase2 += freq2 / sr;
    const dual = Math.sin(phase2 * Math.PI * 2) * 0.22 * Math.exp(-u * 1.8);
    samples[i] = Math.max(-1, Math.min(1, samples[i] * 0.85 + dual));
  }
  return {
    ok: true,
    print,
    samples,
    sampleRate: sr,
    durationSec: samples.length / sr,
    recipe,
  };
}

/** Compact on-chain recipe body — designed to fit one VIN (≤720B). */
export function encodeSpatialRecipe({
  id,
  x = 0,
  y = 0,
  z = 0,
  printId = "bird.sparrow.a",
  title = null,
  attachWav = false,
} = {}) {
  const print = BIRD_PRINTS[printId] || BIRD_PRINTS["bird.sparrow.a"];
  const voxel = worldToVoxel(x, y, z);
  const biteId =
    String(id || `${print.species || "bite"}-${voxel.vx}${voxel.vy}${voxel.vz}`)
      .toLowerCase()
      .replace(/[^\w.\-]+/g, "")
      .slice(0, 32) || "spatial01";

  const headerParts = [
    SPATIAL_MAGIC + "v1",
    "id=" + biteId,
    "x=" + Number(x).toFixed(2),
    "y=" + Number(y).toFixed(2),
    "z=" + Number(z).toFixed(2),
    "voxel=" + voxelKey(voxel),
    "print=" + print.id,
    "f0=" + print.f0,
    "f1=" + print.f1,
    "ms=" + print.ms,
    "wave=chirp",
  ];

  let wavB64 = null;
  let wavSha = null;
  let wavBytes = 0;
  if (attachWav) {
    const syn = renderBirdPrintSamples(print);
    if (syn.ok) {
      // Downsample to 8kHz 8-bit mono for micro attach
      const pcm = downsampleToU8(syn.samples, syn.sampleRate, 8000);
      wavBytes = pcm.length;
      wavB64 = pcm.toString("base64");
      wavSha = sha256HexBuf(pcm);
      headerParts.push("pcm8k=" + pcm.length, "pcmsha=" + shortHex(wavSha, 12));
    }
  }

  const provisional = headerParts.join("|") + "§\n";
  const sha = sha256Hex(provisional + (wavB64 || ""));
  const header = headerParts.join("|") + "|sha=" + shortHex(sha, 12) + "§";
  const lines = [
    header,
    "VOXEL SPATIAL · " + (title || print.title) + " · " + print.blurb,
    "formula=" + FORMULA_ID,
    "oneBlockGoal=yes · space only if oversized",
    "player=" + SPATIAL_PLAYER_PATH + "?id=" + biteId,
  ];
  if (wavB64) {
    lines.push("PCM8K_B64");
    lines.push(wavB64);
  }
  const body = lines.join("\n");
  return {
    ok: true,
    id: biteId,
    printId: print.id,
    print,
    x: Number(x),
    y: Number(y),
    z: Number(z),
    voxel,
    title: title || print.title,
    body,
    bodyBytes: Buffer.byteLength(body, "utf8"),
    contentCommit: sha256Hex(body),
    wavAttached: Boolean(wavB64),
    wavBytes,
    oneBlockCandidate: Buffer.byteLength(body, "utf8") <= ONE_BLOCK_GOAL_BYTES,
  };
}

function downsampleToU8(samples, fromRate, toRate) {
  const ratio = fromRate / toRate;
  const n = Math.max(1, Math.floor(samples.length / ratio));
  const out = Buffer.alloc(n);
  for (let i = 0; i < n; i++) {
    const s = samples[Math.min(samples.length - 1, Math.floor(i * ratio))] || 0;
    out[i] = Math.max(0, Math.min(255, Math.round((s * 0.5 + 0.5) * 255)));
  }
  return out;
}

export function parseSpatialRecipe(text) {
  const s = String(text || "");
  if (!s.startsWith(SPATIAL_MAGIC)) {
    return { ok: false, reason: "not a §VITASPATIAL§ body", isSpatial: false };
  }
  const end = s.indexOf("§", SPATIAL_MAGIC.length);
  if (end < 0) return { ok: false, reason: "missing spatial header closer", isSpatial: true };
  const head = s.slice(SPATIAL_MAGIC.length, end);
  const rest = s.slice(end + 1).replace(/^\n/, "");
  const parts = head.split("|");
  const meta = { version: parts[0] || "" };
  for (let i = 1; i < parts.length; i++) {
    const eq = parts[i].indexOf("=");
    if (eq < 0) continue;
    meta[parts[i].slice(0, eq)] = parts[i].slice(eq + 1);
  }
  const voxel = parseVoxelKey(meta.voxel || "0,0,0");
  return {
    ok: true,
    isSpatial: true,
    id: meta.id || "spatial",
    printId: meta.print || null,
    x: Number(meta.x) || 0,
    y: Number(meta.y) || 0,
    z: Number(meta.z) || 0,
    voxel,
    f0: Number(meta.f0) || null,
    f1: Number(meta.f1) || null,
    ms: Number(meta.ms) || null,
    sha: meta.sha || null,
    body: s,
    rest,
    contentCommit: sha256Hex(s),
  };
}

/**
 * Packetize spatial recipe — ONE VIN when ≤720B; else spaced groups.
 */
export function packetizeSpatial(opts = {}) {
  const enc = opts.body
    ? {
        ok: true,
        id: opts.id || "spatial",
        body: opts.body,
        bodyBytes: Buffer.byteLength(opts.body, "utf8"),
        contentCommit: sha256Hex(opts.body),
        print: opts.print || BIRD_PRINTS[opts.printId] || null,
        printId: opts.printId,
        x: opts.x,
        y: opts.y,
        z: opts.z,
        voxel: opts.voxel || worldToVoxel(opts.x, opts.y, opts.z),
        title: opts.title,
        oneBlockCandidate: Buffer.byteLength(opts.body, "utf8") <= ONE_BLOCK_GOAL_BYTES,
      }
    : encodeSpatialRecipe(opts);
  if (!enc.ok) return enc;

  const vinId = "VIN-" + shortHex(sha256Hex(enc.id + "|" + enc.contentCommit), 10).toUpperCase();
  const prepared = prepareVitaFeed(enc.body, { vinId });
  if (!prepared.ok) {
    return { ok: false, reason: "VIN prepare failed: " + prepared.reason };
  }

  const oneBlock = prepared.totalChunks === 1;
  const spaced = prepared.totalChunks > 1;
  const zeroKey = openSourceUnlockKeySync({
    name: "VOXEL\\" + enc.id + ".spatial",
    contentCommit: enc.contentCommit,
  });
  const snark = snarkCompressBlob(enc.body, {
    filename: enc.id + ".spatial",
    locs: [],
  });

  const lineCommits = (prepared.lines || []).map((l) => ({
    index: l.index,
    hash: l.hash,
    contentCommit: sha256Hex(l.line),
    bodyPreview: String(l.body || "").slice(0, 48),
    bytes: Buffer.byteLength(l.line || "", "utf8"),
  }));

  return {
    ok: true,
    id: enc.id,
    filingLabel: SPATIAL_LABEL,
    formula: FORMULA_ID,
    neverInventHashes: true,
    oneBlockGoal: true,
    oneBlock,
    spaced,
    title: enc.title || enc.id,
    printId: enc.printId,
    print: enc.print,
    x: enc.x,
    y: enc.y,
    z: enc.z,
    voxel: enc.voxel,
    body: enc.body,
    bodyBytes: enc.bodyBytes,
    contentCommit: enc.contentCommit,
    totalVin: prepared.totalChunks,
    vinId: prepared.vinId,
    readerKey: prepared.readerKey,
    lines: prepared.lines,
    lineCommits,
    injections: prepared.injections,
    zeroOpenKey: zeroKey.key,
    unlock: zeroKey,
    snarkShort: snark.short,
    snark,
    player: SPATIAL_PLAYER_PATH + "?id=" + enc.id,
    playerHref: vitaPlayerHref(SPATIAL_PLAYER_PATH + "?id=" + enc.id),
    note: oneBlock
      ? "ONE-BLOCK goal met — entire spatial print fits one Base Input Data message"
      : "Spaced " +
        prepared.totalChunks +
        " VIN — body exceeded " +
        ONE_BLOCK_GOAL_BYTES +
        "B; still exact UTF-8",
  };
}

export function synthesizeSpatialWav(packedOrOpts) {
  const packed = packedOrOpts?.ok
    ? packedOrOpts
    : packetizeSpatial(
        typeof packedOrOpts === "string"
          ? { printId: packedOrOpts }
          : packedOrOpts || {},
      );
  if (!packed.ok) return packed;
  const print = packed.print || BIRD_PRINTS[packed.printId];
  const syn = renderBirdPrintSamples(print || "bird.sparrow.a", {
    durationMs: print?.ms,
  });
  if (!syn.ok) return syn;
  const wav = samplesToWav(syn.samples, syn.sampleRate);
  return {
    ok: true,
    id: packed.id,
    mime: "audio/wav",
    bytes: wav,
    sha256: sha256HexBuf(wav),
    durationSec: syn.durationSec,
    waveform: waveformPeaks(wav, 48),
    dataUrl: "data:audio/wav;base64," + wav.toString("base64"),
  };
}

/* ── Catalog + seals ─────────────────────────────────────────────── */

function loadCatalog() {
  ensureDirs();
  return (
    safeReadJson(CATALOG_PATH) || {
      id: "vita-spatial-catalog-v1",
      filingLabel: SPATIAL_LABEL,
      neverInventHashes: true,
      oneBlockGoal: true,
      bites: {},
    }
  );
}

function saveCatalog(root) {
  ensureDirs();
  root.updatedAt = new Date().toISOString();
  writeFileSync(CATALOG_PATH, JSON.stringify(root, null, 2) + "\n");
}

export function ensureSpatialSeedBites() {
  const root = loadCatalog();
  root.bites = root.bites || {};
  const seeds = [
    { id: "sparrow-nest", printId: "bird.sparrow.a", x: 1.2, y: 0.8, z: -0.4 },
    { id: "sparrow-reply", printId: "bird.sparrow.b", x: 1.5, y: 0.9, z: -0.2 },
    { id: "thrush-branch", printId: "bird.thrush.a", x: -0.8, y: 1.4, z: 0.6 },
    { id: "crow-roost", printId: "bird.crow.a", x: 2.0, y: 2.2, z: 1.0 },
    { id: "wren-hedge", printId: "bird.wren.a", x: 0.3, y: 0.2, z: 0.1 },
    { id: "wind-gap", printId: "ambi.wind.a", x: 0, y: 1.0, z: -1.5 },
    { id: "drip-well", printId: "ambi.drop.a", x: -1.2, y: 0.1, z: 0.4 },
    { id: "pad-seed", printId: "tone.pad.a", x: 0, y: 0, z: 0 },
  ];
  let grew = 0;
  for (const s of seeds) {
    const packed = packetizeSpatial(s);
    if (!packed.ok) continue;
    if (!root.bites[packed.id] || root.bites[packed.id].contentCommit !== packed.contentCommit) {
      grew += 1;
    }
    root.bites[packed.id] = {
      id: packed.id,
      printId: packed.printId,
      title: packed.title,
      x: packed.x,
      y: packed.y,
      z: packed.z,
      voxel: packed.voxel,
      contentCommit: packed.contentCommit,
      zeroOpenKey: packed.zeroOpenKey,
      oneBlock: packed.oneBlock,
      totalVin: packed.totalVin,
      bodyBytes: packed.bodyBytes,
      snarkShort: packed.snarkShort,
      player: packed.player,
      color: packed.print?.color || "#00f5d4",
    };
  }
  saveCatalog(root);
  writeStrand("seed spatial bites · grew=" + grew);
  if (grew) appendLearn({ kind: "ensure-seed", grew, count: Object.keys(root.bites).length });
  return root;
}

export function listSpatialBites() {
  return ensureSpatialSeedBites().bites || {};
}

export function resolveSpatialId(sel = "") {
  const raw = String(sel || "").trim().toLowerCase();
  if (!raw) return null;
  const bites = listSpatialBites();
  if (bites[raw]) return raw;
  if (BIRD_PRINTS[raw]) {
    // find first bite with this print
    for (const [id, b] of Object.entries(bites)) {
      if (b.printId === raw) return id;
    }
  }
  for (const [id, b] of Object.entries(bites)) {
    if ((b.title || "").toLowerCase().includes(raw)) return id;
  }
  return null;
}

export function createSpatialBite(opts = {}) {
  const packed = packetizeSpatial(opts);
  if (!packed.ok) return packed;
  const root = loadCatalog();
  root.bites = root.bites || {};
  root.bites[packed.id] = {
    id: packed.id,
    printId: packed.printId,
    title: packed.title,
    x: packed.x,
    y: packed.y,
    z: packed.z,
    voxel: packed.voxel,
    contentCommit: packed.contentCommit,
    zeroOpenKey: packed.zeroOpenKey,
    oneBlock: packed.oneBlock,
    totalVin: packed.totalVin,
    bodyBytes: packed.bodyBytes,
    snarkShort: packed.snarkShort,
    player: packed.player,
    color: packed.print?.color || "#4cc9f0",
    custom: true,
  };
  saveCatalog(root);
  appendLearn({
    kind: "create-spatial",
    id: packed.id,
    oneBlock: packed.oneBlock,
    contentCommit: packed.contentCommit,
  });
  writeStrand("create " + packed.id + (packed.oneBlock ? " ONE-BLOCK" : " spaced"));
  return { ok: true, packed, meta: root.bites[packed.id] };
}

/* ── Seal ledger (real Basescan locs only) ───────────────────────── */

export function loadSpatialSeals() {
  return (
    safeReadJson(SEAL_PATH) || {
      id: "spatial-sound-seals-v1",
      filingLabel: SPATIAL_LABEL,
      neverInventHashes: true,
      byId: {},
    }
  );
}

export function loadBoardSeals() {
  return (
    safeReadJson(BOARD_SEAL_PATH) || {
      id: "soundboard-seals-v1",
      filingLabel: "SOUNDBOARD",
      neverInventHashes: true,
      byId: {},
    }
  );
}

/**
 * Record real sealed locations after /vitafeed confirm|override.
 * Refuses non-tx hashes. This is what enables Basescan click-through.
 */
export function recordSpatialSeal({
  id,
  locations = [],
  contentCommit = null,
  vinId = null,
  kind = "spatial",
} = {}) {
  const locs = (locations || []).map((t) => String(t || "").toLowerCase()).filter(isTxHash);
  if (!locs.length) {
    return {
      ok: false,
      reason:
        "no real tx hashes — VITAFEED_PAID may be OFF or seal failed; never invent Basescan links",
    };
  }
  ensureDirs();
  const path = kind === "board" || kind === "pad" ? BOARD_SEAL_PATH : SEAL_PATH;
  const root =
    kind === "board" || kind === "pad" ? loadBoardSeals() : loadSpatialSeals();
  root.byId = root.byId || {};
  const key = String(id || "unknown");
  const prev = root.byId[key] || { locations: [] };
  const merged = [...new Set([...(prev.locations || []), ...locs])];
  root.byId[key] = {
    id: key,
    locations: merged,
    contentCommit: contentCommit || prev.contentCommit || null,
    vinId: vinId || prev.vinId || null,
    basescan: merged.map(basescanTx),
    sealedAt: new Date().toISOString(),
    proven: true,
  };
  root.updatedAt = new Date().toISOString();
  writeFileSync(path, JSON.stringify(root, null, 2) + "\n");
  appendLearn({ kind: "seal-" + kind, id: key, locs: merged.length });
  return { ok: true, entry: root.byId[key] };
}

export function sealedLocsForSpatial(id) {
  const seals = loadSpatialSeals();
  const row = seals.byId?.[id];
  if (!row?.locations?.length) return [];
  return row.locations.filter(isTxHash).map((tx, i) => ({
    index: i + 1,
    location: tx,
    basescan: basescanTx(tx),
    contentCommit: row.contentCommit || null,
  }));
}

export function sealedLocsForPad(id) {
  const seals = loadBoardSeals();
  const row = seals.byId?.[id];
  if (!row?.locations?.length) return [];
  return row.locations.filter(isTxHash).map((tx, i) => ({
    index: i + 1,
    location: tx,
    basescan: basescanTx(tx),
    contentCommit: row.contentCommit || null,
  }));
}

/**
 * Click-through resolver — sealed body only for "inject proof".
 * Class-proof never claims to be this bite's Input Data.
 */
export function resolveInjectClickThrough({
  id = null,
  kind = "spatial",
  sealedLocs = null,
} = {}) {
  const locs =
    sealedLocs ||
    (kind === "board" || kind === "pad"
      ? sealedLocsForPad(id)
      : sealedLocsForSpatial(id));
  const first = (locs || []).find((l) => isTxHash(l.location));
  if (first) {
    return {
      ok: true,
      proven: true,
      kind: "sealed-body",
      label: "Basescan Input Data · inject proof",
      location: first.location,
      href: first.basescan || basescanTx(first.location),
      clickThrough: true,
      classProof: false,
      note: "Real sealed tx from /vitafeed confirm|override — click → Input Data → UTF-8",
    };
  }
  return {
    ok: true,
    proven: false,
    kind: "pending-seal",
    label: "NO sealed Basescan tx yet",
    location: null,
    href: null,
    clickThrough: false,
    classProof: false,
    note:
      "Nothing to click — pads/bites are availability until inject. " +
      "Enqueue then /vitafeed confirm|override with VITAFEED_PAID=yes. " +
      "Class-proof anchors are hitch class only and will look like the same forever (not this body).",
  };
}

export async function buildSpatialLocProof(opts = {}) {
  const id = opts.id || resolveSpatialId(opts.sel) || "sparrow-nest";
  const bites = listSpatialBites();
  const meta = bites[id];
  if (!meta) return { ok: false, reason: "unknown spatial bite" };
  const packed = packetizeSpatial({
    id: meta.id,
    printId: meta.printId,
    x: meta.x,
    y: meta.y,
    z: meta.z,
    title: meta.title,
  });
  if (!packed.ok) return packed;

  const sealed = [];
  for (const row of opts.sealedLocs || sealedLocsForSpatial(id)) {
    const tx = String(row.location || row.tx || "").toLowerCase();
    if (!isTxHash(tx)) continue;
    sealed.push({
      index: row.index ?? null,
      location: tx,
      utf8: row.utf8 || null,
      basescan: basescanTx(tx),
    });
  }

  const pull = typeof opts.pullUtf8 === "function" ? opts.pullUtf8 : null;
  const rows = [];
  let matched = 0;
  let pending = 0;
  for (const lc of packed.lineCommits || []) {
    const bind =
      sealed.find((s) => s.index == null || s.index === lc.index) ||
      sealed[0] ||
      null;
    let pulledUtf8 = bind?.utf8 || null;
    if (!pulledUtf8 && bind && pull) {
      try {
        pulledUtf8 = await pull(bind.location);
      } catch {
        pulledUtf8 = null;
      }
    }
    let match = "LOCAL_OK";
    let highlight = true;
    let kind = "AVAILABILITY";
    let pulledCommit = null;
    if (pulledUtf8 != null) {
      pulledCommit = sha256Hex(pulledUtf8);
      const hit =
        pulledCommit === lc.contentCommit ||
        pulledUtf8.includes(SPATIAL_MAGIC) ||
        pulledUtf8.includes(packed.id);
      match = hit ? "MATCH" : "MISMATCH";
      kind = hit ? "SEALED_BODY" : "MISMATCH";
      highlight = hit;
      if (hit) matched += 1;
      else pending += 1;
    } else {
      pending += 1;
    }
    rows.push({
      index: lc.index,
      dataFieldCommit: lc.contentCommit,
      bodyPreview: lc.bodyPreview,
      location: bind?.location || null,
      basescan: bind?.basescan || null,
      pulledUtf8Commit: pulledCommit,
      match,
      kind,
      highlight,
      clickThrough: Boolean(bind?.basescan) && match === "MATCH",
      idmChat: bind?.basescan
        ? match === "MATCH"
          ? "Basescan → Input Data → UTF-8 (spatial body MATCH)"
          : "sealed loc but UTF-8 did not MATCH"
        : "await inject — no invented loc · class-proof ≠ this bite",
    });
  }

  const inject = resolveInjectClickThrough({ id, kind: "spatial", sealedLocs: sealed });

  return {
    ok: true,
    id: packed.id,
    title: packed.title,
    oneBlock: packed.oneBlock,
    zeroOpenKey: packed.zeroOpenKey,
    contentCommit: packed.contentCommit,
    voxel: packed.voxel,
    sealedCount: sealed.length,
    matched,
    pending,
    rows,
    inject,
    clickThrough: rows.filter((r) => r.clickThrough),
    classProofNote:
      "Formula anchors are CLASS_PROOF only — identical forever. They are NOT inject proofs for this bite.",
    note: inject.proven
      ? "Sealed inject proof available — click Basescan href"
      : inject.note,
  };
}

/* ── Agentic soundtrack from voxel neighborhood ──────────────────── */

/**
 * Mimic data points already in a voxel region — assemble a short soundtrack
 * plan agents can play / enqueue. Uses catalog prints near the target cell.
 */
export function planSoundtrackFromVoxel({
  voxel = "0,0,0",
  radius = 2,
  maxBites = 6,
} = {}) {
  const center = typeof voxel === "string" ? parseVoxelKey(voxel) : voxel;
  const bites = Object.values(listSpatialBites());
  const scored = bites
    .map((b) => {
      const v = b.voxel || worldToVoxel(b.x, b.y, b.z);
      const dist =
        Math.abs(v.vx - center.vx) +
        Math.abs(v.vy - center.vy) +
        Math.abs(v.vz - center.vz);
      return { ...b, dist, voxel: v };
    })
    .filter((b) => b.dist <= radius)
    .sort((a, b) => a.dist - b.dist || a.id.localeCompare(b.id));

  const picked = scored.slice(0, maxBites);
  const seals = loadSpatialSeals();
  const timeline = picked.map((b, i) => {
    const sealed = seals.byId?.[b.id];
    return {
      n: i + 1,
      id: b.id,
      printId: b.printId,
      title: b.title,
      voxel: b.voxel,
      dist: b.dist,
      delayMs: i * 120,
      oneBlock: b.oneBlock,
      zeroOpenKey: b.zeroOpenKey,
      proven: Boolean(sealed?.locations?.length),
      locations: sealed?.locations || [],
      basescan: (sealed?.locations || []).filter(isTxHash).map(basescanTx),
    };
  });

  return {
    ok: true,
    filingLabel: SPATIAL_LABEL,
    center,
    radius,
    count: timeline.length,
    timeline,
    oneBlockGoal: true,
    note:
      timeline.length === 0
        ? "No bites in neighborhood — create spatial prints near this voxel"
        : "Agent soundtrack mimics " +
          timeline.length +
          " nearby prints · play in order · proven only when sealed locs exist",
  };
}

export function playSoundtrack(planOrVoxel) {
  const plan =
    planOrVoxel?.timeline
      ? planOrVoxel
      : planSoundtrackFromVoxel({
          voxel: typeof planOrVoxel === "string" ? planOrVoxel : planOrVoxel?.voxel,
          radius: planOrVoxel?.radius,
        });
  if (!plan.ok) return plan;
  const clips = [];
  for (const row of plan.timeline || []) {
    const wav = synthesizeSpatialWav({
      id: row.id,
      printId: row.printId,
      x: row.voxel?.vx / VOXEL_SCALE,
      y: row.voxel?.vy / VOXEL_SCALE,
      z: row.voxel?.vz / VOXEL_SCALE,
    });
    if (wav.ok) {
      clips.push({
        ...row,
        mime: wav.mime,
        dataUrl: wav.dataUrl,
        durationSec: wav.durationSec,
        waveform: wav.waveform,
      });
    }
  }
  return {
    ok: true,
    ...plan,
    clips,
    player: SPATIAL_PLAYER_PATH + "?soundtrack=1&voxel=" + voxelKey(plan.center),
  };
}

/* ── Enqueue / cards / telegram ──────────────────────────────────── */

export function enqueueSpatial({
  enqueueFn,
  id = null,
  printId = null,
  x = 0,
  y = 0,
  z = 0,
  source = "spatial-sound",
} = {}) {
  if (typeof enqueueFn !== "function") {
    return { ok: false, reason: "enqueueFn required" };
  }
  let packed;
  if (id && listSpatialBites()[id]) {
    const meta = listSpatialBites()[id];
    packed = packetizeSpatial({
      id: meta.id,
      printId: meta.printId,
      x: meta.x,
      y: meta.y,
      z: meta.z,
      title: meta.title,
    });
  } else {
    packed = packetizeSpatial({ id, printId, x, y, z });
  }
  if (!packed.ok) return packed;

  const item = enqueueFn({
    body: packed.body,
    name: packed.id + ".spatial",
    mime: "text/plain",
    source,
    kind: "spatial",
    meta: {
      spatial: true,
      spatialId: packed.id,
      printId: packed.printId,
      voxel: packed.voxel,
      oneBlock: packed.oneBlock,
      zeroOpenKey: packed.zeroOpenKey,
      contentCommit: packed.contentCommit,
      filingLabel: SPATIAL_LABEL,
    },
  });
  appendLearn({
    kind: "enqueue-spatial",
    id: packed.id,
    oneBlock: packed.oneBlock,
    itemId: item?.item?.id || item?.id || null,
  });
  return {
    ok: true,
    packed,
    item,
    note: packed.oneBlock
      ? "ONE-BLOCK queued — confirm|override seals a single Input Data message"
      : "Spaced " + packed.totalVin + " VIN queued",
  };
}

export function formatSpatialCard(id = null) {
  const bites = listSpatialBites();
  if (id) {
    const meta = bites[id] || bites[resolveSpatialId(id)];
    if (!meta) return SPATIAL_MAGIC + " MISS\nunknown bite";
    const packed = packetizeSpatial({
      id: meta.id,
      printId: meta.printId,
      x: meta.x,
      y: meta.y,
      z: meta.z,
      title: meta.title,
    });
    const inject = resolveInjectClickThrough({ id: meta.id, kind: "spatial" });
    const lines = [
      SPATIAL_MAGIC + "v1|id=" + meta.id + "|voxel=" + voxelKey(meta.voxel) + "§",
      "SPATIAL · " + meta.title + " · print=" + meta.printId,
      "xyz=" + meta.x + "," + meta.y + "," + meta.z + "  voxel=" + voxelKey(meta.voxel),
      "oneBlock=" + (packed.oneBlock ? "YES" : "NO spaced=" + packed.totalVin),
      "bytes=" + packed.bodyBytes + "  commit=" + shortHex(meta.contentCommit, 12),
      "zeroOpenKey=" + meta.zeroOpenKey,
      "snark=" + clip(meta.snarkShort || packed.snarkShort, 64),
      inject.proven
        ? "INJECT PROOF · " + inject.location + " · " + inject.href
        : "INJECT PROOF · NONE — " + inject.note,
      "",
      "play:     /vitafeed spatial " + meta.id,
      "enqueue:  /vitafeed enqueue spatial " + meta.id,
      "locs:     /vita/spatial/locs?id=" + meta.id,
      "voxel:    /vita/spatial?voxel=" + voxelKey(meta.voxel),
    ];
    return lines.join("\n");
  }
  const ids = Object.keys(bites);
  const lines = [
    SPATIAL_MAGIC + "v1|catalog|n=" + ids.length + "§",
    "VOXEL SPATIAL SOUNDBITES · bird prints + xyz",
    "ONE-BLOCK goal ≤" + ONE_BLOCK_GOAL_BYTES + "B · space only if oversized",
    "Z-SNARK open key · inject proof only after seal (VITAFEED_PAID)",
    "player=/vita/spatial  ·  soundtrack=/vitafeed soundtrack 0,0,0",
    "",
  ];
  for (const id of ids) {
    const b = bites[id];
    lines.push(
      id.padEnd(14) +
        "  " +
        voxelKey(b.voxel).padEnd(10) +
        "  " +
        (b.oneBlock ? "1BLK" : "SPA") +
        "  " +
        (b.printId || ""),
    );
  }
  lines.push("");
  lines.push("create:   /vitafeed spatial new bird.sparrow.a 1.2 0.8 -0.4");
  lines.push("enqueue:  /vitafeed enqueue spatial");
  lines.push("track:    /vitafeed soundtrack 0,0,0");
  return lines.join("\n");
}

function btn(text, cmd) {
  return { text: String(text).slice(0, 64), callback_data: telegramCallbackData(cmd) };
}
function urlBtn(text, href) {
  return { text: String(text).slice(0, 64), url: String(href) };
}
function webAppBtn(text, href) {
  return { text: String(text).slice(0, 64), web_app: { url: String(href) } };
}

export function buildSpatialKeyboard({ highlight = null } = {}) {
  const bites = listSpatialBites();
  const ids = Object.keys(bites).slice(0, 12);
  const rows = [];
  for (let i = 0; i < ids.length; i += 3) {
    rows.push(
      ids.slice(i, i + 3).map((id) => {
        const mark = highlight === id ? "● " : "";
        return btn(mark + (bites[id].title || id).slice(0, 18), "/vitafeed spatial " + id);
      }),
    );
  }
  const href = vitaPlayerHref(SPATIAL_PLAYER_PATH);
  rows.push([webAppBtn("▶ Voxel UI", href), urlBtn("↗ Open", href)]);
  rows.push([
    btn("🕊 Spatial", "/vitafeed spatial"),
    btn("🎵 Soundtrack", "/vitafeed soundtrack 0,0,0"),
    btn("📦 Enqueue", "/vitafeed enqueue spatial"),
  ]);
  rows.push([
    btn("🔊 Board", "/vitafeed board"),
    btn("📂 Dir VOXEL", "/vitafeed dir VOXEL"),
    btn("🏠 Menu", "/vitafeed"),
  ]);
  return { inline_keyboard: rows };
}

export function spatialEntriesFor() {
  const bites = listSpatialBites();
  const out = [];
  let n = 1;
  for (const b of Object.values(bites)) {
    const seals = sealedLocsForSpatial(b.id);
    out.push({
      n: n++,
      name: b.id + ".spatial",
      kind: "spatial",
      bytes: b.bodyBytes || 0,
      unlockName: b.id + ".spatial",
      english:
        b.title +
        " @ voxel " +
        voxelKey(b.voxel) +
        " · print " +
        b.printId +
        (b.oneBlock ? " · ONE-BLOCK" : " · spaced") +
        " · " +
        b.zeroOpenKey,
      machine:
        "SPATIAL id=" +
        b.id +
        " voxel=" +
        voxelKey(b.voxel) +
        " print=" +
        b.printId +
        " oneBlock=" +
        (b.oneBlock ? 1 : 0) +
        " commit=" +
        shortHex(b.contentCommit, 8),
      locations: seals.map((s) => s.location),
      trueName: b.id,
      mime: "text/plain",
      playKind: "audio",
      dirId: b.id,
      contentCommit: b.contentCommit,
    });
  }
  return out;
}

export function publicSpatialState(id = null) {
  ensureSpatialSeedBites();
  if (id) {
    const rid = resolveSpatialId(id) || id;
    const meta = listSpatialBites()[rid];
    if (!meta) return { ok: false, reason: "unknown spatial id" };
    const packed = packetizeSpatial({
      id: meta.id,
      printId: meta.printId,
      x: meta.x,
      y: meta.y,
      z: meta.z,
      title: meta.title,
    });
    const inject = resolveInjectClickThrough({ id: meta.id, kind: "spatial" });
    const wav = synthesizeSpatialWav(packed);
    return {
      ok: true,
      ...meta,
      packed: {
        oneBlock: packed.oneBlock,
        totalVin: packed.totalVin,
        bodyBytes: packed.bodyBytes,
        zeroOpenKey: packed.zeroOpenKey,
        snarkShort: packed.snarkShort,
        contentCommit: packed.contentCommit,
      },
      inject,
      play: wav.ok
        ? {
            dataUrl: wav.dataUrl,
            waveform: wav.waveform,
            durationSec: wav.durationSec,
            sha256: wav.sha256,
          }
        : null,
    };
  }
  const bites = listSpatialBites();
  const voxels = {};
  for (const b of Object.values(bites)) {
    const k = voxelKey(b.voxel);
    voxels[k] = voxels[k] || [];
    voxels[k].push({
      id: b.id,
      title: b.title,
      printId: b.printId,
      color: b.color,
      oneBlock: b.oneBlock,
      proven: Boolean(loadSpatialSeals().byId?.[b.id]?.locations?.length),
    });
  }
  return {
    ok: true,
    id: SPATIAL_ID,
    filingLabel: SPATIAL_LABEL,
    formula: FORMULA_ID,
    neverInventHashes: true,
    oneBlockGoal: true,
    oneBlockCap: ONE_BLOCK_GOAL_BYTES,
    player: SPATIAL_PLAYER_PATH,
    biteCount: Object.keys(bites).length,
    bites: Object.values(bites),
    voxels,
    prints: Object.values(BIRD_PRINTS),
    injectNote:
      "Basescan click-through appears only after /vitafeed confirm|override seals real tx hashes (VITAFEED_PAID=yes). Class-proof anchors are not inject proofs.",
  };
}

export function publicSpatialPlay(id = "sparrow-nest") {
  const rid = resolveSpatialId(id) || id;
  const meta = listSpatialBites()[rid];
  if (!meta) return { ok: false, reason: "unknown spatial id" };
  const packed = packetizeSpatial({
    id: meta.id,
    printId: meta.printId,
    x: meta.x,
    y: meta.y,
    z: meta.z,
    title: meta.title,
  });
  const wav = synthesizeSpatialWav(packed);
  const inject = resolveInjectClickThrough({ id: meta.id, kind: "spatial" });
  return {
    ok: wav.ok,
    id: meta.id,
    title: meta.title,
    voxel: meta.voxel,
    oneBlock: packed.oneBlock,
    zeroOpenKey: packed.zeroOpenKey,
    inject,
    ...wav,
    note: inject.proven
      ? "Playing + sealed inject proof linked"
      : "Playing from availability recipe — no Basescan body yet",
  };
}

export function publicSpatialSoundtrack(voxel = "0,0,0", radius = 2) {
  return playSoundtrack({ voxel, radius });
}

/**
 * After /vitafeed confirm|override — bind real sealed locs to pad/spatial ids.
 * Enables Basescan inject click-through. Never invents hashes.
 */
export function maybeRecordSoundSeals({
  body = "",
  backlogItem = null,
  locations = [],
  vinId = null,
  contentCommit = null,
} = {}) {
  const locs = (locations || []).map(String).filter(isTxHash);
  if (!locs.length) {
    return {
      ok: false,
      reason: "no real tx hashes — VITAFEED_PAID may be OFF; never invent Basescan links",
    };
  }
  const meta = backlogItem?.meta || {};
  const text = String(body || backlogItem?.body || "");
  const results = [];

  // Explicit meta from enqueue (preferred)
  if (meta.spatial || meta.spatialId || meta.filingLabel === SPATIAL_LABEL) {
    const id = meta.spatialId || resolveSpatialId(backlogItem?.name) || parseIdFromBody(text, SPATIAL_MAGIC);
    if (id) {
      results.push(
        recordSpatialSeal({
          id,
          locations: locs,
          contentCommit: contentCommit || meta.contentCommit || null,
          vinId,
          kind: "spatial",
        }),
      );
    }
  }
  if (meta.soundboard || meta.padId || meta.filingLabel === "SOUNDBOARD") {
    const id = meta.padId || parseIdFromBody(text, "§VITABOARD§");
    if (id) {
      results.push(
        recordSpatialSeal({
          id,
          locations: locs,
          contentCommit: contentCommit || meta.padContentCommit || meta.contentCommit || null,
          vinId,
          kind: "pad",
        }),
      );
      results.push(
        recordPadSeal({
          id,
          locations: locs,
          contentCommit: contentCommit || meta.padContentCommit || meta.contentCommit || null,
          vinId,
        }),
      );
    }
  }

  // Body magic fallback (direct stage without backlog meta)
  if (!results.length && text.includes(SPATIAL_MAGIC)) {
    const id = parseIdFromBody(text, SPATIAL_MAGIC);
    if (id) {
      results.push(
        recordSpatialSeal({
          id,
          locations: locs,
          contentCommit,
          vinId,
          kind: "spatial",
        }),
      );
    }
  }
  if (!results.length && text.includes("§VITABOARD§")) {
    const id = parseIdFromBody(text, "§VITABOARD§");
    if (id) {
      results.push(
        recordSpatialSeal({
          id,
          locations: locs,
          contentCommit,
          vinId,
          kind: "pad",
        }),
      );
      results.push(
        recordPadSeal({
          id,
          locations: locs,
          contentCommit,
          vinId,
        }),
      );
    }
  }

  const ok = results.some((r) => r?.ok);
  if (ok) writeStrand("seal click-through · locs=" + locs.length);
  return {
    ok,
    results,
    locations: locs,
    note: ok
      ? "Sealed inject proof recorded — Basescan click-through live"
      : "Body was not pad/spatial — library seal only",
  };
}

function parseIdFromBody(text, magic) {
  const s = String(text || "");
  const re = new RegExp(
    String(magic).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
      "[^\\n]*?id=([a-zA-Z0-9._\\-]+)",
  );
  const m = s.match(re);
  return m ? m[1].toLowerCase() : null;
}

export function resolveSpatialEnqueueTarget(sel = "") {

  const s = String(sel || "").trim().toLowerCase();
  if (
    s === "spatial" ||
    s === "voxel" ||
    s === "spatial library" ||
    s === "voxels" ||
    s === "birds"
  ) {
    return { kind: "library" };
  }
  const m = s.match(/^(?:spatial|voxel|bird)\s+(\S+)/);
  if (m) {
    const id = resolveSpatialId(m[1]) || m[1];
    if (listSpatialBites()[id] || BIRD_PRINTS[id]) {
      return { kind: "spatial", id, printId: BIRD_PRINTS[id] ? id : null };
    }
    return { kind: "miss", reason: "unknown spatial " + m[1] };
  }
  const id = resolveSpatialId(s);
  if (id && listSpatialBites()[id]) return { kind: "spatial", id };
  return null;
}

export function enqueueSpatialLibrary({ enqueueFn, source = "spatial-library" } = {}) {
  ensureSpatialSeedBites();
  const ids = Object.keys(listSpatialBites());
  const added = [];
  for (const id of ids) {
    const r = enqueueSpatial({ enqueueFn, id, source });
    if (r.ok) added.push(id);
  }
  return { ok: true, added: added.length, ids: added };
}

export function isSpatialPlaySelector(sel = "") {
  const s = String(sel || "").trim().toLowerCase();
  if (/^(?:spatial|voxel|bird|soundtrack)\b/.test(s)) return true;
  if (resolveSpatialId(s)) return true;
  return false;
}

export function playSpatial(id = "sparrow-nest") {
  const rid = resolveSpatialId(id) || id;
  const meta = listSpatialBites()[rid];
  if (!meta) return { ok: false, reason: "unknown spatial id" };
  const wav = publicSpatialPlay(rid);
  const inject = resolveInjectClickThrough({ id: rid, kind: "spatial" });
  return {
    ok: wav.ok !== false,
    id: rid,
    spatial: true,
    proven: inject.proven,
    inject,
    play: wav.ok
      ? {
          name: meta.title,
          kind: "audio",
          mime: wav.mime,
          dataUrl: wav.dataUrl,
          durationSec: wav.durationSec,
        }
      : null,
    playProof: {
      complete: inject.proven,
      card: inject.proven
        ? "INJECT PROOF · " + inject.location
        : "NO sealed Basescan tx — enqueue + VITAFEED_PAID confirm|override",
    },
    playerPath: SPATIAL_PLAYER_PATH + "?id=" + rid,
    playerHref: vitaPlayerHref(SPATIAL_PLAYER_PATH + "?id=" + rid),
    zeroOpenKey: meta.zeroOpenKey,
    reply: formatSpatialCard(rid),
  };
}

export async function publicSpatialLocs(id = "sparrow-nest") {
  return buildSpatialLocProof({ id: resolveSpatialId(id) || id });
}

export function publicSpatialLoc(id = "sparrow-nest", index = 1) {
  const rid = resolveSpatialId(id) || id;
  const meta = listSpatialBites()[rid];
  if (!meta) return { ok: false, reason: "unknown" };
  const packed = packetizeSpatial({
    id: meta.id,
    printId: meta.printId,
    x: meta.x,
    y: meta.y,
    z: meta.z,
    title: meta.title,
  });
  if (!packed.ok) return packed;
  const i = Math.max(1, Number(index) || 1);
  const line = (packed.lines || []).find((l) => l.index === i) || packed.lines?.[0];
  if (!line) return { ok: false, reason: "no VIN line" };
  const inject = resolveInjectClickThrough({ id: meta.id, kind: "spatial" });
  return {
    ok: true,
    id: packed.id,
    index: line.index,
    oneBlock: packed.oneBlock,
    dataFieldCommit: sha256Hex(line.line),
    zeroOpenKey: packed.zeroOpenKey,
    utf8: line.line,
    utf8Bytes: Buffer.byteLength(line.line, "utf8"),
    inject,
    note:
      "Exact §VITASPATIAL§ UTF-8 for this VIN. After seal, Basescan Input Data must MATCH. " +
      (inject.proven ? "Inject proof: " + inject.href : inject.note),
  };
}

try {
  ensureSpatialSeedBites();
} catch {
  /* cold */
}
