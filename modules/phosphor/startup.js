/**
 * Startup — inject this module into the injector store, fold a stark proof,
 * reconstruct the library from wires only, then run that copy.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256Hex } from "./codec.js";
import { resetState, saveStark } from "./chain-store.js";
import { readBytes } from "./reader.js";
import { foldStark } from "./stark.js";
import { synthWav } from "./wav.js";
import { writeBytes } from "./writer.js";

const HERE = dirname(fileURLToPath(import.meta.url));

export const LIBRARY_FILES = Object.freeze([
  "codec.js",
  "keys.js",
  "wav.js",
  "snark.js",
  "stark.js",
  "blocks.js",
  "home.js",
  "ipfs-outlet.js",
  "chain-store.js",
  "writer.js",
  "reader.js",
  "bundle.js",
  "selfrun.js",
  "startup.js",
  "server.js",
  "telegram.js",
  "boot.js",
  "index.js",
  "public/terminal.html",
  "pong.js",
  "picture.js",
  "directory.js",
  "library.js",
  "sample/pong.route",
  "contract/SnapshotRegistry.sol",
  "LLM_PROMPT.md",
  "README.md",
]);

function tempDir(prefix) {
  const dir = join(tmpdir(), prefix + Date.now().toString(36) + Math.random().toString(16).slice(2));
  mkdirSync(dir, { recursive: true });
  return dir;
}

export async function runStartup({ stateDir = tempDir("phosphor-chain-"), tryIpfs = false } = {}) {
  resetState(stateDir);
  const lines = [
    "PHOSPHOR BIOS",
    "store = injector wires (the new IPFS)",
    "ipfs = outlet only",
    "groth16 unwired · winterfell unwired",
  ];
  const library = [];
  for (const name of LIBRARY_FILES) {
    const disk = readFileSync(join(HERE, name));
    const written = await writeBytes({
      bytes: disk,
      name,
      stateDir,
      tryIpfs: false,
    });
    const back = await readBytes({ commit: written.commit, stateDir });
    if (!back.raw.equals(disk)) {
      throw new Error("wire round-trip failed for " + name);
    }
    library.push({
      name,
      snarkCommit: written.snark.commit,
      commit: written.commit,
      rawHash: sha256Hex(disk),
    });
    lines.push("inject " + name + "  " + written.snark.short);
  }
  const stark = saveStark(stateDir, foldStark(library));
  lines.push("STARK root " + stark.root);
  lines.push("circuitWired " + stark.circuitWired + "  location null");

  const noteBody = Buffer.from(
    "PHOSPHOR sample note\nOpen key is pre-embedded.\nThis file loads back from injector wires.\n",
    "utf8",
  );
  const wavBody = synthWav();
  const note = await writeBytes({
    bytes: noteBody,
    name: "sample/note.txt",
    mime: "text/plain",
    stateDir,
    tryIpfs,
  });
  const wav = await writeBytes({
    bytes: wavBody,
    name: "sample/beep.wav",
    mime: "audio/wav",
    stateDir,
    tryIpfs,
  });
  lines.push(...note.trace);
  lines.push(...wav.trace);

  const recon = tempDir("phosphor-recon-");
  writeFileSync(join(recon, "package.json"), "{\"type\":\"module\"}\n");
  for (const file of library) {
    const opened = await readBytes({ commit: file.commit, stateDir });
    if (sha256Hex(opened.raw) !== file.rawHash) {
      throw new Error("reconstruct hash mismatch " + file.name);
    }
    const dest = join(recon, file.name);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, opened.raw);
  }
  lines.push("reconstructed " + library.length + " files from wires only");

  const child = spawnSync(process.execPath, [join(recon, "selfrun.js")], {
    env: {
      ...process.env,
      PHOSPHOR_STATE_DIR: stateDir,
      PHOSPHOR_NOTE_COMMIT: note.commit,
      PHOSPHOR_WAV_COMMIT: wav.commit,
      PHOSPHOR_NOTE_SHA: sha256Hex(noteBody),
      PHOSPHOR_WAV_SHA: sha256Hex(wavBody),
    },
    encoding: "utf8",
  });
  let report = null;
  try {
    report = JSON.parse(String(child.stdout || "").trim() || "null");
  } catch {
    report = null;
  }
  if (!report?.ok) {
    lines.push("SELF-RUN FAIL");
    lines.push(String(child.stderr || child.stdout || "no output").slice(0, 500));
    rmSync(recon, { recursive: true, force: true });
    return {
      ok: false,
      log: lines.join("\n"),
      stateDir,
      starkRoot: stark.root,
      error: report?.error || "chain-loaded selfrun failed",
    };
  }
  lines.push("SELF-RUN OK  wav " + report.wavBytes + " bytes playable from wires");
  lines.push("session commit " + report.sessionCommit.slice(0, 16));
  lines.push("open key " + report.openKey);
  rmSync(recon, { recursive: true, force: true });
  return {
    ok: true,
    log: lines.join("\n"),
    stateDir,
    starkRoot: stark.root,
    noteCommit: note.commit,
    wavCommit: wav.commit,
    sessionCommit: report.sessionCommit,
    openKey: report.openKey,
    circuitWired: false,
    location: null,
  };
}
