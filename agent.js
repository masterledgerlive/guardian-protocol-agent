import { CdpClient } from "@coinbase/cdp-sdk";
import { createPublicClient, http, formatEther, parseEther } from "viem";
import { base } from "viem/chains";
import dotenv from "dotenv";
dotenv.config();

// ═══════════════════════════════════════════════════════
// GUARDIAN CASCADE SYSTEM v6
// ═══════════════════════════════════════════════════════

const WALLET_ADDRESS = "0x50e1C4608c48b0c52E1EA5FBabc1c9126eA17915";
const WETH_ADDRESS   = "0x4200000000000000000000000000000000000006";
const SWAP_ROUTER    = "0x2626664c2603336E57B271c5C0b26F421741e481";

// ── SAFETY ────────────────────────────────────────────
const GAS_RESERVE      = 0.0003;  // always locked for gas
const MIN_ETH_TO_TRADE = 0.0008;  // minimum ETH before any buy
const MIN_TRADE_USD    = 0.50;    // trade must be worth at least $0.50
const FEE_SAFETY       = 3;       // trade value must be 3x the gas cost
const COOLDOWN_MS      = 300000;  // 5 min between trades per token
const TRIGGER_PCT      = 0.02;    // 2% move to trigger trade
const LOTTERY_PCT      = 0.10;    // keep 10% as lottery tickets
const PROFIT_TARGET    = 500;     // $500 target per token cycle
const SAVE_INTERVAL    = 1800000; // save to GitHub every 30 mins
const INTERVAL         = 20000;   // check every 20 seconds
const ETH_USD          = 1940;    // approximate ETH price

// ── GITHUB ────────────────────────────────────────────
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

// ── STATE ─────────────────────────────────────────────
let tokens        = [];
let history       = {};
let tokensSha     = null;
let historySha    = null;
let priceStreams   = {};
let lastTradeTime = {};
let piggyBank     = 0;
let totalSkimmed  = 0;
let tradeCount    = 0;
let lastSaveTime  = 0;
let lastReportTime = 0;

// ── GITHUB OPS ────────────────────────────────────────
async function githubGet(path) {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}?ref=${GITHUB_BRANCH}&t=${Date.now()}`,
      { headers: { Authorization: `token ${GITHUB_TOKEN}`, Accept: "application/vnd.github.v3+json" } }
    );
    if (!res.ok) return null;
    const data = await res.json();
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
    const res = await fetch(
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
  if (tf) { tokens = tf.content.tokens || []; tokensSha = tf.sha; }
  console.log(`✅ ${tokens.length} tokens loaded: ${tokens.map(t=>t.symbol).join(", ")}`);

  const hf = await githubGet("history.json");
  if (hf) { history = hf.content || {}; historySha = hf.sha; }
  console.log(`✅ History loaded for: ${Object.keys(history).join(", ") || "none yet"}`);
}

async function saveToGitHub() {
  console.log("💾 Saving to GitHub...");
  tokensSha  = await githubSave("tokens.json", { tokens, lastSaved: new Date().toISOString() }, tokensSha);
  historySha = await githubSave("history.json", history, historySha);
  lastSaveTime = Date.now();
  console.log("✅ Saved");
}

// ── TELEGRAM ──────────────────────────────────────────
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

// ── PRICE & BALANCES ──────────────────────────────────
async function getTokenPrice(address) {
  try {
    const res  = await fetch(
      `https://api.geckoterminal.com/api/v2/simple/networks/base/token_price/${address.toLowerCase()}`
    );
    const data = await res.json();
    const p    = parseFloat(data?.data?.attributes?.token_prices?.[address.toLowerCase()]);
    return isNaN(p) ? null : p;
  } catch { return null; }
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
    const gasUnits = BigInt(200000); // typical swap
    return parseFloat(formatEther(gasPrice * gasUnits));
  } catch { return 0.0001; }
}

function getTradeableEth(ethBalance) {
  return Math.max(ethBalance - GAS_RESERVE - piggyBank, 0);
}

// ── CYCLE HISTORY ─────────────────────────────────────
function recordPrice(symbol, price) {
  if (!history[symbol]) {
    history[symbol] = { peaks: [], troughs: [], readings: [], lastPrice: null };
  }
  const h = history[symbol];
  h.readings.push({ price, time: Date.now() });
  if (h.readings.length > 1000) h.readings.shift();

  // detect peaks and troughs from last 10 readings
  if (h.readings.length >= 11) {
    const window = h.readings.slice(-11);
    const mid    = window[5].price;
    const before = window.slice(0,5).map(r=>r.price);
    const after  = window.slice(6).map(r=>r.price);
    const isPeak   = before.every(p=>p<=mid) && after.every(p=>p<=mid);
    const isTrough = before.every(p=>p>=mid) && after.every(p=>p>=mid);
    if (isPeak) {
      const last = h.peaks[h.peaks.length-1];
      if (!last || Math.abs(mid - last.price) / last.price > 0.005) {
        h.peaks.push({ price: mid, time: Date.now() });
        if (h.peaks.length > 50) h.peaks.shift();
        console.log(`   📈 ${symbol} PEAK recorded: $${mid.toFixed(8)}`);
      }
    }
    if (isTrough) {
      const last = h.troughs[h.troughs.length-1];
      if (!last || Math.abs(mid - last.price) / last.price > 0.005) {
        h.troughs.push({ price: mid, time: Date.now() });
        if (h.troughs.length > 50) h.troughs.shift();
        console.log(`   📉 ${symbol} TROUGH recorded: $${mid.toFixed(8)}`);
      }
    }
  }
  h.lastPrice = price;
}

function predictNextPeak(symbol) {
  const h = history[symbol];
  if (!h?.peaks?.length) return null;
  if (h.peaks.length === 1) return h.peaks[0].price * 1.3; // assume 30% higher next time
  const peaks  = h.peaks.slice(-6);
  const ratios = [];
  for (let i = 1; i < peaks.length; i++) ratios.push(peaks[i].price / peaks[i-1].price);
  const avgRatio = ratios.reduce((a,b)=>a+b,0) / ratios.length;
  const safePrediction = peaks[peaks.length-1].price * Math.min(avgRatio, 2.0); // cap at 2x
  return safePrediction;
}

function predictNextTrough(symbol) {
  const h = history[symbol];
  if (!h?.troughs?.length) return null;
  if (h.troughs.length === 1) return h.troughs[0].price * 0.85;
  const troughs = h.troughs.slice(-6);
  const ratios  = [];
  for (let i = 1; i < troughs.length; i++) ratios.push(troughs[i].price / troughs[i-1].price);
  const avgRatio = ratios.reduce((a,b)=>a+b,0) / ratios.length;
  return troughs[troughs.length-1].price * Math.min(avgRatio, 1.0);
}

function tokensNeededForTarget(symbol, currentPrice) {
  const predicted = predictNextPeak(symbol);
  const target    = predicted || currentPrice * 1.3;
  return { tokens: Math.ceil(PROFIT_TARGET / target), targetPrice: target };
}

// ── MOMENTUM ──────────────────────────────────────────
function getMomentum(symbol) {
  const s = priceStreams[symbol] || [];
  if (s.length < 6) return { direction: "neutral", speed: 0 };
  const recent = s.slice(-6);
  const moves  = [];
  for (let i = 1; i < recent.length; i++) {
    moves.push((recent[i].price - recent[i-1].price) / recent[i-1].price);
  }
  const avg = moves.reduce((a,b)=>a+b,0) / moves.length;
  return {
    direction: avg > 0.0003 ? "up" : avg < -0.0003 ? "down" : "neutral",
    speed: Math.abs(avg),
  };
}

function isNearTrough(symbol, price) {
  const trough = predictNextTrough(symbol);
  if (!trough) return false;
  return price <= trough * 1.08; // within 8% of predicted trough
}

function isNearPeak(symbol, price) {
  const peak = predictNextPeak(symbol);
  if (!peak) return false;
  return price >= peak * 0.88; // within 12% of predicted peak
}

function canTrade(symbol) {
  const elapsed = Date.now() - (lastTradeTime[symbol] || 0);
  if (elapsed < COOLDOWN_MS) {
    console.log(`   ⏳ ${symbol} cooldown: ${Math.ceil((COOLDOWN_MS-elapsed)/1000)}s left`);
    return false;
  }
  return true;
}

// ── FEE SAFETY CHECK ──────────────────────────────────
async function isTradeProfitable(ethAmount) {
  const gasCost    = await estimateGasCostEth();
  const tradeValue = ethAmount * ETH_USD;
  const gasCostUsd = gasCost * ETH_USD;
  if (tradeValue < MIN_TRADE_USD) {
    console.log(`   🛑 Trade too small ($${tradeValue.toFixed(3)}) — skipping`);
    return false;
  }
  if (tradeValue < gasCostUsd * FEE_SAFETY) {
    console.log(`   🛑 Fee safety failed — trade $${tradeValue.toFixed(3)} vs gas $${gasCostUsd.toFixed(3)}`);
    return false;
  }
  return true;
}

// ── ENCODE HELPERS ────────────────────────────────────
function encodeSwap(tokenIn, tokenOut, amountIn, recipient) {
  const p = (v, isAddr=false) => (isAddr ? v.slice(2) : BigInt(v).toString(16)).padStart(64,"0");
  return "0x04e45aaf" + p(tokenIn,true) + p(tokenOut,true) + p(10000) + p(recipient,true) + p(amountIn) + p(0) + p(0);
}

function encodeApprove(spender, amount) {
  return "0x095ea7b3" + spender.slice(2).padStart(64,"0") + amount.toString(16).padStart(64,"0");
}

// ── BUY ───────────────────────────────────────────────
async function executeBuy(cdp, token, tradeableEth, reason, price) {
  if (!canTrade(token.symbol)) return;
  if (tradeableEth < MIN_ETH_TO_TRADE) {
    console.log(`   🛑 ETH too low to buy (${tradeableEth.toFixed(6)})`);
    return;
  }

  // Calculate how much to spend
  const needed      = tokensNeededForTarget(token.symbol, price);
  const currentBal  = await getTokenBalance(token.address);
  const stillNeed   = Math.max(needed.tokens - currentBal - (token.lotteryTickets||0), 0);
  const ethForTokens = stillNeed * price;
  let   ethToSpend  = Math.min(ethForTokens, tradeableEth * 0.20); // max 20% at once
  ethToSpend        = Math.max(ethToSpend, tradeableEth * 0.05);   // min 5%
  ethToSpend        = Math.min(ethToSpend, tradeableEth * 0.25);   // hard cap 25%

  if (!await isTradeProfitable(ethToSpend)) return;

  const amountIn = parseEther(ethToSpend.toFixed(18));
  console.log(`\n   🟢 BUY ${token.symbol} — ${reason}`);
  console.log(`      Spending ${ethToSpend.toFixed(6)} ETH @ $${price.toFixed(8)}`);
  console.log(`      Need ${stillNeed.toFixed(0)} more tokens for $${PROFIT_TARGET} target`);

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
      `🎯 Target: $${PROFIT_TARGET} @ $${needed.targetPrice.toFixed(8)}\n` +
      `📊 Reason: ${reason}\n` +
      `🔗 <a href="https://basescan.org/tx/${transactionHash}">Basescan</a>`
    );
  } catch (e) {
    console.log(`      ❌ BUY FAILED: ${e.message}`);
    await sendAlert(`⚠️ <b>${token.symbol} BUY FAILED</b>\n${e.message}`);
  }
}

// ── SELL ──────────────────────────────────────────────
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

  const amountToSell = BigInt(Math.floor(sellable * sellPct * 1e18));
  if (amountToSell === BigInt(0)) return;

  const sellValueEth = (sellable * sellPct * price) / ETH_USD;
  if (!await isTradeProfitable(sellValueEth)) return;

  console.log(`\n   🔴 SELL ${token.symbol} — ${reason}`);
  console.log(`      Selling ${(sellPct*100).toFixed(0)}% of ${sellable.toFixed(0)} tokens`);
  console.log(`      🎰 Protecting ${lottery.toFixed(0)} lottery tickets forever`);

  try {
    // Approve if needed
    const allowance = await publicClient.readContract({
      address: token.address, abi: ERC20_ABI,
      functionName: "allowance", args: [WALLET_ADDRESS, SWAP_ROUTER],
    });
    if (allowance < amountToSell) {
      const { transactionHash: appTx } = await cdp.evm.sendTransaction({
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
    const ethAfter  = await getEthBalance();
    const profit    = ethAfter - ethBefore;
    const profitUsd = (profit * ETH_USD).toFixed(2);

    // Skim 2% to piggy bank
    if (profit > 0) {
      const skim    = profit * 0.02;
      piggyBank    += skim;
      totalSkimmed += skim;
    }

    // Set lottery tickets on first sell
    if (lottery === 0) {
      const balAfter       = await getTokenBalance(token.address);
      token.lotteryTickets = Math.floor(balAfter);
      console.log(`      🎰 Lottery tickets set: ${token.lotteryTickets}`);
    }

    // Reset entry price for next cycle
    token.entryPrice = null;

    const nextPeak = predictNextPeak(token.symbol);
    console.log(`      ✅ https://basescan.org/tx/${transactionHash}`);
    console.log(`      💰 Profit: ${profit.toFixed(6)} ETH ($${profitUsd})`);

    await sendAlert(
      `⚔️ <b>GUARDIAN — SELL ${token.symbol}</b>\n\n` +
      `🔴 Sold ${token.symbol}\n` +
      `💰 Received: ${profit.toFixed(6)} ETH (~$${profitUsd})\n` +
      `💲 Price: $${price.toFixed(8)}\n` +
      `🎰 Lottery tickets kept: ${token.lotteryTickets}\n` +
      `📊 Reason: ${reason}\n` +
      `🔮 Next predicted peak: ${nextPeak ? "$"+nextPeak.toFixed(8) : "learning..."}\n` +
      `🐷 Total saved: ${totalSkimmed.toFixed(6)} ETH\n` +
      `🔗 <a href="https://basescan.org/tx/${transactionHash}">Basescan</a>`
    );
  } catch (e) {
    console.log(`      ❌ SELL FAILED: ${e.message}`);
    await sendAlert(`⚠️ <b>${token.symbol} SELL FAILED</b>\n${e.message}`);
  }
}

// ── PROCESS ONE TOKEN ─────────────────────────────────
async function processToken(cdp, token, ethBalance) {
  const price = await getTokenPrice(token.address);
  if (!price) { console.log(`   ⏳ ${token.symbol}: no price`); return; }

  // Record to stream and history
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

  // Price change since last trade or last 6 readings
  const stream    = priceStreams[token.symbol];
  const refPrice  = stream.length > 6 ? stream[stream.length-7].price : price;
  const change    = (price - refPrice) / refPrice;
  const entry     = token.entryPrice || price;
  const pctFromEntry = ((price - entry) / entry * 100).toFixed(2);

  console.log(`\n  [${token.symbol}]`);
  console.log(`   Price: $${price.toFixed(8)} | Change: ${(change*100).toFixed(2)}%`);
  console.log(`   Balance: ${balance.toFixed(0)} tokens ($${valueUsd})`);
  console.log(`   Momentum: ${momentum.direction} | NearTrough: ${nearTrough} | NearPeak: ${nearPeak}`);
  console.log(`   Predicted peak: ${predPeak ? "$"+predPeak.toFixed(8) : "learning..."}`);
  console.log(`   Need ${needed.tokens} tokens for $${PROFIT_TARGET} target`);
  console.log(`   P&L from entry: ${pctFromEntry}%`);

  const lottery  = token.lotteryTickets || 0;
  const sellable = Math.max(balance - lottery, 0);

  // ── SELL SIGNALS ──────────────────────────────────
  if (sellable > 1) {
    if (nearPeak && momentum.direction !== "up") {
      // At predicted peak and momentum fading — take big profit
      await executeSell(cdp, token, 0.90, `AT PREDICTED PEAK $${predPeak?.toFixed(8)} — taking profit`, price);
    } else if (change >= 0.04 && momentum.direction === "up") {
      // Strong 4%+ surge — skim some
      await executeSell(cdp, token, 0.12, `STRONG SURGE +${(change*100).toFixed(1)}%`, price);
    } else if (change >= TRIGGER_PCT && momentum.direction === "up" && !nearPeak) {
      // Normal 2% up — small trim
      await executeSell(cdp, token, 0.06, `UP +${(change*100).toFixed(1)}% — trim`, price);
    }

  // ── BUY SIGNALS ───────────────────────────────────
  } else if (tradeableEth >= MIN_ETH_TO_TRADE) {
    if (nearTrough && momentum.direction !== "down") {
      // At predicted trough and stabilizing — bigger buy
      await executeBuy(cdp, token, tradeableEth, `AT PREDICTED TROUGH $${predTrough?.toFixed(8)}`, price);
    } else if (change <= -TRIGGER_PCT && momentum.direction === "down") {
      // Normal 2% dip — standard buy
      await executeBuy(cdp, token, tradeableEth, `DIP ${(change*100).toFixed(1)}%`, price);
    } else if (balance < 1 && token.status === "active") {
      // No position at all — get initial entry
      await executeBuy(cdp, token, tradeableEth, `INITIAL ENTRY`, price);
    }
  }
}

// ── 30 MIN REPORT ─────────────────────────────────────
async function sendReport(ethBalance) {
  if (Date.now() - lastReportTime < 1800000) return;
  lastReportTime = Date.now();

  let lines = "";
  for (const t of tokens) {
    const price   = history[t.symbol]?.lastPrice;
    if (!price) continue;
    const bal     = await getTokenBalance(t.address);
    const usd     = (bal * price).toFixed(2);
    const peak    = predictNextPeak(t.symbol);
    const trough  = predictNextTrough(t.symbol);
    const entry   = t.entryPrice || price;
    const pct     = ((price - entry) / entry * 100).toFixed(1);
    const isProfitable = parseFloat(pct) >= 0;
    lines += `\n\n<b>${t.symbol}</b> ${isProfitable?"🟢":"🔴"}\n`;
    lines += `💲 $${price.toFixed(8)}\n`;
    lines += `🪙 ${Math.floor(bal).toLocaleString()} tokens ($${usd})\n`;
    lines += `📊 P&L: ${isProfitable?"+":""}${pct}% from entry\n`;
    lines += `🎰 Lottery: ${(t.lotteryTickets||0).toLocaleString()} tokens\n`;
    lines += `🔮 Next peak: ${peak?"$"+peak.toFixed(8):"learning..."}\n`;
    lines += `📉 Next trough: ${trough?"$"+trough.toFixed(8):"learning..."}`;
  }

  await sendAlert(
    `📊 <b>GUARDIAN — 30 MIN REPORT</b>\n` +
    `💰 ETH: ${ethBalance.toFixed(6)} (~$${(ethBalance*ETH_USD).toFixed(2)})\n` +
    `♻️ Tradeable: ${getTradeableEth(ethBalance).toFixed(6)} ETH\n` +
    `🐷 Piggy bank: ${piggyBank.toFixed(6)} ETH\n` +
    `📈 Total trades: ${tradeCount}` +
    lines + `\n\n` +
    `🔗 <a href="https://basescan.org/address/${WALLET_ADDRESS}">View wallet</a>`
  );
}

// ── MAIN ──────────────────────────────────────────────
async function main() {
  console.log("═══════════════════════════════════════════");
  console.log("⚔️   GUARDIAN CASCADE SYSTEM v6 — LIVE");
  console.log("═══════════════════════════════════════════\n");

  await loadFromGitHub();

  const cdp = new CdpClient({
    apiKeyId:     process.env.CDP_API_KEY_ID,
    apiKeySecret: process.env.CDP_API_KEY_SECRET,
    walletSecret: process.env.CDP_WALLET_SECRET,
  });

  const ethBalance = await getEthBalance();
  console.log(`💰 ETH: ${ethBalance.toFixed(6)}`);
  console.log(`🪙  Tokens: ${tokens.map(t=>t.symbol).join(", ")}\n`);

  await sendAlert(
    `⚔️ <b>GUARDIAN CASCADE v6 — STARTED</b>\n\n` +
    `👛 <code>${WALLET_ADDRESS}</code>\n` +
    `💰 ETH: ${ethBalance.toFixed(6)}\n` +
    `🪙 Tracking: ${tokens.map(t=>t.symbol).join(", ")}\n` +
    `🎯 Target: $${PROFIT_TARGET} per token cycle\n` +
    `⛽ Gas reserve: ${GAS_RESERVE} ETH always locked\n` +
    `🛡️ Fee safety: trade must be ${FEE_SAFETY}x gas cost\n` +
    `🐷 Piggy bank: 2% of every profit\n` +
    `💾 Saves to GitHub every 30 mins`
  );

  while (true) {
    try {
      const eth = await getEthBalance();
      console.log(`\n${"═".repeat(44)}`);
      console.log(`${new Date().toLocaleTimeString()} | ETH: ${eth.toFixed(6)} | Trades: ${tradeCount}`);

      for (const token of tokens) {
        await processToken(cdp, token, eth);
        await new Promise(r => setTimeout(r, 3000));
      }

      await sendReport(eth);

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
