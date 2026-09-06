# Changelog

## Unreleased

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
