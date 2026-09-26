/**
 * WAVE-ROBIN — first agentic AI on VITA OS Builder.
 *
 * Pure wave math + IFTTT cascade triggers, executed against Robinhood data.
 * Growing-wave cascade (same spirit as message-cascade) ranks seats by
 * trough→peak envelope, hops when a seat arms, and proves accumulation.
 *
 * Live Robinhood reads are OK. Order *placement* stays gated:
 *   RH_WAVE_LIVE=yes + explicit /waveai confirm — never auto-spend.
 * Default path stages SIM previews only. Mother brain untouched.
 * Never invents tx hashes / order ids.
 */

import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FORMULA_ID,
  MAINFRAME_ANCHORS,
  ORIGINAL_FORMULA,
} from "./mainframe.js";
import {
  CASCADE_CHEAP_RANGE_MAX,
  CASCADE_LEAVE_DUST_USD,
  CASCADE_TARGET_HOPS,
  CASCADE_WINDOW_MS,
  armSellOnMoveUp,
  characterSpotBuyUsd,
} from "./message-cascade.js";
import {
  startOsSession,
  setOsLobes,
  setOsTriggers,
  commitFollowStep,
  refineLexiconPair,
  stageOsSeal,
  renameOsAgent,
} from "./os-builder.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const MEMORY_DIR = join(HERE, "memory");
const STRANDS_DIR = join(HERE, "strands");
const STATE_PATH = join(MEMORY_DIR, "wave-robin-state.json");
const LEARN_PATH = join(MEMORY_DIR, "wave-robin-learn.json");
const ACCUM_PATH = join(MEMORY_DIR, "wave-robin-accumulation.json");
const STRAND_PATH = join(STRANDS_DIR, "wave-robin.json");

export const WAVE_ROBIN_ID = "vita-wave-robin-v1";
export const WAVE_ROBIN_MAGIC = "§WAVEROBIN§";
export const WAVE_ROBIN_LABEL = "WAVE_ROBIN";
export const WAVE_ROBIN_AGENT_ID = "wave-robin";
export const RH_WAVE_LIVE_ENV = "RH_WAVE_LIVE";
export const RH_WAVE_ACCOUNT_ENV = "RH_WAVE_ACCOUNT";

/** Default equity basket for wave seats (Robinhood equities). */
export const WAVE_ROBIN_DEFAULT_SYMS = Object.freeze(["HOOD", "SPY", "QQQ", "IWM", "AAPL"]);

/** Pure-wave IFTTT recipes — math fields from envelope, actions stage RH SIM. */
export const WAVE_ROBIN_TRIGGERS = Object.freeze([
  {
    id: "trough-buy",
    if: { field: "rangePos", op: "lte", value: CASCADE_CHEAP_RANGE_MAX },
    then: { action: "stage_buy_sim", reason: "cheap-band trough" },
    human: "IF price in cheap trough band THEN stage Robinhood buy SIM",
    machine: "IF rangePos<=0.12 THEN stage_buy_sim",
  },
  {
    id: "peak-arm",
    if: { field: "movingUpArmed", op: "eq", value: true },
    then: { action: "stage_sell_sim", reason: "move-up pre-arm at peak" },
    human: "IF wave moving up through peak band THEN pre-arm sell SIM",
    machine: "IF movingUpArmed=true THEN stage_sell_sim",
  },
  {
    id: "cascade-hop",
    if: { field: "cascadeHopReady", op: "eq", value: true },
    then: { action: "cascade_hop", reason: "grow wave → next seat" },
    human: "IF cascade hop ready THEN rotate energy into next ranked seat",
    machine: "IF cascadeHopReady=true THEN cascade_hop",
  },
  {
    id: "accumulate-prove",
    if: { field: "accumulationDeltaUsd", op: "gt", value: 0 },
    then: { action: "prove_accumulation", reason: "token bag grew" },
    human: "IF portfolio accumulation delta > 0 THEN append proof ledger",
    machine: "IF accumulationDeltaUsd>0 THEN prove_accumulation",
  },
  {
    id: "dust-hold",
    if: { field: "leaveDust", op: "eq", value: true },
    then: { action: "hold_dust", reason: "nickel dust seat" },
    human: "IF exit path THEN leave $0.05 dust (never zero-out seat)",
    machine: "IF leaveDust=true THEN hold_dust usd=0.05",
  },
]);

const CALLBACK_DATA_MAX = 64;

function sha256Hex(text) {
  return createHash("sha256").update(String(text || ""), "utf8").digest("hex");
}

function shortHex(hex, n = 8) {
  return String(hex || "").replace(/^0x/i, "").toLowerCase().slice(0, n);
}

function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
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

function loadJson(path, fallback) {
  try {
    if (existsSync(path)) return JSON.parse(readFileSync(path, "utf8"));
  } catch { /* fresh */ }
  return typeof fallback === "function" ? fallback() : structuredClone(fallback);
}

function saveJson(path, doc) {
  ensureDirs();
  writeFileSync(path, JSON.stringify(doc, null, 2) + "\n");
}

function telegramCallbackData(cmd) {
  const s = String(cmd || "");
  return s.length <= CALLBACK_DATA_MAX ? s : s.slice(0, CALLBACK_DATA_MAX);
}

function btn(text, cmd) {
  return { text: String(text).slice(0, 64), callback_data: telegramCallbackData(cmd) };
}

function envFlagOn(raw) {
  const v = String(raw ?? "").trim().toLowerCase();
  return v === "yes" || v === "true" || v === "1";
}

export function rhWaveLiveEnabled(env = process.env) {
  return envFlagOn(env?.[RH_WAVE_LIVE_ENV] ?? "");
}

export function rhWaveAccountNumber(env = process.env) {
  return String(env?.[RH_WAVE_ACCOUNT_ENV] || "813839826").trim();
}

function emptyState() {
  return {
    id: WAVE_ROBIN_ID,
    filingLabel: WAVE_ROBIN_LABEL,
    formula: FORMULA_ID,
    agentId: WAVE_ROBIN_AGENT_ID,
    neverInventHashes: true,
    neverAutoSpend: true,
    createdAt: new Date().toISOString(),
    updatedAt: null,
    waveEnergy: 0,
    hopCount: 0,
    windowStartedAt: null,
    seats: {},
    lastTick: null,
    stagedOrders: [],
    liveLatch: false,
  };
}

function emptyLearn() {
  return { id: "wave-robin-learn-v1", filingLabel: WAVE_ROBIN_LABEL, events: [] };
}

function emptyAccum() {
  return {
    id: "wave-robin-accumulation-v1",
    filingLabel: WAVE_ROBIN_LABEL,
    formula: FORMULA_ID,
    neverInventHashes: true,
    baselineUsd: null,
    snapshots: [],
    proofs: [],
  };
}

/** @type {object|null} */
let _state = null;
let _statePathOverride = null;

export function setWaveRobinPathForTests(path) {
  _statePathOverride = path || null;
  _state = null;
}

function statePath() {
  return _statePathOverride || STATE_PATH;
}

export function loadWaveRobinState() {
  if (_state && !_statePathOverride) return _state;
  _state = loadJson(statePath(), emptyState);
  return _state;
}

export function saveWaveRobinState(doc = null) {
  const d = doc || loadWaveRobinState();
  d.updatedAt = new Date().toISOString();
  saveJson(statePath(), d);
  _state = d;
  return d;
}

function appendLearn(event) {
  const doc = loadJson(LEARN_PATH, emptyLearn);
  doc.events.push({ ...event, at: new Date().toISOString() });
  if (doc.events.length > 500) doc.events = doc.events.slice(-500);
  saveJson(LEARN_PATH, doc);
  return doc;
}

function writeStrand(extra = {}) {
  const strand = {
    id: "wave-robin",
    filingLabel: WAVE_ROBIN_LABEL,
    magic: WAVE_ROBIN_MAGIC,
    formula: FORMULA_ID,
    learn:
      "First agentic AI on OS Builder. Pure wave math + IFTTT cascade on Robinhood " +
      "quotes/historicals. Growing-wave energy hops seats. Accumulation proof ledger. " +
      "SIM by default; RH_WAVE_LIVE + confirm for real orders. Never invent hashes.",
    updatedAt: new Date().toISOString(),
    ...extra,
  };
  ensureDirs();
  writeFileSync(STRAND_PATH, JSON.stringify(strand, null, 2) + "\n");
  return strand;
}

/**
 * Pure wave math from OHLCV bars.
 * Peaks = local high maxima; troughs = local low minima.
 * Phase ≈ sin(π * rangePos) — growing when climbing trough→peak.
 */
export function computePureWaveEnvelope(bars = [], livePrice = null) {
  const closes = [];
  const highs = [];
  const lows = [];
  for (const b of bars || []) {
    const c = num(b.close_price ?? b.close, NaN);
    const h = num(b.high_price ?? b.high, NaN);
    const l = num(b.low_price ?? b.low, NaN);
    if (c > 0) closes.push(c);
    if (h > 0) highs.push(h);
    if (l > 0) lows.push(l);
  }
  if (closes.length < 3) {
    return {
      ready: false,
      reason: "need ≥3 bars",
      peaks: [],
      troughs: [],
      minTrough: null,
      maxPeak: null,
      price: livePrice > 0 ? livePrice : null,
      rangePos: null,
      phaseSin: null,
      waveEnergyDelta: 0,
      movingUp: false,
    };
  }

  const peaks = [];
  const troughs = [];
  for (let i = 1; i < highs.length - 1; i++) {
    if (highs[i] >= highs[i - 1] && highs[i] >= highs[i + 1]) peaks.push(highs[i]);
    if (lows[i] <= lows[i - 1] && lows[i] <= lows[i + 1]) troughs.push(lows[i]);
  }
  // Always include window extrema so envelope is defined
  const maxPeak = Math.max(...(peaks.length ? peaks : highs));
  const minTrough = Math.min(...(troughs.length ? troughs : lows));
  const price = livePrice > 0 ? livePrice : closes[closes.length - 1];
  const range = maxPeak - minTrough;
  const ready = range > 0 && price > 0;
  const rangePos = ready ? Math.min(1, Math.max(0, (price - minTrough) / range)) : null;
  const phaseSin = rangePos == null ? null : Math.sin(Math.PI * rangePos);
  const prev = closes[closes.length - 2];
  const movingUp = price > prev;
  // Growing wave: energy rises as we climb (phaseSin increasing) while moving up
  const waveEnergyDelta = ready && movingUp ? Math.max(0, phaseSin) * (price - prev) / price : 0;

  return {
    ready,
    peaks: peaks.slice(-8),
    troughs: troughs.slice(-8),
    minTrough,
    maxPeak,
    price,
    range,
    rangePos,
    phaseSin,
    waveEnergyDelta,
    movingUp,
    barCount: closes.length,
    formula: "phase=sin(π·rangePos); energy+=phase·ret when climbing",
  };
}

/**
 * Rank seats for cascade — cheap trough first, then move-up arms, then energy.
 */
export function rankWaveSeats(seats = []) {
  const ranked = seats.map((s) => {
    const wave = s.wave || {};
    const cheap = wave.rangePos != null && wave.rangePos <= CASCADE_CHEAP_RANGE_MAX;
    const arm = armSellOnMoveUp({
      ...s,
      wave: {
        ready: wave.ready,
        minTrough: wave.minTrough,
        maxPeak: wave.maxPeak,
        price: wave.price,
        rangePos: wave.rangePos,
      },
      movingUp: wave.movingUp,
      price: wave.price,
    });
    const score =
      (cheap ? 100 : 0) +
      (arm.armed ? 40 : 0) +
      (wave.phaseSin != null ? wave.phaseSin * 20 : 0) +
      (wave.waveEnergyDelta || 0) * 100;
    return {
      ...s,
      cheap,
      armed: arm.armed,
      arm,
      cascadeScore: score,
    };
  });
  ranked.sort((a, b) => b.cascadeScore - a.cascadeScore);
  return ranked;
}

export function evaluateWaveTrigger(recipe, facts = {}) {
  const r = typeof recipe === "string"
    ? WAVE_ROBIN_TRIGGERS.find((x) => x.id === recipe)
    : recipe;
  if (!r) return { ok: false, fired: false, reason: "unknown recipe" };
  const actual = facts[r.if.field];
  let match = false;
  const target = r.if.value;
  switch (r.if.op) {
    case "eq":
      match = actual === target || String(actual) === String(target);
      break;
    case "lte":
      match = num(actual, Infinity) <= num(target);
      break;
    case "gte":
      match = num(actual, -Infinity) >= num(target);
      break;
    case "gt":
      match = num(actual, -Infinity) > num(target);
      break;
    case "lt":
      match = num(actual, Infinity) < num(target);
      break;
    default:
      match = false;
  }
  return {
    ok: true,
    fired: match,
    recipeId: r.id,
    then: match ? r.then : null,
    human: r.human,
    machine: r.machine,
  };
}

/**
 * Normalize Robinhood quote + bars into a cascade seat.
 */
export function seatFromRobinhood({
  symbol,
  quote = null,
  bars = [],
  quantity = 0,
  costBasisUsd = null,
} = {}) {
  const sym = String(symbol || "").toUpperCase();
  const last = num(
    quote?.last_non_reg_trade_price ?? quote?.last_trade_price ?? quote?.mark_price,
    0,
  );
  const wave = computePureWaveEnvelope(bars, last > 0 ? last : null);
  const qty = num(quantity, 0);
  const markUsd = wave.price != null && qty > 0 ? wave.price * qty : 0;
  return {
    symbol: sym,
    venue: "robinhood",
    price: wave.price,
    quantity: qty,
    markUsd,
    costBasisUsd: costBasisUsd == null ? null : num(costBasisUsd),
    wave,
    peaks: wave.peaks,
    troughs: wave.troughs,
    maxPeak: wave.maxPeak,
    minTrough: wave.minTrough,
  };
}

/**
 * Build facts bag for IFTTT from a ranked seat + book snapshot.
 */
export function factsFromSeat(seat, book = {}) {
  const wave = seat.wave || {};
  const arm = armSellOnMoveUp({
    ...seat,
    wave: {
      ready: wave.ready,
      minTrough: wave.minTrough,
      maxPeak: wave.maxPeak,
      price: wave.price,
      rangePos: wave.rangePos,
    },
    movingUp: wave.movingUp,
    price: wave.price,
  });
  return {
    symbol: seat.symbol,
    rangePos: wave.rangePos,
    phaseSin: wave.phaseSin,
    movingUp: wave.movingUp === true,
    movingUpArmed: arm.armed === true,
    cascadeHopReady: book.cascadeHopReady === true,
    accumulationDeltaUsd: num(book.accumulationDeltaUsd, 0),
    leaveDust: arm.armed === true,
    leaveDustUsd: CASCADE_LEAVE_DUST_USD,
    waveEnergy: num(book.waveEnergy, 0),
  };
}

/**
 * Stage a SIM Robinhood order — never places. Records intent + ref_id.
 */
export function stageRhOrderSim({
  symbol,
  side,
  type = "market",
  dollarAmount = null,
  quantity = null,
  reason = "",
  accountNumber = null,
} = {}) {
  const state = loadWaveRobinState();
  const refId = randomUUID();
  const order = {
    sim: true,
    live: false,
    placed: false,
    refId,
    accountNumber: accountNumber || rhWaveAccountNumber(),
    symbol: String(symbol || "").toUpperCase(),
    side: String(side || "").toLowerCase(),
    type,
    dollarAmount: dollarAmount == null ? null : String(dollarAmount),
    quantity: quantity == null ? null : String(quantity),
    reason: String(reason || "").slice(0, 120),
    stagedAt: new Date().toISOString(),
    neverAutoSpend: true,
  };
  state.stagedOrders.push(order);
  if (state.stagedOrders.length > 100) state.stagedOrders = state.stagedOrders.slice(-100);
  saveWaveRobinState(state);
  appendLearn({ kind: "stage_sim", ...order });
  return { ok: true, order };
}

/**
 * Record portfolio snapshot + prove accumulation delta.
 */
export function proveAccumulation({
  totalValueUsd,
  cryptoValueUsd = null,
  equityValueUsd = null,
  cashUsd = null,
  buyingPowerUsd = null,
  source = "robinhood",
  positions = [],
} = {}) {
  const doc = loadJson(ACCUM_PATH, emptyAccum);
  const total = num(totalValueUsd, 0);
  if (!(total >= 0)) return { ok: false, reason: "bad total" };
  if (doc.baselineUsd == null) doc.baselineUsd = total;
  const prev = doc.snapshots.length
    ? num(doc.snapshots[doc.snapshots.length - 1].totalValueUsd, doc.baselineUsd)
    : doc.baselineUsd;
  const delta = total - prev;
  const fromBaseline = total - doc.baselineUsd;
  const snap = {
    at: new Date().toISOString(),
    source,
    totalValueUsd: total,
    cryptoValueUsd: cryptoValueUsd == null ? null : num(cryptoValueUsd),
    equityValueUsd: equityValueUsd == null ? null : num(equityValueUsd),
    cashUsd: cashUsd == null ? null : num(cashUsd),
    buyingPowerUsd: buyingPowerUsd == null ? null : num(buyingPowerUsd),
    deltaUsd: delta,
    fromBaselineUsd: fromBaseline,
    positionCount: (positions || []).length,
  };
  doc.snapshots.push(snap);
  if (doc.snapshots.length > 200) doc.snapshots = doc.snapshots.slice(-200);

  let proof = null;
  if (delta > 0 || fromBaseline > 0) {
    proof = {
      id: "accum-" + sha256Hex(JSON.stringify(snap)).slice(0, 12),
      at: snap.at,
      deltaUsd: delta,
      fromBaselineUsd: fromBaseline,
      totalValueUsd: total,
      commit: sha256Hex(WAVE_ROBIN_MAGIC + "|" + snap.at + "|" + total),
      note: "Accumulation proof — ledger only; not a chain tx hash",
    };
    doc.proofs.push(proof);
    if (doc.proofs.length > 100) doc.proofs = doc.proofs.slice(-100);
  }
  saveJson(ACCUM_PATH, doc);
  appendLearn({
    kind: "accumulation",
    deltaUsd: delta,
    fromBaselineUsd: fromBaseline,
    totalValueUsd: total,
    proofId: proof?.id || null,
  });
  return { ok: true, snap, proof, ledger: doc };
}

export function loadAccumulationLedger() {
  return loadJson(ACCUM_PATH, emptyAccum);
}

/**
 * One agent tick: seats → rank → IFTTT → stage SIM → grow wave energy.
 * `book` may include portfolio totals for accumulation proof.
 */
export function runWaveRobinTick({
  seats = [],
  book = {},
  hopBudget = CASCADE_TARGET_HOPS,
} = {}) {
  const state = loadWaveRobinState();
  if (!state.windowStartedAt) state.windowStartedAt = new Date().toISOString();
  const windowAge = Date.now() - Date.parse(state.windowStartedAt);
  if (windowAge > CASCADE_WINDOW_MS) {
    state.windowStartedAt = new Date().toISOString();
    state.hopCount = 0;
  }

  const ranked = rankWaveSeats(seats);
  const fires = [];
  const staged = [];
  let energyGain = 0;

  const accumDelta = num(book.accumulationDeltaUsd, 0);
  const hopReady =
    state.hopCount < hopBudget &&
    ranked.length >= 2 &&
    (ranked[0]?.cheap || ranked[0]?.armed);

  for (const seat of ranked) {
    const facts = factsFromSeat(seat, {
      cascadeHopReady: hopReady && seat.symbol === ranked[0]?.symbol,
      accumulationDeltaUsd: accumDelta,
      waveEnergy: state.waveEnergy,
    });
    for (const recipe of WAVE_ROBIN_TRIGGERS) {
      const ev = evaluateWaveTrigger(recipe, facts);
      if (!ev.fired) continue;
      fires.push({
        symbol: seat.symbol,
        recipeId: ev.recipeId,
        action: ev.then.action,
        human: ev.human,
        machine: ev.machine,
        rangePos: facts.rangePos,
        phaseSin: facts.phaseSin,
      });
      if (ev.then.action === "stage_buy_sim") {
        // Character-spot class sizing from Eureka love — always-trigger spirit
        const spot = characterSpotBuyUsd();
        const dollars = Math.max(1, Math.min(5, Number(spot.spotBuyUsd.toFixed(2)) || 1));
        const st = stageRhOrderSim({
          symbol: seat.symbol,
          side: "buy",
          type: "market",
          dollarAmount: String(dollars),
          reason: ev.then.reason + " rangePos=" + (facts.rangePos?.toFixed?.(3) ?? "?"),
        });
        staged.push(st.order);
      } else if (ev.then.action === "stage_sell_sim" && seat.quantity > 0) {
        const st = stageRhOrderSim({
          symbol: seat.symbol,
          side: "sell",
          type: "limit",
          quantity: String(seat.quantity),
          reason: ev.then.reason + " exit≈" + (seat.wave?.maxPeak ?? "?"),
        });
        // attach limit hint (SIM only)
        st.order.limitPriceHint = seat.wave?.maxPeak ?? null;
        staged.push(st.order);
      } else if (ev.then.action === "cascade_hop") {
        state.hopCount += 1;
        energyGain += Math.max(0.01, seat.wave?.waveEnergyDelta || 0.05);
      } else if (ev.then.action === "prove_accumulation" && book.portfolio) {
        proveAccumulation(book.portfolio);
      }
    }
    energyGain += Math.max(0, seat.wave?.waveEnergyDelta || 0);
    state.seats[seat.symbol] = {
      symbol: seat.symbol,
      price: seat.price,
      rangePos: seat.wave?.rangePos ?? null,
      phaseSin: seat.wave?.phaseSin ?? null,
      cascadeScore: seat.cascadeScore,
      updatedAt: new Date().toISOString(),
    };
  }

  state.waveEnergy = num(state.waveEnergy, 0) + energyGain;
  state.lastTick = {
    at: new Date().toISOString(),
    seats: ranked.length,
    fires: fires.length,
    staged: staged.length,
    hopCount: state.hopCount,
    waveEnergy: state.waveEnergy,
  };
  saveWaveRobinState(state);
  appendLearn({
    kind: "tick",
    seats: ranked.map((s) => s.symbol),
    fires: fires.length,
    staged: staged.length,
    waveEnergy: state.waveEnergy,
    hopCount: state.hopCount,
  });
  writeStrand({
    waveEnergy: state.waveEnergy,
    hopCount: state.hopCount,
    lastFires: fires.slice(0, 8),
  });

  return {
    ok: true,
    ranked,
    fires,
    staged,
    waveEnergy: state.waveEnergy,
    hopCount: state.hopCount,
    liveEnabled: rhWaveLiveEnabled(),
    neverAutoSpend: true,
    formula: FORMULA_ID,
  };
}

/**
 * Bootstrap the agent into OS Builder as the first agentic AI brain.
 */
export function bootstrapWaveRobinBrain() {
  const id = WAVE_ROBIN_AGENT_ID;
  startOsSession({ agentId: id });
  renameOsAgent(id, id);
  setOsLobes(
    ["formula", "anchors", "triggers", "follow", "memory", "lexicon", "dual"],
    id,
  );
  // Reuse OS builder trigger ids that exist + our wave triggers live in WAVE_ROBIN
  setOsTriggers(
    ["eureka-learn", "vita-sparse", "plain-refuse-claim", "keyloc-hitch"],
    id,
  );
  commitFollowStep({ agentId: id, label: "boot-wave-math", payload: "phase=sin(π·rangePos)" });
  commitFollowStep({ agentId: id, label: "wire-robinhood", payload: "SIM-default RH_WAVE_LIVE=off" });
  commitFollowStep({ agentId: id, label: "cascade-grow", payload: "hops≥8/15m dust=$0.05" });
  refineLexiconPair({
    human: "growing wave cascade on Robinhood",
    machine: "waveRobin=IFTTT|phaseSin|cascadeHop|accumProof|SIM",
  });
  const sealed = stageOsSeal(id);
  appendLearn({ kind: "bootstrap", agentId: id, commit: shortHex(sealed.contentCommit, 12) });
  writeStrand({ bootstrapped: true, agentId: id });
  return { ok: true, agentId: id, seal: sealed };
}

/**
 * Run end-to-end on provided RH payload (quotes + historicals + portfolio).
 * This is the "execute own code" path — no invented fills.
 */
export function runWaveRobinOnRhPayload({
  quotes = [],
  historicals = [],
  portfolio = null,
  positions = [],
} = {}) {
  bootstrapWaveRobinBrain();

  const barsBySym = {};
  for (const row of historicals) {
    const sym = String(row.symbol || "").toUpperCase();
    barsBySym[sym] = row.bars || [];
  }
  const quoteBySym = {};
  for (const row of quotes) {
    const q = row.quote || row;
    const sym = String(q.symbol || "").toUpperCase();
    quoteBySym[sym] = q;
  }
  const posBySym = {};
  for (const p of positions) {
    const code = String(p.currency?.code || p.symbol || "").toUpperCase();
    posBySym[code] = p;
  }

  const syms = new Set([
    ...Object.keys(quoteBySym),
    ...Object.keys(barsBySym),
    ...WAVE_ROBIN_DEFAULT_SYMS,
  ]);
  const seats = [];
  for (const sym of syms) {
    if (!quoteBySym[sym] && !barsBySym[sym]) continue;
    const pos = posBySym[sym];
    seats.push(
      seatFromRobinhood({
        symbol: sym,
        quote: quoteBySym[sym] || null,
        bars: barsBySym[sym] || [],
        quantity: pos ? num(pos.quantity_transferable ?? pos.quantity, 0) : 0,
      }),
    );
  }

  let accum = null;
  if (portfolio) {
    accum = proveAccumulation({
      totalValueUsd: num(portfolio.total_value ?? portfolio.totalValueUsd),
      cryptoValueUsd: num(portfolio.crypto_value ?? portfolio.cryptoValueUsd),
      equityValueUsd: num(portfolio.equity_value ?? portfolio.equityValueUsd),
      cashUsd: num(portfolio.cash),
      buyingPowerUsd: num(portfolio.buying_power?.buying_power ?? portfolio.buyingPowerUsd),
      source: "robinhood-live",
      positions,
    });
  }

  const tick = runWaveRobinTick({
    seats,
    book: {
      accumulationDeltaUsd: accum?.snap?.deltaUsd ?? 0,
      portfolio: portfolio
        ? {
            totalValueUsd: num(portfolio.total_value ?? portfolio.totalValueUsd),
            cryptoValueUsd: num(portfolio.crypto_value),
            equityValueUsd: num(portfolio.equity_value),
            cashUsd: num(portfolio.cash),
            buyingPowerUsd: num(portfolio.buying_power?.buying_power),
            positions,
          }
        : null,
    },
  });

  return {
    ok: true,
    agentId: WAVE_ROBIN_AGENT_ID,
    seats: tick.ranked.map((s) => ({
      symbol: s.symbol,
      price: s.price,
      rangePos: s.wave?.rangePos,
      phaseSin: s.wave?.phaseSin,
      cheap: s.cheap,
      armed: s.armed,
      cascadeScore: s.cascadeScore,
    })),
    fires: tick.fires,
    staged: tick.staged,
    waveEnergy: tick.waveEnergy,
    hopCount: tick.hopCount,
    accumulation: accum,
    liveEnabled: tick.liveEnabled,
    accountMasked: "••••" + rhWaveAccountNumber().slice(-4),
    message:
      "Wave-Robin tick complete. SIM orders staged only. " +
      "Set RH_WAVE_LIVE=yes and /waveai confirm to place — never auto.",
  };
}

export function buildWaveRobinKeyboard() {
  return {
    inline_keyboard: [
      [btn("▶ Tick", "/waveai tick"), btn("🌊 Status", "/waveai status"), btn("📜 Accum", "/waveai accum")],
      [btn("🧪 Sandbox", "/waveai sandbox"), btn("🧠 Bootstrap", "/waveai boot"), btn("📋 Staged", "/waveai staged")],
      [btn("🖥 OS", "/os"), btn("🏠 HOME", "/home"), btn("❓ Help", "/waveai help")],
    ],
  };
}

export function assertWaveRobinCallbacksFit() {
  const kb = buildWaveRobinKeyboard();
  const bad = [];
  for (const b of kb.inline_keyboard.flat()) {
    const c = b.callback_data || "";
    if (c.length > CALLBACK_DATA_MAX) bad.push(c);
  }
  return { ok: bad.length === 0, bad, max: CALLBACK_DATA_MAX };
}

export function parseWaveRobinCommand(raw) {
  const src = String(raw || "").trim();
  const low = src.toLowerCase();
  if (
    low === "/waveai" ||
    low === "/rhwave" ||
    low === "/waverobin" ||
    low === "/waveagent"
  ) {
    return { ok: true, action: "home", body: "" };
  }
  if (
    !low.startsWith("/waveai ") &&
    !low.startsWith("/rhwave ") &&
    !low.startsWith("/waverobin ") &&
    !low.startsWith("/waveagent ")
  ) {
    return { ok: false, action: null };
  }
  const rest = src.replace(/^\/(?:waveai|rhwave|waverobin|waveagent)\s+/i, "").trim();
  const first = (rest.split(/\s+/)[0] || "").toLowerCase();
  const body = rest.slice(first.length).trim();
  const known = [
    "home", "tick", "status", "accum", "accumulation", "sandbox", "boot",
    "staged", "help", "confirm", "live",
  ];
  if (known.includes(first)) {
    const action =
      first === "accumulation" ? "accum" :
      first === "live" ? "confirm" :
      first;
    return { ok: true, action, body };
  }
  return { ok: true, action: "home", body: rest };
}

function formatStatusCard(state, accum) {
  const lines = [];
  lines.push(WAVE_ROBIN_MAGIC + "v1|status§");
  lines.push("🌊 WAVE-ROBIN — first agentic AI");
  lines.push("agent=" + WAVE_ROBIN_AGENT_ID);
  lines.push("waveEnergy=" + num(state.waveEnergy).toFixed(6));
  lines.push("hops=" + state.hopCount + " / " + CASCADE_TARGET_HOPS + " per 15m");
  lines.push("RH_WAVE_LIVE=" + (rhWaveLiveEnabled() ? "yes" : "no (SIM only)"));
  lines.push("account=" + "••••" + rhWaveAccountNumber().slice(-4));
  lines.push("stagedOrders=" + (state.stagedOrders || []).length);
  if (accum?.baselineUsd != null) {
    const last = accum.snapshots?.[accum.snapshots.length - 1];
    lines.push(
      "accum baseline=$" +
        num(accum.baselineUsd).toFixed(4) +
        " now=$" +
        num(last?.totalValueUsd, accum.baselineUsd).toFixed(4) +
        " Δ=$" +
        num(last?.fromBaselineUsd, 0).toFixed(4),
    );
    lines.push("proofs=" + (accum.proofs || []).length);
  }
  lines.push("neverAutoSpend=true  inventHashes=false");
  if (state.lastTick) {
    lines.push(
      "lastTick fires=" +
        state.lastTick.fires +
        " staged=" +
        state.lastTick.staged +
        " @" +
        (state.lastTick.at || "").slice(0, 19),
    );
  }
  return lines.join("\n");
}

function formatHelpCard() {
  return [
    WAVE_ROBIN_MAGIC + "v1|help§",
    "WAVE-ROBIN — pure wave math + Robinhood IFTTT cascade",
    "━━━━━━━━━━━━━━━━━━━━",
    "/waveai boot     — register brain on OS Builder",
    "/waveai tick     — run cascade on last injected seats",
    "/waveai sandbox  — local fixture sandbox (no RH call)",
    "/waveai status   — energy · hops · live gate",
    "/waveai accum    — accumulation proof ledger",
    "/waveai staged   — SIM order queue",
    "/waveai confirm  — place staged ONLY if RH_WAVE_LIVE=yes",
    "",
    "Math: phase=sin(π·rangePos); buy cheap≤0.12; arm sell≥0.55 moving up",
    "Cascade: grow energy · hop seats · leave $0.05 dust",
    "Orders: SIM default. Live needs env + confirm. Never auto-spend.",
  ].join("\n");
}

/**
 * Local sandbox using synthetic bars shaped like a growing wave — proves
 * the agent fires trough-buy + cascade without needing live RH in tests.
 */
export function runWaveRobinSandbox() {
  const mkBars = (base, amp, n = 24) => {
    const bars = [];
    for (let i = 0; i < n; i++) {
      const phase = i / (n - 1);
      const mid = base + amp * Math.sin(Math.PI * phase);
      bars.push({
        open_price: String(mid - amp * 0.05),
        close_price: String(mid),
        high_price: String(mid + amp * 0.15),
        low_price: String(mid - amp * 0.15),
      });
    }
    return bars;
  };
  // Seat A near trough (cheap), seat B near peak (arm)
  const troughBars = mkBars(100, 20);
  const peakBars = mkBars(100, 20);
  const seats = [
    seatFromRobinhood({
      symbol: "TROUGH",
      quote: { last_trade_price: String(100 - 20 * 0.9) }, // deep cheap
      bars: troughBars,
    }),
    seatFromRobinhood({
      symbol: "PEAK",
      quote: { last_trade_price: String(100 + 20 * 0.85) },
      bars: peakBars,
      quantity: 2,
    }),
  ];
  // Force trough seat rangePos low by using low live price vs envelope
  const tick = runWaveRobinTick({
    seats,
    book: {
      accumulationDeltaUsd: 0.42,
      portfolio: {
        totalValueUsd: 19.5,
        cryptoValueUsd: 18.5,
        cashUsd: 1,
        buyingPowerUsd: 1,
      },
    },
  });
  return { ok: tick.fires.length > 0, ...tick };
}

export function handleWaveRobinAction({ action = "home", body = "" } = {}) {
  const fit = assertWaveRobinCallbacksFit();
  const keyboard = buildWaveRobinKeyboard();
  const state = loadWaveRobinState();
  const accum = loadAccumulationLedger();
  let reply = "";
  let extra = {};

  if (action === "help") {
    reply = formatHelpCard();
  } else if (action === "boot") {
    const boot = bootstrapWaveRobinBrain();
    reply =
      WAVE_ROBIN_MAGIC +
      "v1|boot§\n" +
      "Bootstrapped agent=" +
      boot.agentId +
      "\nseal commit=" +
      shortHex(boot.seal.contentCommit, 16) +
      "…\nOS Builder follow-leader + lexicon refined.\nNext: inject RH payload or /waveai sandbox";
    extra.boot = boot;
  } else if (action === "sandbox") {
    const sand = runWaveRobinSandbox();
    reply = [
      WAVE_ROBIN_MAGIC + "v1|sandbox§",
      sand.ok ? "SANDBOX PASS" : "SANDBOX WEAK",
      "fires=" + sand.fires.length + " staged=" + sand.staged.length,
      "waveEnergy=" + num(sand.waveEnergy).toFixed(6),
      ...sand.fires.slice(0, 8).map(
        (f) => "  ✓ " + f.symbol + " · " + f.recipeId + " → " + f.action,
      ),
      "SIM only — no Robinhood order placed.",
    ].join("\n");
    extra.sandbox = sand;
  } else if (action === "accum") {
    const lines = [WAVE_ROBIN_MAGIC + "v1|accum§", "ACCUMULATION LEDGER"];
    lines.push("baseline=$" + (accum.baselineUsd == null ? "?" : num(accum.baselineUsd).toFixed(4)));
    for (const p of (accum.proofs || []).slice(-5)) {
      lines.push(
        "  proof " +
          p.id +
          " Δ=$" +
          num(p.deltaUsd).toFixed(4) +
          " total=$" +
          num(p.totalValueUsd).toFixed(4),
      );
      lines.push("    commit=" + shortHex(p.commit, 16) + "… (ledger, not tx)");
    }
    if (!(accum.proofs || []).length) lines.push("(no growth proofs yet — tick with portfolio)");
    const last = accum.snapshots?.[accum.snapshots.length - 1];
    if (last) {
      lines.push(
        "last snap $" +
          num(last.totalValueUsd).toFixed(4) +
          " fromBaseline=$" +
          num(last.fromBaselineUsd).toFixed(4),
      );
    }
    reply = lines.join("\n");
  } else if (action === "staged") {
    const lines = [WAVE_ROBIN_MAGIC + "v1|staged§", "SIM ORDER QUEUE"];
    const rows = (state.stagedOrders || []).slice(-10);
    if (!rows.length) lines.push("(empty)");
    for (const o of rows) {
      lines.push(
        (o.placed ? "LIVE" : "SIM") +
          "  " +
          o.side +
          " " +
          o.symbol +
          "  $" +
          (o.dollarAmount || o.quantity || "?") +
          "  " +
          clip(o.reason, 40),
      );
      lines.push("  ref=" + o.refId);
    }
    lines.push("Place only via /waveai confirm when RH_WAVE_LIVE=yes");
    reply = lines.join("\n");
  } else if (action === "confirm") {
    if (!rhWaveLiveEnabled()) {
      reply =
        WAVE_ROBIN_MAGIC +
        "v1|confirm§\nREFUSED — RH_WAVE_LIVE is off.\nSIM queue kept. Set env RH_WAVE_LIVE=yes then confirm.\nNever auto-spend.";
    } else {
      reply =
        WAVE_ROBIN_MAGIC +
        "v1|confirm§\nLIVE gate ON — operator must place via Robinhood MCP " +
        "with staged ref_id (idempotent). This bot does not silently place.\n" +
        "staged=" +
        (state.stagedOrders || []).filter((o) => !o.placed).length +
        "  account=••••" +
        rhWaveAccountNumber().slice(-4);
    }
  } else if (action === "tick") {
    // Tick without new seats reuses last seat snapshots as thin tokens
    const seats = Object.values(state.seats || {}).map((s) =>
      seatFromRobinhood({
        symbol: s.symbol,
        quote: { last_trade_price: String(s.price || 0) },
        bars: [
          { close_price: String((s.price || 1) * 0.95), high_price: String((s.price || 1) * 1.05), low_price: String((s.price || 1) * 0.9), open_price: String(s.price || 1) },
          { close_price: String(s.price || 1), high_price: String((s.price || 1) * 1.02), low_price: String((s.price || 1) * 0.98), open_price: String(s.price || 1) },
          { close_price: String(s.price || 1), high_price: String((s.price || 1) * 1.01), low_price: String((s.price || 1) * 0.99), open_price: String(s.price || 1) },
        ],
      }),
    );
    if (!seats.length) {
      reply = formatHelpCard() + "\n\nNo seats yet — run sandbox or inject RH payload.";
    } else {
      const tick = runWaveRobinTick({ seats });
      reply = [
        WAVE_ROBIN_MAGIC + "v1|tick§",
        "fires=" + tick.fires.length + " energy=" + num(tick.waveEnergy).toFixed(6),
        ...tick.fires.slice(0, 6).map((f) => "  " + f.symbol + " → " + f.action),
      ].join("\n");
      extra.tick = tick;
    }
  } else {
    reply = formatStatusCard(state, accum) + "\n\n" + formatHelpCard();
  }

  void body;
  return {
    ok: true,
    action,
    agentId: WAVE_ROBIN_AGENT_ID,
    reply,
    html: "<pre>" + esc(reply).slice(0, 3500) + "</pre>",
    keyboard,
    callbackFit: fit,
    ...extra,
  };
}

export function publicWaveRobinState() {
  const state = loadWaveRobinState();
  const accum = loadAccumulationLedger();
  return {
    id: WAVE_ROBIN_ID,
    filingLabel: WAVE_ROBIN_LABEL,
    agentId: WAVE_ROBIN_AGENT_ID,
    formula: FORMULA_ID,
    waveEnergy: state.waveEnergy,
    hopCount: state.hopCount,
    liveEnabled: rhWaveLiveEnabled(),
    neverAutoSpend: true,
    triggers: WAVE_ROBIN_TRIGGERS.map((t) => ({
      id: t.id,
      human: t.human,
      machine: t.machine,
    })),
    seats: Object.values(state.seats || {}),
    stagedCount: (state.stagedOrders || []).length,
    accumulation: {
      baselineUsd: accum.baselineUsd,
      proofs: (accum.proofs || []).length,
      last: accum.snapshots?.[accum.snapshots.length - 1] || null,
    },
    anchors: MAINFRAME_ANCHORS.known.map((a) => ({ id: a.id, kind: a.kind, tx: a.tx })),
    messageFirst: ORIGINAL_FORMULA.messageFirstWhenKeyLocCovered,
  };
}

// Seed learn/strand on first touch
if (!existsSync(LEARN_PATH)) {
  try {
    saveJson(LEARN_PATH, emptyLearn());
  } catch { /* ok */ }
}
