/**
 * Proven tests — calculator REF_LIB recursive memory search.
 * Answers only from packaged ledger + Base anchors; never invents hashes.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CALCULATOR_TRUE_NAME,
  PROVEN_TEST_LABEL,
  PROVEN_TEST_MAGIC,
  REF_LIB_LABEL,
  REF_LIB_MAGIC,
  TRANSLATOR_CODEX,
  TRANSLATOR_CODEX_LABEL,
  buildRefMemoryFeedBody,
  evalSelfCalculator,
  formatProvenTestCard,
  formatRefMemoryCard,
  labelIntent,
  listRefLibrary,
  resolveTrueName,
  runProvenTests,
  searchRefMemory,
} from "./ref-memory.js";
import { MAINFRAME_ANCHORS } from "./mainframe.js";
import { handleVitaFeedAction, parseVitaFeedCommand, resetVitaFeedPending } from "./vita-feed.js";

describe("vita ref-memory calculator proven series", () => {
  it("translator codex maps multilingual aliases to true name calculator", () => {
    assert.equal(resolveTrueName("calc").trueName, CALCULATOR_TRUE_NAME);
    assert.equal(resolveTrueName("calculadora").trueName, CALCULATOR_TRUE_NAME);
    assert.equal(resolveTrueName("電卓").trueName, CALCULATOR_TRUE_NAME);
    assert.equal(resolveTrueName("计算器").trueName, CALCULATOR_TRUE_NAME);
    assert.equal(resolveTrueName("калькулятор").trueName, CALCULATOR_TRUE_NAME);
    assert.equal(resolveTrueName("حاسبة").trueName, CALCULATOR_TRUE_NAME);
    assert.ok(TRANSLATOR_CODEX.free && TRANSLATOR_CODEX.available);
    assert.equal(TRANSLATOR_CODEX.filingLabel, TRANSLATOR_CODEX_LABEL);
  });

  it("ask vs self intent labels", () => {
    assert.equal(labelIntent("who made a calculator"), "ask");
    assert.equal(labelIntent("calculator"), "ask");
    assert.equal(labelIntent("I built a calculator for payroll"), "self");
    assert.equal(labelIntent("my own calc for desk job"), "self");
  });

  it("search always cites real Base anchors — never invents", () => {
    const r = searchRefMemory("calculator");
    assert.equal(r.ok, true);
    assert.equal(r.invent, false);
    assert.equal(r.proven, true);
    assert.equal(r.trueName, CALCULATOR_TRUE_NAME);
    assert.equal(r.intent, "ask");
    assert.ok(r.hits.length >= 1);
    assert.ok(r.citations.length >= 1);
    for (const c of r.citations) {
      assert.match(c.location, /^0x[0-9a-f]{64}$/);
      assert.ok(
        MAINFRAME_ANCHORS.known.some((a) => a.tx.toLowerCase() === c.location),
        "citation must be hardcoded anchor for seed catalogue",
      );
    }
    assert.match(formatRefMemoryCard(r), new RegExp(REF_LIB_MAGIC));
    assert.match(formatRefMemoryCard(r), /proven=YES/);
  });

  it("self job query returns self-labeled catalogue + can eval", () => {
    const r = searchRefMemory("I built a calculator for inject job 7+5");
    assert.equal(r.intent, "self");
    assert.equal(r.proven, true);
    assert.ok(r.hits.some((h) => h.label === "self"));
    assert.equal(r.answer.calculator.value, 12);
  });

  it("built-in self calculator is deterministic", () => {
    assert.equal(evalSelfCalculator("2+2").value, 4);
    assert.equal(evalSelfCalculator("10*(3+1)").value, 40);
    assert.equal(evalSelfCalculator("nope").ok, false);
  });

  it("unknown true-name refuses invent — no fake answer", () => {
    const r = searchRefMemory("unicorn quantum blender");
    assert.equal(r.ok, false);
    assert.equal(r.proven, false);
    assert.equal(r.invent, false);
    assert.equal(r.trueName, null);
    assert.match(formatRefMemoryCard(r), /refuse invent/i);
  });

  it("full proven test series PASS", () => {
    const report = runProvenTests();
    assert.equal(report.filingLabel, PROVEN_TEST_LABEL);
    assert.ok(report.magic.startsWith(PROVEN_TEST_MAGIC));
    assert.equal(report.ok, true, JSON.stringify(report.results.filter((x) => !x.pass), null, 2));
    assert.equal(report.passed, report.total);
    assert.equal(report.neverInventHashes, true);
    assert.match(formatProvenTestCard(report), /PASS PT-CALC/);
    assert.match(buildRefMemoryFeedBody(), new RegExp(REF_LIB_LABEL));
  });

  it("library lists ask + self + translator entries", () => {
    const lib = listRefLibrary();
    assert.ok(lib.some((e) => e.label === "ask"));
    assert.ok(lib.some((e) => e.label === "self"));
    assert.ok(lib.some((e) => e.filingLabel === TRANSLATOR_CODEX_LABEL || e.kind === "translator-codex"));
  });

  it("/vitafeed ref|ask|proven wire", async () => {
    resetVitaFeedPending();
    assert.equal(parseVitaFeedCommand("/vitafeed ref calculator").action, "ref");
    assert.equal(parseVitaFeedCommand("/vitafeed ask calculadora").action, "ref");
    assert.equal(parseVitaFeedCommand("/vitafeed proven").action, "proven");
    assert.equal(parseVitaFeedCommand("/vitafeed tests").action, "proven");

    const ask = await handleVitaFeedAction({
      action: "ref",
      body: "calculadora",
      chatId: "ref-wire",
    });
    assert.equal(ask.ok, true);
    assert.match(ask.reply, /trueName=calculator|proven=YES/i);

    const proven = await handleVitaFeedAction({ action: "proven", chatId: "ref-wire" });
    assert.equal(proven.ok, true);
    assert.match(proven.reply, /PROVEN TESTS|pass=/i);
  });
});
