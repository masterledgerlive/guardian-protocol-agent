/**
 * VITAFEED knowledge file loader — curated packs → dual-lane preload → backlog.
 *
 * Overlap note (intentional, not a second queue):
 *   backlog (`vita-feed-backlog.js`) already enqueues memory for drain.
 *   This loader is the *curated brain diet* + human/machine cost mirror +
 *   Telegram “did you know” / capability-proof recall + cipher hierarchy.
 *   It feeds INTO the backlog; it does not replace it.
 *
 * Grows the library with programming + cipher context so recursive memory
 * can encode/decode and refine architecture. Never invents tx hashes.
 * Mother brain untouched.
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
import { prepareDualLaneCompare, formatDualLaneSideBySideCard } from "./vita-feed-dual.js";
import {
  enqueueFeedBacklogItem,
  formatFeedBacklogCard,
  listFeedBacklog,
} from "./vita-feed-backlog.js";
import { listLibraryEntries } from "./vita-feed-library.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const MEMORY_DIR = join(HERE, "memory");

export const FEED_LOADER_ID = "vita-feed-loader-v1";
export const FEED_LOADER_MAGIC = "§VITALOAD§";
export const FEED_LOADER_LABEL = "FEED_LOADER";
export const CIPHER_HIERARCHY_LABEL = "CIPHER";
export const PROG_HIERARCHY_LABEL = "PROG";

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
  if (t.length <= n) return t;
  return t.slice(0, Math.max(0, n - 1)) + "…";
}

function ensureMemoryDir() {
  if (!existsSync(MEMORY_DIR)) mkdirSync(MEMORY_DIR, { recursive: true });
}

/**
 * Curated packs the system benefits from as agentic memory grows.
 * HUMAN = readable plain. MACHINE = compact filing line (dual-lane priced).
 */
export const KNOWLEDGE_PACKS = Object.freeze([
  Object.freeze({
    id: "cipher-aes-gcm",
    hierarchy: "CIPHER\\AES-GCM",
    filingLabel: CIPHER_HIERARCHY_LABEL,
    kind: "cipher",
    title: "AES-256-GCM encode ↔ decode on Base",
    human:
      "Cipher hierarchy: AES-256-GCM authenticates ciphertext. Salt+IV per seal. " +
      "Vault path: encryptkey.js → on-chain blob → DECRYPT_PASSWORD reveals. " +
      "Mother-genesis encoded path: /vitamotherGenesisencoded → MG1+MG2 two-part key → " +
      "/encodegenesisreveal pulls spaced locs and decodes. Never invent hashes. " +
      "Open-source file-name unlock (vita-dir) is NOT a cipher key — different lane.",
    machine:
      "CIPHER AES-256-GCM | salt+iv+tag | vault=encryptkey | MG=MGENC+MG1/MG2 | " +
      "reveal=/encodegenesisreveal | neverInvent=1",
    didYouKnow:
      "Hey — did you know the same knowledge can live as HUMAN plain AND MACHINE " +
      "ZK-short, while encoded mother-genesis dumps use a two-part MG1/MG2 key so " +
      "locations commit without exposing payload until reveal?",
    capability:
      "NEW with chains: seal dual-lane cipher notes → Basescan Input Data UTF-8 chat " +
      "proves the human lesson; pull MG locs later to decode the private dump.",
    sourceFiles: ["encryptkey.js", "vita/mother-genesis.js", "vita/vita-feed-dual.js"],
  }),
  Object.freeze({
    id: "prog-architecture-refine",
    hierarchy: "PROG\\ARCHITECTURE",
    filingLabel: PROG_HIERARCHY_LABEL,
    kind: "programming",
    title: "Programming context for architecture refine",
    human:
      "Programming files as memory: read vita/ modules (feed, dual, backlog, dir, " +
      "mainframe) to refine architecture without deleting genesis. Append-only " +
      "vita/memory + vita/strands. Message-first hitch. HTML infect until /inject. " +
      "Sparse inject from sealed Base anchors only. Agents write hypotheses, never " +
      "rewrite sealed UTF-8. Hierarchy: FORMULA → ANCHORS → MEMORY → STRAND → " +
      "CIPHER → PROG → LIBRARY.",
    machine:
      "PROG arch=vita/ | append=memory+strands | hitch=message-first | " +
      "inject=sparse-anchors | html=until-inject | neverEraseGenesis=1",
    didYouKnow:
      "Hey — did you know Telegram /vitafeed dir unlocks English+machine blocks by " +
      "file name (no private key), so agentic AI filing is visible like a DOS tree?",
    capability:
      "NEW with chains: preload programming notes into the backlog, dual-price them, " +
      "seal when funded — recursive memory gains code context it can cite by loc.",
    sourceFiles: [
      "vita/mainframe.js",
      "vita/vita-feed.js",
      "vita/vita-dir.js",
      "vita/FILING.md",
    ],
  }),
  Object.freeze({
    id: "recursive-llm-memory",
    hierarchy: "MEMORY\\RECURSIVE",
    filingLabel: "MEMORY",
    kind: "recall",
    title: "Interact with VITA like an LLM over sealed knowledge",
    human:
      "Recursive memory LLM stance: answers cite sealed Base locs + packaged memory. " +
      "/vitafeed ref|ask|proven for calculator true-name + translator. " +
      "/vitafeed know for did-you-know cards. /vitafeed recall for capability proofs. " +
      "/vitafeed load preloads curated packs into backlog (batch now or later). " +
      "Language grows: human lane for people, machine lane for agents — same commit.",
    machine:
      "LLM stance=cite-locs | ref|ask|proven | know=didYouKnow | recall=capability | " +
      "load=preload→backlog | dual=human↔machine",
    didYouKnow:
      "Hey — did you know /vitafeed proof already grows zero-proof roots while the " +
      "loader only curates *what* to feed next — backlog still owns the queue?",
    capability:
      "NEW with chains: ask the bot like an LLM; it answers from filed hierarchy and " +
      "points at Basescan chat — learning what recursive memory can do as packs seal.",
    sourceFiles: ["vita/ref-memory.js", "vita/brain-learn.js", "vita/vita-feed-loader.js"],
  }),
  Object.freeze({
    id: "dual-lane-cost-mirror",
    hierarchy: "VITADUAL\\COST",
    filingLabel: "VITADUAL",
    kind: "cost",
    title: "Human mirror + cost compare for every preload",
    human:
      "Every loader pack is dual-priced: HUMAN bytes/injections/$ vs MACHINE " +
      "ZK-short bytes/injections/$. Telegram shows side-by-side before confirm. " +
      "Spaced locs bunch on the receipt; Basescan Input Data → UTF-8 is the chat.",
    machine:
      "DUAL cost=side-by-side | receipt=basescan-utf8 | spaced=bunched | " +
      "restartExit=$0.50",
    didYouKnow:
      "Hey — did you know /vitafeed restart lists bags ≥ $0.50 so you can free RISK " +
      "fuel and keep proving inject costs without vault spend?",
    capability:
      "NEW with chains: preload animation shows the batch waiting; confirm drains " +
      "HUMAN then MACHINE so humans and agents share one knowledge commit.",
    sourceFiles: ["vita/vita-feed-dual.js", "vita/vita-feed.js"],
  }),
]);

/** Thought note — this loader rides existing backlog/library/dir; do not fork queues. */
export const LOADER_THOUGHT_NOTE = Object.freeze({
  id: "loader-overlap-thought",
  at: "2026-09-20T17:29:00.000Z",
  thought:
    "Repeated thought check: backlog enqueue, library files/play/keys, DOS dir unlock, " +
    "dual-lane translate, brain seed, and mg-recall already cover most of “preload + " +
    "human mirror + hierarchy.” This FEED_LOADER layer is the curated diet + animated " +
    "preload card + did-you-know/capability recall — it feeds the backlog, not a twin queue.",
  reuse: [
    "vita/vita-feed-backlog.js",
    "vita/vita-feed-library.js",
    "vita/vita-dir.js",
    "vita/vita-feed-dual.js",
    "vita/brain-seed.js",
    "vita/mg-recall-bank.js",
  ],
});

/**
 * Build exact UTF-8 body for a pack (HUMAN lane content + filing header).
 */
export function buildPackFeedBody(pack) {
  const p = pack || {};
  const lines = [];
  lines.push(
    FEED_LOADER_MAGIC +
      "v1|id=" +
      (p.id || "pack") +
      "|hier=" +
      (p.hierarchy || "") +
      "|filing=" +
      (p.filingLabel || FEED_LOADER_LABEL) +
      "§",
  );
  lines.push("VITAFEED LOADER PACK · " + (p.title || p.id));
  lines.push("hierarchy=" + (p.hierarchy || "—"));
  lines.push("kind=" + (p.kind || "knowledge"));
  lines.push("formula=" + FORMULA_ID);
  lines.push("neverInvent=true");
  lines.push("wallet=" + MAINFRAME_ANCHORS.wallet);
  lines.push("--- HUMAN ---");
  lines.push(String(p.human || ""));
  lines.push("--- MACHINE ---");
  lines.push(String(p.machine || ""));
  if (p.sourceFiles?.length) {
    lines.push("--- SOURCES ---");
    for (const f of p.sourceFiles) lines.push("  " + f);
  }
  return lines.join("\n");
}

export function listKnowledgePacks() {
  return KNOWLEDGE_PACKS.map((p) => ({
    id: p.id,
    hierarchy: p.hierarchy,
    filingLabel: p.filingLabel,
    kind: p.kind,
    title: p.title,
    humanBytes: Buffer.byteLength(p.human || "", "utf8"),
    machineBytes: Buffer.byteLength(p.machine || "", "utf8"),
  }));
}

export function getKnowledgePack(idOrHier) {
  const q = String(idOrHier || "").trim().toLowerCase();
  if (!q) return null;
  return (
    KNOWLEDGE_PACKS.find(
      (p) =>
        p.id.toLowerCase() === q ||
        p.hierarchy.toLowerCase() === q ||
        p.hierarchy.toLowerCase().replace(/\\/g, "/") === q.replace(/\\/g, "/"),
    ) || null
  );
}

/**
 * Dual-price a pack for human ↔ machine cost compare (Telegram card).
 */
export function pricePackDual(pack, quotes = {}) {
  const p = typeof pack === "string" ? getKnowledgePack(pack) : pack;
  if (!p) return { ok: false, reason: "unknown pack" };
  const humanBody = buildPackFeedBody(p);
  const dual = prepareDualLaneCompare(humanBody, quotes, {
    trueName: p.id,
  });
  if (!dual.ok) return dual;
  return {
    ok: true,
    pack: p,
    dual,
    card: formatDualLaneSideBySideCard(dual, { phase: "preload" }),
  };
}

/**
 * Preload curated packs into the existing backlog (batch now or later).
 * Does not send. Dedupes via backlog contentCommit.
 */
export function preloadKnowledgePacks({
  packIds = null,
  quotes = {},
  includeAll = true,
} = {}) {
  const selected = [];
  if (Array.isArray(packIds) && packIds.length) {
    for (const id of packIds) {
      const p = getKnowledgePack(id);
      if (p) selected.push(p);
    }
  } else if (includeAll) {
    selected.push(...KNOWLEDGE_PACKS);
  }
  const added = [];
  const skipped = [];
  const priced = [];
  for (const pack of selected) {
    const body = buildPackFeedBody(pack);
    const dualPrice = pricePackDual(pack, quotes);
    if (dualPrice.ok) priced.push(dualPrice);
    const r = enqueueFeedBacklogItem({
      body,
      topic: "loader-" + pack.id,
      name: sanitizePackFileName(pack),
      kind: "loader",
      source: "feed-loader",
    });
    if (r.ok && !r.deduped) added.push({ ...r.item, packId: pack.id, hierarchy: pack.hierarchy });
    else if (r.deduped) skipped.push({ packId: pack.id, reason: "deduped" });
    else skipped.push({ packId: pack.id, reason: r.reason || "enqueue-fail" });
  }
  const backlog = listFeedBacklog({ limit: 24 });
  return {
    ok: true,
    id: FEED_LOADER_ID,
    added,
    skipped,
    priced,
    pending: backlog.growth?.pending ?? backlog.items?.filter((i) => i.status === "pending").length,
    animation: buildPreloadAnimationFrames({
      packs: selected,
      added,
      priced,
    }),
    card: formatLoaderPreloadCard({
      added,
      skipped,
      priced,
      backlog,
    }),
    thought: LOADER_THOUGHT_NOTE.thought,
  };
}

function sanitizePackFileName(pack) {
  const hier = String(pack.hierarchy || pack.id || "pack")
    .replace(/[^\w.\-\\]+/g, "_")
    .replace(/\\/g, "__");
  return hier + ".txt";
}

/**
 * Text animation frames for Telegram (cool preload of files waiting to batch).
 */
export function buildPreloadAnimationFrames({ packs = [], added = [], priced = [] } = {}) {
  const frames = [];
  frames.push("⋯ spinning up FEED_LOADER · curated diet");
  const names = (packs.length ? packs : added).map(
    (p) => p.hierarchy || p.packId || p.id || p.name || "?",
  );
  for (let i = 0; i < names.length; i++) {
    const bar =
      "█".repeat(i + 1) + "░".repeat(Math.max(0, names.length - i - 1));
    frames.push(
      "[" + bar + "]  " + (i + 1) + "/" + names.length + "  " + names[i],
    );
  }
  let totalUsd = 0;
  for (const pr of priced) {
    if (pr.dual?.combined?.totalUsd) totalUsd += pr.dual.combined.totalUsd;
  }
  frames.push(
    "ready · " +
      added.length +
      " queued · dual both-lanes ≈$" +
      totalUsd.toFixed(4) +
      " · drain: /vitafeed next",
  );
  frames.push("soon: more files as you drop them in · library grows · cipher+prog hierarchy");
  return {
    frames,
    durationHintMs: 120 * Math.max(3, frames.length),
    card: frames.join("\n"),
  };
}

export function formatLoaderPreloadCard({
  added = [],
  skipped = [],
  priced = [],
  backlog = null,
} = {}) {
  const lines = [];
  lines.push(FEED_LOADER_MAGIC + "v1|phase=preload§");
  lines.push("VITAFEED LOADER · curated knowledge → backlog");
  lines.push("(rides existing backlog — not a twin queue)");
  lines.push("added=" + added.length + "  skipped=" + skipped.length);
  for (const a of added.slice(0, 12)) {
    lines.push(
      "  + " +
        (a.hierarchy || a.packId || a.topic || a.name) +
        "  chunks≈" +
        (a.chunks || "?"),
    );
  }
  if (added.length > 12) lines.push("  … +" + (added.length - 12) + " more");
  if (priced.length) {
    lines.push("");
    lines.push("— DUAL COST MIRROR (human ↔ machine) —");
    for (const pr of priced.slice(0, 6)) {
      const c = pr.dual?.combined;
      if (!c) continue;
      lines.push(
        "  " +
          (pr.pack?.id || "?") +
          "  H=" +
          c.humanBytes +
          "B/$" +
          (pr.dual.human.cost?.totalUsd ?? 0).toFixed(4) +
          "  M=" +
          c.machineBytes +
          "B/$" +
          (pr.dual.machine.cost?.totalUsd ?? 0).toFixed(4) +
          "  both≈$" +
          c.totalUsd.toFixed(4),
      );
    }
  }
  lines.push("");
  lines.push(
    backlog
      ? formatFeedBacklogCard(backlog).split("\n").slice(0, 6).join("\n")
      : "backlog: /vitafeed backlog",
  );
  lines.push("");
  lines.push("batch now: /vitafeed next → confirm|override");
  lines.push("later: packs wait pending — thrift drain when ready");
  lines.push("animate: /vita/feed-loader · know: /vitafeed know · recall: /vitafeed recall");
  return lines.join("\n");
}

/**
 * “Hey did you know” card — human-readable recall from curated + sealed library.
 */
export function formatDidYouKnowCard({ packId = null, rotate = 0 } = {}) {
  const packs = KNOWLEDGE_PACKS;
  let pack = packId ? getKnowledgePack(packId) : null;
  if (!pack) {
    const i = Math.abs(Number(rotate) || 0) % packs.length;
    pack = packs[i];
  }
  const lib = listLibraryEntries();
  const sealed = lib.filter((e) => (e.locations || []).some(isTxHash));
  const lines = [];
  lines.push(FEED_LOADER_MAGIC + " KNOW");
  lines.push("Hey — did you know…");
  lines.push("");
  lines.push(pack.didYouKnow);
  lines.push("");
  lines.push("hierarchy: " + pack.hierarchy);
  lines.push("machine: " + clip(pack.machine, 100));
  if (sealed.length) {
    lines.push("");
    lines.push("on-chain library recall (real locs only):");
    for (const e of sealed.slice(0, 5)) {
      const tx = (e.locations || []).find(isTxHash);
      lines.push(
        "  #" +
          e.n +
          " " +
          clip(e.name, 28) +
          "  " +
          shortHex(tx, 8) +
          "…  " +
          MAINFRAME_ANCHORS.basescanTx +
          tx,
      );
    }
  } else {
    lines.push("");
    lines.push("(library empty of sealed locs yet — /vitafeed load then next|confirm)");
  }
  lines.push("");
  lines.push("more: /vitafeed know " + ((Math.abs(Number(rotate) || 0) + 1) % packs.length));
  lines.push("proof capability: /vitafeed recall");
  return lines.join("\n");
}

/**
 * Proof of something new you can do with chains of data as memory learns.
 */
export function formatCapabilityRecallCard({ packId = null } = {}) {
  const pack = packId ? getKnowledgePack(packId) : null;
  const lines = [];
  lines.push(FEED_LOADER_MAGIC + " RECALL · capability proof");
  lines.push("What recursive memory can do with sealed chains:");
  lines.push("");
  const list = pack ? [pack] : KNOWLEDGE_PACKS;
  for (const p of list) {
    lines.push("▸ " + p.hierarchy);
    lines.push("  " + p.capability);
    lines.push("");
  }
  lines.push("anchors (hardcoded — never invent):");
  for (const a of MAINFRAME_ANCHORS.known) {
    lines.push(
      "  " + a.id + "  " + MAINFRAME_ANCHORS.basescanTx + a.tx,
    );
  }
  lines.push("");
  lines.push("cipher encode/decode: /vitamotherGenesisencoded · /encodegenesisreveal");
  lines.push("dual human↔machine: /vitafeed dual [text]");
  lines.push("DOS hierarchy: /vitafeed dir · unlock CODEX\\…");
  lines.push("grow: /vitafeed load · /vitafeed enqueue seed · /vitafeed brain");
  return lines.join("\n");
}

/**
 * Cipher hierarchy card for Telegram filing view.
 */
export function formatCipherHierarchyCard() {
  const lines = [];
  lines.push("CIPHER:\\  (encode ↔ decode knowledge)");
  lines.push("  AES-GCM\\");
  lines.push("    encryptkey.js          vault seal on Base");
  lines.push("    mother-genesis MGENC   two-part MG1/MG2 reveal");
  lines.push("    /encodegenesisreveal   pull locs → decode");
  lines.push("  OPEN\\");
  lines.push("    vita-dir unlock        file-name (NOT a private key)");
  lines.push("    VITADUAL               human plain ↔ machine ZK-short");
  lines.push("  PROOF\\");
  lines.push("    Basescan Input Data → View as UTF-8  (chat of the data)");
  lines.push("");
  lines.push("load cipher pack: /vitafeed load cipher-aes-gcm");
  lines.push("know: /vitafeed know cipher-aes-gcm");
  return lines.join("\n");
}

/**
 * Persist thought note + ensure seed memory JSON exists (append-only friendly).
 */
export function ensureLoaderMemorySeeds() {
  ensureMemoryDir();
  const thoughtPath = join(MEMORY_DIR, "vitafeed-loader-thought-note.json");
  if (!existsSync(thoughtPath)) {
    writeFileSync(
      thoughtPath,
      JSON.stringify(
        {
          ...LOADER_THOUGHT_NOTE,
          filingLabel: FEED_LOADER_LABEL,
          formula: FORMULA_ID,
          neverForget: true,
          neverInventHashes: true,
          text: LOADER_THOUGHT_NOTE.thought,
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );
  }
  for (const pack of KNOWLEDGE_PACKS) {
    const path = join(MEMORY_DIR, "loader-pack-" + pack.id + ".json");
    if (existsSync(path)) continue;
    writeFileSync(
      path,
      JSON.stringify(
        {
          at: new Date().toISOString(),
          topic: "loader-pack-" + pack.id,
          filingLabel: pack.filingLabel,
          hierarchy: pack.hierarchy,
          kind: pack.kind,
          formula: FORMULA_ID,
          neverForget: true,
          neverInventHashes: true,
          title: pack.title,
          text: pack.human,
          machine: pack.machine,
          didYouKnow: pack.didYouKnow,
          capability: pack.capability,
          sourceFiles: pack.sourceFiles,
          anchors: MAINFRAME_ANCHORS.known.map((a) => a.id),
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );
  }
  return {
    ok: true,
    packs: KNOWLEDGE_PACKS.length,
    thought: existsSync(thoughtPath),
  };
}

/** Public JSON for /vita/feed-loader desk + animated HTML. */
export function loaderPublicState({ quotes = {} } = {}) {
  ensureLoaderMemorySeeds();
  const packs = KNOWLEDGE_PACKS.map((p) => {
    const dual = pricePackDual(p, quotes);
    return {
      id: p.id,
      hierarchy: p.hierarchy,
      kind: p.kind,
      title: p.title,
      humanPreview: clip(p.human, 160),
      machine: p.machine,
      didYouKnow: p.didYouKnow,
      capability: p.capability,
      dual: dual.ok
        ? {
            humanBytes: dual.dual.combined.humanBytes,
            machineBytes: dual.dual.combined.machineBytes,
            totalUsd: dual.dual.combined.totalUsd,
            injections: dual.dual.combined.injections,
          }
        : null,
    };
  });
  const backlog = listFeedBacklog({ limit: 16 });
  const pricedForAnim = [];
  for (const p of packs) {
    if (p.dual) {
      pricedForAnim.push({
        pack: { id: p.id },
        dual: {
          combined: {
            totalUsd: p.dual.totalUsd,
            humanBytes: p.dual.humanBytes,
            machineBytes: p.dual.machineBytes,
          },
        },
      });
    }
  }
  const animation = buildPreloadAnimationFrames({
    packs: KNOWLEDGE_PACKS,
    added: [],
    priced: pricedForAnim,
  });
  return {
    id: FEED_LOADER_ID,
    filingLabel: FEED_LOADER_LABEL,
    formula: FORMULA_ID,
    thought: LOADER_THOUGHT_NOTE.thought,
    packs,
    backlog: {
      pending: backlog.growth?.pending,
      sealed: backlog.growth?.sealed,
      items: (backlog.items || []).slice(0, 12),
    },
    libraryCount: listLibraryEntries().length,
    animation,
    cipherCard: formatCipherHierarchyCard(),
    commands: {
      load: "/vitafeed load",
      know: "/vitafeed know",
      recall: "/vitafeed recall",
      next: "/vitafeed next",
      dual: "/vitafeed dual [text]",
    },
  };
}
