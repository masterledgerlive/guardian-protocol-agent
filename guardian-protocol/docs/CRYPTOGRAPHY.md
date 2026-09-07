# Cryptography

Cryptography-agile. Candidates may include conventional hash commitments, Merkle trees, XMSS, SPHINCS+, **ML-DSA (Dilithium)**, future PQ constructions.

## Tier-1 sealing (theory)

Personal Nodes seal ingestion manifests / fragments with **ML-DSA** before DataCore routes to the Swarm (see `HYPERLIQUID_BLUEPRINT.md`). Alternatives remain Arena-comparable modules — do not hard-code one algorithm forever.

Each module is benchmarked for security assumptions, proof/signature size, computation, verification cost, storage overhead, bandwidth, operational complexity, migration strategy.

Sprint 1 simulator uses SHA-256 for object and chunk commitments only. PQ seal modules are post-Sprint-1 work.
