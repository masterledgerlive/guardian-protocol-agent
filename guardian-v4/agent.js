#!/usr/bin/env node
/**
 * Guardian V4 agent — completely separate from root `agent.js` (Uniswap V3).
 *
 * Run:  npm run start:v4
 * Env:  GUARDIAN_V4_DRY_RUN=yes (default) | no
 *       GUARDIAN_V4_RPC_URL=...
 *       GUARDIAN_V4_TELEGRAM_BOT_TOKEN / GUARDIAN_V4_TELEGRAM_CHAT_ID
 *         (or GUARDIAN_V4_SHARE_ROOT_ENV=yes → VAULT_TELEGRAM_BOT_TOKEN / TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID)
 *       GUARDIAN_V4_PRIVATE_KEY=...   (live only; do NOT reuse V3 hot wallet casually)
 *
 * Dry-run still Telegrams [V4] turn cards (calldata planned / hitch banked / skips).
 * It does not broadcast swaps.
 *
 * Goal: inject capital on Base Uni V4 avenues (DOT, Polkadot-base, majors, popular
 * V4 names) and hitch VITA §TOKEN§ on leftover-covered swaps — never as
 * a data-only scribble when a real trade can carry it.
 */

import fs from "node:fs";
import {
  CYCLE_MS,
  DRY_RUN,
  DEFAULT_RPCS,
  HITCH_COST_MULT,
  MIN_NET_MARGIN,
  NATIVE_ETH,
  STATE_DIR,
  TOKENS_STATE,
  RACE_STATE,
  env,
  telegramBotToken,
} from "./config.js";
import { acquireLock, ensureStateDir } from "./lock.js";
import { injectAllBookParams, injectProveStatus, rankAvenues } from "./inject-v4.js";
import {
  V4_AVENUES,
  avenueSummary,
  injectableAvenues,
} from "./tokens.js";
import {
  VITA_PROOF_FULL,
  buildStoreVoice,
  encodeStoreVoiceCalldata,
  encodeV4ExactInSwap,
  hitchSwapIfCovered,
  utf8ByteLength,
} from "./swap-v4.js";
import { planSecondaryHitch, ingestSealedUtf8 } from "../vita-router.js";
import {
  applyHitchBank,
  formatV4DryRunCard,
  formatV4SkipCard,
  hitchBudgetBalanceEth,
  planHitchMessaging,
  sendV4Telegram,
} from "./telegram.js";
import {
  persistV4RaceSnapshot,
  sendRaceScoreboardIfDue,
} from "../race-scoreboard.js";
import { resolveV4TradeableUsd } from "./fund-split.js";
import {
  broadcastV4Swap,
  loadV4Account,
  makePublicClient,
  readNativeEth,
} from "./wallet.js";
import { loadVaultKeys } from "../vault-loader.js";

ensureStateDir();
const releaseLock = acquireLock();

let hitchInjectCount = 0;
let hitchInjectProfitUsd = 0;
let cycle = 0;
let v4Account = null;
let publicClient = null;

function log(...args) {
  console.log(`[guardian-v4 ${new Date().toISOString()}]`, ...args);
}

function persistCatalog() {
  const payload = {
    track: "guardian-v4",
    updatedAt: new Date().toISOString(),
    dryRun: DRY_RUN,
    avenues: V4_AVENUES,
    summary: avenueSummary(),
  };
  fs.writeFileSync(TOKENS_STATE, JSON.stringify(payload, null, 2));
}

function estimateHitchCostEth(bytes, gwei = 0.05) {
  // Rough L2 calldata + L1 blob proxy — gates only; live bot should use GasPriceOracle.
  const b = Math.max(0, Number(bytes) || 0);
  const gas = 21000 + b * 16;
  return (gas * gwei * 1e-9) * HITCH_COST_MULT;
}

function buildDemoInject(token, { tradeEth = 0.002 } = {}) {
  const amountIn = BigInt(Math.floor(tradeEth * 1e18));
  const tokenIn = token.quoteAddress || NATIVE_ETH;
  const tokenOut = token.address;
  const encoded = encodeV4ExactInSwap({
    tokenIn,
    tokenOut,
    fee: token.fee,
    tickSpacing: token.tickSpacing,
    hooks: token.hooks,
    amountIn,
    amountOutMinimum: 0n,
  });
  const planned = planSecondaryHitch({ maxBytes: 400 });
  const hitchCost = estimateHitchCostEth(planned.hitchBytes || utf8ByteLength(planned.utf8));
  const leftoverEth = hitchCost * 1.25;
  const hitched = hitchSwapIfCovered({
    swapData: encoded.data,
    leftoverEth,
    hitchCostEth: hitchCost,
    utf8: planned.utf8,
  });
  return { encoded, hitched, hitchCost, leftoverEth, voice: planned.utf8, tradeEth };
}

function printAvenueBoard() {
  const summary = avenueSummary();
  log("═══ Guardian V4 avenue board (Base Uniswap V4) ═══");
  log(`dryRun=${DRY_RUN} injectable=${summary.injectable.length} total=${summary.total}`);
  log(`active: ${summary.groups.active?.join(", ") || "—"}`);
  log(`scout:  ${summary.groups.scout?.join(", ") || "—"}`);
  log(`watch:  ${summary.groups.watch?.join(", ") || "—"}`);
  log(`deferred: ${summary.groups.deferred?.join(", ") || "—"}`);
  for (const t of injectableAvenues()) {
    const flag = t.injectMain ? "★" : "·";
    log(
      `  ${flag} ${t.symbol.padEnd(12)} fee=${t.feePct}% liq~$${Math.round(t.liqUsd)} vol24~$${Math.round(t.volUsd24h)} ${t.notes.slice(0, 72)}`,
    );
  }
}

async function resolveTradeableUsd() {
  const paper = Number(env("PAPER_USD", "8")) || 8;
  if (!v4Account || !publicClient) {
    return resolveV4TradeableUsd({ paperUsd: paper });
  }
  try {
    const { eth } = await readNativeEth(publicClient, v4Account.address);
    return resolveV4TradeableUsd({ paperUsd: paper, walletEth: eth });
  } catch (err) {
    log(`wallet balance read failed: ${err?.message || err} — paper $${paper}`);
    return resolveV4TradeableUsd({ paperUsd: paper });
  }
}

async function cycleOnce(tradeableUsdOpt = null) {
  cycle += 1;
  const sized = tradeableUsdOpt != null
    ? { tradeableUsd: tradeableUsdOpt, source: "arg", tradeableEth: null }
    : await resolveTradeableUsd();
  const tradeableUsd = sized.tradeableUsd;
  const book = injectAllBookParams(tradeableUsd);
  const ranked = rankAvenues(injectableAvenues(), { tradeableUsd });
  const prove = injectProveStatus({
    successfulInjections: hitchInjectCount,
    netProfitUsd: hitchInjectProfitUsd,
  });

  log(
    `── cycle ${cycle} tradeable~$${tradeableUsd.toFixed(2)} (${sized.source}` +
      `${sized.tradeableEth != null ? ` eth=${sized.tradeableEth.toFixed(6)}` : ""})` +
      ` injectAll=${book.injectAll} dryRun=${DRY_RUN} ──`,
  );
  log(prove.message);
  log(
    `primed: ${ranked.primed.map((t) => t.symbol).join(", ") || "none"} | watch-queue: ${ranked.watch
      .slice(0, 6)
      .map((t) => t.symbol)
      .join(", ")}`,
  );

  for (const token of ranked.primed) {
    const ethUsd = Number(env("ETH_USD", "2500")) || 2500;
    const demo = buildDemoInject(token, {
      tradeEth: book.injectAll
        ? Math.max(0.0008, Math.min(0.002, tradeableUsd / ethUsd))
        : 0.0015,
    });
    if (demo.hitched.onChain) {
      hitchInjectCount += 1;
      hitchInjectProfitUsd += MIN_NET_MARGIN * (demo.tradeEth * ethUsd) * 0.05;
      if (demo.hitched.utf8) ingestSealedUtf8(demo.hitched.utf8);
    }
    log(
      `  inject ${token.symbol}: to=${demo.encoded.to.slice(0, 10)}… value=${demo.encoded.value} ` +
        `hitch=${demo.hitched.onChain ? `${demo.hitched.hitchBytes}B` : "SKIP"} ` +
        `${demo.hitched.onChain ? `"${demo.hitched.utf8.slice(0, 48)}…"` : demo.hitched.reason}`,
    );

    let txHash = null;
    if (DRY_RUN) {
      log(`  DRY_RUN — calldata ${demo.hitched.data.length} hex chars (not broadcast)`);
    } else {
      const sent = await broadcastV4Swap({
        to: demo.encoded.to,
        data: demo.hitched.data,
        value: demo.encoded.value,
        account: v4Account,
        publicClient,
      });
      if (sent.sent) {
        txHash = sent.hash;
        log(`  LIVE broadcast ${txHash}`);
      } else {
        log(`  LIVE skip — ${sent.reason}`);
      }
    }

    // Dry-run still Telegrams Game — planned calldata / hitch skip-bank / skip reasons.
    // Never invent P&L or a fake tx hash.
    const hitchPlan = planHitchMessaging({
      leftoverEth: demo.leftoverEth,
      hitchCostEth: demo.hitchCost,
      hitchOnChain: demo.hitched.onChain,
      hitchBytes: demo.hitched.hitchBytes,
      hitchUtf8: demo.hitched.utf8,
      skipReason: demo.hitched.reason,
      side: "BUY",
    });
    if (hitchPlan.hitchSkipped) {
      const bank = applyHitchBank(hitchPlan, token.symbol);
      if (bank.log) log(bank.log);
    }
    await sendV4Telegram(formatV4DryRunCard({
      symbol: token.symbol,
      side: "BUY",
      dryRun: DRY_RUN,
      cycle,
      tradeEth: demo.tradeEth,
      hitchPlan,
      calldataChars: demo.hitched.data?.length || 0,
      txHash,
    }));
  }

  if (ranked.primed.length === 0) {
    await sendV4Telegram(formatV4SkipCard({
      reason: "no primed V4 avenue this cycle — nothing broadcast",
      dryRun: DRY_RUN,
      cycle,
    }));
  }

  // Always keep a data-only prove path available (operator), but prefer hitch-on-swap.
  const proveData = encodeStoreVoiceCalldata(buildStoreVoice({ message: VITA_PROOF_FULL }));
  log(`  /prove-ready data-only bytes=${(proveData.length - 2) / 2} (use only when no leftover swap)`);

  persistCatalog();
  persistV4RaceSnapshot({
    dryRun: DRY_RUN,
    cycles: cycle,
    hitchPlanned: hitchInjectCount,
    hitchBankedEth: hitchBudgetBalanceEth(),
  }, { racePath: RACE_STATE });
  await sendRaceScoreboardIfDue({
    send: (html) => sendV4Telegram(html, { prefix: false }),
    cycles: cycle,
    v3LiquidEth: null,
    v3LiquidWeth: null,
  });
}

async function maybeLoadSharedVaultTelegram() {
  if (process.env.GUARDIAN_V4_SHARE_ROOT_ENV !== "yes") return;
  if (telegramBotToken()) return;
  if (!process.env.DECRYPT_PASSWORD) {
    log("Telegram: SHARE_ROOT_ENV set but DECRYPT_PASSWORD missing — cannot resolve VAULT_TELEGRAM_*");
    return;
  }
  // VAULT_TELEGRAM_BOT_TOKEN is a Base tx hash; loadVaultKeys decrypts into TELEGRAM_BOT_TOKEN.
  try {
    await loadVaultKeys();
  } catch (err) {
    log(`vault load failed: ${err?.message || err}`);
  }
}

async function main() {
  log("Guardian V4 offshoot starting — isolated from root Uniswap V3 agent.js");
  log(`RPCs: ${DEFAULT_RPCS.join(" | ")}`);
  log(`state: ${STATE_DIR}`);
  await maybeLoadSharedVaultTelegram();
  v4Account = loadV4Account();
  publicClient = makePublicClient();
  if (v4Account) {
    log(`V4 wallet ${v4Account.address} dryRun=${DRY_RUN}`);
  } else if (!DRY_RUN) {
    log("LIVE requested but GUARDIAN_V4_PRIVATE_KEY missing — refusing broadcasts");
  } else {
    log("no GUARDIAN_V4_PRIVATE_KEY — paper/dry-run only");
  }
  printAvenueBoard();
  persistCatalog();

  const once = process.argv.includes("--once");
  await cycleOnce();
  if (once) {
    releaseLock();
    return;
  }

  log(`looping every ${CYCLE_MS}ms — Ctrl+C to stop (V3 agent unaffected)`);
  setInterval(() => {
    cycleOnce().catch((err) => log("cycle error", err?.message || err));
  }, CYCLE_MS);
}

main().catch((err) => {
  console.error(err);
  releaseLock();
  process.exit(1);
});

export { buildDemoInject, avenueSummary, cycleOnce };
