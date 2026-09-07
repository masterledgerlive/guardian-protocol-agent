# Guardian L1 Sideline — Navigation

This monorepo hosts **two related but separate tracks**:

| Path | Role | Touch rules |
|---|---|---|
| **Repo root** (`agent.js`, hitch, bitstorage, lose-zero, …) | Live Base trading injector / IKN agent | Production path — do not rewrite for research experiments |
| **`guardian-protocol/`** | Agentic Memory Layer-1 research + Arena simulator | Own docs, tests, benchmarks; agents start at `guardian-protocol/HANDOFF.md` |

The injector is a **technology baseline** (Trickle hitch, dual lanes, L1 fee awareness, strand assembly). The L1 package generalizes those ideas into a verifiable preservation Arena inspired by patterns from [0x](https://0x.org), [Hyperliquid](https://hyperliquid.xyz), and [Arbitrum](https://arbitrum.io) — without merging runtimes.

```bash
cd guardian-protocol && npm test && npm run benchmark
```
