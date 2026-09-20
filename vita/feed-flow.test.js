/**
 * Feed-flow ledger — proves memory is fed + IDM Basescan chat of locs.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  FEED_FLOW_LABEL,
  FEED_FLOW_MAGIC,
  feedFlowAnchorLocations,
  formatFeedFlowIdmChatCard,
  formatFeedFlowProofCard,
  loadFeedFlowLedger,
  recordFeedFlow,
  recordBrainLearnFeedFlow,
  feedFlowLedgerPath,
} from "./feed-flow.js";
import { MAINFRAME_ANCHORS } from "./mainframe.js";
import { activateBrainLearnCycle, loadBrainLearnLog } from "./brain-learn.js";
import { handleVitaFeedAction, parseVitaFeedCommand } from "./vita-feed.js";

describe("vita feed-flow", () => {
  it("anchors are real Base txs for IDM chat", () => {
    const locs = feedFlowAnchorLocations();
    assert.equal(locs.length, MAINFRAME_ANCHORS.known.length);
    for (const loc of locs) {
      assert.match(loc.location, /^0x[0-9a-fA-F]{64}$/);
      assert.match(loc.basescan, /^https:\/\/basescan\.org\/tx\/0x/);
      assert.match(loc.idmChat, /Input Data/);
    }
  });

  it("recordFeedFlow appends ledger and grows directory counts", () => {
    const before = loadFeedFlowLedger();
    const n0 = before.events?.length || 0;
    const r = recordFeedFlow({
      kind: "unit-test",
      topic: "feed-flow-unit",
      source: "test",
      body: "Prove IDM chat of blockchain locations for what is being fed.",
      locations: MAINFRAME_ANCHORS.known.map((a) => a.tx),
    });
    assert.equal(r.ok, true);
    assert.ok(r.event.id.startsWith("FF-"));
    assert.ok(r.event.locations.length >= 3);
    assert.match(r.idmCard, /IDM CHAT|Input Data/);
    assert.match(r.idmCard, /basescan\.org\/tx\//);
    const after = loadFeedFlowLedger();
    assert.equal(after.events.length, n0 + 1);
    assert.ok(after.growth.memoryCount >= 1);
    assert.ok(existsSync(feedFlowLedgerPath()));
    const growth = JSON.parse(
      readFileSync(new URL("./memory/feed-flow-growth.json", import.meta.url), "utf8"),
    );
    assert.equal(growth.filingLabel, FEED_FLOW_LABEL);
    assert.ok(growth.text.includes(FEED_FLOW_MAGIC));
    assert.ok(formatFeedFlowProofCard().includes("FEED FLOW PROOF"));
    assert.ok(formatFeedFlowIdmChatCard(r.event).includes("blockchain locations="));
  });

  it("brain activate records feed-flow with IDM locs", () => {
    const n0 = loadFeedFlowLedger().events?.length || 0;
    const cycles0 = loadBrainLearnLog().cycles?.length || 0;
    const a = activateBrainLearnCycle({
      libraryEntries: [],
      note: "feed-flow proof activate",
    });
    assert.equal(a.ok, true);
    assert.equal(a.cycleIndex, cycles0 + 1);
    assert.ok(a.feedFlow?.ok, "activate attaches feedFlow proof");
    assert.ok(a.card.includes("IDM") || a.card.includes("Input Data"));
    assert.ok(loadFeedFlowLedger().events.length >= n0 + 1);
    assert.ok(a.new.memoryCount > a.old.memoryCount);
  });

  it("/vitafeed proof surfaces feed-flow IDM card", async () => {
    const parsed = parseVitaFeedCommand("/vitafeed proof");
    assert.equal(parsed.action, "proof");
    const r = await handleVitaFeedAction({
      chatId: "feed-flow-test",
      action: "proof",
      body: "",
      quotes: { ethUsd: 3000, gasGwei: 0.05, l1BaseFeeGwei: 20 },
      seats: [],
    });
    assert.equal(r.ok, true);
    assert.match(r.reply, /FEED FLOW PROOF|IDM CHAT|Input Data/);
    assert.match(r.reply, /basescan\.org\/tx\//);
  });

  it("never invents hashes in IDM card", () => {
    const r = recordFeedFlow({
      kind: "no-fake",
      topic: "no-fake-locs",
      body: "fake hash must be dropped",
      locations: [
        "0xdeadbeef",
        "not-a-hash",
        MAINFRAME_ANCHORS.eurekaProveTx,
      ],
    });
    for (const loc of r.event.locations) {
      assert.match(loc.location, /^0x[0-9a-fA-F]{64}$/);
    }
    assert.ok(
      r.event.locations.some(
        (l) => l.location.toLowerCase() === MAINFRAME_ANCHORS.eurekaProveTx.toLowerCase(),
      ),
    );
  });
});
