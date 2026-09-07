/**
 * Metrics engine — primary + derived.
 */
export function computeMetrics({
  verification,
  economics,
  timings,
  chunkCount,
  encodedBytes,
  nodeSnapshot,
  eventCount,
}) {
  const stored = economics.stored_bytes ?? 0;
  const inputBytes = verification.input_bytes || 1;
  return {
    primary: {
      reconstruction_success: verification.reconstruction === "PASS",
      bit_for_bit_equality: verification.exact_match === true,
      cost: economics.simulated_cost,
      throughput_bytes_per_unit_time:
        timings.injection_time > 0 ? inputBytes / timings.injection_time : null,
      latency_retrieval: timings.retrieval_time,
      storage_overhead: stored / inputBytes,
      verification_cost: economics.proof_cost,
      proof_overhead: economics.proof_cost,
    },
    secondary: {
      node_count: nodeSnapshot.node_count,
      node_utilization:
        nodeSnapshot.total_capacity > 0
          ? 1 - nodeSnapshot.total_available / nodeSnapshot.total_capacity
          : 0,
      redundancy: economics.redundancy,
      chunk_count: chunkCount,
      encoded_bytes: encodedBytes,
      event_count: eventCount,
    },
    derived: {
      cost_per_GB: economics.simulated_cost / (inputBytes / 1e9 || 1),
      effective_storage_ratio: stored / inputBytes,
      reconstruction_success_rate: verification.exact_match ? 1 : 0,
      cost_per_verified_GB: verification.exact_match
        ? economics.simulated_cost / (inputBytes / 1e9 || 1)
        : null,
      retrieval_latency: timings.retrieval_time,
      repair_cost: 0,
      proof_overhead: economics.proof_cost,
      agent_improvement_delta: null,
    },
  };
}
