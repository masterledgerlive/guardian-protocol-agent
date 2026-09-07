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

### 0x.org — intent and routing

0x-style intent → route discovery → economic execution maps cleanly onto:

```text
agent intent → route discovery → economic execution → cross-chain/message → storage injection
```

Candidate: treat preservation jobs as intents with quoted costs, slippage-like budget caps, and fill-or-kill / deferred semantics (mirrors Immediate / Batch / Deferred). DEX spread capture as treasury funding is a **hypothesis to simulate conservatively**—never assume arbitrage profit exists.

### Hyperliquid.xyz — execution density

Hyperliquid demonstrates that high-throughput L1/app-chain designs can keep frequent state updates cheap relative to general-purpose L1s. For Guardian L1 research:

- Trickle events should be sized like order/state updates (small, frequent, auditable)
- Swarm payloads should not pollute the Trickle
- Arena cost models should compare “post commitments on dense L1” vs “post on L2/blobs/calldata hitch”

### Arbitrum.io — compressed data posting

Arbitrum’s data compression / batch posting economics inform the Trickle vs Swarm split:

- Compress and batch commitments (and optionally DA blobs) before settlement
- Distinguish **data availability** from **permanent archival**
- Model L1 posting cost as a first-class CostModel input (aligned with the live bot’s L1 fee oracle concept, without coupling runtimes)

### Live injector baseline (same monorepo, separate package)

Root `bitstorage-orchestrator.js` already implements a practical Trickle: hitch encrypted fragments onto economically motivated Base swaps (Standby / Fast Pass / Silo). Guardian L1 generalizes that into:

- strategy-pluggable scheduling
- multi-node Swarm simulation
- Arena scoring
- long-tail / short-tail migration research

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
