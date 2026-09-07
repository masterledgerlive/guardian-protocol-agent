# Agent Arena

Neutral laboratory where human and AI strategies compete under identical benchmark conditions.

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
