/**
 * Redundancy optimizer — more replicas for larger / long-tail objects.
 */
import { Strategy, registerStrategy } from "../../simulator/strategies/registry.js";
import { DEFAULT_COST_ASSUMPTIONS } from "../../simulator/models/cost-model.js";

export class RedundancyOptimizerStrategy extends Strategy {
  constructor({
    chunkSize = DEFAULT_COST_ASSUMPTIONS.chunk_size,
    shortTailBytes = 1024,
    longTailRedundancy = 3,
    shortTailRedundancy = 1,
  } = {}) {
    super({
      id: "REDOPT",
      version: "0.1",
      parent: "FIFO-0.1",
      assumptions: [
        `objects > ${shortTailBytes}B treated as long-tail → redundancy=${longTailRedundancy}`,
        `short-tail redundancy=${shortTailRedundancy}`,
        "identity encoding",
        "all costs hypothetical",
      ],
    });
    this.chunkSize = chunkSize;
    this.shortTailBytes = shortTailBytes;
    this.longTailRedundancy = longTailRedundancy;
    this.shortTailRedundancy = shortTailRedundancy;
  }

  schedule(job, _context) {
    const size = Number(job?.byteLength) || 0;
    const longTail = size > this.shortTailBytes;
    return {
      lane: "Batch",
      chunkSize: this.chunkSize,
      redundancy: longTail ? this.longTailRedundancy : this.shortTailRedundancy,
      reason: longTail ? "REDOPT_LONG_TAIL" : "REDOPT_SHORT_TAIL",
    };
  }
}

export const redundancyOptimizer = registerStrategy(new RedundancyOptimizerStrategy());
