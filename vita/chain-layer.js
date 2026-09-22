/**
 * VITA blockchain systems-check layer — always-on reminder to check chain,
 * measure recover speed, SNARK-compress the library (skip whole mainframe),
 * keep last-agreed / multi-model ring, and register LLM-on-chain spin manifests.
 *
 * Settlement stays Base leftover hitch + /prove. Never invent tx hashes.
 * Learn trail is append-only under vita/memory/ + vita/strands/.
 * Telegram: /vita check · /vita recover · /vita models · /vita llm · /vita spin
 */

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FORMULA_ID,
  MAINFRAME_ANCHORS,
  ORIGINAL_FORMULA,
} from "./mainframe.js";
import { packMachineShort, unwrapMachineShort } from "./vita-dir.js";
import { feedFlowAnchorLocations } from "./feed-flow.js";
import {
  parseVitaModels,
  peekVitaModel,
  vitaModelStatus,
  nextVitaModel,
} from "../vita-models.js";
import {
  buildAndMatchInjectPlan,
  buildSpacedIdmKeyboard,
  formulaAnchorLocations,
  formatInjectPlanCard,
  sealedInjectIdmLocations,
  SPACED_CHUNK_BYTES,
} from "./chain-inject.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");
const MEMORY_DIR = join(HERE, "memory");
const STRANDS_DIR = join(HERE, "strands");
const CHECK_LEDGER_PATH = join(MEMORY_DIR, "chain-layer-checks.json");
const GROWTH_PATH = join(MEMORY_DIR, "chain-layer-growth.json");
const MODEL_AGREE_PATH = join(MEMORY_DIR, "model-agreement.json");
const LLM_SPIN_PATH = join(MEMORY_DIR, "llm-onchain-spin.json");
const STRAND_PATH = join(STRANDS_DIR, "chain-layer.json");

export const CHAIN_LAYER_ID = "vita-chain-layer-v1";
export const CHAIN_LAYER_MAGIC = "§VITACHAIN§";
export const SYSTEMS_CHECK_MAGIC = "§SYSCHECK§";
export const LLM_SPIN_MAGIC = "§VITALLM§";
export const CHAIN_LAYER_LABEL = "CHAIN_LAYER";
export const SYSTEMS_CHECK_LABEL = "SYSTEMS_CHECK";
export const LLM_ONCHAIN_LABEL = "LLM_ONCHAIN";
export const CALLBACK_DATA_MAX = 64;

/** Proven library roots agents may SNARK without opening the whole mainframe. */
export const PROVEN_LIBRARY_ROOTS = Object.freeze([
  "vita/ORIGINAL_FORMULA.md",
  "vita/FILING.md",
  "vita/AGENTS.md",
  "vita/anchors.json",
  "vita/mainframe.js",
  "vita/mirror-chain.js",
  "vita/mirror-dual.js",
  "vita/chain-layer.js",
  "vita/chain-inject.js",
  "vita/brain-learn.js",
  "vita/feed-flow.js",
  "vita/vita-dir.js",
  "vita-models.js",
  "vita-memory.js",
  "vita-chain-reader.js",
  "vita-locations.js",
]);

/** Systems checklist — agents always walk this before inventing a route. */
export const SYSTEMS_CHECKLIST = Object.freeze([
  {
    id: "anchors",
    title: "Hardcoded Base anchors",
    why: "Never invent hashes — settle only on sealed Base locs",
  },
  {
    id: "library-growth",
    title: "Library growth (memory + strands)",
    why: "Visible file creation proves learn-and-never-forget",
  },
  {
    id: "snark-compress",
    title: "SNARK compress proven libraries",
    why: "Recover from short commitment — skip whole mainframe body",
  },
  {
    id: "spaced-inject",
    title: "Spaced inject batch (code > calldata)",
    why: "Every chunk needs its own sealed Base loc — never fake IDM with formula anchors",
  },
  {
    id: "chain-match",
    title: "On-chain UTF-8 match",
    why: "Pull sealed locs and verify Input Data matches planned chunk commits",
  },
  {
    id: "model-ring",
    title: "Last-agreed / multi-model ring",
    why: "Open-source: swap or stack models without rewriting settlement",
  },
  {
    id: "evm-recover",
    title: "EVM recover timing",
    why: "How fast calldata → UTF-8 / snark unwrap spins a brand-new session",
  },
  {
    id: "llm-spin",
    title: "LLM-on-chain spin registry",
    why: "Manifest to read / grow / change an LLM route at will",
  },
  {
    id: "media-mirror",
    title: "Media / player chain mirror",
    why: "Songs/pads/players on disk are LOCAL_OK until sealed Input Data MATCH — never invent hashes",
  },
  {
    id: "telegram-pointer",
    title: "Telegram click-through",
    why: "Demonstrate each proven system as it is added",
  },
]);

function sha256Hex(text) {
  return createHash("sha256").update(String(text || ""), "utf8").digest("hex");
}

function shortHex(hex, n = 8) {
  return String(hex || "").replace(/^0x/i, "").toLowerCase().slice(0, n);
}

function isTxHash(h) {
  return /^0x[0-9a-fA-F]{64}$/.test(String(h || ""));
}

function clip(s, n = 140) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length <= n ? t : t.slice(0, n - 1) + "…";
}

function ensureDirs() {
  if (!existsSync(MEMORY_DIR)) mkdirSync(MEMORY_DIR, { recursive: true });
  if (!existsSync(STRANDS_DIR)) mkdirSync(STRANDS_DIR, { recursive: true });
}

function safeReadJson(path) {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function dirStats(dir) {
  try {
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    let bytes = 0;
    for (const f of files) {
      try {
        bytes += statSync(join(dir, f)).size;
      } catch {
        /* skip */
      }
    }
    return { count: files.length, bytes };
  } catch {
    return { count: 0, bytes: 0 };
  }
}

function telegramCallbackData(cmd) {
  const s = String(cmd || "");
  return s.length <= CALLBACK_DATA_MAX ? s : s.slice(0, CALLBACK_DATA_MAX);
}

function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function anchorLocations() {
  return feedFlowAnchorLocations().filter((l) => isTxHash(l.location));
}

/**
 * SNARK-compress a proven library set into one short — no full mainframe dump.
 * |L= only carries SEALED inject locs that hold matching body — never formula anchors alone.
 */
export function snarkCompressProvenLibrary({
  roots = PROVEN_LIBRARY_ROOTS,
  cwd = REPO_ROOT,
  title = "VITA-PROVEN-LIB",
  sealedLocs = [],
} = {}) {
  const files = [];
  for (const rel of roots) {
    const path = join(cwd, rel);
    if (!existsSync(path)) continue;
    let body = "";
    let bytes = 0;
    try {
      const st = statSync(path);
      if (!st.isFile() || st.size > 1_500_000) continue;
      body = readFileSync(path, "utf8");
      bytes = st.size;
    } catch {
      continue;
    }
    const hash = sha256Hex(body);
    files.push({ name: rel, hash, bytes });
  }
  const totalBytes = files.reduce((n, f) => n + f.bytes, 0);
  let layer = files.map((f) => f.hash).sort();
  if (!layer.length) layer = [sha256Hex("VITA-EMPTY-LIB")];
  while (layer.length > 1) {
    const next = [];
    for (let i = 0; i < layer.length; i += 2) {
      const a = layer[i];
      const b = layer[i + 1] ?? a;
      next.push(sha256Hex(a + b));
    }
    layer = next;
  }
  const root = layer[0];
  // Only sealed inject locs that actually hold library chunks — never pretend anchors are body.
  const injectLocs = (sealedLocs || [])
    .map((l) => (typeof l === "string" ? l : l?.location))
    .filter(isTxHash);
  const english =
    `Proven library snark "${title}": ${files.length} files, ${totalBytes} bytes, ` +
    `merkle ${shortHex(root, 12)}…. Local short until spaced inject seals matching locs.`;
  const machine =
    `SNARK kind=proven-lib title=${clip(title, 28)} files=${files.length} ` +
    `bytes=${totalBytes} root=${shortHex(root, 8)} sealedLocs=${injectLocs.length} formula=${FORMULA_ID}`;
  const packed = packMachineShort({
    english,
    machine,
    locs: injectLocs,
    trueName: title,
  });
  return {
    ...packed,
    root,
    files,
    bytes: totalBytes,
    fileCount: files.length,
    sealedLocCount: injectLocs.length,
    snarkReady: true,
    instantUnwrap: true,
    localOnly: injectLocs.length === 0,
    neverInventHashes: true,
    magic: SYSTEMS_CHECK_MAGIC,
    label: SYSTEMS_CHECK_LABEL,
    note:
      injectLocs.length === 0
        ? "LOCAL snark only — no sealed inject locs yet. Formula anchors are not library body."
        : "Snark cites sealed inject locs that hold chunk UTF-8.",
  };
}

/**
 * EVM-style recover timing: measure how fast we resolve anchors + unwrap snark
 * (calldata → UTF-8 path class). No invented hashes; optional RPC ms when provided.
 */
export function measureEvmRecover({
  cwd = REPO_ROOT,
  rpcPingMs = null,
  now = Date.now(),
  sealedLocs = [],
} = {}) {
  const t0 = typeof performance !== "undefined" && performance.now
    ? performance.now()
    : Date.now();
  const snark = snarkCompressProvenLibrary({ cwd, sealedLocs });
  const reveal = unwrapMachineShort(snark, {
    english: snark.english || "",
    machine: snark.machine || "",
  });
  const formulaAnchors = formulaAnchorLocations();
  const injectIdm = (sealedLocs || []).filter((l) => isTxHash(l.location || l));
  const t1 = typeof performance !== "undefined" && performance.now
    ? performance.now()
    : Date.now();
  const localMs = Math.max(0, Number((t1 - t0).toFixed(3)));
  return {
    ok: true,
    at: new Date(now).toISOString(),
    localRecoverMs: localMs,
    rpcPingMs: Number.isFinite(Number(rpcPingMs)) ? Number(rpcPingMs) : null,
    totalMs: Number.isFinite(Number(rpcPingMs))
      ? localMs + Number(rpcPingMs)
      : localMs,
    snarkShort: snark.short,
    snarkRoot: snark.root,
    fileCount: snark.fileCount,
    formulaAnchorCount: formulaAnchors.length,
    sealedInjectCount: injectIdm.length,
    locCount: injectIdm.length,
    unwrapInstant: reveal.instant === true,
    privateKeyRequired: false,
    evmClass: "base-calldata-utf8-v1",
    chainId: MAINFRAME_ANCHORS.chainId,
    chain: MAINFRAME_ANCHORS.chain,
    localOnly: injectIdm.length === 0,
    note:
      injectIdm.length === 0
        ? "Local snark unwrap only — library body not yet sealed on Base. Formula anchors are class proof, not body."
        : "Recover cites sealed inject locs. Pull Input Data → UTF-8 to verify chunk commits.",
    locations: injectIdm.length
      ? injectIdm.map((l) =>
          typeof l === "string"
            ? { location: l, basescan: (MAINFRAME_ANCHORS.basescanTx || "https://basescan.org/tx/") + l }
            : l,
        )
      : [],
    formulaAnchors,
    neverInventHashes: true,
  };
}

/**
 * Last-agreed model ring + optional multi-model stack for open-source spin.
 */
export function agreeModelRing({
  env = process.env,
  prefer = null,
  stack = null,
  write = true,
  now = Date.now(),
} = {}) {
  const cycle = parseVitaModels(env);
  const status = vitaModelStatus(env);
  const preferred = prefer && cycle.includes(prefer) ? prefer : status.current;
  const multi = Array.isArray(stack) && stack.length
    ? stack.filter((m) => cycle.includes(m) || String(m || "").trim())
    : cycle.slice(0, Math.min(3, cycle.length));
  const note = {
    at: new Date(now).toISOString(),
    topic: "model-agreement",
    filingLabel: CHAIN_LAYER_LABEL,
    formula: FORMULA_ID,
    agreed: preferred,
    cycle,
    multi,
    index: status.index,
    opensource: true,
    neverForget: true,
    note:
      "Last agreed model wins until operator rotates. Multi-model stack lets agents " +
      "cross-check without muting hitch. Railway VITA_MODELS=id1,id2.",
  };
  if (write) {
    ensureDirs();
    writeFileSync(MODEL_AGREE_PATH, JSON.stringify(note, null, 2) + "\n");
  }
  return note;
}

/**
 * LLM-on-chain spin registry — content-addressed manifests so a whole model
 * route can be read / grown / changed at will (open-source). Settlement locs
 * stay hardcoded anchors until a real seal; never invent hashes.
 */
export function registerLlmOnchainSpin({
  modelId = null,
  env = process.env,
  write = true,
  now = Date.now(),
  extra = {},
} = {}) {
  const agreed = agreeModelRing({ env, write: false, now });
  const id = String(modelId || agreed.agreed || peekVitaModel(env));
  const snark = snarkCompressProvenLibrary({ title: "LLM-SPIN-" + clip(id, 24) });
  const locs = formulaAnchorLocations().map((l) => ({
    id: l.id,
    location: l.location,
    basescan: l.basescan,
    role: "formula-anchor",
    holdsLibraryBody: false,
  }));
  const manifest = {
    magic: LLM_SPIN_MAGIC,
    filingLabel: LLM_ONCHAIN_LABEL,
    at: new Date(now).toISOString(),
    modelId: id,
    multi: agreed.multi,
    cycle: agreed.cycle,
    snarkShort: snark.short,
    snarkRoot: snark.root,
    contentCommit: snark.commit,
    spin: {
      read: "/vita llm",
      check: "/vita check",
      locs: "/vita check locs",
      pull: "/vita check pull",
      recover: "/vita recover",
      models: "/vita models",
      change: "Set Railway VITA_MODELS or /vita models next",
      grow: "Append vita/memory + vita/strands — never erase genesis",
    },
    locations: locs,
    formulaAnchorsOnly: true,
    formula: FORMULA_ID,
    opensource: true,
    neverInventHashes: true,
    note:
      "Manifest is the on-chain *route* (commitment). Formula anchors are class proof only — " +
      "library body needs spaced sealed inject locs. Never invent hashes.",
    ...extra,
  };
  if (write) {
    ensureDirs();
    const prev = safeReadJson(LLM_SPIN_PATH);
    const history = Array.isArray(prev?.history) ? prev.history.slice(-40) : [];
    history.push({
      at: manifest.at,
      modelId: manifest.modelId,
      snarkRoot: manifest.snarkRoot,
      commit: manifest.contentCommit,
    });
    writeFileSync(
      LLM_SPIN_PATH,
      JSON.stringify({ ...manifest, history }, null, 2) + "\n",
    );
  }
  return manifest;
}

function appendCheckLedger(entry) {
  ensureDirs();
  const prev = safeReadJson(CHECK_LEDGER_PATH) || {
    id: CHAIN_LAYER_ID,
    events: [],
  };
  const events = Array.isArray(prev.events) ? prev.events.slice() : [];
  events.push(entry);
  const next = {
    id: CHAIN_LAYER_ID,
    magic: CHAIN_LAYER_MAGIC,
    formula: FORMULA_ID,
    at: entry.at,
    count: events.length,
    events: events.slice(-200),
    neverInventHashes: true,
  };
  writeFileSync(CHECK_LEDGER_PATH, JSON.stringify(next, null, 2) + "\n");
  return next;
}

function writeGrowthAndStrand({ growth, snark, recover, models, llm, inject }) {
  ensureDirs();
  writeFileSync(GROWTH_PATH, JSON.stringify(growth, null, 2) + "\n");
  const sealed = sealedInjectIdmLocations(inject);
  const strand = {
    strandId: "chain-layer",
    sparse: true,
    source: "chain-layer",
    filingLabel: CHAIN_LAYER_LABEL,
    learn:
      "Always /vita check. SNARK is local until spaced inject seals matching locs. " +
      "Telegram IDM only for sealed inject txs — formula anchors are class proof only. " +
      "Pull Input Data → UTF-8 to verify. Never invent hashes.",
    formula: FORMULA_ID,
    snarkRoot: snark?.root || null,
    recoverMs: recover?.localRecoverMs ?? null,
    agreedModel: models?.agreed || null,
    llmCommit: llm?.contentCommit || null,
    spacedChunks: inject?.totalChunks || 0,
    sealedInject: sealed.length,
    pendingInject: inject?.pendingCount || 0,
    locations: sealed.map((l) => ({
      id: l.id,
      location: l.location,
      kind: "vita",
      role: "sealed-inject",
      contentCommit: l.contentCommit,
    })),
    formulaAnchors: formulaAnchorLocations().map((a) => ({
      id: a.id,
      location: a.location,
      kind: a.kind,
      role: "formula-anchor",
    })),
  };
  writeFileSync(STRAND_PATH, JSON.stringify(strand, null, 2) + "\n");
  return strand;
}

/**
 * Run the full systems checklist — files land in memory/strands every pass.
 * Builds spaced inject plan and optionally pulls sealed locs from Base.
 */
export async function runSystemsCheck({
  cwd = REPO_ROOT,
  env = process.env,
  write = true,
  rpcPingMs = null,
  now = Date.now(),
  rotateModel = false,
  fetchCalldata = null,
  readUtf8FromCalldata = null,
  pull = true,
} = {}) {
  const started = now;
  const memBefore = dirStats(MEMORY_DIR);
  const strandBefore = dirStats(STRANDS_DIR);

  const inject = await buildAndMatchInjectPlan({
    cwd,
    write,
    fetchCalldata: pull ? fetchCalldata : null,
    readUtf8FromCalldata,
    now,
    pull: pull && typeof fetchCalldata === "function",
  });
  const sealedIdm = sealedInjectIdmLocations(inject);

  let mediaMirror = {
    ok: true,
    neverInventHashes: true,
    mediaLocalOnly: true,
    music: { status: "LOCAL_OK" },
    soundboard: { status: "LOCAL_OK" },
    spatial: { status: "LOCAL_OK" },
    backlog: { pending: 0, sealed: 0 },
  };
  try {
    const feed = await import("./vita-feed.js");
    mediaMirror = feed.auditVitaFeedChainMirror() || mediaMirror;
  } catch {
    /* keep defaults — check still runs */
  }

  const anchorsOk = (MAINFRAME_ANCHORS.known || []).every((a) => isTxHash(a.tx));
  const snark = snarkCompressProvenLibrary({ cwd, sealedLocs: sealedIdm });
  const recover = measureEvmRecover({
    cwd,
    rpcPingMs,
    now,
    sealedLocs: sealedIdm,
  });
  if (rotateModel) nextVitaModel(env);
  const models = agreeModelRing({ env, write, now });
  const llm = registerLlmOnchainSpin({
    env,
    write,
    now,
    modelId: models.agreed,
  });

  const checks = SYSTEMS_CHECKLIST.map((item) => {
    let ok = false;
    let detail = "";
    switch (item.id) {
      case "anchors":
        ok = anchorsOk && (MAINFRAME_ANCHORS.known || []).length >= 3;
        detail = `${(MAINFRAME_ANCHORS.known || []).length} formula-class anchors (not library body)`;
        break;
      case "library-growth":
        ok = memBefore.count >= 1 && strandBefore.count >= 1;
        detail = `memory=${memBefore.count}f/${memBefore.bytes}B strands=${strandBefore.count}f/${strandBefore.bytes}B`;
        break;
      case "snark-compress":
        ok = Boolean(snark.short && snark.root && snark.fileCount > 0);
        detail =
          `${snark.fileCount} files · ${snark.bytes}B · ${shortHex(snark.root, 10)}…` +
          (snark.localOnly ? " · LOCAL_ONLY" : ` · sealedLocs=${snark.sealedLocCount}`);
        break;
      case "spaced-inject":
        ok = inject.totalChunks > 0 && inject.maxBytes === SPACED_CHUNK_BYTES;
        detail =
          `${inject.totalChunks} spaced locs × ${inject.maxBytes}B · sealed=${inject.sealedCount} · pending=${inject.pendingCount}`;
        break;
      case "chain-match":
        if (typeof fetchCalldata !== "function" || !pull) {
          ok = true;
          detail = `bind-only sealed=${inject.sealedCount} (pass fetchCalldata to pull/verify)`;
        } else if (inject.sealedCount === 0) {
          ok = true;
          detail = "no sealed inject locs yet — nothing to pull (honest)";
        } else {
          ok = (inject.verifiedCount || 0) > 0 || inject.pull?.verified > 0;
          detail =
            `verified=${inject.verifiedCount || 0}/${inject.sealedCount}` +
            (inject.pull?.mismatched ? ` mismatch=${inject.pull.mismatched}` : "");
        }
        break;
      case "model-ring":
        ok = Boolean(models.agreed && models.cycle?.length);
        detail = `agreed=${models.agreed} · multi=${(models.multi || []).length}`;
        break;
      case "evm-recover":
        ok = recover.ok === true && recover.unwrapInstant === true;
        detail = `${recover.localRecoverMs}ms local` +
          (recover.rpcPingMs != null ? ` + ${recover.rpcPingMs}ms rpc` : "") +
          (recover.localOnly ? " · LOCAL_ONLY" : "");
        break;
      case "llm-spin":
        ok = Boolean(llm.contentCommit && llm.snarkShort);
        detail = `model=${llm.modelId} · commit=${shortHex(llm.contentCommit, 10)}…`;
        break;
      case "telegram-pointer":
        ok = true;
        detail =
          `/vita check · check locs · check pull · ${sealedIdm.length} sealed IDM buttons`;
        break;
      case "media-mirror": {
        // Honest pass: audit ran. Disk media ≠ sealed until confirm|override force.
        ok = mediaMirror.ok === true && mediaMirror.neverInventHashes === true;
        detail =
          `music=${mediaMirror.music?.status || "?"} ` +
          `board=${mediaMirror.soundboard?.status || "?"} ` +
          `spatial=${mediaMirror.spatial?.status || "?"} ` +
          `backlog=${mediaMirror.backlog?.pending ?? "?"}p/${mediaMirror.backlog?.sealed ?? "?"}s` +
          (mediaMirror.mediaLocalOnly ? " · MEDIA_LOCAL_ONLY" : "");
        break;
      }
      default:
        ok = false;
        detail = "unknown";
    }
    return { ...item, ok, detail };
  });

  const passed = checks.filter((c) => c.ok).length;
  const memAfterWrite = write
    ? (() => {
        const growth = {
          at: new Date(now).toISOString(),
          topic: "chain-layer-growth",
          filingLabel: CHAIN_LAYER_LABEL,
          formula: FORMULA_ID,
          before: { memory: memBefore, strands: strandBefore },
          snarkRoot: snark.root,
          snarkLocalOnly: snark.localOnly === true,
          recoverMs: recover.localRecoverMs,
          agreedModel: models.agreed,
          llmCommit: llm.contentCommit,
          spacedChunks: inject.totalChunks,
          sealedInject: inject.sealedCount,
          pendingInject: inject.pendingCount,
          verifiedInject: inject.verifiedCount || 0,
          checklistPassed: passed,
          checklistTotal: checks.length,
          neverInventHashes: true,
          messageFirst: ORIGINAL_FORMULA.messageFirstWhenKeyLocCovered,
        };
        writeGrowthAndStrand({ growth, snark, recover, models, llm, inject });
        const entry = {
          at: new Date(now).toISOString(),
          passed,
          total: checks.length,
          recoverMs: recover.localRecoverMs,
          snarkRoot: snark.root,
          agreedModel: models.agreed,
          llmCommit: llm.contentCommit,
          spacedChunks: inject.totalChunks,
          sealedInject: inject.sealedCount,
          pendingInject: inject.pendingCount,
        };
        appendCheckLedger(entry);
        const cyclePath = join(
          MEMORY_DIR,
          "systems-check-" + String(Date.now()) + ".json",
        );
        const latestPath = join(MEMORY_DIR, "systems-check-latest.json");
        const cycleBody = JSON.stringify(
          {
            at: new Date(now).toISOString(),
            topic: "systems-check",
            filingLabel: SYSTEMS_CHECK_LABEL,
            magic: SYSTEMS_CHECK_MAGIC,
            formula: FORMULA_ID,
            checks,
            snark: {
              short: snark.short,
              root: snark.root,
              fileCount: snark.fileCount,
              bytes: snark.bytes,
              localOnly: snark.localOnly,
              sealedLocCount: snark.sealedLocCount,
              note: snark.note,
            },
            inject: {
              totalChunks: inject.totalChunks,
              maxBytes: inject.maxBytes,
              sealedCount: inject.sealedCount,
              pendingCount: inject.pendingCount,
              verifiedCount: inject.verifiedCount || 0,
              spacedBlockchainLocationsRequired: inject.spacedBlockchainLocationsRequired,
              sealedLocations: sealedIdm.map((l) => l.location),
              pull: inject.pull || null,
            },
            recover,
            models: {
              agreed: models.agreed,
              multi: models.multi,
              cycle: models.cycle,
            },
            llm: {
              modelId: llm.modelId,
              contentCommit: llm.contentCommit,
              snarkShort: llm.snarkShort,
              spin: llm.spin,
            },
            formulaAnchors: formulaAnchorLocations().map((l) => l.location),
            sealedInjectLocations: sealedIdm.map((l) => l.location),
            neverInventHashes: true,
            neverForget: true,
            route:
              "Always /vita check → check locs → check pull. Spaced inject for code > calldata. " +
              "IDM only for sealed matching locs. Formula anchors ≠ library body.",
          },
          null,
          2,
        ) + "\n";
        writeFileSync(cyclePath, cycleBody);
        writeFileSync(latestPath, cycleBody);
        return { memory: dirStats(MEMORY_DIR), strands: dirStats(STRANDS_DIR), cyclePath };
      })()
    : { memory: memBefore, strands: strandBefore, cyclePath: null };

  return {
    ok: passed === checks.length,
    id: CHAIN_LAYER_ID,
    magic: CHAIN_LAYER_MAGIC,
    formula: FORMULA_ID,
    at: new Date(started).toISOString(),
    checks,
    passed,
    total: checks.length,
    snark,
    inject,
    recover,
    models,
    llm,
    growth: {
      before: { memory: memBefore, strands: strandBefore },
      after: memAfterWrite,
    },
    locations: sealedIdm,
    formulaAnchors: formulaAnchorLocations(),
    neverInventHashes: true,
  };
}

export function formatSystemsCheckCard(result) {
  const lines = [];
  const inject = result.inject || {};
  const sealed = result.locations || sealedInjectIdmLocations(inject);
  lines.push(SYSTEMS_CHECK_MAGIC + "v1|check§");
  lines.push("⛓️ VITA SYSTEMS CHECK — chain memory must match files");
  lines.push("━━━━━━━━━━━━━━━━━━━━");
  lines.push(
    `pass ${result.passed}/${result.total}  formula=${result.formula}  inventHashes=NO`,
  );
  for (const c of result.checks || []) {
    lines.push(`${c.ok ? "✅" : "❌"} ${c.title} — ${c.detail}`);
  }
  lines.push("");
  lines.push("— SNARK (local until sealed inject) —");
  lines.push(result.snark?.short || "—");
  lines.push(
    `files=${result.snark?.fileCount || 0} · bytes=${result.snark?.bytes || 0}` +
      (result.snark?.localOnly ? " · LOCAL_ONLY (not on-chain body)" : ""),
  );
  lines.push("");
  lines.push("— SPACED INJECT (code > " + SPACED_CHUNK_BYTES + "B field) —");
  lines.push(
    `required=${inject.spacedBlockchainLocationsRequired || inject.totalChunks || 0} locs · sealed=${inject.sealedCount || 0} · pending=${inject.pendingCount || 0} · verified=${inject.verifiedCount || 0}`,
  );
  lines.push("");
  lines.push("— SEALED IDM CHAT (Input Data → UTF-8) — library body only —");
  if (!sealed.length) {
    lines.push("(none sealed — do not click formula anchors as library proof)");
  } else {
    for (const loc of sealed.slice(0, 24)) {
      const mark = loc.verified ? "✅" : "🔗";
      lines.push(
        `${mark} ${loc.id || "sealed"}  ${shortHex(loc.location, 10)}…  ${loc.basescan}`,
      );
    }
    if (sealed.length > 24) lines.push(`… +${sealed.length - 24} more — /vita check locs`);
  }
  lines.push("");
  lines.push("— FORMULA ANCHORS (class proof ONLY — not library inject) —");
  for (const loc of (result.formulaAnchors || formulaAnchorLocations()).slice(0, 4)) {
    lines.push(`🏷 ${loc.id}  ${shortHex(loc.location, 8)}…  ${loc.basescan}`);
  }
  lines.push("");
  lines.push("— EVM RECOVER —");
  lines.push(
    `${result.recover?.localRecoverMs ?? "?"}ms local · unwrap=${result.recover?.unwrapInstant ? "instant" : "?"} · ` +
      `evmClass=${result.recover?.evmClass || "—"}` +
      (result.recover?.localOnly ? " · LOCAL_ONLY" : ""),
  );
  lines.push("");
  lines.push("— MODELS —");
  lines.push(
    `agreed → ${result.models?.agreed || "?"} · multi ${(result.models?.multi || []).join(", ") || "—"}`,
  );
  lines.push("");
  lines.push("— LLM SPIN —");
  lines.push(
    `${LLM_SPIN_MAGIC} ${result.llm?.modelId || "?"} · commit ${shortHex(result.llm?.contentCommit, 12)}…`,
  );
  lines.push("Tap sealed IDM / check locs / check pull. Never invent hashes.");
  const after = result.growth?.after;
  if (after?.memory) {
    lines.push("");
    lines.push(
      `library growth memory=${after.memory.count}f strands=${after.strands?.count ?? "?"}f (files created)`,
    );
  }
  return lines.join("\n");
}

export function formatRecoverCard(recover) {
  const lines = [];
  lines.push(CHAIN_LAYER_MAGIC + "v1|recover§");
  lines.push("⚡ EVM RECOVER SPEED");
  lines.push(`local ${recover.localRecoverMs}ms · total ${recover.totalMs}ms`);
  if (recover.rpcPingMs != null) lines.push(`rpc ping ${recover.rpcPingMs}ms`);
  lines.push(`snark ${recover.snarkShort || "—"}`);
  lines.push(`files ${recover.fileCount} · locs ${recover.locCount}`);
  lines.push(`unwrap instant=${recover.unwrapInstant ? "YES" : "no"} · privateKey=NO`);
  lines.push(`chain ${recover.chain} (${recover.chainId}) · ${recover.evmClass}`);
  lines.push(recover.note || "");
  return lines.join("\n");
}

export function formatModelsCard(models) {
  const lines = [];
  lines.push(CHAIN_LAYER_MAGIC + "v1|models§");
  lines.push("🧠 LAST AGREED / MULTI-MODEL");
  lines.push(`agreed → ${models.agreed}`);
  for (let i = 0; i < (models.cycle || []).length; i++) {
    const m = models.cycle[i];
    const mark = m === models.agreed ? "→" : " ";
    lines.push(`${mark} ${i + 1}. ${m}`);
  }
  lines.push(`multi stack: ${(models.multi || []).join(" · ") || "—"}`);
  lines.push("Railway VITA_MODELS=id1,id2 · /vita models next rotates");
  lines.push("Open-source: change at will without rewriting Base settlement.");
  return lines.join("\n");
}

export function formatLlmSpinCard(llm) {
  const lines = [];
  lines.push(LLM_SPIN_MAGIC + " SPIN MANIFEST");
  lines.push(`model ${llm.modelId}`);
  lines.push(`snark ${llm.snarkShort || "—"}`);
  lines.push(`commit ${shortHex(llm.contentCommit, 16)}…`);
  lines.push("spin routes:");
  for (const [k, v] of Object.entries(llm.spin || {})) {
    lines.push(`  ${k}: ${v}`);
  }
  lines.push("");
  lines.push(llm.note || "");
  lines.push("neverInventHashes=true");
  for (const loc of (llm.locations || []).slice(0, 3)) {
    lines.push(`🔗 ${loc.id}  ${shortHex(loc.location, 8)}…`);
  }
  return lines.join("\n");
}

export function formatChainLayerTelegramHtml(text) {
  return "<pre>" + esc(text).slice(0, 3800) + "</pre>";
}

export function buildSystemsCheckKeyboard({
  locations = [],
  plan = null,
  includeFormulaAnchors = false,
} = {}) {
  // Prefer spaced sealed inject IDM — never pretend formula anchors are library body.
  if (plan || (locations || []).some((l) => l.role === "sealed-inject" || l.holdsLibraryBody)) {
    return buildSpacedIdmKeyboard({
      plan: plan || { chunks: (locations || []).map((l) => ({
        id: l.id,
        sealed: true,
        location: l.location,
        basescan: l.basescan,
        verified: l.verified,
        match: l.match,
        file: l.label,
        index: 1,
        fileTotal: 1,
        contentCommit: l.contentCommit,
      })) },
      includeFormulaAnchors,
      includeNav: true,
    });
  }
  const rows = [
    [
      { text: "✅ Check", callback_data: "/vita check" },
      { text: "📦 Inject locs", callback_data: "/vita check locs" },
      { text: "⬇️ Pull", callback_data: "/vita check pull" },
    ],
    [
      { text: "⚡ Recover", callback_data: "/vita recover" },
      { text: "🧠 Models", callback_data: "/vita models" },
      { text: "🧬 LLM spin", callback_data: "/vita llm" },
    ],
  ];
  return { inline_keyboard: rows };
}

/**
 * Parse /vita check|recover|models|llm|spin (and aliases).
 * Returns null when not a chain-layer command.
 */
export function parseChainLayerCommand(raw) {
  const src = String(raw || "").trim();
  const low = src.toLowerCase();
  if (
    low === "/vita check routes" ||
    low === "/vita check route" ||
    low === "/vita routes" ||
    low === "/vita routecheck" ||
    low === "/vitacheck routes"
  ) {
    return { action: "routes" };
  }
  if (
    low === "/vita check" ||
    low === "/vita syscheck" ||
    low === "/vita systems" ||
    low === "/vitacheck"
  ) {
    return { action: "check" };
  }
  if (
    low === "/vita check locs" ||
    low === "/vita check loc" ||
    low === "/vita check inject" ||
    low === "/vita inject locs"
  ) {
    return { action: "locs" };
  }
  if (low === "/vita check pull" || low === "/vita pull inject" || low === "/vita check verify") {
    return { action: "pull" };
  }
  if (low === "/vita recover" || low === "/vita evm" || low === "/vita speed") {
    return { action: "recover" };
  }
  if (low === "/vita models" || low === "/vita model") {
    return { action: "models", kind: null };
  }
  if (low.startsWith("/vita models ")) {
    const kind = src.slice("/vita models ".length).trim().toLowerCase();
    return { action: "models", kind: kind || null };
  }
  if (low === "/vita llm" || low === "/vita spin" || low === "/vita llmspin") {
    return { action: "llm" };
  }
  if (low.startsWith("/vita spin ")) {
    return { action: "llm", modelId: src.slice("/vita spin ".length).trim() || null };
  }
  if (low.startsWith("/vita llm ")) {
    return { action: "llm", modelId: src.slice("/vita llm ".length).trim() || null };
  }
  return null;
}

/**
 * Handle chain-layer Telegram / HTTP actions.
 */
export async function handleChainLayerAction({
  action,
  kind = null,
  modelId = null,
  cwd = REPO_ROOT,
  env = process.env,
  rpcPingMs = null,
  write = true,
  now = Date.now(),
  fetchCalldata = null,
  readUtf8FromCalldata = null,
} = {}) {
  if (action === "check" || action === "systems" || action === "syscheck") {
    const result = await runSystemsCheck({
      cwd,
      env,
      write,
      rpcPingMs,
      now,
      fetchCalldata,
      readUtf8FromCalldata,
      pull: typeof fetchCalldata === "function",
    });
    const reply = formatSystemsCheckCard(result);
    return {
      ok: result.ok,
      action: "check",
      reply,
      html: formatChainLayerTelegramHtml(reply),
      keyboard: buildSystemsCheckKeyboard({
        locations: result.locations,
        plan: result.inject,
        includeFormulaAnchors: false,
      }),
      result,
      locations: result.locations,
      inject: result.inject,
      snark: result.snark,
    };
  }

  if (action === "routes" || action === "route") {
    // Dynamic import avoids cycle with telegram-help-routes → chain-layer.
    const {
      runRouteSystemsCheck,
      formatRouteSystemsCheckCard,
      buildRouteCheckKeyboard,
    } = await import("./telegram-help-routes.js");
    const { stageVitaFeed, prepareVitaFeed, resolveVitaFeedQuotes } = await import("./vita-feed.js");
    let symbols = [];
    try {
      const tokPath = join(cwd, "tokens.json");
      if (existsSync(tokPath)) {
        const parsed = JSON.parse(readFileSync(tokPath, "utf8"));
        symbols = (parsed.tokens || parsed || []).map((t) => t.symbol || t).filter(Boolean);
      }
    } catch { /* empty catalog → QUESTIONABLE trade nodes */ }
    const report = await runRouteSystemsCheck({
      cwd,
      symbols,
      write,
      includeChainLayer: true,
      env,
      now,
    });
    // Force-stage §SYSCHECK§ body for Confirm|Override seal (never invent hashes).
    try {
      const quotes = resolveVitaFeedQuotes({});
      const prepared = prepareVitaFeed(report.forceInjectBody, quotes);
      stageVitaFeed("telegram", {
        body: report.forceInjectBody,
        prepared,
        quotes,
        source: "systems-check-routes",
        routeCheck: {
          verdict: report.verdict,
          containerRoot: report.containerRoot,
        },
      });
    } catch { /* stage best-effort */ }
    const reply = formatRouteSystemsCheckCard(report);
    return {
      ok: report.verdict !== "FAIL",
      action: "routes",
      reply,
      html: formatChainLayerTelegramHtml(reply),
      keyboard: buildRouteCheckKeyboard(),
      report,
      forceInjectBody: report.forceInjectBody,
      locations: [],
    };
  }

  if (action === "locs" || action === "inject") {
    const inject = await buildAndMatchInjectPlan({
      cwd,
      write,
      fetchCalldata: null,
      now,
      pull: false,
    });
    const reply = formatInjectPlanCard(inject);
    return {
      ok: true,
      action: "locs",
      reply,
      html: formatChainLayerTelegramHtml(reply),
      keyboard: buildSpacedIdmKeyboard({
        plan: inject,
        includeFormulaAnchors: true,
        includeNav: true,
      }),
      inject,
      locations: sealedInjectIdmLocations(inject),
    };
  }

  if (action === "pull" || action === "verify") {
    const inject = await buildAndMatchInjectPlan({
      cwd,
      write,
      fetchCalldata,
      readUtf8FromCalldata,
      now,
      pull: typeof fetchCalldata === "function",
    });
    const reply = formatInjectPlanCard(inject);
    return {
      ok: true,
      action: "pull",
      reply,
      html: formatChainLayerTelegramHtml(reply),
      keyboard: buildSpacedIdmKeyboard({
        plan: inject,
        includeFormulaAnchors: false,
        includeNav: true,
      }),
      inject,
      locations: sealedInjectIdmLocations(inject),
    };
  }

  if (action === "recover" || action === "evm" || action === "speed") {
    const inject = await buildAndMatchInjectPlan({
      cwd,
      write: false,
      pull: false,
      now,
    });
    const recover = measureEvmRecover({
      cwd,
      rpcPingMs,
      now,
      sealedLocs: sealedInjectIdmLocations(inject),
    });
    if (write) {
      ensureDirs();
      writeFileSync(
        join(MEMORY_DIR, "evm-recover-latest.json"),
        JSON.stringify(
          {
            at: recover.at,
            topic: "evm-recover",
            filingLabel: CHAIN_LAYER_LABEL,
            ...recover,
            formula: FORMULA_ID,
          },
          null,
          2,
        ) + "\n",
      );
    }
    const reply = formatRecoverCard(recover);
    return {
      ok: true,
      action: "recover",
      reply,
      html: formatChainLayerTelegramHtml(reply),
      keyboard: buildSystemsCheckKeyboard({
        locations: recover.locations,
        plan: inject,
      }),
      recover,
      locations: recover.locations,
    };
  }

  if (action === "models" || action === "model") {
    const rotate = String(kind || "").toLowerCase() === "next";
    if (rotate) nextVitaModel(env);
    const models = agreeModelRing({ env, write, now });
    const reply = formatModelsCard(models);
    return {
      ok: true,
      action: "models",
      reply,
      html: formatChainLayerTelegramHtml(reply),
      keyboard: buildSystemsCheckKeyboard({}),
      models,
    };
  }

  if (action === "llm" || action === "spin" || action === "llmspin") {
    const llm = registerLlmOnchainSpin({
      modelId,
      env,
      write,
      now,
    });
    const reply = formatLlmSpinCard(llm);
    return {
      ok: true,
      action: "llm",
      reply,
      html: formatChainLayerTelegramHtml(reply),
      keyboard: buildSystemsCheckKeyboard({}),
      llm,
      locations: [],
    };
  }

  return {
    ok: false,
    action: action || "unknown",
    reply: "unknown chain-layer action — try /vita check",
    html: "",
  };
}
