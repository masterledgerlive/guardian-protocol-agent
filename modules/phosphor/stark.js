/**
 * Library STARK-class fold.
 * Every file snark commit is a leaf. The library root is one proof.
 * Winterfell / StarkWare provers are not linked — circuitWired stays false.
 * Verification recomputes the merkle fold. A fake Groth16 blob is not emitted.
 */

import { sha256Hex } from "./codec.js";

export const STARK_SYSTEM = "phosphor-stark-fold-v1";

function leaf(name, snarkCommit) {
  return sha256Hex(String(name) + ":" + String(snarkCommit));
}

export function merkleRoot(leaves) {
  let layer = leaves.slice();
  if (!layer.length) layer = [sha256Hex("PHOSPHOR:EMPTY-LIB")];
  while (layer.length > 1) {
    const next = [];
    for (let i = 0; i < layer.length; i += 2) {
      const left = layer[i];
      const right = layer[i + 1] ?? left;
      next.push(sha256Hex(left + right));
    }
    layer = next;
  }
  return layer[0];
}

export function foldStark(files = []) {
  const rows = files
    .map((file) => ({
      name: String(file.name),
      snarkCommit: String(file.snarkCommit),
      rawHash: file.rawHash || null,
      commit: file.commit || file.snarkCommit,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const leaves = rows.map((row) => leaf(row.name, row.snarkCommit));
  const root = merkleRoot(leaves);
  return {
    system: STARK_SYSTEM,
    circuitWired: false,
    groth16Wired: false,
    winterfellWired: false,
    root,
    fileCount: rows.length,
    files: rows,
    publicInputs: {
      root,
      fileCount: rows.length,
    },
    note: "Merkle fold of per-file snark commits. Not a fabricated Winterfell proof.",
  };
}

export function verifyStark(stark, files) {
  if (!stark || stark.system !== STARK_SYSTEM) {
    throw new Error("stark system mismatch");
  }
  const folded = foldStark(files || stark.files || []);
  if (folded.root !== stark.root) throw new Error("stark root mismatch");
  if (folded.fileCount !== stark.fileCount) throw new Error("stark file count mismatch");
  return { ok: true, root: folded.root, circuitWired: false };
}
