/**
 * End-to-end system loop (simulated):
 *   revenue → piggy compound → Storage Token → sparse inject → node rewards
 *   → capacity report → crypto-event stress
 *
 * Proves the equation adds up under labeled assumptions without touching
 * production trading paths.
 */

import { StorageModel } from "../models/storage-model.js";
import { TreasuryModel } from "../models/treasury-model.js";
import { CostModel } from "../models/cost-model.js";
import { StorageTokenLedger } from "../models/storage-token-model.js";
import { PiggyCompoundModel } from "../models/piggy-compound.js";
import { sparseInject, sparseRetrieve } from "../models/sparse-placement.js";
import { computeInjectionCapacity, planChunks } from "../models/injection-capacity.js";
import { runAllCryptoEvents, applyCryptoEvent } from "../models/crypto-events.js";
import { sha256Hex } from "./hashing.js";

/**
 * Simulate N revenue cycles, then operator call-to-add, then sparse-inject
 * a payload across the swarm, paying nodes in Storage Token.
 */
export function runSystemLoop({
  cycles = 40,
  initialLiquidUsd = 2.24,
  initialPiggyUsd = 0.18,
  initialBits = 10,
  nodeCount = 8,
  payloadBytes = 64 * 1024, // 64 KiB demo "clip" (not a full movie)
  lane = "STANDBY",
  callToAdd = true,
  seed = "system-loop-v0.1",
} = {}) {
  const piggy = new PiggyCompoundModel({
    initialPiggyUsd,
    liquidUsd: initialLiquidUsd,
    initialAgentUsd: 0,
  });
  const token = new StorageTokenLedger({ initialBalance: initialBits });
  const treasury = new TreasuryModel({ initialBalance: 10 });
  const cost = new CostModel();
  const storage = StorageModel.createUniformCluster({
    count: nodeCount,
    capacity: 50_000_000,
  });

  // Slow→fast revenue: early crumbs, later larger leftovers as liquid grows
  const before = piggy.snapshot();
  piggy.simulateCycles(cycles, (t, model) => {
    const base = Math.max(0.02, model.liquidUsd * 0.015);
    return base * (1 + 0.04 * t + 0.0015 * t * t);
  });
  const afterCycles = piggy.snapshot();

  let unlocked = null;
  if (callToAdd) {
    unlocked = piggy.callToAdd({ includeAgent: false });
    token.mintFromRevenue(unlocked.ready_usd, "CALL_TO_ADD_CONVERT");
  } else {
    token.mintFromRevenue(piggy.liquidUsd * 0.1, "PARTIAL_CONVERT_NO_UNLOCK");
  }

  const capacity = computeInjectionCapacity({
    tradeableUsd: piggy.liquidUsd,
    piggyUsd: piggy.piggyUsd,
    bagsUsd: 0,
    bitsBalance: token.balance,
  });

  // Build payload (deterministic from seed)
  const payload = Buffer.alloc(payloadBytes, 0);
  for (let i = 0; i < payload.length; i++) {
    payload[i] = (seed.charCodeAt(i % seed.length) + i) & 0xff;
  }
  const inputSha = sha256Hex(payload);

  const chunkPlan = planChunks(payloadBytes, lane);
  const quote = token.quoteInjection({
    chunkCount: chunkPlan.chunk_count,
    lane,
  });
  let injectPay = { ok: true, skipped: lane !== "FAST_PASS" };
  if (lane === "FAST_PASS") {
    injectPay = token.payInjection(quote);
  }

  let sparse = null;
  let retrieve = null;
  let verification = null;
  let economics = null;
  let deferred = null;

  if (!injectPay.ok) {
    deferred = { reason: injectPay.reason, quote };
  } else {
    economics = cost.estimate({
      byteLength: payloadBytes,
      chunkCount: chunkPlan.chunk_count,
      redundancy: 1,
    });
    const debit = treasury.debit(economics.simulated_cost, "SPARSE_INJECT");
    if (!debit.ok) {
      deferred = { reason: debit.reason, economics };
    } else {
      sparse = sparseInject(storage, `loop:${seed}`, payload, {
        replicas: 1,
        tokenLedger: token,
        publicPool: lane !== "SILO",
      });
      if (sparse.ok) {
        retrieve = sparseRetrieve(storage, `loop:${seed}`, sparse.shard_count, {
          replicas: 1,
        });
        verification = {
          exact_match: retrieve.ok && retrieve.sha256 === inputSha,
          input_sha256: inputSha,
          output_sha256: retrieve.ok ? retrieve.sha256 : null,
        };
      }
    }
  }

  return {
    BENCHMARK: "system-loop-0001",
    BENCHMARK_VERSION: "0.1.0",
    GENERATED_AT_KIND: "simulated",
    SEED: seed,
    PIGGY: {
      before,
      after_cycles: afterCycles,
      unlocked,
      final: piggy.snapshot(),
    },
    STORAGE_TOKEN: token.snapshot(),
    TREASURY: treasury.snapshot(),
    CAPACITY: capacity,
    INJECTION: {
      lane,
      payload_bytes: payloadBytes,
      chunk_plan: chunkPlan,
      quote,
      pay: injectPay,
      sparse,
      retrieve: retrieve
        ? {
            ok: retrieve.ok,
            sha256: retrieve.sha256,
            length: retrieve.length,
            shards: retrieve.shards_recovered,
          }
        : null,
      verification,
      economics,
      deferred,
    },
    STORAGE: storage.snapshot(),
    STATUS:
      deferred
        ? "DEFERRED"
        : verification?.exact_match
          ? "REPRODUCIBLE"
          : "FAIL",
    REPRODUCIBLE: verification?.exact_match === true,
    ASSUMPTIONS: [
      "kind=simulated",
      "boundary=no_root_trader_imports",
      `cycles=${cycles}`,
      `nodes=${nodeCount}`,
      "sparse=identity_stripe_all_online_nodes",
      "piggy_unlock=call_to_add_only",
    ],
  };
}

/**
 * Hard-push: system loop + every crypto event + optional node bank-run
 * against a sparsely stored object.
 */
export function runHardPushSuite(opts = {}) {
  const loop = runSystemLoop(opts);
  const events = runAllCryptoEvents({
    tradeable_usd: loop.CAPACITY.funds.with_call_to_add_usd,
    bits_balance: loop.STORAGE_TOKEN.balance,
    leftover_eth: loop.CAPACITY.market.leftover_eth_assumed,
    hitch_cost_eth: loop.CAPACITY.market.eureka_tag_cost_eth,
    total_nodes: loop.STORAGE.node_count,
    online_nodes: loop.STORAGE.online_count,
    gwei: 0.05,
  });

  // Extra: bank-run — drop 60% nodes. Thin replicas fail; wide replicas survive.
  let bankRun = null;
  {
    const n = opts.nodeCount ?? 8;
    const bytes = Buffer.from("BANKRUN-FIXTURE-PAYLOAD-0123456789");
    const dropRatio = 0.6;
    const dropN = Math.floor(n * dropRatio);
    const thinReplicas = 2;
    const wideReplicas = Math.min(n, dropN + 2); // enough copies to outlive contiguous drop

    const runCase = (replicas) => {
      const storage = StorageModel.createUniformCluster({
        count: n,
        capacity: 50_000_000,
      });
      const placed = sparseInject(storage, "bankrun", bytes, { replicas });
      for (let i = 0; i < dropN; i++) {
        storage.markOffline(storage.nodes[i].id, "BANK_RUN");
      }
      const got = sparseRetrieve(storage, "bankrun", placed.shard_count, {
        replicas,
      });
      return {
        replicas,
        placed_ok: placed.ok,
        retrieve_ok: got.ok,
        exact_match: got.ok && got.sha256 === sha256Hex(bytes),
        online_after: storage.nodes.filter((x) => x.online !== false).length,
      };
    };

    const thin = runCase(thinReplicas);
    const wide = runCase(wideReplicas);
    bankRun = {
      event: applyCryptoEvent("NODE_BANK_RUN", {
        total_nodes: n,
        online_nodes: n - dropN,
      }),
      drop_ratio: dropRatio,
      drop_count: dropN,
      thin_redundancy: thin,
      wide_redundancy: wide,
      lesson:
        "Identity stripe needs surviving replica per shard. Thin r=2 fails 60% bank-run; wide r>=drop+2 survives. Erasure k-of-n is the next Arena research target.",
      exact_match: wide.exact_match === true,
    };
  }

  const hardFails = [
    ...events.hard_fails,
    ...(loop.STATUS === "FAIL" ? ["SYSTEM_LOOP_INTEGRITY"] : []),
    ...(bankRun && !bankRun.exact_match ? ["BANK_RUN_WIDE_RETRIEVE"] : []),
  ];

  return {
    BENCHMARK: "hard-push-crypto-0001",
    BENCHMARK_VERSION: "0.1.0",
    GENERATED_AT_KIND: "simulated",
    SYSTEM_LOOP: loop,
    CRYPTO_EVENTS: events,
    BANK_RUN: bankRun,
    VERDICT: {
      system_loop: loop.STATUS,
      crypto_catalog: events.STATUS,
      bank_run_survived: bankRun ? bankRun.exact_match === true : null,
      hard_fails: hardFails,
      proven: hardFails.length === 0 && loop.REPRODUCIBLE,
      capacity_now_bytes: loop.CAPACITY.capacity_now.max_hitch_bytes_per_swap,
      movie_720p_cycles: loop.CAPACITY.movie_horizon.cycles_at_current_leftover_720p,
      piggy_ready_usd: loop.PIGGY.unlocked?.ready_usd ?? loop.PIGGY.final.liquid_usd,
    },
    STATUS: hardFails.length === 0 && loop.REPRODUCIBLE ? "PROVEN" : "GAPS",
    ASSUMPTIONS: [
      ...loop.ASSUMPTIONS,
      ...events.ASSUMPTIONS,
      "hard_push=catalog+bank_run+system_loop",
    ],
  };
}
