/**
 * Capital split plan: move liquid ETH from V3 RISK wallet into a dedicated
 * Guardian V4 hot wallet without draining V3 gas continuity.
 *
 * Does not invent P&L. Does not touch piggy / vault. Pure sizing math + latch.
 */

import fs from "node:fs";
import path from "node:path";
import { STATE_DIR, env } from "./config.js";

export const FUND_LATCH = path.join(STATE_DIR, "fund-split.latch.json");

/** Reject vault inscription hashes mistaken for Telegram bot tokens / keys. */
export function looksLikeTxHash(value) {
  return /^0x[a-fA-F0-9]{64}$/.test(String(value ?? "").trim());
}

export function looksLikeEthAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value ?? "").trim());
}

/**
 * Plan how much ETH to send to V4 from V3 liquid native.
 *
 * @param {{
 *   v3NativeEth?: number,
 *   v3WethEth?: number,
 *   splitEth?: number|null,
 *   keepGasEth?: number,
 *   minSplitEth?: number,
 *   maxSplitEth?: number,
 *   ethUsd?: number,
 * }} opts
 */
export function planV4FundSplit({
  v3NativeEth = 0,
  v3WethEth = 0,
  splitEth = null,
  keepGasEth = 0.0008,
  minSplitEth = 0.0008,
  maxSplitEth = 0.002,
  ethUsd = 2500,
} = {}) {
  const native = Math.max(0, Number(v3NativeEth) || 0);
  const weth = Math.max(0, Number(v3WethEth) || 0);
  const keep = Math.max(0, Number(keepGasEth) || 0);
  const minS = Math.max(0, Number(minSplitEth) || 0);
  const maxS = Math.max(minS, Number(maxSplitEth) || minS);
  const usd = Number(ethUsd) > 0 ? Number(ethUsd) : 2500;

  const surplus = Math.max(0, native - keep);
  let requested = splitEth == null || splitEth === ""
    ? Math.min(maxS, Math.max(minS, surplus * 0.5))
    : Math.max(0, Number(splitEth) || 0);
  if (!Number.isFinite(requested)) requested = 0;

  const amountEth = Math.min(requested, surplus, maxS);
  const ok = amountEth + 1e-18 >= minS && surplus + 1e-18 >= minS;

  return {
    ok,
    amountEth: ok ? amountEth : 0,
    amountUsd: ok ? amountEth * usd : 0,
    keepGasEth: keep,
    v3NativeEth: native,
    v3WethEth: weth,
    surplusEth: surplus,
    v3AfterEth: native - (ok ? amountEth : 0),
    reason: ok
      ? `split ${amountEth.toFixed(6)} ETH (~$${(amountEth * usd).toFixed(2)}) to V4; leave ${keep.toFixed(6)} gas on V3`
      : surplus < minS
        ? `native ${native.toFixed(6)} ETH after ${keep.toFixed(6)} gas keep is below min split ${minS}`
        : `requested split too small (need ≥ ${minS} ETH)`,
  };
}

export function readFundLatch(latchPath = FUND_LATCH) {
  try {
    if (!fs.existsSync(latchPath)) return null;
    return JSON.parse(fs.readFileSync(latchPath, "utf8"));
  } catch {
    return null;
  }
}

export function writeFundLatch(payload, latchPath = FUND_LATCH) {
  fs.mkdirSync(path.dirname(latchPath), { recursive: true });
  const body = {
    ...payload,
    at: payload?.at || new Date().toISOString(),
  };
  fs.writeFileSync(latchPath, JSON.stringify(body, null, 2));
  return body;
}

/** Env knobs for the V3 → V4 one-shot fund (read on V3 with optional prefix). */
export function fundSplitEnvFromProcess(envObj = process.env) {
  const to = String(
    envObj.GUARDIAN_V4_FUND_TO ||
      envObj.V4_FUND_TO ||
      "",
  ).trim();
  const amountRaw = envObj.GUARDIAN_V4_FUND_ETH ?? envObj.V4_FUND_ETH ?? "";
  const once = String(envObj.GUARDIAN_V4_FUND_ONCE ?? envObj.V4_FUND_ONCE ?? "yes")
    .toLowerCase() !== "no";
  const keepGas = Number(envObj.GUARDIAN_V4_FUND_KEEP_GAS ?? envObj.V4_FUND_KEEP_GAS ?? 0.0008);
  return {
    to: looksLikeEthAddress(to) ? to : "",
    amountEth: amountRaw === "" || amountRaw == null ? null : Number(amountRaw),
    once,
    keepGasEth: Number.isFinite(keepGas) && keepGas >= 0 ? keepGas : 0.0008,
  };
}

export function defaultPaperUsdFromSplit(amountEth, ethUsd = 2500) {
  const eth = Math.max(0, Number(amountEth) || 0);
  const usd = Number(ethUsd) > 0 ? Number(ethUsd) : 2500;
  // Thin-book inject-all seats start around $4–$8.
  return Math.max(4, Math.min(12, eth * usd));
}

/** Resolve split amount for live V4 sizing from env or on-chain wallet. */
export function resolveV4TradeableUsd({
  paperUsd = Number(env("PAPER_USD", "8")) || 8,
  walletEth = null,
  ethUsd = Number(env("ETH_USD", "2500")) || 2500,
  gasFloorEth = Number(env("GAS_FLOOR_ETH", "0.0003")) || 0.0003,
} = {}) {
  if (walletEth == null || !Number.isFinite(Number(walletEth))) {
    return { tradeableUsd: paperUsd, source: "paper", tradeableEth: null };
  }
  const eth = Math.max(0, Number(walletEth) - Math.max(0, gasFloorEth));
  const fromWallet = eth * (Number(ethUsd) > 0 ? Number(ethUsd) : 2500);
  if (!(fromWallet > 0.5)) {
    return { tradeableUsd: paperUsd, source: "paper-fallback", tradeableEth: eth };
  }
  return {
    tradeableUsd: Math.max(1, Math.min(paperUsd * 2, fromWallet)),
    source: "wallet",
    tradeableEth: eth,
  };
}
