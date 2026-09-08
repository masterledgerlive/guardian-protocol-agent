/**
 * Priority scheduler — Immediate lane for labeled high-priority / small critical jobs.
 */
import { Strategy, registerStrategy } from "../../simulator/strategies/registry.js";
import { DEFAULT_COST_ASSUMPTIONS } from "../../simulator/models/cost-model.js";

export class PriorityStrategy extends Strategy {
  constructor({
    chunkSize = DEFAULT_COST_ASSUMPTIONS.chunk_size,
    redundancy = 2,
    criticalMaxBytes = 512,
  } = {}) {
    super({
      id: "PRIORITY",
      version: "0.1",
      parent: "FIFO-0.1",
      assumptions: [
        "objects with priority=high or byteLength<=criticalMax use Immediate lane",
        `default redundancy=${redundancy} for faster repair headroom`,
        "identity encoding",
        "all costs hypothetical",
      ],
    });
    this.chunkSize = chunkSize;
    this.redundancy = redundancy;
    this.criticalMaxBytes = criticalMaxBytes;
  }

  schedule(job, _context) {
    const size = Number(job?.byteLength) || 0;
    const high = job?.priority === "high" || size <= this.criticalMaxBytes;
    return {
      lane: high ? "Immediate" : "Batch",
      chunkSize: this.chunkSize,
      redundancy: this.redundancy,
      reason: high ? "PRIORITY_CRITICAL_IMMEDIATE" : "PRIORITY_STANDARD_BATCH",
    };
  }
}

export const priority = registerStrategy(new PriorityStrategy());
