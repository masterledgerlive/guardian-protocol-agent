# Market threshold p*_mkt — RESULTS (paper only)

Pre-registration: `docs/MARKET_THRESHOLD_PREREG.md`, commit
`cbfdaad905fcd52aa3965536c265851fae334e1d` (2026-09-27 00:43:44 PT), made
before any data pull. Backtest run 2026-09-27 ~01:30 PT. Code:
`research/pstar/` (`backtest.py`, `edge_by_bucket.py`, fetchers). Raw candles
are not committed (re-fetch with the scripts).

## Verdict

**No robust market threshold was found in the observed vol range, and the
locked band [0.08, 0.13] was NOT confirmed.** With the desk's wave-entry /
always-plus exit, the gross per-cycle edge is ≈ 0 at every vol level, so a
bigger size just multiplies a cost-dominated negative expectancy: d=5 loses
more than d=1 in every vol bucket with p ≥ 0.02 (15m) and in every bucket
(1h). The only + → − sign change sits at the very bottom of the range
(p ≈ 0.018) and is degenerate (bottom bucket Δ = +$0.007 on n = 23).

| item | value |
|---|---|
| prereg locked band (p*_mkt) | [0.08, 0.13], point 0.10 |
| measured + → − crossing (15m primary) | **0.0183** (degenerate, at the edge of data) |
| bootstrap (1000 day-block reps, seed 887) | 816 reps cross; median 0.0219; **95 % CI [0.0177, 0.0620]**; 68 % [0.0189, 0.0551]; 184 reps no crossing |
| "chop band" (95 % boot interval) | [0.0177, 0.0620], wide, not a real threshold |
| landed in locked band? | **No** (entire CI below 0.08) |
| 1h robustness (7 tokens) | no crossing at all; only 176/1000 boot reps show one |
| tier crossings d3v1, d5v3, d10v5, d25v10 | all ≈ 0.0183 (collapse: impact ≈ 0 at micro size, as the prereg null clause expected) |

## Data + coverage

GeckoTerminal (prereg primary) returned HTTP 429 on every OHLCV and pool call
from the box for more than 30 minutes (after one pool-discovery pass
succeeded), so the prereg's allowed free fallbacks were used. **Deviation**:

- **Primary 15m** = Coinbase Exchange public candles, 2026-06-29 00:45 PT →
  2026-09-27 00:45 PT (90 d): WETH(ETH-USD) 8641 bars, AERO 8639, TOSHI 8185,
  VIRTUAL 7841, DEGEN 5235 (missing bars = no prints → forward-filled flat).
  BRETT and HOME are not on Coinbase.
- **1h robustness** = Coinbase 1h for those 5 plus DefiLlama `coins.llama.fi`
  hourly *close-only* prices for BRETT (2007 pts) and HOME (1503 pts, 88.8 d);
  for these, H = L = O = C, so TP checks use closes (conservative).
- Pool liquidity for the impact term = GeckoTerminal `reserve_in_usd` from the
  one successful discovery pass (AERO/USDC $42.3M, VIRTUAL/WETH $4.6M,
  BRETT/WETH 1 % $1.35M, TOSHI/WETH 1 % $1.23M, DEGEN/WETH 1 % $0.88M,
  WETH/USDC $156.6M, HOME/WETH desk Slipstream pool $8.6k).
- Coinbase is a CEX print, not the Base pool price. The cost model is still Base.

Trades (cycles): 15m = 259 (AERO 62, VIRTUAL 59, DEGEN 58, TOSHI 46, WETH 34);
1h = 316.

Realized vol levels (15m, p = 24h-scaled): medians AERO 0.045, VIRTUAL 0.041,
DEGEN 0.037, TOSHI 0.034, WETH 0.022; p90 ≤ 0.078 for every token. The
prereg band is only reached in about the top 10 % of hours for the memes. The
15m bucket at p ≥ 0.075 merged to n = 37 (median p 0.103).

## Bucket table (15m primary, mean net USD per cycle)

| p bucket | n | p med | d1 | d3 | d5 | d25 | d1 loss rate | Δ d5−d1 |
|---|---|---|---|---|---|---|---|---|
| [0, .02) | 23 | .0181 | −0.118 | −0.115 | −0.112 | −0.088 | 0.65 | +0.007 |
| [.02, .03) | 41 | .0270 | −0.179 | −0.296 | −0.414 | −1.611 | 0.98 | −0.236 |
| [.03, .04) | 48 | .0342 | −0.176 | −0.290 | −0.403 | −1.565 | 0.94 | −0.227 |
| [.04, .05) | 51 | .0438 | −0.128 | −0.144 | −0.160 | −0.342 | 0.92 | −0.032 |
| [.05, .06) | 27 | .0546 | −0.140 | −0.180 | −0.221 | −0.642 | 0.96 | −0.081 |
| [.06, .075) | 32 | .0651 | −0.182 | −0.305 | −0.428 | −1.685 | 0.94 | −0.247 |
| [.075, ∞) | 37 | .1028 | −0.177 | −0.292 | −0.408 | −1.589 | 0.95 | −0.230 |

Gross edge per bucket (15m): mean gross return +0.90 %, −0.17 %, +0.03 %,
+0.95 %, +0.63 %, −0.07 %, +0.19 % (SE 0.5–0.85 % each); overall +0.33 %
(SE 0.25 %). TP-hit rate rises with vol (39 % → 68 %) but the time-stopped
bags get bigger, so mean gross stays ≈ 0, which is what optional stopping on a
near-martingale predicts. Per-unit edge after fee + vol slippage is negative in
every bucket except the lowest (+0.03 %).

Sensitivity (no 0.25·σ slippage term): sign changes at 0.0190 (+→−),
0.0432 (−→+), 0.0476 (+→−), all driven by the marginal 0.04–0.05 bucket
(Δ = +$0.013). Still nothing in [0.08, 0.13]; Δ < 0 above 0.05.

1h (7 tokens): Δ(d5−d1) = −0.24, −0.30, −0.35, −0.26, −0.24, −0.29 and −0.94
(p > 0.105, driven by HOME). No crossing.

Cascade layers (secondary, d layers of $5 at −3 % steps): no crossing; d3/d5
cascades are worse than d1 in every bucket (15m and 1h).

## Per-token notes (15m unless noted)

- **AERO**: n 62, TP 66 %, gross +0.58 %, d1 −$0.135, d5 −$0.197. The best meme
  behaviour, but still negative.
- **VIRTUAL**: n 59, TP 64 %, gross +0.58 %, d1 −$0.134, d5 −$0.188. Its own
  buckets show one + → − crossing at p 0.044 (small n).
- **DEGEN**: n 58, TP 55 %, gross −0.47 %, d1 −$0.190, d5 −$0.473.
- **TOSHI**: n 46, TP 30 % (6 % TP, 2 % round-trip cost), gross +0.51 %,
  d1 −$0.207, d5 −$0.556. A 1 % pool kills it.
- **WETH**: n 34, TP 35 %, gross +0.56 %, d1 −$0.128, d5 −$0.162; crossing at p
  0.0187. On 1h WETH is the only token where d5 (−$0.068) beat d1 (−$0.110)
  overall: low vol (~2 %/day) plus deep pool, so gas amortisation wins.
- **BRETT** (1h, close-only): n 42, gross −0.32 %, d5 −$0.496.
- **HOME** (1h, close-only): n 52, p median 0.088, gross −2.18 %, d5 −$1.38.
  With an $8.6k pool, impact grows with size, so HOME is the one place where a
  bigger tier is penalised by liquidity rather than fees.

## Elasticity / numbness

Small shocks (0.5–1.5 σ_bar), response = next 4-bar return, both normalised
by σ_bar. 15m β_norm by bucket: −0.012 (±0.063), −0.021 (±0.043),
**−0.120 (±0.038)** at p 0.03–0.04, −0.031, −0.042, −0.006, +0.041 (±0.102)
at 0.075–0.09, +0.057 (±0.135) at 0.09–0.105, −0.125, −0.011, +0.023 (upper
buckets n < 400, SE ≥ 0.1). Response to small shocks is ≈ 0 at all vol
levels. The only significant effect is mild mean reversion at p 0.03–0.04. A
|β| minimum inside [0.08, 0.13] cannot be distinguished (SE there is larger
than the effect), so the **numbness prediction is not confirmed**. 1h shows
the same picture (all |β| < 2 SE).

## Why (mechanism, not a claim of threshold)

At B = $5 the fixed $0.12 gas is 2.4 % of notional. Plus the 0.6 % pool fee,
the round trip costs about 3.0 %, which matches the 3.1 % TP
(minNetMargin 2.5 % + poolFee 0.6 %, taken from tokens.json). A TP hit nets
only about +$0.005 before slippage, which is why the d1 loss rate is 92–98 %.
Bigger tiers amortise gas but multiply the ≈ −1 % per-unit (fee + slippage −
edge) drag. Gas cancels in Δ, so Δ tracks the sign of the per-unit edge, and
that edge is ≈ 0 minus costs everywhere. This is the market analogue of
operating *above* threshold at every observed p: making the "code" bigger
only makes it worse.

## Honest caveats

- Small samples: 23–51 cycles per bucket, 259 total (15m). Bootstrap CIs are
  wide, and 18 % of reps have no crossing at all.
- Data source deviation (Coinbase CEX prints instead of Base pool OHLCV; BRETT
  and HOME close-only, 1h only). GeckoTerminal was rate-limited throughout.
- The cost model is stylised: fixed $0.12 gas, 0.25·σ_bar slippage, and
  constant-product impact from a single liquidity snapshot. BRETT, DEGEN and
  TOSHI pools are actually 1 %, but tokens.json says 0.6 % for BRETT and DEGEN
  (used, per prereg). TOSHI used 2 % (prereg text), while tokens.json
  `poolFeePct` = 0.01.
- Fees dominate micro size. The result says the current wave-entry +
  always-plus exit has no gross edge at 15m/1h. It does not say vol never
  matters.
- The 48h time stop turns "hold red" into realized marks. The live agent may
  hold longer.
- Implementation fix before the first valid run: numpy bool summation bug
  (`trough+mom+pull` ORed instead of counting), fixed to int counts. This is a
  code fix, not a spec change. Bucket merge rule collapsed p ≥ 0.075 into one
  bucket (15m).
- The HOME liquidity snapshot uses the desk Aerodrome Slipstream pool, not the
  v4 "88 %" hook pool that GeckoTerminal ranked top ($9.1k); the numbers are
  near-identical.

## Live paper logger

`pstar-log.js` (flag `PSTAR_LOG`, default on) is wired through
`history-slot.js` `recordPriceInto`, so it sees every price the agent already
records. No agent.js edit. It aggregates 15m bars, computes p (same
definition), and classifies the band against the prereg band [0.08, 0.13] (the
measured result is also exposed). It keeps paper cycles with the same entry,
TP and 48h rules and records per-tier hypothetical net (d1/d3/d5) with the same
cost model. It has zero network, signer, vault or VITA access and never
touches env flags. Read at `GET /vita/read?f=pstar-log.json` (snapshot file
rewritten ≤ 1×/60 s; in-memory only if the fs is read-only). A dedicated
`/pstar` route patch for vita-webhook.js is in
`research/pstar/optional-webhook-route.patch` (not applied).
