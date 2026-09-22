/**
 * STARK block filing.
 * Each injected block is one machine record. Its header names the next block.
 * The filing location is the compressed stark root (stark:// + 16 hex).
 * Base tx location stays empty. Walking next-links and the key recalls the code.
 */

import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import { expand, sha256Hex } from "./codec.js";
import { displayOpenKey, unlockBytes } from "./keys.js";
import { merkleRoot } from "./stark.js";

export const BLOCK_MAGIC = "§PHOSBLOCK§v1";
export const BLOCK_CAP = 720;
export const INLINE_BLOCK_MAX = 32;

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

/** Largest raw slice whose base64 machine line still fits BLOCK_CAP for this width. */
export function dataFieldRoom(blockCount) {
  const n = Math.max(1, Number(blockCount) || 1);
  const digits = String(n);
  const loc = "stark://" + "0123456789abcdef";
  const head = `${BLOCK_MAGIC}|i=${digits}|n=${digits}|loc=${loc}|next=${loc}|prev=${loc}|df=${"0123456789abcdef"}§`;
  const room = BLOCK_CAP - Buffer.byteLength(head + "\n", "utf8");
  if (room < 8) throw new Error("block header exceeds " + BLOCK_CAP);
  let len = Math.floor(room / 4) * 3;
  while (len > 1 && Buffer.byteLength(Buffer.alloc(len).toString("base64"), "utf8") > room) len -= 1;
  return len;
}

export function autoBlockCount(byteLength) {
  const len = Math.max(0, Number(byteLength) || 0);
  let count = 1;
  let room = dataFieldRoom(1);
  for (let attempt = 0; attempt < 12; attempt++) {
    room = dataFieldRoom(count);
    const next = Math.max(1, Math.ceil(len / room));
    if (next === count) break;
    count = next;
  }
  room = dataFieldRoom(count);
  let maxPiece = count ? Math.floor(len / count) + (len % count ? 1 : 0) : 0;
  while (maxPiece > room) {
    count += 1;
    room = dataFieldRoom(count);
    maxPiece = Math.floor(len / count) + (len % count ? 1 : 0);
  }
  return { count: Math.max(1, count), room };
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
  const count = blockCount || autoBlockCount(buf.length).count;
  if (count > 8192) throw new Error("block chain too wide for memory — file the blocks");
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
    blocksExternal: false,
    circuitWired: false,
    winterfellWired: false,
  };
}

export function blocksDir(stateDir, commit) {
  return join(stateDir, "receipts", commit);
}

export function blocksFilePath(stateDir, commit) {
  return join(blocksDir(stateDir, commit), "blocks.ndjson");
}

function offsetsPath(stateDir, commit) {
  return join(blocksDir(stateDir, commit), "offsets.bin");
}

/**
 * Stream machine blocks to disk. The receipt keeps a short preview.
 * The full chain is the ndjson file plus an offset index.
 */
export function packBlocksFile(stored, stateDir, commit) {
  const buf = Buffer.isBuffer(stored) ? stored : Buffer.from(stored);
  const { count } = autoBlockCount(buf.length);
  const base = Math.floor(buf.length / count);
  const extra = buf.length % count;
  const hashed = [];
  let cursor = 0;
  for (let i = 0; i < count; i++) {
    const len = base + (i < extra ? 1 : 0);
    const slice = buf.subarray(cursor, cursor + len);
    const full = sha256Hex(slice);
    hashed.push({ start: cursor, end: cursor + len, full, loc: filingLoc(full) });
    cursor += len;
  }
  const dir = blocksDir(stateDir, commit);
  mkdirSync(dir, { recursive: true });
  const dataFd = openSync(blocksFilePath(stateDir, commit), "w");
  const indexFd = openSync(offsetsPath(stateDir, commit), "w");
  let offset = 0;
  let prev = "GENESIS";
  const preview = [];
  const keep = new Set([0, 1, 2, count - 1]);
  try {
    for (let i = 0; i < hashed.length; i++) {
      const next = i + 1 < hashed.length ? hashed[i + 1].loc : "END";
      const slice = buf.subarray(hashed[i].start, hashed[i].end);
      const dataField = slice.toString("base64");
      const df = hashed[i].full.slice(0, 16);
      const loc = hashed[i].loc;
      const machine = machineLine({ i, n: count, loc, next, prev, df, dataField });
      const machineHash = sha256Hex(machine);
      const block = {
        i,
        n: count,
        loc,
        next,
        prev,
        df,
        dataField,
        machine,
        machineHash,
        bytes: slice.length,
      };
      const lineBuf = Buffer.from(JSON.stringify(block) + "\n", "utf8");
      const off = Buffer.alloc(8);
      off.writeBigUInt64BE(BigInt(offset));
      writeSync(indexFd, off);
      writeSync(dataFd, lineBuf);
      offset += lineBuf.length;
      if (keep.has(i)) preview.push(block);
      prev = filingLoc(machineHash);
    }
  } finally {
    closeSync(dataFd);
    closeSync(indexFd);
  }
  const starkRoot = merkleRoot(hashed.map((row) => row.full));
  return {
    blocks: preview,
    blockCount: count,
    starkRoot,
    filingLoc: filingLoc(starkRoot),
    blocksExternal: true,
    circuitWired: false,
    winterfellWired: false,
  };
}

function assertMachineBlock(block, index) {
  if (block.i !== index) throw new Error("block index drift");
  const body = Buffer.from(block.dataField, "base64");
  const full = sha256Hex(body);
  if (full.slice(0, 16) !== block.df) throw new Error("data field hash mismatch");
  if (block.loc !== filingLoc(full)) throw new Error("block loc mismatch");
  const expect = machineLine({
    i: block.i,
    n: block.n,
    loc: block.loc,
    next: block.next,
    prev: block.prev,
    df: block.df,
    dataField: block.dataField,
  });
  if (expect !== block.machine) throw new Error("machine record mismatch");
  if (sha256Hex(block.machine) !== block.machineHash) throw new Error("machine hash mismatch");
  return body;
}

/** Follow a filed ndjson chain without holding every machine line. */
export function walkBlockFile(stateDir, commit, receipt) {
  const path = blocksFilePath(stateDir, commit);
  if (!existsSync(path)) throw new Error("block file missing");
  const fd = openSync(path, "r");
  const chunks = [];
  const leaves = [];
  let carry = Buffer.alloc(0);
  let index = 0;
  let prevLink = "GENESIS";
  let ended = false;
  const scratch = Buffer.alloc(256 * 1024);
  const takeLine = (line) => {
    if (!line) return;
    if (ended) throw new Error("chain did not end");
    const block = JSON.parse(line);
    if (index === 0 && block.prev !== "GENESIS") throw new Error("genesis block missing");
    if (block.prev !== prevLink) throw new Error("prev link mismatch");
    const body = assertMachineBlock(block, index);
    chunks.push(body);
    leaves.push(sha256Hex(body));
    prevLink = filingLoc(block.machineHash);
    index += 1;
    if (block.next === "END") ended = true;
  };
  try {
    while (!ended) {
      const n = readSync(fd, scratch, 0, scratch.length, null);
      if (n <= 0) break;
      carry = Buffer.concat([carry, scratch.subarray(0, n)]);
      let nl = carry.indexOf(0x0a);
      while (nl >= 0) {
        const line = carry.subarray(0, nl).toString("utf8");
        carry = carry.subarray(nl + 1);
        takeLine(line);
        if (ended) break;
        nl = carry.indexOf(0x0a);
      }
    }
  } finally {
    closeSync(fd);
  }
  if (!ended) throw new Error("chain did not end");
  if (carry.length && carry.toString("utf8").trim()) {
    throw new Error("chain did not end");
  }
  if (index !== receipt.blockCount) throw new Error("chain incomplete");
  const root = merkleRoot(leaves);
  if (root !== receipt.starkRoot) throw new Error("stark filing root mismatch");
  if (filingLoc(root) !== receipt.filingLoc) throw new Error("compressed filing loc mismatch");
  return Buffer.concat(chunks);
}

export function readBlockAt(stateDir, commit, index) {
  const offFd = openSync(offsetsPath(stateDir, commit), "r");
  const offBuf = Buffer.alloc(8);
  try {
    const got = readSync(offFd, offBuf, 0, 8, index * 8);
    if (got !== 8) throw new Error("block offset missing");
  } finally {
    closeSync(offFd);
  }
  const start = Number(offBuf.readBigUInt64BE(0));
  const dataFd = openSync(blocksFilePath(stateDir, commit), "r");
  try {
    const buf = Buffer.alloc(8192);
    const n = readSync(dataFd, buf, 0, buf.length, start);
    const text = buf.subarray(0, n).toString("utf8");
    const line = text.split("\n")[0];
    if (!line) throw new Error("block line missing");
    return JSON.parse(line);
  } finally {
    closeSync(dataFd);
  }
}

export function loadBlock(stateDir, commit, { i, loc } = {}) {
  const receipt = loadReceipt(stateDir, commit);
  const inline = (receipt.blocks || []).find((row) => (
    (i != null && i !== "" && String(row.i) === String(i)) ||
    (loc && row.loc === loc)
  ));
  if (inline && inline.machine && inline.dataField) return { receipt, block: inline };
  if (!receipt.blocksExternal) return { receipt, block: inline || null };
  if (i != null && i !== "" && Number.isInteger(Number(i))) {
    const block = readBlockAt(stateDir, commit, Number(i));
    if (loc && block.loc !== loc) return { receipt, block: null };
    return { receipt, block };
  }
  if (loc) {
    for (let index = 0; index < receipt.blockCount; index++) {
      const block = readBlockAt(stateDir, commit, index);
      if (block.loc === loc) return { receipt, block };
    }
  }
  return { receipt, block: null };
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

export function assertRecallKey(header, key) {
  if (header.keyMode === "open") {
    const expect = displayOpenKey(header.keyMeta);
    const given = String(key || "");
    if (given !== expect && given !== header.keyMeta) {
      throw new Error("open key required to piece the blocks");
    }
    return expect;
  }
  if (header.keyMode === "lock" && !String(key || "").length) {
    throw new Error("lock key required to piece the blocks");
  }
  return String(key || "");
}

/** Stored bytes in, original file out. The key is required first. */
export function plainFromStored(header, stored, key) {
  const accepted = assertRecallKey(header, key);
  if (sha256Hex(stored) !== header.payloadHash) throw new Error("payload hash mismatch");
  let crushed = stored;
  if (header.keyMode === "lock") crushed = unlockBytes(stored, header.lock, accepted);
  const raw = expand(header.encoder, crushed);
  if (sha256Hex(raw) !== header.rawHash) throw new Error("recall mismatch");
  if (raw.length !== header.rawBytes) throw new Error("recall length mismatch");
  return raw;
}

/** Only the matching key pieces the blocks back into the original code. */
export function recallPlain(header, blocks, key) {
  assertRecallKey(header, key);
  return plainFromStored(header, walkBlocks(blocks), key);
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
  const previewNote = receipt.blocksExternal
    ? `<p class="dim">preview of ${receipt.blockCount} filed blocks · full chain is on the injector</p>`
    : "";
  const home = receipt.home
    ? `<p>HOME ${esc(receipt.home.symbol)} ${esc(receipt.home.address)} lane ${esc(receipt.home.lane)}</p>`
    : "";
  const equation = receipt.equation?.text
    ? `<pre>${esc(receipt.equation.text)}</pre>`
    : "";
  return page("PHOSPHOR receipt", `
    <h1>INJECT RECEIPT</h1>
    <p class="dim">proof ${esc(receipt.proof)} · recall ${receipt.recalled ? "OK" : "FAIL"} · blocks ${receipt.blockCount}</p>
    <p>filing <code>${esc(receipt.filingLoc)}</code></p>
    <p>stark root <code>${esc(receipt.starkRoot)}</code></p>
    <p>base location <code>${esc(receipt.baseLocation)}</code></p>
    ${home}
    <p>name ${esc(receipt.name)} · recall hash ${esc(String(receipt.recallHash || "").slice(0, 16))}</p>
    ${equation}
    ${previewNote}
    <ol>${rows}</ol>
    <p><a href="/phosphor?popup=1">CRT</a></p>
  `);
}

export function renderBlockPage(block, receipt) {
  const nextHref = block.next === "END"
    ? "END"
    : `<a href="/phosphor/block?c=${esc(receipt.commit)}&amp;i=${block.i + 1}">${esc(block.next)}</a>`;
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
