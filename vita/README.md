# VITA mainframe (continuing avenue base)

This folder is the **protected original formula** for Guardian × VITA while
we keep shipping on this avenue until merge.

- **Memory surface:** infect `public/vita.html` (HTML until `/inject`)
- **Chain truth:** hardcoded anchors in `anchors.json` (never invent hashes)
- **Send rule:** leftover KEY+LOC when covered; `/prove` for Eureka; Storage
  Token can charge hitch delta — do not mute messages for micro extract
- **Growth:** sparse strands + append-only `memory/` — never forget, refine

Start here: [`AGENTS.md`](./AGENTS.md) → [`ORIGINAL_FORMULA.md`](./ORIGINAL_FORMULA.md) → [`FILING.md`](./FILING.md).

**Storage Token game:** Telegram `/vitafeed` — exact plain UTF-8 or any-file
`§VITAFILE§` packets, cost card, then `/vitafeed confirm|override` pays RISK
**only when `VITAFEED_PAID=yes`** (default OFF). Confirm respects liquid floor $5;
**override bypasses liquid floor + RISK REFUSE**, seals what gas allows, restages
remainder. `/vitafeed brain` activates learn (old→new + peer review + zero-proof
growth + library) and stages for override; `/vitafeed learn` · `/vitafeed proof`.
Queues `VITA_SAVE_LEARN` §TOKEN§ for `/vitasave`. Rate limited.
**Backlog:** `/vitafeed enqueue seed` parks brain seed + memory files on disk;
`/vitafeed next` drains one item at a time (confirm|override). Proves growth
without agentic AI (`GET /vita/feed-backlog`). Prefer ≤4 chunks/item (thrift).
Library: `/vitafeed files` · `play <n|name>` · `keys` (§VITALIB§).
Play proof: [`/vita/feed-player`](../public/vita-feed-player.html). See
[`INJECT.md`](./INJECT.md). Does not touch `/vitasave` mother brain send.

**WAVE memory mirror:** Telegram `/wavetest` (also HTML console + `GET /vita/wavetest`).
Hex shards `[W:v1:SYM]|…|KEY8|LOC8]` + VIN/tailwind like `/vitafeed`. Answer key
`vita/memory/wave-heraclitus-key.json`. Reconstruct-from-chain-only tests.
`VITAFEED_PAID` stays default OFF. Hitch on covered leftover; do not solo-send.

**Telegram HOME:** `/home` · `/menu` · `/start` — sectioned inline buttons for
every route (Memory / Feed / Search / WAVE / Mirror / Dual / Agents / Mother / Status).
`/home sim` runs many offline route + search sims. `/home engines` dual-mirrors
MAIN exact UTF-8 vs NEW snark-short with Basescan IDM anchors (`vita/telegram-home.js`).

**Agent chat (storage-token first):** Game opens `/home` → **Agents** → **Chat**
and sees proven locations land in the x404 directory waiting for a
master-location tag. Commands: `/agents chat` · `/agents dir` · `/agents dual`
· `/agents proven` · `/agents path`. Hex-only `§KEY§`…`§LOC§` dual; public open
key; bank when gas thin; hitch when leftover covers. Does **not** enable
`VITAFEED_PAID`. Optional `AGENT_CHAT_WALLET` / `AGENT_CHAT_X402_ENDPOINT` are
stubs only (no spend). Map: [`TELEGRAM_RELEARN.md`](./TELEGRAM_RELEARN.md).
Schema: [`x404-dir.json`](./x404-dir.json).

**WAVE 3-token proof:** Telegram `/waveproof` + public `GET /vita/waveproof` (SIM).
Desk live: `POST /vita/waveproof` or `GET /vita/waveproof?live=1` with
`VITA_WEBHOOK_SECRET` when `WAVE_PROOF_LIVE=yes`. Optional `WAVE_PROOF_AUTOFIRE=yes`
fires the capped 3-send once on boot then disables. Exactly 3×8B Heraclitus shards
(`VIRTUAL`/`CLANKER`/`AERO`). Does not re-enable `VITAFEED_PAID`.

**WAVE full quote:** Telegram `/wavefull` + public `GET /vita/wavefull` (SIM).
Desk live: `POST /vita/wavefull` or `GET /vita/wavefull?live=1` with
`VITA_WEBHOOK_SECRET` when `WAVE_FULL_LIVE=yes`. Optional `WAVE_FULL_AUTOFIRE=yes`
fires all 28 least-size shards once on boot (new VIN). New VIN (`01/28`…`28/28`).
SYM rotates `VIRTUAL`/`CLANKER`/`AERO`. Reconstruct PASS only if joined sha256
and each LOC8 match the answer key. Partial CDP abort retries then leaves LIVE
armed; resume is desk `POST { vinId, fromIndex, txHashes }` — autofire never
resumes. `/waveproof` stays 3. Does not re-enable `VITAFEED_PAID`. Hitch on
covered leftover still calls `attachWaveOnCoveredLeftover`.
Partial CDP abort retries the shard then leaves LIVE armed; resume is desk
`POST { vinId, fromIndex, txHashes }` (autofire never resumes).

```js
import {
  infectVitaHtmlDocument,
  originalFormulaHitchDecision,
  planSparseInject,
} from "./vita/mainframe.js";
```
