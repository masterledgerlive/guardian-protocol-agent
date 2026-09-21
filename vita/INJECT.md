# /vitafeed — Storage Token inject game

Test the storage product **before** public StorageToken. Telegram-only paid path
(plus HTML Tailwind reader for local play-proof).

## Flow

1. `/vitafeed [exact plain text]` — or reply to a message with `/vitafeed`.
2. **Any file / song / video** (Telegram — either way):
   - `/vitafeed file` → bot says **please insert the file now** → send the
     song/video/doc (or reply to one). Bot waits for the next attachment.
   - Or reply to an existing attachment with `/vitafeed` / `/vitafeed file`.
   Bytes → `§VITAFILE§` base64 UTF-8 → same VIN spaced packets (720 B payload).
   Nothing held after seal.
3. Bot replies with a **cost card** (before): chars / UTF-8 bytes / bits, max payload per chunk, injection count, ETH/$ per injection × N, VIN/tailwind pointers, IN bytes vs OUT (pending).
4. `/vitafeed confirm` pays **RISK only** for each max chunk until the whole string is on-chain **only when `VITAFEED_PAID=yes` (or `VITAFEED_ENABLED=yes|true|1`)**. Default OFF → bank/refuse, cost card still works.
5. `/vitafeed override` is the same paid path but **bypasses the RISK balance REFUSE** (proceed despite underfunded inscription + buy-in + gas). Buys/inscription may still fail on-chain. **Override cannot bypass `VITAFEED_PAID=no` or the rate limit unless `VITAFEED_FORCE=yes`.** Liquid floor is already bypassed by override. When FORCE is on, override is the thrift “block id off” path — plain body seal, no BL- backlog wrap.
6. When every location seals → **PLAY PROOF**: Tailwind reader peaces spaced
   locations together and plays the blob (`/vita/feed-player`).
7. Receipt (after) repeats the cost math plus Basescan links, tx hashes, and the reader key.
   Every receipt includes a **BASESCAN READ RECEIPT** — open each link → Input Data →
   View as UTF-8 to read the on-chain chat of the data. Spaced locations are bunched
   on the Telegram card.
7b. **Dual lane (human ↔ machine):** `/vitafeed translate [text]` shows side-by-side
   HUMAN plain vs MACHINE ZK-short sizes + ETH/$. `/vitafeed dual [text]` stages both;
   confirm|override seals HUMAN then MACHINE and prints both location sets as proof.
   `/vitafeed restart` lists bags ≥ $0.50 to exit if RISK needs fuel for more inject tests.
7b2. **CHAINDIR (completion log):** `/vitafeed chaindir` shows **top** routing/waiting
   (two ends talking — HUMAN plain vs MACHINE ZK-short, no invented locs) and
   **bottom** complete lines with clickable Basescan **Input Data → UTF-8** proofs
   in order of completion. `/vitafeed loc 0x…` searches by sealed location.
   Completing both lanes is the absolute moment; `/vitafeed cycle` self-checks
   loc proofs and routes the next dual inject. `/vitafeed dir CHAIN`. UI:
   `/vita/chain-dir`. KIDS player is availability until dual kids is sealed.
   Maple Leaf Rag is availability until grouped VIN injects (`/vitafeed enqueue maple`)
   seal every slice; `/vitafeed dual maple` logs the catalog line. Original
   playback: `/vita/feed-player?music=maple` reconstructs the OGG from groups.
7c. **Loader (curated knowledge):** `/vitafeed load` preloads cipher/programming/LLM
   packs into the **existing** backlog with dual cost mirrors + text animation.
   `/vitafeed know` = Hey did you know… + on-chain library recall.
   `/vitafeed recall` = proof of new chain-of-data capabilities.
   `/vitafeed cipher` = CIPHER:\\ encode↔decode hierarchy.
   Animate: `/vita/feed-loader`. Thought note: backlog/library/dir already covered
   most of this — loader is the curated diet layer, not a second queue.
8. **LIBRARY (quick pull from Telegram):** each sealed file auto-saves its
   **name + reader key + locations** into the keys library. Then:
   - `/vitafeed files` — numbered list of what you saved
   - `/vitafeed play <n|name>` (also `open` / `pull`) — rebuild + open player
   - `/vitafeed keys` — stage a `§VITALIB§` catalog (name→key→locs) as the
     **keys chain** for reader quick access; confirm|override seals it like
     any other feed body
   Player deep-link: `/vita/feed-player?lib=N` · API: `GET /vita/feed-library`
9. **BACKLOG (feed brain without agentic AI):** inject was cheap enough to keep
   feeding even when Cursor is off. Disk queue parks brain seed + memory files;
   drain one item at a time under thrift caps:
   - `/vitafeed enqueue seed` — queue brain seed + compact memory topics (no send)
   - `/vitafeed backlog` — pending→sealed growth card
   - `/vitafeed next` — stage next pending → confirm|override
   - `/vitafeed proof` includes backlog growth proof
   Desk: `GET /vita/feed-backlog` · auth `POST /vita/feed-backlog/seed`
   Prefer ≤4 chunks/item (hard max 24 = hourly thrift). A full song uses
   **grouped** items (one group = ≤24 VIN). `/vitafeed enqueue maple` queues
   Maple Leaf Rag slices. Never invents hashes.
   Does **not** turn `VITAFEED_PAID` on.
10. **FORCE / AUTOFIRE (desk):** `VITAFEED_FORCE=yes` + override (or
    `VITAFEED_AUTOFIRE=yes` + `VITAFEED_AUTOFIRE_BODY=…` one-shot on boot) seals
    exact plain UTF-8 with **no BL- backlog id**. Desk: auth `POST /vita/vitafeed`
    `{ "body": "…", "force": true, "live": true }`. Autofire self-clears to `no`.

`/vitafeed cancel` drops a staged payload **and** clears a pending file wait.
Confirm is always required so a 1000+ character paste cannot burn by accident.
Use override only when you intentionally want to force through the underfunded REFUSE.

## VITAFILE wire

```
§VITAFILE§v1|name=song.wav|mime=audio/wav|bytes=N|sha256=hex|enc=b64§
<base64>
```

That entire body is split into:

`[VITAFEED:<VIN-…>:<ii>/<nn>:prev=<8hex>:next=<ii|END>]<chunk>`

Reader key: `VITAFEED.<VIN-…>`. Local demo (no chain): open `/vita/feed-player`,
upload or load demo song → Packetize → Demo override → Play proof.

## Constants

| Name | Value | Meaning |
|---|---|---|
| `VITAFEED_MAX_CHUNK_BYTES` | **720** | Max verbatim UTF-8 payload bytes per injection (VIN header sits outside) |
| `VITAFEED_CONFIRM_CHARS` | 1000 | Large-body warning on the cost card |
| `VITAFEED_TX_GAS_UNITS` | 50_000 | Documented self-tx gas class (`BTP_INSCRIBE_GAS_UNITS`) |
| Payer | RISK `0x50e1…7915` | Vault / save bucket never spend |
| `VITAFEED_PAID` / `VITAFEED_ENABLED` | default **OFF** | Must be `yes`/`true`/`1` to allow confirm/override `sendTransaction`. Override cannot bypass unless `VITAFEED_FORCE`. |
| `VITAFEED_FORCE` | default **OFF** | When `yes`, `/vitafeed override` (and autofire) bypasses paid-off + rate limit. Liquid floor already bypassed by override. Plain body; no BL- id. |
| `VITAFEED_AUTOFIRE` | default **OFF** | One-shot boot/desk seal of `VITAFEED_AUTOFIRE_BODY`; self-clears to `no`. Needs PAID or FORCE. |
| `VITAFEED_AUTOFIRE_BODY` | empty | Exact plain UTF-8 (no §VITABACKLOG§ / BL- wrap). |
| `VITAFEED_MIN_LIQUID_USD` | default **5** | Refuse confirm/override when RISK liquid USD is below floor. Set `0` to disable. |
| `VITAFEED_CONFIRM_COOLDOWN_SEC` | default **60** | Refuse a second paid confirm for the same chat within N seconds. |
| `VITAFEED_MAX_CHUNKS_PER_HOUR` | default **24** | Refuse a batch that would exceed hourly chunk cap (stops 383-tx file dumps). |
| `VITAFEED_RATE_LIMIT` | default ON | Set `no`/`0`/`off`/`false` to disable cooldown + chunk cap + stale-confirm guard. |
| `VITAFEED_MAX_CONFIRM_AGE_SEC` | default **180** | Refuse Telegram confirms older than this (getUpdates replay after restart). |

Quotes are labeled **LIVE** (Base gas + ETH mark + optional `getL1Fee`) or **DEMO** (documented 0.05 gwei / $2481 ETH).

## Exact plain

Whatever follows `/vitafeed` (or the reply body) is inscribed **verbatim**. No summarization. No `§SESS§` template unless the operator typed it. UTF-8 → hex calldata. Files become exact base64 text first (still verbatim after encode).

Each chunk header is VIN/tailwind continuity:

`[VITAFEED:<VIN-…>:<ii>/<nn>:prev=<8hex>:next=<ii\|END>]<verbatim body>`

Reader key: `VITAFEED.<VIN-…>`. Location of the pointer is in the header and on the receipt (`prev=` / `next=`).

## Buy-in (new math — `/vitafeed` only)

This is **not** the live trader’s 5% / $0.15 piggy. Each confirmed injection can
also buy a qualifying **red** seat, sized from **that chunk’s character /
transmission cost**.

1. **Qualify (always red):** price in the lowest **3%** of the confirmed
   peak–trough range **and** wave math predicted **coming up** from the low.
   Entry must still be **negative vs peak**.
2. **Three piggies always left behind (pre-injected):** AI **$0.10** + human
   **$0.10** + lottery **$0.05** (≥ **$0.25**).
3. **1.5% savings tax** on the **whole cost at inject time** (transmission /
   chars + piggies + gwei + other known fees + hidden-cost buffer). Tax is
   left behind with the piggies.
4. **Seat pick:** deepest red first, then **fewest prior trades**; **one
   different token per message/tx** (no reuse in the same wrap). Five messages
   ⇒ five bags and **≥ $1.25** piggy floor alone (`5 × $0.25`).
5. **Preview WRAP PLAN** (before confirm) lists each `msg NN/MM → TOKEN @
   range %  dip %  leave $…  exit@…` so you can judge the choices first.
   Confirm reuses that staged plan.
6. **Stake** = whole cost / dip% (never below leave-behind ≥ **$0.25**).
   Bounce of the same % covers the stack.
7. **Confirm order:** buy each wrap seat **first** (fresh RISK balance), then
   pay inscription. RISK must cover inscription + buy-in stake + gas or
   confirm refuses. `VITAFEED BUYIN` is allowed through LOSE_ZERO / tier /
   COST_EDGE / FIFO-red add-on without being an operator `/buy`.
8. **Exit ASAP** when green / revenue prints — same % up **plus** the cost
   overlay. Sell leaves **$0.25 + tax** parked for the next earn.

If a message has no unused red seat, that wrap line shows `NO SEAT` and is
skipped; inscription still pays RISK after confirm (message-first).


## WAVE memory mirror (bits → shards → locations → read-back)

Blockchain as a **memory mirror**: inject knowledge, find it on-chain, remember
and refine without off-chain hallucination. Thin wrap only —
`vita/wave-wrap.js`. Mother brain (`vitaSave` / `inscribeChunk` / memory-engine /
mainframe / mother-genesis) is **DIFF ZERO**. `VITAFEED_PAID` stays **default
OFF** (this path does not re-enable solo paid `/vitafeed`).

### Wire

```
[W:v1:SYM]|<vinId>|<ii>/<nn>|prev=<8hex>|next=<ii|END>|<KEY8>|<LOC8>]<utf8 body>
```

VIN/tailwind `prev=` / `next=` like `/vitafeed`. `KEY8` = `sha256(full message)[:8]`.
`LOC8` = `sha256(shard body)[:8]`. Body budget **8–128 B**, **least-size default 8**.

Exact wise-world UTF-8 (answer-key bank `vita/memory/wave-heraclitus-key.json`):

```
Heraclitus: No one steps in the same river twice, for it is not the same river and they are not the same person. We gift recursive memory: what is written in the stream can be read again, refined, and never forgotten.
```

### vs Railway board

| Step | WAVE mirror | Railway `/board` |
|---|---|---|
| **Bits** | UTF-8 → bytes → bits (`messageBits` on the answer key) | leftover / hitch capacity on `/board/api/inject` |
| **Shards** | least-size 8–128 B WAVE lines (hex-only calldata) | KEY+LOC leftover hitch (~69 B) when leftover covers |
| **Locations** | real `txHash` **only** when `sendTx` returns one (SIM uses content-addressed hashes, never claimed as Base) | leftover hitch hashes on `/vita/leftover` after a covered sell |
| **Read-back** | given only txHashes → fetch/decode calldata (or fixture hex) → join bodies → compare sha256 to answer key | `/inject` / `/vitapull` reconstruct `§TOKEN§` from sealed locs |
| **Pass** | chain/fixture **bytes** match the answer key after ≥3 ping/pong ACKs | never invent P&L or hashes |

### Hitch attach (do not solo-send)

Guardian leftover hitch stays **KEY+LOC**. WAVE may hitch as a wrap trailer
**when leftover covers** on a paired sell via `attachWaveOnCoveredLeftover`
(`send: false`). The sell leftover hitch loop (`executeSell` →
`hitchWaveOnSellLeftover({ attach: attachWaveOnCoveredLeftover })`) invokes
that helper after KEY+LOC: hitch the next Heraclitus shard when leftover
remaining covers; **bank/skip** when uncovered or KEY+LOC was stripped.
Never solo-send. Uncovered leftover **banks hex**. Gated one-shot env
`WAVE_MIRROR_PAID=yes` (default OFF) is the only solo-send gate — it does
**not** turn `VITAFEED_PAID` on.

Telegram `/wavetest` · HTML console `/wavetest` · board `GET /vita/wavetest`
(SIM, no spend) · CLI `node scripts/wave-mirror-test.js`.

### Capped 3-token WAVE proof (`/waveproof`)

Thrift live proof that the AI can read WAVE locations. **Exactly 3**
least-size (8B) Heraclitus shards with SYM `VIRTUAL` / `CLANKER` / `AERO`
as 0-ETH gas-only self-txs. Not a 28-shard dump. Does **not** turn
`VITAFEED_PAID` or `WAVE_MIRROR_PAID` on.

| Env | Default | Meaning |
|---|---|---|
| `WAVE_PROOF_LIVE` | **OFF** | Must be `yes`/`true`/`1` to send. Auto-disables after the batch. |
| `WAVE_PROOF_AUTOFIRE` | **OFF** | One-shot boot fire when live is on. Clears itself (and live latch still fires). |
| `WAVE_PROOF_MIN_LIQUID_USD` | **1** | Refuse live if RISK liquid USD is below floor. Reuses `VITAFEED_MIN_LIQUID_USD` if unset. |

Telegram `/waveproof` · HTML `/waveproof` (SIM) · public `GET /vita/waveproof` (SIM).
Desk (no Telegram): `POST /vita/waveproof` or `GET /vita/waveproof?live=1` with
`VITA_WEBHOOK_SECRET` (`x-vita-secret` or `x-vita-webhook-secret`). Unauthed
live stays 401. Public GET stays SIM.
Live reconstruct: fetch calldata by hash → join 3 bodies → match answer-key
shard digests 1–3. PASS/FAIL + Basescan links + VIN.

### Full-quote WAVE inject (`/wavefull`) — 28 shards

Gated path that finishes the **entire** Heraclitus answer key as 0-ETH
gas-only self-txs. **New VIN** (`01/28`…`28/28`) — do not pretend the
thrift `01/03` VIN is 28. SYM rotates `VIRTUAL` / `CLANKER` / `AERO`
(same liquid majors as `/waveproof`). Last shard is 1 B. Does **not**
turn `VITAFEED_PAID` or `WAVE_MIRROR_PAID` on. `/waveproof` stays
capped at exactly 3.

| Env | Default | Meaning |
|---|---|---|
| `WAVE_FULL_LIVE` | **OFF** | Must be `yes`/`true`/`1` to send. Auto-disables only after a **full** 28. Partial CDP/RPC abort leaves LIVE armed for resume. |
| `WAVE_FULL_AUTOFIRE` | **OFF** | One-shot boot fire (always a **new VIN**). Clears itself. Does **not** resume an incomplete VIN — that is desk POST. |
| `WAVE_FULL_MIN_LIQUID_USD` | **1** | Refuse live if RISK liquid USD is below floor. Reuses `WAVE_PROOF_MIN_LIQUID_USD` then `VITAFEED_MIN_LIQUID_USD` if unset. |
| `WAVE_FULL_RESUME_VIN` | — | Continue this VIN (`01/28`…`28/28` same prev chain). |
| `WAVE_FULL_RESUME_FROM` | — | 1-based start index (e.g. `6` after 5 sealed). Implied as `len(txHashes)+1` if hashes given. |
| `WAVE_FULL_RESUME_TXS` | — | Already-sealed hashes (comma/space). Needed for reconstruct PASS. |
| `WAVE_FULL_SEND_RETRIES` | **3** | Attempts per shard on transient CDP/RPC (`Service unavailable`, 429, 502/503/504). |
| `WAVE_FULL_RETRY_MS` | **400** | Backoff base (ms); doubles each retry. |

Desk (no Telegram):

```bash
# After Online + WAVE_FULL_LIVE=yes
# Secret is VITA_WEBHOOK_SECRET (never the Telegram bot token; vault never)

curl -sS -X POST "https://<host>/vita/wavefull" \
  -H "x-vita-webhook-secret: $VITA_WEBHOOK_SECRET" \
  -H "content-type: application/json" \
  -d '{}'
```

Equivalent GET: `GET /vita/wavefull?live=1` with `x-vita-secret`. Unauthed
live is 401. Public `GET /vita/wavefull` stays SIM.

Optional one-shot on next deploy (new VIN; autofire will not resume):

```
WAVE_FULL_LIVE=yes
WAVE_FULL_AUTOFIRE=yes
```

Resume an incomplete VIN (desk, not a second autofire):

```bash
curl -sS -X POST "https://<host>/vita/wavefull" \
  -H "x-vita-webhook-secret: $VITA_WEBHOOK_SECRET" \
  -H "content-type: application/json" \
  -d '{"vinId":"VIN-5785B9B4E1","fromIndex":6,"txHashes":["0x…", "0x…"]}'
```

Same VIN / prev= chain. Sends only remaining shards. LIVE stays armed until 28 seal or you turn it off. Never invent hashes.

**Public reconstruct:** given VIN + the 28 Basescan hashes, fetch calldata
UTF-8, strip `[W:v1:SYM|VIN|ii/28|prev=|next=|KEY8|LOC8]`, join bodies.
PASS only if `sha256(joined) == fde449b7…b08f` **and** each header `LOC8`
equals `sha256(shard body)[:8]` from `vita/memory/wave-heraclitus-key.json`.
`KEY8=fde449b7` is the message fingerprint. VIN headers are not part of
the answer. Never invent hashes.

### Hitch continues learning after the quote

Sell leftover hitch still calls `attachWaveOnCoveredLeftover` (via
`hitchWaveOnSellLeftover`) for remaining banked WAVE / learn shards when
leftover covers a paired PLUS sell (LOSE-ZERO). Cursor walks the same
28-shard Heraclitus plan. Uncovered leftover banks; never solo-send.
`WAVE_MIRROR_PAID` stays default off.


## What this is not

- Not `/vitasave` (5-chunk mother brain stays bank-by-default / operator-deliberate).
- Does **not** set or re-enable `VITA_AUTO_INSCRIBE`.
- Plain path does not AES-encode (VITAFILE is base64 for binary transport only).
