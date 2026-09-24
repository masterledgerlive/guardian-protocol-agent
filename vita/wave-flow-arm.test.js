import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  FLOW_LABEL,
  FLOW_MAGIC,
  FLOW_OWNER,
  buildFlowRouteLine,
  commitFlowRouteHash,
  createFlowBook,
  dropPair,
  flowRouteIdm,
  formatFlowBoard,
  ingestSourceQuotes,
  loadFlowBook,
  planFlowRouteRide,
  quoteFromRhResult,
  readQuoteWave,
  saveFlowBook,
  watchPair,
} from "./wave-flow-arm.js";

describe("flow arm quotes and waves", () => {
  it("files a real mark and refuses a blank price", () => {
    const book = createFlowBook();
    const bad = quoteFromRhResult({ symbol: "ETHUSD", mark_price: "0", open_price: "1" });
    assert.equal(bad, null);
    const filed = ingestSourceQuotes(book, "robinhood", [
      { symbol: "ETHUSD", mark_price: "2675.25", bid_price: "2649.96", ask_price: "2700.53", open_price: "2773.92", updated_at: "2026-09-23T22:02:40.2-04:00" },
      { symbol: "NOPEUSD", mark_price: "1", open_price: "1" },
    ], { at: Date.parse("2026-09-24T02:02:00.000Z") });
    assert.equal(filed.ok, true);
    assert.equal(filed.filed, 1);
    const q = book.snapshots[0].quotes[0];
    assert.equal(q.pair, "ETH-USD");
    assert.ok(q.bookSymbols.includes("WETH"));
    const unknown = ingestSourceQuotes(book, "somewhere", [{ symbol: "ETHUSD", mark_price: "1" }]);
    assert.equal(unknown.ok, false);
  });

  it("shows a big wave's crash leg and leaves the sell to the Base book", () => {
    const crash = readQuoteWave({ mark: 8.5, prevClose: 10, bid: 8.4, ask: 8.6 });
    assert.equal(crash.crashSeen, true);
    assert.equal(crash.large, true);
    assert.equal(crash.executes, false);
    assert.equal(crash.glyph, "▇▆▅▄▃▂▁·");
    assert.match(crash.advice, /10–30%/);
    const rise = readQuoteWave({ mark: 12, prevClose: 10, bid: 11.9, ask: 12.1 });
    assert.equal(rise.crashSeen, false);
    assert.equal(rise.large, true);
    assert.ok(Math.abs(rise.crashAt - 9.6) < 1e-9);
    assert.equal(rise.executes, false);
    const noise = readQuoteWave({ mark: 100.4, prevClose: 100, bid: 98, ask: 103 });
    assert.equal(noise.counter, true);
    assert.match(noise.advice, /second-scale/);
  });

  it("authors our route, keeps loc empty, and seals only a real hash", () => {
    const book = createFlowBook({ watch: ["UNI-USD", "USDC-USD"] });
    ingestSourceQuotes(book, "robinhood", [
      { symbol: "UNIUSD", mark_price: "9.357", bid_price: "9.27", ask_price: "9.45", open_price: "10.709" },
      { symbol: "USDCUSD", mark_price: "1", bid_price: "1", ask_price: "1", open_price: "1" },
    ]);
    const built = buildFlowRouteLine(book, { at: Date.parse("2026-09-24T02:02:00.000Z") });
    assert.ok(built.line.startsWith(FLOW_MAGIC));
    assert.match(built.line, new RegExp(`label=${FLOW_LABEL}`));
    assert.match(built.line, new RegExp(`owner=${FLOW_OWNER}`));
    assert.match(built.line, /loc=-/);
    assert.equal(built.line.includes("http"), false);
    assert.equal(planFlowRouteRide({ leftoverEth: 0, hitchCostEth: 0.01, machine: built.line }).send, false);
    assert.equal(planFlowRouteRide({ leftoverEth: 0, hitchCostEth: 0.01, machine: built.line }).hitch, false);
    const idm = flowRouteIdm(book);
    assert.match(idm.text, /Our injection/);
    assert.equal(idm.sealed.length, 0);
    assert.equal(commitFlowRouteHash(book, { line: built.line, txHash: "0xdead" }), false);
    book.routes.push({ line: built.line, at: built.stamp.utc, txHash: null });
    const hash = "0x" + "ab".repeat(32);
    assert.equal(commitFlowRouteHash(book, { line: built.line, txHash: hash }), true);
    assert.equal(flowRouteIdm(book).sealed[0], hash);
    const card = formatFlowBoard(book);
    assert.match(card, /UNI-USD/);
    assert.match(card, /owner vita/);
  });

  it("picks and drops watch pairs and round-trips the book", () => {
    const cwd = mkdtempSync(join(tmpdir(), "flow-"));
    const book = createFlowBook({ watch: ["ETH-USD"] });
    assert.equal(watchPair(book, "LINK").pair, "LINK-USD");
    assert.equal(dropPair(book, "ETH-USD").ok, true);
    assert.deepEqual(book.watch, ["LINK-USD"]);
    saveFlowBook(book, { cwd });
    const loaded = loadFlowBook({ cwd });
    assert.deepEqual(loaded.watch, ["LINK-USD"]);
  });
});
