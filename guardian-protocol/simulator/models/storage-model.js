/**
 * Simulated DePIN / Swarm storage nodes.
 */
import { sha256Hex } from "../core/hashing.js";

export class StorageNode {
  constructor({
    id,
    capacity,
    bandwidth = 1_000_000,
    reliability = 1,
    latencyMs = 10,
    region = "sim",
  }) {
    this.id = id;
    this.capacity = capacity;
    this.available = capacity;
    this.bandwidth = bandwidth;
    this.reliability = reliability;
    this.latencyMs = latencyMs;
    this.region = region;
    this.fragments = new Map(); // fragmentId -> { sha256, length }
  }

  canStore(byteLength) {
    return this.available >= byteLength;
  }

  store(fragmentId, data) {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    if (!this.canStore(buf.length)) {
      return { ok: false, reason: "CAPACITY" };
    }
    const digest = sha256Hex(buf);
    this.fragments.set(fragmentId, { sha256: digest, length: buf.length, data: Buffer.from(buf) });
    this.available -= buf.length;
    return { ok: true, node_id: this.id, sha256: digest, length: buf.length };
  }

  retrieve(fragmentId) {
    const frag = this.fragments.get(fragmentId);
    if (!frag) return { ok: false, reason: "MISSING" };
    return { ok: true, data: Buffer.from(frag.data), sha256: frag.sha256 };
  }
}

export class StorageModel {
  constructor(nodes = []) {
    this.nodes = nodes;
  }

  static createUniformCluster({ count = 3, capacity = 1_000_000 } = {}) {
    const nodes = [];
    for (let i = 0; i < count; i++) {
      nodes.push(
        new StorageNode({
          id: `node-${i}`,
          capacity,
          region: `sim-region-${i % 3}`,
        })
      );
    }
    return new StorageModel(nodes);
  }

  pickNodes(n = 1) {
    const sorted = [...this.nodes].sort((a, b) => b.available - a.available);
    return sorted.slice(0, n);
  }

  storeRoundRobin(fragmentId, data) {
    const candidates = this.pickNodes(1);
    if (candidates.length === 0) return { ok: false, reason: "NO_NODES" };
    return candidates[0].store(fragmentId, data);
  }

  snapshot() {
    return {
      node_count: this.nodes.length,
      total_capacity: this.nodes.reduce((s, n) => s + n.capacity, 0),
      total_available: this.nodes.reduce((s, n) => s + n.available, 0),
      nodes: this.nodes.map((n) => ({
        id: n.id,
        capacity: n.capacity,
        available: n.available,
        fragments: n.fragments.size,
        region: n.region,
      })),
    };
  }
}
