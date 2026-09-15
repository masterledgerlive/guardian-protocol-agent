# /vitafeed — Storage Token inject game

Test the storage product **before** public StorageToken. Telegram-only paid path.

## Flow

1. `/vitafeed [exact plain text]` — or reply to a message with `/vitafeed`.
2. Bot replies with a **cost card** (before): chars / UTF-8 bytes / bits, max payload per chunk, injection count, ETH/$ per injection × N, VIN/tailwind pointers, IN bytes vs OUT (pending).
3. `/vitafeed confirm` pays **RISK only** for each max chunk until the whole string is on-chain.
4. Receipt (after) repeats the cost math plus Basescan links, tx hashes, and the reader key.

`/vitafeed cancel` drops a staged payload. Confirm is always required so a 1000+ character paste cannot burn by accident.

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

## What this is not

- Not `/vitasave` (5-chunk mother brain stays bank-by-default / operator-deliberate).
- Does **not** set or re-enable `VITA_AUTO_INSCRIBE`.
- Does not encode (later StorageToken products may). This test is **plain**.
