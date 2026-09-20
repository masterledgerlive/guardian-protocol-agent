/**
 * Seed GRAFT with committed memory files. Idempotent — content-addressed.
 */

import fs from "node:fs";
import path from "node:path";
import { MEMORY_DIR } from "./config.js";
import { ensureStore, ingestRaw, persistLedger, readLedger, setActive } from "./store.js";

export const SEED_FILES = [
  {
    file: "genesis-memory-injector.txt",
    title: "MEMORY-INJECTOR — lossless knowledge tree (LLM dump #1)",
    nodeIds: ["prompts", "archive", "daisy-l3"],
  },
  {
    file: "offshoot-graft-brief.md",
    title: "GRAFT offshoot brief — last-root nursery",
    nodeIds: ["prompts", "archive"],
  },
  {
    file: "genesis-unified-agentic-stack.txt",
    title: "DAISY — Unified Agentic Stack L0–L4 (LLM dump #2)",
    nodeIds: ["prompts", "daisy", "daisy-l0", "daisy-l1", "daisy-l2", "daisy-l3", "daisy-l4"],
  },
  {
    file: "offshoot-daisy-brief.md",
    title: "DAISY offshoot brief — GRAFT-local 5-layer map",
    nodeIds: ["daisy", "daisy-l0", "daisy-l1", "daisy-l2", "daisy-l3", "daisy-l4"],
  },
];

export function seedGraft({ activate = [] } = {}) {
  const ledger = ensureStore();
  const ingested = [];
  for (const spec of SEED_FILES) {
    const p = path.join(MEMORY_DIR, spec.file);
    if (!fs.existsSync(p)) continue;
    const text = fs.readFileSync(p, "utf8");
    const r = ingestRaw(text, {
      title: spec.title,
      source: "seed",
      mimeType: spec.file.endsWith(".md") ? "text/markdown" : "text/plain",
      nodeIds: spec.nodeIds,
      provenance: { origin: "graft-memory", file: spec.file },
    }, ledger);
    ingested.push({ file: spec.file, artifact: r.artifact, duplicate: r.duplicate });
  }
  ledger.seeded = true;
  persistLedger(ledger);
  const activated = [];
  for (const ref of activate) {
    const r = setActive(ref, true, ledger);
    if (r.ok) activated.push(r.artifact.shortId);
  }
  return { ok: true, ingested, activated, ledger: readLedger() };
}
