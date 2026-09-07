# Guardian Protocol — Agentic Memory Layer-1

**Sideline research package** inside `guardian-protocol-agent`.  
The live Uniswap/Base trading injector stays at the **repo root** and is not modified by this tree.

> Preserve the original. Improve everything around it.

## Quick start

```bash
cd guardian-protocol
npm test
npm run benchmark
```

Outputs land in:

- `arena/reports/` — JSON benchmark reports
- `benchmarks/0001-tiny/` — tiny canonical object + last run artifacts

## What exists (Sprint 1)

Working **event-driven simulator**:

1. Canonical input loader + SHA-256
2. Fixed-size chunker
3. Dual-lane-aware injection state machine
4. FIFO + fixed chunk + static reserve baseline
5. Simulated DePIN storage nodes
6. Cost + treasury models (labeled assumptions)
7. Bit-for-bit integrity verifier
8. Replay log + metrics engine
9. Benchmark runner → JSON report

## Navigation for agents & humans

| Doc | Purpose |
|---|---|
| [HANDOFF.md](./HANDOFF.md) | Single on-ramp |
| [docs/CONSTITUTION.md](./docs/CONSTITUTION.md) | Invariants |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | Dual-lane + dual-engine peer review |
| [docs/HYPERLIQUID_BLUEPRINT.md](./docs/HYPERLIQUID_BLUEPRINT.md) | Corrected L1 theory: DataCore + AgenticEVM (not a bridge) |
| [docs/SIMULATION.md](./docs/SIMULATION.md) | Simulator contracts |
| [docs/WHITEPAPER.md](./docs/WHITEPAPER.md) | Thesis v0.1 |
| [docs/ROADMAP.md](./docs/ROADMAP.md) | Sprint ladder |

## Relation to the injector baseline

Root modules (`bitstorage-orchestrator.js`, strand assembler, L1 fee oracle, hitch) demonstrate **Trickle-style** commitments hitching rides on existing economic activity (Base calldata). This package abstracts that pattern into a **research Arena** so strategies can compete without touching production trading paths.

Inspiration (research candidates, not hard dependencies):

- [Hyperliquid](https://hyperliquid.xyz) — **primary blueprint**: dual-engine L1 (native core + EVM under one BFT) → DataCore + AgenticEVM
- [0x](https://0x.org) — intent / value routing on AgenticEVM
- [Arbitrum](https://arbitrum.io) — compressed DA / posting cost economics for models and interim hitching

Do not conflate Hyperliquid with messaging bridges. See `docs/HYPERLIQUID_BLUEPRINT.md`.

## Arena baseline

Strategy: `FIFO-0.1`  
Benchmark: `0001-tiny`  
Win condition: exact reconstruction + complete replay evidence.
