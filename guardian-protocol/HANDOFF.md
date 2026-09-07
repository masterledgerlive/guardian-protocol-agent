# HANDOFF — Agentic Memory Layer-1 / Guardian Protocol

**Status:** Foundational research / simulation specification v0.1  
**Audience:** Human developers, autonomous coding agents, researchers  
**Relation to live trader:** This tree is a **sideline**. Do not modify root `agent.js`, hitch/injector, or trading gates from here.

---

## Read order (mandatory)

1. This file (`HANDOFF.md`)
2. `docs/CONSTITUTION.md`
3. `docs/ARCHITECTURE.md`
4. `docs/SIMULATION.md`
5. Then inspect what already exists under `simulator/` and `strategies/`

---

## What this project is

An open, decentralized **memory and knowledge-preservation** architecture:

| Layer | Role |
|---|---|
| Canonical truth | Information that must remain recoverable bit-for-bit |
| Cryptographic state (Trickle) | Commitments, manifests, hashes, provenance |
| Physical preservation (Swarm) | Distributed encrypted fragments / DePIN |
| Knowledge/index | Retrieval structures (may be lossy if labeled) |
| Agentic refinement | Competing strategies in the Arena |
| Arena | Neutral simulation where strategies compete under identical rules |

**Core principle:** Preserve the original. Improve everything around it.

---

## What this project is NOT

- Not the live Base trading bot in the repo root
- Not a claim that simulations are production results
- Not permission to treat a pointer/URL/hash as lossless preservation
- Not a token/mainnet deployment sprint

The root injector (`bitstorage-orchestrator.js`, hitch, `$STORE`) is a **technology baseline** whose ideas (calldata hitch, dual-lane queue, strand assembly, L1 fee awareness) inform this research. This package must remain independently runnable.

---

## Agent on-ramp

1. Read HANDOFF + Constitution + Architecture + Simulation
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

Do **not** redesign from scratch.

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

Never present a simulation as production. Never present a hypothesis as proof. Never present a pointer as lossless preservation. Never fabricate benchmark numbers.

---

## Mission

> Build an open, verifiable memory network in which canonical information can endure, distributed infrastructure can preserve it, and human and artificial intelligence can continuously compete and cooperate to make preservation more efficient—without destroying the evidence of what came before.

**Grand Challenge:** `reconstructed_bytes == canonical_original_bytes` with full evidence.
