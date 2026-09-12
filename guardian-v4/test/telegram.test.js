import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  applyHitchBank,
  consumeHitchBankOnSend,
  creditHitchBank,
  formatV4DryRunCard,
  formatV4SellSkipHitchCard,
  formatV4SkipCard,
  hitchBankCreditEth,
  hitchBudgetBalanceEth,
  leftoverVsHitchFloor,
  planHitchMessaging,
  prefixV4,
  resetHitchBudget,
  sendV4Telegram,
  V4_TELEGRAM_TAG,
} from "../telegram.js";
import { telegramBotToken, telegramChatId, env } from "../config.js";

const agentSrc = readFileSync(new URL("../agent.js", import.meta.url), "utf8");
const configSrc = readFileSync(new URL("../config.js", import.meta.url), "utf8");
const rootAgentSrc = readFileSync(new URL("../../agent.js", import.meta.url), "utf8");

const TG_KEYS = [
  "GUARDIAN_V4_TELEGRAM_BOT_TOKEN",
  "GUARDIAN_V4_TELEGRAM_CHAT_ID",
  "GUARDIAN_V4_SHARE_ROOT_ENV",
  "VAULT_TELEGRAM_BOT_TOKEN",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_CHAT_ID",
  "VAULT_TELEGRAM_CHAT_ID",
];

async function withEnv(overrides, fn) {
  const prev = {};
  for (const k of TG_KEYS) prev[k] = process.env[k];
  for (const k of TG_KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(overrides)) {
    if (v == null) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const k of TG_KEYS) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

describe("guardian-v4 telegram env via config.env()", () => {
  it("prefers GUARDIAN_V4_TELEGRAM_* over root names", async () => {
    await withEnv({
      GUARDIAN_V4_TELEGRAM_BOT_TOKEN: "v4-bot",
      GUARDIAN_V4_TELEGRAM_CHAT_ID: "v4-chat",
      GUARDIAN_V4_SHARE_ROOT_ENV: "yes",
      VAULT_TELEGRAM_BOT_TOKEN: "vault-bot",
      TELEGRAM_BOT_TOKEN: "root-bot",
      TELEGRAM_CHAT_ID: "root-chat",
    }, () => {
      assert.equal(env("TELEGRAM_BOT_TOKEN"), "v4-bot");
      assert.equal(env("TELEGRAM_CHAT_ID"), "v4-chat");
      assert.equal(telegramBotToken(), "v4-bot");
      assert.equal(telegramChatId(), "v4-chat");
    });
  });

  it("SHARE_ROOT_ENV=yes falls back to VAULT_TELEGRAM_BOT_TOKEN then TELEGRAM_BOT_TOKEN", async () => {
    await withEnv({
      GUARDIAN_V4_SHARE_ROOT_ENV: "yes",
      VAULT_TELEGRAM_BOT_TOKEN: "vault-bot",
      TELEGRAM_BOT_TOKEN: "root-bot",
      TELEGRAM_CHAT_ID: "root-chat",
    }, () => {
      assert.equal(telegramBotToken(), "vault-bot");
      assert.equal(telegramChatId(), "root-chat");
    });
    await withEnv({
      GUARDIAN_V4_SHARE_ROOT_ENV: "yes",
      TELEGRAM_BOT_TOKEN: "root-bot",
      TELEGRAM_CHAT_ID: "root-chat",
    }, () => {
      assert.equal(env("TELEGRAM_BOT_TOKEN"), "root-bot");
      assert.equal(telegramBotToken(), "root-bot");
      assert.equal(telegramChatId(), "root-chat");
    });
  });

  it("does not read root telegram unless SHARE_ROOT_ENV=yes", async () => {
    await withEnv({
      TELEGRAM_BOT_TOKEN: "root-bot",
      TELEGRAM_CHAT_ID: "root-chat",
      VAULT_TELEGRAM_BOT_TOKEN: "vault-bot",
    }, () => {
      assert.equal(telegramBotToken(), undefined);
      assert.equal(telegramChatId(), undefined);
    });
  });
});

describe("guardian-v4 [V4] turn cards — dry-run, no invented P&L", () => {
  beforeEach(() => resetHitchBudget(0));

  it("prefixes every outbound card with [V4] on the first line", () => {
    const card = formatV4DryRunCard({
      symbol: "DOT",
      dryRun: true,
      hitchPlan: planHitchMessaging({
        leftoverEth: 0.0000125,
        hitchCostEth: 0.00001,
        hitchOnChain: true,
        hitchBytes: 69,
        hitchUtf8: "§$STORE§ §KEY§vita §LOC§n=1",
        hitchKind: "vita",
      }),
      calldataChars: 240,
    });
    assert.equal(card.startsWith(`${V4_TELEGRAM_TAG}\n`), true);
    assert.match(card, /TURN CARD — BUY DOT/);
    assert.match(card, /dry-run yes/);
    assert.match(card, /tx — \(not broadcast\)/);
    assert.match(card, /hitch planned 69 B KEY\+LOC/);
    assert.match(card, /leftover .* vs hitch floor .* · COVER/);
    assert.match(card, /calldata planned 240 hex chars \(not broadcast\)/);
    assert.doesNotMatch(card, /0x[0-9a-fA-F]{10}/);
    assert.doesNotMatch(card, /micro P&L|closed FIFO|P&L \+|invented profit/i);
    assert.equal(prefixV4(card), card);
  });

  it("dry-run skip banks hitch and never invents a hash or P&L", () => {
    const plan = planHitchMessaging({
      leftoverEth: 0.000004,
      hitchCostEth: 0.00001,
      hitchOnChain: false,
      skipReason: "leftover cannot cover hitch — plain swap (letter skipped, no loss)",
    });
    assert.equal(plan.hitchSkipped, true);
    assert.equal(plan.leftoverVsFloor, "SHORT");
    assert.ok(plan.hitchBankedEth > 0);
    assert.equal(plan.hitchBankedEth, hitchBankCreditEth(0.000004, 0.00001));
    const bank = applyHitchBank(plan, "DOT");
    assert.match(bank.log, /HITCH_BANK: skip DOT/);
    assert.match(bank.log, /not P&L/);
    const card = formatV4DryRunCard({
      symbol: "DOT",
      dryRun: true,
      hitchPlan: plan,
    });
    assert.match(card, /^\[V4\]/);
    assert.match(card, /dry-run yes/);
    assert.match(card, /hitch skipped · banked/);
    assert.match(card, /SKIP_HITCH leftover cannot cover hitch/);
    assert.match(card, /leftover .* vs hitch floor .* · SHORT/);
    assert.doesNotMatch(card, /hitch (sent|planned) \d/);
    assert.doesNotMatch(card, /0x[0-9a-fA-F]{8}/);
    assert.doesNotMatch(card, /\$\d/);
  });

  it("skip card and prefix helper tag every status line", () => {
    const skip = formatV4SkipCard({
      reason: "no primed V4 avenue this cycle — nothing broadcast",
      dryRun: true,
      cycle: 3,
    });
    assert.match(skip, /^\[V4\]/);
    assert.match(skip, /TURN CARD — SKIP/);
    assert.match(skip, /dry-run yes/);
    assert.match(skip, /cycle 3/);
    assert.match(skip, /nothing broadcast/);
  });

  it("leftover vs floor is unknown when numbers are missing — never invented", () => {
    assert.equal(leftoverVsHitchFloor({ leftoverEth: null, hitchFloorEth: 0.001 }).verdict, "unknown");
    assert.equal(leftoverVsHitchFloor({ leftoverEth: 0.001, hitchFloorEth: null }).verdict, "unknown");
    assert.equal(leftoverVsHitchFloor({ leftoverEth: 0.002, hitchFloorEth: 0.001 }).verdict, "COVER");
    assert.equal(leftoverVsHitchFloor({ leftoverEth: 0, hitchFloorEth: 0.001 }).verdict, "SHORT");
  });
});

describe("guardian-v4 #89 SKIP_HITCH hitch-bank (sell path note)", () => {
  beforeEach(() => resetHitchBudget(0));

  it("ports micro-extract bank note without inventing FIFO P&L", () => {
    const card = formatV4SellSkipHitchCard({
      symbol: "DOT",
      dryRun: true,
      leftoverEth: 0.000004,
      hitchFloorEth: 0.000008,
    });
    assert.match(card, /^\[V4\]/);
    assert.match(card, /TURN CARD — SELL DOT/);
    assert.match(card, /dry-run yes/);
    assert.match(card, /hitch skipped · banked/);
    assert.match(card, /SKIP_HITCH/);
    assert.match(card, /not P&L/);
    assert.match(card, /FIFO — unknown \(not invented\)/);
    assert.doesNotMatch(card, /micro P&L/);
    assert.doesNotMatch(card, /closed FIFO/);
    assert.doesNotMatch(card, /0x[0-9a-fA-F]{8}/);
    const bank = creditHitchBank(0.000004, { symbol: "DOT" });
    assert.equal(hitchBudgetBalanceEth(), 0.000004);
    const cleared = consumeHitchBankOnSend({ symbol: "DOT" });
    assert.equal(cleared.spent, 0.000004);
    assert.equal(hitchBudgetBalanceEth(), 0);
    assert.match(bank.log, /not P&L/);
  });

  it("hitch skip reason from leftover-cover miss feeds the dry-run card", () => {
    const plan = planHitchMessaging({
      leftoverEth: 0,
      hitchCostEth: 0.001,
      hitchOnChain: false,
      skipReason: "leftover cannot cover hitch — plain swap (letter skipped, no loss)",
    });
    const card = formatV4DryRunCard({ symbol: "DOT", dryRun: true, hitchPlan: plan });
    assert.match(card, /SKIP_HITCH/);
    assert.match(card, /plain swap/);
    assert.match(card, /leftover .* vs hitch floor .* · SHORT/);
  });
});

describe("guardian-v4 sendTelegram — dry-run still sends when configured", () => {
  it("posts [V4] HTML when token+chat are set; skips when missing", async () => {
    await withEnv({}, async () => {
      const none = await sendV4Telegram("hello", { fetchImpl: async () => { throw new Error("should not fetch"); } });
      assert.equal(none.sent, false);
      assert.equal(none.reason, "missing-credentials");
      assert.match(none.text, /^\[V4\]/);
    });

    const calls = [];
    await withEnv({
      GUARDIAN_V4_TELEGRAM_BOT_TOKEN: "v4-bot",
      GUARDIAN_V4_TELEGRAM_CHAT_ID: "99",
    }, async () => {
      const ok = await sendV4Telegram(formatV4DryRunCard({
        symbol: "AERO",
        dryRun: true,
        hitchPlan: planHitchMessaging({
          leftoverEth: 0.001,
          hitchCostEth: 0.0001,
          hitchOnChain: true,
          hitchBytes: 40,
        }),
      }), {
        fetchImpl: async (url, opts) => {
          calls.push({ url, opts });
          return { json: async () => ({ ok: true }) };
        },
      });
      assert.equal(ok.sent, true);
    });
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /api\.telegram\.org\/botv4-bot\/sendMessage/);
    const posted = JSON.parse(calls[0].opts.body);
    assert.equal(posted.chat_id, "99");
    assert.equal(posted.parse_mode, "HTML");
    assert.match(posted.text, /^\[V4\]/);
    assert.match(posted.text, /dry-run yes/);
    assert.match(posted.text, /TURN CARD — BUY AERO/);
  });
});

describe("guardian-v4 agent wires telegram without touching V3", () => {
  it("dry-run cycle sends V4 cards and never broadcasts", () => {
    assert.match(configSrc, /DRY_RUN = String\(env\("DRY_RUN", "yes"\)\)/);
    assert.ok(agentSrc.includes("sendV4Telegram"), "cycle must Telegram Game");
    assert.ok(agentSrc.includes("formatV4DryRunCard"), "dry-run turn cards");
    assert.ok(agentSrc.includes("formatV4SkipCard"), "skip reasons telegram");
    assert.ok(agentSrc.includes("planHitchMessaging"), "planned hitch skip/bank");
    assert.ok(agentSrc.includes("applyHitchBank"), "SKIP_HITCH banks hitch room");
    assert.ok(agentSrc.includes("not broadcast"), "dry-run must not claim a broadcast");
    assert.ok(!agentSrc.includes("sendTransaction"), "V4 agent must not broadcast swaps");
    assert.ok(!agentSrc.includes("../agent.js"), "must not import live V3 agent");
    assert.ok(!rootAgentSrc.includes("guardian-v4/telegram"), "must not merge V4 telegram into V3");
    assert.ok(!rootAgentSrc.includes("sendV4Telegram"), "V3 runtime stays free of V4 telegram");
  });
});
