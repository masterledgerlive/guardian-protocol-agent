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
  listV3InjectSurfaces,
  parseDefaultTokensFromAgentSource,
  leftoverHitchCapacity,
  modelBotUsagePiggy,
  GROK_BOT_USAGE,
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
    assert.equal(snap.piggyLinkPct, 0.08);
    assert.equal(snap.piggyLinkMinUsd, 0.25);
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

  it("does not recycle buy gas as leftover cash and charges hitch when leftover covers", () => {
    const r = runArenaLearnSim({
      cash: 8,
      seat: "UNI",
      movePct: 0.06,
      piggyPct: 0.05,
      loseZero: true,
      costEdge: false,
      hitchUsd: 0.35,
      gasUsd: 0.05,
      hitchCostMult: 2,
    });
    assert.equal(r.sold, true);
    assert.equal(r.hitchOnSell, true);
    assert.equal(r.gasSpent, 0.05);
    assert.equal(r.hitchChargedUsd, 0.35);
    assert.ok(Math.abs(r.endLiquid - r.proceeds) < 1e-9);
    const hold = runArenaLearnSim({
      cash: 8,
      seat: "LINK",
      movePct: -0.02,
      piggyPct: 0.08,
      loseZero: true,
      costEdge: false,
      hitchUsd: 0.35,
      gasUsd: 0.05,
    });
    assert.equal(hold.sold, false);
    assert.equal(hold.hitchChargedUsd, 0);
    assert.ok(Math.abs(hold.endLiquid - 0.35) < 1e-9);
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

  it("demo snapshot lists V3 inject surfaces, bot-usage piggy DEMO, and deferred V4 stub", () => {
    const d = demoBoardSnapshot({});
    assert.equal(d.demo, true);
    assert.ok(d.engine.waves.length >= 3);
    assert.equal(d.v4.deferred, true);
    assert.equal(d.v4.page, "/v4");
    assert.equal(d.v4.sameProcessAsV3, false);
    assert.equal(d.inject.kind, "v3-uniswap-inject-surfaces");
    assert.ok(d.inject.hitchSurfaces.length >= 10);
    assert.equal(d.botPiggy.kind, "demo|example");
    assert.equal(d.botPiggy.grokNowUsdPerMonth, 20);
    assert.equal(d.botPiggy.grokProUsdPerMonth, 60);
    assert.equal(d.botPiggy.provenRevenue, null);
    assert.equal(d.botPiggy.grokProUnlocked, false);
    assert.ok(Array.isArray(d.engine.waves[0].series));
    assert.ok(d.engine.waves[0].series.length >= 8);
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
    assert.equal(b.botPiggy.kind, "demo|example");
    assert.equal(b.botPiggy.provenRevenue, null);
    assert.equal(b.botPiggy.grokNowUsdPerMonth, 20);
    assert.equal(b.arena.startLiquid, 8);
    assert.equal(b.storage.funds.tradeable_usd, 8);
  });
});

describe("V3 inject surfaces (agent.js catalog as text)", () => {
  it("parses tradeable hitch seats and excludes frozen/disabled", () => {
    const src = readFileSync(new URL("./agent.js", import.meta.url), "utf8");
    const rows = parseDefaultTokensFromAgentSource(src);
    assert.ok(rows.find((t) => t.symbol === "LINK")?.injectMain);
    assert.equal(rows.find((t) => t.symbol === "LINK")?.piggyBankPct, 0.08);
    assert.equal(rows.find((t) => t.symbol === "LINK")?.piggyBankMinUsd, 0.25);
    assert.equal(rows.find((t) => t.symbol === "CBBTC")?.frozen, true);
    assert.equal(rows.find((t) => t.symbol === "AAVE")?.frozen, true);
    assert.equal(rows.find((t) => t.symbol === "WELL")?.disabled, true);
    assert.equal(rows.find((t) => t.symbol === "TOSHI")?.frozen, false);
    assert.equal(rows.find((t) => t.symbol === "TOSHI")?.disabled, false);

    const surf = listV3InjectSurfaces({ agentSrc: src });
    assert.equal(surf.dex, "uniswap-v3");
    assert.equal(surf.favorite, "LINK");
    assert.deepEqual(surf.injectMains, ["LINK", "UNI", "VVV", "ZORA", "BNKR", "AERO", "MORPHO"]);
    assert.deepEqual(surf.deferredMajors, ["CBBTC", "AAVE"]);
    const bySym = Object.fromEntries(surf.hitchSurfaces.map((t) => [t.symbol, t]));
    assert.ok(bySym.LINK);
    assert.equal(bySym.LINK.favorite, true);
    assert.equal(bySym.LINK.injectMain, true);
    assert.equal(bySym.LINK.piggyPct, 0.08);
    assert.equal(bySym.LINK.piggyMinUsd, 0.25);
    assert.ok(bySym.TOSHI);
    assert.ok(bySym.UNI);
    assert.ok(bySym.GAME);
    assert.equal(bySym.CBBTC, undefined);
    assert.equal(bySym.WELL, undefined);
    assert.ok(surf.frozenOrDisabled.find((t) => t.symbol === "CBBTC" && t.frozen));
    assert.ok(surf.frozenOrDisabled.find((t) => t.symbol === "WELL" && t.disabled));
    assert.ok(surf.hitchSurfaces.length >= 15);
  });
});

describe("leftover / hitch capacity", () => {
  it("labels estimates and never invents live P&L", () => {
    const cap = leftoverHitchCapacity();
    assert.match(cap.kind, /estimated|simulated/);
    assert.ok(Number.isFinite(cap.hitchTagUsd));
    assert.ok(Number.isFinite(cap.leftoverUsd));
    assert.equal(typeof cap.eurekaOk, "boolean");
    assert.equal(cap.lose_zero.never_sell_underwater_to_insert_storage, true);
  });
});

describe("bot usage piggy (Grok)", () => {
  it("stays DEMO unless both hitch revenue hashes and a finite USD are supplied", () => {
    const demo = modelBotUsagePiggy({ hitchTagUsd: 0.35, leftoverUsd: 2 });
    assert.equal(demo.kind, "demo|example");
    assert.equal(demo.grokNowUsdPerMonth, 20);
    assert.equal(demo.grokProUsdPerMonth, 60);
    assert.equal(demo.grokProUnlocked, false);
    assert.equal(demo.provenRevenue, null);
    assert.equal(demo.leftoverCoversHitch, true);
    assert.match(demo.hitchTagUsdLabel, /not income/);
    assert.equal(GROK_BOT_USAGE.proOnlyAfterProvenRevenue, true);

    const hashesOnly = modelBotUsagePiggy({ hitchRevenueTxs: ["0xabc"] });
    assert.equal(hashesOnly.kind, "demo|example");
    assert.equal(hashesOnly.grokProUnlocked, false);

    const usdOnly = modelBotUsagePiggy({ hitchRevenueUsd: 80 });
    assert.equal(usdOnly.kind, "demo|example");
    assert.equal(usdOnly.grokProUnlocked, false);

    const leftoverIsNotIncome = modelBotUsagePiggy({ leftoverUsd: 100, hitchTagUsd: 0.2 });
    assert.equal(leftoverIsNotIncome.kind, "demo|example");
    assert.equal(leftoverIsNotIncome.grokProUnlocked, false);
    assert.equal(leftoverIsNotIncome.provenRevenue, null);
  });

  it("unlocks Pro modeling only when hashes + proven USD cover $60", () => {
    const live = modelBotUsagePiggy({
      hitchRevenueTxs: ["0xdeadbeef"],
      hitchRevenueUsd: 80,
    });
    assert.equal(live.kind, "live-hashes");
    assert.equal(live.grokProUnlocked, true);
    assert.equal(live.provenRevenue.usd, 80);
    assert.deepEqual(live.provenRevenue.txs, ["0xdeadbeef"]);

    const short = modelBotUsagePiggy({
      hitchRevenueTxs: ["0xabc"],
      hitchRevenueUsd: 20,
    });
    assert.equal(short.kind, "live-hashes");
    assert.equal(short.grokProUnlocked, false);
  });
});
