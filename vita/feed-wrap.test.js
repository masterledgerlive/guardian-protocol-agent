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
  MGPLAIN_SELF_CALL_SELECTOR,
  VITA_SELF_CALL_SELECTOR,
  autoPaidInscribeEnabled,
  isTrivialTestInscriptionBody,
  maySendMotherGenesis,
  motherGenesisPaidInscribeEnabled,
  parseMotherGenesisOperatorIntent,
  peekFeedWrapBank,
  resetFeedWrapBank,
  selectorFromHex,
  utf8ToHex,
  wrapAutoSelfCall,
  wrapMotherGenesisSelfCall,
  wrapQueueSelfCall,
  wrapVitaSaveSelfCall,
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

  it("mother-genesis.js planner is wrap-only — feed-wrap does not rewrite it", () => {
    const src = readFileSync(join(root, "vita/mother-genesis.js"), "utf8");
    assert.match(src, /export async function runMotherGenesisInscribe/);
    assert.match(src, /MGPLAIN/);
    assert.ok(!src.includes("feed-wrap"), "wrapper must not be imported into mother-genesis.js");
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
    const learnEnd = agent.indexOf("/vitamothergenesis — wrap MGPLAIN");
    assert.ok(learnStart >= 0 && learnEnd > learnStart);
    const learn = agent.slice(learnStart, learnEnd);
    assert.ok(learn.includes("autoPaidInscribeEnabled"), "learn must honor kill-switch");
    assert.ok(learn.includes("wrapAutoSelfCall"), "learn must wrap");
    assert.ok(learn.includes("isTrivialTestInscriptionBody"), "learn must refuse this-is-a-test batches");

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

  it("operator /vitasave stays; callers wrap — vitaSave only when env on", () => {
    const agent = readFileSync(join(root, "agent.js"), "utf8");
    const vStart = agent.indexOf('} else if (text === "/vitasave")');
    const vEnd = agent.indexOf("} else if (text === \"/vitarecall\"");
    assert.ok(vStart >= 0 && vEnd > vStart);
    const vBody = agent.slice(vStart, vEnd);
    assert.ok(vBody.includes("vitaSave("), "env-on path still hits mother brain");
    assert.ok(vBody.includes("autoPaidInscribeEnabled"), "/vitasave must honor kill-switch");
    assert.ok(vBody.includes("wrapVitaSaveSelfCall"), "/vitasave must wrap");
    assert.ok(vBody.includes("topic: \"vitasave\""));
    assert.match(vBody, /if \(!autoSaveOn\)[\s\S]*continue;/);

    const v2Start = agent.indexOf('} else if (text && text.startsWith("/vitasave"))');
    const v2End = agent.indexOf('} else if (text && text.startsWith("/vitarecall "))', v2Start);
    const v2Body = agent.slice(v2Start, v2End > v2Start ? v2End : v2Start + 2500);
    assert.ok(v2Body.includes("vitaSave("));
    assert.ok(v2Body.includes("autoPaidInscribeEnabled"));
    assert.ok(v2Body.includes("wrapVitaSaveSelfCall"));
    assert.match(v2Body, /if \(!autoPaidInscribeEnabled\(\)\)[\s\S]*continue;/);

    const proveStart = agent.indexOf('} else if (text === "/prove"');
    const proveEnd = agent.indexOf("} else if (text === \"/voiceon\")");
    assert.ok(proveStart >= 0 && proveEnd > proveStart);
    const prove = agent.slice(proveStart, proveEnd);
    assert.ok(prove.includes("sendStoreVoiceProof"), "/prove stays dedicated Eureka");
    assert.ok(!prove.includes("wrapVitaSaveSelfCall"), "/prove is not the vitasave wrap");
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

describe("MGPLAIN / VITA-KNOW auto bank (n5551–5556 class)", () => {
  beforeEach(() => resetFeedWrapBank());

  function liveMgplainTest() {
    return "[MGPLAIN:MG-P-TEST0001:01/01:00000000]this is a test";
  }

  function liveVitaKnowTest(i = 1) {
    return "[VITA:VITA-KNOW-THIS-IS-A:0" + i + "/05:2026-09-14:00000000]this is a test";
  }

  it("MGPLAIN selector 0x5b4d4750 + this is a test → bank, never send, no hash", () => {
    const text = liveMgplainTest();
    const data = utf8ToHex(text);
    assert.equal(selectorFromHex(data), MGPLAIN_SELF_CALL_SELECTOR);
    const w = wrapMotherGenesisSelfCall({
      to: "0x50e1C4608c48b0c52E1EA5FBabc1c9126eA17915",
      from: "0x50e1C4608c48b0c52E1EA5FBabc1c9126eA17915",
      data,
      text,
      leftoverEth: 0.002,
      hitchCostEth: 0.0001,
      pairedUniswapSell: false,
      topic: "mgplain",
    });
    assert.equal(w.send, false);
    assert.equal(w.banked, true);
    assert.equal(w.hitch, false);
    assert.equal(w.txHash, null);
    assert.equal(w.unpaired, true);
    assert.equal(peekFeedWrapBank()[0].topic, "mgplain");
    assert.match(w.reason, /bank hex/i);
  });

  it("VITA-KNOW 01/05–05/05 this is a test → bank unpaired, hitch 0", () => {
    for (let i = 1; i <= 5; i++) {
      const text = liveVitaKnowTest(i);
      const w = wrapAutoSelfCall({
        to: "0x50e1C4608c48b0c52E1EA5FBabc1c9126eA17915",
        from: "0x50e1C4608c48b0c52E1EA5FBabc1c9126eA17915",
        data: utf8ToHex(text),
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
    }
    assert.equal(peekFeedWrapBank().length, 5);
  });

  it("hitch MGPLAIN only when leftover covers KEY+LOC on a paired sell", () => {
    const w = wrapMotherGenesisSelfCall({
      text: liveMgplainTest(),
      leftoverEth: 0.0004,
      hitchCostEth: 0.0002,
      pairedUniswapSell: true,
      topic: "mgplain",
    });
    assert.equal(w.hitch, true);
    assert.equal(w.send, false);
    assert.equal(w.banked, false);
    assert.equal(w.txHash, null);
  });

  it("trivial this-is-a-test body never maySend even with CONFIRM + env", () => {
    assert.equal(isTrivialTestInscriptionBody("this is a test"), true);
    assert.equal(isTrivialTestInscriptionBody("  This Is A Test  "), true);
    assert.equal(isTrivialTestInscriptionBody("real dump code"), false);
    assert.equal(
      maySendMotherGenesis({
        env: { VITA_MOTHER_GENESIS_AUTO: "yes" },
        confirmed: true,
        body: "this is a test",
      }),
      false,
    );
  });

  it("VITA_MOTHER_GENESIS_AUTO defaults OFF; CONFIRM required; sibling env works", () => {
    assert.equal(motherGenesisPaidInscribeEnabled({}), false);
    assert.equal(motherGenesisPaidInscribeEnabled({ VITA_MOTHER_GENESIS_AUTO: "" }), false);
    assert.equal(motherGenesisPaidInscribeEnabled({ VITA_MOTHER_GENESIS_AUTO: "no" }), false);
    assert.equal(motherGenesisPaidInscribeEnabled({ VITA_MOTHER_GENESIS_AUTO: "yes" }), true);
    assert.equal(
      motherGenesisPaidInscribeEnabled({ VITA_AUTO_INSCRIBE: "yes", VITA_MOTHER_GENESIS_AUTO: "no" }),
      false,
      "explicit genesis=no wins over auto inscribe",
    );
    assert.equal(motherGenesisPaidInscribeEnabled({ VITA_AUTO_INSCRIBE: "yes" }), true);

    const intent = parseMotherGenesisOperatorIntent("this is a test");
    assert.equal(intent.confirmed, false);
    assert.equal(intent.body, "this is a test");
    const confirmed = parseMotherGenesisOperatorIntent("CONFIRM real dump");
    assert.equal(confirmed.confirmed, true);
    assert.equal(confirmed.body, "real dump");

    assert.equal(
      maySendMotherGenesis({ env: {}, confirmed: true, body: "real dump" }),
      false,
      "CONFIRM alone does not pay while env is off",
    );
    assert.equal(
      maySendMotherGenesis({
        env: { VITA_MOTHER_GENESIS_AUTO: "yes" },
        confirmed: false,
        body: "real dump",
      }),
      false,
      "env alone does not auto-fire genesis",
    );
    assert.equal(
      maySendMotherGenesis({
        env: { VITA_MOTHER_GENESIS_AUTO: "yes" },
        confirmed: true,
        body: "real dump",
      }),
      true,
    );
  });

  it("/vitamothergenesis and encoded gate on wrap + CONFIRM; queue VITA-KNOW stays wrapped", () => {
    const agent = readFileSync(join(root, "agent.js"), "utf8");

    const gStart = agent.indexOf("/vitamothergenesis — wrap MGPLAIN");
    const gEnd = agent.indexOf("/encodegenesisreveal — two-part");
    assert.ok(gStart >= 0 && gEnd > gStart);
    const genesis = agent.slice(gStart, gEnd);
    assert.ok(genesis.includes("maySendMotherGenesis"));
    assert.ok(genesis.includes("parseMotherGenesisOperatorIntent"));
    assert.ok(genesis.includes("wrapMotherGenesisSelfCall"));
    assert.ok(genesis.includes("topic: \"mgplain\""));
    assert.ok(genesis.includes("topic: \"mgenc\""));
    assert.match(genesis, /if \(!maySend\)[\s\S]*return null;/);

    const qStart = agent.indexOf("LEGACY KNOWLEDGE-BASE PROCESSING");
    const qEnd = agent.indexOf("Vault expiry warning");
    assert.ok(qStart >= 0 && qEnd > qStart);
    const qBody = agent.slice(qStart, qEnd);
    assert.ok(qBody.includes("VITA-KNOW-"));
    assert.ok(qBody.includes("wrapQueueSelfCall"));
    assert.ok(!qBody.includes("sendTransaction"), "queue VITA-KNOW must not solo-send");

    const vStart = agent.indexOf('} else if (text === "/vitasave")');
    const vEnd = agent.indexOf("} else if (text === \"/vitarecall\"");
    const vBody = agent.slice(vStart, vEnd);
    assert.ok(vBody.includes("vitaSave("));
    assert.ok(vBody.includes("wrapVitaSaveSelfCall"));
    assert.ok(!vBody.includes("maySendMotherGenesis"));
    assert.ok(!vBody.includes("wrapMotherGenesisSelfCall"));
  });
});

describe("vitasave wrap — n5557–5566 class", () => {
  beforeEach(() => resetFeedWrapBank());

  function liveVitaSaveChunk1() {
    return "[VITA:1:00000000]§SESS§2026-09-14|vita-router|eureka→";
  }

  function liveVitaSaveStoreChunk(seq, prev) {
    return (
      "[VITA:" + seq + ":" + prev + "]§LEARN§prose-letter wastes hitch B;" +
      "§TOKEN§denser recall;squash>list-every-tx;hitch≠lastPacket;keep\n" +
      "§$STORE§ tag|SESSION:2026-09-14 WALLET:0x50e1C4608c48b0c52E1EA5FBabc1c9126eA17915"
    );
  }

  it("n5557 [VITA:1:00000000] vitaSave header banks unpaired, never send, no hash", () => {
    const text = liveVitaSaveChunk1();
    const data = utf8ToHex(text);
    assert.equal(selectorFromHex(data), VITA_SELF_CALL_SELECTOR);
    const w = wrapVitaSaveSelfCall({
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
    assert.equal(peekFeedWrapBank()[0].topic, "vitasave");
  });

  it("n5561 / n5566 STORE last-chunk class banks — no invented hash", () => {
    for (const [seq, prev] of [["1", "9864b2f0"], ["2", "f9063fd4"]]) {
      const text = liveVitaSaveStoreChunk(seq, prev);
      const w = wrapVitaSaveSelfCall({
        to: "0x50e1C4608c48b0c52E1EA5FBabc1c9126eA17915",
        from: "0x50e1C4608c48b0c52E1EA5FBabc1c9126eA17915",
        data: utf8ToHex(text),
        text,
        leftoverEth: 0.002,
        hitchCostEth: 0.0001,
        pairedUniswapSell: false,
      });
      assert.equal(w.send, false);
      assert.equal(w.banked, true);
      assert.equal(w.txHash, null);
      assert.equal(w.unpaired, true);
      assert.match(text, /§\$STORE§/);
    }
    assert.equal(peekFeedWrapBank().length, 2);
  });

  it("POST /vita/save webhook banks via wrap — no sendTransaction", () => {
    const webhook = readFileSync(join(root, "vita-webhook.js"), "utf8");
    const start = webhook.indexOf("path === \"/vita/save\"");
    assert.ok(start >= 0, "advertised POST /vita/save must exist");
    const body = webhook.slice(start, start + 900);
    assert.ok(body.includes("wrapVitaSaveSelfCall"));
    assert.ok(!body.includes("sendTransaction"), "webhook save must not solo-send");
    assert.ok(body.includes("txHash: null"));
  });
});
