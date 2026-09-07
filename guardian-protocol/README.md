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
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | Dual-lane + peer review vs 0x / Hyperliquid / Arbitrum |
| [docs/SIMULATION.md](./docs/SIMULATION.md) | Simulator contracts |
| [docs/WHITEPAPER.md](./docs/WHITEPAPER.md) | Thesis v0.1 |
| [docs/ROADMAP.md](./docs/ROADMAP.md) | Sprint ladder |

## Relation to the injector baseline

Root modules (`bitstorage-orchestrator.js`, strand assembler, L1 fee oracle, hitch) demonstrate **Trickle-style** commitments hitching rides on existing economic activity (Base calldata). This package abstracts that pattern into a **research Arena** so strategies can compete without touching production trading paths.

Inspiration (research candidates, not hard dependencies):

- [0x](https://0x.org) — intent / swap routing patterns
- [Hyperliquid](https://hyperliquid.xyz) — high-throughput L1 execution & state efficiency
- [Arbitrum](https://arbitrum.io) — compressed data availability / L2 posting economics

## Arena baseline

Strategy: `FIFO-0.1`  
Benchmark: `0001-tiny`  
Win condition: exact reconstruction + complete replay evidence.
