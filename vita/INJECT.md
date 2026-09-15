# /vitafeed — Storage Token inject game

Test the storage product **before** public StorageToken. Telegram-only paid path.

## Flow

1. `/vitafeed [exact plain text]` — or reply to a message with `/vitafeed`.
2. Bot replies with a **cost card** (before): chars / UTF-8 bytes / bits, max payload per chunk, injection count, ETH/$ per injection × N, VIN/tailwind pointers, IN bytes vs OUT (pending).
3. `/vitafeed confirm` pays **RISK only** for each max chunk until the whole string is on-chain.
4. `/vitafeed override` is the same paid path but **bypasses the RISK balance REFUSE** (proceed despite underfunded inscription + buy-in + gas). Buys/inscription may still fail on-chain.
5. Receipt (after) repeats the cost math plus Basescan links, tx hashes, and the reader key.

`/vitafeed cancel` drops a staged payload. Confirm is always required so a 1000+ character paste cannot burn by accident. Use override only when you intentionally want to force through the underfunded REFUSE.

## Constants

| Name | Value | Meaning |
|---|---|---|
| `VITAFEED_MAX_CHUNK_BYTES` | **720** | Max verbatim UTF-8 payload bytes per injection (VIN header sits outside) |
| `VITAFEED_CONFIRM_CHARS` | 1000 | Large-body warning on the cost card |
| `VITAFEED_TX_GAS_UNITS` | 50_000 | Documented self-tx gas class (`BTP_INSCRIBE_GAS_UNITS`) |
| Payer | RISK `0x50e1…7915` | Vault / save bucket never spend |

Quotes are labeled **LIVE** (Base gas + ETH mark + optional `getL1Fee`) or **DEMO** (documented 0.05 gwei / $2481 ETH).

## Exact plain

Whatever follows `/vitafeed` (or the reply body) is inscribed **verbatim**. No summarization. No `§SESS§` template unless the operator typed it. UTF-8 → hex calldata.

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
- Does not encode (later StorageToken products may). This test is **plain**.
