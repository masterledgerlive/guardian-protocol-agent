/**
 * ⏱️ VITA COURSE — hourly scorecard + course correction
 * ─────────────────────────────────────────────────────────────────────────────
 * Every hour: did injection land without loss? Are locations sealing? Is
 * §TOKEN§ quality holding under the 2000-char budget? If not, change course
 * (squash harder, stay at tag, keep /prove as love-note genesis, etc.).
 *
 * Does not invent P&L. Sealed locations require real hashes. Leftover skips
 * are not losses — they are lose-zero working.
 */

import { VITA_CHAR_BUDGET, VITA_LOVE_KEY, refineVitaPacket, vitaQuality } from "./vita-parse.js";
import { locDepositoryStatus, squashLocations } from "./vita-locations.js";
import {
  ensureGenesisMemory,
  getLastVitaPacket,
  resolveHitchMode,
  setHitchModeOverride,
  setLastVitaPacket,
  vitaRouterStatus,
} from "./vita-router.js";

export const COURSE_INTERVAL_MS = 60 * 60 * 1000;

export function evaluateVitaCourse({
  sealedLocations,
  pendingLocations,
  hitchAttempts = 0,
  hitchSealed = 0,
  hitchSkippedLeftover = 0,
  parseQuality = null,
  lastPacket = "",
  realizedLossUsd = 0,
  env = process.env,
  now = Date.now(),
} = {}) {
  const loc = locDepositoryStatus();
  const sealed = sealedLocations != null ? Number(sealedLocations) : loc.sealed;
  const pending = pendingLocations != null ? Number(pendingLocations) : loc.pending;
  const quality = parseQuality || (lastPacket ? vitaQuality(lastPacket) : null);
  const mode = resolveHitchMode(env);
  const squash = squashLocations();

  const issues = [];
  const actions = [];

  if (Number(realizedLossUsd) < 0) {
    issues.push("realized_loss");
    actions.push("hold hitch — lose-zero; do not grow payload until leftover green");
  }
  if (hitchAttempts > 0 && hitchSealed === 0 && hitchSkippedLeftover === hitchAttempts) {
    issues.push("all_skips_leftover");
    actions.push("stay at §$STORE§ tag or skip — leftover too thin; not a memory bug");
  }
  if (hitchAttempts >= 3 && hitchSealed === 0 && hitchSkippedLeftover < hitchAttempts) {
    issues.push("inject_without_seal");
    actions.push("do not claim sent; wait for txHash seal before advancing loc tip");
  }
  if (sealed >= 8 && (squash.delta || []).length > 6) {
    issues.push("loc_not_squashed");
    actions.push("squash §LOC§ to last-6 shorts + tip/root — hitch budget is the point");
  }
  if (quality && quality.lossy) {
    issues.push("key_fact_loss");
    actions.push("restore §KEY§ eureka♥Krystian,Kai,Koda before adding LEARN/VISION");
  }
  if (quality && !quality.withinBudget) {
    issues.push("over_budget");
    actions.push("clip to " + VITA_CHAR_BUDGET + " chars; drop STACK/WHO first");
  }
  if (pending > sealed && sealed === 0 && pending > 4) {
    issues.push("pending_without_seal");
    actions.push("stop enqueueing drafts; confirm one location first");
  }

  const injectRate = hitchAttempts > 0 ? hitchSealed / hitchAttempts : null;
  let score = 50;
  if (quality) score = Math.round((score + quality.score) / 2);
  if (sealed > 0) score += Math.min(20, sealed);
  if (hitchSkippedLeftover > 0 && hitchSealed === 0) score += 5; // lose-zero behaving
  if (issues.includes("realized_loss")) score = Math.min(score, 20);
  if (issues.includes("key_fact_loss")) score = Math.min(score, 40);
  score = Math.max(0, Math.min(100, score));

  const achieving = score >= 55 && !issues.includes("realized_loss") && !issues.includes("key_fact_loss");

  let nextMode = mode;
  if (issues.includes("realized_loss") || issues.includes("all_skips_leftover")) {
    nextMode = mode === "hat" ? "vita" : mode;
  }
  if (issues.includes("key_fact_loss") && mode === "eureka") {
    actions.push("stay eureka until KEY is re-encoded, then switch back to vita");
  }

  return {
    kind: "vita-hourly-course",
    generatedAt: new Date(now).toISOString(),
    intervalMs: COURSE_INTERVAL_MS,
    achieving,
    score,
    mode,
    nextMode,
    issues,
    actions: actions.length ? actions : ["continue vita parse + loc squash; /prove keeps love note"],
    inject: {
      attempts: hitchAttempts,
      sealed: hitchSealed,
      skippedLeftover: hitchSkippedLeftover,
      rate: injectRate,
      note: "leftover skips are lose-zero, not injection loss",
    },
    memory: {
      sealedLocations: sealed,
      pendingLocations: pending,
      locToken: loc.token,
      locTokenChars: loc.tokenChars,
      quality,
      charBudget: VITA_CHAR_BUDGET,
    },
    router: vitaRouterStatus(env),
  };
}

export function formatCourseMessage(course) {
  const c = course || evaluateVitaCourse();
  const flag = c.achieving ? "✅" : "🧭";
  const lines = [
    flag + " <b>VITA COURSE</b> score " + c.score + "/100 · mode <code>" + c.mode + "</code>",
    "Sealed locs: " + c.memory.sealedLocations + " · pending " + c.memory.pendingLocations,
    "Hitch sealed " + c.inject.sealed + "/" + c.inject.attempts +
      " (leftover skips " + c.inject.skippedLeftover + ")",
    "§LOC§ " + c.memory.locTokenChars + " chars",
  ];
  if (c.issues.length) lines.push("Issues: " + c.issues.join(", "));
  lines.push("Next: " + c.actions[0]);
  if (c.nextMode !== c.mode) lines.push("Switch → <code>" + c.nextMode + "</code>");
  return lines.join("\n");
}

let courseStats = emptyCourseStats();

function emptyCourseStats() {
  return {
    attempts: 0,
    sealed: 0,
    skippedLeftover: 0,
    realizedLossUsd: 0,
    lastTickMs: 0,
    history: [],
  };
}

export function resetCourseStats() {
  courseStats = emptyCourseStats();
}

export function serializeCourseStats() {
  return { ...courseStats, history: (courseStats.history || []).slice(-24) };
}

export function restoreCourseStats(data) {
  if (!data || typeof data !== "object") return false;
  courseStats = {
    ...emptyCourseStats(),
    attempts: Number(data.attempts) || 0,
    sealed: Number(data.sealed) || 0,
    skippedLeftover: Number(data.skippedLeftover) || 0,
    realizedLossUsd: Number(data.realizedLossUsd) || 0,
    lastTickMs: Number(data.lastTickMs) || 0,
    history: Array.isArray(data.history) ? data.history.slice(-24) : [],
  };
  return true;
}

export function getCourseStats() {
  return serializeCourseStats();
}

/** Planned hitch (attempt). Sealed is recorded separately after txHash. */
export function recordHitchAttempt({ skippedLeftover = false, realizedLossUsd = 0 } = {}) {
  courseStats.attempts += 1;
  if (skippedLeftover) courseStats.skippedLeftover += 1;
  if (Number(realizedLossUsd) < 0) courseStats.realizedLossUsd += Number(realizedLossUsd);
  return getCourseStats();
}

/** Confirmed on-chain hitch — does not increment attempts (already counted at plan). */
export function recordHitchSealed({ realizedLossUsd = 0 } = {}) {
  courseStats.sealed += 1;
  if (Number(realizedLossUsd) < 0) courseStats.realizedLossUsd += Number(realizedLossUsd);
  return getCourseStats();
}

/**
 * Apply course: restore KEY if lost, switch hitch mode when recommended.
 * Never invents P&L. Never deletes locations.
 */
export function applyVitaCourse(course) {
  const c = course || evaluateVitaCourse();
  const applied = [];
  if (c.issues.includes("key_fact_loss")) {
    const refined = refineVitaPacket(getLastVitaPacket(), {
      KEY: VITA_LOVE_KEY,
      LEARN: "restore-KEY-no-loss",
    });
    setLastVitaPacket(refined.packed);
    applied.push("restore-KEY");
  }
  if (c.nextMode && c.nextMode !== c.mode) {
    const r = setHitchModeOverride(c.nextMode);
    if (r.ok) applied.push("mode:" + r.mode);
  }
  const learn = (c.actions && c.actions[0]) || "";
  if (learn) {
    const refined = refineVitaPacket(getLastVitaPacket(), { LEARN: learn.slice(0, 80) });
    if (refined.fields.KEY) setLastVitaPacket(refined.packed);
  }
  courseStats.history = [
    ...(courseStats.history || []),
    {
      at: c.generatedAt,
      score: c.score,
      achieving: c.achieving,
      issues: c.issues,
      applied,
    },
  ].slice(-24);
  return { course: c, applied };
}

/**
 * Bot-loop hourly tick. No-op until COURSE_INTERVAL_MS elapsed (unless force).
 */
export function tickHourlyCourse({ now = Date.now(), force = false } = {}) {
  if (!force && courseStats.lastTickMs && now - courseStats.lastTickMs < COURSE_INTERVAL_MS) {
    return {
      ticked: false,
      waitMs: COURSE_INTERVAL_MS - (now - courseStats.lastTickMs),
    };
  }
  if (!getLastVitaPacket()) ensureGenesisMemory();
  const course = evaluateVitaCourse({
    hitchAttempts: courseStats.attempts,
    hitchSealed: courseStats.sealed,
    hitchSkippedLeftover: courseStats.skippedLeftover,
    realizedLossUsd: courseStats.realizedLossUsd,
    lastPacket: getLastVitaPacket(),
    now,
  });
  const result = applyVitaCourse(course);
  courseStats.lastTickMs = now;
  return { ticked: true, ...result, telegram: formatCourseMessage(result.course) };
}
