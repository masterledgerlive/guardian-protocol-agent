import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DIVIDEND_CAP,
  DIVIDEND_FLOOR,
  MAX_PRINTS,
  WAVE_HL_MAGIC,
  assessWaveToken,
  backfillWaveSwings,
  bankWaveHlRide,
  buildWaveHlMachine,
  commitWaveHlRideHash,
  createWaveHlLedger,
  extractWaveHlMachines,
  formatWaveBoardTelegram,
  loadWaveHlLedger,
  mergeWaveHlLedgers,
  parseWaveHlMachine,
  pickCascadeToken,
  planDividendWithdraw,
  planWaveHlRide,
  readWaveHlFromHex,
  recordWaveExtreme,
  saveWaveHlLedger,
} from "./wave-hl-ledger.js";

function bookWith(prints) {
  const ledger = createWaveHlLedger();
  for (const p of prints) {
    recordWaveExtreme(ledger, p);
  }
  return ledger;
}

describe("wave HL ledger", () => {
  it("keeps every swing count and the all-time high after the series trims", () => {
    const ledger = createWaveHlLedger();
    let price = 1;
    for (let i = 0; i < 300; i++) {
      price *= 1.01;
      const rec = recordWaveExtreme(ledger, {
        symbol: "aero",
        side: "high",
        price,
        at: 1_000 + i,
        source: "live",
      });
      assert.equal(rec.accepted, true);
    }
    const slot = ledger.tokens.AERO;
    assert.equal(slot.highs.length, MAX_PRINTS);
    assert.equal(slot.highCount, 300);
    assert.ok(Math.abs(slot.ath - price) / price < 1e-9);
    const again = recordWaveExtreme(ledger, {
      symbol: "AERO",
      side: "high",
      price,
      at: 2_000,
      source: "live",
    });
    assert.equal(again.accepted, false);
    assert.equal(slot.highCount, 300);
  });

  it("does not double-count a history backfill", () => {
    const readings = [];
    const wave = [1, 1.2, 1.5, 1.2, 1, 1.3, 1.6, 1.2, 0.95];
    wave.forEach((price, i) => readings.push({ price, time: 10_000 + i * 1000 }));
    const ledger = createWaveHlLedger();
    const first = backfillWaveSwings(ledger, "BRETT", readings);
    const second = backfillWaveSwings(ledger, "BRETT", readings);
    assert.ok(first.added >= 1);
    assert.equal(second.added, 0);
    assert.equal(ledger.tokens.BRETT.highs.length, ledger.tokens.BRETT.highCount);
    assert.equal(ledger.tokens.BRETT.lows.length, ledger.tokens.BRETT.lowCount);
  });

  it("merges two books and keeps a real tx hash", () => {
    const a = createWaveHlLedger();
    recordWaveExtreme(a, { symbol: "UNI", side: "low", price: 4, at: 1, source: "live" });
    const b = createWaveHlLedger();
    recordWaveExtreme(b, { symbol: "UNI", side: "high", price: 6, at: 2, source: "live" });
    const built = buildWaveHlMachine(assessWaveToken(b, { symbol: "UNI", price: 6, entryPrice: 4 }));
    const ride = bankWaveHlRide(b, built, { symbol: "UNI" });
    const hash = "0x" + "ab".repeat(32);
    assert.equal(commitWaveHlRideHash(b, { symbol: "UNI", machine: ride.machine, txHash: hash }), true);
    assert.equal(commitWaveHlRideHash(b, { symbol: "UNI", machine: ride.machine, txHash: "0xnotahash" }), false);
    const merged = mergeWaveHlLedgers(a, b);
    assert.equal(merged.tokens.UNI.highs.length, 1);
    assert.equal(merged.tokens.UNI.lows.length, 1);
    assert.equal(merged.tokens.UNI.rides[0].txHash, hash);
    assert.equal(merged.tokens.UNI.ath, 6);
    assert.equal(merged.tokens.UNI.atl, 4);
  });

  it("round-trips the ledger on disk", () => {
    const cwd = mkdtempSync(join(tmpdir(), "whl-"));
    const ledger = createWaveHlLedger();
    recordWaveExtreme(ledger, { symbol: "LINK", side: "low", price: 8, at: 5, source: "live" });
    saveWaveHlLedger(ledger, { cwd });
    const loaded = loadWaveHlLedger({ cwd });
    assert.equal(loaded.tokens.LINK.lows[0].p, 8);
    assert.equal(loaded.id, "wave-hl-ledger-v1");
    const disk = JSON.parse(readFileSync(join(cwd, "vita/memory/wave-hl-ledger.json"), "utf8"));
    assert.equal(disk.tokens.LINK.lowCount, 1);
  });
});

describe("wave stage, dividend, cascade", () => {
  it("takes 30% when the exit target is made and leaves the rest", () => {
    const ledger = bookWith([
      { symbol: "AERO", side: "low", price: 1, at: 1, source: "live" },
      { symbol: "AERO", side: "high", price: 1.1, at: 2, source: "live" },
      { symbol: "AERO", side: "low", price: 1.05, at: 3, source: "live" },
      { symbol: "AERO", side: "high", price: 1.2, at: 4, source: "live" },
    ]);
    const row = assessWaveToken(ledger, { symbol: "AERO", price: 1.2, entryPrice: 1 });
    assert.equal(row.exitMode, "HARD_TARGET");
    assert.equal(row.dividendPct, DIVIDEND_CAP);
    assert.equal(row.leavePct, 0.7);
    assert.equal(row.stage, "PEAK");
    assert.equal(row.arrow, "↓");
    const plan = planDividendWithdraw({
      balance: 1000,
      priceUsd: 1.2,
      dividendPct: row.dividendPct,
      symbol: "AERO",
      token: { symbol: "AERO", piggyBankPct: 0, piggyBankMinUsd: 0 },
      env: { TOKEN_LOG_SEED_USD: "0.05" },
    });
    assert.equal(plan.blocked, false);
    assert.ok(plan.tokensToSell <= 1000 * DIVIDEND_CAP + 1e-6);
    assert.ok(plan.leaveTokens >= 1000 * 0.7 - 1);
    assert.ok(plan.withdrawUsd > 0);
  });

  it("exits on a lower base with a 10–30% slice, and withholds a red sell", () => {
    const ledger = bookWith([
      { symbol: "BRETT", side: "low", price: 1.1, at: 1, source: "live" },
      { symbol: "BRETT", side: "high", price: 1.3, at: 2, source: "live" },
      { symbol: "BRETT", side: "low", price: 1, at: 3, source: "live" },
      { symbol: "BRETT", side: "high", price: 1.15, at: 4, source: "live" },
    ]);
    const plus = assessWaveToken(ledger, { symbol: "BRETT", price: 1.08, entryPrice: 1.02 });
    assert.equal(plus.exitMode, "STRUCTURE");
    assert.ok(plus.dividendPct >= DIVIDEND_FLOOR && plus.dividendPct <= DIVIDEND_CAP);
    assert.match(plus.exitReason, /lower base/);
    const red = assessWaveToken(ledger, { symbol: "BRETT", price: 1.08, entryPrice: 1.5 });
    assert.equal(red.exitMode, "HOLD_RED");
    assert.equal(red.dividendPct, 0);
    const unknown = assessWaveToken(ledger, { symbol: "BRETT", price: 1.08, entryPrice: null });
    assert.equal(unknown.exitMode, "HOLD_BASIS");
    assert.equal(unknown.dividendPct, 0);
  });

  it("holds while highs and lows are still rising, and cascades into the trough", () => {
    const ledger = bookWith([
      { symbol: "AERO", side: "low", price: 1, at: 1, source: "live" },
      { symbol: "AERO", side: "high", price: 1.2, at: 2, source: "live" },
      { symbol: "AERO", side: "low", price: 1.1, at: 3, source: "live" },
      { symbol: "AERO", side: "high", price: 1.4, at: 4, source: "live" },
      { symbol: "VIRTUAL", side: "low", price: 1, at: 1, source: "live" },
      { symbol: "VIRTUAL", side: "high", price: 1.2, at: 2, source: "live" },
      { symbol: "VIRTUAL", side: "low", price: 0.9, at: 3, source: "live" },
    ]);
    const ride = assessWaveToken(ledger, { symbol: "AERO", price: 1.25, entryPrice: 1.05 });
    assert.equal(ride.exitMode, "HOLD");
    assert.equal(ride.dividendPct, 0);
    const trough = assessWaveToken(ledger, { symbol: "VIRTUAL", price: 0.92, entryPrice: null });
    assert.equal(trough.arrow, "↑");
    assert.equal(trough.stage, "TROUGH");
    assert.ok(trough.cascadeScore > 0);
    const picked = pickCascadeToken([ride, trough], { excludeSymbol: "AERO" });
    assert.equal(picked.symbol, "VIRTUAL");
    const board = formatWaveBoardTelegram(
      [{ ...trough, plan: { blocked: true } }, { ...ride, plan: { blocked: true } }],
      { cascade: picked, now: new Date("2026-09-24T01:22:00Z") },
    );
    assert.match(board, /VIRTUAL/);
    assert.match(board, /↑/);
    assert.match(board, /%/);
    assert.match(board, /Cascade into/);
  });
});

describe("short WHL machine ride", () => {
  it("stamps utc|local|unix and round-trips highs, lows, and the exit", () => {
    const ledger = bookWith([
      { symbol: "AERO", side: "low", price: 1, at: 1, source: "live" },
      { symbol: "AERO", side: "high", price: 1.2, at: 2, source: "live" },
      { symbol: "AERO", side: "low", price: 1.05, at: 3, source: "live" },
      { symbol: "AERO", side: "high", price: 1.34, at: 4, source: "live" },
    ]);
    const row = assessWaveToken(ledger, { symbol: "AERO", price: 1.34, entryPrice: 1 });
    const at = Date.parse("2026-09-24T01:22:00.000Z");
    const built = buildWaveHlMachine(row, {
      at,
      prev: "abcdef01",
      cascadeSymbol: "VIRTUAL",
    });
    assert.ok(built.bytes <= 360);
    assert.ok(built.line.startsWith(WAVE_HL_MAGIC));
    assert.match(built.line, /\|utc=2026-09-24T01:22:00.000Z\|/);
    assert.match(built.line, /\|local=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}\|/);
    assert.match(built.line, new RegExp(`\\|unix=${Math.floor(at / 1000)}\\|`));
    assert.match(built.line, /\|loc=-\|/);
    const parsed = parseWaveHlMachine(built.line);
    assert.equal(parsed.symbol, "AERO");
    assert.equal(parsed.utc, "2026-09-24T01:22:00.000Z");
    assert.equal(parsed.unix, Math.floor(at / 1000));
    assert.ok(parsed.local);
    assert.deepEqual(parsed.highs, [1.2, 1.34]);
    assert.deepEqual(parsed.lows, [1, 1.05]);
    assert.equal(parsed.cascadeSymbol, "VIRTUAL");
    assert.equal(parsed.loc, null);
    assert.equal(parsed.arrow, row.arrow);
    const hex = "0x" + Buffer.from("swap-prefix" + built.line, "utf8").toString("hex");
    const fromChain = readWaveHlFromHex(hex);
    assert.equal(fromChain.length, 1);
    assert.equal(fromChain[0].symbol, "AERO");
    assert.equal(extractWaveHlMachines(built.line).length, 1);
  });

  it("rides only when leftover covers, and never solo-sends", () => {
    const covered = planWaveHlRide({
      leftoverEth: 0.002,
      hitchCostEth: 0.0004,
      pairedPlus: true,
      machine: "§WHL§v1|utc=x",
    });
    assert.equal(covered.hitch, true);
    assert.equal(covered.send, false);
    assert.equal(covered.txHash, null);
    const banked = planWaveHlRide({
      leftoverEth: 0.0001,
      hitchCostEth: 0.0004,
      pairedPlus: true,
      machine: "§WHL§v1|utc=x",
    });
    assert.equal(banked.hitch, false);
    assert.equal(banked.banked, true);
    assert.equal(banked.send, false);
  });
});
