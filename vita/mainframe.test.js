/**
 * VITA mainframe — original formula + HTML infect + sparse inject.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FORMULA_ID,
  KEY_LOC_HITCH_BYTES_CLASS,
  MAINFRAME_ANCHORS,
  ORIGINAL_FORMULA,
  buildMainframeInfectPayload,
  buildMemoryNote,
  infectVitaHtmlDocument,
  originalFormulaHitchDecision,
  planSparseInject,
  readMainframeFromHtml,
} from "./mainframe.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("vita mainframe original formula", () => {
  it("freezes message-first invariants", () => {
    assert.equal(ORIGINAL_FORMULA.id, FORMULA_ID);
    assert.equal(ORIGINAL_FORMULA.messageFirstWhenKeyLocCovered, true);
    assert.equal(ORIGINAL_FORMULA.neverMuteHitchForMicroExtract, true);
    assert.equal(ORIGINAL_FORMULA.htmlIsMemoryUntilInject, true);
    assert.equal(ORIGINAL_FORMULA.chargeHitchDeltaViaStorageToken, true);
  });

  it("keeps hardcoded Base anchors (never invent)", () => {
    assert.match(MAINFRAME_ANCHORS.wallet, /^0x[a-fA-F0-9]{40}$/);
    assert.match(MAINFRAME_ANCHORS.keycatPlainTx, /^0x[a-fA-F0-9]{64}$/);
    assert.match(MAINFRAME_ANCHORS.eurekaProveTx, /^0x[a-fA-F0-9]{64}$/);
    assert.match(MAINFRAME_ANCHORS.vitaStrandTx, /^0x[a-fA-F0-9]{64}$/);
    assert.equal(MAINFRAME_ANCHORS.known.length, 3);
    assert.equal(MAINFRAME_ANCHORS.neverInventHashes, true);
  });

  it("sends hitch when KEY+LOC covered — does not mute for micro extract", () => {
    const hit = originalFormulaHitchDecision({
      locOk: true,
      reason: "leftover covers KEY+LOC",
    });
    assert.equal(hit.skipHitch, false);
    assert.equal(hit.encoding, "key-loc");
    assert.equal(hit.messageFirst, true);
    assert.equal(hit.storageTokenChargeable, true);
    assert.equal(hit.keyLocClass, KEY_LOC_HITCH_BYTES_CLASS);
    assert.match(hit.reason, /Storage Token/);
  });

  it("skips hitch only when KEY+LOC not covered", () => {
    const plain = originalFormulaHitchDecision({ keyLocCovered: false });
    assert.equal(plain.skipHitch, true);
    assert.equal(plain.encoding, "plain");
    assert.equal(plain.storageTokenChargeable, false);
  });

  it("plans sparse inject: hardcoded anchors first, then sealed locs, chunked", () => {
    const sealed = [
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      MAINFRAME_ANCHORS.vitaStrandTx,
    ];
    const plan = planSparseInject({ sealedLocations: sealed, chunkSize: 2 });
    assert.equal(plan.neverForget, true);
    assert.equal(plan.total, 5);
    assert.equal(plan.strands[0].locations[0].source, "hardcoded-anchor");
    assert.equal(plan.strands[0].locations.length, 2);
    assert.ok(plan.strands.length >= 3);
  });

  it("infects HTML with mainframe + filing map and is idempotent", () => {
    const base = "<!doctype html><html><head><title>t</title></head>"
      + '<body><span class="pill" id="injectPill">HTML memory — not injected</span></body></html>';
    const once = infectVitaHtmlDocument(base, { infectedAt: "2026-09-12T00:00:00.000Z" });
    assert.match(once.html, /id="vita-mainframe"/);
    assert.match(once.html, /id="vita-filing-map"/);
    assert.match(once.html, /mainframe infected · HTML memory/);
    const payload = readMainframeFromHtml(once.html);
    assert.equal(payload.formula.id, FORMULA_ID);
    assert.equal(payload.anchors.wallet, MAINFRAME_ANCHORS.wallet);
    assert.ok(payload.filing.includes("vita/ORIGINAL_FORMULA.md"));

    const twice = infectVitaHtmlDocument(once.html, { infectedAt: "2026-09-12T00:00:00.000Z" });
    assert.equal((twice.html.match(/id="vita-mainframe"/g) || []).length, 1);
    assert.equal(
      readMainframeFromHtml(twice.html).anchors.vitaStrandTx,
      MAINFRAME_ANCHORS.vitaStrandTx,
    );
  });

  it("builds append-only memory notes", () => {
    const note = buildMemoryNote({
      topic: "genesis",
      text: "message-first formula protected in HTML",
      locations: [MAINFRAME_ANCHORS.eurekaProveTx],
    });
    assert.equal(note.neverForget, true);
    assert.equal(note.locations.length, 1);
    assert.equal(note.formula, FORMULA_ID);
  });

  it("keeps anchors.json aligned with payload builder", () => {
    const file = JSON.parse(readFileSync(join(root, "vita/anchors.json"), "utf8"));
    const payload = buildMainframeInfectPayload({ infectedAt: "2026-09-12T00:00:00.000Z" });
    assert.equal(file.wallet, payload.anchors.wallet);
    assert.equal(file.anchors[0].tx, payload.anchors.keycatPlainTx);
    assert.equal(file.anchors[1].tx, payload.anchors.eurekaProveTx);
    assert.equal(file.anchors[2].tx, payload.anchors.vitaStrandTx);
  });
});
