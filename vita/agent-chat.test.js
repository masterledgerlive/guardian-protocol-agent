/**
 * Agent-owned chat channel v0 — storage-token first. Never invent hashes.
 * Mother brain untouched. VITAFEED_PAID stays gated.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MAINFRAME_ANCHORS } from "./mainframe.js";
import { HOME_SECTIONS, parseHomeCommand, handleHomeAction } from "./telegram-home.js";
import { CALLBACK_DATA_MAX } from "./mirror-chain.js";
import {
  AGENT_CHAT_ID,
  AGENT_CHAT_LABEL,
  AGENT_CHAT_MAGIC,
  AGENT_CHAT_WALLET_ENV,
  AGENT_CHAT_X402_ENV,
  STORAGE_TOKEN_AGENT_ID,
  agentChatChainBackupConfig,
  assertAgentCallbacksFit,
  buildAgentChannelKeyboard,
  connectPeerRead,
  createAgentChannel,
  decodeHexKeyLoc,
  getAgentChannel,
  handleAgentChatAction,
  listAgentChannels,
  listBankedMessages,
  listProvenLocsForAgent,
  packHexKeyLocDual,
  parseAgentChatCommand,
  peerCanRead,
  publicOpenKey,
  stageAgentChatMessage,
} from "./agent-chat.js";
import { wrapQueueSelfCall } from "./feed-wrap.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

describe("agent-chat factory + public key", () => {
  it("seeds storage-token and factories other agent ids", () => {
    assert.equal(AGENT_CHAT_ID, "vita-agent-chat-v0");
    assert.equal(AGENT_CHAT_LABEL, "AGENT_CHAT");
    const a = createAgentChannel(STORAGE_TOKEN_AGENT_ID);
    assert.equal(a.ok, true);
    assert.equal(a.channel.agentId, "storage-token");
    assert.equal(a.channel.channelId, "agent-chat:storage-token");
    assert.equal(a.channel.alwaysOn, true);
    const b = createAgentChannel("mirror-reader");
    assert.equal(b.channel.agentId, "mirror-reader");
    const ids = listAgentChannels().map((c) => c.agentId);
    assert.ok(ids.includes("storage-token"));
    assert.ok(ids.includes("mirror-reader"));
    assert.equal(getAgentChannel("storage-token").channelId, "agent-chat:storage-token");
  });

  it("public open key is not a wallet secret", () => {
    const k = publicOpenKey("storage-token");
    assert.equal(k.privateKey, false);
    assert.equal(k.openSource, true);
    assert.match(k.key, /^VITAOPEN\.AGENT\.storage-token\./);
    assert.match(k.hex, /^[0-9a-f]{64}$/);
  });
});

describe("hex-only KEY+LOC dual", () => {
  it("packs HUMAN plain + MACHINE §KEY§…§LOC§ as hex", () => {
    const packed = packHexKeyLocDual({
      agentId: "storage-token",
      text: "hello dedicated path",
    });
    assert.equal(packed.ok, true);
    assert.equal(packed.hexOnly, true);
    assert.equal(packed.laneHuman, "hello dedicated path");
    assert.match(packed.laneMachine, /^§KEY§[0-9a-f]+§LOC§/);
    assert.match(packed.hex, /^0x[0-9a-f]+$/i);
    const decoded = decodeHexKeyLoc(packed.hex);
    assert.equal(decoded.ok, true);
    assert.equal(decoded.publicKeyHex, packed.publicKey.hex);
    assert.match(decoded.locToken, /agent=storage-token/);
    assert.equal(packed.sealedLoc, null);
  });

  it("refuses to embed invented loc hashes; allows hardcoded anchors", () => {
    const fake = packHexKeyLocDual({
      agentId: "storage-token",
      text: "no fake loc",
      sealedLoc: "0x" + "b".repeat(64),
    });
    assert.equal(fake.ok, true);
    assert.equal(fake.sealedLoc, null);
    assert.doesNotMatch(fake.locToken, /\|r=bbbbbbbb/);

    const real = packHexKeyLocDual({
      agentId: "storage-token",
      text: "class proof loc",
      sealedLoc: MAINFRAME_ANCHORS.vitaStrandTx,
    });
    assert.equal(real.sealedLoc, MAINFRAME_ANCHORS.vitaStrandTx.toLowerCase());
    assert.match(real.locToken, /\|r=/);
  });
});

describe("offline bank + hitch wrap", () => {
  it("banks hex when gas thin / unpaired — never sends, never invents txHash", () => {
    const staged = stageAgentChatMessage({
      agentId: "storage-token",
      text: "bank me when thin",
      leftoverEth: 0,
      hitchCostEth: 0.001,
    });
    assert.equal(staged.ok, true);
    assert.equal(staged.send, false);
    assert.equal(staged.banked, true);
    assert.equal(staged.hitch, false);
    assert.equal(staged.txHash, null);
    assert.equal(staged.vitafeedPaid, false);
    assert.match(staged.hex, /^0x[0-9a-f]+$/i);
    const banked = listBankedMessages("storage-token");
    assert.ok(banked.some((e) => e.contentCommit === staged.contentCommit));
    assert.ok(banked.every((e) => e.txHash == null));
  });

  it("hitches (does not broadcast) when leftover covers KEY+LOC on a paired ride", () => {
    const staged = stageAgentChatMessage({
      agentId: "storage-token",
      text: "hitch when covered",
      leftoverEth: 0.01,
      hitchCostEth: 0.001,
      pairedUniswapSell: true,
      keyLocCovered: true,
    });
    assert.equal(staged.send, false);
    assert.equal(staged.hitch, true);
    assert.equal(staged.banked, false);
    assert.equal(staged.txHash, null);
    const wrap = wrapQueueSelfCall({
      text: staged.machine,
      leftoverEth: 0.01,
      hitchCostEth: 0.001,
      pairedUniswapSell: true,
      keyLocCovered: true,
    });
    assert.equal(wrap.send, false);
    assert.equal(wrap.hitch, true);
  });

  it("wallet/x402 stub never spends and does not flip VITAFEED_PAID", () => {
    const off = agentChatChainBackupConfig({});
    assert.equal(off.enabled, false);
    assert.equal(off.spendsRisk, false);
    assert.equal(off.vitafeedPaid, false);
    assert.equal(off.unpairedPaidSelfCall, false);
    const on = agentChatChainBackupConfig({
      [AGENT_CHAT_WALLET_ENV]: "0x50e1C4608c48b0c52E1EA5FBabc1c9126eA17915",
      [AGENT_CHAT_X402_ENV]: "https://example.invalid/x402",
    });
    assert.equal(on.configured, true);
    assert.equal(on.enabled, false);
    assert.equal(on.spendsRisk, false);
  });
});

describe("Telegram HOME Agents + proven locs", () => {
  it("HOME exposes Agents section with Chat · Dir · Dual · Proven locs · Path map", () => {
    const sec = HOME_SECTIONS.find((s) => s.id === "agents");
    assert.ok(sec);
    const labels = sec.buttons.map((b) => b.label);
    assert.deepEqual(labels, ["Chat", "Dir", "Dual", "Proven locs", "Path map"]);
    const cmds = sec.buttons.map((b) => b.cmd);
    assert.ok(cmds.includes("/agents chat"));
    assert.ok(cmds.includes("/agents dir"));
    assert.ok(cmds.includes("/agents dual"));
    assert.ok(cmds.includes("/agents proven"));
    assert.ok(cmds.includes("/agents path"));
    assert.equal(parseHomeCommand("/home agents").action, "section");
    assert.equal(parseHomeCommand("/home agents").section, "agents");
    const out = handleHomeAction({ action: "section", section: "agents" });
    const cbs = out.keyboard.inline_keyboard.flat().map((b) => b.callback_data);
    assert.ok(cbs.includes("/agents chat"));
    assert.ok(cbs.every((c) => c.length <= CALLBACK_DATA_MAX));
  });

  it("agent keyboards fit 64B and parse /agents actions", () => {
    const fit = assertAgentCallbacksFit();
    assert.equal(fit.ok, true, JSON.stringify(fit.bad));
    const kb = buildAgentChannelKeyboard();
    const cbs = kb.inline_keyboard.flat().map((b) => b.callback_data);
    assert.ok(cbs.includes("/agents chat"));
    assert.ok(cbs.includes("/home agents"));
    assert.equal(parseAgentChatCommand("/agents chat").action, "chat");
    assert.equal(parseAgentChatCommand("/agents dir").action, "dir");
    assert.equal(parseAgentChatCommand("/agents proven").action, "proven");
    assert.equal(parseAgentChatCommand("/agents path").action, "path");
    assert.equal(parseAgentChatCommand("/agentchat").action, "chat");
    const dual = handleAgentChatAction({ action: "dual", body: "dual seed" });
    assert.match(dual.reply, /HUMAN/);
    assert.match(dual.reply, /MACHINE/);
    const dir = handleAgentChatAction({ action: "dir", body: "storage-token" });
    assert.match(dir.reply, /§X404§|storage-token/);
    const path = handleAgentChatAction({ action: "path" });
    assert.match(path.reply, /PATH MAP/);
    const chat = handleAgentChatAction({ action: "chat" });
    assert.ok(chat.reply.includes(AGENT_CHAT_MAGIC));
    assert.match(chat.reply, /storage-token/);
  });

  it("proven locs are sealed-only; waiting plots land in directory", () => {
    const bundle = listProvenLocsForAgent("storage-token");
    assert.equal(bundle.idmSealedOnly, true);
    for (const loc of [...bundle.proven, ...bundle.classProof]) {
      assert.match(loc.location, /^0x[0-9a-fA-F]{64}$/);
      assert.ok(
        MAINFRAME_ANCHORS.known.some((a) => a.tx.toLowerCase() === loc.location),
      );
    }
    assert.ok(bundle.waitingMasterTag.length >= 1);
    const proven = handleAgentChatAction({ action: "proven" });
    assert.match(proven.reply, /PROVEN LOCS/);
    assert.doesNotMatch(proven.reply, /0x[0-9a-fA-F]{64}invent/i);
  });

  it("peers can READ the dedicated path", () => {
    const c = connectPeerRead("storage-token", "mirror-reader");
    assert.equal(c.ok, true);
    assert.equal(peerCanRead("storage-token", "mirror-reader"), true);
    assert.equal(peerCanRead("storage-token", "unknown-bot"), false);
    const peers = handleAgentChatAction({
      action: "peers",
      agentId: "storage-token",
      body: "wave-mirror",
    });
    assert.equal(peers.ok, true);
    assert.equal(peerCanRead("storage-token", "wave-mirror"), true);
  });
});

describe("agent-chat wiring + mother brain wrap-only", () => {
  it("agent.js wires /agents and does not enable VITAFEED_PAID", () => {
    const agent = readFileSync(join(ROOT, "agent.js"), "utf8");
    assert.match(agent, /from ["']\.\/vita\/agent-chat\.js["']/);
    assert.match(agent, /parseAgentChatCommand/);
    assert.match(agent, /handleAgentChatAction/);
    assert.match(agent, /\/agents/);
    const src = readFileSync(join(HERE, "agent-chat.js"), "utf8");
    assert.match(src, /VITAFEED_PAID stays gated/);
    assert.doesNotMatch(src, /VITAFEED_PAID\s*=\s*["']yes["']/);
    assert.match(src, /wrapQueueSelfCall/);
    assert.doesNotMatch(src, /mother-genesis\.js/);
    assert.doesNotMatch(src, /inscribeChunk|vitaSave\(/);
  });

  it("README + relearn map mention the channel", () => {
    const readme = readFileSync(join(ROOT, "vita/README.md"), "utf8");
    const map = readFileSync(join(HERE, "TELEGRAM_RELEARN.md"), "utf8");
    assert.match(readme, /Agents/);
    assert.match(readme, /\/agents chat/);
    assert.match(readme, /master-location tag/);
    assert.match(map, /HOME_SECTIONS|\/home` sections/);
    assert.match(map, /AGENT_CHAT|agent-chat/);
    assert.match(map, /X404_DIR|x404-dir/);
    assert.ok(existsSync(join(HERE, "x404-dir.json")));
  });

  it("mother-genesis module stays sealed (wrap only)", () => {
    const mg = readFileSync(join(HERE, "mother-genesis.js"), "utf8");
    assert.match(mg, /5-chunk mother brain/);
    assert.match(mg, /Does NOT replace vitaSave/);
    const src = readFileSync(join(HERE, "agent-chat.js"), "utf8");
    assert.doesNotMatch(src, /maySendMotherGenesis/);
  });
});
