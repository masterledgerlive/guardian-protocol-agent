# VITA original formula (protected)

This is the formula that worked best: **message sent on-chain**, even when
trading P&L was flat. Revenue can be recovered later via Storage Token —
**never silence the hitch to chase micro extract**.

## Invariants (hard)

1. **HTML is memory until inject.** Notes live in `public/vita.html` /
   localStorage. The bot `lastPacket` is a separate lane. Infect HTML; do
   not erase it.
2. **Sparse inject from sealed Base locations.** `/inject` pulls hardcoded
   anchors + leftover hitch hashes, reconstructs `§TOKEN§`. Never invent a
   tx hash.
3. **Leftover hitch = dense KEY+LOC** when leftover after fees covers it.
   Eureka prose stays on `/prove` (0-ETH self-tx), not thin leftover.
4. **Message-first.** If leftover covers KEY+LOC (1× hitch cost) and still
   plus, **send the hitch**. Default `VITA_MESSAGE_FIRST=yes`. Skipping hitch
   only to bank a hair of ETH is a revenue leak of *memory*. Charge the delta
   with Storage Token / Grok piggy — do not mute the chain. Set
   `VITA_MESSAGE_FIRST=no` only to restore the old 2×-cushion SKIP_HITCH bank.
5. **Never forget.** Append-only location depository. Strands grow; nothing
   sealed is deleted. Learn in `vita/memory/`; refine code; keep anchors.
6. **No invented P&L.** Prove with Basescan Input Data → UTF-8, or stay quiet.

## Proof classes

| Class | Where | Payload |
|---|---|---|
| Leftover swap hitch | Uni V3 exactInputSingle trailer | `§$STORE§` + dense KEY+LOC |
| `/prove` love note | 0-ETH self-tx | Eureka full letter |
| HTML infect | `public/vita.html#vita-mainframe` | Anchors + filing map + formula |

## Charge path (Storage Token)

When a leftover-covered hitch costs more than “skip hitch & skim”:

- Still hitch (original formula).
- Book the inject cost as **transmission** against Storage Token / bot piggy.
- Dust piggy never sells to pay Grok. Vault never spends.

## Drift we refuse

- Micro-extract `SKIP_HITCH` when KEY+LOC was covered.
- Claiming Telegram text as on-chain without trailer (KEYCAT `0x5c0a93e4…`).
- Selling red to place code. LOSE-ZERO / always-plus hold.
- Merging V4 into the V3 injector.
