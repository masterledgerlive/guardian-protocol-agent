/**
 * VITA ROUTE REGISTRY (VRR) — on-chain "doors" for agentic AI.
 * ─────────────────────────────────────────────────────────────────────────────
 * On-chain = hex payload ONLY (binary calldata of a 0-ETH self-tx on Base).
 * JSON schema lives in docs/VITA_ROUTE_REGISTRY.md — never on chain.
 *
 * Wire format (v1):
 *   magic   3B  "VRR" (0x565252)
 *   version 1B  0x01
 *   kind    1B  0x01 DOOR | 0x02 GRADE
 *   flags   1B  reserved (0)
 *   fields  TLV*  tag(1B) len(1B, ≤255) value
 *   check   4B  sha256(magic..last field)[0:4]
 *
 * Wraps / reuses WAVE patterns (0-ETH self-tx, fetch calldata by tx hash,
 * sha256 answer-key compare). Mother brain + genesis files untouched.
 * Never invents hashes: verify() recomputes from chain + GitHub bytes.
 */

import { createHash } from "crypto";

export const VRR_MAGIC_HEX = "565252"; // "VRR"
export const VRR_VERSION = 1;
export const VRR_KIND = Object.freeze({ DOOR: 1, GRADE: 2 });
export const VRR_DEFAULT_REPO = "masterledgerlive/guardian-protocol-agent";
export const VRR_CHECK_BYTES = 4;

/** tag → [name, type]. Types: utf8 | b20 | b32 | u8 | u16 | result */
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
});
const NAME_TO_TAG = Object.fromEntries(
  Object.entries(VRR_TAGS).map(([t, [n]]) => [n, Number(t)])
);
const TAG_ORDER = Object.keys(VRR_TAGS).map(Number);

export const REQUIRED = Object.freeze({
  [VRR_KIND.DOOR]: ["doorId", "name", "commit", "codePath", "codeHash", "version"],
  [VRR_KIND.GRADE]: ["refDoor", "grade", "grader"],
});

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
    case "result": return { pass: b.readUInt16BE(0), total: b.readUInt16BE(2) };
    default: return "0x" + b.toString("hex");
  }
}

/** Encode an entry object → 0x calldata hex. */
export function encodeEntry(entry = {}) {
  const kind = entry.kind === "grade" || entry.kind === VRR_KIND.GRADE ? VRR_KIND.GRADE : VRR_KIND.DOOR;
  for (const k of REQUIRED[kind]) {
    if (entry[k] == null || entry[k] === "") throw new Error(`VRR: missing ${k}`);
  }
  const parts = [Buffer.from(VRR_MAGIC_HEX, "hex"), Buffer.from([VRR_VERSION, kind, 0])];
  for (const tag of TAG_ORDER) {
    const [name, type] = VRR_TAGS[tag];
    let v = entry[name];
    if (v == null) continue;
    if (name === "repo" && v === VRR_DEFAULT_REPO) continue; // default ⇒ omit
    const val = encodeValue(name, type, v);
    if (val.length > 255) throw new Error(`VRR: ${name} > 255 bytes`);
    parts.push(Buffer.from([tag, val.length]), val);
  }
  const body = Buffer.concat(parts);
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
  if (buf[3] !== VRR_VERSION) return { ok: false, error: `unsupported version ${buf[3]}` };
  const body = buf.subarray(0, buf.length - VRR_CHECK_BYTES);
  const check = buf.subarray(buf.length - VRR_CHECK_BYTES).toString("hex");
  if (sha256Hex(body).slice(0, VRR_CHECK_BYTES * 2) !== check) return { ok: false, error: "checksum mismatch" };
  const kind = buf[4];
  if (!REQUIRED[kind]) return { ok: false, error: `unknown kind ${kind}` };
  const entry = { kind: kind === VRR_KIND.GRADE ? "grade" : "door", repo: VRR_DEFAULT_REPO, unknownTags: [] };
  let i = 6;
  while (i < body.length) {
    if (i + 2 > body.length) return { ok: false, error: "truncated TLV" };
    const tag = body[i], len = body[i + 1];
    const val = body.subarray(i + 2, i + 2 + len);
    if (val.length !== len) return { ok: false, error: "truncated value" };
    const spec = VRR_TAGS[tag];
    if (spec) entry[spec[0]] = decodeValue(spec[1], val);
    else entry.unknownTags.push({ tag, hex: "0x" + val.toString("hex") }); // forward-compat
    i += 2 + len;
  }
  for (const k of REQUIRED[kind]) if (entry[k] == null) return { ok: false, error: `missing ${k}` };
  return { ok: true, entry, bytes: buf.length, checksum: check };
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
  const gh = dec.entry.kind === "door" ? await verifyDoorAgainstGithub(dec.entry, fetchImpl) : { ok: true };
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
