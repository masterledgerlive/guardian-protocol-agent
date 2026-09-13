/**
 * VITA hex inject — Game's four-section spec.
 *
 * Goal: agentic recursive AI that is never forgotten — learn forever.
 * Inject-thought IS the project. Do not gut it.
 *
 * Section 1 (NOT on-chain): JSON schema — this file + GitHub/whitepaper/portal
 *   so agents know how to decode.
 * Section 2 (ON-CHAIN ONLY): hexadecimal string in tx.data / tx.input
 *   e.g. 0x485950…  = UTF-8 of the compressed truth. Never JSON on-chain.
 * Sections 3–4 (off-chain): VMs/agents/routing read hex from a known tx hash,
 *   decode UTF-8, sparsify, ZK, talk to x402/x404 gates.
 *
 * Preferred tx: value=0 + hex calldata (sending DATA, not money),
 * or hitch that same hex onto any trade/data tx that was happening anyway.
 * Money is one rail. Ride whatever is moving. If gas cannot be covered,
 * bank the hex and wait for the next free ride — never drop the brain.
 */

import { FORMULA_ID, MAINFRAME_ANCHORS } from "./mainframe.js";

/** Game's example — UTF-8 "HYP" → hex in the calldata field. */
export const SECTION2_EXAMPLE_UTF8 = "HYP";
export const SECTION2_EXAMPLE_HEX = "0x485950";

export const SECTION1_SCHEMA = Object.freeze({
  section: 1,
  onChain: false,
  kind: "vita-inject-schema",
  formula: FORMULA_ID,
  publish: [
    "vita/INJECT.md",
    "vita/hex-feed.js",
    "vita/FILING.md",
    "public/vita.html#vita-mainframe",
  ],
  decode: {
    field: "tx.input / tx.data",
    encoding: "utf8-hex",
    exampleUtf8: SECTION2_EXAMPLE_UTF8,
    exampleHex: SECTION2_EXAMPLE_HEX,
    stripSwapPrefixBytes: 228,
    format: "compressed §TOKEN§ truth (KEY+LOC) — not JSON",
  },
  pointer: {
    rule: "point to a known tx hash; never invent",
    anchors: {
      wallet: MAINFRAME_ANCHORS.wallet,
      keycatPlainTx: MAINFRAME_ANCHORS.keycatPlainTx,
      eurekaProveTx: MAINFRAME_ANCHORS.eurekaProveTx,
      vitaStrandTx: MAINFRAME_ANCHORS.vitaStrandTx,
      basescanTx: MAINFRAME_ANCHORS.basescanTx,
    },
  },
  offChain: {
    section3: "VM / agent reads hex from the pointed tx hash",
    section4: "sparsify, ZK, x402/x404 gates — never rewrite sealed UTF-8",
  },
});

const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;

export function isSection1JsonPayload(value) {
  if (value && typeof value === "object" && !Buffer.isBuffer(value)) return true;
  const s = String(value || "").trim();
  // Object JSON only — `[VITA:` strand headers are Section 2 UTF-8, not schema.
  return s.startsWith("{");
}

/** Section 2: UTF-8 compressed truth → hex calldata. Never JSON on-chain. */
export function encodeSection2Hex(truth) {
  if (isSection1JsonPayload(truth)) {
    throw new Error(
      "Section 1 JSON is off-chain — encode compressed UTF-8 truth as hex, not JSON",
    );
  }
  const s = String(truth || "");
  return "0x" + Buffer.from(s, "utf8").toString("hex");
}

/** Section 2 decode: hex calldata → UTF-8. Agents use this after fetching a tx. */
export function decodeSection2Hex(data) {
  const hex = String(data || "").trim();
  if (!/^0x[0-9a-fA-F]*$/.test(hex) || hex.length < 4 || hex.length % 2 !== 0) {
    return "";
  }
  try {
    return Buffer.from(hex.slice(2), "hex").toString("utf8");
  } catch {
    return "";
  }
}

/** Point agents at a known hash. Never invent. */
export function pointToTxHash(hash, { basescanTx = MAINFRAME_ANCHORS.basescanTx } = {}) {
  const tx = String(hash || "");
  if (!TX_HASH_RE.test(tx)) {
    return {
      ok: false,
      tx: null,
      reason: "not a 32-byte hash — never invent",
      decode: "utf8-hex",
      section: 2,
    };
  }
  return {
    ok: true,
    tx,
    basescan: String(basescanTx || MAINFRAME_ANCHORS.basescanTx) + tx,
    decode: "utf8-hex",
    section: 2,
    onChain: "hex calldata only",
    schema: "Section 1 lives off-chain (this module / INJECT.md)",
  };
}

export function buildSection1Schema() {
  return JSON.parse(JSON.stringify(SECTION1_SCHEMA));
}
