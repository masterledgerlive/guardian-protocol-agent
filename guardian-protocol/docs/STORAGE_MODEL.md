# Storage Model

## Swarm responsibilities

- store encrypted fragments
- erasure coding / replication
- verify fragments
- serve retrieval
- repair
- availability proofs
- optional compression/encoding modules
- benchmark participation
- storage credit rewards

## Simulated node attributes

| Attribute | Notes |
|---|---|
| storage capacity | total bytes |
| available capacity | free bytes |
| bandwidth | bytes/tick |
| compute capacity | abstract units |
| reliability | failure probability assumption |
| latency | ms assumption |
| geographic region | string label |
| energy assumptions | labeled hypothetical |
| reward requirements | credits per byte-time |

## Research candidates

Direct on-chain payloads, calldata, blob-style DA, content-addressed storage, P2P shards, erasure-coded shards, replicated shards, hybrid on/off-chain.

The Arena decides winners under declared assumptions—not ideology.
