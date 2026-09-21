/**
 * ZK-wrapper — lock & key for grouped video/audio cells.
 *
 * zk-SNARKs here compress STATE validation, not pixels. Each grouped block
 * (cell) gets a constant-size ~448-byte key. The decoder wrapper will not
 * hand bytes to libVLC / HTML5 media until the key verifies.
 *
 * This module is the honest VITA-shaped verifier: SHA-256 cell commit +
 * fixed-size key + optional on-chain loc. Circom/Groth16 live beside it as
 * the circuit target — we never invent a tx hash or claim pixel SNARKs.
 */

import { createHash } from "node:crypto";
import { FORMULA_ID } from "../../mainframe.js";
import { identifyHash } from "../identify.js";
import { classProofLoc } from "../filer-registry.js";

export const ZK_WRAPPER_ID = "vita-zk-wrapper-v1";
export const ZK_WRAPPER_MAGIC = "§VITAZKWRAP§";
export const ZK_PROOF_BYTES = 448;
export const CELL_LABEL = "cell";

function sha256Buf(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function sha256Text(text) {
  return sha256Buf(Buffer.from(String(text || ""), "utf8"));
}

/** Constant-size key: cellHash || prevHash || origin || seq || magic + pad. */
export function makeCellKey({
  cellHash,
  prevHash = "00".repeat(32),
  origin = classProofLoc().location.slice(2),
  chunkId = 0,
  sequence = 0,
} = {}) {
  const hash = String(cellHash || "").replace(/^0x/i, "").toLowerCase().padEnd(64, "0").slice(0, 64);
  const prev = String(prevHash || "").replace(/^0x/i, "").toLowerCase().padEnd(64, "0").slice(0, 64);
  const orig = String(origin || "").replace(/^0x/i, "").toLowerCase().padEnd(64, "0").slice(0, 64);
  const header = Buffer.from(
    ZK_WRAPPER_MAGIC + "|id=" + ZK_WRAPPER_ID + "|chunk=" + chunkId + "|seq=" + sequence + "|bytes=" + ZK_PROOF_BYTES + "§",
    "utf8",
  );
  const body = Buffer.concat([
    Buffer.from(hash, "hex"),
    Buffer.from(prev, "hex"),
    Buffer.from(orig, "hex"),
    header,
  ]);
  const key = Buffer.alloc(ZK_PROOF_BYTES, 0);
  body.copy(key, 0, 0, Math.min(body.length, ZK_PROOF_BYTES));
  return {
    bytes: ZK_PROOF_BYTES,
    keyHex: key.toString("hex"),
    cellHash: hash,
    prevHash: prev,
    origin: orig,
    chunkId,
    sequence,
  };
}

export function parseCellKey(keyHex) {
  const hex = String(keyHex || "").replace(/^0x/i, "").toLowerCase();
  if (hex.length !== ZK_PROOF_BYTES * 2) {
    return { ok: false, reason: "key must be " + ZK_PROOF_BYTES + " bytes" };
  }
  const buf = Buffer.from(hex, "hex");
  const cellHash = buf.subarray(0, 32).toString("hex");
  const prevHash = buf.subarray(32, 64).toString("hex");
  const origin = buf.subarray(64, 96).toString("hex");
  const rest = buf.subarray(96).toString("utf8");
  const magicOk = rest.includes(ZK_WRAPPER_MAGIC);
  return { ok: magicOk, cellHash, prevHash, origin, magicOk, bytes: ZK_PROOF_BYTES };
}

/**
 * Lock: cell stays closed until key matches sha256(payload) and size=448.
 * Fail-closed — drop the chunk, never hand it to the decoder.
 */
export function verifyCell({ payload, keyHex, expectHash = null, prevHash = null } = {}) {
  const started = process.hrtime.bigint();
  if (payload == null) {
    return { ok: false, open: false, reason: "empty cell", dropped: true };
  }
  const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), "utf8");
  const cellHash = sha256Buf(buf);
  const parsed = parseCellKey(keyHex);
  if (!parsed.ok) {
    return { ok: false, open: false, reason: parsed.reason || "bad key", dropped: true, cellHash };
  }
  if (parsed.cellHash !== cellHash) {
    return { ok: false, open: false, reason: "key/cell hash mismatch — lock stays shut", dropped: true, cellHash };
  }
  if (expectHash && String(expectHash).replace(/^0x/i, "").toLowerCase() !== cellHash) {
    return { ok: false, open: false, reason: "registry hash mismatch", dropped: true, cellHash };
  }
  if (prevHash) {
    const prev = String(prevHash).replace(/^0x/i, "").toLowerCase().padEnd(64, "0").slice(0, 64);
    if (parsed.prevHash !== prev) {
      return { ok: false, open: false, reason: "sequence prev-hash mismatch", dropped: true, cellHash };
    }
  }
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  return {
    ok: true,
    open: true,
    dropped: false,
    cellHash,
    identify: identifyHash("0x" + cellHash),
    verifyMs: Math.round(ms * 1000) / 1000,
    formula: FORMULA_ID,
    neverInventHashes: true,
  };
}

export function cellFromBytes(bytes, { chunkId = 0, prevHash = "00".repeat(32), sequence = 0 } = {}) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const cellHash = sha256Buf(buf);
  const key = makeCellKey({ cellHash, prevHash, chunkId, sequence });
  return {
    chunkId,
    sequence,
    bytes: buf.length,
    cellHash,
    keyHex: key.keyHex,
    keyBytes: ZK_PROOF_BYTES,
    prevHash: key.prevHash,
    payloadB64: buf.toString("base64"),
  };
}

/** Split a buffer into cells and daisy-chain prev hashes (follow-the-leader). */
export function segmentIntoCells(bytes, { cellBytes = 4096, originChunk = 0 } = {}) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const cells = [];
  let prev = "00".repeat(32);
  let off = 0;
  let n = 0;
  while (off < buf.length) {
    const slice = buf.subarray(off, Math.min(off + cellBytes, buf.length));
    const cell = cellFromBytes(slice, { chunkId: originChunk + n + 1, prevHash: prev, sequence: n });
    cells.push(cell);
    prev = cell.cellHash;
    off += slice.length;
    n += 1;
  }
  return {
    ok: true,
    id: ZK_WRAPPER_ID,
    magic: ZK_WRAPPER_MAGIC,
    cellCount: cells.length,
    totalBytes: buf.length,
    cellBytes,
    keyBytes: ZK_PROOF_BYTES,
    cells,
    formula: FORMULA_ID,
    neverInventHashes: true,
  };
}

export { sha256Buf, sha256Text };
