/**
 * VITAFEED dual-lane — human ↔ machine side-by-side + Basescan read receipt.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  VITADUAL_MAGIC,
  VITADUAL_RESTART_EXIT_USD,
  HUMAN_LANE,
  MACHINE_LANE,
  buildMachineLaneBody,
  prepareDualLaneCompare,
  formatBasescanReadReceipt,
  formatDualLaneSideBySideCard,
  formatDualLaneReceipt,
  formatRestartMoneyExitHint,
  buildDualStagePayload,
} from "./vita-feed-dual.js";
import {
  parseVitaFeedCommand,
  handleVitaFeedAction,
  resetVitaFeedPending,
  formatVitaFeedReceipt,
  seatsToBags,
} from "./vita-feed.js";

function paidOn() {
  return { VITAFEED_PAID: "yes", VITAFEED_RATE_LIMIT: "no" };
}

describe("vita-feed-dual machine lane", () => {
  it("builds machine body bound to human commit", () => {
    const r = buildMachineLaneBody("Hello VITA knowledge inject proof");
    assert.equal(r.ok, true);
    assert.equal(r.lane, MACHINE_LANE);
    assert.ok(r.body.startsWith(VITADUAL_MAGIC));
    assert.ok(r.machineBytes > 0);
    assert.ok(r.contentCommit.length >= 16);
    assert.match(r.packed.short, /^ZK§/);
  });

  it("refuses empty human text", () => {
    const r = buildMachineLaneBody("   ");
    assert.equal(r.ok, false);
  });
});

describe("vita-feed-dual side-by-side cost", () => {
  it("prices both lanes and shows size delta", () => {
    const dual = prepareDualLaneCompare(
      "Same knowledge in human plain and machine short for cost proof.",
      { ethUsd: 2481, gwei: 0.05, live: false },
    );
    assert.equal(dual.ok, true);
    assert.equal(dual.human.lane, HUMAN_LANE);
    assert.equal(dual.machine.lane, MACHINE_LANE);
    assert.ok(dual.human.cost.ok);
    assert.ok(dual.machine.cost.ok);
    assert.ok(dual.combined.injections >= 2);
    assert.ok(dual.combined.totalUsd > 0);
    const card = formatDualLaneSideBySideCard(dual, { phase: "before" });
    assert.match(card, /HUMAN LANE/);
    assert.match(card, /MACHINE LANE/);
    assert.match(card, /COMBINED PROOF MATH/);
    assert.match(card, /file sizes:/);
  });
});

describe("basescan read receipt", () => {
  const real =
    "0x931d84115692190a393b3a040debc5145bf8f05c8ad359ba61b861f6dbfb19db";

  it("lists only real hashes with Input Data UTF-8 hint", () => {
    const card = formatBasescanReadReceipt({
      locations: [real, "not-a-hash", "0xdead"],
      vinId: "VIN-TEST",
      lane: HUMAN_LANE,
      chatPreview: "hello chat",
    });
    assert.match(card, /BASESCAN READ RECEIPT/);
    assert.match(card, /Input Data → View as UTF-8/);
    assert.match(card, /basescan\.org\/tx\/0x931d8411/);
    assert.match(card, /spaced locs=1/);
    assert.doesNotMatch(card, /not-a-hash/);
  });

  it("receipt after dual seal bunches both location sets", () => {
    const dual = prepareDualLaneCompare("dual seal chat proof");
    const card = formatDualLaneReceipt({
      compare: dual,
      humanLocs: [real],
      machineLocs: [
        "0xd9827a9c70c78be7e165934b101b8774c10fdfe8d9720bafd293fff4e5203d73",
      ],
    });
    assert.match(card, /HUMAN/);
    assert.match(card, /MACHINE/);
    assert.match(card, /basescan\.org\/tx\/0x931d8411/);
    assert.match(card, /basescan\.org\/tx\/0xd9827a9c/);
    assert.match(card, /Input Data → UTF-8/);
  });
});

describe("restart money exit ≥ $0.50", () => {
  it("lists bags at or above floor", () => {
    const r = formatRestartMoneyExitHint({
      bags: [
        { symbol: "AERO", usd: 0.49 },
        { symbol: "VIRTUAL", usd: 1.25, tokens: 2 },
        { symbol: "CLANKER", bagUsd: 0.5 },
      ],
      floorUsd: VITADUAL_RESTART_EXIT_USD,
    });
    assert.equal(r.hits.length, 2);
    assert.match(r.card, /VIRTUAL/);
    assert.match(r.card, /CLANKER/);
    assert.doesNotMatch(r.card, /AERO/);
    assert.match(r.card, /\/exit VIRTUAL/);
  });

  it("seatsToBags maps price×balance", () => {
    const bags = seatsToBags([
      { symbol: "AERO", price: 1.0, balance: 0.8 },
      { symbol: "X", price: 1, balance: 0.1 },
    ]);
    assert.equal(bags[0].usd, 0.8);
    const hint = formatRestartMoneyExitHint({ bags });
    assert.equal(hint.hits.length, 1);
    assert.equal(hint.hits[0].symbol, "AERO");
  });
});

describe("/vitafeed translate · dual · restart", () => {
  beforeEach(() => {
    resetVitaFeedPending();
  });

  it("parses translate dual restart actions", () => {
    assert.equal(parseVitaFeedCommand("/vitafeed translate hello").action, "translate");
    assert.equal(parseVitaFeedCommand("/vitafeed dual knowledge").action, "dual");
    assert.equal(parseVitaFeedCommand("/vitafeed dual knowledge").body, "knowledge");
    assert.equal(parseVitaFeedCommand("/vitafeed restart").action, "restart");
  });

  it("translate returns side-by-side without staging seal", async () => {
    const r = await handleVitaFeedAction({
      action: "translate",
      body: "Cross compare human vs machine of this inject knowledge.",
      chatId: "xlat-1",
    });
    assert.equal(r.ok, true);
    assert.equal(r.phase, "translate");
    assert.match(r.reply, /HUMAN LANE/);
    assert.match(r.reply, /MACHINE LANE/);
  });

  it("dual stages both lanes and confirm seals human then machine", async () => {
    const stage = await handleVitaFeedAction({
      action: "dual",
      body: "Inject knowledge dual-lane proof body.",
      chatId: "dual-1",
    });
    assert.equal(stage.ok, true);
    assert.equal(stage.dual, true);
    assert.equal(stage.staged, true);
    assert.match(stage.reply, /SIDE-BY-SIDE/);

    let n = 0;
    const hashes = [];
    const r = await handleVitaFeedAction({
      action: "confirm",
      chatId: "dual-1",
      env: paidOn(),
      sendTx: async () => {
        n += 1;
        const h = "0x" + String(n).padStart(64, "a").slice(0, 64);
        hashes.push(h);
        return h;
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.dual, true);
    assert.ok(r.machineResult?.strand?.locations?.length >= 1);
    assert.ok(r.result?.strand?.locations?.length >= 1);
    assert.match(r.reply, /BASESCAN READ RECEIPT/);
    assert.match(r.reply, /Input Data → View as UTF-8|Input Data → UTF-8/);
    assert.match(r.reply, /basescan\.org\/tx\/0x/);
    assert.ok(n >= 2, "expected human + machine txs, got " + n);
  });

  it("single-lane receipt always includes Basescan read receipt", () => {
    const card = formatVitaFeedReceipt(
      {
        strand: {
          vinId: "VIN-X",
          readerKey: "VITAFEED.VIN-X",
          totalBytes: 12,
          totalChars: 12,
          totalChunks: 1,
          locations: [
            "0x5c0a93e4707a4dcf49afd4c785cb2829bce11ed026e08ba08435272d19122adf",
          ],
        },
      },
      { ok: true, label: "DEMO", totalEth: 0.00001, totalUsd: 0.02 },
    );
    assert.match(card, /BASESCAN READ RECEIPT/);
    assert.match(card, /Input Data → View as UTF-8/);
    assert.match(card, /spaced \/ bunched/);
  });

  it("buildDualStagePayload wires cost dual fields", () => {
    const p = buildDualStagePayload("stage dual payload");
    assert.equal(p.ok, true);
    assert.ok(p.cost.dualCombinedUsd > 0);
    assert.ok(p.machinePrepared.ok);
    assert.match(p.card, /HUMAN LANE/);
  });

  it("restart lists bags over fifty cents", async () => {
    const r = await handleVitaFeedAction({
      action: "restart",
      chatId: "restart-1",
      seats: [
        { symbol: "AERO", price: 1, balance: 2 },
        { symbol: "DUST", price: 0.1, balance: 1 },
      ],
    });
    assert.equal(r.ok, true);
    assert.match(r.reply, /AERO/);
    assert.doesNotMatch(r.reply, /DUST/);
  });
});
