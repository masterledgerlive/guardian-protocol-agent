import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_MIN_BUY_USD,
  TOKEN_MIN_BUY_USD,
  parseTokenMinBuyEnv,
  minBuyUsdForToken,
  operatorBuyBelowMin,
  applyWethDeadFreeze,
  WETH_DEAD_USDC_PRIMARY,
} from "./token-mins.js";
import {
  DEFAULT_ALIGN_MIN,
  cycleAlignMin,
  rankWaveSeedSources,
  mergeWaveCandles,
  scoreEntryAlignment,
  canExecuteNoLossCycle,
  createSuccessionTracker,
  formatSuccessionReport,
} from "./wave-cycle.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

describe("token mins", () => {
  it("defaults and inject mains stay smoke-testable", () => {
    assert.equal(DEFAULT_MIN_BUY_USD, 0.50);
    assert.equal(minBuyUsdForToken("UNI"), 0.50);
    assert.equal(minBuyUsdForToken("TOSHI"), 0.50);
    assert.ok(TOKEN_MIN_BUY_USD.XCN >= 25);
  });

  it("catalog and env override map", () => {
    assert.equal(minBuyUsdForToken({ symbol: "UNI", minBuyUsd: 1.25 }), 1.25);
    assert.equal(
      minBuyUsdForToken("TOSHI", { TOKEN_MIN_BUY_USD_JSON: '{"TOSHI":2}' }),
      2,
    );
    assert.deepEqual(parseTokenMinBuyEnv('{"AERO":1.5}'), { AERO: 1.5 });
    assert.deepEqual(parseTokenMinBuyEnv("nope"), {});
  });

  it("operator buy below min returns a clear skip", () => {
    assert.match(operatorBuyBelowMin({ symbol: "XCN", usd: 1 }), /min buy/);
    assert.equal(operatorBuyBelowMin({ symbol: "UNI", usd: 1 }), null);
    assert.equal(operatorBuyBelowMin({ symbol: "UNI", usd: 0 }), null);
  });

  it("freezes XCN as WETH-dead / USDC-primary", () => {
    assert.ok(WETH_DEAD_USDC_PRIMARY.XCN);
    const t = applyWethDeadFreeze({ symbol: "XCN", address: "0x9c", feeTier: 10000 });
    assert.equal(t.frozen, true);
    assert.match(t.frozenReason, /WETH/);
    assert.equal(applyWethDeadFreeze({ symbol: "UNI" }).frozen, undefined);
  });
});

describe("wave-cycle multi-source + alignment", () => {
  const gt = Array.from({ length: 10 }, (_, i) => ({
    t: 1_700_000_000_000 + i * 86_400_000, o: 1, h: 1.1, l: 0.9, c: 1, v: 1,
  }));
  const ds = Array.from({ length: 8 }, (_, i) => ({
    t: 1_700_000_000_000 + i * 86_400_000, o: 1, h: 1.2, l: 0.8, c: 1, v: 1,
  }));
  const bi = Array.from({ length: 12 }, (_, i) => ({
    t: 1_700_000_000_000 + i * 86_400_000, o: 1, h: 1.05, l: 0.95, c: 1, v: 1,
  }));

  it("ranks Base sources before Binance and flags multi", () => {
    const r = rankWaveSeedSources({ gt, ds, binance: bi, allowBinance: true });
    assert.equal(r.picked.src, "GeckoTerminal");
    assert.equal(r.multi, true);
    assert.ok(r.sources.length >= 2);
  });

  it("falls back to Binance when Base empty", () => {
    const r = rankWaveSeedSources({ gt: null, ds: null, binance: bi, allowBinance: true });
    assert.equal(r.picked.src, "Binance");
    assert.equal(r.multi, false);
  });

  it("merges extremes across sources", () => {
    const merged = mergeWaveCandles(gt, [ds]);
    assert.equal(merged[0].h, 1.2);
    assert.equal(merged[0].l, 0.8);
  });

  it("align min defaults to 2; env 3 honored", () => {
    assert.equal(DEFAULT_ALIGN_MIN, 2);
    assert.equal(cycleAlignMin({}), 2);
    assert.equal(cycleAlignMin({ CYCLE_ALIGN_MIN: "3" }), 3);
    assert.equal(cycleAlignMin({ CYCLE_ALIGN_MIN: "99" }), 4);
  });

  it("requires ≥2 aligned vars and a price signal for no-loss cycle", () => {
    const one = scoreEntryAlignment({ atMinTrough: true });
    assert.equal(one.count, 1);
    assert.equal(
      canExecuteNoLossCycle(one, { alignMin: 2, hasPriceSignal: true, armed: true }).allow,
      false,
    );

    const two = scoreEntryAlignment({ atMinTrough: true, leftoverCovers: true });
    assert.equal(two.count, 2);
    assert.equal(
      canExecuteNoLossCycle(two, { alignMin: 2, hasPriceSignal: true, armed: true }).allow,
      true,
    );

    const leftoverOnly = scoreEntryAlignment({ leftoverCovers: true, smartMoneyConfirming: true });
    assert.equal(
      canExecuteNoLossCycle(leftoverOnly, { alignMin: 2, hasPriceSignal: false, armed: true }).allow,
      false,
    );
  });

  it("tracks succession streaks without loss", () => {
    const t = createSuccessionTracker();
    t.recordCycleResult("UNI", 0.05);
    t.recordCycleResult("UNI", 0.02);
    t.recordCycleResult("UNI", -0.01);
    t.recordCycleResult("UNI", 0.01);
    const s = t.snapshot("UNI");
    assert.equal(s.best, 2);
    assert.equal(s.streak, 1);
    assert.equal(s.totalWins, 3);
    assert.equal(s.totalLosses, 1);
    assert.match(formatSuccessionReport(t.all()), /UNI/);
  });
});

describe("agent.js wires TDZ fix + mins + wave cycle", () => {
  const src = readFileSync(join(root, "agent.js"), "utf8");

  it("declares minTrgh before stopLossPrice (no TDZ)", () => {
    const start = src.indexOf("async function processToken(");
    assert.ok(start >= 0);
    const body = src.slice(start, start + 60_000);
    const minDecl = body.search(/\bconst minTrgh\b/);
    const stop = body.search(/\bconst stopLossPrice\b/);
    assert.ok(minDecl >= 0 && stop > minDecl, "minTrgh must be live before stopLossPrice");
  });

  it("imports token-mins and wave-cycle helpers", () => {
    assert.ok(src.includes('from "./token-mins.js"'));
    assert.ok(src.includes('from "./wave-cycle.js"'));
    assert.ok(src.includes("operatorBuyBelowMin") || src.includes("minBuyUsdForToken"));
    assert.ok(src.includes("scoreEntryAlignment") && src.includes("canExecuteNoLossCycle"));
  });

  it("XCN catalog row is frozen after WETH-dead apply", () => {
    assert.ok(src.includes("applyWethDeadFreeze") || src.includes("WETH_DEAD"));
    assert.match(src, /symbol:\s*"XCN"/);
  });
});
