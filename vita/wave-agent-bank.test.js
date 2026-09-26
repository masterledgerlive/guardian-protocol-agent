import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  assessWaveToken,
  buildWaveHlMachine,
  createWaveHlLedger,
  lastWaveHlRide,
  recordWaveExtreme,
} from "./wave-hl-ledger.js";
import {
  applyWavePebbles,
  buildSectorBanks,
  buildWaveAgentDesk,
  detectLull,
  formatWaveClickCard,
  pebblesFromCalldata,
  pullWavePebbles,
  robinhoodMirror,
  scoreFills,
  sectorOf,
  wavesNeeded,
} from "./wave-agent-bank.js";

const TX = "0x" + "ab".repeat(32);

function rowFrom(prints, price, entryPrice) {
  const ledger = createWaveHlLedger();
  for (const p of prints) recordWaveExtreme(ledger, p);
  return assessWaveToken(ledger, { symbol: prints[0].symbol, price, entryPrice });
}

describe("wave click knows the swings still needed", () => {
  it("asks for 2 highs and 2 lows until both sides are saved", () => {
    const thin = rowFrom([
      { symbol: "AERO", side: "low", price: 1, at: 1, source: "live" },
      { symbol: "AERO", side: "high", price: 1.2, at: 2, source: "live" },
    ], 1.1, 1);
    const need = wavesNeeded(thin);
    assert.equal(need.ready, false);
    assert.equal(need.highsStill, 1);
    assert.equal(need.lowsStill, 1);
    const card = formatWaveClickCard({
      symbol: "AERO",
      row: thin,
      chain: { at: 1, anchors: 3, trails: 40, whl: 0 },
      balances: { AERO: 12.5 },
      prices: { AERO: 1.1 },
    });
    assert.match(card, /needs 2 highs and 2 lows/);
    assert.match(card, /Still 1 high/);
    assert.match(card, /0 §WHL§ pebbles/);
    assert.match(card, /dex/);
    assert.match(card, /AERO-USD/);
    assert.match(card, /Quote only/);
  });

  it("states the next prediction once both sides are saved", () => {
    const ready = rowFrom([
      { symbol: "LINK", side: "low", price: 8, at: 1, source: "live" },
      { symbol: "LINK", side: "high", price: 9, at: 2, source: "live" },
      { symbol: "LINK", side: "low", price: 8.4, at: 3, source: "live" },
      { symbol: "LINK", side: "high", price: 9.6, at: 4, source: "live" },
    ], 8.8, 8);
    assert.equal(wavesNeeded(ready).ready, true);
    const card = formatWaveClickCard({ symbol: "LINK", row: ready, chain: { at: 1, anchors: 3, trails: 1, whl: 0 } });
    assert.match(card, /Ready/);
    assert.match(card, /LINK-USD/);
  });
});

describe("sector bank, rides, lull, classical agents", () => {
  it("counts accrued units by sector and ignores unsealed fills", () => {
    assert.equal(sectorOf("brett"), "meme");
    assert.equal(sectorOf("NOPE"), "other");
    const banks = buildSectorBanks({
      balances: { AERO: 10, BRETT: 4, LINK: 1 },
      prices: { AERO: 2, BRETT: 0 },
    });
    const dex = banks.sectors.find((s) => s.sector === "dex");
    assert.equal(dex.units, 10);
    assert.equal(dex.usd, 20);
    const meme = banks.sectors.find((s) => s.sector === "meme");
    assert.equal(meme.usd, null);
    const fills = scoreFills([
      { type: "SELL", symbol: "AERO", netUsd: 1.5, tx: TX },
      { type: "SELL", symbol: "AERO", netUsd: -0.4, tx: "0x" + "cd".repeat(32) },
      { type: "SELL", symbol: "AERO", netUsd: 9, tx: "pending" },
      { type: "SELL", symbol: "AERO", netUsd: 0, tx: "0x" + "ef".repeat(32) },
      { type: "BUY", symbol: "AERO", netUsd: 3, tx: TX },
    ]);
    assert.equal(fills.bySymbol.AERO.rides, 1);
    assert.equal(fills.bySymbol.AERO.wipeouts, 1);
    assert.equal(fills.skipped, 3);
  });

  it("calls a lull when the book is waiting and keeps agents advisory", () => {
    const waiting = (symbol, stage, arrow) => ({
      symbol, stage, arrow, price: 1, confidence: 40, exitMode: "HOLD", storedHighs: 2, storedLows: 2,
    });
    const rows = [
      waiting("BRETT", "BASE", "↓"),
      waiting("DEGEN", "FALLING", "↓"),
      waiting("TOSHI", "BASE", "↓"),
      waiting("KEYCAT", "HOLD", "↓"),
      { symbol: "AERO", stage: "RISING", arrow: "↑", price: 1, confidence: 70, exitMode: "HOLD", storedHighs: 4, storedLows: 4 },
    ];
    rows[3].exitMode = "HOLD_RED";
    const lull = detectLull(rows);
    assert.equal(lull.active, true);
    assert.equal(lull.rising, 1);
    const desk = buildWaveAgentDesk({
      rows,
      trades: [{ type: "SELL", symbol: "AERO", netUsd: 2, tx: TX }],
      balances: { AERO: 8, BRETT: 3 },
      chain: { at: 1, anchors: 3, trails: 40, whl: 0 },
      symbols: ["AERO", "BRETT"],
    });
    assert.equal(desk.executes, false);
    assert.ok(desk.agents.every((a) => a.executes === false));
    assert.equal(desk.agents[0].score >= desk.agents[1].score, true);
    assert.equal(desk.proven[0].symbol, "AERO");
    assert.equal(desk.shelter[0].symbol, "AERO");
    assert.equal(robinhoodMirror("BNKR"), null);
    assert.equal(robinhoodMirror("CBBTC").pair, "BTC-USD");
    assert.equal(robinhoodMirror("CBBTC").sameToken, false);
  });

  it("shelters in USDC when stable units are on the book", () => {
    const desk = buildWaveAgentDesk({
      rows: [
        { symbol: "BRETT", stage: "BASE", arrow: "↓", price: 1, confidence: 20, exitMode: "HOLD_RED", storedHighs: 2, storedLows: 2 },
        { symbol: "DEGEN", stage: "BASE", arrow: "↓", price: 1, confidence: 20, exitMode: "HOLD", storedHighs: 2, storedLows: 2 },
        { symbol: "TOSHI", stage: "FALLING", arrow: "↓", price: 1, confidence: 20, exitMode: "HOLD", storedHighs: 2, storedLows: 2 },
      ],
      balances: { USDC: 25 },
      chain: { at: 0 },
    });
    assert.equal(desk.lull.active, true);
    assert.equal(desk.shelter[0].symbol, "USDC");
    assert.match(desk.chain.text, /has not returned/);
  });
});

describe("chain pebbles", () => {
  it("merges a §WHL§ line from calldata and ignores other trails", async () => {
    const ledger = createWaveHlLedger();
    recordWaveExtreme(ledger, { symbol: "AERO", side: "low", price: 1, at: 1, source: "live" });
    recordWaveExtreme(ledger, { symbol: "AERO", side: "high", price: 1.2, at: 2, source: "live" });
    const before = ledger.tokens.AERO.highCount;
    const row = assessWaveToken(ledger, { symbol: "AERO", price: 1.1, entryPrice: 1 });
    const built = buildWaveHlMachine(row, { at: Date.parse("2026-09-24T01:40:00.000Z") });
    const hex = "0x" + Buffer.from(built.line, "utf8").toString("hex");
    const vin = "0x" + Buffer.from("VITAFEED VIN packet", "utf8").toString("hex");
    assert.equal(pebblesFromCalldata(vin, TX).length, 0);
    assert.equal(pebblesFromCalldata(hex, "0xdead").length, 0);
    const anchor = "0x" + "22".repeat(32);
    const pull = await pullWavePebbles({
      anchors: [{ tx: anchor }],
      fetchTxs: async () => [{ hash: TX, input: hex }, { hash: "0x" + "33".repeat(32), input: vin }],
      fetchCalldata: async () => "0x" + Buffer.from("plain swap", "utf8").toString("hex"),
      limit: 40,
    });
    assert.equal(pull.whl, 1);
    assert.equal(pull.trails, 2);
    const applied = applyWavePebbles(ledger, pull.pebbles);
    assert.equal(applied.refused, 0);
    assert.equal(applied.ridesSealed, 1);
    assert.equal(ledger.tokens.AERO.highCount, before);
    assert.equal(lastWaveHlRide(ledger, "AERO").txHash, TX);
    const again = applyWavePebbles(ledger, pull.pebbles);
    assert.equal(again.ridesSealed, 0);
    const empty = createWaveHlLedger();
    applyWavePebbles(empty, pull.pebbles);
    const restored = assessWaveToken(empty, { symbol: "AERO", price: 1.1, entryPrice: 1 });
    assert.equal(wavesNeeded(restored).haveHighs >= 1, true);
    assert.equal(wavesNeeded(restored).haveLows >= 1, true);
    assert.equal(applyWavePebbles(empty, [{ txHash: "nope", symbol: "AERO", line: "x" }]).refused, 1);
  });
});
