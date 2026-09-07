/**
 * Replay logger — append-only events with replay hash.
 */
import { hashCanonical } from "./hashing.js";

export class ReplayLogger {
  constructor() {
    this.events = [];
    this._seq = 0;
  }

  emit(partial) {
    const event = {
      event_id: `evt-${String(++this._seq).padStart(6, "0")}`,
      timestamp: partial.timestamp ?? this._seq,
      ...partial,
    };
    this.events.push(event);
    return event;
  }

  replayHash() {
    return hashCanonical(this.events);
  }

  toJSON() {
    return {
      event_count: this.events.length,
      replay_hash: this.replayHash(),
      events: this.events,
    };
  }
}
