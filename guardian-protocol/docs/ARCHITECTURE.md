# Architecture — Dual-Lane Memory Layer-1

## Thesis

Blockchain commitments, distributed physical storage, cryptographic verification, autonomous agents, and an evolving Arena cooperate so information can be:

- lossless when lossless is required
- independently verifiable
- economically measurable
- replayable and reconstructible
- continuously optimizable
- resistant to technological change
- open to competing human and AI strategies

The blockchain is a candidate for immutable state, provenance, commitments, accounting, and coordination—not assumed to be the only or best storage medium.

## Separation of concerns

1. **Canonical truth/data** — recoverable information  
2. **Cryptographic state (Trickle)** — hashes, Merkle roots, manifests, proofs, provenance  
3. **Physical preservation (Swarm)** — encrypted fragments across nodes/DePIN  
4. **Knowledge/index layers** — understanding and retrieval (may be lossy if labeled)  
5. **Agentic refinement** — strategies improving compression, scheduling, storage, indexing, verification, economics  
6. **The Arena** — identical-rules competition  

## Dual-lane state machine

### Lane 1 — The Trickle

Lightweight commitment layer: hashes, Merkle roots, manifests, CIDs, state transitions, strategy versions, economic records, storage proofs, routing decisions, references to Swarm material.

Minimize expensive on-chain state while retaining enough to prove preservation claims.

### Lane 2 — The Swarm

Physical distributed preservation: P2P / DePIN, encrypted fragments, erasure coding, replication, geo distribution, availability proofs, retrieval markets, archival nodes.

**Critical rule:** A link/pointer alone is not preservation. For lossless Grand Challenge, reconstruction material must exist in the defined system or in **explicitly declared** external dependencies.

## Injection lifecycle

```text
RECEIVED → VALIDATED → CHUNKED → ENCODED → COST_ESTIMATED
→ TREASURY_CHECK → SCHEDULED → INJECTED → STORED → VERIFIED → INDEXED → ARCHIVED
```

Every transition emits an immutable replay event.

## Queue lanes

| Lane | Use |
|---|---|
| Immediate | High priority, urgent repair, active retrieval, safety-critical |
| Batch | Aggregation reduces cost |
| Deferred | Treasury/resource limits or measurable wait advantage |

## Peer review: external infrastructure patterns

These are **research inspirations** for the sideline. They are not hard-coded product dependencies.

**Correction (v0.1.2):** Full Agentic Memory Network redesign — **MemoryBFT**, DataCore Swarm Manager, AgenticEVM **dual-block** pacing, Tier-1 **ML-DSA** sealing, arbitrage subsidy as hypothesis. Canonical theory: [`HYPERLIQUID_BLUEPRINT.md`](./HYPERLIQUID_BLUEPRINT.md). Hyperliquid is **not** a messaging bridge.

### Hyperliquid.xyz — primary L1 blueprint (dual-engine + dual-block)

Hyperliquid separates a native high-frequency engine (**HyperCore**) from an EVM lane (**HyperEVM**) under one consensus (**HyperBFT**), and paces the EVM with dual block classes. Contracts read core state with no bridge.

Guardian maps that blueprint onto memory:

| Hyperliquid | Guardian L1 theory |
|---|---|
| HyperBFT | **MemoryBFT** — shared sub-second, reorg-resistant finality (design target) |
| HyperCore | **DataCore** — native sparsing, compression routing, PQ pointer anchoring, Swarm Manager |
| HyperEVM | **AgenticEVM** — Storage Token, agents, x402 candidates, 0x-style routing |
| Dual blocks | Small (~1s / ~2M) vs Large (~60s / ~30M) — **targets** for agent HF vs heavy deploy |

Do **not** force bulk memory through a single congested EVM. DataCore owns heavy routing; AgenticEVM owns programmable economics via dual-block pacing; both share MemoryBFT so agents read fragment/commitment state via precompiles.

Published Hyperliquid throughput / zero-gas / finality claims are **inputs to evaluate**, not proofs that Guardian already achieves them.

### 0x.org — value routing on AgenticEVM (not the data plane)

0x-style intent → route discovery → economic execution belongs on **AgenticEVM**:

```text
agent intent → route discovery → economic execution → DataCore injection request
```

Treat preservation jobs as intents with quoted costs, budget caps, and fill-or-kill / deferred semantics (Immediate / Batch / Deferred). DEX spread capture as treasury funding is a **hypothesis to simulate conservatively** — never assume arbitrage profit exists.

### Arbitrum.io — compression / DA cost economics

Arbitrum’s batch compression and L2 posting math inform CostModel assumptions and interim hitch experiments:

- Compress and batch commitments before expensive settlement
- Distinguish **data availability** from **permanent archival**
- Compare “post on L2/blobs/calldata hitch” vs “native DataCore action”

Useful for economics — **not** the long-term dual-engine paradigm.

### Live injector baseline (same monorepo, separate package)

Root `bitstorage-orchestrator.js` is a **transitional** Trickle: hitch fragments onto Base swaps (Standby / Fast Pass / Silo). It proves calldata injection economics today. It is **not** DataCore+AgenticEVM yet.

Guardian L1 generalizes toward the Hyperliquid-style dual-engine target via:

- strategy-pluggable scheduling
- multi-node Swarm simulation
- Arena scoring
- long-tail / short-tail migration research
- eventual DataCore / AgenticEVM separation under one consensus (post-simulator)

**Boundary:** do not import or mutate root trading modules from this package in Sprint 1–4. Adapters are Sprint 5+.
## Personal Node / Tier 1

Local ingestion: filter, preprocess, dedupe, compress experiments, encrypt, seal, chunk, classify, index, emit manifests. Slow/free local path vs fast/paid Swarm path.

## Tier 2 — DePIN nodes

Store fragments, erasure-code, verify, serve retrieval, repair, availability proofs, run encoding modules, join benchmarks, earn storage credits.

Simulator tracks: capacity, free capacity, bandwidth, compute, reliability, latency, geography, energy assumptions, reward requirements.

## Cryptography agility

Candidates: SHA-family commitments, Merkle trees, XMSS, SPHINCS+, ML-DSA, future PQ. Benchmark proof/signature size, compute, verify cost, overhead, migration—not hard-code forever.

## Knowledge DNA / strategy genome

Every refinement points to parent strategy, benchmark, transformation, evidence, measured improvement, dependencies, successors. Lineage is preserved; versions are not silently erased.

## Zero-loss vs lossy

Canonical preservation is lossless. Derived knowledge / AI embeddings may be lossy **and must be labeled**. Grand Challenge never confuses a summary with the canonical object.
