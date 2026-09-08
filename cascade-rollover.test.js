/**
 * cascade-rollover.js — min entry, inject-all, cascade deploy, liquid status.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  minEntryEth,
  cascadeSeedEth,
  effectiveMinEntryEth,
  injectAllBookParams,
  cascadeDeployEth,
  liquidBalanceStatus,
  shouldRecycleForCascadeFuel,
  belowMinEntrySkip,
  effectiveSellReserve,
  INJECT_ALL_USD,
  CASCADE_SEED_USD,
  FULL_SELL_RESERVE_ETH,
} from "./cascade-rollover.js";
import { tierBookParams } from "./inject-revenue.js";

const root = dirname(fileURLToPath(import.meta.url));
const agentSrc = readFileSync(join(root, "agent.js"), "utf8");

describe("cascade-rollover: min entry covers costs + seed", () => {
  it("scales with gas and hitch", () => {
    const low = minEntryEth({
      gasCostEth: 0.00005,
      hitchCostEth: 0.00002,
      feePct: 0.006,
      cascadeSeedEth: 0.0003,
    });
    const high = minEntryEth({
      gasCostEth: 0.0002,
      hitchCostEth: 0.0001,
      feePct: 0.006,
      cascadeSeedEth: 0.0003,
    });
    assert.ok(low > 0);
    assert.ok(high > low);
  });

  it("seed from USD uses live ETH price", () => {
    assert.ok(Math.abs(cascadeSeedEth(2500, CASCADE_SEED_USD) - CASCADE_SEED_USD / 2500) < 1e-12);
  });

  it("effective min takes max of computed and token floor", () => {
    const e = effectiveMinEntryEth({
      gasCostEth: 0.00005,
      hitchCostEth: 0.00002,
      feePct: 0.003,
      ethUsd: 2500,
      tokenMinBuyUsd: 25,
      minPosUsd: 0.5,
      cascadeSeedUsd: 0.75,
    });
    // $25 / 2500 = 0.01 ETH dominates tiny computed floor
    assert.ok(e >= 0.01 - 1e-9);
  });
});

describe("cascade-rollover: inject-all book", () => {
  it("collapses to one 100% seat under INJECT_ALL_USD", () => {
    const base = tierBookParams(6);
    const p = injectAllBookParams(6, base);
    assert.equal(p.injectAll, true);
    assert.equal(p.tier1Count, 1);
    assert.equal(p.tier1Pct, 1);
    assert.equal(p.tier2Pct, 0);
  });

  it("leaves larger books alone", () => {
    const base = tierBookParams(INJECT_ALL_USD + 5);
    const p = injectAllBookParams(INJECT_ALL_USD + 5, base);
    assert.equal(p.injectAll, false);
    assert.equal(p.tier1Count, 3);
  });
});

describe("cascade-rollover: deploy sizing", () => {
  it("refuses cascade when proceeds below next min entry", () => {
    assert.equal(cascadeDeployEth({ proceedsEth: 0.0002, targetMinEntryEth: 0.0005 }), 0);
  });

  it("deploys full proceeds on strong margin once min met", () => {
    const d = cascadeDeployEth({
      proceedsEth: 0.002,
      targetMinEntryEth: 0.0008,
      netMargin: 0.06,
    });
    assert.equal(d, 0.002);
  });

  it("bumps pct up to meet min entry when proceeds allow", () => {
    const d = cascadeDeployEth({
      proceedsEth: 0.001,
      targetMinEntryEth: 0.0009,
      netMargin: 0.01, // would be 55% = 0.00055 < min
    });
    assert.ok(d >= 0.0009 - 1e-12);
    assert.ok(d <= 0.001 + 1e-12);
  });
});

describe("cascade-rollover: liquid vs deployed", () => {
  it("recycle_cascade when liquid thin but bags have value", () => {
    const s = liquidBalanceStatus({
      eth: 0.0015,
      weth: 0.0002,
      tradeableWithWeth: 0.000485,
      ethUsd: 2486,
      deployedTokenUsd: 4.5,
      minEntryEth: 0.001,
    });
    assert.equal(s.action, "recycle_cascade");
    assert.equal(s.trulyEmpty, false);
    assert.ok(s.message.includes("bags"));
  });

  it("top_up only when chain is truly empty", () => {
    const s = liquidBalanceStatus({
      eth: 0.0001,
      weth: 0,
      tradeableWithWeth: 0,
      ethUsd: 2486,
      deployedTokenUsd: 0.1,
    });
    assert.equal(s.action, "top_up");
    assert.equal(s.trulyEmpty, true);
  });
});

describe("cascade-rollover: starve recycle + skip copy", () => {
  it("lowers unknown-dust floor when liquid starved", () => {
    assert.equal(
      shouldRecycleForCascadeFuel({
        unknownEntry: true,
        posUsd: 0.28,
        liquidStarved: true,
        moonshotHoldUsd: 0.5,
      }),
      true,
    );
    assert.equal(
      shouldRecycleForCascadeFuel({
        unknownEntry: true,
        posUsd: 0.28,
        liquidStarved: false,
        moonshotHoldUsd: 0.5,
      }),
      false,
    );
  });

  it("belowMinEntrySkip formats clear deny", () => {
    const msg = belowMinEntrySkip({
      symbol: "UNI",
      ethToSpend: 0.0002,
      minEntry: 0.001,
      ethUsd: 2500,
    });
    assert.ok(msg.includes("min entry"));
    assert.ok(msg.includes("UNI"));
    assert.equal(
      belowMinEntrySkip({ symbol: "UNI", ethToSpend: 0.002, minEntry: 0.001, ethUsd: 2500 }),
      null,
    );
  });
});

describe("cascade-rollover: thin-book sell reserve", () => {
  it("shrinks reserve on a ~0.002 ETH book so tradeable is real", () => {
    const total = 0.001985;
    const r = effectiveSellReserve(total);
    assert.ok(r < FULL_SELL_RESERVE_ETH);
    assert.ok(r <= 0.00025 + 1e-9 || r <= total * 0.08 + 1e-9);
    // After gas 0.0005 + thin sell reserve, tradeable must clear a smoke entry
    const gas = 0.0005;
    const tradeable = Math.max(total - Math.max(total * 0.2, gas + r), 0);
    assert.ok(tradeable > 0.0008, `tradeable ${tradeable} should beat the old 0.000485 trap`);
  });

  it("keeps full reserve on larger books", () => {
    assert.equal(effectiveSellReserve(0.05), FULL_SELL_RESERVE_ETH);
  });
});

describe("cascade-rollover: wired into agent.js", () => {
  it("imports cascade-rollover helpers", () => {
    assert.ok(agentSrc.includes('from "./cascade-rollover.js"'));
    assert.ok(agentSrc.includes("effectiveMinEntryEth"));
    assert.ok(agentSrc.includes("injectAllBookParams"));
    assert.ok(agentSrc.includes("cascadeDeployEth"));
    assert.ok(agentSrc.includes("liquidBalanceStatus"));
  });

  it("cascades after dust recycle when proceeds clear min entry", () => {
    assert.ok(agentSrc.includes("DUST RECYCLE") || agentSrc.includes("recycle"));
    assert.ok(agentSrc.includes("triggerCascade"));
  });
});
