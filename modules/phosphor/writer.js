/**
 * Writer — squash, snark-seal, optional lock, IPFS outlet, injector wires.
 */

import {
  INLINE_BLOCK_MAX,
  autoBlockCount,
  packBlocks,
  packBlocksFile,
  plainFromStored,
  recallPlain,
  saveReceipt,
  walkBlockFile,
} from "./blocks.js";
import { buildWires, computeCommit, sha256Hex, squash } from "./codec.js";
import { defaultStateDir, saveObject, saveStored } from "./chain-store.js";
import { sealDirectory } from "./directory.js";
import { appendHomeFiling, homeSeat } from "./home.js";
import { ipfsAdd } from "./ipfs-outlet.js";
import { lockBytes, openKeyMeta, displayOpenKey } from "./keys.js";
import { sealSnark } from "./snark.js";

const WIRE_MAX = 512 * 1024;
const IPFS_MAX = 1024 * 1024;

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
  if (lower.endsWith(".route")) return "text/x-phosphong";
  if (lower.endsWith(".exe") || lower.endsWith(".msi") || lower.endsWith(".zip")) return "application/octet-stream";
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
  blockCount = 0,
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
  if (tryIpfs && raw.length <= IPFS_MAX && stored.length <= IPFS_MAX) {
    ipfs = await ipfsAdd(stored);
  } else if (tryIpfs) {
    ipfs = {
      ok: false,
      outlet: "standby",
      cid: null,
      loc: null,
      reason: "large file stays on the injector",
    };
  }
  const home = homeSeat();
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
      mode: "wires",
      home,
      note: "Injector wires are the store. location stays empty until a real Base tx is sealed.",
    },
    neverInventHashes: true,
  };
  header.chain.packets = 0;
  let finalWires = [];
  const wide = !blockCount && stored.length > WIRE_MAX;
  if (wide) {
    header.chain.mode = "stored-bin";
    header.chain.packets = 0;
    saveStored(stateDir, { commit: snark.commit, header, stored });
  } else {
    for (let attempt = 0; attempt < 4; attempt++) {
      finalWires = buildWires(snark.commit, header, stored);
      if (header.chain.packets === finalWires.length) break;
      header.chain.packets = finalWires.length;
    }
    saveObject(stateDir, { commit: snark.commit, header, wires: finalWires });
  }
  const plan = blockCount ? null : autoBlockCount(stored.length);
  const external = !blockCount && plan.count > INLINE_BLOCK_MAX;
  const packed = external
    ? packBlocksFile(stored, stateDir, snark.commit)
    : packBlocks(stored, blockCount ? { blockCount } : { blockCount: plan.count });
  const unlockKey = locked ? lockKey : displayOpenKey(keyMeta);
  const joined = external ? walkBlockFile(stateDir, snark.commit, packed) : null;
  const recalled = external
    ? plainFromStored(header, joined, unlockKey)
    : recallPlain(header, packed.blocks, unlockKey);
  if (!recalled.equals(raw)) throw new Error("system recall mismatch");
  const recallHash = sha256Hex(recalled);
  const joinedHash = sha256Hex(external ? joined : Buffer.concat(packed.blocks.map((block) => Buffer.from(block.dataField, "base64"))));
  const recomputed = computeCommit(header);
  if (joinedHash !== payloadHash || recallHash !== draft.rawHash || recomputed !== snark.commit) {
    throw new Error("snark equation mismatch");
  }
  const blocks = packed.blocks.map((block) => ({
    ...block,
    href: "/phosphor/block?c=" + snark.commit + "&i=" + block.i,
  }));
  const directory = packed.blocksExternal
    ? {
      ok: false,
      reason: "wide chain keeps data fields on disk; directory formula is for a listing that fits one data field",
      baseLocation: null,
      basescan: null,
    }
    : sealDirectory(stateDir, { header, blocks: packed.blocks });
  const equation = {
    joinedHash,
    payloadHash,
    recallHash,
    rawHash: draft.rawHash,
    snarkCommit: snark.commit,
    recomputedCommit: recomputed,
    equal: true,
    bytes: recalled.length,
    text: [
      "joined " + joinedHash + " = payloadHash",
      "recall " + recallHash + " = rawHash",
      "snark.commit " + recomputed + " = sha256(sha256(headerCore) || payloadHash)",
      "EQUAL " + recalled.length + " bytes",
    ].join("\n"),
  };
  const receipt = saveReceipt(stateDir, {
    at: timestamp,
    proof: "SYSTEM_INJECTED",
    recalled: true,
    commit: snark.commit,
    name: fileName,
    mime: header.mime,
    filingLoc: packed.filingLoc,
    starkRoot: packed.starkRoot,
    blockCount: packed.blockCount,
    blocksExternal: packed.blocksExternal === true,
    baseLocation: null,
    recallHash,
    keyMode,
    keyMeta,
    home,
    equation,
    directory,
    circuitWired: false,
    winterfellWired: false,
    blocks,
  });
  appendHomeFiling(stateDir, {
    at: timestamp,
    commit: snark.commit,
    name: fileName,
    filingLoc: receipt.filingLoc,
    bytes: raw.length,
  });
  const ratio = raw.length ? stored.length / raw.length : 1;
  const shown = blocks.filter((block) => block.i === 0 || block.i === receipt.blockCount - 1);
  const trace = [
    "C:\\PHOSPHOR> WRITE " + fileName,
    "raw " + raw.length + " bytes  sha " + draft.rawHash.slice(0, 12),
    "squash " + crushed.encoder + "  " + raw.length + " → " + crushed.bytes.length +
      "  (" + ratio.toFixed(3) + " of raw, stored " + stored.length + ")",
    "snark " + snark.short,
    "key " + (keyMode === "open" ? displayOpenKey(keyMeta) : "LOCK aes-256-gcm (passphrase stays off-header)"),
    wide
      ? "stored.bin  injector CAS  (wires skipped — payload over " + WIRE_MAX + ")"
      : "wires " + finalWires.length + " × ≤720B  injector CAS",
    ipfs.ok ? "ipfs outlet " + ipfs.loc : "ipfs outlet STANDBY" + (ipfs.reason ? " — " + ipfs.reason : ""),
    "HOME " + home.symbol + " " + home.address + " lane internal",
    "chain AVAILABILITY — base loc empty",
    "SYSTEM_INJECTED  filing " + receipt.filingLoc + "  blocks " + receipt.blockCount + "  recall OK",
    ...shown.map((block) => "block " + block.i + "  " + block.loc + "  next " + block.next),
    equation.text.split("\n")[0],
    equation.text.split("\n")[2],
    "EQUAL " + recalled.length + " bytes",
    "commit " + snark.commit,
  ];
  return { ok: true, commit: snark.commit, header, wires: finalWires, trace, ipfs, snark, receipt, home, equation };
}
