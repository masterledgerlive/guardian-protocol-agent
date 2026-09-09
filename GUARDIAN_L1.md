# Guardian L1 Sideline — Navigation

This monorepo hosts **three related but separate tracks**:

| Path | Role | Touch rules |
|---|---|---|
| **Repo root** (`agent.js`, hitch, bitstorage, lose-zero, …) | Live Base **Uniswap V3** trading injector / IKN agent | Production path — do not rewrite for research / V4 experiments |
| **`guardian-v4/`** | Base **Uniswap V4** inject offshoot (DOT / popular V4 avenues + Eureka hitch) | Own process, lockfile, `GUARDIAN_V4_*` env, `state/` — run beside V3 without freezing it |
| **`guardian-protocol/`** | Agentic Memory Layer-1 research + Arena simulator | Own docs, tests, benchmarks; agents start at `guardian-protocol/HANDOFF.md` |

The V3 injector is a **transitional technology baseline** (Trickle hitch, dual lanes, L1 fee awareness, strand assembly). The V4 offshoot mirrors inject + Eureka hitch on Universal Router pools (including DOT) without sharing runtime state with `agent.js`. The L1 package targets a **Hyperliquid-inspired Agentic Memory Network**: [MemoryBFT + DataCore + dual-block AgenticEVM](./guardian-protocol/docs/HYPERLIQUID_BLUEPRINT.md), with [0x](https://0x.org) for value routing and [Arbitrum](https://arbitrum.io) for compression-cost models — without merging runtimes or treating messaging bridges as the architecture.

```bash
# V3 live bot (unchanged)
npm start

# V4 offshoot (separate process)
npm run start:v4 -- --once
npm run test:v4

# L1 research sideline
cd guardian-protocol && npm test && npm run benchmark && npm run arena:compare && npm run arena:stress
```
