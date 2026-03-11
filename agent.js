import { CdpClient } from "@coinbase/cdp-sdk";
import { createPublicClient, http, formatEther, parseEther } from "viem";
import { base } from "viem/chains";
import dotenv from "dotenv";
dotenv.config();

// ═══════════════════════════════════════════════════════════════════════
// ⚔️  GUARDIAN CASCADE SYSTEM v11.0 — 4-WAVE EDITION
// ═══════════════════════════════════════════════════════════════════════

const WALLET_ADDRESS = "0x50e1C4608c48b0c52E1EA5FBabc1c9126eA17915";
const WETH_ADDRESS   = "0x4200000000000000000000000000000000000006";
const SWAP_ROUTER    = "0x2626664c2603336E57B271c5C0b26F421741e481";

// ── TIMING ──────────────────────────────────────────────────────────────
const INTERVAL        = 30000;
const COOLDOWN_MS     = 300000;
const SAVE_INTERVAL   = 1800000;
const REPORT_INTERVAL = 1800000;
const STOP_LOSS_MS    = 7200000;

// ── SAFETY ──────────────────────────────────────────────────────────────
const GAS_RESERVE     = 0.0003;
const SELL_RESERVE    = 0.001;
const MAX_BUY_PCT     = 0.15;
const MIN_ETH_TRADE   = 0.0008;
const MIN_TRADE_USD   = 1.50;
const GAS_PROFIT_MULT = 4;
const MAX_GAS_ETH     = 0.002;
const ETH_USD         = 1940;
const PIGGY_SKIM_PCT  = 0.01;

// ── TRADING ─────────────────────────────────────────────────────────────
const MIN_ENTRY_USD  = 3.00;
const SELL_ALL_PCT   = 0.98;
const LOTTERY_PCT    = 0.02;
const STOP_LOSS_PCT  = 0.08;

// ── 4-WAVE PARAMETERS ───────────────────────────────────────────────────
const WAVE_COUNT         = 4;
const WAVE_MIN_MOVE      = 0.008;
const BUY_CONFIRM_MS     = 120000;
const SELL_CONFIRM_MS    = 120000;
const BOTTOM_TARGET_RANK = 2;
const TOP_EXIT_RANK      = 2;
const DEEP_BONUS         = 1.5;

// ── GITHUB ──────────────────────────────────────────────────────────────
const GITHUB_TOKEN  = process.env.GITHUB_TOKEN;
const GITHUB_REPO   = process.env.GITHUB_REPO;
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || "main";

// ── ABIs ────────────────────────────────────────────────────────────────
const ERC20_ABI = [
  { name: "balanceOf", type: "function", stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }] },
  { name: "allowance", type: "function", stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }],
    outputs: [{ name: "", type: "uint256" }] },
];

// ── RPC ROTATION ────────────────────────────────────────────────────────
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
        console.log(`   ⚡ RPC rate limit — rotating`);
        nextRpc();
        await sleep(1000);
      } else throw e;
    }
  }
  throw new Error("All RPC endpoints rate limited");
}

// ── 8 TOKENS ────────────────────────────────────────────────────────────
const DEFAULT_TOKENS = [
  { symbol: "DEGEN",   address: "0x4ed4e862860bed51a9570b96d89af5e1b0efefed", feeTier: 3000,  status: "active", entryPrice: null, totalInvested: 0, entryTime: null },
  { symbol: "TOSHI",   address: "0xAC1Bd2486aAf3B5C0fc3Fd868558b082a531B2B4", feeTier: 3000,  status: "active", entryPrice: null, totalInvested: 0, entryTime: null },
  { symbol: "BRETT",   address: "0x532f27101965dd16442E59d40670FaF5eBB142E4", feeTier: 3000,  status: "active", entryPrice: null, totalInvested: 0, entryTime: null },
  { symbol: "AERO",    address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631", feeTier: 3000,  status: "active", entryPrice: null, totalInvested: 0, entryTime: null },
  { symbol: "VIRTUAL", address: "0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b", feeTier: 3000,  status: "active", entryPrice: null, totalInvested: 0, entryTime: null },
  { symbol: "AIXBT",   address: "0x4F9Fd6Be4a90f2620860d680c0d4d5Fb53d1A825", feeTier: 3000,  status: "active", entryPrice: null, totalInvested: 0, entryTime: null },
  { symbol: "CLANKER", address: "0x1bc0c42215582d5a085795f4badbac3ff36d1bcb", feeTier: 10000, status: "active", entryPrice: null, totalInvested: 0, entryTime: null },
  { symbol: "SEAM",    address: "0x1C7a460413dD4e964f96D8dFC56E7223cE88CD85", feeTier: 3000,  status: "active", entryPrice: null, totalInvested: 0, entryTime: null },
];

// ── STATE ────────────────────────────────────────────────────────────────
let tokens         = [];
let history        = {};
let tokensSha      = null;
let historySha     = null;
let positionsSha   = null;
let priceStreams    = {};
let lastTradeTime  = {};
let piggyBank      = 0;
let totalSkimmed   = 0;
let tradeCount     = 0;
let lastSaveTime   = 0;
let lastReportTime = 0;
let approvedTokens = new Set();
let cdpClient      = null;

const waveState         = {};
const buyConfirmations  = {};
const sellConfirmations = {};
let   manualCommands    = [];

// ── CDP CLIENT ───────────────────────────────────────────────────────────
function createCdpClient() {
  const apiKeySecret = (process.env.CDP_API_KEY_SECRET || "").replace(/\\n/g, "\n");
  const apiKeyId     = process.env.CDP_API_KEY_ID || "";
  return new CdpClient({ apiKeyId, apiKeySecret, walletSecret: process.env.CDP_WALLET_SECRET });
}

// ── GITHUB ───────────────────────────────────────────────────────────────
async function githubGet(path) {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}?ref=${GITHUB_BRANCH}&t=${Date.now()}`,
      { headers: { Authorization: `token ${GITHUB_TOKEN}`, Accept: "application/vnd.github.v3+json" } }
    );
    if (!res.ok) return null;
    const data    = await res.json();
    const content = Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf8");
    return { content: JSON.parse(content), sha: data.sha };
  } catch (e) { console.log(`GitHub read error (${path}): ${e.message}`); return null; }
}

async function githubSave(path, content, sha) {
  try {
    const body = {
      message: `Guardian update ${new Date().toISOString()}`,
      content: Buffer.from(JSON.stringify(content, null, 2)).toString("base64"),
      branch:  GITHUB_BRANCH,
    };
    if (sha) body.sha = sha;
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`,
      { method: "PUT",
        headers: { Authorization: `token ${GITHUB_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify(body) }
    );
    return (await res.json())?.content?.sha || null;
  } catch (e) { console.log(`GitHub save error (${path}): ${e.message}`); return null; }
}

async function loadFromGitHub() {
  console.log("📂 Loading from GitHub...");
  const tf = await githubGet("tokens.json");
  if (tf?.content?.tokens?.length) {
    const saved = tf.content.tokens;
    tokens    = DEFAULT_TOKENS.map(def => ({ ...def, ...(saved.find(s => s.symbol === def.symbol) || {}) }));
    tokensSha = tf.sha;
  } else {
    tokens = DEFAULT_TOKENS.map(t => ({ ...t }));
  }
  console.log(`✅ ${tokens.length} tokens: ${tokens.map(t => t.symbol).join(", ")}`);

  const hf = await githubGet("history.json");
  if (hf) { history = hf.content || {}; historySha = hf.sha; } else { history = {}; }

  const pf = await githubGet("positions.json");
  if (pf?.content) {
    positionsSha = pf.sha;
    const pos    = pf.content;
    if (pos.piggyBank)    piggyBank    = pos.piggyBank;
    if (pos.totalSkimmed) totalSkimmed = pos.totalSkimmed;
    if (pos.tradeCount)   tradeCount   = pos.tradeCount;
    if (pos.entries) {
      for (const t of tokens) {
        if (pos.entries[t.symbol] != null) {
          t.entryPrice    = pos.entries[t.symbol];
          t.totalInvested = pos.invested?.[t.symbol]   || 0;
          t.entryTime     = pos.entryTimes?.[t.symbol] || null;
        }
      }
    }
    const restored = Object.keys(pos.entries || {}).filter(k => pos.entries[k]).join(", ");
    console.log(`✅ Positions restored: ${restored || "none"}`);
    console.log(`✅ Piggy: ${piggyBank.toFixed(6)} ETH | Trades: ${tradeCount}`);
  } else {
    console.log("✅ No saved positions — fresh start");
  }
}

// ── BOOTSTRAP WAVES FROM SAVED HISTORY ───────────────────────────────────
// Scans existing price history to extract last 4 peaks and troughs
// so the bot is ready to trade immediately on restart — no re-learning needed
function bootstrapWavesFromHistory() {
  console.log("🌊 Bootstrapping wave state from history...");
  for (const symbol of Object.keys(history)) {
    const readings = history[symbol]?.readings;
    if (!readings || readings.length < 10) continue;

    const ws = initWaveState(symbol);
    const prices = readings.map(r => r.price);

    // Scan entire history with a 5-point window to find all peaks and troughs
    const peaks   = [];
    const troughs = [];

    for (let i = 2; i < prices.length - 2; i++) {
      const mid = prices[i];
      const isPeak   = mid > prices[i-2] && mid > prices[i-1] && mid > prices[i+1] && mid > prices[i+2];
      const isTrough = mid < prices[i-2] && mid < prices[i-1] && mid < prices[i+1] && mid < prices[i+2];

      if (isPeak) {
        const last = peaks[peaks.length - 1];
        if (!last || Math.abs(mid - last) / last > WAVE_MIN_MOVE) peaks.push(mid);
      }
      if (isTrough) {
        const last = troughs[troughs.length - 1];
        if (!last || Math.abs(mid - last) / last > WAVE_MIN_MOVE) troughs.push(mid);
      }
    }

    // Keep only the last WAVE_COUNT of each
    ws.peaks   = peaks.slice(-(WAVE_COUNT + 2));
    ws.troughs = troughs.slice(-(WAVE_COUNT + 2));

    if (ws.peaks.length || ws.troughs.length) {
      const sortedP = [...ws.peaks].sort((a,b) => a-b);
      const sortedT = [...ws.troughs].sort((a,b) => a-b);
      console.log(`   ✅ ${symbol}: ${ws.peaks.length} peaks, ${ws.troughs.length} troughs`);
      if (sortedP.length) console.log(`      Peaks:   ${sortedP.map(p => "$"+p.toFixed(8)).join(" | ")}`);
      if (sortedT.length) console.log(`      Troughs: ${sortedT.map(t => "$"+t.toFixed(8)).join(" | ")}`);
    } else {
      console.log(`   ⏳ ${symbol}: not enough wave data yet`);
    }
  }
  console.log("✅ Wave bootstrap complete\n");
}

async function saveToGitHub() {
  try {
    console.log("💾 Saving to GitHub...");
    tokensSha    = await githubSave("tokens.json",  { tokens, lastSaved: new Date().toISOString() }, tokensSha);
    historySha   = await githubSave("history.json", history, historySha);
    positionsSha = await githubSave("positions.json", {
      lastSaved: new Date().toISOString(), piggyBank, totalSkimmed, tradeCount,
      entries:    Object.fromEntries(tokens.map(t => [t.symbol, t.entryPrice    || null])),
      invested:   Object.fromEntries(tokens.map(t => [t.symbol, t.totalInvested || 0])),
      entryTimes: Object.fromEntries(tokens.map(t => [t.symbol, t.entryTime     || null])),
    }, positionsSha);
    lastSaveTime = Date.now();
    console.log("✅ Saved to GitHub");
  } catch (e) { console.log(`💾 Save error: ${e.message}`); }
}

// ── TELEGRAM ─────────────────────────────────────────────────────────────
async function sendAlert(msg) {
  try {
    const tok = process.env.TELEGRAM_BOT_TOKEN;
    const cid = process.env.TELEGRAM_CHAT_ID;
    if (!tok || !cid) return;
    await fetch(`https://api.telegram.org/bot${tok}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: cid, text: msg, parse_mode: "HTML" }),
    });
  } catch (e) { console.log("Telegram error:", e.message); }
}

// ── PRICES ───────────────────────────────────────────────────────────────
async function getTokenPrice(address) {
  try {
    const res  = await fetch(`https://api.geckoterminal.com/api/v2/simple/networks/base/token_price/${address.toLowerCase()}`);
    const data = await res.json();
    const p    = parseFloat(data?.data?.attributes?.token_prices?.[address.toLowerCase()]);
    if (!isNaN(p) && p > 0) return p;
  } catch {}
  try {
    const res2  = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${address}`);
    const data2 = await res2.json();
    const pair  = data2?.pairs?.find(p => p.chainId === "base");
    const p2    = parseFloat(pair?.priceUsd);
    if (!isNaN(p2) && p2 > 0) return p2;
  } catch {}
  return null;
}

async function getEthBalance() {
  const bal = await rpcCall(c => c.getBalance({ address: WALLET_ADDRESS }));
  return parseFloat(formatEther(bal));
}

async function getTokenBalance(address) {
  try {
    const bal = await rpcCall(c => c.readContract({
      address, abi: ERC20_ABI, functionName: "balanceOf", args: [WALLET_ADDRESS],
    }));
    return Number(bal) / 1e18;
  } catch { return 0; }
}

async function getWethBalance() {
  try {
    const bal = await rpcCall(c => c.readContract({
      address: WETH_ADDRESS, abi: ERC20_ABI, functionName: "balanceOf", args: [WALLET_ADDRESS],
    }));
    return parseFloat(formatEther(bal));
  } catch { return 0; }
}

async function estimateGasCostEth() {
  try {
    const gasPrice = await rpcCall(c => c.getGasPrice());
    return parseFloat(formatEther(gasPrice * BigInt(200000)));
  } catch { return 0.0001; }
}

function getTradeableEth(ethBalance) {
  return Math.max(ethBalance - GAS_RESERVE - SELL_RESERVE - piggyBank, 0);
}

// ═══════════════════════════════════════════════════════════════════════
// ⚡ 4-WAVE ENGINE
// ═══════════════════════════════════════════════════════════════════════

function initWaveState(symbol) {
  if (!waveState[symbol]) {
    waveState[symbol] = { peaks: [], troughs: [] };
  }
  return waveState[symbol];
}

function updateWaves(symbol) {
  const ws     = initWaveState(symbol);
  const stream = priceStreams[symbol] || [];
  if (stream.length < 5) return ws;

  const recent = stream.slice(-5).map(r => r.price);
  const mid    = recent[2];

  const isPeak   = mid > recent[0] && mid > recent[1] && mid > recent[3] && mid > recent[4];
  const isTrough = mid < recent[0] && mid < recent[1] && mid < recent[3] && mid < recent[4];

  if (isPeak) {
    const lastPeak = ws.peaks[ws.peaks.length - 1];
    if (!lastPeak || Math.abs(mid - lastPeak) / lastPeak > WAVE_MIN_MOVE) {
      ws.peaks.push(mid);
      if (ws.peaks.length > WAVE_COUNT + 2) ws.peaks.shift();
      console.log(`   📈 [${symbol}] Peak: $${mid.toFixed(8)} (${ws.peaks.length} tracked)`);
    }
  }

  if (isTrough) {
    const lastTrough = ws.troughs[ws.troughs.length - 1];
    if (!lastTrough || Math.abs(mid - lastTrough) / lastTrough > WAVE_MIN_MOVE) {
      ws.troughs.push(mid);
      if (ws.troughs.length > WAVE_COUNT + 2) ws.troughs.shift();
      console.log(`   📉 [${symbol}] Trough: $${mid.toFixed(8)} (${ws.troughs.length} tracked)`);
    }
  }

  return ws;
}

function getWavePeaks(symbol) {
  return [...(waveState[symbol]?.peaks || [])].slice(-WAVE_COUNT).sort((a, b) => a - b);
}

function getWaveTroughs(symbol) {
  return [...(waveState[symbol]?.troughs || [])].slice(-WAVE_COUNT).sort((a, b) => a - b);
}

function avg(arr) {
  if (!arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function getMomentum(symbol, n = 6) {
  const s = priceStreams[symbol] || [];
  if (s.length < n) return { direction: "neutral", speed: 0, strength: 0 };
  const recent = s.slice(-n);
  const moves  = [];
  for (let i = 1; i < recent.length; i++)
    moves.push((recent[i].price - recent[i-1].price) / recent[i-1].price);
  const avgMove  = moves.reduce((a, b) => a + b, 0) / moves.length;
  const strength = Math.abs(avgMove);
  return {
    direction: avgMove > 0.0002 ? "up" : avgMove < -0.0002 ? "down" : "neutral",
    speed: strength,
    strength,
    avgMove,
  };
}

function countWaveLowsBrokenAbove(symbol, price) {
  return getWaveTroughs(symbol).filter(t => price > t).length;
}

function countWaveHighsBrokenAbove(symbol, price) {
  return getWavePeaks(symbol).filter(p => price > p).length;
}

// Near 3rd-lowest trough (index 2) — not greedy, not too late
function isNearBuyTarget(symbol, price) {
  const troughs = getWaveTroughs(symbol);
  if (troughs.length < 3) return { near: false, target: null, pctAway: null };
  const target  = troughs[BOTTOM_TARGET_RANK];
  const pctAway = (price - target) / target;
  const near    = pctAway <= 0.015 && pctAway >= -0.05;
  return { near, target, pctAway };
}

// Near 3rd-highest peak (index 2) — exit before absolute top
function isNearSellTarget(symbol, price) {
  const peaks = getWavePeaks(symbol);
  if (peaks.length < 3) return { near: false, target: null, pctAway: null, avgPeak: null };
  const target  = peaks[TOP_EXIT_RANK];
  const avgPeak = avg(peaks);
  const pctAway = (price - target) / target;
  const near    = pctAway >= -0.01;
  return { near, target, pctAway, avgPeak };
}

// Missed fast drop — price already bouncing up from trough
function missedBottomRecovery(symbol, price) {
  const troughs  = getWaveTroughs(symbol);
  if (troughs.length < 1) return false;
  const momentum = getMomentum(symbol);
  const bounce   = (price - troughs[0]) / troughs[0];
  return bounce > 0.02 && bounce < 0.08 && momentum.direction === "up";
}

// Cascade ranking score
function getCascadeScore(symbol, price) {
  const lowsBroken = countWaveLowsBrokenAbove(symbol, price);
  const momentum   = getMomentum(symbol);
  const upScore    = momentum.direction === "up" ? momentum.strength * 100 : 0;
  const { near: nearBuy } = isNearBuyTarget(symbol, price);
  return (lowsBroken * 2) + upScore + (nearBuy ? 3 : 0);
}

async function findCascadeTarget(excludeSymbol) {
  let best = null, bestScore = -1;
  for (const t of tokens) {
    if (t.symbol === excludeSymbol || t.status !== "active" || !canTrade(t.symbol)) continue;
    const price = history[t.symbol]?.lastPrice;
    if (!price || getWaveTroughs(t.symbol).length < 2) continue;
    const score = getCascadeScore(t.symbol, price);
    if (score > bestScore) { bestScore = score; best = t; }
  }
  return best;
}

// ── HELPERS ───────────────────────────────────────────────────────────────
function recordPrice(symbol, price) {
  if (!history[symbol]) history[symbol] = { readings: [], lastPrice: null };
  history[symbol].readings.push({ price, time: Date.now() });
  if (history[symbol].readings.length > 5000) history[symbol].readings.shift();
  history[symbol].lastPrice = price;
}

function canTrade(symbol) {
  const elapsed = Date.now() - (lastTradeTime[symbol] || 0);
  if (elapsed < COOLDOWN_MS) {
    console.log(`   ⏳ ${symbol} cooldown: ${Math.ceil((COOLDOWN_MS - elapsed) / 1000)}s`);
    return false;
  }
  return true;
}

// Hard profit gate — proceeds must cover entry + gas×4 + piggy
async function profitGate(ethAmount, entryEth, isProtective) {
  const gasCost    = await estimateGasCostEth();
  const tradeValue = ethAmount * ETH_USD;
  if (gasCost > MAX_GAS_ETH)    return { ok: false, reason: `GAS SPIKE ${gasCost.toFixed(6)} ETH` };
  if (tradeValue < MIN_TRADE_USD) return { ok: false, reason: `Too small $${tradeValue.toFixed(2)}` };
  if (!isProtective && entryEth > 0) {
    const minRequired = entryEth + (gasCost * GAS_PROFIT_MULT) + (ethAmount * PIGGY_SKIM_PCT);
    if (ethAmount < minRequired) {
      return { ok: false, reason: `Need $${((minRequired - ethAmount) * ETH_USD).toFixed(3)} more to cover gas×${GAS_PROFIT_MULT}+piggy` };
    }
  } else if (tradeValue < gasCost * GAS_PROFIT_MULT * ETH_USD) {
    return { ok: false, reason: `Gas eats trade $${tradeValue.toFixed(2)}` };
  }
  return { ok: true, reason: "ok" };
}

// ── ENCODE ────────────────────────────────────────────────────────────────
function encodeSwap(tokenIn, tokenOut, amountIn, recipient, fee = 3000) {
  const p = (v, isAddr = false) => (isAddr ? v.slice(2) : BigInt(v).toString(16)).padStart(64, "0");
  return "0x04e45aaf" + p(tokenIn, true) + p(tokenOut, true) + p(fee)
       + p(recipient, true) + p(amountIn) + p(0) + p(0);
}

function encodeApprove(spender, amount) {
  return "0x095ea7b3" + spender.slice(2).padStart(64, "0") + amount.toString(16).padStart(64, "0");
}

async function ensureApproved(cdp, tokenAddress, amountIn) {
  const MAX_UINT256 = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
  const key = tokenAddress.toLowerCase();
  if (approvedTokens.has(key)) { console.log(`      ✅ Approved (cached)`); return; }
  const allowance = await rpcCall(c => c.readContract({
    address: tokenAddress, abi: ERC20_ABI,
    functionName: "allowance", args: [WALLET_ADDRESS, SWAP_ROUTER],
  }));
  if (allowance >= amountIn) { approvedTokens.add(key); console.log(`      ✅ Already approved`); return; }
  console.log(`      🔓 Approving...`);
  await cdp.evm.sendTransaction({
    address: WALLET_ADDRESS, network: "base",
    transaction: { to: tokenAddress, data: encodeApprove(SWAP_ROUTER, MAX_UINT256) },
  });
  approvedTokens.add(key);
  await sleep(8000);
  console.log(`      ✅ Approved`);
}

// ── BUY ───────────────────────────────────────────────────────────────────
async function executeBuy(cdp, token, tradeableEth, reason, price, forcedEth = 0) {
  try {
    if (!canTrade(token.symbol)) return false;
    const wethBal    = await getWethBalance();
    const totalAvail = tradeableEth + wethBal;
    if (totalAvail < MIN_ETH_TRADE) { console.log(`   🛑 ETH+WETH too low`); return false; }

    const minEntryEth = MIN_ENTRY_USD / ETH_USD;
    const troughs     = getWaveTroughs(token.symbol);
    const isDeep      = troughs.length >= 1 && price <= troughs[0] * 1.02;
    const deepBonus   = isDeep ? DEEP_BONUS : 1.0;
    const maxPerBuy   = totalAvail * MAX_BUY_PCT * deepBonus;

    let ethToSpend = forcedEth > 0
      ? Math.min(forcedEth, maxPerBuy)
      : Math.min(Math.max(minEntryEth, totalAvail * 0.05), maxPerBuy);

    const gate = await profitGate(ethToSpend, 0, true);
    if (!gate.ok) { console.log(`   🛑 Buy gate: ${gate.reason}`); return false; }

    const amountIn = parseEther(ethToSpend.toFixed(18));
    const useWeth  = wethBal >= ethToSpend;
    const peaks    = getWavePeaks(token.symbol);
    const avgPeak  = avg(peaks);

    console.log(`\n   🟢 BUY ${token.symbol} — ${reason}`);
    console.log(`      ${ethToSpend.toFixed(6)} ${useWeth ? "WETH" : "ETH"} @ $${price.toFixed(8)}${isDeep ? " 🔥 DEEP" : ""}`);
    if (troughs.length) console.log(`      Troughs: ${troughs.map(t => "$"+t.toFixed(8)).join(" | ")}`);
    if (peaks.length)   console.log(`      Peaks:   ${peaks.map(p => "$"+p.toFixed(8)).join(" | ")}`);

    let txHash;
    if (useWeth) {
      await ensureApproved(cdp, WETH_ADDRESS, amountIn);
      const { transactionHash } = await cdp.evm.sendTransaction({
        address: WALLET_ADDRESS, network: "base",
        transaction: { to: SWAP_ROUTER, data: encodeSwap(WETH_ADDRESS, token.address, amountIn, WALLET_ADDRESS, token.feeTier) },
      });
      txHash = transactionHash;
    } else {
      const { transactionHash } = await cdp.evm.sendTransaction({
        address: WALLET_ADDRESS, network: "base",
        transaction: { to: SWAP_ROUTER, value: amountIn, data: encodeSwap(WETH_ADDRESS, token.address, amountIn, WALLET_ADDRESS, token.feeTier) },
      });
      txHash = transactionHash;
    }

    lastTradeTime[token.symbol] = Date.now();
    tradeCount++;
    token.entryPrice    = price;
    token.totalInvested = (token.totalInvested || 0) + ethToSpend;
    token.entryTime     = Date.now();
    delete sellConfirmations[token.symbol];

    console.log(`      ✅ https://basescan.org/tx/${txHash}`);
    await sendAlert(
      `🟢🟢🟢 <b>BOUGHT ${token.symbol}!</b>\n\n` +
      `💰 ${ethToSpend.toFixed(6)} ${useWeth?"WETH":"ETH"} (~$${(ethToSpend*ETH_USD).toFixed(2)})\n` +
      `💲 Entry: $${price.toFixed(8)}\n` +
      (troughs.length ? `📉 Troughs: ${troughs.map(t=>"$"+t.toFixed(8)).join(", ")}\n` : "") +
      (avgPeak ? `🎯 Avg sell target: $${avgPeak.toFixed(8)}\n` : "") +
      `📊 ${reason}\n` +
      (isDeep ? `🔥 NEAR ABSOLUTE BOTTOM — 50% bigger!\n` : "") +
      `🔗 <a href="https://basescan.org/tx/${txHash}">Basescan</a>`
    );
    return ethToSpend;
  } catch (e) {
    console.log(`      ❌ BUY FAILED: ${e.message}`);
    await sendAlert(`⚠️ <b>${token.symbol} BUY FAILED</b>\n${e.message}`);
    return false;
  }
}

// ── SELL ──────────────────────────────────────────────────────────────────
async function executeSell(cdp, token, sellPct, reason, price, isProtective = false) {
  try {
    if (!canTrade(token.symbol)) return null;
    const totalBal    = await getTokenBalance(token.address);
    const lotteryHold = Math.max(Math.floor(totalBal * LOTTERY_PCT), 1);
    const sellable    = Math.max(totalBal - lotteryHold, 0);
    if (sellable < 1) { console.log(`   ⏳ Nothing to sell`); return null; }

    // HARD RULE: never sell below entry unless protective
    if (!isProtective && token.entryPrice && price < token.entryPrice) {
      console.log(`   🛑 BELOW ENTRY — holding (${price.toFixed(8)} < ${token.entryPrice.toFixed(8)})`);
      return null;
    }

    const amountToSell        = BigInt(Math.floor(sellable * sellPct * 1e18));
    if (amountToSell === BigInt(0)) return null;
    const expectedProceedsEth = (sellable * sellPct * price) / ETH_USD;
    const entryEth            = isProtective ? 0 : (token.totalInvested * sellPct || 0);

    const gate = await profitGate(expectedProceedsEth, entryEth, isProtective);
    if (!gate.ok) { console.log(`   🛑 SELL BLOCKED: ${gate.reason}`); return null; }

    console.log(`\n   🔴 SELL ${token.symbol} — ${reason}`);
    console.log(`      ${(sellPct*100).toFixed(0)}% of ${sellable.toFixed(0)} tokens @ $${price.toFixed(8)}`);
    console.log(`      🎰 Keeping ${lotteryHold} forever`);

    await ensureApproved(cdp, token.address, amountToSell);
    const wethBefore = await getWethBalance();
    const ethBefore  = await getEthBalance();

    const { transactionHash } = await cdp.evm.sendTransaction({
      address: WALLET_ADDRESS, network: "base",
      transaction: { to: SWAP_ROUTER, data: encodeSwap(token.address, WETH_ADDRESS, amountToSell, WALLET_ADDRESS, token.feeTier) },
    });

    lastTradeTime[token.symbol] = Date.now();
    tradeCount++;
    await sleep(8000);

    const wethAfter = await getWethBalance();
    const ethAfter  = await getEthBalance();
    const profit    = (wethAfter - wethBefore) + (ethAfter - ethBefore);
    const profitUsd = (profit * ETH_USD).toFixed(2);
    const entryUsd  = ((token.totalInvested || 0) * ETH_USD).toFixed(2);

    let skim = 0;
    if (profit > 0) {
      skim = profit * PIGGY_SKIM_PCT;
      piggyBank    += skim;
      totalSkimmed += skim;
      console.log(`      🐷 Skimmed ${skim.toFixed(6)} ETH`);
    }

    if (sellPct >= SELL_ALL_PCT) { token.entryPrice = null; token.entryTime = null; token.totalInvested = 0; }
    delete sellConfirmations[token.symbol];

    const proceedsAfterSkim = Math.max(profit - skim, 0);
    console.log(`      ✅ https://basescan.org/tx/${transactionHash}`);
    console.log(`      💰 Received: ${profit.toFixed(6)} ETH ($${profitUsd})`);

    await sendAlert(
      `🔴🔴🔴 <b>SOLD ${token.symbol}!</b>\n\n` +
      `💰 Received: ${profit.toFixed(6)} ETH (~$${profitUsd})\n` +
      `📥 Invested: ~$${entryUsd}\n` +
      `${parseFloat(profitUsd)>=parseFloat(entryUsd)?"📈":"📉"} Net: ${profit>0?"+":""}$${(parseFloat(profitUsd)-parseFloat(entryUsd)).toFixed(2)}\n` +
      `💲 Exit: $${price.toFixed(8)}\n` +
      `🎰 Kept ${lotteryHold} forever\n` +
      `🐷 Skim: ${skim.toFixed(6)} ETH | Total: ${piggyBank.toFixed(6)} ETH\n` +
      `📊 ${reason}\n` +
      `🔗 <a href="https://basescan.org/tx/${transactionHash}">Basescan</a>`
    );
    return proceedsAfterSkim;
  } catch (e) {
    console.log(`      ❌ SELL FAILED: ${e.message}`);
    await sendAlert(`⚠️ <b>${token.symbol} SELL FAILED</b>\n${e.message}`);
    return null;
  }
}

// ── CASCADE TRIGGER ───────────────────────────────────────────────────────
async function triggerCascade(cdp, soldSymbol, proceeds, ethBalance) {
  try {
    console.log(`\n  🌊 CASCADE — ${proceeds.toFixed(6)} ETH from ${soldSymbol}`);
    const target = await findCascadeTarget(soldSymbol);
    if (!target) { console.log(`  🌊 No ranked target — proceeds stay as WETH`); return; }
    const price      = history[target.symbol]?.lastPrice;
    if (!price) return;
    const score      = getCascadeScore(target.symbol, price);
    const lowsBroken = countWaveLowsBrokenAbove(target.symbol, price);
    const tradeEth   = getTradeableEth(ethBalance);
    console.log(`  🌊 Target: ${target.symbol} score:${score.toFixed(2)} lows:${lowsBroken}`);
    await sendAlert(
      `🌊 <b>CASCADE: ${soldSymbol} → ${target.symbol}</b>\n\n` +
      `💰 Routing: ${proceeds.toFixed(6)} ETH\n` +
      `📊 Wave score: ${score.toFixed(2)} | Lows broken: ${lowsBroken}\n` +
      `💲 $${price.toFixed(8)}\n⚡ Buying...`
    );
    await executeBuy(cdp, target, tradeEth, `🌊 CASCADE from ${soldSymbol} (score ${score.toFixed(1)}, lows ${lowsBroken})`, price, proceeds * 0.95);
  } catch (e) { console.log(`  ⚠️ Cascade error: ${e.message}`); }
}

// ═══════════════════════════════════════════════════════════════════════
// 🔄 PROCESS ONE TOKEN
// ═══════════════════════════════════════════════════════════════════════
async function processToken(cdp, token, ethBalance) {
  try {
    const price = await getTokenPrice(token.address);
    if (!price) { console.log(`   ⏳ ${token.symbol}: no price`); return; }

    if (!priceStreams[token.symbol]) priceStreams[token.symbol] = [];
    priceStreams[token.symbol].push({ price, time: Date.now() });
    if (priceStreams[token.symbol].length > 500) priceStreams[token.symbol].shift();
    recordPrice(token.symbol, price);
    updateWaves(token.symbol);

    const balance      = await getTokenBalance(token.address);
    const valueUsd     = (balance * price).toFixed(2);
    const momentum     = getMomentum(token.symbol);
    const tradeableEth = getTradeableEth(ethBalance);
    const wethBal      = await getWethBalance();
    const totalAvail   = tradeableEth + wethBal;
    const lotteryHold  = Math.floor(balance * LOTTERY_PCT);
    const sellable     = Math.max(balance - lotteryHold, 0);
    const entry        = token.entryPrice;

    const peaks    = getWavePeaks(token.symbol);
    const troughs  = getWaveTroughs(token.symbol);
    const avgPeak  = avg(peaks);
    const avgTrgh  = avg(troughs);

    const { near: nearBuy,  target: buyTarget,  pctAway: pctFromBuy  } = isNearBuyTarget(token.symbol, price);
    const { near: nearSell, target: sellTarget, pctAway: pctFromSell } = isNearSellTarget(token.symbol, price);
    const missedBottom = missedBottomRecovery(token.symbol, price);
    const lowsBroken   = countWaveLowsBrokenAbove(token.symbol, price);
    const highsBroken  = countWaveHighsBrokenAbove(token.symbol, price);

    const pnlStr   = entry ? ` | P&L: ${((price-entry)/entry*100).toFixed(1)}%` : "";
    const waveLbl  = peaks.length < 2 && troughs.length < 2 ? "⏳ Learning waves" :
      nearSell ? "🔴 NEAR SELL" : nearBuy ? "🟢 NEAR BUY" :
      `⬜ L:${lowsBroken} H:${highsBroken}`;

    console.log(`\n  ┌─ [${token.symbol}] ${waveLbl} | $${price.toFixed(8)}${pnlStr}`);
    console.log(`  │ 🪙 ${balance.toFixed(0)} ($${valueUsd}) | mom: ${momentum.direction}`);
    console.log(`  │ Peaks(${peaks.length}): ${peaks.map(p=>"$"+p.toFixed(6)).join(" ")} avg:${avgPeak?"$"+avgPeak.toFixed(8):"?"}`);
    console.log(`  │ Troughs(${troughs.length}): ${troughs.map(t=>"$"+t.toFixed(6)).join(" ")} avg:${avgTrgh?"$"+avgTrgh.toFixed(8):"?"}`);
    if (buyTarget)  console.log(`  │ 🛒 Buy target: $${buyTarget.toFixed(8)} (${pctFromBuy!==null?(pctFromBuy*100).toFixed(2)+"%":"?"} away)`);
    if (sellTarget) console.log(`  │ 🎯 Sell target: $${sellTarget.toFixed(8)} (${pctFromSell!==null?(pctFromSell*100).toFixed(2)+"%":"?"} away)`);
    console.log(`  └─────────────────────────────────────────────`);

    // Manual commands
    const mi = manualCommands.findIndex(c => c.symbol === token.symbol);
    if (mi !== -1) {
      const cmd = manualCommands.splice(mi, 1)[0];
      if (cmd.action === "buy") {
        await executeBuy(cdp, token, tradeableEth, "MANUAL BUY", price);
      } else if (cmd.action === "sell") {
        const proceeds = await executeSell(cdp, token, SELL_ALL_PCT, "MANUAL SELL", price, true);
        if (proceeds > 0) await triggerCascade(cdp, token.symbol, proceeds, ethBalance);
      } else if (cmd.action === "sellhalf") {
        await executeSell(cdp, token, 0.5, "MANUAL SELL HALF", price, true);
      }
      return;
    }

    // ── SELL LOGIC ──────────────────────────────────────────────────────
    if (sellable > 1 && entry) {

      // Stop loss — protective
      if (price < entry * (1 - STOP_LOSS_PCT) && token.entryTime && (Date.now() - token.entryTime) > STOP_LOSS_MS) {
        console.log(`  🛑 STOP LOSS ${token.symbol}`);
        const proceeds = await executeSell(cdp, token, SELL_ALL_PCT, `STOP LOSS ${((price-entry)/entry*100).toFixed(1)}%`, price, true);
        if (proceeds > 0) await triggerCascade(cdp, token.symbol, proceeds, ethBalance);
        return;
      }

      // Detect wave dying — first of any of three signals
      let waveDying = false, waveDyingReason = "";

      // Signal 1: momentum fading near avg peak
      if (avgPeak && price >= avgPeak * 0.95 && momentum.direction === "down") {
        waveDying = true;
        waveDyingReason = `momentum fading near avg peak $${avgPeak.toFixed(8)}`;
      }

      // Signal 2: price drops back below 3rd peak level (wave broke)
      if (!waveDying && peaks.length >= 3 && entry && price < peaks[TOP_EXIT_RANK] && price > entry * 1.01) {
        waveDying = true;
        waveDyingReason = `broke below 3rd peak $${peaks[TOP_EXIT_RANK].toFixed(8)}`;
      }

      // Signal 3: near sell target — wait 2min, if no new high then sell
      if (nearSell) {
        if (!sellConfirmations[token.symbol]) {
          sellConfirmations[token.symbol] = { firstSeenMs: Date.now(), highSeen: price };
          console.log(`  ⏱️  ${token.symbol} near sell target — 2min settle`);
          await sendAlert(
            `⏱️ <b>${token.symbol} NEAR SELL TARGET</b>\n\n💲 $${price.toFixed(8)}\n🎯 $${sellTarget?.toFixed(8)||"?"}\n⏳ If no new high in 2min → SELL`
          );
        } else {
          const sc      = sellConfirmations[token.symbol];
          const elapsed = Date.now() - sc.firstSeenMs;
          if (price > sc.highSeen) {
            sc.highSeen = price;
            console.log(`  ⬆️  ${token.symbol} still new highs $${price.toFixed(8)} — trailing`);
          } else if (elapsed >= SELL_CONFIRM_MS) {
            waveDying = true;
            waveDyingReason = "2min at top, no new high — wave stalling";
          } else {
            console.log(`  ⏳ ${token.symbol} settle: ${Math.ceil((SELL_CONFIRM_MS-elapsed)/1000)}s left`);
          }
        }
      } else {
        if (sellConfirmations[token.symbol]) delete sellConfirmations[token.symbol];
      }

      if (waveDying) {
        console.log(`  🌊 WAVE EXIT: ${token.symbol} — ${waveDyingReason}`);
        delete sellConfirmations[token.symbol];
        const proceeds = await executeSell(cdp, token, SELL_ALL_PCT, `WAVE EXIT: ${waveDyingReason}`, price, false);
        if (proceeds > 0) await triggerCascade(cdp, token.symbol, proceeds, ethBalance);
        return;
      }

    // ── BUY LOGIC ────────────────────────────────────────────────────────
    } else if (totalAvail >= MIN_ETH_TRADE && !entry) {

      // Missed fast drop — buy on recovery
      if (missedBottom) {
        console.log(`  ↗️  ${token.symbol} missed bottom — buying recovery bounce`);
        delete buyConfirmations[token.symbol];
        await executeBuy(cdp, token, tradeableEth, `RECOVERY from trough (lows broken: ${lowsBroken})`, price);
        return;
      }

      // Near buy target — ALL THREE: near target + 2min stable + momentum turning up
      if (nearBuy || (troughs.length >= 2 && price <= troughs[1] * 1.01)) {
        const conf = buyConfirmations[token.symbol];
        if (!conf) {
          buyConfirmations[token.symbol] = { firstSeenMs: Date.now(), priceAtFirst: price, lowestSeen: price };
          console.log(`  ⏱️  ${token.symbol} near buy target — 2min stabilize started`);
          await sendAlert(
            `⏱️ <b>${token.symbol} NEAR BUY ZONE</b>\n\n💲 $${price.toFixed(8)}\n🎯 Buy target: $${buyTarget?.toFixed(8)||"?"}\n📉 Troughs: ${troughs.map(t=>"$"+t.toFixed(8)).join(", ")}\n⏳ Waiting: stable + 2min + rising`
          );
        } else {
          const elapsed = Date.now() - conf.firstSeenMs;
          if (price < conf.lowestSeen) conf.lowestSeen = price;
          if (momentum.direction === "down") {
            buyConfirmations[token.symbol] = { firstSeenMs: Date.now(), priceAtFirst: price, lowestSeen: price };
            console.log(`  ⬇️  ${token.symbol} still falling — clock reset`);
          } else if (elapsed < BUY_CONFIRM_MS) {
            console.log(`  ⏳ ${token.symbol} stabilizing ${Math.ceil((BUY_CONFIRM_MS-elapsed)/1000)}s | ${momentum.direction}`);
          } else {
            console.log(`  🟢 ${token.symbol} CONFIRMED — stable + near target + rising!`);
            delete buyConfirmations[token.symbol];
            const isDeepEntry = troughs.length >= 1 && conf.lowestSeen <= troughs[0] * 1.005;
            await executeBuy(cdp, token, tradeableEth,
              `WAVE LOW CONFIRMED (${(elapsed/60000).toFixed(1)}min, lows broken:${lowsBroken}${isDeepEntry?" 🔥 DEEP":""})`, price);
          }
        }
      } else {
        if (buyConfirmations[token.symbol]) {
          console.log(`  ↗️  ${token.symbol} left buy zone — clearing`);
          delete buyConfirmations[token.symbol];
        }
        // Seed entry while learning waves
        if (token.status === "active" && troughs.length < 3) {
          const minEntryEth = MIN_ENTRY_USD / ETH_USD;
          if (totalAvail >= minEntryEth && peaks.length >= 1) {
            console.log(`  💵 ${token.symbol} seed — learning waves`);
            await executeBuy(cdp, token, tradeableEth, `$${MIN_ENTRY_USD} seed — building wave data`, price);
          }
        }
      }
    }

  } catch (e) { console.log(`  ⚠️ processToken error (${token.symbol}): ${e.message}`); }
}

// ── REPORTS ───────────────────────────────────────────────────────────────
async function sendFullReport(ethBalance, title) {
  try {
    let lines = "";
    for (const t of tokens) {
      const price = history[t.symbol]?.lastPrice;
      if (!price) { lines += `\n⬜ <b>${t.symbol}</b> — loading\n`; continue; }
      const bal      = await getTokenBalance(t.address);
      const peaks    = getWavePeaks(t.symbol);
      const troughs  = getWaveTroughs(t.symbol);
      const lottery  = Math.floor(bal * LOTTERY_PCT);
      const sellNow  = (Math.max(bal - lottery, 0) * price).toFixed(2);
      const { near: nb, target: bt } = isNearBuyTarget(t.symbol, price);
      const { near: ns, target: st } = isNearSellTarget(t.symbol, price);
      const zone = ns ? "🔴" : nb ? "🟢" : "⬜";
      lines += `\n${zone} <b>${t.symbol}</b> $${price.toFixed(8)}\n`;
      lines += `   Peaks(${peaks.length}) avg:${avg(peaks)?"$"+(avg(peaks)).toFixed(8):"learning"} | Troughs(${troughs.length}) avg:${avg(troughs)?"$"+(avg(troughs)).toFixed(8):"learning"}\n`;
      if (t.entryPrice) {
        const pnl = ((price-t.entryPrice)/t.entryPrice*100).toFixed(2);
        lines += `   ${parseFloat(pnl)>=0?"📈":"📉"} Entry:$${t.entryPrice.toFixed(8)} P&L:<b>${parseFloat(pnl)>=0?"+":""}${pnl}%</b> Sell~$${sellNow}\n`;
        if (st) lines += `   🎯 To sell: +${((st-price)/price*100).toFixed(1)}% ($${st.toFixed(8)})\n`;
      } else {
        if (bt) lines += `   🛒 Buy target: $${bt.toFixed(8)}\n`;
      }
    }
    const weth = await getWethBalance();
    await sendAlert(
      `📊 <b>GUARDIAN v11.0 — ${title}</b>\n🕐 ${new Date().toLocaleTimeString()}\n\n` +
      `💰 ETH:${ethBalance.toFixed(6)} WETH:${weth.toFixed(6)}\n` +
      `♻️ Tradeable:${getTradeableEth(ethBalance).toFixed(6)} ETH\n` +
      `🐷 Piggy:${piggyBank.toFixed(6)} ETH LOCKED\n` +
      `📈 Trades:${tradeCount} Skimmed:${totalSkimmed.toFixed(6)} ETH\n─────────────────────────` +
      lines + `\n🔗 <a href="https://basescan.org/address/${WALLET_ADDRESS}">Basescan</a>`
    );
  } catch (e) { console.log(`Report error: ${e.message}`); }
}

async function sendReport(ethBalance) {
  if (Date.now() - lastReportTime < REPORT_INTERVAL) return;
  lastReportTime = Date.now();
  await sendFullReport(ethBalance, "⏰ 30 MIN REPORT");
}

// ── TELEGRAM COMMANDS ─────────────────────────────────────────────────────
let lastUpdateId = 0;

async function checkTelegramCommands(cdp, ethBalance) {
  try {
    const tok = process.env.TELEGRAM_BOT_TOKEN;
    const cid = process.env.TELEGRAM_CHAT_ID;
    if (!tok || !cid) return;
    const res  = await fetch(`https://api.telegram.org/bot${tok}/getUpdates?offset=${lastUpdateId+1}&timeout=1`);
    const data = await res.json();
    if (!data.ok || !data.result?.length) return;

    for (const update of data.result) {
      lastUpdateId = update.update_id;
      const raw  = update.message?.text?.trim() || "";
      const text = raw.toLowerCase();
      if (!raw || update.message?.chat?.id?.toString() !== cid) continue;
      console.log(`📱 Telegram: ${raw}`);

      if (text.startsWith("/buy ")) {
        const sym = raw.split(" ")[1]?.toUpperCase();
        if (!tokens.find(t => t.symbol === sym)) { await sendAlert(`❓ Unknown: ${sym}`); continue; }
        manualCommands.push({ symbol: sym, action: "buy" });
        await sendAlert(`📱 <b>BUY ${sym} queued</b>`);
      } else if (text.startsWith("/sell ") && !text.startsWith("/sellhalf")) {
        const sym = raw.split(" ")[1]?.toUpperCase();
        if (!tokens.find(t => t.symbol === sym)) { await sendAlert(`❓ Unknown: ${sym}`); continue; }
        manualCommands.push({ symbol: sym, action: "sell" });
        await sendAlert(`📱 <b>SELL ${sym} queued</b>`);
      } else if (text.startsWith("/sellhalf ")) {
        const sym = raw.split(" ")[1]?.toUpperCase();
        if (!tokens.find(t => t.symbol === sym)) { await sendAlert(`❓ Unknown: ${sym}`); continue; }
        manualCommands.push({ symbol: sym, action: "sellhalf" });
        await sendAlert(`📱 <b>SELL HALF ${sym} queued</b>`);
      } else if (text === "/status" || text === "status") {
        await sendFullReport(ethBalance, "📊 STATUS");
      } else if (text === "/eth" || text === "eth") {
        const weth = await getWethBalance();
        await sendAlert(
          `💰 <b>BALANCES</b>\nETH:${ethBalance.toFixed(6)} WETH:${weth.toFixed(6)}\n` +
          `Tradeable:${getTradeableEth(ethBalance).toFixed(6)}\n🐷 Piggy:${piggyBank.toFixed(6)} ETH\n` +
          `🔗 <a href="https://basescan.org/address/${WALLET_ADDRESS}">Basescan</a>`
        );
      } else if (text === "/waves" || text === "waves") {
        let msg = `🌊 <b>4-WAVE STATUS</b>\n🕐 ${new Date().toLocaleTimeString()}\n\n`;
        for (const t of tokens) {
          const p = history[t.symbol]?.lastPrice;
          if (!p) { msg += `⬜ <b>${t.symbol}</b> — loading\n\n`; continue; }
          const pk = getWavePeaks(t.symbol), tr = getWaveTroughs(t.symbol);
          const lb = countWaveLowsBrokenAbove(t.symbol, p);
          const sc = getCascadeScore(t.symbol, p);
          const { near: nb, target: bt } = isNearBuyTarget(t.symbol, p);
          const { near: ns, target: st } = isNearSellTarget(t.symbol, p);
          msg += `${ns?"🔴":nb?"🟢":"⬜"} <b>${t.symbol}</b> $${p.toFixed(8)}\n`;
          msg += `   Peaks(${pk.length}): ${pk.map(x=>x.toFixed(6)).join(", ")}\n`;
          msg += `   Troughs(${tr.length}): ${tr.map(x=>x.toFixed(6)).join(", ")}\n`;
          msg += `   Lows broken:${lb} Score:${sc.toFixed(2)}\n`;
          if (bt) msg += `   🛒 $${bt.toFixed(8)}\n`;
          if (st) msg += `   🎯 $${st.toFixed(8)}\n`;
          msg += "\n";
        }
        await sendAlert(msg);
      } else if (text === "/positions" || text === "positions") {
        let msg = `📋 <b>POSITIONS</b>\n🕐 ${new Date().toLocaleTimeString()}\n\n`;
        let any = false;
        for (const t of tokens) {
          if (!t.entryPrice) continue; any = true;
          const p    = history[t.symbol]?.lastPrice || t.entryPrice;
          const bal  = await getTokenBalance(t.address);
          const lot  = Math.floor(bal * LOTTERY_PCT);
          const sn   = (Math.max(bal-lot,0)*p).toFixed(2);
          const pnl  = ((p-t.entryPrice)/t.entryPrice*100).toFixed(2);
          const age  = t.entryTime ? Math.floor((Date.now()-t.entryTime)/60000) : "?";
          const { target: st } = isNearSellTarget(t.symbol, p);
          msg += `${parseFloat(pnl)>=0?"🟢":"🔴"} <b>${t.symbol}</b> Entry:$${t.entryPrice.toFixed(8)} (${age}m)\n`;
          msg += `Now:$${p.toFixed(8)} P&L:<b>${parseFloat(pnl)>=0?"+":""}${pnl}%</b>\n`;
          msg += `Invested~$${(t.totalInvested*ETH_USD).toFixed(2)} Sell~$${sn}\n`;
          if (st) msg += `🎯 To sell:+${((st-p)/p*100).toFixed(1)}% $${st.toFixed(8)}\n`;
          msg += "\n";
        }
        if (!any) msg += "No open positions.";
        await sendAlert(msg);
      } else if (text === "/piggy" || text === "piggy") {
        const pct = Math.min((piggyBank/0.5)*100,100);
        const bar = "█".repeat(Math.floor(pct/10))+"░".repeat(10-Math.floor(pct/10));
        await sendAlert(`🐷 <b>PIGGY BANK</b>\n${piggyBank.toFixed(6)} ETH ($${(piggyBank*ETH_USD).toFixed(2)})\nTotal:${totalSkimmed.toFixed(6)} ETH\n[${bar}] ${pct.toFixed(1)}%`);
      } else if (text === "/trades" || text === "trades") {
        await sendAlert(`📈 <b>STATS</b>\nTrades:${tradeCount}\nSkimmed:${totalSkimmed.toFixed(6)} ETH\n🐷 ${piggyBank.toFixed(6)} ETH`);
      } else if (text === "/help" || text === "help") {
        await sendAlert(
          `⚔️ <b>GUARDIAN v11.0 — 4-WAVE EDITION</b>\n\n` +
          `/status /eth /waves /positions /piggy /trades\n\n` +
          `/buy SYMBOL — force buy\n/sell SYMBOL — force sell+cascade\n/sellhalf SYMBOL\n\n` +
          `🌊 Buy = near 3rd trough + 2min + rising\n` +
          `🌊 Sell = first sign wave dying\n` +
          `🌊 Cascade = ranked by uptrend + lows broken\n` +
          `🛡️ Gate: entry + gas×4 + piggy covered always`
        );
      }
    }
  } catch (e) { /* silent */ }
}

// ── MAIN ──────────────────────────────────────────────────────────────────
async function main() {
  console.log("═══════════════════════════════════════════════════════");
  console.log("⚔️   GUARDIAN CASCADE SYSTEM v11.0 — 4-WAVE EDITION");
  console.log("═══════════════════════════════════════════════════════\n");

  await loadFromGitHub();
  bootstrapWavesFromHistory();
  cdpClient = createCdpClient();
  console.log("✅ CDP client ready");

  const ethBalance = await getEthBalance();
  const wethBal    = await getWethBalance();
  console.log(`💰 ETH: ${ethBalance.toFixed(6)} | WETH: ${wethBal.toFixed(6)}`);
  console.log(`🪙  Tracking: ${tokens.map(t => t.symbol).join(", ")}\n`);

  await sendAlert(
    `⚔️ <b>GUARDIAN v11.0 — 4-WAVE EDITION ONLINE</b>\n\n` +
    `👛 <code>${WALLET_ADDRESS}</code>\n` +
    `💰 ETH:${ethBalance.toFixed(6)} WETH:${wethBal.toFixed(6)}\n\n` +
    `🌊 Buy = 3rd trough + 2min stable + rising\n` +
    `🌊 Sell = first sign wave dying\n` +
    `🌊 Cascade = ranked uptrend + lows broken\n` +
    `🛡️ NEVER sell without covering gas×4 + piggy\n\n` +
    `/help for commands | /waves for wave status`
  );

  let cachedEth = ethBalance;

  (async function telegramLoop() {
    while (true) {
      try { await checkTelegramCommands(cdpClient, cachedEth); } catch (e) {}
      await sleep(3000);
    }
  })();

  while (true) {
    try {
      const eth  = await getEthBalance();
      const weth = await getWethBalance();
      cachedEth  = eth;

      console.log(`\n${"═".repeat(56)}`);
      console.log(`${new Date().toLocaleTimeString()} | ETH:${eth.toFixed(6)} WETH:${weth.toFixed(6)} Trades:${tradeCount}`);
      console.log(`Tradeable:${getTradeableEth(eth).toFixed(6)} Piggy:${piggyBank.toFixed(6)} (LOCKED)\n`);

      for (const token of tokens) {
        try { await processToken(cdpClient, token, eth); }
        catch (e) { console.log(`⚠️ Token error (${token.symbol}): ${e.message}`); }
        await sleep(4000);
      }

      await sendReport(eth);
      if (Date.now() - lastSaveTime > SAVE_INTERVAL) await saveToGitHub();

    } catch (e) {
      console.log(`⚠️ Main loop error: ${e.message}`);
      await sendAlert(`⚠️ <b>GUARDIAN ERROR</b>\n${e.message}\n\nContinuing...`);
    }
    await sleep(INTERVAL);
  }
}

main().catch(e => {
  console.log(`💀 Fatal: ${e.message}`);
  setTimeout(() => main(), 30000);
});
