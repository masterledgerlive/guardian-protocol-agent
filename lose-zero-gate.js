import { formatHitchFeeSplit } from "./l1-fee-oracle.js";
import { forceExitLockedEnabled, forceExitSymbols } from "./forced-exit.js";

/**
 * LOSE-ZERO / inject-cover gate for speculative buys AND lose-zero sells.
 *
 * Does not size trades or invent P&L. Decides allow vs block only.
 *
 * Buy penny-pinch: leftover must cover 1× hitch (auto, cascade, ripple).
 * Operator Telegram /buy is an explicit test: leftover+edge never block it.
 * Hitch VITA KEY+LOC if leftover covers 1× hitch; otherwise send a plain swap.
 * Frozen / PRICE_INSANE / insufficient ETH / fill honesty still apply.
 * Add-on into a known FIFO-red lot is blocked by default
 * (`ALLOW_ADD_ON_FIFO_RED`); first buy into empty/flat is OK.
 * Sell always-plus (hard rule): expected net proceeds must beat
 *   entry_basis_for_sold_frac + fees
 * even by 1 wei (micro extract). Hitch: **original message-first** (default)
 * sends when leftover covers 1× hitch and still plus — Storage Token can
 * charge the transmission delta. The 2× HITCH_COST_MULT cushion is preferred
 * when available; when only 1× covers, still hitch (do not mute for micro
 * skim). Opt out with VITA_MESSAGE_FIRST=no to restore SKIP_HITCH + bank.
 * Never HOLD a green exit waiting for a fat wave, and do not invent P&L.
 * inject_hitch_cost = L2 calldata-char gas + live Base L1 data fee (GasPriceOracle
 * getL1Fee / getL1FeeUpperBound) + provider/value fee + optional BTP inscription.
 * L1 is preferred when quoted; oracle failure → SKIP_HITCH (plain plus sale).
 *
 * If hitch would push net ≤ 0: SKIP_HITCH and sell plain only when plain is
 * still plus; else HOLD. Never sell red to place code. Unknown-cost bags
 * cannot prove plus vs entry → HOLD (no fake-green recycle). Piggy dust is
 * never sold; soldFrac must match tokens actually sold.
 * Remaining cost is FIFO/average of lots still on chain
 * (`ethIn × remainingTokens / tokensIn`), never cash-flow `ethIn − ethOut`.
 * After a plus partial sell, cash-flow leftover understates the leftover pile
 * and the plus gate would paint a later FIFO-red exit green. Exits-only /
 * frozen names still obey this gate. Underwater exceptions (hitch SKIP on red):
 * FORCE EXIT LOCKED, FORCE_EXIT_SYMBOLS (when force-exit is on), and
 * ALLOW_LOSSY_OPERATOR_SELL=yes for MANUAL SELL (operator) / OPERATOR_SELL
 * listed names. Green FORCE EXIT / lossy plus still hitch when message-first
 * leftover covers 1× KEY+LOC — do not mute the chain on a recovery unwind.
 * Auto sells stay HOLD when those flags are off.
 */

export const STORE_HITCH_TAG = "§$STORE§";
export const STORE_HITCH_BYTES = 10;               // UTF-8 length of §$STORE§

/**
 * Original VITA formula: when leftover covers KEY+LOC (1×), send the hitch.
 * Default on. Set VITA_MESSAGE_FIRST=no (or VITA_ORIGINAL_FORMULA=no) to
 * restore micro-extract SKIP_HITCH + bank when below the 2× cushion.
 */
export function isOriginalFormulaMessageFirst(env = process.env) {
  const raw = env?.VITA_MESSAGE_FIRST ?? env?.VITA_ORIGINAL_FORMULA ?? "yes";
  const v = String(raw).trim().toLowerCase();
  return v !== "no" && v !== "0" && v !== "false" && v !== "off";
}
export const CALLDATA_GAS_PER_NONZERO_BYTE = 16;   // EIP-2028
export const BTP_INSCRIBE_GAS_UNITS = 50_000;      // separate BTP self-send inscription tx
export const DEFAULT_HITCH_COST_MULT = 2;          // hitch-floor / size cushion leftover/mult; micro extract ignores this
/** Eureka letter class — picture 10KB is a size ceiling, not a hitch-floor packet. */
export const EUREKA_LETTER_BYTES = 229;
/** 1 wei — every auto exit must print at least this plus after entry+fees (hitch optional). */
export const MIN_PLUS_ETH = 1e-18;
/**
 * Unknown-cost bags (entryEth=0) used to look "green" on leftover = proceeds − fees
 * alone, then recycle as fake wins while the RISK book bled ($10→$6). Always-plus
 * HOLDs them — leftover without a cost basis is not plus vs entry. Gas-edge mult
 * kept for diagnostics / sims only.
 */
export const UNKNOWN_COST_GAS_EDGE_MULT = 2;

function hasLiveL1Fee(v) {
  return v !== undefined && v !== null && Number.isFinite(Number(v)) && Number(v) >= 0;
}

export function envFlagYes(name, env = process.env) {
  return String(env[name] ?? "").trim().toLowerCase() === "yes";
}

export function envFlagOn(name, env = process.env) {
  const s = String(env[name] ?? "").trim().toLowerCase();
  return s === "yes" || s === "true" || s === "1" || s === "on";
}

export function envFlagOff(name, env = process.env) {
  const s = String(env[name] ?? "").trim().toLowerCase();
  return s === "no" || s === "false" || s === "0" || s === "off";
}

/**
 * Friday DOW_BIAS sellMod +0.08 / Fri-close UTC 19–22 is hardcoded in agent.js
 * and live-bleeding (AERO 0x326f41af / DRB 0x808acc7d FIFO-red flips).
 * Unset treats as ON so Railway does not need a new var to kill Friday.
 * After calm: DISABLE_DOW_BIAS=no restores day-of-week mods.
 */
export function isDisableDowBias(env = process.env) {
  if (envFlagOff("DISABLE_DOW_BIAS", env)) return false;
  return true;
}

/** Zero buyMod/sellMod when DISABLE_DOW_BIAS is on (hotfix default). */
export function applyDowBiasDisable(bias, env = process.env) {
  if (!bias || typeof bias !== "object") return bias;
  if (!isDisableDowBias(env)) return bias;
  return { ...bias, buyMod: 0, sellMod: 0 };
}

/** Fri 3–6pm EST = UTC 19–22. Disabled when DISABLE_DOW_BIAS is on (default). */
export function isFridayCloseWindow({ now = new Date(), env = process.env } = {}) {
  if (isDisableDowBias(env)) return false;
  const d = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(d.getTime())) return false;
  return d.getDay() === 5 && d.getUTCHours() >= 19 && d.getUTCHours() <= 22;
}

/** Operator / fresh-lot cost stays armed so a Friday flip cannot drop the floor. */
export const FRESH_LOT_HOLD_MS = 6 * 60 * 60 * 1000;

export function latchFreshLot(token, {
  fillCostEth = 0,
  tokens = 0,
  reason = "",
  now = Date.now(),
} = {}) {
  if (!token) return token;
  const cost = Number(fillCostEth);
  if (!(cost > 0)) return token;
  token.freshLotAt = now;
  token.freshLotCostEth = cost;
  if (isManualOperatorBuy(reason)) {
    token.operatorLot = { fillCostEth: cost, tokens: Number(tokens) || 0, at: now };
  }
  return token;
}

export function clearFreshLot(token) {
  if (!token) return token;
  token.freshLotAt = 0;
  token.freshLotCostEth = 0;
  token.operatorLot = null;
  return token;
}

export function freshLotCostFloor(token, now = Date.now()) {
  const lot = token?.operatorLot;
  if (lot && Number(lot.fillCostEth) > 0) return Number(lot.fillCostEth);
  const at = Number(token?.freshLotAt || 0);
  const cost = Number(token?.freshLotCostEth || 0);
  if (at > 0 && cost > 0 && (now - at) >= 0 && (now - at) < FRESH_LOT_HOLD_MS) return cost;
  return 0;
}

export function sellEntryEthWithLotFloor(entryEth = 0, token, now = Date.now()) {
  const base = Number(entryEth);
  const floor = freshLotCostFloor(token, now);
  return Math.max(Number.isFinite(base) && base > 0 ? base : 0, floor);
}

export function usdMarkBelowBreakeven({ markProceedsEth = 0, entrySoldEth = 0 } = {}) {
  const mark = Number(markProceedsEth);
  const entry = Number(entrySoldEth);
  if (!(mark > 0) || !(entry > 0)) return false;
  return mark + MIN_PLUS_ETH < entry;
}

/**
 * Add-on into a known FIFO-red lot (DRB 0x53a00788 class after #83 latch).
 * Stacking size into an underwater bag spends RISK while always-plus HOLDs
 * exits. Default OFF / block. Game override: ALLOW_ADD_ON_FIFO_RED=yes.
 * First buy into empty/flat is OK. Unknown bags are not "known FIFO red."
 */
export const ADD_ON_BAG_MIN_TOKENS = 0.001;

export function isAllowAddOnFifoRed(env = process.env) {
  return envFlagOn("ALLOW_ADD_ON_FIFO_RED", env);
}

/**
 * Remaining FIFO eth of the bag still on chain. Do **not** raise to the
 * sell-side lot floor (`sellEntryEthWithLotFloor` / `operatorLot`) — that
 * floor is the last fill so Friday cannot sell red. After a plus partial,
 * leftover/piggy mark vs the unshrunk fill is almost always "red" and
 * would skip a first buy into empty/dust.
 */
export function addOnRemainingFifoEth(token) {
  if (!token || token.unknownEntry === true) return 0;
  const n = Number(token.totalInvestedEth);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Same bag ETH mark executeSell uses: units × USD / ETHUSD. */
export function bagMarkProceedsEth({ tokenBal = 0, priceUsd = 0, ethUsd = 0 } = {}) {
  const bal = Number(tokenBal);
  const px = Number(priceUsd);
  const eth = Number(ethUsd);
  if (!(bal > 0) || !(px > 0) || !(eth > 0)) return 0;
  return (bal * px) / eth;
}

export function isExistingKnownFifoBag({
  tokenBal = 0,
  remainingFifoEth = 0,
  unknownEntry = false,
} = {}) {
  if (unknownEntry === true) return false;
  const bal = Number(tokenBal);
  const fifo = Number(remainingFifoEth);
  return Number.isFinite(bal) && bal > ADD_ON_BAG_MIN_TOKENS
    && Number.isFinite(fifo) && fifo > 0;
}

export function isFifoRedLot({
  markProceedsEth = 0,
  remainingFifoEth = 0,
} = {}) {
  return usdMarkBelowBreakeven({
    markProceedsEth,
    entrySoldEth: remainingFifoEth,
  });
}

/**
 * Block inject-pullback / auto trough / OPERATOR_BUY / Telegram /buy add-ons
 * when the existing known FIFO lot is already red (mark < remaining FIFO).
 * @returns {{ allow: boolean, blocked: boolean, reason: string, log: string|null }}
 */
export function evaluateAddOnFifoRedGate({
  symbol = "?",
  tokenBal = 0,
  remainingFifoEth = 0,
  markProceedsEth = 0,
  unknownEntry = false,
  reason = "",
  env = process.env,
} = {}) {
  void reason;
  const existing = isExistingKnownFifoBag({ tokenBal, remainingFifoEth, unknownEntry });
  if (!existing) {
    return { allow: true, blocked: false, reason: "flat-or-empty", log: null };
  }
  const red = isFifoRedLot({ markProceedsEth, remainingFifoEth });
  if (!red) {
    return { allow: true, blocked: false, reason: "fifo-not-red", log: null };
  }
  const mark = Number(markProceedsEth);
  const fifo = Number(remainingFifoEth);
  const cmp = `mark ${mark.toExponential(2)} < remaining FIFO ${fifo.toExponential(2)}`;
  if (isAllowAddOnFifoRed(env)) {
    return {
      allow: true,
      blocked: false,
      reason: "override",
      log: `ADD_ON_FIFO_RED: allow add-on ${symbol} Game override ALLOW_ADD_ON_FIFO_RED (${cmp})`,
    };
  }
  return {
    allow: false,
    blocked: true,
    reason: "fifo-red",
    log:
      `ADD_ON_FIFO_RED: skip add-on ${symbol} — existing FIFO lot is red (${cmp}); ` +
      `wait PLUS+hitch. Set ALLOW_ADD_ON_FIFO_RED=yes to override.`,
  };
}

export function isLoseZeroMode(env = process.env) {
  return envFlagYes("LOSE_ZERO", env) || envFlagYes("HALT_NEW_ENTRIES", env);
}

export function isInjectCoverRequired(env = process.env) {
  return envFlagYes("REQUIRE_INJECT_COVER", env) || isLoseZeroMode(env);
}

/**
 * Sell-side hitch *attach* + size multiplier. Env `HITCH_COST_MULT` overrides; default 2.
 * Micro extract sells at leftover after fees (no hitch). Hitch rides only when
 * leftover after the piggy buffer also covers hitch_cost × mult (2× Eureka
 * cushion when banking is reserved). Buys ignore this and stay at 1× leftover cover.
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
export function estimateInjectCostEth(gwei, l1FeeEth, hitchBytes = STORE_HITCH_BYTES) {
  const g = Number(gwei);
  if (!Number.isFinite(g) || g < 0) return hasLiveL1Fee(l1FeeEth) ? Number(l1FeeEth) : 0;
  const bytes = Math.max(STORE_HITCH_BYTES, Math.floor(Number(hitchBytes) || 0) || STORE_HITCH_BYTES);
  const l2 = estimateCalldataHitchEth(bytes, gwei);
  return l2 + (hasLiveL1Fee(l1FeeEth) ? Number(l1FeeEth) : 0);
}

/**
 * Price increment so a position of `tradeEth` covers hitch gas.
 * inject_cost_spread = (injectEth / tradeEth) * entryPrice
 */
export function injectCostSpread(entryPrice, tradeEth, gwei, l1FeeEth, hitchBytes = STORE_HITCH_BYTES) {
  const injectEth = estimateInjectCostEth(gwei, l1FeeEth, hitchBytes);
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

/**
 * Pull queued buy commands out of `commands` (OPERATOR_BUY and Telegram /buy).
 * Leaves sells / exits in place. Used to flush operator buys before OHLC seed.
 */
export function takeQueuedManualBuys(commands) {
  const list = Array.isArray(commands) ? commands : [];
  const buys = [];
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i]?.action === "buy") {
      buys.unshift(list.splice(i, 1)[0]);
    }
  }
  return buys;
}

/**
 * After a flush / processToken buy attempt: only a real fill retires the
 * command. Skip, throw, cold wallet, safe mode, or route miss must re-queue
 * so OPERATOR_BUY / Telegram /buy is not dropped before exactInputSingle.
 */
export function settleFlushedOperatorBuy(commands, cmd, spent) {
  const list = Array.isArray(commands) ? commands : [];
  if (spent) return { requeued: false, reason: "spent" };
  if (!cmd || cmd.action !== "buy") return { requeued: false, reason: "not-buy" };
  const already = list.some((c) => c && c.symbol === cmd.symbol && c.action === "buy");
  if (already) return { requeued: false, reason: "already-queued" };
  list.push(cmd);
  return { requeued: true, reason: "unspent" };
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
 * One OPERATOR_SELL entry: `TOSHI:50`, `AERO:all`, `DRB:100`, or bare `BNKR`
 * (bare = 100% / all). Invalid / empty → null.
 */
export function parseOperatorSellEntry(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const colon = s.indexOf(":");
  if (colon <= 0) {
    const symbol = s.toUpperCase();
    if (!/^[A-Z0-9._-]+$/.test(symbol)) return null;
    return { symbol, pct: 1 };
  }
  const symbol = s.slice(0, colon).trim().toUpperCase();
  const pct = parseSellPctArg(s.slice(colon + 1), { required: true });
  if (!symbol || !pct) return null;
  return { symbol, pct };
}

/**
 * Native Railway env: `OPERATOR_SELL=TOSHI:50` or `AERO:all,DRB:100,BNKR`.
 * First entry for the legacy single-symbol helper.
 */
export function parseOperatorSellEnv(raw) {
  const list = parseOperatorSellList(raw);
  return list[0] || null;
}

/** Comma/semicolon list of OPERATOR_SELL entries. Dedupes by symbol. */
export function parseOperatorSellList(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return [];
  const out = [];
  const seen = new Set();
  for (const part of s.split(/[,;]+/)) {
    const parsed = parseOperatorSellEntry(part);
    if (!parsed || seen.has(parsed.symbol)) continue;
    seen.add(parsed.symbol);
    out.push(parsed);
  }
  return out;
}

export function isOperatorSellEnvSymbol(symbol, env = process.env) {
  const sym = String(symbol || "").toUpperCase();
  if (!sym) return false;
  return parseOperatorSellList(env?.OPERATOR_SELL).some((p) => p.symbol === sym);
}

export function isListedForceExitSymbol(symbol, env = process.env) {
  const sym = String(symbol || "").toUpperCase();
  if (!sym || !forceExitLockedEnabled(env)) return false;
  return forceExitSymbols(env).includes(sym);
}

/** Game/desk FORCE_EXIT priority — bags >$0.30. Dust names are not this unwind. */
export const GAME_FORCE_EXIT_PRIORITY = Object.freeze(["AERO", "DRB", "BNKR"]);

export function isGameForceExitPriority(symbol) {
  return GAME_FORCE_EXIT_PRIORITY.includes(String(symbol || "").toUpperCase());
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

/** executeSell fraction: full manual sells keep the 0.98 lottery reserve unless unwind-all. */
export function resolveManualSellPct(cmd, { fullUnwind = false } = {}) {
  const pct = commandSellPct(cmd);
  if (isHalfSellPct(pct)) return 0.5;
  if (pct > 0 && pct < 1) return pct;
  return fullUnwind ? 1 : 0.98;
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
  if (state.done === true && !(state.doneBySymbol && typeof state.doneBySymbol === "object")) {
    return { queued: false, reason: "already-applied" };
  }
  const list = parseOperatorSellList(rawEnv);
  if (!list.length) {
    return { queued: false, reason: String(rawEnv ?? "").trim() ? "invalid" : "unset" };
  }
  if (!state.doneBySymbol || typeof state.doneBySymbol !== "object") state.doneBySymbol = {};
  const queuedItems = [];
  let unknown;
  let already;
  for (const parsed of list) {
    if (state.doneBySymbol[parsed.symbol]) continue;
    if (knownSymbols && !knownSymbols.has(parsed.symbol)) {
      unknown = parsed;
      continue;
    }
    if (commands.some((c) => isMatchingManualSell(c, parsed))) {
      already = parsed;
      continue;
    }
    commands.push(operatorSellCommand(parsed));
    queuedItems.push(parsed);
  }
  if (queuedItems.length) {
    return {
      queued: true,
      reason: "queued",
      symbol: queuedItems[0].symbol,
      pct: queuedItems[0].pct,
      items: queuedItems,
    };
  }
  if (list.every((p) => state.doneBySymbol[p.symbol])) {
    return { queued: false, reason: "already-applied", symbol: list[0].symbol, pct: list[0].pct };
  }
  if (unknown && !already) {
    return { queued: false, reason: "unknown-symbol", symbol: unknown.symbol, pct: unknown.pct };
  }
  if (already) {
    return { queued: false, reason: "already-queued", symbol: already.symbol, pct: already.pct };
  }
  if (unknown) {
    return { queued: false, reason: "unknown-symbol", symbol: unknown.symbol, pct: unknown.pct };
  }
  return { queued: false, reason: "invalid" };
}

/** Latch only after executeSell actually sends the swap. Per-symbol when `symbol` is set. */
export function markOperatorSellExecuted(state, symbol) {
  if (!state) return state;
  state.executed = true;
  const sym = String(symbol || "").toUpperCase();
  if (sym) {
    if (!state.doneBySymbol || typeof state.doneBySymbol !== "object") state.doneBySymbol = {};
    state.doneBySymbol[sym] = true;
    return state;
  }
  state.done = true;
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

  // Operator /buy is an explicit test — leftover+edge never block.
  // Hitch vs plain is decided by leftover cover (skipHitch).
  if (isManualOperatorBuy(reason) || canBypassBuyLossGate(reason, env)) {
    const covers = leftoverCoversInject(leftover);
    return {
      allow: true,
      leftover,
      skipHitch: !covers,
      log: `${tag}: allow buy ${symbol} MANUAL BUY (operator) ${covers ? "hitch covered" : "plain swap (hitch not covered)"}`,
      reason: covers ? "operator-hitch" : "operator-plain",
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
  hitchBytes = STORE_HITCH_BYTES,
  env = process.env,
} = {}) {
  const loseZero = isLoseZeroMode(env);
  const injectReq = isInjectCoverRequired(env);
  const fairExit = computeFairExit(price, { feePct, gasCostEth, tradeEth, impactPct });
  const spread = injectCostSpread(price, tradeEth, gwei, l1FeeEth, hitchBytes);
  const leftover = computeLeftover(existingSellTarget, fairExit, spread);
  const edge = hasClearEdge({ reason, armed, net });
  const l2Bytes = Math.max(STORE_HITCH_BYTES, Math.floor(Number(hitchBytes) || 0) || STORE_HITCH_BYTES);
  const l2FeeEth = estimateCalldataHitchEth(l2Bytes, gwei);
  const source = hasLiveL1Fee(l1FeeEth) ? "oracle" : "fallback";
  const feeFields = {
    l1FeeEth: hasLiveL1Fee(l1FeeEth) ? Number(l1FeeEth) : 0,
    l2FeeEth,
    hitchFeeSource: source,
    feeSplitLog: formatHitchFeeSplit({
      l1FeeEth: hasLiveL1Fee(l1FeeEth) ? Number(l1FeeEth) : 0,
      l2FeeEth,
      source,
    }),
  };

  // Operator /buy always computes leftover so hitch can ride when covered.
  if (isManualOperatorBuy(reason)) {
    return {
      ...evaluateBuyGate({ isCascade, leftover, hasEdge: edge, symbol, reason, env }),
      leftover,
      ...feeFields,
    };
  }

  if (!loseZero && !injectReq) {
    return {
      allow: true,
      log: null,
      leftover: 0,
      skipHitch: false,
      reason: "gate-off",
      ...feeFields,
    };
  }

  const decision = evaluateBuyGate({ isCascade, leftover, hasEdge: edge, symbol, reason, env });
  return {
    ...decision,
    skipHitch: decision.skipHitch ?? false,
    ...feeFields,
  };
}

export function isAllowLossyOperatorBuy(env = process.env) {
  return envFlagYes("ALLOW_LOSSY_OPERATOR_BUY", env);
}

export function canBypassBuyLossGate(reason = "", env = process.env) {
  // Operator Telegram /buy is the test path. Leftover+edge never block.
  // ALLOW_LOSSY_OPERATOR_BUY is kept as a redundant alias (always true for operator).
  void env;
  return isManualOperatorBuy(reason);
}

export function isAllowLossyOperatorSell(env = process.env) {
  return envFlagYes("ALLOW_LOSSY_OPERATOR_SELL", env);
}

export function isForceExitLockedReason(reason = "") {
  return /FORCE EXIT LOCKED/i.test(String(reason || ""));
}

export function canBypassSellLossGate(reason = "", env = process.env, symbol = "") {
  if (isForceExitLockedReason(reason)) return true;
  if (!isGameForceExitPriority(symbol)) return false;
  if (isListedForceExitSymbol(symbol, env)) return true;
  return isAllowLossyOperatorSell(env);
}

export function isStopLossReason(reason = "") {
  return String(reason || "").toUpperCase().startsWith("STOP LOSS");
}

/**
 * Arm a stop-loss exit only on trusted, unfrozen bags with a real floor.
 * Unknown-cost / frozen / piggy dust used display marks as "entry" and fired
 * STOP LOSS spam with no fill — historical ledger's biggest loss bucket.
 * Peak/plain sells remain the money path (ledger ~70% WR / +$324).
 */
export function shouldArmStopLoss({
  price,
  stopLossPrice,
  hasTrustedCostBasis = false,
  unknownEntry = false,
  frozen = false,
} = {}) {
  if (unknownEntry || frozen || !hasTrustedCostBasis) return false;
  const p = Number(price);
  const floor = Number(stopLossPrice);
  if (!Number.isFinite(p) || !Number.isFinite(floor) || floor <= 0) return false;
  return p < floor;
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
 * Full cost basis for a fill: swap notional + buy gas + hitch insert (when it rode).
 * Omitting gas/hitch made break-even sells still bleed the wallet.
 */
export function investedEthWithCosts({
  ethSpent = 0,
  gasCostEth = 0,
  hitchCostEth = 0,
  hitchOnChain = false,
} = {}) {
  const spent = Math.max(0, Number(ethSpent) || 0);
  const gas = Math.max(0, Number(gasCostEth) || 0);
  const hitch = hitchOnChain ? Math.max(0, Number(hitchCostEth) || 0) : 0;
  return spent + gas + hitch;
}

/**
 * Min leftover (ETH) when cost basis is unknown — at least N× sell gas so dust
 * recycle cannot churn every bag that merely clears pool fee %.
 */
export function unknownCostMinLeftoverEth(
  gasCostEth = 0,
  mult = UNKNOWN_COST_GAS_EDGE_MULT,
) {
  const gas = Math.max(0, Number(gasCostEth) || 0);
  const m = Number.isFinite(Number(mult)) && Number(mult) > 0
    ? Number(mult)
    : UNKNOWN_COST_GAS_EDGE_MULT;
  return gas * m;
}

/**
 * True PnL after ETH skim — cascade / win lights must use this, not pre-skim net.
 * Fill already nets pool fee + sell gas into `received`; skim is the last drag.
 */
export function netAfterSkimEth(receivedEth, skimEth = 0) {
  const rec = Number(receivedEth) || 0;
  const skim = Math.max(0, Number(skimEth) || 0);
  if (!(rec > 0)) return 0;
  return Math.max(0, rec - skim);
}

export function netUsdAfterSkim({
  receivedEth = 0,
  investedEth = 0,
  skimEth = 0,
  ethUsd = 0,
  trustedCostBasis = true,
} = {}) {
  const eth = Number(ethUsd) || 0;
  if (!(eth > 0)) return { netUsd: 0, earningsUsd: 0, trusted: false };
  // Unknown cost: never invent a win from entryEth=0 (would list full proceeds as profit).
  if (!trustedCostBasis) {
    return { netUsd: 0, earningsUsd: 0, trusted: false, unknownCost: true };
  }
  const redeployable = netAfterSkimEth(receivedEth, skimEth);
  const inv = Math.max(0, Number(investedEth) || 0);
  const netUsd = (redeployable - inv) * eth;
  return { netUsd, earningsUsd: netUsd, trusted: true, unknownCost: false, redeployableEth: redeployable };
}

/**
 * Worth-sending hitch packet for the hitch floor. Picture 10KB is a size
 * ceiling — do not raise hitch_floor to 2× 10KB (that freezes all messages).
 */
export function hitchFloorPacketBytes(wantedBytes = STORE_HITCH_BYTES) {
  const w = Math.max(0, Math.floor(Number(wantedBytes) || 0));
  const packet = w > 0 ? w : STORE_HITCH_BYTES;
  return Math.min(packet, EUREKA_LETTER_BYTES);
}

/** micro_floor = soldFrac×entry + sell fees + 1 wei. Hitch is not in this floor. */
export function microExtractFloorEth({
  entryEth = 0,
  sellPct = 1,
  projectedProceedsEth = 0,
  feePct = 0,
  gasCostEth = 0,
  impactPct = 0,
} = {}) {
  return entrySliceEth(entryEth, sellPct)
    + sellFeesEth({ projectedProceedsEth, feePct, gasCostEth, impactPct })
    + MIN_PLUS_ETH;
}

/** hitch_need = hitch_cost × HITCH_COST_MULT (default 2× Eureka cushion). */
export function hitchAttachNeedEth(hitchCostEth = 0, hitchCostMultArg = DEFAULT_HITCH_COST_MULT) {
  const hitch = Math.max(0, Number(hitchCostEth) || 0);
  const m = Number.isFinite(Number(hitchCostMultArg)) && Number(hitchCostMultArg) > 0
    ? Number(hitchCostMultArg)
    : DEFAULT_HITCH_COST_MULT;
  return hitch * m;
}

/**
 * Hitch-floor proceeds: micro_floor + hitch_need. Diagnostic / sims only —
 * evaluateSellGate does not HOLD a green leftover that misses this.
 */
export function hitchAttachFloorEth({
  entryEth = 0,
  sellPct = 1,
  projectedProceedsEth = 0,
  feePct = 0,
  gasCostEth = 0,
  impactPct = 0,
  hitchCostEth = 0,
  hitchCostMult: mult = DEFAULT_HITCH_COST_MULT,
} = {}) {
  return microExtractFloorEth({
    entryEth, sellPct, projectedProceedsEth, feePct, gasCostEth, impactPct,
  }) + hitchAttachNeedEth(hitchCostEth, mult);
}

/** Unused hitch room to bank — leftover after fees, capped at hitch cost. Not P&L. */
export function hitchBankCreditEth(leftoverAfterFees = 0, hitchWouldEth = 0) {
  const left = Math.max(0, Number(leftoverAfterFees) || 0);
  const hitch = Math.max(0, Number(hitchWouldEth) || 0);
  if (!(left > 0) || !(hitch > 0)) return 0;
  return Math.min(left, hitch);
}

/**
 * Minimum ETH proceeds required so the sell covers entry + fees + N× hitch.
 * hitch_floor only — micro extract uses leftover after fees and skips hitch.
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

/** WETH wei → ETH number. RISK-bag notionals fit in Number. */
export function wei18ToEth(wei) {
  if (typeof wei === "bigint") {
    if (wei <= 0n) return 0;
    return Number(wei) / 1e18;
  }
  const n = Number(wei);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Always-plus proceeds: never prefer a Dex mark over a live Uni quote.
 * When both exist, take the worse (min) so leftover cannot look green on
 * Aerodrome/Dex while Uni V3 fills thinner.
 */
export function conservativeSellProceedsEth({ markEth = 0, quotedEth = 0 } = {}) {
  const mark = Number(markEth);
  const quoted = Number(quotedEth);
  const m = Number.isFinite(mark) && mark > 0 ? mark : 0;
  const q = Number.isFinite(quoted) && quoted > 0 ? quoted : 0;
  if (q > 0 && m > 0) return Math.min(m, q);
  if (q > 0) return q;
  return m;
}

/** leftover after fees minus 1× hitch on THIS tx. Must be > 0 to send with hitch. */
export function plusAfterHitchEth(leftoverAfterFees = 0, hitchCostThisTxEth = 0) {
  return (Number(leftoverAfterFees) || 0) - Math.max(0, Number(hitchCostThisTxEth) || 0);
}

/**
 * Cash-flow leftover (ethIn − ethOut). After plus exits this UNDERSTATES
 * remaining FIFO — do not feed it to the plus gate as entryEth.
 */
export function cashFlowNetEth(ethIn = 0, ethOut = 0) {
  return Math.max(0, (Number(ethIn) || 0) - (Number(ethOut) || 0));
}

/**
 * Remaining average/FIFO cost for units still on chain.
 * remaining = ethIn × remainingTokens / tokensIn.
 * Never ethIn − ethOut: every plus sell shrinks cash-flow leftover below the
 * cost of the leftover pile, then always-plus paints a later red exit green.
 * Extra units beyond recorded buys, or missing lot sizes (`tokensIn` ≤ 0),
 * → unknown (do not sell red to discover). Persisted `totalInvestedEth` is
 * not trusted when lots cannot be allocated — that figure can still be
 * cash-flow leftover from a prior boot.
 */
export function fifoRemainingCostEth({
  ethIn = 0,
  tokensIn = 0,
  remainingTokens = 0,
  persistedInvestedEth = 0,
} = {}) {
  const remain = Number(remainingTokens);
  const spent = Number(ethIn);
  const bought = Number(tokensIn);
  const persisted = Number(persistedInvestedEth);

  if (!Number.isFinite(remain) || remain <= 0) {
    return { unknown: false, investedEth: 0, reason: "empty", proportional: 0 };
  }
  if (!Number.isFinite(spent) || spent <= 0) {
    return { unknown: true, investedEth: 0, reason: "unknown-cost", proportional: 0 };
  }
  if (!Number.isFinite(bought) || bought <= 0) {
    return { unknown: true, investedEth: 0, reason: "unknown-cost", proportional: 0 };
  }
  if (remain > bought * 1.02 + 1e-9) {
    return { unknown: true, investedEth: 0, reason: "unknown-lots", proportional: 0 };
  }
  const proportional = spent * Math.min(1, remain / bought);
  const investedEth = Math.max(
    proportional,
    Number.isFinite(persisted) && persisted > 0 ? persisted : 0,
  );
  if (!(investedEth > 0)) {
    return { unknown: true, investedEth: 0, reason: "unknown-cost", proportional };
  }
  return { unknown: false, investedEth, reason: "fifo-remaining", proportional };
}

/** WETH wei floor: fill must return recorded buy cost + 1 wei. */
export function plusFloorOutWei(entrySoldEth) {
  const n = Number(entrySoldEth);
  if (!Number.isFinite(n) || n <= 0) return 0n;
  const wei = BigInt(Math.round(n * 1e18));
  return wei > 0n ? wei + 1n : 0n;
}

/**
 * After slippage sanitize, never keep a minOut below the FIFO plus floor.
 * Quote below floor or unknown cost → HOLD (do not send).
 */
export function applySellPlusFloorMinOut({
  minOutWei = 0n,
  quotedWei = 0n,
  entrySoldEth = 0,
} = {}) {
  const floor = plusFloorOutWei(entrySoldEth);
  if (floor <= 0n) {
    return {
      allow: false,
      minOutWei: 0n,
      reason: "unknown-cost",
      log: "PLUS FLOOR: HOLD — no recorded buy cost (unknown; do not sell red to discover)",
    };
  }
  const quoted = typeof quotedWei === "bigint" ? quotedWei : 0n;
  if (quoted < floor) {
    return {
      allow: false,
      minOutWei: 0n,
      reason: "quote-below-cost",
      log:
        `PLUS FLOOR: HOLD — quote ${quoted.toString()} wei < FIFO cost+1wei ` +
        `${floor.toString()} (never send a fill that can print red)`,
    };
  }
  const min = typeof minOutWei === "bigint" ? minOutWei : 0n;
  const raised = min > floor ? min : floor;
  return {
    allow: true,
    minOutWei: raised,
    reason: raised > min ? "raised" : "ok",
    log: raised > min
      ? `PLUS FLOOR: minOut raised to FIFO cost+1wei ${floor.toString()}`
      : null,
  };
}

export function formatAlwaysPlusLog({
  verdict = "HOLD",
  symbol = "?",
  leftover = 0,
  entrySold = 0,
  feesEth = 0,
  hitchCostEth = 0,
  hitchWouldEth,
  hitchBankedEth,
  netEth = 0,
  hitchBytes = 0,
} = {}) {
  const n = (v) => {
    const x = Number(v);
    return Number.isFinite(x) ? x.toExponential(2) : "?";
  };
  const v = String(verdict || "HOLD").toUpperCase();
  if (v === "SKIP_HITCH") {
    const banked = Number(hitchBankedEth);
    const bankBit = Number.isFinite(banked) && banked > 0
      ? ` banked=${n(banked)}`
      : "";
    return (
      `SKIP_HITCH sell ${symbol} leftover=${n(leftover)} hitchWould=${n(hitchWouldEth ?? hitchCostEth)}` +
      `${bankBit} — plain sale net=${n(leftover)} (micro extract)`
    );
  }
  if (v === "FORCE_EXIT") {
    return (
      `FORCE_EXIT sell ${symbol} leftover=${n(leftover)} entrySold=${n(entrySold)}` +
      ` fees=${n(feesEth)} — recovery (no hitch)`
    );
  }
  if (v === "HOLD") {
    return (
      `HOLD sell ${symbol} leftover=${n(leftover)} entrySold=${n(entrySold)}` +
      ` fees=${n(feesEth)} hitch=${n(hitchCostEth)} net=${n(netEth)}`
    );
  }
  const bytes = Number(hitchBytes) > 0 ? ` (${Number(hitchBytes)}B)` : "";
  return (
    `PLUS sell ${symbol} leftover=${n(leftover)} entrySold=${n(entrySold)}` +
    ` fees=${n(feesEth)} hitch=${n(hitchCostEth)} net=${n(netEth)}${bytes}`
  );
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
 * Size hitch so 1× inject_cost stays strictly inside leftover (minimal plus).
 * Default budget = leftover / HITCH_COST_MULT (2× size cushion) after a 1-wei
 * plus reserve so hitch cannot consume the entire leftover.
 */
export function sizeHitchForSell({
  leftoverEth = 0,
  wantedBytes = STORE_HITCH_BYTES,
  gwei = 0,
  providerFeeEth = 0,
  wantBtpInscribe = false,
  btpGasUnits = BTP_INSCRIBE_GAS_UNITS,
  hitchCostMult: mult = DEFAULT_HITCH_COST_MULT,
  plusReserveEth = MIN_PLUS_ETH,
  l1FeeEth,
  l1FeePerByteEth,
  btpL1FeeEth,
} = {}) {
  const leftover = Number(leftoverEth);
  const m = Number.isFinite(Number(mult)) && Number(mult) > 0 ? Number(mult) : DEFAULT_HITCH_COST_MULT;
  const plusReserve = plusReserveEth === undefined
    ? MIN_PLUS_ETH
    : Math.max(0, Number(plusReserveEth) || 0);
  const usable = leftover - plusReserve;
  if (!Number.isFinite(leftover) || leftover <= 0 || !(usable > 0)) {
    return { hitchBytes: 0, btpInscribe: false, injectCostEth: 0, skipHitch: true, hitchCostMult: m };
  }

  // Spend leftover/mult (or leftover−plusReserve when mult=1) so plus remains.
  const budget = usable / m;
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
 * Micro extract: leftover after entry_sold + fees must be > 0. Hitch rides
 * under original message-first when leftover covers 1× hitch and still plus
 * (default). The 2× HITCH_COST_MULT cushion is preferred when met; below that
 * but above 1×, still hitch (Storage Token can charge delta). Set
 * VITA_MESSAGE_FIRST=no to SKIP_HITCH + bank instead. Never HOLD a green
 * leftover waiting for hitch. STOP LOSS is NOT a loss bypass. Unknown-cost
 * is HOLD. Auto cannot sell red. Game unwind (hitch SKIP): FORCE EXIT LOCKED,
 * FORCE_EXIT_SYMBOLS, or ALLOW_LOSSY_OPERATOR_SELL=yes on operator /
 * OPERATOR_SELL names. Flags off → always-plus HOLD stays.
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
  /** ETH that must remain after fees before hitch may ride (piggy earnings buffer). */
  piggyEarningsBufferEth = 0,
  /** When true (or entryEth≈0), HOLD — leftover without basis is not plus vs entry. */
  unknownEntry = false,
  unknownGasEdgeMult = UNKNOWN_COST_GAS_EDGE_MULT,
  leftoverWouldCoverHitch = false,
  /** Frozen / exits-only leftover bags still obey always-plus. Cannot bypass. */
  exitsOnly = false,
  /** Operator / fresh-lot fill cost — raise entry so a pre-latch leftover cannot paint PLUS. */
  lotCostEth = 0,
  /** Dex/USD mark proceeds (ETH). Below entrySold → HOLD even if a quote looks plus. */
  usdMarkProceedsEth = 0,
  operatorLot = false,
  freshLot = false,
} = {}) {
  void leftoverWouldCoverHitch;
  void exitsOnly;
  const lotFloor = Number(lotCostEth);
  if (Number.isFinite(lotFloor) && lotFloor > Number(entryEth || 0)) {
    entryEth = lotFloor;
  }
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
    hitchCostMult: 1, // micro extract is leftover after fees; hitch is optional
    l1FeeEth,
    btpL1FeeEth,
  };
  const leftover = leftoverAfterFeesEth(base);
  const feesEth = sellFeesEth(base);
  const entrySold = entrySliceEth(entryEth, sellPct);
  const microFloor = microExtractFloorEth(base);
  const earningsBuf = Math.max(0, Number(piggyEarningsBufferEth) || 0);
  const hitchBudget = leftover - earningsBuf;
  const forceExit = isForceExitLockedReason(reason);
  const overrideSell = canBypassSellLossGate(reason, env, symbol);
  const treatUnknown = !!unknownEntry || !(Number(entryEth) > 0);

  const wanted = Math.max(0, Number(wantedHitchBytes) || 0);
  const reservedL1 = hasLiveL1Fee(reservedL1FeeEth)
    ? Number(reservedL1FeeEth)
    : (hasLiveL1Fee(l1FeeEth) && wanted > 0
      ? Number(l1FeeEth) * STORE_HITCH_BYTES / wanted
      : undefined);
  const liveL1Known = hasLiveL1Fee(l1FeeEth) || hasLiveL1Fee(reservedL1);
  const source = hitchFeeSource
    || (liveL1Known ? "oracle" : "l2-only");
  const l1OracleFailed = hitchFeeSource === "fallback";

  const sizeArgs = {
    leftoverEth: Math.max(0, hitchBudget),
    wantedBytes: wantedHitchBytes,
    gwei,
    providerFeeEth,
    wantBtpInscribe,
    btpGasUnits,
    plusReserveEth: MIN_PLUS_ETH,
    l1FeeEth,
    l1FeePerByteEth,
    btpL1FeeEth,
  };
  // Hitch floor uses a worth-sending packet (capped at Eureka letter).
  // 2× is the attach bar — do not hitch at 1× leftover (that burns micro profit).
  const floorBytes = hitchFloorPacketBytes(wantedHitchBytes);
  const floorL1 = hasLiveL1Fee(l1FeeEth) && wanted > 0
    ? Number(l1FeeEth) * floorBytes / wanted
    : (hasLiveL1Fee(reservedL1) ? Number(reservedL1) : undefined);
  const hitchWould = estimateInjectHitchCostEth({
    hitchBytes: floorBytes,
    gwei,
    providerFeeEth,
    btpInscribe: wantBtpInscribe,
    btpGasUnits,
    l1FeeEth: floorL1,
    btpL1FeeEth,
  });
  const hitchNeed = hitchAttachNeedEth(hitchWould, mult);
  const hitchFloor = microFloor + hitchNeed;
  const coversHitchFloor = hitchBudget > hitchNeed
    && plusAfterHitchEth(leftover, hitchWould) > 0;
  let sized = sizeHitchForSell({
    ...sizeArgs,
    hitchCostMult: coversHitchFloor ? Math.max(1, mult) : 1,
  });
  const hitchThis = sized.skipHitch ? 0 : (Number(sized.injectCostEth) || 0);
  const plusNet = plusAfterHitchEth(leftover, hitchThis);

  const reservedHitch = estimateInjectHitchCostEth({
    hitchBytes: STORE_HITCH_BYTES,
    gwei,
    providerFeeEth,
    btpInscribe: false,
    btpGasUnits,
    l1FeeEth: reservedL1,
  });
  const hitchBanked = hitchBankCreditEth(leftover, hitchWould || reservedHitch);
  const reservedCover = coversHitchAndEntry({
    ...base,
    hitchBytes: STORE_HITCH_BYTES,
    btpInscribe: false,
    l1FeeEth: reservedL1,
    btpL1FeeEth: undefined,
    hitchCostMult: 1,
  });
  const check = coversHitchAndEntry({
    ...base,
    hitchBytes: sized.hitchBytes,
    btpInscribe: sized.btpInscribe,
    hitchCostMult: 1,
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
    const verdict = extra.verdict
      || (allow ? (extra.skipHitch ? "SKIP_HITCH" : "PLUS") : "HOLD");
    const hitchCost = extra.injectCostEth ?? (extra.skipHitch ? 0 : sized.injectCostEth);
    const net = extra.netEth ?? plusAfterHitchEth(leftover, extra.skipHitch ? 0 : hitchCost);
    const banked = allow && extra.skipHitch
      && verdict !== "FORCE_EXIT" && verdict !== "LOSSY_OPERATOR" && verdict !== "HOLD"
      ? (extra.hitchBankedEth ?? hitchBanked)
      : 0;
    return {
      allow,
      leftover,
      entrySoldEth: entrySold,
      feesEth,
      plusNetEth: net,
      verdict,
      microFloorEth: extra.microFloorEth ?? microFloor,
      hitchFloorEth: extra.hitchFloorEth ?? hitchFloor,
      hitchBankedEth: extra.skipHitch ? banked : 0,
      hitchBytes: extra.skipHitch ? 0 : bytes,
      btpInscribe: extra.skipHitch ? false : (extra.btpInscribe ?? sized.btpInscribe),
      skipHitch: extra.skipHitch ?? sized.skipHitch,
      injectCostEth: extra.skipHitch ? 0 : hitchCost,
      hitchCostMult: extra.skipHitch ? 1 : sized.hitchCostMult ?? mult,
      hitchCoverEth: extra.hitchCoverEth ?? hitchCost,
      reservedHitchEth: reservedHitch,
      edge: extra.edge ?? net,
      minSellProceedsEth: extra.minSellProceedsEth ?? (entrySold + feesEth + (extra.skipHitch ? 0 : hitchThis)),
      sellNow: extra.sellNow ?? allow,
      l1FeeEth: liveL1,
      l2FeeEth,
      btpL1FeeEth: liveBtpL1,
      hitchFeeSource: extra.hitchFeeSource ?? source,
      alwaysPlusLog: extra.alwaysPlusLog ?? formatAlwaysPlusLog({
        verdict,
        symbol,
        leftover,
        entrySold,
        feesEth,
        hitchCostEth: extra.skipHitch ? 0 : hitchCost,
        hitchWouldEth: extra.hitchWouldEth ?? hitchWould,
        hitchBankedEth: extra.skipHitch ? banked : 0,
        netEth: net,
        hitchBytes: extra.skipHitch ? 0 : bytes,
      }),
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

  // FORCE EXIT / lossy operator / listed unwind. Never HOLD red when Game
  // armed ALLOW_LOSSY_OPERATOR_SELL or FORCE_EXIT_SYMBOLS. Red → hitch SKIP
  // (recovery). Green + message-first KEY+LOC cover → hitch so code goes
  // down-range; otherwise plain PLUS (skip hitch).
  if (overrideSell) {
    const red = leftover <= 0;
    const viaForce = forceExit || isListedForceExitSymbol(symbol, env);
    if (red) {
      const why = viaForce ? "FORCE EXIT LOCKED" : "lossy operator unwind";
      return pack(true, why, {
        hitchBytes: 0,
        btpInscribe: false,
        skipHitch: true,
        hitchBankedEth: 0,
        injectCostEth: 0,
        hitchCoverEth: reservedCover.hitchCoverEth,
        edge: leftover,
        minSellProceedsEth: reservedCover.minSellProceedsEth,
        verdict: viaForce ? "FORCE_EXIT" : "LOSSY_OPERATOR",
        netEth: leftover,
        log: viaForce
          ? `LOSE_ZERO: FORCE_EXIT sell ${symbol} leftover after fees ≤ 0 — recovery (no hitch)`
          : `LOSE_ZERO: allow sell ${symbol} ALLOW_LOSSY_OPERATOR_SELL — FIFO red operator unwind (hitch SKIP)`,
      });
    }

    const messageFirstOverride = isOriginalFormulaMessageFirst(env);
    const canHitchOverride = messageFirstOverride
      && !l1OracleFailed
      && !sized.skipHitch
      && hitchThis > 0
      && plusNet > 0
      && hitchBudget > 0;
    if (canHitchOverride) {
      const why = viaForce ? "FORCE EXIT LOCKED plus hitch" : "lossy operator plus hitch";
      return pack(true, why, {
        sellNow: true,
        verdict: "PLUS",
        netEth: plusNet,
        hitchBankedEth: 0,
        hitchCostMult: 1,
        hitchCoverEth: reservedCover.hitchCoverEth,
        edge: leftover,
        minSellProceedsEth: reservedCover.minSellProceedsEth,
        log: viaForce
          ? `LOSE_ZERO: PLUS sell ${symbol} FORCE EXIT LOCKED leftover=${leftover.toExponential(2)} — message-first hitch ${sized.hitchBytes || 0}B`
          : `LOSE_ZERO: allow sell ${symbol} ALLOW_LOSSY_OPERATOR_SELL leftover=${leftover.toExponential(2)} — message-first hitch ${sized.hitchBytes || 0}B`,
      });
    }

    const why = viaForce ? "FORCE EXIT LOCKED plus" : "lossy operator plus";
    return pack(true, why, {
      hitchBytes: 0,
      btpInscribe: false,
      skipHitch: true,
      hitchBankedEth: hitchBanked,
      injectCostEth: 0,
      hitchCoverEth: reservedCover.hitchCoverEth,
      edge: leftover,
      minSellProceedsEth: reservedCover.minSellProceedsEth,
      verdict: "PLUS",
      netEth: leftover,
      hitchWouldEth: hitchWould || hitchThis || sized.injectCostEth || reservedHitch,
      log: viaForce
        ? `LOSE_ZERO: PLUS sell ${symbol} FORCE EXIT LOCKED leftover=${leftover.toExponential(2)} — plain (hitch not covered / L1 unknown)`
        : `LOSE_ZERO: allow sell ${symbol} ALLOW_LOSSY_OPERATOR_SELL leftover=${leftover.toExponential(2)} — plain (hitch not covered / L1 unknown)`,
    });
  }

  // Unknown cost: leftover = proceeds − 0 − fees looks green. Cannot prove plus vs entry.
  if (treatUnknown) {
    void unknownGasEdgeMult;
    return pack(false, "unknown cost — cannot prove plus vs entry", {
      hitchBytes: 0,
      btpInscribe: false,
      skipHitch: true,
      injectCostEth: 0,
      hitchCoverEth: reservedCover.hitchCoverEth,
      edge: leftover,
      minSellProceedsEth: reservedCover.minSellProceedsEth,
      sellNow: false,
      verdict: "HOLD",
      netEth: leftover,
      log: `LOSE_ZERO: hold sell ${symbol} unknown cost — leftover ${leftover.toExponential(2)} is not plus vs entry (no fake win)`,
    });
  }

  const proceeds = Number(projectedProceedsEth);
  const proceedsBelowCost = Number.isFinite(proceeds) && proceeds + MIN_PLUS_ETH < entrySold;
  const markBelow = usdMarkBelowBreakeven({
    markProceedsEth: usdMarkProceedsEth,
    entrySoldEth: entrySold,
  });
  const fifoEthRed = leftover <= 0 || proceedsBelowCost;
  const lotHold = !!(operatorLot || freshLot);

  // Trade itself loses after fees (piggy dust already reserved in executeSell).
  // STOP LOSS included — emergency floor is not permission to sell underwater.
  // Proceeds < recorded buy cost is the same HOLD (FIFO red) — exits-only included.
  // Operator / fresh lots: FIFO eth red OR USD-mark below breakeven HOLDs even
  // when Friday sellMod +0.08 / weekend de-risk fired the exit (AERO 0x326f41af /
  // DRB 0x808acc7d). DOW bias cannot sell red.
  if (fifoEthRed || markBelow) {
    const stopNote = isStopLossReason(reason) ? " (STOP LOSS floor held)" : "";
    const fifoNote = proceedsBelowCost
      ? ` — FIFO red proceeds ${Number.isFinite(proceeds) ? proceeds.toExponential(2) : "?"} < entrySold ${entrySold.toExponential(2)}`
      : "";
    const markNote = markBelow
      ? ` — USD-mark ${Number(usdMarkProceedsEth).toExponential(2)} < entrySold ${entrySold.toExponential(2)}`
      : "";
    const lotNote = lotHold ? " (operator/fresh lot; Friday/weekend de-risk cannot sell red)" : "";
    const why = markBelow && !fifoEthRed
      ? "USD-mark below breakeven"
      : proceedsBelowCost ? "proceeds below recorded buy cost" : "trade would lose after fees";
    return pack(false, why, {
      hitchBytes: 0,
      btpInscribe: false,
      skipHitch: true,
      injectCostEth: 0,
      hitchCoverEth: reservedCover.hitchCoverEth,
      edge: reservedCover.edge,
      minSellProceedsEth: reservedCover.minSellProceedsEth,
      sellNow: false,
      verdict: "HOLD",
      netEth: leftover,
      log: `LOSE_ZERO: hold sell ${symbol} leftover after fees ≤ 0 — would lose money${stopNote}${fifoNote}${markNote}${lotNote}`,
    });
  }

  // No live L1 quote → never hitch (plain PLUS). leftoverWouldCoverHitch used to
  // re-attach VITA without L1 and undercover the insert.
  if (l1OracleFailed) {
    return pack(true, "plain sale L1 unknown", {
      hitchBytes: 0,
      btpInscribe: false,
      skipHitch: true,
      injectCostEth: 0,
      hitchCoverEth: reservedCover.hitchCoverEth,
      edge: leftover,
      minSellProceedsEth: reservedCover.minSellProceedsEth,
      sellNow: true,
      hitchFeeSource: source,
      verdict: "SKIP_HITCH",
      netEth: leftover,
      hitchWouldEth: hitchWould || hitchThis || reservedHitch,
      hitchBankedEth: hitchBanked,
      log: `LOSE_ZERO: allow sell ${symbol} plain — L1 fee unknown (oracle fallback); hitch skipped + banked so insert cannot undercover`,
    });
  }

  // Message-first (original formula): 1× KEY+LOC cover + still-plus → hitch.
  // Do not mute for micro skim when the packet fits; Storage Token can charge
  // the delta vs waiting for a 2× cushion. Opt out: VITA_MESSAGE_FIRST=no.
  const messageFirst = isOriginalFormulaMessageFirst(env);
  const keyLocCoveredAt1x = !sized.skipHitch
    && hitchThis > 0
    && plusNet > 0
    && hitchBudget > 0;

  // Hitch floor miss (or piggy buffer / size skip) — micro extract, bank hitch
  // unless original message-first already covers 1×.
  if (
    (!coversHitchFloor && !(messageFirst && keyLocCoveredAt1x))
    || sized.skipHitch
    || hitchThis <= 0
    || hitchBudget <= 0
    || plusNet <= 0
  ) {
    const whyBuf = hitchBudget <= 0
      ? "piggy earnings buffer + hitch floor"
      : !coversHitchFloor
        ? "hitch floor (2× cushion)"
        : "hitch";
    return pack(true, "plain sale hitch skipped", {
      hitchBytes: 0,
      btpInscribe: false,
      skipHitch: true,
      injectCostEth: 0,
      hitchCoverEth: reservedCover.hitchCoverEth,
      edge: leftover,
      minSellProceedsEth: reservedCover.minSellProceedsEth,
      sellNow: true,
      verdict: "SKIP_HITCH",
      netEth: leftover,
      hitchWouldEth: hitchWould || hitchThis || sized.injectCostEth || reservedHitch,
      hitchBankedEth: hitchBanked,
      log: `LOSE_ZERO: allow sell ${symbol} plain — leftover covers fees (micro extract) but not ${whyBuf}; hitch skipped + banked toward next message`,
    });
  }

  // 1× covered under original formula (2× cushion not met) — still send.
  if (!coversHitchFloor && messageFirst && keyLocCoveredAt1x) {
    void check;
    return pack(true, "original message-first hitch", {
      sellNow: true,
      verdict: "PLUS",
      netEth: plusNet,
      hitchBankedEth: 0,
      hitchCostMult: 1,
      log: `LOSE_ZERO: allow sell ${symbol} leftover covers KEY+LOC 1× — original message-first hitch (Storage Token can charge delta; 2× cushion waived)`,
    });
  }

  // Hitch floor clears — leftover covers hitch × mult and still plus.
  void check;
  return pack(true, "leftover covers hitch + edge", {
    sellNow: true,
    verdict: "PLUS",
    netEth: plusNet,
    hitchBankedEth: 0,
    log: `LOSE_ZERO: allow sell ${symbol} leftover covers hitch floor — sell now (hitch ${mult}× cushion, micro already banked)`,
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
  piggyEarningsBufferEth = 0,
  unknownEntry = false,
  leftoverWouldCoverHitch = false,
  exitsOnly = false,
  lotCostEth = 0,
  usdMarkProceedsEth = 0,
  operatorLot = false,
  freshLot = false,
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
    unknownEntry,
    providerFeeEth,
    wantBtpInscribe,
    hitchCostMult: multArg,
    l1FeeEth,
    reservedL1FeeEth,
    l1FeePerByteEth,
    btpL1FeeEth,
    hitchFeeSource,
    piggyEarningsBufferEth,
    leftoverWouldCoverHitch,
    exitsOnly,
    lotCostEth,
    usdMarkProceedsEth,
    operatorLot,
    freshLot,
    reason,
    symbol,
    env,
  });
}
