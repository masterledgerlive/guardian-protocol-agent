/**
 * STARK block filing.
 * Each injected block is one machine record. Its header names the next block.
 * The filing location is the compressed stark root (stark:// + 16 hex).
 * Base tx location stays empty. Walking next-links and the key recalls the code.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expand, sha256Hex } from "./codec.js";
import { displayOpenKey, unlockBytes } from "./keys.js";
import { merkleRoot } from "./stark.js";

export const BLOCK_MAGIC = "§PHOSBLOCK§v1";
export const BLOCK_CAP = 720;

export function filingLoc(rootHex) {
  return "stark://" + String(rootHex || "").slice(0, 16);
}

function splitExact(buf, count) {
  if (!Number.isInteger(count) || count < 1) throw new Error("block count required");
  if (buf.length < count) throw new Error("payload shorter than block count");
  const base = Math.floor(buf.length / count);
  const extra = buf.length % count;
  if (base < 1) throw new Error("payload shorter than block count");
  const parts = [];
  let offset = 0;
  for (let i = 0; i < count; i++) {
    const len = base + (i < extra ? 1 : 0);
    parts.push(Buffer.from(buf.subarray(offset, offset + len)));
    offset += len;
  }
  return parts;
}

function machineLine({ i, n, loc, next, prev, df, dataField }) {
  const head = `${BLOCK_MAGIC}|i=${i}|n=${n}|loc=${loc}|next=${next}|prev=${prev}|df=${df}§`;
  const machine = head + "\n" + dataField;
  if (Buffer.byteLength(machine, "utf8") > BLOCK_CAP) {
    throw new Error("block machine line over " + BLOCK_CAP);
  }
  return machine;
}

/**
 * Pack stored bytes into 1..N machine blocks.
 * Pass blockCount to force a single block or a five-block header chain.
 */
export function packBlocks(stored, { blockCount } = {}) {
  const buf = Buffer.from(stored);
  const count = blockCount || Math.max(1, Math.ceil(buf.length / 96));
  const slices = splitExact(buf, count);
  const hashed = slices.map((slice) => {
    const full = sha256Hex(slice);
    return { slice, full, loc: filingLoc(full) };
  });
  const blocks = [];
  let prev = "GENESIS";
  for (let i = 0; i < hashed.length; i++) {
    const next = i + 1 < hashed.length ? hashed[i + 1].loc : "END";
    const dataField = hashed[i].slice.toString("base64");
    const df = hashed[i].full.slice(0, 16);
    const loc = hashed[i].loc;
    const machine = machineLine({ i, n: count, loc, next, prev, df, dataField });
    const machineHash = sha256Hex(machine);
    blocks.push({
      i,
      n: count,
      loc,
      next,
      prev,
      df,
      dataField,
      machine,
      machineHash,
      bytes: hashed[i].slice.length,
    });
    prev = filingLoc(machineHash);
  }
  const starkRoot = merkleRoot(hashed.map((row) => row.full));
  return {
    blocks,
    blockCount: count,
    starkRoot,
    filingLoc: filingLoc(starkRoot),
    circuitWired: false,
    winterfellWired: false,
  };
}

/** Follow next-block headers from GENESIS. Returns the stored bytes in order. */
export function walkBlocks(blocks = []) {
  if (!blocks.length) throw new Error("no blocks");
  const byLoc = new Map(blocks.map((block) => [block.loc, block]));
  let cursor = blocks.find((block) => block.prev === "GENESIS");
  if (!cursor) throw new Error("genesis block missing");
  const chain = [];
  const seen = new Set();
  while (cursor) {
    if (seen.has(cursor.loc)) throw new Error("block cycle");
    seen.add(cursor.loc);
    if (cursor.i !== chain.length) throw new Error("block index drift");
    const body = Buffer.from(cursor.dataField, "base64");
    const full = sha256Hex(body);
    if (full.slice(0, 16) !== cursor.df) throw new Error("data field hash mismatch");
    if (cursor.loc !== filingLoc(full)) throw new Error("block loc mismatch");
    const expect = machineLine({
      i: cursor.i,
      n: cursor.n,
      loc: cursor.loc,
      next: cursor.next,
      prev: cursor.prev,
      df: cursor.df,
      dataField: cursor.dataField,
    });
    if (expect !== cursor.machine) throw new Error("machine record mismatch");
    if (sha256Hex(cursor.machine) !== cursor.machineHash) throw new Error("machine hash mismatch");
    chain.push(cursor);
    if (cursor.next === "END") break;
    const nxt = byLoc.get(cursor.next);
    if (!nxt) throw new Error("next block missing " + cursor.next);
    if (nxt.prev !== filingLoc(cursor.machineHash)) throw new Error("prev link mismatch");
    cursor = nxt;
  }
  if (chain.length !== blocks.length) throw new Error("chain incomplete");
  if (chain[chain.length - 1].next !== "END") throw new Error("chain did not end");
  return Buffer.concat(chain.map((block) => Buffer.from(block.dataField, "base64")));
}

/** Only the matching key pieces the blocks back into the original code. */
export function recallPlain(header, blocks, key) {
  if (header.keyMode === "open") {
    const expect = displayOpenKey(header.keyMeta);
    if (String(key || "") !== expect) {
      throw new Error("open key required to piece the blocks");
    }
  } else if (header.keyMode === "lock" && !String(key || "").length) {
    throw new Error("lock key required to piece the blocks");
  }
  const stored = walkBlocks(blocks);
  if (sha256Hex(stored) !== header.payloadHash) throw new Error("payload hash mismatch");
  let crushed = stored;
  if (header.keyMode === "lock") crushed = unlockBytes(stored, header.lock, key);
  const raw = expand(header.encoder, crushed);
  if (sha256Hex(raw) !== header.rawHash) throw new Error("recall mismatch");
  if (raw.length !== header.rawBytes) throw new Error("recall length mismatch");
  return raw;
}

export function verifyFiling(receipt) {
  const packed = {
    blocks: receipt.blocks,
    starkRoot: receipt.starkRoot,
    filingLoc: receipt.filingLoc,
  };
  const stored = walkBlocks(packed.blocks);
  const leaves = packed.blocks.map((block) => sha256Hex(Buffer.from(block.dataField, "base64")));
  const root = merkleRoot(leaves);
  if (root !== receipt.starkRoot) throw new Error("stark filing root mismatch");
  if (filingLoc(root) !== receipt.filingLoc) throw new Error("compressed filing loc mismatch");
  return { ok: true, stored, filingLoc: receipt.filingLoc, starkRoot: root };
}

function receiptPath(stateDir, commit) {
  return join(stateDir, "receipts", commit + ".json");
}

function logPath(stateDir) {
  return join(stateDir, "inject-log.jsonl");
}

export function saveReceipt(stateDir, receipt) {
  const dir = join(stateDir, "receipts");
  mkdirSync(dir, { recursive: true });
  writeFileSync(receiptPath(stateDir, receipt.commit), JSON.stringify(receipt, null, 2));
  appendFileSync(logPath(stateDir), JSON.stringify({
    at: receipt.at,
    proof: receipt.proof,
    commit: receipt.commit,
    name: receipt.name,
    filingLoc: receipt.filingLoc,
    starkRoot: receipt.starkRoot,
    blockCount: receipt.blockCount,
    recalled: receipt.recalled,
    recallHash: receipt.recallHash,
    baseLocation: null,
  }) + "\n");
  return receipt;
}

export function loadReceipt(stateDir, commit) {
  const path = receiptPath(stateDir, commit);
  if (!existsSync(path)) throw new Error("inject receipt missing");
  return JSON.parse(readFileSync(path, "utf8"));
}

export function readInjectLog(stateDir) {
  const path = logPath(stateDir);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function esc(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function page(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  body { margin: 0; background: #010801; color: #67ff78; font: 14px/1.45 "Courier New", ui-monospace, monospace; text-shadow: 0 0 6px rgba(80,255,120,.45); }
  .crt { min-height: 100vh; padding: 18px 16px 28px; background: repeating-linear-gradient(0deg, rgba(0,0,0,.18) 0 1px, transparent 1px 3px), radial-gradient(ellipse at center, #04240c 0%, #010801 72%); }
  a { color: #b6ff9a; }
  pre { white-space: pre-wrap; word-break: break-all; border: 1px solid #145c28; padding: 10px; background: rgba(0,12,0,.55); }
  .dim { color: #1f8a3a; }
</style>
</head>
<body><div class="crt">${body}</div></body>
</html>`;
}

export function renderReceiptPage(receipt) {
  const rows = (receipt.blocks || []).map((block) => {
    const next = block.next === "END"
      ? "END"
      : `<a href="${esc(block.href)}">${esc(block.next)}</a>`;
    return `<li>block ${block.i} <a href="${esc(block.href)}">${esc(block.loc)}</a> next ${next} prev ${esc(block.prev)} df ${esc(block.df)}</li>`;
  }).join("");
  return page("PHOSPHOR receipt", `
    <h1>INJECT RECEIPT</h1>
    <p class="dim">proof ${esc(receipt.proof)} · recall ${receipt.recalled ? "OK" : "FAIL"} · blocks ${receipt.blockCount}</p>
    <p>filing <code>${esc(receipt.filingLoc)}</code></p>
    <p>stark root <code>${esc(receipt.starkRoot)}</code></p>
    <p>base location <code>${esc(receipt.baseLocation)}</code></p>
    <p>name ${esc(receipt.name)} · recall hash ${esc(String(receipt.recallHash || "").slice(0, 16))}</p>
    <ol>${rows}</ol>
    <p><a href="/phosphor?popup=1">CRT</a></p>
  `);
}

export function renderBlockPage(block, receipt) {
  const nextHref = block.next === "END"
    ? "END"
    : `<a href="/phosphor/block?c=${esc(receipt.commit)}&amp;loc=${esc(encodeURIComponent(block.next))}">${esc(block.next)}</a>`;
  return page("PHOSPHOR block " + block.i, `
    <h1>BLOCK ${block.i} / ${block.n}</h1>
    <p class="dim">exact data field of the injected block · machine record</p>
    <p>loc <code>${esc(block.loc)}</code></p>
    <p>next ${nextHref}</p>
    <p>prev <code>${esc(block.prev)}</code> · df <code>${esc(block.df)}</code></p>
    <p>filing <a href="/phosphor/receipt?c=${esc(receipt.commit)}">${esc(receipt.filingLoc)}</a></p>
    <pre>${esc(block.machine)}</pre>
  `);
}
