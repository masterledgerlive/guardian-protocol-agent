/**
 * /vitafeed buy-in — new thread math only (mother brain untouched).
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  VITAFEED_AI_PIGGY_USD,
  VITAFEED_BUYIN_ID,
  VITAFEED_HUMAN_PIGGY_USD,
  VITAFEED_LOTTERY_PIGGY_USD,
  VITAFEED_LEAVE_BEHIND_MIN_USD,
  VITAFEED_LOW_RANGE_MAX,
  VITAFEED_SAVINGS_TAX_PCT,
  closeVitaFeedTicket,
  computeVitaFeedWholeCost,
  dueVitaFeedExit,
  evaluateVitaFeedWaveSeat,
  formatVitaFeedBuyInCard,
  hasOpenVitaFeedTicket,
  openVitaFeedTicket,
  pickVitaFeedBuyInSeat,
  planVitaFeedBuyIns,
  planVitaFeedInjectionBuyIn,
  resetVitaFeedTickets,
  vitaFeedExitSellPct,
} from "./vita-feed-buyin.js";
import { estimateVitaFeedCost, handleVitaFeedAction, prepareVitaFeed, resetVitaFeedPending } from "./vita-feed.js";
import { isManualOperatorBuy } from "../lose-zero-gate.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("vitafeed whole-cost stack", () => {
  it("taxes 1.5% of transmission + piggies + gwei + other + hidden, and leaves ≥ $0.25 + tax", () => {
    const c = computeVitaFeedWholeCost({
      charCostUsd: 0.05,
      gweiUsd: 0.01,
      otherFeesUsd: 0.02,
      hiddenCostUsd: 0, // pin hidden so the arithmetic stays exact
    });
    assert.equal(c.aiPiggyUsd, 0.10);
    assert.equal(c.humanPiggyUsd, 0.10);
    assert.equal(c.lotteryPiggyUsd, 0.05);
    assert.equal(c.piggyFloorUsd, 0.25);
    assert.equal(c.transmissionUsd, 0.05);
    const sub = 0.05 + 0.01 + 0.02 + 0 + 0.25;
    assert.equal(c.subtotalUsd, sub);
    assert.equal(c.taxUsd, sub * 0.015);
    assert.equal(c.wholeCostUsd, sub + c.taxUsd);
    assert.equal(c.leaveBehindUsd, 0.25 + c.taxUsd);
    assert.ok(c.leaveBehindUsd >= VITAFEED_LEAVE_BEHIND_MIN_USD + c.taxUsd - 1e-12);
    assert.equal(VITAFEED_SAVINGS_TAX_PCT, 0.015);
    assert.equal(VITAFEED_LOTTERY_PIGGY_USD, 0.05);
    assert.equal(
      VITAFEED_AI_PIGGY_USD + VITAFEED_HUMAN_PIGGY_USD + VITAFEED_LOTTERY_PIGGY_USD,
      VITAFEED_LEAVE_BEHIND_MIN_USD,
    );
  });
});

describe("vitafeed wave qualify (low 3% + predicted up)", () => {
  const base = { symbol: "AERO", minTrough: 1, maxPeak: 2, predictedUp: true, frozen: false };

  it("accepts a seat in the lowest 3% that is already coming up", () => {
    // range 1–2; 3% of range = 0.03 above trough → price 1.03
    const w = evaluateVitaFeedWaveSeat({ ...base, price: 1.03 });
    assert.equal(w.ok, true);
    assert.ok(w.rangePos <= VITAFEED_LOW_RANGE_MAX + 1e-12);
    assert.ok(w.dipPct > 0);
    assert.equal(w.predictedUp, true);
  });

  it("rejects above the low 3% even if predicted up", () => {
    const w = evaluateVitaFeedWaveSeat({ ...base, price: 1.10 });
    assert.equal(w.ok, false);
    assert.match(w.reason, /not in low 3%/);
  });

  it("rejects low-3% that is still predicted down", () => {
    const w = evaluateVitaFeedWaveSeat({ ...base, price: 1.02, predictedUp: false });
    assert.equal(w.ok, false);
    assert.match(w.reason, /not predicted coming up/);
  });

  it("picks the deepest qualifying seat", () => {
    const pick = pickVitaFeedBuyInSeat([
      { symbol: "UNI", price: 1.025, minTrough: 1, maxPeak: 2, predictedUp: true },
      { symbol: "AERO", price: 1.005, minTrough: 1, maxPeak: 2, predictedUp: true },
    ]);
    assert.equal(pick.symbol, "AERO");
  });

  it("among equal depth, prefers the seat with fewer prior trades", () => {
    const pick = pickVitaFeedBuyInSeat([
      { symbol: "UNI", price: 1.01, minTrough: 1, maxPeak: 2, predictedUp: true, tradeCount: 9 },
      { symbol: "AERO", price: 1.01, minTrough: 1, maxPeak: 2, predictedUp: true, tradeCount: 1 },
    ]);
    assert.equal(pick.symbol, "AERO");
  });
});

describe("vitafeed buy-in size and mirror exit", () => {
  it("sizes stake from character cost so same-% bounce covers whole cost", () => {
    const seat = { symbol: "DEGEN", price: 1.02, minTrough: 1, maxPeak: 2, predictedUp: true };
    const plan = planVitaFeedInjectionBuyIn({
      charCostUsd: 0.04,
      gweiUsd: 0.01,
      swapGasUsd: 0.02,
      seat,
      ethUsd: 2500,
    });
    assert.equal(plan.ok, true);
    assert.equal(plan.symbol, "DEGEN");
    assert.ok(Math.abs(plan.dipPct - (2 - 1.02) / 1.02) < 1e-12);
    assert.equal(plan.mirrorPct, plan.dipPct);
    const bounce = plan.stakeUsd * plan.dipPct;
    assert.ok(bounce + 1e-9 >= plan.cost.wholeCostUsd);
    assert.ok(plan.targetPct > plan.dipPct, "target adds cost overlay on top of the mirror");
    assert.ok(plan.targetPrice > plan.entryPrice * (1 + plan.dipPct) - 1e-12);
    assert.ok(plan.leaveBehindUsd >= 0.25);
    assert.ok(plan.stakeEth > 0);
  });

  it("plans one micro buy per injection from UTF-8 chunk cost", () => {
    const body = "Z".repeat(800);
    const prepared = prepareVitaFeed(body);
    const cost = estimateVitaFeedCost(prepared, { live: true, gwei: 0.05, ethUsd: 2481, l1FeeEth: 0 });
    assert.ok(prepared.totalChunks >= 2);
    const seats = [
      { symbol: "AERO", price: 1.01, minTrough: 1, maxPeak: 2, predictedUp: true, tradeCount: 2 },
      { symbol: "DEGEN", price: 1.015, minTrough: 1, maxPeak: 2, predictedUp: true, tradeCount: 1 },
    ];
    const plan = planVitaFeedBuyIns({ prepared, cost, seats, quotes: { ethUsd: 2481 } });
    assert.equal(plan.ok, true);
    assert.equal(plan.injections.length, prepared.totalChunks);
    assert.ok(plan.totalStakeUsd > plan.injections[0].stakeUsd);
    assert.match(formatVitaFeedBuyInCard(plan), /WRAP PLAN/);
    assert.match(formatVitaFeedBuyInCard(plan), /msg 01\//);
    assert.match(formatVitaFeedBuyInCard(plan), /@ range /);
    assert.match(formatVitaFeedBuyInCard(plan), /PIGGY BANK WAITING/);
    const first = plan.injections[0];
    const per = cost.perLine[0];
    const expectedChars = per.l2CalldataEth * 2481;
    const expectedGwei = (per.l2ExecEth + per.l1Eth) * 2481;
    assert.ok(Math.abs(first.charCostUsd - expectedChars) < 1e-9, "chars = calldata, not full injection twice");
    assert.ok(Math.abs(first.cost.gweiUsd - expectedGwei) < 1e-9, "gwei = exec+L1, not a second copy of per.eth");
    assert.ok(first.cost.wholeCostUsd > first.charCostUsd + first.cost.gweiUsd);
    const card = formatVitaFeedBuyInCard(plan);
    assert.match(card, /VITAFEED BUY-IN/);
    assert.match(card, /AERO/);
    assert.match(card, /lottery/);
    assert.match(card, /≥ \$0\.25/);
    assert.match(card, /1\.5%/);
  });

  it("skips buy when no qualifying seat — inscription still independent", () => {
    const prepared = prepareVitaFeed("hello");
    const cost = estimateVitaFeedCost(prepared);
    const plan = planVitaFeedBuyIns({
      prepared,
      cost,
      seats: [{ symbol: "UNI", price: 1.5, minTrough: 1, maxPeak: 2, predictedUp: true }],
    });
    assert.equal(plan.ok, false);
    assert.equal(plan.skipBuy, true);
    assert.match(formatVitaFeedBuyInCard(plan), /BUY SKIP/);
    assert.match(formatVitaFeedBuyInCard(plan), /message-first/);
  });

  it("five messages park ≥ $1.25 piggy and list each wrap token + range % before confirm", () => {
    const body = "W".repeat(720 * 5);
    const prepared = prepareVitaFeed(body);
    const cost = estimateVitaFeedCost(prepared, { live: true, gwei: 0.05, ethUsd: 2481, l1FeeEth: 0 });
    assert.ok(prepared.totalChunks >= 5);
    const seats = [
      { symbol: "AERO", price: 1.005, minTrough: 1, maxPeak: 2, predictedUp: true, tradeCount: 5 },
      { symbol: "DEGEN", price: 1.01, minTrough: 1, maxPeak: 2, predictedUp: true, tradeCount: 1 },
      { symbol: "BRETT", price: 1.015, minTrough: 1, maxPeak: 2, predictedUp: true, tradeCount: 2 },
      { symbol: "VIRTUAL", price: 1.02, minTrough: 1, maxPeak: 2, predictedUp: true, tradeCount: 0 },
      { symbol: "TOSHI", price: 1.025, minTrough: 1, maxPeak: 2, predictedUp: true, tradeCount: 3 },
    ];
    const plan = planVitaFeedBuyIns({ prepared, cost, seats, quotes: { ethUsd: 2481 } });
    assert.equal(plan.ok, true);
    assert.equal(plan.wrapped, 5);
    assert.ok(plan.totalPiggyFloorUsd + 1e-9 >= 1.25);
    const card = formatVitaFeedBuyInCard(plan);
    assert.match(card, /WRAP PLAN/);
    assert.match(card, /msg 01\/05 → AERO/);
    assert.match(card, /msg 05\/05 → TOSHI/);
    assert.match(card, /@ range /);
    assert.match(card, /5 × \$0\.25 floor = \$1\.25/);
    const syms = plan.injections.map((inj) => inj.symbol);
    assert.equal(new Set(syms).size, 5);
  });

  it("rotates a different red token per injection when several low-3% seats exist", () => {
    const body = "Q".repeat(800);
    const prepared = prepareVitaFeed(body);
    const cost = estimateVitaFeedCost(prepared, { live: true, gwei: 0.05, ethUsd: 2481, l1FeeEth: 0 });
    assert.ok(prepared.totalChunks >= 2);
    const seats = [
      { symbol: "AERO", price: 1.01, minTrough: 1, maxPeak: 2, predictedUp: true, tradeCount: 2 },
      { symbol: "DEGEN", price: 1.012, minTrough: 1, maxPeak: 2, predictedUp: true, tradeCount: 1 },
    ];
    const plan = planVitaFeedBuyIns({ prepared, cost, seats, quotes: { ethUsd: 2481 } });
    assert.equal(plan.ok, true);
    assert.equal(plan.injections.length, prepared.totalChunks);
    const syms = plan.injections.map((inj) => inj.symbol);
    assert.equal(new Set(syms).size, syms.length, "each injection should use a different red token");
  });
});

describe("vitafeed micro-exit tickets", () => {
  beforeEach(() => resetVitaFeedTickets());

  it("sells as soon as target is made and leaves ≥ $0.25 + tax in tokens", () => {
    const t = openVitaFeedTicket({
      symbol: "AERO",
      targetPrice: 1.2,
      leaveBehindUsd: 0.253,
    });
    assert.equal(dueVitaFeedExit({ symbol: "AERO", price: 1.19 }), null);
    const due = dueVitaFeedExit({ symbol: "AERO", price: 1.2 });
    assert.equal(due.id, t.id);
    const pct = vitaFeedExitSellPct({ balance: 100, price: 1.2, leaveBehindUsd: 0.253 });
    const leftoverUsd = (1 - pct) * 100 * 1.2;
    assert.ok(leftoverUsd + 1e-9 >= 0.203);
    assert.equal(hasOpenVitaFeedTicket("AERO"), true);
    closeVitaFeedTicket(t.id);
    assert.equal(hasOpenVitaFeedTicket("AERO"), false);
    assert.equal(dueVitaFeedExit({ symbol: "AERO", price: 1.5 }), null);
  });

  it("sizes the sell from the ticket lot so a mixed live-trader bag is not dumped", () => {
    const pct = vitaFeedExitSellPct({
      balance: 100,
      price: 1.2,
      leaveBehindUsd: 0.253,
      stakeUsd: 2.4,
      entryPrice: 1.0,
    });
    // lot now = 2.4 * 1.2 = 2.88; sell 2.88 - 0.253 = 2.627; bag = 120
    const sellUsd = pct * 100 * 1.2;
    assert.ok(sellUsd < 4, "must not sell the whole mixed bag");
    assert.ok(sellUsd + 1e-9 >= 2.88 - 0.253 - 1e-6);
    const leftoverUsd = (1 - pct) * 100 * 1.2;
    assert.ok(leftoverUsd > 100, "live-trader remainder stays");
  });
});

describe("vitafeed buy-in stays off mother brain", () => {
  it("does not import piggy-bank, lose-zero, vitaSave, or mother-genesis", () => {
    const src = readFileSync(join(root, "vita/vita-feed-buyin.js"), "utf8");
    assert.doesNotMatch(src, /from ["'].*piggy-bank/);
    assert.doesNotMatch(src, /from ["'].*lose-zero-gate/);
    assert.doesNotMatch(src, /from ["'].*vita-memory/);
    assert.doesNotMatch(src, /from ["'].*mother-genesis/);
    assert.doesNotMatch(src, /vitaSave\s*\(/);
    assert.equal(VITAFEED_BUYIN_ID, "vita-feed-buyin-v2");
    assert.equal(isManualOperatorBuy("VITAFEED BUYIN $1.23"), false);
    assert.equal(isManualOperatorBuy("VITAFEED EXIT"), false);
  });

  it("agent.js wires tickets without weakening leftover/edge operator bypass", () => {
    const agent = readFileSync(join(root, "agent.js"), "utf8");
    assert.match(agent, /collectVitaFeedSeats/);
    assert.match(agent, /vitaFeedBuyInReason|VITAFEED BUYIN \$/);
    assert.match(agent, /VITAFEED EXIT/);
    assert.match(agent, /dueVitaFeedExit/);
    assert.match(agent, /hasOpenVitaFeedTicket/);
    assert.match(agent, /openVitaFeedTicket/);
    assert.match(agent, /isVitaFeedBuyIn/);
    assert.match(agent, /peekVitaFeed/);
    const feedStart = agent.indexOf("/vitafeed — Storage Token game");
    const feedEnd = agent.indexOf('} else if (text && text.startsWith("/vita "))', feedStart);
    const feed = agent.slice(feedStart, feedEnd);
    assert.ok(feed.includes("executeBuy("), "confirm loop tries the character-sized buy");
    assert.ok(feed.includes("buy-in seats first") || feed.includes("Buy tokens BEFORE"), "buy before inscription");
    assert.ok(!feed.includes("isManualOperatorBuy"), "do not mark vitafeed as operator /buy");
    assert.match(agent, /Message still pays RISK|Injection still on-chain — message-first/);
  });

  it("preview and confirm-without-sender keep the buy-in card (message-first)", async () => {
    resetVitaFeedPending();
    const preview = await handleVitaFeedAction({
      action: "preview",
      body: "hello buyin",
      chatId: "buyin-card",
    });
    assert.equal(preview.buyIn.skipBuy, true);
    assert.match(preview.reply, /VITAFEED BUY-IN/);
    assert.match(preview.reply, /BUY SKIP/);
    const r = await handleVitaFeedAction({ action: "confirm", chatId: "buyin-card" });
    assert.ok(r.buyIn);
    assert.equal(r.buyIn.skipBuy, true);
    assert.match(r.reply, /BUY SKIP/);
    assert.match(r.reply, /Paid RISK path needs a sender/);
  });

  it("preview with a low-3% predicted-up seat sizes a buy on the cost card", async () => {
    resetVitaFeedPending();
    const preview = await handleVitaFeedAction({
      action: "preview",
      body: "hello seat",
      chatId: "buyin-seat",
      seats: [{ symbol: "AERO", price: 1.01, minTrough: 1, maxPeak: 2, predictedUp: true }],
    });
    assert.equal(preview.buyIn.ok, true);
    assert.equal(preview.buyIn.skipBuy, false);
    assert.match(preview.reply, /msg 01\/01 → AERO/);
    assert.ok(preview.buyIn.totalStakeUsd > 0);
  });

  it("git diff main is empty for VITA root inscription files", () => {
    const frozen = [
      "vita-memory.js",
      "memory-engine.js",
      "vita/mainframe.js",
      "vita/ORIGINAL_FORMULA.md",
      "vita/FILING.md",
      "vita/AGENTS.md",
      "vita/anchors.json",
      "vita/mother-genesis.js",
      "piggy-bank.js",
    ];
    for (const f of frozen) {
      let diff = "";
      try {
        diff = execSync("git diff main -- " + f, { encoding: "utf8", cwd: root });
      } catch {
        diff = execSync("git diff origin/main -- " + f, { encoding: "utf8", cwd: root });
      }
      assert.equal(diff, "", f + " must stay untouched vs main");
    }
  });
});
