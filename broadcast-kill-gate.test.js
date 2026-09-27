import test from "node:test";
import assert from "node:assert/strict";
import {
  selfCallBroadcastGate,
  buyBroadcastGate,
  installSelfCallKillGate,
  minLiquidUsdFloor,
  isBuySwapTx,
  installBroadcastKillGateOn,
} from "./broadcast-kill-gate.js";

const RISK = "0x50e1C4608c48b0c52E1EA5FBabc1c9126eA17915";
const ROUTER = "0xBE6D8f0d05cC4be24d5167a3eF062215bE6D18a5";
const WETH_WORD = "0000000000000000000000004200000000000000000000000000000000000006";
const HOME_WORD = "0000000000000000000000004bfaa776991e85e5f8b1255461cbbd216cfc714f";

test("self-call refused when VITAFEED_PAID=no even with FORCE", () => {
  const g = selfCallBroadcastGate({ env: { VITAFEED_PAID: "no", VITAFEED_FORCE: "yes" } });
  assert.equal(g.ok, false);
  assert.equal(g.code, "paid-off");
});

test("self-call refused when VITAFEED_PAID unset", () => {
  assert.equal(selfCallBroadcastGate({ env: {} }).ok, false);
});

test("self-call liquid floor uses MIN_LIQUID_USD", () => {
  const env = { VITAFEED_PAID: "yes", MIN_LIQUID_USD: "25" };
  assert.equal(minLiquidUsdFloor(env), 25);
  assert.equal(selfCallBroadcastGate({ env, liquidUsd: 1.57 }).code, "liquid-floor");
  assert.equal(selfCallBroadcastGate({ env, liquidUsd: 30 }).ok, true);
});

test("HALT_NEW_ENTRIES refuses auto and operator buys by default", () => {
  const env = { HALT_NEW_ENTRIES: "yes" };
  assert.equal(buyBroadcastGate({ env, reason: "wave trough" }).ok, false);
  assert.equal(buyBroadcastGate({ env, reason: "MANUAL BUY (operator) $2.56" }).ok, false);
  assert.equal(
    buyBroadcastGate({ env: { ...env, ALLOW_OPERATOR_BUY_WHEN_HALTED: "yes" }, reason: "MANUAL BUY (operator) $2.56" }).ok,
    true,
  );
  assert.equal(
    buyBroadcastGate({ env: { ...env, ALLOW_OPERATOR_BUY_WHEN_HALTED: "yes" }, reason: "VITAFEED BUYIN" }).ok,
    false,
  );
  assert.equal(buyBroadcastGate({ env: { HALT_NEW_ENTRIES: "no" }, reason: "x" }).ok, true);
});

test("installed kill gate blocks data self-calls but passes other txs", async () => {
  const sent = [];
  const client = { evm: { sendTransaction: async (p) => { sent.push(p); return { transactionHash: "0xabc" }; } } };
  const env = { VITAFEED_PAID: "no", VITAFEED_FORCE: "yes" };
  installSelfCallKillGate(client, { env: () => env, log: () => {} });
  installSelfCallKillGate(client, { env: () => env, log: () => {} }); // idempotent
  await assert.rejects(
    client.evm.sendTransaction({ address: RISK, network: "base", transaction: { to: RISK.toLowerCase(), value: 0n, data: "0x5b564954" } }),
    /RISK_KILL_GATE/,
  );
  assert.equal(sent.length, 0);
  await client.evm.sendTransaction({ address: RISK, network: "base", transaction: { to: ROUTER, data: "0xa026383e" } });
  await client.evm.sendTransaction({ address: RISK, network: "base", transaction: { to: RISK, value: 1n, data: "0x" } });
  assert.equal(sent.length, 2);
  env.VITAFEED_PAID = "yes";
  await client.evm.sendTransaction({ address: RISK, network: "base", transaction: { to: RISK, data: "0x5b564954" } });
  assert.equal(sent.length, 3);
});

test("isBuySwapTx: WETH-in exactInputSingle is a buy; token-in is a sell", () => {
  assert.equal(isBuySwapTx({ transaction: { data: "0xa026383e" + WETH_WORD + HOME_WORD } }), true);
  assert.equal(isBuySwapTx({ transaction: { data: "0x04e45aaf" + WETH_WORD + HOME_WORD } }), true);
  assert.equal(isBuySwapTx({ transaction: { data: "0x04e45aaf" + HOME_WORD + WETH_WORD } }), false);
  assert.equal(isBuySwapTx({ transaction: { data: "0x5b564954" } }), false);
});

test("isBuySwapTx: Balancer Vault WETH→OLAS is a buy; OLAS→WETH is not", async () => {
  const { encodeBalancerVaultSwap, OLAS_TOKEN, balancerDeadline } = await import("./olas-balancer.js");
  const { BASE_WETH } = await import("./price-oracle.js");
  const buy = encodeBalancerVaultSwap({
    assetIn: BASE_WETH,
    assetOut: OLAS_TOKEN,
    amountIn: 1n,
    amountOutMinimum: 1n,
    sender: RISK,
    recipient: RISK,
    deadline: balancerDeadline(1_700_000_000_000),
  });
  assert.equal(isBuySwapTx({ transaction: { data: buy } }), true);
  const sell = encodeBalancerVaultSwap({
    assetIn: OLAS_TOKEN,
    assetOut: BASE_WETH,
    amountIn: 1n,
    amountOutMinimum: 1n,
    sender: RISK,
    recipient: RISK,
    deadline: balancerDeadline(1_700_000_000_000),
  });
  assert.equal(isBuySwapTx({ transaction: { data: sell } }), false);
});

test("prototype gate blocks halted buys + unpaid self-calls, passes sells", async () => {
  const sent = [];
  class FakeEvm { async sendTransaction(p) { sent.push(p); return { transactionHash: "0x1" }; } }
  const env = { HALT_NEW_ENTRIES: "yes", VITAFEED_PAID: "no" };
  assert.equal(installBroadcastKillGateOn(FakeEvm.prototype, { env: () => env, log: () => {} }), true);
  const evm = new FakeEvm();
  await assert.rejects(evm.sendTransaction({ address: RISK, transaction: { to: ROUTER, value: 623683706886772n, data: "0xa026383e" + WETH_WORD + HOME_WORD } }), /HALT_NEW_ENTRIES/);
  await assert.rejects(evm.sendTransaction({ address: RISK, transaction: { to: RISK, data: "0x5b564954" } }), /VITAFEED_PAID/);
  await evm.sendTransaction({ address: RISK, transaction: { to: ROUTER, data: "0xa026383e" + HOME_WORD + WETH_WORD } });
  assert.equal(sent.length, 1);
  env.ALLOW_OPERATOR_BUY_WHEN_HALTED = "yes";
  await evm.sendTransaction({ address: RISK, transaction: { to: ROUTER, data: "0xa026383e" + WETH_WORD + HOME_WORD } });
  assert.equal(sent.length, 2);
});
