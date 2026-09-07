/**
 * Multi-strategy Arena compare on 0001-tiny (Sprint 2–3).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runBenchmark0001 } from "./run-0001.js";
import { buildLeaderboards, paretoFrontier } from "../../arena/scoring/leaderboard.js";
import { listStrategies } from "../strategies/registry.js";
import "../../strategies/load-all.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../..");

export function runArenaCompare({
  strategies = null,
  seedTime = 1_700_000_200_000,
} = {}) {
  const keys = strategies ?? listStrategies();
  const reports = [];
  let seed = seedTime;
  for (const strategyKey of keys) {
    const { envelope } = runBenchmark0001({ strategyKey, seedTime: seed });
    reports.push(envelope);
    seed += 10_000;
  }
  const boards = buildLeaderboards(reports);
  const pareto = paretoFrontier(reports);
  const out = {
    kind: "simulated_arena_compare",
    strategies: keys,
    boards,
    pareto,
    reports: reports.map((r) => ({
      strategy: r.STRATEGY,
      exact_match: r.RESULT.exact_match,
      cost: r.ECONOMICS.simulated_cost,
      latency: r.PERFORMANCE.retrieval_time,
      replay_hash: r.TRACE.replay_hash,
    })),
  };
  const outDir = join(root, "arena/reports");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "arena-compare.json");
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  return { out, outPath, reports };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const { out, outPath } = runArenaCompare();
  console.log(JSON.stringify(out, null, 2));
  console.log(`\nWrote ${outPath}`);
}
