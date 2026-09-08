/**
 * Replay viewer helpers — play / pause / step / reverse / jump / filter / compare.
 * Pure functions over event arrays (no UI dependency).
 */
export class ReplayViewer {
  constructor(events = []) {
    this.events = Array.isArray(events) ? events.slice() : [];
    this.index = -1;
    this.playing = false;
  }

  static fromReport(report) {
    const events = report?.replay?.events ?? report?.events ?? [];
    return new ReplayViewer(events);
  }

  get length() {
    return this.events.length;
  }

  get current() {
    if (this.index < 0 || this.index >= this.events.length) return null;
    return this.events[this.index];
  }

  play() {
    this.playing = true;
    return this.current;
  }

  pause() {
    this.playing = false;
    return this.current;
  }

  step(n = 1) {
    this.index = Math.max(-1, Math.min(this.events.length - 1, this.index + n));
    return this.current;
  }

  reverse() {
    return this.step(-1);
  }

  jump(i) {
    this.index = Math.max(-1, Math.min(this.events.length - 1, Number(i)));
    return this.current;
  }

  filter({ objectId = null, strategyId = null, reasonCode = null } = {}) {
    return this.events.filter((e) => {
      if (objectId != null && e.object_id !== objectId) return false;
      if (strategyId != null && e.strategy_id !== strategyId) return false;
      if (reasonCode != null && e.reason_code !== reasonCode) return false;
      return true;
    });
  }

  inspect() {
    const e = this.current;
    if (!e) return null;
    return {
      event_id: e.event_id,
      object_id: e.object_id,
      previous_state: e.previous_state,
      new_state: e.new_state,
      reason_code: e.reason_code,
      strategy: `${e.strategy_id}-${e.strategy_version}`,
      timestamp: e.timestamp,
      estimated_cost: e.estimated_cost ?? null,
      actual_cost: e.actual_cost ?? null,
      resource_state: e.resource_state ?? null,
      cryptographic_references: e.cryptographic_references ?? null,
    };
  }
}

/**
 * Compare two replay hashes / event counts for Arena evidence.
 */
export function compareReplays(a, b) {
  const ae = a?.replay?.events ?? a?.events ?? [];
  const be = b?.replay?.events ?? b?.events ?? [];
  const aHash = a?.TRACE?.replay_hash ?? a?.replay?.replay_hash ?? null;
  const bHash = b?.TRACE?.replay_hash ?? b?.replay?.replay_hash ?? null;
  return {
    same_hash: aHash != null && aHash === bHash,
    a_events: ae.length,
    b_events: be.length,
    a_hash: aHash,
    b_hash: bHash,
    a_strategy: a?.STRATEGY ?? a?.BENCHMARK_META?.strategy ?? null,
    b_strategy: b?.STRATEGY ?? b?.BENCHMARK_META?.strategy ?? null,
    a_cost: a?.ECONOMICS?.simulated_cost ?? null,
    b_cost: b?.ECONOMICS?.simulated_cost ?? null,
    a_exact: a?.RESULT?.exact_match ?? null,
    b_exact: b?.RESULT?.exact_match ?? null,
    kind: "simulated_comparison",
  };
}
