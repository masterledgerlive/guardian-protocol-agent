import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  sessionRangeCanArm,
  sessionRangeNet,
  SESSION_ARM_MIN_READINGS,
} from "./session-arm.js";

const root = dirname(fileURLToPath(import.meta.url));

describe("session-arm", () => {
  it("refuses thin books and arms a live range that clears fees", () => {
    assert.equal(sessionRangeCanArm([], {}).ok, false);
    const flat = Array.from({ length: 10 }, (_, i) => ({ price: 1 + i * 1e-8 }));
    assert.equal(sessionRangeCanArm(flat, { minNetMargin: 0.006 }).ok, false);
    const live = Array.from({ length: SESSION_ARM_MIN_READINGS }, (_, i) => ({
      price: 1 + i * 0.01,
    }));
    const d = sessionRangeCanArm(live, {
      minNetMargin: 0.006,
      feePct: 0.006,
      impactPct: 0.006,
      gasCostEth: 0.00002,
      tradeEth: 0.0015,
    });
    assert.equal(d.ok, true);
    assert.equal(d.reason, "SESSION_RANGE");
    assert.ok(d.net > 0.006);
    assert.ok(sessionRangeNet({ high: 1.03, low: 1, feePct: 0.006, impactPct: 0.006 }) > 0);
  });

  it("agent.js uses session-range when 2P/2T is missing", () => {
    const src = readFileSync(join(root, "agent.js"), "utf8");
    assert.ok(src.includes('from "./session-arm.js"'));
    assert.ok(src.includes("sessionRangeCanArm"));
    assert.ok(src.includes("sessionArm"));
  });
});
