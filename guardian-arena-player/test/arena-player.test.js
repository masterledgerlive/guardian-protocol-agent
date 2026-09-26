import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  armAgentHour,
  agentAssistAllowed,
  botsRunWithoutAgents,
  recordAgentUse,
  snapshotAgentHour,
} from "../agent-hour-budget.js";
import { compileStats, costPerDecision } from "../config.js";
import { guardDecide, selectBrain } from "../brain.js";
import { createHeuristicBrain } from "../heuristic-brain.js";
import { PaperAccount } from "../paper-account.js";
import { createSimMarket } from "../sim-market.js";
import { hardenVerdict, skipVerdict } from "../types.js";
import { isArenaPlayerEnabled, runArenaPlayer } from "../player.js";

describe("arena player — agent-arena takeaways", () => {
  it("decide never throws — harden + guard → SKIP", async () => {
    const boom = {
      decide() {
        throw new Error("network down");
      },
    };
    const g = guardDecide(boom);
    const v = await g.decide({}, { maxSizeEth: 1 });
    assert.equal(v.action, "SKIP");
    assert.match(v.reason, /brain-error/);
    assert.equal(hardenVerdict({ action: "BUY", sizeEth: 99 }, { maxSizeEth: 0.05 }).sizeEth, 0.05);
    assert.equal(hardenVerdict({ action: "SELL" }, { maxSizeEth: 1, inPosition: false }).action, "SKIP");
    assert.equal(skipVerdict("x").action, "SKIP");
  });

  it("stat compiler prices PTN ladder; heuristic is free", () => {
    const cheap = compileStats({ ptn: 0 }, { provider: "anthropic" });
    const dear = compileStats({ ptn: 12 }, { provider: "anthropic" });
    assert.ok(dear.costPerDecisionUsd > cheap.costPerDecisionUsd * 5);
    const fly = compileStats({ ptn: 12 }, { provider: "heuristic" });
    assert.equal(fly.costPerDecisionUsd, 0);
    assert.equal(costPerDecision("fly-heuristic", 96, 3000), 0);
  });

  it("hour budget: assist burns out → heuristic-only; bots still run", () => {
    const dir = mkdtempSync(join(tmpdir(), "arena-hour-"));
    const latchPath = join(dir, "hour.json");
    try {
      assert.equal(botsRunWithoutAgents(), true);
      const t0 = 1_000_000;
      armAgentHour({ now: t0, windowMs: 1_000, latchPath, force: true });
      assert.equal(agentAssistAllowed({ now: t0, latchPath }), true);
      recordAgentUse({ durationMs: 1_500, costUsd: 0.02, now: t0 + 1_500, latchPath, refreshInMs: 5_000 });
      const snap = snapshotAgentHour({ now: t0 + 1_500, latchPath });
      assert.equal(snap.allowed, false);
      assert.equal(snap.brain, "heuristic-only");
      const brain = selectBrain({
        assistAllowed: snap.allowed,
        liveBrain: { decide: () => ({ action: "BUY", sizeEth: 9 }) },
        heuristicBrain: createHeuristicBrain(),
      });
      assert.equal(brain.decide !== undefined, true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("paper account buys/sells virtually without touching chain wallets", () => {
    const acct = new PaperAccount({ initialEth: 10, feeBps: 60 });
    const snap = {
      pair: "MEME/ETH",
      last: 0.001,
      bids: [{ price: 0.00099, size: 5 }],
      asks: [{ price: 0.00101, size: 5 }],
      validUntil: Date.now() + 60_000,
    };
    const buy = acct.buy(snap, 1, 100);
    assert.ok(buy);
    assert.ok(acct.cashEth < 10);
    const sell = acct.sell(snap, 100);
    assert.ok(sell);
    assert.equal(acct.position, null);
    assert.ok(Number.isFinite(acct.realizedPnlEth));
  });

  it("sim market + player loop runs with ARENA gate default off", async () => {
    assert.equal(isArenaPlayerEnabled({}), false);
    assert.equal(isArenaPlayerEnabled({ ARENA_PLAYER: "yes" }), true);
    const dir = mkdtempSync(join(tmpdir(), "arena-run-"));
    const latchPath = join(dir, "hour.json");
    try {
      const market = createSimMarket({ seed: 7 });
      const pairs = await market.listPairs();
      assert.ok(pairs.length >= 1);
      const result = await runArenaPlayer({
        ticks: 25,
        seed: 7,
        agentClass: "FLY",
        provider: "heuristic",
        latchPath,
        now: Date.now(),
        log: () => {},
      });
      assert.equal(result.ticks, 25);
      assert.equal(result.botsRunWithoutAgents, true);
      assert.ok(result.equityEth > 0);
      assert.equal(result.hour.brain === "heuristic-only" || result.hour.brain === "live-or-heuristic", true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
