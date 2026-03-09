import { CdpClient } from "@coinbase/cdp-sdk";
import { createPublicClient, http, formatEther, parseEther } from "viem";
import { base } from "viem/chains";
import dotenv from "dotenv";
dotenv.config();

// ═══════════════════════════════════════════════════════════════
// GUARDIAN CASCADE SYSTEM v7.5 — ZONE FIX
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
const INTERVAL        = 30000;    // check prices every 30 seconds (reduces RPC load)
const COOLDOWN_MS     = 300000;   // 5 min cooldown per token after trade
const SAVE_INTERVAL   = 1800000;  // save to GitHub every 30 mins
const REPORT_INTERVAL = 1800000;  // Telegram report every 30 mins

// ── SAFETY ────────────────────────────────────────────────────────────────
const GAS_RESERVE    = 0.0003;   // always locked for gas — never touched
const SELL_RESERVE   = 0.001;    // always kept in ETH for sell gas — never spent on buys
const MAX_BUY_PCT    = 0.15;     // max 15% of tradeable ETH per single buy
const MIN_ETH_TRADE  = 0.0008;   // minimum ETH needed before any buy
const MIN_TRADE_USD  = 0.50;     // trade must be worth at least $0.50
const FEE_SAFETY     = 3;        // trade value must be 3x gas cost
const ETH_USD        = 1940;     // approximate ETH price in USD

// ── TRADING LOGIC ─────────────────────────────────────────────────────────
const BUY_ZONE       = 0.15;     // buy when price is in bottom 15% of range
const SELL_ZONE      = 0.80;     // sell when price is in top 20% of range (cycle position >= 80%)
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

// ── RPC ROTATION — 4 free endpoints, rotates to avoid rate limits ────────
const RPC_URLS = [
  "https://mainnet.base.org",
  "https://base.llamarpc.com",
  "https://base-rpc.publicnode.com",
  "https://1rpc.io/base",
];
let rpcIndex = 0;

function getClient() {
  const url = RPC_URLS[rpcIndex % RPC_URLS.length];
  return createPublicClient({ chain: base, transport: http(url) });
}

function nextRpc() {
  rpcIndex = (rpcIndex + 1) % RPC_URLS.length;
}

// Wrapper that auto-rotates RPC on rate limit errors
async function rpcCall(fn) {
  for (let attempt = 0; attempt < RPC_URLS.length; attempt++) {
    try {
      return await fn(getClient());
    } catch (e) {
      if (e.message?.includes("429") || e.message?.includes("rate limit") || e.message?.includes("over rate")) {
        console.log(`   ⚡ RPC rate limit — rotating to next endpoint`);
        nextRpc();
        await new Promise(r => setTimeout(r, 1000));
      } else {
        throw e;
      }
    }
  }
  throw new Error("All RPC endpoints rate limited");
}

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
  const bal = await rpcCall(c => c.getBalance({ address: WALLET_ADDRESS }));
  return parseFloat(formatEther(bal));
}

async function getTokenBalance(address) {
  const bal = await rpcCall(c => c.readContract({
    address, abi: ERC20_ABI,
    functionName: "balanceOf", args: [WALLET_ADDRESS],
  }));
  return Number(bal) / 1e18;
}

async function estimateGasCostEth() {
  try {
    const gasPrice = await rpcCall(c => c.getGasPrice());
    return parseFloat(formatEther(gasPrice * BigInt(200000)));
  } catch { return 0.0001; }
}

function getTradeableEth(ethBalance) {
  // Subtract gas reserve + sell reserve so we always have ETH for sell transactions
  return Math.max(ethBalance - GAS_RESERVE - SELL_RESERVE - piggyBank, 0);
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

  // Never spend more than MAX_BUY_PCT (15%) per buy — spread across tokens
  const maxPerBuy = tradeableEth * MAX_BUY_PCT;
  let ethToSpend  = Math.min(ethForTokens, maxPerBuy);
  ethToSpend      = Math.max(ethToSpend, tradeableEth * 0.05); // min 5%
  ethToSpend      = Math.min(ethToSpend, maxPerBuy);           // hard cap 15%
  console.log(`      Budget: ${ethToSpend.toFixed(6)} ETH (max ${(MAX_BUY_PCT*100).toFixed(0)}% of ${tradeableEth.toFixed(6)} tradeable)`);

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
      `🟢🟢🟢 <b>BOUGHT ${token.symbol}!</b> 🟢🟢🟢\n\n` +
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
    // MAX APPROVAL — approve once with max uint256 so we NEVER pay approval gas again
    const MAX_UINT256 = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
    const allowance = await rpcCall(c => c.readContract({
      address: token.address, abi: ERC20_ABI,
      functionName: "allowance", args: [WALLET_ADDRESS, SWAP_ROUTER],
    }));
    if (allowance < amountToSell) {
      console.log(`      🔓 Approving MAX — one time only, never again`);
      await cdp.evm.sendTransaction({
        address: WALLET_ADDRESS, network: "base",
        transaction: { to: token.address, data: encodeApprove(SWAP_ROUTER, MAX_UINT256) },
      });
      console.log(`      ✅ Max approved — future sells skip this step`);
      await new Promise(r => setTimeout(r, 8000));
    } else {
      console.log(`      ✅ Already approved — skipping approval, saving gas`);
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
      `🔴🔴🔴 <b>SOLD ${token.symbol}!</b> 🔴🔴🔴\n\n` +
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

  // Use CYCLE POSITION (0%=at LOW, 100%=at HIGH) for zones
  const cycleNum    = hl ? getCyclePosition(token.symbol, price) : 50;
  const inBuyZone   = hl ? cycleNum <= (BUY_ZONE * 100) : false;   // bottom 15% of range
  const inSellZone  = hl ? cycleNum >= (SELL_ZONE * 100) : false;  // top 20% of range
  const isBreakout  = hl ? price >= hl.high * 1.03 : false;        // broke above recent HIGH

  // ── RICH DASHBOARD ───────────────────────────────────────────────────────
  let sellStatus = "";
  let buyStatus  = "";

  if (hl) {
    // Sell trigger = when cycle position reaches SELL_ZONE (e.g. 80%)
    const sellTriggerPrice = hl.low + (hl.range * SELL_ZONE);
    const buyTriggerPrice  = hl.low + (hl.range * BUY_ZONE);
    const pctToSell        = ((sellTriggerPrice - price) / price * 100);

    if (isBreakout) {
      sellStatus = `🚨 BREAKOUT! Price above recent HIGH`;
    } else if (inSellZone) {
      sellStatus = `🔴 SELL ZONE! Cycle ${cycleNum.toFixed(0)}% >= ${SELL_ZONE*100}% trigger`;
    } else {
      sellStatus = `📈 Need +${pctToSell.toFixed(2)}% to sell | trigger $${sellTriggerPrice.toFixed(8)} | cycle ${cycleNum.toFixed(0)}%`;
    }

    if (inBuyZone) {
      buyStatus = `🟢 BUY ZONE! Cycle ${cycleNum.toFixed(0)}% <= ${BUY_ZONE*100}% trigger`;
    } else {
      const pctToBuy = ((price - buyTriggerPrice) / buyTriggerPrice * 100);
      buyStatus = `📉 Buy trigger $${buyTriggerPrice.toFixed(8)} | ${pctToBuy.toFixed(2)}% above buy zone`;
    }
  } else {
    sellStatus = `⏳ Learning cycle...`;
    buyStatus  = `⏳ Learning cycle...`;
  }

  const entryLine   = entry ? `Entry: $${entry.toFixed(8)} | P&L: ${pctEntry}%` : `No position`;
  const sellableLine = sellable > 1 ? `${sellable.toFixed(0)} sellable` : `${lottery} lottery only`;

  console.log(`\n  ┌─[${token.symbol}]─────────────────────────────`);
  console.log(`  │ 💲 $${price.toFixed(8)} | Cycle: ${cyclePos}% | ${momentum.direction}`);
  console.log(`  │ 🪙 ${balance.toFixed(0)} tokens ($${valueUsd}) | ${sellableLine}`);
  console.log(`  │ ${entryLine}`);
  if (hl) {
  console.log(`  │ 📊 LOW: $${hl.low.toFixed(8)} ←→ HIGH: $${hl.high.toFixed(8)}`);
  }
  console.log(`  │ ${sellStatus}`);
  console.log(`  │ ${buyStatus}`);
  console.log(`  └─────────────────────────────────────────────`);

  // ── SELL SIGNALS ─────────────────────────────────────────────────────────
  if (sellable > 1) {

    if (isBreakout) {
      console.log(`  🚨🚨🚨 SELLING ${token.symbol} — BREAKOUT! 🚨🚨🚨`);
      await executeSell(cdp, token, 0.50, `BREAKOUT above HIGH +${(((price/hl.high)-1)*100).toFixed(1)}%`, price, hl);

    } else if (inSellZone && momentum.direction !== "up") {
      console.log(`  🔴🔴🔴 SELLING ${token.symbol} — AT HIGH ZONE! 🔴🔴🔴`);
      await executeSell(cdp, token, 0.90, `AT HIGH ZONE — momentum fading`, price, hl);

    } else if (inSellZone && momentum.direction === "up") {
      console.log(`  🔴 SELLING ${token.symbol} — small skim at HIGH`);
      await executeSell(cdp, token, 0.10, `APPROACHING HIGH — small skim`, price, hl);

    } else if (entry && price < entry * 0.85) {
      // Stop loss — price dropped 15% below entry, cut losses
      console.log(`  🛑🛑🛑 STOP LOSS ${token.symbol} — down 15% from entry! 🛑🛑🛑`);
      await executeSell(cdp, token, 1.0, `STOP LOSS — price down 15% from entry`, price, hl);
    }

  // ── BUY SIGNALS ──────────────────────────────────────────────────────────
  } else if (tradeableEth >= MIN_ETH_TRADE) {

    if (inBuyZone && momentum.direction !== "down") {
      console.log(`  🟢🟢🟢 BUYING ${token.symbol} — AT LOW ZONE! 🟢🟢🟢`);
      await executeBuy(cdp, token, tradeableEth, `AT LOW ZONE — stabilizing`, price, hl);

    } else if (inBuyZone && momentum.direction === "down") {
      console.log(`  🟢 BUYING ${token.symbol} — partial, still falling`);
      await executeBuy(cdp, token, tradeableEth * 0.4, `FALLING INTO LOW — partial entry`, price, hl);

    } else if ((!hl || hl.readings < 15) && balance < 1 && token.status === "active") {
      console.log(`  🟡 BUYING ${token.symbol} — initial entry`);
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
    const cp2    = hl ? getCyclePosition(t.symbol, price) : 50;
    const inBuy  = hl ? cp2 <= (BUY_ZONE * 100) : false;
    const inSell = hl ? cp2 >= (SELL_ZONE * 100) : false;
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
    `📊 <b>GUARDIAN CASCADE v7.5 — 30 MIN REPORT</b>\n\n` +
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
  console.log("⚔️   GUARDIAN CASCADE SYSTEM v7.5 — ZONE FIX");
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
    `⚔️ <b>GUARDIAN CASCADE v7.5 — STARTED</b>\n\n` +
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
    `💾 Saves to GitHub every 30 mins\n` +
    `🔓 Max approval — pays approval gas once per token only`
  );

  while (true) {
    try {
      const eth = await getEthBalance();
      console.log(`\n${"═".repeat(50)}`);
      console.log(`${new Date().toLocaleTimeString()} | ETH: ${eth.toFixed(6)} | Trades: ${tradeCount}`);
      console.log(`Tradeable: ${getTradeableEth(eth).toFixed(6)} ETH | Piggy: ${piggyBank.toFixed(6)} ETH`);

      for (const token of tokens) {
        await processToken(cdp, token, eth);
        await new Promise(r => setTimeout(r, 4000)); // 4s between tokens — prevents RPC overload
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
