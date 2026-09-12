#!/usr/bin/env node
/**
 * CLI: node guardian-arena-player/run.js --mode=sim --ticks=80
 *
 * Activation: ARENA_PLAYER=yes (or pass --force).
 * When agent-hour burns out, continues on heuristic brain automatically.
 */

import { isArenaPlayerEnabled, runArenaPlayer } from "./player.js";

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

async function main() {
  const force = process.argv.includes("--force");
  if (!force && !isArenaPlayerEnabled()) {
    console.log(
      "[arena-player] idle — set ARENA_PLAYER=yes to activate (V3/V4 bots unaffected)",
    );
    process.exit(0);
  }

  const result = await runArenaPlayer({
    mode: arg("mode", "sim"),
    ticks: Number(arg("ticks", "60")) || 60,
    agentClass: arg("class", "FLY"),
    provider: arg("provider", "heuristic"),
    seed: Number(arg("seed", "42")) || 42,
    stats: {
      spd: Number(arg("spd", "6")) || 6,
      rsk: Number(arg("rsk", "4")) || 4,
      ptn: Number(arg("ptn", "0")) || 0,
      gas: Number(arg("gas", "5")) || 5,
    },
  });

  console.log(
    `[arena-player] done ticks=${result.ticks} fills=${result.fills}` +
      ` equity=${result.equityEth.toFixed(4)} ETH` +
      ` realized=${result.realizedPnlEth.toFixed(4)} ETH` +
      ` brain=${result.hour.brain}` +
      ` assistRemaining=${Math.round(result.hour.remainingMs / 1000)}s`,
  );
}

main().catch((err) => {
  console.error("[arena-player] fatal", err);
  process.exit(1);
});
