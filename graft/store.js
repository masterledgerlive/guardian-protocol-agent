/**
 * GRAFT lossless store — CAS artifacts, tree snapshots, piggy, last-root.
 * Isolated: no vita/, agent.js, piggy-bank, or guardian-v4 imports.
 */

import fs from "node:fs";
import path from "node:path";
import { casDir, ledgerPath, stateDir, thoughtsDir } from "./config.js";
import { formatShortTag, merkleProof, merkleRoot, sha256bytes, sha256hex, shortId } from "./hash.js";

export const ARTIFACT_FILED = "filed";
export const ARTIFACT_ACTIVE = "active";
export const ARTIFACT_THOUGHT = "thought";
export const ARTIFACT_SURVIVED = "survived";
export const ARTIFACT_DIED = "died";
export const ARTIFACT_HARVEST = "harvest-candidate";

export const DEFAULT_NODES = [
  { nodeId: "graft-root", title: "GRAFT", description: "Prompt-trial nursery (not VITA)", parentId: null, tags: ["graft"] },
  { nodeId: "prompts", title: "PROMPTS", description: "Incoming architecture dumps", parentId: "graft-root", tags: ["file", "prompt"] },
  { nodeId: "daisy", title: "DAISY", description: "Unified agentic stack offshoot (L0–L4 map)", parentId: "graft-root", tags: ["daisy", "stack"] },
  { nodeId: "daisy-l0", title: "L0-COMPUTE", description: "Paid think cycles as local coretime", parentId: "daisy", tags: ["l0", "coretime"] },
  { nodeId: "daisy-l1", title: "L1-ECONOMY", description: "GRAFT piggy — throw money, never V3 piggy", parentId: "daisy", tags: ["l1", "money"] },
  { nodeId: "daisy-l2", title: "L2-COMMERCE", description: "Filed ideas may hire other filed ideas later", parentId: "daisy", tags: ["l2", "rfc"] },
  { nodeId: "daisy-l3", title: "L3-MIND", description: "Thought traces + lossless CAS memory", parentId: "daisy", tags: ["l3", "memory"] },
  { nodeId: "daisy-l4", title: "L4-SENSES", description: "Telegram / CLI inlet", parentId: "daisy", tags: ["l4", "telegram"] },
  { nodeId: "archive", title: "ARCHIVE", description: "Raw CAS blobs — never deleted", parentId: "graft-root", tags: ["lossless"] },
  { nodeId: "survival", title: "SURVIVAL", description: "Human survive / die / harvest marks", parentId: "graft-root", tags: ["survive"] },
];

function emptyLedger() {
  return {
    name: "GRAFT",
    version: 1,
    seeded: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastRoot: merkleRoot([]),
    snapSeq: 0,
    piggyEth: 0,
    piggyLedger: [],
    artifacts: {},
    nodes: {},
    snapshots: {},
    directory: {},
    thoughts: [],
    lastArtifactId: null,
    lastActivatedId: null,
    lastThoughtId: null,
    txHashes: [], // real hashes only — never invented
  };
}

function writeJsonAtomic(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, file);
}

export function ensureStore() {
  fs.mkdirSync(stateDir(), { recursive: true });
  fs.mkdirSync(casDir(), { recursive: true });
  fs.mkdirSync(thoughtsDir(), { recursive: true });
  if (!fs.existsSync(ledgerPath())) writeJsonAtomic(ledgerPath(), emptyLedger());
  const ledger = readLedger();
  if (!Object.keys(ledger.nodes || {}).length) {
    for (const spec of DEFAULT_NODES) upsertNode(ledger, spec);
    persistLedger(ledger);
  }
  return ledger;
}

export function readLedger() {
  ensureParents();
  if (!fs.existsSync(ledgerPath())) return emptyLedger();
  const raw = JSON.parse(fs.readFileSync(ledgerPath(), "utf8"));
  return { ...emptyLedger(), ...raw };
}

function ensureParents() {
  fs.mkdirSync(stateDir(), { recursive: true });
  fs.mkdirSync(casDir(), { recursive: true });
  fs.mkdirSync(thoughtsDir(), { recursive: true });
}

export function persistLedger(ledger) {
  ledger.updatedAt = new Date().toISOString();
  ledger.lastRoot = computeLastRoot(ledger);
  writeJsonAtomic(ledgerPath(), ledger);
  return ledger;
}

export function leafHashes(ledger) {
  const arts = Object.keys(ledger.artifacts || {}).sort();
  const snaps = Object.keys(ledger.snapshots || {}).sort();
  return [...arts, ...snaps];
}

export function computeLastRoot(ledger) {
  return merkleRoot(leafHashes(ledger));
}

function upsertNode(ledger, spec) {
  const existing = ledger.nodes[spec.nodeId];
  const node = existing || {
    nodeId: spec.nodeId,
    title: spec.title,
    description: spec.description || "",
    parentId: spec.parentId,
    children: [],
    artifacts: [],
    tags: spec.tags || [],
    version: 0,
    snapshotIds: [],
    confidence: 0.5,
  };
  node.title = spec.title || node.title;
  node.description = spec.description ?? node.description;
  node.parentId = spec.parentId ?? node.parentId;
  node.tags = spec.tags || node.tags;
  ledger.nodes[spec.nodeId] = node;
  if (spec.parentId && ledger.nodes[spec.parentId]) {
    const parent = ledger.nodes[spec.parentId];
    if (!parent.children.includes(spec.nodeId)) parent.children.push(spec.nodeId);
  }
  return node;
}

export function casPathFor(id) {
  return path.join(casDir(), `${id}.txt`);
}

export function ingestRaw(text, {
  title = "untitled",
  source = "insert",
  mimeType = "text/plain",
  provenance = {},
  nodeIds = ["prompts"],
  derivedFrom = [],
  status = ARTIFACT_FILED,
} = {}, ledger = readLedger()) {
  const buf = Buffer.from(String(text ?? ""), "utf8");
  const id = sha256bytes(buf);
  const existing = ledger.artifacts[id];
  if (existing) {
    existing.duplicateCount = (existing.duplicateCount || 1) + 1;
    persistLedger(ledger);
    return { artifact: existing, duplicate: true, ledger };
  }
  fs.writeFileSync(casPathFor(id), buf);
  const short = shortId(id);
  const artifact = {
    id,
    shortId: short,
    title: String(title || "untitled").slice(0, 160),
    source,
    mimeType,
    timestamp: new Date().toISOString(),
    bytes: buf.length,
    status,
    active: false,
    nodeIds: [...new Set(nodeIds.filter(Boolean))],
    derivedFrom: [...derivedFrom],
    provenance: { origin: source, ...provenance },
    duplicateCount: 1,
    tag: null,
    loc: null,
  };
  ledger.artifacts[id] = artifact;
  for (const nid of artifact.nodeIds) {
    if (!ledger.nodes[nid]) continue;
    if (!ledger.nodes[nid].artifacts.includes(id)) ledger.nodes[nid].artifacts.push(id);
  }
  snapshotNodes(ledger, artifact.nodeIds);
  artifact.tag = formatShortTag({
    short,
    root: computeLastRoot(ledger),
    snap: ledger.snapSeq,
  });
  ledger.directory[short] = {
    artifactId: id,
    nodeIds: artifact.nodeIds,
    loc: null,
    tag: artifact.tag,
    lastRoot: computeLastRoot(ledger),
    active: false,
    title: artifact.title,
  };
  if (source !== "think") ledger.lastArtifactId = id;
  persistLedger(ledger);
  return { artifact, duplicate: false, ledger };
}

function snapshotNodes(ledger, nodeIds) {
  for (const nid of nodeIds || []) {
    const node = ledger.nodes[nid];
    if (!node) continue;
    ledger.snapSeq += 1;
    const snapshotId = sha256hex(`snap:${nid}:${ledger.snapSeq}:${node.artifacts.join(",")}`);
    const snap = {
      snapshotId,
      nodeId: nid,
      seq: ledger.snapSeq,
      parentSnapshotId: node.snapshotIds[node.snapshotIds.length - 1] || null,
      artifactIds: [...node.artifacts],
      timestamp: new Date().toISOString(),
    };
    ledger.snapshots[snapshotId] = snap;
    node.snapshotIds.push(snapshotId);
    node.version += 1;
  }
}

export function findArtifact(ref, ledger = readLedger()) {
  if (ref == null || String(ref).trim() === "" || String(ref).toLowerCase() === "last") {
    const activated = ledger.lastActivatedId && ledger.artifacts[ledger.lastActivatedId];
    if (activated?.active) return activated;
    const id = ledger.lastArtifactId;
    return id ? ledger.artifacts[id] || null : null;
  }
  const key = String(ref).trim().toLowerCase().replace(/^0x/, "");
  if (ledger.artifacts[key]) return ledger.artifacts[key];
  const arts = Object.values(ledger.artifacts);
  const byShort = arts.find((a) => a.shortId === key || a.id.startsWith(key));
  if (byShort) return byShort;
  const byTitle = arts.find((a) => String(a.title).toLowerCase() === key
    || String(a.title).toLowerCase().includes(key));
  return byTitle || null;
}

export function listArtifacts(ledger = readLedger()) {
  return Object.values(ledger.artifacts || {}).sort((a, b) =>
    String(a.timestamp).localeCompare(String(b.timestamp)));
}

export function setActive(ref, active, ledger = readLedger()) {
  const artifact = findArtifact(ref, ledger);
  if (!artifact) return { ok: false, error: "not-found", ref };
  artifact.active = !!active;
  if (active) {
    ledger.lastActivatedId = artifact.id;
    if (artifact.status === ARTIFACT_FILED || artifact.status === ARTIFACT_THOUGHT) {
      artifact.status = ARTIFACT_ACTIVE;
    }
  } else if (artifact.status === ARTIFACT_ACTIVE) {
    artifact.status = ARTIFACT_FILED;
  }
  if (ledger.directory[artifact.shortId]) {
    ledger.directory[artifact.shortId].active = artifact.active;
  }
  persistLedger(ledger);
  return { ok: true, artifact, ledger };
}

export function markStatus(ref, status, ledger = readLedger()) {
  const artifact = findArtifact(ref, ledger);
  if (!artifact) return { ok: false, error: "not-found", ref };
  artifact.status = status;
  if (status === ARTIFACT_DIED) artifact.active = false;
  if (status === ARTIFACT_ACTIVE) artifact.active = true;
  if (ledger.directory[artifact.shortId]) {
    ledger.directory[artifact.shortId].active = artifact.active;
    ledger.directory[artifact.shortId].status = status;
  }
  persistLedger(ledger);
  return { ok: true, artifact, ledger };
}

export function fundPiggy(eth, note = "fund", ledger = readLedger()) {
  const n = Number(eth);
  if (!Number.isFinite(n) || n <= 0) {
    return { ok: false, error: "bad-amount", eth };
  }
  ledger.piggyEth = (Number(ledger.piggyEth) || 0) + n;
  ledger.piggyLedger.push({
    ts: new Date().toISOString(),
    kind: "fund",
    eth: n,
    note: String(note || "fund"),
    piggyAfter: ledger.piggyEth,
  });
  persistLedger(ledger);
  return { ok: true, credited: n, piggyEth: ledger.piggyEth, ledger };
}

export function debitPiggy(eth, note = "think", ideaId = null, ledger = readLedger()) {
  const n = Number(eth);
  const have = Number(ledger.piggyEth) || 0;
  if (!Number.isFinite(n) || n < 0) return { ok: false, error: "bad-amount", eth };
  if (n > have + 1e-18) {
    return { ok: false, error: "insufficient", need: n, have };
  }
  ledger.piggyEth = have - n;
  ledger.piggyLedger.push({
    ts: new Date().toISOString(),
    kind: "think",
    eth: n,
    note: String(note || "think"),
    ideaId,
    piggyAfter: ledger.piggyEth,
  });
  persistLedger(ledger);
  return { ok: true, spent: n, piggyEth: ledger.piggyEth, ledger };
}

export function appendThought(thought, ledger = readLedger()) {
  const id = thought.thoughtId || sha256hex(`thought:${Date.now()}:${thought.artifactId || ""}`);
  const record = { ...thought, thoughtId: id };
  ledger.thoughts.push({
    thoughtId: id,
    artifactId: record.artifactId,
    ts: record.ts || new Date().toISOString(),
    costEth: record.costEth || 0,
    survival: record.survival ?? null,
    steps: (record.steps || []).length,
  });
  ledger.lastThoughtId = id;
  const file = path.join(thoughtsDir(), `${id}.json`);
  writeJsonAtomic(file, record);
  persistLedger(ledger);
  return record;
}

export function readThought(thoughtId) {
  const file = path.join(thoughtsDir(), `${thoughtId}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function thoughtsFor(artifactId, ledger = readLedger()) {
  return (ledger.thoughts || []).filter((t) => t.artifactId === artifactId);
}

export function rawBlob(artifact) {
  if (!artifact?.id) return "";
  const p = casPathFor(artifact.id);
  if (!fs.existsSync(p)) return "";
  return fs.readFileSync(p, "utf8");
}

export function inclusionProof(artifactId, ledger = readLedger()) {
  return merkleProof(leafHashes(ledger), artifactId);
}

export function treeView(ledger = readLedger(), nodeId = "graft-root", depth = 0) {
  const node = ledger.nodes[nodeId];
  if (!node) return [];
  const arts = (node.artifacts || []).map((id) => ledger.artifacts[id]).filter(Boolean);
  const line = {
    depth,
    nodeId: node.nodeId,
    title: node.title,
    artifacts: arts.map((a) => ({
      shortId: a.shortId,
      title: a.title,
      status: a.status,
      active: !!a.active,
    })),
  };
  const out = [line];
  for (const child of node.children || []) out.push(...treeView(ledger, child, depth + 1));
  return out;
}

export function bag(ledger = readLedger()) {
  const arts = listArtifacts(ledger);
  return {
    name: "GRAFT",
    piggyEth: Number(ledger.piggyEth) || 0,
    lastRoot: ledger.lastRoot,
    snapSeq: ledger.snapSeq,
    filed: arts.filter((a) => !a.active && a.status !== ARTIFACT_DIED).length,
    active: arts.filter((a) => a.active).length,
    survived: arts.filter((a) => a.status === ARTIFACT_SURVIVED).length,
    died: arts.filter((a) => a.status === ARTIFACT_DIED).length,
    harvest: arts.filter((a) => a.status === ARTIFACT_HARVEST).length,
    thoughts: (ledger.thoughts || []).length,
    artifacts: arts.length,
    txHashes: [...(ledger.txHashes || [])],
  };
}
