import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sha256Hex, hashCanonical } from "../core/hashing.js";
import { chunkBytes, merkleRootFromChunkHashes } from "../core/chunker.js";
import { StateMachine } from "../core/state-machine.js";
import { verifyReconstruction, reconstructFromChunks } from "../core/integrity-verifier.js";
import { CostModel } from "../models/cost-model.js";
import { TreasuryModel } from "../models/treasury-model.js";
import { SimulationController } from "../core/simulation-controller.js";
import { runBenchmark0001 } from "../benchmarks/run-0001.js";

describe("hashing", () => {
  it("sha256 matches known empty digest", () => {
    assert.equal(
      sha256Hex(Buffer.alloc(0)),
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
  });

  it("canonical json hashing is key-order stable", () => {
    assert.equal(hashCanonical({ b: 1, a: 2 }), hashCanonical({ a: 2, b: 1 }));
  });
});

describe("chunker", () => {
  it("chunks and merkle-commits", () => {
    const chunks = chunkBytes(Buffer.from("abcdefghij"), 4);
    assert.equal(chunks.length, 3);
    assert.equal(chunks[0].length, 4);
    assert.equal(chunks[2].length, 2);
    const root = merkleRootFromChunkHashes(chunks.map((c) => c.sha256));
    assert.equal(root.length, 64);
  });
});

describe("state machine", () => {
  it("allows happy path and rejects illegal jumps", () => {
    const sm = new StateMachine("x");
    sm.transition("VALIDATED");
    sm.transition("CHUNKED");
    assert.throws(() => sm.transition("ARCHIVED"));
  });
});

describe("integrity", () => {
  it("detects bit-exact match and mismatch", () => {
    const a = Buffer.from("hello");
    const b = Buffer.from("hello");
    const c = Buffer.from("hallo");
    assert.equal(verifyReconstruction(a, b).exact_match, true);
    assert.equal(verifyReconstruction(a, c).exact_match, false);
    const rebuilt = reconstructFromChunks([
      { index: 1, data: Buffer.from("lo") },
      { index: 0, data: Buffer.from("hel") },
    ]);
    assert.equal(Buffer.compare(rebuilt, a), 0);
  });
});

describe("treasury + cost", () => {
  it("defers when reserve cannot cover cost", () => {
    const treasury = new TreasuryModel({ initialBalance: 0.0000001, reserveRatio: 0.5 });
    const cost = new CostModel().estimate({ byteLength: 10_000, chunkCount: 40, redundancy: 1 });
    assert.equal(treasury.canAfford(cost.simulated_cost), false);
  });
});

describe("simulation FIFO-0.1", () => {
  it("preserves and reconstructs a buffer", () => {
    let t = 0;
    const sim = new SimulationController({ now: () => ++t });
    const report = sim.run(Buffer.from("Guardian L1 bit-exact fixture"), { objectId: "t1" });
    assert.equal(report.RESULT.exact_match, true);
    assert.equal(report.RESULT.reconstruction, "PASS");
    assert.equal(report.STATUS, "REPRODUCIBLE");
    assert.ok(report.TRACE.events > 10);
    assert.equal(report.TRACE.replay_hash.length, 64);
  });

  it("benchmark 0001 passes", () => {
    const { envelope } = runBenchmark0001();
    assert.equal(envelope.RESULT.exact_match, true);
    assert.equal(envelope.INPUT.sha256, envelope.INPUT_FILE_SHA256);
    assert.equal(envelope.STRATEGY, "FIFO-0.1");
  });
});
