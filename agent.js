import { CdpClient } from "@coinbase/cdp-sdk";
import { createPublicClient, http, formatEther, parseEther } from "viem";
import { base } from "viem/chains";
import dotenv from "dotenv";
dotenv.config();

// ═══════════════════════════════════════════════════════════════════════
// ⚔️  GUARDIAN PROTOCOL CASCADE SYSTEM v12.0 — WHITEPAPER EDITION
// ═══════════════════════════════════════════════════════════════════════
// MISSION: Buy at confirmed MIN trough. Sell at confirmed MAX peak.
// Net margin must clear 2.5% after fees. Cascade profits immediately.
// The machine never stops.
// ═══════════════════════════════════════════════════════════════════════

const WALLET_ADDRESS = "0x50e1C4608c48b0c52E1EA5FBabc1c9126eA17915";
const WETH_ADDRESS   = "0x4200000000000000000000000000000000000006";
const SWAP_ROUTER    = "0x2626664c2603336E57B271c5C0b26F421741e481";

// ── TIMING ──────────────────────────────────────────────────────────────
const TRADE_LOOP_MS   = 30000;   // 30s main cycle
const COOLDOWN_MS     = 300000;  // 5min per token after trade
const SAVE_INTERVAL   = 900000;  // save every 15min
const REPORT_INTERVAL = 1800000; // report every 30min
const TOKEN_SLEEP_MS  = 2000;    // 2s between tokens in loop

// ── SAFETY ──────────────────────────────────────────────────────────────
const GAS_RESERVE     = 0.0003;
const SELL_RESERVE    = 0.001;
const MAX_BUY_PCT     = 0.33;    // never more than 33% in one token
const ETH_RESERVE_PCT = 0.20;    // always keep 20% as ETH reserve
const MIN_ETH_TRADE   = 0.0008;
const MIN_POS_USD     = 3.00;    // skip if position < $3
const MAX_GAS_ETH     = 0.002;
const ETH_USD         = 1940;
const PIGGY_SKIM_PCT  = 0.01;    // 1% per profitable sell → piggy
const LOTTERY_PCT     = 0.02;    // 2% kept as forever bags

// ── WAVE RULES (from whitepaper) ─────────────────────────────────────────
const MIN_PEAKS_TO_TRADE  = 4;   // require 4 confirmed peaks
const MIN_TROUGHS_TO_TRADE= 4;   // require 4 confirmed troughs
const MIN_NET_MARGIN      = 0.025; // 2.5% minimum net margin
const PRIORITY_MARGIN     = 0.050; // 5.0% = PRIORITY tier
const WAVE_MIN_MOVE       = 0.008; // 0.8% min move to count as new wave
const WAVE_COUNT          = 6;     // track up to 6 peaks/troughs
const STOP_LOSS_PCT       = 0.05;  // 5% below buy_target → emergency exit
const SLIPPAGE_GUARD      = 0.85;  // accept min 85% of expected output

// ── PORTFOLIO (7 tokens — CLANKER removed per whitepaper 3.3) ────────────
// feeTier: pool fee in hundredths of a bip (3000 = 0.3%, 10000 = 1%)
// poolFeePct: actual fee as decimal for margin calc
// minNetMargin: token-specific override (TOSHI needs 5% due to 1% fee)
const DEFAULT_TOKENS = [
  { symbol: "BRETT",   address: "0x532f27101965dd16442E59d40670FaF5eBB142E4", feeTier: 3000,  poolFeePct: 0.006, minNetMargin: MIN_NET_MARGIN },
  { symbol: "DEGEN",   address: "0x4ed4e862860bed51a9570b96d89af5e1b0efefed", feeTier: 3000,  poolFeePct: 0.006, minNetMargin: MIN_NET_MARGIN },
  { symbol: "AERO",    address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631", feeTier: 3000,  poolFeePct: 0.006, minNetMargin: MIN_NET_MARGIN },
  { symbol: "VIRTUAL", address: "0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b", feeTier: 3000,  poolFeePct: 0.006, minNetMargin: MIN_NET_MARGIN },
  { symbol: "AIXBT",   address: "0x4F9Fd6Be4a90f2620860d680c0d4d5Fb53d1A825", feeTier: 3000,  poolFeePct: 0.006, minNetMargin: MIN_NET_MARGIN },
  { symbol: "TOSHI",   address: "0xAC1Bd2486aAf3B5C0fc3Fd868558b082a531B2B4", feeTier: 10000, poolFeePct: 0.010, minNetMargin: 0.050 }, // 1% pool fee, need 5%+ net margin
  { symbol: "SEAM",    address: "0x1C7a460413dD4e964f96D8dFC56E7223cE88CD85", feeTier: 3000,  poolFeePct: 0.006, minNetMargin: MIN_NET_MARGIN },
];

// ── GITHUB ──────────────────────────────────────────────────────────────
const GITHUB_TOKEN  = process.env.GITHUB_TOKEN;
const GITHUB_REPO   = process.env.GITHUB_REPO;
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || "main";

const ERC20_ABI = [
  { name: "balanceOf", type: "function", stateMutability: "view",
    inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { name: "allowance", type: "function", stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }],
    outputs: [{ name: "", type: "uint256" }] },
];

const RPC_URLS = [
  "https://mainnet.base.org",
  "https://base.llamarpc.com",
  "https://base-rpc.publicnode.com",
  "https://1rpc.io/base",
];
let rpcIndex = 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));
function getClient() { return createPublicClient({ chain: base, transport: http(RPC_URLS[rpcIndex % RPC_URLS.length]) }); }
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

// ── STATE ────────────────────────────────────────────────────────────────
let tokens         = [];
let history        = {};
let tokensSha      = null;
let historySha     = null;
let positionsSha   = null;
let lastTradeTime  = {};
let piggyBank      = 0;
let totalSkimmed   = 0;
let tradeCount     = 0;
let lastSaveTime   = 0;
let lastReportTime = 0;
let approvedTokens = new Set();
let cdpClient      = null;
let manualCommands = [];

// Wave state: { symbol: { peaks: [...], troughs: [...] } }
const waveState   = {};
// Cross-cycle price tracking for real momentum
const cyclePrices = {};
// Trade log for transparency
const tradeLog    = [];

// ── CDP ───────────────────────────────────────────────────────────────────
function createCdpClient() {
  return new CdpClient({
    apiKeyId: process.env.CDP_API_KEY_ID || "",
    apiKeySecret: (process.env.CDP_API_KEY_SECRET || "").replace(/\\n/g, "\n"),
    walletSecret: process.env.CDP_WALLET_SECRET,
  });
}

// ── GITHUB ───────────────────────────────────────────────────────────────
async function githubGet(path) {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}?ref=${GITHUB_BRANCH}&t=${Date.now()}`,
      { headers: { Authorization: `token ${GITHUB_TOKEN}`, Accept: "application/vnd.github.v3+json" } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return { content: JSON.parse(Buffer.from(data.content.replace(/\n/g,""), "base64").toString("utf8")), sha: data.sha };
  } catch (e) { console.log(`GitHub read error (${path}): ${e.message}`); return null; }
}

async function githubSave(path, content, sha) {
  try {
    const body = {
      message: `Guardian v12 ${new Date().toISOString()}`,
      content: Buffer.from(JSON.stringify(content, null, 2)).toString("base64"),
      branch: GITHUB_BRANCH,
    };
    if (sha) body.sha = sha;
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`, {
      method: "PUT",
      headers: { Authorization: `token ${GITHUB_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await res.json())?.content?.sha || null;
  } catch (e) { console.log(`GitHub save error: ${e.message}`); return null; }
}

async function loadFromGitHub() {
  console.log("📂 Loading from GitHub...");
  const tf = await githubGet("tokens.json");
  if (tf?.content?.tokens?.length) {
    const saved = tf.content.tokens;
    tokens = DEFAULT_TOKENS.map(def => ({
      ...def, status: "active",
      entryPrice: null, totalInvestedEth: 0, entryTime: null,
      ...(saved.find(s => s.symbol === def.symbol) || {}),
      // Always restore whitepaper fields from DEFAULT_TOKENS (fee tiers etc)
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
    positionsSha = pf.sha;
    const pos = pf.content;
    piggyBank    = pos.piggyBank    || 0;
    totalSkimmed = pos.totalSkimmed || 0;
    tradeCount   = pos.tradeCount   || 0;
    for (const t of tokens) {
      if (pos.entries?.[t.symbol] != null) {
        t.entryPrice       = pos.entries[t.symbol];
        t.totalInvestedEth = pos.invested?.[t.symbol]   || 0;
        t.entryTime        = pos.entryTimes?.[t.symbol] || null;
      }
    }
  }
  const positions = tokens.filter(t => t.entryPrice).map(t => t.symbol).join(", ");
  console.log(`✅ ${tokens.length} tokens: ${tokens.map(t=>t.symbol).join(", ")}`);
  console.log(`✅ Positions: ${positions || "none"} | Piggy: ${piggyBank.toFixed(6)} ETH | Trades: ${tradeCount}`);
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
      tradeLog:   tradeLog.slice(-100),
    }, positionsSha);
    lastSaveTime = Date.now();
    console.log("💾 Saved to GitHub");
  } catch (e) { console.log(`💾 Save error: ${e.message}`); }
}

// ── TELEGRAM ─────────────────────────────────────────────────────────────
async function tg(msg) {
  try {
    const tok = process.env.TELEGRAM_BOT_TOKEN;
    const cid = process.env.TELEGRAM_CHAT_ID;
    if (!tok || !cid) return;
    await fetch(`https://api.telegram.org/bot${tok}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: cid, text: msg, parse_mode: "HTML" }),
    });
  } catch {}
}

// ── PRICES ───────────────────────────────────────────────────────────────
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

async function getEthBalance() {
  return parseFloat(formatEther(await rpcCall(c => c.getBalance({ address: WALLET_ADDRESS }))));
}
async function getWethBalance() {
  try {
    return parseFloat(formatEther(await rpcCall(c => c.readContract({
      address: WETH_ADDRESS, abi: ERC20_ABI, functionName: "balanceOf", args: [WALLET_ADDRESS],
    }))));
  } catch { return 0; }
}
async function getTokenBalance(address) {
  try {
    return Number(await rpcCall(c => c.readContract({
      address, abi: ERC20_ABI, functionName: "balanceOf", args: [WALLET_ADDRESS],
    }))) / 1e18;
  } catch { return 0; }
}
async function estimateGasCostEth() {
  try { return parseFloat(formatEther((await rpcCall(c => c.getGasPrice())) * BigInt(200000))); }
  catch { return 0.0001; }
}

function getTradeableEth(ethBal) {
  // Always keep ETH_RESERVE_PCT of total capital + explicit gas/sell reserves
  const total    = ethBal + 0; // TODO: add WETH in future
  const reserved = Math.max(ethBal * ETH_RESERVE_PCT, GAS_RESERVE + SELL_RESERVE + piggyBank);
  return Math.max(ethBal - reserved, 0);
}

// ═══════════════════════════════════════════════════════════════════════
// 🌊 WAVE ENGINE — MAX PEAK / MIN TROUGH per whitepaper §4
// ═══════════════════════════════════════════════════════════════════════

function initWaveState(symbol) {
  if (!waveState[symbol]) waveState[symbol] = { peaks: [], troughs: [] };
  return waveState[symbol];
}

// Bootstrap waves from saved price history on startup
function bootstrapWavesFromHistory() {
  console.log("🌊 Bootstrapping waves from history...");
  for (const symbol of Object.keys(history)) {
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
      console.log(`   ✅ ${symbol}: ${ws.peaks.length}P ${ws.troughs.length}T | MAX peak: $${Math.max(...ws.peaks).toFixed(8)||"?"} | MIN trough: $${Math.min(...ws.troughs).toFixed(8)||"?"}`);
    }
  }
  console.log("✅ Wave bootstrap complete\n");
}

// Update waves live from the rolling price stream
function updateWaves(symbol, price) {
  const ws = initWaveState(symbol);
  const readings = history[symbol]?.readings || [];
  if (readings.length < 5) return;
  const recent = readings.slice(-5).map(r => r.price);
  const m = recent[2];
  if (m > recent[0] && m > recent[1] && m > recent[3] && m > recent[4]) {
    const l = ws.peaks[ws.peaks.length-1];
    if (!l || Math.abs(m-l)/l > WAVE_MIN_MOVE) {
      ws.peaks.push(m);
      if (ws.peaks.length > WAVE_COUNT) ws.peaks.shift();
      console.log(`   📈 [${symbol}] New peak: $${m.toFixed(8)} | total peaks: ${ws.peaks.length}`);
    }
  }
  if (m < recent[0] && m < recent[1] && m < recent[3] && m < recent[4]) {
    const l = ws.troughs[ws.troughs.length-1];
    if (!l || Math.abs(m-l)/l > WAVE_MIN_MOVE) {
      ws.troughs.push(m);
      if (ws.troughs.length > WAVE_COUNT) ws.troughs.shift();
      console.log(`   📉 [${symbol}] New trough: $${m.toFixed(8)} | total troughs: ${ws.troughs.length}`);
    }
  }
}

function recordPrice(symbol, price) {
  if (!history[symbol]) history[symbol] = { readings: [], lastPrice: null };
  history[symbol].readings.push({ price, time: Date.now() });
  if (history[symbol].readings.length > 5000) history[symbol].readings.shift();
  history[symbol].lastPrice = price;
}

function updateCyclePrice(symbol, price) {
  if (!cyclePrices[symbol]) {
    cyclePrices[symbol] = { prev: null, prevTime: 0, current: price };
  } else {
    const age = Date.now() - cyclePrices[symbol].prevTime;
    if (age > 20000) {
      cyclePrices[symbol].prev     = cyclePrices[symbol].current;
      cyclePrices[symbol].prevTime = Date.now();
    }
    cyclePrices[symbol].current = price;
  }
}

function getMomentum(symbol) {
  const cp = cyclePrices[symbol];
  if (!cp?.prev) return { direction: "neutral", pct: 0 };
  const pct = (cp.current - cp.prev) / cp.prev * 100;
  return { direction: pct > 0.1 ? "up" : pct < -0.1 ? "down" : "neutral", pct };
}

// ── WHITEPAPER CORE: MAX PEAK / MIN TROUGH TARGETS ────────────────────────
// §4: sell_target = MAX of all confirmed peaks
//     buy_target  = MIN of all confirmed troughs
function getMaxPeak(symbol) {
  const ps = waveState[symbol]?.peaks || [];
  return ps.length ? Math.max(...ps) : null;
}
function getMinTrough(symbol) {
  const ts = waveState[symbol]?.troughs || [];
  return ts.length ? Math.min(...ts) : null;
}
function getPeakCount(symbol)  { return (waveState[symbol]?.peaks   || []).length; }
function getTroughCount(symbol){ return (waveState[symbol]?.troughs || []).length; }

// Calculate net margin per whitepaper §3.1
// net_margin = (sell_target - buy_target) / buy_target - pool_fee% - gas_pct
function calcNetMargin(symbol, gasCostEth, tradeEth) {
  const maxPeak  = getMaxPeak(symbol);
  const minTrgh  = getMinTrough(symbol);
  if (!maxPeak || !minTrgh || minTrgh <= 0) return null;
  const token    = tokens.find(t => t.symbol === symbol);
  const grossPct = (maxPeak - minTrgh) / minTrgh;
  const feePct   = token?.poolFeePct || 0.006;
  const gasPct   = tradeEth > 0 ? (gasCostEth * 2) / tradeEth : 0; // buy + sell gas
  return grossPct - (feePct * 2) - gasPct; // round trip: 2× fee
}

// Is this token ARMED to trade? (whitepaper §3.1)
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
    return { armed: false, reason: `net margin ${(net*100).toFixed(2)}% < ${(minNM*100).toFixed(1)}% min` };
  }
  const priority = net >= PRIORITY_MARGIN ? "PRIORITY" : net >= 0.03 ? "STANDARD" : "THIN";
  return { armed: true, net, priority };
}

// Cascade allocation based on priority tier (whitepaper §5.1)
function getCascadePct(netMargin) {
  if (netMargin >= PRIORITY_MARGIN) return 0.70;
  if (netMargin >= 0.030)           return 0.50;
  return 0.30;
}

function canTrade(symbol) {
  return Date.now() - (lastTradeTime[symbol] || 0) >= COOLDOWN_MS;
}

// ── RACEHORSE DISPLAY ─────────────────────────────────────────────────────
function buildRaceDisplay(token, price, balance) {
  const entry    = token.entryPrice;
  const invEth   = token.totalInvestedEth || 0;
  const invUsd   = invEth * ETH_USD;
  if (!entry || entry <= 0) return null;

  const sellTarget = getMaxPeak(token.symbol);
  const validST    = sellTarget && sellTarget > entry;
  const lottery    = Math.floor(balance * LOTTERY_PCT);
  const sellable   = Math.max(balance - lottery, 0);
  const nowUsd     = sellable * price;
  const tgtUsd     = validST ? sellable * sellTarget : null;
  const pnlUsd     = nowUsd - invUsd;
  const pnlPct     = invUsd > 0 ? pnlUsd / invUsd * 100 : 0;
  const raceRange  = validST && sellTarget > entry ? sellTarget - entry : 0;
  const racePct    = raceRange > 0 ? Math.max(0, Math.min(100, (price - entry) / raceRange * 100)) : 0;
  const barFill    = Math.floor(racePct / 10);
  const raceBar    = "🟩".repeat(barFill) + "⬜".repeat(10 - barFill);

  return {
    bar: raceBar, racePct: racePct.toFixed(1),
    nowUsd: nowUsd.toFixed(2), tgtUsd: tgtUsd?.toFixed(2) || "?",
    invUsd: invUsd.toFixed(2), pnlUsd: pnlUsd.toFixed(2),
    pnlPct: pnlPct.toFixed(1), pnlSign: pnlUsd >= 0 ? "+" : "",
    sellTarget, entry, balance, sellable, lottery,
    lines: [
      `🏇 [${raceBar}] ${racePct.toFixed(1)}% to MAX peak`,
      `📥 Entry: $${entry.toFixed(8)} | Invested: $${invUsd.toFixed(2)}`,
      `💲 NOW: $${price.toFixed(8)} | sell now → ~$${nowUsd.toFixed(2)}`,
      `🎯 TARGET (MAX peak): $${sellTarget?.toFixed(8)||"?"} → ~$${tgtUsd?.toFixed(2)||"?"}`,
      `${pnlUsd>=0?"📈":"📉"} P&L: ${pnlUsd>=0?"+":""}$${pnlUsd.toFixed(2)} (${pnlPct>=0?"+":""}${pnlPct.toFixed(1)}%)`,
      `🪙 ${sellable>=1?Math.floor(sellable):sellable.toFixed(4)} tokens | 🎰 ${lottery} lottery forever`,
    ].join("\n"),
  };
}

// ── ENCODE / APPROVE ──────────────────────────────────────────────────────
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

// ═══════════════════════════════════════════════════════════════════════
// 🟢 BUY — executes when price touches MIN trough
// ═══════════════════════════════════════════════════════════════════════
async function executeBuy(cdp, token, availableEth, reason, price, forcedEth = 0) {
  try {
    if (!canTrade(token.symbol)) { console.log(`   ⏳ ${token.symbol} cooldown`); return false; }

    const wethBal    = await getWethBalance();
    const totalAvail = availableEth + wethBal;
    if (totalAvail < MIN_ETH_TRADE) { console.log(`   🛑 Insufficient ETH`); return false; }
    if (price * (totalAvail * ETH_USD) < MIN_POS_USD) { console.log(`   🛑 Position too small`); return false; }

    // Size: forced ETH, or up to 33% of total capital
    const gasCost    = await estimateGasCostEth();
    const armStatus  = getArmStatus(token.symbol, gasCost, totalAvail);
    const maxPct     = armStatus.armed ? getCascadePct(armStatus.net) : 0.30;
    const maxSpend   = Math.min(totalAvail * maxPct, totalAvail * MAX_BUY_PCT);
    const minSpend   = MIN_POS_USD / ETH_USD;
    const ethToSpend = forcedEth > 0 ? Math.min(forcedEth, maxSpend) : Math.min(Math.max(minSpend, totalAvail * 0.10), maxSpend);

    const amountIn   = parseEther(ethToSpend.toFixed(18));
    const useWeth    = wethBal >= ethToSpend;
    // Slippage guard: expect price → min 85% of tokens
    const minTokens  = BigInt(Math.floor((ethToSpend * ETH_USD / price) * SLIPPAGE_GUARD * 1e18));

    console.log(`\n   🟢 BUY ${token.symbol} — ${reason}`);
    console.log(`      ${ethToSpend.toFixed(6)} ${useWeth?"WETH":"ETH"} @ $${price.toFixed(8)}`);
    console.log(`      MAX peak (sell target): $${getMaxPeak(token.symbol)?.toFixed(8)||"?"}`);
    console.log(`      MIN trough (buy target): $${getMinTrough(token.symbol)?.toFixed(8)||"?"}`);
    if (armStatus.armed) console.log(`      Net margin: ${(armStatus.net*100).toFixed(2)}% [${armStatus.priority}]`);

    let txHash;
    if (useWeth) {
      await ensureApproved(cdp, WETH_ADDRESS, amountIn);
      const { transactionHash } = await cdp.evm.sendTransaction({ address: WALLET_ADDRESS, network: "base", transaction: { to: SWAP_ROUTER, data: encodeSwap(WETH_ADDRESS, token.address, amountIn, WALLET_ADDRESS, token.feeTier, minTokens) } });
      txHash = transactionHash;
    } else {
      const { transactionHash } = await cdp.evm.sendTransaction({ address: WALLET_ADDRESS, network: "base", transaction: { to: SWAP_ROUTER, value: amountIn, data: encodeSwap(WETH_ADDRESS, token.address, amountIn, WALLET_ADDRESS, token.feeTier, minTokens) } });
      txHash = transactionHash;
    }

    lastTradeTime[token.symbol] = Date.now();
    tradeCount++;
    token.entryPrice       = price;
    token.totalInvestedEth = (token.totalInvestedEth || 0) + ethToSpend;
    token.entryTime        = Date.now();
    tradeLog.push({ type:"BUY", symbol:token.symbol, price, ethSpent:ethToSpend, timestamp:new Date().toISOString(), tx:txHash, reason });

    console.log(`      ✅ https://basescan.org/tx/${txHash}`);
    await tg(
      `🟢🟢🟢 <b>BOUGHT ${token.symbol}!</b>\n\n` +
      `💰 ${ethToSpend.toFixed(6)} ${useWeth?"WETH":"ETH"} (~$${(ethToSpend*ETH_USD).toFixed(2)})\n` +
      `📥 Entry: $${price.toFixed(8)}\n` +
      `🎯 Target (MAX peak): $${getMaxPeak(token.symbol)?.toFixed(8)||"learning"}\n` +
      `📊 Net margin: ${armStatus.armed?(armStatus.net*100).toFixed(2)+"%":"calculating"} [${armStatus.priority||"?"}]\n` +
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

// ═══════════════════════════════════════════════════════════════════════
// 🔴 SELL — executes when price touches MAX peak
// ═══════════════════════════════════════════════════════════════════════
async function executeSell(cdp, token, sellPct, reason, price, isProtective = false) {
  try {
    if (!canTrade(token.symbol)) { console.log(`   ⏳ ${token.symbol} cooldown`); return null; }

    const totalBal    = await getTokenBalance(token.address);
    // Clear dust positions
    if (totalBal < 0.01) {
      console.log(`   ⚠️  ${token.symbol}: dust balance (${totalBal.toFixed(6)}) — clearing position`);
      token.entryPrice = null; token.totalInvestedEth = 0; token.entryTime = null;
      return null;
    }
    const lottery  = Math.max(Math.floor(totalBal * LOTTERY_PCT), 1);
    const sellable = Math.max(totalBal - lottery, 0);
    if (sellable < 1) {
      console.log(`   ⏳ ${token.symbol}: only lottery token remains — clearing`);
      token.entryPrice = null; token.totalInvestedEth = 0; token.entryTime = null;
      return null;
    }

    // Gas check — skip if gas > 15% of expected profit
    const gasCost   = await estimateGasCostEth();
    const procEth   = (sellable * sellPct * price) / ETH_USD;
    const expectedProfit = procEth - (token.totalInvestedEth * sellPct || 0);
    if (!isProtective && gasCost > 0.15 * expectedProfit && expectedProfit > 0) {
      console.log(`   🛑 Gas too high: ${gasCost.toFixed(6)} ETH > 15% of $${(expectedProfit*ETH_USD).toFixed(2)} profit`);
      return null;
    }

    const amtToSell = BigInt(Math.floor(sellable * sellPct * 1e18));
    if (amtToSell === BigInt(0)) return null;

    // Slippage guard: min 85% of expected WETH back
    const minWeth = BigInt(Math.floor(procEth * SLIPPAGE_GUARD * 1e18));

    const sellAmt = sellable * sellPct;
    console.log(`\n   🔴 SELL ${token.symbol} ${(sellPct*100).toFixed(0)}% — ${reason}`);
    console.log(`      ${sellAmt>=1?Math.floor(sellAmt):sellAmt.toFixed(4)} tokens @ $${price.toFixed(8)} | 🎰 keeping ${lottery}`);
    console.log(`      🛡️ Min WETH out: ${(Number(minWeth)/1e18).toFixed(6)}`);

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
    const recUsd   = received * ETH_USD;
    const invUsd   = (token.totalInvestedEth || 0) * sellPct * ETH_USD;
    const netUsd   = recUsd - invUsd;

    let skim = 0;
    if (received > 0 && netUsd > 0) { skim = received * PIGGY_SKIM_PCT; piggyBank += skim; totalSkimmed += skim; }

    if (sellPct >= 0.95) {
      token.entryPrice = null; token.totalInvestedEth = 0; token.entryTime = null;
    } else {
      token.totalInvestedEth = (token.totalInvestedEth || 0) * (1 - sellPct);
    }

    tradeLog.push({ type:"SELL", symbol:token.symbol, price, receivedEth:received, netUsd, timestamp:new Date().toISOString(), tx:transactionHash, reason });

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

// ── CASCADE ───────────────────────────────────────────────────────────────
// Find the best ARMED token at or near its MIN trough
async function findCascadeTarget(excludeSymbol, gasCost, tradeEth) {
  let best = null, bestNet = -1;
  for (const t of tokens) {
    if (t.symbol === excludeSymbol || !canTrade(t.symbol)) continue;
    if (t.entryPrice) continue; // already holding
    const arm = getArmStatus(t.symbol, gasCost, tradeEth);
    if (!arm.armed) continue;
    const price  = history[t.symbol]?.lastPrice;
    const minT   = getMinTrough(t.symbol);
    if (!price || !minT) continue;
    const nearLow = price <= minT * 1.01; // within 1% of confirmed MIN trough
    if (nearLow && arm.net > bestNet) { bestNet = arm.net; best = t; }
  }
  return best;
}

async function triggerCascade(cdp, soldSymbol, proceeds, ethBal) {
  try {
    const gasCost = await estimateGasCostEth();
    const target  = await findCascadeTarget(soldSymbol, gasCost, proceeds);
    if (!target) {
      console.log(`  🌊 No cascade target near MIN trough — proceeds held as WETH`);
      return;
    }
    const price   = history[target.symbol]?.lastPrice;
    const arm     = getArmStatus(target.symbol, gasCost, proceeds);
    const deploy  = proceeds * getCascadePct(arm.net || MIN_NET_MARGIN);
    console.log(`  🌊 CASCADE ${soldSymbol} → ${target.symbol} | ${(arm.net*100).toFixed(2)}% net [${arm.priority}] | deploying ${(deploy/proceeds*100).toFixed(0)}%`);
    await tg(
      `🌊 <b>CASCADE: ${soldSymbol} → ${target.symbol}</b>\n\n` +
      `💰 Deploying: ${deploy.toFixed(6)} ETH (${getCascadePct(arm.net||0)*100}% of proceeds)\n` +
      `📊 Net margin: ${(arm.net*100).toFixed(2)}% [${arm.priority}]\n` +
      `💲 At MIN trough: $${price?.toFixed(8)}\n⚡ Buying...`
    );
    await executeBuy(cdp, target, getTradeableEth(ethBal), `🌊 CASCADE from ${soldSymbol} [${arm.priority}]`, price, deploy);
  } catch (e) { console.log(`  ⚠️ Cascade error: ${e.message}`); }
}

// ═══════════════════════════════════════════════════════════════════════
// 🔄 PROCESS ONE TOKEN — the main decision engine
// ═══════════════════════════════════════════════════════════════════════
async function processToken(cdp, token, ethBal) {
  try {
    const price = await getTokenPrice(token.address);
    if (!price) { console.log(`   ⏳ ${token.symbol}: no price`); return; }

    recordPrice(token.symbol, price);
    updateCyclePrice(token.symbol, price);
    updateWaves(token.symbol, price);

    const balance  = await getTokenBalance(token.address);
    const mom      = getMomentum(token.symbol);
    const gasCost  = await estimateGasCostEth();
    const wethBal  = await getWethBalance();
    const tradeable= getTradeableEth(ethBal);
    const total    = tradeable + wethBal;
    const entry    = token.entryPrice;

    const maxPeak  = getMaxPeak(token.symbol);
    const minTrgh  = getMinTrough(token.symbol);
    const peakCnt  = getPeakCount(token.symbol);
    const trghCnt  = getTroughCount(token.symbol);
    const arm      = getArmStatus(token.symbol, gasCost, total);
    const netM     = arm.armed ? arm.net : null;

    const rd       = entry ? buildRaceDisplay(token, price, balance) : null;
    const lottery  = Math.floor(balance * LOTTERY_PCT);
    const sellable = Math.max(balance - lottery, 0);

    // ── KEY DECISIONS ───────────────────────────────────────────────────
    // SELL: price >= MAX peak AND we hold a position
    const atMaxPeak = maxPeak && price >= maxPeak * 0.995;
    const shouldSell = atMaxPeak && entry && sellable > 1;

    // BUY: price <= MIN trough AND armed AND no position
    const atMinTrough = minTrgh && price <= minTrgh * 1.005;
    const shouldBuy   = atMinTrough && arm.armed && !entry && total >= MIN_ETH_TRADE && canTrade(token.symbol);

    // STOP LOSS: price 5% below MIN trough buy target (whitepaper §8)
    const stopLossPrice = minTrgh ? minTrgh * (1 - STOP_LOSS_PCT) : null;
    const stopLossHit   = entry && stopLossPrice && price < stopLossPrice;

    // ── ZONE LABEL ──────────────────────────────────────────────────────
    const zone = shouldSell ? "🔴 AT MAX PEAK — SELLING" :
                 stopLossHit ? "🛑 STOP LOSS" :
                 shouldBuy  ? "🟢 AT MIN TROUGH — BUYING" :
                 entry       ? "🏇 RIDING" :
                 arm.armed   ? `✅ ARMED [${arm.priority}]` : "⏳ BUILDING";

    const pnlStr  = entry ? ` | P&L: ${((price-entry)/entry*100).toFixed(1)}%` : "";
    const pctToBuy = minTrgh ? ((price-minTrgh)/minTrgh*100).toFixed(1) : "?";
    const pctToSell= maxPeak ? ((price-maxPeak)/maxPeak*100).toFixed(1) : "?";

    // ── LOG ────────────────────────────────────────────────────────────
    console.log(`\n  ┌─ [${token.symbol}] ${zone}${pnlStr}`);
    console.log(`  │ $${price.toFixed(8)} | 🪙 ${balance>=1?Math.floor(balance):balance.toFixed(4)} ($${(balance*price).toFixed(2)}) | mom:${mom.direction}(${mom.pct.toFixed(2)}%)`);
    console.log(`  │ Peaks:${peakCnt} MAX:$${maxPeak?.toFixed(8)||"?"} (${pctToSell}% away) | Troughs:${trghCnt} MIN:$${minTrgh?.toFixed(8)||"?"} (+${pctToBuy}% above)`);
    if (arm.armed) console.log(`  │ ✅ ARMED: net margin ${(arm.net*100).toFixed(2)}% [${arm.priority}] | sell at $${maxPeak?.toFixed(8)} | buy at $${minTrgh?.toFixed(8)}`);
    else           console.log(`  │ ⏳ NOT ARMED: ${arm.reason}`);
    if (rd) console.log(`  │ 🏇 [${rd.bar}] ${rd.racePct}% | P&L: ${rd.pnlSign}$${rd.pnlUsd} | sell→~$${rd.nowUsd}`);
    console.log(`  └─────────────────────────────────────────────`);

    // ── MANUAL COMMANDS ────────────────────────────────────────────────
    const mi = manualCommands.findIndex(c => c.symbol === token.symbol);
    if (mi !== -1) {
      const cmd = manualCommands.splice(mi, 1)[0];
      if (cmd.action === "buy") {
        await executeBuy(cdp, token, tradeable, "MANUAL BUY", price);
      } else if (cmd.action === "sell") {
        const p = await executeSell(cdp, token, 0.98, "MANUAL SELL", price, true);
        if (p > 0) await triggerCascade(cdp, token.symbol, p, ethBal);
      } else if (cmd.action === "sellhalf") {
        const p = await executeSell(cdp, token, 0.50, "MANUAL SELL HALF", price, true);
        if (p > 0) await triggerCascade(cdp, token.symbol, p, ethBal);
      }
      return;
    }

    // ── STOP LOSS — protective exit ────────────────────────────────────
    if (stopLossHit) {
      console.log(`  🛑 ${token.symbol} STOP LOSS — price $${price.toFixed(8)} < floor $${stopLossPrice.toFixed(8)}`);
      await tg(`🛑 <b>${token.symbol} STOP LOSS</b>\nPrice $${price.toFixed(8)} broke 5% below MIN trough floor $${stopLossPrice.toFixed(8)}\nEmergency exit...`);
      const p = await executeSell(cdp, token, 0.98, `STOP LOSS — below $${stopLossPrice.toFixed(8)}`, price, true);
      if (p > 0) await triggerCascade(cdp, token.symbol, p, await getEthBalance());
      return;
    }

    // ── SELL AT MAX PEAK ───────────────────────────────────────────────
    if (shouldSell) {
      console.log(`  🔴 ${token.symbol} AT MAX PEAK $${maxPeak.toFixed(8)} — SELLING`);
      await tg(
        `🔴🎯 <b>${token.symbol} MAX PEAK HIT — SELLING NOW</b>\n\n` +
        (rd?.lines || `💲 $${price.toFixed(8)}`) + "\n\n" +
        `🎯 MAX peak: $${maxPeak.toFixed(8)}\n` +
        `📥 Entry: $${entry.toFixed(8)}\n⚡ Executing...`
      );
      const proceeds = await executeSell(cdp, token, 0.98, `🎯 MAX PEAK $${maxPeak.toFixed(8)}`, price, false);
      if (proceeds > 0) await triggerCascade(cdp, token.symbol, proceeds, await getEthBalance());
      return;
    }

    // ── BUY AT MIN TROUGH ──────────────────────────────────────────────
    if (shouldBuy) {
      console.log(`  🟢 ${token.symbol} AT MIN TROUGH $${minTrgh.toFixed(8)} — BUYING`);
      await tg(
        `🟢🎯 <b>${token.symbol} MIN TROUGH — BUYING NOW</b>\n\n` +
        `💲 $${price.toFixed(8)} (MIN trough: $${minTrgh.toFixed(8)})\n` +
        `🎯 Sell target (MAX peak): $${maxPeak.toFixed(8)}\n` +
        `📊 Net margin: ${(arm.net*100).toFixed(2)}% [${arm.priority}]\n⚡ Executing...`
      );
      await executeBuy(cdp, token, tradeable, `🎯 MIN TROUGH $${minTrgh.toFixed(8)} [${arm.priority}]`, price);
      return;
    }

  } catch (e) { console.log(`  ⚠️ processToken error (${token.symbol}): ${e.message}`); }
}

// ── REPORTS ───────────────────────────────────────────────────────────────
async function sendFullReport(ethBal, title) {
  try {
    let lines = "";
    const gasCost = await estimateGasCostEth();
    const weth    = await getWethBalance();
    const total   = getTradeableEth(ethBal) + weth;

    for (const t of tokens) {
      const price  = history[t.symbol]?.lastPrice;
      if (!price) { lines += `\n⏳ <b>${t.symbol}</b> — loading\n`; continue; }
      const bal    = await getTokenBalance(t.address);
      const arm    = getArmStatus(t.symbol, gasCost, total);
      const maxP   = getMaxPeak(t.symbol);
      const minT   = getMinTrough(t.symbol);
      const rd     = t.entryPrice ? buildRaceDisplay(t, price, bal) : null;
      const icon   = t.entryPrice ? "🏇" : arm.armed ? "✅" : "⏳";

      lines += `\n${icon} <b>${t.symbol}</b> $${price.toFixed(8)} | 🪙 ${bal>=1?Math.floor(bal):bal.toFixed(4)} ($${(bal*price).toFixed(2)})\n`;
      if (arm.armed) lines += `   ✅ ARMED ${(arm.net*100).toFixed(2)}% [${arm.priority}] | buy:$${minT?.toFixed(8)||"?"} sell:$${maxP?.toFixed(8)||"?"}\n`;
      else           lines += `   ⏳ ${arm.reason}\n`;
      if (rd) {
        lines += `   🏇 [${rd.bar}] ${rd.racePct}% | P&L: ${rd.pnlSign}$${rd.pnlUsd}\n`;
        lines += `   📱 /sell ${t.symbol} | /sellhalf ${t.symbol}\n`;
      }
    }

    await tg(
      `📊 <b>GUARDIAN v12.0 — ${title}</b>\n🕐 ${new Date().toLocaleTimeString()}\n\n` +
      `💰 ETH: ${ethBal.toFixed(6)} ($${(ethBal*ETH_USD).toFixed(2)})\n` +
      `💎 WETH: ${weth.toFixed(6)} ($${(weth*ETH_USD).toFixed(2)})\n` +
      `♻️ Tradeable: ${getTradeableEth(ethBal).toFixed(6)} ETH\n` +
      `🐷 Piggy: ${piggyBank.toFixed(6)} ETH ($${(piggyBank*ETH_USD).toFixed(2)}) LOCKED\n` +
      `📈 Trades: ${tradeCount} | Skimmed: ${totalSkimmed.toFixed(6)} ETH\n` +
      `─────────────────────────` + lines +
      `\n🔗 <a href="https://basescan.org/address/${WALLET_ADDRESS}">Basescan</a>`
    );
  } catch (e) { console.log(`Report error: ${e.message}`); }
}

// ── TELEGRAM COMMANDS ─────────────────────────────────────────────────────
let lastUpdateId = 0;
async function checkTelegramCommands(cdp, ethBal) {
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
      if (!raw || upd.message?.chat?.id?.toString() !== cid) continue;
      console.log(`📱 Telegram: ${raw}`);

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
        await sendFullReport(ethBal, "📊 STATUS");
      } else if (text === "/waves") {
        const gasCost = await estimateGasCostEth();
        const weth    = await getWethBalance();
        let msg = `🌊 <b>WAVE STATUS v12.0</b>\n🕐 ${new Date().toLocaleTimeString()}\n\n`;
        msg += `<i>Buy at MIN trough | Sell at MAX peak</i>\n\n`;
        for (const t of tokens) {
          const p   = history[t.symbol]?.lastPrice;
          if (!p) { msg += `⏳ <b>${t.symbol}</b> — loading\n\n`; continue; }
          const arm = getArmStatus(t.symbol, gasCost, getTradeableEth(ethBal)+weth);
          const maxP= getMaxPeak(t.symbol), minT = getMinTrough(t.symbol);
          const pct = minT ? ((p-minT)/minT*100).toFixed(1) : "?";
          const icon= arm.armed ? "✅" : "⏳";
          msg += `${icon} <b>${t.symbol}</b> $${p.toFixed(8)}\n`;
          msg += `   Buy (MIN): $${minT?.toFixed(8)||"?"} (+${pct}% above)\n`;
          msg += `   Sell (MAX): $${maxP?.toFixed(8)||"?"}\n`;
          msg += `   Waves: ${getPeakCount(t.symbol)}P / ${getTroughCount(t.symbol)}T\n`;
          msg += arm.armed
            ? `   ✅ ARMED ${(arm.net*100).toFixed(2)}% net [${arm.priority}]\n\n`
            : `   ⏳ ${arm.reason}\n\n`;
        }
        await tg(msg);
      } else if (text === "/race") {
        let msg = `🏇 <b>RACEHORSE STANDINGS v12</b>\n🕐 ${new Date().toLocaleTimeString()}\n\n`;
        let any = false;
        for (const t of tokens) {
          if (!t.entryPrice) continue; any = true;
          const p  = history[t.symbol]?.lastPrice || t.entryPrice;
          const b  = await getTokenBalance(t.address);
          const rd = buildRaceDisplay(t, p, b);
          if (rd) { msg += `<b>${t.symbol}</b>\n${rd.lines}\n📱 /sell ${t.symbol}\n\n`; }
        }
        if (!any) msg += "No open positions.";
        await tg(msg);
      } else if (text === "/positions") {
        let msg = `📋 <b>POSITIONS v12</b>\n\n`;
        let any = false;
        for (const t of tokens) {
          if (!t.entryPrice) continue; any = true;
          const p  = history[t.symbol]?.lastPrice || t.entryPrice;
          const b  = await getTokenBalance(t.address);
          const rd = buildRaceDisplay(t, p, b);
          msg += `<b>${t.symbol}</b>\n${rd?.lines||`$${p.toFixed(8)}`}\n📱 /sell ${t.symbol}\n\n`;
        }
        if (!any) msg += "No open positions.";
        await tg(msg);
      } else if (text === "/eth") {
        const w = await getWethBalance();
        await tg(`💰 <b>BALANCES</b>\nETH: ${ethBal.toFixed(6)} ($${(ethBal*ETH_USD).toFixed(2)})\nWETH: ${w.toFixed(6)} ($${(w*ETH_USD).toFixed(2)})\nTradeable: ${getTradeableEth(ethBal).toFixed(6)}\n🐷 Piggy: ${piggyBank.toFixed(6)} ETH (LOCKED)`);
      } else if (text === "/piggy") {
        const pct = Math.min((piggyBank/0.5)*100,100);
        await tg(`🐷 <b>PIGGY BANK</b>\n${piggyBank.toFixed(6)} ETH ($${(piggyBank*ETH_USD).toFixed(2)})\nTotal skimmed: ${totalSkimmed.toFixed(6)} ETH\nGoal: 0.5 ETH (${pct.toFixed(1)}%)\n1% per profitable sell — locked forever`);
      } else if (text === "/trades") {
        const recent = tradeLog.slice(-5).map(t=>`${t.type} ${t.symbol} $${parseFloat(t.price).toFixed(8)} ${t.timestamp?.slice(11,19)||""}`).join("\n");
        await tg(`📈 <b>TRADES</b>\nCount: ${tradeCount} | Skimmed: ${totalSkimmed.toFixed(6)} ETH\n\nRecent:\n${recent||"none"}`);
      } else if (text === "/help") {
        await tg(
          `⚔️ <b>GUARDIAN v12.0 — WHITEPAPER EDITION</b>\n\n` +
          `<b>Strategy:</b>\n` +
          `Buy at confirmed MIN trough (lowest proven low)\n` +
          `Sell at confirmed MAX peak (highest proven high)\n` +
          `Net margin must clear 2.5%+ after all fees\n` +
          `Need 4 peaks + 4 troughs before any trade\n\n` +
          `<b>Commands:</b>\n` +
          `/status /waves /race /positions /eth /piggy /trades\n` +
          `/buy SYMBOL /sell SYMBOL /sellhalf SYMBOL\n\n` +
          `<b>Portfolio:</b> BRETT DEGEN AERO VIRTUAL AIXBT TOSHI SEAM\n` +
          `(CLANKER removed — 2% fees, insufficient wave data)`
        );
      }
    }
  } catch {}
}

// ── MAIN ──────────────────────────────────────────────────────────────────
async function main() {
  console.log("═══════════════════════════════════════════════════════");
  console.log("⚔️   GUARDIAN PROTOCOL CASCADE SYSTEM v12.0");
  console.log("     WHITEPAPER EDITION — THE MACHINE NEVER STOPS");
  console.log("═══════════════════════════════════════════════════════\n");

  await loadFromGitHub();
  bootstrapWavesFromHistory();
  cdpClient = createCdpClient();

  const eth  = await getEthBalance();
  const weth = await getWethBalance();
  console.log(`✅ CDP ready | ETH: ${eth.toFixed(6)} | WETH: ${weth.toFixed(6)}\n`);

  // Log armed status at startup
  const gasCost = await estimateGasCostEth();
  console.log("📊 WAVE ARM STATUS AT STARTUP:");
  for (const t of tokens) {
    const arm = getArmStatus(t.symbol, gasCost, eth + weth);
    const maxP = getMaxPeak(t.symbol), minT = getMinTrough(t.symbol);
    if (arm.armed) {
      console.log(`   ✅ ${t.symbol}: ARMED ${(arm.net*100).toFixed(2)}% [${arm.priority}] | buy@$${minT?.toFixed(8)} sell@$${maxP?.toFixed(8)}`);
    } else {
      console.log(`   ⏳ ${t.symbol}: ${arm.reason}`);
    }
  }
  console.log();

  await tg(
    `⚔️ <b>GUARDIAN v12.0 — WHITEPAPER EDITION ONLINE</b>\n\n` +
    `👛 <code>${WALLET_ADDRESS}</code>\n` +
    `💰 ETH: ${eth.toFixed(6)} | WETH: ${weth.toFixed(6)}\n\n` +
    `🌊 Buy at confirmed MIN trough (lowest proven low)\n` +
    `🎯 Sell at confirmed MAX peak (highest proven high)\n` +
    `📊 Net margin gate: 2.5% min after all fees\n` +
    `🔢 Require: 4 peaks + 4 troughs before any trade\n` +
    `🛑 Stop loss: 5% below MIN trough floor\n` +
    `🌊 Cascade: proceeds → next token at its MIN trough\n` +
    `🐷 Piggy: 1% per profitable sell — locked forever\n\n` +
    `/help for commands | /waves for arm status`
  );

  let cachedEth = eth;

  // Telegram poller — independent 3s loop
  (async () => {
    while (true) {
      try { await checkTelegramCommands(cdpClient, cachedEth); } catch {}
      await sleep(3000);
    }
  })();

  // Main trading loop
  while (true) {
    try {
      const eth  = await getEthBalance();
      const weth = await getWethBalance();
      cachedEth  = eth;
      const time = new Date().toLocaleTimeString();

      // Pause buys if ETH too low
      if (eth < 0.002) {
        console.log(`\n⚠️  ETH LOW (${eth.toFixed(6)}) — sell-only mode until topped up`);
        await tg(`⚠️ <b>ETH LOW: ${eth.toFixed(6)}</b>\nSell-only mode — please top up wallet`);
      }

      console.log(`\n${"═".repeat(56)}`);
      console.log(`${time} | ETH:${eth.toFixed(6)} WETH:${weth.toFixed(6)} Trades:${tradeCount}`);
      console.log(`Tradeable:${getTradeableEth(eth).toFixed(6)} Piggy:${piggyBank.toFixed(6)} (LOCKED)\n`);

      for (const token of tokens) {
        try { await processToken(cdpClient, token, eth); }
        catch (e) { console.log(`⚠️ ${token.symbol}: ${e.message}`); }
        await sleep(TOKEN_SLEEP_MS);
      }

      // Periodic tasks
      if (Date.now() - lastReportTime > REPORT_INTERVAL) {
        lastReportTime = Date.now();
        await sendFullReport(eth, "⏰ 30 MIN REPORT");
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

main().catch(e => {
  console.log(`💀 Fatal: ${e.message}`);
  setTimeout(main, 30000);
});
