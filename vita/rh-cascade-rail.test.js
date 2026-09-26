/**
 * Robinhood data → Base cascade rail.
 * Mother brain untouched. Never invent hashes.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  RH_CASCADE_RAIL_ID,
  RH_CASCADE_MAGIC,
  AERO_CASCADE_INOUT,
  unlockSellBarrier,
  seatsFromRhQuotes,
  nextCascadeOutcomes,
  buildCascadeTrailLine,
  planRhBaseCascade,
  formatRhCascadeCard,
  formatRhCascadeOutcomes,
  parseRhCascadeCommand,
  commitCascadeTrailHash,
} from "./rh-cascade-rail.js";
import { HOLD_ALL_SELLS_ENV, isHoldAllSells, shouldBlockSell } from "../operator-sell-hold.js";
import { createFlowBook } from "./wave-flow-arm.js";

const HERE = dirname(fileURLToPath(import.meta.url));

const RH_SAMPLE = [
  { symbol: "AEROUSD", mark_price: "0.8965", bid_price: "0.887", ask_price: "0.906", open_price: "0.8833", updated_at: "2026-09-26T00:14:53-04:00" },
  { symbol: "VIRTUALUSD", mark_price: "0.7789", bid_price: "0.771", ask_price: "0.787", open_price: "0.7757" },
  { symbol: "CLANKERUSD", mark_price: "13.55", bid_price: "13.55", ask_price: "13.55", open_price: "13.45" },
  { symbol: "BRETTUSD", mark_price: "0.00571", bid_price: "0.00571", ask_price: "0.00571", open_price: "0.00568" },
  { symbol: "TOSHIUSD", mark_price: "0.0001298", bid_price: "0.0001298", ask_price: "0.0001298", open_price: "0.0001290" },
  { symbol: "LINKUSD", mark_price: "14.10", bid_price: "13.96", ask_price: "14.24", open_price: "14.03" },
  { symbol: "UNIUSD", mark_price: "9.63", bid_price: "9.53", ask_price: "9.72", open_price: "9.55" },
  { symbol: "AAVEUSD", mark_price: "154.33", bid_price: "152.8", ask_price: "155.8", open_price: "154.59" },
  { symbol: "ETHUSD", mark_price: "2688.83", bid_price: "2663", ask_price: "2714", open_price: "2687.73" },
  { symbol: "MORPHOUSD", mark_price: "2.715", bid_price: "2.687", ask_price: "2.744", open_price: "2.708" },
  { symbol: "ZORAUSD", mark_price: "0.00902", bid_price: "0.00892", ask_price: "0.00911", open_price: "0.00896" },
  { symbol: "AIXBTUSD", mark_price: "0.02398", bid_price: "0.02398", ask_price: "0.02398", open_price: "0.02377" },
  { symbol: "KEYCATUSD", mark_price: "0.000720", bid_price: "0.000720", ask_price: "0.000720", open_price: "0.000718" },
  { symbol: "VVVUSD", mark_price: "30.21", bid_price: "29.91", ask_price: "30.51", open_price: "30.21" },
  { symbol: "DOGINMEUSD", mark_price: "0.0000826", bid_price: "0.0000826", ask_price: "0.0000826", open_price: "0.0000820" },
];

describe("rh-cascade-rail — RH data, Base rail", () => {
  it("unlocks HOLD_ALL_SELLS while HOME stays never-sell", () => {
    const env = { [HOLD_ALL_SELLS_ENV]: "yes" };
    assert.equal(isHoldAllSells(env), true);
    const out = unlockSellBarrier(env);
    assert.equal(out.ok, true);
    assert.equal(isHoldAllSells(env), false);
    assert.equal(out.homeNeverSell, true);
    const home = shouldBlockSell({ symbol: "HOME", env });
    assert.equal(home.block, true);
    assert.equal(home.code, "HOLD_HOME");
    const aero = shouldBlockSell({ symbol: "AERO", env });
    assert.equal(aero.block, false);
  });

  it("auto-populates seats from Robinhood quotes with AERO main in/out", () => {
    const seats = seatsFromRhQuotes(RH_SAMPLE);
    assert.ok(seats.length >= 8);
    const aero = seats.find((s) => s.symbol === "AERO");
    assert.ok(aero);
    assert.equal(aero.aeroMain, true);
    assert.equal(aero.role, AERO_CASCADE_INOUT.role);
    assert.equal(aero.dataSource, "robinhood");
    assert.equal(aero.rail, "base");
    assert.ok(aero.price > 0);
    assert.ok(aero.minTrough > 0 && aero.maxPeak > aero.minTrough);
    assert.equal(seats.every((s) => s.rhPair), true);
  });

  it("plans RH→Base cascade with trail loc empty (never invent)", () => {
    const env = { [HOLD_ALL_SELLS_ENV]: "yes" };
    const book = createFlowBook();
    const plan = planRhBaseCascade({
      rhRows: RH_SAMPLE,
      flowBook: book,
      unlockSells: true,
      env,
      maxHops: 8,
      at: Date.parse("2026-09-26T04:15:00.000Z"),
    });
    assert.equal(plan.id, RH_CASCADE_RAIL_ID);
    assert.equal(plan.dataSource, "robinhood");
    assert.equal(plan.rail, "base");
    assert.equal(plan.unlock.ok, true);
    assert.equal(plan.neverSellHome, true);
    assert.equal(plan.hubs.aero.symbol, "AERO");
    assert.ok(plan.seatCount >= 8);
    assert.ok(plan.cascade.hopCount >= 8);
    assert.ok(plan.trail.line.startsWith(RH_CASCADE_MAGIC));
    assert.match(plan.trail.line, /loc=-/);
    assert.match(plan.trail.line, /hubs=HOME,AERO/);
    assert.equal(plan.trail.txHash, null);
    assert.equal(plan.neverInventHashes, true);
    const aeroHop = plan.cascade.hops.find((h) => h.symbol === "AERO");
    assert.ok(aeroHop);
    assert.equal(aeroHop.aeroMain, true);
    assert.match(aeroHop.action, /cascade-aero-/);
    assert.ok(book.snapshots.length >= 1);
    assert.match(formatRhCascadeCard(plan), /RH → BASE CASCADE/);
    assert.match(formatRhCascadeOutcomes(plan), /NEXT CASCADE OUTCOMES/);
  });

  it("next outcomes separate enter vs exit lanes", () => {
    const seats = seatsFromRhQuotes([
      { symbol: "AEROUSD", mark_price: "0.90", open_price: "1.10" }, // crash → enter bias
      { symbol: "VIRTUALUSD", mark_price: "1.20", open_price: "1.00" }, // rise near high
    ]);
    const out = nextCascadeOutcomes(seats);
    assert.ok(out.enter.length + out.exit.length + out.hold.length >= 2);
    const aero = [...out.enter, ...out.exit, ...out.hold].find((r) => r.symbol === "AERO");
    assert.ok(aero?.aeroMain);
  });

  it("trail seals only a real 0x+64 hash", async () => {
    const { fileCascadeTrail } = await import("./rh-cascade-rail.js");
    const seats = seatsFromRhQuotes(RH_SAMPLE.slice(0, 4));
    const built = buildCascadeTrailLine({ seats, at: Date.parse("2026-09-26T04:15:00.000Z") });
    assert.equal(commitCascadeTrailHash({ line: built.line, txHash: "0xdead" }).ok, false);
    const filed = fileCascadeTrail(built, { seats });
    assert.equal(filed.ok, true);
    const hash = "0x" + "ab".repeat(32);
    const sealed = commitCascadeTrailHash({ line: built.line, txHash: hash });
    assert.equal(sealed.ok, true);
    assert.equal(sealed.txHash, hash);
  });

  it("parseRhCascadeCommand covers board/outcomes/trail/unlock", () => {
    assert.equal(parseRhCascadeCommand("/cascade").action, "board");
    assert.equal(parseRhCascadeCommand("/cascade outcomes").action, "outcomes");
    assert.equal(parseRhCascadeCommand("/cascade trail").action, "trail");
    assert.equal(parseRhCascadeCommand("/cascade unlock").action, "unlock");
    assert.equal(parseRhCascadeCommand("/nope").ok, false);
  });

  it("package.json and FILING list the module", () => {
    const pkg = readFileSync(join(HERE, "..", "package.json"), "utf8");
    assert.match(pkg, /vita\/rh-cascade-rail\.test\.js/);
    const filing = readFileSync(join(HERE, "FILING.md"), "utf8");
    assert.match(filing, /rh-cascade-rail\.js/);
  });
});
