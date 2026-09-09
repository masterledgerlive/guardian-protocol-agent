/**
 * Guardian Control Board — shared snapshot / sim / V4 status math.
 *
 * Powers GET /board so humans and agent bots learn from one surface.
 * Pure functions + read-only env / catalog. Never mutates Railway secrets,
 * never spends RISK, never starts the V4 process, never invents live P&L.
 */

import fs from "node:fs";
import {
  envFlagYes,
  isLoseZeroMode,
  isInjectCoverRequired,
  hitchCostMult,
  DEFAULT_HITCH_COST_MULT,
} from "./lose-zero-gate.js";
import {
  piggyBankPct,
  piggyBankMinUsd,
  piggyEarningsBufferPct,
  DEFAULT_PIGGY_BANK_PCT,
  DEFAULT_PIGGY_BANK_MIN_USD,
  DEFAULT_PIGGY_EARNINGS_BUFFER_PCT,
} from "./piggy-bank.js";
import {
  MAX_HITCH_COST_PCT,
  MAX_ROUND_TRIP_COST_PCT,
  MIN_NEAR_TERM_EDGE_MULT,
  THIN_BOOK_NEAR_TERM_MULT,
  evaluateCostEdgeGate,
} from "./cost-edge-gate.js";
import { PEAK_ZONE_PCT, FAST_CRASH_PCT, HIST_PEAK_TOUCH_PCT } from "./peak-ride.js";
import { demoEngineSnapshot } from "./engine-board.js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { reportInjectCapacity } from "./storage-inject-capacity.js";
import { LIVE_ASSUMPTIONS } from "./revenue-sim.js";

/** Display-only V4 names (from guardian-v4/README). No pool IDs, no swap encoder, no V4 imports. */
const V4_DISPLAY_AVENUES = Object.freeze([
  { symbol: "DOT", status: "active", injectMain: true, notes: "Uni V4 DOT/ETH — V4 process only" },
  { symbol: "POLKADOT_BASE", status: "active", injectMain: true, notes: "Polkadot-branded Base V4 avenue" },
  { symbol: "UDOT", status: "watch", injectMain: false, notes: "watch until V4 ETH book" },
  { symbol: "CBBTC", status: "active", injectMain: false, notes: "V4 catalog — not this V3 injector" },
  { symbol: "AERO", status: "active", injectMain: false, notes: "V4 catalog — not this V3 injector" },
  { symbol: "TOSHI", status: "active", injectMain: false, notes: "V4 catalog — not this V3 injector" },
  { symbol: "VIRTUAL", status: "active", injectMain: false, notes: "V4 catalog — not this V3 injector" },
  { symbol: "UNI", status: "active", injectMain: false, notes: "V4 catalog — not this V3 injector" },
  { symbol: "VVV", status: "active", injectMain: false, notes: "V4 catalog — not this V3 injector" },
  { symbol: "XPL", status: "deferred", injectMain: false, notes: "no Base V4 ETH book yet" },
]);

const V4_LOCK_FILE = join(dirname(fileURLToPath(import.meta.url)), "guardian-v4", "state", "guardian-v4.lock");

export const BOARD_PATHS = Object.freeze({
  hub: "/board",
  health: "/board/health",
  healthAlias: "/health",
  params: "/board/api/params",
  snapshot: "/board/api/snapshot",
  sim: "/board/api/sim",
  v4: "/board/api/v4",
  v4Page: "/v4",
  arena: "/arena",
  engine: "/engine",
});

export const LOSE_ZERO_INVARIANTS = Object.freeze({
  neverSellUnderwater: true,
  hitchOnlyWhenLeftoverCovers: true,
  piggyNeverSell: true,
  vaultNeverSpend: true,
  noInventedPnl: true,
});

/**
 * Read-only live knobs. Does not write env. Sim overrides belong in POST /board/api/sim.
 */
export function readLiveParamSnapshot(env = process.env) {
  return {
    kind: "live-snapshot|read-only",
    writable: false,
    writeNote:
      "This board does not mutate Railway env. Tune in sim below; live knobs change via Railway variables or Telegram. Authenticated queue (buy/exit/prove) already exists — no open unauthenticated mutate.",
    loseZero: isLoseZeroMode(env),
    haltNewEntries: envFlagYes("HALT_NEW_ENTRIES", env),
    requireInjectCover: isInjectCoverRequired(env),
    hitchCostMult: hitchCostMult(env),
    piggyBankPct: piggyBankPct(env),
    piggyBankMinUsd: piggyBankMinUsd(env),
    piggyEarningsBufferPct: piggyEarningsBufferPct(env),
    piggyLinkPct: piggyBankPct(env, { symbol: "LINK" }),
    defaults: {
      piggyBankPct: DEFAULT_PIGGY_BANK_PCT,
      piggyBankMinUsd: DEFAULT_PIGGY_BANK_MIN_USD,
      piggyEarningsBufferPct: DEFAULT_PIGGY_EARNINGS_BUFFER_PCT,
      hitchCostMult: DEFAULT_HITCH_COST_MULT,
    },
    costEdge: {
      alwaysOn: true,
      envFlag: null,
      maxHitchCostPct: MAX_HITCH_COST_PCT,
      maxRoundTripCostPct: MAX_ROUND_TRIP_COST_PCT,
      minNearTermEdgeMult: MIN_NEAR_TERM_EDGE_MULT,
      thinBookNearTermMult: THIN_BOOK_NEAR_TERM_MULT,
    },
    peakRide: {
      alwaysOn: true,
      envFlag: null,
      histPeakTouchIsSell: false,
      peakZonePct: PEAK_ZONE_PCT,
      fastCrashPct: FAST_CRASH_PCT,
      histPeakTouchPct: HIST_PEAK_TOUCH_PCT,
    },
    loseZeroRules: { ...LOSE_ZERO_INVARIANTS },
  };
}

function pidAlive(pid) {
  const n = Number(pid);
  if (!Number.isFinite(n) || n <= 0) return false;
  try {
    process.kill(n, 0);
    return true;
  } catch {
    return false;
  }
}

export function v4ProcessStatus() {
  if (!fs.existsSync(V4_LOCK_FILE)) {
    return { running: false, lock: null, note: "no lockfile — V4 process not started on this host" };
  }
  try {
    const lock = JSON.parse(fs.readFileSync(V4_LOCK_FILE, "utf8"));
    const running = pidAlive(lock?.pid);
    return {
      running,
      lock,
      note: running
        ? `V4 process alive (pid ${lock.pid}) — separate from this V3 webhook`
        : "stale lockfile — V4 not running",
    };
  } catch (e) {
    return { running: false, lock: null, note: "lock unreadable: " + (e.message || e) };
  }
}

/**
 * V4 is a separate process (`npm run start:v4`) with GUARDIAN_V4_* env.
 * This V3 webhook never starts it, never imports guardian-v4 swap/agent code,
 * and never encodes V4 calldata. Status is lockfile + docs only.
 */
export function v4BoardStatus() {
  const proc = v4ProcessStatus();
  const groups = { active: [], scout: [], watch: [], deferred: [], frozen: [] };
  for (const t of V4_DISPLAY_AVENUES) {
    (groups[t.status] || (groups[t.status] = [])).push(t.symbol);
  }
  return {
    kind: "v4-offshoot|docs-only",
    sameProcessAsV3: false,
    startableFromThisWebhook: false,
    encodesV4Swaps: false,
    loadsV4Runtime: false,
    page: "/v4",
    start: {
      once: "npm run start:v4 -- --once",
      loop: "npm run start:v4",
      tests: "npm run test:v4",
    },
    envPrefix: "GUARDIAN_V4_",
    dryRunDefault: true,
    running: proc.running,
    process: proc,
    catalog: {
      total: V4_DISPLAY_AVENUES.length,
      injectable: V4_DISPLAY_AVENUES.filter((t) => t.status === "active" && t.injectMain).map((t) => t.symbol),
      groups,
      note: "Display names only. Live V4 catalog + encoder live in guardian-v4/ (separate process).",
    },
    avenues: V4_DISPLAY_AVENUES.map((t) => ({ ...t })),
    isolation:
      "Own lockfile guardian-v4/state/guardian-v4.lock + GUARDIAN_V4_* env. Does not share tokens.json / positions.json / agent.js with Uniswap V3.",
  };
}

/**
 * Practice round: inject-all seat + piggy leave-behind + lose-zero hold.
 * Labeled simulated — not a live trade promise.
 */
export function runArenaLearnSim({
  cash = 8,
  seat = "LINK",
  movePct = 0.06,
  piggyPct = null,
  dustFloorUsd = DEFAULT_PIGGY_BANK_MIN_USD,
  hitchCostMult: hitchMult = DEFAULT_HITCH_COST_MULT,
  hitchUsd = 0.35,
  gasUsd = 0.05,
  feeRound = 0.012,
  loseZero = true,
  costEdge = true,
  ethUsd = LIVE_ASSUMPTIONS.ethUsd,
} = {}) {
  const start = Math.max(0.5, Number(cash) || 8);
  const sym = String(seat || "LINK").toUpperCase();
  const env = {
    PIGGY_BANK_PCT: piggyPct != null ? String(piggyPct) : String(DEFAULT_PIGGY_BANK_PCT),
    PIGGY_BANK_MIN_USD: String(dustFloorUsd ?? DEFAULT_PIGGY_BANK_MIN_USD),
    HITCH_COST_MULT: String(hitchMult ?? DEFAULT_HITCH_COST_MULT),
  };
  const pct = piggyBankPct(env, { symbol: sym });
  const floorUsd = piggyBankMinUsd(env, { symbol: sym });
  const mult = hitchCostMult(env);
  const hitchBudget = Math.max(0, Number(hitchUsd) || 0);
  const gas = Math.max(0, Number(gasUsd) || 0);
  const deploy = Math.max(0, start - gas - hitchBudget);
  const tradeEth = deploy / (Number(ethUsd) || LIVE_ASSUMPTIONS.ethUsd);

  let edge = { allow: true, code: "sim_edge_off" };
  if (costEdge) {
    edge = evaluateCostEdgeGate({
      symbol: sym,
      tradeEth,
      hitchCostEth: hitchBudget / (Number(ethUsd) || LIVE_ASSUMPTIONS.ethUsd),
      gasCostEth: gas / (Number(ethUsd) || LIVE_ASSUMPTIONS.ethUsd),
      feePct: feeRound / 2,
      impactPct: LIVE_ASSUMPTIONS.impactPct,
      price: 14,
      recentHigh: 14 * (1 + Math.max(0.03, Number(movePct) || 0)),
      ethUsd: Number(ethUsd) || LIVE_ASSUMPTIONS.ethUsd,
      tradeableUsd: start,
      adaptiveNearTerm: true,
    });
  }

  if (!edge.allow) {
    return {
      ok: true,
      kind: "simulated|practice",
      label: "simulated practice — not a live trade promise",
      seat: sym,
      refused: true,
      refuseReason: edge.code || "COST_EDGE",
      startLiquid: start,
      endLiquid: start,
      endBags: 0,
      endTotal: start,
      piggyLocked: 0,
      hitchOnSell: false,
      sold: false,
      loseZeroHeld: false,
      costEdge: { allow: false, code: edge.code, log: edge.log || null },
      invariants: { ...LOSE_ZERO_INVARIANTS },
      lines: [
        `Arena round · ${sym} · COST_EDGE refused (${edge.code})`,
        `start liquid     $${start.toFixed(2)}`,
        `no buy — capital stays liquid (never invent a fill)`,
        `end total        $${start.toFixed(2)}`,
        "",
        "Label: simulated practice — not a live trade promise.",
      ],
    };
  }

  const afterFees = deploy * (1 - feeRound);
  const fromPct = afterFees * pct;
  const fromUsd = afterFees + 1e-12 >= floorUsd ? floorUsd : 0;
  const piggyLock = Math.min(afterFees, Math.max(fromPct, fromUsd));
  const tradeableBag = Math.max(0, afterFees - piggyLock);
  const move = Number(movePct) || 0;
  const afterMove = tradeableBag * (1 + move);
  const leftoverAfterFees = afterMove - afterMove * (feeRound / 2);
  const wouldLose = leftoverAfterFees <= 0 || move <= 0;
  const canSell = loseZero ? !wouldLose : leftoverAfterFees > 0;
  const sellFees = canSell ? afterMove * (feeRound / 2) : 0;
  const proceeds = canSell ? Math.max(0, afterMove - sellFees) : 0;
  const hitchCover = canSell && proceeds + 1e-12 >= hitchBudget * mult;
  const hitchOnSell = hitchCover;
  const endLiquid = canSell ? (start - deploy + proceeds) : (start - deploy);
  const endBags = canSell ? piggyLock * (1 + Math.max(0, move)) : afterFees * (1 + move);
  const endTotal = endLiquid + endBags;

  const lines = [
    `Arena round · ${sym}`,
    `start liquid     $${start.toFixed(2)}`,
    `deploy to seat   $${deploy.toFixed(2)} (gas $${gas.toFixed(2)} + hitch budget $${hitchBudget.toFixed(2)})`,
    `after buy fees   $${afterFees.toFixed(2)}`,
    `piggy locked     $${piggyLock.toFixed(2)} (${(pct * 100).toFixed(0)}% · floor $${floorUsd.toFixed(2)} · never sold)`,
    `wave move        ${(move * 100).toFixed(1)}%`,
    canSell
      ? `sell proceeds    $${proceeds.toFixed(2)} · hitch ${hitchOnSell ? `on (${mult}× covered)` : "skipped (leftover thin)"} · piggy stays`
      : `hold             no sell (lose-zero) · bag marked $${endBags.toFixed(2)}`,
    `end liquid       $${endLiquid.toFixed(2)}`,
    `end bags/piggy   $${endBags.toFixed(2)}`,
    `end total        $${endTotal.toFixed(2)}  (labeled sim, not live P&L)`,
    "",
    "Label: simulated practice — not a live trade promise.",
  ];

  return {
    ok: true,
    kind: "simulated|practice",
    label: "simulated practice — not a live trade promise",
    seat: sym,
    refused: false,
    startLiquid: start,
    deploy,
    piggyLocked: piggyLock,
    piggyPct: pct,
    dustFloorUsd: floorUsd,
    hitchCostMult: mult,
    hitchOnSell,
    sold: canSell,
    loseZeroHeld: !canSell,
    movePct: move,
    endLiquid,
    endBags,
    endTotal,
    costEdge: { allow: true, code: edge.code || "ok" },
    invariants: { ...LOSE_ZERO_INVARIANTS },
    lines,
  };
}

export function runStorageLoopSim(live = {}) {
  const report = reportInjectCapacity(live);
  return {
    ok: true,
    kind: "simulated|storage-token-loop",
    label: report.assumptions?.label || LIVE_ASSUMPTIONS.label,
    funds: report.funds,
    capacity_now: report.capacity_now,
    horizons: {
      letter_cycles: report.horizons?.letter_cycles,
      clip_64kib_cycles: report.horizons?.clip_64kib_cycles,
      equation: report.horizons?.equation,
    },
    lose_zero: report.lose_zero,
    note: "Piggy stays locked until call-to-add (sim) or /piggyunlock (live). Hitch only if leftover covers.",
  };
}

export function runBoardSim(opts = {}) {
  const arena = runArenaLearnSim(opts);
  const storage = runStorageLoopSim({
    tradeableUsd: Number(opts.cash) || LIVE_ASSUMPTIONS.tradeableUsd,
  });
  return {
    ok: true,
    kind: "simulated|control-board",
    label: "simulated — demo/sim by default; not a live fill. V3 practice only — does not encode V4 swaps.",
    paramsUsed: {
      piggyPct: arena.piggyPct,
      dustFloorUsd: arena.dustFloorUsd,
      hitchCostMult: arena.hitchCostMult,
      loseZero: opts.loseZero !== false,
      costEdge: opts.costEdge !== false,
      peakRide: opts.peakRide !== false,
      haltNewEntries: !!opts.haltNewEntries,
    },
    arena,
    storage,
    invariants: { ...LOSE_ZERO_INVARIANTS },
  };
}

export function boardHealth({
  secretConfigured = false,
  botReady = false,
  v4 = null,
} = {}) {
  const v4s = v4 || v4BoardStatus();
  return {
    ok: true,
    service: "guardian-control-board",
    timestamp: new Date().toISOString(),
    secretConfigured: !!secretConfigured,
    botReady: !!botReady,
    boards: {
      board: { path: BOARD_PATHS.hub, mounted: true, kind: "hub", public: true },
      arena: { path: BOARD_PATHS.arena, mounted: true, kind: "ledger-learn", public: true },
      engine: { path: BOARD_PATHS.engine, mounted: true, kind: "wave-dance", public: true },
      v4: {
        path: "/v4",
        mounted: true,
        kind: "uniswap-v4-offshoot-docs",
        public: true,
        sameProcess: false,
        loadsV4Runtime: false,
        running: !!v4s.running,
        start: v4s.start,
      },
      l1_arena: {
        path: "guardian-protocol dashboard :8787",
        mounted: false,
        kind: "l1-research-sideline",
        note: "npm run dashboard inside guardian-protocol/ — not this Railway webhook",
      },
    },
    apis: {
      params: { path: BOARD_PATHS.params, auth: false, mutate: false },
      snapshot: { path: BOARD_PATHS.snapshot, auth: "optional-live", mutate: false },
      sim: { path: BOARD_PATHS.sim, auth: false, mutate: false },
      v4: { path: BOARD_PATHS.v4, auth: false, mutate: false },
      arenaSnapshot: { path: "/arena/api/snapshot", auth: true, mutate: false },
      arenaQueue: { path: "/arena/api/queue", auth: true, mutate: "queue-only" },
      engineSnapshot: { path: "/engine/api/snapshot", auth: "optional-demo", mutate: false },
      engineQueue: { path: "/engine/api/queue", auth: true, mutate: "queue-only" },
    },
  };
}

export function demoBoardSnapshot(env = process.env) {
  const engine = demoEngineSnapshot();
  return {
    ok: true,
    demo: true,
    kind: "control-board-snapshot",
    params: readLiveParamSnapshot(env),
    engine: {
      demo: true,
      favorite: engine.favorite,
      hitchProve: engine.hitchProve,
      modules: engine.modules,
      waves: engine.waves.map((w) => ({
        symbol: w.symbol,
        price: w.price,
        phase: w.phase,
        holding: w.holding,
        piggyPct: w.piggyPct,
        lights: { lit: w.lights?.lit, total: w.lights?.total, messagePaid: w.lights?.messagePaid },
      })),
    },
    v4: v4BoardStatus(),
    invariants: { ...LOSE_ZERO_INVARIANTS },
    timestamp: new Date().toISOString(),
  };
}
