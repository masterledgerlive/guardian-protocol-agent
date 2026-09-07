# CHANGELOG — guardian-protocol (L1 sideline)

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
