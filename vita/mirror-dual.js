/**
 * VITA mirror dual-path — GitHub duplicate navigate + availability|proven reader.
 *
 * Same file name = fixed location on disk / GitHub. Blockchain lock+key is the
 * open-source zero-proof (name + contentCommit) + sealed Base locs when matched.
 * Formula anchors prove hitch *class* only — they never pretend to hold file body.
 *
 * Follow-leader: sealed+verified chain UTF-8 leads; else filing contentCommit
 * leads and availability (local/GitHub) follows. Never invent tx hashes.
 *
 * Boot harness: SNARK-compress a real export section, reconstruct from filing
 * CAS (what inject will seal), execute, prove the mirror can boot code.
 */

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, normalize, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";
import { FORMULA_ID, MAINFRAME_ANCHORS } from "./mainframe.js";
import { openSourceUnlockKey, packMachineShort, unwrapMachineShort } from "./vita-dir.js";
import {
  resolveMirrorFile,
  snarkCompressBlob,
  isTxHash,
  collectIdmLocations,
  sanitizeMirrorPath,
  CALLBACK_DATA_MAX,
} from "./mirror-chain.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");
const MEMORY_DIR = join(HERE, "memory");
const STRANDS_DIR = join(HERE, "strands");
const CAS_DIR = join(MEMORY_DIR, "mirror-cas");
const LEDGER_PATH = join(MEMORY_DIR, "mirror-dual-ledger.json");
const STRAND_PATH = join(STRANDS_DIR, "mirror-dual.json");
const INJECT_PLAN_PATH = join(MEMORY_DIR, "chain-layer-inject.json");

export const MIRROR_DUAL_ID = "vita-mirror-dual-v1";
export const MIRROR_DUAL_MAGIC = "§VITADUALPATH§";
export const MIRROR_ZERO_MAGIC = "§VITAZERO§";
export const MIRROR_BOOT_MAGIC = "§VITABOOT§";
export const MIRROR_DUAL_LABEL = "MIRROR_DUAL";
export const ZERO_PROOF_LABEL = "ZERO_PROOF";

/** Path modes the reader can choose. */
export const DUAL_PATH_MODES = Object.freeze(["availability", "proven", "dual"]);

/**
 * Bootable sections — real exports from real files (not stub catalogs).
 * Args run through reconstructed SNARK body to prove boot.
 */
export const MIRROR_BOOT_SECTIONS = Object.freeze([
  {
    id: "hitch-gate",
    file: "vita/mainframe.js",
    exportName: "originalFormulaHitchDecision",
    args: [{ keyLocCovered: true }],
    expect: { encoding: "key-loc", skipHitch: false },
  },
  {
    id: "open-unlock",
    file: "vita/vita-dir.js",
    exportName: "openSourceUnlockKey",
    args: [{ name: "vita/mainframe.js", contentCommit: "abc123deadbeef" }],
    expect: { privateKey: false, openSource: true },
  },
  {
    id: "path-sanitize",
    file: "vita/mirror-chain.js",
    exportName: "sanitizeMirrorPath",
    args: ["vita/anchors.json"],
    expect: { ok: true },
  },
]);

const SKIP_DIR = new Set([
  "node_modules",
  ".git",
  ".cursor",
  "coverage",
  "dist",
  "build",
  ".next",
]);

function sha256Hex(text) {
  return createHash("sha256").update(String(text || ""), "utf8").digest("hex");
}

function shortHex(hex, n = 8) {
  return String(hex || "").replace(/^0x/i, "").toLowerCase().slice(0, n);
}

function ensureDirs() {
  for (const d of [MEMORY_DIR, STRANDS_DIR, CAS_DIR]) {
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
  }
}

function safeReadJson(path) {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function clip(s, n = 140) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length <= n ? t : t.slice(0, n - 1) + "…";
}

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Walk real repo disk into a GitHub-shaped navigable duplicate.
 * Paths match GitHub blob paths (fixed location by name).
 */
export function walkMirrorTree({
  cwd = REPO_ROOT,
  prefix = "",
  maxDepth = 4,
  maxEntries = 400,
} = {}) {
  const root = cwd;
  const start = prefix ? join(root, prefix) : root;
  const entries = [];
  const cleanPrefix = String(prefix || "").replace(/^\/+|\/+$/g, "");

  function walk(dir, depth) {
    if (entries.length >= maxEntries || depth > maxDepth) return;
    let names = [];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    names.sort((a, b) => a.localeCompare(b));
    for (const name of names) {
      if (entries.length >= maxEntries) break;
      if (name.startsWith(".") && name !== ".env.example") continue;
      if (SKIP_DIR.has(name)) continue;
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      const rel = relative(root, full).split(sep).join("/");
      if (st.isDirectory()) {
        entries.push({
          path: rel,
          type: "dir",
          name,
          bytes: null,
          contentCommit: null,
        });
        walk(full, depth + 1);
      } else if (st.isFile()) {
        if (st.size > 2_000_000) {
          entries.push({
            path: rel,
            type: "file",
            name,
            bytes: st.size,
            contentCommit: null,
            skipped: "too-large",
          });
          continue;
        }
        let commit = null;
        try {
          const text = readFileSync(full, "utf8");
          commit = sha256Hex(text);
        } catch {
          commit = null;
        }
        entries.push({
          path: rel,
          type: "file",
          name,
          bytes: st.size,
          contentCommit: commit,
          zeroProof: commit
            ? openSourceUnlockKey({ name: rel, contentCommit: commit })
            : null,
        });
      }
    }
  }

  if (!existsSync(start)) {
    return {
      ok: false,
      reason: "path not found: " + (cleanPrefix || "."),
      prefix: cleanPrefix,
      entries: [],
      neverInventHashes: true,
    };
  }
  const st = statSync(start);
  if (st.isFile()) {
    const rel = relative(root, start).split(sep).join("/");
    const text = readFileSync(start, "utf8");
    const commit = sha256Hex(text);
    return {
      ok: true,
      prefix: cleanPrefix,
      entries: [
        {
          path: rel,
          type: "file",
          name: rel.split("/").pop(),
          bytes: st.size,
          contentCommit: commit,
          zeroProof: openSourceUnlockKey({ name: rel, contentCommit: commit }),
        },
      ],
      fileCount: 1,
      dirCount: 0,
      neverInventHashes: true,
      formula: FORMULA_ID,
    };
  }
  walk(start, 0);
  return {
    ok: true,
    prefix: cleanPrefix,
    entries,
    fileCount: entries.filter((e) => e.type === "file").length,
    dirCount: entries.filter((e) => e.type === "dir").length,
    truncated: entries.length >= maxEntries,
    neverInventHashes: true,
    formula: FORMULA_ID,
    note: "GitHub duplicate from local checkout — same path names as CODE lane.",
  };
}

/** Inject-plan filing map: name → contentCommit + seal/verify counts. */
export function loadInjectFilingMap({ cwd = REPO_ROOT } = {}) {
  const plan =
    safeReadJson(join(cwd, "vita/memory/chain-layer-inject.json")) ||
    safeReadJson(INJECT_PLAN_PATH);
  if (!plan) {
    return {
      ok: false,
      files: {},
      chunks: [],
      note: "no inject plan yet — run /vita check locs",
    };
  }
  const files = {};
  for (const f of plan.files || []) {
    files[f.name] = {
      name: f.name,
      bytes: f.bytes,
      contentCommit: f.contentCommit,
      chunkCount: f.chunkCount,
      sealed: 0,
      verified: 0,
      pending: 0,
      locations: [],
    };
  }
  for (const c of plan.chunks || []) {
    const row = files[c.file];
    if (!row) continue;
    if (c.sealed && isTxHash(c.location)) {
      row.sealed += 1;
      row.locations.push(c.location.toLowerCase());
      if (c.verified) row.verified += 1;
    } else {
      row.pending += 1;
    }
  }
  return {
    ok: true,
    at: plan.at || null,
    totalChunks: plan.totalChunks || (plan.chunks || []).length,
    sealedCount: plan.sealedCount ?? Object.values(files).reduce((n, f) => n + f.sealed, 0),
    pendingCount: plan.pendingCount ?? Object.values(files).reduce((n, f) => n + f.pending, 0),
    verifiedCount: plan.verifiedCount ?? Object.values(files).reduce((n, f) => n + f.verified, 0),
    files,
    formula: FORMULA_ID,
    neverInventHashes: true,
  };
}

/**
 * Follow-leader state for one file.
 * Leader = chain when sealed+verified; else filing contentCommit; availability follows.
 */
export function followLeaderForFile({
  filename,
  availabilityCommit = null,
  filing = null,
} = {}) {
  const name = String(filename || "").replace(/\\/g, "/");
  const row = filing?.files?.[name] || null;
  const sealedOk = row && row.sealed > 0 && row.verified === row.sealed && row.pending === 0;
  const filingCommit = row?.contentCommit || null;
  const match =
    availabilityCommit && filingCommit
      ? availabilityCommit.toLowerCase() === filingCommit.toLowerCase()
      : null;

  let leader = "availability";
  let follower = "filing";
  let proven = false;
  let note = "Availability leads until spaced inject seals matching UTF-8 on Base.";

  if (sealedOk) {
    leader = "chain";
    follower = "availability";
    proven = true;
    note = "Chain sealed+verified UTF-8 leads; GitHub/local follow by same name.";
  } else if (filingCommit) {
    leader = "filing";
    follower = "availability";
    proven = false;
    note =
      "Filing contentCommit leads (pre-seal CAS). Base locs pending — formula anchors are class proof only.";
  }

  return {
    filename: name,
    leader,
    follower,
    proven,
    match,
    availabilityCommit: availabilityCommit || null,
    filingCommit,
    sealed: row?.sealed || 0,
    verified: row?.verified || 0,
    pending: row?.pending ?? (row ? row.chunkCount : null),
    locations: (row?.locations || []).filter(isTxHash),
    note,
    neverInventHashes: true,
  };
}

/** Attach open-source zero-proof key (name + contentCommit). Never a wallet secret. */
export function attachZeroProofKey({ name, content = "", contentCommit = null } = {}) {
  const unlock = openSourceUnlockKey({ name, content, contentCommit });
  return {
    ...unlock,
    magic: MIRROR_ZERO_MAGIC,
    filingLabel: ZERO_PROOF_LABEL,
    privateWitness: false,
    note: "Zero-proof lock+key = file name + contentCommit. Same name as GitHub; chain seal proves truth.",
  };
}

/**
 * Dual-path read: availability (local/GitHub) and/or proven (sealed locs / filing).
 */
export async function readDualPaths({
  filename,
  pathMode = "dual",
  cwd = REPO_ROOT,
  githubFetch = null,
  codeBranch = "main",
  stateBranch = "bot-state",
  fetchCalldata = null,
  readUtf8FromCalldata = null,
} = {}) {
  const mode = DUAL_PATH_MODES.includes(String(pathMode || "").toLowerCase())
    ? String(pathMode).toLowerCase()
    : "dual";
  const clean = sanitizeMirrorPath(filename);
  if (!clean.ok) {
    return { ok: false, reason: clean.reason, neverInventHashes: true };
  }

  const filing = loadInjectFilingMap({ cwd });
  const avail = await resolveMirrorFile(clean.path, {
    cwd,
    githubFetch,
    codeBranch,
    stateBranch,
  });

  const availability = avail.ok
    ? {
        ok: true,
        path: "availability",
        source: avail.source,
        branch: avail.branch,
        local: avail.local,
        github: avail.github,
        bytes: avail.bytes,
        contentCommit: avail.sha,
        text: avail.text,
        preview: String(avail.text || "").slice(0, 900),
      }
    : {
        ok: false,
        path: "availability",
        reason: avail.reason || "not found on local/GitHub",
        tried: avail.tried || [],
      };

  const filingRow = filing.files?.[clean.path] || null;
  const zeroProof = attachZeroProofKey({
    name: clean.path,
    content: availability.ok ? availability.text : "",
    contentCommit: availability.contentCommit || filingRow?.contentCommit || null,
  });

  const leader = followLeaderForFile({
    filename: clean.path,
    availabilityCommit: availability.contentCommit || null,
    filing,
  });

  // Proven path: only sealed locs that hold matching body — never formula anchors as body.
  let proven = {
    ok: false,
    path: "proven",
    pending: true,
    reason: "no sealed matching inject locs yet",
    contentCommit: filingRow?.contentCommit || availability.contentCommit || null,
    sealed: leader.sealed,
    verified: leader.verified,
    locations: leader.locations,
    formulaAnchorsAreNotBody: true,
    classProofOnly: collectIdmLocations().map((l) => ({
      location: l.location,
      kind: l.kind,
      role: "formula-anchor",
      holdsLibraryBody: false,
    })),
  };

  if (leader.locations.length && typeof fetchCalldata === "function") {
    const parts = [];
    let allOk = true;
    for (const tx of leader.locations.slice(0, 24)) {
      try {
        const hex = await fetchCalldata(tx);
        let utf8 = "";
        if (typeof readUtf8FromCalldata === "function") {
          utf8 = String(readUtf8FromCalldata(hex)?.utf8 || "");
        } else {
          utf8 = hexToUtf8Loose(hex);
        }
        parts.push(utf8);
      } catch {
        allOk = false;
        break;
      }
    }
    if (allOk && parts.length) {
      const body = parts.join("");
      const commit = sha256Hex(body);
      const expect = filingRow?.contentCommit || availability.contentCommit;
      const match = expect ? commit === expect || body.includes(expect.slice(0, 16)) : false;
      proven = {
        ok: match,
        path: "proven",
        pending: !match,
        contentCommit: commit,
        bytes: Buffer.byteLength(body, "utf8"),
        text: match ? body : undefined,
        preview: body.slice(0, 900),
        sealed: leader.sealed,
        verified: match ? leader.locations.length : 0,
        locations: leader.locations,
        match,
        formulaAnchorsAreNotBody: true,
        reason: match
          ? "reconstructed from sealed Base UTF-8"
          : "pulled sealed locs but UTF-8 did not match filing contentCommit",
      };
    }
  } else if (filingRow?.contentCommit && availability.ok) {
    // Honest pre-seal: filing leader mirrors availability when commits match.
    proven = {
      ok: false,
      path: "proven",
      pending: true,
      contentCommit: filingRow.contentCommit,
      sealed: 0,
      verified: 0,
      locations: [],
      formulaAnchorsAreNotBody: true,
      classProofOnly: proven.classProofOnly,
      reason:
        "Filing holds contentCommit " +
        shortHex(filingRow.contentCommit, 12) +
        " — " +
        (filingRow.chunkCount || "?") +
        " spaced locs required. Not yet sealed on Base.",
      availabilityMatchesFiling:
        availability.contentCommit?.toLowerCase() === filingRow.contentCommit.toLowerCase(),
    };
  }

  const snark = availability.ok
    ? snarkCompressBlob(availability.text, {
        title: clean.path,
        filename: clean.path,
        locs: proven.ok ? proven.locations : [],
      })
    : null;

  const out = {
    ok: availability.ok || proven.ok,
    filename: clean.path,
    pathMode: mode,
    zeroProof,
    followLeader: leader,
    filingLabel: MIRROR_DUAL_LABEL,
    magic: MIRROR_DUAL_MAGIC,
    snark,
    neverInventHashes: true,
    formula: FORMULA_ID,
  };

  if (mode === "availability" || mode === "dual") out.availability = availability;
  if (mode === "proven" || mode === "dual") out.proven = proven;
  if (mode === "availability") out.ok = availability.ok;
  if (mode === "proven") out.ok = proven.ok;

  return out;
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

/** Extract `export function name(...) { ... }` including nested braces. */
export function extractExportFunctionSource(text, exportName) {
  const re = new RegExp(
    String.raw`export\s+(?:async\s+)?function\s+${exportName}\s*\(`,
    "m",
  );
  const m = re.exec(String(text || ""));
  if (!m) return null;
  let i = m.index + m[0].length - 1; // at '('
  // skip params
  let depth = 0;
  for (; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) {
        i++;
        break;
      }
    }
  }
  while (i < text.length && /\s/.test(text[i])) i++;
  if (text[i] !== "{") return null;
  const start = m.index;
  depth = 0;
  for (; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }
  return null;
}

/** Extract a top-level const/function declaration by name (same file deps). */
export function extractTopLevelDecl(text, name) {
  const src = String(text || "");
  // Top-level only: start of line (no indent) — avoids function-local consts.
  const patterns = [
    new RegExp(String.raw`^(?:export\s+)?const\s+${name}\s*=\s*`, "m"),
    new RegExp(String.raw`^(?:export\s+)?(?:async\s+)?function\s+${name}\s*\(`, "m"),
    new RegExp(String.raw`^function\s+${name}\s*\(`, "m"),
  ];
  for (const re of patterns) {
    const m = re.exec(src);
    if (!m) continue;
    // Reject if the line is indented (safety for odd editors)
    const lineStart = src.lastIndexOf("\n", m.index) + 1;
    if (/[ \t]/.test(src[lineStart])) continue;
    if (/function/.test(m[0])) {
      let i = m.index + m[0].length - 1;
      let depth = 0;
      for (; i < src.length; i++) {
        if (src[i] === "(") depth++;
        else if (src[i] === ")") {
          depth--;
          if (depth === 0) {
            i++;
            break;
          }
        }
      }
      while (i < src.length && /\s/.test(src[i])) i++;
      if (src[i] !== "{") continue;
      const start = m.index;
      depth = 0;
      for (; i < src.length; i++) {
        if (src[i] === "{") depth++;
        else if (src[i] === "}") {
          depth--;
          if (depth === 0) return src.slice(start, i + 1);
        }
      }
    } else {
      let i = m.index + m[0].length;
      let depth = 0;
      let inStr = null;
      for (; i < src.length; i++) {
        const ch = src[i];
        if (inStr) {
          if (ch === "\\") {
            i++;
            continue;
          }
          if (ch === inStr) inStr = null;
          continue;
        }
        if (ch === "'" || ch === '"' || ch === "`") {
          inStr = ch;
          continue;
        }
        if (ch === "{" || ch === "(" || ch === "[") depth++;
        else if (ch === "}" || ch === ")" || ch === "]") depth--;
        else if (ch === ";" && depth === 0) {
          return src.slice(m.index, i + 1);
        }
      }
    }
  }
  return null;
}

const JS_KEYWORDS = new Set([
  "true", "false", "null", "undefined", "return", "const", "let", "var",
  "if", "else", "for", "while", "function", "async", "await", "new",
  "typeof", "instanceof", "this", "in", "of", "switch", "case", "break",
  "continue", "default", "try", "catch", "throw", "finally", "class",
  "export", "import", "from", "as", "Number", "String", "Boolean", "Object",
  "Array", "Math", "JSON", "Buffer", "Date", "Error", "Map", "Set", "Promise",
]);

/**
 * Build a self-contained runnable prelude: same-file consts/helpers the export needs.
 * Never invents — only copies real source already on disk.
 */
export function buildBootRunnable(fileText, exportName) {
  const fnSrc = extractExportFunctionSource(fileText, exportName);
  if (!fnSrc) return null;
  const needed = new Set();
  const idRe = /\b([A-Za-z_][A-Za-z0-9_]*)\b/g;
  let m;
  while ((m = idRe.exec(fnSrc))) {
    const id = m[1];
    if (JS_KEYWORDS.has(id)) continue;
    if (id === exportName) continue;
    needed.add(id);
  }
  // also scan params so we don't treat them as deps
  const paramMatch = /\(([^)]*)\)/.exec(fnSrc);
  const params = new Set(
    String(paramMatch?.[1] || "")
      .split(",")
      .map((p) => p.trim().split("=")[0].trim().replace(/[{}[\]\s]/g, ""))
      .filter(Boolean),
  );

  const decls = [];
  const seen = new Set();
  const queue = [...needed].filter((id) => !params.has(id));

  while (queue.length) {
    const id = queue.shift();
    if (seen.has(id) || id === exportName) continue;
    seen.add(id);
    const decl = extractTopLevelDecl(fileText, id);
    if (!decl) continue;
    decls.push(decl.replace(/^export\s+/, ""));
    let dm;
    const dre = /\b([A-Za-z_][A-Za-z0-9_]*)\b/g;
    while ((dm = dre.exec(decl))) {
      const dep = dm[1];
      if (JS_KEYWORDS.has(dep) || seen.has(dep) || dep === id) continue;
      if (extractTopLevelDecl(fileText, dep)) queue.push(dep);
    }
  }

  const runnable =
    decls.join("\n\n") +
    "\n\n" +
    fnSrc.replace(/^export\s+/, "") +
    `\n; this.__fn = ${exportName};`;
  return {
    exportName,
    fnSrc,
    decls,
    runnable,
    contentCommit: sha256Hex(fnSrc),
    packetCommit: sha256Hex(runnable),
  };
}

function casPath(commit) {
  return join(CAS_DIR, shortHex(commit, 16) + ".json");
}

export function writeMirrorCasPacket(packet) {
  ensureDirs();
  const commit = packet.contentCommit || sha256Hex(packet.body || "");
  const row = {
    ...packet,
    contentCommit: commit,
    at: new Date().toISOString(),
    filingLabel: MIRROR_DUAL_LABEL,
    neverInventHashes: true,
  };
  writeFileSync(casPath(commit), JSON.stringify(row, null, 2));
  return row;
}

export function readMirrorCasPacket(contentCommit) {
  const p = casPath(contentCommit);
  return safeReadJson(p);
}

/**
 * Boot a mirrored code section from SNARK filing CAS (follow-leader pre-seal).
 * When Base seals matching UTF-8, the same contentCommit is the proven leader.
 */
export async function bootMirrorSection({
  sectionId = null,
  filename = null,
  exportName = null,
  cwd = REPO_ROOT,
  write = true,
} = {}) {
  const catalog =
    MIRROR_BOOT_SECTIONS.find((s) => s.id === sectionId) ||
    MIRROR_BOOT_SECTIONS.find(
      (s) =>
        (!filename || s.file === filename) &&
        (!exportName || s.exportName === exportName),
    ) ||
    (filename && exportName
      ? { id: "custom", file: filename, exportName, args: [], expect: null }
      : null) ||
    MIRROR_BOOT_SECTIONS[0];

  const filePath = join(cwd, catalog.file);
  if (!existsSync(filePath)) {
    return {
      ok: false,
      reason: "boot file missing: " + catalog.file,
      neverInventHashes: true,
    };
  }
  const sourceText = readFileSync(filePath, "utf8");
  const availCommit = sha256Hex(sourceText);
  const built = buildBootRunnable(sourceText, catalog.exportName);
  if (!built) {
    return {
      ok: false,
      reason: "export not found: " + catalog.exportName + " in " + catalog.file,
      neverInventHashes: true,
    };
  }

  const sectionCommit = built.contentCommit;
  const snark = snarkCompressBlob(built.runnable, {
    title: catalog.exportName,
    filename: catalog.file + "#" + catalog.exportName,
    locs: [],
  });
  const zeroProof = attachZeroProofKey({
    name: catalog.file + "#" + catalog.exportName,
    contentCommit: sectionCommit,
  });

  const packet = {
    id: catalog.id,
    file: catalog.file,
    exportName: catalog.exportName,
    body: built.fnSrc,
    runnable: built.runnable,
    deps: built.decls.length,
    contentCommit: sectionCommit,
    packetCommit: built.packetCommit,
    fileContentCommit: availCommit,
    snarkShort: snark.short,
    snarkCommit: snark.contentCommit,
    zeroProof,
    leader: "filing",
    note: "CAS runnable includes same-file deps. Filing leader until Base seal matches contentCommit.",
  };
  if (write) writeMirrorCasPacket(packet);

  const fromCas = write ? readMirrorCasPacket(sectionCommit) : packet;
  if (!fromCas?.runnable || sha256Hex(fromCas.body || "") !== sectionCommit) {
    return {
      ok: false,
      reason: "CAS reconstruct failed — contentCommit mismatch",
      neverInventHashes: true,
    };
  }

  const sandbox = {
    module: { exports: {} },
    exports: {},
    console,
    Buffer,
    createHash,
    normalize,
    sep,
    dirname,
    join,
  };
  sandbox.exports = sandbox.module.exports;
  let bootResult = null;
  let bootError = null;
  try {
    vm.runInNewContext(fromCas.runnable, sandbox, {
      timeout: 1500,
      filename: "mirror-boot:" + catalog.exportName,
    });
    const fn = sandbox.__fn;
    if (typeof fn !== "function") throw new Error("boot fn not a function");
    const args = catalog.args || [];
    bootResult = args.length === 1 ? fn(args[0]) : fn(...args);
  } catch (e) {
    bootError = e.message || String(e);
  }

  // Live import for truth compare (availability path).
  let liveResult = null;
  let liveError = null;
  try {
    const mod = await import(pathToFileURL(filePath).href + "?boot=" + sectionCommit.slice(0, 8));
    const liveFn = mod[catalog.exportName];
    if (typeof liveFn !== "function") throw new Error("live export missing");
    const args = catalog.args || [];
    liveResult = args.length === 1 ? liveFn(args[0]) : liveFn(...args);
  } catch (e) {
    liveError = e.message || String(e);
  }

  const expect = catalog.expect || null;
  let expectOk = true;
  if (expect && bootResult && typeof bootResult === "object") {
    for (const [k, v] of Object.entries(expect)) {
      if (bootResult[k] !== v) expectOk = false;
    }
  }

  const filing = loadInjectFilingMap({ cwd });
  const leader = followLeaderForFile({
    filename: catalog.file,
    availabilityCommit: availCommit,
    filing,
  });

  const ok = !bootError && expectOk;
  const unwrap = unwrapMachineShort(snark, {
    english: snark.english || "",
    machine: snark.machine || "",
  });

  const result = {
    ok,
    magic: MIRROR_BOOT_MAGIC,
    filingLabel: MIRROR_DUAL_LABEL,
    section: {
      id: catalog.id,
      file: catalog.file,
      exportName: catalog.exportName,
    },
    snark: {
      short: snark.short,
      contentCommit: snark.contentCommit,
      bytes: snark.bytes,
      localOnly: true,
      privateWitness: false,
      instantUnwrap: unwrap.instant === true,
    },
    zeroProof,
    followLeader: leader,
    cas: {
      contentCommit: sectionCommit,
      reconstructed: true,
      path: "filing",
    },
    boot: {
      ok: !bootError,
      error: bootError,
      result: summarizeResult(bootResult),
      expectOk,
    },
    live: {
      ok: !liveError,
      error: liveError,
      result: summarizeResult(liveResult),
    },
    matchLive:
      !bootError &&
      !liveError &&
      JSON.stringify(summarizeResult(bootResult)) ===
        JSON.stringify(summarizeResult(liveResult)),
    provenOnChain: leader.proven,
    note: leader.proven
      ? "Chain leads — boot CAS contentCommit should match sealed UTF-8."
      : "Booted from filing SNARK CAS (follow-leader). Base seal still pending — no invented hashes.",
    neverInventHashes: true,
    formula: FORMULA_ID,
  };

  if (write) appendDualLedger(result);
  return result;
}

function summarizeResult(v) {
  if (v == null) return v;
  if (typeof v !== "object") return v;
  const out = {};
  for (const [k, val] of Object.entries(v)) {
    if (typeof val === "string" || typeof val === "number" || typeof val === "boolean") {
      out[k] = val;
    } else if (val == null) out[k] = val;
    else out[k] = clip(JSON.stringify(val), 80);
  }
  return out;
}

export function appendDualLedger(event) {
  ensureDirs();
  const prev = safeReadJson(LEDGER_PATH) || {
    id: MIRROR_DUAL_ID,
    filingLabel: MIRROR_DUAL_LABEL,
    events: [],
    neverInventHashes: true,
  };
  prev.events = Array.isArray(prev.events) ? prev.events : [];
  prev.events.push({
    at: new Date().toISOString(),
    kind: event.magic || MIRROR_DUAL_MAGIC,
    section: event.section || null,
    filename: event.filename || event.section?.file || null,
    pathMode: event.pathMode || null,
    ok: event.ok,
    zeroProofKey: event.zeroProof?.key || null,
    contentCommit: event.snark?.contentCommit || event.cas?.contentCommit || null,
    provenOnChain: event.provenOnChain ?? event.followLeader?.proven ?? false,
    leader: event.followLeader?.leader || null,
    bootOk: event.boot?.ok ?? null,
    note: clip(event.note || "", 200),
  });
  if (prev.events.length > 200) prev.events = prev.events.slice(-200);
  prev.at = new Date().toISOString();
  prev.formula = FORMULA_ID;
  writeFileSync(LEDGER_PATH, JSON.stringify(prev, null, 2));

  const strand = {
    strandId: "mirror-dual",
    sparse: true,
    source: "mirror-dual",
    filingLabel: MIRROR_DUAL_LABEL,
    learn:
      "Dual-path reader: availability=local/GitHub same name; proven=sealed Base UTF-8; " +
      "zero-proof key=name+contentCommit; follow-leader filing until seal; boot from SNARK CAS. " +
      "Formula anchors ≠ body.",
    formula: FORMULA_ID,
    lastBoot: event.section || null,
    locations: MAINFRAME_ANCHORS.known.map((a) => ({
      id: a.id,
      location: a.tx,
      kind: a.kind,
      role: "formula-anchor",
      holdsLibraryBody: false,
    })),
  };
  writeFileSync(STRAND_PATH, JSON.stringify(strand, null, 2));
  return prev;
}

export function parseMirrorDualCommand(raw) {
  const src = String(raw || "").trim();
  const low = src.toLowerCase();
  if (low === "/vita tree" || low.startsWith("/vita tree ")) {
    return {
      action: "tree",
      prefix: src.slice("/vita tree".length).trim() || "",
    };
  }
  if (low === "/vita dual" || low.startsWith("/vita dual ")) {
    return {
      action: "dual",
      pathMode: "dual",
      filename: src.slice("/vita dual".length).trim() || null,
    };
  }
  if (low.startsWith("/vita path ")) {
    const rest = src.slice("/vita path ".length).trim();
    const m = /^(availability|proven|dual|avail)\s+(.+)$/i.exec(rest);
    if (m) {
      let mode = m[1].toLowerCase();
      if (mode === "avail") mode = "availability";
      return { action: "dual", pathMode: mode, filename: m[2].trim() };
    }
    return { action: "dual", pathMode: "dual", filename: rest || null };
  }
  if (low === "/vita boot" || low.startsWith("/vita boot ")) {
    const rest = src.slice("/vita boot".length).trim();
    if (!rest) return { action: "boot", sectionId: "hitch-gate" };
    const hit = MIRROR_BOOT_SECTIONS.find(
      (s) => s.id === rest || s.exportName === rest || s.file === rest,
    );
    if (hit) return { action: "boot", sectionId: hit.id, filename: hit.file };
    const parts = rest.split(/\s+/);
    return {
      action: "boot",
      filename: parts[0],
      exportName: parts[1] || null,
      sectionId: null,
    };
  }
  if (low.startsWith("/vita zero ")) {
    return { action: "zero", filename: src.slice("/vita zero ".length).trim() };
  }
  if (low === "/vita zero") {
    return { action: "zero", filename: null };
  }
  return { action: null };
}

export function formatDualTreeCard(tree) {
  const lines = [
    MIRROR_DUAL_MAGIC + " GitHub duplicate tree",
    "prefix=" + (tree.prefix || ".") + "  files=" + (tree.fileCount || 0) + "  dirs=" + (tree.dirCount || 0),
    "Same path names as CODE lane. Zero-proof = name+contentCommit.",
    "",
  ];
  for (const e of (tree.entries || []).slice(0, 60)) {
    if (e.type === "dir") {
      lines.push("📁 " + e.path + "/");
    } else {
      const z = e.zeroProof?.key ? "  🔑" + shortHex(e.contentCommit, 8) : "";
      lines.push("📄 " + e.path + "  " + (e.bytes ?? "?") + "B" + z);
    }
  }
  if ((tree.entries || []).length > 60) lines.push("… +" + (tree.entries.length - 60) + " more");
  lines.push("");
  lines.push("Read dual: /vita dual PATH · /vita path proven PATH · /vita boot");
  return lines.join("\n");
}

export function formatDualReadCard(result) {
  const lines = [
    MIRROR_DUAL_MAGIC + " " + (result.filename || ""),
    "pathMode=" + result.pathMode,
    MIRROR_ZERO_MAGIC + " " + (result.zeroProof?.key || "—") + "  privateKey=false",
    "leader=" +
      (result.followLeader?.leader || "?") +
      "  follower=" +
      (result.followLeader?.follower || "?") +
      "  provenOnChain=" +
      (result.followLeader?.proven ? "YES" : "no"),
    clip(result.followLeader?.note || "", 160),
  ];
  if (result.availability) {
    lines.push("");
    lines.push(
      "AVAIL  ok=" +
        result.availability.ok +
        "  source=" +
        (result.availability.source || "—") +
        "  sha=" +
        shortHex(result.availability.contentCommit, 12),
    );
    if (result.availability.preview) {
      lines.push(clip(result.availability.preview, 280));
    }
  }
  if (result.proven) {
    lines.push("");
    lines.push(
      "PROVEN ok=" +
        result.proven.ok +
        "  pending=" +
        (result.proven.pending ? "yes" : "no") +
        "  sealed=" +
        (result.proven.sealed || 0) +
        "  verified=" +
        (result.proven.verified || 0),
    );
    lines.push(clip(result.proven.reason || "", 200));
    if (result.proven.formulaAnchorsAreNotBody) {
      lines.push("Formula anchors = class proof only — not file body.");
    }
  }
  if (result.snark) {
    lines.push("");
    lines.push("SNARK " + result.snark.short);
  }
  lines.push("neverInventHashes=true");
  return lines.join("\n");
}

export function formatBootCard(result) {
  const lines = [
    MIRROR_BOOT_MAGIC + " " + (result.section?.exportName || ""),
    "file=" + (result.section?.file || ""),
    "boot=" + (result.boot?.ok ? "YES" : "FAIL") + "  matchLive=" + (result.matchLive ? "YES" : "no"),
    MIRROR_ZERO_MAGIC + " " + (result.zeroProof?.key || "—"),
    "cas=" + shortHex(result.cas?.contentCommit, 12) + "  leader=" + (result.followLeader?.leader || "?"),
    "provenOnChain=" + (result.provenOnChain ? "YES" : "no — filing SNARK CAS"),
    "SNARK " + (result.snark?.short || "—"),
    clip(result.note || "", 200),
  ];
  if (result.boot?.result) {
    lines.push("result " + clip(JSON.stringify(result.boot.result), 160));
  }
  if (result.boot?.error) lines.push("error " + result.boot.error);
  lines.push("neverInventHashes=true");
  return lines.join("\n");
}

export function formatZeroCard(result) {
  const lines = [
    MIRROR_ZERO_MAGIC + " zero-proof lock+key",
    "file=" + (result.filename || "—"),
    "key=" + (result.zeroProof?.key || "—"),
    "contentCommit=" + shortHex(result.zeroProof?.contentCommit, 16),
    "privateKey=false  openSource=true",
    "Same name as GitHub path; chain seal of matching UTF-8 is proven truth.",
    "neverInventHashes=true",
  ];
  return lines.join("\n");
}

export function buildDualKeyboard({ filename = null } = {}) {
  const rows = [];
  rows.push([
    { text: "🌳 Tree", callback_data: "/vita tree vita" },
    { text: "🪞 Dual", callback_data: telegramCb("/vita dual " + (filename || "vita/mainframe.js")) },
  ]);
  rows.push([
    { text: "Boot hitch", callback_data: "/vita boot hitch-gate" },
    { text: "Boot unlock", callback_data: "/vita boot open-unlock" },
  ]);
  if (filename) {
    rows.push([
      { text: "Avail", callback_data: telegramCb("/vita path availability " + filename) },
      { text: "Proven", callback_data: telegramCb("/vita path proven " + filename) },
      { text: "Zero🔑", callback_data: telegramCb("/vita zero " + filename) },
    ]);
  }
  rows.push([{ text: "🏠 HOME", callback_data: "/home" }]);
  return { inline_keyboard: rows };
}

function telegramCb(cmd) {
  const s = String(cmd || "");
  return s.length <= CALLBACK_DATA_MAX ? s : s.slice(0, CALLBACK_DATA_MAX);
}

/**
 * Handle tree | dual | path | boot | zero.
 */
export async function handleMirrorDualAction({
  action,
  filename = null,
  pathMode = "dual",
  prefix = "",
  sectionId = null,
  exportName = null,
  cwd = REPO_ROOT,
  githubFetch = null,
  codeBranch = "main",
  stateBranch = "bot-state",
  fetchCalldata = null,
  readUtf8FromCalldata = null,
  write = true,
} = {}) {
  if (action === "tree") {
    const tree = walkMirrorTree({ cwd, prefix: prefix || filename || "" });
    const reply = formatDualTreeCard(tree);
    return {
      ok: tree.ok,
      action: "tree",
      reply,
      html: "<pre>" + esc(reply) + "</pre>",
      tree,
      keyboard: buildDualKeyboard({}),
      neverInventHashes: true,
    };
  }

  if (action === "zero") {
    const name = filename || "vita/mainframe.js";
    const resolved = await resolveMirrorFile(name, { cwd, githubFetch, codeBranch, stateBranch });
    if (!resolved.ok) {
      const reply = "Zero-proof — file not found: " + name;
      return { ok: false, action: "zero", reply, filename: name, neverInventHashes: true };
    }
    const zeroProof = attachZeroProofKey({
      name: resolved.filename,
      content: resolved.text,
      contentCommit: resolved.sha,
    });
    const result = { filename: resolved.filename, zeroProof };
    const reply = formatZeroCard(result);
    if (write) {
      appendDualLedger({
        ok: true,
        magic: MIRROR_ZERO_MAGIC,
        filename: resolved.filename,
        zeroProof,
        note: "zero-proof key attached",
      });
    }
    return {
      ok: true,
      action: "zero",
      reply,
      html: "<pre>" + esc(reply) + "</pre>",
      filename: resolved.filename,
      zeroProof,
      keyboard: buildDualKeyboard({ filename: resolved.filename }),
      neverInventHashes: true,
    };
  }

  if (action === "boot") {
    const result = await bootMirrorSection({
      sectionId,
      filename,
      exportName,
      cwd,
      write,
    });
    const reply = formatBootCard(result);
    return {
      ok: result.ok,
      action: "boot",
      reply,
      html: "<pre>" + esc(reply) + "</pre>",
      result,
      snark: result.snark,
      zeroProof: result.zeroProof,
      keyboard: buildDualKeyboard({ filename: result.section?.file }),
      neverInventHashes: true,
    };
  }

  if (action === "dual" || action === "path") {
    const name = filename || "vita/mainframe.js";
    const result = await readDualPaths({
      filename: name,
      pathMode: pathMode || "dual",
      cwd,
      githubFetch,
      codeBranch,
      stateBranch,
      fetchCalldata,
      readUtf8FromCalldata,
    });
    const reply = formatDualReadCard(result);
    if (write) {
      appendDualLedger({
        ...result,
        magic: MIRROR_DUAL_MAGIC,
        note: result.followLeader?.note,
      });
    }
    return {
      ok: result.ok,
      action: "dual",
      reply,
      html: "<pre>" + esc(reply) + "</pre>",
      filename: result.filename,
      pathMode: result.pathMode,
      availability: result.availability
        ? { ...result.availability, text: undefined }
        : undefined,
      proven: result.proven
        ? { ...result.proven, text: undefined }
        : undefined,
      preview: result.availability?.preview || result.proven?.preview || null,
      text: result.pathMode === "proven"
        ? result.proven?.text
        : result.availability?.text,
      snark: result.snark,
      zeroProof: result.zeroProof,
      followLeader: result.followLeader,
      locations: (result.proven?.locations || []).map((tx) => ({
        location: tx,
        kind: "vita",
        role: "sealed-inject",
        basescan: (MAINFRAME_ANCHORS.basescanTx || "https://basescan.org/tx/") + tx,
      })),
      keyboard: buildDualKeyboard({ filename: result.filename }),
      neverInventHashes: true,
    };
  }

  return {
    ok: false,
    action,
    reply: "Unknown dual action",
    neverInventHashes: true,
  };
}
