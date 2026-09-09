/**
 * avenue-prime.js — projected costs + top 2–3 cascade seats.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  projectRoundTripCostEth,
  hitchBytesAffordable,
  projectAvenue,
  primeAvenues,
  pickCascadeFromPrimed,
  primedSeatCount,
  formatPrimedAvenues,
  PRIMED_TOP_N,
} from "./avenue-prime.js";

const root = dirname(fileURLToPath(import.meta.url));
const agentSrc = readFileSync(join(root, "agent.js"), "utf8");

describe("avenue-prime: cost projection", () => {
  it("scales round-trip cost with trade size and hitch", () => {
    const small = projectRoundTripCostEth({
      tradeEth: 0.001,
      gasCostEth: 0.00005,
      hitchCostEth: 0.00002,
      feePct: 0.006,
    });
    const big = projectRoundTripCostEth({
      tradeEth: 0.01,
      gasCostEth: 0.00005,
      hitchCostEth: 0.00002,
      feePct: 0.006,
    });
    assert.ok(small.costEth > 0);
    assert.ok(big.costEth > small.costEth);
    assert.ok(big.feeEth > small.feeEth);
  });

  it("estimates hitch bytes from leftover budget", () => {
    const bytes = hitchBytesAffordable({
      leftoverEth: 0.0002,
      gwei: 0.05,
      hitchCostMult: 2,
    });
    assert.ok(bytes >= 10);
  });
});

describe("avenue-prime: refuse lose-money paths", () => {
  it("refuses when spend is below min entry", () => {
    const a = projectAvenue({
      symbol: "UNI",
      tradeEth: 0.0001,
      gasCostEth: 0.0001,
      hitchCostEth: 0.00005,
      feePct: 0.006,
      netMargin: 0.05,
      armed: true,
      ethUsd: 2500,
      minPosUsd: 0.5,
    });
    assert.equal(a.allow, false);
    assert.match(a.refuseReason, /min entry/i);
  });

  it("refuses when projected net after hitch is non-positive", () => {
    const a = projectAvenue({
      symbol: "SKI",
      tradeEth: 0.002,
      gasCostEth: 0.00005,
      hitchCostEth: 0.0002, // hitch larger than expected gross
      feePct: 0.003,
      netMargin: 0.03, // 0.002*0.03=0.00006 << hitch
      armed: true,
      ethUsd: 2500,
      minPosUsd: 0.5,
      tokenMinBuyUsd: 0,
    });
    assert.equal(a.allow, false);
    assert.match(a.refuseReason, /lose|wipe/i);
  });

  it("allows a clear-edge inject main near entry", () => {
    const a = projectAvenue({
      symbol: "UNI",
      tradeEth: 0.002,
      gasCostEth: 0.00004,
      hitchCostEth: 0.00001,
      feePct: 0.003,
      netMargin: 0.06,
      minNetMargin: 0.025,
      armed: true,
      nearEntry: true,
      injectMain: true,
      tokenScore: 80,
      ethUsd: 2500,
      gwei: 0.05,
      hitchBytesWanted: 40,
      minPosUsd: 0.5,
      tokenMinBuyUsd: 0,
      price: 7,
      recentHigh: 8.5, // ~21% near-term room clears RT break-even
      tradeableUsd: 80,
    });
    assert.equal(a.allow, true);
    assert.ok(a.outcomeScore > 0);
    assert.ok(a.hitchBytesFit >= 10);
    assert.equal(a.readyNow, true);
  });

  it("refuses CBBTC when near-term upside cannot clear insert costs", () => {
    const a = projectAvenue({
      symbol: "CBBTC",
      tradeEth: 0.0005,
      gasCostEth: 0.00003,
      hitchCostEth: 0.00008,
      feePct: 0.006,
      netMargin: 0.2,
      armed: true,
      nearEntry: true,
      ethUsd: 2500,
      price: 95000,
      recentHigh: 95100,
      tradeableUsd: 6,
      minPosUsd: 0.5,
      tokenMinBuyUsd: 0,
    });
    assert.equal(a.allow, false);
    assert.ok(a.refuseReason);
  });
});

describe("avenue-prime: top 2–3 ranking", () => {
  it("keeps best outcome scores and prefers code-fit winners", () => {
    const base = {
      tradeEth: 0.003,
      gasCostEth: 0.00004,
      hitchCostEth: 0.00001,
      feePct: 0.003,
      ethUsd: 2500,
      gwei: 0.05,
      armed: true,
      minPosUsd: 0.5,
      tokenMinBuyUsd: 0,
      hitchBytesWanted: 40,
      price: 1,
      recentHigh: 1.2,
      tradeableUsd: 100,
    };
    const { primed, best } = primeAvenues(
      [
        { ...base, symbol: "DRB", netMargin: 0.04, nearEntry: false, tokenScore: 40 },
        { ...base, symbol: "UNI", netMargin: 0.05, nearEntry: true, injectMain: true, tokenScore: 90 },
        { ...base, symbol: "LINK", netMargin: 0.045, nearEntry: true, injectMain: true, tokenScore: 70 },
        { ...base, symbol: "SKI", netMargin: 0.03, nearEntry: false, tokenScore: 20 },
      ],
      { topN: 3 }
    );
    assert.ok(primed.length >= 2 && primed.length <= PRIMED_TOP_N);
    assert.equal(best.symbol, "UNI");
    assert.equal(primed[0].symbol, "UNI");
    const picked = pickCascadeFromPrimed(primed, { excludeSymbol: "KEYCAT" });
    assert.equal(picked.symbol, "UNI");
    const afterSell = pickCascadeFromPrimed(primed, { excludeSymbol: "UNI" });
    assert.ok(afterSell && afterSell.symbol !== "UNI");
  });

  it("seat count shrinks on thin books", () => {
    assert.equal(primedSeatCount(5, { injectAll: true }), 1);
    assert.equal(primedSeatCount(5), 1); // under inject-all USD → 1 seat
    assert.equal(primedSeatCount(13, { smallBook: true }), 2);
    assert.equal(primedSeatCount(50), 3);
  });

  it("formats a primed log line", () => {
    const line = formatPrimedAvenues({
      primed: [
        {
          symbol: "UNI",
          expectedNetUsd: 0.25,
          projectedCostPct: 0.02,
          hitchBytesFit: 40,
          readyNow: true,
        },
      ],
    });
    assert.match(line, /PRIMED/);
    assert.match(line, /UNI/);
  });
});

describe("avenue-prime: wired into agent.js", () => {
  it("imports and uses primed cascade selection", () => {
    assert.ok(agentSrc.includes('from "./avenue-prime.js"'));
    assert.ok(agentSrc.includes("primeAvenues"));
    assert.ok(agentSrc.includes("pickCascadeFromPrimed"));
    assert.ok(agentSrc.includes("currentPrimedAvenues"));
    assert.ok(agentSrc.includes("formatPrimedAvenues"));
  });
});

describe("avenue-prime: round-trip impact ×2", () => {
  it("impact is charged on both legs", () => {
    const c = projectRoundTripCostEth({
      tradeEth: 1,
      gasCostEth: 0,
      hitchCostEth: 0,
      feePct: 0.01,
      impactPct: 0.003,
    });
    assert.ok(Math.abs(c.impactEth - 0.006) < 1e-12);
    assert.ok(Math.abs(c.costEth - 0.026) < 1e-12);
  });
});
