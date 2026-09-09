# HANDOFF — Agentic Memory Layer-1 / Guardian Protocol

**Status:** Foundational research / simulation specification v0.2.0  
**Audience:** Human developers, autonomous coding agents, researchers  
**Relation to live trader:** This tree is a **sideline**. Do not modify root `agent.js`, hitch/injector, or trading gates from here.

**Not the live Control Board.** Railway `/board` (see repo-root [`BOARD.md`](../BOARD.md)) is the V3/V4 operator hub. This HANDOFF is L1 research Arena only (`npm run dashboard` on :8787).

---

## Read order (mandatory)

1. This file (`HANDOFF.md`)
2. `docs/CONSTITUTION.md`
3. `docs/ARCHITECTURE.md`
4. `docs/HYPERLIQUID_BLUEPRINT.md` — **Agentic Memory Network** dual-engine L1 blueprint
5. `docs/SIMULATION.md`
6. Inspect `simulator/` and `strategies/`
7. Sprint 6 loop: `docs/SYSTEM_LOOP.md` + `npm run arena:crypto-stress`

---

## LLM Handoff Summary

> We are building an Application-Specific Layer-1 as a permanent, quantum-resistant memory substrate for global AI.
>
> **Architecture:** Hyperliquid-inspired dual engines under **MemoryBFT** (sub-second, reorg-resistant finality — design target).
>
> - **DataCore** — deterministic native DePIN orchestration: sparsing, pluggable compression routing, PQ-sealed pointers; near-zero-gas anchoring is a **hypothesis**
> - **AgenticEVM** — dual-block EVM (small ~1s / large ~60s targets) for agents, Storage Token, x402 candidates, 0x-style routing; agents read DataCore via precompiles (**no bridge**)
>
> **Mandate:** Keep Tier-2 physical fragments off the congested contract lane; anchor commitments on L1; evolve compression modules in the Arena. Arbitrage→storage subsidy is simulated, never assumed. Grand Challenge still requires `reconstructed_bytes == canonical_original_bytes`.
>
> Full blueprint: `docs/HYPERLIQUID_BLUEPRINT.md`.

---

## Peer-review corrections (cumulative)

| Version | Fix |
|---|---|
| 0.1.1 | Hyperliquid ≠ messaging bridge; dual-engine L1 paradigm |
| 0.1.2 | Adopt MemoryBFT naming, dual-block AgenticEVM, Tier-1 ML-DSA sealing, Swarm Manager role, arbitrage-subsidy as explicit hypothesis |

**Stack:**

- **Hyperliquid** → dual-engine + dual-block + shared BFT blueprint  
- **0x** → value/intent routing on AgenticEVM  
- **Arbitrum** → compression/DA cost economics  
- Messaging bridges → not required for DataCore↔AgenticEVM  

---

## What this project is

An open, decentralized **memory and knowledge-preservation** architecture aiming at an application-specific Layer-1:

| Layer | Role |
|---|---|
| MemoryBFT | Shared sub-second consensus (research target) |
| DataCore | Native ingestion / Swarm Manager / commitment anchoring |
| AgenticEVM | Dual-block programmable lane: token, agents, payments, routing |
| Canonical truth | Bit-for-bit recoverable information |
| Trickle | Cryptographic state pointers (DataCore-native ideally) |
| Swarm (Tier 2) | Physical encrypted/PQ-sealed fragments on DePIN nodes |
| Personal Node (Tier 1) | Stateless local ingest, compress, ML-DSA seal |
| Arena | Neutral competition under identical benchmarks |

**Core principle:** Preserve the original. Improve everything around it.

**L1 thesis:** Separate heavy data ingestion (DataCore) from smart-contract logic (AgenticEVM) under **one** MemoryBFT domain so agents read memory state with no bridge.

---

## What this project is NOT

- Not the live Base trading bot in the repo root  
- Not a claim that simulations are production results  
- Not permission to treat a pointer/URL/hash as lossless preservation  
- Not a token/mainnet deployment sprint  
- Not “bridge messages between chains and call that a memory L1”  
- Not a claim that Hyperliquid’s published throughput/finality numbers are already our measurements  
- Not a guarantee that arbitrage funds storage forever  

The root injector (`bitstorage-orchestrator.js`, hitch, `$STORE`) is a **transitional technology baseline**. This package stays independently runnable while the dual-engine L1 is designed and simulated.

---

## Agent on-ramp

1. Read HANDOFF + Constitution + Architecture + Hyperliquid blueprint + Simulation  
2. Run `npm test` in `guardian-protocol/`  
3. Run `npm run benchmark`  
4. Inspect `arena/reports/` and `benchmarks/0001-tiny/`  
5. Fork or compose a strategy under `strategies/`  
6. Declare assumptions; produce trace + metrics  
7. Compare against FIFO baseline in the Arena  
8. Submit a reproducible artifact; preserve lineage  

### Submission schema

```text
strategy_name
strategy_version
author_or_agent_id
parent_strategy
assumptions
dependencies
benchmark_version
execution_command
input_hash
output_hash
trace_log
metrics
resource_usage
cost_model
limitations
reproduction_instructions
```

---

## Immediate coding rule

Do **not** redesign the entire project from scratch.

1. Inspect the repository  
2. Preserve working components  
3. Run existing tests  
4. Implement the smallest reproducible increment  
5. Add tests  
6. Generate a benchmark  
7. Record the result  
8. Document assumptions  
9. Update CHANGELOG / version notes  

If you discover a better architecture, **prove it in the Arena** before replacing the baseline.

---

## Language rules

| Word | Meaning |
|---|---|
| Theory | Proposed explanation or design |
| Hypothesis | Testable claim |
| Simulation | Modeled result |
| Measurement | Result from a real implementation/environment |
| Proof | Mathematical or cryptographic claim |
| Benchmark | Reproducible experiment with defined conditions |
| Production | Deployed system with real resources |

Never present a simulation as production. Never present a hypothesis as proof. Never present a pointer as lossless preservation. Never fabricate benchmark numbers. Never assume arbitrage profit.

---

## Mission

> Build an open, verifiable memory network in which canonical information can endure, distributed infrastructure can preserve it, and human and artificial intelligence can continuously compete and cooperate to make preservation more efficient—without destroying the evidence of what came before.

**Grand Challenge:** `reconstructed_bytes == canonical_original_bytes` with full evidence.
