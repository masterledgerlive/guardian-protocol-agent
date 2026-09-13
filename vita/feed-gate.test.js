/**
 * VITA feed gate — brain fed free.
 * Unpaired STORE self-call blocked; hitch when leftover covers; bank when not.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SECTION1_SCHEMA,
  SECTION2_EXAMPLE_HEX,
  SECTION2_EXAMPLE_UTF8,
  VITA_SELF_CALL_SELECTOR,
  VITA_SELF_CALL_HEADER,
  attemptVitaChainWrite,
  bankVitaFeed,
  buildSection1Schema,
  decideVitaFeed,
  decodeSection2Hex,
  drainBankedVitaFeedForHitch,
  encodeSection2Hex,
  formatVitaFeedBankedHtml,
  isDedicatedMemorySelfCall,
  isSection1JsonPayload,
  isVitaSelfCallPayload,
  peekBankedVitaFeed,
  planHexInject,
  pointToTxHash,
  resetVitaFeedBank,
  selectorFromUtf8,
  utf8CalldataHex,
} from "./feed-gate.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function liveBugCalldata(n = 5513) {
  return `${VITA_SELF_CALL_HEADER}${n}:00000000]§$STORE§ §KEY§eureka♥Krystian§LOC§n=${n}`;
}

describe("VITA self-call selector (live bug 0x5b564954)", () => {
  it("UTF-8 [VITA: n5513+ is selector 0x5b564954", () => {
    const text = liveBugCalldata(5513);
    assert.equal(selectorFromUtf8(text), VITA_SELF_CALL_SELECTOR);
    assert.equal(selectorFromUtf8("[VITA:5542:abcd]STORE"), VITA_SELF_CALL_SELECTOR);
    assert.equal(isVitaSelfCallPayload({ text }), true);
    assert.equal(isVitaSelfCallPayload({ data: utf8CalldataHex(text) }), true);
  });
});

describe("unpaired STORE self-call blocked", () => {
  beforeEach(() => resetVitaFeedBank());

  it("blocks dedicated [VITA: + STORE with 0 Uniswap fills", () => {
    const text = liveBugCalldata(5513);
    const data = utf8CalldataHex(text);
    const d = decideVitaFeed({
      data,
      text,
      to: "0x50e1C4608c48b0c52E1EA5FBabc1c9126eA17915",
      from: "0x50e1C4608c48b0c52E1EA5FBabc1c9126eA17915",
      leftoverEth: 0.002,
      hitchCostEth: 0.0001,
      pairedUniswapSell: false,
    });
    assert.equal(d.action, "bank");
    assert.equal(d.hitch, false);
    assert.equal(d.skipSoloSelfCall, true);
    assert.equal(d.unpairedSelfCallBlocked, true);
    assert.match(d.reason, /unpaid|unpaired|free ride|no Uniswap/i);

    const write = attemptVitaChainWrite({
      data,
      text,
      to: "0x50e1C4608c48b0c52E1EA5FBabc1c9126eA17915",
      from: "0x50e1C4608c48b0c52E1EA5FBabc1c9126eA17915",
      pairedUniswapSell: false,
    });
    assert.equal(write.sent, false);
    assert.equal(write.banked, true);
    assert.equal(write.txHash, null);
    assert.equal(isDedicatedMemorySelfCall({ data, text }), true);
  });

  it("does not invent a hash when banking dozens of n5513–5542+ chunks", () => {
    for (let n = 5513; n <= 5542; n++) {
      const write = attemptVitaChainWrite({
        text: liveBugCalldata(n),
        pairedUniswapSell: false,
      });
      assert.equal(write.sent, false);
      assert.equal(write.txHash, null);
    }
    assert.equal(peekBankedVitaFeed().length, 30);
    assert.ok(peekBankedVitaFeed().every((row) => row.txHash == null));
  });
});

describe("hitch fires when leftover covers KEY+LOC on a paired sell", () => {
  beforeEach(() => resetVitaFeedBank());

  it("message-first hitch when leftover covers 1× and Uniswap sell is paired", () => {
    const d = decideVitaFeed({
      leftoverEth: 0.0004,
      hitchCostEth: 0.0002,
      pairedUniswapSell: true,
      keyLocCovered: true,
    });
    assert.equal(d.action, "hitch");
    assert.equal(d.hitch, true);
    assert.equal(d.skipHitch, false);
    assert.equal(d.allowLeftoverHitch, true);
    assert.equal(d.storageTokenChargeable, true);
    assert.equal(d.messageFirst, true);
    assert.match(d.reason, /KEY\+LOC|message-first/i);
  });

  it("same-tx trade leftover also counts as paired cover", () => {
    const d = decideVitaFeed({
      leftoverEth: 0.001,
      hitchCostEth: 0.0003,
      sameTxTradeLeftover: true,
    });
    assert.equal(d.action, "hitch");
    assert.equal(d.allowLeftoverHitch, true);
  });

  it("drain releases banked messages only when leftover covers on a paired sell", () => {
    bankVitaFeed({ text: liveBugCalldata(5513), topic: "queued" });
    const miss = drainBankedVitaFeedForHitch({
      leftoverEth: 0,
      hitchCostEth: 0.0002,
      pairedUniswapSell: true,
    });
    assert.equal(miss.hitch, false);
    assert.equal(miss.drained.length, 0);
    assert.equal(miss.stillBanked, 1);

    const hit = drainBankedVitaFeedForHitch({
      leftoverEth: 0.0005,
      hitchCostEth: 0.0002,
      pairedUniswapSell: true,
    });
    assert.equal(hit.hitch, true);
    assert.equal(hit.drained.length, 1);
    assert.equal(hit.stillBanked, 0);
    assert.equal(hit.drained[0].txHash, null);
  });
});

describe("bank when leftover cannot cover KEY+LOC", () => {
  beforeEach(() => resetVitaFeedBank());

  it("banks hitch on a paired sell when leftover is too thin", () => {
    const d = decideVitaFeed({
      leftoverEth: 0.00001,
      hitchCostEth: 0.0002,
      pairedUniswapSell: true,
    });
    assert.equal(d.action, "bank");
    assert.equal(d.hitch, false);
    assert.equal(d.allowLeftoverHitch, false);
    assert.match(d.reason, /bank hex|bank hitch/i);
  });

  it("banks leftover sitting in RISK liquid (not a sell leftover)", () => {
    const d = decideVitaFeed({
      leftoverEth: 0.002,
      hitchCostEth: 0.0001,
      pairedUniswapSell: false,
      sameTxTradeLeftover: false,
    });
    assert.equal(d.action, "bank");
    assert.equal(d.unpairedSelfCallBlocked, true);
  });

  it("format receipt never claims a Basescan hash", () => {
    const html = formatVitaFeedBankedHtml({
      strandId: "VITA-5513",
      chunkCount: 5,
      tokenPacket: "§$STORE§ §KEY§eureka♥Krystian",
    });
    assert.match(html, /BANKED/);
    assert.match(html, /brain fed free/);
    assert.match(html, /Section 2/);
    assert.doesNotMatch(html, /0x[a-fA-F0-9]{64}/);
    assert.doesNotMatch(html, /basescan/i);
  });
});

describe("Section 2 hex-only inject (not JSON on-chain)", () => {
  it("encodes UTF-8 compressed truth as hex — Game example HYP → 0x485950", () => {
    assert.equal(SECTION2_EXAMPLE_UTF8, "HYP");
    assert.equal(SECTION2_EXAMPLE_HEX, "0x485950");
    assert.equal(encodeSection2Hex("HYP"), "0x485950");
    assert.equal(decodeSection2Hex("0x485950"), "HYP");
    const packet = "§KEY§eureka♥Krystian";
    assert.equal(decodeSection2Hex(encodeSection2Hex(packet)), packet);
  });

  it("refuses Section 1 JSON as on-chain payload", () => {
    assert.equal(isSection1JsonPayload({ section: 1 }), true);
    assert.equal(isSection1JsonPayload('{"section":1}'), true);
    assert.throws(() => encodeSection2Hex({ section: 1 }), /off-chain/);
    assert.throws(() => encodeSection2Hex('{"schema":true}'), /off-chain/);
    assert.equal(SECTION1_SCHEMA.onChain, false);
    assert.equal(buildSection1Schema().decode.encoding, "utf8-hex");
  });

  it("points agents at a known tx hash and never invents one", () => {
    const known = "0x5c0a93e4707a4dcf49afd4c785cb2829bce11ed026e08ba08435272d19122adf";
    const ok = pointToTxHash(known);
    assert.equal(ok.ok, true);
    assert.equal(ok.tx, known);
    assert.equal(ok.section, 2);
    assert.match(ok.basescan, /basescan\.org\/tx\/0x5c0a93e4/);
    const bad = pointToTxHash("not-a-hash");
    assert.equal(bad.ok, false);
    assert.equal(bad.tx, null);
    assert.match(bad.reason, /never invent/);
  });
});

describe("value=0 hex / hitch when gas is covered; bank hex when unpaid", () => {
  beforeEach(() => resetVitaFeedBank());

  it("plans value=0 hex self-tx when free ride covers gas", () => {
    const plan = planHexInject({
      text: "§KEY§eureka♥Krystian",
      value: 0n,
      freeRide: true,
      leftoverEth: 0.0004,
      hitchCostEth: 0.0002,
    });
    assert.equal(plan.action, "zero-value");
    assert.equal(plan.allowZeroValueHex, true);
    assert.equal(plan.tx.value, 0n);
    assert.equal(plan.tx.data, encodeSection2Hex("§KEY§eureka♥Krystian"));
    assert.equal(plan.sent, false);
    assert.equal(plan.banked, false);
    assert.equal(plan.injectThought, true);
  });

  it("banks hex (never drops the brain) when gas cannot be covered", () => {
    const plan = planHexInject({
      text: liveBugCalldata(5513),
      value: 0n,
      pairedUniswapSell: false,
    });
    assert.equal(plan.action, "bank");
    assert.equal(plan.banked, true);
    assert.ok(plan.hex.startsWith("0x5b564954"));
    assert.equal(peekBankedVitaFeed()[0].hex, plan.hex);
    assert.equal(peekBankedVitaFeed()[0].txHash, null);
  });
});

describe("wiring — dedicated inscribe paths must use the gate", () => {
  it("vita-memory / memory-engine / agent queue never send unpaired [VITA: self-calls", () => {
    const vitaMem = readFileSync(join(root, "vita-memory.js"), "utf8");
    const memEng = readFileSync(join(root, "memory-engine.js"), "utf8");
    const agent = readFileSync(join(root, "agent.js"), "utf8");

    assert.ok(vitaMem.includes("attemptVitaChainWrite"), "vitaSave chunks must bank via feed gate");
    assert.ok(!/sendTransaction/.test(vitaMem), "vita-memory must not broadcast dedicated self-txs");

    assert.ok(memEng.includes("attemptVitaChainWrite"), "inscribeMemory must bank via feed gate");
    assert.ok(!/sendTransaction/.test(memEng), "memory-engine must not broadcast dedicated self-txs");

    const qStart = agent.indexOf("LEGACY KNOWLEDGE-BASE PROCESSING");
    const qEnd = agent.indexOf("Vault expiry warning");
    assert.ok(qStart >= 0 && qEnd > qStart, "queue processor block must exist");
    const qBody = agent.slice(qStart, qEnd);
    assert.ok(qBody.includes("attemptVitaChainWrite"), "VITA queue must bank unpaired STORE");
    assert.ok(!qBody.includes("sendTransaction"), "VITA queue must not send solo self-calls");

    const learn = agent.indexOf("Build 5 chunks");
    const learnEnd = agent.indexOf("File in registry", learn);
    const learnBody = agent.slice(learn, learnEnd > learn ? learnEnd : learn + 2500);
    assert.ok(learnBody.includes("attemptVitaChainWrite"), "/vitalearn must bank not self-call");
    assert.ok(!learnBody.includes("sendTransaction"), "/vitalearn must not send solo self-calls");

    const ikn = agent.indexOf("Inscribe the 5 chunks to Base first");
    const iknEnd = agent.indexOf("Attach tx hashes", ikn);
    const iknBody = agent.slice(ikn, iknEnd > ikn ? iknEnd : ikn + 2500);
    assert.ok(iknBody.includes("attemptVitaChainWrite"), "IKN queue must use feed gate");
    assert.ok(!iknBody.includes("sendTransaction"), "IKN queue must not send solo self-calls");
  });
});
