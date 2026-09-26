/**
 * Proven Player — own AV2 surface. Receipts, leader order, no invented txs.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
  it("unlocks the AV2 demo and refuses a tampered byte", async () => {
    const state = await publicProvenPlayerState();
    assert.equal(state.isolated, true);
    assert.deepEqual(state.sharesPlaybackWith, []);
    assert.equal(state.chain.baseTx, null);
    assert.equal(state.chain.registryAddress, null);
    assert.equal(state.chain.cid, null);
    assert.equal(state.chain.status, "availability");
    assert.equal(state.proof.groth16Wired, false);
    assert.equal(state.defaultMethod, "dav1d");
    assert.equal(state.methods.length, 2);
    const dav1d = state.methods.find((m) => m.id === "dav1d");
    const av2 = state.methods.find((m) => m.id === "av2");
    assert.equal(dav1d.platformDecoder, true);
    assert.equal(av2.platformDecoder, false);
    assert.notEqual(dav1d.streamId, av2.streamId);
    assert.notEqual(dav1d.chunks[0].binding, av2.chunks[0].binding);
    for (const method of state.methods) {
      assert.equal(method.chunks.length, 3);
      for (const c of method.chunks) {
        const checked = await verifyDemoChunk(c.chunkIndex, method.id);
        assert.equal(checked.ok, true, method.id + " " + checked.reason);
        assert.equal(checked.parsed.mediaDigest, c.bitstreamSha256);
      }
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
    assert.equal(tampered.reason, "bitstream-digest");
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
      encoderBuild: "AVM v1.0.0|commit=966a7d7cd6fcf60360caf5dc413b2aeeb65e144d|cpu-used=9|end-usage=q|qp=43|ivf|fourcc=AV02",
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
    assert.match(out.reply, /UNLOCKED 6/);
    assert.match(out.reply, /dav1d #0 unlocked/);
    assert.match(out.reply, /av2 #2 unlocked/);
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
    assert.match(html, /data-method="dav1d"/);
    assert.match(html, /data-method="av2"/);
    assert.equal(html.includes(PROVEN_PLAYER_PATH), true);

    const sol = readFileSync(join(root, "vita", "proven-player", "ZkAv1Registry.sol"), "utf8");
    assert.match(sol, /function commitChunk/);
    assert.match(sol, /function latest/);
    assert.match(sol, /sha256\(envelope\)/);
    const circuit = readFileSync(join(root, "vita", "proven-player", "ChunkBinding.circom"), "utf8");
    assert.match(circuit, /not an AV2 encoder/);
    const rust = readFileSync(join(root, "vita", "proven-player", "libvlc_access.rs"), "utf8");
    assert.match(rust, /unlock_for_dav2d/);
    assert.match(rust, /dav2d/);
  });
});

describe("encoded chunks are AV2 IVF", () => {
  it("each chunk is DKIF / AV02 and the reference decode hash matches", async () => {
    const demo = await loadDemoStream("av2");
    for (const c of demo.chunks) {
      const ivf = readFileSync(join(root, "vita", "proven-player", "media", "av2", c.id + ".ivf"));
      const rgb = readFileSync(join(root, "vita", "proven-player", "media", "av2", c.id + ".rgb"));
      assert.equal(ivf.subarray(0, 4).toString("ascii"), "DKIF");
      assert.equal(ivf.subarray(8, 12).toString("ascii"), "AV02");
      assert.equal(c.bitstreamSha256, (await import("node:crypto")).createHash("sha256").update(ivf).digest("hex"));
      assert.equal(c.previewSha256, (await import("node:crypto")).createHash("sha256").update(rgb).digest("hex"));
    }
  });
});
