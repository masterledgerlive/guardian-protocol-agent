# Treasury / Storage Credits

Utility-oriented economy: participants exchange value for preservation capacity, verification, retrieval, bandwidth, computation, and durable storage.

**The simulator must not assume profitability. It must calculate it.**

## Tracked quantities

- cost per byte / GB / TB
- storage, compute, bandwidth, transaction, proof, repair, replication costs
- node rewards
- reserve requirements
- treasury health
- revenue assumptions
- sustainability horizon

## Sprint 1 behavior

Static reserve check before SCHEDULED. If estimated cost exceeds treasury balance → Deferred with reason `TREASURY_LIMIT`.
