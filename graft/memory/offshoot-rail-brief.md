# RAIL offshoot brief — GRAFT-local L0–L5 ledger

The dump branded itself **VITA L0–L5 RAIL** (Nova/Plonky2, EIP-4844 blobs,
9.9B NPU provers, Dilithium, Arweave, $V_{CREDIT}$ mint, x402).

**RAIL is the offshoot inside GRAFT.** It does not infect VITA HTML, does not
mint a token, and does not broadcast. Tests use paper credits only.

| Layer | LLM dump | Working GRAFT offshoot (activate this) |
|---|---|---|
| L0 | 9.9B phone NPUs + zk-SNARK | Local CAS hash as storage proof. Paper credit, not a token. |
| L1 | Light Protocol ZK compression @ $0.00025 | Merkle batch of claim hashes. Cost is GRAFT piggy think fee. |
| L2 | OP-Stack + EIP-4844 blobs @ $0.001 | CAS blob + last-root. Not an L1 blob tx. |
| L3 | x402 + ACP bounties | Critic / Reproducer / Optimizer votes in-process. |
| L4 | Dilithium/XMSS dual-sign | Dual **hash rings** (sha256 + stand-in). Not PQC. Logged honestly. |
| L5 | Poseidon2 mother root $G_n$ | Same fold as the dump's Python: sha256($G_n$ ‖ payload ‖ proof). |

## Old-way inject (compact hitch spirit)

Full whitepapers stay in CAS. `/graft inject` writes a short `§GRAFT§` packet
(KEY+LOC style): model + short id + last-root + mother-root. That packet is
the thing that can later ride leftover hitch / `/prove`. GRAFT does **not**
broadcast it and **never invents a tx hash**. Receipt = last-root + inclusion
proof until a real Base loc is harvested.

Avenue name: `graft-compact-inject`. Every file / think / fold / inject line
lands in `graft/state/data-log.jsonl`.

## Activate

```
/graft dir MODELS
/graft activate RAIL
/graft fund 0.001
/graft rail
/graft inject all
/graft receipts
```
