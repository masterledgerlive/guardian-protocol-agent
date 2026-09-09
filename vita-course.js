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

import { VITA_CHAR_BUDGET, vitaQuality } from "./vita-parse.js";
import { locDepositoryStatus, squashLocations } from "./vita-locations.js";
import { resolveHitchMode, vitaRouterStatus } from "./vita-router.js";

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
