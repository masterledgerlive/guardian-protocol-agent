/**
 * Strategy interface + registry.
 */
export class Strategy {
  constructor({ id, version, parent = null, assumptions = [] }) {
    this.id = id;
    this.version = version;
    this.parent = parent;
    this.assumptions = assumptions;
  }

  get strategyKey() {
    return `${this.id}-${this.version}`;
  }

  /** @returns {{ lane: 'Immediate'|'Batch'|'Deferred', chunkSize: number, redundancy: number, reason: string }} */
  schedule(_job, _context) {
    throw new Error("strategy.schedule must be implemented");
  }

  encodeChunks(chunks) {
    // Baseline: identity encoding (no compression). Lossless by construction.
    return chunks.map((c) => ({
      ...c,
      encoded: Buffer.from(c.data),
      encoding: "identity",
    }));
  }
}

const registry = new Map();

export function registerStrategy(strategy) {
  registry.set(strategy.strategyKey, strategy);
  return strategy;
}

export function getStrategy(key) {
  const s = registry.get(key);
  if (!s) throw new Error(`Unknown strategy: ${key}`);
  return s;
}

export function listStrategies() {
  return [...registry.keys()];
}
