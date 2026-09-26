/**
 * Per-file SNARK squash.
 * This is a public content-commitment (same honesty class as GRAFT snark-short).
 * Groth16 stays unwired. The short is the proof object the reader recomputes.
 */

import { computeCommit } from "./codec.js";

export const SNARK_CLASS = "phosphor-snark-squash-v1";
export const SNARK_MAGIC = "§PHOSSNARK§";

export function snarkShort(commit, name, payloadBytes) {
  const safe = String(name || "blob").replace(/[^\w./ -]+/g, "_").slice(0, 48);
  return `${SNARK_MAGIC}${commit.slice(0, 12)}|${safe}|B=${payloadBytes}`;
}

export function sealSnark(header) {
  const commit = computeCommit(header);
  return {
    zkClass: SNARK_CLASS,
    commit,
    short: snarkShort(commit, header.name, header.payloadBytes),
    privateWitness: header.keyMode === "lock",
    instantUnwrap: header.keyMode === "open",
    groth16Wired: false,
    circuitBackend: "content-commitment",
  };
}
