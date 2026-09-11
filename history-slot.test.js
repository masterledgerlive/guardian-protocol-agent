import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ensureArray,
  ensureHistorySlot,
  hydrateHistoryMap,
  recordPriceInto,
  ensureWaveSlot,
  ensureWatchSlot,
} from "./history-slot.js";
import { isSkipOhlcSeed, planOhlcSeed } from "./price-oracle.js";

const root = dirname(fileURLToPath(import.meta.url));

describe("history slot — skip-seed lastPrice-only must not throw on push", () => {
  it("boot-quote { lastPrice } without readings: recordPriceInto does not throw", () => {
    const history = { AERO: { lastPrice: 0.5886 } };
    assert.equal(history.AERO.readings, undefined);
    assert.throws(() => {
      history.AERO.readings.push({ price: 0.59, time: 1 });
    }, /push/);
    const slot = recordPriceInto(history, "AERO", 0.59, 1_700_000_000_000);
    assert.ok(Array.isArray(slot.readings));
    assert.equal(slot.readings.length, 1);
    assert.equal(slot.readings[0].price, 0.59);
    assert.equal(slot.lastPrice, 0.59);
    assert.doesNotThrow(() => recordPriceInto(history, "AERO", 0.60, 1_700_000_000_100));
    assert.equal(history.AERO.readings.length, 2);
  });

  it("hydrateHistoryMap repairs GitHub / recon maps missing readings", () => {
    const history = {
      AERO: { lastPrice: 0.58 },
      TOSHI: { lastPrice: 0.0004, readings: null },
      UNI: { lastPrice: 7.2, readings: [{ price: 7.1, time: 1 }] },
    };
    hydrateHistoryMap(history);
    assert.ok(Array.isArray(history.AERO.readings));
    assert.equal(history.AERO.readings.length, 0);
    assert.ok(Array.isArray(history.TOSHI.readings));
    assert.equal(history.UNI.readings.length, 1);
    assert.doesNotThrow(() => recordPriceInto(history, "TOSHI", 0.00041));
  });

  it("ensureHistorySlot creates a missing symbol and ignores bad map keys", () => {
    const history = {};
    const slot = ensureHistorySlot(history, "BRETT");
    assert.deepEqual(slot.readings, []);
    assert.equal(slot.lastPrice, null);
    assert.equal(history.BRETT, slot);
    const empty = ensureHistorySlot(null, "");
    assert.ok(Array.isArray(empty.readings));
  });

  it("ensureWaveSlot / ensureWatchSlot / ensureArray never throw on push", () => {
    const waves = { AERO: { lastPeak: 1 } };
    const ws = ensureWaveSlot(waves, "AERO");
    assert.doesNotThrow(() => ws.peaks.push(1.2));
    assert.doesNotThrow(() => ws.troughs.push(0.9));
    const watch = { FOO: { lastPrice: 1 } };
    const wp = ensureWatchSlot(watch, "FOO");
    assert.doesNotThrow(() => wp.prices.push({ price: 1, time: 0 }));
    const bare = {};
    assert.doesNotThrow(() => ensureArray(bare, "rows").push("x"));
    assert.deepEqual(bare.rows, ["x"]);
  });
});

describe("operator-buy flush ordering vs OHLC skip", () => {
  it("SKIP_OHLC_SEED still skips the entire seed pass", () => {
    assert.equal(isSkipOhlcSeed({ SKIP_OHLC_SEED: "yes" }), true);
    const plan = planOhlcSeed([{ symbol: "AERO" }], { SKIP_OHLC_SEED: "yes" });
    assert.equal(plan.skipAll, true);
    assert.equal(plan.seedTokens.length, 0);
    assert.equal(plan.reason, "SKIP_OHLC_SEED");
  });

  it("agent.js: flush before seed, hydrate/ensure before recordPrice push, unspent settle", () => {
    const src = readFileSync(join(root, "agent.js"), "utf8");
    const main = src.indexOf("async function main()");
    const mainBody = src.slice(main);
    const queue = mainBody.indexOf("applyOperatorBuyEnv()");
    const firstFlush = mainBody.indexOf("flushPendingOperatorBuys");
    const seed = mainBody.indexOf("await loadHistoricalData(90)");
    const recon = mainBody.indexOf("Chain reconciliation");
    const afterRecon = mainBody.indexOf("flushPendingOperatorBuys", recon);
    assert.ok(queue >= 0 && firstFlush > queue, "queue then flush");
    assert.ok(seed > firstFlush, "first flush before OHLC seed (runs even when SKIP_OHLC_SEED)");
    assert.ok(afterRecon > recon && afterRecon > seed, "flush again after recon");

    const rec = src.indexOf("function recordPrice(");
    const recEnd = src.indexOf("\nfunction ", rec + 1);
    const recBody = src.slice(rec, recEnd);
    assert.ok(recBody.includes("recordPriceInto") || recBody.includes("ensureHistorySlot"),
      "recordPrice must go through ensureHistorySlot / recordPriceInto");
    assert.ok(src.includes("hydrateHistoryMap"), "GitHub history must be hydrated after load");
    assert.ok(src.includes("settleFlushedOperatorBuy"), "unspent flush must re-queue");

    const flush = src.indexOf("async function flushPendingOperatorBuys(");
    const flushEnd = src.indexOf("\nfunction applyOperatorSellEnv");
    const flushBody = src.slice(flush, flushEnd);
    assert.ok(flushBody.includes("settleFlushedOperatorBuy"), "flush must settle unspent");
    assert.ok(src.includes("ensureHistorySlot(history"), "boot quotes / recon must ensure readings before live ticks");

    const seedFn = src.indexOf("async function loadHistoricalData(");
    const seedEnd = src.indexOf("\nfunction bootstrapWavesFromHistory");
    const seedBody = src.slice(seedFn, seedEnd);
    const skip = seedBody.indexOf("seedPlan.skipAll");
    const timeout = seedBody.indexOf("SEED_TOKEN_TIMEOUT_MS");
    assert.ok(skip >= 0 && timeout > skip, "SKIP_OHLC_SEED still short-circuits before timeout");

    assert.match(src, /0x3d5D143381916280ff91407FeBEB52f2b60f33Cf/i);
  });
});
