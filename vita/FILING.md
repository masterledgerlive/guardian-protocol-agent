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
| `vita/vita-dir.js` | `VITADIR` | DOS-style master directory + open-source unlock (no private key); instant ZK-short unwrap |
| `vita/mirror-chain.js` | `MIRROR_CHAIN` | GitHub-as-blockchain file read + SNARK unwrap + Railway-style session keys + Telegram click-through |
| `vita/memory/mirror-chain-github.json` | `MIRROR_CHAIN` | Research note: GitHub contents ≈ availability ledger; Base hitch = settlement |
| `vita/message-cascade.js` | `MESSAGE_CASCADE` | Eureka love → each token hop; instant wave HL from token data; ≥8/15m; $0.05 dust; rank revenue + waiting-up |
| `vita/memory/message-cascade-operator.json` | `MESSAGE_CASCADE` | Operator love/eureka cascade brief (message half of alternation) |
| `vita/strands/message-cascade.json` | `MESSAGE_CASCADE` | Agentic cascade knowledge (knowledge half — useful for time to come) |
| `vita/vita-feed.js` | `VITAFEED` | Exact plain / VITAFILE paid inject game (RISK confirm\|override; override bypasses liquid floor; partial seal) |
| `vita/vita-feed-dual.js` | `VITADUAL` | Human plain ↔ machine ZK-short dual lane; side-by-side cost/size; Basescan Input Data UTF-8 read receipt; restart exit ≥$0.50 |
| `vita/vita-feed-loader.js` | `FEED_LOADER` | Curated knowledge packs → backlog preload + dual cost mirror; Telegram know/recall; cipher hierarchy; animated `/vita/feed-loader` |
| `vita/vita-feed-backlog.js` | `FEED_BACKLOG` | Append-only queue of memory/files for `/vitafeed` drain without agentic AI |
| `vita/feed-flow.js` | `FEED_FLOW` | Append-only feed ledger + Basescan Input Data → UTF-8 IDM chat of locs being fed |
| `vita/memory/vitafeed-backlog.json` | `FEED_BACKLOG` | Pending→sealed feed queue + growth roots |
| `vita/memory/feed-flow-ledger.json` | `FEED_FLOW` | Event log proving memory is fed; directory counts + IDM Basescan locs |
| `vita/memory/feed-flow-growth.json` | `FEED_FLOW` | Latest growth snapshot (memory/strands file+byte counts) |
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
| `VITADIR` | DOS master directory (`§VITADIR§` / `§VITAUNLOCK§`) — open-source file-name unlock; instant unwrap |
| `MIRROR_CHAIN` | GitHub-as-chain (`§VITAMIRROR§` / `§VITASNARK§`) — CODE=main / STATE=bot-state blob SHA + SNARK unwrap + Basescan IDM; session keys like Railway env |
| `MESSAGE_CASCADE` | Eureka love message cascade into each token (`§MSGCASC§`) — instant wave HL; cadence ≥8/15m |
| `BRAIN_LEARN` | Old→new learn delta (`§VITALEARN§`) |
| `PEER_REVIEW` | One peer review of learn (`§PEERREVIEW§`) — separate from MEMORY |
| `ZERO_PROOF` | Squashed content-addressed retrieval growth (`§ZEROPROOF§`) |
| `FEED_BACKLOG` | Offline `/vitafeed` inject queue (`§VITABACKLOG§`) — pending→sealed without agent AI |
| `FEED_FLOW` | Feed-flow ledger (`§VITAFLOW§`) — IDM Basescan chat of locs + directory growth proof |
| `REF_LIB` | Reference library search (`§VITAREF§`) — trueName + ask\|self; calculator first domain |
| `PROVEN_TEST` | Proven test series (`§PROVENTEST§`) — recursive memory must answer from packaged locs |
| `TRANSLATOR_CODEX` | Free multilingual alias map (`§VITATRANS§`) — read once, never forget |
| `VITA_SAVE_LEARN` | Bankable §TOKEN§ learn packet for `/vitasave` retrieval |
| `VITADUAL` | Dual-lane human plain + machine ZK-short (`§VITADUAL§`) — side-by-side cost/size + Basescan read receipt |
| `FEED_LOADER` | Curated pack preload into backlog (`§VITALOAD§`) — cipher/prog hierarchy + did-you-know recall |
| `CIPHER` | Encode↔decode knowledge hierarchy (AES-GCM / MGENC / open unlock) |

Full tx hashes live in `vita/anchors.json` and inside infected HTML
(`#vita-mainframe`). Hitch trailers only carry squashed `§LOC§`.

## Filing rules for agents

1. **New chain truth** → append to `vita/memory/` or seal via location
   depository — never rewrite sealed UTF-8.
2. **New hardcoded path** → add to `vita/anchors.json` + regenerate HTML
   infect via `infectVitaHtmlDocument`.
3. **Code refine** → keep `ORIGINAL_FORMULA.md` invariants; grow strands in
   `vita/strands/`; point PRs at this folder as the continuing base.
4. **Reads** → prefer `GET /vita/read`, `/vita/mirror`, `/vita/inject`, `/vita/locations`, `/vita/leftover`,
   and Basescan UTF-8 over invented summaries. `/vita read FILE` is local disk first (no Anthropic).
5. **Writes on-chain** → leftover KEY+LOC when covered; `/prove` for Eureka;
   never invent a hash.
6. **Env** → `VITA_MESSAGE_FIRST` default `yes` (1× cover → hitch). Set `no`
   only to restore micro-extract SKIP_HITCH + bank below the 2× cushion.

## Continue-until-merge

This `vita/` tree is the **avenue base** while other branches experiment.
Merge back into root modules without deleting HTML infect or anchors.
