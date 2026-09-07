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
    online = true,
  }) {
    this.id = id;
    this.capacity = capacity;
    this.available = capacity;
    this.bandwidth = bandwidth;
    this.reliability = reliability;
    this.latencyMs = latencyMs;
    this.region = region;
    this.online = online;
    this.fragments = new Map(); // fragmentId -> { sha256, length }
  }

  canStore(byteLength) {
    return this.online && this.available >= byteLength;
  }

  store(fragmentId, data) {
    if (!this.online) return { ok: false, reason: "NODE_OFFLINE" };
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
    if (!this.online) return { ok: false, reason: "NODE_OFFLINE" };
    const frag = this.fragments.get(fragmentId);
    if (!frag) return { ok: false, reason: "MISSING" };
    return { ok: true, data: Buffer.from(frag.data), sha256: frag.sha256, node_id: this.id };
  }

  deleteFragment(fragmentId) {
    const frag = this.fragments.get(fragmentId);
    if (!frag) return false;
    this.fragments.delete(fragmentId);
    this.available += frag.length;
    return true;
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
    const sorted = [...this.nodes]
      .filter((n) => n.online !== false)
      .sort((a, b) => b.available - a.available);
    return sorted.slice(0, n);
  }

  storeRoundRobin(fragmentId, data) {
    const candidates = this.pickNodes(1);
    if (candidates.length === 0) return { ok: false, reason: "NO_NODES" };
    return candidates[0].store(fragmentId, data);
  }

  /** Place on a specific online node (for repair). */
  storeOn(nodeId, fragmentId, data) {
    const node = this.nodes.find((n) => n.id === nodeId);
    if (!node) return { ok: false, reason: "NO_SUCH_NODE" };
    return node.store(fragmentId, data);
  }

  retrieveAnywhere(fragmentId) {
    for (const node of this.nodes) {
      const res = node.retrieve(fragmentId);
      if (res.ok) return res;
    }
    return { ok: false, reason: "MISSING" };
  }

  markOffline(nodeId, reason = "OFFLINE") {
    const node = this.nodes.find((n) => n.id === nodeId);
    if (!node) return { ok: false, reason: "NO_SUCH_NODE" };
    node.online = false;
    return { ok: true, node_id: nodeId, reason };
  }

  markOnline(nodeId, reason = "ONLINE") {
    const node = this.nodes.find((n) => n.id === nodeId);
    if (!node) return { ok: false, reason: "NO_SUCH_NODE" };
    node.online = true;
    return { ok: true, node_id: nodeId, reason };
  }

  /**
   * Repair: copy a surviving replica onto an online node that lacks it.
   */
  repairFragment(fragmentId, { preferNodeId = null } = {}) {
    const source = this.retrieveAnywhere(fragmentId);
    if (!source.ok) return { ok: false, reason: "NO_SOURCE" };
    const targets = this.nodes.filter(
      (n) => n.online !== false && !n.fragments.has(fragmentId) && n.id !== source.node_id
    );
    if (!targets.length) return { ok: false, reason: "NO_REPAIR_TARGET" };
    const target =
      (preferNodeId && targets.find((n) => n.id === preferNodeId)) || targets[0];
    const stored = target.store(fragmentId, source.data);
    return stored.ok
      ? { ok: true, from: source.node_id, to: target.id, fragmentId, kind: "simulated_repair" }
      : stored;
  }

  snapshot() {
    return {
      node_count: this.nodes.length,
      online_count: this.nodes.filter((n) => n.online !== false).length,
      total_capacity: this.nodes.reduce((s, n) => s + n.capacity, 0),
      total_available: this.nodes.reduce((s, n) => s + n.available, 0),
      nodes: this.nodes.map((n) => ({
        id: n.id,
        capacity: n.capacity,
        available: n.available,
        fragments: n.fragments.size,
        region: n.region,
        online: n.online !== false,
      })),
    };
  }
}
