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
5. `/vitafeed override` is the same paid path but **bypasses the RISK balance REFUSE** (proceed despite underfunded inscription + buy-in + gas). Buys/inscription may still fail on-chain. **Override cannot bypass `VITAFEED_PAID=no`, the liquid floor, or the rate limit.**
6. When every location seals → **PLAY PROOF**: Tailwind reader peaces spaced
   locations together and plays the blob (`/vita/feed-player`).
7. Receipt (after) repeats the cost math plus Basescan links, tx hashes, and the reader key.
8. **LIBRARY (quick pull from Telegram):** each sealed file auto-saves its
   **name + reader key + locations** into the keys library. Then:
   - `/vitafeed files` — numbered list of what you saved
   - `/vitafeed play <n|name>` (also `open` / `pull`) — rebuild + open player
   - `/vitafeed keys` — stage a `§VITALIB§` catalog (name→key→locs) as the
     **keys chain** for reader quick access; confirm|override seals it like
     any other feed body
   Player deep-link: `/vita/feed-player?lib=N` · API: `GET /vita/feed-library`

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
| `VITAFEED_PAID` / `VITAFEED_ENABLED` | default **OFF** | Must be `yes`/`true`/`1` to allow confirm/override `sendTransaction`. Override cannot bypass. |
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


## What this is not

- Not `/vitasave` (5-chunk mother brain stays bank-by-default / operator-deliberate).
- Does **not** set or re-enable `VITA_AUTO_INSCRIBE`.
- Plain path does not AES-encode (VITAFILE is base64 for binary transport only).
