/**
 * Shared crypto helpers for Guardian L1 simulator.
 * Simulation only — not a production security module.
 */
import { createHash } from "node:crypto";

export function sha256Hex(data) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  return createHash("sha256").update(buf).digest("hex");
}

export function sha256Buffer(data) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  return createHash("sha256").update(buf).digest();
}

/** Stable JSON for hashing (sorted object keys, arrays preserve order). */
export function canonicalJson(value) {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object" && !(value instanceof Buffer)) {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = sortKeys(value[key]);
    }
    return out;
  }
  return value;
}

export function hashCanonical(value) {
  return sha256Hex(canonicalJson(value));
}
