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
| `vita/chain-dir.js` | `CHAINDIR` | Line-for-line on-chain completion directory — routing vs sealed Input Data proofs; HUMAN+MACHINE wait; cycle trigger |
| `vita/memory/chain-dir-ledger.json` | `CHAINDIR` | Append-only completion log (active top, complete bottom) |
| `public/vita-chain-dir.html` | `CHAINDIR` | Clickable Basescan Input Data directory |
| `vita/strands/chain-dir.json` | `CHAINDIR` | Sparse strand: two ends talk → loc proof → cycle next inject |
| `vita/memory/kids-url-directory.json` | `URLDIR` | Pulled KIDS playlist URLs (urls only — no media copies) |
| `public/vita-kids-player.html` | `URLDIR` | Closed-garden player — only listed URLs; Telegram Mini App popup + playlist picker |
| `vita/memory/telegram-player-popup.json` | `URLDIR` | Learn: Telegram HTTPS popup player (web_app + url fallback) |
| `vita/strands/telegram-player-popup.json` | `URLDIR` | Sparse strand: Telegram Watch popup → compact player → system playlists |
| `vita/strands/kids-url-dir.json` | `URLDIR` | Sparse strand: KIDS url dir → player → dual HUMAN/MACHINE |
| `vita/free-music.js` | `FREEMUSIC` | Public-domain song catalog · grouped §VITAFILE§ VIN inject · original OGG playback · loc MATCH click-through |
| `vita/memory/free-music/Maple_Leaf_Rag.ogg` | `FREEMUSIC` | Scott Joplin Maple Leaf Rag (1899, PD) — full Ogg Vorbis, not a demo WAV |
| `vita/memory/free-music/Im_Always_Chasing_Rainbows.ogg` | `FREEMUSIC` | 1918 PD singing (Harry Fox) — Judy Garland free-catalog rainbow lane |
| `vita/memory/free-music-catalog.json` | `FREEMUSIC` | Multi-song source, license, sha256, grouped inject plans (maple + judy) |
| `vita/memory/free-music-learn.json` | `FREEMUSIC` | Append-only learn: grouped VIN → concat → original playback |
| `vita/memory/free-music-judy-learn.json` | `FREEMUSIC` | Judy lane learn + loc daisy-chain proof |
| `vita/strands/free-music.json` | `FREEMUSIC` | Sparse strand: free catalog → grouped inject → feed-player |
| `vita/strands/free-music-judy.json` | `FREEMUSIC` | Judy loc proof strand: filing → VIN → Basescan MATCH |
| `vita/telegram-clickthrough.js` | `VITACLICK` | Telegram inline keyboards — every category + subcategory clickable (dir→file→unlock, tokens→actions, track inject) |
| `vita/mirror-chain.js` | `MIRROR_CHAIN` | GitHub-as-blockchain file read + SNARK unwrap + Railway-style session keys + Telegram click-through |
| `vita/mirror-dual.js` | `MIRROR_DUAL` / `ZERO_PROOF` | Navigable GitHub duplicate tree + dual availability\|proven reader + open-source zero-proof key + SNARK boot from filing CAS follow-leader |
| `public/vita-mirror.html` | `MIRROR_DUAL` | Dual-path HTML navigator — tree + avail\|proven\|dual + boot |
| `vita/memory/mirror-dual-ledger.json` | `MIRROR_DUAL` | Append-only dual-path / zero-proof / boot events |
| `vita/memory/mirror-cas/` | `MIRROR_DUAL` | Content-addressed boot section bodies (filing leader until Base seal) |
| `vita/strands/mirror-dual.json` | `MIRROR_DUAL` | Sparse strand: dual paths → zero-proof → SNARK boot |
| `vita/chain-layer.js` | `CHAIN_LAYER` / `SYSTEMS_CHECK` / `LLM_ONCHAIN` | Always-on systems check · SNARK proven libs · EVM recover ms · model agreement · LLM spin manifests · Telegram `/vita check` |
| `vita/chain-inject.js` | `CHAIN_INJECT` | Spaced batch plan (720B) · bind sealed locs by contentCommit · pull/verify UTF-8 · IDM buttons only for matching body |
| `vita/memory/chain-layer-inject.json` | `CHAIN_INJECT` | Full spaced chunk plan + sealed/pending/verified status |
| `vita/memory/chain-layer-checks.json` | `CHAIN_LAYER` | Append-only systems-check ledger |
| `vita/memory/model-agreement.json` | `CHAIN_LAYER` | Last-agreed / multi-model ring |
| `vita/memory/llm-onchain-spin.json` | `LLM_ONCHAIN` | Open-source LLM spin manifest (commitment + Base locs) |
| `vita/memory/mirror-chain-github.json` | `MIRROR_CHAIN` | Research note: GitHub contents ≈ availability ledger; Base hitch = settlement |
| `vita/telegram-home.js` | `TELEGRAM_HOME` | Sectioned Telegram inline keyboards for every route + HOME; dual MAIN↔NEW engine mirror sims; search route sims; IDM static proof |
| `vita/telegram-help-routes.js` | `VITAHELP` / `SYSTEMS_CHECK_ROUTES` | `/help` click-through + `/pick` token boxes + merkle/domino route systems-check; force-stages §SYSCHECK§ seal |
| `vita/memory/telegram-home-learn.json` | `TELEGRAM_HOME` | Append-only learn: cheaper/faster engine + route sim seeds |
| `vita/memory/telegram-home-sim-ledger.json` | `TELEGRAM_HOME` | Append-only sim ledger (routes + search + snark root + IDM) |
| `vita/strands/telegram-home.json` | `TELEGRAM_HOME` | Sparse strand: HOME buttons → callbacks → dual-engine mirror |
| `vita/message-cascade.js` | `MESSAGE_CASCADE` | Eureka love → each token hop; instant wave HL from token data; ≥8/15m; $0.05 dust; rank revenue + waiting-up |
| `vita/dex-reader.js` | `DEX_READER` | Per-token DexScreener reader + Gecko dual check + Basescan/Dex/Gecko/CoinGecko refs; miss ≠ $0 |
| `vita/token-player.js` | `TOKEN_PLAYER` / `TOKEN_LEGIT` | Token pulldown player · $0.05 never-remove log seed · market-trigger SIM values · legit PASS/FLAG/FAIL |
| `vita/multichain-portfolio.js` | `MULTICHAIN` | 32-chain display; Base hitch vs Ethereum L1 other-path (~$3 / 27% — never mix into Base RISK) |
| `public/vita-token-player.html` | `TOKEN_PLAYER` | Telegram Mini App popup + HTTPS pulldown player |
| `vita/memory/token-legit-learn.json` | `TOKEN_LEGIT` | Append-only agent legit checks |
| `vita/memory/token-dex-reader.json` | `DEX_READER` | Append-only DEX dual-check learn |
| `vita/strands/token-dex-player.json` | `TOKEN_PLAYER` | Sparse strand: catalog → DEX dual → legit → player popup → 32-chain other-path |
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
| `CHAINDIR` | Line-for-line completion directory (`§VITACHAINDIR§`) — HUMAN+MACHINE loc proofs in Input Data; routing until both sealed |
| `URLDIR` | Curated URL playlist directory (`§VITAURLDIR§`) — closed-garden YouTube urls for `/vita/kids-player`; dual HUMAN list + MACHINE ids |
| `FREEMUSIC` | Free-catalog PD song (`§VITAMUSIC§`) — grouped §VITAFILE§ VIN slices; original audio/ogg playback; loc daisy-chain MATCH click-through (maple + judy) |
| `VITACLICK` | Telegram click-through (`§VITACLICK§`) — inline keyboards for dir/files/tokens/track; SNARK-first + dual-lane timing |
| `MIRROR_CHAIN` | GitHub-as-chain (`§VITAMIRROR§` / `§VITASNARK§`) — CODE=main / STATE=bot-state blob SHA + SNARK unwrap + Basescan IDM; session keys like Railway env |
| `MIRROR_DUAL` | Dual-path mirror (`§VITADUALPATH§` / `§VITABOOT§`) — same file name on GitHub + filing; availability\|proven reader; zero-proof name+contentCommit; SNARK boot from CAS follow-leader |
| `CHAIN_LAYER` | Blockchain systems layer (`§VITACHAIN§`) — always `/vita check`; SNARK proven libs; EVM recover timing; model ring |
| `SYSTEMS_CHECK` | Systems checklist proof (`§SYSCHECK§`) — each pass grows `vita/memory/` + `vita/strands/` |
| `LLM_ONCHAIN` | LLM-on-chain spin manifest (`§VITALLM§`) — content commitment + Base locs; change model at will |
| `CHAIN_INJECT` | Spaced inject plan (`§VITAINJECT§`) — N×720B chunks; sealed IDM only when UTF-8 matches; formula anchors ≠ body |
| `TELEGRAM_HOME` | Sectioned Telegram HOME (`§VITAHOME§`) — inline buttons for every route; MAIN↔NEW engine mirror; search sims; IDM static proof |
| `VITAHELP` | Help click-through (`§VITAHELP§`) — `/help` sections + `/pick` token boxes |
| `SYSTEMS_CHECK_ROUTES` | Route domino check (`§SYSCHECK§` routes) — folder merkle + avenue PASS/FLAG + forced seal stage; logs `systems-check-routes-*.json` |
| `MESSAGE_CASCADE` | Eureka love message cascade into each token (`§MSGCASC§`) — instant wave HL; cadence ≥8/15m |
| `TOKEN_PLAYER` | Token pulldown player (`§VITATOKPLAY§`) — DEX reader + trigger SIM + $0.05 seed; Telegram popup |
| `TOKEN_LEGIT` | Legitimacy dual-check (`§VITALEGIT§`) — not meme-only; DexScreener ↔ Gecko + 3rd-party refs |
| `DEX_READER` | Own DEX reader (`§VITADEX§`) — verified Uni/Aero WETH\|USDC; miss ≠ invented $0 |
| `MULTICHAIN` | 32-chain portfolio (`§VITACHAINS§`) — Base hitch vs ETH L1 other-path; empty seats ready |
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
4. **Reads** → prefer `GET /vita/read`, `/vita/mirror`, `/vita/mirror.html`, `/vita/inject`, `/vita/locations`, `/vita/leftover`,
   and Basescan UTF-8 over invented summaries. `/vita read FILE` is local disk first (no Anthropic).
   Dual: `/vita dual FILE` · `/vita path proven FILE` · `/vita tree` · `/vita boot` · `/vita zero FILE`.
5. **Writes on-chain** → leftover KEY+LOC when covered; `/prove` for Eureka;
   never invent a hash.
6. **Env** → `VITA_MESSAGE_FIRST` default `yes` (1× cover → hitch). Set `no`
   only to restore micro-extract SKIP_HITCH + bank below the 2× cushion.

## Continue-until-merge

This `vita/` tree is the **avenue base** while other branches experiment.
Merge back into root modules without deleting HTML infect or anchors.
