import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  defaultPaperUsdFromSplit,
  looksLikeEthAddress,
  looksLikeTxHash,
  planV4FundSplit,
  resolveV4TradeableUsd,
} from "../fund-split.js";
import { normalizePrivateKey } from "../wallet.js";

describe("guardian-v4 fund-split plan", () => {
  it("splits surplus while keeping V3 gas floor", () => {
    const plan = planV4FundSplit({
      v3NativeEth: 0.003,
      splitEth: 0.0015,
      keepGasEth: 0.0008,
      ethUsd: 2541,
    });
    assert.equal(plan.ok, true);
    assert.ok(Math.abs(plan.amountEth - 0.0015) < 1e-9);
    assert.ok(Math.abs(plan.v3AfterEth - 0.0015) < 1e-9);
    assert.match(plan.reason, /split/);
  });

  it("refuses when native cannot clear keep-gas + min split", () => {
    const plan = planV4FundSplit({
      v3NativeEth: 0.001,
      splitEth: 0.0015,
      keepGasEth: 0.0008,
      minSplitEth: 0.0008,
    });
    assert.equal(plan.ok, false);
    assert.equal(plan.amountEth, 0);
  });

  it("defaults to half surplus capped by maxSplit", () => {
    const plan = planV4FundSplit({
      v3NativeEth: 0.004,
      keepGasEth: 0.0008,
      minSplitEth: 0.0008,
      maxSplitEth: 0.002,
    });
    assert.equal(plan.ok, true);
    // surplus 0.0032 → half 0.0016 → cap 0.002 → 0.0016
    assert.ok(Math.abs(plan.amountEth - 0.0016) < 1e-9);
  });

  it("detects vault tx hashes vs eth addresses", () => {
    assert.equal(
      looksLikeTxHash("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
      true,
    );
    assert.equal(looksLikeEthAddress("0xB81625277327F7487B3eDE850380a71055d3daf7"), true);
    assert.equal(looksLikeTxHash("123456:ABC-bot-token"), false);
  });

  it("sizes paper usd from split eth", () => {
    assert.equal(defaultPaperUsdFromSplit(0.0015, 2541), Math.max(4, Math.min(12, 0.0015 * 2541)));
  });

  it("resolveV4TradeableUsd prefers wallet when funded", () => {
    const r = resolveV4TradeableUsd({
      paperUsd: 8,
      walletEth: 0.0015,
      ethUsd: 2541,
      gasFloorEth: 0.0003,
    });
    assert.equal(r.source, "wallet");
    assert.ok(r.tradeableUsd > 1);
  });

  it("normalizePrivateKey accepts 32-byte hex keys", () => {
    const pk = "0x" + "11".repeat(32);
    assert.equal(normalizePrivateKey(pk), pk);
    assert.equal(normalizePrivateKey("22".repeat(32)), "0x" + "22".repeat(32));
    assert.equal(normalizePrivateKey(""), null);
    assert.equal(normalizePrivateKey("not-a-key"), null);
  });
});
