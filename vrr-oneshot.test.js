import test from "node:test";
import assert from "node:assert/strict";
import {
  installBroadcastKillGateOn, armVrrOneshot, disarmVrrOneshot, vrrOneshotState,
  consumeVrrOneshot, isVrrSelfCall, _resetVrrOneshotForTests,
} from "./broadcast-kill-gate.js";
import { runVrrOneshot, buildAgentLeader, vrrOneshotDoors, VRR_RISK } from "./vrr-oneshot-runner.js";
import { decodeEntry, verifyOwnerReveal } from "./vita-route-registry.js";

const RISK = VRR_RISK;
const VRR = "0x56525202010000";
const gated = (env) => {
  const sent = [];
  const target = { sendTransaction: async (p) => { sent.push(p); return { transactionHash: "0x" + "1".repeat(64) }; } };
  installBroadcastKillGateOn(target, { env: () => env, log: () => {} });
  return { target, sent };
};
const self = (data, value = 0n) => ({ address: RISK, network: "base", transaction: { to: RISK, value, data } });

test("VRR exception: refused unless VRR_ONESHOT=yes AND armed", async () => {
  _resetVrrOneshotForTests();
  const env = { VITAFEED_PAID: "no", VRR_ONESHOT: "yes" };
  const { target, sent } = gated(env);
  await assert.rejects(target.sendTransaction(self(VRR)), /RISK_KILL_GATE/); // not armed
  assert.equal(armVrrOneshot({ env: { VRR_ONESHOT: "" } }), false);
  assert.equal(armVrrOneshot({ env, max: 3 }), true);
  await target.sendTransaction(self(VRR));
  assert.equal(sent.length, 1);
});

test("VRR exception: only VRR magic, zero value, self-call; max 3 then latch", async () => {
  _resetVrrOneshotForTests();
  const env = { VITAFEED_PAID: "no", HALT_NEW_ENTRIES: "yes", VRR_ONESHOT: "yes" };
  const { target, sent } = gated(env);
  armVrrOneshot({ env, max: 99 }); // clamps to 3
  await assert.rejects(target.sendTransaction(self("0x5b564954")), /RISK_KILL_GATE/); // vitafeed still blocked
  await assert.rejects(target.sendTransaction(self(VRR, 1n)), /RISK_KILL_GATE/);     // value refused
  for (let i = 0; i < 3; i++) await target.sendTransaction(self(VRR));
  await assert.rejects(target.sendTransaction(self(VRR)), /RISK_KILL_GATE/);          // 4th refused
  assert.equal(sent.length, 3);
  assert.equal(vrrOneshotState().spent, true);
  assert.equal(armVrrOneshot({ env }), false); // cannot re-arm in-process
});

test("VRR exception: clearing VRR_ONESHOT mid-run refuses immediately", async () => {
  _resetVrrOneshotForTests();
  const env = { VITAFEED_PAID: "no", VRR_ONESHOT: "yes" };
  const { target } = gated(env);
  armVrrOneshot({ env });
  env.VRR_ONESHOT = "";
  await assert.rejects(target.sendTransaction(self(VRR)), /RISK_KILL_GATE/);
  disarmVrrOneshot();
});

test("VRR exception never enables BUY under HALT", async () => {
  _resetVrrOneshotForTests();
  const env = { HALT_NEW_ENTRIES: "yes", VRR_ONESHOT: "yes" };
  const { target } = gated(env);
  armVrrOneshot({ env });
  const WETH_WORD = "0000000000000000000000004200000000000000000000000000000000000006";
  await assert.rejects(target.sendTransaction({ address: RISK, transaction: { to: "0xBE6D8f0d05cC4be24d5167a3eF062215bE6D18a5", data: "0xa026383e" + WETH_WORD } }), /RISK_KILL_GATE/);
  assert.equal(isVrrSelfCall({ address: RISK, transaction: { to: "0x" + "9".repeat(40), data: VRR } }), false);
  assert.equal(consumeVrrOneshot(self("0x1234"), env), false);
  disarmVrrOneshot();
});

test("runner skips without VRR_ONESHOT / wrong nonce / bad secret (no sends)", async () => {
  _resetVrrOneshotForTests();
  let sends = 0;
  const cdp = { evm: { sendTransaction: async () => { sends++; } } };
  const pub = { getTransactionCount: async () => 6378 };
  assert.equal((await runVrrOneshot({ env: {}, cdp, pub, log: () => {} })).skipped, true);
  const r = await runVrrOneshot({ env: { VRR_ONESHOT: "yes", VRR_ONESHOT_NONCE: "6377" }, cdp, pub, log: () => {} });
  assert.match(r.reason, /nonce/);
  assert.equal(r.latch.spent, true);
  _resetVrrOneshotForTests();
  const r2 = await runVrrOneshot({ env: { VRR_ONESHOT: "yes", VRR_ONESHOT_NONCE: "6378" }, cdp, pub, log: () => {} });
  assert.match(r2.reason, /secret/);
  assert.equal(sends, 0);
});

test("agent leader entry commits owner without revealing secret", () => {
  const secret = "ab".repeat(32);
  const hex = (() => { const e = buildAgentLeader({ secret, links: ["0x" + "11".repeat(32)] }); return e; })();
  assert.equal(hex.agentName, "storage-token");
  assert.equal(verifyOwnerReveal({ ...hex, chainId: 8453 }, Buffer.from(secret, "hex")), true);
  assert.equal(vrrOneshotDoors().length, 2);
});

test("real CdpClient via preload: VRR exception reaches the prototype gate, other self-calls still refused", async () => {
  _resetVrrOneshotForTests();
  const prev = { ...process.env };
  process.env.VITAFEED_PAID = "no";
  process.env.VRR_ONESHOT = "";
  await import("./broadcast-kill-gate-preload.js");
  const { CdpClient } = await import("@coinbase/cdp-sdk");
  const c = new CdpClient({ apiKeyId: "x", apiKeySecret: "y", walletSecret: "z" });
  await assert.rejects(c.evm.sendTransaction(self("0x5b564954")), /RISK_KILL_GATE/);
  await assert.rejects(c.evm.sendTransaction(self(VRR)), /RISK_KILL_GATE/); // not armed
  process.env.VRR_ONESHOT = "yes";
  armVrrOneshot({ env: process.env, max: 1 });
  // Passes the gate → reaches the SDK, which fails on fake creds (NOT the kill gate).
  await assert.rejects(c.evm.sendTransaction(self(VRR)), (e) => !/RISK_KILL_GATE/.test(e.message));
  await assert.rejects(c.evm.sendTransaction(self(VRR)), /RISK_KILL_GATE/); // latch spent
  await assert.rejects(c.evm.sendTransaction(self("0x5b564954")), /RISK_KILL_GATE/);
  process.env = prev;
});
