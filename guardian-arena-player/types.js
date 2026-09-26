/**
 * Guardian Arena Player — core contracts (from agent-arena / DEGEN VILLAGE).
 * Zero deps. Isomorphic. decide() never throws.
 */

export const SKIP = Object.freeze({
  action: "SKIP",
  sizeEth: 0,
  confidence: 0,
  holdTicks: 0,
  reason: "skip",
});

export function skipVerdict(reason = "skip") {
  return {
    action: "SKIP",
    sizeEth: 0,
    confidence: 0,
    holdTicks: 0,
    reason: String(reason || "skip").slice(0, 90),
  };
}

export const AGENT_CLASSES = Object.freeze([
  "SCOUT",
  "SNIPER",
  "WHALE",
  "ARB",
  "FLY",
  "CUSTOM",
]);

/** Class lenses — one sentence each (live prompt + heuristic bias). */
export const CLASS_LENS = Object.freeze({
  SCOUT: "Favour early entries. Fresh curves interest you.",
  SNIPER: "Favour precision. Skip more than you trade.",
  WHALE: "Favour size on high conviction only.",
  ARB: "Favour short holds and small edges. Exit fast.",
  FLY: "Local free heuristic — short holds, tiny size, zero inference spend.",
  CUSTOM: "Follow the operator brief below and nothing else.",
});

export const DEFAULT_STRATEGY = Object.freeze({
  entryThreshold: 0.012,
  maxCurve: 85,
  holdMin: 60,
  holdMax: 420,
  sizeMult: 1,
  requireBookAlign: false,
});

export const CLASS_STRATEGY = Object.freeze({
  SCOUT: {
    entryThreshold: 0.008,
    maxCurve: 45,
    holdMin: 90,
    holdMax: 420,
    sizeMult: 0.9,
    requireBookAlign: false,
  },
  SNIPER: {
    entryThreshold: 0.022,
    maxCurve: 70,
    holdMin: 120,
    holdMax: 520,
    sizeMult: 1.1,
    requireBookAlign: true,
  },
  WHALE: {
    entryThreshold: 0.015,
    maxCurve: 95,
    holdMin: 200,
    holdMax: 900,
    sizeMult: 1.6,
    requireBookAlign: true,
  },
  ARB: {
    entryThreshold: 0.005,
    maxCurve: 100,
    holdMin: 25,
    holdMax: 110,
    sizeMult: 0.7,
    requireBookAlign: false,
  },
  FLY: {
    ...DEFAULT_STRATEGY,
    entryThreshold: 0.003,
    holdMin: 10,
    holdMax: 22,
    sizeMult: 0.2,
  },
  CUSTOM: { ...DEFAULT_STRATEGY },
});

export function clamp(n, lo, hi) {
  const x = Number(n);
  if (!Number.isFinite(x)) return lo;
  return Math.max(lo, Math.min(hi, x));
}

/**
 * Harden a raw verdict. Always returns a safe Verdict.
 * Mirrors agent-arena: size clamped AFTER parse, SELL→SKIP if flat, never throw.
 */
export function hardenVerdict(raw, opts = {}) {
  try {
    const maxSize = Math.max(0, Number(opts.maxSizeEth) || 0);
    const strategy = opts.strategy || DEFAULT_STRATEGY;
    const inPosition = opts.inPosition === true;
    const v = raw && typeof raw === "object" ? raw : {};
    let action = String(v.action || "SKIP").toUpperCase();
    if (action !== "BUY" && action !== "SELL" && action !== "SKIP") action = "SKIP";
    if (action === "SELL" && !inPosition) action = "SKIP";
    if (action === "BUY" && inPosition) action = "SKIP";
    let sizeEth = Number(v.sizeEth);
    if (!Number.isFinite(sizeEth) || sizeEth < 0) sizeEth = 0;
    if (action === "SKIP") sizeEth = 0;
    else sizeEth = Math.min(sizeEth, maxSize);
    return {
      action,
      sizeEth,
      confidence: clamp(v.confidence, 0, 1),
      holdTicks: Math.floor(
        clamp(v.holdTicks, strategy.holdMin ?? 0, strategy.holdMax ?? 1000),
      ),
      reason: String(v.reason || action.toLowerCase()).slice(0, 90),
    };
  } catch {
    return skipVerdict("harden-failed");
  }
}
