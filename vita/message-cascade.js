/**
 * Message cascade — Eureka love note into every available token seat.
 *
 * Message-first (ORIGINAL_FORMULA): each cascade hop carries the love Eureka
 * (or KEY+LOC when leftover covers). Wave high/low load **instantly** from
 * token-embedded peaks/troughs — no cold-scan wait when we are not in our
 * own injection. Algorithm uses that envelope for next-move ranking.
 *
 * Cadence target: ≥8 tokens / 15 minutes while building the database.
 * Leave $0.05 dust each exit (adds up across continuous cascade).
 * Rank seats top→bottom by revenue + lowered tokens waiting to rise.
 * When moving up, pre-arm the sell (profit already known). Buy character
 * spot cost regardless of later use so the message always triggers.
 *
 * HOME is cascade-available (wave + hold). Never invent tx hashes.
 * Never sell red to place code. Mother brain untouched.
 * Storage Token may charge hitch transmission delta.
 */

import { createHash } from "node:crypto";
import {
  MAINFRAME_ANCHORS,
  ORIGINAL_FORMULA,
  FORMULA_ID,
} from "./mainframe.js";
import {
  VERIFIED_HOME_ADDRESS,
  VERIFIED_HOME_SYMBOL,
  HOME_FEE_TIER,
} from "../operator-rotate.js";
import {
  CASCADE_TARGET_HOPS,
  CASCADE_WINDOW_MS,
  CASCADE_LEAVE_DUST_USD,
} from "../cascade-rollover.js";
import {
  VITA_PROOF_FULL,
  VITA_PROOF_MESSAGE,
  STORE_VOICE_TAG,
  utf8ByteLength,
} from "../swap-minout.js";

export const MESSAGE_CASCADE_ID = "message-cascade-v1";
export const MESSAGE_CASCADE_MAGIC = "§MSGCASC§";
export const MESSAGE_CASCADE_LABEL = "MESSAGE_CASCADE";

export {
  CASCADE_TARGET_HOPS,
  CASCADE_WINDOW_MS,
  CASCADE_LEAVE_DUST_USD,
};
/** Cheaper entry bias: prefer seats in the lowest band of peak–trough. */
export const CASCADE_CHEAP_RANGE_MAX = 0.12;
/** Moving-up threshold to pre-arm sell (fraction of range from trough). */
export const CASCADE_MOVE_UP_RANGE_POS = 0.55;
/** USD per UTF-8 character for spot character buy (transmission class). */
export const CASCADE_CHAR_USD = 0.00008;

export const DEFAULT_CASCADE_MESSAGE = VITA_PROOF_FULL;

function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function normSym(s) {
  return String(s || "").trim().toUpperCase();
}

function sha256Hex(text) {
  return createHash("sha256").update(String(text || ""), "utf8").digest("hex");
}

function shortHex(hex, n = 8) {
  return String(hex || "").replace(/^0x/i, "").toLowerCase().slice(0, n);
}

/**
 * Instant wave envelope from token-embedded data (peaks/troughs already on
 * the row or waveState). Prefer explicit minTrough/maxPeak; else min/max of
 * arrays; else null envelope (seat still ranks but cannot arm sell).
 */
export function loadWavePointsFromToken(token = {}) {
  const symbol = normSym(token.symbol);
  const peaks = Array.isArray(token.peaks)
    ? token.peaks.map(Number).filter((x) => x > 0)
    : Array.isArray(token.wavePeaks)
      ? token.wavePeaks.map(Number).filter((x) => x > 0)
      : [];
  const troughs = Array.isArray(token.troughs)
    ? token.troughs.map(Number).filter((x) => x > 0)
    : Array.isArray(token.waveTroughs)
      ? token.waveTroughs.map(Number).filter((x) => x > 0)
      : [];

  let maxPeak = num(token.maxPeak, num(token.peak, NaN));
  let minTrough = num(token.minTrough, num(token.trough, NaN));
  if (!(maxPeak > 0) && peaks.length) maxPeak = Math.max(...peaks);
  if (!(minTrough > 0) && troughs.length) minTrough = Math.min(...troughs);

  const price = num(token.price, num(token.lastPrice, 0));
  const ready = maxPeak > 0 && minTrough > 0 && maxPeak > minTrough;
  const range = ready ? maxPeak - minTrough : 0;
  const rangePos = ready && price > 0 ? (price - minTrough) / range : null;

  return {
    symbol: symbol || null,
    minTrough: ready ? minTrough : null,
    maxPeak: ready ? maxPeak : null,
    peaks: peaks.slice(),
    troughs: troughs.slice(),
    price: price > 0 ? price : null,
    range,
    rangePos,
    ready,
    instant: true,
    source: ready ? "token-embedded" : "missing",
  };
}

/**
 * Character spot buy — size transmission from full message bytes regardless
 * of whether every character is later hitch-used. Always triggers cascade.
 */
export function characterSpotBuyUsd(message = DEFAULT_CASCADE_MESSAGE, {
  charUsd = CASCADE_CHAR_USD,
} = {}) {
  const utf8 = String(message ?? "");
  const bytes = utf8ByteLength(utf8);
  const chars = [...utf8].length;
  const per = Math.max(0, num(charUsd, CASCADE_CHAR_USD));
  const usd = Math.max(chars, bytes) * per;
  return {
    chars,
    bytes,
    charUsd: per,
    spotBuyUsd: usd,
    alwaysTrigger: true,
  };
}

/**
 * Pre-arm sell when price is moving up through the wave (profit path known).
 * Exit target = maxPeak (or ride high). Leave nickel dust.
 */
export function armSellOnMoveUp(seat = {}, {
  leaveDustUsd = CASCADE_LEAVE_DUST_USD,
  moveUpPos = CASCADE_MOVE_UP_RANGE_POS,
} = {}) {
  const wave = seat.wave || loadWavePointsFromToken(seat);
  const price = num(seat.price, num(wave.price, 0));
  const predictedUp = seat.predictedUp === true
    || seat.goingDown === false
    || (wave.rangePos != null && wave.rangePos >= moveUpPos);
  const movingUp = seat.movingUp === true
    || num(seat.recentMovePct, 0) > 0
    || predictedUp;

  if (!wave.ready || !(price > 0) || !movingUp) {
    return {
      armed: false,
      reason: !wave.ready
        ? "wave envelope not ready"
        : !(price > 0)
          ? "no live price"
          : "not moving up — hold cascade seat",
      leaveDustUsd: Math.max(0, num(leaveDustUsd, CASCADE_LEAVE_DUST_USD)),
    };
  }

  const exitAt = wave.maxPeak;
  const dipFromPeak = exitAt > 0 ? (exitAt - price) / exitAt : 0;
  const profitKnown = price > wave.minTrough && exitAt > price;
  return {
    armed: profitKnown,
    reason: profitKnown
      ? "moving up — sell pre-armed at wave peak (profit path)"
      : "moving up but exit ≤ price — wait ratchet",
    exitAt,
    leaveDustUsd: Math.max(0, num(leaveDustUsd, CASCADE_LEAVE_DUST_USD)),
    dipFromPeak,
    predictedUp,
    movingUp: true,
  };
}

/**
 * Revenue / cheapness score — higher is better (top of list).
 * Prefer: high revenueUsd, low rangePos (waiting to rise), predicted up,
 * not stagnant. HOME stays eligible for wave/hold ranking.
 */
export function scoreCascadeSeat(seat = {}) {
  const wave = seat.wave || loadWavePointsFromToken(seat);
  const revenue = Math.max(0, num(seat.revenueUsd, num(seat.earnedUsd, 0)));
  const stagnant = seat.stagnant === true || seat.notMoving === true;
  const frozen = seat.frozen === true || seat.disabled === true;
  const predictedUp = seat.predictedUp === true || seat.goingDown === false;
  const rangePos = wave.rangePos;
  const cheap = rangePos != null && rangePos <= CASCADE_CHEAP_RANGE_MAX;
  const waitingUp = cheap && (predictedUp || rangePos != null);

  let score = revenue * 10;
  if (waitingUp) score += 5 + (1 - Math.max(0, rangePos || 0)) * 3;
  if (predictedUp) score += 2;
  if (wave.ready) score += 1;
  if (stagnant) score -= 4;
  if (frozen) score -= 100;
  if (normSym(seat.symbol) === VERIFIED_HOME_SYMBOL) {
    // HOME: available for cascade wave data / hold; never force-sell HOME.
    score += 0.5;
  }
  return {
    symbol: normSym(seat.symbol),
    score,
    revenueUsd: revenue,
    rangePos,
    cheap,
    waitingUp,
    stagnant,
    frozen,
    predictedUp,
    waveReady: wave.ready,
    home: normSym(seat.symbol) === VERIFIED_HOME_SYMBOL,
  };
}

/**
 * Top→bottom list: most revenue / best cheap waiting-up seats first.
 * Every non-frozen token is cascade-available to start.
 */
export function rankCascadeTokens(tokens = []) {
  const rows = (tokens || [])
    .filter((t) => t && normSym(t.symbol))
    .map((t) => {
      const wave = loadWavePointsFromToken(t);
      const scored = scoreCascadeSeat({ ...t, wave });
      const sell = armSellOnMoveUp({ ...t, wave });
      return {
        symbol: scored.symbol,
        address: t.address || null,
        score: scored.score,
        revenueUsd: scored.revenueUsd,
        rangePos: scored.rangePos,
        cheap: scored.cheap,
        waitingUp: scored.waitingUp,
        stagnant: scored.stagnant,
        frozen: scored.frozen,
        predictedUp: scored.predictedUp,
        wave,
        sellArm: sell,
        cascadeAvailable: scored.frozen !== true,
        home: scored.home,
      };
    })
    .sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol));

  const available = rows.filter((r) => r.cascadeAvailable);
  const blocked = rows.filter((r) => !r.cascadeAvailable);
  return {
    ranked: rows,
    available,
    blocked,
    stagnant: available.filter((r) => r.stagnant),
    waitingUp: available.filter((r) => r.waitingUp),
    home: available.find((r) => r.home) || rows.find((r) => r.home) || null,
  };
}

/**
 * Cadence gate: are we hitting ≥ target hops in the last window?
 */
export function cascadeCadenceStatus(hopTimestamps = [], {
  now = Date.now(),
  targetHops = CASCADE_TARGET_HOPS,
  windowMs = CASCADE_WINDOW_MS,
} = {}) {
  const win = Math.max(1, Math.floor(num(windowMs, CASCADE_WINDOW_MS)));
  const target = Math.max(1, Math.floor(num(targetHops, CASCADE_TARGET_HOPS)));
  const t0 = num(now, Date.now());
  const recent = (hopTimestamps || [])
    .map(Number)
    .filter((t) => Number.isFinite(t) && t0 - t <= win && t <= t0 + 1);
  const hops = recent.length;
  const shortfall = Math.max(0, target - hops);
  const onPace = hops >= target;
  const nextDueMs = onPace
    ? Math.max(0, win - (t0 - Math.min(...recent)))
    : 0;
  return {
    hops,
    target,
    windowMs: win,
    onPace,
    shortfall,
    needFaster: shortfall > 0,
    nextDueMs,
    ratePerWindow: hops,
  };
}

/**
 * Build one Eureka message shard bound to a token SYM (WAVE-style header,
 * love note body). Never invents a location hash — locs seal later on-chain.
 */
export function buildEurekaCascadeShard({
  symbol,
  message = DEFAULT_CASCADE_MESSAGE,
  index = 1,
  total = 1,
  vinId = null,
  prevHex = "00000000",
} = {}) {
  const sym = normSym(symbol) || "WISE";
  const body = String(message || DEFAULT_CASCADE_MESSAGE);
  const key8 = shortHex(sha256Hex(body), 8);
  const loc8 = shortHex(sha256Hex(`${sym}:${index}:${body}`), 8);
  const ii = Math.max(1, Math.floor(num(index, 1)));
  const nn = Math.max(ii, Math.floor(num(total, 1)));
  const vin = vinId || `VIN-CASC${key8.toUpperCase().slice(0, 8)}`;
  const next = ii >= nn ? "END" : String(ii + 1).padStart(2, "0");
  const header =
    `[W:v1:${sym}]|${vin}|${String(ii).padStart(2, "0")}/${String(nn).padStart(2, "0")}` +
    `|prev=${String(prevHex || "00000000").slice(0, 8)}|next=${next}` +
    `|${key8}|${loc8}]`;
  const line = `${header}${body}`;
  return {
    symbol: sym,
    vinId: vin,
    index: ii,
    total: nn,
    key8,
    loc8,
    header,
    body,
    line,
    bytes: utf8ByteLength(line),
    loveNote: /Eureka!/i.test(body) && /Krystian/i.test(body),
    location: null, // sealed only when sendTx returns a real hash
    neverInventHashes: true,
  };
}

/**
 * Full message-cascade plan: Eureka into each available token, ranked
 * top→bottom, character spot buy, pre-armed sells, dust, cadence.
 */
export function planMessageCascade({
  tokens = [],
  message = DEFAULT_CASCADE_MESSAGE,
  hopTimestamps = [],
  now = Date.now(),
  leaveDustUsd = CASCADE_LEAVE_DUST_USD,
  targetHops = CASCADE_TARGET_HOPS,
  windowMs = CASCADE_WINDOW_MS,
  maxHops = null,
} = {}) {
  const love = String(message || DEFAULT_CASCADE_MESSAGE);
  const chars = characterSpotBuyUsd(love);
  const ranked = rankCascadeTokens(tokens);
  const cadence = cascadeCadenceStatus(hopTimestamps, { now, targetHops, windowMs });
  const want = maxHops != null
    ? Math.max(0, Math.floor(num(maxHops)))
    : Math.max(cadence.shortfall, Math.min(CASCADE_TARGET_HOPS, ranked.available.length));

  const picks = ranked.available.slice(0, want > 0 ? want : ranked.available.length);
  const total = Math.max(1, picks.length);
  let prev = "00000000";
  const hops = picks.map((seat, i) => {
    const shard = buildEurekaCascadeShard({
      symbol: seat.symbol,
      message: love,
      index: i + 1,
      total,
      prevHex: prev,
    });
    prev = shard.loc8;
    const sell = armSellOnMoveUp(
      { ...seat, wave: seat.wave, predictedUp: seat.predictedUp },
      { leaveDustUsd },
    );
    return {
      order: i + 1,
      symbol: seat.symbol,
      score: seat.score,
      revenueUsd: seat.revenueUsd,
      cheap: seat.cheap,
      waitingUp: seat.waitingUp,
      stagnant: seat.stagnant,
      home: seat.home,
      wave: seat.wave,
      sellArm: sell,
      shard,
      spotBuyUsd: chars.spotBuyUsd / total,
      leaveDustUsd: Math.max(0, num(leaveDustUsd, CASCADE_LEAVE_DUST_USD)),
      action: seat.waitingUp || seat.cheap
        ? "cascade-buy-cheap-waiting-up"
        : sell.armed
          ? "cascade-hold-sell-armed"
          : "cascade-message-hop",
    };
  });

  return {
    id: MESSAGE_CASCADE_ID,
    magic: MESSAGE_CASCADE_MAGIC,
    label: MESSAGE_CASCADE_LABEL,
    formula: FORMULA_ID,
    messageFirst: ORIGINAL_FORMULA.messageFirstWhenKeyLocCovered,
    loveMessage: love,
    loveTag: STORE_VOICE_TAG,
    loveShort: VITA_PROOF_MESSAGE,
    characterBuy: chars,
    cadence,
    leaveDustUsd: Math.max(0, num(leaveDustUsd, CASCADE_LEAVE_DUST_USD)),
    ranked: ranked.ranked.map((r) => ({
      symbol: r.symbol,
      score: r.score,
      revenueUsd: r.revenueUsd,
      waitingUp: r.waitingUp,
      stagnant: r.stagnant,
      cascadeAvailable: r.cascadeAvailable,
      home: r.home,
      rangePos: r.rangePos,
    })),
    hops,
    hopCount: hops.length,
    availableCount: ranked.available.length,
    stagnantCount: ranked.stagnant.length,
    waitingUpCount: ranked.waitingUp.length,
    home: ranked.home
      ? {
          symbol: VERIFIED_HOME_SYMBOL,
          address: VERIFIED_HOME_ADDRESS,
          feeTier: HOME_FEE_TIER,
          cascadeAvailable: ranked.home.cascadeAvailable !== false,
          waveReady: ranked.home.wave?.ready === true,
          note: "verified Defi App $HOME — cascade wave/hold; rotate never sells HOME",
        }
      : {
          symbol: VERIFIED_HOME_SYMBOL,
          address: VERIFIED_HOME_ADDRESS,
          feeTier: HOME_FEE_TIER,
          cascadeAvailable: true,
          waveReady: false,
          note: "HOME catalog seat missing from input — still cascade-available when listed",
        },
    wallet: MAINFRAME_ANCHORS.wallet,
    neverInventHashes: true,
    neverSellRedToInject: true,
    cheaperRate: true,
    antiStagnant: ranked.stagnant.length > 0,
  };
}

/**
 * Alternating filing pair: operator message → agentic knowledge.
 * Callers append message memory then knowledge strand (never rewrite).
 */
export function buildMessageKnowledgePair({
  operatorText = "",
  agentKnowledge = "",
  at = new Date().toISOString(),
  topic = "message-cascade",
} = {}) {
  const msg = String(operatorText || "").trim();
  const know = String(agentKnowledge || "").trim();
  const msgHash = shortHex(sha256Hex(msg), 12);
  const knowHash = shortHex(sha256Hex(know), 12);
  return {
    at,
    topic,
    formula: FORMULA_ID,
    neverForget: true,
    alternation: ["message", "knowledge"],
    message: {
      role: "operator",
      text: msg,
      contentSha12: msgHash,
      filing: "MEMORY",
    },
    knowledge: {
      role: "agent",
      text: know,
      contentSha12: knowHash,
      filing: "STRAND",
      usefulForTimeToCome: true,
    },
    chain: [
      { step: 1, kind: "message", sha12: msgHash },
      { step: 2, kind: "knowledge", sha12: knowHash },
    ],
  };
}

/** Default agent knowledge blob for this cascade method (time-to-come). */
export function defaultCascadeKnowledge() {
  return [
    "Message-cascade v1: every test/hop carries Eureka love into a token SYM.",
    "Wave high/low load instantly from token-embedded peaks/troughs — no cold scan when not in own injection.",
    `Cadence ≥${CASCADE_TARGET_HOPS} tokens / ${CASCADE_WINDOW_MS / 60_000} min; leave $${CASCADE_LEAVE_DUST_USD} dust each exit.`,
    "Rank top→bottom by revenue + lowered waiting-to-rise; pre-arm sell when moving up.",
    "Buy all character spot cost so message always triggers; cascade into cheap lowered seats.",
    `HOME ${VERIFIED_HOME_ADDRESS} fee ${HOME_FEE_TIER}: cascade-available wave/hold; OPERATOR_ROTATE never sells HOME; THIN_V3 bypass is rotate-buy only.`,
    "Message-first: do not mute hitch for micro extract; Storage Token can charge delta. Never invent hashes. Never sell red to place code.",
  ].join(" ");
}

export function formatMessageCascadeCard(plan) {
  if (!plan || !plan.hops) return "MESSAGE_CASCADE — empty plan";
  const lines = [
    `💌 <b>MESSAGE CASCADE</b> · ${plan.hopCount} hops · dust $${Number(plan.leaveDustUsd).toFixed(2)}`,
    `Cadence: ${plan.cadence.hops}/${plan.cadence.target} in ${plan.cadence.windowMs / 60_000}m ${plan.cadence.onPace ? "✅" : "⚡ need " + plan.cadence.shortfall}`,
    `Chars spot: $${plan.characterBuy.spotBuyUsd.toFixed(4)} (${plan.characterBuy.chars} chars)`,
    `Waiting-up: ${plan.waitingUpCount} · Stagnant: ${plan.stagnantCount} · Available: ${plan.availableCount}`,
    `HOME: ${plan.home.address.slice(0, 10)}… wave=${plan.home.waveReady ? "ready" : "pending"}`,
  ];
  for (const h of plan.hops.slice(0, 12)) {
    const arm = h.sellArm?.armed ? ` sell@${Number(h.sellArm.exitAt).toFixed(6)}` : "";
    lines.push(
      `${String(h.order).padStart(2, "0")}. ${h.symbol} score=${h.score.toFixed(2)} ${h.action}${arm}`,
    );
  }
  return lines.join("\n");
}
