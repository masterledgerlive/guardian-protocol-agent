/**
 * Stat compiler + decision cost ladder (agent-arena pattern).
 * Stats → real engine knobs. PTN buys context/thinking; house buys the bill.
 */

import { clamp } from "./types.js";

export const MAX_STAT = 15;
export const BASE_POSITION_ETH = 0.05;
export const ASSUMED_ETH_USD = 2500;

/** House ladders — ids are labels for budgeting; wire adapters map later. */
export const MODEL_LADDERS = Object.freeze({
  anthropic: Object.freeze([
    { minPtn: 0, id: "claude-working" },
    { minPtn: 12, id: "claude-frontier" },
  ]),
  openai: Object.freeze([
    { minPtn: 0, id: "gpt-working" },
    { minPtn: 12, id: "gpt-frontier" },
  ]),
  xai: Object.freeze([
    { minPtn: 0, id: "grok-working" },
    { minPtn: 12, id: "grok-frontier" },
  ]),
  heuristic: Object.freeze([{ minPtn: 0, id: "fly-heuristic" }]),
});

/** USD per MTok — approximate list prices for burn estimates. */
export const MODEL_PRICING = Object.freeze({
  "claude-working": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-frontier": { inputPerMTok: 10, outputPerMTok: 50 },
  "gpt-working": { inputPerMTok: 2, outputPerMTok: 12 },
  "gpt-frontier": { inputPerMTok: 10, outputPerMTok: 50 },
  "grok-working": { inputPerMTok: 1.25, outputPerMTok: 2.5 },
  "grok-frontier": { inputPerMTok: 2, outputPerMTok: 6 },
  "fly-heuristic": { inputPerMTok: 0, outputPerMTok: 0 },
});

const TOKENS_SYSTEM = 320;
const TOKENS_PER_CANDLE = 18;
const TOKENS_BOOK = 120;
const MAX_OUTPUT_TOKENS = 300;

export function normalizeProvider(raw) {
  const p = String(raw || "").toLowerCase();
  if (p === "openai" || p === "xai" || p === "heuristic" || p === "anthropic") return p;
  return "heuristic";
}

export function pickModel(provider, ptn) {
  const ladder = MODEL_LADDERS[normalizeProvider(provider)] || MODEL_LADDERS.heuristic;
  let id = ladder[0].id;
  for (const rung of ladder) {
    if (ptn >= rung.minPtn) id = rung.id;
  }
  return id;
}

export function thinkingBudgetForPtn(ptn) {
  const p = clamp(ptn, 0, MAX_STAT);
  if (p >= 12) return 3000;
  if (p >= 8) return 1500;
  if (p >= 4) return 512;
  return 0;
}

export function costPerDecision(modelId, ctxCandles, thinking) {
  const price = MODEL_PRICING[modelId];
  if (!price) return 0;
  const inputTokens = TOKENS_SYSTEM + ctxCandles * TOKENS_PER_CANDLE + TOKENS_BOOK;
  const outputTokens = MAX_OUTPUT_TOKENS + Math.max(0, thinking);
  return (inputTokens / 1e6) * price.inputPerMTok + (outputTokens / 1e6) * price.outputPerMTok;
}

/**
 * Compile four stats into runtime config the player loop reads.
 * @param {{ spd?: number, rsk?: number, ptn?: number, gas?: number }} stats
 * @param {{ provider?: string, level?: number }} [opts]
 */
export function compileStats(stats = {}, opts = {}) {
  const spd = clamp(Math.floor(Number(stats.spd) || 0), 0, MAX_STAT);
  const rsk = clamp(Math.floor(Number(stats.rsk) || 0), 0, MAX_STAT);
  const ptn = clamp(Math.floor(Number(stats.ptn) || 0), 0, MAX_STAT);
  const gas = clamp(Math.floor(Number(stats.gas) || 0), 0, MAX_STAT);
  const level = Math.max(0, Math.floor(Number(opts.level) || 0));
  const provider = normalizeProvider(opts.provider);
  const model = pickModel(provider, ptn);
  const ctxCandles = Math.min(120, 24 + ptn * 6);
  const thinkingBudget = provider === "heuristic" ? 0 : thinkingBudgetForPtn(ptn);
  const pollIntervalMs = Math.max(400, 3200 - spd * 260);
  const positionSizeEth = Math.min(
    BASE_POSITION_ETH * 8,
    BASE_POSITION_ETH * (1 + rsk * 0.18) * (1 + level * 0.12),
  );
  const slippageBps = Math.max(30, 160 - gas * 9);
  const costUsd = costPerDecision(model, ctxCandles, thinkingBudget);
  return Object.freeze({
    spd,
    rsk,
    ptn,
    gas,
    level,
    provider,
    model,
    ctxCandles,
    thinkingBudget,
    pollIntervalMs,
    positionSizeEth,
    slippageBps,
    feeBps: 60,
    costPerDecisionUsd: costUsd,
    costPerDecisionEth: costUsd / ASSUMED_ETH_USD,
  });
}
