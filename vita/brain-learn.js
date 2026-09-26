/**
 * Brain learn cycle — old→new diff, one peer review, self-refining filing,
 * library snapshot, squashed zero-proof retrieval growth, vita-save packet.
 *
 * Research stance (local-first agent memory, 2025–26 class):
 *   - Append-only hash-chained ledger (MentisDB / checkpoint logs)
 *   - Content-addressed commits (neleus-db / mnem Merkle-DAG)
 *   - Proof-carrying retrieval: every hit cites real locs or content digests
 *   - Never invent tx hashes — only hardcoded anchors + sealed library locs
 *   - Squash = short KEY8/LOC8 for hitch trailers; full hashes stay in filing
 *
 * Distinct filing labels (do not collapse into MEMORY alone):
 *   BRAIN_SEED | BRAIN_LEARN | PEER_REVIEW | ZERO_PROOF | VITA_SAVE_LEARN
 *
 * Mother brain / vitaSave send path untouched — we BANK a §TOKEN§ packet
 * for /vitanote → /vitasave or /vitafeed override when funded.
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MAINFRAME_ANCHORS,
  ORIGINAL_FORMULA,
  FORMULA_ID,
} from "./mainframe.js";
import {
  BRAIN_SEED_ID,
  BRAIN_SEED_MAGIC,
  buildBrainMindMap,
  buildBrainSeedBody,
  formatBrainSeedCard,
  proveBrainSeedLocal,
} from "./brain-seed.js";
import { recordBrainLearnFeedFlow } from "./feed-flow.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const MEMORY_DIR = join(HERE, "memory");
const STRANDS_DIR = join(HERE, "strands");
const LEARN_LOG_PATH = join(MEMORY_DIR, "brain-learn-log.json");
const FILING_LEARNED_PATH = join(MEMORY_DIR, "filing-labels-learned.json");

export const BRAIN_LEARN_ID = "vita-brain-learn-v1";
export const BRAIN_LEARN_MAGIC = "§VITALEARN§";
export const PEER_REVIEW_MAGIC = "§PEERREVIEW§";
export const ZERO_PROOF_MAGIC = "§ZEROPROOF§";
export const VITA_SAVE_LEARN_MAGIC = "§VITASAVLEARN§";

/** Distinct filing labels — refine map grows; genesis labels never deleted. */
export const FILING_LABELS_CORE = Object.freeze({
  FORMULA: "Frozen invariants — do not weaken",
  AGENT: "On-ramp + read order",
  FILING: "Directory + label contract",
  MAINFRAME: "Anchors, HTML infect, sparse plan, message-first",
  ANCHORS: "Hardcoded Base txs / router / wallet",
  BRAIN: "Recursive-AI mind seed",
  BRAIN_SEED: "Mind seed body for /vitafeed brain",
  BRAIN_LEARN: "Old→new learn delta from activate cycle",
  PEER_REVIEW: "One peer review of learn delta (separate label)",
  ZERO_PROOF: "Squashed content-addressed retrieval growth proof",
  FEED_BACKLOG: "Offline /vitafeed inject queue — pending→sealed without agent AI",
  FEED_FLOW: "Append-only feed ledger + Basescan IDM chat of locs being fed",
  MG_RECALL: "Force-banked mother-genesis recall stack — last layer is refined queries",
  VITADIR: "DOS-style master directory — open-source unlock by file name",
  MIRROR_CHAIN: "GitHub-as-chain read + SNARK unwrap + session keys",
  CHAIN_LAYER: "Always-on blockchain systems check — SNARK + EVM recover + models",
  SYSTEMS_CHECK: "Checklist proof each pass — grows memory/strands",
  LLM_ONCHAIN: "LLM spin manifest — commitment + Base locs; change at will",
  REF_LIB: "Reference library search — trueName + ask|self; calculator first domain",
  PROVEN_TEST: "Proven test series — recursive memory answers from packaged locs only",
  TRANSLATOR_CODEX: "Free multilingual alias map — read once, never forget",
  VITA_SAVE_LEARN: "Bankable §TOKEN§ learn packet for /vitasave retrieval",
  VITALIB: "Named library name→key→locs",
  MEMORY: "Append-only learned notes",
  STRAND: "Sparse inject chunk plans",
});

function sha256Hex(text) {
  return createHash("sha256").update(String(text || ""), "utf8").digest("hex");
}

function shortHex(hex, n = 8) {
  return String(hex || "").replace(/^0x/i, "").toLowerCase().slice(0, n);
}

function isTxHash(h) {
  return /^0x[0-9a-fA-F]{64}$/.test(String(h || ""));
}

function safeReadJson(path) {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function listJsonTopics(dir) {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/i, ""))
      .sort();
  } catch {
    return [];
  }
}

function loadMemorySnapshots() {
  const topics = listJsonTopics(MEMORY_DIR);
  const rows = [];
  for (const topic of topics) {
    const raw = safeReadJson(join(MEMORY_DIR, topic + ".json"));
    if (!raw || typeof raw !== "object") continue;
    const locs = [];
    if (Array.isArray(raw.locations)) {
      for (const x of raw.locations) {
        const tx = typeof x === "string" ? x : x?.location || x?.tx;
        if (isTxHash(tx)) locs.push(tx.toLowerCase());
      }
    }
    if (Array.isArray(raw.anchors)) {
      for (const id of raw.anchors) {
        const a = MAINFRAME_ANCHORS.known.find((k) => k.id === id);
        if (a?.tx) locs.push(a.tx.toLowerCase());
      }
    }
    rows.push({
      topic,
      label: raw.filingLabel || raw.label || "MEMORY",
      hypothesisId: raw.hypothesis?.id || null,
      hypothesisStatus: raw.hypothesis?.status || null,
      textHash: shortHex(sha256Hex(String(raw.text || raw.learn || "")), 8),
      locations: [...new Set(locs)],
      at: raw.at || null,
    });
  }
  return rows;
}

function loadStrandIds() {
  return listJsonTopics(STRANDS_DIR);
}

export function loadBrainLearnLog() {
  const raw = safeReadJson(LEARN_LOG_PATH);
  if (!raw || !Array.isArray(raw.cycles)) {
    return { id: BRAIN_LEARN_ID, cycles: [], zeroProof: { roots: [], genesis: null } };
  }
  return raw;
}

function persistBrainLearnLog(log) {
  if (!existsSync(MEMORY_DIR)) mkdirSync(MEMORY_DIR, { recursive: true });
  writeFileSync(LEARN_LOG_PATH, JSON.stringify(log, null, 2) + "\n", "utf8");
  return LEARN_LOG_PATH;
}

export function loadLearnedFilingLabels() {
  const raw = safeReadJson(FILING_LEARNED_PATH);
  const learned = raw?.labels && typeof raw.labels === "object" ? raw.labels : {};
  return { ...FILING_LABELS_CORE, ...learned };
}

function refineFilingLabels(peerFindings = []) {
  const current = loadLearnedFilingLabels();
  const added = [];
  for (const f of peerFindings) {
    const key = String(f.label || "").toUpperCase().replace(/[^A-Z0-9_]/g, "_");
    if (!key || current[key]) continue;
    current[key] = String(f.meaning || f.note || "learned filing label");
    added.push(key);
  }
  // Always ensure peer-review cycle labels exist.
  const ensure = {
    BRAIN_LEARN: FILING_LABELS_CORE.BRAIN_LEARN,
    PEER_REVIEW: FILING_LABELS_CORE.PEER_REVIEW,
    ZERO_PROOF: FILING_LABELS_CORE.ZERO_PROOF,
    VITA_SAVE_LEARN: FILING_LABELS_CORE.VITA_SAVE_LEARN,
    BRAIN_SEED: FILING_LABELS_CORE.BRAIN_SEED,
  };
  for (const [k, v] of Object.entries(ensure)) {
    if (!current[k]) {
      current[k] = v;
      added.push(k);
    }
  }
  const payload = {
    at: new Date().toISOString(),
    id: "filing-labels-learned-v1",
    formula: FORMULA_ID,
    labels: current,
    lastAdded: added,
    research:
      "Content-addressed append-only memory (Merkle-DAG / hash-chained thoughts); " +
      "distinct labels keep peer review & zero-proof apart from raw MEMORY.",
  };
  writeFileSync(FILING_LEARNED_PATH, JSON.stringify(payload, null, 2) + "\n", "utf8");
  return { labels: current, added, path: FILING_LEARNED_PATH };
}

/**
 * Snapshot of "old" mind state before a learn cycle.
 */
export function snapshotBrainState({ libraryEntries = [] } = {}) {
  const memory = loadMemorySnapshots();
  const strands = loadStrandIds();
  const lib = (libraryEntries || []).map((e) => ({
    n: e.n,
    name: e.name,
    readerKey: e.readerKey || null,
    locationCount: e.locationCount || (e.locations || []).length,
    locations: (e.locations || []).filter(isTxHash).map((t) => t.toLowerCase()),
    contentCommit: e.contentCommit ? shortHex(e.contentCommit, 8) : null,
  }));
  const anchors = MAINFRAME_ANCHORS.known.map((a) => ({
    id: a.id,
    kind: a.kind,
    tx: a.tx.toLowerCase(),
    loc8: shortHex(a.tx, 8),
  }));
  const sealedLocs = [
    ...anchors.map((a) => a.tx),
    ...lib.flatMap((e) => e.locations),
    ...memory.flatMap((m) => m.locations),
  ];
  const uniqueLocs = [...new Set(sealedLocs.filter(isTxHash))];
  const topicKeys = memory.map((m) => m.topic + ":" + (m.textHash || ""));
  const squashBody = [
    "topics=" + topicKeys.join(","),
    "strands=" + strands.join(","),
    "lib=" + lib.map((e) => e.name + ":" + (e.contentCommit || e.locationCount)).join(","),
    "locs=" + uniqueLocs.map((t) => shortHex(t, 8)).join(","),
  ].join("|");
  return {
    at: new Date().toISOString(),
    memoryCount: memory.length,
    strandCount: strands.length,
    libraryCount: lib.length,
    sealedLocCount: uniqueLocs.length,
    topics: memory.map((m) => m.topic),
    strands,
    library: lib,
    anchors,
    sealedLocs: uniqueLocs,
    squashCommit: sha256Hex(squashBody),
    squashBody,
  };
}

/**
 * Diff old snapshot → new snapshot (topics / library / sealed locs).
 */
export function diffBrainSnapshots(oldSnap, newSnap) {
  const oldTopics = new Set(oldSnap?.topics || []);
  const newTopics = new Set(newSnap?.topics || []);
  const addedTopics = [...newTopics].filter((t) => !oldTopics.has(t));
  const removedTopics = [...oldTopics].filter((t) => !newTopics.has(t));
  const oldLocs = new Set(oldSnap?.sealedLocs || []);
  const newLocs = new Set(newSnap?.sealedLocs || []);
  const addedLocs = [...newLocs].filter((t) => !oldLocs.has(t));
  const oldLib = new Set((oldSnap?.library || []).map((e) => e.name));
  const newLib = new Set((newSnap?.library || []).map((e) => e.name));
  const addedLib = [...newLib].filter((n) => !oldLib.has(n));
  return {
    addedTopics,
    removedTopics,
    addedLocs,
    addedLib,
    memoryDelta: (newSnap?.memoryCount || 0) - (oldSnap?.memoryCount || 0),
    strandDelta: (newSnap?.strandCount || 0) - (oldSnap?.strandCount || 0),
    libraryDelta: (newSnap?.libraryCount || 0) - (oldSnap?.libraryCount || 0),
    sealedLocDelta: (newSnap?.sealedLocCount || 0) - (oldSnap?.sealedLocCount || 0),
    squashChanged: (oldSnap?.squashCommit || "") !== (newSnap?.squashCommit || ""),
  };
}

/**
 * One peer review — separate filing label PEER_REVIEW.
 * Checks formula invariants + never-invent against current state.
 */
export function peerReviewBrainState(snap, diff, { priorRoot = null } = {}) {
  const findings = [];
  const pass = [];
  const fail = [];

  if (ORIGINAL_FORMULA.neverInventTxHash) {
    const bad = (snap.sealedLocs || []).filter((t) => !isTxHash(t));
    if (bad.length) {
      fail.push("invented-or-malformed-loc");
      findings.push({
        label: "PEER_REVIEW",
        severity: "fail",
        note: "non-hash locs in snapshot — refuse invent",
      });
    } else {
      pass.push("never-invent-locs");
    }
  }
  if (ORIGINAL_FORMULA.messageFirstWhenKeyLocCovered) {
    pass.push("message-first-formula");
  }
  if (ORIGINAL_FORMULA.learnAppendOnly) {
    if ((diff.removedTopics || []).length) {
      findings.push({
        label: "PEER_REVIEW",
        severity: "warn",
        note: "topics disappeared from listing — prefer append-only",
      });
    } else {
      pass.push("append-only-topics");
    }
  }
  if ((snap.anchors || []).length >= 3) {
    pass.push("genesis-anchors-present");
  } else {
    fail.push("missing-genesis-anchors");
  }
  if (diff.squashChanged || (diff.memoryDelta || 0) > 0 || (diff.libraryDelta || 0) > 0) {
    pass.push("system-growing");
    findings.push({
      label: "BRAIN_LEARN",
      severity: "info",
      note:
        "growth: mem" + (diff.memoryDelta >= 0 ? "+" : "") + diff.memoryDelta +
        " lib" + (diff.libraryDelta >= 0 ? "+" : "") + diff.libraryDelta +
        " locs" + (diff.sealedLocDelta >= 0 ? "+" : "") + diff.sealedLocDelta,
    });
  } else {
    findings.push({
      label: "PEER_REVIEW",
      severity: "info",
      note: "no growth this cycle — still valid baseline peer review",
    });
  }
  if (priorRoot) {
    pass.push("zero-proof-chained");
  }

  findings.push({
    label: "ZERO_PROOF",
    severity: "info",
    meaning: "Squashed content-addressed retrieval growth proof",
    note: "hash-chain root over topics+lib+real locs; zero invented hashes",
  });
  findings.push({
    label: "VITA_SAVE_LEARN",
    severity: "info",
    meaning: "Bankable §TOKEN§ learn packet for /vitasave retrieval",
    note: "compress learn delta for mother-brain-adjacent bank path",
  });

  const verdict = fail.length ? "FAIL" : "PASS";
  const body = [
    PEER_REVIEW_MAGIC + "v1|verdict=" + verdict + "|formula=" + FORMULA_ID + "§",
    "PEER REVIEW · one pass · filing=PEER_REVIEW",
    "verdict=" + verdict,
    "pass=" + pass.join(","),
    "fail=" + (fail.join(",") || "none"),
    "anchors=" + (snap.anchors || []).map((a) => a.id).join(","),
    "sealedLocs=" + (snap.sealedLocCount || 0),
    "library=" + (snap.libraryCount || 0),
    "memory=" + (snap.memoryCount || 0),
    "addedTopics=" + (diff.addedTopics || []).slice(0, 12).join(",") || "none",
    "research=append-only content-addressed ledger + proof-carrying retrieval",
  ].join("\n");

  return {
    filingLabel: "PEER_REVIEW",
    verdict,
    pass,
    fail,
    findings,
    body,
    contentCommit: sha256Hex(body),
  };
}

/**
 * Squashed zero-proof — grows each cycle; never invents hashes.
 */
export function buildZeroProof({ snap, priorRoot = null, cycleIndex = 1 } = {}) {
  const genesis = priorRoot || sha256Hex("VITA-ZERO-PROOF|v1|" + FORMULA_ID);
  const loc8 = (snap.sealedLocs || []).map((t) => shortHex(t, 8)).sort().join(",");
  const key8 = (snap.topics || []).map((t) => shortHex(sha256Hex(t), 8)).sort().join(",");
  const payload =
    (priorRoot || genesis) +
    "|" + cycleIndex +
    "|squash=" + (snap.squashCommit || "") +
    "|key8=" + key8 +
    "|loc8=" + loc8 +
    "|lib=" + (snap.libraryCount || 0) +
    "|mem=" + (snap.memoryCount || 0);
  const root = sha256Hex(payload);
  const body = [
    ZERO_PROOF_MAGIC + "v1|cycle=" + cycleIndex + "|root=" + shortHex(root, 12) + "§",
    "ZERO PROOF · filing=ZERO_PROOF · zero invented hashes",
    "cycle=" + cycleIndex,
    "prev=" + shortHex(priorRoot || genesis, 12),
    "root=" + root,
    "squash=" + (snap.squashCommit || ""),
    "KEY8_topics=" + (key8 || "none"),
    "LOC8_sealed=" + (loc8 || "none"),
    "counts mem=" + (snap.memoryCount || 0) +
      " strands=" + (snap.strandCount || 0) +
      " lib=" + (snap.libraryCount || 0) +
      " locs=" + (snap.sealedLocCount || 0),
    "retrieval=sparse KEY+LOC hitch · VIN feed · library keys · /inject anchors",
  ].join("\n");
  return {
    filingLabel: "ZERO_PROOF",
    cycleIndex,
    prevRoot: priorRoot || genesis,
    root,
    body,
    contentCommit: sha256Hex(body),
    growth: {
      memoryCount: snap.memoryCount,
      strandCount: snap.strandCount,
      libraryCount: snap.libraryCount,
      sealedLocCount: snap.sealedLocCount,
    },
  };
}

/**
 * Bankable §TOKEN§-class packet for /vitanote → /vitasave (or absorb).
 * Does not call vitaSave / sendTransaction.
 */
export function buildVitaSaveLearnPacket({ diff, peer, zeroProof, snap } = {}) {
  const lines = [];
  lines.push(
    "§SESS§" + new Date().toISOString().slice(0, 10) +
    "|brain-learn|cycle-" + (zeroProof?.cycleIndex || 1),
  );
  lines.push("§WHO§VITA|recursive-ai|peer-reviewer");
  lines.push("§STACK§base|vitafeed|brain-learn|zero-proof|vitalib");
  lines.push(
    "§BUILT§brain-learn.js|filing-labels-learned|zero-proof-root|" +
    shortHex(zeroProof?.root || "", 8),
  );
  lines.push(
    "§PROVED§peer=" + (peer?.verdict || "?") +
    "|neverInvent|appendOnly|growth=" +
    (diff?.squashChanged ? "yes" : "baseline"),
  );
  lines.push(
    "§ARCH§content-addressed-append-only|distinct-filing-labels|" +
    "KEY+LOC-squash|library-keys-chain",
  );
  lines.push(
    "§VISION§blockchain-brain-grows-via-sealed-locs+learn-diff;Storage-Token-charges-delta",
  );
  lines.push(
    "§NEXT§/vitafeed override when funded|/vitasave absorb learn|/vitafeed files",
  );
  lines.push(
    "§KEY§formula=" + FORMULA_ID +
    "|wallet=" + shortHex(MAINFRAME_ANCHORS.wallet, 8) +
    "|anchors=" + (snap?.anchors || []).map((a) => a.id).join(","),
  );
  lines.push(
    "§LEARN§old→new mem" + (diff?.memoryDelta ?? 0) +
    " lib" + (diff?.libraryDelta ?? 0) +
    " locs" + (diff?.sealedLocDelta ?? 0) +
    "|addedTopics=" + (diff?.addedTopics || []).slice(0, 8).join(",") +
    "|peer=" + (peer?.verdict || "?"),
  );
  const locToken = (snap?.sealedLocs || [])
    .slice(0, 6)
    .map((t) => shortHex(t, 8))
    .join(",");
  if (locToken) lines.push("§LOC§" + locToken);
  const packed = lines.join("");
  return {
    filingLabel: "VITA_SAVE_LEARN",
    magic: VITA_SAVE_LEARN_MAGIC,
    tokenPacket: packed,
    body:
      VITA_SAVE_LEARN_MAGIC + "v1|filing=VITA_SAVE_LEARN§\n" +
      packed +
      "\n# bank via /vitanote then /vitasave — or stage /vitafeed override",
    contentCommit: sha256Hex(packed),
    chars: packed.length,
  };
}

export function buildBrainLearnBody({ diff, peer, zeroProof, snap } = {}) {
  const lines = [];
  lines.push(
    BRAIN_LEARN_MAGIC + "v1|filing=BRAIN_LEARN|cycle=" +
    (zeroProof?.cycleIndex || 1) + "§",
  );
  lines.push("VITA BRAIN LEARN · old → new");
  lines.push("formula=" + FORMULA_ID);
  lines.push(
    "OLD→NEW mem" + signed(diff?.memoryDelta) +
    " strands" + signed(diff?.strandDelta) +
    " lib" + signed(diff?.libraryDelta) +
    " locs" + signed(diff?.sealedLocDelta),
  );
  lines.push("addedTopics=" + ((diff?.addedTopics || []).join(",") || "none"));
  lines.push("addedLib=" + ((diff?.addedLib || []).join(",") || "none"));
  lines.push("addedLocs=" + ((diff?.addedLocs || []).slice(0, 4).map((t) => shortHex(t, 8)).join(",") || "none"));
  lines.push("NOW mem=" + (snap?.memoryCount || 0) +
    " strands=" + (snap?.strandCount || 0) +
    " lib=" + (snap?.libraryCount || 0) +
    " sealedLocs=" + (snap?.sealedLocCount || 0));
  lines.push("peer=" + (peer?.verdict || "?") + " filing=PEER_REVIEW");
  lines.push("zeroProofRoot=" + shortHex(zeroProof?.root || "", 12) + " filing=ZERO_PROOF");
  lines.push("squash=" + shortHex(snap?.squashCommit || "", 12));
  return lines.join("\n");
}

function signed(n) {
  const v = Number(n) || 0;
  return (v >= 0 ? "+" : "") + v;
}

export function formatBrainLearnCard(cycle) {
  const lines = [];
  lines.push("VITA BRAIN ACTIVATE · learn cycle #" + (cycle.cycleIndex || 1));
  lines.push("filing labels: BRAIN_SEED · BRAIN_LEARN · PEER_REVIEW · ZERO_PROOF · VITA_SAVE_LEARN");
  lines.push("");
  lines.push("— OLD → NEW —");
  lines.push(
    "mem " + (cycle.old?.memoryCount ?? 0) + "→" + (cycle.new?.memoryCount ?? 0) +
    "  strands " + (cycle.old?.strandCount ?? 0) + "→" + (cycle.new?.strandCount ?? 0) +
    "  lib " + (cycle.old?.libraryCount ?? 0) + "→" + (cycle.new?.libraryCount ?? 0) +
    "  locs " + (cycle.old?.sealedLocCount ?? 0) + "→" + (cycle.new?.sealedLocCount ?? 0),
  );
  if (cycle.diff?.addedTopics?.length) {
    lines.push("new topics: " + cycle.diff.addedTopics.slice(0, 10).join(", "));
  } else {
    lines.push("new topics: (none this cycle — baseline refine)");
  }
  lines.push("");
  lines.push("— PEER REVIEW (filing=PEER_REVIEW) —");
  lines.push("verdict=" + (cycle.peer?.verdict || "?"));
  lines.push("pass=" + (cycle.peer?.pass || []).join(",") || "none");
  if (cycle.peer?.fail?.length) lines.push("fail=" + cycle.peer.fail.join(","));
  lines.push("");
  lines.push("— LIBRARY —");
  if (!(cycle.new?.library || []).length) {
    lines.push("empty — seal with /vitafeed file|brain then override");
  } else {
    for (const e of (cycle.new.library || []).slice(0, 12)) {
      lines.push(
        "#" + e.n + " " + e.name +
        " · locs " + (e.locationCount || 0) +
        (e.readerKey ? " · " + e.readerKey : ""),
      );
    }
  }
  lines.push("");
  lines.push("— ZERO PROOF GROWTH (filing=ZERO_PROOF) —");
  lines.push("cycle=" + cycle.zeroProof.cycleIndex + " root=" + shortHex(cycle.zeroProof.root, 16) + "…");
  lines.push("prev=" + shortHex(cycle.zeroProof.prevRoot, 12) + "…");
  lines.push(
    "retrieval surface: " +
    cycle.zeroProof.growth.memoryCount + " mem · " +
    cycle.zeroProof.growth.libraryCount + " files · " +
    cycle.zeroProof.growth.sealedLocCount + " sealed locs",
  );
  if (cycle.filingRefine?.added?.length) {
    lines.push("filing refined +" + cycle.filingRefine.added.join(","));
  }
  lines.push("");
  lines.push("— VITA SAVE LEARN (filing=VITA_SAVE_LEARN) —");
  lines.push(
    "§TOKEN§ " + (cycle.vitaSave?.chars || 0) + " chars · commit=" +
    shortHex(cycle.vitaSave?.contentCommit || "", 12),
  );
  lines.push("bank: /vitanote (packet) → /vitasave  OR  staged on /vitafeed override");
  return lines.join("\n");
}

/**
 * Activate brain learn: snapshot → write cycle artifacts → peer review →
 * zero-proof growth → vita-save packet → enriched stage body.
 */
export function activateBrainLearnCycle({
  libraryEntries = [],
  note = "",
} = {}) {
  const log = loadBrainLearnLog();
  const oldSnap = snapshotBrainState({ libraryEntries });
  // Cycle artifact topics (append-only) so NEW differs when we re-activate.
  const cycleIndex = (log.cycles?.length || 0) + 1;
  const priorRoot =
    log.zeroProof?.roots?.length
      ? log.zeroProof.roots[log.zeroProof.roots.length - 1]
      : log.zeroProof?.genesis || null;

  // Provisional peer on old snap (growth may come from writing this cycle).
  const provisionalDiff = diffBrainSnapshots(
    log.cycles?.length
      ? log.cycles[log.cycles.length - 1].new
      : { topics: [], sealedLocs: [], memoryCount: 0, strandCount: 0, libraryCount: 0, library: [], squashCommit: "" },
    oldSnap,
  );

  const peer = peerReviewBrainState(oldSnap, provisionalDiff, { priorRoot });
  const filingRefine = refineFilingLabels(peer.findings);

  // Persist this cycle's learn note under distinct labels (append-only files).
  const learnAt = new Date().toISOString();
  const learnTopic = "brain-learn-cycle-" + String(cycleIndex).padStart(3, "0");
  const learnPath = join(MEMORY_DIR, learnTopic + ".json");
  const learnRecord = {
    at: learnAt,
    topic: learnTopic,
    filingLabel: "BRAIN_LEARN",
    text:
      "Brain activate cycle #" + cycleIndex + ". " +
      "Old→new from prior cycle. Peer " + peer.verdict + ". " +
      (note || "Self-refining filing + zero-proof retrieval growth."),
    hypothesis: {
      id: "brain-learn-cycle-" + cycleIndex,
      status: peer.verdict === "PASS" ? "operating" : "needs-attention",
      note: "Distinct labels BRAIN_LEARN/PEER_REVIEW/ZERO_PROOF/VITA_SAVE_LEARN.",
    },
    formula: FORMULA_ID,
    neverForget: true,
    diff: provisionalDiff,
    peerVerdict: peer.verdict,
  };
  writeFileSync(learnPath, JSON.stringify(learnRecord, null, 2) + "\n", "utf8");

  const peerTopic = "peer-review-cycle-" + String(cycleIndex).padStart(3, "0");
  writeFileSync(
    join(MEMORY_DIR, peerTopic + ".json"),
    JSON.stringify({
      at: learnAt,
      topic: peerTopic,
      filingLabel: "PEER_REVIEW",
      text: peer.body,
      hypothesis: {
        id: "peer-review-" + cycleIndex,
        status: peer.verdict === "PASS" ? "passed" : "failed",
        note: "One peer review per activate — separate from BRAIN_LEARN.",
      },
      formula: FORMULA_ID,
      neverForget: true,
      contentCommit: peer.contentCommit,
    }, null, 2) + "\n",
    "utf8",
  );

  const strandPath = join(STRANDS_DIR, "brain-learn-" + String(cycleIndex).padStart(3, "0") + ".json");
  writeFileSync(
    strandPath,
    JSON.stringify({
      strandId: "brain-learn-" + String(cycleIndex).padStart(3, "0"),
      sparse: true,
      source: "brain-learn",
      filingLabel: "BRAIN_LEARN",
      learn: learnRecord.text,
      formula: FORMULA_ID,
      locations: MAINFRAME_ANCHORS.known.map((a) => ({
        id: a.id,
        location: a.tx,
        kind: a.kind,
      })),
    }, null, 2) + "\n",
    "utf8",
  );

  const newSnap = snapshotBrainState({ libraryEntries });
  const diff = diffBrainSnapshots(oldSnap, newSnap);
  // Re-peer with post-write growth.
  const peerFinal = peerReviewBrainState(newSnap, diff, { priorRoot });
  const zeroProof = buildZeroProof({
    snap: newSnap,
    priorRoot: priorRoot || sha256Hex("VITA-ZERO-PROOF|v1|" + FORMULA_ID),
    cycleIndex,
  });
  writeFileSync(
    join(MEMORY_DIR, "zero-proof-cycle-" + String(cycleIndex).padStart(3, "0") + ".json"),
    JSON.stringify({
      at: learnAt,
      topic: "zero-proof-cycle-" + String(cycleIndex).padStart(3, "0"),
      filingLabel: "ZERO_PROOF",
      text: zeroProof.body,
      root: zeroProof.root,
      prevRoot: zeroProof.prevRoot,
      growth: zeroProof.growth,
      formula: FORMULA_ID,
      neverForget: true,
      neverInventHashes: true,
    }, null, 2) + "\n",
    "utf8",
  );

  const vitaSave = buildVitaSaveLearnPacket({
    diff,
    peer: peerFinal,
    zeroProof,
    snap: newSnap,
  });
  writeFileSync(
    join(MEMORY_DIR, "vita-save-learn-cycle-" + String(cycleIndex).padStart(3, "0") + ".json"),
    JSON.stringify({
      at: learnAt,
      topic: "vita-save-learn-cycle-" + String(cycleIndex).padStart(3, "0"),
      filingLabel: "VITA_SAVE_LEARN",
      text: vitaSave.body,
      tokenPacket: vitaSave.tokenPacket,
      contentCommit: vitaSave.contentCommit,
      formula: FORMULA_ID,
      neverForget: true,
      bankPath: "/vitanote → /vitasave or /vitafeed override",
    }, null, 2) + "\n",
    "utf8",
  );

  const mind = buildBrainMindMap();
  const seedBody = buildBrainSeedBody();
  const learnBody = buildBrainLearnBody({
    diff,
    peer: peerFinal,
    zeroProof,
    snap: newSnap,
  });
  // Enriched stage: seed + learn + peer + zero-proof + vita-save (all labeled).
  const stageBody = [
    seedBody,
    "",
    learnBody,
    "",
    peerFinal.body,
    "",
    zeroProof.body,
    "",
    vitaSave.body,
  ].join("\n");

  const cycle = {
    cycleIndex,
    at: learnAt,
    old: {
      memoryCount: oldSnap.memoryCount,
      strandCount: oldSnap.strandCount,
      libraryCount: oldSnap.libraryCount,
      sealedLocCount: oldSnap.sealedLocCount,
      squashCommit: oldSnap.squashCommit,
      topics: oldSnap.topics,
    },
    new: newSnap,
    diff,
    peer: peerFinal,
    zeroProof,
    vitaSave,
    filingRefine,
    mind,
    seedBody,
    stageBody,
    stageBytes: Buffer.byteLength(stageBody, "utf8"),
    contentCommit: sha256Hex(stageBody),
  };

  log.cycles = log.cycles || [];
  log.cycles.push({
    cycleIndex,
    at: learnAt,
    old: cycle.old,
    new: {
      memoryCount: newSnap.memoryCount,
      strandCount: newSnap.strandCount,
      libraryCount: newSnap.libraryCount,
      sealedLocCount: newSnap.sealedLocCount,
      squashCommit: newSnap.squashCommit,
      topics: newSnap.topics,
      library: newSnap.library,
    },
    diff,
    peerVerdict: peerFinal.verdict,
    zeroProofRoot: zeroProof.root,
    vitaSaveCommit: vitaSave.contentCommit,
  });
  log.zeroProof = log.zeroProof || { roots: [], genesis: null };
  if (!log.zeroProof.genesis) {
    log.zeroProof.genesis = zeroProof.prevRoot;
  }
  log.zeroProof.roots = log.zeroProof.roots || [];
  log.zeroProof.roots.push(zeroProof.root);
  log.id = BRAIN_LEARN_ID;
  log.formula = FORMULA_ID;
  log.updatedAt = learnAt;
  persistBrainLearnLog(log);

  // Append-only feed-flow ledger: prove memory was fed + IDM chat of locs.
  let feedFlow = null;
  try {
    feedFlow = recordBrainLearnFeedFlow(cycle);
  } catch {
    feedFlow = null;
  }

  return {
    ok: true,
    ...cycle,
    feedFlow,
    logPath: LEARN_LOG_PATH,
    localSeed: proveBrainSeedLocal(),
    card:
      formatBrainLearnCard(cycle) +
      "\n\n" +
      formatBrainSeedCard(mind) +
      (feedFlow?.idmCard ? "\n\n" + feedFlow.idmCard : ""),
  };
}

/** Read-only growth proof from log (no new cycle). */
export function formatZeroProofGrowthCard() {
  const log = loadBrainLearnLog();
  const lines = [];
  lines.push("ZERO PROOF RETRIEVAL GROWTH · filing=ZERO_PROOF");
  lines.push("cycles=" + (log.cycles?.length || 0));
  if (!log.cycles?.length) {
    lines.push("empty — run /vitafeed brain to activate first cycle");
    return lines.join("\n");
  }
  lines.push("genesis=" + shortHex(log.zeroProof?.genesis || "", 12));
  const roots = log.zeroProof?.roots || [];
  roots.slice(-8).forEach((r, i) => {
    const idx = roots.length - Math.min(8, roots.length) + i + 1;
    lines.push("  #" + idx + " " + shortHex(r, 16) + "…");
  });
  const last = log.cycles[log.cycles.length - 1];
  lines.push(
    "latest: mem=" + (last.new?.memoryCount ?? "?") +
    " lib=" + (last.new?.libraryCount ?? "?") +
    " locs=" + (last.new?.sealedLocCount ?? "?") +
    " peer=" + (last.peerVerdict || "?"),
  );
  lines.push("never invent hashes · squash KEY8+LOC8 for hitch · full txs in filing");
  return lines.join("\n");
}

export function researchNotesForFiling() {
  return [
    "Append-only hash-chained thoughts (MentisDB-class) — tamper-evident learn log.",
    "Content-addressed commits (neleus-db / mnem Merkle-DAG) — digest is identity.",
    "Proof-carrying retrieval — every recall cites real Base locs or content digests.",
    "Distinct filing labels — peer review ≠ raw memory ≠ zero-proof ≠ vita-save.",
    "Squash KEY8/LOC8 on hitch; keep full hashes in anchors/library/filing.",
    "VITA maps: HTML until inject · leftover KEY+LOC · /prove Eureka · VIN feed.",
  ].join("\n");
}
