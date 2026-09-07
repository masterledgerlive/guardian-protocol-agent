/**
 * Stress benchmark — node drop + redundancy survival (Sprint 4).
 */
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SimulationController } from "../core/simulation-controller.js";
import { StorageModel } from "../models/storage-model.js";
import { FailureModel } from "../models/failure-model.js";
import { sha256Hex } from "../core/hashing.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../..");
const reportsDir = join(root, "arena/reports");

export function runStressBenchmark({
  strategyKey = "REDOPT-0.1",
  dropNodeIds = ["node-0"],
  seedTime = 1_700_000_100_000,
} = {}) {
  // Long-enough payload so REDOPT picks long-tail redundancy=3
  const bytes = Buffer.from("G".repeat(2048));
  let t = seedTime;
  const storage = StorageModel.createUniformCluster({ count: 5, capacity: 50_000_000 });
  const failure = new FailureModel({
    dropNodeIds,
    label: "simulated-stress-drop-v0.1",
  });

  const controller = new SimulationController({
    strategyKey,
    storage,
    failure,
    now: () => ++t,
  });

  const report = controller.run(bytes, { objectId: "stress-0001" });
  const envelope = {
    BENCHMARK: "stress-0001",
    BENCHMARK_VERSION: "0.1.0",
    STRATEGY: strategyKey,
    GENERATED_AT_KIND: "simulated_clock",
    INPUT_FILE_SHA256: sha256Hex(bytes),
    ...report,
  };

  mkdirSync(reportsDir, { recursive: true });
  const outPath = join(reportsDir, `stress-${strategyKey.replace(/[^a-zA-Z0-9._-]/g, "_")}.json`);
  writeFileSync(outPath, JSON.stringify(envelope, null, 2));
  return { envelope, outPath };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const { envelope, outPath } = runStressBenchmark();
  console.log(
    JSON.stringify(
      {
        BENCHMARK: envelope.BENCHMARK,
        STRATEGY: envelope.STRATEGY,
        RESULT: envelope.RESULT,
        STRESS: envelope.STRESS,
        PIPELINE: envelope.PIPELINE,
        STATUS: envelope.STATUS,
      },
      null,
      2
    )
  );
  console.log(`\nFull report: ${outPath}`);
  if (envelope.RESULT.exact_match !== true) process.exit(1);
}
