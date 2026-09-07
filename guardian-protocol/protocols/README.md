# Protocol adapters (Sprint 5)

Stub interfaces only:

| Adapter | Role |
|---|---|
| `HitchInjectorAdapter` | Documents forbidden coupling to root trader until explicit design |
| `DaLayerAdapter` | Placeholder for DA / compression-cost models |
| `StorageNetworkAdapter` | Placeholder for Tier-2 swarm networks |

```js
import { listAdapterStubs } from "./adapters/index.js";
```

Sprint 1–4 remain simulation-only. Do **not** import root `agent.js`, hitch, or trading gates from here.
