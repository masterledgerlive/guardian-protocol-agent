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
| `vita/mother-genesis.js` | `MOTHER_GENESIS` | N-batch plain/encoded dumps + on-chain full MGLOCS loc list (squash later) — not the 5-chunk mother brain |
| `vita/mg-recall-bank.js` | `MG_RECALL` | Force-banked recall stack for simple pull — notes attached; last layer is refined queries |
| `vita/vita-feed.js` | `VITAFEED` | Exact plain / VITAFILE paid inject game (RISK confirm\|override; override bypasses liquid floor; partial seal) |
| `vita/vita-feed-backlog.js` | `FEED_BACKLOG` | Append-only queue of memory/files for `/vitafeed` drain without agentic AI |
| `vita/memory/vitafeed-backlog.json` | `FEED_BACKLOG` | Pending→sealed feed queue + growth roots |
| `vita/brain-seed.js` | `BRAIN` / `BRAIN_SEED` | Recursive-AI mind seed (formula+anchors+recall) for `/vitafeed brain` |
| `vita/brain-learn.js` | `BRAIN_LEARN` | Old→new learn cycle, filing refine, library + zero-proof growth |
| `vita/ref-memory.js` | `REF_LIB` / `PROVEN_TEST` / `TRANSLATOR_CODEX` | Proven recursive search — calculator true-name + multilingual aliases; ask\|self labels; answers cite Base anchors only |
| `vita/memory/ref-lib-*.json` | `REF_LIB` | Reference catalogue entries (trueName, ask\|self, sealed locs) |
| `vita/memory/proven-test-*.json` | `PROVEN_TEST` | Proven test series notes for ledger search |
| `vita/memory/filing-labels-learned.json` | `FILING` (refined) | Self-refining label map (PEER_REVIEW, ZERO_PROOF, …) |
| `vita/memory/brain-learn-log.json` | `ZERO_PROOF` | Append-only learn cycles + hash-chain roots |
| `vita/vita-feed-file.js` | `VITAFILE` | Any bytes → §VITAFILE§ base64 text packets for `/vitafeed` |
| `vita/vita-feed-library.js` | `VITALIB` | Named save → list → play; §VITALIB§ keys catalog (name→key→locs) |
| `vita/vita-feed-player.js` | `FEED_PLAYER` | Spaced-location assemble + play proof after seal |
| `public/vita-feed-player.html` | `FEED_PLAYER_HTML` | Tailwind reader — upload, peace locations, play |
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
| `BRAIN_SEED` | Mind seed body (`§VITABRAIN§`) |
| `MOTHER_GENESIS` | N-batch plain/encoded dumps — not the 5-chunk mother brain |
| `MG_RECALL` | Force-banked recall stack (`§MGRECALL§`) — pull one location; last layer is refined queries |
| `BRAIN_LEARN` | Old→new learn delta (`§VITALEARN§`) |
| `PEER_REVIEW` | One peer review of learn (`§PEERREVIEW§`) — separate from MEMORY |
| `ZERO_PROOF` | Squashed content-addressed retrieval growth (`§ZEROPROOF§`) |
| `FEED_BACKLOG` | Offline `/vitafeed` inject queue (`§VITABACKLOG§`) — pending→sealed without agent AI |
| `REF_LIB` | Reference library search (`§VITAREF§`) — trueName + ask\|self; calculator first domain |
| `PROVEN_TEST` | Proven test series (`§PROVENTEST§`) — recursive memory must answer from packaged locs |
| `TRANSLATOR_CODEX` | Free multilingual alias map (`§VITATRANS§`) — read once, never forget |
| `VITA_SAVE_LEARN` | Bankable §TOKEN§ learn packet for `/vitasave` retrieval |

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
