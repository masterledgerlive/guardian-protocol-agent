/**
 * Canonical input loader — bytes + identity hash.
 */
import { readFileSync } from "node:fs";
import { sha256Hex } from "./hashing.js";

export function loadCanonicalFromBuffer(buffer, { objectId = "canonical", label = "buffer" } = {}) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  return {
    objectId,
    label,
    bytes,
    byteLength: bytes.length,
    sha256: sha256Hex(bytes),
  };
}

export function loadCanonicalFromFile(path, opts = {}) {
  const bytes = readFileSync(path);
  return loadCanonicalFromBuffer(bytes, {
    objectId: opts.objectId ?? path,
    label: opts.label ?? path,
  });
}
