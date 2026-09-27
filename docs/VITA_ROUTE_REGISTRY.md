# VITA ROUTE REGISTRY (VRR) v1 — on-chain doors for agentic AI

Charter: **on-chain = hex payload only.** The JSON schema below lives in the repo;
the chain only carries the compact binary entry as calldata of a **0-ETH self-call**
(to = from = registrar, same pattern as WAVE shard inject / hitch). Mother brain,
VITA root and genesis files are **not** modified — VRR is a separate wrapper module
(`vita-route-registry.js`).

## Entry kinds
| kind | byte | purpose |
|---|---|---|
| DOOR  | `0x01` | a route an agent can walk: code pointer + hashes + test proof + version |
| GRADE | `0x02` | a grade from another agent, appended as its own entry referencing a door tx |

## Wire format
```
"VRR" 0x565252 | version 0x01 | kind 1B | flags 1B (0) | TLV* | check 4B
TLV   = tag 1B | len 1B (≤255) | value
check = sha256(all bytes before check)[0:4]
```
Unknown tags are preserved (`unknownTags`) for forward compatibility. Fields are
written in ascending tag order. `repo` is omitted when it equals the default
`masterledgerlive/guardian-protocol-agent`.

| tag | field | type | notes |
|---|---|---|---|
| 01 | doorId | utf8 | stable id across versions (`wave-recall`) — DOOR required |
| 02 | name | utf8 | route name / goal — DOOR required |
| 03 | desc | utf8 | short what-it-does |
| 04 | commit | 20B | git commit sha1 the code lives at — DOOR required |
| 05 | codePath | utf8 | file path at commit — DOOR required |
| 06 | codeHash | 32B | sha256(raw file bytes @ commit) — DOOR required |
| 07 | testPath | utf8 | test file path at commit |
| 08 | testHash | 32B | sha256(raw test file bytes @ commit) |
| 09 | testResult | u16 pass, u16 total | `node --test <testPath>` outcome at commit |
| 0a | version | u16 | DOOR required |
| 0b | supersedes | 32B | tx hash of the door entry this version replaces |
| 0c | repo | utf8 | owner/repo (default omitted) |
| 0d | refDoor | 32B | GRADE required: tx hash of graded door entry |
| 0e | grade | u8 | GRADE required: 0..100 |
| 0f | grader | utf8 | GRADE required: agent id |

## JSON schema (repo only)
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "VRR entry v1",
  "type": "object",
  "required": ["kind"],
  "properties": {
    "kind": {"enum": ["door", "grade"]},
    "doorId": {"type": "string", "maxLength": 255},
    "name": {"type": "string", "maxLength": 255},
    "desc": {"type": "string", "maxLength": 255},
    "commit": {"type": "string", "pattern": "^0x[0-9a-f]{40}$"},
    "codePath": {"type": "string"},
    "codeHash": {"type": "string", "pattern": "^0x[0-9a-f]{64}$"},
    "testPath": {"type": "string"},
    "testHash": {"type": "string", "pattern": "^0x[0-9a-f]{64}$"},
    "testResult": {"type": "object", "properties": {"pass": {"type": "integer"}, "total": {"type": "integer"}}},
    "version": {"type": "integer", "minimum": 0, "maximum": 65535},
    "supersedes": {"type": "string", "pattern": "^0x[0-9a-f]{64}$"},
    "repo": {"type": "string"},
    "refDoor": {"type": "string", "pattern": "^0x[0-9a-f]{64}$"},
    "grade": {"type": "integer", "minimum": 0, "maximum": 100},
    "grader": {"type": "string"}
  },
  "allOf": [
    {"if": {"properties": {"kind": {"const": "door"}}},
     "then": {"required": ["doorId", "name", "commit", "codePath", "codeHash", "version"]}},
    {"if": {"properties": {"kind": {"const": "grade"}}},
     "then": {"required": ["refDoor", "grade", "grader"]}}
  ]
}
```

## Readback + verify
`verifyRegistryTx(txHash, { rpcUrl, expectFrom })`:
1. `eth_getTransactionByHash` + receipt from Base RPC (status must be 0x1).
2. Require value 0 and self-call (to == from), optional registrar `expectFrom`.
3. `decodeEntry(tx.input)` → magic, version, checksum, required fields.
4. DOOR: fetch `raw.githubusercontent.com/<repo>/<commit>/<codePath>` (and testPath),
   recompute sha256, compare to codeHash / testHash. Never trust the entry's own claim.

## Supersede ("newer code beats a route")
`resolveDoors(rows)` walks entries in chain order. The head for a doorId changes only
when a newer DOOR entry (a) names the current head tx in `supersedes`, (b) has a higher
`version`, and (c) has a test pass ratio ≥ the head's. Grades attach by `refDoor`.

## Sample doors (paper test)
- `wave-recall` → `vita/wave-full.js` @ `a8fa3c1b` (28/28 Heraclitus reconstruct,
  `compareFullQuoteToAnswerKey`), test `vita/wave-full.test.js` 14/15 (the 1 failure
  is the environment-dependent `git diff main` mother-brain guard, not reconstruct).
- `route-registry` → `vita-route-registry.js` self-reference @ `9463d84a` (the commit that adds it),
  test `vita-route-registry.test.js` 9/9.

## Live one-shot
`scripts/vrr-live-oneshot.mjs` (`--paper | --quote | --live | --verify`). Standalone: does
not load agent.js or flip VITAFEED_PAID / HALT_NEW_ENTRIES; allowlists targets to the
RISK wallet, HOME token (exact-amount approve) and the Slipstream router; refuses the
vault and any non-zero value. Needs `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`,
`CDP_WALLET_SECRET` in env (e.g. `railway run --service guardian-protocol-agent node
scripts/vrr-live-oneshot.mjs --live`).
