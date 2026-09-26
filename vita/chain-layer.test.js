/**
 * VITA chain-layer — systems check, SNARK lib, EVM recover, model ring, LLM spin.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CHAIN_LAYER_ID,
  CHAIN_LAYER_MAGIC,
  PROVEN_LIBRARY_ROOTS,
  SYSTEMS_CHECKLIST,
  agreeModelRing,
  buildSystemsCheckKeyboard,
  formatSystemsCheckCard,
  handleChainLayerAction,
  measureEvmRecover,
  parseChainLayerCommand,
  registerLlmOnchainSpin,
  runSystemsCheck,
  snarkCompressProvenLibrary,
} from "./chain-layer.js";
import {
  handleVitaMirrorAction,
  parseVitaMirrorCommand,
  MIRROR_PLUGINS,
  MIRROR_CATALOG,
} from "./mirror-chain.js";
import { MAINFRAME_ANCHORS } from "./mainframe.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const memoryDir = join(root, "vita", "memory");
const strandsDir = join(root, "vita", "strands");

describe("vita chain-layer systems check", () => {
  it("exposes checklist + proven library roots", () => {
    assert.equal(SYSTEMS_CHECKLIST.length >= 7, true);
    assert.ok(SYSTEMS_CHECKLIST.some((c) => c.id === "evm-recover"));
    assert.ok(PROVEN_LIBRARY_ROOTS.includes("vita/mainframe.js"));
    assert.ok(PROVEN_LIBRARY_ROOTS.includes("vita/chain-layer.js"));
  });

  it("parses /vita check|recover|models|llm|spin", () => {
    assert.equal(parseChainLayerCommand("/vita check").action, "check");
    assert.equal(parseChainLayerCommand("/vitacheck").action, "check");
    assert.equal(parseChainLayerCommand("/vita recover").action, "recover");
    assert.equal(parseChainLayerCommand("/vita models").action, "models");
    assert.equal(parseChainLayerCommand("/vita models next").kind, "next");
    assert.equal(parseChainLayerCommand("/vita llm").action, "llm");
    assert.equal(parseChainLayerCommand("/vita spin").action, "llm");
    assert.equal(parseChainLayerCommand("/vita read x"), null);
    assert.equal(parseChainLayerCommand("/vita who?"), null);
  });

  it("mirror parse routes check actions without eating questions", () => {
    assert.equal(parseVitaMirrorCommand("/vita check").action, "check");
    assert.equal(parseVitaMirrorCommand("/vita recover").action, "recover");
    assert.equal(parseVitaMirrorCommand("/vita models next").action, "models");
    assert.equal(parseVitaMirrorCommand("/vita models next").kind, "next");
    assert.equal(parseVitaMirrorCommand("/vita llm").action, "llm");
    assert.equal(parseVitaMirrorCommand("/vita who is KEY?").action, "ask");
    assert.ok(MIRROR_PLUGINS.some((p) => p.id === "systems-check"));
    assert.ok(MIRROR_CATALOG.some((e) => e.name === "vita/chain-layer.js"));
  });

  it("SNARK-compresses proven library without inventing hashes", () => {
    const snark = snarkCompressProvenLibrary({ cwd: root });
    assert.ok(snark.short);
    assert.ok(snark.root);
    assert.ok(snark.fileCount >= 5);
    assert.equal(snark.neverInventHashes, true);
    assert.equal(snark.snarkReady, true);
    assert.match(snark.short, /ZK§/);
  });

  it("measures EVM recover timing with instant unwrap", () => {
    const recover = measureEvmRecover({ cwd: root });
    assert.equal(recover.ok, true);
    assert.equal(recover.unwrapInstant, true);
    assert.equal(recover.privateKeyRequired, false);
    assert.ok(Number(recover.localRecoverMs) >= 0);
    assert.equal(recover.chainId, MAINFRAME_ANCHORS.chainId);
    assert.equal(recover.localOnly, true);
    assert.equal(recover.locations.length, 0);
    assert.ok(recover.formulaAnchors.length >= 3);
  });

  it("agrees model ring and registers LLM spin manifest", () => {
    const models = agreeModelRing({
      env: { VITA_MODELS: "claude-sonnet-4-20250514,claude-opus-4-20250514" },
      write: true,
    });
    assert.ok(models.agreed);
    assert.ok(models.cycle.length >= 2);
    assert.ok(existsSync(join(memoryDir, "model-agreement.json")));

    const llm = registerLlmOnchainSpin({
      env: { VITA_MODELS: "claude-sonnet-4-20250514,claude-opus-4-20250514" },
      write: true,
      modelId: models.agreed,
    });
    assert.match(llm.magic, /VITALLM/);
    assert.equal(llm.neverInventHashes, true);
    assert.ok(llm.contentCommit);
    assert.equal(llm.formulaAnchorsOnly, true);
    assert.ok(existsSync(join(memoryDir, "llm-onchain-spin.json")));
  });

  it("runSystemsCheck creates visible memory + strand files", async () => {
    const beforeMem = readdirSync(memoryDir).filter((f) => f.endsWith(".json")).length;
    const result = await runSystemsCheck({
      cwd: root,
      env: { VITA_MODELS: "claude-sonnet-4-20250514,claude-opus-4-20250514" },
      write: true,
      now: Date.now(),
      pull: false,
    });
    assert.equal(result.id, CHAIN_LAYER_ID);
    assert.equal(result.ok, true);
    assert.equal(result.passed, result.total);
    assert.match(result.magic, /VITACHAIN/);
    assert.ok(result.inject.totalChunks > 10);
    assert.equal(result.snark.localOnly, true);
    assert.ok(existsSync(join(memoryDir, "chain-layer-checks.json")));
    assert.ok(existsSync(join(memoryDir, "chain-layer-growth.json")));
    assert.ok(existsSync(join(memoryDir, "chain-layer-inject.json")));
    assert.ok(existsSync(join(strandsDir, "chain-layer.json")));
    const afterMem = readdirSync(memoryDir).filter((f) => f.endsWith(".json")).length;
    assert.ok(afterMem > beforeMem, "library must grow with new check files");
    const card = formatSystemsCheckCard(result);
    assert.match(card, /SYSCHECK|SYSTEMS CHECK/);
    assert.match(card, /SPACED INJECT/);
    assert.match(card, /FORMULA ANCHORS/);
    assert.match(card, /LOCAL_ONLY|none sealed/);
  });

  it("Telegram handleChainLayerAction + mirror click-through", async () => {
    const out = await handleChainLayerAction({
      action: "check",
      cwd: root,
      write: true,
      env: { VITA_MODELS: "claude-sonnet-4-20250514" },
    });
    assert.equal(out.ok, true);
    assert.match(out.reply, /SYSTEMS CHECK|SYSCHECK/);
    assert.ok(out.keyboard?.inline_keyboard?.length >= 1);
    assert.ok(
      out.keyboard.inline_keyboard.flat().some(
        (b) => b.callback_data === "/vita check locs" || b.callback_data === "/vita check pull",
      ),
    );

    const viaMirror = await handleVitaMirrorAction({
      action: "recover",
      cwd: root,
      write: true,
      chatId: "tg-check-1",
    });
    assert.equal(viaMirror.ok, true);
    assert.match(viaMirror.reply, /EVM RECOVER|recover/i);

    const kb = buildSystemsCheckKeyboard({
      plan: null,
      includeFormulaAnchors: false,
    });
    assert.ok(kb.inline_keyboard.flat().some((b) => b.callback_data === "/vita check"));
  });

  it("never invents Base tx hashes in check output", async () => {
    const result = await runSystemsCheck({
      cwd: root,
      write: false,
      pull: false,
      env: { VITA_MODELS: "claude-sonnet-4-20250514" },
    });
    // Sealed inject locs only — empty until real seals (not formula anchors)
    assert.equal(result.locations.length, 0);
    for (const loc of result.formulaAnchors) {
      assert.ok(
        MAINFRAME_ANCHORS.known.some((a) => a.tx.toLowerCase() === loc.location.toLowerCase()),
      );
    }
    assert.equal(result.neverInventHashes, true);
  });
});
