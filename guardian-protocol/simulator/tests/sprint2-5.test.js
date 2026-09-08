import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { listStrategies } from "../strategies/registry.js";
import "../../strategies/load-all.js";
import { SimulationController } from "../core/simulation-controller.js";
import { ReplayViewer, compareReplays } from "../core/replay-viewer.js";
import { StorageModel } from "../models/storage-model.js";
import { FailureModel, classifyTail } from "../models/failure-model.js";
import { scoreReport, paretoFrontier } from "../../arena/scoring/leaderboard.js";
import { validateSubmission, submissionFromReport, REQUIRED_FIELDS } from "../../arena/submission/validate.js";
import { runArenaCompare } from "../benchmarks/run-arena-compare.js";
import { runStressBenchmark } from "../benchmarks/run-stress.js";
import { listAdapterStubs, HitchInjectorAdapter } from "../../protocols/adapters/index.js";
import { createDashboardServer } from "../../dashboard/server.js";

describe("sprint2 observability", () => {
  it("registers competing strategies", () => {
    const keys = listStrategies();
    for (const k of ["FIFO-0.1", "ADAPTIVE-0.1", "COSTOPT-0.1", "PRIORITY-0.1", "REDOPT-0.1"]) {
      assert.ok(keys.includes(k), k);
    }
  });

  it("replay viewer steps and filters", () => {
    let t = 0;
    const sim = new SimulationController({ now: () => ++t });
    const report = sim.run(Buffer.from("replay-viewer-fixture"), { objectId: "rv1" });
    const viewer = ReplayViewer.fromReport(report);
    assert.ok(viewer.length > 5);
    viewer.jump(0);
    assert.equal(viewer.inspect().object_id, "rv1");
    viewer.step(2);
    assert.ok(viewer.current);
    viewer.reverse();
    const filtered = viewer.filter({ reasonCode: "BIT_EXACT" });
    assert.ok(filtered.length >= 1);
  });

  it("validates submissions and rejects production claims", () => {
    assert.ok(REQUIRED_FIELDS.length >= 16);
    const bad = validateSubmission({ strategy_name: "x", claims_production: true });
    assert.equal(bad.ok, false);
    let t = 0;
    const report = new SimulationController({ now: () => ++t }).run("sub-fix");
    const sub = submissionFromReport(report, { author_or_agent_id: "test" });
    const ok = validateSubmission(sub);
    assert.equal(ok.ok, true, ok.errors.join(";"));
  });

  it("builds leaderboards from arena compare", () => {
    const { reports, out } = runArenaCompare({
      strategies: ["FIFO-0.1", "ADAPTIVE-0.1", "COSTOPT-0.1"],
    });
    assert.equal(reports.length, 3);
    assert.ok(reports.every((r) => r.RESULT.exact_match === true));
    assert.ok(out.boards.absolute.length === 3);
    assert.ok(Array.isArray(out.pareto));
    const scored = scoreReport(reports[1], { baseline: reports[0] });
    assert.equal(scored.kind, "simulated_score");
    assert.ok(paretoFrontier(reports).length >= 1);
  });

  it("dashboard APIs answer", async () => {
    const dash = createDashboardServer({ port: 0 });
    await new Promise((resolve) => dash.server.listen(0, resolve));
    const { port } = dash.server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/strategies`);
    const body = await res.json();
    assert.ok(body.strategies.includes("FIFO-0.1"));
    const page = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /Guardian Arena/);
    await dash.close();
  });
});

describe("sprint3 strategies", () => {
  it("each strategy bit-exact reconstructs", () => {
    for (const strategyKey of listStrategies()) {
      let t = 0;
      const report = new SimulationController({
        strategyKey,
        now: () => ++t,
      }).run(Buffer.from(`fixture-${strategyKey}`), { objectId: strategyKey });
      assert.equal(report.RESULT.exact_match, true, strategyKey);
      assert.equal(report.STATUS, "REPRODUCIBLE", strategyKey);
    }
  });

  it("adaptive uses Immediate for tiny jobs", () => {
    let t = 0;
    const report = new SimulationController({
      strategyKey: "ADAPTIVE-0.1",
      now: () => ++t,
    }).run(Buffer.from("tiny"), { objectId: "tiny" });
    assert.equal(report.BENCHMARK_META.lane, "Immediate");
  });
});

describe("sprint4 stress", () => {
  it("classifies long-tail", () => {
    assert.equal(classifyTail(100).class, "short-tail");
    assert.equal(classifyTail(5000).class, "long-tail");
  });

  it("survives dropped node with redundancy", () => {
    const { envelope } = runStressBenchmark({
      strategyKey: "REDOPT-0.1",
      dropNodeIds: ["node-0"],
    });
    assert.equal(envelope.RESULT.exact_match, true);
    assert.ok(envelope.STRESS);
    assert.ok(envelope.STRESS.drop_node_ids.includes("node-0"));
  });

  it("repairs missing replica from survivor", () => {
    const storage = StorageModel.createUniformCluster({ count: 3, capacity: 1_000_000 });
    const data = Buffer.from("repair-me");
    storage.storeOn("node-0", "frag:0:r0", data);
    storage.markOffline("node-0");
    // Place a copy on node-1 so retrieveAnywhere works after drop
    storage.markOnline("node-0");
    storage.storeOn("node-1", "frag:0:r0", data);
    storage.markOffline("node-0");
    const repaired = storage.repairFragment("frag:0:r0");
    assert.equal(repaired.ok, true);
    assert.equal(storage.retrieveAnywhere("frag:0:r0").ok, true);
  });

  it("churn model emits offline/online events", () => {
    const storage = StorageModel.createUniformCluster({ count: 3, capacity: 1_000_000 });
    const failure = new FailureModel({ churnEveryNStores: 1 });
    for (let i = 0; i < 3; i++) {
      storage.storeRoundRobin(`f${i}`, Buffer.from(`x${i}`));
      failure.onStore(storage);
    }
    assert.ok(failure.events.some((e) => e.kind === "CHURN_OFFLINE"));
  });
});

describe("sprint5 adapters", () => {
  it("lists stubs without importing root trader", () => {
    const stubs = listAdapterStubs();
    assert.ok(stubs.length >= 3);
    const hitch = new HitchInjectorAdapter();
    const boundary = hitch.describeBoundary();
    assert.ok(boundary.live_modules.includes("agent.js"));
    assert.equal(boundary.coupling, "forbidden_until_explicit_design");
  });
});

describe("compare replays", () => {
  it("detects identical vs different strategy hashes", () => {
    let t = 100;
    const a = new SimulationController({ strategyKey: "FIFO-0.1", now: () => ++t }).run("same");
    t = 100;
    const b = new SimulationController({ strategyKey: "FIFO-0.1", now: () => ++t }).run("same");
    t = 100;
    const c = new SimulationController({ strategyKey: "ADAPTIVE-0.1", now: () => ++t }).run("same");
    assert.equal(compareReplays(a, b).same_hash, true);
    assert.equal(compareReplays(a, c).same_hash, false);
  });
});
