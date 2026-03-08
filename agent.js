import { CdpClient } from "@coinbase/cdp-sdk";
import { createPublicClient, http, formatEther, parseEther } from "viem";
import { base } from "viem/chains";
import dotenv from "dotenv";
dotenv.config();

// ═══════════════════════════════════════════════
// GUARDIAN GRID BOT — REAL TRADES ON BASE MAINNET
// Strategy: Skim highs and lows on TOSHI/ETH
// 10% position size | 2% price trigger
// Buys dips, sells pumps, always leaves some behind
// ═══════════════════════════════════════════════

const WALLET_ADDRESS = "0x50e1C4608c48b0c52E1EA5FBabc1c9126eA17915";
const TOSHI_ADDRESS  = "0xAC1Bd2486aAf3B5C0fc3Fd868558b082a531B2B4";
const WETH_ADDRESS   = "0x4200000000000000000000000000000000000006";
const SWAP_ROUTER    = "0x2626664c2603336E57B271c5C0b26F421741e481";
const TRADE_PERCENT  = 0.10;   // use 10% of balance per trade
const TRIGGER        = 0.02;   // fire when price moves 2%
const INTERVAL       = 30000;  // check every 30 seconds

const ERC20_ABI = [
  { name: "balanceOf",  type: "function", stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }] },
  { name: "allowance",  type: "function", stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }],
    outputs: [{ name: "", type: "uint256" }] },
];

const publicClient = createPublicClient({ chain: base, transport: http() });

let lastPrice  = null;
let tradeCount = 0;
let buyCount   = 0;
let sellCount  = 0;
let startEth   = null;

// ─── GET TOSHI PRICE IN USD ───────────────────────
async function getToshiPrice() {
  const res  = await fetch(
    "https://api.geckoterminal.com/api/v2/simple/networks/base/token_price/" + TOSHI_ADDRESS
  );
  const data = await res.json();
  const key  = TOSHI_ADDRESS.toLowerCase();
  const price = parseFloat(data?.data?.attributes?.token_prices?.[key]);
  return isNaN(price) ? null : price;
}

// ─── GET ETH BALANCE ──────────────────────────────
async function getEthBalance() {
  const bal = await publicClient.getBalance({ address: WALLET_ADDRESS });
  return parseFloat(formatEther(bal));
}

// ─── GET TOSHI BALANCE ────────────────────────────
async function getToshiBalance() {
  const bal = await publicClient.readContract({
    address: TOSHI_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [WALLET_ADDRESS],
  });
  return bal; // BigInt
}

// ─── ENCODE UNISWAP SWAP ──────────────────────────
function encodeSwap(tokenIn, tokenOut, amountIn, recipient) {
  const selector = "0x04e45aaf";
  const p = (v, isAddr = false) => {
    const h = isAddr ? v.slice(2) : BigInt(v).toString(16);
    return h.padStart(64, "0");
  };
  return selector
    + p(tokenIn,   true)
    + p(tokenOut,  true)
    + p(10000)              // 1% fee tier
    + p(recipient, true)
    + p(amountIn)
    + p(0)                  // amountOutMinimum (no slippage protection for now)
    + p(0);                 // sqrtPriceLimitX96
}

// ─── ENCODE ERC20 APPROVE ─────────────────────────
function encodeApprove(spender, amount) {
  return "0x095ea7b3"
    + spender.slice(2).padStart(64, "0")
    + amount.toString(16).padStart(64, "0");
}

// ─── BUY TOSHI WITH ETH ───────────────────────────
async function buyToshi(cdp, ethBalance, price) {
  const ethToSpend = ethBalance * TRADE_PERCENT;
  const amountIn   = parseEther(ethToSpend.toFixed(18));

  console.log(`\n🟢 BUY SIGNAL`);
  console.log(`   Spending: ${ethToSpend.toFixed(6)} ETH`);
  console.log(`   TOSHI price: $${price.toFixed(8)}`);
  console.log(`   Submitting real transaction to Base mainnet...`);

  try {
    const { transactionHash } = await cdp.evm.sendTransaction({
      address: WALLET_ADDRESS,
      network: "base-mainnet",
      transaction: {
        to: SWAP_ROUTER,
        value: amountIn,
        data: encodeSwap(WETH_ADDRESS, TOSHI_ADDRESS, amountIn, WALLET_ADDRESS),
      },
    });
    buyCount++;
    tradeCount++;
    console.log(`✅ BUY EXECUTED — tx ${tradeCount}`);
    console.log(`   https://basescan.org/tx/${transactionHash}`);
  } catch (e) {
    console.log(`❌ BUY FAILED: ${e.message}`);
  }
}

// ─── SELL TOSHI FOR ETH ───────────────────────────
async function sellToshi(cdp, price) {
  const toshiBalance = await getToshiBalance();

  if (toshiBalance === BigInt(0)) {
    console.log(`⚠️  SELL SIGNAL but no TOSHI held yet — waiting for first buy`);
    return;
  }

  const amountToSell = toshiBalance / BigInt(10); // sell 10% of TOSHI held

  console.log(`\n🔴 SELL SIGNAL`);
  console.log(`   Selling 10% of TOSHI holdings`);
  console.log(`   TOSHI price: $${price.toFixed(8)}`);
  console.log(`   Checking approval...`);

  try {
    // Step 1 — approve router if needed
    const allowance = await publicClient.readContract({
      address: TOSHI_ADDRESS,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [WALLET_ADDRESS, SWAP_ROUTER],
    });

    if (allowance < amountToSell) {
      console.log(`   Approving TOSHI for swap router...`);
      const { transactionHash: approveTx } = await cdp.evm.sendTransaction({
        address: WALLET_ADDRESS,
        network: "base-mainnet",
        transaction: {
          to: TOSHI_ADDRESS,
          data: encodeApprove(SWAP_ROUTER, amountToSell),
        },
      });
      console.log(`   ✅ APPROVED: https://basescan.org/tx/${approveTx}`);
      console.log(`   Waiting 8 seconds for approval to confirm...`);
      await new Promise(r => setTimeout(r, 8000));
    } else {
      console.log(`   Approval already set — proceeding to sell`);
    }

    // Step 2 — execute sell swap TOSHI → WETH
    const { transactionHash } = await cdp.evm.sendTransaction({
      address: WALLET_ADDRESS,
      network: "base-mainnet",
      transaction: {
        to: SWAP_ROUTER,
        data: encodeSwap(TOSHI_ADDRESS, WETH_ADDRESS, amountToSell, WALLET_ADDRESS),
      },
    });
    sellCount++;
    tradeCount++;
    console.log(`✅ SELL EXECUTED — tx ${tradeCount}`);
    console.log(`   https://basescan.org/tx/${transactionHash}`);
  } catch (e) {
    console.log(`❌ SELL FAILED: ${e.message}`);
  }
}

// ─── MAIN LOOP ────────────────────────────────────
async function main() {
  console.log("═══════════════════════════════════════");
  console.log("⚔️   GUARDIAN GRID BOT — LIVE ON BASE");
  console.log("═══════════════════════════════════════");
  console.log(`👛  Wallet : ${WALLET_ADDRESS}`);
  console.log(`🪙  Token  : TOSHI on Base`);
  console.log(`📐  Size   : 10% per trade`);
  console.log(`🎯  Trigger: 2% price move`);
  console.log(`⏱️   Interval: every 30 seconds`);
  console.log("═══════════════════════════════════════\n");

  const cdp = new CdpClient({
    apiKeyId:     process.env.CDP_API_KEY_ID,
    apiKeySecret: process.env.CDP_API_KEY_SECRET,
    walletSecret: process.env.CDP_WALLET_SECRET,
  });

  startEth = await getEthBalance();
  console.log(`💰 Starting ETH balance: ${startEth.toFixed(6)} ETH\n`);
  console.log(`🤖 Bot is running — watching TOSHI price every 30 seconds...\n`);

  while (true) {
    try {
      const [price, ethBalance] = await Promise.all([
        getToshiPrice(),
        getEthBalance(),
      ]);

      if (!price) {
        console.log("⏳ Could not fetch price — retrying in 30s...");
        await new Promise(r => setTimeout(r, INTERVAL));
        continue;
      }

      const pnl = ((ethBalance - startEth) / startEth * 100).toFixed(2);
      console.log(`——————————————————————————————————————`);
      console.log(`💲 TOSHI: $${price.toFixed(8)}`);
      console.log(`💰 ETH Balance: ${ethBalance.toFixed(6)}`);
      console.log(`📊 Trades: ${tradeCount} (${buyCount} buys / ${sellCount} sells)`);
      console.log(`📈 P&L vs start: ${pnl}%`);

      if (lastPrice === null) {
        lastPrice = price;
        console.log(`🎯 Starting price locked at $${price.toFixed(8)}`);
      } else {
        const change = (price - lastPrice) / lastPrice;
        console.log(`📉📈 Change from last trade: ${(change * 100).toFixed(2)}%`);

        if (change >= TRIGGER) {
          console.log(`📈 +${(change * 100).toFixed(2)}% PUMP — skimming profit`);
          await sellToshi(cdp, price);
          lastPrice = price;
        } else if (change <= -TRIGGER) {
          console.log(`📉 ${(change * 100).toFixed(2)}% DIP — buying the dip`);
          await buyToshi(cdp, ethBalance, price);
          lastPrice = price;
        } else {
          console.log(`⏸  Waiting for 2% trigger...`);
        }
      }
    } catch (e) {
      console.log(`⚠️  ERROR: ${e.message}`);
    }

    await new Promise(r => setTimeout(r, INTERVAL));
  }
}

main().catch(console.error);
