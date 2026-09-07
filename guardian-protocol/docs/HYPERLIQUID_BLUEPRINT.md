# Theory — Hyperliquid Dual-Engine Blueprint for Guardian L1

**Status:** Architectural theory / research program (not a production claim)  
**Correction note (v0.1.1):** Earlier drafts incorrectly mixed Hyperliquid with messaging-bridge patterns (e.g. Hyperlane). **Hyperliquid is not a bridge.** It is an application-specific Layer-1 with a dual-engine design. This document is the corrected source of truth for that mapping.

---

## Peer-review verdict

| Source | Correct role for Guardian L1 |
|---|---|
| **[Hyperliquid](https://hyperliquid.xyz)** | **Primary L1 blueprint** — dual native engine + EVM lane under one consensus |
| **[0x](https://0x.org)** | Value / intent routing mechanics **on** the programmable lane (not the data plane) |
| **[Arbitrum](https://arbitrum.io)** | Compression / batch DA **cost economics** for interim models and Swarm posting math |
| Messaging bridges (Hyperlane et al.) | Optional later research only — **not** required for the dual-engine vision |

Swapping a messaging bridge for Hyperliquid **changes the paradigm**: from “hack data into an existing L2 + bridge messages” to “launch an application-specific Layer-1 where heavy data ingestion is native protocol.”

---

## What Hyperliquid actually is (theory inputs)

Most general-purpose chains force trading, data, tokens, and logic through one congested smart-contract state machine (EVM). Hyperliquid’s published design separates that burden:

### Dual-engine under one consensus

1. **HyperCore (native engine)**  
   Protocol-native financial heart. Fully on-chain orderbook actions are native operations (not ordinary contract calls). Published claims include very high order throughput and near-zero marginal gas for core order actions — treat throughput/gas figures as **claims to verify**, not Arena proofs.

2. **HyperEVM (smart-contract lane)**  
   Standard EVM environment beside the native core for contracts, tokens, and app logic.

3. **Shared consensus (HyperBFT)**  
   Both engines finalize under the same consensus family (HotStuff-inspired). Contracts can read live HyperCore state **without a bridge or oracle hop**, because there is one chain, not two networked chains.

4. **Finality posture**  
   Sub-second, reorg-resistant finality is the property we care about for memory anchoring. For lossless unroll of AI memory, chain-splits/reorgs are hostile. Label finality numbers as vendor/claim until independently measured in our benchmarks.

---

## Mapping: Trading → Memory (Guardian dual-engine)

Replace “Trading” with “Data Storage / Memory”:

```text
HyperCore   →  DataCore      (native ingestion / swarm coordination)
HyperEVM    →  AgenticEVM    (tokens, agents, payments, routing)
HyperBFT    →  GuardianBFT*  (single sub-second consensus — research name)
```

\*Name is a placeholder. Consensus implementation is a future sprint; the invariant is **one consensus, two engines, no bridge between them**.

### 1. DataCore (replaces HyperCore)

Native, protocol-level ingestion engine — **not** an EVM contract farm.

- Coordinates the DePIN / Swarm: sparsify, encode, place fragments, repair, availability
- Personal-node injectors feed DataCore; Trickle commitments are first-class protocol actions
- Goal hypothesis: anchoring/injection of commitments can be near-gasless at the protocol layer (like native order actions), maximizing Trickle speed
- Swarm **physical bytes** still live on nodes; DataCore owns ordering, commitments, manifests, and recovery proofs

### 2. AgenticEVM (replaces HyperEVM)

Programmable lane beside DataCore:

- Storage credit / protocol token markets
- **0x-style** intent → route discovery → economic execution (spreads as **simulated** treasury hypotheses only)
- AI agents paying micro-fees (e.g. x402 candidate) to buy storage, retrieve, or compete in the Arena
- Agents **read DataCore fragment/commitment state directly** — no cross-chain bridge, no latency tax from messaging layers

### 3. One consensus, zero bridge

The “magic” to preserve in theory:

> Smart contracts and agents see live DataCore state under the same finality domain.

That is the opposite of “Hyperlane-style message → remote chain → eventual read.”

---

## How 0x and Arbitrum still fit (without owning the paradigm)

### 0x — value routing on AgenticEVM

```text
agent intent → route discovery → economic execution → DataCore injection request
```

0x mechanics route **value and intents**. They do not carry the bulk memory plane. Spread-capture funding of treasury is a **conservative simulation hypothesis** — never assumed profit.

### Arbitrum — compression economics (interim + cost models)

Arbitrum-style batching/compression informs:

- how expensive posting commitments would be on Ethereum-aligned DA
- why DataCore must not dump bulk payloads through EVM calldata forever
- Sprint 1–4 CostModel assumptions when comparing “hitch on Base/L2” vs “native DataCore action”

The live Base hitch injector remains a **transitional baseline**, not the dual-engine L1.

---

## Dual-lane vs dual-engine (do not confuse terms)

| Term | Meaning in this project |
|---|---|
| **Trickle / Swarm (dual-lane)** | Logical split: commitments vs physical fragments (protocol design) |
| **DataCore / AgenticEVM (dual-engine)** | L1 implementation blueprint: native data plane + EVM plane under one BFT |

Trickle events ideally become **DataCore native actions**. Swarm nodes remain the physical memory substrate. AgenticEVM hosts economics and agent logic that read DataCore instantly.

---

## Ultimate handoff (corrected vision)

1. Study Hyperliquid’s dual-engine L1 as the architectural blueprint.  
2. Build DataCore for heavy agentic data routing + DePIN coordination.  
3. Build AgenticEVM for tokens, 0x-style routing, agent payments.  
4. Use Arbitrum-style compression math for costs and interim hitch experiments.  
5. Prove every step in the Arena — never present this theory as a deployed L1.

**Mission fit:** A chain that can carry the weight of global human memory for future AI only if ingestion is native, economics are programmable, and finality is decisive — under one consensus, without pretending a bridge is an architecture.
