/**
 * Arena player loop — optional offshoot activated with ARENA_PLAYER=yes.
 * V3/V4 trading bots do not import this unless explicitly wired.
 */

import { compileStats } from "./config.js";
import {
  agentAssistAllowed,
  armAgentHour,
  botsRunWithoutAgents,
  recordAgentUse,
  snapshotAgentHour,
} from "./agent-hour-budget.js";
import { selectBrain } from "./brain.js";
import { createHeuristicBrain } from "./heuristic-brain.js";
import { PaperAccount } from "./paper-account.js";
import { createSimMarket } from "./sim-market.js";
import { CLASS_STRATEGY, DEFAULT_STRATEGY } from "./types.js";

export function isArenaPlayerEnabled(env = process.env) {
  const v = String(env.ARENA_PLAYER || env.GUARDIAN_ARENA_PLAYER || "")
    .trim()
    .toLowerCase();
  return v === "yes" || v === "true" || v === "1" || v === "on";
}

/**
 * Run N paper/sim ticks as an arena player.
 * When agent-hour is burned, always uses heuristic brain (bots stay alive).
 */
export async function runArenaPlayer({
  mode = "sim",
  ticks = 50,
  agentClass = "FLY",
  stats = { spd: 6, rsk: 4, ptn: 0, gas: 5 },
  provider = "heuristic",
  seed = 42,
  initialEth = 10,
  latchPath,
  liveBrain = null,
  now = Date.now(),
  log = console.log,
} = {}) {
  if (!botsRunWithoutAgents()) {
    throw new Error("invariant broken: bots must run without agents");
  }

  const cfg = compileStats(stats, { provider });
  const market = createSimMarket({ seed });
  const account = new PaperAccount({ initialEth, feeBps: cfg.feeBps });
  const heuristic = createHeuristicBrain();
  const strategy = CLASS_STRATEGY[agentClass] || DEFAULT_STRATEGY;

  armAgentHour({ now, latchPath, force: false });
  let assist = agentAssistAllowed({ now, latchPath });
  // Paid live brain only while assist window open AND provider isn't heuristic.
  const wantLive = Boolean(liveBrain) && provider !== "heuristic";
  let brain = selectBrain({
    assistAllowed: assist && wantLive,
    liveBrain,
    heuristicBrain: heuristic,
  });

  const pairs = await market.listPairs();
  const tape = [];
  let pairIdx = 0;

  log(
    `[arena-player] mode=${mode} class=${agentClass} provider=${cfg.provider}` +
      ` model=${cfg.model} cost/dec=$${cfg.costPerDecisionUsd.toFixed(4)}` +
      ` assist=${assist ? "on" : "heuristic-only"} ticks=${ticks}`,
  );

  for (let i = 0; i < ticks; i++) {
    const tickNow = now + i * cfg.pollIntervalMs;
    const snapHour = snapshotAgentHour({ now: tickNow, latchPath });
    if (snapHour.allowed !== assist) {
      assist = snapHour.allowed;
      brain = selectBrain({
        assistAllowed: assist && wantLive,
        liveBrain,
        heuristicBrain: heuristic,
      });
      log(
        `[arena-player] hour-gate → ${assist ? "assist-available" : "heuristic-only"}` +
          ` remaining=${Math.round(snapHour.remainingMs / 1000)}s`,
      );
    }

    const pair = pairs[pairIdx % pairs.length];
    pairIdx += 1;
    const snap = await market.snapshot(pair, cfg.ctxCandles);
    const inPosition = Boolean(account.position);
    const verdict = await brain.decide(snap, {
      maxSizeEth: cfg.positionSizeEth * (strategy.sizeMult || 1),
      strategy,
      agentClass,
      inPosition,
    });

    // Only burn agent-hour when a paid live brain actually ran.
    if (assist && wantLive) {
      recordAgentUse({
        durationMs: Math.max(1, Math.floor(cfg.pollIntervalMs / 4)),
        costUsd: cfg.costPerDecisionUsd,
        now: tickNow,
        latchPath,
      });
    }

    let fill = null;
    if (verdict.action === "BUY" && !inPosition && verdict.sizeEth > 0) {
      fill = account.buy(snap, verdict.sizeEth, cfg.slippageBps);
    } else if (verdict.action === "SELL" && inPosition) {
      fill = account.sell(snap, cfg.slippageBps);
    }

    const mark = account.mark(snap);
    tape.push({
      tick: i,
      pair,
      action: verdict.action,
      reason: verdict.reason,
      fill: fill ? { side: fill.side, pnlEth: fill.pnlEth ?? null } : null,
      equityEth: mark.equityEth,
      brain: snapHour.brain,
    });
  }

  const lastPair = pairs[0];
  const lastSnap = await market.snapshot(lastPair, cfg.ctxCandles);
  const mark = account.mark(lastSnap);
  const hour = snapshotAgentHour({ now: now + ticks * cfg.pollIntervalMs, latchPath });

  return {
    mode,
    ticks,
    agentClass,
    config: cfg,
    equityEth: mark.equityEth,
    realizedPnlEth: account.realizedPnlEth,
    cashEth: account.cashEth,
    fills: account.fills.length,
    hour,
    tape,
    botsRunWithoutAgents: true,
  };
}
