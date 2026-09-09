/**
 * Crypto-event + storage-token hard-push benchmark (Sprint 6).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runHardPushSuite, runSystemLoop } from "../core/system-loop.js";
import { computeInjectionCapacity } from "../models/injection-capacity.js";
import { runAllCryptoEvents } from "../models/crypto-events.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../..");
const reportsDir = join(root, "arena/reports");

export function runCryptoStressBenchmark(opts = {}) {
  const suite = runHardPushSuite({
    cycles: opts.cycles ?? 40,
    initialLiquidUsd: opts.initialLiquidUsd ?? 2.24,
    initialPiggyUsd: opts.initialPiggyUsd ?? 0.18,
    initialBits: opts.initialBits ?? 10,
    nodeCount: opts.nodeCount ?? 8,
    payloadBytes: opts.payloadBytes ?? 64 * 1024,
    lane: opts.lane ?? "STANDBY",
    callToAdd: opts.callToAdd !== false,
    seed: opts.seed ?? "crypto-stress-v0.1",
  });

  const capacityOnly = computeInjectionCapacity({
    tradeableUsd: opts.initialLiquidUsd ?? 2.24,
    piggyUsd: opts.initialPiggyUsd ?? 0.18,
    bagsUsd: opts.bagsUsd ?? 5.0,
    bitsBalance: opts.initialBits ?? 10,
  });

  const envelope = {
    ...suite,
    CAPACITY_AT_START: capacityOnly,
    GENERATED_AT: new Date().toISOString(),
  };

  mkdirSync(reportsDir, { recursive: true });
  const outPath = join(reportsDir, "crypto-stress-hard-push.json");
  writeFileSync(outPath, JSON.stringify(envelope, null, 2));
  return { envelope, outPath };
}

const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  const { envelope, outPath } = runCryptoStressBenchmark();
  const v = envelope.VERDICT;
  console.log(
    JSON.stringify(
      {
        BENCHMARK: envelope.BENCHMARK,
        STATUS: envelope.STATUS,
        VERDICT: v,
        PIGGY_READY_USD: v.piggy_ready_usd,
        CAPACITY_BYTES_NOW: v.capacity_now_bytes,
        MOVIE_720P_CYCLES: v.movie_720p_cycles,
        CRYPTO_SURVIVED: envelope.CRYPTO_EVENTS.survived,
        CRYPTO_TOTAL: envelope.CRYPTO_EVENTS.event_count,
        BANK_RUN: {
          thin_survived: envelope.BANK_RUN?.thin_redundancy?.exact_match,
          wide_survived: envelope.BANK_RUN?.wide_redundancy?.exact_match,
          lesson: envelope.BANK_RUN?.lesson,
        },
        SYSTEM_LOOP: envelope.SYSTEM_LOOP.STATUS,
      },
      null,
      2
    )
  );
  console.log(`\nFull report: ${outPath}`);
  if (envelope.STATUS !== "PROVEN") process.exit(1);
}

export { runSystemLoop, runAllCryptoEvents, computeInjectionCapacity };
