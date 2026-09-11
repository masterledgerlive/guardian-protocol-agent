# Token universe scout — Base / DexScreener

Snapshot: **2026-09-07 ~19:55 UTC** (top-100 Uni V3 injection pass). Prior: **2026-09-07 ~02:30 UTC** (REI / CLANKER). Source: DexScreener + Uniswap V3 factory `getPool` on Base (publicnode).

Rules in force: **LOSE-ZERO**; every exit must print **PLUS** vs `soldFrac×entry + fees + 1× hitch this tx`. `HITCH_COST_MULT=2` is a hitch *size* cushion only. Hitch inject cost prefers live Base `GasPriceOracle.getL1Fee`. RISK bag ~**$3–11**. Prefer Uniswap V3 WETH (bot routes `exactInputSingle`). Freeze over hard-delete. **TOSHI residual ~4.5k stays tradeable.**

Bars used here:

| Verdict | Bar |
|---|---|
| KEEP | Uniswap V3 Base pool vs WETH/USDC, liq ≳ $100k **and** 24h vol ≳ $20k |
| WATCH | Deep liq but 24h vol $5–20k, or exotic quote (VIRTUAL pair) |
| FREEZE | No Base pool, broken quote (wrong token), liq ≲ $50k, or 24h vol ≲ $100 |
| SKIP | Aerodrome-only / Uni V4-only / stables (no wave amplitude) |

---

## Top-100 majors — what we can actually trade on Uniswap (Base)

Bot = **Uniswap V3 only**. Many CoinMarketCap top-100 names have **no** liquid Base Uni V3 WETH book (SOL/DOGE/SHIB/OP/ARB thin or absent; CRV/cbETH mostly V4; cbXRP Aerodrome-primary).

| Sym | Address | Best Uni V3 | Fee | DS liq / 24h | Action |
|---|---|---|---:|---:|---|
| CBBTC | `0xcbB7…33Bf` | WETH (also USDC) | 3000 (catalog) | $8–12M / multi-M | **Already active** |
| LINK | `0x88Fb…e196` | WETH deepest on-chain | **3000** | USDC ~$137k / $141k | **ADDED tradeable** |
| AAVE | `0x6370…814b` | WETH | **3000** | ~$134k / $48k | **ADDED tradeable** |
| UNI | `0xc3De…3C83` | WETH | **10000** | ~$105k / $48k | **ADDED tradeable** |
| VVV | `0xacfE…21bf` | WETH 1% deepest + USDC 0.3% | **10000** | USDC ~$285k / $432k | **UNFROZEN** — Uni V3 proven |
| ZORA | `0x1111…Fc69` | WETH 1% deepest + USDC | **10000** | USDC ~$95k / $128k | **UNFROZEN** — injection surface |
| BNKR | `0x22aF…F3b` | WETH 1% | **10000** | ~$1.83M / $252k | **UNFROZEN** — deep Uni book |
| USDT | `0xfde4…9bb2` | USDC/WETH | — | liquid | **SKIP** — stable, no waves |
| EURC | `0x60a3…db42` | USDC | — | liquid | **SKIP** — FX stable |
| cbETH | `0x2Ae3…Ec22` | WETH 0.05% thin vs V4 | — | V3 ~$62k / low | Stay watchlist |
| cbXRP | `0xcb58…a4af` | Uni thin; Aero deep | — | Aero ~$673k | **SKIP** — WELL-like |
| CRV | `0x8Ee7…0415` | Uni V3 WETH thin; V4 USDC | — | V4 primary | **SKIP** |
| SOL | `0x3119…cf82` | USDC 0.3% | 3000 | ~$35k / $30k | **SKIP** — thin RISK |
| WBTC | `0x0555…B9c` | thin vs cbBTC | — | — | **SKIP** — use CBBTC |

---

## Live book (active after this pass)

| Sym | Best useful pool | Note |
|---|---|---|
| AERO BRETT VIRTUAL MORPHO CBBTC DEGEN TOSHI DOGINME DRB CLANKER | prior KEEP / deep earners | unchanged — DOGINME stays tradeable (catalog ~$1.8M book) |
| **AIXBT KEYCAT SKI LUNA REI** | thin Uni V3 WETH hitch / gas burn vs deep earners | **FROZEN buys** — exits-only |
| **BASECAT** | Uni V3 WETH `0xB200…1D01` (borderline ~$500k) | **FROZEN buys** — screener CAUTION/CUT. FIFO 12/31 red sells; exit throughput failed under LOSE-ZERO/2× hitch. |
| **XCN** | Uni V3 **USDC** ~$173k; WETH ~$212 | **FROZEN buys** — WETH-dead / USDC-primary (bot is WETH-only). Wave data still seeded (DS/GT + Binance). |
| **GAME** | Uni V2 GAME/VIRTUAL ~$2.14M; Uni V3 WETH 0.3% ghost (`liquidity()=0`) | **FROZEN buys** — exits-only / hitch CAUTION until battle-tested V3 WETH. |
| **LINK AAVE UNI** | Uni V3 WETH (factory fee above) | **NEW** top-100 injection targets |
| **VVV ZORA BNKR** | Uni V3 WETH 1% | **THAWED** |

### Still frozen

XCN (WETH-dead) · GAME (thin Uni V3 WETH) · AIXBT · KEYCAT · SKI · LUNA · REI · BASECAT (CAUTION/CUT) · TIBBIR · STONKEX · BLUECHIP · VELVET · KTA · SEAM · MOG · BASE · PRIME · HIGHER · MOCHI · TYBG · MIGGLES · BENJI · ROOST · TALENT · TOBY · SIMBA · CRASH · BRIUN · NORMIE · OGGY · FREN

MIGGLES stays frozen (Uni V2 primary; Uni V3 thin — WELL lesson).
GAME stays frozen exits-only (Uni V2 GAME/VIRTUAL 0xD418…7789 ~$2.14M is the liquid book; Uni V3 WETH feeTier 3000 0x70fbffe3… `liquidity()=0` / ghost — hitch CAUTION, not battle-tested).
AIXBT / KEYCAT / SKI / LUNA / REI stay frozen exits-only (thin Uni V3 WETH hitch surface / gas burn vs deep earners).
BASECAT stays frozen exits-only (screener CAUTION/CUT — FIFO 12/31 red sells; books exist but exit throughput failed under LOSE-ZERO/2× hitch).
DOGINME stays tradeable (catalog notes a deep ~$1.8M book — not a thin WETH cut).

### Disabled

WELL (Aerodrome-primary) · KITE (no Base pool)

---

## Code actions in this PR

1. **ADD** tradeable **LINK**, **AAVE**, **UNI** (factory-verified Uni V3 WETH fees).
2. **UNFREEZE** **VVV** (fee → 10000), **ZORA** (fee → 10000), **BNKR**.
3. Raise entry sanity for **AAVE** (~$132 unit) alongside CBBTC.
4. Do **not** add stables or Aerodrome-only majors.
5. Holdings on frozen names can still exit.

### Follow-up — injection-ready (live Railway @ 0930b8a)

Boot showed **24 active** but LINK/AAVE/UNI Dex OHLC timed out at 8s. Fix: Binance allowlist for LINK/AAVE/UNI + inject-surface score boost so deep Uni books get Tier capital before trade history exists.

### Follow-up — revenue / inject frequency (live Railway @ 9833348)

Diagnosed **~$6 tradeable**, T1 on UNI/CBBTC/LINK that never hit buy triggers (stale 90d MINs), SKI/DRB LOSE_ZERO→OUT spam, unknown-cost dust stuck. Fix path: small-book capital concentration, inject-main pullback entry, tier-before-hitch, dust recycle. Still never sell/insert at a loss.

### Follow-up — Arena board + LINK-first piggy (2026-09-08)

- Prefer **LINK** for reserved inject seat; **8%** LINK piggy leave-behind.
- Promote **VVV / ZORA / BNKR** to inject-mains (already Uni V3 KEEP).
- Live learning UI: Railway service `/board` (Control Board hub; `/arena` + `/engine` still work). See `BOARD.md`.

---

## Prior scout notes (2026-09-07 morning)

REI / CLANKER promoted. STONKEX / BLUECHIP / VELVET / KTA stay frozen. See git history for full DexScreener tables.
