# Token universe scout — Base / DexScreener

Snapshot: **2026-09-06 ~09:20 UTC**. Source: DexScreener `tokens/v1/base` + `latest/dex/tokens` (no invented stats).

Rules in force: **LOSE-ZERO**; sell floor is `sell_target = fair_exit + fees + (HITCH_COST_MULT × hitch)` with **`HITCH_COST_MULT=2`**. RISK bag ~**$3–11**. Prefer Uniswap / Aerodrome. Freeze over hard-delete. **TOSHI residual ~4.5k stays tradeable.**

Bars used here:

| Verdict | Bar |
|---|---|
| KEEP | Uniswap or Aerodrome Base pool, liq ≳ $100k **and** 24h vol ≳ $20k |
| WATCH | Deep liq but 24h vol $5–20k, or exotic quote (VIRTUAL pair) |
| FREEZE | No Base pool, broken quote (wrong token), liq ≲ $50k, or 24h vol ≲ $100 |

---

## Catalog before this prune

| State | Symbols |
|---|---|
| **Active** (17) | AERO BRETT VIRTUAL MORPHO CBBTC DEGEN SEAM AIXBT TOSHI KEYCAT DOGINME XCN SKI MOG BASE LUNA GAME |
| **Disabled** (2) | WELL KITE |
| **Frozen** (17) | PRIME HIGHER MOCHI ZORA BNKR TYBG MIGGLES BENJI ROOST TALENT TOBY SIMBA CRASH BRIUN NORMIE OGGY FREN |

---

## Live book (deepest useful Base pool)

USD liq / 24h vol from DexScreener. Uni/Aero preferred when present.

### Stay active

| Sym | Best useful pool | Liq | 24h vol | Note |
|---|---|---:|---:|---|
| AERO | Aero AERO/USDC | $30.6M | $2.83M | Keep |
| CBBTC | Aero + Uni v3 cbBTC/WETH | $18.3M / $12.0M | $3.2M / $1.8M | Keep |
| VIRTUAL | Aero VIRTUAL/WETH | $4.25M | high across pools | Keep |
| GAME | Uni v2 GAME/VIRTUAL | $2.28M | $217k | Keep — VIRTUAL quote |
| LUNA | Uni v2 LUNA/VIRTUAL | $1.69M | $5.3k | Keep, **WATCH vol** |
| DOGINME | Uni v3 doginme/WETH | $1.40M | $51k | Keep |
| TOSHI | Uni v3 TOSHI/WETH | $1.12M | $37k | **Keep — residual bag** |
| MORPHO | Aero MORPHO/WETH | $1.06M | $2.41M | Keep |
| DEGEN | Uni v3 DEGEN/WETH | $1.03M | $36k | Keep |
| KEYCAT | Uni v2 KEYCAT/WETH | $957k | $196k | Keep |
| BRETT | Aero BRETT/WETH | $822k | $511k | Keep |
| SKI | Uni v2 SKI/WETH | $629k | $48k | Keep |
| AIXBT | Uni v3 AIXBT/USDC | $333k | $30k | Keep |
| XCN | Uni v3 XCN/USDC | $176k | $38k | Keep |

### Newly frozen (were active)

| Sym | Best pool | Liq | 24h vol | Why |
|---|---|---:|---:|---|
| SEAM | Uni v3 SEAM/USDC | $66k | **$22** | Chronic dead book |
| BASE | Swapbased V2 BASE/WETH | $41k | $1.6k | Thin; Uni v3 only ~$22k / $417 |
| MOG | Uni v3 Mog/SPX | $50k | $2.7k | Exotic quote; WETH Aero ~$16k |

### Disabled (unchanged)

| Sym | Live | Action |
|---|---|---|
| WELL | Aero WELL/WETH $1.21M / $154k; Uni v3 only $5.4k | Stay disabled — Uniswap V3 swaps revert |
| KITE | **No Base pool** | Stay disabled + `noBasePool` (skip OHLC seed) |

### Already frozen — DEAD / BAD (reasons updated)

| Sym | Live | Flag |
|---|---|---|
| CRASH FREN NORMIE OGGY | No Base pairs | **DEAD** — `noBasePool`, skip OHLC seed |
| SIMBA `0x2416…eea5` | ezETH/WETH ~$2715 | **BROKEN QUOTE** — Renzo ezETH, not SIMBA |
| BRIUN `0x6b47…a1CF` | UNIDX/WETH ~$17 liq | **BROKEN QUOTE** — Unidex |
| PRIME | Uni v3 $17k / $211 | Thin — stay frozen |
| HIGHER | Rocket $42k / $409; Uni v3 $36k / $512 | Thin — stay frozen |
| ROOST | Uni v3 $68k / **$29** | Dead book — stay frozen |
| TALENT | Aero $27k / **$59** | Dead book — stay frozen |

### Already frozen — still a real book (not unfrozen here)

Capital stays concentrated. Candidates to thaw later if RISK grows:

| Sym | Best pool | Liq | 24h vol |
|---|---|---:|---:|
| BNKR | Uni v3 BNKR/WETH | $1.87M | $62k |
| MIGGLES | Uni v2 MIGGLES/WETH | $494k | $59k |
| ZORA | Uni v3 ZORA/USDC | $95k | $217k |
| MOCHI | Uni v3 MOCHI/WETH | $154k | $14k |
| TOBY | Sushi toby/WETH | $210k | $5.1k |
| TYBG | Sushi TYBG/WETH | $230k | $13k |
| BENJI | Uni v2 BENJI/WETH | $349k | $7.2k |

---

## ADD candidates (not added to the table)

Prefer Uniswap V3 / Aerodrome. Do **not** add Aerodrome-only names until routing exists (WELL lesson).

| Sym | Address | Best Uni/Aero | Liq | 24h vol | Rec |
|---|---|---|---:|---:|---|
| **CLANKER** (tokenbot) | `0x1bc0c42215582d5A085795f4baDbaC3ff36d1Bcb` | Uni v3 CLANKER/WETH | $1.48M | $28k | **Best ADD** — watchlist address corrected (old `0x1d00…9317` was CLANKFUN) |
| **REI** | `0x6B2504A03ca4D43d0D73776F6aD46dAb2F2a4cFD` | Aero $1.83M / Uni v3 $204k | $1.83M / $204k | $95k / $41k | Strong ADD |
| FAI | `0xb33Ff54b9F7242EF1593d2C9Bcd8f9df46c77935` | Aero $2.49M / Uni v3 $256k | $2.49M / $256k | $15k / $1.8k | Watch — Uni vol thin |
| SPX (SPX6900) | `0x50dA645f148798F68EF2d7dB7C1CB22A6819bb2C` | Aero SPX/WETH | $760k | $12k | Watch vol |
| cbXRP | `0xcb585250f852C6c6bf90434AB21A00f02833a4af` | Aero $596k; Uni v3 only $47k | $596k | $1.24M | WELL-like routing risk |
| KAITO | `0x98d0baa52b2D063E780DE12F615f963Fe8537553` | Aero $16k / Uni v3 $10k | $16k | $36k | Too thin |
| IMAGINE (watchlist) | `0x078D…E666` | none | 0 | 0 | Dead — skip seed |

Unfreeze-first (already in catalog, real Uni book): **BNKR**, **MIGGLES**, **ZORA**. Not thawed in this PR — keep capital on the 14 actives + TOSHI residual.

Skipped as ADD: Basecat / other brand-new high-vol memes (LOSE-ZERO / hitch cover).

---

## Code actions in this PR

1. Freeze **SEAM**, **BASE**, **MOG**. **TOSHI stays active.**
2. Stamp `noBasePool` / `brokenQuote` on dead/wrong-address rows; **skip their OHLC seed**.
3. Correct watchlist **CLANKER** to tokenbot. Document ADDs above — no new active rows.
4. Holdings we still hold are not deleted. Frozen tokens can still exit if a position exists.
