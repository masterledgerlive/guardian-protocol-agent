/**
 * Append-only GRAFT data log + compact old-way inject queue.
 * Avenue: graft-compact-inject. Never invents tx hashes.
 * Settlement token is real Base WETH.
 */

import fs from "node:fs";
import path from "node:path";
import { INJECT_AVENUE } from "./models.js";
import { SETTLEMENT } from "./tokens.js";
import { SHORT_TAG_PREFIX, stateDir } from "./config.js";
import { inclusionProof, persistLedger, rawBlob, readLedger } from "./store.js";
import { shortId } from "./hash.js";

export function dataLogPath() {
  return path.join(stateDir(), "data-log.jsonl");
}

export function injectQueuePath() {
  return path.join(stateDir(), "inject-queue.json");
}

function ensure() {
  fs.mkdirSync(stateDir(), { recursive: true });
  if (!fs.existsSync(injectQueuePath())) {
    fs.writeFileSync(injectQueuePath(), JSON.stringify({ avenue: INJECT_AVENUE, packets: [] }, null, 2));
  }
}

export function appendDataLog(entry) {
  ensure();
  const row = {
    ts: new Date().toISOString(),
    avenue: INJECT_AVENUE,
    tx: null,
    ...entry,
  };
  if (row.tx != null && row.tx !== "" && !/^0x[a-fA-F0-9]{64}$/.test(String(row.tx))) {
    row.tx = null;
    row.txNote = "rejected non-hash; never invented";
  }
  fs.appendFileSync(dataLogPath(), `${JSON.stringify(row)}\n`);
  return row;
}

export function readDataLog() {
  if (!fs.existsSync(dataLogPath())) return [];
  return fs.readFileSync(dataLogPath(), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean);
}

export function readInjectQueue() {
  ensure();
  try {
    return JSON.parse(fs.readFileSync(injectQueuePath(), "utf8"));
  } catch {
    return { avenue: INJECT_AVENUE, packets: [] };
  }
}

function writeQueue(q) {
  ensure();
  const tmp = `${injectQueuePath()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(q, null, 2));
  fs.renameSync(tmp, injectQueuePath());
}

/**
 * Old-way compact packet: KEY+LOC spirit, not the raw dump.
 * Ready to hitch later. GRAFT does not broadcast.
 */
export function formatCompactPacket({ model, artifact, lastRoot, motherRoot = "", snap = 0 } = {}) {
  const key = artifact?.shortId || shortId(artifact?.id || "", 8);
  const loc = shortId(lastRoot || "", 16);
  const g = motherRoot ? shortId(motherRoot, 16) : "";
  const lines = [
    SHORT_TAG_PREFIX,
    `MODEL=${model || "GRAFT"}`,
    `KEY=${key}`,
    `LOC=${loc}`,
    `SNAP=${snap}`,
  ];
  if (g) lines.push(`G=${g}`);
  lines.push(`TOKEN=${SETTLEMENT.symbol}`);
  lines.push(`ADDR=${SETTLEMENT.address}`);
  lines.push(`AVENUE=${INJECT_AVENUE}`);
  lines.push("TX=none");
  return lines.join("\n");
}

export function stageInject(artifact, {
  model = "GRAFT",
  motherRoot = "",
  note = "compact-old-way",
} = {}) {
  const ledger = readLedger();
  if (!artifact?.id) return { ok: false, error: "not-found" };
  const utf8 = formatCompactPacket({
    model,
    artifact,
    lastRoot: ledger.lastRoot,
    motherRoot,
    snap: ledger.snapSeq,
  });
  const proof = inclusionProof(artifact.id, ledger);
  const packet = {
    model,
    artifactId: artifact.id,
    shortId: artifact.shortId,
    title: artifact.title,
    utf8,
    bytes: Buffer.byteLength(utf8, "utf8"),
    lastRoot: ledger.lastRoot,
    motherRoot: motherRoot || null,
    inclusion: proof.ok,
    proofSteps: proof.proof?.length || 0,
    ts: new Date().toISOString(),
    tx: null,
    avenue: INJECT_AVENUE,
    note,
    rawBytes: (rawBlob(artifact) || "").length,
  };
  const q = readInjectQueue();
  q.packets.push(packet);
  writeQueue(q);
  if (ledger.directory[artifact.shortId]) {
    ledger.directory[artifact.shortId].loc = `LOC=${shortId(ledger.lastRoot, 16)}`;
    ledger.directory[artifact.shortId].tag = artifact.tag;
  }
  persistLedger(ledger);
  appendDataLog({
    kind: "inject",
    model,
    artifactId: artifact.shortId,
    lastRoot: ledger.lastRoot,
    motherRoot: motherRoot || null,
    bytes: packet.bytes,
    rawBytes: packet.rawBytes,
    note,
  });
  return { ok: true, packet, ledger };
}

export function listReceipts() {
  const q = readInjectQueue();
  const logs = readDataLog();
  return {
    avenue: INJECT_AVENUE,
    packets: q.packets || [],
    logCount: logs.length,
    txHashes: (q.packets || []).map((p) => p.tx).filter(Boolean),
  };
}
