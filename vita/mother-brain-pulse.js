/**
 * Mother-brain pulse — continuous unlock + cascade + self-read inject avenues.
 *
 * Problem this solves: cascade / brain / agent refine only ran when a human
 * (or Cursor agent) typed Telegram. Between nudges the book went stagnant.
 *
 * Pulse (no Cursor agent required):
 *   1. Unlock HOLD_ALL_SELLS (HOME never-sell stays) — $HOME + decided seats
 *   2. Re-plan Base cascade every tick (LOWER snowball → dividend → HOME/AERO)
 *   3. Stage next viable hop for the trading loop (cascade continuity)
 *   4. Self-read brain avenues: learn cycle + backlog seed (offline, no LLM)
 *   5. Refine OS-builder agent drafts against hardcoded anchors
 *
 * Paid chain seals still need confirm|override / VITAFEED_PAID. Never invents
 * hashes. Never sells red to place code. Mother-brain vitaSave stays banked
 * (VITA_AUTO_INSCRIBE default off) — pulse unlocks *trading + inject avenues*,
 * not unpaired /vitasave spend.
 *
 * Env:
 *   MOTHER_BRAIN_PULSE=yes     — arm continuous tick (default yes when unset)
 *   MOTHER_BRAIN_PULSE=no      — disable
 *   MOTHER_BRAIN_PULSE_LIVE=yes — stage real cascade-hop buys (default SIM)
 *   MOTHER_BRAIN_PULSE_MS      — tick interval ms (default 45000)
 *
 * Telegram: /cascade pulse · /cascade arm · /cascade disarm · /mother pulse
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FORMULA_ID, MAINFRAME_ANCHORS } from "./mainframe.js";
import {
  clearHoldAllSells,
  holdAllSellsStatusLine,
  isHoldAllSells,
} from "../operator-sell-hold.js";
import { VERIFIED_HOME_SYMBOL } from "../operator-rotate.js";
import {
  CASCADE_MAIN_INOUT_HUBS,
  CASCADE_MAIN_SYMBOLS,
  CASCADE_LOWER_SYMBOLS,
  CASCADE_DEFERRED_MAJORS,
  planBaseCascadeProgram,
  formatCascadePredictionCard,
  formatCascadeHierarchyCard,
  parseBaseCascadeCommand,
} from "./base-cascade-program.js";
import {
  unlockSellBarrier,
  planRhBaseCascade,
  fileRhCascadeLearn,
} from "./rh-cascade-rail.js";
import {
  HOME_CASCADE_PIGGY_HOLDER,
  AERO_CASCADE_INOUT,
  DEFAULT_CASCADE_MESSAGE,
  cascadeCadenceStatus,
  CASCADE_TARGET_HOPS,
  CASCADE_WINDOW_MS,
} from "./message-cascade.js";
import { activateBrainLearnCycle, formatBrainLearnCard } from "./brain-learn.js";
import { buildBrainSeedBody, BRAIN_SEED_MAGIC } from "./brain-seed.js";
import {
  seedFeedBacklogFromMemory,
  enqueueBrainStageOnBacklog,
  listFeedBacklog,
  peekNextFeedBacklogItem,
} from "./vita-feed-backlog.js";
import {
  listOsAgents,
  runOsSandbox,
  refineLexiconPair,
  loadOsBuilderState,
} from "./os-builder.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const MEMORY_DIR = join(HERE, "memory");
const STRANDS_DIR = join(HERE, "strands");
const LEDGER_PATH = join(MEMORY_DIR, "mother-brain-pulse-ledger.json");
const LEARN_PATH = join(MEMORY_DIR, "mother-brain-pulse-learn.json");
const STRAND_PATH = join(STRANDS_DIR, "mother-brain-pulse.json");

export const MOTHER_BRAIN_PULSE_ID = "mother-brain-pulse-v1";
export const MOTHER_BRAIN_PULSE_MAGIC = "§MOTHERPULSE§";
export const MOTHER_BRAIN_PULSE_LABEL = "MOTHER_BRAIN_PULSE";
export const MOTHER_BRAIN_PULSE_ENV = "MOTHER_BRAIN_PULSE";
export const MOTHER_BRAIN_PULSE_LIVE_ENV = "MOTHER_BRAIN_PULSE_LIVE";
export const MOTHER_BRAIN_PULSE_MS_ENV = "MOTHER_BRAIN_PULSE_MS";
export const DEFAULT_PULSE_MS = 45_000;

/** Decided cascade seats — hubs + MAIN + LOWER (deferred stay off snowball). */
export const UNLOCKED_CASCADE_TOKENS = Object.freeze([
  ...CASCADE_MAIN_INOUT_HUBS,
  ...CASCADE_MAIN_SYMBOLS,
  ...CASCADE_LOWER_SYMBOLS,
]);

function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function normSym(s) {
  return String(s || "").trim().toUpperCase();
}

function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function ensureDir(p) {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

function readJson(path, fallback) {
  try {
    if (!existsSync(path)) return fallback;
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(path, data) {
  ensureDir(dirname(path));
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

function shortHex(text, n = 8) {
  return createHash("sha256").update(String(text || ""), "utf8").digest("hex").slice(0, n);
}

function envArmed(env = process.env) {
  const raw = String(env?.[MOTHER_BRAIN_PULSE_ENV] ?? "").trim().toLowerCase();
  if (raw === "no" || raw === "0" || raw === "false" || raw === "off") return false;
  // Default ON — continuous cascade must not wait for a Cursor agent.
  if (raw === "" || raw === "yes" || raw === "1" || raw === "true" || raw === "on") return true;
  return true;
}

function envLive(env = process.env) {
  return String(env?.[MOTHER_BRAIN_PULSE_LIVE_ENV] ?? "").trim().toLowerCase() === "yes";
}

function pulseMs(env = process.env) {
  const n = Number(env?.[MOTHER_BRAIN_PULSE_MS_ENV]);
  if (Number.isFinite(n) && n >= 5_000 && n <= 600_000) return Math.floor(n);
  return DEFAULT_PULSE_MS;
}

/** @type {{ lastTickAt: number, hopTimestamps: number[], armed: boolean, lastPlan: object|null, lastStage: object|null, tickCount: number }} */
const _runtime = {
  lastTickAt: 0,
  hopTimestamps: [],
  armed: true,
  lastPlan: null,
  lastStage: null,
  lastBrain: null,
  lastAgents: null,
  tickCount: 0,
};

export function motherBrainPulseRuntime() {
  return _runtime;
}

export function resetMotherBrainPulseForTests() {
  _runtime.lastTickAt = 0;
  _runtime.hopTimestamps = [];
  _runtime.armed = true;
  _runtime.lastPlan = null;
  _runtime.lastStage = null;
  _runtime.lastBrain = null;
  _runtime.lastAgents = null;
  _runtime.tickCount = 0;
}

/**
 * Fully unlock mother-brain trading path:
 *   HOLD_ALL_SELLS=no · HOME never-sell · pulse armed · live optional.
 */
export function unlockMotherBrainForTrading(env = process.env) {
  const unlock = unlockSellBarrier(env);
  clearHoldAllSells(env);
  if (env && typeof env === "object") {
    env[MOTHER_BRAIN_PULSE_ENV] = "yes";
  }
  _runtime.armed = true;
  return {
    ok: true,
    unlocked: true,
    holdAllSells: isHoldAllSells(env),
    homeNeverSell: true,
    homeSymbol: VERIFIED_HOME_SYMBOL,
    homeAddress: HOME_CASCADE_PIGGY_HOLDER.address,
    aeroHub: AERO_CASCADE_INOUT.symbol,
    hubs: [...CASCADE_MAIN_INOUT_HUBS],
    main: [...CASCADE_MAIN_SYMBOLS],
    lower: [...CASCADE_LOWER_SYMBOLS],
    deferred: [...CASCADE_DEFERRED_MAJORS],
    unlockedTokens: [...UNLOCKED_CASCADE_TOKENS],
    pulseArmed: envArmed(env),
    pulseLive: envLive(env),
    pulseMs: pulseMs(env),
    status: holdAllSellsStatusLine(env),
    unlock,
    note:
      "Cascade sells unlocked. $HOME is main cascade + piggy (never-sell). " +
      "Pulse ticks without a Cursor agent. vitaSave stays banked until VITA_AUTO_INSCRIBE=yes.",
  };
}

export function armMotherBrainPulse(env = process.env) {
  if (env && typeof env === "object") env[MOTHER_BRAIN_PULSE_ENV] = "yes";
  _runtime.armed = true;
  return { ok: true, armed: true, ms: pulseMs(env), live: envLive(env) };
}

export function disarmMotherBrainPulse(env = process.env) {
  if (env && typeof env === "object") env[MOTHER_BRAIN_PULSE_ENV] = "no";
  _runtime.armed = false;
  return { ok: true, armed: false };
}

/**
 * Build cascade seats from catalog marks (RH overlay optional).
 */
export function seatsFromCatalog(catalog = [], { at = Date.now() } = {}) {
  const seats = [];
  for (const t of catalog || []) {
    const sym = normSym(t.symbol);
    if (!sym) continue;
    if (t.frozen === true) continue;
    const price = num(t.price, num(t.lastPrice, 0));
    if (!(price > 0) && !UNLOCKED_CASCADE_TOKENS.includes(sym)) continue;
    seats.push({
      ...t,
      symbol: sym,
      price: price > 0 ? price : num(t.mark, 0) || undefined,
      dataSource: t.dataSource || "base-catalog",
      rail: "base",
      waveDataSource: "token-embedded",
      predictedUp: t.predictedUp !== false,
      cascadeAvailable: t.cascadeAvailable !== false,
      aeroMain: sym === "AERO",
      homeMain: sym === VERIFIED_HOME_SYMBOL,
      peaks: t.peaks || t.wavePeaks,
      troughs: t.troughs || t.waveTroughs,
      maxPeak: t.maxPeak || t.peak,
      minTrough: t.minTrough || t.trough,
      bagUsd: num(t.bagUsd, num(t.balance, 0) * price),
      dividendPct: num(t.dividendPct, 0),
      at,
    });
  }
  // Ensure hubs exist even if temporarily unpriced (still ranked).
  for (const hub of CASCADE_MAIN_INOUT_HUBS) {
    if (!seats.some((s) => s.symbol === hub)) {
      seats.push({
        symbol: hub,
        price: hub === "AERO" ? 1 : 0.01,
        cascadeAvailable: true,
        aeroMain: hub === "AERO",
        homeMain: hub === VERIFIED_HOME_SYMBOL,
        dataSource: "hub-seed",
        rail: "base",
        predictedUp: true,
        minTrough: hub === "AERO" ? 0.7 : 0.005,
        maxPeak: hub === "AERO" ? 1.4 : 0.02,
      });
    }
  }
  return seats;
}

/**
 * Decide whether pulse may stage a buy hop (SIM vs LIVE).
 * Never stages HOME sell. Never invents hashes.
 */
export function stageCascadeHopFromPlan(plan, {
  live = false,
  now = Date.now(),
  hopTimestamps = [],
} = {}) {
  const next = plan?.prediction?.next || plan?.program?.prediction?.next || null;
  const capital = plan?.capital || plan?.program?.capital || null;
  const cadence = cascadeCadenceStatus(hopTimestamps, {
    now,
    targetHops: CASCADE_TARGET_HOPS,
    windowMs: CASCADE_WINDOW_MS,
  });

  if (!next || next.viable === false) {
    return {
      ok: false,
      staged: false,
      reason: next ? "next_underfunded" : "no_next_hop",
      next: next || null,
      capital,
      cadence,
      live: !!live,
      sim: true,
    };
  }

  const sym = normSym(next.symbol);
  if (sym === VERIFIED_HOME_SYMBOL && String(next.action || "").includes("sell")) {
    return {
      ok: false,
      staged: false,
      reason: "home_never_sell",
      next,
      capital,
      cadence,
      live: !!live,
      sim: true,
    };
  }

  const usd = Math.max(0, num(next.usd, 0));
  if (!(usd > 0)) {
    return {
      ok: false,
      staged: false,
      reason: "zero_usd",
      next,
      capital,
      cadence,
      live: !!live,
      sim: true,
    };
  }

  const cmd = {
    symbol: sym,
    action: "buy",
    usd,
    source: "MOTHER_BRAIN_PULSE",
    cascade: true,
    pulse: true,
    hopAction: next.action,
    phase: plan?.prediction?.phase || plan?.program?.prediction?.phase || null,
    reason: `💓 MOTHER PULSE ${next.action || "hop"} → ${sym}`,
    sim: !live,
  };

  return {
    ok: true,
    staged: !!live,
    sim: !live,
    live: !!live,
    command: cmd,
    next,
    capital,
    cadence,
    note: live
      ? "LIVE — trading loop should queue cascade hop buy"
      : "SIM — plan only; set MOTHER_BRAIN_PULSE_LIVE=yes to stage buys",
  };
}

/**
 * Offline brain self-read avenue: activate learn + park seed/stage on backlog.
 * No Anthropic / Cursor agent required.
 */
export function pulseBrainSelfReadAvenue({
  forceLearn = false,
  seedBacklog = true,
} = {}) {
  const backlogBefore = listFeedBacklog({ status: "pending", limit: 200 });
  const pending = Array.isArray(backlogBefore?.items) ? backlogBefore.items : [];

  let learn = null;
  const shouldLearn = forceLearn || pending.length < 3;
  if (shouldLearn) {
    try {
      learn = activateBrainLearnCycle({
        note: "Mother-brain pulse self-read — old→new + peer + zero-proof without Cursor agent",
      });
      if (learn?.stageBody) {
        enqueueBrainStageOnBacklog({
          stageBody: learn.stageBody,
          cycleIndex: learn.cycleIndex,
        });
      }
    } catch (e) {
      learn = { ok: false, error: e.message };
    }
  }

  let seed = null;
  if (seedBacklog) {
    try {
      seed = seedFeedBacklogFromMemory({
        includeBrainSeed: true,
        includeTopics: true,
        maxTopics: 8,
      });
    } catch (e) {
      seed = { ok: false, error: e.message };
    }
  }

  const peek = peekNextFeedBacklogItem();
  const nextItem = peek?.ok ? (peek.public || peek.item) : null;
  const mindPreview = buildBrainSeedBody().slice(0, 160);

  return {
    ok: true,
    avenue: "brain-self-read-inject",
    magic: BRAIN_SEED_MAGIC,
    learn: learn
      ? {
          ok: learn.ok !== false,
          cycleIndex: learn.cycleIndex || null,
          peer: learn.peer?.verdict || null,
          card: learn.cycleIndex != null
            ? formatBrainLearnCard(learn).slice(0, 400)
            : null,
          error: learn.error || null,
        }
      : { skipped: true, reason: "backlog_already_fed" },
    seed,
    nextBacklog: nextItem
      ? { id: nextItem.id, topic: nextItem.topic, status: nextItem.status }
      : null,
    mindPreview,
    note: "Backlog drains via /vitafeed next|confirm without agent AI; pulse keeps it fed",
  };
}

/**
 * Refine OS-builder agent drafts — sandbox vs hardcoded anchors only.
 */
export function pulseRefineAgents({ maxAgents = 6 } = {}) {
  const agents = listOsAgents().slice(0, Math.max(1, maxAgents));
  const results = [];
  for (const a of agents) {
    const id = a.agentId || a.id;
    if (!id) continue;
    try {
      const sandbox = runOsSandbox({ agentId: id, keyLocCovered: true, dualComplete: true });
      results.push({
        id,
        ok: sandbox?.ok !== false,
        pass: sandbox?.passed ?? sandbox?.pass ?? sandbox?.ok ?? null,
        followHead: sandbox?.follow?.head ?? sandbox?.followHead ?? null,
        note: sandbox?.note || sandbox?.summary || "sandbox",
      });
    } catch (e) {
      results.push({ id, ok: false, error: e.message });
    }
  }
  // If no drafts yet, still warm a watcher-eureka sandbox slot for refine lane.
  if (!results.length) {
    try {
      const sandbox = runOsSandbox({
        agentId: "watcher-eureka",
        keyLocCovered: true,
        dualComplete: true,
      });
      results.push({
        id: "watcher-eureka",
        ok: sandbox?.ok !== false,
        pass: sandbox?.passed ?? sandbox?.pass ?? null,
        seeded: true,
        note: "seed refine lane",
      });
    } catch (e) {
      results.push({ id: "watcher-eureka", ok: false, error: e.message });
    }
  }
  // Always refine one lexicon pair so language lane stays warm.
  try {
    refineLexiconPair({
      human: "cascade continuously without a Cursor agent",
      machine: "motherBrainPulse=tick|unlock|stage|brainSelfRead",
    });
  } catch { /* optional */ }

  const state = loadOsBuilderState();
  return {
    ok: true,
    avenue: "agent-refine",
    agentCount: agents.length,
    results,
    draftCount: (state?.agents || []).length,
    note: "Agents refine offline against anchors; seal still confirm|override",
  };
}

function emptyLedger() {
  return {
    id: MOTHER_BRAIN_PULSE_ID,
    filingLabel: MOTHER_BRAIN_PULSE_LABEL,
    magic: MOTHER_BRAIN_PULSE_MAGIC,
    formula: FORMULA_ID,
    neverInventHashes: true,
    neverForget: true,
    createdAt: new Date().toISOString(),
    updatedAt: null,
    ticks: [],
  };
}

function appendPulseLedger(row) {
  const ledger = readJson(LEDGER_PATH, emptyLedger());
  ledger.ticks = Array.isArray(ledger.ticks) ? ledger.ticks : [];
  ledger.ticks.push(row);
  if (ledger.ticks.length > 200) ledger.ticks = ledger.ticks.slice(-200);
  ledger.updatedAt = row.at;
  writeJson(LEDGER_PATH, ledger);
  return ledger;
}

function filePulseLearn(tick) {
  const learn = readJson(LEARN_PATH, {
    id: "mother-brain-pulse-learn-v1",
    filingLabel: MOTHER_BRAIN_PULSE_LABEL,
    notes: [],
  });
  learn.notes.push({
    at: tick.at,
    topic: "mother-brain-pulse",
    text:
      `Pulse #${tick.tickCount} · unlocked=${tick.unlock?.unlocked} · ` +
      `phase=${tick.plan?.prediction?.phase || "—"} · ` +
      `next=${tick.stage?.next?.symbol || "—"} $${tick.stage?.next?.usd ?? "—"} · ` +
      `live=${tick.live} staged=${tick.stage?.staged} · ` +
      `brain=${tick.brain?.learn?.cycleIndex || tick.brain?.learn?.skipped || "—"} · ` +
      `agents=${tick.agents?.agentCount ?? 0}. HOME never-sell. No invented hashes.`,
    locations: [],
  });
  if (learn.notes.length > 120) learn.notes = learn.notes.slice(-120);
  writeJson(LEARN_PATH, learn);
  writeJson(STRAND_PATH, {
    id: MOTHER_BRAIN_PULSE_ID,
    filingLabel: MOTHER_BRAIN_PULSE_LABEL,
    magic: MOTHER_BRAIN_PULSE_MAGIC,
    at: tick.at,
    sparse: true,
    hubs: [...CASCADE_MAIN_INOUT_HUBS],
    unlockedTokens: [...UNLOCKED_CASCADE_TOKENS],
    learn:
      "Mother-brain pulse keeps Base cascade + brain self-read inject avenues active " +
      "without a Cursor agent. Unlock HOLD_ALL_SELLS; HOME piggy never-sell; stage next " +
      "LOWER→dividend→HOME/AERO hop; feed backlog; refine OS agents vs anchors. " +
      "vitaSave banked. Never invent hashes. Never sell red to place code.",
  });
}

/**
 * One continuous pulse tick. Safe to call from the trading loop.
 * Returns a stage command when LIVE + viable next hop.
 */
export function tickMotherBrainPulse({
  catalog = [],
  rhRows = [],
  liquidUsd = 0,
  homeBagUsd = 11,
  ethUsd = 2700,
  bagsDividendUsd = 0,
  hopTimestamps = null,
  env = process.env,
  now = Date.now(),
  force = false,
  forceLearn = false,
} = {}) {
  if (!force && !envArmed(env)) {
    return { ok: false, skipped: true, reason: "pulse_disarmed" };
  }
  if (!force && !_runtime.armed) {
    return { ok: false, skipped: true, reason: "runtime_disarmed" };
  }

  const interval = pulseMs(env);
  if (!force && _runtime.lastTickAt && now - _runtime.lastTickAt < interval) {
    return {
      ok: true,
      skipped: true,
      reason: "cooldown",
      waitMs: interval - (now - _runtime.lastTickAt),
      lastTickAt: _runtime.lastTickAt,
    };
  }

  const unlock = unlockMotherBrainForTrading(env);
  const hops = hopTimestamps || _runtime.hopTimestamps;
  const live = envLive(env);

  let plan;
  if (rhRows?.length) {
    plan = planRhBaseCascade({
      rhRows,
      catalog,
      hopTimestamps: hops,
      message: DEFAULT_CASCADE_MESSAGE,
      unlockSells: false, // already unlocked above
      env,
      at: now,
      liquidUsd,
      homeBagUsd,
      ethUsd,
      bagsDividendUsd,
      maxHops: CASCADE_TARGET_HOPS,
    });
  } else {
    const seats = seatsFromCatalog(catalog, { at: now });
    const program = planBaseCascadeProgram({
      seats,
      liquidUsd,
      homeBagUsd,
      ethUsd,
      bagsDividendUsd,
      hopTimestamps: hops,
      message: DEFAULT_CASCADE_MESSAGE,
      maxHops: CASCADE_TARGET_HOPS,
    });
    plan = {
      id: MOTHER_BRAIN_PULSE_ID,
      rail: "base",
      program,
      cascade: program.cascade,
      capital: program.capital,
      prediction: program.prediction,
      seatCount: seats.length,
      seats,
      unlock,
      neverInventHashes: true,
    };
  }

  const stage = stageCascadeHopFromPlan(plan, {
    live,
    now,
    hopTimestamps: hops,
  });

  let brain = null;
  let agents = null;
  // Brain self-read every 4th tick (or when forced) — backlog still seeded lightly.
  const brainDue = forceLearn || _runtime.tickCount % 4 === 0;
  try {
    brain = pulseBrainSelfReadAvenue({
      forceLearn: brainDue,
      seedBacklog: brainDue || _runtime.tickCount === 0,
    });
  } catch (e) {
    brain = { ok: false, error: e.message };
  }
  try {
    agents = brainDue ? pulseRefineAgents() : { ok: true, skipped: true, reason: "throttle" };
  } catch (e) {
    agents = { ok: false, error: e.message };
  }

  if (stage.staged && stage.command) {
    _runtime.hopTimestamps.push(now);
    if (_runtime.hopTimestamps.length > 64) {
      _runtime.hopTimestamps = _runtime.hopTimestamps.slice(-64);
    }
  }

  _runtime.lastTickAt = now;
  _runtime.lastPlan = plan;
  _runtime.lastStage = stage;
  _runtime.lastBrain = brain;
  _runtime.lastAgents = agents;
  _runtime.tickCount += 1;

  const tick = {
    at: new Date(now).toISOString(),
    tickCount: _runtime.tickCount,
    commit8: shortHex(JSON.stringify({
      phase: plan?.prediction?.phase,
      next: stage?.next?.symbol,
      usd: stage?.next?.usd,
      t: now,
    })),
    unlock: {
      unlocked: unlock.unlocked,
      holdAllSells: unlock.holdAllSells,
      homeNeverSell: unlock.homeNeverSell,
      status: unlock.status,
    },
    plan: {
      prediction: plan?.prediction
        ? {
            phase: plan.prediction.phase,
            next: plan.prediction.next,
            goal: plan.prediction.goal
              ? { symbol: plan.prediction.goal.symbol, tier: plan.prediction.goal.tier }
              : null,
          }
        : null,
      capital: plan?.capital
        ? {
            deployableUsd: plan.capital.deployableUsd,
            homeBagUsd: plan.capital.homeBagUsd,
            thinBook: plan.capital.thinBook,
          }
        : null,
      seatCount: plan?.seatCount ?? plan?.seats?.length ?? 0,
    },
    stage: {
      ok: stage.ok,
      staged: stage.staged,
      sim: stage.sim,
      reason: stage.reason || null,
      next: stage.next
        ? { symbol: stage.next.symbol, usd: stage.next.usd, action: stage.next.action, viable: stage.next.viable }
        : null,
      command: stage.command || null,
      cadence: stage.cadence || null,
    },
    brain,
    agents,
    live,
    wallet: MAINFRAME_ANCHORS.wallet,
    neverInventHashes: true,
  };

  try { appendPulseLedger(tick); } catch { /* disk optional */ }
  try { filePulseLearn(tick); } catch { /* disk optional */ }
  try {
    if (plan?.trail || plan?.program) fileRhCascadeLearn(plan);
  } catch { /* optional */ }

  return {
    ok: true,
    skipped: false,
    tick,
    unlock,
    plan,
    stage,
    brain,
    agents,
    command: stage.staged ? stage.command : null,
    intervalMs: interval,
  };
}

export function formatMotherBrainPulseCard(result) {
  if (!result) return "MOTHER_BRAIN_PULSE — empty";
  if (result.skipped && result.reason === "cooldown") {
    return `💓 Pulse cooldown · wait ${Math.ceil((result.waitMs || 0) / 1000)}s`;
  }
  if (result.skipped) {
    return `💓 Pulse skipped — ${esc(result.reason || "?")}`;
  }
  const t = result.tick || {};
  const next = t.stage?.next;
  const lines = [
    `💓 <b>MOTHER BRAIN PULSE</b> #${t.tickCount || "?"} · <code>${esc(t.commit8 || "")}</code>`,
    esc(t.unlock?.status || result.unlock?.status || ""),
    `$HOME ${HOME_CASCADE_PIGGY_HOLDER.address.slice(0, 10)}… · never-sell · hub w/ AERO`,
    `Tokens unlocked: ${UNLOCKED_CASCADE_TOKENS.slice(0, 12).join(" ")}${UNLOCKED_CASCADE_TOKENS.length > 12 ? "…" : ""}`,
    `Phase <b>${esc(t.plan?.prediction?.phase || "—")}</b> · deployable $${Number(t.plan?.capital?.deployableUsd || 0).toFixed(2)} · HOME $${Number(t.plan?.capital?.homeBagUsd || 0).toFixed(2)} locked`,
  ];
  if (next) {
    const mode = t.stage?.staged ? "LIVE STAGE" : "SIM";
    lines.push(
      `▶ NEXT <b>${esc(next.symbol)}</b> $${Number(next.usd).toFixed(2)} · ${esc(next.action || "")} · ${mode}`,
    );
  } else {
    lines.push(`▶ NEXT — ${esc(t.stage?.reason || "waiting wave-ready seat")}`);
  }
  if (t.stage?.cadence) {
    const c = t.stage.cadence;
    lines.push(`Cadence ${c.hops}/${c.target} in ${c.windowMs / 60_000}m ${c.onPace ? "✅" : "⚡ shortfall " + c.shortfall}`);
  }
  if (t.brain?.learn?.cycleIndex) {
    lines.push(`Brain learn #${t.brain.learn.cycleIndex} peer=${esc(t.brain.learn.peer || "?")}`);
  } else if (t.brain?.learn?.skipped) {
    lines.push("Brain avenue: backlog already fed");
  }
  if (t.agents) {
    lines.push(`Agents refined: ${t.agents.agentCount || 0} drafts`);
  }
  lines.push(
    "",
    `Live buys: ${result.live || t.live ? "ON" : "SIM (MOTHER_BRAIN_PULSE_LIVE=yes to stage)"}`,
    "vitaSave banked · confirm|override still gates paid inject",
    "No Cursor agent required — pulse ticks in the trading loop",
  );
  if (result.plan?.prediction) {
    lines.push("", formatCascadePredictionCard(result.plan));
  }
  return lines.join("\n");
}

export function parseMotherBrainPulseCommand(raw) {
  const base = parseBaseCascadeCommand(raw);
  const src = String(raw || "").trim();
  const low = src.toLowerCase();
  if (
    low === "/cascade pulse" ||
    low === "/cascade tick" ||
    low === "/mother" ||
    low === "/mother pulse" ||
    low === "/motherbrain" ||
    low === "/mother brain" ||
    low === "/motherbrain pulse"
  ) {
    return { ok: true, action: "pulse" };
  }
  if (low === "/cascade arm" || low === "/mother arm" || low === "/motherbrain arm") {
    return { ok: true, action: "arm" };
  }
  if (low === "/cascade disarm" || low === "/mother disarm" || low === "/motherbrain disarm") {
    return { ok: true, action: "disarm" };
  }
  if (low === "/cascade unlock" || low === "/cascade sells" || low === "/mother unlock") {
    return { ok: true, action: "unlock" };
  }
  if (base.ok) return base;
  return { ok: false };
}

export function formatMotherBrainUnlockCard(unlock) {
  if (!unlock) return "Unlock empty.";
  return [
    `🔓 <b>MOTHER BRAIN UNLOCKED</b>`,
    esc(unlock.status),
    `$HOME main cascade + piggy · ${unlock.homeAddress?.slice(0, 12) || "…"}…`,
    `Hubs: ${(unlock.hubs || []).join(" + ")}`,
    `MAIN: ${(unlock.main || []).join(" ")}`,
    `LOWER: ${(unlock.lower || []).join(" ")}`,
    `DEFERRED: ${(unlock.deferred || []).join(" ")}`,
    `Pulse: ${unlock.pulseArmed ? "ARMED" : "off"} · ${unlock.pulseMs}ms · live=${unlock.pulseLive ? "yes" : "SIM"}`,
    esc(unlock.note || ""),
    "",
    formatCascadeHierarchyCard(),
  ].join("\n");
}

export {
  CASCADE_MAIN_INOUT_HUBS,
  CASCADE_MAIN_SYMBOLS,
  CASCADE_LOWER_SYMBOLS,
  formatCascadeHierarchyCard,
};
