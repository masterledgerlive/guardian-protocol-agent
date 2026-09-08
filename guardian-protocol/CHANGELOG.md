# CHANGELOG — guardian-protocol (L1 sideline)

## 0.2.0 — 2026-09-07

### Sprint 2 — Observability
- Dashboard server + public UI (`npm run dashboard`)
- Replay viewer (play/pause/step/reverse/jump/filter/inspect/compare)
- Leaderboards + Pareto frontier + submission schema validation
- Arena multi-strategy compare (`npm run arena:compare`)

### Sprint 3 — Competing strategies
- `ADAPTIVE-0.1`, `COSTOPT-0.1`, `PRIORITY-0.1`, `REDOPT-0.1` registered beside `FIFO-0.1`

### Sprint 4 — Stress & long-tail
- FailureModel (node drop, churn, bandwidth cap)
- Multi-replica retrieve + repair; storage online/offline
- `npm run arena:stress` benchmark

### Sprint 5 — Adapter stubs
- HitchInjector / DA / storage-network stubs with explicit no-root-trader boundary

## 0.1.2 — 2026-09-07

- Redesigned Agentic Memory Network blueprint: **MemoryBFT**, DataCore Swarm Manager, AgenticEVM dual-block pacing, Tier-1 ML-DSA sealing
- LLM handoff summary embedded in HANDOFF + HYPERLIQUID_BLUEPRINT
- Arbitrage→storage subsidy documented as explicit economic **hypothesis** (never assumed)

## 0.1.1 — 2026-09-07

- Peer-review correction: Hyperliquid is the **dual-engine L1 blueprint** (DataCore + AgenticEVM under one BFT), not a messaging bridge
- Add `docs/HYPERLIQUID_BLUEPRINT.md`; update HANDOFF, ARCHITECTURE, ECONOMICS, WHITEPAPER, README
- Clarify 0x = AgenticEVM value routing; Arbitrum = compression/DA cost economics; remove Hyperlane-as-core framing

## 0.1.0 — 2026-09-07

- Initial sideline package: thesis docs, constitution, architecture peer-review vs 0x / Hyperliquid / Arbitrum patterns
- Sprint 1 simulator: canonical loader, SHA-256, chunker, state machine, FIFO-0.1, storage/treasury/cost models, verifier, replay, metrics, benchmark 0001
- Arena registry + reproducible JSON report for FIFO baseline
- Explicit boundary: does not modify root trading injector
