/**
 * Capped 3-token WAVE proof — planner, caps, reconstruct. Mother brain untouched.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  WAVE_PROOF_DEFAULT_SYMS,
  WAVE_PROOF_MAX_SENDS,
  WAVE_PROOF_MIN_LIQUID_USD_DEFAULT,
  compareProofShardsToAnswerKey,
  evaluateWaveProofGate,
  handleWaveProofAction,
  parseWaveProofCommand,
  planWaveProof,
  resetWaveProofLiveLatch,
  runCappedWaveProofSends,
  runWaveProof,
  waveProofLiveEnabled,
  waveProofLiveSpent,
  waveProofMinLiquidUsd,
} from "./wave-proof.js";
import {
  WAVE_MIN_BODY_BYTES,
  WAVE_WISE_MESSAGE,
  createWaveSimChain,
  loadWaveAnswerKey,
  parseWaveLine,
  sha256HexUtf8,
  splitUtf8ByBytes,
} from "./wave-wrap.js";
import { vitaFeedPaidEnabled } from "./vita-feed.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("WAVE proof planner", () => {
  it("plans exactly 3 least-size 8B shards with VIRTUAL CLANKER AERO", () => {
    const planned = planWaveProof({ vinId: "VIN-PROOF0001" });
    assert.equal(planned.ok, true);
    assert.equal(planned.lines.length, WAVE_PROOF_MAX_SENDS);
    assert.deepEqual(planned.symbols, [...WAVE_PROOF_DEFAULT_SYMS]);
    const prefix = splitUtf8ByBytes(WAVE_WISE_MESSAGE, WAVE_MIN_BODY_BYTES).slice(0, 3);
    for (let i = 0; i < 3; i++) {
      const line = planned.lines[i];
      assert.equal(line.symbol, WAVE_PROOF_DEFAULT_SYMS[i]);
      assert.equal(line.bodyBytes, 8);
      assert.equal(line.body, prefix[i]);
      assert.equal(line.total, 3);
      assert.match(line.hex, /^0x[0-9a-f]+$/);
      const parsed = parseWaveLine(line.line);
      assert.equal(parsed.symbol, WAVE_PROOF_DEFAULT_SYMS[i]);
      assert.equal(parsed.vinId, "VIN-PROOF0001");
      assert.equal(parsed.index, i + 1);
      assert.equal(parsed.total, 3);
    }
    assert.equal(planned.lines[2].nextPtr, "END");
  });

  it("per-shard bodies match the Heraclitus answer-key digests", () => {
    const planned = planWaveProof({ vinId: "VIN-PROOFKEY1" });
    const key = loadWaveAnswerKey();
    const cmp = compareProofShardsToAnswerKey(planned.lines, key);
    assert.equal(cmp.ok, true);
    assert.equal(cmp.shardsMatch, true);
    assert.equal(cmp.prefixMatch, true);
    for (let i = 0; i < 3; i++) {
      assert.equal(cmp.shardResults[i].sha256, key.shards[i].sha256);
    }
    assert.notEqual(sha256HexUtf8(cmp.reconstructed), key.sha256, "3 shards are not the full 28-shard dump");
  });
});

describe("WAVE proof caps + gate", () => {
  beforeEach(() => resetWaveProofLiveLatch());

  it("WAVE_PROOF_LIVE default off; liquid floor default $1", () => {
    assert.equal(waveProofLiveEnabled({}), false);
    assert.equal(waveProofLiveEnabled({ WAVE_PROOF_LIVE: "" }), false);
    assert.equal(waveProofLiveEnabled({ WAVE_PROOF_LIVE: "no" }), false);
    assert.equal(waveProofLiveEnabled({ WAVE_PROOF_LIVE: "yes" }), true);
    assert.equal(waveProofMinLiquidUsd({}), WAVE_PROOF_MIN_LIQUID_USD_DEFAULT);
    assert.equal(waveProofMinLiquidUsd({ WAVE_PROOF_MIN_LIQUID_USD: "1" }), 1);
    assert.equal(waveProofMinLiquidUsd({ VITAFEED_MIN_LIQUID_USD: "5" }), 5);
  });

  it("live without WAVE_PROOF_LIVE SIMs; live with env but no sendTx refuses invent", async () => {
    const sim = await runWaveProof({ live: true, env: {} });
    assert.equal(sim.ok, true);
    assert.equal(sim.pass, true);
    assert.equal(sim.sim, true);
    assert.equal(sim.live, false);
    const refuse = await runWaveProof({
      live: true,
      env: { WAVE_PROOF_LIVE: "yes" },
      liquidUsd: 10,
    });
    assert.equal(refuse.ok, false);
    assert.equal(refuse.pass, false);
    assert.match(refuse.reason, /no sendTx|refuse invent/);
  });

  it("refuses live when RISK liquid is below the floor", () => {
    const gate = evaluateWaveProofGate({
      live: true,
      env: { WAVE_PROOF_LIVE: "yes" },
      liquidUsd: 0.4,
      sendTx: async () => null,
    });
    assert.equal(gate.ok, false);
    assert.equal(gate.code, "liquid-floor");
  });

  it("capped sender never exceeds 3 calls; abort if liquid would breach", async () => {
    const planned = planWaveProof({ vinId: "VIN-PROOFCAP1" });
    let calls = 0;
    const chain = createWaveSimChain();
    const inscribed = await runCappedWaveProofSends(planned, async (hex) => {
      calls += 1;
      return chain.sendTx(hex);
    }, { maxSends: 99 });
    assert.equal(calls, 3);
    assert.equal(inscribed.txHashes.length, 3);

    resetWaveProofLiveLatch();
    let mid = 0;
    const aborted = await runCappedWaveProofSends(planned, async () => {
      mid += 1;
      return "0x" + String(mid).padStart(64, "b");
    }, { liquidUsd: 1.35, costUsdPerSend: 0.2, floor: 1, maxSends: 3 });
    assert.equal(aborted.ok, true);
    assert.ok(aborted.aborted);
    assert.ok(mid < 3);
    assert.ok(aborted.txHashes.length < 3);
  });

  it("live batch auto-disables; second live refuses; VITAFEED_PAID stays off", async () => {
    const env = { WAVE_PROOF_LIVE: "yes" };
    const chain = createWaveSimChain();
    const first = await runWaveProof({
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
    assert.equal(first.inscribed.txHashes.length, 3);
    assert.equal(waveProofLiveSpent(), true);
    assert.equal(env.WAVE_PROOF_LIVE, "no");
    assert.equal(vitaFeedPaidEnabled(env), false);

    const second = await runWaveProof({
      live: true,
      env: { WAVE_PROOF_LIVE: "yes" },
      sendTx: chain.sendTx,
      fetchCalldata: chain.fetchCalldata,
      liquidUsd: 10,
    });
    assert.equal(second.ok, false);
    assert.match(second.reason, /already spent|refuse further/);
  });
});

describe("WAVE proof reconstruct + handlers", () => {
  beforeEach(() => resetWaveProofLiveLatch());

  it("SIM /waveproof reconstructs vs answer-key shards and does not pay", async () => {
    assert.equal(parseWaveProofCommand("/waveproof").action, "run");
    const out = await handleWaveProofAction({ action: "run", env: {} });
    assert.equal(out.pass, true);
    assert.equal(out.send, false);
    assert.match(out.reply, /PASS/);
    assert.match(out.reply, /VIRTUAL/);
    assert.match(out.reply, /CLANKER/);
    assert.match(out.reply, /AERO/);
    assert.match(out.reply, /VITAFEED_PAID untouched/);
    assert.equal(vitaFeedPaidEnabled({}), false);
  });

  it("null sendTx does not invent a hash", async () => {
    const planned = planWaveProof({ vinId: "VIN-PROOFNULL" });
    const inscribed = await runCappedWaveProofSends(planned, async () => null);
    assert.equal(inscribed.ok, true);
    assert.equal(inscribed.sealedCount, 0);
    assert.deepEqual(inscribed.txHashes, []);
  });
});

describe("WAVE proof wiring stays off mother brain", () => {
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

  it("agent /waveproof is a thin hook; does not re-enable VITAFEED_PAID or vitaSave", () => {
    const agent = readFileSync(join(root, "agent.js"), "utf8");
    assert.match(agent, /\/waveproof/);
    assert.match(agent, /handleWaveProofAction/);
    const wStart = agent.indexOf("/waveproof");
    assert.ok(wStart >= 0);
    const slice = agent.slice(wStart, wStart + 2200);
    assert.ok(slice.includes("handleWaveProofAction"));
    assert.ok(!slice.includes("vitaSave("));
    assert.ok(!slice.includes("inscribeChunk("));
    assert.ok(!slice.includes('VITAFEED_PAID: "yes"'));
    assert.ok(!slice.includes("ALLOW_LOSSY"));
    assert.ok(slice.includes("value: BigInt(0)") || slice.includes("value: 0n"));
  });
});
