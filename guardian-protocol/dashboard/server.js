/**
 * Lightweight observability dashboard (Sprint 2).
 * Serves JSON APIs + a single HTML page. No production claims.
 */
import { createServer } from "node:http";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildLeaderboards, paretoFrontier } from "../arena/scoring/leaderboard.js";
import { listStrategies } from "../simulator/strategies/registry.js";
import "../strategies/load-all.js";
import { listAdapterStubs } from "../protocols/adapters/index.js";
import { ReplayViewer } from "../simulator/core/replay-viewer.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const reportsDir = join(root, "arena/reports");
const publicDir = join(__dirname, "public");

function loadReports() {
  if (!existsSync(reportsDir)) return [];
  return readdirSync(reportsDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        return JSON.parse(readFileSync(join(reportsDir, f), "utf8"));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function systemSnapshot(reports) {
  const latest = reports[0] ?? null;
  return {
    preserved_objects: reports.filter((r) => r?.RESULT?.exact_match).length,
    report_count: reports.length,
    strategies_registered: listStrategies(),
    treasury: latest?.TREASURY ?? null,
    storage: latest?.STORAGE ?? null,
    adapters: listAdapterStubs(),
    kind: "simulated_dashboard",
  };
}

function htmlPage() {
  const path = join(publicDir, "index.html");
  if (existsSync(path)) return readFileSync(path, "utf8");
  return "<!doctype html><title>Guardian Arena</title><p>Missing public/index.html</p>";
}

export function createDashboardServer({ port = 8787 } = {}) {
  const server = createServer((req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const send = (code, body, type = "application/json") => {
      const payload = typeof body === "string" ? body : JSON.stringify(body, null, 2);
      res.writeHead(code, {
        "content-type": `${type}; charset=utf-8`,
        "cache-control": "no-store",
      });
      res.end(payload);
    };

    try {
      if (url.pathname === "/" || url.pathname === "/index.html") {
        return send(200, htmlPage(), "text/html");
      }
      const reports = loadReports();
      if (url.pathname === "/api/system") return send(200, systemSnapshot(reports));
      if (url.pathname === "/api/reports") {
        return send(
          200,
          reports.map((r) => ({
            strategy: r.STRATEGY ?? r.BENCHMARK_META?.strategy,
            exact_match: r.RESULT?.exact_match,
            cost: r.ECONOMICS?.simulated_cost,
            replay_hash: r.TRACE?.replay_hash,
            status: r.STATUS,
          }))
        );
      }
      if (url.pathname === "/api/leaderboard") {
        return send(200, {
          boards: buildLeaderboards(reports),
          pareto: paretoFrontier(reports),
        });
      }
      if (url.pathname.startsWith("/api/replay/")) {
        const name = decodeURIComponent(url.pathname.slice("/api/replay/".length));
        const file = join(reportsDir, name.endsWith(".json") ? name : `${name}.json`);
        if (!existsSync(file)) return send(404, { error: "report not found" });
        const report = JSON.parse(readFileSync(file, "utf8"));
        const viewer = ReplayViewer.fromReport(report);
        return send(200, {
          strategy: report.STRATEGY,
          length: viewer.length,
          events: viewer.events,
          inspect_first: (() => {
            viewer.jump(0);
            return viewer.inspect();
          })(),
        });
      }
      if (url.pathname === "/api/strategies") return send(200, { strategies: listStrategies() });
      if (url.pathname === "/api/adapters") return send(200, { adapters: listAdapterStubs() });
      return send(404, { error: "not found" });
    } catch (err) {
      return send(500, { error: String(err?.message || err) });
    }
  });

  return {
    listen: () =>
      new Promise((resolve) => {
        server.listen(port, () => resolve({ port, url: `http://127.0.0.1:${port}` }));
      }),
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
    server,
  };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const port = Number(process.env.PORT || 8787);
  const dash = createDashboardServer({ port });
  const info = await dash.listen();
  console.log(`Guardian Arena dashboard (simulated) → ${info.url}`);
}
