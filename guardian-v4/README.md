# Guardian V4 Offshoot — Base Uniswap V4 injector

> Completely separate from root `agent.js` (Uniswap V3). Different process, lockfile, state directory, and `GUARDIAN_V4_*` env prefix — so the live V3 bot keeps running.

## Why this exists

Root Guardian only speaks **Uniswap V3 `exactInputSingle`**. DOT’s deep Base book (and many popular names) live on **Uniswap V4**. This offshoot mirrors the inject + Eureka hitch pathway on V4 without freezing or rewriting the production V3 agent.

The love note is still:

`§$STORE§ Eureka! VITA lives ♥ love you Krystian, Kai & Koda! …`

It hitches **after a real leftover-covered swap**, not as a fake “data field” claim on a plain trade.

## Run separately

```bash
# from repo root — does NOT start agent.js
npm run start:v4

# single cycle then exit
npm run start:v4 -- --once

# tests (V4 only)
npm run test:v4
```

Defaults to **`GUARDIAN_V4_DRY_RUN=yes`** (builds calldata + hitch, does not broadcast).

Live broadcast needs a **dedicated** key and Permit2 approvals — do not casually share the V3 hot wallet.

| Env | Purpose |
|---|---|
| `GUARDIAN_V4_DRY_RUN` | `yes` (default) / `no` |
| `GUARDIAN_V4_RPC_URL` | Base RPC |
| `GUARDIAN_V4_PAPER_USD` | Paper book size for ranking |
| `GUARDIAN_V4_CYCLE_MS` | Loop interval |
| `GUARDIAN_V4_SHARE_ROOT_ENV` | `yes` only if you intentionally share root env names |

State: `guardian-v4/state/` (`tokens.json`, lockfile). Root `tokens.json` / `positions.json` are untouched.

## Avenue catalog (popular V4 inject surfaces)

Seeded in `tokens.js` (also written to `state/tokens.json` on boot):

**Priority / Polkadot path**
- `DOT` — Uni V4 DOT/ETH 1% (deep V4 book)
- `POLKADOT_BASE` — polkadot base / ETH 0.3%
- `UDOT` — watch (V3 Universal DOT until V4 ETH book appears)

**Majors / Base staples on V4**
- `CBBTC`, `AERO`, `TOSHI`, `VIRTUAL`, `UNI`, `VVV`
- `DEGEN`, `BRETT` — scout (thinner V4 vs V3)

**High-activity V4 natives**
- `BASECAT`, `HABIBI`, `LAPTOP`, `APPLE` (🍎), `ANSEM`, `CLAWBANK`, `CYB3RWR3N`, `BODEN`, `FLASH`, `VVVEITY`

**Deferred**
- `XPL` (Plasma) — no usable Base V4 ETH book yet; planned as a separate Plasma/BSC lane, not this process

## Architecture touch rules

| Path | Role |
|---|---|
| Repo root `agent.js` | Live **V3** injector — do not rewrite from V4 work |
| `guardian-v4/` | **V4** offshoot — own agent, swap encoder, catalog, tests |
| `guardian-protocol/` | L1 research sideline |

## Hitch honesty

- Leftover covers hitch → Eureka UTF-8 trailer on the Universal Router `execute` calldata
- Leftover too thin → **plain swap** (letter skipped; never lose to insert storage)
- `/prove` data-only path remains available when there is no leftover swap
