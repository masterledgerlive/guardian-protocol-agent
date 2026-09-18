/**
 * Full-quote WAVE inject — planner, 28-shard reconstruct. Mother brain untouched.
 * /waveproof stays capped at 3. CI is SIM-only (no live Base).
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  WAVE_FULL_DEFAULT_SYMS,
  WAVE_FULL_EXPECTED_SHARDS,
  WAVE_FULL_MIN_LIQUID_USD_DEFAULT,
  compareFullQuoteToAnswerKey,
  evaluateWaveFullGate,
  formatWaveFullHttpResult,
  handleWaveFullAction,
  isTransientWaveSendError,
  maybeAutofireWaveFull,
  parseWaveFullCommand,
  peekWaveFullPartial,
  planWaveFull,
  resetWaveFullAutofireLatch,
  resetWaveFullLiveLatch,
  resolveWaveFullResume,
  runFullWaveSends,
  runWaveFull,
  sendWaveTxWithRetry,
  wantsDeskWaveFullLive,
  waveFullAutofireEnabled,
  waveFullAutofireSpent,
  waveFullLiveEnabled,
  waveFullLiveSpent,
  waveFullMinLiquidUsd,
} from "./wave-full.js";
import {
  WAVE_PROOF_MAX_SENDS,
  planWaveProof,
} from "./wave-proof.js";
import {
  WAVE_WISE_MESSAGE,
  createWaveSimChain,
  loadWaveAnswerKey,
  parseWaveLine,
  sha256HexUtf8,
} from "./wave-wrap.js";
import { vitaFeedPaidEnabled } from "./vita-feed.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("WAVE full-quote planner", () => {
  it("plans all 28 least-size shards with a new VIN and rotating SYMs", () => {
    const planned = planWaveFull({ vinId: "VIN-FULL00001" });
    assert.equal(planned.ok, true);
    assert.equal(planned.lines.length, WAVE_FULL_EXPECTED_SHARDS);
    assert.equal(planned.vinId, "VIN-FULL00001");
    assert.deepEqual(planned.symbols, [...WAVE_FULL_DEFAULT_SYMS]);
    const key = loadWaveAnswerKey();
    let joined = "";
    for (let i = 0; i < WAVE_FULL_EXPECTED_SHARDS; i++) {
      const line = planned.lines[i];
      assert.equal(line.symbol, WAVE_FULL_DEFAULT_SYMS[i % 3]);
      assert.equal(line.total, 28);
      assert.equal(line.index, i + 1);
      assert.equal(line.bodyBytes, key.shards[i].bodyBytes);
      joined += line.body;
      const parsed = parseWaveLine(line.line);
      assert.equal(parsed.vinId, "VIN-FULL00001");
      assert.equal(parsed.index, i + 1);
      assert.equal(parsed.total, 28);
      assert.equal(parsed.key8, key.key8);
      assert.equal(parsed.loc8, key.shards[i].loc8);
    }
    assert.equal(planned.lines[0].bodyBytes, 8);
    assert.equal(planned.lines[27].bodyBytes, 1);
    assert.equal(planned.lines[27].nextPtr, "END");
    assert.equal(joined, WAVE_WISE_MESSAGE);
    assert.equal(sha256HexUtf8(joined), key.sha256);
    assert.equal(key.key8, "fde449b7");
  });

  it("does not pretend the 01/03 thrift VIN is 28", () => {
    const proof = planWaveProof({ vinId: "VIN-PROOF0001" });
    const full = planWaveFull({ vinId: "VIN-FULL00002" });
    assert.equal(proof.lines.length, WAVE_PROOF_MAX_SENDS);
    assert.equal(proof.lines[0].total, 3);
    assert.equal(full.lines.length, 28);
    assert.equal(full.lines[0].total, 28);
    assert.notEqual(proof.vinId, full.vinId);
  });

  it("PASS only when joined sha256 and each LOC8 match the answer key", () => {
    const planned = planWaveFull({ vinId: "VIN-FULLKEY01" });
    const key = loadWaveAnswerKey();
    const cmp = compareFullQuoteToAnswerKey(planned.lines, key);
    assert.equal(cmp.ok, true);
    assert.equal(cmp.messageMatch, true);
    assert.equal(cmp.shardsMatch, true);
    assert.equal(cmp.loc8Match, true);
    assert.equal(cmp.sha256, key.sha256);
    assert.equal(cmp.reconstructed, WAVE_WISE_MESSAGE);
    for (let i = 0; i < 28; i++) {
      assert.equal(cmp.shardResults[i].ok, true);
      assert.equal(cmp.shardResults[i].loc8, key.shards[i].loc8);
    }

    const broken = planned.lines.map((line, i) => (
      i === 4 ? { ...line, body: "XXXXXXXX", loc8: "deadbeef" } : line
    ));
    const fail = compareFullQuoteToAnswerKey(broken, key);
    assert.equal(fail.ok, false);
    assert.equal(fail.messageMatch, false);
  });
});

describe("WAVE full-quote caps + gate", () => {
  beforeEach(() => {
    resetWaveFullLiveLatch();
    resetWaveFullAutofireLatch();
  });

  it("WAVE_FULL_LIVE default off; liquid floor default $1 (reuses WAVE_PROOF_MIN_LIQUID_USD)", () => {
    assert.equal(waveFullLiveEnabled({}), false);
    assert.equal(waveFullLiveEnabled({ WAVE_FULL_LIVE: "" }), false);
    assert.equal(waveFullLiveEnabled({ WAVE_FULL_LIVE: "no" }), false);
    assert.equal(waveFullLiveEnabled({ WAVE_FULL_LIVE: "yes" }), true);
    assert.equal(waveFullMinLiquidUsd({}), WAVE_FULL_MIN_LIQUID_USD_DEFAULT);
    assert.equal(waveFullMinLiquidUsd({ WAVE_FULL_MIN_LIQUID_USD: "2" }), 2);
    assert.equal(waveFullMinLiquidUsd({ WAVE_PROOF_MIN_LIQUID_USD: "1" }), 1);
    assert.equal(waveFullMinLiquidUsd({ VITAFEED_MIN_LIQUID_USD: "5" }), 5);
  });

  it("live without WAVE_FULL_LIVE SIMs; live with env but no sendTx refuses invent", async () => {
    const sim = await runWaveFull({ live: true, env: {} });
    assert.equal(sim.ok, true);
    assert.equal(sim.pass, true);
    assert.equal(sim.sim, true);
    assert.equal(sim.live, false);
    assert.equal(sim.inscribed.txHashes.length, 28);
    const refuse = await runWaveFull({
      live: true,
      env: { WAVE_FULL_LIVE: "yes" },
      liquidUsd: 10,
    });
    assert.equal(refuse.ok, false);
    assert.equal(refuse.pass, false);
    assert.match(refuse.reason, /no sendTx|refuse invent/);
  });

  it("refuses live when RISK liquid is below the floor", () => {
    const gate = evaluateWaveFullGate({
      live: true,
      env: { WAVE_FULL_LIVE: "yes" },
      liquidUsd: 0.4,
      sendTx: async () => null,
    });
    assert.equal(gate.ok, false);
    assert.equal(gate.code, "liquid-floor");
  });

  it("sender fires all 28; abort if liquid would breach; never invents a hash", async () => {
    const planned = planWaveFull({ vinId: "VIN-FULLCAP01" });
    let calls = 0;
    const chain = createWaveSimChain();
    const inscribed = await runFullWaveSends(planned, async (hex) => {
      calls += 1;
      return chain.sendTx(hex);
    });
    assert.equal(calls, 28);
    assert.equal(inscribed.txHashes.length, 28);

    let mid = 0;
    const aborted = await runFullWaveSends(planned, async () => {
      mid += 1;
      return "0x" + String(mid).padStart(64, "b");
    }, { liquidUsd: 1.15, costUsdPerSend: 0.05, floor: 1 });
    assert.equal(aborted.ok, true);
    assert.ok(aborted.aborted);
    assert.ok(mid < 28);
    assert.ok(aborted.txHashes.length < 28);

    const none = await runFullWaveSends(planned, async () => null);
    assert.equal(none.ok, true);
    assert.equal(none.sealedCount, 0);
    assert.deepEqual(none.txHashes, []);
  });

  it("live batch auto-disables; second live refuses; VITAFEED_PAID stays off", async () => {
    const env = { WAVE_FULL_LIVE: "yes" };
    const chain = createWaveSimChain();
    const first = await runWaveFull({
      live: true,
      env,
      sendTx: chain.sendTx,
      fetchCalldata: chain.fetchCalldata,
      liquidUsd: 10,
      quotes: { gwei: 0.05, ethUsd: 2481 },
    });
    assert.equal(first.ok, true);
    assert.equal(first.pass, true);
    assert.equal(first.live, true);
    assert.equal(first.inscribed.txHashes.length, 28);
    assert.equal(waveFullLiveSpent(), true);
    assert.equal(env.WAVE_FULL_LIVE, "no");
    assert.equal(vitaFeedPaidEnabled(env), false);

    const second = await runWaveFull({
      live: true,
      env: { WAVE_FULL_LIVE: "yes" },
      sendTx: chain.sendTx,
      fetchCalldata: chain.fetchCalldata,
      liquidUsd: 10,
    });
    assert.equal(second.ok, false);
    assert.match(second.reason, /already spent|refuse further/);
  });

  it("WAVE_FULL_AUTOFIRE default off; fires once then disables LIVE", async () => {
    assert.equal(waveFullAutofireEnabled({}), false);
    assert.equal(waveFullAutofireEnabled({ WAVE_FULL_AUTOFIRE: "yes" }), true);
    const skipped = await maybeAutofireWaveFull({
      env: { WAVE_FULL_LIVE: "yes" },
      sendTx: async () => "0x" + "c".repeat(64),
      liquidUsd: 10,
    });
    assert.equal(skipped.fired, false);
    assert.match(skipped.reason, /default off/);

    const env = { WAVE_FULL_LIVE: "yes", WAVE_FULL_AUTOFIRE: "yes" };
    const chain = createWaveSimChain();
    const first = await maybeAutofireWaveFull({
      env,
      sendTx: chain.sendTx,
      fetchCalldata: chain.fetchCalldata,
      liquidUsd: 10,
      quotes: { gwei: 0.05, ethUsd: 2481 },
    });
    assert.equal(first.fired, true);
    assert.equal(first.pass, true);
    assert.equal(first.result.inscribed.txHashes.length, 28);
    assert.equal(env.WAVE_FULL_AUTOFIRE, "no");
    assert.equal(env.WAVE_FULL_LIVE, "no");
    assert.equal(waveFullAutofireSpent(), true);
    assert.equal(vitaFeedPaidEnabled(env), false);

    env.WAVE_FULL_LIVE = "yes";
    env.WAVE_FULL_AUTOFIRE = "yes";
    const second = await maybeAutofireWaveFull({
      env,
      sendTx: chain.sendTx,
      fetchCalldata: chain.fetchCalldata,
      liquidUsd: 10,
    });
    assert.equal(second.fired, false);
    assert.match(second.reason, /already spent|refuse further/);
  });

  it("retries transient CDP/RPC errors then seals the shard", async () => {
    assert.equal(isTransientWaveSendError(new Error("Service unavailable")), true);
    assert.equal(isTransientWaveSendError({ status: 429, message: "rate" }), true);
    assert.equal(isTransientWaveSendError(new Error("sender returned non-hash")), false);
    let calls = 0;
    const hash = await sendWaveTxWithRetry(async () => {
      calls += 1;
      if (calls < 3) throw new Error("Service unavailable");
      return "0x" + "a".repeat(64);
    }, "0x11", {}, { retries: 3, backoffMs: 1, sleep: async () => {} });
    assert.equal(calls, 3);
    assert.match(hash, /^0xa+$/);
  });

  it("partial live abort leaves LIVE armed; resume same VIN then PASS reconstruct", async () => {
    const env = { WAVE_FULL_LIVE: "yes", WAVE_FULL_RETRY_MS: "0", WAVE_FULL_SEND_RETRIES: "3" };
    const chain = createWaveSimChain();
    let sealed = 0;
    const flaky = async (hex) => {
      if (sealed >= 5) throw new Error("Service unavailable");
      sealed += 1;
      return chain.sendTx(hex);
    };
    const first = await runWaveFull({
      live: true,
      env,
      vinId: "VIN-5785B9B4E1",
      sendTx: flaky,
      fetchCalldata: chain.fetchCalldata,
      liquidUsd: 10,
      quotes: { gwei: 0.05, ethUsd: 2481 },
      sleep: async () => {},
    });
    assert.equal(first.ok, true);
    assert.equal(first.pass, false);
    assert.equal(first.partial, true);
    assert.equal(first.inscribed.sealedCount, 5);
    assert.equal(first.vinId, "VIN-5785B9B4E1");
    assert.equal(waveFullLiveSpent(), false);
    assert.equal(env.WAVE_FULL_LIVE, "yes");
    const partial = peekWaveFullPartial();
    assert.equal(partial.vinId, "VIN-5785B9B4E1");
    assert.equal(partial.fromIndex, 6);

    const planned = planWaveFull({ vinId: "VIN-5785B9B4E1" });
    const again = planWaveFull({ vinId: "VIN-5785B9B4E1" });
    assert.equal(again.lines[5].line, planned.lines[5].line);
    assert.equal(again.lines[5].prevHash, planned.lines[5].prevHash);

    const resume = await runWaveFull({
      live: true,
      env,
      vinId: "VIN-5785B9B4E1",
      fromIndex: 6,
      sealedHashes: first.inscribed.txHashes,
      sendTx: chain.sendTx,
      fetchCalldata: chain.fetchCalldata,
      liquidUsd: 10,
      quotes: { gwei: 0.05, ethUsd: 2481 },
      sleep: async () => {},
    });
    assert.equal(resume.ok, true);
    assert.equal(resume.pass, true);
    assert.equal(resume.vinId, "VIN-5785B9B4E1");
    assert.equal(resume.inscribed.txHashes.length, 28);
    assert.equal(resume.inscribed.chunks[0].resumed, true);
    assert.equal(resume.inscribed.chunks[5].resumed, false);
    assert.equal(resume.compared.messageMatch, true);
    assert.equal(resume.compared.loc8Match, true);
    assert.equal(waveFullLiveSpent(), true);
    assert.equal(env.WAVE_FULL_LIVE, "no");
    assert.equal(vitaFeedPaidEnabled(env), false);
  });

  it("autofire does not resume WAVE_FULL_RESUME_VIN (desk POST resumes)", () => {
    const resolved = resolveWaveFullResume({
      env: { WAVE_FULL_RESUME_VIN: "VIN-5785B9B4E1", WAVE_FULL_RESUME_FROM: "6" },
      autofire: true,
    });
    assert.equal(resolved.resume, false);
    assert.equal(resolved.fromIndex, 1);
    const desk = resolveWaveFullResume({
      vinId: "VIN-5785B9B4E1",
      fromIndex: 6,
      sealedHashes: ["0x" + "b".repeat(64)],
    });
    assert.equal(desk.resume, true);
    assert.equal(desk.fromIndex, 6);
    assert.equal(parseWaveFullCommand("/wavefull resume VIN-5785B9B4E1 6").vinId, "VIN-5785B9B4E1");
    assert.equal(parseWaveFullCommand("/wavefull resume VIN-5785B9B4E1 6").fromIndex, 6);
  });
});

describe("WAVE full-quote reconstruct + handlers", () => {
  beforeEach(() => {
    resetWaveFullLiveLatch();
    resetWaveFullAutofireLatch();
  });

  it("SIM /wavefull reconstructs the full quote and does not pay", async () => {
    assert.equal(parseWaveFullCommand("/wavefull").action, "run");
    const out = await handleWaveFullAction({ action: "run", env: {} });
    assert.equal(out.pass, true);
    assert.equal(out.send, false);
    assert.match(out.reply, /PASS/);
    assert.match(out.reply, /VIRTUAL/);
    assert.match(out.reply, /28/);
    assert.match(out.reply, /VITAFEED_PAID untouched/);
    assert.equal(out.result.compared.messageMatch, true);
    assert.equal(out.result.compared.loc8Match, true);
    assert.equal(vitaFeedPaidEnabled({}), false);
    const http = formatWaveFullHttpResult(out);
    assert.equal(http.reconstruct, "PASS");
    assert.equal(http.txHashes.length, 28);
    assert.equal(http.expectedShards, 28);
    assert.equal(http.waveProofUnchanged, true);
    assert.equal(wantsDeskWaveFullLive({ method: "GET" }), false);
    assert.equal(wantsDeskWaveFullLive({ method: "POST" }), true);
    assert.equal(wantsDeskWaveFullLive({ method: "GET", searchParams: { live: "1" } }), true);
  });
});

describe("WAVE full-quote wiring stays off mother brain + leaves /waveproof at 3", () => {
  it("git diff main is empty for VITA root inscription files", () => {
    const frozen = [
      "vita-memory.js",
      "memory-engine.js",
      "vita/mainframe.js",
      "vita/ORIGINAL_FORMULA.md",
      "vita/anchors.json",
      "vita/mother-genesis.js",
      "vita/FILING.md",
      "vita/AGENTS.md",
    ];
    for (const f of frozen) {
      let diff = "";
      try {
        diff = execSync("git diff main -- " + f, { encoding: "utf8", cwd: root });
      } catch {
        diff = execSync("git diff origin/main -- " + f, { encoding: "utf8", cwd: root });
      }
      assert.equal(diff, "", f + " must stay untouched vs main");
    }
  });

  it("agent /wavefull is a thin hook; hitch still calls attachWaveOnCoveredLeftover", () => {
    const agent = readFileSync(join(root, "agent.js"), "utf8");
    assert.match(agent, /\/wavefull/);
    assert.match(agent, /handleWaveFullAction/);
    assert.match(agent, /maybeAutofireWaveFullOnBoot/);
    assert.match(agent, /attachWaveOnCoveredLeftover/);
    assert.match(agent, /hitchWaveOnSellLeftover/);
    const wStart = agent.indexOf("/wavefull");
    assert.ok(wStart >= 0);
    const slice = agent.slice(wStart, wStart + 2200);
    assert.ok(slice.includes("handleWaveFullAction"));
    assert.ok(!slice.includes("vitaSave("));
    assert.ok(!slice.includes("inscribeChunk("));
    assert.ok(!slice.includes('VITAFEED_PAID: "yes"'));
    assert.ok(!slice.includes("ALLOW_LOSSY"));
    assert.ok(agent.includes("value: BigInt(0)") || agent.includes("value: 0n"));
    assert.equal(WAVE_PROOF_MAX_SENDS, 3);
  });
});
