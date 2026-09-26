/**
 * One-shot V3 → V4 ETH fund transfer (CDP RISK wallet → dedicated V4 address).
 * Latch on disk so restarts do not re-send. Never touches piggy/vault.
 */

import fs from "node:fs";
import path from "node:path";
import { parseEther } from "viem";
import {
  fundSplitEnvFromProcess,
  looksLikeEthAddress,
  planV4FundSplit,
  readFundLatch,
  writeFundLatch,
} from "./guardian-v4/fund-split.js";

const DEFAULT_LATCH = path.join(process.cwd(), "guardian-v4", "state", "v3-fund-once.latch.json");

/**
 * @param {{
 *   cdp: any,
 *   fromAddress: string,
 *   getNativeEth: () => Promise<number>,
 *   getWethEth?: () => Promise<number>,
 *   ethUsd?: number,
 *   latchPath?: string,
 *   envObj?: NodeJS.ProcessEnv,
 *   log?: (...args: any[]) => void,
 *   tg?: (html: string) => Promise<any>,
 * }} opts
 */
export async function maybeFundV4FromV3({
  cdp,
  fromAddress,
  getNativeEth,
  getWethEth = async () => 0,
  ethUsd = 2500,
  latchPath = DEFAULT_LATCH,
  envObj = process.env,
  log = console.log,
  tg = null,
} = {}) {
  const cfg = fundSplitEnvFromProcess(envObj);
  if (!cfg.to) {
    return { sent: false, reason: "no-GUARDIAN_V4_FUND_TO" };
  }
  if (!looksLikeEthAddress(fromAddress)) {
    return { sent: false, reason: "bad-from" };
  }
  if (cfg.to.toLowerCase() === fromAddress.toLowerCase()) {
    return { sent: false, reason: "refuse-self-fund" };
  }

  const latch = readFundLatch(latchPath);
  if (cfg.once && latch?.ok && latch?.hash) {
    log(`[v4-fund] latch hit — already funded ${latch.amountEth} ETH → ${latch.to} (${latch.hash})`);
    return { sent: false, reason: "latched", latch };
  }

  const native = await getNativeEth();
  const weth = await getWethEth();
  const plan = planV4FundSplit({
    v3NativeEth: native,
    v3WethEth: weth,
    splitEth: cfg.amountEth,
    keepGasEth: cfg.keepGasEth,
    ethUsd,
  });
  if (!plan.ok) {
    log(`[v4-fund] skip: ${plan.reason}`);
    if (tg) {
      await tg(
        `🏁 <b>V4 FUND SKIP</b>\n${plan.reason}\n` +
          `native ${plan.v3NativeEth.toFixed(6)} ETH · keep ${plan.keepGasEth.toFixed(6)}`,
      ).catch(() => {});
    }
    return { sent: false, reason: plan.reason, plan };
  }

  if (!cdp?.evm?.sendTransaction) {
    return { sent: false, reason: "no-cdp", plan };
  }

  const value = parseEther(plan.amountEth.toFixed(18));
  log(`[v4-fund] sending ${plan.amountEth.toFixed(6)} ETH → ${cfg.to}`);
  const result = await cdp.evm.sendTransaction({
    address: fromAddress,
    network: "base",
    transaction: {
      to: cfg.to,
      value,
      data: "0x",
    },
  });
  const hash = result?.transactionHash || result?.hash || result;
  const saved = writeFundLatch({
    ok: true,
    to: cfg.to,
    from: fromAddress,
    amountEth: plan.amountEth,
    hash: String(hash),
    plan,
  }, latchPath);
  log(`[v4-fund] sent ${hash}`);
  if (tg) {
    await tg(
      `🏁 <b>V4 FUND SPLIT</b>\n` +
        `${plan.amountEth.toFixed(6)} ETH (~$${plan.amountUsd.toFixed(2)}) → <code>${cfg.to}</code>\n` +
        `tx <code>${hash}</code>\n` +
        `V3 left ~${plan.v3AfterEth.toFixed(6)} ETH (gas keep ${plan.keepGasEth.toFixed(6)})`,
    ).catch(() => {});
  }
  return { sent: true, hash: String(hash), plan, latch: saved };
}

/** Ensure latch dir exists without importing V4 agent. */
export function ensureFundLatchDir(latchPath = DEFAULT_LATCH) {
  fs.mkdirSync(path.dirname(latchPath), { recursive: true });
}
