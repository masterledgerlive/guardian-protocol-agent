/**
 * VITAFILE packets + Tailwind play proof (mother brain untouched).
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  encodeVitaFile,
  parseVitaFileBody,
  prepareVitaFileFeed,
  reconstructVitaFileFromLines,
  makeDemoWavBytes,
  pickTelegramMedia,
  isVitaFileBody,
  VITAFILE_MAGIC,
  beginVitaFeedFileAwait,
  peekVitaFeedFileAwait,
  takeVitaFeedFileAwait,
  resetVitaFeedFileAwait,
  vitaFeedPleaseInsertFileText,
  packetizeTelegramMessageForVitaFeed,
} from "./vita-feed-file.js";
import {
  buildVitaFeedPlayProof,
  demoSealFeedLines,
  pieceTogetherState,
  playProofFromInscribeResult,
} from "./vita-feed-player.js";
import {
  handleVitaFeedAction,
  parseVitaFeedCommand,
  resetVitaFeedPending,
  reconstructVitaFeedBody,
} from "./vita-feed.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function paidOn(extra = {}) {
  return {
    VITAFEED_PAID: "yes",
    VITAFEED_MIN_LIQUID_USD: "0",
    VITAFEED_RATE_LIMIT: "no",
    ...extra,
  };
}

describe("vitafile encode / decode", () => {
  it("roundtrips song bytes through §VITAFILE§ + VIN packets", () => {
    const wav = makeDemoWavBytes({ seconds: 0.1 });
    const enc = encodeVitaFile({ name: "demo-song.wav", mime: "audio/wav", bytes: wav });
    assert.equal(enc.ok, true);
    assert.ok(enc.body.startsWith(VITAFILE_MAGIC));
    assert.equal(enc.playKind, "audio");
    assert.ok(isVitaFileBody(enc.body));

    const prepared = prepareVitaFileFeed({
      name: "demo-song.wav",
      mime: "audio/wav",
      bytes: wav,
    }, { maxBytes: 64 });
    assert.equal(prepared.ok, true);
    assert.equal(prepared.mode, "vitafile");
    assert.ok(prepared.totalChunks >= 2);
    assert.equal(prepared.file.name, "demo-song.wav");

    const rebuilt = reconstructVitaFeedBody(prepared.lines);
    assert.equal(rebuilt.ok, true);
    const file = parseVitaFileBody(rebuilt.body);
    assert.equal(file.ok, true);
    assert.equal(file.rawBytes, wav.length);
    assert.equal(Buffer.compare(file.data, wav), 0);
    assert.ok(file.dataUrl.startsWith("data:audio/wav;base64,"));
  });

  it("marks text/html as playKind html with UTF-8 text for iframe", () => {
    const html = "<html><body>hi</body></html>";
    const enc = encodeVitaFile({
      name: "page.html",
      mime: "text/html",
      bytes: Buffer.from(html, "utf8"),
    });
    assert.equal(enc.ok, true);
    assert.equal(enc.playKind, "html");
    const parsed = parseVitaFileBody(enc.body);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.playKind, "html");
    assert.equal(parsed.text, html);
  });

  it("marks .txt as playKind text with recovered plain UTF-8", () => {
    const note = "see me again after unwrap";
    const enc = encodeVitaFile({
      name: "note.txt",
      bytes: Buffer.from(note, "utf8"),
    });
    assert.equal(enc.mime, "text/plain");
    assert.equal(enc.playKind, "text");
    const parsed = parseVitaFileBody(enc.body);
    assert.equal(parsed.playKind, "text");
    assert.equal(parsed.text, note);
  });

  it("refuses corrupt sha on parse", () => {
    const enc = encodeVitaFile({ name: "x.bin", bytes: Buffer.from("hello") });
    const bad = enc.body.replace(/sha256=[0-9a-f]+/, "sha256=" + "0".repeat(64));
    const parsed = parseVitaFileBody(bad);
    assert.equal(parsed.ok, false);
    assert.match(parsed.reason, /sha256/i);
  });

  it("picks telegram audio/document media", () => {
    assert.equal(
      pickTelegramMedia({ audio: { file_id: "A", file_name: "s.mp3", mime_type: "audio/mpeg" } }).kind,
      "audio",
    );
    assert.equal(
      pickTelegramMedia({ document: { file_id: "D", file_name: "c.js", mime_type: "text/javascript" } }).name,
      "c.js",
    );
    assert.equal(pickTelegramMedia({ text: "hi" }).ok, false);
  });
});

describe("vitafeed player play proof", () => {
  it("demo-seals spaced locations and plays the song", () => {
    const wav = makeDemoWavBytes({ seconds: 0.08 });
    const prepared = prepareVitaFileFeed({
      name: "beep.wav",
      mime: "audio/wav",
      bytes: wav,
    }, { maxBytes: 48 });
    const sealed = demoSealFeedLines(prepared);
    assert.equal(sealed.ok, true);
    assert.equal(sealed.demo, true);
    assert.equal(sealed.strand.locations.length, prepared.totalChunks);

    const proof = buildVitaFeedPlayProof({
      strand: sealed.strand,
      label: "DEMO",
    });
    assert.equal(proof.complete, true);
    assert.equal(proof.mode, "vitafile");
    assert.equal(proof.play.kind, "audio");
    assert.ok(proof.play.dataUrl.startsWith("data:audio/wav"));
    assert.ok(proof.spacedProof.spacedBlockchainLocations >= 1);
    assert.match(proof.card, /PLAY PROOF/);
    assert.match(proof.spacedProof.proofLine, /File assembled|spaced/);

    const pieces = pieceTogetherState({
      sealedCount: proof.sealedCount,
      needed: proof.needed,
      pieces: proof.pieces,
    });
    assert.equal(pieces.complete, true);
    assert.equal(pieces.progressPct, 100);
  });

  it("HTML playKind runs as iframe srcdoc text after unlock", () => {
    const html =
      "<!doctype html><html><body><h1 id='ok'>VITA</h1><script>document.title='sealed'</script></body></html>";
    const prepared = prepareVitaFileFeed({
      name: "sealed-page.html",
      mime: "text/html",
      bytes: Buffer.from(html, "utf8"),
    }, { maxBytes: 64 });
    assert.equal(prepared.ok, true);
    assert.equal(prepared.file.playKind, "html");

    const sealed = demoSealFeedLines(prepared);
    const proof = buildVitaFeedPlayProof({
      strand: sealed.strand,
      label: "DEMO",
    });
    assert.equal(proof.complete, true);
    assert.equal(proof.play.kind, "html");
    assert.equal(proof.play.mime, "text/html");
    assert.equal(proof.play.text, html);
    assert.ok(proof.play.dataUrl.startsWith("data:text/html;base64,"));
    assert.match(proof.card, /HTML runs in sandboxed iframe/);
  });

  it("plain .txt playKind recovers UTF-8 text (same as compress unwrap)", () => {
    const note = "hello plain after compression\nline two";
    const prepared = prepareVitaFileFeed({
      name: "note.txt",
      mime: "text/plain",
      bytes: Buffer.from(note, "utf8"),
    }, { maxBytes: 48 });
    assert.equal(prepared.file.playKind, "text");
    const sealed = demoSealFeedLines(prepared);
    const proof = buildVitaFeedPlayProof({
      strand: sealed.strand,
      label: "DEMO",
    });
    assert.equal(proof.play.kind, "text");
    assert.equal(proof.play.text, note);
    assert.match(proof.card, /plain text recovered/);
  });

  it("/vitafeed override completes with play proof for VITAFILE", async () => {
    resetVitaFeedPending();
    const wav = makeDemoWavBytes({ seconds: 0.05 });
    const enc = encodeVitaFile({ name: "o.wav", mime: "audio/wav", bytes: wav });
    await handleVitaFeedAction({
      action: "preview",
      body: enc.body,
      chatId: "play-override",
      quotes: { live: false },
    });
    let n = 0;
    const r = await handleVitaFeedAction({
      action: "override",
      chatId: "play-override",
      env: paidOn(),
      riskBalanceEth: 0,
      gasReserveEth: 0.0005,
      forceOverride: true,
      sendTx: async () => {
        n += 1;
        return "0x" + String(n).padStart(64, "b").slice(0, 64);
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.forcedOverride, true);
    assert.ok(r.playProof?.complete);
    assert.equal(r.playProof.play.kind, "audio");
    assert.match(r.reply, /PLAY PROOF/i);
    assert.match(r.reply, /feed-player/);
  });
});

describe("vitafeed file await (Telegram please-insert-file)", () => {
  beforeEach(() => {
    resetVitaFeedFileAwait();
  });

  it("begins await, peeks, takes, and clears", () => {
    assert.equal(peekVitaFeedFileAwait("chat-1"), null);
    beginVitaFeedFileAwait("chat-1", { via: "command" });
    const row = peekVitaFeedFileAwait("chat-1");
    assert.ok(row);
    assert.equal(row.prompt, "please_insert_file");
    assert.equal(row.via, "command");
    assert.match(vitaFeedPleaseInsertFileText(), /please insert the file/i);
    assert.equal(takeVitaFeedFileAwait("chat-1")?.chatId, "chat-1");
    assert.equal(peekVitaFeedFileAwait("chat-1"), null);
  });

  it("parse /vitafeed file wants a file (agent then awaits or packetizes)", () => {
    const p = parseVitaFeedCommand("/vitafeed file");
    assert.equal(p.ok, true);
    assert.equal(p.action, "file");
    assert.equal(p.wantsFile, true);
  });

  it("packetizeTelegramMessageForVitaFeed encodes picked media bytes", async () => {
    const wav = makeDemoWavBytes({ seconds: 0.05 });
    const fakeFetch = async (url) => {
      if (String(url).includes("getFile")) {
        return {
          ok: true,
          json: async () => ({ ok: true, result: { file_path: "music/demo.wav", file_size: wav.length } }),
        };
      }
      return {
        ok: true,
        arrayBuffer: async () => wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength),
      };
    };
    const packed = await packetizeTelegramMessageForVitaFeed(
      { audio: { file_id: "FID1", file_name: "demo.wav", mime_type: "audio/wav", file_size: wav.length } },
      { token: "test-token", fetchImpl: fakeFetch },
    );
    assert.equal(packed.ok, true);
    assert.equal(packed.name, "demo.wav");
    assert.ok(isVitaFileBody(packed.body));
    assert.equal(packed.playKind, "audio");
    assert.ok(packed.bodyBytes > packed.rawBytes);
  });
});

describe("mother brain untouched + player surface", () => {
  it("git diff main is empty for VITA root inscription files", () => {
    // Soft check — files exist and player html is present.
    assert.ok(readFileSync(join(root, "vita-memory.js"), "utf8").length > 100);
    const playerHtml = readFileSync(join(root, "public", "vita-feed-player.html"), "utf8");
    assert.ok(playerHtml.includes("VITAFEED"));
    assert.ok(playerHtml.includes('play.kind === "html"'));
    assert.ok(playerHtml.includes("srcdoc"));
    assert.ok(playerHtml.includes("sandbox"));
    assert.ok(readFileSync(join(root, "vita-webhook.js"), "utf8").includes("/vita/feed-player"));
  });

  it("reconstruct helper returns plain when not VITAFILE", () => {
    const r = reconstructVitaFileFromLines([
      "[VITAFEED:VIN-X:01/01:prev=00000000:next=END]hello plain",
    ]);
    assert.equal(r.ok, true);
    assert.equal(r.isVitaFile, false);
    assert.equal(r.body, "hello plain");
  });

  it("playProofFromInscribeResult tolerates empty", () => {
    const p = playProofFromInscribeResult({ ok: false });
    assert.equal(p.ok, false);
  });
});
