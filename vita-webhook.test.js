/**
 * HTTP tests for public Control Board routes (no live spend).
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createVitaServer } from "./vita-webhook.js";

let server;
let base;

before(async () => {
  server = createVitaServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  base = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
});

async function get(path) {
  const res = await fetch(base + path);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* html */ }
  return { res, text, json };
}

describe("control board HTTP", () => {
  it("GET /board returns 200 HTML hub", async () => {
    const { res, text } = await get("/board");
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") || "", /text\/html/);
    assert.match(text, /Control Board/);
    assert.match(text, /SIM/);
    assert.match(text, /V3 hitch surfaces/);
    assert.match(text, /Bot usage piggy/);
    assert.match(text, /\$20\/mo/);
    assert.match(text, /Queue buy ~\$2/);
    assert.doesNotMatch(text, /encode V4/);
  });

  it("GET / stays Arena; /arena /engine unchanged; /board and /v4 are additive", async () => {
    const root = await get("/");
    assert.equal(root.res.status, 200);
    assert.match(root.text, /Guardian Arena/);
    const arena = await get("/arena");
    assert.equal(arena.res.status, 200);
    assert.match(arena.text, /Guardian Arena/);
    const engine = await get("/engine");
    assert.equal(engine.res.status, 200);
    assert.match(engine.text, /Guardian Engine/);
    const v4 = await get("/v4");
    assert.equal(v4.res.status, 200);
    assert.match(v4.text, /SEPARATE PROCESS/);
    assert.doesNotMatch(v4.text, /Queue buy/);
  });

  it("GET /board/health lists mounted boards", async () => {
    const { res, json } = await get("/board/health");
    assert.equal(res.status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.boards.board.mounted, true);
    assert.equal(json.boards.arena.mounted, true);
    assert.equal(json.boards.engine.mounted, true);
    assert.equal(json.boards.v4.sameProcess, false);
    assert.equal(json.boards.v4.loadsV4Runtime, false);
  });

  it("GET /health aliases board health", async () => {
    const { res, json } = await get("/health");
    assert.equal(res.status, 200);
    assert.equal(json.service, "guardian-control-board");
  });

  it("GET /board/api/params is public read-only", async () => {
    const { res, json } = await get("/board/api/params");
    assert.equal(res.status, 200);
    assert.equal(json.writable, false);
    assert.equal(json.loseZeroRules.neverSellUnderwater, true);
  });

  it("GET /board/api/v4 documents separate process and does not encode swaps", async () => {
    const { res, json } = await get("/board/api/v4");
    assert.equal(res.status, 200);
    assert.equal(json.startableFromThisWebhook, false);
    assert.equal(json.encodesV4Swaps, false);
    assert.equal(json.loadsV4Runtime, false);
    assert.ok(json.start.loop.includes("start:v4"));
    assert.ok(json.catalog.total >= 1);
  });

  it("POST /board/api/sim is labeled practice (no auth, no spend)", async () => {
    const res = await fetch(base + "/board/api/sim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cash: 8, seat: "LINK", movePct: -0.02, costEdge: false }),
    });
    const json = await res.json();
    assert.equal(res.status, 200);
    assert.match(json.kind, /simulated/);
    assert.equal(json.arena.sold, false);
    assert.equal(json.arena.loseZeroHeld, true);
    assert.equal(json.v4, undefined);
    assert.match(json.label, /does not encode V4/);
    assert.equal(json.botPiggy.kind, "demo|example");
    assert.equal(json.botPiggy.provenRevenue, null);
  });

  it("GET /board/api/inject lists V3 hitch surfaces + leftover capacity + demo bot piggy", async () => {
    const { res, json } = await get("/board/api/inject");
    assert.equal(res.status, 200);
    assert.equal(json.kind, "v3-uniswap-inject-surfaces");
    assert.equal(json.favorite, "LINK");
    assert.ok(json.hitchSurfaces.some((t) => t.symbol === "LINK" && t.injectMain));
    assert.ok(json.hitchSurfaces.some((t) => t.symbol === "TOSHI"));
    assert.equal(json.hitchSurfaces.some((t) => t.symbol === "CBBTC"), false);
    assert.ok(json.capacity);
    assert.match(json.capacity.kind, /estimated|simulated/);
    assert.equal(json.botPiggy.kind, "demo|example");
    assert.equal(json.botPiggy.grokNowUsdPerMonth, 20);
    assert.equal(json.botPiggy.grokProUsdPerMonth, 60);
    assert.equal(json.botPiggy.provenRevenue, null);
  });

  it("GET /board/api/snapshot demo includes inject + bot piggy and a deferred V4 stub", async () => {
    const { res, json } = await get("/board/api/snapshot");
    assert.equal(res.status, 200);
    assert.equal(json.demo, true);
    assert.ok(json.inject.hitchSurfaces.length >= 10);
    assert.equal(json.botPiggy.kind, "demo|example");
    assert.equal(json.v4.deferred, true);
    assert.equal(json.v4.sameProcessAsV3, false);
  });

  it("live queue still requires auth", async () => {
    const res = await fetch(base + "/arena/api/queue", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "buy", symbol: "LINK", usd: 2 }),
    });
    assert.equal(res.status, 401);
  });
});
