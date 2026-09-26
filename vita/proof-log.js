/**
 * Proof-of-logs trail — creation-order rolling verification log.
 *
 * Every compressed / verified / staged / message-out event appends here.
 * Each row carries the open compression key + original root path so the
 * trail always traces back to root. The header is the main log; child
 * labels/numbers grow a logging tree (log-of-logs) for fine adjustment.
 *
 * Race slots 1–3 (and optional extra solvers) justify who proofed or
 * injected first. Multi-chain seats record requested memory credit —
 * locations stay empty until a real seal. Never invent tx hashes.
 *
 * Telegram: /vitafeed log · /vitafeed trail · tap file → Plain | Machine |
 * Original | Unwrap | Race | Chains.
 */

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { FORMULA_ID, MAINFRAME_ANCHORS } from "./mainframe.js";
import { MULTICHAIN_SEATS } from "./multichain-portfolio.js";
import { vitaPlayerHref } from "./url-dir.js";

const CALLBACK_DATA_MAX = 64;

/** Local copy — avoid importing mirror-chain (pulls vita-dir → compression cycle). */
function telegramCallbackData(cmd) {
  const s = String(cmd || "");
  if (s.length <= CALLBACK_DATA_MAX) return s;
  return s.slice(0, CALLBACK_DATA_MAX);
}

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const MEMORY_DIR = join(HERE, "memory");
const STRANDS_DIR = join(HERE, "strands");

export const PROOF_LOG_ID = "vita-proof-log-v1";
export const PROOF_LOG_MAGIC = "§VITAPROOFLOG§";
export const PROOF_LOG_VERSION = "v1";
export const PROOF_LOG_LABEL = "PROOFLOG";
export const PROOF_LOG_DIR = "PROOFLOG";
export const PROOF_LOG_PLAYER = "/vita/proof-log";
export const RACE_SLOTS_DEFAULT = 3;
export const TRAIL_VISIBLE = 24;

function sha256Hex(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function shortHex(hex, n = 8) {
  return String(hex || "").replace(/^0x/i, "").toLowerCase().slice(0, n);
}

function isTxHash(h) {
  return /^0x[0-9a-fA-F]{64}$/.test(String(h || ""));
}

function clip(s, n = 120) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  if (t.length <= n) return t;
  return t.slice(0, Math.max(0, n - 1)) + "…";
}

function ensureDirs(opts = {}) {
  const mem = opts.memoryDir || MEMORY_DIR;
  const strands = opts.strandsDir || STRANDS_DIR;
  if (!existsSync(mem)) mkdirSync(mem, { recursive: true });
  if (!existsSync(strands)) mkdirSync(strands, { recursive: true });
}

export function proofLogPaths(opts = {}) {
  return {
    trail: opts.trailPath || join(MEMORY_DIR, "proof-log-trail.json"),
    learn: opts.learnPath || join(MEMORY_DIR, "proof-log-learn.json"),
    strand: opts.strandPath || join(STRANDS_DIR, "proof-log.json"),
  };
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

function emptyTrail() {
  const at = new Date().toISOString();
  return {
    id: PROOF_LOG_ID,
    filingLabel: PROOF_LOG_LABEL,
    formula: FORMULA_ID,
    neverInventHashes: true,
    neverForget: true,
    createdAt: at,
    updatedAt: at,
    seq: 0,
    header: {
      version: PROOF_LOG_VERSION,
      rootCommit: null,
      lastSeq: 0,
      raceSlots: RACE_SLOTS_DEFAULT,
      note: "Main proof-of-logs header. Child labels refine the tree. Keys attach every row to root path.",
      updatedAt: at,
    },
    entries: [],
    tree: [],
  };
}

function recomputeHeader(doc) {
  const entries = Array.isArray(doc.entries) ? doc.entries : [];
  const body = entries
    .map((e) => [e.n, e.key, e.rootPath, e.rawHash, e.phase, e.at].join("|"))
    .join("\n");
  const rootCommit = entries.length ? sha256Hex(Buffer.from(body, "utf8")) : null;
  doc.header = {
    version: PROOF_LOG_VERSION,
    rootCommit,
    lastSeq: doc.seq || 0,
    raceSlots: Number(doc.header?.raceSlots) || RACE_SLOTS_DEFAULT,
    entryCount: entries.length,
    verifiedCount: entries.filter((e) => e.verified === true).length,
    messageOutCount: entries.filter((e) => e.messageOut === true).length,
    sealedCount: entries.filter((e) => (e.locations || []).some(isTxHash)).length,
    note: "Main proof-of-logs header. Child labels refine the tree. Keys attach every row to root path.",
    updatedAt: new Date().toISOString(),
  };
  doc.tree = buildLogTree(entries);
  doc.updatedAt = doc.header.updatedAt;
  return doc;
}

/**
 * Log-of-logs tree — numbered/labeled children hang off the main trail
 * header so fine adjustments stay linked to justified creation order.
 */
export function buildLogTree(entries = []) {
  const byN = new Map();
  for (const e of entries) byN.set(e.n, e);
  const roots = [];
  const children = new Map();
  for (const e of entries) {
    const parent = e.parentLogN != null && byN.has(e.parentLogN) ? e.parentLogN : null;
    if (parent == null) {
      roots.push(e.n);
    } else {
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(e.n);
    }
  }
  function walk(n, depth) {
    const e = byN.get(n);
    if (!e) return null;
    return {
      n: e.n,
      label: e.label || ("#" + e.n),
      phase: e.phase,
      key: e.key,
      depth,
      children: (children.get(n) || []).map((c) => walk(c, depth + 1)).filter(Boolean),
    };
  }
  return roots.map((n) => walk(n, 0)).filter(Boolean);
}

export function readProofLog(opts = {}) {
  ensureDirs(opts);
  const path = proofLogPaths(opts).trail;
  const doc = readJson(path, null);
  if (!doc || typeof doc !== "object") return emptyTrail();
  if (!Array.isArray(doc.entries)) doc.entries = [];
  doc.neverInventHashes = true;
  doc.neverForget = true;
  doc.filingLabel = PROOF_LOG_LABEL;
  return recomputeHeader(doc);
}

function persist(doc, opts = {}) {
  ensureDirs(opts);
  const paths = proofLogPaths(opts);
  const next = recomputeHeader(doc);
  writeJson(paths.trail, next);
  writeJson(paths.strand, {
    id: PROOF_LOG_ID,
    filingLabel: PROOF_LOG_LABEL,
    formula: FORMULA_ID,
    neverInventHashes: true,
    note: "Rolling proof-of-logs · key+root on every row · race 1–3 · multi-chain credit seats",
    ends: [
      "File compress → trail row with key + original path",
      "Verify/unwrap → timed verification · message-out proof",
      "Race slots 1–3 justify who proofed/injected first",
      "Chain seats request memory credit; locs empty until real seal",
      "Telegram tabs: Plain · Machine · Original · Unwrap",
    ],
    updatedAt: next.updatedAt,
    lastSeq: next.seq,
    rootCommit: next.header?.rootCommit || null,
    entryCount: next.entries.length,
  });
  const learn = readJson(paths.learn, { id: "vita-proof-log-learn-v1", label: PROOF_LOG_LABEL, events: [] });
  if (!Array.isArray(learn.events)) learn.events = [];
  const last = next.entries[next.entries.length - 1];
  if (last) {
    learn.events.push({
      at: last.at,
      n: last.n,
      phase: last.phase,
      key: last.key,
      rootPath: last.rootPath,
      verified: last.verified === true,
      messageOut: last.messageOut === true,
      raceSlot: last.race?.slot ?? null,
    });
    learn.updatedAt = last.at;
    writeJson(paths.learn, learn);
  }
  return next;
}

function normalizeRootPath(rootPath, name) {
  const raw = String(rootPath || name || "").trim();
  if (!raw) return "unknown";
  try {
    if (raw.startsWith("/")) {
      const rel = relative(ROOT, raw);
      if (rel && !rel.startsWith("..")) return rel.replace(/\\/g, "/");
    }
  } catch { /* keep raw */ }
  return raw.replace(/\\/g, "/").slice(0, 240);
}

function chainSeatMap() {
  const out = {};
  for (const s of MULTICHAIN_SEATS) out[s.id] = s;
  return out;
}

export function normalizeChainRequests(requested = []) {
  const seats = chainSeatMap();
  const list = Array.isArray(requested)
    ? requested
    : String(requested || "").split(/[\s,]+/).filter(Boolean);
  const seen = new Set();
  const credits = [];
  for (const raw of list) {
    const id = String(raw || "").trim().toLowerCase();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const seat = seats[id];
    credits.push({
      chain: id,
      chainId: seat?.chainId ?? null,
      name: seat?.name || id,
      role: seat?.role || "requested",
      status: "requested",
      location: null,
      basescan: null,
      memoryCredit: true,
      note: "Credit seat reserved — loc empty until a real seal on this chain",
    });
  }
  return credits;
}

/**
 * Append or update a trail row. Key + rootPath are required for trace-to-root.
 */
export function appendProofLog({
  key,
  name = "",
  kind = "file",
  mime = "",
  codec = "",
  rootPath = "",
  storePath = "",
  rawHash = "",
  payloadHash = "",
  rawBytes = 0,
  payloadBytes = 0,
  phase = "filed",
  verified = false,
  messageOut = false,
  timing = null,
  machine = "",
  plainPreview = "",
  locations = [],
  chainsRequested = [],
  raceWho = "operator",
  claimRace = false,
  claimInjectRace = false,
  parentLogN = null,
  label = "",
  source = "compress",
} = {}, opts = {}) {
  if (!key) return { ok: false, reason: "key required — every logged file attaches its open key" };
  const doc = readProofLog(opts);
  const at = new Date().toISOString();
  const root = normalizeRootPath(rootPath, name);
  const locs = (locations || []).filter(isTxHash);
  let entry = doc.entries.find((e) => e.key === key && e.rootPath === root);
  if (!entry) entry = doc.entries.find((e) => e.key === key);
  const isNew = !entry;
  if (isNew) {
    doc.seq = Number(doc.seq || 0) + 1;
    entry = {
      n: doc.seq,
      at,
      phase,
      key,
      name: String(name || "").slice(0, 180),
      kind,
      mime,
      codec,
      rootPath: root,
      storePath: storePath ? normalizeRootPath(storePath, "") : "",
      rawHash,
      payloadHash,
      rawBytes,
      payloadBytes,
      verified: verified === true,
      messageOut: messageOut === true,
      timing: timing || {},
      machine: String(machine || "").slice(0, 500),
      plainPreview: String(plainPreview || "").slice(0, 400),
      locations: locs,
      chainCredits: normalizeChainRequests(chainsRequested),
      race: { slot: null, injectSlot: null, who: raceWho || "operator", proofedFirst: false, injectedFirst: false },
      parentLogN: parentLogN != null && Number.isFinite(Number(parentLogN)) ? Number(parentLogN) : null,
      label: String(label || "").slice(0, 64),
      source,
      history: [],
    };
    doc.entries.push(entry);
  } else {
    entry.phase = phase || entry.phase;
    entry.verified = entry.verified || verified === true;
    entry.messageOut = entry.messageOut || messageOut === true;
    entry.codec = codec || entry.codec;
    entry.rawHash = rawHash || entry.rawHash;
    entry.payloadHash = payloadHash || entry.payloadHash;
    entry.rawBytes = rawBytes || entry.rawBytes;
    entry.payloadBytes = payloadBytes || entry.payloadBytes;
    entry.storePath = storePath ? normalizeRootPath(storePath, "") : entry.storePath;
    if (machine) entry.machine = String(machine).slice(0, 500);
    if (plainPreview) entry.plainPreview = String(plainPreview).slice(0, 400);
    if (timing) entry.timing = { ...(entry.timing || {}), ...timing };
    if (locs.length) {
      const seen = new Set((entry.locations || []).map((h) => h.toLowerCase()));
      for (const h of locs) {
        if (!seen.has(h.toLowerCase())) entry.locations.push(h);
      }
    }
    if (chainsRequested && (Array.isArray(chainsRequested) ? chainsRequested.length : String(chainsRequested))) {
      const extra = normalizeChainRequests(chainsRequested);
      const have = new Set((entry.chainCredits || []).map((c) => c.chain));
      entry.chainCredits = [...(entry.chainCredits || [])];
      for (const c of extra) {
        if (!have.has(c.chain)) entry.chainCredits.push(c);
      }
    }
    if (label) entry.label = String(label).slice(0, 64);
    if (parentLogN != null) entry.parentLogN = Number(parentLogN);
    entry.updatedAt = at;
  }

  entry.history = Array.isArray(entry.history) ? entry.history : [];
  entry.history.push({ at, phase: entry.phase, verified: entry.verified, messageOut: entry.messageOut });

  if (claimRace) assignRaceSlot(doc, entry, { kind: "proof", who: raceWho });
  if (claimInjectRace) assignRaceSlot(doc, entry, { kind: "inject", who: raceWho });

  const next = persist(doc, opts);
  return { ok: true, entry: next.entries.find((e) => e.n === entry.n), trail: next, created: isNew };
}

function assignRaceSlot(doc, entry, { kind = "proof", who = "operator" } = {}) {
  const slots = Number(doc.header?.raceSlots) || RACE_SLOTS_DEFAULT;
  const field = kind === "inject" ? "injectSlot" : "slot";
  const flag = kind === "inject" ? "injectedFirst" : "proofedFirst";
  if (entry.race?.[field] != null) return entry.race;
  const taken = new Set(
    doc.entries
      .map((e) => e.race?.[field])
      .filter((s) => s != null),
  );
  let slot = null;
  for (let i = 1; i <= slots; i++) {
    if (!taken.has(i)) {
      slot = i;
      break;
    }
  }
  if (slot == null) {
    let max = slots;
    for (const e of doc.entries) {
      const s = e.race?.[field];
      if (typeof s === "number" && s > max) max = s;
    }
    slot = max + 1;
  }
  entry.race = {
    ...(entry.race || {}),
    who: who || entry.race?.who || "operator",
    [field]: slot,
    [flag]: slot === 1,
  };
  return entry.race;
}

export function getProofLogEntry(selector, opts = {}) {
  const doc = readProofLog(opts);
  const raw = String(selector || "").trim();
  if (!raw) return { ok: false, reason: "usage: /vitafeed log <n|key|name>" };
  if (/^\d+$/.test(raw)) {
    const hit = doc.entries.find((e) => e.n === Number(raw));
    return hit ? { ok: true, entry: hit, trail: doc } : { ok: false, reason: "no trail #" + raw };
  }
  const lower = raw.toLowerCase();
  const hit =
    doc.entries.find((e) => e.key.toLowerCase() === lower) ||
    doc.entries.find((e) => e.name.toLowerCase() === lower) ||
    doc.entries.find((e) => e.rootPath.toLowerCase().includes(lower)) ||
    doc.entries.find((e) => (e.label || "").toLowerCase() === lower);
  return hit ? { ok: true, entry: hit, trail: doc } : { ok: false, reason: "not in trail: " + raw };
}

export function listProofLogEntries(opts = {}) {
  const doc = readProofLog(opts);
  return {
    ok: true,
    count: doc.entries.length,
    header: doc.header,
    entries: doc.entries.slice().sort((a, b) => b.n - a.n),
    tree: doc.tree,
  };
}

export function requestProofLogChains(selector, chains, opts = {}) {
  const found = getProofLogEntry(selector, opts);
  if (!found.ok) return found;
  return appendProofLog({
    key: found.entry.key,
    name: found.entry.name,
    kind: found.entry.kind,
    mime: found.entry.mime,
    codec: found.entry.codec,
    rootPath: found.entry.rootPath,
    storePath: found.entry.storePath,
    rawHash: found.entry.rawHash,
    payloadHash: found.entry.payloadHash,
    rawBytes: found.entry.rawBytes,
    payloadBytes: found.entry.payloadBytes,
    phase: found.entry.phase,
    verified: found.entry.verified,
    messageOut: found.entry.messageOut,
    machine: found.entry.machine,
    plainPreview: found.entry.plainPreview,
    locations: found.entry.locations,
    chainsRequested: chains,
    raceWho: found.entry.race?.who,
    parentLogN: found.entry.parentLogN,
    label: found.entry.label,
    source: "chain-request",
  }, opts);
}

export function sealProofLogLocs(selector, locs, opts = {}) {
  const real = (locs || []).filter(isTxHash);
  if (!real.length) return { ok: false, reason: "no real tx hashes — never invent" };
  const found = getProofLogEntry(selector, opts);
  if (!found.ok) return found;
  return appendProofLog({
    ...found.entry,
    key: found.entry.key,
    rootPath: found.entry.rootPath,
    phase: "sealed",
    locations: real,
    claimInjectRace: true,
    raceWho: found.entry.race?.who || "operator",
    source: "seal",
  }, opts);
}

export function labelProofLog(selector, label, { parentLogN = null } = {}, opts = {}) {
  const found = getProofLogEntry(selector, opts);
  if (!found.ok) return found;
  return appendProofLog({
    ...found.entry,
    key: found.entry.key,
    rootPath: found.entry.rootPath,
    label,
    parentLogN: parentLogN != null ? parentLogN : found.entry.parentLogN,
    phase: found.entry.phase,
    source: "label",
  }, opts);
}

/** Record compress file into the trail (key + original path). */
export function logCompressionFiled(filed, { rootPath = "", storePath = "", raceWho = "operator" } = {}, opts = {}) {
  if (!filed?.ok || !filed.key) return { ok: false, reason: "compress miss" };
  const entry = filed.entry || {};
  return appendProofLog({
    key: filed.key,
    name: entry.name || filed.name,
    kind: entry.kind || filed.kind,
    mime: entry.mime || "",
    codec: entry.codec || filed.codec,
    rootPath: rootPath || entry.sourcePath || entry.name || filed.name,
    storePath: storePath || "",
    rawHash: entry.rawHash || "",
    payloadHash: entry.payloadHash || "",
    rawBytes: entry.rawBytes || 0,
    payloadBytes: entry.payloadBytes || 0,
    phase: "filed",
    verified: filed.verified === true,
    timing: { filedMs: entry.compressMs || 0, at: entry.at },
    machine: "COMPRESS key=" + filed.key + " codec=" + (entry.codec || "") + " ratio=" + (entry.ratio ?? ""),
    plainPreview: "",
    chainsRequested: ["base"],
    raceWho,
    source: entry.source || "compress",
  }, opts);
}

/** Timed verify / message-out — claims race slot when verified. */
export function logCompressionVerified(checked, { rootPath = "", raceWho = "operator", messageOut = true } = {}, opts = {}) {
  if (!checked?.key) return { ok: false, reason: "key missing" };
  const t0 = Date.now();
  const plain = checked.plain || "";
  const tHuman = Date.now();
  const machine = checked.machine || "";
  const tMachine = Date.now();
  return appendProofLog({
    key: checked.key,
    name: checked.name || "",
    kind: checked.kind || "",
    mime: checked.mime || checked.entry?.mime || "",
    codec: checked.codec || "",
    rootPath: rootPath || checked.entry?.name || checked.name || checked.key,
    storePath: "",
    rawHash: checked.rawHash || checked.entry?.rawHash || "",
    payloadHash: checked.entry?.payloadHash || "",
    rawBytes: checked.rawBytes || 0,
    payloadBytes: checked.entry?.payloadBytes || 0,
    phase: checked.verified ? "verified" : "verify-refused",
    verified: checked.verified === true,
    messageOut: messageOut && checked.verified === true,
    timing: {
      humanMs: Math.max(0, tHuman - t0),
      machineMs: Math.max(0, tMachine - tHuman),
      totalMs: Math.max(0, tMachine - t0),
      plainProof: plain.length > 0,
    },
    machine,
    plainPreview: String(plain).slice(0, 400),
    locations: (checked.locations || []).filter(isTxHash),
    claimRace: checked.verified === true,
    raceWho,
    source: "unwrap",
  }, opts);
}

export function formatProofLogTrailCard(opts = {}) {
  const listed = listProofLogEntries(opts);
  const lines = [];
  lines.push(PROOF_LOG_MAGIC + PROOF_LOG_VERSION + "|trail|count=" + listed.count + "§");
  lines.push("PROOF-OF-LOGS TRAIL  VITA:\\PROOFLOG\\");
  lines.push("creation-order rolling log · key + root path on every row");
  lines.push(
    "header rootCommit=" +
      (listed.header?.rootCommit ? shortHex(listed.header.rootCommit, 12) : "—") +
      "  seq=" +
      (listed.header?.lastSeq || 0) +
      "  verified=" +
      (listed.header?.verifiedCount || 0) +
      "  messageOut=" +
      (listed.header?.messageOutCount || 0),
  );
  lines.push("race slots 1–" + (listed.header?.raceSlots || RACE_SLOTS_DEFAULT) + " · multi-chain credit seats (locs empty until seal)");
  lines.push("neverInventHashes=true · privateKey=NO");
  lines.push("");
  if (!listed.entries.length) {
    lines.push("(empty — /vitafeed compress add then unwrap grows the trail)");
  }
  for (const e of listed.entries.slice(0, TRAIL_VISIBLE)) {
    const race = e.race?.slot != null ? " R" + e.race.slot : "";
    const seal = (e.locations || []).some(isTxHash) ? " SEALED" : "";
    lines.push(
      String(e.n).padStart(3) +
        "  " +
        String(e.phase || "?").padEnd(10) +
        "  " +
        (e.verified ? "V" : ".") +
        (e.messageOut ? "M" : ".") +
        race +
        seal +
        "  " +
        clip(e.name || e.key, 28),
    );
    lines.push("     key=" + e.key);
    lines.push("     root=" + e.rootPath);
  }
  if (listed.entries.length > TRAIL_VISIBLE) {
    lines.push("  … +" + (listed.entries.length - TRAIL_VISIBLE) + " older");
  }
  if (listed.tree?.length) {
    lines.push("");
    lines.push("— LOG-OF-LOGS TREE (from header) —");
    function printTree(node, indent) {
      lines.push(indent + "#" + node.n + " " + (node.label || "") + " [" + node.phase + "]");
      for (const c of node.children || []) printTree(c, indent + "  ");
    }
    for (const n of listed.tree.slice(0, 12)) printTree(n, "  ");
  }
  lines.push("");
  lines.push("TAP a file → Plain · Machine · Original · Unwrap · Race · Chains");
  lines.push("open: /vitafeed log <n>   trail: /vitafeed trail");
  return lines.join("\n");
}

export function formatProofLogEntryCard(entry, { tab = "open" } = {}) {
  if (!entry) return PROOF_LOG_MAGIC + " MISS";
  const lines = [];
  lines.push(PROOF_LOG_MAGIC + PROOF_LOG_VERSION + "|n=" + entry.n + "|tab=" + tab + "§");
  lines.push("TRAIL #" + entry.n + (entry.label ? "  [" + entry.label + "]" : ""));
  lines.push("phase=" + entry.phase + "  verified=" + (entry.verified ? "true" : "false") + "  messageOut=" + (entry.messageOut ? "true" : "false"));
  lines.push("key=" + entry.key);
  lines.push("root=" + entry.rootPath);
  if (entry.storePath) lines.push("store=" + entry.storePath);
  lines.push("name=" + entry.name + "  kind=" + entry.kind + "  codec=" + (entry.codec || "—"));
  lines.push("rawHash=" + shortHex(entry.rawHash, 12) + "  payloadHash=" + shortHex(entry.payloadHash, 12));
  if (entry.timing) {
    lines.push(
      "timing human=" +
        (entry.timing.humanMs ?? "—") +
        "ms machine=" +
        (entry.timing.machineMs ?? "—") +
        "ms · plainProof=" +
        (entry.timing.plainProof ? "YES" : "no"),
    );
  }
  const race = entry.race || {};
  lines.push(
    "race proof=#" +
      (race.slot ?? "—") +
      (race.proofedFirst ? " FIRST" : "") +
      "  inject=#" +
      (race.injectSlot ?? "—") +
      (race.injectedFirst ? " FIRST" : "") +
      "  who=" +
      (race.who || "—"),
  );
  if ((entry.chainCredits || []).length) {
    lines.push("chains (memory credit seats):");
    for (const c of entry.chainCredits.slice(0, 12)) {
      lines.push(
        "  " +
          c.chain.padEnd(12) +
          " " +
          c.status +
          (c.location ? " " + shortHex(c.location, 8) : " loc=—"),
      );
    }
  }
  lines.push("");
  if (tab === "plain" || tab === "open") {
    lines.push("— HUMAN (plain text) —");
    lines.push(entry.plainPreview || "(unwrap to fill plain — tap Unwrap)");
    lines.push("");
  }
  if (tab === "machine" || tab === "open") {
    lines.push("— MACHINE (hand off to agentic AI) —");
    lines.push(entry.machine || "COMPRESS key=" + entry.key);
    lines.push("");
  }
  if (tab === "original" || tab === "download") {
    lines.push("— ORIGINAL FORMAT —");
    lines.push("root=" + entry.rootPath);
    lines.push("download: /vita/proof-log/download?n=" + entry.n + "  (recovered bytes via key)");
    lines.push("mime=" + (entry.mime || "application/octet-stream") + "  rawBytes=" + (entry.rawBytes || 0));
    lines.push("");
  }
  if (tab === "race") {
    lines.push("— RACE / JUSTIFIED PROOF ORDER —");
    lines.push("Slots 1–3 (then 4+) mark who proofed or injected first.");
    lines.push("proof slot=" + (race.slot ?? "open") + "  inject slot=" + (race.injectSlot ?? "open"));
    lines.push("Surviving-chain credit: request more seats with /vitafeed log chains " + entry.n + " base,ethereum,…");
    lines.push("");
  }
  if ((entry.locations || []).length) {
    lines.push("— SEALED LOCS (never invented) —");
    for (const tx of entry.locations.slice(0, 6)) {
      lines.push("  " + shortHex(tx, 8) + "…  " + (MAINFRAME_ANCHORS.basescanTx || "https://basescan.org/tx/") + tx);
    }
  } else {
    lines.push("chain=availability — no sealed loc yet");
  }
  lines.push("");
  lines.push("tabs: Plain · Machine · Original · Unwrap · Race · Chains");
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

export function buildProofLogTrailKeyboard(opts = {}) {
  const listed = listProofLogEntries(opts);
  const rows = [
    [
      btn("📜 Trail", "/vitafeed trail"),
      btn("🗜 Compress", "/vitafeed compress"),
      btn("📥 Add", "/vitafeed compress add"),
    ],
  ];
  for (const e of listed.entries.slice(0, 10)) {
    const cmd = "/vitafeed log " + e.n;
    const label = ("#" + e.n + " " + clip(e.name || e.key, 22)).slice(0, 64);
    rows.push([btn(label, cmd)]);
  }
  rows.push([
    btn("📁 PROOFLOG", "/vitafeed dir PROOFLOG"),
    btn("📁 COMPRESS", "/vitafeed dir COMPRESS"),
    btn("🏠 Menu", "/vitafeed"),
  ]);
  return { inline_keyboard: rows };
}

/**
 * Tabs for one trail file — Plain / Machine / Original download /
 * Unwrap human / Race / Chains. Machine lane is the agentic handoff.
 */
export function buildProofLogEntryKeyboard(entry) {
  if (!entry?.n) return buildProofLogTrailKeyboard();
  const n = entry.n;
  const unwrapCmd =
    ("/vitafeed compress unwrap " + entry.key).length <= CALLBACK_DATA_MAX
      ? "/vitafeed compress unwrap " + entry.key
      : "/vitafeed compress unwrap";
  const dlHref = vitaPlayerHref(PROOF_LOG_PLAYER + "/download?n=" + n);
  const pageHref = vitaPlayerHref(PROOF_LOG_PLAYER + "?n=" + n);
  const injectCmd =
    entry.key && ("/vitafeed compress inject " + entry.key).length <= CALLBACK_DATA_MAX
      ? "/vitafeed compress inject " + entry.key
      : "/vitafeed compress inject";
  const rows = [
    [
      btn("👁 Plain", "/vitafeed log plain " + n),
      btn("🤖 Machine", "/vitafeed log machine " + n),
      btn("📄 Original", "/vitafeed log original " + n),
    ],
    [
      btn("🔓 Unwrap", unwrapCmd),
      btn("🏁 Race", "/vitafeed log race " + n),
      btn("⛓ Chains", "/vitafeed log chains " + n),
    ],
    [
      urlBtn("⬇ Download", dlHref),
      webAppBtn("▶ Log page", pageHref),
    ],
    [
      btn("📜 Trail", "/vitafeed trail"),
      btn("➡ Inject", injectCmd),
      btn("🏠 Menu", "/vitafeed"),
    ],
  ];
  for (const row of rows) {
    for (const b of row) {
      if (b.callback_data && b.callback_data.length > CALLBACK_DATA_MAX) {
        b.callback_data = "/vitafeed log " + n;
      }
    }
  }
  return { inline_keyboard: rows };
}

export function proofLogDirEntries(opts = {}) {
  const listed = listProofLogEntries(opts);
  return listed.entries.map((e) => ({
    n: e.n,
    name: (e.label ? e.label + "-" : "") + (e.name || e.key) + ".log",
    kind: "proof-log",
    bytes: e.rawBytes || 0,
    unlockName: String(e.n),
    mime: e.mime || "text/plain",
    english:
      "Trail #" +
      e.n +
      " " +
      (e.name || "") +
      " key=" +
      e.key +
      " root=" +
      e.rootPath +
      " verified=" +
      e.verified +
      " race=" +
      (e.race?.slot ?? "—"),
    machine:
      "PROOFLOG n=" +
      e.n +
      " key=" +
      e.key +
      " root=" +
      e.rootPath +
      " phase=" +
      e.phase +
      " messageOut=" +
      e.messageOut,
    locations: e.locations || [],
    readerKey: e.key,
    trueName: e.key,
    proofLogN: e.n,
  }));
}

/**
 * /vitafeed log|trail …
 */
export function handleProofLogRequest({ body = "" } = {}, opts = {}) {
  const trimmed = String(body || "").trim();
  if (!trimmed || /^(?:trail|ls|dir|list)$/i.test(trimmed)) {
    return {
      ok: true,
      phase: "log",
      reply: formatProofLogTrailCard(opts),
      keyboard: buildProofLogTrailKeyboard(opts),
      trail: listProofLogEntries(opts),
    };
  }

  const chainsMatch = trimmed.match(/^(?:chains|credit)\s+(\S+)(?:\s+(.+))?$/i);
  if (chainsMatch) {
    const sel = chainsMatch[1];
    const chainList = chainsMatch[2] || "base,ethereum,arbitrum,optimism,polygon";
    const out = requestProofLogChains(sel, chainList, opts);
    if (!out.ok) {
      return { ok: false, phase: "log", reply: out.reason || "miss", keyboard: buildProofLogTrailKeyboard(opts) };
    }
    return {
      ok: true,
      phase: "log",
      reply: formatProofLogEntryCard(out.entry, { tab: "race" }) + "\n\nMemory credit seats reserved (locs empty until seal).",
      keyboard: buildProofLogEntryKeyboard(out.entry),
      entry: out.entry,
    };
  }

  const labelMatch = trimmed.match(/^(?:label|tag)\s+(\S+)\s+(.+)$/i);
  if (labelMatch) {
    const out = labelProofLog(labelMatch[1], labelMatch[2].trim(), {}, opts);
    if (!out.ok) return { ok: false, phase: "log", reply: out.reason, keyboard: buildProofLogTrailKeyboard(opts) };
    return {
      ok: true,
      phase: "log",
      reply: formatProofLogEntryCard(out.entry, { tab: "open" }),
      keyboard: buildProofLogEntryKeyboard(out.entry),
      entry: out.entry,
    };
  }

  const tabMatch = trimmed.match(/^(plain|machine|original|download|race|open|file)\s+(\S+)$/i);
  if (tabMatch) {
    const tab = tabMatch[1].toLowerCase() === "file" ? "open" : tabMatch[1].toLowerCase();
    const found = getProofLogEntry(tabMatch[2], opts);
    if (!found.ok) {
      return { ok: false, phase: "log", reply: found.reason, keyboard: buildProofLogTrailKeyboard(opts) };
    }
    return {
      ok: true,
      phase: "log",
      tab,
      reply: formatProofLogEntryCard(found.entry, { tab }),
      keyboard: buildProofLogEntryKeyboard(found.entry),
      entry: found.entry,
    };
  }

  const found = getProofLogEntry(trimmed, opts);
  if (!found.ok) {
    return {
      ok: false,
      phase: "log",
      reply: (found.reason || "miss") + "\n\n" + formatProofLogTrailCard(opts),
      keyboard: buildProofLogTrailKeyboard(opts),
    };
  }
  return {
    ok: true,
    phase: "log",
    tab: "open",
    reply: formatProofLogEntryCard(found.entry, { tab: "open" }),
    keyboard: buildProofLogEntryKeyboard(found.entry),
    entry: found.entry,
  };
}

export function publicProofLogState(opts = {}) {
  const listed = listProofLogEntries(opts);
  return {
    id: PROOF_LOG_ID,
    label: PROOF_LOG_LABEL,
    player: PROOF_LOG_PLAYER,
    neverInventHashes: true,
    header: listed.header,
    count: listed.count,
    tree: listed.tree,
    entries: listed.entries.map((e) => ({
      n: e.n,
      name: e.name,
      key: e.key,
      rootPath: e.rootPath,
      phase: e.phase,
      verified: e.verified === true,
      messageOut: e.messageOut === true,
      race: e.race,
      chainCredits: e.chainCredits,
      locations: e.locations || [],
      label: e.label || "",
    })),
  };
}
