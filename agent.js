import { CdpClient } from "@coinbase/cdp-sdk";
import { createPublicClient, http, formatEther, parseEther } from "viem";
import { base } from "viem/chains";
import dotenv from "dotenv";
dotenv.config();

// ═══════════════════════════════════════════════════════
// GUARDIAN CASCADE SYSTEM v6.2
// FIXES:
//  - GitHub saves every 30 mins ONLY (no more constant redeploys)
//  - Reports every 30 mins ONLY
//  - Added BRETT, AERO, VIRTUAL, AIXBT tokens
// ═══════════════════════════════════════════════════════

const WALLET_ADDRESS = "0x50e1C4608c48b0c52E1EA5FBabc1c9126eA17915";
const WETH_ADDRESS   = "0x4200000000000000000000000000000000000006";
const SWAP_ROUTER    = "0x2626664c2603336E57B271c5C0b26F421741e481";

// ── SAFETY ────────────────────────────────────────────────────────────────
const GAS_RESERVE      = 0.0003;
const MIN_ETH_TO_TRADE = 0.0008;
const MIN_TRADE_USD    = 0.50;
const FEE_SAFETY       = 3;
const COOLDOWN_MS      = 300000;   // 5 min between trades per token
const TRIGGER_PCT      = 0.02;
const PROFIT_TARGET    = 500;
const SAVE_INTERVAL    = 1800000;  // save to GitHub every 30 mins ONLY
const REPORT_INTERVAL  = 1800000;  // report every 30 mins ONLY
const INTERVAL         = 20000;    // check prices every 20 seconds
const ETH_USD          = 1940;

// ── GITHUB ────────────────────────────────────────────────────────────────
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

const publicClient = createPublicClient({ chain: base, transport: http() });

// ── STATE ─────────────────────────────────────────────────────────────────
let tokens         = [];
let history        = {};
let tokensSha      = null;
let historySha     = null;
let priceStreams    = {};
let lastTradeTime  = {};
let piggyBank      = 0;
let totalSkimmed   = 0;
let tradeCount     = 0;
let lastSaveTime   = 0;
let lastReportTime = 0;

// ── GITHUB OPS ────────────────────────────────────────────────────────────
async function githubGet(path) {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}?ref=${GITHUB_BRANCH}&t=${Date.now()}`,
      { headers: { Authorization: `token ${GITHUB_TOKEN}`, Accept: "application/vnd.github.v3+json" } }
    );
    if (!res.ok) return null;
    const data    = await res.json();
    const content = Buffer.from(data.content.replace(/\n/g,""), "base64").toString("utf8");
    return { content: JSON.parse(content), sha: data.sha };
  } catch (e) {
    console.log(`GitHub read error (${path}): ${e.message}`);
    return null;
  }
}

async function githubSave(path, content, sha) {
  try {
    const body = {
      message: `Guardian update ${new Date().toISOString()}`,
      content: Buffer.from(JSON.stringify(content, null, 2)).toString("base64"),
      branch: GITHUB_BRANCH,
    };
    if (sha) body.sha = sha;
    const res  = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`,
      { method: "PUT",
        headers: { Authorization: `token ${GITHUB_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify(body) }
    );
    const data = await res.json();
    return data?.content?.sha || null;
  } catch (e) {
    console.log(`GitHub save error (${path}): ${e.message}`);
    return null;
  }
}

async function loadFromGitHub() {
  console.log("📂 Loading from GitHub...");

  const tf = await githubGet("tokens.json");
  if (tf) {
    tokens    = tf.content.tokens || [];
    tokensSha = tf.sha;
    console.log(`✅ ${tokens.length} tokens loaded: ${tokens.map(t=>t.symbol).join(", ")}`);
  } else {
    console.log("⚠️  tokens.json not found — using defaults");
    tokens = [
      { symbol: "DEGEN",   address: "0x4ed4e862860bed51a9570b96d89af5e1b0efefed", status: "active",   lotteryTickets: 0,     entryPrice: null, totalInvested: 0 },
      { symbol: "TOSHI",   address: "0xAC1Bd2486aAf3B5C0fc3Fd868558b082a531B2B4", status: "watching", lotteryTickets: 46888, entryPrice: null, totalInvested: 0 },
      { symbol: "BRETT",   address: "0x532f27101965dd16442E59d40670FaF5eBB142E4", status: "watching", lotteryTickets: 0,     entryPrice: null, totalInvested: 0 },
      { symbol: "AERO",    address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631", status: "watching", lotteryTickets: 0,     entryPrice: null, totalInvested: 0 },
      { symbol: "VIRTUAL", address: "0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b", status: "watching", lotteryTickets: 0,     entryPrice: null, totalInvested: 0 },
      { symbol: "AIXBT",   address: "0x4F9Fd6Be4a90f2620860d680c0d4d5Fb53d1A825", status: "watching", lotteryTickets: 0,     entryPrice: null, totalInvested: 0 },
    ];
  }

  const hf = await githubGet("history.json");
  if (hf) {
    history    = hf.content || {};
    historySha = hf.sha;
    console.log(`✅ History loaded for: ${Object.keys(history).join(", ") || "none yet"}`);
  } else {
    console.log("⚠️  history.json not found — starting fresh");
    history = {};
  }
}

async function saveToGitHub() {
  // Only saves every 30 mins — does NOT trigger Railway redeploys
  // because Railway only redeploys when agent.js changes, not JSON data files
  console.log("💾 Saving to GitHub...");
  tokensSha  = await githubSave("tokens.json",  { tokens, lastSaved: new Date().toISOString() }, tokensSha);
  historySha = await githubSave("history.json", history, historySha);
  lastSaveTime = Date.now();
  console.log("✅ Saved to GitHub");
}

// ── TELEGRAM ──────────────────────────────────────────────────────────────
async function sendAlert(msg) {
  try {
    const token  = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return;
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: "HTML" }),
    });
  } catch (e) { console.log("Telegram error:", e.message); }
}

// ── PRICE FEED (dual source) ──────────────────────────────────────────────
async function getTokenPrice(address) {
  try {
    // Source 1 — GeckoTerminal
    const res  = await fetch(
      `https://api.geckoterminal.com/api/v2/simple/networks/base/token_price/${address.toLowerCase()}`
    );
    const data = await res.json();
    const p    = parseFloat(data?.data?.attributes?.token_prices?.[address.toLowerCase()]);
    if (!isNaN(p) && p > 0) return p;
  } catch {}

  try {
    // Source 2 — DexScreener fallback
    const res2  = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${address}`);
    const data2 = await res2.json();
    const pair  = data2?.pairs?.find(p => p.chainId === "base");
    const p2    = parseFloat(pair?.priceUsd);
    if (!isNaN(p2) && p2 > 0) return p2;
  } catch {}

  return null;
}

async function getEthBalance() {
  const bal = await publicClient.getBalance({ address: WALLET_ADDRESS });
  return parseFloat(formatEther(bal));
}

async function getTokenBalance(address) {
  const bal = await publicClient.readContract({
    address, abi: ERC20_ABI,
    functionName: "balanceOf", args: [WALLET_ADDRESS],
  });
  return Number(bal) / 1e18;
}

async function estimateGasCostEth() {
  try {
    const gasPrice = await publicClient.getGasPrice();
    return parseFloat(formatEther(gasPrice * BigInt(200000)));
  } catch { return 0.0001; }
}

function getTradeableEth(ethBalance) {
  return Math.max(ethBalance - GAS_RESERVE - piggyBank, 0);
}

// ── CYCLE HISTORY ─────────────────────────────────────────────────────────
function recordPrice(symbol, price) {
  if (!history[symbol]) {
    history[symbol] = { peaks: [], troughs: [], readings: [], lastPrice: null };
  }
  const h = history[symbol];
  h.readings.push({ price, time: Date.now() });
  if (h.readings.length > 1000) h.readings.shift();

  if (h.readings.length >= 11) {
    const window = h.readings.slice(-11);
    const mid    = window[5].price;
    const before = window.slice(0,5).map(r => r.price);
    const after  = window.slice(6).map(r => r.price);
    const isPeak   = before.every(p => p <= mid) && after.every(p => p <= mid);
    const isTrough = before.every(p => p >= mid) && after.every(p => p >= mid);

    if (isPeak) {
      const last = h.peaks[h.peaks.length-1];
      if (!last || Math.abs(mid - last.price) / last.price > 0.005) {
        h.peaks.push({ price: mid, time: Date.now() });
        if (h.peaks.length > 50) h.peaks.shift();
        console.log(`   📈 ${symbol} PEAK: $${mid.toFixed(8)}`);
      }
    }
    if (isTrough) {
      const last = h.troughs[h.troughs.length-1];
      if (!last || Math.abs(mid - last.price) / last.price > 0.005) {
        h.troughs.push({ price: mid, time: Date.now() });
        if (h.troughs.length > 50) h.troughs.shift();
        console.log(`   📉 ${symbol} TROUGH: $${mid.toFixed(8)}`);
      }
    }
  }
  h.lastPrice = price;
}

function predictNextPeak(symbol) {
  const h = history[symbol];
  if (!h?.peaks?.length) return null;
  if (h.peaks.length === 1) return h.peaks[0].price * 1.3;
  const peaks  = h.peaks.slice(-6);
  const ratios = [];
  for (let i = 1; i < peaks.length; i++) ratios.push(peaks[i].price / peaks[i-1].price);
  const avg = ratios.reduce((a,b) => a+b, 0) / ratios.length;
  return peaks[peaks.length-1].price * Math.min(avg, 2.0);
}

function predictNextTrough(symbol) {
  const h = history[symbol];
  if (!h?.troughs?.length) return null;
  if (h.troughs.length === 1) return h.troughs[0].price * 0.85;
  const troughs = h.troughs.slice(-6);
  const ratios  = [];
  for (let i = 1; i < troughs.length; i++) ratios.push(troughs[i].price / troughs[i-1].price);
  const avg = ratios.reduce((a,b) => a+b, 0) / ratios.length;
  return troughs[troughs.length-1].price * Math.min(avg, 1.0);
}

function tokensNeededForTarget(symbol, currentPrice) {
  const predicted = predictNextPeak(symbol);
  const target    = predicted || currentPrice * 1.3;
  return { tokens: Math.ceil(PROFIT_TARGET / target), targetPrice: target };
}

// ── MOMENTUM ──────────────────────────────────────────────────────────────
function getMomentum(symbol) {
  const s = priceStreams[symbol] || [];
  if (s.length < 6) return { direction: "neutral", speed: 0 };
  const recent = s.slice(-6);
  const moves  = [];
  for (let i = 1; i < recent.length; i++) {
    moves.push((recent[i].price - recent[i-1].price) / recent[i-1].price);
  }
  const avg = moves.reduce((a,b) => a+b, 0) / moves.length;
  return {
    direction: avg > 0.0003 ? "up" : avg < -0.0003 ? "down" : "neutral",
    speed: Math.abs(avg),
  };
}

function isNearTrough(symbol, price) {
  const trough = predictNextTrough(symbol);
  if (!trough) return false;
  return price <= trough * 1.08;
}

function isNearPeak(symbol, price) {
  const peak = predictNextPeak(symbol);
  if (!peak) return false;
  return price >= peak * 0.88;
}

function canTrade(symbol) {
  const elapsed = Date.now() - (lastTradeTime[symbol] || 0);
  if (elapsed < COOLDOWN_MS) {
    console.log(`   ⏳ ${symbol} cooldown: ${Math.ceil((COOLDOWN_MS-elapsed)/1000)}s`);
    return false;
  }
  return true;
}

// ── FEE SAFETY ────────────────────────────────────────────────────────────
async function isTradeProfitable(ethAmount) {
  const gasCost    = await estimateGasCostEth();
  const tradeValue = ethAmount * ETH_USD;
  const gasCostUsd = gasCost  * ETH_USD;
  if (tradeValue < MIN_TRADE_USD) {
    console.log(`   🛑 Trade too small ($${tradeValue.toFixed(3)}) — skipping`);
    return false;
  }
  if (tradeValue < gasCostUsd * FEE_SAFETY) {
    console.log(`   🛑 Fee safety — trade $${tradeValue.toFixed(3)} vs gas $${gasCostUsd.toFixed(4)}`);
    return false;
  }
  return true;
}

// ── ENCODE HELPERS ────────────────────────────────────────────────────────
function encodeSwap(tokenIn, tokenOut, amountIn, recipient) {
  const p = (v, isAddr=false) => (isAddr ? v.slice(2) : BigInt(v).toString(16)).padStart(64,"0");
  return "0x04e45aaf"
    + p(tokenIn,true) + p(tokenOut,true) + p(10000)
    + p(recipient,true) + p(amountIn) + p(0) + p(0);
}

function encodeApprove(spender, amount) {
  return "0x095ea7b3"
    + spender.slice(2).padStart(64,"0")
    + amount.toString(16).padStart(64,"0");
}

// ── BUY ───────────────────────────────────────────────────────────────────
async function executeBuy(cdp, token, tradeableEth, reason, price) {
  if (!canTrade(token.symbol)) return;
  if (tradeableEth < MIN_ETH_TO_TRADE) {
    console.log(`   🛑 ETH too low (${tradeableEth.toFixed(6)})`);
    return;
  }

  const needed     = tokensNeededForTarget(token.symbol, price);
  const currentBal = await getTokenBalance(token.address);
  const stillNeed  = Math.max(needed.tokens - currentBal - (token.lotteryTickets||0), 0);
  const ethForIt   = stillNeed * price;

  let ethToSpend   = Math.min(ethForIt, tradeableEth * 0.20);
  ethToSpend       = Math.max(ethToSpend, tradeableEth * 0.05);
  ethToSpend       = Math.min(ethToSpend, tradeableEth * 0.25);

  if (!await isTradeProfitable(ethToSpend)) return;

  const amountIn = parseEther(ethToSpend.toFixed(18));
  console.log(`\n   🟢 BUY ${token.symbol} — ${reason}`);
  console.log(`      ${ethToSpend.toFixed(6)} ETH @ $${price.toFixed(8)}`);

  try {
    const { transactionHash } = await cdp.evm.sendTransaction({
      address: WALLET_ADDRESS, network: "base",
      transaction: { to: SWAP_ROUTER, value: amountIn,
        data: encodeSwap(WETH_ADDRESS, token.address, amountIn, WALLET_ADDRESS) },
    });
    lastTradeTime[token.symbol] = Date.now();
    tradeCount++;
    if (!token.entryPrice) token.entryPrice = price;
    token.totalInvested = (token.totalInvested||0) + ethToSpend;

    console.log(`      ✅ https://basescan.org/tx/${transactionHash}`);
    await sendAlert(
      `⚔️ <b>GUARDIAN — BUY ${token.symbol}</b>\n\n` +
      `🟢 Bought ${token.symbol}\n` +
      `💰 Spent: ${ethToSpend.toFixed(6)} ETH\n` +
      `💲 Price: $${price.toFixed(8)}\n` +
      `🎯 $${PROFIT_TARGET} target @ $${needed.targetPrice.toFixed(8)}\n` +
      `📊 Reason: ${reason}\n` +
      `🔗 <a href="https://basescan.org/tx/${transactionHash}">Basescan</a>`
    );
  } catch (e) {
    console.log(`      ❌ BUY FAILED: ${e.message}`);
    await sendAlert(`⚠️ <b>${token.symbol} BUY FAILED</b>\n${e.message}`);
  }
}

// ── SELL ──────────────────────────────────────────────────────────────────
async function executeSell(cdp, token, sellPct, reason, price) {
  if (!canTrade(token.symbol)) return;

  const totalBal = await getTokenBalance(token.address);
  const lottery  = token.lotteryTickets || 0;
  const sellable = Math.max(totalBal - lottery, 0);

  if (sellable < 1) {
    console.log(`   🎰 ${token.symbol} only lottery tickets remain`);
    return;
  }
  if (token.entryPrice && price < token.entryPrice * 1.005) {
    console.log(`   🛑 ${token.symbol} SELL BLOCKED — below entry`);
    return;
  }

  const amountToSell  = BigInt(Math.floor(sellable * sellPct * 1e18));
  if (amountToSell === BigInt(0)) return;

  const sellValueEth = (sellable * sellPct * price) / ETH_USD;
  if (!await isTradeProfitable(sellValueEth)) return;

  console.log(`\n   🔴 SELL ${token.symbol} — ${reason}`);
  console.log(`      ${(sellPct*100).toFixed(0)}% of ${sellable.toFixed(0)} tokens`);
  console.log(`      🎰 Protecting ${lottery.toFixed(0)} lottery tickets`);

  try {
    const allowance = await publicClient.readContract({
      address: token.address, abi: ERC20_ABI,
      functionName: "allowance", args: [WALLET_ADDRESS, SWAP_ROUTER],
    });
    if (allowance < amountToSell) {
      await cdp.evm.sendTransaction({
        address: WALLET_ADDRESS, network: "base",
        transaction: { to: token.address, data: encodeApprove(SWAP_ROUTER, amountToSell) },
      });
      console.log(`      ✅ Approved`);
      await new Promise(r => setTimeout(r, 8000));
    }

    const ethBefore = await getEthBalance();
    const { transactionHash } = await cdp.evm.sendTransaction({
      address: WALLET_ADDRESS, network: "base",
      transaction: { to: SWAP_ROUTER,
        data: encodeSwap(token.address, WETH_ADDRESS, amountToSell, WALLET_ADDRESS) },
    });

    lastTradeTime[token.symbol] = Date.now();
    tradeCount++;

    await new Promise(r => setTimeout(r, 6000));
    const profit    = (await getEthBalance()) - ethBefore;
    const profitUsd = (profit * ETH_USD).toFixed(2);

    if (profit > 0) {
      const skim    = profit * 0.02;
      piggyBank    += skim;
      totalSkimmed += skim;
    }

    if (lottery === 0) {
      token.lotteryTickets = Math.floor(await getTokenBalance(token.address));
      console.log(`      🎰 Lottery set: ${token.lotteryTickets}`);
    }

    token.entryPrice = null;
    const nextPeak   = predictNextPeak(token.symbol);

    console.log(`      ✅ https://basescan.org/tx/${transactionHash}`);
    console.log(`      💰 Profit: ${profit.toFixed(6)} ETH ($${profitUsd})`);

    await sendAlert(
      `⚔️ <b>GUARDIAN — SELL ${token.symbol}</b>\n\n` +
      `🔴 Sold ${token.symbol}\n` +
      `💰 Got: ${profit.toFixed(6)} ETH (~$${profitUsd})\n` +
      `💲 Price: $${price.toFixed(8)}\n` +
      `🎰 Lottery kept: ${token.lotteryTickets}\n` +
      `📊 Reason: ${reason}\n` +
      `🔮 Next peak: ${nextPeak ? "$"+nextPeak.toFixed(8) : "learning..."}\n` +
      `🐷 Total saved: ${totalSkimmed.toFixed(6)} ETH\n` +
      `🔗 <a href="https://basescan.org/tx/${transactionHash}">Basescan</a>`
    );
  } catch (e) {
    console.log(`      ❌ SELL FAILED: ${e.message}`);
    await sendAlert(`⚠️ <b>${token.symbol} SELL FAILED</b>\n${e.message}`);
  }
}

// ── PROCESS ONE TOKEN ─────────────────────────────────────────────────────
async function processToken(cdp, token, ethBalance) {
  const price = await getTokenPrice(token.address);
  if (!price) { console.log(`   ⏳ ${token.symbol}: no price`); return; }

  if (!priceStreams[token.symbol]) priceStreams[token.symbol] = [];
  priceStreams[token.symbol].push({ price, time: Date.now() });
  if (priceStreams[token.symbol].length > 200) priceStreams[token.symbol].shift();
  recordPrice(token.symbol, price);

  const balance      = await getTokenBalance(token.address);
  const valueUsd     = (balance * price).toFixed(2);
  const momentum     = getMomentum(token.symbol);
  const nearTrough   = isNearTrough(token.symbol, price);
  const nearPeak     = isNearPeak(token.symbol, price);
  const tradeableEth = getTradeableEth(ethBalance);
  const predPeak     = predictNextPeak(token.symbol);
  const predTrough   = predictNextTrough(token.symbol);
  const needed       = tokensNeededForTarget(token.symbol, price);
  const stream       = priceStreams[token.symbol];
  const refPrice     = stream.length > 6 ? stream[stream.length-7].price : price;
  const change       = (price - refPrice) / refPrice;
  const entry        = token.entryPrice || price;
  const pctEntry     = ((price - entry) / entry * 100).toFixed(2);
  const lottery      = token.lotteryTickets || 0;
  const sellable     = Math.max(balance - lottery, 0);

  console.log(`\n  [${token.symbol}]`);
  console.log(`   💲 $${price.toFixed(8)} | Δ ${(change*100).toFixed(2)}% | ${momentum.direction}`);
  console.log(`   🪙 ${balance.toFixed(0)} tokens ($${valueUsd}) | P&L: ${pctEntry}%`);
  console.log(`   🔮 Peak: ${predPeak?"$"+predPeak.toFixed(8):"learning"} | Trough: ${predTrough?"$"+predTrough.toFixed(8):"learning"}`);
  console.log(`   🎯 Need ${needed.tokens} for $${PROFIT_TARGET} | NearTrough:${nearTrough} NearPeak:${nearPeak}`);

  // ── SELL ─────────────────────────────────────────────────────────────────
  if (sellable > 1) {
    if (nearPeak && momentum.direction !== "up") {
      await executeSell(cdp, token, 0.90, `NEAR PEAK $${predPeak?.toFixed(8)}`, price);
    } else if (change >= 0.04 && momentum.direction === "up") {
      await executeSell(cdp, token, 0.12, `SURGE +${(change*100).toFixed(1)}%`, price);
    } else if (change >= TRIGGER_PCT && momentum.direction === "up") {
      await executeSell(cdp, token, 0.06, `UP +${(change*100).toFixed(1)}%`, price);
    }

  // ── BUY ──────────────────────────────────────────────────────────────────
  } else if (tradeableEth >= MIN_ETH_TO_TRADE) {
    if (nearTrough && momentum.direction !== "down") {
      await executeBuy(cdp, token, tradeableEth, `NEAR TROUGH $${predTrough?.toFixed(8)}`, price);
    } else if (change <= -TRIGGER_PCT && momentum.direction === "down") {
      await executeBuy(cdp, token, tradeableEth, `DIP ${(change*100).toFixed(1)}%`, price);
    } else if (balance < 1 && token.status === "active") {
      await executeBuy(cdp, token, tradeableEth, `INITIAL ENTRY`, price);
    }
  }
}

// ── 30 MIN REPORT ─────────────────────────────────────────────────────────
async function sendReport(ethBalance) {
  if (Date.now() - lastReportTime < REPORT_INTERVAL) return; // ← 30 min gate
  lastReportTime = Date.now();

  let lines = "";
  for (const t of tokens) {
    const price = history[t.symbol]?.lastPrice;
    if (!price) continue;
    const bal    = await getTokenBalance(t.address);
    const usd    = (bal * price).toFixed(2);
    const peak   = predictNextPeak(t.symbol);
    const trough = predictNextTrough(t.symbol);
    const entry  = t.entryPrice || price;
    const pct    = ((price - entry) / entry * 100).toFixed(1);
    const up     = parseFloat(pct) >= 0;
    lines +=
      `\n\n<b>${t.symbol}</b> ${up?"🟢":"🔴"}\n` +
      `💲 $${price.toFixed(8)}\n` +
      `🪙 ${Math.floor(bal).toLocaleString()} tokens ($${usd})\n` +
      `📊 P&L: ${up?"+":""}${pct}% from entry\n` +
      `🎰 Lottery: ${(t.lotteryTickets||0).toLocaleString()}\n` +
      `🔮 Next peak: ${peak?"$"+peak.toFixed(8):"learning..."}\n` +
      `📉 Next trough: ${trough?"$"+trough.toFixed(8):"learning..."}`;
  }

  await sendAlert(
    `📊 <b>GUARDIAN — 30 MIN REPORT</b>\n\n` +
    `💰 ETH: ${ethBalance.toFixed(6)} (~$${(ethBalance*ETH_USD).toFixed(2)})\n` +
    `♻️ Tradeable: ${getTradeableEth(ethBalance).toFixed(6)} ETH\n` +
    `🐷 Piggy bank: ${piggyBank.toFixed(6)} ETH\n` +
    `📈 Trades: ${tradeCount}` +
    lines + `\n\n` +
    `🔗 <a href="https://basescan.org/address/${WALLET_ADDRESS}">Wallet</a>`
  );
}

// ── MAIN ──────────────────────────────────────────────────────────────────
async function main() {
  console.log("═══════════════════════════════════════════════");
  console.log("⚔️   GUARDIAN CASCADE SYSTEM v6.2 — LIVE");
  console.log("═══════════════════════════════════════════════\n");

  await loadFromGitHub();

  const cdp = new CdpClient({
    apiKeyId:     process.env.CDP_API_KEY_ID,
    apiKeySecret: process.env.CDP_API_KEY_SECRET,
    walletSecret: process.env.CDP_WALLET_SECRET,
  });

  const ethBalance = await getEthBalance();
  console.log(`💰 ETH: ${ethBalance.toFixed(6)}`);
  console.log(`🪙  Tracking: ${tokens.map(t=>t.symbol).join(", ")}\n`);

  await sendAlert(
    `⚔️ <b>GUARDIAN CASCADE v6.2 — STARTED</b>\n\n` +
    `👛 <code>${WALLET_ADDRESS}</code>\n` +
    `💰 ETH: ${ethBalance.toFixed(6)}\n` +
    `🪙 Tracking: ${tokens.map(t=>t.symbol).join(", ")}\n` +
    `🎯 Target: $${PROFIT_TARGET} per token cycle\n` +
    `⛽ Gas reserve: ${GAS_RESERVE} ETH locked\n` +
    `🛡️ Fee check: trade must be ${FEE_SAFETY}x gas cost\n` +
    `🐷 Piggy bank: 2% of every profit\n` +
    `📱 Dual price feed: GeckoTerminal + DexScreener\n` +
    `💾 Saves to GitHub every 30 mins only`
  );

  while (true) {
    try {
      const eth = await getEthBalance();
      console.log(`\n${"═".repeat(44)}`);
      console.log(`${new Date().toLocaleTimeString()} | ETH: ${eth.toFixed(6)} | Trades: ${tradeCount}`);

      for (const token of tokens) {
        await processToken(cdp, token, eth);
        await new Promise(r => setTimeout(r, 3000)); // stagger token checks
      }

      // 30 min report — only fires every 30 mins
      await sendReport(eth);

      // 30 min save — only fires every 30 mins
      if (Date.now() - lastSaveTime > SAVE_INTERVAL) {
        await saveToGitHub();
      }

    } catch (e) {
      console.log(`⚠️ ERROR: ${e.message}`);
      await sendAlert(`⚠️ <b>GUARDIAN ERROR</b>\n${e.message}`);
    }

    await new Promise(r => setTimeout(r, INTERVAL));
  }
}

main().catch(console.error);
