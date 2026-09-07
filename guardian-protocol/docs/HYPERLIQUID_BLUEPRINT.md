# Architectural Blueprint — Agentic Memory Network (Dual-Engine L1)

**Status:** Architectural theory / research program (not a production claim)  
**Version:** 0.1.2  
**Inspiration:** [Hyperliquid](https://hyperliquid.xyz) dual-engine L1 (HyperCore + HyperEVM under HyperBFT)  
**Correction history:** v0.1.1 removed messaging-bridge conflation; v0.1.2 adopts the full MemoryBFT + dual-block + PQ sealing redesign below.

Language rules still apply: finality timings, zero-gas native actions, and arbitrage subsidies are **design targets / hypotheses** until Arena-measured. Do not present this document as a live chain.

---

## LLM Handoff Summary (orchestrating agents)

> To the orchestrating LLM: We are building an **Application-Specific Layer-1** designed to serve as the permanent, quantum-resistant memory substrate for global AI.
>
> Build upon a **Hyperliquid-inspired Dual-Engine Architecture**. The protocol relies on **MemoryBFT** for sub-second, reorg-resistant finality (target). Execution splits between:
>
> - **DataCore** — deterministic, protocol-native DePIN orchestration (raw data pointers, quantum signatures, swarm routing); native anchoring is a **near-zero-gas hypothesis**
> - **AgenticEVM** — dual-block smart-contract layer where multi-agent swarms may execute 0x-style routing / micro-payments (x402 candidate); arbitrage→storage subsidy is a **conservative simulation hypothesis**, never assumed profit
>
> **Core mandate:** Separate heavy physical storage (**Tier 2 DePIN Swarm**) from cryptographic state pointers (**DataCore / L1 commitments**). Use open, plug-and-play compression modules so the network can evolve toward better “squashing” algorithms. Anchor compressed state-proofs today; future generative AI and quantum-capable processing may improve **derived** representations — Grand Challenge lossless unroll still requires exact canonical recovery evidence.
>
> Prove designs in the Arena. Do not rewrite the live Base injector from this sideline.

---

## Peer-review role map

| Source | Role |
|---|---|
| **Hyperliquid** | Primary blueprint: dual engine + shared BFT + dual-block pacing |
| **0x** | Intent/value routing on AgenticEVM |
| **Arbitrum** | Compression / DA cost economics (interim + CostModel) |
| Messaging bridges | Not required for DataCore↔AgenticEVM reads |

---

## 1. Foundation — MemoryBFT (sub-second consensus)

**Theory:** Replace “everything through congested EVM consensus semantics” with a HotStuff-inspired BFT family modeled on Hyperliquid’s HyperBFT, specialized for memory anchoring. Research name: **MemoryBFT**.

**Design targets (hypotheses to simulate / measure):**

- Shared block order finalized across DataCore + AgenticEVM in roughly **~0.2s** class latency
- Once a sealed memory commitment is finalized, agents should not unroll state that later disappears to a reorg
- Reorg resistance is a **requirement for AI memory trust**; exact latency/safety proofs belong in later consensus benchmarks

**Guardrail:** “Mathematically permanent” marketing language is not a substitute for cryptographic + consensus proofs. Arena and formal specs must define finality and safety assumptions explicitly.

---

## 2. Dual-Engine Execution Layer

One MemoryBFT instance. Two parallel execution environments. No bridge between them.

```text
HyperCore  →  DataCore     (deterministic native data-routing engine)
HyperEVM   →  AgenticEVM   (permissionless EVM + dual blocks)
HyperBFT   →  MemoryBFT    (shared sub-second consensus — research name)
```

### Engine A — DataCore (native ingestion)

Analog to HyperCore: deterministic engine **outside** the EVM (Hyperliquid’s trading core is often described as native/Rust-class; our DataCore is the same *role*, implemented later in whichever systems language the Arena proves).

**Protocol-level actions (not smart contracts):**

- data sparsing / chunk routing decisions
- compression-module dispatch (pluggable)
- cryptographic anchoring of pointers / manifests / Merkle roots
- Swarm Manager: which Tier-2 nodes hold which fragments (without stuffing bulk bytes into EVM state)

**Gas hypothesis:** Native pointer anchoring aims for **near-zero marginal protocol cost** (like Hyperliquid native order actions). Still model cost in the simulator until measured — “zero gas” is a target, not a Sprint 1 fact.

**Physical rule unchanged:** A pointer is not preservation. Swarm must hold reconstruction material (or declared externals).

### Engine B — AgenticEVM (smart-contract lane)

Permissionless Ethereum-compatible environment:

- Storage Token + markets
- AI routing agents
- x402-style payment contracts (candidate)
- 0x-style intent routing / DEX logic

**Read precompiles (bridge-less link):** Because AgenticEVM shares MemoryBFT with DataCore, contracts read fragment location/commitment state via **precompiles / native reads** — no bridges, no oracles, no cross-chain latency for that path.

---

## 3. Dual-Block Architecture (pacing AgenticEVM)

Hyper-stack style pacing so agent micro-ops and heavy deploys do not share one congested block market:

| Block class | Cadence (target) | Gas budget (target) | Intended use |
|---|---|---|---|
| **Small blocks** | ~1s | ~2M gas | High-frequency agent ops, micro-fees, 0x-style fills |
| **Large blocks** | ~60s | ~30M gas | Heavy “meshing” contracts, large orchestration deployments |

These numbers are **design targets** copied from the Hyper-stack pattern for research — tune via Arena experiments; do not hard-code as protocol law without measurement.

DataCore native actions are **not** forced through AgenticEVM gas markets; dual-block pacing primarily protects the programmable lane.

---

## 4. Stateless ingestion & quantum protection

### Tier 1 — Personal Nodes (stateless clients)

Open-source desktop/browser (and future headless) software:

1. Ingest user/canonical data locally  
2. Optional local AI digest/compress (**derived** layers must be labeled; lossless claims need exact bytes)  
3. Seal with **ML-DSA (Dilithium)** post-quantum signatures (cryptography-agile; alternatives remain candidates)  
4. Emit manifest + injection intent to DataCore  

Stateless client: does not need to hold the full chain; holds keys, local workspace, and receipts.

### Tier 2 — DePIN Swarm

User/agent triggers injection → DataCore routes **quantum-sealed fragments** to storage nodes → immutable pointer/commitment anchors in L1 state under MemoryBFT.

---

## 5. Economic engine (arbitrage-funded storage) — hypothesis

Because engines are separated:

1. **Trade (hypothesis):** Agents on AgenticEVM may capture internal/cross-venue spreads via 0x-style routing  
2. **Subsidy (hypothesis):** Realized profit converts to Storage Token  
3. **Injection:** Storage Token pays Tier-2 nodes; DataCore anchors the cryptographic receipt at native cost  

**Constitutional guardrail:** The simulator must **calculate** profitability, never assume it. Unprofitable regimes, treasury limits, and deferred queues remain first-class.

---

## 6. Dual-lane vs dual-engine vs dual-block

| Term | Meaning |
|---|---|
| **Trickle / Swarm** | Logical: commitments vs physical fragments |
| **DataCore / AgenticEVM** | L1 engines under MemoryBFT |
| **Small / Large blocks** | AgenticEVM pacing only |

Trickle ≈ DataCore native commitments. Swarm ≈ Tier-2 physical memory. AgenticEVM ≈ economics + agents reading DataCore via precompiles.

---

## 7. Relation to the live injector (monorepo sideline)

Root `bitstorage-orchestrator.js` (Base hitch) is a **transitional** Trickle experiment on an existing L2. It informs CostModel and injection UX. It is **not** MemoryBFT, DataCore, or dual-block AgenticEVM.

Path: Simulator (now) → dual-engine design specs → optional adapters → never silently rewrite production trading paths.

---

## 8. Implementation mandate for coding agents

1. Preserve working Sprint 1 simulator.  
2. Encode new theory as docs + eventual strategy/modules (compression plugs, PQ seal stubs, dual-block cost assumptions).  
3. Beat FIFO-0.1 in the Arena before replacing baselines.  
4. Separate canonical lossless recovery from lossy AI digests.  
5. Never claim arbitrage subsidy or zero-gas anchoring as measured fact without evidence.
