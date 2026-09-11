# Guardian Control Board

**One hub** for humans and agent bots to find and use **live Uniswap V3 inject avenues**. Do not hunt README / HANDOFF / Telegram `/help` / scattered markdown for “where do I hitch?”

Live URL: `https://guardian-protocol-agent-production.up.railway.app/board`  
Health: `/board/health` (also `/health`)  
V3 Arena (unchanged): `/` and `/arena` · Engine: `/engine`  
V4: **deferred** — `/v4` docs link only. Do not expand V4 in this hub.

| Open this | What it is |
|---|---|
| **`/board`** | Control Board — V3 hitch surfaces, outlet KEEP/CUT/CAUTION scoreboard, leftover/hitch capacity, piggy, bot-usage piggy, earn sim, gated live queue |
| `/engine` | Full wave / surfer / hitch hardware view |
| `/arena` | Full ledger game + practice sim |
| `guardian-protocol/` dashboard `:8787` | **Different Arena** — L1 research simulator, not Railway |
| `npm run start:v4` | **Different process** — Uniswap V4 offshoot (`GUARDIAN_V4_*`). Isolated/linked only. |

## SIM vs LIVE

- **SIM (default):** `/board/api/sim` practice leftover-covered inject on **V3** hitch surfaces + storage-token capacity. Labeled estimates. Never spends RISK. Never encodes V4.
- **LIVE:** paste `VITA_WEBHOOK_SECRET` only to read `/arena/api/snapshot` or queue Telegram-equivalent commands (`buy` / `sellhalf` / `piggyunlock` / `prove`). Confirm the spend checkbox first.
- This board **does not** POST into Railway env. Piggy %, hitch mult, `LOSE_ZERO` change in Railway variables or Telegram — not an open unauthenticated mutate.

## Live V3 inject hooks (this hub)

Public JSON: `GET /board/api/inject` (catalog parsed from `agent.js` as text — the hub does **not** import the live injector).

| Surface | What to use |
|---|---|
| **Tradeable hitch surfaces** | Every catalog name that is not `frozen` / `disabled`. Hitch KEY+LOC only when leftover covers; otherwise plain swap. |
| **Outlet scoreboard** | KEEP / CUT / CAUTION — `GET /board/api/scoreboard`. GAME ghost is **CUT**. Always-plus leftover sells stay open. |
| **Inject mains** | `LINK` (favorite) `UNI` `VVV` `ZORA` `BNKR` `AERO` `MORPHO` — prefer leftover-covered inject. |
| **Deferred majors** | `CBBTC` `AAVE` — frozen, not inject seats. |
| **Leftover / hitch capacity** | Same lose-zero math as production. Demo = labeled assumptions. Authorized snapshot uses leftover from **holding** waves (price vs entry) — still estimated, never `hitchProve` P&L. |
| **Piggy leave-behind** | Default **5% / $0.15**; LINK **8% / $0.25**. Dust never sells except `/piggyunlock`. |
| **Earn sim** | Per-main “Sim SYMBOL” + Run sim round. Negative wave = hold. Hitch only if leftover covers. |
| **Operator live (gated)** | Queue buy ~$2, sell half, piggy unlock, hitch prove on the selected inject main. |

Frozen/disabled names are listed on the board so agents do not try to hitch them.

## Bot usage piggy (Grok)

Monthly Grok Bot cost is modeled as a **piggy / transmission cost** that hitch leftover-earnings must cover. It is **not** token-dust piggy and **not** the vault.

| Knob | Value | Rule |
|---|---|---|
| Game now | **$20 / month** | Cover with leftover-covered profitable V3 exits after hitch + piggy buffer. |
| Pro | **$60 / month** | Unlock **only after proven hitch revenue** (on-chain hashes). |
| Kind | `demo\|example` | Default on this hub. `live-hashes` only when **both** hitch revenue hashes **and** a finite USD are supplied. |

Never invent P&L:

- Hitch-tag insert cost is **not** income.
- Sim leftover / DEMO capacity is **not** Grok coverage.
- Bot-internal `hitchProve` counters are **not** Grok P&L.
- Do not map `hitchInjectProfitUsd` to Grok coverage without hashes.

Dust piggy never sells to pay Grok. Vault never spends.

## Where to tune params

| Knob | Live (read-only on the board) | Sim override |
|---|---|---|
| Piggy % | `PIGGY_BANK_PCT` (default **5%**; LINK **8%**) | slider on `/board` (blank = catalog) |
| Dust floor USD | `PIGGY_BANK_MIN_USD` (default **$0.15**) | slider |
| `HITCH_COST_MULT` | env, default **2×** on sells (buys stay 1×) | slider |
| `LOSE_ZERO` / `HALT_NEW_ENTRIES` | env `yes` | checkbox (sim hold only) |
| COST_EDGE | **always on** in code (not an env toggle) | checkbox to include/skip in sim |
| Peak-ride | **always on** (hist-max touch is **not** a sell) | display + sim flag |

## Outlet scoreboard (KEEP / CUT / CAUTION)

Public JSON: `GET /board/api/scoreboard` (also nested on `/board/api/inject`).

Hitch **while traveling** swap routes — only on Uni V3 WETH/USDC that Quoter
actually fills. Cut outlets that lose; keep ones that can earn. Rates are
**observed on-chain receipts** or `null`. Never invent P&L.

| Recommend | Meaning |
|---|---|
| **KEEP** | Tradeable Uni V3 hitch surface (inject mains first). Hitch KEY+LOC if leftover covers. |
| **CAUTION** | Frozen exits-only (CBBTC / AAVE / XCN / thin books). No new buys. Leftover-green sells stay open (**always-plus**). |
| **CUT** | Proven loser / no SwapRouter02 book. GAME ghost is the class: Uni V3 WETH fee 3000 `liquidity()=0`, three mined STF reverts (`0x2644773a…`, `0x2589e0a3…`, `0x280e898e…`). WELL (Aerodrome) and KITE (no pool) are CUT too. |

GAME is catalog-**frozen** CUT. `/unfreeze` must not treat it as a hitch seat.
Always-plus (#62): CUT freezes **buys**, never leftover-green **sells**. HOLD if proceeds < buy cost; hitch shrinks or SKIP; no orch re-hitch after strip.

### Route awareness (Base Uni V3 fees)

Before a buy, enumerate fee tiers **100 / 500 / 3000 / 10000**. Keep the ones
Quoter fills. Skip `liquidity()=0`. Pick the deepest/cheapest **effective**
path (most `amountOut`, then lower fee). Do not send to a ghost pool.

Live submit hardening (Quoter miss never sends) is on main via #61
`quote-swap-guard.js` — this hub ranks routes and freezes CUT names. Do not
merge V4 into this V3 injector.

### Cheaper hitch (KEY+LOC ~69 B vs Eureka 229 B)

Leftover hitch stays dense **KEY+LOC** (`VITA_HITCH_MODE=vita`). Eureka 229 B
leftover is the expensive class (GAME fail hitch). `/prove` keeps the love note.

On a **~$3 liquid bag**, LOSE-ZERO hitch rate is labeled on the board
(`hitchDensity`): leftover ≈ 2% of bag. If leftover covers KEY+LOC but not
Eureka, hitch KEY+LOC. If leftover covers neither, **plain** swap. If leftover
after fees ≤ 0, hitch rate is **0** (always-plus hold).

OP-stack L1 data fee (already `l1-fee-oracle.js`), Arbitrum batch compression,
and Solana memo are **byte-cost lessons** — live inject stays Base V3.

## LOSE-ZERO (do not weaken)

- Never sell underwater (leftover after fees ≤ 0 → hold). **Always-plus** exits.
- Hitch KEY+LOC only when leftover covers; otherwise **plain** swap — never lose to insert storage. Eureka leftover is `/prove`, not thin leftover.
- Piggy dust never sells except explicit `/piggyunlock`.
- Vault never spends.
- No invented P&L.

## Uniswap V4 (deferred — isolate / link only)

V4 is **never** loaded into `agent.js` or the V3 webhook runtime. No shared lockfile, state, or swap encoder. This hub **links** to `/v4` (docs). It does **not** encode Universal Router calldata, start the offshoot, or expand V4 work.

```bash
npm run start:v4 -- --once    # paper cycle, then exit (separate process)
npm run start:v4              # loop (still DRY_RUN=yes by default)
npm run test:v4
```

Env prefix `GUARDIAN_V4_*`. Isolated lockfile `guardian-v4/state/guardian-v4.lock`. Root `tokens.json` / `positions.json` / V3 live swaps untouched.

## What used to be scattered

| Old place | What it said | Now |
|---|---|---|
| Root `README.md` Arena + Engine URLs | two boards, no hub | README points here first |
| `public/arena.html` “default 2% piggy” | **stale** vs code default **5%** | board snapshot + this file |
| `guardian-protocol/HANDOFF.md` + `docs/AGENT_ARENA.md` | L1 strategy Arena | sideline — not `/arena` |
| `guardian-protocol/docs/SYSTEM_LOOP.md` | storage-token loop CLI | `/board` storage panel + `npm run sim:capacity` |
| `guardian-v4/README.md` | CLI-only V4 | `/v4` docs page (deferred; no V4 runtime in V3) |
| Telegram `/help` | commands only | still valid; board is the visual cheatsheet |

Deep docs remain where they are (architecture, constitution, whitepaper). This file is the **operator on-ramp**.
