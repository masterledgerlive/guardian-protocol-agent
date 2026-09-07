/**
 * Baseline strategy: FIFO + fixed chunk size + static reserve.
 * Measurable lower bound — not assumed good.
 */
import { Strategy, registerStrategy } from "../../simulator/strategies/registry.js";
import { DEFAULT_COST_ASSUMPTIONS } from "../../simulator/models/cost-model.js";

export class FifoStrategy extends Strategy {
  constructor({
    chunkSize = DEFAULT_COST_ASSUMPTIONS.chunk_size,
    redundancy = DEFAULT_COST_ASSUMPTIONS.redundancy,
  } = {}) {
    super({
      id: "FIFO",
      version: "0.1",
      parent: null,
      assumptions: [
        "FIFO ordering of a single object job (no multi-job reordering yet)",
        `fixed chunk_size=${chunkSize}`,
        `static redundancy=${redundancy}`,
        "identity encoding (no compression)",
        "round-robin single-node placement per chunk",
        "all costs are hypothetical (CostModel assumptions)",
      ],
    });
    this.chunkSize = chunkSize;
    this.redundancy = redundancy;
  }

  schedule(_job, _context) {
    return {
      lane: "Batch",
      chunkSize: this.chunkSize,
      redundancy: this.redundancy,
      reason: "FIFO_FIXED_CHUNK_STATIC_RESERVE",
    };
  }
}

export const fifoBaseline = registerStrategy(new FifoStrategy());
