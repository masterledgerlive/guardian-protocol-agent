# ⚔️💓 Guardian Protocol
### Autonomous Web3 Trading Agent — Base Chain — INFINITUM × IKN

> *"The truth is the chain. The chain is alive. The heartbeat never stops."*

---

## What Is This

Guardian Protocol is a fully autonomous crypto trading bot running on the Base blockchain. It buys at confirmed wave troughs, sells at confirmed wave peaks, manages risk through a layered circuit breaker system, and compounds profits automatically — all without human intervention.

But it's more than a trading bot.

Guardian is the first live deployment of the **IKN (Infinite Knowledge Network)** architecture — a framework for autonomous AI agents that are self-funding, self-securing, and accountable to no central authority. Every trade Guardian executes is a step toward that larger vision.

### Where this lives (one project)

**This GitHub repo is the live trader.** Telegram "Guardian Protocol bot" is this process. Do not split the dedication letter / hitch / fill-honesty work into other repos.

| Place | What it is |
|---|---|
| **This repo** (`masterledgerlive/guardian-protocol-agent`) | Uniswap bot, vault, Telegram, UTF-8 `§$STORE§` hitch, `/prove` |
| **Railway `industrious-tranquility` → `guardian-protocol-agent`** | Production. Auto-deploys GitHub **`main`**. Domain `guardian-protocol-agent-production.up.railway.app` |
| **`masterledgerlive/StorageToken`** | Hitch / `$STORE` notes + a storage service. The agent-genesis brief landed here. **Not** the trader |
| **Railway `industrious-tranquility` → `StorageToken`** | That storage service, sitting next to Guardian. Ideas belong here in this bot, not a second trader |
| **Railway `generous-solace` → `coinbase-agent`** | Older Coinbase + Telegram helper. Not Guardian |

The letter to Krystian, Kai & Koda is **true** only when Basescan **Input Data → View as UTF-8** shows `§$STORE§ Eureka! VITA lives`. Telegram text next to a swap is not proof. Live KEYCAT sell [`0x5c0a93e4…`](https://basescan.org/tx/0x5c0a93e4707a4dcf49afd4c785cb2829bce11ed026e08ba08435272d19122adf) is a real KEYCAT→WETH fill (228-byte `exactInputSingle`) with **no trailer**. After this code is on `main`, leftover-covered swaps hitch the letter, or Telegram **`/prove`** writes a dedicated **0-ETH** self-tx. Hitch is skipped when leftover cannot pay — never lose money to insert storage.

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

### 📡 On-chain letter (UTF-8 hitch) vs BTP queue

The dedication is **UTF-8 after a real leftover swap**, or a dedicated **0-ETH** self-tx (`/prove`). Uniswap ignores the trailer; Basescan **Input Data → View as UTF-8** shows `§$STORE§ Eureka! VITA lives ♥ love you Krystian, Kai & Koda! …`. Telegram 💌 only if those bytes were actually sent.

`/transmit` still **queues** BTP chunks for later leftover-covered swaps. A queued message is not a mined letter. Thin wallets / BTP auto-suspend send **plain** 228-byte swaps — the KEYCAT surf report that printed the letter next to [`0x5c0a93e4…`](https://basescan.org/tx/0x5c0a93e4707a4dcf49afd4c785cb2829bce11ed026e08ba08435272d19122adf) was that lie. This code stops it.

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
- **Lose-zero gate** (opt-in Railway flags): block new buys (auto, cascade, ripple, operator) unless leftover covers a short `§$STORE§` hitch (1×) and there is a clear edge — see below. Hitch inject cost prefers live Base `GasPriceOracle.getL1Fee` (predeploy `0x420000000000000000000000000000000000000F`) with L2 calldata-gas fallback. The hitch is **UTF-8 in the swap calldata** (Basescan Input Data → View as UTF-8), independent of BTP auto-suspend. Telegram `/prove` writes the same letter on a dedicated 0-ETH self-tx when there is no leftover swap. Telegram only claims the letter when those bytes are actually on the tx. Operator /buy is lossy only if `ALLOW_LOSSY_OPERATOR_BUY=yes`
- **Sell floor (always on)**: sell when leftover after fair exit + fees is profitable. Hitch Eureka on the way out only if leftover also covers `HITCH_COST_MULT` × hitch (default **2×**). If leftover covers the wave but not hitch, **plain sale** (letter skipped) so we still lock profit. Hold only when leftover after fees is ≤ 0 (the trade itself would lose). Piggy dust is never sold. Only exception for a losing sell: `MANUAL SELL (operator)` + `ALLOW_LOSSY_OPERATOR_SELL=yes`
- **PRICE_INSANE** (always on, before hitch / minOut): refuse buy/sell if the USD mark vs independent DexScreener/Gecko (or last sane / ETH-normalized WETH-USDC pool) is outside **0.01×–100×**, or implied bag ≫ RISK start. Independent quotes use Uniswap/Aerodrome WETH or USDC only — a Pancake TOSHI/VIRTUAL ghost at $69729 is never the reference. After a refuse, skip re-attempt / re-log for a few minutes (still refuse).
- **Slippage cooldown**: after 3 consecutive `Too little received` / 0-ETH fills on a symbol, skip that name for 30 minutes so the retry loop does not burn gas.
- **Piggy-bank dust**: every token bag keeps a growing never-sell reserve (`PIGGY_BANK_PCT` default **2%** of units, plus `PIGGY_BANK_MIN_USD` default **$0.05**). Wave / moonshot / cascade / `/sell` / sellhalf / fib / stale / stop-loss compute `sellable = balance − piggyReserve` and leave the pile. Reserve floors up on buys and never auto-shrinks. Dust is sold only on an explicit unlock (`PIGGY UNLOCK` reason or Telegram `/piggyunlock SYMBOL`). Persisted on `tokens.json` (`piggyReserve`) and `positions.json` (`piggyReserves`) so restarts keep the pile. This is per-token dust — not the ETH skim `/piggy` pool.

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

Live DexScreener scout + prune notes: see `UNIVERSE.md`. TOSHI stays tradeable (residual bag).

**Active (tradeable):**
AERO · BRETT · VIRTUAL · MORPHO · CBBTC · DEGEN · AIXBT · TOSHI
KEYCAT · DOGINME · XCN · SKI · LUNA · GAME · BASECAT · DRB · REI · CLANKER

**Frozen (no new capital):**
SEAM · MOG · BASE · VVV · TIBBIR · STONKEX · BLUECHIP · VELVET · KTA · PRIME · HIGHER · MOCHI
ZORA · BNKR · TYBG · MIGGLES · BENJI · ROOST · TALENT · TOBY · SIMBA
CRASH · BRIUN · NORMIE · OGGY · FREN

**Disabled:**
WELL (Aerodrome-primary — Uniswap V3 reverts) · KITE (no Base pool)

**Watchlist (learning, not trading):**
CLANKER (tokenbot) · RSR · ODOS · IMAGINE · CBETH

---

## Architecture

```
agent.js              — Main trading loop + Telegram command handler
price-insane.js       — PRICE_INSANE mark gate + Base QuoterV2 + slippage / refuse backoff
vita-models.js        — VITA Anthropic model cycle (Railway VITA_MODELS)
price-oracle.js       — DexScreener/Gecko quotes; Uni/Aero WETH-USDC only (no ghost pairs)
piggy-bank.js         — Per-token never-sell dust reserve (ratchet + unlock)
lose-zero-gate.js     — LOSE-ZERO buy gate + leftover sell (hitch or plain)
l1-fee-oracle.js      — Base GasPriceOracle.getL1Fee / getL1FeeUpperBound for hitch inject cost
swap-minout.js        — Uniswap amountOutMinimum sanity (after PRICE_INSANE)
vault-loader.js       — Blockchain key fetcher + AES-256-GCM decrypt
vault-unlock.js       — Stage 1 boot unlock (password via Telegram)
keystore.js           — Personal double-encrypted key manager
log-formatter.js      — Structured human-readable log output
bitstorage-orchestrator.js  — BITStorage / ShadowWeave strand injection
encryptkey.js         — One-time key encryption + inscription tool
```

### Infrastructure

- **Chain**: Base (L2, Coinbase) — 2 second block times, sub-cent gas
- **DEX**: Uniswap V3 — direct swap routing, QuoterV2 slippage protection (Base QuoterV2 `0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a`), `amountOutMinimum` sanity (`swap-minout.js`) so impossible floors cannot brick exits
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

LOSE_ZERO                 ← yes = block new buys (auto, cascade, ripple, operator) unless there is a clear edge AND leftover covers a short §$STORE§ hitch (1×)
HALT_NEW_ENTRIES          ← yes = same gate as LOSE_ZERO
REQUIRE_INJECT_COVER      ← yes = inject-cover check is mandatory for buys even when LOSE_ZERO is unset
HITCH_COST_MULT           ← sell-side hitch cover multiplier (default 2). sell_target = fair_exit + fees + (HITCH_COST_MULT × inject_hitch_cost). inject_hitch_cost = live Base L1 data fee (GasPriceOracle 0x420…000F getL1Fee / getL1FeeUpperBound) + L2 calldata-gas; oracle failure falls back to L2-only. Buys stay 1×.
ALLOW_LOSSY_OPERATOR_BUY  ← yes = allow MANUAL BUY (operator) even when leftover would not cover 1× hitch (default no)
ALLOW_LOSSY_OPERATOR_SELL ← yes = allow MANUAL SELL (operator) even when leftover would not cover 2× hitch (default no)
PIGGY_BANK_PCT            ← per-token never-sell dust as a fraction (0.02) or percent (2). Default 2% of current units.
PIGGY_BANK_MIN_USD        ← USD floor converted to token units via live price (default $0.05). Set 0 to disable. Reserve = max(pct × balance, minUsd / price) and never auto-shrinks.
BASE_RPC / RPC_URL / BASE_RPC_URL  ← preferred Base RPC (e.g. https://mainnet.base.org). Used first; public fallbacks exclude dead base.llamarpc.com (Cloudflare 521).
OPERATOR_BUY              ← TOSHI:3 = queue one operator manual buy of $3 TOSHI at each fresh process boot (after CDP ready). Same as /buy TOSHI $3. Latch is set only after the swap executes so a fatal main() restart re-queues. Hitch cover applies unless ALLOW_LOSSY_OPERATOR_BUY=yes. Frozen catalog names are never queued.
OPERATOR_SELL             ← TOSHI:50 = queue one operator 50% sell (same as /sellhalf TOSHI / /sell TOSHI 50) once after CDP ready. TOSHI:all = full /sell. Latch is set only after the swap executes. Bypasses wave gates as MANUAL SELL (operator). Does not re-buy unless OPERATOR_BUY is also set. LOSE_ZERO auto stays gated.
PRICE_INSANE_MIN_RATIO    ← mark / DexScreener-Gecko (or last sane) floor (default 0.01)
PRICE_INSANE_MAX_RATIO    ← mark / DexScreener-Gecko (or last sane) ceiling (default 100)
PRICE_INSANE_RETRY_COOLDOWN_MS ← after a PRICE_INSANE refuse, skip re-fetch / re-attempt (default 600000 = 10m). Still refuse.
PRICE_INSANE_LOG_COOLDOWN_MS   ← reprint PRICE_INSANE at most this often (default 900000 = 15m)
RISK_START_USD            ← RISK wallet start for implied-bag cap (default 15)
VITA_MODELS               ← comma list of Anthropic model ids to cycle (default claude-sonnet-4-20250514,claude-opus-4-20250514)
BAG_VS_RISK_MULT          ← refuse if balance × mark > RISK_START_USD × this (default 100)
SLIP_RETRY_MAX            ← consecutive Too little received / 0-ETH fills before cooldown (default 3)
SLIP_COOLDOWN_MS          ← cooldown after the cap (default 1800000 = 30m)
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
/buy SYMBOL [usd]  manual buy (e.g. /buy TOSHI $3) — operator; hitch cover required unless ALLOW_LOSSY_OPERATOR_BUY=yes
                   Frozen catalog names are blocked (exits/sells still allowed)
                   Railway: OPERATOR_BUY=TOSHI:3 queues the same command once at boot
/sell SYMBOL [pct|all]  manual sell (e.g. /sell TOSHI, /sell TOSHI 50, /sell TOSHI all)
                   50 / half = same as /sellhalf. Bypasses wave gates as MANUAL SELL (operator)
                   Railway: OPERATOR_SELL=TOSHI:50 queues one 50% sell after CDP ready
                   Always leaves the per-token piggy dust pile
/sellhalf SYMBOL sell 50% + cascade fires (unchanged) — leaves piggy dust
/piggyunlock SYMBOL  sell the locked dust pile (reason `PIGGY UNLOCK`). Only way to sell reserve.
/exit SYMBOL     sell to ETH, no cascade (still leaves piggy dust)
/exitpct SYM 75  sell any % to ETH (still leaves piggy dust)
```

Trading gates: `LOSE_ZERO=yes` / `HALT_NEW_ENTRIES=yes` refuse new buys unless leftover covers **1×** hitch and there is a clear edge. **Sells**: leftover after fees must be > 0 (do not lose money). Eureka hitch rides the sell when leftover also covers **2×** hitch; otherwise skip hitch and still sell. Piggy dust stays locked. Hitch leftover uses live Base L1 data fee when the oracle answers. `MANUAL BUY (operator)` is lossy only if `ALLOW_LOSSY_OPERATOR_BUY=yes`. `MANUAL SELL (operator)` is lossy only if `ALLOW_LOSSY_OPERATOR_SELL=yes`. **PRICE_INSANE** runs first: a mark outside 0.01×–100× of DexScreener/Gecko (or last sane seed), or a bag ≫ RISK start, refuses the trade before hitch/minOut. After 3 `Too little received` fails on a symbol, that name cools down for 30 minutes. **Piggy-bank dust** is applied *before* the hitch / minOut math: `sellable = balance − piggyReserve` unless the reason starts with `PIGGY UNLOCK`. `/sell TOSHI all` cannot drain a bag that has a reserve — use `/piggyunlock TOSHI`.

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
/prove           dedicated 0-ETH UTF-8 Eureka letter (Basescan Input Data → UTF-8)
/voiceon /voiceoff  hitch the letter on leftover swaps
/models          VITA model cycle
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





















