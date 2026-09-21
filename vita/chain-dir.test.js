/**
 * CHAINDIR — completion-order directory, dual loc proofs, no invented hashes.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { MAINFRAME_ANCHORS } from "./mainframe.js";
import {
  BASESCAN_TX,
  CHAINDIR_LABEL,
  CHAINDIR_MAGIC,
  STATUS_COMPLETE,
  STATUS_ROUTING,
  STATUS_WAITING,
  formatChainDirCard,
  formatChainDirSearchCard,
  guessTransmissionName,
  isTxHash,
  loadChainDir,
  provenKidsOnChain,
  publicChainDirState,
  recordDualSealIntoChainDir,
  recordLaneSeal,
  resetChainDirForTests,
  routeTransmission,
  searchByLocation,
  setChainDirPathForTests,
  triggerCycle,
} from "./chain-dir.js";
import { handleVitaFeedAction, parseVitaFeedCommand, resetVitaFeedPending } from "./vita-feed.js";
import { listMasterDirectory, listSubDirectory } from "./vita-dir.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ANCHOR_H = MAINFRAME_ANCHORS.known[0].tx;
const ANCHOR_M = MAINFRAME_ANCHORS.known[1].tx;

describe("chain-dir routing + two ends", () => {
  it("routes without inventing locations", () => {
    const dir = mkdtempSync(join(tmpdir(), "chaindir-"));
    setChainDirPathForTests(join(dir, "ledger.json"));
    resetChainDirForTests();
    const routed = routeTransmission({
      name: "kids-url-dir",
      humanBody: "§VITAURLDIR§ kids urls",
      machineBody: "URLDIR lane=MACHINE",
    });
    assert.equal(routed.ok, true);
    assert.equal(routed.line.status, STATUS_ROUTING);
    assert.equal(routed.line.human.locations.length, 0);
    assert.equal(routed.line.machine.locations.length, 0);
    assert.equal(guessTransmissionName("§VITAURLDIR§v1"), "kids-url-dir");
    const miss = recordLaneSeal({ n: routed.line.n, lane: "HUMAN", locations: ["not-a-hash"] });
    assert.equal(miss.ok, false);
    setChainDirPathForTests(null);
  });

  it("HUMAN seal waits for MACHINE loc proof", () => {
    const dir = mkdtempSync(join(tmpdir(), "chaindir-"));
    setChainDirPathForTests(join(dir, "ledger.json"));
    resetChainDirForTests();
    routeTransmission({ humanBody: "plain knowledge", machineBody: "§VITADUAL§ machine" });
    const human = recordLaneSeal({
      name: guessTransmissionName("plain knowledge"),
      lane: "HUMAN",
      locations: [ANCHOR_H],
    });
    assert.equal(human.ok, true);
    assert.equal(human.line.status, STATUS_WAITING);
    assert.equal(human.selfCheck.humanLocProof, true);
    assert.equal(human.selfCheck.machineLocProof, false);
    assert.equal(human.selfCheck.twoEndsTalking, true);
    assert.match(human.line.proofs[0].basescan, /^https:\/\/basescan\.org\/tx\/0x/);
    setChainDirPathForTests(null);
  });

  it("both lanes complete at an absolute moment with clickable Input Data", () => {
    const dir = mkdtempSync(join(tmpdir(), "chaindir-"));
    setChainDirPathForTests(join(dir, "ledger.json"));
    resetChainDirForTests();
    const dual = recordDualSealIntoChainDir({
      name: "kids-url-dir",
      humanBody: "§VITAURLDIR§ kids urls",
      machineBody: "URLDIR lane=MACHINE",
      humanLocs: [ANCHOR_H],
      machineLocs: [ANCHOR_M],
    });
    assert.equal(dual.ok, true);
    assert.equal(dual.line.status, STATUS_COMPLETE);
    assert.ok(dual.line.completedAt);
    assert.equal(dual.selfCheck.ok, true);
    assert.equal(dual.cycle.triggered, true);
    const card = formatChainDirCard();
    assert.ok(card.includes(CHAINDIR_MAGIC));
    assert.match(card, /TOP ACTIVE/);
    assert.match(card, /BOTTOM COMPLETE/);
    assert.ok(card.includes(BASESCAN_TX + ANCHOR_H));
    assert.ok(card.includes(BASESCAN_TX + ANCHOR_M));
    const found = searchByLocation(ANCHOR_H);
    assert.equal(found.ok, true);
    assert.match(formatChainDirSearchCard(found), /kids-url-dir/);
    assert.equal(provenKidsOnChain().proven, true);
    const again = triggerCycle(dual.line);
    assert.equal(again.already, true);
    setChainDirPathForTests(null);
  });

  it("HUMAN partial holds MACHINE (two ends still talking)", () => {
    const dir = mkdtempSync(join(tmpdir(), "chaindir-"));
    setChainDirPathForTests(join(dir, "ledger.json"));
    resetChainDirForTests();
    const dual = recordDualSealIntoChainDir({
      humanBody: "partial human",
      machineBody: "machine waiting",
      humanLocs: [ANCHOR_H],
      machineLocs: [ANCHOR_M],
      humanPartial: true,
    });
    assert.equal(dual.waitingForMachine, true);
    assert.notEqual(dual.line.status, STATUS_COMPLETE);
    assert.equal(dual.line.machine.locations.length, 0);
    setChainDirPathForTests(null);
  });

  it("search refuses invented hashes", () => {
    assert.equal(isTxHash("0xdead"), false);
    const bad = searchByLocation("0xdead");
    assert.equal(bad.ok, false);
  });
});

describe("chain-dir DOS + Telegram wire", () => {
  it("master directory includes CHAIN", () => {
    const master = listMasterDirectory();
    assert.ok(master.subdirs.some((d) => d.name === "CHAIN"));
    const listed = listSubDirectory("CHAIN");
    assert.equal(listed.ok, true);
    assert.ok(listed.entries.some((e) => e.name === "chain-dir-ledger.json"));
  });

  it("/vitafeed chaindir|cycle|loc parse", async () => {
    resetVitaFeedPending();
    assert.equal(parseVitaFeedCommand("/vitafeed chaindir").action, "chaindir");
    assert.equal(parseVitaFeedCommand("/vitafeed cycle").action, "cycle");
    assert.equal(parseVitaFeedCommand("/vitafeed loc " + ANCHOR_H).action, "loc");
    const card = await handleVitaFeedAction({ action: "chaindir", chatId: "chain-wire" });
    assert.equal(card.ok, true);
    assert.match(card.reply, /CHAIN DIRECTORY|§VITACHAINDIR§/);
    assert.ok(card.keyboard?.inline_keyboard?.length >= 1);
  });

  it("dual kids stages a routing line (availability until seal)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "chaindir-"));
    setChainDirPathForTests(join(dir, "ledger.json"));
    resetChainDirForTests();
    resetVitaFeedPending();
    const dual = await handleVitaFeedAction({
      action: "dual",
      body: "kids",
      chatId: "chain-dual",
    });
    assert.equal(dual.ok, true);
    assert.equal(dual.dual, true);
    const ledger = loadChainDir();
    assert.ok(ledger.lines.some((l) => l.name === "kids-url-dir" && l.status === STATUS_ROUTING));
    assert.equal(provenKidsOnChain().proven, false);
    assert.equal(provenKidsOnChain().availability, true);
    assert.match(publicChainDirState().kids.note, /Input Data|availability/i);
    resetVitaFeedPending();
    setChainDirPathForTests(null);
  });
});

describe("chain-dir surfaces", () => {
  it("HTML + webhook routes exist", () => {
    const html = readFileSync(join(root, "public", "vita-chain-dir.html"), "utf8");
    assert.match(html, /chain-dir/);
    assert.match(html, /Input Data/);
    assert.match(html, /TOP ACTIVE|top-active|active/);
    const hook = readFileSync(join(root, "vita-webhook.js"), "utf8");
    assert.match(hook, /\/vita\/chain-dir/);
    const kids = readFileSync(join(root, "public", "vita-kids-player.html"), "utf8");
    assert.match(kids, /chain-dir|proven|Input Data/);
    assert.equal(CHAINDIR_LABEL, "CHAINDIR");
  });
});
