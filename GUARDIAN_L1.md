# Guardian L1 Sideline — Navigation

This monorepo hosts **two related but separate tracks**:

| Path | Role | Touch rules |
|---|---|---|
| **Repo root** (`agent.js`, hitch, bitstorage, lose-zero, …) | Live Base trading injector / IKN agent | Production path — do not rewrite for research experiments |
| **`guardian-protocol/`** | Agentic Memory Layer-1 research + Arena simulator | Own docs, tests, benchmarks; agents start at `guardian-protocol/HANDOFF.md` |

The injector is a **transitional technology baseline** (Trickle hitch, dual lanes, L1 fee awareness, strand assembly). The L1 package targets a **Hyperliquid-inspired Agentic Memory Network**: [MemoryBFT + DataCore + dual-block AgenticEVM](./guardian-protocol/docs/HYPERLIQUID_BLUEPRINT.md), with [0x](https://0x.org) for value routing and [Arbitrum](https://arbitrum.io) for compression-cost models — without merging runtimes or treating messaging bridges as the architecture.

```bash
cd guardian-protocol && npm test && npm run benchmark && npm run arena:compare && npm run arena:stress
```
