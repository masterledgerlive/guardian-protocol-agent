/**
 * /vitafeed backlog — queue memory/files; drain without agentic AI.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FEED_BACKLOG_LABEL,
  FEED_BACKLOG_MAGIC,
  FEED_BACKLOG_PREF_MAX_CHUNKS,
  buildMemoryTopicFeedBody,
  enqueueFeedBacklogItem,
  enqueueBrainStageOnBacklog,
  formatFeedBacklogCard,
  formatFeedBacklogGrowthProof,
  listFeedBacklog,
  loadFeedBacklog,
  markFeedBacklogSeal,
  peekNextFeedBacklogItem,
  resetFeedBacklogForTests,
  seedFeedBacklogFromMemory,
  setFeedBacklogPathForTests,
  takeNextFeedBacklogForStage,
} from "./vita-feed-backlog.js";
import {
  handleVitaFeedAction,
  parseVitaFeedCommand,
  peekVitaFeed,
  resetVitaFeedPending,
  prepareVitaFeed,
} from "./vita-feed.js";
import { buildBrainSeedBody } from "./brain-seed.js";
import { MAINFRAME_ANCHORS } from "./mainframe.js";

const ANCHOR_TX = MAINFRAME_ANCHORS.known[0].tx;

describe("vitafeed backlog", () => {
  let tmp;
  before(() => {
    tmp = mkdtempSync(join(tmpdir(), "vita-feed-backlog-"));
    setFeedBacklogPathForTests(join(tmp, "vitafeed-backlog.json"));
    resetFeedBacklogForTests();
    resetVitaFeedPending();
  });
  after(() => {
    setFeedBacklogPathForTests(null);
    try {
      rmSync(tmp, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  it("parse backlog|enqueue|next commands", () => {
    assert.equal(parseVitaFeedCommand("/vitafeed backlog").action, "backlog");
    assert.equal(parseVitaFeedCommand("/vitafeed queue").action, "backlog");
    assert.equal(parseVitaFeedCommand("/vitafeed enqueue seed").action, "enqueue");
    assert.equal(parseVitaFeedCommand("/vitafeed enqueue seed").body, "seed");
    assert.equal(parseVitaFeedCommand("/vitafeed next").action, "next");
    assert.equal(parseVitaFeedCommand("/vitafeed drain").action, "next");
  });

  it("enqueues plain body, dedupes, never invents locs", () => {
    resetFeedBacklogForTests();
    const body = buildMemoryTopicFeedBody("unit-topic", {
      text: "hello backlog feed",
      formula: "original-message-first",
    });
    assert.ok(body.includes(FEED_BACKLOG_MAGIC));
    const a = enqueueFeedBacklogItem({
      body,
      topic: "unit-topic",
      name: "unit-topic.txt",
      kind: "plain",
      source: "test",
    });
    assert.equal(a.ok, true);
    assert.equal(a.item.status, "pending");
    assert.ok(a.item.chunks >= 1);
    assert.ok(a.item.chunks <= FEED_BACKLOG_PREF_MAX_CHUNKS);
    assert.equal(a.item.locationCount, 0);

    const dup = enqueueFeedBacklogItem({
      body,
      topic: "unit-topic",
      source: "test",
    });
    assert.equal(dup.ok, true);
    assert.equal(dup.deduped, true);

    const list = listFeedBacklog();
    assert.equal(list.growth.pending, 1);
    assert.equal(list.growth.sealed, 0);
    assert.match(formatFeedBacklogCard(list), /BACKLOG/);
    assert.match(formatFeedBacklogGrowthProof(), /GROWTH PROOF/);
  });

  it("next stages for confirm; seal records real hash only", async () => {
    resetFeedBacklogForTests();
    resetVitaFeedPending();
    const seed = buildBrainSeedBody();
    const enq = enqueueFeedBacklogItem({
      body: seed,
      topic: "brain-seed",
      name: "brain-seed.txt",
      kind: "brain",
      source: "test",
    });
    assert.equal(enq.ok, true);

    const next = await handleVitaFeedAction({
      action: "next",
      chatId: "bl-next",
      env: { VITAFEED_PAID: "yes", VITAFEED_MIN_LIQUID_USD: "0", VITAFEED_RATE_LIMIT: "no" },
    });
    assert.equal(next.ok, true);
    assert.equal(next.phase, "before");
    assert.ok(next.backlogId);
    assert.ok(peekVitaFeed("bl-next"));

    const peek = peekNextFeedBacklogItem();
    assert.equal(peek.ok, false, "staged item leaves pending empty");

    const fakeHash = ANCHOR_TX; // real hardcoded anchor — never invent
    const sealed = markFeedBacklogSeal({
      backlogId: next.backlogId,
      locations: [fakeHash, "not-a-hash", "0xdead"],
      vinId: "VIN-TEST",
      readerKey: "VITAFEED.VIN-TEST",
      partial: false,
      sealedCount: 1,
      needed: 1,
    });
    assert.equal(sealed.ok, true);
    assert.equal(sealed.item.status, "sealed");
    assert.equal(sealed.item.locationCount, 1);
    assert.equal(sealed.item.locations[0], fakeHash);
    assert.equal(sealed.growth.sealed, 1);
  });

  it("override path marks backlog seal from staged backlogId", async () => {
    resetFeedBacklogForTests();
    resetVitaFeedPending();
    enqueueFeedBacklogItem({
      body: "tiny backlog payload for override seal",
      topic: "tiny",
      name: "tiny.txt",
      source: "test",
    });
    const staged = await handleVitaFeedAction({
      action: "next",
      chatId: "bl-seal3",
      env: { VITAFEED_PAID: "yes", VITAFEED_MIN_LIQUID_USD: "0", VITAFEED_RATE_LIMIT: "no" },
    });
    assert.equal(staged.ok, true);
    assert.ok(staged.backlogId);

    let sends = 0;
    const sealed = await handleVitaFeedAction({
      action: "override",
      chatId: "bl-seal3",
      env: {
        VITAFEED_PAID: "yes",
        VITAFEED_MIN_LIQUID_USD: "0",
        VITAFEED_RATE_LIMIT: "no",
      },
      riskBalanceEth: 0.000001,
      liquidUsd: 0.01,
      sendTx: async () => {
        sends++;
        return ANCHOR_TX;
      },
    });
    assert.equal(sealed.ok, true);
    assert.ok(sends >= 1);
    assert.ok(sealed.backlog?.ok);
    assert.equal(sealed.backlog.item.status, "sealed");
    assert.equal(sealed.backlog.item.locations[0], ANCHOR_TX);
    assert.match(sealed.reply, /BACKLOG/i);
  });

  it("seed from memory parks brain seed; mother brain untouched", () => {
    resetFeedBacklogForTests();
    const seeded = seedFeedBacklogFromMemory({
      includeBrainSeed: true,
      includeTopics: true,
      maxTopics: 6,
    });
    assert.equal(seeded.ok, true);
    assert.ok(seeded.added >= 1);
    const store = loadFeedBacklog();
    assert.ok(store.items.some((i) => i.kind === "brain" || i.topic === "brain-seed"));
    assert.equal(store.filingLabel, FEED_BACKLOG_LABEL);
  });

  it("brain stage enqueue parks for offline drain", () => {
    resetFeedBacklogForTests();
    const r = enqueueBrainStageOnBacklog({
      stageBody: buildBrainSeedBody() + "\n§VITALEARN§test§",
      cycleIndex: 99,
    });
    assert.equal(r.ok, true);
    assert.match(r.item.topic, /brain-learn-cycle-099/);
  });

  it("hard-refuses runaway chunk dumps (thrift lesson)", () => {
    resetFeedBacklogForTests();
    const huge = "X".repeat(720 * 30);
    const r = enqueueFeedBacklogItem({
      body: huge,
      topic: "too-big",
      source: "test",
    });
    assert.equal(r.ok, false);
    assert.match(r.reason, /too many chunks|thrift/i);
  });
});
