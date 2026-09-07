/**
 * inject-revenue.js — small-book tiers + inject-main pullback entry.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  tierBookParams,
  entryTroughForBuy,
  isInjectPullbackEntry,
  nearEntryScoreBoost,
  shouldRecycleUnknownDust,
  SMALL_BOOK_USD,
} from "./inject-revenue.js";

const root = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(root, "agent.js"), "utf8");

describe("inject-revenue: small-book capital concentration", () => {
  it("concentrates to 2 T1 seats under $15 tradeable", () => {
    const p = tierBookParams(6);
    assert.equal(p.smallBook, true);
    assert.equal(p.tier1Count, 2);
    assert.equal(p.tier1Pct, 0.85);
    assert.ok(p.tier2MinSlotUsd < 4);
  });

  it("keeps classic 65/35 above the small-book floor", () => {
    const p = tierBookParams(SMALL_BOOK_USD + 1);
    assert.equal(p.smallBook, false);
    assert.equal(p.tier1Count, 3);
    assert.equal(p.tier1Pct, 0.65);
  });
});

describe("inject-revenue: entry trough + pullback", () => {
  it("ignores stale 90d min for inject mains when recent low is available", () => {
    // Live UNI: mark ~$7, candle min ~$3.17 → must climb to recent low
    const t = entryTroughForBuy({
      minTrough: 3.17,
      recentLow: 6.85,
      price: 6.98,
      preferRecent: true,
    });
    assert.equal(t, 6.85);
  });

  it("keeps classic min trough when not preferRecent", () => {
    assert.equal(
      entryTroughForBuy({ minTrough: 3.17, recentLow: 6.85, price: 6.98, preferRecent: false }),
      3.17,
    );
  });

  it("fires inject pullback near recent low", () => {
    assert.equal(
      isInjectPullbackEntry({
        isInjectMain: true,
        price: 6.9,
        recentLow: 6.85,
        recentReadings: 20,
        priceFallingFast: false,
      }),
      true,
    );
    assert.equal(
      isInjectPullbackEntry({
        isInjectMain: true,
        price: 7.5,
        recentLow: 6.85,
        recentReadings: 20,
      }),
      false,
    );
    assert.equal(
      isInjectPullbackEntry({
        isInjectMain: false,
        price: 6.9,
        recentLow: 6.85,
        recentReadings: 20,
      }),
      false,
    );
  });

  it("boosts score when inject main is on a pullback", () => {
    assert.ok(nearEntryScoreBoost({ isInjectMain: true, pullback: true }) >
      nearEntryScoreBoost({ isInjectMain: true, pullback: false }));
    assert.equal(nearEntryScoreBoost({ isInjectMain: false, pullback: true }), 0);
  });
});

describe("inject-revenue: unknown dust recycle", () => {
  it("recycles unknown bags above lottery floor", () => {
    assert.equal(shouldRecycleUnknownDust({ unknownEntry: true, posUsd: 0.9, moonshotHoldUsd: 0.5 }), true);
    assert.equal(shouldRecycleUnknownDust({ unknownEntry: true, posUsd: 0.05, moonshotHoldUsd: 0.5 }), false);
    assert.equal(shouldRecycleUnknownDust({ unknownEntry: false, posUsd: 2 }), false);
  });
});

describe("inject-revenue: wired into agent.js", () => {
  it("imports helpers and gates tiers before hitch fee on auto buys", () => {
    assert.ok(src.includes('from "./inject-revenue.js"'));
    assert.ok(src.includes("isInjectPullbackEntry"));
    assert.ok(src.includes("entryTroughForBuy"));
    assert.ok(src.includes("tierBookParams"));
    const buyFn = src.indexOf("async function executeBuy(");
    const body = src.slice(buyFn, src.indexOf("\nasync function executeSell", buyFn));
    const tierIdx = body.indexOf("not in active tiers");
    const hitchIdx = body.indexOf("quoteHitchL1ForGates");
    assert.ok(tierIdx > 0 && hitchIdx > 0, "tier gate and hitch quote both present");
    assert.ok(tierIdx < hitchIdx, "OUT-tier must die before hitch L1 fee RPC");
  });

  it("moonshot / dust recycle covers unknownEntry bags", () => {
    assert.ok(src.includes("shouldRecycleUnknownDust"));
    assert.ok(src.includes("unknownEntry") && src.includes("MOONSHOT"));
  });
});
