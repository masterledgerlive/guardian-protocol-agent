/**
 * Location directory. The formula the reader needs is this short line of
 * filing locs, in order. It stays shorter than the data field. Base tx
 * location stays empty until a real seal exists. This module never invents one.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataFieldRoom, filingLoc, loadBlock, plainFromStored } from "./blocks.js";
import { sha256Hex } from "./codec.js";
import { loadObject } from "./chain-store.js";
import { displayOpenKey } from "./keys.js";

export const DIR_MAGIC = "§PHOSDIR§v1";

function indexPath(stateDir) {
  return join(stateDir, "directories.json");
}

function readIndex(stateDir) {
  try {
    if (!existsSync(indexPath(stateDir))) return {};
    return JSON.parse(readFileSync(indexPath(stateDir), "utf8"));
  } catch {
    return {};
  }
}

export function buildDirectoryText(header, locs) {
  const key = header.keyMode === "open" ? displayOpenKey(header.keyMeta) : "LOCK";
  return DIR_MAGIC + "|k=" + key + "|kind=data|n=" + locs.length + "|L=" + locs.join("+");
}

export function parseDirectory(text) {
  const line = String(text || "").trim();
  if (!line.startsWith(DIR_MAGIC + "|")) throw new Error("directory formula missing");
  const key = (line.match(/\|k=(.+)\|kind=/) || [])[1] || "";
  const kind = (line.match(/\|kind=([^|]+)/) || [])[1] || "";
  const listed = (line.match(/\|L=(.*)$/) || [])[1] || "";
  const locs = listed.split("+").filter(Boolean);
  const n = Number((line.match(/\|n=(\d+)/) || [])[1]);
  if (kind !== "data" || !locs.length || locs.length !== n) throw new Error("directory locs missing");
  for (const loc of locs) {
    if (!/^stark:\/\/[0-9a-f]{16}$/.test(loc)) throw new Error("directory loc invalid");
  }
  return { key, kind, locs };
}

export function sealDirectory(stateDir, { header, blocks }) {
  const list = blocks || [];
  if (!list.length) {
    return {
      ok: false,
      reason: "no data fields to file",
      baseLocation: null,
      basescan: null,
    };
  }
  const locs = list.map((block) => block.loc);
  const text = buildDirectoryText(header, locs);
  const directoryBytes = Buffer.byteLength(text, "utf8");
  const dataFieldBytes = Math.max(...list.map((block) => Buffer.byteLength(block.dataField || "", "utf8")));
  const room = dataFieldRoom(list.length || 1);
  if (directoryBytes >= room) {
    return {
      ok: false,
      reason: "directory longer than a data field",
      directoryBytes,
      dataFieldBytes,
      room,
      shorterThanData: false,
      shorterThanRaw: directoryBytes < header.rawBytes,
      baseLocation: null,
      basescan: null,
    };
  }
  const finalLoc = filingLoc(sha256Hex(text));
  const row = {
    ok: true,
    finalLoc,
    text,
    directoryBytes,
    dataFieldBytes,
    room,
    shorterThanData: directoryBytes < dataFieldBytes,
    shorterThanRaw: directoryBytes < header.rawBytes,
    rawBytes: header.rawBytes,
    payloadBytes: header.payloadBytes,
    commit: header.snark?.commit || null,
    keyAttached: header.keyMode === "open",
    baseLocation: null,
    basescan: null,
  };
  const index = readIndex(stateDir);
  index[finalLoc] = row;
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(indexPath(stateDir), JSON.stringify(index, null, 2));
  return row;
}

export function loadDirectory(stateDir, finalLoc) {
  const index = readIndex(stateDir);
  const row = index[finalLoc];
  if (!row) throw new Error("directory filing missing");
  if (filingLoc(sha256Hex(row.text)) !== finalLoc) throw new Error("directory filing mismatch");
  return row;
}

/** Read data fields in directory order. Open key is already on the formula. */
export function unwrapDirectory(stateDir, finalLoc, key) {
  const row = loadDirectory(stateDir, finalLoc);
  const parsed = parseDirectory(row.text);
  if (parsed.key === "LOCK" && !String(key || "").length) {
    throw new Error("key required to unwrap snark");
  }
  const object = loadObject(stateDir, row.commit);
  const useKey = parsed.key === "LOCK" ? key : (String(key || "").length ? key : parsed.key);
  const parts = [];
  for (const loc of parsed.locs) {
    const found = loadBlock(stateDir, row.commit, { loc });
    if (!found.block) throw new Error("directory data field missing " + loc);
    parts.push(Buffer.from(found.block.dataField, "base64"));
  }
  const stored = Buffer.concat(parts);
  const raw = plainFromStored(object.header, stored, useKey);
  return { raw, directory: row, header: object.header, order: parsed.locs };
}
