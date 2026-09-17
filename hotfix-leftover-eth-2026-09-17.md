# Hotfix 2026-09-17 leftoverEth shadow

Tip `0468dc2` (#120) / `#119` WAVE hitch introduced a second `const leftoverEth` in `executeSell`, crashing GPA on boot (`SyntaxError: Identifier leftoverEth has already been declared`).

**Mitigation (Railway startCommand):** sed-rename WAVE-gate binding to `gateLeftoverEth` before `node agent.js`. WAVE hitch on covered leftover remains. `WAVE_MIRROR_PAID` default off. Vault never.

**Proper fix:** rename in source and land via PR; this file only triggers a Railpack rebuild so the new startCommand is baked into CMD.
