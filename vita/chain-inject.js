/**
 * VITA chain inject — spaced batch plan + sealed-loc match + on-chain pull proof.
 *
 * Code bigger than hitch/calldata MUST be spaced across many Base locations.
 * Telegram IDM buttons only link REAL sealed txs that hold matching UTF-8.
 * Local SNARK / content commits are NEVER claimed as on-chain inject.
 * Formula anchors prove hitch *class* only — they do not hold library body.
 * Never invent tx hashes.
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
import { FORMULA_ID, MAINFRAME_ANCHORS } from "./mainframe.js";
import {
  VITAFEED_MAX_CHUNK_BYTES,
  splitUtf8ByBytes,
} from "./vita-feed.js";
import { feedFlowAnchorLocations } from "./feed-flow.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");
const MEMORY_DIR = join(HERE, "memory");
const STRANDS_DIR = join(HERE, "strands");
const INJECT_PLAN_PATH = join(MEMORY_DIR, "chain-layer-inject.json");
const INJECT_STRAND_PATH = join(STRANDS_DIR, "chain-layer-inject.json");

export const CHAIN_INJECT_ID = "vita-chain-inject-v1";
export const CHAIN_INJECT_MAGIC = "§VITAINJECT§";
export const CHAIN_INJECT_LABEL = "CHAIN_INJECT";
export const SPACED_CHUNK_BYTES = VITAFEED_MAX_CHUNK_BYTES;
/** Telegram URL button budget — one IDM link per sealed spaced loc. */
export const IDM_BUTTON_MAX = 24;

/** Same proven roots as chain-layer (duplicated to avoid circular import). */
export const INJECT_LIBRARY_ROOTS = Object.freeze([
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

function sha256Hex(text) {
  return createHash("sha256").update(String(text || ""), "utf8").digest("hex");
}

function shortHex(hex, n = 8) {
  return String(hex || "").replace(/^0x/i, "").toLowerCase().slice(0, n);
}

export function isTxHash(h) {
  return /^0x[0-9a-fA-F]{64}$/.test(String(h || ""));
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

function basescanTx(tx) {
  return (MAINFRAME_ANCHORS.basescanTx || "https://basescan.org/tx/") + tx;
}

function stripBodies(chunks = []) {
  return (chunks || []).map((c) => {
    const { body, ...rest } = c;
    return {
      ...rest,
      bodyPreview: String(body || c.bodyPreview || "").slice(0, 48),
    };
  });
}

/** Formula-class anchors — hitch kind proof only, NOT library body. */
export function formulaAnchorLocations() {
  return feedFlowAnchorLocations()
    .filter((l) => isTxHash(l.location))
    .map((l) => ({
      ...l,
      role: "formula-anchor",
      holdsLibraryBody: false,
      note: "Formula/class proof only — does not contain proven-lib bytes",
    }));
}

/**
 * Collect candidate sealed locs from disk (inject plan, strands, backlog).
 * Never invents — only real 0x+64hex already filed.
 */
export function collectSealedLocCandidates({ extra = [] } = {}) {
  const out = [];
  const seen = new Set();
  const push = (row) => {
    const tx = String(row?.location || row?.tx || "").toLowerCase();
    if (!isTxHash(tx) || seen.has(tx)) return;
    seen.add(tx);
    out.push({
      id: row.id || row.chunkId || "sealed",
      location: tx,
      kind: row.kind || "vita",
      label: row.label || row.name || "sealed",
      contentCommit: row.contentCommit || row.chunkCommit || null,
      basescan: basescanTx(tx),
      role: row.role || "sealed-inject",
      source: row.source || "disk",
    });
  };

  const plan = safeReadJson(INJECT_PLAN_PATH);
  for (const c of plan?.chunks || []) {
    if (c.sealed && isTxHash(c.location)) {
      push({
        id: c.id,
        location: c.location,
        contentCommit: c.contentCommit,
        kind: "vita",
        label: c.file || c.id,
        role: "sealed-inject",
        source: "inject-plan",
      });
    }
  }

  try {
    for (const f of readdirSync(STRANDS_DIR).filter((x) => x.endsWith(".json"))) {
      const j = safeReadJson(join(STRANDS_DIR, f));
      if (!j) continue;
      for (const loc of j.locations || []) {
        if (typeof loc === "string") push({ location: loc, source: "strand:" + f });
        else if (loc && (loc.location || loc.tx)) {
          push({ ...loc, source: "strand:" + f });
        }
      }
      for (const c of j.chunks || []) {
        if (c.txHash || c.location) {
          push({
            location: c.txHash || c.location,
            contentCommit: c.contentCommit || c.hash,
            id: c.vinId || c.id,
            source: "strand-chunk:" + f,
          });
        }
      }
    }
  } catch {
    /* ignore */
  }

  const backlog = safeReadJson(join(MEMORY_DIR, "vitafeed-backlog.json"));
  for (const it of backlog?.items || []) {
    if (it.status !== "sealed") continue;
    for (const loc of it.locations || []) {
      push({
        location: typeof loc === "string" ? loc : loc?.location || loc?.tx,
        contentCommit: it.contentCommit,
        id: it.id,
        label: it.topic || it.name,
        source: "backlog-sealed",
      });
    }
  }

  for (const x of extra || []) {
    if (typeof x === "string") push({ location: x, source: "extra" });
    else push({ ...x, source: x?.source || "extra" });
  }

  return out;
}

/**
 * Plan spaced inject batches for proven library files (720 B hitch class).
 */
export function planSpacedLibraryInject({
  roots = INJECT_LIBRARY_ROOTS,
  cwd = REPO_ROOT,
  maxBytes = SPACED_CHUNK_BYTES,
  now = Date.now(),
} = {}) {
  const cap = Math.max(1, Math.floor(Number(maxBytes) || SPACED_CHUNK_BYTES));
  const files = [];
  const chunks = [];
  let totalBytes = 0;

  for (const rel of roots) {
    const path = join(cwd, rel);
    if (!existsSync(path)) continue;
    let body = "";
    let fileBytes = 0;
    try {
      const st = statSync(path);
      if (!st.isFile() || st.size > 1_500_000) continue;
      body = readFileSync(path, "utf8");
      fileBytes = Buffer.byteLength(body, "utf8");
    } catch {
      continue;
    }
    const fileCommit = sha256Hex(body);
    const parts = splitUtf8ByBytes(body, cap);
    totalBytes += fileBytes;
    files.push({
      name: rel,
      bytes: fileBytes,
      contentCommit: fileCommit,
      chunkCount: parts.length,
    });
    parts.forEach((part, i) => {
      chunks.push({
        id: "C" + String(chunks.length + 1).padStart(4, "0"),
        file: rel,
        fileCommit,
        index: i + 1,
        fileTotal: parts.length,
        globalIndex: chunks.length + 1,
        bytes: Buffer.byteLength(part, "utf8"),
        contentCommit: sha256Hex(part),
        body: part,
        sealed: false,
        location: null,
        basescan: null,
        match: "pending",
        pulledUtf8Commit: null,
        verified: false,
      });
    });
  }

  chunks.forEach((c, i) => {
    c.globalIndex = i + 1;
    c.id = "C" + String(i + 1).padStart(4, "0");
  });

  return {
    id: CHAIN_INJECT_ID,
    magic: CHAIN_INJECT_MAGIC,
    filingLabel: CHAIN_INJECT_LABEL,
    at: new Date(now).toISOString(),
    formula: FORMULA_ID,
    maxBytes: cap,
    maxPayloadConstant: "VITAFEED_MAX_CHUNK_BYTES",
    fileCount: files.length,
    totalBytes,
    totalChunks: chunks.length,
    spacedBlockchainLocationsRequired: chunks.length,
    files,
    chunks,
    sealedCount: 0,
    pendingCount: chunks.length,
    verifiedCount: 0,
    neverInventHashes: true,
    note:
      "Spaced plan only. Each chunk needs its own sealed Base loc (Input Data → UTF-8). " +
      "Formula anchors are NOT these chunks. Bind real txs after seal — never invent hashes.",
  };
}

/**
 * Merge prior seals into a fresh plan (by contentCommit).
 */
export function bindSealedToPlan(plan, sealedCandidates = []) {
  const byCommit = new Map();
  for (const s of sealedCandidates || []) {
    if (s.contentCommit) byCommit.set(String(s.contentCommit).toLowerCase(), s);
  }
  // Prefer inject-plan seals already keyed by commit
  let sealedCount = 0;
  const chunks = (plan.chunks || []).map((c) => {
    const hit = byCommit.get(String(c.contentCommit).toLowerCase());
    if (hit && isTxHash(hit.location)) {
      sealedCount += 1;
      return {
        ...c,
        sealed: true,
        location: hit.location.toLowerCase(),
        basescan: basescanTx(hit.location),
        match: "bound",
        bindSource: hit.source || "candidate",
      };
    }
    // Keep prior seal on same commit if plan was reloaded without body
    if (c.sealed && isTxHash(c.location)) {
      sealedCount += 1;
      return { ...c, basescan: basescanTx(c.location), match: c.match || "bound" };
    }
    return {
      ...c,
      sealed: false,
      location: null,
      basescan: null,
      match: "pending",
      verified: false,
      pulledUtf8Commit: null,
    };
  });

  return {
    ...plan,
    chunks,
    sealedCount,
    pendingCount: chunks.length - sealedCount,
    verifiedCount: chunks.filter((c) => c.verified).length,
    spacedBlockchainLocationsRequired: chunks.length,
  };
}

/**
 * Persist inject plan — never store full chunk bodies on disk (re-plan to verify).
 */
export function persistInjectPlan(plan, { write = true } = {}) {
  if (!write) return plan;
  ensureDirs();
  const publicPlan = {
    ...plan,
    chunks: stripBodies(plan.chunks),
  };
  writeFileSync(INJECT_PLAN_PATH, JSON.stringify(publicPlan, null, 2) + "\n");
  writeFileSync(
    INJECT_STRAND_PATH,
    JSON.stringify(
      {
        strandId: "chain-layer-inject",
        sparse: true,
        source: "chain-inject",
        filingLabel: CHAIN_INJECT_LABEL,
        learn:
          "Spaced inject: N chunks × " +
          SPACED_CHUNK_BYTES +
          "B. Telegram IDM only for sealed matching locs. Formula anchors ≠ library body.",
        formula: FORMULA_ID,
        totalChunks: publicPlan.totalChunks,
        sealedCount: publicPlan.sealedCount,
        pendingCount: publicPlan.pendingCount,
        verifiedCount: publicPlan.verifiedCount,
        maxBytes: publicPlan.maxBytes,
        locations: (publicPlan.chunks || [])
          .filter((c) => c.sealed && isTxHash(c.location))
          .map((c) => ({
            id: c.id,
            location: c.location,
            kind: "vita",
            contentCommit: c.contentCommit,
            file: c.file,
            index: c.index,
            fileTotal: c.fileTotal,
          })),
        formulaAnchors: formulaAnchorLocations().map((a) => ({
          id: a.id,
          location: a.location,
          kind: a.kind,
          role: "formula-anchor",
        })),
        neverInventHashes: true,
      },
      null,
      2,
    ) + "\n",
  );
  return publicPlan;
}

export function loadInjectPlan() {
  return safeReadJson(INJECT_PLAN_PATH);
}

/**
 * Pull sealed locs from chain and verify UTF-8 matches chunk commit.
 * fetchCalldata(txHash) → hex input. Optional readUtf8(hex) helper.
 */
export async function verifyInjectPlanOnChain(plan, {
  fetchCalldata = null,
  readUtf8FromCalldata = null,
  limit = IDM_BUTTON_MAX,
} = {}) {
  if (typeof fetchCalldata !== "function") {
    return {
      ...plan,
      pull: {
        attempted: false,
        reason: "no fetchCalldata — local bind only; pass Base RPC pull to verify",
      },
    };
  }

  const sealed = (plan.chunks || []).filter((c) => c.sealed && isTxHash(c.location));
  const toCheck = sealed.slice(0, Math.max(1, Number(limit) || IDM_BUTTON_MAX));
  let verified = 0;
  let mismatched = 0;
  let failed = 0;
  const chunks = [];

  for (const c of plan.chunks || []) {
    if (!c.sealed || !isTxHash(c.location) || !toCheck.some((t) => t.id === c.id)) {
      chunks.push(c);
      continue;
    }
    try {
      const hex = await fetchCalldata(c.location);
      let utf8 = "";
      if (typeof readUtf8FromCalldata === "function") {
        const read = readUtf8FromCalldata(hex);
        utf8 = String(read?.utf8 || "");
      } else {
        utf8 = hexToUtf8Loose(hex);
      }
      const pulledCommit = sha256Hex(utf8);
      const bodyCommit = c.contentCommit;
      // Match: exact body, or hitch UTF-8 contains the chunk body / commit
      const exact = pulledCommit === bodyCommit;
      const contains =
        (c.body && utf8.includes(c.body)) ||
        utf8.toLowerCase().includes(String(bodyCommit).slice(0, 16).toLowerCase());
      const ok = exact || contains;
      if (ok) verified += 1;
      else mismatched += 1;
      chunks.push({
        ...c,
        verified: ok,
        match: ok ? "chain-match" : "chain-mismatch",
        pulledUtf8Commit: pulledCommit,
        pulledBytes: Buffer.byteLength(utf8, "utf8"),
        pulledPreview: utf8.slice(0, 80),
      });
    } catch (e) {
      failed += 1;
      chunks.push({
        ...c,
        verified: false,
        match: "pull-failed",
        pullError: e.message || String(e),
      });
    }
  }

  const next = {
    ...plan,
    chunks,
    verifiedCount: chunks.filter((c) => c.verified).length,
    sealedCount: chunks.filter((c) => c.sealed).length,
    pendingCount: chunks.filter((c) => !c.sealed).length,
    pull: {
      attempted: true,
      checked: toCheck.length,
      verified,
      mismatched,
      failed,
      at: new Date().toISOString(),
    },
  };
  return next;
}

function hexToUtf8Loose(hex) {
  const h = String(hex || "").replace(/^0x/i, "");
  if (!h || h.length % 2) return "";
  try {
    return Buffer.from(h, "hex").toString("utf8").replace(/\u0000/g, "");
  } catch {
    return "";
  }
}

/**
 * Build / refresh inject plan: plan → bind seals → optional chain pull → persist.
 */
export async function buildAndMatchInjectPlan({
  cwd = REPO_ROOT,
  write = true,
  fetchCalldata = null,
  readUtf8FromCalldata = null,
  extraSealed = [],
  now = Date.now(),
  pull = true,
} = {}) {
  const fresh = planSpacedLibraryInject({ cwd, now });
  const prior = loadInjectPlan();
  // Preserve prior seals by commit
  const priorSealed = (prior?.chunks || [])
    .filter((c) => c.sealed && isTxHash(c.location))
    .map((c) => ({
      location: c.location,
      contentCommit: c.contentCommit,
      id: c.id,
      source: "prior-plan",
    }));
  const candidates = collectSealedLocCandidates({
    extra: [...priorSealed, ...extraSealed],
  });
  let plan = bindSealedToPlan(fresh, candidates);
  if (pull && typeof fetchCalldata === "function") {
    plan = await verifyInjectPlanOnChain(plan, {
      fetchCalldata,
      readUtf8FromCalldata,
    });
  }
  persistInjectPlan(plan, { write });
  return plan;
}

/** Sealed inject locs only — for Telegram IDM click-through. */
export function sealedInjectIdmLocations(plan) {
  return (plan?.chunks || [])
    .filter((c) => c.sealed && isTxHash(c.location))
    .map((c) => ({
      id: c.id,
      location: c.location,
      kind: "vita",
      label: `${c.file} ${c.index}/${c.fileTotal}`,
      contentCommit: c.contentCommit,
      basescan: c.basescan || basescanTx(c.location),
      verified: c.verified === true,
      match: c.match,
      role: "sealed-inject",
      idmChat: "Basescan → Input Data → View as UTF-8",
      holdsLibraryBody: true,
    }));
}

export function formatInjectPlanCard(plan) {
  const lines = [];
  lines.push(CHAIN_INJECT_MAGIC + "v1|spaced§");
  lines.push("📦 SPACED INJECT PLAN — code > calldata field");
  lines.push(
    `files=${plan.fileCount} · bytes=${plan.totalBytes} · chunks=${plan.totalChunks} × ${plan.maxBytes}B`,
  );
  lines.push(
    `spaced locs required=${plan.spacedBlockchainLocationsRequired} · sealed=${plan.sealedCount} · pending=${plan.pendingCount} · verified=${plan.verifiedCount || 0}`,
  );
  lines.push("LOCAL plan ≠ ON-CHAIN until each chunk has a real sealed tx.");
  lines.push("Formula anchors ≠ library body. Never invent hashes.");
  lines.push("");
  lines.push("— SEALED IDM (click Basescan Input Data → UTF-8) —");
  const sealed = sealedInjectIdmLocations(plan);
  if (!sealed.length) {
    lines.push("(none sealed yet — drain /vitafeed backlog or leftover hitch to inject)");
  } else {
    for (const loc of sealed.slice(0, 40)) {
      const mark = loc.verified ? "✅" : loc.match === "bound" ? "🔗" : "⛓️";
      lines.push(
        `${mark} ${loc.id}  ${shortHex(loc.location, 10)}…  ${loc.label}  ${loc.basescan}`,
      );
    }
    if (sealed.length > 40) lines.push(`… +${sealed.length - 40} more sealed locs in chain-layer-inject.json`);
  }
  lines.push("");
  lines.push("— FORMULA ANCHORS (class proof only — NOT library inject) —");
  for (const a of formulaAnchorLocations()) {
    lines.push(`🏷 ${a.id}  ${shortHex(a.location, 8)}…  ${a.basescan}`);
  }
  if (plan.pull?.attempted) {
    lines.push("");
    lines.push(
      `pull checked=${plan.pull.checked} verified=${plan.pull.verified} mismatch=${plan.pull.mismatched} fail=${plan.pull.failed}`,
    );
  }
  return lines.join("\n");
}

export function buildSpacedIdmKeyboard({
  plan = null,
  includeFormulaAnchors = false,
  includeNav = true,
} = {}) {
  const rows = [];
  const sealed = sealedInjectIdmLocations(plan).slice(0, IDM_BUTTON_MAX);
  for (let i = 0; i < sealed.length; i += 2) {
    const pair = sealed.slice(i, i + 2).map((loc) => ({
      text: (loc.verified ? "✅ " : "IDM ") + shortHex(loc.location, 6) + " ↗",
      url: loc.basescan,
    }));
    rows.push(pair);
  }
  if (includeFormulaAnchors) {
    const anchors = formulaAnchorLocations().slice(0, 3).map((a) => ({
      text: "🏷 " + shortHex(a.location, 6) + " ↗",
      url: a.basescan,
    }));
    if (anchors.length) rows.push(anchors);
  }
  if (includeNav) {
    rows.push([
      { text: "✅ Check", callback_data: "/vita check" },
      { text: "📦 Inject locs", callback_data: "/vita check locs" },
      { text: "⬇️ Pull", callback_data: "/vita check pull" },
    ]);
  }
  return { inline_keyboard: rows };
}
