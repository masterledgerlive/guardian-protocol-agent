/**
 * Spaced inject plan + honest sealed IDM — never formula-anchor hallucinate.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  SPACED_CHUNK_BYTES,
  bindSealedToPlan,
  buildAndMatchInjectPlan,
  formulaAnchorLocations,
  planSpacedLibraryInject,
  sealedInjectIdmLocations,
  verifyInjectPlanOnChain,
} from "./chain-inject.js";
import {
  formatSystemsCheckCard,
  handleChainLayerAction,
  parseChainLayerCommand,
  runSystemsCheck,
  snarkCompressProvenLibrary,
} from "./chain-layer.js";
import { MAINFRAME_ANCHORS } from "./mainframe.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const memoryDir = join(root, "vita", "memory");

describe("vita chain-inject spaced batches", () => {
  it("plans spaced chunks at hitch max bytes for code bigger than field", () => {
    const plan = planSpacedLibraryInject({ cwd: root });
    assert.ok(plan.totalChunks > 10, "library must need many spaced locs");
    assert.equal(plan.maxBytes, SPACED_CHUNK_BYTES);
    assert.equal(plan.spacedBlockchainLocationsRequired, plan.totalChunks);
    assert.ok(plan.chunks.every((c) => c.bytes <= SPACED_CHUNK_BYTES));
    assert.ok(plan.chunks.every((c) => c.sealed === false && c.location === null));
    assert.equal(plan.neverInventHashes, true);
  });

  it("never treats formula anchors as sealed library body", () => {
    const anchors = formulaAnchorLocations();
    assert.ok(anchors.length >= 3);
    assert.ok(anchors.every((a) => a.holdsLibraryBody === false));
    assert.ok(anchors.every((a) => a.role === "formula-anchor"));
  });

  it("binds only when contentCommit matches a real sealed tx", () => {
    const plan = planSpacedLibraryInject({ cwd: root });
    const first = plan.chunks[0];
    const fakeTx =
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const bound = bindSealedToPlan(plan, [
      { location: fakeTx, contentCommit: first.contentCommit, source: "test" },
    ]);
    assert.equal(bound.sealedCount, 1);
    assert.equal(bound.chunks[0].location, fakeTx);
    assert.equal(bound.chunks[0].sealed, true);
    const idm = sealedInjectIdmLocations(bound);
    assert.equal(idm.length, 1);
    assert.equal(idm[0].holdsLibraryBody, true);
    assert.match(idm[0].basescan, /basescan\.org\/tx\/0xaaa/);
  });

  it("verifies on-chain UTF-8 against chunk commit via fetchCalldata", async () => {
    const plan = planSpacedLibraryInject({ cwd: root });
    const first = plan.chunks[0];
    const tx = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const bound = bindSealedToPlan(plan, [
      { location: tx, contentCommit: first.contentCommit },
    ]);
    const hex = "0x" + Buffer.from(first.body, "utf8").toString("hex");
    const verified = await verifyInjectPlanOnChain(bound, {
      fetchCalldata: async () => hex,
    });
    assert.equal(verified.chunks[0].verified, true);
    assert.equal(verified.chunks[0].match, "chain-match");
    assert.equal(verified.pull.verified, 1);
  });

  it("SNARK localOnly when no sealed inject locs (no anchor hallucination)", () => {
    const snark = snarkCompressProvenLibrary({ cwd: root, sealedLocs: [] });
    assert.equal(snark.localOnly, true);
    assert.equal(snark.sealedLocCount, 0);
    assert.ok(!String(snark.short).includes("5c0a93e4"), "must not cite keycat as body loc");
  });

  it("systems check is honest: pending inject, IDM only sealed", async () => {
    const result = await runSystemsCheck({
      cwd: root,
      write: true,
      pull: false,
      env: { VITA_MODELS: "claude-sonnet-4-20250514" },
    });
    assert.ok(result.inject.totalChunks > 10);
    assert.equal(result.snark.localOnly, true);
    assert.equal((result.locations || []).length, result.inject.sealedCount);
    const card = formatSystemsCheckCard(result);
    assert.match(card, /LOCAL_ONLY|none sealed|SPACED INJECT/i);
    assert.match(card, /FORMULA ANCHORS/);
    assert.match(card, /class proof ONLY/i);
    assert.ok(existsSync(join(memoryDir, "chain-layer-inject.json")));
    const injectFile = JSON.parse(readFileSync(join(memoryDir, "chain-layer-inject.json"), "utf8"));
    assert.ok(injectFile.totalChunks > 10);
    assert.ok(injectFile.chunks.every((c) => !c.sealed || /^0x[0-9a-fA-F]{64}$/.test(c.location)));
  });

  it("parses check locs / check pull and returns spaced IDM keyboard", async () => {
    assert.equal(parseChainLayerCommand("/vita check locs").action, "locs");
    assert.equal(parseChainLayerCommand("/vita check pull").action, "pull");
    const out = await handleChainLayerAction({
      action: "locs",
      cwd: root,
      write: true,
    });
    assert.equal(out.ok, true);
    assert.match(out.reply, /SPACED INJECT|VITAINJECT/);
    assert.ok(out.keyboard?.inline_keyboard?.length >= 1);
    // No sealed yet → nav buttons only, no fake IDM urls to anchors as body
    const urls = out.keyboard.inline_keyboard.flat().filter((b) => b.url);
    for (const b of urls) {
      // formula anchors may be included with 🏷 label when includeFormulaAnchors
      assert.match(b.url, /basescan\.org\/tx\/0x/);
    }
  });

  it("buildAndMatchInjectPlan persists strand with formulaAnchors separated", async () => {
    const plan = await buildAndMatchInjectPlan({ cwd: root, write: true, pull: false });
    assert.ok(plan.totalChunks > 0);
    const strand = JSON.parse(
      readFileSync(join(root, "vita", "strands", "chain-layer-inject.json"), "utf8"),
    );
    assert.equal(strand.filingLabel, "CHAIN_INJECT");
    assert.ok(Array.isArray(strand.formulaAnchors));
    assert.ok(strand.formulaAnchors.every((a) => a.role === "formula-anchor"));
    // sealed inject list empty until real seals
    assert.equal((strand.locations || []).length, plan.sealedCount);
    for (const a of MAINFRAME_ANCHORS.known) {
      assert.ok(
        !strand.locations.some((l) => l.location === a.tx && l.role !== "formula-anchor"),
        "formula anchor must not appear as sealed inject body loc",
      );
    }
  });
});
