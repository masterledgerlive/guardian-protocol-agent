# Roadmap

## Sprint 1 — Scientific instrument ✅ (this package)

Canonical loader, hashing, chunker, state machine, FIFO scheduler, simulated nodes, cost/treasury, verification, replay, metrics, benchmark runner, JSON report.

## Sprint 2 — Observability

Dashboard, replay viewer, strategy registry UI, comparison, leaderboard, submission validation.

## Sprint 3 — Competing strategies

FIFO, adaptive batching, cost optimizer, priority scheduler, redundancy optimizer.

## Sprint 4 — Stress & long-tail

Failure simulation, node churn, bandwidth constraints, repair, retrieval demand, long-tail/short-tail modeling.

## Sprint 5 — Real adapters

Adapters to live hitch/injector, DA layers, and storage networks—only after the simulator is trustworthy. Still must not silently rewrite production trading paths.

## Later — Dual-engine L1 (theory → design)

After Arena trust: specify **MemoryBFT** assumptions, DataCore native actions + Swarm Manager, AgenticEVM **dual-block** interfaces and read precompiles, Tier-1 ML-DSA seal modules (see `HYPERLIQUID_BLUEPRINT.md`). Simulate finality/reorg and dual-block congestion before any chain implementation.
