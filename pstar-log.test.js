import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pstarObserve, pstarCycle, pstarSnapshot, pstarBoardField, realizedVol, classifyBand,
  tierNetUsd, resetPstar, setPstarBands, pstarEnabled, pstarTick, pstarMetaFromTokens, PSTAR_SPEC,
} from "./pstar-log.js";
import { recordPriceInto } from "./history-slot.js";

const BAR = PSTAR_SPEC.barMs;

test("PSTAR_LOG defaults on, can be disabled", () => {
  assert.equal(pstarEnabled({}), true);
  assert.equal(pstarEnabled({ PSTAR_LOG: "yes" }), true);
  for (const v of ["no", "0", "off", "false"]) assert.equal(pstarEnabled({ PSTAR_LOG: v }), false);
});

test("realizedVol: 24h-scaled stdev, warming flag", () => {
  assert.equal(realizedVol([1, 1.01]).p, null);
  const closes = [100];
  for (let i = 0; i < 120; i++) closes.push(closes[closes.length - 1] * (i % 2 ? 1.01 : 1 / 1.01));
  const v = realizedVol(closes);
  assert.equal(v.warming, false);
  assert.equal(v.n, 96);
  // alternating ±ln(1.01): stdev ≈ 0.00995*sqrt(96/95)
  assert.ok(Math.abs(v.p - Math.log(1.01) * Math.sqrt(96 / 95) * Math.sqrt(96)) < 1e-6);
});

test("classifyBand uses measured chop band when present, else prereg", () => {
  resetPstar();
  assert.equal(classifyBand(0.10).cls, "inside");
  assert.equal(classifyBand(0.075).cls, "edge");
  assert.equal(classifyBand(0.30).cls, "outside");
  assert.equal(classifyBand(0.30).side, "above");
  setPstarBands({ measured: { pstar: 0.05, chop: [0.04, 0.06] } });
  assert.equal(classifyBand(0.05).cls, "inside");
  assert.equal(classifyBand(0.10).cls, "outside");
  assert.equal(classifyBand(null).cls, "unknown");
  resetPstar();
});

test("tierNetUsd matches cost model (fee + $0.12 gas + slippage)", () => {
  const n = tierNetUsd(0.031, 1, { fee: 0.006, sigmaBar: 0, liqUsd: Infinity });
  assert.ok(Math.abs(n - (5 * 0.031 - 5 * 0.006 - 0.12)) < 1e-12);
  const n5 = tierNetUsd(0.031, 5, { fee: 0.006, sigmaBar: 0.01, liqUsd: 1e6 });
  const N = 25; const exp = N * 0.031 - N * 0.006 - 0.12 - 2 * N * (0.25 * 0.01 + 2 * N / 1e6);
  assert.ok(Math.abs(n5 - exp) < 1e-12);
});

test("cycle records vol + band + paper outcome; never broadcasts", () => {
  resetPstar();
  let t = Date.UTC(2026, 8, 1);
  let px = 1;
  // 110 bars of chop then a pullback to trigger a paper entry, then a rally to TP
  for (let i = 0; i < 110; i++) {
    px *= i % 2 ? 1.012 : 1 / 1.012;
    pstarObserve("TEST", px, t + i * BAR);
    pstarObserve("TEST", px * 1.001, t + i * BAR + 60_000);
  }
  for (let i = 110; i < 118; i++) { px *= 0.985; pstarObserve("TEST", px, t + i * BAR); }
  let recs = pstarCycle({ now: t + 118 * BAR + 1000 });
  assert.equal(recs.length, 1);
  assert.equal(recs[0].sym, "TEST");
  assert.ok(recs[0].p > 0);
  assert.ok(["inside", "edge", "outside"].includes(recs[0].band));
  const entered = recs[0].event?.type === "paper-entry";
  assert.ok(entered, "pullback+RSI should trigger paper entry");
  for (let i = 118; i < 125; i++) { px *= 1.01; pstarObserve("TEST", px, t + i * BAR); }
  recs = pstarCycle({ now: t + 125 * BAR + 1000 });
  assert.equal(recs[0].event?.type, "paper-exit");
  assert.equal(recs[0].event.reason, "tp");
  const snap = pstarSnapshot();
  assert.equal(snap.paperOnly, true);
  assert.equal(snap.broadcast, false);
  assert.equal(snap.closedPaper.n, 1);
  assert.ok(snap.closedPaper.last[0].net.d5 > snap.closedPaper.last[0].net.d1);
  const board = pstarBoardField();
  assert.equal(board.rows[0].sym, "TEST");
  resetPstar();
});

test("disabled flag records nothing", () => {
  resetPstar();
  assert.equal(pstarObserve("X", 1, Date.now(), { PSTAR_LOG: "no" }), false);
  assert.deepEqual(pstarCycle({ env: { PSTAR_LOG: "no" } }), []);
  assert.equal(pstarSnapshot().records.length, 0);
});

test("module source has no signer / network / env-flip surface", async () => {
  const fs = await import("node:fs");
  const raw = fs.readFileSync(new URL("./pstar-log.js", import.meta.url), "utf8");
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const imports = [...raw.matchAll(/^import .* from "([^"]+)";/gm)].map((m) => m[1]);
  assert.deepEqual(imports.sort(), ["node:fs", "node:path", "node:url"]);
  for (const bad of ["fetch(", "sendTransaction", "writeContract", "signTransaction", "privateKey", "HALT_NEW_ENTRIES =", "VITAFEED_PAID =", "process.env.HALT", "process.env.VITAFEED", "vault", "http"]) {
    assert.ok(!src.includes(bad), `forbidden token ${bad}`);
  }
});

test("history-slot recordPriceInto feeds the paper logger (no file write under test)", () => {
  resetPstar();
  const hist = {};
  const t0 = Date.UTC(2026, 8, 2);
  for (let i = 0; i < 40; i++) recordPriceInto(hist, "HOOK", 1 + (i % 3) * 0.01, t0 + i * BAR);
  assert.equal(hist.HOOK.readings.length, 40);
  const snap = pstarSnapshot();
  assert.ok(snap.cycles > 0);
  assert.equal(snap.latest.HOOK.sym, "HOOK");
  resetPstar();
});

test("pstarTick respects PSTAR_LOG=no and tokens.json meta loads", () => {
  resetPstar();
  assert.equal(pstarTick("A", 1, Date.now(), { PSTAR_LOG: "no" }), false);
  const meta = pstarMetaFromTokens();
  assert.ok(meta.TOSHI && Math.abs(meta.TOSHI.tp - 0.06) < 1e-9);
  assert.ok(meta.AERO && Math.abs(meta.AERO.fee - 0.006) < 1e-9);
  resetPstar();
});

test("history-slot contract unchanged when logger throws or is disabled", () => {
  const prev = process.env.PSTAR_LOG;
  process.env.PSTAR_LOG = "no";
  const hist = {};
  const slot = recordPriceInto(hist, "Z", 2, 1000);
  assert.deepEqual(slot.readings, [{ price: 2, time: 1000 }]);
  assert.equal(slot.lastPrice, 2);
  if (prev === undefined) delete process.env.PSTAR_LOG; else process.env.PSTAR_LOG = prev;
});
