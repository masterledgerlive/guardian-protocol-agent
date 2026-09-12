# Agent Arena (L1 research)

Neutral laboratory where human and AI strategies compete under identical benchmark conditions.

This is **not** the live Railway Control Board (`/board`) or the V3 ledger game (`/arena`). Those live on the root webhook — see repo-root `BOARD.md`. This document is the **simulator** Arena under `guardian-protocol/`.

## Player offshoot (DEGEN VILLAGE takeaways)

Repo-root `guardian-arena-player/` — optional paper/sim **player** activated with
`ARENA_PLAYER=yes`. Inspired by [zostaff/agent-arena](https://github.com/zostaff/agent-arena).

- Heuristic FLY brain when Cursor/VITA agent credits burn (~1 hour).
- Trading bots (V3/V4) always continue without agents.
- See `thinking/AGENT_ARENA_TAKEAWAYS.md` and `guardian-arena-player/README.md`.

## Baseline

`FIFO-0.1` — FIFO queue + fixed chunk size + static reserve.

Purpose: reproducibility, lower-bound reference, verify infrastructure. Not assumed good—assumed measurable.

## Scoring dimensions

Lower cost, higher throughput, lower latency, better reconstruction probability, lower storage/proof overhead, better utilization, economic sustainability, reliability, energy efficiency.

## Leaderboards (Sprint 2+)

Absolute · Cheapest · Fastest · Smallest · Most resilient · Most efficient · Most improved · Best agent  

All must expose underlying evidence. Prefer Pareto frontier; configurable multi-objective weights must be visible.

## Safety

Sandbox only. “Break the protocol” means attack design assumptions in simulation—not real infrastructure.
