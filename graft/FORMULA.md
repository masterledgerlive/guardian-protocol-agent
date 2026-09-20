# GRAFT formula (isolated offshoot)

**GRAFT** is a prompt-trial nursery. It is **not** VITA, **not** the live
Guardian injector, and **not** a second trader.

Horticulture: a scion grafted *beside* living rootstock. Rootstock (VITA +
root `agent.js`) stays untouched. What survives here can be studied later and
harvested by a human — never auto-merged.

## Invariants (hard)

1. **Never touch VITA or the live bot.** No imports from `vita/`, `agent.js`,
   `piggy-bank.js`, `vita-*.js`, or `guardian-v4/`. Separate process, state
   dir, env prefix `GRAFT_`.
2. **Lossless intake.** Raw prompts are content-addressed and never deleted.
   Refinement creates new derived artifacts + node snapshots.
3. **Thought is visible.** Every `/graft think` appends a step log. Study the
   log, not a black-box summary.
4. **Last-root, not a dump.** Content stays off-chain. Each mutation updates a
   Merkle last-root. Short tag anchors (`§GRAFT§`) are compact proofs ready
   for a later chain inject. **Never invent a tx hash.**
5. **Directory of location slots.** `GRAFT:\` maps node → artifact → optional
   loc link. Locs stay empty until a human harvests a survivor into VITA.
6. **File then activate.** `/graft insert` only stores. `/graft activate`
   turns thought ON. Sleep does not delete. Think refuses until the idea is ON.
7. **Money-gated thought.** Throw ETH (paper by default) with `/graft fund`.
   Think cycles debit the GRAFT piggy. Refuse think when empty.
8. **Survival, then harvest.** `survive` / `die` / `harvest` are human marks.
   Harvest marks a candidate for later study. It does not write into `vita/`.
9. **Dedicated Telegram poller.** Poll `getUpdates` only with
   `GRAFT_TELEGRAM_BOT_TOKEN`. Never steal the live bot's updates.

10. **Compact inject avenue.** `/graft inject` stages KEY+LOC-short packets on
    `graft-compact-inject`. Data log is append-only. No invented tx. Paper
    credits are not tokens.

## Proof classes

| Class | Where | Payload |
|---|---|---|
| Last-root | `graft/state/ledger.json` | Merkle root of artifacts + snapshots |
| Short tag | Telegram `/graft proof` | `§GRAFT§` + short id + root prefix |
| Thought trace | `graft/state/thoughts/` | Append-only agent steps |
| Compact inject | `graft/state/inject-queue.json` | `§GRAFT§` KEY+LOC packet, TX=none |
| Data log | `graft/state/data-log.jsonl` | avenue `graft-compact-inject` |
| RAIL G_n | `graft/state/rail.json` | sha256 mother-root (Poseidon2 stand-in) |
