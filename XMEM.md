# XMEM Agentic Memory Protocol v1

Handoff for humans, Cursor/Grok agents, and the live Guardian trader on Base.

**Status:** Retrieval + overlay implemented in repo-root `xmem.js`.  
**Live leftover hitch is unchanged:** dense VITA `§$STORE§ §KEY§…§LOC§…` still rides leftover-covered swaps. XMEM does not replace that encoding (KEY+LOC is denser bytes-per-$).  
**Relation to L1 research:** `guardian-protocol/HANDOFF.md` stays the Arena/L1 sideline. This file is the **live Base UTF-8 input-data** memory log.

---

## 1. Purpose

Enable agentic AI and humans to **find** notes already sitting in Base transaction **input data** (the UTF-8 hitch Cuborg missed when it searched token transfers), and to **write** optional compact XMEM records later without inventing chain history.

Wallet: `0x50e1C4608c48b0c52E1EA5FBabc1c9126eA17915`  
Chain: Base

---

## 2. Why Cuborg missed Eureka / Kai / Koda / Krystian

Those characters were already on tx `0xef4d0a2adb2c3f4c0f75c21cb40d041da823196283f1308f5dbe56db3ab88b60` in the UTF-8 hitch:

```text
§$STORE§ §KEY§eureka♥Krystian,Kai,Koda§LOC§n=161|t=7cfa|r=d982
```

Explorers “View as UTF-8” on the **whole** input also show Uniswap ABI bytes as garbage, then the hitch. Latin-1 mojibake looks like `Â§$STOREÂ§` / `â™¥`. Transfer lists do not contain this text.

**Agent rule:** decode `tx.input` as UTF-8 (swap trailer after 228-byte `exactInputSingle`, or the full payload on 0-ETH `/prove` self-txs). Repair mojibake. Search `XMEM`, `§$STORE§`, `§KEY§`. Never invent a match.

---

## 3. Canonical on-chain payload

```text
XMEM|v1|ns=<namespace>|type=<type>|id=<unique_id>|tags=<tag1,tag2>|ref=<ref>|state=<state>|target=<target>|note=<short_text>
```

### Field rules

| Field | Required on **new writes** | Notes |
|---|---|---|
| `XMEM` | yes | Fixed search prefix |
| `v1` | yes | Schema version |
| `ns` | yes | e.g. `base-trade`, `media`, `intent` |
| `type` | yes | `trade` `intent` `signal` `summary` `link` `warning` `note` `media` `memory` |
| `id` | yes | Unique, stable. **Do not invent** one for legacy STORE hitch |
| `tags` | yes | Comma-separated, lowercase |
| `note` | yes* | Short text. No raw `\|` (encoded as `/`). *or tags/ref |
| `ref` | no | Tx hash, address, prior id, IPFS/HTTPS pointer |
| `state` | no | `pending` `active` `settled` |
| `target` | no | Label only (price/condition). Not an executor |
| `src` `role` `scope` | no | Optional extensions |

Legacy leftover hitch **maps** to XMEM overlay (`ns=base-trade`, `type=trade`, tags from KEY names, `ref=LOC`) **without an invented id**.

---

## 4. Write rules

- Append-only. Never overwrite or delete chain records.
- Keep on-chain payload short (prefer &lt; 256 bytes). Clip note to leftover budget (`clipXmemToBudget`).
- **Live leftover hitch stays KEY+LOC.** Do not switch the injector to XMEM by default.
- Large media: off-chain storage; `ref` holds the pointer. On-chain = proof / timestamp / index.
- Hitch only when leftover covers cost (existing LOSE-ZERO). Never sell/buy red to insert memory.
- Prefer lowercase tags. Unique id per **new** record.

Payment leg = the leftover-covered swap already paying L1/L2 calldata. Memory leg = UTF-8 in input data. Settlement link = `ref` / tx hash.

---

## 5. Read / retrieve rules

Search priority:

1. Prefix `XMEM` (also `CUBORG-MEMORY`, `§$STORE§`, `§KEY§`)
2. `ns`
3. `type`
4. `id` (exact match wins)
5. `tags` (case-insensitive; love-note aliases: kristian→krystian, coda→koda)
6. `note` text / name fragments (any order)
7. `ref`

Missing fields are **absent**, not empty. Do not invent values. Do not assume a record exists unless found.

### Human / agent queries

- Find all XMEM records in namespace `base-trade`
- Search for tag `krystian`
- Load memory `id=20260912-0001`
- Show every record referencing `0xabc123`
- Search `eureka kai koda krystian` (any order / mild misspelling)

### Protocol links

- **x402** — authenticated / verified retrieval (`GET /vita/xmem` with `x-vita-secret`)
- **x404** — unresolved / no match (`found: false`). Fallback: search STORE/KEY hitch UTF-8. Never a fake record.

---

## 6. Agent surfaces

| Surface | What it does |
|---|---|
| `xmem.js` | Codec, overlay, search, clip |
| `GET /vita/xmem/spec` | Public JSON spec + `AGENT_INSTRUCTIONS` |
| `GET\|POST /vita/xmem/decode` | Parse/search **provided** utf8/hex (no chain fetch) |
| `GET /vita/xmem?q=` | x402 wallet scan + search |
| Telegram `/xmem [query]` | Operator search of recent wallet input data |
| HTML `/xmem` | Search sealed hitch already pulled into the console |
| `GET /vita/lib/xmem.js` | Same module the bot uses |
| `finetune-memory.js` | Sixth-lobe hypothesis graph → XMEM overlay (`ns=finetune`) |
| `GET /vita/brain` | Six-lobe brain status + graph (auth) |
| Telegram `/brain` `/hyp*` | Operator fine-tune loop |

Machine instruction block: `AGENT_INSTRUCTIONS` in `xmem.js`.

**Finetune link:** COST_EDGE refusals and operator `/hyp` rows encode as XMEM
`type=warning|summary|note` via `hypothesisToXmem` — append-only retrieval
overlay, never invents chain history. See `finetune-memory.js`.

---

## 7. Cost control (safe)

Not a profit-extraction design. Agents may:

- Compress / clip before write
- Deduplicate by id + ref
- Retrieve only matching records (do not dump every tx)
- Store pointers off-chain for movies / large blobs
- Keep live leftover hitch as KEY+LOC (already the cheap encoding)
- Scale hitch bytes with leftover (`clipXmemToBudget`) — 1-bit inserts are HAT, not XMEM (prefix needs more than one bit)

---

## 8. Safety

- Never invent or alter historical records
- Never claim Telegram text is on-chain unless those bytes are in mined calldata
- KEYCAT `0x5c0a93e4…` is a plain 228-byte swap with **no hitch**
- `/prove` remains the Eureka love-note genesis (0-ETH self-tx)
- Do not merge V4 into this injector
- Do not present this overlay as lossless L1 preservation (`guardian-protocol/` Grand Challenge stays separate)
