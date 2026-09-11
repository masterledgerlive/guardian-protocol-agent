import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ensureHistoryEntry,
  normalizeHistoryMap,
  recordPriceOnHistory,
  ensureWaveStateEntry,
} from "./history-state.js";

const root = dirname(fileURLToPath(import.meta.url));

describe("history-state — missing readings[] must not throw on push", () => {
  it("reproduces the live TypeError on lastPrice-only rows (pre-fix)", () => {
    const history = { AERO: { lastPrice: 0.59 } };
    assert.equal(history.AERO.readings, undefined);
    assert.throws(() => {
      history.AERO.readings.push({ price: 0.60, time: 1 });
    }, { name: "TypeError", message: /Cannot read properties of undefined \(reading 'push'\)/ });
  });

  it("recordPriceOnHistory seeds readings and pushes after SKIP_OHLC_SEED boot quotes", () => {
    const history = {};
    // Boot quotes after #72: lastPrice only, no candle seed.
    history.AERO = { lastPrice: 0.59 };
    history.DRB = { lastPrice: 0.01 };
    history.BNKR = { lastPrice: 0.02 };

    const aero = recordPriceOnHistory(history, "AERO", 0.61, 111);
    assert.equal(aero.readings.length, 1);
    assert.equal(aero.readings[0].price, 0.61);
    assert.equal(aero.lastPrice, 0.61);

    recordPriceOnHistory(history, "DRB", 0.011, 112);
    recordPriceOnHistory(history, "BNKR", 0.021, 113);
    assert.equal(history.DRB.readings.length, 1);
    assert.equal(history.BNKR.readings.length, 1);
  });

  it("ensureHistoryEntry fills readings on existing lastPrice-only / null / non-array rows", () => {
    const history = {
      AERO: { lastPrice: 0.5 },
      LINK: { lastPrice: 18, readings: null },
      UNI: { lastPrice: 7, readings: "nope" },
    };
    const aero = ensureHistoryEntry(history, "AERO");
    assert.ok(Array.isArray(aero.readings));
    assert.equal(aero.readings.length, 0);
    assert.equal(aero.lastPrice, 0.5);
    aero.readings.push({ price: 0.51, time: 1 });
    assert.equal(history.AERO.readings.length, 1);

    ensureHistoryEntry(history, "LINK");
    ensureHistoryEntry(history, "UNI");
    history.LINK.readings.push({ price: 18.1, time: 2 });
    history.UNI.readings.push({ price: 7.1, time: 3 });
    assert.equal(history.LINK.readings.length, 1);
    assert.equal(history.UNI.readings.length, 1);
  });

  it("ensureHistoryEntry creates a full row when the symbol is missing", () => {
    const history = {};
    const h = ensureHistoryEntry(history, "AERO", { lastPrice: 0.4 });
    assert.deepEqual(h.readings, []);
    assert.equal(h.lastPrice, 0.4);
    h.readings.push({ price: 0.41, time: 1 });
    assert.equal(history.AERO.readings[0].price, 0.41);
  });

  it("normalizeHistoryMap walks every key so loadFromGitHub cannot leave holes", () => {
    const history = {
      AERO: { lastPrice: 0.59 },
      DEGEN: { readings: [{ price: 1, time: 1 }], lastPrice: 1 },
    };
    normalizeHistoryMap(history);
    assert.ok(Array.isArray(history.AERO.readings));
    assert.equal(history.DEGEN.readings.length, 1);
    history.AERO.readings.push({ price: 0.6, time: 2 });
    assert.equal(history.AERO.readings.length, 1);
  });

  it("ensureWaveStateEntry fills peaks/troughs so updateWaves push cannot crash", () => {
    const waveState = { AERO: { peaks: undefined } };
    const ws = ensureWaveStateEntry(waveState, "AERO");
    ws.peaks.push(0.6);
    ws.troughs.push(0.5);
    assert.deepEqual(ws.peaks, [0.6]);
    assert.deepEqual(ws.troughs, [0.5]);
    const fresh = ensureWaveStateEntry(waveState, "DRB");
    fresh.peaks.push(1);
    assert.equal(waveState.DRB.peaks[0], 1);
  });
});

describe("agent.js wires the helper into processToken / boot", () => {
  const src = readFileSync(join(root, "agent.js"), "utf8");

  it("recordPrice uses recordPriceOnHistory (never raw readings.push)", () => {
    const start = src.indexOf("function recordPrice(");
    assert.ok(start >= 0, "recordPrice must exist");
    const end = src.indexOf("\nfunction updateWaves(", start);
    const body = src.slice(start, end);
    assert.ok(body.includes("recordPriceOnHistory"), "recordPrice must call recordPriceOnHistory");
    assert.ok(!body.includes(".readings.push"), "recordPrice must not assume readings exists");
  });

  it("loadFromGitHub normalizes history after assigning GitHub content", () => {
    const start = src.indexOf("async function loadFromGitHub(");
    const end = src.indexOf("\nasync function persistVitaRouterState(");
    const body = src.slice(start, end > 0 ? end : start + 4000);
    assert.ok(body.includes("normalizeHistoryMap(history)"), "must normalize after history = hf.content");
  });

  it("boot quotes and live-balance lastPrice rows go through ensureHistoryEntry", () => {
    assert.ok(src.includes("ensureHistoryEntry(history, t.symbol)"), "boot quotes must ensure readings");
    assert.ok(src.includes("ensureHistoryEntry(history, symbol)"), "live balance quote path must ensure readings");
    assert.ok(!src.includes("history[t.symbol] = { lastPrice: p }"), "must not create lastPrice-only boot rows");
    assert.ok(!src.includes("history[symbol] = { lastPrice: live }"), "must not create lastPrice-only live rows");
  });

  it("initWaveState uses ensureWaveStateEntry", () => {
    const start = src.indexOf("function initWaveState(");
    const body = src.slice(start, src.indexOf("\n// ── PERMANENT TRADE LEDGER", start));
    assert.ok(body.includes("ensureWaveStateEntry(waveState, symbol)"));
  });

  it("imports history-state helpers", () => {
    assert.ok(src.includes('from "./history-state.js"'));
    assert.ok(src.includes("recordPriceOnHistory"));
    assert.ok(src.includes("ensureHistoryEntry"));
    assert.ok(src.includes("normalizeHistoryMap"));
    assert.ok(src.includes("ensureWaveStateEntry"));
  });
});
