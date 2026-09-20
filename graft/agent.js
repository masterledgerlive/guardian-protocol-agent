#!/usr/bin/env node
/**
 * GRAFT agent — completely separate from root agent.js and vita/.
 *
 * Run:  npm run start:graft
 *       npm run start:graft -- --once
 *       npm run start:graft -- --cmd "/graft activate last"
 *
 * Env:  GRAFT_TELEGRAM_BOT_TOKEN + GRAFT_TELEGRAM_CHAT_ID  (dedicated poller)
 *       GRAFT_DRY_RUN=yes (default)
 *       GRAFT_THINK_COST_ETH=0.00001
 *
 * Does not import VITA, does not start the live trader, does not invent txs.
 */

import { DRY_RUN, THINK_COST_ETH, telegramConfigured, shouldPollTelegram } from "./config.js";
import { bag, ensureStore } from "./store.js";
import { seedGraft } from "./seed.js";
import { dispatchGraftCommand } from "./commands.js";
import { pollOnce, sendGraftTelegram, prefixGraft } from "./telegram.js";
import { shortId } from "./hash.js";

function log(...args) {
  console.log(`[graft ${new Date().toISOString()}]`, ...args);
}

function parseArgs(argv) {
  const out = { once: false, cmd: null, activate: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--once") out.once = true;
    else if (a === "--cmd") out.cmd = argv[++i] || "";
    else if (a === "--activate") out.activate.push(argv[++i] || "last");
  }
  return out;
}

function printStatus() {
  const b = bag();
  log(`GRAFT ready · dry-run ${DRY_RUN ? "yes" : "no"} · piggy ${b.piggyEth} ETH`);
  log(`last-root ${b.lastRoot}`);
  log(`artifacts ${b.artifacts} filed ${b.filed} active ${b.active} thoughts ${b.thoughts}`);
  log(`think cost ${THINK_COST_ETH} ETH · tx hashes: ${b.txHashes.length ? b.txHashes.join(",") : "(none invented)"}`);
  log(`telegram send ${telegramConfigured() ? "yes" : "no"} · poll ${shouldPollTelegram() ? "dedicated" : "off (will not steal V3 updates)"}`);
}

async function main() {
  ensureStore();
  const args = parseArgs(process.argv.slice(2));
  seedGraft({ activate: args.activate });
  printStatus();

  if (args.cmd) {
    const result = dispatchGraftCommand(args.cmd, { source: "cli" });
    const html = prefixGraft(result.html || result.error || "");
    console.log(html.replace(/<[^>]+>/g, ""));
    if (telegramConfigured()) await sendGraftTelegram(result.html || "");
    return;
  }

  if (args.once) {
    log("once — seed complete, exiting (no poller)");
    return;
  }

  if (!shouldPollTelegram()) {
    log("no GRAFT_TELEGRAM_BOT_TOKEN — staying up for --cmd / future poller. Will not poll live Guardian.");
    setInterval(() => {
      const b = bag();
      log(`heartbeat last-root ${shortId(b.lastRoot, 12)} piggy ${b.piggyEth} active ${b.active}`);
    }, 60000);
    return;
  }

  log("polling dedicated GRAFT bot for /graft commands");
  const loop = async () => {
    try {
      const r = await pollOnce();
      if (r.error) log("poll error", r.error);
    } catch (err) {
      log("poll threw", err?.message || err);
    }
  };
  await loop();
  setInterval(loop, 3000);
}

main().catch((err) => {
  console.error("[graft] fatal", err);
  process.exit(1);
});
