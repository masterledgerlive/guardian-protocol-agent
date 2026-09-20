# GRAFT — prompt-trial offshoot

> Completely separate from VITA (`vita/`) and the live Uniswap V3 bot (`agent.js`).
> Different process, state directory, and `GRAFT_*` env prefix.

**Name:** GRAFT (a scion grafted beside living rootstock).

**What it is:** a nursery for the *many* architecture prompts AI will dump.
You **file** them here (Cursor or Telegram), **activate** the ones you want to
spend on, throw money at the GRAFT piggy, and watch the thought log. Later you
study last-root + survival marks and harvest only what the data keeps.

**What it is not:** VITA. Not the live trader. Not an S3/Neo4j/KMS stack.
The LLM prompt that seeded this offshoot proposed that enterprise filer.
GRAFT is the *offshoot of that idea*: local-first, thought-visible, money-gated,
last-root-only, harvest-later.

## Why this exists

You asked: take one AI architecture dump, name a place to keep throwing more
of them, give Telegram controls so you can put money on the thought process,
and only later use what the data says survived.

GRAFT is that place. Seeds already filed (not ON until you activate):

| Name | Dump | Offshoot |
|---|---|---|
| **MEMORY-INJECTOR** | lossless knowledge tree / on-chain filer | `memory/offshoot-graft-brief.md` |
| **DAISY** | Unified Agentic Stack L0–L4 (Base + Virtuals ACP/G.A.M.E. + JAM) | `memory/offshoot-daisy-brief.md` |
| **RAIL** | L0–L5 Recursive AI Ledger of Ledgers (Nova/blobs/PQC dump) | `memory/offshoot-rail-brief.md` |

Browse: `/graft dir MODELS`. Compact old-way inject (KEY+LOC spirit, no broadcast): `/graft inject all`. Data log: `/graft dlog` on avenue `graft-compact-inject`.

DAISY does **not** stand up Polkadot, mint an IAO, or hire Render. It maps
those five layers onto GRAFT so you can activate and fund the *filing loop*.
RAIL settles tests in **real Base WETH** (`0x4200…0006`) plus catalog AERO /
VIRTUAL / TOSHI quotes — never a made-up V_CREDIT ticker.

## Run separately

```bash
# from repo root — does NOT start agent.js or VITA
npm run start:graft

# seed both dumps + print status + exit
npm run start:graft -- --once

# file / activate / fund / think (Cursor inlet)
npm run start:graft -- --cmd "/graft dir MODELS"
npm run start:graft -- --cmd "/graft activate RAIL"
npm run start:graft -- --cmd "/graft fund 0.001"
npm run start:graft -- --cmd "/graft rail"
npm run start:graft -- --cmd "/graft inject all"
npm run start:graft -- --cmd "/graft receipts"

# tests (GRAFT only)
npm run test:graft
```

## Telegram

Game-facing cards are prefixed **`[GRAFT]`**. Dry-run still sends when a
dedicated bot token + chat id are set.

**Poller requires its own bot.** `GRAFT_TELEGRAM_BOT_TOKEN` must be a
*different* bot from live Guardian. Two pollers on one token steal updates.
`GRAFT_SHARE_ROOT_ENV=yes` may *send* into the live chat; it will **not** poll.

| Env | Purpose |
|---|---|
| `GRAFT_TELEGRAM_BOT_TOKEN` | Dedicated GRAFT bot (required to poll `/graft`) |
| `GRAFT_TELEGRAM_CHAT_ID` | Chat that may throw money / insert prompts |
| `GRAFT_SHARE_ROOT_ENV` | `yes` only to *send* via plaintext `TELEGRAM_*` (never poll) |
| `GRAFT_DRY_RUN` | `yes` (default) — paper piggy, never broadcasts |
| `GRAFT_THINK_COST_ETH` | Debit per think cycle (default `0.00001`) |
| `GRAFT_THINK_FREE` | `yes` — skip piggy gate (tests only) |
| `GRAFT_FUND_TO` | Optional address you send ETH to; GRAFT records `/graft fund`, it does not sweep V3 |
| `GRAFT_STATE_DIR` | Override state path (tests) |

## Commands

| Command | What it does |
|---|---|
| `/graft` | Help + bag + last-root |
| `/graft insert …` | **File** a prompt losslessly (alias: `file`) |
| `/graft list` | Filed vs activated ideas |
| `/graft activate [id\|last]` | Turn an idea **ON** (alias: `start`) |
| `/graft sleep [id]` | Turn it OFF; still stored (alias: `stop`) |
| `/graft fund <eth>` | Throw money into the GRAFT piggy (paper by default) |
| `/graft think [id\|last]` | Run a visible thought cycle (costs piggy) |
| `/graft tree` | Hierarchical knowledge tree |
| `/graft log [id\|last]` | Thought-process steps |
| `/graft dir` | `GRAFT:\` directory of artifact → loc slots |
| `/graft dir MODELS` | Activate-ready catalog (MEMORY-INJECTOR, DAISY, RAIL) |
| `/graft models` | Same catalog |
| `/graft rail` | Run working RAIL L0–L5 cycle (must be ON; paper credits, not a token) |
| `/graft inject [id\|all]` | Stage compact old-way KEY+LOC packets (no broadcast, no invented tx) |
| `/graft receipts` | Inject-queue receipts (tx empty until a real Base loc exists) |
| `/graft dlog` | Append-only data log on avenue `graft-compact-inject` |
| `/graft proof` | Last-root + short tags (hashes only, no invented txs) |
| `/graft survive [id]` | Human mark: this idea survived |
| `/graft die [id]` | Human mark: this idea died |
| `/graft harvest [id]` | Mark harvest-candidate for later VITA study (does not write VITA) |
| `/graft bag` | Piggy + counts + last-root |

## Architecture (the offshoot, not the LLM's 28-week plan)

| Path | Role |
|---|---|
| `graft/memory/` | Committed seed prompts (append-only) |
| `graft/state/` | Runtime CAS, ledger, thoughts, piggy (gitignored) |
| `graft/store.js` | Content-addressed artifacts, snapshots, Merkle last-root |
| `graft/think.js` | Deterministic refinement + survival score + thought log |
| `graft/commands.js` | Telegram/CLI command parser |
| `graft/telegram.js` | `[GRAFT]` cards + dedicated poller |
| `graft/rail.js` | Working RAIL L0–L5 engine (sha256 mother-root fold) |
| `graft/datalog.js` | Avenue log + compact inject queue |
| `graft/models.js` | Catalog |

Live V3 webhook, VITA HTML, leftover hitch, and piggy-bank are **untouched**.

## Hitch honesty

GRAFT does **not** send swaps or leftover hitches. `/graft inject` stages a
short `§GRAFT§` KEY+LOC packet (the old hitch spirit) so a human can later
ride leftover / `/prove`. Receipt is last-root + inclusion proof until a real
tx exists. **Never invented.** Paper `paperCredit` is not $V_{CREDIT}$ and not
a tradable token. Tests never spend live bags.
