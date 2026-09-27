# Market threshold p*_mkt — PRE-REGISTRATION (locked before any data pull)

Written: 2026-09-27 00:43 PT (07:43 UTC). No OHLCV has been fetched and no
backtest has been run at the time this file is committed. The commit hash of
this file is the timestamp proof. Anything below that changes after results
are seen must be reported as a deviation, not silently edited.

Scope: PAPER ONLY. No trades, no broadcasts, no env flips
(VITAFEED_PAID / HALT_NEW_ENTRIES untouched), vault and VITA mother brain
untouched.

## 0. Analogy being tested

Quantum result (Game): logical-error curves for d=5 and d=13 cross at
p* = 0.0887, locked band [0.075, 0.105], 2-sigma chop ~[0.078, 0.118].
Below p* the bigger code wins; above p* the bigger code loses more; near p*
the system saturates ("numb").

Market mapping:
- p  = turbulence = realized volatility (definition in §1)
- d  = size multiple of the base micro size (primary) / cascade layers (secondary)
- logical error = realized net PnL after fees + gas + slippage (per trade)

p*_mkt = the vol level at which the net expectancy of the bigger tier
(d=5) stops beating the smaller tier (d=1), i.e. where
Δ(p) = E[net_USD | d=5, p] − E[net_USD | d=1, p] crosses zero.

## 1. Vol metric (p)

- Bars: GeckoTerminal OHLCV, **15-minute** bars, top-liquidity Base pool per
  token (pool chosen by reserve_in_usd at fetch time), quote in USD.
- p_t = stdev of the last **96** 15m log returns (24h window, ending at the
  bar *before* entry, no look-ahead) × sqrt(96).
  → p is a **24h-scaled realized volatility**, a dimensionless fraction
  (0.09 = 9 % per day), deliberately on the same numeric scale as the
  quantum p.
- sigma_bar = p / sqrt(96) (per-15m sigma) — used in slippage model.
- Robustness (secondary): 1h bars, p = stdev(last 24 1h log returns) × sqrt(24).

## 2. Window + tokens

- Window: last 90 days ending at fetch time (or max available if less),
  15m bars, paginated via `before_timestamp`.
- Tokens (desk tokens with history): AERO, BRETT, DEGEN, TOSHI, VIRTUAL,
  HOME, WETH (WETH vs USD). Any token whose pool history is < 14 days is
  reported but excluded from the pooled crossover.
- Free sources only: GeckoTerminal public API (primary). Coinbase Exchange
  public candles (ETH-USD, AERO-USD where listed) only as a cross-check of
  vol levels. No paid APIs.

## 3. Entry / exit rules (reusing the repo's wave logic where feasible)

Mirrors `wave-cycle.js` `scoreEntryAlignment` + `canExecuteNoLossCycle`
(alignMin = DEFAULT_ALIGN_MIN = 2, falling-fast block) and
`always-plus-exit.js` (never sell red on purpose → no stop loss).

Entry signals evaluated on bar close t (all price-location signals):
- trough:   close_t ≤ 1.005 × min(low of prior 16 bars) (at/near 4h MIN)
- momentum: RSI(14, closes) ≤ 35
- pullback: close_t ≤ 0.97 × max(high of prior 96 bars) (≥3 % off 24h high)
- Enter if ≥ 2 of 3 are true AND NOT falling-fast
  (falling-fast = bar-t log return < −3 × sigma_bar).
- Fill at **open of bar t+1** (no look-ahead).
- One open cycle per token at a time; next entry only after exit bar.

Exit (always-plus style):
- TP: gross target = minNetMargin + poolFeePct from `tokens.json`
  (default 0.025 + 0.006 = **+3.1 %** for 0.3 % tier tokens; TOSHI
  0.05 + 0.01 = +6 %). Filled at the TP price when bar high ≥ TP.
- No stop loss (always-plus holds red).
- Time stop: **48h (192 bars)** → exit at close, marked to market; this is
  the "bag held red" outcome and counts as realized loss/gain.
- Tokens not in tokens.json (HOME, WETH): 0.3 % tier defaults
  (poolFeePct 0.006, minNetMargin 0.025).

Exit is price-based and identical for all tiers, so d only scales exposure
and cost structure (clean analogue of code distance).

## 4. Size tiers (d)

- Base micro size B = **$5** (desk micro ≈ 0.0010–0.0015 ETH).
- Primary tiers d ∈ {1, 3, 5} → $5, $15, $25.
- Exploratory tiers d ∈ {10, 25} → $50, $125 (so price impact is non-trivial).
- Secondary (exploratory) "stacking" = cascade layers: d layers of B;
  layer j (j=0..d-1) added at entry × (1 − 0.03·j) if touched within the
  cycle; TP on the average cost × (1 + TP gross); same 48h time stop.

## 5. Cost model (per round trip, notional N = d·B)

- Pool fee: N × poolFeePct (round trip; 0.6 % for 0.3 % tier, 2 % TOSHI).
- Gas + hitch: **$0.12** fixed per round trip (repo `feesUsdApprox`).
- Slippage per side: N × (0.25 × sigma_bar + 2N / liqUsd)
  (vol-driven execution drift + constant-product impact; liqUsd = pool
  reserve_in_usd at fetch time, held constant — caveat).
- net_USD = N × gross_return − pool fee − gas − 2 × slippage_side.
- Sensitivity (reported, not primary): slippage with the 0.25·sigma_bar term
  removed.

## 6. Analysis

- Vol buckets (fixed edges, p): 0, 0.02, 0.03, 0.04, 0.05, 0.06, 0.075,
  0.09, 0.105, 0.12, 0.15, 0.20, ∞. Buckets with < 20 trades are merged into
  the neighbour toward the median.
- Per bucket × tier: n, mean net_USD (expectancy), loss rate (net < 0),
  mean net ROC (net/N).
- Crossover: linear interpolation of Δ(p) between bucket medians; every sign
  change is reported. The **primary p*_mkt** is the sign change where Δ goes
  from + to − as p increases (bigger stops winning). A − to + change at low
  p is reported as the "fee floor" crossover.
- Uncertainty: day-block bootstrap of trades (1,000 reps, seed 887),
  recompute crossover each rep; 95 % percentile interval = CI;
  **chop band** = central 95 % bootstrap interval (analogue of the 2-sigma
  chop zone). Reps with no + → − crossing are counted and reported.
- Pooled across tokens (primary) + per token (notes only).

Elasticity / numbness test:
- Small shock = 15m log return r_t with 0.5·sigma_bar ≤ |r_t| ≤ 1.5·sigma_bar.
- Response = next 4-bar log return R_{t+1..t+4}.
- β(p) = OLS slope of R on r_t within each vol bucket (normalized version:
  both divided by sigma_bar).
- Prediction: |β_norm| is minimized ("numb") within/near the chop band;
  mean-reversion (β<0) dominates below, follow-through / noise above.

## 7. LOCKED PREDICTIONS (made before seeing data)

- **Primary p*_mkt (d5 vs d1, + → − as vol rises): locked band [0.08, 0.13]
  (24h realized vol), point guess 0.10.** Reasoning: 0.6 % round-trip fee +
  $0.12 gas is fixed-ish; the trough/RSI mean-reversion edge grows with vol
  until 48h-time-stop bags (no SL) and vol-driven slippage dominate, which
  for Base memes is expected around ~10 %/day; the quantum band
  [0.075, 0.105] overlaps by design so we can check whether "the same number"
  reappears, but the lock is the market band above.
- Expected chop band width: ± ~0.02 around p*.
- Secondary prediction: a low-vol "fee floor" crossover (− → +) near
  p ≈ 0.03–0.05, below which bigger size just pays more fees on
  time-stopped cycles.
- Numbness: |β_norm| minimum falls in [0.08, 0.13].
- Null outcome (possible): with micro size, impact ≈ 0, so all tier
  crossovers collapse to the sign change of per-unit edge; if Δ never
  changes sign or bootstrap CI spans the whole range, we report "no
  threshold detected" rather than forcing one.
