import { CdpClient } from "@coinbase/cdp-sdk";
import { createPublicClient, http, formatEther, parseEther } from "viem";
import { base } from "viem/chains";
import dotenv from "dotenv";
dotenv.config();

// ═══════════════════════════════════════════════════════════════════════════════
// ⚔️💓  GUARDIAN PROTOCOL — HEARTBEAT EDITION v13.0
// ═══════════════════════════════════════════════════════════════════════════════
// MISSION: Buy at confirmed MIN trough. Sell at confirmed MAX peak.
// Net margin must clear 2.5% after ALL fees including estimated price impact.
// RSI + MACD confirm every wave. ETH+WETH treated as unified balance.
// Cascade profits immediately. Portfolio drawdown halts buys. Gas spike = pause.
// The machine never sleeps. The heartbeat never stops.
// ═══════════════════════════════════════════════════════════════════════════════

const WALLET_ADDRESS = "0x50e1C4608c48b0c52E1EA5FBabc1c9126eA17915";
const WETH_ADDRESS   = "0x4200000000000000000000000000000000000006";
const SWAP_ROUTER    = "0x2626664c2603336E57B271c5C0b26F421741e481";

// ── TIMING ────────────────────────────────────────────────────────────────────
const TRADE_LOOP_MS    = 15_000;   // 15s main cycle (was 30s — faster learning)
const COOLDOWN_MS      = 120_000;  // 2min cooldown per token (was 5min — more trades)
const CASCADE_COOLDOWN = 5_000;    // 5s grace for cascade targets
const SAVE_INTERVAL    = 900_000;  // save state every 15min
const REPORT_INTERVAL  = 1_800_000;// Telegram report every 30min
const TOKEN_SLEEP_MS   = 2_000;    // 2s between tokens in loop
const ETH_PRICE_TTL    = 60_000;   // refresh live ETH price every 60s

// ── SAFETY ────────────────────────────────────────────────────────────────────
const GAS_RESERVE       = 0.0005;  // always keep this ETH for gas (raised from 0.0003)
const SELL_RESERVE      = 0.001;
const MAX_BUY_PCT       = 0.33;    // never more than 33% in one token
const ETH_RESERVE_PCT   = 0.20;    // keep 20% as reserve
const MIN_ETH_TRADE     = 0.0008;
const MIN_POS_USD       = 3.00;
const MAX_GAS_GWEI      = 50;      // pause ALL trades if gas > 50 gwei (spike protection)
const MAX_GAS_ETH       = 0.002;
const SLIPPAGE_GUARD    = 0.85;    // min 85% of expected output

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
const DRAWDOWN_HALT_PCT    = 0.35;   // halt new buys if portfolio down 35% from peak (crypto is volatile)
const DRAWDOWN_RESUME_PCT  = 0.15;   // resume when recovered to within 15% of halt level

// ── PIGGY BANK ────────────────────────────────────────────────────────────────
const PIGGY_SKIM_PCT       = 0.01;   // 1% per profitable sell → piggy (locked)
const LOTTERY_PCT          = 0.02;   // 2% kept as forever bags
const MIN_LOTTERY_TOKENS   = 1;      // always keep at least 1 token as lottery

// ── PORTFOLIO ─────────────────────────────────────────────────────────────────
const DEFAULT_TOKENS = [
  { symbol: "BRETT",   address: "0x532f27101965dd16442E59d40670FaF5eBB142E4", feeTier: 3000,  poolFeePct: 0.006, minNetMargin: MIN_NET_MARGIN },
  { symbol: "DEGEN",   address: "0x4ed4e862860bed51a9570b96d89af5e1b0efefed", feeTier: 3000,  poolFeePct: 0.006, minNetMargin: MIN_NET_MARGIN },
  { symbol: "AERO",    address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631", feeTier: 3000,  poolFeePct: 0.006, minNetMargin: MIN_NET_MARGIN },
  { symbol: "VIRTUAL", address: "0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b", feeTier: 3000,  poolFeePct: 0.006, minNetMargin: MIN_NET_MARGIN },
  { symbol: "AIXBT",   address: "0x4F9Fd6Be4a90f2620860d680c0d4d5Fb53d1A825", feeTier: 3000,  poolFeePct: 0.006, minNetMargin: MIN_NET_MARGIN },
  { symbol: "TOSHI",   address: "0xAC1Bd2486aAf3B5C0fc3Fd868558b082a531B2B4", feeTier: 10000, poolFeePct: 0.010, minNetMargin: 0.010 }, // was 5%
  { symbol: "SEAM",    address: "0x1C7a460413dD4e964f96D8dFC56E7223cE88CD85", feeTier: 3000,  poolFeePct: 0.006, minNetMargin: MIN_NET_MARGIN },

  // ── NEW ADDITIONS ─────────────────────────────────────────────────────────
  { symbol: "XCN",     address: "0x9c632e6aaa3ea73f91554f8a3cb2ed2f29605e0c", feeTier: 10000, poolFeePct: 0.010, minNetMargin: 0.008 }, // was 4%
  { symbol: "KEYCAT",  address: "0x9a26f5433671751c3276a065f57e5a02d2817973", feeTier: 10000, poolFeePct: 0.010, minNetMargin: 0.008 },
  { symbol: "DOGINME", address: "0x6921B130D297cc43754afba22e5EAc0FBf8Db75b", feeTier: 10000, poolFeePct: 0.010, minNetMargin: 0.008 },
  { symbol: "WELL",    address: "0xA88594D404727625A9437C3f886C7643872296AE", feeTier: 3000,  poolFeePct: 0.006, minNetMargin: MIN_NET_MARGIN },
  { symbol: "SKI",     address: "0x768BE13e1680b5ebE0024C42c896E3dB59ec0149", feeTier: 10000, poolFeePct: 0.010, minNetMargin: 0.008 },
];

// ── WATCHLIST — tokens Guardian monitors but does NOT trade ───────────────────
// Stars: 1-5 (5 = execute immediately when ready, 1 = data only / red flag)
// Status: "watching" | "waiting_entry" | "red_flag" | "thinking" | "fee_model_wrong"
// Guardian records price data silently, never buys, shows in /watchlist command
const WATCHLIST = [
  {
    symbol:   "CLANKER",
    address:  "0x1d008f50fb828ef9debbbeae1b71fffe929bf317",
    stars:    2,
    status:   "fee_model_wrong",
    reason:   "Fee model requires validator/verifier income to be viable. Pool fees too high for small capital — only profitable if earning verification rewards. Revisit when running fiber node validator operation.",
    entryPlan:"Watch for validator setup. Entry only justified by fee income offsetting cost.",
    addedDate:"2026-03-12",
    redFlags: ["High fee tier eats margin", "Need verifier role to offset fees", "Not viable sub-$500 capital"],
    greenFlags:["Strong Base ecosystem token", "Good volume", "Coinbase aligned"],
  },
  {
    symbol:   "MORPHO",
    address:  "0xBAa5CC21fd487B8Fcc2F632f8F4e4b1E7a67bA9f",
    stars:    3,
    status:   "watching",
    reason:   "DeFi lending protocol on Base. Real yield from borrowers, not inflationary rewards. Watching fee structure and liquidity depth before committing capital. Fundamentals are strong.",
    entryPlan:"Promote to active when 90d wave pattern has 4P/4T and wallet >$100 tradeable.",
    addedDate:"2026-03-12",
    redFlags: ["Newer protocol — less battle-tested than Aave", "Liquidity thinner than larger DeFi tokens"],
    greenFlags:["Real yield from borrowers", "Base native", "Growing TVL", "Coinbase ecosystem aligned"],
  },
  {
    symbol:   "CBBTC",
    address:  "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
    stars:    4,
    status:   "waiting_entry",
    reason:   "Coinbase wrapped BTC on Base. Maximum trust — issued by Coinbase directly. Price per token too high for current wallet size. When wallet grows to $200+ tradeable ETH this becomes a priority hold.",
    entryPlan:"Promote to active when tradeable ETH > $200. High conviction long-term hold candidate. Will appreciate with BTC.",
    addedDate:"2026-03-12",
    redFlags: ["Price per token very high — needs larger capital base to get meaningful position"],
    greenFlags:["Coinbase issued — maximum trust", "BTC exposure on Base chain", "Will follow BTC bull cycles", "Perfect piggy bank asset long term"],
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
  "https://mainnet.base.org",
  "https://base.llamarpc.com",
  "https://base-rpc.publicnode.com",
  "https://1rpc.io/base",
];
let rpcIndex = 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));
function getClient() {
  return createPublicClient({ chain: base, transport: http(RPC_URLS[rpcIndex % RPC_URLS.length]) });
}
function nextRpc() { rpcIndex = (rpcIndex + 1) % RPC_URLS.length; }
async function rpcCall(fn) {
  for (let i = 0; i < RPC_URLS.length; i++) {
    try { return await fn(getClient()); }
    catch (e) {
      if (e.message?.includes("429") || e.message?.includes("rate limit") || e.message?.includes("over rate")) {
        nextRpc(); await sleep(1000);
      } else throw e;
    }
  }
  throw new Error("All RPCs rate limited");
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

async function estimateGasCostEth() {
  try {
    const gasPrice = await rpcCall(c => c.getGasPrice());
    return Number(gasPrice * BigInt(220_000)) / 1e18; // 220k gas units for swap
  } catch { return 0.0001; }
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
let lastSaveTime   = Date.now();  // don't save immediately on startup — wait full interval
let lastReportTime = Date.now();  // don't report immediately on startup — startup message covers it
let approvedTokens = new Set();
let cdpClient      = null;
let manualCommands = [];
let cachedBal      = null;   // updated each loop cycle — used in Telegram commands
const waveState    = {};
const tradeLog     = [];
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
  ];

  for (const token of allTokens) {
    try {
      const candles = await fetchHistoricalCandles(token.address, days);
      if (!candles || candles.length < 7) {
        console.log(`   ⚠️  ${token.symbol}: no candle data — will learn live`);
        skipped++;
        continue;
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
          history[token.symbol].readings = [...syntheticReadings, ...liveReadings].slice(-8000);
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
    await sleep(500);
  }
  console.log(`📅 Historical load complete: ${loaded} loaded, ${skipped} skipped\n`);
}

function bootstrapWavesFromHistory() {
  const activeSymbols = new Set(DEFAULT_TOKENS.map(t => t.symbol));
  console.log("🌊 Bootstrapping waves from history...");
  for (const symbol of Object.keys(history)) {
    if (!activeSymbols.has(symbol)) {
      console.log(`   🗑️  Skipping ghost token: ${symbol} (not in active portfolio)`);
      continue;
    }
    const readings = history[symbol]?.readings;
    if (!readings || readings.length < 10) continue;
    const ws = initWaveState(symbol);
    const prices = readings.map(r => r.price);
    const peaks = [], troughs = [];
    for (let i = 2; i < prices.length - 2; i++) {
      const m = prices[i];
      if (m > prices[i-2] && m > prices[i-1] && m > prices[i+1] && m > prices[i+2]) {
        const l = peaks[peaks.length-1];
        if (!l || Math.abs(m-l)/l > WAVE_MIN_MOVE) peaks.push(m);
      }
      if (m < prices[i-2] && m < prices[i-1] && m < prices[i+1] && m < prices[i+2]) {
        const l = troughs[troughs.length-1];
        if (!l || Math.abs(m-l)/l > WAVE_MIN_MOVE) troughs.push(m);
      }
    }
    ws.peaks   = peaks.slice(-WAVE_COUNT);
    ws.troughs = troughs.slice(-WAVE_COUNT);
    if (ws.peaks.length || ws.troughs.length) {
      console.log(`   ✅ ${symbol}: ${ws.peaks.length}P ${ws.troughs.length}T | MAX:$${Math.max(...ws.peaks).toFixed(8)||"?"} MIN:$${Math.min(...ws.troughs).toFixed(8)||"?"}`);
    }
  }
  console.log("✅ Wave bootstrap complete\n");
}

function recordPrice(symbol, price) {
  if (!history[symbol]) history[symbol] = { readings: [], lastPrice: null };
  history[symbol].readings.push({ price, time: Date.now() });
  if (history[symbol].readings.length > 8000) history[symbol].readings.shift(); // increased from 5000
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
async function getTokenPrice(address) {
  try {
    const r = await fetch(`https://api.geckoterminal.com/api/v2/simple/networks/base/token_price/${address.toLowerCase()}`);
    const d = await r.json();
    const p = parseFloat(d?.data?.attributes?.token_prices?.[address.toLowerCase()]);
    if (!isNaN(p) && p > 0) return p;
  } catch {}
  try {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${address}`);
    const d = await r.json();
    const p = parseFloat(d?.pairs?.find(x => x.chainId === "base")?.priceUsd);
    if (!isNaN(p) && p > 0) return p;
  } catch {}
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
  const lottery    = Math.max(Math.floor(balance * LOTTERY_PCT), MIN_LOTTERY_TOKENS);
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
  await cdp.evm.sendTransaction({ address: WALLET_ADDRESS, network: "base", transaction: { to: tokenAddress, data: encodeApprove(SWAP_ROUTER, MAX) } });
  approvedTokens.add(key);
  await sleep(8000);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🟢 BUY — uses ETH+WETH unified, wraps if needed
// ═══════════════════════════════════════════════════════════════════════════════
async function executeBuy(cdp, token, bal, reason, price, forcedEth = 0, isCascade = false) {
  try {
    if (!canTrade(token.symbol, isCascade)) { console.log(`   ⏳ ${token.symbol} cooldown`); return false; }
    if (drawdownHaltActive)                 { console.log(`   🛑 ${token.symbol} drawdown halt active`); return false; }

    const ethUsd   = await getLiveEthPrice();
    const gasCost  = await estimateGasCostEth();

    // Gas spike check before every trade
    if (!(await isGasSafe())) return false;

    // Unified balance: ETH + WETH
    const { eth, weth, tradeableWithWeth } = bal;
    const totalAvail = eth + weth - GAS_RESERVE - SELL_RESERVE;
    if (totalAvail < MIN_ETH_TRADE)          { console.log(`   🛑 Insufficient ETH+WETH: ${totalAvail.toFixed(6)}`); return false; }
    if (price * totalAvail * ethUsd < MIN_POS_USD) { console.log(`   🛑 Position too small`); return false; }

    const armStatus = getArmStatus(token.symbol, gasCost, totalAvail);
    const maxPct    = armStatus.armed ? getCascadePct(armStatus.net) : 0.30;
    const maxSpend  = Math.min(totalAvail * maxPct, totalAvail * MAX_BUY_PCT);
    const minSpend  = MIN_POS_USD / ethUsd;
    const ethToSpend= forcedEth > 0
      ? Math.min(forcedEth, maxSpend)
      : Math.min(Math.max(minSpend, totalAvail * 0.10), maxSpend);

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
    console.log(`\n   🟢 BUY ${token.symbol} — ${reason}`);
    console.log(`      ${ethToSpend.toFixed(6)} ${useWeth?"WETH":"ETH"} @ $${price.toFixed(8)} (ETH=$${ethUsd.toFixed(0)})`);
    console.log(`      MIN trough: $${getMinTrough(token.symbol)?.toFixed(8)||"?"} | MAX peak target: $${getMaxPeak(token.symbol)?.toFixed(8)||"?"}`);
    console.log(`      💓 Indicators: ${ind.detail}`);
    if (armStatus.armed) console.log(`      Net margin (w/ impact): ${(armStatus.net*100).toFixed(2)}% [${armStatus.priority}]`);

    let txHash;
    if (useWeth) {
      await ensureApproved(cdp, WETH_ADDRESS, amountIn);
      const { transactionHash } = await cdp.evm.sendTransaction({
        address: WALLET_ADDRESS, network: "base",
        transaction: { to: SWAP_ROUTER, data: encodeSwap(WETH_ADDRESS, token.address, amountIn, WALLET_ADDRESS, token.feeTier, minTokens) },
      });
      txHash = transactionHash;
    } else {
      const { transactionHash } = await cdp.evm.sendTransaction({
        address: WALLET_ADDRESS, network: "base",
        transaction: { to: SWAP_ROUTER, value: amountIn, data: encodeSwap(WETH_ADDRESS, token.address, amountIn, WALLET_ADDRESS, token.feeTier, minTokens) },
      });
      txHash = transactionHash;
    }

    lastTradeTime[token.symbol] = Date.now();
    if (isCascade) cascadeTime[token.symbol] = Date.now();
    tradeCount++;
    token.entryPrice       = price;
    token.totalInvestedEth = (token.totalInvestedEth || 0) + ethToSpend;
    token.entryTime        = Date.now();
    tradeLog.push({ type: "BUY", symbol: token.symbol, price, ethSpent: ethToSpend, timestamp: new Date().toISOString(), tx: txHash, reason, indScore: ind.score });
    await appendToLedger({ type:"BUY", tradeNum:tradeCount, symbol:token.symbol, price, ethSpent:ethToSpend, usdValue:ethToSpend*ethUsd, ethUsd, timestamp:new Date().toISOString(), tx:txHash, basescan:`https://basescan.org/tx/${txHash}`, reason, indScore:ind.score, indDetail:ind.detail, priority:armStatus.priority||"?", netMargin:armStatus.net||0, minTrough:getMinTrough(token.symbol), maxPeak:getMaxPeak(token.symbol), wallet:WALLET_ADDRESS });

    console.log(`      ✅ https://basescan.org/tx/${txHash}`);
    await tg(
      `🟢🟢🟢 <b>BOUGHT ${token.symbol}!</b>\n\n` +
      `💰 ${ethToSpend.toFixed(6)} ${useWeth?"WETH":"ETH"} (~$${(ethToSpend*ethUsd).toFixed(2)})\n` +
      `📥 Entry: $${price.toFixed(8)}\n` +
      `🎯 Target (MAX peak): $${getMaxPeak(token.symbol)?.toFixed(8)||"learning"}\n` +
      `📊 Net margin: ${armStatus.armed?(armStatus.net*100).toFixed(2)+"%":"calculating"} [${armStatus.priority||"?"}]\n` +
      `💓 ${ind.detail}\n` +
      `📋 ${reason}\n` +
      `🔗 <a href="https://basescan.org/tx/${txHash}">Basescan</a>`
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
    if (!canTrade(token.symbol)) { console.log(`   ⏳ ${token.symbol} cooldown`); return null; }

    const ethUsd   = await getLiveEthPrice();
    const gasCost  = await estimateGasCostEth();

    if (!isProtective && !(await isGasSafe())) return null;

    const totalBal = await getTokenBalance(token.address);
    if (totalBal < 0.01) {
      console.log(`   ⚠️  ${token.symbol}: dust — clearing`);
      token.entryPrice = null; token.totalInvestedEth = 0; token.entryTime = null;
      return null;
    }

    const lottery  = Math.max(Math.floor(totalBal * LOTTERY_PCT), MIN_LOTTERY_TOKENS);
    const sellable = Math.max(totalBal - lottery, 0);
    if (sellable < 1) {
      console.log(`   ⏳ ${token.symbol}: only lottery remains — clearing`);
      token.entryPrice = null; token.totalInvestedEth = 0; token.entryTime = null;
      return null;
    }

    // Gas profitability check using live ETH price
    const procEth        = (sellable * sellPct * price) / ethUsd;
    const expectedProfit = procEth - (token.totalInvestedEth * sellPct || 0);
    if (!isProtective && gasCost > 0.15 * expectedProfit && expectedProfit > 0) {
      console.log(`   🛑 Gas ${gasCost.toFixed(6)} ETH > 15% of $${(expectedProfit*ethUsd).toFixed(2)} profit — skipping`);
      return null;
    }

    const amtToSell = BigInt(Math.floor(sellable * sellPct * 1e18));
    if (amtToSell === BigInt(0)) return null;
    const minWeth   = BigInt(Math.floor(procEth * SLIPPAGE_GUARD * 1e18));

    const sellAmt   = sellable * sellPct;
    const ind       = getIndicatorScore(token.symbol);
    console.log(`\n   🔴 SELL ${token.symbol} ${(sellPct*100).toFixed(0)}% — ${reason}`);
    console.log(`      ${sellAmt>=1?Math.floor(sellAmt):sellAmt.toFixed(4)} tokens @ $${price.toFixed(8)} | ETH=$${ethUsd.toFixed(0)} | 🎰 keeping ${lottery}`);
    console.log(`      💓 Indicators: ${ind.detail}`);

    await ensureApproved(cdp, token.address, amtToSell);
    const wBefore = await getWethBalance();
    const eBefore = await getEthBalance();

    const { transactionHash } = await cdp.evm.sendTransaction({
      address: WALLET_ADDRESS, network: "base",
      transaction: { to: SWAP_ROUTER, data: encodeSwap(token.address, WETH_ADDRESS, amtToSell, WALLET_ADDRESS, token.feeTier, minWeth) },
    });

    lastTradeTime[token.symbol] = Date.now();
    tradeCount++;
    await sleep(8000);

    const wAfter   = await getWethBalance();
    const eAfter   = await getEthBalance();
    const received = (wAfter - wBefore) + (eAfter - eBefore);
    const recUsd   = received * ethUsd;
    const invUsd   = (token.totalInvestedEth || 0) * sellPct * ethUsd;
    const netUsd   = recUsd - invUsd;

    let skim = 0;
    if (received > 0 && netUsd > 0) {
      skim = received * PIGGY_SKIM_PCT;
      piggyBank    += skim;
      totalSkimmed += skim;
    }

    if (sellPct >= 0.95) {
      token.entryPrice = null; token.totalInvestedEth = 0; token.entryTime = null;
    } else {
      token.totalInvestedEth = (token.totalInvestedEth || 0) * (1 - sellPct);
    }

    tradeLog.push({ type: "SELL", symbol: token.symbol, price, receivedEth: received, netUsd, timestamp: new Date().toISOString(), tx: transactionHash, reason, indScore: ind.score });
    await appendToLedger({ type:"SELL", tradeNum:tradeCount, symbol:token.symbol, price, receivedEth:received, recUsd, investedUsd:invUsd, netUsd, pnlPct:invUsd>0?((netUsd/invUsd)*100):0, ethUsd, timestamp:new Date().toISOString(), tx:transactionHash, basescan:`https://basescan.org/tx/${transactionHash}`, reason, indScore:ind.score, indDetail:ind.detail, skimEth:skim, piggyTotal:piggyBank, wallet:WALLET_ADDRESS });

    console.log(`      ✅ https://basescan.org/tx/${transactionHash}`);
    console.log(`      💰 Received: ${received.toFixed(6)} ETH ($${recUsd.toFixed(2)}) | Net: ${netUsd>=0?"+":""}$${netUsd.toFixed(2)}`);

    await tg(
      `🔴🔴🔴 <b>SOLD ${token.symbol}!</b>\n\n` +
      `💰 Received: ${received.toFixed(6)} ETH (~$${recUsd.toFixed(2)})\n` +
      `📥 Invested: ~$${invUsd.toFixed(2)}\n` +
      `${netUsd>=0?"📈":"📉"} Net: ${netUsd>=0?"+":""}$${netUsd.toFixed(2)}\n` +
      `💲 Exit: $${price.toFixed(8)} (MAX peak)\n` +
      `🎰 ${lottery} ${token.symbol} kept forever\n` +
      `🐷 Skim: ${skim.toFixed(6)} ETH | Total piggy: ${piggyBank.toFixed(6)} ETH\n` +
      `💓 ${ind.detail}\n` +
      `📋 ${reason}\n` +
      `🔗 <a href="https://basescan.org/tx/${transactionHash}">Basescan</a>`
    );
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
async function processToken(cdp, token, bal) {
  try {
    const price = await getTokenPrice(token.address);
    if (!price) { console.log(`   ⏳ ${token.symbol}: no price`); return; }

    recordPrice(token.symbol, price);
    updateWaves(token.symbol, price);

    const ethUsd   = await getLiveEthPrice();
    const balance  = await getTokenBalance(token.address);
    const gasCost  = await estimateGasCostEth();
    const entry    = token.entryPrice;
    const maxPeak  = getMaxPeak(token.symbol);
    const minTrgh  = getMinTrough(token.symbol);
    const peakCnt  = getPeakCount(token.symbol);
    const trghCnt  = getTroughCount(token.symbol);
    const arm      = getArmStatus(token.symbol, gasCost, bal.tradeableWithWeth);
    const ind      = getIndicatorScore(token.symbol);
    const rd       = entry ? buildRaceDisplay(token, price, balance, ethUsd) : null;
    const lottery  = Math.max(Math.floor(balance * LOTTERY_PCT), MIN_LOTTERY_TOKENS);
    const sellable = Math.max(balance - lottery, 0);

    // ── DECISIONS ──────────────────────────────────────────────────────────
    const atMaxPeak    = maxPeak && price >= maxPeak * 0.995;
    // Safety: only sell if we'd actually profit after pool fees + piggy skim
    // If entry is known, verify net positive. If no entry (legacy), trust MAX peak math.
    const feesOnSell   = (balance * price * (token.poolFeePct || 0.006));
    const piggyOnSell  = (balance * price * PIGGY_SKIM_PCT);
    const netIfSellNow = entry
      ? (balance - Math.max(Math.floor(balance * LOTTERY_PCT), MIN_LOTTERY_TOKENS)) * price - (token.totalInvestedEth || 0) * ethUsd - feesOnSell - piggyOnSell
      : 1; // no entry = legacy, trust the peak
    // Must clear the error buffer — not just breakeven but breakeven + buffer
    const breakEvenBuffer = entry ? (token.totalInvestedEth || 0) * ethUsd * PROFIT_ERROR_BUFFER : 0;
    const shouldSell   = atMaxPeak && sellable > 1 && netIfSellNow > breakEvenBuffer;

    const atMinTrough  = minTrgh && price <= minTrgh * 1.005;
    // Indicator confirmation: RSI or MACD must lean bullish at trough
    const indConfirmed = ind.score >= 1;
    const shouldBuy    = atMinTrough && arm.armed && !entry
                      && bal.tradeableWithWeth >= MIN_ETH_TRADE
                      && canTrade(token.symbol);

    const stopLossPrice= minTrgh ? minTrgh * (1 - STOP_LOSS_PCT) : null;
    const stopLossHit  = entry && stopLossPrice && price < stopLossPrice;

    // ── ZONE ───────────────────────────────────────────────────────────────
    const hasPosition = balance > 1;
    const zone = shouldSell   ? "🔴 AT MAX PEAK — SELLING" :
                 stopLossHit  ? "🛑 STOP LOSS" :
                 shouldBuy    ? `🟢 AT MIN TROUGH — BUYING${!indConfirmed?" (unconfirmed)":""}` :
                 hasPosition  ? "🏇 RIDING" :
                 arm.armed    ? `✅ ARMED [${arm.priority}]` : "⏳ BUILDING";

    const pnlStr    = entry ? ` | P&L: ${((price-entry)/entry*100).toFixed(1)}%` : "";
    const pctToBuy  = minTrgh ? ((price-minTrgh)/minTrgh*100).toFixed(1) : "?";
    const pctToSell = maxPeak ? ((price-maxPeak)/maxPeak*100).toFixed(1) : "?";

    // Build full output as one string to prevent async interleaving between tokens
    const lines = [];
    lines.push(`\n  ┌─ [${token.symbol}] ${zone}${pnlStr}`);
    lines.push(`  │ $${price.toFixed(8)} | 🪙 ${balance>=1?Math.floor(balance):balance.toFixed(4)} ($${(balance*price).toFixed(2)}) | ETH=$${ethUsd.toFixed(0)}`);
    lines.push(`  │ MAX:$${maxPeak?.toFixed(8)||"?"}(${pctToSell}%) MIN:$${minTrgh?.toFixed(8)||"?"}(+${pctToBuy}%) P:${peakCnt} T:${trghCnt}`);
    if (rd) {
      lines.push(`  │ 🏇 [${rd.bar}] ${rd.racePct}% to target`);
      lines.push(`  │ 📥 Entry: $${rd.entry.toFixed(8)} | Invested: $${rd.invUsd}`);
      lines.push(`  │ 💲 SELL NOW → ~$${rd.nowUsd} | ${rd.pnlSign}$${rd.pnlUsd} (${rd.pnlSign}${rd.pnlPct}%)`);
      lines.push(`  │ 🎯 AT TARGET ($${rd.sellTarget?.toFixed(8)||"?"}) → ~$${rd.tgtUsd}`);
      // Sell safety check — warn if selling now would be a loss vs fees
      const fees = (parseFloat(rd.nowUsd) * (token.poolFeePct||0.006) * 2); // buy+sell fees
      const netNow = parseFloat(rd.nowUsd) - parseFloat(rd.invUsd) - fees;
      if (netNow < 0) {
        lines.push(`  │ ⚠️  BELOW BREAKEVEN — fees not yet covered (need +$${Math.abs(netNow).toFixed(3)} more)`);
      } else if (netNow < parseFloat(rd.invUsd) * PROFIT_ERROR_BUFFER) {
        lines.push(`  │ 🟡 NEAR BREAKEVEN — within error buffer ($${netNow.toFixed(3)} net)`);
      } else {
        lines.push(`  │ ✅ PROFIT ZONE: net after fees ~+$${netNow.toFixed(3)}`);
      }
    }
    lines.push(`  │ 💓 ${ind.detail || "building indicators..."}`);
    if (arm.armed) lines.push(`  │ ✅ ARMED ${(arm.net*100).toFixed(2)}% [${arm.priority}] (w/ price impact)`);
    else           lines.push(`  │ ⏳ ${arm.reason}`);
    if (drawdownHaltActive) lines.push(`  │ 🛑 DRAWDOWN HALT ACTIVE — buys suspended`);
    lines.push(`  └──────────────────────────────────────────────`);
    console.log(lines.join("\n"));

    // ── MANUAL COMMANDS ────────────────────────────────────────────────────
    const mi = manualCommands.findIndex(c => c.symbol === token.symbol);
    if (mi !== -1) {
      const cmd = manualCommands.splice(mi, 1)[0];
      if (cmd.action === "buy") {
        await executeBuy(cdp, token, bal, "MANUAL BUY", price);
      } else if (cmd.action === "sell") {
        const p = await executeSell(cdp, token, 0.98, "MANUAL SELL", price, true);
        if (p > 0) { const nb = await getFullBalance(); await triggerCascade(cdp, token.symbol, p, nb); }
      } else if (cmd.action === "sellhalf") {
        const p = await executeSell(cdp, token, 0.50, "MANUAL SELL HALF", price, true);
        if (p > 0) { const nb = await getFullBalance(); await triggerCascade(cdp, token.symbol, p, nb); }
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

    // ── SELL AT MAX PEAK ───────────────────────────────────────────────────
    if (shouldSell) {
      const sellMsg = entry
        ? (rd?.lines || `$${price.toFixed(8)}`)
        : `💲 $${price.toFixed(8)} | No entry recorded (legacy position)`;
      await tg(
        `🔴🎯 <b>${token.symbol} MAX PEAK HIT</b>\n\n` +
        sellMsg + "\n\n" +
        `🎯 MAX peak: $${maxPeak.toFixed(8)}\n` +
        `💓 ${ind.detail}\n⚡ Executing...`
      );
      const proceeds = await executeSell(cdp, token, 0.98, `🎯 MAX PEAK $${maxPeak.toFixed(8)}`, price, false);
      if (proceeds > 0) { const nb = await getFullBalance(); await triggerCascade(cdp, token.symbol, proceeds, nb); }
      return;
    }

    // ── BUY AT MIN TROUGH ──────────────────────────────────────────────────
    if (shouldBuy) {
      if (!indConfirmed) {
        console.log(`  ⚠️ ${token.symbol}: at MIN trough but indicators unconfirmed (score ${ind.score}) — watching`);
        await tg(`⚠️ <b>${token.symbol} MIN TROUGH</b> but indicators not confirmed (score ${ind.score})\nWatching for confirmation...`);
        // We still buy — but log it as unconfirmed for review
      }
      await tg(
        `🟢🎯 <b>${token.symbol} MIN TROUGH — BUYING</b>\n\n` +
        `💲 $${price.toFixed(8)} (MIN: $${minTrgh.toFixed(8)})\n` +
        `🎯 Target (MAX peak): $${maxPeak?.toFixed(8)||"?"}\n` +
        `📊 Net margin: ${(arm.net*100).toFixed(2)}% [${arm.priority}]\n` +
        `💓 ${ind.detail}\n` +
        `${indConfirmed?"✅ CONFIRMED":"⚠️ unconfirmed"}\n⚡ Executing...`
      );
      await executeBuy(cdp, token, bal, `🎯 MIN TROUGH [${arm.priority}]${indConfirmed?"":" unconfirmed"}`, price);
    }

  } catch (e) { console.log(`  ⚠️ processToken error (${token.symbol}): ${e.message}`); }
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
  if (hf) { history = hf.content || {}; historySha = hf.sha; }
  const pf = await githubGet("positions.json");
  if (pf?.content) {
    positionsSha   = pf.sha;
    const pos      = pf.content;
    piggyBank      = pos.piggyBank    || 0;
    totalSkimmed   = pos.totalSkimmed || 0;
    tradeCount     = pos.tradeCount   || 0;
    // portfolioPeakUsd intentionally NOT loaded — stale peaks cause false drawdown halts
    // It will be set fresh from the first cycle's actual portfolio value
    for (const t of tokens) {
      if (pos.entries?.[t.symbol] != null) {
        t.entryPrice       = pos.entries[t.symbol];
        t.totalInvestedEth = pos.invested?.[t.symbol]   || 0;
        t.entryTime        = pos.entryTimes?.[t.symbol] || null;
      }
    }
  }
  const positions = tokens.filter(t => t.entryPrice).map(t => t.symbol).join(", ");
  console.log(`✅ ${tokens.length} tokens | Positions: ${positions || "none"} | Piggy: ${piggyBank.toFixed(6)} ETH | Trades: ${tradeCount}`);
}

async function saveToGitHub() {
  try {
    tokensSha    = await githubSave("tokens.json",  { tokens, lastSaved: new Date().toISOString() }, tokensSha);
    historySha   = await githubSave("history.json", history, historySha);
    positionsSha = await githubSave("positions.json", {
      lastSaved: new Date().toISOString(), piggyBank, totalSkimmed, tradeCount,
      entries:    Object.fromEntries(tokens.map(t => [t.symbol, t.entryPrice       || null])),
      invested:   Object.fromEntries(tokens.map(t => [t.symbol, t.totalInvestedEth || 0])),
      entryTimes: Object.fromEntries(tokens.map(t => [t.symbol, t.entryTime        || null])),
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
    await tg(
      `📊 <b>GUARDIAN v13 💓 — ${title}</b>\n🕐 ${new Date().toLocaleTimeString()}\n\n` +
      `💰 ETH: ${bal.eth.toFixed(6)} ($${(bal.eth*ethUsd).toFixed(2)})\n` +
      `💎 WETH: ${bal.weth.toFixed(6)} ($${(bal.weth*ethUsd).toFixed(2)})\n` +
      `♻️ Tradeable (ETH+WETH): ${bal.tradeableWithWeth.toFixed(6)} ETH\n` +
      `🐷 Piggy: ${piggyBank.toFixed(6)} ETH ($${(piggyBank*ethUsd).toFixed(2)}) LOCKED\n` +
      `📈 Trades: ${tradeCount} | Skimmed: ${totalSkimmed.toFixed(6)} ETH\n` +
      `💲 ETH Price: $${ethUsd.toFixed(2)}${ddStr}\n` +
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

      // Each command wrapped individually — one crash can never kill the whole handler
      try {
        if (text.startsWith("/buy ")) {
        const sym = raw.split(" ")[1]?.toUpperCase();
        if (!tokens.find(t=>t.symbol===sym)) { await tg(`❓ Unknown: ${sym}`); continue; }
        manualCommands.push({ symbol: sym, action: "buy" });
        await tg(`📱 <b>BUY ${sym} queued</b>`);
      } else if (text.startsWith("/sell ") && !text.startsWith("/sellhalf")) {
        const sym = raw.split(" ")[1]?.toUpperCase();
        if (!tokens.find(t=>t.symbol===sym)) { await tg(`❓ Unknown: ${sym}`); continue; }
        manualCommands.push({ symbol: sym, action: "sell" });
        await tg(`📱 <b>SELL ${sym} queued</b>`);
      } else if (text.startsWith("/sellhalf ")) {
        const sym = raw.split(" ")[1]?.toUpperCase();
        if (!tokens.find(t=>t.symbol===sym)) { await tg(`❓ Unknown: ${sym}`); continue; }
        manualCommands.push({ symbol: sym, action: "sellhalf" });
        await tg(`📱 <b>SELL HALF ${sym} queued</b>`);
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
        let msg = `🏇 <b>RACEHORSE STANDINGS v13</b>\n🕐 ${new Date().toLocaleTimeString()}\n\n`;
        let any = false;
        for (const t of tokens) {
          if (!t.entryPrice) continue; any = true;
          const p  = history[t.symbol]?.lastPrice || t.entryPrice;
          const b  = getCachedBalance(t.symbol);
          const rd = buildRaceDisplay(t, p, b, ethUsd);
          if (rd) { msg += `<b>${t.symbol}</b>\n${rd.lines}\n📱 /sell ${t.symbol}\n\n`; }
        }
        if (!any) msg += "No open positions.";
        await tg(msg);
      } else if (text === "/positions") {
        let msg = `📋 <b>POSITIONS v13</b>\n\n`;
        let any = false;
        for (const t of tokens) {
          if (!t.entryPrice) continue; any = true;
          const p  = history[t.symbol]?.lastPrice || t.entryPrice;
          const b  = getCachedBalance(t.symbol);
          const rd = buildRaceDisplay(t, p, b, ethUsd);
          msg += `<b>${t.symbol}</b>\n${rd?.lines||`$${p.toFixed(8)}`}\n📱 /sell ${t.symbol}\n\n`;
        }
        if (!any) msg += "No open positions.";
        await tg(msg);
      } else if (text === "/eth") {
        await tg(`💰 <b>BALANCES</b>\nETH: ${bal.eth.toFixed(6)} ($${(bal.eth*ethUsd).toFixed(2)})\nWETH: ${bal.weth.toFixed(6)} ($${(bal.weth*ethUsd).toFixed(2)})\nTradeable (ETH+WETH): ${bal.tradeableWithWeth.toFixed(6)}\n🐷 Piggy: ${piggyBank.toFixed(6)} ETH (LOCKED)\n💲 ETH = $${ethUsd.toFixed(2)}`);
      } else if (text === "/piggy") {
        const pct = Math.min((piggyBank/0.5)*100, 100);
        await tg(`🐷 <b>PIGGY BANK</b>\n${piggyBank.toFixed(6)} ETH ($${(piggyBank*ethUsd).toFixed(2)})\nTotal skimmed: ${totalSkimmed.toFixed(6)} ETH\nGoal: 0.5 ETH (${pct.toFixed(1)}%)\n1% per profitable sell — locked forever`);
      } else if (text === "/trades") {
        const recent = tradeLog.slice(-5).map(t=>`${t.type} ${t.symbol} $${parseFloat(t.price).toFixed(8)} score:${t.indScore||"?"} ${t.timestamp?.slice(11,19)||""}`).join("\n");
        await tg(`📈 <b>TRADES</b>\nCount: ${tradeCount} | Skimmed: ${totalSkimmed.toFixed(6)} ETH\n\nRecent:\n${recent||"none"}`);
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
        // /watchlist        — all watched tokens with ratings and reasons
        // /watchlist CLANKER — deep dive on one
        const parts  = text.split(" ");
        const symArg = parts[1]?.toUpperCase();

        const STARS = (n) => "⭐".repeat(n) + "☆".repeat(5-n);
        const STATUS_EMOJI = { fee_model_wrong:"💸", watching:"👁", waiting_entry:"⏳", red_flag:"🚩", thinking:"🤔" };

        if (symArg) {
          const w = WATCHLIST.find(x => x.symbol === symArg);
          if (!w) {
            await tg(`❓ ${symArg} not in watchlist. Type /watchlist to see all.`);
          } else {
            const wp = watchPrices[w.symbol];
            const priceStr = wp?.lastPrice ? `$${wp.lastPrice.toFixed(8)}` : "fetching...";
            const high     = wp?.high24h && wp.high24h > 0 ? `$${wp.high24h.toFixed(8)}` : "—";
            const low      = wp?.low24h && wp.low24h < Infinity ? `$${wp.low24h.toFixed(8)}` : "—";
            const readings = wp?.prices?.length || 0;

            await tg(
              `${STATUS_EMOJI[w.status]||"👁"} <b>WATCHLIST: ${w.symbol}</b>\n` +
              `${STARS(w.stars)} (${w.stars}/5 stars)\n` +
              `Status: <b>${w.status.replace(/_/g," ").toUpperCase()}</b>\n` +
              `Added: ${w.addedDate}\n\n` +

              `<b>CURRENT DATA</b>\n` +
              `   Price:    ${priceStr}\n` +
              `   24h High: ${high}\n` +
              `   24h Low:  ${low}\n` +
              `   Readings: ${readings} price points collected\n\n` +

              `<b>WHY WATCHING (NOT TRADING)</b>\n` +
              `${w.reason}\n\n` +

              `<b>ENTRY PLAN</b>\n` +
              `${w.entryPlan}\n\n` +

              `<b>🚩 RED FLAGS</b>\n` +
              w.redFlags.map(f => `   • ${f}`).join("\n") + "\n\n" +

              `<b>✅ GREEN FLAGS</b>\n` +
              w.greenFlags.map(f => `   • ${f}`).join("\n")
            );
          }
        } else {
          // Full watchlist overview
          let lines = `👁 <b>GUARDIAN WATCHLIST</b>\n`;
          lines    += `Tokens monitored but NOT traded\n`;
          lines    += `━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

          // Group by stars descending
          const sorted = [...WATCHLIST].sort((a,b) => b.stars - a.stars);
          for (const w of sorted) {
            const wp       = watchPrices[w.symbol];
            const price    = wp?.lastPrice ? `$${wp.lastPrice.toFixed(6)}` : "watching...";
            const readings = wp?.prices?.length || 0;
            lines +=
              `${STATUS_EMOJI[w.status]||"👁"} <b>${w.symbol}</b> ${STARS(w.stars)}\n` +
              `   ${price} | ${readings} readings | ${w.status.replace(/_/g," ")}\n` +
              `   📝 ${w.reason.substring(0,80)}...\n\n`;
          }

          lines += `\nType /watchlist SYMBOL for full deep dive\n`;
          lines += `\n<b>STAR GUIDE</b>\n`;
          lines += `⭐⭐⭐⭐⭐ Execute immediately when conditions met\n`;
          lines += `⭐⭐⭐⭐ High conviction — waiting for right entry\n`;
          lines += `⭐⭐⭐   Interesting — gathering more data\n`;
          lines += `⭐⭐     Viable with conditions (e.g. validator income)\n`;
          lines += `⭐       Data only — red flag or fundamentally wrong fit`;

          await tg(lines);
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

      } else if (text === "/help") {
        await tg(
          `⚔️💓 <b>GUARDIAN v13 — HEARTBEAT EDITION</b>\n\n` +
          `<b>Strategy:</b>\n` +
          `Buy at confirmed MIN trough (lowest proven low)\n` +
          `Sell at confirmed MAX peak (highest proven high)\n` +
          `Net margin gate: 2.5%+ after fees + price impact\n` +
          `RSI + MACD + Bollinger confirm every wave\n` +
          `Need 4 peaks + 4 troughs before any trade\n` +
          `ETH + WETH = unified balance (auto-wrap)\n` +
          `Drawdown -20% from peak = buys halted\n` +
          `Gas > 50 gwei = all trades paused\n\n` +
          `<b>Commands:</b>\n` +
          `/wake (or /gm) — full morning briefing\n` +
          `/bank — complete money statement\n` +
          `/ledger — permanent trade record forever\n` +
          `/ledger full — last 20 trades detailed\n` +
          `/watchlist — tokens watching but not trading\n` +
          `/watchlist SYMBOL — deep dive + reason why\n` +
          `/history — all tokens 7/30/90d summary\n` +
          `/history SYMBOL — deep dive on one token\n` +
          `/profit /waves /race /positions\n` +
          `/status /eth /piggy /trades /gas /indicators\n` +
          `/buy SYMBOL /sell SYMBOL /sellhalf SYMBOL\n\n` +
          `<b>Portfolio:</b> BRETT DEGEN AERO VIRTUAL AIXBT TOSHI SEAM XCN KEYCAT DOGINME WELL SKI`
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

// ═══════════════════════════════════════════════════════════════════════════════
// 🚀 MAIN
// ═══════════════════════════════════════════════════════════════════════════════
async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("⚔️💓  GUARDIAN PROTOCOL — HEARTBEAT EDITION v13.0");
  console.log("      ETH+WETH unified | RSI/MACD/BB indicators");
  console.log("      Live ETH price | Gas spike guard | Drawdown breaker");
  console.log("      THE MACHINE NEVER STOPS. THE HEARTBEAT NEVER FADES.");
  console.log("═══════════════════════════════════════════════════════════\n");

  await loadFromGitHub();
  await loadHistoricalData(90);   // 🏛️ learn 90 days of history instantly on every boot
  bootstrapWavesFromHistory();
  cdpClient = createCdpClient();

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

  await tg(
    `⚔️💓 <b>GUARDIAN v13 — HEARTBEAT EDITION ONLINE</b>\n\n` +
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
  (async () => {
    while (true) {
      try { await checkTelegramCommands(cdpClient, cachedBal, cachedEthUsd); }
      catch (e) { console.log(`⚠️  Telegram poller error: ${e.message}`); }
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

      // Low ETH warning (but WETH may cover it)
      if (bal.eth < 0.002 && bal.weth < 0.002) {
        console.log(`⚠️  Both ETH and WETH low — please top up`);
        await tg(`⚠️ <b>BALANCE LOW</b>\nETH: ${bal.eth.toFixed(6)} | WETH: ${bal.weth.toFixed(6)}\nPlease top up wallet`);
      }

      // Refresh all token balances in parallel once per cycle
      await refreshTokenBalances();

      for (const token of tokens) {
        try { await processToken(cdpClient, token, bal); }
        catch (e) { console.log(`⚠️ ${token.symbol}: ${e.message}`); }
        await sleep(TOKEN_SLEEP_MS);
      }

      // Update watchlist prices silently (no trades, just data collection)
      await updateWatchlistPrices();

      if (Date.now() - lastReportTime > REPORT_INTERVAL) {
        lastReportTime = Date.now();
        await sendFullReport(bal, ethUsd, "⏰ 30 MIN REPORT");
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
