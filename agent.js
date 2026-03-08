import { CdpClient } from "@coinbase/cdp-sdk";
import { createPublicClient, http, formatEther, parseEther } from "viem";
import { base } from "viem/chains";
import dotenv from "dotenv";
dotenv.config();

const WALLET_ADDRESS = "0x50e1C4608c48b0c52E1EA5FBabc1c9126eA17915";
const TOSHI_ADDRESS  = "0xAC1Bd2486aAf3B5C0fc3Fd868558b082a531B2B4";
const WETH_ADDRESS   = "0x4200000000000000000000000000000000000006";
const SWAP_ROUTER    = "0x2626664c2603336E57B271c5C0b26F421741e481";
const INTERVAL       = 15000;

const INITIAL_BUY_PERCENT = 0.50;
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
let lastSpikeHigh  = null;
let tradeCount     = 0;
let buyCount       = 0;
let sellCount      = 0;
let startEth       = null;
let initialBuyDone = false;

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

function isStalling(currentPrice) {
  const recent = priceHistory.slice(-4);
  if (recent.length < 4) return false;
  const high  = Math.max(...recent.map(p => p.price));
  const low   = Math.min(...recent.map(p => p.price));
  const range = (high - low) / low;
  if (range < STALL_RANGE) {
    if (!stallStart) stallStart = Date.now();
    if (Date.now() - stallStart >= STALL_TIME) {
      console.log(`⏸  STALL DETECTED — price flat for ${((Date.now()-stallStart)/1000).toFixed(0)}s`);
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
      console.log(`🚨 FAKE SPIKE — peaked $${peak.toFixed(8)}, now dropping`);
      lastSpikeHigh = peak;
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
  if (isFake || isStall)          return 0.20;
  if (momentum.accelerating)      return 0.03;
  if (momentum.speed > 0.01)      return 0.05;
  return 0.08;
}

function getBuySize(momentum, isStall, ethBalance) {
  if (isStall)                    return ethBalance * 0.15;
  if (momentum.speed > 0.02)      return ethBalance * 0.03;
  return ethBalance * BASE_TRADE_SIZE;
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
    console.log(`✅ BUY #${buyCount}: https://basescan.org/tx/${transactionHash}`);
  } catch (e) {
    console.log(`❌ BUY FAILED: ${e.message}`);
  }
}

async function executeSell(cdp, sellPercent, reason, currentPrice) {
  if (!isInProfit(currentPrice)) {
    console.log(`🛑 SELL BLOCKED — not in profit yet (entry: $${entryPrice?.toFixed(8)}, now: $${currentPrice.toFixed(8)})`);
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
      await new Promise(r => setTimeout(r, 8000));
    }
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
  } catch (e) {
    console.log(`❌ SELL FAILED: ${e.message}`);
  }
}

async function main() {
  console.log("═══════════════════════════════════════════");
  console.log("⚔️   GUARDIAN SMART GRID BOT — LIVE BASE");
  console.log("═══════════════════════════════════════════");
  console.log(`👛  Wallet  : ${WALLET_ADDRESS}`);
  console.log(`🪙  Token   : TOSHI on Base`);
  console.log(`🧠  Mode    : Momentum-aware smart grid`);
  console.log(`📐  Size    : 5% base | grows at stalls`);
  console.log(`🎯  Trigger : 2% move + momentum check`);
  console.log(`🛡️   Safety  : Never sell at a loss`);
  console.log("═══════════════════════════════════════════\n");

  const cdp = new CdpClient({
    apiKeyId:     process.env.CDP_API_KEY_ID,
    apiKeySecret: process.env.CDP_API_KEY_SECRET,
    walletSecret: process.env.CDP_WALLET_SECRET,
  });

  startEth = await getEthBalance();
  console.log(`💰 Starting ETH: ${startEth.toFixed(6)}\n`);
  console.log(`🚀 Initial 50% buy — splitting ETH/TOSHI to trade both directions...`);

  const initialEth = startEth * INITIAL_BUY_PERCENT;
  await executeBuy(cdp, initialEth, "INITIAL POSITION — 50% ETH into TOSHI");
  initialBuyDone = true;
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

      const momentum  = getMomentum();
      const stalling  = isStalling(price);
      const fakeSpike = isFakeSpike(price);
      const change    = lastTradePrice ? (price - lastTradePrice) / lastTradePrice : 0;
      const pnl       = ((ethBalance - startEth) / startEth * 100).toFixed(2);

      console.log(`——————————————————————————————————————————`);
      console.log(`💲 TOSHI: $${price.toFixed(8)}`);
      console.log(`💰 ETH: ${ethBalance.toFixed(6)} | P&L: ${pnl}%`);
      console.log(`🧠 Momentum: ${momentum.direction} | Accel: ${momentum.accelerating} | Speed: ${(momentum.speed*100).toFixed(3)}%`);
      console.log(`📊 Trades: ${tradeCount} (${buyCount}B / ${sellCount}S) | Change: ${(change*100).toFixed(2)}%`);

      if (momentum.direction === "up" || fakeSpike || stalling) {
        if (fakeSpike) {
          await executeSell(cdp, 0.20, "FAKE SPIKE — selling before dump", price);
          lastTradePrice = price;
        } else if (stalling && momentum.direction !== "down") {
          await executeSell(cdp, 0.20, "STALL AT HIGH — peak profit", price);
          lastTradePrice = price;
        } else if (change >= MOMENTUM_THRESHOLD) {
          const sellSize = getSellSize(momentum, stalling, fakeSpike);
          await executeSell(cdp, sellSize, `UP ${(change*100).toFixed(2)}% — momentum sell`, price);
          lastTradePrice = price;
        } else {
          console.log(`⏸  Uptrend — holding, waiting for bigger move or stall`);
        }
      } else if (momentum.direction === "down") {
        if (stalling) {
          const buyAmt = getBuySize(momentum, true, ethBalance);
          await executeBuy(cdp, buyAmt, `BOTTOM STALL — confirmed dip buy`);
          lastTradePrice = price;
        } else if (change <= -MOMENTUM_THRESHOLD) {
          const buyAmt = getBuySize(momentum, false, ethBalance);
          await executeBuy(cdp, buyAmt, `DOWN ${(change*100).toFixed(2)}% — buying dip`);
          lastTradePrice = price;
        } else {
          console.log(`⏸  Downtrend — waiting for stall or bigger drop`);
        }
      } else {
        console.log(`⏸  Neutral — no action`);
      }

    } catch (e) {
      console.log(`⚠️  ERROR: ${e.message}`);
    }

    await new Promise(r => setTimeout(r, INTERVAL));
  }
}

main().catch(console.error);
