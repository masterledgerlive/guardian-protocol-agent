import { CdpClient } from "@coinbase/cdp-sdk";
import { createPublicClient, http, formatEther, parseEther } from "viem";
import { base } from "viem/chains";
import dotenv from "dotenv";
dotenv.config();

// ═══════════════════════════════════════════════════════════════════════
// ⚔️  GUARDIAN CASCADE SYSTEM v11.4 — PEAK SELL EDITION
// ═══════════════════════════════════════════════════════════════════════

const WALLET_ADDRESS = "0x50e1C4608c48b0c52E1EA5FBabc1c9126eA17915";
const WETH_ADDRESS   = "0x4200000000000000000000000000000000000006";
const SWAP_ROUTER    = "0x2626664c2603336E57B271c5C0b26F421741e481";

// ── TIMING ──────────────────────────────────────────────────────────────
const TRADE_LOOP_MS   = 30000;   // main loop every 30s
const COOLDOWN_MS     = 300000;  // 5min between trades per token
const SAVE_INTERVAL   = 1800000;
const REPORT_INTERVAL = 1800000;
const STOP_LOSS_MS    = 7200000;
const BUY_STABLE_MS   = 120000;  // 2min price must float in range before buy
const SELL_WATCH_MS   = 120000;  // 2min at/near peak triggers sell countdown
const BUY_FLOAT_PCT   = 0.01;    // price must stay within 1% to confirm buy zone
const HALF_CASCADE_COOLDOWN = 300000; // 5min between half cascades

// ── SAFETY ──────────────────────────────────────────────────────────────
const GAS_RESERVE     = 0.0003;
const SELL_RESERVE    = 0.001;
const MAX_BUY_PCT     = 0.15;
const MIN_ETH_TRADE   = 0.0008;
const GAS_PROFIT_MULT = 4;
const MAX_GAS_ETH     = 0.002;
const ETH_USD         = 1940;
const PIGGY_SKIM_PCT  = 0.01;
const LOTTERY_PCT     = 0.02;

// ── TRADING ─────────────────────────────────────────────────────────────
const MIN_ENTRY_USD  = 3.00;
const SELL_ALL_PCT   = 0.98;
const STOP_LOSS_PCT  = 0.08;

// ── 4-WAVE PARAMETERS ───────────────────────────────────────────────────
const WAVE_COUNT         = 4;
const WAVE_MIN_MOVE      = 0.008;
const BOTTOM_TARGET_RANK = 2;
const TOP_EXIT_RANK      = 2;
const DEEP_BONUS         = 1.5;

// ── GITHUB ──────────────────────────────────────────────────────────────
const GITHUB_TOKEN  = process.env.GITHUB_TOKEN;
const GITHUB_REPO   = process.env.GITHUB_REPO;
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || "main";

const ERC20_ABI = [
  { name: "balanceOf", type: "function", stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }] },
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
  throw new Error("All RPC endpoints rate limited");
}

const DEFAULT_TOKENS = [
  { symbol: "DEGEN",   address: "0x4ed4e862860bed51a9570b96d89af5e1b0efefed", feeTier: 3000  },
  { symbol: "TOSHI",   address: "0xAC1Bd2486aAf3B5C0fc3Fd868558b082a531B2B4", feeTier: 3000  },
  { symbol: "BRETT",   address: "0x532f27101965dd16442E59d40670FaF5eBB142E4", feeTier: 3000  },
  { symbol: "AERO",    address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631", feeTier: 3000  },
  { symbol: "VIRTUAL", address: "0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b", feeTier: 3000  },
  { symbol: "AIXBT",   address: "0x4F9Fd6Be4a90f2620860d680c0d4d5Fb53d1A825", feeTier: 3000  },
  { symbol: "CLANKER", address: "0x1bc0c42215582d5a085795f4badbac3ff36d1bcb", feeTier: 10000 },
  { symbol: "SEAM",    address: "0x1C7a460413dD4e964f96D8dFC56E7223cE88CD85", feeTier: 3000  },
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
let manualCommands = [];

// Per-token timer state — persists across loop cycles
// sellTimer: { startMs, highSeen, phase: 'watching'|'countdown', countdownFired }
// buyTimer:  { startMs, anchorPrice, phase: 'watching'|'countdown', countdownFired }
const sellTimers = {};
const buyTimers  = {};
const waveState  = {};

// Trade log for transparency
const tradeLog = [];

// ── CDP ───────────────────────────────────────────────────────────────────
function createCdpClient() {
  const apiKeySecret = (process.env.CDP_API_KEY_SECRET || "").replace(/\\n/g, "\n");
  return new CdpClient({
    apiKeyId: process.env.CDP_API_KEY_ID || "",
    apiKeySecret,
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
      message: `Guardian ${new Date().toISOString()}`,
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
      ...def, status: "active", entryPrice: null, entryPriceUsd: null,
      totalInvestedEth: 0, entryTime: null, halfSoldThisCycle: false, halfCascadeTime: 0,
      ...(saved.find(s => s.symbol === def.symbol) || {}),
    }));
    tokensSha = tf.sha;
  } else {
    tokens = DEFAULT_TOKENS.map(t => ({
      ...t, status: "active", entryPrice: null, entryPriceUsd: null,
      totalInvestedEth: 0, entryTime: null, halfSoldThisCycle: false, halfCascadeTime: 0,
    }));
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
        t.entryPrice        = pos.entries[t.symbol];
        t.entryPriceUsd     = pos.entriesUsd?.[t.symbol] || null;
        t.totalInvestedEth  = pos.invested?.[t.symbol]   || 0;
        t.entryTime         = pos.entryTimes?.[t.symbol] || null;
      }
    }
    const restored = tokens.filter(t => t.entryPrice).map(t => t.symbol).join(", ");
    console.log(`✅ 8 tokens | Positions: ${restored || "none"}`);
    console.log(`✅ Piggy: ${piggyBank.toFixed(6)} ETH | Trades: ${tradeCount}`);
  }
}

// ── BOOTSTRAP WAVES ───────────────────────────────────────────────────────
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
    ws.peaks   = peaks.slice(-(WAVE_COUNT + 2));
    ws.troughs = troughs.slice(-(WAVE_COUNT + 2));
    const sortedP = getWavePeaks(symbol);
    const sortedT = getWaveTroughs(symbol);
    if (sortedP.length || sortedT.length)
      console.log(`   ✅ ${symbol}: ${sortedP.length}P ${sortedT.length}T | best peak: $${sortedP[sortedP.length-1]?.toFixed(8)||"?"}`);
  }
  console.log("✅ Wave bootstrap done\n");
}

async function saveToGitHub() {
  try {
    console.log("💾 Saving...");
    tokensSha    = await githubSave("tokens.json",  { tokens, lastSaved: new Date().toISOString() }, tokensSha);
    historySha   = await githubSave("history.json", history, historySha);
    positionsSha = await githubSave("positions.json", {
      lastSaved:   new Date().toISOString(),
      piggyBank, totalSkimmed, tradeCount,
      entries:    Object.fromEntries(tokens.map(t => [t.symbol, t.entryPrice        || null])),
      entriesUsd: Object.fromEntries(tokens.map(t => [t.symbol, t.entryPriceUsd     || null])),
      invested:   Object.fromEntries(tokens.map(t => [t.symbol, t.totalInvestedEth  || 0])),
      entryTimes: Object.fromEntries(tokens.map(t => [t.symbol, t.entryTime         || null])),
      tradeLog:   tradeLog.slice(-100),
    }, positionsSha);
    lastSaveTime = Date.now();
    console.log("✅ Saved");
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

async function getTokenBalance(address) {
  try {
    return Number(await rpcCall(c => c.readContract({
      address, abi: ERC20_ABI, functionName: "balanceOf", args: [WALLET_ADDRESS],
    }))) / 1e18;
  } catch { return 0; }
}

async function getWethBalance() {
  try {
    return parseFloat(formatEther(await rpcCall(c => c.readContract({
      address: WETH_ADDRESS, abi: ERC20_ABI, functionName: "balanceOf", args: [WALLET_ADDRESS],
    }))));
  } catch { return 0; }
}

async function estimateGasCostEth() {
  try {
    return parseFloat(formatEther((await rpcCall(c => c.getGasPrice())) * BigInt(200000)));
  } catch { return 0.0001; }
}

function getTradeableEth(ethBal) {
  return Math.max(ethBal - GAS_RESERVE - SELL_RESERVE - piggyBank, 0);
}

// ═══════════════════════════════════════════════════════════════════════
// ⚡ 4-WAVE ENGINE
// ═══════════════════════════════════════════════════════════════════════

function initWaveState(symbol) {
  if (!waveState[symbol]) waveState[symbol] = { peaks: [], troughs: [] };
  return waveState[symbol];
}

function updateWaves(symbol) {
  const ws = initWaveState(symbol);
  const s  = priceStreams[symbol] || [];
  if (s.length < 5) return;
  const r = s.slice(-5).map(x => x.price);
  const m = r[2];
  if (m > r[0] && m > r[1] && m > r[3] && m > r[4]) {
    const l = ws.peaks[ws.peaks.length-1];
    if (!l || Math.abs(m-l)/l > WAVE_MIN_MOVE) {
      ws.peaks.push(m);
      if (ws.peaks.length > WAVE_COUNT+2) ws.peaks.shift();
      console.log(`   📈 [${symbol}] Peak: $${m.toFixed(8)}`);
    }
  }
  if (m < r[0] && m < r[1] && m < r[3] && m < r[4]) {
    const l = ws.troughs[ws.troughs.length-1];
    if (!l || Math.abs(m-l)/l > WAVE_MIN_MOVE) {
      ws.troughs.push(m);
      if (ws.troughs.length > WAVE_COUNT+2) ws.troughs.shift();
      console.log(`   📉 [${symbol}] Trough: $${m.toFixed(8)}`);
    }
  }
}

function getWavePeaks(symbol) {
  return [...(waveState[symbol]?.peaks || [])].slice(-WAVE_COUNT).sort((a,b) => a-b);
}
function getWaveTroughs(symbol) {
  return [...(waveState[symbol]?.troughs || [])].slice(-WAVE_COUNT).sort((a,b) => a-b);
}
function avg(arr) { return arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : null; }

function getMomentum(symbol, n = 5) {
  const s = priceStreams[symbol] || [];
  if (s.length < 3) return { direction: "neutral", pct: 0 };
  const recent = s.slice(-Math.min(n, s.length));
  const first  = recent[0].price;
  const last   = recent[recent.length-1].price;
  const pct    = (last - first) / first * 100;
  return {
    direction: pct > 0.05 ? "up" : pct < -0.05 ? "down" : "neutral",
    pct,
  };
}

function countWaveLowsBroken(symbol, price) {
  return getWaveTroughs(symbol).filter(t => price > t).length;
}

// Sell target = highest average of all 4 peaks (the true goal line)
function getSellTarget(symbol) {
  const peaks = getWavePeaks(symbol);
  if (peaks.length < 2) return null;
  return avg(peaks); // average of all 4 peaks = target
}

// Buy target = 3rd-lowest trough
function getBuyTarget(symbol) {
  const troughs = getWaveTroughs(symbol);
  if (troughs.length < 3) return null;
  return troughs[BOTTOM_TARGET_RANK];
}

// Is price within PCT of target (above or below)
function isNearPrice(price, target, pct = 0.02) {
  if (!target) return false;
  return Math.abs(price - target) / target <= pct;
}

// Is price slowing at peak? (3 consecutive smaller moves)
function isMomentumSlowing(symbol) {
  const s = priceStreams[symbol] || [];
  if (s.length < 6) return false;
  const r = s.slice(-6).map(x => x.price);
  const moves = [];
  for (let i = 1; i < r.length; i++) moves.push(Math.abs(r[i] - r[i-1]));
  // last 3 moves smaller than first 3 = slowing
  const early = (moves[0]+moves[1]+moves[2]) / 3;
  const late  = (moves[3]+moves[4]+moves[5]) / 3;
  return late < early * 0.7;
}

function getCascadeScore(symbol, price) {
  const lb  = countWaveLowsBroken(symbol, price);
  const mom = getMomentum(symbol);
  const bt  = getBuyTarget(symbol);
  const nearBuy = bt && isNearPrice(price, bt, 0.02);
  return (lb * 2) + (mom.direction === "up" ? Math.abs(mom.pct) * 10 : 0) + (nearBuy ? 3 : 0);
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
  return elapsed >= COOLDOWN_MS;
}

// ── PROFIT GATE ───────────────────────────────────────────────────────────
// All numbers in ETH. Returns {ok, reason}
// ── PROFIT GATE ─────────────────────────────────────────────────────────
// Simple: gas check only. Price-vs-entry checked at call site.
async function profitGate(proceedsEth, entryEth, isProtective) {
  const gasCost = await estimateGasCostEth();
  if (gasCost > MAX_GAS_ETH) return { ok: false, reason: `Gas spike: ${gasCost.toFixed(6)} ETH` };
  if (proceedsEth * ETH_USD < 0.50) return { ok: false, reason: `Too small: $${(proceedsEth*ETH_USD).toFixed(2)}` };
  return { ok: true };
}

// ── RACEHORSE DISPLAY ─────────────────────────────────────────────────────
function buildRaceDisplay(token, price, balance) {
  const entry   = token.entryPrice;       // token price at entry (USD per token)
  const invEth  = token.totalInvestedEth || 0;
  const invUsd  = invEth * ETH_USD;
  if (!entry || entry <= 0) return null;

  const sellTarget  = getSellTarget(token.symbol);
  // Sell target must be ABOVE entry or it's meaningless
  const validTarget = sellTarget && sellTarget > entry ? sellTarget : null;

  const lottery  = Math.floor(balance * LOTTERY_PCT);
  const sellable = Math.max(balance - lottery, 0);
  const nowUsd   = sellable * price;
  const tgtUsd   = validTarget ? sellable * validTarget : null;

  // P&L: current value vs what we paid
  const pnlUsd  = nowUsd - invUsd;
  const pnlPct  = invUsd > 0 ? (pnlUsd / invUsd * 100) : 0;

  // Race % = how far from entry to target
  const raceRange = validTarget && validTarget > entry ? validTarget - entry : 0;
  const racePct   = raceRange > 0 ? Math.max(0, Math.min(100, (price - entry) / raceRange * 100)) : 0;
  const barFill   = Math.floor(racePct / 10);
  const raceBar   = "🟩".repeat(barFill) + "⬜".repeat(10 - barFill);

  return {
    bar: raceBar, racePct: racePct.toFixed(1),
    nowUsd: nowUsd.toFixed(2),
    tgtUsd: tgtUsd?.toFixed(2) || "?",
    invUsd: invUsd.toFixed(2),
    pnlUsd: pnlUsd.toFixed(2),
    pnlPct: pnlPct.toFixed(1),
    pnlSign: pnlUsd >= 0 ? "+" : "",
    sellTarget: validTarget,
    entry, balance, sellable, lottery,
    lines: [
      `🏇 [${raceBar}] ${racePct.toFixed(1)}% to target`,
      `📥 Entry:  $${entry.toFixed(8)} | Invested: $${invUsd.toFixed(2)} (${invEth.toFixed(6)} ETH)`,
      `💲 NOW:    $${price.toFixed(8)} | Sell now → ~$${nowUsd.toFixed(2)}`,
      `🎯 TARGET: $${validTarget?.toFixed(8)||"?"} | At target → ~$${tgtUsd?.toFixed(2)||"?"}`,
      `${pnlUsd>=0?"📈":"📉"} P&L now: ${pnlUsd>=0?"+":""}$${pnlUsd.toFixed(2)} (${pnlPct>=0?"+":""}${pnlPct.toFixed(1)}%)`,
      `🪙 ${Math.floor(balance)} tokens ($${(balance*price).toFixed(2)}) | 🎰 ${lottery} lottery forever`,
    ].join("\n"),
  };
}

// ── COUNTDOWN RUNNER ─────────────────────────────────────────────────────
// Runs independently for sell OR buy, fires at milestones then executes
async function runSellCountdown(cdp, token, triggerPrice, reason, raceLines) {
  const sym = token.symbol;
  console.log(`\n  🔴 SELL COUNTDOWN STARTING: ${sym} — ${reason}`);

  await sendAlert(
    `🔴 <b>${sym} SELLING IN 2 MINUTES</b>\n\n` +
    (raceLines || `💲 $${triggerPrice.toFixed(8)}`) + "\n\n" +
    `📊 Trigger: ${reason}\n` +
    `⏳ Countdown: 2:00 → SELL\n` +
    `📱 /sell ${sym} to sell IMMEDIATELY`
  );

  const startMs = Date.now();
  let firedAt   = new Set();

  while (true) {
    const elapsed   = Date.now() - startMs;
    const remaining = Math.max(0, SELL_WATCH_MS - elapsed);
    const remSec    = Math.ceil(remaining / 1000);
    const curPrice  = history[sym]?.lastPrice || triggerPrice;

    // If price moved up 1%+ — new high, keep riding, reset
    if (curPrice > triggerPrice * 1.01) {
      console.log(`  ⬆️  ${sym} new high $${curPrice.toFixed(8)} — countdown reset, trailing`);
      await sendAlert(
        `⬆️ <b>${sym} NEW HIGH — countdown reset</b>\n\n` +
        `💲 $${curPrice.toFixed(8)} (+${((curPrice-triggerPrice)/triggerPrice*100).toFixed(2)}%)\n` +
        `🏇 Still riding — timer restarted\n` +
        `📱 /sell ${sym} to sell NOW`
      );
      // Update trigger and restart
      if (sellTimers[sym]) { sellTimers[sym].startMs = Date.now(); sellTimers[sym].highSeen = curPrice; }
      return; // exit, processToken will re-enter countdown
    }

    // Milestone alerts
    const milestones = [60, 30, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
    for (const m of milestones) {
      if (remSec <= m && !firedAt.has(m)) {
        firedAt.add(m);
        if (m <= 10) {
          console.log(`  🔴 ${sym} T-${remSec}...`);
          await sendAlert(`🔴 <b>${sym} — ${remSec} SECONDS</b>`);
        } else if (m === 30) {
          await sendAlert(`⏱️ <b>${sym} — 30 SECONDS TO SELL</b>\n💲 $${curPrice.toFixed(8)}`);
        } else if (m === 60) {
          const bal = await getTokenBalance(token.address);
          const rd  = buildRaceDisplay(token, curPrice, bal);
          await sendAlert(
            `⏱️ <b>${sym} — 1 MINUTE TO SELL</b>\n\n` +
            (rd?.lines || `💲 $${curPrice.toFixed(8)}`) + "\n\n" +
            `📱 /sell ${sym} to sell NOW`
          );
        }
      }
    }

    // TIME IS UP — EXECUTE
    if (remaining <= 0) {
      console.log(`\n  🔔 ${sym} COUNTDOWN ZERO — EXECUTING`);
      const finalPrice = history[sym]?.lastPrice || triggerPrice;
      const bal        = await getTokenBalance(token.address);
      const sellable   = Math.max(bal - Math.floor(bal * LOTTERY_PCT), 0);

      if (sellable < 1) {
        await sendAlert(`⚠️ <b>${sym}</b> — countdown done but nothing to sell`);
        delete sellTimers[sym];
        return;
      }

      // Final profit gate check
      const entryEth  = token.totalInvestedEth || 0;
      const procEth   = (sellable * finalPrice) / ETH_USD;
      const gate      = await profitGate(procEth, entryEth, false);

      if (!gate.ok) {
        console.log(`  🛑 ${sym} profit gate blocked at T-0: ${gate.reason}`);
        await sendAlert(
          `🛑 <b>${sym} BLOCKED AT T-0</b>\n\n${gate.reason}\n\n` +
          `💲 $${finalPrice.toFixed(8)} | Entry: $${token.entryPrice?.toFixed(8)}\n` +
          `Will hold — wave conditions no longer valid\n` +
          `📱 /sell ${sym} to force sell`
        );
        delete sellTimers[sym];
        return;
      }

      delete sellTimers[sym];
      const rd = buildRaceDisplay(token, finalPrice, bal);
      await sendAlert(
        `🔔 <b>${sym} T-0 — EXECUTING SELL NOW</b>\n\n` +
        (rd?.lines || `💲 $${finalPrice.toFixed(8)}`) + "\n\n" +
        `⚡ Transaction sending...`
      );
      const proceeds = await executeSell(cdp, token, SELL_ALL_PCT, `⏱️ COUNTDOWN: ${reason}`, finalPrice, false);
      if (proceeds > 0) {
        const ethBal = await getEthBalance();
        await triggerCascade(cdp, sym, proceeds, ethBal);
      }
      return;
    }

    await sleep(1000);
  }
}

async function runBuyCountdown(cdp, token, triggerPrice, reason) {
  const sym = token.symbol;
  console.log(`\n  🟢 BUY COUNTDOWN STARTING: ${sym} — ${reason}`);

  await sendAlert(
    `🟢 <b>${sym} BUY IN 10 SECONDS</b>\n\n` +
    `💲 $${triggerPrice.toFixed(8)}\n` +
    `📊 ${reason}\n` +
    `⏳ 10..9..8..7..6..5..4..3..2..1..BUY!\n` +
    `📱 /buy ${sym} to buy NOW`
  );

  for (let i = 10; i >= 1; i--) {
    const curPrice = history[sym]?.lastPrice || triggerPrice;
    // If price shot up more than 2% — missed it, abort
    if (curPrice > triggerPrice * 1.02) {
      console.log(`  ↗️  ${sym} price moved away — buy countdown aborted`);
      await sendAlert(`↗️ <b>${sym} buy aborted</b> — price moved up ${((curPrice-triggerPrice)/triggerPrice*100).toFixed(1)}%`);
      delete buyTimers[sym];
      return;
    }
    console.log(`  🟢 ${sym} BUY IN ${i}...`);
    await sendAlert(`🟢 <b>${sym} — BUY IN ${i}...</b>`);
    await sleep(1000);
  }

  // EXECUTE BUY
  console.log(`\n  🔔 ${sym} BUY COUNTDOWN ZERO — EXECUTING`);
  await sendAlert(`🔔 <b>${sym} — BUYING NOW!</b>\n⚡ Transaction sending...`);
  delete buyTimers[sym];
  const ethBal    = await getEthBalance();
  const tradeable = getTradeableEth(ethBal);
  const curPrice  = history[sym]?.lastPrice || triggerPrice;
  await executeBuy(cdp, token, tradeable, `⏱️ BUY COUNTDOWN: ${reason}`, curPrice);
}

// ── ENCODE ────────────────────────────────────────────────────────────────
function encodeSwap(tokenIn, tokenOut, amountIn, recipient, fee = 3000) {
  const p = (v, isAddr = false) => (isAddr ? v.slice(2) : BigInt(v).toString(16)).padStart(64, "0");
  return "0x04e45aaf" + p(tokenIn,true) + p(tokenOut,true) + p(fee) + p(recipient,true) + p(amountIn) + p(0) + p(0);
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
  console.log(`      🔓 Approving ${tokenAddress}...`);
  await cdp.evm.sendTransaction({ address: WALLET_ADDRESS, network: "base", transaction: { to: tokenAddress, data: encodeApprove(SWAP_ROUTER, MAX) } });
  approvedTokens.add(key);
  await sleep(8000);
}

// ── BUY ───────────────────────────────────────────────────────────────────
async function executeBuy(cdp, token, tradeableEth, reason, price, forcedEth = 0) {
  try {
    if (!canTrade(token.symbol)) { console.log(`   ⏳ ${token.symbol} cooldown`); return false; }
    const wethBal    = await getWethBalance();
    const totalAvail = tradeableEth + wethBal;
    if (totalAvail < MIN_ETH_TRADE) { console.log(`   🛑 Not enough ETH`); return false; }

    const troughs   = getWaveTroughs(token.symbol);
    const isDeep    = troughs.length >= 1 && price <= troughs[0] * 1.02;
    const maxBuy    = totalAvail * MAX_BUY_PCT * (isDeep ? DEEP_BONUS : 1);
    const minBuy    = MIN_ENTRY_USD / ETH_USD;
    const ethToSpend = forcedEth > 0 ? Math.min(forcedEth, maxBuy) : Math.min(Math.max(minBuy, totalAvail * 0.05), maxBuy);

    const amountIn = parseEther(ethToSpend.toFixed(18));
    const useWeth  = wethBal >= ethToSpend;
    const peaks    = getWavePeaks(token.symbol);
    const sellTgt  = getSellTarget(token.symbol);

    console.log(`\n   🟢 BUY ${token.symbol} — ${reason}`);
    console.log(`      ${ethToSpend.toFixed(6)} ${useWeth?"WETH":"ETH"} @ $${price.toFixed(8)}${isDeep?" 🔥 DEEP":""}`);
    console.log(`      Sell target (avg peaks): $${sellTgt?.toFixed(8)||"?"}`);

    let txHash;
    if (useWeth) {
      await ensureApproved(cdp, WETH_ADDRESS, amountIn);
      const { transactionHash } = await cdp.evm.sendTransaction({ address: WALLET_ADDRESS, network: "base", transaction: { to: SWAP_ROUTER, data: encodeSwap(WETH_ADDRESS, token.address, amountIn, WALLET_ADDRESS, token.feeTier) } });
      txHash = transactionHash;
    } else {
      const { transactionHash } = await cdp.evm.sendTransaction({ address: WALLET_ADDRESS, network: "base", transaction: { to: SWAP_ROUTER, value: amountIn, data: encodeSwap(WETH_ADDRESS, token.address, amountIn, WALLET_ADDRESS, token.feeTier) } });
      txHash = transactionHash;
    }

    // Record entry — entryPrice is token price in USD, totalInvestedEth in ETH
    lastTradeTime[token.symbol] = Date.now();
    tradeCount++;
    token.entryPrice       = price;
    token.entryPriceUsd    = price;
    token.totalInvestedEth = (token.totalInvestedEth || 0) + ethToSpend;
    token.entryTime        = Date.now();
    token.halfSoldThisCycle = false;
    delete sellTimers[token.symbol];
    delete buyTimers[token.symbol];

    // Trade log entry
    tradeLog.push({ type: "BUY", symbol: token.symbol, price, ethSpent: ethToSpend, timestamp: new Date().toISOString(), tx: txHash });

    console.log(`      ✅ https://basescan.org/tx/${txHash}`);
    await sendAlert(
      `🟢🟢🟢 <b>BOUGHT ${token.symbol}!</b>\n\n` +
      `💰 ${ethToSpend.toFixed(6)} ${useWeth?"WETH":"ETH"} (~$${(ethToSpend*ETH_USD).toFixed(2)})\n` +
      `💲 Entry: $${price.toFixed(8)}\n` +
      `🎯 Sell target (avg peaks): $${sellTgt?.toFixed(8)||"learning"}\n` +
      (isDeep ? `🔥 NEAR ABSOLUTE BOTTOM — bigger position!\n` : "") +
      `📊 ${reason}\n` +
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
    if (!canTrade(token.symbol)) { console.log(`   ⏳ ${token.symbol} cooldown`); return null; }
    const totalBal    = await getTokenBalance(token.address);
    const lotteryHold = Math.max(Math.floor(totalBal * LOTTERY_PCT), 1);
    const sellable    = Math.max(totalBal - lotteryHold, 0);
    if (sellable < 1) { console.log(`   ⏳ Nothing to sell`); return null; }

    // NEVER sell below entry (non-protective)
    if (!isProtective && token.entryPrice && price < token.entryPrice) {
      console.log(`   🛑 ${token.symbol}: price $${price.toFixed(8)} BELOW entry $${token.entryPrice.toFixed(8)} — holding`);
      await sendAlert(`🛑 <b>${token.symbol} BLOCKED</b>\nPrice below entry — will not sell at a loss\n📱 /sell ${token.symbol} to force`);
      return null;
    }

    const amtToSell = BigInt(Math.floor(sellable * sellPct * 1e18));
    if (amtToSell === BigInt(0)) return null;

    // Profit gate — all in ETH
    const procEth  = (sellable * sellPct * price) / ETH_USD;
    const entryEth = isProtective ? 0 : (token.totalInvestedEth * sellPct || 0);
    const gate     = await profitGate(procEth, entryEth, isProtective);
    if (!gate.ok) { console.log(`   🛑 SELL BLOCKED: ${gate.reason}`); return null; }

    console.log(`\n   🔴 SELL ${token.symbol} ${(sellPct*100).toFixed(0)}% — ${reason}`);
    console.log(`      ${sellable.toFixed(0)} tokens @ $${price.toFixed(8)} | keeping ${lotteryHold} forever`);

    await ensureApproved(cdp, token.address, amtToSell);
    const wBefore = await getWethBalance();
    const eBefore = await getEthBalance();

    const { transactionHash } = await cdp.evm.sendTransaction({
      address: WALLET_ADDRESS, network: "base",
      transaction: { to: SWAP_ROUTER, data: encodeSwap(token.address, WETH_ADDRESS, amtToSell, WALLET_ADDRESS, token.feeTier) },
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
    if (received > 0) { skim = received * PIGGY_SKIM_PCT; piggyBank += skim; totalSkimmed += skim; }

    if (sellPct >= SELL_ALL_PCT) {
      token.entryPrice = null; token.entryPriceUsd = null;
      token.totalInvestedEth = 0; token.entryTime = null;
      token.halfSoldThisCycle = false;
    }
    delete sellTimers[token.symbol];

    // Trade log
    tradeLog.push({ type: "SELL", symbol: token.symbol, price, receivedEth: received, netUsd, timestamp: new Date().toISOString(), tx: transactionHash, reason });

    console.log(`      ✅ https://basescan.org/tx/${transactionHash}`);
    console.log(`      💰 Received: ${received.toFixed(6)} ETH ($${recUsd.toFixed(2)}) | Net: ${netUsd>=0?"+":""}$${netUsd.toFixed(2)}`);

    await sendAlert(
      `🔴🔴🔴 <b>SOLD ${token.symbol}!</b>\n\n` +
      `💰 Received: ${received.toFixed(6)} ETH (~$${recUsd.toFixed(2)})\n` +
      `📥 Invested: ~$${invUsd.toFixed(2)}\n` +
      `${netUsd>=0?"📈":"📉"} Net: ${netUsd>=0?"+":""}$${netUsd.toFixed(2)}\n` +
      `💲 Exit: $${price.toFixed(8)}\n` +
      `🎰 ${lotteryHold} ${token.symbol} kept forever\n` +
      `🐷 Skim: ${skim.toFixed(6)} ETH | Piggy: ${piggyBank.toFixed(6)} ETH\n` +
      `📊 ${reason}\n` +
      `🔗 <a href="https://basescan.org/tx/${transactionHash}">Basescan</a>`
    );
    return Math.max(received - skim, 0);
  } catch (e) {
    console.log(`      ❌ SELL FAILED: ${e.message}`);
    await sendAlert(`⚠️ <b>${token.symbol} SELL FAILED</b>\n${e.message}`);
    return null;
  }
}

async function triggerCascade(cdp, soldSymbol, proceeds, ethBal) {
  try {
    const target = await findCascadeTarget(soldSymbol);
    if (!target) { console.log(`  🌊 No cascade target`); return; }
    const price = history[target.symbol]?.lastPrice;
    if (!price) return;
    const score = getCascadeScore(target.symbol, price);
    console.log(`  🌊 CASCADE ${soldSymbol} → ${target.symbol} score:${score.toFixed(1)}`);
    await sendAlert(
      `🌊 <b>CASCADE: ${soldSymbol} → ${target.symbol}</b>\n` +
      `💰 ${proceeds.toFixed(6)} ETH | Score: ${score.toFixed(2)}\n` +
      `💲 $${price.toFixed(8)} | Lows broken: ${countWaveLowsBroken(target.symbol, price)}\n⚡ Buying...`
    );
    await executeBuy(cdp, target, getTradeableEth(ethBal), `🌊 CASCADE from ${soldSymbol}`, price, proceeds * 0.95);
  } catch (e) { console.log(`  ⚠️ Cascade error: ${e.message}`); }
}

// ═══════════════════════════════════════════════════════════════════════
// 🔄 PROCESS ONE TOKEN — main logic
// ═══════════════════════════════════════════════════════════════════════
async function processToken(cdp, token, ethBal) {
  try {
    const price = await getTokenPrice(token.address);
    if (!price) { console.log(`   ⏳ ${token.symbol}: no price`); return; }

    if (!priceStreams[token.symbol]) priceStreams[token.symbol] = [];
    priceStreams[token.symbol].push({ price, time: Date.now() });
    if (priceStreams[token.symbol].length > 500) priceStreams[token.symbol].shift();
    recordPrice(token.symbol, price);
    updateWaves(token.symbol);

    const balance    = await getTokenBalance(token.address);
    const mom        = getMomentum(token.symbol);
    const peaks      = getWavePeaks(token.symbol);
    const troughs    = getWaveTroughs(token.symbol);
    const avgPeakVal = avg(peaks);
    const avgTrghVal = avg(troughs);
    const sellTarget = getSellTarget(token.symbol);    // avg of 4 peaks = goal
    const buyTarget  = getBuyTarget(token.symbol);     // 3rd-lowest trough
    const lb         = countWaveLowsBroken(token.symbol, price);
    const tradeEth   = getTradeableEth(ethBal);
    const wethBal    = await getWethBalance();
    const totalAvail = tradeEth + wethBal;
    const entry      = token.entryPrice;
    const lottery    = Math.floor(balance * LOTTERY_PCT);
    const sellable   = Math.max(balance - lottery, 0);
    const slowing    = isMomentumSlowing(token.symbol);

    // Validate sell target must be above entry
    const validSellTarget = sellTarget && (!entry || sellTarget > entry * 1.003);

    // Racehorse display
    const rd = entry ? buildRaceDisplay(token, price, balance) : null;

    // ── DETERMINE ZONE ─────────────────────────────────────────────────
    // SELL IMMEDIATELY when price hits the highest of the 4 peaks — no timer, no async
    const highestPeak   = peaks.length ? peaks[peaks.length - 1] : null; // sorted asc, last = highest
    const atHighestPeak = highestPeak && price >= highestPeak * 0.995;   // within 0.5% of highest
    const nearBuy       = buyTarget && isNearPrice(price, buyTarget, 0.015);
    // sellNow: price at highest peak AND we have a position — sell regardless of P&L (gas gate still applies)
    const sellNow       = atHighestPeak && entry && sellable > 1;
    const buyZone       = nearBuy && !entry && totalAvail >= MIN_ETH_TRADE;

    const zone   = sellNow ? "🔴 AT PEAK — SELLING" : buyZone ? "🟢 BUY ZONE" : entry ? "🏇 RIDING" : "⬜ WATCHING";
    const pnlStr = entry ? ` | P&L: ${((price-entry)/entry*100).toFixed(1)}%` : "";

    // ── LOG ────────────────────────────────────────────────────────────
    console.log(`\n  ┌─ [${token.symbol}] ${zone} | $${price.toFixed(8)}${pnlStr}`);
    console.log(`  │ 🪙 ${Math.floor(balance)} ($${(balance*price).toFixed(2)}) | mom:${mom.direction}(${mom.pct.toFixed(3)}%) slowing:${slowing}`);
    console.log(`  │ Peaks(${peaks.length}): ${peaks.map(p=>"$"+p.toFixed(6)).join(" ")} → avg $${avgPeakVal?.toFixed(8)||"?"}`);
    console.log(`  │ Troughs(${troughs.length}): ${troughs.map(t=>"$"+t.toFixed(6)).join(" ")} → avg $${avgTrghVal?.toFixed(8)||"?"}`);
    if (buyTarget && !entry)  console.log(`  │ 🛒 Buy target:  $${buyTarget.toFixed(8)} (${((price-buyTarget)/buyTarget*100).toFixed(2)}% away)`);
    if (validSellTarget)      console.log(`  │ 🎯 Sell target: $${sellTarget.toFixed(8)} (${((price-sellTarget)/sellTarget*100).toFixed(2)}% away)`);
    if (rd) console.log(`  │ 🏇 [${rd.bar}] ${rd.racePct}% | P&L: ${rd.pnlSign}$${rd.pnlUsd} | sell→~$${rd.nowUsd}`);
    console.log(`  └─────────────────────────────────────────────`);

    // ── MANUAL COMMANDS ────────────────────────────────────────────────
    const mi = manualCommands.findIndex(c => c.symbol === token.symbol);
    if (mi !== -1) {
      const cmd = manualCommands.splice(mi, 1)[0];
      delete sellTimers[token.symbol]; delete buyTimers[token.symbol];
      if (cmd.action === "buy") {
        await executeBuy(cdp, token, tradeEth, "MANUAL BUY", price);
      } else if (cmd.action === "sell") {
        const p = await executeSell(cdp, token, SELL_ALL_PCT, "MANUAL SELL", price, true);
        if (p > 0) await triggerCascade(cdp, token.symbol, p, ethBal);
      } else if (cmd.action === "sellhalf") {
        const p = await executeSell(cdp, token, 0.5, "MANUAL SELL HALF", price, true);
        if (p > 0) await triggerCascade(cdp, token.symbol, p, ethBal);
      }
      return;
    }

    // ── SELL LOGIC — IMMEDIATE AT HIGHEST PEAK ────────────────────────
    // No timers, no async loops. Every 30s cycle: if price >= highest peak and above entry → SELL.
    if (sellNow) {

      // Stop loss guard (protective)
      if (price < entry * (1 - STOP_LOSS_PCT) && token.entryTime && Date.now() - token.entryTime > STOP_LOSS_MS) {
        const p = await executeSell(cdp, token, SELL_ALL_PCT, `STOP LOSS ${((price-entry)/entry*100).toFixed(1)}%`, price, true);
        if (p > 0) await triggerCascade(cdp, token.symbol, p, ethBal);
        return;
      }

      // SELL — price has hit the highest of the 4 peaks and is above entry
      const reason = `🎯 HIT PEAK $${highestPeak.toFixed(8)} — selling for profit`;
      console.log(`  🔴 ${token.symbol} AT HIGHEST PEAK $${highestPeak.toFixed(8)} — SELLING NOW`);
      await sendAlert(
        `🔴🎯 <b>${token.symbol} PEAK HIT — SELLING NOW</b>\n\n` +
        (rd?.lines || `💲 $${price.toFixed(8)}`) + "\n\n" +
        `🎯 Highest peak: $${highestPeak.toFixed(8)}\n` +
        `📥 Entry: $${entry.toFixed(8)}\n` +
        `⚡ Executing sell...`
      );
      const proceeds = await executeSell(cdp, token, SELL_ALL_PCT, reason, price, false);
      if (proceeds > 0) await triggerCascade(cdp, token.symbol, proceeds, ethBal);
      return;

    // ── BUY ZONE LOGIC ──────────────────────────────────────────────────
    } else if (buyZone) {

      const bt = buyTimers[token.symbol];

      if (!bt) {
        // Start buy stabilize timer
        buyTimers[token.symbol] = { startMs: Date.now(), anchorPrice: price };
        console.log(`  ⏱️  ${token.symbol} BUY TIMER STARTED @ $${price.toFixed(8)}`);
        await sendAlert(
          `⏱️ <b>${token.symbol} NEAR BUY ZONE</b>\n\n` +
          `💲 $${price.toFixed(8)}\n` +
          `🎯 Buy target: $${buyTarget?.toFixed(8)}\n` +
          `📊 Sell target (avg peaks): $${sellTarget?.toFixed(8)||"?"}\n` +
          `⏳ Waiting 2min for price to float within 1%...\n` +
          `📱 /buy ${token.symbol} to buy IMMEDIATELY`
        );
      } else {
        // Check if price has stayed within 1% of anchor for 2 minutes
        const elapsed    = Date.now() - bt.startMs;
        const priceMoved = Math.abs(price - bt.anchorPrice) / bt.anchorPrice;

        if (priceMoved > BUY_FLOAT_PCT) {
          // Price moved more than 1% — reset the clock
          console.log(`  🔄 ${token.symbol} price moved ${(priceMoved*100).toFixed(2)}% — buy timer reset`);
          buyTimers[token.symbol] = { startMs: Date.now(), anchorPrice: price };
        } else if (elapsed >= BUY_STABLE_MS && mom.direction !== "down") {
          // 2 minutes stable, not falling — fire buy countdown!
          console.log(`  🟢 ${token.symbol} 2min STABLE — launching buy countdown!`);
          delete buyTimers[token.symbol];
          runBuyCountdown(cdp, token, price, `2min stable at buy zone $${buyTarget?.toFixed(8)}`).catch(e =>
            console.log(`  ⚠️ Buy countdown error (${token.symbol}): ${e.message}`)
          );
        } else {
          const remaining = Math.ceil((BUY_STABLE_MS - elapsed) / 1000);
          console.log(`  ⏳ ${token.symbol} buy stabilize: ${remaining}s | drift: ${(priceMoved*100).toFixed(3)}% | mom:${mom.direction}`);
        }
      }

    } else {
      // Left zones — clear timers
      if (sellTimers[token.symbol]) {
        console.log(`  ↘️  ${token.symbol} left sell zone — cancelling countdown`);
        await sendAlert(`↘️ <b>${token.symbol}</b> left sell zone — countdown cancelled\n💲 $${price.toFixed(8)}`);
        delete sellTimers[token.symbol];
      }
      if (buyTimers[token.symbol]) {
        console.log(`  ↗️  ${token.symbol} left buy zone — timer cleared`);
        delete buyTimers[token.symbol];
      }

      // Seed entry while building wave data
      if (!entry && token.status === "active" && troughs.length < 3 && totalAvail >= MIN_ETH_TRADE && peaks.length >= 1) {
        console.log(`  💵 ${token.symbol} seed entry — building wave data`);
        await executeBuy(cdp, token, tradeEth, `$${MIN_ENTRY_USD} seed`, price);
      }
    }

  } catch (e) { console.log(`  ⚠️ processToken error (${token.symbol}): ${e.message}`); }
}

// ── REPORTS ───────────────────────────────────────────────────────────────
async function sendFullReport(ethBal, title) {
  try {
    let lines = "";
    for (const t of tokens) {
      const price = history[t.symbol]?.lastPrice;
      if (!price) { lines += `\n⬜ <b>${t.symbol}</b> — no price\n`; continue; }
      const bal  = await getTokenBalance(t.address);
      const rd   = t.entryPrice ? buildRaceDisplay(t, price, bal) : null;
      const st   = getSellTarget(t.symbol);
      const bt   = getBuyTarget(t.symbol);
      const zone = sellTimers[t.symbol] ? "🔴" : buyTimers[t.symbol] ? "🟢" : t.entryPrice ? "🏇" : "⬜";
      lines += `\n${zone} <b>${t.symbol}</b> $${price.toFixed(8)} | 🪙 ${Math.floor(bal)} ($${(bal*price).toFixed(2)})\n`;
      if (rd) {
        lines += `   🏇 [${rd.bar}] ${rd.racePct}% | P&L: ${rd.pnlSign}$${rd.pnlUsd}\n`;
        lines += `   📥 Entry: $${t.entryPrice?.toFixed(8)} | sell→$${rd.nowUsd} | target→$${rd.tgtUsd}\n`;
        lines += `   📱 /sell ${t.symbol} | /sellhalf ${t.symbol}\n`;
      } else {
        if (bt) lines += `   🛒 Buy: $${bt.toFixed(8)}\n`;
        if (st) lines += `   🎯 Target: $${st.toFixed(8)}\n`;
      }
    }
    const weth = await getWethBalance();
    await sendAlert(
      `📊 <b>GUARDIAN v11.4 — ${title}</b>\n🕐 ${new Date().toLocaleTimeString()}\n\n` +
      `💰 ETH: ${ethBal.toFixed(6)} (~$${(ethBal*ETH_USD).toFixed(2)})\n` +
      `💎 WETH: ${weth.toFixed(6)} (~$${(weth*ETH_USD).toFixed(2)})\n` +
      `♻️ Tradeable: ${getTradeableEth(ethBal).toFixed(6)} ETH\n` +
      `🐷 Piggy: ${piggyBank.toFixed(6)} ETH ($${(piggyBank*ETH_USD).toFixed(2)})\n` +
      `📈 Trades: ${tradeCount} | Skimmed: ${totalSkimmed.toFixed(6)} ETH\n` +
      `─────────────────────────` + lines +
      `\n🔗 <a href="https://basescan.org/address/${WALLET_ADDRESS}">Basescan</a>`
    );
  } catch (e) { console.log(`Report error: ${e.message}`); }
}

async function sendReport(eth) {
  if (Date.now() - lastReportTime < REPORT_INTERVAL) return;
  lastReportTime = Date.now();
  await sendFullReport(eth, "⏰ 30 MIN REPORT");
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
        if (!tokens.find(t=>t.symbol===sym)) { await sendAlert(`❓ Unknown: ${sym}`); continue; }
        manualCommands.push({ symbol: sym, action: "buy" });
        await sendAlert(`📱 <b>BUY ${sym} queued</b>`);
      } else if (text.startsWith("/sell ") && !text.startsWith("/sellhalf")) {
        const sym = raw.split(" ")[1]?.toUpperCase();
        if (!tokens.find(t=>t.symbol===sym)) { await sendAlert(`❓ Unknown: ${sym}`); continue; }
        manualCommands.push({ symbol: sym, action: "sell" });
        await sendAlert(`📱 <b>SELL ${sym} queued</b>`);
      } else if (text.startsWith("/sellhalf ")) {
        const sym = raw.split(" ")[1]?.toUpperCase();
        if (!tokens.find(t=>t.symbol===sym)) { await sendAlert(`❓ Unknown: ${sym}`); continue; }
        manualCommands.push({ symbol: sym, action: "sellhalf" });
        await sendAlert(`📱 <b>SELL HALF ${sym} queued</b>`);
      } else if (text === "/status") {
        await sendFullReport(ethBal, "📊 STATUS");
      } else if (text === "/race") {
        let msg = `🏇 <b>RACEHORSE STANDINGS</b>\n🕐 ${new Date().toLocaleTimeString()}\n\n`;
        let any = false;
        for (const t of tokens) {
          if (!t.entryPrice) continue; any = true;
          const p  = history[t.symbol]?.lastPrice || t.entryPrice;
          const b  = await getTokenBalance(t.address);
          const rd = buildRaceDisplay(t, p, b);
          if (rd) { msg += `<b>${t.symbol}</b>\n${rd.lines}\n📱 /sell ${t.symbol} | /sellhalf ${t.symbol}\n\n`; }
        }
        if (!any) msg += "No open positions.";
        await sendAlert(msg);
      } else if (text === "/waves") {
        let msg = `🌊 <b>WAVE STATUS</b>\n🕐 ${new Date().toLocaleTimeString()}\n\n`;
        for (const t of tokens) {
          const p  = history[t.symbol]?.lastPrice;
          if (!p) continue;
          const pk = getWavePeaks(t.symbol), tr = getWaveTroughs(t.symbol);
          const st = getSellTarget(t.symbol), bt = getBuyTarget(t.symbol);
          const zone = sellTimers[t.symbol]?"🔴":buyTimers[t.symbol]?"🟢":t.entryPrice?"🏇":"⬜";
          msg += `${zone} <b>${t.symbol}</b> $${p.toFixed(8)}\n`;
          msg += `   Peaks avg: $${avg(pk)?.toFixed(8)||"?"} | Troughs avg: $${avg(tr)?.toFixed(8)||"?"}\n`;
          if (st) msg += `   🎯 Sell target: $${st.toFixed(8)}\n`;
          if (bt) msg += `   🛒 Buy target: $${bt.toFixed(8)}\n`;
          msg += "\n";
        }
        await sendAlert(msg);
      } else if (text === "/positions") {
        let msg = `📋 <b>POSITIONS</b>\n🕐 ${new Date().toLocaleTimeString()}\n\n`;
        let any = false;
        for (const t of tokens) {
          if (!t.entryPrice) continue; any = true;
          const p  = history[t.symbol]?.lastPrice || t.entryPrice;
          const b  = await getTokenBalance(t.address);
          const rd = buildRaceDisplay(t, p, b);
          msg += `<b>${t.symbol}</b>\n${rd?.lines||`$${p.toFixed(8)}`}\n📱 /sell ${t.symbol}\n\n`;
        }
        if (!any) msg += "No open positions.";
        await sendAlert(msg);
      } else if (text === "/eth") {
        const w = await getWethBalance();
        await sendAlert(`💰 <b>BALANCES</b>\nETH: ${ethBal.toFixed(6)} ($${(ethBal*ETH_USD).toFixed(2)})\nWETH: ${w.toFixed(6)} ($${(w*ETH_USD).toFixed(2)})\nTradeable: ${getTradeableEth(ethBal).toFixed(6)}\n🐷 Piggy: ${piggyBank.toFixed(6)} ETH`);
      } else if (text === "/piggy") {
        const pct = Math.min((piggyBank/0.5)*100,100);
        const bar = "█".repeat(Math.floor(pct/10))+"░".repeat(10-Math.floor(pct/10));
        await sendAlert(`🐷 <b>PIGGY BANK</b>\n${piggyBank.toFixed(6)} ETH ($${(piggyBank*ETH_USD).toFixed(2)})\nTotal: ${totalSkimmed.toFixed(6)} ETH\n[${bar}] ${pct.toFixed(1)}%`);
      } else if (text === "/trades") {
        const recent = tradeLog.slice(-5).map(t=>`${t.type} ${t.symbol} @ $${parseFloat(t.price).toFixed(8)} | ${t.timestamp?.slice(11,19)||""}`).join("\n");
        await sendAlert(`📈 <b>TRADES</b>\nCount: ${tradeCount}\nSkimmed: ${totalSkimmed.toFixed(6)} ETH\n🐷 ${piggyBank.toFixed(6)} ETH\n\n<b>Recent:</b>\n${recent||"none"}`);
      } else if (text === "/help") {
        await sendAlert(
          `⚔️ <b>GUARDIAN v11.4</b>\n\n` +
          `/status /race /waves /positions /eth /piggy /trades\n\n` +
          `/buy SYMBOL  /sell SYMBOL  /sellhalf SYMBOL\n\n` +
          `🌊 Buy: 2min stable at trough → 10s countdown → BUY\n` +
          `🔴 Sell: at/near avg peak OR slowing → 2min countdown → SELL\n` +
          `🏇 Half cascade: profit + better opportunity\n` +
          `🛡️ Gate: entry+gas×4+piggy — never sell at loss`
        );
      }
    }
  } catch {}
}

// ── MAIN ──────────────────────────────────────────────────────────────────
async function main() {
  console.log("═══════════════════════════════════════════════════════");
  console.log("⚔️   GUARDIAN CASCADE SYSTEM v11.4 — PEAK SELL EDITION");
  console.log("═══════════════════════════════════════════════════════\n");

  await loadFromGitHub();
  bootstrapWavesFromHistory();
  cdpClient = createCdpClient();

  const eth  = await getEthBalance();
  const weth = await getWethBalance();
  console.log(`✅ CDP ready | ETH: ${eth.toFixed(6)} | WETH: ${weth.toFixed(6)}`);

  await sendAlert(
    `⚔️ <b>GUARDIAN v11.4 — EXECUTION EDITION ONLINE</b>\n\n` +
    `👛 <code>${WALLET_ADDRESS}</code>\n` +
    `💰 ETH: ${eth.toFixed(6)} | WETH: ${weth.toFixed(6)}\n\n` +
    `🔴 Sell: at avg-peak OR slowing → 2min→SELL\n` +
    `🟢 Buy: 2min stable at trough → 10..1 → BUY\n` +
    `🏇 Racehorse: live % to target on every position\n` +
    `🛡️ Profit gate: entry+gas×4+piggy always covered\n\n` +
    `/help for commands`
  );

  let cachedEth = eth;

  // Telegram poller — independent 3s loop
  (async () => {
    while (true) {
      try { await checkTelegramCommands(cdpClient, cachedEth); } catch {}
      await sleep(3000);
    }
  })();

  // Main loop
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
        catch (e) { console.log(`⚠️ ${token.symbol}: ${e.message}`); }
        await sleep(4000);
      }

      await sendReport(eth);
      if (Date.now() - lastSaveTime > SAVE_INTERVAL) await saveToGitHub();
    } catch (e) {
      console.log(`⚠️ Main loop: ${e.message}`);
      await sendAlert(`⚠️ <b>GUARDIAN ERROR</b>\n${e.message}`);
    }
    await sleep(TRADE_LOOP_MS);
  }
}

main().catch(e => { console.log(`💀 Fatal: ${e.message}`); setTimeout(main, 30000); });
