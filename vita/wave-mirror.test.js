/**
 * WAVE transmission tests — reconstruct-from-chain-only vs answer key.
 * Autonomous ping/pong shard ACK ≥3 rounds. Never invent tx hashes.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  WAVE_ANSWER_KEY_PATH,
  WAVE_MIN_ROUNDS,
  WAVE_WISE_MESSAGE,
  WAVE_WISE_SYM,
  buildWaveAnswerKey,
  compareToAnswerKey,
  createWaveSimChain,
  handleWaveTestAction,
  loadWaveAnswerKey,
  parseWaveTestCommand,
  prepareWaveWrap,
  readWaveFromLocations,
  runWaveInscribe,
  runWaveMirrorTest,
  sha256HexUtf8,
} from "./wave-wrap.js";
import { vitaFeedPaidEnabled } from "./vita-feed.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("WAVE answer-key bank", () => {
  it("committed key sha256 matches the exact wise message and per-shard digests", () => {
    const loaded = loadWaveAnswerKey(WAVE_ANSWER_KEY_PATH);
    assert.equal(loaded.ok, true);
    assert.equal(loaded.messageUtf8, WAVE_WISE_MESSAGE);
    assert.equal(loaded.sha256, sha256HexUtf8(WAVE_WISE_MESSAGE));
    assert.equal(loaded.neverInventHashes, true);
    assert.ok(loaded.totalShards >= 3);
    const rebuilt = buildWaveAnswerKey(WAVE_WISE_MESSAGE, {
      symbol: WAVE_WISE_SYM,
      vinId: "VIN-RECHECK01",
    });
    assert.equal(rebuilt.sha256, loaded.sha256);
    assert.equal(rebuilt.totalShards, loaded.totalShards);
    assert.equal(rebuilt.shards.length, loaded.shards.length);
    for (let i = 0; i < loaded.shards.length; i++) {
      assert.equal(rebuilt.shards[i].sha256, loaded.shards[i].sha256);
      assert.match(loaded.shards[i].sha256, /^[0-9a-f]{64}$/);
    }
  });

  it("refuses a stale/invented full-message hash", () => {
    const loaded = loadWaveAnswerKey();
    const bad = compareToAnswerKey(WAVE_WISE_MESSAGE, {
      ...loaded,
      sha256: "deadbeef".repeat(8),
    });
    assert.equal(bad.ok, false);
    assert.equal(bad.messageMatch, false);
  });
});

describe("WAVE reconstruct-from-chain-only", () => {
  it("sim inject records hashes only from sendTx; read path uses those hashes", async () => {
    const chain = createWaveSimChain();
    const prepared = prepareWaveWrap(WAVE_WISE_MESSAGE, { symbol: WAVE_WISE_SYM });
    const inscribed = await runWaveInscribe(prepared, chain.sendTx);
    assert.equal(inscribed.ok, true);
    assert.equal(inscribed.sealedCount, prepared.totalChunks);
    assert.equal(inscribed.txHashes.length, prepared.totalChunks);
    for (const h of inscribed.txHashes) {
      assert.match(h, /^0x[0-9a-f]{64}$/);
    }
    const read = await readWaveFromLocations(inscribed.txHashes, chain.fetchCalldata);
    assert.equal(read.ok, true);
    assert.equal(read.body, WAVE_WISE_MESSAGE);
    const key = loadWaveAnswerKey();
    const cmp = compareToAnswerKey(read.body, key);
    assert.equal(cmp.ok, true);
    assert.equal(cmp.messageMatch, true);
    assert.equal(cmp.shardsMatch, true);
  });

  it("null sendTx does not invent a hash; read cannot pass", async () => {
    const prepared = prepareWaveWrap("tiny-wave-xx", { symbol: "WAVE", vinId: "VIN-NULL00001" });
    const inscribed = await runWaveInscribe(prepared, async () => null);
    assert.equal(inscribed.ok, true);
    assert.equal(inscribed.sealedCount, 0);
    assert.deepEqual(inscribed.txHashes, []);
    assert.equal(inscribed.chunks[0].txHash, null);
    const bogus = await readWaveFromLocations(["0x" + "a".repeat(64)], async () => {
      throw new Error("sim chain has no calldata");
    });
    assert.equal(bogus.ok, false);
  });

  it("fixture hex read-back matches without claiming a Base tx", async () => {
    const prepared = prepareWaveWrap(WAVE_WISE_MESSAGE, { symbol: WAVE_WISE_SYM });
    const fixtures = prepared.lines.map((l) => ({ hex: l.hex }));
    const read = await readWaveFromLocations([], null, { fixtures });
    assert.equal(read.ok, true);
    assert.equal(read.body, WAVE_WISE_MESSAGE);
    const cmp = compareToAnswerKey(read.body, loadWaveAnswerKey());
    assert.equal(cmp.ok, true);
  });
});

describe("WAVE autonomous ping/pong rounds", () => {
  it("≥3 file+read ACK rounds then full reconstruct vs answer key", async () => {
    const result = await runWaveMirrorTest({ body: WAVE_WISE_MESSAGE });
    assert.equal(result.ok, true);
    assert.equal(result.pass, true);
    assert.equal(result.sim, true);
    assert.equal(result.live, false);
    assert.ok(result.rounds >= WAVE_MIN_ROUNDS);
    assert.equal(result.acks.length, result.rounds);
    assert.equal(result.acks[0].role, "PING");
    assert.equal(result.acks[1].role, "PONG");
    assert.equal(result.acks[2].role, "ACK");
    for (const ack of result.acks) {
      assert.equal(ack.ack, true);
      assert.match(ack.txHash, /^0x[0-9a-f]{64}$/);
    }
    assert.equal(result.reconstructed, WAVE_WISE_MESSAGE);
    assert.equal(result.compared.ok, true);
    assert.equal(result.answerKey.sha256, sha256HexUtf8(WAVE_WISE_MESSAGE));
  });

  it("/wavetest handler runs SIM and does not enable VITAFEED_PAID", async () => {
    assert.equal(parseWaveTestCommand("/wavetest").action, "run");
    assert.equal(parseWaveTestCommand("/wavetest hitch").action, "hitch");
    const out = await handleWaveTestAction({ action: "run", env: {} });
    assert.equal(out.pass, true);
    assert.equal(out.send, false);
    assert.match(out.reply, /PASS/);
    assert.match(out.reply, /VITAFEED_PAID default off/);
    assert.equal(vitaFeedPaidEnabled({}), false);
    const hitch = await handleWaveTestAction({ action: "hitch", env: {} });
    assert.equal(hitch.send, false);
    assert.match(hitch.reply, /leftover/i);
  });

  it("live flag without WAVE_MIRROR_PAID refuses rather than inventing txs", async () => {
    const result = await runWaveMirrorTest({
      body: WAVE_WISE_MESSAGE,
      live: true,
      env: {},
    });
    assert.equal(result.ok, false);
    assert.equal(result.pass, false);
    assert.match(result.reason, /WAVE_MIRROR_PAID default off/);
  });
});

describe("WAVE docs + CLI exist", () => {
  it("INJECT.md documents bits→shards→locations→read-back", () => {
    const md = readFileSync(join(root, "vita/INJECT.md"), "utf8");
    assert.match(md, /WAVE/);
    assert.match(md, /wavetest/);
    assert.match(md, /answer key/i);
    assert.match(md, /VITAFEED_PAID/);
  });

  it("CLI script is the optional live/sim runner", () => {
    const src = readFileSync(join(root, "scripts/wave-mirror-test.js"), "utf8");
    assert.match(src, /runWaveMirrorTest/);
    assert.match(src, /WAVE_WISE_MESSAGE/);
    assert.match(src, /WAVE_MIRROR_PAID/);
  });
});
