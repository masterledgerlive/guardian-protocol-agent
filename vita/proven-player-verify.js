/**
 * Proven Player — chunk-binding verifier.
 *
 * Runs in Node and in the browser (global crypto.subtle). The player calls
 * this before any AV2 byte is handed to a decoder.
 *
 * Statement (chunk-binding-v1)
 *   The 448-byte envelope is the public receipt. Its SHA-256 is the binding.
 *   Playback unlocks only when:
 *     1. SHA-256(envelope) equals the registry binding
 *     2. SHA-256(AV2 IVF bytes) equals the digest inside the envelope
 *     3. the byte-slice Merkle root of those IVF bytes equals sliceRoot
 *     4. the Groth16 slot is still unwired (all zeros, flag clear)
 *
 * This is not a proof that AVM executed. A Groth16 of the AV2 encoder is not
 * viable. The 256-byte slot stays reserved. A nonzero slot refuses to unlock.
 */

export const ENVELOPE_BYTES = 448;
export const SLICE_BYTES = 4096;
export const GROTH16_SLOT_OFFSET = 176;
export const GROTH16_SLOT_BYTES = 256;
export const PROOF_CLASS = "chunk-binding-v1";

const OFF = Object.freeze({
  magic: 0,
  version: 4,
  flags: 5,
  chunkIndex: 6,
  sliceCount: 8,
  width: 10,
  height: 12,
  durationMs: 14,
  streamId: 16,
  sourceDigest: 48,
  av1Digest: 80,
  sliceRoot: 112,
  encoderBuild: 144,
  groth16: 176,
  prevBinding: 432,
});

function toU8(data) {
  if (data instanceof Uint8Array) return data;
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(data)) {
    return new Uint8Array(data);
  }
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  throw new Error("expected bytes");
}

export function hexToBytes(hex) {
  const h = String(hex || "").replace(/^0x/i, "").trim();
  if (h.length % 2 !== 0) throw new Error("odd hex");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToHex(bytes) {
  const u8 = toU8(bytes);
  let s = "";
  for (let i = 0; i < u8.length; i++) s += u8[i].toString(16).padStart(2, "0");
  return s;
}

export function bytesEqual(a, b) {
  const x = toU8(a);
  const y = toU8(b);
  if (x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

export async function sha256Bytes(data) {
  const u8 = toU8(data);
  const digest = await crypto.subtle.digest("SHA-256", u8);
  return new Uint8Array(digest);
}

export async function sliceLeaves(av1Bytes) {
  const u8 = toU8(av1Bytes);
  const leaves = [];
  if (u8.length === 0) {
    leaves.push(await sha256Bytes(u8));
    return leaves;
  }
  for (let o = 0; o < u8.length; o += SLICE_BYTES) {
    const end = Math.min(u8.length, o + SLICE_BYTES);
    leaves.push(await sha256Bytes(u8.subarray(o, end)));
  }
  return leaves;
}

/** Binary Merkle fold. An odd tail is promoted, not duplicated. */
export async function merkleRoot(leaves) {
  if (!leaves.length) return sha256Bytes(new Uint8Array(0));
  let level = leaves.map((leaf) => toU8(leaf));
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 === level.length) {
        next.push(level[i]);
        continue;
      }
      const cat = new Uint8Array(64);
      cat.set(level[i], 0);
      cat.set(level[i + 1], 32);
      next.push(await sha256Bytes(cat));
    }
    level = next;
  }
  return level[0];
}

function u16(view, off) {
  return view.getUint16(off);
}

function slice32(bytes, off) {
  return bytes.slice(off, off + 32);
}

export function groth16SlotClear(envelope) {
  const env = toU8(envelope);
  for (let i = 0; i < GROTH16_SLOT_BYTES; i++) {
    if (env[GROTH16_SLOT_OFFSET + i] !== 0) return false;
  }
  return true;
}

export function parseEnvelope(envelope) {
  const env = toU8(envelope);
  if (env.length !== ENVELOPE_BYTES) {
    return { ok: false, reason: "envelope-length" };
  }
  const view = new DataView(env.buffer, env.byteOffset, env.byteLength);
  const magic = String.fromCharCode(env[0], env[1], env[2], env[3]);
  const flags = env[OFF.flags];
  return {
    ok: true,
    magic,
    version: env[OFF.version],
    flags,
    groth16Wired: (flags & 0x01) === 0x01,
    chunkIndex: u16(view, OFF.chunkIndex),
    sliceCount: u16(view, OFF.sliceCount),
    width: u16(view, OFF.width),
    height: u16(view, OFF.height),
    durationMs: u16(view, OFF.durationMs),
    streamId: slice32(env, OFF.streamId),
    sourceDigest: slice32(env, OFF.sourceDigest),
    av1Digest: slice32(env, OFF.av1Digest),
    sliceRoot: slice32(env, OFF.sliceRoot),
    encoderBuild: slice32(env, OFF.encoderBuild),
    prevBinding: env.slice(OFF.prevBinding, OFF.prevBinding + 16),
  };
}

/**
 * Unlock gate. Returns ok only when the AV2 IVF bytes match the envelope and
 * the Groth16 slot has not been stuffed with an unverifiable proof.
 * `bitstream` is the AV2 container. `av1Bytes` is the same argument from the
 * first seal, still accepted so older callers keep working.
 */
export async function verifyChunkUnlock({
  envelope,
  av1Bytes = null,
  bitstream = null,
  binding,
  prevBinding = null,
} = {}) {
  let env;
  let media;
  let bind;
  const mediaIn = bitstream != null ? bitstream : av1Bytes;
  try {
    env = typeof envelope === "string" ? hexToBytes(envelope) : toU8(envelope);
    media = typeof mediaIn === "string" ? hexToBytes(mediaIn) : toU8(mediaIn);
    bind = typeof binding === "string" ? hexToBytes(binding) : toU8(binding);
  } catch (e) {
    return { ok: false, reason: "bytes", detail: e.message || String(e) };
  }
  if (env.length !== ENVELOPE_BYTES) return { ok: false, reason: "envelope-length" };
  if (bind.length !== 32) return { ok: false, reason: "binding-length" };

  const gotBind = await sha256Bytes(env);
  if (!bytesEqual(gotBind, bind)) return { ok: false, reason: "binding-mismatch" };

  const parsed = parseEnvelope(env);
  if (parsed.magic !== "ZKAV") return { ok: false, reason: "magic" };
  if (parsed.version !== 1) return { ok: false, reason: "version" };
  if (parsed.groth16Wired || !groth16SlotClear(env)) {
    return { ok: false, reason: "groth16-unwired", parsed };
  }

  const mediaDigest = await sha256Bytes(media);
  if (!bytesEqual(mediaDigest, parsed.av1Digest)) return { ok: false, reason: "bitstream-digest", parsed };

  const leaves = await sliceLeaves(media);
  if (leaves.length !== parsed.sliceCount) return { ok: false, reason: "slice-count", parsed };
  const root = await merkleRoot(leaves);
  if (!bytesEqual(root, parsed.sliceRoot)) return { ok: false, reason: "slice-root", parsed };

  if (prevBinding != null) {
    const prev = typeof prevBinding === "string" ? hexToBytes(prevBinding) : toU8(prevBinding);
    const expect = prev.length === 0 ? new Uint8Array(16) : prev.slice(0, 16);
    if (!bytesEqual(parsed.prevBinding, expect)) {
      return { ok: false, reason: "leader-link", parsed };
    }
  }

  return {
    ok: true,
    reason: "unlocked",
    proofClass: PROOF_CLASS,
    parsed: {
      chunkIndex: parsed.chunkIndex,
      sliceCount: parsed.sliceCount,
      width: parsed.width,
      height: parsed.height,
      durationMs: parsed.durationMs,
      streamId: bytesToHex(parsed.streamId),
      sourceDigest: bytesToHex(parsed.sourceDigest),
      mediaDigest: bytesToHex(parsed.av1Digest),
      av1Digest: bytesToHex(parsed.av1Digest),
      sliceRoot: bytesToHex(parsed.sliceRoot),
      encoderBuild: bytesToHex(parsed.encoderBuild),
    },
  };
}

export const ENVELOPE_LAYOUT = Object.freeze({ ...OFF, bytes: ENVELOPE_BYTES });
