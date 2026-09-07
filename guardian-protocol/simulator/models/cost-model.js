/**
 * Hypothetical cost model — all values are labeled assumptions.
 */
export const DEFAULT_COST_ASSUMPTIONS = Object.freeze({
  label: "hypothetical-sprint1-v0.1",
  transaction_fee: 0.0001, // credits per injection tx
  bandwidth_price_per_byte: 1e-9,
  compute_price_per_chunk: 0.00001,
  storage_price_per_byte: 5e-10,
  node_reward_per_byte: 1e-10,
  redundancy: 1,
  chunk_size: 256,
  proof_price_per_chunk: 0.000005,
});

export class CostModel {
  constructor(assumptions = {}) {
    this.assumptions = { ...DEFAULT_COST_ASSUMPTIONS, ...assumptions };
  }

  estimate({ byteLength, chunkCount, redundancy }) {
    const a = this.assumptions;
    const red = redundancy ?? a.redundancy;
    const storedBytes = byteLength * red;
    const storage = storedBytes * a.storage_price_per_byte;
    const bandwidth = storedBytes * a.bandwidth_price_per_byte;
    const compute = chunkCount * a.compute_price_per_chunk;
    const proof = chunkCount * a.proof_price_per_chunk;
    const transaction = a.transaction_fee;
    const node_reward = storedBytes * a.node_reward_per_byte;
    const total = storage + bandwidth + compute + proof + transaction + node_reward;
    return {
      storage_cost: storage,
      bandwidth_cost: bandwidth,
      compute_cost: compute,
      proof_cost: proof,
      transaction_cost: transaction,
      node_reward,
      simulated_cost: total,
      stored_bytes: storedBytes,
      redundancy: red,
      assumption_label: a.label,
    };
  }
}
