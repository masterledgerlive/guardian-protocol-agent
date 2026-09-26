#!/usr/bin/env node
/**
 * WAVE memory-mirror transmission test (optional CLI).
 *
 * Default: simulate inject + reconstruct-from-sim-chain vs answer key.
 * Live: WAVE_MIRROR_PAID=yes node scripts/wave-mirror-test.js --live
 *       (still needs a real sendTx; this CLI simulates unless --send is wired).
 *
 * Never invents tx hashes. Does not enable VITAFEED_PAID.
 * Mother brain untouched.
 *
 * Usage:
 *   node scripts/wave-mirror-test.js
 *   node scripts/wave-mirror-test.js --hitch
 */
import {
  WAVE_WISE_MESSAGE,
  attachWaveOnCoveredLeftover,
  formatWaveMirrorCard,
  runWaveMirrorTest,
  waveMirrorPaidEnabled,
} from "../vita/wave-wrap.js";

const args = new Set(process.argv.slice(2));

if (args.has("--hitch") || args.has("hitch")) {
  const preparedLine =
    "[W:v1:WISE] hitch-demo — leftover attach is wrap-only (KEY+LOC leftover hitch stays)";
  const uncovered = attachWaveOnCoveredLeftover({
    line: preparedLine,
    leftoverEth: 0,
    hitchCostEth: 0.0001,
    pairedUniswapSell: false,
  });
  const covered = attachWaveOnCoveredLeftover({
    line: preparedLine,
    leftoverEth: 0.0004,
    hitchCostEth: 0.0002,
    pairedUniswapSell: true,
  });
  console.log("WAVE leftover hitch wrap");
  console.log("uncovered:", uncovered.reason);
  console.log("covered:", covered.reason);
  console.log("WAVE_MIRROR_PAID", waveMirrorPaidEnabled() ? "on" : "off (default)");
  console.log("VITAFEED_PAID untouched");
  process.exit(0);
}

const live = args.has("--live") || args.has("live");
const result = await runWaveMirrorTest({
  body: WAVE_WISE_MESSAGE,
  live,
  env: process.env,
});
console.log(formatWaveMirrorCard(result));
if (!result.pass) {
  console.error(result.reason || "WAVE mirror failed");
  process.exit(1);
}
process.exit(0);
