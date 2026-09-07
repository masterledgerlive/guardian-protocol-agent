/**
 * Integrity verifier — bit-for-bit reconstruction check.
 */
import { sha256Hex } from "../core/hashing.js";

export function reconstructFromChunks(chunks) {
  const ordered = [...chunks].sort((a, b) => a.index - b.index);
  return Buffer.concat(ordered.map((c) => c.data));
}

export function verifyReconstruction(canonicalBytes, reconstructedBytes) {
  const inputHash = sha256Hex(canonicalBytes);
  const outputHash = sha256Hex(reconstructedBytes);
  const exact =
    canonicalBytes.length === reconstructedBytes.length &&
    Buffer.compare(canonicalBytes, reconstructedBytes) === 0;
  return {
    reconstruction: exact ? "PASS" : "FAIL",
    exact_match: exact,
    input_sha256: inputHash,
    output_sha256: outputHash,
    input_bytes: canonicalBytes.length,
    output_bytes: reconstructedBytes.length,
  };
}
