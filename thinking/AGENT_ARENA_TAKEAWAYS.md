# Thinking — good parts from `zostaff/agent-arena` (DEGEN VILLAGE)

Studied: https://github.com/zostaff/agent-arena (friend's depot).
Mapped into our offshoot: `guardian-arena-player/`.

## Race we are in (live snapshot, 2026-09-12)

- **V3** `guardian-protocol-agent` + **V4** `guardian-v4` both **SUCCESS** on Railway.
- V3↔V4 race scoreboard already wired; Eureka full love note PR (#94) restores IKN letter.
- V4: `dryRun=true`, wallet ~**0.0012 ETH**, cycling CBBTC injects with KEY+LOC hitch (~61 B), `/prove-ready` = **229 B**.
- V3: still scanning/riding bags (TYBG, MIGGLES, TOBY, …) — normal bot loop, **no Cursor agent required**.
- **Restart race after this offshoot lands** — bots keep learning what is running now until then.

## Agent credit burn (why bots must stand alone)

Cloud / Cursor agents and VITA Anthropic calls burn a finite hour of credits.
Observed pattern: **~1 hour useful agent time**, then agents go dark until credits refresh.

Rule we adopt:

1. Trading bots (V3/V4) **always run on heuristics / gates** — never blocked on an agent.
2. Arena **player** mode may use a live LLM brain **only while** `agent-hour-budget` says credits remain.
3. When the hour is burned → player falls back to **heuristic brain** (free, like DEGEN VILLAGE “FLY SWARM”).
4. When credits refresh → budget re-arms; live brain may resume if `ARENA_PLAYER=yes`.

## Good parts taken

| Arena idea | Why it matters | Our mapping |
|---|---|---|
| `Brain.decide()` **never throws** → SKIP | Live nets fail; bots must not crash | `guardian-arena-player/brain.js` `guardDecide` |
| Core zero-deps contracts (`Market` / `Brain` / `Verdict`) | Same engine for sim, paper, live | `types.js` |
| Stat compiler → real config (poll, ctx, size, slip) | Village bars = engine knobs | `config.js` `compileStats` |
| Heuristic / FLY brain = **$0 inference** | Swarm can trade while LLMs are off | `heuristic-brain.js` |
| Modes: `sim` \| `paper` \| `live` | Clear money/key boundaries | `MODE` + `run.js` |
| `costPerDecision` priced from ladder | Know burn rate before calling a house | `config.js` + hour budget |
| `dryRun: true` default for live exec | Safe until operator flips | player `dryRun` default |
| Class lenses (SCOUT/SNIPER/WHALE/ARB) | Prompt/strategy bias without new code | `CLASS_LENS` / `CLASS_STRATEGY` |
| Paper = real identities or quotes, **virtual funds** | Learn without risking RISK wallet | `paper-account.js` |
| Honest provenance labels | Don't confuse paper P&L with chain | snapshot `provenance` |
| Roadmap discipline (“Next up” before commit) | Keep thinking honest | this file + CHANGELOG |

## Deliberately not taken (yet)

- Isometric village / FORGE UI (heavy; our `/arena` ledger game already exists).
- Robinhood Chain / Pons live router (different chain; we stay Base).
- Token launch / memecoin economics.
- Multi-house REWIRE economy coins.

## Activation

```bash
# Study / paper player (no keys, no RISK wallet)
ARENA_PLAYER=yes npm run arena:player

# Or one-shot
node guardian-arena-player/run.js --mode=paper --ticks=200
```

V3/V4 Railway services ignore this unless `ARENA_PLAYER=yes` is set on a dedicated service.
