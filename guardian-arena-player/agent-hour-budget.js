/**
 * Agent hour-budget gate.
 *
 * Cloud / Cursor agents + VITA LLM calls burn ~1 hour of credits, then go dark
 * until refresh. Trading bots must keep running on heuristics meanwhile.
 *
 * When exhausted: agentAssistAllowed() === false → FLY / heuristic brain only.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const DEFAULT_AGENT_HOUR_MS = 60 * 60 * 1000;
export const DEFAULT_LATCH_PATH = join(__dirname, "state", "agent-hour-budget.json");

function emptyState(windowMs = DEFAULT_AGENT_HOUR_MS) {
  return {
    windowStartedAt: 0,
    windowMs,
    burnedMs: 0,
    decisions: 0,
    estimatedUsd: 0,
    exhaustedAt: 0,
    refreshAt: 0,
  };
}

function readLatch(path) {
  if (!existsSync(path)) return emptyState();
  try {
    return { ...emptyState(), ...JSON.parse(readFileSync(path, "utf8")) };
  } catch {
    return emptyState();
  }
}

function writeLatch(path, data) {
  const dir = dirname(path);
  if (dir && dir !== "." && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2));
}

export function agentHourMs(env = process.env) {
  const raw = env.ARENA_AGENT_HOUR_MS ?? env.AGENT_HOUR_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_AGENT_HOUR_MS;
}

export function armAgentHour({
  now = Date.now(),
  windowMs,
  latchPath = DEFAULT_LATCH_PATH,
  force = false,
  env = process.env,
} = {}) {
  const ms = windowMs || agentHourMs(env);
  let state = readLatch(latchPath);
  const exhausted =
    state.exhaustedAt > 0 && state.burnedMs >= (state.windowMs || ms);
  const refreshed = state.refreshAt > 0 && now >= state.refreshAt;
  if (
    force ||
    !state.windowStartedAt ||
    (exhausted && refreshed) ||
    (exhausted && !state.refreshAt)
  ) {
    state = {
      windowStartedAt: now,
      windowMs: ms,
      burnedMs: 0,
      decisions: 0,
      estimatedUsd: 0,
      exhaustedAt: 0,
      refreshAt: 0,
    };
    writeLatch(latchPath, state);
  }
  return snapshotAgentHour({ now, latchPath });
}

export function snapshotAgentHour({
  now = Date.now(),
  latchPath = DEFAULT_LATCH_PATH,
} = {}) {
  const state = readLatch(latchPath);
  const windowMs = Number(state.windowMs) || DEFAULT_AGENT_HOUR_MS;
  const started = Number(state.windowStartedAt) || 0;
  const burned = Math.max(0, Number(state.burnedMs) || 0);
  const wallBurn = started > 0 ? Math.max(burned, now - started) : burned;
  const remainingMs = Math.max(0, windowMs - wallBurn);
  const allowed =
    started > 0 && remainingMs > 0 && !(state.exhaustedAt > 0 && burned >= windowMs);
  return {
    allowed,
    windowStartedAt: started,
    windowMs,
    burnedMs: wallBurn,
    remainingMs,
    decisions: Number(state.decisions) || 0,
    estimatedUsd: Number(state.estimatedUsd) || 0,
    exhaustedAt: Number(state.exhaustedAt) || 0,
    refreshAt: Number(state.refreshAt) || 0,
    brain: allowed ? "live-or-heuristic" : "heuristic-only",
  };
}

export function recordAgentUse({
  durationMs = 0,
  costUsd = 0,
  now = Date.now(),
  latchPath = DEFAULT_LATCH_PATH,
  refreshInMs = DEFAULT_AGENT_HOUR_MS,
} = {}) {
  const state = readLatch(latchPath);
  if (!state.windowStartedAt) {
    state.windowStartedAt = now;
    state.windowMs = state.windowMs || DEFAULT_AGENT_HOUR_MS;
  }
  state.burnedMs =
    Math.max(0, Number(state.burnedMs) || 0) + Math.max(0, Number(durationMs) || 0);
  const wall = now - state.windowStartedAt;
  if (wall > state.burnedMs) state.burnedMs = wall;
  state.decisions = (Number(state.decisions) || 0) + 1;
  state.estimatedUsd =
    (Number(state.estimatedUsd) || 0) + Math.max(0, Number(costUsd) || 0);
  if (state.burnedMs >= (state.windowMs || DEFAULT_AGENT_HOUR_MS)) {
    state.exhaustedAt = now;
    state.refreshAt = now + Math.max(0, Number(refreshInMs) || DEFAULT_AGENT_HOUR_MS);
  }
  writeLatch(latchPath, state);
  return snapshotAgentHour({ now, latchPath });
}

export function agentAssistAllowed(opts = {}) {
  return snapshotAgentHour(opts).allowed;
}

/** Trading loops always continue; this only gates agent assist. */
export function botsRunWithoutAgents() {
  return true;
}
