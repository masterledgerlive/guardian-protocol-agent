import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  transmissionErrorBufferEth,
  spendableForTransmissionEth,
  sizeHatBytesForWave,
  waveSellTargetWithTransmission,
  nextReadyCursor,
  planWaveHatRide,
  confirmHatWaveSend,
  evaluateConfirmedSendExit,
  waveBitsAffordable,
  TRANSMISSION_ERROR_PCT,
} from "./hat-wave-inject.js";
import {
  setHatRegistry,
  getHatRegistry,
  mintOneBitTest,
  appendHatNodeDraft,
  bytesToBits,
  buildCanonicalSiteBlob,
  contentSha256,
  HAT_MAGIC,
} from "./vita-hat.js";

function tinyBits() {
  const files = [{ path: "t.html", bytes: Buffer.from("HELLO-HAT-WAVE") }];
  const blob = buildCanonicalSiteBlob(files);
  return {
    files,
    blob,
    bits: bytesToBits(blob),
    hash: contentSha256(blob),
  };
}

describe("hat-wave: transmission error buffer + sizing", () => {
  it("reserves error cushion so we do not spend all leftover", () => {
    const err = transmissionErrorBufferEth(0.001);
    assert.ok(err > 0);
    assert.ok(err <= 0.001 * 0.5);
    assert.equal(transmissionErrorBufferEth(0), 0);
  });

  it("earnings must not increase hitch spendable beyond leftover", () => {
    const thin = spendableForTransmissionEth({ leftoverEth: 0.0001, earningsEth: 0 });
    const rich = spendableForTransmissionEth({
      leftoverEth: 0.0001,
      earningsEth: 0.001,
      useEarningsFraction: 0.5,
    });
    assert.equal(rich.spendableEth, thin.spendableEth);
    assert.ok(rich.spendableEth <= 0.0001);
    assert.ok(rich.errorBufferEth > 0);
  });

  it("sizes more payload bytes when leftover covers cost (not stuck at 1 bit)", () => {
    const tiny = sizeHatBytesForWave({
      leftoverEth: 0.00001,
      gwei: 0.05,
      wantedBytes: 10_000,
    });
    const fat = sizeHatBytesForWave({
      leftoverEth: 0.01,
      earningsEth: 0.002,
      gwei: 0.05,
      wantedBytes: 10_000,
    });
    assert.ok(fat.payloadBits > tiny.payloadBits || fat.hitchBytes > tiny.hitchBytes);
    assert.ok(fat.payloadBits >= 8 || fat.hitchBytes > 120);
    assert.equal(typeof TRANSMISSION_ERROR_PCT, "number");
  });

  it("waveBitsAffordable reports cost-per-bit when paid", () => {
    const a = waveBitsAffordable({ leftoverEth: 0.005, gwei: 0.05 });
    if (!a.skipHitch && a.bits > 0) {
      assert.ok(a.costPerBitEth > 0);
    }
  });

  it("large hitch payload cannot cost more than leftover (always-plus)", () => {
    const leftover = 0.00008;
    const sized = sizeHatBytesForWave({
      leftoverEth: leftover,
      earningsEth: 0.01,
      gwei: 1,
      wantedBytes: 10_000,
      hitchCostMult: 1,
    });
    assert.ok(sized.skipHitch || sized.injectCostEth < leftover);
    assert.ok(sized.spendableEth <= leftover);
  });
});

describe("hat-wave: sell target hard-codes transmission", () => {
  it("raises sell floor when hitch bytes grow", () => {
    const small = waveSellTargetWithTransmission({
      entryEth: 0.01,
      projectedProceedsEth: 0.012,
      feePct: 0.003,
      gasCostEth: 0.0001,
      hitchBytes: 10,
      gwei: 0.05,
    });
    const big = waveSellTargetWithTransmission({
      entryEth: 0.01,
      projectedProceedsEth: 0.012,
      feePct: 0.003,
      gasCostEth: 0.0001,
      hitchBytes: 2000,
      gwei: 0.05,
    });
    assert.ok(big.sellTargetEth > small.sellTargetEth);
    assert.ok(big.errorBufferEth >= 0);
  });
});

describe("hat-wave: cursor + confirm + exit up", () => {
  beforeEach(() => {
    setHatRegistry({
      strandId: null,
      contentHash: null,
      lastHash: "00000000",
      nodes: [],
      totalBits: 0,
    });
  });

  it("next-ready stays at 0 until genesis is sealed", () => {
    const { bits, hash, files } = tinyBits();
    mintOneBitTest({ bits, contentHash: hash, files });
    const cur = nextReadyCursor({ ...getHatRegistry(), totalBits: bits.length });
    assert.equal(cur.nextBit, 0);
    assert.equal(cur.pendingUnsealed, 1);
    assert.equal(cur.ready, false);
  });

  it("plan waits for confirm; after seal cursor advances and larger chunk can hitch", () => {
    const { bits, hash, files } = tinyBits();
    const genesis = mintOneBitTest({ bits, contentHash: hash, files });
    const wait = planWaveHatRide({
      bits,
      leftoverEth: 0.01,
      gwei: 0.05,
      registry: getHatRegistry(),
    });
    assert.equal(wait.action, "wait_confirm");

    const conf = confirmHatWaveSend({
      nodeIdOrSeq: genesis.nodeId,
      txHash: "0x" + "ab".repeat(32),
    });
    assert.equal(conf.ok, true);
    assert.equal(conf.confirmed, true);
    assert.ok(conf.reader.location.startsWith("0x"));

    const cur = nextReadyCursor({ ...getHatRegistry(), totalBits: bits.length });
    assert.equal(cur.nextBit, 1);
    assert.equal(cur.ready, true);

    const ride = planWaveHatRide({
      bits,
      leftoverEth: 0.01,
      earningsEth: 0.001,
      gwei: 0.05,
      registry: getHatRegistry(),
      contentHash: hash,
    });
    assert.equal(ride.action, "hitch");
    assert.ok(ride.sized.payloadBits >= 1);
    assert.ok(ride.packet.startsWith(HAT_MAGIC));
    assert.equal(ride.packet.includes("HELLO"), false);
    assert.equal(ride.confirmRequired, true);

    const drafted = appendHatNodeDraft(ride.nodeDraft);
    const conf2 = confirmHatWaveSend({
      nodeIdOrSeq: drafted.nodeId,
      txHash: "0x" + "cd".repeat(32),
    });
    assert.equal(conf2.ok, true);
    const cur2 = nextReadyCursor({ ...getHatRegistry(), totalBits: bits.length });
    assert.ok(cur2.nextBit > 1);
  });

  it("refuses confirm without txHash", () => {
    const { bits, hash, files } = tinyBits();
    const genesis = mintOneBitTest({ bits, contentHash: hash, files });
    const bad = confirmHatWaveSend({ nodeIdOrSeq: genesis.nodeId, txHash: "" });
    assert.equal(bad.ok, false);
    assert.equal(bad.confirmed, false);
  });

  it("confirmed-send exit sells on the way up without crash", () => {
    const hold = evaluateConfirmedSendExit({
      messageConfirmed: false,
      locationSealed: false,
      price: 12,
      entry: 10,
      leftoverEth: 0.001,
      feesEth: 0.0001,
    });
    assert.equal(hold.sell, false);

    const up = evaluateConfirmedSendExit({
      messageConfirmed: true,
      locationSealed: true,
      location: "0xdead",
      price: 12,
      entry: 10,
      leftoverEth: 0.001,
      feesEth: 0.0001,
      netUsd: 1,
      breakEvenBuffer: 0.1,
    });
    assert.equal(up.sell, true);
    assert.equal(up.kind, "confirmed_send_exit");

    const underwater = evaluateConfirmedSendExit({
      messageConfirmed: true,
      locationSealed: true,
      price: 9,
      entry: 10,
      leftoverEth: 0.001,
      feesEth: 0.0001,
    });
    assert.equal(underwater.sell, false);
  });
});
