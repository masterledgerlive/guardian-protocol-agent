# RISK broadcast kill gate (hotfix 2026-09-26)

Incident: 276 `[VITAFEED:VIN-...]` self-calls from RISK 0x50e1...7915 on Sep 22-23 2026,
each fired by a Telegram `/vitafeed confirm|override|override force`. The command force
latch bypassed `VITAFEED_PAID=no`.

`broadcast-kill-gate-preload.js` wraps the CDP SDK `EvmClient.prototype.sendTransaction`
before `agent.js` loads:

- RISK self-call with data -> refused unless `VITAFEED_PAID=yes` (no force/override bypass).
- BUY swap (exactInputSingle tokenIn == WETH) -> refused while `HALT_NEW_ENTRIES=yes`
  unless `ALLOW_OPERATOR_BUY_WHEN_HALTED=yes`.
- Sells and plain transfers are untouched.

Activation is via the Railway start command (NOT NODE_OPTIONS, which also applies during
the Railpack build before source is copied and breaks `mise install`):

```
node boot-patch-leftover-eth.mjs && npm install && node --import ./broadcast-kill-gate-preload.js agent.js
```

Boot log shows `RISK broadcast kill gate armed`. If the gate cannot arm, agent.js exits.
No VITA / mother-brain files are edited.
