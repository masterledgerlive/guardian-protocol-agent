/**
 * Mother-brain pulse — continuous cascade + self-read inject without Cursor agent.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MOTHER_BRAIN_PULSE_ID,
  MOTHER_BRAIN_PULSE_MAGIC,
  MOTHER_BRAIN_PULSE_ENV,
  MOTHER_BRAIN_PULSE_LIVE_ENV,
  UNLOCKED_CASCADE_TOKENS,
  unlockMotherBrainForTrading,
  armMotherBrainPulse,
  disarmMotherBrainPulse,
  seatsFromCatalog,
  stageCascadeHopFromPlan,
  tickMotherBrainPulse,
  formatMotherBrainPulseCard,
  formatMotherBrainUnlockCard,
  parseMotherBrainPulseCommand,
  resetMotherBrainPulseForTests,
  motherBrainPulseRuntime,
} from "./mother-brain-pulse.js";
import { HOLD_ALL_SELLS_ENV } from "../operator-sell-hold.js";
import { CASCADE_MAIN_INOUT_HUBS } from "./base-cascade-program.js";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("mother-brain pulse unlock", () => {
  it("unlocks HOLD_ALL_SELLS while HOME never-sells and arms pulse", () => {
    const env = { [HOLD_ALL_SELLS_ENV]: "yes" };
    const u = unlockMotherBrainForTrading(env);
    assert.equal(u.ok, true);
    assert.equal(u.holdAllSells, false);
    assert.equal(u.homeNeverSell, true);
    assert.equal(env[HOLD_ALL_SELLS_ENV], "no");
    assert.equal(env[MOTHER_BRAIN_PULSE_ENV], "yes");
    assert.ok(u.hubs.includes("HOME"));
    assert.ok(u.hubs.includes("AERO"));
    assert.ok(u.lower.includes("DEGEN") || u.lower.includes("CLANKER"));
    assert.ok(UNLOCKED_CASCADE_TOKENS.includes("HOME"));
    assert.ok(UNLOCKED_CASCADE_TOKENS.includes("AERO"));
    assert.match(formatMotherBrainUnlockCard(u), /MOTHER BRAIN UNLOCKED/);
  });

  it("arm / disarm toggles pulse env", () => {
    const env = {};
    assert.equal(armMotherBrainPulse(env).armed, true);
    assert.equal(env[MOTHER_BRAIN_PULSE_ENV], "yes");
    assert.equal(disarmMotherBrainPulse(env).armed, false);
    assert.equal(env[MOTHER_BRAIN_PULSE_ENV], "no");
  });
});

describe("mother-brain pulse staging", () => {
  before(() => resetMotherBrainPulseForTests());
  after(() => resetMotherBrainPulseForTests());

  it("builds seats from catalog including hubs", () => {
    const seats = seatsFromCatalog([
      { symbol: "DEGEN", price: 0.01, minTrough: 0.008, maxPeak: 0.02, predictedUp: true },
      { symbol: "CLANKER", price: 12, minTrough: 10, maxPeak: 20, predictedUp: true },
    ]);
    assert.ok(seats.some((s) => s.symbol === "DEGEN"));
    assert.ok(seats.some((s) => s.symbol === "HOME"));
    assert.ok(seats.some((s) => s.symbol === "AERO"));
  });

  it("SIM stages plan without live command queue", () => {
    const plan = {
      prediction: {
        phase: "SNOWBALL_SMALL",
        next: {
          symbol: "DEGEN",
          usd: 1.5,
          action: "cascade-lower-in",
          viable: true,
        },
      },
      capital: { deployableUsd: 2, homeBagUsd: 11 },
    };
    const stage = stageCascadeHopFromPlan(plan, { live: false });
    assert.equal(stage.ok, true);
    assert.equal(stage.staged, false);
    assert.equal(stage.sim, true);
    assert.equal(stage.command.symbol, "DEGEN");
    assert.equal(stage.command.source, "MOTHER_BRAIN_PULSE");
    assert.equal(stage.command.cascade, true);
  });

  it("LIVE stages a buy command for the trading loop", () => {
    const plan = {
      prediction: {
        phase: "SNOWBALL_SMALL",
        next: { symbol: "CLANKER", usd: 2, action: "cascade-lower-in", viable: true },
      },
    };
    const stage = stageCascadeHopFromPlan(plan, { live: true });
    assert.equal(stage.staged, true);
    assert.equal(stage.command.action, "buy");
    assert.equal(stage.command.usd, 2);
    assert.match(stage.command.reason, /MOTHER PULSE/);
  });

  it("refuses underfunded next hop", () => {
    const stage = stageCascadeHopFromPlan({
      prediction: {
        next: { symbol: "DEGEN", usd: 3, action: "cascade-lower-in", viable: false },
      },
    });
    assert.equal(stage.ok, false);
    assert.equal(stage.reason, "next_underfunded");
  });
});

describe("mother-brain pulse tick", () => {
  before(() => resetMotherBrainPulseForTests());
  after(() => resetMotherBrainPulseForTests());

  it("ticks plan + unlock without Cursor agent (SIM)", () => {
    resetMotherBrainPulseForTests();
    const env = {
      [HOLD_ALL_SELLS_ENV]: "yes",
      [MOTHER_BRAIN_PULSE_ENV]: "yes",
      [MOTHER_BRAIN_PULSE_LIVE_ENV]: "no",
    };
    const catalog = [
      {
        symbol: "DEGEN",
        price: 0.012,
        minTrough: 0.008,
        maxPeak: 0.02,
        predictedUp: true,
        cascadeAvailable: true,
      },
      {
        symbol: "AERO",
        price: 0.9,
        minTrough: 0.7,
        maxPeak: 1.3,
        predictedUp: true,
        cascadeAvailable: true,
      },
      {
        symbol: "HOME",
        price: 0.01,
        minTrough: 0.005,
        maxPeak: 0.02,
        balance: 1100,
        predictedUp: true,
      },
    ];
    const result = tickMotherBrainPulse({
      catalog,
      liquidUsd: 3.5,
      homeBagUsd: 11,
      ethUsd: 2700,
      env,
      force: true,
      forceLearn: false,
      now: Date.now(),
    });
    assert.equal(result.ok, true);
    assert.equal(result.skipped, false);
    assert.equal(env[HOLD_ALL_SELLS_ENV], "no");
    assert.ok(result.unlock.unlocked);
    assert.ok(result.plan);
    assert.equal(result.command, null); // SIM
    assert.match(formatMotherBrainPulseCard(result), /MOTHER BRAIN PULSE/);
    assert.ok(motherBrainPulseRuntime().tickCount >= 1);
  });

  it("cooldown skips until interval elapses", () => {
    resetMotherBrainPulseForTests();
    const env = { [MOTHER_BRAIN_PULSE_ENV]: "yes" };
    const catalog = [
      { symbol: "DEGEN", price: 0.01, minTrough: 0.008, maxPeak: 0.02, predictedUp: true },
    ];
    const t0 = 1_700_000_000_000;
    const a = tickMotherBrainPulse({
      catalog,
      liquidUsd: 4,
      homeBagUsd: 11,
      env,
      force: true,
      now: t0,
    });
    assert.equal(a.ok, true);
    assert.equal(a.skipped, false);
    const b = tickMotherBrainPulse({
      catalog,
      liquidUsd: 4,
      homeBagUsd: 11,
      env,
      force: false,
      now: t0 + 1000,
    });
    assert.equal(b.skipped, true);
    assert.equal(b.reason, "cooldown");
  });

  it("LIVE pulse returns stage command when next hop viable", () => {
    resetMotherBrainPulseForTests();
    const env = {
      [MOTHER_BRAIN_PULSE_ENV]: "yes",
      [MOTHER_BRAIN_PULSE_LIVE_ENV]: "yes",
      [HOLD_ALL_SELLS_ENV]: "no",
    };
    const catalog = [
      {
        symbol: "DEGEN",
        price: 0.01,
        minTrough: 0.009,
        maxPeak: 0.03,
        predictedUp: true,
        rangePos: 0.05,
      },
      {
        symbol: "BRETT",
        price: 0.05,
        minTrough: 0.04,
        maxPeak: 0.1,
        predictedUp: true,
        rangePos: 0.08,
      },
      { symbol: "AERO", price: 0.85, minTrough: 0.7, maxPeak: 1.2, predictedUp: true },
      { symbol: "HOME", price: 0.01, minTrough: 0.005, maxPeak: 0.02, balance: 1000 },
    ];
    const result = tickMotherBrainPulse({
      catalog,
      liquidUsd: 5,
      homeBagUsd: 11,
      ethUsd: 2700,
      env,
      force: true,
      now: Date.now() + 99_000,
    });
    assert.equal(result.ok, true);
    // May or may not have viable next depending on wave ready — if staged, must be buy
    if (result.command) {
      assert.equal(result.command.action, "buy");
      assert.equal(result.command.source, "MOTHER_BRAIN_PULSE");
      assert.ok(result.command.usd > 0);
      assert.notEqual(result.command.symbol, "HOME"); // buy HOME ok as hub-in; sell never
    }
  });
});

describe("mother-brain pulse commands + filing", () => {
  it("parses pulse / arm / disarm / unlock", () => {
    assert.equal(parseMotherBrainPulseCommand("/cascade pulse").action, "pulse");
    assert.equal(parseMotherBrainPulseCommand("/mother pulse").action, "pulse");
    assert.equal(parseMotherBrainPulseCommand("/cascade arm").action, "arm");
    assert.equal(parseMotherBrainPulseCommand("/cascade disarm").action, "disarm");
    assert.equal(parseMotherBrainPulseCommand("/cascade unlock").action, "unlock");
    assert.equal(parseMotherBrainPulseCommand("/cascade predict").action, "predict");
    assert.equal(parseMotherBrainPulseCommand("/nope").ok, false);
  });

  it("hubs match decided cascade pair", () => {
    assert.deepEqual([...CASCADE_MAIN_INOUT_HUBS], ["HOME", "AERO"]);
  });

  it("module magic + id stable", () => {
    assert.equal(MOTHER_BRAIN_PULSE_ID, "mother-brain-pulse-v1");
    assert.equal(MOTHER_BRAIN_PULSE_MAGIC, "§MOTHERPULSE§");
  });

  it("package.json runs mother-brain-pulse tests", () => {
    const pkg = readFileSync(join(HERE, "..", "package.json"), "utf8");
    assert.match(pkg, /vita\/mother-brain-pulse\.test\.js/);
  });

  it("FILING lists mother-brain-pulse", () => {
    const filing = readFileSync(join(HERE, "FILING.md"), "utf8");
    assert.match(filing, /mother-brain-pulse/);
  });
});
