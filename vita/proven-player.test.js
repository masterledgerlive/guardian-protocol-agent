/**
 * Proven Player — own AV1 surface. Receipts, leader order, no invented txs.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import {
  ENVELOPE_BYTES,
  bytesToHex,
  sha256Bytes,
  verifyChunkUnlock,
} from "./proven-player-verify.js";
import {
  PROVEN_PLAYER_PATH,
  buildEnvelope,
  commitChunk,
  createRegistry,
  handleProvenPlayerAction,
  loadDemoStream,
  parseProvenPlayerCommand,
  publicProvenPlayerState,
  readChunkBytes,
  verifyDemoChunk,
} from "./proven-player.js";
import { HOME_SECTIONS } from "./telegram-home.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("proven player receipts", () => {
  it("unlocks the SVT-AV1 demo and refuses a tampered byte", async () => {
    const state = await publicProvenPlayerState();
    assert.equal(state.isolated, true);
    assert.deepEqual(state.sharesPlaybackWith, []);
    assert.equal(state.chain.baseTx, null);
    assert.equal(state.chain.registryAddress, null);
    assert.equal(state.chain.cid, null);
    assert.equal(state.chain.status, "availability");
    assert.equal(state.proof.groth16Wired, false);
    assert.equal(state.stream.chunks.length, 3);
    for (const c of state.stream.chunks) {
      const checked = await verifyDemoChunk(c.chunkIndex);
      assert.equal(checked.ok, true, checked.reason);
      assert.equal(checked.parsed.av1Digest, c.av1Sha256);
    }
    const bytes = Buffer.from(await readChunkBytes(0));
    bytes[64] ^= 0xff;
    const demo = await loadDemoStream();
    const tampered = await verifyChunkUnlock({
      envelope: demo.chunks[0].envelopeHex,
      av1Bytes: bytes,
      binding: demo.chunks[0].bindingHex,
    });
    assert.equal(tampered.ok, false);
    assert.equal(tampered.reason, "av1-digest");
  });

  it("keeps the Groth16 slot unwired and the envelope at 448 bytes", async () => {
    const demo = await loadDemoStream();
    const env = Buffer.from(demo.chunks[0].envelopeHex, "hex");
    assert.equal(env.length, ENVELOPE_BYTES);
    assert.equal(env.subarray(176, 432).every((b) => b === 0), true);
    env[176] = 1;
    const refused = await verifyChunkUnlock({
      envelope: env,
      av1Bytes: await readChunkBytes(0),
      binding: demo.chunks[0].bindingHex,
    });
    assert.equal(refused.ok, false);
    assert.equal(refused.reason, "binding-mismatch");
    const stuffed = await buildEnvelope({
      chunkIndex: 0,
      width: 160,
      height: 90,
      durationMs: 1000,
      streamId: demo.streamId,
      sourceDigest: demo.chunks[0].sourceSha256,
      av1Bytes: await readChunkBytes(0),
      encoderBuild: "SVT-AV1 Encoder Lib v1.7.0|preset=10|crf=40|libsvtav1|pix_fmt=yuv420p",
    });
    stuffed.envelope[5] = 1;
    const rebound = bytesToHex(await sha256Bytes(stuffed.envelope));
    const flagged = await verifyChunkUnlock({
      envelope: stuffed.envelope,
      av1Bytes: await readChunkBytes(0),
      binding: rebound,
    });
    assert.equal(flagged.ok, false);
    assert.equal(flagged.reason, "groth16-unwired");
  });

  it("follows the leader and rejects a gap or an invented tx", async () => {
    const registry = createRegistry();
    const streamId = "ab".repeat(32);
    const env = new Uint8Array(ENVELOPE_BYTES);
    const first = commitChunk(registry, {
      streamIdHex: streamId,
      chunkIndex: 0,
      bindingHex: "cd".repeat(32),
      envelope: env,
    });
    assert.equal(first.ok, true);
    const gap = commitChunk(registry, {
      streamIdHex: streamId,
      chunkIndex: 2,
      bindingHex: "cd".repeat(32),
      envelope: env,
    });
    assert.equal(gap.ok, false);
    assert.equal(gap.reason, "follow-the-leader");
    const invented = commitChunk(registry, {
      streamIdHex: streamId,
      chunkIndex: 1,
      bindingHex: "cd".repeat(32),
      envelope: env,
      baseTx: "0x" + "11".repeat(32),
    });
    assert.equal(invented.ok, false);
    assert.equal(invented.reason, "no-invented-tx");
  });
});

describe("proven player is its own category", () => {
  it("parses commands and stays out of the other players", async () => {
    assert.equal(parseProvenPlayerCommand("/provenplayer").action, "player");
    assert.equal(parseProvenPlayerCommand("/provenplayer verify 1").chunk, 1);
    assert.equal(parseProvenPlayerCommand("/tokenplayer").ok, false);
    const out = await handleProvenPlayerAction({ action: "verify" });
    assert.equal(out.ok, true);
    assert.match(out.reply, /UNLOCKED 3/);
    assert.equal(out.keyboard.inline_keyboard[0][0].url.includes("/vita/proven-player"), true);

    const home = HOME_SECTIONS.find((s) => s.id === "players");
    const helpSrc = readFileSync(join(root, "vita", "telegram-help-routes.js"), "utf8");
    assert.ok(home);
    assert.match(helpSrc, /id: "players"/);
    assert.ok(home.buttons.some((b) => b.cmd === "/provenplayer"));
    assert.equal(home.buttons.some((b) => b.cmd.includes("feed-player")), false);
    assert.equal(home.buttons.some((b) => b.cmd.includes("tokenplayer")), false);

    const html = readFileSync(join(root, "public", "vita-proven-player.html"), "utf8");
    assert.equal(html.includes("feed-player"), false);
    assert.equal(html.includes("kids-player"), false);
    assert.equal(html.includes("token-player"), false);
    assert.match(html, /verifyChunkUnlock/);
    assert.equal(html.includes(PROVEN_PLAYER_PATH), true);

    const sol = readFileSync(join(root, "vita", "proven-player", "ZkAv1Registry.sol"), "utf8");
    assert.match(sol, /function commitChunk/);
    assert.match(sol, /function latest/);
    assert.match(sol, /sha256\(envelope\)/);
    const circuit = readFileSync(join(root, "vita", "proven-player", "ChunkBinding.circom"), "utf8");
    assert.match(circuit, /not an AV1 encoder/);
    const rust = readFileSync(join(root, "vita", "proven-player", "libvlc_access.rs"), "utf8");
    assert.match(rust, /unlock_for_dav1d/);
    assert.match(rust, /dav1d/);
  });
});

describe("encoded chunks are AV1", () => {
  it("ffprobe reports av1 for each demo chunk", async () => {
    const demo = await loadDemoStream();
    for (const c of demo.chunks) {
      const file = join(root, "vita", "proven-player", "media", c.id + ".mp4");
      const codec = await probeCodec(file);
      assert.equal(codec, "av1");
    }
  });
});

function probeCodec(file) {
  return new Promise((resolve, reject) => {
    const child = spawn("ffprobe", [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=codec_name",
      "-of", "csv=p=0",
      file,
    ]);
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(err || "ffprobe " + code));
      else resolve(out.trim());
    });
  });
}
