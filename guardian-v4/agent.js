#!/usr/bin/env node
/**
 * Guardian V4 agent — completely separate from root `agent.js` (Uniswap V3).
 *
 * Run:  npm run start:v4
 * Env:  GUARDIAN_V4_DRY_RUN=yes (default) | no
 *       GUARDIAN_V4_RPC_URL=...
 *       GUARDIAN_V4_PRIVATE_KEY=...   (live only; do NOT reuse V3 hot wallet casually)
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
  env,
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

ensureStateDir();
const releaseLock = acquireLock();

let hitchInjectCount = 0;
let hitchInjectProfitUsd = 0;
let cycle = 0;

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

async function cycleOnce(tradeableUsd = Number(env("PAPER_USD", "8")) || 8) {
  cycle += 1;
  const book = injectAllBookParams(tradeableUsd);
  const ranked = rankAvenues(injectableAvenues(), { tradeableUsd });
  const prove = injectProveStatus({
    successfulInjections: hitchInjectCount,
    netProfitUsd: hitchInjectProfitUsd,
  });

  log(`── cycle ${cycle} tradeable~$${tradeableUsd.toFixed(2)} injectAll=${book.injectAll} ──`);
  log(prove.message);
  log(
    `primed: ${ranked.primed.map((t) => t.symbol).join(", ") || "none"} | watch-queue: ${ranked.watch
      .slice(0, 6)
      .map((t) => t.symbol)
      .join(", ")}`,
  );

  for (const token of ranked.primed) {
    const demo = buildDemoInject(token, {
      tradeEth: book.injectAll ? Math.max(0.0015, tradeableUsd / 2500) : 0.0015,
    });
    if (demo.hitched.onChain) {
      hitchInjectCount += 1;
      hitchInjectProfitUsd += MIN_NET_MARGIN * (demo.tradeEth * 2500) * 0.05;
      if (demo.hitched.utf8) ingestSealedUtf8(demo.hitched.utf8);
    }
    log(
      `  inject ${token.symbol}: to=${demo.encoded.to.slice(0, 10)}… value=${demo.encoded.value} ` +
        `hitch=${demo.hitched.onChain ? `${demo.hitched.hitchBytes}B` : "SKIP"} ` +
        `${demo.hitched.onChain ? `"${demo.hitched.utf8.slice(0, 48)}…"` : demo.hitched.reason}`,
    );
    if (DRY_RUN) {
      log(`  DRY_RUN — calldata ${demo.hitched.data.length} hex chars (not broadcast)`);
    } else {
      log(
        "  LIVE mode stub — wire CDP/viem wallet + Permit2 approvals before broadcasting. " +
          "Keep a separate key from root V3.",
      );
    }
  }

  // Always keep a data-only prove path available (operator), but prefer hitch-on-swap.
  const proveData = encodeStoreVoiceCalldata(buildStoreVoice({ message: VITA_PROOF_FULL }));
  log(`  /prove-ready data-only bytes=${(proveData.length - 2) / 2} (use only when no leftover swap)`);

  persistCatalog();
}

async function main() {
  log("Guardian V4 offshoot starting — isolated from root Uniswap V3 agent.js");
  log(`RPCs: ${DEFAULT_RPCS.join(" | ")}`);
  log(`state: ${STATE_DIR}`);
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

export { buildDemoInject, avenueSummary };
