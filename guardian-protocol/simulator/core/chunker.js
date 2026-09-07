/**
 * Fixed-size chunker with per-chunk SHA-256 commitments.
 */
import { sha256Hex } from "./hashing.js";

export function chunkBytes(bytes, chunkSize) {
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new Error(`chunkSize must be a positive integer, got ${chunkSize}`);
  }
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const chunks = [];
  for (let offset = 0; offset < buf.length; offset += chunkSize) {
    const data = buf.subarray(offset, Math.min(offset + chunkSize, buf.length));
    chunks.push({
      index: chunks.length,
      offset,
      length: data.length,
      sha256: sha256Hex(data),
      data: Buffer.from(data),
    });
  }
  return chunks;
}

export function merkleRootFromChunkHashes(chunkHashes) {
  if (chunkHashes.length === 0) return sha256Hex(Buffer.alloc(0));
  let level = chunkHashes.map((h) => h.toLowerCase());
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = level[i + 1] ?? left;
      next.push(sha256Hex(Buffer.from(left + right, "utf8")));
    }
    level = next;
  }
  return level[0];
}
