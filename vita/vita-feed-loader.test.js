/**
 * VITAFEED knowledge loader — curated packs, dual preload, did-you-know.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  KNOWLEDGE_PACKS,
  LOADER_THOUGHT_NOTE,
  buildPackFeedBody,
  listKnowledgePacks,
  getKnowledgePack,
  pricePackDual,
  preloadKnowledgePacks,
  formatDidYouKnowCard,
  formatCapabilityRecallCard,
  formatCipherHierarchyCard,
  buildPreloadAnimationFrames,
  ensureLoaderMemorySeeds,
  loaderPublicState,
  FEED_LOADER_MAGIC,
} from "./vita-feed-loader.js";
import {
  parseVitaFeedCommand,
  handleVitaFeedAction,
  resetVitaFeedPending,
} from "./vita-feed.js";
import {
  resetFeedBacklogForTests,
  setFeedBacklogPathForTests,
  listFeedBacklog,
} from "./vita-feed-backlog.js";

describe("vita-feed-loader packs", () => {
  it("ships cipher + programming + recursive packs", () => {
    const ids = listKnowledgePacks().map((p) => p.id);
    assert.ok(ids.includes("cipher-aes-gcm"));
    assert.ok(ids.includes("prog-architecture-refine"));
    assert.ok(ids.includes("recursive-llm-memory"));
    assert.ok(LOADER_THOUGHT_NOTE.thought.includes("backlog"));
  });

  it("builds feed body with human + machine blocks", () => {
    const pack = getKnowledgePack("cipher-aes-gcm");
    const body = buildPackFeedBody(pack);
    assert.ok(body.startsWith(FEED_LOADER_MAGIC));
    assert.match(body, /--- HUMAN ---/);
    assert.match(body, /--- MACHINE ---/);
    assert.match(body, /AES-256-GCM/);
  });

  it("dual-prices a pack", () => {
    const r = pricePackDual("prog-architecture-refine", { ethUsd: 2481, gwei: 0.05 });
    assert.equal(r.ok, true);
    assert.ok(r.dual.combined.totalUsd > 0);
    assert.match(r.card, /HUMAN LANE/);
  });
});

describe("vita-feed-loader preload → backlog", () => {
  let tmp;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "vita-loader-"));
    setFeedBacklogPathForTests(join(tmp, "backlog.json"));
    resetFeedBacklogForTests();
    resetVitaFeedPending();
  });

  it("preloads packs into existing backlog with animation frames", () => {
    const r = preloadKnowledgePacks({
      packIds: ["cipher-aes-gcm", "dual-lane-cost-mirror"],
      includeAll: false,
    });
    assert.equal(r.ok, true);
    assert.ok(r.added.length >= 1);
    assert.ok(r.animation.frames.length >= 3);
    assert.match(r.card, /DUAL COST MIRROR|LOADER/);
    const list = listFeedBacklog({ limit: 20 });
    assert.ok(list.items.some((i) => String(i.topic || "").includes("loader-")));
  });

  it("dedupes second preload", () => {
    preloadKnowledgePacks({ packIds: ["cipher-aes-gcm"], includeAll: false });
    const again = preloadKnowledgePacks({ packIds: ["cipher-aes-gcm"], includeAll: false });
    assert.ok(again.skipped.some((s) => s.reason === "deduped"));
  });
});

describe("did-you-know + capability + cipher", () => {
  it("formats know / recall / cipher cards", () => {
    assert.match(formatDidYouKnowCard({ rotate: 0 }), /Hey — did you know/);
    assert.match(formatCapabilityRecallCard({}), /capability proof|What recursive memory/);
    assert.match(formatCipherHierarchyCard(), /CIPHER:\\/);
    assert.match(formatCipherHierarchyCard(), /encodegenesisreveal/);
  });

  it("animation frames load file stack", () => {
    const anim = buildPreloadAnimationFrames({
      packs: KNOWLEDGE_PACKS.slice(0, 2),
      added: [{ hierarchy: "CIPHER\\AES-GCM" }],
      priced: [],
    });
    assert.match(anim.card, /FEED_LOADER|spinning/);
    assert.ok(anim.frames.some((f) => f.includes("█")));
  });
});

describe("/vitafeed load · know · recall · cipher", () => {
  let tmp;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "vita-loader-cmd-"));
    setFeedBacklogPathForTests(join(tmp, "backlog.json"));
    resetFeedBacklogForTests();
    resetVitaFeedPending();
  });

  it("parses loader actions", () => {
    assert.equal(parseVitaFeedCommand("/vitafeed load").action, "load");
    assert.equal(parseVitaFeedCommand("/vitafeed load cipher-aes-gcm").body, "cipher-aes-gcm");
    assert.equal(parseVitaFeedCommand("/vitafeed know").action, "know");
    assert.equal(parseVitaFeedCommand("/vitafeed hey").action, "know");
    assert.equal(parseVitaFeedCommand("/vitafeed recall").action, "recall");
    assert.equal(parseVitaFeedCommand("/vitafeed cipher").action, "cipher");
  });

  it("load replies with animation + dual costs", async () => {
    const r = await handleVitaFeedAction({
      action: "load",
      body: "cipher-aes-gcm",
      chatId: "load-1",
    });
    assert.equal(r.ok, true);
    assert.match(r.reply, /FEED_LOADER|VITAFEED LOADER|spinning|DUAL/);
    assert.match(r.reply, /THOUGHT:/);
  });

  it("know and recall return Telegram cards", async () => {
    const know = await handleVitaFeedAction({ action: "know", body: "0", chatId: "k1" });
    assert.match(know.reply, /did you know/i);
    const recall = await handleVitaFeedAction({ action: "recall", chatId: "r1" });
    assert.match(recall.reply, /capability|chains/i);
    const cipher = await handleVitaFeedAction({ action: "cipher", chatId: "c1" });
    assert.match(cipher.reply, /CIPHER/);
  });

  it("loaderPublicState exposes packs for animated HTML", () => {
    const s = loaderPublicState({});
    assert.equal(s.id, "vita-feed-loader-v1");
    assert.ok(s.packs.length >= 4);
    assert.ok(s.animation.frames.length >= 2);
    assert.ok(ensureLoaderMemorySeeds().ok);
  });
});
