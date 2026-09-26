/**
 * INJECT FUEL memory arm — wait PLUS, never sell red.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  injectFuelPctToGreen,
  armInjectFuelMemoryHitch,
  formatInjectFuelHoldArmLog,
  INJECT_FUEL_ARM_ID,
} from "./inject-fuel-arm.js";
import { INJECT_VELOCITY_SYMBOLS, injectVelocityScoreBoost } from "../inject-revenue.js";

const root = dirname(fileURLToPath(import.meta.url));
const agentSrc = readFileSync(join(root, "..", "agent.js"), "utf8");

describe("inject-fuel-arm: pct to green", () => {
  it("returns null on bad inputs", () => {
    assert.equal(injectFuelPctToGreen({ markProceedsEth: 0, entrySoldEth: 1 }), null);
    assert.equal(injectFuelPctToGreen({ markProceedsEth: 1, entrySoldEth: 0 }), null);
  });

  it("returns 0 when mark already clears fees", () => {
    assert.equal(
      injectFuelPctToGreen({
        markProceedsEth: 0.002,
        entrySoldEth: 0.001,
        feePct: 0.01,
        impactPct: 0.003,
      }),
      0,
    );
  });

  it("sizes ~% rise for live CLANKER-class red (never invents P&L)", () => {
    // Live-shaped: mark 1.16e-3 vs entrySold 1.20e-3 at 1% fee + 0.3% impact
    const pct = injectFuelPctToGreen({
      markProceedsEth: 1.16e-3,
      entrySoldEth: 1.20e-3,
      feePct: 0.01,
      impactPct: 0.003,
    });
    assert.ok(pct > 0.03 && pct < 0.08, `expected mid single-digit % rise, got ${pct}`);
  });
});

describe("inject-fuel-arm: arm shard", () => {
  it("arms CLANKER memory hitch without selling red", () => {
    const arm = armInjectFuelMemoryHitch({
      symbol: "CLANKER",
      posUsd: 3.35,
      leftoverEth: -6.69e-5,
      entrySoldEth: 1.20e-3,
      markProceedsEth: 1.16e-3,
      feePct: 0.01,
      impactPct: 0.003,
    });
    assert.equal(arm.id, INJECT_FUEL_ARM_ID);
    assert.equal(arm.symbol, "CLANKER");
    assert.equal(arm.armed, true);
    assert.equal(arm.sellRed, false);
    assert.equal(arm.hitchWhenPlus, true);
    assert.equal(arm.neverSellRedToInject, true);
    assert.equal(arm.storageTokenChargeable, true);
    assert.equal(arm.motherBrain, "untouched");
    assert.ok(arm.pctToGreen > 0);
    assert.match(arm.text, /KEY\+LOC|memory hitch/i);
    const log = formatInjectFuelHoldArmLog(arm);
    assert.match(log, /INJECT FUEL CLANKER/);
    assert.match(log, /wait PLUS/);
    assert.match(log, /memory hitch armed/);
    assert.match(log, /never sell red/i);
    assert.match(log, /\$3\.35/);
  });
});

describe("inject-fuel-arm: CLANKER velocity + agent wire", () => {
  it("lists CLANKER on inject velocity so starved books prefer it when green", () => {
    assert.ok(INJECT_VELOCITY_SYMBOLS.includes("CLANKER"));
    assert.ok(
      injectVelocityScoreBoost({ symbol: "CLANKER", injectAll: true }) >
        injectVelocityScoreBoost({ symbol: "UNI", injectAll: true }),
    );
  });

  it("agent recycle HOLD arms hitch and can FORCE UNWIND CLANKER when lossy", () => {
    assert.ok(agentSrc.includes("armInjectFuelMemoryHitch"));
    assert.ok(agentSrc.includes("formatInjectFuelHoldArmLog"));
    assert.ok(agentSrc.includes("memory hitch armed"));
    assert.ok(agentSrc.includes("FORCE UNWIND"));
    assert.ok(agentSrc.includes("canBypassSellLossGate(forceReason"));
    assert.ok(!/ALLOW_LOSSY_OPERATOR_SELL\s*=\s*[\"']yes[\"']/.test(agentSrc));
    const clank = agentSrc.indexOf('symbol: "CLANKER"');
    assert.ok(clank >= 0);
    const row = agentSrc.slice(clank, agentSrc.indexOf("{ symbol:", clank + 1));
    assert.equal(row.includes("frozen: true"), false, "CLANKER stays catalog-tradeable");
    assert.match(row, /GAME_FORCE_EXIT_PRIORITY|FORCE UNWIND|KEY\+LOC/);
  });
});
