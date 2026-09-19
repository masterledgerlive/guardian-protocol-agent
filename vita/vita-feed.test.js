/**
 * /vitafeed — exact plain paid inject (mother brain untouched).
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  VITAFEED_CONFIRM_CHARS,
  VITAFEED_MAX_CHUNK_BYTES,
  VITAFEED_PAYER,
  clearVitaFeed,
  estimateVitaFeedCost,
  evaluateVitaFeedThriftGate,
  formatVitaFeedCostCard,
  formatVitaFeedReceipt,
  handleVitaFeedAction,
  hexToUtf8,
  maySendVitaFeed,
  parseVitaFeedCommand,
  parseVitaFeedLine,
  peekVitaFeed,
  planVitaFeedChunks,
  prepareVitaFeed,
  reconstructVitaFeedBody,
  requiresVitaFeedConfirm,
  resetVitaFeedPaidLog,
  resetVitaFeedPending,
  runVitaFeedInscribe,
  stageVitaFeed,
  utf8ToHex,
  vitaFeedMinLiquidUsd,
  vitaFeedPaidEnabled,
} from "./vita-feed.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Isolate existing paid-path tests from the emergency kill-switch. */
function paidOn(extra = {}) {
  return {
    VITAFEED_PAID: "yes",
    VITAFEED_MIN_LIQUID_USD: "0",
    VITAFEED_RATE_LIMIT: "no",
    ...extra,
  };
}

describe("vitafeed chunk count math", () => {
  it("plans more than one injection for >1000 chars", () => {
    const body = "A".repeat(1001);
    assert.ok(body.length > VITAFEED_CONFIRM_CHARS);
    const plan = planVitaFeedChunks(body);
    assert.equal(plan.ok, true);
    assert.equal(plan.totalChars, 1001);
    assert.equal(plan.totalBytes, 1001);
    assert.equal(plan.totalBits, 1001 * 8);
    assert.equal(plan.maxBytes, VITAFEED_MAX_CHUNK_BYTES);
    assert.equal(plan.maxPayloadConstant, "VITAFEED_MAX_CHUNK_BYTES");
    assert.equal(plan.totalChunks, Math.ceil(1001 / VITAFEED_MAX_CHUNK_BYTES));
    assert.ok(plan.totalChunks >= 2);
    assert.equal(plan.injections, plan.totalChunks);
  });

  it("uses documented 720-byte payload constant", () => {
    assert.equal(VITAFEED_MAX_CHUNK_BYTES, 720);
    const plan = planVitaFeedChunks("x".repeat(720));
    assert.equal(plan.totalChunks, 1);
    const two = planVitaFeedChunks("x".repeat(721));
    assert.equal(two.totalChunks, 2);
  });

  it("refuses empty body", () => {
    assert.equal(planVitaFeedChunks("").ok, false);
  });
});

describe("vitafeed exact UTF-8 roundtrip", () => {
  it("roundtrips emoji + CJK without summarization or §SESS§", () => {
    const body = "plain 你好🎉 café — no template\nline2";
    assert.ok(!body.includes("§SESS§"));
    const prepared = prepareVitaFeed(body, { maxBytes: 12 });
    assert.ok(prepared.ok);
    assert.ok(prepared.totalChunks >= 2);
    for (const line of prepared.lines) {
      const back = hexToUtf8(utf8ToHex(line.line));
      assert.equal(back, line.line);
      const parsed = parseVitaFeedLine(back);
      assert.equal(parsed.body, line.body);
    }
    const rebuilt = reconstructVitaFeedBody(prepared.lines);
    assert.equal(rebuilt.ok, true);
    assert.equal(rebuilt.body, body);
    assert.ok(!prepared.lines.some((l) => l.line.includes("§SESS§") && !body.includes("§SESS§")));
  });

  it("does not invent a §SESS§ wrapper when the operator did not type it", () => {
    const prepared = prepareVitaFeed("hello world");
    const rebuilt = reconstructVitaFeedBody(prepared.lines);
    assert.equal(rebuilt.body, "hello world");
    assert.doesNotMatch(rebuilt.body, /§SESS§/);
  });

  it("keeps §SESS§ if the operator typed it", () => {
    const body = "§SESS§ I typed this";
    const rebuilt = reconstructVitaFeedBody(prepareVitaFeed(body).lines);
    assert.equal(rebuilt.body, body);
  });
});

describe("vitafeed confirm gate", () => {
  beforeEach(() => resetVitaFeedPending());

  it("always requires confirm — preview never sends", async () => {
    assert.equal(requiresVitaFeedConfirm(), true);
    const preview = await handleVitaFeedAction({
      action: "preview",
      body: "hello",
      chatId: "t1",
      sendTx: async () => {
        throw new Error("must not send on preview");
      },
    });
    assert.equal(preview.phase, "before");
    assert.equal(preview.staged, true);
    assert.match(preview.reply, /CONFIRM required/i);
    assert.equal(maySendVitaFeed({ confirmed: false, pendingRow: peekVitaFeed("t1") }), false);
    assert.equal(maySendVitaFeed({ confirmed: true, pendingRow: peekVitaFeed("t1") }), true);
  });

  it("confirm without a staged payload refuses", async () => {
    const r = await handleVitaFeedAction({ action: "confirm", chatId: "empty" });
    assert.equal(r.ok, false);
    assert.match(r.reply, /nothing staged/i);
  });

  it("parse treats bare confirm/cancel as gates, not payload", () => {
    assert.equal(parseVitaFeedCommand("/vitafeed confirm").action, "confirm");
    assert.equal(parseVitaFeedCommand("/vitafeed CONFIRM").action, "confirm");
    assert.equal(parseVitaFeedCommand("/vitafeed cancel").action, "cancel");
    assert.equal(parseVitaFeedCommand("/vitafeed override").action, "override");
    assert.equal(parseVitaFeedCommand("/vitafeed overide").action, "override", "typo accepted");
    assert.equal(parseVitaFeedCommand("/vitafeed override").forceOverride, true);
    const prev = parseVitaFeedCommand("/vitafeed confirm this is payload");
    assert.equal(prev.action, "preview");
    assert.equal(prev.body, "confirm this is payload");
  });

  it("reply body is used when the command is bare", () => {
    const p = parseVitaFeedCommand("/vitafeed", { replyBody: "from reply" });
    assert.equal(p.action, "preview");
    assert.equal(p.body, "from reply");
    assert.equal(p.source, "reply");
  });

  it("paid confirm path records only real hashes", async () => {
    await handleVitaFeedAction({ action: "preview", body: "pay me", chatId: "pay" });
    let n = 0;
    const r = await handleVitaFeedAction({
      action: "confirm",
      chatId: "pay",
      env: paidOn(),
      sendTx: async () => {
        n += 1;
        return "0x" + String(n).padStart(64, "c").slice(0, 64);
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.phase, "after");
    assert.equal(r.result.strand.locations.length, 1);
    assert.match(r.reply, /basescan\.org\/tx\/0x/);
    assert.match(r.reply, /reader key: VITAFEED\.VIN-/);
    assert.equal(peekVitaFeed("pay"), null);
  });

  it("confirm RISK need includes buy-in stake unless already reserved", async () => {
    const seats = [{ symbol: "AERO", price: 1.01, minTrough: 1, maxPeak: 2, predictedUp: true }];
    const preview = await handleVitaFeedAction({
      action: "preview",
      body: "stake check",
      chatId: "stake-need",
      seats,
      quotes: { ethUsd: 2481, live: false },
    });
    assert.equal(preview.buyIn.ok, true);
    assert.ok(preview.buyIn.totalStakeEth > 0);
    const refuse = await handleVitaFeedAction({
      action: "confirm",
      chatId: "stake-need",
      seats,
      env: paidOn(),
      riskBalanceEth: 0.0000001,
      gasReserveEth: 0.0005,
      reserveBuyStake: true,
      sendTx: async () => "0x" + "a".repeat(64),
    });
    assert.equal(refuse.ok, false);
    assert.match(refuse.reply, /buy-in stake/);
    assert.match(refuse.reply, /vitafeed override/i);
    // Re-stage and confirm with stake already spent — only inscription+gas counted.
    await handleVitaFeedAction({
      action: "preview",
      body: "stake check 2",
      chatId: "stake-reserved",
      seats,
      quotes: { ethUsd: 2481, live: false },
    });
    const ok = await handleVitaFeedAction({
      action: "confirm",
      chatId: "stake-reserved",
      seats,
      env: paidOn(),
      riskBalanceEth: 0.01,
      gasReserveEth: 0.0005,
      reserveBuyStake: false,
      sendTx: async () => "0x" + "b".repeat(64),
    });
    assert.equal(ok.ok, true);
    assert.equal(ok.phase, "after");
  });

  it("/vitafeed override bypasses RISK balance REFUSE and still sends", async () => {
    const seats = [{ symbol: "AERO", price: 1.01, minTrough: 1, maxPeak: 2, predictedUp: true }];
    await handleVitaFeedAction({
      action: "preview",
      body: "force through",
      chatId: "override-me",
      seats,
      quotes: { ethUsd: 2481, live: false },
    });
    let sent = 0;
    const r = await handleVitaFeedAction({
      action: "override",
      chatId: "override-me",
      seats,
      env: paidOn(),
      riskBalanceEth: 0.0000001,
      gasReserveEth: 0.0005,
      reserveBuyStake: true,
      sendTx: async () => {
        sent += 1;
        return "0x" + String(sent).padStart(64, "d").slice(0, 64);
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.forcedOverride, true);
    assert.match(r.reply, /VITAFEED OVERRIDE/i);
    assert.equal(sent, 1);
    assert.equal(peekVitaFeed("override-me"), null);
  });
});

describe("vitafeed VIN / tailwind fields", () => {
  it("each chunk header has vin, prev hash, and next pointer", () => {
    const body = "Z".repeat(VITAFEED_MAX_CHUNK_BYTES * 2 + 10);
    const prepared = prepareVitaFeed(body);
    assert.ok(prepared.totalChunks >= 3);
    assert.match(prepared.vinId, /^VIN-[0-9A-F]+$/);
    assert.match(prepared.readerKey, /^VITAFEED\.VIN-/);

    const first = parseVitaFeedLine(prepared.lines[0].line);
    assert.equal(first.vinId, prepared.vinId);
    assert.equal(first.index, 1);
    assert.equal(first.prevHash, "00000000");
    assert.equal(first.nextIndex, 2);
    assert.equal(first.nextPtr, "2");

    const mid = parseVitaFeedLine(prepared.lines[1].line);
    assert.equal(mid.prevHash, prepared.lines[0].hash);
    assert.equal(mid.nextIndex, 3);

    const last = parseVitaFeedLine(prepared.lines[prepared.lines.length - 1].line);
    assert.equal(last.nextIndex, null);
    assert.equal(last.nextPtr, "END");
    assert.equal(last.prevHash, prepared.lines[prepared.lines.length - 2].hash);

    const card = formatVitaFeedCostCard(estimateVitaFeedCost(prepared), prepared);
    assert.match(card, /prev=/);
    assert.match(card, /next=/);
    assert.match(card, /VIN /);
    assert.match(card, /VITAFEED_MAX_CHUNK_BYTES/);
    assert.match(card, /DEMO|LIVE/);
    assert.match(card, /payer=RISK/);
  });

  it("receipt lists in/out bytes vs tx hashes", async () => {
    const prepared = prepareVitaFeed("abc");
    const hash = "0x" + "d".repeat(64);
    const result = await runVitaFeedInscribe(prepared, async () => hash);
    const receipt = formatVitaFeedReceipt(result, estimateVitaFeedCost(prepared));
    assert.match(receipt, /IN {2}bytes=/);
    assert.match(receipt, /OUT txs=1\/1/);
    assert.match(receipt, new RegExp(hash));
    assert.equal(result.strand.payer, VITAFEED_PAYER);
    assert.equal(result.strand.chunks[0].basescan, "https://basescan.org/tx/" + hash);
  });
});

describe("vitafeed mother brain stays out of the helper", () => {
  it("vita-feed.js does not import mother-brain internals", () => {
    const src = readFileSync(join(root, "vita/vita-feed.js"), "utf8");
    assert.doesNotMatch(src, /from ["'].*vita-memory/);
    assert.doesNotMatch(src, /from ["'].*memory-engine/);
    assert.doesNotMatch(src, /from ["'].*mother-genesis/);
    assert.doesNotMatch(src, /from ["'].*lose-zero-gate/);
    assert.doesNotMatch(src, /vitaSave\s*\(/);
    assert.doesNotMatch(src, /inscribeChunk\s*\(/);
    assert.doesNotMatch(src, /VITA_AUTO_INSCRIBE\s*=/);
  });

  it("git diff main is empty for VITA root inscription files", () => {
    const frozen = [
      "vita-memory.js",
      "memory-engine.js",
      "vita/mainframe.js",
      "vita/ORIGINAL_FORMULA.md",
      "vita/anchors.json",
      "vita/mother-genesis.js",
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

  it("agent /vitafeed is a thin confirm path; /vitasave keeps #106 bank wrap", () => {
    const agent = readFileSync(join(root, "agent.js"), "utf8");
    assert.match(agent, /\/vitafeed/);
    assert.match(agent, /handleVitaFeedAction/);
    assert.match(agent, /parseVitaFeedCommand/);
    assert.match(agent, /evaluateVitaFeedThriftGate/);
    assert.match(agent, /VITAFEED_PAID/);
    assert.match(agent, /File await is PREVIEW only/);

    const fStart = agent.indexOf("/vitafeed — Storage Token game");
    const fEnd = agent.indexOf('} else if (text && text.startsWith("/vita "))', fStart);
    assert.ok(fStart >= 0 && fEnd > fStart, "vitafeed handler must be its own command, not inside /vitasave");
    const feed = agent.slice(fStart, fEnd);
    assert.ok(feed.includes("evaluateVitaFeedThriftGate"), "Telegram must gate before buy-in/sendTransaction");
    assert.ok(feed.includes("WALLET_ADDRESS"), "RISK wallet only");
    assert.ok(!feed.includes("autoPaidInscribeEnabled"), "do not re-enable VITA_AUTO_INSCRIBE");
    assert.ok(!feed.includes("vitaSave("), "must not call mother brain vitaSave");
    assert.ok(!feed.includes("wrapAutoSelfCall"), "paid test — not bank-by-default wrap");
    assert.ok(!feed.includes("wrapVitaSaveSelfCall"), "vitafeed must not reuse /vitasave wrap");

    const vStart = agent.indexOf('} else if (text === "/vitasave")');
    const vEnd = agent.indexOf("} else if (text === \"/vitarecall\"");
    const vBody = agent.slice(vStart, vEnd);
    assert.ok(vBody.includes("vitaSave("), "#106 keeps vitaSave for env-on");
    assert.ok(vBody.includes("autoPaidInscribeEnabled"), "#106 bank-by-default wrap stays");
    assert.ok(vBody.includes("wrapVitaSaveSelfCall"), "#106 wrapVitaSaveSelfCall stays");
  });
});

describe("vitafeed emergency thrift gates", () => {
  beforeEach(() => resetVitaFeedPending());

  it("default refuses paid confirm (no sendTransaction)", async () => {
    assert.equal(vitaFeedPaidEnabled({}), false);
    assert.equal(vitaFeedPaidEnabled({ VITAFEED_PAID: "" }), false);
    assert.equal(vitaFeedPaidEnabled({ VITAFEED_PAID: "no" }), false);
    assert.equal(vitaFeedPaidEnabled({ VITAFEED_ENABLED: "yes" }), true);
    assert.equal(vitaFeedPaidEnabled({ VITAFEED_PAID: "true" }), true);
    assert.equal(vitaFeedPaidEnabled({ VITAFEED_PAID: "1" }), true);
    assert.equal(vitaFeedMinLiquidUsd({}), 5);

    await handleVitaFeedAction({ action: "preview", body: "drain me", chatId: "off-default" });
    let sent = 0;
    const r = await handleVitaFeedAction({
      action: "confirm",
      chatId: "off-default",
      env: {},
      sendTx: async () => {
        sent += 1;
        return "0x" + "e".repeat(64);
      },
    });
    assert.equal(r.ok, false);
    assert.equal(r.thrift, "paid-off");
    assert.equal(sent, 0);
    assert.match(r.reply, /paid confirm is OFF/i);
    assert.match(r.reply, /VITAFEED_PAID/);
    assert.ok(peekVitaFeed("off-default"), "staged cost card kept");
  });

  it("/vitafeed override cannot bypass VITAFEED_PAID=no", async () => {
    await handleVitaFeedAction({ action: "preview", body: "force", chatId: "off-override" });
    let sent = 0;
    const r = await handleVitaFeedAction({
      action: "override",
      chatId: "off-override",
      env: { VITAFEED_PAID: "no" },
      forceOverride: true,
      riskBalanceEth: 0,
      sendTx: async () => {
        sent += 1;
        return "0x" + "f".repeat(64);
      },
    });
    assert.equal(r.ok, false);
    assert.equal(r.thrift, "paid-off");
    assert.equal(sent, 0);
    assert.match(r.reply, /override cannot bypass/i);
    const gate = evaluateVitaFeedThriftGate({
      action: "override",
      env: {},
      forceOverride: true,
    });
    assert.equal(gate.ok, false);
    assert.equal(gate.code, "paid-off");
  });

  it("env-on allows confirm sendTransaction", async () => {
    await handleVitaFeedAction({ action: "preview", body: "allow me", chatId: "on-allow" });
    let sent = 0;
    const r = await handleVitaFeedAction({
      action: "confirm",
      chatId: "on-allow",
      env: { VITAFEED_PAID: "yes", VITAFEED_MIN_LIQUID_USD: "0", VITAFEED_RATE_LIMIT: "no" },
      liquidUsd: 20,
      sendTx: async () => {
        sent += 1;
        return "0x" + "a".repeat(64);
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.phase, "after");
    assert.equal(sent, 1);
    assert.equal(peekVitaFeed("on-allow"), null);
  });

  it("liquid floor refuses confirm but override bypasses money floor", async () => {
    const env = {
      VITAFEED_PAID: "yes",
      VITAFEED_MIN_LIQUID_USD: "5",
      VITAFEED_RATE_LIMIT: "no",
    };
    await handleVitaFeedAction({ action: "preview", body: "floor", chatId: "liq-confirm" });
    let sent = 0;
    const confirm = await handleVitaFeedAction({
      action: "confirm",
      chatId: "liq-confirm",
      env,
      liquidUsd: 2.97,
      sendTx: async () => {
        sent += 1;
        return "0x" + "b".repeat(64);
      },
    });
    assert.equal(confirm.ok, false);
    assert.equal(confirm.thrift, "liquid-floor");
    assert.equal(sent, 0);
    assert.match(confirm.reply, /liquid floor/i);
    assert.match(confirm.reply, /\$2\.97/);
    assert.match(confirm.reply, /override bypasses/i);

    await handleVitaFeedAction({ action: "preview", body: "floor2", chatId: "liq-override" });
    const over = await handleVitaFeedAction({
      action: "override",
      chatId: "liq-override",
      env,
      liquidUsd: 4.99,
      forceOverride: true,
      sendTx: async () => {
        sent += 1;
        return "0x" + "c".repeat(64);
      },
    });
    assert.equal(over.ok, true);
    assert.equal(over.phase, "after");
    assert.equal(over.forcedOverride, true);
    assert.equal(sent, 1);
    assert.match(over.reply, /money floor bypassed|liquid ≈/i);
    assert.equal(peekVitaFeed("liq-override"), null);
  });

  it("partial seal keeps sealed locs and restages remainder after error", async () => {
    const env = {
      VITAFEED_PAID: "yes",
      VITAFEED_MIN_LIQUID_USD: "0",
      VITAFEED_RATE_LIMIT: "no",
    };
    const body = "AAAA".repeat(200) + "BBBB".repeat(200);
    await handleVitaFeedAction({ action: "preview", body, chatId: "partial" });
    const staged = peekVitaFeed("partial");
    assert.ok(staged.prepared.totalChunks >= 2);
    let n = 0;
    const r = await handleVitaFeedAction({
      action: "override",
      chatId: "partial",
      env,
      forceOverride: true,
      riskBalanceEth: 0,
      sendTx: async () => {
        n += 1;
        if (n === 1) return "0x" + "d".repeat(64);
        throw new Error("insufficient funds for gas");
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.sealedCount, 1);
    assert.equal(r.result.banked, true);
    assert.equal(r.restaged, true);
    assert.match(r.reply, /PARTIAL/i);
    const again = peekVitaFeed("partial");
    assert.ok(again, "remainder restaged");
    assert.ok(again.prepared.totalChunks >= 1);
    assert.ok(again.resume?.priorLocations?.length === 1);

    // Resume override must not be blocked by cooldown after partial.
    const resume = await handleVitaFeedAction({
      action: "override",
      chatId: "partial",
      env: {
        VITAFEED_PAID: "yes",
        VITAFEED_MIN_LIQUID_USD: "0",
        VITAFEED_CONFIRM_COOLDOWN_SEC: "60",
        VITAFEED_MAX_CHUNKS_PER_HOUR: "24",
      },
      forceOverride: true,
      riskBalanceEth: 0,
      now: Date.now(),
      sendTx: async () => "0x" + "e".repeat(64),
    });
    assert.equal(resume.ok, true);
    assert.ok((resume.result?.sealedCount || 0) >= 1);
  });

  it("/vitafeed brain stages mind seed for override", async () => {
    const r = await handleVitaFeedAction({ action: "brain", chatId: "brain-chat" });
    assert.equal(r.ok, true);
    assert.equal(r.phase, "before");
    assert.ok(r.prepared?.ok);
    assert.match(r.reply, /BLOCKCHAIN BRAIN/i);
    assert.match(r.reply, /keycat-plain|eureka-prove|vita-strand/);
    assert.equal(parseVitaFeedCommand("/vitafeed brain").action, "brain");
    assert.ok(peekVitaFeed("brain-chat"));
  });

  it("rate limit refuses a second confirm in the same chat / 383-chunk hour cap", async () => {
    const env = {
      VITAFEED_PAID: "yes",
      VITAFEED_MIN_LIQUID_USD: "0",
      VITAFEED_CONFIRM_COOLDOWN_SEC: "60",
      VITAFEED_MAX_CHUNKS_PER_HOUR: "24",
    };
    const now = 1_000_000;
    await handleVitaFeedAction({ action: "preview", body: "first", chatId: "rl-chat" });
    const first = await handleVitaFeedAction({
      action: "confirm",
      chatId: "rl-chat",
      env,
      now,
      sendTx: async () => "0x" + "1".repeat(64),
    });
    assert.equal(first.ok, true);

    await handleVitaFeedAction({ action: "preview", body: "second", chatId: "rl-chat" });
    let sent = 0;
    const second = await handleVitaFeedAction({
      action: "confirm",
      chatId: "rl-chat",
      env,
      now: now + 12_000,
      sendTx: async () => {
        sent += 1;
        return "0x" + "2".repeat(64);
      },
    });
    assert.equal(second.ok, false);
    assert.equal(second.thrift, "cooldown");
    assert.equal(sent, 0);
    assert.match(second.reply, /rate limit/i);

    resetVitaFeedPaidLog();
    const huge = "H".repeat(720 * 25);
    await handleVitaFeedAction({ action: "preview", body: huge, chatId: "rl-huge" });
    const staged = peekVitaFeed("rl-huge");
    assert.ok(staged.prepared.totalChunks > 24, "383-class batch exceeds hourly cap");
    const cap = await handleVitaFeedAction({
      action: "confirm",
      chatId: "rl-huge",
      env,
      now: now + 120_000,
      sendTx: async () => {
        sent += 1;
        return "0x" + "3".repeat(64);
      },
    });
    assert.equal(cap.ok, false);
    assert.equal(cap.thrift, "chunk-cap");
    assert.equal(sent, 0);
    assert.match(cap.reply, /Hourly chunks/);

    const stale = evaluateVitaFeedThriftGate({
      action: "confirm",
      chatId: "stale",
      env,
      now: now + 120_000,
      messageAtMs: now - 200_000,
      chunkCount: 1,
    });
    assert.equal(stale.ok, false);
    assert.equal(stale.code, "stale-confirm");
  });
});

describe("vitafeed stage helpers", () => {
  beforeEach(() => resetVitaFeedPending());

  it("stage / peek / clear", () => {
    stageVitaFeed("c", { prepared: { ok: true, lines: [1] } });
    assert.ok(peekVitaFeed("c"));
    assert.equal(clearVitaFeed("c"), true);
    assert.equal(peekVitaFeed("c"), null);
  });
});
