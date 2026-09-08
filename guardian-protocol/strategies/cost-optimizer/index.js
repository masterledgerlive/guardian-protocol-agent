/**
 * Cost optimizer — fewer chunks + lower redundancy when treasury is tight.
 */
import { Strategy, registerStrategy } from "../../simulator/strategies/registry.js";

export class CostOptimizerStrategy extends Strategy {
  constructor({
    richChunk = 512,
    poorChunk = 256,
    richRedundancy = 2,
    poorRedundancy = 1,
    tightRatio = 0.2,
  } = {}) {
    super({
      id: "COSTOPT",
      version: "0.1",
      parent: "FIFO-0.1",
      assumptions: [
        "larger chunks when treasury is healthy (fewer compute/proof units)",
        "drops redundancy to 1 when spendable/reserve is tight",
        "identity encoding",
        "all costs hypothetical",
      ],
    });
    this.richChunk = richChunk;
    this.poorChunk = poorChunk;
    this.richRedundancy = richRedundancy;
    this.poorRedundancy = poorRedundancy;
    this.tightRatio = tightRatio;
  }

  schedule(job, context) {
    const snap = context?.treasury ?? {};
    const balance = Number(snap.balance) || 0;
    const reserve = Number(snap.reserve) || 0;
    const spendable = Math.max(0, balance - reserve);
    const tight = balance > 0 ? spendable / balance < this.tightRatio : true;
    return {
      lane: tight ? "Deferred" : "Batch",
      chunkSize: tight ? this.poorChunk : this.richChunk,
      redundancy: tight ? this.poorRedundancy : this.richRedundancy,
      reason: tight ? "COSTOPT_TIGHT_TREASURY" : "COSTOPT_RICH_BATCH",
    };
  }
}

export const costOptimizer = registerStrategy(new CostOptimizerStrategy());
