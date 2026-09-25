import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, unlinkSync, existsSync } from "node:fs";
import {
  BASE_L1_OPTIMISM_PORTAL,
  encodePortalDepositEth,
  isOperatorBridgeL1ToBaseArmed,
  maybeBridgeL1EthToBase,
  planL1EthDeposit,
  writeBridgeLatch,
} from "./l1-bridge-to-base.js";

const agentSrc = readFileSync(new URL("./agent.js", import.meta.url), "utf8");

describe("l1-bridge-to-base", () => {
  it("agent imports and boots OPERATOR_BRIDGE_L1_TO_BASE", () => {
    assert.match(agentSrc, /from "\.\/l1-bridge-to-base\.js"/);
    assert.match(agentSrc, /maybeBridgeL1EthToBase/);
    assert.match(agentSrc, /OPERATOR_BRIDGE_L1_TO_BASE/);
  });

  it("arms only on yes/1/true", () => {
    assert.equal(isOperatorBridgeL1ToBaseArmed({ OPERATOR_BRIDGE_L1_TO_BASE: "yes" }), true);
    assert.equal(isOperatorBridgeL1ToBaseArmed({ OPERATOR_BRIDGE_L1_TO_BASE: "1" }), true);
    assert.equal(isOperatorBridgeL1ToBaseArmed({ OPERATOR_BRIDGE_L1_TO_BASE: "true" }), true);
    assert.equal(isOperatorBridgeL1ToBaseArmed({ OPERATOR_BRIDGE_L1_TO_BASE: "no" }), false);
    assert.equal(isOperatorBridgeL1ToBaseArmed({}), false);
  });

  it("encodes OptimismPortal depositTransaction to self", () => {
    const to = "0x50e1C4608c48b0c52E1EA5FBabc1c9126eA17915";
    const valueWei = 700000000000000n;
    const data = encodePortalDepositEth({ to, valueWei });
    assert.match(data, /^0xe9e05c42/);
    assert.equal(BASE_L1_OPTIMISM_PORTAL.toLowerCase(), "0x49048044d57e1c92a77f79988d21fa8faf74e97e");
  });

  it("plans deposit leaving gas reserve (~$2.56 L1 case)", () => {
    const balWei = 948176024188161n; // live RISK L1 ~0.000948 ETH
    const gasEst = 130807n;
    const gasPriceWei = 163434888n; // ~0.163 gwei
    const plan = planL1EthDeposit({ balWei, gasEst, gasPriceWei });
    assert.equal(plan.ok, true);
    // CDP maxFee floor 0.00025 dominates tiny eth_gasPrice×gas
    assert.equal(plan.gasReserveWei, 250_000_000_000_000n);
    assert.ok(plan.depositWei > 600000000000000n);
    assert.equal(plan.depositWei + plan.gasReserveWei, balWei);
  });

  it("retries half deposit when CDP says insufficient balance", async () => {
    const tmp = `/tmp/l1-bridge-half-${Date.now()}.json`;
    const RISK = "0x50e1C4608c48b0c52E1EA5FBabc1c9126eA17915";
    const bal = 948176024188161n;
    const fakeHash = "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
    let calls = 0;
    const r = await maybeBridgeL1EthToBase({
      cdp: {
        evm: {
          sendTransaction: async (args) => {
            calls++;
            if (calls === 1) throw new Error("Insufficient balance to execute the transaction.");
            return { transactionHash: fakeHash };
          },
        },
      },
      fromAddress: RISK,
      latchPath: tmp,
      envObj: { OPERATOR_BRIDGE_L1_TO_BASE: "yes" },
      ethUsd: 2688,
      log() {},
      ethRpcFn: async (method) => {
        if (method === "eth_getBalance") return "0x" + bal.toString(16);
        if (method === "eth_gasPrice") return "0x9be15c8";
        if (method === "eth_estimateGas") return "0x1fef7";
        throw new Error(method);
      },
    });
    assert.equal(r.sent, true);
    assert.equal(calls, 2);
    assert.equal(r.plan?.retriedHalf, true);
    if (existsSync(tmp)) unlinkSync(tmp);
  });

  it("refuses empty / too-thin L1", () => {
    assert.equal(planL1EthDeposit({ balWei: 0n, gasEst: 100000n, gasPriceWei: 1n }).ok, false);
    const thin = planL1EthDeposit({
      balWei: 100000n,
      gasEst: 130000n,
      gasPriceWei: 1_000_000_000n,
    });
    assert.equal(thin.ok, false);
  });

  it("latches after a real hash — no re-send", async () => {
    const tmp = `/tmp/l1-bridge-latch-${Date.now()}.json`;
    writeBridgeLatch({
      ok: true,
      hash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      depositEth: 0.0008,
    }, tmp);
    const r = await maybeBridgeL1EthToBase({
      cdp: { evm: { sendTransaction: async () => { throw new Error("should not send"); } } },
      fromAddress: "0x50e1C4608c48b0c52E1EA5FBabc1c9126eA17915",
      latchPath: tmp,
      envObj: { OPERATOR_BRIDGE_L1_TO_BASE: "yes" },
      log() {},
    });
    assert.equal(r.sent, false);
    assert.equal(r.reason, "latched");
    if (existsSync(tmp)) unlinkSync(tmp);
  });

  it("sends via CDP network ethereum when armed", async () => {
    const tmp = `/tmp/l1-bridge-send-${Date.now()}.json`;
    const RISK = "0x50e1C4608c48b0c52E1EA5FBabc1c9126eA17915";
    const bal = 948176024188161n;
    const gasPrice = 163434888n;
    const gasEst = 130807n;
    let captured = null;
    const fakeHash = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const r = await maybeBridgeL1EthToBase({
      cdp: {
        evm: {
          sendTransaction: async (args) => {
            captured = args;
            return { transactionHash: fakeHash };
          },
        },
      },
      fromAddress: RISK,
      latchPath: tmp,
      envObj: { OPERATOR_BRIDGE_L1_TO_BASE: "yes" },
      ethUsd: 2688,
      log() {},
      ethRpcFn: async (method) => {
        if (method === "eth_getBalance") return "0x" + bal.toString(16);
        if (method === "eth_gasPrice") return "0x" + gasPrice.toString(16);
        if (method === "eth_estimateGas") return "0x" + gasEst.toString(16);
        throw new Error("unexpected " + method);
      },
    });
    assert.equal(r.sent, true);
    assert.equal(r.hash, fakeHash);
    assert.equal(captured.network, "ethereum");
    assert.equal(captured.address, RISK);
    assert.equal(captured.transaction.to, BASE_L1_OPTIMISM_PORTAL);
    assert.ok(captured.transaction.value > 0n);
    assert.match(captured.transaction.data, /^0xe9e05c42/);
    if (existsSync(tmp)) unlinkSync(tmp);
  });

  it("does not latch when CDP returns no hash", async () => {
    const tmp = `/tmp/l1-bridge-nohash-${Date.now()}.json`;
    const RISK = "0x50e1C4608c48b0c52E1EA5FBabc1c9126eA17915";
    const r = await maybeBridgeL1EthToBase({
      cdp: {
        evm: {
          sendTransaction: async () => ({ transactionHash: null }),
        },
      },
      fromAddress: RISK,
      latchPath: tmp,
      envObj: { OPERATOR_BRIDGE_L1_TO_BASE: "yes" },
      log() {},
      ethRpcFn: async (method) => {
        if (method === "eth_getBalance") return "0x35e5c6f1b3501";
        if (method === "eth_gasPrice") return "0x9be15c8";
        if (method === "eth_estimateGas") return "0x1fef7";
        throw new Error(method);
      },
    });
    assert.equal(r.sent, false);
    assert.equal(r.reason, "no-hash");
    assert.equal(existsSync(tmp), false);
  });
});
