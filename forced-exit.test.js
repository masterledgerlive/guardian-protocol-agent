/**
 * forced-exit.js — free stranded CBBTC/AAVE with exitonly + piggy unlock.
 * Dust / lottery 1-wei leftovers must latch, not re-queue forever.
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
  latchForcedExitIfDust,
  isForceExitBagWorthQueuing,
  lockedMajorFreezeMeta,
  DEFAULT_FORCE_EXIT_SYMBOLS,
  FORCE_EXIT_MIN_BALANCE,
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
    const r = queueForcedLockedExits(commands, { CBBTC: 0.00006, AAVE: 0 }, state, {
      prices: { CBBTC: 95000 },
    });
    assert.equal(r.queued.length, 1);
    assert.equal(r.queued[0].symbol, "CBBTC");
    assert.equal(commands[0].action, "exitonly");
  });

  it("does not re-queue after mark executed", () => {
    const commands = [];
    const state = { done: {} };
    queueForcedLockedExits(commands, { CBBTC: 0.0001 }, state, { prices: { CBBTC: 95000 } });
    markForcedExitExecuted(state, "CBBTC");
    const r2 = queueForcedLockedExits(commands, { CBBTC: 0.0001 }, state, {
      prices: { CBBTC: 95000 },
    });
    assert.equal(r2.queued.length, 0);
    assert.ok(r2.skipped.some((s) => s.reason === "already-exited"));
  });
});

describe("forced-exit: dust latch (live DRB 3.5e-14 loop)", () => {
  it("rejects lottery-wei float as not worth queuing", () => {
    assert.equal(isForceExitBagWorthQueuing(3.513e-14, 0.0002), false);
    assert.equal(isForceExitBagWorthQueuing(FORCE_EXIT_MIN_BALANCE / 10, 0), false);
    assert.equal(isForceExitBagWorthQueuing(0.00006, 95000), true);
  });

  it("latches dust DRB and does not re-queue every cycle", () => {
    const commands = [];
    const state = { done: {} };
    const env = { FORCE_EXIT_LOCKED_MAJORS: "yes", FORCE_EXIT_SYMBOLS: "AERO,DRB,BNKR" };
    const r1 = queueForcedLockedExits(
      commands,
      { AERO: 0, DRB: 3.513e-14, BNKR: 0 },
      state,
      { env, prices: { DRB: 0.0002 } },
    );
    assert.equal(r1.queued.length, 0, "dust must not queue");
    assert.ok(r1.skipped.some((s) => s.symbol === "DRB" && s.reason === "dust-latched"));
    assert.equal(state.done.DRB, true);

    const r2 = queueForcedLockedExits(
      commands,
      { DRB: 3.513e-14 },
      state,
      { env, prices: { DRB: 0.0002 } },
    );
    assert.equal(r2.queued.length, 0);
    assert.ok(r2.skipped.some((s) => s.reason === "already-exited"));
    assert.equal(commands.length, 0);
  });

  it("latchForcedExitIfDust after failed exit", () => {
    const state = { done: {} };
    assert.equal(latchForcedExitIfDust(state, "DRB", 3.513e-14, 0.0002), true);
    assert.equal(state.done.DRB, true);
    assert.equal(latchForcedExitIfDust(state, "AERO", 12, 0.56), false);
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
    assert.ok(agentSrc.includes("latchForcedExitIfDust"));
    assert.ok(/symbol:\s*"CBBTC"[\s\S]*?frozen:\s*true/.test(agentSrc));
  });
});
