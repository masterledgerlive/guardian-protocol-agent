/**
 * Injection lifecycle state machine.
 */
export const STATES = Object.freeze([
  "RECEIVED",
  "VALIDATED",
  "CHUNKED",
  "ENCODED",
  "COST_ESTIMATED",
  "TREASURY_CHECK",
  "SCHEDULED",
  "INJECTED",
  "STORED",
  "VERIFIED",
  "INDEXED",
  "ARCHIVED",
  "DEFERRED",
  "FAILED",
]);

const ALLOWED = Object.freeze({
  RECEIVED: ["VALIDATED", "FAILED"],
  VALIDATED: ["CHUNKED", "FAILED"],
  CHUNKED: ["ENCODED", "FAILED"],
  ENCODED: ["COST_ESTIMATED", "FAILED"],
  COST_ESTIMATED: ["TREASURY_CHECK", "FAILED"],
  TREASURY_CHECK: ["SCHEDULED", "DEFERRED", "FAILED"],
  SCHEDULED: ["INJECTED", "DEFERRED", "FAILED"],
  INJECTED: ["STORED", "FAILED"],
  STORED: ["VERIFIED", "FAILED"],
  VERIFIED: ["INDEXED", "FAILED"],
  INDEXED: ["ARCHIVED", "FAILED"],
  ARCHIVED: [],
  DEFERRED: ["TREASURY_CHECK", "SCHEDULED", "FAILED"],
  FAILED: [],
});

export class StateMachine {
  constructor(objectId, { initial = "RECEIVED" } = {}) {
    this.objectId = objectId;
    this.state = initial;
    this.history = [{ state: initial, at: 0 }];
  }

  canTransition(next) {
    return (ALLOWED[this.state] ?? []).includes(next);
  }

  transition(next, { timestamp = Date.now(), reason } = {}) {
    if (!this.canTransition(next)) {
      throw new Error(`Illegal transition ${this.state} → ${next} for ${this.objectId}`);
    }
    const previous = this.state;
    this.state = next;
    this.history.push({ state: next, at: timestamp, reason });
    return { previous, next, reason };
  }
}
