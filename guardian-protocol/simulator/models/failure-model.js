/**
 * Failure / stress model — Sprint 4.
 * All behaviors are simulated; never claimed as production measurements.
 */
export class FailureModel {
  constructor({
    dropNodeIds = [],
    bandwidthCapBytes = null,
    churnEveryNStores = 0,
    reliabilityFloor = 0,
    label = "simulated-stress-v0.1",
  } = {}) {
    this.dropNodeIds = new Set(dropNodeIds);
    this.bandwidthCapBytes = bandwidthCapBytes;
    this.churnEveryNStores = churnEveryNStores;
    this.reliabilityFloor = reliabilityFloor;
    this.label = label;
    this.storeCount = 0;
    this.events = [];
  }

  shouldDropNode(nodeId) {
    return this.dropNodeIds.has(nodeId);
  }

  onStore(storage) {
    this.storeCount += 1;
    if (this.churnEveryNStores > 0 && this.storeCount % this.churnEveryNStores === 0) {
      const alive = storage.nodes.filter((n) => n.online !== false);
      if (alive.length > 1) {
        const victim = alive[this.storeCount % alive.length];
        storage.markOffline(victim.id, "CHURN");
        this.events.push({ kind: "CHURN_OFFLINE", node_id: victim.id, at_store: this.storeCount });
        // Bring oldest offline node back online (simple repair churn)
        const offline = storage.nodes.filter((n) => n.online === false && n.id !== victim.id);
        if (offline.length) {
          storage.markOnline(offline[0].id, "CHURN_REJOIN");
          this.events.push({ kind: "CHURN_ONLINE", node_id: offline[0].id, at_store: this.storeCount });
        }
      }
    }
  }

  bandwidthOk(byteLength) {
    if (this.bandwidthCapBytes == null) return true;
    return byteLength <= this.bandwidthCapBytes;
  }

  snapshot() {
    return {
      label: this.label,
      drop_node_ids: [...this.dropNodeIds],
      bandwidth_cap_bytes: this.bandwidthCapBytes,
      churn_every_n_stores: this.churnEveryNStores,
      reliability_floor: this.reliabilityFloor,
      events: this.events.slice(),
      kind: "simulated",
    };
  }
}

/**
 * Long-tail / short-tail classification helper (simulation taxonomy only).
 */
export function classifyTail(byteLength, { shortTailMax = 1024 } = {}) {
  const size = Number(byteLength) || 0;
  return {
    class: size > shortTailMax ? "long-tail" : "short-tail",
    byteLength: size,
    shortTailMax,
    kind: "simulated_taxonomy",
  };
}
