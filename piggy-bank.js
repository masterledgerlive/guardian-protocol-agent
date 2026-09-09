/**
 * Per-token piggy-bank dust reserve.
 *
 * Every position keeps a growing never-sell pile. Wave / moonshot / cascade /
 * operator /sell / sellhalf / fib / stale / stop-loss must leave that dust
 * behind. Dust is sold only when Game/operator explicitly unlocks it
 * (reason prefix `PIGGY UNLOCK` or Telegram `/piggyunlock SYMBOL`).
 *
 * Sizing hypothesis (sane defaults, env-overridable):
 *   PIGGY_BANK_PCT      = 5% of current token units (was 2% — too thin; real
 *                         seats must leave a compounding pile, not dust-of-dust).
 *   PIGGY_BANK_MIN_USD  = $0.15 floor on bags that can afford it. Crumbs below
 *                         the floor use pct only so we do not 100%-lock $0.02
 *                         bags and "list money" with sellable = 0 forever.
 *   PIGGY_EARNINGS_BUFFER_PCT = 5% of proceeds that must remain after fees +
 *                         skim + hitch message — math must never list a gain
 *                         that evaporates once Eureka bytes ride the fill.
 *
 * Earnings banking (silent growth):
 *   Each profitable exit banks the *bear-minimum* projected earnings
 *   (`earningsToBankUsd` ≈ buffer need, or the buy-plan projection) into
 *   `savedEarningsUsd`. Reserve tokens are sized so dust USD covers that
 *   cumulative count — floor alone is not enough (live AERO: $0.15 floor
 *   while counting said $0.27). Extra profits above the bear min stay liquid
 *   for redeploy / ride-higher waves. Telegram buy/sell receipts show the
 *   full math; `/piggy` counting must match on-chain dust USD.
 *
 * Ratchet: reserve floors up when balance grows. It never auto-decreases.
 * After a partial sell the persisted reserve stays at the high-water mark
 * (capped only at remaining on-chain units). Unlock is the only path that
 * may shrink or clear the pile.
 *
 * Ledger rule: peak gates and post-fill PnL must charge only the sold fraction
 * of entry cost (`previewPiggySellNetUsd` / `costBasisForSoldFraction`). Leaving
 * dust behind leaves that cost behind — otherwise succession math fails.
 * Earnings-with-message use `earningsUsd` (net − hitch) and refuse hitch when
 * that figure cannot clear the piggy earnings buffer.
 *
 * Nested ledgers (`buildTokenPiggyLedger`): dust + saved earnings + ETH contrib
 * + agent share per inject seat. Agent share funds future AI piggy banks;
 * dust stays locked.
 *
 * This does not replace the ETH skim `piggyBank` in positions.json — that is
 * a different pool. This module is token-unit dust on each bag.
 */

export const PIGGY_UNLOCK_PREFIX = "PIGGY UNLOCK";
export const DEFAULT_PIGGY_BANK_PCT = 0.05;
export const DEFAULT_PIGGY_BANK_MIN_USD = 0.15;
/** Fraction of proceeds that must remain as true earnings after fees/skim/hitch. */
export const DEFAULT_PIGGY_EARNINGS_BUFFER_PCT = 0.05;

/** True iff reason starts with `PIGGY UNLOCK` (case-insensitive). */
export function isPiggyUnlock(reason = "") {
  return String(reason || "").toUpperCase().startsWith(PIGGY_UNLOCK_PREFIX);
}

export function piggyUnlockReason(symbol = "") {
  const sym = String(symbol || "").trim().toUpperCase();
  return sym ? `${PIGGY_UNLOCK_PREFIX} ${sym}` : PIGGY_UNLOCK_PREFIX;
}

/** Parse `0.08` / `8` / `8%` style percents into a fraction in [0, 0.5]. */
export function parsePiggyPctValue(raw, fallback = DEFAULT_PIGGY_BANK_PCT) {
  if (raw == null || String(raw).trim() === "") return fallback;
  let s = String(raw).trim();
  if (s.endsWith("%")) s = s.slice(0, -1).trim();
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return fallback;
  if (n === 0) return 0;
  if (n > 0 && n < 1) return n;
  if (n >= 1 && n <= 50) return n / 100;
  return fallback;
}

/**
 * `PIGGY_BANK_PCT` — fraction in (0, 1). Also accepts `2` as 2%.
 * Invalid / missing → 2%.
 *
 * Per-token override order (highest wins):
 *   1. `opts.piggyBankPct` from the catalog row
 *   2. env `PIGGY_BANK_PCT_<SYMBOL>` (e.g. `PIGGY_BANK_PCT_LINK=8`)
 *   3. global `PIGGY_BANK_PCT`
 */
export function piggyBankPct(env = process.env, opts = {}) {
  if (opts?.piggyBankPct != null && opts.piggyBankPct !== "") {
    return parsePiggyPctValue(opts.piggyBankPct, DEFAULT_PIGGY_BANK_PCT);
  }
  const sym = String(opts?.symbol || "").trim().toUpperCase();
  if (sym) {
    const key = `PIGGY_BANK_PCT_${sym}`;
    if (env?.[key] != null && String(env[key]).trim() !== "") {
      return parsePiggyPctValue(env[key], DEFAULT_PIGGY_BANK_PCT);
    }
  }
  return parsePiggyPctValue(env?.PIGGY_BANK_PCT, DEFAULT_PIGGY_BANK_PCT);
}

/**
 * `PIGGY_BANK_MIN_USD` — USD floor converted to token units via live price.
 * Invalid / missing → $0.05. `0` disables the floor.
 * Per-token: catalog `piggyBankMinUsd` or env `PIGGY_BANK_MIN_USD_<SYMBOL>`.
 */
export function piggyBankMinUsd(env = process.env, opts = {}) {
  if (opts?.piggyBankMinUsd != null && opts.piggyBankMinUsd !== "") {
    const n = Number(opts.piggyBankMinUsd);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  const sym = String(opts?.symbol || "").trim().toUpperCase();
  if (sym) {
    const key = `PIGGY_BANK_MIN_USD_${sym}`;
    if (env?.[key] != null && String(env[key]).trim() !== "") {
      const n = Number(env[key]);
      if (Number.isFinite(n) && n >= 0) return n;
    }
  }
  const raw = env?.PIGGY_BANK_MIN_USD;
  if (raw == null || String(raw).trim() === "") return DEFAULT_PIGGY_BANK_MIN_USD;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_PIGGY_BANK_MIN_USD;
  return n;
}

/** Bundle catalog + symbol opts for piggy helpers. */
export function piggyOptsFromToken(token = {}, extra = {}) {
  return {
    symbol: token?.symbol,
    piggyBankPct: token?.piggyBankPct,
    piggyBankMinUsd: token?.piggyBankMinUsd,
    savedEarningsUsd: token?.savedEarningsUsd,
    ...extra,
  };
}

export function sanitizePiggyReserve(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Target reserve from *current* balance (not the persisted high-water mark).
 * max(pct × balance, minUsd / price), never more than balance.
 * USD floor only applies when bag USD ≥ min — otherwise crumbs would be
 * 100% locked (live Railway: $0.01–$0.02 bags listed forever, sellable 0).
 * Pass `opts` (`symbol` / catalog pct) for per-token leave-behind (LINK = 8%).
 */
export function computePiggyTarget(balance, priceUsd, env = process.env, opts = {}) {
  const bal = Math.max(0, Number(balance) || 0);
  if (bal <= 0) return 0;
  const fromPct = bal * piggyBankPct(env, opts);
  const price = Number(priceUsd);
  const minUsd = piggyBankMinUsd(env, opts);
  const bagUsd = Number.isFinite(price) && price > 0 ? bal * price : 0;
  const fromUsd = bagUsd + 1e-12 >= minUsd && minUsd > 0 && Number.isFinite(price) && price > 0
    ? minUsd / price
    : 0;
  const savedUsd = Math.max(0, Number(opts?.savedEarningsUsd) || 0);
  const fromSaved = Number.isFinite(price) && price > 0 ? savedUsd / price : 0;
  return Math.min(bal, Math.max(fromPct, fromUsd, fromSaved));
}

/**
 * Bear-minimum USD to bank into the token piggy on a profitable exit.
 * Never invents money: capped at actual earnings after the message.
 * Prefer the buy-plan projection when present; otherwise the earnings buffer
 * need. Upside above that stays liquid for redeploy / higher waves.
 */
export function earningsToBankUsd({
  earningsUsd = 0,
  needUsd = 0,
  gains = false,
  projectedEarningsUsd = null,
} = {}) {
  if (!gains) return 0;
  const earn = Math.max(0, Number(earningsUsd) || 0);
  if (!(earn > 0)) return 0;
  const need = Math.max(0, Number(needUsd) || 0);
  if (projectedEarningsUsd != null && projectedEarningsUsd !== "") {
    const projected = Math.max(0, Number(projectedEarningsUsd) || 0);
    const target = projected > 0 ? projected : need;
    return Math.min(earn, target > 0 ? target : earn);
  }
  // No buy plan — bank the buffer need (bear min), not the full wave profit.
  if (need > 0) return Math.min(earn, need);
  return earn;
}

/**
 * Buy-time plan: entry, sell-at for never-lose (fees + message cushion +
 * earnings buffer), projected bear-min earnings, and piggy after banking.
 */
export function projectBuyEarningsPlan({
  entryPrice = 0,
  ethSpent = 0,
  ethUsd = 0,
  tokensReceived = 0,
  feePct = 0.006,
  skimPct = 0.01,
  hitchCostUsd = 0,
  hitchMult = 2,
  earningsBufferPct = DEFAULT_PIGGY_EARNINGS_BUFFER_PCT,
  piggyPct = DEFAULT_PIGGY_BANK_PCT,
  piggyMinUsd = DEFAULT_PIGGY_BANK_MIN_USD,
  priorSavedUsd = 0,
} = {}) {
  const entry = Math.max(0, Number(entryPrice) || 0);
  const eth = Math.max(0, Number(ethUsd) || 0);
  const spent = Math.max(0, Number(ethSpent) || 0);
  const tokens = Math.max(0, Number(tokensReceived) || 0);
  const investedUsd = spent * eth;
  const prior = Math.max(0, Number(priorSavedUsd) || 0);
  const pct = Math.max(0, Number(piggyPct) || 0);
  const minUsd = Math.max(0, Number(piggyMinUsd) || 0);
  const buf = Math.max(0, Number(earningsBufferPct) || 0);
  const fee = Math.max(0, Number(feePct) || 0);
  const skim = Math.max(0, Number(skimPct) || 0);
  const mult = Math.max(0, Number(hitchMult) || 0);

  const fromPct = tokens * pct;
  const fromMin = entry > 0 && minUsd > 0 ? minUsd / entry : 0;
  const fromSaved = entry > 0 ? prior / entry : 0;
  // Crumb rule: USD floor only when bag can afford it.
  const bagUsd = tokens * entry;
  const floorTokens = bagUsd + 1e-12 >= minUsd ? fromMin : 0;
  const dustTokens = Math.min(tokens, Math.max(fromPct, floorTokens, fromSaved));
  const dustUsd = dustTokens * entry;
  const sellable = Math.max(0, tokens - dustTokens);
  const soldFrac = tokens > 0 ? sellable / tokens : 0;
  const costUsd = investedUsd * soldFrac;

  const drag = fee + skim + buf;
  const netFrac = Math.max(1e-9, 1 - drag);
  const hitchNeedUsd = Math.max(0, Number(hitchCostUsd) || 0) * mult;
  const sellAtMin = sellable > 0
    ? (costUsd + hitchNeedUsd) / (sellable * netFrac)
    : 0;
  const proceedsAtMin = sellable * sellAtMin;
  const projectedEarningsUsd = proceedsAtMin * buf;
  const piggyAfterUsd = Math.max(dustUsd, prior + projectedEarningsUsd);

  return {
    entryPrice: entry,
    investedUsd,
    tokensReceived: tokens,
    sellable,
    dustTokens,
    dustUsd,
    sellAtMin,
    hitchNeedUsd,
    projectedEarningsUsd,
    priorSavedUsd: prior,
    piggyAfterUsd,
    feePct: fee,
    skimPct: skim,
    earningsBufferPct: buf,
    hitchMult: mult,
    neverLose: sellable > 0 && sellAtMin > 0 && sellAtMin + 1e-12 >= entry,
  };
}

/** Telegram HTML — buy receipt with full never-lose math. */
export function formatBuyReceiptHtml({
  symbol = "?",
  tradeNum = 0,
  entryPrice = 0,
  ethSpent = 0,
  spentUsd = 0,
  tokensReceived = 0,
  plan = null,
  hitchOnChain = false,
  txHash = "",
  hitchFooter = "",
} = {}) {
  const sym = String(symbol || "?");
  const entry = Number(entryPrice) || 0;
  const p = plan && typeof plan === "object" ? plan : {};
  const sellAt = Number(p.sellAtMin) || 0;
  const projEarn = Number(p.projectedEarningsUsd) || 0;
  const piggyAfter = Number(p.piggyAfterUsd) || 0;
  const prior = Number(p.priorSavedUsd) || 0;
  const dustUsd = Number(p.dustUsd) || 0;
  const hitchNeed = Number(p.hitchNeedUsd) || 0;
  const tok = Number(tokensReceived) || 0;
  const tokStr = tok >= 1 ? tok.toFixed(2) : tok.toFixed(6);
  const lines = [
    `✅🟢 <b>BOUGHT ${sym}! #${tradeNum}</b>`,
    `[⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜] 0% — wave begins!`,
    ``,
    `━━━━━━━━━━━━━━━━━━━━`,
    `<b>RECEIPT — buy math</b>`,
    `🛒 Bought at:  $${entry.toFixed(8)}`,
    `💰 Spent:      ${(Number(ethSpent) || 0).toFixed(6)} ETH (~$${(Number(spentUsd) || 0).toFixed(2)})`,
    `📦 Received:   ${tokStr} ${sym}`,
    `🐷 Piggy now:  ~$${dustUsd.toFixed(3)} locked (prior saved $${prior.toFixed(3)})`,
    ``,
    `<b>PROJECTED — bear min (never lose)</b>`,
    `🎯 Sell at ≥:  $${sellAt > 0 ? sellAt.toFixed(8) : "learning"}`,
    `📈 Min earn:   +$${projEarn.toFixed(3)} (pays fees + msg + buffer)`,
    `💌 Msg cushion: $${hitchNeed.toFixed(3)} reserved in sell-at`,
    `🐷 After bank: ~$${piggyAfter.toFixed(3)} ${sym} piggy (silent save)`,
    `<i>Ride higher for more — never sell below sell-at. Piggy is not spent.</i>`,
    `━━━━━━━━━━━━━━━━━━━━`,
  ];
  if (hitchFooter) lines.push(String(hitchFooter).trimEnd());
  else if (txHash) {
    lines.push(hitchOnChain
      ? `🔗 <a href="https://basescan.org/tx/${txHash}">Basescan ↗</a>`
      : `🔗 <a href="https://basescan.org/tx/${txHash}">Basescan ↗</a>\n⚠️ No UTF-8 hitch on this buy`);
  }
  return lines.join("\n");
}

/** Telegram HTML — sell receipt: bought→sold→earnings→piggy count. */
export function formatSellReceiptHtml({
  symbol = "?",
  tradeNum = 0,
  wipeout = false,
  medalEmoji = "",
  entryPrice = 0,
  exitPrice = 0,
  investedUsd = 0,
  receivedEth = 0,
  receivedUsd = 0,
  netUsd = 0,
  earningsUsd = 0,
  hitchOnChain = false,
  hitchCostUsd = 0,
  earningsNeedUsd = 0,
  bankedUsd = 0,
  piggyDustTokens = 0,
  piggyDustUsd = 0,
  piggySavedUsd = 0,
  piggyUnlock = false,
  holdStr = "?",
  skimLotteryEth = 0,
  piggyEthUsd = 0,
  predEth = 0,
  predUsd = 0,
  agentEth = 0,
  agentUsd = 0,
  surfReport = "",
  indDetail = "",
  hitchFooter = "",
  waveBar = "",
} = {}) {
  const sym = String(symbol || "?");
  const title = wipeout ? "WIPEOUT" : "WAVE COMPLETE";
  const dust = Number(piggyDustTokens) || 0;
  const dustStr = dust >= 1 ? dust.toFixed(2) : dust.toFixed(4);
  const saved = Number(piggySavedUsd) || 0;
  const dustU = Number(piggyDustUsd) || 0;
  const match = Math.abs(saved - dustU) <= 0.02 + 1e-9;
  const lines = [
    `${medalEmoji || (wipeout ? "📉" : "🏆")} <b>${title} — ${sym} #${tradeNum}</b>`,
    waveBar || (wipeout ? "〰️〰️〰️〰️〰️〰️〰️〰️〰️🦈" : "〰️〰️〰️〰️〰️〰️〰️〰️〰️🏆"),
    ``,
    `━━━━━━━━━━━━━━━━━━━━`,
    `<b>RECEIPT — bought → sold</b>`,
    `🛒 Bought at:  $${(Number(entryPrice) || 0).toFixed(8)}`,
    `💲 Sold at:    $${(Number(exitPrice) || 0).toFixed(8)}`,
    `📥 In:         ~$${(Number(investedUsd) || 0).toFixed(2)} | ⏱️ Held: ${holdStr}`,
    `💰 Out:        ${(Number(receivedEth) || 0).toFixed(6)} ETH (~$${(Number(receivedUsd) || 0).toFixed(2)})`,
    `${(Number(netUsd) || 0) >= 0 ? "📈" : "📉"} Net:        ${(Number(netUsd) || 0) >= 0 ? "+" : ""}$${(Number(netUsd) || 0).toFixed(2)}`,
    hitchOnChain
      ? `💌 After msg: ${(Number(earningsUsd) || 0) >= 0 ? "+" : ""}$${(Number(earningsUsd) || 0).toFixed(2)} (buffer $${(Number(earningsNeedUsd) || 0).toFixed(3)}, msg $${(Number(hitchCostUsd) || 0).toFixed(3)})`
      : `📈 Earnings:  ${(Number(earningsUsd) || 0) >= 0 ? "+" : ""}$${(Number(earningsUsd) || 0).toFixed(2)}`,
    ``,
    `<b>🐷 PIGGY BANK — silent save</b>`,
    `➕ Banked:     +$${(Number(bankedUsd) || 0).toFixed(3)} (bear min)`,
    `🪙 Dust left:  ${dustStr} ${sym}${piggyUnlock ? " (unlocked)" : " locked"}`,
    `💵 Dust USD:   ~$${dustU.toFixed(3)}`,
    `🧮 Counted:    $${saved.toFixed(3)} saved earnings`,
    match ? `✅ Count matches dust` : `⚠️ Count vs dust — sync next ratchet`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `🐷 ETH skim: +${(Number(skimLotteryEth) || 0).toFixed(6)} ETH → $${(Number(piggyEthUsd) || 0).toFixed(3)} locked`,
    `🧠 Pred:     +${(Number(predEth) || 0).toFixed(6)} ETH → $${(Number(predUsd) || 0).toFixed(3)} pool`,
    `🤖 Agent:    +${(Number(agentEth) || 0).toFixed(6)} ETH → $${(Number(agentUsd) || 0).toFixed(3)} pool`,
  ];
  if (surfReport) {
    lines.push(`━━━━━━━━━━━━━━━━━━━━`, String(surfReport).trimEnd());
  }
  if (indDetail) lines.push(`💓 ${indDetail}`);
  lines.push(`━━━━━━━━━━━━━━━━━━━━`);
  if (hitchFooter) lines.push(String(hitchFooter).trimEnd());
  return lines.join("\n");
}

/**
 * `PIGGY_EARNINGS_BUFFER_PCT` — fraction of proceeds that must remain after
 * fees + skim + hitch message. Env override; invalid → 5%.
 */
export function piggyEarningsBufferPct(env = process.env, opts = {}) {
  if (opts?.piggyEarningsBufferPct != null && opts.piggyEarningsBufferPct !== "") {
    return parsePiggyPctValue(opts.piggyEarningsBufferPct, DEFAULT_PIGGY_EARNINGS_BUFFER_PCT);
  }
  return parsePiggyPctValue(env?.PIGGY_EARNINGS_BUFFER_PCT, DEFAULT_PIGGY_EARNINGS_BUFFER_PCT);
}

/**
 * True earnings after piggy-aligned net and optional hitch message cost.
 * `gains` is only true when earnings clear the piggy buffer — never list a
 * "WAVE COMPLETE" gain that the message would wipe.
 */
export function piggyEarningsAfterMessage({
  netUsd = 0,
  hitchCostUsd = 0,
  proceedsUsd = 0,
  bufferPct = DEFAULT_PIGGY_EARNINGS_BUFFER_PCT,
} = {}) {
  const net = Number(netUsd) || 0;
  const hitch = Math.max(0, Number(hitchCostUsd) || 0);
  const proceeds = Math.max(0, Number(proceedsUsd) || 0);
  const buf = Math.max(0, Number(bufferPct) || 0);
  const earningsUsd = net - hitch;
  const needUsd = proceeds * buf;
  const gains = earningsUsd + 1e-12 > needUsd && earningsUsd > 0;
  return {
    earningsUsd,
    hitchCostUsd: hitch,
    needUsd,
    bufferPct: buf,
    gains,
    neverLose: gains,
  };
}

/**
 * Floor-up ratchet. Never auto-decreases. Capped at current balance so a
 * persisted reserve cannot exceed what the wallet still holds.
 */
export function ratchetPiggyReserve(existingReserve, balance, priceUsd, env = process.env, opts = {}) {
  const existing = sanitizePiggyReserve(existingReserve);
  const bal = Math.max(0, Number(balance) || 0);
  if (bal <= 0) return existing > 0 ? 0 : 0;
  const target = computePiggyTarget(bal, priceUsd, env, opts);
  return Math.min(bal, Math.max(existing, target));
}

/** Effective saved-earnings count — never below live dust USD or the USD floor once dust exists. */
export function effectiveSavedEarningsUsd({
  savedEarningsUsd = 0,
  dustUsd = 0,
  piggyMinUsd = 0,
} = {}) {
  const saved = Math.max(0, Number(savedEarningsUsd) || 0);
  const dust = Math.max(0, Number(dustUsd) || 0);
  const floor = dust > 0 ? Math.max(0, Number(piggyMinUsd) || 0) : 0;
  return Math.max(saved, dust, floor);
}

/**
 * sellable = balance − piggyReserve unless unlock.
 */
export function computeSellable(balance, piggyReserve, { unlock = false } = {}) {
  const bal = Math.max(0, Number(balance) || 0);
  if (unlock) return bal;
  return Math.max(0, bal - sanitizePiggyReserve(piggyReserve));
}

/**
 * After a fill: unlock may shrink the pile to remaining units.
 * Non-unlock keeps the high-water mark, capped at remaining units.
 */
export function remainingPiggyAfterSell(existingReserve, remainingBalance, { unlock = false } = {}) {
  const existing = sanitizePiggyReserve(existingReserve);
  const remain = Math.max(0, Number(remainingBalance) || 0);
  if (remain <= 0) return 0;
  if (unlock) return Math.min(existing, remain);
  return Math.min(remain, existing);
}

/**
 * Single decision used by every sell path.
 *
 * `sellPct` is applied to *sellable* units (not the full bag) so a 100%
 * request still leaves dust unless `reason` is a piggy unlock.
 */
export function applyPiggyToSell({
  balance,
  sellPct = 1,
  piggyReserve = 0,
  priceUsd,
  reason = "",
  env = process.env,
  symbol,
  piggyBankPct: catalogPct,
  piggyBankMinUsd: catalogMinUsd,
  savedEarningsUsd = 0,
  token,
} = {}) {
  const opts = piggyOptsFromToken(token || {}, {
    symbol: symbol || token?.symbol,
    piggyBankPct: catalogPct ?? token?.piggyBankPct,
    piggyBankMinUsd: catalogMinUsd ?? token?.piggyBankMinUsd,
    savedEarningsUsd: savedEarningsUsd || token?.savedEarningsUsd || 0,
  });
  const bal = Math.max(0, Number(balance) || 0);
  const pct = Math.max(0, Math.min(1, Number(sellPct) || 0));
  const unlock = isPiggyUnlock(reason);
  const reserve = ratchetPiggyReserve(piggyReserve, bal, priceUsd, env, opts);
  const sellable = computeSellable(bal, reserve, { unlock });
  const tokensToSell = sellable * pct;
  const remainingBalance = Math.max(0, bal - tokensToSell);
  const remainingReserve = remainingPiggyAfterSell(reserve, remainingBalance, { unlock });
  const px = Number(priceUsd);
  const remainingDustUsd = Number.isFinite(px) && px > 0 ? remainingReserve * px : 0;
  return {
    unlock,
    reserve,
    sellable,
    tokensToSell,
    remainingBalance,
    remainingReserve,
    remainingDustUsd,
    savedEarningsUsd: Math.max(0, Number(opts.savedEarningsUsd) || 0),
    blocked: tokensToSell <= 0,
    soldAll: remainingBalance <= 1e-12,
    piggyPct: piggyBankPct(env, opts),
    piggyMinUsd: piggyBankMinUsd(env, opts),
  };
}

/**
 * Parse `/piggyunlock SYMBOL`. Does not match `/piggy`.
 * @returns {{ symbol: string } | null}
 */
export function parsePiggyUnlockCommand(raw) {
  const parts = String(raw || "").trim().split(/\s+/);
  const verb = (parts[0] || "").toLowerCase();
  if (verb !== "/piggyunlock") return null;
  const symbol = (parts[1] || "").toUpperCase();
  if (!symbol) return null;
  return { symbol };
}

/** Restore persisted reserve from tokens.json and/or positions.json. */
export function loadPiggyReserve(token, positionsMap) {
  const fromToken = sanitizePiggyReserve(token?.piggyReserve);
  const sym = token?.symbol;
  const fromPos = sym ? sanitizePiggyReserve(positionsMap?.[sym]) : 0;
  return Math.max(fromToken, fromPos);
}

/**
 * Cost basis for tokens actually sold after piggy.
 * Dust left behind keeps its slice of entry — charging 100% cost against a
 * piggy-capped sell flips real profits into fake losses on the ledger.
 */
export function costBasisForSoldFraction(totalInvestedEth, soldFrac) {
  const inv = Math.max(0, Number(totalInvestedEth) || 0);
  const f = Math.max(0, Math.min(1, Number(soldFrac) || 0));
  return inv * f;
}

/**
 * Preview net USD when selling `sellable` and leaving the piggy pile untouched.
 * Peak / fib / early-sell gates must use this so succession math matches
 * executeSell (soldFrac × entry, fees/skim on sold proceeds only).
 *
 * Pass `hitchCostUsd` when a message may ride the fill — `earningsUsd` /
 * `gains` then require the piggy earnings buffer so we never list money
 * that the hitch would erase.
 */
export function previewPiggySellNetUsd({
  balance,
  sellable,
  investedEth = 0,
  priceUsd,
  ethUsd,
  feePct = 0.006,
  skimPct = 0.01,
  hitchCostUsd = 0,
  earningsBufferPct = DEFAULT_PIGGY_EARNINGS_BUFFER_PCT,
} = {}) {
  const bal = Math.max(0, Number(balance) || 0);
  const sell = Math.max(0, Number(sellable) || 0);
  const px = Number(priceUsd);
  const eth = Number(ethUsd);
  if (!(bal > 0) || !(sell > 0) || !(px > 0) || !(eth > 0)) {
    return {
      soldFrac: 0,
      proceedsUsd: 0,
      costUsd: 0,
      feesUsd: 0,
      skimUsd: 0,
      netUsd: 0,
      hitchCostUsd: 0,
      earningsUsd: 0,
      earningsNeedUsd: 0,
      gains: false,
    };
  }
  const soldFrac = Math.min(1, sell / bal);
  const proceedsUsd = sell * px;
  const costUsd = costBasisForSoldFraction(investedEth, soldFrac) * eth;
  const feesUsd = proceedsUsd * Math.max(0, Number(feePct) || 0);
  const skimUsd = proceedsUsd * Math.max(0, Number(skimPct) || 0);
  const netUsd = proceedsUsd - costUsd - feesUsd - skimUsd;
  const earn = piggyEarningsAfterMessage({
    netUsd,
    hitchCostUsd,
    proceedsUsd,
    bufferPct: earningsBufferPct,
  });
  return {
    soldFrac,
    proceedsUsd,
    costUsd,
    feesUsd,
    skimUsd,
    netUsd,
    hitchCostUsd: earn.hitchCostUsd,
    earningsUsd: earn.earningsUsd,
    earningsNeedUsd: earn.needUsd,
    gains: earn.gains,
  };
}

/**
 * Nested per-token piggy ledger — dust on each inject seat, plus ETH/agent
 * shares skimmed from that token's profitable exits. AI piggy banks later
 * draw from agentShare; dust stays untouched unless explicit unlock.
 */
export function buildTokenPiggyLedger({
  symbol = "",
  dustReserve = 0,
  dustUsd = 0,
  savedEarningsUsd = 0,
  ethContrib = 0,
  agentShare = 0,
} = {}) {
  const dustU = Math.max(0, Number(dustUsd) || 0);
  const saved = Math.max(0, Number(savedEarningsUsd) || 0);
  return {
    symbol: String(symbol || "").trim().toUpperCase(),
    dustReserve: sanitizePiggyReserve(dustReserve),
    dustUsd: dustU,
    // Counting total — floors up to live dust so reports never understate the pile.
    savedEarningsUsd: Math.max(saved, dustU),
    ethContrib: Math.max(0, Number(ethContrib) || 0),
    agentShare: Math.max(0, Number(agentShare) || 0),
  };
}

/** Credit ETH piggy / agent slices onto a per-token nested ledger row. */
export function creditTokenPiggyPools(ledger, { ethContrib = 0, agentShare = 0, symbol } = {}) {
  const base = ledger && typeof ledger === "object"
    ? { ...ledger }
    : buildTokenPiggyLedger({ symbol });
  if (symbol && !base.symbol) base.symbol = String(symbol).trim().toUpperCase();
  base.ethContrib = Math.max(0, (Number(base.ethContrib) || 0) + Math.max(0, Number(ethContrib) || 0));
  base.agentShare = Math.max(0, (Number(base.agentShare) || 0) + Math.max(0, Number(agentShare) || 0));
  base.dustReserve = sanitizePiggyReserve(base.dustReserve);
  base.dustUsd = Math.max(0, Number(base.dustUsd) || 0);
  base.savedEarningsUsd = Math.max(
    0,
    Number(base.savedEarningsUsd) || 0,
    base.dustUsd,
  );
  return base;
}

/**
 * After a profitable fill: add banked bear-min earnings to the nested ledger
 * and sync dust marks so counting matches what is left on-chain.
 */
export function creditPiggySavedEarnings(ledger, {
  bankedUsd = 0,
  dustReserve = 0,
  dustUsd = 0,
  symbol,
} = {}) {
  const base = ledger && typeof ledger === "object"
    ? { ...ledger }
    : buildTokenPiggyLedger({ symbol });
  if (symbol && !base.symbol) base.symbol = String(symbol).trim().toUpperCase();
  const banked = Math.max(0, Number(bankedUsd) || 0);
  const dustU = Math.max(0, Number(dustUsd) || 0);
  const prior = Math.max(0, Number(base.savedEarningsUsd) || 0, Number(base.dustUsd) || 0);
  base.dustReserve = sanitizePiggyReserve(dustReserve || base.dustReserve);
  base.dustUsd = dustU;
  // Counting add — never shrinks; aligns up to live dust after the fill.
  base.savedEarningsUsd = Math.max(prior + banked, dustU);
  return base;
}

/** Unrealized co-invest mark (tokens × price − ethIn × ethUsd). */
export function piggyCoInvestMarkUsd({ tokens = 0, priceUsd = 0, ethIn = 0, ethUsd = 0 } = {}) {
  const mark = Math.max(0, Number(tokens) || 0) * Math.max(0, Number(priceUsd) || 0);
  const cost = Math.max(0, Number(ethIn) || 0) * Math.max(0, Number(ethUsd) || 0);
  return mark - cost;
}
