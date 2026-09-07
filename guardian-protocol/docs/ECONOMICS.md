# Economics

Agents may purchase storage, negotiate allocation, submit jobs, select compression/nodes, pay micro-fees, request retrieval, compete in the Arena, propose improvements.

HTTP payment candidates (e.g. x402) and stablecoin rails are **options**, not invariants.

Token utility may include storage credits, retrieval fees, node incentives, benchmark rewards, agent fees, governance/staking, routing fees. Speculative market value must not be a prerequisite for technical viability.

## Placement on the dual-engine L1 (theory)

Per `HYPERLIQUID_BLUEPRINT.md`:

- **AgenticEVM** — storage token markets, 0x-style intent routing, agent micro-fees
- **DataCore** — near-protocol-cost injection/anchoring hypotheses (do not assume zero cost until measured)
- Agents on AgenticEVM read DataCore state under one consensus — **no messaging bridge required** for that read path

0x routing funds or schedules preservation work; it does not replace DataCore. Never assume arbitrage profit. Messaging-bridge treasury designs are out of scope for the core L1 thesis.