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
//   GET  /v4                  — V4 docs only (deferred — not this runtime)
//   GET  /arena               — Guardian Arena HTML (public learning board)
//   GET  /                  — same as /arena (original live path)
//   GET  /arena/api/snapshot  — live ledger snapshot (auth)
//   POST /arena/api/queue     — queue Telegram-equivalent commands (auth)
//   GET  /engine              — Guardian Engine HTML (wave / surfer / hitch board)
//   GET  /engine/api/snapshot — live engine waves + costs + piggy lights (auth)
//   POST /engine/api/queue    — ride / trick / message / surfer commands (auth)
//   GET  /vita/context        — latest compressed memory for new session start
//   GET  /vita/registry       — full filing registry (all sessions)
//   GET  /vita/read?f=FILE    — read any GitHub file VITA has access to
//   GET  /vita/status         — bot status, portfolio, positions
//   POST /vita/save           — trigger vitasave programmatically
//
// Auth: VITA_WEBHOOK_SECRET header must match env var
// Public HTML + /board/health + demo/sim APIs do not require the secret.
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
  modelBotUsagePiggy,
  readLiveParamSnapshot,
  runBoardSim,
  boardWaveTile,
  v4BoardStatus,
} from "./board-control.js";

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

// ── Auth check ────────────────────────────────────────────────────────────────
function isAuthorized(req) {
  const SECRET = getSecret();
  if (!SECRET) return false; // no secret set = locked
  const header = req.headers["x-vita-secret"] || req.headers["authorization"];
  return header === SECRET || header === "Bearer " + SECRET;
}

function json(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data, null, 2));
}

function err(res, msg, status = 400) {
  json(res, { error: msg }, status);
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

async function servePublicHtml(res, filePath, label) {
  try {
    const html = await readFile(filePath, "utf8");
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(html);
  } catch (e) {
    err(res, `${label} html missing: ` + e.message, 500);
  }
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
      telegram: ["/status", "/bank", "/piggy", "/tiers", "/buy LINK 2", "/sellhalf UNI"],
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
  if (!authorized || !botState) {
    return { ...demo, note: "demo — authorize with x-vita-secret for live waves / ledger" };
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
  res.setHeader("Access-Control-Allow-Headers", "x-vita-secret, authorization, content-type");
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
        botPiggy: modelBotUsagePiggy({
          hitchTagUsd: capacity.hitchTagUsd,
          leftoverUsd: capacity.leftoverUsd,
        }),
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

    // Everything under /vita/* still requires auth
    if (!isAuthorized(req)) return err(res, "unauthorized", 401);

    // ── GET /vita/context — compressed memory for new Claude session ────────
    if (path === "/vita/context" && req.method === "GET") {
      if (!botState?.githubGet) return err(res, "bot not ready");

      let registry = {};
      try {
        const rf = await botState.githubGet("vita-registry.json");
        if (rf?.content) registry = rf.content;
      } catch {}

      const entries  = Object.entries(registry);
      const recent   = entries.slice(-3).reverse();

      const context  = [
        "═══ VITA MEMORY CONTEXT — paste this to start any new session ═══",
        "Generated: " + new Date().toISOString(),
        "Wallet: " + (botState.walletAddress || "unknown"),
        "Repo: " + (process.env.GITHUB_REPO || "unknown"),
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
        context,
        registry: Object.fromEntries(recent),
      });

    // ── GET /vita/registry — full registry ──────────────────────────────────
    } else if (path === "/vita/registry" && req.method === "GET") {
      if (!botState?.githubGet) return err(res, "bot not ready");
      const rf = await botState.githubGet("vita-registry.json");
      json(res, { ok: true, registry: rf?.content || {} });

    // ── GET /vita/read — read any GitHub file ────────────────────────────────
    } else if (path === "/vita/read" && req.method === "GET") {
      if (!botState?.githubGet) return err(res, "bot not ready");
      const filename = url.searchParams.get("f");
      if (!filename) return err(res, "missing ?f=filename");

      const allowed = [
        "agent.js","vault-loader.js","vault-unlock.js","keystore.js",
        "memory-engine.js","vita-memory.js","log-formatter.js","encryptkey.js",
        "vita-registry.json","memory-registry.json",
        "ledger.json","positions.json","tokens.json","vita-registry.json",
        "engine-board.js","peak-ride.js","second-inject.js","piggy-bank.js",
        "board-control.js","BOARD.md",
      ];
      if (!allowed.includes(filename)) return err(res, "file not in allowed list");

      const file = await botState.githubGet(filename);
      const content = typeof file?.content === "string"
        ? file.content
        : JSON.stringify(file?.content || {}, null, 2);

      json(res, { ok: true, filename, content: content.slice(0, 50000) });

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
    console.log("   /arena/api/*    — live snapshot + command queue (auth)");
    console.log("   /engine/api/*   — engine waves + ride/trick/message queue (auth)");
    console.log("   /vita/context  — memory context for new Claude session");
    console.log("   /vita/registry — full filing registry");
    console.log("   /vita/read     — read GitHub files");
    console.log("   /vita/status   — live bot status");
  });

  return server;
}
