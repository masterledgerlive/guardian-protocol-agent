import { CdpClient } from "@coinbase/cdp-sdk";
import { createPublicClient, http, formatEther, parseEther } from "viem";
import { base } from "viem/chains";
import dotenv from "dotenv";
dotenv.config();

// ═══════════════════════════════════════════════════════════════════════
// ⚔️  GUARDIAN CASCADE SYSTEM v10.0 — MASTER EDITION
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
const GAS_PROFIT_MULT = 3;
const MAX_GAS_ETH     = 0.002;
const ETH_USD         = 1940;

// ── TRADING ─────────────────────────────────────────────────────────────
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

// Cache — updated every main cycle, read by Telegram (no RPC calls in commands)
let cachedEthBalance  = 0;
let cachedWethBalance = 0;
let cachedBalances    = {};

const buyConfirmations  = {};
const sellZoneEntryTime = {};
let   manualCommands    = [];

// ── CDP CLIENT ───────────────────────────────────────────────────────────
function createCdpClient() {
  const apiKeySecret = (
    process.env.CDP_API_KEY_PRIVATE_KEY ||
    process.env.CDP_API_KEY_SECRET || ""
  ).replace(/\\n/g, "\n");
  const apiKeyId =
    process.env.CDP_API_KEY_NAME ||
    process.env.CDP_API_KEY_ID || "";
  return new CdpClient({
    apiKeyId,
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
  for (const t of tokens) t.lotteryTickets = 0;
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

// ── ANALYSIS ─────────────────────────────────────────────────────────────
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
    console.log(`   ⏳ ${symbol} cooldown: ${Math.ceil((COOLDOWN_MS - elapsed) / 1000)}s`);
    return false;
  }
  return true;
}

// ── CASCADE ENGINE ────────────────────────────────────────────────────────
async function findCascadeTarget(excludeSymbol) {
  let bestToken  = null;
  let lowestCycle = 100;
  for (const t of tokens) {
    if (t.symbol === excludeSymbol) continue;
    if (t.status !== "active") continue;
    if (!canTrade(t.symbol)) continue;
    const price = history[t.symbol]?.lastPrice;
    if (!price) continue;
    const hl = getRecentHighLow(t.symbol);
    if (!hl) continue;
    const cycle       = getCyclePosition(t.symbol, price);
    const hasPosition = t.entryPrice !== null;
    const adjusted    = hasPosition ? cycle + 20 : cycle;
    if (adjusted < lowestCycle) { lowestCycle = adjusted; bestToken = t; }
  }
  return bestToken;
}

// ── FEE GATE ─────────────────────────────────────────────────────────────
async function isTradeProfitable(ethAmount, isSell = false, entryEth = 0) {
  const gasCost    = await estimateGasCostEth();
  const tradeValue = ethAmount * ETH_USD;
  const gasCostUsd = gasCost  * ETH_USD;
  if (gasCost > MAX_GAS_ETH) {
    console.log(`   ⛽ GAS SPIKE: ${gasCost.toFixed(6)} ETH — skipping`);
    return false;
  }
  if (tradeValue < MIN_TRADE_USD) {
    console.log(`   🛑 Too small ($${tradeValue.toFixed(3)})`);
    return false;
  }
  if (isSell && entryEth > 0) {
    const minProceedsEth = entryEth + (gasCost * GAS_PROFIT_MULT);
    if (ethAmount < minProceedsEth) {
      console.log(`   🛑 Sell gate: $${tradeValue.toFixed(2)} < entry + fees×3`);
      return false;
    }
  } else if (tradeValue < gasCostUsd * GAS_PROFIT_MULT) {
    console.log(`   🛑 Gas eats profit — $${tradeValue.toFixed(3)} vs gas $${gasCostUsd.toFixed(4)}×${GAS_PROFIT_MULT}`);
    return false;
  }
  return true;
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

// ── APPROVAL CACHE ────────────────────────────────────────────────────────
async function ensureApproved(cdp, tokenAddress, amountIn) {
  const MAX_UINT256 = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
  const key = tokenAddress.toLowerCase();
  if (approvedTokens.has(key)) { console.log(`      ✅ Approved (cached)`); return; }
  const allowance = await rpcCall(c => c.readContract({
    address: tokenAddress, abi: ERC20_ABI,
    functionName: "allowance", args: [WALLET_ADDRESS, SWAP_ROUTER],
  }));
  if (allowance >= amountIn) { approvedTokens.add(key); console.log(`      ✅ Already approved`); return; }
  console.log(`      🔓 Approving (one time only)...`);
  await cdp.evm.sendTransaction({
    address: WALLET_ADDRESS, network: "base",
    transaction: { to: tokenAddress, data: encodeApprove(SWAP_ROUTER, MAX_UINT256) },
  });
  approvedTokens.add(key);
  await sleep(8000);
  console.log(`      ✅ Approved and cached`);
}

// ── BUY ───────────────────────────────────────────────────────────────────
async function executeBuy(cdp, token, tradeableEth, reason, price, hl, forcedEth = 0) {
  try {
    if (!canTrade(token.symbol)) return false;
    const wethBal    = await getWethBalance();
    const totalAvail = tradeableEth + wethBal;
    if (totalAvail < MIN_ETH_TRADE) { console.log(`   🛑 ETH+WETH too low`); return false; }

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

    console.log(`      Budget: ${ethToSpend.toFixed(6)} ETH (~$${(ethToSpend * ETH_USD).toFixed(2)}) ${deepBonus > 1 ? "(DEEP ×1.5)" : ""}`);
    if (!await isTradeProfitable(ethToSpend)) return false;

    const amountIn = parseEther(ethToSpend.toFixed(18));
    const useWeth  = wethBal >= ethToSpend;

    console.log(`\n   🟢 BUY ${token.symbol} — ${reason}`);
    console.log(`      ${ethToSpend.toFixed(6)} ${useWeth ? "WETH" : "ETH"} @ $${price.toFixed(8)}`);
    if (hl) console.log(`      LOW: $${hl.low.toFixed(8)} | HIGH: $${hl.high.toFixed(8)}`);

    let txHash;
    if (useWeth) {
      await ensureApproved(cdp, WETH_ADDRESS, amountIn);
      const { transactionHash } = await cdp.evm.sendTransaction({
        address: WALLET_ADDRESS, network: "base",
        transaction: {
          to: SWAP_ROUTER,
          data: encodeSwap(WETH_ADDRESS, token.address, amountIn, WALLET_ADDRESS, token.feeTier),
        },
      });
      txHash = transactionHash;
    } else {
      const { transactionHash } = await cdp.evm.sendTransaction({
        address: WALLET_ADDRESS, network: "base",
        transaction: {
          to: SWAP_ROUTER, value: amountIn,
          data: encodeSwap(WETH_ADDRESS, token.address, amountIn, WALLET_ADDRESS, token.feeTier),
        },
      });
      txHash = transactionHash;
    }

    lastTradeTime[token.symbol] = Date.now();
    tradeCount++;
    token.entryPrice    = price;
    token.totalInvested = (token.totalInvested || 0) + ethToSpend;
    token.entryTime     = Date.now();
    delete sellZoneEntryTime[token.symbol];

    console.log(`      ✅ https://basescan.org/tx/${txHash}`);
    await sendAlert(
      `🟢🟢🟢 <b>BOUGHT ${token.symbol}!</b>\n\n` +
      `💰 Spent: ${ethToSpend.toFixed(6)} ${useWeth ? "WETH" : "ETH"} (~$${(ethToSpend * ETH_USD).toFixed(2)})\n` +
      `💲 Entry price: $${price.toFixed(8)}\n` +
      `📉 Cycle LOW:  $${hl?.low.toFixed(8) || "learning"}\n` +
      `📈 Cycle HIGH: $${hl?.high.toFixed(8) || "learning"}\n` +
      (hl ? `🎯 Sell zone target: $${(hl.low + hl.range * SELL_ZONE).toFixed(8)} (+${(((hl.low + hl.range * SELL_ZONE) - price) / price * 100).toFixed(1)}%)\n` : ``) +
      `📊 Reason: ${reason}\n` +
      (deepBonus > 1 ? `🔥 DEEP ZONE — 50% bigger position!\n` : ``) +
      `🔗 <a href="https://basescan.org/tx/${txHash}">View on Basescan</a>`
    );
    return ethToSpend;
  } catch (e) {
    console.log(`      ❌ BUY FAILED: ${e.message}`);
    await sendAlert(`⚠️ <b>${token.symbol} BUY FAILED</b>\n${e.message}`);
    return false;
  }
}

// ── SELL ──────────────────────────────────────────────────────────────────
async function executeSell(cdp, token, sellPct, reason, price, hl) {
  try {
    if (!canTrade(token.symbol)) return null;
    const totalBal    = await getTokenBalance(token.address);
    const lotteryHold = Math.max(Math.floor(totalBal * LOTTERY_PCT), 1);
    const sellable    = Math.max(totalBal - lotteryHold, 0);
    if (sellable < 1) { console.log(`   ⏳ Nothing to sell (${lotteryHold} held as lottery)`); return null; }

    const isProtect = reason.includes("CAPITAL PROTECT") || reason.includes("STOP LOSS") || reason.includes("MANUAL");
    if (token.entryPrice && price < token.entryPrice && !isProtect) {
      console.log(`   🛑 ${token.symbol} below entry — holding`);
      return null;
    }

    const amountToSell       = BigInt(Math.floor(sellable * sellPct * 1e18));
    if (amountToSell === BigInt(0)) return null;
    const expectedProceedsEth = (sellable * sellPct * price) / ETH_USD;
    const entryEth            = isProtect ? 0 : (token.totalInvested * sellPct || 0);
    if (!await isTradeProfitable(expectedProceedsEth, !isProtect, entryEth)) return null;

    console.log(`\n   🔴 SELL ${token.symbol} — ${reason}`);
    console.log(`      ${(sellPct * 100).toFixed(0)}% of ${sellable.toFixed(0)} tokens @ $${price.toFixed(8)}`);
    console.log(`      🎰 Keeping ${lotteryHold} ${token.symbol} forever`);

    await ensureApproved(cdp, token.address, amountToSell);

    const wethBefore = await getWethBalance();
    const ethBefore  = await getEthBalance();

    const { transactionHash } = await cdp.evm.sendTransaction({
      address: WALLET_ADDRESS, network: "base",
      transaction: {
        to: SWAP_ROUTER,
        data: encodeSwap(token.address, WETH_ADDRESS, amountToSell, WALLET_ADDRESS, token.feeTier),
      },
    });

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
      console.log(`      🐷 Skimmed ${skim.toFixed(6)} ETH → piggy bank`);
    }

    if (sellPct >= SELL_ALL_PCT) { token.entryPrice = null; token.entryTime = null; token.totalInvested = 0; }
    delete sellZoneEntryTime[token.symbol];

    const proceedsAfterSkim = Math.max(profit - skim, 0);
    console.log(`      ✅ https://basescan.org/tx/${transactionHash}`);
    console.log(`      💰 Received: ${profit.toFixed(6)} ETH ($${profitUsd})`);

    await sendAlert(
      `🔴🔴🔴 <b>SOLD ${token.symbol}!</b>\n\n` +
      `💰 Received: ${profit.toFixed(6)} ETH (~$${profitUsd})\n` +
      `📥 Originally invested: ~$${entryUsd}\n` +
      `${parseFloat(profitUsd) >= parseFloat(entryUsd) ? "📈" : "📉"} Net: ${profit > 0 ? "+" : ""}$${(parseFloat(profitUsd) - parseFloat(entryUsd)).toFixed(2)}\n` +
      `💲 Exit price: $${price.toFixed(8)}\n` +
      `🎰 Keeping ${lotteryHold} ${token.symbol} forever\n` +
      `🐷 Piggy skim: ${skim.toFixed(6)} ETH | Total: ${piggyBank.toFixed(6)} ETH\n` +
      `📊 Reason: ${reason}\n` +
      `🔗 <a href="https://basescan.org/tx/${transactionHash}">View on Basescan</a>`
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
    if (!target) { console.log(`  🌊 No cascade target — proceeds stay as WETH`); return; }
    const price = history[target.symbol]?.lastPrice;
    if (!price) return;
    const hl    = getRecentHighLow(target.symbol);
    const cycle = hl ? getCyclePosition(target.symbol, price) : 50;
    const tradeEth = getTradeableEth(ethBalance);
    console.log(`  🌊 Cascading into ${target.symbol} — cycle ${cycle.toFixed(0)}%`);
    await sendAlert(
      `🌊 <b>CASCADE: ${soldSymbol} → ${target.symbol}</b>\n\n` +
      `💰 Routing: ${proceeds.toFixed(6)} ETH\n` +
      `📊 ${target.symbol} cycle position: ${cycle.toFixed(0)}%\n` +
      (hl ? `📉 LOW: $${hl.low.toFixed(8)} | HIGH: $${hl.high.toFixed(8)}\n` : ``) +
      `⚡ Buying now...`
    );
    await executeBuy(cdp, target, tradeEth, `🌊 CASCADE from ${soldSymbol} (cycle ${cycle.toFixed(0)}%)`, price, hl, proceeds * 0.95);
  } catch (e) { console.log(`  ⚠️ Cascade error: ${e.message}`); }
}

// ── TOKEN LINE BUILDER ───────────────────────────────────────────────────
function buildTokenLine(t, price, bal, hl) {
  const cp       = hl ? getCyclePosition(t.symbol, price) : null;
  const sellT    = hl ? hl.low + hl.range * SELL_ZONE : null;
  const buyT     = hl ? hl.low + hl.range * BUY_ZONE  : null;
  const zone     = !hl ? "⬜" : cp >= SELL_ZONE * 100 ? "🔴" : cp <= BUY_ZONE * 100 ? "🟢" : "⬜";
  const lottery  = Math.floor(bal * LOTTERY_PCT);
  const sellable = Math.max(bal - lottery, 0);
  const sellNow  = (sellable * price).toFixed(2);

  let line = `\n${zone} <b>${t.symbol}</b> — $${price.toFixed(8)}`;
  if (cp !== null) line += ` | Cycle: <b>${cp.toFixed(0)}%</b>`;
  line += "\n";

  if (t.entryPrice) {
    const pnlPct  = ((price - t.entryPrice) / t.entryPrice * 100).toFixed(2);
    const invested = (t.totalInvested * ETH_USD).toFixed(2);
    const age      = t.entryTime ? Math.floor((Date.now() - t.entryTime) / 60000) : "?";
    const arrow    = parseFloat(pnlPct) >= 0 ? "📈" : "📉";
    line += `${arrow} Entry: $${t.entryPrice.toFixed(8)} (${age}m ago)\n`;
    line += `   P&L: <b>${parseFloat(pnlPct) >= 0 ? "+" : ""}${pnlPct}%</b> | Invested: ~$${invested}\n`;
    line += `   💵 Sell NOW → ~$${sellNow}\n`;
  } else {
    line += `⬜ No position | Dust: ~$${sellNow}\n`;
  }

  if (hl && cp !== null) {
    if (cp >= SELL_ZONE * 100) {
      line += `   🔴 IN SELL ZONE — bot may sell soon!\n`;
    } else {
      const pctToSell = ((sellT - price) / price * 100).toFixed(1);
      line += `   🎯 To sell zone: +${pctToSell}% ($${sellT.toFixed(8)})\n`;
    }
    if (cp <= BUY_ZONE * 100) {
      line += `   🟢 IN BUY ZONE — watching!\n`;
    } else {
      const pctToBuy = ((price - buyT) / price * 100).toFixed(1);
      line += `   🛒 To buy zone: -${pctToBuy}% ($${buyT.toFixed(8)})\n`;
    }
  } else {
    line += `   ⏳ Building price history...\n`;
  }
  line += `   🪙 ${Math.floor(bal)} tokens | 🎰 ${lottery} lottery kept forever\n`;
  return line;
}

// ── REPORTS ───────────────────────────────────────────────────────────────
async function sendFullReport(ethBalance, title) {
  try {
    let lines = "";
    for (const t of tokens) {
      const price = history[t.symbol]?.lastPrice;
      if (!price) { lines += `\n⬜ <b>${t.symbol}</b> — loading...\n`; continue; }
      const bal = await getTokenBalance(t.address);
      const hl  = getRecentHighLow(t.symbol);
      lines += buildTokenLine(t, price, bal, hl);
    }
    const weth = await getWethBalance();
    await sendAlert(
      `📊 <b>GUARDIAN v10.0 — ${title}</b>\n` +
      `🕐 ${new Date().toLocaleTimeString()}\n\n` +
      `💰 ETH: ${ethBalance.toFixed(6)} (~$${(ethBalance * ETH_USD).toFixed(2)})\n` +
      `💎 WETH: ${weth.toFixed(6)} (~$${(weth * ETH_USD).toFixed(2)}) ← bot buys with this\n` +
      `♻️ Tradeable: ${getTradeableEth(ethBalance).toFixed(6)} ETH\n` +
      `🐷 Piggy: ${piggyBank.toFixed(6)} ETH ($${(piggyBank * ETH_USD).toFixed(2)}) LOCKED\n` +
      `📈 Trades: ${tradeCount} | Skimmed: ${totalSkimmed.toFixed(6)} ETH\n` +
      `─────────────────────────` +
      lines +
      `\n🔗 <a href="https://basescan.org/address/${WALLET_ADDRESS}">View wallet on Basescan</a>`
    );
  } catch (e) { console.log(`Report error: ${e.message}`); }
}

async function sendReport(ethBalance) {
  try {
    if (Date.now() - lastReportTime < REPORT_INTERVAL) return;
    lastReportTime = Date.now();
    await sendFullReport(ethBalance, "⏰ 30 MIN REPORT");
  } catch (e) { console.log(`Report error: ${e.message}`); }
}

// ── TELEGRAM COMMANDS ───────────────────────────────────────────────────────
let lastUpdateId = 0;

async function checkTelegramCommands(cdp, ethBalance) {
  try {
    const tok = process.env.TELEGRAM_BOT_TOKEN;
    const cid = process.env.TELEGRAM_CHAT_ID;
    if (!tok || !cid) return;

    const res  = await fetch(`https://api.telegram.org/bot${tok}/getUpdates?offset=${lastUpdateId + 1}&timeout=1`);
    const data = await res.json();
    if (!data.ok || !data.result?.length) return;

    for (const update of data.result) {
      lastUpdateId = update.update_id;
      const raw    = update.message?.text?.trim() || "";
      const text   = raw.toLowerCase();
      if (!raw || update.message?.chat?.id?.toString() !== cid) continue;
      console.log(`📱 Telegram: ${raw}`);

      try {

        if (text.startsWith("/buy ")) {
          const sym = raw.split(" ")[1]?.toUpperCase();
          if (!tokens.find(t => t.symbol === sym)) {
            await sendAlert("Unknown token: " + sym + "\nOptions: DEGEN TOSHI BRETT AERO VIRTUAL AIXBT CLANKER SEAM");
            continue;
          }
          manualCommands.push({ symbol: sym, action: "buy" });
          await sendAlert("BUY " + sym + " queued — fires within 30s");

        } else if (text.startsWith("/sellhalf ")) {
          const sym = raw.split(" ")[1]?.toUpperCase();
          if (!tokens.find(t => t.symbol === sym)) {
            await sendAlert("Unknown token: " + sym);
            continue;
          }
          manualCommands.push({ symbol: sym, action: "sellhalf" });
          await sendAlert("SELL HALF " + sym + " queued — fires within 30s");

        } else if (text.startsWith("/sell ")) {
          const sym = raw.split(" ")[1]?.toUpperCase();
          if (!tokens.find(t => t.symbol === sym)) {
            await sendAlert("Unknown token: " + sym);
            continue;
          }
          manualCommands.push({ symbol: sym, action: "sell" });
          await sendAlert("SELL " + sym + " queued — fires within 30s, will cascade proceeds");

        } else if (text === "/eth" || text === "eth") {
          const e2 = cachedEthBalance;
          const w2 = cachedWethBalance;
          let msg = "BALANCES\n\n";
          msg += "ETH:      " + e2.toFixed(6) + " (~$" + (e2 * ETH_USD).toFixed(2) + ")\n";
          msg += "WETH:     " + w2.toFixed(6) + " (~$" + (w2 * ETH_USD).toFixed(2) + ") - bot buys with this\n";
          msg += "Combined: " + (e2 + w2).toFixed(6) + " ETH (~$" + ((e2 + w2) * ETH_USD).toFixed(2) + ")\n";
          msg += "Tradeable: " + getTradeableEth(e2).toFixed(6) + " ETH\n";
          msg += "Piggy (LOCKED): " + piggyBank.toFixed(6) + " ETH ($" + (piggyBank * ETH_USD).toFixed(2) + ")\n";
          msg += "\nhttps://basescan.org/address/" + WALLET_ADDRESS;
          await sendAlert(msg);

        } else if (text === "/prices" || text === "prices") {
          let msg = "LIVE PRICES + ZONES\n" + new Date().toLocaleTimeString() + "\n\n";
          for (const t of tokens) {
            const p = history[t.symbol]?.lastPrice;
            if (!p) { msg += t.symbol + ": loading\n\n"; continue; }
            const hl    = getRecentHighLow(t.symbol);
            const cp    = hl ? getCyclePosition(t.symbol, p) : null;
            const sellT = hl ? hl.low + hl.range * SELL_ZONE : null;
            const buyT  = hl ? hl.low + hl.range * BUY_ZONE  : null;
            const zone  = !hl ? "[?]" : cp >= SELL_ZONE*100 ? "[SELL]" : cp <= BUY_ZONE*100 ? "[BUY]" : "[---]";
            msg += zone + " " + t.symbol + " -- $" + p.toFixed(8) + " -- " + (cp !== null ? cp.toFixed(0) : "?") + "%\n";
            if (hl && cp !== null) {
              const toSell = cp >= SELL_ZONE*100 ? "IN SELL ZONE" : "+" + ((sellT - p)/p*100).toFixed(1) + "% to sell";
              const toBuy  = cp <= BUY_ZONE*100  ? "IN BUY ZONE"  : "-" + ((p - buyT)/p*100).toFixed(1) + "% to buy";
              msg += "  Sell: " + toSell + "\n";
              msg += "  Buy:  " + toBuy + "\n\n";
            } else {
              msg += "  Building history...\n\n";
            }
          }
          await sendAlert(msg);

        } else if (text === "/positions" || text === "positions") {
          let msg = "OPEN POSITIONS\n" + new Date().toLocaleTimeString() + "\n\n";
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
            const pnlSign  = parseFloat(pnlPct) >= 0 ? "+" : "";
            msg += (parseFloat(pnlPct) >= 0 ? "[PROFIT]" : "[LOSS]") + " " + t.symbol + "\n";
            msg += "  Entry:    $" + t.entryPrice.toFixed(8) + " (" + age + "m ago)\n";
            msg += "  Now:      $" + p.toFixed(8) + "\n";
            msg += "  P&L:      " + pnlSign + pnlPct + "%\n";
            msg += "  Invested: ~$" + invested + "\n";
            msg += "  Sell now: ~$" + sellNow + "\n";
            if (cp !== null) {
              msg += "  Cycle:    " + cp.toFixed(0) + "%";
              if (sellT) msg += " (to sell: +" + ((sellT - p)/p*100).toFixed(1) + "%)";
              msg += "\n";
            }
            msg += "  Holding: " + Math.floor(bal) + " tokens | Lottery: " + lottery + "\n\n";
          }
          if (!any) msg += "No open positions yet.\nBot seeds $3 into each token automatically.";
          await sendAlert(msg);

        } else if (text === "/status" || text === "status") {
          const e2 = cachedEthBalance;
          const w2 = cachedWethBalance;
          let msg = "GUARDIAN v10.0 STATUS\n" + new Date().toLocaleTimeString() + "\n\n";
          msg += "ETH: " + e2.toFixed(6) + " (~$" + (e2 * ETH_USD).toFixed(2) + ")\n";
          msg += "WETH: " + w2.toFixed(6) + " (~$" + (w2 * ETH_USD).toFixed(2) + ")\n";
          msg += "Tradeable: " + getTradeableEth(e2).toFixed(6) + " ETH\n";
          msg += "Piggy: " + piggyBank.toFixed(6) + " ETH (LOCKED)\n";
          msg += "Trades: " + tradeCount + "\n";
          msg += "-------------------------\n";
          for (const t of tokens) {
            const p = history[t.symbol]?.lastPrice;
            if (!p) { msg += t.symbol + ": loading\n"; continue; }
            const hl  = getRecentHighLow(t.symbol);
            const cp  = hl ? getCyclePosition(t.symbol, p) : null;
            const bal = cachedBalances[t.symbol] || 0;
            const lottery  = Math.floor(bal * LOTTERY_PCT);
            const sellable = Math.max(bal - lottery, 0);
            const sellNow  = (sellable * p).toFixed(2);
            const zone = !hl ? "[?]" : cp >= SELL_ZONE*100 ? "[SELL]" : cp <= BUY_ZONE*100 ? "[BUY]" : "[---]";
            const sellT = hl ? hl.low + hl.range * SELL_ZONE : null;
            msg += zone + " " + t.symbol + " -- $" + p.toFixed(8) + " -- " + (cp !== null ? cp.toFixed(0) : "?") + "%\n";
            if (t.entryPrice) {
              const pnl = ((p - t.entryPrice) / t.entryPrice * 100).toFixed(2);
              const toSell = sellT ? "+" + ((sellT - p)/p*100).toFixed(1) + "% to sell" : "";
              msg += "  P&L: " + (parseFloat(pnl)>=0?"+":"") + pnl + "% | Sell now: ~$" + sellNow + " | " + toSell + "\n";
            } else {
              msg += "  No position | Dust: ~$" + sellNow + "\n";
            }
          }
          msg += "\nhttps://basescan.org/address/" + WALLET_ADDRESS;
          await sendAlert(msg);

        } else if (text === "/piggy" || text === "piggy") {
          const pct = Math.min((piggyBank / 0.5) * 100, 100);
          const filled = Math.floor(pct / 10);
          const bar = "#".repeat(filled) + ".".repeat(10 - filled);
          let msg = "PIGGY BANK -- LOCKED FOREVER\n\n";
          msg += "Saved: " + piggyBank.toFixed(6) + " ETH ($" + (piggyBank * ETH_USD).toFixed(2) + ")\n";
          msg += "Total skimmed: " + totalSkimmed.toFixed(6) + " ETH\n";
          msg += "[" + bar + "] " + pct.toFixed(1) + "% to 0.5 ETH\n\n";
          msg += "1% from every profitable sell\nNever touched -- compounds forever";
          await sendAlert(msg);

        } else if (text === "/trades" || text === "trades") {
          let msg = "TRADE STATS\n\n";
          msg += "Total trades: " + tradeCount + "\n";
          msg += "Profit skimmed: " + totalSkimmed.toFixed(6) + " ETH ($" + (totalSkimmed * ETH_USD).toFixed(2) + ")\n";
          msg += "Piggy balance: " + piggyBank.toFixed(6) + " ETH";
          await sendAlert(msg);

        } else if (text === "/cascade" || text === "cascade") {
          let msg = "CASCADE ORDER (bottom to top)\n" + new Date().toLocaleTimeString() + "\n\n";
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
            msg += zone + pos + " " + t.symbol + " " + t.cycle.toFixed(0) + "% -- $" + t.price.toFixed(8) + "\n";
          }
          msg += "\n* = open position | Next cascade target = lowest [---]";
          await sendAlert(msg);

        } else if (text === "/help" || text === "help") {
          let msg = "GUARDIAN v10.0 COMMANDS\n\n";
          msg += "INFO:\n";
          msg += "/status   -- full snapshot\n";
          msg += "/eth      -- balances\n";
          msg += "/prices   -- prices + % to zones\n";
          msg += "/positions -- P&L + sell-now value\n";
          msg += "/cascade  -- cascade order\n";
          msg += "/piggy    -- piggy bank\n";
          msg += "/trades   -- stats\n\n";
          msg += "TRADING:\n";
          msg += "/buy SYMBOL      -- force buy\n";
          msg += "/sell SYMBOL     -- force sell + cascade\n";
          msg += "/sellhalf SYMBOL -- sell half\n\n";
          msg += "Examples:\n";
          msg += "/buy AERO\n";
          msg += "/sell VIRTUAL\n";
          msg += "/sellhalf BRETT\n\n";
          msg += "All commands respond within 3 seconds";
          await sendAlert(msg);
        }

      } catch (cmdErr) {
        console.log("Telegram command error:", cmdErr.message);
        await sendAlert("Command error: " + cmdErr.message);
      }
    }
  } catch (e) { /* silent -- never crash */ }
}


// ── PROCESS ONE TOKEN ─────────────────────────────────────────────────────
async function processToken(cdp, token, ethBalance) {
  try {
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
    const entry        = token.entryPrice;
    const lotteryHold  = Math.floor(balance * LOTTERY_PCT);
    const inBuyZone    = hl && cycleNum <= BUY_ZONE  * 100;
    const inDeepBuy    = hl && cycleNum <= DEEP_BUY_ZONE * 100;
    const inSellZone   = hl && cycleNum >= SELL_ZONE * 100;
    const isBreakout   = hl && price >= hl.high * 1.03;
    const wethBal      = await getWethBalance();
    const totalAvail   = tradeableEth + wethBal;

    const zoneStatus = !hl ? "⏳ Learning..." : isBreakout ? "🚨 BREAKOUT!" :
      inSellZone ? `🔴 SELL ${cycleNum.toFixed(0)}%` :
      inBuyZone  ? `🟢 BUY ${cycleNum.toFixed(0)}%${inDeepBuy ? " 🔥" : ""}` :
      `⬜ ${cycleNum.toFixed(0)}%`;

    const pnlStr = entry ? ` | P&L: ${((price - entry) / entry * 100).toFixed(1)}%` : "";

    console.log(`\n  ┌─ [${token.symbol}] ${zoneStatus} | $${price.toFixed(8)}${pnlStr}`);
    console.log(`  │ 🪙 ${balance.toFixed(0)} ($${valueUsd}) | momentum: ${momentum.direction} | 🎰 lottery: ${lotteryHold}`);
    if (hl) {
      const toSell = inSellZone ? "IN ZONE" : `+${((hl.low + hl.range * SELL_ZONE - price) / price * 100).toFixed(1)}% to sell`;
      console.log(`  │ Cycle LOW $${hl.low.toFixed(8)} → HIGH $${hl.high.toFixed(8)} | ${toSell}`);
    }
    console.log(`  └─────────────────────────────────────────────`);

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

    const sellable = Math.max(balance - lotteryHold, 0);

    // ── SELL LOGIC ──────────────────────────────────────────────────────
    if (sellable > 1) {

      // Stop loss
      if (entry && token.entryTime && price < entry * (1 - STOP_LOSS_PCT) && (Date.now() - token.entryTime) > STOP_LOSS_MS) {
        console.log(`  🛑 STOP LOSS ${token.symbol}`);
        const proceeds = await executeSell(cdp, token, SELL_ALL_PCT, `STOP LOSS ${((price - entry) / entry * 100).toFixed(1)}%`, price, hl);
        if (proceeds > 0) await triggerCascade(cdp, token.symbol, proceeds, ethBalance);
        return;
      }

      // Capital protect
      if (entry && !inSellZone && !isBreakout && price >= entry * (1 + ENTRY_CUSHION)) {
        console.log(`  💛 CAPITAL PROTECT ${token.symbol}`);
        const proceeds = await executeSell(cdp, token, SELL_ALL_PCT, "CAPITAL PROTECT +1% above entry", price, hl);
        if (proceeds > 0) await triggerCascade(cdp, token.symbol, proceeds, ethBalance);
        return;
      }

      // Breakout sell
      if (isBreakout) {
        console.log(`  🚨 BREAKOUT ${token.symbol}`);
        delete sellZoneEntryTime[token.symbol];
        const proceeds = await executeSell(cdp, token, SELL_ALL_PCT * 0.5, `BREAKOUT +${(((price / hl.high) - 1) * 100).toFixed(1)}% above HIGH`, price, hl);
        if (proceeds > 0) await triggerCascade(cdp, token.symbol, proceeds, ethBalance);

      // Normal sell zone
      } else if (inSellZone) {
        if (!sellZoneEntryTime[token.symbol]) sellZoneEntryTime[token.symbol] = { firstMs: Date.now(), tick: 0 };
        sellZoneEntryTime[token.symbol].tick++;
        const ticks  = sellZoneEntryTime[token.symbol].tick;
        const rising = momentum.direction === "up";
        if (rising && ticks <= TRAILING_TICKS) {
          console.log(`  ⬆ ${token.symbol} trailing (${ticks}/${TRAILING_TICKS}) — still rising`);
        } else {
          delete sellZoneEntryTime[token.symbol];
          const why      = rising ? "max trailing reached" : "momentum fading";
          const proceeds = await executeSell(cdp, token, SELL_ALL_PCT, `AT HIGH ZONE — ${why}`, price, hl);
          if (proceeds > 0) await triggerCascade(cdp, token.symbol, proceeds, ethBalance);
        }
      } else {
        if (sellZoneEntryTime[token.symbol]) delete sellZoneEntryTime[token.symbol];
      }

    // ── BUY LOGIC ────────────────────────────────────────────────────────
    } else if (totalAvail >= MIN_ETH_TRADE) {

      if (inBuyZone) {
        const conf = buyConfirmations[token.symbol];
        if (!conf) {
          buyConfirmations[token.symbol] = { firstSeenMs: Date.now(), priceAtFirst: price };
          console.log(`  ⏱️  ${token.symbol} BUY ZONE — 2 min clock started`);
          await sendAlert(
            `⏱️ <b>${token.symbol} HIT BUY ZONE${inDeepBuy ? " 🔥 DEEP!" : ""}</b>\n\n` +
            `💲 $${price.toFixed(8)} | Cycle: ${cycleNum.toFixed(0)}%\n` +
            `⏳ Confirming bottom — 2 min wait\n` +
            `Still falling → resets | Holds/rises → BUY`
          );
        } else {
          const elapsed   = Date.now() - conf.firstSeenMs;
          const remaining = Math.max(0, Math.ceil((BUY_CONFIRM_MS - elapsed) / 1000));
          if (momentum.direction === "down") {
            buyConfirmations[token.symbol] = { firstSeenMs: Date.now(), priceAtFirst: price };
            console.log(`  ⬇️  ${token.symbol} still falling — clock reset`);
          } else if (elapsed < BUY_CONFIRM_MS) {
            console.log(`  ⏳ ${token.symbol} confirming... ${remaining}s left`);
          } else {
            console.log(`  🟢 ${token.symbol} CONFIRMED — buying!`);
            delete buyConfirmations[token.symbol];
            await executeBuy(cdp, token, tradeableEth, `LOW ZONE CONFIRMED${inDeepBuy ? " 🔥 DEEP" : ""} (${(elapsed / 60000).toFixed(1)} min)`, price, hl);
          }
        }
      } else {
        if (buyConfirmations[token.symbol]) {
          console.log(`  ↗️  ${token.symbol} left buy zone — clearing`);
          delete buyConfirmations[token.symbol];
        }
        // $3 seed entry if no position
        if (!token.entryPrice && token.status === "active") {
          const minEntryEth = MIN_ENTRY_USD / ETH_USD;
          if (totalAvail >= minEntryEth) {
            console.log(`  💵 ${token.symbol} $${MIN_ENTRY_USD} SEED ENTRY`);
            await executeBuy(cdp, token, tradeableEth, `$${MIN_ENTRY_USD} seed — initial position`, price, hl);
          }
        }
      }
    }

  } catch (e) {
    console.log(`  ⚠️ processToken error (${token.symbol}): ${e.message}`);
  }
}

// ── MAIN ──────────────────────────────────────────────────────────────────
async function main() {
  console.log("═══════════════════════════════════════════════════════");
  console.log("⚔️   GUARDIAN CASCADE SYSTEM v10.0 — MASTER EDITION");
  console.log("═══════════════════════════════════════════════════════\n");

  await loadFromGitHub();
  cdpClient = createCdpClient();
  console.log("✅ CDP client ready");

  const ethBalance = await getEthBalance();
  const wethBal    = await getWethBalance();
  console.log(`💰 ETH: ${ethBalance.toFixed(6)} | WETH: ${wethBal.toFixed(6)}`);
  console.log(`🪙  Tracking: ${tokens.map(t => t.symbol).join(", ")}\n`);

  await sendAlert(
    `⚔️ <b>GUARDIAN CASCADE v10.0 — ONLINE</b>\n\n` +
    `👛 <code>${WALLET_ADDRESS}</code>\n` +
    `💰 ETH: ${ethBalance.toFixed(6)} (~$${(ethBalance * ETH_USD).toFixed(2)})\n` +
    `💎 WETH: ${wethBal.toFixed(6)} (~$${(wethBal * ETH_USD).toFixed(2)}) ← ready to trade\n` +
    `🪙 Watching: ${tokens.map(t => t.symbol).join(", ")}\n\n` +
    `🧠 <b>CASCADE ENGINE ACTIVE:</b>\n` +
    `   🌊 Sell tops → cascade into bottoms\n` +
    `   💵 $3 seed entry per token\n` +
    `   🐷 1% piggy skim per profitable trade\n` +
    `   🎰 2% lottery kept forever per token\n` +
    `   🔥 Deep zone = 50% bigger buys\n` +
    `   ⬆ Trailing sell waits for peak\n` +
    `   📉 Stop loss -8% after 2hrs\n\n` +
    `Send /help for all commands`
  );

  let cachedEth = ethBalance;

  // Independent Telegram loop — 3 second polling
  (async function telegramLoop() {
    while (true) {
      try { await checkTelegramCommands(cdpClient, cachedEth); } catch (e) {}
      await sleep(3000);
    }
  })();

  // Main trading loop — never exits
  while (true) {
    try {
      const eth  = await getEthBalance();
      const weth = await getWethBalance();
      cachedEth  = eth;
      cachedEthBalance  = eth;
      cachedWethBalance = weth;
      // Update balance cache for all tokens
      for (const t of tokens) {
        try { cachedBalances[t.symbol] = await getTokenBalance(t.address); } catch(e) { cachedBalances[t.symbol] = 0; }
      }

      console.log(`\n${"═".repeat(56)}`);
      console.log(`${new Date().toLocaleTimeString()} | ETH: ${eth.toFixed(6)} | WETH: ${weth.toFixed(6)} | Trades: ${tradeCount}`);
      console.log(`Tradeable: ${getTradeableEth(eth).toFixed(6)} ETH | Piggy: ${piggyBank.toFixed(6)} ETH (LOCKED)\n`);

      for (const token of tokens) {
        try { await processToken(cdpClient, token, eth); }
        catch (e) { console.log(`⚠️ Token error (${token.symbol}): ${e.message}`); }
        await sleep(4000);
      }

      await sendReport(eth);

      if (Date.now() - lastSaveTime > SAVE_INTERVAL) {
        await saveToGitHub();
      }

    } catch (e) {
      console.log(`⚠️ Main loop error: ${e.message}`);
      await sendAlert(`⚠️ <b>GUARDIAN ERROR</b>\n${e.message}\n\nBot continuing...`);
    }

    await sleep(INTERVAL);
  }
}

main().catch(e => {
  console.log(`💀 Fatal: ${e.message}`);
  setTimeout(() => main(), 30000);
});
