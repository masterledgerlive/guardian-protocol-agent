/**
 * LOSE-ZERO / inject-cover gate for speculative buys.
 *
 * Does not size trades or invent P&L. Decides allow vs block only.
 *
 * Penny-pinch: sell_target = fair_exit + inject_cost_spread
 * inject_cost_spread covers estimated gas for a short §$STORE§ hitch (~10 bytes) on Base.
 */

export const STORE_HITCH_TAG = "§$STORE§";
export const STORE_HITCH_BYTES = 10;               // UTF-8 length of §$STORE§
export const CALLDATA_GAS_PER_NONZERO_BYTE = 16;   // EIP-2028

export function envFlagYes(name, env = process.env) {
  return String(env[name] ?? "").trim().toLowerCase() === "yes";
}

export function isLoseZeroMode(env = process.env) {
  return envFlagYes("LOSE_ZERO", env) || envFlagYes("HALT_NEW_ENTRIES", env);
}

export function isInjectCoverRequired(env = process.env) {
  return envFlagYes("REQUIRE_INJECT_COVER", env) || isLoseZeroMode(env);
}

export function estimateStoreHitchGasUnits() {
  return STORE_HITCH_BYTES * CALLDATA_GAS_PER_NONZERO_BYTE;
}

/** Hitch cost in ETH given gas price in gwei. */
export function estimateInjectCostEth(gwei) {
  const g = Number(gwei);
  if (!Number.isFinite(g) || g < 0) return 0;
  return estimateStoreHitchGasUnits() * g * 1e-9;
}

/**
 * Price increment so a position of `tradeEth` covers hitch gas.
 * inject_cost_spread = (injectEth / tradeEth) * entryPrice
 */
export function injectCostSpread(entryPrice, tradeEth, gwei) {
  const injectEth = estimateInjectCostEth(gwei);
  const price = Number(entryPrice);
  const eth = Number(tradeEth);
  if (!Number.isFinite(price) || price <= 0) return 0;
  if (!Number.isFinite(eth) || eth <= 0) return Number.POSITIVE_INFINITY;
  return (injectEth / eth) * price;
}

/**
 * fair_exit = entry * (1 + sell-side fee + gas + impact)
 * Sell-side only: the buy already happened at `entryPrice`.
 */
export function computeFairExit(entryPrice, { feePct = 0, gasCostEth = 0, tradeEth = 0, impactPct = 0 } = {}) {
  const price = Number(entryPrice);
  if (!Number.isFinite(price) || price <= 0) return 0;
  const gasPct = Number(tradeEth) > 0 ? Number(gasCostEth) / Number(tradeEth) : 0;
  const costPct = Number(feePct || 0) + (Number.isFinite(gasPct) ? gasPct : 0) + Number(impactPct || 0);
  return price * (1 + Math.max(0, costPct));
}

/** sell_target = fair_exit + inject_cost_spread */
export function computePennyPinchSellTarget(fairExit, injectSpread) {
  return Number(fairExit) + Number(injectSpread);
}

/**
 * leftover = existing sell target (max peak / wave target) − penny-pinch sell_target
 * Missing or invalid targets yield leftover 0 (does not cover inject).
 */
export function computeLeftover(existingSellTarget, fairExit, injectSpread) {
  const target = Number(existingSellTarget);
  if (!Number.isFinite(target) || target <= 0) return 0;
  const required = computePennyPinchSellTarget(fairExit, injectSpread);
  if (!Number.isFinite(required)) return 0;
  return target - required;
}

export function leftoverCoversInject(leftover) {
  return Number(leftover) > 0;
}

/** Operator Telegram /buy — reason must start with this exact prefix. */
export const MANUAL_BUY_OPERATOR_PREFIX = "MANUAL BUY (operator)";

export function isManualOperatorBuy(reason = "") {
  return String(reason || "").startsWith(MANUAL_BUY_OPERATOR_PREFIX);
}

/** Parse optional USD size: `3`, `$3`, `$3.50`. Invalid / missing → 0. */
export function parseBuyUsdArg(arg) {
  if (arg == null || arg === "") return 0;
  const n = parseFloat(String(arg).trim().replace(/^\$/, "").replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Parse `/buy SYMBOL` and `/buy SYMBOL 3` / `/buy SYMBOL $3`.
 * @returns {{ symbol: string, usd: number } | null}
 */
export function parseManualBuyCommand(raw) {
  const parts = String(raw || "").trim().split(/\s+/);
  if ((parts[0] || "").toLowerCase() !== "/buy") return null;
  const symbol = (parts[1] || "").toUpperCase();
  if (!symbol) return null;
  return { symbol, usd: parseBuyUsdArg(parts[2]) };
}

export function usdToForcedEth(usd, ethUsd) {
  const u = Number(usd);
  const e = Number(ethUsd);
  if (!Number.isFinite(u) || u <= 0 || !Number.isFinite(e) || e <= 0) return 0;
  return u / e;
}

/**
 * Native Railway env: `OPERATOR_BUY=TOSHI:3`
 * Also accepts `TOSHI:$3` and `TOSHI:3.50`. Invalid / empty → null.
 */
export function parseOperatorBuyEnv(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const colon = s.indexOf(":");
  if (colon <= 0) return null;
  const symbol = s.slice(0, colon).trim().toUpperCase();
  const usd = parseBuyUsdArg(s.slice(colon + 1));
  if (!symbol || !usd) return null;
  return { symbol, usd };
}

/**
 * Queue OPERATOR_BUY onto `commands`.
 *
 * `state.done` means the buy *executed* (or was intentionally retired).
 * Do NOT set it on queue — a fatal main() restart must be able to re-queue
 * if the swap never happened. `already-queued` is a live-list check only.
 * @returns {{ queued: boolean, reason: string, symbol?: string, usd?: number }}
 */
export function queueOperatorBuyOnce(commands, rawEnv, knownSymbols, state = { done: false }) {
  if (state.done) return { queued: false, reason: "already-applied" };
  const parsed = parseOperatorBuyEnv(rawEnv);
  if (!parsed) {
    return { queued: false, reason: String(rawEnv ?? "").trim() ? "invalid" : "unset" };
  }
  if (knownSymbols && !knownSymbols.has(parsed.symbol)) {
    return { queued: false, reason: "unknown-symbol", symbol: parsed.symbol, usd: parsed.usd };
  }
  if (commands.some((c) => c.symbol === parsed.symbol && c.action === "buy")) {
    return { queued: false, reason: "already-queued", symbol: parsed.symbol, usd: parsed.usd };
  }
  commands.push({ symbol: parsed.symbol, action: "buy", usd: parsed.usd, source: "OPERATOR_BUY" });
  return { queued: true, reason: "queued", symbol: parsed.symbol, usd: parsed.usd };
}

/** Latch only after executeBuy actually sends the swap. */
export function markOperatorBuyExecuted(state) {
  if (state) {
    state.done = true;
    state.executed = true;
  }
  return state;
}

/**
 * On in-process fatal main() restart: drop a queue-time latch so env buy
 * re-queues. If the swap already executed, keep the latch to avoid a double buy.
 * Legacy: `done=true` with `executed !== true` is a stale queue-time latch.
 */
export function clearOperatorBuyIfNotExecuted(state) {
  if (!state) return state;
  if (state.executed === true) return state;
  state.done = false;
  return state;
}

/** Operator Telegram /sell — reason must start with this exact prefix. */
export const MANUAL_SELL_OPERATOR_PREFIX = "MANUAL SELL (operator)";

export function isManualOperatorSell(reason = "") {
  return String(reason || "").startsWith(MANUAL_SELL_OPERATOR_PREFIX);
}

export function isHalfSellPct(pct) {
  return Math.abs(Number(pct) - 0.5) < 1e-9;
}

export function isFullSellPct(pct) {
  return Math.abs(Number(pct) - 1) < 1e-9;
}

/**
 * Parse sell size: `50`, `50%`, `all`, `half`.
 * Missing / empty → 1 (full sell) unless `required`. Invalid → 0.
 * Returns a fraction in (0, 1].
 */
export function parseSellPctArg(arg, { required = false } = {}) {
  if (arg == null || String(arg).trim() === "") return required ? 0 : 1;
  const s = String(arg).trim().toLowerCase().replace(/,/g, "");
  if (s === "all" || s === "full") return 1;
  if (s === "half") return 0.5;
  const n = parseFloat(s.replace(/%$/, ""));
  if (!Number.isFinite(n) || n <= 0 || n > 100) return 0;
  return n / 100;
}

/**
 * Parse `/sell SYMBOL` and `/sell SYMBOL 50` / `/sell SYMBOL 50%` / `/sell SYMBOL all`.
 * Does not match `/sellhalf`.
 * @returns {{ symbol: string, pct: number } | null}
 */
export function parseManualSellCommand(raw) {
  const parts = String(raw || "").trim().split(/\s+/);
  const verb = (parts[0] || "").toLowerCase();
  if (verb !== "/sell") return null;
  const symbol = (parts[1] || "").toUpperCase();
  if (!symbol) return null;
  const pct = parseSellPctArg(parts[2]);
  if (!pct) return null;
  return { symbol, pct };
}

/**
 * Native Railway env: `OPERATOR_SELL=TOSHI:50`
 * Also accepts `TOSHI:50%`, `TOSHI:all`, `TOSHI:half`. Invalid / empty → null.
 */
export function parseOperatorSellEnv(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const colon = s.indexOf(":");
  if (colon <= 0) return null;
  const symbol = s.slice(0, colon).trim().toUpperCase();
  const pct = parseSellPctArg(s.slice(colon + 1), { required: true });
  if (!symbol || !pct) return null;
  return { symbol, pct };
}

/** Live-queue size for a sell command. Missing pct on `sell` = full. */
export function commandSellPct(cmd) {
  if (!cmd) return 0;
  if (cmd.action === "sellhalf") return 0.5;
  if (cmd.action !== "sell") return 0;
  const pct = Number(cmd.pct);
  return Number.isFinite(pct) && pct > 0 ? pct : 1;
}

export function isMatchingManualSell(cmd, parsed) {
  if (!cmd || !parsed || cmd.symbol !== parsed.symbol) return false;
  const have = commandSellPct(cmd);
  return have > 0 && Math.abs(have - Number(parsed.pct)) < 1e-9;
}

/**
 * TOSHI:50 / 50% / half → existing `sellhalf` action (MANUAL SELL HALF).
 * TOSHI:all / 100 → existing full `sell` action.
 * Other percents → `sell` with explicit `pct` fraction.
 */
export function operatorSellCommand(parsed) {
  if (!parsed) return null;
  if (isHalfSellPct(parsed.pct)) {
    return { symbol: parsed.symbol, action: "sellhalf", source: "OPERATOR_SELL" };
  }
  if (isFullSellPct(parsed.pct)) {
    return { symbol: parsed.symbol, action: "sell", source: "OPERATOR_SELL" };
  }
  return { symbol: parsed.symbol, action: "sell", pct: parsed.pct, source: "OPERATOR_SELL" };
}

/** executeSell fraction: full manual sells keep the 0.98 lottery reserve. */
export function resolveManualSellPct(cmd) {
  const pct = commandSellPct(cmd);
  if (isHalfSellPct(pct)) return 0.5;
  if (pct > 0 && pct < 1) return pct;
  return 0.98;
}

/**
 * Queue OPERATOR_SELL onto `commands`.
 *
 * Same latch rules as OPERATOR_BUY: `state.done` means the sell *executed*.
 * Do NOT set it on queue — a fatal main() restart must re-queue if the swap
 * never happened. `already-queued` is a live-list check only.
 * @returns {{ queued: boolean, reason: string, symbol?: string, pct?: number }}
 */
export function queueOperatorSellOnce(commands, rawEnv, knownSymbols, state = { done: false }) {
  if (state.done) return { queued: false, reason: "already-applied" };
  const parsed = parseOperatorSellEnv(rawEnv);
  if (!parsed) {
    return { queued: false, reason: String(rawEnv ?? "").trim() ? "invalid" : "unset" };
  }
  if (knownSymbols && !knownSymbols.has(parsed.symbol)) {
    return { queued: false, reason: "unknown-symbol", symbol: parsed.symbol, pct: parsed.pct };
  }
  if (commands.some((c) => isMatchingManualSell(c, parsed))) {
    return { queued: false, reason: "already-queued", symbol: parsed.symbol, pct: parsed.pct };
  }
  commands.push(operatorSellCommand(parsed));
  return { queued: true, reason: "queued", symbol: parsed.symbol, pct: parsed.pct };
}

/** Latch only after executeSell actually sends the swap. */
export function markOperatorSellExecuted(state) {
  if (state) {
    state.done = true;
    state.executed = true;
  }
  return state;
}

/**
 * On in-process fatal main() restart: drop a queue-time latch so env sell
 * re-queues. If the swap already executed, keep the latch to avoid a double sell.
 */
export function clearOperatorSellIfNotExecuted(state) {
  if (!state) return state;
  if (state.executed === true) return state;
  state.done = false;
  return state;
}

export function manualSellReason(pct = 1) {
  const n = Number(pct);
  if (Number.isFinite(n) && n > 0 && n < 1) {
    return `${MANUAL_SELL_OPERATOR_PREFIX} ${(n * 100).toFixed(0)}%`;
  }
  return MANUAL_SELL_OPERATOR_PREFIX;
}

/** Per-token OHLC seed budget — one hung DexScreener/GT call must not stall boot. */
export const SEED_TOKEN_TIMEOUT_MS = 8000;

export async function raceTimeout(promise, ms, label = "timeout") {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timeout ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function manualBuyReason(usd = 0) {
  const n = Number(usd);
  return Number.isFinite(n) && n > 0
    ? `${MANUAL_BUY_OPERATOR_PREFIX} $${n}`
    : MANUAL_BUY_OPERATOR_PREFIX;
}

export function hasClearEdge({ reason = "", armed = false, net = 0 } = {}) {
  const positiveNet = Number(net) > 0;
  if (armed && positiveNet) return true;
  const r = String(reason || "").toUpperCase();
  const signals = ["MIN TROUGH", "PRIORITY", "PREDICTED TROUGH", "ARMED", "KAHUNA"];
  return positiveNet && signals.some((s) => r.includes(s));
}

/**
 * @returns {{ allow: boolean, log: string|null, leftover: number, reason: string }}
 */
export function evaluateBuyGate({
  isCascade = false,
  leftover = 0,
  hasEdge = false,
  symbol = "?",
  reason = "",
  env = process.env,
} = {}) {
  const loseZero = isLoseZeroMode(env);
  const injectReq = isInjectCoverRequired(env);
  const covers = leftoverCoversInject(leftover);
  const tag = loseZero ? "LOSE_ZERO" : "REQUIRE_INJECT_COVER";

  // Cascade redeploys exit proceeds — not a speculative new entry
  if (isCascade) {
    return { allow: true, log: null, leftover, reason: "cascade" };
  }

  // Operator /buy — explicit size, not a speculative auto entry
  if (isManualOperatorBuy(reason)) {
    if (!loseZero && !injectReq) {
      return { allow: true, log: null, leftover, reason: "manual-operator" };
    }
    return {
      allow: true,
      log: `${tag}: allow buy ${symbol} MANUAL BUY (operator)`,
      leftover,
      reason: "manual-operator",
    };
  }

  if (!loseZero && !injectReq) {
    return { allow: true, log: null, leftover, reason: "gate-off" };
  }

  if (loseZero) {
    if (hasEdge && covers) {
      return {
        allow: true,
        log: `${tag}: allow buy ${symbol} leftover covers inject`,
        leftover,
        reason: "edge+cover",
      };
    }
    const why = !hasEdge
      ? "no clear edge"
      : Number(leftover) === 0
        ? "leftover is 0"
        : "leftover does not cover inject";
    return {
      allow: false,
      log: `${tag}: block buy ${symbol} ${why}`,
      leftover,
      reason: why,
    };
  }

  // REQUIRE_INJECT_COVER only
  if (!covers) {
    const why = Number(leftover) === 0 ? "leftover is 0" : "leftover does not cover inject";
    return {
      allow: false,
      log: `${tag}: block buy ${symbol} ${why}`,
      leftover,
      reason: why,
    };
  }
  return {
    allow: true,
    log: `${tag}: allow buy ${symbol} leftover covers inject`,
    leftover,
    reason: "cover",
  };
}

/** Build leftover + edge, then evaluate. Used by executeBuy. */
export function buildBuyGateDecision({
  symbol,
  reason = "",
  price,
  existingSellTarget,
  feePct = 0,
  impactPct = 0,
  gasCostEth = 0,
  tradeEth = 0,
  gwei = 0,
  armed = false,
  net = 0,
  isCascade = false,
  env = process.env,
} = {}) {
  const loseZero = isLoseZeroMode(env);
  const injectReq = isInjectCoverRequired(env);
  if (isCascade || isManualOperatorBuy(reason) || (!loseZero && !injectReq)) {
    return evaluateBuyGate({ isCascade, leftover: 0, hasEdge: false, symbol, reason, env });
  }
  const fairExit = computeFairExit(price, { feePct, gasCostEth, tradeEth, impactPct });
  const spread = injectCostSpread(price, tradeEth, gwei);
  const leftover = computeLeftover(existingSellTarget, fairExit, spread);
  const edge = hasClearEdge({ reason, armed, net });
  return evaluateBuyGate({ isCascade, leftover, hasEdge: edge, symbol, reason, env });
}
