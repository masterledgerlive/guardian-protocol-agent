import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { reportInjectCapacity, MEDIA_REF } from "./storage-inject-capacity.js";
import { STORE_HITCH_BYTES } from "./lose-zero-gate.js";

describe("storage-inject-capacity", () => {
  it("reports thin-book capacity with lose-zero notes", () => {
    const r = reportInjectCapacity();
    assert.equal(r.kind, "simulated|estimated");
    assert.equal(r.lose_zero.never_hitch_when_leftover_nonpositive, true);
    assert.ok(r.funds.with_call_to_add_usd >= r.funds.without_unlock_usd);
    assert.equal(MEDIA_REF.eureka_tag_bytes, STORE_HITCH_BYTES);
    assert.ok(r.capacity_now.max_hitch_bytes_per_swap >= 0);
  });

  it("gas spike zeroes capacity", () => {
    const r = reportInjectCapacity({ gwei: 60, tradeableUsd: 50 });
    assert.equal(r.capacity_now.gas_paused, true);
    assert.equal(r.capacity_now.max_hitch_bytes_per_swap, 0);
    assert.equal(r.capacity_now.eureka_ok, false);
  });
});
