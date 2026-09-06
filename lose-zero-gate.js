import { formatHitchFeeSplit } from "./l1-fee-oracle.js";

/**
 * LOSE-ZERO / inject-cover gate for speculative buys AND lose-zero sells.
 *
 * Does not size trades or invent P&L. Decides allow vs block only.
 *
 * Buy penny-pinch: leftover must cover 1× hitch (auto, cascade, ripple, operator).
 * Operator /buy is lossy only if ALLOW_LOSSY_OPERATOR_BUY=yes (default no).
 * Sell lose-zero:  sell_target = fair_exit + fees + (HITCH_COST_MULT * inject_hitch_cost)
 *                  HITCH_COST_MULT default 2 — twice the hitch as profit cushion.
 * inject_hitch_cost = L2 calldata-char gas + live Base L1 data fee (GasPriceOracle
 * getL1Fee / getL1FeeUpperBound) + provider/value fee + optional BTP inscription.
 * L1 is preferred when quoted; oracle failure falls back to L2-only.
 *
 * Never sell at a loss to insert storage. Size hitch so inject_cost × mult ≤ leftover;
 * if leftover is too thin for 2× hitch cover, hold (do not skip the reservation
 * to sneak a thin sell). Once the 2× floor is met, sell immediately.
 */

export const STORE_HITCH_TAG = "§$STORE§";
export const STORE_HITCH_BYTES = 10;               // UTF-8 length of §$STORE§
export const CALLDATA_GAS_PER_NONZERO_BYTE = 16;   // EIP-2028
export const BTP_INSCRIBE_GAS_UNITS = 50_000;      // separate BTP self-send inscription tx
export const DEFAULT_HITCH_COST_MULT = 2;          // sells reserve 2× hitch; buys stay 1×

function hasLiveL1Fee(v) {
  return v !== undefined && v !== null && Number.isFinite(Number(v)) && Number(v) >= 0;
}

export function envFlagYes(name, env = process.env) {
  return String(env[name] ?? "").trim().toLowerCase() === "yes";
}

export function isLoseZeroMode(env = process.env) {
  return envFlagYes("LOSE_ZERO", env) || envFlagYes("HALT_NEW_ENTRIES", env);
}

export function isInjectCoverRequired(env = process.env) {
  return envFlagYes("REQUIRE_INJECT_COVER", env) || isLoseZeroMode(env);
}

/**
 * Sell-side hitch cover multiplier. Env `HITCH_COST_MULT` overrides; default 2.
 * Buys ignore this and stay at 1× leftover cover.
 */
export function hitchCostMult(env = process.env) {
  const n = Number(env?.HITCH_COST_MULT);
  if (Number.isFinite(n) && n >= 0) return n;
  return DEFAULT_HITCH_COST_MULT;
}

export function estimateStoreHitchGasUnits() {
  return STORE_HITCH_BYTES * CALLDATA_GAS_PER_NONZERO_BYTE;
}

/** Hitch cost in ETH given gas price in gwei. Optional live L1 fee is added. */
export function estimateInjectCostEth(gwei, l1FeeEth) {
  const g = Number(gwei);
  if (!Number.isFinite(g) || g < 0) return hasLiveL1Fee(l1FeeEth) ? Number(l1FeeEth) : 0;
  const l2 = estimateStoreHitchGasUnits() * g * 1e-9;
  return l2 + (hasLiveL1Fee(l1FeeEth) ? Number(l1FeeEth) : 0);
}

/**
 * Price increment so a position of `tradeEth` covers hitch gas.
 * inject_cost_spread = (injectEth / tradeEth) * entryPrice
 */
export function injectCostSpread(entryPrice, tradeEth, gwei, l1FeeEth) {
  const injectEth = estimateInjectCostEth(gwei, l1FeeEth);
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

/**
 * Catalog freeze — buy-side only.
 *
 * `token.frozen === true` (or string/number equivalents: "true" / "1" / "yes").
 * ALL new buys must refuse: auto wave, OPERATOR_BUY, Telegram /buy, cascade,
 * ripple. Sells / exits stay allowed so accidental bags can be closed.
 *
 * This is the shared predicate for executeBuy — do not rely on UI, Telegram
 * /frozenlist, or processToken early-return (those miss cascade/ripple and
 * frozen names that already have entryPrice).
 */
export function isCatalogFrozen(token) {
  const flag = token?.frozen;
  if (flag === true || flag === 1) return true;
  if (typeof flag === "string") {
    const s = flag.trim().toLowerCase();
    return s === "true" || s === "1" || s === "yes";
  }
  return false;
}

/** Console line when a buy is skipped because the catalog name is frozen. */
export function frozenBuySkipLog(token) {
  const sym = token?.symbol || "?";
  const why = token?.frozenReason ? ` — ${token.frozenReason}` : "";
  return `❄️ ${sym} FROZEN — skip NEW buy${why}. Exits/sells remain allowed.`;
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
export function queueOperatorBuyOnce(commands, rawEnv, knownSymbols, state = { done: false }, frozenSymbols) {
  if (state.done) return { queued: false, reason: "already-applied" };
  const parsed = parseOperatorBuyEnv(rawEnv);
  if (!parsed) {
    return { queued: false, reason: String(rawEnv ?? "").trim() ? "invalid" : "unset" };
  }
  if (knownSymbols && !knownSymbols.has(parsed.symbol)) {
    return { queued: false, reason: "unknown-symbol", symbol: parsed.symbol, usd: parsed.usd };
  }
  if (frozenSymbols?.has(parsed.symbol)) {
    return { queued: false, reason: "frozen", symbol: parsed.symbol, usd: parsed.usd };
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

  // Cascade / ripple are capital redeploys, not a silent bypass — same
  // leftover + edge gate as auto buys. isCascade is accepted for callers
  // but never auto-allows.
  void isCascade;

  // Operator /buy is lossy only when ALLOW_LOSSY_OPERATOR_BUY=yes (default no).
  if (canBypassBuyLossGate(reason, env)) {
    if (!loseZero && !injectReq) {
      return { allow: true, log: null, leftover, reason: "manual-operator" };
    }
    return {
      allow: true,
      log: `${tag}: allow buy ${symbol} MANUAL BUY (operator) ALLOW_LOSSY_OPERATOR_BUY`,
      leftover,
      reason: "lossy-operator",
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
  l1FeeEth,
  armed = false,
  net = 0,
  isCascade = false,
  env = process.env,
} = {}) {
  const loseZero = isLoseZeroMode(env);
  const injectReq = isInjectCoverRequired(env);
  // Cascade / ripple must compute leftover + edge. Operator skips math only
  // when ALLOW_LOSSY_OPERATOR_BUY=yes (forced-proof bypass).
  if (canBypassBuyLossGate(reason, env) || (!loseZero && !injectReq)) {
    return evaluateBuyGate({ isCascade, leftover: 0, hasEdge: false, symbol, reason, env });
  }
  const fairExit = computeFairExit(price, { feePct, gasCostEth, tradeEth, impactPct });
  const spread = injectCostSpread(price, tradeEth, gwei, l1FeeEth);
  const leftover = computeLeftover(existingSellTarget, fairExit, spread);
  const edge = hasClearEdge({ reason, armed, net });
  const l2FeeEth = estimateCalldataHitchEth(STORE_HITCH_BYTES, gwei);
  const decision = evaluateBuyGate({ isCascade, leftover, hasEdge: edge, symbol, reason, env });
  const source = hasLiveL1Fee(l1FeeEth) ? "oracle" : "fallback";
  return {
    ...decision,
    l1FeeEth: hasLiveL1Fee(l1FeeEth) ? Number(l1FeeEth) : 0,
    l2FeeEth,
    hitchFeeSource: source,
    feeSplitLog: formatHitchFeeSplit({
      l1FeeEth: hasLiveL1Fee(l1FeeEth) ? Number(l1FeeEth) : 0,
      l2FeeEth,
      source,
    }),
  };
}

export function isAllowLossyOperatorBuy(env = process.env) {
  return envFlagYes("ALLOW_LOSSY_OPERATOR_BUY", env);
}

export function canBypassBuyLossGate(reason = "", env = process.env) {
  return isManualOperatorBuy(reason) && isAllowLossyOperatorBuy(env);
}

export function isAllowLossyOperatorSell(env = process.env) {
  return envFlagYes("ALLOW_LOSSY_OPERATOR_SELL", env);
}

export function canBypassSellLossGate(reason = "", env = process.env) {
  return isManualOperatorSell(reason) && isAllowLossyOperatorSell(env);
}

export function isStopLossReason(reason = "") {
  return String(reason || "").toUpperCase().startsWith("STOP LOSS");
}

export function isMoonshotTrimReason(reason = "") {
  return String(reason || "").toUpperCase().includes("MOONSHOT TRIM");
}

/** Hitch calldata gas in ETH for N bytes at `gwei`. */
export function estimateCalldataHitchEth(bytes, gwei) {
  const b = Math.max(0, Number(bytes) || 0);
  const g = Number(gwei);
  if (!Number.isFinite(g) || g < 0) return 0;
  return b * CALLDATA_GAS_PER_NONZERO_BYTE * g * 1e-9;
}

export function estimateBtpInscribeEth(gwei, gasUnits = BTP_INSCRIBE_GAS_UNITS) {
  const g = Number(gwei);
  const u = Number(gasUnits);
  if (!Number.isFinite(g) || g < 0 || !Number.isFinite(u) || u <= 0) return 0;
  return u * g * 1e-9;
}

/**
 * inject_hitch_cost = L2 calldata + live L1 data fee (when quoted) + provider
 * + optional BTP (L2 gas + optional BTP L1). Missing L1 → L2-only fallback.
 */
export function estimateInjectHitchCostEth({
  hitchBytes = STORE_HITCH_BYTES,
  gwei = 0,
  providerFeeEth = 0,
  btpInscribe = false,
  btpGasUnits = BTP_INSCRIBE_GAS_UNITS,
  l1FeeEth,
  btpL1FeeEth,
} = {}) {
  const provider = Math.max(0, Number(providerFeeEth) || 0);
  const calldata = estimateCalldataHitchEth(hitchBytes, gwei);
  const l1 = hasLiveL1Fee(l1FeeEth) ? Number(l1FeeEth) : 0;
  const btp = btpInscribe ? estimateBtpInscribeEth(gwei, btpGasUnits) : 0;
  const btpL1 = btpInscribe && hasLiveL1Fee(btpL1FeeEth) ? Number(btpL1FeeEth) : 0;
  return calldata + l1 + provider + btp + btpL1;
}

export function entrySliceEth(entryEth, sellPct) {
  return Math.max(0, Number(entryEth) || 0) * Math.max(0, Number(sellPct) || 0);
}

export function sellFeesEth({
  projectedProceedsEth = 0,
  feePct = 0,
  gasCostEth = 0,
  impactPct = 0,
} = {}) {
  const proceeds = Math.max(0, Number(projectedProceedsEth) || 0);
  const fee = Math.max(0, Number(feePct) || 0) * proceeds;
  const impact = Math.max(0, Number(impactPct) || 0) * proceeds;
  const gas = Math.max(0, Number(gasCostEth) || 0);
  return fee + impact + gas;
}

/**
 * Minimum ETH proceeds required so the sell covers entry + fees + N× hitch.
 * sell_target = fair_exit + fees + (HITCH_COST_MULT * inject_hitch_cost)
 */
export function minSellProceedsEth({
  entryEth = 0,
  sellPct = 1,
  projectedProceedsEth = 0,
  feePct = 0,
  gasCostEth = 0,
  impactPct = 0,
  hitchBytes = STORE_HITCH_BYTES,
  gwei = 0,
  providerFeeEth = 0,
  btpInscribe = false,
  btpGasUnits = BTP_INSCRIBE_GAS_UNITS,
  hitchCostMult: mult = DEFAULT_HITCH_COST_MULT,
  l1FeeEth,
  btpL1FeeEth,
} = {}) {
  const hitch = estimateInjectHitchCostEth({
    hitchBytes, gwei, providerFeeEth, btpInscribe, btpGasUnits, l1FeeEth, btpL1FeeEth,
  });
  const m = Number.isFinite(Number(mult)) && Number(mult) >= 0 ? Number(mult) : DEFAULT_HITCH_COST_MULT;
  return entrySliceEth(entryEth, sellPct)
    + sellFeesEth({ projectedProceedsEth, feePct, gasCostEth, impactPct })
    + m * hitch;
}

/** Leftover ETH after entry slice + sell-side fees, before hitch. */
export function leftoverAfterFeesEth({
  projectedProceedsEth = 0,
  entryEth = 0,
  sellPct = 1,
  feePct = 0,
  gasCostEth = 0,
  impactPct = 0,
} = {}) {
  const proceeds = Number(projectedProceedsEth);
  if (!Number.isFinite(proceeds) || proceeds <= 0) return 0;
  return proceeds
    - entrySliceEth(entryEth, sellPct)
    - sellFeesEth({ projectedProceedsEth, feePct, gasCostEth, impactPct });
}

/**
 * True iff projected proceeds strictly beat entry + fees + (mult × hitch).
 */
export function coversHitchAndEntry(args = {}) {
  const proceeds = Number(args.projectedProceedsEth);
  const min = minSellProceedsEth(args);
  const leftover = leftoverAfterFeesEth(args);
  const hitchCostEth = estimateInjectHitchCostEth(args);
  const mult = Number.isFinite(Number(args.hitchCostMult)) && Number(args.hitchCostMult) >= 0
    ? Number(args.hitchCostMult)
    : DEFAULT_HITCH_COST_MULT;
  const edge = Number.isFinite(proceeds) && Number.isFinite(min) ? proceeds - min : 0;
  return {
    covers: Number.isFinite(proceeds) && Number.isFinite(min) && proceeds > min,
    minSellProceedsEth: min,
    leftover,
    hitchCostEth,
    hitchCoverEth: mult * hitchCostEth,
    hitchCostMult: mult,
    edge,
    proceeds,
  };
}

/** Max hitch bytes leftover can pay at `gwei` after a provider fee (+ optional L1/byte). */
export function maxHitchBytesForLeftover(leftoverEth, gwei, providerFeeEth = 0, l1FeePerByteEth = 0) {
  const leftover = Number(leftoverEth);
  const fee = Math.max(0, Number(providerFeeEth) || 0);
  if (!Number.isFinite(leftover) || leftover <= 0) return 0;
  const afterFee = leftover - fee;
  if (afterFee <= 0) return 0;
  const g = Number(gwei);
  const l2PerByte = Number.isFinite(g) && g > 0 ? CALLDATA_GAS_PER_NONZERO_BYTE * g * 1e-9 : 0;
  const l1PerByte = Math.max(0, Number(l1FeePerByteEth) || 0);
  const perByte = l2PerByte + l1PerByte;
  if (perByte <= 0) return Number.MAX_SAFE_INTEGER;
  return Math.floor(afterFee / perByte);
}

/**
 * Size hitch so (HITCH_COST_MULT × inject_cost) ≤ leftover.
 * Budget for actual hitch = leftover / mult. Extra BTP/STORE bytes that would
 * break the 2× cushion are skipped rather than selling at a loss to make room.
 */
export function sizeHitchForSell({
  leftoverEth = 0,
  wantedBytes = STORE_HITCH_BYTES,
  gwei = 0,
  providerFeeEth = 0,
  wantBtpInscribe = false,
  btpGasUnits = BTP_INSCRIBE_GAS_UNITS,
  hitchCostMult: mult = DEFAULT_HITCH_COST_MULT,
  l1FeeEth,
  l1FeePerByteEth,
  btpL1FeeEth,
} = {}) {
  const leftover = Number(leftoverEth);
  const m = Number.isFinite(Number(mult)) && Number(mult) > 0 ? Number(mult) : DEFAULT_HITCH_COST_MULT;
  if (!Number.isFinite(leftover) || leftover <= 0) {
    return { hitchBytes: 0, btpInscribe: false, injectCostEth: 0, skipHitch: true, hitchCostMult: m };
  }

  // Only spend leftover/mult on the actual hitch so leftover still covers N×.
  const budget = leftover / m;
  let remaining = budget;
  let btp = false;
  const btpL1 = hasLiveL1Fee(btpL1FeeEth) ? Number(btpL1FeeEth) : 0;
  if (wantBtpInscribe) {
    const btpCost = estimateBtpInscribeEth(gwei, btpGasUnits) + btpL1;
    if (btpCost > 0 && btpCost < remaining) {
      btp = true;
      remaining -= btpCost;
    }
  }

  const wanted = Math.max(0, Math.floor(Number(wantedBytes) || 0));
  const perByteL1 = hasLiveL1Fee(l1FeePerByteEth)
    ? Number(l1FeePerByteEth)
    : (hasLiveL1Fee(l1FeeEth) && wanted > 0 ? Number(l1FeeEth) / wanted : 0);
  const maxBytes = maxHitchBytesForLeftover(remaining, gwei, providerFeeEth, perByteL1);
  const hitchBytes = maxBytes <= 0 || wanted <= 0 ? 0 : Math.min(wanted, maxBytes);
  const sizedL1 = hitchBytes > 0 && perByteL1 > 0
    ? perByteL1 * hitchBytes
    : (hitchBytes === wanted && hasLiveL1Fee(l1FeeEth) ? Number(l1FeeEth) : undefined);
  const injectCostEth = estimateInjectHitchCostEth({
    hitchBytes,
    gwei,
    providerFeeEth,
    btpInscribe: btp,
    btpGasUnits,
    l1FeeEth: sizedL1,
    btpL1FeeEth: btp ? btpL1FeeEth : undefined,
  });
  const skipHitch = hitchBytes === 0 && !btp;
  return { hitchBytes, btpInscribe: btp, injectCostEth, skipHitch, hitchCostMult: m };
}

/**
 * LOSE-ZERO sell gate. Always on.
 *
 * sell_target = fair_exit + fees + (HITCH_COST_MULT * inject_hitch_cost)
 * Hold unless leftover after fees covers N× hitch (default 2). Buys stay 1×.
 * Once the floor is met, the caller must sell immediately — do not wait past it.
 * Only exception: reason starts with `MANUAL SELL (operator)` AND
 * ALLOW_LOSSY_OPERATOR_SELL=yes. Stop-loss still exits (hitch skipped).
 */
export function evaluateSellGate({
  projectedProceedsEth = 0,
  entryEth = 0,
  sellPct = 1,
  feePct = 0,
  gasCostEth = 0,
  impactPct = 0,
  wantedHitchBytes = STORE_HITCH_BYTES,
  gwei = 0,
  providerFeeEth = 0,
  wantBtpInscribe = false,
  btpGasUnits = BTP_INSCRIBE_GAS_UNITS,
  hitchCostMult: multArg,
  l1FeeEth,
  reservedL1FeeEth,
  l1FeePerByteEth,
  btpL1FeeEth,
  hitchFeeSource,
  reason = "",
  symbol = "?",
  env = process.env,
} = {}) {
  const mult = Number.isFinite(Number(multArg)) && Number(multArg) >= 0
    ? Number(multArg)
    : hitchCostMult(env);
  const base = {
    projectedProceedsEth,
    entryEth,
    sellPct,
    feePct,
    gasCostEth,
    impactPct,
    gwei,
    providerFeeEth,
    btpGasUnits,
    hitchCostMult: mult,
    l1FeeEth,
    btpL1FeeEth,
  };
  const leftover = leftoverAfterFeesEth(base);

  const wanted = Math.max(0, Number(wantedHitchBytes) || 0);
  const reservedL1 = hasLiveL1Fee(reservedL1FeeEth)
    ? Number(reservedL1FeeEth)
    : (hasLiveL1Fee(l1FeeEth) && wanted > 0
      ? Number(l1FeeEth) * STORE_HITCH_BYTES / wanted
      : undefined);
  const source = hitchFeeSource
    || (hasLiveL1Fee(l1FeeEth) || hasLiveL1Fee(reservedL1) ? "oracle" : "fallback");

  // Floor always reserves N× the default §$STORE§ hitch. BTP / orch chunks
  // are extra — skip them if they would break the cushion, but never skip
  // this reservation to sneak a thin sell.
  const reservedHitch = estimateInjectHitchCostEth({
    hitchBytes: STORE_HITCH_BYTES,
    gwei,
    providerFeeEth,
    btpInscribe: false,
    btpGasUnits,
    l1FeeEth: reservedL1,
  });
  const reservedCover = coversHitchAndEntry({
    ...base,
    hitchBytes: STORE_HITCH_BYTES,
    btpInscribe: false,
    l1FeeEth: reservedL1,
    btpL1FeeEth: undefined,
  });

  const sized = sizeHitchForSell({
    leftoverEth: leftover,
    wantedBytes: wantedHitchBytes,
    gwei,
    providerFeeEth,
    wantBtpInscribe,
    btpGasUnits,
    hitchCostMult: mult,
    l1FeeEth,
    l1FeePerByteEth,
    btpL1FeeEth,
  });
  const check = coversHitchAndEntry({
    ...base,
    hitchBytes: sized.hitchBytes,
    btpInscribe: sized.btpInscribe,
    l1FeeEth: sized.hitchBytes > 0 && hasLiveL1Fee(l1FeeEth) && wanted > 0
      ? Number(l1FeeEth) * sized.hitchBytes / wanted
      : (sized.hitchBytes === wanted ? l1FeeEth : undefined),
    btpL1FeeEth: sized.btpInscribe ? btpL1FeeEth : undefined,
  });

  const pack = (allow, why, extra = {}) => {
    const bytes = extra.hitchBytes ?? sized.hitchBytes;
    const l2FeeEth = estimateCalldataHitchEth(bytes || STORE_HITCH_BYTES, gwei);
    const liveL1 = hasLiveL1Fee(extra.l1FeeEth)
      ? Number(extra.l1FeeEth)
      : (hasLiveL1Fee(reservedL1) ? Number(reservedL1) : (hasLiveL1Fee(l1FeeEth) ? Number(l1FeeEth) : 0));
    const liveBtpL1 = extra.btpInscribe ?? sized.btpInscribe
      ? (hasLiveL1Fee(btpL1FeeEth) ? Number(btpL1FeeEth) : 0)
      : 0;
    return {
      allow,
      leftover,
      hitchBytes: bytes,
      btpInscribe: extra.btpInscribe ?? sized.btpInscribe,
      skipHitch: extra.skipHitch ?? sized.skipHitch,
      injectCostEth: extra.injectCostEth ?? sized.injectCostEth,
      hitchCostMult: mult,
      hitchCoverEth: extra.hitchCoverEth ?? (mult * (extra.injectCostEth ?? sized.injectCostEth)),
      reservedHitchEth: reservedHitch,
      edge: extra.edge ?? check.edge,
      minSellProceedsEth: extra.minSellProceedsEth ?? check.minSellProceedsEth,
      sellNow: extra.sellNow ?? allow,
      l1FeeEth: liveL1,
      l2FeeEth,
      btpL1FeeEth: liveBtpL1,
      hitchFeeSource: extra.hitchFeeSource ?? source,
      feeSplitLog: formatHitchFeeSplit({
        l1FeeEth: liveL1,
        l2FeeEth,
        btpL1FeeEth: liveBtpL1,
        source: extra.hitchFeeSource ?? source,
      }),
      log: extra.log ?? `LOSE_ZERO: ${allow ? "allow" : "hold"} sell ${symbol} ${why}`,
      reason: why,
    };
  };

  if (canBypassSellLossGate(reason, env)) {
    return pack(true, "lossy-operator", {
      log: `LOSE_ZERO: allow sell ${symbol} MANUAL SELL (operator) ALLOW_LOSSY_OPERATOR_SELL`,
    });
  }

  if (isStopLossReason(reason)) {
    return pack(true, "stop-loss", {
      hitchBytes: 0,
      btpInscribe: false,
      skipHitch: true,
      injectCostEth: 0,
      hitchCoverEth: 0,
      log: `LOSE_ZERO: allow sell ${symbol} STOP LOSS hitch skipped`,
    });
  }

  // No leftover, or leftover cannot cover N× reserved hitch — hold.
  if (leftover <= 0 || !reservedCover.covers) {
    return pack(false, "hitch would wipe edge", {
      hitchBytes: 0,
      btpInscribe: false,
      skipHitch: true,
      injectCostEth: 0,
      hitchCoverEth: reservedCover.hitchCoverEth,
      edge: reservedCover.edge,
      minSellProceedsEth: reservedCover.minSellProceedsEth,
      sellNow: false,
    });
  }

  // Extra queued hitch/BTP would eat the 2× cushion — skip extra, sell now.
  if (!check.covers || leftover - mult * sized.injectCostEth <= 0) {
    return pack(true, "skip hitch leftover too thin", {
      hitchBytes: 0,
      btpInscribe: false,
      skipHitch: true,
      injectCostEth: 0,
      hitchCoverEth: reservedCover.hitchCoverEth,
      edge: reservedCover.edge,
      minSellProceedsEth: reservedCover.minSellProceedsEth,
      sellNow: true,
      log: `LOSE_ZERO: allow sell ${symbol} leftover covers ${mult}x hitch — skip extra hitch, sell now`,
    });
  }

  return pack(true, "leftover covers hitch + edge", {
    sellNow: true,
    log: `LOSE_ZERO: allow sell ${symbol} leftover covers hitch + edge — sell now (${mult}x hitch)`,
  });
}

/** Build leftover + hitch plan, then evaluate. Used by executeSell + moonshot trim. */
export function buildSellGateDecision({
  symbol,
  reason = "",
  sellPct = 1,
  entryEth = 0,
  projectedProceedsEth = 0,
  feePct = 0,
  impactPct = 0,
  gasCostEth = 0,
  gwei = 0,
  providerFeeEth = 0,
  wantedHitchBytes = STORE_HITCH_BYTES,
  wantBtpInscribe = false,
  hitchCostMult: multArg,
  l1FeeEth,
  reservedL1FeeEth,
  l1FeePerByteEth,
  btpL1FeeEth,
  hitchFeeSource,
  env = process.env,
} = {}) {
  return evaluateSellGate({
    projectedProceedsEth,
    entryEth,
    sellPct,
    feePct,
    gasCostEth,
    impactPct,
    wantedHitchBytes,
    gwei,
    providerFeeEth,
    wantBtpInscribe,
    hitchCostMult: multArg,
    l1FeeEth,
    reservedL1FeeEth,
    l1FeePerByteEth,
    btpL1FeeEth,
    hitchFeeSource,
    reason,
    symbol,
    env,
  });
}
