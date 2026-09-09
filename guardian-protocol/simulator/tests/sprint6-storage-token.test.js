/**
 * Sprint 6 — Storage Token loop, sparse inject, crypto-event hard-push.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { StorageTokenLedger } from "../models/storage-token-model.js";
import { PiggyCompoundModel } from "../models/piggy-compound.js";
import { StorageModel } from "../models/storage-model.js";
import {
  sparseInject,
  sparseRetrieve,
  stripeBytes,
} from "../models/sparse-placement.js";
import {
  computeInjectionCapacity,
  hitchCostEth,
  maxHitchBytes,
  planChunks,
} from "../models/injection-capacity.js";
import {
  CRYPTO_EVENTS,
  listCryptoEvents,
  applyCryptoEvent,
  runAllCryptoEvents,
  evaluateSurvival,
} from "../models/crypto-events.js";
import { runSystemLoop, runHardPushSuite } from "../core/system-loop.js";
import { runCryptoStressBenchmark } from "../benchmarks/run-crypto-stress.js";
import { sha256Hex } from "../core/hashing.js";

describe("sprint6 storage token", () => {
  it("quotes Fast Pass and refuses when underfunded", () => {
    const ledger = new StorageTokenLedger({ initialBalance: 3 });
    const q = ledger.quoteInjection({ chunkCount: 2, lane: "FAST_PASS" });
    assert.equal(q.cost_bits, 10);
    assert.equal(q.affordable, false);
    const pay = ledger.payInjection(q);
    assert.equal(pay.ok, false);
    assert.equal(pay.reason, "INSUFFICIENT_BITS");
  });

  it("mints from revenue and rewards nodes per KB", () => {
    const ledger = new StorageTokenLedger({ initialBalance: 0 });
    ledger.mintFromRevenue(1.5, "TEST");
    assert.equal(ledger.balance, 150);
    const r = ledger.rewardNode("node-0", 2048);
    assert.equal(r.kb, 2);
    assert.ok(r.bits > 0);
    assert.ok(ledger.snapshot().node_earnings["node-0"] > 0);
  });

  it("Standby injection costs 0 BITS", () => {
    const ledger = new StorageTokenLedger({ initialBalance: 0 });
    const q = ledger.quoteInjection({ chunkCount: 100, lane: "STANDBY" });
    assert.equal(q.cost_bits, 0);
    assert.equal(q.affordable, true);
  });
});

describe("sprint6 sparse placement", () => {
  it("stripes across all online nodes and reconstructs bit-exact", () => {
    const storage = StorageModel.createUniformCluster({ count: 5, capacity: 1e7 });
    const token = new StorageTokenLedger({ initialBalance: 50 });
    const bytes = Buffer.from("movie-clip-fixture-" + "A".repeat(500));
    const placed = sparseInject(storage, "obj1", bytes, {
      replicas: 1,
      tokenLedger: token,
      publicPool: true,
    });
    assert.equal(placed.ok, true);
    assert.equal(placed.shard_count, 5);
    assert.equal(placed.online_used.length, 5);
    assert.ok(placed.paid.length >= 5);
    const got = sparseRetrieve(storage, "obj1", placed.shard_count);
    assert.equal(got.ok, true);
    assert.equal(got.sha256, sha256Hex(bytes));
  });

  it("stripeBytes preserves length and hash", () => {
    const buf = Buffer.from("xyz".repeat(100));
    const { shards, originalLength, originalSha256 } = stripeBytes(buf, 4);
    assert.equal(originalLength, buf.length);
    assert.equal(originalSha256, sha256Hex(buf));
    assert.ok(shards.length <= 4);
    assert.equal(Buffer.concat(shards.map((s) => s.data)).equals(buf), true);
  });
});

describe("sprint6 piggy compound", () => {
  it("accrues slowly then faster; unlock only on call-to-add", () => {
    const piggy = new PiggyCompoundModel({
      liquidUsd: 2.24,
      initialPiggyUsd: 0.1,
    });
    assert.equal(piggy.spendableUsd(), 2.24);
    piggy.simulateCycles(30);
    const mid = piggy.snapshot();
    assert.ok(mid.piggy_usd > 0.1);
    assert.ok(mid.effective_skim_pct >= 0.05);
    assert.equal(piggy.spendableUsd(), mid.liquid_usd);
    const unlocked = piggy.callToAdd();
    assert.ok(unlocked.ready_usd >= unlocked.liquid_usd);
    assert.equal(piggy.piggyUsd, 0);
  });

  it("never accrues on non-positive revenue", () => {
    const piggy = new PiggyCompoundModel({ liquidUsd: 1, initialPiggyUsd: 1 });
    const before = piggy.piggyUsd;
    piggy.accrue(0);
    piggy.accrue(-5);
    assert.equal(piggy.piggyUsd, before);
  });
});

describe("sprint6 injection capacity", () => {
  it("computes live-thin-book capacity without inventing profit", () => {
    const cap = computeInjectionCapacity({
      tradeableUsd: 2.24,
      bagsUsd: 5,
      piggyUsd: 0.18,
      bitsBalance: 10,
    });
    assert.equal(cap.kind, "simulated");
    assert.ok(cap.funds.without_unlock_usd === 2.24);
    assert.ok(cap.funds.with_call_to_add_usd > 2.24);
    assert.ok(cap.capacity_now.max_hitch_bytes_per_swap >= 0);
    assert.ok(cap.movie_horizon.cycles_at_current_leftover_720p == null ||
      cap.movie_horizon.cycles_at_current_leftover_720p > 0);
  });

  it("gas pause zeroes hitch capacity", () => {
    const cap = computeInjectionCapacity({
      tradeableUsd: 100,
      assumptions: { gwei: 60 },
    });
    assert.equal(cap.market.gas_paused, true);
    assert.equal(cap.capacity_now.max_hitch_bytes_per_swap, 0);
  });

  it("hitch cost and max bytes are inverse", () => {
    const cost = hitchCostEth(1000, { gwei: 1 });
    assert.ok(cost > 0);
    const max = maxHitchBytes(cost * 10, { gwei: 1 });
    assert.ok(max >= 10);
    const plan = planChunks(50_000, "FAST_PASS");
    assert.ok(plan.chunk_count >= 1);
  });
});

describe("sprint6 crypto events", () => {
  it("catalog covers freeze classes", () => {
    const list = listCryptoEvents();
    assert.ok(list.length >= 10);
    assert.ok(CRYPTO_EVENTS.GAS_SPIKE);
    assert.ok(CRYPTO_EVENTS.NODE_BANK_RUN);
  });

  it("gas spike safely freezes rather than corrupting", () => {
    const r = applyCryptoEvent("GAS_SPIKE", {
      leftover_eth: 0.01,
      hitch_cost_eth: 1e-8,
      tradeable_usd: 20,
      min_entry_usd: 2,
    });
    assert.equal(r.ok, true);
    assert.equal(r.checks.can_trade, false);
    assert.equal(r.checks.mode, "SAFE_FREEZE");
  });

  it("RPC outage survives via failover; total failure is hard fail", () => {
    const withFailover = applyCryptoEvent("RPC_OUTAGE", {});
    assert.equal(withFailover.ok, true);
    assert.ok(withFailover.checks.notes.includes("RPC_FAILOVER_USED"));

    const totalDead = evaluateSurvival(CRYPTO_EVENTS.RPC_OUTAGE, {
      rpc_alive: false,
      failover_ok: false,
      blocks_progressing: true,
      leftover_eth: 0.01,
      hitch_cost_eth: 1e-9,
      tradeable_usd: 10,
      min_entry_usd: 2,
      bits_balance: 100,
      online_nodes: 5,
      total_nodes: 5,
      bandwidth_ok: true,
      organic_gap_rate: 0.5,
      gwei: 0.05,
      pause_above_gwei: 50,
      price_insane: false,
    });
    assert.equal(totalDead.survives, false);
    assert.equal(totalDead.mode, "HARD_FAIL");
  });

  it("runAllCryptoEvents reports catalog status", () => {
    const report = runAllCryptoEvents({
      leftover_eth: 0.01,
      hitch_cost_eth: 1e-9,
      tradeable_usd: 10,
      min_entry_usd: 2,
      bits_balance: 100,
      total_nodes: 10,
      online_nodes: 10,
    });
    assert.equal(report.event_count, listCryptoEvents().length);
    assert.ok(report.survived >= 1);
  });
});

describe("sprint6 system loop + hard push", () => {
  it("system loop sparsely injects and reconstructs", () => {
    const loop = runSystemLoop({
      cycles: 15,
      payloadBytes: 4096,
      nodeCount: 6,
      callToAdd: true,
    });
    assert.equal(loop.STATUS, "REPRODUCIBLE");
    assert.equal(loop.REPRODUCIBLE, true);
    assert.ok(loop.INJECTION.sparse.ok);
    assert.ok(loop.STORAGE_TOKEN.earned > 0 || loop.STORAGE_TOKEN.balance >= 0);
    assert.ok(loop.PIGGY.unlocked.ready_usd > 0);
  });

  it("hard-push suite proves under catalog with wide bank-run", () => {
    const suite = runHardPushSuite({
      cycles: 12,
      payloadBytes: 2048,
      nodeCount: 8,
    });
    assert.equal(suite.SYSTEM_LOOP.STATUS, "REPRODUCIBLE");
    assert.equal(suite.BANK_RUN.wide_redundancy.exact_match, true);
    assert.equal(suite.BANK_RUN.thin_redundancy.exact_match, false);
    assert.equal(suite.STATUS, "PROVEN");
    assert.equal(suite.VERDICT.proven, true);
  });

  it("writes crypto stress arena report", () => {
    const { envelope, outPath } = runCryptoStressBenchmark({
      cycles: 10,
      payloadBytes: 1024,
      nodeCount: 8,
    });
    assert.ok(outPath.includes("crypto-stress-hard-push.json"));
    assert.equal(envelope.STATUS, "PROVEN");
    assert.ok(envelope.CAPACITY_AT_START.funds.tradeable_usd > 0);
  });
});
