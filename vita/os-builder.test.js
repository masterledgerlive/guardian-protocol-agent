/**
 * VITA OS Builder tests — DOS brain construction, IFTTT, follow-leader, sandbox.
 * Never invents hashes. Mother brain untouched.
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { MAINFRAME_ANCHORS, FORMULA_ID } from "./mainframe.js";
import { HOME_SECTIONS, parseHomeCommand, handleHomeAction } from "./telegram-home.js";
import { VITADIR_SUBDIRS, listSubDirectory } from "./vita-dir.js";
import { CALLBACK_DATA_MAX } from "./mirror-chain.js";
import {
  OS_BUILDER_ID,
  OS_BUILDER_LABEL,
  OS_BUILDER_MAGIC,
  OS_BUILDER_SUBDIR,
  OS_STEPS,
  OS_LOBES,
  OS_TRIGGER_RECIPES,
  assertOsCallbacksFit,
  buildOsBuilderKeyboard,
  buildOsSealBody,
  commitFollowStep,
  evaluateTrigger,
  factsFromAnchor,
  handleOsBuilderAction,
  parseOsBuilderCommand,
  publicOsBuilderState,
  refineLexiconPair,
  renameOsAgent,
  runOsSandbox,
  runOsUseCaseDemo,
  setOsBuilderPathForTests,
  setOsLobes,
  setOsTriggers,
  startOsSession,
  stageOsSeal,
  verifyFollowChain,
  osBuilderDirEntries,
} from "./os-builder.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

describe("os-builder constants + callbacks", () => {
  it("exports identity + DOS steps", () => {
    assert.equal(OS_BUILDER_ID, "vita-os-builder-v1");
    assert.equal(OS_BUILDER_LABEL, "OS_BUILDER");
    assert.match(OS_BUILDER_MAGIC, /^§VITAOS§/);
    assert.equal(OS_BUILDER_SUBDIR, "OS");
    assert.equal(OS_STEPS.length, 8);
    assert.ok(OS_LOBES.length >= 6);
    assert.ok(OS_TRIGGER_RECIPES.some((r) => r.id === "eureka-learn"));
  });

  it("Telegram callbacks fit 64B", () => {
    const fit = assertOsCallbacksFit();
    assert.equal(fit.ok, true, JSON.stringify(fit.bad));
    const kb = buildOsBuilderKeyboard();
    for (const b of kb.inline_keyboard.flat()) {
      if (b.callback_data) assert.ok(b.callback_data.length <= CALLBACK_DATA_MAX);
    }
  });
});

describe("os-builder parse + IFTTT", () => {
  it("parses /os aliases", () => {
    assert.equal(parseOsBuilderCommand("/os").action, "home");
    assert.equal(parseOsBuilderCommand("/brainos sandbox").action, "sandbox");
    assert.equal(parseOsBuilderCommand("/build name foo").action, "name");
    assert.equal(parseOsBuilderCommand("/os watcher-x").action, "name");
    assert.equal(parseOsBuilderCommand("/os watcher-x").body, "watcher-x");
  });

  it("evaluates triggers against real anchor kinds", () => {
    const eureka = factsFromAnchor("eureka-prove");
    assert.equal(eureka.ok, true);
    assert.equal(eureka.location, MAINFRAME_ANCHORS.eurekaProveTx);
    const fire = evaluateTrigger("eureka-learn", eureka);
    assert.equal(fire.fired, true);
    assert.equal(fire.then.action, "append_learn");

    const plain = factsFromAnchor("keycat-plain");
    const noFire = evaluateTrigger("eureka-learn", plain);
    assert.equal(noFire.fired, false);

    const hitch = evaluateTrigger("keyloc-hitch", { keyLocCovered: true });
    assert.equal(hitch.fired, true);
  });

  it("refuses unknown / invented anchors", () => {
    const bad = factsFromAnchor("not-a-real-anchor");
    assert.equal(bad.ok, false);
  });
});

describe("os-builder wizard + sandbox use case", () => {
  let tmp;

  before(() => {
    tmp = mkdtempSync(join(tmpdir(), "vita-os-"));
    setOsBuilderPathForTests(join(tmp, "os-builder-state.json"));
  });

  it("runs full watcher-eureka demo against Base class proofs", () => {
    const demo = runOsUseCaseDemo();
    assert.equal(demo.ok, true);
    assert.equal(demo.agentId, "watcher-eureka");
    assert.equal(demo.follow.valid, true);
    assert.ok(demo.follow.head >= 3);
    assert.equal(demo.sandbox.ok, true);
    assert.ok(demo.sandbox.run.passed >= 4);
    assert.equal(demo.sandbox.run.failed, 0);
    // Every proveAgainst result cites a real hardcoded hash
    for (const r of demo.sandbox.run.results) {
      if (r.location) {
        assert.match(r.location, /^0x[0-9a-fA-F]{64}$/);
        const known = MAINFRAME_ANCHORS.known.some((a) => a.tx.toLowerCase() === r.location.toLowerCase());
        assert.equal(known, true, "sandbox must only cite hardcoded anchors");
      }
    }
    assert.equal(demo.seal.ok, true);
    assert.ok(demo.seal.body.includes(OS_BUILDER_MAGIC));
    assert.ok(demo.seal.body.includes(FORMULA_ID));
    assert.equal(demo.seal.proven, false);
    assert.deepEqual(demo.seal.locations, []);
    assert.match(demo.seal.contentCommit, /^[0-9a-f]{64}$/);
  });

  it("follow-the-leader refuses gaps via verify", () => {
    startOsSession({ agentId: "seq-brain" });
    commitFollowStep({ agentId: "seq-brain", label: "a" });
    commitFollowStep({ agentId: "seq-brain", label: "b" });
    const v = verifyFollowChain("seq-brain");
    assert.equal(v.valid, true);
    assert.equal(v.head, 2);
  });

  it("handleOsBuilderAction returns click-through keyboard", () => {
    const out = handleOsBuilderAction({ action: "boot" });
    assert.equal(out.ok, true);
    assert.ok(out.reply.includes("BOOT") || out.reply.includes("CLASS PROOF"));
    assert.ok(out.keyboard?.inline_keyboard?.length >= 3);
    assert.equal(out.callbackFit.ok, true);
  });

  it("lexicon refine + seal stage", () => {
    renameOsAgent("lex-brain", "lex-brain");
    setOsLobes(["formula", "lexicon"], "lex-brain");
    setOsTriggers(["eureka-learn", "plain-refuse-claim"], "lex-brain");
    commitFollowStep({ agentId: "lex-brain", label: "lex" });
    refineLexiconPair({
      human: "build together",
      machine: "osBuilder=co-construct",
    });
    const sand = runOsSandbox({ agentId: "lex-brain" });
    assert.equal(sand.ok, true);
    const sealed = stageOsSeal("lex-brain");
    assert.ok(sealed.body.includes("build together") || sealed.body.includes("osBuilder=co-construct") || sealed.bytes > 100);
    const body2 = buildOsSealBody("lex-brain");
    assert.equal(body2.contentCommit, sealed.contentCommit);
  });

  it("public state + dir entries", () => {
    const pub = publicOsBuilderState();
    assert.equal(pub.id, OS_BUILDER_ID);
    assert.ok(pub.anchors.length >= 3);
    assert.equal(pub.neverInventHashes, true);
    const dir = osBuilderDirEntries();
    assert.equal(dir.subdir, "OS");
    assert.ok(dir.entries.some((e) => e.name === "README.txt"));
  });
});

describe("os-builder HOME + VITADIR wiring", () => {
  it("HOME exposes OS section", () => {
    const sec = HOME_SECTIONS.find((s) => s.id === "os");
    assert.ok(sec, "HOME_SECTIONS must include os");
    assert.ok(sec.buttons.some((b) => b.cmd === "/os"));
    assert.ok(sec.buttons.some((b) => /sandbox/i.test(b.cmd)));
    const parsed = parseHomeCommand("/home os");
    assert.equal(parsed.ok, true);
    const out = handleHomeAction({ action: "section", section: "os" });
    assert.equal(out.ok, true);
  });

  it("VITA:\\OS\\ is a master subdir", () => {
    assert.ok(VITADIR_SUBDIRS.some((d) => d.name === "OS"));
    const listed = listSubDirectory("OS");
    assert.equal(listed.ok, true);
    assert.ok((listed.entries || []).length >= 1);
  });

  it("CRT HTML + Solidity registry exist", () => {
    assert.equal(existsSync(join(ROOT, "public/vita-os-builder.html")), true);
    assert.equal(existsSync(join(ROOT, "vita/os-builder/AgentTriggerRegistry.sol")), true);
    const html = readFileSync(join(ROOT, "public/vita-os-builder.html"), "utf8");
    assert.match(html, /VITA OS/);
    assert.match(html, /FULL DEMO/);
    const sol = readFileSync(join(ROOT, "vita/os-builder/AgentTriggerRegistry.sol"), "utf8");
    assert.match(sol, /AgentTriggerRegistry/);
    assert.match(sol, /follow-the-leader|NotLeader/i);
  });

  it("FILING + AGENTS mention OS builder", () => {
    const filing = readFileSync(join(HERE, "FILING.md"), "utf8");
    const agents = readFileSync(join(HERE, "AGENTS.md"), "utf8");
    assert.match(filing, /OS_BUILDER|os-builder/);
    assert.match(agents, /\/os|OS builder|brain builder/i);
  });
});
