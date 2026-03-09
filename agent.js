import { CdpClient } from "@coinbase/cdp-sdk";
import { createPublicClient, http, formatEther, parseEther } from "viem";
import { base } from "viem/chains";
import dotenv from "dotenv";
dotenv.config();

// ═══════════════════════════════════════════════════════════════
// GUARDIAN CASCADE SYSTEM v8.2 — SMART BUY + LOTTERY SAVINGS
//
// HOW IT WORKS:
//  - Watches all 8 tokens every 30 seconds
//  - Learns each token's recent HIGH and LOW from price history
//  - Buys near the LOW — but waits 2 min to confirm direction first
//    (if still falling → reset clock, wait for real bottom)
//    (if holds or rises for 2 min → BUY)
//  - Sells 98% at HIGH zone — even if still rising
//  - 2% lottery tokens kept FOREVER as permanent jackpot savings
//  - Capital protect: if price drifts within 1% above entry → sell
//  - Sells return WETH — bot spends WETH directly on next buy (no unwrap gas)
//  - Always logs buy target price every single cycle
//  - Must 3x cover fees before any trade fires
//  - Gas cost checked before EVERY trade — never trades at a loss
//  - 5 min cooldown per token after any trade
//  - Reports to Telegram every 30 mins
//  - Saves to GitHub every 30 mins
// ═══════════════════════════════════════════════════════════════

const WALLET_ADDRESS = "0x50e1C4608c48b0c52E1EA5FBabc1c9126eA17915";
const WETH_ADDRESS   = "0x4200000000000000000000000000000000000006";
const SWAP_ROUTER    = "0x2626664c2603336E57B271c5C0b26F421741e481";

// ── TIMING ────────────────────────────────────────────────────────────────
const INTERVAL        = 30000;    // check prices every 30 seconds
const COOLDOWN_MS     = 300000;   // 5 min cooldown per token after trade
const SAVE_INTERVAL   = 1800000;  // save to GitHub every 30 mins
const REPORT_INTERVAL = 1800000;  // Telegram report every 30 mins

// ── SAFETY ────────────────────────────────────────────────────────────────
const GAS_RESERVE   = 0.0003;  // always locked for gas — never touched
const SELL_RESERVE  = 0.001;   // always kept for sell gas — never spent on buys
const MAX_BUY_PCT   = 0.15;    // max 15% of tradeable ETH per single buy
const MIN_ETH_TRADE = 0.0008;  // minimum ETH needed before any buy
const MIN_TRADE_USD = 0.05;    // trade must be worth at least $0.05
const FEE_SAFETY    = 3;       // trade value must be 3x gas cost
const ETH_USD       = 1940;    // approximate ETH price in USD

// ── TRADING LOGIC ─────────────────────────────────────────────────────────
const BUY_ZONE       = 0.15;    // buy when in bottom 15% of cycle range
const SELL_ZONE      = 0.80;    // sell when in top 20% of cycle range
const PROFIT_TARGET  = 500;     // $500 target per token cycle
const HISTORY_DAYS   = 3;       // use last 3 days for high/low
const BUY_CONFIRM_MS = 120000;  // 2 min confirmation before buying
const LOTTERY_PCT    = 0.02;    // 2% of tokens kept forever as lottery savings
const SELL_ALL_PCT   = 0.98;    // sell 98%, keep 2% lottery forever
const ENTRY_CUSHION  = 0.01;    // sell if price gets within 1% above entry

// ── GITHUB ────────────────────────────────────────────────────────────────
const GITHUB_TOKEN  = process.env.GITHUB_TOKEN;
const GITHUB_REPO   = process.env.GITHUB_REPO;
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || "main";

// ── ABIs ──────────────────────────────────────────────────────────────────
const ERC20_ABI = [
  { name: "balanceOf", type: "function", stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }] },
  { name: "allowance", type: "function", stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }],
    outputs: [{ name: "", type: "uint256" }] },
];

const WETH_ABI = [
  { name: "balanceOf", type: "function", stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }] },
  { name: "withdraw", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "wad", type: "uint256" }], outputs: [] },
];

// ── RPC ROTATION — 4 free endpoints, rotates to avoid rate limits ─────────
const RPC_URLS = [
  "https://mainnet.base.org",
  "https://base.llamarpc.com",
  "https://base-rpc.publicnode.com",
  "https://1rpc.io/base",
];
let rpcIndex = 0;

function getClient() {
  return createPublicClient({ chain: base, transport: http(RPC_URLS[rpcIndex % RPC_URLS.length]) });
}

function nextRpc() {
  rpcIndex = (rpcIndex + 1) % RPC_URLS.length;
}

async function rpcCall(fn) {
  for (let attempt = 0; attempt < RPC_URLS.length; attempt++) {
    try {
      return await fn(getClient());
    } catch (e) {
      if (e.message?.includes("429") || e.message?.includes("rate limit") || e.message?.includes("over rate")) {
        console.log(`   ⚡ RPC rate limit — rotating endpoint`);
        nextRpc();
        await new Promise(r => setTimeout(r, 1000));
      } else {
        throw e;
      }
    }
  }
  throw new Error("All RPC endpoints rate limited");
}

// ── ALL 8 TOKENS ──────────────────────────────────────────────────────────
const DEFAULT_TOKENS = [
  { symbol: "DEGEN",   address: "0x4ed4e862860bed51a9570b96d89af5e1b0efefed", status: "active", entryPrice: null, totalInvested: 0 },
  { symbol: "TOSHI",   address: "0xAC1Bd2486aAf3B5C0fc3Fd868558b082a531B2B4", status: "active", entryPrice: null, totalInvested: 0 },
  { symbol: "BRETT",   address: "0x532f27101965dd16442E59d40670FaF5eBB142E4", status: "active", entryPrice: null, totalInvested: 0 },
  { symbol: "AERO",    address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631", status: "active", entryPrice: null, totalInvested: 0 },
  { symbol: "VIRTUAL", address: "0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b", status: "active", entryPrice: null, totalInvested: 0 },
  { symbol: "AIXBT",   address: "0x4F9Fd6Be4a90f2620860d680c0d4d5Fb53d1A825", status: "active", entryPrice: null, totalInvested: 0 },
  { symbol: "CLANKER", address: "0x1bc0c42215582d5a085795f4badbac3ff36d1bcb", status: "active", entryPrice: null, totalInvested: 0 },
  { symbol: "SEAM",    address: "0x1C7a460413dD4e964f96D8dFC56E7223cE88CD85", status: "active", entryPrice: null, totalInvested: 0 },
];

// ── STATE ─────────────────────────────────────────────────────────────────
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

// Buy confirmation tracker: symbol → { firstSeenMs, priceAtFirst }
const buyConfirmations = {};

// ── GITHUB OPS ────────────────────────────────────────────────────────────
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
    const saved = tf.content.tokens;
    tokens = DEFAULT_TOKENS.map(def => {
      const existing = saved.find(s => s.symbol === def.symbol);
      return existing ? { ...def, ...existing } : def;
    });
    tokensSha = tf.sha;
  } else {
    tokens = DEFAULT_TOKENS.map(t => ({ ...t }));
  }
  // Always clear old lottery ticket locks — lottery is now calculated live from balance
  for (const t of tokens) { t.lotteryTickets = 0; }
  console.log(`✅ ${tokens.length} tokens: ${tokens.map(t => t.symbol).join(", ")}`);

  const hf = await githubGet("history.json");
  if (hf) {
    history    = hf.content || {};
    historySha = hf.sha;
    console.log(`✅ History: ${Object.keys(history).join(", ") || "none yet"}`);
  } else {
    history = {};
  }

  const pf = await githubGet("positions.json");
  if (pf && pf.content) {
    positionsSha = pf.sha;
    const pos    = pf.content;
    if (pos.piggyBank)    piggyBank    = pos.piggyBank;
    if (pos.totalSkimmed) totalSkimmed = pos.totalSkimmed;
    if (pos.tradeCount)   tradeCount   = pos.tradeCount;
    if (pos.entries) {
      for (const t of tokens) {
        if (pos.entries[t.symbol] !== undefined) {
          t.entryPrice    = pos.entries[t.symbol];
          t.totalInvested = pos.invested?.[t.symbol] || 0;
        }
      }
    }
    const restored = Object.keys(pos.entries || {}).filter(k => pos.entries[k]).join(", ");
    console.log(`✅ Positions restored: ${restored || "none"}`);
    console.log(`✅ Piggy bank: ${piggyBank.toFixed(6)} ETH | Trades: ${tradeCount}`);
  } else {
    console.log("✅ No saved positions — fresh start");
  }
}

async function saveToGitHub() {
  console.log("💾 Saving to GitHub...");
  tokensSha  = await githubSave("tokens.json",  { tokens, lastSaved: new Date().toISOString() }, tokensSha);
  historySha = await githubSave("history.json", history, historySha);
  const positions = {
    lastSaved:    new Date().toISOString(),
    piggyBank,
    totalSkimmed,
    tradeCount,
    entries:  Object.fromEntries(tokens.map(t => [t.symbol, t.entryPrice || null])),
    invested: Object.fromEntries(tokens.map(t => [t.symbol, t.totalInvested || 0])),
  };
  positionsSha = await githubSave("positions.json", positions, positionsSha);
  lastSaveTime = Date.now();
  console.log("✅ Saved — positions, history, tokens");
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

// ── PRICE FEEDS — GeckoTerminal primary, DexScreener fallback ─────────────
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
  const bal = await rpcCall(c => c.readContract({
    address, abi: ERC20_ABI,
    functionName: "balanceOf", args: [WALLET_ADDRESS],
  }));
  return Number(bal) / 1e18;
}

async function getWethBalance() {
  try {
    const bal = await rpcCall(c => c.readContract({
      address: WETH_ADDRESS, abi: WETH_ABI,
      functionName: "balanceOf", args: [WALLET_ADDRESS],
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

// ── WETH UNWRAP — converts WETH → ETH so rebuys work ─────────────────────
async function unwrapWethIfNeeded(cdp) {
  const wethBal = await getWethBalance();
  if (wethBal < 0.0001) return;
  console.log(`   🔄 Found ${wethBal.toFixed(6)} WETH — unwrapping to ETH...`);
  try {
    const amount = parseEther(wethBal.toFixed(18));
    const data   = "0x2e1a7d4d" + BigInt(amount).toString(16).padStart(64, "0");
    await cdp.evm.sendTransaction({
      address: WALLET_ADDRESS, network: "base",
      transaction: { to: WETH_ADDRESS, data },
    });
    await new Promise(r => setTimeout(r, 8000));
    console.log(`   ✅ Unwrapped ${wethBal.toFixed(6)} WETH → ETH — ready to buy`);
    await sendAlert(`🔄 <b>WETH UNWRAPPED</b>\n${wethBal.toFixed(6)} WETH → ETH\nReady to buy!`);
  } catch (e) {
    console.log(`   ⚠️ Unwrap failed: ${e.message}`);
  }
}

// ── CYCLE ANALYSIS — THE BRAIN ────────────────────────────────────────────
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

// 0% = at LOW, 100% = at HIGH
function getCyclePosition(symbol, price) {
  const hl = getRecentHighLow(symbol);
  if (!hl || hl.range === 0) return 50;
  return ((price - hl.low) / hl.range) * 100;
}

function recordPrice(symbol, price) {
  if (!history[symbol]) history[symbol] = { readings: [], lastPrice: null };
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
  const avg = moves.reduce((a, b) => a + b, 0) / moves.length;
  return {
    direction: avg > 0.0002 ? "up" : avg < -0.0002 ? "down" : "neutral",
    speed: Math.abs(avg),
  };
}

function canTrade(symbol) {
  const elapsed = Date.now() - (lastTradeTime[symbol] || 0);
  if (elapsed < COOLDOWN_MS) {
    console.log(`   ⏳ ${symbol} cooldown: ${Math.ceil((COOLDOWN_MS - elapsed) / 1000)}s`);
    return false;
  }
  return true;
}

// ── FEE SAFETY — trade must be 3x gas cost ────────────────────────────────
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
function encodeSwap(tokenIn, tokenOut, amountIn, recipient, fee = 3000) {
  const p = (v, isAddr = false) => (isAddr ? v.slice(2) : BigInt(v).toString(16)).padStart(64, "0");
  return "0x04e45aaf"
    + p(tokenIn, true) + p(tokenOut, true) + p(fee)
    + p(recipient, true) + p(amountIn) + p(0) + p(0);
}

function encodeApprove(spender, amount) {
  return "0x095ea7b3"
    + spender.slice(2).padStart(64, "0")
    + amount.toString(16).padStart(64, "0");
}

// CLANKER only has liquidity in the 1% pool — all others use 0.3%
function getFeeTier(tokenAddress) {
  if (tokenAddress.toLowerCase() === "0x1bc0c42215582d5a085795f4badbac3ff36d1bcb") return 10000;
  return 3000;
}

// ── BUY — spends ETH or WETH directly, no unwrap needed ──────────────────
async function executeBuy(cdp, token, tradeableEth, reason, price, hl) {
  if (!canTrade(token.symbol)) return;

  // Check both ETH and WETH available
  const wethBal    = await getWethBalance();
  const totalAvail = tradeableEth + wethBal;

  if (totalAvail < MIN_ETH_TRADE) {
    console.log(`   🛑 ETH+WETH too low (${totalAvail.toFixed(6)})`);
    return;
  }

  const targetPrice  = hl ? hl.high : price * 1.3;
  const tokensNeeded = Math.ceil(PROFIT_TARGET / targetPrice);
  const currentBal   = await getTokenBalance(token.address);
  const stillNeed    = Math.max(tokensNeeded - currentBal, 0);
  const ethForTokens = stillNeed * price;

  const maxPerBuy = totalAvail * MAX_BUY_PCT;
  let ethToSpend  = Math.min(ethForTokens, maxPerBuy);
  ethToSpend      = Math.max(ethToSpend, totalAvail * 0.05);
  ethToSpend      = Math.min(ethToSpend, maxPerBuy);

  console.log(`      Budget: ${ethToSpend.toFixed(6)} ETH (max 15% of ${totalAvail.toFixed(6)} available)`);

  if (!await isTradeProfitable(ethToSpend)) return;

  const amountIn = parseEther(ethToSpend.toFixed(18));

  // Use WETH if we have enough, otherwise use native ETH
  const useWeth = wethBal >= ethToSpend;
  console.log(`\n   🟢 BUY ${token.symbol} — ${reason}`);
  console.log(`      ${ethToSpend.toFixed(6)} ${useWeth ? "WETH" : "ETH"} @ $${price.toFixed(8)}`);
  console.log(`      LOW: $${hl?.low.toFixed(8) || "?"} | HIGH: $${hl?.high.toFixed(8) || "?"}`);

  try {
    let txData;
    if (useWeth) {
      // WETH → token: needs approve + swap (no value field)
      const MAX_UINT256 = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
      const allowance   = await rpcCall(c => c.readContract({
        address: WETH_ADDRESS, abi: ERC20_ABI,
        functionName: "allowance", args: [WALLET_ADDRESS, SWAP_ROUTER],
      }));
      if (allowance < amountIn) {
        console.log(`      🔓 Approving WETH for swap...`);
        await cdp.evm.sendTransaction({
          address: WALLET_ADDRESS, network: "base",
          transaction: { to: WETH_ADDRESS, data: encodeApprove(SWAP_ROUTER, MAX_UINT256) },
        });
        await new Promise(r => setTimeout(r, 8000));
      }
      const { transactionHash } = await cdp.evm.sendTransaction({
        address: WALLET_ADDRESS, network: "base",
        transaction: {
          to: SWAP_ROUTER,
          data: encodeSwap(WETH_ADDRESS, token.address, amountIn, WALLET_ADDRESS, getFeeTier(token.address)),
        },
      });
      txData = transactionHash;
    } else {
      // Native ETH → token (original path)
      const { transactionHash } = await cdp.evm.sendTransaction({
        address: WALLET_ADDRESS, network: "base",
        transaction: {
          to: SWAP_ROUTER, value: amountIn,
          data: encodeSwap(WETH_ADDRESS, token.address, amountIn, WALLET_ADDRESS, getFeeTier(token.address)),
        },
      });
      txData = transactionHash;
    }

    lastTradeTime[token.symbol] = Date.now();
    tradeCount++;
    token.entryPrice    = price;
    token.totalInvested = (token.totalInvested || 0) + ethToSpend;

    console.log(`      ✅ https://basescan.org/tx/${txData}`);
    await sendAlert(
      `🟢🟢🟢 <b>BOUGHT ${token.symbol}!</b> 🟢🟢🟢\n\n` +
      `💰 Spent: ${ethToSpend.toFixed(6)} ${useWeth ? "WETH" : "ETH"}\n` +
      `💲 Entry: $${price.toFixed(8)}\n` +
      `📉 Recent LOW: $${hl?.low.toFixed(8) || "learning"}\n` +
      `📈 Recent HIGH: $${hl?.high.toFixed(8) || "learning"}\n` +
      `🎯 $${PROFIT_TARGET} target at HIGH\n` +
      `📊 ${reason}\n` +
      `🔗 <a href="https://basescan.org/tx/${txData}">Basescan</a>`
    );
  } catch (e) {
    console.log(`      ❌ BUY FAILED: ${e.message}`);
    await sendAlert(`⚠️ <b>${token.symbol} BUY FAILED</b>\n${e.message}`);
  }
}

// ── SELL — keeps 2% lottery forever, sells the rest ───────────────────────
async function executeSell(cdp, token, sellPct, reason, price, hl) {
  if (!canTrade(token.symbol)) return;

  const totalBal    = await getTokenBalance(token.address);
  const lotteryHold = Math.max(Math.floor(totalBal * LOTTERY_PCT), 1);
  const sellable    = Math.max(totalBal - lotteryHold, 0);

  if (sellable < 1) {
    console.log(`   ⏳ ${token.symbol}: nothing to sell (${lotteryHold} held as lottery)`);
    return;
  }

  // Never sell below entry price (unless capital protect)
  if (token.entryPrice && price < token.entryPrice && !reason.includes("CAPITAL PROTECT")) {
    console.log(`   🛑 ${token.symbol} below entry — holding`);
    return;
  }

  const amountToSell = BigInt(Math.floor(sellable * sellPct * 1e18));
  if (amountToSell === BigInt(0)) return;

  const sellValueEth = (sellable * sellPct * price) / ETH_USD;
  if (!await isTradeProfitable(sellValueEth)) return;

  console.log(`\n   🔴 SELL ${token.symbol} — ${reason}`);
  console.log(`      Selling ${(sellPct * 100).toFixed(0)}% of ${sellable.toFixed(0)} tokens @ $${price.toFixed(8)}`);
  console.log(`      🎰 Keeping ${lotteryHold} tokens FOREVER as lottery savings`);

  try {
    const MAX_UINT256 = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
    const allowance   = await rpcCall(c => c.readContract({
      address: token.address, abi: ERC20_ABI,
      functionName: "allowance", args: [WALLET_ADDRESS, SWAP_ROUTER],
    }));
    if (allowance < amountToSell) {
      console.log(`      🔓 Approving MAX — one time only`);
      await cdp.evm.sendTransaction({
        address: WALLET_ADDRESS, network: "base",
        transaction: { to: token.address, data: encodeApprove(SWAP_ROUTER, MAX_UINT256) },
      });
      console.log(`      ✅ Max approved — future sells skip this step`);
      await new Promise(r => setTimeout(r, 8000));
    } else {
      console.log(`      ✅ Already approved — skipping, saving gas`);
    }

    const ethBefore  = await getEthBalance();
    const wethBefore = await getWethBalance();
    const { transactionHash } = await cdp.evm.sendTransaction({
      address: WALLET_ADDRESS, network: "base",
      transaction: {
        to: SWAP_ROUTER,
        data: encodeSwap(token.address, WETH_ADDRESS, amountToSell, WALLET_ADDRESS, getFeeTier(token.address)),
      },
    });

    lastTradeTime[token.symbol] = Date.now();
    tradeCount++;

    await new Promise(r => setTimeout(r, 8000));
    const ethAfter   = await getEthBalance();
    const wethAfter  = await getWethBalance();
    // Profit = any new WETH received + any ETH change (gas costs)
    const profit    = (wethAfter - wethBefore) + (ethAfter - ethBefore);
    const profitUsd = (profit * ETH_USD).toFixed(2);

    if (profit > 0) {
      const skim    = profit * 0.01;
      piggyBank    += skim;
      totalSkimmed += skim;
    }

    token.entryPrice = null;

    console.log(`      ✅ https://basescan.org/tx/${transactionHash}`);
    console.log(`      💰 Profit: ${profit.toFixed(6)} ETH ($${profitUsd})`);
    console.log(`      🎰 Lottery saved: ${lotteryHold} ${token.symbol} forever`);

    await sendAlert(
      `🔴🔴🔴 <b>SOLD ${token.symbol}!</b> 🔴🔴🔴\n\n` +
      `💰 Received: ${profit.toFixed(6)} ETH (~$${profitUsd})\n` +
      `💲 Exit: $${price.toFixed(8)}\n` +
      `📈 Recent HIGH: $${hl?.high.toFixed(8) || "n/a"}\n` +
      `🎰 Keeping ${lotteryHold} tokens FOREVER as lottery savings\n` +
      `🐷 Piggy bank: ${piggyBank.toFixed(6)} ETH\n` +
      `📊 ${reason}\n` +
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
  const cycleNum     = hl ? getCyclePosition(token.symbol, price) : 50;
  const cyclePos     = hl ? cycleNum.toFixed(0) : "?";
  const entry        = token.entryPrice;
  const pctEntry     = entry ? ((price - entry) / entry * 100).toFixed(2) : "n/a";

  // Lottery = 2% held forever, never sold
  const lotteryHold = Math.floor(balance * LOTTERY_PCT);
  const sellable    = Math.max(balance - lotteryHold, 0);

  const inBuyZone  = hl ? cycleNum <= (BUY_ZONE * 100)  : false;
  const inSellZone = hl ? cycleNum >= (SELL_ZONE * 100) : false;
  const isBreakout = hl ? price >= hl.high * 1.03       : false;

  // ── ALWAYS LOG BUY & SELL TARGETS ────────────────────────────────────
  if (hl) {
    const buyTarget  = hl.low + (hl.range * BUY_ZONE);
    const sellTarget = hl.low + (hl.range * SELL_ZONE);
    const pctToBuy   = ((price - buyTarget) / buyTarget * 100);
    const pctToSell  = ((sellTarget - price) / price * 100);
    if (inBuyZone) {
      console.log(`  🎯 [${token.symbol}] ✅ IN BUY ZONE! Target: $${buyTarget.toFixed(8)} | Now: $${price.toFixed(8)}`);
    } else {
      console.log(`  🎯 [${token.symbol}] Buy: $${buyTarget.toFixed(8)} (${pctToBuy.toFixed(2)}% away) | Sell: $${sellTarget.toFixed(8)} (${pctToSell > 0 ? pctToSell.toFixed(2) + "% away" : "IN ZONE"})`);
    }
  } else {
    console.log(`  🎯 [${token.symbol}] Building cycle data... $${price.toFixed(8)}`);
  }

  // ── DASHBOARD ────────────────────────────────────────────────────────
  let zoneStatus = "";
  if (hl) {
    if (isBreakout)      zoneStatus = `🚨 BREAKOUT above HIGH!`;
    else if (inSellZone) zoneStatus = `🔴 SELL ZONE ${cyclePos}% >= ${SELL_ZONE * 100}%`;
    else if (inBuyZone)  zoneStatus = `🟢 BUY ZONE ${cyclePos}% <= ${BUY_ZONE * 100}%`;
    else                 zoneStatus = `⬜ WATCHING cycle ${cyclePos}%`;
  } else {
    zoneStatus = `⏳ Learning cycle...`;
  }

  const confirmInfo = buyConfirmations[token.symbol]
    ? ` ⏱️ ${Math.max(0, Math.ceil((BUY_CONFIRM_MS - (Date.now() - buyConfirmations[token.symbol].firstSeenMs)) / 1000))}s to confirm`
    : "";

  console.log(`\n  ┌─[${token.symbol}]─────────────────────────────`);
  console.log(`  │ 💲 $${price.toFixed(8)} | Cycle: ${cyclePos}% | ${momentum.direction}${confirmInfo}`);
  console.log(`  │ 🪙 ${balance.toFixed(0)} tokens ($${valueUsd}) | 🎰 Lottery: ${lotteryHold} forever`);
  console.log(`  │ ${entry ? `Entry: $${entry.toFixed(8)} | P&L: ${pctEntry}%` : "No position"}`);
  if (hl) console.log(`  │ 📊 LOW: $${hl.low.toFixed(8)} ←→ HIGH: $${hl.high.toFixed(8)}`);
  console.log(`  │ ${zoneStatus}`);
  console.log(`  └─────────────────────────────────────────────`);

  // ── SELL SIGNALS ──────────────────────────────────────────────────────
  if (sellable > 1) {

    // Capital protect: price drifted 1% above entry without reaching sell zone
    if (entry && !inSellZone && !isBreakout && price >= entry * (1 + ENTRY_CUSHION)) {
      console.log(`  💛💛💛 CAPITAL PROTECT ${token.symbol} — 1% cushion above entry 💛💛💛`);
      await executeSell(cdp, token, SELL_ALL_PCT, `CAPITAL PROTECT — 1% above entry $${entry.toFixed(8)}`, price, hl);
      return;
    }

    if (isBreakout) {
      console.log(`  🚨🚨🚨 SELLING ${token.symbol} — BREAKOUT! 🚨🚨🚨`);
      await executeSell(cdp, token, SELL_ALL_PCT * 0.5, `BREAKOUT above HIGH +${(((price / hl.high) - 1) * 100).toFixed(1)}%`, price, hl);

    } else if (inSellZone) {
      const direction = momentum.direction === "up" ? "still rising — selling anyway" : "momentum fading";
      console.log(`  🔴🔴🔴 SELLING ${token.symbol} — AT HIGH ZONE (${direction}) 🔴🔴🔴`);
      await executeSell(cdp, token, SELL_ALL_PCT, `AT HIGH ZONE — ${direction}`, price, hl);
    }

  // ── BUY SIGNALS — 2 MINUTE DIRECTION CONFIRMATION ────────────────────
  } else if (tradeableEth >= MIN_ETH_TRADE || await getWethBalance() >= MIN_ETH_TRADE) {

    if (inBuyZone) {
      const conf = buyConfirmations[token.symbol];

      if (!conf) {
        // First time in buy zone — start the 2 min clock
        buyConfirmations[token.symbol] = { firstSeenMs: Date.now(), priceAtFirst: price };
        console.log(`  ⏱️  [${token.symbol}] BUY ZONE hit — starting 2 min direction check`);
        console.log(`      Price: $${price.toFixed(8)} | Watching: hold or fall further?`);
        await sendAlert(
          `⏱️ <b>${token.symbol} HIT BUY ZONE</b>\n\n` +
          `💲 $${price.toFixed(8)}\n` +
          `📉 Cycle: ${cyclePos}%\n` +
          `⏳ Waiting 2 min to confirm direction...\n` +
          `(Still falling → wait more | Holds/rises → BUY)`
        );

      } else {
        const elapsed   = Date.now() - conf.firstSeenMs;
        const priceChg  = ((price - conf.priceAtFirst) / conf.priceAtFirst * 100);
        const remaining = Math.max(0, Math.ceil((BUY_CONFIRM_MS - elapsed) / 1000));

        if (momentum.direction === "down") {
          // Still falling — reset clock to wait for real bottom
          buyConfirmations[token.symbol] = { firstSeenMs: Date.now(), priceAtFirst: price };
          console.log(`  ⬇️  [${token.symbol}] Still falling — resetting 2 min clock. New low: $${price.toFixed(8)}`);

        } else if (elapsed < BUY_CONFIRM_MS) {
          // In window, not falling — counting down
          console.log(`  ⏳ [${token.symbol}] Confirming... ${remaining}s left | ${priceChg >= 0 ? "▲" : "▼"}${Math.abs(priceChg).toFixed(3)}% from first seen`);

        } else {
          // 2 min passed, not falling — BUY!
          console.log(`  🟢🟢🟢 BUYING ${token.symbol} — 2 MIN CONFIRMED AT BOTTOM! 🟢🟢🟢`);
          console.log(`      Entry: $${price.toFixed(8)} | First seen: $${conf.priceAtFirst.toFixed(8)} | ${priceChg >= 0 ? "▲" : "▼"}${Math.abs(priceChg).toFixed(3)}%`);
          delete buyConfirmations[token.symbol];
          await executeBuy(cdp, token, tradeableEth, `LOW ZONE CONFIRMED — held ${(elapsed / 60000).toFixed(1)} min`, price, hl);
        }
      }

    } else {
      // Left buy zone — clear any pending confirmation
      if (buyConfirmations[token.symbol]) {
        console.log(`  ↗️  [${token.symbol}] Left buy zone — clearing confirmation`);
        delete buyConfirmations[token.symbol];
      }
      // Initial entry if no history yet
      if ((!hl || hl.readings < 15) && balance < 1 && token.status === "active") {
        console.log(`  🟡 BUYING ${token.symbol} — initial entry`);
        await executeBuy(cdp, token, tradeableEth, `INITIAL ENTRY — building cycle data`, price, hl);
      }
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
    const bal     = await getTokenBalance(t.address);
    const usd     = (bal * price).toFixed(2);
    const hl      = getRecentHighLow(t.symbol);
    const pos     = hl ? getCyclePosition(t.symbol, price).toFixed(0) : "?";
    const entry   = t.entryPrice || price;
    const pct     = ((price - entry) / entry * 100).toFixed(1);
    const up      = parseFloat(pct) >= 0;
    const cp2     = hl ? getCyclePosition(t.symbol, price) : 50;
    const zone    = hl && cp2 >= SELL_ZONE * 100 ? "🔴 SELL ZONE"
                  : hl && cp2 <= BUY_ZONE * 100  ? "🟢 BUY ZONE" : "⬜ WATCHING";
    const lottery = Math.floor(bal * LOTTERY_PCT);

    lines +=
      `\n\n<b>${t.symbol}</b> ${zone}\n` +
      `💲 $${price.toFixed(8)} | Cycle: ${pos}%\n` +
      `🪙 ${Math.floor(bal).toLocaleString()} tokens ($${usd})\n` +
      `📊 P&L: ${up ? "+" : ""}${pct}% from entry\n` +
      `🎰 Lottery: ${lottery.toLocaleString()} tokens saved forever\n` +
      (hl ? `📉 LOW: $${hl.low.toFixed(8)}\n📈 HIGH: $${hl.high.toFixed(8)}` : `📊 Building cycle data...`);
  }

  await sendAlert(
    `📊 <b>GUARDIAN CASCADE v8.2 — 30 MIN REPORT</b>\n\n` +
    `💰 ETH: ${ethBalance.toFixed(6)} (~$${(ethBalance * ETH_USD).toFixed(2)})\n` +
    `♻️ Tradeable: ${getTradeableEth(ethBalance).toFixed(6)} ETH\n` +
    `🐷 Piggy bank: ${piggyBank.toFixed(6)} ETH ($${(piggyBank * ETH_USD).toFixed(2)})\n` +
    `🎯 Goal: TOSHI jackpot at ATH = $1,000\n` +
    `📈 Total trades: ${tradeCount}` +
    lines + `\n\n` +
    `🔗 <a href="https://basescan.org/address/${WALLET_ADDRESS}">View wallet</a>`
  );
}

// ── TELEGRAM COMMAND LISTENER ─────────────────────────────────────────────
let lastUpdateId = 0;

async function checkTelegramCommands(cdp, ethBalance) {
  try {
    const token  = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return;

    const res  = await fetch(`https://api.telegram.org/bot${token}/getUpdates?offset=${lastUpdateId + 1}&timeout=1`);
    const data = await res.json();
    if (!data.ok || !data.result?.length) return;

    for (const update of data.result) {
      lastUpdateId = update.update_id;
      const text   = update.message?.text?.toLowerCase().trim();
      if (!text || update.message?.chat?.id?.toString() !== chatId) continue;

      console.log(`📱 Telegram command: ${text}`);

      if (text === "/status" || text === "status") {
        let msg = `⚔️ <b>GUARDIAN STATUS — RIGHT NOW</b>\n\n`;
        msg += `💰 ETH: ${ethBalance.toFixed(6)} (~$${(ethBalance * ETH_USD).toFixed(2)})\n`;
        msg += `♻️ Tradeable: ${getTradeableEth(ethBalance).toFixed(6)} ETH\n`;
        msg += `🐷 Piggy bank: ${piggyBank.toFixed(6)} ETH ($${(piggyBank * ETH_USD).toFixed(2)})\n`;
        msg += `📈 Total trades: ${tradeCount}\n\n`;
        for (const t of tokens) {
          const p   = history[t.symbol]?.lastPrice;
          if (!p) continue;
          const hl  = getRecentHighLow(t.symbol);
          const cp  = hl ? getCyclePosition(t.symbol, p).toFixed(0) : "?";
          const bal = await getTokenBalance(t.address);
          const usd = (bal * p).toFixed(2);
          const cp2 = hl ? getCyclePosition(t.symbol, p) : 50;
          const zone = hl && cp2 >= SELL_ZONE * 100 ? "🔴 SELL"
                     : hl && cp2 <= BUY_ZONE * 100  ? "🟢 BUY" : "⬜ WATCH";
          const lottery = Math.floor(bal * LOTTERY_PCT);
          msg += `<b>${t.symbol}</b> ${zone} | Cycle: ${cp}%\n`;
          msg += `💲 $${p.toFixed(8)} | 🪙 ${Math.floor(bal)} ($${usd}) | 🎰 ${lottery} saved\n\n`;
        }
        await sendAlert(msg);

      } else if (text === "/eth" || text === "eth") {
        const weth = await getWethBalance();
        await sendAlert(
          `💰 <b>ETH BALANCE</b>\n\n` +
          `ETH: ${ethBalance.toFixed(6)} (~$${(ethBalance * ETH_USD).toFixed(2)})\n` +
          `WETH: ${weth.toFixed(6)} (~$${(weth * ETH_USD).toFixed(2)}) ← spendable on buys\n` +
          `Combined: ${(ethBalance + weth).toFixed(6)} ETH\n` +
          `Tradeable ETH: ${getTradeableEth(ethBalance).toFixed(6)}\n` +
          `Gas reserve: ${GAS_RESERVE} ETH locked\n` +
          `Sell reserve: ${SELL_RESERVE} ETH locked\n` +
          `🐷 Piggy: ${piggyBank.toFixed(6)} ETH\n\n` +
          `🔗 <a href="https://basescan.org/address/${WALLET_ADDRESS}">Basescan</a>`
        );

      } else if (text === "/prices" || text === "prices") {
        let msg = `💲 <b>LIVE PRICES</b>\n\n`;
        for (const t of tokens) {
          const p  = history[t.symbol]?.lastPrice;
          if (!p) { msg += `${t.symbol}: loading...\n`; continue; }
          const hl  = getRecentHighLow(t.symbol);
          const cp  = hl ? getCyclePosition(t.symbol, p).toFixed(0) : "?";
          const cp2 = hl ? getCyclePosition(t.symbol, p) : 50;
          const zone = hl && cp2 >= SELL_ZONE * 100 ? "🔴" : hl && cp2 <= BUY_ZONE * 100 ? "🟢" : "⬜";
          msg += `${zone} <b>${t.symbol}</b> $${p.toFixed(8)} | Cycle: ${cp}%\n`;
          if (hl) {
            const buyT  = hl.low + hl.range * BUY_ZONE;
            const sellT = hl.low + hl.range * SELL_ZONE;
            msg += `   Buy: $${buyT.toFixed(8)} | Sell: $${sellT.toFixed(8)}\n`;
          }
        }
        await sendAlert(msg);

      } else if (text === "/piggy" || text === "piggy") {
        const goal = 0.5;
        const pct  = ((piggyBank / goal) * 100).toFixed(1);
        const bar  = "█".repeat(Math.floor(piggyBank / goal * 10)) + "░".repeat(10 - Math.floor(piggyBank / goal * 10));
        await sendAlert(
          `🐷 <b>PIGGY BANK</b>\n\n` +
          `Saved: ${piggyBank.toFixed(6)} ETH ($${(piggyBank * ETH_USD).toFixed(2)})\n` +
          `Total skimmed: ${totalSkimmed.toFixed(6)} ETH\n` +
          `Rate: 1% of every profit\n\n` +
          `Progress to 0.5 ETH:\n[${bar}] ${pct}%\n\n` +
          `🎯 Goal: enough TOSHI at ATH = $1,000`
        );

      } else if (text === "/trades" || text === "trades") {
        await sendAlert(
          `📈 <b>TRADE STATS</b>\n\n` +
          `Total trades: ${tradeCount}\n` +
          `🐷 Total profit skimmed: ${totalSkimmed.toFixed(6)} ETH ($${(totalSkimmed * ETH_USD).toFixed(2)})`
        );

      } else if (text === "/positions" || text === "positions") {
        let msg    = `📋 <b>OPEN POSITIONS</b>\n\n`;
        let hasPos = false;
        for (const t of tokens) {
          if (!t.entryPrice) continue;
          hasPos    = true;
          const p   = history[t.symbol]?.lastPrice || t.entryPrice;
          const pnl = ((p - t.entryPrice) / t.entryPrice * 100).toFixed(2);
          const up  = parseFloat(pnl) >= 0;
          msg += `<b>${t.symbol}</b>\n`;
          msg += `📥 Entry: $${t.entryPrice.toFixed(8)}\n`;
          msg += `💲 Now:   $${p.toFixed(8)}\n`;
          msg += `${up ? "🟢" : "🔴"} P&L: ${up ? "+" : ""}${pnl}%\n`;
          msg += `💰 Invested: ${(t.totalInvested || 0).toFixed(6)} ETH\n\n`;
        }
        if (!hasPos) msg += `No open positions — watching for buy zones`;
        await sendAlert(msg);

      } else if (text === "/help" || text === "help") {
        await sendAlert(
          `⚔️ <b>GUARDIAN COMMANDS</b>\n\n` +
          `/status    — full portfolio snapshot\n` +
          `/eth       — ETH + WETH balance\n` +
          `/prices    — live prices + buy/sell targets\n` +
          `/positions — open positions + P&L\n` +
          `/piggy     — piggy bank progress\n` +
          `/trades    — trade count + stats\n` +
          `/help      — this menu\n\n` +
          `Responds within 3 seconds!`
        );
      }
    }
  } catch (e) {
    // Silent fail — never crash bot over command error
  }
}

// ── MAIN ──────────────────────────────────────────────────────────────────
async function main() {
  console.log("═══════════════════════════════════════════════════");
  console.log("⚔️   GUARDIAN CASCADE SYSTEM v8.2 — SMART BUY + LOTTERY SAVINGS");
  console.log("═══════════════════════════════════════════════════\n");

  await loadFromGitHub();

  const cdp = new CdpClient({
    apiKeyId:     process.env.CDP_API_KEY_ID,
    apiKeySecret: process.env.CDP_API_KEY_SECRET,
    walletSecret: process.env.CDP_WALLET_SECRET,
  });

  const ethBalance = await getEthBalance();
  console.log(`💰 ETH: ${ethBalance.toFixed(6)}`);
  console.log(`🪙  Tracking: ${tokens.map(t => t.symbol).join(", ")}\n`);

  await sendAlert(
    `⚔️ <b>GUARDIAN CASCADE v8.2 — STARTED</b>\n\n` +
    `👛 <code>${WALLET_ADDRESS}</code>\n` +
    `💰 ETH: ${ethBalance.toFixed(6)} (~$${(ethBalance * ETH_USD).toFixed(2)})\n` +
    `🪙 Tracking: ${tokens.map(t => t.symbol).join(", ")}\n\n` +
    `🧠 STRATEGY v8.2:\n` +
    `   📉 Buy LOW — 2 min direction confirm first\n` +
    `   📈 Sell 98% at HIGH — even if still rising\n` +
    `   🎰 2% lottery tokens kept FOREVER\n` +
    `   💛 Capital protect: sell if 1% above entry\n` +
    `   🔄 WETH spent directly on buys — no unwrap gas wasted\n` +
    `   🎯 Buy/sell targets logged every cycle\n\n` +
    `⛽ Gas reserve: ${GAS_RESERVE} ETH locked\n` +
    `🛡️ Trade must be ${FEE_SAFETY}x gas cost\n` +
    `🐷 1% of every profit → piggy bank\n` +
    `📊 Reports every 30 mins\n` +
    `💾 Saves to GitHub every 30 mins`
  );

  // Telegram polling — independent loop, responds within 3 seconds
  let cachedEth = ethBalance;
  (async function telegramLoop() {
    while (true) {
      try { await checkTelegramCommands(cdp, cachedEth); } catch (e) {}
      await new Promise(r => setTimeout(r, 3000));
    }
  })();

  // Main trading loop
  while (true) {
    try {
      const eth = await getEthBalance();
      cachedEth = eth;
      console.log(`\n${"═".repeat(50)}`);
      console.log(`${new Date().toLocaleTimeString()} | ETH: ${eth.toFixed(6)} | Trades: ${tradeCount}`);
      console.log(`Tradeable: ${getTradeableEth(eth).toFixed(6)} ETH | Piggy: ${piggyBank.toFixed(6)} ETH`);

      for (const token of tokens) {
        await processToken(cdp, token, eth);
        await new Promise(r => setTimeout(r, 4000));
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
