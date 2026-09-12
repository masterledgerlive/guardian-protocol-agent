import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  shortTxHash,
  formatEthAmt,
  hitchClassLabel,
  leftoverVsPlus,
  closedLegPnl,
  sleeveDistanceToPlus,
  usageUnitsFrom,
  formatUsageRecallLine,
  buildTurnRecord,
  recordTurnFill,
  resetTurnRecallStore,
  writeTurnRecallSync,
  readTurnRecallSync,
  parseBagOrRecallCommand,
  buildRecallPayload,
  formatTurnCardHtml,
  formatRecallHtml,
  DEFAULT_RECALL_N,
  RECALL_SLEEVES,
} from "./telegram-turn-card.js";
import { formatBuyReceiptHtml, formatSellReceiptHtml } from "./piggy-bank.js";

const body = readFileSync(new URL("./agent.js", import.meta.url), "utf8");
const piggySrc = readFileSync(new URL("./piggy-bank.js", import.meta.url), "utf8");

describe("turn card formatters — no invented P&L", () => {
  it("shortens a real tx hash", () => {
    assert.equal(
      shortTxHash("0x53a00788abcdef0123456789abcdef0123456789abcdef0123456789abcdef01"),
      "0x53a00788…",
    );
    assert.equal(shortTxHash(""), "");
  });

  it("labels KEY+LOC vs §$STORE§ only when hitch is present", () => {
    assert.equal(hitchClassLabel({ hitchBytes: 0, utf8: "" }), "");
    assert.equal(hitchClassLabel({
      hitchBytes: 69,
      utf8: "§$STORE§ §KEY§vita §LOC§n=24",
      kind: "vita",
    }), "KEY+LOC");
    assert.equal(hitchClassLabel({
      hitchBytes: 229,
      utf8: "§$STORE§ Eureka! VITA lives",
    }), "§$STORE§");
  });

  it("leftover vs PLUS is unknown when FIFO is unknown — never invents", () => {
    assert.equal(leftoverVsPlus({ leftoverEth: 0.001, fifoKnown: false }).verdict, "unknown");
    assert.equal(leftoverVsPlus({ leftoverEth: null, fifoKnown: true }).verdict, "unknown");
    const plus = leftoverVsPlus({ leftoverEth: 1e-6, fifoKnown: true });
    assert.equal(plus.verdict, "PLUS");
    assert.equal(plus.leftoverEth, 1e-6);
    const short = leftoverVsPlus({ leftoverEth: 0, fifoKnown: true });
    assert.equal(short.verdict, "SHORT");
    assert.equal(leftoverVsPlus({ leftoverEth: 1e-19, fifoKnown: true }).verdict, "SHORT");
  });

  it("closed-leg P&L only from SELL + known FIFO", () => {
    assert.equal(closedLegPnl({ side: "BUY", fifoEthIn: 0.01, fifoEthOut: 0, fifoKnown: true }).known, false);
    assert.equal(closedLegPnl({ side: "SELL", fifoEthIn: 0.01, fifoEthOut: 0.012, fifoKnown: false }).known, false);
    assert.equal(closedLegPnl({ side: "SELL", fifoEthIn: null, fifoEthOut: 0.01, fifoKnown: true }).known, false);
    const pnl = closedLegPnl({
      side: "SELL",
      fifoEthIn: 0.01,
      fifoEthOut: 0.012,
      usdMark: 4.2,
      fifoKnown: true,
    });
    assert.equal(pnl.known, true);
    assert.ok(Math.abs(pnl.fifoDeltaEth - 0.002) < 1e-12);
    assert.equal(pnl.usdMark, 4.2);
    const noUsd = closedLegPnl({
      side: "SELL",
      fifoEthIn: 0.01,
      fifoEthOut: 0.009,
      fifoKnown: true,
    });
    assert.equal(noUsd.usdMark, null);
    assert.ok(noUsd.fifoDeltaEth < 0);
  });

  it("distance-to-PLUS omits mark when not computed", () => {
    const unk = sleeveDistanceToPlus({ symbol: "DRB", fifoKnown: false, remainingFifoEth: 0.01 });
    assert.equal(unk.status, "fifo-unknown");
    assert.equal(unk.distanceEth, null);
    const nomark = sleeveDistanceToPlus({
      symbol: "AERO",
      fifoKnown: true,
      remainingFifoEth: 0.002,
    });
    assert.equal(nomark.status, "mark-unknown");
    assert.equal(nomark.remainingFifoEth, 0.002);
    const short = sleeveDistanceToPlus({
      symbol: "BNKR",
      fifoKnown: true,
      remainingFifoEth: 0.002,
      markProceedsEth: 0.001,
    });
    assert.equal(short.status, "short");
    assert.ok(Math.abs(short.distanceEth - 0.001) < 1e-12);
    const plus = sleeveDistanceToPlus({
      symbol: "AERO",
      fifoKnown: true,
      remainingFifoEth: 0.001,
      markProceedsEth: 0.0015,
    });
    assert.equal(plus.status, "plus");
  });

  it("usage units are fills + hitch events — no fake dollar Grok cost", () => {
    assert.deepEqual(usageUnitsFrom({ fills: 3, hitchEvents: 2 }), { fills: 3, hitchEvents: 2, units: 5 });
    const line = formatUsageRecallLine({ fills: 3, hitchEvents: 2, hitchBytes: 138 });
    assert.match(line, /3 fills · 2 hitch · 5 units toward piggy cover/);
    assert.match(line, /hitch spent: 138 B/);
    assert.doesNotMatch(line, /\$/);
    assert.doesNotMatch(line, /Grok/i);
    const withEth = formatUsageRecallLine({
      fills: 1,
      hitchEvents: 1,
      hitchBytes: 69,
      hitchCostEth: 0.000004,
    });
    assert.match(withEth, /69 B · /);
    assert.match(withEth, /ETH/);
    assert.doesNotMatch(withEth, /\$/);
  });

  it("buy turn card lists token, short tx, FIFO in, hitch, liquid — no P&L", () => {
    const card = buildTurnRecord({
      side: "BUY",
      symbol: "AERO",
      txHash: "0x94faa542b54eb06804bfde79354701cd0a7fa4964cf230791bfd07fc10a22b25",
      fifoKnown: true,
      fifoEthIn: 0.001234,
      hitchOnChain: true,
      hitchBytes: 69,
      hitchUtf8: "§$STORE§ §KEY§vita §LOC§n=1",
      hitchKind: "vita",
      hitchCostEth: 0.00001,
      liquidEth: 0.002,
      liquidWeth: 0.003,
    });
    const html = formatTurnCardHtml(card);
    assert.match(html, /TURN CARD — BUY AERO/);
    assert.match(html, /0x94faa542…/);
    assert.match(html, /FIFO in/);
    assert.match(html, /0\.001234 ETH/);
    assert.match(html, /hitch 69 B KEY\+LOC/);
    assert.match(html, /liquid 0\.002000 ETH \+ 0\.003000 WETH/);
    assert.doesNotMatch(html, /closed FIFO/);
    assert.doesNotMatch(html, /leftover/);
    assert.doesNotMatch(html, /P&L/);
  });

  it("sell turn card leftover vs PLUS + closed FIFO Δ only when known", () => {
    const card = buildTurnRecord({
      side: "SELL",
      symbol: "DRB",
      txHash: "0xe0f846a80fe8d5c541b500e51b9cf365866cd97eb5d84a47c674100fac7da6e9",
      fifoKnown: true,
      fifoEthIn: 0.01,
      fifoEthOut: 0.012,
      leftoverEth: 0.002,
      usdMark: 4.2,
      hitchOnChain: true,
      hitchBytes: 229,
      hitchUtf8: "§$STORE§ Eureka!",
      liquidEth: 0.004,
      liquidWeth: 0.001,
    });
    const html = formatTurnCardHtml(card);
    assert.match(html, /TURN CARD — SELL DRB/);
    assert.match(html, /FIFO out/);
    assert.match(html, /leftover .* vs PLUS · PLUS/);
    assert.match(html, /closed FIFO Δ \+/);
    assert.match(html, /\$4\.20/);
    assert.match(html, /§\$STORE§/);

    const unknown = formatTurnCardHtml(buildTurnRecord({
      side: "SELL",
      symbol: "BNKR",
      txHash: "0xeef39d62453fd9b09708a5661bd8465d5f2d82cebd0986d01e466f9ac95822e4",
      fifoKnown: false,
      fifoEthOut: 0.01,
      leftoverEth: 0.01,
      usdMark: 99,
    }));
    assert.match(unknown, /FIFO — unknown \(not invented\)/);
    assert.doesNotMatch(unknown, /closed FIFO/);
    assert.doesNotMatch(unknown, /\$99/);
    assert.doesNotMatch(unknown, /vs PLUS/);
  });
});

describe("existing receipts accept a turn card", () => {
  it("formatBuyReceiptHtml appends the card", () => {
    const html = formatBuyReceiptHtml({
      symbol: "AERO",
      tradeNum: 1,
      ethSpent: 0.001,
      spentUsd: 3,
      tokensReceived: 6,
      plan: { sellAtMin: 0.55, projectedEarningsUsd: 0.12, piggyAfterUsd: 0.27, priorSavedUsd: 0.15, dustUsd: 0.15, hitchNeedUsd: 0.1 },
      turnCard: buildTurnRecord({
        side: "BUY",
        symbol: "AERO",
        txHash: "0x94faa542b54eb06804bfde79354701cd0a7fa4964cf230791bfd07fc10a22b25",
        fifoKnown: true,
        fifoEthIn: 0.001,
      }),
    });
    assert.match(html, /RECEIPT — buy math/);
    assert.match(html, /TURN CARD — BUY AERO/);
    assert.match(html, /FIFO in/);
  });

  it("formatSellReceiptHtml appends leftover vs PLUS", () => {
    const html = formatSellReceiptHtml({
      symbol: "AERO",
      tradeNum: 2,
      receivedEth: 0.012,
      receivedUsd: 30,
      netUsd: 4,
      turnCard: buildTurnRecord({
        side: "SELL",
        symbol: "AERO",
        txHash: "0x94faa542b54eb06804bfde79354701cd0a7fa4964cf230791bfd07fc10a22b25",
        fifoKnown: true,
        fifoEthIn: 0.01,
        fifoEthOut: 0.012,
        leftoverEth: 0.002,
        usdMark: 4,
      }),
    });
    assert.match(html, /RECEIPT — bought → sold/);
    assert.match(html, /TURN CARD — SELL AERO/);
    assert.match(html, /leftover .* vs PLUS/);
  });
});

describe("recall payload + /bag /recall parse", () => {
  beforeEach(() => resetTurnRecallStore());

  it("parses /bag and bare /recall — leaves /recall topic to memory search", () => {
    assert.deepEqual(parseBagOrRecallCommand("/bag"), { kind: "bag", n: DEFAULT_RECALL_N, verb: "/bag" });
    assert.deepEqual(parseBagOrRecallCommand("/bag 5"), { kind: "bag", n: 5, verb: "/bag" });
    assert.deepEqual(parseBagOrRecallCommand("/recall"), { kind: "bag", n: DEFAULT_RECALL_N, verb: "/recall" });
    assert.deepEqual(parseBagOrRecallCommand("/recall 10"), { kind: "bag", n: 10, verb: "/recall" });
    assert.equal(parseBagOrRecallCommand("/recall vita"), null);
    assert.equal(parseBagOrRecallCommand("/recall session-notes"), null);
    assert.equal(parseBagOrRecallCommand("/memories"), null);
    assert.equal(parseBagOrRecallCommand("/bag 99").n, 20);
  });

  it("recall payload is last N real turns + sleeves + usage — no invented P&L", () => {
    recordTurnFill({
      side: "BUY",
      symbol: "AERO",
      txHash: "0x94faa542b54eb06804bfde79354701cd0a7fa4964cf230791bfd07fc10a22b25",
      fifoKnown: true,
      fifoEthIn: 0.003,
      hitchOnChain: true,
      hitchBytes: 69,
      hitchUtf8: "§$STORE§ §KEY§x §LOC§n=1",
      persist: false,
    }, { persist: false });
    recordTurnFill({
      side: "SELL",
      symbol: "AERO",
      txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      fifoKnown: true,
      fifoEthIn: 0.003,
      fifoEthOut: 0.0034,
      leftoverEth: 0.0004,
      usdMark: 1.1,
      persist: false,
    }, { persist: false });
    const payload = buildRecallPayload({
      n: 5,
      liquidEth: 0.002,
      liquidWeth: 0.001,
      sleeves: [
        sleeveDistanceToPlus({
          symbol: "AERO",
          fifoKnown: true,
          remainingFifoEth: 0.001,
          markProceedsEth: 0.0004,
        }),
        sleeveDistanceToPlus({ symbol: "DRB", fifoKnown: false }),
        sleeveDistanceToPlus({ symbol: "BNKR", fifoKnown: true, remainingFifoEth: 0.002 }),
      ],
    });
    assert.equal(payload.turns.length, 2);
    assert.equal(payload.usage.fills, 2);
    assert.equal(payload.usage.hitchEvents, 1);
    assert.equal(payload.usage.units, 3);
    assert.equal(payload.sleeves.length, 3);
    const html = formatRecallHtml(payload);
    assert.match(html, /BAG RECALL/);
    assert.match(html, /BUY <b>AERO<\/b>/);
    assert.match(html, /SELL <b>AERO<\/b>/);
    assert.match(html, /units toward piggy cover/);
    assert.match(html, /liquid 0\.002000 ETH \+ 0\.001000 WETH/);
    assert.match(html, /AERO:.*to PLUS/);
    assert.match(html, /DRB: FIFO unknown/);
    assert.match(html, /BNKR:.*mark unknown/);
    assert.doesNotMatch(html, /Grok/i);
    assert.deepEqual(RECALL_SLEEVES, ["AERO", "DRB", "BNKR"]);
  });

  it("persists fills + hitch events to disk without inventing dollars", () => {
    const dir = mkdtempSync(join(tmpdir(), "turn-recall-"));
    const file = join(dir, "turn-recall.json");
    try {
      recordTurnFill({
        side: "BUY",
        symbol: "BNKR",
        txHash: "0xeef39d62453fd9b09708a5661bd8465d5f2d82cebd0986d01e466f9ac95822e4",
        fifoKnown: true,
        fifoEthIn: 0.001,
        hitchOnChain: true,
        hitchBytes: 69,
        hitchCostEth: 0.000002,
      }, { persist: true, filePath: file });
      const loaded = readTurnRecallSync(file);
      assert.equal(loaded.fills, 1);
      assert.equal(loaded.hitchEvents, 1);
      assert.equal(loaded.hitchBytes, 69);
      assert.equal(loaded.turns[0].symbol, "BNKR");
      writeTurnRecallSync(file, loaded);
      assert.equal(readTurnRecallSync(file).fills, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("agent wires turn cards + /bag without weakening gates", () => {
  it("executeBuy / executeSell pass turnCard into existing receipts", () => {
    const buyFn = body.indexOf("async function executeBuy(");
    const buyEnd = body.indexOf("\nasync function ", buyFn + 1);
    const buy = body.slice(buyFn, buyEnd > 0 ? buyEnd : buyFn + 8000);
    assert.ok(buy.includes("formatBuyReceiptHtml"), "buy still uses existing receipt");
    assert.ok(buy.includes("turnCard"), "buy receipt upgraded with turn card");
    assert.ok(buy.includes("recordTurnFill"), "buy records a real fill turn");
    assert.ok(buy.includes("isSuccessfulBuyFill"), "turn card still after real fill");

    const sellFn = body.indexOf("async function executeSell(");
    const sellEnd = body.indexOf("\nasync function ", sellFn + 1);
    const sell = body.slice(sellFn, sellEnd > 0 ? sellEnd : sellFn + 14000);
    assert.ok(sell.includes("formatSellReceiptHtml"), "sell still uses existing receipt");
    assert.ok(sell.includes("turnCard"), "sell receipt upgraded with turn card");
    assert.ok(sell.includes("recordTurnFill"), "sell records a real fill turn");
    assert.ok(sell.includes("isSuccessfulSellFill"), "failed fills do not get a turn card");
    const failTg = sell.indexOf("SELL FAILED");
    const record = sell.indexOf("recordTurnFill");
    assert.ok(failTg >= 0 && record > failTg, "failed sell telegram is not a turn card");
  });

  it("Telegram /bag and bare /recall use the recall payload", () => {
    assert.ok(body.includes("parseBagOrRecallCommand"), "telegram parses /bag|/recall");
    assert.ok(body.includes("formatRecallHtml"), "telegram formats recall");
    assert.ok(body.includes('"/bag"') || body.includes("/bag —") || body.includes("/bag "), "help lists /bag");
    const recallTopic = body.indexOf('text.startsWith("/recall ")');
    const bagParse = body.indexOf("parseBagOrRecallCommand");
    assert.ok(bagParse >= 0 && recallTopic > bagParse, "bag/recall number handled before memory /recall topic");
  });

  it("does not invent P&L, merge V4, or weaken always-plus / add-on gate", () => {
    assert.ok(body.includes("ALWAYS_PLUS_EXIT") || body.includes("buildSellGateDecision"), "always-plus stays");
    assert.ok(body.includes("buildSellGateDecision"), "LOSE-ZERO sell gate stays");
    assert.doesNotMatch(body, /guardian-v4\/agent/, "does not merge V4 into live agent");
    if (body.includes("ALLOW_ADD_ON_FIFO_RED") || body.includes("evaluateAddOnFifoRedGate")) {
      assert.ok(body.includes("evaluateAddOnFifoRedGate"), "add-on FIFO-red gate stays if present");
    }
    assert.ok(piggySrc.includes("turnCard") && piggySrc.includes("formatTurnCardHtml"), "receipts extend, not replace");
    assert.equal(formatEthAmt(0), "0");
  });
});
