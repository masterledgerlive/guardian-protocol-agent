# Changelog

## Unreleased

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
