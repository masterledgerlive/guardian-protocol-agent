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
import { parsePhosphong } from "./pong.js";
import { foldStark } from "./stark.js";
import { writeBytes } from "./writer.js";

const HERE = dirname(fileURLToPath(import.meta.url));
export const PONG_NAME = "sample/pong.route";
const SAMPLE = join(HERE, "sample", "pong.route");

function card(stateDir, commit) {
  const object = loadObject(stateDir, commit);
  const receipt = loadReceipt(stateDir, commit);
  const header = object.header;
  const play = header.name === PONG_NAME || header.mime === "text/x-phosphong" ? "phosphong" : null;
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
    filingLoc: receipt.filingLoc,
    blockCount: receipt.blockCount,
    baseLocation: null,
    home: receipt.home || null,
    href: "/phosphor/receipt?c=" + commit,
    recalled: receipt.recalled === true,
  };
}

export async function ensurePlayLibrary(stateDir) {
  const index = loadIndex(stateDir);
  let commit = Object.keys(index.objects || {}).find((key) => index.objects[key].name === PONG_NAME);
  if (!commit) {
    const bytes = readFileSync(SAMPLE);
    parsePhosphong(bytes.toString("utf8"));
    const written = await writeBytes({
      bytes,
      name: PONG_NAME,
      mime: "text/x-phosphong",
      stateDir,
      tryIpfs: false,
    });
    commit = written.commit;
  }
  if (!loadStark(stateDir)) {
    const object = loadObject(stateDir, commit);
    saveStark(stateDir, foldStark([{
      name: PONG_NAME,
      snarkCommit: object.header.snark.commit,
      rawHash: object.header.rawHash,
      commit,
    }]));
  }
  const fresh = loadIndex(stateDir);
  const items = Object.keys(fresh.objects || {}).map((key) => card(stateDir, key));
  return {
    ok: true,
    location: null,
    items,
  };
}
