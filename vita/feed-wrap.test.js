/**
 * Queue/main-loop wrap — mother brain (vitaSave / inscribeChunk) stays intact.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  VITA_SELF_CALL_SELECTOR,
  peekFeedWrapBank,
  resetFeedWrapBank,
  selectorFromHex,
  utf8ToHex,
  wrapQueueSelfCall,
} from "./feed-wrap.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function liveBugText(n = 5513) {
  return `[VITA:${n}:00000000]§$STORE§ §KEY§eureka♥Krystian`;
}

describe("mother brain untouched", () => {
  it("vita-memory.js still has root inscription (inscribeChunk + sendTransaction)", () => {
    const src = readFileSync(join(root, "vita-memory.js"), "utf8");
    assert.match(src, /async function inscribeChunk/);
    assert.match(src, /export async function vitaSave/);
    assert.match(src, /sendTransaction/);
    assert.match(src, /\[VITA:/);
    assert.ok(!src.includes("feed-wrap"), "wrapper must not be imported into vita-memory.js");
  });

  it("memory-engine.js inscription path is not rewritten", () => {
    const src = readFileSync(join(root, "memory-engine.js"), "utf8");
    assert.match(src, /export async function inscribeMemory/);
    assert.match(src, /sendTransaction/);
    assert.ok(!src.includes("feed-wrap"));
  });
});

describe("unpaired STORE self-call blocked at the queue wrap", () => {
  beforeEach(() => resetFeedWrapBank());

  it("sel 0x5b564954 + STORE + 0 Uniswap fills → bank, never send", () => {
    const text = liveBugText(5513);
    const data = utf8ToHex(text);
    assert.equal(selectorFromHex(data), VITA_SELF_CALL_SELECTOR);
    const w = wrapQueueSelfCall({
      to: "0x50e1C4608c48b0c52E1EA5FBabc1c9126eA17915",
      from: "0x50e1C4608c48b0c52E1EA5FBabc1c9126eA17915",
      data,
      text,
      leftoverEth: 0.002,
      hitchCostEth: 0.0001,
      pairedUniswapSell: false,
    });
    assert.equal(w.send, false);
    assert.equal(w.banked, true);
    assert.equal(w.hitch, false);
    assert.equal(w.txHash, null);
    assert.equal(w.unpaired, true);
    assert.match(w.reason, /bank hex/i);
  });
});

describe("hitch when leftover covers; bank when not", () => {
  beforeEach(() => resetFeedWrapBank());

  it("hitch fires when leftover covers KEY+LOC on a paired sell", () => {
    const w = wrapQueueSelfCall({
      text: "§KEY§eureka♥Krystian",
      leftoverEth: 0.0004,
      hitchCostEth: 0.0002,
      pairedUniswapSell: true,
    });
    assert.equal(w.hitch, true);
    assert.equal(w.send, false);
    assert.equal(w.banked, false);
  });

  it("banks when leftover cannot cover", () => {
    const w = wrapQueueSelfCall({
      text: liveBugText(5514),
      leftoverEth: 0.00001,
      hitchCostEth: 0.0002,
      pairedUniswapSell: true,
    });
    assert.equal(w.banked, true);
    assert.equal(w.hitch, false);
    assert.equal(w.send, false);
    assert.equal(peekFeedWrapBank().length, 1);
    assert.equal(peekFeedWrapBank()[0].txHash, null);
  });
});

describe("agent.js queue wrap — mother brain callers stay", () => {
  it("main-loop vita-queue uses wrapQueueSelfCall; /vitasave still calls vitaSave", () => {
    const agent = readFileSync(join(root, "agent.js"), "utf8");
    assert.ok(agent.includes("wrapQueueSelfCall"), "queue must use the wrap");
    assert.ok(agent.includes("vitaSave("), "operator /vitasave mother brain stays");

    const qStart = agent.indexOf("LEGACY KNOWLEDGE-BASE PROCESSING");
    const qEnd = agent.indexOf("Vault expiry warning");
    assert.ok(qStart >= 0 && qEnd > qStart);
    const qBody = agent.slice(qStart, qEnd);
    assert.ok(qBody.includes("wrapQueueSelfCall"));
    assert.ok(!qBody.includes("sendTransaction"), "queue must not solo-send");

    const ikn = agent.indexOf("Inscribe the 5 chunks to Base first");
    const iknEnd = agent.indexOf("Attach tx hashes", ikn);
    const iknBody = agent.slice(ikn, iknEnd > ikn ? iknEnd : ikn + 2500);
    assert.ok(iknBody.includes("wrapQueueSelfCall"));
    assert.ok(!iknBody.includes("sendTransaction"));
  });
});
