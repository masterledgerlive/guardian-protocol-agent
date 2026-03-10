import { CdpClient } from "@coinbase/cdp-sdk";
import { createPublicClient, http, formatEther, parseEther } from "viem";
import { base } from "viem/chains";
import dotenv from "dotenv";
dotenv.config();

const WALLET_ADDRESS = "0x50e1C4608c48b0c52E1EA5FBabc1c9126eA17915";
const WETH_ADDRESS   = "0x4200000000000000000000000000000000000006";
const SWAP_ROUTER    = "0x2626664c2603336E57B271c5C0b26F421741e481";

const INTERVAL        = 30000;
const COOLDOWN_MS     = 300000;
const SAVE_INTERVAL   = 1800000;
const REPORT_INTERVAL = 1800000;
const STOP_LOSS_MS    = 7200000;

const GAS_RESERVE     = 0.0003;
const SELL_RESERVE    = 0.001;
const MAX_BUY_PCT     = 0.15;
const MIN_ETH_TRADE   = 0.0008;
const MIN_TRADE_USD   = 1.50;
const GAS_PROFIT_MULT = 3;
const MAX_GAS_ETH     = 0.002;
const ETH_USD         = 1940;

const MIN_ENTRY_USD  = 3.00;
const BUY_ZONE       = 0.15;
const SELL_ZONE      = 0.80;
const DEEP_BUY_ZONE  = 0.07;
const HISTORY_DAYS   = 3;
const BUY_CONFIRM_MS = 120000;
const LOTTERY_PCT    = 0.02;
const SELL_ALL_PCT   = 0.98;
const ENTRY_CUSHION  = 0.01;
const STOP_LOSS_PCT  = 0.08;
const TRAILING_TICKS = 3;
const PIGGY_SKIM_PCT = 0.01;
const DEEP_BONUS     = 1.5;

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

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("TIMEOUT: " + label + " hung for " + (ms/1000) + "s — skipping"));
    }, ms);
    promise.then(
      val => { clearTimeout(timer); resolve(val); },
      err => { clearTimeout(timer); reject(err); }
    );
  });
}

function getClient() {
  return createPublicClient({ chain: base, transport: http(RPC_URLS[rpcIndex % RPC_URLS.length]) });
}
function nextRpc() { rpcIndex = (rpcIndex + 1) % RPC_URLS.length; }

async function rpcCall(fn) {
  for (let i = 0; i < RPC_URLS.length; i++) {
    try { return await fn(getClient()); }
    catch (e) {
      if (e.message?.includes("429") || e.message?.includes("rate limit") || e.message?.includes("over rate")) {
        console.log("   RPC rate limit — rotating");
        nextRpc();
        await sleep(1000);
      } else throw e;
    }
  }
  throw new Error("All RPC endpoints rate limited");
}

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

let cachedEthBalance  = 0;
let cachedWethBalance = 0;
let cachedBalances    = {};

const buyConfirmations  = {};
const sellZoneEntryTime = {};
let   manualCommands    = [];

function createCdpClient() {
  const apiKeySecret = (
    process.env.CDP_API_KEY_PRIVATE_KEY ||
    process.env.CDP_API_KEY_SECRET || ""
  ).replace(/\\n/g, "\n");
  const apiKeyId =
    process.env.CDP_API_KEY_NAME ||
    process.env.CDP_API_KEY_ID || "";
  return new CdpClient({ apiKeyId, apiKeySecret, walletSecret: process.env.CDP_WALLET_SECRET });
}

async function githubGet(path) {
  try {
    const res = await fetch(
      "https://api.github.com/repos/" + GITHUB_REPO + "/contents/" + path + "?ref=" + GITHUB_BRANCH + "&t=" + Date.now(),
      { headers: { Authorization: "token " + GITHUB_TOKEN, Accept: "application/vnd.github.v3+json" } }
    );
    if (!res.ok) return null;
    const data    = await res.json();
    const content = Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf8");
    return { content: JSON.parse(content), sha: data.sha };
  } catch (e) { console.log("GitHub read error (" + path + "): " + e.message); return null; }
}

async function githubSave(path, content, sha) {
  try {
    const body = {
      message: "Guardian update " + new Date().toISOString(),
      content: Buffer.from(JSON.stringify(content, null, 2)).toString("base64"),
      branch:  GITHUB_BRANCH,
    };
    if (sha) body.sha = sha;
    const res = await fetch(
      "https://api.github.com/repos/" + GITHUB_REPO + "/contents/" + path,
      { method: "PUT",
        headers: { Authorization: "token " + GITHUB_TOKEN, "Content-Type": "application/json" },
        body: JSON.stringify(body) }
    );
    return (await res.json())?.content?.sha || null;
  } catch (e) { console.log("GitHub save error (" + path + "): " + e.message); return null; }
}

async function loadFromGitHub() {
  console.log("Loading from GitHub...");
  const tf = await githubGet("tokens.json");
  if (tf?.content?.tokens?.length) {
    const saved = tf.content.tokens;
    tokens    = DEFAULT_TOKENS.map(def => ({ ...def, ...(saved.find(s => s.symbol === def.symbol) || {}) }));
    tokensSha = tf.sha;
  } else {
    tokens = DEFAULT_TOKENS.map(t => ({ ...t }));
  }
  for (const t of tokens) t.lotteryTickets = 0;
  console.log("Tokens: " + tokens.map(t => t.symbol).join(", "));

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
    console.log("Positions restored: " + (restored || "none"));
    console.log("Piggy: " + piggyBank.toFixed(6) + " ETH | Trades: " + tradeCount);
  } else {
    console.log("No saved positions — fresh start");
  }
}

async function saveToGitHub() {
  try {
    console.log("Saving to GitHub...");
    tokensSha    = await githubSave("tokens.json",  { tokens, lastSaved: new Date().toISOString() }, tokensSha);
    historySha   = await githubSave("history.json", history, historySha);
    positionsSha = await githubSave("positions.json", {
      lastSaved: new Date().toISOString(), piggyBank, totalSkimmed, tradeCount,
      entries:    Object.fromEntries(tokens.map(t => [t.symbol, t.entryPrice    || null])),
      invested:   Object.fromEntries(tokens.map(t => [t.symbol, t.totalInvested || 0])),
      entryTimes: Object.fromEntries(tokens.map(t => [t.symbol, t.entryTime     || null])),
    }, positionsSha);
    lastSaveTime = Date.now();
    console.log("Saved to GitHub");
  } catch (e) { console.log("Save error: " + e.message); }
}

async function sendAlert(msg) {
  try {
    const tok = process.env.TELEGRAM_BOT_TOKEN;
    const cid = process.env.TELEGRAM_CHAT_ID;
    if (!tok || !cid) return;
    await fetch("https://api.telegram.org/bot" + tok + "/sendMessage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: cid, text: msg }),
    });
  } catch (e) { console.log("Telegram error:", e.message); }
}

async function getTokenPrice(address) {
  try {
    const res  = await fetch("https://api.geckoterminal.com/api/v2/simple/networks/base/token_price/" + address.toLowerCase());
    const data = await res.json();
    const p    = parseFloat(data?.data?.attributes?.token_prices?.[address.toLowerCase()]);
    if (!isNaN(p) && p > 0) return p;
  } catch {}
  try {
    const res2  = await fetch("https://api.dexscreener.com/latest/dex/tokens/" + address);
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

function getRecentHighLow(symbol) {
  const h = history[symbol];
  if (!h?.readings?.length) return null;
  const cutoff = Date.now() - (HISTORY_DAYS * 86400000);
  const recent = h.readings.filter(r => r.time > cutoff);
  const data   = recent.length >= 10 ? recent : h.readings.slice(-200);
  if (data.length < 3) return null;
  const prices = data.map(r => r.price);
  return {
    high: Math.max(...prices), low: Math.min(...prices),
    range: Math.max(...prices) - Math.min(...prices),
    readings: data.length
  };
}

function getCyclePosition(symbol, price) {
  const hl = getRecentHighLow(symbol);
  if (!hl || hl.range === 0) return 50;
  return ((price - hl.low) / hl.range) * 100;
}

function recordPrice(symbol, price) {
  if (!history[symbol]) history[symbol] = { readings: [], lastPrice: null };
  history[symbol].readings.push({ price, time: Date.now() });
  if (history[symbol].readings.length > 5000) history[symbol].readings.shift();
  history[symbol].lastPrice = price;
}

function getMomentum(symbol) {
  const s = priceStreams[symbol] || [];
  if (s.length < 6) return { direction: "neutral", speed: 0 };
  const recent = s.slice(-6);
  const moves  = [];
  for (let i = 1; i < recent.length; i++)
    moves.push((recent[i].price - recent[i-1].price) / recent[i-1].price);
  const avg = moves.reduce((a, b) => a + b, 0) / moves.length;
  return { direction: avg > 0.0002 ? "up" : avg < -0.0002 ? "down" : "neutral", speed: Math.abs(avg) };
}

function canTrade(symbol) {
  const elapsed = Date.now() - (lastTradeTime[symbol] || 0);
  if (elapsed < COOLDOWN_MS) {
    console.log("   Cooldown " + symbol + ": " + Math.ceil((COOLDOWN_MS - elapsed) / 1000) + "s");
    return false;
  }
  return true;
}

async function findCascadeTarget(excludeSymbol) {
  let bestToken   = null;
  let lowestCycle = 100;
  for (const t of tokens) {
    if (t.symbol === excludeSymbol) continue;
    if (t.status !== "active") continue;
    if (!canTrade(t.symbol)) continue;
    const price = history[t.symbol]?.lastPrice;
    if (!price) continue;
    const hl = getRecentHighLow(t.symbol);
    if (!hl) continue;
    const cycle = getCyclePosition(t.symbol, price);
    if (cycle >= 50) continue; // never cascade into tokens above 50% cycle
    const hasPosition = t.entryPrice !== null;
    const adjusted    = hasPosition ? cycle + 20 : cycle;
    if (adjusted < lowestCycle) { lowestCycle = adjusted; bestToken = t; }
  }
  return bestToken;
}

async function isTradeProfitable(ethAmount, isSell = false, entryEth = 0) {
  const gasCost    = await estimateGasCostEth();
  const tradeValue = ethAmount * ETH_USD;
  const gasCostUsd = gasCost  * ETH_USD;
  if (gasCost > MAX_GAS_ETH) { console.log("   GAS SPIKE: " + gasCost.toFixed(6) + " — skipping"); return false; }
  if (tradeValue < MIN_TRADE_USD) { console.log("   Too small ($" + tradeValue.toFixed(3) + ")"); return false; }
  if (isSell && entryEth > 0) {
    const minProceedsEth = entryEth + (gasCost * GAS_PROFIT_MULT);
    if (ethAmount < minProceedsEth) { console.log("   Sell gate: below entry+fees"); return false; }
  } else if (tradeValue < gasCostUsd * GAS_PROFIT_MULT) {
    console.log("   Gas eats profit — skipping"); return false;
  }
  return true;
}

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
  if (approvedTokens.has(key)) { console.log("      Approved (cached)"); return; }
  const allowance = await rpcCall(c => c.readContract({
    address: tokenAddress, abi: ERC20_ABI,
    functionName: "allowance", args: [WALLET_ADDRESS, SWAP_ROUTER],
  }));
  if (allowance >= amountIn) { approvedTokens.add(key); console.log("      Already approved"); return; }
  console.log("      Approving (one time only)...");
  await withTimeout(cdp.evm.sendTransaction({
    address: WALLET_ADDRESS, network: "base",
    transaction: { to: tokenAddress, data: encodeApprove(SWAP_ROUTER, MAX_UINT256) },
  }), 60000, "approve");
  approvedTokens.add(key);
  await sleep(8000);
  console.log("      Approved and cached");
}

async function executeBuy(cdp, token, tradeableEth, reason, price, hl, forcedEth = 0) {
  try {
    if (!canTrade(token.symbol)) return false;
    const wethBal    = await getWethBalance();
    const totalAvail = tradeableEth + wethBal;
    if (totalAvail < MIN_ETH_TRADE) { console.log("   ETH+WETH too low"); return false; }

    const minEntryEth = MIN_ENTRY_USD / ETH_USD;
    const cyclePos    = hl ? getCyclePosition(token.symbol, price) : 50;
    const deepBonus   = (hl && cyclePos <= DEEP_BUY_ZONE * 100) ? DEEP_BONUS : 1.0;
    const maxPerBuy   = totalAvail * MAX_BUY_PCT * deepBonus;

    let ethToSpend;
    if (forcedEth > 0) {
      ethToSpend = Math.min(forcedEth, maxPerBuy);
    } else {
      ethToSpend = Math.max(minEntryEth, totalAvail * 0.05);
      ethToSpend = Math.min(ethToSpend, maxPerBuy);
    }

    console.log("      Budget: " + ethToSpend.toFixed(6) + " ETH (~$" + (ethToSpend * ETH_USD).toFixed(2) + ")" + (deepBonus > 1 ? " (DEEP x1.5)" : ""));
    if (!await isTradeProfitable(ethToSpend)) return false;

    const amountIn = parseEther(ethToSpend.toFixed(18));
    const useWeth  = wethBal >= ethToSpend;

    console.log("   BUY " + token.symbol + " — " + reason);
    console.log("      " + ethToSpend.toFixed(6) + " " + (useWeth ? "WETH" : "ETH") + " @ $" + price.toFixed(8));
    if (hl) console.log("      LOW: $" + hl.low.toFixed(8) + " | HIGH: $" + hl.high.toFixed(8));

    let txHash;
    if (useWeth) {
      await ensureApproved(cdp, WETH_ADDRESS, amountIn);
      const { transactionHash } = await withTimeout(cdp.evm.sendTransaction({
        address: WALLET_ADDRESS, network: "base",
        transaction: {
          to: SWAP_ROUTER,
          data: encodeSwap(WETH_ADDRESS, token.address, amountIn, WALLET_ADDRESS, token.feeTier),
        },
      }), 60000, "buy-weth");
      txHash = transactionHash;
    } else {
      const { transactionHash } = await withTimeout(cdp.evm.sendTransaction({
        address: WALLET_ADDRESS, network: "base",
        transaction: {
          to: SWAP_ROUTER, value: amountIn,
          data: encodeSwap(WETH_ADDRESS, token.address, amountIn, WALLET_ADDRESS, token.feeTier),
        },
      }), 60000, "buy-eth");
      txHash = transactionHash;
    }

    lastTradeTime[token.symbol] = Date.now();
    tradeCount++;
    token.entryPrice    = price;
    token.totalInvested = (token.totalInvested || 0) + ethToSpend;
    token.entryTime     = Date.now();
    delete sellZoneEntryTime[token.symbol];

    console.log("      https://basescan.org/tx/" + txHash);
    const sellTarget = hl ? (hl.low + hl.range * SELL_ZONE) : null;
    await sendAlert(
      "BOUGHT " + token.symbol + "!

" +
      "Spent: " + ethToSpend.toFixed(6) + " " + (useWeth ? "WETH" : "ETH") + " (~$" + (ethToSpend * ETH_USD).toFixed(2) + ")
" +
      "Entry: $" + price.toFixed(8) + "
" +
      "Cycle LOW:  $" + (hl?.low.toFixed(8) || "learning") + "
" +
      "Cycle HIGH: $" + (hl?.high.toFixed(8) || "learning") + "
" +
      (sellTarget ? "Sell target: $" + sellTarget.toFixed(8) + " (+" + (((sellTarget - price) / price) * 100).toFixed(1) + "%)
" : "") +
      "Reason: " + reason + "
" +
      (deepBonus > 1 ? "DEEP ZONE — 50% bigger position!
" : "") +
      "https://basescan.org/tx/" + txHash
    );
    return ethToSpend;
  } catch (e) {
    console.log("      BUY FAILED: " + e.message);
    await sendAlert("BUY FAILED " + token.symbol + "
" + e.message);
    return false;
  }
}

async function executeSell(cdp, token, sellPct, reason, price, hl) {
  try {
    if (!canTrade(token.symbol)) return null;
    const totalBal    = await getTokenBalance(token.address);
    const lotteryHold = Math.max(Math.floor(totalBal * LOTTERY_PCT), 1);
    const sellable    = Math.max(totalBal - lotteryHold, 0);
    if (sellable < 1) { console.log("   Nothing to sell (" + lotteryHold + " held as lottery)"); return null; }

    const isProtect = reason.includes("CAPITAL PROTECT") || reason.includes("STOP LOSS") || reason.includes("MANUAL");
    if (token.entryPrice && price < token.entryPrice && !isProtect) {
      console.log("   " + token.symbol + " below entry — holding");
      return null;
    }

    const amountToSell        = BigInt(Math.floor(sellable * sellPct * 1e18));
    if (amountToSell === BigInt(0)) return null;
    const expectedProceedsEth = (sellable * sellPct * price) / ETH_USD;
    const entryEth            = isProtect ? 0 : (token.totalInvested * sellPct || 0);
    if (!await isTradeProfitable(expectedProceedsEth, !isProtect, entryEth)) return null;

    console.log("   SELL " + token.symbol + " — " + reason);
    console.log("      " + (sellPct * 100).toFixed(0) + "% of " + sellable.toFixed(0) + " tokens @ $" + price.toFixed(8));
    console.log("      Keeping " + lotteryHold + " " + token.symbol + " forever (lottery)");

    await ensureApproved(cdp, token.address, amountToSell);

    const wethBefore = await getWethBalance();
    const ethBefore  = await getEthBalance();

    const { transactionHash } = await withTimeout(cdp.evm.sendTransaction({
      address: WALLET_ADDRESS, network: "base",
      transaction: {
        to: SWAP_ROUTER,
        data: encodeSwap(token.address, WETH_ADDRESS, amountToSell, WALLET_ADDRESS, token.feeTier),
      },
    }), 60000, "sell");

    lastTradeTime[token.symbol] = Date.now();
    tradeCount++;
    await sleep(8000);

    const wethAfter  = await getWethBalance();
    const ethAfter   = await getEthBalance();
    const profit     = (wethAfter - wethBefore) + (ethAfter - ethBefore);
    const profitUsd  = (profit * ETH_USD).toFixed(2);
    const entryUsd   = ((token.totalInvested || 0) * ETH_USD).toFixed(2);

    let skim = 0;
    if (profit > 0) {
      skim          = profit * PIGGY_SKIM_PCT;
      piggyBank    += skim;
      totalSkimmed += skim;
      console.log("      Piggy skim: " + skim.toFixed(6) + " ETH");
    }

    if (sellPct >= SELL_ALL_PCT) { token.entryPrice = null; token.entryTime = null; token.totalInvested = 0; }
    delete sellZoneEntryTime[token.symbol];

    const proceedsAfterSkim = Math.max(profit - skim, 0);
    console.log("      https://basescan.org/tx/" + transactionHash);
    console.log("      Received: " + profit.toFixed(6) + " ETH ($" + profitUsd + ")");

    const netUsd = (parseFloat(profitUsd) - parseFloat(entryUsd)).toFixed(2);
    await sendAlert(
      "SOLD " + token.symbol + "!

" +
      "Received: " + profit.toFixed(6) + " ETH (~$" + profitUsd + ")
" +
      "Invested: ~$" + entryUsd + "
" +
      "Net: " + (parseFloat(netUsd) >= 0 ? "+" : "") + "$" + netUsd + "
" +
      "Exit: $" + price.toFixed(8) + "
" +
      "Lottery: keeping " + lotteryHold + " " + token.symbol + " forever
" +
      "Piggy skim: " + skim.toFixed(6) + " ETH | Total: " + piggyBank.toFixed(6) + " ETH
" +
      "Reason: " + reason + "
" +
      "https://basescan.org/tx/" + transactionHash
    );
    return proceedsAfterSkim;
  } catch (e) {
    console.log("      SELL FAILED: " + e.message);
    await sendAlert("SELL FAILED " + token.symbol + "
" + e.message);
    return null;
  }
}

async function triggerCascade(cdp, soldSymbol, proceeds, ethBalance) {
  try {
    console.log("   CASCADE — " + proceeds.toFixed(6) + " ETH from " + soldSymbol);
    const target = await findCascadeTarget(soldSymbol);
    if (!target) { console.log("   No cascade target below 50% — proceeds stay as WETH"); return; }
    const price    = history[target.symbol]?.lastPrice;
    if (!price) return;
    const hl       = getRecentHighLow(target.symbol);
    const cycle    = hl ? getCyclePosition(target.symbol, price) : 50;
    const tradeEth = getTradeableEth(ethBalance);
    console.log("   Cascading into " + target.symbol + " — cycle " + cycle.toFixed(0) + "%");
    await sendAlert(
      "CASCADE: " + soldSymbol + " -> " + target.symbol + "

" +
      "Routing: " + proceeds.toFixed(6) + " ETH
" +
      target.symbol + " cycle: " + cycle.toFixed(0) + "%
" +
      (hl ? "LOW: $" + hl.low.toFixed(8) + " | HIGH: $" + hl.high.toFixed(8) + "
" : "") +
      "Buying now..."
    );
    await executeBuy(cdp, target, tradeEth, "CASCADE from " + soldSymbol + " (cycle " + cycle.toFixed(0) + "%)", price, hl, proceeds * 0.95);
  } catch (e) { console.log("   Cascade error: " + e.message); }
}

async function checkTelegramCommands(cdp, ethBalance) {
  try {
    const tok = process.env.TELEGRAM_BOT_TOKEN;
    const cid = process.env.TELEGRAM_CHAT_ID;
    if (!tok || !cid) return;

    const res  = await fetch("https://api.telegram.org/bot" + tok + "/getUpdates?offset=" + (lastUpdateId + 1) + "&timeout=1");
    const data = await res.json();
    if (!data.ok || !data.result?.length) return;

    for (const update of data.result) {
      lastUpdateId = update.update_id;
      const raw    = update.message?.text?.trim() || "";
      const text   = raw.toLowerCase();
      if (!raw || update.message?.chat?.id?.toString() !== cid) continue;
      console.log("Telegram: " + raw);

      try {
        if (text.startsWith("/buy ")) {
          const sym = raw.split(" ")[1]?.toUpperCase();
          if (!tokens.find(t => t.symbol === sym)) { await sendAlert("Unknown: " + sym); continue; }
          manualCommands.push({ symbol: sym, action: "buy" });
          await sendAlert("BUY " + sym + " queued — fires within 30s");

        } else if (text.startsWith("/sellhalf ")) {
          const sym = raw.split(" ")[1]?.toUpperCase();
          if (!tokens.find(t => t.symbol === sym)) { await sendAlert("Unknown: " + sym); continue; }
          manualCommands.push({ symbol: sym, action: "sellhalf" });
          await sendAlert("SELL HALF " + sym + " queued — fires within 30s");

        } else if (text.startsWith("/sell ")) {
          const sym = raw.split(" ")[1]?.toUpperCase();
          if (!tokens.find(t => t.symbol === sym)) { await sendAlert("Unknown: " + sym); continue; }
          manualCommands.push({ symbol: sym, action: "sell" });
          await sendAlert("SELL " + sym + " queued — fires within 30s");

        } else if (text === "/eth" || text === "eth") {
          const e2 = cachedEthBalance;
          const w2 = cachedWethBalance;
          await sendAlert(
            "BALANCES

" +
            "ETH:      " + e2.toFixed(6) + " (~$" + (e2 * ETH_USD).toFixed(2) + ")
" +
            "WETH:     " + w2.toFixed(6) + " (~$" + (w2 * ETH_USD).toFixed(2) + ") - bot buys with this
" +
            "Combined: " + (e2 + w2).toFixed(6) + " ETH (~$" + ((e2 + w2) * ETH_USD).toFixed(2) + ")
" +
            "Tradeable: " + getTradeableEth(e2).toFixed(6) + " ETH
" +
            "Piggy (LOCKED): " + piggyBank.toFixed(6) + " ETH ($" + (piggyBank * ETH_USD).toFixed(2) + ")

" +
            "https://basescan.org/address/" + WALLET_ADDRESS
          );

        } else if (text === "/prices" || text === "prices") {
          let msg = "LIVE PRICES + ZONES
" + new Date().toLocaleTimeString() + "

";
          for (const t of tokens) {
            const p = history[t.symbol]?.lastPrice;
            if (!p) { msg += t.symbol + ": loading

"; continue; }
            const hl    = getRecentHighLow(t.symbol);
            const cp    = hl ? getCyclePosition(t.symbol, p) : null;
            const sellT = hl ? hl.low + hl.range * SELL_ZONE : null;
            const buyT  = hl ? hl.low + hl.range * BUY_ZONE  : null;
            const zone  = !hl ? "[?]" : cp >= SELL_ZONE*100 ? "[SELL]" : cp <= BUY_ZONE*100 ? "[BUY]" : "[---]";
            msg += zone + " " + t.symbol + " $" + p.toFixed(8) + " " + (cp !== null ? cp.toFixed(0) : "?") + "%
";
            if (hl && cp !== null) {
              const toSell = cp >= SELL_ZONE*100 ? "IN SELL ZONE" : "+" + ((sellT - p)/p*100).toFixed(1) + "% to sell";
              const toBuy  = cp <= BUY_ZONE*100  ? "IN BUY ZONE"  : "-" + ((p - buyT)/p*100).toFixed(1) + "% to buy";
              msg += "  Sell: " + toSell + " | Buy: " + toBuy + "

";
            } else { msg += "  Building history...

"; }
          }
          await sendAlert(msg);

        } else if (text === "/positions" || text === "positions") {
          let msg = "OPEN POSITIONS
" + new Date().toLocaleTimeString() + "

";
          let any = false;
          for (const t of tokens) {
            if (!t.entryPrice) continue;
            any = true;
            const p        = history[t.symbol]?.lastPrice || t.entryPrice;
            const hl       = getRecentHighLow(t.symbol);
            const bal      = cachedBalances[t.symbol] || 0;
            const lottery  = Math.floor(bal * LOTTERY_PCT);
            const sellable = Math.max(bal - lottery, 0);
            const pnlPct   = ((p - t.entryPrice) / t.entryPrice * 100).toFixed(2);
            const invested = (t.totalInvested * ETH_USD).toFixed(2);
            const sellNow  = (sellable * p).toFixed(2);
            const age      = t.entryTime ? Math.floor((Date.now() - t.entryTime) / 60000) : "?";
            const cp       = hl ? getCyclePosition(t.symbol, p) : null;
            const sellT    = hl ? hl.low + hl.range * SELL_ZONE : null;
            msg += (parseFloat(pnlPct) >= 0 ? "[PROFIT]" : "[LOSS]") + " " + t.symbol + "
";
            msg += "  Entry:    $" + t.entryPrice.toFixed(8) + " (" + age + "m ago)
";
            msg += "  Now:      $" + p.toFixed(8) + "
";
            msg += "  P&L:      " + (parseFloat(pnlPct) >= 0 ? "+" : "") + pnlPct + "%
";
            msg += "  Invested: ~$" + invested + " | Sell now: ~$" + sellNow + "
";
            if (cp !== null) msg += "  Cycle: " + cp.toFixed(0) + "%" + (sellT ? " | To sell: +" + ((sellT-p)/p*100).toFixed(1) + "%" : "") + "
";
            msg += "  Tokens: " + Math.floor(bal) + " | Lottery: " + lottery + "

";
          }
          if (!any) msg += "No open positions yet.";
          await sendAlert(msg);

        } else if (text === "/status" || text === "status") {
          const e2 = cachedEthBalance;
          const w2 = cachedWethBalance;
          let msg = "GUARDIAN v10.1 STATUS
" + new Date().toLocaleTimeString() + "

";
          msg += "ETH: " + e2.toFixed(6) + " (~$" + (e2 * ETH_USD).toFixed(2) + ")
";
          msg += "WETH: " + w2.toFixed(6) + " (~$" + (w2 * ETH_USD).toFixed(2) + ")
";
          msg += "Tradeable: " + getTradeableEth(e2).toFixed(6) + " ETH
";
          msg += "Piggy: " + piggyBank.toFixed(6) + " ETH (LOCKED)
";
          msg += "Trades: " + tradeCount + "
";
          msg += "-------------------------
";
          for (const t of tokens) {
            const p = history[t.symbol]?.lastPrice;
            if (!p) { msg += t.symbol + ": loading
"; continue; }
            const hl   = getRecentHighLow(t.symbol);
            const cp   = hl ? getCyclePosition(t.symbol, p) : null;
            const bal  = cachedBalances[t.symbol] || 0;
            const lot  = Math.floor(bal * LOTTERY_PCT);
            const sell = Math.max(bal - lot, 0);
            const sellNow = (sell * p).toFixed(2);
            const zone = !hl ? "[?]" : cp >= SELL_ZONE*100 ? "[SELL]" : cp <= BUY_ZONE*100 ? "[BUY]" : "[---]";
            const sellT = hl ? hl.low + hl.range * SELL_ZONE : null;
            msg += zone + " " + t.symbol + " $" + p.toFixed(8) + " " + (cp !== null ? cp.toFixed(0) : "?") + "%
";
            if (t.entryPrice) {
              const pnl = ((p - t.entryPrice) / t.entryPrice * 100).toFixed(2);
              msg += "  P&L: " + (parseFloat(pnl)>=0?"+":"") + pnl + "% | Now: ~$" + sellNow + (sellT ? " | +" + ((sellT-p)/p*100).toFixed(1) + "% to sell" : "") + "
";
            } else {
              msg += "  No position | Dust: ~$" + sellNow + "
";
            }
          }
          msg += "
https://basescan.org/address/" + WALLET_ADDRESS;
          await sendAlert(msg);

        } else if (text === "/piggy" || text === "piggy") {
          const pct    = Math.min((piggyBank / 0.5) * 100, 100);
          const filled = Math.floor(pct / 10);
          const bar    = "#".repeat(filled) + ".".repeat(10 - filled);
          await sendAlert(
            "PIGGY BANK -- LOCKED FOREVER

" +
            "Saved: " + piggyBank.toFixed(6) + " ETH ($" + (piggyBank * ETH_USD).toFixed(2) + ")
" +
            "Total skimmed: " + totalSkimmed.toFixed(6) + " ETH
" +
            "[" + bar + "] " + pct.toFixed(1) + "% to 0.5 ETH goal

" +
            "1% from every profitable sell
Never touched -- compounds forever"
          );

        } else if (text === "/trades" || text === "trades") {
          await sendAlert(
            "TRADE STATS

" +
            "Total trades: " + tradeCount + "
" +
            "Profit skimmed: " + totalSkimmed.toFixed(6) + " ETH ($" + (totalSkimmed * ETH_USD).toFixed(2) + ")
" +
            "Piggy balance: " + piggyBank.toFixed(6) + " ETH"
          );

        } else if (text === "/cascade" || text === "cascade") {
          let msg = "CASCADE ORDER (bottom to top)
" + new Date().toLocaleTimeString() + "

";
          const sorted = [...tokens]
            .filter(t => history[t.symbol]?.lastPrice)
            .map(t => {
              const p  = history[t.symbol].lastPrice;
              const hl = getRecentHighLow(t.symbol);
              const cp = hl ? getCyclePosition(t.symbol, p) : 50;
              return { ...t, price: p, cycle: cp };
            })
            .sort((a, b) => a.cycle - b.cycle);
          for (const t of sorted) {
            const zone = t.cycle >= SELL_ZONE*100 ? "[TOP]" : t.cycle <= BUY_ZONE*100 ? "[BOT]" : "[---]";
            const pos  = t.entryPrice ? "*" : " ";
            msg += zone + pos + " " + t.symbol + " " + t.cycle.toFixed(0) + "% $" + t.price.toFixed(8) + "
";
          }
          msg += "
* = open position";
          await sendAlert(msg);

        } else if (text === "/help" || text === "help") {
          await sendAlert(
            "GUARDIAN v10.1 COMMANDS

" +
            "INFO:
" +
            "/status   -- full snapshot
" +
            "/eth      -- balances
" +
            "/prices   -- prices + % to zones
" +
            "/positions -- P&L + sell-now value
" +
            "/cascade  -- cascade order
" +
            "/piggy    -- piggy bank
" +
            "/trades   -- stats

" +
            "TRADING:
" +
            "/buy SYMBOL      -- force buy
" +
            "/sell SYMBOL     -- force sell + cascade
" +
            "/sellhalf SYMBOL -- sell half

" +
            "Examples:
" +
            "/buy AERO
" +
            "/sell VIRTUAL
" +
            "/sellhalf BRETT"
          );
        }

      } catch (cmdErr) {
        console.log("Command error: " + cmdErr.message);
        await sendAlert("Command error: " + cmdErr.message);
      }
    }
  } catch (e) { /* silent */ }
}

let lastUpdateId = 0;

async function processToken(cdp, token, ethBalance) {
  try {
    const price = await getTokenPrice(token.address);
    if (!price) { console.log("   " + token.symbol + ": no price"); return; }

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
    const entry        = token.entryPrice;
    const lotteryHold  = Math.floor(balance * LOTTERY_PCT);
    const inBuyZone    = hl && cycleNum <= BUY_ZONE  * 100;
    const inDeepBuy    = hl && cycleNum <= DEEP_BUY_ZONE * 100;
    const inSellZone   = hl && cycleNum >= SELL_ZONE * 100;
    const isBreakout   = hl && price >= hl.high * 1.03;
    const wethBal      = await getWethBalance();
    const totalAvail   = tradeableEth + wethBal;

    const zoneStr = !hl ? "Learning" : isBreakout ? "BREAKOUT!" :
      inSellZone ? "SELL " + cycleNum.toFixed(0) + "%" :
      inBuyZone  ? "BUY " + cycleNum.toFixed(0) + "%" + (inDeepBuy ? " DEEP" : "") :
      cycleNum.toFixed(0) + "%";

    const pnlStr = entry ? " P&L: " + ((price - entry) / entry * 100).toFixed(1) + "%" : "";
    console.log("  [" + token.symbol + "] " + zoneStr + " $" + price.toFixed(8) + pnlStr);
    console.log("   " + balance.toFixed(0) + " tokens ($" + valueUsd + ") momentum:" + momentum.direction + " lottery:" + lotteryHold);
    if (hl) {
      const toSell = inSellZone ? "IN ZONE" : "+" + ((hl.low + hl.range * SELL_ZONE - price) / price * 100).toFixed(1) + "% to sell";
      console.log("   LOW $" + hl.low.toFixed(8) + " HIGH $" + hl.high.toFixed(8) + " | " + toSell);
    }

    // Manual commands first
    const mi = manualCommands.findIndex(c => c.symbol === token.symbol);
    if (mi !== -1) {
      const cmd = manualCommands.splice(mi, 1)[0];
      if (cmd.action === "buy") {
        await executeBuy(cdp, token, tradeableEth, "MANUAL BUY", price, hl);
      } else if (cmd.action === "sell") {
        const proceeds = await executeSell(cdp, token, SELL_ALL_PCT, "MANUAL SELL", price, hl);
        if (proceeds > 0) await triggerCascade(cdp, token.symbol, proceeds, ethBalance);
      } else if (cmd.action === "sellhalf") {
        await executeSell(cdp, token, 0.5, "MANUAL SELL HALF", price, hl);
      }
      return;
    }

    const sellable    = Math.max(balance - lotteryHold, 0);
    const sellableUsd = sellable * price;
    const hasMeaningfulPosition = token.entryPrice !== null || sellableUsd >= MIN_TRADE_USD;

    // SELL LOGIC
    if (sellable > 1 && hasMeaningfulPosition) {

      // Stop loss
      if (entry && token.entryTime && price < entry * (1 - STOP_LOSS_PCT) && (Date.now() - token.entryTime) > STOP_LOSS_MS) {
        console.log("   STOP LOSS " + token.symbol);
        const proceeds = await executeSell(cdp, token, SELL_ALL_PCT, "STOP LOSS " + ((price - entry) / entry * 100).toFixed(1) + "%", price, hl);
        if (proceeds > 0) await triggerCascade(cdp, token.symbol, proceeds, ethBalance);
        return;
      }

      // Capital protect — only if not approaching sell zone naturally (cycle < 65%)
      const cycleOk = !hl || cycleNum < 65;
      if (entry && !inSellZone && !isBreakout && cycleOk && price >= entry * (1 + ENTRY_CUSHION)) {
        console.log("   CAPITAL PROTECT " + token.symbol);
        const proceeds = await executeSell(cdp, token, SELL_ALL_PCT, "CAPITAL PROTECT +1% above entry", price, hl);
        if (proceeds > 0) await triggerCascade(cdp, token.symbol, proceeds, ethBalance);
        return;
      }

      // Breakout
      if (isBreakout) {
        console.log("   BREAKOUT " + token.symbol);
        delete sellZoneEntryTime[token.symbol];
        const proceeds = await executeSell(cdp, token, SELL_ALL_PCT * 0.5, "BREAKOUT +" + (((price / hl.high) - 1) * 100).toFixed(1) + "% above HIGH", price, hl);
        if (proceeds > 0) await triggerCascade(cdp, token.symbol, proceeds, ethBalance);

      // Normal sell zone
      } else if (inSellZone) {
        if (!sellZoneEntryTime[token.symbol]) sellZoneEntryTime[token.symbol] = { firstMs: Date.now(), tick: 0 };
        sellZoneEntryTime[token.symbol].tick++;
        const ticks  = sellZoneEntryTime[token.symbol].tick;
        const rising = momentum.direction === "up";
        if (rising && ticks <= TRAILING_TICKS) {
          console.log("   " + token.symbol + " trailing (" + ticks + "/" + TRAILING_TICKS + ") — still rising");
        } else {
          delete sellZoneEntryTime[token.symbol];
          const proceeds = await executeSell(cdp, token, SELL_ALL_PCT, "AT HIGH ZONE — " + (rising ? "max trailing" : "momentum fading"), price, hl);
          if (proceeds > 0) await triggerCascade(cdp, token.symbol, proceeds, ethBalance);
        }
      } else {
        if (sellZoneEntryTime[token.symbol]) delete sellZoneEntryTime[token.symbol];
      }

    // BUY LOGIC
    } else if (totalAvail >= MIN_ETH_TRADE) {

      if (inBuyZone) {
        const conf = buyConfirmations[token.symbol];
        if (!conf) {
          buyConfirmations[token.symbol] = { firstSeenMs: Date.now(), priceAtFirst: price };
          console.log("   " + token.symbol + " HIT BUY ZONE — 2 min clock started");
          await sendAlert(
            token.symbol + " HIT BUY ZONE" + (inDeepBuy ? " -- DEEP!" : "") + "

" +
            "$" + price.toFixed(8) + " | Cycle: " + cycleNum.toFixed(0) + "%
" +
            "Confirming bottom — 2 min wait
" +
            "Still falling = resets | Holds/rises = BUY"
          );
        } else {
          const elapsed   = Date.now() - conf.firstSeenMs;
          const remaining = Math.max(0, Math.ceil((BUY_CONFIRM_MS - elapsed) / 1000));
          if (momentum.direction === "down") {
            buyConfirmations[token.symbol] = { firstSeenMs: Date.now(), priceAtFirst: price };
            console.log("   " + token.symbol + " still falling — clock reset");
          } else if (elapsed < BUY_CONFIRM_MS) {
            console.log("   " + token.symbol + " confirming... " + remaining + "s left");
          } else {
            console.log("   " + token.symbol + " CONFIRMED — buying!");
            delete buyConfirmations[token.symbol];
            await executeBuy(cdp, token, tradeableEth, "LOW ZONE CONFIRMED" + (inDeepBuy ? " DEEP" : "") + " (" + (elapsed / 60000).toFixed(1) + " min)", price, hl);
          }
        }
      } else {
        if (buyConfirmations[token.symbol]) {
          console.log("   " + token.symbol + " left buy zone — clearing");
          delete buyConfirmations[token.symbol];
        }
        // Seed $3 if no position
        if (!token.entryPrice && token.status === "active") {
          const minEntryEth = MIN_ENTRY_USD / ETH_USD;
          if (totalAvail >= minEntryEth) {
            console.log("   " + token.symbol + " $" + MIN_ENTRY_USD + " SEED ENTRY");
            await executeBuy(cdp, token, tradeableEth, "$" + MIN_ENTRY_USD + " seed — initial position", price, hl);
          } else {
            console.log("   " + token.symbol + " needs seed — only $" + (totalAvail * ETH_USD).toFixed(2) + " available");
          }
        }
      }
    }

  } catch (e) {
    console.log("   processToken error (" + token.symbol + "): " + e.message);
  }
}

async function main() {
  console.log("GUARDIAN CASCADE SYSTEM v10.1 — STARTING");

  await loadFromGitHub();
  cdpClient = createCdpClient();
  console.log("CDP client ready");

  const ethBalance = await getEthBalance();
  const wethBal    = await getWethBalance();
  cachedEthBalance  = ethBalance;
  cachedWethBalance = wethBal;
  console.log("ETH: " + ethBalance.toFixed(6) + " | WETH: " + wethBal.toFixed(6));
  console.log("Tracking: " + tokens.map(t => t.symbol).join(", "));

  await sendAlert(
    "GUARDIAN CASCADE v10.1 — ONLINE

" +
    "Wallet: " + WALLET_ADDRESS + "
" +
    "ETH: " + ethBalance.toFixed(6) + " (~$" + (ethBalance * ETH_USD).toFixed(2) + ")
" +
    "WETH: " + wethBal.toFixed(6) + " (~$" + (wethBal * ETH_USD).toFixed(2) + ")
" +
    "Watching: " + tokens.map(t => t.symbol).join(", ") + "

" +
    "CASCADE ENGINE ACTIVE
" +
    "Sell tops -> cascade into bottoms (below 50% only)
" +
    "$3 seed per token | 1% piggy skim | 2% lottery
" +
    "60s tx timeout | no watchdog restarts

" +
    "Send /help for commands"
  );

  let cachedEth = ethBalance;

  // Telegram loop — 3 second polling, completely independent
  (async function telegramLoop() {
    while (true) {
      try { await checkTelegramCommands(cdpClient, cachedEth); } catch (e) {}
      await sleep(3000);
    }
  })();

  // Main trading loop
  while (true) {
    try {
      const eth  = await getEthBalance();
      const weth = await getWethBalance();
      cachedEth         = eth;
      cachedEthBalance  = eth;
      cachedWethBalance = weth;

      // Update token balance cache
      for (const t of tokens) {
        try { cachedBalances[t.symbol] = await getTokenBalance(t.address); } catch(e) { cachedBalances[t.symbol] = 0; }
      }

      console.log("\n" + new Date().toLocaleTimeString() + " ETH:" + eth.toFixed(6) + " WETH:" + weth.toFixed(6) + " Trades:" + tradeCount);
      console.log("Tradeable: " + getTradeableEth(eth).toFixed(6) + " | Piggy: " + piggyBank.toFixed(6));

      for (const token of tokens) {
        try { await processToken(cdpClient, token, eth); }
        catch (e) { console.log("Token error (" + token.symbol + "): " + e.message); }
        await sleep(4000);
      }

      if (Date.now() - lastReportTime > REPORT_INTERVAL) {
        lastReportTime = Date.now();
        const e2 = cachedEthBalance;
        const w2 = cachedWethBalance;
        let msg = "GUARDIAN 30 MIN REPORT
" + new Date().toLocaleTimeString() + "

";
        msg += "ETH: " + e2.toFixed(6) + " | WETH: " + w2.toFixed(6) + "
";
        msg += "Trades: " + tradeCount + " | Piggy: " + piggyBank.toFixed(6) + " ETH

";
        for (const t of tokens) {
          const p = history[t.symbol]?.lastPrice;
          if (!p) { msg += t.symbol + ": loading
"; continue; }
          const hl  = getRecentHighLow(t.symbol);
          const cp  = hl ? getCyclePosition(t.symbol, p) : null;
          const zone = !hl ? "[?]" : cp >= SELL_ZONE*100 ? "[SELL]" : cp <= BUY_ZONE*100 ? "[BUY]" : "[---]";
          const pnl  = t.entryPrice ? " P&L:" + ((p - t.entryPrice) / t.entryPrice * 100).toFixed(1) + "%" : "";
          msg += zone + " " + t.symbol + " $" + p.toFixed(8) + " " + (cp !== null ? cp.toFixed(0) : "?") + "%" + pnl + "
";
        }
        await sendAlert(msg);
      }

      if (Date.now() - lastSaveTime > SAVE_INTERVAL) {
        await saveToGitHub();
      }

    } catch (e) {
      console.log("Main loop error: " + e.message);
      await sendAlert("GUARDIAN ERROR
" + e.message + "

Bot continuing...");
    }

    await sleep(INTERVAL);
  }
}

main().catch(e => {
  console.log("Fatal: " + e.message);
  setTimeout(() => main(), 30000);
});
