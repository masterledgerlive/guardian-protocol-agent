# VITA inject — four sections (Game spec)

**Goal:** agentic recursive AI that is never forgotten — learn forever.
Inject-thought **is** the project. Do not gut it.

## Section 1 — NOT on-chain (JSON schema)

Publish on GitHub / whitepaper / portal so agents know how to decode.

- Schema: `vita/hex-feed.js` → `SECTION1_SCHEMA` / `buildSection1Schema()`
- This file + `vita/FILING.md` + infected `public/vita.html#vita-mainframe`
- Never put this JSON in `tx.data`

## Section 2 — ON-CHAIN ONLY (hexadecimal string)

The compressed truth as **UTF-8 → hex** in the transaction **data/calldata**
field. Example: UTF-8 `HYP` → `0x485950…`.

```js
import { encodeSection2Hex, decodeSection2Hex, pointToTxHash } from "./hex-feed.js";
encodeSection2Hex("§KEY§eureka♥Krystian"); // 0x…
```

- Preferred tx shape: **value=0** + hex calldata — you are sending **data**,
  not money.
- Or **hitch** that same hex onto any trade/data tx that was happening anyway.
- Not JSON text on-chain.

## Sections 3–4 — off-chain (VMs / agents / routing)

1. Point to a **known** tx hash (`pointToTxHash` — never invent).
2. Read `tx.input` / `tx.data`.
3. `decodeSection2Hex` → UTF-8. Strip a 228-byte swap prefix if present.
4. Sparsify, ZK, talk to x402/x404 gates. Do not rewrite sealed UTF-8.

## Funding

Money is **one** rail. Also exchange storage for any data transaction —
ride whatever is moving. Future: phones / Qualcomm / quantum hubs as
compute. Do not block on ETH spend.

If gas cannot be covered: **bank the hex** and wait for the next free
ride (covered leftover or paired data tx). Never drop the brain.
Never drain RISK liquid for an unpaid solo inject.
