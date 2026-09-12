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
  shouldRecycleKnownForInjectFuel,
  classifyRecycleBag,
  sellFractionAfterPiggy,
  injectReserveViable,
  injectFuelKeepUsd,
  injectVelocityScoreBoost,
  sortRecycleCandidatesByUsd,
  fillTier1Seats,
  recycleSkipsActiveTier,
  SMALL_BOOK_USD,
  INJECT_FUEL_MIN_USD,
} from "./inject-revenue.js";
import { leftoverAfterFeesEth } from "./lose-zero-gate.js";

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

  it("treats FIFO ETH as known cost without a USD entryPrice", () => {
    const kind = classifyRecycleBag({
      unknownEntry: false,
      totalInvestedEth: 0.000271,
      entryPrice: null,
      hasUsdBasis: false,
    });
    assert.equal(kind.unknownBag, false);
    assert.equal(kind.hasKnownPos, true);
    assert.equal(kind.fifoKnown, true);
    assert.equal(kind.fifoEth, 0.000271);
    assert.equal(
      classifyRecycleBag({ unknownEntry: true, totalInvestedEth: 0 }).unknownBag,
      true,
    );
  });
});

describe("inject-revenue: capital velocity snowball", () => {
  it("aligns sell fraction after piggy so leftover cannot flip allow→hold", () => {
    // Live MORPHO bug: request 75% but piggy sells ~73.5% while entrySlice used 75%
    const bal = 0.824;
    const tokensToSell = bal * 0.98 * 0.75; // sellable * pct
    const frac = sellFractionAfterPiggy({ balance: bal, tokensToSell });
    assert.ok(Math.abs(frac - tokensToSell / bal) < 1e-12);
    const entryEth = 0.0008;
    const proceedsRight = (tokensToSell * 2.4) / 2478;
    const wrong = leftoverAfterFeesEth({
      projectedProceedsEth: proceedsRight,
      entryEth,
      sellPct: 0.75,
      feePct: 0.006,
      gasCostEth: 0.00001,
      impactPct: 0.002,
    });
    const right = leftoverAfterFeesEth({
      projectedProceedsEth: proceedsRight,
      entryEth,
      sellPct: frac,
      feePct: 0.006,
      gasCostEth: 0.00001,
      impactPct: 0.002,
    });
    assert.ok(right > wrong, "piggy-aligned sellPct must not overstate entry cost");
    assert.equal(sellFractionAfterPiggy({ balance: 0, tokensToSell: 1 }), 0);
  });

  it("recycles known bags when liquid-starved inject-all", () => {
    assert.equal(
      shouldRecycleKnownForInjectFuel({
        knownEntry: true,
        posUsd: 1.98,
        liquidStarved: true,
        injectAll: true,
      }),
      true,
    );
    assert.equal(
      shouldRecycleKnownForInjectFuel({
        knownEntry: true,
        posUsd: 0.4,
        liquidStarved: true,
        injectAll: true,
        minUsd: INJECT_FUEL_MIN_USD,
      }),
      false,
    );
    assert.equal(
      shouldRecycleKnownForInjectFuel({
        knownEntry: true,
        posUsd: 4.35,
        liquidStarved: false,
        injectAll: true,
      }),
      false,
    );
    assert.equal(
      shouldRecycleKnownForInjectFuel({
        knownEntry: false,
        posUsd: 4,
        liquidStarved: true,
        injectAll: true,
      }),
      false,
    );
  });

  it("refuses UNI hard-reserve on sub-min inject-all books", () => {
    assert.equal(injectReserveViable({ tradeableUsd: 0.71, minEntryUsd: 2, injectAll: true }), false);
    assert.equal(injectReserveViable({ tradeableUsd: 5, minEntryUsd: 2, injectAll: true }), true);
    assert.equal(injectReserveViable({ tradeableUsd: 20, minEntryUsd: 0, injectAll: false }), true);
  });

  it("does not velocity-fill T1 AERO when inject-all cannot fund the seat", () => {
    const scored = [{ symbol: "AERO", score: 90 }, { symbol: "DEGEN", score: 80 }];
    const dead = fillTier1Seats({
      scored,
      reservedMain: null,
      tier1Count: 1,
      injectAll: true,
      reserveOk: false,
    });
    assert.deepEqual(dead.tier1, []);
    assert.equal(dead.blocked, true);
    assert.equal(dead.reason, "sub-min-inject-all");
    const live = fillTier1Seats({
      scored,
      reservedMain: null,
      tier1Count: 1,
      injectAll: true,
      reserveOk: true,
    });
    assert.deepEqual(live.tier1, ["AERO"]);
    assert.equal(live.blocked, false);
  });

  it("recycles former T1 when starved with no primed/fundable seat", () => {
    assert.equal(
      recycleSkipsActiveTier({ liquidStarved: true, injectSeatViable: false, primedAllowCount: 0 }),
      false,
    );
    assert.equal(
      recycleSkipsActiveTier({ liquidStarved: true, injectSeatViable: true, primedAllowCount: 0 }),
      false,
    );
    assert.equal(
      recycleSkipsActiveTier({ liquidStarved: false, injectSeatViable: true, primedAllowCount: 0 }),
      true,
    );
    assert.equal(
      recycleSkipsActiveTier({ liquidStarved: true, injectSeatViable: true, primedAllowCount: 1 }),
      true,
    );
  });

  it("shrinks keep floor when recycling inject fuel", () => {
    assert.equal(
      injectFuelKeepUsd({ liquidStarved: true, recycleFuel: true, moonshotHoldUsd: 0.5, piggyMinUsd: 0.05 }),
      0.05,
    );
    assert.equal(
      injectFuelKeepUsd({ liquidStarved: false, recycleFuel: true, moonshotHoldUsd: 0.5 }),
      0.5,
    );
  });

  it("boosts velocity names on inject-all and sorts largest bags first", () => {
    assert.ok(injectVelocityScoreBoost({ symbol: "DEGEN", injectAll: true }) >
      injectVelocityScoreBoost({ symbol: "UNI", injectAll: true }));
    assert.equal(injectVelocityScoreBoost({ symbol: "DEGEN", injectAll: false, liquidStarved: false }), 0);
    const sorted = sortRecycleCandidatesByUsd([
      { posUsd: 1.98, symbol: "MORPHO" },
      { posUsd: 4.35, symbol: "LINK" },
      { posUsd: 0.14, symbol: "TOSHI" },
    ]);
    assert.equal(sorted[0].symbol, "LINK");
    assert.equal(sorted[2].symbol, "TOSHI");
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
    assert.ok(src.includes("classifyRecycleBag"), "dust-recycle must honor known FIFO eth");
  });

  it("wires inject fuel recycle + piggy-aligned sell gate", () => {
    assert.ok(src.includes("shouldRecycleKnownForInjectFuel"));
    assert.ok(src.includes("sellFractionAfterPiggy"));
    assert.ok(src.includes("injectReserveViable"));
    assert.ok(src.includes("fillTier1Seats"));
    assert.ok(src.includes("recycleSkipsActiveTier"));
    assert.ok(src.includes("INJECT FUEL"));
    assert.ok(src.includes("sortRecycleCandidatesByUsd"));
    assert.ok(src.includes("fifoImpliedEntryUsd"), "ETH-only FIFO must imply USD entry for peak gates");
    assert.ok(!src.includes("netUsd: 1"), "must not invent $1 profit when USD entry is missing");
    assert.ok(src.includes("totalBookEth"), "max-position must use liquid+bags");
    assert.ok(!src.includes("tradeableWithWeth * 0.60"), "starved liquid must not mark every bag maxed");
  });
});
