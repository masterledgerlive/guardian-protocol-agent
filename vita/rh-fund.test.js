import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  RH_FUND_USD,
  RH_DEST_USD,
  RH_DEST_SYMBOLS,
  RH_CHOSEN_SOURCES,
  planRhFund,
  parseRhFundCommand,
  handleRhFundAction,
  assertRhFundCallbacksFit,
  rhSourceOf,
  formatRhFundRootCard,
  formatRhFundPlanCard,
} from "./rh-fund.js";

describe("rh-fund plan", () => {
  it("splits $2 CHIP into $1 HOME + $1 AERO on Base", () => {
    const plan = planRhFund({ source: "CHIP" });
    assert.equal(plan.ok, true);
    assert.equal(plan.source.symbol, "CHIP");
    assert.equal(plan.sellUsd, RH_FUND_USD);
    assert.equal(plan.destinations.length, 2);
    assert.deepEqual(
      plan.destinations.map((d) => d.symbol),
      [...RH_DEST_SYMBOLS],
    );
    assert.equal(plan.destinations[0].usd, RH_DEST_USD);
    assert.equal(plan.destinations[1].telegramBuy, "/buy AERO 1");
    assert.match(plan.rhNote, /cannot withdraw/i);
  });

  it("lists CHIP plus Robinhood mirror sameToken sources", () => {
    assert.ok(RH_CHOSEN_SOURCES.some((s) => s.symbol === "CHIP"));
    assert.ok(RH_CHOSEN_SOURCES.some((s) => s.symbol === "AERO"));
    assert.ok(rhSourceOf("aero"));
    assert.equal(rhSourceOf("HOME"), null);
  });
});

describe("rh-fund parse + handle", () => {
  it("parses /rh · /rh fund CHIP · /rh confirm CHIP", () => {
    assert.equal(parseRhFundCommand("/rh").action, "root");
    assert.equal(parseRhFundCommand("/rh fund CHIP").action, "fund");
    assert.equal(parseRhFundCommand("/rh fund CHIP").source, "CHIP");
    assert.equal(parseRhFundCommand("/rh confirm CHIP").action, "confirm");
    assert.equal(parseRhFundCommand("/rh CHIP").action, "fund");
    assert.equal(parseRhFundCommand("/rh CHIP").source, "CHIP");
  });

  it("root keyboard has source buttons under callback cap", () => {
    const fit = assertRhFundCallbacksFit();
    assert.equal(fit.ok, true, JSON.stringify(fit.bad));
    const out = handleRhFundAction({ action: "root" });
    assert.match(out.reply, /RH → Base fund/);
    const flat = out.keyboard.inline_keyboard.flat().map((b) => b.callback_data);
    assert.ok(flat.includes("/rh fund CHIP"));
    assert.ok(flat.includes("/rh fund AERO"));
  });

  it("confirm queues Base buys and files ledger", () => {
    const out = handleRhFundAction({ action: "confirm", source: "CHIP" });
    assert.equal(out.ok, true);
    assert.deepEqual(out.queueBuys, [
      { symbol: "HOME", action: "buy", usd: 1, source: "RH_FUND" },
      { symbol: "AERO", action: "buy", usd: 1, source: "RH_FUND" },
    ]);
    assert.match(out.reply, /Base buys queued/);
    assert.ok(existsSync(join("vita", "memory", "rh-fund-ledger.json")));
    assert.ok(existsSync(join("vita", "strands", "rh-fund.json")));
  });

  it("fund card names destinations", () => {
    const plan = planRhFund({ source: "STRK" });
    // STRK not in chosen list → ad-hoc still plans
    assert.equal(plan.ok, true);
    assert.match(formatRhFundPlanCard(plan), /\$1\.00 HOME/);
    assert.match(formatRhFundRootCard(), /\$2/);
  });
});
