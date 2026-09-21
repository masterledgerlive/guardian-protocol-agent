/**
 * VITA soundboard — DJ pads → VIN → zero-open-key → loc MATCH (not class-proof).
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  PAD_RECIPES,
  SOUNDBOARD_MAGIC,
  SOUNDBOARD_PLAYER_PATH,
  addUploadedPad,
  buildPadLocProof,
  buildPadLocProofLocal,
  buildSoundboardKeyboard,
  createPromptPad,
  ensureBuiltInPads,
  formatSoundboardCard,
  isSoundboardPlaySelector,
  listCatalogPadIds,
  packetizePad,
  parsePromptRecipe,
  playPad,
  publicSoundboardLoc,
  publicSoundboardPlay,
  publicSoundboardState,
  resolvePadId,
  synthesizePadWav,
  waveformPeaks,
} from "./soundboard.js";
import { parseVitaFeedCommand, handleVitaFeedAction } from "./vita-feed.js";
import { listSubDirectory } from "./vita-dir.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

describe("soundboard synth + catalog", () => {
  it("parses prompted music-bite recipes", () => {
    const r = parsePromptRecipe("saw rise 220→880 0.32s gain=0.55");
    assert.equal(r.ok, true);
    assert.equal(r.wave, "saw");
    assert.equal(r.style, "rise");
    assert.equal(r.f0, 220);
    assert.equal(r.f1, 880);
  });

  it("synthesizes deterministic RIFF WAV for airhorn", () => {
    const a = synthesizePadWav("airhorn");
    const b = synthesizePadWav("airhorn");
    assert.equal(a.ok, true);
    assert.equal(a.bytes.subarray(0, 4).toString("ascii"), "RIFF");
    assert.equal(a.sha256, b.sha256);
    assert.ok(a.bytes.length > 1000);
    assert.ok(waveformPeaks(a.bytes, 16).length === 16);
  });

  it("ensures 16 built-in pads with zero-open keys", () => {
    const cat = ensureBuiltInPads();
    const ids = Object.keys(cat.pads).filter((id) => PAD_RECIPES[id]);
    assert.equal(ids.length, 16);
    for (const id of ids) {
      assert.match(cat.pads[id].zeroOpenKey, /^VITAOPEN\./);
      assert.ok(existsSync(join(HERE, "memory", "soundboard", id + ".wav")));
    }
  });
});

describe("soundboard VIN packetize + play", () => {
  it("packetizes airhorn under VIN cap per group", () => {
    const p = packetizePad("airhorn");
    assert.equal(p.ok, true);
    assert.ok(p.groupCount >= 1);
    assert.ok(p.totalVin >= 1);
    for (const g of p.groups) {
      assert.ok(g.totalChunks <= 24);
    }
    assert.match(p.zeroOpenKey, /^VITAOPEN\./);
    assert.equal(p.unlock.privateKey, false);
  });

  it("plays reconstructed WAV matching catalog sha", () => {
    const opened = playPad("kick");
    assert.equal(opened.ok, true);
    assert.equal(opened.play.mime, "audio/wav");
    assert.ok(opened.play.dataUrl.startsWith("data:audio/wav;base64,"));
    assert.equal(opened.play.sha256, opened.packed.sha256);
  });

  it("loc proof separates LOCAL_OK from CLASS_PROOF", async () => {
    const local = buildPadLocProofLocal("beep");
    assert.equal(local.ok, true);
    assert.ok(local.rows.every((r) => r.match === "LOCAL_OK"));
    assert.ok(local.classProof.length >= 1);
    assert.equal(local.classProof[0].kind, "CLASS_PROOF");
    assert.match(local.daisyChain.join(" "), /not new pad inputs/i);

    const packed = packetizePad("beep");
    const line = packed.groups[0].lines[0];
    const proof = await buildPadLocProof({
      id: "beep",
      sealedLocs: [
        {
          groupN: 1,
          index: line.index,
          location: "0x" + "ab".repeat(32),
          utf8: line.line,
        },
      ],
    });
    assert.equal(proof.ok, true);
    assert.ok(proof.matched >= 1);
    assert.ok(proof.rows.some((r) => r.match === "MATCH" && r.clickThrough));
    assert.ok(proof.classProof.every((c) => c.match === "CLASS_PROOF"));
    assert.match(proof.note, /CLASS_PROOF/);
  });
});

describe("soundboard prompt + upload", () => {
  it("creates prompted pad into catalog", () => {
    const made = createPromptPad("square beep 660hz 0.08s", { id: "testbeep" });
    assert.equal(made.ok, true);
    assert.equal(made.id, "testbeep");
    assert.match(made.zeroOpenKey, /testbeep/);
    assert.ok(listCatalogPadIds().includes("testbeep"));
  });

  it("ingests uploaded WAV bytes", () => {
    const syn = synthesizePadWav("tick");
    const up = addUploadedPad({
      name: "my-tick.wav",
      mime: "audio/wav",
      bytes: syn.bytes,
    });
    assert.equal(up.ok, true);
    assert.match(up.id, /^u/);
    assert.match(up.zeroOpenKey, /^VITAOPEN\./);
  });
});

describe("soundboard telegram + HTTP surface", () => {
  it("resolves selectors and formats board card", () => {
    assert.equal(resolvePadId("horn"), "airhorn");
    assert.equal(isSoundboardPlaySelector("board"), true);
    assert.equal(isSoundboardPlaySelector("pad kick"), true);
    const card = formatSoundboardCard();
    assert.ok(card.includes(SOUNDBOARD_MAGIC));
    assert.match(card, /CLASS_PROOF/);
    const kb = buildSoundboardKeyboard({ highlight: "airhorn" });
    assert.ok(kb.inline_keyboard.length >= 4);
  });

  it("parses /vitafeed board|pad|prompt", () => {
    assert.equal(parseVitaFeedCommand("/vitafeed board").action, "board");
    assert.equal(parseVitaFeedCommand("/vitafeed pad airhorn").action, "pad");
    assert.equal(parseVitaFeedCommand("/vitafeed prompt saw rise 100→400 0.2s").action, "prompt");
  });

  it("handleVitaFeedAction board + pad", async () => {
    const board = await handleVitaFeedAction({ action: "board", body: "", chatId: "sb-test" });
    assert.equal(board.ok, true);
    assert.equal(board.soundboard, true);
    assert.equal(board.playerPath, SOUNDBOARD_PLAYER_PATH);
    assert.ok(board.keyboard?.inline_keyboard?.length);

    const pad = await handleVitaFeedAction({ action: "pad", body: "laser", chatId: "sb-test" });
    assert.equal(pad.ok, true);
    assert.equal(pad.id, "laser");
    assert.ok(pad.play?.dataUrl);
    assert.match(pad.zeroOpenKey || "", /^VITAOPEN\./);
  });

  it("DOS dir BOARD lists pads", () => {
    const listed = listSubDirectory("BOARD");
    assert.ok(listed.entries.length >= 16);
    assert.ok(listed.entries.some((e) => /airhorn/i.test(e.name)));
  });

  it("public state + play + loc inspect", () => {
    const st = publicSoundboardState();
    assert.equal(st.ok, true);
    assert.ok(st.padCount >= 16);
    assert.ok(st.classProof?.length);
    const play = publicSoundboardPlay("coin");
    assert.equal(play.ok, true);
    assert.ok(play.dataUrl);
    const loc = publicSoundboardLoc("coin", 1, 1);
    assert.equal(loc.ok, true);
    assert.ok(loc.utf8.includes("§VITAFILE§") || loc.utf8.length > 20);
    assert.match(loc.note, /class-proof/i);
  });

  it("webhook + html + filing wired", () => {
    const wh = readFileSync(join(ROOT, "vita-webhook.js"), "utf8");
    assert.match(wh, /\/vita\/soundboard/);
    assert.match(wh, /publicSoundboardPlay/);
    assert.ok(existsSync(join(ROOT, "public", "vita-soundboard.html")));
    const filing = readFileSync(join(HERE, "FILING.md"), "utf8");
    assert.match(filing, /SOUNDBOARD/);
    const agents = readFileSync(join(HERE, "AGENTS.md"), "utf8");
    assert.match(agents, /soundboard/i);
  });
});
