/**
 * Reader — verify snark commit, unwrap open or lock key, expand, check raw hash.
 * Bytes come back from injector wires. IPFS cat is only a fallback outlet.
 */

import { expand, objectFromWires, sha256Hex } from "./codec.js";
import { defaultStateDir, loadObject } from "./chain-store.js";
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
