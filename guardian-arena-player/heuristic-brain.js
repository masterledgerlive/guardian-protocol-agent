/**
 * Free FLY / heuristic brain — $0 inference (agent-arena FLY SWARM pattern).
 * Deterministic on a snapshot; used when agent-hour credits are burned.
 */

import { CLASS_STRATEGY, DEFAULT_STRATEGY, clamp } from "./types.js";

function momentum(candles, lookback = 6) {
  if (!Array.isArray(candles) || candles.length < 2) return 0;
  const n = Math.min(lookback, candles.length - 1);
  const a = Number(candles[candles.length - 1 - n]?.c);
  const b = Number(candles[candles.length - 1]?.c);
  if (!(a > 0) || !(b > 0)) return 0;
  return (b - a) / a;
}

function bookImbalance(snap) {
  const bid = (snap?.bids || []).slice(0, 3).reduce((s, l) => s + (Number(l.size) || 0), 0);
  const ask = (snap?.asks || []).slice(0, 3).reduce((s, l) => s + (Number(l.size) || 0), 0);
  const t = bid + ask;
  if (!(t > 0)) return 0;
  return (bid - ask) / t;
}

export function createHeuristicBrain({ lookback = 6, alignThreshold = 0.06 } = {}) {
  return {
    kind: "heuristic",
    costUsd: 0,
    decide(snap, opts = {}) {
      const strategy = opts.strategy || CLASS_STRATEGY[opts.agentClass] || DEFAULT_STRATEGY;
      const mom = momentum(snap?.candles, lookback);
      const imb = bookImbalance(snap);
      const maxSize = Math.max(0, Number(opts.maxSizeEth) || 0);
      const curve = Number(snap?.curveProgressPct);

      if (opts.inPosition) {
        const exhausted = mom < -strategy.entryThreshold * 0.6;
        const bookTurned = strategy.requireBookAlign && imb < -alignThreshold;
        if (exhausted || bookTurned) {
          return {
            action: "SELL",
            sizeEth: maxSize,
            confidence: clamp(0.4 + Math.abs(mom) * 8, 0, 1),
            holdTicks: strategy.holdMin,
            reason: exhausted ? "momentum rolled over" : "book turned against",
          };
        }
        return {
          action: "SKIP",
          sizeEth: 0,
          confidence: clamp(0.3 + mom * 6, 0, 1),
          holdTicks: 0,
          reason: "holding, thesis intact",
        };
      }

      if (Number.isFinite(curve) && curve > strategy.maxCurve) {
        return {
          action: "SKIP",
          sizeEth: 0,
          confidence: 0,
          holdTicks: 0,
          reason: `curve ${curve.toFixed(0)}% past ${strategy.maxCurve}%`,
        };
      }
      if (mom < strategy.entryThreshold) {
        return {
          action: "SKIP",
          sizeEth: 0,
          confidence: 0,
          holdTicks: 0,
          reason: `momentum ${(mom * 100).toFixed(2)}% under threshold`,
        };
      }
      if (strategy.requireBookAlign && imb < alignThreshold) {
        return {
          action: "SKIP",
          sizeEth: 0,
          confidence: 0,
          holdTicks: 0,
          reason: "book not aligned",
        };
      }

      const sizeEth = Math.min(maxSize, maxSize * (strategy.sizeMult || 1));
      return {
        action: "BUY",
        sizeEth,
        confidence: clamp(0.45 + mom * 10 + Math.max(0, imb) * 0.2, 0, 1),
        holdTicks: Math.floor((strategy.holdMin + strategy.holdMax) / 2),
        reason: `fly mom=${(mom * 100).toFixed(2)}% imb=${imb.toFixed(2)}`,
      };
    },
  };
}
