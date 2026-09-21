/**
 * CHAINDIR — line-for-line on-chain completion directory.
 *
 * Search is the blockchain location (Basescan Input Data field). Two ends
 * talk: HUMAN exact plain UTF-8 ↔ MACHINE ZK-short. Each lane routes until
 * it has a real loc proof, then waits for the other. Complete = both sealed
 * at an absolute moment. Completing a pair triggers the next inject (cycle
 * / self-check). Never invent tx hashes. Mother brain untouched.
 *
 * Telegram: /vitafeed chaindir  ·  /vitafeed cycle  ·  /vitafeed loc 0x…
 * DOS: /vitafeed dir CHAIN
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FORMULA_ID, MAINFRAME_ANCHORS } from "./mainframe.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const MEMORY_DIR = join(HERE, "memory");
const STRANDS_DIR = join(HERE, "strands");
const LEDGER_PATH = join(MEMORY_DIR, "chain-dir-ledger.json");

export const CHAINDIR_ID = "vita-chain-dir-v1";
export const CHAINDIR_MAGIC = "§VITACHAINDIR§";
export const CHAINDIR_LABEL = "CHAINDIR";
export const CHAINDIR_SUBDIR = "CHAIN";
export const BASESCAN_TX =
  MAINFRAME_ANCHORS.basescanTx || "https://basescan.org/tx/";

export const STATUS_ROUTING = "routing";
export const STATUS_WAITING = "waiting";
export const STATUS_COMPLETE = "complete";
export const LANE_HUMAN = "HUMAN";
export const LANE_MACHINE = "MACHINE";

function sha256Hex(text) {
  return createHash("sha256").update(String(text || ""), "utf8").digest("hex");
}

function shortHex(hex, n = 8) {
  return String(hex || "").replace(/^0x/i, "").toLowerCase().slice(0, n);
}

export function isTxHash(h) {
  return /^0x[0-9a-fA-F]{64}$/.test(String(h || ""));
}

function clip(s, n = 72) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length <= n ? t : t.slice(0, n - 1) + "…";
}

function ensureDirs() {
  if (!existsSync(MEMORY_DIR)) mkdirSync(MEMORY_DIR, { recursive: true });
  if (!existsSync(STRANDS_DIR)) mkdirSync(STRANDS_DIR, { recursive: true });
}

function emptyLedger() {
  return {
    id: CHAINDIR_ID,
    filingLabel: CHAINDIR_LABEL,
    formula: FORMULA_ID,
    neverInventHashes: true,
    neverForget: true,
    createdAt: new Date().toISOString(),
    updatedAt: null,
    seq: 0,
    lines: [],
    cycle: { triggered: 0, lastCompleteN: null, lastCompleteAt: null },
  };
}

/** @type {object|null} */
let _ledger = null;
let _pathOverride = null;

export function setChainDirPathForTests(path) {
  _pathOverride = path || null;
  _ledger = null;
}

export function resetChainDirForTests() {
  _ledger = emptyLedger();
  if (_pathOverride) {
    ensureDirs();
    writeFileSync(_pathOverride, JSON.stringify(_ledger, null, 2) + "\n", "utf8");
  }
  return _ledger;
}

function ledgerPath() {
  return _pathOverride || LEDGER_PATH;
}

export function loadChainDir() {
  if (_ledger && _pathOverride) return _ledger;
  ensureDirs();
  const path = ledgerPath();
  try {
    if (!existsSync(path)) {
      _ledger = emptyLedger();
      return _ledger;
    }
    const raw = JSON.parse(readFileSync(path, "utf8"));
    _ledger = {
      ...emptyLedger(),
      ...raw,
      lines: Array.isArray(raw.lines) ? raw.lines : [],
      cycle: { ...emptyLedger().cycle, ...(raw.cycle || {}) },
    };
    return _ledger;
  } catch {
    _ledger = emptyLedger();
    return _ledger;
  }
}

function persist(ledger) {
  ensureDirs();
  ledger.updatedAt = new Date().toISOString();
  writeFileSync(ledgerPath(), JSON.stringify(ledger, null, 2) + "\n", "utf8");
  _ledger = ledger;
  return ledger;
}

function emptyLane() {
  return {
    status: STATUS_ROUTING,
    locations: [],
    vinId: null,
    readerKey: null,
    bytes: 0,
    commit8: null,
  };
}

function realLocs(list) {
  return (list || []).map(String).filter(isTxHash);
}

function basescan(tx) {
  return BASESCAN_TX + tx;
}

function proofsFor(line) {
  const out = [];
  for (const lane of [LANE_HUMAN, LANE_MACHINE]) {
    const locList = lane === LANE_HUMAN ? line.human?.locations : line.machine?.locations;
    for (const tx of realLocs(locList)) {
      out.push({
        lane,
        tx,
        basescan: basescan(tx),
        idm: "Basescan → Input Data → View as UTF-8",
      });
    }
  }
  return out;
}

function deriveStatus(human, machine) {
  const h = human?.status === "sealed" && realLocs(human.locations).length > 0;
  const m = machine?.status === "sealed" && realLocs(machine.locations).length > 0;
  if (h && m) return STATUS_COMPLETE;
  if (h || m) return STATUS_WAITING;
  return STATUS_ROUTING;
}

export function guessTransmissionName(humanBody, hint = "") {
  const named = String(hint || "").trim();
  if (named) return clip(named.replace(/[^\w.\-]+/g, "-"), 40);
  const s = String(humanBody || "");
  if (/§VITAURLDIR§/i.test(s) || /KIDS URL DIRECTORY/i.test(s)) return "kids-url-dir";
  if (/§VITAMUSIC§/i.test(s) || /MAPLE LEAF RAG/i.test(s)) return "maple-leaf-rag";
  if (/§VITAFILE§/i.test(s)) {
    const m = s.match(/name=([^|§]+)/i);
    const name = m ? m[1] : "vitafile";
    if (/Maple_Leaf_Rag/i.test(name) || /\.g\d{2}$/i.test(name)) return "maple-leaf-rag";
    return clip(name, 40);
  }
  const first = s.split(/\n/)[0] || "line";
  return clip(first.replace(CHAINDIR_MAGIC, "").replace(/[^\w.\-]+/g, "-") || "line", 40);
}

function publicLine(line) {
  const proofs = proofsFor(line);
  return {
    n: line.n,
    name: line.name,
    status: line.status,
    startedAt: line.startedAt,
    completedAt: line.completedAt || null,
    contentCommit: line.contentCommit,
    contentCommit8: shortHex(line.contentCommit, 8),
    human: { ...line.human, locations: realLocs(line.human?.locations) },
    machine: { ...line.machine, locations: realLocs(line.machine?.locations) },
    proofs,
    clickable: proofs.map((p) => p.basescan),
    twoEndsTalking: line.status === STATUS_WAITING || line.status === STATUS_ROUTING,
  };
}

/**
 * Start (or resume) a dual-lane transmission. No locations yet — routing.
 */
export function routeTransmission({
  name = "",
  humanBody = "",
  machineBody = "",
  hint = "",
} = {}) {
  const human = String(humanBody || "");
  if (!human.trim()) {
    return { ok: false, reason: "empty human body — nothing to route" };
  }
  const ledger = loadChainDir();
  const nm = guessTransmissionName(human, name || hint);
  const commit = sha256Hex(human);
  const open = ledger.lines.find(
    (l) =>
      l.contentCommit === commit &&
      l.status !== STATUS_COMPLETE,
  );
  if (open) {
    return { ok: true, resumed: true, line: publicLine(open), ledger };
  }
  ledger.seq += 1;
  const line = {
    n: ledger.seq,
    name: nm,
    status: STATUS_ROUTING,
    startedAt: new Date().toISOString(),
    completedAt: null,
    contentCommit: commit,
    human: {
      ...emptyLane(),
      bytes: Buffer.byteLength(human, "utf8"),
      commit8: shortHex(commit, 8),
    },
    machine: {
      ...emptyLane(),
      bytes: Buffer.byteLength(String(machineBody || ""), "utf8"),
      commit8: shortHex(sha256Hex(machineBody || commit), 8),
    },
    cycleTriggered: false,
  };
  ledger.lines.push(line);
  persist(ledger);
  return { ok: true, resumed: false, line: publicLine(line), ledger };
}

/**
 * Attach a sealed lane. Only real tx hashes. The other end keeps routing
 * until it also has loc proof.
 */
export function recordLaneSeal({
  n = null,
  contentCommit = null,
  name = "",
  lane = LANE_HUMAN,
  locations = [],
  vinId = null,
  readerKey = null,
  partial = false,
  humanBody = "",
  machineBody = "",
} = {}) {
  const locs = realLocs(locations);
  if (!locs.length) {
    return { ok: false, reason: "no sealed locations — never invent hashes" };
  }
  const want = String(lane || LANE_HUMAN).toUpperCase() === LANE_MACHINE
    ? LANE_MACHINE
    : LANE_HUMAN;
  let ledger = loadChainDir();
  let line = null;
  if (Number(n) > 0) line = ledger.lines.find((l) => l.n === Number(n));
  if (!line && contentCommit) {
    line = ledger.lines.find((l) => l.contentCommit === contentCommit && l.status !== STATUS_COMPLETE);
  }
  if (!line && name) {
    line = [...ledger.lines].reverse().find(
      (l) => l.name === name && l.status !== STATUS_COMPLETE,
    );
  }
  if (!line && humanBody) {
    const routed = routeTransmission({ name, humanBody, machineBody });
    ledger = loadChainDir();
    line = ledger.lines.find((l) => l.n === routed.line?.n);
  }
  if (!line) {
    return { ok: false, reason: "no routing line — /vitafeed dual first" };
  }
  const slot = want === LANE_MACHINE ? line.machine : line.human;
  const merged = [...new Set([...(slot.locations || []).map((t) => t.toLowerCase()), ...locs.map((t) => t.toLowerCase())])];
  slot.locations = merged;
  slot.status = partial ? STATUS_ROUTING : "sealed";
  if (vinId) slot.vinId = vinId;
  if (readerKey) slot.readerKey = readerKey;
  if (partial) slot.status = STATUS_ROUTING;
  line.status = deriveStatus(line.human, line.machine);
  if (line.status === STATUS_COMPLETE && !line.completedAt) {
    line.completedAt = new Date().toISOString();
  }
  persist(ledger);
  const check = selfCheckLine(line);
  return {
    ok: true,
    line: publicLine(line),
    selfCheck: check,
    complete: line.status === STATUS_COMPLETE,
  };
}

export function selfCheckLine(line) {
  const humanLocs = realLocs(line?.human?.locations);
  const machineLocs = realLocs(line?.machine?.locations);
  const humanOk = line?.human?.status === "sealed" && humanLocs.length > 0;
  const machineOk = line?.machine?.status === "sealed" && machineLocs.length > 0;
  const invented = [...(line?.human?.locations || []), ...(line?.machine?.locations || [])]
    .filter(Boolean)
    .some((h) => !isTxHash(h));
  return {
    ok: humanOk && machineOk && !invented,
    humanLocProof: humanOk,
    machineLocProof: machineOk,
    twoEndsTalking: !(humanOk && machineOk),
    inventedHashes: invented,
    clickableProofs: proofsFor(line || {}),
    completeAt: line?.completedAt || null,
  };
}

/**
 * After dual confirm|override — record both lanes (HUMAN first, MACHINE waits
 * if HUMAN is partial). Completing triggers cycle.
 */
export function recordDualSealIntoChainDir({
  name = "",
  humanBody = "",
  machineBody = "",
  humanLocs = [],
  machineLocs = [],
  humanVin = null,
  machineVin = null,
  humanReaderKey = null,
  machineReaderKey = null,
  humanPartial = false,
  machinePartial = false,
} = {}) {
  const routed = routeTransmission({ name, humanBody, machineBody });
  if (!routed.ok) return routed;
  const hLocs = realLocs(humanLocs);
  let human = null;
  if (hLocs.length) {
    human = recordLaneSeal({
      n: routed.line.n,
      lane: LANE_HUMAN,
      locations: hLocs,
      vinId: humanVin,
      readerKey: humanReaderKey,
      partial: humanPartial,
    });
  }
  const mLocs = realLocs(machineLocs);
  let machine = null;
  if (mLocs.length && !humanPartial) {
    machine = recordLaneSeal({
      n: routed.line.n,
      lane: LANE_MACHINE,
      locations: mLocs,
      vinId: machineVin,
      readerKey: machineReaderKey,
      partial: machinePartial,
    });
  }
  const line = loadChainDir().lines.find((l) => l.n === routed.line.n);
  const check = selfCheckLine(line);
  let cycle = { triggered: false, reason: "pair not complete — two ends still talking" };
  if (line?.status === STATUS_COMPLETE) {
    cycle = triggerCycle(line);
  }
  return {
    ok: true,
    line: publicLine(line),
    selfCheck: check,
    cycle,
    human: human?.line || null,
    machine: machine?.line || null,
    waitingForMachine: Boolean(humanPartial || !mLocs.length),
  };
}

/**
 * Complete pair → next inject. Does not send. Marks the line so the other
 * end (backlog / dual / operator) is triggered for self-check + next route.
 */
export function triggerCycle(line) {
  const ledger = loadChainDir();
  const hit = ledger.lines.find((l) => l.n === line?.n);
  if (!hit || hit.status !== STATUS_COMPLETE) {
    return { triggered: false, reason: "not complete" };
  }
  if (hit.cycleTriggered) {
    return {
      triggered: false,
      already: true,
      reason: "already cycled",
      nextCmd: "/vitafeed cycle",
      n: hit.n,
    };
  }
  hit.cycleTriggered = true;
  ledger.cycle.triggered += 1;
  ledger.cycle.lastCompleteN = hit.n;
  ledger.cycle.lastCompleteAt = hit.completedAt;
  persist(ledger);
  return {
    triggered: true,
    n: hit.n,
    completedAt: hit.completedAt,
    nextCmd: "/vitafeed cycle",
    selfCheck: selfCheckLine(hit),
  };
}

export function searchByLocation(tx) {
  const want = String(tx || "").trim();
  if (!isTxHash(want)) {
    return { ok: false, reason: "need a real 0x location — never invent" };
  }
  const ledger = loadChainDir();
  const key = want.toLowerCase();
  const hits = ledger.lines.filter((l) =>
    proofsFor(l).some((p) => p.tx.toLowerCase() === key),
  );
  return {
    ok: hits.length > 0,
    query: want,
    basescan: basescan(want),
    idm: "Basescan → Input Data → View as UTF-8",
    hits: hits.map(publicLine),
  };
}

export function listActiveLines() {
  return loadChainDir()
    .lines.filter((l) => l.status !== STATUS_COMPLETE)
    .map(publicLine);
}

export function listCompleteLines() {
  return loadChainDir()
    .lines.filter((l) => l.status === STATUS_COMPLETE)
    .sort((a, b) => String(a.completedAt || "").localeCompare(String(b.completedAt || "")))
    .map(publicLine);
}

export function formatChainDirCard(ledger = loadChainDir()) {
  const active = listActiveLines();
  const complete = listCompleteLines();
  const lines = [];
  lines.push(CHAINDIR_MAGIC + "v1|n=" + ledger.seq + "|active=" + active.length + "|done=" + complete.length + "§");
  lines.push("CHAIN DIRECTORY — line-for-line in order of completion");
  lines.push("search = sealed location (Input Data field) · never invent hashes");
  lines.push("two ends talk: HUMAN plain ↔ MACHINE ZK-short · wait for loc proof");
  lines.push("");
  lines.push("— TOP ACTIVE (routing / waiting) —");
  if (!active.length) {
    lines.push("  (none routing — /vitafeed dual [text] or /vitafeed dual kids)");
  }
  for (const l of active) {
    const h = l.human.status === "sealed" ? "HUMAN sealed " + shortHex(l.human.locations[0], 10) : "HUMAN routing";
    const m = l.machine.status === "sealed" ? "MACHINE sealed " + shortHex(l.machine.locations[0], 10) : "MACHINE routing";
    lines.push(
      String(l.n).padStart(3, "0") +
        "  " +
        l.name +
        "  " +
        l.status +
        "  " +
        h +
        "  ·  " +
        m,
    );
    if (l.status === STATUS_WAITING) {
      lines.push("     two ends talking — wait for the other loc proof");
    }
  }
  lines.push("");
  lines.push("— BOTTOM COMPLETE (absolute moment · clickable Input Data) —");
  if (!complete.length) {
    lines.push("  (none complete — seal via /vitafeed confirm|override)");
  }
  for (const l of complete) {
    lines.push(
      String(l.n).padStart(3, "0") +
        "  " +
        l.name +
        "  COMPLETE @" +
        l.completedAt +
        "  commit=" +
        l.contentCommit8,
    );
    for (const p of l.proofs.slice(0, 6)) {
      lines.push("     " + p.lane + "  " + p.basescan);
    }
  }
  lines.push("");
  lines.push("cycle: complete → self-check both loc proofs → /vitafeed cycle stages next dual");
  lines.push("dir: /vitafeed dir CHAIN  ·  loc: /vitafeed loc 0x…  ·  player proven only when kids line is COMPLETE");
  return lines.join("\n");
}

export function formatChainDirSearchCard(found) {
  if (!found?.ok) {
    return CHAINDIR_MAGIC + " LOC MISS\n" + (found?.reason || "not in directory");
  }
  const lines = [
    CHAINDIR_MAGIC + " SEARCH",
    "location " + found.query,
    "clickable " + found.basescan,
    found.idm,
    "",
  ];
  for (const h of found.hits) {
    lines.push("#" + h.n + " " + h.name + "  " + h.status + (h.completedAt ? " @" + h.completedAt : ""));
    for (const p of h.proofs) {
      lines.push("  " + p.lane + "  " + p.basescan);
    }
  }
  return lines.join("\n");
}

export function formatCycleCard(cycle, line = null) {
  const lines = [CHAINDIR_MAGIC + " CYCLE"];
  if (line) {
    lines.push("#" + line.n + " " + line.name + "  " + line.status);
    if (line.completedAt) lines.push("absolute moment " + line.completedAt);
  }
  const check = cycle?.selfCheck || (line ? selfCheckLine(line) : null);
  if (check) {
    lines.push(
      "self-check HUMAN loc=" +
        (check.humanLocProof ? "YES" : "NO") +
        "  MACHINE loc=" +
        (check.machineLocProof ? "YES" : "NO"),
    );
    for (const p of check.clickableProofs || []) {
      lines.push("  " + p.lane + "  " + p.basescan);
    }
  }
  if (cycle?.triggered) {
    lines.push("trigger fired — other end: stage next dual into the injector");
  } else {
    lines.push("trigger: " + (cycle?.reason || "waiting"));
  }
  lines.push("next: " + (cycle?.nextCmd || "/vitafeed cycle"));
  return lines.join("\n");
}

export function chainDirEntriesFor() {
  const ledger = loadChainDir();
  const out = [
    {
      n: 1,
      name: "chain-dir-ledger.json",
      kind: "directory",
      bytes: 0,
      unlockName: "chain-dir-ledger.json",
      english:
        "Line-for-line on-chain completion directory. Top = routing/waiting. Bottom = complete with clickable Input Data proofs. HUMAN + MACHINE wait for each other's loc.",
      machine:
        "CHAINDIR seq=" +
        ledger.seq +
        " active=" +
        listActiveLines().length +
        " complete=" +
        listCompleteLines().length,
      locations: MAINFRAME_ANCHORS.known.map((a) => a.tx),
      trueName: "chain-dir",
      mime: "application/json",
    },
  ];
  for (const l of ledger.lines) {
    const pub = publicLine(l);
    out.push({
      n: out.length + 1,
      name: String(l.n).padStart(3, "0") + "-" + l.name + ".line",
      kind: l.status,
      bytes: (l.human?.bytes || 0) + (l.machine?.bytes || 0),
      unlockName: l.name,
      english:
        "#" +
        l.n +
        " " +
        l.status +
        " HUMAN=" +
        l.human.status +
        " MACHINE=" +
        l.machine.status +
        (l.completedAt ? " @" + l.completedAt : ""),
      machine:
        "LINE n=" +
        l.n +
        " status=" +
        l.status +
        " commit=" +
        shortHex(l.contentCommit, 8) +
        " hLocs=" +
        pub.human.locations.length +
        " mLocs=" +
        pub.machine.locations.length,
      locations: pub.proofs.map((p) => p.tx),
      trueName: l.name,
      playKind:
        l.name === "kids-url-dir"
          ? "youtube"
          : l.name === "maple-leaf-rag"
            ? "audio"
            : "file",
      dirId:
        l.name === "kids-url-dir" ? "kids" : l.name === "maple-leaf-rag" ? "maple" : null,
    });
  }
  return out;
}

export function provenKidsOnChain() {
  const kids = loadChainDir().lines.filter((l) => l.name === "kids-url-dir");
  const complete = kids.find((l) => l.status === STATUS_COMPLETE);
  if (complete) {
    return {
      proven: true,
      availability: false,
      n: complete.n,
      completedAt: complete.completedAt,
      proofs: proofsFor(complete),
      note: "KIDS url directory sealed in Input Data — HUMAN + MACHINE loc proofs.",
    };
  }
  const routing = kids.find((l) => l.status !== STATUS_COMPLETE);
  return {
    proven: false,
    availability: true,
    n: routing?.n || null,
    status: routing?.status || "unfiled",
    proofs: routing ? proofsFor(routing) : [],
    note:
      "KIDS catalog is local availability until /vitafeed dual kids then confirm|override seals Input Data. Formula anchors are class proof only — they do not hold this body.",
  };
}

export function provenMusicOnChain() {
  const rows = loadChainDir().lines.filter((l) => l.name === "maple-leaf-rag");
  const complete = rows.find((l) => l.status === STATUS_COMPLETE);
  if (complete) {
    return {
      proven: true,
      availability: false,
      n: complete.n,
      completedAt: complete.completedAt,
      proofs: proofsFor(complete),
      note: "Maple Leaf Rag catalog sealed in Input Data — HUMAN + MACHINE loc proofs. Song body is grouped §VITAFILE§ VIN slices.",
    };
  }
  const routing = rows.find((l) => l.status !== STATUS_COMPLETE);
  return {
    proven: false,
    availability: true,
    n: routing?.n || null,
    status: routing?.status || "unfiled",
    proofs: routing ? proofsFor(routing) : [],
    note:
      "Maple Leaf Rag is local availability until grouped VIN injects seal every slice into Input Data. /vitafeed dual maple logs the catalog line; /vitafeed enqueue maple drains groups. Formula anchors are class proof only — they do not hold this body.",
  };
}

export function publicChainDirState() {
  const ledger = loadChainDir();
  return {
    ok: true,
    id: CHAINDIR_ID,
    filingLabel: CHAINDIR_LABEL,
    formula: FORMULA_ID,
    neverInventHashes: true,
    seq: ledger.seq,
    cycle: ledger.cycle,
    kids: provenKidsOnChain(),
    music: provenMusicOnChain(),
    active: listActiveLines(),
    complete: listCompleteLines(),
    card: formatChainDirCard(ledger),
    telegram: [
      "/vitafeed chaindir",
      "/vitafeed cycle",
      "/vitafeed dual kids",
      "/vitafeed dual maple",
      "/vitafeed loc 0x…",
      "/vitafeed dir CHAIN",
    ],
    note: "Clickable proof = Basescan Input Data → UTF-8. Routing has no loc yet.",
  };
}
