import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { planV4FundSplit } from "./guardian-v4/fund-split.js";
import { maybeFundV4FromV3 } from "./v4-fund-once.js";

const agentSrc = readFileSync(new URL("./agent.js", import.meta.url), "utf8");

describe("v4 fund-once from V3", () => {
  it("agent imports root v4-fund-once — not guardian-v4 runtime", () => {
    assert.match(agentSrc, /from "\.\/v4-fund-once\.js"/);
    assert.doesNotMatch(agentSrc, /guardian-v4\//);
    assert.doesNotMatch(agentSrc, /swap-v4/);
  });

  it("latched when already funded", async () => {
    const tmp = `/tmp/v4-fund-latch-${Date.now()}.json`;
    const { writeFundLatch } = await import("./guardian-v4/fund-split.js");
    writeFundLatch({ ok: true, hash: "0xabc", amountEth: 0.001, to: "0xB81625277327F7487B3eDE850380a71055d3daf7" }, tmp);
    const r = await maybeFundV4FromV3({
      cdp: { evm: { sendTransaction: async () => { throw new Error("should not send"); } } },
      fromAddress: "0x50e1C4608c48b0c52E1EA5FBabc1c9126eA17915",
      getNativeEth: async () => 0.003,
      latchPath: tmp,
      envObj: {
        GUARDIAN_V4_FUND_TO: "0xB81625277327F7487B3eDE850380a71055d3daf7",
        GUARDIAN_V4_FUND_ETH: "0.0015",
        GUARDIAN_V4_FUND_ONCE: "yes",
      },
      log() {},
    });
    assert.equal(r.sent, false);
    assert.equal(r.reason, "latched");
  });

  it("plan matches live RISK liquid case (~0.003 ETH)", () => {
    const plan = planV4FundSplit({
      v3NativeEth: 0.00299979,
      splitEth: 0.0015,
      keepGasEth: 0.0008,
      ethUsd: 2541,
    });
    assert.equal(plan.ok, true);
    assert.ok(plan.amountEth >= 0.0015 - 1e-9);
  });
});
