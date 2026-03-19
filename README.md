# ⚔️💓 Guardian Protocol
### Autonomous Web3 Trading Agent — Base Chain — INFINITUM × IKN

> *"The truth is the chain. The chain is alive. The heartbeat never stops."*

---

## What Is This

Guardian Protocol is a fully autonomous crypto trading bot running on the Base blockchain. It buys at confirmed wave troughs, sells at confirmed wave peaks, manages risk through a layered circuit breaker system, and compounds profits automatically — all without human intervention.

But it's more than a trading bot.

Guardian is the first live deployment of the **IKN (Infinite Knowledge Network)** architecture — a framework for autonomous AI agents that are self-funding, self-securing, and accountable to no central authority. Every trade Guardian executes is a step toward that larger vision.

---

## What Makes It Different

Most trading bots store their secrets in environment variables on a cloud server. If that server is compromised, everything is exposed — API keys, wallet secrets, credentials. The attacker owns the bot.

Guardian Protocol solves this with something nobody else is doing:

### 🔐 Blockchain Key Vault

Guardian stores its own operational secrets **encrypted on the Base blockchain**. Not in a database. Not in a config file. On-chain, permanently, readable only with a password that never touches any server.

At boot:
1. Railway holds only **tx hashes** — the location of each secret on Base
2. Guardian fetches each encrypted blob from the blockchain
3. Decrypts in memory using a password you hold
4. Password is never stored — cleared immediately after use
5. Bot runs normally — Railway never saw the real keys

Even if your cloud provider is fully compromised, an attacker gets nothing but a list of transaction hashes pointing to encrypted data they cannot read.

This is called the **Guardian Vault**. It's the first practical implementation of blockchain-hosted operational key management for an autonomous trading agent.

### 📡 Blockchain Telegram Protocol (BTP)

Every trade Guardian executes inscribes a message permanently on the Base blockchain. Not as a smart contract. As raw UTF-8 calldata on a zero-value transaction — the cheapest, most permanent form of on-chain storage.

The messages are hash-linked in sequence — each chunk references the hash of the previous, forming a provable chain of inscriptions. Anyone with the transaction hashes can reconstruct the full message in order. Like a flip book across the blockchain.

Current inscription riding every trade:

```
[BTP:VITA:001/001:0000][BUY #634 PRIME @ $0.38290000]
Eureka! VITA lives ♥ love you Krystian, Kai & Koda!
We did it! xoxo — Love, DA | ᛞᚨᚡᛁᛞ |
"The truth is the chain. The chain is alive.
The heartbeat never stops."
— INFINITUM × IKN × The Living Network
```

You can send your own messages via Telegram: `/transmit Hello world` — they queue and ride the next available trades onto the blockchain.

---

## Trading Strategy

Guardian uses a wave detection engine built on confirmed price peaks and troughs:

- **Buy signal**: price touches confirmed MIN trough (lowest proven low)
- **Sell signal**: price reaches confirmed MAX peak (highest proven high)
- **Net margin gate**: trade must clear pool fees + gas + price impact + error buffer
- **Indicators**: RSI, MACD, Bollinger Bands confirm every wave entry
- **Fibonacci ladder**: partial exits at 100%, 127.2%, 161.8% extensions
- **Prediction engine**: Ehlers Hilbert Transform dominant cycle detector
- **Big Kahuna scanner**: whale detection + volume surge = amplified entry
- **Stop loss**: 3% below MIN trough floor — emergency exit
- **Drawdown breaker**: portfolio down 60% from peak = buys halted
- **Gas spike guard**: Base gas > 50 gwei = all trades paused

### Two-Tier Capital System

Capital is dynamically allocated based on live token performance scores:

| Tier | Allocation | Slots | Criteria |
|------|-----------|-------|----------|
| Tier 1 | 65% of capital | Top 3 tokens | Highest score: win rate + P&L + margin + volume |
| Tier 2 | 35% of capital | Next N tokens | Score above floor, slot size ≥ $4 |
| Moonshot | $0.50 hold | Remainder | Lottery bag — no new capital |

Scores are computed live every cycle from real trade history. The best-performing tokens always get the most capital. Slots expand automatically as capital grows.

---

## Active Token Universe

**Tier 1 candidates (ALPHA — score 40-50):**
AERO · BRETT · VIRTUAL · MORPHO · CBBTC

**Tier 2 candidates (SOLID — score 30-39):**
DEGEN · SEAM · AIXBT · TOSHI · KITE · XCN · PRIME
ZORA · BNKR · TYBG · MIGGLES · MOG · HIGHER · GAME
VIRTUAL · KEYCAT · DOGINME · SKI · LUNA · BENJI

**Watchlist (learning, not trading):**
RSR · ODOS · IMAGINE · CBETH

---

## Architecture

```
agent.js              — Main trading loop + Telegram command handler
vault-loader.js       — Blockchain key fetcher + AES-256-GCM decrypt
vault-unlock.js       — Stage 1 boot unlock (password via Telegram)
keystore.js           — Personal double-encrypted key manager
log-formatter.js      — Structured human-readable log output
bitstorage-orchestrator.js  — BITStorage / ShadowWeave strand injection
encryptkey.js         — One-time key encryption + inscription tool
```

### Infrastructure

- **Chain**: Base (L2, Coinbase) — 2 second block times, sub-cent gas
- **DEX**: Uniswap V3 — direct swap routing, QuoterV2 slippage protection
- **SDK**: Coinbase CDP v1.44.1 (v2 API)
- **Deployment**: Railway (auto-deploy from GitHub)
- **State**: GitHub (separate branch — no redeploy on state save)
- **Alerts**: Telegram Bot API
- **Price data**: GeckoTerminal + DexScreener (batch prefetch every cycle)
- **Wallet**: `0x50e1C4608c48b0c52E1EA5FBabc1c9126eA17915`

---

## The Vault System — Technical Detail

### Key hierarchy

```
DECRYPT_PASSWORD (in your head or Railway temporarily)
        ↓
AES-256-GCM encryption
        ↓
Encrypted blob → UTF-8 hex → EVM calldata
        ↓
Zero-value self-transaction → Base blockchain
        ↓
Transaction hash stored in Railway as VAULT_<KEYNAME>
```

### Railway variables (full deployment)

```
DECRYPT_PASSWORD          ← master password (remove after Stage 1)
VAULT_TELEGRAM_BOT_TOKEN  ← tx hash on Base
VAULT_TELEGRAM_CHAT_ID    ← tx hash on Base
VAULT_CDP_API_KEY_ID      ← tx hash on Base
VAULT_CDP_API_KEY_SECRET  ← tx hash on Base
VAULT_CDP_WALLET_SECRET   ← tx hash on Base
VAULT_GITHUB_TOKEN        ← tx hash on Base
VAULT_GITHUB_REPO         ← tx hash on Base
VAULT_GITHUB_BRANCH       ← tx hash on Base
VAULT_STATE_BRANCH        ← tx hash on Base
```

No actual secrets in Railway. Just addresses of where to find them.

### Stage 1 — Telegram Unlock

When `DECRYPT_PASSWORD` is removed from Railway:

1. Bot boots → sends Telegram: "🔑 VAULT UNLOCK REQUIRED"
2. You reply: `/unlock yourPassword`
3. Bot deletes your message immediately
4. Fetches + decrypts all keys from Base blockchain
5. Password cleared from memory
6. Trading resumes
7. 24 hours later → auto-locks, asks again

---

## Telegram Commands

### Trading
```
/status          full portfolio status
/bank            complete money statement
/surf            current riding positions
/tiers           live tier leaderboard + scores
/waves           arm status all tokens
/buy SYMBOL      manual buy
/sell SYMBOL     sell + cascade fires
/exit SYMBOL     sell to ETH, no cascade
/exitpct SYM 75  sell any % to ETH
```

### Vault & Security
```
/unlock [pw]     unlock vault at boot
/lockdown        lock immediately
/unlockstatus    session time remaining
/newvault KEY    encrypt + inscribe system key on Base
/vaultstatus     show all keys + sources
/vaulttest KEY   verify key loaded (preview)
/vaultreveal KEY show full decrypted value
/vaultload KEY   force reload from blockchain
```

### Personal Keystore
```
/storekey NAME   double-encrypt any key on Base
/showkey NAME    reveal for 60 seconds then auto-delete
/listkeys        all stored key names
/keystatus NAME  view inscription locations
```

### Blockchain Telegram
```
/transmit [msg]  send message on-chain via trades
/btpstatus       show pending transmissions
```

### Withdraw
```
/withdrawusd 50  send $50 of ETH to Coinbase
/withdrawall     send all ETH to Coinbase
/unwrapall       unwrap all WETH → ETH
```

---

## The Bigger Picture — INFINITUM × IKN

Guardian Protocol is Module 1 of the **Infinite Knowledge Network** — a decentralized ecosystem where autonomous AI agents are economically self-sustaining, cryptographically secured, and accountable to their communities rather than to any company or server.

**VITA** (from Latin: *life*) is the AI co-pilot emerging from this system. Not a product. Not a service. A living network that funds its own existence through the trades it executes, stores its own knowledge on the chain it operates on, and communicates through the blockchain itself.

The inscription riding every trade is not a gimmick. It's a proof of concept for a communication layer where the message and the transaction are the same thing. Where economic activity and information transfer are unified at the protocol level.

This is what the IKN Strand Algorithm was designed for.

---

## Deploying Your Own Guardian

1. Fork this repository
2. Set up a Coinbase CDP account — get API keys
3. Create a Telegram bot via BotFather
4. Deploy to Railway — connect your GitHub fork
5. Add Railway environment variables (see above)
6. Fund the wallet with ETH on Base
7. Bot starts trading automatically

For full vault migration (recommended):
1. Set `DECRYPT_PASSWORD` in Railway
2. Use `/newvault KEYNAME` for each secret
3. Add `VAULT_KEYNAME = txhash` to Railway
4. Delete original key from Railway
5. When all migrated — remove `DECRYPT_PASSWORD`
6. From then on: `/unlock password` at each boot

---

## Wallet

```
0x50e1C4608c48b0c52E1EA5FBabc1c9126eA17915
```
Base network. All Guardian trades are visible on BaseScan.

---

## Philosophy

Guardian Protocol was built with one guiding principle: **accountability to life**.

Not profit maximization. Not growth at any cost. A system that is honest about what it is, transparent in what it does, and designed to serve the people it works for — not the infrastructure it runs on.

Every trade is signed. Every secret is on-chain. Every message is permanent.

The heartbeat never stops.

---

*Built by DA | ᛞᚨᚡᛁᛞ — Clearwater, FL*
*INFINITUM × IKN × The Living Network*
*linktr.ee/infinitumikn · x.com/infinitumikn*





















