# VITA filing map — how agents should file

Agents read this file first when touching memory, hitch, HTML, or chain
anchors. Labels match on-chain kinds so blockchain paths stay hardcoded and
findable.

## Directory contract

| Path | Label | What goes here |
|---|---|---|
| `vita/ORIGINAL_FORMULA.md` | `FORMULA` | Frozen invariants — do not weaken |
| `vita/AGENTS.md` | `AGENT` | On-ramp + read order |
| `vita/FILING.md` | `FILING` | This map |
| `vita/mainframe.js` | `MAINFRAME` | Anchors, HTML infect, sparse plan, message-first gate |
| `vita/anchors.json` | `ANCHORS` | Hardcoded Base txs / router / wallet |
| `vita/memory/` | `MEMORY` | Learned notes (`*.json` strands of §TOKEN§ / hypotheses) — append-only |
| `vita/strands/` | `STRAND` | Sparse inject chunk plans keyed by sealed loc short-hash |
| `public/vita.html` | `HTML` | Infected console — memory until `/inject` |
| `public/vita-client.js` | `HTML_CLIENT` | Browser twin of Telegram commands |
| `vita-console.js` | `CONSOLE` | Server/HTML console state machine |
| `vita-memory.js` | `COMPRESS` | §TOKEN§ compress / strand hash-link |
| `vita-chain-reader.js` | `CHAIN` | Calldata → UTF-8 hitch reader |
| `vita-locations.js` | `LOC` | Append-only location depository |
| `vita-router.js` | `ROUTER` | Leftover hitch mode vita\|eureka\|hat |
| `xmem.js` / `XMEM.md` | `XMEM` | Retrieval overlay — does not replace KEY+LOC |

## Label → blockchain

| Label | Hardcoded meaning |
|---|---|
| `none` | Plain 228-byte swap (KEYCAT class) |
| `eureka` | `/prove` love-note class |
| `vita` | `§TOKEN§` / KEY+LOC leftover hitch |
| `hat` | HAT bit stream on leftover |
| `tag` | Short tag hitch |

Full tx hashes live in `vita/anchors.json` and inside infected HTML
(`#vita-mainframe`). Hitch trailers only carry squashed `§LOC§`.

## Filing rules for agents

1. **New chain truth** → append to `vita/memory/` or seal via location
   depository — never rewrite sealed UTF-8.
2. **New hardcoded path** → add to `vita/anchors.json` + regenerate HTML
   infect via `infectVitaHtmlDocument`.
3. **Code refine** → keep `ORIGINAL_FORMULA.md` invariants; grow strands in
   `vita/strands/`; point PRs at this folder as the continuing base.
4. **Reads** → prefer `GET /vita/inject`, `/vita/locations`, `/vita/leftover`,
   and Basescan UTF-8 over invented summaries.
5. **Writes on-chain** → leftover KEY+LOC when covered; `/prove` for Eureka;
   never invent a hash.
6. **Env** → `VITA_MESSAGE_FIRST` default `yes` (1× cover → hitch). Set `no`
   only to restore micro-extract SKIP_HITCH + bank below the 2× cushion.

## Continue-until-merge

This `vita/` tree is the **avenue base** while other branches experiment.
Merge back into root modules without deleting HTML infect or anchors.
