/**
 * finetune-memory.js — sixth lobe hypothesis graph + FOMO-style conviction
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BRAIN_LOBES,
  convictionScore,
  fileHypothesis,
  resolveHypothesis,
  ingestCostMistake,
  shouldAvoid,
  queryHypotheses,
  buildBrainStatus,
  buildFinetuneInjectContext,
  finetuneLearnSnippet,
  hypothesisToXmem,
  serializeFinetuneState,
  restoreFinetuneState,
  resetHypothesisGraph,
  formatBrainTelegram,
  graphFingerprint,
} from "./finetune-memory.js";

const root = dirname(fileURLToPath(import.meta.url));

beforeEach(() => {
  resetHypothesisGraph();
});

describe("finetune-memory: conviction (FOMO-style)", () => {
  it("weights squared scores — few strong fails beat many weak notes", () => {
    const weak = fileHypothesis({
      thesis: "weak noise",
      status: "failed",
      evidence: { kind: "note", score: 20 },
    });
    const strong = fileHypothesis({
      thesis: "strong refuse",
      status: "failed",
      evidence: { kind: "refuse", score: 90 },
    });
    assert.ok(convictionScore(strong) > convictionScore(weak));
  });

  it("failed status alone seeds non-zero conviction", () => {
    const h = fileHypothesis({ thesis: "seed fail", status: "failed" });
    assert.ok(convictionScore(h) >= 0.5);
  });
});

describe("finetune-memory: hypothesis graph", () => {
  it("files, consolidates same thesis, resolves status", () => {
    const a = fileHypothesis({
      thesis: "CBBTC thin book strands exits",
      regime: "high-unit",
      symbol: "CBBTC",
      status: "failed",
      tags: ["cost-edge"],
    });
    const b = fileHypothesis({
      thesis: "CBBTC thin book strands exits",
      regime: "high-unit",
      symbol: "CBBTC",
      evidence: { kind: "refuse", score: 85, note: "again" },
    });
    assert.equal(a.id, b.id);
    assert.equal(b.evidence.length, 1);
    const done = resolveHypothesis(a.id, "confirmed", { kind: "confirm", score: 70 });
    assert.equal(done.status, "confirmed");
  });

  it("ingestCostMistake maps high_unit / hitch to regimes", () => {
    const hu = ingestCostMistake({
      symbol: "CBBTC",
      code: "high_unit_thin_book",
      reason: "thin RISK",
    });
    assert.equal(hu.regime, "high-unit");
    assert.equal(hu.status, "failed");
    assert.equal(hu.symbol, "CBBTC");

    const hitch = ingestCostMistake({
      symbol: "KEYCAT",
      code: "hitch_pct",
      reason: "hitch eats stake",
    });
    assert.equal(hitch.regime, "thin-book");
  });

  it("shouldAvoid returns failed lessons above conviction floor", () => {
    ingestCostMistake({
      symbol: "CBBTC",
      code: "high_unit_thin_book",
      reason: "strands",
    });
    const hits = shouldAvoid({ symbol: "CBBTC", minConviction: 0.3 });
    assert.ok(hits.length >= 1);
    assert.equal(hits[0].symbol, "CBBTC");
    assert.equal(shouldAvoid({ symbol: "AERO", minConviction: 0.3 }).length, 0);
  });

  it("query filters by status / regime / text", () => {
    fileHypothesis({ thesis: "prefer LINK inject seat", regime: "general", status: "confirmed", symbol: "LINK" });
    fileHypothesis({ thesis: "avoid GAME ghost book", regime: "thin-book", status: "failed", symbol: "GAME" });
    assert.equal(queryHypotheses({ status: "failed" }).length, 1);
    assert.equal(queryHypotheses({ q: "link inject" }).length, 1);
    assert.equal(queryHypotheses({ regime: "thin-book", symbol: "GAME" })[0].symbol, "GAME");
  });
});

describe("finetune-memory: brain + inject", () => {
  it("six lobes · FINETUNE fires after a failed lesson", () => {
    assert.equal(BRAIN_LOBES.length, 6);
    let status = buildBrainStatus({ hasKey: true, sealedCount: 1, judgeLessons: 0, burstAlign: 0 });
    assert.ok(status.firing >= 1);
    ingestCostMistake({ symbol: "AAVE", code: "high_unit_floor", reason: "floor" });
    status = buildBrainStatus({ hasKey: true, sealedCount: 2, judgeLessons: 1, burstAlign: 2, tapeCount: 3 });
    assert.equal(status.lobes.FINETUNE.signal, 1);
    assert.ok(status.firing >= 4);
    assert.ok(status.message.includes("lobes"));
    assert.ok(formatBrainTelegram(status).includes("THE BRAIN"));
  });

  it("inject context lists avoid lessons for session start", () => {
    ingestCostMistake({ symbol: "CBBTC", code: "hitch_pct", reason: "insert > edge" });
    const inj = buildFinetuneInjectContext();
    assert.ok(inj.context.includes("FINETUNE"));
    assert.ok(inj.context.includes("AVOID"));
    assert.ok(inj.context.includes("CBBTC"));
    const learn = finetuneLearnSnippet();
    assert.ok(learn.includes("FINETUNE avoid"));
  });

  it("XMEM overlay maps failed → warning", () => {
    const h = ingestCostMistake({ symbol: "UNI", code: "rt_pct", reason: "RT eats stake" });
    const x = hypothesisToXmem(h);
    assert.equal(x.ns, "finetune");
    assert.equal(x.type, "warning");
    assert.equal(x.id, h.id);
    assert.ok(x.tags.includes("finetune"));
  });

  it("serialize / restore round-trips", () => {
    ingestCostMistake({ symbol: "ZORA", code: "near_term", reason: "far peak" });
    const fp1 = graphFingerprint();
    const blob = serializeFinetuneState();
    resetHypothesisGraph();
    assert.equal(queryHypotheses({}).length, 0);
    restoreFinetuneState(blob);
    assert.equal(queryHypotheses({ symbol: "ZORA" }).length, 1);
    assert.equal(graphFingerprint(), fp1);
  });
});

describe("finetune-memory: wired into stack", () => {
  it("agent + cost-edge + vita-router + webhook reference the lobe", () => {
    const agent = readFileSync(join(root, "agent.js"), "utf8");
    const cost = readFileSync(join(root, "cost-edge-gate.js"), "utf8");
    const router = readFileSync(join(root, "vita-router.js"), "utf8");
    const hook = readFileSync(join(root, "vita-webhook.js"), "utf8");
    assert.ok(agent.includes("finetune-memory"));
    assert.ok(agent.includes("/brain"));
    assert.ok(cost.includes("ingestCostMistake"));
    assert.ok(router.includes("buildFinetuneInjectContext") || router.includes("finetuneLearnSnippet"));
    assert.ok(hook.includes("/vita/brain"));
  });
});
