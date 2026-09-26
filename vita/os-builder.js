/**
 * VITA OS Builder — DOS-style real-time brain / agent construction sandbox.
 *
 * Human ↔ machine guide someone to build their own AI brain (agent) together:
 *   BOOT → NAME → LOBES → TRIGGERS (IFTTT on Base data) → FOLLOW-LEADER
 *   → SANDBOX (prove against hardcoded anchors) → LANGUAGE refine → SEAL
 *
 * Agents are trigger systems: if-this-then-that over real blockchain Input Data
 * (follow-the-leader chronological registry). Never invents tx hashes.
 * HTML CRT is memory until /inject. Telegram: every step is an inline button.
 *
 * Mother brain untouched. VITAFEED_PAID stays gated (confirm|override).
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FORMULA_ID,
  KEY_LOC_HITCH_BYTES_CLASS,
  MAINFRAME_ANCHORS,
  ORIGINAL_FORMULA,
  planSparseInject,
} from "./mainframe.js";
import { buildBrainMindMap, BRAIN_SEED_MAGIC } from "./brain-seed.js";

// Do NOT import telegram-home, agent-chat, or mirror-chain at top level —
// they (or their deps) import vita-dir which imports this module (cycle).
const STORAGE_TOKEN_AGENT_ID = "storage-token";
const CALLBACK_DATA_MAX = 64;
let _agentChat = null;

function telegramCallbackData(cmd) {
  const s = String(cmd || "");
  return s.length <= CALLBACK_DATA_MAX ? s : s.slice(0, CALLBACK_DATA_MAX);
}

function withHomeButton(keyboard) {
  const rows = (keyboard?.inline_keyboard || []).map((r) => (r || []).map((b) => ({ ...b })));
  const flat = rows.flat();
  const hasHome = flat.some((b) => (b.callback_data || "") === "/home");
  if (!hasHome) rows.push([{ text: "🏠 HOME", callback_data: telegramCallbackData("/home") }]);
  return { inline_keyboard: rows };
}

function warmAgentChannel(agentId) {
  if (_agentChat) {
    try { return _agentChat.createAgentChannel(agentId); } catch { return { ok: true }; }
  }
  import("./agent-chat.js")
    .then((m) => {
      _agentChat = m;
      try { m.createAgentChannel(agentId); } catch { /* ok */ }
    })
    .catch(() => {});
  return { ok: true, deferred: true };
}

const HERE = dirname(fileURLToPath(import.meta.url));
const MEMORY_DIR = join(HERE, "memory");
const STRANDS_DIR = join(HERE, "strands");
const STATE_PATH = join(MEMORY_DIR, "os-builder-state.json");
const LEARN_PATH = join(MEMORY_DIR, "os-builder-learn.json");
const LEXICON_PATH = join(MEMORY_DIR, "os-builder-lexicon.json");
const STRAND_PATH = join(STRANDS_DIR, "os-builder.json");

export const OS_BUILDER_ID = "vita-os-builder-v1";
export const OS_BUILDER_MAGIC = "§VITAOS§";
export const OS_BUILDER_LABEL = "OS_BUILDER";
export const OS_TRIGGER_MAGIC = "§VITATRIGGER§";
export const OS_AGENT_MAGIC = "§VITAAGENT§";
export const OS_FOLLOW_MAGIC = "§VITAFOLLOW§";
export const OS_BUILDER_SUBDIR = "OS";
export const OS_BUILDER_PLAYER_PATH = "/vita/os-builder";

/** Wizard steps — early-DOS build phases. */
export const OS_STEPS = Object.freeze([
  { id: "boot", n: 0, title: "BOOT", blurb: "Load formula + Base anchors (class proof)" },
  { id: "name", n: 1, title: "NAME", blurb: "Name the agent brain" },
  { id: "lobes", n: 2, title: "LOBES", blurb: "Pick recall modules the brain holds" },
  { id: "triggers", n: 3, title: "TRIGGERS", blurb: "IFTTT rules on sealed chain kinds" },
  { id: "follow", n: 4, title: "FOLLOW", blurb: "Follow-the-leader chronological registry" },
  { id: "sandbox", n: 5, title: "SANDBOX", blurb: "Run tests on real Base Input Data" },
  { id: "language", n: 6, title: "LANGUAGE", blurb: "Refine human ↔ machine lexicon" },
  { id: "seal", n: 7, title: "SEAL", blurb: "Stage brain for /vitafeed confirm|override" },
]);

/** Available brain lobes (recall modules). */
export const OS_LOBES = Object.freeze([
  { id: "formula", label: "FORMULA", role: "invariants + message-first hitch gate" },
  { id: "anchors", label: "ANCHORS", role: "hardcoded Base txs — never invent" },
  { id: "feed", label: "FEED", role: "VIN packets · backlog · dual lane" },
  { id: "dual", label: "DUAL", role: "HUMAN plain ↔ MACHINE ZK-short" },
  { id: "triggers", label: "TRIGGERS", role: "IFTTT on chain kinds / leftover" },
  { id: "follow", label: "FOLLOW", role: "follow-the-leader step registry" },
  { id: "lexicon", label: "LEXICON", role: "shared human↔machine language" },
  { id: "memory", label: "MEMORY", role: "append-only learn · never forget" },
]);

/**
 * Seed IFTTT recipes — condition reads real chain class (anchors / leftover),
 * action stays local (learn / hitch / cycle / dual). Never invents locs.
 */
export const OS_TRIGGER_RECIPES = Object.freeze([
  {
    id: "eureka-learn",
    if: { field: "kind", op: "eq", value: "eureka" },
    then: { action: "append_learn", topic: "eureka-love" },
    proveAgainst: "eureka-prove",
    human: "IF sealed kind is eureka THEN append Eureka love into memory",
    machine: "IF kind=eureka THEN append_learn topic=eureka-love",
  },
  {
    id: "vita-sparse",
    if: { field: "kind", op: "eq", value: "vita" },
    then: { action: "sparse_plan", chunkSize: 3 },
    proveAgainst: "vita-strand",
    human: "IF sealed kind is vita THEN grow sparse strand plan from loc",
    machine: "IF kind=vita THEN sparse_plan chunk=3",
  },
  {
    id: "plain-refuse-claim",
    if: { field: "kind", op: "eq", value: "none" },
    then: { action: "refuse_utf8_claim" },
    proveAgainst: "keycat-plain",
    human: "IF plain 228B swap (no hitch) THEN refuse claiming Telegram as on-chain",
    machine: "IF kind=none THEN refuse_utf8_claim",
  },
  {
    id: "keyloc-hitch",
    if: { field: "keyLocCovered", op: "eq", value: true },
    then: { action: "hitch_message_first" },
    proveAgainst: null,
    human: "IF leftover covers KEY+LOC THEN hitch (message-first — never mute)",
    machine: "IF keyLocCovered=true THEN hitch_message_first",
  },
  {
    id: "dual-cycle",
    if: { field: "dualComplete", op: "eq", value: true },
    then: { action: "cycle_next_inject" },
    proveAgainst: null,
    human: "IF HUMAN+MACHINE pair both sealed THEN cycle next inject",
    machine: "IF dualComplete=true THEN cycle_next_inject",
  },
]);

/** Seed lexicon — human phrase ↔ machine token (refined together). */
export const OS_LEXICON_SEED = Object.freeze([
  { human: "never invent a hash", machine: "neverInventHashes=true", refined: false },
  { human: "HTML holds memory until inject", machine: "htmlIsMemoryUntilInject=true", refined: false },
  { human: "message-first when KEY+LOC covered", machine: "messageFirstWhenKeyLocCovered=true", refined: false },
  { human: "follow the leader", machine: "followLeader=sequential+1", refined: false },
  { human: "if this then that on chain", machine: "trigger=IFTTT|field|op|value→action", refined: false },
  { human: "build a brain together", machine: "osBuilder=wizard|lobes|sandbox|seal", refined: false },
]);

function sha256Hex(text) {
  return createHash("sha256").update(String(text || ""), "utf8").digest("hex");
}

function shortHex(hex, n = 8) {
  return String(hex || "").replace(/^0x/i, "").toLowerCase().slice(0, n);
}

function utf8Bytes(s) {
  return Buffer.byteLength(String(s || ""), "utf8");
}

function clip(s, n = 120) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length <= n ? t : t.slice(0, n - 1) + "…";
}

function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function ensureDirs() {
  if (!existsSync(MEMORY_DIR)) mkdirSync(MEMORY_DIR, { recursive: true });
  if (!existsSync(STRANDS_DIR)) mkdirSync(STRANDS_DIR, { recursive: true });
}

function loadJson(path, fallback) {
  try {
    if (existsSync(path)) return JSON.parse(readFileSync(path, "utf8"));
  } catch { /* fresh */ }
  return typeof fallback === "function" ? fallback() : structuredClone(fallback);
}

function saveJson(path, doc) {
  ensureDirs();
  writeFileSync(path, JSON.stringify(doc, null, 2) + "\n");
}

function sanitizeAgentId(id) {
  const s = String(id || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 48);
  return s || "unnamed-brain";
}

function btn(text, cmd) {
  return { text: String(text).slice(0, 64), callback_data: telegramCallbackData(cmd) };
}

function emptyState() {
  return {
    id: OS_BUILDER_ID,
    filingLabel: OS_BUILDER_LABEL,
    formula: FORMULA_ID,
    neverInventHashes: true,
    neverForget: true,
    createdAt: new Date().toISOString(),
    updatedAt: null,
    session: null,
    agents: {},
    followHead: {},
    sandboxRuns: [],
  };
}

function emptyLearn() {
  return {
    id: "os-builder-learn-v1",
    filingLabel: OS_BUILDER_LABEL,
    events: [],
  };
}

function emptyLexicon() {
  return {
    id: "os-builder-lexicon-v1",
    filingLabel: OS_BUILDER_LABEL,
    pairs: OS_LEXICON_SEED.map((p) => ({ ...p, at: null })),
    refinedCount: 0,
  };
}

/** @type {object|null} */
let _state = null;
let _statePathOverride = null;

export function setOsBuilderPathForTests(path) {
  _statePathOverride = path || null;
  _state = null;
}

function statePath() {
  return _statePathOverride || STATE_PATH;
}

export function loadOsBuilderState() {
  if (_state && !_statePathOverride) return _state;
  _state = loadJson(statePath(), emptyState);
  return _state;
}

export function saveOsBuilderState(doc = null) {
  const d = doc || loadOsBuilderState();
  d.updatedAt = new Date().toISOString();
  saveJson(statePath(), d);
  _state = d;
  return d;
}

function appendLearn(event) {
  const doc = loadJson(LEARN_PATH, emptyLearn);
  doc.events.push({
    ...event,
    at: new Date().toISOString(),
  });
  if (doc.events.length > 400) doc.events = doc.events.slice(-400);
  saveJson(LEARN_PATH, doc);
  return doc;
}

function writeStrand(extra = {}) {
  const strand = {
    id: "os-builder",
    filingLabel: OS_BUILDER_LABEL,
    magic: OS_BUILDER_MAGIC,
    formula: FORMULA_ID,
    learn:
      "DOS OS builder: human↔machine guided brain construction. IFTTT triggers " +
      "on real Base kinds. Follow-the-leader chronological steps. Sandbox proves " +
      "against hardcoded anchors only. Seal stages /vitafeed — never invent hashes.",
    updatedAt: new Date().toISOString(),
    ...extra,
  };
  ensureDirs();
  writeFileSync(STRAND_PATH, JSON.stringify(strand, null, 2) + "\n");
  return strand;
}

export function loadOsLexicon() {
  return loadJson(LEXICON_PATH, emptyLexicon);
}

export function refineLexiconPair({ human, machine } = {}) {
  const doc = loadOsLexicon();
  const h = String(human || "").trim();
  const m = String(machine || "").trim();
  if (!h || !m) return { ok: false, reason: "need human + machine phrases" };
  const existing = doc.pairs.find(
    (p) => p.human.toLowerCase() === h.toLowerCase() || p.machine === m,
  );
  if (existing) {
    existing.human = h;
    existing.machine = m;
    existing.refined = true;
    existing.at = new Date().toISOString();
  } else {
    doc.pairs.push({ human: h, machine: m, refined: true, at: new Date().toISOString() });
  }
  doc.refinedCount = (doc.pairs || []).filter((p) => p.refined).length;
  saveJson(LEXICON_PATH, doc);
  appendLearn({ kind: "lexicon_refine", human: h, machine: m });
  return { ok: true, pair: { human: h, machine: m, refined: true }, lexicon: doc };
}

export function osBuilderOpenKey(agentId) {
  const id = sanitizeAgentId(agentId);
  const commit = sha256Hex("vita-os-open-key-v1|" + id);
  return {
    scheme: "vita-os-open-key-v1",
    privateKey: false,
    openSource: true,
    agentId: id,
    key: "VITAOPEN.OS." + id + "." + commit.slice(0, 12),
    hex: commit,
    note: "Public/open. Not a wallet secret. Unwraps brain filing by name.",
  };
}

function defaultLobes() {
  return OS_LOBES.map((l) => l.id);
}

function emptyAgentDraft(agentId) {
  const id = sanitizeAgentId(agentId);
  const open = osBuilderOpenKey(id);
  return {
    agentId: id,
    magic: OS_AGENT_MAGIC,
    step: "boot",
    lobes: defaultLobes(),
    triggers: OS_TRIGGER_RECIPES.map((r) => r.id),
    followSteps: [],
    sandbox: { lastRunId: null, passed: 0, failed: 0 },
    lexiconRefined: 0,
    publicKey: open.key,
    publicKeyHex: open.hex,
    sealedLocs: [],
    contentCommit: null,
    status: "draft",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    formula: FORMULA_ID,
    neverInventHashes: true,
  };
}

/**
 * Start or resume a guided build session.
 */
export function startOsSession({ agentId = "new-brain", resume = true } = {}) {
  const state = loadOsBuilderState();
  const id = sanitizeAgentId(agentId);
  if (!state.agents[id]) {
    state.agents[id] = emptyAgentDraft(id);
    warmAgentChannel(id);
  }
  const agent = state.agents[id];
  if (!resume || !state.session || state.session.agentId !== id) {
    state.session = {
      agentId: id,
      step: agent.step || "boot",
      startedAt: new Date().toISOString(),
    };
  } else {
    state.session.step = agent.step || state.session.step || "boot";
  }
  agent.updatedAt = new Date().toISOString();
  saveOsBuilderState(state);
  appendLearn({ kind: "session_start", agentId: id, step: state.session.step });
  writeStrand({ agentId: id, step: state.session.step });
  return { ok: true, session: state.session, agent };
}

export function getOsSession() {
  const state = loadOsBuilderState();
  return state.session;
}

export function getOsAgent(agentId) {
  const state = loadOsBuilderState();
  const id = sanitizeAgentId(agentId || state.session?.agentId || "new-brain");
  return state.agents[id] || null;
}

export function listOsAgents() {
  const state = loadOsBuilderState();
  return Object.values(state.agents || {});
}

export function setOsStep(stepId, agentId = null) {
  const state = loadOsBuilderState();
  const id = sanitizeAgentId(agentId || state.session?.agentId || "new-brain");
  const step = OS_STEPS.find((s) => s.id === String(stepId || "").toLowerCase());
  if (!step) return { ok: false, reason: "unknown step — " + OS_STEPS.map((s) => s.id).join("|") };
  if (!state.agents[id]) state.agents[id] = emptyAgentDraft(id);
  state.agents[id].step = step.id;
  state.agents[id].updatedAt = new Date().toISOString();
  if (!state.session) state.session = { agentId: id, step: step.id, startedAt: new Date().toISOString() };
  else {
    state.session.agentId = id;
    state.session.step = step.id;
  }
  saveOsBuilderState(state);
  appendLearn({ kind: "step", agentId: id, step: step.id });
  return { ok: true, step, agent: state.agents[id] };
}

export function renameOsAgent(newId, fromId = null) {
  const state = loadOsBuilderState();
  const from = sanitizeAgentId(fromId || state.session?.agentId || "new-brain");
  const to = sanitizeAgentId(newId);
  if (!state.agents[from]) state.agents[from] = emptyAgentDraft(from);
  const draft = { ...state.agents[from], agentId: to };
  const open = osBuilderOpenKey(to);
  draft.publicKey = open.key;
  draft.publicKeyHex = open.hex;
  draft.updatedAt = new Date().toISOString();
  draft.step = "name";
  state.agents[to] = draft;
  if (to !== from) delete state.agents[from];
  warmAgentChannel(to);
  state.session = {
    agentId: to,
    step: "lobes",
    startedAt: state.session?.startedAt || new Date().toISOString(),
  };
  draft.step = "lobes";
  saveOsBuilderState(state);
  appendLearn({ kind: "rename", from, to });
  return { ok: true, agent: draft, session: state.session };
}

export function setOsLobes(lobeIds, agentId = null) {
  const state = loadOsBuilderState();
  const id = sanitizeAgentId(agentId || state.session?.agentId || "new-brain");
  if (!state.agents[id]) state.agents[id] = emptyAgentDraft(id);
  const known = new Set(OS_LOBES.map((l) => l.id));
  const picked = [...new Set((lobeIds || []).map((x) => String(x).toLowerCase()).filter((x) => known.has(x)))];
  if (!picked.length) return { ok: false, reason: "pick at least one lobe" };
  state.agents[id].lobes = picked;
  state.agents[id].step = "triggers";
  state.agents[id].updatedAt = new Date().toISOString();
  if (state.session) state.session.step = "triggers";
  saveOsBuilderState(state);
  appendLearn({ kind: "lobes", agentId: id, lobes: picked });
  return { ok: true, agent: state.agents[id] };
}

export function setOsTriggers(triggerIds, agentId = null) {
  const state = loadOsBuilderState();
  const id = sanitizeAgentId(agentId || state.session?.agentId || "new-brain");
  if (!state.agents[id]) state.agents[id] = emptyAgentDraft(id);
  const known = new Set(OS_TRIGGER_RECIPES.map((r) => r.id));
  const picked = [...new Set((triggerIds || []).map((x) => String(x).toLowerCase()).filter((x) => known.has(x)))];
  if (!picked.length) return { ok: false, reason: "pick at least one trigger recipe" };
  state.agents[id].triggers = picked;
  state.agents[id].step = "follow";
  state.agents[id].updatedAt = new Date().toISOString();
  if (state.session) state.session.step = "follow";
  saveOsBuilderState(state);
  appendLearn({ kind: "triggers", agentId: id, triggers: picked });
  return { ok: true, agent: state.agents[id] };
}

/**
 * Evaluate one IFTTT rule against a fact bag (chain kind / leftover / dual).
 */
export function evaluateTrigger(recipe, facts = {}) {
  const r = typeof recipe === "string"
    ? OS_TRIGGER_RECIPES.find((x) => x.id === recipe)
    : recipe;
  if (!r) return { ok: false, fired: false, reason: "unknown recipe" };
  const field = r.if.field;
  const actual = facts[field];
  let match = false;
  if (r.if.op === "eq") {
    match = actual === r.if.value || String(actual) === String(r.if.value);
  } else if (r.if.op === "neq") {
    match = actual !== r.if.value;
  }
  return {
    ok: true,
    fired: match,
    recipeId: r.id,
    if: r.if,
    then: match ? r.then : null,
    human: r.human,
    machine: r.machine,
    proveAgainst: r.proveAgainst,
  };
}

/**
 * Follow-the-leader: commit next chronological build step.
 * Sequence must be head+1 (or 1 if empty). prevHash must match.
 */
export function commitFollowStep({
  agentId = null,
  label = "",
  payload = "",
} = {}) {
  const state = loadOsBuilderState();
  const id = sanitizeAgentId(agentId || state.session?.agentId || "new-brain");
  if (!state.agents[id]) state.agents[id] = emptyAgentDraft(id);
  if (!state.followHead[id]) {
    state.followHead[id] = { head: 0, latestHash: null, steps: [] };
  }
  const head = state.followHead[id];
  const nextId = head.head + 1;
  const cellHash = sha256Hex(
    OS_FOLLOW_MAGIC + "|" + id + "|" + nextId + "|" + label + "|" + payload,
  );
  const prevHash = head.latestHash || ("0".repeat(64));
  const step = {
    chunkId: nextId,
    label: String(label || "step-" + nextId).slice(0, 64),
    payload: String(payload || "").slice(0, 500),
    cellHash,
    prevHash,
    committedAt: new Date().toISOString(),
  };
  head.steps.push(step);
  head.head = nextId;
  head.latestHash = cellHash;
  state.agents[id].followSteps = head.steps.map((s) => ({
    chunkId: s.chunkId,
    label: s.label,
    cellHash: s.cellHash,
  }));
  state.agents[id].step = "sandbox";
  state.agents[id].updatedAt = new Date().toISOString();
  if (state.session) state.session.step = "sandbox";
  saveOsBuilderState(state);
  appendLearn({ kind: "follow", agentId: id, chunkId: nextId, cellHash: shortHex(cellHash, 12) });
  return { ok: true, step, head: head.head, followLeader: true };
}

export function verifyFollowChain(agentId = null) {
  const state = loadOsBuilderState();
  const id = sanitizeAgentId(agentId || state.session?.agentId || "new-brain");
  const head = state.followHead[id];
  if (!head || !head.steps.length) {
    return { ok: true, empty: true, valid: true, head: 0 };
  }
  let prev = "0".repeat(64);
  for (let i = 0; i < head.steps.length; i++) {
    const s = head.steps[i];
    if (s.chunkId !== i + 1) {
      return { ok: false, valid: false, reason: "gap at chunk " + s.chunkId + " (follow-the-leader)" };
    }
    if (s.prevHash !== prev) {
      return { ok: false, valid: false, reason: "prev hash mismatch at " + s.chunkId };
    }
    prev = s.cellHash;
  }
  return { ok: true, valid: true, head: head.head, steps: head.steps.length };
}

/**
 * Build fact bag from a hardcoded anchor id (real Base class proof).
 */
export function factsFromAnchor(anchorId, extra = {}) {
  const a = MAINFRAME_ANCHORS.known.find((x) => x.id === anchorId);
  if (!a) return { ok: false, reason: "unknown anchor — never invent" };
  return {
    ok: true,
    kind: a.kind,
    anchorId: a.id,
    location: a.tx,
    basescan: MAINFRAME_ANCHORS.basescanTx + a.tx,
    keyLocCovered: extra.keyLocCovered === true,
    dualComplete: extra.dualComplete === true,
    leftoverEth: Number(extra.leftoverEth) || 0,
    classProof: true,
    note: "Class proof from anchors.json — not file body. Never invented.",
  };
}

/**
 * Sandbox: fire selected triggers against real anchors + synthetic leftover/dual facts.
 * Proves the agent would act correctly on live chain classes without inventing locs.
 */
export function runOsSandbox({ agentId = null, keyLocCovered = true, dualComplete = true } = {}) {
  const state = loadOsBuilderState();
  const id = sanitizeAgentId(agentId || state.session?.agentId || "new-brain");
  if (!state.agents[id]) state.agents[id] = emptyAgentDraft(id);
  const agent = state.agents[id];
  const follow = verifyFollowChain(id);
  const results = [];

  for (const tid of agent.triggers || []) {
    const recipe = OS_TRIGGER_RECIPES.find((r) => r.id === tid);
    if (!recipe) continue;
    if (recipe.proveAgainst) {
      const facts = factsFromAnchor(recipe.proveAgainst, { keyLocCovered, dualComplete });
      if (!facts.ok) {
        results.push({ recipeId: tid, pass: false, reason: facts.reason });
        continue;
      }
      const ev = evaluateTrigger(recipe, facts);
      const expectFire = true;
      const pass = ev.fired === expectFire;
      results.push({
        recipeId: tid,
        pass,
        fired: ev.fired,
        action: ev.then?.action || null,
        against: recipe.proveAgainst,
        location: facts.location,
        basescan: facts.basescan,
        human: recipe.human,
        machine: recipe.machine,
      });
    } else {
      const facts = {
        kind: null,
        keyLocCovered,
        dualComplete,
      };
      const ev = evaluateTrigger(recipe, facts);
      const pass = ev.fired === true;
      results.push({
        recipeId: tid,
        pass,
        fired: ev.fired,
        action: ev.then?.action || null,
        against: "synthetic-facts",
        location: null,
        basescan: null,
        human: recipe.human,
        machine: recipe.machine,
      });
    }
  }

  // Negative control: plain anchor must NOT fire eureka-learn
  const plain = factsFromAnchor("keycat-plain");
  const eurekaOnPlain = evaluateTrigger("eureka-learn", plain);
  results.push({
    recipeId: "neg-eureka-on-plain",
    pass: eurekaOnPlain.fired === false,
    fired: eurekaOnPlain.fired,
    action: null,
    against: "keycat-plain",
    location: plain.location,
    basescan: plain.basescan,
    human: "NEGATIVE: eureka trigger must not fire on plain swap",
    machine: "ASSERT eureka-learn fired=false on kind=none",
  });

  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  const runId = "os-run-" + sha256Hex(id + "|" + Date.now()).slice(0, 10);
  const run = {
    runId,
    agentId: id,
    at: new Date().toISOString(),
    passed,
    failed,
    followValid: follow.valid !== false,
    followHead: follow.head || 0,
    hitchClassBytes: KEY_LOC_HITCH_BYTES_CLASS,
    results,
    neverInventHashes: true,
  };
  state.sandboxRuns.push(run);
  if (state.sandboxRuns.length > 50) state.sandboxRuns = state.sandboxRuns.slice(-50);
  agent.sandbox = { lastRunId: runId, passed, failed };
  agent.step = failed === 0 ? "language" : "sandbox";
  agent.updatedAt = new Date().toISOString();
  if (state.session) state.session.step = agent.step;
  saveOsBuilderState(state);
  appendLearn({
    kind: "sandbox",
    agentId: id,
    runId,
    passed,
    failed,
    followValid: run.followValid,
  });
  writeStrand({ agentId: id, lastSandbox: runId, passed, failed });
  return { ok: failed === 0, run, follow };
}

/**
 * Build seal body for /vitafeed — stages brain definition (availability until real seal).
 */
export function buildOsSealBody(agentId = null) {
  const state = loadOsBuilderState();
  const id = sanitizeAgentId(agentId || state.session?.agentId || "new-brain");
  const agent = state.agents[id] || emptyAgentDraft(id);
  const mind = buildBrainMindMap();
  const lexicon = loadOsLexicon();
  const follow = state.followHead[id] || { head: 0, steps: [] };
  const lines = [];
  lines.push(OS_BUILDER_MAGIC + "v1|agent=" + id + "|formula=" + FORMULA_ID + "§");
  lines.push(OS_AGENT_MAGIC + "id=" + id + "§");
  lines.push("VITA OS BUILDER — AGENT BRAIN");
  lines.push("agentId=" + id);
  lines.push("openKey=" + agent.publicKey);
  lines.push("status=" + agent.status);
  lines.push("lobes=" + (agent.lobes || []).join(","));
  lines.push("triggers=" + (agent.triggers || []).join(","));
  lines.push("followHead=" + (follow.head || 0));
  lines.push("sandbox passed=" + (agent.sandbox?.passed ?? 0) + " failed=" + (agent.sandbox?.failed ?? 0));
  lines.push("LEXICON pairs=" + (lexicon.pairs || []).length + " refined=" + (lexicon.refinedCount || 0));
  for (const p of (lexicon.pairs || []).slice(0, 8)) {
    lines.push("  H:" + p.human + " ↔ M:" + p.machine + (p.refined ? " [refined]" : ""));
  }
  lines.push("ANCHORS (class proof — pull on /inject):");
  for (const a of mind.anchors) {
    lines.push("  " + a.id + "|" + a.kind + "|" + a.tx);
  }
  lines.push("TRIGGERS:");
  for (const tid of agent.triggers || []) {
    const r = OS_TRIGGER_RECIPES.find((x) => x.id === tid);
    if (r) lines.push("  " + r.machine);
  }
  lines.push("FOLLOW-THE-LEADER:");
  for (const s of (follow.steps || []).slice(0, 12)) {
    lines.push("  #" + s.chunkId + " " + s.label + " " + shortHex(s.cellHash, 12));
  }
  lines.push("INVARIANTS: neverInvent=" + ORIGINAL_FORMULA.neverInventTxHash);
  lines.push("messageFirst=" + ORIGINAL_FORMULA.messageFirstWhenKeyLocCovered);
  lines.push("Seal via /vitafeed confirm|override. Locs empty until real Base seal.");
  // Also embed classic brain seed header so feed brain path stays compatible
  lines.push("---");
  lines.push(BRAIN_SEED_MAGIC + "via=os-builder§");
  const body = lines.join("\n");
  const commit = sha256Hex(body);
  const sparse = planSparseInject({
    sealedLocations: mind.anchors.map((a) => ({ location: a.tx, kind: a.kind })),
    chunkSize: 3,
    includeHardcoded: true,
  });
  return {
    ok: true,
    agentId: id,
    body,
    contentCommit: commit,
    bytes: utf8Bytes(body),
    openKey: agent.publicKey,
    sparsePlan: { total: sparse.total, strandIds: sparse.strands.map((s) => s.strandId) },
    locations: [],
    availability: true,
    proven: false,
    note: "Availability until confirm|override seals real Base locs. Never invent hashes.",
  };
}

export function stageOsSeal(agentId = null) {
  const state = loadOsBuilderState();
  const id = sanitizeAgentId(agentId || state.session?.agentId || "new-brain");
  if (!state.agents[id]) state.agents[id] = emptyAgentDraft(id);
  state.agents[id].status = "staged";
  state.agents[id].step = "seal";
  state.agents[id].updatedAt = new Date().toISOString();
  if (state.session) state.session.step = "seal";
  saveOsBuilderState(state);
  const sealed = buildOsSealBody(id);
  state.agents[id].contentCommit = sealed.contentCommit;
  saveOsBuilderState(state);
  appendLearn({
    kind: "stage_seal",
    agentId: id,
    contentCommit: shortHex(sealed.contentCommit, 12),
    bytes: sealed.bytes,
  });
  writeStrand({ agentId: id, staged: true, contentCommit: sealed.contentCommit });
  return sealed;
}

/** Real end-to-end use case: build watcher-eureka, follow steps, sandbox, seal. */
export function runOsUseCaseDemo() {
  const name = "watcher-eureka";
  startOsSession({ agentId: name });
  renameOsAgent(name, name);
  setOsLobes(["formula", "anchors", "triggers", "follow", "memory", "lexicon"], name);
  setOsTriggers(["eureka-learn", "vita-sparse", "plain-refuse-claim", "keyloc-hitch"], name);
  commitFollowStep({ agentId: name, label: "boot-formula", payload: FORMULA_ID });
  commitFollowStep({ agentId: name, label: "wire-triggers", payload: "eureka+vita+plain+keyloc" });
  commitFollowStep({ agentId: name, label: "sandbox-ready", payload: "prove-against-anchors" });
  refineLexiconPair({
    human: "eureka love becomes learn",
    machine: "IF kind=eureka THEN append_learn topic=eureka-love",
  });
  const sand = runOsSandbox({ agentId: name, keyLocCovered: true, dualComplete: true });
  const sealed = stageOsSeal(name);
  return {
    ok: sand.ok && sealed.ok,
    agentId: name,
    sandbox: sand,
    seal: sealed,
    follow: verifyFollowChain(name),
  };
}

export function osBuilderHref(path = OS_BUILDER_PLAYER_PATH) {
  const base = String(process.env.PUBLIC_BASE_URL || process.env.RAILWAY_PUBLIC_DOMAIN || "")
    .replace(/\/$/, "");
  if (base) {
    const root = base.startsWith("http") ? base : "https://" + base;
    return root + (path.startsWith("/") ? path : "/" + path);
  }
  return path;
}

export function buildOsBuilderKeyboard(agentId = null) {
  const state = loadOsBuilderState();
  const id = sanitizeAgentId(agentId || state.session?.agentId || "new-brain");
  const step = state.session?.step || state.agents[id]?.step || "boot";
  const href = osBuilderHref(OS_BUILDER_PLAYER_PATH + "?popup=1");
  const rows = [
    [
      btn("🟢 BOOT", "/os boot"),
      btn("🏷 NAME", "/os name"),
      btn("🧩 LOBES", "/os lobes"),
    ],
    [
      btn("⚡ TRIGGERS", "/os triggers"),
      btn("⛓ FOLLOW", "/os follow"),
      btn("🧪 SANDBOX", "/os sandbox"),
    ],
    [
      btn("🗣 LANGUAGE", "/os language"),
      btn("🔏 SEAL", "/os seal"),
      btn("▶ DEMO", "/os demo"),
    ],
    [
      btn("📋 Status", "/os status"),
      btn("📂 Dir OS", "/vitafeed dir OS"),
      btn("🧠 Brain feed", "/vitafeed brain"),
    ],
    [
      { text: "▶ CRT popup", web_app: { url: href } },
      { text: "↗ Open CRT", url: href },
    ],
    [
      btn("🏠 HOME", "/home"),
      btn("🤖 Agents", "/home agents"),
      btn("🧬 OS section", "/home os"),
    ],
  ];
  // Step-specific next action
  const next = nextStepHint(step);
  if (next?.cmd) {
    rows.unshift([btn("▶ NEXT: " + next.label, next.cmd)]);
  }
  void id;
  return withHomeButton({ inline_keyboard: rows });
}

function nextStepHint(step) {
  const map = {
    boot: { label: "NAME brain", cmd: "/os name watcher-eureka" },
    name: { label: "Pick LOBES", cmd: "/os lobes" },
    lobes: { label: "Pick TRIGGERS", cmd: "/os triggers" },
    triggers: { label: "FOLLOW step", cmd: "/os follow boot" },
    follow: { label: "Run SANDBOX", cmd: "/os sandbox" },
    sandbox: { label: "Refine LANGUAGE", cmd: "/os language" },
    language: { label: "SEAL stage", cmd: "/os seal" },
    seal: { label: "Confirm inject", cmd: "/vitafeed confirm" },
  };
  return map[step] || map.boot;
}

export function assertOsCallbacksFit() {
  const kb = buildOsBuilderKeyboard();
  const bad = [];
  for (const b of kb.inline_keyboard.flat()) {
    const c = b.callback_data || "";
    if (c && c.length > CALLBACK_DATA_MAX) bad.push(c);
  }
  return { ok: bad.length === 0, bad, max: CALLBACK_DATA_MAX };
}

export function parseOsBuilderCommand(raw) {
  const src = String(raw || "").trim();
  const low = src.toLowerCase();
  if (
    low === "/os" ||
    low === "/brainos" ||
    low === "/osbuilder" ||
    low === "/buildbrain" ||
    low === "/build"
  ) {
    return { ok: true, action: "home", body: "" };
  }
  if (
    !low.startsWith("/os ") &&
    !low.startsWith("/brainos ") &&
    !low.startsWith("/osbuilder ") &&
    !low.startsWith("/buildbrain ") &&
    !low.startsWith("/build ")
  ) {
    return { ok: false, action: null };
  }
  const rest = src.replace(/^\/(?:os|brainos|osbuilder|buildbrain|build)\s+/i, "").trim();
  const first = (rest.split(/\s+/)[0] || "").toLowerCase();
  const body = rest.slice(first.length).trim();
  const known = [
    "home", "boot", "name", "lobes", "triggers", "follow", "sandbox",
    "language", "seal", "demo", "status", "help", "next", "lexicon",
  ];
  if (known.includes(first)) {
    return { ok: true, action: first === "lexicon" ? "language" : first, body };
  }
  // /os <agentId> → name/resume
  return { ok: true, action: "name", body: rest };
}

function formatBootCard() {
  const lines = [];
  lines.push(OS_BUILDER_MAGIC + "v1|boot§");
  lines.push("C:\\VITA\\OS> BOOT");
  lines.push("━━━━━━━━━━━━━━━━━━━━");
  lines.push("formula=" + FORMULA_ID);
  lines.push("messageFirst=" + ORIGINAL_FORMULA.messageFirstWhenKeyLocCovered);
  lines.push("neverInvent=" + ORIGINAL_FORMULA.neverInventTxHash);
  lines.push("chain=" + MAINFRAME_ANCHORS.chain + ":" + MAINFRAME_ANCHORS.chainId);
  lines.push("wallet=" + MAINFRAME_ANCHORS.wallet);
  lines.push("");
  lines.push("CLASS PROOF ANCHORS (hardcoded — not body):");
  for (const a of MAINFRAME_ANCHORS.known) {
    lines.push("  " + a.id + " · " + a.kind + " · " + shortHex(a.tx, 10) + "…");
    lines.push("    " + MAINFRAME_ANCHORS.basescanTx + a.tx);
  }
  lines.push("");
  lines.push("You + machine build a brain: name → lobes → IFTTT → follow → sandbox → seal.");
  lines.push("Tap NEXT or open the CRT. Memory never erased — HTML until /inject.");
  return lines.join("\n");
}

function formatStatusCard(agent) {
  const state = loadOsBuilderState();
  const follow = state.followHead[agent.agentId] || { head: 0 };
  const lines = [];
  lines.push(OS_BUILDER_MAGIC + "v1|status§");
  lines.push("C:\\VITA\\OS\\" + agent.agentId.toUpperCase() + "> STATUS");
  lines.push("━━━━━━━━━━━━━━━━━━━━");
  lines.push("step=" + agent.step + "  status=" + agent.status);
  lines.push("openKey=" + agent.publicKey);
  lines.push("lobes=" + (agent.lobes || []).join(","));
  lines.push("triggers=" + (agent.triggers || []).join(","));
  lines.push("followHead=" + (follow.head || 0));
  lines.push(
    "sandbox " +
      (agent.sandbox?.lastRunId || "(none)") +
      "  pass=" +
      (agent.sandbox?.passed ?? 0) +
      " fail=" +
      (agent.sandbox?.failed ?? 0),
  );
  lines.push("commit=" + (agent.contentCommit ? shortHex(agent.contentCommit, 12) + "…" : "(unstaged)"));
  lines.push("locs=[] until real seal — never invented");
  return lines.join("\n");
}

function formatLobesCard(agent) {
  const lines = [];
  lines.push(OS_BUILDER_MAGIC + "v1|lobes§");
  lines.push("C:\\VITA\\OS> LOBES — pick recall modules");
  lines.push("active: " + (agent.lobes || []).join(", "));
  for (const l of OS_LOBES) {
    const on = (agent.lobes || []).includes(l.id) ? "[x]" : "[ ]";
    lines.push("  " + on + " " + l.label + " — " + l.role);
  }
  lines.push("");
  lines.push("Tap LOBES again after /os lobes formula,anchors,triggers");
  return lines.join("\n");
}

function formatTriggersCard(agent) {
  const lines = [];
  lines.push(OS_TRIGGER_MAGIC + "v1§");
  lines.push("C:\\VITA\\OS> TRIGGERS — IF THIS THEN THAT");
  lines.push("active: " + (agent.triggers || []).join(", "));
  for (const r of OS_TRIGGER_RECIPES) {
    const on = (agent.triggers || []).includes(r.id) ? "[x]" : "[ ]";
    lines.push("  " + on + " " + r.id);
    lines.push("     H: " + r.human);
    lines.push("     M: " + r.machine);
    if (r.proveAgainst) lines.push("     prove@" + r.proveAgainst);
  }
  lines.push("");
  lines.push("Sandbox fires these against real Base class proofs.");
  return lines.join("\n");
}

function formatFollowCard(agent) {
  const state = loadOsBuilderState();
  const head = state.followHead[agent.agentId];
  const v = verifyFollowChain(agent.agentId);
  const lines = [];
  lines.push(OS_FOLLOW_MAGIC + "v1§");
  lines.push("C:\\VITA\\OS> FOLLOW-THE-LEADER");
  lines.push("head=" + (head?.head || 0) + "  valid=" + String(v.valid));
  for (const s of head?.steps || []) {
    lines.push("  #" + s.chunkId + " " + s.label + "  " + shortHex(s.cellHash, 12));
  }
  if (!head?.steps?.length) {
    lines.push("(empty — /os follow <label> commits next cell)");
  }
  lines.push("Sequence must be +1. Gap = refuse (same as Proven Player registry).");
  return lines.join("\n");
}

function formatSandboxCard(run, follow) {
  const lines = [];
  lines.push(OS_BUILDER_MAGIC + "v1|sandbox§");
  lines.push("C:\\VITA\\OS> SANDBOX " + (run.ok === false ? "FAIL" : run.failed ? "FAIL" : "PASS"));
  lines.push("run=" + run.runId);
  lines.push("pass=" + run.passed + "  fail=" + run.failed + "  follow=" + String(follow?.valid));
  for (const r of run.results || []) {
    lines.push((r.pass ? "  ✓ " : "  ✗ ") + r.recipeId + (r.against ? " @" + r.against : ""));
    if (r.basescan) lines.push("    " + r.basescan);
    lines.push("    " + clip(r.human || r.machine, 90));
  }
  lines.push("");
  lines.push("Open Basescan → Input Data → View as UTF-8. Class proof ≠ body.");
  return lines.join("\n");
}

function formatLanguageCard() {
  const lex = loadOsLexicon();
  const lines = [];
  lines.push(OS_BUILDER_MAGIC + "v1|language§");
  lines.push("C:\\VITA\\OS> LANGUAGE — human ↔ machine");
  lines.push("pairs=" + lex.pairs.length + "  refined=" + lex.refinedCount);
  for (const p of lex.pairs.slice(0, 12)) {
    lines.push("  H: " + p.human);
    lines.push("  M: " + p.machine + (p.refined ? " ★" : ""));
  }
  lines.push("");
  lines.push("/os language <human> :: <machine>  — refine together");
  return lines.join("\n");
}

function formatSealCard(sealed) {
  const lines = [];
  lines.push(OS_BUILDER_MAGIC + "v1|seal§");
  lines.push("C:\\VITA\\OS> SEAL STAGED");
  lines.push("agent=" + sealed.agentId);
  lines.push("bytes=" + sealed.bytes + "  commit=" + shortHex(sealed.contentCommit, 16));
  lines.push("openKey=" + sealed.openKey);
  lines.push("sparse strands=" + sealed.sparsePlan.total);
  lines.push("locations=[]  availability=true  proven=false");
  lines.push("");
  lines.push("Next: /vitafeed confirm  or  /vitafeed override");
  lines.push("Buttons never auto-spend. Never invent hashes.");
  return lines.join("\n");
}

function formatHelpCard() {
  const lines = [];
  lines.push(OS_BUILDER_MAGIC + "v1|help§");
  lines.push("VITA OS BUILDER — click-through brain construction");
  lines.push("━━━━━━━━━━━━━━━━━━━━");
  lines.push("/os                  — CRT menu + wizard");
  lines.push("/os boot             — load formula + anchors");
  lines.push("/os name <id>        — name the agent brain");
  lines.push("/os lobes a,b,c      — pick recall modules");
  lines.push("/os triggers a,b     — IFTTT recipes");
  lines.push("/os follow <label>   — commit follow-leader step");
  lines.push("/os sandbox          — prove vs real Base anchors");
  lines.push("/os language H :: M  — refine dual lexicon");
  lines.push("/os seal             — stage for /vitafeed");
  lines.push("/os demo             — full watcher-eureka use case");
  lines.push("/os status           — current draft");
  lines.push("");
  lines.push("HOME → OS · Dir VITA:\\OS\\ · Agents chat shares the channel");
  return lines.join("\n");
}

/**
 * Telegram action router for /os|/brainos|/build.
 */
export function handleOsBuilderAction({
  action = "home",
  body = "",
} = {}) {
  const fit = assertOsCallbacksFit();
  let agent = getOsAgent() || startOsSession({ agentId: "new-brain" }).agent;
  let reply = "";
  let extra = {};

  if (action === "help") {
    reply = formatHelpCard();
  } else if (action === "boot" || action === "home") {
    startOsSession({ agentId: agent.agentId });
    setOsStep("boot", agent.agentId);
    agent = getOsAgent(agent.agentId);
    reply = formatBootCard() + "\n\n" + formatStatusCard(agent);
  } else if (action === "name") {
    const id = String(body || "").trim() || agent.agentId;
    const renamed = renameOsAgent(id, agent.agentId);
    agent = renamed.agent;
    reply = formatStatusCard(agent) + "\n\nnamed → tap LOBES next";
  } else if (action === "lobes") {
    if (body.trim()) {
      const ids = body.split(/[,\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
      const out = setOsLobes(ids, agent.agentId);
      if (!out.ok) {
        reply = "LOBES refused: " + out.reason + "\n\n" + formatLobesCard(agent);
      } else {
        agent = out.agent;
        reply = formatLobesCard(agent);
      }
    } else {
      reply = formatLobesCard(agent);
      setOsStep("lobes", agent.agentId);
    }
  } else if (action === "triggers") {
    if (body.trim()) {
      const ids = body.split(/[,\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
      const out = setOsTriggers(ids, agent.agentId);
      if (!out.ok) {
        reply = "TRIGGERS refused: " + out.reason + "\n\n" + formatTriggersCard(agent);
      } else {
        agent = out.agent;
        reply = formatTriggersCard(agent);
      }
    } else {
      reply = formatTriggersCard(agent);
      setOsStep("triggers", agent.agentId);
    }
  } else if (action === "follow") {
    const label = String(body || "").trim() || "wizard-step";
    const c = commitFollowStep({ agentId: agent.agentId, label, payload: label });
    agent = getOsAgent(agent.agentId);
    reply = formatFollowCard(agent) + "\n\ncommitted #" + c.step.chunkId;
  } else if (action === "sandbox") {
    const sand = runOsSandbox({ agentId: agent.agentId });
    agent = getOsAgent(agent.agentId);
    reply = formatSandboxCard(sand.run, sand.follow);
    extra.sandbox = sand;
  } else if (action === "language") {
    if (body.includes("::")) {
      const [h, m] = body.split("::").map((s) => s.trim());
      refineLexiconPair({ human: h, machine: m });
      const st = loadOsBuilderState();
      if (st.agents[agent.agentId]) {
        st.agents[agent.agentId].step = "seal";
        st.agents[agent.agentId].lexiconRefined = (st.agents[agent.agentId].lexiconRefined || 0) + 1;
        if (st.session) st.session.step = "seal";
        saveOsBuilderState(st);
      }
    } else {
      setOsStep("language", agent.agentId);
    }
    reply = formatLanguageCard();
  } else if (action === "seal") {
    const sealed = stageOsSeal(agent.agentId);
    reply = formatSealCard(sealed) + "\n\n" + clip(sealed.body, 400);
    extra.seal = sealed;
  } else if (action === "demo") {
    const demo = runOsUseCaseDemo();
    agent = getOsAgent(demo.agentId);
    reply =
      formatStatusCard(agent) +
      "\n\n" +
      formatSandboxCard(demo.sandbox.run, demo.sandbox.follow) +
      "\n\n" +
      formatSealCard(demo.seal);
    extra.demo = demo;
  } else if (action === "status" || action === "next") {
    if (action === "next") {
      const hint = nextStepHint(agent.step);
      return handleOsBuilderAction({
        action: (hint?.cmd || "/os boot").replace(/^\/os\s+/i, "").split(/\s+/)[0],
        body: (hint?.cmd || "").replace(/^\/os\s+\S+\s*/i, ""),
      });
    }
    reply = formatStatusCard(agent);
  } else {
    reply = formatHelpCard();
  }

  const keyboard = buildOsBuilderKeyboard(agent.agentId);
  return {
    ok: true,
    action,
    agentId: agent.agentId,
    reply,
    html: "<pre>" + esc(reply).slice(0, 3500) + "</pre>",
    keyboard,
    callbackFit: fit,
    ...extra,
  };
}

/** DOS dir entries for VITA:\OS\ */
export function osBuilderDirEntries() {
  const agents = listOsAgents();
  const lex = loadOsLexicon();
  const out = [
    {
      n: 1,
      name: "README.txt",
      kind: "os",
      bytes: 0,
      unlockName: "README.txt",
      english:
        "VITA OS Builder — DOS brain construction. /os · CRT /vita/os-builder. IFTTT triggers on Base kinds. Follow-the-leader. Sandbox vs anchors. Seal → /vitafeed.",
      machine: "OSBUILDER route=/os crt=/vita/os-builder magic=" + OS_BUILDER_MAGIC,
      locations: [],
      trueName: "os-builder",
    },
    {
      n: 2,
      name: "lexicon.txt",
      kind: "os",
      bytes: utf8Bytes(JSON.stringify(lex.pairs || [])),
      unlockName: "lexicon.txt",
      english: "Human↔machine lexicon — " + (lex.pairs || []).length + " pairs, " + (lex.refinedCount || 0) + " refined",
      machine: "OSLEXICON pairs=" + (lex.pairs || []).length + " refined=" + (lex.refinedCount || 0),
      locations: [],
      trueName: "os-lexicon",
    },
  ];
  let n = 3;
  for (const a of agents) {
    out.push({
      n: n++,
      name: sanitizeAgentId(a.agentId) + ".brain",
      kind: "agent",
      bytes: 0,
      unlockName: a.agentId + ".brain",
      english:
        "Agent brain draft step=" +
        a.step +
        " status=" +
        a.status +
        " triggers=" +
        (a.triggers || []).length,
      machine:
        "VITAAGENT id=" +
        a.agentId +
        " step=" +
        a.step +
        " key=" +
        a.publicKey +
        " commit=" +
        (a.contentCommit ? shortHex(a.contentCommit, 8) : "none"),
      locations: Array.isArray(a.sealedLocs) ? a.sealedLocs.filter((h) => /^0x[0-9a-fA-F]{64}$/.test(h)) : [],
      trueName: a.agentId,
    });
  }
  // Always expose storage-token as peer channel
  if (!agents.some((a) => a.agentId === STORAGE_TOKEN_AGENT_ID)) {
    const open = osBuilderOpenKey(STORAGE_TOKEN_AGENT_ID);
    out.push({
      n: n++,
      name: "storage-token.peer",
      kind: "agent",
      bytes: 0,
      unlockName: "storage-token.peer",
      english: "Peer agent-chat channel — /agents chat shares path with OS builder brains",
      machine: "AGENTCHAT peer=storage-token key=" + open.key,
      locations: [],
      trueName: "storage-token",
    });
  }
  return { subdir: OS_BUILDER_SUBDIR, entries: out };
}

/** Public JSON snapshot for CRT / HTTP. */
export function publicOsBuilderState() {
  const state = loadOsBuilderState();
  const lex = loadOsLexicon();
  const session = state.session;
  const agent = session ? state.agents[session.agentId] : null;
  return {
    id: OS_BUILDER_ID,
    filingLabel: OS_BUILDER_LABEL,
    formula: FORMULA_ID,
    magic: OS_BUILDER_MAGIC,
    steps: OS_STEPS,
    lobes: OS_LOBES,
    triggers: OS_TRIGGER_RECIPES.map((r) => ({
      id: r.id,
      human: r.human,
      machine: r.machine,
      proveAgainst: r.proveAgainst,
    })),
    session,
    agent,
    agents: listOsAgents().map((a) => ({
      agentId: a.agentId,
      step: a.step,
      status: a.status,
      sandbox: a.sandbox,
      publicKey: a.publicKey,
    })),
    lexicon: {
      pairs: lex.pairs.length,
      refined: lex.refinedCount,
      sample: lex.pairs.slice(0, 6),
    },
    anchors: MAINFRAME_ANCHORS.known.map((a) => ({
      id: a.id,
      kind: a.kind,
      tx: a.tx,
      basescan: MAINFRAME_ANCHORS.basescanTx + a.tx,
    })),
    neverInventHashes: true,
    hitchClassBytes: KEY_LOC_HITCH_BYTES_CLASS,
  };
}

// Seed lexicon file on first import if missing
if (!existsSync(LEXICON_PATH)) {
  try {
    saveJson(LEXICON_PATH, emptyLexicon());
  } catch { /* read-only fs */ }
}
