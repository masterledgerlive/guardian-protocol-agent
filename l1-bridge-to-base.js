/**
 * One-shot Ethereum L1 → Base ETH bridge for RISK wallet.
 *
 * Uses Official Base OptimismPortal.depositTransaction (same address credit).
 * Env: OPERATOR_BRIDGE_L1_TO_BASE=yes
 * Latch on disk so restarts do not re-bridge. Never invents tx hashes.
 * Does not mix into Base SwapRouter until credited on Base (other-path override
 * is explicit operator bridge only).
 */

import fs from "node:fs";
import path from "node:path";
import { encodeFunctionData, parseAbi, formatEther } from "viem";

/** Base L1 OptimismPortal — https://docs.base.org/base-chain/network-information/base-contracts */
export const BASE_L1_OPTIMISM_PORTAL = "0x49048044D57e1C92A77f79988d21Fa8fAF74E97e";

export const DEPOSIT_TX_ABI = parseAbi([
  "function depositTransaction(address _to, uint256 _value, uint64 _gasLimit, bool _isCreation, bytes _data) payable",
]);

/** L2 gas limit for the deposited transaction (plain ETH credit). */
export const L2_DEPOSIT_GAS_LIMIT = 100_000n;

const DEFAULT_LATCH = path.join(process.cwd(), "vita", "state", "l1-bridge-to-base.latch.json");

const ETH_RPC_DEFAULTS = Object.freeze([
  "https://ethereum.publicnode.com",
  "https://eth.drpc.org",
  "https://cloudflare-eth.com",
]);

export function isOperatorBridgeL1ToBaseArmed(env = process.env) {
  const v = String(env.OPERATOR_BRIDGE_L1_TO_BASE || "").trim().toLowerCase();
  return v === "yes" || v === "1" || v === "true";
}

export function encodePortalDepositEth({ to, valueWei, l2GasLimit = L2_DEPOSIT_GAS_LIMIT }) {
  return encodeFunctionData({
    abi: DEPOSIT_TX_ABI,
    functionName: "depositTransaction",
    args: [to, valueWei, l2GasLimit, false, "0x"],
  });
}

/**
 * Size deposit: leave headroom for L1 gas (estimate × buffer).
 * @returns {{ ok: boolean, depositWei: bigint, gasEst: bigint, gasReserveWei: bigint, balWei: bigint, reason?: string }}
 */
export function planL1EthDeposit({
  balWei,
  gasEst,
  gasPriceWei,
  gasBufferMult = 1.5,
  minDepositWei = 50_000_000_000_000n, // 0.00005 ETH (~$0.13)
} = {}) {
  const bal = BigInt(balWei || 0n);
  const gas = BigInt(gasEst || 0n);
  const price = BigInt(gasPriceWei || 0n);
  if (bal <= 0n) return { ok: false, depositWei: 0n, gasEst: gas, gasReserveWei: 0n, balWei: bal, reason: "empty-l1" };
  if (gas <= 0n || price <= 0n) {
    return { ok: false, depositWei: 0n, gasEst: gas, gasReserveWei: 0n, balWei: bal, reason: "no-gas-quote" };
  }
  const mult = Math.max(1.1, Number(gasBufferMult) || 1.5);
  const numer = BigInt(Math.round(mult * 1000));
  const gasReserveWei = (gas * price * numer) / 1000n;
  if (bal <= gasReserveWei + BigInt(minDepositWei)) {
    return {
      ok: false,
      depositWei: 0n,
      gasEst: gas,
      gasReserveWei,
      balWei: bal,
      reason: `l1-too-thin bal=${formatEther(bal)} reserve=${formatEther(gasReserveWei)}`,
    };
  }
  const depositWei = bal - gasReserveWei;
  return { ok: true, depositWei, gasEst: gas, gasReserveWei, balWei: bal };
}

export function readBridgeLatch(latchPath = DEFAULT_LATCH) {
  try {
    if (!fs.existsSync(latchPath)) return null;
    return JSON.parse(fs.readFileSync(latchPath, "utf8"));
  } catch {
    return null;
  }
}

export function writeBridgeLatch(payload, latchPath = DEFAULT_LATCH) {
  fs.mkdirSync(path.dirname(latchPath), { recursive: true });
  const body = { ...payload, at: payload?.at || new Date().toISOString() };
  fs.writeFileSync(latchPath, JSON.stringify(body, null, 2));
  return body;
}

async function rpcCall(url, method, params, fetchImpl = fetch) {
  const r = await fetchImpl(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 (compatible; GuardianBot/1.0)",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(15_000),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || JSON.stringify(j.error));
  return j.result;
}

export async function ethRpc(method, params, {
  rpcs = ETH_RPC_DEFAULTS,
  fetchImpl = fetch,
} = {}) {
  let lastErr;
  for (const url of rpcs) {
    try {
      return await rpcCall(url, method, params, fetchImpl);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("eth-rpc-exhausted");
}

/**
 * @param {{
 *   cdp: any,
 *   fromAddress: string,
 *   latchPath?: string,
 *   envObj?: NodeJS.ProcessEnv,
 *   ethUsd?: number,
 *   log?: (...a:any[])=>void,
 *   tg?: (html:string)=>Promise<any>,
 *   ethRpcFn?: typeof ethRpc,
 *   waitForBaseMs?: number,
 *   getBaseNativeEth?: ()=>Promise<number>,
 * }} opts
 */
export async function maybeBridgeL1EthToBase({
  cdp,
  fromAddress,
  latchPath = DEFAULT_LATCH,
  envObj = process.env,
  ethUsd = 2500,
  log = console.log,
  tg = null,
  ethRpcFn = ethRpc,
  waitForBaseMs = 0,
  getBaseNativeEth = null,
} = {}) {
  if (!isOperatorBridgeL1ToBaseArmed(envObj)) {
    return { sent: false, reason: "not-armed" };
  }
  if (!fromAddress || !/^0x[a-fA-F0-9]{40}$/.test(fromAddress)) {
    return { sent: false, reason: "bad-from" };
  }
  const latch = readBridgeLatch(latchPath);
  if (latch?.ok && latch?.hash) {
    log(`[l1-bridge] latch hit — already bridged ${latch.depositEth} ETH (${latch.hash})`);
    return { sent: false, reason: "latched", latch };
  }
  if (!cdp?.evm?.sendTransaction) {
    return { sent: false, reason: "no-cdp" };
  }

  const balHex = await ethRpcFn("eth_getBalance", [fromAddress, "latest"]);
  const balWei = BigInt(balHex);
  const gasPriceWei = BigInt(await ethRpcFn("eth_gasPrice", []));

  // Estimate with a provisional deposit (most of balance) then re-plan.
  const provisional = balWei > 0n ? (balWei * 85n) / 100n : 0n;
  if (provisional <= 0n) {
    log("[l1-bridge] skip: empty L1 ETH");
    return { sent: false, reason: "empty-l1", balWei };
  }
  const data = encodePortalDepositEth({ to: fromAddress, valueWei: provisional });
  const gasHex = await ethRpcFn("eth_estimateGas", [{
    from: fromAddress,
    to: BASE_L1_OPTIMISM_PORTAL,
    value: "0x" + provisional.toString(16),
    data,
  }]);
  const gasEst = BigInt(gasHex);
  const plan = planL1EthDeposit({ balWei, gasEst, gasPriceWei });
  if (!plan.ok) {
    log(`[l1-bridge] skip: ${plan.reason}`);
    if (tg) {
      await tg(
        `🌉 <b>L1→BASE BRIDGE SKIP</b>\n<code>${plan.reason}</code>\n` +
          `L1 bal ${formatEther(balWei)} ETH`,
      ).catch(() => {});
    }
    return { sent: false, reason: plan.reason, plan };
  }

  const finalData = encodePortalDepositEth({ to: fromAddress, valueWei: plan.depositWei });
  const depositEth = Number(formatEther(plan.depositWei));
  const usd = depositEth * (Number(ethUsd) > 0 ? Number(ethUsd) : 2500);
  log(
    `[l1-bridge] depositing ${depositEth.toFixed(6)} ETH (~$${usd.toFixed(2)}) ` +
      `via OptimismPortal → Base (same address)`,
  );

  const result = await cdp.evm.sendTransaction({
    address: fromAddress,
    network: "ethereum",
    transaction: {
      to: BASE_L1_OPTIMISM_PORTAL,
      value: plan.depositWei,
      data: finalData,
    },
  });
  const hash = result?.transactionHash || result?.hash || null;
  if (!hash || typeof hash !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(hash)) {
    log(`[l1-bridge] send returned no hash — not latching`);
    return { sent: false, reason: "no-hash", plan, raw: result };
  }

  const saved = writeBridgeLatch({
    ok: true,
    hash,
    from: fromAddress,
    portal: BASE_L1_OPTIMISM_PORTAL,
    depositEth,
    depositWei: plan.depositWei.toString(),
    gasEst: plan.gasEst.toString(),
    gasReserveWei: plan.gasReserveWei.toString(),
    ethUsd: Number(ethUsd) || null,
  }, latchPath);

  log(`[l1-bridge] sent ${hash}`);
  if (tg) {
    await tg(
      `🌉 <b>L1→BASE ETH BRIDGE</b>\n` +
        `${depositEth.toFixed(6)} ETH (~$${usd.toFixed(2)}) → Base RISK\n` +
        `portal <code>${BASE_L1_OPTIMISM_PORTAL}</code>\n` +
        `tx <code>${hash}</code>\n` +
        `etherscan.io/tx/${hash}`,
    ).catch(() => {});
  }

  let baseCredited = null;
  if (waitForBaseMs > 0 && typeof getBaseNativeEth === "function") {
    const deadline = Date.now() + waitForBaseMs;
    const before = await getBaseNativeEth().catch(() => null);
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 15_000));
      const now = await getBaseNativeEth().catch(() => null);
      if (before != null && now != null && now > before + depositEth * 0.5) {
        baseCredited = now;
        log(`[l1-bridge] Base credit seen: ${now.toFixed(6)} ETH (was ${Number(before).toFixed(6)})`);
        break;
      }
    }
    if (baseCredited == null) {
      log(`[l1-bridge] Base credit not observed within ${waitForBaseMs}ms — buy may retry later`);
    }
  }

  return { sent: true, hash, plan, latch: saved, depositEth, baseCredited };
}
