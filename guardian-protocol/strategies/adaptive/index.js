/**
 * Adaptive batching — larger chunks for bigger objects, Immediate lane for tiny jobs.
 */
import { Strategy, registerStrategy } from "../../simulator/strategies/registry.js";
import { DEFAULT_COST_ASSUMPTIONS } from "../../simulator/models/cost-model.js";

export class AdaptiveStrategy extends Strategy {
  constructor({
    minChunk = 64,
    maxChunk = 1024,
    tinyBytes = 128,
    redundancy = DEFAULT_COST_ASSUMPTIONS.redundancy,
  } = {}) {
    super({
      id: "ADAPTIVE",
      version: "0.1",
      parent: "FIFO-0.1",
      assumptions: [
        "chunk size scales with object byte length (clamped)",
        `tiny jobs (<${tinyBytes}B) use Immediate lane`,
        `redundancy=${redundancy}`,
        "identity encoding",
        "all costs hypothetical",
      ],
    });
    this.minChunk = minChunk;
    this.maxChunk = maxChunk;
    this.tinyBytes = tinyBytes;
    this.redundancy = redundancy;
  }

  schedule(job, _context) {
    const size = Math.max(1, Number(job?.byteLength) || 1);
    let chunkSize = Math.round(Math.sqrt(size) * 8);
    chunkSize = Math.max(this.minChunk, Math.min(this.maxChunk, chunkSize));
    // Prefer power-of-two-ish alignment for stable merklization tests
    chunkSize = Math.max(this.minChunk, Math.round(chunkSize / 16) * 16) || this.minChunk;
    const lane = size <= this.tinyBytes ? "Immediate" : "Batch";
    return {
      lane,
      chunkSize,
      redundancy: this.redundancy,
      reason: lane === "Immediate" ? "ADAPTIVE_TINY_IMMEDIATE" : "ADAPTIVE_SCALE_CHUNK",
    };
  }
}

export const adaptive = registerStrategy(new AdaptiveStrategy());
