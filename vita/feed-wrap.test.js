/**
 * Queue/main-loop wrap — mother brain (vitaSave / inscribeChunk) stays intact.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  VITA_SELF_CALL_SELECTOR,
  autoPaidInscribeEnabled,
  peekFeedWrapBank,
  resetFeedWrapBank,
  selectorFromHex,
  utf8ToHex,
  wrapAutoSelfCall,
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

describe("env kill-switch defaults AUTO queue/learn to bank", () => {
  it("unset / no / false → bank; yes/on/1/true → opt-in paid path", () => {
    assert.equal(autoPaidInscribeEnabled({}), false);
    assert.equal(autoPaidInscribeEnabled({ VITA_AUTO_INSCRIBE: "" }), false);
    assert.equal(autoPaidInscribeEnabled({ VITA_AUTO_INSCRIBE: "no" }), false);
    assert.equal(autoPaidInscribeEnabled({ VITA_AUTO_QUEUE_LEARN: "false" }), false);
    assert.equal(autoPaidInscribeEnabled({ VITA_AUTO_INSCRIBE: "yes" }), true);
    assert.equal(autoPaidInscribeEnabled({ VITA_AUTO_INSCRIBE: "ON" }), true);
    assert.equal(autoPaidInscribeEnabled({ VITA_AUTO_QUEUE_LEARN: "1" }), true);
  });
});

describe("remaining AUTO callers bank unpaired STORE (n5546–5550 class)", () => {
  beforeEach(() => resetFeedWrapBank());

  it("wrapAutoSelfCall banks n5550 STORE self-call — never send, no hash", () => {
    const text = liveBugText(5550);
    const data = utf8ToHex(text);
    assert.equal(selectorFromHex(data), VITA_SELF_CALL_SELECTOR);
    const w = wrapAutoSelfCall({
      to: "0x50e1C4608c48b0c52E1EA5FBabc1c9126eA17915",
      from: "0x50e1C4608c48b0c52E1EA5FBabc1c9126eA17915",
      data,
      text,
      leftoverEth: 0.002,
      hitchCostEth: 0.0001,
      pairedUniswapSell: false,
      topic: "vitalearn",
    });
    assert.equal(w.send, false);
    assert.equal(w.banked, true);
    assert.equal(w.hitch, false);
    assert.equal(w.txHash, null);
    assert.equal(w.unpaired, true);
    assert.equal(peekFeedWrapBank()[0].topic, "vitalearn");
  });

  it("/vitalearn /vitadata /savesession /btpInscribe gate on autoPaidInscribeEnabled + wrap", () => {
    const agent = readFileSync(join(root, "agent.js"), "utf8");

    const learnStart = agent.indexOf("/vitalearn TOPIC");
    const learnEnd = agent.indexOf('} else if (text && text.startsWith("/vita ")');
    assert.ok(learnStart >= 0 && learnEnd > learnStart);
    const learn = agent.slice(learnStart, learnEnd);
    assert.ok(learn.includes("autoPaidInscribeEnabled"), "learn must honor kill-switch");
    assert.ok(learn.includes("wrapAutoSelfCall"), "learn must wrap");
    assert.ok(learn.includes("topic: \"vitalearn\""));

    const dataStart = agent.indexOf('} else if (text === "/vitadata")');
    const dataEnd = agent.indexOf("/vitalearn TOPIC");
    assert.ok(dataStart >= 0 && dataEnd > dataStart);
    const data = agent.slice(dataStart, dataEnd);
    assert.ok(data.includes("autoPaidInscribeEnabled"));
    assert.ok(data.includes("wrapAutoSelfCall"));
    assert.ok(data.includes("topic: \"vitadata\""));
    assert.match(data, /if \(autoDataOn\)[\s\S]*vitaSave\(/);

    const sessStart = agent.indexOf('} else if (text && text.startsWith("/savesession"))');
    const sessEnd = agent.indexOf("} else if (parseBagOrRecallCommand(raw))");
    assert.ok(sessStart >= 0 && sessEnd > sessStart);
    const sess = agent.slice(sessStart, sessEnd);
    assert.ok(sess.includes("autoPaidInscribeEnabled"));
    assert.ok(sess.includes("wrapAutoSelfCall"));
    assert.match(sess, /else \{[\s\S]*inscribeMemory\(/);

    const btpStart = agent.indexOf("async function btpInscribe");
    const btpEnd = agent.indexOf("Operator /buy must never go silent");
    assert.ok(btpStart >= 0 && btpEnd > btpStart);
    const btp = agent.slice(btpStart, btpEnd);
    assert.ok(btp.includes("autoPaidInscribeEnabled"));
    assert.ok(btp.includes("wrapAutoSelfCall"));
    assert.ok(btp.includes("topic: \"btp-auto\""));
    assert.match(btp, /if \(!autoPaidInscribeEnabled\(\)\)[\s\S]*return;/);

    const integrity = readFileSync(join(root, "ikn-integrity-agent.js"), "utf8");
    assert.ok(!integrity.includes("sendTransaction"), "integrity must not burn RISK liquid");
  });

  it("operator /vitasave is not gated — mother brain stays reachable", () => {
    const agent = readFileSync(join(root, "agent.js"), "utf8");
    const vStart = agent.indexOf('} else if (text === "/vitasave")');
    const vEnd = agent.indexOf("} else if (text === \"/vitarecall\"");
    assert.ok(vStart >= 0 && vEnd > vStart);
    const vBody = agent.slice(vStart, vEnd);
    assert.ok(vBody.includes("vitaSave("));
    assert.ok(!vBody.includes("autoPaidInscribeEnabled"), "/vitasave must stay ungated");
    assert.ok(!vBody.includes("wrapAutoSelfCall"), "/vitasave must still hit mother brain");

    const v2Start = agent.indexOf('} else if (text && text.startsWith("/vitasave"))');
    const v2End = agent.indexOf('} else if (text && text.startsWith("/vitarecall "))', v2Start);
    const v2Body = agent.slice(v2Start, v2End > v2Start ? v2End : v2Start + 2500);
    assert.ok(v2Body.includes("vitaSave("));
    assert.ok(!v2Body.includes("autoPaidInscribeEnabled"));
    assert.ok(!v2Body.includes("wrapAutoSelfCall"));
  });
});

describe("mother brain files stay diff-zero vs main", () => {
  const frozen = [
    "vita-memory.js",
    "memory-engine.js",
    "vita/mainframe.js",
    "vita/ORIGINAL_FORMULA.md",
    "vita/FILING.md",
    "vita/AGENTS.md",
    "vita/anchors.json",
  ];

  it("git diff main is empty for VITA root inscription files", () => {
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
});
