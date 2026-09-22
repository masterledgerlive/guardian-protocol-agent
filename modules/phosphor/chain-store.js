/**
 * Chain injector store — the new IPFS.
 * Objects live as §PHOSPHOR§ wires (≤720 B) ready to space into Base calldata.
 * `location` stays null until a real sealed tx exists. This module never invents one.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { objectFromWires, sha256Hex } from "./codec.js";

const OBJECT_CAP = 400;
const BYTE_CAP = 512 * 1024 * 1024;

const HERE = dirname(fileURLToPath(import.meta.url));

export function defaultStateDir() {
  return process.env.PHOSPHOR_STATE_DIR || join(HERE, "state");
}

function indexPath(stateDir) {
  return join(stateDir, "index.json");
}

function objectDir(stateDir, commit) {
  return join(stateDir, "objects", commit);
}

function objectPath(stateDir, commit) {
  return join(objectDir(stateDir, commit), "wires.json");
}

function storedPath(stateDir, commit) {
  return join(objectDir(stateDir, commit), "stored.bin");
}

function headerPath(stateDir, commit) {
  return join(objectDir(stateDir, commit), "header.json");
}

function starkPath(stateDir) {
  return join(stateDir, "stark.json");
}

function readJson(path, fallback) {
  try {
    if (!existsSync(path)) return fallback;
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function emptyIndex() {
  return { objects: {}, bytes: 0, neverInventHashes: true };
}

export function loadIndex(stateDir = defaultStateDir()) {
  return readJson(indexPath(stateDir), emptyIndex());
}

function putIndex(stateDir, commit, header, extra) {
  const index = loadIndex(stateDir);
  const previous = index.objects[commit]?.payloadBytes || 0;
  index.objects[commit] = {
    name: header.name,
    mime: header.mime,
    keyMode: header.keyMode,
    keyMeta: header.keyMeta,
    rawBytes: header.rawBytes,
    payloadBytes: header.payloadBytes,
    packets: extra.packets,
    mode: extra.mode,
    encoder: header.encoder,
    snark: header.snark?.short || null,
    location: null,
    status: "availability",
    at: header.timestamp,
  };
  index.bytes = Math.max(0, (index.bytes || 0) - previous) + header.payloadBytes;
  const count = Object.keys(index.objects).length;
  if (count > OBJECT_CAP) throw new Error("phosphor store object cap");
  if (index.bytes > BYTE_CAP) throw new Error("phosphor store byte cap");
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(indexPath(stateDir), JSON.stringify(index, null, 2), "utf8");
  return index.objects[commit];
}

export function saveObject(stateDir, { commit, header, wires }) {
  const dir = objectDir(stateDir, commit);
  mkdirSync(dir, { recursive: true });
  writeFileSync(objectPath(stateDir, commit), JSON.stringify(wires), "utf8");
  return putIndex(stateDir, commit, header, { packets: wires.length, mode: "wires" });
}

/** Large payloads stay as stored.bin. They are not one giant wires.json. */
export function saveStored(stateDir, { commit, header, stored }) {
  const dir = objectDir(stateDir, commit);
  mkdirSync(dir, { recursive: true });
  const body = Buffer.isBuffer(stored) ? stored : Buffer.from(stored);
  if (sha256Hex(body) !== header.payloadHash) throw new Error("stored hash mismatch");
  writeFileSync(headerPath(stateDir, commit), JSON.stringify(header));
  writeFileSync(storedPath(stateDir, commit), body);
  return putIndex(stateDir, commit, header, { packets: 0, mode: "stored-bin" });
}

export function loadWires(stateDir, commit) {
  const path = objectPath(stateDir, commit);
  if (!existsSync(path)) throw new Error("object wires missing: " + commit.slice(0, 12));
  const wires = JSON.parse(readFileSync(path, "utf8"));
  return objectFromWires(wires);
}

export function resolveCommit(stateDir, commitOrPrefix) {
  const want = String(commitOrPrefix || "").replace(/^0x/, "").toLowerCase();
  if (!want) throw new Error("commit required");
  const index = loadIndex(stateDir);
  const keys = Object.keys(index.objects || {});
  if (index.objects[want]) return want;
  const hits = keys.filter((key) => key.startsWith(want));
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) throw new Error("ambiguous commit prefix");
  throw new Error("commit not in injector store");
}

export function loadStored(stateDir, commit) {
  const bin = storedPath(stateDir, commit);
  const head = headerPath(stateDir, commit);
  if (!existsSync(bin) || !existsSync(head)) throw new Error("stored object missing: " + commit.slice(0, 12));
  const header = JSON.parse(readFileSync(head, "utf8"));
  const stored = readFileSync(bin);
  if (sha256Hex(stored) !== header.payloadHash) throw new Error("stored hash mismatch");
  return { commit, header, wires: null, stored, mode: "stored-bin" };
}

export function loadObject(stateDir, commitOrPrefix) {
  const commit = resolveCommit(stateDir, commitOrPrefix);
  if (existsSync(objectPath(stateDir, commit))) return loadWires(stateDir, commit);
  return loadStored(stateDir, commit);
}

export function saveStark(stateDir, stark) {
  mkdirSync(stateDir, { recursive: true });
  const body = {
    ...stark,
    location: null,
    status: "availability",
    neverInventHashes: true,
  };
  writeFileSync(starkPath(stateDir), JSON.stringify(body, null, 2), "utf8");
  return body;
}

export function loadStark(stateDir = defaultStateDir()) {
  return readJson(starkPath(stateDir), null);
}

export function resetState(stateDir) {
  if (existsSync(stateDir)) rmSync(stateDir, { recursive: true, force: true });
  mkdirSync(stateDir, { recursive: true });
}
