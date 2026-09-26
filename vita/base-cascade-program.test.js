/**
 * Base cascade program — original path; RH is wave data only.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BASE_CASCADE_PROGRAM_ID,
  CASCADE_MAIN_SYMBOLS,
  CASCADE_LOWER_SYMBOLS,
  CASCADE_DEFERRED_MAJORS,
  PHASES,
  cascadeTierOf,
  viableCascadeCapital,
  predictCascadeHops,
  planBaseCascadeProgram,
  formatBaseCascadeProgramCard,
  formatCascadePredictionCard,
  formatCascadeHierarchyCard,
  parseBaseCascadeCommand,
} from "./base-cascade-program.js";
import { INJECT_ALL_USD, CASCADE_SEED_USD } from "../cascade-rollover.js";

const HERE = dirname(fileURLToPath(import.meta.url));

const SEATS = [
  { symbol: "BRETT", price: 0.0057, minTrough: 0.005, maxPeak: 0.007, predictedUp: true },
  { symbol: "VIRTUAL", price: 0.77, minTrough: 0.70, maxPeak: 0.95, predictedUp: true },
  { symbol: "KEYCAT", price: 0.00072, minTrough: 0.0006, maxPeak: 0.001, predictedUp: true },
  { symbol: "AERO", price: 0.90, minTrough: 0.80, maxPeak: 1.1, predictedUp: true },
  { symbol: "LINK", price: 14.1, minTrough: 13, maxPeak: 16, predictedUp: true },
  { symbol: "UNI", price: 9.6, minTrough: 8.5, maxPeak: 11, predictedUp: false },
  { symbol: "AAVE", price: 154, minTrough: 140, maxPeak: 170, predictedUp: true },
  { symbol: "HOME", price: 0.02, minTrough: 0.01, maxPeak: 0.03, predictedUp: true },
  { symbol: "DEGEN", price: 0.004, minTrough: 0.0035, maxPeak: 0.006, predictedUp: true },
  { symbol: "CLANKER", price: 13.5, minTrough: 12, maxPeak: 16, predictedUp: true },
];

describe("base-cascade-program hierarchy", () => {
  it("tiers MAIN / LOWER / HOME / DEFERRED / AERO bridge", () => {
    assert.equal(cascadeTierOf("LINK"), "MAIN");
    assert.equal(cascadeTierOf("BRETT"), "LOWER");
    assert.equal(cascadeTierOf("HOME"), "HOME");
    assert.equal(cascadeTierOf("AAVE"), "DEFERRED");
    assert.equal(cascadeTierOf("AERO"), "BRIDGE");
    assert.ok(CASCADE_MAIN_SYMBOLS.includes("AERO"));
    assert.ok(CASCADE_LOWER_SYMBOLS.includes("BRETT"));
    assert.ok(CASCADE_DEFERRED_MAJORS.includes("CBBTC"));
  });

  it("viable capital keeps HOME locked and marks $11 thin book", () => {
    const c = viableCascadeCapital({
      liquidUsd: 2.5,
      homeBagUsd: 11,
      ethUsd: 2700,
      bagsDividendUsd: 0,
    });
    assert.equal(c.homeSpendable, false);
    assert.equal(c.homeBagUsd, 11);
    assert.ok(c.thinBook);
    assert.ok(c.deployableUsd < INJECT_ALL_USD);
    assert.equal(c.cascadeSeedUsd, CASCADE_SEED_USD);
    assert.ok(c.minHopUsd >= 0.5);
  });

  it("thin $11 book predicts snowball into LOWER first", () => {
    const pred = predictCascadeHops({
      seats: SEATS,
      liquidUsd: 3,
      homeBagUsd: 11,
      ethUsd: 2700,
    });
    assert.equal(pred.phase, PHASES.SNOWBALL_SMALL);
    assert.ok(pred.next);
    assert.ok(["LOWER", "BRIDGE"].includes(pred.next.tier));
    assert.ok(pred.next.usd > 0);
    assert.ok(pred.goal);
    // $3 liquid − gas floor ≈ under min hop — still show predicted seat
    assert.equal(pred.next.viable, false);
    assert.match(pred.next.reason, /snowball|need/i);

    const funded = predictCascadeHops({
      seats: SEATS,
      liquidUsd: 5,
      homeBagUsd: 11,
      ethUsd: 2700,
    });
    assert.equal(funded.phase, PHASES.SNOWBALL_SMALL);
    assert.equal(funded.next.viable, true);
    assert.match(funded.next.reason, /thin|snowball/i);
  });

  it("dividend pool phase when bag withdraw clears next hop", () => {
    const withDiv = SEATS.map((s) =>
      s.symbol === "BRETT"
        ? { ...s, bagUsd: 4, dividendPct: 0.2 }
        : s,
    );
    const pred = predictCascadeHops({
      seats: withDiv,
      liquidUsd: 0.5,
      homeBagUsd: 11,
      ethUsd: 2700,
      bagsDividendUsd: 0.8,
    });
    assert.equal(pred.phase, PHASES.DIVIDEND_POOL);
    assert.ok(pred.dividendReady.some((d) => d.symbol === "BRETT" && d.viableNextHop));
    assert.ok(pred.next?.fromDividend === "BRETT" || pred.next?.usd > 0);
  });

  it("plans Base program with RH-less seats (original path)", () => {
    const plan = planBaseCascadeProgram({
      seats: SEATS,
      liquidUsd: 2.8,
      homeBagUsd: 11,
      ethUsd: 2688,
      maxHops: 8,
    });
    assert.equal(plan.id, BASE_CASCADE_PROGRAM_ID);
    assert.equal(plan.rail, "base");
    assert.equal(plan.execution, "base-risk-original-path");
    assert.equal(plan.neverSellHome, true);
    assert.ok(plan.cascade.hopCount >= 1);
    const card = formatBaseCascadeProgramCard(plan);
    assert.match(card, /BASE CASCADE PROGRAM/);
    assert.match(card, /Wave data: RH overlay only/);
    assert.match(card, /deployable/);
    assert.match(formatCascadePredictionCard(plan), /CASCADE PREDICTION/);
    assert.match(formatCascadeHierarchyCard(), /MAIN/);
  });

  it("parse commands", () => {
    assert.equal(parseBaseCascadeCommand("/cascade").action, "program");
    assert.equal(parseBaseCascadeCommand("/cascade predict").action, "predict");
    assert.equal(parseBaseCascadeCommand("/cascade hierarchy").action, "hierarchy");
  });

  it("package + FILING wire the module", () => {
    const pkg = readFileSync(join(HERE, "..", "package.json"), "utf8");
    assert.match(pkg, /vita\/base-cascade-program\.test\.js/);
    const filing = readFileSync(join(HERE, "FILING.md"), "utf8");
    assert.match(filing, /base-cascade-program\.js/);
  });
});
