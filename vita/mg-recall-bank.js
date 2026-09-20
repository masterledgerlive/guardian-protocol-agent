/**
 * Mother-genesis memory bank for simple recall.
 *
 * Force-banks (does not invent tx hashes) the stack mother genesis would
 * inscribe. Pulling the sealed location reconstructs every layer; the LAST
 * layer is the refined query catalogue so an LLM reads the search index
 * after the notes.
 *
 * Mother brain (5-chunk vitaSave) stays untouched.
 * Paid seal still needs /vitamothergenesis CONFIRM + VITA_MOTHER_GENESIS_AUTO.
 * This FORCE path only banks hex + the local recall package.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FORMULA_ID, MAINFRAME_ANCHORS, ORIGINAL_FORMULA } from "./mainframe.js";
import {
  attachFullLines,
  formatMotherGenesisReceipt,
  preparePlainMotherGenesis,
  resetMotherGenesisRegistry,
  revealMotherGenesis,
  runMotherGenesisInscribe,
  setMotherGenesisRegistry,
} from "./mother-genesis.js";
import { wrapMotherGenesisSelfCall } from "./feed-wrap.js";
import {
  CALCULATOR_TRUE_NAME,
  PROVEN_TEST_CASES,
  TRANSLATOR_CODEX,
  searchRefMemory,
} from "./ref-memory.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const MEMORY_DIR = join(HERE, "memory");
const DEFAULT_PATH = join(MEMORY_DIR, "mg-recall-bank.json");

export const MG_RECALL_ID = "vita-mg-recall-bank-v1";
export const MG_RECALL_MAGIC = "§MGRECALL§";
export const MG_LAYER_MAGIC = "§MGLAYER§";
export const MG_RECALL_LABEL = "MG_RECALL";
export const RECALL_LAST_LAYER = "REFINED_QUERIES";

/** Bottom → top. Last layer is always the refined query index. */
export const RECALL_LAYER_ORDER = Object.freeze([
  "FORMULA",
  "ANCHORS",
  "FILING",
  "NOTES",
  "LEARN",
  "REFINED_QUERIES",
]);

const SKIP_NOTE_FILES = new Set([
  "mg-recall-bank.json",
  "vitafeed-backlog.json",
  "brain-learn-log.json",
]);

let _pathOverride = null;

export function setMgRecallPathForTests(path) {
  _pathOverride = path || null;
}

function recallPath() {
  return _pathOverride || DEFAULT_PATH;
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

function clip(text, n = 280) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, n);
}

function layerBlock(index, total, id, role, body) {
  return (
    MG_LAYER_MAGIC +
    index +
    "/" +
    total +
    "|id=" +
    id +
    "|role=" +
    role +
    "§\n" +
    String(body || "").trim() +
    "\n"
  );
}

function collectNoteLines() {
  const lines = [];
  let files = [];
  try {
    files = readdirSync(MEMORY_DIR).filter((f) => f.endsWith(".json")).sort();
  } catch {
    files = [];
  }
  for (const file of files) {
    if (SKIP_NOTE_FILES.has(file)) continue;
    const raw = safeReadJson(join(MEMORY_DIR, file));
    if (!raw || typeof raw !== "object") continue;
    const topic = String(raw.topic || file.replace(/\.json$/i, ""));
    const label = String(raw.filingLabel || "MEMORY");
    const text = clip(raw.text || raw.learn || raw.note || "");
    const locs = [];
    const walk = (node) => {
      if (!node) return;
      if (typeof node === "string" && isTxHash(node)) locs.push(node.toLowerCase());
      else if (Array.isArray(node)) node.forEach(walk);
      else if (typeof node === "object") {
        if (isTxHash(node.location)) locs.push(String(node.location).toLowerCase());
        if (isTxHash(node.tx)) locs.push(String(node.tx).toLowerCase());
      }
    };
    walk(raw.locations);
    const loc8 = [...new Set(locs)].map((t) => t.slice(2, 10)).join(",");
    lines.push(topic + "|" + label + "|" + (loc8 ? "loc8=" + loc8 + "|" : "") + text);
  }
  return lines;
}

function learnLayerBody() {
  const log = safeReadJson(join(MEMORY_DIR, "brain-learn-log.json"));
  const roots = log?.zeroProof?.roots || [];
  const last = roots.length ? roots[roots.length - 1] : "";
  const lines = [
    "content commits only — not tx hashes",
    "cycles=" + (log?.cycles?.length || 0),
    "genesis=" + (log?.zeroProof?.genesis || ""),
    "lastRoot=" + last,
    "formula=" + (log?.formula || FORMULA_ID),
  ];
  return lines.join("\n");
}

function refinedQueriesBody() {
  const aliases = TRANSLATOR_CODEX.trueNames[CALCULATOR_TRUE_NAME] || [];
  const lines = [
    "LAST LAYER — refined query index. After you pull the location, read this layer last.",
    "It is the search catalogue for every note in the layers below.",
    "trueName=" + CALCULATOR_TRUE_NAME,
    "aliases=" + aliases.join(","),
    "search=/vitafeed ref <q>  ·  series=/vitafeed proven",
    "refuseInvent=true",
  ];
  for (const c of PROVEN_TEST_CASES) {
    const found = searchRefMemory(c.query);
    const cites = (found.citations || []).map((x) => x.loc8).join(",") || "-";
    lines.push(
      [
        c.id,
        "q=" + JSON.stringify(c.query),
        "intent=" + (found.intent || ""),
        "true=" + (found.trueName || "none"),
        "proven=" + (found.proven ? "yes" : "no"),
        "cites=" + cites,
      ].join("|"),
    );
  }
  lines.push(
    "benefit=one mother-genesis location reconstructs formula+anchors+filing+notes+learn; this last layer answers any packaged query",
  );
  return lines.join("\n");
}

export function buildRecallLayers() {
  const anchors = MAINFRAME_ANCHORS.known.map(
    (a) => a.id + "|" + a.kind + "|" + a.tx + "|" + clip(a.lesson || a.label, 120),
  );
  const bodies = {
    FORMULA: [
      "formula=" + FORMULA_ID,
      "html=memory until /inject",
      "hitch=KEY+LOC when covered",
      "prove=Eureka on /prove",
      "messageFirst=" + (ORIGINAL_FORMULA.messageFirstWhenKeyLocCovered ? "yes" : "no"),
      "neverInventTxHash=true",
      "neverMuteHitchForMicroExtract=true",
    ].join("\n"),
    ANCHORS: [
      "chain=" + MAINFRAME_ANCHORS.chain + ":" + MAINFRAME_ANCHORS.chainId,
      "wallet=" + MAINFRAME_ANCHORS.wallet,
      "basescan=" + MAINFRAME_ANCHORS.basescanTx,
      ...anchors,
    ].join("\n"),
    FILING: [
      "FORMULA frozen invariants",
      "ANCHORS hardcoded Base txs",
      "MEMORY append-only notes",
      "STRAND sparse inject plans",
      "BRAIN_LEARN old→new",
      "PEER_REVIEW one review",
      "ZERO_PROOF squashed retrieval growth",
      "REF_LIB trueName ask|self",
      "PROVEN_TEST recursive search series",
      "TRANSLATOR_CODEX free multilingual aliases",
      "MG_RECALL this stack — last layer is refined queries",
      "MOTHER_GENESIS N-batch plain/encoded — not the 5-chunk mother brain",
    ].join("\n"),
    NOTES: collectNoteLines().join("\n"),
    LEARN: learnLayerBody(),
    REFINED_QUERIES: refinedQueriesBody(),
  };

  return RECALL_LAYER_ORDER.map((id, i) => ({
    index: i + 1,
    total: RECALL_LAYER_ORDER.length,
    id,
    role: id === RECALL_LAST_LAYER ? "last" : "note",
    body: bodies[id],
  }));
}

export function renderRecallBank(layers = buildRecallLayers()) {
  const last = layers[layers.length - 1];
  const head =
    MG_RECALL_MAGIC +
    "v1|layers=" +
    layers.length +
    "|last=" +
    (last?.id || "") +
    "§\n" +
    "simple-recall=pull MGPLAIN location → join chunks in order → notes are the stack\n" +
    "read-last=" +
    RECALL_LAST_LAYER +
    " (refined queries — search index for every layer below)\n" +
    "formula=" +
    FORMULA_ID +
    "\n" +
    "neverInvent=true\n";
  const blocks = layers.map((layer) =>
    layerBlock(layer.index, layer.total, layer.id, layer.role, layer.body),
  );
  return head + blocks.join("");
}

export function parseRecallStack(body) {
  const s = String(body || "");
  const head = s.match(/§MGRECALL§v1\|layers=(\d+)\|last=([A-Z0-9_]+)§/);
  const parts = s.split(MG_LAYER_MAGIC).slice(1);
  const layers = [];
  for (const part of parts) {
    const m = part.match(/^(\d+)\/(\d+)\|id=([^|]+)\|role=([^§]+)§\n?([\s\S]*)$/);
    if (!m) continue;
    layers.push({
      index: Number(m[1]),
      total: Number(m[2]),
      id: m[3],
      role: m[4],
      body: m[5].trim(),
    });
  }
  const last = layers[layers.length - 1] || null;
  const ok =
    Boolean(head) &&
    layers.length === RECALL_LAYER_ORDER.length &&
    last?.id === RECALL_LAST_LAYER &&
    last?.role === "last" &&
    head[2] === RECALL_LAST_LAYER;
  return {
    ok,
    declaredLayers: head ? Number(head[1]) : 0,
    declaredLast: head ? head[2] : null,
    layers,
    last,
    formula: FORMULA_ID,
  };
}

export function buildMotherGenesisRecallBody() {
  const layers = buildRecallLayers();
  const body = renderRecallBank(layers);
  const stack = parseRecallStack(body);
  return { ok: stack.ok, body, layers, stack };
}

function persistRecord(record) {
  const path = recallPath();
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(record, null, 2) + "\n", "utf8");
  return path;
}

export function loadRecallBank() {
  return safeReadJson(recallPath());
}

/**
 * Force the recall stack into the mother-genesis bank.
 * Default sender banks hex and returns no hash — never invents a tx.
 * Optional sendTx may return a real hash; non-hashes are refused.
 */
export async function forceInjectMotherGenesisRecall({ sendTx = null, persist = true } = {}) {
  const built = buildMotherGenesisRecallBody();
  if (!built.ok) {
    return { ok: false, reason: "recall stack failed to parse — last layer must be refined queries" };
  }
  const prepared = preparePlainMotherGenesis(built.body);
  if (!prepared.ok) return prepared;

  const result = await runMotherGenesisInscribe(prepared, async (hex, line) => {
    wrapMotherGenesisSelfCall({
      data: hex,
      text: line?.line || "",
      topic: "mg-recall",
      pairedUniswapSell: false,
    });
    if (typeof sendTx !== "function") return null;
    const tx = await sendTx(hex, line);
    if (tx == null || tx === "") return null;
    if (!isTxHash(tx)) {
      throw new Error("sender returned non-hash — refuse invent");
    }
    return tx;
  });

  attachFullLines(prepared.strandId, prepared.lines);
  const locations = (result.strand?.locations || []).filter(isTxHash);
  const record = {
    id: MG_RECALL_ID,
    filingLabel: MG_RECALL_LABEL,
    formula: FORMULA_ID,
    at: new Date().toISOString(),
    neverInventHashes: true,
    neverForget: true,
    motherBrainUntouched: true,
    forceBanked: locations.length < prepared.totalChunks,
    sealed: locations.length === prepared.totalChunks && prepared.totalChunks > 0,
    strandId: prepared.strandId,
    readerKey: prepared.readerKey,
    contentCommit: prepared.contentCommit,
    totalChunks: prepared.totalChunks,
    layerIds: built.layers.map((l) => l.id),
    lastLayer: RECALL_LAST_LAYER,
    locations,
    body: built.body,
    lines: prepared.lines.map((l) => l.line),
    note:
      "Force-banked mother-genesis recall stack. Pull reader key after seal; " +
      "until then the full body (all notes + last refined queries) lives in this bank. " +
      "Paid chain seal still needs CONFIRM + VITA_MOTHER_GENESIS_AUTO. No invented hashes.",
  };
  const path = persist ? persistRecord(record) : null;
  return {
    ok: true,
    banked: record.forceBanked,
    sealed: record.sealed,
    record,
    path,
    receipt: formatMotherGenesisReceipt(result),
    stack: built.stack,
  };
}

/**
 * Simple recall: local bank now; chain pull when locations are real hashes.
 */
export async function pullMotherGenesisRecall({ fetchCalldata } = {}) {
  const stored = loadRecallBank();
  if (!stored?.body && !(stored?.lines || []).length) {
    return {
      ok: false,
      reason: "no recall bank — run /vitamothergenesis FORCE recall",
    };
  }

  let body = stored.body || "";
  let source = "memory-bank";
  const locations = (stored.locations || []).filter(isTxHash);

  if (locations.length && stored.lines?.length && typeof fetchCalldata === "function") {
    resetMotherGenesisRegistry();
    setMotherGenesisRegistry({
      strands: [
        {
          strandId: stored.strandId,
          mode: "plain",
          nonce: "recall",
          contentCommit: stored.contentCommit,
          totalChunks: stored.lines.length,
          chunks: stored.lines.map((line, i) => ({
            index: i + 1,
            total: stored.lines.length,
            fullLine: line,
            txHash: locations[i] || null,
            location: locations[i] || null,
          })),
          locations,
          readerKey: stored.readerKey,
        },
      ],
    });
    const revealed = await revealMotherGenesis(stored.readerKey, { fetchCalldata });
    if (revealed.ok) {
      body = revealed.body;
      source = "blockchain";
    }
  }

  const stack = parseRecallStack(body);
  return {
    ok: stack.ok,
    source,
    banked: !locations.length,
    readerKey: stored.readerKey || null,
    strandId: stored.strandId || null,
    locations,
    lastLayer: stack.last,
    stack,
    benefit:
      "Pull this location to get every attached note. The last layer is the refined query index — search from there, trust the layers below, never invent a hash.",
  };
}

export function formatRecallPullCard(result) {
  const rec = result?.record || result || {};
  const lines = [];
  lines.push(MG_RECALL_MAGIC + " FORCE BANK · filing=" + MG_RECALL_LABEL);
  lines.push("formula=" + FORMULA_ID);
  lines.push("neverInvent=true");
  lines.push("motherBrain=untouched");
  lines.push("strand=" + (rec.strandId || "—"));
  lines.push("reader=" + (rec.readerKey || "—"));
  lines.push("chunks=" + (rec.totalChunks || 0));
  lines.push("layers=" + (rec.layerIds || []).join(" → "));
  lines.push("last=" + (rec.lastLayer || RECALL_LAST_LAYER));
  if (rec.sealed && (rec.locations || []).length) {
    lines.push("sealed locs:");
    for (const tx of rec.locations) lines.push("  " + tx);
    lines.push("pull: /encodegenesisreveal " + rec.readerKey);
  } else {
    lines.push("chain locs: none yet — hex force-banked (wrapMotherGenesisSelfCall)");
    lines.push("paid seal: /vitamothergenesis CONFIRM <body> + VITA_MOTHER_GENESIS_AUTO=yes");
    lines.push("until seal: pull the memory bank — notes + last query layer are already attached");
  }
  lines.push(
    "benefit: one pull returns the stack; last layer lists every refined query (calculator true-name, ask|self, translator aliases) with Base loc8 cites only",
  );
  if (result?.path) lines.push("bank=" + result.path);
  return lines.join("\n");
}
