/**
 * VITA DOS-style master directory — Telegram filing + open-source unlock.
 *
 * Master drive layout (like DOS):
 *   VITA:\
 *     FORMULA\   ANCHORS\   FILING\
 *     MEMORY\    STRANDS\   LEARN\
 *     REF_LIB\   CODEX\     MG_RECALL\
 *     LIBRARY\   PROVEN\   KIDS\
 *
 * Unlock key is OPEN SOURCE — file name + content digest. Never a private key.
 * Machine-short (ZK-style squash) unwraps instantly to English + machine blocks
 * so Telegram can prove what agentic AI filed and how to recover it.
 *
 * Mother brain / vitaSave untouched. Never invents tx hashes.
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FORMULA_ID, MAINFRAME_ANCHORS, ORIGINAL_FORMULA } from "./mainframe.js";
import { listLibraryEntries, resolveLibraryEntry } from "./vita-feed-library.js";
import { CALCULATOR_TRUE_NAME, TRANSLATOR_CODEX, searchRefMemory } from "./ref-memory.js";
import { loadRecallBank } from "./mg-recall-bank.js";
import { urlDirEntriesFor } from "./url-dir.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const MEMORY_DIR = join(HERE, "memory");
const STRANDS_DIR = join(HERE, "strands");

export const VITADIR_ID = "vita-dir-v1";
export const VITADIR_MAGIC = "§VITADIR§";
export const VITADIR_UNLOCK_MAGIC = "§VITAUNLOCK§";
export const VITADIR_LABEL = "VITADIR";
export const VITADIR_ROOT = "VITA:\\";

/** Master → subdirs (DOS style). */
export const VITADIR_SUBDIRS = Object.freeze([
  { name: "FORMULA", role: "invariants", filing: "FORMULA" },
  { name: "ANCHORS", role: "hardcoded Base locs", filing: "ANCHORS" },
  { name: "FILING", role: "label map", filing: "FILING" },
  { name: "MEMORY", role: "append-only notes", filing: "MEMORY" },
  { name: "STRANDS", role: "sparse inject plans", filing: "STRAND" },
  { name: "LEARN", role: "brain learn + zero-proof", filing: "BRAIN_LEARN" },
  { name: "REF_LIB", role: "true-name catalogue", filing: "REF_LIB" },
  { name: "CODEX", role: "math · theories · translator", filing: "TRANSLATOR_CODEX" },
  { name: "MG_RECALL", role: "mother-genesis recall bank", filing: "MG_RECALL" },
  { name: "LIBRARY", role: "sealed name→key→locs", filing: "VITALIB" },
  { name: "PROVEN", role: "proven test series", filing: "PROVEN_TEST" },
  { name: "KIDS", role: "closed-garden YouTube URL playlist", filing: "URLDIR" },
]);

/** Seed library: start of open codex (math / theories) — not private. */
export const CODEX_SEED = Object.freeze([
  {
    name: "math-pythagoras.txt",
    kind: "math",
    trueName: "pythagoras",
    english: "a² + b² = c² for a right triangle. Open formula — no private key.",
    machine: "EQ sq(a)+sq(b) sq(c) | domain=euclid-plane",
    mime: "text/plain",
  },
  {
    name: "math-euler.txt",
    kind: "math",
    trueName: "euler-identity",
    english: "e^(iπ) + 1 = 0 — Euler identity. Codex seed for the library.",
    machine: "EQ exp(i*pi)+1 0 | domain=complex",
    mime: "text/plain",
  },
  {
    name: "theory-message-first.txt",
    kind: "theory",
    trueName: "message-first",
    english:
      "When leftover covers KEY+LOC, hitch. Storage Token charges the delta. Do not mute memory for micro extract.",
    machine: "RULE hitch=1 when keyLocCovered | charge=StorageToken | mute=forbid",
    mime: "text/plain",
  },
  {
    name: "codex-calculator.txt",
    kind: "codex",
    trueName: CALCULATOR_TRUE_NAME,
    english:
      "True name calculator. Ask = catalogue. Self = one-job build. Translator aliases unwrap instantly.",
    machine: "TRUE calculator | ASK catalogue | SELF job-calc | UNWRAP translator-codex",
    mime: "text/plain",
  },
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

function safeReadJson(path) {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function clip(text, n = 160) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  return t.length <= n ? t : t.slice(0, n - 1) + "…";
}

/**
 * Open-source unlock key — name + content digest. NEVER a private key.
 * Selecting the file in Telegram is enough to unlock.
 */
export function openSourceUnlockKey({ name, content = "", contentCommit = null } = {}) {
  const commit = contentCommit || sha256Hex(String(content || name || ""));
  return {
    scheme: "vita-open-unlock-v1",
    privateKey: false,
    openSource: true,
    name: String(name || "untitled"),
    key: "VITAOPEN." + sanitizeDosName(name) + "." + shortHex(commit, 12),
    contentCommit: commit,
    note: "File name unlocks. No wallet secret. Instant unwrap of ZK-short machine form.",
  };
}

export function sanitizeDosName(name) {
  return String(name || "FILE")
    .replace(/[^\w.\-]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 64) || "FILE";
}

/** ZK-style machine-short packing — commitment + short tokens; unwrap is instant for open data. */
export function packMachineShort({ english, machine, locs = [], trueName = null } = {}) {
  const commit = sha256Hex([english || "", machine || "", (locs || []).join("|")].join("¦"));
  const loc8 = (locs || []).filter(isTxHash).map((t) => shortHex(t, 8));
  return {
    zkClass: "content-commitment-v1",
    snarkReady: true,
    privateWitness: false,
    instantUnwrap: true,
    short:
      "ZK§" +
      shortHex(commit, 10) +
      (trueName ? "|T=" + trueName : "") +
      (loc8.length ? "|L=" + loc8.join(",") : "") +
      "|M=" +
      clip(machine || english || "", 48),
    commit,
    loc8,
  };
}

export function unwrapMachineShort(packed, { english, machine } = {}) {
  return {
    ok: true,
    instant: true,
    privateKeyRequired: false,
    english: english || "open packaged English",
    machine: machine || packed?.short || "",
    zkClass: packed?.zkClass || "content-commitment-v1",
    note: "Open-source unwrap — blocks reveal without a private key.",
  };
}

function listJsonFiles(dir) {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .map((f) => {
        const path = join(dir, f);
        let bytes = 0;
        try {
          bytes = statSync(path).size;
        } catch { /* ignore */ }
        return { name: f, bytes, path };
      });
  } catch {
    return [];
  }
}

function dirEntriesFor(subdir) {
  const name = String(subdir || "").toUpperCase().replace(/\\/g, "").replace(/:/g, "");
  const out = [];

  if (name === "FORMULA") {
    out.push({
      n: 1,
      name: "ORIGINAL_FORMULA.md",
      kind: "text",
      bytes: JSON.stringify(ORIGINAL_FORMULA).length,
      unlockName: "ORIGINAL_FORMULA.md",
      english: "Message-first formula. HTML memory until inject. Never invent hashes.",
      machine: "FORMULA id=" + FORMULA_ID + " hitch=key-loc prove=eureka mute=forbid",
      locations: MAINFRAME_ANCHORS.known.map((a) => a.tx),
    });
  } else if (name === "ANCHORS") {
    MAINFRAME_ANCHORS.known.forEach((a, i) => {
      out.push({
        n: i + 1,
        name: a.id + ".loc",
        kind: "chain",
        bytes: 66,
        unlockName: a.id + ".loc",
        english: a.label || a.lesson,
        machine: "LOC kind=" + a.kind + " tx=" + shortHex(a.tx, 8),
        locations: [a.tx],
      });
    });
  } else if (name === "FILING") {
    out.push({
      n: 1,
      name: "FILING.md",
      kind: "text",
      bytes: 0,
      unlockName: "FILING.md",
      english: "Directory contract + label → blockchain map.",
      machine: "FILING labels=FORMULA,ANCHORS,MEMORY,STRAND,REF_LIB,VITADIR,…",
      locations: MAINFRAME_ANCHORS.known.map((a) => a.tx),
    });
  } else if (name === "MEMORY" || name === "STRANDS") {
    const files = listJsonFiles(name === "MEMORY" ? MEMORY_DIR : STRANDS_DIR);
    files.forEach((f, i) => {
      const raw = safeReadJson(f.path) || {};
      const text = clip(raw.text || raw.learn || raw.note || raw.topic || f.name, 140);
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
      out.push({
        n: i + 1,
        name: f.name,
        kind: name === "MEMORY" ? "memory" : "strand",
        bytes: f.bytes,
        unlockName: f.name,
        english: text,
        machine: "FILE " + f.name + " bytes=" + f.bytes + " label=" + (raw.filingLabel || name),
        locations: [...new Set(locs)],
        filingLabel: raw.filingLabel || name,
      });
    });
  } else if (name === "LEARN") {
    const log = safeReadJson(join(MEMORY_DIR, "brain-learn-log.json"));
    const cycles = log?.cycles?.length || 0;
    const roots = log?.zeroProof?.roots || [];
    out.push({
      n: 1,
      name: "brain-learn-log.json",
      kind: "learn",
      bytes: 0,
      unlockName: "brain-learn-log.json",
      english: "Append-only learn cycles + zero-proof roots. Content commits only.",
      machine: "LEARN cycles=" + cycles + " roots=" + roots.length + " last=" + shortHex(roots.at(-1) || "", 12),
      locations: MAINFRAME_ANCHORS.known.map((a) => a.tx),
    });
  } else if (name === "REF_LIB" || name === "PROVEN") {
    const q = name === "PROVEN" ? "calculator" : "calculator";
    const found = searchRefMemory(q);
    (found.hits || []).forEach((h, i) => {
      out.push({
        n: i + 1,
        name: sanitizeDosName((h.title || h.id) + ".ref"),
        kind: "ref",
        bytes: 0,
        unlockName: h.id || h.title,
        english: clip(h.text || h.title, 160),
        machine: "REF true=" + h.trueName + " label=" + h.label + " kind=" + (h.kind || ""),
        locations: h.locations || [],
        trueName: h.trueName,
      });
    });
  } else if (name === "CODEX") {
    CODEX_SEED.forEach((c, i) => {
      out.push({
        n: i + 1,
        name: c.name,
        kind: c.kind,
        bytes: Buffer.byteLength(c.english, "utf8"),
        unlockName: c.name,
        english: c.english,
        machine: c.machine,
        locations: MAINFRAME_ANCHORS.known.map((a) => a.tx),
        trueName: c.trueName,
        mime: c.mime,
      });
    });
    const aliases = TRANSLATOR_CODEX.trueNames[CALCULATOR_TRUE_NAME] || [];
    out.push({
      n: out.length + 1,
      name: "translator-codex.txt",
      kind: "codex",
      bytes: aliases.join(",").length,
      unlockName: "translator-codex.txt",
      english: "Free translator codex — multilingual aliases for calculator. Read once, never forget.",
      machine: "TRANS true=calculator aliases=" + aliases.slice(0, 8).join(",") + ",…",
      locations: MAINFRAME_ANCHORS.known.map((a) => a.tx),
      trueName: CALCULATOR_TRUE_NAME,
    });
  } else if (name === "MG_RECALL") {
    const bank = loadRecallBank();
    if (bank) {
      out.push({
        n: 1,
        name: "mg-recall-bank.json",
        kind: "recall",
        bytes: bank.body ? Buffer.byteLength(bank.body, "utf8") : 0,
        unlockName: "mg-recall-bank.json",
        english:
          "Mother-genesis recall bank. Last layer = refined queries. Reader " +
          (bank.readerKey || "—") +
          ". Chain locs: " +
          ((bank.locations || []).length || "none yet (force-banked)"),
        machine:
          "MGRECALL strand=" +
          (bank.strandId || "") +
          " chunks=" +
          (bank.totalChunks || 0) +
          " last=" +
          (bank.lastLayer || "REFINED_QUERIES"),
        locations: (bank.locations || []).filter(isTxHash),
        readerKey: bank.readerKey || null,
      });
    }
  } else if (name === "LIBRARY") {
    listLibraryEntries().forEach((e) => {
      out.push({
        n: e.n,
        name: e.name,
        kind: e.playKind || "file",
        bytes: e.rawBytes || 0,
        unlockName: e.name,
        english: "Sealed library row — " + (e.mime || "blob") + " · locs=" + (e.locationCount || 0),
        machine: "LIB key=" + (e.readerKey || "—") + " vin=" + (e.vinId || "—"),
        locations: e.locations || [],
        readerKey: e.readerKey || null,
        mime: e.mime,
      });
    });
  } else if (name === "KIDS" || name === "URLDIR") {
    urlDirEntriesFor().forEach((e) => out.push(e));
  }

  return { subdir: name, entries: out };
}

export function listMasterDirectory() {
  const rows = VITADIR_SUBDIRS.map((d) => {
    const listed = dirEntriesFor(d.name);
    return {
      name: d.name,
      role: d.role,
      filing: d.filing,
      files: listed.entries.length,
      path: VITADIR_ROOT + d.name + "\\",
    };
  });
  const fileCount = rows.reduce((n, r) => n + r.files, 0);
  return {
    root: VITADIR_ROOT,
    formula: FORMULA_ID,
    filingLabel: VITADIR_LABEL,
    subdirs: rows,
    fileCount,
    neverInventHashes: true,
    openSourceUnlock: true,
    privateKey: false,
  };
}

export function listSubDirectory(subdir) {
  const name = String(subdir || "")
    .trim()
    .replace(/^VITA:\\?/i, "")
    .replace(/\\+/g, "")
    .toUpperCase();
  if (!name || name === "." || name === "\\") {
    return { ok: true, master: true, ...listMasterDirectory() };
  }
  const known = VITADIR_SUBDIRS.some((d) => d.name === name);
  if (!known) {
    return {
      ok: false,
      reason: "unknown subdir — try " + VITADIR_SUBDIRS.map((d) => d.name).join(" | "),
    };
  }
  const listed = dirEntriesFor(name);
  return {
    ok: true,
    master: false,
    root: VITADIR_ROOT,
    path: VITADIR_ROOT + name + "\\",
    subdir: name,
    entries: listed.entries,
    count: listed.entries.length,
    openSourceUnlock: true,
    privateKey: false,
  };
}

/**
 * Unlock by path, number, or name. Instant unwrap — no private key.
 */
export function unlockDirectoryEntry(selector, { subdir = null } = {}) {
  const raw = String(selector || "").trim();
  if (!raw) {
    return { ok: false, reason: "usage: /vitafeed unlock <subdir\\name|n|name>" };
  }

  let dir = subdir;
  let fileSel = raw;
  const pathLike = raw.replace(/\//g, "\\");
  if (/\\/.test(pathLike) || /^[A-Z_]+:\\/i.test(pathLike)) {
    const cleaned = pathLike.replace(/^VITA:\\?/i, "");
    const parts = cleaned.split("\\").filter(Boolean);
    if (parts.length >= 2) {
      dir = parts[0];
      fileSel = parts.slice(1).join("\\");
    } else if (parts.length === 1 && VITADIR_SUBDIRS.some((d) => d.name === parts[0].toUpperCase())) {
      return { ok: false, reason: "pick a file — /vitafeed dir " + parts[0].toUpperCase() };
    }
  }

  // Try sealed library first when no dir or LIBRARY
  if (!dir || String(dir).toUpperCase() === "LIBRARY") {
    const lib = resolveLibraryEntry(fileSel);
    if (lib.ok) {
      const e = lib.public || lib.entry;
      const english =
        "Library file " + e.name + " (" + (e.mime || "?") + "). Play via reader key. Open source unlock.";
      const machine =
        "OPEN lib=" + e.name + " key=" + (e.readerKey || "—") + " locs=" + (e.locationCount || 0);
      const packed = packMachineShort({
        english,
        machine,
        locs: e.locations || [],
        trueName: null,
      });
      const unlock = openSourceUnlockKey({
        name: e.name,
        content: machine,
        contentCommit: e.contentCommit || packed.commit,
      });
      return {
        ok: true,
        source: "LIBRARY",
        path: VITADIR_ROOT + "LIBRARY\\" + e.name,
        entry: e,
        unlock,
        packed,
        reveal: unwrapMachineShort(packed, { english, machine }),
        goalHint: playGoalHint(e.mime, e.playKind),
      };
    }
  }

  const dirsToScan = dir
    ? [String(dir).toUpperCase()]
    : VITADIR_SUBDIRS.map((d) => d.name);

  for (const d of dirsToScan) {
    const listed = dirEntriesFor(d);
    let hit = null;
    if (/^\d+$/.test(fileSel)) {
      hit = listed.entries.find((e) => e.n === Number(fileSel));
    } else {
      const lower = fileSel.toLowerCase();
      hit =
        listed.entries.find((e) => e.name.toLowerCase() === lower) ||
        listed.entries.find((e) => e.unlockName?.toLowerCase() === lower) ||
        listed.entries.find((e) => e.name.toLowerCase().includes(lower));
    }
    if (!hit) continue;

    const packed = packMachineShort({
      english: hit.english,
      machine: hit.machine,
      locs: hit.locations || [],
      trueName: hit.trueName || null,
    });
    const unlock = openSourceUnlockKey({
      name: hit.name,
      content: hit.english + "|" + hit.machine,
      contentCommit: packed.commit,
    });
    return {
      ok: true,
      source: d,
      path: VITADIR_ROOT + d + "\\" + hit.name,
      entry: hit,
      unlock,
      packed,
      reveal: unwrapMachineShort(packed, { english: hit.english, machine: hit.machine }),
      goalHint: playGoalHint(hit.mime, hit.kind),
    };
  }

  return { ok: false, reason: "not found: " + raw + " — /vitafeed dir to browse" };
}

function playGoalHint(mime, kind) {
  const m = String(mime || "");
  const k = String(kind || "");
  if (m.startsWith("audio/") || k === "audio") return "song → /vitafeed play · feed-player";
  if (m.startsWith("video/") || k === "video") return "movie → /vitafeed play · feed-player";
  if (k === "youtube" || k === "url" || m.includes("uri-list") || m.includes("mpegurl")) {
    return "kids url dir → /vitafeed play kids · /vita/kids-player";
  }
  if (m.includes("html") || k === "html") return "html → unwrap English + machine; open as page when sealed";
  if (k === "math" || k === "codex" || k === "theory") return "codex → English + machine formula; library seed";
  if (k === "strand" || k === "memory") return "filed note → cite locs; recover via /vitapull or reader key";
  return "reveal English + machine blocks; seal via /vitafeed when funded";
}

export function formatMasterDirCard(master = listMasterDirectory()) {
  const lines = [];
  lines.push(VITADIR_MAGIC + "v1|root=" + master.root + "§");
  lines.push("VITA MASTER DIRECTORY (DOS-style)");
  lines.push("formula=" + master.formula);
  lines.push("unlock=OPEN-SOURCE file-name  ·  privateKey=NO");
  lines.push("zk=content-commitment · instantUnwrap=YES");
  lines.push("files≈" + master.fileCount + " across " + master.subdirs.length + " subdirs");
  lines.push("");
  lines.push(master.root);
  for (const d of master.subdirs) {
    lines.push(
      "  " + d.name.padEnd(12) + "<DIR>  " + String(d.files).padStart(4) + "  " + d.role,
    );
  }
  lines.push("");
  lines.push("TAP the <DIR> buttons below — every subdir is click-through.");
  lines.push("cd:   /vitafeed dir MEMORY");
  lines.push("open: /vitafeed unlock CODEX\\math-euler.txt");
  lines.push("also: /vitafeed unlock 1   (after dir)");
  lines.push("proof: tap a name → SNARK first · Human plain · Machine key");
  return lines.join("\n");
}

export function formatSubDirCard(listed) {
  if (!listed?.ok) {
    return VITADIR_MAGIC + " MISS\n" + (listed?.reason || "unknown");
  }
  if (listed.master) return formatMasterDirCard(listed);
  const lines = [];
  lines.push(VITADIR_MAGIC + "v1|path=" + listed.path + "§");
  lines.push("Directory of " + listed.path);
  lines.push("unlock=OPEN-SOURCE  ·  privateKey=NO  ·  instantUnwrap=YES");
  lines.push("count=" + listed.count);
  lines.push("");
  for (const e of (listed.entries || []).slice(0, 40)) {
    const tag = (e.kind || "file").slice(0, 6).padEnd(6);
    lines.push(
      String(e.n).padStart(3) +
        "  " +
        tag +
        "  " +
        String(e.bytes || 0).padStart(6) +
        "  " +
        e.name,
    );
  }
  if ((listed.entries || []).length > 40) {
    lines.push("  … +" + ((listed.entries || []).length - 40) + " more");
  }
  lines.push("");
  lines.push("TAP a file below — SNARK path first, then Human + Machine.");
  lines.push("unlock: /vitafeed unlock " + listed.subdir + "\\<name|n>");
  lines.push("up:     /vitafeed dir");
  return lines.join("\n");
}

export function formatUnlockCard(result, { timing = null } = {}) {
  if (!result?.ok) {
    return VITADIR_UNLOCK_MAGIC + " REFUSE\n" + (result?.reason || "miss");
  }
  const lines = [];
  // Static / SNARK-compressed identity first — player sees path + short before body.
  const staticName = sanitizeDosName(result.entry?.name || result.path || "FILE");
  lines.push(VITADIR_UNLOCK_MAGIC + "v1|openSource=1§");
  lines.push("FILE  " + staticName);
  lines.push("PATH  " + result.path);
  lines.push("SNARK " + result.packed.short);
  lines.push("key=" + result.unlock.key);
  lines.push("privateKey=NO · openSource=YES · instantUnwrap=YES");
  if (timing) {
    lines.push(
      "timing human=" +
        timing.humanMs +
        "ms machine=" +
        timing.machineMs +
        "ms total=" +
        timing.totalMs +
        "ms · plainProof=" +
        (timing.plainTextProof ? "YES" : "no") +
        " · snarkDenser=" +
        (timing.snarkUnlocksDenser ? "YES" : "no"),
    );
  }
  lines.push("");
  lines.push("— HUMAN (plain text — proof enough) —");
  lines.push(result.reveal.english);
  lines.push("");
  lines.push("— MACHINE (key exposed — denser lane) —");
  lines.push(result.reveal.machine);
  if (result.packed?.commit) {
    lines.push("commit=" + shortHex(result.packed.commit, 16));
  }
  if ((result.entry?.locations || []).length) {
    lines.push("");
    lines.push("— LOCS (assemble → picture/song/movie/code · never invented) —");
    for (const tx of result.entry.locations.slice(0, 6)) {
      if (!isTxHash(tx)) continue;
      lines.push("  " + shortHex(tx, 8) + "…  " + MAINFRAME_ANCHORS.basescanTx + tx);
    }
  }
  if (result.entry?.readerKey) {
    lines.push("reader=" + result.entry.readerKey);
  }
  lines.push("");
  lines.push("goal: " + (result.goalHint || "reveal + recover"));
  lines.push("click: Human · Machine · Play · Dual · Track inject");
  lines.push("prove: both routes timed; plain text proves; SNARK unlocks denser data");
  return lines.join("\n");
}

export function directoryStats() {
  const master = listMasterDirectory();
  const memoryFiles = listJsonFiles(MEMORY_DIR).length;
  const strandFiles = listJsonFiles(STRANDS_DIR).length;
  const bank = loadRecallBank();
  return {
    root: VITADIR_ROOT,
    subdirs: master.subdirs.length,
    filesListed: master.fileCount,
    memoryJson: memoryFiles,
    strandJson: strandFiles,
    libraryRows: listLibraryEntries().length,
    recallChars: bank?.body ? Buffer.byteLength(bank.body, "utf8") : 0,
    recallChunks: bank?.totalChunks || 0,
    openSourceUnlock: true,
    privateKey: false,
    note: "Fund later — first learn ingest size + recover path. Money is not the gate.",
  };
}

export function formatDirStatsCard(stats = directoryStats()) {
  return [
    VITADIR_MAGIC + " INGEST / RECOVER",
    "subdirs=" + stats.subdirs + " listed≈" + stats.filesListed,
    "memoryJson=" + stats.memoryJson + " strands=" + stats.strandJson,
    "libraryRows=" + stats.libraryRows,
    "recallBank chars=" + stats.recallChars + " chunks=" + stats.recallChunks,
    "unlock=open-source file-name · zk unwrap=instant",
    stats.note,
  ].join("\n");
}
