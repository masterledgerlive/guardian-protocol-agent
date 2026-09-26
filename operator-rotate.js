/**
 * One-shot Game empty → verified defi.app $HOME on Base RISK.
 *
 * OPERATOR_ROTATE_TO=HOME batches every non-HOME ERC20 sell + excess WETH
 * → HOME buy under one flag so #140 one-shot ALLOW_LOSSY cannot consume
 * mid-bag. Vault never. HOME stays in wallet.
 *
 * Liquid book: Aerodrome Slipstream HOME/WETH 0.3% (tickSpacing 200).
 * Uni V3 HOME/WETH 1% is a ghost (~$18). Rotate HOME buy uses Slipstream
 * quoter + router — not Uni QuoterV2 fee probe 3000/10000/500/100.
 * Official address from docs.defi.app + Coinbase (same on BNB).
 */

export const VERIFIED_HOME_ADDRESS = "0x4BfAa776991E85e5f8b1255461cbbd216cFc714f";
export const VERIFIED_HOME_SYMBOL = "HOME";
/** Aerodrome Slipstream HOME/WETH 0.3% — deepest liquid V3-class book on Base. */
export const HOME_FEE_TIER = 3000;
export const HOME_POOL_FEE_PCT = 0.006;
export const HOME_AERO_SLIPSTREAM_POOL = "0x098A4dE96305baFAEA0c0ce07CF6456e2c64982a";
/** Uni V3 HOME/WETH 1% — ghost book; do not bind SwapRouter02 here. */
export const HOME_UNI_V3_WETH_POOL = "0xd4d6870f76A28463d6d99caCe2Ff3C1cf997DA5A";
export const VAULT_NEVER_ADDRESS = "0xcea0e27b42d025B8097f5b467F14549e71D4c5Fc";
export const RISK_WALLET = "0x50e1C4608c48b0c52E1EA5FBabc1c9126eA17915";
export const ROTATE_GAS_FLOOR_ETH = 0.0005;
/** Rem bag floor — lottery wei stays, anything above must unlock+sell. */
export const ROTATE_MIN_BALANCE = 1e-9;
/** After this many QuoterV2 misses, drop a rotate bag even if it is not rem. */
export const ROTATE_QUOTER_MISS_SKIP = 3;
export const OPERATOR_ROTATE_SOURCE = "OPERATOR_ROTATE";
export const OPERATOR_ROTATE_SELL_REASON = "MANUAL SELL (operator) ROTATE";
export const OPERATOR_ROTATE_BUY_REASON = "MANUAL BUY (operator) ROTATE HOME";

const SKIP_HOLD = Object.freeze(["USDG"]);

function normAddr(addr) {
  return String(addr || "").trim().toLowerCase();
}

function normSym(symbol) {
  return String(symbol || "").trim().toUpperCase();
}

function envYes(name, env = {}) {
  return String(env?.[name] ?? "").trim().toLowerCase() === "yes";
}

/** Catalog row for DEFAULT_TOKENS / tests — verified HOME only. */
export function verifiedHomeCatalogRow(extra = {}) {
  return {
    symbol: VERIFIED_HOME_SYMBOL,
    address: VERIFIED_HOME_ADDRESS,
    feeTier: HOME_FEE_TIER,
    poolFeePct: HOME_POOL_FEE_PCT,
    ...extra,
  };
}

export function parseOperatorRotateTo(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const symbol = s.split(/[:\s,;]+/)[0].trim().toUpperCase();
  if (symbol !== VERIFIED_HOME_SYMBOL) return null;
  return { symbol: VERIFIED_HOME_SYMBOL, address: VERIFIED_HOME_ADDRESS };
}

export function isOperatorRotateArmed(env = process.env) {
  return parseOperatorRotateTo(env?.OPERATOR_ROTATE_TO) != null;
}

export function rotateTargetSymbol(env = process.env) {
  return parseOperatorRotateTo(env?.OPERATOR_ROTATE_TO)?.symbol || "";
}

export function isRotateTarget(symbol, env = process.env) {
  const want = rotateTargetSymbol(env) || VERIFIED_HOME_SYMBOL;
  return normSym(symbol) === want;
}

export function isVaultNeverAddress(addr) {
  return normAddr(addr) === normAddr(VAULT_NEVER_ADDRESS);
}

export function rotateWalletAllowed(wallet) {
  if (!wallet) return true;
  return !isVaultNeverAddress(wallet);
}

export function isSkipHoldRotateSymbol(symbol) {
  return SKIP_HOLD.includes(normSym(symbol));
}

/**
 * Skip HOME (leave in wallet), vault, USDG (no V3 route), native/WETH
 * (WETH is swept via HOME buy, not sold as an ERC20 bag).
 */
export function shouldSkipRotateSell({
  symbol,
  address,
  wallet,
  env = process.env,
} = {}) {
  if (!rotateWalletAllowed(wallet)) return true;
  if (isVaultNeverAddress(address)) return true;
  const sym = normSym(symbol);
  if (!sym) return true;
  if (sym === "WETH" || sym === "ETH") return true;
  if (isSkipHoldRotateSymbol(sym)) return true;
  if (isRotateTarget(sym, env) || sym === VERIFIED_HOME_SYMBOL) return true;
  return false;
}

/**
 * WETH that may go into HOME. Native ETH stays ≥ gas floor.
 * If native is already ≥ floor, all WETH is spendable.
 */
export function excessWethToSell({
  nativeEth = 0,
  wethEth = 0,
  gasFloorEth = ROTATE_GAS_FLOOR_ETH,
} = {}) {
  const native = Math.max(0, Number(nativeEth) || 0);
  const weth = Math.max(0, Number(wethEth) || 0);
  const floor = Number(gasFloorEth);
  const gasFloor = Number.isFinite(floor) && floor >= 0 ? floor : ROTATE_GAS_FLOOR_ETH;
  const nativeGap = Math.max(0, gasFloor - native);
  return Math.max(0, weth - nativeGap);
}

export function applyRotateHalt(env = process.env) {
  if (!env || typeof env !== "object") return env;
  env.HALT_NEW_ENTRIES = "yes";
  return env;
}

/** Rotate is Game explicit empty — arm FIFO-red for the whole batch. */
export function armRotateAllowLossy(env = process.env) {
  if (!env || typeof env !== "object") return env;
  env.ALLOW_LOSSY_OPERATOR_SELL = "yes";
  return env;
}

export function isOperatorRotateReason(reason = "") {
  return /ROTATE/i.test(String(reason || ""))
    && String(reason || "").startsWith("MANUAL SELL (operator)");
}

export function isOperatorRotateBuyReason(reason = "") {
  return String(reason || "").startsWith(OPERATOR_ROTATE_BUY_REASON)
    || (/ROTATE/i.test(String(reason || "")) && String(reason || "").startsWith("MANUAL BUY (operator)"));
}

/**
 * Uni V3 DexScreener depth codes that freeze HOME on the ghost 1% book
 * (0xd4d6870f… ~$18). Liquid book is Aero Slipstream 0.3% / catalog fee 3000.
 */
export const ROTATE_HOME_THIN_V3_CODES = Object.freeze([
  "THIN_V3_WETH",
  "NO_V3_WETH",
  "PRIMARY_NOT_V3_WETH",
]);

/**
 * OPERATOR_ROTATE HOME buy only — bypass isBuyFrozen / THIN_V3_WETH.
 * Does not unfreeze GAME or any other token.
 */
export function rotateHomeBuyBypassesV3Freeze(reason, symbol) {
  return isOperatorRotateBuyReason(reason) && normSym(symbol) === VERIFIED_HOME_SYMBOL;
}

/**
 * True for MANUAL BUY (operator) — includes OPERATOR_BUY env and Telegram /buy.
 * Rotate HOME buy also uses this prefix.
 */
function isManualOperatorBuyReason(reason = "") {
  return String(reason || "").startsWith("MANUAL BUY (operator)");
}

/**
 * HOME fills Aero Slipstream (not Uni QuoterV2 ghost 1%).
 * OPERATOR_ROTATE HOME buy + OPERATOR_BUY / Telegram /buy HOME.
 */
export function rotateHomeBuyUsesSlipstream(reason, symbol) {
  if (normSym(symbol) !== VERIFIED_HOME_SYMBOL) return false;
  return isOperatorRotateBuyReason(reason) || isManualOperatorBuyReason(reason);
}

export function rotateHomeBuyAllowsRouteCode(code) {
  return ROTATE_HOME_THIN_V3_CODES.includes(String(code || ""));
}

/** Existing QuoterV2 miss cooldown must not block this rotate HOME buy. */
export function rotateHomeBuyBypassesQuoterCooldown(reason, symbol) {
  return rotateHomeBuyUsesSlipstream(reason, symbol);
}

/**
 * Clear HOME quote/swap fail cooldown for rotate HOME send.
 * Keeps buyFrozen so normal /buy still honors the Uni ghost freeze.
 */
export function clearRotateHomeQuoterCooldown(symbol, clearFn) {
  if (normSym(symbol) !== VERIFIED_HOME_SYMBOL) return false;
  if (typeof clearFn === "function") clearFn(VERIFIED_HOME_SYMBOL);
  return true;
}

/** Uni QuoterV2 miss on rotate HOME must not increment the N=3 cooldown. */
export function rotateHomeBuyIgnoresUniQuoterMiss(reason, symbol) {
  return rotateHomeBuyUsesSlipstream(reason, symbol);
}

export function isOperatorRotateCommand(cmd) {
  return String(cmd?.source || "") === OPERATOR_ROTATE_SOURCE;
}

export function isRotateRemBag(balance) {
  return Number(balance) > ROTATE_MIN_BALANCE;
}

/** Game empty→HOME: ignore piggy floor + SELLABLE_MIN_USD (~$0.15). */
export function rotateBypassesPiggyDustHold(reason = "", env = process.env) {
  return isOperatorRotateArmed(env) || isOperatorRotateReason(reason);
}

export function rotateSellCommand(symbol) {
  return {
    symbol: normSym(symbol),
    action: "sell",
    source: OPERATOR_ROTATE_SOURCE,
    unlockPiggy: true,
    pct: 1,
  };
}

export function rotateHomeBuyCommand() {
  return {
    symbol: VERIFIED_HOME_SYMBOL,
    action: "buy",
    source: OPERATOR_ROTATE_SOURCE,
    sweepWeth: true,
  };
}

function pendingRotateSells(commands = []) {
  return (Array.isArray(commands) ? commands : []).filter(
    (c) => isOperatorRotateCommand(c) && (c.action === "sell" || c.action === "sellhalf"),
  );
}

export function isRotateSellSkipped(state, symbol) {
  const skipped = state?.skippedBySymbol;
  if (!skipped || typeof skipped !== "object") return false;
  return !!skipped[normSym(symbol)];
}

export function rotateSellsOutstanding(commands = [], state = {}) {
  const done = state.doneBySymbol && typeof state.doneBySymbol === "object" ? state.doneBySymbol : {};
  const skipped = state.skippedBySymbol && typeof state.skippedBySymbol === "object"
    ? state.skippedBySymbol
    : {};
  const blocked = (s) => !s || !!done[s] || !!skipped[s];
  const queued = pendingRotateSells(commands)
    .map((c) => normSym(c.symbol))
    .filter((s) => !blocked(s));
  const pending = Array.isArray(state.pendingSells)
    ? state.pendingSells.map(normSym).filter((s) => !blocked(s))
    : [];
  return [...new Set([...queued, ...pending])];
}

export function isRotateQuoterMiss(kind = "", code = "") {
  return /QuoterV2 miss|QUOTE_MISS/i.test(`${kind} ${code}`);
}

/** DexScreener/Quoter mark missing — processToken NO QUOTE / unindexed pool. */
export function isRotateNoQuote(kind = "", code = "") {
  return /NO[\s_-]?QUOTE|missing[\s\S]{0,80}mark|unindexed|pool dry/i.test(`${kind} ${code}`);
}

export function isRotateUnquotedSkip(kind = "", code = "") {
  return isRotateQuoterMiss(kind, code) || isRotateNoQuote(kind, code);
}

export function dropRotateSellCommand(commands, symbol) {
  const sym = normSym(symbol);
  if (!Array.isArray(commands) || !sym) return commands;
  for (let i = commands.length - 1; i >= 0; i--) {
    const c = commands[i];
    if (isOperatorRotateCommand(c) && normSym(c.symbol) === sym && (c.action === "sell" || c.action === "sellhalf")) {
      commands.splice(i, 1);
    }
  }
  return commands;
}

export function recordRotateQuoterMiss(state, symbol) {
  if (!state || typeof state !== "object") return 0;
  const sym = normSym(symbol);
  if (!sym) return 0;
  if (!state.quoterMissBySymbol || typeof state.quoterMissBySymbol !== "object") {
    state.quoterMissBySymbol = {};
  }
  state.quoterMissBySymbol[sym] = (Number(state.quoterMissBySymbol[sym]) || 0) + 1;
  return state.quoterMissBySymbol[sym];
}

/** Mark sold-or-skipped so rem rematch cannot re-queue a dead Quoter bag. */
export function markOperatorRotateSellSkipped(state, symbol, reason = "quoter-miss") {
  if (!state) return state;
  const sym = normSym(symbol);
  if (!state.doneBySymbol || typeof state.doneBySymbol !== "object") state.doneBySymbol = {};
  if (!state.skippedBySymbol || typeof state.skippedBySymbol !== "object") state.skippedBySymbol = {};
  if (sym) {
    state.doneBySymbol[sym] = true;
    state.skippedBySymbol[sym] = reason || "quoter-miss";
  }
  if (Array.isArray(state.pendingSells)) {
    state.pendingSells = state.pendingSells.filter((s) => normSym(s) !== sym);
  }
  return state;
}

/**
 * Unquoted / unsellable rotate bag during OPERATOR_ROTATE_TO=HOME:
 * zero on-chain balance drops immediately; NO-QUOTE / missing DexScreener-or-
 * Quoter mark / QuoterV2 miss drop rem on first miss (any bag after N misses).
 * Does not invent a fill — leftover stays on-chain.
 */
export function applyRotateUnquotedSkip({
  commands,
  state = {},
  symbol,
  remBag = false,
  kind = "NO QUOTE",
  code = "",
  balance,
} = {}) {
  const outstanding = () => rotateSellsOutstanding(commands, state);
  const units = Number(balance);
  if (Number.isFinite(units) && !isRotateRemBag(units)) {
    markOperatorRotateSellSkipped(state, symbol, "zero-bal");
    dropRotateSellCommand(commands, symbol);
    return { dropped: true, misses: 0, remBag: false, reason: "zero-bal", outstanding: outstanding() };
  }
  if (!isRotateUnquotedSkip(kind, code)) {
    return { dropped: false, misses: 0, remBag: !!remBag, reason: "not-unquoted", outstanding: outstanding() };
  }
  const misses = recordRotateQuoterMiss(state, symbol);
  const drop = !!remBag || misses >= ROTATE_QUOTER_MISS_SKIP;
  if (!drop) {
    return { dropped: false, misses, remBag: !!remBag, reason: "counted", outstanding: outstanding() };
  }
  const skipReason = isRotateNoQuote(kind, code) ? "no-quote" : "quoter-miss";
  markOperatorRotateSellSkipped(state, symbol, skipReason);
  dropRotateSellCommand(commands, symbol);
  return { dropped: true, misses, remBag: !!remBag, reason: skipReason, outstanding: outstanding() };
}

/**
 * Quoter miss during OPERATOR_ROTATE_TO=HOME:
 * rem bags drop on first miss; any bag drops after N misses.
 * Does not invent a fill — leftover stays on-chain.
 */
export function applyRotateQuoterMiss(opts = {}) {
  return applyRotateUnquotedSkip({
    kind: "QuoterV2 miss",
    ...opts,
  });
}

/**
 * Queue one-shot empty-to-HOME. Does not latch until sells + HOME buy finish.
 * @returns {{ queued: boolean, reason: string, items?: object[], homeBuy?: boolean }}
 */
export function queueOperatorRotateOnce(
  commands,
  rawEnv,
  knownSymbols,
  state = { done: false },
  opts = {},
) {
  const env = opts.env || process.env;
  const wallet = opts.wallet;
  if (state.done === true && state.finished === true) {
    return { queued: false, reason: "already-applied" };
  }
  if (!rotateWalletAllowed(wallet)) {
    return { queued: false, reason: "vault-never" };
  }
  const parsed = parseOperatorRotateTo(rawEnv ?? env?.OPERATOR_ROTATE_TO);
  if (!parsed) {
    return { queued: false, reason: String(rawEnv ?? env?.OPERATOR_ROTATE_TO ?? "").trim() ? "invalid" : "unset" };
  }

  applyRotateHalt(env);
  armRotateAllowLossy(env);

  if (!state.doneBySymbol || typeof state.doneBySymbol !== "object") state.doneBySymbol = {};
  if (!state.skippedBySymbol || typeof state.skippedBySymbol !== "object") state.skippedBySymbol = {};
  if (!Array.isArray(state.pendingSells)) state.pendingSells = [];

  const list = [];
  const seen = new Set();
  const known = knownSymbols instanceof Set ? knownSymbols : new Set(knownSymbols || []);
  for (const raw of known) {
    const symbol = normSym(raw);
    if (!symbol || seen.has(symbol)) continue;
    if (shouldSkipRotateSell({ symbol, wallet, env })) continue;
    if (isRotateSellSkipped(state, symbol)) continue;
    const units = opts.balances && typeof opts.balances === "object"
      ? Number(opts.balances[symbol])
      : undefined;
    if (Number.isFinite(units) && !isRotateRemBag(units)) continue;
    if (state.doneBySymbol[symbol]) {
      if (!Number.isFinite(units) || !isRotateRemBag(units)) continue;
      delete state.doneBySymbol[symbol];
    }
    seen.add(symbol);
    list.push(symbol);
  }

  const queuedItems = [];
  for (const symbol of list) {
    const already = (Array.isArray(commands) ? commands : []).some(
      (c) => isOperatorRotateCommand(c) && normSym(c.symbol) === symbol && c.action === "sell",
    );
    if (already) continue;
    commands.push(rotateSellCommand(symbol));
    if (!state.pendingSells.includes(symbol)) state.pendingSells.push(symbol);
    queuedItems.push({ symbol, pct: 1 });
  }

  let homeBuy = false;
  if (!state.homeBuyQueued && rotateSellsOutstanding(commands, state).length === 0) {
    const haveBuy = (Array.isArray(commands) ? commands : []).some(
      (c) => isOperatorRotateCommand(c) && c.action === "buy" && isRotateTarget(c.symbol, env),
    );
    if (!haveBuy) {
      commands.push(rotateHomeBuyCommand());
      state.homeBuyQueued = true;
      homeBuy = true;
    }
  }

  if (queuedItems.length || homeBuy) {
    return {
      queued: true,
      reason: "queued",
      symbol: queuedItems[0]?.symbol || VERIFIED_HOME_SYMBOL,
      items: queuedItems,
      homeBuy,
    };
  }
  if (list.length && list.every((s) => state.doneBySymbol[s]) && state.homeBuyDone) {
    return { queued: false, reason: "already-applied" };
  }
  return { queued: false, reason: "already-queued" };
}

export function markOperatorRotateSellExecuted(state, symbol) {
  if (!state) return state;
  const sym = normSym(symbol);
  if (!state.doneBySymbol || typeof state.doneBySymbol !== "object") state.doneBySymbol = {};
  if (sym) state.doneBySymbol[sym] = true;
  if (Array.isArray(state.pendingSells)) {
    state.pendingSells = state.pendingSells.filter((s) => normSym(s) !== sym);
  }
  state.executed = true;
  return state;
}

export function markOperatorRotateHomeBuyExecuted(state) {
  if (!state) return state;
  state.homeBuyDone = true;
  state.homeBuyQueued = true;
  state.executed = true;
  return state;
}

/**
 * After the last non-HOME sell, queue WETH→HOME. Call from the cycle.
 */
export function maybeQueueRotateHomeBuy(commands, state = {}, opts = {}) {
  const env = opts.env || process.env;
  if (!isOperatorRotateArmed(env)) return { queued: false, reason: "unset" };
  if (!rotateWalletAllowed(opts.wallet)) return { queued: false, reason: "vault-never" };
  if (state.homeBuyDone) return { queued: false, reason: "already-applied" };
  if (rotateSellsOutstanding(commands, state).length > 0) {
    return { queued: false, reason: "sells-pending" };
  }
  const haveBuy = (Array.isArray(commands) ? commands : []).some(
    (c) => isOperatorRotateCommand(c) && c.action === "buy" && isRotateTarget(c.symbol, env),
  );
  if (haveBuy || state.homeBuyQueued) return { queued: false, reason: "already-queued" };
  commands.push(rotateHomeBuyCommand());
  state.homeBuyQueued = true;
  return { queued: true, reason: "queued", symbol: VERIFIED_HOME_SYMBOL };
}

/** Clear rotate only after HOME buy attempted (including no-excess-WETH skip). */
export function canFinishOperatorRotate({ homeBuyAttempted = false } = {}) {
  return !!homeBuyAttempted;
}

/**
 * Consume ALLOW_LOSSY + clear rotate after all sells and the HOME buy finish.
 * Railway dashboard should also drop OPERATOR_ROTATE_TO / ALLOW_LOSSY after.
 * Does not clear until HOME buy attempted.
 */
export function finishOperatorRotate(env = process.env, state = {}, opts = {}) {
  if (!env || typeof env !== "object") return { consumed: false, finished: false };
  if (!opts.force && !canFinishOperatorRotate(opts)) {
    return { consumed: false, finished: false, reason: "home-buy-pending" };
  }
  const wasLossy = envYes("ALLOW_LOSSY_OPERATOR_SELL", env);
  env.ALLOW_LOSSY_OPERATOR_SELL = "no";
  env.OPERATOR_ROTATE_TO = "";
  if (state) {
    state.done = true;
    state.finished = true;
    state.executed = true;
  }
  return { consumed: wasLossy, finished: true };
}

/**
 * True while rotate is emptying bags — executeSell must not consume ALLOW_LOSSY.
 */
export function shouldHoldAllowLossyForRotate(env = process.env, state = {}) {
  if (state?.finished) return false;
  return isOperatorRotateArmed(env);
}

/** Rotate sells any non-HOME bag (not just GAME_FORCE_EXIT_PRIORITY). */
export function rotateAllowsLossySell(symbol, env = process.env) {
  if (!isOperatorRotateArmed(env)) return false;
  if (isRotateTarget(symbol, env)) return false;
  if (isSkipHoldRotateSymbol(symbol)) return false;
  return true;
}
