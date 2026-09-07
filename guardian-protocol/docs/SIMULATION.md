# Simulation Engine

## Goal

Build the scientific instrument first. No token or mainnet deployment in early sprints.

## Core components

```text
SimulationController
StateMachine
Scheduler
StorageModel
TreasuryModel
CostModel
IntegrityVerifier
ReplayLogger
MetricsEngine
BenchmarkRunner
StrategyRegistry
AgentArena
```

Strategies interact via defined interfaces; they must not patch simulator core.

## Event-driven model

Simulation time advances by events. Each injection lifecycle transition produces:

| Field | Required |
|---|---|
| event_id | yes |
| object_id | yes |
| previous_state / new_state | yes |
| timestamp | yes |
| strategy_id / version | yes |
| reason_code | yes |
| estimated_cost / actual_cost | when known |
| resource_snapshot | recommended |
| cryptographic references | when applicable |

## Replay requirements

A replay must answer what / when / why / which strategy / resources / cost / rule / alternatives.

Viewer capabilities (Sprint 2+): play, pause, step, reverse, jump, filter by object/strategy, inspect decision, compare two replays.

## Cost simulation

Configurable **hypothetical** costs (always labeled assumptions):

- transaction fee
- bandwidth price
- compute price
- storage price
- node reward
- redundancy
- chunk size
- batch size

Later replace with measured real-world costs.

## Metrics

**Primary:** reconstruction success, bit equality, cost, throughput, latency, storage overhead, verification cost, proof overhead  

**Secondary:** node count/utilization, redundancy, repair time, failure tolerance, bandwidth, compute, energy, treasury health, reward efficiency  

**Derived:** `cost_per_GB`, `effective_storage_ratio`, `reconstruction_success_rate`, `cost_per_verified_GB`, `retrieval_latency`, `repair_cost`, `proof_overhead`, `agent_improvement_delta`

## Scale ladder (simulated, not claimed real)

1 → 10 → 100 → 1e3 → 1e4 → 1e5 → 1e6 nodes

Reports must label: simulated | measured | estimated | hypothetical | experimentally verified.

## Sprint 1 acceptance

- Deterministic benchmark `0001-tiny` with FIFO-0.1
- Exact reconstruction PASS
- JSON report with input/output hashes, economics, performance, trace hash, assumptions
- No invented performance numbers outside the simulator’s own clock/cost model
