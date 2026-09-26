/**
 * Every test is a message cascade of the love Eureka into each token.
 * Mother brain untouched. Never invent hashes.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MESSAGE_CASCADE_ID,
  MESSAGE_CASCADE_MAGIC,
  CASCADE_TARGET_HOPS,
  CASCADE_WINDOW_MS,
  CASCADE_LEAVE_DUST_USD,
  CASCADE_CHEAP_RANGE_MAX,
  DEFAULT_CASCADE_MESSAGE,
  loadWavePointsFromToken,
  characterSpotBuyUsd,
  armSellOnMoveUp,
  scoreCascadeSeat,
  rankCascadeTokens,
  cascadeCadenceStatus,
  buildEurekaCascadeShard,
  planMessageCascade,
  buildMessageKnowledgePair,
  defaultCascadeKnowledge,
  formatMessageCascadeCard,
} from "./message-cascade.js";
import {
  VERIFIED_HOME_ADDRESS,
  VERIFIED_HOME_SYMBOL,
  HOME_FEE_TIER,
} from "../operator-rotate.js";
import { VITA_PROOF_FULL } from "../swap-minout.js";
import { MAINFRAME_ANCHORS } from "./mainframe.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

function catalogTokens() {
  return [
    {
      symbol: "AERO",
      address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631",
      price: 1.02,
      minTrough: 1.0,
      maxPeak: 1.2,
      predictedUp: true,
      revenueUsd: 0.4,
    },
    {
      symbol: "VIRTUAL",
      address: "0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b",
      price: 1.01,
      troughs: [1.0, 1.005],
      peaks: [1.15, 1.18],
      predictedUp: true,
      revenueUsd: 0.9,
      recentMovePct: 0.01,
      movingUp: true,
    },
    {
      symbol: "CLANKER",
      price: 1.10,
      minTrough: 1.0,
      maxPeak: 1.2,
      predictedUp: false,
      stagnant: true,
      revenueUsd: 0.05,
    },
    {
      symbol: "TOSHI",
      price: 0.00021,
      minTrough: 0.00020,
      maxPeak: 0.00030,
      predictedUp: true,
      revenueUsd: 0.2,
    },
    {
      symbol: "BRETT",
      price: 0.05,
      minTrough: 0.04,
      maxPeak: 0.08,
      predictedUp: true,
      revenueUsd: 0.15,
    },
    {
      symbol: "DEGEN",
      price: 0.004,
      minTrough: 0.0035,
      maxPeak: 0.006,
      predictedUp: true,
      revenueUsd: 0.12,
    },
    {
      symbol: "AIXBT",
      price: 0.03,
      minTrough: 0.025,
      maxPeak: 0.05,
      predictedUp: true,
      revenueUsd: 0.08,
    },
    {
      symbol: "KEYCAT",
      price: 0.002,
      minTrough: 0.0018,
      maxPeak: 0.003,
      predictedUp: true,
      revenueUsd: 0.06,
    },
    {
      symbol: VERIFIED_HOME_SYMBOL,
      address: VERIFIED_HOME_ADDRESS,
      feeTier: HOME_FEE_TIER,
      price: 0.02,
      minTrough: 0.018,
      maxPeak: 0.03,
      predictedUp: true,
      revenueUsd: 0.0,
    },
    {
      symbol: "XCN",
      frozen: true,
      price: 1,
      minTrough: 0.9,
      maxPeak: 1.2,
      revenueUsd: 99,
    },
  ];
}

describe("message cascade — love Eureka into each token", () => {
  it("cascades the full Eureka love note as the default message body", () => {
    assert.equal(DEFAULT_CASCADE_MESSAGE, VITA_PROOF_FULL);
    assert.match(DEFAULT_CASCADE_MESSAGE, /Eureka!/i);
    assert.match(DEFAULT_CASCADE_MESSAGE, /Krystian/);
    assert.match(DEFAULT_CASCADE_MESSAGE, /Kai/);
    assert.match(DEFAULT_CASCADE_MESSAGE, /Koda/);
    assert.match(DEFAULT_CASCADE_MESSAGE, /IKN|Living Network/i);
  });

  it("cascades Eureka into every available token hop (8+ seats)", () => {
    const plan = planMessageCascade({
      tokens: catalogTokens(),
      message: VITA_PROOF_FULL,
      hopTimestamps: [],
      maxHops: 8,
    });
    assert.equal(plan.id, MESSAGE_CASCADE_ID);
    assert.equal(plan.magic, MESSAGE_CASCADE_MAGIC);
    assert.ok(plan.hopCount >= CASCADE_TARGET_HOPS);
    assert.equal(plan.leaveDustUsd, CASCADE_LEAVE_DUST_USD);
    for (const hop of plan.hops) {
      assert.match(hop.shard.body, /Eureka!/i);
      assert.match(hop.shard.body, /Krystian/);
      assert.equal(hop.shard.loveNote, true);
      assert.equal(hop.shard.location, null); // never invent
      assert.equal(hop.leaveDustUsd, 0.05);
      assert.ok(hop.shard.line.includes(`[W:v1:${hop.symbol}]`));
    }
    assert.equal(plan.neverInventHashes, true);
    assert.equal(plan.neverSellRedToInject, true);
    assert.equal(plan.wallet, MAINFRAME_ANCHORS.wallet);
  });

  it("loads wave high/low instantly from token-embedded data (no cold scan)", () => {
    const fromFields = loadWavePointsFromToken({
      symbol: "AERO",
      price: 1.03,
      minTrough: 1,
      maxPeak: 2,
    });
    assert.equal(fromFields.ready, true);
    assert.equal(fromFields.instant, true);
    assert.equal(fromFields.source, "token-embedded");
    assert.ok(fromFields.rangePos <= CASCADE_CHEAP_RANGE_MAX + 1e-12);

    const fromArrays = loadWavePointsFromToken({
      symbol: "VIRTUAL",
      price: 1.05,
      troughs: [1.0, 1.02],
      peaks: [1.2, 1.25],
    });
    assert.equal(fromArrays.minTrough, 1.0);
    assert.equal(fromArrays.maxPeak, 1.25);
    assert.equal(fromArrays.ready, true);
    assert.equal(fromArrays.instant, true);
  });

  it("cascades into lowered waiting-up seats first (cheaper rate, anti-stagnant)", () => {
    const ranked = rankCascadeTokens(catalogTokens());
    assert.ok(ranked.available.length >= 8);
    assert.equal(ranked.blocked.some((b) => b.symbol === "XCN"), true);
    // Top seats prefer revenue + waiting-up over stagnant CLANKER
    const topSyms = ranked.available.slice(0, 3).map((r) => r.symbol);
    assert.ok(topSyms.includes("VIRTUAL") || topSyms.includes("AERO"));
    const clankerIdx = ranked.available.findIndex((r) => r.symbol === "CLANKER");
    const virtualIdx = ranked.available.findIndex((r) => r.symbol === "VIRTUAL");
    assert.ok(virtualIdx >= 0 && clankerIdx >= 0);
    assert.ok(virtualIdx < clankerIdx, "revenue+upbeat VIRTUAL ranks above stagnant CLANKER");
    assert.ok(ranked.stagnant.some((s) => s.symbol === "CLANKER"));
  });

  it("cascades HOME as available — verified address + fee 3000, never invent", () => {
    const plan = planMessageCascade({ tokens: catalogTokens() });
    assert.equal(plan.home.symbol, VERIFIED_HOME_SYMBOL);
    assert.equal(plan.home.address, VERIFIED_HOME_ADDRESS);
    assert.equal(plan.home.feeTier, HOME_FEE_TIER);
    assert.equal(plan.home.cascadeAvailable, true);
    assert.equal(plan.home.role, "cascade-main-inout");
    assert.equal(plan.piggyHolder.symbol, "HOME");
    assert.equal(plan.piggyHolder.parkDustOnHome, true);
    assert.ok(plan.home.capabilitiesWhileHolding.length >= 5);
    const homeHop = plan.hops.find((h) => h.symbol === "HOME")
      || plan.ranked.find((r) => r.symbol === "HOME");
    assert.ok(homeHop);
    assert.equal(homeHop.piggyHolder || homeHop.home, true);
    const shard = buildEurekaCascadeShard({
      symbol: "HOME",
      message: VITA_PROOF_FULL,
      index: 1,
      total: 1,
    });
    assert.match(shard.line, /\[W:v1:HOME\]/);
    assert.match(shard.body, /Eureka!/);
    assert.equal(shard.location, null);
  });

  it("cascades character spot buy for the whole love note (always trigger)", () => {
    const c = characterSpotBuyUsd(VITA_PROOF_FULL);
    assert.ok(c.chars > 50);
    assert.ok(c.bytes >= c.chars || c.bytes > 0);
    assert.ok(c.spotBuyUsd > 0);
    assert.equal(c.alwaysTrigger, true);
  });

  it("cascades a pre-armed sell when the token is moving up (profit path)", () => {
    const arm = armSellOnMoveUp({
      symbol: "VIRTUAL",
      price: 1.12,
      minTrough: 1.0,
      maxPeak: 1.2,
      movingUp: true,
      predictedUp: true,
    });
    assert.equal(arm.armed, true);
    assert.equal(arm.exitAt, 1.2);
    assert.equal(arm.leaveDustUsd, 0.05);
    assert.match(arm.reason, /sell pre-armed/i);

    const hold = armSellOnMoveUp({
      symbol: "CLANKER",
      price: 1.1,
      minTrough: 1.0,
      maxPeak: 1.2,
      predictedUp: false,
      movingUp: false,
      recentMovePct: 0,
    });
    // rangePos = 0.5 < 0.55 move-up band and not flagged moving → hold
    assert.equal(hold.armed, false);
  });

  it("cascades cadence: needs ≥8 hops / 15 minutes when stagnant", () => {
    assert.equal(CASCADE_TARGET_HOPS, 8);
    assert.equal(CASCADE_WINDOW_MS, 15 * 60_000);
    const empty = cascadeCadenceStatus([], { now: 1_000_000 });
    assert.equal(empty.onPace, false);
    assert.equal(empty.shortfall, 8);
    assert.equal(empty.needFaster, true);

    const now = 1_000_000;
    const stamps = Array.from({ length: 8 }, (_, i) => now - i * 60_000);
    const ok = cascadeCadenceStatus(stamps, { now });
    assert.equal(ok.onPace, true);
    assert.equal(ok.hops, 8);
    assert.equal(ok.shortfall, 0);

    const plan = planMessageCascade({
      tokens: catalogTokens(),
      hopTimestamps: [],
      now,
    });
    assert.ok(plan.cadence.needFaster);
    assert.ok(plan.hopCount >= 8);
    assert.equal(plan.cheaperRate, true);
  });

  it("cascades operator message then agentic knowledge (alternation)", () => {
    const operator =
      "Let’s make sure we make every test as a message cascade of my love eureka message into each token";
    const pair = buildMessageKnowledgePair({
      operatorText: operator,
      agentKnowledge: defaultCascadeKnowledge(),
      topic: "message-cascade-eureka",
    });
    assert.deepEqual(pair.alternation, ["message", "knowledge"]);
    assert.equal(pair.message.role, "operator");
    assert.equal(pair.knowledge.role, "agent");
    assert.equal(pair.knowledge.usefulForTimeToCome, true);
    assert.match(pair.knowledge.text, /HOME/);
    assert.match(pair.knowledge.text, /8 tokens/);
    assert.match(pair.knowledge.text, /0\.05/);
    assert.equal(pair.chain[0].kind, "message");
    assert.equal(pair.chain[1].kind, "knowledge");
    assert.ok(pair.message.contentSha12.length === 12);
  });

  it("cascades a Telegram-ready card summarizing the hop list", () => {
    const plan = planMessageCascade({ tokens: catalogTokens(), maxHops: 8 });
    const card = formatMessageCascadeCard(plan);
    assert.match(card, /MESSAGE CASCADE/);
    assert.match(card, /Eureka|hop|dust/i);
    assert.match(card, /VIRTUAL|AERO|HOME/);
  });

  it("scoreCascadeSeat prefers revenue without inventing P&L numbers", () => {
    const a = scoreCascadeSeat({
      symbol: "A",
      revenueUsd: 1,
      price: 1.01,
      minTrough: 1,
      maxPeak: 2,
      predictedUp: true,
    });
    const b = scoreCascadeSeat({
      symbol: "B",
      revenueUsd: 0,
      price: 1.01,
      minTrough: 1,
      maxPeak: 2,
      predictedUp: true,
    });
    assert.ok(a.score > b.score);
    assert.equal(a.revenueUsd, 1);
  });
});

describe("message cascade — HOME catalog + filing wired", () => {
  it("token-mins lists HOME for cascade smoke floor", () => {
    const src = readFileSync(join(ROOT, "token-mins.js"), "utf8");
    assert.match(src, /HOME:\s*0\.50/);
  });

  it("package.json runs message-cascade tests", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    assert.match(pkg.scripts.test, /vita\/message-cascade\.test\.js/);
  });

  it("FILING maps MESSAGE_CASCADE", () => {
    const filing = readFileSync(join(HERE, "FILING.md"), "utf8");
    assert.match(filing, /message-cascade\.js/);
    assert.match(filing, /MESSAGE_CASCADE/);
  });
});
