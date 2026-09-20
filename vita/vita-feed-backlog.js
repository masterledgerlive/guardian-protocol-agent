/**
 * VITAFEED backlog — queue memory/files for /vitafeed inject without agent AI.
 *
 * Append-only disk queue. Bot (or desk) can enqueue → /vitafeed next →
 * confirm|override. Proves brain growth via pending→sealed counts even when
 * Cursor/agent is off. Never invents tx hashes. Does NOT enable VITAFEED_PAID
 * or touch mother brain / vitaSave send. Rate limits still apply on drain.
 *
 * Filing label: FEED_BACKLOG
 */

import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareVitaFeed, VITAFEED_MAX_CHUNK_BYTES } from "./vita-feed.js";
import { encodeVitaFile } from "./vita-feed-file.js";
import { buildBrainSeedBody } from "./brain-seed.js";
import { FORMULA_ID, MAINFRAME_ANCHORS } from "./mainframe.js";
import { recordBacklogFeedFlow } from "./feed-flow.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const MEMORY_DIR = join(HERE, "memory");
const BACKLOG_PATH = join(MEMORY_DIR, "vitafeed-backlog.json");
const GROWTH_PATH = join(MEMORY_DIR, "vitafeed-backlog-growth.json");

export const FEED_BACKLOG_ID = "vita-feed-backlog-v1";
export const FEED_BACKLOG_MAGIC = "§VITABACKLOG§";
export const FEED_BACKLOG_LABEL = "FEED_BACKLOG";
/** Prefer ≤4 VIN chunks per item so thrift hourly cap can drain steadily. */
export const FEED_BACKLOG_PREF_MAX_CHUNKS = 4;
/** Soft skip for runaway VITAFILE dumps (thrift kill-switch lesson). */
export const FEED_BACKLOG_HARD_MAX_CHUNKS = 24;
/** Topics too large / meta to auto-enqueue as whole files. */
const SKIP_TOPICS = new Set([
  "vitafeed-backlog",
  "vitafeed-backlog-growth",
  "brain-learn-log",
  "wave-heraclitus-key",
  "feed-flow-ledger",
  "mg-recall-bank",
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

function ensureMemoryDir() {
  if (!existsSync(MEMORY_DIR)) mkdirSync(MEMORY_DIR, { recursive: true });
}

function emptyStore() {
  return {
    id: FEED_BACKLOG_ID,
    filingLabel: FEED_BACKLOG_LABEL,
    formula: FORMULA_ID,
    neverInventHashes: true,
    neverForget: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    items: [],
    growth: {
      enqueued: 0,
      sealed: 0,
      partial: 0,
      skipped: 0,
      pending: 0,
      sealedLocCount: 0,
      roots: [],
    },
  };
}

/** @type {object|null} */
let _store = null;
/** Override path for unit tests (null = production). */
let _pathOverride = null;

export function setFeedBacklogPathForTests(path) {
  _pathOverride = path || null;
  _store = null;
}

export function resetFeedBacklogForTests() {
  _store = emptyStore();
  if (_pathOverride) {
    ensureMemoryDir();
    writeFileSync(_pathOverride, JSON.stringify(_store, null, 2) + "\n", "utf8");
  }
  return _store;
}

function storePath() {
  return _pathOverride || BACKLOG_PATH;
}

export function loadFeedBacklog() {
  if (_store && _pathOverride) return _store;
  const path = storePath();
  try {
    if (!existsSync(path)) {
      _store = emptyStore();
      return _store;
    }
    const raw = JSON.parse(readFileSync(path, "utf8"));
    _store = {
      ...emptyStore(),
      ...raw,
      items: Array.isArray(raw.items) ? raw.items : [],
      growth: { ...emptyStore().growth, ...(raw.growth || {}) },
    };
    return _store;
  } catch {
    _store = emptyStore();
    return _store;
  }
}

function persistFeedBacklog(store) {
  ensureMemoryDir();
  store.updatedAt = new Date().toISOString();
  store.growth = recountGrowth(store);
  writeFileSync(storePath(), JSON.stringify(store, null, 2) + "\n", "utf8");
  writeGrowthSnapshot(store);
  _store = store;
  return store;
}

function recountGrowth(store) {
  const items = store.items || [];
  const sealedLocs = new Set();
  for (const it of items) {
    for (const loc of it.locations || []) {
      if (isTxHash(loc)) sealedLocs.add(loc.toLowerCase());
    }
  }
  return {
    enqueued: items.length,
    sealed: items.filter((i) => i.status === "sealed").length,
    partial: items.filter((i) => i.status === "partial").length,
    skipped: items.filter((i) => i.status === "skipped").length,
    pending: items.filter((i) => i.status === "pending" || i.status === "staged").length,
    sealedLocCount: sealedLocs.size,
    roots: (store.growth?.roots || []).slice(-32),
  };
}

function writeGrowthSnapshot(store) {
  const g = store.growth || recountGrowth(store);
  const snap = {
    at: store.updatedAt,
    topic: "vitafeed-backlog-growth",
    filingLabel: FEED_BACKLOG_LABEL,
    text:
      FEED_BACKLOG_MAGIC +
      "v1|growth§\n" +
      "pending=" + g.pending +
      " sealed=" + g.sealed +
      " partial=" + g.partial +
      " locs=" + g.sealedLocCount +
      " enqueued=" + g.enqueued +
      "\nformula=" + FORMULA_ID +
      "\nneverInvent=true\nagentAi=not-required\n" +
      "drain=/vitafeed next → confirm|override\n",
    growth: g,
    formula: FORMULA_ID,
    neverForget: true,
    neverInventHashes: true,
    hypothesis: {
      id: "vitafeed-backlog-grows-offline",
      status: "operating",
      note: "Backlog feeds vita brain via /vitafeed without agentic AI — log, file, prove growth.",
    },
  };
  // Only write beside production backlog (not test override paths outside memory/).
  if (!_pathOverride || String(_pathOverride).includes(MEMORY_DIR)) {
    writeFileSync(GROWTH_PATH, JSON.stringify(snap, null, 2) + "\n", "utf8");
  }
  return snap;
}

function mintBacklogId() {
  return "BL-" + randomBytes(4).toString("hex").toUpperCase();
}

/**
 * Build a compact plain body for a memory topic (exact UTF-8 for /vitafeed).
 */
export function buildMemoryTopicFeedBody(topic, jsonObj) {
  const name = String(topic || "memory").replace(/\.json$/i, "");
  const text =
    typeof jsonObj?.text === "string" && jsonObj.text.trim()
      ? jsonObj.text.trim()
      : JSON.stringify(jsonObj, null, 2);
  const lines = [
    FEED_BACKLOG_MAGIC + "v1|topic=" + name + "|filing=MEMORY§",
    "VITAFEED BACKLOG · " + name,
    "formula=" + FORMULA_ID,
    "wallet=" + MAINFRAME_ANCHORS.wallet,
    "neverInvent=true",
    "---",
    text.slice(0, 2400),
  ];
  return lines.join("\n");
}

function measureBody(body) {
  const prepared = prepareVitaFeed(body);
  if (!prepared.ok) {
    return { ok: false, reason: prepared.reason || "prepare failed", chunks: 0, bytes: 0 };
  }
  return {
    ok: true,
    chunks: prepared.totalChunks || prepared.lines?.length || 0,
    bytes: Buffer.byteLength(String(body || ""), "utf8"),
    contentCommit: sha256Hex(body),
    prepared,
  };
}

/**
 * Enqueue exact body (plain or already-encoded VITAFILE). Dedupes by contentCommit.
 */
export function enqueueFeedBacklogItem({
  body,
  topic = null,
  name = null,
  kind = "plain",
  source = "manual",
  mime = "text/plain",
  preferSmall = true,
} = {}) {
  const text = String(body ?? "");
  if (!text.trim()) {
    return { ok: false, reason: "empty body — nothing to enqueue" };
  }
  const m = measureBody(text);
  if (!m.ok) return { ok: false, reason: m.reason };
  if (m.chunks > FEED_BACKLOG_HARD_MAX_CHUNKS) {
    return {
      ok: false,
      reason:
        "too many chunks (" + m.chunks + ">" + FEED_BACKLOG_HARD_MAX_CHUNKS +
        ") — thrift cap; split or skip (see vitafeed-thrift-killswitch)",
      chunks: m.chunks,
    };
  }
  if (preferSmall && m.chunks > FEED_BACKLOG_PREF_MAX_CHUNKS) {
    // Still allow but flag — operator can drain when funded.
  }

  const store = loadFeedBacklog();
  const dup = store.items.find(
    (it) => it.contentCommit === m.contentCommit && it.status !== "skipped",
  );
  if (dup) {
    return {
      ok: true,
      deduped: true,
      item: publicItem(dup),
      reason: "already queued · " + dup.id,
    };
  }

  const item = {
    id: mintBacklogId(),
    topic: topic || name || "body",
    name: name || (topic ? topic + ".txt" : "body.txt"),
    mime,
    kind,
    source,
    status: "pending",
    body: text,
    bytes: m.bytes,
    chunks: m.chunks,
    contentCommit: m.contentCommit,
    locations: [],
    vinId: null,
    readerKey: null,
    at: new Date().toISOString(),
    sealedAt: null,
    note:
      m.chunks > FEED_BACKLOG_PREF_MAX_CHUNKS
        ? "over prefer-max " + FEED_BACKLOG_PREF_MAX_CHUNKS + " chunks — drain when funded"
        : null,
  };
  store.items.push(item);
  const root = sha256Hex(
    "VITA-FEED-BACKLOG|" + item.id + "|" + item.contentCommit + "|" + (store.growth?.roots?.slice(-1)[0] || "genesis"),
  );
  store.growth.roots = store.growth.roots || [];
  store.growth.roots.push(root);
  persistFeedBacklog(store);
  try {
    recordBacklogFeedFlow({ item: publicItem(item), phase: "enqueue" });
  } catch {
    /* feed-flow is best-effort proof lane */
  }
  return { ok: true, item: publicItem(item), growth: store.growth };
}

function publicItem(it) {
  return {
    id: it.id,
    topic: it.topic,
    name: it.name,
    mime: it.mime,
    kind: it.kind,
    source: it.source,
    status: it.status,
    bytes: it.bytes,
    chunks: it.chunks,
    contentCommit: it.contentCommit,
    locations: (it.locations || []).filter(isTxHash),
    locationCount: (it.locations || []).filter(isTxHash).length,
    vinId: it.vinId || null,
    readerKey: it.readerKey || null,
    at: it.at,
    sealedAt: it.sealedAt || null,
    note: it.note || null,
  };
}

export function listFeedBacklog({ status = null, limit = 40 } = {}) {
  const store = loadFeedBacklog();
  let rows = store.items.map(publicItem);
  if (status) {
    const want = String(status).toLowerCase();
    rows = rows.filter((r) => r.status === want);
  }
  const lim = Math.max(1, Math.min(200, Number(limit) || 40));
  return {
    ok: true,
    growth: store.growth,
    total: store.items.length,
    items: rows.slice(-lim),
    path: storePath(),
  };
}

/** Next pending item (FIFO). */
export function peekNextFeedBacklogItem() {
  const store = loadFeedBacklog();
  const hit = store.items.find((it) => it.status === "pending");
  return hit ? { ok: true, item: hit, public: publicItem(hit) } : { ok: false, reason: "backlog empty — /vitafeed enqueue seed" };
}

/**
 * Mark item staged and return exact body for prepareVitaFeed / stageVitaFeed.
 */
export function takeNextFeedBacklogForStage() {
  const store = loadFeedBacklog();
  const hit = store.items.find((it) => it.status === "pending");
  if (!hit) {
    return { ok: false, reason: "backlog empty — /vitafeed enqueue seed" };
  }
  hit.status = "staged";
  hit.stagedAt = new Date().toISOString();
  persistFeedBacklog(store);
  return {
    ok: true,
    backlogId: hit.id,
    body: hit.body,
    item: publicItem(hit),
    growth: store.growth,
  };
}

/**
 * After confirm|override seal — record real locs only.
 */
export function markFeedBacklogSeal({
  backlogId,
  locations = [],
  vinId = null,
  readerKey = null,
  partial = false,
  sealedCount = 0,
  needed = 0,
} = {}) {
  if (!backlogId) return { ok: false, reason: "no backlogId" };
  const store = loadFeedBacklog();
  const hit = store.items.find((it) => it.id === backlogId);
  if (!hit) return { ok: false, reason: "backlog id not found: " + backlogId };

  const locs = (locations || []).map(String).filter(isTxHash);
  const prev = new Set((hit.locations || []).map((l) => l.toLowerCase()));
  for (const loc of locs) {
    if (!prev.has(loc.toLowerCase())) {
      hit.locations = hit.locations || [];
      hit.locations.push(loc);
      prev.add(loc.toLowerCase());
    }
  }
  if (vinId) hit.vinId = vinId;
  if (readerKey) hit.readerKey = readerKey;

  if (partial) {
    hit.status = "partial";
    hit.note =
      "partial seal " + sealedCount + "/" + needed + " — /vitafeed override again";
  } else if (locs.length || sealedCount > 0) {
    hit.status = "sealed";
    hit.sealedAt = new Date().toISOString();
    hit.note = null;
  }
  persistFeedBacklog(store);
  try {
    recordBacklogFeedFlow({
      item: publicItem(hit),
      phase: partial ? "partial-seal" : "seal",
      locations: locs,
    });
  } catch {
    /* feed-flow is best-effort proof lane */
  }
  return { ok: true, item: publicItem(hit), growth: store.growth };
}

/** Restage remainder: put partial/staged back to pending head (keep locs). */
export function restageFeedBacklogItem(backlogId) {
  const store = loadFeedBacklog();
  const hit = store.items.find((it) => it.id === backlogId);
  if (!hit) return { ok: false, reason: "not found" };
  if (hit.status === "sealed") {
    return { ok: false, reason: "already sealed" };
  }
  hit.status = "pending";
  persistFeedBacklog(store);
  return { ok: true, item: publicItem(hit) };
}

/**
 * Enqueue brain seed + compact memory topics as VITAFILE/plain packets.
 * Skips huge logs. Dedupes. Does not send.
 */
export function seedFeedBacklogFromMemory({
  includeBrainSeed = true,
  includeTopics = true,
  maxTopics = 24,
  maxFileBytes = 1800,
} = {}) {
  const added = [];
  const skipped = [];

  if (includeBrainSeed) {
    const body = buildBrainSeedBody();
    const r = enqueueFeedBacklogItem({
      body,
      topic: "brain-seed",
      name: "brain-seed.txt",
      kind: "brain",
      source: "seed-brain",
    });
    if (r.ok && !r.deduped) added.push(r.item);
    else if (r.deduped) skipped.push({ topic: "brain-seed", reason: "deduped" });
    else skipped.push({ topic: "brain-seed", reason: r.reason });
  }

  if (includeTopics) {
    let topics = [];
    try {
      topics = readdirSync(MEMORY_DIR)
        .filter((f) => f.endsWith(".json"))
        .map((f) => f.replace(/\.json$/i, ""))
        .filter((t) => !SKIP_TOPICS.has(t))
        .sort();
    } catch {
      topics = [];
    }
    const cap = Math.max(1, Math.min(80, Number(maxTopics) || 24));
    let n = 0;
    for (const topic of topics) {
      if (n >= cap) break;
      const path = join(MEMORY_DIR, topic + ".json");
      let raw;
      try {
        raw = readFileSync(path, "utf8");
      } catch {
        skipped.push({ topic, reason: "read-fail" });
        continue;
      }
      if (Buffer.byteLength(raw, "utf8") > maxFileBytes * 4) {
        // Prefer compact text field via buildMemoryTopicFeedBody
      }
      let obj;
      try {
        obj = JSON.parse(raw);
      } catch {
        skipped.push({ topic, reason: "bad-json" });
        continue;
      }
      const plain = buildMemoryTopicFeedBody(topic, obj);
      if (Buffer.byteLength(plain, "utf8") > maxFileBytes) {
        // Truncate already applied in builder; still measure
      }
      const measured = measureBody(plain);
      if (!measured.ok || measured.chunks > FEED_BACKLOG_PREF_MAX_CHUNKS) {
        // Try VITAFILE of compact JSON slice
        const compact = JSON.stringify({
          topic,
          at: obj.at || null,
          text: String(obj.text || "").slice(0, 900),
          hypothesis: obj.hypothesis || null,
          formula: obj.formula || FORMULA_ID,
          neverForget: true,
        });
        const enc = encodeVitaFile({
          name: topic + ".json",
          mime: "application/json",
          bytes: Buffer.from(compact, "utf8"),
        });
        if (!enc.ok) {
          skipped.push({ topic, reason: enc.reason || "encode-fail" });
          continue;
        }
        const r = enqueueFeedBacklogItem({
          body: enc.body,
          topic,
          name: topic + ".json",
          kind: "vitafile",
          mime: "application/json",
          source: "seed-memory-file",
        });
        if (r.ok && !r.deduped) {
          added.push(r.item);
          n++;
        } else if (r.deduped) skipped.push({ topic, reason: "deduped" });
        else skipped.push({ topic, reason: r.reason });
        continue;
      }
      const r = enqueueFeedBacklogItem({
        body: plain,
        topic,
        name: topic + ".txt",
        kind: "plain",
        source: "seed-memory",
      });
      if (r.ok && !r.deduped) {
        added.push(r.item);
        n++;
      } else if (r.deduped) skipped.push({ topic, reason: "deduped" });
      else skipped.push({ topic, reason: r.reason });
    }
  }

  const list = listFeedBacklog();
  return {
    ok: true,
    added: added.length,
    skipped: skipped.length,
    skipSamples: skipped.slice(0, 12),
    items: added,
    growth: list.growth,
    card: formatFeedBacklogCard(list),
  };
}

/**
 * When /vitafeed brain activates — also park stageBody on backlog so drain
 * can continue without agent AI after the Telegram stage expires.
 */
export function enqueueBrainStageOnBacklog({ stageBody, cycleIndex = null } = {}) {
  const body = String(stageBody || "");
  if (!body.trim()) return { ok: false, reason: "empty stageBody" };
  return enqueueFeedBacklogItem({
    body,
    topic: "brain-learn-cycle-" + String(cycleIndex || "x").padStart(3, "0"),
    name: "brain-stage-" + String(cycleIndex || "x") + ".txt",
    kind: "brain",
    source: "vitafeed-brain",
  });
}

export function formatFeedBacklogCard(list = null) {
  const data = list || listFeedBacklog();
  const g = data.growth || {};
  const lines = [];
  lines.push("VITAFEED BACKLOG · filing=" + FEED_BACKLOG_LABEL);
  lines.push(
    "pending=" + (g.pending ?? 0) +
    "  sealed=" + (g.sealed ?? 0) +
    "  partial=" + (g.partial ?? 0) +
    "  locs=" + (g.sealedLocCount ?? 0) +
    "  enqueued=" + (g.enqueued ?? 0),
  );
  lines.push("agent AI: not required — drain with /vitafeed next → confirm|override");
  lines.push("prefer ≤" + FEED_BACKLOG_PREF_MAX_CHUNKS + " chunks/item · hard max " + FEED_BACKLOG_HARD_MAX_CHUNKS);
  lines.push("never invent hashes · VITAFEED_PAID still gates send");
  const pending = (data.items || []).filter((i) => i.status === "pending" || i.status === "staged");
  const sealed = (data.items || []).filter((i) => i.status === "sealed");
  if (!pending.length && !sealed.length) {
    lines.push("empty — /vitafeed enqueue seed");
  } else {
    lines.push("NEXT pending:");
    pending.slice(0, 8).forEach((it, i) => {
      lines.push(
        "  " + (i + 1) + ". " + it.id + " · " + it.name +
        " · " + it.chunks + "ch/" + it.bytes + "B · " + it.status,
      );
    });
    if (sealed.length) {
      lines.push("SEALED (growth proof):");
      sealed.slice(-5).forEach((it) => {
        lines.push(
          "  ✓ " + it.id + " · " + it.name +
          " · locs=" + it.locationCount +
          (it.readerKey ? " · " + it.readerKey : ""),
        );
      });
    }
  }
  lines.push("Commands: /vitafeed backlog · enqueue seed · next · proof");
  return lines.join("\n");
}

export function formatFeedBacklogGrowthProof() {
  const data = listFeedBacklog({ limit: 80 });
  const g = data.growth || {};
  const lines = [];
  lines.push("VITAFEED BACKLOG GROWTH PROOF · " + FEED_BACKLOG_LABEL);
  lines.push(
    "system growing without agentic AI: " +
    ((g.sealed > 0 || g.pending > 0) ? "YES" : "seed first"),
  );
  lines.push(
    "queued→sealed " + (g.sealed ?? 0) + "/" + (g.enqueued ?? 0) +
    " · pending " + (g.pending ?? 0) +
    " · real locs " + (g.sealedLocCount ?? 0),
  );
  const roots = g.roots || [];
  roots.slice(-6).forEach((r, i) => {
    lines.push("  root " + (roots.length - Math.min(6, roots.length) + i + 1) + " " + shortHex(r, 16) + "…");
  });
  lines.push("Drain path: /vitafeed next (stage) → /vitafeed override when VITAFEED_PAID=yes");
  lines.push("Chunk budget: VITAFEED_MAX_CHUNK_BYTES=" + VITAFEED_MAX_CHUNK_BYTES);
  return lines.join("\n");
}
