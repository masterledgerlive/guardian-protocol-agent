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
  resetVitaFeedPending,
  runVitaFeedInscribe,
  stageVitaFeed,
  utf8ToHex,
} from "./vita-feed.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

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
    assert.ok(!src.includes("vita-memory.js"));
    assert.ok(!src.includes("memory-engine.js"));
    assert.ok(!src.includes("vitaSave"));
    assert.ok(!src.includes("inscribeChunk"));
    assert.ok(!src.includes("mother-genesis.js"));
    assert.ok(!src.includes("VITA_AUTO_INSCRIBE"));
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

    const fStart = agent.indexOf("/vitafeed — Storage Token game");
    const fEnd = agent.indexOf('} else if (text && text.startsWith("/vita "))', fStart);
    assert.ok(fStart >= 0 && fEnd > fStart, "vitafeed handler must be its own command, not inside /vitasave");
    const feed = agent.slice(fStart, fEnd);
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

describe("vitafeed stage helpers", () => {
  beforeEach(() => resetVitaFeedPending());

  it("stage / peek / clear", () => {
    stageVitaFeed("c", { prepared: { ok: true, lines: [1] } });
    assert.ok(peekVitaFeed("c"));
    assert.equal(clearVitaFeed("c"), true);
    assert.equal(peekVitaFeed("c"), null);
  });
});
