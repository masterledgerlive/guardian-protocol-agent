/**
 * Mother-genesis recall bank — layered notes, refined queries last.
 * Force-bank never invents tx hashes.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAINFRAME_ANCHORS } from "./mainframe.js";
import { resetMotherGenesisRegistry } from "./mother-genesis.js";
import { resetFeedWrapBank, peekFeedWrapBank } from "./feed-wrap.js";
import {
  MG_RECALL_LABEL,
  MG_RECALL_MAGIC,
  RECALL_LAST_LAYER,
  RECALL_LAYER_ORDER,
  buildMotherGenesisRecallBody,
  forceInjectMotherGenesisRecall,
  formatRecallPullCard,
  parseRecallStack,
  pullMotherGenesisRecall,
  setMgRecallPathForTests,
} from "./mg-recall-bank.js";
import { handleVitaConsole } from "../vita-console.js";

describe("mother genesis recall bank", () => {
  let tmp;
  before(() => {
    tmp = mkdtempSync(join(tmpdir(), "mg-recall-"));
    setMgRecallPathForTests(join(tmp, "mg-recall-bank.json"));
    resetMotherGenesisRegistry();
    resetFeedWrapBank();
  });
  after(() => {
    setMgRecallPathForTests(null);
    try {
      rmSync(tmp, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  it("stack ends on refined queries and keeps notes attached", () => {
    const built = buildMotherGenesisRecallBody();
    assert.equal(built.ok, true);
    assert.deepEqual(
      built.layers.map((l) => l.id),
      [...RECALL_LAYER_ORDER],
    );
    assert.equal(built.layers.at(-1).id, RECALL_LAST_LAYER);
    assert.equal(built.layers.at(-1).role, "last");
    assert.match(built.body, new RegExp(MG_RECALL_MAGIC));
    assert.match(built.layers.find((l) => l.id === "NOTES").body, /ref-lib-calculator/);
    assert.match(built.layers.find((l) => l.id === "ANCHORS").body, /0x5c0a93e4/);
    assert.match(built.layers.find((l) => l.id === "REFINED_QUERIES").body, /PT-CALC-ASK-EN/);
    assert.match(built.layers.find((l) => l.id === "REFINED_QUERIES").body, /calculadora/);
    const stack = parseRecallStack(built.body);
    assert.equal(stack.ok, true);
    assert.equal(stack.last.id, RECALL_LAST_LAYER);
  });

  it("force inject banks hex and does not invent locations", async () => {
    resetMotherGenesisRegistry();
    resetFeedWrapBank();
    const result = await forceInjectMotherGenesisRecall();
    assert.equal(result.ok, true);
    assert.equal(result.banked, true);
    assert.equal(result.sealed, false);
    assert.equal(result.record.filingLabel, MG_RECALL_LABEL);
    assert.deepEqual(result.record.locations, []);
    assert.ok(result.record.lines.length >= 1);
    assert.match(result.record.readerKey, /^MGPLAIN\.MG-P-/);
    assert.ok(peekFeedWrapBank().length >= 1);
    assert.match(formatRecallPullCard(result), /none yet/);
    assert.match(formatRecallPullCard(result), /REFINED_QUERIES|last=/);

    const pulled = await pullMotherGenesisRecall();
    assert.equal(pulled.ok, true);
    assert.equal(pulled.source, "memory-bank");
    assert.equal(pulled.banked, true);
    assert.equal(pulled.lastLayer.id, RECALL_LAST_LAYER);
    assert.match(pulled.lastLayer.body, /proven=yes/);
    for (const tx of MAINFRAME_ANCHORS.known) {
      assert.ok(pulled.stack.layers.some((l) => l.body.includes(tx.tx)));
    }
  });

  it("refuses a sender that invents a non-hash", async () => {
    resetMotherGenesisRegistry();
    await assert.rejects(
      () => forceInjectMotherGenesisRecall({ sendTx: async () => "not-a-hash" }),
      /refuse invent/,
    );
  });

  it("console /vitamothergenesis FORCE recall force-banks", async () => {
    resetMotherGenesisRegistry();
    resetFeedWrapBank();
    const out = await handleVitaConsole({}, "/vitamothergenesis FORCE recall", {
      fetchCalldata: async () => "0x",
    });
    assert.equal(out.ok, true);
    assert.match(out.text, /FORCE BANK/);
    assert.match(out.text, /last=REFINED_QUERIES/);
    assert.match(out.text, /none yet/);
    assert.match(out.text, /Mother brain|motherBrain=untouched/i);
  });
});
