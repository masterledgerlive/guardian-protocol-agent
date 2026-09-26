/**
 * WAVE wrap unit tests — mother brain untouched, VITAFEED_PAID stays off.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  WAVE_DEFAULT_BODY_BYTES,
  WAVE_HEADER,
  WAVE_MAX_BODY_BYTES,
  WAVE_MIN_BODY_BYTES,
  WAVE_WISE_MESSAGE,
  WAVE_WISE_SYM,
  WAVE_WRAP_ID,
  attachWaveOnCoveredLeftover,
  clampWaveBodyBudget,
  commitWaveHitchShard,
  hexToUtf8,
  hitchWaveOnSellLeftover,
  parseWaveLine,
  peekNextWaveHitchShard,
  planWaveShards,
  prepareWaveWrap,
  reconstructWaveBody,
  resetWaveHitchCursor,
  utf8FromWaveCalldata,
  utf8ToHex,
  waveHitchCursorIndex,
  waveMirrorPaidEnabled,
  WAVE_EXACT_INPUT_BYTES,
} from "./wave-wrap.js";
import { vitaFeedPaidEnabled } from "./vita-feed.js";
import { KEYCAT_PLAIN_SWAP, appendUtf8Hitch } from "../swap-minout.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("WAVE wrap wire", () => {
  it("least-size budget is 8–128 B (default 8)", () => {
    assert.equal(WAVE_MIN_BODY_BYTES, 8);
    assert.equal(WAVE_MAX_BODY_BYTES, 128);
    assert.equal(WAVE_DEFAULT_BODY_BYTES, 8);
    assert.equal(clampWaveBodyBudget(7), 8);
    assert.equal(clampWaveBodyBudget(200), 128);
    assert.equal(clampWaveBodyBudget(32), 32);
  });

  it("splits the wise message into N least-size shards (≥3)", () => {
    const plan = planWaveShards(WAVE_WISE_MESSAGE);
    assert.equal(plan.ok, true);
    assert.equal(plan.maxBytes, 8);
    assert.equal(plan.rule, "least-size");
    assert.ok(plan.totalChunks >= 3);
    assert.equal(plan.totalBytes, Buffer.byteLength(WAVE_WISE_MESSAGE, "utf8"));
    assert.equal(plan.chunks.join(""), WAVE_WISE_MESSAGE);
    for (const c of plan.chunks) {
      const n = Buffer.byteLength(c, "utf8");
      assert.ok(n >= 1 && n <= 8);
    }
  });

  it("formats [W:v1:SYM]|VIN|ii/nn|prev=|next=|KEY8|LOC8] + UTF-8 body", () => {
    const prepared = prepareWaveWrap(WAVE_WISE_MESSAGE, {
      symbol: WAVE_WISE_SYM,
      vinId: "VIN-TEST00001",
    });
    assert.equal(prepared.ok, true);
    assert.equal(prepared.id, WAVE_WRAP_ID);
    const first = prepared.lines[0];
    const total = String(prepared.totalChunks).padStart(2, "0");
    assert.match(first.line, new RegExp(
      "^\\[W:v1:WISE\\|VIN-TEST00001\\|01/" + total + "\\|prev=00000000\\|next=2\\|[0-9a-f]{8}\\|[0-9a-f]{8}\\]",
    ));
    assert.equal(first.line.startsWith(WAVE_HEADER), true);
    const parsed = parseWaveLine(first.line);
    assert.equal(parsed.symbol, "WISE");
    assert.equal(parsed.vinId, "VIN-TEST00001");
    assert.equal(parsed.index, 1);
    assert.equal(parsed.total, prepared.totalChunks);
    assert.equal(parsed.prevHash, "00000000");
    assert.equal(parsed.nextIndex, 2);
    assert.equal(parsed.key8, prepared.key8);
    assert.equal(parsed.loc8, first.loc8);
    assert.equal(parsed.body, first.body);
    const last = prepared.lines[prepared.lines.length - 1];
    assert.equal(parseWaveLine(last.line).nextPtr, "END");
    const back = reconstructWaveBody(prepared.lines.map((l) => l.line));
    assert.equal(back.ok, true);
    assert.equal(back.body, WAVE_WISE_MESSAGE);
  });

  it("hex roundtrip and V3 leftover trailer decode (228 B prefix)", () => {
    const prepared = prepareWaveWrap("stream!", { symbol: "TOKEN", vinId: "VIN-TRAILER01", maxBytes: 128 });
    const hex = prepared.lines[0].hex;
    assert.match(hex, /^0x[0-9a-f]+$/);
    assert.equal(hexToUtf8(hex), prepared.lines[0].line);
    assert.equal(WAVE_EXACT_INPUT_BYTES, 228);
    const prefix = "0x04e45aaf" + "11".repeat(WAVE_EXACT_INPUT_BYTES - 4);
    const trailer = prefix + hex.slice(2);
    const utf8 = utf8FromWaveCalldata(trailer);
    assert.equal(parseWaveLine(utf8).body, "stream!");
  });
});

describe("WAVE leftover hitch wrap", () => {
  it("hitches when leftover covers on a paired sell — never solo-send, no hash", () => {
    const w = attachWaveOnCoveredLeftover({
      line: "[W:v1:WAVE]|VIN-X|01/01|prev=00000000|next=END|aaaaaaaa|bbbbbbbb]hi",
      leftoverEth: 0.0004,
      hitchCostEth: 0.0002,
      pairedUniswapSell: true,
    });
    assert.equal(w.hitch, true);
    assert.equal(w.send, false);
    assert.equal(w.banked, false);
    assert.equal(w.txHash, null);
    assert.match(w.hex, /^0x[0-9a-f]+$/);
  });

  it("banks when leftover is uncovered; WAVE_MIRROR_PAID default off", () => {
    assert.equal(waveMirrorPaidEnabled({}), false);
    assert.equal(waveMirrorPaidEnabled({ WAVE_MIRROR_PAID: "" }), false);
    assert.equal(waveMirrorPaidEnabled({ WAVE_MIRROR_PAID: "no" }), false);
    assert.equal(waveMirrorPaidEnabled({ WAVE_MIRROR_PAID: "yes" }), true);
    const w = attachWaveOnCoveredLeftover({
      text: "bank me",
      leftoverEth: 0.00001,
      hitchCostEth: 0.0002,
      pairedUniswapSell: true,
      env: {},
    });
    assert.equal(w.banked, true);
    assert.equal(w.send, false);
    assert.equal(w.hitch, false);
    assert.equal(w.txHash, null);
  });

  it("gated one-shot send flag does not invent a hash and leaves VITAFEED_PAID off", () => {
    const w = attachWaveOnCoveredLeftover({
      text: "one shot",
      oneShot: true,
      env: { WAVE_MIRROR_PAID: "yes" },
    });
    assert.equal(w.send, true);
    assert.equal(w.txHash, null);
    assert.match(w.reason, /VITAFEED_PAID untouched/);
    assert.equal(vitaFeedPaidEnabled({}), false);
    assert.equal(vitaFeedPaidEnabled({ VITAFEED_PAID: "" }), false);
  });
});

describe("WAVE sell leftover hitch caller", () => {
  beforeEach(() => resetWaveHitchCursor());

  it("hitchWaveOnSellLeftover invokes attachWaveOnCoveredLeftover when leftover covers", () => {
    let attached = 0;
    const shard = peekNextWaveHitchShard();
    assert.ok(shard?.line);
    const w = hitchWaveOnSellLeftover({
      shard,
      leftoverEth: 0.0004,
      hitchCostEth: 0.0002,
      pairedUniswapSell: true,
      attach: (input) => {
        attached += 1;
        return attachWaveOnCoveredLeftover(input);
      },
    });
    assert.equal(attached, 1);
    assert.equal(w.hitch, true);
    assert.equal(w.send, false);
    assert.equal(w.banked, false);
    assert.equal(w.txHash, null);
    assert.equal(w.utf8, shard.line);
    assert.equal(parseWaveLine(w.utf8).symbol, "WISE");
    assert.equal(waveHitchCursorIndex(), 0, "cursor waits until trailer lands");
    assert.equal(commitWaveHitchShard(w), true);
    assert.equal(waveHitchCursorIndex(), 1);
    const next = peekNextWaveHitchShard();
    assert.ok(next);
    assert.notEqual(next.line, shard.line);
  });

  it("banks/skips when leftover is uncovered — cursor does not advance", () => {
    const before = waveHitchCursorIndex();
    const w = hitchWaveOnSellLeftover({
      leftoverEth: 0.00001,
      hitchCostEth: 0.0002,
      pairedUniswapSell: true,
      env: {},
    });
    assert.equal(w.hitch, false);
    assert.equal(w.banked, true);
    assert.equal(w.send, false);
    assert.equal(w.txHash, null);
    assert.match(w.reason, /bank WAVE hex|uncovered/i);
    assert.equal(commitWaveHitchShard(w), false);
    assert.equal(waveHitchCursorIndex(), before);
    assert.equal(waveMirrorPaidEnabled({}), false);
    assert.equal(vitaFeedPaidEnabled({}), false);
  });

  it("KEY+LOC skipped / leftoverEth 0 banks WAVE — never solo-send even if WAVE_MIRROR_PAID=yes", () => {
    const w = hitchWaveOnSellLeftover({
      leftoverEth: 0,
      hitchCostEth: 0.0002,
      pairedUniswapSell: true,
      env: { WAVE_MIRROR_PAID: "yes" },
    });
    assert.equal(w.hitch, false);
    assert.equal(w.send, false);
    assert.equal(w.banked, true);
    assert.equal(w.txHash, null);
  });

  it("WAVE trailer appends after KEY+LOC on a paired leftover swap", () => {
    const loc = appendUtf8Hitch(KEYCAT_PLAIN_SWAP, "§$STORE§ §KEY§eureka♥Krystian,Kai,Koda§LOC§n=1|t=aaaa");
    assert.equal(loc.onChain, true);
    const w = hitchWaveOnSellLeftover({
      leftoverEth: 0.0004,
      hitchCostEth: 0.0001,
      pairedUniswapSell: true,
    });
    assert.equal(w.hitch, true);
    const packed = appendUtf8Hitch(loc.data, w.utf8);
    assert.equal(packed.ok, true);
    assert.equal(packed.onChain, true);
    const decoded = utf8FromWaveCalldata(packed.data);
    assert.equal(parseWaveLine(decoded).body, parseWaveLine(w.utf8).body);
    assert.ok(loc.utf8.includes("Krystian"), "KEY+LOC names stay on the leftover hitch");
    assert.equal(packed.data.startsWith(KEYCAT_PLAIN_SWAP.slice(0, 10)), true);
  });

  it("executeSell leftover hitch loop calls hitchWaveOnSellLeftover → attachWaveOnCoveredLeftover", () => {
    const agent = readFileSync(join(root, "agent.js"), "utf8");
    const sellFn = agent.indexOf("async function executeSell(");
    assert.ok(sellFn >= 0);
    const sellEnd = agent.indexOf("\nasync function ", sellFn + 1);
    const sellBody = agent.slice(sellFn, sellEnd > 0 ? sellEnd : sellFn + 12000);
    assert.ok(sellBody.includes("planVoiceHitch"), "KEY+LOC leftover hitch stays");
    const planAt = sellBody.indexOf("planVoiceHitch");
    const waveAt = sellBody.indexOf("hitchWaveOnSellLeftover");
    assert.ok(waveAt > planAt, "WAVE hitch runs after KEY+LOC leftover hitch");
    assert.ok(sellBody.includes("attachWaveOnCoveredLeftover"), "sell hitch caller must invoke attachWaveOnCoveredLeftover");
    assert.ok(sellBody.includes("pairedUniswapSell: true"));
    assert.ok(sellBody.includes("commitWaveHitchShard"));
    assert.ok(!sellBody.includes("oneShot: true"), "sell path must never WAVE one-shot");
    assert.ok(!sellBody.includes('WAVE_MIRROR_PAID: "yes"'));
    assert.ok(!sellBody.includes('VITAFEED_PAID: "yes"'));
    assert.ok(!sellBody.includes("vitaSave("), "must not call mother brain vitaSave");
    assert.ok(!sellBody.includes("inscribeChunk("));
    const wrap = readFileSync(join(root, "vita/wave-wrap.js"), "utf8");
    const helper = wrap.slice(wrap.indexOf("export function hitchWaveOnSellLeftover"));
    assert.match(helper, /attachWaveOnCoveredLeftover/);
  });
});

describe("WAVE mother brain stays out", () => {
  it("wave-wrap.js does not import mother-brain internals or vita-feed paid path", () => {
    const src = readFileSync(join(root, "vita/wave-wrap.js"), "utf8");
    assert.doesNotMatch(src, /from ["'].*vita-memory/);
    assert.doesNotMatch(src, /from ["'].*memory-engine/);
    assert.doesNotMatch(src, /from ["'].*mother-genesis/);
    assert.doesNotMatch(src, /from ["'].*mainframe/);
    assert.doesNotMatch(src, /from ["'].*vita-feed/);
    assert.doesNotMatch(src, /vitaSave\s*\(/);
    assert.doesNotMatch(src, /inscribeChunk\s*\(/);
    assert.doesNotMatch(src, /VITAFEED_PAID\s*=\s*["']yes/);
  });

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

  it("agent /wavetest is a thin hook; does not re-enable VITAFEED_PAID or vitaSave", () => {
    const agent = readFileSync(join(root, "agent.js"), "utf8");
    assert.match(agent, /\/wavetest/);
    assert.match(agent, /handleWaveTestAction/);
    const wStart = agent.indexOf("/wavetest");
    assert.ok(wStart >= 0);
    const slice = agent.slice(wStart, wStart + 1800);
    assert.ok(slice.includes("handleWaveTestAction"));
    assert.ok(!slice.includes("vitaSave("), "must not call mother brain vitaSave");
    assert.ok(!slice.includes("inscribeChunk("));
    assert.ok(!slice.includes('VITAFEED_PAID: "yes"'));
    assert.ok(!slice.includes("VITA_AUTO_INSCRIBE"));
  });
});

describe("WAVE hex helpers", () => {
  it("utf8ToHex is hex-only payload", () => {
    const hex = utf8ToHex("[W:v1:FILING]|VIN|01/01|prev=00000000|next=END|11111111|22222222]ab");
    assert.match(hex, /^0x[0-9a-f]+$/);
    assert.equal(hexToUtf8(hex).endsWith("]ab"), true);
  });
});
