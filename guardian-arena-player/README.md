# Guardian Arena Player (offshoot)

Optional **player** mode inspired by [zostaff/agent-arena](https://github.com/zostaff/agent-arena)
(DEGEN VILLAGE). Isolated from V3/V4 trading injectors.

## Why

- Study arena patterns (never-throw brain, stat compiler, paper ledger, FLY heuristic).
- When activated, Guardian can **play** paper/sim ticks.
- Cloud agents / VITA LLM credits burn ~**1 hour** — bots must keep running on
  heuristics until credits refresh.

## Activation

```bash
ARENA_PLAYER=yes npm run arena:player
# or
node guardian-arena-player/run.js --force --ticks=80 --class=FLY
```

Unset / absent `ARENA_PLAYER` → CLI exits idle. V3/V4 Railway loops unchanged.

## Hour gate

`agent-hour-budget.js` tracks an assist window (default 1h wall clock).

| State | Brain | Trading bots |
|---|---|---|
| Credits available | live brain allowed (if wired) | normal |
| Hour burned | **heuristic / FLY only** | **still run** |
| Credits refresh | assist re-arms | normal |

## Modes

| Mode | Market | Brain default | Keys / money |
|---|---|---|---|
| `sim` | seeded | heuristic | none |
| `paper` | sim identities for now (Coinbase adapter later) | heuristic | virtual ETH |
| `live` | not wired in this offshoot | — | dry-run only if added later |

## Thinking notes

See `thinking/AGENT_ARENA_TAKEAWAYS.md`.
