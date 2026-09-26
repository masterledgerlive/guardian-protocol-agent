/**
 * Reader — verify snark commit, unwrap open or lock key, expand, check raw hash.
 * Bytes come back from injector wires. IPFS cat is only a fallback outlet.
 */

import {
  assertRecallKey,
  loadReceipt,
  plainFromStored,
  walkBlockFile,
  walkBlocks,
} from "./blocks.js";
import { computeCommit, expand, objectFromWires, sha256Hex } from "./codec.js";
import { defaultStateDir, loadObject } from "./chain-store.js";
import { homeSeat } from "./home.js";
import { ipfsCat } from "./ipfs-outlet.js";
import { assertOpenKey, unlockBytes } from "./keys.js";

function unwrapStored(header, stored, lockKey) {
  let crushed = stored;
  let openKey = null;
  if (header.keyMode === "open") {
    openKey = assertOpenKey(header);
  } else if (header.keyMode === "lock") {
    crushed = unlockBytes(stored, header.lock, lockKey);
  } else {
    throw new Error("unknown key mode");
  }
  const raw = expand(header.encoder, crushed);
  if (sha256Hex(raw) !== header.rawHash) throw new Error("raw hash mismatch");
  if (raw.length !== header.rawBytes) throw new Error("raw length mismatch");
  return { raw, openKey };
}

export function readFromWires(wires, { lockKey = "" } = {}) {
  const object = objectFromWires(wires);
  const opened = unwrapStored(object.header, object.stored, lockKey);
  return { ...opened, header: object.header, commit: object.commit, stored: object.stored };
}

export async function readBytes({
  commit,
  lockKey = "",
  stateDir = defaultStateDir(),
} = {}) {
  const object = loadObject(stateDir, commit);
  const opened = unwrapStored(object.header, object.stored, lockKey);
  return {
    ok: true,
    ...opened,
    header: object.header,
    commit: object.commit,
    from: "injector-wires",
    chainStatus: object.header.chain?.status || "availability",
    location: object.header.chain?.location || null,
  };
}

/**
 * Recompute the snark equality from the filed blocks.
 * The response is the equation. It does not return the file bytes.
 */
export function proveFromReceipt(stateDir, commit, key) {
  const object = loadObject(stateDir, commit);
  const receipt = loadReceipt(stateDir, commit);
  const header = object.header;
  assertRecallKey(header, key);
  const stored = receipt.blocksExternal
    ? walkBlockFile(stateDir, commit, receipt)
    : walkBlocks(receipt.blocks);
  const raw = plainFromStored(header, stored, key);
  const joinedHash = sha256Hex(stored);
  const recallHash = sha256Hex(raw);
  const recomputed = computeCommit(header);
  const equal = joinedHash === header.payloadHash
    && recallHash === header.rawHash
    && raw.length === header.rawBytes
    && recomputed === header.snark?.commit
    && receipt.recalled === true
    && receipt.proof === "SYSTEM_INJECTED";
  if (!equal) throw new Error("inject proof mismatch");
  const home = receipt.home || homeSeat();
  const lines = [
    "joined " + joinedHash + " = payloadHash",
    "recall " + recallHash + " = rawHash",
    "snark.commit " + recomputed + " = sha256(sha256(headerCore) || payloadHash)",
    "EQUAL " + raw.length + " bytes  filing " + receipt.filingLoc,
    "HOME " + home.symbol + " " + home.address + " lane " + home.lane,
    "base location empty",
  ];
  return {
    ok: true,
    equal: true,
    proof: "SYSTEM_INJECTED",
    bytes: raw.length,
    name: header.name,
    mime: header.mime,
    filingLoc: receipt.filingLoc,
    starkRoot: receipt.starkRoot,
    blockCount: receipt.blockCount,
    baseLocation: null,
    home,
    keyMode: header.keyMode,
    equation: {
      joinedHash,
      payloadHash: header.payloadHash,
      recallHash,
      rawHash: header.rawHash,
      snarkCommit: header.snark.commit,
      recomputedCommit: recomputed,
      equal: true,
      bytes: raw.length,
      text: lines.join("\n"),
      lines,
    },
  };
}

export async function readBytesWithIpfsFallback({
  commit,
  lockKey = "",
  stateDir = defaultStateDir(),
  headerHint = null,
} = {}) {
  try {
    return await readBytes({ commit, lockKey, stateDir });
  } catch (error) {
    const cid = headerHint?.ipfs?.cid;
    if (!cid) throw error;
    const stored = await ipfsCat(cid);
    if (!stored) throw error;
    if (sha256Hex(stored) !== headerHint.payloadHash) throw new Error("ipfs outlet hash mismatch");
    const opened = unwrapStored(headerHint, stored, lockKey);
    return { ok: true, ...opened, header: headerHint, commit, from: "ipfs-outlet", location: null };
  }
}
