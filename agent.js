import { CdpClient } from "@coinbase/cdp-sdk";
import { createPublicClient, http, formatEther, parseEther } from "viem";
import { base } from "viem/chains";
import dotenv from "dotenv";
dotenv.config();

// ═══════════════════════════════════════════════════
// GUARDIAN SMART GRID BOT v5
// - Fixed stall detector (no more false triggers)
// - 5 min cooldown between trades
// - Always keeps ETH reserve for gas + trading
// - Profit reinvestment when +10% gained
// - Sells TOSHI when up, buys when down
// - Never buys if ETH below minimum threshold
// ═══════════════════════════════════════════════════

const WALLET_ADDRESS     = "0x50e1C4608c48b0c52E1EA5FBabc1c9126eA17915";
const TOSHI_ADDRESS      = "0xAC1Bd2486aAf3B5C0fc3Fd868558b082a531B2B4";
const WETH_ADDRESS       = "0x4200000000000000000000000000000000000006";
const SWAP_ROUTER        = "0x2626664c2603336E57B271c5C0b26F421741e481";
const INTERVAL           = 20000;   // check every 20 seconds

// ─── RESERVE & SAFETY RULES ───────────────────────
const GAS_RESERVE        = 0.0002;  // always keep this ETH untouched
const MIN_ETH_TO_BUY     = 0.0005;  // minimum ETH needed before bot will buy
const PIGGY_PERCENT      = 0.02;    // 2% of each profit to piggy bank
const TRADE_SIZE         = 0.10;    // 10% of tradeable ETH per buy
const SELL_SIZE_NORMAL   = 0.08;    // sell 8% of TOSHI on normal up move
const SELL_SIZE_PEAK     = 0.15;    // sell 15% at confirmed peak
const TRIGGER_PCT        = 0.02;    // 2% price move to trigger trade
const COOLDOWN_MS        = 300000;  // 5 minutes between trades
const REINVEST_THRESHOLD = 0.10;    // reinvest when +10% profit

// ─── STALL SETTINGS (fixed) ───────────────────────
const STALL_SECONDS      = 120;     // must be flat for 2 full minutes
const STALL_RANGE        = 0.003;   // within 0.3% counts as flat
const MIN_READINGS_STALL = 8;       // need at least 8 readings before stall check

const ERC20_ABI = [
  { name: "balanceOf", type: "function", stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }] },
  { name: "allowance", type: "function", stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }],
    outputs: [{ name: "", type: "uint256" }] },
];

const publicClient = createPublicClient({ chain: base, transport: http() });

// ─── STATE ────────────────────────────────────────
let priceHistory    = [];
let lastTradePrice  = null;
let entryPrice      = null;
let lastTradeTime   = 0;
let tradeCount      = 0;
let buyCount        = 0;
let sellCount       = 0;
let startValue      = null;  // starting total value in ETH
let piggyBank       = 0;
let totalSkimmed    = 0;
let lastReportTime  = 0;

// ─── TELEGRAM ─────────────────────────────────────
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

// ─── PRICE & BALANCES ─────────────────────────────
async function getToshiPrice() {
  const res  = await fetch(
    "https://api.geckoterminal.com/api/v2/simple/networks/base/token_price/" + TOSHI_ADDRESS
  );
  const data = await res.json();
  const key  = TOSHI_ADDRESS.toLowerCase();
  const p    = parseFloat(data?.data?.attributes?.token_prices?.[key]);
  return isNaN(p) ? null : p;
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

function getTradeableEth(ethBalance) {
  return Math.max(ethBalance - GAS_RESERVE - piggyBank, 0);
}

// ─── MOMENTUM (fixed — needs real movement) ───────
function getMomentum() {
  if (priceHistory.length < 6) return { direction: "neutral", speed: 0, accelerating: false };
  const recent = priceHistory.slice(-6);
  const moves  = [];
  for (let i = 1; i < recent.length; i++) {
    moves.push((recent[i].price - recent[i-1].price) / recent[i-1].price);
  }
  const avg          = moves.reduce((a, b) => a + b, 0) / moves.length;
  const lastMove     = moves[moves.length - 1];
  const accelerating = Math.abs(lastMove) > Math.abs(moves[0]);
  const direction    = avg > 0.0002 ? "up" : avg < -0.0002 ? "down" : "neutral";
  return { direction, speed: Math.abs(avg), accelerating, avg };
}

// ─── STALL DETECTOR (fixed) ───────────────────────
function isConfirmedStall() {
  if (priceHistory.length < MIN_READINGS_STALL) return false;
  const recent   = priceHistory.slice(-MIN_READINGS_STALL);
  const high     = Math.max(...recent.map(p => p.price));
  const low      = Math.min(...recent.map(p => p.price));
  const range    = (high - low) / low;
  const timespan = recent[recent.length-1].time - recent[0].time;
  // must be flat AND have enough time passed
  const isFlat   = range < STALL_RANGE;
  const longEnough = timespan >= STALL_SECONDS * 1000;
  return isFlat && longEnough;
}

// ─── COOLDOWN CHECK ───────────────────────────────
function canTrade() {
  const elapsed = Date.now() - lastTradeTime;
  if (elapsed < COOLDOWN_MS) {
    const remaining = Math.ceil((COOLDOWN_MS - elapsed) / 1000);
    console.log(`⏳ Cooldown: ${remaining}s remaining before next trade`);
    return false;
  }
  return true;
}

// ─── PROFIT CHECK ─────────────────────────────────
function isInProfit(currentPrice) {
  if (!entryPrice) return true;
  return currentPrice >= entryPrice * 1.003; // at least 0.3% above entry
}

// ─── REINVESTMENT CHECK ───────────────────────────
async function checkReinvest(ethBalance, currentPrice) {
  if (!startValue) return;
  const toshiBal  = await getToshiBalance();
  const toshiEth  = (Number(toshiBal) / 1e18) * currentPrice / currentPrice;
  const totalNow  = ethBalance + (Number(toshiBal) / 1e18 * currentPrice / (1/currentPrice));
  const gain      = (ethBalance - startValue) / startValue;

  if (gain >= REINVEST_THRESHOLD) {
    const profit  = ethBalance - startValue;
    const skim    = profit * PIGGY_PERCENT;
    piggyBank    += skim;
    totalSkimmed += skim;
    startValue    = ethBalance; // reset baseline
    console.log(`\n🔄 REINVEST TRIGGER — +${(gain*100).toFixed(1)}% gained!`);
    console.log(`   Skimmed ${skim.toFixed(6)} ETH to piggy bank`);
    console.log(`   Total piggy bank: ${piggyBank.toFixed(6)} ETH`);
    await sendAlert(
      `🔄 <b>GUARDIAN — REINVEST TRIGGERED</b>\n\n` +
      `📈 Gained ${(gain*100).toFixed(1)}%\n` +
      `🐷 Skimmed ${skim.toFixed(6)} ETH to piggy bank\n` +
      `💰 Total saved: ${totalSkimmed.toFixed(6)} ETH\n` +
      `♻️ Funds recycled back into trading pot`
    );
  }
}

// ─── ENCODE HELPERS ───────────────────────────────
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

// ─── EXECUTE BUY ──────────────────────────────────
async function executeBuy(cdp, tradeableEth, reason, price) {
  // Safety — only buy if enough ETH available
  if (tradeableEth < MIN_ETH_TO_BUY) {
    console.log(`🛑 BUY BLOCKED — ETH too low (${tradeableEth.toFixed(6)} < ${MIN_ETH_TO_BUY} minimum)`);
    await sendAlert(`🛑 <b>BUY BLOCKED</b>\nNot enough ETH to trade safely\nCurrent: ${tradeableEth.toFixed(6)} ETH\nMinimum needed: ${MIN_ETH_TO_BUY} ETH`);
    return;
  }

  if (!canTrade()) return;

  const ethAmount = tradeableEth * TRADE_SIZE;
  const amountIn  = parseEther(ethAmount.toFixed(18));

  console.log(`\n🟢 BUY — ${reason}`);
  console.log(`   Spending: ${ethAmount.toFixed(6)} ETH`);
  console.log(`   Price: $${price.toFixed(8)}`);

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
    lastTradeTime  = Date.now();
    lastTradePrice = price;
    if (!entryPrice) entryPrice = price;

    console.log(`✅ BUY #${buyCount}: https://basescan.org/tx/${transactionHash}`);
    await sendAlert(
      `⚔️ <b>GUARDIAN — BUY #${buyCount}</b>\n\n` +
      `🟢 Bought TOSHI\n` +
      `💰 Spent: ${ethAmount.toFixed(6)} ETH\n` +
      `💲 Price: $${price.toFixed(8)}\n` +
      `📊 Reason: ${reason}\n` +
      `⏱️ Next trade in 5 mins\n` +
      `🔗 <a href="https://basescan.org/tx/${transactionHash}">Basescan</a>`
    );
  } catch (e) {
    console.log(`❌ BUY FAILED: ${e.message}`);
    await sendAlert(`⚠️ <b>BUY FAILED</b>\n${e.message}`);
  }
}

// ─── EXECUTE SELL ─────────────────────────────────
async function executeSell(cdp, sellPercent, reason, price) {
  if (!isInProfit(price)) {
    console.log(`🛑 SELL BLOCKED — price below entry (entry: $${entryPrice?.toFixed(8)}, now: $${price.toFixed(8)})`);
    return;
  }

  if (!canTrade()) return;

  const toshiBal = await getToshiBalance();
  if (toshiBal < BigInt("1000000000000000000")) {
    console.log(`⚠️ No TOSHI to sell`);
    return;
  }

  const amountToSell = BigInt(Math.floor(Number(toshiBal) * sellPercent));
  if (amountToSell === BigInt(0)) return;

  console.log(`\n🔴 SELL — ${reason}`);
  console.log(`   Selling ${(sellPercent*100).toFixed(0)}% of TOSHI @ $${price.toFixed(8)}`);

  try {
    const allowance = await publicClient.readContract({
      address: TOSHI_ADDRESS, abi: ERC20_ABI,
      functionName: "allowance", args: [WALLET_ADDRESS, SWAP_ROUTER],
    });

    if (allowance < amountToSell) {
      console.log(`   Approving TOSHI...`);
      const { transactionHash: approveTx } = await cdp.evm.sendTransaction({
        address: WALLET_ADDRESS, network: "base",
        transaction: { to: TOSHI_ADDRESS, data: encodeApprove(SWAP_ROUTER, amountToSell) },
      });
      console.log(`   ✅ Approved: https://basescan.org/tx/${approveTx}`);
      await new Promise(r => setTimeout(r, 8000));
    }

    const ethBefore = await getEthBalance();
    const { transactionHash } = await cdp.evm.sendTransaction({
      address: WALLET_ADDRESS, network: "base",
      transaction: {
        to: SWAP_ROUTER,
        data: encodeSwap(TOSHI_ADDRESS, WETH_ADDRESS, amountToSell, WALLET_ADDRESS),
      },
    });

    sellCount++; tradeCount++;
    lastTradeTime  = Date.now();
    lastTradePrice = price;

    await new Promise(r => setTimeout(r, 5000));
    const ethAfter = await getEthBalance();
    const profit   = ethAfter - ethBefore;

    let piggyMsg = "";
    if (profit > 0) {
      const skim    = profit * PIGGY_PERCENT;
      piggyBank    += skim;
      totalSkimmed += skim;
      piggyMsg = `\n🐷 +${skim.toFixed(6)} ETH to piggy bank (total: ${totalSkimmed.toFixed(6)} ETH)`;
    }

    console.log(`✅ SELL #${sellCount}: https://basescan.org/tx/${transactionHash}`);
    if (profit > 0) console.log(`💰 Profit: ${profit.toFixed(6)} ETH`);

    await sendAlert(
      `⚔️ <b>GUARDIAN — SELL #${sellCount}</b>\n\n` +
      `🔴 Sold TOSHI\n` +
      `💰 Received: ${profit > 0 ? profit.toFixed(6) : "~"} ETH\n` +
      `💲 Price: $${price.toFixed(8)}\n` +
      `📊 Reason: ${reason}` +
      piggyMsg + `\n` +
      `⏱️ Next trade in 5 mins\n` +
      `🔗 <a href="https://basescan.org/tx/${transactionHash}">Basescan</a>`
    );
  } catch (e) {
    console.log(`❌ SELL FAILED: ${e.message}`);
    await sendAlert(`⚠️ <b>SELL FAILED</b>\n${e.message}`);
  }
}

// ─── 30 MIN STATUS REPORT ─────────────────────────
async function sendStatusReport(ethBalance, toshiBal, price) {
  const now = Date.now();
  if (now - lastReportTime < 1800000) return; // every 30 mins
  lastReportTime = now;

  const toshiUsd   = (Number(toshiBal) / 1e18 * price).toFixed(2);
  const totalUsd   = (ethBalance * (price / price) + parseFloat(toshiUsd)).toFixed(2);
  const tradeableEth = getTradeableEth(ethBalance);
  const cooldownLeft = Math.max(0, Math.ceil((COOLDOWN_MS - (now - lastTradeTime)) / 1000));

  await sendAlert(
    `📊 <b>GUARDIAN — 30 MIN REPORT</b>\n\n` +
    `💲 TOSHI: $${price.toFixed(8)}\n` +
    `💰 ETH: ${ethBalance.toFixed(6)} ($${(ethBalance * 1943).toFixed(2)})\n` +
    `🪙 TOSHI: ${(Number(toshiBal)/1e18).toFixed(0)} ($${toshiUsd})\n` +
    `♻️ Tradeable ETH: ${tradeableEth.toFixed(6)}\n` +
    `🐷 Piggy bank: ${piggyBank.toFixed(6)} ETH\n` +
    `📈 Trades: ${tradeCount} (${buyCount}B / ${sellCount}S)\n` +
    `⏱️ Cooldown left: ${cooldownLeft}s\n` +
    `🔗 <a href="https://basescan.org/address/${WALLET_ADDRESS}">View wallet</a>`
  );
}

// ─── MAIN ─────────────────────────────────────────
async function main() {
  console.log("═══════════════════════════════════════════");
  console.log("⚔️   GUARDIAN SMART GRID BOT v5 — LIVE");
  console.log("═══════════════════════════════════════════");
  console.log(`👛  Wallet      : ${WALLET_ADDRESS}`);
  console.log(`🪙  Token       : TOSHI on Base`);
  console.log(`⛽  Gas reserve : ${GAS_RESERVE} ETH locked`);
  console.log(`🛡️   Min ETH     : ${MIN_ETH_TO_BUY} ETH before buying`);
  console.log(`⏱️   Cooldown    : 5 mins between trades`);
  console.log(`🐷  Piggy bank  : 2% of profits saved`);
  console.log(`🔄  Reinvest    : at +10% gain`);
  console.log(`📱  Alerts      : Telegram enabled`);
  console.log("═══════════════════════════════════════════\n");

  const cdp = new CdpClient({
    apiKeyId:     process.env.CDP_API_KEY_ID,
    apiKeySecret: process.env.CDP_API_KEY_SECRET,
    walletSecret: process.env.CDP_WALLET_SECRET,
  });

  const ethBalance   = await getEthBalance();
  const toshiBal     = await getToshiBalance();
  const price        = await getToshiPrice();
  const tradeableEth = getTradeableEth(ethBalance);
  const toshiUsd     = price ? (Number(toshiBal) / 1e18 * price).toFixed(2) : "?";
  const hasToshi     = toshiBal >= BigInt("1000000000000000000");

  startValue     = ethBalance;
  lastTradePrice = price;
  entryPrice     = price;

  console.log(`💰 ETH balance  : ${ethBalance.toFixed(6)}`);
  console.log(`♻️  Tradeable    : ${tradeableEth.toFixed(6)} ETH`);
  console.log(`🪙  TOSHI held   : ${hasToshi ? "$" + toshiUsd : "NONE"}`);
  console.log(`💲 TOSHI price  : $${price?.toFixed(8)}\n`);

  await sendAlert(
    `⚔️ <b>GUARDIAN BOT v5 — STARTED</b>\n\n` +
    `👛 Wallet: <code>${WALLET_ADDRESS}</code>\n` +
    `💰 ETH: ${ethBalance.toFixed(6)}\n` +
    `🪙 TOSHI: ${hasToshi ? "$" + toshiUsd : "none"}\n` +
    `♻️ Tradeable: ${tradeableEth.toFixed(6)} ETH\n` +
    `💲 TOSHI price: $${price?.toFixed(8)}\n` +
    `⛽ Gas reserve: ${GAS_RESERVE} ETH locked\n` +
    `🛡️ Min ETH to trade: ${MIN_ETH_TO_BUY}\n` +
    `⏱️ 5 min cooldown between trades\n\n` +
    `${hasToshi ? "✅ TOSHI detected — watching market" : "⚠️ No TOSHI — will buy on first dip"}\n` +
    `Bot watching every 20 seconds!`
  );

  if (!hasToshi && tradeableEth >= MIN_ETH_TO_BUY) {
    console.log(`🚀 No TOSHI found — buying initial position...`);
    await executeBuy(cdp, tradeableEth, "INITIAL BUY — no TOSHI held", price);
  } else {
    console.log(`✅ TOSHI already held — watching for 2% moves...\n`);
  }

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
      if (priceHistory.length > 30) priceHistory.shift();

      const tradeableEth = getTradeableEth(ethBalance);
      const momentum     = getMomentum();
      const stalling     = isConfirmedStall();
      const change       = lastTradePrice ? (price - lastTradePrice) / lastTradePrice : 0;
      const toshiBal     = await getToshiBalance();
      const toshiUsd     = (Number(toshiBal) / 1e18 * price).toFixed(2);
      const totalUsd     = ((ethBalance * 1943) + parseFloat(toshiUsd)).toFixed(2);
      const cooldownLeft = Math.max(0, Math.ceil((COOLDOWN_MS - (Date.now() - lastTradeTime)) / 1000));

      console.log(`——————————————————————————————————————————`);
      console.log(`💲 TOSHI: $${price.toFixed(8)} | Change: ${(change*100).toFixed(2)}%`);
      console.log(`💰 ETH: ${ethBalance.toFixed(6)} | Tradeable: ${tradeableEth.toFixed(6)}`);
      console.log(`🪙 TOSHI: $${toshiUsd} | Total: ~$${totalUsd}`);
      console.log(`🧠 Momentum: ${momentum.direction} | Speed: ${(momentum.speed*100).toFixed(3)}%`);
      console.log(`📊 Trades: ${tradeCount} (${buyCount}B/${sellCount}S) | 🐷 ${piggyBank.toFixed(6)} ETH`);
      console.log(`⏱️  Cooldown: ${cooldownLeft > 0 ? cooldownLeft + "s" : "READY"}`);

      await checkReinvest(ethBalance, price);
      await sendStatusReport(ethBalance, toshiBal, price);

      // ── SELL LOGIC — price went UP 2% ──────────
      if (change >= TRIGGER_PCT && momentum.direction === "up") {
        if (stalling) {
          // stalling at top — bigger sell
          await executeSell(cdp, SELL_SIZE_PEAK, `PEAK STALL +${(change*100).toFixed(2)}% — taking bigger profit`, price);
        } else if (momentum.accelerating) {
          // still climbing fast — tiny skim only
          await executeSell(cdp, 0.03, `CLIMBING +${(change*100).toFixed(2)}% — tiny skim`, price);
        } else {
          // normal up move — standard sell
          await executeSell(cdp, SELL_SIZE_NORMAL, `UP +${(change*100).toFixed(2)}% — taking profit`, price);
        }

      // ── BUY LOGIC — price went DOWN 2% ─────────
      } else if (change <= -TRIGGER_PCT && momentum.direction === "down") {
        if (tradeableEth < MIN_ETH_TO_BUY) {
          console.log(`🛑 BUY SKIPPED — ETH below minimum (${tradeableEth.toFixed(6)} ETH)`);
        } else if (stalling) {
          // confirmed bottom stall — buy more
          await executeBuy(cdp, tradeableEth, `BOTTOM STALL ${(change*100).toFixed(2)}% — confirmed dip`, price);
        } else {
          // normal dip — standard buy
          await executeBuy(cdp, tradeableEth, `DIP ${(change*100).toFixed(2)}% — buying`, price);
        }

      } else {
        if (momentum.direction === "up")   console.log(`⏸  Uptrend — waiting for 2% trigger`);
        if (momentum.direction === "down") console.log(`⏸  Downtrend — waiting for 2% trigger`);
        if (momentum.direction === "neutral") console.log(`⏸  Neutral — no action`);
      }

    } catch (e) {
      console.log(`⚠️  ERROR: ${e.message}`);
      await sendAlert(`⚠️ <b>GUARDIAN ERROR</b>\n${e.message}`);
    }

    await new Promise(r => setTimeout(r, INTERVAL));
  }
}

main().catch(console.error);
