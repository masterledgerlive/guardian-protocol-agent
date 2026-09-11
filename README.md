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
| **This repo** (`masterledgerlive/guardian-protocol-agent`) | Uniswap **V3** bot, vault, Telegram, UTF-8 `§$STORE§` hitch, `/prove` |
| **`guardian-v4/`** | Separate **Uniswap V4** inject offshoot (DOT + popular V4 avenues). `npm run start:v4` — does not freeze V3. See `guardian-v4/README.md` |
| **Railway `industrious-tranquility` → `guardian-protocol-agent`** | Production. Auto-deploys GitHub **`main`**. Domain `guardian-protocol-agent-production.up.railway.app` |
| **`masterledgerlive/StorageToken`** | Hitch / `$STORE` notes + a storage service. The agent-genesis brief landed here. **Not** the trader |
| **Railway `industrious-tranquility` → `StorageToken`** | That storage service, sitting next to Guardian. Ideas belong here in this bot, not a second trader |
| **Railway `generous-solace` → `coinbase-agent`** | Older Coinbase + Telegram helper. Not Guardian |

The letter to Krystian, Kai & Koda is **true** on Telegram **`/prove`** (dedicated **0-ETH** self-tx) when Basescan **Input Data → View as UTF-8** shows `§$STORE§ Eureka! VITA lives`. Leftover-covered swaps hitch **VITA `§TOKEN§`** by default (`VITA_HITCH_MODE=vita`) — the love note is encoded in `§KEY§` so it is not lost; locations squash into `§LOC§`. Telegram text next to a swap is not proof. Live KEYCAT sell [`0x5c0a93e4…`](https://basescan.org/tx/0x5c0a93e4707a4dcf49afd4c785cb2829bce11ed026e08ba08435272d19122adf) is a real KEYCAT→WETH fill (228-byte `exactInputSingle`) with **no trailer**. Hitch is skipped when leftover cannot pay — never lose money to insert storage.

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

Leftover swap hitch is **VITA `§TOKEN§` parse** (secondary router; Uniswap still ignores the trailer). The Eureka love note stays on **`/prove`** and inside `§KEY§`. `VITA_HITCH_MODE=eureka` restores the old prose letter on leftover swaps. Telegram 💌 only if those bytes were actually sent.

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
- **Stop loss**: 3% below MIN trough floor — exit only when leftover after fees is still green (plain sale). Underwater floors **hold**. Unknown-cost / frozen bags never arm stop-loss. No cascade after stop-loss (peak path compounds; stop→cascade historically lost).
- **Drawdown breaker**: portfolio down 60% from peak = buys halted
- **Gas spike guard**: Base gas > 50 gwei = all trades paused
- **Lose-zero gate** (opt-in Railway flags): block **auto / cascade / ripple** buys unless leftover covers a short `§$STORE§` hitch (1×) and there is a clear edge. **Operator Telegram `/buy`** is an explicit test: leftover+edge never block; hitch if leftover covers, otherwise a **plain swap**. Frozen / PRICE_INSANE / insufficient ETH / fill honesty / **per-token min buy USD** still apply. Auto buys also need ≥`CYCLE_ALIGN_MIN` (default **2**) aligned entry vars (trough / momentum / pred / pullback / leftover / smartMoney) so continuous no-loss cycles compound without chasing a single signal. After queue, Telegram always sends a Basescan receipt or the exact skip reason. Hitch inject cost prefers live Base `GasPriceOracle.getL1Fee` (predeploy `0x420000000000000000000000000000000000000F`) with L2 calldata-gas fallback. The hitch is **UTF-8 in the swap calldata** (Basescan Input Data → View as UTF-8), independent of BTP auto-suspend. Telegram `/prove` writes the same letter on a dedicated 0-ETH self-tx when there is no leftover swap. Telegram only claims the letter when those bytes are actually on the tx.
- **Sell floor (always on)**: every exit must print a **PLUS** (even 1 wei) vs `soldFrac × entry` after fees + piggy leave-behind + hitch on **this** tx (1× — buy hitch already sits in cost basis). `HITCH_COST_MULT` (default **2×**) is a *size* cushion (spend leftover/mult on payload) only when that still leaves plus; otherwise hitch at 1× or **SKIP_HITCH** (plain profitable sale). Never sell red to place code. **HOLD** when leftover after fees is ≤ 0 (including STOP LOSS) or cost basis is unknown. Piggy dust is never sold. Only underwater exception: `FORCE EXIT LOCKED` recovery (no hitch). Logs `PLUS` / `HOLD` / `SKIP_HITCH` with numbers.
- **PRICE_INSANE** (always on, before hitch / minOut): refuse buy/sell if the USD mark vs independent DexScreener/Gecko (or last sane / ETH-normalized WETH-USDC pool) is outside **0.01×–100×**, or implied bag ≫ RISK start. Independent quotes use Uniswap/Aerodrome WETH or USDC only — a Pancake TOSHI/VIRTUAL ghost at $69729 is never the reference. After a refuse, skip re-attempt / re-log for a few minutes (still refuse).
- **Slippage cooldown**: after 3 consecutive `Too little received` / 0-ETH fills on a symbol, skip that name for 30 minutes so the retry loop does not burn gas.
- **Piggy-bank dust**: every token bag keeps a growing never-sell reserve (`PIGGY_BANK_PCT` default **5%** of units, plus `PIGGY_BANK_MIN_USD` default **$0.15** when the bag can afford that floor — crumbs below the floor use pct only so they are not 100%-locked). **Bear-min projected earnings** bank into `savedEarningsUsd` on profitable exits so dust USD grows past the floor (e.g. $0.15 → $0.27) — extra profit stays liquid for redeploy. Buy Telegram shows sell-at (fees + 2× message + buffer) and min earn; sell Telegram is a bought→sold receipt with banked vs counted saved (must match dust). Wave / moonshot / cascade / `/sell` / sellhalf / fib / stale / stop-loss compute `sellable = balance − piggyReserve` and leave the pile. Reserve floors up on buys and never auto-shrinks. Peak gates and ledger PnL charge only the **sold** slice of entry cost (piggy-aligned `soldFrac`) so profits + skim still clear. Hitch Eureka only rides when leftover also clears the **piggy earnings buffer** (`PIGGY_EARNINGS_BUFFER_PCT` default **5%** of proceeds) on top of the 2× hitch cushion — otherwise plain sale. Telegram/ledger report `earningsUsd` after the message so wiped gains are never listed as wins. Dust is sold only on an explicit unlock (`PIGGY UNLOCK` reason or Telegram `/piggyunlock SYMBOL`). Nested `tokenPiggyLedgers` track dust + saved earnings + ETH contrib + agent share per inject seat. ETH skim `/piggy` co-invest is off by default (`PIGGY_COINVEST=yes`) so the pool stays locked for future AI piggy banks. Persisted on `tokens.json` / `positions.json`.
- **Cascade min-entry / inject-all** (`cascade-rollover.js`): thin books (`<$12` tradeable) inject **all** capital into **one** seat sized to cover fees + hitch + a cascade seed. Cascade only fires when sell proceeds clear the next token’s min entry; dust recycle can feed that cascade while piggy stays locked. Thin wallets shrink sell-reserve so liquid ETH is not falsely reported as ~0 after a hard $2–3 park. Telegram **BALANCE LOW** only when the chain wallet is truly empty — if capital is in bags, it says recycle→cascade instead.
- **Inject capital velocity** (`inject-revenue.js`): when liquid is starved, recycle known bags (largest first) that clear leftover after fees; align sell gate with piggy so allow→hold flips stop; do not hard-reserve UNI on a sub-min inject-all seat — prefer velocity names (DEGEN/AERO/…) so freed ETH can hitch+compound. Still never sell underwater.
- **Cascade gas floor**: never spend the last native ETH on a cascade hop. Deploy sizing leaves a continuity floor (scaled on thin books) so sell→cascade→exit always has Base gas; WETH is unwrapped before sell/cascade when native is low. Highest deploy without loss still refuses rather than cross the depletion threshold. Telegram `/injectprove` tracks successful hitch fills toward **20 + profit** before capital increases.
- **COST_EDGE** (`cost-edge-gate.js`): refuse buys when hitch/round-trip cost already dominates the stake or near-term upside cannot clear break-even (practical Kelly / execution-cost). On thin books (&lt;$15) with cheap hitch (&lt;2% of stake), near-term mult softens to **1.15×** (still never &lt;1×); CBBTC-class keeps **1.35×**. CBBTC/AAVE deferred from inject-mains on thin RISK; exits use **USD** not token-count. Telegram `/costedge` shows lessons learned. Research harness: `npm run sim:revenue`.
- **FORCE EXIT LOCKED** (`forced-exit.js`): CBBTC/AAVE are **frozen**. On boot/loop, stranded bags are sold `exitonly` (piggy unlocked, **no cascade**) so cash returns to ETH for profit hunting only. `FORCE_EXIT_LOCKED_MAJORS=no` disables.
- **Avenue prime** (`avenue-prime.js`): every cycle projects round-trip cost per path and keeps the **2–3** best seats primed (1 on inject-all). Paths that cannot clear fees+hitch without losing are refused. Growing capital prefers max profit × hitch-code fit / cost; cascade ranks primed seats by **lowest % above trough** + projected upside and redeploys there (ETH kept is the gas/fee floor only — not a parking lot).
- **Second inject / peak ride** (`second-inject.js` + `peak-ride.js`): after a profitable peak exit that paid the first inject portion (min entry + piggy skim runway) **and** surplus clears another primed READY / near-bottom seat without depleting the gas floor, cascade fires a **second injection** in the same succession. **Peak-ride**: ratchet a ride high-water while holding — do **not** sell on historical MAX touch alone (breakouts keep climbing). Sell when the peak is MADE (stagnant near high + turn signs), or on fast crash / safety-net ladder after the high rose. Predicted-peak and stale exits only fire in the peak zone (never mid-range). Primed READY bottoms can inject near recent lows. Hitch Eureka still rides buy and/or sell only when leftover covers.

### Two-Tier Capital System

Capital is dynamically allocated based on live token performance scores:

| Tier | Allocation | Slots | Criteria |
|------|-----------|-------|----------|
| Tier 1 | 65% of capital (100% when inject-all) | Top 3 (or **1** when <$12) | Highest score: win rate + P&L + margin + volume |
| Tier 2 | 35% of capital (0% when inject-all) | Next N tokens | Score above floor, slot size ≥ $4 |
| Moonshot | $0.50 hold | Remainder | Lottery bag — no new capital |

Scores are computed live every cycle from real trade history. The best-performing tokens always get the most capital. Slots expand automatically as capital grows.

---

## Active Token Universe

Live DexScreener scout + prune notes: see `UNIVERSE.md`. TOSHI stays tradeable (residual bag).

**Active (tradeable):**
AERO · BRETT · VIRTUAL · MORPHO · **UNI** (inject main / T1 reserved) · LINK · DEGEN · TOSHI  
❄️ FROZEN exits-only: CBBTC · AAVE · GAME · AIXBT · KEYCAT · SKI · LUNA · REI · BASECAT · …
DOGINME · DRB · CLANKER · VVV · ZORA · BNKR

**Inject main players (Tier-1 seat reserved for UNI first):**
UNI · LINK · AERO · MORPHO _(CBBTC / AAVE deferred on thin RISK — COST_EDGE)_

**Frozen (no new capital):**
SEAM · MOG · BASE · **XCN** (WETH-dead / USDC-primary) · **GAME** (thin Uni V3 WETH vs Uni V2 GAME/VIRTUAL) · **AIXBT / KEYCAT / SKI / LUNA / REI** (thin Uni V3 WETH hitch / gas burn) · **BASECAT** (CAUTION/CUT — FIFO 12/31 red sells) · TIBBIR · STONKEX · BLUECHIP · VELVET · KTA · PRIME · HIGHER · MOCHI
TYBG · MIGGLES · BENJI · ROOST · TALENT · TOBY · SIMBA
CRASH · BRIUN · NORMIE · OGGY · FREN

**Disabled:**
WELL (Aerodrome-primary — Uniswap V3 reverts) · KITE (no Base pool)

**Watchlist (learning, not trading):**
CLANKER (tokenbot — also active) · RSR · ODOS · IMAGINE · CBETH

**Skipped majors (no safe Uni V3 WETH book for $3–11 RISK):**
USDT/EURC (stables — no wave amplitude) · cbETH (Uni V3 thin; mostly V4) · cbXRP (Aerodrome-primary) · CRV (Uni V4 primary) · SOL/COMP/WBTC (thin vs peers)

---

## Architecture

```
agent.js              — Main trading loop + Telegram command handler
vita-webhook.js       — HTTP: /board hub + /arena + /engine + /vita/*
board-control.js      — Control Board snapshot / sim / V4 status (no spend)
engine-board.js       — Shared wave-phase / hitch-option / piggy-light math
avenue-prime.js       — Projected cost per avenue; prime top 2–3 cascade seats
second-inject.js      — Paid first inject + surplus → 2nd READY inject; instant peak
cascade-rollover.js   — Min entry, inject-all book, cascade deploy sizing
inject-revenue.js     — Small-book tiers + inject pullback entry
cost-edge-gate.js     — Hitch/RT % + adaptive thin-book near-term edge
revenue-sim.js        — Revenue / hitch research sims (npm run sim:revenue)
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
vita-hat.js           — Append-only encoded site preservation (1-bit genesis + ST/LT)
hat-wave-inject.js    — Wave-paid HAT sizing, confirm seal, exit-up without crash
hat-smile-demo.js     — 8×8×8-bit smile encode → locations → reader proof (`npm run hat:smile`)
vita-parse.js         — §TOKEN§ agentic parse / refine (2000-char budget, KEY+LOC first)
vita-locations.js     — Append-only location depository; hitch carries squashed §LOC§
vita-router.js        — Secondary hitch router (vita|eureka|hat|auto); leftover defaults to VITA
vita-course.js        — Hourly inject-without-loss scorecard
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
- **Control Board (start here)**: `https://guardian-protocol-agent-production.up.railway.app/board` — one hub for live V3 hitch inject surfaces, leftover/hitch capacity, piggy, bot-usage piggy (Grok $20 now / $60 Pro after proven hitch hashes), and gated operator queue. V4 is deferred (docs link only). See [`BOARD.md`](./BOARD.md). Demo/sim by default; live queue needs `VITA_WEBHOOK_SECRET`.
- **Arena board**: `/arena` — ledger game + practice sims (also embedded from the hub). LINK favorite inject main with **8%** piggy leave-behind (global default **5%** / **$0.15** dust floor — not 2%).
- **Engine board**: `/engine` — wave dance hardware view (waveforms, hitch/piggy lights, ride / trick-out). Demo without a secret; live queue needs `VITA_WEBHOOK_SECRET`.
- **V4 offshoot**: separate process `npm run start:v4` (`GUARDIAN_V4_*`). Docs page `/v4` — not started by this webhook, not merged into `agent.js`.

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

HAT_ROOT_TX               ← genesis 1-bit HAT node tx (or local nodeId until inscribed) — same insert pattern as VAULT_*
HAT_STRAND_ID             ← linear append-only strand id for site preservation
HAT_CONTENT_HASH          ← sha256 of canonical public HTML blob (arena+engine+board+v4) at preserve time
HAT_K_MASTER              ← optional hex key for encrypted fragment payloads

LOSE_ZERO                 ← yes = block new buys (auto, cascade, ripple, operator) unless there is a clear edge AND leftover covers a short §$STORE§ hitch (1×)
HALT_NEW_ENTRIES          ← yes = same gate as LOSE_ZERO
REQUIRE_INJECT_COVER      ← yes = inject-cover check is mandatory for buys even when LOSE_ZERO is unset
HITCH_COST_MULT           ← sell-side hitch SIZE budget leftover/mult (default 2). Plus gate is 1× hitch on THIS sell (buy hitch already in cost basis). inject_hitch_cost = live Base L1 data fee (GasPriceOracle 0x420…000F getL1Fee / getL1FeeUpperBound) + L2 calldata-gas; oracle failure → SKIP_HITCH (plain plus). Buys stay 1×.
ALLOW_LOSSY_OPERATOR_BUY  ← legacy alias; operator /buy already bypasses leftover+edge (hitch-or-plain)
ALLOW_LOSSY_OPERATOR_SELL ← ignored for plus — operator cannot sell red. Only FORCE EXIT LOCKED recovers stranded majors (no hitch).
PIGGY_BANK_PCT            ← per-token never-sell dust as a fraction (0.05) or percent (5). Default 5% of current units.
PIGGY_BANK_MIN_USD        ← USD floor converted to token units via live price (default $0.15). Applies only when bag USD ≥ floor; crumbs use pct only. Set 0 to disable. Reserve = max(pct × balance, minUsd / price) and never auto-shrinks.
PIGGY_EARNINGS_BUFFER_PCT ← fraction of proceeds that must remain after fees/skim/hitch before Eureka may ride (default 5%). Thin leftover → plain sale.
PIGGY_COINVEST            ← yes = allow ETH piggy paper co-invest with pred fund (default no — piggy stays locked for AI).
CYCLE_ALIGN_MIN           ← auto buys need this many aligned entry vars (default 2, max 4). Telegram `/cycles` reports succession streaks.
TOKEN_MIN_BUY_USD_JSON    ← optional `{"TOSHI":1,"UNI":0.5}` overrides for per-token Telegram/operator min buy floors.
BASE_RPC / RPC_URL / BASE_RPC_URL  ← preferred Base RPC (e.g. https://mainnet.base.org). Used first; code defaults also start at official Base then publicnode/nodies/tenderly. Dead base.llamarpc.com (Cloudflare 521) is excluded. meowrpc/drpc are last-resort only (429 under desk load).
OPERATOR_BUY              ← TOSHI:3 = queue one operator manual buy of $3 TOSHI at each fresh process boot (after CDP ready). Same as /buy TOSHI $3. Latch is set only after the swap executes so a fatal main() restart re-queues. Leftover+edge do not block; hitch if leftover covers, else plain. Frozen catalog names are never queued.
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
/buy SYMBOL [usd]  manual buy (e.g. /buy TOSHI $3) — operator test path; leftover+edge never block; hitch-or-plain; per-token min USD; Telegram skip reason or Basescan receipt
/cycles            no-loss succession streaks + live per-token min buys (alias /succession)
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

Trading gates: `LOSE_ZERO=yes` / `HALT_NEW_ENTRIES=yes` refuse **auto / cascade / ripple** buys unless leftover covers **1×** hitch and there is a clear edge. Operator `/buy` is a test path: leftover+edge never block; hitch if leftover covers, else plain swap; Telegram skip reason or Basescan receipt. **Sells**: leftover after fees must be > 0 (always-plus vs `soldFrac × entry`). Hitch on THIS tx is **1×**; size hitch DOWN to leftover-after-plus or **SKIP_HITCH** (plain profitable sale). Never sell red to inject. Piggy dust stays locked. Hitch leftover uses live Base L1 data fee when the oracle answers (oracle failure → SKIP_HITCH). Operator cannot sell red; only `FORCE EXIT LOCKED` recovers stranded majors (no hitch). **PRICE_INSANE** runs first: a mark outside 0.01×–100× of DexScreener/Gecko (or last sane seed), or a bag ≫ RISK start, refuses the trade before hitch/minOut. After 3 `Too little received` fails on a symbol, that name cools down for 30 minutes. **Piggy-bank dust** is applied *before* the hitch / minOut math: `sellable = balance − piggyReserve` unless the reason starts with `PIGGY UNLOCK`. `/sell TOSHI all` cannot drain a bag that has a reserve — use `/piggyunlock TOSHI`. Chain balances are the ledger: RPC fail keeps the last ping (never silent 0); unknown bags do not invent invested from the live mark.

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

---

## Agentic Memory Layer-1 (sideline research)

The live trader/injector above is unchanged. A separate research Arena lives in **`guardian-protocol/`** (start at [`GUARDIAN_L1.md`](./GUARDIAN_L1.md) → [`guardian-protocol/HANDOFF.md`](./guardian-protocol/HANDOFF.md)). Same monorepo, separate package — do not merge L1 simulator work into `agent.js` / hitch paths. Operator hub for the live bot: [`BOARD.md`](./BOARD.md) → `/board`.

*Built by DA | ᛞᚨᚡᛁᛞ — Clearwater, FL*
*INFINITUM × IKN × The Living Network*
*linktr.ee/infinitumikn · x.com/infinitumikn*





















