// ═══════════════════════════════════════════════════════════════════════════════
// 🌐 VITA WEBHOOK — HTTP endpoint so Claude can pull memory directly
// ───────────────────────────────────────────────────────────────────────────────
// Runs a tiny HTTP server alongside the trading bot.
// Claude (or any authorized caller) can hit these endpoints:
//
//   GET  /vita/context        — latest compressed memory for new session start
//   GET  /vita/registry       — full filing registry (all sessions)
//   GET  /vita/read?f=FILE    — read any GitHub file VITA has access to
//   GET  /vita/status         — bot status, portfolio, positions
//   POST /vita/save           — trigger vitasave programmatically
//
// Auth: VITA_WEBHOOK_SECRET header must match env var
// All responses: JSON + compressed §TOKEN§ format where applicable
//
// Railway exposes this on a public URL automatically.
// Add to Railway: VITA_WEBHOOK_SECRET = any strong secret you choose
// ═══════════════════════════════════════════════════════════════════════════════

import { createServer } from "http";

const PORT   = process.env.VITA_WEBHOOK_PORT || 3000;
const SECRET = process.env.VITA_WEBHOOK_SECRET;

// ── Auth check ────────────────────────────────────────────────────────────────
function isAuthorized(req) {
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

// ── Handler — injected with live bot state by agent.js ────────────────────────
let botState = null;
export function injectBotState(state) { botState = state; }

// ── Server ────────────────────────────────────────────────────────────────────
export function startVitaWebhook() {
  if (!SECRET) {
    console.log("⚠️  VITA webhook: VITA_WEBHOOK_SECRET not set — webhook disabled");
    return;
  }

  const server = createServer(async (req, res) => {
    // CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "x-vita-secret, authorization");

    if (!isAuthorized(req)) return err(res, "unauthorized", 401);

    const url = new URL(req.url, "http://localhost");
    const path = url.pathname;

    try {
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

        // Build a clean context packet for starting a new Claude conversation
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

        // Security: only allow known files
        const allowed = [
          "agent.js","vault-loader.js","vault-unlock.js","keystore.js",
          "memory-engine.js","vita-memory.js","log-formatter.js","encryptkey.js",
          "vita-registry.json","memory-registry.json",
          "ledger.json","positions.json","tokens.json","vita-registry.json",
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
      err(res, e.message, 500);
    }
  });

  server.listen(PORT, () => {
    console.log("🌐 VITA webhook listening on port " + PORT);
    console.log("   /vita/context  — memory context for new Claude session");
    console.log("   /vita/registry — full filing registry");
    console.log("   /vita/read     — read GitHub files");
    console.log("   /vita/status   — live bot status");
  });

  return server;
}
