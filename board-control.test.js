import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  readLiveParamSnapshot,
  runArenaLearnSim,
  runBoardSim,
  boardHealth,
  demoBoardSnapshot,
  v4BoardStatus,
  LOSE_ZERO_INVARIANTS,
  BOARD_PATHS,
} from "./board-control.js";

describe("readLiveParamSnapshot", () => {
  it("is read-only and never invents a write path", () => {
    const snap = readLiveParamSnapshot({
      LOSE_ZERO: "yes",
      HALT_NEW_ENTRIES: "yes",
      HITCH_COST_MULT: "3",
      PIGGY_BANK_PCT: "5",
      PIGGY_BANK_MIN_USD: "0.15",
    });
    assert.equal(snap.writable, false);
    assert.equal(snap.loseZero, true);
    assert.equal(snap.haltNewEntries, true);
    assert.equal(snap.hitchCostMult, 3);
    assert.equal(snap.piggyBankPct, 0.05);
    assert.equal(snap.piggyBankMinUsd, 0.15);
    assert.equal(snap.costEdge.alwaysOn, true);
    assert.equal(snap.peakRide.histPeakTouchIsSell, false);
    assert.equal(snap.loseZeroRules.neverSellUnderwater, true);
    assert.equal(snap.loseZeroRules.vaultNeverSpend, true);
  });
});

describe("runArenaLearnSim", () => {
  it("holds on a losing move (lose-zero) and never sells piggy", () => {
    const r = runArenaLearnSim({
      cash: 8,
      seat: "LINK",
      movePct: -0.02,
      piggyPct: 0.08,
      loseZero: true,
      costEdge: false,
    });
    assert.equal(r.sold, false);
    assert.equal(r.loseZeroHeld, true);
    assert.ok(r.piggyLocked > 0);
    assert.equal(r.hitchOnSell, false);
    assert.equal(r.endBags > 0, true);
    assert.match(r.lines.join("\n"), /hold/);
    assert.match(r.label, /simulated/);
  });

  it("sells a green wave but leaves piggy and hitch only if leftover covers", () => {
    const r = runArenaLearnSim({
      cash: 8,
      seat: "UNI",
      movePct: 0.06,
      piggyPct: 0.05,
      loseZero: true,
      costEdge: false,
      hitchUsd: 0.35,
      hitchCostMult: 2,
    });
    assert.equal(r.sold, true);
    assert.ok(r.piggyLocked > 0);
    assert.equal(r.invariants.piggyNeverSell, true);
    assert.equal(r.invariants.noInventedPnl, true);
    assert.match(r.label, /not a live trade/);
  });

  it("does not invent a fill when COST_EDGE refuses", () => {
    const r = runArenaLearnSim({
      cash: 2.24,
      seat: "CBBTC",
      movePct: 0.03,
      costEdge: true,
      hitchUsd: 0.8,
      gasUsd: 0.2,
    });
    assert.equal(r.refused, true);
    assert.equal(r.endLiquid, r.startLiquid);
    assert.equal(r.endBags, 0);
  });
});

describe("V3/V4 isolation", () => {
  it("does not import guardian-v4 runtime from the V3 hub modules", () => {
    const board = readFileSync(new URL("./board-control.js", import.meta.url), "utf8");
    const hook = readFileSync(new URL("./vita-webhook.js", import.meta.url), "utf8");
    assert.equal(/from\s+["']\.\/guardian-v4\//.test(board), false);
    assert.equal(/from\s+["']\.\/guardian-v4\//.test(hook), false);
    assert.equal(/encodeV4ExactInSwap|runV4PaperSim/.test(board), false);
  });

  it("reports V4 as a separate process that this webhook cannot start or encode", () => {
    const v = v4BoardStatus();
    assert.equal(v.sameProcessAsV3, false);
    assert.equal(v.startableFromThisWebhook, false);
    assert.equal(v.encodesV4Swaps, false);
    assert.equal(v.loadsV4Runtime, false);
    assert.ok(v.start.loop.includes("start:v4"));
    assert.equal(v.envPrefix, "GUARDIAN_V4_");
    assert.ok(Array.isArray(v.avenues));
    assert.ok(v.avenues.every((t) => !t.poolId && !t.address));
  });
});

describe("boardHealth + demo snapshot", () => {
  it("lists mounted boards including V4 as a separate process", () => {
    const h = boardHealth({ secretConfigured: false, botReady: false });
    assert.equal(h.ok, true);
    assert.equal(h.boards.board.mounted, true);
    assert.equal(h.boards.arena.mounted, true);
    assert.equal(h.boards.engine.mounted, true);
    assert.equal(h.boards.v4.sameProcess, false);
    assert.equal(h.boards.v4.loadsV4Runtime, false);
    assert.equal(h.boards.v4.path, "/v4");
    assert.equal(h.boards.l1_arena.mounted, false);
    assert.equal(h.apis.sim.mutate, false);
    assert.equal(BOARD_PATHS.hub, "/board");
  });

  it("demo snapshot includes params, waves, and V4 docs status", () => {
    const d = demoBoardSnapshot({});
    assert.equal(d.demo, true);
    assert.ok(d.engine.waves.length >= 3);
    assert.ok(d.v4.catalog.total >= 1);
    assert.equal(d.v4.encodesV4Swaps, false);
    assert.equal(d.invariants.neverSellUnderwater, true);
    assert.deepEqual(d.invariants, LOSE_ZERO_INVARIANTS);
  });
});

describe("runBoardSim", () => {
  it("runs V3 practice only — no V4 encode payload", () => {
    const b = runBoardSim({ cash: 8, seat: "LINK", movePct: 0.06, costEdge: false });
    assert.equal(b.ok, true);
    assert.match(b.kind, /simulated/);
    assert.equal(b.arena.ok, true);
    assert.equal(b.storage.ok, true);
    assert.equal(b.v4, undefined);
    assert.match(b.label, /does not encode V4/);
    assert.equal(b.invariants.vaultNeverSpend, true);
  });
});
