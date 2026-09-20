/**
 * VITA GitHub-mirror chain — click-through file read + SNARK unwrap + IDM locs.
 *
 * GitHub *is* the availability ledger (repo/branch/blob SHA ≈ chain/lane/tx).
 * Base is settlement: sealed leftover hitch + /prove. Never invent tx hashes.
 *
 * `/vita read` must work without Anthropic: local disk first (Railway checkout),
 * then CODE branch (main), then STATE branch (bot-state). JSON-only GitHub
 * decode was why vault-unlock.js "was not found".
 *
 * Session keys act like Railway env vars: permanent, TTL, or destroy-on-unwrap.
 * Each read mints a fresh destroyable key bound to the file commit. Anyone with
 * the key can unwrap the SNARK-short and see proof + IDM chat of batched locs.
 *
 * Mother brain / leftover hitch formula untouched.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { FORMULA_ID, MAINFRAME_ANCHORS } from "./mainframe.js";
import { packMachineShort, unwrapMachineShort } from "./vita-dir.js";
import { feedFlowAnchorLocations } from "./feed-flow.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");

export const MIRROR_CHAIN_ID = "vita-mirror-chain-v1";
export const MIRROR_MAGIC = "§VITAMIRROR§";
export const MIRROR_SNARK_MAGIC = "§VITASNARK§";
export const MIRROR_KEY_MAGIC = "§VITAKEY§";
export const MIRROR_LABEL = "MIRROR_CHAIN";
export const MIRROR_SESSION_TTL_MS = 15 * 60 * 1000;
export const CALLBACK_DATA_MAX = 64;

/** GitHub infrastructure → chain analog (availability layer). */
export const GITHUB_AS_CHAIN = Object.freeze({
  repo: "chain / network",
  branch: "lane (CODE=main genesis, STATE=bot-state live book)",
  commit: "block",
  tree: "Merkle directory",
  blobSha: "content-addressed object (not a Base tx)",
  contentsApi: "RPC (read/write with SHA)",
  ref: "HEAD pointer",
  actions: "plugins / agentic jobs",
  secrets: "Railway-style env keys (permanent | ttl | destroyable)",
  settlement: "Base leftover hitch + /prove — never invent hashes",
});

/** Out-of-box connected plugins (name-gated, like GitHub Apps). */
export const MIRROR_PLUGINS = Object.freeze([
  {
    id: "telegram",
    name: "Telegram click-through",
    when: "inline keyboard /vita read · unwrap · proof · Basescan IDM",
  },
  {
    id: "github-contents",
    name: "GitHub Contents RPC",
    when: "code lane + state lane blob SHA",
  },
  {
    id: "basescan-idm",
    name: "Basescan Input Data → UTF-8",
    when: "on-chain IDM chat of batched sealed locs",
  },
  {
    id: "snark-unwrap",
    name: "SNARK-short unwrap",
    when: "open-source key reveals English + machine + loc batch",
  },
  {
    id: "railway-keys",
    name: "Railway-style session keys",
    when: "permanent · ttl · destroy-on-unwrap (new set each session)",
  },
  {
    id: "vita-dir",
    name: "VITA:\\ DOS directory",
    when: "/vitafeed dir · unlock by file name",
  },
]);

/** Files Telegram advertised that must resolve. lane=code|state|both. */
export const MIRROR_CATALOG = Object.freeze([
  { name: "agent.js", lane: "code", kind: "js", role: "live V3 trader" },
  { name: "vault-loader.js", lane: "code", kind: "js", role: "boot keys from Base locs" },
  { name: "vault-unlock.js", lane: "code", kind: "js", role: "Telegram unlock TTL / safe mode" },
  { name: "keystore.js", lane: "code", kind: "js", role: "double-encrypt personal keys" },
  { name: "memory-engine.js", lane: "code", kind: "js", role: "cliff notes + session summary" },
  { name: "vita-memory.js", lane: "code", kind: "js", role: "§TOKEN§ compress / registry" },
  { name: "log-formatter.js", lane: "code", kind: "js", role: "pulse formatter" },
  { name: "encryptkey.js", lane: "code", kind: "js", role: "AES-GCM encrypt helper" },
  { name: "engine-board.js", lane: "code", kind: "js", role: "wave / surfer board" },
  { name: "peak-ride.js", lane: "code", kind: "js", role: "peak ride gate" },
  { name: "piggy-bank.js", lane: "code", kind: "js", role: "piggy never sells for Grok" },
  { name: "board-control.js", lane: "code", kind: "js", role: "control board routes" },
  { name: "vita-parse.js", lane: "code", kind: "js", role: "§TOKEN§ parser" },
  { name: "vita-locations.js", lane: "code", kind: "js", role: "append-only loc depository" },
  { name: "vita-router.js", lane: "code", kind: "js", role: "leftover hitch mode" },
  { name: "xmem.js", lane: "code", kind: "js", role: "XMEM overlay" },
  { name: "vita/mainframe.js", lane: "code", kind: "js", role: "HTML infect + formula" },
  { name: "vita/mirror-chain.js", lane: "code", kind: "js", role: "GitHub-as-chain read/unwrap" },
  { name: "vita/anchors.json", lane: "code", kind: "json", role: "hardcoded Base txs" },
  { name: "vita/FILING.md", lane: "code", kind: "md", role: "filing map" },
  { name: "public/vita.html", lane: "code", kind: "html", role: "infected HTML memory" },
  { name: "vita-registry.json", lane: "state", kind: "json", role: "session memory index (bot-state)" },
  { name: "memory-registry.json", lane: "state", kind: "json", role: "IKN memory index" },
  { name: "ledger.json", lane: "state", kind: "json", role: "append-only trade ledger" },
  { name: "positions.json", lane: "both", kind: "json", role: "open book snapshot" },
  { name: "tokens.json", lane: "both", kind: "json", role: "injector catalog" },
  { name: "history.json", lane: "state", kind: "json", role: "wave candles" },
  { name: "XMEM.md", lane: "code", kind: "md", role: "XMEM spec" },
  { name: "BOARD.md", lane: "code", kind: "md", role: "control board notes" },
]);

const DENY_RE = /(^|[\\/])(\.env|\.git|node_modules|\.pem$|id_rsa|secrets?)/i;

/** In-memory Railway-style keys. New process = new session (matches requirement). */
const sessions = new Map();

function sha256Hex(text) {
  return createHash("sha256").update(String(text || ""), "utf8").digest("hex");
}

function shortHex(hex, n = 8) {
  return String(hex || "").replace(/^0x/i, "").toLowerCase().slice(0, n);
}

export function isTxHash(h) {
  return /^0x[0-9a-fA-F]{64}$/.test(String(h || ""));
}

function clip(s, n = 140) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length <= n ? t : t.slice(0, n - 1) + "…";
}

function utf8Bytes(s) {
  return Buffer.byteLength(String(s || ""), "utf8");
}

export function resetMirrorSessions() {
  sessions.clear();
}

export function sanitizeMirrorPath(name) {
  const raw = String(name || "").trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!raw) return { ok: false, reason: "empty filename" };
  if (DENY_RE.test(raw)) return { ok: false, reason: "denied path" };
  if (raw.includes("\0")) return { ok: false, reason: "denied path" };
  const norm = normalize(raw);
  if (norm.startsWith("..") || norm.split(sep).includes("..")) {
    return { ok: false, reason: "path escape blocked" };
  }
  if (norm.length > 180) return { ok: false, reason: "filename too long" };
  return { ok: true, path: norm.replace(/\\/g, "/") };
}

export function catalogEntry(name) {
  const want = String(name || "").replace(/\\/g, "/").toLowerCase();
  return MIRROR_CATALOG.find((e) => e.name.toLowerCase() === want) || null;
}

export function classifyFileLane(name) {
  return catalogEntry(name)?.lane || (/\.json$/i.test(String(name || "")) ? "state" : "code");
}

export function allowedMirrorFiles() {
  return MIRROR_CATALOG.map((e) => e.name);
}

export function githubBlobHtmlUrl({ repo, filename, branch } = {}) {
  const r = String(repo || "").trim();
  const file = String(filename || "").replace(/^\/+/, "");
  const ref = String(branch || "").trim() || "main";
  if (!r || !file) return null;
  return `https://github.com/${r}/blob/${encodeURIComponent(ref)}/${file}`;
}

function sessionBucket(chatId = "default") {
  const id = String(chatId || "default");
  if (!sessions.has(id)) {
    sessions.set(id, { chatId: id, keys: [], lastFile: null, lastKeyId: null });
  }
  return sessions.get(id);
}

export function expireSessionKeys(chatId = "default", now = Date.now()) {
  const bucket = sessionBucket(chatId);
  const n = Number(now) || Date.now();
  bucket.keys = bucket.keys.filter((k) => {
    if (k.destroyed) return false;
    if (k.kind === "ttl" && k.expiresAt && n >= k.expiresAt) {
      k.destroyed = true;
      k.destroyReason = "ttl";
      return false;
    }
    return true;
  });
  return bucket.keys.slice();
}

/**
 * Mint a Railway-style key. Open-source content commitment — never a wallet secret.
 */
export function mintSessionKey({
  kind = "destroyable",
  ttlMs = MIRROR_SESSION_TTL_MS,
  chatId = "default",
  filename = null,
  contentCommit = null,
  now = Date.now(),
} = {}) {
  const k = String(kind || "destroyable").toLowerCase();
  const type = k === "permanent" || k === "ttl" || k === "destroyable" ? k : "destroyable";
  const n = Number(now) || Date.now();
  const commit = contentCommit || sha256Hex("VITASESS|" + type + "|" + n + "|" + (filename || ""));
  const short = shortHex(commit, 12);
  const key = "VITASESS." + type + "." + short;
  const row = {
    id: short,
    key,
    kind: type,
    openSource: true,
    privateKey: false,
    filename: filename || null,
    contentCommit: commit,
    mintedAt: n,
    expiresAt: type === "ttl" ? n + (Number(ttlMs) || MIRROR_SESSION_TTL_MS) : null,
    uses: 0,
    destroyed: false,
    railwayLike: true,
    note:
      type === "permanent"
        ? "Lives until /vita keys destroy"
        : type === "ttl"
          ? "Expires like a timed Railway variable"
          : "Destroy-on-unwrap — one shot, then gone",
  };
  const bucket = sessionBucket(chatId);
  bucket.keys.push(row);
  bucket.lastKeyId = row.id;
  if (filename) bucket.lastFile = filename;
  return row;
}

export function mintSessionKeySet(opts = {}) {
  const chatId = opts.chatId || "default";
  const filename = opts.filename || null;
  const contentCommit = opts.contentCommit || null;
  const now = opts.now || Date.now();
  return {
    permanent: mintSessionKey({ kind: "permanent", chatId, filename, contentCommit, now }),
    ttl: mintSessionKey({ kind: "ttl", chatId, filename, contentCommit, now: now + 1 }),
    destroyable: mintSessionKey({ kind: "destroyable", chatId, filename, contentCommit, now: now + 2 }),
  };
}

function findKey(chatId, selector) {
  const bucket = sessionBucket(chatId);
  const s = String(selector || "").trim();
  if (!s) {
    return bucket.keys.find((k) => k.id === bucket.lastKeyId && !k.destroyed) || null;
  }
  const lower = s.toLowerCase();
  return (
    bucket.keys.find((k) => !k.destroyed && k.key.toLowerCase() === lower) ||
    bucket.keys.find((k) => !k.destroyed && k.id.toLowerCase() === lower) ||
    null
  );
}

export function destroySessionKey(chatId, selector) {
  const row = findKey(chatId, selector);
  if (!row) return { ok: false, reason: "key not found or already destroyed" };
  row.destroyed = true;
  row.destroyReason = "manual";
  return { ok: true, key: row.key, kind: row.kind };
}

export function listSessionKeys(chatId = "default", now = Date.now()) {
  return expireSessionKeys(chatId, now).map((k) => ({
    key: k.key,
    kind: k.kind,
    filename: k.filename,
    expiresAt: k.expiresAt,
    uses: k.uses,
    destroyed: k.destroyed,
    privateKey: false,
  }));
}

export function extractSealedTxHashes(value, acc = [], depth = 0) {
  if (depth > 8 || acc.length > 24) return acc;
  if (typeof value === "string") {
    if (isTxHash(value) && !acc.includes(value.toLowerCase())) acc.push(value.toLowerCase());
    return acc;
  }
  if (Array.isArray(value)) {
    for (const v of value) extractSealedTxHashes(v, acc, depth + 1);
    return acc;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (/tx|hash|location|loc/i.test(k)) extractSealedTxHashes(v, acc, depth + 1);
      else if (typeof v === "object") extractSealedTxHashes(v, acc, depth + 1);
    }
  }
  return acc;
}

export function collectIdmLocations(extra = []) {
  const out = [];
  const seen = new Set();
  const push = (row) => {
    const tx = String(row?.location || row?.tx || "").toLowerCase();
    if (!isTxHash(tx) || seen.has(tx)) return;
    seen.add(tx);
    out.push({
      id: row.id || "sealed",
      location: tx,
      kind: row.kind || "vita",
      label: row.label || "sealed loc",
      basescan: (MAINFRAME_ANCHORS.basescanTx || "https://basescan.org/tx/") + tx,
      idmChat: "Basescan → Input Data → View as UTF-8",
    });
  };
  for (const a of feedFlowAnchorLocations()) push(a);
  for (const x of extra || []) {
    if (typeof x === "string") push({ location: x, id: "sealed", kind: "vita" });
    else push(x);
  }
  return out;
}

export function snarkCompressBlob(text, { title = "file", filename = null, locs = [] } = {}) {
  const body = String(text ?? "");
  const commit = sha256Hex(body);
  const english =
    "VITA SNARK of " +
    (filename || title) +
    ": " +
    utf8Bytes(body) +
    " UTF-8 bytes, sha256 " +
    shortHex(commit, 12) +
    "…. Batched IDM locs unwrap with the session key.";
  const machine =
    "SNARK kind=file name=" +
    clip(filename || title, 40) +
    " bytes=" +
    utf8Bytes(body) +
    " sha=" +
    shortHex(commit, 8);
  const packed = packMachineShort({
    english,
    machine,
    locs: (locs || []).map((l) => l.location || l).filter(isTxHash),
    trueName: filename || title,
  });
  const loc8 = packed.loc8 || [];
  const short =
    MIRROR_SNARK_MAGIC +
    shortHex(commit, 12) +
    "|T=" +
    clip(filename || title, 32) +
    "|B=" +
    utf8Bytes(body) +
    (loc8.length ? "|L=" + loc8.join(",") : "") +
    "|M=" +
    clip(machine, 40);
  return {
    ...packed,
    short,
    contentCommit: commit,
    bytes: utf8Bytes(body),
    filename: filename || title,
    zkClass: "vita-content-commitment-v1",
    snarkReady: true,
    instantUnwrap: true,
    privateWitness: false,
    neverInventHashes: true,
  };
}

export function snarkCompressBatch(files = [], { title = "MIRROR-BATCH" } = {}) {
  const rows = (files || []).map((f) => {
    const body = String(f.text ?? f.body ?? "");
    const hash = f.contentCommit || sha256Hex(body);
    return {
      name: f.name || f.filename || "file",
      hash,
      bytes: utf8Bytes(body),
      exists: f.exists !== false,
    };
  });
  const totalBytes = rows.reduce((n, r) => n + r.bytes, 0);
  let layer = rows.map((r) => r.hash).sort();
  if (!layer.length) layer = [sha256Hex("VITA-MIRROR-EMPTY")];
  while (layer.length > 1) {
    const next = [];
    for (let i = 0; i < layer.length; i += 2) {
      const a = layer[i];
      const b = layer[i + 1] ?? a;
      next.push(sha256Hex(a + b));
    }
    layer = next;
  }
  const root = layer[0];
  const english =
    "Batched SNARK \"" +
    title +
    "\": " +
    rows.length +
    " files, " +
    totalBytes +
    " bytes, merkle " +
    shortHex(root, 12) +
    "…. Existence is local/GitHub SHA — Base locs only when sealed.";
  const machine =
    "SNARK kind=batch files=" + rows.length + " bytes=" + totalBytes + " root=" + shortHex(root, 8);
  const packed = packMachineShort({
    english,
    machine,
    locs: collectIdmLocations().map((l) => l.location),
    trueName: title,
  });
  return {
    ...packed,
    root,
    files: rows,
    bytes: totalBytes,
    fileCount: rows.length,
    snarkReady: true,
    instantUnwrap: true,
    neverInventHashes: true,
  };
}

export function resolveLocalMirrorFile(filename, { cwd = REPO_ROOT } = {}) {
  const clean = sanitizeMirrorPath(filename);
  if (!clean.ok) return { ok: false, reason: clean.reason, filename };
  const roots = [cwd, REPO_ROOT];
  const tries = [];
  for (const root of roots) {
    tries.push(join(root, clean.path));
    if (!clean.path.includes("/")) {
      tries.push(join(root, "vita", clean.path));
      tries.push(join(root, "public", clean.path));
    }
  }
  const seen = new Set();
  for (const p of tries) {
    const key = normalize(p);
    if (seen.has(key)) continue;
    seen.add(key);
    if (!existsSync(p)) continue;
    try {
      const st = statSync(p);
      if (!st.isFile()) continue;
      if (st.size > 2_000_000) {
        return { ok: false, reason: "file too large to preview", filename: clean.path, path: p };
      }
      const text = readFileSync(p, "utf8");
      return {
        ok: true,
        filename: clean.path,
        path: p,
        text,
        bytes: st.size,
        source: "local",
        sha: sha256Hex(text),
      };
    } catch (e) {
      return { ok: false, reason: e.message || "local read failed", filename: clean.path };
    }
  }
  return { ok: false, reason: "not on local disk", filename: clean.path };
}

async function fetchLane(githubFetch, filename, branch) {
  if (typeof githubFetch !== "function") return null;
  try {
    const hit = await githubFetch(filename, branch);
    if (!hit) return null;
    const text = hit.text != null ? hit.text : typeof hit.content === "string" ? hit.content : null;
    if (text == null || text === "") return { ...hit, text: null, branch, miss: true };
    return { ...hit, text, branch, miss: false };
  } catch {
    return { text: null, status: 0, branch, miss: true };
  }
}

export async function resolveMirrorFile(filename, {
  cwd = REPO_ROOT,
  githubFetch = null,
  codeBranch = "main",
  stateBranch = "bot-state",
} = {}) {
  const clean = sanitizeMirrorPath(filename);
  if (!clean.ok) {
    return { ok: false, reason: clean.reason, filename, neverInventHashes: true };
  }
  const lane = classifyFileLane(clean.path);
  const local = resolveLocalMirrorFile(clean.path, { cwd });
  if (local.ok) {
    return {
      ok: true,
      filename: clean.path,
      text: local.text,
      bytes: local.bytes || utf8Bytes(local.text),
      sha: local.sha,
      source: local.source,
      branch: "local",
      lane,
      local: true,
      github: false,
      githubSha: null,
      githubBranch: null,
      tried: ["local"],
      catalog: catalogEntry(clean.path),
      neverInventHashes: true,
    };
  }

  const tried = [];
  let remote = null;

  const tryBranch = async (branch, label) => {
    tried.push(label + ":" + branch);
    const hit = await fetchLane(githubFetch, clean.path, branch);
    if (hit && !hit.miss && hit.text != null) {
      remote = {
        ok: true,
        filename: clean.path,
        text: hit.text,
        sha: hit.sha || sha256Hex(hit.text),
        status: hit.status || 200,
        source: "github:" + label,
        branch,
      };
      return true;
    }
    if (hit?.status) tried[tried.length - 1] += "@" + hit.status;
    return false;
  };

  if (lane === "code" || lane === "both") await tryBranch(codeBranch, "CODE");
  if (!remote && (lane === "state" || lane === "both")) await tryBranch(stateBranch, "STATE");
  if (!remote && lane === "code") await tryBranch(stateBranch, "STATE");
  if (!remote && lane === "state") await tryBranch(codeBranch, "CODE");

  const winner = local.ok ? local : remote;
  if (!winner || !winner.ok) {
    return {
      ok: false,
      reason: "File not found: " + clean.path,
      filename: clean.path,
      lane,
      local: local.ok,
      github: Boolean(remote?.ok),
      tried,
      hint:
        lane === "state"
          ? "State files live on GitHub branch bot-state (Contents API). Code files live on main + Railway disk."
          : "Code files live on local Railway checkout and GitHub main. State JSON is bot-state.",
      neverInventHashes: true,
    };
  }

  return {
    ok: true,
    filename: clean.path,
    text: winner.text,
    bytes: winner.bytes || utf8Bytes(winner.text),
    sha: winner.sha,
    source: winner.source,
    branch: winner.branch || (local.ok ? "local" : null),
    lane,
    local: local.ok,
    github: Boolean(remote?.ok),
    githubSha: remote?.sha || null,
    githubBranch: remote?.branch || null,
    tried,
    catalog: catalogEntry(clean.path),
    neverInventHashes: true,
  };
}

function previewText(text, filename) {
  const body = String(text || "");
  if (/\.json$/i.test(filename || "")) {
    try {
      const parsed = JSON.parse(body);
      const keys = Object.keys(parsed).slice(0, 12);
      return "json keys: " + keys.join(", ") + (Object.keys(parsed).length > 12 ? ", …" : "");
    } catch {
      /* fall through */
    }
  }
  const lines = body.split(/\r?\n/).slice(0, 18);
  return lines.join("\n").slice(0, 900);
}

function parseExportsHint(text) {
  const names = [];
  const re = /export\s+(?:async\s+)?function\s+(\w+)|export\s+\{([^}]+)\}|exports\.(\w+)/g;
  let m;
  while ((m = re.exec(String(text || ""))) && names.length < 8) {
    if (m[1]) names.push(m[1]);
    else if (m[3]) names.push(m[3]);
    else if (m[2]) {
      for (const part of m[2].split(",")) {
        const n = part.replace(/as\s+\w+/g, "").trim();
        if (n) names.push(n.split(/\s+/).pop());
      }
    }
  }
  return names.slice(0, 8);
}

export function parseVitaMirrorCommand(raw) {
  const src = String(raw || "").trim();
  const low = src.toLowerCase();
  if (low === "/vita files" || low === "/vita ls" || low === "/vita dir") {
    return { action: "files" };
  }
  if (low === "/vita chain" || low === "/vita mirror" || low === "/vita github") {
    return { action: "chain" };
  }
  if (low === "/vita plugins" || low === "/vita plugin") {
    return { action: "plugins" };
  }
  if (low === "/vita keys") {
    return { action: "keys" };
  }
  if (low === "/vita unwrap" || low.startsWith("/vita unwrap ")) {
    const rest = src.slice("/vita unwrap".length).trim();
    const parts = rest.split(/\s+/).filter(Boolean);
    let key = null;
    let filename = null;
    for (const p of parts) {
      if (/^VITASESS\./i.test(p) || /^[0-9a-f]{8,16}$/i.test(p)) key = p;
      else filename = filename ? filename + " " + p : p;
    }
    return { action: "unwrap", key, filename };
  }
  if (low.startsWith("/vita session")) {
    const kind = src.slice("/vita session".length).trim().toLowerCase();
    return { action: "session", kind: kind || "set" };
  }
  if (low.startsWith("/vita read ")) {
    return { action: "read", filename: src.slice("/vita read ".length).trim() };
  }
  if (low === "/vita read" || low === "/vita open") {
    return { action: "files" };
  }
  if (low.startsWith("/vita open ")) {
    return { action: "read", filename: src.slice("/vita open ".length).trim() };
  }
  if (low.startsWith("/vita proof ")) {
    return { action: "proof", filename: src.slice("/vita proof ".length).trim() };
  }
  if (low === "/vita proof" || low === "/vita exist" || low.startsWith("/vita exist ")) {
    const filename = src.replace(/^\/vita (?:proof|exist)\s*/i, "").trim();
    return { action: "proof", filename: filename || null };
  }
  if (low.startsWith("/vita ")) {
    return { action: "ask", question: src.slice("/vita ".length).trim() };
  }
  return { action: null };
}

export function telegramCallbackData(cmd) {
  const s = String(cmd || "");
  return s.length <= CALLBACK_DATA_MAX ? s : s.slice(0, CALLBACK_DATA_MAX);
}

export function buildMirrorKeyboard({
  filename = null,
  locations = [],
  githubUrl = null,
  includeFiles = true,
} = {}) {
  const rows = [];
  if (filename) {
    const read = telegramCallbackData("/vita read " + filename);
    const proof = telegramCallbackData("/vita proof " + filename);
    const unwrap = telegramCallbackData("/vita unwrap");
    rows.push([
      { text: "📖 Open", callback_data: read },
      { text: "🔓 Unwrap", callback_data: unwrap },
      { text: "⛓️ Proof", callback_data: proof },
    ]);
  }
  const linkRow = [];
  if (githubUrl) linkRow.push({ text: "GitHub blob ↗", url: githubUrl });
  for (const loc of (locations || []).slice(0, 2)) {
    if (!loc?.basescan) continue;
    linkRow.push({ text: "IDM " + shortHex(loc.location, 6) + " ↗", url: loc.basescan });
  }
  if (linkRow.length) rows.push(linkRow.slice(0, 3));
  const nav = [];
  if (includeFiles) nav.push({ text: "📂 Files", callback_data: "/vita files" });
  nav.push({ text: "🪞 Chain", callback_data: "/vita chain" });
  nav.push({ text: "🔑 Session keys", callback_data: "/vita session" });
  rows.push(nav);
  return { inline_keyboard: rows };
}

function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function locLines(locations) {
  const lines = [];
  lines.push("— IDM CHAT (Basescan Input Data → UTF-8) —");
  if (!locations.length) {
    lines.push("(no sealed Base loc yet — never invented)");
    return lines;
  }
  for (const loc of locations.slice(0, 6)) {
    lines.push(
      "🔗 " +
        (loc.id || "sealed") +
        "  " +
        shortHex(loc.location, 8) +
        "…  " +
        loc.basescan,
    );
  }
  lines.push("Open the tx → Input Data → View as UTF-8.");
  return lines;
}

export function formatMirrorReadCard(result) {
  const lines = [];
  lines.push(MIRROR_MAGIC + "v1|read§");
  if (!result?.ok) {
    lines.push("❌ File not found: " + (result?.filename || "?"));
    if (result?.lane) lines.push("lane=" + result.lane);
    if (result?.tried?.length) lines.push("tried: " + result.tried.join(" · "));
    if (result?.hint) lines.push(result.hint);
    lines.push("local disk + GitHub CODE/STATE. Never invented.");
    return lines.join("\n");
  }
  lines.push("🌟 VITA MIRROR READ  " + result.filename);
  lines.push("━━━━━━━━━━━━━━━━━━━━");
  lines.push(
    "lane=" +
      result.lane +
      "  local=" +
      (result.local ? "YES" : "no") +
      "  github=" +
      (result.github ? "YES" : "no") +
      (result.githubBranch ? "@" + result.githubBranch : ""),
  );
  lines.push("source=" + result.source + "  bytes=" + result.bytes);
  lines.push("blob sha256=" + shortHex(result.sha, 12) + "…  (GitHub object — not a Base tx)");
  if (result.sessionKey) {
    lines.push(MIRROR_KEY_MAGIC + " " + result.sessionKey.key + "  kind=" + result.sessionKey.kind);
    lines.push("unwrap: /vita unwrap " + result.sessionKey.key);
  }
  if (result.snark?.short) lines.push("snark " + result.snark.short);
  lines.push("");
  lines.push(...locLines(result.locations || []));
  if (result.exports?.length) {
    lines.push("");
    lines.push("exports: " + result.exports.join(", "));
  }
  lines.push("");
  lines.push("— PREVIEW —");
  lines.push(result.preview || "");
  lines.push("");
  lines.push("Tap Open / Unwrap / Proof / Basescan. Anthropic not required.");
  return lines.join("\n");
}

export function formatMirrorFilesCard(listed) {
  const lines = [];
  lines.push(MIRROR_MAGIC + "v1|files§");
  lines.push("🌟 VITA can open these (tap or /vita read NAME)");
  lines.push("CODE = GitHub main + Railway disk · STATE = bot-state");
  lines.push("━━━━━━━━━━━━━━━━━━━━");
  for (const f of listed.files || []) {
    const mark = f.exists ? "✅" : "⬜";
    lines.push(
      mark +
        "  " +
        f.name +
        "  [" +
        f.lane +
        "]" +
        (f.exists ? "" : "  (state lane / GitHub)"),
    );
  }
  lines.push("");
  lines.push("Also: /vita chain · /vita session · /vita proof NAME");
  return lines.join("\n");
}

export function formatMirrorProofCard(result) {
  const lines = [];
  lines.push(MIRROR_MAGIC + "v1|proof§");
  lines.push("⛓️ LEDGER PROOF  " + (result.filename || "batch"));
  lines.push("exists=" + (result.exists ? "YES" : "NO") + "  source=" + (result.source || "miss"));
  lines.push("snark " + (result.snark?.short || result.batch?.short || "—"));
  if (result.batch?.root) lines.push("merkle " + shortHex(result.batch.root, 16) + "…");
  lines.push("neverInventHashes=true  (blob SHA ≠ Base tx)");
  lines.push("");
  lines.push(...locLines(result.locations || []));
  lines.push("");
  lines.push("Unwrap with the session key to see English + machine blocks.");
  return lines.join("\n");
}

export function formatMirrorUnwrapCard(result) {
  const lines = [];
  lines.push(MIRROR_SNARK_MAGIC + " UNWRAP");
  if (!result?.ok) {
    lines.push("❌ " + (result?.reason || "unwrap failed"));
    return lines.join("\n");
  }
  lines.push("key=" + result.key);
  lines.push("kind=" + result.kind + "  destroyed=" + (result.destroyed ? "YES" : "no"));
  lines.push("privateKey=NO · openSource=YES · instantUnwrap=YES");
  lines.push("");
  lines.push("— ENGLISH —");
  lines.push(result.reveal?.english || "");
  lines.push("");
  lines.push("— MACHINE —");
  lines.push(result.reveal?.machine || "");
  lines.push("");
  lines.push(...locLines(result.locations || []));
  return lines.join("\n");
}

export function formatMirrorChainCard() {
  const lines = [];
  lines.push(MIRROR_MAGIC + "v1|chain§");
  lines.push("🪞 GITHUB AS BLOCKCHAIN (availability) + BASE (settlement)");
  lines.push("formula=" + FORMULA_ID);
  for (const [k, v] of Object.entries(GITHUB_AS_CHAIN)) {
    lines.push("  " + k + " → " + v);
  }
  lines.push("");
  lines.push("lanes: CODE=main  STATE=bot-state  local=Railway checkout");
  lines.push("plugins (out of the box):");
  for (const p of MIRROR_PLUGINS) {
    lines.push("  • " + p.name + " — " + p.when);
  }
  lines.push("");
  lines.push("Session keys = Railway env: /vita session  (permanent|ttl|destroy)");
  lines.push("Proof: /vita proof FILE  ·  IDM: Basescan Input Data → UTF-8");
  lines.push("Never invent tx hashes. Blob SHA is GitHub, not Base.");
  return lines.join("\n");
}

export function formatMirrorSessionCard(set, listed) {
  const lines = [];
  lines.push(MIRROR_KEY_MAGIC + " SESSION KEYS (Railway-style)");
  lines.push("New set minted. Each session needs fresh keys.");
  if (set) {
    lines.push("permanent   " + set.permanent.key);
    lines.push("ttl         " + set.ttl.key);
    lines.push("destroyable " + set.destroyable.key);
  }
  lines.push("openSource=YES  privateKey=NO");
  const live = listed || [];
  if (live.length) {
    lines.push("");
    lines.push("live (" + live.length + "):");
    for (const k of live.slice(-9)) {
      lines.push("  " + k.kind.padEnd(12) + k.key);
    }
  }
  lines.push("");
  lines.push("/vita unwrap KEY   ·  /vita keys");
  return lines.join("\n");
}

export function formatMirrorTelegramHtml(text) {
  return "<pre>" + esc(String(text || "")).slice(0, 3500) + "</pre>";
}

async function listFilesWithExistence({ cwd, githubFetch, codeBranch, stateBranch }) {
  const files = [];
  for (const e of MIRROR_CATALOG) {
    const local = resolveLocalMirrorFile(e.name, { cwd });
    files.push({
      name: e.name,
      lane: e.lane,
      kind: e.kind,
      role: e.role,
      exists: local.ok,
      source: local.ok ? "local" : null,
    });
  }
  if (typeof githubFetch === "function") {
    const missing = files.filter((f) => !f.exists).slice(0, 8);
    for (const f of missing) {
      const branch = f.lane === "state" ? stateBranch : codeBranch;
      const hit = await fetchLane(githubFetch, f.name, branch);
      if (hit && !hit.miss) {
        f.exists = true;
        f.source = "github:" + branch;
      }
    }
  }
  return files;
}

/**
 * Handle /vita read|files|proof|unwrap|chain|session|keys|plugins.
 * githubFetch(filename, branch) optional — local disk still works.
 */
export async function handleVitaMirrorAction({
  action,
  filename = null,
  key = null,
  kind = null,
  chatId = "default",
  cwd = REPO_ROOT,
  githubFetch = null,
  codeBranch = "main",
  stateBranch = "bot-state",
  repo = "",
  now = Date.now(),
  extraLocs = [],
} = {}) {
  expireSessionKeys(chatId, now);
  const bucket = sessionBucket(chatId);

  if (action === "chain" || action === "plugins") {
    const reply = formatMirrorChainCard();
    return {
      ok: true,
      action,
      reply,
      html: formatMirrorTelegramHtml(reply),
      keyboard: buildMirrorKeyboard({ includeFiles: true }),
    };
  }

  if (action === "session") {
    const setKind = String(kind || "set").toLowerCase();
    let set = null;
    if (setKind === "permanent" || setKind === "ttl" || setKind === "destroyable") {
      mintSessionKey({ kind: setKind, chatId, now, filename: bucket.lastFile });
    } else {
      set = mintSessionKeySet({ chatId, filename: bucket.lastFile, now });
    }
    const listed = listSessionKeys(chatId, now);
    const reply = formatMirrorSessionCard(set, listed);
    return {
      ok: true,
      action: "session",
      reply,
      html: formatMirrorTelegramHtml(reply),
      keyboard: buildMirrorKeyboard({ filename: bucket.lastFile }),
      keys: listed,
    };
  }

  if (action === "keys") {
    const listed = listSessionKeys(chatId, now);
    const reply = formatMirrorSessionCard(null, listed);
    return {
      ok: true,
      action: "keys",
      reply,
      html: formatMirrorTelegramHtml(reply),
      keyboard: buildMirrorKeyboard({ filename: bucket.lastFile }),
      keys: listed,
    };
  }

  if (action === "files") {
    const files = await listFilesWithExistence({ cwd, githubFetch, codeBranch, stateBranch });
    const listed = { files };
    const reply = formatMirrorFilesCard(listed);
    const keyboard = { inline_keyboard: [] };
    const clickable = files.filter((f) => f.exists).slice(0, 8);
    for (let i = 0; i < clickable.length; i += 2) {
      const row = clickable.slice(i, i + 2).map((f) => ({
        text: "📖 " + f.name.replace(/^vita\//, ""),
        callback_data: telegramCallbackData("/vita read " + f.name),
      }));
      keyboard.inline_keyboard.push(row);
    }
    keyboard.inline_keyboard.push([
      { text: "🪞 Chain", callback_data: "/vita chain" },
      { text: "🔑 Session", callback_data: "/vita session" },
    ]);
    return {
      ok: true,
      action: "files",
      reply,
      html: formatMirrorTelegramHtml(reply),
      keyboard,
      files,
    };
  }

  if (action === "unwrap") {
    const fileSel = filename || bucket.lastFile;
    const row = findKey(chatId, key);
    if (!row) {
      const miss = { ok: false, reason: "need session key — /vita read FILE mints one, or /vita session" };
      const reply = formatMirrorUnwrapCard(miss);
      return { ok: false, action: "unwrap", reply, html: formatMirrorTelegramHtml(reply) };
    }
    if (row.kind === "ttl" && row.expiresAt && now >= row.expiresAt) {
      row.destroyed = true;
      row.destroyReason = "ttl";
      const miss = { ok: false, reason: "key expired (ttl)" };
      const reply = formatMirrorUnwrapCard(miss);
      return { ok: false, action: "unwrap", reply, html: formatMirrorTelegramHtml(reply) };
    }
    if (!fileSel) {
      const miss = { ok: false, reason: "no last file — /vita read NAME first" };
      const reply = formatMirrorUnwrapCard(miss);
      return { ok: false, action: "unwrap", reply, html: formatMirrorTelegramHtml(reply) };
    }
    const resolved = await resolveMirrorFile(fileSel, { cwd, githubFetch, codeBranch, stateBranch });
    if (!resolved.ok) {
      const reply = formatMirrorReadCard(resolved);
      return { ok: false, action: "unwrap", reply, html: formatMirrorTelegramHtml(reply), keyboard: buildMirrorKeyboard({ includeFiles: true }) };
    }
    const extra = extractSealedTxHashes(tryParseJson(resolved.text)).concat(extraLocs);
    const locations = collectIdmLocations(extra);
    const snark = snarkCompressBlob(resolved.text, { filename: resolved.filename, locs: locations });
    const reveal = unwrapMachineShort(snark, { english: snark.english, machine: snark.machine });
    row.uses += 1;
    let destroyed = false;
    if (row.kind === "destroyable") {
      row.destroyed = true;
      row.destroyReason = "unwrap";
      destroyed = true;
    }
    const card = {
      ok: true,
      key: row.key,
      kind: row.kind,
      destroyed,
      reveal,
      locations,
      filename: resolved.filename,
    };
    const reply = formatMirrorUnwrapCard(card);
    const githubUrl = githubBlobHtmlUrl({
      repo,
      filename: resolved.filename,
      branch: resolved.githubBranch || (resolved.lane === "state" ? stateBranch : codeBranch),
    });
    return {
      ok: true,
      action: "unwrap",
      reply,
      html: formatMirrorTelegramHtml(reply),
      keyboard: buildMirrorKeyboard({ filename: resolved.filename, locations, githubUrl }),
      reveal,
      locations,
      destroyed,
    };
  }

  if (action === "proof" || action === "read") {
    const fileSel = filename || bucket.lastFile;
    if (!fileSel) {
      return handleVitaMirrorAction({
        action: "files",
        chatId,
        cwd,
        githubFetch,
        codeBranch,
        stateBranch,
        repo,
        now,
      });
    }
    const resolved = await resolveMirrorFile(fileSel, { cwd, githubFetch, codeBranch, stateBranch });
    const extra = resolved.ok
      ? extractSealedTxHashes(tryParseJson(resolved.text)).concat(extraLocs)
      : extraLocs;
    const locations = collectIdmLocations(extra);
    if (!resolved.ok) {
      const reply = action === "proof"
        ? formatMirrorProofCard({ filename: fileSel, exists: false, locations, source: "miss" })
        : formatMirrorReadCard(resolved);
      return {
        ok: false,
        action,
        reply,
        html: formatMirrorTelegramHtml(reply),
        keyboard: buildMirrorKeyboard({ includeFiles: true, locations }),
        filename: fileSel,
      };
    }

    bucket.lastFile = resolved.filename;
    const snark = snarkCompressBlob(resolved.text, { filename: resolved.filename, locs: locations });
    const sessionKey = mintSessionKey({
      kind: "destroyable",
      chatId,
      filename: resolved.filename,
      contentCommit: snark.contentCommit,
      now,
    });
    const githubUrl = githubBlobHtmlUrl({
      repo,
      filename: resolved.filename,
      branch: resolved.githubBranch || (resolved.lane === "state" ? stateBranch : codeBranch),
    });
    const keyboard = buildMirrorKeyboard({
      filename: resolved.filename,
      locations,
      githubUrl,
    });

    if (action === "proof") {
      const batch = snarkCompressBatch(
        [{ name: resolved.filename, text: resolved.text, exists: true, contentCommit: snark.contentCommit }],
        { title: resolved.filename },
      );
      const card = {
        filename: resolved.filename,
        exists: true,
        source: resolved.source,
        snark,
        batch,
        locations,
      };
      const reply = formatMirrorProofCard(card);
      return {
        ok: true,
        action: "proof",
        reply,
        html: formatMirrorTelegramHtml(reply),
        keyboard,
        exists: true,
        snark,
        locations,
        sessionKey,
        githubUrl,
      };
    }

    const card = {
      ...resolved,
      snark,
      sessionKey,
      locations,
      preview: previewText(resolved.text, resolved.filename),
      exports: parseExportsHint(resolved.text),
    };
    const reply = formatMirrorReadCard(card);
    return {
      ok: true,
      action: "read",
      reply,
      html: formatMirrorTelegramHtml(reply),
      keyboard,
      filename: resolved.filename,
      text: resolved.text,
      preview: card.preview,
      snark,
      sessionKey,
      locations,
      githubUrl,
      local: resolved.local,
      github: resolved.github,
    };
  }

  return { ok: false, action: action || "unknown", reply: "unknown mirror action", html: "" };
}

function tryParseJson(text) {
  try {
    return JSON.parse(String(text || ""));
  } catch {
    return null;
  }
}
