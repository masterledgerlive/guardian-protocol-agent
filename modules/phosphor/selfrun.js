/**
 * Chain-loaded program. The bootloader reconstructs this file from injector
 * wires and executes it. It reads the samples back from those same wires.
 */

import { readBytes, readFromWires } from "./reader.js";
import { writeBytes } from "./writer.js";
import { loadObject, loadStark } from "./chain-store.js";
import { verifyStark } from "./stark.js";
import { sha256Hex } from "./codec.js";

function fail(message) {
  process.stdout.write(JSON.stringify({ ok: false, error: message }));
  process.exit(1);
}

const stateDir = process.env.PHOSPHOR_STATE_DIR;
if (!stateDir) fail("PHOSPHOR_STATE_DIR missing");

const stark = loadStark(stateDir);
if (!stark) fail("stark proof missing");
try {
  verifyStark(stark, stark.files);
} catch (error) {
  fail(error.message);
}

for (const file of stark.files) {
  const object = loadObject(stateDir, file.commit);
  if (sha256Hex(object.stored) && object.header.rawHash !== file.rawHash) {
    fail("library raw hash drift " + file.name);
  }
  const opened = readFromWires(object.wires);
  if (sha256Hex(opened.raw) !== file.rawHash) fail("library unwrap drift " + file.name);
}

const note = await readBytes({ commit: process.env.PHOSPHOR_NOTE_COMMIT, stateDir });
const wav = await readBytes({ commit: process.env.PHOSPHOR_WAV_COMMIT, stateDir });
if (sha256Hex(note.raw) !== process.env.PHOSPHOR_NOTE_SHA) fail("note mismatch");
if (sha256Hex(wav.raw) !== process.env.PHOSPHOR_WAV_SHA) fail("wav mismatch");
if (!wav.raw.subarray(0, 4).equals(Buffer.from("RIFF"))) fail("wav is not RIFF");

const session = await writeBytes({
  bytes: Buffer.from("PHOSPHOR session write from chain-loaded code\n", "utf8"),
  name: "session.txt",
  mime: "text/plain",
  stateDir,
  tryIpfs: false,
});
const back = await readBytes({ commit: session.commit, stateDir });
if (!back.raw.equals(Buffer.from("PHOSPHOR session write from chain-loaded code\n", "utf8"))) {
  fail("session round-trip mismatch");
}

process.stdout.write(JSON.stringify({
  ok: true,
  from: "injector-wires",
  starkRoot: stark.root,
  circuitWired: false,
  noteBytes: note.raw.length,
  wavBytes: wav.raw.length,
  wavPlayable: true,
  sessionCommit: session.commit,
  openKey: note.openKey,
}));
