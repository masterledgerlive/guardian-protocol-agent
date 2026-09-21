// ═══════════════════════════════════════════════════════════════════════════════
// 🌐 VITA WEBHOOK — HTTP endpoint so Claude / Arena / Engine / Control Board
//    can pull memory and learn without hunting files.
// ───────────────────────────────────────────────────────────────────────────────
// Runs a tiny HTTP server alongside the trading bot.
//
//   GET  /board               — Control Board hub (live V3 inject hooks; V4 deferred/link only)
//   GET  /board/health        — which boards are mounted (also GET /health)
//   GET  /board/api/params    — read-only live knobs (public)
//   GET  /board/api/snapshot  — hub snapshot (demo public; live if authorized)
//   POST /board/api/sim       — labeled V3 practice sim (public, no spend, no V4 encode)
//   GET  /board/api/inject    — V3 tradeable hitch surfaces + leftover/hitch capacity + bot piggy
//   GET  /board/api/scoreboard — KEEP/CUT/CAUTION outlets + KEY+LOC hitch density (no invented P&L)
//   GET  /v4                  — V4 docs only (deferred — not this runtime)
//   GET  /arena               — Guardian Arena HTML (public learning board)
//   GET  /                  — same as /arena (original live path)
//   GET  /arena/api/snapshot  — live ledger snapshot (auth)
//   POST /arena/api/queue     — queue Telegram-equivalent commands (auth)
//   GET  /engine              — Guardian Engine HTML (wave / surfer / hitch board)
//   GET  /engine/api/snapshot — live engine waves + costs + piggy lights (auth)
//   POST /engine/api/queue    — ride / trick / message / surfer commands (auth)
//   GET  /vita                — VITA HTML console (Telegram twin, public)
//   GET  /vita/client.js      — browser console client
//   GET  /vita/lib/vita-parse.js — same §TOKEN§ parser as the bot
//   GET  /vita/context        — latest compressed memory for new session start
//   GET  /vita/registry       — full filing registry (all sessions)
//   GET  /vita/router        — secondary hitch router (vita|eureka|hat|auto)
//   GET  /vita/locations     — squashed location depository
//   GET  /vita/leftover     — public leftover hitch scan (hashes + class, no utf8)
//   GET  /vita/wavetest     — WAVE memory-mirror SIM (shards→read-back vs answer key; no spend)
//   GET  /vita/waveproof    — capped 3-token WAVE proof SIM (public)
//   POST /vita/waveproof    — desk live batch when WAVE_PROOF_LIVE=yes (auth: VITA_WEBHOOK_SECRET)
//   GET  /vita/waveproof?live=1 — same live path as POST (auth)
//   GET  /vita/wavefull     — full 28-shard Heraclitus quote SIM (public)
//   POST /vita/wavefull     — desk live 28-send when WAVE_FULL_LIVE=yes (auth)
//   GET  /vita/wavefull?live=1 — same live path as POST (auth)
//   GET  /vita/xmem/spec    — public XMEM v1 agent spec + instructions
//   GET  /vita/lib/xmem.js  — same XMEM parser as the bot
//   GET|POST /vita/xmem/decode — parse/search provided utf8/hex (no chain fetch)
//   GET  /vita/xmem?q=      — x402 wallet scan + XMEM search (auth)
//   GET  /vita/course        — hourly inject-without-loss scorecard
//   GET  /vita/inject       — recursive §TOKEN§ memory for session start
//   GET  /vita/brain        — six-lobe brain + finetune hypothesis graph (auth)
//   GET  /vita/hypotheses   — hypothesis graph query (?q=&status=&symbol=) (auth)
//   GET  /vita/pull?tx=0x  — re-read hitch UTF-8 from Base into recursive memory
//   GET  /vita/read?f=FILE  — open file (local + GitHub CODE/STATE) + SNARK + IDM
//   GET  /vita/mirror       — dual-path GitHub duplicate · tree · boot · zero-proof (+ HTML UI)
//   GET  /vita/kids-player  — closed-garden KIDS YouTube URL directory player
//   GET  /vita/players      — named players hub (Garden + Proven) + filer SOURCE|REFERENCE
//   GET  /vita/players/garden — Garden Player (named VIN/kids holder)
//   GET  /vita/players/proven — Proven Player / ZK-Streaming Engine
//   GET  /vita/players/chain-box — clickable Basescan loc (never invented)
//   GET  /vita/token-player — token pulldown player (DEX reader + 32-chain + $0.05 seed)
//   GET  /vita/token-player/api — JSON catalog + portfolio snapshot
//   GET  /vita/dex-reader?sym=  — live DexScreener + Gecko dual (miss ≠ $0)
//   GET  /vita/chains        — 32-chain portfolio (ETH L1 other-path ≠ Base RISK)
//   GET  /vita/url-dir      — JSON catalog of curated playlist urls
//   GET  /vita/free-music   — public-domain song catalog + grouped VIN plan
//   GET  /vita/free-music/play — original OGG reconstructed from grouped packets
//   GET  /vita/free-music/locs — daisy-chain loc proof · click-through Basescan MATCH
//   GET  /vita/free-music/loc  — exact VIN UTF-8 packet for one block (inspect; no invented hash)
//   GET  /vita/soundboard   — DJ pad board HTML + catalog JSON
//   GET  /vita/soundboard/play — pad WAV reconstruct
//   GET  /vita/soundboard/locs — LOCAL_OK vs MATCH vs CLASS_PROOF (not pad body)
//   GET  /vita/soundboard/loc  — exact pad VIN UTF-8
//   POST /vita/soundboard/prompt — prompted music bite → catalog
//   POST /vita/soundboard/upload — upload bytes → catalog
//   GET  /vita/chain-dir    — completion directory (routing vs sealed Input Data proofs)
//   GET  /vita/check        — blockchain systems check (SNARK + EVM recover + models + LLM spin)
//   GET  /vita/status         — bot status, portfolio, positions
//   POST /vita/save           — trigger vitasave programmatically
//
// Auth: VITA_WEBHOOK_SECRET header must match env var
// Public HTML + /board/health + demo/sim APIs + GET /vita/leftover + GET /vita/read + GET /vita/mirror + GET /vita/check + XMEM spec/decode do not require the secret.
// Live queue / vita/* still require the secret. No unauthenticated mutate of env.
// ═══════════════════════════════════════════════════════════════════════════════

import { createServer } from "http";
import { readFile } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { demoEngineSnapshot } from "./engine-board.js";
import {
  boardHealth,
  demoBoardSnapshot,
  leftoverHitchCapacity,
  leftoverInputsFromEngine,
  listV3InjectSurfaces,
  listOutletScoreboard,
  hitchDensityBoard,
  modelBotUsagePiggy,
  readLiveParamSnapshot,
  runBoardSim,
  boardWaveTile,
  v4BoardStatus,
} from "./board-control.js";
import { vitaRouterStatus, buildVitaInjectContext, getLastVitaPacket } from "./vita-router.js";
import { locDepositoryStatus } from "./vita-locations.js";
import {
  buildBrainStatus,
  queryHypotheses,
  getHypothesisGraph,
  hypothesisToXmem,
} from "./finetune-memory.js";
import { vitaQuality } from "./vita-parse.js";
import { evaluateVitaCourse, formatCourseMessage } from "./vita-course.js";
import {
  fetchTxCalldataHex,
  getCachedLeftoverScan,
  isPendingLeftoverScan,
  publicLeftoverScanView,
  pullLocationFromChain,
} from "./vita-chain-reader.js";
import {
  AGENT_INSTRUCTIONS,
  AGENT_SPEC,
  extractMemoryRecords,
  retrieveXmem,
} from "./xmem.js";
import { wrapVitaSaveSelfCall } from "./vita/feed-wrap.js";
import {
  listLibraryEntries,
  playFromLibrary,
} from "./vita/vita-feed-library.js";
import {
  listFeedBacklog,
  formatFeedBacklogCard,
  formatFeedBacklogGrowthProof,
  seedFeedBacklogFromMemory,
} from "./vita/vita-feed-backlog.js";
import {
  loaderPublicState,
  preloadKnowledgePacks,
  ensureLoaderMemorySeeds,
} from "./vita/vita-feed-loader.js";
import {
  handleVitaFeedAction,
  maybeAutofireVitaFeed,
  vitaFeedAutofireEnabled,
  vitaFeedForceEnabled,
  vitaFeedPaidEnabled,
  VITAFEED_AUTOFIRE_CHAT_ID,
} from "./vita/vita-feed.js";
import {
  publicUrlDirState,
} from "./vita/url-dir.js";
import {
  evaluateTokenLegit,
  findCatalogToken,
  loadTokenCatalog,
  tokenPlayerPublicState,
} from "./vita/token-player.js";
import { readDexForToken } from "./vita/dex-reader.js";
import { listMultichainPortfolio } from "./vita/multichain-portfolio.js";
import { publicChainDirState, searchByLocation } from "./vita/chain-dir.js";
import {
  publicFreeMusicState,
  publicFreeMusicPlay,
  publicFreeMusicLocs,
  publicFreeMusicLoc,
} from "./vita/free-music.js";
import {
  publicSoundboardState,
  publicSoundboardPlay,
  publicSoundboardLocs,
  publicSoundboardLoc,
  createPromptPad,
  addUploadedPad,
} from "./vita/soundboard.js";
import {
  publicPlayersIndex,
  publicGardenState,
  publicProvenState,
  publicProvenVerify,
  publicFilerState,
  buildReferenceBlocks,
  buildChainBox,
  chainBoxCss,
} from "./vita/players/index.js";
import { handleWaveTestAction } from "./vita/wave-wrap.js";
import { handleVitaMirrorAction, parseVitaMirrorCommand } from "./vita/mirror-chain.js";
import { handleChainLayerAction } from "./vita/chain-layer.js";
import {
  liveGithubRepo,
  liveGithubBranch,
  liveStateBranch,
  liveGithubToken,
  githubAuthHeaders,
  githubContentsUrl,
  decodeGithubContentsUtf8,
} from "./github-contents.js";
import {
  formatWaveProofHttpResult,
  handleWaveProofAction,
  maybeAutofireWaveProof,
  wantsDeskWaveProofLive,
  waveProofAutofireEnabled,
} from "./vita/wave-proof.js";
import {
  formatWaveFullHttpResult,
  handleWaveFullAction,
  maybeAutofireWaveFull,
  wantsDeskWaveFullLive,
  waveFullAutofireEnabled,
} from "./vita/wave-full.js";

function listenPort() {
  return Number(process.env.VITA_WEBHOOK_PORT || 3000) || 3000;
}

function getSecret() {
  return process.env.VITA_WEBHOOK_SECRET;
}

const ROOT   = dirname(fileURLToPath(import.meta.url));
const ARENA_HTML = join(ROOT, "public", "arena.html");
const ENGINE_HTML = join(ROOT, "public", "engine.html");
const BOARD_HTML = join(ROOT, "public", "board.html");
const V4_HTML = join(ROOT, "public", "v4.html");
const VITA_HTML = join(ROOT, "public", "vita.html");
const VITA_FEED_PLAYER_HTML = join(ROOT, "public", "vita-feed-player.html");
const VITA_FEED_LOADER_HTML = join(ROOT, "public", "vita-feed-loader.html");
const VITA_MIRROR_HTML = join(ROOT, "public", "vita-mirror.html");
const VITA_KIDS_PLAYER_HTML = join(ROOT, "public", "vita-kids-player.html");
const VITA_TOKEN_PLAYER_HTML = join(ROOT, "public", "vita-token-player.html");
const VITA_CHAIN_DIR_HTML = join(ROOT, "public", "vita-chain-dir.html");
const VITA_SOUNDBOARD_HTML = join(ROOT, "public", "vita-soundboard.html");
const VITA_GARDEN_PLAYER_HTML = join(ROOT, "public", "players", "garden.html");
const VITA_PROVEN_PLAYER_HTML = join(ROOT, "public", "players", "proven.html");
const VITA_CHAIN_BOX_JS = join(ROOT, "public", "players", "chain-box.js");
const VITA_CLIENT_JS = join(ROOT, "public", "vita-client.js");
const VITA_PARSE_JS = join(ROOT, "vita-parse.js");
const XMEM_JS = join(ROOT, "xmem.js");

// ── Auth check ────────────────────────────────────────────────────────────────
function isAuthorized(req) {
  const SECRET = getSecret();
  if (!SECRET) return false; // no secret set = locked
  const header = req.headers["x-vita-secret"]
    || req.headers["x-vita-webhook-secret"]
    || req.headers["authorization"];
  return header === SECRET || header === "Bearer " + SECRET;
}

function json(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data, null, 2));
}

function err(res, msg, status = 400) {
  json(res, { error: msg }, status);
}

/** GitHub UTF-8 fetch for mirror reads — local disk still works without bot. */
async function webhookGithubUtf8(filename, branch) {
  if (botState?.githubGetUtf8FromBranch) {
    return botState.githubGetUtf8FromBranch(filename, branch);
  }
  const repo = liveGithubRepo();
  if (!repo) return { text: null, status: 0, miss: true };
  try {
    const res = await fetch(
      githubContentsUrl({ repo, filename, branch, cacheBust: true }),
      { headers: githubAuthHeaders(liveGithubToken()) },
    );
    if (!res.ok) return { text: null, status: res.status, miss: true };
    const data = await res.json();
    const text = decodeGithubContentsUtf8(data);
    return { text, sha: data.sha, status: res.status, miss: text == null };
  } catch {
    return { text: null, status: 0, miss: true };
  }
}

/** Public POST /board/api/sim shares this process with the live injector — cap bodies. */
const MAX_JSON_BODY_BYTES = 16 * 1024;

function payloadTooLargeError() {
  const e = new Error("payload too large");
  e.code = "PAYLOAD_TOO_LARGE";
  return e;
}

function httpStatusForError(e) {
  if (e?.code === "PAYLOAD_TOO_LARGE") return 413;
  return 500;
}

function readBody(req, { maxBytes = MAX_JSON_BODY_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > maxBytes) {
      req.resume();
      reject(payloadTooLargeError());
      return;
    }
    const chunks = [];
    let size = 0;
    let done = false;
    const fail = (e) => {
      if (done) return;
      done = true;
      reject(e);
    };
    req.on("data", (c) => {
      if (done) return;
      size += c.length;
      if (size > maxBytes) {
        req.resume();
        fail(payloadTooLargeError());
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (done) return;
      done = true;
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", fail);
  });
}

// ── Handler — injected with live bot state by agent.js ────────────────────────
let botState = null;
export function injectBotState(state) { botState = state; }

async function resolveWaveProofLiveDeps() {
  if (typeof botState?.waveProofLiveContext === "function") {
    return botState.waveProofLiveContext();
  }
  return {
    sendTx: typeof botState?.waveProofSendTx === "function" ? botState.waveProofSendTx : null,
    fetchCalldata: typeof botState?.waveProofFetchCalldata === "function"
      ? botState.waveProofFetchCalldata
      : null,
    liquidUsd: botState?.waveProofLiquidUsd ?? null,
    quotes: botState?.waveProofQuotes ?? null,
  };
}

async function runWaveProofHttp({ live = false, symbols = "" } = {}) {
  let sendTx = null;
  let fetchCalldata = null;
  let liquidUsd = null;
  let quotes = null;
  if (live) {
    const deps = await resolveWaveProofLiveDeps();
    sendTx = deps?.sendTx || null;
    fetchCalldata = deps?.fetchCalldata || null;
    liquidUsd = deps?.liquidUsd ?? null;
    quotes = deps?.quotes ?? null;
  }
  const out = await handleWaveProofAction({
    action: "run",
    symbols,
    env: process.env,
    live,
    sendTx,
    fetchCalldata,
    liquidUsd,
    quotes,
  });
  return formatWaveProofHttpResult(out);
}

/** Boot one-shot: WAVE_PROOF_AUTOFIRE=yes + WAVE_PROOF_LIVE=yes → same 3-send batch. Default OFF. */
export async function maybeAutofireWaveProofOnBoot(env = process.env) {
  if (!waveProofAutofireEnabled(env)) {
    return { ok: true, fired: false, reason: "WAVE_PROOF_AUTOFIRE default off" };
  }
  const deps = await resolveWaveProofLiveDeps();
  return maybeAutofireWaveProof({
    env,
    sendTx: deps?.sendTx || null,
    fetchCalldata: deps?.fetchCalldata || null,
    liquidUsd: deps?.liquidUsd ?? null,
    quotes: deps?.quotes ?? null,
  });
}

async function resolveWaveFullLiveDeps() {
  if (typeof botState?.waveFullLiveContext === "function") {
    return botState.waveFullLiveContext();
  }
  return resolveWaveProofLiveDeps();
}

async function runWaveFullHttp({
  live = false,
  symbols = "",
  vinId = "",
  fromIndex = 0,
  txHashes = [],
  fresh = false,
} = {}) {
  let sendTx = null;
  let fetchCalldata = null;
  let liquidUsd = null;
  let quotes = null;
  if (live) {
    const deps = await resolveWaveFullLiveDeps();
    sendTx = deps?.sendTx || null;
    fetchCalldata = deps?.fetchCalldata || null;
    liquidUsd = deps?.liquidUsd ?? null;
    quotes = deps?.quotes ?? null;
  }
  const out = await handleWaveFullAction({
    action: "run",
    symbols,
    env: process.env,
    live,
    sendTx,
    fetchCalldata,
    liquidUsd,
    quotes,
    vinId,
    fromIndex,
    sealedHashes: txHashes,
    fresh,
  });
  return formatWaveFullHttpResult(out);
}

/** Boot one-shot: WAVE_FULL_AUTOFIRE=yes + WAVE_FULL_LIVE=yes → all 28 gas-only shards. Default OFF. */
export async function maybeAutofireWaveFullOnBoot(env = process.env) {
  if (!waveFullAutofireEnabled(env)) {
    return { ok: true, fired: false, reason: "WAVE_FULL_AUTOFIRE default off" };
  }
  const deps = await resolveWaveFullLiveDeps();
  return maybeAutofireWaveFull({
    env,
    sendTx: deps?.sendTx || null,
    fetchCalldata: deps?.fetchCalldata || null,
    liquidUsd: deps?.liquidUsd ?? null,
    quotes: deps?.quotes ?? null,
  });
}

async function resolveVitaFeedLiveDeps() {
  if (typeof botState?.vitaFeedLiveContext === "function") {
    return botState.vitaFeedLiveContext();
  }
  return {
    sendTx: typeof botState?.vitaFeedSendTx === "function" ? botState.vitaFeedSendTx : null,
    liquidUsd: botState?.vitaFeedLiquidUsd ?? null,
    riskBalanceEth: botState?.vitaFeedRiskBalanceEth ?? null,
    quotes: botState?.vitaFeedQuotes ?? null,
  };
}

/**
 * Boot one-shot: VITAFEED_AUTOFIRE=yes + plain VITAFEED_AUTOFIRE_BODY → override seal.
 * Needs VITAFEED_PAID=yes or VITAFEED_FORCE=yes. No BL- backlog id. Default OFF.
 */
export async function maybeAutofireVitaFeedOnBoot(env = process.env) {
  if (!vitaFeedAutofireEnabled(env)) {
    return { ok: true, fired: false, reason: "VITAFEED_AUTOFIRE default off" };
  }
  const deps = await resolveVitaFeedLiveDeps();
  return maybeAutofireVitaFeed({
    env,
    sendTx: deps?.sendTx || null,
    liquidUsd: deps?.liquidUsd ?? null,
    riskBalanceEth: deps?.riskBalanceEth ?? null,
    quotes: deps?.quotes ?? null,
    chatId: VITAFEED_AUTOFIRE_CHAT_ID,
  });
}

async function runVitaFeedHttp({
  body = "",
  force = false,
  live = false,
} = {}) {
  const plain = String(body || "").trim();
  if (!plain) {
    return {
      ok: false,
      reply: "VITAFEED desk: missing body (exact UTF-8; no BL- backlog id)",
    };
  }
  let sendTx = null;
  let liquidUsd = null;
  let riskBalanceEth = null;
  let quotes = {};
  if (live) {
    const deps = await resolveVitaFeedLiveDeps();
    sendTx = deps?.sendTx || null;
    liquidUsd = deps?.liquidUsd ?? null;
    riskBalanceEth = deps?.riskBalanceEth ?? null;
    quotes = deps?.quotes || {};
  }
  const env = { ...process.env };
  if (force || vitaFeedForceEnabled(env)) {
    env.VITAFEED_FORCE = "yes";
  }
  const chatId = "vitafeed-desk";
  const preview = await handleVitaFeedAction({
    action: "preview",
    body: plain,
    chatId,
    quotes,
    env,
  });
  if (!live) {
    return {
      ok: true,
      live: false,
      phase: "before",
      reply: preview.reply,
      prepared: preview.prepared || null,
      cost: preview.cost || null,
      note: "SIM cost card only — POST with live=1 + VITAFEED_PAID|FORCE for seal",
    };
  }
  if (!vitaFeedPaidEnabled(env) && !vitaFeedForceEnabled(env)) {
    return {
      ok: false,
      live: true,
      phase: "bank",
      reply: "VITAFEED desk live needs VITAFEED_PAID=yes or VITAFEED_FORCE=yes",
      preview,
    };
  }
  const out = await handleVitaFeedAction({
    action: "override",
    chatId,
    env,
    sendTx,
    liquidUsd,
    riskBalanceEth,
    quotes,
    forceOverride: true,
    gasReserveEth: 0,
    reserveBuyStake: false,
  });
  const locs = (out?.result?.strand?.locations || [])
    .map(String)
    .filter((h) => /^0x[0-9a-fA-F]{64}$/.test(h));
  return {
    ok: out.ok !== false,
    live: true,
    forced: true,
    backlogId: null,
    locations: locs,
    basescan: locs.map((tx) => "https://basescan.org/tx/" + tx),
    reply: out.reply,
    result: out.result || null,
    thrift: out.thrift || null,
  };
}

let webhookBound = false;

export function isAddrInUseError(err) {
  return err?.code === "EADDRINUSE" || /EADDRINUSE/i.test(String(err?.message || ""));
}

export function handleWebhookListenError(err, port = listenPort()) {
  if (isAddrInUseError(err)) {
    webhookBound = true;
    console.log(`⚠️  VITA webhook: port ${port} already in use — skip rebind, continue`);
    return "eaddrinuse";
  }
  console.log(`⚠️  VITA webhook listen error: ${err?.message || err}`);
  return "error";
}

async function servePublicFile(res, filePath, contentType, label) {
  try {
    const body = await readFile(filePath, "utf8");
    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
    });
    res.end(body);
  } catch (e) {
    err(res, `${label} missing: ` + e.message, 500);
  }
}

async function servePublicHtml(res, filePath, label) {
  return servePublicFile(res, filePath, "text/html; charset=utf-8", label + " html");
}

function snapshotPayload() {
  if (!botState) return null;
  return {
    ok: true,
    running: true,
    walletAddress: botState.walletAddress || null,
    trades: botState.tradeCount || 0,
    piggy: botState.piggyBank || 0,
    drawdown: botState.drawdownHaltActive || false,
    favorite: botState.favorite || "LINK",
    injectMains: botState.injectMains || [],
    haltNewEntries: !!botState.haltNewEntries,
    positions: botState.positions || [],
    queue: typeof botState.getManualQueue === "function" ? botState.getManualQueue() : [],
    timestamp: new Date().toISOString(),
    help: {
      seeToken: "Open basescanToken links — Basescan overview can hide majors like UNI/LINK",
      telegram: ["/status", "/bag", "/bank", "/piggy", "/tiers", "/buy LINK 2", "/sellhalf UNI"],
      engine: "/engine — wave / surfer / hitch board",
      board: "/board — control board hub (waves + arena learn + V4)",
    },
  };
}

function engineSnapshotPayload() {
  if (typeof botState?.getEngineSnapshot === "function") {
    try {
      const live = botState.getEngineSnapshot();
      if (live?.ok) return live;
    } catch (e) {
      return { ok: false, error: e.message, fallback: demoEngineSnapshot() };
    }
  }
  // Bot not ready — still teach the dance
  return demoEngineSnapshot();
}

function healthPayload() {
  return boardHealth({
    secretConfigured: !!getSecret(),
    botReady: !!botState,
    v4: v4BoardStatus(),
  });
}

function boardSnapshotPayload(authorized) {
  const demo = demoBoardSnapshot();
  const vitaRouter = vitaRouterStatus();
  if (!authorized || !botState) {
    return { ...demo, vitaRouter, note: "demo — authorize with x-vita-secret for live waves / ledger" };
  }
  const engine = engineSnapshotPayload();
  const arena = snapshotPayload();
  const inject = listV3InjectSurfaces();
  const liveInputs = engine?.demo === false ? leftoverInputsFromEngine(engine) : {};
  const capacity = leftoverHitchCapacity(liveInputs);
  return {
    ok: true,
    demo: !!(engine?.demo) || !arena,
    kind: "control-board-snapshot",
    params: readLiveParamSnapshot(),
    inject,
    capacity,
    vitaRouter,
    botPiggy: modelBotUsagePiggy({
      hitchTagUsd: capacity.hitchTagUsd,
      leftoverUsd: capacity.leftoverUsd,
      hitchRevenueTxs: [],
      hitchRevenueUsd: null,
    }),
    engine: {
      demo: !!engine?.demo,
      favorite: engine?.favorite,
      hitchProve: engine?.hitchProve,
      hitchProveNote:
        "Bot-internal hitch prove counter (toward 20 + profit). Not Grok P&L. Not invented fills.",
      modules: engine?.modules,
      waves: (engine?.waves || []).map(boardWaveTile),
    },
    arena: arena || null,
    v4: { deferred: true, page: "/v4", sameProcessAsV3: false, startableFromThisWebhook: false },
    invariants: demo.invariants,
    timestamp: new Date().toISOString(),
  };
}

async function handleVitaRequest(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "x-vita-secret, x-vita-webhook-secret, authorization, content-type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, "http://localhost");
  const path = url.pathname;

  try {
    // ── Public Control Board / Arena / Engine HTML ──────────────────────────
    // `/` and `/arena` stay the original Arena ledger (do not hijack live path).
    if ((path === "/board" || path === "/board/") && req.method === "GET") {
      return servePublicHtml(res, BOARD_HTML, "board");
    }
    if ((path === "/arena" || path === "/arena/" || path === "/") && req.method === "GET") {
      return servePublicHtml(res, ARENA_HTML, "arena");
    }
    if ((path === "/engine" || path === "/engine/") && req.method === "GET") {
      return servePublicHtml(res, ENGINE_HTML, "engine");
    }
    if ((path === "/v4" || path === "/v4/") && req.method === "GET") {
      return servePublicHtml(res, V4_HTML, "v4");
    }
    if ((path === "/vita" || path === "/vita/") && req.method === "GET") {
      return servePublicHtml(res, VITA_HTML, "vita");
    }
    if ((path === "/vita/feed-player" || path === "/vita/feed-player/") && req.method === "GET") {
      return servePublicHtml(res, VITA_FEED_PLAYER_HTML, "vita feed player");
    }
    if ((path === "/vita/kids-player" || path === "/vita/kids-player/") && req.method === "GET") {
      return servePublicHtml(res, VITA_KIDS_PLAYER_HTML, "vita kids player");
    }
    if ((path === "/vita/players" || path === "/vita/players/") && req.method === "GET") {
      const accept = String(req.headers.accept || "");
      if (accept.includes("text/html") && !accept.includes("application/json")) {
        return servePublicHtml(res, VITA_GARDEN_PLAYER_HTML, "vita garden player");
      }
      return json(res, publicPlayersIndex());
    }
    if ((path === "/vita/players/garden" || path === "/vita/players/garden/") && req.method === "GET") {
      return servePublicHtml(res, VITA_GARDEN_PLAYER_HTML, "vita garden player");
    }
    if ((path === "/vita/players/proven" || path === "/vita/players/proven/") && req.method === "GET") {
      return servePublicHtml(res, VITA_PROVEN_PLAYER_HTML, "vita proven player");
    }
    if ((path === "/vita/players/chain-box.js" || path === "/vita/players/chain-box.js/") && req.method === "GET") {
      return servePublicFile(res, VITA_CHAIN_BOX_JS, "text/javascript; charset=utf-8", "chain-box js");
    }
    if ((path === "/vita/players/chain-box" || path === "/vita/players/chain-box/") && req.method === "GET") {
      const player = String(url.searchParams.get("player") || "garden");
      const music = String(url.searchParams.get("music") || url.searchParams.get("song") || "").trim() || null;
      const box = buildChainBox({ player, songId: music });
      return json(res, { ...box, css: chainBoxCss() });
    }
    if ((path === "/vita/players/filer" || path === "/vita/players/filer/") && req.method === "GET") {
      return json(res, publicFilerState(String(url.searchParams.get("q") || "")));
    }
    if ((path === "/vita/players/reference" || path === "/vita/players/reference/") && req.method === "GET") {
      return json(res, buildReferenceBlocks());
    }
    if ((path === "/vita/players/garden/api" || path === "/vita/players/garden/api/") && req.method === "GET") {
      return json(res, publicGardenState({
        dir: String(url.searchParams.get("dir") || "kids"),
        music: String(url.searchParams.get("music") || "").trim() || null,
      }));
    }
    if ((path === "/vita/players/proven/api" || path === "/vita/players/proven/api/") && req.method === "GET") {
      return json(res, publicProvenState({
        id: String(url.searchParams.get("id") || url.searchParams.get("music") || "maple"),
      }));
    }
    if ((path === "/vita/players/proven/verify" || path === "/vita/players/proven/verify/") && req.method === "POST") {
      const body = (await readBody(req).catch(() => ({}))) || {};
      return json(res, publicProvenVerify(body));
    }
    if ((path === "/vita/token-player" || path === "/vita/token-player/") && req.method === "GET") {
      return servePublicHtml(res, VITA_TOKEN_PLAYER_HTML, "vita token player");
    }
    if ((path === "/vita/token-player/api" || path === "/vita/token-player/api/") && req.method === "GET") {
      const sym = String(url.searchParams.get("sym") || url.searchParams.get("token") || "").trim();
      return json(res, tokenPlayerPublicState({ symbol: sym }));
    }
    if ((path === "/vita/chains" || path === "/vita/chains/") && req.method === "GET") {
      return json(res, listMultichainPortfolio());
    }
    if ((path === "/vita/dex-reader" || path === "/vita/dex-reader/") && req.method === "GET") {
      const sym = String(url.searchParams.get("sym") || url.searchParams.get("token") || "").trim().toUpperCase();
      const token = findCatalogToken(sym) || loadTokenCatalog().find((t) => t.symbol === sym);
      if (!token && sym !== "ETH") {
        return json(res, { ok: false, miss: true, reason: "unknown symbol — will not invent a pool", symbol: sym });
      }
      if (sym === "ETH") {
        const port = listMultichainPortfolio();
        return json(res, {
          ok: true,
          otherPath: true,
          mixIntoBaseRisk: false,
          dex: { miss: true, symbol: "ETH", reason: "ETH L1 other-path — not Base DexScreener" },
          portfolio: port.otherPath,
        });
      }
      const dex = await readDexForToken(token, { fetchLive: true });
      const legit = evaluateTokenLegit(token, dex);
      return json(res, { ok: true, symbol: token.symbol, token, dex, legit });
    }
    if ((path === "/vita/url-dir" || path === "/vita/url-dir/") && req.method === "GET") {
      const id = String(url.searchParams.get("dir") || url.searchParams.get("id") || "kids").trim();
      return json(res, publicUrlDirState(id));
    }
    if (path.startsWith("/vita/url-dir/") && req.method === "GET") {
      const id = decodeURIComponent(path.slice("/vita/url-dir/".length)).replace(/\/+$/, "") || "kids";
      return json(res, publicUrlDirState(id));
    }
    if ((path === "/vita/free-music" || path === "/vita/free-music/") && req.method === "GET") {
      return json(res, publicFreeMusicState(String(url.searchParams.get("id") || "maple")));
    }
    if ((path === "/vita/free-music/play" || path === "/vita/free-music/play/") && req.method === "GET") {
      return json(res, publicFreeMusicPlay(String(url.searchParams.get("id") || url.searchParams.get("music") || "maple")));
    }
    if ((path === "/vita/free-music/loc" || path === "/vita/free-music/loc/") && req.method === "GET") {
      const id = String(url.searchParams.get("id") || url.searchParams.get("music") || "judy");
      const g = url.searchParams.get("g") || url.searchParams.get("group") || "1";
      const i = url.searchParams.get("i") || url.searchParams.get("index") || "1";
      return json(res, publicFreeMusicLoc(id, g, i));
    }
    if ((path === "/vita/free-music/locs" || path === "/vita/free-music/locs/") && req.method === "GET") {
      const id = String(url.searchParams.get("id") || url.searchParams.get("music") || "judy");
      return json(res, await publicFreeMusicLocs(id));
    }
    if ((path === "/vita/soundboard" || path === "/vita/soundboard/") && req.method === "GET") {
      const accept = String(req.headers.accept || "");
      const pad = String(url.searchParams.get("pad") || url.searchParams.get("id") || "").trim();
      if (pad) return json(res, publicSoundboardState(pad));
      if (accept.includes("text/html") && !accept.includes("application/json")) {
        return servePublicHtml(res, VITA_SOUNDBOARD_HTML, "vita soundboard");
      }
      // Default HTML for browsers; ?json=1 or accept json for agents.
      if (url.searchParams.get("json") === "1" || accept.includes("application/json")) {
        return json(res, publicSoundboardState());
      }
      return servePublicHtml(res, VITA_SOUNDBOARD_HTML, "vita soundboard");
    }
    if ((path === "/vita/soundboard/play" || path === "/vita/soundboard/play/") && req.method === "GET") {
      return json(res, publicSoundboardPlay(String(url.searchParams.get("id") || url.searchParams.get("pad") || "airhorn")));
    }
    if ((path === "/vita/soundboard/loc" || path === "/vita/soundboard/loc/") && req.method === "GET") {
      const id = String(url.searchParams.get("id") || url.searchParams.get("pad") || "airhorn");
      const g = url.searchParams.get("g") || url.searchParams.get("group") || "1";
      const i = url.searchParams.get("i") || url.searchParams.get("index") || "1";
      return json(res, publicSoundboardLoc(id, i, g));
    }
    if ((path === "/vita/soundboard/locs" || path === "/vita/soundboard/locs/") && req.method === "GET") {
      const id = String(url.searchParams.get("id") || url.searchParams.get("pad") || "airhorn");
      return json(res, await publicSoundboardLocs(id));
    }
    if ((path === "/vita/soundboard/prompt" || path === "/vita/soundboard/prompt/") && req.method === "POST") {
      const body = (await readBody(req)) || {};
      const made = createPromptPad(String(body.prompt || body.recipe || ""), {
        id: body.id || null,
      });
      return json(res, made);
    }
    if ((path === "/vita/soundboard/upload" || path === "/vita/soundboard/upload/") && req.method === "POST") {
      const body = (await readBody(req)) || {};
      const b64 = String(body.bytesBase64 || body.b64 || "");
      if (!b64) return json(res, { ok: false, reason: "bytesBase64 required" }, 400);
      let bytes;
      try {
        bytes = Buffer.from(b64, "base64");
      } catch {
        return json(res, { ok: false, reason: "bad base64" }, 400);
      }
      return json(res, addUploadedPad({
        name: body.name || "upload.wav",
        mime: body.mime || "audio/wav",
        bytes,
        aliases: body.aliases || [],
      }));
    }
    if ((path === "/vita/chain-dir" || path === "/vita/chain-dir/") && req.method === "GET") {
      const accept = String(req.headers.accept || "");
      if (accept.includes("text/html") && !accept.includes("application/json")) {
        return servePublicHtml(res, VITA_CHAIN_DIR_HTML, "vita chain dir");
      }
      const q = String(url.searchParams.get("loc") || url.searchParams.get("tx") || "").trim();
      if (q) return json(res, searchByLocation(q));
      return json(res, publicChainDirState());
    }
    if ((path === "/vita/chain-dir.html" || path === "/vita/chain-dir/ui") && req.method === "GET") {
      return servePublicHtml(res, VITA_CHAIN_DIR_HTML, "vita chain dir");
    }
    if ((path === "/vita/mirror.html" || path === "/vita/mirror/ui") && req.method === "GET") {
      return servePublicHtml(res, VITA_MIRROR_HTML, "vita mirror dual");
    }
    if ((path === "/vita/feed-loader" || path === "/vita/feed-loader/") && req.method === "GET") {
      const accept = String(req.headers.accept || "");
      if (accept.includes("text/html") && !accept.includes("application/json")) {
        return servePublicHtml(res, VITA_FEED_LOADER_HTML, "vita feed loader");
      }
      // Default JSON for agents / fetch() from the animated page.
      const state = loaderPublicState({});
      return json(res, { ok: true, ...state, html: "/vita/feed-loader" });
    }
    if ((path === "/vita/feed-loader.html" || path === "/vita/feed-loader/ui") && req.method === "GET") {
      return servePublicHtml(res, VITA_FEED_LOADER_HTML, "vita feed loader");
    }
    if ((path === "/vita/feed-loader/preload" || path === "/vita/feed-loader/preload/") && req.method === "POST") {
      if (!isAuthorized(req)) return err(res, "unauthorized", 401);
      ensureLoaderMemorySeeds();
      const body = (await readBody(req).catch(() => ({}))) || {};
      const packIds = Array.isArray(body?.packIds) ? body.packIds : null;
      const result = preloadKnowledgePacks({
        packIds,
        includeAll: !packIds?.length,
      });
      return json(res, { ok: true, ...result });
    }
    if ((path === "/vita/feed-library" || path === "/vita/feed-library/") && req.method === "GET") {
      return json(res, {
        ok: true,
        id: "vita-feed-library-v1",
        entries: listLibraryEntries(),
        player: "/vita/feed-player?lib=<n>",
        telegram: ["/vitafeed files", "/vitafeed play <n|name>", "/vitafeed keys"],
      });
    }
    if ((path === "/vita/feed-backlog" || path === "/vita/feed-backlog/") && req.method === "GET") {
      const list = listFeedBacklog({ limit: 40 });
      return json(res, {
        ok: true,
        id: "vita-feed-backlog-v1",
        filingLabel: "FEED_BACKLOG",
        growth: list.growth,
        items: list.items,
        card: formatFeedBacklogCard(list),
        proof: formatFeedBacklogGrowthProof(),
        telegram: [
          "/vitafeed backlog",
          "/vitafeed enqueue seed",
          "/vitafeed next",
          "/vitafeed override",
        ],
        note: "Queue grows offline; drain needs VITAFEED_PAID=yes. Never invents hashes.",
      });
    }
    if ((path === "/vita/feed-backlog/seed" || path === "/vita/feed-backlog/seed/") && req.method === "POST") {
      if (!isAuthorized(req)) return err(res, "unauthorized", 401);
      const seeded = seedFeedBacklogFromMemory({ includeBrainSeed: true, includeTopics: true });
      return json(res, {
        ok: true,
        added: seeded.added,
        skipped: seeded.skipped,
        growth: seeded.growth,
        card: seeded.card,
      });
    }
    // Desk /vita/vitafeed — exact plain body (no BL- id). GET/POST SIM; live needs auth + paid|force.
    if ((path === "/vita/vitafeed" || path === "/vita/vitafeed/") && (req.method === "GET" || req.method === "POST")) {
      const payload = req.method === "POST" ? (await readBody(req) || {}) : {};
      const wantLive = req.method === "POST"
        || url.searchParams.get("live") === "1"
        || url.searchParams.get("live") === "yes"
        || payload.live === true
        || payload.live === "yes"
        || payload.live === 1;
      if (wantLive && !isAuthorized(req)) {
        return err(res, "unauthorized — set x-vita-secret for live vitafeed", 401);
      }
      let body = String(
        url.searchParams.get("body")
        || payload.body
        || payload.text
        || "",
      ).trim();
      const force = url.searchParams.get("force") === "1"
        || url.searchParams.get("force") === "yes"
        || payload.force === true
        || payload.force === "yes"
        || payload.force === 1;
      const out = await runVitaFeedHttp({ body, force, live: wantLive === true });
      return json(res, out, out.ok === false ? 400 : 200);
    }
    if ((path === "/vita/feed-library/play" || path === "/vita/feed-library/play/") && req.method === "GET") {
      const sel = String(url.searchParams.get("lib") || url.searchParams.get("n") || url.searchParams.get("name") || url.searchParams.get("key") || "").trim();
      if (!sel) return err(res, "missing lib|n|name|key");
      const opened = await playFromLibrary(sel, { label: "LIBRARY" });
      if (!opened.ok) return err(res, opened.reason || "open failed", 404);
      return json(res, {
        ok: true,
        n: opened.n,
        entry: opened.entry,
        playerPath: opened.playerPath,
        play: opened.playProof?.play
          ? {
              kind: opened.playProof.play.kind,
              mime: opened.playProof.play.mime,
              name: opened.playProof.play.name,
              dataUrl: opened.playProof.play.dataUrl || null,
              text: opened.playProof.play.text || null,
            }
          : null,
        complete: opened.playProof?.complete === true,
        card: opened.playProof?.card || null,
        locations: opened.playProof?.locations || [],
      });
    }
    if (path === "/vita/client.js" && req.method === "GET") {
      return servePublicFile(res, VITA_CLIENT_JS, "text/javascript; charset=utf-8", "vita client");
    }
    if (path === "/vita/lib/vita-parse.js" && req.method === "GET") {
      return servePublicFile(res, VITA_PARSE_JS, "text/javascript; charset=utf-8", "vita parse");
    }
    if (path === "/vita/lib/xmem.js" && req.method === "GET") {
      return servePublicFile(res, XMEM_JS, "text/javascript; charset=utf-8", "xmem");
    }
    if (path === "/vita/xmem/spec" && req.method === "GET") {
      return json(res, {
        ok: true,
        ...AGENT_SPEC,
        instructions: AGENT_INSTRUCTIONS,
        liveHitch: AGENT_SPEC.liveHitch,
      });
    }
    if (path === "/vita/xmem/decode" && (req.method === "GET" || req.method === "POST")) {
      const body = req.method === "POST" ? (await readBody(req) || {}) : {};
      const utf8 = String(url.searchParams.get("utf8") || body.utf8 || body.text || "");
      const hex = String(url.searchParams.get("hex") || body.hex || "");
      const q = String(url.searchParams.get("q") || url.searchParams.get("query") || body.q || body.query || "");
      if (!utf8 && !hex) return err(res, "missing utf8 or hex");
      const records = extractMemoryRecords(hex || utf8);
      return json(res, retrieveXmem(records, q));
    }
    if (path === "/vita/leftover" && req.method === "GET") {
      try {
        const scan = await getCachedLeftoverScan({ limit: 80, maxPages: 3, wait: false });
        return json(res, { ok: true, ...publicLeftoverScanView(scan) });
      } catch (e) {
        return err(res, "leftover scan failed: " + (e.message || e), 502);
      }
    }
    // Public file open — HTML console click-through (local disk first, no Anthropic)
    if (path === "/vita/read" && req.method === "GET") {
      const filename = url.searchParams.get("f") || url.searchParams.get("file");
      if (!filename) return err(res, "missing ?f=filename");
      const out = await handleVitaMirrorAction({
        action: "read",
        filename,
        cwd: ROOT,
        githubFetch: webhookGithubUtf8,
        codeBranch: liveGithubBranch(),
        stateBranch: liveStateBranch(),
        repo: liveGithubRepo(),
        chatId: "http-read",
      });
      return json(res, {
        ok: out.ok,
        filename: out.filename || filename,
        content: String(out.text || "").slice(0, 50000),
        preview: out.preview || null,
        snark: out.snark || null,
        locations: out.locations || [],
        sessionKey: out.sessionKey
          ? { key: out.sessionKey.key, kind: out.sessionKey.kind, privateKey: false }
          : null,
        zeroProof: out.zeroProof
          ? {
              key: out.zeroProof.key,
              contentCommit: out.zeroProof.contentCommit,
              privateKey: false,
              openSource: true,
            }
          : null,
        local: out.local || false,
        github: out.github || false,
        reply: out.reply,
        neverInventHashes: true,
      }, out.ok ? 200 : 404);
    }
    if ((path === "/vita/mirror" || path === "/vita/mirror/") && req.method === "GET") {
      const cmd = String(url.searchParams.get("cmd") || "").trim();
      const accept = String(req.headers.accept || "");
      if (!cmd && !url.searchParams.get("action") && accept.includes("text/html") && !accept.includes("application/json")) {
        return servePublicHtml(res, VITA_MIRROR_HTML, "vita mirror dual");
      }
      const parsed = cmd
        ? parseVitaMirrorCommand(cmd.startsWith("/") ? cmd : "/vita " + cmd)
        : {
          action: url.searchParams.get("action") || "chain",
          filename: url.searchParams.get("f") || url.searchParams.get("file") || null,
          key: url.searchParams.get("key") || null,
          kind: url.searchParams.get("kind") || null,
          pathMode: url.searchParams.get("path") || url.searchParams.get("pathMode") || null,
          prefix: url.searchParams.get("prefix") || null,
          sectionId: url.searchParams.get("section") || null,
          exportName: url.searchParams.get("export") || null,
        };
      const action = parsed.action && parsed.action !== "ask" ? parsed.action : "chain";
      const out = await handleVitaMirrorAction({
        action,
        filename: parsed.filename || null,
        key: parsed.key || null,
        kind: parsed.kind || null,
        modelId: parsed.modelId || null,
        pathMode: parsed.pathMode || null,
        prefix: parsed.prefix || null,
        sectionId: parsed.sectionId || null,
        exportName: parsed.exportName || null,
        cwd: ROOT,
        githubFetch: webhookGithubUtf8,
        codeBranch: liveGithubBranch(),
        stateBranch: liveStateBranch(),
        repo: liveGithubRepo(),
        chatId: "http-mirror",
        fetchCalldata: fetchTxCalldataHex,
      });
      return json(res, {
        ok: out.ok,
        action,
        filename: out.filename || parsed.filename || null,
        reply: out.reply,
        preview: out.preview || null,
        snark: out.snark || null,
        locations: out.locations || [],
        sessionKey: out.sessionKey
          ? { key: out.sessionKey.key, kind: out.sessionKey.kind, privateKey: false }
          : null,
        zeroProof: out.zeroProof
          ? {
              key: out.zeroProof.key,
              contentCommit: out.zeroProof.contentCommit,
              privateKey: false,
              openSource: true,
            }
          : null,
        followLeader: out.followLeader || null,
        availability: out.availability || undefined,
        proven: out.proven || undefined,
        tree: out.tree || undefined,
        pathMode: out.pathMode || parsed.pathMode || null,
        files: out.files || undefined,
        exists: out.exists,
        local: out.local,
        github: out.github,
        neverInventHashes: true,
      }, out.ok ? 200 : 404);
    }
    // Public systems check — blockchain layer reminder (grows memory/strands)
    if ((path === "/vita/check" || path === "/vita/check/") && req.method === "GET") {
      const out = await handleChainLayerAction({
        action: "check",
        cwd: ROOT,
        write: true,
        env: process.env,
        fetchCalldata: fetchTxCalldataHex,
      });
      return json(res, {
        ok: out.ok,
        action: "check",
        reply: out.reply,
        snark: out.snark || null,
        locations: out.locations || [],
        inject: out.inject
          ? {
              totalChunks: out.inject.totalChunks,
              sealedCount: out.inject.sealedCount,
              pendingCount: out.inject.pendingCount,
              verifiedCount: out.inject.verifiedCount || 0,
              maxBytes: out.inject.maxBytes,
            }
          : null,
        result: out.result
          ? {
              passed: out.result.passed,
              total: out.result.total,
              recoverMs: out.result.recover?.localRecoverMs,
              agreedModel: out.result.models?.agreed,
              llmCommit: out.result.llm?.contentCommit,
              growth: out.result.growth,
              snarkLocalOnly: out.result.snark?.localOnly,
            }
          : null,
        neverInventHashes: true,
        telegram: [
          "/vita check",
          "/vita check locs",
          "/vita check pull",
          "/vita recover",
          "/vita models",
          "/vita llm",
        ],
      }, out.ok ? 200 : 500);
    }
    if ((path === "/vita/wavetest" || path === "/vita/wavetest/") && req.method === "GET") {
      const hitch = String(url.searchParams.get("hitch") || "") === "1"
        || String(url.searchParams.get("action") || "") === "hitch";
      const out = await handleWaveTestAction({
        action: hitch ? "hitch" : "run",
        env: process.env,
      });
      return json(res, {
        ok: out.ok !== false,
        pass: out.pass === true,
        send: false,
        vitafeedPaidDefault: "off",
        waveMirrorPaidDefault: "off",
        motherBrain: "untouched",
        hitch: "attachWaveOnCoveredLeftover when leftover covers on a paired sell",
        telegram: ["/wavetest", "/wavetest hitch"],
        cli: "node scripts/wave-mirror-test.js",
        reply: out.reply,
        result: out.result
          ? {
              pass: out.result.pass,
              sim: out.result.sim,
              live: out.result.live,
              rounds: out.result.rounds,
              totalChunks: out.result.totalChunks,
              contentCommit: out.result.contentCommit,
              answerKey: out.result.answerKey,
              acks: out.result.acks,
              reason: out.result.reason,
            }
          : null,
      });
    }
    if ((path === "/vita/waveproof" || path === "/vita/waveproof/") && (req.method === "GET" || req.method === "POST")) {
      const body = req.method === "POST" ? (await readBody(req) || {}) : {};
      const wantLive = wantsDeskWaveProofLive({
        method: req.method,
        searchParams: url.searchParams,
        body,
      });
      if (wantLive && !isAuthorized(req)) {
        return err(res, "unauthorized — set x-vita-secret or x-vita-webhook-secret", 401);
      }
      return json(res, await runWaveProofHttp({
        live: wantLive === true,
        symbols: String(
          url.searchParams.get("syms")
          || url.searchParams.get("symbols")
          || body.syms
          || body.symbols
          || "",
        ),
      }));
    }
    if ((path === "/vita/wavefull" || path === "/vita/wavefull/") && (req.method === "GET" || req.method === "POST")) {
      const body = req.method === "POST" ? (await readBody(req) || {}) : {};
      const wantLive = wantsDeskWaveFullLive({
        method: req.method,
        searchParams: url.searchParams,
        body,
      });
      if (wantLive && !isAuthorized(req)) {
        return err(res, "unauthorized — set x-vita-secret or x-vita-webhook-secret", 401);
      }
      return json(res, await runWaveFullHttp({
        live: wantLive === true,
        symbols: String(
          url.searchParams.get("syms")
          || url.searchParams.get("symbols")
          || body.syms
          || body.symbols
          || "",
        ),
        vinId: String(url.searchParams.get("vinId") || url.searchParams.get("vin") || body.vinId || body.vin || ""),
        fromIndex: url.searchParams.get("fromIndex") || url.searchParams.get("from") || body.fromIndex || body.from || 0,
        txHashes: body.txHashes || body.hashes || url.searchParams.get("txHashes") || "",
        fresh: body.fresh === true || String(url.searchParams.get("fresh") || body.fresh || "") === "1",
      }));
    }

    if ((path === "/board/health" || path === "/health") && req.method === "GET") {
      return json(res, healthPayload());
    }

    if (path === "/board/api/params" && req.method === "GET") {
      return json(res, readLiveParamSnapshot());
    }

    if (path === "/board/api/inject" && req.method === "GET") {
      const capacity = leftoverHitchCapacity();
      return json(res, {
        ...listV3InjectSurfaces(),
        capacity,
        scoreboard: listOutletScoreboard(),
        hitchDensity: hitchDensityBoard({ leftoverEth: capacity.leftoverEth }),
        vitaRouter: vitaRouterStatus(),
        botPiggy: modelBotUsagePiggy({
          hitchTagUsd: capacity.hitchTagUsd,
          leftoverUsd: capacity.leftoverUsd,
        }),
      });
    }

    if (path === "/board/api/scoreboard" && req.method === "GET") {
      const capacity = leftoverHitchCapacity();
      return json(res, {
        ok: true,
        ...listOutletScoreboard(),
        hitchDensity: hitchDensityBoard({ leftoverEth: capacity.leftoverEth }),
      });
    }

    if (path === "/board/api/v4" && req.method === "GET") {
      return json(res, v4BoardStatus());
    }

    if (path === "/board/api/snapshot" && req.method === "GET") {
      return json(res, boardSnapshotPayload(isAuthorized(req)));
    }

    if (path === "/board/api/sim" && req.method === "POST") {
      const body = await readBody(req);
      return json(res, runBoardSim(body || {}));
    }
    if (path === "/board/api/sim" && req.method === "GET") {
      return json(res, runBoardSim({
        cash: Number(url.searchParams.get("cash")) || 8,
        seat: url.searchParams.get("seat") || "LINK",
        movePct: url.searchParams.get("move") != null
          ? Number(url.searchParams.get("move"))
          : 0.06,
        costEdge: url.searchParams.get("costEdge") !== "no",
      }));
    }

    if (path === "/arena/api/snapshot" && req.method === "GET") {
      if (!isAuthorized(req)) return err(res, "unauthorized — set x-vita-secret", 401);
      const snap = snapshotPayload();
      if (!snap) return err(res, "bot not ready");
      return json(res, snap);
    }

    if (path === "/arena/api/queue" && req.method === "POST") {
      if (!isAuthorized(req)) return err(res, "unauthorized — set x-vita-secret", 401);
      if (!botState?.queueManual) return err(res, "bot not ready");
      const body = await readBody(req);
      const result = botState.queueManual(body);
      return json(res, { ...result, queue: botState.getManualQueue?.() || [] }, result.ok ? 200 : 400);
    }

    if (path === "/engine/api/snapshot" && req.method === "GET") {
      // Auth preferred; without secret return demo so the board still teaches.
      if (isAuthorized(req) && botState?.getEngineSnapshot) {
        return json(res, engineSnapshotPayload());
      }
      if (isAuthorized(req) && botState) {
        return json(res, engineSnapshotPayload());
      }
      if (!getSecret() || !isAuthorized(req)) {
        return json(res, { ...demoEngineSnapshot(), note: "demo — authorize with x-vita-secret for live waves" });
      }
      return json(res, engineSnapshotPayload());
    }

    if (path === "/engine/api/queue" && req.method === "POST") {
      if (!isAuthorized(req)) return err(res, "unauthorized — set x-vita-secret", 401);
      if (!botState?.queueManual) return err(res, "bot not ready");
      const body = await readBody(req);
      const result = botState.queueManual(body);
      return json(res, {
        ...result,
        queue: botState.getManualQueue?.() || [],
        engine: true,
      }, result.ok ? 200 : 400);
    }

    // Public HTML/JS for the VITA console. JSON /vita/router etc. still require auth.
    if (!isAuthorized(req)) return err(res, "unauthorized", 401);

    // ── GET /vita/router — secondary hitch switch + loc squash (no bot required)
    if (path === "/vita/router" && req.method === "GET") {
      return json(res, { ok: true, ...vitaRouterStatus() });

    } else if (path === "/vita/locations" && req.method === "GET") {
      return json(res, { ok: true, ...locDepositoryStatus() });

    } else if (path === "/vita/course" && req.method === "GET") {
      let leftoverKinds;
      let leftoverHitchBytes;
      try {
        const scan = await getCachedLeftoverScan({ limit: 80, maxPages: 3 });
        if (!isPendingLeftoverScan(scan)) {
          leftoverKinds = scan.counts || scan.leftoverKinds;
          leftoverHitchBytes = scan.hitchBytes || scan.leftoverHitchBytes;
        }
      } catch { leftoverKinds = undefined; leftoverHitchBytes = undefined; }
      const course = leftoverKinds
        ? evaluateVitaCourse({ leftoverKinds, leftoverHitchBytes })
        : evaluateVitaCourse();
      return json(res, { ok: true, ...course, telegram: formatCourseMessage(course) });

    } else if (path === "/vita/inject" && req.method === "GET") {
      return json(res, { ok: true, ...buildVitaInjectContext() });

    } else if (path === "/vita/brain" && req.method === "GET") {
      const loc = locDepositoryStatus();
      const quality = vitaQuality(getLastVitaPacket() || "");
      const status = buildBrainStatus({
        hasKey: quality.hasKey,
        sealedCount: loc.sealed ?? 0,
        tapeCount: getHypothesisGraph().length,
        judgeLessons: getHypothesisGraph().filter((h) => h.status === "failed").length,
        burstAlign: 0,
        provenanceNote: `§LOC§ ${loc.token || "?"}`,
      });
      return json(res, {
        ok: true,
        ...status,
        hypotheses: getHypothesisGraph().slice(-20).map((h) => ({
          ...h,
          xmem: hypothesisToXmem(h),
        })),
      });

    } else if (path === "/vita/hypotheses" && req.method === "GET") {
      const q = String(url.searchParams.get("q") || "").trim();
      const status = url.searchParams.get("status") || null;
      const symbol = url.searchParams.get("symbol") || null;
      const regime = url.searchParams.get("regime") || null;
      const rows = queryHypotheses({ q, status, symbol, regime, limit: 40 });
      return json(res, {
        ok: true,
        count: rows.length,
        hypotheses: rows.map((h) => ({ ...h, xmem: hypothesisToXmem(h) })),
      });

    } else if (path === "/vita/xmem" && req.method === "GET") {
      const q = String(url.searchParams.get("q") || url.searchParams.get("query") || "").trim();
      try {
        const scan = await getCachedLeftoverScan({ limit: 80, maxPages: 3 });
        if (isPendingLeftoverScan(scan)) {
          return json(res, { ok: true, protocol: "x402", found: false, scanning: true, count: 0, records: [] });
        }
        return json(res, retrieveXmem(scan.xmemRecords || [], q, { protocol: "x402" }));
      } catch (e) {
        return err(res, "xmem scan failed: " + (e.message || e), 502);
      }

    } else if (path === "/vita/pull" && req.method === "GET") {
      const tx = String(url.searchParams.get("tx") || url.searchParams.get("hash") || "").trim();
      const result = await pullLocationFromChain(tx, fetchTxCalldataHex);
      return json(res, result, result.ok ? 200 : 400);

    // ── GET /vita/context — compressed memory for new Claude session ────────
    } else if (path === "/vita/context" && req.method === "GET") {
      const inject = buildVitaInjectContext();
      let registry = {};
      if (botState?.githubGet) {
        try {
          const rf = await botState.githubGet("vita-registry.json");
          if (rf?.content) registry = rf.content;
        } catch {}
      }

      const entries  = Object.entries(registry);
      const recent   = entries.slice(-3).reverse();

      const context  = [
        inject.context,
        "",
        "RECENT SESSIONS (" + recent.length + " of " + entries.length + " total):",
        ...recent.map(([key, val]) =>
          "\n[" + key + "]\n" + (val.tokenPacket || val.label || "no content")
        ),
        "",
        "ALL SESSIONS IN REGISTRY:",
        ...entries.map(([key]) => "- " + key),
        "═══════════════════════════════════════════════════════════════════",
      ].join("\n");

      json(res, {
        ok: true,
        sessionCount: entries.length,
        inject,
        context,
        registry: Object.fromEntries(recent),
      });

    // ── GET /vita/registry — full registry ──────────────────────────────────
    } else if (path === "/vita/registry" && req.method === "GET") {
      if (!botState?.githubGet) return err(res, "bot not ready");
      const rf = await botState.githubGet("vita-registry.json");
      json(res, { ok: true, registry: rf?.content || {} });

    // ── GET /vita/status — live bot status ───────────────────────────────────
    } else if (path === "/vita/status" && req.method === "GET") {
      if (!botState) return err(res, "bot not ready");
      json(res, {
        ok:         true,
        running:    true,
        trades:     botState.tradeCount || 0,
        piggy:      botState.piggyBank  || 0,
        drawdown:   botState.drawdownHaltActive || false,
        positions:  botState.positions  || [],
        favorite:   botState.favorite || "LINK",
        injectMains: botState.injectMains || [],
        timestamp:  new Date().toISOString(),
      });

    // ── GET /vita/ping ────────────────────────────────────────────────────────
    } else if (path === "/vita/ping") {
      json(res, { ok: true, vita: "alive", timestamp: new Date().toISOString() });

    // ── POST /vita/save — advertised programmatic vitasave. Never broadcasts.
    // n5557–5566 was Telegram `/vitasave` → vitaSave. This endpoint banks hex.
    } else if (path === "/vita/save" && req.method === "POST") {
      const body = await readBody(req) || {};
      const text = String(body.text || body.summary || body.note || "webhook-vitasave");
      const wrapped = wrapVitaSaveSelfCall({
        text,
        pairedUniswapSell: false,
        topic: "vitasave-webhook",
      });
      json(res, {
        ok: true,
        banked: wrapped.banked === true,
        hitch: wrapped.hitch === true,
        send: false,
        txHash: null,
        reason: wrapped.reason,
        note: "POST /vita/save banks unpaired [VITA:/STORE. Telegram /vitasave same wrap. Set VITA_AUTO_INSCRIBE=yes to restore mother-brain vitaSave.",
      });

    } else {
      err(res, "unknown endpoint: " + path, 404);
    }

  } catch (e) {
    console.log("⚠️  VITA webhook error: " + e.message);
    err(res, e.message, httpStatusForError(e));
  }
}

export function createVitaServer() {
  return createServer((req, res) => {
    handleVitaRequest(req, res).catch((e) => {
      console.log("⚠️  VITA webhook error: " + e.message);
      try { err(res, e.message, httpStatusForError(e)); } catch { /* headers already sent */ }
    });
  });
}

// ── Server ────────────────────────────────────────────────────────────────────
export function startVitaWebhook() {
  const SECRET = getSecret();
  if (!SECRET) {
    console.log("⚠️  VITA webhook: VITA_WEBHOOK_SECRET not set — webhook disabled");
    return;
  }

  if (webhookBound) {
    console.log("🌐 VITA webhook already bound — skip rebind");
    return;
  }

  const PORT = listenPort();
  const server = createVitaServer();

  server.on("error", (e) => {
    handleWebhookListenError(e, PORT);
  });

  server.listen(PORT, () => {
    webhookBound = true;
    console.log("🌐 VITA webhook listening on port " + PORT);
    console.log("   /board          — Control Board hub (waves + arena learn + V4 docs)");
    console.log("   /board/health   — mounted boards");
    console.log("   /arena          — Guardian Arena ledger game (public HTML)");
    console.log("   /engine         — Guardian Engine wave / surfer / hitch board");
    console.log("   /v4             — V4 offshoot docs (separate process — does not start V4)");
    console.log("   /vita           — VITA HTML console (Telegram twin, public)");
    console.log("   /arena/api/*    — live snapshot + command queue (auth)");
    console.log("   /engine/api/*   — engine waves + ride/trick/message queue (auth)");
    console.log("   /vita/context  — memory context for new Claude session");
    console.log("   /vita/registry — full filing registry");
    console.log("   /vita/router   — secondary hitch router (vita parse + loc squash)");
    console.log("   /vita/locations — squashed location depository");
    console.log("   /vita/waveproof — WAVE 3-token proof (GET SIM; POST/?live=1 auth live)");
    console.log("   /vita/wavefull  — WAVE 28-shard quote (GET SIM; POST/?live=1 auth live)");
    console.log("   /vita/vitafeed  — exact plain feed (GET SIM; POST live+force auth)");
    console.log("   /vita/leftover — public leftover hitch scan (hashes + class)");
    console.log("   /vita/xmem/spec — XMEM v1 agent spec (public)");
    console.log("   /vita/xmem     — x402 wallet memory search (auth)");
    console.log("   /vita/course   — hourly inject-without-loss scorecard");
    console.log("   /vita/inject   — recursive §TOKEN§ memory for session start");
    console.log("   /vita/brain    — six-lobe brain + finetune hypothesis graph");
    console.log("   /vita/hypotheses — query hypothesis graph");
    console.log("   /vita/read     — public open files (local + GitHub CODE/STATE, SNARK + IDM)");
    console.log("   /vita/mirror   — dual-path tree/read/boot + HTML UI (/vita/mirror.html)");
    console.log("   /vita/check    — blockchain systems check (SNARK + EVM recover + models + LLM spin)");
    console.log("   /vita/status   — live bot status");
    console.log("   /vita/save     — programmatic vitasave (auth; banks unpaired STORE)");
  });

  return server;
}
