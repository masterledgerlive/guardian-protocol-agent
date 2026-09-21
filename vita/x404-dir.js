/**
 * x404 directory tags — same display name, many plotted locations.
 *
 * Style: like HTTP 404 inverted into a filing system. One tag name can
 * point at many plots (Telegram path, filing path, strand, sealed Base).
 * Directories = answer-key routes = the path the chain took.
 *
 * Sealed Base loc is optional and only attached when proven (hardcoded
 * anchors or already-sealed inject locs). Never invents tx hashes.
 * Plots wait for a master-location tag until an operator/chain proves one.
 *
 * Mother brain untouched. VITAFEED_PAID stays gated.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FORMULA_ID, MAINFRAME_ANCHORS } from "./mainframe.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(HERE, "x404-dir.json");
const MEMORY_DIR = join(HERE, "memory");
const STRANDS_DIR = join(HERE, "strands");
const LEDGER_PATH = join(MEMORY_DIR, "x404-dir-ledger.json");

export const X404_ID = "vita-x404-dir-v1";
export const X404_MAGIC = "§X404§";
export const X404_LABEL = "X404_DIR";
export const X404_STYLE = "x404";

function sha256Hex(text) {
  return createHash("sha256").update(String(text || ""), "utf8").digest("hex");
}

function shortHex(hex, n = 8) {
  return String(hex || "").replace(/^0x/i, "").toLowerCase().slice(0, n);
}

export function isTxHash(h) {
  return /^0x[0-9a-fA-F]{64}$/.test(String(h || ""));
}

function clip(s, n = 120) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length <= n ? t : t.slice(0, n - 1) + "…";
}

function ensureDirs() {
  if (!existsSync(MEMORY_DIR)) mkdirSync(MEMORY_DIR, { recursive: true });
  if (!existsSync(STRANDS_DIR)) mkdirSync(STRANDS_DIR, { recursive: true });
}

function knownAnchorSet() {
  const set = new Set();
  for (const a of MAINFRAME_ANCHORS.known || []) {
    if (isTxHash(a.tx)) set.add(String(a.tx).toLowerCase());
  }
  return set;
}

/** True only for hardcoded Base anchors (class proof) or already-sealed inject locs. */
export function isKnownSealedHash(h, extraSealed = []) {
  if (!isTxHash(h)) return false;
  const low = String(h).toLowerCase();
  if (knownAnchorSet().has(low)) return true;
  for (const x of extraSealed || []) {
    const tx = typeof x === "string" ? x : x?.location || x?.tx;
    if (isTxHash(tx) && String(tx).toLowerCase() === low) return true;
  }
  return false;
}

function freezePlot(plot) {
  const sealed = isTxHash(plot?.sealedBaseLoc) ? String(plot.sealedBaseLoc).toLowerCase() : null;
  const proven = sealed && isKnownSealedHash(sealed);
  return {
    plotId: String(plot?.plotId || ""),
    plottedLocation: String(plot?.plottedLocation || ""),
    net: String(plot?.net || "filing"),
    answerKeyRoute: Array.isArray(plot?.answerKeyRoute)
      ? plot.answerKeyRoute.map((s) => String(s))
      : [],
    sealedBaseLoc: proven ? sealed : null,
    masterLocationTag: plot?.masterLocationTag || null,
    status: proven
      ? (plot?.status === "proven" ? "proven" : "proven")
      : String(plot?.status || "waiting-master-tag"),
    input: plot?.input || null,
  };
}

function freezeTag(tag) {
  return {
    name: String(tag?.name || ""),
    displayName: String(tag?.displayName || tag?.name || ""),
    kind: String(tag?.kind || "tag"),
    plots: (tag?.plots || []).map(freezePlot),
  };
}

export function loadX404Schema() {
  const raw = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
  return {
    id: raw.id || X404_ID,
    label: raw.label || X404_LABEL,
    magic: raw.magic || X404_MAGIC,
    style: raw.style || X404_STYLE,
    formula: raw.formula || FORMULA_ID,
    neverInventHashes: true,
    openKey: raw.openKey !== false,
    note: raw.note || "",
    tags: (raw.tags || []).map(freezeTag),
  };
}

/** Same display name → many plots. */
export function lookupX404Tag(name, schema = loadX404Schema()) {
  const q = String(name || "").trim().toLowerCase();
  if (!q) return { ok: false, reason: "empty tag name", plots: [] };
  const hits = (schema.tags || []).filter(
    (t) => t.name.toLowerCase() === q || t.displayName.toLowerCase() === q,
  );
  if (!hits.length) {
    return { ok: false, reason: "no x404 tag: " + q, name: q, plots: [] };
  }
  const plots = hits.flatMap((t) =>
    (t.plots || []).map((p) => ({ ...p, tagName: t.name, displayName: t.displayName, kind: t.kind })),
  );
  return {
    ok: true,
    name: hits[0].name,
    displayName: hits[0].displayName,
    kind: hits[0].kind,
    sameNameManyPlots: plots.length > 1,
    plotCount: plots.length,
    plots,
    neverInventHashes: true,
  };
}

export function listX404Tags(schema = loadX404Schema()) {
  return (schema.tags || []).map((t) => ({
    name: t.name,
    displayName: t.displayName,
    kind: t.kind,
    plotCount: (t.plots || []).length,
    provenCount: (t.plots || []).filter((p) => p.status === "proven" && isTxHash(p.sealedBaseLoc)).length,
    waitingCount: (t.plots || []).filter((p) => p.status === "waiting-master-tag").length,
  }));
}

/**
 * Search tags/plots by name, route, net, or plotted location.
 * Hex KEY+LOC and Telegram paths are first-class. Never invents hashes.
 */
export function searchX404(query, schema = loadX404Schema()) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return { ok: false, reason: "empty query", hits: [] };
  const hits = [];
  for (const tag of schema.tags || []) {
    for (const plot of tag.plots || []) {
      const hay = [
        tag.name,
        tag.displayName,
        tag.kind,
        plot.plotId,
        plot.plottedLocation,
        plot.net,
        plot.status,
        plot.masterLocationTag,
        ...(plot.answerKeyRoute || []),
        plot.sealedBaseLoc || "",
        plot.input || "",
      ]
        .join(" ")
        .toLowerCase();
      if (hay.includes(q)) {
        hits.push({
          name: tag.name,
          displayName: tag.displayName,
          kind: tag.kind,
          ...plot,
        });
      }
    }
  }
  return {
    ok: true,
    query: q,
    count: hits.length,
    hits,
    neverInventHashes: true,
  };
}

/**
 * Attach a sealed Base loc to a plot. Hash must already be known (anchor or
 * extra sealed). Refuses invented hashes. Plot stays waiting-master-tag until
 * masterLocationTag is set.
 */
export function attachProvenLoc({
  plotId = "",
  hash = "",
  masterLocationTag = null,
  extraSealed = [],
  schema = loadX404Schema(),
} = {}) {
  if (!isTxHash(hash)) {
    return { ok: false, reason: "not a Base tx hash — refuse (never invent)" };
  }
  if (!isKnownSealedHash(hash, extraSealed)) {
    return {
      ok: false,
      reason: "hash not in hardcoded anchors or sealed inject locs — refuse invented loc",
      hash: String(hash).toLowerCase(),
    };
  }
  const id = String(plotId || "");
  let found = null;
  for (const tag of schema.tags || []) {
    found = (tag.plots || []).find((p) => p.plotId === id);
    if (found) {
      found = { ...found, tagName: tag.name, displayName: tag.displayName };
      break;
    }
  }
  if (!found) {
    return { ok: false, reason: "unknown plotId: " + id };
  }
  const loc = String(hash).toLowerCase();
  const tagged = masterLocationTag != null && String(masterLocationTag).trim() !== "";
  const next = {
    ...found,
    sealedBaseLoc: loc,
    status: tagged ? "proven" : "waiting-master-tag",
    masterLocationTag: tagged ? String(masterLocationTag) : found.masterLocationTag || null,
  };
  appendX404Ledger({
    topic: "attach-proven-loc",
    plotId: id,
    location: loc,
    status: next.status,
    masterLocationTag: next.masterLocationTag,
  });
  return {
    ok: true,
    plot: next,
    waitingMasterTag: next.status === "waiting-master-tag",
    neverInventHashes: true,
  };
}

export function waitingMasterTagPlots(schema = loadX404Schema()) {
  const out = [];
  for (const tag of schema.tags || []) {
    for (const plot of tag.plots || []) {
      if (plot.status === "waiting-master-tag") {
        out.push({ ...plot, tagName: tag.name, displayName: tag.displayName, kind: tag.kind });
      }
    }
  }
  return out;
}

export function provenX404Locs(schema = loadX404Schema()) {
  const out = [];
  const seen = new Set();
  for (const tag of schema.tags || []) {
    for (const plot of tag.plots || []) {
      if (!isTxHash(plot.sealedBaseLoc)) continue;
      const loc = plot.sealedBaseLoc.toLowerCase();
      if (seen.has(loc)) continue;
      if (!isKnownSealedHash(loc)) continue;
      seen.add(loc);
      const anchor = (MAINFRAME_ANCHORS.known || []).find((a) => a.tx.toLowerCase() === loc);
      out.push({
        id: anchor?.id || plot.plotId,
        location: loc,
        kind: anchor?.kind || "vita",
        label: anchor?.label || plot.plottedLocation,
        basescan: (MAINFRAME_ANCHORS.basescanTx || "https://basescan.org/tx/") + loc,
        idmChat: "Basescan → Input Data → View as UTF-8",
        tagName: tag.name,
        plotId: plot.plotId,
        classProofOnly: Boolean(anchor),
      });
    }
  }
  return out;
}

export function formatX404Card(name = "", schema = loadX404Schema()) {
  const lines = [];
  lines.push(X404_MAGIC + "v1|style=" + X404_STYLE + "§");
  if (name) {
    const hit = lookupX404Tag(name, schema);
    if (!hit.ok) {
      lines.push("x404 MISS — " + hit.reason);
      lines.push("same name can map to many plots. try /agents dir");
      return lines.join("\n");
    }
    lines.push("x404 TAG  " + hit.displayName + "  (" + hit.plotCount + " plots)");
    lines.push("kind=" + hit.kind + "  sameNameManyPlots=" + (hit.sameNameManyPlots ? "YES" : "no"));
    lines.push("━━━━━━━━━━━━━━━━━━━━");
    for (const p of hit.plots) {
      lines.push("• " + p.plotId);
      lines.push("  plot  " + clip(p.plottedLocation, 80));
      lines.push("  net   " + p.net + "  status=" + p.status);
      lines.push("  route " + (p.answerKeyRoute || []).join(" → "));
      if (isTxHash(p.sealedBaseLoc)) {
        lines.push("  sealed " + shortHex(p.sealedBaseLoc, 8) + "…  " + MAINFRAME_ANCHORS.basescanTx + p.sealedBaseLoc);
      } else {
        lines.push("  sealed — (waiting master-location tag)");
      }
    }
    return lines.join("\n");
  }
  lines.push("x404 DIRECTORY TAGS — same name, many plots");
  lines.push("dirs = answer-key routes = path the chain took");
  lines.push("━━━━━━━━━━━━━━━━━━━━");
  for (const t of listX404Tags(schema)) {
    lines.push(
      "• " +
        t.displayName +
        "  plots=" +
        t.plotCount +
        "  proven=" +
        t.provenCount +
        "  waiting=" +
        t.waitingCount,
    );
  }
  lines.push("");
  lines.push("open: /agents dir <name>   proven: /agents proven");
  lines.push("IDM only for sealed matching locs. Never invented.");
  return lines.join("\n");
}

export function formatX404PathMapCard(schema = loadX404Schema()) {
  const lines = [];
  lines.push(X404_MAGIC + "v1|path-map§");
  lines.push("PATH MAP — answer-key routes (chain took these)");
  lines.push("━━━━━━━━━━━━━━━━━━━━");
  for (const tag of schema.tags || []) {
    for (const plot of tag.plots || []) {
      lines.push(tag.displayName + " · " + plot.net);
      lines.push("  " + (plot.answerKeyRoute || []).join(" → "));
    }
  }
  const waiting = waitingMasterTagPlots(schema);
  lines.push("");
  lines.push("waiting master-location tag: " + waiting.length);
  return lines.join("\n");
}

/** Kids of VITA:\\X404 — one entry per tag name (many plots behind each). */
export function listX404DirEntries(schema = loadX404Schema()) {
  return listX404Tags(schema).map((t, i) => ({
    n: i + 1,
    name: t.name + ".x404",
    kind: "x404",
    bytes: t.plotCount,
    unlockName: t.name,
    english:
      "x404 tag " +
      t.displayName +
      " — " +
      t.plotCount +
      " plotted locations (same name, different plots). proven=" +
      t.provenCount +
      " waiting=" +
      t.waitingCount,
    machine:
      "X404 name=" +
      t.name +
      " plots=" +
      t.plotCount +
      " proven=" +
      t.provenCount +
      " waitMaster=" +
      t.waitingCount,
    locations: provenX404Locs(schema)
      .filter((l) => l.tagName === t.name)
      .map((l) => l.location),
    trueName: t.name,
  }));
}

function appendX404Ledger(note) {
  ensureDirs();
  let doc = { id: "x404-dir-ledger-v1", filingLabel: X404_LABEL, events: [] };
  try {
    if (existsSync(LEDGER_PATH)) doc = JSON.parse(readFileSync(LEDGER_PATH, "utf8"));
  } catch { /* fresh */ }
  if (!Array.isArray(doc.events)) doc.events = [];
  const locations = [];
  if (isTxHash(note.location)) locations.push(String(note.location).toLowerCase());
  doc.events.push({
    at: new Date().toISOString(),
    ...note,
    locations,
    formula: FORMULA_ID,
    neverForget: true,
    neverInventHashes: true,
  });
  if (doc.events.length > 200) doc.events = doc.events.slice(-200);
  doc.updatedAt = new Date().toISOString();
  writeFileSync(LEDGER_PATH, JSON.stringify(doc, null, 2) + "\n");
}

export function x404ContentCommit(schema = loadX404Schema()) {
  return sha256Hex(JSON.stringify({
    id: schema.id,
    tags: (schema.tags || []).map((t) => ({
      name: t.name,
      plots: (t.plots || []).map((p) => p.plotId),
    })),
  }));
}

export { SCHEMA_PATH as X404_SCHEMA_PATH, LEDGER_PATH as X404_LEDGER_PATH };
