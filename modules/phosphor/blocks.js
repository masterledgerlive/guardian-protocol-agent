/**
 * STARK block filing.
 * Each injected block is one machine record. Its header names the next block.
 * The filing location is the compressed stark root (stark:// + 16 hex).
 * Base tx location stays empty. Walking next-links and the key recalls the code.
 *
 * Leader (block i=0) alone carries the triple time stamp (utc + local + unix)
 * plus compressed filing loc — date/time/location never lost. Trailing blocks
 * stay lean: follow-the-leader prev/next finds the code either way. Knowing
 * any one path (block loc, filing loc, or directory final) surfaces every
 * connected path.
 */

import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
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

/** Sample leader stamp width reserved in the 720B hitch budget. */
const LEADER_STAMP_SAMPLE =
  "|utc=2026-09-23T22:06:00.000Z|local=2026-09-23T18:06:00.000-04:00|unix=1727132760|filing=stark://0123456789abcdef";

export function filingLoc(rootHex) {
  return "stark://" + String(rootHex || "").slice(0, 16);
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

/**
 * Triple stamp for the leader block first line.
 * utc = ISO-8601 Zulu, local = wall clock with offset, unix = seconds since epoch.
 * Agent recall can find by any of the three (or a day prefix).
 */
export function stampTripleTime(at = Date.now()) {
  const ms = typeof at === "number" ? at : Date.parse(String(at));
  const d = new Date(Number.isFinite(ms) ? ms : Date.now());
  const utc = d.toISOString();
  const unix = Math.floor(d.getTime() / 1000);
  const offsetMin = -d.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  const local =
    d.getFullYear() +
    "-" +
    pad2(d.getMonth() + 1) +
    "-" +
    pad2(d.getDate()) +
    "T" +
    pad2(d.getHours()) +
    ":" +
    pad2(d.getMinutes()) +
    ":" +
    pad2(d.getSeconds()) +
    "." +
    String(d.getMilliseconds()).padStart(3, "0") +
    sign +
    pad2(Math.floor(abs / 60)) +
    ":" +
    pad2(abs % 60);
  return { utc, local, unix };
}

export function parseLeaderStamp(machineOrHead) {
  const head = String(machineOrHead || "").split("\n")[0] || "";
  if (!head.startsWith(BLOCK_MAGIC)) return null;
  const utc = (head.match(/\|utc=([^|§]+)/) || [])[1] || null;
  const local = (head.match(/\|local=([^|§]+)/) || [])[1] || null;
  const unixRaw = (head.match(/\|unix=(\d+)/) || [])[1];
  const filing = (head.match(/\|filing=(stark:\/\/[0-9a-f]{16})/) || [])[1] || null;
  if (!utc && !local && unixRaw == null) return null;
  return {
    utc,
    local,
    unix: unixRaw != null ? Number(unixRaw) : null,
    filing,
  };
}

function leaderFields(block) {
  if (!block || block.i !== 0) return null;
  if (block.utc || block.local || block.unix != null) {
    return {
      utc: block.utc,
      local: block.local,
      unix: block.unix,
      filing: block.filing,
    };
  }
  return parseLeaderStamp(block.machine);
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
  // Budget for the leader first line (utc|local|unix|filing). Trailing blocks
  // are shorter; equal splits stay under 720B either way.
  const head =
    `${BLOCK_MAGIC}|i=${digits}|n=${digits}|loc=${loc}|next=${loc}|prev=${loc}|df=${"0123456789abcdef"}` +
    LEADER_STAMP_SAMPLE +
    "§";
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

function machineLine({ i, n, loc, next, prev, df, dataField, leader = null }) {
  let head = `${BLOCK_MAGIC}|i=${i}|n=${n}|loc=${loc}|next=${next}|prev=${prev}|df=${df}`;
  if (leader) {
    head +=
      `|utc=${leader.utc}|local=${leader.local}|unix=${leader.unix}|filing=${leader.filing}`;
  }
  head += "§";
  const machine = head + "\n" + dataField;
  if (Buffer.byteLength(machine, "utf8") > BLOCK_CAP) {
    throw new Error("block machine line over " + BLOCK_CAP);
  }
  return machine;
}

function buildLeaderStamp(at, filing) {
  const stamp = stampTripleTime(at);
  return { ...stamp, filing };
}

/**
 * Pack stored bytes into 1..N machine blocks.
 * Pass blockCount to force a single block or a five-block header chain.
 * Only the GENESIS leader (i=0) carries utc|local|unix|filing.
 */
export function packBlocks(stored, { blockCount, at } = {}) {
  const buf = Buffer.from(stored);
  const count = blockCount || autoBlockCount(buf.length).count;
  if (count > 8192) throw new Error("block chain too wide for memory — file the blocks");
  const slices = splitExact(buf, count);
  const hashed = slices.map((slice) => {
    const full = sha256Hex(slice);
    return { slice, full, loc: filingLoc(full) };
  });
  const starkRoot = merkleRoot(hashed.map((row) => row.full));
  const filing = filingLoc(starkRoot);
  const leaderStamp = buildLeaderStamp(at, filing);
  const blocks = [];
  let prev = "GENESIS";
  for (let i = 0; i < hashed.length; i++) {
    const next = i + 1 < hashed.length ? hashed[i + 1].loc : "END";
    const dataField = hashed[i].slice.toString("base64");
    const df = hashed[i].full.slice(0, 16);
    const loc = hashed[i].loc;
    const leader = i === 0 ? leaderStamp : null;
    const machine = machineLine({ i, n: count, loc, next, prev, df, dataField, leader });
    const machineHash = sha256Hex(machine);
    const row = {
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
    };
    if (leader) {
      row.utc = leader.utc;
      row.local = leader.local;
      row.unix = leader.unix;
      row.filing = leader.filing;
      row.leader = true;
    }
    blocks.push(row);
    prev = filingLoc(machineHash);
  }
  return {
    blocks,
    blockCount: count,
    starkRoot,
    filingLoc: filing,
    leaderStamp,
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
 * Leader (i=0) alone carries utc|local|unix|filing.
 */
export function packBlocksFile(stored, stateDir, commit, { at } = {}) {
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
  const starkRoot = merkleRoot(hashed.map((row) => row.full));
  const filing = filingLoc(starkRoot);
  const leaderStamp = buildLeaderStamp(at, filing);
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
      const leader = i === 0 ? leaderStamp : null;
      const machine = machineLine({ i, n: count, loc, next, prev, df, dataField, leader });
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
      if (leader) {
        block.utc = leader.utc;
        block.local = leader.local;
        block.unix = leader.unix;
        block.filing = leader.filing;
        block.leader = true;
      }
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
  return {
    blocks: preview,
    blockCount: count,
    starkRoot,
    filingLoc: filing,
    leaderStamp,
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
  const leader = leaderFields(block);
  if (index === 0 && !leader) throw new Error("leader stamp missing");
  if (index > 0 && (block.utc || block.unix != null || block.filing)) {
    throw new Error("trailing block must not carry leader stamp");
  }
  const expect = machineLine({
    i: block.i,
    n: block.n,
    loc: block.loc,
    next: block.next,
    prev: block.prev,
    df: block.df,
    dataField: block.dataField,
    leader,
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
    assertMachineBlock(cursor, chain.length);
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

/**
 * From follow-the-leader blocks: every connected path + leader time/filing.
 * Knowing any one block loc (or the filing loc) yields the full set.
 */
export function connectedPathsFromBlocks(blocks = []) {
  if (!Array.isArray(blocks) || !blocks.length) {
    return { ok: false, reason: "no blocks", locs: [], paths: [] };
  }
  const byLoc = new Map(blocks.map((block) => [block.loc, block]));
  let cursor = blocks.find((block) => block.prev === "GENESIS");
  if (!cursor) return { ok: false, reason: "genesis block missing", locs: [], paths: [] };
  const ordered = [];
  const seen = new Set();
  while (cursor) {
    if (seen.has(cursor.loc)) return { ok: false, reason: "block cycle", locs: [], paths: [] };
    seen.add(cursor.loc);
    ordered.push(cursor);
    if (cursor.next === "END") break;
    const nxt = byLoc.get(cursor.next);
    if (!nxt) return { ok: false, reason: "next block missing", locs: ordered.map((b) => b.loc), paths: [] };
    cursor = nxt;
  }
  const leader = ordered[0];
  const stamp = leaderFields(leader) || {};
  const locs = ordered.map((b) => b.loc);
  const paths = [...locs];
  if (stamp.filing && !paths.includes(stamp.filing)) paths.push(stamp.filing);
  return {
    ok: true,
    locs,
    paths,
    filing: stamp.filing || null,
    utc: stamp.utc || null,
    local: stamp.local || null,
    unix: stamp.unix ?? null,
    blockCount: ordered.length,
    leaderLoc: leader.loc,
  };
}

/** If knownPath is any connected loc/filing, return the full connected set. */
export function pathsFromKnown(blocks, knownPath) {
  const connected = connectedPathsFromBlocks(blocks);
  if (!connected.ok) return connected;
  const want = String(knownPath || "");
  if (!want) return { ...connected, matched: false, reason: "path required" };
  const hit =
    connected.paths.includes(want) ||
    connected.locs.includes(want) ||
    connected.filing === want ||
    connected.leaderLoc === want;
  if (!hit) return { ok: false, matched: false, reason: "path not in this chain", locs: [], paths: [] };
  return { ...connected, matched: true, known: want };
}

function timeIndexPath(stateDir) {
  return join(stateDir, "leader-time-index.json");
}

function readTimeIndex(stateDir) {
  try {
    if (!existsSync(timeIndexPath(stateDir))) return { rows: [], neverInventHashes: true };
    return JSON.parse(readFileSync(timeIndexPath(stateDir), "utf8"));
  } catch {
    return { rows: [], neverInventHashes: true };
  }
}

/** Append-only index so agentic recall can find by utc / local / unix / day. */
export function indexLeaderTime(stateDir, receipt) {
  const leader = (receipt.blocks || []).find((b) => b.i === 0) || null;
  const stamp = leaderFields(leader);
  if (!stamp) return null;
  const index = readTimeIndex(stateDir);
  const row = {
    commit: receipt.commit,
    name: receipt.name,
    filingLoc: receipt.filingLoc || stamp.filing || null,
    leaderLoc: leader.loc,
    utc: stamp.utc,
    local: stamp.local,
    unix: stamp.unix,
    blockCount: receipt.blockCount,
    at: receipt.at || stamp.utc,
  };
  index.rows = (index.rows || []).filter((r) => r.commit !== row.commit);
  index.rows.push(row);
  index.neverInventHashes = true;
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(timeIndexPath(stateDir), JSON.stringify(index, null, 2) + "\n");
  return row;
}

/**
 * Find filings by any of the three stamps (or a UTC/local day prefix).
 * Part of learning: can the agent recall from time alone?
 */
export function findByLeaderTime(stateDir, query = {}) {
  const index = readTimeIndex(stateDir);
  const rows = index.rows || [];
  const unixQ = query.unix != null && query.unix !== "" ? Number(query.unix) : null;
  const utcQ = query.utc != null ? String(query.utc) : "";
  const localQ = query.local != null ? String(query.local) : "";
  const dayQ = query.day != null ? String(query.day) : "";
  const hits = rows.filter((row) => {
    if (unixQ != null && Number.isFinite(unixQ) && Number(row.unix) === unixQ) return true;
    if (utcQ && String(row.utc || "") === utcQ) return true;
    if (localQ && String(row.local || "") === localQ) return true;
    if (dayQ) {
      if (String(row.utc || "").startsWith(dayQ)) return true;
      if (String(row.local || "").startsWith(dayQ)) return true;
    }
    if (!unixQ && !utcQ && !localQ && !dayQ) return false;
    // prefix match when query is a partial ISO
    if (utcQ && String(row.utc || "").startsWith(utcQ)) return true;
    if (localQ && String(row.local || "").startsWith(localQ)) return true;
    return false;
  });
  return {
    ok: true,
    query: { unix: unixQ, utc: utcQ || null, local: localQ || null, day: dayQ || null },
    count: hits.length,
    hits,
    neverInventHashes: true,
  };
}

/**
 * Resolve every connected path from one known path (block loc, filing, or
 * directory final loc). Directory formula already lists ordered data fields;
 * follow-leader adds the reverse: one block → whole container.
 */
export function resolveConnectedPaths(stateDir, knownPath) {
  const want = String(knownPath || "");
  if (!want) return { ok: false, reason: "path required", paths: [], locs: [] };

  const dirIndexPath = join(stateDir, "directories.json");
  if (existsSync(dirIndexPath)) {
    try {
      const dirs = JSON.parse(readFileSync(dirIndexPath, "utf8"));
      const asFinal = dirs[want];
      if (asFinal?.text) {
        const listed = (asFinal.text.match(/\|L=(.*)$/) || [])[1] || "";
        const locs = listed.split("+").filter(Boolean);
        let receipt = null;
        try {
          receipt = loadReceipt(stateDir, asFinal.commit);
        } catch {
          receipt = null;
        }
        const fromBlocks = receipt ? connectedPathsFromBlocks(receipt.blocks) : null;
        const paths = [...locs];
        if (!paths.includes(want)) paths.push(want);
        if (fromBlocks?.filing && !paths.includes(fromBlocks.filing)) paths.push(fromBlocks.filing);
        return {
          ok: true,
          source: "directory",
          known: want,
          locs,
          paths,
          filing: fromBlocks?.filing || asFinal.finalLoc || want,
          utc: fromBlocks?.utc || null,
          local: fromBlocks?.local || null,
          unix: fromBlocks?.unix ?? null,
          commit: asFinal.commit || null,
          directoryFinal: want,
        };
      }
      for (const [finalLoc, row] of Object.entries(dirs)) {
        const listed = String(row?.text || "").match(/\|L=(.*)$/);
        const locs = listed ? listed[1].split("+").filter(Boolean) : [];
        if (locs.includes(want)) {
          let fromBlocks = null;
          try {
            fromBlocks = connectedPathsFromBlocks(loadReceipt(stateDir, row.commit).blocks);
          } catch {
            fromBlocks = null;
          }
          const paths = [...locs];
          if (!paths.includes(finalLoc)) paths.push(finalLoc);
          if (fromBlocks?.filing && !paths.includes(fromBlocks.filing)) paths.push(fromBlocks.filing);
          return {
            ok: true,
            source: "directory-member",
            known: want,
            locs,
            paths,
            filing: fromBlocks?.filing || finalLoc,
            utc: fromBlocks?.utc || null,
            local: fromBlocks?.local || null,
            unix: fromBlocks?.unix ?? null,
            commit: row.commit || null,
            directoryFinal: finalLoc,
          };
        }
      }
    } catch {
      // fall through to receipt scan
    }
  }

  const timeIndex = readTimeIndex(stateDir);
  for (const row of timeIndex.rows || []) {
    if (row.filingLoc === want || row.leaderLoc === want) {
      try {
        const receipt = loadReceipt(stateDir, row.commit);
        const connected = pathsFromKnown(receipt.blocks, want);
        if (connected.ok) {
          return { ...connected, source: "leader-time-index", commit: row.commit, name: row.name };
        }
        // filing loc may not be a block loc — still return chain from receipt
        const all = connectedPathsFromBlocks(receipt.blocks);
        if (all.ok && (all.filing === want || all.leaderLoc === want)) {
          return { ...all, matched: true, known: want, source: "leader-time-index", commit: row.commit, name: row.name };
        }
      } catch {
        continue;
      }
    }
  }

  // Scan receipts for a matching block loc (small stores / tests).
  const receiptsDir = join(stateDir, "receipts");
  if (existsSync(receiptsDir)) {
    try {
      for (const name of readdirSync(receiptsDir)) {
        if (!name.endsWith(".json")) continue;
        const receipt = JSON.parse(readFileSync(join(receiptsDir, name), "utf8"));
        const connected = pathsFromKnown(receipt.blocks || [], want);
        if (connected.ok && connected.matched) {
          return { ...connected, source: "receipt", commit: receipt.commit, name: receipt.name };
        }
        const all = connectedPathsFromBlocks(receipt.blocks || []);
        if (all.ok && all.filing === want) {
          return { ...all, matched: true, known: want, source: "receipt-filing", commit: receipt.commit, name: receipt.name };
        }
      }
    } catch {
      // ignore
    }
  }

  return { ok: false, reason: "path not found", known: want, paths: [], locs: [] };
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
  const leader = (receipt.blocks || []).find((b) => b.i === 0) || null;
  const stamp = leaderFields(leader);
  const enriched = stamp
    ? {
      ...receipt,
      leaderStamp: {
        utc: stamp.utc,
        local: stamp.local,
        unix: stamp.unix,
        filing: stamp.filing || receipt.filingLoc || null,
        leaderLoc: leader?.loc || null,
      },
    }
    : receipt;
  writeFileSync(receiptPath(stateDir, enriched.commit), JSON.stringify(enriched, null, 2));
  appendFileSync(logPath(stateDir), JSON.stringify({
    at: enriched.at,
    proof: enriched.proof,
    commit: enriched.commit,
    name: enriched.name,
    filingLoc: enriched.filingLoc,
    starkRoot: enriched.starkRoot,
    blockCount: enriched.blockCount,
    recalled: enriched.recalled,
    recallHash: enriched.recallHash,
    utc: stamp?.utc || null,
    local: stamp?.local || null,
    unix: stamp?.unix ?? null,
    baseLocation: null,
  }) + "\n");
  indexLeaderTime(stateDir, enriched);
  return enriched;
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
  const stamp = receipt.leaderStamp || leaderFields((receipt.blocks || []).find((b) => b.i === 0));
  const rows = (receipt.blocks || []).map((block) => {
    const next = block.next === "END"
      ? "END"
      : `<a href="${esc(block.href)}">${esc(block.next)}</a>`;
    const leaderNote = block.i === 0 && (block.utc || block.unix != null)
      ? ` · LEADER utc ${esc(block.utc)} local ${esc(block.local)} unix ${esc(block.unix)}`
      : "";
    return `<li>block ${block.i} <a href="${esc(block.href)}">${esc(block.loc)}</a> next ${next} prev ${esc(block.prev)} df ${esc(block.df)}${leaderNote}</li>`;
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
  const timeLine = stamp
    ? `<p>leader time utc <code>${esc(stamp.utc)}</code> · local <code>${esc(stamp.local)}</code> · unix <code>${esc(stamp.unix)}</code></p>`
    : "";
  return page("PHOSPHOR receipt", `
    <h1>INJECT RECEIPT</h1>
    <p class="dim">proof ${esc(receipt.proof)} · recall ${receipt.recalled ? "OK" : "FAIL"} · blocks ${receipt.blockCount}</p>
    <p>filing <code>${esc(receipt.filingLoc)}</code></p>
    ${timeLine}
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
  const stamp = leaderFields(block);
  const timeLine = stamp
    ? `<p class="dim">LEADER stamp · date/time/location never lost on trailing blocks</p>
    <p>utc <code>${esc(stamp.utc)}</code></p>
    <p>local <code>${esc(stamp.local)}</code></p>
    <p>unix <code>${esc(stamp.unix)}</code></p>
    <p>filing <code>${esc(stamp.filing || receipt.filingLoc)}</code></p>`
    : `<p class="dim">follow-the-leader container · stamp lives on block 0</p>`;
  return page("PHOSPHOR block " + block.i, `
    <h1>BLOCK ${block.i} / ${block.n}${block.i === 0 ? " · LEADER" : ""}</h1>
    <p class="dim">exact data field of the injected block · machine record</p>
    <p>loc <code>${esc(block.loc)}</code></p>
    <p>next ${nextHref}</p>
    <p>prev <code>${esc(block.prev)}</code> · df <code>${esc(block.df)}</code></p>
    ${timeLine}
    <p>filing <a href="/phosphor/receipt?c=${esc(receipt.commit)}">${esc(receipt.filingLoc)}</a></p>
    <pre>${esc(block.machine)}</pre>
  `);
}
