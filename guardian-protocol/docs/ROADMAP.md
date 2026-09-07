# Roadmap

## Sprint 1 — Scientific instrument ✅

Canonical loader, hashing, chunker, state machine, FIFO scheduler, simulated nodes, cost/treasury, verification, replay, metrics, benchmark runner, JSON report.

## Sprint 2 — Observability ✅

Dashboard (`dashboard/server.js` + public UI), replay viewer helpers, strategy registry listing, Arena compare, leaderboards, Pareto frontier, submission validation.

## Sprint 3 — Competing strategies ✅

FIFO · Adaptive batching · Cost optimizer · Priority scheduler · Redundancy optimizer — all registered and Arena-comparable on `0001-tiny`.

## Sprint 4 — Stress & long-tail ✅

Failure model (node drop, churn, bandwidth cap), multi-replica retrieve + repair, long/short-tail taxonomy, `run-stress` benchmark.

## Sprint 5 — Real adapters ✅ (interfaces only)

Stub adapters for hitch/injector boundary, DA layer, and storage network. **Still must not import or rewrite production trading paths.** Live coupling remains an explicit later design step.

## Later — Dual-engine L1 (theory → design)

After Arena trust: specify **MemoryBFT** assumptions, DataCore native actions + Swarm Manager, AgenticEVM **dual-block** interfaces and read precompiles, Tier-1 ML-DSA seal modules (see `HYPERLIQUID_BLUEPRINT.md`). Simulate finality/reorg and dual-block congestion before any chain implementation.
