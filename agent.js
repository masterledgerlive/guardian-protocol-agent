import { CdpClient } from "@coinbase/cdp-sdk";
import { createPublicClient, http, formatEther, parseEther } from "viem";
import { base } from "viem/chains";
import dotenv from "dotenv";
dotenv.config();

const WALLET_ADDRESS      = "0x50e1C4608c48b0c52E1EA5FBabc1c9126eA17915";
const TOSHI_ADDRESS       = "0xAC1Bd2486aAf3B5C0fc3Fd868558b082a531B2B4";
const WETH_ADDRESS        = "0x4200000000000000000000000000000000000006";
const SWAP_ROUTER         = "0x2626664c2603336E57B271c5C0b26F421741e481";
const INTERVAL            = 15000;
const GAS_RESERVE         = 0.0001;
const PIGGY_BANK_PERCENT  = 0.02;
const INITIAL_BUY_PERCENT = 0.45;
const BASE_TRADE_SIZE     = 0.05;
const MOMENTUM_THRESHOLD  = 0.02;
const STALL_TIME          = 45000;
const STALL_RANGE         = 0.005;
const FAKE_SPIKE_DROP     = 0.015;

const ERC20_ABI = [
  { name: "balanceOf", type: "function", stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }] },
  { name: "allowance", type: "function", stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }],
    outputs: [{ name: "", type: "uint256" }] },
];

const publicClient = createPublicClient({ chain: base, transport: http() });

let priceHistory   = [];
let lastTradePrice = null;
let entryPrice     = null;
let stallStart     = null;
let tradeCount     = 0;
let buyCount       = 0;
let sellCount      = 0;
let startEth       = null;
let piggyBank      = 0;
let totalSkimmed   = 0;

// ─── TELEGRAM ALERTS ──────────────────────────────
async function sendAlert(message) {
  try {
    const token  = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return;
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: "HTML" }),
    });
  } catch (e) {
    console.log("Telegram error:", e.message);
  }
}

function getTradeableEth(ethBalance) {
  return Math.max(ethBalance - GAS_RESERVE - piggyBank, 0);
}

async function getToshiPrice() {
  const res  = await fetch(
    "https://api.geckoterminal.com/api/v2/simple/networks/base/token_price/" + TOSHI_ADDRESS
  );
  const data = await res.json();
  const key  = TOSHI_ADDRESS.toLowerCase();
  const price = parseFloat(data?.data?.attributes?.token_prices?.[key]);
  return isNaN(price) ? null : price;
}

async function getEthBalance() {
  const bal = await publicClient.getBalance({ address: WALLET_ADDRESS });
  return parseFloat(formatEther(bal));
}

async function getToshiBalance() {
  return await publicClient.readContract({
    address: TOSHI_ADDRESS, abi: ERC20_ABI,
    functionName: "balanceOf", args: [WALLET_ADDRESS],
  });
}

function getMomentum() {
  if (priceHistory.length < 4) return { score: 0, direction: "neutral", accelerating: false, speed: 0 };
  const recent = priceHistory.slice(-4);
  const moves  = [];
  for (let i = 1; i < recent.length; i++) {
    moves.push((recent[i].price - recent[i-1].price) / recent[i-1].price);
  }
  const avgMove      = moves.reduce((a, b) => a + b, 0) / moves.length;
  const lastMove     = moves[moves.length - 1];
  const accelerating = Math.abs(lastMove) > Math.abs(moves[0]);
  const direction    = avgMove > 0.0001 ? "up" : avgMove < -0.0001 ? "down" : "neutral";
  return { score: avgMove, direction, accelerating, lastMove, speed: Math.abs(avgMove) };
}

function isStalling() {
  const recent = priceHistory.slice(-4);
  if (recent.length < 4) return false;
  const high  = Math.max(...recent.map(p => p.price));
  const low   = Math.min(...recent.map(p => p.price));
  const range = (high - low) / low;
  if (range < STALL_RANGE) {
    if (!stallStart) stallStart = Date.now();
    if (Date.now() - stallStart >= STALL_TIME) {
      console.log(`⏸  STALL — flat for ${((Date.now()-stallStart)/1000).toFixed(0)}s`);
      return true;
    }
  } else {
    stallStart = null;
  }
  return false;
}

function isFakeSpike(currentPrice) {
  if (priceHistory.length < 6) return false;
  const recent  = priceHistory.slice(-6);
  const peak    = Math.max(...recent.map(p => p.price));
  const peakIdx = recent.findIndex(p => p.price === peak);
  if (peakIdx > 0 && peakIdx < recent.length - 1) {
    const dropFromPeak = (peak - currentPrice) / peak;
    if (dropFromPeak >= FAKE_SPIKE_DROP) {
      console.log(`🚨 FAKE SPIKE — peaked $${peak.toFixed(8)}, dropped ${(dropFromPeak*100).toFixed(2)}%`);
      return true;
    }
  }
  return false;
}

function isInProfit(currentPrice) {
  if (!entryPrice) return true;
  return currentPrice > entryPrice * 1.005;
}

function getSellSize(momentum, isStall, isFake) {
  if (isFake || isStall)     return 0.20;
  if (momentum.accelerating) return 0.03;
  if (momentum.speed > 0.01) return 0.05;
  return 0.08;
}

function getBuySize(momentum, isStall, tradeableEth) {
  if (isStall)               return tradeableEth * 0.15;
  if (momentum.speed > 0.02) return tradeableEth * 0.03;
  return tradeableEth * BASE_TRADE_SIZE;
}

function encodeSwap(tokenIn, tokenOut, amountIn, recipient) {
  const p = (v, isAddr = false) => {
    const h = isAddr ? v.slice(2) : BigInt(v).toString(16);
    return h.padStart(64, "0");
  };
  return "0x04e45aaf"
    + p(tokenIn,   true)
    + p(tokenOut,  true)
    + p(10000)
    + p(recipient, true)
    + p(amountIn)
    + p(0)
    + p(0);
}

function encodeApprove(spender, amount) {
  return "0x095ea7b3"
    + spender.slice(2).padStart(64, "0")
    + amount.toString(16).padStart(64, "0");
}

async function executeBuy(cdp, ethAmount, reason) {
  const ethBalance   = await getEthBalance();
  const tradeableEth = getTradeableEth(ethBalance);

  if (ethAmount > tradeableEth) {
    ethAmount = tradeableEth * 0.90;
    console.log(`⚠️  Adjusted buy to ${ethAmount.toFixed(6)} ETH to protect reserves`);
  }
  if (ethAmount < 0.000010) {
    console.log(`⚠️  Buy amount too small — skipping`);
    return;
  }

  const amountIn = parseEther(ethAmount.toFixed(18));
  console.log(`\n🟢 BUY — ${reason}`);
  console.log(`   Amount: ${ethAmount.toFixed(6)} ETH`);

  try {
    const { transactionHash } = await cdp.evm.sendTransaction({
      address: WALLET_ADDRESS,
      network: "base",
      transaction: {
        to: SWAP_ROUTER,
        value: amountIn,
        data: encodeSwap(WETH_ADDRESS, TOSHI_ADDRESS, amountIn, WALLET_ADDRESS),
      },
    });
    buyCount++; tradeCount++;
    if (!entryPrice) entryPrice = priceHistory[priceHistory.length - 1]?.price;

    const currentPrice = priceHistory[priceHistory.length - 1]?.price;
    console.log(`✅ BUY #${buyCount}: https://basescan.org/tx/${transactionHash}`);

    await sendAlert(
      `⚔️ <b>GUARDIAN BOT — BUY #${buyCount}</b>\n\n` +
      `🟢 Bought TOSHI\n` +
      `💰 Spent: ${ethAmount.toFixed(6)} ETH\n` +
      `💲 Price: $${currentPrice?.toFixed(8)}\n` +
      `📊 Reason: ${reason}\n` +
      `🔗 <a href="https://basescan.org/tx/${transactionHash}">View on Basescan</a>`
    );
  } catch (e) {
    console.log(`❌ BUY FAILED: ${e.message}`);
    await sendAlert(`⚠️ <b>GUARDIAN BOT — BUY FAILED</b>\n${e.message}`);
  }
}

async function executeSell(cdp, sellPercent, reason, currentPrice) {
  if (!isInProfit(currentPrice)) {
    console.log(`🛑 SELL BLOCKED — not in profit (entry: $${entryPrice?.toFixed(8)}, now: $${currentPrice.toFixed(8)})`);
    return;
  }

  const toshiBalance = await getToshiBalance();
  if (toshiBalance === BigInt(0)) {
    console.log(`⚠️  No TOSHI to sell`);
    return;
  }

  const amountToSell = BigInt(Math.floor(Number(toshiBalance) * sellPercent));
  if (amountToSell === BigInt(0)) return;

  console.log(`\n🔴 SELL — ${reason}`);
  console.log(`   Selling ${(sellPercent * 100).toFixed(0)}% of TOSHI`);

  try {
    const allowance = await publicClient.readContract({
      address: TOSHI_ADDRESS, abi: ERC20_ABI,
      functionName: "allowance",
      args: [WALLET_ADDRESS, SWAP_ROUTER],
    });

    if (allowance < amountToSell) {
      console.log(`   Approving TOSHI...`);
      const { transactionHash: approveTx } = await cdp.evm.sendTransaction({
        address: WALLET_ADDRESS,
        network: "base",
        transaction: { to: TOSHI_ADDRESS, data: encodeApprove(SWAP_ROUTER, amountToSell) },
      });
      console.log(`   ✅ APPROVED: https://basescan.org/tx/${approveTx}`);
      await sendAlert(`🔑 <b>GUARDIAN BOT — TOSHI APPROVED</b>\nRouter approved to sell TOSHI\n🔗 <a href="https://basescan.org/tx/${approveTx}">View on Basescan</a>`);
      await new Promise(r => setTimeout(r, 8000));
    }

    const ethBefore = await getEthBalance();

    const { transactionHash } = await cdp.evm.sendTransaction({
      address: WALLET_ADDRESS,
      network: "base",
      transaction: {
        to: SWAP_ROUTER,
        data: encodeSwap(TOSHI_ADDRESS, WETH_ADDRESS, amountToSell, WALLET_ADDRESS),
      },
    });

    sellCount++; tradeCount++;
    console.log(`✅ SELL #${sellCount}: https://basescan.org/tx/${transactionHash}`);

    await new Promise(r => setTimeout(r, 5000));
    const ethAfter = await getEthBalance();
    const profit   = ethAfter - ethBefore;

    let piggyMsg = "";
    if (profit > 0) {
      const skim    = profit * PIGGY_BANK_PERCENT;
      piggyBank    += skim;
      totalSkimmed += skim;
      piggyMsg = `\n🐷 Piggy bank: +${skim.toFixed(6)} ETH (total: ${totalSkimmed.toFixed(6)} ETH)`;
      console.log(`🐷 PIGGY BANK: +${skim.toFixed(6)} ETH saved (total: ${totalSkimmed.toFixed(6)} ETH)`);
    }

    await sendAlert(
      `⚔️ <b>GUARDIAN BOT — SELL #${sellCount}</b>\n\n` +
      `🔴 Sold TOSHI\n` +
      `💰 Received: ~${profit > 0 ? profit.toFixed(6) : "calculating"} ETH\n` +
      `💲 Price: $${currentPrice.toFixed(8)}\n` +
      `📊 Reason: ${reason}` +
      piggyMsg + `\n` +
      `🔗 <a href="https://basescan.org/tx/${transactionHash}">View on Basescan</a>`
    );

  } catch (e) {
    console.log(`❌ SELL FAILED: ${e.message}`);
    await sendAlert(`⚠️ <b>GUARDIAN BOT — SELL FAILED</b>\n${e.message}`);
  }
}

async function main() {
  console.log("═══════════════════════════════════════════");
  console.log("⚔️   GUARDIAN SMART GRID BOT v3 — LIVE");
  console.log("═══════════════════════════════════════════");
  console.log(`👛  Wallet     : ${WALLET_ADDRESS}`);
  console.log(`🪙  Token      : TOSHI on Base`);
  console.log(`🧠  Mode       : Momentum-aware smart grid`);
  console.log(`⛽  Gas reserve: ${GAS_RESERVE} ETH always protected`);
  console.log(`🐷  Piggy bank : 2% of every profit saved`);
  console.log(`📐  Trade size : 5% base | grows at stalls`);
  console.log(`🎯  Trigger    : 2% move + momentum check`);
  console.log(`🛡️   Safety     : Never sell at a loss`);
  console.log(`📱  Alerts     : Telegram enabled`);
  console.log("═══════════════════════════════════════════\n");

  const cdp = new CdpClient({
    apiKeyId:     process.env.CDP_API_KEY_ID,
    apiKeySecret: process.env.CDP_API_KEY_SECRET,
    walletSecret: process.env.CDP_WALLET_SECRET,
  });

  const ethBalance   = await getEthBalance();
  const tradeableEth = getTradeableEth(ethBalance);
  startEth           = ethBalance;

  console.log(`💰 Total ETH     : ${ethBalance.toFixed(6)}`);
  console.log(`⛽ Gas reserve   : ${GAS_RESERVE} ETH locked`);
  console.log(`♻️  Tradeable ETH : ${tradeableEth.toFixed(6)} ETH\n`);

  await sendAlert(
    `⚔️ <b>GUARDIAN SMART GRID BOT v3 — STARTED</b>\n\n` +
    `👛 Wallet: <code>${WALLET_ADDRESS}</code>\n` +
    `💰 Total ETH: ${ethBalance.toFixed(6)}\n` +
    `♻️ Tradeable: ${tradeableEth.toFixed(6)} ETH\n` +
    `⛽ Gas reserve: ${GAS_RESERVE} ETH locked\n` +
    `🪙 Trading: TOSHI on Base\n` +
    `🎯 Trigger: 2% move | 5% trade size\n\n` +
    `Bot is live and watching every 15 seconds!`
  );

  console.log(`🚀 Initial buy — 45% of tradeable ETH into TOSHI...`);
  const initialEth = tradeableEth * INITIAL_BUY_PERCENT;
  await executeBuy(cdp, initialEth, "INITIAL POSITION — 45% tradeable ETH into TOSHI");

  lastTradePrice = await getToshiPrice();
  entryPrice     = lastTradePrice;
  console.log(`✅ Entry price: $${entryPrice?.toFixed(8)}`);
  console.log(`🤖 Watching every 15 seconds...\n`);

  await new Promise(r => setTimeout(r, 5000));

  while (true) {
    try {
      const [price, ethBalance] = await Promise.all([
        getToshiPrice(),
        getEthBalance(),
      ]);

      if (!price) {
        console.log("⏳ Price unavailable...");
        await new Promise(r => setTimeout(r, INTERVAL));
        continue;
      }

      priceHistory.push({ price, time: Date.now() });
      if (priceHistory.length > 20) priceHistory.shift();

      const tradeableEth = getTradeableEth(ethBalance);
      const momentum     = getMomentum();
      const stalling     = isStalling();
      const fakeSpike    = isFakeSpike(price);
      const change       = lastTradePrice ? (price - lastTradePrice) / lastTradePrice : 0;
      const pnl          = ((ethBalance - startEth) / startEth * 100).toFixed(2);

      console.log(`——————————————————————————————————————————`);
      console.log(`💲 TOSHI: $${price.toFixed(8)}`);
      console.log(`💰 Total ETH: ${ethBalance.toFixed(6)} | Tradeable: ${tradeableEth.toFixed(6)} | P&L: ${pnl}%`);
      console.log(`🐷 Piggy bank: ${piggyBank.toFixed(6)} ETH | ⛽ Gas: ${GAS_RESERVE} ETH`);
      console.log(`🧠 Momentum: ${momentum.direction} | Accel: ${momentum.accelerating} | Speed: ${(momentum.speed*100).toFixed(3)}%`);
      console.log(`📊 Trades: ${tradeCount} (${buyCount}B / ${sellCount}S) | Change: ${(change*100).toFixed(2)}%`);

      if (fakeSpike) {
        await executeSell(cdp, 0.20, "FAKE SPIKE — selling before dump", price);
        lastTradePrice = price;
      } else if (stalling && momentum.direction !== "down") {
        await executeSell(cdp, 0.20, "STALL AT HIGH — peak profit", price);
        lastTradePrice = price;
      } else if (momentum.direction === "up" && change >= MOMENTUM_THRESHOLD) {
        const sellSize = getSellSize(momentum, stalling, fakeSpike);
        await executeSell(cdp, sellSize, `UP ${(change*100).toFixed(2)}% — momentum sell`, price);
        lastTradePrice = price;
      } else if (momentum.direction === "down" && stalling) {
        const buyAmt = getBuySize(momentum, true, tradeableEth);
        await executeBuy(cdp, buyAmt, `BOTTOM STALL — confirmed dip buy`);
        lastTradePrice = price;
      } else if (momentum.direction === "down" && change <= -MOMENTUM_THRESHOLD) {
        const buyAmt = getBuySize(momentum, false, tradeableEth);
        await executeBuy(cdp, buyAmt, `DOWN ${(change*100).toFixed(2)}% — buying dip`);
        lastTradePrice = price;
      } else {
        if (momentum.direction === "up") {
          console.log(`⏸  Uptrend — holding for bigger move or stall`);
        } else if (momentum.direction === "down") {
          console.log(`⏸  Downtrend — waiting for stall or 2% drop`);
        } else {
          console.log(`⏸  Neutral — no action`);
        }
      }

    } catch (e) {
      console.log(`⚠️  ERROR: ${e.message}`);
      await sendAlert(`⚠️ <b>GUARDIAN BOT ERROR</b>\n${e.message}`);
    }

    await new Promise(r => setTimeout(r, INTERVAL));
  }
}

main().catch(console.error);
