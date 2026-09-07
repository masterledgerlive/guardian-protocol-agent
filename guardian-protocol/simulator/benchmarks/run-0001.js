/**
 * Benchmark 0001 runner — Tiny Object + FIFO baseline.
 */
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SimulationController } from "../core/simulation-controller.js";
import { sha256Hex } from "../core/hashing.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../..");
const tinyDir = join(root, "benchmarks/0001-tiny");
const reportsDir = join(root, "arena/reports");

function parseArgs(argv) {
  const out = { strategy: "FIFO-0.1" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--strategy" && argv[i + 1]) {
      const raw = argv[++i];
      out.strategy = raw.includes("-") ? raw : `${raw.toUpperCase()}-0.1`;
    }
  }
  return out;
}

export function runBenchmark0001({ strategyKey = "FIFO-0.1", seedTime = 1_700_000_000_000 } = {}) {
  const canonicalPath = join(tinyDir, "canonical.txt");
  const bytes = readFileSync(canonicalPath);
  let t = seedTime;
  const controller = new SimulationController({
    strategyKey,
    now: () => ++t,
  });

  const report = controller.run(bytes, { objectId: "benchmark-0001" });
  const envelope = {
    BENCHMARK: "0001",
    BENCHMARK_VERSION: "0.1.0",
    STRATEGY: strategyKey,
    GENERATED_AT_KIND: "simulated_clock",
    INPUT_FILE_SHA256: sha256Hex(bytes),
    ...report,
  };

  mkdirSync(reportsDir, { recursive: true });
  const outPath = join(reportsDir, `0001-${strategyKey.replace(/[^a-zA-Z0-9._-]/g, "_")}.json`);
  // Strip full replay events from the compact report file? Keep them — agents need evidence.
  writeFileSync(outPath, JSON.stringify(envelope, null, 2));
  writeFileSync(join(tinyDir, "last-report.json"), JSON.stringify(envelope, null, 2));

  return { envelope, outPath };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const { envelope, outPath } = runBenchmark0001({ strategyKey: args.strategy });
  const summary = {
    BENCHMARK: envelope.BENCHMARK,
    STRATEGY: envelope.STRATEGY,
    INPUT: envelope.INPUT,
    PIPELINE: envelope.PIPELINE,
    RESULT: envelope.RESULT,
    ECONOMICS: envelope.ECONOMICS,
    PERFORMANCE: envelope.PERFORMANCE,
    TRACE: envelope.TRACE,
    STATUS: envelope.STATUS,
  };
  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nFull report: ${outPath}`);
  if (envelope.RESULT.exact_match !== true) process.exit(1);
}
