# Guardian Control Board

**One hub** for humans and agent bots. Do not hunt README / HANDOFF / Telegram `/help` / scattered markdown for “where do I tune this?”

Live URL: `https://guardian-protocol-agent-production.up.railway.app/board`  
Health: `/board/health` (also `/health`)

| Open this | What it is |
|---|---|
| **`/board`** | Control Board — waves + Arena learn + param sim + V4 status |
| `/engine` | Full wave / surfer / hitch hardware view |
| `/arena` | Full ledger game + practice sim |
| `guardian-protocol/` dashboard `:8787` | **Different Arena** — L1 research simulator, not Railway |
| `npm run start:v4` | **Different process** — Uniswap V4 offshoot (`GUARDIAN_V4_*`) |

## SIM vs LIVE

- **SIM (default):** `/board/api/sim` practice rounds, V4 paper inject, storage-token capacity. Labeled estimates. Never spends RISK.
- **LIVE:** paste `VITA_WEBHOOK_SECRET` only to read `/arena/api/snapshot` or queue Telegram-equivalent commands. Confirm the spend checkbox first.
- This board **does not** POST into Railway env. Piggy %, hitch mult, `LOSE_ZERO` change in Railway variables or Telegram — not an open unauthenticated mutate.

## Where to tune params

| Knob | Live (read-only on the board) | Sim override |
|---|---|---|
| Piggy % | `PIGGY_BANK_PCT` (default **5%**; LINK **8%**) | slider on `/board` |
| Dust floor USD | `PIGGY_BANK_MIN_USD` (default **$0.15**) | slider |
| `HITCH_COST_MULT` | env, default **2×** on sells (buys stay 1×) | slider |
| `LOSE_ZERO` / `HALT_NEW_ENTRIES` | env `yes` | checkbox (sim hold only) |
| COST_EDGE | **always on** in code (not an env toggle) | checkbox to include/skip in sim |
| Peak-ride | **always on** (hist-max touch is **not** a sell) | display + sim flag |

## LOSE-ZERO (do not weaken)

- Never sell underwater (leftover after fees ≤ 0 → hold).
- Hitch Eureka only when leftover covers; otherwise **plain** swap — never lose to insert storage.
- Piggy dust never sells except explicit `/piggyunlock`.
- Vault never spends.
- No invented P&L.

## Uniswap V4 beside V3

V4 is **not** started by this webhook. Catalog + paper sim live on `/board#v4` and `GET /board/api/v4`.

```bash
npm run start:v4 -- --once    # paper cycle, then exit
npm run start:v4              # loop (still DRY_RUN=yes by default)
npm run test:v4
```

Env prefix `GUARDIAN_V4_*`. Isolated lockfile + `guardian-v4/state/`. Root `agent.js` (V3) is untouched.

## What used to be scattered

| Old place | What it said | Now |
|---|---|---|
| Root `README.md` Arena + Engine URLs | two boards, no hub | README points here first |
| `public/arena.html` “default 2% piggy” | **stale** vs code default **5%** | board snapshot + this file |
| `guardian-protocol/HANDOFF.md` + `docs/AGENT_ARENA.md` | L1 strategy Arena | sideline — not `/arena` |
| `guardian-protocol/docs/SYSTEM_LOOP.md` | storage-token loop CLI | `/board` storage panel + `npm run sim:capacity` |
| `guardian-v4/README.md` | CLI-only V4 | `/board#v4` status + same start commands |
| Telegram `/help` | commands only | still valid; board is the visual cheatsheet |

Deep docs remain where they are (architecture, constitution, whitepaper). This file is the **operator on-ramp**.
