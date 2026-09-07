# Changelog

## Unreleased

### Fixed — UTF-8 `§$STORE§` hitch actually rides the swap (KEYCAT 0x5c0a93e4…)

Telegram printed the VITA letter on KEYCAT→WETH `0x5c0a93e4707a4dcf49afd4c785cb2829bce11ed026e08ba08435272d19122adf` but Basescan Input Data was only 228-byte `exactInputSingle` — no trailing UTF-8. The letter was never on-chain.

Genesis / StorageToken rule: hitch `§$STORE§` on a **real** leftover swap; never invent a hash; never claim Telegram text is on-chain.

- `appendUtf8Hitch` / `planVoiceHitch` append `§$STORE§ Eureka! VITA lives ♥ …` after the 228-byte swap (router ignores trailer). Sized to leftover hitch bytes. Prefix / minOut still refused if packing would smash the slot.
- Buy + sell (and moonshot via `executeSell`) send the hitched calldata. Telegram 💌 only quotes the bytes that were actually appended; otherwise it says the letter is not on-chain.
- Does **not** weaken PRICE_INSANE, Quoter, piggy, minOut, LOSE_ZERO, frozen, L1 oracle, or `HALT_NEW_ENTRIES`. No capital from this change.

### Added — hitch inject cost from live Base `GasPriceOracle.getL1Fee`

LOSE_ZERO leftover and the 2× sell floor were pricing `§$STORE§` / hitch as L2 calldata-gas only (`16 gas/byte × gwei`). On Base the L1 data fee dominates what we actually pay to insert the message.

- Shared helper `l1-fee-oracle.js` builds unsigned EIP-1559 swap+hitch bytes and calls the GasPriceOracle predeploy `0x420000000000000000000000000000000000000F`. Prefers `getL1Fee(unsigned RLP)`; uses `getL1FeeUpperBound(txSize)` when full RLP is missing or `getL1Fee` fails. Hitch L1 is the incremental fee of extra hitch bytes on a typical `exactInputSingle` envelope. Optional BTP self-send gets its own L1 quote.
- `estimateInjectHitchCostEth` / buy leftover / sell+size gates prefer that live L1 (plus L2 calldata). Oracle failure keeps the previous L2-only fallback — never under-cover by inventing a fee.
- Logs `HITCH FEE — L1 … + L2 …` when hitch is sized (`executeBuy`, `executeSell`, moonshot trim).
- Does **not** weaken PRICE_INSANE, QuoterV2, piggy dust, minOut, frozen buy, 2× hitch multiplier, or DRAWDOWN / `HALT_NEW_ENTRIES`.

### Fixed — independent TOSHI spot was the Pancake VIRTUAL ghost ($69729)

PRICE_INSANE (PR #19) correctly refused TOSHI sells, but the DexScreener/Gecko **independent** side was itself polluted. `/latest/dex/tokens/TOSHI` ranks PancakeSwap TOSHI/VIRTUAL first: **$69729.86**, ~$70M reported liq, **$0 volume**. Real Uniswap v3 TOSHI/WETH is ~$0.00012. Early logs: `mark $0.0001216 vs dex/gecko $69729.86`. Later both slots stuck at $69729 and refused only via implied bag.

- **Pair picker** prefers Uniswap/Aerodrome **WETH or USDC** (plus native ETH / USDbC), requires the wanted token as `baseToken`, drops zero-volume mega-liq ghosts, and pins the known TOSHI Uni v3 WETH pool. A $69729 dex row is never selected as independent.
- **sanitizeIndependentUsd**: $69729 vs last sane / ETH-normalized ~$0.00012 is rejected as independent; sane ~1.2e-4 is kept. If mark **and** independent are both fantasy, still refuse vs last sane / ETH-normalized — do not cache the moonshot into both slots.
- **Trusted last-sane**: a verified WETH/USDC quote can replace an untrusted cached fantasy; an untrusted 100× jump cannot overwrite a sane seed or the mark cache.
- **Backoff** (optional, does not weaken refuse): after PRICE_INSANE, skip re-fetch / re-attempt for 10m and reprint the log at most every 15m (`PRICE_INSANE_RETRY_COOLDOWN_MS` / `PRICE_INSANE_LOG_COOLDOWN_MS`).
- Does **not** weaken LOSE_ZERO, frozen buy, 2× hitch, piggy dust, minOut sanitize, or Base QuoterV2.

### Fixed — PRICE_INSANE gate + Base QuoterV2 + no 0-ETH "wins"

After piggy PR #18 + minOut PR #17, ~21 TOSHI→WETH sells still failed with `Too little received`. Logs showed TOSHI mark ~$69729 while Gecko/Dex spot ~$0.000122. Quote-fallback then built `amountOutMinimum` ~91k–93k WETH on ~4335 TOSHI. `sanitizeAmountOutMinimum` could not stop that because expected/spot were derived from the same insane mark (or Quoter missed).

- **PRICE_INSANE** runs in `executeBuy` / `executeSell` (and moonshot trim) **before** hitch, LOSE_ZERO, piggy sizing, and minOut. If mark vs independent DexScreener/Gecko (or last sane seed) is outside **0.01×–100×**, or implied bag ≫ RISK start (default 100× of $15), refuse and log — do not compute hitch/minOut from fantasy. Live fixture: $69729 TOSHI vs $0.000122 spot.
- **Base QuoterV2** is now the official Uniswap deployment `0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a` (https://developers.uniswap.org/docs/protocols/v3/deployments/v3-base-deployments). The previous `0x3d4e44Eb1374240CE5F1B136041212501e4a098e` is invalid on Base and forced the USD-mark fallback.
- Cap consecutive `Too little received` (and 0-ETH fills) per symbol at **N=3**, then a 30m cooldown so the retry loop stops burning gas (`SLIP_RETRY_MAX` / `SLIP_COOLDOWN_MS`).
- Failed swaps are never logged as ✅ / WAVE COMPLETE / 0.000000 ETH received as a win. Receipt + balance delta must show a real fill before tradeCount / BTP / ledger.
- BTP strand sell no longer reads `netUsd` / `received` / `recUsd` before they are declared (TDZ: `Cannot access 'netUsd' before initialization`).
- Does **not** weaken LOSE_ZERO, frozen buy, 2× hitch, piggy dust, or minOut sanitize.

### Added — per-token piggy-bank dust (never-sell reserve)

Every token position keeps a growing dust pile. Sells must leave it. Dust is sold only when Game/operator explicitly unlocks it.

- Config: `PIGGY_BANK_PCT` (default **2%** of current token units; accepts `0.02` or `2`) and `PIGGY_BANK_MIN_USD` (default **$0.05**, converted via live price). Reserve = `max(pct × balance, minUsd / price)`, capped at balance. Hypothesis: 2% matches the old ephemeral lottery % so we do not suddenly lock more than the bot already tried to keep; a $0.05 floor leaves a real pile on micro-caps without a min-token-count (1 TOSHI is worthless, 1 CBBTC would trap the bag).
- Central `applyPiggyToSell` in `piggy-bank.js`. `executeSell` (wave, moonshot, cascade/ripple, operator `/sell` / sellhalf, fib, stale, stop-loss, clean exit) computes `sellable = balance − piggyReserve`. A 100% request still leaves dust.
- Unlock: reason prefix `PIGGY UNLOCK` or Telegram `/piggyunlock SYMBOL`. Only then can the pile be sold.
- Ratchet: floors up on buys / balance growth (`executeBuy` + each `processToken` tick). Never auto-decreases after partial sells. Cap at remaining units only.
- Persist: `token.piggyReserve` in `tokens.json` and `piggyReserves` map in `positions.json`. Restarts keep the high-water mark (`loadPiggyReserve` takes the max of both).
- Does **not** weaken LOSE_ZERO, frozen buy gate, 2× hitch sell floor, or PR #17 minOut sanity (`sanitizeAmountOutMinimum` / `toWei` real decimals). Hitch and minOut run on the reduced `piggy.tokensToSell` size (more conservative).
- Distinct from the ETH skim `/piggy` pool (`positions.piggyBank`).

### Fixed — impossible Uniswap `amountOutMinimum` can no longer brick exits

Two RISK TOSHI→WETH sells reverted with no ERC20 Transfer because `amountOutMinimum` was ~93k–93.5k WETH while selling ~4424 TOSHI:

- `0x134bb40c9807fe2ebc48ab77a5a69cdbc29dea15c636a19acd43a7458521d3c6`
- `0x693af50a02fd00cfb69ffee9e59c8a38bd86ea1f24a44be22dcdcd563033d8d3`

On-chain calldata: hitch/BTP was trailing LIBM after the 228-byte `exactInputSingle` (slot not overwritten). The floor itself was computed insane (quote/slippage/`Number(wei)` path).

- Shared `sanitizeAmountOutMinimum` in `swap-minout.js`: compare minOut to QuoterV2 expected out (preferred) or USD spot; if minOut > expected or orders of magnitude above spot, **clamp** to the slippage band and log. If there is no quote and no spot, **reject — do not send**.
- **Covered call sites:** `executeSell` (all exits: wave / moonshot / operator / stop-loss), `executeBuy` (wave / OPERATOR_BUY / `/buy` / cascade / ripple), `encodeSwap` / `encodeSwapWithReceipt` (single encoder), `MempoolOrchestrator.injectAndSend` (refuses hitch that would overwrite the swap prefix / `amountOutMinimum`).
- Sell + buy quotes both go through QuoterV2; floors use bigint slippage (`85n/100n`) instead of `Number(quotedWei) * 0.85`. Amount-in uses the token's real decimals.
- Does not weaken LOSE_ZERO, frozen buy gate, or 2× hitch-cover. Protective `minOut=0` still allowed. No capital spends.

### Catalog — freeze VVV / TIBBIR (data-only)

Desk: keep VVV and TIBBIR in the catalog but `frozen: true` until Uni V3 is proven. No capital, no unfreeze, no `tokens.json` runtime adds.

- **Freeze:** VVV `0xacfE6019Ed1A7Dc6f7B508C02d1b04ec88cC21bf`, TIBBIR `0xA4A2E2ca3fBfE21aed83471D28b6f65A233C6e00`.
- Reason: `Desk greenlight overnight — data-only until Uni V3 proven.`
- STONKEX / BLUECHIP / VELVET / KTA stay frozen. BASECAT stays tradeable. DRB untouched. Buy-gate / hitch-cover logic unchanged.

### Fixed — cascade / ripple / operator buys must cover hitch under LOSE_ZERO

Overnight capital rotated via cascade/ripple without leftover covering 1× `§$STORE§` hitch + edge. `executeBuy` skipped `buildBuyGateDecision` when `isCascade`, and `evaluateBuyGate` / `buildBuyGateDecision` auto-allowed cascade plus every `MANUAL BUY (operator)`.

- Cascade and ripple now use the same leftover + edge gate as auto buys. No silent `isCascade` allow.
- `executeBuy` calls the buy gate for cascade too (removed `!isCascade &&` skip).
- Operator /buy is lossy only if `ALLOW_LOSSY_OPERATOR_BUY=yes` (default no) — mirrors `ALLOW_LOSSY_OPERATOR_SELL`.
- Frozen catalog gate (PR #13) unchanged: `frozen=true` still blocks NEW buys entirely. Sells stay on the 2× hitch floor.

### Catalog — frozen data-only add (KTA)

Desk greenlight. Catalog-only — no capital, no unfreeze, no `tokens.json` runtime add. Buy-gate logic unchanged (PR #13).

- **ADD frozen:** KTA (Keeta) `0xc0634090F2Fe6C6D75e61Be2b949464aBb498973` (Base, 18 decimals). Top book Aerodrome KTA/WETH ~$4.27M liq (not Uni V3) — keep frozen.
- STONKEX / BLUECHIP / VELVET stay frozen. DRB / VVV / TIBBIR untouched. BASECAT stays tradeable. Skip BSTONK / FLOCK / HYDX.

### Fixed — frozen catalog names can never open NEW buys

Overnight RISK capital bought STONKEX / BLUECHIP despite `frozen: true`. Freeze was only an allocation / UI / `processToken` early-return when `entryPrice` was missing. Cascade, ripple, and frozen names that already had a bag still reached `executeBuy`.

- Shared `isCatalogFrozen` / `frozenBuySkipLog` in `lose-zero-gate.js`.
- Hard gate at the top of `executeBuy` — blocks auto wave, OPERATOR_BUY, Telegram `/buy`, cascade, and ripple. Logs a clear skip reason.
- `shouldBuy`, `findCascadeTarget`, and ripple targets also skip frozen names (no "BUY TRIGGERED" / cascade Telegram then fail).
- Frozen tokens with a bag or pending command still fall through `processToken` so OPERATOR_SELL / sellhalf / dust exits stay open.
- Catalog flags unchanged: STONKEX / BLUECHIP / VELVET stay frozen. BASECAT stays tradeable. DRB / VVV / TIBBIR untouched. No capital spends.

### Catalog — frozen data-only adds (STONKEX / BLUECHIP / VELVET)

Desk greenlight overnight. Catalog-only — no capital, no unfreeze, no `tokens.json` runtime adds.

- **ADD frozen:** STONKEX `0x5ab000ff9B9FfE0349CE5ffA5fD86f217C3680F5`, BLUECHIP `0xB200000000000000000000cFbdF64a8706a94a01`, VELVET `0xbF927b841994731C573BDF09ceB0c6B0Aa887cDd`.
- Skip FLOCK / BSTONK. KEYCAT already in catalog. BASECAT / DRB / VVV / TIBBIR unchanged (BASECAT stays tradeable).

### Scout — prune Base token universe (DexScreener live)

Sleeping-game scout of `DEFAULT_TOKENS` against live DexScreener Base pools. See `UNIVERSE.md`.

- Freeze SEAM, BASE, MOG (thin / dead book — not safe for ~$3–11 RISK + 2× hitch). TOSHI stays active.
- Mark no-pool / broken-quote rows (`noBasePool`, `brokenQuote`) and skip their 8s OHLC seed so boot does not hang on CRASH/FREN/NORMIE/OGGY/KITE/SIMBA(ezETH)/BRIUN(UNIDX)/IMAGINE.
- Correct watchlist CLANKER to tokenbot `0x1bc0c422…1Bcb` (old address was CLANKFUN).
- **ADD** liquid actives (desk greenlight, live DexScreener): BASECAT, DRB, VVV, TIBBIR. Skip BSTONK. KEYCAT not duplicated.

### Fixed — never sell at a loss to insert storage (2× hitch floor)

Moonshot trim sold TOSHI at a ledger net ~-$0.06 (`0x1ac8e214…`) because hitch / BTP character cost was not in the sell gate. Sells and cascade were ungated.

- Central `minSellProceedsEth` / `coversHitchAndEntry` / `evaluateSellGate` used by `executeSell` and moonshot trim.
- Sell floor: `sell_target = fair_exit + fees + (HITCH_COST_MULT × inject_hitch_cost)`. Default `HITCH_COST_MULT=2` (env-overridable). Buys stay 1× leftover cover.
- If leftover after fees cannot cover 2× hitch: **hold**. Once the floor is met: **sell immediately**.
- Hitch / BTP bytes sized so inject cost × 2 ≤ leftover. Extra hitch is skipped rather than selling underwater to "make room".
- Only lossy exception: reason starts with `MANUAL SELL (operator)` AND `ALLOW_LOSSY_OPERATOR_SELL=yes` (default no). Stop-loss still exits with hitch skipped.

### Fixed — `hasPosition` TDZ aborted every `processToken` (blocked OPERATOR_SELL)

Live Railway after OPERATOR_SELL #7 logged `processToken error (AERO/BRETT/...): Cannot access 'hasPosition' before initialization` on every token. Armed-idle logging read `hasPosition` before `const hasPosition = balance > 1`, so the function threw in the temporal dead zone and never reached buys, wave sells, or the MANUAL SELL / `sellhalf` operator path.

- Declare `hasPosition` before the armed-idle log.
- Buffer the calendar-bias display line until `lines` exists (same TDZ class).

### Added — native `OPERATOR_SELL=TOSHI:50` + `/sell SYMBOL [pct|all]`

Game has a live TOSHI bag from the first RISK-wallet buy and needs an operator sell proof without waiting on wave gates.

- Native `OPERATOR_SELL=TOSHI:50` queues one `{ symbol, action: "sellhalf" }` after CDP ready (same MANUAL SELL HALF path as `/sellhalf TOSHI`). Also accepts `TOSHI:50%`, `TOSHI:half`, `TOSHI:all`.
- Telegram `/sell TOSHI`, `/sell TOSHI 50`, `/sell TOSHI all` still queue a manual sell. `/sellhalf TOSHI` is unchanged.
- Reason for env / sized sells is `MANUAL SELL (operator)` so the command bypasses wave gates. Latch is set only after `executeSell` succeeds (same restart re-queue as `OPERATOR_BUY`).
- Does **not** queue a re-buy. Auto stays gated by LOSE_ZERO unless `OPERATOR_BUY` is also set.

### Fixed — boot no longer dies on llamarpc 521 / eth_getBalance

`eth_getBalance` was hitting `https://base.llamarpc.com` (Cloudflare 521) and throwing, which killed `main()` with `Fatal main() error — restarting` before `OPERATOR_BUY` could fire.

- Prefer `process.env.BASE_RPC || RPC_URL || BASE_RPC_URL` ahead of any hardcoded public list.
- Remove `base.llamarpc.com` from the RPC rotation (dead 521s).
- RPC reads failover across the full list — a single 521/timeout does not throw. `getEthBalance` soft-fails to 0 so boot continues.
- In-process `main()` restart: VITA webhook skips rebind when port 3000 is `EADDRINUSE` (log and continue).
- `OPERATOR_BUY` re-queues on each fresh process boot and on fatal in-process restart unless the swap actually executed. The idempotent latch is set only after `executeBuy` succeeds.

### Fixed — Telegram poller starts before 90-day OHLC seed

Boot used to `await loadHistoricalData(90)` (DexScreener/GT, no per-call cap) and only then start the independent Telegram poller. A hung DexScreener call froze Telegram for minutes.

- Start the 3s Telegram poller immediately after vault unlock / CDP client ready. Guarded so it cannot start twice.
- Each token seed is wrapped in an 8s `Promise.race` timeout; DexScreener fetches use `AbortSignal.timeout(8000)`.
- Native `OPERATOR_BUY=TOSHI:3` queues `{ symbol, action: "buy", usd }` once after CDP ready (idempotent). Reason remains `MANUAL BUY (operator)` so LOSE_ZERO still allows the operator path; auto stays gated.

### Added — `/buy SYMBOL [usd]` operator size + LOSE_ZERO bypass

- Telegram `/buy TOSHI`, `/buy TOSHI 3`, and `/buy TOSHI $3` queue a manual buy.
- Optional USD is converted to `forcedEth = usd / ethUsd` and passed into `executeBuy`.
- Reason is `MANUAL BUY (operator)` so LOSE_ZERO / inject-cover allow the operator path. Auto buys stay gated.

### Fixed — Binance OHLC must not overwrite Base tokens

Boot seed was picking Binance `LUNAUSDT` (~$0.047) and `KITEUSDT` (~$0.13) because those CEX series have more daily bars than Base DEX pools. That is Terra / L1 KITE, not Virtuals LUNA (~$0.005) or a Base KITE pool.

- Historical seed prefers GeckoTerminal / DexScreener Base candles whenever they exist.
- Binance OHLC is allowlisted only for CEX-equivalent Base assets (AERO, BRETT, VIRTUAL, …). LUNA, KITE, GAME, HIGHER, MIGGLES and other Base-only memes never use Binance.
- DexScreener v3 chart 404s on V2/Rocketswap — seed those pools via GeckoTerminal OHLCV instead, with 429 retries.
- If Base OHLC is still thin, pin `lastPrice` to a live Base quote and build waves from ticks. Never invent a CEX lastPrice. KITE stays disabled with no Base pool.

### Fixed — live USD quotes (MORPHO / KITE / LUNA / GAME / UNKNOWN ENTRY)

Production was treating missing prices as $0, which poisoned wave prediction and tier scores.

- Corrected Base contract typos: MORPHO, LUNA, GAME, MOCHI. Catalog addresses are now authoritative on GitHub load (saved `tokens.json` cannot override a wrong contract).
- KITE's configured Base address has no DexScreener/GeckoTerminal market. It is disabled and skipped with a clear log rather than traded on an invented quote.
- Price path now prefers DexScreener (highest-liquidity Base pair) and GeckoTerminal in chunks of 10. The previous GT batch of 28+ addresses returned HTTP 400 or silently kept only ~10 prices.
- Boot scan / unknown holdings resolve from the live market + on-chain balance. Never logs `val≈$0.00` when a market price exists. If still unquoted, the token is marked `UNKNOWN` and excluded from margin math.
- Buys/sells/prediction skip when no real USD quote is available. No $0.000001 dummy entries.
