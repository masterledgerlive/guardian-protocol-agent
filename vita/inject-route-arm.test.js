import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  INJECT_METHOD,
  applyRouteOrder,
  chooseInjectWire,
  contestFromHistory,
  fileRouteQuote,
  createInjectRouteBook,
  rankCascadeByDataRoute,
  rankInjectRoutes,
  unwrapInjectDataField,
} from "./inject-route-arm.js";

describe("inject route arm", () => {
  it("keeps a dense line as identity and round-trips a line that compresses", () => {
    const dense = "§RHD§v1|utc=2026-09-24T02:02:40.000Z|n=17|loc=-|next=END";
    const plain = chooseInjectWire(dense);
    assert.equal(plain.codec, "identity-v1");
    assert.equal(plain.method, INJECT_METHOD);
    assert.equal(plain.wire, dense);
    const fat = "wave ".repeat(400);
    const packed = chooseInjectWire(fat);
    assert.notEqual(packed.codec, "identity-v1");
    assert.ok(packed.wireBytes < Buffer.byteLength(fat, "utf8"));
    assert.equal(unwrapInjectDataField(packed.wire), fat);
    assert.equal(unwrapInjectDataField("prefix " + packed.wire + " tail").includes("wave wave"), true);
  });

  it("files a quoted chain and refuses a seat with no chain id", () => {
    const book = createInjectRouteBook();
    assert.equal(fileRouteQuote(book, { chain: "robinhood", gwei: 1 }).ok, false);
    assert.equal(fileRouteQuote(book, { chain: "base", gwei: 0 }).ok, false);
    assert.equal(fileRouteQuote(book, { chain: "base", gwei: 0.04, inclusionMs: 2000 }).ok, true);
    assert.equal(fileRouteQuote(book, { chain: "arbitrum", gwei: 0.01, inclusionMs: 250 }).ok, true);
    const wireBytes = 200;
    const routes = rankInjectRoutes({
      wireBytes,
      quotes: book.quotes,
      history: book.quotes,
    });
    assert.equal(routes.executes, false);
    assert.equal(routes.method, INJECT_METHOD);
    assert.equal(routes.winner.chain, "arbitrum");
    assert.equal(routes.ranked[0].inclusionMs, 250);
  });

  it("moves the cascade seat only when its chain is cheaper", () => {
    const seats = [
      { symbol: "AERO", score: 40, chain: "base" },
      { symbol: "LINK", score: 10, chain: "arbitrum" },
    ];
    const same = rankCascadeByDataRoute(seats, {
      wireBytes: 180,
      quotes: [{ chain: "base", gwei: 0.05 }],
    });
    const unchanged = applyRouteOrder(
      [{ symbol: "AERO" }, { symbol: "LINK" }],
      same.rows,
    );
    assert.deepEqual(unchanged.map((c) => c.symbol), ["AERO", "LINK"]);
    const split = rankCascadeByDataRoute(seats, {
      wireBytes: 180,
      quotes: [
        { chain: "base", gwei: 1 },
        { chain: "arbitrum", gwei: 0.01, inclusionMs: 300 },
      ],
    });
    const ordered = applyRouteOrder(
      [{ symbol: "AERO" }, { symbol: "LINK" }],
      split.rows,
    );
    assert.deepEqual(ordered.map((c) => c.symbol), ["LINK", "AERO"]);
    assert.equal(split.executes, false);
    assert.equal(contestFromHistory([0.02, 0.02, 0.02, 0.02], 0.08) > 2, true);
    assert.equal(contestFromHistory([0.02], 0.08), 1);
  });
});
