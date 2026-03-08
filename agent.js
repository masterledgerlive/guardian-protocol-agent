import { CdpClient } from "@coinbase/cdp-sdk";
import { createPublicClient, http, formatEther, parseEther } from "viem";
import { base } from "viem/chains";
import dotenv from "dotenv";
dotenv.config();

// ═══════════════════════════════════════════════════════════════
// GUARDIAN CASCADE SYSTEM v7 — FULL VISION
//
// HOW IT WORKS:
//  - Watches all 6 tokens every 20 seconds
//  - Learns each token's recent HIGH and LOW from price history
//  - Buys near the LOW (bottom of cycle)
//  - Sells near the HIGH (top of cycle)
//  - Profit from one token cascades into buying the next dip
//  - Tokens fund each other in a loop — no outside money needed
//  - Gas cost checked before EVERY trade — never trades at a loss
//  - 5 min cooldown per token to prevent overtrading same token
//  - Reports to Telegram every 30 mins
//  - Saves to GitHub every 30 mins (no Railway redeploys)
//  - 10% lottery tickets kept forever from first sell of each token
// ═══════════════════════════════════════════════════════════════

const WALLET_ADDRESS = "0x50e1C4608c48b0c52E1EA5FBabc1c9126eA17915";
const WETH_ADDRESS   = "0x4200000000000000000000000000000000000006";
const SWAP_ROUTER    = "0x2626664c2603336E57B271c5C0b26F421741e481";

// ── TIMING ────────────────────────────────────────────────────────────────
const INTERVAL        = 20000;    // check prices every 20 seconds
const COOLDOWN_MS     = 300000;   // 5 min cooldown per token after trade
const SAVE_INTERVAL   = 1800000;  // save to GitHub every 30 mins
const REPORT_INTERVAL = 1800000;  // Telegram report every 30 mins

// ── SAFETY ────────────────────────────────────────────────────────────────
const GAS_RESERVE    = 0.0003;   // always locked for gas — never touched
const MIN_ETH_TRADE  = 0.0008;   // minimum ETH needed before any buy
const MIN_TRADE_USD  = 0.50;     // trade must be worth at least $0.50
const FEE_SAFETY     = 3;        // trade value must be 3x gas cost
const ETH_USD        = 1940;     // approximate ETH price in USD

// ── TRADING LOGIC ─────────────────────────────────────────────────────────
const BUY_ZONE       = 0.08;     // buy when price is within 8% above recent LOW
const SELL_ZONE      = 0.88;     // sell when price reaches 88% of recent HIGH
const PROFIT_TARGET  = 500;      // $500 target per token cycle
const HISTORY_DAYS   = 3;        // use last 3 days of data for high/low

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

// ── ALL 6 TOKENS ──────────────────────────────────────────────────────────
const DEFAULT_TOKENS = [
  { symbol: "DEGEN",   address: "0x4ed4e862860bed51a9570b96d89af5e1b0efefed", status: "active", lotteryTickets: 0,     entryPrice: null, totalInvested: 0 },
  { symbol: "TOSHI",   address: "0xAC1Bd2486aAf3B5C0fc3Fd868558b082a531B2B4", status: "active", lotteryTickets: 46888, entryPrice: null, totalInvested: 0 },
  { symbol: "BRETT",   address: "0x532f27101965dd16442E59d40670FaF5eBB142E4", status: "active", lotteryTickets: 0,     entryPrice: null, totalInvested: 0 },
  { symbol: "AERO",    address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631", status: "active", lotteryTickets: 0,     entryPrice: null, totalInvested: 0 },
  { symbol: "VIRTUAL", address: "0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b", status: "active", lotteryTickets: 0,     entryPrice: null, totalInvested: 0 },
  { symbol: "AIXBT",   address: "0x4F9Fd6Be4a90f2620860d680c0d4d5Fb53d1A825", status: "active", lotteryTickets: 0,     entryPrice: null, totalInvested: 0 },
];

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
  if (tf && tf.content.tokens?.length) {
    // Merge saved tokens with defaults — always picks up new tokens
    const saved = tf.content.tokens;
    tokens = DEFAULT_TOKENS.map(def => {
      const existing = saved.find(s => s.symbol === def.symbol);
      return existing ? { ...def, ...existing } : def;
    });
    tokensSha = tf.sha;
  } else {
    tokens = DEFAULT_TOKENS.map(t => ({ ...t }));
  }
  console.log(`✅ ${tokens.length} tokens: ${tokens.map(t=>t.symbol).join(", ")}`);

  const hf = await githubGet("history.json");
  if (hf) {
    history    = hf.content || {};
    historySha = hf.sha;
    console.log(`✅ History: ${Object.keys(history).join(", ") || "none yet"}`);
  } else {
    history = {};
  }

  // ALWAYS reset entry prices on startup — fresh slate, no blocked trades
  for (const t of tokens) t.entryPrice = null;
  console.log("✅ Entry prices reset — ready to trade");
}

async function saveToGitHub() {
  console.log("💾 Saving to GitHub...");
  tokensSha  = await githubSave("tokens.json",  { tokens, lastSaved: new Date().toISOString() }, tokensSha);
  historySha = await githubSave("history.json", history, historySha);
  lastSaveTime = Date.now();
  console.log("✅ Saved");
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
    const res  = await fetch(
      `https://api.geckoterminal.com/api/v2/simple/networks/base/token_price/${address.toLowerCase()}`
    );
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

// ── CYCLE ANALYSIS — THE BRAIN ────────────────────────────────────────────
// Uses last 3 days of readings to find recent HIGH and LOW
function getRecentHighLow(symbol) {
  const h = history[symbol];
  if (!h?.readings?.length) return null;
  const cutoff = Date.now() - (HISTORY_DAYS * 24 * 60 * 60 * 1000);
  const recent = h.readings.filter(r => r.time > cutoff);
  const data   = recent.length >= 10 ? recent : h.readings.slice(-200);
  if (data.length < 3) return null;
  const prices = data.map(r => r.price);
  const high   = Math.max(...prices);
  const low    = Math.min(...prices);
  return { high, low, range: high - low, readings: data.length };
}

// Where is price right now in the cycle? 0% = at LOW, 100% = at HIGH
function getCyclePosition(symbol, price) {
  const hl = getRecentHighLow(symbol);
  if (!hl || hl.range === 0) return 50;
  return ((price - hl.low) / hl.range) * 100;
}

function recordPrice(symbol, price) {
  if (!history[symbol]) {
    history[symbol] = { readings: [], lastPrice: null };
  }
  const h = history[symbol];
  h.readings.push({ price, time: Date.now() });
  if (h.readings.length > 5000) h.readings.shift();
  h.lastPrice = price;
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
    direction: avg > 0.0002 ? "up" : avg < -0.0002 ? "down" : "neutral",
    speed: Math.abs(avg),
  };
}

function canTrade(symbol) {
  const elapsed = Date.now() - (lastTradeTime[symbol] || 0);
  if (elapsed < COOLDOWN_MS) {
    console.log(`   ⏳ ${symbol} cooldown: ${Math.ceil((COOLDOWN_MS-elapsed)/1000)}s`);
    return false;
  }
  return true;
}

// ── FEE SAFETY — never trade when gas eats the profit ─────────────────────
async function isTradeProfitable(ethAmount) {
  const gasCost    = await estimateGasCostEth();
  const tradeValue = ethAmount * ETH_USD;
  const gasCostUsd = gasCost  * ETH_USD;
  if (tradeValue < MIN_TRADE_USD) {
    console.log(`   🛑 Trade too small ($${tradeValue.toFixed(3)})`);
    return false;
  }
  if (tradeValue < gasCostUsd * FEE_SAFETY) {
    console.log(`   🛑 Gas eats profit — trade $${tradeValue.toFixed(3)} vs gas $${gasCostUsd.toFixed(4)}`);
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

// ── BUY — enters near cycle LOW ───────────────────────────────────────────
async function executeBuy(cdp, token, tradeableEth, reason, price, hl) {
  if (!canTrade(token.symbol)) return;
  if (tradeableEth < MIN_ETH_TRADE) {
    console.log(`   🛑 ETH too low (${tradeableEth.toFixed(6)})`);
    return;
  }

  // How many tokens needed to hit $500 target at recent HIGH
  const targetPrice  = hl ? hl.high : price * 1.3;
  const tokensNeeded = Math.ceil(PROFIT_TARGET / targetPrice);
  const currentBal   = await getTokenBalance(token.address);
  const lottery      = token.lotteryTickets || 0;
  const stillNeed    = Math.max(tokensNeeded - currentBal - lottery, 0);
  const ethForTokens = stillNeed * price;

  let ethToSpend = Math.min(ethForTokens, tradeableEth * 0.25);
  ethToSpend     = Math.max(ethToSpend, tradeableEth * 0.05);
  ethToSpend     = Math.min(ethToSpend, tradeableEth * 0.25);

  if (!await isTradeProfitable(ethToSpend)) return;

  const amountIn = parseEther(ethToSpend.toFixed(18));
  console.log(`\n   🟢 BUY ${token.symbol} — ${reason}`);
  console.log(`      ${ethToSpend.toFixed(6)} ETH @ $${price.toFixed(8)}`);
  console.log(`      LOW: $${hl?.low.toFixed(8)||"?"} | HIGH: $${hl?.high.toFixed(8)||"?"}`);

  try {
    const { transactionHash } = await cdp.evm.sendTransaction({
      address: WALLET_ADDRESS, network: "base",
      transaction: { to: SWAP_ROUTER, value: amountIn,
        data: encodeSwap(WETH_ADDRESS, token.address, amountIn, WALLET_ADDRESS) },
    });
    lastTradeTime[token.symbol] = Date.now();
    tradeCount++;
    token.entryPrice    = price;
    token.totalInvested = (token.totalInvested||0) + ethToSpend;

    console.log(`      ✅ https://basescan.org/tx/${transactionHash}`);
    await sendAlert(
      `⚔️ <b>GUARDIAN — BUY ${token.symbol}</b>\n\n` +
      `🟢 Bought at cycle LOW zone\n` +
      `💰 Spent: ${ethToSpend.toFixed(6)} ETH\n` +
      `💲 Entry: $${price.toFixed(8)}\n` +
      `📉 Recent LOW: $${hl?.low.toFixed(8)||"learning"}\n` +
      `📈 Recent HIGH: $${hl?.high.toFixed(8)||"learning"}\n` +
      `🎯 $${PROFIT_TARGET} target at HIGH\n` +
      `📊 ${reason}\n` +
      `🔗 <a href="https://basescan.org/tx/${transactionHash}">Basescan</a>`
    );
  } catch (e) {
    console.log(`      ❌ BUY FAILED: ${e.message}`);
    await sendAlert(`⚠️ <b>${token.symbol} BUY FAILED</b>\n${e.message}`);
  }
}

// ── SELL — exits near cycle HIGH ──────────────────────────────────────────
async function executeSell(cdp, token, sellPct, reason, price, hl) {
  if (!canTrade(token.symbol)) return;

  const totalBal = await getTokenBalance(token.address);
  const lottery  = token.lotteryTickets || 0;
  const sellable = Math.max(totalBal - lottery, 0);

  if (sellable < 1) {
    console.log(`   🎰 ${token.symbol} only lottery tickets remain`);
    return;
  }

  // Never sell below entry price
  if (token.entryPrice && price < token.entryPrice) {
    console.log(`   🛑 ${token.symbol} below entry — holding`);
    return;
  }

  const amountToSell = BigInt(Math.floor(sellable * sellPct * 1e18));
  if (amountToSell === BigInt(0)) return;

  const sellValueEth = (sellable * sellPct * price) / ETH_USD;
  if (!await isTradeProfitable(sellValueEth)) return;

  console.log(`\n   🔴 SELL ${token.symbol} — ${reason}`);
  console.log(`      ${(sellPct*100).toFixed(0)}% of ${sellable.toFixed(0)} tokens @ $${price.toFixed(8)}`);
  console.log(`      🎰 Protecting ${lottery.toFixed(0)} lottery tickets forever`);

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

    // Set lottery tickets on first ever sell
    if (lottery === 0) {
      token.lotteryTickets = Math.floor(await getTokenBalance(token.address));
      console.log(`      🎰 Lottery tickets set: ${token.lotteryTickets}`);
    }

    // Reset entry — ready for next buy cycle
    token.entryPrice = null;

    console.log(`      ✅ https://basescan.org/tx/${transactionHash}`);
    console.log(`      💰 Profit: ${profit.toFixed(6)} ETH ($${profitUsd})`);

    await sendAlert(
      `⚔️ <b>GUARDIAN — SELL ${token.symbol}</b>\n\n` +
      `🔴 Sold at cycle HIGH zone\n` +
      `💰 Received: ${profit.toFixed(6)} ETH (~$${profitUsd})\n` +
      `💲 Exit: $${price.toFixed(8)}\n` +
      `📈 Recent HIGH: $${hl?.high.toFixed(8)||"n/a"}\n` +
      `🎰 Lottery kept: ${token.lotteryTickets} tokens\n` +
      `📊 ${reason}\n` +
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
  const tradeableEth = getTradeableEth(ethBalance);
  const hl           = getRecentHighLow(token.symbol);
  const cyclePos     = hl ? getCyclePosition(token.symbol, price).toFixed(0) : "?";
  const lottery      = token.lotteryTickets || 0;
  const sellable     = Math.max(balance - lottery, 0);
  const entry        = token.entryPrice;
  const pctEntry     = entry ? ((price - entry) / entry * 100).toFixed(2) : "n/a";

  // Buy zone = within 8% above recent LOW
  const inBuyZone  = hl ? price <= hl.low * (1 + BUY_ZONE) : false;
  // Sell zone = at or above 88% of recent HIGH
  const inSellZone = hl ? price >= hl.high * SELL_ZONE : false;
  // Breakout = price exceeded recent HIGH
  const isBreakout = hl ? price >= hl.high * 1.03 : false;

  console.log(`\n  [${token.symbol}]`);
  console.log(`   💲 $${price.toFixed(8)} | Cycle: ${cyclePos}% | ${momentum.direction}`);
  console.log(`   🪙 ${balance.toFixed(0)} tokens ($${valueUsd}) | P&L: ${pctEntry}%`);
  console.log(`   📊 LOW:$${hl?.low.toFixed(8)||"?"} HIGH:$${hl?.high.toFixed(8)||"?"} | ${hl?.readings||0} readings`);
  console.log(`   🎯 BuyZone:${inBuyZone} SellZone:${inSellZone} Breakout:${isBreakout}`);

  // ── SELL SIGNALS ─────────────────────────────────────────────────────────
  if (sellable > 1) {

    if (isBreakout) {
      // Price broke above recent HIGH — take half profit, let rest ride
      await executeSell(cdp, token, 0.50, `BREAKOUT above HIGH +${(((price/hl.high)-1)*100).toFixed(1)}%`, price, hl);

    } else if (inSellZone && momentum.direction !== "up") {
      // At HIGH zone, momentum fading — take big profit
      await executeSell(cdp, token, 0.90, `AT HIGH ZONE — momentum fading`, price, hl);

    } else if (inSellZone && momentum.direction === "up") {
      // Still climbing — small skim only, keep riding
      await executeSell(cdp, token, 0.10, `APPROACHING HIGH — small skim`, price, hl);
    }

  // ── BUY SIGNALS ──────────────────────────────────────────────────────────
  } else if (tradeableEth >= MIN_ETH_TRADE) {

    if (inBuyZone && momentum.direction !== "down") {
      // At LOW zone and stabilizing — full buy
      await executeBuy(cdp, token, tradeableEth, `AT LOW ZONE — stabilizing`, price, hl);

    } else if (inBuyZone && momentum.direction === "down") {
      // Still falling — partial buy, save ETH for lower price
      await executeBuy(cdp, token, tradeableEth * 0.4, `FALLING INTO LOW — partial entry`, price, hl);

    } else if ((!hl || hl.readings < 15) && balance < 1 && token.status === "active") {
      // No history yet — small buy to start building data
      await executeBuy(cdp, token, tradeableEth, `INITIAL ENTRY — building cycle data`, price, hl);
    }
  }
}

// ── 30 MIN TELEGRAM REPORT ────────────────────────────────────────────────
async function sendReport(ethBalance) {
  if (Date.now() - lastReportTime < REPORT_INTERVAL) return;
  lastReportTime = Date.now();

  let lines = "";
  for (const t of tokens) {
    const price = history[t.symbol]?.lastPrice;
    if (!price) continue;
    const bal    = await getTokenBalance(t.address);
    const usd    = (bal * price).toFixed(2);
    const hl     = getRecentHighLow(t.symbol);
    const pos    = hl ? getCyclePosition(t.symbol, price).toFixed(0) : "?";
    const entry  = t.entryPrice || price;
    const pct    = ((price - entry) / entry * 100).toFixed(1);
    const up     = parseFloat(pct) >= 0;
    const inBuy  = hl ? price <= hl.low * (1 + BUY_ZONE) : false;
    const inSell = hl ? price >= hl.high * SELL_ZONE : false;
    const zone   = inSell ? "🔴 SELL ZONE" : inBuy ? "🟢 BUY ZONE" : "⬜ WATCHING";

    lines +=
      `\n\n<b>${t.symbol}</b> ${zone}\n` +
      `💲 $${price.toFixed(8)} | Cycle: ${pos}%\n` +
      `🪙 ${Math.floor(bal).toLocaleString()} tokens ($${usd})\n` +
      `📊 P&L: ${up?"+":""}${pct}% from entry\n` +
      `🎰 Lottery: ${(t.lotteryTickets||0).toLocaleString()}\n` +
      (hl ? `📉 LOW: $${hl.low.toFixed(8)}\n📈 HIGH: $${hl.high.toFixed(8)}` : `📊 Building cycle data...`);
  }

  await sendAlert(
    `📊 <b>GUARDIAN CASCADE v7 — 30 MIN REPORT</b>\n\n` +
    `💰 ETH: ${ethBalance.toFixed(6)} (~$${(ethBalance*ETH_USD).toFixed(2)})\n` +
    `♻️ Tradeable: ${getTradeableEth(ethBalance).toFixed(6)} ETH\n` +
    `🐷 Piggy bank: ${piggyBank.toFixed(6)} ETH\n` +
    `📈 Total trades: ${tradeCount}` +
    lines + `\n\n` +
    `🔗 <a href="https://basescan.org/address/${WALLET_ADDRESS}">View wallet</a>`
  );
}

// ── MAIN ──────────────────────────────────────────────────────────────────
async function main() {
  console.log("═══════════════════════════════════════════════════");
  console.log("⚔️   GUARDIAN CASCADE SYSTEM v7 — FULL VISION");
  console.log("═══════════════════════════════════════════════════\n");

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
    `⚔️ <b>GUARDIAN CASCADE v7 — STARTED</b>\n\n` +
    `👛 <code>${WALLET_ADDRESS}</code>\n` +
    `💰 ETH: ${ethBalance.toFixed(6)} (~$${(ethBalance*ETH_USD).toFixed(2)})\n` +
    `🪙 Tracking: ${tokens.map(t=>t.symbol).join(", ")}\n\n` +
    `🧠 STRATEGY:\n` +
    `   📉 Buy near recent LOW\n` +
    `   📈 Sell near recent HIGH\n` +
    `   ♻️ Profits cascade into next dip\n` +
    `   🔁 Tokens fund each other in loop\n\n` +
    `⛽ Gas reserve: ${GAS_RESERVE} ETH locked\n` +
    `🛡️ Trade must be ${FEE_SAFETY}x gas cost\n` +
    `🐷 2% of every profit saved\n` +
    `📊 Reports every 30 mins\n` +
    `💾 Saves to GitHub every 30 mins`
  );

  while (true) {
    try {
      const eth = await getEthBalance();
      console.log(`\n${"═".repeat(50)}`);
      console.log(`${new Date().toLocaleTimeString()} | ETH: ${eth.toFixed(6)} | Trades: ${tradeCount}`);
      console.log(`Tradeable: ${getTradeableEth(eth).toFixed(6)} ETH | Piggy: ${piggyBank.toFixed(6)} ETH`);

      for (const token of tokens) {
        await processToken(cdp, token, eth);
        await new Promise(r => setTimeout(r, 2000));
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
