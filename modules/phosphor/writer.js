/**
 * Writer — squash, snark-seal, optional lock, IPFS outlet, injector wires.
 */

import { buildWires, sha256Hex, squash } from "./codec.js";
import { defaultStateDir, saveObject } from "./chain-store.js";
import { ipfsAdd } from "./ipfs-outlet.js";
import { lockBytes, openKeyMeta, displayOpenKey } from "./keys.js";
import { sealSnark } from "./snark.js";

function guessMime(name, hint) {
  const given = String(hint || "").trim().toLowerCase();
  if (given.includes("/")) return given;
  const lower = String(name || "").toLowerCase();
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".ogg")) return "audio/ogg";
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".js") || lower.endsWith(".mjs")) return "text/javascript";
  if (lower.endsWith(".html")) return "text/html";
  if (lower.endsWith(".md") || lower.endsWith(".txt") || lower.endsWith(".sol")) return "text/plain";
  return "application/octet-stream";
}

function safeName(name) {
  const cleaned = String(name || "blob.bin").trim().replace(/[^\w./ -]+/g, "_").slice(0, 120);
  return cleaned || "blob.bin";
}

export async function writeBytes({
  bytes,
  name = "blob.bin",
  mime,
  lockKey = "",
  stateDir = defaultStateDir(),
  tryIpfs = true,
  timestamp = new Date().toISOString(),
} = {}) {
  const raw = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  if (!raw.length) throw new Error("empty file");
  const fileName = safeName(name);
  const crushed = squash(raw);
  const locked = String(lockKey || "").length > 0;
  let stored = crushed.bytes;
  let lock = null;
  let keyMode = "open";
  let keyMeta = null;
  if (locked) {
    const wrapped = lockBytes(crushed.bytes, lockKey);
    stored = wrapped.bytes;
    lock = wrapped.lock;
    keyMode = "lock";
    keyMeta = "lock:aes-256-gcm";
  }
  const payloadHash = sha256Hex(stored);
  if (!locked) keyMeta = openKeyMeta(fileName, payloadHash);
  const draft = {
    version: 1,
    magic: "§PHOSPHOR§",
    encoder: crushed.encoder,
    name: fileName,
    mime: guessMime(fileName, mime),
    rawBytes: raw.length,
    rawHash: sha256Hex(raw),
    payloadBytes: stored.length,
    payloadHash,
    keyMode,
    keyMeta,
    lock,
    timestamp,
  };
  const snark = sealSnark(draft);
  let ipfs = { ok: false, outlet: "skipped", cid: null, loc: null, reason: "ipfs outlet not requested" };
  if (tryIpfs) ipfs = await ipfsAdd(stored);
  const header = {
    ...draft,
    snark,
    ipfs,
    chain: {
      system: "phosphor-injector-cas-v1",
      role: "new-ipfs",
      status: "availability",
      location: null,
      basescan: null,
      note: "Injector wires are the store. location stays empty until a real Base tx is sealed.",
    },
    neverInventHashes: true,
  };
  header.chain.packets = 0;
  let finalWires = [];
  for (let attempt = 0; attempt < 4; attempt++) {
    finalWires = buildWires(snark.commit, header, stored);
    if (header.chain.packets === finalWires.length) break;
    header.chain.packets = finalWires.length;
  }
  saveObject(stateDir, { commit: snark.commit, header, wires: finalWires });
  const ratio = raw.length ? stored.length / raw.length : 1;
  const trace = [
    "C:\\PHOSPHOR> WRITE " + fileName,
    "raw " + raw.length + " bytes  sha " + draft.rawHash.slice(0, 12),
    "squash " + crushed.encoder + "  " + raw.length + " → " + crushed.bytes.length +
      "  (" + ratio.toFixed(3) + " of raw, stored " + stored.length + ")",
    "snark " + snark.short,
    "key " + (keyMode === "open" ? displayOpenKey(keyMeta) : "LOCK aes-256-gcm (passphrase stays off-header)"),
    "wires " + finalWires.length + " × ≤720B  injector CAS",
    ipfs.ok ? "ipfs outlet " + ipfs.loc : "ipfs outlet STANDBY" + (ipfs.reason ? " — " + ipfs.reason : ""),
    "chain AVAILABILITY — no sealed loc",
    "commit " + snark.commit,
  ];
  return { ok: true, commit: snark.commit, header, wires: finalWires, trace, ipfs, snark };
}
