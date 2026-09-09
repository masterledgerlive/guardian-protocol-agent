# Economics

Agents may purchase storage, negotiate allocation, submit jobs, select compression/nodes, pay micro-fees, request retrieval, compete in the Arena, propose improvements.

HTTP payment candidates (e.g. x402) and stablecoin rails are **options**, not invariants.

Token utility may include storage credits, retrieval fees, node incentives, benchmark rewards, agent fees, governance/staking, routing fees. Speculative market value must not be a prerequisite for technical viability.

## Placement on the dual-engine L1 (theory)

Per `HYPERLIQUID_BLUEPRINT.md`:

- **AgenticEVM (dual-block)** — Storage Token markets, 0x-style intent routing, agent micro-fees on small blocks; heavy orchestration on large blocks
- **DataCore** — near-protocol-cost injection/anchoring hypotheses (do not assume zero cost until measured)
- Agents on AgenticEVM read DataCore state under **MemoryBFT** — **no messaging bridge** for that read path

## Arbitrage-funded storage (hypothesis)

Proposed loop: agent spreads on AgenticEVM → convert to Storage Token → pay Tier-2 nodes; DataCore anchors receipt at native cost.

**The simulator must calculate profitability, never assume it.** Deferred queues and treasury limits remain valid outcomes. Messaging-bridge treasury designs are out of scope for the core L1 thesis.

## Storage Token loop (Sprint 6)

See `SYSTEM_LOOP.md`. Simulated loop:

```text
injector leftover → piggy (locked) → call-to-add → BITS mint
  → Fast Pass / treasury → sparse inject → node BITS/KB rewards
```

Standby hitch costs 0 BITS (pays wait). Fast Pass burns 5 BITS/chunk (mirrored from live orchestrator). Node payout ratio default 0.85 of KB rewards. Capacity and crypto-event survival are Arena-measured, not marketing claims.
