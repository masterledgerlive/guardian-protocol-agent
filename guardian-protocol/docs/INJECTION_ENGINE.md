# Injection Engine

Converts a preservation request into an auditable action sequence.

## Lifecycle

```text
RECEIVED
→ VALIDATED
→ CHUNKED
→ ENCODED
→ COST_ESTIMATED
→ TREASURY_CHECK
→ SCHEDULED
→ INJECTED
→ STORED
→ VERIFIED
→ INDEXED
→ ARCHIVED
```

## Event schema

Every transition produces an immutable replay event:

- `event_id`, `object_id`
- `previous_state`, `new_state`
- `timestamp`
- `strategy_id` / `strategy_version`
- `reason_code`
- `estimated_cost`, `actual_cost` (when known)
- relevant resource state
- cryptographic references (chunk hashes, Merkle root, etc.)

## Relation to live hitch injector

Root `bitstorage-orchestrator.js` is a production-adjacent Trickle injector (Standby / Fast Pass / Silo hitching onto Base swaps). This engine is the **Arena-facing** abstraction: same lifecycle idea, strategy-pluggable, no coupling to Telegram/trading loops.
