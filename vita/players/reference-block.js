/**
 * Reference blocks — refined front · mid · back identity + data field of
 * every project location touched (append-only follow log).
 *
 * A reference block is labeled SOURCE or REFERENCE only (filer library).
 * Data field = paths the avenue has touched so we can always follow data.
 * Original player files stay SOURCE. Named holders live under vita/players/.
 *
 * Never invents tx hashes. Mother brain untouched.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FORMULA_ID, MAINFRAME_ANCHORS } from "../mainframe.js";
import { identifyLoc } from "./identify.js";
import {
  FILER_BLOCKS,
  LABEL_REFERENCE,
  LABEL_SOURCE,
  classProofLoc,
  isAllowedReferenceLabel,
} from "./filer-registry.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const MEMORY_DIR = join(HERE, "..", "memory");
const TOUCH_PATH = join(MEMORY_DIR, "player-touch-log.json");
const BLOCK_PATH = join(MEMORY_DIR, "player-reference-blocks.json");

export const REF_BLOCK_ID = "vita-player-ref-block-v1";
export const REF_BLOCK_MAGIC = "§VITAREFBLOCK§";
export const REF_BLOCK_LABEL = "REFERENCE";

const BASESCAN = MAINFRAME_ANCHORS.basescanTx || "https://basescan.org/tx/";

function sha256Hex(text) {
  return createHash("sha256").update(String(text || ""), "utf8").digest("hex");
}

function ensureDir() {
  if (!existsSync(MEMORY_DIR)) mkdirSync(MEMORY_DIR, { recursive: true });
}

function emptyTouch() {
  return {
    id: "vita-player-touch-log-v1",
    filingLabel: LABEL_REFERENCE,
    formula: FORMULA_ID,
    neverInventHashes: true,
    neverForget: true,
    createdAt: new Date().toISOString(),
    updatedAt: null,
    entries: [],
  };
}

function loadJson(path, fallback) {
  try {
    if (!existsSync(path)) return fallback();
    const raw = JSON.parse(readFileSync(path, "utf8"));
    return { ...fallback(), ...raw, entries: Array.isArray(raw.entries) ? raw.entries : [] };
  } catch {
    return fallback();
  }
}

function persist(path, obj) {
  ensureDir();
  obj.updatedAt = new Date().toISOString();
  writeFileSync(path, JSON.stringify(obj, null, 2) + "\n", "utf8");
  return obj;
}

/** Seed the follow log with every SOURCE + REFERENCE path in the filer. */
function seedTouches(log) {
  const have = new Set((log.entries || []).map((e) => e.path));
  for (const b of FILER_BLOCKS) {
    if (have.has(b.path)) continue;
    log.entries.push({
      at: log.createdAt || new Date().toISOString(),
      path: b.path,
      label: b.label,
      role: b.role,
      player: b.player,
      filerId: b.id,
    });
    have.add(b.path);
  }
  return log;
}

export function loadTouchLog() {
  const log = seedTouches(loadJson(TOUCH_PATH, emptyTouch));
  if (!existsSync(TOUCH_PATH) || log.entries.length !== (loadJson(TOUCH_PATH, emptyTouch).entries || []).length) {
    persist(TOUCH_PATH, log);
  }
  return log;
}

/** Append a touched project path. Idempotent per path+role. */
export function recordTouch({ path, label = LABEL_REFERENCE, role = "touch", player = "garden" } = {}) {
  const p = String(path || "").trim();
  if (!p) return { ok: false, reason: "need path" };
  const lab = isAllowedReferenceLabel(label) ? String(label).toUpperCase() : LABEL_REFERENCE;
  const log = loadTouchLog();
  const dup = log.entries.find((e) => e.path === p && e.role === role);
  if (dup) return { ok: true, skipped: true, entry: dup, log };
  const entry = {
    at: new Date().toISOString(),
    path: p,
    label: lab,
    role: String(role || "touch"),
    player: String(player || "garden"),
  };
  log.entries.push(entry);
  persist(TOUCH_PATH, log);
  return { ok: true, skipped: false, entry, log };
}

function buildBlock({ id, label, player, paths, title }) {
  const proof = classProofLoc();
  const identify = identifyLoc({ location: proof.location });
  const dataField = (paths || []).map((p) => ({
    path: p.path || p,
    label: p.label || label,
    role: p.role || null,
    player: p.player || player,
  }));
  const commit = sha256Hex(JSON.stringify({ id, dataField, loc: proof.location }));
  return {
    id,
    magic: REF_BLOCK_MAGIC,
    filingLabel: label,
    player,
    title,
    identify,
    location: proof.location,
    basescan: proof.basescan,
    classProof: true,
    dataField,
    dataFieldCommit: commit,
    dataFieldCommit8: commit.slice(0, 8),
    formula: FORMULA_ID,
    neverInventHashes: true,
    note:
      label === LABEL_SOURCE
        ? "SOURCE block — original file locations. Name is static; loc is truth."
        : "REFERENCE block — named holder. Original paths stay in SOURCE data field.",
  };
}

export function buildReferenceBlocks() {
  const log = loadTouchLog();
  const sourcePaths = log.entries.filter((e) => e.label === LABEL_SOURCE);
  const refPaths = log.entries.filter((e) => e.label === LABEL_REFERENCE);
  const source = buildBlock({
    id: "player-source-block",
    label: LABEL_SOURCE,
    player: "garden",
    title: "SOURCE · original player locations",
    paths: sourcePaths,
  });
  const reference = buildBlock({
    id: "player-reference-block",
    label: LABEL_REFERENCE,
    player: "garden",
    title: "REFERENCE · named players holder",
    paths: refPaths,
  });
  const proven = buildBlock({
    id: "proven-reference-block",
    label: LABEL_REFERENCE,
    player: "proven",
    title: "REFERENCE · Proven Player / ZK-Streaming Engine",
    paths: refPaths.filter((e) => e.player === "proven" || /proven/.test(e.path)),
  });
  const payload = {
    id: REF_BLOCK_ID,
    filingLabel: REF_BLOCK_LABEL,
    formula: FORMULA_ID,
    neverInventHashes: true,
    updatedAt: new Date().toISOString(),
    blocks: [source, reference, proven],
    follow: log.entries,
    basescanTx: BASESCAN,
    wallet: MAINFRAME_ANCHORS.wallet,
  };
  ensureDir();
  writeFileSync(BLOCK_PATH, JSON.stringify(payload, null, 2) + "\n", "utf8");
  return payload;
}

export function publicReferenceBlocks() {
  return buildReferenceBlocks();
}

export { BASESCAN };
