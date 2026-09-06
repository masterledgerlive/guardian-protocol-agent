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
