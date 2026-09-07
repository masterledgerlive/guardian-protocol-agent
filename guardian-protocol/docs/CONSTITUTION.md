# Constitution — Guardian Protocol Invariants

These rules survive protocol revisions. Agents and humans compete under the same rules.

1. **Canonical data must not be silently altered.**
2. **Lossless claims require exact reconstruction evidence** (`reconstructed_bytes == canonical_original_bytes`).
3. **Every strategy must be reproducible.**
4. **Every benchmark result must be traceable** (complete replay).
5. **Every optimization must declare assumptions.**
6. **Historical strategies and results remain auditable.**
7. **No agent receives permanent authority merely for winning once.**
8. **Better strategies replace weaker ones through evidence**, not popularity.
9. **Security and legality override optimization.**
10. **The protocol remains modular** for future cryptography and storage tech.
11. **Human and AI contributors compete under the same benchmark rules.**
12. **Failures are recorded as valuable knowledge.**
13. **Economic sustainability must be measured, not assumed.**
14. **External dependencies must be disclosed.**
15. **Canonical foundation and derived intelligence must remain distinguishable.**

## Anti-cheating

A strategy may not:

- alter the canonical benchmark input
- conceal external dependencies
- omit storage requirements
- fake reconstruction
- manipulate instrumentation
- claim a pointer is the preserved payload
- use undisclosed resources
- compare incompatible benchmark versions

Treat discovered exploits as research corpus entries.

## Sideline boundary

Work in `guardian-protocol/` must not break or silently rewrite the live trading injector at repository root. Cross-pollination of ideas is encouraged; shared runtime coupling is not.
