/**
 * WAVE-ROBIN agent tests — pure wave math, IFTTT cascade, RH fixture, OS boot.
 * Never invents order ids or tx hashes. SIM default.
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { HOME_SECTIONS } from "./telegram-home.js";
import { setOsBuilderPathForTests } from "./os-builder.js";
import { WAVE_ROBIN_FIXTURE } from "./memory/wave-robin-fixture.js";
import {
  WAVE_ROBIN_ID,
  WAVE_ROBIN_AGENT_ID,
  WAVE_ROBIN_MAGIC,
  WAVE_ROBIN_TRIGGERS,
  assertWaveRobinCallbacksFit,
  bootstrapWaveRobinBrain,
  computePureWaveEnvelope,
  evaluateWaveTrigger,
  handleWaveRobinAction,
  parseWaveRobinCommand,
  proveAccumulation,
  rhWaveLiveEnabled,
  runWaveRobinOnRhPayload,
  runWaveRobinSandbox,
  seatFromRobinhood,
  setWaveRobinPathForTests,
  stageRhOrderSim,
} from "./wave-robin-agent.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

describe("wave-robin identity", () => {
  it("exports agent identity + triggers", () => {
    assert.equal(WAVE_ROBIN_ID, "vita-wave-robin-v1");
    assert.equal(WAVE_ROBIN_AGENT_ID, "wave-robin");
    assert.match(WAVE_ROBIN_MAGIC, /^§WAVEROBIN§/);
    assert.ok(WAVE_ROBIN_TRIGGERS.some((t) => t.id === "trough-buy"));
    assert.ok(WAVE_ROBIN_TRIGGERS.some((t) => t.id === "cascade-hop"));
    assert.equal(rhWaveLiveEnabled({}), false);
    assert.equal(rhWaveLiveEnabled({ RH_WAVE_LIVE: "yes" }), true);
  });

  it("callbacks fit Telegram 64B", () => {
    assert.equal(assertWaveRobinCallbacksFit().ok, true);
  });

  it("parses aliases", () => {
    assert.equal(parseWaveRobinCommand("/waveai").action, "home");
    assert.equal(parseWaveRobinCommand("/rhwave sandbox").action, "sandbox");
    assert.equal(parseWaveRobinCommand("/waveagent accum").action, "accum");
  });
});

describe("pure wave math", () => {
  it("computes phase sin and trough/peak envelope", () => {
    const bars = [];
    for (let i = 0; i < 20; i++) {
      const mid = 100 + 20 * Math.sin((Math.PI * i) / 19);
      bars.push({
        open_price: String(mid - 1),
        close_price: String(mid),
        high_price: String(mid + 3),
        low_price: String(mid - 3),
      });
    }
    const low = computePureWaveEnvelope(bars, 82);
    assert.equal(low.ready, true);
    assert.ok(low.rangePos <= 0.2);
    assert.ok(low.phaseSin >= 0);

    const high = computePureWaveEnvelope(bars, 118);
    assert.ok(high.rangePos >= 0.7);
  });

  it("evaluates trough-buy and peak-arm triggers", () => {
    const buy = evaluateWaveTrigger("trough-buy", { rangePos: 0.08 });
    assert.equal(buy.fired, true);
    const nobuy = evaluateWaveTrigger("trough-buy", { rangePos: 0.5 });
    assert.equal(nobuy.fired, false);
    const arm = evaluateWaveTrigger("peak-arm", { movingUpArmed: true });
    assert.equal(arm.fired, true);
  });
});

describe("wave-robin agent loop", () => {
  before(() => {
    const tmp = mkdtempSync(join(tmpdir(), "wave-robin-"));
    setWaveRobinPathForTests(join(tmp, "state.json"));
    setOsBuilderPathForTests(join(tmp, "os-state.json"));
  });

  it("sandbox fires trough-buy + cascade + peak-arm", () => {
    const sand = runWaveRobinSandbox();
    assert.equal(sand.ok, true);
    const ids = sand.fires.map((f) => f.recipeId);
    assert.ok(ids.includes("trough-buy"));
    assert.ok(ids.includes("cascade-hop") || ids.includes("peak-arm"));
    assert.ok(sand.staged.length >= 1);
    assert.ok(sand.waveEnergy > 0);
    for (const o of sand.staged) {
      assert.equal(o.sim, true);
      assert.equal(o.placed, false);
      assert.match(o.refId, /^[0-9a-f-]{36}$/i);
    }
  });

  it("runs on live Robinhood fixture and proves accumulation", () => {
    const out = runWaveRobinOnRhPayload({
      quotes: WAVE_ROBIN_FIXTURE.quotes,
      historicals: WAVE_ROBIN_FIXTURE.historicals,
      portfolio: WAVE_ROBIN_FIXTURE.portfolio,
      positions: WAVE_ROBIN_FIXTURE.positions,
    });
    assert.equal(out.ok, true);
    assert.equal(out.agentId, "wave-robin");
    assert.ok(out.seats.some((s) => s.symbol === "HOOD"));
    assert.ok(out.accumulation?.ok);
    assert.ok(out.accumulation.snap.totalValueUsd > 0);
    assert.equal(out.liveEnabled, false);
    // Second snap with growth → proof
    const grown = proveAccumulation({
      totalValueUsd: 20.5,
      cryptoValueUsd: 19.5,
      cashUsd: 1,
      source: "test-growth",
    });
    assert.ok(grown.proof);
    assert.match(grown.proof.commit, /^[0-9a-f]{64}$/);
  });

  it("stages SIM only — never marks placed without live gate", () => {
    const st = stageRhOrderSim({
      symbol: "HOOD",
      side: "buy",
      dollarAmount: "1.00",
      reason: "test",
    });
    assert.equal(st.order.sim, true);
    assert.equal(st.order.placed, false);
  });

  it("bootstrap registers OS brain", () => {
    const boot = bootstrapWaveRobinBrain();
    assert.equal(boot.ok, true);
    assert.equal(boot.agentId, "wave-robin");
    assert.ok(boot.seal.contentCommit);
  });

  it("handleWaveRobinAction returns keyboards", () => {
    const out = handleWaveRobinAction({ action: "status" });
    assert.equal(out.ok, true);
    assert.ok(out.reply.includes("WAVE-ROBIN") || out.reply.includes("waveEnergy"));
    assert.equal(out.callbackFit.ok, true);
  });
});

describe("wave-robin wiring", () => {
  it("HOME exposes Wave AI under OS or Agents", () => {
    const os = HOME_SECTIONS.find((s) => s.id === "os");
    assert.ok(os);
    assert.ok(os.buttons.some((b) => /waveai|rhwave/i.test(b.cmd)));
  });

  it("agent.js + FILING + AGENTS mention wave-robin", () => {
    const agent = readFileSync(join(ROOT, "agent.js"), "utf8");
    assert.match(agent, /wave-robin-agent|parseWaveRobinCommand|\/waveai/);
    const filing = readFileSync(join(HERE, "FILING.md"), "utf8");
    const agents = readFileSync(join(HERE, "AGENTS.md"), "utf8");
    assert.match(filing, /WAVE_ROBIN|wave-robin/);
    assert.match(agents, /waveai|WAVE-ROBIN|wave-robin/i);
  });

  it("module + fixture files exist", () => {
    assert.equal(existsSync(join(HERE, "wave-robin-agent.js")), true);
    assert.equal(existsSync(join(HERE, "memory/wave-robin-fixture.js")), true);
  });
});
