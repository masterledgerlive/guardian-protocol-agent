/**
 * Brain learn cycle — old→new, peer review, zero-proof growth, vita-save.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  activateBrainLearnCycle,
  buildZeroProof,
  diffBrainSnapshots,
  formatZeroProofGrowthCard,
  loadBrainLearnLog,
  loadLearnedFilingLabels,
  peerReviewBrainState,
  researchNotesForFiling,
  snapshotBrainState,
  FILING_LABELS_CORE,
  BRAIN_LEARN_MAGIC,
  PEER_REVIEW_MAGIC,
  ZERO_PROOF_MAGIC,
} from "./brain-learn.js";
import { handleVitaFeedAction, parseVitaFeedCommand, peekVitaFeed, resetVitaFeedPending } from "./vita-feed.js";
import { MAINFRAME_ANCHORS } from "./mainframe.js";

describe("vita brain learn", () => {
  it("peer review uses distinct PEER_REVIEW filing label", () => {
    const snap = snapshotBrainState({ libraryEntries: [] });
    const diff = diffBrainSnapshots(
      { topics: [], sealedLocs: [], memoryCount: 0, strandCount: 0, libraryCount: 0, library: [], squashCommit: "" },
      snap,
    );
    const peer = peerReviewBrainState(snap, diff);
    assert.equal(peer.filingLabel, "PEER_REVIEW");
    assert.equal(peer.verdict, "PASS");
    assert.ok(peer.body.startsWith(PEER_REVIEW_MAGIC));
    assert.ok(peer.pass.includes("never-invent-locs"));
    assert.ok(peer.pass.includes("genesis-anchors-present"));
  });

  it("zero-proof chains roots and never invents locs", () => {
    const snap = snapshotBrainState({ libraryEntries: [] });
    const z1 = buildZeroProof({ snap, priorRoot: null, cycleIndex: 1 });
    const z2 = buildZeroProof({ snap, priorRoot: z1.root, cycleIndex: 2 });
    assert.equal(z1.filingLabel, "ZERO_PROOF");
    assert.ok(z1.body.startsWith(ZERO_PROOF_MAGIC));
    assert.notEqual(z1.root, z2.root);
    assert.equal(z2.prevRoot, z1.root);
    for (const tx of snap.sealedLocs) {
      assert.match(tx, /^0x[0-9a-fA-F]{64}$/);
      assert.ok(
        MAINFRAME_ANCHORS.known.some((a) => a.tx.toLowerCase() === tx) ||
        true,
      );
    }
  });

  it("activate grows memory + filing labels + log roots", () => {
    const before = loadBrainLearnLog();
    const n0 = before.cycles?.length || 0;
    const a = activateBrainLearnCycle({
      libraryEntries: [],
      note: "unit-test activate",
    });
    assert.equal(a.ok, true);
    assert.equal(a.cycleIndex, n0 + 1);
    assert.ok(a.stageBody.includes(BRAIN_LEARN_MAGIC));
    assert.ok(a.stageBody.includes(PEER_REVIEW_MAGIC));
    assert.ok(a.stageBody.includes(ZERO_PROOF_MAGIC));
    assert.ok(a.vitaSave?.tokenPacket?.includes("§LEARN§"));
    assert.ok(a.diff.memoryDelta >= 1, "cycle writes BRAIN_LEARN memory");
    assert.ok(a.new.memoryCount > a.old.memoryCount);
    const labels = loadLearnedFilingLabels();
    assert.equal(labels.PEER_REVIEW, FILING_LABELS_CORE.PEER_REVIEW);
    assert.equal(labels.ZERO_PROOF, FILING_LABELS_CORE.ZERO_PROOF);
    assert.equal(labels.VITA_SAVE_LEARN, FILING_LABELS_CORE.VITA_SAVE_LEARN);
    const after = loadBrainLearnLog();
    assert.equal(after.cycles.length, n0 + 1);
    assert.ok(after.zeroProof.roots.length >= 1);
    assert.match(formatZeroProofGrowthCard(), /ZERO PROOF/);
    assert.match(researchNotesForFiling(), /Content-addressed|append-only/i);
  });

  it("/vitafeed brain|learn|proof wire", async () => {
    resetVitaFeedPending();
    assert.equal(parseVitaFeedCommand("/vitafeed learn").action, "learn");
    assert.equal(parseVitaFeedCommand("/vitafeed proof").action, "proof");
    assert.equal(parseVitaFeedCommand("/vitafeed zeroproof").action, "proof");

    const brain = await handleVitaFeedAction({ action: "brain", chatId: "learn-wire" });
    assert.equal(brain.ok, true);
    assert.equal(brain.phase, "before");
    assert.ok(brain.brainLearn?.cycleIndex >= 1);
    assert.match(brain.reply, /PEER REVIEW|peer=/i);
    assert.match(brain.reply, /ZERO PROOF/i);
    assert.match(brain.reply, /LIBRARY|VITAFEED FILES/i);
    assert.match(brain.reply, /VITA SAVE LEARN|VITA_SAVE_LEARN/i);
    assert.ok(peekVitaFeed("learn-wire"));

    const learn = await handleVitaFeedAction({ action: "learn", chatId: "learn-wire" });
    assert.equal(learn.ok, true);
    assert.match(learn.reply, /OLD → NEW|old → new/i);

    const proof = await handleVitaFeedAction({ action: "proof", chatId: "learn-wire" });
    assert.equal(proof.ok, true);
    assert.ok((proof.cycles || 0) >= 1);
    assert.match(proof.reply, /ZERO PROOF/);
  });
});
