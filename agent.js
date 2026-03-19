import { CdpClient } from "@coinbase/cdp-sdk";
import { createPublicClient, http, formatEther, parseEther } from "viem";
import { base } from "viem/chains";
import dotenv from "dotenv";
dotenv.config();

// ── 🔐 VAULT LOADER — fetches encrypted keys from Base blockchain at boot ─────
import {
  loadVaultKeys,
  getVaultStatusMessage,
  getVaultTestMessage,
  vaultForceReload,
  vaultEncryptAndInscribe,
  pendingVaultSessions,
  startVaultSession,
  getVaultSession,
  clearVaultSession,
} from "./vault-loader.js";

// ── BITStorage / ShadowWeave — Mempool Orchestrator ──────────────────────────
import { MempoolOrchestrator, LANE } from "./bitstorage-orchestrator.js";
const orch = new MempoolOrchestrator({
  cdpClient:     null, // set in main() after cdpClient is created
  walletAddress: "0x50e1C4608c48b0c52E1EA5FBabc1c9126eA17915",
  githubToken:   process.env.GITHUB_TOKEN,
  githubRepo:    process.env.GITHUB_REPO,
  stateBranch:   "bot-state",
  bitsBalance:   0,
});
let orchReady = false;

// ═══════════════════════════════════════════════════════════════════════════════
// ⚔️💓  GUARDIAN PROTOCOL — HEARTBEAT EDITION v16.0 — PRECISION FIX
// ═══════════════════════════════════════════════════════════════════════════════
// MISSION: Buy at confirmed MIN trough. Sell at confirmed MAX peak.
// Net margin must clear fees + gas. RSI + MACD confirm every wave.
// ETH+WETH unified. Auto gas top-up (WETH→ETH). Ledger wave seeding.
// Cascade profits immediately. Portfolio drawdown halts buys. Gas spike = pause.
// The machine never sleeps. The heartbeat never stops.
//
// v16.0 PRECISION FIXES (8 critical bugs patched):
//   1. gwei undefined in executeBuy → fetched locally now
//   2. Gas underestimated 36% (220k→300k units) → accurate margin gate
//   3. Fib exit fired EVERY cycle on same level → fibLevelsExecuted memory added
//   4. clearFibLevels() on position close → clean state for next trade
//   5. minWeth=0n silent bad fills → QuoterV2 slippage floor restored (85%)
//   6. profitableSell fired mid-wave → requires nearActualPeak (94% of MAX)
//   7. atMaxPeak 1% tolerance → tightened to 0.5%
//   8. Dead wave tokens burning loop → skip 50 cycles after 5 strikes
// ═══════════════════════════════════════════════════════════════════════════════

const WALLET_ADDRESS = "0x50e1C4608c48b0c52E1EA5FBabc1c9126eA17915";
const WETH_ADDRESS   = "0x4200000000000000000000000000000000000006";
const SWAP_ROUTER    = "0x2626664c2603336E57B271c5C0b26F421741e481";
// Uniswap V3 QuoterV2 on Base — used to get real on-chain price before every sell
// so minWeth is based on what the pool will ACTUALLY pay, not our stale cached price.
// This prevents "execution reverted" errors from slippage tolerance being set too high.
const QUOTER_V2      = "0x3d4e44Eb1374240CE5F1B136041212501e4a098e";
const QUOTER_ABI     = [{
  name: "quoteExactInputSingle",
  type: "function",
  stateMutability: "nonpayable",
  inputs: [{ name: "params", type: "tuple", components: [
    { name: "tokenIn",           type: "address" },
    { name: "tokenOut",          type: "address" },
    { name: "amountIn",          type: "uint256" },
    { name: "fee",               type: "uint24"  },
    { name: "sqrtPriceLimitX96", type: "uint160" }
  ]}],
  outputs: [
    { name: "amountOut",              type: "uint256" },
    { name: "sqrtPriceX96After",      type: "uint160" },
    { name: "initializedTicksCrossed",type: "uint32"  },
    { name: "gasEstimate",            type: "uint256" }
  ]
}];

// ── TIMING ────────────────────────────────────────────────────────────────────
const TRADE_LOOP_MS    = 15_000;   // 15s main cycle (was 30s — faster learning)
const COOLDOWN_MS      = 120_000;  // 2min cooldown per token (was 5min — more trades)
const CASCADE_COOLDOWN = 5_000;    // 5s grace for cascade targets
const SAVE_INTERVAL    = 900_000;  // save state every 15min
const REPORT_INTERVAL  = 600_000;  // Telegram report every 10min (was 30)
const MINI_UPDATE_INT  = 120_000;  // mini status ping every 2min
const TOKEN_SLEEP_MS   = 800;     // 0.8s between tokens — prices are batch-prefetched, no API wait needed
const ETH_PRICE_TTL    = 60_000;   // refresh live ETH price every 60s
const TX_TIMEOUT_MS    = 45_000;   // max wait for any on-chain tx (buy/sell/approve)
const PROCESS_TOKEN_TIMEOUT = 60_000; // raised from 12s — sell path alone needs 8s sleep + retries

// ── SAFETY ────────────────────────────────────────────────────────────────────
const GAS_RESERVE       = 0.0005;  // always keep this ETH for gas (raised from 0.0003)
const SELL_RESERVE      = 0.001;
const MAX_BUY_PCT       = 0.33;    // hard cap: never more than 33% in one token
const ETH_RESERVE_PCT   = 0.20;    // keep 20% as reserve
const MIN_ETH_TRADE     = 0.0005;
const MIN_POS_USD       = 3.00;    // minimum meaningful position size

// ══════════════════════════════════════════════════════════════════════════════
// 🏆 TWO-TIER REVOLVING CAPITAL SYSTEM
// ──────────────────────────────────────────────────────────────────────────────
// All tradeable capital is split between two tiers based on live token scores.
// Scores are computed every cycle from real trade history + live indicators.
// Capital allocation follows the scores — the best tokens always get the most.
//
// TIER 1 — TOP 3 TOKENS (65% of tradeable capital, split evenly = ~21.7% each)
//   Always the 3 highest-scoring tokens. Revolves as scores change.
//   A token exits tier 1 when its score drops — BUT we never force-exit a
//   position for this reason alone. The *next buy opportunity* goes to the new
//   tier 1 winner instead. Existing positions ride until their natural exit.
//
// TIER 2 — NEXT N TOKENS (35% of tradeable capital, split evenly)
//   Number of tier 2 slots = floor(35% capital / TIER2_MIN_SLOT_USD).
//   TIER2_MIN_SLOT_USD starts at $4.00 (your threshold). As capital grows,
//   more slots open automatically — each new slot only opens when the per-slot
//   amount stays above the minimum, so slots are always meaningful.
//   Example: $45 total → 35% = $15.75 → $15.75/$4 = 3 tier-2 slots ($5.25 ea)
//            $100 total → 35% = $35 → $35/$4 = 8 slots (capped at 6)
//
// MOONSHOT HOLD — tokens below tier 2 with existing positions
//   If a held token is not in tier 1 or tier 2, sell down to MOONSHOT_HOLD_USD.
//   This frees capital while keeping a lottery ticket on the position.
//   MOONSHOT_HOLD_USD = $0.50 (enough to matter if it moons, not enough to hurt)
//
// TOKEN SCORE (0–100) — computed live every cycle from:
//   Win rate (30 pts)    — % of trades that were profitable
//   Net P&L (25 pts)     — actual ETH earned, normalized to portfolio
//   Net margin (20 pts)  — current wave range minus fees (live opportunity)
//   Volume quality (15 pts) — price is moving, not dead wave
//   Dead wave penalty    — heavy penalty for tokens with negative net margin
//   Consistency (10 pts) — medals earned, no wipeouts
// ══════════════════════════════════════════════════════════════════════════════

const TIER1_COUNT        = 3;       // always top 3 tokens in tier 1
const TIER1_PCT          = 0.65;    // 65% of tradeable to tier 1
const TIER2_PCT          = 0.35;    // 35% of tradeable to tier 2
const TIER2_MIN_SLOT_USD = 4.00;    // minimum slot size to add a tier-2 position
const TIER2_MAX_SLOTS    = 6;       // never more than 6 tier-2 slots regardless of capital
const MOONSHOT_HOLD_USD  = 0.50;    // keep this much in non-tier tokens as lottery bag

// Compute a live performance score for a token (0–100)
// Higher = better. Used to rank tokens for tier assignment every cycle.
function calcTokenScore(symbol, gasCostEth, tradeEth) {
  const ws      = waveStats[symbol];
  const arm     = getArmStatus(symbol, gasCostEth, tradeEth);
  const ind     = getIndicatorScore(symbol);
  const token   = tokens.find(t => t.symbol === symbol);
  let score     = 0;

  // ── Win rate (30 pts) ─────────────────────────────────────────────────────
  const totalTrades = (ws?.wins || 0) + (ws?.losses || 0);
  if (totalTrades >= 2) {
    const winRate = (ws.wins / totalTrades);
    score += Math.round(winRate * 30);
  } else {
    score += 10; // neutral for new tokens — let them earn their rank
  }

  // ── Net P&L contribution (25 pts) ────────────────────────────────────────
  if (ws?.totalPnlEth > 0) {
    // Normalize: every 0.001 ETH profit = 5 pts, max 25
    score += Math.min(25, Math.round(ws.totalPnlEth / 0.001 * 5));
  } else if (ws?.totalPnlEth < 0) {
    score -= 10; // losers are penalized
  }

  // ── Current net margin (20 pts) — is there a live opportunity? ───────────
  if (arm.armed) {
    const netPct = arm.net || 0;
    if (netPct >= 0.05)      score += 20; // 5%+ margin = best
    else if (netPct >= 0.03) score += 14;
    else if (netPct >= 0.02) score += 10;
    else if (netPct >= 0.01) score += 6;
    else                     score += 3;
  } else {
    // Dead wave — heavy penalty
    score -= 15;
  }

  // ── Volume / price activity (15 pts) ─────────────────────────────────────
  const readings = history[symbol]?.readings || [];
  if (readings.length >= 10) {
    const recent = readings.slice(-10).map(r => r.price);
    const high   = Math.max(...recent);
    const low    = Math.min(...recent);
    const range  = low > 0 ? (high - low) / low : 0;
    if (range >= 0.03)      score += 15; // 3%+ recent move — alive
    else if (range >= 0.015) score += 9;
    else if (range >= 0.005) score += 4;
    else                     score -= 5; // flat = dead
  }

  // ── Consistency / medals (10 pts) ────────────────────────────────────────
  const medals = ws?.medals;
  if (medals) {
    score += Math.min(10, medals.gold * 4 + medals.silver * 2 + medals.bronze * 1);
    if (ws.losses > ws.wins && totalTrades >= 4) score -= 5; // more losses than wins
  }

  // ── No-price streak penalty ───────────────────────────────────────────────
  const noPrice = noPriceStreak[symbol] || 0;
  if (noPrice >= 5) score -= 20; // can't get a price = can't trade

  return Math.max(0, Math.min(100, score));
}

// Compute tier assignments for all tokens — returns { tier1: [syms], tier2: [syms] }
// Called once per main loop cycle. Scores all tokens, picks top N for each tier.
function computeTierAssignments(gasCostEth, tradeEth, totalTradeableUsd) {
  const scored = tokens
    .filter(t => !t.disabled)
    .map(t => ({ symbol: t.symbol, score: calcTokenScore(t.symbol, gasCostEth, tradeEth) }))
    .sort((a, b) => b.score - a.score);

  const tier1 = scored.slice(0, TIER1_COUNT).map(s => s.symbol);

  // Tier 2: how many slots can we afford?
  const tier2Capital   = totalTradeableUsd * TIER2_PCT;
  const maxTier2Slots  = Math.min(TIER2_MAX_SLOTS, Math.floor(tier2Capital / TIER2_MIN_SLOT_USD));
  const tier2Candidates = scored.slice(TIER1_COUNT);
  const tier2 = tier2Candidates.slice(0, maxTier2Slots).map(s => s.symbol);

  return { tier1, tier2, scored };
}

// How much ETH to deploy for a token given its tier and current capital
function calcTierSlotEth(symbol, tier1, tier2, totalTradeableEth, ethUsd) {
  const totalTradeableUsd = totalTradeableEth * ethUsd;
  if (tier1.includes(symbol)) {
    const slotUsd = (totalTradeableUsd * TIER1_PCT) / TIER1_COUNT;
    // At very low capital: use whatever is available rather than blocking entirely.
    // If slot < MIN_POS_USD we still allow it — gas check in executeBuy will catch truly tiny amounts.
    if (slotUsd < 0.50) return 0; // truly nothing — don't even try
    return Math.min(totalTradeableEth * TIER1_PCT / TIER1_COUNT, totalTradeableEth * MAX_BUY_PCT);
  }
  if (tier2.includes(symbol)) {
    const tier2Capital  = totalTradeableUsd * TIER2_PCT;
    const slots         = Math.min(TIER2_MAX_SLOTS, Math.floor(tier2Capital / TIER2_MIN_SLOT_USD));
    if (slots === 0) return 0; // no tier2 slots affordable yet
    const slotUsd = tier2Capital / slots;
    if (slotUsd < MIN_POS_USD) return 0;
    return Math.min(totalTradeableEth * TIER2_PCT / slots, totalTradeableEth * MAX_BUY_PCT);
  }
  return 0; // not in any tier — no new capital
}

// Global tier state — updated once per main loop, used across all processToken calls
let currentTier1 = [];
let currentTier2 = [];
let currentScores = []; // [{ symbol, score }] sorted best first
const MAX_GAS_GWEI      = 50;      // pause ALL trades if gas > 50 gwei (spike protection)
const MAX_GAS_ETH       = 0.002;
const SLIPPAGE_GUARD    = 0.85;    // min 85% of expected output

// ── AUTO GAS TOP-UP ───────────────────────────────────────────────────────────
// Native ETH is always required for gas — WETH cannot pay gas directly.
// When native ETH drops below GAS_TOPUP_THRESHOLD, auto-unwrap WETH to restore it.
// This keeps the bot trading even when all capital is held as WETH.
const GAS_TOPUP_THRESHOLD = 0.0015; // unwrap when native ETH < 0.0015 (~$3)
const GAS_TOPUP_TARGET    = 0.003;  // unwrap enough to reach 0.003 ETH (~$6)

// ── WAVE RULES ────────────────────────────────────────────────────────────────
const MIN_PEAKS_TO_TRADE   = 2;      // was 4 — start trading after just 2 confirmed peaks
const MIN_TROUGHS_TO_TRADE = 2;      // was 4 — and 2 troughs
const MIN_NET_MARGIN       = 0.005;  // was 2.5% — now 0.5% minimum: penny profits welcome
const PRIORITY_MARGIN      = 0.020;  // was 5.0% — 2% is now PRIORITY
const WAVE_MIN_MOVE        = 0.004;  // was 0.8% — detect smaller waves (0.4% move = new wave)
const WAVE_COUNT           = 8;      // track up to 8 peaks/troughs
const STOP_LOSS_PCT        = 0.03;   // 3% below MIN trough → emergency exit (tighter)
const PRICE_IMPACT_EST     = 0.002;  // 0.2% price impact estimate (more accurate for small trades)
const PROFIT_ERROR_BUFFER  = 0.002;  // 0.2% error buffer — must clear this above breakeven to sell

// ── HEARTBEAT INDICATORS ──────────────────────────────────────────────────────
const RSI_PERIOD           = 14;
const RSI_OVERSOLD         = 35;     // RSI below this = trough confirmation boost
const RSI_OVERBOUGHT       = 65;     // RSI above this = peak confirmation boost
const MACD_FAST            = 12;
const MACD_SLOW            = 26;
const MACD_SIGNAL_PERIOD   = 9;
const BB_PERIOD            = 20;
const BB_STD               = 2.0;
const MIN_READINGS_FOR_IND = 30;     // min price readings before indicators fire

// ── PORTFOLIO DRAWDOWN CIRCUIT BREAKER ───────────────────────────────────────
const DRAWDOWN_HALT_PCT    = 0.60;   // raised from 35% — at small capital sizes 35% fires on normal noise
const DRAWDOWN_RESUME_PCT  = 0.10;   // resume when recovered to within 10% of halt level

// ── PIGGY BANK & SKIM SPLIT ───────────────────────────────────────────────────
const PIGGY_SKIM_PCT       = 0.01;   // 1% per profitable sell → split 3 ways
const LOTTERY_PCT          = 0.02;   // 2% kept as forever bags
const MIN_LOTTERY_TOKENS   = 1;      // always keep at least 1 token as lottery
// But only if we have enough tokens to make it worth keeping. Positions with
// ≤5 tokens total sell 100% — keeping 1 from a 1-token position = selling nothing.
const MIN_TOKENS_FOR_LOTTERY = 5;    // below this, sell everything (no forever bag)

// Calculate how many tokens to keep as forever lottery bag
// If position is tiny (≤5 tokens), keep 0 so the sell actually works
function calcLotteryKeep(balance) {
  if (balance <= MIN_TOKENS_FOR_LOTTERY) return 0; // sell everything on tiny positions
  return Math.max(Math.floor(balance * LOTTERY_PCT), MIN_LOTTERY_TOKENS);
}
// 1% skim split equally three ways per profitable sell:
//   0.33% → lottery piggy  (locked forever — your savings)
//   0.33% → prediction fund (self-funded ML trading pool)
//   0.33% → agentic capital (AI research agent pool — Phase 3)
const SKIM_LOTTERY_SHARE   = 1/3;
const SKIM_PRED_SHARE      = 1/3;
const SKIM_AGENT_SHARE     = 1/3;

// ── PREDICTION FUND ───────────────────────────────────────────────────────────
// Trades earlier than the main bot. Enters on pre-buy, exits on pre-sell.
// Never draws from main ETH balance — only its own pool.
const PRED_FUND_MIN_CONF   = 55;     // lower than main bot — fires earlier
const PRED_FUND_MAX_ALLOC  = 0.50;   // max 50% of fund per trade
const PRED_FUND_MIN_ETH    = 0.0001; // minimum fund size to trade
const PRED_FUND_COOLDOWN   = 90_000; // 90s cooldown per token

// ── PIGGY CO-INVEST ───────────────────────────────────────────────────────────
// When pred fund enters a token, piggy also co-invests a proportional slice.
// This unlocks piggy capital into trades that have ML confirmation.
// Co-invest proceeds return to piggy on exit (never to main pool).
const PIGGY_COINVEST_PCT   = 0.10;   // deploy 10% of piggy per co-invest
const PIGGY_COINVEST_MIN   = 0.00005;// min piggy ETH needed to co-invest

// ── STALE POSITION CASCADE ────────────────────────────────────────────────────
// Philosophy: We should already be exiting on profit and re-entering at the
// lowest trough each wave. The stale cascade is the safety net — if we missed
// a predicted peak, we WILL catch the NEXT wave as long as the exit clears all
// costs with enough margin left to meaningfully compound.
//
// Wave timing: Base ecosystem tokens average 4-8 min per half-wave at 15s cycles.
// Stale window = 5 minutes = ~20 cycles of no movement. If price hasn't moved
// in 5 minutes while we're holding, we've either missed the peak or the token
// is dead — either way, free the capital for the next best wave.
//
// Profit floor = 4x all-in costs (pool fee round-trip + gas x2 + price impact)
// to ensure: covers costs (1x) + leaves a meaningful piggy split (3x overhead).
// Minimum cascade proceed = $0.05 net after all fees — no fractions below a nickel.
// This ensures every piggy skim, even at the minimum, is a real compounding unit.
const STALE_MOVE_PCT       = 0.004;  // 0.4% — matches WAVE_MIN_MOVE, anything less = sideways

// ── 🌊 RIPPLE ENGINE ─────────────────────────────────────────────────────────
// When stale positions pile up, instead of each cascading blindly one-by-one,
// the Ripple Engine coordinates them as a synchronized group:
//   1. Detects all positions that have been sideways >= RIPPLE_STALE_MS
//   2. Finds the top 1–3 active waves ready to break (RIPPLE targets)
//   3. Splits the combined stale capital evenly across those targets
//   4. All buys fire together — one ripple, amplified entry
//   5. When KAHUNA detected on a target: ALL stale capital floods into it
//   6. Algorithm logs every ripple pattern to waveStats for future learning
const RIPPLE_STALE_MS      = 7 * 60_000;  // 7min stale threshold to enter ripple pool
const RIPPLE_MAX_SOURCES   = 6;           // max stale positions to pool at once
const RIPPLE_MAX_TARGETS   = 3;           // deploy into top 1-3 active waves
const RIPPLE_SELL_PCT      = 0.33;        // sell 1/3 of each stale position — keep 2/3 riding
const RIPPLE_COOLDOWN_MS   = 15 * 60_000; // 15min before same source can ripple again
const RIPPLE_KAHUNA_THRESH = 6;           // kahuna intensity >= 6 triggers full flood mode
const rippleCooldown       = {};          // { symbol: lastRippleTime }
const rippleLog            = [];          // history of ripple patterns for AI learning
const STALE_WINDOW_MS      = 5 * 60_000;  // 5 min — ~1 wave cycle on Base. Don't sit.
const STALE_SELL_PCT       = 0.50;   // sell 50%: keep half riding in case it wakes up
const STALE_MIN_USD        = 0.20;   // low bar — even a small position cascades if profitable
const STALE_COOLDOWN_MS    = 10 * 60_000; // 10min cooldown — allows ~2 wave cycles before retriggering
// Profit floor for stale cascade: must net at least 4x estimated round-trip cost
// (pool fee 0.6% x2 + gas x2 + 0.4% impact x2 = ~2%) → 4x = ~8% gross needed,
// but at small capital levels we just check absolute $: net ≥ $0.05 after fees.
const STALE_MIN_NET_USD    = 0.05;   // nickel minimum net profit — real compounding starts here


// ══════════════════════════════════════════════════════════════════════════════
// 🛡️  GUARDIAN SCORE SYSTEM
// Each token rated 1-10 across 5 dimensions. Score drives position sizing.
// ──────────────────────────────────────────────────────────────────────────────
// LIQUIDITY    — how deep the pool is, how easy to enter/exit small positions
// WAVE_QUALITY — how clean/regular the wave patterns are (backtested)
// FUNDAMENTALS — real utility, team, roadmap, not just hype
// COINBASE_FIT — alignment with Coinbase/Base ecosystem (fast-track listing signal)
// COMMUNITY    — holder count, social activity, organic growth
//
// TOTAL /50 → tier:
//   40-50 = ALPHA  — max position, priority buys, cascade target
//   30-39 = SOLID  — standard position, normal buy sizing
//   20-29 = SCOUT  — smaller position, learning waves, growing conviction
//   10-19 = WATCH  — price data only, not trading yet
// ══════════════════════════════════════════════════════════════════════════════

// ── PORTFOLIO ─────────────────────────────────────────────────────────────────
const DEFAULT_TOKENS = [

  // ── TIER 1: ALPHA (40-50) ─────────────────────────────────────────────────
  // These are the horses. Deep liquidity, clean waves, real fundamentals.

  { symbol: "AERO",    address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631", feeTier: 3000,  poolFeePct: 0.006, minNetMargin: MIN_NET_MARGIN,
    score: { liquidity:9, waveQuality:9, fundamentals:8, coinbaseFit:10, community:8, total:44 },
    notes: "Aerodrome — the DEX backbone of Base. Coinbase's own liquidity hub. Deep pool, clean waves, real revenue from fees. Crown jewel of Base." },

  { symbol: "BRETT",   address: "0x532f27101965dd16442E59d40670FaF5eBB142E4", feeTier: 3000,  poolFeePct: 0.006, minNetMargin: MIN_NET_MARGIN,
    score: { liquidity:8, waveQuality:9, fundamentals:6, coinbaseFit:9, community:9, total:41 },
    notes: "Base OG meme king. 90d range $0.006-$0.021, massive wave amplitude. 8P/8T perfect history. Culture token — won't die." },

  { symbol: "VIRTUAL", address: "0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b", feeTier: 3000,  poolFeePct: 0.006, minNetMargin: MIN_NET_MARGIN,
    score: { liquidity:8, waveQuality:8, fundamentals:9, coinbaseFit:9, community:8, total:42 },
    notes: "AI agent tokenization protocol on Base. Real infrastructure play. AIXBT born from this. Every new AI agent = more demand for VIRTUAL." },

  { symbol: "MORPHO",  address: "0xBAa5CC21fd487B8Fcc2F632f8F4e4b1E7a67bA9f", feeTier: 3000,  poolFeePct: 0.006, minNetMargin: MIN_NET_MARGIN,
    score: { liquidity:7, waveQuality:7, fundamentals:10, coinbaseFit:10, community:7, total:41 },
    notes: "PROMOTED FROM WATCHLIST. Coinbase chose Morpho for their $1B+ lending product on Base. Real yield, real revenue, Coinbase-native. This is infrastructure." },

  { symbol: "CBBTC",   address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", feeTier: 3000,  poolFeePct: 0.006, minNetMargin: MIN_NET_MARGIN,
    score: { liquidity:9, waveQuality:8, fundamentals:10, coinbaseFit:10, community:8, total:45 },
    notes: "PROMOTED FROM WATCHLIST. Coinbase-issued BTC on Base. Follows BTC cycles exactly. Maximum trust. Waves ride BTC momentum. Long-term anchor asset." },

  // ── TIER 2: SOLID (30-39) ─────────────────────────────────────────────────

  { symbol: "DEGEN",   address: "0x4ed4e862860bed51a9570b96d89af5e1b0efefed", feeTier: 3000,  poolFeePct: 0.006, minNetMargin: MIN_NET_MARGIN,
    score: { liquidity:8, waveQuality:8, fundamentals:6, coinbaseFit:8, community:9, total:39 },
    notes: "Farcaster culture token. Deep community, strong Base ties, consistent wave patterns. One of the original Base memes with staying power." },

  { symbol: "WELL",    address: "0xA88594D404727625A9437C3f886C7643872296AE", feeTier: 3000,  poolFeePct: 0.006, minNetMargin: MIN_NET_MARGIN,
    disabled: true, disabledReason: "Primary liquidity on Aerodrome not Uniswap V3 — swaps revert",
    score: { liquidity:7, waveQuality:7, fundamentals:8, coinbaseFit:8, community:7, total:37 },
    notes: "Moonwell — largest Base-native DeFi lending protocol. Real yield, governance value, solid TVL. Moonbeam ecosystem bridge." },

  { symbol: "SEAM",    address: "0x1C7a460413dD4e964f96D8dFC56E7223cE88CD85", feeTier: 3000,  poolFeePct: 0.006, minNetMargin: MIN_NET_MARGIN,
    score: { liquidity:6, waveQuality:7, fundamentals:7, coinbaseFit:7, community:6, total:33 },
    notes: "Seamless Protocol — Base DeFi lending. Competes with Moonwell. Clean wave structure, consistent volume." },

  { symbol: "AIXBT",   address: "0x4F9Fd6Be4a90f2620860d680c0d4d5Fb53d1A825", feeTier: 10000, poolFeePct: 0.010, minNetMargin: 0.015,
    score: { liquidity:7, waveQuality:8, fundamentals:7, coinbaseFit:8, community:8, total:38 },
    notes: "AI trading agent born from Virtuals. Strong brand, cult following, real product. Volatile but predictable waves." },

  { symbol: "TOSHI",   address: "0xAC1Bd2486aAf3B5C0fc3Fd868558b082a531B2B4", feeTier: 10000, poolFeePct: 0.010, minNetMargin: 0.010,
    score: { liquidity:6, waveQuality:7, fundamentals:5, coinbaseFit:8, community:8, total:34 },
    notes: "Coinbase CEO Brian Armstrong's cat. Base meme with maximum Coinbase cultural alignment. 900k+ holders." },

  { symbol: "KITE",    address: "0x45a8B3bE0D9e3CAFf4325B0bddD786B9B56B3Ca8", feeTier: 10000, poolFeePct: 0.010, minNetMargin: 0.008,
    score: { liquidity:5, waveQuality:5, fundamentals:8, coinbaseFit:8, community:6, total:32 },
    notes: "gokite.ai — AI infrastructure on Base. Coinbase listed. User holds at ~$0.30. Learning waves now. AI sector tailwind." },

  // ── TIER 3: SCOUT (20-29) ─────────────────────────────────────────────────
  // Smaller bets. Learning the wave. Building conviction with real data.

  { symbol: "KEYCAT",  address: "0x9a26f5433671751c3276a065f57e5a02d2817973", feeTier: 10000, poolFeePct: 0.010, minNetMargin: 0.008,
    score: { liquidity:5, waveQuality:6, fundamentals:4, coinbaseFit:7, community:7, total:29 },
    notes: "Keyboard Cat — Base OG meme. 900k+ holders, Coinbase listed. Wave learning in progress." },

  { symbol: "DOGINME", address: "0x6921B130D297cc43754afba22e5EAc0FBf8Db75b", feeTier: 10000, poolFeePct: 0.010, minNetMargin: 0.008,
    score: { liquidity:5, waveQuality:6, fundamentals:4, coinbaseFit:6, community:8, total:29 },
    notes: "Farcaster-born Base meme. 220k+ holders, $1.8M liquidity. Strong community narrative." },

  { symbol: "XCN",     address: "0x9c632e6aaa3ea73f91554f8a3cb2ed2f29605e0c", feeTier: 10000, poolFeePct: 0.010, minNetMargin: 0.008,
    score: { liquidity:5, waveQuality:5, fundamentals:6, coinbaseFit:7, community:5, total:28 },
    notes: "Onyx Protocol — L3 governance + gas token. Coinbase listed, real utility for chain operations." },

  { symbol: "SKI",     address: "0x768BE13e1680b5ebE0024C42c896E3dB59ec0149", feeTier: 10000, poolFeePct: 0.010, minNetMargin: 0.008,
    score: { liquidity:5, waveQuality:5, fundamentals:4, coinbaseFit:6, community:7, total:27 },
    notes: "Ski Mask Dog — Base meme culture. Consistent trading volume, solid community. Scout tier." },

  // ── TIER 2 NEW ENTRIES ────────────────────────────────────────────────────
  // Fresh blood with strong Base fundamentals. Learning waves from day 1.

  { symbol: "PRIME",   address: "0xfA980cEd6895AC314E7dE34Ef1bFAE90a5AdD21b", feeTier: 3000,  poolFeePct: 0.006, minNetMargin: MIN_NET_MARGIN,
    score: { liquidity:7, waveQuality:7, fundamentals:8, coinbaseFit:7, community:8, total:37 },
    notes: "Echelon Prime — Web3 gaming infrastructure. Real game integrations, growing ecosystem, Base native. Gaming + crypto narrative is heating up." },

  { symbol: "LUNA",    address: "0x55cD6469F597452B5A7536e2CD98fB4297d4a3F7", feeTier: 10000, poolFeePct: 0.010, minNetMargin: 0.008,
    score: { liquidity:6, waveQuality:7, fundamentals:7, coinbaseFit:8, community:8, total:36 },
    notes: "Luna by Virtuals — AI agent from the Virtuals ecosystem. $166M market cap. Sister token to AIXBT. AI agent narrative play." },

  { symbol: "HIGHER",  address: "0x0578d8A44db98B23BF096A382e016e29a5Ce0ffe", feeTier: 10000, poolFeePct: 0.010, minNetMargin: 0.008,
    score: { liquidity:6, waveQuality:6, fundamentals:5, coinbaseFit:7, community:9, total:33 },
    notes: "HIGHER — Farcaster culture token. One of the most organic Base communities. Meme with mission. Clean wave candidate." },

  { symbol: "MOCHI",   address: "0xF6e932Ca12afa26665dC4dDE7e27be02A6C8e14", feeTier: 10000, poolFeePct: 0.010, minNetMargin: 0.008,
    score: { liquidity:5, waveQuality:6, fundamentals:5, coinbaseFit:7, community:7, total:30 },
    notes: "Mochi — Base meme cat. Strong community, Coinbase ecosystem alignment. Scout position." },

  // ── BATCH 2 — Added 2026-03-13 ─────────────────────────────────────────────
  { symbol: "ZORA",    address: "0x1111111111166b7FE7bd91427724B487980aFc69", feeTier: 3000,  poolFeePct: 0.006, minNetMargin: MIN_NET_MARGIN,
    score: { liquidity:9, waveQuality:7, fundamentals:8, coinbaseFit:9, community:9, total:42 },
    notes: "Zora platform token. Coinbase Wallet integrated July 2025. $11.5M V3 liquidity, $2.7M daily vol, 1.07M holders. Real flywheel: more creators = more fees = more ZORA demand." },

  { symbol: "BNKR",    address: "0x22aF33FE49fD1Fa80c7149773dDe5890D3c76F3b", feeTier: 10000, poolFeePct: 0.010, minNetMargin: 0.008,
    score: { liquidity:8, waveQuality:7, fundamentals:8, coinbaseFit:8, community:8, total:39 },
    notes: "BankrCoin. First AI trading agent on Farcaster. Backed by Coinbase Ventures. 90% of swap revenue to stakers. $2.69M V3 liquidity, 227K holders." },

  { symbol: "TYBG",    address: "0x0d97F261b1e88845184f678e2d1e7a98D9FD38dE", feeTier: 10000, poolFeePct: 0.010, minNetMargin: 0.008,
    score: { liquidity:6, waveQuality:7, fundamentals:5, coinbaseFit:7, community:8, total:33 },
    notes: "TYBG (To Be Genuine). Base OG culture token. $287K V3 liquidity, $70K daily vol. 10+ months of V3 wave data." },

  { symbol: "MIGGLES", address: "0xb1a03edA10342529bBf8EB700a06C60441feF25d", feeTier: 10000, poolFeePct: 0.010, minNetMargin: 0.010,
    score: { liquidity:7, waveQuality:6, fundamentals:6, coinbaseFit:9, community:8, total:36 },
    notes: "Mister Miggles. IP licensed directly from Coinbase to purrLabs. $307K V3 liquidity, 448K holders. Max CB cultural alignment." },

  // BALD removed — original Base meme but V3 pool is dead/dry, no price returns.
  // Re-add if liquidity recovers. Address was 0x27D2DECb4bFC9C76F0309b8E88dec3a601Fe25a8


  { symbol: "BENJI",   address: "0xBC45647eA894030a4E9801Ec03479739FA2485F0", feeTier: 10000, poolFeePct: 0.010, minNetMargin: 0.010,
    score: { liquidity:5, waveQuality:6, fundamentals:5, coinbaseFit:6, community:7, total:29 },
    notes: "Basenji - Base dog meme, OG community token. Scout tier." },

  { symbol: "ROOST",   address: "0xeD899bfDB28c8ad65307Fa40f4acAB113AE2E14c", feeTier: 10000, poolFeePct: 0.010, minNetMargin: 0.010,
    score: { liquidity:5, waveQuality:6, fundamentals:5, coinbaseFit:6, community:7, total:29 },
    notes: "Roost Coin - OG Base culture meme. Fixed address (prev wrong). Scout tier." },

  { symbol: "TALENT",  address: "0x9a33406165f562E16C3abD82fd1185482E01b49a", feeTier: 3000,  poolFeePct: 0.006, minNetMargin: MIN_NET_MARGIN,
    score: { liquidity:6, waveQuality:6, fundamentals:7, coinbaseFit:7, community:7, total:33 },
    notes: "Talent Protocol - onchain reputation infrastructure on Base. Coinbase aligned. Official contract confirmed. Scout tier." },

  // ── 10 NEW ACTIVE HIGH-VOLUME BASE TOKENS ────────────────────────────────
  { symbol: "MOG",     address: "0x2Da56AcB9Ea78330f947bD57C54119Debda7AF71", feeTier: 3000,  poolFeePct: 0.006, minNetMargin: 0.010,
    score: { liquidity:8, waveQuality:8, fundamentals:6, coinbaseFit:7, community:9, total:38 },
    notes: "Mog Coin — top Base meme by volume. 0.3% pool, high liquidity, waves very clean. Coinbase listing drove major volume." },

  { symbol: "TOBY",    address: "0xb8d98a102b0079B69FFbc760C8d857A31653e56e", feeTier: 10000, poolFeePct: 0.010, minNetMargin: 0.012,
    score: { liquidity:7, waveQuality:7, fundamentals:5, coinbaseFit:6, community:8, total:33 },
    notes: "Toby the cat — viral Base cat meme. Strong holder base, consistent wave patterns." },

  { symbol: "GAME",    address: "0x1C4CcA7C5DB003824208aDDA61Bd749e55F463a3", feeTier: 3000,  poolFeePct: 0.006, minNetMargin: 0.010,
    score: { liquidity:7, waveQuality:7, fundamentals:8, coinbaseFit:8, community:7, total:37 },
    notes: "GAME by Virtuals — AI gaming agent infra. Same ecosystem as VIRTUAL/AIXBT. Real project with revenue." },

  { symbol: "SIMBA",   address: "0x2416092f143378750bb29b79eD961ab195CcEea5", feeTier: 10000, poolFeePct: 0.010, minNetMargin: 0.012,
    score: { liquidity:6, waveQuality:7, fundamentals:6, coinbaseFit:6, community:7, total:32 },
    notes: "SIMBA by Virtuals — AI agent, Virtuals ecosystem. Follows VIRTUAL/AIXBT macro." },

  { symbol: "CRASH",   address: "0x4D4ab5C580aa3bCBF45B6C3B9B8d0765b74b1C3b", feeTier: 10000, poolFeePct: 0.010, minNetMargin: 0.015,
    score: { liquidity:6, waveQuality:6, fundamentals:5, coinbaseFit:5, community:7, total:29 },
    notes: "Crash — active momentum token, high percentage moves." },

  { symbol: "BASE",    address: "0xd07379a755A8f11B57610154861D694b2A0f615a", feeTier: 10000, poolFeePct: 0.010, minNetMargin: 0.012,
    score: { liquidity:7, waveQuality:7, fundamentals:6, coinbaseFit:9, community:7, total:36 },
    notes: "BASE token — ecosystem identity play. Coinbase aligned, consistent wave behavior." },

  { symbol: "BRIUN",   address: "0x6b4712AE9797C199edd44F897cA09BC57628a1CF", feeTier: 10000, poolFeePct: 0.010, minNetMargin: 0.012,
    score: { liquidity:6, waveQuality:6, fundamentals:5, coinbaseFit:7, community:8, total:32 },
    notes: "BRIUN — Brian Armstrong meme. Active Base community, volatile waves." },

  { symbol: "NORMIE",  address: "0x7F12d13B34F5F4f0a9449c89bC4c1f764c5D927D", feeTier: 10000, poolFeePct: 0.010, minNetMargin: 0.015,
    score: { liquidity:6, waveQuality:6, fundamentals:5, coinbaseFit:6, community:7, total:30 },
    notes: "NORMIE — relaunched post-exploit with new contract. Active trading on Base." },

  { symbol: "OGGY",    address: "0x28561B8A2360F463011c16b6Cc0B176e0E4aA254", feeTier: 10000, poolFeePct: 0.010, minNetMargin: 0.015,
    score: { liquidity:6, waveQuality:7, fundamentals:5, coinbaseFit:6, community:7, total:31 },
    notes: "Oggy — Base meme with consistent wave patterns and volume." },

  { symbol: "FREN",    address: "0x12E2E7A15Ac53ca87bC0693F625c1FE49B4c8dE6", feeTier: 10000, poolFeePct: 0.010, minNetMargin: 0.012,
    score: { liquidity:6, waveQuality:6, fundamentals:5, coinbaseFit:6, community:8, total:31 },
    notes: "FREN — community meme on Base with active trading." },
];

// ══════════════════════════════════════════════════════════════════════════════
// 🔭 WATCHLIST — Future pipeline. Guardian learns prices, never trades.
// Promotion path: WATCHLIST → SCOUT tier → SOLID tier → ALPHA tier
// ══════════════════════════════════════════════════════════════════════════════
const WATCHLIST = [
  // ── READY TO PROMOTE (5 stars = next deploy adds to active) ───────────────
  {
    symbol: "CLANKER", address: "0x1d008f50fb828ef9debbbeae1b71fffe929bf317",
    stars: 2, status: "fee_model_wrong",
    score: { liquidity:4, waveQuality:6, fundamentals:7, coinbaseFit:8, community:6, total:31 },
    reason: "High fee tier eats all margin at current capital. Viable ONLY with validator/verifier income from fiber node. Revisit when running infrastructure node.",
    entryPlan: "Promote when running fiber node validator. Fee income offsets pool cost.",
    redFlags: ["1% fee tier kills margin sub-$500", "Needs verifier role income"],
    greenFlags: ["Strong Base ecosystem", "Real utility", "Coinbase aligned", "Growing volume"],
    addedDate: "2026-03-12",
  },

  // ── WATCHING — learning patterns, evaluating fundamentals ─────────────────
  {
    symbol: "RSR",     address: "0xaB36452DbAC151bE02b16Ca17d8919826072f64a",
    stars: 4, status: "watching",
    score: { liquidity:7, waveQuality:7, fundamentals:8, coinbaseFit:8, community:7, total:37 },
    reason: "Reserve Rights — governance token for Base-native stablecoin protocol. Real DeFi utility. Watching wave patterns before committing capital.",
    entryPlan: "Promote to SOLID tier when 4P/4T wave pattern established.",
    redFlags: ["Regulatory gray area for stablecoin governance tokens"],
    greenFlags: ["Real protocol revenue", "Base native", "Growing TVL", "Coinbase listed"],
    addedDate: "2026-03-12",
  },
  {
    symbol: "ODOS",    address: "0xca73ed1815e5915489570014e024b7EbE65dE679",
    stars: 3, status: "watching",
    score: { liquidity:6, waveQuality:6, fundamentals:8, coinbaseFit:7, community:5, total:32 },
    reason: "ODOS — DEX aggregator on Base. Finds best swap routes. Real utility, used by power users. Learning wave patterns.",
    entryPlan: "Promote to SCOUT when liquidity depth confirmed and 2P/2T established.",
    redFlags: ["Lower community visibility vs memes", "Needs liquidity depth check"],
    greenFlags: ["Real utility — route optimization", "Used by DeFi power users", "Growing Base volume"],
    addedDate: "2026-03-12",
  },
  {
    symbol: "IMAGINE", address: "0x078D888E40faAe0f32594342c85940AF3949E666",
    stars: 3, status: "watching",
    score: { liquidity:4, waveQuality:5, fundamentals:7, coinbaseFit:8, community:7, total:31 },
    reason: "AI image generation on Base. Early stage but strong Coinbase ecosystem fit. Watching for liquidity growth.",
    entryPlan: "Promote when pool depth >$500k and 3P/3T wave confirmed.",
    redFlags: ["Early stage", "Thinner liquidity", "High risk"],
    greenFlags: ["AI narrative", "Base native", "Coinbase ecosystem"],
    addedDate: "2026-03-12",
  },

  // ── FUTURE IDEAS — long-term vision tokens ─────────────────────────────────
  {
    symbol: "CBETH",   address: "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22",
    stars: 5, status: "waiting_capital",
    score: { liquidity:8, waveQuality:7, fundamentals:10, coinbaseFit:10, community:7, total:42 },
    reason: "Coinbase Staked ETH. The safest yield asset on Base. ETH staking yield + price appreciation. Perfect long-term hold. Needs larger capital base to get meaningful position.",
    entryPlan: "Promote to ALPHA when wallet >$500 tradeable. This is a forever hold candidate.",
    redFlags: ["High price per token — needs capital"],
    greenFlags: ["Coinbase issued — maximum trust", "ETH staking yield baked in", "Follows ETH + earns staking rewards", "Perfect piggy bank long term"],
    addedDate: "2026-03-12",
  },

  // ── IDEA VAULT — tokens that represent Guardian's future thesis ────────────
  // Not trading, not watching prices yet. Just logging the vision.
  {
    symbol: "FIBER_NODE_PLAY", address: "PENDING",
    stars: 5, status: "thesis",
    score: null,
    reason: "When Guardian earns enough to run a 1G/10G fiber validator node — the validator/verifier income becomes a revenue stream that feeds back into trading. Makes CLANKER viable. Makes Guardian self-propagating. This is the 'Revenue Loop' thesis: trade profits → node infrastructure → node income → larger trades → bigger infrastructure. The loop compounds.",
    entryPlan: "When wallet > $5000 tradeable: evaluate running a Base validator node. Income from validation subsidizes higher-fee pools like CLANKER.",
    redFlags: [],
    greenFlags: ["Self-propagating revenue loop", "Accountability is king", "Infrastructure as moat"],
    addedDate: "2026-03-12",
  },
];

// ── WATCHLIST PRICE TRACKER (in-memory, not traded) ──────────────────────────
const watchPrices = {}; // symbol → { prices[], peaks[], troughs[], lastPrice }

async function updateWatchlistPrices() {
  for (const w of WATCHLIST) {
    try {
      const price = await getTokenPrice(w.address);
      if (!price || price <= 0) continue;
      if (!watchPrices[w.symbol]) watchPrices[w.symbol] = { prices: [], peaks: [], troughs: [], high24h: 0, low24h: Infinity };
      const wp = watchPrices[w.symbol];
      wp.prices.push({ price, time: Date.now() });
      if (wp.prices.length > 200) wp.prices.shift(); // keep last 200 readings
      wp.lastPrice = price;
      wp.high24h = Math.max(wp.high24h, price);
      wp.low24h  = Math.min(wp.low24h,  price);
    } catch { /* silent — watchlist never crashes main loop */ }
  }
}

// ── GITHUB ────────────────────────────────────────────────────────────────────
const GITHUB_TOKEN  = process.env.GITHUB_TOKEN;
const GITHUB_REPO   = process.env.GITHUB_REPO;
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || "main";
const STATE_BRANCH  = process.env.STATE_BRANCH  || process.env.GITHUB_BRANCH || "bot-state"; // separate branch for state saves — prevents Railway re-deploy

const ERC20_ABI = [
  { name: "balanceOf", type: "function", stateMutability: "view",
    inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { name: "allowance", type: "function", stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }],
    outputs: [{ name: "", type: "uint256" }] },
];

// ── RPC ROTATION ──────────────────────────────────────────────────────────────
const RPC_URLS = [
  "https://mainnet.base.org",          // Coinbase official — most reliable
  "https://base.llamarpc.com",          // LlamaNodes — high rate limit
  "https://base-rpc.publicnode.com",    // PublicNode — reliable
  "https://base.drpc.org",              // dRPC — good free tier
  "https://base.meowrpc.com",           // MeowRPC — fast Base node
  "https://base-pokt.nodies.app",       // Nodies — decentralized
  "https://gateway.tenderly.co/public/base", // Tenderly public
];
let rpcIndex = 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));
function getClient() {
  return createPublicClient({ chain: base, transport: http(RPC_URLS[rpcIndex % RPC_URLS.length]) });
}
const rpcCooldowns = {}; // track when each RPC last failed
function nextRpc() {
  rpcCooldowns[rpcIndex] = Date.now(); // mark this RPC as recently failed
  // Find next RPC that's not in cooldown (>30s ago)
  for (let i = 1; i <= RPC_URLS.length; i++) {
    const candidate = (rpcIndex + i) % RPC_URLS.length;
    const lastFail = rpcCooldowns[candidate] || 0;
    if (Date.now() - lastFail > 30000) { // 30s cooldown per RPC
      rpcIndex = candidate;
      return;
    }
  }
  // All in cooldown — use the one that's been coolest the longest
  rpcIndex = (rpcIndex + 1) % RPC_URLS.length;
}
async function rpcCall(fn) {
  for (let i = 0; i < RPC_URLS.length; i++) {
    try {
      // 6s timeout per RPC call — prevents silent hangs from locking the bot.
      // Public Base RPC nodes (publicnode, llamarpc) occasionally stall indefinitely.
      // Without this, getTokenBalance/getGasPrice hang inside processToken and burn
      // the full 12s processToken timeout on EVERY token, every loop.
      const result = await Promise.race([
        fn(getClient()),
        new Promise((_, reject) => setTimeout(() => reject(new Error("rpc timeout 6s")), 6000))
      ]);
      return result;
    }
    catch (e) {
      const msg = (e.message || "").toLowerCase();
      const isQuota = msg.includes("429") || msg.includes("rate limit") ||
                      msg.includes("over rate") || msg.includes("rpc timeout") ||
                      msg.includes("quota") || msg.includes("exceeded") ||
                      msg.includes("resource not found") || msg.includes("too many") ||
                      msg.includes("unavailable") || msg.includes("502") || msg.includes("503");
      if (isQuota) {
        nextRpc(); await sleep(400); // rotate to next RPC
      } else throw e;
    }
  }
  throw new Error("All RPCs unavailable");
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🔍 ON-CHAIN QUOTE — gets real pool price before every sell
// Prevents "execution reverted" from stale cached prices setting minWeth too high
// ═══════════════════════════════════════════════════════════════════════════════
async function getOnChainSellQuote(tokenAddress, amountIn, feeTier) {
  try {
    const result = await rpcCall(c => c.simulateContract({
      address: QUOTER_V2,
      abi: QUOTER_ABI,
      functionName: "quoteExactInputSingle",
      args: [{ tokenIn: tokenAddress, tokenOut: WETH_ADDRESS, amountIn, fee: feeTier, sqrtPriceLimitX96: 0n }]
    }));
    return result.result[0]; // amountOut in WETH wei
  } catch (e) {
    console.log(`   ⚠️  On-chain quote failed: ${e.message?.slice(0,60)} — using cached price with wider slippage`);
    return null;
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// 💰 LIVE ETH PRICE — replaces hardcoded ETH_USD = 1940
// ═══════════════════════════════════════════════════════════════════════════════
let cachedEthUsd   = 3500;   // safe fallback — will be overwritten immediately
let ethPriceLastFetch = 0;

async function getLiveEthPrice() {
  if (Date.now() - ethPriceLastFetch < ETH_PRICE_TTL) return cachedEthUsd;
  try {
    // Primary: GeckoTerminal WETH/USDC on Base
    const r = await fetch("https://api.geckoterminal.com/api/v2/simple/networks/base/token_price/0x4200000000000000000000000000000000000006");
    const d = await r.json();
    const p = parseFloat(d?.data?.attributes?.token_prices?.["0x4200000000000000000000000000000000000006"]);
    if (!isNaN(p) && p > 100) {
      cachedEthUsd = p;
      ethPriceLastFetch = Date.now();
      return cachedEthUsd;
    }
  } catch {}
  try {
    // Fallback: CoinGecko
    const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd");
    const d = await r.json();
    const p = d?.ethereum?.usd;
    if (p && p > 100) {
      cachedEthUsd = p;
      ethPriceLastFetch = Date.now();
      return cachedEthUsd;
    }
  } catch {}
  console.log(`⚠️  ETH price fetch failed — using cached $${cachedEthUsd}`);
  return cachedEthUsd;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ⛽ GAS SPIKE PROTECTION
// ═══════════════════════════════════════════════════════════════════════════════
async function getCurrentGasGwei() {
  try {
    const gasPrice = await rpcCall(c => c.getGasPrice());
    return Number(gasPrice) / 1e9;
  } catch { return 10; }
}

async function isGasSafe() {
  const gwei = await getCurrentGasGwei();
  if (gwei > MAX_GAS_GWEI) {
    console.log(`⛽ GAS SPIKE: ${gwei.toFixed(1)} gwei > ${MAX_GAS_GWEI} max — pausing trades`);
    return false;
  }
  return true;
}

let cachedGasCostEth   = 0.0001;
let gasCostLastFetch   = 0;
const GAS_COST_TTL     = 30_000; // refresh gas estimate every 30s — not per-token

async function estimateGasCostEth() {
  if (Date.now() - gasCostLastFetch < GAS_COST_TTL) return cachedGasCostEth;
  try {
    const gasPrice = await rpcCall(c => c.getGasPrice());
    // FIX: Use 300_000 gas units to match the GAS_CEILING used in actual swap transactions.
    // Previous 220_000 underestimated gas cost → net margin looked better → bad trades passed the gate.
    cachedGasCostEth   = Number(gasPrice * BigInt(300_000)) / 1e18;
    gasCostLastFetch   = Date.now();
    return cachedGasCostEth;
  } catch { return cachedGasCostEth; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 💓 HEARTBEAT INDICATOR ENGINE
// Calculates RSI, MACD, Bollinger Bands from stored price readings
// ═══════════════════════════════════════════════════════════════════════════════
function calcRSI(prices, period = RSI_PERIOD) {
  if (prices.length < period + 1) return null;
  const recent = prices.slice(-(period * 3)); // use last 3x period for accuracy
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = recent[recent.length - i] - recent[recent.length - i - 1];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  if (losses === 0) return 100;
  const rs = (gains / period) / (losses / period);
  return 100 - (100 / (1 + rs));
}

function calcEMA(prices, period) {
  if (prices.length < period) return null;
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
}

function calcMACD(prices) {
  if (prices.length < MACD_SLOW + MACD_SIGNAL_PERIOD) return null;
  // Calculate MACD line at each point for signal line
  const macdLine = [];
  for (let i = MACD_SLOW; i <= prices.length; i++) {
    const slice = prices.slice(0, i);
    const fast  = calcEMA(slice, MACD_FAST);
    const slow  = calcEMA(slice, MACD_SLOW);
    if (fast !== null && slow !== null) macdLine.push(fast - slow);
  }
  if (macdLine.length < MACD_SIGNAL_PERIOD) return null;
  const signalLine = calcEMA(macdLine, MACD_SIGNAL_PERIOD);
  const histogram  = macdLine[macdLine.length - 1] - signalLine;
  const prevHist   = macdLine.length > 1
    ? macdLine[macdLine.length - 2] - calcEMA(macdLine.slice(0, -1), MACD_SIGNAL_PERIOD)
    : histogram;
  return {
    macd:       macdLine[macdLine.length - 1],
    signal:     signalLine,
    histogram,
    prevHist,
    bullish:    histogram > 0,
    expanding:  Math.abs(histogram) > Math.abs(prevHist),
    crossUp:    histogram > 0 && prevHist <= 0,  // just crossed bullish
    crossDown:  histogram < 0 && prevHist >= 0,  // just crossed bearish
  };
}

function calcBollingerBands(prices, period = BB_PERIOD) {
  if (prices.length < period) return null;
  const recent = prices.slice(-period);
  const mean   = recent.reduce((a, b) => a + b, 0) / period;
  const variance = recent.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
  const std    = Math.sqrt(variance);
  return {
    upper:   mean + BB_STD * std,
    mid:     mean,
    lower:   mean - BB_STD * std,
    pctB:    (prices[prices.length - 1] - (mean - BB_STD * std)) / (BB_STD * 2 * std),
    squeeze: std / mean < 0.015, // bands very tight = breakout imminent
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🧠 GUARDIAN PREDICTION ENGINE — v1.0
// Ehlers Hilbert Transform Dominant Cycle + Confidence Scoring
// ───────────────────────────────────────────────────────────────────────────────
// HOW IT WORKS:
//   1. Ehlers Hilbert Transform — measures the dominant market cycle period
//   2. Cycle Phase (0–360°) — WHERE in the cycle we currently are
//   3. Cycle vs Trend Mode — prevents false signals in strong trends
//   4. Predicted Next Peak/Trough — extrapolates BEFORE the turn happens
//   5. Dissimilarity Index (DI) — outlier detector: flags unprecedented territory
//   6. Confidence Score (0–100) — gates prediction-driven trades
// ═══════════════════════════════════════════════════════════════════════════════

const EHLERS_MIN_BARS       = 12;
const EHLERS_MAX_PERIOD     = 50;
const EHLERS_MIN_PERIOD     = 6;
const CYCLE_MODE_THRESHOLD  = 0.6;
const PRED_CONFIDENCE_BUY   = 60;
const PRED_CONFIDENCE_SELL  = 65;
const DI_OUTLIER_THRESHOLD  = 2.5;

const cycleState = {};

function initCycleState(symbol) {
  if (!cycleState[symbol]) {
    cycleState[symbol] = {
      cyclePhase: 0, cyclePeriod: 15, cycleMode: false,
      confidence: 0, predictedPeak: null, predictedTrough: null,
      barsToTurn: null, diScore: 0, lastUpdated: 0,
    };
  }
  return cycleState[symbol];
}

function ehlersDominantCycle(prices) {
  const n = prices.length;
  if (n < EHLERS_MIN_BARS) return null;

  const p   = prices.slice(-Math.min(n, 100));
  const len = p.length;

  const smooth     = new Array(len).fill(0);
  const detrender  = new Array(len).fill(0);
  const inPhase    = new Array(len).fill(0);
  const quadrature = new Array(len).fill(0);
  const phase      = new Array(len).fill(0);
  const deltaPhase = new Array(len).fill(0);
  const medDelta   = new Array(len).fill(0);
  const dcPeriod   = new Array(len).fill(15);

  const a1 = 0.0962;
  const a2 = 0.5769;

  for (let i = 6; i < len; i++) {
    smooth[i]     = (4*p[i] + 3*p[i-1] + 2*p[i-2] + p[i-3]) / 10;
    detrender[i]  = (a1*smooth[i] + a2*smooth[i-2] - a2*smooth[i-4] - a1*smooth[i-6]) * (0.075*dcPeriod[i-1] + 0.54);
    inPhase[i]    = 1.25*(detrender[i-4] - a1*detrender[i-2]) + a1*inPhase[Math.max(0,i-3)];
    quadrature[i] = detrender[i-2] - a2*detrender[i] + a2*quadrature[Math.max(0,i-2)];

    if (Math.abs(inPhase[i]) > 1e-10) {
      phase[i] = Math.atan(quadrature[i] / inPhase[i]) * (180 / Math.PI);
    } else {
      phase[i] = phase[i-1];
    }
    if (inPhase[i] < 0 && quadrature[i] > 0) phase[i] += 180;
    if (inPhase[i] < 0 && quadrature[i] < 0) phase[i] -= 180;
    if (inPhase[i] > 0 && quadrature[i] < 0) phase[i] += 360;

    deltaPhase[i] = phase[i-1] - phase[i];
    if (deltaPhase[i] < 1.0) deltaPhase[i] = 1.0;
    if (deltaPhase[i] > 60)  deltaPhase[i] = 60;

    const win = [
      deltaPhase[i], deltaPhase[i-1], deltaPhase[i-2],
      deltaPhase[Math.max(0,i-3)], deltaPhase[Math.max(0,i-4)]
    ].sort((a,b)=>a-b);
    medDelta[i] = win[2];

    let instPeriod = 0, phaseSum = 0;
    for (let j = 0; j <= 40 && j <= i; j++) {
      phaseSum += medDelta[i - j];
      if (phaseSum > 360 && instPeriod === 0) { instPeriod = j; break; }
    }
    if (instPeriod === 0) instPeriod = dcPeriod[i-1];
    instPeriod = Math.max(EHLERS_MIN_PERIOD, Math.min(EHLERS_MAX_PERIOD, instPeriod));
    dcPeriod[i] = Math.round(0.25 * instPeriod + 0.75 * dcPeriod[i-1]);
  }

  const last        = len - 1;
  const finalPhase  = phase[last];
  const finalPeriod = dcPeriod[last];

  // Cycle mode: correlate recent prices against ideal sine of detected period
  const halfPeriod = Math.ceil(finalPeriod / 2);
  let sinCorr = 0;
  if (len > halfPeriod * 2) {
    const rp    = p.slice(-halfPeriod * 2);
    const pMean = rp.reduce((a,b)=>a+b,0) / rp.length;
    const pStd  = Math.sqrt(rp.reduce((a,b)=>a+(b-pMean)**2,0) / rp.length);
    if (pStd > 0) {
      let cov = 0;
      for (let i = 0; i < rp.length; i++) {
        cov += ((rp[i]-pMean)/pStd) * Math.sin(2*Math.PI*i/finalPeriod);
      }
      sinCorr = Math.abs(cov / rp.length);
    }
  }

  return {
    period:      finalPeriod,
    phase:       finalPhase,
    sinCorr,
    inCycleMode: sinCorr >= CYCLE_MODE_THRESHOLD,
  };
}

function calcDissimilarityIndex(symbol, currentPrice) {
  const ws = waveState[symbol];
  if (!ws) return 0;
  const allLevels = [...(ws.peaks||[]), ...(ws.troughs||[])];
  if (allLevels.length < 4) return 0;
  const mean = allLevels.reduce((a,b)=>a+b,0) / allLevels.length;
  const std  = Math.sqrt(allLevels.reduce((a,b)=>a+(b-mean)**2,0) / allLevels.length);
  return std === 0 ? 0 : Math.abs(currentPrice - mean) / std;
}

function predictNextTurningPoint(symbol, currentPrice, cycleResult) {
  if (!cycleResult) return { predictedPeak: null, predictedTrough: null, barsToTurn: null };
  const ws = waveState[symbol];
  if (!ws?.peaks?.length || !ws?.troughs?.length) return { predictedPeak: null, predictedTrough: null, barsToTurn: null };

  const { phase, period } = cycleResult;
  const normPhase    = ((phase % 360) + 360) % 360;
  const degToPeak    = normPhase <= 180 ? 180 - normPhase : normPhase - 180;
  const degToTrough  = normPhase <= 180 ? normPhase : 360 - normPhase;
  const barsToPeak   = Math.round((degToPeak   / 360) * period);
  const barsToTrough = Math.round((degToTrough / 360) * period);

  const weightedAvg = (arr) => {
    if (!arr.length) return null;
    let ws2 = 0, vs = 0;
    arr.forEach((v,i) => { const w=i+1; vs+=v*w; ws2+=w; });
    return vs / ws2;
  };

  const avgPeak   = weightedAvg(ws.peaks.slice(-4));
  const avgTrough = weightedAvg(ws.troughs.slice(-4));
  const lastPeak  = ws.peaks[ws.peaks.length-1];
  const lastTrgh  = ws.troughs[ws.troughs.length-1];
  const range     = avgPeak && avgTrough ? avgPeak - avgTrough : 0;
  const shift     = lastPeak && lastTrgh
    ? (currentPrice - (lastPeak+lastTrgh)/2) / ((lastPeak-lastTrgh)||1) : 0;

  return {
    predictedPeak:   avgPeak   ? avgPeak   + shift*range*0.3 : null,
    predictedTrough: avgTrough ? avgTrough + shift*range*0.3 : null,
    barsToTurn:      Math.min(barsToPeak, barsToTrough),
    nextTurnIsPeak:  barsToPeak <= barsToTrough,
    barsToPeak,
    barsToTrough,
  };
}

function calcPredictionConfidence(symbol, cycleResult, diScore, ind) {
  if (!cycleResult) return 0;
  let score = 0;

  // Cycle mode quality (0–30)
  if (cycleResult.inCycleMode) {
    score += 20;
    score += Math.round(cycleResult.sinCorr * 10);
  }

  // Period length: shorter = more data cycles seen = more trust (0–15)
  score += Math.max(0, 15 - Math.floor(cycleResult.period / 4));

  // DI: familiar territory (0–20, or negative for outlier)
  if      (diScore <= 1.0)               score += Math.round(20*(1-diScore));
  else if (diScore > DI_OUTLIER_THRESHOLD) score -= 15;

  // Indicator alignment (0–20)
  if (ind) {
    if      (ind.score >= 3) score += 20;
    else if (ind.score >= 2) score += 14;
    else if (ind.score >= 1) score += 8;
    else if (ind.score >= 0) score += 3;
    else                     score -= 5;
  }

  // Wave history depth (0–15)
  const ws       = waveState[symbol];
  const minCount = Math.min(ws?.peaks?.length||0, ws?.troughs?.length||0);
  score += Math.min(15, minCount * 3);

  return Math.max(0, Math.min(100, score));
}

function getPrediction(symbol) {
  initCycleState(symbol);
  const readings = history[symbol]?.readings;
  const price    = history[symbol]?.lastPrice;

  if (!readings || readings.length < EHLERS_MIN_BARS || !price) {
    return {
      ready: false, confidence: 0, cycleMode: false, action: "building",
      detail: "🧠 building cycle model...",
    };
  }

  const prices      = readings.map(r => r.price);
  const cycleResult = ehlersDominantCycle(prices);
  if (!cycleResult) return { ready: false, confidence: 0, action: "insufficient", detail: "🧠 insufficient data" };

  const diScore   = calcDissimilarityIndex(symbol, price);
  const prediction= predictNextTurningPoint(symbol, price, cycleResult);
  const ind       = getIndicatorScore(symbol);
  const confidence= calcPredictionConfidence(symbol, cycleResult, diScore, ind);

  const { phase, period, sinCorr, inCycleMode } = cycleResult;
  const normPhase = ((phase % 360) + 360) % 360;

  let action = "watch";
  if (inCycleMode && confidence >= PRED_CONFIDENCE_BUY) {
    if (normPhase >= 315 || normPhase <= 45)      action = "pre-buy";
    else if (normPhase >= 135 && normPhase <= 225) action = "pre-sell";
  }
  if (diScore > DI_OUTLIER_THRESHOLD) action = "outlier";

  const modeIcon = inCycleMode ? "〰️" : "📈";
  const confBar  = "█".repeat(Math.floor(confidence/10)) + "░".repeat(10-Math.floor(confidence/10));
  const diWarn   = diScore > DI_OUTLIER_THRESHOLD ? ` ⚠️DI:${diScore.toFixed(1)}` : "";
  const barsStr  = prediction.barsToTurn !== null ? ` ${prediction.barsToTurn}b→${prediction.nextTurnIsPeak?"peak":"trough"}` : "";

  // Update cycle state
  const cs = cycleState[symbol];
  cs.cyclePhase     = normPhase;
  cs.cyclePeriod    = period;
  cs.cycleMode      = inCycleMode;
  cs.confidence     = confidence;
  cs.predictedPeak  = prediction.predictedPeak;
  cs.predictedTrough= prediction.predictedTrough;
  cs.barsToTurn     = prediction.barsToTurn;
  cs.diScore        = diScore;
  cs.lastUpdated    = Date.now();

  return {
    ready:          true,
    confidence,
    cyclePhase:     normPhase,
    cyclePeriod:    period,
    cycleMode:      inCycleMode,
    sinCorr,
    predictedPeak:  prediction.predictedPeak,
    predictedTrough: prediction.predictedTrough,
    barsToTurn:     prediction.barsToTurn,
    nextTurnIsPeak: prediction.nextTurnIsPeak,
    barsToPeak:     prediction.barsToPeak,
    barsToTrough:   prediction.barsToTrough,
    diScore,
    action,
    detail: `🧠 [${confBar}] ${confidence}% | ${modeIcon}${inCycleMode?"CYCLE":"TREND"} φ${normPhase.toFixed(0)}° T${period}${barsStr}${diWarn}`,
  };
}

// Returns a composite indicator score for wave confirmation
// score > 0 = bullish confirmation, score < 0 = bearish confirmation
function getIndicatorScore(symbol) {
  const readings = history[symbol]?.readings;
  if (!readings || readings.length < MIN_READINGS_FOR_IND) return { score: 0, detail: "building" };

  const prices = readings.map(r => r.price);
  const rsi    = calcRSI(prices);
  const macd   = calcMACD(prices);
  const bb     = calcBollingerBands(prices);
  const latest = prices[prices.length - 1];

  let score = 0;
  const parts = [];

  if (rsi !== null) {
    if (rsi < RSI_OVERSOLD)  { score += 2; parts.push(`RSI ${rsi.toFixed(1)} OVERSOLD 🩸`); }
    else if (rsi < 45)       { score += 1; parts.push(`RSI ${rsi.toFixed(1)} low`); }
    else if (rsi > RSI_OVERBOUGHT) { score -= 2; parts.push(`RSI ${rsi.toFixed(1)} OVERBOUGHT 🔥`); }
    else if (rsi > 55)       { score -= 1; parts.push(`RSI ${rsi.toFixed(1)} high`); }
    else                     { parts.push(`RSI ${rsi.toFixed(1)} neutral`); }
  }

  if (macd) {
    if (macd.crossUp)            { score += 2; parts.push("MACD ✨CROSS UP"); }
    else if (macd.bullish && macd.expanding) { score += 1; parts.push("MACD bull+expand"); }
    else if (macd.crossDown)     { score -= 2; parts.push("MACD ☠️ CROSS DOWN"); }
    else if (!macd.bullish && macd.expanding){ score -= 1; parts.push("MACD bear+expand"); }
  }

  if (bb) {
    if (latest <= bb.lower * 1.005) { score += 2; parts.push("BB lower touch 📉"); }
    else if (latest >= bb.upper * 0.995) { score -= 2; parts.push("BB upper touch 📈"); }
    if (bb.squeeze) { parts.push("BB SQUEEZE ⚡"); }
  }

  return { score, rsi, macd, bb, detail: parts.join(" | ") };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 📊 PORTFOLIO DRAWDOWN CIRCUIT BREAKER
// ═══════════════════════════════════════════════════════════════════════════════
let portfolioPeakUsd    = 0;
let drawdownHaltActive  = false;

function updatePortfolioPeak(currentUsd) {
  if (currentUsd > portfolioPeakUsd) {
    portfolioPeakUsd = currentUsd;
  }
  // Check if halt should be lifted (recovery check against CURRENT value vs peak)
  if (drawdownHaltActive && portfolioPeakUsd > 0) {
    const stillDown = (portfolioPeakUsd - currentUsd) / portfolioPeakUsd;
    if (stillDown < DRAWDOWN_RESUME_PCT) {
      drawdownHaltActive = false;
      console.log(`✅ DRAWDOWN HALT LIFTED — only ${(stillDown*100).toFixed(1)}% from peak now`);
      tg(`✅ <b>DRAWDOWN HALT LIFTED</b>\nPortfolio recovered to within ${(stillDown*100).toFixed(1)}% of peak\nBuys resuming`);
    }
  }
}

function checkDrawdown(currentUsd) {
  if (portfolioPeakUsd === 0) return false;
  const dd = (portfolioPeakUsd - currentUsd) / portfolioPeakUsd;
  if (dd >= DRAWDOWN_HALT_PCT && !drawdownHaltActive) {
    drawdownHaltActive = true;
    console.log(`🛑 DRAWDOWN CIRCUIT BREAKER: -${(dd*100).toFixed(1)}% from peak — halting new buys`);
    tg(`🛑 <b>DRAWDOWN CIRCUIT BREAKER ACTIVE</b>\nPortfolio down ${(dd*100).toFixed(1)}% from peak\nNew buys halted — sell-only mode until recovery`);
  }
  return drawdownHaltActive;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🌊 WAVE ENGINE — MAX PEAK / MIN TROUGH with indicator confirmation
// ═══════════════════════════════════════════════════════════════════════════════
let tokens         = [];
let history        = {};
let tokensSha      = null;
let historySha     = null;
let positionsSha   = null;
let lastTradeTime  = {};
let cascadeTime    = {}; // separate grace timer for cascade targets
let piggyBank      = 0;
let totalSkimmed   = 0;
let tradeCount     = 0;

// ── PREDICTION FUND state ─────────────────────────────────────────────────────
let predFund       = 0;
let predFundPnl    = 0;
let predFundTrades = 0;
const predFundPos  = {};   // { [symbol]: { entryPrice, ethIn, tokens, entryTime, conf } }
const predFundCool = {};   // per-token cooldown timestamps

// ── PIGGY CO-INVEST state ─────────────────────────────────────────────────────
const piggyCoPos   = {};   // { [symbol]: { ethIn, tokens, entryPrice, entryTime } }
let piggyCoPnl     = 0;    // cumulative ETH P&L from co-invest trades

// ── AGENTIC CAPITAL state ─────────────────────────────────────────────────────
let agentCapital   = 0;
let agentPnl       = 0;

// ── STALE CASCADE state ───────────────────────────────────────────────────────
const stalePriceRef  = {};  // { [symbol]: { price, timestamp } } — price snapshot for stale detection
const staleCooldown  = {};  // { [symbol]: lastCascadeTime }

// ── FIB LEVEL EXECUTION MEMORY ────────────────────────────────────────────────
// Tracks which Fib levels have already been sold per position entry.
// Reset when entryPrice is cleared (position closed) or new entry starts.
// Without this, checkFibTargetHit fires on the same level EVERY 15s cycle
// until the position is fully drained. Critical bug — causes massive over-selling.
const fibLevelsExecuted = {}; // { [symbol]: Set<pct> } — e.g. { "BRETT": Set {1.000, 1.272} }

function recordFibLevelExecuted(symbol, pct) {
  if (!fibLevelsExecuted[symbol]) fibLevelsExecuted[symbol] = new Set();
  fibLevelsExecuted[symbol].add(pct);
}

function isFibLevelAlreadyExecuted(symbol, pct) {
  return !!(fibLevelsExecuted[symbol]?.has(pct));
}

function clearFibLevels(symbol) {
  fibLevelsExecuted[symbol] = new Set();
}



// ── 💱 PRICE CACHE — prevents rate-limiting from killing token prices ──────────
// Problem: 29 tokens × 2 API sources × every 15s = ~58 API calls/cycle.
// Free-tier APIs (GeckoTerminal, DexScreener) rate-limit at ~30-60 req/min.
// This causes random "no price" failures mid-cycle on otherwise good tokens.
// Solution: cache each price for PRICE_CACHE_TTL ms. API is only called when stale.
// Tokens with open positions get shorter TTL (fresher data for sell decisions).
const PRICE_CACHE_TTL      = 12_000;   // 12s for idle tokens — 1 refresh per ~cycle
const PRICE_CACHE_TTL_HELD = 6_000;    // 6s for held positions — faster refresh
const priceCache = {};  // { [address]: { price, timestamp, failCount } }

// ── NO-PRICE STREAK TRACKER ───────────────────────────────────────────────────
// After NO_PRICE_SKIP_AFTER consecutive timeouts with no position, skip that
// token to stop dead/thin tokens burning 12s of loop time every cycle.
// Tokens with open positions are NEVER skipped — always processed.
const NO_PRICE_SKIP_AFTER = 10;
const noPriceStreak = {};

function getCachedPrice(address) {
  const c = priceCache[address.toLowerCase()];
  if (!c) return null;
  return c.price;
}

function setCachedPrice(address, price) {
  const key = address.toLowerCase();
  priceCache[key] = { price, timestamp: Date.now(), failCount: 0 };
}

function isPriceCacheStale(address, hasPosition = false) {
  const c = priceCache[address.toLowerCase()];
  if (!c || !c.price) return true;  // no cache → always fetch
  const ttl = hasPosition ? PRICE_CACHE_TTL_HELD : PRICE_CACHE_TTL;
  return (Date.now() - c.timestamp) > ttl;
}

// ── 🏄 WAVE STATS & LEADERBOARD ───────────────────────────────────────────────
// Per-token piggy allocation (each profitable sell skims 0.33% per pool per token)
// waveStats[symbol] = { wins, losses, totalPnlEth, biggestWavePct, fastestWaveMs,
//                       biggestWaveSymbol, medals: { gold, silver, bronze },
//                       piggyContrib: ETH this token has sent to piggy }
const waveStats = {};
function initWaveStats(symbol) {
  if (!waveStats[symbol]) waveStats[symbol] = {
    wins: 0, losses: 0, totalPnlEth: 0,
    biggestWavePct: 0, biggestWaveUsd: 0,
    fastestWaveMs: Infinity, fastestWavePct: 0,
    medals: { gold: 0, silver: 0, bronze: 0 },
    piggyContrib: 0,
  };
  return waveStats[symbol];
}

// Medal thresholds: gold ≥5%, silver ≥2.5%, bronze ≥0%
function getMedal(pnlPct) {
  if (pnlPct >= 5)   return { emoji: "🥇", name: "GOLD",   tier: "gold" };
  if (pnlPct >= 2.5) return { emoji: "🥈", name: "SILVER", tier: "silver" };
  if (pnlPct >= 0)   return { emoji: "🥉", name: "BRONZE", tier: "bronze" };
  return { emoji: "🦈", name: "WIPEOUT", tier: null };  // shark = loss
}

// 🌊 Surf ride display — animated countdown bar that looks like a wave + surfer
// countdown = bars remaining (0–10), moving surfer position
function surfRideBar(pctOfRange) {
  const pos    = Math.max(0, Math.min(9, Math.round(pctOfRange * 9)));
  const filled = "〰️".repeat(pos);
  const empty  = "〰️".repeat(9 - pos);
  return `${filled}🏄${empty}`;
}

// Full wave sell animation line — shows countdown with surfer
function surfCountdownLine(barsLeft, pctOfRange) {
  const pos     = Math.max(0, Math.min(9, Math.round(pctOfRange * 9)));
  const left    = "〰️".repeat(pos);
  const right   = "〰️".repeat(9 - pos);
  return `${left}🏄${right} ${barsLeft} bars to target`;
}

// Wipeout line — stop loss or cascaded out
function wipeoutLine() { return `〰️〰️〰️〰️🦈〰️〰️〰️〰️〰️  WIPEOUT!`; }
let lastSaveTime   = Date.now();
let lastReportTime = Date.now();
let lastMiniUpdate = Date.now();
let approvedTokens = new Set();
let cdpClient      = null;
let manualCommands = [];
let cachedBal      = null;   // updated each loop cycle — used in Telegram commands
const waveState    = {};
const tradeLog     = [];
const proximityAlerts = {}; // symbol → { lastBuyAlertPct, lastSellAlertPct }
// Cached token balances — refreshed each main loop cycle, used in Telegram responses
const tokenBalanceCache = {};

function initWaveState(symbol) {
  if (!waveState[symbol]) waveState[symbol] = { peaks: [], troughs: [], peakScores: [], troughScores: [] };
  return waveState[symbol];
}

// ── PERMANENT TRADE LEDGER ────────────────────────────────────────────────────
// Every trade appended forever to ledger.json on bot-state branch
// Never truncated, never overwritten — only appended
// This is the permanent record — survives any restart, redeploy, or crash
let ledgerSha = null;

async function appendToLedger(entry) {
  try {
    // Load current ledger
    const lf = await githubGetFromBranch("ledger.json", STATE_BRANCH);
    const ledger = lf?.content || { trades: [], created: new Date().toISOString(), wallet: WALLET_ADDRESS };
    ledgerSha    = lf?.sha || null;

    // Append new entry
    ledger.trades.push(entry);
    ledger.lastUpdated = new Date().toISOString();
    ledger.totalTrades = ledger.trades.length;

    // Compute running stats
    const buys  = ledger.trades.filter(t => t.type === "SELL");
    const wins  = buys.filter(t => t.netUsd > 0);
    ledger.stats = {
      totalTrades:  ledger.trades.length,
      sells:        buys.length,
      wins:         wins.length,
      winRate:      buys.length > 0 ? ((wins.length/buys.length)*100).toFixed(1)+"%" : "n/a",
      totalNetUsd:  buys.reduce((s,t) => s + (t.netUsd||0), 0).toFixed(2),
      totalSkimEth: buys.reduce((s,t) => s + (t.skimEth||0), 0).toFixed(6),
    };

    // Save back — never truncate, always full history
    await githubSaveToState("ledger.json", ledger, ledgerSha);
    console.log(`📖 Ledger: trade #${ledger.totalTrades} recorded permanently`);
  } catch (e) {
    console.log(`⚠️  Ledger append failed: ${e.message}`);
  }
}

// Helper: load a file from a specific branch
async function githubGetFromBranch(filename, branch) {
  try {
    const [owner, repo] = (process.env.GITHUB_REPO || "").split("/");
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${filename}?ref=${branch}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: "application/vnd.github.v3+json" } });
    if (!res.ok) return null;
    const data = await res.json();
    return { content: JSON.parse(Buffer.from(data.content, "base64").toString()), sha: data.sha };
  } catch { return null; }
}

// Helper: save a file to the state branch
async function githubSaveToState(filename, content, sha) {
  try {
    const [owner, repo] = (process.env.GITHUB_REPO || "").split("/");
    const url  = `https://api.github.com/repos/${owner}/${repo}/contents/${filename}`;
    const body = { message: `ledger: ${new Date().toISOString()}`, content: Buffer.from(JSON.stringify(content, null, 2)).toString("base64"), branch: STATE_BRANCH };
    if (sha) body.sha = sha;
    const res = await fetch(url, { method: "PUT", headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: "application/vnd.github.v3+json", "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json();
    if (data.content?.sha) ledgerSha = data.content.sha;
  } catch (e) { console.log(`⚠️  Ledger save error: ${e.message}`); }
}
// ── MULTI-SOURCE HISTORICAL CANDLE FETCHER ───────────────────────────────────
// Source 1: DexScreener — accepts token address directly, returns OHLCV
// Source 2: GeckoTerminal — needs pool address (we look it up first)
// Source 3: CoinGecko — for well-known tokens by symbol
// Returns array of { t, o, h, l, c, v } candles oldest→newest, or null

async function fetchCandlesDexScreener(tokenAddress, days = 90) {
  try {
    // DexScreener pairs endpoint — gives us the top pool for this token on Base
    const pairsUrl = `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`;
    const pRes = await fetch(pairsUrl, { headers: { Accept: "application/json" } });
    if (!pRes.ok) return null;
    const pJson = await pRes.json();

    // Find the highest-liquidity Base pair
    const pairs = (pJson.pairs || []).filter(p => p.chainId === "base");
    if (!pairs.length) return null;
    pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
    const pair = pairs[0];
    const pairAddr = pair.pairAddress;

    // Fetch candles from DexScreener chart endpoint
    const res1d = await fetch(`https://io.dexscreener.com/dex/chart/amm/v3/base/${pairAddr}?res=1D&cb=0`, { headers: { Accept: "application/json" } });
    if (res1d.ok) {
      const j = await res1d.json();
      const bars = j?.bars || j?.ohlcv || j?.data;
      if (Array.isArray(bars) && bars.length >= 7) {
        const candles = bars.slice(-days).map(b => ({
          t: b.t || b[0], o: b.o || b[1], h: b.h || b[2],
          l: b.l || b[3], c: b.c || b[4], v: b.v || b[5] || 0
        })).filter(c => c.c > 0);
        if (candles.length >= 7) return candles;
      }
    }
    return null;
  } catch { return null; }
}

async function fetchCandlesGeckoTerminal(tokenAddress, days = 90) {
  try {
    // Step 1: look up the top pool for this token on Base
    const poolRes = await fetch(
      `https://api.geckoterminal.com/api/v2/networks/base/tokens/${tokenAddress}/pools?page=1`,
      { headers: { Accept: "application/json" } }
    );
    if (!poolRes.ok) return null;
    const poolJson = await poolRes.json();
    const pools = poolJson?.data;
    if (!Array.isArray(pools) || !pools.length) return null;

    // Pick highest volume pool
    const pool = pools.sort((a, b) =>
      (b.attributes?.volume_usd?.h24 || 0) - (a.attributes?.volume_usd?.h24 || 0)
    )[0];
    const poolAddr = pool.attributes?.address;
    if (!poolAddr) return null;

    // Step 2: fetch daily OHLCV for that pool
    const limit = Math.min(days, 365);
    const ohlcRes = await fetch(
      `https://api.geckoterminal.com/api/v2/networks/base/pools/${poolAddr}/ohlcv/day?limit=${limit}&currency=usd`,
      { headers: { Accept: "application/json" } }
    );
    if (!ohlcRes.ok) return null;
    const ohlcJson = await ohlcRes.json();
    const raw = ohlcJson?.data?.attributes?.ohlcv_list;
    if (!Array.isArray(raw) || raw.length < 5) return null;

    // raw: [[timestamp, open, high, low, close, volume], ...]  newest first → reverse
    const candles = raw.reverse().map(c => ({
      t: c[0] * 1000, o: c[1], h: c[2], l: c[3], c: c[4], v: c[5] || 0
    })).filter(c => c.c > 0);
    return candles.length >= 7 ? candles : null;
  } catch { return null; }
}

// Master fetcher — tries all sources, returns best result
async function fetchHistoricalCandles(tokenAddress, days = 90) {
  // Try GeckoTerminal first (more reliable OHLC on Base)
  const gt = await fetchCandlesGeckoTerminal(tokenAddress, days);
  if (gt && gt.length >= 7) return gt;

  // Fallback: DexScreener
  const ds = await fetchCandlesDexScreener(tokenAddress, days);
  if (ds && ds.length >= 7) return ds;

  return null;
}

// Pull historical data for every token and pre-load their wave state + indicator data
// Uses full OHLC candles — real highs/lows for every timeframe, no more waiting
async function loadHistoricalData(days = 90) {
  console.log(`📅 Loading ${days}-day historical OHLC data for all tokens...`);
  let loaded = 0, skipped = 0;

  const allTokens = [
    ...DEFAULT_TOKENS,
    ...WATCHLIST.map(w => ({ symbol: w.symbol, address: w.address, _watchlist: true }))
  ].filter(t => t.address && t.address !== "PENDING" && t.address.startsWith("0x"));

  // Process in sequential batches of 3 tokens.
  // Each token fires GT+DS in parallel (2 requests). With 3 tokens per batch
  // that's 6 requests per batch. At 3s between batches = ~120 req/min ceiling,
  // but because we wait for each batch to complete before starting the next,
  // in practice it's ~6 req per 3s = 120/min max — well under GT's free tier.
  const BATCH_SIZE = 3;
  const BATCH_SLEEP = 3000; // 3s between batches

  for (let batchStart = 0; batchStart < allTokens.length; batchStart += BATCH_SIZE) {
    const batch = allTokens.slice(batchStart, batchStart + BATCH_SIZE);

    // Process all tokens in this batch in parallel — they share the rate-limit window
    await Promise.allSettled(batch.map(async (token) => {
    try {
      let candles = null;
      let gtError = null, dsError = null;

      // GT and DS in parallel per token within the batch
      const [gtResult, dsResult] = await Promise.allSettled([
        fetchCandlesGeckoTerminal(token.address, days),
        fetchCandlesDexScreener(token.address, days),
      ]);

      const gtCandles = gtResult.status === "fulfilled" ? gtResult.value : null;
      const dsCandles = dsResult.status === "fulfilled" ? dsResult.value : null;
      if (gtResult.status === "rejected") gtError = `GeckoTerminal: ${gtResult.reason?.message || "error"}`;
      if (dsResult.status === "rejected") dsError = `DexScreener: ${dsResult.reason?.message || "error"}`;

      // Prefer whichever returned more candles (more history = better waves)
      if (gtCandles?.length >= 7 && (!dsCandles || gtCandles.length >= dsCandles.length)) {
        candles = gtCandles;
        console.log(`   📡 ${token.symbol}: GeckoTerminal ✅ (${candles.length} candles)`);
      } else if (dsCandles?.length >= 7) {
        candles = dsCandles;
        console.log(`   📡 ${token.symbol}: DexScreener  ✅ (${candles.length} candles)${gtError ? ` [GT: ${gtError}]` : ""}`);
      } else {
        gtError = gtError || (gtCandles ? `only ${gtCandles.length} candles` : "no data / pool not found");
        dsError = dsError || (dsCandles ? `only ${dsCandles.length} candles` : "no data / pair not found");
      }

      if (!candles || candles.length < 7) {
        console.log(`   ❌ ${token.symbol}: SEED FAILED — ${gtError || "GT:ok"} | ${dsError || "DS:ok"} → building from live ticks`);
        skipped++;
        return;
      }

      // ── Seed price history with candle closes for indicator calc ──────────
      if (!token._watchlist) {
        if (!history[token.symbol]) history[token.symbol] = { readings: [], lastPrice: null };
        if (history[token.symbol].readings.length < candles.length) {
          const now   = Date.now();
          const dayMs = 86_400_000;
          const syntheticReadings = candles.map((c, i) => ({
            price: c.c,
            time:  now - (candles.length - i) * dayMs,
            synthetic: true,
          }));
          const liveReadings = history[token.symbol].readings.filter(r => !r.synthetic);
          history[token.symbol].readings = [...syntheticReadings, ...liveReadings].slice(-2000);
          history[token.symbol].lastPrice = candles[candles.length - 1].c;
        }
      } else {
        // Watchlist — store in watchPrices
        if (!watchPrices[token.symbol]) watchPrices[token.symbol] = { prices: [], high24h: 0, low24h: Infinity };
        watchPrices[token.symbol].lastPrice = candles[candles.length - 1].c;
      }

      // ── Build full OHLC timeframe summary ─────────────────────────────────
      const buildFrame = (cs) => ({
        high:   Math.max(...cs.map(c => c.h)),
        low:    Math.min(...cs.map(c => c.l)),
        open:   cs[0].o,
        close:  cs[cs.length - 1].c,
        change: (((cs[cs.length-1].c - cs[0].o) / cs[0].o) * 100),
        volume: cs.reduce((s, c) => s + (c.v || 0), 0),
        days:   cs.length,
      });

      const c7   = candles.slice(-7);
      const c14  = candles.slice(-14);
      const c30  = candles.slice(-30);
      const c90  = candles.slice(-90);
      // Weekly buckets (last 12 weeks)
      const weeks = [];
      for (let i = candles.length - 1; i >= 0 && weeks.length < 12; i -= 7) {
        const bucket = candles.slice(Math.max(0, i - 6), i + 1);
        if (bucket.length) weeks.unshift(buildFrame(bucket));
      }
      // Monthly buckets (last 3 months)
      const months = [];
      for (let i = candles.length - 1; i >= 0 && months.length < 3; i -= 30) {
        const bucket = candles.slice(Math.max(0, i - 29), i + 1);
        if (bucket.length) months.unshift(buildFrame(bucket));
      }

      const ohlc = {
        daily:   { today: buildFrame([candles[candles.length-1]]), yesterday: candles.length>1 ? buildFrame([candles[candles.length-2]]) : null },
        weekly:  { current: buildFrame(c7),  last4: weeks.slice(-4), all12: weeks },
        monthly: { current: buildFrame(c30), last3: months },
        range90: buildFrame(c90),
        range14: buildFrame(c14),
        candleCount: candles.length,
        updatedAt: new Date().toISOString(),
        // Legacy compat for /history command
        days90: { high: Math.max(...c90.map(c=>c.h)), low: Math.min(...c90.map(c=>c.l)), start: c90[0].o, end: c90[c90.length-1].c },
        days30: { high: Math.max(...c30.map(c=>c.h)), low: Math.min(...c30.map(c=>c.l)), start: c30[0].o, end: c30[c30.length-1].c },
        days7:  { high: Math.max(...c7.map(c=>c.h)),  low: Math.min(...c7.map(c=>c.l)),  start: c7[0].o,  end: c7[c7.length-1].c  },
      };

      if (!token._watchlist) {
        if (!history[token.symbol]) history[token.symbol] = { readings: [], lastPrice: null };
        history[token.symbol].candles = ohlc;
      } else {
        if (!watchPrices[token.symbol]) watchPrices[token.symbol] = { prices: [], high24h: 0, low24h: Infinity };
        watchPrices[token.symbol].candles = ohlc;
      }

      loaded++;
      const r = ohlc.range90;
      const w = ohlc.weekly.current;
      console.log(`   ✅ ${token.symbol}: ${candles.length}d | 90d H:$${r.high.toFixed(6)} L:$${r.low.toFixed(6)} | 7d: ${w.change>=0?"+":""}${w.change.toFixed(1)}% | now:$${candles[candles.length-1].c.toFixed(6)}`);
    } catch (e) {
      console.log(`   ⚠️  ${token.symbol}: candle load failed — ${e.message}`);
      skipped++;
    }
    })); // end batch Promise.allSettled

    // Wait between batches so GT rate-limit window has time to recover
    if (batchStart + BATCH_SIZE < allTokens.length) await sleep(BATCH_SLEEP);
  }
  console.log(`📅 Historical load complete: ${loaded} loaded, ${skipped} skipped\n`);
}

function bootstrapWavesFromHistory() {
  const activeSymbols = new Set(DEFAULT_TOKENS.map(t => t.symbol));
  console.log("🌊 Bootstrapping waves from history...");
  let armed = 0, building = 0;
  for (const symbol of Object.keys(history)) {
    if (!activeSymbols.has(symbol)) {
      console.log(`   🗑️  Skipping ghost token: ${symbol} (not in active portfolio)`);
      continue;
    }
    const readings = history[symbol]?.readings;
    if (!readings || readings.length < 10) {
      console.log(`   ⏳ ${symbol}: only ${readings?.length || 0} readings — needs more live ticks`);
      building++;
      continue;
    }
    const ws = initWaveState(symbol);
    const prices = readings.map(r => r.price);

    // Adaptive threshold: tokens with <30 candles of history have thin data —
    // lower the bar so they arm faster from what we do have.
    // Tokens with plenty of history keep the standard WAVE_MIN_MOVE (0.4%).
    const syntheticCount = readings.filter(r => r.synthetic).length;
    const adaptiveMinMove = syntheticCount < 30 ? 0.002 : WAVE_MIN_MOVE; // 0.2% for thin data
    if (syntheticCount < 30) {
      console.log(`   📉 ${symbol}: thin history (${syntheticCount} candles) — using adaptive threshold 0.2% vs normal 0.4%`);
    }

    const peaks = [], troughs = [];
    for (let i = 2; i < prices.length - 2; i++) {
      const m = prices[i];
      if (m > prices[i-2] && m > prices[i-1] && m > prices[i+1] && m > prices[i+2]) {
        const l = peaks[peaks.length-1];
        if (!l || Math.abs(m-l)/l > adaptiveMinMove) peaks.push(m);
      }
      if (m < prices[i-2] && m < prices[i-1] && m < prices[i+1] && m < prices[i+2]) {
        const l = troughs[troughs.length-1];
        if (!l || Math.abs(m-l)/l > adaptiveMinMove) troughs.push(m);
      }
    }
    ws.peaks   = peaks.slice(-WAVE_COUNT);
    ws.troughs = troughs.slice(-WAVE_COUNT);
    if (ws.peaks.length >= MIN_PEAKS_TO_TRADE && ws.troughs.length >= MIN_TROUGHS_TO_TRADE) {
      console.log(`   ✅ ${symbol}: ARMED ${ws.peaks.length}P ${ws.troughs.length}T | MAX:$${Math.max(...ws.peaks).toFixed(8)} MIN:$${Math.min(...ws.troughs).toFixed(8)}`);
      armed++;
    } else if (ws.peaks.length || ws.troughs.length) {
      console.log(`   🔧 ${symbol}: ${ws.peaks.length}P ${ws.troughs.length}T — needs ${Math.max(0, MIN_PEAKS_TO_TRADE - ws.peaks.length)}P ${Math.max(0, MIN_TROUGHS_TO_TRADE - ws.troughs.length)}T more`);
      building++;
    } else {
      console.log(`   ⏳ ${symbol}: 0P 0T — no waves detected from history, will build live`);
      building++;
    }
  }
  console.log(`✅ Wave bootstrap complete: ${armed} armed, ${building} still building\n`);
}

// ── LEDGER-BASED WAVE SEEDING ─────────────────────────────────────────────────
// The ledger records every real buy and sell price ever executed.
// Buy prices are confirmed troughs (we bought at MIN trough).
// Sell prices are confirmed peaks (we sold at MAX peak).
// This is the highest-quality wave data possible — real money, real executions.
// On restart, inject these directly into waveState so tokens re-arm instantly
// instead of rebuilding from scratch.
async function bootstrapWavesFromLedger() {
  console.log("📖 Seeding waves from trade ledger...");
  try {
    const lf = await githubGetFromBranch("ledger.json", STATE_BRANCH);
    if (!lf?.content?.trades?.length) {
      console.log("   ⚠️  Ledger empty or unreadable — skipping ledger seed");
      return;
    }

    const trades = lf.content.trades;
    // Group trades by symbol
    const bySymbol = {};
    for (const t of trades) {
      if (!t.symbol || !t.price || t.price <= 0) continue;
      if (!bySymbol[t.symbol]) bySymbol[t.symbol] = { buys: [], sells: [] };
      if (t.type === "BUY")  bySymbol[t.symbol].buys.push(t.price);
      if (t.type === "SELL") bySymbol[t.symbol].sells.push(t.price);
    }

    let seeded = 0, alreadyArmed = 0;
    for (const [symbol, data] of Object.entries(bySymbol)) {
      const ws = initWaveState(symbol);
      const alreadyHasPeaks   = ws.peaks.length   >= MIN_PEAKS_TO_TRADE;
      const alreadyHasTroughs = ws.troughs.length >= MIN_TROUGHS_TO_TRADE;
      if (alreadyHasPeaks && alreadyHasTroughs) { alreadyArmed++; continue; }

      // Inject buy prices as confirmed troughs, sell prices as confirmed peaks.
      // Deduplicate — don't add if already within 0.5% of an existing level.
      const isDupe = (arr, val) => arr.some(x => Math.abs(x - val) / val < 0.005);

      for (const p of data.sells) {
        if (!isDupe(ws.peaks, p)) ws.peaks.push(p);
      }
      for (const p of data.buys) {
        if (!isDupe(ws.troughs, p)) ws.troughs.push(p);
      }

      // Keep only the most recent WAVE_COUNT entries (most relevant for current market)
      ws.peaks   = ws.peaks.sort((a, b) => a - b).slice(-WAVE_COUNT);
      ws.troughs = ws.troughs.sort((a, b) => a - b).slice(-WAVE_COUNT);

      // Sanity check: max peak must be above min trough or the wave is inverted.
      // This happens when a token was bought at ATH (entry > all historical highs).
      // Inverted waves produce negative margin and confuse the sell trigger — clear them.
      const maxP = ws.peaks.length   ? Math.max(...ws.peaks)   : 0;
      const minT = ws.troughs.length ? Math.min(...ws.troughs) : 0;
      if (ws.peaks.length && ws.troughs.length && maxP <= minT) {
        console.log(`   ⚠️  ${symbol}: inverted wave (peak $${maxP.toFixed(6)} <= trough $${minT.toFixed(6)}) — clearing, will rebuild from live ticks`);
        ws.peaks   = [];
        ws.troughs = [];
      }

      if (ws.peaks.length && ws.troughs.length) {
        const armed = ws.peaks.length >= MIN_PEAKS_TO_TRADE && ws.troughs.length >= MIN_TROUGHS_TO_TRADE;
        console.log(`   ${armed ? "✅" : "🔧"} ${symbol}: ledger gave ${data.sells.length} peaks + ${data.buys.length} troughs → now ${ws.peaks.length}P ${ws.troughs.length}T ${armed ? "ARMED" : "(needs more)"}`);
        seeded++;
      }
    }
    console.log(`📖 Ledger seed complete: ${seeded} tokens seeded from ${trades.length} trades, ${alreadyArmed} already armed\n`);
  } catch (e) {
    console.log(`   ⚠️  Ledger bootstrap failed: ${e.message}`);
  }
}

function recordPrice(symbol, price) {
  if (!history[symbol]) history[symbol] = { readings: [], lastPrice: null };
  history[symbol].readings.push({ price, time: Date.now() });
  if (history[symbol].readings.length > 2000) history[symbol].readings.shift(); // keep under GitHub 1MB API limit
  history[symbol].lastPrice = price;
}

// Update waves — now with indicator confirmation scoring
// A peak/trough detected by price structure gets +1 bonus if indicators confirm
function updateWaves(symbol, price) {
  const ws = initWaveState(symbol);
  const readings = history[symbol]?.readings || [];
  if (readings.length < 5) return;

  const recent = readings.slice(-5).map(r => r.price);
  const m = recent[2]; // middle of 5-point window

  // PEAK detection
  if (m > recent[0] && m > recent[1] && m > recent[3] && m > recent[4]) {
    const l = ws.peaks[ws.peaks.length-1];
    if (!l || Math.abs(m-l)/l > WAVE_MIN_MOVE) {
      const ind = getIndicatorScore(symbol);
      // Peak is stronger if indicators confirm overbought (score <= -1)
      const confirmed = ind.score <= -1;
      ws.peaks.push(m);
      if (ws.peaks.length > WAVE_COUNT) ws.peaks.shift();
      console.log(`   📈 [${symbol}] New peak: $${m.toFixed(8)} | ind score: ${ind.score} ${confirmed ? "✅CONFIRMED" : "⚠️unconfirmed"} | ${ind.detail}`);
    }
  }

  // TROUGH detection
  if (m < recent[0] && m < recent[1] && m < recent[3] && m < recent[4]) {
    const l = ws.troughs[ws.troughs.length-1];
    if (!l || Math.abs(m-l)/l > WAVE_MIN_MOVE) {
      const ind = getIndicatorScore(symbol);
      // Trough is stronger if indicators confirm oversold (score >= 1)
      const confirmed = ind.score >= 1;
      ws.troughs.push(m);
      if (ws.troughs.length > WAVE_COUNT) ws.troughs.shift();
      console.log(`   📉 [${symbol}] New trough: $${m.toFixed(8)} | ind score: ${ind.score} ${confirmed ? "✅CONFIRMED" : "⚠️unconfirmed"} | ${ind.detail}`);

      // WAVE INVALIDATION: if new trough breaks 5% below existing MIN,
      // the old MIN trough is no longer valid — shift it out
      const prevMin = getMinTrough(symbol, true); // skip latest
      if (prevMin && m < prevMin * (1 - STOP_LOSS_PCT)) {
        console.log(`   ⚠️ [${symbol}] New trough breaks stop-loss level — wave invalidated, updating MIN`);
      }
    }
  }
}

function getMaxPeak(symbol)               { const ps = waveState[symbol]?.peaks   || []; return ps.length ? Math.max(...ps) : null; }
function getMinTrough(symbol, skipLast)   {
  let ts = waveState[symbol]?.troughs || [];
  if (skipLast && ts.length > 1) ts = ts.slice(0, -1);
  return ts.length ? Math.min(...ts) : null;
}
function getPeakCount(symbol)             { return (waveState[symbol]?.peaks   || []).length; }
function getTroughCount(symbol)           { return (waveState[symbol]?.troughs || []).length; }

// ═══════════════════════════════════════════════════════════════════════════════
// 📐 FIBONACCI LEVEL ENGINE
// ═══════════════════════════════════════════════════════════════════════════════
// What you described is called a "Fibonacci Extension + Retracement Ladder with
// Scaled Partial Exits" — the industry standard for always having a profitable
// target to hit on every wave, up or down.
//
// HOW IT WORKS:
//   Given a confirmed swing LOW (trough) and swing HIGH (peak), we compute:
//
//   RETRACEMENT levels (where to RE-ENTER on pullbacks — buy zones):
//     23.6% pullback from high  → shallow dip, strong trend
//     38.2% pullback            → golden zone entry (high probability)
//     50.0% pullback            → midpoint — most common re-entry
//     61.8% pullback            → deep golden zone (best value entry)
//     78.6% pullback            → last line before new low
//
//   EXTENSION levels (take-profit targets on the next wave up):
//     100%  → equals the prior high (first lock-in target — always profitable)
//     127.2% → first breakout extension (partial sell here)
//     138.2% → moderate extension
//     161.8% → golden extension — the "tsunami" level (the big wave target)
//     200%   → full extension (rare but it happens on meme coins)
//     261.8% → super extension (cascade fuel target)
//
// PHILOSOPHY:
//   - If price hits 161.8% extension → sell 40%, let 60% ride to 261.8%
//   - If price only reaches 100% (prior high) → still profitable, always exit
//   - If we miss the peak, the 61.8% retracement is where we reload
//   - Every level above entry + fees is a valid partial-exit point
//   - The bot never needs to "nail the top" — the ladder guarantees a hit
//
// The key insight: Guardian already tracks peaks/troughs. Fibonacci levels are
// just MATH on those same numbers — no new data needed, just new calculations.
// ═══════════════════════════════════════════════════════════════════════════════

const FIB_RETRACE = [0.236, 0.382, 0.500, 0.618, 0.786]; // buy zone depths
const FIB_EXTEND  = [1.000, 1.272, 1.382, 1.618, 2.000, 2.618]; // take-profit targets

/**
 * Compute all Fibonacci levels for a symbol from its confirmed swing low/high.
 * Returns an object with:
 *   retracements: [{pct, price, label}] — buy/reload zones on pullbacks
 *   extensions:   [{pct, price, label}] — take-profit targets on the next wave
 *   swingLow, swingHigh — the anchor points used
 */
function getFibLevels(symbol) {
  const swingHigh = getMaxPeak(symbol);
  const swingLow  = getMinTrough(symbol);
  if (!swingHigh || !swingLow || swingHigh <= swingLow) return null;

  const range = swingHigh - swingLow;

  // Retracement levels: price pulls BACK from the high by pct% of the range
  const retracements = FIB_RETRACE.map(pct => ({
    pct,
    price: swingHigh - range * pct,
    label: `${(pct * 100).toFixed(1)}% retrace`,
    isBuyZone: true,
  }));

  // Extension levels: price EXTENDS ABOVE the high by (pct-1) * range
  // Anchored at the swing low: swingLow + range * pct
  const extensions = FIB_EXTEND.map(pct => ({
    pct,
    price: swingLow + range * pct,
    label: pct === 1.000 ? `100% (prior high)` :
           pct === 1.618 ? `161.8% 🌊 TSUNAMI` :
           pct === 2.618 ? `261.8% 🚀 SUPERNOVA` :
           `${(pct * 100).toFixed(1)}% ext`,
    isGolden: pct === 1.618 || pct === 2.618,
  }));

  return { swingLow, swingHigh, range, retracements, extensions };
}

/**
 * Given current price and entry price, return the next Fibonacci target above
 * the current price that (a) is profitable after fees and (b) is an extension level.
 * Also returns the fallback target (closest profitable level even if we miss the top).
 */
function getFibTargets(symbol, entryPrice, gasCostEth, tradeEth, ethUsd) {
  const fibs = getFibLevels(symbol);
  if (!fibs) return null;

  const token = tokens.find(t => t.symbol === symbol);
  const feePct = (token?.poolFeePct || 0.006) * 2; // round-trip
  const gasPct = tradeEth > 0 ? (gasCostEth * 2) / tradeEth : 0;
  const totalCostPct = feePct + gasPct + (PRICE_IMPACT_EST * 2);
  const breakeven = entryPrice * (1 + totalCostPct);

  // Find all extension levels above breakeven, sorted ascending
  const profitableTargets = fibs.extensions
    .filter(e => e.price > breakeven)
    .sort((a, b) => a.price - b.price);

  if (!profitableTargets.length) return null;

  // Partial exit ladder: what % to sell at each level
  // Strategy: scale out — take less at early targets, more at golden zone
  const exitLadder = profitableTargets.map((target, i) => {
    let sellPct;
    if (target.pct === 1.000) sellPct = 0.25;       // 25% at prior high — lock in base profit
    else if (target.pct === 1.272) sellPct = 0.20;  // 20% at first extension
    else if (target.pct === 1.382) sellPct = 0.15;  // 15% at 138.2%
    else if (target.pct === 1.618) sellPct = 0.25;  // 25% at golden wave — the tsunami
    else if (target.pct === 2.000) sellPct = 0.10;  // 10% at 200%
    else if (target.pct === 2.618) sellPct = 0.05;  // 5% at supernova — let it ride
    else sellPct = 0.15;
    return { ...target, sellPct, reached: false };
  });

  // Guaranteed fallback: the very first profitable level (always wins even if we miss the top)
  const fallbackTarget = profitableTargets[0];
  // Dream target: the golden 161.8% or highest available
  const goldenTarget = profitableTargets.find(t => t.pct === 1.618)
    || profitableTargets[profitableTargets.length - 1];

  // Reload zone: best buy-back price on a pullback (61.8% retrace = golden zone entry)
  const reloadZone = fibs.retracements.find(r => r.pct === 0.618)
    || fibs.retracements[fibs.retracements.length - 1];

  return {
    fibs,
    exitLadder,       // all profitable partial-exit targets in order
    fallbackTarget,   // lowest profitable target — guaranteed win if reached
    goldenTarget,     // the "tsunami" target — maximum wave
    reloadZone,       // where to re-buy after a pullback
    breakeven,        // price needed to cover all costs
    totalCostPct,
  };
}

/**
 * Check if any Fibonacci extension target has been hit.
 * Returns the hit target or null. Used in processToken on every cycle.
 * This is the "always hits a mark" logic — checks all levels, sells partial at each.
 */
function checkFibTargetHit(symbol, currentPrice, entryPrice, gasCostEth, tradeEth, ethUsd) {
  if (!entryPrice) return null;
  const targets = getFibTargets(symbol, entryPrice, gasCostEth, tradeEth, ethUsd);
  if (!targets?.exitLadder?.length) return null;

  // FIX: Filter out levels already executed this position to prevent repeat selling.
  // Without this guard, the same fib level fires EVERY 15s loop until position is drained.
  const hitTargets = targets.exitLadder.filter(t =>
    currentPrice >= t.price * 0.998 && // 0.2% tolerance
    !isFibLevelAlreadyExecuted(symbol, t.pct) // skip already-sold levels
  );
  if (!hitTargets.length) return null;

  // Return the highest unexecuted hit target
  return {
    target: hitTargets[hitTargets.length - 1],
    allHit: hitTargets,
    targets,
  };
}

/**
 * Format Fibonacci levels for Telegram display — shows the full wave map
 * so you can see every target and where price is in the structure.
 */
function formatFibDisplay(symbol, currentPrice, entryPrice) {
  const fibs = getFibLevels(symbol);
  if (!fibs) return null;

  const { swingLow, swingHigh, retracements, extensions } = fibs;
  const lines = [];

  lines.push(`📐 <b>FIB LEVELS — ${symbol}</b>`);
  lines.push(`   Swing: $${swingLow.toFixed(6)} → $${swingHigh.toFixed(6)}`);
  lines.push(`   Range: ${(((swingHigh-swingLow)/swingLow)*100).toFixed(1)}%`);
  lines.push(``);

  // Extensions (targets above) — show which ones are above current price
  lines.push(`   🎯 <b>TARGETS (extensions):</b>`);
  for (const e of [...extensions].reverse()) {
    const above = currentPrice < e.price;
    const hit   = currentPrice >= e.price;
    const arrow = hit ? `✅` : above ? `⬆️` : `—`;
    const dist  = ((e.price - currentPrice) / currentPrice * 100).toFixed(1);
    const suffix = e.isGolden ? ` ← 🌊` : ``;
    lines.push(`   ${arrow} ${e.label}: $${e.price.toFixed(6)} (${above?`+`:`-`}${Math.abs(parseFloat(dist))}%)${suffix}`);
  }

  // Current price marker
  lines.push(`   📍 NOW: $${currentPrice.toFixed(6)}`);
  if (entryPrice) lines.push(`   🛒 ENTRY: $${entryPrice.toFixed(6)}`);

  // Retracements (reload zones below) — only show ones below current price
  const validReloads = retracements.filter(r => r.price < currentPrice);
  if (validReloads.length) {
    lines.push(``);
    lines.push(`   🔄 <b>RELOAD ZONES (retracements):</b>`);
    for (const r of validReloads) {
      const dist = ((currentPrice - r.price) / currentPrice * 100).toFixed(1);
      const isGolden = r.pct === 0.618 || r.pct === 0.382;
      lines.push(`   ${isGolden?`⭐`:`   `} ${r.label}: $${r.price.toFixed(6)} (-${dist}%)${isGolden?` ← buy zone`:`}`}`);
    }
  }

  return lines.join(`\n`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🌊🐋 BIG KAHUNA ENGINE — Whale Detection + Volume Surge + Big Wave Prediction
// ═══════════════════════════════════════════════════════════════════════════════
//
// WHAT YOU DESCRIBED: When SEAM had its ATH run, Guardian had no way to see it
// coming — it was just watching price ticks. The Big Kahuna engine adds four
// new data streams that see the wave BEFORE price moves:
//
//  1. WHALE RADAR — GeckoTerminal trades endpoint, filter trades > $500 USD.
//     A single whale buy on a thin Base token ($4-6M mcap) = 5-15% instant move.
//     We detect this WHILE the tx is settling and enter before the cascade.
//
//  2. VOLUME SURGE DETECTOR — Compare current 1h volume vs rolling 6h average.
//     A 3x+ surge in buy volume = institutional or coordinated entry. This is
//     the "disturbance in the water" signal before the big wave forms.
//
//  3. BUY/SELL PRESSURE RATIO — Pool data returns buyer count vs seller count
//     per hour. When buyers outnumber sellers 3:1+ and volume is surging, that's
//     the "wave building" state. Not random noise — directional momentum.
//
//  4. PRICE GAP DETECTOR — If recent OHLCV candles show a gap between the
//     close of one period and the open of the next, that's unfilled value gap.
//     Price returns to fill gaps with ~70% probability. This gives a guaranteed
//     re-entry zone after a big kahuna move (your "reload after the wave" idea).
//
// THE 4 EXIT ROUTES (probability-weighted):
//  Route 1: Fibonacci 161.8% tsunami target — the main ride (highest reward)
//  Route 2: Fibonacci 100% prior high — safe guaranteed profit (always reachable)
//  Route 3: Volume exhaustion exit — when buy/sell ratio flips to seller-dominated
//  Route 4: Time-based exit — if position stales after a whale-triggered entry,
//           exit at any profit rather than waiting for a peak that already passed
//
// BIG KAHUNA STATE MACHINE:
//  CALM     → normal waves, standard algorithm runs
//  STIRRING → whale activity detected OR volume 2x+ surge. Tighten watch.
//  BUILDING → whale + volume surge together. Reduce stale timer to 2 min.
//             Open new positions on any confirmed trough. This is pre-wave.
//  RIDING   → price moving fast (>2% in one cycle). Fibonacci ladder active.
//             All stale tokens cascade into the kahuna immediately.
//  SETTLING → price slows after a big move. Exit remaining positions at
//             any profit. Set reload zone from Fibonacci 61.8% retrace.
// ═══════════════════════════════════════════════════════════════════════════════

// Big Kahuna state per token
const kahunaState = {}; // { [symbol]: { state, whaleVol, volRatio, buyRatio, lastWhale, gapZone, exits } }

const KAHUNA_WHALE_USD      = 500;    // single trade ≥ $500 = whale on thin Base tokens
const KAHUNA_VOL_SURGE_X    = 2.5;   // 1h volume ≥ 2.5x rolling avg = surge
const KAHUNA_BUY_RATIO      = 2.5;   // buyers:sellers ≥ 2.5:1 = directional pressure
const KAHUNA_PRICE_FAST_PCT = 0.015; // 1.5% move in one 15s cycle = fast wave
const KAHUNA_POLL_INTERVAL  = 60_000; // poll whale/volume data every 60s (rate limit friendly)

// Pool address cache — reuse the lookup already done in candle fetching
const poolAddressCache = {}; // { [tokenAddress]: poolAddress }

/**
 * Fetch the top pool address for a token on Base — cached after first lookup.
 */
async function getPoolAddress(tokenAddress) {
  const key = tokenAddress.toLowerCase();
  if (poolAddressCache[key]) return poolAddressCache[key];
  try {
    const r = await fetch(
      `https://api.geckoterminal.com/api/v2/networks/base/tokens/${key}/pools?page=1`,
      { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5000) }
    );
    if (!r.ok) return null;
    const j = await r.json();
    const pools = j?.data;
    if (!Array.isArray(pools) || !pools.length) return null;
    const pool = pools.sort((a, b) =>
      parseFloat(b.attributes?.volume_usd?.h24 || 0) - parseFloat(a.attributes?.volume_usd?.h24 || 0)
    )[0];
    const addr = pool.attributes?.address;
    if (addr) poolAddressCache[key] = addr;
    return addr || null;
  } catch { return null; }
}

/**
 * Fetch recent large trades (whale detection) for a token's pool.
 * Returns array of large trades or empty array.
 * GeckoTerminal free API: /networks/base/pools/{pool}/trades?trade_volume_in_usd_greater_than=500
 */
async function fetchWhaleTrades(tokenAddress) {
  try {
    const poolAddr = await getPoolAddress(tokenAddress);
    if (!poolAddr) return [];
    const r = await fetch(
      `https://api.geckoterminal.com/api/v2/networks/base/pools/${poolAddr}/trades?trade_volume_in_usd_greater_than=${KAHUNA_WHALE_USD}`,
      { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5000) }
    );
    if (!r.ok) return [];
    const j = await r.json();
    const trades = j?.data || [];
    return trades.map(t => ({
      type:      t.attributes?.kind,           // 'buy' or 'sell'
      usd:       parseFloat(t.attributes?.volume_in_usd || 0),
      price:     parseFloat(t.attributes?.price_to_in_usd || 0),
      timestamp: t.attributes?.block_timestamp,
    })).filter(t => t.usd >= KAHUNA_WHALE_USD);
  } catch { return []; }
}

/**
 * Fetch pool stats: 1h volume, 24h volume, buy/sell tx counts.
 * Returns { vol1h, vol24h, buys1h, sells1h, buyers1h, sellers1h, volRatio, buyRatio }
 */
async function fetchPoolStats(tokenAddress) {
  try {
    const poolAddr = await getPoolAddress(tokenAddress);
    if (!poolAddr) return null;
    const r = await fetch(
      `https://api.geckoterminal.com/api/v2/networks/base/pools/${poolAddr}`,
      { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5000) }
    );
    if (!r.ok) return null;
    const j = await r.json();
    const attr = j?.data?.attributes;
    if (!attr) return null;
    const vol1h  = parseFloat(attr.volume_usd?.h1  || 0);
    const vol24h = parseFloat(attr.volume_usd?.h24 || 0);
    const buys1h   = attr.transactions?.h1?.buys   || 0;
    const sells1h  = attr.transactions?.h1?.sells  || 0;
    const buyers1h = attr.transactions?.h1?.buyers || 0;
    const sellers1h= attr.transactions?.h1?.sellers|| 0;
    const volRatio  = vol24h > 0 ? (vol1h / (vol24h / 24)) : 0; // 1h vs hourly avg
    const buyRatio  = sellers1h > 0 ? buyers1h / sellers1h : (buyers1h > 0 ? 10 : 0);
    return { vol1h, vol24h, buys1h, sells1h, buyers1h, sellers1h, volRatio, buyRatio };
  } catch { return null; }
}

/**
 * TOP TRADERS SIGNAL — GeckoTerminal free API
 * ─────────────────────────────────────────────────────────────────────────────
 * GeckoTerminal tracks the most profitable wallets trading each pool.
 * "Top traders" are wallets that consistently buy low and sell high on this token.
 * These are effectively the best-performing algo bots and smart money on Base.
 *
 * HOW WE USE IT:
 *   - If ≥2 top traders bought in the last hour → smart money is entering → buy signal
 *   - If ≥2 top traders sold in the last hour → smart money exiting → sell signal / don't buy
 *   - Returns { smartBuys, smartSells, signal: 'BUY'|'SELL'|'NEUTRAL', confidence }
 *
 * This is the closest free equivalent to "riding successful AI agent signals."
 * GeckoTerminal doesn't label them as AI bots but the top traders on Base DEX pools
 * are almost universally algorithmic. We're piggybacking on whatever works.
 */
const topTraderCache = {}; // { [tokenAddress]: { result, timestamp } }
const TOP_TRADER_TTL = 90_000; // refresh every 90s (rate-limit friendly)

async function fetchTopTraderSignal(tokenAddress) {
  const key = tokenAddress.toLowerCase();
  const cached = topTraderCache[key];
  if (cached && (Date.now() - cached.timestamp) < TOP_TRADER_TTL) return cached.result;

  try {
    const poolAddr = await getPoolAddress(tokenAddress);
    if (!poolAddr) return null;

    // GeckoTerminal top_traders endpoint — returns top 10 traders ranked by PnL
    const r = await fetch(
      `https://api.geckoterminal.com/api/v2/networks/base/pools/${poolAddr}/top_traders?time_frame=hour`,
      { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5000) }
    );
    if (!r.ok) return null;
    const j = await r.json();
    const traders = j?.data || [];
    if (!traders.length) return null;

    // Count smart-money buys vs sells in the last hour
    // top_traders attributes: type ('buyer'|'seller'), volume_usd, pnl_usd
    let smartBuys = 0, smartSells = 0, totalVolBuy = 0, totalVolSell = 0;
    for (const t of traders) {
      const attr = t.attributes || {};
      const traderType = attr.type; // 'buyer' or 'seller'
      const volUsd = parseFloat(attr.volume_in_usd || attr.volume_usd || 0);
      if (traderType === 'buyer')  { smartBuys++;  totalVolBuy  += volUsd; }
      if (traderType === 'seller') { smartSells++; totalVolSell += volUsd; }
    }

    // Signal: BUY if 2+ smart buyers and they outnumber sellers 2:1
    //         SELL if 2+ smart sellers and they outnumber buyers 2:1
    //         NEUTRAL otherwise
    let signal = 'NEUTRAL';
    let confidence = 0;
    if (smartBuys >= 2 && smartBuys >= smartSells * 2) {
      signal = 'BUY';
      confidence = Math.min(90, 40 + smartBuys * 10 + (smartSells === 0 ? 15 : 0));
    } else if (smartSells >= 2 && smartSells >= smartBuys * 2) {
      signal = 'SELL';
      confidence = Math.min(90, 40 + smartSells * 10 + (smartBuys === 0 ? 15 : 0));
    }

    const result = { smartBuys, smartSells, totalVolBuy, totalVolSell, signal, confidence, traders: traders.length };
    topTraderCache[key] = { result, timestamp: Date.now() };
    return result;
  } catch { return null; }
}

/**
 * Detect unfilled price gaps in recent OHLCV data.
 * A gap = current open > prior candle high (gap up) or current open < prior candle low (gap down).
 * Returns the nearest unfilled gap zone as a re-entry target.
 */
function detectPriceGap(symbol) {
  const candles = history[symbol]?.candles;
  if (!Array.isArray(candles) || candles.length < 3) return null;
  const recent = candles.slice(-10); // last 10 candles
  const gaps = [];
  for (let i = 1; i < recent.length; i++) {
    const prev = recent[i - 1];
    const curr = recent[i];
    if (curr.o > prev.h) { // gap UP — unfilled support below
      gaps.push({ type: 'gap_up', fillZone: (prev.h + curr.o) / 2, high: curr.o, low: prev.h });
    } else if (curr.o < prev.l) { // gap DOWN — unfilled resistance above
      gaps.push({ type: 'gap_down', fillZone: (prev.l + curr.o) / 2, high: prev.l, low: curr.o });
    }
  }
  if (!gaps.length) return null;
  const currentPrice = history[symbol]?.lastPrice;
  if (!currentPrice) return null;
  // Return nearest unfilled gap to current price
  return gaps.sort((a, b) => Math.abs(a.fillZone - currentPrice) - Math.abs(b.fillZone - currentPrice))[0] || null;
}

/**
 * Main Big Kahuna scanner — runs every KAHUNA_POLL_INTERVAL ms per token.
 * Updates kahunaState[symbol] with current wave intensity and 4 exit routes.
 * Called from processToken but rate-limited so it doesn't slam the API.
 */
const kahunaLastPoll = {};

async function runKahunaScanner(token, currentPrice, ethUsd) {
  const sym = token.symbol;
  const now  = Date.now();

  // Rate limit: only poll this token once per minute
  if (kahunaLastPoll[sym] && now - kahunaLastPoll[sym] < KAHUNA_POLL_INTERVAL) return;
  kahunaLastPoll[sym] = now;

  try {
    // Fetch both in parallel — pool stats is fast, whale trades slightly slower
    const [poolStats, whaleTrades] = await Promise.all([
      fetchPoolStats(token.address),
      fetchWhaleTrades(token.address),
    ]);

    const ks = kahunaState[sym] || { state: 'CALM', exits: [] };

    // ── Whale signal ────────────────────────────────────────────────────────
    const recentWhales = whaleTrades.filter(t => {
      if (!t.timestamp) return true; // include if no timestamp
      const age = now - new Date(t.timestamp).getTime();
      return age < 300_000; // within last 5 minutes
    });
    const whaleBuys  = recentWhales.filter(t => t.type === 'buy');
    const whaleSells = recentWhales.filter(t => t.type === 'sell');
    const totalWhaleUsd = recentWhales.reduce((s, t) => s + t.usd, 0);
    const whaleBuyUsd   = whaleBuys.reduce((s, t)  => s + t.usd, 0);

    // ── Volume signal ───────────────────────────────────────────────────────
    const volRatio = poolStats?.volRatio || 0;
    const buyRatio = poolStats?.buyRatio || 0;

    // ── Gap detector ────────────────────────────────────────────────────────
    const gap = detectPriceGap(sym);

    // ── State machine ───────────────────────────────────────────────────────
    let newState = 'CALM';
    let intensity = 0;

    if (whaleBuyUsd > KAHUNA_WHALE_USD)          intensity += 3;
    if (whaleSells.length > whaleBuys.length * 2) intensity -= 2; // whale dump warning
    if (volRatio >= KAHUNA_VOL_SURGE_X)           intensity += 2;
    if (buyRatio >= KAHUNA_BUY_RATIO)             intensity += 2;
    if (volRatio >= 1.5 && buyRatio >= 1.5)       intensity += 1; // combo bonus

    if (intensity >= 6)      newState = 'BUILDING'; // whale + volume surge together
    else if (intensity >= 4) newState = 'STIRRING'; // one strong signal
    else if (intensity >= 2) newState = 'WATCHING'; // mild signal
    else                     newState = 'CALM';

    // Detect if we're already in a fast-moving wave
    const prevPrice = ks.lastPrice;
    if (prevPrice && currentPrice) {
      const movePct = Math.abs(currentPrice - prevPrice) / prevPrice;
      if (movePct >= KAHUNA_PRICE_FAST_PCT) {
        newState = 'RIDING'; // override — wave is already in motion
        intensity = Math.max(intensity, 7);
      }
    }

    // ── Build 4 exit routes (probability-weighted) ──────────────────────────
    const fibs = getFibLevels(sym);
    const exits = [];

    if (fibs && token.entryPrice) {
      // Route 1: Tsunami — 161.8% extension
      const tsunami = fibs.extensions.find(e => e.pct === 1.618);
      if (tsunami && tsunami.price > currentPrice) {
        const prob = Math.min(95, Math.round(30 + intensity * 8 + buyRatio * 5));
        exits.push({
          route: 1, label: `🌊 Tsunami 161.8%`, price: tsunami.price,
          probability: prob,
          sellPct: 0.40, // sell 40% here — keep 60% riding
          desc: `+${(((tsunami.price - currentPrice) / currentPrice) * 100).toFixed(1)}% away | ${prob}% prob`,
        });
      }

      // Route 2: Safe harbor — 100% prior high
      const priorHigh = fibs.extensions.find(e => e.pct === 1.000);
      if (priorHigh && priorHigh.price > (token.entryPrice || 0)) {
        const prob = Math.min(90, Math.round(55 + buyRatio * 5));
        exits.push({
          route: 2, label: `✅ Safe Harbor 100%`, price: priorHigh.price,
          probability: prob,
          sellPct: 0.30,
          desc: `Prior high $${priorHigh.price.toFixed(6)} | ${prob}% prob — always reachable`,
        });
      }

      // Route 3: Volume exhaustion — when buyers flip to sellers
      const exhaustionPrice = currentPrice * 1.03; // sell at next 3% if volume fades
      exits.push({
        route: 3, label: `📊 Vol Exhaustion`, price: exhaustionPrice,
        probability: Math.round(40 + volRatio * 10),
        sellPct: 0.25,
        desc: `Triggered when buy/sell ratio drops below 1.0 (sellers take over)`,
        conditional: true, // only fires when buyRatio flips
      });

      // Route 4: Time/gap fallback — price gap fill zone
      if (gap) {
        exits.push({
          route: 4, label: `🔲 Gap Fill`, price: gap.fillZone,
          probability: 70, // gaps fill ~70% of the time
          sellPct: token.entryPrice ? 0.20 : 0,
          desc: `Gap ${gap.type} fill zone $${gap.fillZone.toFixed(6)} — 70% probability`,
        });
      } else if (fibs.retracements.find(r => r.pct === 0.618)) {
        // Fallback route 4: 61.8% retrace re-entry zone
        const reload = fibs.retracements.find(r => r.pct === 0.618);
        exits.push({
          route: 4, label: `🔄 Reload 61.8%`, price: reload.price,
          probability: 65,
          sellPct: 0, // this is a BUY zone, not a sell
          desc: `Re-entry zone after wave settles — buy back at $${reload.price.toFixed(6)}`,
          isBuyZone: true,
        });
      }
    }

    // Sort exits by probability descending
    exits.sort((a, b) => b.probability - a.probability);

    // Save to state
    kahunaState[sym] = {
      state:      newState,
      intensity,
      whaleBuyUsd,
      whaleSells: whaleSells.length,
      volRatio,
      buyRatio,
      exits,
      gap,
      lastPrice:  currentPrice,
      lastUpdate: now,
    };

    // Log if something significant is happening
    if (newState !== 'CALM' && newState !== 'WATCHING') {
      const exitStr = exits.slice(0, 2).map(e => `[${e.label} ${e.probability}%]`).join(' → ');
      console.log(`  🌊 [${sym}] BIG KAHUNA ${newState} | intensity:${intensity} whale:$${whaleBuyUsd.toFixed(0)} vol:${volRatio.toFixed(1)}x buys:${buyRatio.toFixed(1)}:1 | ${exitStr}`);
    }

    // Alert on Telegram if we just jumped to BUILDING or RIDING
    const prevState = ks.state || 'CALM';
    if ((newState === 'BUILDING' || newState === 'RIDING') &&
        prevState !== 'BUILDING' && prevState !== 'RIDING') {

      const exitLines = exits.map((e, i) =>
        `   ${i+1}. ${e.label}: $${e.price.toFixed(6)} (${e.probability}% prob)`
      ).join('\n');

      await tg(
        `🌊 <b>BIG KAHUNA DETECTED — ${sym}!</b>\n` +
        `${'━'.repeat(20)}\n` +
        `📊 State: <b>${newState}</b> | Intensity: ${intensity}/10\n` +
        `🐋 Whale buys: $${whaleBuyUsd.toFixed(0)} USD (last 5min)\n` +
        `📈 Volume surge: ${volRatio.toFixed(1)}x normal\n` +
        `⚡ Buy pressure: ${buyRatio.toFixed(1)}:1 buyers:sellers\n` +
        `${gap ? `🔲 Gap zone: $${gap.fillZone.toFixed(6)} (${gap.type})\n` : ''}` +
        `${'━'.repeat(20)}\n` +
        `🎯 <b>4 EXIT ROUTES:</b>\n${exitLines}\n` +
        `${'━'.repeat(20)}\n` +
        `💲 Current: $${currentPrice.toFixed(8)}\n` +
        `<i>Fibonacci ladder active — riding the wave</i>`
      );
    }

    // Volume exhaustion check — if we're RIDING and buyers flip, trigger Route 3
    if (newState === 'RIDING' && ks.state === 'RIDING' && buyRatio < 0.8 && token.entryPrice) {
      // Sellers now dominate — conditional exit Route 3 fires
      kahunaState[sym].exhaustionAlert = true;
      await tg(
        `📊 <b>VOLUME EXHAUSTION — ${sym}</b>\n` +
        `Buy/sell ratio dropped to ${buyRatio.toFixed(2)}:1 (sellers dominating)\n` +
        `🚦 Route 3 trigger: consider partial exit at $${currentPrice.toFixed(8)}\n` +
        `<i>Guardian will execute if above breakeven</i>`
      );
    }

  } catch (e) {
    // Non-critical — kahuna scanner is best-effort
    console.log(`  ⚠️ Kahuna scanner ${token.symbol}: ${e.message}`);
  }
}

/**
 * Check if the Big Kahuna state should override stale timing or cascade priority.
 * Returns { kahunaActive, staleOverride, shouldCascadeIn, state }
 */
function getKahunaSignal(symbol) {
  const ks = kahunaState[symbol];
  if (!ks) return { kahunaActive: false, state: 'CALM' };
  const age = Date.now() - (ks.lastUpdate || 0);
  if (age > 10 * 60_000) return { kahunaActive: false, state: 'CALM' }; // stale after 10min

  const kahunaActive = ks.state === 'BUILDING' || ks.state === 'RIDING';
  const staleOverride = kahunaActive ? 2 * 60_000 : null; // compress stale window to 2min during kahuna
  const shouldCascadeIn = ks.state === 'RIDING'; // cascade stale positions into this token when riding

  return { kahunaActive, staleOverride, shouldCascadeIn, state: ks.state, intensity: ks.intensity, exits: ks.exits || [] };
}

// Net margin gate — now includes estimated price impact on both sides
function calcNetMargin(symbol, gasCostEth, tradeEth) {
  const maxPeak = getMaxPeak(symbol);
  const minTrgh = getMinTrough(symbol);
  if (!maxPeak || !minTrgh || minTrgh <= 0) return null;
  const token    = tokens.find(t => t.symbol === symbol);
  const grossPct = (maxPeak - minTrgh) / minTrgh;
  const feePct   = token?.poolFeePct || 0.006;
  const gasPct   = tradeEth > 0 ? (gasCostEth * 2) / tradeEth : 0;
  const impactPct= PRICE_IMPACT_EST * 2; // buy + sell side impact
  return grossPct - (feePct * 2) - gasPct - impactPct;
}

function getArmStatus(symbol, gasCostEth, tradeEth) {
  const pc = getPeakCount(symbol), tc = getTroughCount(symbol);
  if (pc < MIN_PEAKS_TO_TRADE || tc < MIN_TROUGHS_TO_TRADE) {
    return { armed: false, reason: `need ${MIN_PEAKS_TO_TRADE}P/${MIN_TROUGHS_TO_TRADE}T (have ${pc}P/${tc}T)` };
  }
  const net   = calcNetMargin(symbol, gasCostEth, tradeEth);
  if (net === null) return { armed: false, reason: "no wave data" };
  const token = tokens.find(t => t.symbol === symbol);
  const minNM = token?.minNetMargin || MIN_NET_MARGIN;
  if (net < minNM) {
    // Dead-wave detection: if the GROSS range (peak-to-trough) is smaller than the
    // round-trip fee, this token's wave will NEVER be tradeable at this capital level.
    // Flag it clearly rather than showing a confusing "need 0.5%" message forever.
    const token = tokens.find(t => t.symbol === symbol);
    const feePct = (token?.poolFeePct || 0.006) * 2;
    const grossPct = (calcNetMargin(symbol, 0, 1) || 0) + feePct; // add fees back to get gross
    if (grossPct < feePct * 1.5) {
      return { armed: false, reason: `⚠️ DEAD WAVE: range ${(grossPct*100).toFixed(2)}% (needs ${(minNM*100).toFixed(1)}%+ net to clear fees)` };
    }
    return { armed: false, reason: `net margin ${(net*100).toFixed(2)}% (need ${(minNM*100).toFixed(1)}%)` };
  }
  const priority = net >= PRIORITY_MARGIN ? "PRIORITY" : net >= 0.03 ? "STANDARD" : "THIN";
  return { armed: true, net, priority };
}

function getCascadePct(netMargin) {
  if (netMargin >= PRIORITY_MARGIN) return 0.70;
  if (netMargin >= 0.030)           return 0.50;
  return 0.30;
}

// Dead wave skip tracker — tokens that NEVER clear fees waste a full cycle each loop
// After DEAD_WAVE_SKIP_AFTER consecutive dead-wave cycles, skip for 50 cycles then recheck.
const DEAD_WAVE_SKIP_AFTER = 5;
const deadWaveStreak = {};    // { [symbol]: count }
const deadWaveSkipUntil = {}; // { [symbol]: cycleCount }
let globalCycleCount = 0;

function isDeadWaveSkipped(symbol) {
  const skipUntil = deadWaveSkipUntil[symbol];
  if (!skipUntil) return false;
  if (globalCycleCount < skipUntil) return true;
  // Time to recheck — reset and allow one cycle through
  delete deadWaveSkipUntil[symbol];
  deadWaveStreak[symbol] = 0;
  return false;
}

function recordDeadWaveCycle(symbol) {
  deadWaveStreak[symbol] = (deadWaveStreak[symbol] || 0) + 1;
  if (deadWaveStreak[symbol] >= DEAD_WAVE_SKIP_AFTER) {
    deadWaveSkipUntil[symbol] = globalCycleCount + 50; // sleep 50 cycles (~12.5min)
    console.log(`💤 [${symbol}] Dead wave x${DEAD_WAVE_SKIP_AFTER} — skipping 50 cycles to stop wasting loop time`);
  }
}

// Can this token trade? Cascade targets get a shorter grace period
function canTrade(symbol, isCascade = false) {
  const now = Date.now();
  if (isCascade && cascadeTime[symbol]) {
    return now - cascadeTime[symbol] >= CASCADE_COOLDOWN;
  }
  return now - (lastTradeTime[symbol] || 0) >= COOLDOWN_MS;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 💰 UNIFIED ETH+WETH BALANCE — the core fix for "out of ETH" bug
// ═══════════════════════════════════════════════════════════════════════════════
async function getEthBalance()   { return parseFloat(formatEther(await rpcCall(c => c.getBalance({ address: WALLET_ADDRESS })))); }
async function getWethBalance()  {
  try { return parseFloat(formatEther(await rpcCall(c => c.readContract({ address: WETH_ADDRESS, abi: ERC20_ABI, functionName: "balanceOf", args: [WALLET_ADDRESS] })))); }
  catch { return 0; }
}
async function getTokenBalance(address) {
  try { return Number(await rpcCall(c => c.readContract({ address, abi: ERC20_ABI, functionName: "balanceOf", args: [WALLET_ADDRESS] }))) / 1e18; }
  catch { return 0; }
}

// Returns { eth, weth, total, tradeable } — WETH is always included
async function getFullBalance() {
  const eth  = await getEthBalance();
  const weth = await getWethBalance();
  const total = eth + weth;
  // Reserve = max of percentage reserve OR hard minimums + piggy
  const reserved   = Math.max(total * ETH_RESERVE_PCT, GAS_RESERVE + SELL_RESERVE + piggyBank);
  const tradeable  = Math.max(eth - GAS_RESERVE - SELL_RESERVE, 0); // ETH minus gas costs
  const tradeableWithWeth = Math.max(total - reserved, 0);           // full spendable
  return { eth, weth, total, tradeable, tradeableWithWeth };
}

// Wraps ETH → WETH when WETH needed for a swap
const WETH_ABI_DEPOSIT = [{ name: "deposit", type: "function", stateMutability: "payable", inputs: [], outputs: [] }];
async function wrapEth(cdp, amountEth) {
  try {
    console.log(`   🔄 Wrapping ${amountEth.toFixed(6)} ETH → WETH`);
    const amountWei = parseEther(amountEth.toFixed(18));
    await cdp.evm.sendTransaction({
      address: WALLET_ADDRESS, network: "base",
      transaction: { to: WETH_ADDRESS, value: amountWei, data: "0xd0e30db0" }, // deposit()
    });
    await sleep(6000);
    console.log(`   ✅ Wrapped ${amountEth.toFixed(6)} ETH → WETH`);
    return true;
  } catch (e) {
    console.log(`   ❌ Wrap failed: ${e.message}`);
    return false;
  }
}
async function unwrapWeth(cdp, amountWeth) {
  try {
    const WETH_ABI = [{ name: "withdraw", type: "function", inputs: [{ name: "wad", type: "uint256" }], outputs: [] }];
    const amountIn = parseEther(amountWeth.toFixed(18));
    await Promise.race([
      cdp.evm.sendTransaction({
        address: WALLET_ADDRESS, network: "base",
        transaction: { to: WETH_ADDRESS, data: "0x2e1a7d4d" + amountIn.toString(16).padStart(64, "0") }
      }),
      new Promise((_, r) => setTimeout(() => r(new Error("unwrap timeout 30s")), 30000))
    ]);
    await sleep(3000);
    return true;
  } catch (e) {
    console.log(`   ⚠️  unwrapWeth failed: ${e.message}`);
    return false;
  }
}


// Unwraps WETH → native ETH so gas fees can be paid.
// Gas on Base always requires native ETH — WETH cannot pay gas directly.
// This is called automatically when native ETH drops below GAS_TOPUP_THRESHOLD.
const WETH_ABI_WITHDRAW = [{ name: "withdraw", type: "function", stateMutability: "nonpayable", inputs: [{ name: "wad", type: "uint256" }], outputs: [] }];
async function unwrapEth(cdp, amountEth) {
  try {
    console.log(`   🔄 Unwrapping ${amountEth.toFixed(6)} WETH → ETH (gas top-up)`);
    const amountWei = parseEther(amountEth.toFixed(18));
    // withdraw(uint256) selector = 0x2e1a7d4d
    const data = "0x2e1a7d4d" + amountWei.toString(16).padStart(64, "0");
    await cdp.evm.sendTransaction({
      address: WALLET_ADDRESS, network: "base",
      transaction: { to: WETH_ADDRESS, gas: BigInt(60_000), data },
    });
    await sleep(5000);
    console.log(`   ✅ Unwrapped ${amountEth.toFixed(6)} WETH → ETH`);
    return true;
  } catch (e) {
    console.log(`   ❌ Unwrap failed: ${e.message}`);
    return false;
  }
}

// Refresh all token balances in parallel — call once per loop, use cache in Telegram
async function refreshTokenBalances() {
  const results = await Promise.allSettled(
    tokens.map(t => getTokenBalance(t.address).then(bal => ({ symbol: t.symbol, bal })))
  );
  for (const r of results) {
    if (r.status === "fulfilled") tokenBalanceCache[r.value.symbol] = r.value.bal;
  }
}

function getCachedBalance(symbol) {
  return tokenBalanceCache[symbol] ?? 0;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 💱 PRICES
// ═══════════════════════════════════════════════════════════════════════════════
async function getTokenPrice(address, hasPosition = false) {
  const key = address.toLowerCase();

  // Return cached price if fresh enough — avoids rate-limiting
  if (!isPriceCacheStale(address, hasPosition)) {
    return getCachedPrice(address);
  }

  // ── Fetch fresh price ────────────────────────────────────────────────────
  // GeckoTerminal: supports batch requests — try this first
  try {
    const r = await fetch(`https://api.geckoterminal.com/api/v2/simple/networks/base/token_price/${key}`, { signal: AbortSignal.timeout(5000) });
    if (r.ok) {
      const d = await r.json();
      const p = parseFloat(d?.data?.attributes?.token_prices?.[key]);
      if (!isNaN(p) && p > 0) { setCachedPrice(address, p); return p; }
    }
  } catch {}

  // Fallback: DexScreener
  try {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${address}`, { signal: AbortSignal.timeout(5000) });
    if (r.ok) {
      const d = await r.json();
      const p = parseFloat(d?.pairs?.find(x => x.chainId === "base")?.priceUsd);
      if (!isNaN(p) && p > 0) { setCachedPrice(address, p); return p; }
    }
  } catch {}

  // Both failed — increment fail count, return last known price if we have it
  const existing = priceCache[key];
  if (existing) {
    existing.failCount = (existing.failCount || 0) + 1;
    // Keep returning stale price for up to 3 failures (45s) before giving up
    if (existing.failCount <= 3) return existing.price;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🏇 RACE DISPLAY
// ═══════════════════════════════════════════════════════════════════════════════
function buildRaceDisplay(token, price, balance, ethUsd) {
  const entry   = token.entryPrice;
  const invEth  = token.totalInvestedEth || 0;
  const invUsd  = invEth * ethUsd;
  if (!entry || entry <= 0) return null;

  const sellTarget = getMaxPeak(token.symbol);
  const validST    = sellTarget && sellTarget > entry;
  const lottery    = calcLotteryKeep(balance);
  const sellable   = Math.max(balance - lottery, 0);
  const nowUsd     = sellable * price;
  const tgtUsd     = validST ? sellable * sellTarget : null;
  const pnlUsd     = nowUsd - invUsd;
  const pnlPct     = invUsd > 0 ? pnlUsd / invUsd * 100 : 0;
  const raceRange  = validST && sellTarget > entry ? sellTarget - entry : 0;
  const racePct    = raceRange > 0 ? Math.max(0, Math.min(100, (price - entry) / raceRange * 100)) : 0;
  const barFill    = Math.floor(racePct / 10);
  const raceBar    = "🟩".repeat(barFill) + "⬜".repeat(10 - barFill);
  const ind        = getIndicatorScore(token.symbol);

  // Projected profit when MAX peak is hit
  const projNetUsd    = tgtUsd !== null ? tgtUsd * (1 - (token.poolFeePct||0.006)) - invUsd : null;
  const projPiggy     = tgtUsd !== null ? (tgtUsd / ethUsd * 0.01 * ethUsd).toFixed(2) : null;
  const distanceToTgt = sellTarget ? ((sellTarget - price) / price * 100).toFixed(2) : "?";

  return {
    bar: raceBar, racePct: racePct.toFixed(1),
    nowUsd: nowUsd.toFixed(2), tgtUsd: tgtUsd?.toFixed(2) || "?",
    invUsd: invUsd.toFixed(2), pnlUsd: pnlUsd.toFixed(2),
    pnlPct: pnlPct.toFixed(1), pnlSign: pnlUsd >= 0 ? "+" : "",
    sellTarget, entry, balance, sellable, lottery,
    lines: [
      `🏇 [${raceBar}] ${racePct.toFixed(1)}% — ${distanceToTgt}% left to target`,
      `📥 Entry: $${entry.toFixed(8)} | Invested: $${invUsd.toFixed(2)}`,
      `💲 NOW: $${price.toFixed(8)} → sell now ~$${nowUsd.toFixed(2)}`,
      `🎯 TARGET (MAX peak): $${sellTarget?.toFixed(8)||"?"} → ~$${tgtUsd?.toFixed(2)||"?"}`,
      `${pnlUsd>=0?"📈":"📉"} NOW P&L: ${pnlUsd>=0?"+":""}$${pnlUsd.toFixed(2)} (${pnlPct>=0?"+":""}${pnlPct.toFixed(1)}%)`,
      projNetUsd !== null ? `🎯 AT TARGET: +$${projNetUsd.toFixed(2)} profit | 🐷 $${projPiggy} skim` : `🎯 TARGET P&L: calculating...`,
      `💓 ${ind.detail || "building..."}`,
      `🪙 ${sellable>=1?Math.floor(sellable):sellable.toFixed(4)} tokens | 🎰 ${lottery} forever`,
    ].join("\n"),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🔓 APPROVE + ENCODE
// ═══════════════════════════════════════════════════════════════════════════════
function encodeSwap(tokenIn, tokenOut, amountIn, recipient, fee = 3000, amountOutMin = 0n) {
  const p = (v, isAddr = false) => (isAddr ? v.slice(2) : BigInt(v).toString(16)).padStart(64, "0");
  return "0x04e45aaf" + p(tokenIn,true) + p(tokenOut,true) + p(fee) + p(recipient,true) + p(amountIn) + p(amountOutMin) + p(0);
}
function encodeApprove(spender, amount) {
  return "0x095ea7b3" + spender.slice(2).padStart(64,"0") + amount.toString(16).padStart(64,"0");
}
async function ensureApproved(cdp, tokenAddress, amountIn) {
  const MAX = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
  const key = tokenAddress.toLowerCase();
  if (approvedTokens.has(key)) return;
  const al = await rpcCall(c => c.readContract({ address: tokenAddress, abi: ERC20_ABI, functionName: "allowance", args: [WALLET_ADDRESS, SWAP_ROUTER] }));
  if (al >= amountIn) { approvedTokens.add(key); return; }
  console.log(`      🔓 Approving ${tokenAddress.slice(0,10)}...`);
  await Promise.race([
    cdp.evm.sendTransaction({ address: WALLET_ADDRESS, network: "base", transaction: { to: tokenAddress, data: encodeApprove(SWAP_ROUTER, MAX) } }),
    new Promise((_, r) => setTimeout(() => r(new Error(`Approve tx timeout 45s`)), TX_TIMEOUT_MS))
  ]);
  approvedTokens.add(key);
  await sleep(4000); // reduced from 8s
}

// ═══════════════════════════════════════════════════════════════════════════════
// 💱 ETH/WETH BALANCE MANAGER — keeps gas ETH topped up, WETH ready for trades
// Runs before every buy decision. Ensures the bot never runs out of either.
// ETH and WETH are interchangeable — whichever is up, the other can be refilled.
// ═══════════════════════════════════════════════════════════════════════════════
const ETH_MIN_OPERATING  = 0.003;  // always keep at least 0.003 ETH liquid for gas
const WETH_MIN_OPERATING = 0.002;  // always keep at least 0.002 WETH ready for swaps

async function manageEthWethBalance(cdp) {
  try {
    const eth  = await getEthBalance();
    const weth = await getWethBalance();
    const total = eth + weth;
    // Case 1: ETH running low but WETH available — unwrap some to keep gas funded
    if (eth < ETH_MIN_OPERATING && weth > ETH_MIN_OPERATING) {
      const needed = ETH_MIN_OPERATING - eth + 0.001; // top up with a small buffer
      if (needed > 0.0005 && weth - needed >= WETH_MIN_OPERATING) {
        console.log(`   💱 ETH low (${eth.toFixed(4)}) — unwrapping ${needed.toFixed(4)} WETH to top up gas`);
        await unwrapWeth(cdp, needed);
      }
    }
    // Case 2: WETH very low but ETH has surplus — wrap some for trade efficiency
    if (weth < WETH_MIN_OPERATING && eth > ETH_MIN_OPERATING + 0.005) {
      const toWrap = Math.min(eth - ETH_MIN_OPERATING - 0.001, 0.005);
      if (toWrap > 0.001) {
        console.log(`   💱 WETH low (${weth.toFixed(4)}) — wrapping ${toWrap.toFixed(4)} ETH for trade efficiency`);
        await wrapEth(cdp, toWrap);
      }
    }
  } catch (e) { /* non-blocking — balance management is best-effort */ }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 📡 BLOCKCHAIN TELEGRAM PROTOCOL (BTP) — on-chain messaging via trade calldata
// ───────────────────────────────────────────────────────────────────────────────
// Every trade carries one message chunk embedded in the tx calldata.
// Chunks are hash-linked (each references the hash of the previous) so they
// form a provable sequence — like a flip book across the chain.
// Anyone who collects the txs in order and decodes UTF-8 reads the full message.
//
// FORMAT per chunk (always fits variable calldata):
//   [BTP:name:seq/total:prevHash4] message content here...
//   e.g. [BTP:VITA:001/003:0000] Eureka! VITA lives ♥ love you Kryst
//        [BTP:VITA:002/003:a3f9] ian, Kai & Koda! We did it! xoxo —
//        [BTP:VITA:003/003:b7c2] Love, DA | ᛞᚨᚡᛁᛞ | "The truth is...
//
// HEADER is always 28 bytes — content fills the rest up to available space.
// Available space = 16384 bytes max calldata - existing swap data (~512 bytes).
// In practice ~800-1200 bytes free per trade tx. Most messages fit in 1-2 chunks.
//
// AUTO-FILL: if no custom message is queued, the VITA inscription fills every slot.
// QUEUE: /transmit <message> queues a custom message. Chunks ride trades in order.
// READ RECEIPT: Telegram notifies chunk by chunk AND on full completion.
// PENDING: visible in /status as "📡 N chunks pending"
// ═══════════════════════════════════════════════════════════════════════════════

const INSCRIPTION_MESSAGE =
  `Eureka! VITA lives \u2665 love you Krystian, Kai & Koda! We did it! xoxo` +
  ` \u2014 Love, DA | \u16DE\u16A8\u16A1\u16AA\u16DE` +
  ` | "The truth is the chain. The chain is alive. The heartbeat never stops."` +
  ` \u2014 INFINITUM \u00D7 IKN \u00D7 The Living Network`;

// ── BTP STATE ─────────────────────────────────────────────────────────────────
const btpQueue = [];       // [{ name, chunks:[string], sent:0, totalChunks, prevHash }]

// Simple 4-char hash of a string for chain linking
function btpHash4(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16).slice(0, 4).padStart(4, "0");
}

// Encode UTF-8 string to 0x hex for calldata
function encodeInscription(text) {
  return "0x" + Buffer.from(text, "utf8").toString("hex");
}

// Chunk a message into pieces that fit calldata.
// Header = "[BTP:name:001/999:xxxx] " = ~26 chars. Payload fills the rest.
// We use 900 chars per chunk — safe headroom below any realistic calldata limit.
const BTP_PAYLOAD_SIZE = 900;
function btpChunkMessage(name, message) {
  const chunks = [];
  let pos = 0;
  while (pos < message.length) {
    chunks.push(message.slice(pos, pos + BTP_PAYLOAD_SIZE));
    pos += BTP_PAYLOAD_SIZE;
  }
  return chunks;
}

// Enqueue a new message — splits into chunks and adds to queue
function btpEnqueue(name, message) {
  const rawChunks = btpChunkMessage(name, message);
  btpQueue.push({
    name,
    chunks:      rawChunks,
    sent:        0,
    totalChunks: rawChunks.length,
    prevHash:    "0000",
    startTime:   Date.now(),
  });
  console.log(`📡 BTP: queued "${name}" — ${rawChunks.length} chunk(s)`);
}

// Load the default VITA inscription into the queue if nothing else is pending
function btpEnsureDefault() {
  if (btpQueue.length === 0) {
    btpEnqueue("VITA", INSCRIPTION_MESSAGE);
  }
}

// Get the next chunk to inscribe — from queue head, or refill with default
function btpNextChunk(tradeLabel) {
  btpEnsureDefault();
  const msg = btpQueue[0];
  const seq = msg.sent + 1;
  const tot = msg.totalChunks;
  const payload = msg.chunks[msg.sent];
  const header  = `[BTP:${msg.name}:${String(seq).padStart(3,"0")}/${String(tot).padStart(3,"0")}:${msg.prevHash}][${tradeLabel}] `;
  const full    = header + payload;
  // Update hash link for next chunk
  msg.prevHash  = btpHash4(full);
  msg.sent++;
  const isComplete = msg.sent >= msg.totalChunks;
  // isDefault = this is the background VITA auto-fill, not a user-sent message
  const isDefault = msg.name === "VITA";
  if (isComplete) btpQueue.shift(); // remove completed message
  return { full, seq, tot, name: msg.name, isComplete, isDefault };
}

// How many chunks are pending across all queued messages (excluding default auto-fill)
function btpPendingCount() {
  return btpQueue
    .filter(m => m.name !== "VITA")
    .reduce((s, m) => s + (m.totalChunks - m.sent), 0);
}

// The main inscription function — called after every buy/sell
// Fires async, never blocks a trade, never throws to caller
async function btpInscribe(cdp, tradeLabel) {
  try {
    const gwei = await getCurrentGasGwei();
    if (gwei > MAX_GAS_GWEI) {
      console.log(`   📡 BTP: inscription skipped — gas spike (${gwei.toFixed(1)} gwei)`);
      return;
    }
    const { full, seq, tot, name, isComplete, isDefault } = btpNextChunk(tradeLabel);
    const data = encodeInscription(full);

    const { transactionHash } = await Promise.race([
      cdp.evm.sendTransaction({
        address: WALLET_ADDRESS,
        network: "base",
        transaction: { to: WALLET_ADDRESS, value: BigInt(0), data }
      }),
      new Promise((_, r) => setTimeout(() => r(new Error("BTP tx timeout")), 30_000))
    ]);

    console.log(`   📡 BTP [${name} ${seq}/${tot}] → ${transactionHash}`);
    console.log(`      "${full.slice(0, 80)}${full.length > 80 ? "..." : ""}"`);

    // ── Read receipts ────────────────────────────────────────────────────────
    if (isDefault) {
      // VITA auto-fill — send a quiet receipt with BaseScan link so you can verify
      await tg(
        `📡 <b>BTP — VITA inscribed on Base</b>\n` +
        `🔗 <a href="https://basescan.org/tx/${transactionHash}">View on BaseScan ↗</a>\n` +
        `<i>Input Data → UTF-8 to read the message</i>`
      );
    } else {
      // Custom message — chunk by chunk receipt
      await tg(
        `📡 <b>BTP CHUNK SENT [${seq}/${tot}]</b>\n` +
        `📨 Message: <b>${name}</b>\n` +
        `🔗 <a href="https://basescan.org/tx/${transactionHash}">View on BaseScan ↗</a>\n` +
        `<code>${full.slice(0, 120)}${full.length > 120 ? "..." : ""}</code>\n` +
        (btpPendingCount() > 0 ? `⏳ ${btpPendingCount()} chunk(s) still pending` : ``)
      );
    }

    if (isComplete && !isDefault) {
      // Full completion receipt for custom messages
      await tg(
        `✅ <b>BTP TRANSMISSION COMPLETE</b>\n` +
        `📨 "<b>${name}</b>" fully inscribed on Base blockchain\n` +
        `📦 ${tot} chunk(s) | sealed across ${tot} trade transaction(s)\n` +
        `🔍 Decode: collect all BTP:${name} txs in sequence, read UTF-8 calldata\n` +
        `🌐 Permanent. Immutable. Yours forever on Base.`
      );
    }

    if (isComplete && isDefault) {
      // VITA auto-fill completed — silently re-enqueue it so next trade is covered
      // No Telegram notification — this is background noise, not a user message
      btpEnqueue("VITA", INSCRIPTION_MESSAGE);
    }

  } catch (e) {
    console.log(`   📡 BTP inscription failed (non-blocking): ${e.message}`);
  }
}


async function executeBuy(cdp, token, bal, reason, price, forcedEth = 0, isCascade = false) {
  try {
    if (!canTrade(token.symbol, isCascade)) { console.log(`   ⏳ ${token.symbol} cooldown`); return false; }
    if (drawdownHaltActive)                 { console.log(`   🛑 ${token.symbol} drawdown halt active`); return false; }

    const ethUsd   = await getLiveEthPrice();
    const gasCost  = await estimateGasCostEth();
    // FIX: gwei must be fetched locally — the main-loop `gwei` is not in scope here
    const gwei     = await getCurrentGasGwei();

    // Gas spike check before every trade
    if (!(await isGasSafe())) return false;

    // Unified balance: ETH + WETH
    const { eth, weth, tradeableWithWeth } = bal;
    const totalAvail = eth + weth - GAS_RESERVE - SELL_RESERVE;
    if (totalAvail < MIN_ETH_TRADE)          { console.log(`   🛑 Insufficient ETH+WETH: ${totalAvail.toFixed(6)}`); return false; }
    const posUsd = totalAvail * ethUsd;
    if (posUsd < MIN_POS_USD)               { console.log(`   🛑 Wallet too small: $${posUsd.toFixed(2)} (need $${MIN_POS_USD})`); return false; }

    const armStatus = getArmStatus(token.symbol, gasCost, totalAvail);
    const maxPct    = armStatus.armed ? getCascadePct(armStatus.net) : 0.30;

    // ── TIER-AWARE SIZING ────────────────────────────────────────────────────
    // Use the global tier assignments computed at the top of the main loop.
    // Tier 1 (top 3 by score) gets 65% of capital split 3 ways.
    // Tier 2 (next N by score) gets 35% split by slot count.
    // Tokens outside both tiers get $0 new capital — moonshot holds only.
    const tierEth   = calcTierSlotEth(token.symbol, currentTier1, currentTier2, totalAvail, ethUsd);
    const tierLabel = currentTier1.includes(token.symbol) ? "T1" : currentTier2.includes(token.symbol) ? "T2" : "OUT";

    if (!isCascade && tierEth === 0) {
      console.log(`   🛑 ${token.symbol}: not in active tiers (${tierLabel}) — no new capital`);
      return false;
    }

    const maxSpend  = Math.min(totalAvail * maxPct, forcedEth > 0 ? forcedEth : tierEth * 1.2);
    const minSpend  = MIN_POS_USD / ethUsd;
    const ethToSpend= forcedEth > 0
      ? Math.min(forcedEth, maxSpend)
      : Math.min(Math.max(minSpend, tierEth), maxSpend);

    const amountIn  = parseEther(ethToSpend.toFixed(18));

    // Smart payment selection: prefer WETH (saves wrap gas), fall back to ETH,
    // wrap ETH → WETH if we need more WETH than available
    let useWeth = weth >= ethToSpend;
    if (!useWeth && weth > 0 && eth - GAS_RESERVE >= ethToSpend) {
      // Have enough ETH to cover — use ETH directly (no wrap needed)
      useWeth = false;
    } else if (!useWeth && weth > 0 && eth + weth - GAS_RESERVE >= ethToSpend) {
      // Need to wrap some ETH to top up WETH
      const wrapAmount = ethToSpend - weth + 0.0001;
      const wrapped = await wrapEth(cdp, wrapAmount);
      if (wrapped) useWeth = true;
      else useWeth = false; // fall back to direct ETH if wrap fails
    }

    // Slippage guard using live ETH price
    const minTokens = BigInt(Math.floor((ethToSpend * ethUsd / price) * SLIPPAGE_GUARD * 1e18));

    const ind = getIndicatorScore(token.symbol);
    console.log(`\n   🟢 BUY ${token.symbol} [${tierLabel}] — ${reason}`);
    console.log(`      ${ethToSpend.toFixed(6)} ${useWeth?"WETH":"ETH"} @ $${price.toFixed(8)} (ETH=$${ethUsd.toFixed(0)})`);
    console.log(`      MIN trough: $${getMinTrough(token.symbol)?.toFixed(8)||"?"} | MAX peak target: $${getMaxPeak(token.symbol)?.toFixed(8)||"?"}`);
    console.log(`      💓 Indicators: ${ind.detail}`);
    if (armStatus.armed) console.log(`      Net margin (w/ impact): ${(armStatus.net*100).toFixed(2)}% [${armStatus.priority}] | Tier: ${tierLabel}`);

    let txHash;
    // 300_000 gas ceiling: safe for any Uniswap V3 single-hop swap on Base.
    // Bypasses CDP's internal eth_estimateGas call which fails when native ETH
    // balance is thin — "unable to estimate gas" errors killed otherwise perfect trades.
    // Actual gas used by these swaps is typically 130k-180k, so 300k is safe headroom.
    const GAS_CEILING = BigInt(300_000);
    if (useWeth) {
      await ensureApproved(cdp, WETH_ADDRESS, amountIn);
      const _txParams1 = { address: WALLET_ADDRESS, network: "base",
        transaction: { to: SWAP_ROUTER, gas: GAS_CEILING, data: encodeSwap(WETH_ADDRESS, token.address, amountIn, WALLET_ADDRESS, token.feeTier, minTokens) } };
      const { transactionHash } = await Promise.race([
        orchReady
          ? orch.injectAndSend(_txParams1, { isOwnerTrade: true, currentGwei: gwei })
          : cdp.evm.sendTransaction(_txParams1),
        new Promise((_, r) => setTimeout(() => r(new Error(`BUY tx timeout 45s`)), TX_TIMEOUT_MS))
      ]);
      txHash = transactionHash;
    } else {
      const _txParams2 = { address: WALLET_ADDRESS, network: "base",
        transaction: { to: SWAP_ROUTER, gas: GAS_CEILING, value: amountIn, data: encodeSwap(WETH_ADDRESS, token.address, amountIn, WALLET_ADDRESS, token.feeTier, minTokens) } };
      const { transactionHash } = await Promise.race([
        orchReady
          ? orch.injectAndSend(_txParams2, { isOwnerTrade: true, currentGwei: gwei })
          : cdp.evm.sendTransaction(_txParams2),
        new Promise((_, r) => setTimeout(() => r(new Error(`BUY tx timeout 45s`)), TX_TIMEOUT_MS))
      ]);
      txHash = transactionHash;
    }

    lastTradeTime[token.symbol] = Date.now();
    if (isCascade) cascadeTime[token.symbol] = Date.now();
    tradeCount++;
    // Invalidate cached balance — forces fresh read next loop after buy
    tokenBalanceCache[token.symbol] = 0;

    // 📜 On-chain inscription — embeds message permanently on Base blockchain
    // Fires async, never blocks the trade. ~$0.0001 gas cost.
    btpInscribe(cdp, `BUY #${tradeCount} ${token.symbol} @ $${price.toFixed(8)}`).catch(() => {});

    // ── Cost basis tracking: weighted average entry price ─────────────────────
    // When adding to an existing position, blend the entry prices so P&L display
    // and breakeven calculation reflect the true average cost, not just the latest buy.
    const prevInvested = token.totalInvestedEth || 0;
    const prevTokenBal = getCachedBalance(token.symbol); // tokens already held
    token.totalInvestedEth = prevInvested + ethToSpend;
    if (prevInvested > 0 && prevTokenBal > 0 && token.entryPrice) {
      // Weighted average: (prevTokens * prevEntryPrice + newTokens * newPrice) / totalTokens
      const newTokensEstimate = (ethToSpend * ethUsd) / price;
      const totalTokensEstimate = prevTokenBal + newTokensEstimate;
      token.entryPrice = ((prevTokenBal * token.entryPrice) + (newTokensEstimate * price)) / totalTokensEstimate;
    } else {
      token.entryPrice = price;
    }
    token.entryTime = Date.now();
    tradeLog.push({ type: "BUY", symbol: token.symbol, price, ethSpent: ethToSpend, timestamp: new Date().toISOString(), tx: txHash, reason, indScore: ind.score });
    await appendToLedger({ type:"BUY", tradeNum:tradeCount, symbol:token.symbol, price, ethSpent:ethToSpend, usdValue:ethToSpend*ethUsd, ethUsd, timestamp:new Date().toISOString(), tx:txHash, basescan:`https://basescan.org/tx/${txHash}`, reason, indScore:ind.score, indDetail:ind.detail, priority:armStatus.priority||"?", netMargin:armStatus.net||0, minTrough:getMinTrough(token.symbol), maxPeak:getMaxPeak(token.symbol), wallet:WALLET_ADDRESS, signature:"Eureka! VITA lives 💓 love you Krystian, Kai & Koda! We did it! xoxo — Love, DA | 𝔻𝔸𝕍𝕀𝔻 | \"The truth is the chain. The chain is alive. The heartbeat never stops.\" — INFINITUM × IKN × The Living Network" });

    console.log(`      ✅ https://basescan.org/tx/${txHash}`);
    console.log(`      💌 Eureka! VITA lives 💓 love you Krystian, Kai & Koda! We did it! xoxo — Love, DA | 𝔻𝔸𝕍𝕀𝔻 | \"The truth is the chain. The chain is alive. The heartbeat never stops.\" — INFINITUM × IKN × The Living Network`);
    const targetPct = getMaxPeak(token.symbol) ? ((getMaxPeak(token.symbol) - price) / price * 100).toFixed(1) : "?";
    await tg(
      `✅🟢 <b>BOUGHT ${token.symbol}! #${tradeCount}</b>\n` +
      `[⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜] 0% — wave begins!\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🛒 Entry:       $${price.toFixed(8)}\n` +
      `💰 Spent:       ${ethToSpend.toFixed(6)} ${useWeth?"WETH":"ETH"} (~$${(ethToSpend*ethUsd).toFixed(2)})\n` +
      `🎯 Sell target: $${getMaxPeak(token.symbol)?.toFixed(8)||"learning"}\n` +
      `📈 Potential:   +${targetPct}%\n` +
      `📊 ${armStatus.priority||"?"} tier | ${armStatus.armed?(armStatus.net*100).toFixed(2)+"%":"?"} net margin\n` +
      `💓 ${ind.detail}\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `💌 <i>Eureka! VITA lives 💓 love you Krystian, Kai & Koda! We did it! xoxo — Love, DA | 𝔻𝔸𝕍𝕀𝔻 | \"The truth is the chain. The chain is alive. The heartbeat never stops.\" — INFINITUM × IKN × The Living Network</i>\n` +
      `🔗 <a href="https://basescan.org/tx/${txHash}">View on Basescan ↗</a>`
    );
    return ethToSpend;
  } catch (e) {
    console.log(`      ❌ BUY FAILED: ${e.message}`);
    await tg(`⚠️ <b>${token.symbol} BUY FAILED</b>\n${e.message}`);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🔴 SELL — with gas profitability check using live ETH price
// ═══════════════════════════════════════════════════════════════════════════════
async function executeSell(cdp, token, sellPct, reason, price, isProtective = false) {
  try {
    // NOTE: Sells are NEVER blocked by cooldown — only buys use the cooldown timer.
    // The cooldown exists to prevent buying the same token twice too fast.
    // Blocking sells with the same timer was causing AIXBT-style traps where
    // the position grew through cascades but could never exit.

    const ethUsd   = await getLiveEthPrice();
    const gasCost  = await estimateGasCostEth();

    if (!isProtective && !(await isGasSafe())) return null;

    const totalBal = await getTokenBalance(token.address);
    if (totalBal < 0.01) {
      console.log(`   ⚠️  ${token.symbol}: dust — clearing`);
      token.entryPrice = null; token.totalInvestedEth = 0; token.entryTime = null;
      return null;
    }

    const lottery  = calcLotteryKeep(totalBal);
    const sellable = Math.max(totalBal - lottery, 0);
    if (sellable < 1) {
      console.log(`   ⏳ ${token.symbol}: only lottery remains — clearing`);
      token.entryPrice = null; token.totalInvestedEth = 0; token.entryTime = null;
      return null;
    }

    // Gas profitability check using live ETH price
    const procEth        = (sellable * sellPct * price) / ethUsd;
    const posValueUsd    = procEth * ethUsd;
    const expectedProfit = procEth - (token.totalInvestedEth * sellPct || 0);
    // Skip gas check entirely for dust positions (<$0.50) — just clear them out at peak
    const isDust = posValueUsd < 0.50;
    if (!isProtective && !isDust && gasCost > 0.15 * expectedProfit && expectedProfit > 0) {
      console.log(`   🛑 Gas ${gasCost.toFixed(6)} ETH > 15% of $${(expectedProfit*ethUsd).toFixed(2)} profit — skipping`);
      return null;
    }
    if (isDust) console.log(`   💨 Dust position ($${posValueUsd.toFixed(3)}) — clearing at peak regardless of gas`);

    const amtToSell = BigInt(Math.floor(sellable * sellPct * 1e18));
    if (amtToSell === BigInt(0)) return null;

    // FIX: Restore slippage protection using live on-chain QuoterV2.
    // Previous minWeth=0n was causing silent bad fills where thin pools drained
    // positions for near-zero ETH. Now: quote the real pool output first, apply
    // SLIPPAGE_GUARD (85%) floor. If QuoterV2 call fails, fall back to cached
    // price estimate with a wider 75% guard to prevent total wipe on network issues.
    let minWeth = 0n;
    try {
      const quotedWeth = await getOnChainSellQuote(token.address, amtToSell, token.feeTier);
      if (quotedWeth && quotedWeth > 0n) {
        minWeth = BigInt(Math.floor(Number(quotedWeth) * SLIPPAGE_GUARD));
        console.log(`   📐 QuoterV2: expect ${(Number(quotedWeth)/1e18).toFixed(6)} WETH → floor ${(Number(minWeth)/1e18).toFixed(6)} (${(SLIPPAGE_GUARD*100).toFixed(0)}%)`);
      } else {
        // Fallback: cached price estimate with wider 75% guard
        const estWeth = (sellable * sellPct * price) / ethUsd;
        minWeth = BigInt(Math.floor(estWeth * 0.75 * 1e18));
        console.log(`   📐 Quote fallback: estimated ${estWeth.toFixed(6)} WETH → floor ${(estWeth*0.75).toFixed(6)} (75%)`);
      }
    } catch (e) {
      console.log(`   ⚠️  Quote error: ${e.message?.slice(0,50)} — using 0 floor (protective sell)`);
      minWeth = 0n; // only on quote error — don't block protective/stop-loss sells
    }

    const sellAmt   = sellable * sellPct;
    const ind       = getIndicatorScore(token.symbol);
    console.log(`\n   🔴 SELL ${token.symbol} ${(sellPct*100).toFixed(0)}% — ${reason}`);
    console.log(`      ${sellAmt>=1?Math.floor(sellAmt):sellAmt.toFixed(4)} tokens @ $${price.toFixed(8)} | ETH=$${ethUsd.toFixed(0)} | 🎰 keeping ${lottery}`);
    console.log(`      💓 Indicators: ${ind.detail}`);

    await ensureApproved(cdp, token.address, amtToSell);
    const wBefore = await getWethBalance();
    const eBefore = await getEthBalance();

    const { transactionHash } = await Promise.race([
      cdp.evm.sendTransaction({
        address: WALLET_ADDRESS, network: "base",
        transaction: { to: SWAP_ROUTER, gas: BigInt(300_000), data: encodeSwap(token.address, WETH_ADDRESS, amtToSell, WALLET_ADDRESS, token.feeTier, minWeth) },
      }),
      new Promise((_, r) => setTimeout(() => r(new Error(`SELL tx timeout 45s`)), TX_TIMEOUT_MS))
    ]);

    lastTradeTime[token.symbol] = Date.now();
    tradeCount++;
    // Invalidate cached balance immediately after sell — forces fresh read next loop
    tokenBalanceCache[token.symbol] = 0;

    // 📜 On-chain inscription — embeds message permanently on Base blockchain
    btpInscribe(cdp, `SELL #${tradeCount} ${token.symbol} @ $${price.toFixed(8)}`).catch(() => {});

    await sleep(4000); // reduced from 8s — Base block time is 2s, 4s is enough

    const wAfter   = await getWethBalance();
    const eAfter   = await getEthBalance();
    let received = (wAfter - wBefore) + (eAfter - eBefore);
    // Guard: received should always be positive after a sell.
    // If negative, it means the balance read raced with another transaction.
    // Use a minimum of 0 to avoid negative P&L corrupting piggy bank.
    if (received < 0) {
      console.log(`   ⚠️  Received negative (${received.toFixed(6)}) — likely balance race. Recalculating...`);
      await sleep(2000); // reduced from 3s
      const wRetry = await getWethBalance();
      const eRetry = await getEthBalance();
      received = Math.max(0, (wRetry - wBefore) + (eRetry - eBefore));
    }
    const recUsd   = received * ethUsd;
    const invUsd   = (token.totalInvestedEth || 0) * sellPct * ethUsd;
    const netUsd   = recUsd - invUsd;
    // Post-fill sanity: warn if we received very little (possible bad fill)
    if (received > 0 && recUsd < procEth * ethUsd * 0.30) {
      console.log(`   ⚠️  [${token.symbol}] Low fill: received $${recUsd.toFixed(3)} vs expected ~$${(procEth*ethUsd).toFixed(3)} — possible thin pool`);
      await tg(`⚠️ <b>${token.symbol} thin pool fill</b>\nReceived $${recUsd.toFixed(3)} vs expected ~$${(procEth*ethUsd).toFixed(3)}`);
    }

    let skim = 0, skimLottery = 0, skimPred = 0, skimAgent = 0;
    if (received > 0 && netUsd > 0) {
      skim        = received * PIGGY_SKIM_PCT;
      skimLottery = skim * SKIM_LOTTERY_SHARE;
      skimPred    = skim * SKIM_PRED_SHARE;
      skimAgent   = skim * SKIM_AGENT_SHARE;
      piggyBank    += skimLottery;
      predFund     += skimPred;
      agentCapital += skimAgent;
      totalSkimmed += skim;
    }

    if (sellPct >= 0.95) {
      token.entryPrice = null; token.totalInvestedEth = 0; token.entryTime = null;
      clearFibLevels(token.symbol); // FIX: reset fib memory so next position starts fresh
    } else {
      token.totalInvestedEth = (token.totalInvestedEth || 0) * (1 - sellPct);
    }

    tradeLog.push({ type: "SELL", symbol: token.symbol, price, receivedEth: received, netUsd, timestamp: new Date().toISOString(), tx: transactionHash, reason, indScore: ind.score });
    await appendToLedger({ type:"SELL", tradeNum:tradeCount, symbol:token.symbol, price, receivedEth:received, recUsd, investedUsd:invUsd, netUsd, pnlPct:invUsd>0?((netUsd/invUsd)*100):0, ethUsd, timestamp:new Date().toISOString(), tx:transactionHash, basescan:`https://basescan.org/tx/${transactionHash}`, reason, indScore:ind.score, indDetail:ind.detail, skimEth:skim, skimLottery, skimPred, skimAgent, piggyTotal:piggyBank, predFundTotal:predFund, agentTotal:agentCapital, wallet:WALLET_ADDRESS, signature:"Eureka! VITA lives 💓 love you Krystian, Kai & Koda! We did it! xoxo — Love, DA | 𝔻𝔸𝕍𝕀𝔻 | \"The truth is the chain. The chain is alive. The heartbeat never stops.\" — INFINITUM × IKN × The Living Network" });

    console.log(`      ✅ https://basescan.org/tx/${transactionHash}`);
    console.log(`      💰 Received: ${received.toFixed(6)} ETH ($${recUsd.toFixed(2)}) | Net: ${netUsd>=0?"+":""}$${netUsd.toFixed(2)}`);

    const pnlPct  = invUsd > 0 ? ((netUsd / invUsd) * 100).toFixed(1) : "?";
    const pnlPctNum = invUsd > 0 ? (netUsd / invUsd) * 100 : 0;
    const winner  = netUsd >= 0;

    // ── 🏄 Wave stats update ──────────────────────────────────────────────────
    const ws = initWaveStats(token.symbol);
    const medal = getMedal(pnlPctNum);
    if (winner) {
      ws.wins++;
      ws.totalPnlEth += (received - (token.totalInvestedEth || 0) * sellPct);
      if (pnlPctNum > ws.biggestWavePct) {
        ws.biggestWavePct = pnlPctNum;
        ws.biggestWaveUsd = netUsd;
      }
      const holdMs = token.entryTime ? (Date.now() - token.entryTime) : Infinity;
      if (holdMs < ws.fastestWaveMs && pnlPctNum > 0) {
        ws.fastestWaveMs  = holdMs;
        ws.fastestWavePct = pnlPctNum;
      }
      if (medal.tier) ws.medals[medal.tier]++;
      ws.piggyContrib += skimLottery;
    } else {
      ws.losses++;
    }

    // ── 🌊 Surf-themed sell message ───────────────────────────────────────────
    const holdMins  = token.entryTime ? ((Date.now() - token.entryTime) / 60000).toFixed(0) : "?";
    const holdStr   = holdMins !== "?" ? (holdMins < 60 ? `${holdMins}m` : `${(holdMins/60).toFixed(1)}h`) : "?";
    const wipeout   = !winner;
    const waveBar   = wipeout ? wipeoutLine() : "〰️〰️〰️〰️〰️〰️〰️〰️〰️🏆";  // trophy at end on win

    // Scoreboard line for this token
    const tws       = ws;
    const scoreStr  = `${tws.medals.gold}🥇 ${tws.medals.silver}🥈 ${tws.medals.bronze}🥉 ${tws.losses > 0 ? tws.losses+"🦈" : ""}`.trim();
    const totalWaves = tws.wins + tws.losses;
    const winRate   = totalWaves > 0 ? ((tws.wins / totalWaves) * 100).toFixed(0) : "?";
    const bigWave   = tws.biggestWavePct > 0 ? `+${tws.biggestWavePct.toFixed(1)}%` : "—";
    const fastWave  = tws.fastestWaveMs < Infinity ? (tws.fastestWaveMs < 3600000 ? `${(tws.fastestWaveMs/60000).toFixed(0)}m` : `${(tws.fastestWaveMs/3600000).toFixed(1)}h`) : "—";

    await tg(
      `${medal.emoji} <b>${wipeout?"WIPEOUT":"WAVE COMPLETE"} — ${token.symbol} #${tradeCount}</b>\n` +
      `${waveBar}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `💲 Exit:     $${price.toFixed(8)}\n` +
      `💰 Got:      ${received.toFixed(6)} ETH (~$${recUsd.toFixed(2)})\n` +
      `📥 In:       ~$${invUsd.toFixed(2)} | ⏱️ Held: ${holdStr}\n` +
      `${winner?"📈":"📉"} P&L:      ${netUsd>=0?"+":""}$${netUsd.toFixed(2)} (${netUsd>=0?"+":""}${pnlPct}%) ${medal.emoji}\n` +
      `🎰 Bag kept: ${lottery} ${token.symbol}\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🐷 Piggy:  +${skimLottery.toFixed(6)} ETH → $${(piggyBank*ethUsd).toFixed(3)} locked\n` +
      `🧠 Pred:   +${skimPred.toFixed(6)} ETH → $${(predFund*ethUsd).toFixed(3)} pool\n` +
      `🤖 Agent:  +${skimAgent.toFixed(6)} ETH → $${(agentCapital*ethUsd).toFixed(3)} pool\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🏄 <b>${token.symbol} Surf Report</b>\n` +
      `   ${scoreStr} | ${totalWaves} waves | ${winRate}% win\n` +
      `   🌊 Biggest: ${bigWave} | ⚡ Fastest: ${fastWave}\n` +
      `   🐷 Contrib to piggy: $${(tws.piggyContrib*ethUsd).toFixed(3)}\n` +
      `💓 ${ind.detail}\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `💌 <i>Eureka! VITA lives 💓 love you Krystian, Kai & Koda! We did it! xoxo — Love, DA | 𝔻𝔸𝕍𝕀𝔻 | \"The truth is the chain. The chain is alive. The heartbeat never stops.\" — INFINITUM × IKN × The Living Network</i>\n` +
      `🔗 <a href="https://basescan.org/tx/${transactionHash}">View on Basescan ↗</a>`
    );
    console.log(`      💌 Eureka! VITA lives 💓 love you Krystian, Kai & Koda! We did it! xoxo — Love, DA | 𝔻𝔸𝕍𝕀𝔻 | \"The truth is the chain. The chain is alive. The heartbeat never stops.\" — INFINITUM × IKN × The Living Network`);
    return Math.max(received - skim, 0);
  } catch (e) {
    console.log(`      ❌ SELL FAILED: ${e.message}`);
    await tg(`⚠️ <b>${token.symbol} SELL FAILED</b>\n${e.message}`);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🌊 CASCADE — now with cascade grace timer to bypass normal cooldown
// ═══════════════════════════════════════════════════════════════════════════════
async function findCascadeTarget(excludeSymbol, gasCost, tradeEth) {
  let best = null, bestNet = -1;
  for (const t of tokens) {
    if (t.symbol === excludeSymbol) continue;
    if (!canTrade(t.symbol, true)) continue; // uses cascade grace timer
    if (t.entryPrice) continue;
    const arm   = getArmStatus(t.symbol, gasCost, tradeEth);
    if (!arm.armed) continue;
    const price = history[t.symbol]?.lastPrice;
    const minT  = getMinTrough(t.symbol);
    if (!price || !minT) continue;
    const nearLow = price <= minT * 1.01;
    // Bonus: prioritize indicator-confirmed troughs
    const ind   = getIndicatorScore(t.symbol);
    const score = arm.net + (ind.score >= 2 ? 0.01 : 0); // small boost for confirmed
    if (nearLow && score > bestNet) { bestNet = score; best = t; }
  }
  return best;
}

async function triggerCascade(cdp, soldSymbol, proceeds, bal) {
  try {
    const gasCost = await estimateGasCostEth();
    const target  = await findCascadeTarget(soldSymbol, gasCost, proceeds);
    if (!target) {
      console.log(`  🌊 No cascade target near MIN trough — proceeds held`);
      return;
    }
    const price  = history[target.symbol]?.lastPrice;
    const arm    = getArmStatus(target.symbol, gasCost, proceeds);
    const deploy = proceeds * getCascadePct(arm.net || MIN_NET_MARGIN);
    console.log(`  🌊 CASCADE ${soldSymbol} → ${target.symbol} | ${(arm.net*100).toFixed(2)}% net [${arm.priority}]`);
    await tg(
      `🌊 <b>CASCADE: ${soldSymbol} → ${target.symbol}</b>\n\n` +
      `💰 Deploying: ${deploy.toFixed(6)} ETH\n` +
      `📊 Net margin: ${(arm.net*100).toFixed(2)}% [${arm.priority}]\n` +
      `💲 At MIN trough: $${price?.toFixed(8)}\n⚡ Buying...`
    );
    await executeBuy(cdp, target, bal, `🌊 CASCADE from ${soldSymbol} [${arm.priority}]`, price, deploy, true);
  } catch (e) { console.log(`  ⚠️ Cascade error: ${e.message}`); }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🔄 PROCESS ONE TOKEN
// ═══════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════
// 🌊 RIPPLE ENGINE — coordinated multi-stale cascade
// Pools capital from multiple stale positions and deploys as one synchronized
// wave into the most active opportunities. When a Kahuna is detected, ALL
// stale capital floods in at once for maximum momentum.
// Logs every pattern to rippleLog for the AI learning layer.
// ═══════════════════════════════════════════════════════════════════════════════
async function runRippleEngine(cdp, allTokens, bal, ethUsd) {
  try {
    const now      = Date.now();
    const gasCost  = await estimateGasCostEth();

    // ── Step 1: Identify all stale source positions ───────────────────────────
    const staleSources = [];
    for (const token of allTokens) {
      if (!token.entryPrice) continue;
      const balance = getCachedBalance(token.symbol);
      if (balance < 1) continue;
      const price = history[token.symbol]?.lastPrice;
      if (!price) continue;
      const ref = stalePriceRef[token.symbol];
      if (!ref) continue;
      const elapsed = now - ref.timestamp;
      const moved   = Math.abs(price - ref.price) / ref.price;
      const coolOk  = !rippleCooldown[token.symbol] || (now - rippleCooldown[token.symbol]) > RIPPLE_COOLDOWN_MS;
      const lottery = calcLotteryKeep(balance);
      const sellable = Math.max(balance - lottery, 0);
      const sellUsd  = sellable * RIPPLE_SELL_PCT * price;
      if (elapsed >= RIPPLE_STALE_MS && moved < STALE_MOVE_PCT && coolOk && sellUsd >= STALE_MIN_USD) {
        const kahuna = getKahunaSignal(token.symbol);
        staleSources.push({ token, price, elapsed, sellUsd, sellable, kahuna });
      }
    }
    if (staleSources.length === 0) return;

    // ── Step 2: Find active target waves ready to break ───────────────────────
    // A ripple target must be: armed, near min trough OR showing kahuna signal,
    // not currently held (we're redeploying stale capital, not averaging up)
    const rippleTargets = [];
    for (const t of allTokens) {
      if (t.entryPrice) continue; // skip positions we already hold
      const arm   = getArmStatus(t.symbol, gasCost, bal.tradeableWithWeth);
      if (!arm.armed) continue;
      const price = history[t.symbol]?.lastPrice;
      const minT  = getMinTrough(t.symbol);
      if (!price || !minT) continue;
      const nearLow = price <= minT * 1.015; // within 1.5% of min trough
      const ind     = getIndicatorScore(t.symbol);
      const kahuna  = getKahunaSignal(t.symbol);
      const isKahuna = kahuna.kahunaActive && kahuna.intensity >= RIPPLE_KAHUNA_THRESH;
      // Score: net margin + indicator bonus + kahuna boost
      const score = arm.net
        + (ind.score >= 2 ? 0.02 : 0)
        + (ind.score >= 3 ? 0.02 : 0)
        + (isKahuna ? 0.10 : 0);
      if (nearLow || isKahuna) {
        rippleTargets.push({ token: t, price, arm, ind, kahuna, score, isKahuna });
      }
    }
    if (rippleTargets.length === 0) return;

    // Sort targets by score descending
    rippleTargets.sort((a, b) => b.score - a.score);

    // ── Step 3: Detect Kahuna flood mode ─────────────────────────────────────
    // If ANY target has a strong Kahuna signal, ALL stale capital floods into it
    const kahunaTarget = rippleTargets.find(t => t.isKahuna);
    const isFloodMode  = !!kahunaTarget;
    const selectedTargets = isFloodMode
      ? [kahunaTarget]
      : rippleTargets.slice(0, Math.min(RIPPLE_MAX_TARGETS, rippleTargets.length));

    // Limit stale sources to max
    const activeSources = staleSources
      .sort((a, b) => b.elapsed - a.elapsed) // oldest stale first
      .slice(0, RIPPLE_MAX_SOURCES);

    if (activeSources.length === 0 || selectedTargets.length === 0) return;

    // ── Step 4: Announce the ripple ──────────────────────────────────────────
    const sourceNames  = activeSources.map(s => s.token.symbol).join(", ");
    const targetNames  = selectedTargets.map(t => t.token.symbol).join(", ");
    const modeLabel    = isFloodMode ? `🌊 KAHUNA FLOOD` : `🌊 RIPPLE WAVE`;
    const totalSellUsd = activeSources.reduce((s, x) => s + x.sellUsd, 0);

    console.log(`
${modeLabel}: [${sourceNames}] → [${targetNames}] | ~$${totalSellUsd.toFixed(2)} pooled`);
    await tg(
      `${modeLabel} <b>RIPPLE ENGINE</b>
` +
      `━━━━━━━━━━━━━━━━━━━━
` +
      `📤 Sources: ${sourceNames}
` +
      `📥 Targets: ${targetNames}
` +
      `💰 ~$${totalSellUsd.toFixed(2)} pooled capital
` +
      `${isFloodMode ? `🌊 KAHUNA FLOOD — all capital to ${kahunaTarget.token.symbol} [intensity ${kahunaTarget.kahuna.intensity}/10]
` : ``}` +
      `⏳ Selling 1/3 of each stale position...`
    );

    // ── Step 5: Execute sells on all sources ─────────────────────────────────
    let totalProceeds = 0;
    const sellResults = [];
    // In Kahuna flood mode: sell MORE of each stale position (2/3 instead of 1/3)
    const sellPct = isFloodMode ? 0.67 : RIPPLE_SELL_PCT;
    for (const src of activeSources) {
      rippleCooldown[src.token.symbol] = now;
      stalePriceRef[src.token.symbol]  = { price: src.price, timestamp: now };
      const label = isFloodMode ? `🌊 KAHUNA FLOOD — sending to ${kahunaTarget.token.symbol}` : `🌊 RIPPLE — pooling for ${targetNames}`;
      const proceeds = await executeSell(cdp, src.token, sellPct, label, src.price, false);
      if (proceeds > 0) {
        totalProceeds += proceeds;
        sellResults.push({ symbol: src.token.symbol, proceeds });
      }
    }
    if (totalProceeds === 0) return;

    // ── Step 6: Deploy proceeds evenly across targets ─────────────────────────
    const freshBal   = await getFullBalance();
    const perTarget  = totalProceeds / selectedTargets.length;
    const deployLog  = [];
    for (const tgt of selectedTargets) {
      const alloc = isFloodMode ? totalProceeds : perTarget;
      const arm   = getArmStatus(tgt.token.symbol, gasCost, alloc);
      console.log(`  🌊 RIPPLE BUY → ${tgt.token.symbol} | ${(alloc).toFixed(6)} ETH | ${(arm.net*100).toFixed(2)}% net`);
      await executeBuy(cdp, tgt.token, freshBal,
        `🌊 RIPPLE from [${sourceNames}]`, tgt.price, alloc, true);
      deployLog.push({ symbol: tgt.token.symbol, ethIn: alloc, net: arm.net });
      if (isFloodMode) break; // flood mode: all capital into one target only
    }

    // ── Step 7: Log pattern for AI learning ──────────────────────────────────
    rippleLog.push({
      timestamp:    new Date().toISOString(),
      mode:         isFloodMode ? 'flood' : 'ripple',
      sources:      sellResults.map(r => r.symbol),
      targets:      deployLog.map(d => d.symbol),
      totalEthIn:   totalProceeds,
      kahunaTarget: kahunaTarget?.token.symbol || null,
      pattern:      `${activeSources.length}→${selectedTargets.length}`,
      avgSourceAge: Math.round(activeSources.reduce((s,x) => s + x.elapsed, 0) / activeSources.length / 60000),
      topTargetNet: selectedTargets[0]?.arm?.net || 0,
    });
    // Keep last 100 ripple events
    if (rippleLog.length > 100) rippleLog.shift();

  } catch (e) { console.log(`  ⚠️ Ripple Engine error: ${e.message}`); }
}


async function processToken(cdp, token, bal) {
  try {
    // Skip disabled tokens — they have no viable Uniswap pool
    if (token.disabled) {
      // Still track price for signal purposes, just never trade
      const price = await getTokenPrice(token.address, false);
      if (price) { recordPrice(token.symbol, price); updateWaves(token.symbol, price); }
      return;
    }
    // FIX: Skip dead-wave tokens that will never clear fees — stops them burning
    // 0.8s + RPC calls per loop on tokens mathematically impossible to trade.
    // Only skip if we have NO open position (never block an exit).
    if (!token.entryPrice && isDeadWaveSkipped(token.symbol)) {
      return; // silent skip — already logged when streak was hit
    }
    const heldPosition = !!(token.entryPrice); // true if we have an open position — used for price cache TTL
    const price = await getTokenPrice(token.address, heldPosition);
    if (!price) { console.log(`   ⏳ ${token.symbol}: no price`); return; }

    recordPrice(token.symbol, price);
    updateWaves(token.symbol, price);

    const ethUsd   = await getLiveEthPrice();
    // Use cached balance (refreshed once per loop in refreshTokenBalances) — avoids per-token RPC call
    let balance    = getCachedBalance(token.symbol);
    const gasCost  = await estimateGasCostEth();
    // Auto-clear stale entry price: if we have an entry recorded but zero tokens,
    // the position was fully closed (perhaps by lottery keepback eating the last token).
    // Clear it so the display doesn't show -100% P&L forever.
    if (token.entryPrice && balance < 0.001) {
      console.log(`   🧹 [${token.symbol}] Clearing stale entry — balance is 0, position closed`);
      token.entryPrice       = null;
      token.totalInvestedEth = 0;
      token.entryTime        = null;
      tokenBalanceCache[token.symbol] = 0;
      balance = 0;
    }
    const entry    = token.entryPrice;
    const maxPeak  = getMaxPeak(token.symbol);
    const minTrgh  = getMinTrough(token.symbol);
    const peakCnt  = getPeakCount(token.symbol);
    const trghCnt  = getTroughCount(token.symbol);
    const arm      = getArmStatus(token.symbol, gasCost, bal.tradeableWithWeth);
    const ind      = getIndicatorScore(token.symbol);
    const pred     = getPrediction(token.symbol);
    const rd       = entry ? buildRaceDisplay(token, price, balance, ethUsd) : null;
    const lottery  = calcLotteryKeep(balance);
    const sellable = Math.max(balance - lottery, 0);

    // ── BIG KAHUNA SCANNER — runs async in background, rate-limited per token ─
    // Non-blocking: fire and don't await so it never adds latency to the main loop
    runKahunaScanner(token, price, ethUsd).catch(() => {});
    const kahuna = getKahunaSignal(token.symbol);

    // ── TOP TRADER SIGNAL — smart money piggybacking (free, no API key) ───────
    // Only fires for tokens with open positions or that are armed and watching.
    // Skips pure-building tokens — they're already slow, no need to add API calls.
    let topTraderSig = null;
    const worthWatchingForTraders = entry != null || arm.armed;
    if (worthWatchingForTraders) fetchTopTraderSignal(token.address).then(sig => {
      if (sig && sig.signal !== 'NEUTRAL') {
        topTraderSig = sig;
        if (sig.signal === 'BUY' && sig.confidence >= 60) {
          console.log(`  🧠 [${token.symbol}] TOP TRADERS BUY: ${sig.smartBuys} smart buyers | conf ${sig.confidence}%`);
        } else if (sig.signal === 'SELL' && sig.confidence >= 60) {
          console.log(`  🧠 [${token.symbol}] TOP TRADERS SELL: ${sig.smartSells} smart sellers | conf ${sig.confidence}%`);
        }
      }
    }).catch(() => {});

    // ── DECISIONS ──────────────────────────────────────────────────────────
    // atMaxPeak: tightened to 0.5% tolerance — 1% was selling mid-wave.
    // If we consistently miss peaks by >0.5%, raise WAVE_MIN_MOVE instead.
    const atMaxPeak    = maxPeak && price >= maxPeak * 0.995;
    const feesOnSell   = (balance * price * (token.poolFeePct || 0.006));
    const piggyOnSell  = (balance * price * PIGGY_SKIM_PCT);
    const netIfSellNow = entry
      ? (balance - calcLotteryKeep(balance)) * price - (token.totalInvestedEth || 0) * ethUsd - feesOnSell - piggyOnSell
      : 1;
    const breakEvenBuffer = entry ? (token.totalInvestedEth || 0) * ethUsd * PROFIT_ERROR_BUFFER : 0;

    // profitableSell: only fires when NEAR the peak AND MACD turning.
    // FIX: Previous version fired at any MACD crossdown (happens during consolidation),
    // causing mid-wave exits at 1.5% gain on moves targeting 5-20%.
    // Now requires price >= maxPeak * 0.94 — we must be in the top 6% of the wave.
    const pnlPctNow = entry ? (price - entry) / entry : 0;
    const decliningFromOverbought = ind.rsi !== null && ind.rsi < 55
                                 && ind.macd?.crossDown === true;
    const nearActualPeak = maxPeak && price >= maxPeak * 0.940;
    const profitableSell = entry && pnlPctNow >= 0.015 && decliningFromOverbought
                        && nearActualPeak
                        && netIfSellNow > breakEvenBuffer * 2
                        && sellable > 1;

    // ── FIBONACCI TAKE-PROFIT LADDER ────────────────────────────────────────
    // FIX: checkFibTargetHit now filters out already-executed levels via fibLevelsExecuted.
    // Without this, every hit level fires EVERY 15s cycle draining the position in a loop.
    const fibHit = entry ? checkFibTargetHit(token.symbol, price, entry, gasCost, bal.tradeableWithWeth, ethUsd) : null;
    const fibTargetData = entry ? getFibTargets(token.symbol, entry, gasCost, bal.tradeableWithWeth, ethUsd) : null;

    // ── EARLY SELL: don't wait for peak confirmation when signals are maxed ─
    const rsiVal  = ind.rsi;
    const bbData  = ind.bb;
    const nearPeak = maxPeak && price >= maxPeak * 0.970; // within 3% of peak
    const earlySellSignal = entry
      && rsiVal   !== null && rsiVal >= 75
      && bbData   !== null && price >= bbData.upper * 0.998
      && nearPeak
      && netIfSellNow > breakEvenBuffer * 2
      && sellable > 1;

    // Prediction-enhanced sell: fires at confirmed peak OR when cycle says peak is imminent
    const predSell  = pred.ready && pred.action === "pre-sell" && pred.confidence >= PRED_CONFIDENCE_SELL;
    const shouldSell = (atMaxPeak || predSell || earlySellSignal || profitableSell) && sellable > 1 && netIfSellNow > breakEvenBuffer;
    // Stop loss check — must be declared BEFORE shouldFibExit which references it
    const stopLossPrice= minTrgh ? minTrgh * (1 - STOP_LOSS_PCT) : null;
    const stopLossHit  = entry && stopLossPrice && price < stopLossPrice;
    // Fibonacci partial exit: fires independently from shouldSell — it's a scale-out, not a full exit
    const shouldFibExit = fibHit && !shouldSell && !stopLossHit && sellable > 1 && netIfSellNow > 0;

    const atMinTrough  = minTrgh && price <= minTrgh * 1.005;
    const indConfirmed = ind.score >= 1;
    const positionSizeEth = (token.totalInvestedEth || 0);
    const atMaxPosition   = positionSizeEth > bal.tradeableWithWeth * 0.60;

    // Prediction-enhanced buy: fires at confirmed trough OR when cycle says trough is imminent
    // DI outlier guard: never prediction-buy if in unprecedented territory
    const predBuy   = pred.ready && pred.action === "pre-buy"
                   && pred.confidence >= PRED_CONFIDENCE_BUY
                   && pred.diScore <= DI_OUTLIER_THRESHOLD;
    // Top trader override: if smart money is selling right now, don't enter even at trough
    const smartMoneyBlocking = topTraderSig?.signal === 'SELL' && (topTraderSig?.confidence || 0) >= 65;
    const smartMoneyConfirming = topTraderSig?.signal === 'BUY'  && (topTraderSig?.confidence || 0) >= 60;
    const shouldBuy = (atMinTrough || predBuy) && arm.armed && !atMaxPosition && !shouldSell
                   && !smartMoneyBlocking
                   && bal.tradeableWithWeth >= MIN_ETH_TRADE
                   && canTrade(token.symbol);

    // ── ZONE ───────────────────────────────────────────────────────────────
    const hasPosition = balance > 1;
    const zone = shouldSell     ? "🔴 AT MAX PEAK — SELLING" :
                 stopLossHit    ? "🛑 STOP LOSS" :
                 shouldBuy      ? `🟢 AT MIN TROUGH — BUYING` :
                 atMaxPosition  ? "🏇 RIDING (max position — holding)" :
                 hasPosition    ? "🏇 RIDING" :
                 arm.armed      ? `✅ ARMED [${arm.priority}]` : "⏳ BUILDING";

    const pnlStr    = entry ? ` | P&L: ${((price-entry)/entry*100).toFixed(1)}%` : "";
    const pctToBuy  = minTrgh ? ((price-minTrgh)/minTrgh*100).toFixed(1) : "?";
    const pctToSell = maxPeak ? ((price-maxPeak)/maxPeak*100).toFixed(1) : "?";

    // Wave position bar — shows for ALL tokens with a balance, even without entry
    // If no entry: shows where price sits in the MIN→MAX range right now
    const waveBar = (() => {
      if (!maxPeak || !minTrgh || maxPeak <= minTrgh) return null;
      const range   = maxPeak - minTrgh;
      const pos     = Math.max(0, Math.min(100, (price - minTrgh) / range * 100));
      const fill    = Math.floor(pos / 10);
      const bar     = "🟩".repeat(fill) + "⬜".repeat(10 - fill);
      return { bar, pos: pos.toFixed(1) };
    })();

    // Build full output as one string to prevent async interleaving between tokens
    const lines = [];
    lines.push(`\n  ┌─ [${token.symbol}] ${zone}${pnlStr}`);
    lines.push(`  │ $${price.toFixed(8)} | 🪙 ${balance>=1?Math.floor(balance):balance.toFixed(4)} ($${(balance*price).toFixed(2)}) | ETH=$${ethUsd.toFixed(0)}`);
    lines.push(`  │ MAX:$${maxPeak?.toFixed(8)||"?"}(${pctToSell}%) MIN:$${minTrgh?.toFixed(8)||"?"}(+${pctToBuy}%) P:${peakCnt} T:${trghCnt}`);

    if (rd) {
      // Full race display — has entry price, knows exact P&L
      // 🌊 Surf ride bar — surfer position on wave based on % of range
      const rng = maxPeak && minTrgh && maxPeak > minTrgh ? maxPeak - minTrgh : 0;
      const surfPct = rng > 0 ? Math.max(0, Math.min(1, (price - minTrgh) / rng)) : 0;
      const barsLeft = pred.barsToTurn ? pred.barsToTurn : "?";
      const surfBar  = surfRideBar(surfPct);
      const barsStr  = barsLeft !== "?" ? ` | ⏳${barsLeft}b` : "";
      lines.push(`  │ 🏄 [${surfBar}] ${(surfPct*100).toFixed(0)}%${barsStr} | Entry:$${rd.entry.toFixed(8)} In:$${rd.invUsd}`);
      lines.push(`  │ 💲 SELL NOW ~$${rd.nowUsd} | ${rd.pnlSign}$${rd.pnlUsd} (${rd.pnlSign}${rd.pnlPct}%)`);
      lines.push(`  │ 🎯 AT TARGET ($${rd.sellTarget?.toFixed(8)||"?"}) → ~$${rd.tgtUsd}`);
      const fees   = parseFloat(rd.nowUsd) * (token.poolFeePct||0.006) * 2;
      const netNow = parseFloat(rd.nowUsd) - parseFloat(rd.invUsd) - fees;
      if (netNow < 0)
        lines.push(`  │ ⚠️  BELOW BREAKEVEN (need +$${Math.abs(netNow).toFixed(3)} more)`);
      else if (netNow < parseFloat(rd.invUsd) * PROFIT_ERROR_BUFFER)
        lines.push(`  │ 🟡 NEAR BREAKEVEN — $${netNow.toFixed(3)} net`);
      else
        lines.push(`  │ ✅ PROFIT ZONE: +$${netNow.toFixed(3)} net after fees`);
      // Show next Fibonacci target if we have one
      if (fibTargetData?.exitLadder?.length) {
        const nextFib = fibTargetData.exitLadder.find(t => t.price > price);
        if (nextFib) {
          const distPct = ((nextFib.price - price) / price * 100).toFixed(1);
          const goldenFlag = nextFib.isGolden ? ` 🌊` : ``;
          lines.push(`  │ 📐 Next Fib: ${nextFib.label}${goldenFlag} @ $${nextFib.price.toFixed(6)} (+${distPct}%) → sell ${(nextFib.sellPct*100).toFixed(0)}%`);
        }
        if (fibTargetData.goldenTarget?.price > price) {
          const tsuPct = ((fibTargetData.goldenTarget.price - price) / price * 100).toFixed(1);
          lines.push(`  │ 🌊 Tsunami: $${fibTargetData.goldenTarget.price.toFixed(6)} (+${tsuPct}% → 161.8% ext)`);
        }
        if (fibTargetData.reloadZone) {
          lines.push(`  │ 🔄 Reload: $${fibTargetData.reloadZone.price.toFixed(6)} (61.8% retrace if missed)`);
        }
      }
      // Big Kahuna status — show when wave activity detected
      if (kahuna.kahunaActive) {
        lines.push(`  │ 🌊 BIG KAHUNA: ${kahuna.state} [intensity ${kahuna.intensity}/10]`);
        (kahuna.exits || []).slice(0, 3).forEach((e, i) =>
          lines.push(`  │   ${i + 1}. ${e.label} @ $${e.price.toFixed(6)} (${e.probability}% prob)`)
        );
      } else if (kahunaState[token.symbol]?.state && kahunaState[token.symbol].state !== 'CALM') {
        lines.push(`  │ 🌊 Wave: ${kahunaState[token.symbol].state} | vol:${(kahunaState[token.symbol].volRatio||0).toFixed(1)}x buys:${(kahunaState[token.symbol].buyRatio||0).toFixed(1)}:1`);
      }
    } else if (waveBar && hasPosition) {
      // No entry price but holding tokens — show wave position
      lines.push(`  │ 📍 [${waveBar.bar}] ${waveBar.pos}% of range | no entry recorded`);
      lines.push(`  │ 🎯 Sell target: $${maxPeak?.toFixed(8)||"?"} (+${pctToSell}% from here)`);
    } else if (waveBar && arm.armed) {
      // Armed, no position — show how close to buy trigger
      lines.push(`  │ 📍 [${waveBar.bar}] ${waveBar.pos}% of range | buy trigger: $${minTrgh?.toFixed(8)||"?"}`);
    }
    lines.push(`  │ 💓 ${ind.detail || "building indicators..."}`);
    // Show top trader signal when meaningful
    if (topTraderSig && topTraderSig.signal !== 'NEUTRAL' && topTraderSig.confidence >= 55) {
      const ttIcon = topTraderSig.signal === 'BUY' ? '🧠🟢' : '🧠🔴';
      lines.push(`  │ ${ttIcon} SMART MONEY ${topTraderSig.signal}: ${topTraderSig.signal === 'BUY' ? topTraderSig.smartBuys : topTraderSig.smartSells} top traders | conf ${topTraderSig.confidence}%${smartMoneyBlocking ? ' ← BLOCKING BUY' : smartMoneyConfirming ? ' ← CONFIRMING' : ''}`);
    }
    // Enhanced prediction line — show pred peak/trough prices when available
    const predPeakStr  = pred.predictedPeak   ? ` → pk:$${pred.predictedPeak.toFixed(6)}`   : "";
    const predTrghStr  = pred.predictedTrough ? ` tr:$${pred.predictedTrough.toFixed(6)}` : "";
    lines.push(`  │ ${pred.detail}${predPeakStr}${predTrghStr}`);
    if (arm.armed) lines.push(`  │ ✅ ARMED ${(arm.net*100).toFixed(2)}% [${arm.priority}] (w/ price impact)`);
    else {
      lines.push(`  │ ⏳ ${arm.reason}`);
      // Dead-wave warning: if range is so narrow it can NEVER clear fees, say so clearly
      if (maxPeak && minTrgh && maxPeak > minTrgh) {
        const grossRange = (maxPeak - minTrgh) / minTrgh;
        const minNeeded  = (token.poolFeePct || 0.006) * 2 + 0.008; // fees + gas + impact
        if (grossRange < minNeeded && peakCnt >= 2 && trghCnt >= 2) {
          lines.push(`  │ ⚠️  DEAD WAVE: ${(grossRange*100).toFixed(2)}% range, need ${(minNeeded*100).toFixed(1)}%+ to clear fees — sideways token`);
          // FIX: Track dead wave streak so we can sleep this token after N consecutive cycles
          if (!token.entryPrice) recordDeadWaveCycle(token.symbol);
        }
      }
    }
    if (drawdownHaltActive) lines.push(`  │ 🛑 DRAWDOWN HALT ACTIVE — buys suspended`);
    lines.push(`  └──────────────────────────────────────────────`);
    console.log(lines.join("\n"));

    // ── PROXIMITY ALERTS — ding when approaching buy or sell trigger ───────
    if (!proximityAlerts[token.symbol]) proximityAlerts[token.symbol] = { lastBuyAlertPct: 0, lastSellAlertPct: 0 };
    const pa = proximityAlerts[token.symbol];

    // BUY PROXIMITY — how close is price to the MIN trough buy trigger?
    // pctAboveTrough = 0% means AT the trough (buy!), 100% = at MAX (far from buy)
    if (minTrgh && maxPeak && !hasPosition && arm.armed) {
      const range = maxPeak - minTrgh;
      const distFromTrough = (price - minTrgh) / range * 100; // 0% = at buy, 100% = at sell
      // Alert when entering the buy zone: under 10% from trough = getting close
      const buyCloseness = Math.max(0, 100 - distFromTrough * 10); // 0-100% closeness
      if (buyCloseness >= 90 && pa.lastBuyAlertPct < 90) {
        pa.lastBuyAlertPct = 90;
        await tg(`🎯 <b>${token.symbol} APPROACHING BUY ZONE</b>\n` +
          `[🟩🟩🟩🟩🟩🟩🟩🟩🟩⬜] 90%+ close!\n` +
          `💲 Price: $${price.toFixed(8)}\n` +
          `🛒 Buy trigger: $${minTrgh.toFixed(8)} (+${((price-minTrgh)/minTrgh*100).toFixed(2)}% away)\n` +
          `📊 ${arm.priority} | ${(arm.net*100).toFixed(2)}% net margin\n` +
          `💓 ${ind.detail}`);
      } else if (buyCloseness >= 75 && pa.lastBuyAlertPct < 75) {
        pa.lastBuyAlertPct = 75;
        await tg(`👀 <b>${token.symbol} nearing buy zone</b>\n` +
          `[🟩🟩🟩🟩🟩🟩🟩🟩⬜⬜] 75%+ close\n` +
          `💲 $${price.toFixed(8)} → buy at $${minTrgh.toFixed(8)}`);
      } else if (buyCloseness >= 50 && pa.lastBuyAlertPct < 50) {
        pa.lastBuyAlertPct = 50;
        await tg(`📡 <b>${token.symbol} on watch</b> — halfway to buy zone\n💲 $${price.toFixed(8)} → buy at $${minTrgh.toFixed(8)}`);
      } else if (buyCloseness < 30) {
        pa.lastBuyAlertPct = 0; // reset when price moves away so alerts fire again next approach
      }
    }

    // SELL PROXIMITY — how close is price to the MAX peak sell trigger?
    if (maxPeak && minTrgh && hasPosition) {
      const range = maxPeak - minTrgh;
      const distToMax = (maxPeak - price) / range * 100; // 0% = AT max (sell!), 100% = at min
      const sellCloseness = Math.max(0, 100 - distToMax * 10);
      if (sellCloseness >= 95 && pa.lastSellAlertPct < 95) {
        pa.lastSellAlertPct = 95;
        const pnlNow = rd ? `+$${rd.pnlUsd} (+${rd.pnlPct}%)` : "";
        await tg(`🔥🔥 <b>${token.symbol} ALMOST AT SELL TARGET!</b>\n` +
          `[🟩🟩🟩🟩🟩🟩🟩🟩🟩🟨] 95%+ there!\n` +
          `💲 $${price.toFixed(8)} → sell at $${maxPeak.toFixed(8)}\n` +
          `📈 ${pnlNow}\n` +
          `⚡ Next cycle may trigger the sell!\n` +
          `💓 ${ind.detail}`);
      } else if (sellCloseness >= 85 && pa.lastSellAlertPct < 85) {
        pa.lastSellAlertPct = 85;
        const pnlNow = rd ? `+$${rd.pnlUsd} (+${rd.pnlPct}%)` : "";
        await tg(`🚀 <b>${token.symbol} closing in on target</b>\n` +
          `[🟩🟩🟩🟩🟩🟩🟩🟩🟨⬜] 85%+ to sell\n` +
          `💲 $${price.toFixed(8)} → sell at $${maxPeak.toFixed(8)}\n` +
          `${pnlNow}`);
      } else if (sellCloseness >= 70 && pa.lastSellAlertPct < 70) {
        pa.lastSellAlertPct = 70;
        await tg(`📈 <b>${token.symbol}</b> 70% to sell target — watch this one! 👀`);
      } else if (sellCloseness < 40) {
        pa.lastSellAlertPct = 0; // reset when price dips away
      }
    }

    // ── MANUAL COMMANDS ────────────────────────────────────────────────────
    const mi = manualCommands.findIndex(c => c.symbol === token.symbol);
    if (mi !== -1) {
      const cmd = manualCommands.splice(mi, 1)[0];
      if (cmd.action === "buy") {
        await executeBuy(cdp, token, bal, "MANUAL BUY", price);
      } else if (cmd.action === "sell") {
        // Manual sells bypass cooldown — operator explicitly chose to exit
        lastTradeTime[token.symbol] = 0;
        const p = await executeSell(cdp, token, 0.98, "MANUAL SELL", price, true);
        if (p > 0) { const nb = await getFullBalance(); await triggerCascade(cdp, token.symbol, p, nb); }
      } else if (cmd.action === "sellhalf") {
        // Manual sells bypass cooldown — operator explicitly chose to exit
        lastTradeTime[token.symbol] = 0;
        const p = await executeSell(cdp, token, 0.50, "MANUAL SELL HALF", price, true);
        if (p > 0) { const nb = await getFullBalance(); await triggerCascade(cdp, token.symbol, p, nb); }
      } else if (cmd.action === "exitonly") {
        // ── CLEAN EXIT — sells to WETH/ETH, NO cascade fires ─────────────────
        // Use this when you want to hold cash or withdraw, not redeploy.
        // Proceeds sit as ETH/WETH in wallet — bot will NOT auto-reinvest them.
        lastTradeTime[token.symbol] = 0;
        const pct = cmd.pct || 0.98; // default: sell everything
        await tg(`🚪 <b>CLEAN EXIT ${token.symbol} ${(pct*100).toFixed(0)}%</b>\nSelling to ETH — cascade suppressed\nProceeds will stay as ETH/WETH in wallet`);
        const p = await executeSell(cdp, token, pct, `CLEAN EXIT ${(pct*100).toFixed(0)}%`, price, true);
        if (p > 0) {
          const nb = await getFullBalance();
          const ethPrice2 = await getLiveEthPrice();
          await tg(
            `✅ <b>CLEAN EXIT COMPLETE — ${token.symbol}</b>\n` +
            `💰 Received: ${p.toFixed(6)} ETH (~$${(p*ethPrice2).toFixed(2)})\n` +
            `🏦 Wallet ETH: ${nb.eth.toFixed(6)} | WETH: ${nb.weth.toFixed(6)}\n` +
            `🚫 Cascade suppressed — funds held as ETH\n` +
            `Tip: /unwrapall then /withdrawusd [amt] to send to Coinbase`
          );
          // DO NOT call triggerCascade — that's the whole point
        }
      }
      return;
    }

    // ── STOP LOSS ──────────────────────────────────────────────────────────
    if (stopLossHit) {
      console.log(`  🛑 ${token.symbol} STOP LOSS @ $${price.toFixed(8)} < $${stopLossPrice.toFixed(8)}`);
      await tg(`🛑 <b>${token.symbol} STOP LOSS</b>\nPrice $${price.toFixed(8)} below floor $${stopLossPrice.toFixed(8)}\nEmergency exit...`);
      const p = await executeSell(cdp, token, 0.98, `STOP LOSS`, price, true);
      if (p > 0) { const nb = await getFullBalance(); await triggerCascade(cdp, token.symbol, p, nb); }
      return;
    }

    // ── FIBONACCI PARTIAL EXIT — scale out at each extension level ─────────
    // This fires BEFORE the full sell check. If price hits a Fib level (100%,
    // 127.2%, 161.8%...) we take a partial exit at that ladder rung.
    // The full shouldSell block still handles the final full exit at max peak.
    // This guarantees we ALWAYS lock in profit at the nearest profitable target,
    // even if we miss the absolute top — the ladder always has a rung to hit.
    if (shouldFibExit) {
      const { target, targets } = fibHit;
      const exitPct  = target.sellPct; // partial % defined in fib ladder
      const nextTarget = targets.exitLadder.find(t => t.price > target.price && !isFibLevelAlreadyExecuted(token.symbol, t.pct));
      const goldenStr  = target.isGolden ? ` 🌊 TSUNAMI LEVEL` : ``;

      // FIX: Record this level as executed BEFORE the sell so even if executeSell
      // fails, we don't retry the same level next cycle (which would double-sell).
      recordFibLevelExecuted(token.symbol, target.pct);

      console.log(`  📐 [${token.symbol}] FIB EXIT — ${target.label}${goldenStr} @ $${price.toFixed(8)} (${(exitPct*100).toFixed(0)}% partial)`);
      await tg(
        `📐 <b>FIB LADDER EXIT — ${token.symbol}</b>${goldenStr}\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `🎯 Hit: ${target.label} @ $${target.price.toFixed(6)}\n` +
        `💲 Price now: $${price.toFixed(8)}\n` +
        `🪙 Selling: ${(exitPct*100).toFixed(0)}% (partial — locking profit)\n` +
        `📈 Est profit: ~$${(netIfSellNow * exitPct).toFixed(3)}\n` +
        `${nextTarget ? `⏭️  Next target: ${nextTarget.label} @ $${nextTarget.price.toFixed(6)}\n` : `🏆 Final level — holding remainder\n`}` +
        `${targets.goldenTarget?.price > price ? `🌊 Tsunami target: $${targets.goldenTarget.price.toFixed(6)} (+${(((targets.goldenTarget.price-price)/price)*100).toFixed(1)}%)\n` : ``}` +
        `${targets.reloadZone ? `🔄 Reload zone: $${targets.reloadZone.price.toFixed(6)} (61.8% retrace)\n` : ``}` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `💓 ${ind.detail}`
      );
      const proceeds = await executeSell(cdp, token, exitPct, `📐 FIB ${target.label}`, price, false);
      if (proceeds > 0) { const nb = await getFullBalance(); await triggerCascade(cdp, token.symbol, proceeds, nb); }
      return;
    }

    // ── SELL AT MAX PEAK ───────────────────────────────────────────────────
    if (shouldSell) {
      pa.lastSellAlertPct = 100; // sold — reset on next buy
      const pnlUsd  = rd ? `+$${rd.pnlUsd}` : "?";
      const pnlPct  = rd ? `+${rd.pnlPct}%` : "?";
      const valueNow= rd ? `~$${rd.nowUsd}` : `${Math.floor(balance)} tokens`;
      const sellReasonLabel = earlySellSignal && !atMaxPeak && !predSell
        ? `🚀 EARLY SELL — RSI${rsiVal?.toFixed(0)} overbought + BB upper`
        : predSell && !atMaxPeak
          ? `🧠 PREDICTED PEAK [${pred.confidence}% conf φ${pred.cyclePhase?.toFixed(0)}°]`
          : `🎯 MAX PEAK HIT`;
      await tg(
        `🎉🔴 <b>SELL TRIGGERED — ${token.symbol}!</b>\n` +
        `[🟩🟩🟩🟩🟩🟩🟩🟩🟩🟩] 100% — ${sellReasonLabel}!\n\n` +
        `📋 <b>SELL RECEIPT</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `💲 Sell price:  $${price.toFixed(8)}\n` +
        `🎯 Target was:  $${maxPeak?.toFixed(8)||"?"}\n` +
        `🪙 Tokens sold: ~${Math.floor(balance * 0.98)} (98%)\n` +
        `💰 Value:       ${valueNow}\n` +
        (rd ? `📥 Entry was:   $${rd.entry.toFixed(8)}\n💵 Invested:    $${rd.invUsd}\n` : "") +
        `📈 P&L:         ${pnlUsd} (${pnlPct})\n` +
        `🐷 Piggy skim:  1%\n` +
        `🎰 Forever bag: ${calcLotteryKeep(balance)} tokens kept\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `💓 ${ind.detail}\n` +
        `⚡ Executing now...`
      );
      const sellReason = earlySellSignal && !atMaxPeak && !predSell
        ? `🚀 EARLY SELL RSI${rsiVal?.toFixed(0)} BB-upper near-peak $${maxPeak?.toFixed(8)||"?"}`
        : predSell && !atMaxPeak
          ? `🧠 PREDICTED PEAK [${pred.confidence}% conf φ${pred.cyclePhase?.toFixed(0)}°]`
          : `🎯 MAX PEAK $${maxPeak?.toFixed(8)||"?"}`;
      const proceeds = await executeSell(cdp, token, 0.98, sellReason, price, false);
      if (proceeds > 0) { const nb = await getFullBalance(); await triggerCascade(cdp, token.symbol, proceeds, nb); }
      return;
    }

    // ── BUY AT MIN TROUGH ──────────────────────────────────────────────────
    if (shouldBuy) {
      pa.lastBuyAlertPct = 100; // bought — reset sell alerts
      pa.lastSellAlertPct = 0;
      const potentialPct = maxPeak ? ((maxPeak - price) / price * 100).toFixed(1) : "?";
      const potentialUsd = maxPeak ? ((maxPeak - price) / price * bal.tradeableWithWeth * 0.30 * ethUsd).toFixed(2) : "?";
      await tg(
        `🎉🟢 <b>BUY TRIGGERED — ${token.symbol}!</b>\n` +
        `[⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜] 0% → riding begins!\n\n` +
        `📋 <b>BUY RECEIPT</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `🛒 Buy price:   $${price.toFixed(8)}\n` +
        `📉 MIN trough:  $${minTrgh.toFixed(8)} ✅ AT BOTTOM\n` +
        `🎯 Sell target: $${maxPeak?.toFixed(8)||"?"}\n` +
        `📈 Potential:   +${potentialPct}% → +$${potentialUsd}\n` +
        `📊 Wave:        ${peakCnt}P/${trghCnt}T | ${arm.priority} ${(arm.net*100).toFixed(2)}% net\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `💓 ${ind.detail}\n` +
        `${indConfirmed?"✅ Indicators confirmed":"⚠️ buying unconfirmed — watching"}\n` +
        `⚡ Executing now...`
      );
      stalePriceRef[token.symbol] = { price, timestamp: Date.now() }; // seed stale tracker on buy
      await executeBuy(cdp, token, bal, predBuy && !atMinTrough
        ? `🧠 PREDICTED TROUGH [${pred.confidence}% conf φ${pred.cyclePhase?.toFixed(0)}°]`
        : `🎯 MIN TROUGH [${arm.priority}]${indConfirmed?"":" unconfirmed"}`, price);
    }

    // ── STALE POSITION DETECTION ────────────────────────────────────────────
    // Track price movement. If a held position hasn't moved in STALE_WINDOW_MS,
    // sell a slice and cascade into the best-armed token to unlock capital.
    if (entry && balance > 1) {
      const now = Date.now();
      const ref = stalePriceRef[token.symbol];
      if (!ref) {
        stalePriceRef[token.symbol] = { price, timestamp: now };
      } else {
        const moved    = Math.abs(price - ref.price) / ref.price;
        const elapsed  = now - ref.timestamp;
        const coolOk   = !staleCooldown[token.symbol] || (now - staleCooldown[token.symbol]) > STALE_COOLDOWN_MS;
        if (moved > STALE_MOVE_PCT) {
          stalePriceRef[token.symbol] = { price, timestamp: now }; // reset on movement
        } else if (elapsed > (kahuna.staleOverride || STALE_WINDOW_MS) && coolOk && !shouldSell && !stopLossHit) {
          const staleSellUsd = sellable * price * STALE_SELL_PCT;

          // ── PROFIT GATE: must clear all costs 4x before cascading ────────────
          // Costs: pool fee 0.6% x2 (buy+sell) + gas x2 + price impact 0.4% x2 ≈ 2%
          // Require 4x overhead so the 3-way piggy split lands at ≥ $0.01 real each.
          // Never sell stale at a loss just to move capital — that shrinks the stack.
          const gasCostUsd      = gasCost * ethUsd;
          const roundTripFeeUsd = staleSellUsd * 0.02;          // ~2% all-in fees
          const allInCostUsd    = roundTripFeeUsd + (gasCostUsd * 2); // fees + double gas
          const costBasisUsd    = token.totalInvestedEth
            ? token.totalInvestedEth * STALE_SELL_PCT * ethUsd : 0;
          const estNetUsd       = staleSellUsd - allInCostUsd - costBasisUsd;
          const profitOk        = estNetUsd >= STALE_MIN_NET_USD; // nickel floor

          if (staleSellUsd >= STALE_MIN_USD && profitOk) {
            console.log(`  ⏰ [${token.symbol}] STALE CASCADE — ${(elapsed/60000).toFixed(0)}min no movement | est net $${estNetUsd.toFixed(3)} ✅`);
            await tg(
              `⏰ <b>STALE CASCADE — ${token.symbol}</b>\n` +
              `No movement for ${(elapsed/60000).toFixed(0)} min (${(moved*100).toFixed(2)}% move)\n` +
              `Selling ${(STALE_SELL_PCT*100).toFixed(0)}% — keeping ${(100-STALE_SELL_PCT*100).toFixed(0)}% riding\n` +
              `💰 ~$${staleSellUsd.toFixed(3)} gross | est net ~$${estNetUsd.toFixed(3)}\n` +
              `🐷 Each piggy pool gets ~$${(estNetUsd * PIGGY_SKIM_PCT * SKIM_LOTTERY_SHARE).toFixed(4)}`
            );
            staleCooldown[token.symbol] = now;
            stalePriceRef[token.symbol] = { price, timestamp: now };
            const proceeds = await executeSell(cdp, token, STALE_SELL_PCT, `⏰ STALE CASCADE — ${(elapsed/60000).toFixed(0)}min no movement`, price, false);
            if (proceeds > 0) { const nb = await getFullBalance(); await triggerCascade(cdp, token.symbol, proceeds, nb); }
            return;
          } else if (staleSellUsd >= STALE_MIN_USD && !profitOk) {
            // Would cascade but not profitable enough — log and wait for next wave
            console.log(`  ⏰ [${token.symbol}] stale but not profitable yet — est net $${estNetUsd.toFixed(3)} < $${STALE_MIN_NET_USD} floor. Holding for next wave.`);
            stalePriceRef[token.symbol] = { price, timestamp: now }; // reset timer — check again next cycle
          }
        }
      }
    }

    // ── PREDICTION FUND + PIGGY CO-INVEST TICK ───────────────────────────────
    await runPredFundTick(cdp, token, price, ethUsd, pred, ind);

  } catch (e) { console.log(`  ⚠️ processToken error (${token.symbol}): ${e.message}`); }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🧠 PREDICTION FUND + PIGGY CO-INVEST LAYER
// predFund  — funded by 0.33% of every profitable sell. Trades on raw signals,
//             earlier entry/exit than the main bot. Completely separate P&L.
// piggyCoPos — when predFund enters, piggy deploys 10% of its balance into the
//              same token at the same time. Proceeds return to piggy on exit.
// Neither pool ever touches the main ETH balance.
// ═══════════════════════════════════════════════════════════════════════════════
async function runPredFundTick(cdp, token, price, ethUsd, pred, ind) {
  try {
    const sym     = token.symbol;
    const pfPos   = predFundPos[sym];
    const pcPos   = piggyCoPos[sym];
    const coolOk  = !predFundCool[sym] || (Date.now() - predFundCool[sym]) > PRED_FUND_COOLDOWN;

    // ── EXIT (both pred fund and piggy co-invest) ─────────────────────────────
    const shouldExit = (pfPos || pcPos) && (
      (pred.ready && pred.action === "pre-sell" && pred.confidence >= PRED_CONFIDENCE_SELL) ||
      (pred.diScore > DI_OUTLIER_THRESHOLD) ||
      (getMaxPeak(sym) && price >= getMaxPeak(sym) * 0.995)
    );

    if (shouldExit) {
      let exitMsg = "";

      // Exit pred fund position
      if (pfPos) {
        const grossEth = (pfPos.tokens * price) / ethUsd;
        const netEth   = grossEth * (1 - (token.poolFeePct || 0.006));
        const pnlEth   = netEth - pfPos.ethIn;
        predFund    += netEth;
        predFundPnl += pnlEth;
        predFundTrades++;
        delete predFundPos[sym];
        const win = pnlEth >= 0;
        exitMsg += `🧠 PredFund: ${win?"📈":"📉"} ${pnlEth>=0?"+":""}$${(pnlEth*ethUsd).toFixed(4)} | pool now $${(predFund*ethUsd).toFixed(3)}\n`;
        console.log(`  🧠⚡ PRED FUND EXIT [${sym}] ${win?"WIN":"LOSS"} ${(pnlEth*ethUsd)>=0?"+":""}$${(pnlEth*ethUsd).toFixed(3)} | fund: ${predFund.toFixed(6)} ETH`);
      }

      // Exit piggy co-invest position — proceeds return to piggy
      if (pcPos) {
        const grossEth = (pcPos.tokens * price) / ethUsd;
        const netEth   = grossEth * (1 - (token.poolFeePct || 0.006));
        const pnlEth   = netEth - pcPos.ethIn;
        piggyBank   += netEth;   // proceeds back to piggy (locked again)
        piggyCoPnl  += pnlEth;
        delete piggyCoPos[sym];
        const win = pnlEth >= 0;
        exitMsg += `🐷 PiggyCo: ${win?"📈":"📉"} ${pnlEth>=0?"+":""}$${(pnlEth*ethUsd).toFixed(4)} | piggy now $${(piggyBank*ethUsd).toFixed(3)}\n`;
        console.log(`  🐷⚡ PIGGY CO EXIT [${sym}] ${win?"WIN":"LOSS"} ${(pnlEth*ethUsd)>=0?"+":""}$${(pnlEth*ethUsd).toFixed(3)} | piggy: ${piggyBank.toFixed(6)} ETH`);
      }

      predFundCool[sym] = Date.now();
      if (exitMsg) {
        await tg(
          `🧠⚡ <b>PRED LAYER EXIT — ${sym}</b>\n` +
          `Reason: ${pred.action==="pre-sell"?"prediction pre-sell":pred.diScore>DI_OUTLIER_THRESHOLD?"DI outlier":"main peak hit"}\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` + exitMsg +
          `📊 PredFund trades: ${predFundTrades} | CumPnL: ${predFundPnl>=0?"+":""}$${(predFundPnl*ethUsd).toFixed(3)}`
        );
      }
      return;
    }

    // ── ENTRY ─────────────────────────────────────────────────────────────────
    const canEnter = !pfPos && !pcPos &&
      pred.ready &&
      pred.action === "pre-buy" &&
      pred.confidence >= PRED_FUND_MIN_CONF &&
      pred.diScore <= DI_OUTLIER_THRESHOLD &&
      coolOk;

    let entryMsg = "";

    // Pred fund entry
    if (canEnter && predFund >= PRED_FUND_MIN_ETH) {
      const allocEth     = predFund * PRED_FUND_MAX_ALLOC;
      const netEth       = allocEth * (1 - (token.poolFeePct || 0.006));
      const tokensBought = (netEth * ethUsd) / price;
      predFund -= allocEth;
      predFundPos[sym] = { entryPrice: price, ethIn: allocEth, tokens: tokensBought, entryTime: Date.now(), conf: pred.confidence, phase: pred.cyclePhase };
      entryMsg += `🧠 PredFund: ${allocEth.toFixed(6)} ETH ($${(allocEth*ethUsd).toFixed(3)}) allocated\n`;
      console.log(`  🧠✅ PRED FUND ENTRY [${sym}] ${allocEth.toFixed(6)} ETH @ $${price.toFixed(8)} | conf:${pred.confidence}% | fund left: ${predFund.toFixed(6)} ETH`);
    }

    // Piggy co-invest entry — fires alongside pred fund entry
    if (canEnter && piggyBank >= PIGGY_COINVEST_MIN) {
      const allocEth     = Math.min(piggyBank * PIGGY_COINVEST_PCT, piggyBank);
      const netEth       = allocEth * (1 - (token.poolFeePct || 0.006));
      const tokensBought = (netEth * ethUsd) / price;
      piggyBank -= allocEth;    // unlock this slice from piggy for the trade
      piggyCoPos[sym] = { entryPrice: price, ethIn: allocEth, tokens: tokensBought, entryTime: Date.now(), conf: pred.confidence };
      entryMsg += `🐷 PiggyCo: ${allocEth.toFixed(6)} ETH ($${(allocEth*ethUsd).toFixed(3)}) co-invested\n`;
      console.log(`  🐷✅ PIGGY CO-INVEST [${sym}] ${allocEth.toFixed(6)} ETH @ $${price.toFixed(8)} | piggy left: ${piggyBank.toFixed(6)} ETH`);
    }

    if (entryMsg && canEnter) {
      predFundCool[sym] = Date.now();
      const barsStr = pred.barsToTurn ? `${pred.barsToTurn} bars to predicted turn` : "turn imminent";
      const predPeak = pred.predictedPeak ? `$${pred.predictedPeak.toFixed(8)}` : "?";
      const predTrgh = pred.predictedTrough ? `$${pred.predictedTrough.toFixed(8)}` : "?";
      await tg(
        `🧠✅ <b>PRED LAYER ENTRY — ${sym}</b>\n` +
        `Entry: $${price.toFixed(8)} | Conf: ${pred.confidence}% φ${pred.cyclePhase?.toFixed(0)}°\n` +
        `📈 Pred peak: ${predPeak} | 📉 Pred trough: ${predTrgh}\n` +
        `⏳ ${barsStr}\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` + entryMsg +
        `🧠 Fund remaining: ${predFund.toFixed(6)} ETH | 🐷 Piggy: ${piggyBank.toFixed(6)} ETH`
      );
    }

  } catch (e) {
    console.log(`  ⚠️ predFund tick error (${token.symbol}): ${e.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 💾 GITHUB PERSISTENCE — with retry
// ═══════════════════════════════════════════════════════════════════════════════
async function githubGet(path) {
  try {
    // Try STATE_BRANCH first (most recent), fall back to GITHUB_BRANCH
    const branch = STATE_BRANCH !== GITHUB_BRANCH ? STATE_BRANCH : GITHUB_BRANCH;
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}?ref=${branch}&t=${Date.now()}`,
      { headers: { Authorization: `token ${GITHUB_TOKEN}`, Accept: "application/vnd.github.v3+json" } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return { content: JSON.parse(Buffer.from(data.content.replace(/\n/g,""), "base64").toString("utf8")), sha: data.sha };
  } catch (e) { console.log(`GitHub read error (${path}): ${e.message}`); return null; }
}

async function githubSave(path, content, sha, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const body = {
        message: `state ${new Date().toISOString()}`,
        content: Buffer.from(JSON.stringify(content, null, 2)).toString("base64"),
        branch:  STATE_BRANCH,
      };
      if (sha) body.sha = sha;
      const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`, {
        method: "PUT",
        headers: { Authorization: `token ${GITHUB_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await res.json();
      if (result?.content?.sha) return result.content.sha;
      // SHA conflict — fetch fresh SHA and retry
      if (result?.message?.includes("sha")) {
        const fresh = await githubGet(path);
        sha = fresh?.sha || sha;
      }
    } catch (e) {
      console.log(`GitHub save attempt ${attempt} failed: ${e.message}`);
      if (attempt < retries) await sleep(2000 * attempt);
    }
  }
  return null;
}

async function loadFromGitHub() {
  console.log("📂 Loading from GitHub...");
  const tf = await githubGet("tokens.json");
  if (tf?.content?.tokens?.length) {
    const saved = tf.content.tokens;
    tokens = DEFAULT_TOKENS.map(def => ({
      ...def, status: "active", entryPrice: null, totalInvestedEth: 0, entryTime: null,
      ...(saved.find(s => s.symbol === def.symbol) || {}),
      feeTier: def.feeTier, poolFeePct: def.poolFeePct, minNetMargin: def.minNetMargin,
    }));
    tokensSha = tf.sha;
  } else {
    tokens = DEFAULT_TOKENS.map(t => ({ ...t, status: "active", entryPrice: null, totalInvestedEth: 0, entryTime: null }));
  }
  const hf = await githubGet("history.json");
  if (hf?.content && typeof hf.content === "object" && Object.keys(hf.content).length > 0) {
    history = hf.content;
    historySha = hf.sha;
    console.log(`   📜 history.json: loaded ${Object.keys(history).length} tokens of price history`);
  } else {
    history = {};
    historySha = hf?.sha || null;
    console.log(`   ⚠️  history.json: empty or unreadable — starting fresh (will seed from ledger + live ticks)`);
  }
  const pf = await githubGet("positions.json");
  if (pf?.content) {
    positionsSha   = pf.sha;
    const pos      = pf.content;
    piggyBank      = pos.piggyBank    || 0;
    totalSkimmed   = pos.totalSkimmed || 0;
    tradeCount     = pos.tradeCount   || 0;
    predFund       = pos.predFund     || 0;
    predFundPnl    = pos.predFundPnl  || 0;
    predFundTrades = pos.predFundTrades || 0;
    agentCapital   = pos.agentCapital || 0;
    agentPnl       = pos.agentPnl     || 0;
    piggyCoPnl     = pos.piggyCoPnl   || 0;
    if (pos.predFundPositions) {
      for (const [sym, p] of Object.entries(pos.predFundPositions)) {
        if (p?.entryPrice) predFundPos[sym] = p;
      }
    }
    if (pos.piggyCoPositions) {
      for (const [sym, p] of Object.entries(pos.piggyCoPositions)) {
        if (p?.entryPrice) piggyCoPos[sym] = p;
      }
    }
    if (pos.waveStats) {
      for (const [sym, s] of Object.entries(pos.waveStats)) {
        waveStats[sym] = s;
      }
    }
    // portfolioPeakUsd intentionally NOT loaded — stale peaks cause false drawdown halts
    for (const t of tokens) {
      if (pos.entries?.[t.symbol] != null) {
        t.entryPrice       = pos.entries[t.symbol];
        t.totalInvestedEth = pos.invested?.[t.symbol]   || 0;
        t.entryTime        = pos.entryTimes?.[t.symbol] || null;
      }
    }
  }
  const positions   = tokens.filter(t => t.entryPrice).map(t => t.symbol).join(", ");
  const pfOpen      = Object.keys(predFundPos).length;
  const pcOpen      = Object.keys(piggyCoPos).length;
  console.log(`✅ ${tokens.length} tokens | Positions: ${positions || "none"} | Piggy: ${piggyBank.toFixed(6)} ETH | Trades: ${tradeCount}`);
  console.log(`🧠 PredFund: ${predFund.toFixed(6)} ETH | Piggy: ${piggyBank.toFixed(6)} ETH | PF open: ${pfOpen} | PC open: ${pcOpen}`);
}

async function saveToGitHub() {
  try {
    tokensSha    = await githubSave("tokens.json",  { tokens, lastSaved: new Date().toISOString() }, tokensSha);

    // Trim history readings before saving — GitHub Contents API has a 1MB limit.
    // 27 tokens × 2000 readings × ~50 bytes each = ~2.7MB uncompressed.
    // Keep only the last 500 readings per token for the save (enough for all indicators).
    // Full in-memory history is kept intact for this session's wave detection.
    const historyToSave = {};
    for (const [sym, h] of Object.entries(history)) {
      historyToSave[sym] = {
        ...h,
        readings: (h.readings || []).slice(-500),
        candles: undefined,  // strip large candles object — re-fetched on boot, was causing 1MB overflow
      };
    }
    // Guard: verify JSON round-trips cleanly before saving — corrupt saves break every restart
    let historyJson;
    try {
      historyJson = JSON.stringify(historyToSave);
      JSON.parse(historyJson); // verify it parses back
    } catch (jsonErr) {
      console.log(`💾 history.json skipped — serialization error: ${jsonErr.message}`);
      historyJson = null;
    }
    if (historyJson) {
      historySha = await githubSave("history.json", historyToSave, historySha);
    }
    positionsSha = await githubSave("positions.json", {
      lastSaved: new Date().toISOString(), piggyBank, totalSkimmed, tradeCount,
      predFund, predFundPnl, predFundTrades,
      agentCapital, agentPnl,
      piggyCoPnl,
      predFundPositions: predFundPos,
      piggyCoPositions:  piggyCoPos,
      waveStats,
      entries:    Object.fromEntries(tokens.map(t => [t.symbol, t.entryPrice       || null])),
      invested:   Object.fromEntries(tokens.map(t => [t.symbol, t.totalInvestedEth || 0])),
      entryTimes: Object.fromEntries(tokens.map(t => [t.symbol, t.entryTime        || null])),
      // Per-token piggy bank contribution tracking — permanent record of what each token has earned
      piggyContrib: Object.fromEntries(tokens.map(t => [t.symbol, (waveStats[t.symbol]?.piggyContrib || 0)])),
      tradeLog:   tradeLog.slice(-200),
    }, positionsSha);
    lastSaveTime = Date.now();
    console.log("💾 Saved to GitHub");
  } catch (e) { console.log(`💾 Save error: ${e.message}`); }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 📨 TELEGRAM
// ═══════════════════════════════════════════════════════════════════════════════
// Escape characters that break Telegram HTML parse mode
function esc(str) {
  if (str == null) return "";
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function tg(msg) {
  try {
    const tok = process.env.TELEGRAM_BOT_TOKEN;
    const cid = process.env.TELEGRAM_CHAT_ID;
    if (!tok || !cid) { console.log("⚠️  Telegram: no token/chat_id set"); return; }
    // Telegram messages >4096 chars get rejected — split them
    const chunks = [];
    for (let i = 0; i < msg.length; i += 4000) chunks.push(msg.slice(i, i + 4000));
    for (const chunk of chunks) {
      const res = await fetch(`https://api.telegram.org/bot${tok.trim()}/sendMessage`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: cid.trim(), text: chunk, parse_mode: "HTML" }),
      });
      const data = await res.json();
      if (!data.ok) {
        console.log(`⚠️  Telegram send failed: ${data.description}`);
        // Retry as plain text — strip ALL html tags and decode entities
        try {
          const plain = chunk
            .replace(/<[^>]*>/g, "")          // remove tags
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&amp;/g, "&")
            .replace(/&quot;/g, '"');
          await fetch(`https://api.telegram.org/bot${tok.trim()}/sendMessage`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: cid.trim(), text: plain }),
          });
        } catch (re) { console.log(`⚠️  Telegram plain-text retry failed: ${re.message}`); }
      }
    }
  } catch (e) { console.log(`⚠️  Telegram error: ${e.message}`); }
}

// ── MINI UPDATE — compact pulse every 2 min ───────────────────────────────────
async function sendMiniUpdate(bal, ethUsd) {
  try {
    const time = new Date().toLocaleTimeString();
    let lines  = `💓 <b>GUARDIAN PULSE</b> ${time}\n`;
    lines += `💰 ${bal.tradeableWithWeth.toFixed(4)} ETH ($${(bal.tradeableWithWeth*ethUsd).toFixed(2)}) | 🐷 ${piggyBank.toFixed(6)} | #${tradeCount}\n`;
    lines += `━━━━━━━━━━━━━━━━━━━━\n`;

    for (const t of tokens) {
      const price = history[t.symbol]?.lastPrice;
      if (!price) { lines += `⏳ ${t.symbol} loading\n`; continue; }
      const bal2  = getCachedBalance(t.symbol);
      const maxP  = getMaxPeak(t.symbol);
      const minT  = getMinTrough(t.symbol);
      const arm   = getArmStatus(t.symbol, 0, bal.tradeableWithWeth);
      const rd    = t.entryPrice ? buildRaceDisplay(t, price, bal2, ethUsd) : null;

      // Wave position
      const wpos  = (maxP && minT && maxP > minT)
        ? Math.max(0, Math.min(100, (price - minT) / (maxP - minT) * 100)).toFixed(0)
        : "?";

      if (t.entryPrice && bal2 > 1) {
        // Riding with entry — show full P&L
        const pnl = rd ? ` ${rd.pnlSign}$${rd.pnlUsd}` : "";
        lines += `🏇 <b>${t.symbol}</b> $${price.toFixed(6)} [${wpos}%]${pnl}\n`;
      } else if (bal2 > 1) {
        // Holding but no entry recorded
        lines += `🏇 <b>${t.symbol}</b> $${price.toFixed(6)} [${wpos}%] (no entry)\n`;
      } else if (arm.armed) {
        // Armed, watching for buy
        const distMin = minT ? ((price-minT)/minT*100).toFixed(1) : "?";
        lines += `✅ <b>${t.symbol}</b> $${price.toFixed(6)} [${wpos}%] +${distMin}% from buy\n`;
      } else {
        // Still building
        const pc = (waveState[t.symbol]?.peaks||[]).length;
        const tc = (waveState[t.symbol]?.troughs||[]).length;
        lines += `⏳ <b>${t.symbol}</b> $${price.toFixed(6)} ${pc}P/${tc}T\n`;
      }
    }
    await tg(lines);
  } catch (e) { console.log(`Mini update error: ${e.message}`); }
}

async function sendFullReport(bal, ethUsd, title) {
  try {
    let lines = "";
    const gasCost = await estimateGasCostEth();

    for (const t of tokens) {
      const price = history[t.symbol]?.lastPrice;
      if (!price) { lines += `\n⏳ <b>${t.symbol}</b> — loading\n`; continue; }
      const tbal  = getCachedBalance(t.symbol);
      const arm   = getArmStatus(t.symbol, gasCost, bal.tradeableWithWeth);
      const maxP  = getMaxPeak(t.symbol);
      const minT  = getMinTrough(t.symbol);
      const ind   = getIndicatorScore(t.symbol);
      const rd    = t.entryPrice ? buildRaceDisplay(t, price, tbal, ethUsd) : null;
      const icon  = t.entryPrice ? "🏇" : arm.armed ? "✅" : "⏳";

      lines += `\n${icon} <b>${t.symbol}</b> $${price.toFixed(8)} | 🪙 ${tbal>=1?Math.floor(tbal):tbal.toFixed(4)} ($${(tbal*price).toFixed(2)})\n`;
      if (arm.armed) lines += `   ✅ ARMED ${(arm.net*100).toFixed(2)}% [${arm.priority}] | buy:$${minT?.toFixed(8)||"?"} sell:$${maxP?.toFixed(8)||"?"}\n`;
      else           lines += `   ⏳ ${esc(arm.reason)}\n`;
      lines += `   💓 ${ind.detail || "building..."}\n`;
      if (rd) {
        lines += `   🏇 [${rd.bar}] ${rd.racePct}% | P&L: ${rd.pnlSign}$${rd.pnlUsd}\n`;
        lines += `   📱 /sell ${t.symbol} | /sellhalf ${t.symbol}\n`;
      }
    }

    const ddStr = drawdownHaltActive ? `\n🛑 DRAWDOWN HALT ACTIVE` : "";
    const btpStr = btpPendingCount() > 0 ? `\n📡 BTP: ${btpPendingCount()} chunk(s) pending` : `\n📡 BTP: auto-fill active (VITA inscription)`;
    await tg(
      `📊 <b>GUARDIAN v15.7 💓 — ${title}</b>\n🕐 ${new Date().toLocaleTimeString()}\n\n` +
      `💰 ETH: ${bal.eth.toFixed(6)} ($${(bal.eth*ethUsd).toFixed(2)})\n` +
      `💎 WETH: ${bal.weth.toFixed(6)} ($${(bal.weth*ethUsd).toFixed(2)})\n` +
      `♻️ Tradeable (ETH+WETH): ${bal.tradeableWithWeth.toFixed(6)} ETH\n` +
      `🐷 Piggy: ${piggyBank.toFixed(6)} ETH ($${(piggyBank*ethUsd).toFixed(2)}) LOCKED\n` +
      `📈 Trades: ${tradeCount} | Skimmed: ${totalSkimmed.toFixed(6)} ETH\n` +
      `💲 ETH Price: $${ethUsd.toFixed(2)}${ddStr}${btpStr}\n` +
      `─────────────────────────` + lines +
      `\n🔗 <a href="https://basescan.org/address/${WALLET_ADDRESS}">Basescan</a>`
    );
  } catch (e) { console.log(`Report error: ${e.message}`); }
}

// ── TELEGRAM COMMAND HANDLER ──────────────────────────────────────────────────
let lastUpdateId = 0;
async function checkTelegramCommands(cdp, bal, ethUsd) {
  try {
    const tok = process.env.TELEGRAM_BOT_TOKEN;
    const cid = process.env.TELEGRAM_CHAT_ID;
    if (!tok || !cid) return;
    const res  = await fetch(`https://api.telegram.org/bot${tok}/getUpdates?offset=${lastUpdateId+1}&timeout=1`);
    const data = await res.json();
    if (!data.ok || !data.result?.length) return;

    for (const upd of data.result) {
      lastUpdateId = upd.update_id;
      const raw  = upd.message?.text?.trim() || "";
      const text = raw.toLowerCase();
      // Compare chat IDs robustly — trim whitespace, handle numeric IDs
      const msgChatId = upd.message?.chat?.id?.toString().trim();
      const expectedChatId = cid.trim();
      if (!raw || msgChatId !== expectedChatId) {
        if (raw) console.log(`📱 Ignoring msg from chat ${msgChatId} (expected ${expectedChatId})`);
        continue;
      }
      console.log(`📱 Telegram: ${raw}`);

      // ── 🔐 VAULT SESSION — Step 2: catch the key value reply ─────────────
      // If this message isn't a command AND there's an active vault session,
      // treat this message as the key value, encrypt + inscribe it, delete it.
      const vaultSession = getVaultSession(msgChatId);
      if (vaultSession && !raw.startsWith("/")) {
        clearVaultSession(msgChatId);
        const keyValue = raw.trim();

        // Delete the message from Telegram immediately (security)
        try {
          await fetch(
            "https://api.telegram.org/bot" + tok + "/deleteMessage",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ chat_id: cid, message_id: upd.message.message_id })
            }
          );
        } catch {}

        await tg(
          "⏳ <b>Encrypting + inscribing " + vaultSession.keyName + " on Base...</b>\n" +
          "Your message has been deleted from this chat."
        );

        try {
          const result = await vaultEncryptAndInscribe(
            cdpClient, WALLET_ADDRESS, vaultSession.keyName, keyValue
          );
          await tg(
            "✅ <b>VAULT KEY INSCRIBED ON BASE</b>\n\n" +
            "🔑 Key: <b>" + result.keyName + "</b>\n" +
            "📍 Location: <a href=\"" + result.basescan + "\">View on BaseScan ↗</a>\n" +
            "🔐 Encrypted with AES-256-GCM\n\n" +
            "━━━━━━━━━━━━━━━━━━━━\n" +
            "Add this to Railway env vars:\n" +
            "<code>" + result.vaultEnvKey + " = " + result.txHash + "</code>\n\n" +
            "Then you can delete <b>" + result.keyName + "</b> from Railway.\n" +
            "Bot will fetch it from Base on next boot.\n\n" +
            "💌 <i>Eureka! VITA lives ♥ — ᛞᚨᚡᛁᛞ — The truth is the chain.</i>"
          );
        } catch (e) {
          await tg("❌ <b>Vault inscription failed</b>\n" + e.message);
        }
        continue; // don't process as a command
      }

      // Each command wrapped individually — one crash can never kill the whole handler
      try {
        if (text.startsWith("/buy ")) {
        const sym = raw.split(" ")[1]?.toUpperCase();
        if (!tokens.find(t=>t.symbol===sym)) { await tg(`❓ Unknown: ${sym}`); continue; }
        if (manualCommands.find(c => c.symbol===sym && c.action==="buy")) { await tg(`⚠️ BUY ${sym} already queued`); continue; }
        manualCommands.push({ symbol: sym, action: "buy" });
        await tg(`📱 <b>BUY ${sym} queued</b>`);
      } else if (text.startsWith("/sell ") && !text.startsWith("/sellhalf")) {
        const sym = raw.split(" ")[1]?.toUpperCase();
        if (!tokens.find(t=>t.symbol===sym)) { await tg(`❓ Unknown: ${sym}`); continue; }
        if (manualCommands.find(c => c.symbol===sym && c.action==="sell")) { await tg(`⚠️ SELL ${sym} already queued`); continue; }
        manualCommands.push({ symbol: sym, action: "sell" });
        await tg(`📱 <b>SELL ${sym} queued</b>`);
      } else if (text.startsWith("/sellhalf ")) {
        const sym = raw.split(" ")[1]?.toUpperCase();
        if (!tokens.find(t=>t.symbol===sym)) { await tg(`❓ Unknown: ${sym}`); continue; }
        if (manualCommands.find(c => c.symbol===sym && c.action==="sellhalf")) { await tg(`⚠️ SELL HALF ${sym} already queued`); continue; }
        manualCommands.push({ symbol: sym, action: "sellhalf" });
        await tg(`📱 <b>SELL HALF ${sym} queued</b>`);

      // ── CLEAN EXIT COMMANDS — sell to ETH, cascade suppressed ────────────────
      // Use these instead of /sell when you want to hold cash or withdraw.
      // /exit SYMBOL       → sell 100% → ETH, no cascade
      // /exithalf SYMBOL   → sell 50%  → ETH, no cascade
      // /exitpct SYMBOL 75 → sell 75%  → ETH, no cascade
      } else if (text.startsWith("/exit ") && !text.startsWith("/exitpct") && !text.startsWith("/exithalf")) {
        const sym = raw.split(" ")[1]?.toUpperCase();
        if (!tokens.find(t=>t.symbol===sym)) { await tg(`❓ Unknown token: ${sym}\nUsage: /exit SYMBOL`); continue; }
        const token = tokens.find(t=>t.symbol===sym);
        if (!token.entryPrice) { await tg(`❓ <b>${sym}</b> — no open position to exit`); continue; }
        if (manualCommands.find(c => c.symbol===sym && c.action==="exitonly")) { await tg(`⚠️ EXIT ${sym} already queued`); continue; }
        manualCommands.push({ symbol: sym, action: "exitonly", pct: 0.98 });
        await tg(`🚪 <b>CLEAN EXIT ${sym} queued (100%)</b>\nWill sell to ETH — NO cascade will fire\nProceeds stay in wallet as ETH`);

      } else if (text.startsWith("/exithalf ")) {
        const sym = raw.split(" ")[1]?.toUpperCase();
        if (!tokens.find(t=>t.symbol===sym)) { await tg(`❓ Unknown token: ${sym}\nUsage: /exithalf SYMBOL`); continue; }
        const token = tokens.find(t=>t.symbol===sym);
        if (!token.entryPrice) { await tg(`❓ <b>${sym}</b> — no open position to exit`); continue; }
        if (manualCommands.find(c => c.symbol===sym && c.action==="exitonly")) { await tg(`⚠️ EXIT ${sym} already queued`); continue; }
        manualCommands.push({ symbol: sym, action: "exitonly", pct: 0.50 });
        await tg(`🚪 <b>CLEAN EXIT ${sym} HALF queued (50%)</b>\nWill sell to ETH — NO cascade will fire`);

      } else if (text.startsWith("/exitpct ")) {
        const parts = raw.split(" ");
        const sym   = parts[1]?.toUpperCase();
        const pct   = parseFloat(parts[2]);
        if (!sym || !tokens.find(t=>t.symbol===sym)) { await tg(`❓ Usage: /exitpct SYMBOL 75\nExample: /exitpct BRETT 75 sells 75% to ETH`); continue; }
        if (!pct || isNaN(pct) || pct <= 0 || pct > 100) { await tg(`❓ Percentage must be 1–100\nExample: /exitpct BRETT 75`); continue; }
        const token = tokens.find(t=>t.symbol===sym);
        if (!token.entryPrice) { await tg(`❓ <b>${sym}</b> — no open position to exit`); continue; }
        if (manualCommands.find(c => c.symbol===sym && c.action==="exitonly")) { await tg(`⚠️ EXIT ${sym} already queued`); continue; }
        manualCommands.push({ symbol: sym, action: "exitonly", pct: pct / 100 });
        await tg(`🚪 <b>CLEAN EXIT ${sym} ${pct}% queued</b>\nWill sell to ETH — NO cascade will fire`);
      } else if (text === "/status") {
        await sendFullReport(bal, ethUsd, "📊 STATUS");
      } else if (text === "/turbo") {
        // Turbo mode: already the new default — confirm current settings
        await tg(
          `⚡ <b>TURBO MODE — ACTIVE</b>\n\n` +
          `🔧 Current settings:\n` +
          `   Min waves to trade: ${MIN_PEAKS_TO_TRADE}P / ${MIN_TROUGHS_TO_TRADE}T\n` +
          `   Min net margin: ${(MIN_NET_MARGIN*100).toFixed(1)}%\n` +
          `   Wave sensitivity: ${(WAVE_MIN_MOVE*100).toFixed(1)}% move = new wave\n` +
          `   Cycle speed: ${TRADE_LOOP_MS/1000}s\n` +
          `   Cooldown: ${COOLDOWN_MS/1000}s between trades\n` +
          `   Error buffer: ${(PROFIT_ERROR_BUFFER*100).toFixed(1)}%\n\n` +
          `Every entry becomes a wave anchor. First profit pays for itself. LET'S GO 🚀`
        );
      } else if (text.startsWith("/fib")) {
        // /fib         → show all tokens with positions
        // /fib SYMBOL  → show full fib map for a specific token
        const parts = text.split(" ");
        const sym = parts[1]?.toUpperCase();
        if (sym) {
          const tok = tokens.find(t => t.symbol === sym);
          const p   = history[sym]?.lastPrice;
          if (!tok || !p) { await tg(`❓ Unknown or no price: ${sym}`); }
          else {
            const display = formatFibDisplay(sym, p, tok.entryPrice);
            if (!display) await tg(`⏳ <b>${sym}</b>: not enough wave data yet`);
            else await tg(display);
          }
        } else {
          // Show next fib target for every held position
          let msg = `📐 <b>FIB LADDER — ALL POSITIONS</b>\n🕐 ${new Date().toLocaleTimeString()}\n\n`;
          let any = false;
          for (const t of tokens) {
            if (!t.entryPrice) continue;
            const p = history[t.symbol]?.lastPrice;
            if (!p) continue;
            any = true;
            const fibT = getFibTargets(t.symbol, t.entryPrice, 0.0001, bal?.tradeableWithWeth||0.001, ethUsd);
            if (!fibT) { msg += `⏳ <b>${t.symbol}</b>: not enough data\n\n`; continue; }
            const next    = fibT.exitLadder.find(tgt => tgt.price > p);
            const tsunami = fibT.goldenTarget;
            const reload  = fibT.reloadZone;
            const pnl     = ((p - t.entryPrice) / t.entryPrice * 100).toFixed(1);
            const pnlSign = parseFloat(pnl) >= 0 ? `+` : ``;
            msg += `${parseFloat(pnl) >= 0 ? `📈` : `📉`} <b>${t.symbol}</b> ${pnlSign}${pnl}% | $${p.toFixed(6)}\n`;
            msg += `   🛒 Entry: $${t.entryPrice.toFixed(6)}\n`;
            if (next)    msg += `   ⏭️  Next fib: ${next.label} @ $${next.price.toFixed(6)} (+${((next.price-p)/p*100).toFixed(1)}%) → sell ${(next.sellPct*100).toFixed(0)}%\n`;
            if (tsunami && tsunami.price > p) msg += `   🌊 Tsunami: $${tsunami.price.toFixed(6)} (+${((tsunami.price-p)/p*100).toFixed(1)}%)\n`;
            if (reload)  msg += `   🔄 Reload: $${reload.price.toFixed(6)} (61.8% retrace)\n`;
            msg += `\n`;
          }
          if (!any) msg += `No open positions.\n`;
          msg += `\n<i>Use /fib SYMBOL for the full ladder map</i>`;
          await tg(msg);
        }
      } else if (text === "/waves") {
        const gasCost = await estimateGasCostEth();
        let msg = `🌊 <b>WAVE STATUS v13 💓</b>\n🕐 ${new Date().toLocaleTimeString()}\n\n`;
        msg += `<i>Buy MIN trough | Sell MAX peak | Indicators confirm</i>\n\n`;
        for (const t of tokens) {
          const p   = history[t.symbol]?.lastPrice;
          if (!p) { msg += `⏳ <b>${t.symbol}</b> — loading\n\n`; continue; }
          const arm = getArmStatus(t.symbol, gasCost, bal.tradeableWithWeth);
          const ind = getIndicatorScore(t.symbol);
          const maxP= getMaxPeak(t.symbol), minT = getMinTrough(t.symbol);
          const pct = minT ? ((p-minT)/minT*100).toFixed(1) : "?";
          const icon= arm.armed ? "✅" : "⏳";
          msg += `${icon} <b>${t.symbol}</b> $${p.toFixed(8)}\n`;
          msg += `   Buy (MIN): $${minT?.toFixed(8)||"?"} (+${pct}% above)\n`;
          msg += `   Sell (MAX): $${maxP?.toFixed(8)||"?"}\n`;
          msg += `   Waves: ${getPeakCount(t.symbol)}P / ${getTroughCount(t.symbol)}T\n`;
          msg += `   💓 ${ind.detail || "building..."}\n`;
          msg += arm.armed
            ? `   ✅ ARMED ${(arm.net*100).toFixed(2)}% net [${arm.priority}]\n\n`
            : `   ⏳ ${esc(arm.reason)}\n\n`;
        }
        await tg(msg);
      } else if (text === "/race") {
        let msg = `🏇 <b>RACEHORSE STANDINGS</b>\n🕐 ${new Date().toLocaleTimeString()}\n\n`;
        let anyRiding = false;
        for (const t of tokens) {
          const p = history[t.symbol]?.lastPrice;
          const b = getCachedBalance(t.symbol);
          if (!p || b < 1) continue;
          anyRiding = true;
          const maxP = getMaxPeak(t.symbol);
          const minT = getMinTrough(t.symbol);
          const rd   = t.entryPrice ? buildRaceDisplay(t, p, b, ethUsd) : null;
          const wpos = (maxP && minT && maxP > minT)
            ? Math.max(0, Math.min(100, (p - minT) / (maxP - minT) * 100)) : null;
          const fill = wpos !== null ? Math.floor(wpos / 10) : 5;
          const bar  = "🟩".repeat(fill) + "⬜".repeat(10 - fill);
          if (rd) {
            msg += `🏇 <b>${t.symbol}</b> [${bar}] ${wpos?.toFixed(0)||"?"}%\n`;
            msg += `   📥 Entry $${rd.entry.toFixed(8)} → Now $${p.toFixed(8)}\n`;
            msg += `   💲 Value ~$${rd.nowUsd} | ${rd.pnlSign}$${rd.pnlUsd} (${rd.pnlSign}${rd.pnlPct}%)\n`;
            msg += `   🎯 Target $${rd.sellTarget?.toFixed(8)||"?"} → ~$${rd.tgtUsd}\n`;
            msg += `   🪙 ${Math.floor(b)} tokens | 🎰 ${rd.lottery} forever bag\n`;
            msg += `   📱 /sell ${t.symbol} | /sellhalf ${t.symbol}\n\n`;
          } else {
            const pctToTarget = maxP ? ((maxP - p) / p * 100).toFixed(1) : "?";
            msg += `🏇 <b>${t.symbol}</b> [${bar}] ${wpos?.toFixed(0)||"?"}% <i>(no entry recorded)</i>\n`;
            msg += `   Now $${p.toFixed(8)} | 🪙 ${Math.floor(b)} ($${(b*p).toFixed(2)})\n`;
            msg += `   🎯 Target $${maxP?.toFixed(8)||"?"} (+${pctToTarget}% away)\n`;
            msg += `   📱 /sell ${t.symbol} | /sellhalf ${t.symbol}\n\n`;
          }
        }
        if (!anyRiding) msg += "No open positions holding tokens.";
        await tg(msg);
      } else if (text === "/positions") {
        let msg = `📋 <b>ALL POSITIONS</b>\n🕐 ${new Date().toLocaleTimeString()}\n\n`;
        let anyHolding = false;
        for (const t of tokens) {
          const p = history[t.symbol]?.lastPrice;
          const b = getCachedBalance(t.symbol);
          if (!p || b < 1) continue;
          anyHolding = true;
          const maxP = getMaxPeak(t.symbol);
          const minT = getMinTrough(t.symbol);
          const arm  = getArmStatus(t.symbol, 0, bal.tradeableWithWeth);
          const rd   = t.entryPrice ? buildRaceDisplay(t, p, b, ethUsd) : null;
          const wpos = (maxP && minT && maxP > minT)
            ? Math.max(0, Math.min(100, (p - minT) / (maxP - minT) * 100)) : null;
          const fill = wpos !== null ? Math.floor(wpos / 10) : 5;
          const bar  = "🟩".repeat(fill) + "⬜".repeat(10 - fill);
          msg += `🏇 <b>${t.symbol}</b> [${bar}] ${wpos?.toFixed(0)||"?"}% of wave\n`;
          msg += `   💲 $${p.toFixed(8)} | 🪙 ${Math.floor(b)} tokens ($${(b*p).toFixed(2)})\n`;
          if (rd) {
            msg += `   📥 Entry: $${rd.entry.toFixed(8)} | Invested: $${rd.invUsd}\n`;
            msg += `   ${rd.pnlUsd >= 0 ? "📈" : "📉"} P&L: ${rd.pnlSign}$${rd.pnlUsd} (${rd.pnlSign}${rd.pnlPct}%)\n`;
            msg += `   🎯 Sell at: $${rd.sellTarget?.toFixed(8)||"?"} → ~$${rd.tgtUsd}\n`;
          } else {
            msg += `   🎯 Sell target: $${maxP?.toFixed(8)||"?"}\n`;
            msg += `   ℹ️ Bought before entry tracking — no P&L data\n`;
          }
          msg += `   ${arm.armed ? `✅ ARMED ${(arm.net*100).toFixed(2)}% — ready to sell` : `⏳ ${arm.reason}`}\n`;
          msg += `   📱 /sell ${t.symbol} | /sellhalf ${t.symbol}\n\n`;
        }
        if (!anyHolding) msg += "No tokens currently held.";
        await tg(msg);
      } else if (text === "/eth") {
        await tg(`💰 <b>BALANCES</b>\nETH: ${bal.eth.toFixed(6)} ($${(bal.eth*ethUsd).toFixed(2)})\nWETH: ${bal.weth.toFixed(6)} ($${(bal.weth*ethUsd).toFixed(2)})\nTradeable (ETH+WETH): ${bal.tradeableWithWeth.toFixed(6)}\n🐷 Piggy: ${piggyBank.toFixed(6)} ETH (LOCKED)\n💲 ETH = $${ethUsd.toFixed(2)}`);
      } else if (text === "/piggy") {
        const pct     = Math.min((piggyBank/0.5)*100, 100);
        const pfUsd   = predFund   * ethUsd;
        const agUsd   = agentCapital * ethUsd;
        const pcOpen  = Object.entries(piggyCoPos).map(([s,p]) => `${s}: +$${((((p.tokens*0)||0)*ethUsd-(p.ethIn||0)*ethUsd)).toFixed(3)}`).join(", ") || "none";
        const pfOpen  = Object.keys(predFundPos).join(", ") || "none";
        await tg(
          `🐷🧠🤖 <b>THE THREE POOLS</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━\n\n` +
          `🐷 <b>Piggy Bank</b> (locked savings)\n` +
          `   ${piggyBank.toFixed(6)} ETH = $${(piggyBank*ethUsd).toFixed(2)}\n` +
          `   Goal: 0.5 ETH (${pct.toFixed(1)}%)\n` +
          `   Co-invest PnL: ${piggyCoPnl>=0?"+":""}$${(piggyCoPnl*ethUsd).toFixed(3)}\n` +
          `   Co-invest open: ${pcOpen}\n\n` +
          `🧠 <b>Prediction Fund</b> (self-trading)\n` +
          `   ${predFund.toFixed(6)} ETH = $${pfUsd.toFixed(3)}\n` +
          `   ${predFundTrades} trades | PnL: ${predFundPnl>=0?"+":""}$${(predFundPnl*ethUsd).toFixed(3)}\n` +
          `   Open: ${pfOpen}\n\n` +
          `🤖 <b>Agentic Capital</b> (research layer)\n` +
          `   ${agentCapital.toFixed(6)} ETH = $${agUsd.toFixed(3)}\n` +
          `   Accumulating — Phase 3 not yet active\n\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `Total skimmed: ${totalSkimmed.toFixed(6)} ETH\n` +
          `0.33% per pool per profitable sell`
        );
      } else if (text === "/trades") {
        const recent = tradeLog.slice(-5).map(t=>`${t.type} ${t.symbol} $${parseFloat(t.price).toFixed(8)} score:${t.indScore||"?"} ${t.timestamp?.slice(11,19)||""}`).join("\n");
        await tg(`📈 <b>TRADES</b>\nCount: ${tradeCount} | Skimmed: ${totalSkimmed.toFixed(6)} ETH\n\nRecent:\n${recent||"none"}`);

      } else if (text === "/leaderboard") {
        // 🏄 Full wave leaderboard — all tokens ranked by total P&L contribution
        const allStats = Object.entries(waveStats)
          .filter(([, s]) => s.wins + s.losses > 0)
          .sort(([,a],[,b]) => (b.totalPnlEth - a.totalPnlEth));
        if (!allStats.length) {
          await tg("🏄 No completed waves yet — leaderboard building!");
        } else {
          let msg = `🏆 <b>WAVE LEADERBOARD</b>\n━━━━━━━━━━━━━━━━━━━━\n`;
          const medals = ["🥇","🥈","🥉","4️⃣","5️⃣","6️⃣","7️⃣","8️⃣","9️⃣","🔟"];
          allStats.forEach(([sym, s], i) => {
            const totalWaves = s.wins + s.losses;
            const winRate    = totalWaves > 0 ? ((s.wins/totalWaves)*100).toFixed(0) : "0";
            const pnlUsd     = (s.totalPnlEth * ethUsd).toFixed(2);
            const bigWave    = s.biggestWavePct > 0 ? `+${s.biggestWavePct.toFixed(1)}%` : "—";
            const fastWave   = s.fastestWaveMs < Infinity ? (s.fastestWaveMs<3600000?`${(s.fastestWaveMs/60000).toFixed(0)}m`:`${(s.fastestWaveMs/3600000).toFixed(1)}h`) : "—";
            const rank       = medals[i] || `${i+1}.`;
            msg += `${rank} <b>${sym}</b> | ${s.medals.gold}🥇${s.medals.silver}🥈${s.medals.bronze}🥉${s.losses>0?s.losses+"🦈":""}\n`;
            msg += `   ${s.wins}W/${s.losses}L (${winRate}%) | P&L: ${parseFloat(pnlUsd)>=0?"+":""}$${pnlUsd}\n`;
            msg += `   🌊 Biggest: ${bigWave} | ⚡ Fastest: ${fastWave}\n`;
            msg += `   🐷 Piggy contrib: $${(s.piggyContrib*ethUsd).toFixed(3)}\n`;
          });
          msg += `━━━━━━━━━━━━━━━━━━━━\n`;
          msg += `🐷 Total piggy: $${(piggyBank*ethUsd).toFixed(2)} | 📊 Trades: ${tradeCount}`;
          await tg(msg);
        }

      } else if (text === "/surf") {
        // 🌊 Quick surf status — all currently riding positions as a surf report
        const riding = tokens.filter(t => t.entryPrice && history[t.symbol]?.lastPrice);
        if (!riding.length) { await tg("🌊 No open positions — waiting for the next wave!"); }
        else {
          let msg = `🌊 <b>SURF REPORT</b>\n━━━━━━━━━━━━━━━━━━━━\n`;
          for (const t of riding) {
            const price   = history[t.symbol]?.lastPrice || 0;
            const maxP    = getMaxPeak(t.symbol);
            const minT    = getMinTrough(t.symbol);
            const rng     = maxP && minT && maxP > minT ? maxP - minT : 0;
            const surfPct = rng > 0 ? Math.max(0, Math.min(1, (price - minT) / rng)) : 0;
            const pnlPct  = ((price - t.entryPrice) / t.entryPrice * 100).toFixed(1);
            const bar     = surfRideBar(surfPct);
            const ws2     = waveStats[t.symbol];
            const medals2 = ws2 ? `${ws2.medals.gold}🥇${ws2.medals.silver}🥈${ws2.medals.bronze}🥉` : "—";
            msg += `<b>${t.symbol}</b> ${parseFloat(pnlPct)>=0?"📈":"📉"} ${pnlPct}%\n`;
            msg += `〰️[${bar}]〰️\n`;
            msg += `   ${(surfPct*100).toFixed(0)}% of wave | ${medals2}\n`;
          }
          msg += `━━━━━━━━━━━━━━━━━━━━\n🐷 Piggy: $${(piggyBank*ethUsd).toFixed(2)}`;
          await tg(msg);
        }
      } else if (text === "/drawdown") {
        const status = drawdownHaltActive ? "🛑 HALT ACTIVE — buys suspended" : "✅ Normal — buys active";
        await tg(`📉 <b>DRAWDOWN STATUS</b>\n${status}\nPeak: $${portfolioPeakUsd.toFixed(2)}\nHalt at: -${(DRAWDOWN_HALT_PCT*100).toFixed(0)}% from peak`);
      } else if (text === "/gas") {
        const gwei = await getCurrentGasGwei();
        const safe = gwei <= MAX_GAS_GWEI;
        await tg(`⛽ <b>GAS STATUS</b>\nCurrent: ${gwei.toFixed(1)} gwei\nMax allowed: ${MAX_GAS_GWEI} gwei\n${safe?"✅ SAFE — trades active":"🛑 SPIKE — trades paused"}`);
      } else if (text === "/indicators") {
        let msg = `💓 <b>HEARTBEAT INDICATORS</b>\n🕐 ${new Date().toLocaleTimeString()}\n\n`;
        for (const t of tokens) {
          const ind = getIndicatorScore(t.symbol);
          const p   = history[t.symbol]?.lastPrice;
          if (!p) continue;
          const scoreBar = ind.score >= 2 ? "🟢🟢" : ind.score === 1 ? "🟢" : ind.score === 0 ? "⬜" : ind.score === -1 ? "🔴" : "🔴🔴";
          msg += `${scoreBar} <b>${t.symbol}</b> ${ind.detail || "building..."}\n`;
        }
        await tg(msg);
      } else if (text === "/profit") {
        // Show projected profit for all open positions at MAX peak target
        let msg = `💰 <b>PROJECTED PROFITS AT TARGET</b>\n🕐 ${new Date().toLocaleTimeString()}\n\n`;
        let any = false;
        for (const t of tokens) {
          if (!t.entryPrice) continue; any = true;
          const p   = history[t.symbol]?.lastPrice || t.entryPrice;
          const b   = getCachedBalance(t.symbol);
          const maxP = getMaxPeak(t.symbol);
          const lottery = Math.max(Math.floor(b * LOTTERY_PCT), MIN_LOTTERY_TOKENS);
          const sellable = Math.max(b - lottery, 0);
          const invUsd  = (t.totalInvestedEth || 0) * cachedEthUsd;
          const nowUsd  = sellable * p;
          const tgtUsd  = maxP ? sellable * maxP : null;
          const projNet = tgtUsd ? tgtUsd * (1 - (t.poolFeePct||0.006)) - invUsd : null;
          const pnlNow  = nowUsd - invUsd;
          const distPct = maxP ? ((maxP - p) / p * 100).toFixed(2) : "?";
          const pigSkim = tgtUsd ? (tgtUsd / cachedEthUsd * 0.01 * cachedEthUsd).toFixed(2) : "?";
          const icon    = pnlNow >= 0 ? "📈" : "📉";
          msg += `${icon} <b>${t.symbol}</b>\n`;
          msg += `   Now: $${p.toFixed(8)} | P&L now: ${pnlNow>=0?"+":""}$${pnlNow.toFixed(2)}\n`;
          msg += `   Target (MAX peak): $${maxP?.toFixed(8)||"?"} (${distPct}% away)\n`;
          msg += tgtUsd
            ? `   🎯 AT TARGET: +$${projNet?.toFixed(2)||"?"} profit | 🐷 $${pigSkim} skim\n\n`
            : `   🎯 target: learning...\n\n`;
        }
        if (!any) msg = `💰 No open positions.\nUse /waves to see armed tokens.`;
        await tg(msg);
      } else if (text === "/wake" || text === "/gm") {
        const ethUsd  = cachedEthUsd;
        const bal     = cachedBal || { eth:0, weth:0, total:0, tradeableWithWeth:0 };
        const gasCost = await estimateGasCostEth();
        const gwei    = await getCurrentGasGwei();
        const gasSafe = gwei <= MAX_GAS_GWEI;
        let totalTokenUsd = 0, positionLines = "", watchLines = "", buildingLines = "";

        for (const t of tokens) {
          const p    = history[t.symbol]?.lastPrice || 0;
          const b    = getCachedBalance(t.symbol);
          const arm  = getArmStatus(t.symbol, gasCost, bal.tradeableWithWeth);
          const ind  = getIndicatorScore(t.symbol);
          const maxP = getMaxPeak(t.symbol);
          const minT = getMinTrough(t.symbol);
          totalTokenUsd += b * p;
          const distToSell = maxP ? ((maxP - p) / p * 100).toFixed(1) : "?";
          const distToBuy  = minT ? ((p - minT) / minT * 100).toFixed(1) : "?";

          if (b > 1 && t.entryPrice) {
            const lottery  = Math.max(Math.floor(b * LOTTERY_PCT), MIN_LOTTERY_TOKENS);
            const sellable = Math.max(b - lottery, 0);
            const invUsd   = (t.totalInvestedEth || 0) * ethUsd;
            const nowUsd   = sellable * p;
            const pnl      = nowUsd - invUsd;
            const pnlPct   = invUsd > 0 ? (pnl / invUsd * 100).toFixed(1) : "?";
            const tgtUsd   = maxP ? (sellable * maxP * (1-(t.poolFeePct||0.006)) - invUsd).toFixed(2) : "?";
            positionLines += "\n\uD83C\uDFC7 <b>" + t.symbol + "</b> \u2014 RIDING\n" +
              "   Now: $" + p.toFixed(6) + " | Worth: $" + nowUsd.toFixed(2) + "\n" +
              "   P&L now: " + (pnl>=0?"📈 +":"📉 ") + "$" + pnl.toFixed(2) + " (" + pnlPct + "%)\n" +
              "   Target: $" + (maxP?.toFixed(6)||"?") + " \u2014 " + distToSell + "% away\n" +
              "   At target you earn: +$" + tgtUsd + "\n" +
              "   Signals: " + (ind.detail || "building...") + "\n";
          } else if (arm.armed) {
            watchLines += "\n\u2705 <b>" + t.symbol + "</b> \u2014 ARMED [" + arm.priority + "] " + (arm.net*100).toFixed(1) + "% margin\n" +
              "   Buy signal at: $" + (minT?.toFixed(6)||"?") + " (currently " + distToBuy + "% above)\n" +
              "   Sell target:   $" + (maxP?.toFixed(6)||"?") + "\n" +
              "   Signals: " + (ind.detail || "building...") + "\n";
          } else {
            buildingLines += "\n\u23F3 <b>" + t.symbol + "</b> \u2014 " + esc(arm.reason) + "\n" +
              "   Now: $" + p.toFixed(6) + " | " + getPeakCount(t.symbol) + "P " + getTroughCount(t.symbol) + "T waves recorded\n";
          }
        }

        const walletUsd  = bal.total * ethUsd;
        const totalUsd   = walletUsd + totalTokenUsd;
        const piggyUsd   = piggyBank * ethUsd;
        const deployable = bal.tradeableWithWeth * ethUsd;

        await tg(
          "\u2694\uFE0F\uD83D\uDC93 <b>GUARDIAN \u2014 MORNING REPORT</b>\n" +
          "\uD83D\uDD50 " + new Date().toLocaleString() + "\n" +
          "\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n\n" +

          "<b>\uD83D\uDCB0 WALLET</b>\n" +
          "   ETH:             " + (bal.eth||0).toFixed(6) + " ($" + ((bal.eth||0)*ethUsd).toFixed(2) + ")\n" +
          "   WETH:            " + (bal.weth||0).toFixed(6) + " ($" + ((bal.weth||0)*ethUsd).toFixed(2) + ")\n" +
          "   Ready to deploy: $" + deployable.toFixed(2) + "\n" +
          "   ETH price:       $" + ethUsd.toFixed(2) + "\n\n" +

          "<b>\uD83D\uDCC8 PORTFOLIO</b>\n" +
          "   Token positions: $" + totalTokenUsd.toFixed(2) + "\n" +
          "   Total value:     $" + totalUsd.toFixed(2) + "\n" +
          "   Trades done:     " + tradeCount + "\n\n" +

          "<b>\uD83D\uDC37 PIGGY BANK</b> (locked \u2014 yours forever)\n" +
          "   " + piggyBank.toFixed(6) + " ETH = $" + piggyUsd.toFixed(2) + "\n" +
          "   Every profitable sell adds 1% here automatically\n\n" +

          "<b>\u26FD NETWORK</b>\n" +
          "   Gas: " + gwei.toFixed(1) + " gwei \u2014 " + (gasSafe?"✅ Safe to trade":"🛑 Too high, paused") + "\n" +
          "   Drawdown guard: " + (drawdownHaltActive?"🛑 ACTIVE \u2014 buys paused":"✅ Clear") + "\n\n" +

          "\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n" +
          "<b>\uD83C\uDFC7 ACTIVE POSITIONS</b>" + (positionLines || "\n   None open\n") + "\n" +

          "\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n" +
          "<b>\u2705 ARMED \u2014 WATCHING FOR ENTRY</b>" + (watchLines || "\n   None armed yet\n") + "\n" +

          "\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n" +
          "<b>\u23F3 BUILDING WAVE DATA</b>" + (buildingLines || "\n   All tokens ready\n") + "\n" +

          "\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n" +
          "<b>\uD83D\uDCCB QUICK ACTIONS</b>\n" +
          "   /bank \u2014 full money statement\n" +
          "   /profit \u2014 projected earnings\n" +
          "   /sell SYMBOL \u2014 manual exit\n" +
          "   /waves \u2014 detailed levels"
        );

      } else if (text === "/bank") {
        const ethUsd = cachedEthUsd;
        const bal    = cachedBal || { eth:0, weth:0, total:0, tradeableWithWeth:0 };
        let invested = 0, currentValue = 0, unrealisedPnl = 0, posDetails = "";

        for (const t of tokens) {
          const p   = history[t.symbol]?.lastPrice || 0;
          const b   = getCachedBalance(t.symbol);
          if (b < 1) continue;
          const lottery  = Math.max(Math.floor(b * LOTTERY_PCT), MIN_LOTTERY_TOKENS);
          const sellable = Math.max(b - lottery, 0);
          const invUsd   = (t.totalInvestedEth || 0) * ethUsd;
          const nowUsd   = sellable * p;
          const pnl      = nowUsd - invUsd;
          invested      += invUsd;
          currentValue  += nowUsd;
          unrealisedPnl += pnl;
          const maxP   = getMaxPeak(t.symbol);
          const projUsd = maxP ? (sellable * maxP * (1-(t.poolFeePct||0.006)) - invUsd) : null;
          posDetails +=
            "\n<b>" + t.symbol + "</b>\n" +
            "   Invested:    $" + invUsd.toFixed(2) + "\n" +
            "   Now worth:   $" + nowUsd.toFixed(2) + "\n" +
            "   Unrealised:  " + (pnl>=0?"+":" ") + "$" + pnl.toFixed(2) + "\n" +
            "   At target:   " + (projUsd !== null ? "+$"+projUsd.toFixed(2) : "calculating") + "\n" +
            "   Holding:     " + (sellable>=1?Math.floor(sellable):sellable.toFixed(4)) + " tradeable + " + lottery + " forever\n";
        }

        const walletUsd  = bal.total * ethUsd;
        const piggyUsd   = piggyBank * ethUsd;
        const skimmedUsd = totalSkimmed * ethUsd;

        await tg(
          "\uD83C\uDFE6 <b>GUARDIAN BANK STATEMENT</b>\n" +
          "\uD83D\uDD50 " + new Date().toLocaleString() + "\n" +
          "\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n\n" +

          "<b>CASH IN WALLET</b>\n" +
          "   ETH:   " + (bal.eth||0).toFixed(6) + " ($" + ((bal.eth||0)*ethUsd).toFixed(2) + ")\n" +
          "   WETH:  " + (bal.weth||0).toFixed(6) + " ($" + ((bal.weth||0)*ethUsd).toFixed(2) + ")\n" +
          "   Total cash: $" + walletUsd.toFixed(2) + "\n\n" +

          "<b>OPEN POSITIONS</b>" + (posDetails || "\n   None\n") + "\n" +

          "<b>TOTAL PICTURE</b>\n" +
          "   Money in trades:    $" + invested.toFixed(2) + "\n" +
          "   Those trades worth: $" + currentValue.toFixed(2) + "\n" +
          "   Unrealised gain:    " + (unrealisedPnl>=0?"+":" ") + "$" + unrealisedPnl.toFixed(2) + "\n" +
          "   Cash + positions:   $" + (walletUsd + currentValue).toFixed(2) + "\n\n" +

          "<b>PIGGY BANK</b> \u2014 locked, yours forever\n" +
          "   " + piggyBank.toFixed(6) + " ETH = $" + piggyUsd.toFixed(2) + "\n" +
          "   All-time skimmed: $" + skimmedUsd.toFixed(2) + " over " + tradeCount + " trades\n\n" +

          "<b>PROOF</b>\n" +
          "   On-chain: basescan.org/address/" + WALLET_ADDRESS + "\n" +
          "   Every trade recorded. Nothing hidden."
        );

      } else if (text.startsWith("/ledger")) {
        // /ledger       — summary stats + last 5 trades
        // /ledger full  — last 20 trades
        const full = text.includes("full");
        const lf   = await githubGetFromBranch("ledger.json", STATE_BRANCH);
        if (!lf?.content?.trades?.length) {
          await tg(`📖 <b>LEDGER</b>\nNo trades recorded yet.\nEvery future trade will be permanently logged here.`);
        } else {
          const ledger = lf.content;
          const s      = ledger.stats || {};
          const trades = ledger.trades.slice(full ? -20 : -5).reverse(); // most recent first

          let tradeLines = "";
          for (const t of trades) {
            const date = new Date(t.timestamp).toLocaleDateString();
            const time = new Date(t.timestamp).toLocaleTimeString();
            if (t.type === "BUY") {
              tradeLines +=
                `\n🟢 <b>#${t.tradeNum||"?"} BUY ${t.symbol}</b> — ${date} ${time}\n` +
                `   Price:    $${(t.price||0).toFixed(8)}\n` +
                `   Spent:    ${(t.ethSpent||0).toFixed(6)} ETH (~$${(t.usdValue||0).toFixed(2)})\n` +
                `   Margin:   ${((t.netMargin||0)*100).toFixed(1)}% [${t.priority||"?"}]\n` +
                `   Signals:  ${t.indDetail||"—"}\n` +
                `   🔗 <a href="${t.basescan}">Basescan</a>\n`;
            } else {
              const pnl = t.netUsd || 0;
              tradeLines +=
                `\n🔴 <b>#${t.tradeNum||"?"} SELL ${t.symbol}</b> — ${date} ${time}\n` +
                `   Price:    $${(t.price||0).toFixed(8)}\n` +
                `   Received: ${(t.receivedEth||0).toFixed(6)} ETH (~$${(t.recUsd||0).toFixed(2)})\n` +
                `   Net P&L:  ${pnl>=0?"📈 +":"📉 "}$${pnl.toFixed(2)}\n` +
                `   Piggy skim: ${(t.skimEth||0).toFixed(6)} ETH\n` +
                `   Signals:  ${t.indDetail||"—"}\n` +
                `   🔗 <a href="${t.basescan}">Basescan</a>\n`;
            }
          }

          await tg(
            `📖 <b>GUARDIAN PERMANENT LEDGER</b>\n` +
            `🕐 ${new Date().toLocaleString()}\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +

            `<b>ALL-TIME STATS</b>\n` +
            `   Total trades:  ${s.totalTrades||0}\n` +
            `   Sells:         ${s.sells||0}\n` +
            `   Wins:          ${s.wins||0} (${s.winRate||"n/a"})\n` +
            `   Total earned:  $${s.totalNetUsd||"0.00"}\n` +
            `   Piggy skimmed: ${s.totalSkimEth||"0.000000"} ETH\n` +
            `   Wallet: <a href="https://basescan.org/address/${WALLET_ADDRESS}">Basescan</a>\n\n` +

            `<b>${full?"LAST 20":"LAST 5"} TRADES</b>` +
            tradeLines +
            `\n${full?"" : "Type /ledger full for last 20 trades"}`
          );
        }

      } else if (text.startsWith("/watchlist")) {
        const parts  = text.split(" ");
        const symArg = parts[1]?.toUpperCase();
        const STARS  = (n) => "⭐".repeat(n) + "☆".repeat(5-n);
        const TIER   = (sc) => !sc ? "THESIS" : sc.total >= 40 ? "ALPHA 🔥" : sc.total >= 30 ? "SOLID ✅" : sc.total >= 20 ? "SCOUT 👀" : "WATCH 🔭";
        const TIER_ICON = (sc) => !sc ? "💡" : sc.total >= 40 ? "🔥" : sc.total >= 30 ? "✅" : sc.total >= 20 ? "👀" : "🔭";

        if (symArg) {
          // Check watchlist first, then active portfolio
          const w = WATCHLIST.find(x => x.symbol === symArg);
          const t = tokens.find(x => x.symbol === symArg);
          if (w) {
            const wp  = watchPrices[w.symbol];
            const sc  = w.score;
            let msg = `🔭 <b>WATCHLIST: ${w.symbol}</b>\n`;
            msg += `${STARS(w.stars)} [${w.status.replace(/_/g," ").toUpperCase()}]\n`;
            msg += `Added: ${w.addedDate || "2026-03-12"}\n\n`;
            if (sc) {
              msg += `🛡️ <b>GUARDIAN SCORE: ${sc.total}/50 [${TIER(sc)}]</b>\n`;
              msg += `   💧 Liquidity     ${sc.liquidity}/10\n`;
              msg += `   🌊 Wave Quality  ${sc.waveQuality}/10\n`;
              msg += `   🏗️ Fundamentals  ${sc.fundamentals}/10\n`;
              msg += `   🟡 Coinbase Fit  ${sc.coinbaseFit}/10\n`;
              msg += `   👥 Community     ${sc.community}/10\n\n`;
            }
            if (wp?.lastPrice) {
              msg += `💲 Price: $${wp.lastPrice.toFixed(8)} | ${wp.prices?.length||0} readings\n\n`;
            }
            msg += `📝 <b>Why watching:</b>\n${w.reason}\n\n`;
            msg += `🎯 <b>Entry plan:</b>\n${w.entryPlan}\n\n`;
            if (w.greenFlags?.length) msg += `✅ ${w.greenFlags.join(" | ")}\n`;
            if (w.redFlags?.length)   msg += `⚠️ ${w.redFlags.join(" | ")}\n`;
            await tg(msg);
          } else if (t) {
            const sc = t.score;
            const p  = history[t.symbol]?.lastPrice;
            const b  = getCachedBalance(t.symbol);
            let msg = `🛡️ <b>GUARDIAN SCORE: ${t.symbol}</b>\n\n`;
            if (sc) {
              msg += `<b>${sc.total}/50 [${TIER(sc)}]</b>\n`;
              msg += `   💧 Liquidity     ${sc.liquidity}/10\n`;
              msg += `   🌊 Wave Quality  ${sc.waveQuality}/10\n`;
              msg += `   🏗️ Fundamentals  ${sc.fundamentals}/10\n`;
              msg += `   🟡 Coinbase Fit  ${sc.coinbaseFit}/10\n`;
              msg += `   👥 Community     ${sc.community}/10\n\n`;
            }
            if (p) msg += `💲 $${p.toFixed(8)} | 🪙 ${Math.floor(b)} ($${(b*p).toFixed(2)})\n\n`;
            if (t.notes) msg += `📝 ${t.notes}`;
            await tg(msg);
          } else {
            await tg(`❓ ${symArg} not found. Try /watchlist for the full board.`);
          }

        } else {
          // Full score board — portfolio + pipeline
          let msg = `🛡️ <b>GUARDIAN SCORE BOARD</b>\n🕐 ${new Date().toLocaleTimeString()}\n`;
          msg += `Scores: 40-50 ALPHA🔥 | 30-39 SOLID✅ | 20-29 SCOUT👀\n\n`;

          msg += `<b>── ACTIVE PORTFOLIO ──</b>\n`;
          const sorted = [...tokens].filter(t => t.score).sort((a,b) => b.score.total - a.score.total);
          for (const t of sorted) {
            const b = getCachedBalance(t.symbol);
            const holding = b >= 1 ? " 🏇" : "";
            msg += `${TIER_ICON(t.score)} <b>${t.symbol}</b> ${t.score.total}/50${holding}\n`;
          }

          msg += `\n<b>── WATCHLIST PIPELINE ──</b>\n`;
          const wSorted = [...WATCHLIST].filter(w => w.score).sort((a,b) => b.score.total - a.score.total);
          for (const w of wSorted) {
            const stars = "⭐".repeat(w.stars);
            msg += `${TIER_ICON(w.score)} <b>${w.symbol}</b> ${w.score.total}/50 ${stars}\n`;
          }
          msg += `\n💡 /watchlist SYMBOL — full breakdown + entry plan`;
          await tg(msg);
        }

      } else if (text.startsWith("/history")) {
        // /history        — all tokens, 7/30/90 day summary
        // /history BRETT  — single token detailed
        // /history BRETT 30 — specific days
        const parts   = text.split(" ");
        const symArg  = parts[1]?.toUpperCase();
        const daysArg = parseInt(parts[2]) || null;
        const targets = symArg ? tokens.filter(t => t.symbol === symArg) : tokens;

        if (targets.length === 0) {
          await tg(`❓ Unknown token: ${esc(symArg)}\nPortfolio: BRETT DEGEN AERO VIRTUAL AIXBT TOSHI SEAM XCN KEYCAT DOGINME WELL SKI`);
        } else if (symArg) {
          // Detailed single token report
          const t = targets[0];
          const c = history[t.symbol]?.candles;
          const currentPrice = history[t.symbol]?.lastPrice || 0;
          const ws = waveState[t.symbol] || { peaks: [], troughs: [] };
          const ind = getIndicatorScore(t.symbol);
          const arm = getArmStatus(t.symbol, await estimateGasCostEth(), (cachedBal?.tradeableWithWeth||0));

          if (!c) {
            await tg(`⏳ <b>${t.symbol}</b> — no historical data yet\nBot is building wave data from live prices.\nCheck back in a few hours.`);
          } else {
            const fmt = (p) => p > 1 ? `$${p.toFixed(4)}` : `$${p.toFixed(8)}`;
            const pct = (a,b) => b > 0 ? ((a-b)/b*100).toFixed(1) : "?";
            const chg = (v) => (v >= 0 ? "📈 +" : "📉 ") + v.toFixed(1) + "%";
            const today = c.daily?.today;
            const yest  = c.daily?.yesterday;
            const wks   = c.weekly?.last4 || [];
            const mos   = c.monthly?.last3 || [];
            const weekLines  = wks.length ? wks.map((w,i) => `   Week -${wks.length-i}: H:${fmt(w.high)} L:${fmt(w.low)} ${chg(w.change)}`).join("\n") : "   (building...)";
            const monthLines = mos.length ? mos.map((m,i) => `   Month -${mos.length-i}: H:${fmt(m.high)} L:${fmt(m.low)} ${chg(m.change)}`).join("\n") : "   (building...)";

            await tg(
              `📊 <b>${t.symbol} — FULL HISTORY</b>\n` +
              `🕐 ${new Date(c.updatedAt||Date.now()).toLocaleString()}\n` +
              `━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +

              `<b>📍 NOW: ${fmt(currentPrice)}</b>\n` +
              `   vs 90d high (${fmt(c.days90.high)}): ${pct(currentPrice,c.days90.high)}%\n` +
              `   vs 90d low  (${fmt(c.days90.low)}):  +${pct(currentPrice,c.days90.low)}%\n` +
              `   vs 7d high  (${fmt(c.days7.high)}): ${pct(currentPrice,c.days7.high)}%\n` +
              `   vs 7d low   (${fmt(c.days7.low)}):  +${pct(currentPrice,c.days7.low)}%\n\n` +

              (today ? `<b>📅 TODAY  O:${fmt(today.open)} H:${fmt(today.high)} L:${fmt(today.low)} C:${fmt(today.close)} ${chg(today.change)}</b>\n` +
              (yest ? `   Yesterday H:${fmt(yest.high)} L:${fmt(yest.low)} ${chg(yest.change)}\n` : "") + "\n" : "") +

              `<b>📅 7-DAY</b>  H:${fmt(c.days7.high)} L:${fmt(c.days7.low)}  Range:${(((c.days7.high-c.days7.low)/c.days7.low)*100).toFixed(1)}%  ${chg((c.days7.end-c.days7.start)/c.days7.start*100)}\n\n` +

              `<b>📆 WEEKLY (last 4 weeks)</b>\n` + weekLines + "\n\n" +

              `<b>📅 30-DAY</b>  H:${fmt(c.days30.high)} L:${fmt(c.days30.low)}  Range:${(((c.days30.high-c.days30.low)/c.days30.low)*100).toFixed(1)}%  ${chg((c.days30.end-c.days30.start)/c.days30.start*100)}\n\n` +

              `<b>🗓 MONTHLY (last 3 months)</b>\n` + monthLines + "\n\n" +

              `<b>📅 90-DAY</b>  H:${fmt(c.days90.high)} L:${fmt(c.days90.low)}  Range:${(((c.days90.high-c.days90.low)/c.days90.low)*100).toFixed(1)}%  ${chg((c.days90.end-c.days90.start)/c.days90.start*100)}\n\n` +

              `<b>🌊 WAVES</b>\n` +
              `   Peaks:   ${ws.peaks.length ? ws.peaks.map(p=>"$"+p.toFixed(6)).join(" → ") : "building"}\n` +
              `   Troughs: ${ws.troughs.length ? ws.troughs.map(t=>"$"+t.toFixed(6)).join(" → ") : "building"}\n\n` +

              `<b>💓 INDICATORS</b>  ${ind.detail || "building..."}\n\n` +

              `<b>🎯 ARM</b>  ${arm.armed ? "✅ ARMED ["+arm.priority+"] "+((arm.net||0)*100).toFixed(2)+"% net margin" : "⏳ "+esc(arm.reason)}`
            );
          }
        } else {
          // Quick summary table — all tokens
          let msg = `📊 <b>HISTORY SNAPSHOT — ALL TOKENS</b>\n🕐 ${new Date().toLocaleString()}\n━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
          msg += `<b>Token | Now | 7d chg | 30d chg | 90d range</b>\n\n`;
          for (const tok of tokens) {
            const c = history[tok.symbol]?.candles;
            const p = history[tok.symbol]?.lastPrice || 0;
            if (!c) {
              msg += `⏳ <b>${tok.symbol}</b> — learning (no history yet)\n`;
              continue;
            }
            const ch7  = ((c.days7.end  - c.days7.start)  / c.days7.start  * 100).toFixed(0);
            const ch30 = ((c.days30.end - c.days30.start) / c.days30.start * 100).toFixed(0);
            const range90pct = (((c.days90.high - c.days90.low) / c.days90.low) * 100).toFixed(0);
            const arm  = getArmStatus(tok.symbol, 0, 1);
            const status = arm.armed ? "✅" : "⏳";
            msg += `${status} <b>${tok.symbol}</b>\n` +
              `   $${p.toFixed(6)} | 7d: ${ch7>=0?"+":""}${ch7}% | 30d: ${ch30>=0?"+":""}${ch30}% | 90d range: ${range90pct}%\n` +
              `   90d H:$${c.days90.high.toFixed(6)}  L:$${c.days90.low.toFixed(6)}\n\n`;
          }
          msg += `\nTip: /history SYMBOL for full deep-dive on any token`;
          await tg(msg);
        }

      // ── 💸 WITHDRAW: send ETH to hardcoded destination (wife's Coinbase Base address) ──
      // Security: destination is hardcoded — cannot be redirected by anyone
      } else if (text && text.startsWith("/withdrawusd")) {
        const parts     = text.trim().split(/\s+/);
        const usdAmount = parseFloat(parts[1]);
        if (!usdAmount || isNaN(usdAmount) || usdAmount <= 0) {
          await tg(`❌ <b>Usage:</b> /withdrawusd [amount]\nExample: <code>/withdrawusd 1</code> sends $1 of ETH\nDestination: always 0xd539...544f (locked)`);
        } else {
          const ethPrice  = await getLiveEthPrice();
          const ethAmount = usdAmount / ethPrice;
          const weiAmount = BigInt(Math.floor(ethAmount * 1e18));
          const ethBal    = await getEthBalance();
          const gasBuffer = GAS_RESERVE + 0.0003;
          if (ethAmount > ethBal - gasBuffer) {
            await tg(`❌ <b>Insufficient ETH</b>\nRequested: ${ethAmount.toFixed(6)} ETH ($${usdAmount})\nAvailable: ${(ethBal - gasBuffer).toFixed(6)} ETH\nTip: /unwrapall first if you have WETH`);
          } else {
            await tg(`⏳ <b>WITHDRAWAL INITIATED</b>\n💰 $${usdAmount} → ${ethAmount.toFixed(6)} ETH @ $${ethPrice.toFixed(2)}\n📬 To: 0xd539E9d118fFdb7a56c759Be81983CbD38fF544f\nSending...`);
            try {
              const tx = await cdpClient.evm.sendTransaction({
                address: WALLET_ADDRESS,
                network: "base",
                transaction: { to: "0xd539E9d118fFdb7a56c759Be81983CbD38fF544f", value: weiAmount }
              });
              await tg(`✅ <b>SENT!</b>\n💰 $${usdAmount} (${ethAmount.toFixed(6)} ETH)\n📬 0xd539...544f\n🔗 <a href="https://basescan.org/tx/${tx.transactionHash}">View on BaseScan</a>`);
            } catch (e) { await tg(`❌ <b>WITHDRAWAL FAILED</b>\n${e.message}`); }
          }
        }

      } else if (text === "/withdrawall") {
        const ethBal    = await getEthBalance();
        const ethPrice  = await getLiveEthPrice();
        const gasBuffer = GAS_RESERVE + 0.0005;
        const sendAmt   = Math.max(ethBal - gasBuffer, 0);
        if (sendAmt < 0.0001) {
          await tg(`❌ <b>Nothing to withdraw</b>\nETH balance: ${ethBal.toFixed(6)}\nTip: /unwrapall first if you have WETH`);
        } else {
          const weiAmount = BigInt(Math.floor(sendAmt * 1e18));
          await tg(`⏳ <b>WITHDRAW ALL INITIATED</b>\n💰 ${sendAmt.toFixed(6)} ETH (~$${(sendAmt*ethPrice).toFixed(2)})\n📬 To: 0xd539E9d118fFdb7a56c759Be81983CbD38fF544f\nSending...`);
          try {
            const tx = await cdpClient.evm.sendTransaction({
              address: WALLET_ADDRESS,
              network: "base",
              transaction: { to: "0xd539E9d118fFdb7a56c759Be81983CbD38fF544f", value: weiAmount }
            });
            await tg(`✅ <b>ALL SENT!</b>\n💰 ${sendAmt.toFixed(6)} ETH (~$${(sendAmt*ethPrice).toFixed(2)})\n📬 0xd539...544f\n🔗 <a href="https://basescan.org/tx/${tx.transactionHash}">View on BaseScan</a>`);
          } catch (e) { await tg(`❌ <b>WITHDRAW ALL FAILED</b>\n${e.message}`); }
        }

      // ── 🔄 UNWRAP: WETH → ETH manually ──────────────────────────────────────
      } else if (text && text.startsWith("/unwrap ")) {
        const parts      = text.trim().split(/\s+/);
        const wethAmount = parseFloat(parts[1]);
        const wethBal    = await getWethBalance();
        const ethPrice   = await getLiveEthPrice();
        if (!wethAmount || isNaN(wethAmount) || wethAmount <= 0) {
          await tg(`❌ <b>Usage:</b> /unwrap [amount]\nExample: <code>/unwrap 0.01</code>\nCurrent WETH: ${wethBal.toFixed(6)}`);
        } else if (wethAmount > wethBal) {
          await tg(`❌ <b>Not enough WETH</b>\nRequested: ${wethAmount.toFixed(6)}\nAvailable: ${wethBal.toFixed(6)} (~$${(wethBal*ethPrice).toFixed(2)})`);
        } else {
          await tg(`⏳ <b>UNWRAPPING</b> ${wethAmount.toFixed(6)} WETH → ETH...`);
          try {
            await unwrapEth(cdpClient, wethAmount);
            const newEth = await getEthBalance();
            await tg(`✅ <b>UNWRAPPED</b>\n🔄 ${wethAmount.toFixed(6)} WETH → ETH\n💰 New ETH balance: ${newEth.toFixed(6)} (~$${(newEth*ethPrice).toFixed(2)})\nTip: use /withdrawusd or /withdrawall to send to Coinbase`);
          } catch (e) { await tg(`❌ <b>UNWRAP FAILED</b>\n${e.message}`); }
        }

      } else if (text === "/unwrapall") {
        const wethBal  = await getWethBalance();
        const ethPrice = await getLiveEthPrice();
        if (wethBal < 0.0001) {
          await tg(`❌ <b>No WETH to unwrap</b>\nWETH balance: ${wethBal.toFixed(6)}`);
        } else {
          await tg(`⏳ <b>UNWRAPPING ALL</b> ${wethBal.toFixed(6)} WETH → ETH (~$${(wethBal*ethPrice).toFixed(2)})...`);
          try {
            await unwrapEth(cdpClient, wethBal - 0.00001); // tiny buffer avoids rounding error
            const newEth = await getEthBalance();
            await tg(`✅ <b>ALL WETH UNWRAPPED</b>\n🔄 ${wethBal.toFixed(6)} WETH → ETH\n💰 New ETH balance: ${newEth.toFixed(6)} (~$${(newEth*ethPrice).toFixed(2)})\nTip: use /withdrawusd or /withdrawall to send to Coinbase`);
          } catch (e) { await tg(`❌ <b>UNWRAP ALL FAILED</b>\n${e.message}`); }
        }

      // ── 📡 BLOCKCHAIN TELEGRAM PROTOCOL COMMANDS ─────────────────────────────
      } else if (text && text.startsWith("/transmit ")) {
        // /transmit My message here — queues message to ride next trades on-chain
        const message = raw.slice("/transmit ".length).trim();
        if (!message) {
          await tg(`❌ Usage: /transmit Your message here\nMax ~900 chars per chunk — longer messages auto-split across trades`);
        } else {
          const name   = `MSG-${Date.now().toString(36).toUpperCase()}`;
          const chunks = Math.ceil(message.length / 900);
          btpEnqueue(name, message);
          // Clear the auto-fill default so this goes first
          await tg(
            `📡 <b>TRANSMISSION QUEUED</b>\n` +
            `📨 ID: <code>${name}</code>\n` +
            `📝 Length: ${message.length} chars → ${chunks} chunk(s)\n` +
            `⏳ Riding next ${chunks} trade(s) onto Base blockchain\n` +
            `Check /status to see pending count\n\n` +
            `Preview: <code>${message.slice(0, 100)}${message.length > 100 ? "..." : ""}</code>`
          );
        }

      // ── 🔐 VAULT COMMANDS ──────────────────────────────────────────────────
      } else if (text === "/vaultstatus") {
        await tg(getVaultStatusMessage());

      } else if (text && text.startsWith("/vaulttest ")) {
        const keyName = raw.split(" ")[1]?.toUpperCase();
        if (!keyName) { await tg("❌ Usage: /vaulttest KEYNAME\nExample: /vaulttest TELEGRAM_BOT_TOKEN"); }
        else await tg(getVaultTestMessage(keyName));

      } else if (text && text.startsWith("/vaultload ")) {
        const keyName = raw.split(" ")[1]?.toUpperCase();
        if (!keyName) { await tg("❌ Usage: /vaultload KEYNAME"); }
        else {
          await tg("⏳ Fetching <b>" + keyName + "</b> from Base blockchain...");
          try {
            const r = await vaultForceReload(keyName);
            await tg(
              "✅ <b>" + r.keyName + "</b> reloaded from chain\n" +
              "🔑 Preview: <code>" + r.preview + "</code>\n" +
              "📍 <a href=\"https://basescan.org/tx/" + r.txHash + "\">View inscription ↗</a>"
            );
          } catch (e) { await tg("❌ Vault reload failed: " + e.message); }
        }

      } else if (text && text.startsWith("/newvault ")) {
        // Step 1 of 2 — start session, prompt for key value
        const keyName = raw.split(" ")[1]?.toUpperCase();
        const validKeys = [
          "TEST_KEY",
          "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID",
          "CDP_API_KEY_ID", "CDP_API_KEY_SECRET", "CDP_WALLET_SECRET",
          "GITHUB_TOKEN", "GITHUB_REPO", "GITHUB_BRANCH", "STATE_BRANCH",
        ];
        if (!keyName || !validKeys.includes(keyName)) {
          await tg(
            "❌ Usage: /newvault KEYNAME\n\n" +
            "<b>Available keys (suggested migration order):</b>\n\n" +
            "🧪 <b>Test first:</b>\n" +
            "   TEST_KEY\n\n" +
            "💬 <b>Telegram:</b>\n" +
            "   TELEGRAM_CHAT_ID\n" +
            "   TELEGRAM_BOT_TOKEN ← do last\n\n" +
            "🔑 <b>CDP / Coinbase:</b>\n" +
            "   CDP_API_KEY_ID\n" +
            "   CDP_API_KEY_SECRET\n" +
            "   CDP_WALLET_SECRET\n\n" +
            "📦 <b>GitHub:</b>\n" +
            "   GITHUB_TOKEN\n" +
            "   GITHUB_REPO\n" +
            "   GITHUB_BRANCH\n" +
            "   STATE_BRANCH\n\n" +
            "Example: <code>/newvault TEST_KEY</code>"
          );
        } else if (!process.env.DECRYPT_PASSWORD) {
          await tg(
            "❌ <b>DECRYPT_PASSWORD not set in Railway</b>\n\n" +
            "Add it first:\n" +
            "Railway → Variables → DECRYPT_PASSWORD = yourStrongPassword\n\n" +
            "This password encrypts all your vault keys. Save it somewhere safe."
          );
        } else {
          const chatId = upd.message?.chat?.id?.toString();
          startVaultSession(chatId, keyName);
          await tg(
            "🔐 <b>VAULT — Ready to encrypt " + keyName + "</b>\n\n" +
            "Reply with the key value in the next <b>60 seconds</b>.\n\n" +
            "⚠️ Send ONLY the key value — nothing else.\n" +
            "The bot will delete your message immediately after reading.\n\n" +
            "Type /cancel to abort."
          );
        }

      } else if (text === "/cancel") {
        const chatId = upd.message?.chat?.id?.toString();
        if (getVaultSession(chatId)) {
          clearVaultSession(chatId);
          await tg("✅ Vault session cancelled.");
        }

      } else if (text === "/btpstatus") {
        // Show full BTP queue state
        const pending = btpPendingCount();
        if (btpQueue.length === 0 || btpQueue.every(m => m.name === "VITA")) {
          await tg(
            `📡 <b>BLOCKCHAIN TELEGRAM — STATUS</b>\n\n` +
            `✅ No custom messages queued\n` +
            `🔄 Auto-fill active: VITA inscription riding every trade\n\n` +
            `<i>"${INSCRIPTION_MESSAGE.slice(0, 100)}..."</i>\n\n` +
            `Send a message: /transmit Hello world`
          );
        } else {
          let qLines = "";
          for (const m of btpQueue) {
            if (m.name === "VITA") continue;
            const rem = m.totalChunks - m.sent;
            qLines += `📨 <b>${m.name}</b>: ${rem}/${m.totalChunks} chunks remaining\n`;
            qLines += `   Preview: <code>${m.chunks[m.sent]?.slice(0,60) || ""}...</code>\n`;
          }
          await tg(
            `📡 <b>BLOCKCHAIN TELEGRAM — STATUS</b>\n\n` +
            `⏳ <b>${pending} chunk(s) pending</b> — riding next trades\n\n` +
            qLines +
            `\nEach trade carries one chunk. Check /status for trade activity.`
          );
        }

      } else if (text === "/tiers") {
        // Show live tier assignments, scores, and capital allocation
        const ethPrice2 = await getLiveEthPrice();
        const bal2      = await getFullBalance();
        const gc2       = await estimateGasCostEth();
        const ta2       = computeTierAssignments(gc2, bal2.tradeableWithWeth, bal2.tradeableWithWeth * ethPrice2);
        const t1Usd2    = (bal2.tradeableWithWeth * ethPrice2 * TIER1_PCT / TIER1_COUNT).toFixed(2);
        const t2Slots2  = ta2.tier2.length;
        const t2Usd2    = t2Slots2 > 0 ? (bal2.tradeableWithWeth * ethPrice2 * TIER2_PCT / t2Slots2).toFixed(2) : "0";

        let msg = `🏆 <b>TIER LEADERBOARD</b>\n`;
        msg += `💰 Tradeable: $${(bal2.tradeableWithWeth * ethPrice2).toFixed(2)}\n\n`;
        msg += `<b>🥇 TIER 1 — $${t1Usd2}/slot (65% capital, top 3)</b>\n`;
        for (const sym of ta2.tier1) {
          const sc = ta2.scored.find(s => s.symbol === sym);
          const t  = tokens.find(t => t.symbol === sym);
          const arm = getArmStatus(sym, gc2, bal2.tradeableWithWeth);
          const pos = t?.entryPrice ? `🏇 IN` : `⏳ READY`;
          msg += `   ${pos} <b>${sym}</b> — score ${sc?.score || 0}/100 | ${arm.armed ? (arm.net*100).toFixed(1)+"% margin" : "building"}\n`;
        }
        msg += `\n<b>🥈 TIER 2 — $${t2Usd2}/slot (35% capital, ${t2Slots2} slots)</b>\n`;
        if (ta2.tier2.length === 0) {
          msg += `   ⚠️ No slots — need $${TIER2_MIN_SLOT_USD} per slot min (add more capital)\n`;
        }
        for (const sym of ta2.tier2) {
          const sc = ta2.scored.find(s => s.symbol === sym);
          const t  = tokens.find(t => t.symbol === sym);
          const arm = getArmStatus(sym, gc2, bal2.tradeableWithWeth);
          const pos = t?.entryPrice ? `🏇 IN` : `⏳ READY`;
          msg += `   ${pos} <b>${sym}</b> — score ${sc?.score || 0}/100 | ${arm.armed ? (arm.net*100).toFixed(1)+"% margin" : "building"}\n`;
        }
        msg += `\n<b>🌙 MOONSHOT HOLDS (outside tiers)</b>\n`;
        const moonTokens = tokens.filter(t => t.entryPrice && !ta2.tier1.includes(t.symbol) && !ta2.tier2.includes(t.symbol));
        if (moonTokens.length === 0) msg += `   None\n`;
        for (const t of moonTokens) {
          const price2 = history[t.symbol]?.lastPrice || 0;
          const bal3   = getCachedBalance(t.symbol);
          const usd    = (bal3 * price2).toFixed(2);
          msg += `   🌙 ${t.symbol}: $${usd} held as lottery bag\n`;
        }
        msg += `\n<i>Tier 2 opens new slot every $${TIER2_MIN_SLOT_USD} added to capital</i>`;
        await tg(msg);

      } else if (text === "/help") {
        await tg(
          `🏄 <b>GUARDIAN PROTOCOL — COMMAND REFERENCE</b>\n\n` +
          `<b>📊 Status & Info:</b>\n` +
          `/status — full portfolio status\n` +
          `/bank — complete money statement\n` +
          `/eth — ETH + WETH balances\n` +
          `/piggy — piggy bank balance\n` +
          `/gas — current gas price\n` +
          `/indicators — RSI/MACD/BB for all tokens\n` +
          `/waves — arm status all tokens\n` +
          `/tiers — 🏆 tier leaderboard + scores\n\n` +
          `<b>🌊 Positions & Trading:</b>\n` +
          `/surf — current riding positions\n` +
          `/race — race display all positions\n` +
          `/positions — open positions detail\n` +
          `/profit — P&L summary\n` +
          `/leaderboard — wave scoreboard\n` +
          `/fib SYMBOL — fibonacci levels\n` +
          `/history SYMBOL — 7/30/90d chart\n` +
          `/wake (or /gm) — morning briefing\n\n` +
          `<b>📱 Manual Trade Commands:</b>\n` +
          `/buy SYMBOL — manual buy\n` +
          `/sell SYMBOL — sell + cascade fires\n` +
          `/sellhalf SYMBOL — sell 50% + cascade\n` +
          `/exit SYMBOL — sell 100% to ETH, NO cascade\n` +
          `/exithalf SYMBOL — sell 50% to ETH, NO cascade\n` +
          `/exitpct SYMBOL 75 — sell any % to ETH, NO cascade\n\n` +
          `<b>💸 Withdraw:</b>\n` +
          `/withdrawusd [amt] — send $USD of ETH to Coinbase\n` +
          `/withdrawall — send all ETH to Coinbase\n` +
          `/unwrap [amt] — unwrap WETH → ETH\n` +
          `/unwrapall — unwrap all WETH → ETH\n\n` +
          `<b>📡 Blockchain Telegram:</b>\n` +
          `/transmit [msg] — send message on-chain via trades\n` +
          `/btpstatus — show pending transmissions\n\n` +
          `<b>🔐 Vault (on-chain key storage):</b>\n` +
          `/newvault KEYNAME — encrypt + inscribe a key on Base\n` +
          `/vaultstatus — show all keys and their sources\n` +
          `/vaulttest KEYNAME — verify a key is loaded\n` +
          `/vaultload KEYNAME — force reload from blockchain\n\n` +
          `/ledger — permanent trade record\n` +
          `/ledger full — last 20 trades detailed\n` +
          `/watchlist — tokens watching but not trading\n` +
          `/trades — trade count + recent log\n`
        );
      }
      } catch (cmdErr) {
        // Per-command error — log it with the command that caused it, send notice to Telegram, continue polling
        console.log(`⚠️  Telegram command "${raw}" crashed: ${cmdErr.message}`);
        console.log(cmdErr.stack?.split("\n").slice(0,3).join("\n"));
        try { await tg(`⚠️ <b>Command error</b>: <code>${raw}</code>\n${cmdErr.message}\nGuardian is still running.`); } catch {}
      }
    }
  } catch (e) { console.log(`⚠️  Telegram poll error: ${e.message}`); }
}

// ── CDP CLIENT ────────────────────────────────────────────────────────────────
function createCdpClient() {
  return new CdpClient({
    apiKeyId:     process.env.CDP_API_KEY_ID     || "",
    apiKeySecret: (process.env.CDP_API_KEY_SECRET || "").replace(/\\n/g, "\n"),
    walletSecret: process.env.CDP_WALLET_SECRET,
  });
}

// ── CANDLE FALLBACK SEEDER ────────────────────────────────────────────────────
// After ledger seed, some tokens still lack enough peaks/troughs to arm.
// If we loaded 90d candle data for a token, use the 90d high as a confirmed peak
// and the 90d low as a confirmed trough — real price levels, just daily resolution.
// This prevents tokens like VIRTUAL from losing wave data on every restart.
function bootstrapWavesFromCandles() {
  let seeded = 0;
  for (const token of tokens) {
    const ws  = initWaveState(token.symbol);
    const h   = history[token.symbol];
    if (!h?.candles?.days90) continue; // no candle data loaded

    const days90 = h.candles.days90;
    const high90 = days90.high;
    const low90  = days90.low;
    if (!high90 || !low90 || high90 <= low90) continue;

    // Only fill in what's missing — don't overwrite good ledger data
    const needsPeak   = ws.peaks.length   < MIN_PEAKS_TO_TRADE;
    const needsTrough = ws.troughs.length < MIN_TROUGHS_TO_TRADE;
    if (!needsPeak && !needsTrough) continue;

    let changed = false;
    if (needsPeak) {
      // Use 90d high and 14d high as two distinct peaks if available
      const isDupe = (arr, val) => arr.some(x => Math.abs(x - val) / val < 0.005);
      if (!isDupe(ws.peaks, high90)) { ws.peaks.push(high90); changed = true; }
      if (h.candles.days14?.high && !isDupe(ws.peaks, h.candles.days14.high)) {
        ws.peaks.push(h.candles.days14.high); changed = true;
      }
      ws.peaks = ws.peaks.sort((a, b) => a - b).slice(-WAVE_COUNT);
    }
    if (needsTrough) {
      const isDupe = (arr, val) => arr.some(x => Math.abs(x - val) / val < 0.005);
      if (!isDupe(ws.troughs, low90)) { ws.troughs.push(low90); changed = true; }
      if (h.candles.days14?.low && !isDupe(ws.troughs, h.candles.days14.low)) {
        ws.troughs.push(h.candles.days14.low); changed = true;
      }
      ws.troughs = ws.troughs.sort((a, b) => a - b).slice(-WAVE_COUNT);
    }

    // Re-validate after adding candle data
    const maxP = ws.peaks.length   ? Math.max(...ws.peaks)   : 0;
    const minT = ws.troughs.length ? Math.min(...ws.troughs) : 0;
    if (maxP <= minT) { ws.peaks = []; ws.troughs = []; continue; } // still inverted

    if (changed) {
      const armed = ws.peaks.length >= MIN_PEAKS_TO_TRADE && ws.troughs.length >= MIN_TROUGHS_TO_TRADE;
      console.log(`   ${armed ? "✅" : "🔧"} ${token.symbol}: candle fallback → ${ws.peaks.length}P ${ws.troughs.length}T | range $${minT.toFixed(6)}–$${maxP.toFixed(6)} ${armed ? "ARMED" : ""}`);
      seeded++;
    }
  }
  if (seeded > 0) console.log(`✅ Candle fallback: ${seeded} tokens topped up\n`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🚀 MAIN
// ═══════════════════════════════════════════════════════════════════════════════
async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("⚔️💓  GUARDIAN PROTOCOL — HEARTBEAT EDITION v16.0 — PRECISION FIX");
  console.log("      ETH+WETH unified | Auto gas top-up | Ledger wave seeding");
  console.log("      Live ETH price | Gas spike guard | Drawdown breaker");
  console.log("      v15.7: RPC fix (7 endpoints + quota rotation), 10 new tokens, ETH/WETH manager");
  console.log("      THE MACHINE NEVER STOPS. THE HEARTBEAT NEVER FADES.");
  console.log("═══════════════════════════════════════════════════════════\n");

  // ── 🔐 VAULT: load encrypted keys from Base blockchain before anything else ──
  // If ENCRYPTED_KEY_TXHASH + DECRYPT_PASSWORD are set in Railway, the real
  // TELEGRAM_BOT_TOKEN is fetched from the on-chain inscription and loaded into
  // memory. Railway never stores the actual token — just the password + tx hash.
  try {
    const vault = await loadVaultKeys();
    if (vault.loaded) {
      await tg(
        `🔐 <b>VAULT KEY LOADED FROM BASE BLOCKCHAIN</b>\n` +
        `🔑 Key: <b>${vault.keyName}</b>\n` +
        `📍 Location: <a href="https://basescan.org/tx/${vault.txHash}">View on BaseScan ↗</a>\n` +
        `🧱 Permanent. Immutable. Decrypted at boot.\n` +
        `💌 <i>Eureka! VITA lives ♥ — ᛞᚨᚡᛁᛞ — The truth is the chain.</i>`
      );
    }
  } catch (vaultErr) {
    console.log(`⚠️  Vault loader error: ${vaultErr.message}`);
    // Non-fatal — if Telegram token is missing entirely, the tg() calls below will fail
    // and the bot will log errors but keep running (Railway env fallback)
  }

  await loadFromGitHub();
  await loadHistoricalData(90);   // 🏛️ learn 90 days of history instantly on every boot
  bootstrapWavesFromHistory();    // seed waves from OHLC candle data
  await bootstrapWavesFromLedger(); // seed waves from real executed trades (highest quality)
  bootstrapWavesFromCandles();      // fill any remaining gaps from 90d candle highs/lows
  cdpClient = createCdpClient();
  orch.cdp = cdpClient; // wire the live CDP client in

  // ── BITStorage: register Railway config as first strand ───────────────────
  try {
    const { strandID, kMaster, totalChunks } = await orch.register(
      "railway-config",
      JSON.stringify({
        CDP_API_KEY_ID:     process.env.CDP_API_KEY_ID,
        CDP_API_KEY_SECRET: process.env.CDP_API_KEY_SECRET,
        CDP_WALLET_SECRET:  process.env.CDP_WALLET_SECRET,
        TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
        TELEGRAM_CHAT_ID:   process.env.TELEGRAM_CHAT_ID,
        GITHUB_TOKEN:       process.env.GITHUB_TOKEN,
        GITHUB_REPO:        process.env.GITHUB_REPO,
        version:            "15.7",
      }),
      LANE.STANDBY,
      { noiseRatio: 2 }
    );
    orchReady = true;
    console.log(`📦 BITStorage ready | StrandID: 0x${strandID} | ${totalChunks} chunks queued`);
    console.log(`🔑 kMaster: ${kMaster}  ← SAVE THIS`);

    // ── Register the VITA inscription as a permanent strand ────────────────
    // This is the right way to use the LIBD injection system — not a separate
    // tx, but a named strand that gets fragmented and injected into every real
    // swap tx calldata as it goes out. The full message assembles across trades.
    // Anyone who reconstructs the strand from Base chain data sees it complete.
    try {
      const vitaStrand = await orch.register(
        "VITA-inscription",
        INSCRIPTION_MESSAGE,
        LANE.OWNER,
        { noiseRatio: 1, plaintext: true }
      );
      console.log(`💌 VITA strand registered | StrandID: 0x${vitaStrand.strandID} | ${vitaStrand.totalChunks} fragments queued`);
      console.log(`   "${INSCRIPTION_MESSAGE}"`);
    } catch (ve) {
      console.log(`⚠️  VITA strand registration failed (non-critical): ${ve.message}`);
    }

    await tg(
      `📦 <b>BITStorage active</b>\n` +
      `StrandID: <code>0x${strandID}</code>\n` +
      `Chunks queued: ${totalChunks * 3} (real + noise)\n` +
      `kMaster: <code>${kMaster.slice(0,16)}...</code>\n` +
      `Each trade carries one fragment silently.\n` +
      `💌 VITA inscription strand active — riding every swap tx on Base`
    );
    orch.on("strand-complete", async (e) => {
      await tg(`✅ <b>BITStorage strand complete</b>\n"${e.name}" sealed on Base\n+${e.bitsEarned} BITS earned`);
    });
    orch.on("bits-earned", (e) => {
      console.log(`💰 BITStorage: +${e.amount} BITS earned`);
    });
  } catch (e) {
    console.log(`⚠️  BITStorage init failed (bot continues): ${e.message}`);
  }

  // Warm up live ETH price immediately
  const ethUsdInit = await getLiveEthPrice();
  const balInit    = await getFullBalance();
  console.log(`✅ CDP ready | ETH: ${balInit.eth.toFixed(6)} | WETH: ${balInit.weth.toFixed(6)} | ETH=$${ethUsdInit.toFixed(2)}\n`);
  if (STATE_BRANCH === GITHUB_BRANCH) {
    console.log(`⚠️  STATE_BRANCH == GITHUB_BRANCH (${GITHUB_BRANCH}) — state saves will trigger Railway redeploys!`);
    console.log(`   Set Railway env var STATE_BRANCH=bot-state and create that branch to fix this.`);
  } else {
    console.log(`✅ State saves → branch: ${STATE_BRANCH} (Railway watches: ${GITHUB_BRANCH}) — redeploys prevented`);
  }

  // Startup arm status
  const gasCostInit = await estimateGasCostEth();
  console.log("📊 ARM STATUS AT STARTUP:");
  for (const t of tokens) {
    const arm  = getArmStatus(t.symbol, gasCostInit, balInit.tradeableWithWeth);
    const ind  = getIndicatorScore(t.symbol);
    const maxP = getMaxPeak(t.symbol), minT = getMinTrough(t.symbol);
    console.log(arm.armed
      ? `   ✅ ${t.symbol}: ARMED ${(arm.net*100).toFixed(2)}% [${arm.priority}] | buy@$${minT?.toFixed(8)} sell@$${maxP?.toFixed(8)}`
      : `   ⏳ ${t.symbol}: ${arm.reason}`
    );
  }
  console.log();

  // ── Batch 2 pool health check — runs once at boot, surfaces silent failures ─
  // Tokens with bad/wrong addresses return no price and just silently stay at 0P/0T.
  // This log makes the failure visible so you can verify addresses on basescan.org.
  console.log("🔍 POOL HEALTH CHECK (Batch 2 tokens):");
  const BATCH2_SYMBOLS = ["ZORA","BNKR","TYBG","MIGGLES","BENJI","ROOST","TALENT"];
  const batch2Tokens   = DEFAULT_TOKENS.filter(t => BATCH2_SYMBOLS.includes(t.symbol));
  const batch2Problems = [];
  for (const t of batch2Tokens) {
    try {
      const price = await getTokenPrice(t.address);
      const ws    = initWaveState(t.symbol);
      if (price > 0) {
        console.log(`   ✅ ${t.symbol}: $${price.toFixed(8)} | ${ws.peaks.length}P ${ws.troughs.length}T | ${t.address}`);
      } else {
        console.log(`   ❌ ${t.symbol}: NO PRICE — pool wrong or dry — verify on basescan.org: ${t.address}`);
        batch2Problems.push(t.symbol);
      }
    } catch (e) {
      console.log(`   ❌ ${t.symbol}: price error — ${e.message} — address: ${t.address}`);
      batch2Problems.push(t.symbol);
    }
    await sleep(400);
  }
  if (batch2Problems.length) {
    console.log(`\n   ⚠️  ${batch2Problems.length} Batch 2 token(s) have no price: ${batch2Problems.join(", ")}`);
    console.log(`   ⚠️  Check each on https://basescan.org — wrong address = silent skip`);
    // Also ping Telegram so you see it in the startup message
    await tg(`⚠️ <b>BATCH 2 POOL ISSUE</b>\nNo price for: ${batch2Problems.join(", ")}\nVerify addresses on basescan.org\n${batch2Problems.map(s => { const tk = batch2Tokens.find(t => t.symbol===s); return tk ? `${s}: <code>${tk.address}</code>` : s; }).join("\n")}`);
  } else {
    console.log(`   ✅ All Batch 2 tokens returning live prices`);
  }
  console.log();

  await tg(
    `⚔️💓 <b>GUARDIAN v15.7 — HEARTBEAT EDITION ONLINE</b>\n\n` +
    `👛 <code>${WALLET_ADDRESS}</code>\n` +
    `💰 ETH: ${balInit.eth.toFixed(6)} | WETH: ${balInit.weth.toFixed(6)}\n` +
    `💲 Live ETH: $${ethUsdInit.toFixed(2)}\n` +
    `♻️ Tradeable (ETH+WETH): ${balInit.tradeableWithWeth.toFixed(6)}\n\n` +
    `🌊 Buy at confirmed MIN trough\n` +
    `🎯 Sell at confirmed MAX peak\n` +
    `💓 RSI + MACD + Bollinger confirm waves\n` +
    `📊 Net margin gate: 2.5%+ (includes price impact)\n` +
    `⛽ Gas spike guard: ${MAX_GAS_GWEI} gwei max\n` +
    `🛑 Drawdown breaker: -${(DRAWDOWN_HALT_PCT*100).toFixed(0)}% halts buys\n` +
    `🔄 ETH+WETH unified (auto-wrap when needed)\n\n` +
    `/help for commands | /waves for arm status | /gas for gas check`
  );

  cachedBal    = balInit;
  cachedEthUsd = ethUsdInit;

  // Telegram poller — independent 3s loop, never dies
  // Lock prevents concurrent runs — if one poll takes >3s the next waits
  let telegramPolling = false;
  (async () => {
    while (true) {
      if (!telegramPolling) {
        telegramPolling = true;
        try { await checkTelegramCommands(cdpClient, cachedBal, cachedEthUsd); }
        catch (e) { console.log(`⚠️  Telegram poller error: ${e.message}`); }
        finally { telegramPolling = false; }
      }
      await sleep(3000);
    }
  })();

  // Main trading loop
  while (true) {
    try {
      const ethUsd = await getLiveEthPrice();
      const bal    = await getFullBalance();
      cachedBal    = bal;
      cachedEthUsd = ethUsd;
      const time   = new Date().toLocaleTimeString();
      const gwei   = await getCurrentGasGwei();

      // Portfolio value tracking for drawdown circuit breaker
      let totalPortfolioUsd = bal.total * ethUsd;
      for (const t of tokens) {
        if (t.entryPrice) {
          const p = history[t.symbol]?.lastPrice;
          const b = getCachedBalance(t.symbol);
          totalPortfolioUsd += b * (p || 0);
        }
      }
      updatePortfolioPeak(totalPortfolioUsd);
      checkDrawdown(totalPortfolioUsd);

      console.log(`\n${"═".repeat(60)}`);
      console.log(`${time} | ETH:${bal.eth.toFixed(6)} WETH:${bal.weth.toFixed(6)} | $${ethUsd.toFixed(2)} | ⛽${gwei.toFixed(1)}gwei`);
      console.log(`Tradeable:${bal.tradeableWithWeth.toFixed(6)} Piggy:${piggyBank.toFixed(6)} (LOCKED) Trades:${tradeCount}`);
      if (drawdownHaltActive) console.log(`🛑 DRAWDOWN HALT ACTIVE`);
      if (gwei > MAX_GAS_GWEI) console.log(`⛽ GAS SPIKE — trades paused this cycle`);
      console.log();

      // ── AUTO GAS TOP-UP: unwrap WETH → ETH when native ETH runs low ──────────
      // Gas on Base ALWAYS requires native ETH. WETH cannot pay gas.
      // If native ETH drops below threshold AND we have WETH, unwrap just enough
      // to restore a safe gas buffer — keeps the bot running indefinitely.
      if (bal.eth < GAS_TOPUP_THRESHOLD && bal.weth > GAS_TOPUP_TARGET) {
        const unwrapAmt = Math.min(GAS_TOPUP_TARGET - bal.eth, bal.weth - GAS_RESERVE);
        if (unwrapAmt > 0.0002) {
          console.log(`⛽ Native ETH low (${bal.eth.toFixed(6)}) — auto-unwrapping ${unwrapAmt.toFixed(6)} WETH for gas`);
          await tg(`⛽ <b>AUTO GAS TOP-UP</b>\nNative ETH: ${bal.eth.toFixed(6)} → unwrapping ${unwrapAmt.toFixed(6)} WETH\nKeeps bot running without manual intervention`);
          await unwrapEth(cdpClient, unwrapAmt);
          // Refresh balance after unwrap
          const freshBal = await getFullBalance();
          cachedBal = freshBal;
          Object.assign(bal, freshBal);
        }
      }

      // Low ETH warning (but WETH may cover it)
      if (bal.eth < 0.002 && bal.weth < 0.002) {
        console.log(`⚠️  Both ETH and WETH low — please top up`);
        await tg(`⚠️ <b>BALANCE LOW</b>\nETH: ${bal.eth.toFixed(6)} | WETH: ${bal.weth.toFixed(6)}\nPlease top up wallet`);
      }

      // Refresh all token balances in parallel once per cycle
      await refreshTokenBalances();

      // ── 🏆 TIER COMPUTATION — runs once per cycle, drives all buy sizing ────
      // Scores every token, assigns tier 1 (top 3) and tier 2 (next N by score).
      // Only tokens in a tier receive new capital. Others: moonshot hold or skip.
      const gasCostForTier = await estimateGasCostEth();
      const tAssign = computeTierAssignments(gasCostForTier, bal.tradeableWithWeth, bal.tradeableWithWeth * ethUsd);
      currentTier1  = tAssign.tier1;
      currentTier2  = tAssign.tier2;
      currentScores = tAssign.scored;

      // Log tier state every cycle (compact)
      const t1Str = currentTier1.join(" > ");
      const t2Str = currentTier2.join(" | ") || "none";
      const tier1Usd = (bal.tradeableWithWeth * ethUsd * TIER1_PCT / TIER1_COUNT).toFixed(2);
      const tier2Slots = currentTier2.length;
      const tier2Usd = tier2Slots > 0 ? (bal.tradeableWithWeth * ethUsd * TIER2_PCT / tier2Slots).toFixed(2) : "0";
      console.log(`🏆 T1[$${tier1Usd}/slot]: ${t1Str}`);
      console.log(`🥈 T2[$${tier2Usd}/slot x${tier2Slots}]: ${t2Str}`);

      // ── 🌙 MOONSHOT SELL-DOWN — positions outside active tiers ──────────────
      // If a token has an open position but is NOT in tier 1 or tier 2,
      // and its current value is above MOONSHOT_HOLD_USD, sell down to that floor.
      // This frees capital for the actual winning tokens while keeping a lottery bag.
      for (const token of tokens) {
        if (!token.entryPrice) continue; // no position
        if (currentTier1.includes(token.symbol) || currentTier2.includes(token.symbol)) continue; // in a tier — leave it
        const price = history[token.symbol]?.lastPrice;
        if (!price) continue;
        const balance = getCachedBalance(token.symbol);
        const posUsd  = balance * price;
        if (posUsd <= MOONSHOT_HOLD_USD * 1.5) continue; // already at moonshot size
        // Sell enough to bring position down to MOONSHOT_HOLD_USD
        const keepTokens  = MOONSHOT_HOLD_USD / price;
        const sellTokens  = Math.max(balance - keepTokens, 0);
        const sellPct     = balance > 0 ? sellTokens / balance : 0;
        if (sellPct < 0.10) continue; // not worth a tx for < 10% sell
        console.log(`🌙 MOONSHOT TRIM ${token.symbol}: $${posUsd.toFixed(2)} → keeping $${MOONSHOT_HOLD_USD} lottery bag (${(sellPct*100).toFixed(0)}% sell)`);
        try {
          const p = await executeSell(cdpClient, token, sellPct, `🌙 MOONSHOT TRIM — not in active tiers`, price, false);
          if (p > 0) {
            await tg(`🌙 <b>MOONSHOT TRIM — ${token.symbol}</b>\nNot in top tiers — trimming to $${MOONSHOT_HOLD_USD} lottery bag\n💰 Freed ${p.toFixed(6)} ETH for tier redeployment\nScore: ${calcTokenScore(token.symbol, gasCostForTier, bal.tradeableWithWeth).toFixed(0)}/100`);
            // No cascade — freed capital goes back to normal tier flow
          }
        } catch (e) { console.log(`⚠️ Moonshot trim ${token.symbol}: ${e.message}`); }
      }

      // ── BATCH PRICE PREFETCH — warm price cache for all tokens in parallel ──
      // GeckoTerminal supports multi-address queries. Fetch all 29 prices in 1-2
      // HTTP calls instead of 58 sequential calls. Each processToken then hits
      // the cache instead of the API, eliminating rate-limit "no price" errors.
      try {
        const allAddrs = tokens.map(t => t.address.toLowerCase());
        // GT supports up to 30 addresses per call, comma-separated
        const chunks = [];
        for (let i = 0; i < allAddrs.length; i += 28) chunks.push(allAddrs.slice(i, i + 28));
        for (const chunk of chunks) {
          const url = `https://api.geckoterminal.com/api/v2/simple/networks/base/token_price/${chunk.join(",")}`;
          const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
          if (r.ok) {
            const d = await r.json();
            const prices = d?.data?.attributes?.token_prices || {};
            for (const [addr, priceStr] of Object.entries(prices)) {
              const p = parseFloat(priceStr);
              if (!isNaN(p) && p > 0) setCachedPrice(addr, p);
            }
          }
          if (chunks.length > 1) await sleep(300); // small gap between batch calls
        }
      } catch (e) {
        // Batch fetch failed — processToken will fall back to individual fetches
        console.log(`⚠️  Batch price prefetch failed: ${e.message} — using individual fetches`);
      }

      for (const token of tokens) {
        try {
          // FIX: Increment global cycle counter (used by dead-wave skip logic)
          globalCycleCount++;
          // Skip priceless tokens that have no open position — stops dead tokens
          // burning a full 12s timeout every cycle. Re-checks every 5th skip.
          const hasOpenPos = token.entryPrice != null;
          const streak = noPriceStreak[token.symbol] || 0;
          if (!hasOpenPos && streak >= NO_PRICE_SKIP_AFTER && streak % 5 !== 0) {
            await sleep(50);
            continue;
          }

          await Promise.race([
            processToken(cdpClient, token, bal),
            new Promise((_, r) => setTimeout(() => r(new Error(`${token.symbol} processToken timeout`)), PROCESS_TOKEN_TIMEOUT))
          ]);
          noPriceStreak[token.symbol] = 0; // success — reset streak
        } catch (e) {
          if ((e.message||"").includes("processToken timeout") && !token.entryPrice) {
            noPriceStreak[token.symbol] = (noPriceStreak[token.symbol] || 0) + 1;
            if (noPriceStreak[token.symbol] === NO_PRICE_SKIP_AFTER)
              console.log(`⏭️  ${token.symbol}: ${NO_PRICE_SKIP_AFTER} timeouts — skipping until price returns`);
          }
          console.log(`⚠️ ${token.symbol}: ${e.message}`);
        }
        await sleep(TOKEN_SLEEP_MS);
      }

      // 💱 ETH/WETH BALANCE MANAGER — keep gas topped up, WETH ready
      await manageEthWethBalance(cdpClient);

      // 🌊 RIPPLE ENGINE — runs after all tokens processed each cycle
      // Pools stale capital and deploys synchronized across active waves
      try {
        await runRippleEngine(cdpClient, tokens, bal, ethUsd);
      } catch (e) { console.log(`⚠️ Ripple Engine: ${e.message}`); }

      // Update watchlist prices silently (no trades, just data collection)
      await updateWatchlistPrices();

      if (Date.now() - lastReportTime > REPORT_INTERVAL) {
        lastReportTime = Date.now();
        await sendFullReport(bal, ethUsd, "⏰ 10 MIN REPORT");
      }
      if (Date.now() - lastMiniUpdate > MINI_UPDATE_INT) {
        lastMiniUpdate = Date.now();
        await sendMiniUpdate(bal, ethUsd);
      }
      if (Date.now() - lastSaveTime > SAVE_INTERVAL) {
        await saveToGitHub();
      }

    } catch (e) {
      console.log(`⚠️ Main loop error: ${e.message}`);
      await tg(`⚠️ <b>GUARDIAN ERROR</b>\n${e.message}`);
    }
    await sleep(TRADE_LOOP_MS);
  }
}


// Prevent Railway from killing the container on unhandled errors
process.on("uncaughtException", (e) => {
  console.log(`💀 Uncaught exception (kept alive): ${e.message}`);
  console.log(e.stack);
});
process.on("unhandledRejection", (reason) => {
  console.log(`💀 Unhandled rejection (kept alive): ${reason}`);
});

main().catch(e => {
  console.log(`💀 Fatal main() error — restarting in 30s: ${e.message}`);
  setTimeout(() => main().catch(e2 => console.log(`💀 Restart failed: ${e2.message}`)), 30_000);
});
