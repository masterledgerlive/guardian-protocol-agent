/**
 * Content hashes, Merkle last-root, short §GRAFT§ tags.
 * Never invents transaction hashes.
 */

import { createHash } from "node:crypto";
import { SHORT_TAG_PREFIX } from "./config.js";

export function sha256hex(input) {
  return createHash("sha256").update(input == null ? "" : String(input)).digest("hex");
}

export function sha256bytes(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

export function shortId(hash, len = 8) {
  const h = String(hash || "").replace(/^0x/i, "");
  return h.slice(0, len);
}

/**
 * Sorted pairwise Merkle root. Empty set hashes a typed empty marker so the
 * last-root is always defined and never a fake chain tx.
 */
export function merkleRoot(hashes = []) {
  let layer = [...hashes]
    .map((h) => String(h || "").replace(/^0x/i, "").toLowerCase())
    .filter(Boolean)
    .sort();
  if (layer.length === 0) return sha256hex("GRAFT:EMPTY");
  while (layer.length > 1) {
    const next = [];
    for (let i = 0; i < layer.length; i += 2) {
      const a = layer[i];
      const b = layer[i + 1] ?? a;
      next.push(sha256hex(a + b));
    }
    layer = next;
  }
  return layer[0];
}

/** Inclusion proof for one leaf among the same sorted set used by merkleRoot. */
export function merkleProof(hashes = [], leaf) {
  const want = String(leaf || "").replace(/^0x/i, "").toLowerCase();
  let layer = [...hashes]
    .map((h) => String(h || "").replace(/^0x/i, "").toLowerCase())
    .filter(Boolean)
    .sort();
  const idx0 = layer.indexOf(want);
  if (idx0 < 0) return { ok: false, leaf: want, proof: [], root: merkleRoot(hashes) };
  const proof = [];
  let index = idx0;
  while (layer.length > 1) {
    const next = [];
    for (let i = 0; i < layer.length; i += 2) {
      const a = layer[i];
      const b = layer[i + 1] ?? a;
      if (i === index || i + 1 === index) {
        const sibling = i === index ? b : a;
        const position = i === index ? "right" : "left";
        proof.push({ sibling, position });
        index = next.length;
      }
      next.push(sha256hex(a + b));
    }
    layer = next;
  }
  return { ok: true, leaf: want, proof, root: layer[0] };
}

export function verifyMerkleProof({ leaf, proof = [], root }) {
  let acc = String(leaf || "").replace(/^0x/i, "").toLowerCase();
  for (const step of proof) {
    const sib = String(step?.sibling || "").toLowerCase();
    acc = step?.position === "left" ? sha256hex(sib + acc) : sha256hex(acc + sib);
  }
  return acc === String(root || "").replace(/^0x/i, "").toLowerCase();
}

export function formatShortTag({ short, root, snap } = {}) {
  const id = shortId(short || "", 8) || "00000000";
  const r = shortId(root || "", 8);
  const s = snap == null || snap === "" ? "" : ` snap=${snap}`;
  return `${SHORT_TAG_PREFIX} ${id} root=${r}${s}`;
}
