/**
 * HTTP tests for public Control Board routes (no live spend).
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createVitaServer, injectBotState, maybeAutofireWaveProofOnBoot, maybeAutofireWaveFullOnBoot } from "./vita-webhook.js";
import { createWaveSimChain } from "./vita/wave-wrap.js";
import {
  resetWaveProofAutofireLatch,
  resetWaveProofLiveLatch,
} from "./vita/wave-proof.js";
import {
  resetWaveFullAutofireLatch,
  resetWaveFullLiveLatch,
} from "./vita/wave-full.js";
import { classifyWavePhase } from "./engine-board.js";
import { classifySellArmedDisplay } from "./sell-armed-display.js";

let server;
let base;

before(async () => {
  server = createVitaServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  base = `http://127.0.0.1:${port}`;
});

after(async () => {
  if (typeof server.closeAllConnections === "function") server.closeAllConnections();
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
    assert.match(text, /Outlet scoreboard/);
    assert.match(text, /Bot usage piggy/);
    assert.match(text, /\$20\/mo/);
    assert.match(text, /Queue buy ~\$2/);
    assert.match(text, /w\.phase\?\.label \|\| w\.phase\?\.phase/);
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
    assert.match(engine.text, /phase\.PEAK\.hold/);
    assert.match(engine.text, /holdCode/);
    const v4 = await get("/v4");
    assert.equal(v4.res.status, 200);
    assert.match(v4.text, /SEPARATE PROCESS/);
    assert.doesNotMatch(v4.text, /Queue buy/);
    const vita = await get("/vita");
    assert.equal(vita.res.status, 200);
    assert.match(vita.res.headers.get("content-type") || "", /text\/html/);
    assert.match(vita.text, /Talk to/);
    assert.match(vita.text, /plaintext/);
    assert.match(vita.text, /\/inject/);
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
    assert.equal(json.boards.vita.mounted, true);
    assert.equal(json.boards.vita.path, "/vita");
  });

  it("GET /health aliases board health", async () => {
    const { res, json } = await get("/health");
    assert.equal(res.status, 200);
    assert.equal(json.service, "guardian-control-board");
  });

  it("POST /vita/save is auth-gated and never sendTransaction", async () => {
    const res = await fetch(base + "/vita/save", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "SESSION:2026-09-14 WALLET:0x50e1" }),
    });
    const json = await res.json();
    assert.equal(res.status, 401);
    assert.match(json.error || "", /unauthorized/i);
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "vita-webhook.js"), "utf8");
    assert.ok(src.includes("wrapVitaSaveSelfCall"));
    assert.ok(!src.includes("sendTransaction"), "webhook must not broadcast vitasave");
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

  it("GET /board/api/sim uses catalog LINK dust when overrides are omitted", async () => {
    const { res, json } = await get("/board/api/sim?seat=LINK&costEdge=no");
    assert.equal(res.status, 200);
    assert.equal(json.arena.seat, "LINK");
    assert.equal(json.arena.piggyPct, 0.08);
    assert.equal(json.arena.dustFloorUsd, 0.25);
    assert.equal(json.v4, undefined);
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
    assert.equal(json.capacity.source, "demo-assumptions");
    assert.equal(json.botPiggy.kind, "demo|example");
    assert.equal(json.botPiggy.grokNowUsdPerMonth, 20);
    assert.equal(json.botPiggy.grokProUsdPerMonth, 60);
    assert.equal(json.botPiggy.provenRevenue, null);
    assert.equal(json.vitaRouter.kind, "vita-secondary-router");
    assert.equal(json.vitaRouter.mode, "vita");
    assert.equal(json.vitaRouter.loseZero.proveKeepsLoveNote, true);
    assert.equal(json.scoreboard.gameGhost.class, "CUT");
    assert.ok(json.scoreboard.cut.includes("GAME"));
    assert.equal(json.hitchDensity.prefer, "key-loc");
    assert.ok(json.hitchDensity.keyLoc.bytes < json.hitchDensity.eurekaLeftover.bytes);
  });

  it("GET /board/api/scoreboard is public KEEP/CUT/CAUTION without invented P&L", async () => {
    const { res, json } = await get("/board/api/scoreboard");
    assert.equal(res.status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.gameGhost.class, "CUT");
    assert.equal(json.gameGhost.pnlUsd, null);
    assert.ok(json.cut.includes("GAME"));
    assert.equal(json.alwaysPlus.cutClassDoesNotBlockGreenExit, true);
    assert.equal(json.hitchDensity.bagUsd, 3);
    assert.equal(json.v4Deferred, true);
  });

  it("GET /board/api/snapshot demo includes inject + bot piggy and a deferred V4 stub", async () => {
    const { res, json } = await get("/board/api/snapshot");
    assert.equal(res.status, 200);
    assert.equal(json.demo, true);
    assert.ok(json.inject.hitchSurfaces.length >= 10);
    assert.equal(json.scoreboard.gameGhost.class, "CUT");
    assert.equal(json.botPiggy.kind, "demo|example");
    assert.equal(json.v4.deferred, true);
    assert.equal(json.v4.sameProcessAsV3, false);
    assert.equal(json.vitaRouter.kind, "vita-secondary-router");
    assert.ok(Array.isArray(json.engine.waves[0].series));
    assert.ok(json.engine.waves[0].series.length >= 8);
  });

  it("live /engine snapshot paints HOLD FIFO_RED not green SELLING", async () => {
    const prevSecret = process.env.VITA_WEBHOOK_SECRET;
    process.env.VITA_WEBHOOK_SECRET = "desk-test-secret";
    const hold = classifySellArmedDisplay({
      peakWantsSell: true,
      quoterExecutable: true,
      verdict: "HOLD",
      allow: false,
      reason: "LOSE_ZERO: hold sell VIRTUAL leftover after fees ≤ 0 — FIFO red",
    });
    const phase = classifyWavePhase({
      price: 11.6,
      entry: 10,
      rideHigh: 12,
      holding: true,
      sellArmed: hold,
    });
    injectBotState({
      getEngineSnapshot: () => ({
        ok: true,
        demo: false,
        waves: [{
          symbol: "VIRTUAL",
          holding: true,
          price: 11.6,
          series: [10, 11, 12, 11.6],
          phase,
          sellArmed: hold,
        }],
      }),
    });
    try {
      const res = await fetch(base + "/engine/api/snapshot", {
        headers: { "x-vita-secret": "desk-test-secret" },
      });
      const json = await res.json();
      assert.equal(res.status, 200);
      assert.equal(json.demo, false);
      assert.equal(json.waves[0].symbol, "VIRTUAL");
      assert.equal(json.waves[0].phase.label, "HOLD FIFO_RED");
      assert.equal(json.waves[0].phase.armed, false);
      assert.equal(json.waves[0].sellArmed.green, false);
      assert.notEqual(json.waves[0].phase.label, "SELLING");
    } finally {
      injectBotState(null);
      if (prevSecret == null) delete process.env.VITA_WEBHOOK_SECRET;
      else process.env.VITA_WEBHOOK_SECRET = prevSecret;
    }
  });

  it("POST /board/api/sim rejects oversized bodies", async () => {
    const res = await fetch(base + "/board/api/sim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pad: "x".repeat(20_000) }),
    });
    assert.equal(res.status, 413);
  });

  it("live queue still requires auth", async () => {
    const res = await fetch(base + "/arena/api/queue", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "buy", symbol: "LINK", usd: 2 }),
    });
    assert.equal(res.status, 401);
  });

  it("GET /vita/router requires auth and reports vita mode", async () => {
    const open = await get("/vita/router");
    assert.equal(open.res.status, 401);
    const inj = await get("/vita/inject");
    assert.equal(inj.res.status, 401);
  });

  it("GET /vita HTML console and client are public; parse module is the bot parser", async () => {
    const page = await get("/vita");
    assert.equal(page.res.status, 200);
    assert.match(page.text, /VITA Console/);
    assert.match(page.text, /localStorage|HTML until inject|not injected/i);
    const js = await get("/vita/client.js");
    assert.equal(js.res.status, 200);
    assert.match(js.res.headers.get("content-type") || "", /javascript/);
    assert.match(js.text, /handleCommand/);
    assert.match(js.text, /leftover hitch hashes/);
    assert.match(js.text, /fetchLeftoverScanJson/);
    assert.match(js.text, /leftoverScanIncomplete/);
    assert.match(js.text, /scan\.scanning/);
    const parse = await get("/vita/lib/vita-parse.js");
    assert.equal(parse.res.status, 200);
    assert.match(parse.text, /projectLeftoverHitchFields/);
    assert.match(parse.text, /VITA_LOVE_KEY/);
    const xmemLib = await get("/vita/lib/xmem.js");
    assert.equal(xmemLib.res.status, 200);
    assert.match(xmemLib.text, /XMEM\|v1/);
  });

  it("GET /vita/xmem/spec is public agent handoff; decode finds STORE KEY names", async () => {
    const spec = await get("/vita/xmem/spec");
    assert.equal(spec.res.status, 200);
    assert.equal(spec.json.protocol, "XMEM");
    assert.equal(spec.json.version, "v1");
    assert.match(spec.json.instructions, /Do not invent missing values/);
    assert.equal(spec.json.links.x404.includes("unresolved"), true);

    const hitch = "§$STORE§ §KEY§eureka♥Krystian,Kai,Koda§LOC§n=161|t=7cfa|r=d982";
    const decoded = await fetch(base + "/vita/xmem/decode", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ utf8: hitch, q: "koda krystian" }),
    });
    const json = await decoded.json();
    assert.equal(decoded.status, 200);
    assert.equal(json.found, true);
    assert.ok(json.records[0].tags.includes("koda"));
    assert.equal(json.records[0].id, undefined);

    const miss = await fetch(base + "/vita/xmem/decode", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ utf8: hitch, q: "id=does-not-exist" }),
    });
    const missJson = await miss.json();
    assert.equal(missJson.found, false);
    assert.equal(missJson.protocol, "x404");
    assert.equal(missJson.records.length, 0);
  });

  it("GET /vita/wavetest is a public WAVE memory-mirror SIM (no spend)", async () => {
    const { res, json } = await get("/vita/wavetest");
    assert.equal(res.status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.pass, true);
    assert.equal(json.send, false);
    assert.equal(json.vitafeedPaidDefault, "off");
    assert.equal(json.waveMirrorPaidDefault, "off");
    assert.equal(json.motherBrain, "untouched");
    assert.equal(json.result.sim, true);
    assert.ok(json.result.rounds >= 3);
    assert.equal(json.result.acks[0].role, "PING");
    assert.equal(json.result.acks[1].role, "PONG");
    assert.equal(json.result.acks[2].role, "ACK");
    assert.match(json.reply, /PASS/);
  });

  it("GET /vita/waveproof is a public 3-token WAVE proof SIM (no spend)", async () => {
    const { res, json } = await get("/vita/waveproof");
    assert.equal(res.status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.pass, true);
    assert.equal(json.send, false);
    assert.equal(json.live, false);
    assert.equal(json.vitafeedPaidDefault, "off");
    assert.equal(json.waveProofLiveDefault, "off");
    assert.equal(json.motherBrain, "untouched");
    assert.equal(json.maxSends, 3);
    assert.equal(json.result.sim, true);
    assert.equal(json.result.live, false);
    assert.deepEqual(json.result.symbols, ["VIRTUAL", "CLANKER", "AERO"]);
    assert.equal(json.result.txHashes.length, 3);
    assert.equal(json.reconstruct, "PASS");
    assert.ok(json.vinId);
    assert.match(json.reply, /PASS/);
    assert.match(json.reply, /VIRTUAL/);
  });

  it("GET /vita/wavefull is a public 28-shard WAVE quote SIM (no spend)", async () => {
    const { res, json } = await get("/vita/wavefull");
    assert.equal(res.status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.pass, true);
    assert.equal(json.send, false);
    assert.equal(json.live, false);
    assert.equal(json.vitafeedPaidDefault, "off");
    assert.equal(json.waveFullLiveDefault, "off");
    assert.equal(json.waveProofUnchanged, true);
    assert.equal(json.motherBrain, "untouched");
    assert.equal(json.expectedShards, 28);
    assert.equal(json.result.sim, true);
    assert.equal(json.result.live, false);
    assert.equal(json.txHashes.length, 28);
    assert.equal(json.reconstruct, "PASS");
    assert.ok(json.vinId);
    assert.match(json.reply, /PASS/);
  });

  it("POST /vita/waveproof and GET ?live=1 stay 401 without webhook secret", async () => {
    const post = await fetch(base + "/vita/waveproof", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const postJson = await post.json();
    assert.equal(post.status, 401);
    assert.match(postJson.error || "", /unauthorized/i);

    const liveGet = await get("/vita/waveproof?live=1");
    assert.equal(liveGet.res.status, 401);
    assert.match(liveGet.json.error || "", /unauthorized/i);
  });

  it("POST /vita/waveproof with secret + WAVE_PROOF_LIVE runs the capped 3-send batch", async () => {
    const prevSecret = process.env.VITA_WEBHOOK_SECRET;
    const prevLive = process.env.WAVE_PROOF_LIVE;
    const prevPaid = process.env.VITAFEED_PAID;
    const prevAuto = process.env.WAVE_PROOF_AUTOFIRE;
    process.env.VITA_WEBHOOK_SECRET = "desk-test-secret";
    process.env.WAVE_PROOF_LIVE = "yes";
    delete process.env.VITAFEED_PAID;
    delete process.env.WAVE_PROOF_AUTOFIRE;
    resetWaveProofLiveLatch();
    resetWaveProofAutofireLatch();
    const chain = createWaveSimChain();
    injectBotState({
      waveProofLiveContext: async () => ({
        sendTx: chain.sendTx,
        fetchCalldata: chain.fetchCalldata,
        liquidUsd: 10,
        quotes: { gwei: 0.05, ethUsd: 2481 },
      }),
    });
    try {
      const res = await fetch(base + "/vita/waveproof", {
        method: "POST",
        headers: {
          "x-vita-webhook-secret": "desk-test-secret",
          "content-type": "application/json",
        },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      assert.equal(res.status, 200);
      assert.equal(json.ok, true);
      assert.equal(json.live, true);
      assert.equal(json.send, true);
      assert.equal(json.pass, true);
      assert.equal(json.reconstruct, "PASS");
      assert.ok(json.vinId);
      assert.equal(json.txHashes.length, 3);
      assert.equal(json.basescan.length, 3);
      assert.ok(json.txHashes.every((h) => /^0x[0-9a-fA-F]{64}$/.test(h)));
      assert.equal(json.vitafeedPaidDefault, "off");
      assert.equal(json.motherBrain, "untouched");
      assert.equal(process.env.WAVE_PROOF_LIVE, "no");
      assert.equal(process.env.VITAFEED_PAID, undefined);
    } finally {
      injectBotState(null);
      resetWaveProofLiveLatch();
      resetWaveProofAutofireLatch();
      if (prevSecret == null) delete process.env.VITA_WEBHOOK_SECRET;
      else process.env.VITA_WEBHOOK_SECRET = prevSecret;
      if (prevLive == null) delete process.env.WAVE_PROOF_LIVE;
      else process.env.WAVE_PROOF_LIVE = prevLive;
      if (prevPaid == null) delete process.env.VITAFEED_PAID;
      else process.env.VITAFEED_PAID = prevPaid;
      if (prevAuto == null) delete process.env.WAVE_PROOF_AUTOFIRE;
      else process.env.WAVE_PROOF_AUTOFIRE = prevAuto;
    }
  });

  it("WAVE_PROOF_AUTOFIRE on boot fires once then disables; default off", async () => {
    const prevLive = process.env.WAVE_PROOF_LIVE;
    const prevAuto = process.env.WAVE_PROOF_AUTOFIRE;
    const prevPaid = process.env.VITAFEED_PAID;
    resetWaveProofLiveLatch();
    resetWaveProofAutofireLatch();
    const off = await maybeAutofireWaveProofOnBoot({ WAVE_PROOF_LIVE: "yes" });
    assert.equal(off.fired, false);

    const env = { WAVE_PROOF_LIVE: "yes", WAVE_PROOF_AUTOFIRE: "yes" };
    const chain = createWaveSimChain();
    injectBotState({
      waveProofLiveContext: async () => ({
        sendTx: chain.sendTx,
        fetchCalldata: chain.fetchCalldata,
        liquidUsd: 10,
        quotes: { gwei: 0.05, ethUsd: 2481 },
      }),
    });
    try {
      const first = await maybeAutofireWaveProofOnBoot(env);
      assert.equal(first.fired, true);
      assert.equal(first.pass, true);
      assert.equal(first.result.inscribed.txHashes.length, 3);
      assert.equal(env.WAVE_PROOF_AUTOFIRE, "no");
      assert.equal(env.WAVE_PROOF_LIVE, "no");
      assert.equal(process.env.VITAFEED_PAID, prevPaid);

      env.WAVE_PROOF_LIVE = "yes";
      env.WAVE_PROOF_AUTOFIRE = "yes";
      const second = await maybeAutofireWaveProofOnBoot(env);
      assert.equal(second.fired, false);
    } finally {
      injectBotState(null);
      resetWaveProofLiveLatch();
      resetWaveProofAutofireLatch();
      if (prevLive == null) delete process.env.WAVE_PROOF_LIVE;
      else process.env.WAVE_PROOF_LIVE = prevLive;
      if (prevAuto == null) delete process.env.WAVE_PROOF_AUTOFIRE;
      else process.env.WAVE_PROOF_AUTOFIRE = prevAuto;
    }
  });

  it("POST /vita/wavefull and GET ?live=1 stay 401 without webhook secret", async () => {
    const post = await fetch(base + "/vita/wavefull", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const postJson = await post.json();
    assert.equal(post.status, 401);
    assert.match(postJson.error || "", /unauthorized/i);

    const liveGet = await get("/vita/wavefull?live=1");
    assert.equal(liveGet.res.status, 401);
    assert.match(liveGet.json.error || "", /unauthorized/i);
  });

  it("POST /vita/wavefull with secret + WAVE_FULL_LIVE runs the 28-send batch", async () => {
    const prevSecret = process.env.VITA_WEBHOOK_SECRET;
    const prevLive = process.env.WAVE_FULL_LIVE;
    const prevPaid = process.env.VITAFEED_PAID;
    const prevAuto = process.env.WAVE_FULL_AUTOFIRE;
    process.env.VITA_WEBHOOK_SECRET = "desk-test-secret";
    process.env.WAVE_FULL_LIVE = "yes";
    delete process.env.VITAFEED_PAID;
    delete process.env.WAVE_FULL_AUTOFIRE;
    resetWaveFullLiveLatch();
    resetWaveFullAutofireLatch();
    const chain = createWaveSimChain();
    injectBotState({
      waveFullLiveContext: async () => ({
        sendTx: chain.sendTx,
        fetchCalldata: chain.fetchCalldata,
        liquidUsd: 10,
        quotes: { gwei: 0.05, ethUsd: 2481 },
      }),
    });
    try {
      const res = await fetch(base + "/vita/wavefull", {
        method: "POST",
        headers: {
          "x-vita-webhook-secret": "desk-test-secret",
          "content-type": "application/json",
        },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      assert.equal(res.status, 200);
      assert.equal(json.ok, true);
      assert.equal(json.live, true);
      assert.equal(json.send, true);
      assert.equal(json.pass, true);
      assert.equal(json.reconstruct, "PASS");
      assert.ok(json.vinId);
      assert.equal(json.txHashes.length, 28);
      assert.equal(json.basescan.length, 28);
      assert.ok(json.txHashes.every((h) => /^0x[0-9a-fA-F]{64}$/.test(h)));
      assert.equal(json.vitafeedPaidDefault, "off");
      assert.equal(json.waveProofUnchanged, true);
      assert.equal(json.motherBrain, "untouched");
      assert.equal(process.env.WAVE_FULL_LIVE, "no");
      assert.equal(process.env.VITAFEED_PAID, undefined);
    } finally {
      injectBotState(null);
      resetWaveFullLiveLatch();
      resetWaveFullAutofireLatch();
      if (prevSecret == null) delete process.env.VITA_WEBHOOK_SECRET;
      else process.env.VITA_WEBHOOK_SECRET = prevSecret;
      if (prevLive == null) delete process.env.WAVE_FULL_LIVE;
      else process.env.WAVE_FULL_LIVE = prevLive;
      if (prevPaid == null) delete process.env.VITAFEED_PAID;
      else process.env.VITAFEED_PAID = prevPaid;
      if (prevAuto == null) delete process.env.WAVE_FULL_AUTOFIRE;
      else process.env.WAVE_FULL_AUTOFIRE = prevAuto;
    }
  });

  it("WAVE_FULL_AUTOFIRE on boot fires once then disables; default off", async () => {
    const prevLive = process.env.WAVE_FULL_LIVE;
    const prevAuto = process.env.WAVE_FULL_AUTOFIRE;
    const prevPaid = process.env.VITAFEED_PAID;
    resetWaveFullLiveLatch();
    resetWaveFullAutofireLatch();
    const off = await maybeAutofireWaveFullOnBoot({ WAVE_FULL_LIVE: "yes" });
    assert.equal(off.fired, false);

    const env = { WAVE_FULL_LIVE: "yes", WAVE_FULL_AUTOFIRE: "yes" };
    const chain = createWaveSimChain();
    injectBotState({
      waveFullLiveContext: async () => ({
        sendTx: chain.sendTx,
        fetchCalldata: chain.fetchCalldata,
        liquidUsd: 10,
        quotes: { gwei: 0.05, ethUsd: 2481 },
      }),
    });
    try {
      const first = await maybeAutofireWaveFullOnBoot(env);
      assert.equal(first.fired, true);
      assert.equal(first.pass, true);
      assert.equal(first.result.inscribed.txHashes.length, 28);
      assert.equal(env.WAVE_FULL_AUTOFIRE, "no");
      assert.equal(env.WAVE_FULL_LIVE, "no");
      assert.equal(process.env.VITAFEED_PAID, prevPaid);

      env.WAVE_FULL_LIVE = "yes";
      env.WAVE_FULL_AUTOFIRE = "yes";
      const second = await maybeAutofireWaveFullOnBoot(env);
      assert.equal(second.fired, false);
    } finally {
      injectBotState(null);
      resetWaveFullLiveLatch();
      resetWaveFullAutofireLatch();
      if (prevLive == null) delete process.env.WAVE_FULL_LIVE;
      else process.env.WAVE_FULL_LIVE = prevLive;
      if (prevAuto == null) delete process.env.WAVE_FULL_AUTOFIRE;
      else process.env.WAVE_FULL_AUTOFIRE = prevAuto;
    }
  });

  it("POST /vita/wavefull resume continues a partial VIN without a second autofire", async () => {
    const prevSecret = process.env.VITA_WEBHOOK_SECRET;
    const prevLive = process.env.WAVE_FULL_LIVE;
    const prevAuto = process.env.WAVE_FULL_AUTOFIRE;
    const prevRetry = process.env.WAVE_FULL_RETRY_MS;
    const prevTries = process.env.WAVE_FULL_SEND_RETRIES;
    process.env.VITA_WEBHOOK_SECRET = "desk-test-secret";
    process.env.WAVE_FULL_LIVE = "yes";
    process.env.WAVE_FULL_RETRY_MS = "0";
    process.env.WAVE_FULL_SEND_RETRIES = "3";
    delete process.env.WAVE_FULL_AUTOFIRE;
    resetWaveFullLiveLatch();
    resetWaveFullAutofireLatch();
    const chain = createWaveSimChain();
    let sealed = 0;
    const flaky = async (hex) => {
      if (sealed >= 5) throw new Error("Service unavailable");
      sealed += 1;
      return chain.sendTx(hex);
    };
    injectBotState({
      waveFullLiveContext: async () => ({
        sendTx: sealed >= 5 ? chain.sendTx : flaky,
        fetchCalldata: chain.fetchCalldata,
        liquidUsd: 10,
        quotes: { gwei: 0.05, ethUsd: 2481 },
      }),
    });
    try {
      const firstRes = await fetch(base + "/vita/wavefull", {
        method: "POST",
        headers: {
          "x-vita-webhook-secret": "desk-test-secret",
          "content-type": "application/json",
        },
        body: JSON.stringify({ vinId: "VIN-5785B9B4E1" }),
      });
      const first = await firstRes.json();
      assert.equal(firstRes.status, 200);
      assert.equal(first.pass, false);
      assert.equal(first.partial, true);
      assert.equal(first.txHashes.length, 5);
      assert.equal(process.env.WAVE_FULL_LIVE, "yes");
      assert.equal(first.vinId, "VIN-5785B9B4E1");

      injectBotState({
        waveFullLiveContext: async () => ({
          sendTx: chain.sendTx,
          fetchCalldata: chain.fetchCalldata,
          liquidUsd: 10,
          quotes: { gwei: 0.05, ethUsd: 2481 },
        }),
      });
      const resumeRes = await fetch(base + "/vita/wavefull", {
        method: "POST",
        headers: {
          "x-vita-webhook-secret": "desk-test-secret",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          vinId: "VIN-5785B9B4E1",
          fromIndex: 6,
          txHashes: first.txHashes,
        }),
      });
      const resume = await resumeRes.json();
      assert.equal(resumeRes.status, 200);
      assert.equal(resume.pass, true);
      assert.equal(resume.reconstruct, "PASS");
      assert.equal(resume.vinId, "VIN-5785B9B4E1");
      assert.equal(resume.txHashes.length, 28);
      assert.equal(process.env.WAVE_FULL_LIVE, "no");
    } finally {
      injectBotState(null);
      resetWaveFullLiveLatch();
      resetWaveFullAutofireLatch();
      if (prevSecret == null) delete process.env.VITA_WEBHOOK_SECRET;
      else process.env.VITA_WEBHOOK_SECRET = prevSecret;
      if (prevLive == null) delete process.env.WAVE_FULL_LIVE;
      else process.env.WAVE_FULL_LIVE = prevLive;
      if (prevAuto == null) delete process.env.WAVE_FULL_AUTOFIRE;
      else process.env.WAVE_FULL_AUTOFIRE = prevAuto;
      if (prevRetry == null) delete process.env.WAVE_FULL_RETRY_MS;
      else process.env.WAVE_FULL_RETRY_MS = prevRetry;
      if (prevTries == null) delete process.env.WAVE_FULL_SEND_RETRIES;
      else process.env.WAVE_FULL_SEND_RETRIES = prevTries;
    }
  });

  it("GET /vita/leftover is a public leftover hitch scan (hashes + class, no utf8)", { timeout: 25000 }, async () => {
    const first = await get("/vita/leftover");
    assert.equal(first.res.status, 200);
    assert.equal(first.json.ok, true);
    assert.equal(first.json.kind, "vita-leftover-scan");
    assert.equal(typeof first.json.scanning, "boolean");
    if (first.json.scanning) {
      assert.equal(first.json.counts, null);
      assert.equal(first.json.leftoverKinds, null);
      assert.equal(first.json.leftoverStillEureka, null);
      assert.equal(first.json.hitchBytes, null);
    }
    let json = first.json;
    const started = Date.now();
    while (json.scanning && Date.now() - started < 20000) {
      await new Promise((r) => setTimeout(r, 500));
      json = (await get("/vita/leftover")).json;
    }
    if (json.scanning) {
      assert.equal(json.counts, null);
      assert.equal(json.leftoverStillEureka, null);
    } else {
      assert.equal(typeof json.counts.eureka, "number");
      assert.equal(typeof json.counts.vita, "number");
      assert.equal(Array.isArray(json.rows), true);
      assert.equal(json.rows.every((r) => r.utf8 === undefined), true);
      assert.equal(json.xmemRecords, undefined);
      assert.ok(json.rows.length <= 80);
      assert.equal(typeof json.hitchBytes, "object");
      if (json.counts.eureka > 0) {
        assert.ok(json.hitchBytes.eurekaMin > 0);
      }
    }
    const webhookSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "vita-webhook.js"), "utf8");
    assert.ok(webhookSrc.includes("wait: false"), "public leftover scan must not await Blockscout on the injector");
    assert.ok(webhookSrc.includes("isPendingLeftoverScan"), "auth /vita/course must ignore scanning placeholders");
  });
});
