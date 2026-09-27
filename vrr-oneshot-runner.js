/**
 * VRR ONE-SHOT boot runner (VITA ROUTE REGISTRY live test, Game-directed 2026-09-26).
 *
 * Runs ONCE at boot, before any trading path, only when ALL hold:
 *   VRR_ONESHOT=yes  AND  RISK nonce === VRR_ONESHOT_NONCE (exact; re-boot after
 *   the first tx can never re-run)  AND  the in-process latch is unspent.
 * Does exactly:
 *   1) approve EXACT HOME amount → Aerodrome Slipstream router
 *   2) HOME→WETH exactInputSingle (recipient router) + unwrapWETH9 → RISK
 *      (fixed amount ≤ VRR_ONESHOT_MAX_HOME; abort if impact > 3%; 3% min-out)
 *   3) ≤ 3 zero-value RISK self-calls with VRR calldata (0x565252…)
 * Allowlist: to ∈ {RISK, HOME, router}; value always 0; vault never.
 * Gas budget: non-swap gas ≤ VRR_ONESHOT_MAX_GAS_USD (default 0.10) or abort.
 * VITAFEED_PAID / HALT_NEW_ENTRIES are not read or changed. Latch disarms in finally.
 * Owner secret is read from env and NEVER logged.
 */
import { createPublicClient, http, encodeFunctionData, parseAbi } from "viem";
import { base } from "viem/chains";
import {
  encodeEntry, fetchGithubSha256, ownerCommitment, verifyRegistryTx,
  VRR_ROLE, VRR_VIS, VRR_CHAIN_BASE,
} from "./vita-route-registry.js";
import {
  armVrrOneshot, disarmVrrOneshot, vrrOneshotState, envYes,
} from "./broadcast-kill-gate.js";
import {
  encodeSlipstreamExactInputSingle, SLIPSTREAM_SWAP_ROUTER, SLIPSTREAM_QUOTER_V2,
  HOME_SLIPSTREAM_TICK_SPACING,
} from "./aero-slipstream.js";
import { VERIFIED_HOME_ADDRESS } from "./operator-rotate.js";
import { BASE_WETH } from "./price-oracle.js";

export const VRR_RISK = "0x50e1C4608c48b0c52E1EA5FBabc1c9126eA17915";
export const VRR_REPO = "masterledgerlive/guardian-protocol-agent";
export const VRR_LIVE_COMMIT = "a8fa3c1b750c39c68db36edf24bdf897175b10c0";
export const VRR_CODEC_COMMIT = "72b60a9b97c2d1ba076ab50ce09782c772d7f88c";
export const VRR_ONESHOT_HARD_MAX_HOME = 320;
const VAULT_PREFIX = "0xcea0";

const quoterAbi = parseAbi([
  "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,int24 tickSpacing,uint160 sqrtPriceLimitX96)) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)",
]);
const erc20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
]);
const routerAbi = parseAbi([
  "function multicall(bytes[] data) payable returns (bytes[] results)",
  "function unwrapWETH9(uint256 amountMinimum,address recipient) payable",
]);

export function vrrOneshotRequested(env = process.env) {
  return envYes(env?.VRR_ONESHOT);
}

/** Door + agent entry specs (hashes filled from GitHub at pinned commits). */
export function vrrOneshotDoors() {
  return [
    {
      kind: "door", doorId: "wave-recall", name: "WAVE 28/28 Heraclitus reconstruct",
      desc: "join WAVE shard bodies from calldata; PASS iff sha256+LOC8 match answer key",
      commit: "0x" + VRR_LIVE_COMMIT, codePath: "vita/wave-full.js", testPath: "vita/wave-full.test.js",
      testResult: { pass: 14, total: 15 }, version: 1, visibility: VRR_VIS.PLAIN, chainId: VRR_CHAIN_BASE,
    },
    {
      kind: "door", doorId: "route-registry", name: "VITA route registry codec v2",
      desc: "encode/decode/verify VRR door/grade/agent hex entries; self-ref door",
      commit: "0x" + VRR_CODEC_COMMIT, codePath: "vita-route-registry.js", testPath: "vita-route-registry.test.js",
      testResult: { pass: 17, total: 17 }, version: 2, visibility: VRR_VIS.PLAIN, chainId: VRR_CHAIN_BASE,
    },
  ];
}

export function buildAgentLeader({ secret, links = [] }) {
  return {
    kind: "agent", agentName: "storage-token", role: VRR_ROLE.LEADER, visibility: VRR_VIS.PLAIN,
    chainId: VRR_CHAIN_BASE, desc: "StorageToken agent directory leader",
    ownerCommit: ownerCommitment(Buffer.from(String(secret).replace(/^0x/, ""), "hex"), "storage-token", VRR_CHAIN_BASE),
    links,
  };
}

function assertAllowed(tx) {
  const to = String(tx.to || "").toLowerCase();
  if (to.startsWith(VAULT_PREFIX)) throw new Error("VRR_ONESHOT: vault target refused");
  const ok = [VRR_RISK, VERIFIED_HOME_ADDRESS, SLIPSTREAM_SWAP_ROUTER].map((a) => a.toLowerCase());
  if (!ok.includes(to)) throw new Error(`VRR_ONESHOT: target ${to} not allowlisted`);
  if (BigInt(tx.value ?? 0n) !== 0n) throw new Error("VRR_ONESHOT: non-zero value refused");
}

export async function runVrrOneshot({
  env = process.env, cdp, log = console.log, ethUsd = null,
  pub = createPublicClient({ chain: base, transport: http(env.VRR_ONESHOT_RPC || "https://mainnet.base.org") }),
  fetchImpl = fetch,
} = {}) {
  if (!vrrOneshotRequested(env)) return { skipped: true, reason: "VRR_ONESHOT not yes" };
  const res = { txs: [], vrr: [], verify: [] };
  const fmt = (x) => (Number(x) / 1e18).toFixed(9);
  try {
    if (!cdp?.evm?.sendTransaction) return Object.assign(res, { skipped: true, reason: "no cdp client" });
    const wantNonce = Number(env.VRR_ONESHOT_NONCE);
    const nonce0 = await pub.getTransactionCount({ address: VRR_RISK });
    if (!Number.isInteger(wantNonce) || nonce0 !== wantNonce) {
      return Object.assign(res, { skipped: true, reason: `nonce ${nonce0} != VRR_ONESHOT_NONCE ${env.VRR_ONESHOT_NONCE} — already ran or unset` });
    }
    const secret = String(env.VRR_OWNER_SECRET_STORAGE_TOKEN || "");
    if (!/^(0x)?[0-9a-fA-F]{64}$/.test(secret)) return Object.assign(res, { skipped: true, reason: "owner secret missing/invalid" });
    let px = Number(ethUsd);
    if (!(px > 0)) {
      try { px = Number((await (await fetchImpl("https://api.coinbase.com/v2/prices/ETH-USD/spot")).json()).data.amount); } catch { px = 0; }
    }
    if (!(px > 500)) return Object.assign(res, { skipped: true, reason: "no ETH/USD mark" });
    const maxGasUsd = Number(env.VRR_ONESHOT_MAX_GAS_USD || 0.10);
    const maxHome = Math.min(VRR_ONESHOT_HARD_MAX_HOME, Number(env.VRR_ONESHOT_MAX_HOME || 310));
    const sellHome = Number(env.VRR_ONESHOT_SELL_HOME || 0);
    if (!(sellHome > 0 && sellHome <= maxHome)) return Object.assign(res, { skipped: true, reason: `sell HOME ${sellHome} outside (0, ${maxHome}]` });
    const amountIn = BigInt(Math.round(sellHome * 1e6)) * 10n ** 12n;
    const homeBal = await pub.readContract({ address: VERIFIED_HOME_ADDRESS, abi: erc20, functionName: "balanceOf", args: [VRR_RISK] });
    if (amountIn > homeBal) return Object.assign(res, { skipped: true, reason: "HOME balance too low" });

    // Build + verify entries BEFORE any send (GitHub hashes at pinned commits).
    const doors = vrrOneshotDoors();
    for (const d of doors) {
      d.codeHash = await fetchGithubSha256(VRR_REPO, d.commit, d.codePath, fetchImpl);
      d.testHash = await fetchGithubSha256(VRR_REPO, d.commit, d.testPath, fetchImpl);
      encodeEntry(d); // throws if malformed
    }
    buildAgentLeader({ secret, links: ["0x" + "00".repeat(32)] }); // validate shape early

    // Quote + impact.
    const q = async (a) => (await pub.simulateContract({
      address: SLIPSTREAM_QUOTER_V2, abi: quoterAbi, functionName: "quoteExactInputSingle",
      args: [{ tokenIn: VERIFIED_HOME_ADDRESS, tokenOut: BASE_WETH, amountIn: a, tickSpacing: HOME_SLIPSTREAM_TICK_SPACING, sqrtPriceLimitX96: 0n }],
    })).result[0];
    const probe = await q(10n ** 18n);
    const out = await q(amountIn);
    const impactPct = (1 - (Number(out) / Number(amountIn)) / (Number(probe) / 1e18)) * 100;
    log(`🧭 VRR_ONESHOT quote: sell ${sellHome} HOME → ${fmt(out)} WETH (~$${((Number(out) / 1e18) * px).toFixed(3)}) impact ${impactPct.toFixed(3)}% nonce=${nonce0}`);
    if (!(impactPct <= 3) || out <= 0n) throw new Error(`impact ${impactPct.toFixed(3)}% > 3% or no liquidity — abort`);

    armVrrOneshot({ env, max: 3 });
    let nonSwapGasWei = 0n;
    const gasCapWei = BigInt(Math.floor((maxGasUsd / px) * 1e18));
    const send = async (transaction, label, isSwap = false) => {
      assertAllowed(transaction);
      const { transactionHash } = await cdp.evm.sendTransaction({
        address: VRR_RISK, network: "base", transaction: { ...transaction, value: 0n },
      });
      const r = await pub.waitForTransactionReceipt({ hash: transactionHash, timeout: 120_000 });
      const cost = r.gasUsed * r.effectiveGasPrice + BigInt(r.l1Fee ?? 0n);
      if (!isSwap) nonSwapGasWei += cost;
      const row = { label, hash: transactionHash, status: r.status, gasUsed: r.gasUsed.toString(), costEth: fmt(cost), block: Number(r.blockNumber) };
      res.txs.push(row);
      log(`✅ VRR_ONESHOT ${label}: ${transactionHash} status=${r.status} gas=${r.gasUsed} cost=${fmt(cost)} ETH`);
      if (r.status !== "success") throw new Error(`${label} reverted`);
      if (nonSwapGasWei > gasCapWei) throw new Error(`gas budget exceeded (${fmt(nonSwapGasWei)} ETH > $${maxGasUsd})`);
      return transactionHash;
    };

    const minOut = (out * 97n) / 100n;
    await send({ to: VERIFIED_HOME_ADDRESS, data: encodeFunctionData({ abi: erc20, functionName: "approve", args: [SLIPSTREAM_SWAP_ROUTER, amountIn] }) }, "approve-exact-home");
    const swap = encodeSlipstreamExactInputSingle({
      tokenIn: VERIFIED_HOME_ADDRESS, tokenOut: BASE_WETH, recipient: SLIPSTREAM_SWAP_ROUTER, amountIn, amountOutMinimum: minOut,
    });
    const unwrap = encodeFunctionData({ abi: routerAbi, functionName: "unwrapWETH9", args: [minOut, VRR_RISK] });
    const data = encodeFunctionData({ abi: routerAbi, functionName: "multicall", args: [[swap, unwrap]] });
    let simErr = null;
    for (let i = 0; i < 6; i++) { // public RPC may lag the approve receipt
      try { await pub.call({ account: VRR_RISK, to: SLIPSTREAM_SWAP_ROUTER, data }); simErr = null; break; }
      catch (e) { simErr = e; await new Promise((r) => setTimeout(r, 3000)); }
    }
    if (simErr) throw new Error("swap simulation reverted: " + (simErr.shortMessage || simErr.message));
    const ethBefore = await pub.getBalance({ address: VRR_RISK });
    const sellHash = await send({ to: SLIPSTREAM_SWAP_ROUTER, data }, "sell-home-to-eth", true);
    const ethAfter = await pub.getBalance({ address: VRR_RISK });
    res.sell = { hash: sellHash, homeSold: sellHome, quotedWethOut: fmt(out), minOut: fmt(minOut), ethDeltaNetOfGas: fmt(ethAfter - ethBefore) };

    for (const d of doors) res.vrr.push(await send({ to: VRR_RISK, data: encodeEntry(d) }, "vrr-door:" + d.doorId));
    const leader = buildAgentLeader({ secret, links: [...res.vrr] });
    res.vrr.push(await send({ to: VRR_RISK, data: encodeEntry(leader) }, "vrr-agent:storage-token"));

    for (const h of res.vrr) {
      const v = await verifyRegistryTx(h, { expectFrom: VRR_RISK, fetchImpl });
      res.verify.push({ hash: h, ok: v.ok, kind: v.entry?.kind, id: v.entry?.doorId || v.entry?.agentName, github: v.github });
      log(`🔎 VRR_ONESHOT verify ${h}: ok=${v.ok} kind=${v.entry?.kind} id=${v.entry?.doorId || v.entry?.agentName}`);
    }
    res.nonceAfter = await pub.getTransactionCount({ address: VRR_RISK });
    res.ok = true;
    return res;
  } catch (e) {
    res.ok = false;
    res.error = e?.message || String(e);
    log(`🛑 VRR_ONESHOT aborted: ${res.error}`);
    return res;
  } finally {
    disarmVrrOneshot();
    res.latch = vrrOneshotState();
    log(`🔒 VRR_ONESHOT latch disarmed (spent=${res.latch.spent}, used=${res.latch.used}) — clear VRR_ONESHOT now`);
  }
}
