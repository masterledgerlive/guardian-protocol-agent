import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildRaceScoreboard,
  formatRaceScoreboardHtml,
  pickRaceWinner,
  raceEveryCycles,
  raceReportMs,
  shouldSendRaceReport,
  summarizeRaceSide,
  tokenRaceRows,
  persistV4RaceSnapshot,
  emptyV4RaceState,
  DEFAULT_RACE_REPORT_MS,
  DEFAULT_RACE_EVERY_CYCLES,
  RACE_HEADER,
} from "../../race-scoreboard.js";
import { buildTurnRecord } from "../../telegram-turn-card.js";

const v3Agent = readFileSync(new URL("../../agent.js", import.meta.url), "utf8");
const v4Agent = readFileSync(new URL("../agent.js", import.meta.url), "utf8");

function sellTurn(symbol, { fifoEthIn, fifoEthOut, leftoverEth, usdMark, hitchSkipped, hitchBankedEth, hitchOnChain, hitchBytes } = {}) {
  return buildTurnRecord({
    side: "SELL",
    symbol,
    txHash: "0x94faa542b54eb06804bfde79354701cd0a7fa4964cf230791bfd07fc10a22b25",
    fifoKnown: true,
    fifoEthIn,
    fifoEthOut,
    leftoverEth,
    usdMark,
    hitchSkipped,
    hitchBankedEth,
    hitchOnChain,
    hitchBytes,
  });
}

describe("V3 vs V4 race scoreboard — formatting, no invented P&L", () => {
  it("zeros / missing snapshots stay unknown — not invented revenue", () => {
    const v3 = summarizeRaceSide({ tag: "[V3]", available: true, turns: [] });
    const v4 = summarizeRaceSide({ tag: "[V4]", available: true, dryRun: true, cycles: 0, turns: [] });
    assert.equal(v3.closedKnown, false);
    assert.equal(v3.closedDeltaEth, null);
    assert.equal(v4.dryRun, true);
    const html = formatRaceScoreboardHtml({ v3, v4 });
    assert.match(html, new RegExp(RACE_HEADER));
    assert.match(html, /\[V3\]/);
    assert.match(html, /\[V4\]/);
    assert.match(html, /dry-run yes — liquid unknown \(not invented\)/);
    assert.match(html, /closed-leg — unknown \(not invented\)/);
    assert.match(html, /TIE \/ insufficient data/);
    assert.doesNotMatch(html, /micro P&L|Grok|invented profit/i);
    assert.equal(pickRaceWinner(v3, v4).winner, "TIE");
  });

  it("real closed-leg FIFO only — USD only when stored, no fake hashes in table", () => {
    const v3 = summarizeRaceSide({
      tag: "[V3]",
      available: true,
      liquidEth: 0.002,
      liquidWeth: 0.001,
      turns: [
        sellTurn("AERO", { fifoEthIn: 0.01, fifoEthOut: 0.012, leftoverEth: 0.002, usdMark: 4.2, hitchOnChain: true, hitchBytes: 69 }),
        sellTurn("DRB", { fifoEthIn: 0.01, fifoEthOut: 0.0102, leftoverEth: 0.0002, hitchSkipped: true, hitchBankedEth: 0.000004 }),
        buildTurnRecord({
          side: "SELL",
          symbol: "BNKR",
          txHash: "0xeef39d62453fd9b09708a5661bd8465d5f2d82cebd0986d01e466f9ac95822e4",
          fifoKnown: false,
          fifoEthOut: 0.01,
          leftoverEth: 0.01,
          usdMark: 99,
        }),
      ],
    });
    const v4 = summarizeRaceSide({
      tag: "[V4]",
      available: true,
      dryRun: true,
      cycles: 8,
      hitchPlanned: 8,
      hitchBankedEth: 0,
      turns: [],
    });
    assert.equal(v3.closedCount, 2);
    assert.ok(Math.abs(v3.closedDeltaEth - 0.0022) < 1e-12);
    assert.equal(v3.usdMark, 4.2);
    assert.equal(v3.bestToken.symbol, "AERO");
    assert.equal(v3.tokens.find((r) => r.symbol === "BNKR").closedDeltaEth, null);
    const html = formatRaceScoreboardHtml({ v3, v4 });
    assert.match(html, /\[V3\] liquid 0\.002000 ETH \+ 0\.001000 WETH/);
    assert.match(html, /\[V3\] closed-leg \+0\.002200 ETH · \+\$4\.20/);
    assert.match(html, /\[V3\] AERO 1 fills · closed \+0\.002000 ETH · hitch sent 1/);
    assert.match(html, /\[V3\] DRB 1 fills · closed \+2\.00e-4 ETH · hitch sent 0 \/ banked 4\.00e-6/);
    assert.match(html, /\[V3\] BNKR 1 fills · closed —/);
    assert.match(html, /\[V3\] best AERO/);
    assert.match(html, /\[V4\] dry-run yes/);
    assert.match(html, /\[V4\] 8 cycles · 0 closed-leg/);
    assert.match(html, /\[V4\] hitch planned 8/);
    assert.match(html, /\[V3\] ahead on real closed-leg plus \(V4 no closed-leg yet\)/);
    assert.doesNotMatch(html, /\$99/);
    assert.doesNotMatch(html, /0xeef39d62/);
  });

  it("compares both sides when each has known closed-leg plus", () => {
    const v3 = summarizeRaceSide({
      tag: "[V3]",
      available: true,
      turns: [sellTurn("AERO", { fifoEthIn: 0.01, fifoEthOut: 0.011, leftoverEth: 0.001 })],
    });
    const v4 = summarizeRaceSide({
      tag: "[V4]",
      available: true,
      dryRun: false,
      cycles: 3,
      liquidEth: 0.004,
      liquidWeth: 0,
      turns: [sellTurn("DOT", { fifoEthIn: 0.01, fifoEthOut: 0.013, leftoverEth: 0.003 })],
    });
    assert.equal(pickRaceWinner(v3, v4).winner, "V4");
    const html = formatRaceScoreboardHtml({ v3, v4 });
    assert.match(html, /\[V4\] ahead on real closed-leg plus/);
    assert.match(html, /\[V4\] best DOT/);
    assert.match(html, /\[V4\] liquid 0\.004000 ETH \+ 0 WETH/);
  });

  it("token rows ignore unknown FIFO — never lists proceeds as a win", () => {
    const rows = tokenRaceRows([
      buildTurnRecord({ side: "BUY", symbol: "DOT", txHash: "0x11", fifoKnown: true, fifoEthIn: 0.001 }),
      buildTurnRecord({ side: "SELL", symbol: "DOT", txHash: "0x22", fifoKnown: false, fifoEthOut: 0.002 }),
    ]);
    assert.equal(rows[0].fills, 2);
    assert.equal(rows[0].closedCount, 0);
    assert.equal(rows[0].closedDeltaEth, null);
  });
});

describe("race cadence + file snapshots", () => {
  it("defaults GUARDIAN_RACE_REPORT_MS / every-N cycles", () => {
    assert.equal(raceReportMs({}), DEFAULT_RACE_REPORT_MS);
    assert.equal(raceEveryCycles({}), DEFAULT_RACE_EVERY_CYCLES);
    assert.equal(raceReportMs({ GUARDIAN_RACE_REPORT_MS: "120000" }), 120000);
    assert.equal(raceEveryCycles({ GUARDIAN_RACE_EVERY_CYCLES: "4" }), 4);
  });

  it("shouldSendRaceReport is due on first cycle or after ms / N cycles", () => {
    const dir = mkdtempSync(join(tmpdir(), "race-sent-"));
    const sentPath = join(dir, "race-last-sent.json");
    try {
      assert.equal(shouldSendRaceReport({ now: 1000, cycles: 0, sentPath, env: {} }), false);
      assert.equal(shouldSendRaceReport({ now: 1000, cycles: 1, sentPath, env: {} }), true);
      writeFileSync(sentPath, JSON.stringify({ at: 1000, cycle: 1 }));
      assert.equal(shouldSendRaceReport({
        now: 1000 + DEFAULT_RACE_REPORT_MS - 1,
        cycles: 2,
        sentPath,
        env: { GUARDIAN_RACE_EVERY_CYCLES: "10" },
      }), false);
      assert.equal(shouldSendRaceReport({
        now: 1000 + DEFAULT_RACE_REPORT_MS,
        cycles: 2,
        sentPath,
        env: { GUARDIAN_RACE_EVERY_CYCLES: "10" },
      }), true);
      assert.equal(shouldSendRaceReport({
        now: 1500,
        cycles: 11,
        sentPath,
        env: { GUARDIAN_RACE_REPORT_MS: "999999999", GUARDIAN_RACE_EVERY_CYCLES: "10" },
      }), true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("buildRaceScoreboard reads V3 turn-recall + V4 race.json without inventing", () => {
    const dir = mkdtempSync(join(tmpdir(), "race-files-"));
    const recall = join(dir, "turn-recall.json");
    const race = join(dir, "race.json");
    try {
      writeFileSync(recall, JSON.stringify({
        turns: [sellTurn("AERO", { fifoEthIn: 0.01, fifoEthOut: 0.012, leftoverEth: 0.002, usdMark: 1.5 })],
        fills: 1,
        hitchEvents: 0,
        hitchSkipped: 0,
        hitchBytes: 0,
        hitchCostEth: 0,
        hitchBankedEth: 0,
        updatedAt: 1,
      }));
      persistV4RaceSnapshot({
        ...emptyV4RaceState(),
        dryRun: true,
        cycles: 3,
        hitchPlanned: 3,
      }, { racePath: race });
      const board = buildRaceScoreboard({ turnRecallPath: recall, racePath: race });
      assert.equal(board.v3.closedKnown, true);
      assert.equal(board.v4.dryRun, true);
      assert.equal(board.winner, "V3");
      assert.match(board.html, /V3 vs V4 RACE/);
      assert.match(board.html, /\[V4\] dry-run yes/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("race wiring does not enter V3 buy/sell", () => {
  it("V3 executeBuy / executeSell stay free of the race card", () => {
    const buyFn = v3Agent.indexOf("async function executeBuy(");
    const buyEnd = v3Agent.indexOf("\nasync function ", buyFn + 1);
    const buy = v3Agent.slice(buyFn, buyEnd > 0 ? buyEnd : buyFn + 9000);
    const sellFn = v3Agent.indexOf("async function executeSell(");
    const sellEnd = v3Agent.indexOf("\nasync function ", sellFn + 1);
    const sell = v3Agent.slice(sellFn, sellEnd > 0 ? sellEnd : sellFn + 14000);
    assert.ok(!buy.includes("sendRaceScoreboardIfDue"), "buy path must not send the race card");
    assert.ok(!sell.includes("sendRaceScoreboardIfDue"), "sell path must not send the race card");
    const report = v3Agent.indexOf("⏰ 10 MIN REPORT");
    const race = v3Agent.indexOf("sendRaceScoreboardIfDue", report);
    assert.ok(report >= 0 && race > report, "thrift 10-min report may send the race card");
    assert.doesNotMatch(v3Agent, /guardian-v4\/agent/, "still does not merge V4 agent");
  });

  it("V4 cycle persists snapshot and sends race without broadcast", () => {
    assert.ok(v4Agent.includes("persistV4RaceSnapshot"));
    assert.ok(v4Agent.includes("sendRaceScoreboardIfDue"));
    assert.ok(v4Agent.includes("prefix: false"), "race card is not double-tagged [V4]");
    assert.ok(!v4Agent.includes("sendTransaction"));
  });
});
