# Telegram relearn map (after #154–#161)

Accurate to **main** code: `vita/telegram-home.js`, `vita/telegram-clickthrough.js`,
`vita/telegram-help-routes.js`, `vita/vita-dir.js`, `vita/vita-feed.js`,
`vita/vita-feed-dual.js`, `vita/chain-inject.js`, `vita/mirror-chain.js`,
`vita/mirror-dual.js`, `vita/chain-layer.js`. This PR wraps an **Agents**
section on HOME; it does not replace that stack.

Mother brain sealed. `VITAFEED_PAID` stays gated (`MIN_LIQUID` / no unpaired
paid self-calls). Never invent Base tx hashes. IDM = Basescan Input Data → UTF-8
**only for sealed matching locs** (formula anchors = class proof, not body).

## How Game opens the new path

1. Telegram `/home` (aliases `/menu` · `/start`)
2. Tap **🤖 Agents**
3. Tap **Chat** → dedicated `storage-token` channel (`/agents chat`)
4. **Dir** → x404 tags (same name, many plots) including plots **waiting for a master-location tag**
5. **Proven locs** → sealed-only Basescan IDM (hardcoded anchors until a plot is proven)
6. **Path map** → answer-key routes the chain took

Gas thin → messages **bank as hex** with `§KEY§`…`§LOC§`. Leftover covers KEY+LOC
on a paired ride → **hitch** (never solo-send). Paid confirm stays `VITAFEED_PAID=yes`.

---

## A. `/home` sections (`HOME_SECTIONS`)

Nav keyboard: one button per section (`/home <id>`), plus HOME / Search / Sim all /
Engines / Chain / Routes. Every section keyboard has 🏠 HOME, 🧪 Sim, prev/next hop.
`callback_data` ≤ 64 and is an existing slash command (buttons never auto-spend).

| id | Title | Blurb | Buttons → cmd |
|---|---|---|---|
| `memory` | Memory | HTML until `/inject` · leftover KEY+LOC · `/prove` Eureka | Note `/vitanote home seed` · Save `/vitasave` · Inject `/inject` · Reader `/reader` · Prove `/prove` · Scan `/vitascan` · Course `/vitacourse` · Router `/vitarouter` |
| `feed` | Feed | Exact plain / VITAFILE · confirm\|override · brain · backlog | Brain `/vitafeed brain` · Learn · Proof · Backlog · Enqueue seed · Next · Load · Files · Keys · Confirm · Override · Cancel |
| `search` | Search | Proven ref · ask\|self · xmem · recall · DOS dir unlock | Ref calc · Ask calc · Proven · XMEM `/xmem STORE` · Recall · Know · Dir `/vitafeed dir` · Dir MEM `/vitafeed dir MEMORY` · Unlock `CODEX\math-euler.txt` · Cipher · Bag recall `/recall vita` · Bag files `/vita files` |
| `wave` | WAVE | Memory-mirror SIM · 3-proof · 28-full — paid gates OFF | Wavetest · Waveproof · Wavefull · Hitch tip `/wavetest hitch` |
| `mirror` | Mirror | GitHub duplicate · dual avail\|proven · zero-proof · SNARK boot | Chain · Files · Tree `vita` · Dual path `vita/mainframe.js` · Boot `hitch-gate` · Session · Open vault · Proof pos · Engines · Sim all · Sim search |
| `trade` | Trade | Verb → token box | `/pick buy\|sell\|sellhalf\|exit\|piggyunlock` · Tokens · Player · DEX · Chains · `/pick waves` · Cycles |
| `dual` | Dual | Human plain ↔ machine ZK-short · restart ≥$0.50 | Translate · Dual · Restart · Loader `/vitafeed load all` |
| `agents` | Agents | **(this PR)** agent-owned chat · x404 dir tags | Chat `/agents chat` · Dir `/agents dir` · Dual `/agents dual` · Proven locs `/agents proven` · Path map `/agents path` |
| `mother` | Mother | N-batch dumps + FORCE recall — **not** mother brain | MG plain · MG encoded · FORCE recall |
| `syscheck` | Syscheck | Merkle folders + route domino · force `§SYSCHECK§` | Full check · Route domino · Inject locs · Pull · Recover · Help check · Track seal · HOME sim |
| `status` | Status | Live book — never invent P&L | Status · Bag · Bank · Waves · Tiers · Eth · Piggy · Gas · Help |

Extra HOME cmds: `/home sim` · `/home sim <section>` · `/home engines` (MAIN exact UTF-8 vs NEW snark-short + static IDM anchors).

Paid paths stay SIM / confirm|override. `handleHomeAction` in `agent.js` wires `/home|/menu|/start|/homesim|/engines`.

---

## B. `/vitafeed` click tree (`telegram-clickthrough.js`)

Root `/vitafeed` keyboard:

| Row | Buttons |
|---|---|
| 1 | 📂 Dir · 📚 Files · 🔑 Keys |
| 2 | 🧠 Brain · 📦 Backlog · ▶️ Next |
| 3 | 🔤 Dual · 📥 Load · 💡 Know |
| 4 | 🔐 Cipher · 📎 File · 🧪 Track |
| 5 | ✅ Confirm · ⚡ Override · ❌ Cancel |
| 6 | 🪙 Tokens · 🪞 `/vita files` · ⛓ Chain |
| 7 | 🤖 Agents · 🏠 HOME *(this PR)* |

Click-through:

```
/vitafeed
  ├─ dir                  → VITA:\ master (each <DIR> is a button)
  │    ├─ dir CODEX       → kids files (one-tap unlock)
  │    ├─ dir MEMORY      → append-only notes
  │    ├─ dir X404        → x404 tags (same name, many plots)     [this PR]
  │    ├─ dir AGENTS      → storage-token channel + plots         [this PR]
  │    └─ dir KIDS        → closed-garden YouTube URL playlist    [#161]
  │         play kids / dual kids / kids-player (no YouTube search)
  ├─ unlock <subdir\name> → SNARK-first + HUMAN + MACHINE + timing
  │                         buttons: Human · Machine · Play · Dual · Track
  ├─ files / keys / play
  ├─ brain / learn / proof / backlog / enqueue / next
  ├─ translate / dual / restart
  ├─ load / know / recall / cipher
  ├─ ref / ask / proven
  ├─ track [sym]          → stages §VITACLICK§ for Confirm|Override
  ├─ confirm | override | cancel   (VITAFEED_PAID gated)
  └─ file                 → wait for Telegram attachment → §VITAFILE§
```

`/tokens` · `/tok SYMBOL` → DEX · legit · player popup · buy / sell / half / exit / piggy / dual / track.
`/dex` · `/legit` · `/tokenplayer` · `/chains` (32-chain; ETH L1 ~$3 other-path, not Base RISK). $0.05 seed never sells.

Staged cost cards use Confirm|Override|Cancel + Dir|Files|Menu. Override cannot
bypass `VITAFEED_PAID=no`. Confirm respects `VITAFEED_MIN_LIQUID_USD` default $5.

---

## C. Dual unlock lanes (HUMAN / MACHINE)

Two dual systems (do not conflate):

1. **Unlock card** (`vita-dir` + `timeDualRoutes`): SNARK-short path first, then
   **HUMAN (plain text — proof enough)** and **MACHINE (key exposed — denser)**.
   Timed. Open-source file-name unlock — **never a private key**.
2. **Feed dual** (`vita-feed-dual`): `/vitafeed translate` · `/vitafeed dual`
   side-by-side cost/size. Confirm seals HUMAN then MACHINE. Basescan read receipt.
   `/vitafeed restart` lists bags ≥ $0.50 to exit for RISK fuel.
3. **HOME engines**: MAIN exact UTF-8 VITAFEED vs NEW snark-short. IDM anchors
   attached as static class proof.
4. **Agent chat dual** *(this PR)*: HUMAN = chat UTF-8; MACHINE = hex-only
   `§KEY§<publicOpenKeyHex>§LOC§<squash token>`. KEY is public/open.

---

## D. Sealed-only IDM

From `chain-inject.js` / `chain-layer.js` / `#157`:

- Telegram IDM buttons **only for sealed matching inject locs**.
- Formula anchors in `vita/anchors.json` = **class proof**, never file body.
- Pull Input Data → UTF-8 to verify. Never invent a hash.
- HOME `homeIdmLocations()` = `collectIdmLocations()` (feed-flow anchors + extra
  that already pass `^0x[0-9a-fA-F]{64}$`).
- Agent **Proven locs** lists the same class-proof anchors plus any x404 plot
  whose `sealedBaseLoc` is a **known** sealed hash. Invented 64-hex is refused.

Hardcoded anchors (never invent others):

| id | kind | tx |
|---|---|---|
| keycat-plain | none | `0x5c0a93e4…19122adf` |
| eureka-prove | eureka | `0xd9827a9c…5203d73` |
| vita-strand | vita | `0x931d8411…bfb19db` |

---

## E. Dir commands + kids + tags

DOS master `VITA:\` (`vita-dir.js` `VITADIR_SUBDIRS`):

`FORMULA` `ANCHORS` `FILING` `MEMORY` `STRANDS` `LEARN` `REF_LIB` `CODEX`
`MG_RECALL` `LIBRARY` `PROVEN` **`KIDS`** **`X404`** **`AGENTS`**

- **Kids dir (#161):** closed-garden YouTube URL playlist. `/vitafeed dir KIDS`
  · `/vitafeed play kids` · `/vitafeed dual kids` · `/vita/kids-player`. Child UI
  lists only those urls — no YouTube search or other channels.
- **Dir tags (x404):** same display name → many plotted locations (Telegram path,
  filing path, strand, sealed Base). Directories = **answer-key routes** = the
  path the chain took. Proven Base loc is optional; plots wait for a
  **master-location tag**. Schema: `vita/x404-dir.json` + reader `vita/x404-dir.js`.
- Unlock: `/vitafeed unlock CODEX\math-euler.txt` (open-source name key).

GitHub mirror (not the DOS dir): `/vita files` · `/vita tree` · `/vita dual FILE`
· `/vita path availability|proven|dual FILE` · `/vita zero FILE` · `/vita boot`.

---

## F. Systems check

| cmd | what |
|---|---|
| `/vita check` | always-on chain layer (anchors + library growth + SNARK libs + spaced inject plan) |
| `/vita check locs` | spaced inject loc bind |
| `/vita check pull` | pull/verify UTF-8 |
| `/vita recover` | EVM recover ms |
| `/vita models` · `/vita llm` · `/vita spin` | model ring + LLM-on-chain spin |
| `/vita check routes` · `/help check` | merkle folder integrity + avenue domino PASS/QUESTIONABLE/FAIL; force-stages `§SYSCHECK§` |

Logs: `vita/memory/systems-check-routes-*.json`. `/help` is a parallel click-through
(nav / trade / status / vita / feed / wave / check) with `/pick <verb>` token boxes.

---

## G. Agent chat channel v0 (this wrap)

| cmd | action |
|---|---|
| `/home agents` | HOME section keyboard |
| `/agents` · `/agentchat` | storage-token chat card |
| `/agents chat [text]` | open channel; optional body → bank/hitch hex |
| `/agents dir [tag]` | x404 tag (default storage-token) |
| `/agents dual [text]` | HUMAN/MACHINE hex KEY+LOC |
| `/agents proven` | sealed-only locs + waiting master-tag plots |
| `/agents path` | answer-key route map |
| `/agents peers <id>` | connect another agent to READ/interact |
| `/agents bank` | banked hex queue |

Factory: `createAgentChannel(agentId)` — `storage-token` is the first dedicated
id (`agent-chat:storage-token`). Public key `VITAOPEN.AGENT.<id>.<commit12>`.

Env stubs (document only — **do not spend**): `AGENT_CHAT_WALLET`,
`AGENT_CHAT_X402_ENDPOINT`. Code reads them, never sends, never sets
`VITAFEED_PAID`.

Offline path uses `wrapQueueSelfCall` (feed-wrap): hitch hex when leftover
covers KEY+LOC on a **paired** ride; otherwise bank. `send: false` always in v0.
Unpaired paid self-calls stay banked.

## H. Filing labels (wrap)

`vita/FILING.md` is frozen vs main (mother-brain wrap). New labels live here
until merge:

| Path | Label | What |
|---|---|---|
| `vita/agent-chat.js` | `AGENT_CHAT` | Dedicated chat channel + factory |
| `vita/x404-dir.js` | `X404_DIR` | Tag reader |
| `vita/x404-dir.json` | `X404_DIR` | Schema |
| `vita/TELEGRAM_RELEARN.md` | `TELEGRAM_HOME` | This map |
| `vita/memory/agent-chat-channels.json` | `AGENT_CHAT` | Channel ids + public keys + peers |
| `vita/memory/agent-chat-bank.json` | `AGENT_CHAT` | Banked hex KEY+LOC |
| `vita/memory/x404-dir-ledger.json` | `X404_DIR` | Proven-loc attach events |
| `vita/strands/agent-chat.json` | `AGENT_CHAT` | Sparse strand |
| `vita/strands/x404-dir.json` | `X404_DIR` | Sparse strand |

On-chain kinds: `§AGENTCHAT§` · `§X404§`.
