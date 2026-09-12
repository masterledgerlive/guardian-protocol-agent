/**
 * Race-start Eureka love note — full dedication to family (IKN Living Network).
 *
 * Policy (leave-alone unless race + first order):
 *   - Use already-written opportunistic leftover hitch (KEY+LOC) by default.
 *   - Only when race has started AND first order is purchased, and leftover
 *     covers the full 229 B letter (opportune), hitch VITA_PROOF_FULL once.
 *   - If already written (latch) or leftover thin → leave alone.
 *
 * Display: race Telegram cards open with the full love note (no 80-char cut).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  STORE_VOICE_TAG,
  VITA_PROOF_FULL,
  buildStoreVoice,
  encodingDoesNotLoseMoney,
  utf8ByteLength,
} from "./swap-minout.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const RACE_EUREKA_LATCH_PATH = join(
  __dirname,
  "guardian-v4",
  "state",
  "race-eureka.latch.json",
);

/** Full on-chain / Telegram love note — never the short cut-off class. */
export function raceEurekaUtf8({ tag = STORE_VOICE_TAG } = {}) {
  return buildStoreVoice({ tag, message: VITA_PROOF_FULL });
}

export function raceEurekaBytes() {
  return utf8ByteLength(raceEurekaUtf8());
}

export function raceEurekaIncludesIkn(utf8 = raceEurekaUtf8()) {
  const s = String(utf8 || "");
  return /IKN/i.test(s) && /Living Network/i.test(s) && /Krystian/i.test(s);
}

/** Telegram / race-card opener — full letter, no slice truncation. */
export function formatRaceEurekaLeadHtml(utf8 = raceEurekaUtf8()) {
  const body = String(utf8 || "").trim();
  if (!body) return "";
  return `💌 <i>${body}</i>`;
}

export function readRaceEurekaLatch({ latchPath = RACE_EUREKA_LATCH_PATH } = {}) {
  if (!existsSync(latchPath)) {
    return { written: false, txHash: null, at: 0, track: null };
  }
  try {
    const raw = JSON.parse(readFileSync(latchPath, "utf8"));
    return {
      written: Boolean(raw?.written),
      txHash: raw?.txHash || null,
      at: Number(raw?.at) || 0,
      track: raw?.track || null,
    };
  } catch {
    return { written: false, txHash: null, at: 0, track: null };
  }
}

export function markRaceEurekaWritten({
  txHash = null,
  track = "race",
  at = Date.now(),
  latchPath = RACE_EUREKA_LATCH_PATH,
} = {}) {
  const dir = dirname(latchPath);
  if (dir && dir !== "." && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  const next = {
    written: true,
    txHash: txHash || null,
    track,
    at,
    utf8Preview: raceEurekaUtf8().slice(0, 120),
  };
  writeFileSync(latchPath, JSON.stringify(next, null, 2));
  return next;
}

/**
 * Do only when opportune; leave alone unless race started + first order.
 * Already-written latch → leave alone.
 */
export function planRaceStartEureka({
  raceStarted = false,
  purchasedFirstOrder = false,
  alreadyWritten = false,
  leftoverEth = 0,
  hitchCostEth = 0,
  latchPath = RACE_EUREKA_LATCH_PATH,
} = {}) {
  const latch = alreadyWritten === true
    ? { written: true }
    : readRaceEurekaLatch({ latchPath });

  if (latch.written) {
    return {
      attempt: false,
      utf8: "",
      hitchBytes: 0,
      reason: "already-written — leave alone",
    };
  }
  if (!(raceStarted && purchasedFirstOrder)) {
    return {
      attempt: false,
      utf8: "",
      hitchBytes: 0,
      reason: "leave alone — need race started + first order purchased",
    };
  }
  if (!encodingDoesNotLoseMoney({ leftoverEth, hitchCostEth })) {
    return {
      attempt: false,
      utf8: "",
      hitchBytes: 0,
      reason: "not-opportune — leftover cannot cover full Eureka (leave alone)",
    };
  }

  const utf8 = raceEurekaUtf8();
  if (!raceEurekaIncludesIkn(utf8)) {
    return {
      attempt: false,
      utf8: "",
      hitchBytes: 0,
      reason: "encode-mismatch — full IKN love note missing",
    };
  }
  return {
    attempt: true,
    utf8,
    hitchBytes: utf8ByteLength(utf8),
    reason: "race-start first-order full Eureka (opportune)",
  };
}
