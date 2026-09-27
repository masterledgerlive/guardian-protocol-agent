#!/usr/bin/env node
/**
 * VRR one-shot: (1) sell a SMALL HOME slice → ETH in the RISK wallet,
 * (2) write 1–2 VITA ROUTE REGISTRY door entries as 0-ETH self-calls,
 * (3) read back + verify against GitHub, (4) post-check nonce/HOME/vault.
 *
 * Standalone: does NOT load agent.js, does NOT flip VITAFEED_PAID /
 * HALT_NEW_ENTRIES, does NOT touch the vault. Recipient of every tx is the
 * RISK wallet itself (approve spender = Slipstream router, exact amount only).
 *
 * Usage:
 *   node scripts/vrr-live-oneshot.mjs --paper                 # encode/decode/verify vs GitHub
 *   node scripts/vrr-live-oneshot.mjs --quote                 # read-only HOME→ETH quote
 *   node scripts/vrr-live-oneshot.mjs --live                  # sell + registry writes (needs CDP_* env)
 *   node scripts/vrr-live-oneshot.mjs --verify 0xTX [0xTX]    # readback only
 * Env (live only, in-memory, never printed): CDP_API_KEY_ID, CDP_API_KEY_SECRET,
 *   CDP_WALLET_SECRET; optional BASE_RPC_URL. Tunables: VRR_TARGET_USD (default 3.5),
 *   VRR_MAX_SELL_USD (2.5), VRR_MAX_IMPACT_PCT (3), VRR_REGISTRY_COMMIT (40-hex).
 * Never invents tx hashes — every hash printed came back from the signer/RPC.
 */
import { readFileSync } from "fs";
import { createPublicClient, http, encodeFunctionData, parseAbi } from "viem";
import { base } from "viem/chains";
import {
  encodeEntry, decodeEntry, verifyDoorAgainstGithub, verifyRegistryTx, fetchGithubSha256,
} from "../vita-route-registry.js";
import { encodeSlipstreamExactInputSingle, SLIPSTREAM_SWAP_ROUTER, SLIPSTREAM_QUOTER_V2, HOME_SLIPSTREAM_TICK_SPACING } from "../aero-slipstream.js";
import { VERIFIED_HOME_ADDRESS } from "../operator-rotate.js";
import { BASE_WETH } from "../price-oracle.js";

const RISK = "0x50e1C4608c48b0c52E1EA5FBabc1c9126eA17915";
const VAULT_PREFIX = "0xcea0"; // vault never touched — asserted below
const RPC = process.env.BASE_RPC_URL || "https://mainnet.base.org";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const pub = createPublicClient({ chain: base, transport: http(RPC) });
const args = process.argv.slice(2);
const has = (f) => args.includes(f);

const LIVE_COMMIT = "a8fa3c1b750c39c68db36edf24bdf897175b10c0"; // live deploy branch head
const REG_COMMIT = process.env.VRR_REGISTRY_COMMIT || "9463d84a188a817fcd78bdcd13f29220d4a4beec"; // commit adding vita-route-registry.js

const quoterAbi = parseAbi([
  "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,int24 tickSpacing,uint160 sqrtPriceLimitX96)) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)",
]);
const erc20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
]);
const routerAbi = parseAbi([
  "function multicall(bytes[] data) payable returns (bytes[] results)",
  "function unwrapWETH9(uint256 amountMinimum,address recipient) payable",
]);

async function quote(tokenIn, tokenOut, amountIn, tickSpacing) {
  const { result } = await pub.simulateContract({
    address: SLIPSTREAM_QUOTER_V2, abi: quoterAbi, functionName: "quoteExactInputSingle",
    args: [{ tokenIn, tokenOut, amountIn, tickSpacing, sqrtPriceLimitX96: 0n }],
  });
  return result[0];
}

async function ethUsd() {
  const r = await fetch("https://api.coinbase.com/v2/prices/ETH-USD/spot");
  return Number((await r.json()).data.amount);
}

async function snapshot() {
  const [eth, home, weth, nonce] = await Promise.all([
    pub.getBalance({ address: RISK }),
    pub.readContract({ address: VERIFIED_HOME_ADDRESS, abi: erc20, functionName: "balanceOf", args: [RISK] }),
    pub.readContract({ address: BASE_WETH, abi: erc20, functionName: "balanceOf", args: [RISK] }),
    pub.getTransactionCount({ address: RISK }),
  ]);
  return { eth, home, weth, nonce };
}

function fmt(x, d = 18) { return (Number(x) / 10 ** d).toFixed(8); }

/** Size the HOME slice so ETH lands ≈ target USD; abort on impact/thin pool. */
async function planSell() {
  const px = await ethUsd();
  const s = await snapshot();
  const targetUsd = Number(process.env.VRR_TARGET_USD || 3.5);
  const maxSellUsd = Number(process.env.VRR_MAX_SELL_USD || 2.5);
  const maxImpact = Number(process.env.VRR_MAX_IMPACT_PCT || 3);
  const haveUsd = (Number(s.eth) / 1e18) * px;
  const needUsd = Math.min(maxSellUsd, Math.max(0, targetUsd - haveUsd));
  const probeIn = 10n ** 18n; // 1 HOME
  const probeOut = await quote(VERIFIED_HOME_ADDRESS, BASE_WETH, probeIn, HOME_SLIPSTREAM_TICK_SPACING);
  const spotEthPerHome = Number(probeOut) / 1e18;
  const homeUsd = spotEthPerHome * px;
  const homeNeeded = needUsd / homeUsd;
  const amountIn = BigInt(Math.floor(homeNeeded * 1e6)) * 10n ** 12n;
  const out = amountIn > 0n ? await quote(VERIFIED_HOME_ADDRESS, BASE_WETH, amountIn, HOME_SLIPSTREAM_TICK_SPACING) : 0n;
  const effEthPerHome = amountIn > 0n ? Number(out) / Number(amountIn) : 0;
  const impactPct = spotEthPerHome > 0 ? (1 - effEthPerHome / spotEthPerHome) * 100 : 100;
  const plan = {
    ethUsd: px, haveEth: fmt(s.eth), haveUsd: haveUsd.toFixed(3), homeBal: fmt(s.home), nonce: s.nonce,
    homeUsd: homeUsd.toFixed(6), needUsd: needUsd.toFixed(3), sellHome: fmt(amountIn),
    quoteWethOut: fmt(out), quoteUsdOut: ((Number(out) / 1e18) * px).toFixed(3),
    impactPct: impactPct.toFixed(3), maxImpact, amountIn, out,
  };
  plan.ok = amountIn > 0n && amountIn <= s.home && impactPct <= maxImpact && Number(out) > 0;
  plan.reason = plan.ok ? "ok" : amountIn === 0n ? "no sell needed" : impactPct > maxImpact ? "impact too high" : "thin/insufficient";
  return plan;
}

function doors(regCommit) {
  const live = (p) => readFileSync(new URL("../" + p, import.meta.url));
  const out = [];
  out.push({
    kind: "door", doorId: "wave-recall", name: "WAVE 28/28 Heraclitus reconstruct",
    desc: "join WAVE shard bodies from calldata; PASS iff sha256+LOC8 match answer key",
    commit: "0x" + LIVE_COMMIT, codePath: "vita/wave-full.js", testPath: "vita/wave-full.test.js",
    testResult: { pass: 14, total: 15 }, version: 1,
    _local: ["vita/wave-full.js", "vita/wave-full.test.js"].map(live),
  });
  if (regCommit) {
    out.push({
      kind: "door", doorId: "route-registry", name: "VITA route registry codec",
      desc: "encode/decode/verify VRR door+grade hex entries; self-ref door",
      commit: "0x" + regCommit, codePath: "vita-route-registry.js", testPath: "vita-route-registry.test.js",
      testResult: { pass: 9, total: 9 }, version: 1,
    });
  }
  return out;
}

async function fillHashes(d) {
  d.codeHash = await fetchGithubSha256(d.repo || "masterledgerlive/guardian-protocol-agent", d.commit, d.codePath);
  d.testHash = await fetchGithubSha256(d.repo || "masterledgerlive/guardian-protocol-agent", d.commit, d.testPath);
  delete d._local;
  return d;
}

async function paper() {
  const rows = [];
  for (const d of doors(REG_COMMIT)) {
    await fillHashes(d);
    const hex = encodeEntry(d);
    const dec = decodeEntry(hex);
    const gh = dec.ok ? await verifyDoorAgainstGithub(dec.entry) : null;
    rows.push({ doorId: d.doorId, bytes: (hex.length - 2) / 2, hex, decodeOk: dec.ok, codeHash: d.codeHash, testHash: d.testHash, github: gh });
  }
  return rows;
}

async function cdpClient() {
  for (const k of ["CDP_API_KEY_ID", "CDP_API_KEY_SECRET", "CDP_WALLET_SECRET"]) {
    if (!process.env[k]) throw new Error(`missing ${k} (live needs CDP creds in env)`);
  }
  const { CdpClient } = await import("@coinbase/cdp-sdk");
  return new CdpClient({
    apiKeyId: process.env.CDP_API_KEY_ID,
    apiKeySecret: process.env.CDP_API_KEY_SECRET.replace(/\\n/g, "\n"),
    walletSecret: process.env.CDP_WALLET_SECRET,
  });
}

async function send(cdp, transaction, label) {
  const to = String(transaction.to).toLowerCase();
  if (to.startsWith(VAULT_PREFIX)) throw new Error("vault target refused");
  const allowed = [RISK, SLIPSTREAM_SWAP_ROUTER, VERIFIED_HOME_ADDRESS].map((a) => a.toLowerCase());
  if (!allowed.includes(to)) throw new Error(`target ${to} not allowlisted`);
  if (BigInt(transaction.value ?? 0n) !== 0n) throw new Error("non-zero value refused");
  const { transactionHash } = await cdp.evm.sendTransaction({ address: RISK, network: "base", transaction: { ...transaction, value: 0n } });
  const rcpt = await pub.waitForTransactionReceipt({ hash: transactionHash, timeout: 120_000 });
  const tx = await pub.getTransaction({ hash: transactionHash });
  const gasCostWei = rcpt.gasUsed * rcpt.effectiveGasPrice + BigInt(rcpt.l1Fee ?? 0n);
  console.log(`✅ ${label}: ${transactionHash} status=${rcpt.status} gasUsed=${rcpt.gasUsed} costEth=${fmt(gasCostWei)} nonce=${tx.nonce}`);
  if (rcpt.status !== "success") throw new Error(`${label} reverted`);
  return { hash: transactionHash, rcpt, gasCostWei };
}

async function live() {
  const before = await snapshot();
  const plan = await planSell();
  console.log("plan", JSON.stringify(plan, (k, v) => (typeof v === "bigint" ? v.toString() : v)));
  const cdp = await cdpClient();
  const out = { before, txs: [] };
  if (plan.ok) {
    const minOut = (plan.out * 97n) / 100n; // 3% slippage floor
    out.txs.push(await send(cdp, { to: VERIFIED_HOME_ADDRESS, data: encodeFunctionData({ abi: erc20, functionName: "approve", args: [SLIPSTREAM_SWAP_ROUTER, plan.amountIn] }) }, "approve-exact"));
    const swap = encodeSlipstreamExactInputSingle({
      tokenIn: VERIFIED_HOME_ADDRESS, tokenOut: BASE_WETH, recipient: SLIPSTREAM_SWAP_ROUTER,
      amountIn: plan.amountIn, amountOutMinimum: minOut,
    });
    const unwrap = encodeFunctionData({ abi: routerAbi, functionName: "unwrapWETH9", args: [minOut, RISK] });
    const data = encodeFunctionData({ abi: routerAbi, functionName: "multicall", args: [[swap, unwrap]] });
    await pub.call({ account: RISK, to: SLIPSTREAM_SWAP_ROUTER, data }); // simulate first; throws on revert
    out.txs.push(await send(cdp, { to: SLIPSTREAM_SWAP_ROUTER, data }, "sell-home→eth"));
  } else if (plan.reason !== "no sell needed") {
    throw new Error("sell aborted: " + plan.reason);
  }
  const reg = [];
  for (const d of doors(REG_COMMIT).slice(0, 2)) {
    await fillHashes(d);
    const r = await send(cdp, { to: RISK, data: encodeEntry(d) }, "vrr-door:" + d.doorId);
    reg.push(r.hash); out.txs.push(r);
  }
  for (const h of reg) console.log("verify", JSON.stringify(await verifyRegistryTx(h, { rpcUrl: RPC, expectFrom: RISK })));
  const after = await snapshot();
  console.log("after", JSON.stringify({ eth: fmt(after.eth), home: fmt(after.home), weth: fmt(after.weth), nonce: after.nonce, nonceDelta: after.nonce - before.nonce, txs: out.txs.length }));
  await new Promise((r) => setTimeout(r, 20_000));
  const later = await snapshot();
  console.log("nonce-stable", later.nonce === after.nonce, later.nonce);
}

const bi = (k, v) => (typeof v === "bigint" ? v.toString() : v);
if (has("--paper")) console.log(JSON.stringify(await paper(), bi, 2));
else if (has("--quote")) console.log(JSON.stringify(await planSell(), bi, 2));
else if (has("--verify")) {
  for (const h of args.filter((a) => /^0x[0-9a-fA-F]{64}$/.test(a))) console.log(JSON.stringify(await verifyRegistryTx(h, { rpcUrl: RPC, expectFrom: RISK }), bi, 2));
} else if (has("--live")) await live();
else console.log("usage: --paper | --quote | --live | --verify 0xTX");
