/**
 * Agent-owned message chat channel v0.
 *
 * Each agent (starting with storage-token) gets a dedicated always-on path
 * for its own chat. Wraps existing indexing / filing / injection:
 *   - hex-only §KEY§…§LOC§ dual (HUMAN plain + MACHINE hex KEY+LOC)
 *   - public/open key so anyone can open proven locations
 *   - x404 directory tags (same name, many plots; answer-key routes)
 *   - Telegram HOME → Agents → Chat · Dir · Dual · Proven locs · Path map
 *   - Offline/bank when gas thin: stage banked hex; hitch when leftover covers
 *   - Optional AGENT_CHAT_WALLET / AGENT_CHAT_X402_ENDPOINT stub — never spends
 *
 * VITAFEED_PAID stays gated (MIN_LIQUID / no unpaired paid self-calls).
 * Mother brain sealed — wrap only (feed-wrap hitch|bank). Never invents hashes.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FORMULA_ID, KEY_LOC_HITCH_BYTES_CLASS, MAINFRAME_ANCHORS } from "./mainframe.js";
import { packMachineShort } from "./vita-dir.js";
import { wrapQueueSelfCall } from "./feed-wrap.js";
import {
  X404_MAGIC,
  formatX404Card,
  formatX404PathMapCard,
  isKnownSealedHash,
  isTxHash,
  listX404Tags,
  loadX404Schema,
  lookupX404Tag,
  provenX404Locs,
  searchX404,
  waitingMasterTagPlots,
} from "./x404-dir.js";
import { CALLBACK_DATA_MAX, telegramCallbackData } from "./mirror-chain.js";
import { withHomeButton } from "./telegram-home.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const MEMORY_DIR = join(HERE, "memory");
const STRANDS_DIR = join(HERE, "strands");
const CHANNELS_PATH = join(MEMORY_DIR, "agent-chat-channels.json");
const BANK_PATH = join(MEMORY_DIR, "agent-chat-bank.json");

export const AGENT_CHAT_ID = "vita-agent-chat-v0";
export const AGENT_CHAT_MAGIC = "§AGENTCHAT§";
export const AGENT_CHAT_LABEL = "AGENT_CHAT";
export const STORAGE_TOKEN_AGENT_ID = "storage-token";
export const AGENT_CHAT_WALLET_ENV = "AGENT_CHAT_WALLET";
export const AGENT_CHAT_X402_ENV = "AGENT_CHAT_X402_ENDPOINT";
export const KEY_LOC_DUAL_MAGIC = "§KEY§";
export const LOC_MAGIC = "§LOC§";

function sha256Hex(text) {
  return createHash("sha256").update(String(text || ""), "utf8").digest("hex");
}

function shortHex(hex, n = 8) {
  return String(hex || "").replace(/^0x/i, "").toLowerCase().slice(0, n);
}

function utf8Bytes(s) {
  return Buffer.byteLength(String(s || ""), "utf8");
}

function clip(s, n = 120) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length <= n ? t : t.slice(0, n - 1) + "…";
}

function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function ensureDirs() {
  if (!existsSync(MEMORY_DIR)) mkdirSync(MEMORY_DIR, { recursive: true });
  if (!existsSync(STRANDS_DIR)) mkdirSync(STRANDS_DIR, { recursive: true });
}

function sanitizeAgentId(id) {
  const s = String(id || STORAGE_TOKEN_AGENT_ID)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 48);
  return s || STORAGE_TOKEN_AGENT_ID;
}

function channelIdFor(agentId) {
  return "agent-chat:" + sanitizeAgentId(agentId);
}

/** Public/open key — not a wallet secret. Anyone can open proven locations. */
export function publicOpenKey(agentId) {
  const id = sanitizeAgentId(agentId);
  const commit = sha256Hex("vita-open-agent-key-v1|" + id);
  return {
    scheme: "vita-agent-open-key-v1",
    privateKey: false,
    openSource: true,
    agentId: id,
    key: "VITAOPEN.AGENT." + id + "." + commit.slice(0, 12),
    hex: commit,
    note: "Public/open. Anyone can open proven locations. Never a wallet secret.",
  };
}

/**
 * Hex-only dual KEY+LOC pack. HUMAN = plain UTF-8. MACHINE = §KEY§hex§LOC§token.
 * LOC token is a squash (agent|commit|n) plus optional short of a *known* sealed
 * hash — never an invented tx.
 */
export function packHexKeyLocDual({
  agentId = STORAGE_TOKEN_AGENT_ID,
  text = "",
  sealedLoc = null,
  extraSealed = [],
} = {}) {
  const id = sanitizeAgentId(agentId);
  const english = String(text || "");
  if (!english.trim()) {
    return { ok: false, reason: "empty chat body" };
  }
  const open = publicOpenKey(id);
  const commit = sha256Hex(id + "¦" + english);
  let locToken = "agent=" + id + "|t=" + commit.slice(0, 8) + "|n=" + utf8Bytes(english);
  let locHash = null;
  if (isTxHash(sealedLoc) && isKnownSealedHash(sealedLoc, extraSealed)) {
    locHash = String(sealedLoc).toLowerCase();
    locToken += "|r=" + shortHex(locHash, 8);
  }
  const machineUtf8 = KEY_LOC_DUAL_MAGIC + open.hex + LOC_MAGIC + locToken;
  const packed = packMachineShort({
    english,
    machine: machineUtf8,
    locs: locHash ? [locHash] : [],
    trueName: id,
  });
  const hex = "0x" + Buffer.from(machineUtf8, "utf8").toString("hex");
  return {
    ok: true,
    agentId: id,
    channelId: channelIdFor(id),
    laneHuman: english,
    laneMachine: machineUtf8,
    hex,
    hexOnly: true,
    publicKey: open,
    locToken,
    sealedLoc: locHash,
    contentCommit: packed.commit,
    packed,
    humanBytes: utf8Bytes(english),
    machineBytes: utf8Bytes(machineUtf8),
    hitchClassBytes: KEY_LOC_HITCH_BYTES_CLASS,
    searchable: true,
    neverInventHashes: true,
  };
}

export function decodeHexKeyLoc(hexOrUtf8) {
  let utf8 = String(hexOrUtf8 || "");
  if (/^0x[0-9a-fA-F]+$/i.test(utf8)) {
    try {
      utf8 = Buffer.from(utf8.slice(2), "hex").toString("utf8");
    } catch {
      return { ok: false, reason: "bad hex" };
    }
  }
  const m = utf8.match(/§KEY§([0-9a-fA-F]+)§LOC§([^\n\r]*)/);
  if (!m) return { ok: false, reason: "no §KEY§…§LOC§ dual" };
  return {
    ok: true,
    publicKeyHex: m[1].toLowerCase(),
    locToken: m[2],
    utf8,
    openSource: true,
  };
}

/**
 * Optional dedicated wallet / x402 path — documented stub only.
 * Never spends RISK. Never creates paid txs. Never flips VITAFEED_PAID.
 */
export function agentChatChainBackupConfig(env = process.env) {
  const wallet = String(env?.[AGENT_CHAT_WALLET_ENV] || "").trim() || null;
  const x402 = String(env?.[AGENT_CHAT_X402_ENV] || "").trim() || null;
  return {
    wallet,
    x402Endpoint: x402,
    configured: Boolean(wallet || x402),
    enabled: false,
    spendsRisk: false,
    paidSelfCall: false,
    vitafeedPaid: false,
    unpairedPaidSelfCall: false,
    note:
      "Stub only. AGENT_CHAT_WALLET / AGENT_CHAT_X402_ENDPOINT may be set for later " +
      "inject-route backup. This PR does not spend RISK, does not send txs, and " +
      "does not enable VITAFEED_PAID.",
  };
}

function loadJson(path, fallback) {
  try {
    if (existsSync(path)) return JSON.parse(readFileSync(path, "utf8"));
  } catch { /* fresh */ }
  return fallback;
}

function saveJson(path, doc) {
  ensureDirs();
  writeFileSync(path, JSON.stringify(doc, null, 2) + "\n");
}

function loadChannelsDoc() {
  return loadJson(CHANNELS_PATH, {
    id: "agent-chat-channels-v0",
    filingLabel: AGENT_CHAT_LABEL,
    channels: {},
  });
}

/**
 * Generic factory — dedicated always-on channel per agent id.
 * storage-token is seeded on first call.
 */
export function createAgentChannel(agentId = STORAGE_TOKEN_AGENT_ID, { peers = [] } = {}) {
  const id = sanitizeAgentId(agentId);
  const doc = loadChannelsDoc();
  if (!doc.channels) doc.channels = {};
  if (doc.channels[id]) {
    return { ok: true, created: false, channel: doc.channels[id] };
  }
  const open = publicOpenKey(id);
  const channel = {
    agentId: id,
    channelId: channelIdFor(id),
    publicKey: open.key,
    publicKeyHex: open.hex,
    peers: [...new Set((peers || []).map(sanitizeAgentId))],
    alwaysOn: true,
    indexed: true,
    hexOnlyDual: true,
    createdAt: new Date().toISOString(),
    formula: FORMULA_ID,
    neverInventHashes: true,
  };
  doc.channels[id] = channel;
  doc.updatedAt = channel.createdAt;
  saveJson(CHANNELS_PATH, doc);
  return { ok: true, created: true, channel };
}

export function getAgentChannel(agentId = STORAGE_TOKEN_AGENT_ID) {
  const id = sanitizeAgentId(agentId);
  const doc = loadChannelsDoc();
  if (doc.channels?.[id]) return doc.channels[id];
  return createAgentChannel(id).channel;
}

export function listAgentChannels() {
  createAgentChannel(STORAGE_TOKEN_AGENT_ID);
  const doc = loadChannelsDoc();
  return Object.values(doc.channels || {});
}

/** Connect another agent to READ (and later interact with) this dedicated path. */
export function connectPeerRead(ownerAgentId, peerAgentId) {
  const owner = sanitizeAgentId(ownerAgentId);
  const peer = sanitizeAgentId(peerAgentId);
  if (owner === peer) {
    return { ok: false, reason: "peer must be a different agent id" };
  }
  const ch = getAgentChannel(owner);
  createAgentChannel(peer);
  const peers = new Set(ch.peers || []);
  peers.add(peer);
  ch.peers = [...peers];
  const doc = loadChannelsDoc();
  doc.channels[owner] = ch;
  doc.updatedAt = new Date().toISOString();
  saveJson(CHANNELS_PATH, doc);
  return { ok: true, owner, peer, peers: ch.peers, read: true, interact: true };
}

export function peerCanRead(ownerAgentId, peerAgentId) {
  const owner = sanitizeAgentId(ownerAgentId);
  const peer = sanitizeAgentId(peerAgentId);
  if (owner === peer) return true;
  const ch = getAgentChannel(owner);
  return (ch.peers || []).includes(peer);
}

/**
 * Offline/bank path when gas thin. Stages banked hex with KEY+LOC.
 * Hitch when leftover covers KEY+LOC on a paired ride — never solo-sends.
 * Unpaired paid self-calls stay banked. VITAFEED_PAID not touched.
 */
export function stageAgentChatMessage({
  agentId = STORAGE_TOKEN_AGENT_ID,
  text = "",
  leftoverEth = 0,
  hitchCostEth = 0,
  pairedUniswapSell = false,
  keyLocCovered = false,
  sealedLoc = null,
  extraSealed = [],
  env = process.env,
} = {}) {
  const packed = packHexKeyLocDual({ agentId, text, sealedLoc, extraSealed });
  if (!packed.ok) return packed;
  const wrap = wrapQueueSelfCall({
    text: packed.laneMachine,
    data: packed.hex,
    leftoverEth,
    hitchCostEth,
    pairedUniswapSell,
    keyLocCovered,
    topic: "agent-chat:" + packed.agentId,
  });
  const backup = agentChatChainBackupConfig(env);
  const row = {
    at: new Date().toISOString(),
    agentId: packed.agentId,
    channelId: packed.channelId,
    human: packed.laneHuman,
    machine: packed.laneMachine,
    hex: packed.hex,
    locToken: packed.locToken,
    contentCommit: packed.contentCommit,
    hitch: wrap.hitch === true,
    banked: wrap.banked === true,
    send: false,
    txHash: null,
    unpaired: wrap.unpaired === true,
    vitafeedPaid: false,
    chainBackup: {
      configured: backup.configured,
      enabled: false,
      spendsRisk: false,
    },
    reason: wrap.reason,
    neverInventHashes: true,
  };
  const bank = loadJson(BANK_PATH, { id: "agent-chat-bank-v0", events: [] });
  if (!Array.isArray(bank.events)) bank.events = [];
  bank.events.push(row);
  if (bank.events.length > 200) bank.events = bank.events.slice(-200);
  bank.updatedAt = row.at;
  saveJson(BANK_PATH, bank);
  return {
    ok: true,
    ...row,
    packed,
    wrap,
    publicKey: packed.publicKey,
  };
}

export function listBankedMessages(agentId = null) {
  const bank = loadJson(BANK_PATH, { id: "agent-chat-bank-v0", events: [] });
  const id = agentId ? sanitizeAgentId(agentId) : null;
  return (bank.events || []).filter((e) => !id || e.agentId === id);
}

export function listProvenLocsForAgent(agentId = STORAGE_TOKEN_AGENT_ID, extraSealed = []) {
  const id = sanitizeAgentId(agentId);
  const schema = loadX404Schema();
  const tag = lookupX404Tag(id, schema);
  const fromTag = tag.ok
    ? (tag.plots || [])
        .filter((p) => isTxHash(p.sealedBaseLoc) && isKnownSealedHash(p.sealedBaseLoc, extraSealed))
        .map((p) => ({
          id: p.plotId,
          location: p.sealedBaseLoc,
          kind: "vita",
          label: p.plottedLocation,
          basescan: MAINFRAME_ANCHORS.basescanTx + p.sealedBaseLoc,
          idmChat: "Basescan → Input Data → View as UTF-8",
          status: p.status,
          masterLocationTag: p.masterLocationTag,
          waitingMasterTag: p.status === "waiting-master-tag",
        }))
    : [];
  const classProof = provenX404Locs(schema);
  const waiting = waitingMasterTagPlots(schema).filter(
    (p) => p.tagName === id || p.displayName === id,
  );
  return {
    agentId: id,
    proven: fromTag.length ? fromTag : classProof.filter((l) => l.tagName === id),
    classProof,
    waitingMasterTag: waiting,
    idmSealedOnly: true,
    neverInventHashes: true,
  };
}

function btn(text, cmd) {
  return { text: String(text).slice(0, 64), callback_data: telegramCallbackData(cmd) };
}

export function buildAgentChannelKeyboard(agentId = STORAGE_TOKEN_AGENT_ID) {
  const id = sanitizeAgentId(agentId);
  const chatCmd = "/agents chat";
  const dirCmd = "/agents dir";
  const dualCmd = "/agents dual";
  const provenCmd = "/agents proven";
  const pathCmd = "/agents path";
  const kb = {
    inline_keyboard: [
      [btn("💬 Chat", chatCmd), btn("📂 Dir", dirCmd), btn("⚖️ Dual", dualCmd)],
      [btn("🔗 Proven locs", provenCmd), btn("🗺 Path map", pathCmd)],
      [btn("🏠 HOME", "/home"), btn("🤖 Agents", "/home agents")],
    ],
  };
  void id;
  return withHomeButton(kb);
}

export function assertAgentCallbacksFit() {
  const kb = buildAgentChannelKeyboard();
  const bad = [];
  for (const b of kb.inline_keyboard.flat()) {
    const c = b.callback_data || "";
    if (c.length > CALLBACK_DATA_MAX) bad.push(c);
  }
  return { ok: bad.length === 0, bad, max: CALLBACK_DATA_MAX };
}

export function parseAgentChatCommand(raw) {
  const src = String(raw || "").trim();
  const low = src.toLowerCase();
  if (low === "/agentchat" || low === "/agents" || low === "/agent") {
    return { ok: true, action: "chat", agentId: STORAGE_TOKEN_AGENT_ID, body: "" };
  }
  if (!low.startsWith("/agents ") && !low.startsWith("/agentchat ") && !low.startsWith("/agent ")) {
    return { ok: false, action: null };
  }
  const rest = src.replace(/^\/(?:agents|agentchat|agent)\s+/i, "").trim();
  const lowRest = rest.toLowerCase();
  const known = ["chat", "dir", "dual", "proven", "path", "peers", "bank"];
  const first = rest.split(/\s+/)[0] || "";
  const firstLow = first.toLowerCase();
  if (known.includes(firstLow)) {
    const body = rest.slice(first.length).trim();
    return {
      ok: true,
      action: firstLow === "peers" ? "peers" : firstLow,
      agentId: STORAGE_TOKEN_AGENT_ID,
      body,
    };
  }
  // /agents <agentId> [action] [body]
  const id = sanitizeAgentId(first);
  const after = rest.slice(first.length).trim();
  const act = (after.split(/\s+/)[0] || "chat").toLowerCase();
  const action = known.includes(act) ? act : "chat";
  const body = known.includes(act) ? after.slice(act.length).trim() : after;
  return { ok: true, action, agentId: id, body };
}

function formatChatCard(channel, staged = null) {
  const lines = [];
  lines.push(AGENT_CHAT_MAGIC + "v1|chat=" + channel.agentId + "§");
  lines.push("🤖 AGENT CHAT — " + channel.agentId);
  lines.push("channel " + channel.channelId);
  lines.push("━━━━━━━━━━━━━━━━━━━━");
  lines.push("always-on dedicated path. public/open key.");
  lines.push("key=" + channel.publicKey);
  lines.push("hex-only §KEY§…§LOC§ dual · searchable across nets");
  lines.push("peers: " + ((channel.peers || []).join(", ") || "(none yet — /agents peers <id>)"));
  lines.push("");
  lines.push("Game: /home → Agents → Chat");
  lines.push("Dir tags (x404): same name, many plots. Proven locs wait master-tag.");
  lines.push("Gas thin → bank hex. Leftover covers KEY+LOC → hitch (never solo-send).");
  lines.push("VITAFEED_PAID stays gated. No unpaired paid self-calls.");
  if (staged?.ok) {
    lines.push("");
    lines.push(staged.hitch ? "HITCH staged (covered leftover) — not broadcast." : "BANKED hex (gas thin / unpaired) — wait free ride.");
    lines.push("commit " + shortHex(staged.contentCommit, 12) + "…");
    lines.push("LOC " + clip(staged.locToken, 80));
  }
  const backup = agentChatChainBackupConfig();
  if (backup.configured) {
    lines.push("wallet/x402 stub configured — spendsRisk=NO enabled=NO");
  }
  return lines.join("\n");
}

function formatDualCard(packed) {
  const lines = [];
  lines.push(AGENT_CHAT_MAGIC + "v1|dual§");
  lines.push("⚖️ AGENT DUAL — HUMAN / MACHINE");
  lines.push("━━━━━━━━━━━━━━━━━━━━");
  lines.push("HUMAN  " + packed.humanBytes + "B  " + clip(packed.laneHuman, 80));
  lines.push("MACHINE " + packed.machineBytes + "B  " + clip(packed.laneMachine, 80));
  lines.push("hex " + clip(packed.hex, 48));
  lines.push("openKey " + packed.publicKey.key);
  lines.push("snark " + clip(packed.packed?.short || "", 96));
  lines.push("");
  lines.push("Both lanes searchable. KEY is public. LOC never invented.");
  return lines.join("\n");
}

function formatProvenCard(bundle) {
  const lines = [];
  lines.push(AGENT_CHAT_MAGIC + "v1|proven§");
  lines.push("🔗 PROVEN LOCS — " + bundle.agentId);
  lines.push("IDM sealed-only. Formula anchors = class proof, not body.");
  lines.push("━━━━━━━━━━━━━━━━━━━━");
  const proven = bundle.proven.length ? bundle.proven : bundle.classProof;
  if (!proven.length) {
    lines.push("(none sealed yet — waiting master-location tag)");
  }
  for (const loc of proven.slice(0, 8)) {
    lines.push(
      "• " +
        (loc.id || "loc") +
        "  " +
        shortHex(loc.location, 8) +
        "…  " +
        loc.basescan,
    );
    if (loc.waitingMasterTag) lines.push("  waiting master-location tag");
  }
  lines.push("");
  lines.push("waiting in directory: " + bundle.waitingMasterTag.length);
  for (const w of bundle.waitingMasterTag.slice(0, 8)) {
    lines.push("  · " + w.plotId + "  " + clip(w.plottedLocation, 48));
  }
  lines.push("Open tx → Input Data → View as UTF-8. Never invented.");
  return lines.join("\n");
}

function formatPeersCard(channel) {
  const lines = [];
  lines.push(AGENT_CHAT_MAGIC + "v1|peers§");
  lines.push("READ / INTERACT — " + channel.agentId);
  lines.push("peers: " + ((channel.peers || []).join(", ") || "(none)"));
  lines.push("Connect: /agents peers <other-agent-id>");
  return lines.join("\n");
}

function formatBankCard(agentId) {
  const rows = listBankedMessages(agentId).slice(-8);
  const lines = [];
  lines.push(AGENT_CHAT_MAGIC + "v1|bank§");
  lines.push("BANKED HEX — " + (agentId || "all"));
  lines.push("━━━━━━━━━━━━━━━━━━━━");
  if (!rows.length) lines.push("(empty — send /agents chat <text> to stage)");
  for (const r of rows) {
    lines.push(
      (r.hitch ? "HITCH" : "BANK") +
        "  " +
        r.agentId +
        "  " +
        shortHex(r.contentCommit, 8) +
        "  " +
        clip(r.human, 40),
    );
  }
  lines.push("txHash always null here — never invented. Hitch when leftover covers.");
  return lines.join("\n");
}

/**
 * Telegram action router for /agents|/agentchat.
 */
export function handleAgentChatAction({
  action = "chat",
  agentId = STORAGE_TOKEN_AGENT_ID,
  body = "",
  leftoverEth = 0,
  hitchCostEth = 0,
  pairedUniswapSell = false,
  keyLocCovered = false,
  env = process.env,
} = {}) {
  const id = sanitizeAgentId(agentId);
  const channel = getAgentChannel(id);
  const fit = assertAgentCallbacksFit();
  const keyboard = buildAgentChannelKeyboard(id);

  if (action === "dir") {
    const name = String(body || "").trim() || id;
    const reply = formatX404Card(name);
    return {
      ok: true,
      action: "dir",
      agentId: id,
      reply,
      html: "<pre>" + esc(reply).slice(0, 3500) + "</pre>",
      keyboard,
      callbackFit: fit,
      tag: lookupX404Tag(name),
    };
  }
  if (action === "path") {
    const reply = formatX404PathMapCard();
    return {
      ok: true,
      action: "path",
      agentId: id,
      reply,
      html: "<pre>" + esc(reply).slice(0, 3500) + "</pre>",
      keyboard,
      callbackFit: fit,
    };
  }
  if (action === "proven") {
    const bundle = listProvenLocsForAgent(id);
    const reply = formatProvenCard(bundle);
    return {
      ok: true,
      action: "proven",
      agentId: id,
      reply,
      html: "<pre>" + esc(reply).slice(0, 3500) + "</pre>",
      keyboard,
      callbackFit: fit,
      proven: bundle,
    };
  }
  if (action === "dual") {
    const seed = String(body || "").trim() || "storage-token channel dual seed — hex KEY+LOC; public open key.";
    const packed = packHexKeyLocDual({ agentId: id, text: seed });
    const reply = formatDualCard(packed);
    return {
      ok: true,
      action: "dual",
      agentId: id,
      reply,
      html: "<pre>" + esc(reply).slice(0, 3500) + "</pre>",
      keyboard,
      callbackFit: fit,
      packed,
    };
  }
  if (action === "peers") {
    const peer = String(body || "").trim();
    let connected = null;
    if (peer) connected = connectPeerRead(id, peer);
    const reply = formatPeersCard(getAgentChannel(id));
    return {
      ok: connected ? connected.ok : true,
      action: "peers",
      agentId: id,
      reply: connected && !connected.ok ? connected.reason + "\n" + reply : reply,
      html: "<pre>" + esc(reply).slice(0, 3500) + "</pre>",
      keyboard,
      callbackFit: fit,
      connected,
    };
  }
  if (action === "bank") {
    const reply = formatBankCard(id);
    return {
      ok: true,
      action: "bank",
      agentId: id,
      reply,
      html: "<pre>" + esc(reply).slice(0, 3500) + "</pre>",
      keyboard,
      callbackFit: fit,
    };
  }

  // chat (default) — optional body stages a banked/hitch message
  let staged = null;
  if (String(body || "").trim()) {
    staged = stageAgentChatMessage({
      agentId: id,
      text: body,
      leftoverEth,
      hitchCostEth,
      pairedUniswapSell,
      keyLocCovered,
      env,
    });
  }
  const reply = formatChatCard(getAgentChannel(id), staged);
  return {
    ok: true,
    action: "chat",
    agentId: id,
    reply,
    html: "<pre>" + esc(reply).slice(0, 3500) + "</pre>",
    keyboard,
    callbackFit: fit,
    staged,
    channel: getAgentChannel(id),
  };
}

export {
  X404_MAGIC,
  listX404Tags,
  loadX404Schema,
  lookupX404Tag,
  searchX404,
  waitingMasterTagPlots,
  CALLBACK_DATA_MAX,
};
