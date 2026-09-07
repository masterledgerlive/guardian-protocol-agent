/**
 * Protocol adapter interfaces — Sprint 5.
 * Stubs only. Must NOT import or mutate root trading modules.
 */
export class ProtocolAdapter {
  constructor({ id, kind, status = "stub" }) {
    this.id = id;
    this.kind = kind;
    this.status = status;
  }

  async health() {
    return { ok: true, id: this.id, kind: this.kind, status: this.status, measured: false };
  }

  async preserve(_canonical) {
    throw new Error(`${this.id}: preserve not implemented (Sprint 5 stub)`);
  }

  async retrieve(_objectId) {
    throw new Error(`${this.id}: retrieve not implemented (Sprint 5 stub)`);
  }
}

export class HitchInjectorAdapter extends ProtocolAdapter {
  constructor() {
    super({ id: "hitch-injector", kind: "transitional_baseline" });
  }

  /**
   * Documents the boundary: live hitch/injector lives in repo root.
   * This adapter never imports agent.js / bitstorage-orchestrator.js.
   */
  describeBoundary() {
    return {
      live_modules: [
        "agent.js",
        "bitstorage-orchestrator.js",
        "lose-zero-gate.js",
        "l1-fee-oracle.js",
      ],
      coupling: "forbidden_until_explicit_design",
      status: "stub",
      kind: "documentation_only",
    };
  }
}

export class DaLayerAdapter extends ProtocolAdapter {
  constructor({ name = "generic-da" } = {}) {
    super({ id: `da:${name}`, kind: "da_layer" });
    this.name = name;
  }
}

export class StorageNetworkAdapter extends ProtocolAdapter {
  constructor({ name = "generic-swarm" } = {}) {
    super({ id: `storage:${name}`, kind: "storage_network" });
    this.name = name;
  }
}

export function listAdapterStubs() {
  return [
    new HitchInjectorAdapter(),
    new DaLayerAdapter({ name: "arbitrum-compression-model" }),
    new StorageNetworkAdapter({ name: "swarm-tier2" }),
  ].map((a) => ({
    id: a.id,
    kind: a.kind,
    status: a.status,
    boundary: a.describeBoundary?.() ?? null,
  }));
}
