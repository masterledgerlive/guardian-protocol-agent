/**
 * Blockchain brain seed — local design proof (never invent hashes).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  BRAIN_SEED_ID,
  BRAIN_SEED_MAGIC,
  buildBrainMindMap,
  buildBrainSeedBody,
  formatBrainSeedCard,
  proveBrainSeedLocal,
} from "./brain-seed.js";
import { MAINFRAME_ANCHORS } from "./mainframe.js";
import { prepareVitaFeed } from "./vita-feed.js";

describe("vita brain seed", () => {
  it("mind map uses hardcoded anchors only", () => {
    const mind = buildBrainMindMap();
    assert.equal(mind.id, BRAIN_SEED_ID);
    assert.equal(mind.anchors.length, MAINFRAME_ANCHORS.known.length);
    for (const a of mind.anchors) {
      assert.match(a.tx, /^0x[0-9a-fA-F]{64}$/);
      assert.ok(MAINFRAME_ANCHORS.known.some((k) => k.tx === a.tx));
    }
    assert.equal(mind.recall.neverInvent, true);
  });

  it("seed body is §VITABRAIN§ and fits VIN packets", () => {
    const body = buildBrainSeedBody();
    assert.ok(body.startsWith(BRAIN_SEED_MAGIC));
    assert.match(body, /keycat-plain/);
    assert.match(body, /eureka-prove/);
    assert.match(body, /vita-strand/);
    assert.match(body, /messageFirst=true/);
    const prepared = prepareVitaFeed(body);
    assert.equal(prepared.ok, true);
    assert.ok(prepared.totalChunks >= 1);
    assert.ok(prepared.totalBytes > 0);
  });

  it("local proof card is design-only (not LIVE)", () => {
    const proof = proveBrainSeedLocal();
    assert.equal(proof.ok, true);
    assert.equal(proof.label, "LOCAL");
    assert.match(proof.contentCommit, /^[0-9a-f]{64}$/);
    assert.match(formatBrainSeedCard(), /BLOCKCHAIN BRAIN/);
    assert.match(proof.note, /LOCAL/);
  });
});
