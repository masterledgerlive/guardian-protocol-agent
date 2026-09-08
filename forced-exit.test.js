/**
 * forced-exit.js — free stranded CBBTC/AAVE with exitonly + piggy unlock.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  forceExitLockedEnabled,
  forceExitSymbols,
  forcedExitCommand,
  queueForcedLockedExits,
  markForcedExitExecuted,
  lockedMajorFreezeMeta,
  DEFAULT_FORCE_EXIT_SYMBOLS,
} from "./forced-exit.js";

const root = dirname(fileURLToPath(import.meta.url));
const agentSrc = readFileSync(join(root, "agent.js"), "utf8");

describe("forced-exit: env + command", () => {
  it("defaults ON and lists CBBTC/AAVE", () => {
    assert.equal(forceExitLockedEnabled({}), true);
    assert.equal(forceExitLockedEnabled({ FORCE_EXIT_LOCKED_MAJORS: "no" }), false);
    assert.deepEqual(forceExitSymbols({}), [...DEFAULT_FORCE_EXIT_SYMBOLS]);
  });

  it("builds exitonly with piggy unlock and no-cascade source", () => {
    const c = forcedExitCommand("CBBTC");
    assert.equal(c.action, "exitonly");
    assert.equal(c.pct, 1);
    assert.equal(c.unlockPiggy, true);
    assert.equal(c.source, "FORCE_EXIT_LOCKED");
    assert.match(c.reason, /PIGGY UNLOCK/);
    assert.match(c.reason, /FORCE EXIT LOCKED/);
  });
});

describe("forced-exit: queue once per bag", () => {
  it("queues CBBTC when balance present", () => {
    const commands = [];
    const state = { done: {} };
    const r = queueForcedLockedExits(commands, { CBBTC: 0.00006, AAVE: 0 }, state);
    assert.equal(r.queued.length, 1);
    assert.equal(r.queued[0].symbol, "CBBTC");
    assert.equal(commands[0].action, "exitonly");
  });

  it("does not re-queue after mark executed", () => {
    const commands = [];
    const state = { done: {} };
    queueForcedLockedExits(commands, { CBBTC: 0.0001 }, state);
    markForcedExitExecuted(state, "CBBTC");
    const r2 = queueForcedLockedExits(commands, { CBBTC: 0.0001 }, state);
    assert.equal(r2.queued.length, 0);
    assert.ok(r2.skipped.some((s) => s.reason === "already-exited"));
  });
});

describe("forced-exit: freeze meta + agent wire", () => {
  it("freeze meta closes CBBTC to new buys", () => {
    const m = lockedMajorFreezeMeta("CBBTC");
    assert.equal(m.frozen, true);
    assert.equal(m.injectMain, false);
    assert.match(m.frozenReason, /LOCKED CLOSED/);
  });

  it("agent imports forced-exit and freezes CBBTC", () => {
    assert.ok(agentSrc.includes('from "./forced-exit.js"'));
    assert.ok(agentSrc.includes("queueForcedLockedExits"));
    assert.ok(/symbol:\s*"CBBTC"[\s\S]*?frozen:\s*true/.test(agentSrc));
  });
});
