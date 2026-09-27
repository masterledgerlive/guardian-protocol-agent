/**
 * VITA ROUTE REGISTRY (VRR) — on-chain "doors" for agentic AI.
 * ─────────────────────────────────────────────────────────────────────────────
 * On-chain = hex payload ONLY (binary calldata of a 0-ETH self-tx on Base).
 * JSON schema lives in docs/VITA_ROUTE_REGISTRY.md — never on chain.
 *
 * Wire format (v2; decoder also reads v1):
 *   magic   3B  "VRR" (0x565252)
 *   version 1B  0x02 (0x01 accepted on read)
 *   kind    1B  0x01 DOOR | 0x02 GRADE | 0x03 AGENT (directory leader/follow)
 *   flags   1B  reserved (0)
 *   fields  TLV*  tag(1B) len(1B, ≤255) value
 *   check   4B  sha256(magic..last field)[0:4]
 *
 * Wraps / reuses WAVE patterns (0-ETH self-tx, fetch calldata by tx hash,
 * sha256 answer-key compare). Mother brain + genesis files untouched.
 * Never invents hashes: verify() recomputes from chain + GitHub bytes.
 */

import { createHash, createCipheriv, createDecipheriv, randomBytes } from "crypto";

export const VRR_MAGIC_HEX = "565252"; // "VRR"
export const VRR_VERSION = 2;            // encoder writes v2
export const VRR_SUPPORTED_VERSIONS = Object.freeze([1, 2]); // decoder reads v1 + v2
export const VRR_KIND = Object.freeze({ DOOR: 1, GRADE: 2, AGENT: 3 });
export const VRR_CHAIN_BASE = 8453;
export const VRR_VIS = Object.freeze({ PLAIN: 0, ENCODED: 1 });
export const VRR_ROLE = Object.freeze({ LEADER: 0, FOLLOW: 1 });
export const AGENT_NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$|^[a-z0-9]$/;
/** Tags that may repeat (decoded into arrays). */
export const VRR_REPEATABLE = Object.freeze(new Set([0x18]));
export const VRR_DEFAULT_REPO = "masterledgerlive/guardian-protocol-agent";
export const VRR_CHECK_BYTES = 4;

/** tag → [name, type]. Types: utf8 | b20 | b32 | u8 | u16 | u32 | result | bytes */
export const VRR_TAGS = Object.freeze({
  0x01: ["doorId", "utf8"],
  0x02: ["name", "utf8"],
  0x03: ["desc", "utf8"],
  0x04: ["commit", "b20"],     // git commit sha1 (20B)
  0x05: ["codePath", "utf8"],
  0x06: ["codeHash", "b32"],   // sha256(file bytes @ commit)
  0x07: ["testPath", "utf8"],
  0x08: ["testHash", "b32"],   // sha256(test file bytes @ commit)
  0x09: ["testResult", "result"], // u16 pass, u16 total
  0x0a: ["version", "u16"],
  0x0b: ["supersedes", "b32"], // tx hash of prior door entry this beats
  0x0c: ["repo", "utf8"],      // omitted ⇒ VRR_DEFAULT_REPO
  0x0d: ["refDoor", "b32"],    // GRADE: tx hash of graded door entry
  0x0e: ["grade", "u8"],       // GRADE: 0..100
  0x0f: ["grader", "utf8"],    // GRADE: agent id
  // ── v2 ──
  0x10: ["chainId", "u32"],     // EVM chain id (Base 8453); v1 entries ⇒ 8453
  0x11: ["visibility", "u8"],   // 0 plain | 1 encoded (see sealed/sealedHash)
  0x12: ["agentName", "utf8"],  // AGENT: unique public name (wild-west directory)
  0x13: ["ownerCommit", "b32"], // AGENT: sha256(secret ‖ name ‖ chainId u32be)
  0x14: ["role", "u8"],         // AGENT: 0 leader | 1 follow
  0x15: ["leader", "b32"],      // AGENT follow: tx hash of leader entry
  0x16: ["sealed", "bytes"],    // encoded fields: AES-256-GCM iv12‖tag16‖ct
  0x17: ["sealedHash", "b32"],  // sha256(inner TLV plaintext) — verify after unseal
  0x18: ["links", "b32"],       // repeatable: tx hashes (leader → follows / doors)
});
const TAG_ORDER = Object.keys(VRR_TAGS).map(Number);

export const REQUIRED = Object.freeze({
  [VRR_KIND.DOOR]: ["doorId", "name", "commit", "codePath", "codeHash", "version"],
  [VRR_KIND.GRADE]: ["refDoor", "grade", "grader"],
  [VRR_KIND.AGENT]: ["agentName", "ownerCommit", "role"],
});
const KIND_NAME = { 1: "door", 2: "grade", 3: "agent" };
const NAME_KIND = { door: 1, grade: 2, agent: 3 };

export function sha256Hex(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function hexBytes(v, n, name) {
  const h = String(v || "").replace(/^0x/i, "").toLowerCase();
  if (!new RegExp(`^[0-9a-f]{${n * 2}}$`).test(h)) {
    throw new Error(`VRR: ${name} must be ${n} bytes hex`);
  }
  return Buffer.from(h, "hex");
}

function hexBytesAny(v, name) {
  const h = String(v || "").replace(/^0x/i, "").toLowerCase();
  if (!/^([0-9a-f]{2})+$/.test(h)) throw new Error(`VRR: ${name} must be hex bytes`);
  return Buffer.from(h, "hex");
}

function encodeValue(name, type, v) {
  switch (type) {
    case "utf8": {
      const b = Buffer.from(String(v), "utf8");
      if (b.length === 0) throw new Error(`VRR: ${name} empty`);
      return b;
    }
    case "b20": return hexBytes(v, 20, name);
    case "b32": return hexBytes(v, 32, name);
    case "u8": {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0 || n > 255) throw new Error(`VRR: ${name} u8`);
      return Buffer.from([n]);
    }
    case "u16": {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0 || n > 65535) throw new Error(`VRR: ${name} u16`);
      const b = Buffer.alloc(2); b.writeUInt16BE(n); return b;
    }
    case "u32": {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) throw new Error(`VRR: ${name} u32`);
      const b = Buffer.alloc(4); b.writeUInt32BE(n); return b;
    }
    case "bytes": return Buffer.isBuffer(v) ? v : hexBytesAny(v, name);
    case "result": {
      const pass = Number(v?.pass), total = Number(v?.total);
      if (![pass, total].every((x) => Number.isInteger(x) && x >= 0 && x <= 65535) || pass > total) {
        throw new Error(`VRR: ${name} needs {pass,total}`);
      }
      const b = Buffer.alloc(4); b.writeUInt16BE(pass, 0); b.writeUInt16BE(total, 2); return b;
    }
    default: throw new Error(`VRR: unknown type ${type}`);
  }
}

function decodeValue(type, b) {
  switch (type) {
    case "utf8": return b.toString("utf8");
    case "b20": case "b32": return "0x" + b.toString("hex");
    case "u8": return b[0];
    case "u16": return b.readUInt16BE(0);
    case "u32": return b.readUInt32BE(0);
    case "bytes": return "0x" + b.toString("hex");
    case "result": return { pass: b.readUInt16BE(0), total: b.readUInt16BE(2) };
    default: return "0x" + b.toString("hex");
  }
}

function kindOf(k) {
  if (typeof k === "number" && KIND_NAME[k]) return k;
  return NAME_KIND[String(k || "door")] || VRR_KIND.DOOR;
}

/** TLV-encode fields (ascending tag order; repeatable tags emit one TLV per item). */
export function encodeFields(entry = {}) {
  const parts = [];
  for (const tag of TAG_ORDER) {
    const [name, type] = VRR_TAGS[tag];
    const v = entry[name];
    if (v == null) continue;
    if (name === "repo" && v === VRR_DEFAULT_REPO) continue; // default ⇒ omit
    const items = VRR_REPEATABLE.has(tag) ? (Array.isArray(v) ? v : [v]) : [v];
    for (const it of items) {
      const val = encodeValue(name, type, it);
      if (val.length > 255) throw new Error(`VRR: ${name} > 255 bytes`);
      parts.push(Buffer.from([tag, val.length]), val);
    }
  }
  return Buffer.concat(parts);
}

/** Parse TLV bytes into { fields, unknownTags } or { error }. */
export function decodeFields(buf) {
  const fields = {}, unknownTags = [];
  let i = 0;
  while (i < buf.length) {
    if (i + 2 > buf.length) return { error: "truncated TLV" };
    const tag = buf[i], len = buf[i + 1];
    const val = buf.subarray(i + 2, i + 2 + len);
    if (val.length !== len) return { error: "truncated value" };
    const spec = VRR_TAGS[tag];
    if (!spec) unknownTags.push({ tag, hex: "0x" + val.toString("hex") }); // forward-compat
    else if (VRR_REPEATABLE.has(tag)) (fields[spec[0]] ||= []).push(decodeValue(spec[1], val));
    else fields[spec[0]] = decodeValue(spec[1], val);
    i += 2 + len;
  }
  return { fields, unknownTags };
}

/** Encode an entry object → 0x calldata hex (v2). */
export function encodeEntry(entry = {}) {
  const kind = kindOf(entry.kind);
  const e = { chainId: VRR_CHAIN_BASE, ...entry };
  if (kind === VRR_KIND.AGENT && !AGENT_NAME_RE.test(String(e.agentName || ""))) {
    throw new Error("VRR: agentName must be [a-z0-9-], 1-64 chars, no edge dash");
  }
  if (e.visibility === VRR_VIS.ENCODED && (!e.sealed || !e.sealedHash)) {
    throw new Error("VRR: encoded visibility needs sealed + sealedHash (use sealFields)");
  }
  for (const k of REQUIRED[kind]) {
    if (e[k] == null || e[k] === "") throw new Error(`VRR: missing ${k}`);
  }
  const body = Buffer.concat([
    Buffer.from(VRR_MAGIC_HEX, "hex"), Buffer.from([VRR_VERSION, kind, 0]), encodeFields(e),
  ]);
  const check = Buffer.from(sha256Hex(body).slice(0, VRR_CHECK_BYTES * 2), "hex");
  return "0x" + Buffer.concat([body, check]).toString("hex");
}

export function isVrrCalldata(hex) {
  return String(hex || "").toLowerCase().replace(/^0x/, "").startsWith(VRR_MAGIC_HEX);
}

/** Decode 0x calldata → { ok, entry, error }. Validates magic, version, checksum. */
export function decodeEntry(hex) {
  const h = String(hex || "").replace(/^0x/i, "").toLowerCase();
  if (!/^[0-9a-f]*$/.test(h) || h.length % 2) return { ok: false, error: "not hex" };
  const buf = Buffer.from(h, "hex");
  if (buf.length < 6 + VRR_CHECK_BYTES) return { ok: false, error: "too short" };
  if (buf.subarray(0, 3).toString("hex") !== VRR_MAGIC_HEX) return { ok: false, error: "bad magic" };
  const version = buf[3];
  if (!VRR_SUPPORTED_VERSIONS.includes(version)) return { ok: false, error: `unsupported version ${version}` };
  const body = buf.subarray(0, buf.length - VRR_CHECK_BYTES);
  const check = buf.subarray(buf.length - VRR_CHECK_BYTES).toString("hex");
  if (sha256Hex(body).slice(0, VRR_CHECK_BYTES * 2) !== check) return { ok: false, error: "checksum mismatch" };
  const kind = buf[4];
  if (!REQUIRED[kind] || (version === 1 && kind > 2)) return { ok: false, error: `unknown kind ${kind}` };
  const parsed = decodeFields(body.subarray(6));
  if (parsed.error) return { ok: false, error: parsed.error };
  const entry = {
    kind: KIND_NAME[kind], version_wire: version, repo: VRR_DEFAULT_REPO,
    chainId: VRR_CHAIN_BASE, visibility: VRR_VIS.PLAIN, ...parsed.fields, unknownTags: parsed.unknownTags,
  };
  for (const k of REQUIRED[kind]) if (entry[k] == null) return { ok: false, error: `missing ${k}` };
  return { ok: true, entry, bytes: buf.length, checksum: check };
}

// ── Hidden owner tag (leader/follow directory) ──────────────────────────────

/** ownerCommit = sha256(secret ‖ utf8(name) ‖ chainId u32be). Secret stays off-chain. */
export function ownerCommitment(secret, name, chainId = VRR_CHAIN_BASE) {
  const s = Buffer.isBuffer(secret) ? secret : Buffer.from(String(secret), "utf8");
  if (s.length < 16) throw new Error("VRR: owner secret must be ≥16 bytes");
  const c = Buffer.alloc(4); c.writeUInt32BE(Number(chainId));
  return "0x" + sha256Hex(Buffer.concat([s, Buffer.from(String(name), "utf8"), c]));
}

/** Owner proof: reveal secret → recompute; true iff it matches the entry's commit. */
export function verifyOwnerReveal(entry, secret) {
  try {
    return ownerCommitment(secret, entry.agentName, entry.chainId ?? VRR_CHAIN_BASE) === entry.ownerCommit;
  } catch { return false; }
}

// ── Encoded visibility (agent-decodable, owner-held key) ────────────────────

/**
 * Seal selected fields with AES-256-GCM (32B key held by owner / shared with
 * agents). Returns { visibility, sealed, sealedHash } to spread into an entry.
 * sealedHash = sha256(inner TLV) so anyone holding the key can verify, and
 * anyone at all can verify integrity of the ciphertext via the entry checksum.
 */
export function sealFields(fields, key, iv = randomBytes(12)) {
  const k = Buffer.isBuffer(key) ? key : Buffer.from(String(key).replace(/^0x/, ""), "hex");
  if (k.length !== 32) throw new Error("VRR: seal key must be 32 bytes");
  const inner = encodeFields(fields);
  const c = createCipheriv("aes-256-gcm", k, iv);
  const ct = Buffer.concat([c.update(inner), c.final()]);
  const sealed = Buffer.concat([iv, c.getAuthTag(), ct]);
  if (sealed.length > 255) throw new Error("VRR: sealed payload > 255 bytes");
  return { visibility: VRR_VIS.ENCODED, sealed: "0x" + sealed.toString("hex"), sealedHash: "0x" + sha256Hex(inner) };
}

/** Unseal an encoded entry → { ok, fields } (verifies GCM tag + sealedHash). */
export function unsealEntry(entry, key) {
  try {
    const k = Buffer.isBuffer(key) ? key : Buffer.from(String(key).replace(/^0x/, ""), "hex");
    const b = Buffer.from(String(entry.sealed).replace(/^0x/, ""), "hex");
    const d = createDecipheriv("aes-256-gcm", k, b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    const inner = Buffer.concat([d.update(b.subarray(28)), d.final()]);
    if ("0x" + sha256Hex(inner) !== entry.sealedHash) return { ok: false, error: "sealedHash mismatch" };
    const p = decodeFields(inner);
    return p.error ? { ok: false, error: p.error } : { ok: true, fields: p.fields };
  } catch (e) {
    return { ok: false, error: "unseal failed: " + (e?.message || e) };
  }
}

/** Build a DOOR entry from local file bytes (paper test / pre-broadcast). */
export function buildDoorFromBytes({ codeBytes, testBytes, ...rest }) {
  const e = { kind: "door", ...rest, codeHash: "0x" + sha256Hex(codeBytes) };
  if (testBytes) e.testHash = "0x" + sha256Hex(testBytes);
  return e;
}

export function rawGithubUrl(repo, commit, path) {
  return `https://raw.githubusercontent.com/${repo}/${String(commit).replace(/^0x/, "")}/${path}`;
}

export async function fetchGithubSha256(repo, commit, path, fetchImpl = fetch) {
  const res = await fetchImpl(rawGithubUrl(repo, commit, path), { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`GitHub ${res.status} for ${path}`);
  return "0x" + sha256Hex(Buffer.from(await res.arrayBuffer()));
}

export async function rpcCall(rpcUrl, method, params, fetchImpl = fetch) {
  const res = await fetchImpl(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(15_000),
  });
  const j = await res.json();
  if (j.error) throw new Error(`RPC ${method}: ${j.error.message}`);
  return j.result;
}

/** Verify a decoded DOOR against GitHub bytes. */
export async function verifyDoorAgainstGithub(entry, fetchImpl = fetch) {
  const out = { codeHashOk: null, testHashOk: null };
  const repo = entry.repo || VRR_DEFAULT_REPO;
  const gotCode = await fetchGithubSha256(repo, entry.commit, entry.codePath, fetchImpl);
  out.codeHashGithub = gotCode;
  out.codeHashOk = gotCode === entry.codeHash;
  if (entry.testPath && entry.testHash) {
    const gotTest = await fetchGithubSha256(repo, entry.commit, entry.testPath, fetchImpl);
    out.testHashGithub = gotTest;
    out.testHashOk = gotTest === entry.testHash;
  }
  out.ok = out.codeHashOk && out.testHashOk !== false;
  return out;
}

/**
 * Full readback: tx by hash from Base RPC → decode calldata → check GitHub.
 * Optional expectFrom enforces registrar address + self-call (to == from).
 */
export async function verifyRegistryTx(txHash, {
  rpcUrl = "https://mainnet.base.org",
  expectFrom = null,
  fetchImpl = fetch,
} = {}) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(String(txHash))) return { ok: false, error: "need 0x + 64 hex" };
  const tx = await rpcCall(rpcUrl, "eth_getTransactionByHash", [txHash], fetchImpl);
  if (!tx) return { ok: false, error: "tx not found" };
  const rcpt = await rpcCall(rpcUrl, "eth_getTransactionReceipt", [txHash], fetchImpl);
  const selfCall = String(tx.to || "").toLowerCase() === String(tx.from || "").toLowerCase();
  const fromOk = expectFrom ? String(tx.from).toLowerCase() === String(expectFrom).toLowerCase() : true;
  const dec = decodeEntry(tx.input);
  const base = {
    txHash, from: tx.from, to: tx.to, selfCall, fromOk,
    value: BigInt(tx.value || "0x0").toString(),
    status: rcpt?.status ?? null, blockNumber: rcpt?.blockNumber ? parseInt(rcpt.blockNumber, 16) : null,
  };
  if (!dec.ok) return { ...base, ok: false, error: dec.error };
  const gh = dec.entry.kind === "door" ? await verifyDoorAgainstGithub(dec.entry, fetchImpl) : { ok: true, skipped: dec.entry.kind };
  return {
    ...base, entry: dec.entry, bytes: dec.bytes, github: gh,
    ok: rcpt?.status === "0x1" && selfCall && fromOk && base.value === "0" && gh.ok,
  };
}

/**
 * Resolve the live door per doorId from decoded entries (chain order).
 * A newer entry wins only if it supersedes the current head tx, has a higher
 * version, and its test result is not worse (pass/total ratio).
 */
export function resolveDoors(rows = []) {
  const heads = new Map();
  const ratio = (e) => (e.testResult?.total ? e.testResult.pass / e.testResult.total : 0);
  for (const r of rows) {
    const e = r.entry;
    if (!e || e.kind !== "door") continue;
    const cur = heads.get(e.doorId);
    if (!cur) { if (!e.supersedes) heads.set(e.doorId, r); continue; }
    if (e.supersedes === cur.txHash && e.version > cur.entry.version && ratio(e) >= ratio(cur.entry)) {
      heads.set(e.doorId, r);
    }
  }
  const grades = {};
  for (const r of rows) {
    if (r.entry?.kind !== "grade") continue;
    (grades[r.entry.refDoor] ||= []).push({ grader: r.entry.grader, grade: r.entry.grade, txHash: r.txHash });
  }
  return { heads: Object.fromEntries(heads), grades };
}

/**
 * Wild-west agent directory resolution (chain order):
 *  - First valid LEADER for a name holds it.
 *  - The holder updates by a newer LEADER with the same name + ownerCommit that
 *    `supersedes` the current head AND is sent from the same address.
 *  - A challenger (different ownerCommit) takes the name only when its average
 *    grade beats the holder's by ≥ minGradeLead with ≥ minGraders distinct graders.
 *  - FOLLOW entries attach to the leader they name (and are listed if the head
 *    leader links them).
 */
export function resolveAgents(rows = [], { minGradeLead = 10, minGraders = 3 } = {}) {
  const gradesBy = {};
  for (const r of rows) {
    if (r.entry?.kind !== "grade") continue;
    const g = (gradesBy[r.entry.refDoor] ||= new Map());
    g.set(r.entry.grader, r.entry.grade); // latest grade per grader
  }
  const avg = (tx) => {
    const g = gradesBy[tx];
    if (!g || !g.size) return { avg: 0, n: 0 };
    return { avg: [...g.values()].reduce((a, b) => a + b, 0) / g.size, n: g.size };
  };
  const heads = new Map();
  const follows = {};
  for (const r of rows) {
    const e = r.entry;
    if (e?.kind !== "agent") continue;
    if (e.role === VRR_ROLE.FOLLOW) { (follows[e.leader] ||= []).push(r.txHash); continue; }
    const key = `${e.chainId}:${e.agentName}`;
    const cur = heads.get(key);
    if (!cur) { heads.set(key, r); continue; }
    const sameOwner = e.ownerCommit === cur.entry.ownerCommit;
    const sameFrom = r.from && cur.from && r.from.toLowerCase() === cur.from.toLowerCase();
    if (sameOwner && sameFrom && e.supersedes === cur.txHash) { heads.set(key, r); continue; }
    if (!sameOwner) {
      const a = avg(r.txHash), b = avg(cur.txHash);
      if (a.n >= minGraders && a.avg >= b.avg + minGradeLead) heads.set(key, r);
    }
  }
  const out = {};
  for (const [key, r] of heads) {
    out[key] = { txHash: r.txHash, entry: r.entry, follows: follows[r.txHash] || [], grade: avg(r.txHash) };
  }
  return out;
}
