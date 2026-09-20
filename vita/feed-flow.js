/**
 * Feed-flow ledger — append-only records that VITA memory is being fed.
 *
 * Every learn / enqueue / seal event grows this ledger so operators can see
 * data flowing: topic, content commit, directory counts, and the Basescan
 * Input Data → UTF-8 chat of the blockchain locations carrying the feed.
 *
 * Locations are hardcoded anchors and/or real sealed txs only — never invent.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FORMULA_ID, MAINFRAME_ANCHORS } from "./mainframe.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const MEMORY_DIR = join(HERE, "memory");
const STRANDS_DIR = join(HERE, "strands");
const LEDGER_PATH = join(MEMORY_DIR, "feed-flow-ledger.json");
const GROWTH_NOTE_PATH = join(MEMORY_DIR, "feed-flow-growth.json");
const STRAND_PATH = join(STRANDS_DIR, "feed-flow.json");

export const FEED_FLOW_ID = "vita-feed-flow-v1";
export const FEED_FLOW_MAGIC = "§VITAFLOW§";
export const FEED_FLOW_LABEL = "FEED_FLOW";
export const FEED_FLOW_BASESCAN_TX =
  MAINFRAME_ANCHORS.basescanTx || "https://basescan.org/tx/";

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

function ensureDirs() {
  if (!existsSync(MEMORY_DIR)) mkdirSync(MEMORY_DIR, { recursive: true });
  if (!existsSync(STRANDS_DIR)) mkdirSync(STRANDS_DIR, { recursive: true });
}

function dirStats(dir) {
  try {
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    let bytes = 0;
    for (const f of files) {
      try {
        bytes += statSync(join(dir, f)).size;
      } catch {
        /* skip */
      }
    }
    return { count: files.length, bytes };
  } catch {
    return { count: 0, bytes: 0 };
  }
}

/** Hardcoded Base anchors — always available for IDM chat of the feed. */
export function feedFlowAnchorLocations() {
  return MAINFRAME_ANCHORS.known.map((a) => ({
    id: a.id,
    location: a.tx,
    kind: a.kind,
    label: a.label,
    basescan: FEED_FLOW_BASESCAN_TX + a.tx,
    idmChat: "Basescan → Input Data → View as UTF-8",
  }));
}

function normalizeLocs(extra = []) {
  const out = [];
  const seen = new Set();
  for (const a of feedFlowAnchorLocations()) {
    const tx = String(a.location).toLowerCase();
    if (seen.has(tx)) continue;
    seen.add(tx);
    out.push(a);
  }
  for (const x of extra || []) {
    const tx = typeof x === "string" ? x : x?.location || x?.tx;
    if (!isTxHash(tx)) continue;
    const key = tx.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: typeof x === "object" && x?.id ? x.id : "sealed",
      location: tx,
      kind: typeof x === "object" && x?.kind ? x.kind : "vita",
      label: typeof x === "object" && x?.label ? x.label : "sealed feed loc",
      basescan: FEED_FLOW_BASESCAN_TX + tx,
      idmChat: "Basescan → Input Data → View as UTF-8",
    });
  }
  return out;
}

export function loadFeedFlowLedger() {
  ensureDirs();
  try {
    if (!existsSync(LEDGER_PATH)) {
      return {
        id: FEED_FLOW_ID,
        filingLabel: FEED_FLOW_LABEL,
        formula: FORMULA_ID,
        neverInventHashes: true,
        neverForget: true,
        createdAt: new Date().toISOString(),
        updatedAt: null,
        events: [],
        roots: [],
        growth: {
          eventCount: 0,
          memoryCount: 0,
          strandCount: 0,
          memoryBytes: 0,
          strandBytes: 0,
        },
      };
    }
    return JSON.parse(readFileSync(LEDGER_PATH, "utf8"));
  } catch {
    return {
      id: FEED_FLOW_ID,
      filingLabel: FEED_FLOW_LABEL,
      formula: FORMULA_ID,
      neverInventHashes: true,
      neverForget: true,
      createdAt: new Date().toISOString(),
      updatedAt: null,
      events: [],
      roots: [],
      growth: {
        eventCount: 0,
        memoryCount: 0,
        strandCount: 0,
        memoryBytes: 0,
        strandBytes: 0,
      },
    };
  }
}

function persistLedger(store) {
  ensureDirs();
  writeFileSync(LEDGER_PATH, JSON.stringify(store, null, 2) + "\n", "utf8");
}

function persistGrowthNote(store, event) {
  const text = [
    FEED_FLOW_MAGIC + "v1|growth|events=" + store.events.length + "§",
    "FEED FLOW GROWTH · filing=" + FEED_FLOW_LABEL,
    "events=" + store.growth.eventCount,
    "memory=" + store.growth.memoryCount + " files / " + store.growth.memoryBytes + " B",
    "strands=" + store.growth.strandCount + " files / " + store.growth.strandBytes + " B",
    "last=" + (event?.kind || "?") + " · " + (event?.topic || "?"),
    "commit=" + shortHex(event?.contentCommit || "", 16),
    "idm locs=" + (event?.locations?.length || 0) + " (anchors+sealed · never invent)",
    "formula=" + FORMULA_ID,
    "neverInvent=true",
    "read: Basescan → Input Data → View as UTF-8  (on-chain chat of what is fed)",
  ].join("\n");

  writeFileSync(
    GROWTH_NOTE_PATH,
    JSON.stringify(
      {
        at: event?.at || new Date().toISOString(),
        topic: "feed-flow-growth",
        filingLabel: FEED_FLOW_LABEL,
        text,
        growth: store.growth,
        lastEventId: event?.id || null,
        locations: (event?.locations || []).map((l) => l.location).filter(isTxHash),
        formula: FORMULA_ID,
        neverForget: true,
        neverInventHashes: true,
        hypothesis: {
          id: "feed-flow-idm-chat-visible",
          status: "operating",
          note: "Ledger + IDM Basescan receipts prove memory is fed and directory grows.",
        },
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  writeFileSync(
    STRAND_PATH,
    JSON.stringify(
      {
        strandId: "feed-flow",
        sparse: true,
        source: "feed-flow",
        filingLabel: FEED_FLOW_LABEL,
        learn:
          "Append-only feed-flow ledger records every memory feed with Basescan " +
          "Input Data → UTF-8 chat of blockchain locations (anchors + sealed).",
        formula: FORMULA_ID,
        locations: feedFlowAnchorLocations().map((a) => ({
          id: a.id,
          location: a.location,
          kind: a.kind,
        })),
        eventCount: store.growth.eventCount,
        lastRoot: store.roots.slice(-1)[0] || null,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
}

/**
 * Append one feed-flow event. Returns the public event + growth snapshot.
 */
export function recordFeedFlow({
  kind = "feed",
  topic = null,
  source = "agent",
  body = "",
  contentCommit = null,
  locations = [],
  meta = {},
} = {}) {
  ensureDirs();
  const store = loadFeedFlowLedger();
  const mem = dirStats(MEMORY_DIR);
  const strands = dirStats(STRANDS_DIR);
  const at = new Date().toISOString();
  const commit =
    contentCommit ||
    sha256Hex(
      "VITA-FEED-FLOW|" + kind + "|" + (topic || "") + "|" + String(body || "") + "|" + at,
    );
  const locs = normalizeLocs(locations);
  const prevRoot = store.roots.slice(-1)[0] || "genesis";
  const root = sha256Hex(
    "VITA-FEED-FLOW-ROOT|" + prevRoot + "|" + commit + "|" + locs.map((l) => l.location).join(","),
  );
  const event = {
    id: "FF-" + shortHex(commit, 8).toUpperCase(),
    kind: String(kind),
    topic: topic || kind,
    source: String(source),
    at,
    contentCommit: commit,
    chatPreview: clip(body, 160),
    locations: locs,
    directory: {
      memoryCount: mem.count,
      memoryBytes: mem.bytes,
      strandCount: strands.count,
      strandBytes: strands.bytes,
    },
    meta: meta && typeof meta === "object" ? meta : {},
    root,
    prevRoot,
  };

  store.events.push(event);
  store.roots.push(root);
  store.updatedAt = at;
  store.growth = {
    eventCount: store.events.length,
    memoryCount: mem.count,
    strandCount: strands.count,
    memoryBytes: mem.bytes,
    strandBytes: strands.bytes,
  };
  persistLedger(store);
  persistGrowthNote(store, event);

  return {
    ok: true,
    event,
    growth: store.growth,
    ledgerPath: LEDGER_PATH,
    idmCard: formatFeedFlowIdmChatCard(event),
  };
}

/** Basescan Input Data chat card for one feed event's locations. */
export function formatFeedFlowIdmChatCard(event) {
  const lines = [];
  lines.push("FEED FLOW · IDM CHAT · filing=" + FEED_FLOW_LABEL);
  lines.push("event=" + (event?.id || "?") + " · kind=" + (event?.kind || "?"));
  lines.push("topic=" + (event?.topic || "?"));
  if (event?.contentCommit) {
    lines.push("commit=" + shortHex(event.contentCommit, 16));
  }
  if (event?.chatPreview) {
    lines.push("chat preview: " + event.chatPreview);
  }
  lines.push("read: Basescan → Input Data → View as UTF-8  (on-chain chat of what is fed)");
  const locs = event?.locations || [];
  lines.push("blockchain locations=" + locs.length + "  (anchors+sealed · never invent)");
  if (!locs.length) {
    lines.push("(no locations — seal via /vitafeed confirm|override)");
  } else {
    locs.forEach((loc, i) => {
      lines.push(
        "  " + (i + 1) + "/" + locs.length + "  " + (loc.id || "loc") +
          " [" + (loc.kind || "?") + "]  " + shortHex(loc.location, 10) + "…",
      );
      lines.push("     " + (loc.basescan || FEED_FLOW_BASESCAN_TX + loc.location));
      lines.push("     IDM: " + (loc.idmChat || "Basescan → Input Data → View as UTF-8"));
    });
  }
  return lines.join("\n");
}

/** Growth proof card — directory growing + last IDM chats. */
export function formatFeedFlowProofCard({ limit = 5 } = {}) {
  const store = loadFeedFlowLedger();
  const g = store.growth || {};
  const lines = [];
  lines.push("FEED FLOW PROOF · memory is being fed · filing=" + FEED_FLOW_LABEL);
  lines.push(
    "events=" + (g.eventCount || 0) +
      "  memory=" + (g.memoryCount || 0) + " files/" + (g.memoryBytes || 0) + " B" +
      "  strands=" + (g.strandCount || 0) + " files/" + (g.strandBytes || 0) + " B",
  );
  if (!store.events.length) {
    lines.push("empty — run /vitafeed brain or /vitafeed enqueue seed to start flowing");
    lines.push("IDM anchors (always):");
    for (const a of feedFlowAnchorLocations()) {
      lines.push("  " + a.id + "  " + shortHex(a.location, 10) + "…");
      lines.push("     " + a.basescan);
    }
    return lines.join("\n");
  }
  const recent = store.events.slice(-Math.max(1, limit));
  lines.push("recent feeds (newest last):");
  for (const ev of recent) {
    lines.push(
      "  " + ev.id + " · " + ev.kind + " · " + ev.topic +
        " · mem=" + (ev.directory?.memoryCount ?? "?") +
        " · locs=" + (ev.locations?.length || 0),
    );
    lines.push("    commit=" + shortHex(ev.contentCommit, 12) + "  " + (ev.at || ""));
  }
  const last = store.events[store.events.length - 1];
  lines.push("");
  lines.push(formatFeedFlowIdmChatCard(last));
  lines.push("never invent hashes · directory grows append-only under vita/memory + vita/strands");
  return lines.join("\n");
}

/**
 * Record a brain-learn activate as a feed-flow event (directory growth proof).
 */
export function recordBrainLearnFeedFlow(cycle) {
  const body =
    "Brain learn cycle #" + (cycle?.cycleIndex ?? "?") +
    " peer=" + (cycle?.peer?.verdict || cycle?.peerVerdict || "?") +
    " memΔ=" + (cycle?.diff?.memoryDelta ?? "?") +
    " strandΔ=" + (cycle?.diff?.strandDelta ?? "?");
  return recordFeedFlow({
    kind: "brain-learn",
    topic: "brain-learn-cycle-" + String(cycle?.cycleIndex ?? 0).padStart(3, "0"),
    source: "brain-learn",
    body,
    contentCommit: cycle?.contentCommit || null,
    locations: MAINFRAME_ANCHORS.known.map((a) => a.tx),
    meta: {
      cycleIndex: cycle?.cycleIndex ?? null,
      memoryDelta: cycle?.diff?.memoryDelta ?? null,
      strandDelta: cycle?.diff?.strandDelta ?? null,
      zeroProofRoot: cycle?.zeroProof?.root || null,
      peerVerdict: cycle?.peer?.verdict || null,
    },
  });
}

/**
 * Record backlog enqueue / seal into the feed-flow ledger.
 */
export function recordBacklogFeedFlow({
  item = null,
  phase = "enqueue",
  locations = [],
} = {}) {
  if (!item) return { ok: false, reason: "no backlog item" };
  const locs = [
    ...((item.locations || []).filter(isTxHash)),
    ...(locations || []).filter(isTxHash),
  ];
  return recordFeedFlow({
    kind: "backlog-" + phase,
    topic: item.topic || item.id || "backlog",
    source: "feed-backlog",
    body:
      "Backlog " + phase + " · " + (item.id || "?") +
      " · " + (item.name || item.topic || "") +
      " · status=" + (item.status || "?") +
      " · bytes=" + (item.bytes ?? "?"),
    contentCommit: item.contentCommit || null,
    locations: locs.length ? locs : MAINFRAME_ANCHORS.known.map((a) => a.tx),
    meta: {
      backlogId: item.id || null,
      status: item.status || null,
      bytes: item.bytes ?? null,
      chunks: item.chunks ?? null,
      vinId: item.vinId || null,
      phase,
    },
  });
}

export function feedFlowLedgerPath() {
  return LEDGER_PATH;
}
