/**
 * VITA blockchain DJ soundboard — meme pads + prompted music bites → §VITAFILE§ VIN.
 *
 * Classic DJ / meme-pad catalog (procedural PCM WAV — no copyrighted samples):
 *   airhorn · kick · snare · clap · hat · rim · crash · scratch · laser · coin
 *   whoosh · drop · beep · siren · bounce · tick
 *
 * Prompted bites: recipe string → ADSR + oscillator → WAV (same path top AI
 * music tools use for short conditioned clips). Upload path: any audio bytes
 * → packetize → backlog → inject → reader.
 *
 * Zero-snark open key = name + contentCommit (VITAOPEN… — never a wallet secret).
 * Loc rail: LOCAL_OK (availability) vs MATCH (sealed Input Data) vs CLASS_PROOF
 * (formula anchors — NOT pad body). Fixes “same data / no new inputs” hallucination
 * by refusing to pretend class-proof locs hold pad UTF-8.
 *
 * Telegram: /vitafeed board · /vitafeed pad <id> · /vitafeed prompt <recipe>
 * · /vitafeed enqueue pad <id> · /vitafeed dual pad <id> · /vitafeed dir BOARD
 * Player: /vita/soundboard · /vita/soundboard?pad=<id>
 * Locs: /vita/soundboard/locs?id=<id> · inspect /vita/soundboard/loc?id=<id>&i=1
 *
 * Mother brain untouched. Never invents tx hashes. VITAFEED_PAID default OFF.
 */

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FORMULA_ID, MAINFRAME_ANCHORS } from "./mainframe.js";
import {
  encodeVitaFile,
  parseVitaFileBody,
  prepareVitaFileFeed,
} from "./vita-feed-file.js";
import { prepareVitaFeed, VITAFEED_MAX_CHUNK_BYTES } from "./vita-feed.js";
import { vitaPlayerHref } from "./url-dir.js";
import { telegramCallbackData } from "./mirror-chain.js";

export function openSourceUnlockKeySync(opts) {
  // Inline twin of vita-dir openSourceUnlockKey (name+contentCommit, never wallet secret)
  const commit = opts.contentCommit || sha256Hex(String(opts.content || opts.name || ""));
  const name = String(opts.name || "untitled");
  const safe = name.replace(/[^\w.\-]+/g, "_").replace(/_+/g, "_").slice(0, 64) || "FILE";
  return {
    scheme: "vita-open-unlock-v1",
    privateKey: false,
    openSource: true,
    name,
    key: "VITAOPEN." + safe + "." + shortHex(commit, 12),
    contentCommit: commit,
    note: "File name unlocks. No wallet secret. Instant unwrap of ZK-short machine form.",
  };
}

function packMachineShortSync({ english, machine, locs = [], trueName = null } = {}) {
  const commit = sha256Hex([english || "", machine || "", (locs || []).join("|")].join("¦"));
  const loc8 = (locs || []).filter((t) => /^0x[0-9a-fA-F]{64}$/.test(String(t))).map((t) => shortHex(t, 8));
  return {
    zkClass: "content-commitment-v1",
    snarkReady: true,
    privateWitness: false,
    instantUnwrap: true,
    short:
      "ZK§" +
      shortHex(commit, 10) +
      (trueName ? "|T=" + trueName : "") +
      (loc8.length ? "|L=" + loc8.join(",") : "") +
      "|M=" +
      clip(machine || english || "", 48),
    commit,
    loc8,
  };
}

const HERE = dirname(fileURLToPath(import.meta.url));
const MEMORY_DIR = join(HERE, "memory");
const STRANDS_DIR = join(HERE, "strands");
const PAD_DIR = join(MEMORY_DIR, "soundboard");
const CATALOG_PATH = join(MEMORY_DIR, "soundboard-catalog.json");
const LEARN_PATH = join(MEMORY_DIR, "soundboard-learn.json");
const UPLOAD_LEDGER = join(MEMORY_DIR, "soundboard-uploads.json");
const STRAND_PATH = join(STRANDS_DIR, "soundboard.json");
const SEAL_PATH = join(MEMORY_DIR, "soundboard-seals.json");

export const SOUNDBOARD_ID = "vita-soundboard-v1";
export const SOUNDBOARD_MAGIC = "§VITABOARD§";
export const SOUNDBOARD_LABEL = "SOUNDBOARD";
export const SOUNDBOARD_SUBDIR = "BOARD";
export const SOUNDBOARD_PLAYER_PATH = "/vita/soundboard";
export const SAMPLE_RATE = 22050;
export const PAD_VIN_CAP = 24;

/** Classic DJ / meme pad recipes — procedural synth, CC0-class originals. */
export const PAD_RECIPES = Object.freeze({
  airhorn: {
    id: "airhorn",
    title: "Airhorn",
    blurb: "Classic DJ meme blast — rising saw",
    color: "#ff6b35",
    recipe: "saw rise 220→880 0.32s gain=0.55",
    aliases: ["horn", "mlg", "blast"],
  },
  kick: {
    id: "kick",
    title: "Kick",
    blurb: "808-style punch",
    color: "#2d6a4f",
    recipe: "sine drop 120→38 0.22s gain=0.9",
    aliases: ["bass", "808", "drum"],
  },
  snare: {
    id: "snare",
    title: "Snare",
    blurb: "Crack + noise body",
    color: "#e9c46a",
    recipe: "noise+tone 180hz 0.14s gain=0.7",
    aliases: ["snr"],
  },
  clap: {
    id: "clap",
    title: "Clap",
    blurb: "Filtered hand clap",
    color: "#f4a261",
    recipe: "noise clap 0.1s gain=0.65",
    aliases: ["hands"],
  },
  hat: {
    id: "hat",
    title: "Hi-hat",
    blurb: "Closed tick",
    color: "#90e0ef",
    recipe: "noise hat 0.05s gain=0.4",
    aliases: ["hihat", "hh"],
  },
  rim: {
    id: "rim",
    title: "Rimshot",
    blurb: "Ba-dum setup click",
    color: "#cdb4db",
    recipe: "sine click 900hz 0.04s gain=0.55",
    aliases: ["rimshot", "badum"],
  },
  crash: {
    id: "crash",
    title: "Crash",
    blurb: "Cymbal wash / ba-dum-tss",
    color: "#ffd6a5",
    recipe: "noise crash 0.32s gain=0.5",
    aliases: ["cymbal", "tss"],
  },
  scratch: {
    id: "scratch",
    title: "Scratch",
    blurb: "Vinyl wick-wick",
    color: "#9b5de5",
    recipe: "saw scratch 0.22s gain=0.45",
    aliases: ["vinyl", "wick"],
  },
  laser: {
    id: "laser",
    title: "Laser",
    blurb: "Zap sweep",
    color: "#00f5d4",
    recipe: "saw zap 1200→200 0.16s gain=0.5",
    aliases: ["zap", "pew"],
  },
  coin: {
    id: "coin",
    title: "Coin",
    blurb: "Bright collect ping",
    color: "#fee440",
    recipe: "sine coin 988→1319 0.14s gain=0.45",
    aliases: ["ping", "collect"],
  },
  whoosh: {
    id: "whoosh",
    title: "Whoosh",
    blurb: "Transition sweep",
    color: "#a2d2ff",
    recipe: "noise whoosh 0.28s gain=0.4",
    aliases: ["sweep", "swoosh"],
  },
  drop: {
    id: "drop",
    title: "Bass drop",
    blurb: "Sub dive into silence",
    color: "#3a0ca3",
    recipe: "sine drop 90→28 0.32s gain=0.85",
    aliases: ["sub", "bassdrop"],
  },
  beep: {
    id: "beep",
    title: "Beep",
    blurb: "UI confirm tone",
    color: "#80ed99",
    recipe: "square beep 880hz 0.1s gain=0.35",
    aliases: ["tone", "ui"],
  },
  siren: {
    id: "siren",
    title: "Siren",
    blurb: "Wail up-down",
    color: "#ef476f",
    recipe: "saw siren 0.35s gain=0.4",
    aliases: ["wail", "alarm"],
  },
  bounce: {
    id: "bounce",
    title: "Bounce",
    blurb: "Springy boing",
    color: "#ff9f1c",
    recipe: "sine bounce 0.22s gain=0.5",
    aliases: ["boing", "spring"],
  },
  tick: {
    id: "tick",
    title: "Tick",
    blurb: "Metronome click",
    color: "#edf2f4",
    recipe: "noise tick 0.03s gain=0.5",
    aliases: ["metro", "click"],
  },
});

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

function ensureDirs() {
  for (const d of [MEMORY_DIR, STRANDS_DIR, PAD_DIR]) {
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
    id: "soundboard-learn-v1",
    filingLabel: SOUNDBOARD_LABEL,
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
    id: SOUNDBOARD_ID,
    filingLabel: SOUNDBOARD_LABEL,
    formula: FORMULA_ID,
    neverInventHashes: true,
    zeroSnarkOpenKey: true,
    note:
      note ||
      "BOARD pads → §VITAFILE§ VIN → inject → reader. Zero-open-key = name+contentCommit. Loc MATCH only on sealed body.",
    ends: [
      "Telegram pad grid (/vitafeed board)",
      "HTML waveform board (/vita/soundboard)",
      "Injector spaced VIN → Basescan Input Data",
      "Reader loc rail · click-through MATCH",
    ],
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(STRAND_PATH, JSON.stringify(strand, null, 2) + "\n");
  return strand;
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Deterministic PRNG from seed string (same pad → same WAV). */
function mulberry32(seed) {
  let t = seed >>> 0;
  return function next() {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFrom(s) {
  return parseInt(sha256Hex(s).slice(0, 8), 16) >>> 0;
}

function osc(kind, phase) {
  const p = phase % 1;
  if (kind === "sine") return Math.sin(p * Math.PI * 2);
  if (kind === "square") return p < 0.5 ? 1 : -1;
  if (kind === "saw") return 2 * p - 1;
  if (kind === "tri") return p < 0.5 ? 4 * p - 1 : 3 - 4 * p;
  return Math.sin(p * Math.PI * 2);
}

/**
 * Parse a short music-bite prompt into a synth recipe.
 * Examples: "saw rise 220→880 0.9s gain=0.55" · "kick punch 0.3s" · "beep 880hz"
 */
export function parsePromptRecipe(prompt = "") {
  const raw = String(prompt || "").trim().toLowerCase();
  if (!raw) {
    return { ok: false, reason: "empty prompt — try: saw rise 220→880 0.9s" };
  }
  // Named pad shortcut
  const named = resolvePadId(raw.split(/\s+/)[0]);
  if (named && PAD_RECIPES[named] && raw === named) {
    return { ok: true, ...parsePromptRecipe(PAD_RECIPES[named].recipe), padId: named };
  }

  let wave = "sine";
  if (/\bsaw\b/.test(raw)) wave = "saw";
  else if (/\bsquare\b/.test(raw)) wave = "square";
  else if (/\btri(?:angle)?\b/.test(raw)) wave = "tri";
  else if (/\bnoise\b/.test(raw)) wave = "noise";

  let style = "tone";
  if (/\brise\b/.test(raw)) style = "rise";
  else if (/\bdrop\b/.test(raw)) style = "drop";
  else if (/\bscratch\b|\bwick\b/.test(raw)) style = "scratch";
  else if (/\bzap\b|\blaser\b/.test(raw)) style = "zap";
  else if (/\bsiren\b|\bwail\b/.test(raw)) style = "siren";
  else if (/\bclap\b/.test(raw)) style = "clap";
  else if (/\bhat\b|\bhi-?hat\b/.test(raw)) style = "hat";
  else if (/\bcrash\b|\bcymbal\b|\btss\b/.test(raw)) style = "crash";
  else if (/\bwhoosh\b|\bsweep\b/.test(raw)) style = "whoosh";
  else if (/\bbounce\b|\bboing\b/.test(raw)) style = "bounce";
  else if (/\bcoin\b|\bping\b/.test(raw)) style = "coin";
  else if (/\btick\b|\bclick\b/.test(raw)) style = "tick";
  else if (/\bbeep\b/.test(raw)) style = "beep";
  else if (/\bkick\b|\b808\b/.test(raw)) style = "kick";
  else if (/\bsnare\b/.test(raw)) style = "snare";
  else if (/\bairhorn\b|\bhorn\b/.test(raw)) style = "airhorn";

  const durM = raw.match(/(\d+(?:\.\d+)?)\s*s\b/);
  const hzPair = raw.match(/(\d+(?:\.\d+)?)\s*(?:→|->|to)\s*(\d+(?:\.\d+)?)/);
  const hzOne = raw.match(/(\d+(?:\.\d+)?)\s*hz\b/);
  const gainM = raw.match(/gain\s*=\s*(\d+(?:\.\d+)?)/);

  let f0 = 440;
  let f1 = 440;
  if (hzPair) {
    f0 = Number(hzPair[1]);
    f1 = Number(hzPair[2]);
  } else if (hzOne) {
    f0 = f1 = Number(hzOne[1]);
  } else if (style === "kick" || style === "drop") {
    f0 = 120;
    f1 = 38;
  } else if (style === "airhorn" || style === "rise") {
    f0 = 220;
    f1 = 880;
    wave = wave === "sine" ? "saw" : wave;
  } else if (style === "zap") {
    f0 = 1200;
    f1 = 200;
    wave = "saw";
  } else if (style === "coin") {
    f0 = 988;
    f1 = 1319;
  } else if (style === "beep") {
    f0 = f1 = 880;
    wave = "square";
  } else if (style === "rim" || style === "tick") {
    f0 = f1 = 900;
  }

  let durationSec = durM ? Number(durM[1]) : 0.22;
  // Keep built-in bites VIN-thrifty (≤24 packets @ 22050 mono) unless prompt asks longer.
  if (style === "hat" || style === "tick") durationSec = Math.min(durationSec, 0.06);
  durationSec = clamp(durationSec, 0.02, 1.2);

  const gain = clamp(gainM ? Number(gainM[1]) : 0.55, 0.05, 1);

  return {
    ok: true,
    prompt: raw,
    wave,
    style,
    f0,
    f1,
    durationSec,
    gain,
    sampleRate: SAMPLE_RATE,
  };
}

/**
 * Render PCM samples from a parsed recipe (AI-music-bite class).
 */
export function renderRecipeSamples(recipe) {
  if (!recipe?.ok && !(recipe?.durationSec > 0)) {
    const parsed = parsePromptRecipe(recipe?.prompt || recipe);
    if (!parsed.ok) return parsed;
    return renderRecipeSamples(parsed);
  }
  const sr = recipe.sampleRate || SAMPLE_RATE;
  const n = Math.max(1, Math.floor(recipe.durationSec * sr));
  const samples = new Float32Array(n);
  const rnd = mulberry32(seedFrom(JSON.stringify({
    w: recipe.wave,
    s: recipe.style,
    f0: recipe.f0,
    f1: recipe.f1,
    d: recipe.durationSec,
    g: recipe.gain,
  })));
  let phase = 0;
  const style = recipe.style || "tone";
  const wave = recipe.wave || "sine";

  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const u = i / Math.max(1, n - 1);
    let freq = lerp(recipe.f0, recipe.f1, u);
    let env = 1;
    let sample = 0;

    if (style === "kick" || style === "drop") {
      freq = recipe.f0 * Math.pow(recipe.f1 / recipe.f0, Math.min(1, t / (recipe.durationSec * 0.55)));
      env = Math.exp(-t * (style === "kick" ? 12 : 5));
      sample = osc("sine", phase) * env;
    } else if (style === "airhorn" || style === "rise") {
      freq = lerp(recipe.f0, recipe.f1, Math.pow(u, 0.7));
      env = Math.min(1, t / 0.04) * (1 - Math.pow(u, 2.2));
      sample = osc("saw", phase) * env;
    } else if (style === "scratch") {
      freq = 400 + Math.sin(t * 38) * 280 + Math.sin(t * 9) * 90;
      env = Math.min(1, t / 0.01) * Math.exp(-t * 2.2);
      sample = osc("saw", phase) * env * 0.7 + (rnd() * 2 - 1) * 0.15 * env;
    } else if (style === "zap") {
      freq = lerp(recipe.f0, recipe.f1, u);
      env = Math.exp(-t * 8);
      sample = osc("saw", phase) * env;
    } else if (style === "siren") {
      freq = 500 + Math.sin(t * Math.PI * 2 * 2.2) * 350;
      env = Math.min(1, t / 0.05) * (1 - u * 0.15);
      sample = osc("saw", phase) * env * 0.7;
    } else if (style === "clap" || style === "hat" || style === "crash" || style === "whoosh" || style === "tick" || style === "snare") {
      const noise = rnd() * 2 - 1;
      if (style === "clap") {
        env = Math.exp(-t * 28) + 0.35 * Math.exp(-t * 9);
        sample = noise * env;
      } else if (style === "hat") {
        env = Math.exp(-t * 80);
        sample = noise * env;
      } else if (style === "crash") {
        env = Math.exp(-t * 3.2);
        sample = noise * env;
      } else if (style === "whoosh") {
        env = Math.sin(Math.PI * u) * Math.exp(-t * 1.2);
        sample = noise * env;
      } else if (style === "tick") {
        env = Math.exp(-t * 120);
        sample = noise * env;
      } else {
        // snare
        env = Math.exp(-t * 18);
        sample = noise * 0.7 * env + osc("sine", phase) * 0.35 * env;
        freq = 180;
      }
    } else if (style === "coin") {
      const hop = t < 0.08 ? recipe.f0 : recipe.f1;
      freq = hop;
      env = Math.exp(-t * 9);
      sample = osc("sine", phase) * env;
    } else if (style === "bounce") {
      freq = 220 + Math.exp(-t * 8) * 400;
      env = Math.abs(Math.sin(t * 28)) * Math.exp(-t * 4);
      sample = osc("sine", phase) * env;
    } else if (style === "beep") {
      env = t < 0.01 ? t / 0.01 : t > recipe.durationSec - 0.02 ? (recipe.durationSec - t) / 0.02 : 1;
      sample = osc(wave === "noise" ? "square" : wave, phase) * env;
    } else {
      env = Math.min(1, t / 0.01) * Math.exp(-t * 4);
      sample = (wave === "noise" ? rnd() * 2 - 1 : osc(wave, phase)) * env;
    }

    phase += freq / sr;
    samples[i] = clamp(sample * (recipe.gain || 0.55), -1, 1);
  }

  // Soft peak normalize
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(samples[i]));
  if (peak > 0.001) {
    const scale = 0.92 / peak;
    for (let i = 0; i < n; i++) samples[i] *= scale;
  }

  return {
    ok: true,
    samples,
    sampleRate: sr,
    durationSec: n / sr,
    recipe,
  };
}

/** Pack Float32 mono → 16-bit PCM WAV Buffer. */
export function samplesToWav(samples, sampleRate = SAMPLE_RATE) {
  const n = samples.length;
  const dataSize = n * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < n; i++) {
    const s = clamp(Math.round(samples[i] * 32767), -32768, 32767);
    buf.writeInt16LE(s, 44 + i * 2);
  }
  return buf;
}

export function synthesizePadWav(padOrPrompt) {
  const id = resolvePadId(padOrPrompt);
  const recipeStr = id && PAD_RECIPES[id]
    ? PAD_RECIPES[id].recipe
    : String(padOrPrompt || "");
  const parsed = parsePromptRecipe(recipeStr);
  if (!parsed.ok) return parsed;
  if (id) parsed.padId = id;
  const rendered = renderRecipeSamples(parsed);
  if (!rendered.ok) return rendered;
  const wav = samplesToWav(rendered.samples, rendered.sampleRate);
  return {
    ok: true,
    id: id || ("prompt-" + shortHex(sha256Hex(recipeStr), 8)),
    title: id && PAD_RECIPES[id] ? PAD_RECIPES[id].title : "Prompt bite",
    recipe: parsed,
    durationSec: rendered.durationSec,
    sampleRate: rendered.sampleRate,
    bytes: wav,
    sha256: sha256HexBuf(wav),
    mime: "audio/wav",
    fileName: (id || "prompt") + ".wav",
  };
}

/** Downsample for UI waveform (0..1 abs peaks). */
export function waveformPeaks(samplesOrBuf, bars = 64) {
  let samples;
  if (samplesOrBuf instanceof Float32Array) {
    samples = samplesOrBuf;
  } else if (Buffer.isBuffer(samplesOrBuf) && samplesOrBuf.length > 44) {
    const n = Math.floor((samplesOrBuf.length - 44) / 2);
    samples = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      samples[i] = samplesOrBuf.readInt16LE(44 + i * 2) / 32768;
    }
  } else {
    return [];
  }
  const out = [];
  const step = Math.max(1, Math.floor(samples.length / bars));
  for (let i = 0; i < bars; i++) {
    let peak = 0;
    const start = i * step;
    const end = Math.min(samples.length, start + step);
    for (let j = start; j < end; j++) peak = Math.max(peak, Math.abs(samples[j]));
    out.push(Number(peak.toFixed(4)));
  }
  return out;
}

export function resolvePadId(sel = "") {
  const raw = String(sel || "").trim().toLowerCase();
  if (!raw) return null;
  if (PAD_RECIPES[raw]) return raw;
  for (const [id, meta] of Object.entries(PAD_RECIPES)) {
    if ((meta.aliases || []).includes(raw)) return id;
  }
  // catalog uploads
  const cat = loadCatalogRoot();
  if (cat.pads?.[raw]) return raw;
  for (const [id, meta] of Object.entries(cat.pads || {})) {
    if ((meta.aliases || []).map((a) => String(a).toLowerCase()).includes(raw)) return id;
  }
  return null;
}

export function isSoundboardPlaySelector(sel = "") {
  const s = String(sel || "").trim().toLowerCase();
  if (!s) return false;
  if (/^(?:board|soundboard|pads|dj)$/.test(s)) return true;
  if (/^pad\s+/.test(s)) return resolvePadId(s.replace(/^pad\s+/, "")) != null;
  return resolvePadId(s) != null;
}

function loadCatalogRoot() {
  ensureDirs();
  return (
    safeReadJson(CATALOG_PATH) || {
      id: "vita-soundboard-catalog-v1",
      filingLabel: SOUNDBOARD_LABEL,
      defaultId: "airhorn",
      neverInventHashes: true,
      zeroSnarkOpenKey: true,
      pads: {},
    }
  );
}

function saveCatalog(root) {
  ensureDirs();
  root.updatedAt = new Date().toISOString();
  writeFileSync(CATALOG_PATH, JSON.stringify(root, null, 2) + "\n");
}

/** Ensure built-in pads exist as WAV files + catalog rows. */
export function ensureBuiltInPads() {
  ensureDirs();
  const root = loadCatalogRoot();
  root.pads = root.pads || {};
  let grew = 0;
  for (const meta of Object.values(PAD_RECIPES)) {
    const fileName = meta.id + ".wav";
    const path = join(PAD_DIR, fileName);
    const syn = synthesizePadWav(meta.id);
    if (!syn.ok) continue;
    const needWrite =
      !existsSync(path) ||
      !root.pads[meta.id] ||
      root.pads[meta.id].recipe !== meta.recipe ||
      root.pads[meta.id].sha256 !== syn.sha256;
    if (needWrite) {
      writeFileSync(path, syn.bytes);
      grew += 1;
    }
    const bytes = needWrite ? syn.bytes : readFileSync(path);
    const sha = needWrite ? syn.sha256 : sha256HexBuf(bytes);
    const durationSec = needWrite
      ? syn.durationSec
      : Math.max(0.01, (bytes.length - 44) / 2 / SAMPLE_RATE);
    const peaks = waveformPeaks(bytes, 48);
    const unlock = openSourceUnlockKeySync({
      name: "BOARD\\" + fileName,
      contentCommit: sha,
    });
    const machine = packMachineShortSync({
      english: meta.title + " — " + meta.blurb,
      machine: "PAD id=" + meta.id + " recipe=" + meta.recipe + " sha=" + shortHex(sha, 8),
      locs: [],
      trueName: meta.id,
    });
    root.pads[meta.id] = {
      id: meta.id,
      aliases: meta.aliases || [],
      title: meta.title,
      blurb: meta.blurb,
      color: meta.color,
      recipe: meta.recipe,
      file: "vita/memory/soundboard/" + fileName,
      fileName,
      mime: "audio/wav",
      bytes: bytes.length,
      sha256: sha,
      durationSec: Number(durationSec.toFixed(4)),
      sampleRate: SAMPLE_RATE,
      channels: 1,
      waveform: peaks,
      builtIn: true,
      zeroOpenKey: unlock.key,
      contentCommit: sha,
      snarkShort: machine.short,
      player: SOUNDBOARD_PLAYER_PATH + "?pad=" + meta.id,
      note:
        "Procedural DJ pad → §VITAFILE§ VIN. Proven only when sealed Input Data MATCHES contentCommit. Class-proof anchors ≠ pad body.",
    };
  }
  saveCatalog(root);
  writeStrand("built-in pads ensured · grew=" + grew);
  if (grew) {
    appendLearn({ kind: "ensure-builtin", grew, padCount: Object.keys(root.pads).length });
  }
  return root;
}

export function listCatalogPads() {
  const root = ensureBuiltInPads();
  return root.pads || {};
}

export function listCatalogPadIds() {
  return Object.keys(listCatalogPads());
}

function padFilePath(meta) {
  return join(PAD_DIR, meta.fileName || meta.id + ".wav");
}

function readPadBytes(meta) {
  const path = padFilePath(meta);
  if (!existsSync(path)) {
    // regenerate built-in
    if (meta.builtIn || PAD_RECIPES[meta.id]) {
      const syn = synthesizePadWav(meta.id);
      if (!syn.ok) return syn;
      ensureDirs();
      writeFileSync(path, syn.bytes);
      return { ok: true, bytes: syn.bytes, sha256: syn.sha256, size: syn.bytes.length, path };
    }
    return { ok: false, reason: "pad WAV missing — " + path };
  }
  const bytes = readFileSync(path);
  if (bytes.length < 12 || bytes.subarray(0, 4).toString("ascii") !== "RIFF") {
    return { ok: false, reason: (meta.fileName || "pad") + " is not a WAV RIFF" };
  }
  return { ok: true, bytes, sha256: sha256HexBuf(bytes), size: bytes.length, path };
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

/** Largest raw slice whose §VITAFILE§ VIN count stays ≤ hourly cap. */
export function sliceBytesForPadVinCap(maxChunks = PAD_VIN_CAP) {
  const payloadBudget = VITAFEED_MAX_CHUNK_BYTES * Math.max(1, maxChunks);
  let raw = Math.floor(((payloadBudget - 260) * 3) / 4);
  raw -= raw % 3;
  for (let i = 0; i < 12 && raw >= 192; i++) {
    const probe = Buffer.alloc(raw, 0x5a);
    const prep = prepareVitaFileFeed({
      name: "probe.wav.g99",
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
 * Packetize a pad (or uploaded WAV) into grouped §VITAFILE§ VIN.
 * Short bites = 1 group; larger uploads split ≤24 VIN/group (free-music pattern).
 */
export function packetizePad(idOrSel = "airhorn") {
  const pads = listCatalogPads();
  const id = resolvePadId(idOrSel) || String(idOrSel || "").trim().toLowerCase();
  const meta = pads[id];
  if (!meta) {
    return { ok: false, reason: "unknown pad — try /vitafeed board" };
  }
  const song = readPadBytes(meta);
  if (!song.ok) return song;
  if (meta.sha256 && meta.sha256 !== song.sha256) {
    return {
      ok: false,
      reason: "sha256 mismatch vs catalog — refuse corrupt playback",
      got: song.sha256,
      want: meta.sha256,
    };
  }

  const sliceBytes = sliceBytesForPadVinCap(PAD_VIN_CAP);
  const groups = [];
  const fileName = meta.fileName || id + ".wav";
  for (let off = 0, n = 1; off < song.bytes.length; off += sliceBytes, n++) {
    const slice = song.bytes.subarray(off, Math.min(off + sliceBytes, song.bytes.length));
    const enc = encodeVitaFile({
      name: fileName.replace(/[^\w.\- ]+/g, "_") + (song.bytes.length > sliceBytes ? ".g" + pad2(n) : ""),
      mime: meta.mime || "audio/wav",
      bytes: slice,
    });
    if (!enc.ok) {
      return { ok: false, reason: "group " + n + " encode failed: " + enc.reason };
    }
    const vinId =
      "VIN-" + shortHex(sha256Hex(id + "|g" + pad2(n) + "|" + enc.sha256), 10).toUpperCase();
    const prepared = prepareVitaFeed(enc.body, { vinId });
    if (!prepared.ok) {
      return { ok: false, reason: "group " + n + " VIN prepare failed: " + prepared.reason };
    }
    if (prepared.totalChunks > PAD_VIN_CAP) {
      return {
        ok: false,
        reason: "group " + n + " has " + prepared.totalChunks + " VIN > cap " + PAD_VIN_CAP,
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
      filingPath: "vita/memory/soundboard/" + fileName + (groups.length || song.bytes.length > sliceBytes ? "#g" + pad2(n) : ""),
    });
  }

  // Reconstruct concat must match original
  const parts = [];
  for (const g of groups) {
    const parsed = parseVitaFileBody(g.body);
    if (!parsed.ok) {
      return { ok: false, reason: "group " + g.n + " parse: " + parsed.reason };
    }
    parts.push(parsed.data);
  }
  const rebuilt = Buffer.concat(parts);
  if (sha256HexBuf(rebuilt) !== song.sha256) {
    return { ok: false, reason: "grouped reconstruct sha mismatch — refuse playback" };
  }

  const totalVin = groups.reduce((s, g) => s + g.totalChunks, 0);
  const primary = groups[0];
  const zeroKey = openSourceUnlockKeySync({
    name: "BOARD\\" + fileName,
    contentCommit: song.sha256,
  });
  const machine = packMachineShortSync({
    english: (meta.title || id) + " — " + (meta.blurb || meta.recipe || "pad"),
    machine:
      "PAD id=" +
      id +
      " groups=" +
      groups.length +
      " vin=" +
      totalVin +
      " commit=" +
      shortHex(song.sha256, 8),
    locs: [],
    trueName: id,
  });

  // Flat lineCommits for loc rail (group-aware index = g.n * 1000 + i when multi)
  const lineCommits = [];
  for (const g of groups) {
    for (const lc of g.lineCommits || []) {
      lineCommits.push({
        ...lc,
        groupN: g.n,
        flatIndex: (g.n - 1) * 1000 + lc.index,
      });
    }
  }

  return {
    ok: true,
    id,
    filingLabel: SOUNDBOARD_LABEL,
    formula: FORMULA_ID,
    neverInventHashes: true,
    zeroSnarkOpenKey: true,
    title: meta.title || id,
    blurb: meta.blurb || "",
    recipe: meta.recipe || null,
    color: meta.color || "#888",
    license: meta.license || "Procedural original (CC0-class synth)",
    fileName,
    mime: meta.mime || "audio/wav",
    playKind: "audio",
    rawBytes: song.size,
    sha256: song.sha256,
    contentCommit: song.sha256,
    durationSec: meta.durationSec || null,
    waveform: meta.waveform || waveformPeaks(song.bytes, 48),
    vinCap: PAD_VIN_CAP,
    groupCount: groups.length,
    groups,
    totalVin,
    vinId: primary.vinId,
    readerKey: primary.readerKey,
    body: primary.body,
    lines: primary.lines,
    lineCommits,
    injections: primary.injections,
    filingPath: "vita/memory/soundboard/" + fileName,
    zeroOpenKey: zeroKey.key,
    unlock: zeroKey,
    snarkShort: machine.short,
    machine,
    player: SOUNDBOARD_PLAYER_PATH + "?pad=" + id,
    playerHref: vitaPlayerHref(SOUNDBOARD_PLAYER_PATH + "?pad=" + id),
    note:
      "Pad → " +
      groups.length +
      " grouped §VITAFILE§ VIN (" +
      totalVin +
      " packets, ≤" +
      PAD_VIN_CAP +
      "/group). Proven = sealed Input Data UTF-8 MATCH. Class-proof anchors are NOT this pad.",
  };
}

export function padDualHumanBody(plan = null, id = "airhorn") {
  const packed = plan?.ok ? plan : packetizePad(id);
  if (!packed.ok) return "";
  return [
    SOUNDBOARD_MAGIC +
      "v1|id=" +
      packed.id +
      "|vin=" +
      packed.totalVin +
      "|bytes=" +
      packed.rawBytes +
      "|sha256=" +
      packed.sha256 +
      "§",
    "SOUNDBOARD PAD — " + packed.title + (packed.blurb ? " · " + packed.blurb : ""),
    packed.recipe ? "recipe: " + packed.recipe : "uploaded audio bite",
    "formula=" + FORMULA_ID,
    "zeroOpenKey=" + packed.zeroOpenKey,
    "player=" + packed.player,
    "vin=" + packed.totalVin + "  commit=" + shortHex(packed.sha256, 12),
    "filing=" + packed.filingPath,
    "PROVEN only after inject seals matching Input Data — class-proof ≠ pad body",
  ].join("\n");
}

export function padMachineLine(plan = null, id = "airhorn") {
  const packed = plan?.ok ? plan : packetizePad(id);
  if (!packed.ok) return "";
  return (
    "BOARD lane=MACHINE id=" +
    packed.id +
    " vin=" +
    packed.totalVin +
    " commit=" +
    shortHex(packed.sha256, 8) +
    " key=" +
    (packed.zeroOpenKey || "—") +
    " snark=" +
    clip(packed.snarkShort || "", 48)
  );
}

function isTxHash(h) {
  return /^0x[0-9a-fA-F]{64}$/.test(String(h || ""));
}

function basescanTx(tx) {
  return (MAINFRAME_ANCHORS.basescanTx || "https://basescan.org/tx/") + tx;
}

function classProofAnchors() {
  return (MAINFRAME_ANCHORS.known || [])
    .filter((a) => isTxHash(a.tx))
    .map((a) => ({
      location: String(a.tx).toLowerCase(),
      basescan: basescanTx(a.tx),
      kind: "CLASS_PROOF",
      label: a.label || "formula class proof",
      note: "Class proof only — NOT pad body. Do not treat as new pad input.",
    }));
}

/** Real sealed pad locs only (written after /vitafeed confirm|override). */
export function loadPadSeals() {
  return (
    safeReadJson(SEAL_PATH) || {
      id: "soundboard-seals-v1",
      filingLabel: SOUNDBOARD_LABEL,
      neverInventHashes: true,
      byId: {},
    }
  );
}

export function recordPadSeal({
  id,
  locations = [],
  contentCommit = null,
  vinId = null,
} = {}) {
  const locs = (locations || []).map((t) => String(t || "").toLowerCase()).filter(isTxHash);
  if (!locs.length) {
    return {
      ok: false,
      reason: "no real tx hashes — VITAFEED_PAID may be OFF; never invent Basescan links",
    };
  }
  ensureDirs();
  const root = loadPadSeals();
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
  writeFileSync(SEAL_PATH, JSON.stringify(root, null, 2) + "\n");
  appendLearn({ kind: "pad-seal", id: key, locs: merged.length });
  return { ok: true, entry: root.byId[key] };
}

export function sealedLocsForPad(id) {
  const row = loadPadSeals().byId?.[id];
  if (!row?.locations?.length) return [];
  return row.locations.filter(isTxHash).map((tx, i) => ({
    index: i + 1,
    location: tx,
    basescan: basescanTx(tx),
    contentCommit: row.contentCommit || null,
  }));
}

/**
 * Inject proof click-through — sealed body only.
 * Pending = no href (honest: no Basescan tx yet).
 * Class-proof never returned as inject proof.
 */
export function resolvePadInjectClickThrough(id = "airhorn") {
  const first = sealedLocsForPad(id)[0];
  if (first) {
    return {
      ok: true,
      proven: true,
      kind: "sealed-body",
      label: "Basescan Input Data · inject proof",
      location: first.location,
      href: first.basescan,
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
      "Nothing to click — pad is availability until inject. " +
      "/vitafeed enqueue pad " +
      id +
      " then confirm|override with VITAFEED_PAID=yes. " +
      "CLASS_PROOF anchors look the same forever and are NOT this pad body.",
  };
}

/**
 * Loc proof for a pad. Distinguishes:
 *   LOCAL_OK     — availability reconstruct (pre-seal)
 *   MATCH        — sealed Input Data UTF-8 matches VIN contentCommit
 *   CLASS_PROOF  — formula anchors (same forever — not new pad data)
 * Never invents hashes. Never links class-proof as pad body.
 */
export async function buildPadLocProof(opts = {}) {
  const packed = opts.packed?.ok ? opts.packed : packetizePad(opts.id || "airhorn");
  if (!packed.ok) return packed;

  const sealed = [];
  const fromLedger = sealedLocsForPad(packed.id);
  for (const row of [...(opts.sealedLocs || []), ...fromLedger]) {
    const tx = String(row.location || row.tx || "").toLowerCase();
    if (!isTxHash(tx)) continue;
    if (sealed.some((s) => s.location === tx)) continue;
    sealed.push({
      groupN: row.groupN ?? row.n ?? null,
      index: row.index ?? null,
      location: tx,
      utf8: row.utf8 || null,
      basescan: basescanTx(tx),
      kind: "SEALED_BODY",
    });
  }

  const pull = typeof opts.pullUtf8 === "function" ? opts.pullUtf8 : null;
  const rows = [];
  let matched = 0;
  let pending = 0;

  for (const g of packed.groups || [{ lineCommits: packed.lineCommits, filingPath: packed.filingPath, vinId: packed.vinId, n: 1, name: packed.fileName, contentCommit: packed.contentCommit }]) {
    for (const lc of g.lineCommits || []) {
      const bind =
        sealed.find(
          (s) =>
            (s.groupN == null || s.groupN === g.n) &&
            (s.index == null || s.index === lc.index),
        ) || null;
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
      let kind = "AVAILABILITY";
      if (pulledUtf8 != null) {
        pulledCommit = sha256Hex(pulledUtf8);
        const lineHit = pulledCommit === lc.contentCommit;
        const containsHit =
          typeof pulledUtf8 === "string" &&
          (pulledUtf8.includes(lc.bodyPreview) ||
            pulledUtf8.includes(g.name || packed.fileName) ||
            sha256Hex(pulledUtf8.trim()) === (g.contentCommit || packed.contentCommit));
        match = lineHit || containsHit ? "MATCH" : "MISMATCH";
        kind = match === "MATCH" ? "SEALED_BODY" : "MISMATCH";
        if (match === "MATCH") {
          matched += 1;
          highlight = true;
        }
      } else {
        match = "LOCAL_OK";
        pending += 1;
        kind = "AVAILABILITY";
      }
      rows.push({
        groupN: g.n || 1,
        index: lc.index,
        filingPath: g.filingPath || packed.filingPath,
        vinId: g.vinId || packed.vinId,
        lineHash: lc.hash,
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
            ? "Basescan → Input Data → View as UTF-8 (pad body MATCH)"
            : "sealed loc present but UTF-8 did not MATCH pad commit"
          : "await inject seal — no invented loc · class-proof ≠ this pad",
      });
    }
  }

  const classProof = classProofAnchors().slice(0, 3).map((a) => ({
    ...a,
    match: "CLASS_PROOF",
    highlight: false,
    // Clickable for class inspection, but NEVER presented as inject proof
    clickThrough: true,
    injectProof: false,
    idmChat: "Class proof hitch example — same forever; NOT pad body / no new inputs",
  }));

  const inject = resolvePadInjectClickThrough(packed.id);

  return {
    ok: true,
    id: packed.id,
    title: packed.title,
    filingLabel: SOUNDBOARD_LABEL,
    formula: FORMULA_ID,
    neverInventHashes: true,
    zeroOpenKey: packed.zeroOpenKey,
    sha256: packed.sha256,
    contentCommit: packed.contentCommit,
    totalVin: packed.totalVin,
    sealedCount: sealed.length,
    matched,
    pending,
    mismatched: rows.filter((r) => r.match === "MISMATCH").length,
    rows,
    classProof,
    inject,
    clickThrough: rows.filter((r) => r.clickThrough),
    highlighted: rows.filter((r) => r.highlight),
    player: packed.player,
    daisyChain: [
      "filing: " + packed.filingPath,
      "catalog: vita/memory/soundboard-catalog.json#" + packed.id,
      "zeroOpenKey: " + packed.zeroOpenKey,
      "VIN contentCommit → Basescan Input Data UTF-8 MATCH",
      inject.proven
        ? "INJECT PROOF: " + inject.location
        : "NO sealed Basescan tx yet — enqueue + VITAFEED_PAID confirm|override",
    ],
    note: inject.proven
      ? "Sealed inject proof available — click Basescan href for Input Data"
      : inject.note,
  };
}

export function buildPadLocProofLocal(id = "airhorn") {
  const packed = packetizePad(id);
  if (!packed.ok) return packed;
  const rows = [];
  for (const g of packed.groups || []) {
    for (const lc of g.lineCommits || []) {
      rows.push({
        groupN: g.n,
        index: lc.index,
        filingPath: g.filingPath || packed.filingPath,
        dataFieldCommit: lc.contentCommit,
        bodyPreview: lc.bodyPreview,
        location: null,
        basescan: null,
        match: "LOCAL_OK",
        kind: "AVAILABILITY",
        highlight: true,
        clickThrough: false,
        idmChat: "seal then Basescan → Input Data → UTF-8 MATCH",
      });
    }
  }
  return {
    ok: true,
    id: packed.id,
    title: packed.title,
    local: true,
    neverInventHashes: true,
    zeroOpenKey: packed.zeroOpenKey,
    sha256: packed.sha256,
    totalVin: packed.totalVin,
    groupCount: packed.groupCount,
    matched: rows.length,
    pending: rows.length,
    rows,
    classProof: classProofAnchors().slice(0, 2),
    highlighted: rows,
    daisyChain: [
      "filing → WAV sha → VIN dataFieldCommit (local)",
      "after seal: bind real 0x locs · pull Input Data · highlight MATCH",
      "CLASS_PROOF anchors stay identical — they are not new pad inputs",
    ],
    player: packed.player,
  };
}

export function loadPad(id = "airhorn") {
  const packed = packetizePad(id);
  if (!packed.ok) return packed;
  const locProof = buildPadLocProofLocal(id);
  return {
    ...packed,
    contentCommit8: shortHex(packed.sha256, 8),
    locProof,
    locations: [],
    onChain: {
      proven: false,
      note: "availability until confirm|override seals pad VIN — class-proof ≠ body",
    },
  };
}

export function formatSoundboardCard(id = null) {
  const pads = listCatalogPads();
  const ids = Object.keys(pads);
  if (id) {
    const pad = loadPad(id);
    if (!pad.ok) return SOUNDBOARD_MAGIC + " MISS\n" + (pad.reason || "missing");
    const lines = [
      SOUNDBOARD_MAGIC + "v1|id=" + pad.id + "|vin=" + pad.totalVin + "§",
      "PAD · " + pad.title + (pad.blurb ? " — " + pad.blurb : ""),
      pad.recipe ? "recipe: " + pad.recipe : "upload",
      "bytes=" + pad.rawBytes + "  ·  " + (pad.durationSec || "?") + "s  ·  wav",
      "sha256=" + pad.sha256,
      "zeroOpenKey=" + pad.zeroOpenKey + "  ·  privateKey=NO",
      "vin packets=" + pad.totalVin + "  ·  commit=" + pad.contentCommit8,
      "player=" + pad.player,
      "LOC: LOCAL_OK " + (pad.locProof?.matched || 0) + " commits · MATCH after inject",
      "CLASS_PROOF anchors ≠ pad body (same forever until YOU seal new inputs)",
      "",
      "play:     /vitafeed pad " + pad.id,
      "enqueue:  /vitafeed enqueue pad " + pad.id,
      "dual:     /vitafeed dual pad " + pad.id,
      "locs:     /vita/soundboard/locs?id=" + pad.id,
      "inspect:  /vita/soundboard/loc?id=" + pad.id + "&i=1",
      "board:    /vita/soundboard",
    ];
    return lines.join("\n");
  }
  const lines = [
    SOUNDBOARD_MAGIC + "v1|board|n=" + ids.length + "§",
    "DJ SOUNDBOARD · " + ids.length + " pads",
    "procedural WAV · §VITAFILE§ VIN · zero-snark open key (name+contentCommit)",
    "player=/vita/soundboard  ·  locs=/vita/soundboard/locs?id=<id>",
    "Telegram pad grid · inject → reader MATCH · never invent hashes",
    "CLASS_PROOF ≠ pad body — new Inputs only after confirm|override",
    "",
  ];
  for (const pid of ids) {
    const p = pads[pid];
    lines.push(
      pid.padEnd(10) +
        "  " +
        (p.title || pid) +
        "  " +
        (p.bytes || "?") +
        "B  key=" +
        shortHex(p.contentCommit || p.sha256, 8),
    );
  }
  lines.push("");
  lines.push("tap:      /vitafeed board");
  lines.push("play:     /vitafeed pad <id>");
  lines.push("prompt:   /vitafeed prompt saw rise 220→880 0.9s");
  lines.push("enqueue:  /vitafeed enqueue pad <id>");
  lines.push("upload:   reply audio + /vitafeed board add");
  lines.push("dir:      /vitafeed dir BOARD");
  return lines.join("\n");
}

export function playPad(selector = "airhorn") {
  const id = resolvePadId(selector) || "airhorn";
  const packed = packetizePad(id);
  if (!packed.ok) return { ok: false, reason: packed.reason || "pad missing" };
  const parts = [];
  for (const g of packed.groups || [{ body: packed.body }]) {
    const parsed = parseVitaFileBody(g.body);
    if (!parsed.ok) return { ok: false, reason: parsed.reason };
    parts.push(parsed.data);
  }
  const data = Buffer.concat(parts);
  if (sha256HexBuf(data) !== packed.sha256) {
    return { ok: false, reason: "play reconstruct sha mismatch" };
  }
  const locLocal = buildPadLocProofLocal(id);
  const dataUrl = "data:" + (packed.mime || "audio/wav") + ";base64," + data.toString("base64");
  const reply = [
    SOUNDBOARD_MAGIC + " PLAY " + packed.title,
    "id=" + packed.id + "  bytes=" + packed.rawBytes + "  groups=" + packed.groupCount + "  vin=" + packed.totalVin,
    "zeroOpenKey=" + packed.zeroOpenKey,
    "sha=" + shortHex(packed.sha256, 12),
    locLocal.ok
      ? "loc LOCAL_OK " + locLocal.matched + " · seal for MATCH (class-proof ≠ body)"
      : "",
    "player=" + packed.player,
  ]
    .filter(Boolean)
    .join("\n");
  return {
    ok: true,
    soundboard: true,
    id: packed.id,
    proven: false,
    play: {
      name: packed.fileName,
      mime: packed.mime || "audio/wav",
      playKind: "audio",
      rawBytes: packed.rawBytes,
      sha256: packed.sha256,
      dataUrl,
      durationSec: packed.durationSec,
      waveform: packed.waveform,
    },
    playProof: {
      complete: true,
      play: { name: packed.fileName, mime: packed.mime || "audio/wav" },
      locations: [],
      note: "availability playback — sealed MATCH pending inject",
    },
    packed,
    locProof: locLocal,
    playerPath: packed.player,
    playerHref: packed.playerHref,
    zeroOpenKey: packed.zeroOpenKey,
    reply,
  };
}

/**
 * Prompted music bite → catalog pad → ready for inject.
 */
export function createPromptPad(prompt, { id = null } = {}) {
  const syn = synthesizePadWav(prompt);
  if (!syn.ok) return syn;
  const padId =
    resolvePadId(id) ||
    String(id || ("p" + shortHex(syn.sha256, 6)))
      .toLowerCase()
      .replace(/[^\w]+/g, "")
      .slice(0, 24) ||
    "prompt";
  ensureDirs();
  const fileName = padId + ".wav";
  const path = join(PAD_DIR, fileName);
  writeFileSync(path, syn.bytes);
  const peaks = waveformPeaks(syn.bytes, 48);
  const unlock = openSourceUnlockKeySync({
    name: "BOARD\\" + fileName,
    contentCommit: syn.sha256,
  });
  const root = loadCatalogRoot();
  root.pads = root.pads || {};
  root.pads[padId] = {
    id: padId,
    aliases: [],
    title: "Prompt · " + clip(prompt, 40),
    blurb: "Prompted music bite",
    color: "#4cc9f0",
    recipe: syn.recipe?.prompt || String(prompt),
    file: "vita/memory/soundboard/" + fileName,
    fileName,
    mime: "audio/wav",
    bytes: syn.bytes.length,
    sha256: syn.sha256,
    durationSec: Number(syn.durationSec.toFixed(4)),
    sampleRate: SAMPLE_RATE,
    channels: 1,
    waveform: peaks,
    builtIn: false,
    prompted: true,
    zeroOpenKey: unlock.key,
    contentCommit: syn.sha256,
    player: SOUNDBOARD_PLAYER_PATH + "?pad=" + padId,
    note: "Prompted bite sealed into catalog — enqueue to inject as NEW chain inputs",
  };
  saveCatalog(root);
  appendLearn({ kind: "prompt-pad", id: padId, prompt: String(prompt), sha256: syn.sha256 });
  writeStrand("prompt pad " + padId);
  return {
    ok: true,
    id: padId,
    meta: root.pads[padId],
    packed: packetizePad(padId),
    zeroOpenKey: unlock.key,
    note: "New pad bytes on disk — inject to create NEW Base Input Data (not class-proof)",
  };
}

/**
 * Ingest uploaded audio bytes into the board catalog.
 */
export function addUploadedPad({
  name = "upload.wav",
  bytes,
  mime = "audio/wav",
  aliases = [],
} = {}) {
  let buf;
  if (Buffer.isBuffer(bytes)) buf = bytes;
  else if (bytes instanceof Uint8Array) buf = Buffer.from(bytes);
  else if (typeof bytes === "string") buf = Buffer.from(bytes, "base64");
  else return { ok: false, reason: "empty upload bytes" };
  if (!buf.length) return { ok: false, reason: "empty upload" };

  // If not WAV, still store as-is under guessed extension (reader plays by mime).
  const safe =
    String(name || "upload.wav")
      .replace(/[^\w.\- ]+/g, "_")
      .slice(0, 80) || "upload.wav";
  const padId = ("u" + shortHex(sha256HexBuf(buf), 8)).toLowerCase();
  const ext = safe.includes(".") ? safe.slice(safe.lastIndexOf(".")) : ".wav";
  const fileName = padId + ext;
  ensureDirs();
  writeFileSync(join(PAD_DIR, fileName), buf);
  const sha = sha256HexBuf(buf);
  const unlock = openSourceUnlockKeySync({
    name: "BOARD\\" + fileName,
    contentCommit: sha,
  });
  const root = loadCatalogRoot();
  root.pads = root.pads || {};
  root.pads[padId] = {
    id: padId,
    aliases: aliases || [],
    title: safe.replace(/\.[^.]+$/, "") || padId,
    blurb: "Uploaded soundbite",
    color: "#f72585",
    recipe: null,
    file: "vita/memory/soundboard/" + fileName,
    fileName,
    mime: mime || "audio/wav",
    bytes: buf.length,
    sha256: sha,
    durationSec: null,
    waveform: mime?.includes("wav") ? waveformPeaks(buf, 48) : [],
    builtIn: false,
    uploaded: true,
    zeroOpenKey: unlock.key,
    contentCommit: sha,
    player: SOUNDBOARD_PLAYER_PATH + "?pad=" + padId,
  };
  saveCatalog(root);

  const ledger = safeReadJson(UPLOAD_LEDGER) || { id: "soundboard-uploads-v1", items: [] };
  ledger.items = ledger.items || [];
  ledger.items.push({
    at: new Date().toISOString(),
    id: padId,
    name: safe,
    sha256: sha,
    bytes: buf.length,
    zeroOpenKey: unlock.key,
  });
  writeFileSync(UPLOAD_LEDGER, JSON.stringify(ledger, null, 2) + "\n");
  appendLearn({ kind: "upload-pad", id: padId, name: safe, sha256: sha });
  writeStrand("upload pad " + padId);

  // Prefer WAV for VIN path; non-wav still packetizes as VITAFILE
  const packed = packetizePad(padId);
  return {
    ok: true,
    id: padId,
    meta: root.pads[padId],
    packed: packed.ok ? packed : null,
    zeroOpenKey: unlock.key,
    note: "Upload filed — /vitafeed enqueue pad " + padId + " to inject NEW chain inputs",
  };
}

export function enqueuePad({ enqueueFn, id = "airhorn", source = "soundboard" } = {}) {
  if (typeof enqueueFn !== "function") {
    return { ok: false, reason: "enqueueFn required" };
  }
  const packed = packetizePad(id);
  if (!packed.ok) return packed;
  const added = [];
  for (const g of packed.groups || []) {
    const item = enqueueFn({
      body: g.body,
      name: g.name || packed.fileName,
      mime: packed.mime,
      source,
      kind: "soundboard",
      meta: {
        soundboard: true,
        padId: packed.id,
        groupN: g.n,
        zeroOpenKey: packed.zeroOpenKey,
        contentCommit: g.contentCommit,
        padContentCommit: packed.contentCommit,
        filingLabel: SOUNDBOARD_LABEL,
      },
    });
    added.push(item?.item?.id || item?.id || g.n);
  }
  appendLearn({
    kind: "enqueue-pad",
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
    note: "Queued " + added.length + " group(s) for confirm|override — seal creates NEW Input Data",
  };
}

export function enqueueBoardLibrary({ enqueueFn, source = "soundboard-library" } = {}) {
  const ids = listCatalogPadIds().filter((id) => PAD_RECIPES[id]);
  const added = [];
  for (const id of ids) {
    const r = enqueuePad({ enqueueFn, id, source });
    if (r.ok) added.push(id);
  }
  return { ok: true, added: added.length, ids: added };
}

export function soundboardEntriesFor() {
  const pads = listCatalogPads();
  const out = [];
  let n = 1;
  for (const id of Object.keys(pads)) {
    const pad = loadPad(id);
    if (!pad.ok) continue;
    out.push({
      n: n++,
      name: pad.fileName,
      kind: "audio",
      bytes: pad.rawBytes,
      unlockName: pad.fileName,
      english:
        pad.title +
        " — " +
        (pad.blurb || "pad") +
        " · soundboard · " +
        pad.rawBytes +
        " B · " +
        pad.totalVin +
        " VIN · zeroOpenKey " +
        pad.zeroOpenKey,
      machine:
        "BOARD id=" +
        pad.id +
        " vin=" +
        pad.totalVin +
        " mime=audio/wav commit=" +
        pad.contentCommit8 +
        " key=" +
        pad.zeroOpenKey,
      locations: pad.locations || [],
      trueName: pad.id,
      mime: "audio/wav",
      playKind: "audio",
      dirId: pad.id,
      contentCommit: pad.sha256,
    });
  }
  out.push({
    n: n++,
    name: "soundboard-catalog.json",
    kind: "catalog",
    bytes: (() => {
      try {
        return statSync(CATALOG_PATH).size;
      } catch {
        return 0;
      }
    })(),
    unlockName: "soundboard-catalog.json",
    english:
      "DJ soundboard catalog · procedural pads + prompted/uploads · proven after seal MATCH",
    machine: "CATALOG pads=" + Object.keys(pads).join(","),
    locations: MAINFRAME_ANCHORS.known.map((a) => a.tx),
    trueName: "soundboard-catalog",
    mime: "application/json",
    playKind: "text",
    dirId: "airhorn",
  });
  return out;
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

/** Telegram inline DJ pad grid — every pad is a button. */
export function buildSoundboardKeyboard({ highlight = null } = {}) {
  const pads = listCatalogPads();
  const ids = Object.keys(PAD_RECIPES);
  const rows = [];
  for (let i = 0; i < ids.length; i += 4) {
    rows.push(
      ids.slice(i, i + 4).map((id) => {
        const p = pads[id] || PAD_RECIPES[id];
        const mark = highlight === id ? "● " : "";
        return btn(mark + (p.title || id), "/vitafeed pad " + id);
      }),
    );
  }
  const href = vitaPlayerHref(SOUNDBOARD_PLAYER_PATH);
  rows.push([
    webAppBtn("▶ Board popup", href),
    urlBtn("↗ Open board", href),
  ]);
  rows.push([
    btn("🔊 Board", "/vitafeed board"),
    btn("📦 Enqueue pads", "/vitafeed enqueue board"),
    btn("🔤 Dual airhorn", "/vitafeed dual pad airhorn"),
  ]);
  rows.push([
    btn("📂 Dir BOARD", "/vitafeed dir BOARD"),
    btn("🎵 MUSIC", "/vitafeed music"),
    btn("🏠 Menu", "/vitafeed"),
  ]);
  return { inline_keyboard: rows };
}

export function publicSoundboardState(id = null) {
  ensureBuiltInPads();
  if (id) {
    const pad = loadPad(id);
    if (!pad.ok) return { ok: false, reason: pad.reason };
    const { body, lines, ...pub } = pad;
    return {
      ok: true,
      ...pub,
      lines: undefined,
      bodyBytes: body ? Buffer.byteLength(body, "utf8") : 0,
      lineCommits: pad.lineCommits,
      classProofNote:
        "Formula anchors are CLASS_PROOF only — following them shows the same hitch class, not new pad Inputs.",
    };
  }
  const pads = listCatalogPads();
  return {
    ok: true,
    id: SOUNDBOARD_ID,
    filingLabel: SOUNDBOARD_LABEL,
    formula: FORMULA_ID,
    neverInventHashes: true,
    zeroSnarkOpenKey: true,
    player: SOUNDBOARD_PLAYER_PATH,
    padCount: Object.keys(pads).length,
    pads: Object.values(pads).map((p) => ({
      id: p.id,
      title: p.title,
      blurb: p.blurb,
      color: p.color,
      recipe: p.recipe,
      bytes: p.bytes,
      sha256: p.sha256,
      durationSec: p.durationSec,
      waveform: p.waveform,
      zeroOpenKey: p.zeroOpenKey,
      contentCommit: p.contentCommit,
      player: p.player,
      builtIn: p.builtIn,
      prompted: p.prompted,
      uploaded: p.uploaded,
    })),
    classProof: classProofAnchors().slice(0, 3),
    note:
      "Tap a pad · prompt a bite · upload audio. Inject seals NEW Input Data. " +
      "Class-proof locs stay identical by design — they are not pad body.",
  };
}

export function publicSoundboardPlay(id = "airhorn") {
  const opened = playPad(id);
  if (!opened.ok) return opened;
  return {
    ok: true,
    id: opened.id,
    title: opened.packed?.title,
    mime: "audio/wav",
    rawBytes: opened.play.rawBytes,
    sha256: opened.play.sha256,
    dataUrl: opened.play.dataUrl,
    durationSec: opened.play.durationSec,
    waveform: opened.play.waveform,
    zeroOpenKey: opened.zeroOpenKey,
    player: opened.playerPath,
    locProof: opened.locProof,
    proven: false,
    note: "availability WAV — MATCH after sealed inject",
  };
}

export async function publicSoundboardLocs(id = "airhorn") {
  return buildPadLocProof({ id });
}

export function publicSoundboardLoc(id = "airhorn", index = 1, group = 1) {
  const packed = packetizePad(id);
  if (!packed.ok) return packed;
  const gN = Math.max(1, Number(group) || 1);
  const i = Math.max(1, Number(index) || 1);
  const g = (packed.groups || []).find((x) => x.n === gN) || packed.groups?.[0];
  if (!g) return { ok: false, reason: "no group " + gN };
  const line = (g.lines || []).find((l) => l.index === i) || g.lines?.[0];
  if (!line) return { ok: false, reason: "no VIN line at index " + i };
  const lc = (g.lineCommits || []).find((c) => c.index === line.index);
  return {
    ok: true,
    id: packed.id,
    groupN: g.n,
    index: line.index,
    vinId: g.vinId,
    filingPath: g.filingPath || packed.filingPath,
    dataFieldCommit: lc?.contentCommit || sha256Hex(line.line),
    zeroOpenKey: packed.zeroOpenKey,
    utf8: line.line,
    utf8Bytes: Buffer.byteLength(line.line, "utf8"),
    bodyPreview: String(line.body || "").slice(0, 80),
    note:
      "Exact VIN UTF-8 that will be / was sealed. Compare to Basescan Input Data. " +
      "If you only see class-proof locs, no pad seal has happened yet — this is the real pad packet.",
  };
}

export function maybePadDualHumanBody(text) {
  const s = String(text || "").trim();
  if (!s) return s;
  if (s.includes("\n") || s.length >= 80) return s;
  const m = s.match(/^(?:pad\s+)?([a-z0-9_\-]+)$/i);
  if (m && resolvePadId(m[1])) return padDualHumanBody(null, resolvePadId(m[1]));
  if (/^board$/i.test(s)) return formatSoundboardCard();
  return s;
}

/** Soft check used by feed parse — keep tiny for hot path. */
export function isBoardEnqueueSelector(sel = "") {
  const s = String(sel || "").trim().toLowerCase();
  return (
    s === "board" ||
    s === "soundboard" ||
    s === "pads" ||
    s === "board library" ||
    /^pad\s+\w+/.test(s)
  );
}

export function resolveBoardEnqueueTarget(sel = "") {
  const s = String(sel || "").trim().toLowerCase();
  if (s === "board" || s === "soundboard" || s === "pads" || s === "board library") {
    return { kind: "library" };
  }
  const m = s.match(/^pad\s+(\w+)/);
  if (m) {
    const id = resolvePadId(m[1]);
    return id ? { kind: "pad", id } : { kind: "miss", reason: "unknown pad" };
  }
  const id = resolvePadId(s);
  if (id && (PAD_RECIPES[id] || listCatalogPads()[id])) {
    return { kind: "pad", id };
  }
  return null;
}

// Eager ensure on import so catalog + WAVs exist for HTTP/Telegram.
try {
  ensureBuiltInPads();
} catch {
  /* cold start without write perms — regenerate on first call */
}
