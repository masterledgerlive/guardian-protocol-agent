/**
 * SimulationController — end-to-end preservation pipeline (Sprint 1–4).
 */
import { loadCanonicalFromBuffer } from "./canonical-loader.js";
import { chunkBytes, merkleRootFromChunkHashes } from "./chunker.js";
import { StateMachine } from "./state-machine.js";
import { ReplayLogger } from "./replay-logger.js";
import { reconstructFromChunks, verifyReconstruction } from "./integrity-verifier.js";
import { CostModel } from "../models/cost-model.js";
import { TreasuryModel } from "../models/treasury-model.js";
import { StorageModel } from "../models/storage-model.js";
import { FailureModel, classifyTail } from "../models/failure-model.js";
import { computeMetrics } from "../metrics/engine.js";
import { getStrategy } from "../strategies/registry.js";
import "../../strategies/load-all.js";

export class SimulationController {
  constructor({
    strategyKey = "FIFO-0.1",
    costModel = new CostModel(),
    treasury = new TreasuryModel({ initialBalance: 10 }),
    storage = StorageModel.createUniformCluster({ count: 3, capacity: 10_000_000 }),
    failure = null,
    now = () => Date.now(),
  } = {}) {
    this.strategy = getStrategy(strategyKey);
    this.costModel = costModel;
    this.treasury = treasury;
    this.storage = storage;
    this.failure = failure;
    this.now = now;
    this.replay = new ReplayLogger();
    this.repairEvents = [];
  }

  run(canonicalInput, { objectId = "obj-0001", priority = null } = {}) {
    const t0 = this.now();
    const canonical =
      Buffer.isBuffer(canonicalInput) || typeof canonicalInput === "string"
        ? loadCanonicalFromBuffer(canonicalInput, { objectId })
        : canonicalInput;

    const sm = new StateMachine(objectId);
    const job = {
      objectId,
      byteLength: canonical.byteLength,
      sha256: canonical.sha256,
      priority: priority ?? canonical.priority ?? null,
    };
    const tail = classifyTail(canonical.byteLength);

    const emit = (previous, next, extra = {}) => {
      this.replay.emit({
        object_id: objectId,
        previous_state: previous,
        new_state: next,
        timestamp: this.now() - t0,
        strategy_id: this.strategy.id,
        strategy_version: this.strategy.version,
        ...extra,
      });
    };

    // Apply pre-run node drops (stress) — recorded before lifecycle transitions
    if (this.failure) {
      for (const id of this.failure.dropNodeIds) {
        this.storage.markOffline(id, "STRESS_DROP");
        this.replay.emit({
          object_id: objectId,
          previous_state: null,
          new_state: "RECEIVED",
          timestamp: this.now() - t0,
          strategy_id: this.strategy.id,
          strategy_version: this.strategy.version,
          reason_code: "STRESS_DROP",
          resource_state: { offline: id },
        });
      }
    }

    // RECEIVED → VALIDATED
    let tr = sm.transition("VALIDATED", { timestamp: this.now() - t0, reason: "INPUT_OK" });
    emit(tr.previous, tr.next, {
      reason_code: "INPUT_OK",
      cryptographic_references: { input_sha256: canonical.sha256 },
      tail_class: tail.class,
    });

    const plan = this.strategy.schedule(job, { treasury: this.treasury.snapshot() });

    // CHUNKED
    const rawChunks = chunkBytes(canonical.bytes, plan.chunkSize);
    tr = sm.transition("CHUNKED", { timestamp: this.now() - t0, reason: plan.reason });
    emit(tr.previous, tr.next, {
      reason_code: plan.reason,
      chunk_count: rawChunks.length,
      chunk_size: plan.chunkSize,
      lane: plan.lane,
      redundancy: plan.redundancy,
    });

    // ENCODED
    const encoded = this.strategy.encodeChunks(rawChunks);
    const merkle = merkleRootFromChunkHashes(encoded.map((c) => c.sha256));
    tr = sm.transition("ENCODED", { timestamp: this.now() - t0, reason: "IDENTITY_ENCODE" });
    emit(tr.previous, tr.next, {
      reason_code: "IDENTITY_ENCODE",
      cryptographic_references: { merkle_root: merkle },
    });

    // COST_ESTIMATED
    const economics = this.costModel.estimate({
      byteLength: canonical.byteLength,
      chunkCount: encoded.length,
      redundancy: plan.redundancy,
    });
    tr = sm.transition("COST_ESTIMATED", { timestamp: this.now() - t0, reason: "COST_MODEL" });
    emit(tr.previous, tr.next, {
      reason_code: "COST_MODEL",
      estimated_cost: economics.simulated_cost,
    });

    // TREASURY_CHECK
    tr = sm.transition("TREASURY_CHECK", { timestamp: this.now() - t0, reason: "RESERVE_CHECK" });
    emit(tr.previous, tr.next, {
      reason_code: "RESERVE_CHECK",
      resource_state: this.treasury.snapshot(),
      estimated_cost: economics.simulated_cost,
    });

    const debit = this.treasury.debit(economics.simulated_cost, "PRESERVE");
    if (!debit.ok) {
      tr = sm.transition("DEFERRED", { timestamp: this.now() - t0, reason: debit.reason });
      emit(tr.previous, tr.next, { reason_code: debit.reason, resource_state: this.treasury.snapshot() });
      return this.#report({
        canonical,
        objectId,
        sm,
        economics,
        verification: {
          reconstruction: "FAIL",
          exact_match: false,
          input_sha256: canonical.sha256,
          output_sha256: null,
          input_bytes: canonical.byteLength,
          output_bytes: 0,
        },
        timings: { injection_time: this.now() - t0, retrieval_time: 0, reconstruction_time: 0 },
        encodedBytes: 0,
        chunkCount: encoded.length,
        status: "DEFERRED",
        reproducible: true,
        tail,
        plan,
      });
    }

    tr = sm.transition("SCHEDULED", {
      timestamp: this.now() - t0,
      reason: `LANE_${plan.lane.toUpperCase()}`,
    });
    emit(tr.previous, tr.next, {
      reason_code: `LANE_${plan.lane.toUpperCase()}`,
      actual_cost: economics.simulated_cost,
      resource_state: this.treasury.snapshot(),
    });

    // INJECTED + STORED
    const placements = [];
    for (const chunk of encoded) {
      for (let r = 0; r < plan.redundancy; r++) {
        const fragmentId = `${objectId}:${chunk.index}:r${r}`;
        if (this.failure && !this.failure.bandwidthOk(chunk.encoded.length)) {
          tr = sm.transition("FAILED", { timestamp: this.now() - t0, reason: "BANDWIDTH_CAP" });
          emit(tr.previous, tr.next, { reason_code: "BANDWIDTH_CAP", fragmentId });
          throw new Error(`Bandwidth cap exceeded for ${fragmentId}`);
        }
        const result = this.storage.storeRoundRobin(fragmentId, chunk.encoded);
        if (this.failure) this.failure.onStore(this.storage);
        if (!result.ok) {
          tr = sm.transition("FAILED", { timestamp: this.now() - t0, reason: result.reason });
          emit(tr.previous, tr.next, { reason_code: result.reason });
          throw new Error(`Storage failed: ${result.reason}`);
        }
        placements.push({ fragmentId, ...result, index: chunk.index, replica: r });
      }
    }

    tr = sm.transition("INJECTED", { timestamp: this.now() - t0, reason: "SWARM_WRITE" });
    emit(tr.previous, tr.next, { reason_code: "SWARM_WRITE", placements: placements.length });

    tr = sm.transition("STORED", { timestamp: this.now() - t0, reason: "FRAGMENTS_ACK" });
    emit(tr.previous, tr.next, {
      reason_code: "FRAGMENTS_ACK",
      resource_state: this.storage.snapshot(),
    });

    const tInject = this.now() - t0;

    // Retrieve + reconstruct (try all replicas; repair if needed)
    const tRet0 = this.now();
    const recovered = [];
    for (const chunk of encoded) {
      let found = null;
      for (let r = 0; r < plan.redundancy; r++) {
        const fragmentId = `${objectId}:${chunk.index}:r${r}`;
        const res = this.storage.retrieveAnywhere(fragmentId);
        if (res.ok) {
          found = res.data;
          // Opportunistic repair of missing replica slots
          for (let rr = 0; rr < plan.redundancy; rr++) {
            const otherId = `${objectId}:${chunk.index}:r${rr}`;
            if (!this.storage.retrieveAnywhere(otherId).ok) {
              const repaired = this.storage.repairFragment(fragmentId);
              if (repaired.ok) {
                // Store under the missing replica id as well
                this.storage.storeRoundRobin(otherId, found);
                this.repairEvents.push({ ...repaired, missing: otherId });
                emit("STORED", "STORED", {
                  reason_code: "REPAIR",
                  cryptographic_references: { fragment: otherId },
                });
              }
            }
          }
          break;
        }
      }
      if (!found) {
        tr = sm.transition("FAILED", { timestamp: this.now() - t0, reason: "RETRIEVE_MISS" });
        emit(tr.previous, tr.next, { reason_code: "RETRIEVE_MISS", chunk_index: chunk.index });
        throw new Error(`Missing fragment for chunk ${chunk.index}`);
      }
      recovered.push({ index: chunk.index, data: found });
    }
    const tRetrieval = this.now() - tRet0;

    const tRec0 = this.now();
    const reconstructed = reconstructFromChunks(recovered);
    const verification = verifyReconstruction(canonical.bytes, reconstructed);
    const tReconstruction = this.now() - tRec0;

    tr = sm.transition("VERIFIED", {
      timestamp: this.now() - t0,
      reason: verification.exact_match ? "BIT_EXACT" : "MISMATCH",
    });
    emit(tr.previous, tr.next, {
      reason_code: verification.exact_match ? "BIT_EXACT" : "MISMATCH",
      cryptographic_references: {
        input_sha256: verification.input_sha256,
        output_sha256: verification.output_sha256,
        merkle_root: merkle,
      },
    });

    if (!verification.exact_match) {
      tr = sm.transition("FAILED", { timestamp: this.now() - t0, reason: "INTEGRITY_FAIL" });
      emit(tr.previous, tr.next, { reason_code: "INTEGRITY_FAIL" });
    } else {
      tr = sm.transition("INDEXED", { timestamp: this.now() - t0, reason: "MANIFEST_INDEX" });
      emit(tr.previous, tr.next, {
        reason_code: "MANIFEST_INDEX",
        cryptographic_references: { merkle_root: merkle },
      });
      tr = sm.transition("ARCHIVED", { timestamp: this.now() - t0, reason: "COMPLETE" });
      emit(tr.previous, tr.next, { reason_code: "COMPLETE" });
    }

    const encodedBytes = encoded.reduce((s, c) => s + c.encoded.length, 0);

    return this.#report({
      canonical,
      objectId,
      sm,
      economics,
      verification,
      timings: {
        injection_time: tInject,
        retrieval_time: tRetrieval,
        reconstruction_time: tReconstruction,
      },
      encodedBytes,
      chunkCount: encoded.length,
      merkle,
      status: verification.exact_match ? "REPRODUCIBLE" : "NOT_REPRODUCIBLE",
      reproducible: verification.exact_match,
      placements,
      tail,
      plan,
    });
  }

  #report({
    canonical,
    objectId,
    sm,
    economics,
    verification,
    timings,
    encodedBytes,
    chunkCount,
    merkle,
    status,
    reproducible,
    placements = [],
    tail = null,
    plan = null,
  }) {
    const metrics = computeMetrics({
      verification,
      economics,
      timings,
      chunkCount,
      encodedBytes,
      nodeSnapshot: this.storage.snapshot(),
      eventCount: this.replay.events.length,
      repairCount: this.repairEvents.length,
    });

    return {
      BENCHMARK_META: {
        object_id: objectId,
        strategy: this.strategy.strategyKey,
        final_state: sm.state,
        lane: plan?.lane ?? null,
        redundancy: plan?.redundancy ?? null,
      },
      INPUT: {
        bytes: canonical.byteLength,
        sha256: canonical.sha256,
        label: canonical.label,
        tail_class: tail?.class ?? null,
      },
      PIPELINE: {
        chunks: chunkCount,
        encoded_bytes: encodedBytes,
        redundancy: economics.redundancy,
        merkle_root: merkle ?? null,
        placements: placements.length,
        repairs: this.repairEvents.length,
      },
      RESULT: {
        reconstruction: verification.reconstruction,
        output_sha256: verification.output_sha256,
        exact_match: verification.exact_match,
      },
      ECONOMICS: {
        simulated_cost: economics.simulated_cost,
        storage_cost: economics.storage_cost,
        compute_cost: economics.compute_cost,
        bandwidth_cost: economics.bandwidth_cost,
        proof_cost: economics.proof_cost,
        transaction_cost: economics.transaction_cost,
        node_reward: economics.node_reward,
        kind: "simulated",
      },
      PERFORMANCE: {
        injection_time: timings.injection_time,
        retrieval_time: timings.retrieval_time,
        reconstruction_time: timings.reconstruction_time,
        kind: "simulated_wall_ms_or_counter",
      },
      TRACE: {
        events: this.replay.events.length,
        replay_hash: this.replay.replayHash(),
      },
      STRESS: this.failure ? this.failure.snapshot() : null,
      ASSUMPTIONS: [
        ...this.strategy.assumptions,
        `cost_model=${this.costModel.assumptions.label}`,
        ...Object.entries(this.costModel.assumptions)
          .filter(([k]) => k !== "label")
          .map(([k, v]) => `cost.${k}=${v}`),
        "kind=simulated",
      ],
      METRICS: metrics,
      TREASURY: this.treasury.snapshot(),
      STORAGE: this.storage.snapshot(),
      STATUS: status,
      REPRODUCIBLE: reproducible,
      replay: this.replay.toJSON(),
    };
  }
}
