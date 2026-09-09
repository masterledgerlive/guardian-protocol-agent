# System Loop — Storage Token × Injector × Agentic Piggy

**Status:** Sprint 6 simulation (not production)  
**Boundary:** Does not import or mutate root `agent.js` / hitch modules. Live constants are **mirrored** as labeled assumptions.

## What we are trying to achieve

1. **Inject anything** (letter → clip → movie) through the injector lifecycle.
2. **Sparse** encrypted fragments across **all connected swarm nodes**, not only the operator’s machine.
3. **Pay nodes in Storage Token (BITS)** for storing others’ data; Fast Pass burns BITS for immediate seats.
4. **Self-fund** via the live trading injector: leftover → piggy banks → operator **call to add** → more injection capacity.
5. **Prove** under known crypto events that the system freezes honestly or continues safely — never corrupts canonical bytes.

## Dual stack (same monorepo)

| Layer | Location | Role today |
|---|---|---|
| Live Trickle injector | Root `bitstorage-orchestrator.js`, `lose-zero-gate.js`, `piggy-bank.js`, `inject-revenue.js` | Hitch `§$STORE§` / ShadowWeave chunks onto Base swaps; Standby / Fast Pass / Silo; lose-zero; piggy dust |
| Agentic Memory L1 sim | `guardian-protocol/simulator/` | Storage Token ledger, sparse stripe, piggy compound, crypto-event catalog, capacity math, Arena reports |

Transitional path: live hitch proves calldata economics → simulator generalizes to multi-node Swarm + Storage Token → dual-engine L1 (DataCore + AgenticEVM) later.

## The equation (must calculate, never assume)

```text
trade leftover (lose-zero) 
  → piggy skim (locked, ratchet) + agent share
  → [operator call-to-add]
  → liquid + unlocked piggy
  → mint Storage Token (hypothesis: BITS per USD)
  → pay Fast Pass / fund treasury CostModel
  → sparse inject across online nodes
  → nodes earn BITS/KB
  → more hosts → more inject bandwidth
  → revenue compounds faster (quadratic schedule in sim)
```

**Lose-zero invariant:** hitch only when leftover after fees covers inject cost; otherwise plain swap / hold. Never sell underwater to insert storage.

**Piggy invariant:** dust stays locked until `call-to-add` (sim) or `PIGGY UNLOCK` (live).

## Sparse injection

`sparse-placement.js` stripes bytes across **every online node** (identity shards today). Reconstruction concatenates shards in order.

| Redundancy | 60% node bank-run |
|---|---|
| Thin `r=2` | **Fails** retrieve (documented gap) |
| Wide `r ≥ drop+2` | **Survives** bit-exact |
| Future | Erasure `k-of-n` in Arena (next research) |

## Crypto-event catalog (hard-push)

Gas spike · L1 fee spike · mempool congestion · RPC outage · sequencer downtime · liquidity freeze · flash crash · oracle desync · node bank-run · bandwidth cap · treasury drain · stablecoin depeg · fee-market freeze.

Survival modes: `CONTINUE` | `DEGRADED` | `SAFE_FREEZE` | `HARD_FAIL` (RPC total death without failover).

## Capacity with current funds (labeled live snapshot)

Defaults mirror Railway thin-book notes (~$2.24 tradeable, ~$5 bags, tiny ETH piggy). Run:

```bash
cd guardian-protocol && npm run arena:crypto-stress
```

Report fields:

- `CAPACITY_AT_START` — bytes/swap now, Eureka ok?, Fast Pass from BITS
- `movie_horizon` — cycles to 720p/1080p at current leftover
- `PIGGY_READY_USD` — after simulated compound + call-to-add
- `VERDICT.proven` — loop reconstructs + catalog survives + wide bank-run holds

## Commands

```bash
npm test                 # includes sprint6-storage-token.test.js
npm run arena:crypto-stress
npm run arena:stress     # prior node-drop stress
npm run benchmark        # 0001-tiny FIFO
```

## Language rules

Simulation ≠ production. Hypothesis ≠ proof. Pointer ≠ preservation. Arbitrage subsidy is never assumed profitable.
