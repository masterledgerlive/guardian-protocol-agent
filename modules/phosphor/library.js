/**
 * Clickable play library. The pong listing is written into the injector
 * once, then every PLAY loads those recalled bytes. Base location stays empty.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadReceipt } from "./blocks.js";
import { loadIndex, loadObject, loadStark, saveStark } from "./chain-store.js";
import { displayOpenKey } from "./keys.js";
import { synthPicture } from "./picture.js";
import { parsePhosphong } from "./pong.js";
import { foldStark } from "./stark.js";
import { writeBytes } from "./writer.js";

const HERE = dirname(fileURLToPath(import.meta.url));
export const PONG_NAME = "sample/pong.route";
export const PICTURE_NAME = "sample/picture.ppm";
const SAMPLE = join(HERE, "sample", "pong.route");

function card(stateDir, commit) {
  const object = loadObject(stateDir, commit);
  const receipt = loadReceipt(stateDir, commit);
  const header = object.header;
  const play = header.name === PICTURE_NAME || header.mime === "image/x-portable-pixmap"
    ? "picture"
    : (header.name === PONG_NAME || header.mime === "text/x-phosphong" ? "phosphong" : null);
  const directory = receipt.directory || null;
  return {
    name: header.name,
    commit,
    play,
    mime: header.mime,
    encoder: header.encoder,
    rawBytes: header.rawBytes,
    payloadBytes: header.payloadBytes,
    ratio: header.rawBytes ? header.payloadBytes / header.rawBytes : 1,
    snark: header.snark?.short || null,
    snarkCommit: header.snark?.commit || commit,
    openKey: header.keyMode === "open" ? displayOpenKey(header.keyMeta) : null,
    keyMode: header.keyMode,
    filingLoc: directory?.finalLoc || receipt.filingLoc,
    blockFilingLoc: receipt.filingLoc,
    blockCount: receipt.blockCount,
    directory: directory?.text || null,
    directoryBytes: directory?.directoryBytes || null,
    dataFieldBytes: directory?.dataFieldBytes || null,
    shorterThanData: directory?.shorterThanData === true,
    shorterThanRaw: directory?.shorterThanRaw === true,
    keyAttached: directory?.keyAttached === true,
    folder: play === "picture" ? "PICTURE" : (play === "phosphong" ? "PLAY" : "FILES"),
    baseLocation: null,
    basescan: null,
    home: receipt.home || null,
    href: "/phosphor/receipt?c=" + commit,
    recalled: receipt.recalled === true,
  };
}

async function ensureNamed(stateDir, name, bytes, mime) {
  const index = loadIndex(stateDir);
  const existing = Object.keys(index.objects || {}).find((key) => index.objects[key].name === name);
  if (existing) return existing;
  const written = await writeBytes({ bytes, name, mime, stateDir, tryIpfs: false });
  return written.commit;
}

export async function ensurePlayLibrary(stateDir) {
  const route = readFileSync(SAMPLE);
  parsePhosphong(route.toString("utf8"));
  const pongCommit = await ensureNamed(stateDir, PONG_NAME, route, "text/x-phosphong");
  const picture = synthPicture();
  const pictureCommit = await ensureNamed(stateDir, PICTURE_NAME, picture, "image/x-portable-pixmap");
  if (!loadStark(stateDir)) {
    const files = [pongCommit, pictureCommit].map((commit) => {
      const object = loadObject(stateDir, commit);
      return {
        name: object.header.name,
        snarkCommit: object.header.snark.commit,
        rawHash: object.header.rawHash,
        commit,
      };
    });
    saveStark(stateDir, foldStark(files));
  }
  const fresh = loadIndex(stateDir);
  const items = Object.keys(fresh.objects || {}).map((key) => card(stateDir, key));
  const folders = ["PLAY", "PICTURE", "FILES"].map((id) => ({
    id,
    items: items.filter((item) => item.folder === id),
  })).filter((folder) => folder.items.length);
  return {
    ok: true,
    location: null,
    basescan: null,
    items,
    folders,
  };
}
