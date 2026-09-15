/**
 * VITAFEED named library — save → list → play (mother brain untouched).
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  encodeVitaFile,
  makeDemoWavBytes,
  prepareVitaFileFeed,
} from "./vita-feed-file.js";
import {
  handleVitaFeedAction,
  parseVitaFeedCommand,
  resetVitaFeedPending,
} from "./vita-feed.js";
import {
  VITALIB_MAGIC,
  encodeKeysCatalogBody,
  formatLibraryListCard,
  importKeysCatalog,
  listLibraryEntries,
  parseKeysCatalogBody,
  playFromLibrary,
  prepareKeysCatalogFeed,
  resetVitaFeedLibrary,
  resolveLibraryEntry,
  saveLibraryFromSeal,
} from "./vita-feed-library.js";
import { demoSealFeedLines } from "./vita-feed-player.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("vitafeed library save / list / play", () => {
  beforeEach(() => {
    resetVitaFeedLibrary();
    resetVitaFeedPending();
  });

  it("saves name + reader key from a sealed VITAFILE strand", () => {
    const wav = makeDemoWavBytes({ seconds: 0.08 });
    const prepared = prepareVitaFileFeed({
      name: "my-song.wav",
      mime: "audio/wav",
      bytes: wav,
    }, { maxBytes: 48 });
    const sealed = demoSealFeedLines(prepared);
    const saved = saveLibraryFromSeal({ strand: sealed.strand });
    assert.equal(saved.ok, true);
    assert.equal(saved.n, 1);
    assert.equal(saved.entry.name, "my-song.wav");
    assert.equal(saved.entry.playKind, "audio");
    assert.match(saved.entry.readerKey, /^VITAFEED\.VIN-/);
    assert.equal(listLibraryEntries().length, 1);
    assert.match(formatLibraryListCard(), /#1\s+my-song\.wav/);
  });

  it("resolves by index and name; play rebuilds audio", async () => {
    const wav = makeDemoWavBytes({ seconds: 0.06 });
    const prepared = prepareVitaFileFeed({
      name: "beep.wav",
      mime: "audio/wav",
      bytes: wav,
    }, { maxBytes: 40 });
    const sealed = demoSealFeedLines(prepared);
    saveLibraryFromSeal({ strand: sealed.strand });

    assert.equal(resolveLibraryEntry("1").ok, true);
    assert.equal(resolveLibraryEntry("beep.wav").ok, true);
    assert.equal(resolveLibraryEntry("beep").ok, true);

    const opened = await playFromLibrary(1);
    assert.equal(opened.ok, true);
    assert.equal(opened.playProof.complete, true);
    assert.equal(opened.playProof.play.kind, "audio");
    assert.ok(opened.playProof.play.dataUrl.startsWith("data:audio/wav"));
    assert.match(opened.playerPath, /lib=1/);
    assert.match(opened.reply, /VITAFEED OPEN #1/);
  });

  it("encodes §VITALIB§ keys catalog and round-trips", () => {
    const wav = makeDemoWavBytes({ seconds: 0.05 });
    const prepared = prepareVitaFileFeed({
      name: "a.wav",
      mime: "audio/wav",
      bytes: wav,
    }, { maxBytes: 64 });
    saveLibraryFromSeal({ strand: demoSealFeedLines(prepared).strand });

    const enc = encodeKeysCatalogBody();
    assert.equal(enc.ok, true);
    assert.ok(enc.body.startsWith(VITALIB_MAGIC));
    assert.match(enc.readerKey, /^VITALIB\./);

    const parsed = parseKeysCatalogBody(enc.body);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.items.length, 1);
    assert.equal(parsed.items[0].name, "a.wav");

    resetVitaFeedLibrary();
    const imp = importKeysCatalog(parsed);
    assert.equal(imp.ok, true);
    assert.equal(imp.imported, 1);
    assert.equal(listLibraryEntries()[0].name, "a.wav");
  });

  it("/vitafeed keys stages catalog for confirm", async () => {
    const wav = makeDemoWavBytes({ seconds: 0.05 });
    const prepared = prepareVitaFileFeed({
      name: "k.wav",
      mime: "audio/wav",
      bytes: wav,
    }, { maxBytes: 64 });
    saveLibraryFromSeal({ strand: demoSealFeedLines(prepared).strand });

    const staged = await handleVitaFeedAction({
      action: "keys",
      chatId: "keys-chat",
      quotes: { live: false },
    });
    assert.equal(staged.ok, true);
    assert.equal(staged.phase, "before");
    assert.ok(staged.keysCatalog?.count >= 1);
    assert.match(staged.reply, /VITALIB KEYS/);
  });

  it("parse files|play|open|pull|keys commands", () => {
    assert.equal(parseVitaFeedCommand("/vitafeed files").action, "files");
    assert.equal(parseVitaFeedCommand("/vitafeed list").action, "files");
    const p = parseVitaFeedCommand("/vitafeed play 2");
    assert.equal(p.action, "play");
    assert.equal(p.selector, "2");
    assert.equal(parseVitaFeedCommand("/vitafeed open song.wav").selector, "song.wav");
    assert.equal(parseVitaFeedCommand("/vitafeed pull 1").action, "play");
    assert.equal(parseVitaFeedCommand("/vitafeed keys").action, "keys");
  });

  it("/vitafeed override auto-saves into library", async () => {
    process.env.VITAFEED_PAID = "yes";
    process.env.VITAFEED_RATE_LIMIT = "no";
    process.env.VITAFEED_MIN_LIQUID_USD = "0";
    const wav = makeDemoWavBytes({ seconds: 0.05 });
    const enc = encodeVitaFile({ name: "lib-save.wav", mime: "audio/wav", bytes: wav });
    await handleVitaFeedAction({
      action: "preview",
      body: enc.body,
      chatId: "lib-auto",
      quotes: { live: false },
    });
    let n = 0;
    const r = await handleVitaFeedAction({
      action: "override",
      chatId: "lib-auto",
      riskBalanceEth: 0,
      gasReserveEth: 0.0005,
      forceOverride: true,
      env: {
        VITAFEED_PAID: "yes",
        VITAFEED_RATE_LIMIT: "no",
        VITAFEED_MIN_LIQUID_USD: "0",
      },
      liquidUsd: 100,
      sendTx: async () => {
        n += 1;
        return "0x" + String(n).padStart(64, "c").slice(0, 64);
      },
    });
    assert.equal(r.ok, true);
    assert.ok(r.library?.ok);
    assert.equal(r.library.entry.name, "lib-save.wav");
    assert.match(r.reply, /SAVED #/);
    const listed = await handleVitaFeedAction({ action: "files", chatId: "lib-auto" });
    assert.match(listed.reply, /lib-save\.wav/);
    const opened = await handleVitaFeedAction({
      action: "play",
      body: "1",
      chatId: "lib-auto",
    });
    assert.equal(opened.ok, true);
    assert.equal(opened.playProof.play.kind, "audio");
  });

  it("prepareKeysCatalogFeed refuses empty library", () => {
    const p = prepareKeysCatalogFeed();
    assert.equal(p.ok, false);
    assert.match(p.reason, /empty/i);
  });

  it("docs and agent wire mention library commands", () => {
    const inject = readFileSync(join(root, "vita", "INJECT.md"), "utf8");
    assert.match(inject, /vitafeed files|LIBRARY/i);
    const agent = readFileSync(join(root, "agent.js"), "utf8");
    assert.match(agent, /\/vitafeed files/);
    assert.match(agent, /playFromLibrary/);
    const webhook = readFileSync(join(root, "vita-webhook.js"), "utf8");
    assert.match(webhook, /\/vita\/feed-library/);
    assert.ok(readFileSync(join(root, "vita", "vita-feed-library.js"), "utf8").includes("VITALIB"));
  });
});
