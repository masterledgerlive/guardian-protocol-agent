# Changelog

## Unreleased

### Fixed — GAME SwapRouter02 exactInputSingle reverts (empty Uni V3 fee 3000)

RISK bag buys of GAME (`0x50e1…7915`, blocks 51106117–51106192) reverted after a
hitch streak. Fail class was **Quoter vs pool mismatch**, not PRICE_INSANE:

- DexScreener mark came from Aerodrome GAME/WETH (`0x2A36…DFD2`).
- Catalog `feeTier: 3000` pointed at Uni V3 pool `0x70fb…45b5` with **liquidity=0**.
- QuoterV2 `quoteExactInputSingle` reverted on every RPC (a pool miss, not an outage).
- `executeBuy` still sent SwapRouter02 with Aerodrome-spot minOut + UTF-8 `§$STORE§`.
- Txs reverted (~788k of 800k gas): `0x2644773a…`, `0x2589e0a3…`, `0x280e898e…`.
- Slippage cooldown armed after the **third mined revert** — too late; buy path also logged `SELL SKIPPED`.

Live Uni V3 GAME/WETH book is **fee 10000** (`0xE5Ff…77a3`). Harden:

- Require a live QuoterV2 fill before send (no spot-only minOut).
- Probe other V3 fees when catalog fee misses; remember the fee that quoted.
- Quote contract revert does not drain the RPC pool.
- Quote miss / PRICE_INSANE quote / minOut reject increment the fail streak; cooldown after N (still 3) without sending.
- Hitch leftover too thin → plain sale (no hitch); orch cannot re-hitch after skip.
- GAME catalog fee 10000 / 1% **and catalog-frozen** (new buys). Exits remain. LOSE-ZERO unchanged. Uni V4 leftover hitch stays VITA KEY+LOC. No invented P&L.

### Added — VITA secondary router: leftover hitch switches to §TOKEN§ parse + loc squash

Activate VITA as the hitch payload (not the Eureka love-note prose). Uniswap stays the
primary swap router; this is the **secondary** trailer switch (`VITA_HITCH_MODE`,
default **vita**). Love note is encoded in `§KEY§` so it is not lost. `/prove` still
writes the full Eureka letter as genesis identity.

Locations (tx hashes / node ids) stay append-only; hitch only carries a squashed
`§LOC§` token (count + 4-hex root/tip + last-6 shorts). Leftover hitch is a **dense
KEY+LOC projection** — clipping the trailer never overwrites recursive `lastPacket`.
Hourly `evaluateVitaCourse` scores inject-without-loss vs leftover-skips (skips are
lose-zero, not memory loss).

Public **HTML console** `GET /vita` is the Telegram twin: notes stay on the page until
inject, then the reader pulls sealed Base locations and reconstructs §TOKEN§. Plaintext
now (true open source). `/zk` previews the future locations-only / zero-knowledge path.

Recursive memory now **survives restart**: `vita-router-state.json` stores the last
§TOKEN§ packet + location depository + course stats. Boot `ensureGenesisMemory`.
`GET /vita/inject` and `/vita/context` paste parsed VITA memory (KEY first).
The live loop `tickHourlyCourse` every hour restores KEY if lost and can switch mode.
Sealed locations store **full hitch utf8** (not an 80-char preview). Recall
`reconstructVitaMemoryFromLocations` rebuilds §TOKEN§ from those payloads so KEY
cannot be lost. `ingestSealedUtf8` folds chain trailers (vita or Eureka prove) into
the recursive packet. V4 leftover hitch uses the same secondary router.

- `vita-parse.js` — §TOKEN§ parse / refine / 2000-char clip (KEY+LOC first)
- `vita-locations.js` — append-only depository + squash
- `vita-router.js` — eureka | vita | hat | auto pipeline switch
- `vita-course.js` — hourly scorecard
- Telegram `/vitarouter` `/vitamode` `/vitacourse`
- HTTP `GET /vita/router` `/vita/locations` `/vita/course` (auth) + public inject `vitaRouter`

### Added — VITA picture tailwind (sparse out = sparse in)

When VITA triggers (`/vitasave`, `/vitadata`, `/remember`, `/vitapicture arm`),
a smile-picture cycle is armed. Wave-up leftover hitch ("tailwind") packs as
much encoded `§HAT§` data as fits — same sparse ride-the-trade pattern as VITA
memory inbound. Each successful receipt seals a spaced location; when the
picture completes, the next cycle auto-arms (continuous on-chain proof).

- `vita-tailwind-picture.js` — arm / plan / confirm / next-cycle
- `planVoiceHitch` prefers picture when armed **and leftover already has a VITA hitch**; leftover hitch stays KEY+LOC while leftover is still Eureka. `/vitamode eureka` does not steal leftover hitch — leftover always plans KEY+LOC (`mode: "vita"`). Hitch attempts are counted once after append. Public leftover scan coalesces in-flight Blockscout walks and **never awaits** a cold scan on the injector (`wait: false`).
- Exit receipt includes spaced location count for the picture

### Added — Exit inject receipt + spaced-chain image proof

When an exit can inject, the sell Telegram receipt now includes a **HAT EXIT
INJECT RECEIPT**: confirm only after chain receipt success, and prove how many
**spaced blockchain locations** (distinct txs / blocks) assemble the picture.

- `hat-exit-receipt.js` — confirm gate, spaced proof, Telegram formatter
- Smile demo seals +3 blocks apart × 8 locations → full 8×8 image
- `formatSellReceiptHtml(..., hatInjectReceipt)` wired from `executeSell`

### Added — HAT smile demo: 8×8×8-bit picture → locations → reader

Quick proof before huge HTML: encode a slow-rez smile, seal chunk locations,
reader pulls every location + decode recipe and rebuilds the face (ASCII + HTML).

- `npm run hat:smile` → `artifacts/hat-smile-proof.html` + `public/hat-smile-proof.html`

### Added — HAT × wave: cost-paid bits, confirm seal, exit up without crash

One bit was only the genesis proof. Wave leftover + earnings now size the next
HAT chunk (transmission error cushion so we actually send). Sell floor hard-codes
`mult × hitch_cost(bytes) + error_buffer`. Cursor resumes at last **confirmed**
bit; unsealed drafts do not advance. After on-chain confirm + location seal,
`evaluateConfirmedSendExit` may sell on the way up — no peak crash required —
still never when leftover/fees are red.

- **`hat-wave-inject.js`** — size / sell-target / cursor / confirm / exit-up
- Still never hitch when leftover ≤ 0; never claim sent without `txHash` seal

### Added — VITA HAT: 1-bit encoded site preservation (Railway-style insert)

Start of append-only vita memory for the live site (`public/*.html`: arena,
engine, board, v4), mirroring vault key injection:

- **Railway insert** — `HAT_ROOT_TX` / `HAT_STRAND_ID` / `HAT_CONTENT_HASH` /
  `HAT_K_MASTER` (locations only; plaintext HTML never stored in Railway)
- **Genesis = one bit** — first always-written node; never deleted
- **ST + LT beside message** — short-term cliff + long-term message-count plan
- **Encoded** — `hat-bitpack-v1` hex bits in `§HAT§` packets (not plain HTML)
- **Reader** — `reader.locations[]` lists every node + how to fetch/decode
- CLI: `npm run hat:plan` / `npm run hat:bit` · capacity: `vita_hat` in
  `npm run sim:capacity`

### Fixed — cascade into lowest primed bottoms; ETH only for fees/gas

Peak exits were settling full proceeds as WETH and often **holding** until a
token sat within ~1% of MIN trough. Capital bounced sell→ETH→wait instead of
rolling into the next best bottom that avenue math already projected would go up.

- **`rankCascadeBottoms` / `scoreCascadeBottom`** (`avenue-prime.js`) — pick the
  lowest % above trough among primed/armed seats with projected net upside;
  wider band for high-% / READY opportunities so cascade does not idle.
- **`triggerCascade` / `findCascadeTarget`** — always redeploy into ranked
  bottoms (primed first, cold scan fallback); Telegram notes gas floor kept for
  fees/costs only.
- **`cascadeDeployEth` + `getCascadePct`** — fee-fuel mode: deploy ~90–100% of
  safe proceeds (gas floor still never crossed); less idle ETH after a paid exit.
- **`planSuccessionInjections` / `canSecondInject`** — second hop allowed for
  primed **near-bottom** seats (not only strict READY); succession sorts by
  lowest trough distance.
- Ripple targets use the same bottom-band math.

Still never sells/inserts when leftover ≤ 0; stop-loss and `/exit` still do not
cascade.

### Added — Control Board hub (`/board`) so humans and bots stop hunting files

Arena (`/arena`, PR #42), Engine (`/engine`, PR #47), V4 offshoot (PR #46), Storage Token loop (PR #50), and fee/gas plug (PR #51) left HTML + docs on three URLs plus `guardian-protocol/` and `guardian-v4/README.md`.

- **`GET /board`** (`public/board.html`) — one hub for **live V3 inject hooks**: every tradeable hitch surface, leftover/hitch capacity, piggy leave-behind, earn-under-LOSE-ZERO sim, gated operator queue (`buy` / `sellhalf` / `piggyunlock` / `prove`). **Bot usage piggy** models Game’s Grok cost ($20/mo now; $60 Pro only after proven hitch revenue hashes) as a transmission cost hitch leftover-earnings must cover — DEMO/example unless hashes exist; never invented P&L. V4 is **deferred** (link to `/v4` only). `/arena` and `/engine` unchanged (`/` still Arena).
- **`GET /board/health`** (alias `/health`) — which boards are mounted. V4 listed as a **separate process** (`loadsV4Runtime: false`).
- Public **`/board/api/params`**, **`/board/api/snapshot`**, **`/board/api/inject`**, **`/board/api/v4`**, **`POST /board/api/sim`** — sim is V3 practice only; inject API lists catalog hitch seats + leftover capacity + bot piggy. No unauthenticated env mutate, no spend.
- Hub modules **do not import** `guardian-v4/` (swap encoder / agent / config stay in the offshoot process).
- Bugbot follow-up: 16 KiB cap on public `POST /board/api/sim` bodies; LINK piggy knobs use catalog 8% / $0.25; earn sim spends buy gas and hitch instead of recycling them as leftover cash; storage loop uses the same cash as the arena round; wave tiles keep engine `series`. Catalog LINK dust floor ($0.25) applies when sim omits `dustFloorUsd`. Authorized leftover/hitch panel uses holding-wave leftover (not the 2% demo assumption).
- **`BOARD.md`** — operator on-ramp; V3 inject surfaces + bot-usage piggy; points stale “2% piggy” / L1-vs-live Arena / V4-CLI-only confusion at the hub.

### Fixed — plug fee/gas leaks so thin books never bleed ($10→$6)

Live RISK book was listing “wins” while liquid fell. Leaks:

1. **Round-trip impact charged once** in COST_EDGE / avenue / min-entry while
   `calcNetMargin` used ×2 — entries understated break-even.
2. **Buy gas (+ hitch) omitted from cost basis** — break-even sells still left
   the wallet down by gas.
3. **Unknown-cost recycle** treated `entryEth=0` leftover as green and listed
   full proceeds as net profit → fake skim + cascade.
4. **L1 oracle soft-fail → L1=0** — Eureka could hitch undercovered; now plain
   sale (buy + sell) when oracle fallback is marked.
5. **Skim after thin edge** — listed net ignored skim; skim now skipped if it
   would wipe the edge, and listed PnL is post-skim.

- Shared `DEFAULT_IMPACT_PCT` (0.3%) on both legs for RT math
- `investedEthWithCosts` / `netUsdAfterSkim` / unknown gas-edge floor
- Still never sell/insert when leftover ≤ 0

### Added — Storage Token system loop + crypto-event hard-push (Sprint 6)

End-to-end simulation of the storage-token vision: sparse inject across all
swarm nodes, pay hosts in BITS, piggy compound → call-to-add → capacity, and
hard-push against known crypto freeze events — without rewriting the live
trading injector.

- **`guardian-protocol/`** — Storage Token ledger, sparse placement, piggy
  compound, injection capacity, crypto-event catalog, `npm run arena:crypto-stress`
- **Root** — `storage-inject-capacity.js` / `npm run sim:capacity` uses live
  lose-zero hitch math for “what can we inject with funds we have now”
- Doc: `guardian-protocol/docs/SYSTEM_LOOP.md`

### Fixed — piggy banks projected earnings (AERO $0.27 vs $0.15) + trade receipts

Live book left only the **$0.15** USD floor in the AERO piggy after a profitable
exit while counting said **~$0.27** should remain. Bear-minimum projected
earnings were never sized into the never-sell dust — Telegram also lacked a
bought→sold receipt that showed the banked amount vs on-chain dust.

- **Earnings banking** — profitable exits bank the bear-min (`earningsToBankUsd`
  = buffer need or buy-plan projection) into `savedEarningsUsd`. Reserve tokens
  are sized so dust USD covers that cumulative count (not floor alone). Extra
  profit above the bear min stays liquid for redeploy / higher waves.
- **Buy plan** — `projectBuyEarningsPlan` computes sell-at ≥ fees + 2× message
  cushion + earnings buffer; Telegram buy receipt shows entry, min earn, sell-at,
  and piggy-after-bank.
- **Sell receipt** — bought at → sold at → earnings → banked + counted saved
  vs dust USD (must match). `/piggy` shows saved vs dust per token.
- Still never sells/inserts when leftover ≤ 0; hitch still needs the earnings
  buffer; unlock remains the only way to spend dust.

### Fixed — more piggy dust + earnings-with-message never-lose math

Live Railway (`Tradeable:0.000342` / `Piggy:0.000134` / trades stuck at 73):
cycle logs were **listing** micro unknown-cost crumbs ($0.01–$0.02) as money while
the $0.05 USD piggy floor **100%-locked** them (`sellable = 0`) — capital frozen,
no earnings, hitch messages rarely clearing a real gain. Historical moonshot/stale
paths also listed P&L without subtracting hitch cost, so Telegram could show
WAVE COMPLETE while the letter wiped the edge.

- **Defaults** — `PIGGY_BANK_PCT` **5%** (was 2%), `PIGGY_BANK_MIN_USD` **$0.15**
  (was $0.05); LINK favorite **8% / $0.25**. Succession `PIGGY_MATH_BUFFER_PCT` **8%**.
- **Crumb floor** — USD min only applies when bag USD ≥ floor; sub-floor crumbs
  use pct only so recycle can free inject fuel instead of listing locked dust.
- **Earnings buffer** — `PIGGY_EARNINGS_BUFFER_PCT` (5%) must clear before Eureka
  hitch rides; otherwise **plain sale** (still take the wave, never lose to the
  message). `previewPiggySellNetUsd` / Telegram / ledger expose `earningsUsd`
  after hitch so we never list wiped gains as wins.

Does **not** weaken LOSE_ZERO hold-when-leftover≤0, PRICE_INSANE, QuoterV2,
minOut, frozen buy, or 2× hitch sell cushion.

### Added — Guardian Engine board (wave dance / surfer / hitch lights)

Easy operator + agentic UI so humans and AI bots see the same open equations:

- **`/engine`** (`public/engine.html` via `vita-webhook.js`) — waveforms for inject tokens, paddle→ride→peak→trick→reload dance, fine-tune entry/exit, ride / rider / message / both-ends / trick-out buttons with **press-time costs**, piggy payment lights (fees → message paid → 2× cushion → first inject → skim → agent).
- **`engine-board.js`** — shared phase / options / piggy-light math (peak-ride + hitch cover + first-inject paid).
- Live queue aliases: `ride`, `rider`, `both`, `trickout`, `message`/`prove`, `sendsurfer`, `surferout` → existing buy / exitonly / prove / surfer paths.
- Demo mode without secret; Arena links to Engine.

### Fixed — peak-ride protocol: sell the MADE top, not hist-max touch / mid-range pred

Ledger (bot-state, 419 sells / +$324): peak exits earn, but three holes left upside
on the table and sold "lower than highest potential":

1. **`atMaxPeak` alone** sold the moment price touched historical MAX — breakouts
   that were about to print a new high got clipped at the old peak.
2. **`predSell` alone** ejected mid-range (AIXBT PREDICTED PEAK near flat, then
   ~+100% printed afterward).
3. **STALE CASCADE mid-climb** sold sideways bags that were not at the top zone.

Perfect injection protocol (`peak-ride.js`):

- **Ride high-water** ratchets while holding; hist max touch is not a sell.
- **Sell when peak is MADE**: stagnant near ride high + signs to lower
  (tick-down / MACD / RSI roll).
- **Fast crash** off a risen peak sells without waiting for a full indicator stack
  (only when the high already rose above entry).
- **Safety-net ladder** (−3% / −5% / −8% from ride high) for drastic drops so an
  ultimate-high ride survives shallow dips but still dumps on cliffs.
- **Predicted peak** only inside the peak zone; **stale cascade** only near the
  ride high (mid-climb flat holds for the turn).
- Still never sells when piggy-aligned net ≤ break-even (lose-zero).

Bottom inject / second succession (`second-inject.js`) unchanged — exit → paid
first inject → primed READY second seat.

### Fixed — STOP LOSS no longer sells underwater (ledger loss hole)

Live Railway armed STOP LOSS on unknown-cost / frozen dust (STONKEX, BLUECHIP)
and the sell gate **bypassed** lose-zero for any `STOP LOSS` reason — historical
ledger's largest loss bucket (−$24.75) plus stop→cascade redeploys. Peak/plain
exits are the earning path (~70% WR / +$324 on bot-state).

- **`evaluateSellGate`** — STOP LOSS follows leftover math: hold when ≤ 0;
  plain/hitch sale when green. Only operator lossy + FORCE EXIT LOCKED bypass.
- **`shouldArmStopLoss`** — requires trusted cost basis; skips unknownEntry /
  frozen catalog so display marks cannot fake a floor.
- **`processToken`** — no cascade after stop-loss; Telegram only on a real fill
  (no more "Emergency exit..." spam with piggy-dust no-ops).

### Added — second inject after paid peak exit; ride-wave instant peak; primed bottoms

Not enough fills: bottoms missed, cascade stopped at one hop, peaks waited on
full RSI/MACD stacks. Goal: hit troughs → inject (hitch when leftover covers) →
ride → sell at peak with piggy-aligned profit → if that exit paid the first
inject portion **and** surplus clears another primed READY seat, fire a
**second injection** same succession. Never sell/insert when leftover ≤ 0.

- **`second-inject.js`** — `planSuccessionInjections` / `canSecondInject`: first
  min-entry × piggy buffer paid + next READY + gas floor → seat 2. Hitch
  preferred on both buy and sell when leftover covers (existing LOSE_ZERO).
- **`triggerCascade`** — deploys up to 2 primed READY seats from one profitable
  exit (`🔁 2ND INJECT` Telegram).
- **Instant peak sell** — at max peak, or tick-down within 1% of peak, when
  piggy-aligned net clears break-even buffer (still never underwater).
- **Primed bottom entry** — any cost-cleared READY avenue can inject near its
  recent low (not only catalog inject-mains), so more bottoms convert each cycle.

Does **not** weaken LOSE_ZERO, PRICE_INSANE, QuoterV2, minOut, frozen buy,
2× hitch sell floor, or piggy never-sell dust.

### Added — Guardian Arena ledger board + LINK-first inject piggy

Game asked for a readable ledger board, practice sims, and stronger Chainlink
leave-behind — plus more top-crypto hitch surfaces like LINK.

- **`/arena` HTML** (`public/arena.html` via `vita-webhook.js`) — public
  learning board: how liquid vs bags vs piggy work, live snapshot + queue
  buttons (auth), practice Arena sim (no live money), Basescan deep links.
- **LINK favorite** — Tier-1 reserve prefers LINK; +8 score nudge; catalog
  `piggyBankPct: 0.08` / `$0.10` floor so more dust stays behind and trades
  around the pile. Env overrides: `PIGGY_BANK_PCT_LINK`, `PIGGY_BANK_MIN_USD_LINK`.
- **Inject mains** — `LINK, UNI, VVV, ZORA, BNKR, AERO, MORPHO` (VVV/ZORA/BNKR
  promoted as deep Uni V3 hitch books already on the catalog).
- Per-token piggy helpers in `piggy-bank.js` (`piggyOptsFromToken`).

### Fixed — piggy ledger math so dust stays behind and succession can fire


Piggy already sized sells as `balance − reserve`, but peak gates and post-fill
ledger PnL still charged **100% of entry** against the piggy-capped slice.
That understated profit, starved the 1% skim / agent pools, and blocked
automatic sales even when math + profits were met. `/piggy` co-invest mark
also used `tokens*0` (always a fake loss).

- **Ledger / skim / succession** — `executeSell` uses `soldFrac` /
  `costBasisForSoldFraction` for invested USD, net PnL, wave stats, and
  ledger rows (`soldFrac`, `piggyDustLeft`).
- **Peak / fib / early-sell gates** — `previewPiggySellNetUsd` so fees, skim,
  and cost basis match the sellable bag; ride until peak turn still leaves
  dust untouched.
- **Piggy-only dust** — no longer wipe `piggyReserve` when the bag is below
  dust USD; keep the high-water mark on-chain until `/piggyunlock`.
- **Nested per-token piggy ledger** — `tokenPiggyLedgers` tracks dust + ETH
  contrib + agent share per inject seat (persisted). AI spend later draws
  from agent share once revenue proves out.
- **ETH piggy co-invest** — off by default (`PIGGY_COINVEST=yes` to enable)
  so the skim pool stays locked for AI piggy banks.
- **Inject fuel** — uses `piggyBankMinUsd()` instead of a hardcoded $0.05.
- `/piggy` shows real co-invest marks and nested dust/eth/ai lines.

Does **not** weaken LOSE_ZERO, PRICE_INSANE, QuoterV2, minOut, frozen buy,
or the never-sell dust ratchet.

### Fixed — inject capital velocity snowball (live $0.71 / $7 bags)

Live Railway 2026-09-08: **Tradeable $0.71**, **~$7 in bags** (LINK ~$4.35 @ −1%,
MORPHO ~$1.98 flat), `PRIMED: none` every cycle, T1 `INJECT-ALL: UNI` with a
sub-min seat. Moonshot logged allow on MORPHO then `executeSell` held —
`sellPct` entry slice vs piggy `tokensToSell` mismatch flipped leftover ≤ 0.
Historical ledger (Mar): 70% WR / +$324 — strategy works when capital moves;
now it was frozen.

Snowball path (still never sell/hitch when leftover after fees ≤ 0):

- **Piggy-aligned sell gate** — `sellFractionAfterPiggy` so entry cost matches
  tokens actually sold in moonshot + `executeSell`.
- **Known-bag inject fuel** — when liquid-starved inject-all, recycle LINK/MORPHO-
  sized known bags (largest first) if leftover > 0; keep piggy only (not $0.50
  lottery) so one green exit clears cascade min entry.
- **No dead UNI reserve** — skip hard UNI T1 when tradeable &lt; min / &lt;$2 inject-all;
  seat best scorer instead (velocity boost for DEGEN/AERO/BRETT/…).
- Underwater bags (LINK −1%) still hold until a profitable plain sale — lose-zero.

### Research — revenue / hitch ingest sims; adaptive thin-book COST_EDGE

Live Railway (~$2.24 inject-all LINK, UNI ~$4.7 underwater, hitch nearly free):
primary blocker is **near_term COST_EDGE 1.35×** on gas-dominated seats + capital
locked in bags — not hitch insert cost. Hitch L1 is ~0 today.

- **`revenue-sim.js`** — theories T1–T5: COST_EDGE sweeps, seat fragmentation,
  unknown-cost recycle, hitch budget, capital ladder $5→$100. `npm run sim:revenue`.
  Simulator **calculates** profitability; never assumes it. Lose-zero invariant:
  never sell/insert when leftover after fees ≤ 0.
- **Adaptive near-term mult** — thin books (&lt;$15) with hitch &lt;2% of stake use
  **1.15×** break-even instead of 1.35×. Still refuse upside &lt; required move.
  CBBTC-class keeps 1.35×. Unlocks fills on squeeze days without reopening majors.
- **`revenue-sim.test.js`** — A/B adaptive vs baseline on live $2.24 assumptions.

### Fixed — free locked CBBTC cash; keep majors closed; hunt profits only

CBBTC stayed ARMED on live Railway while fractional bags locked most of the
RISK book. Goal: free the cash, freeze the name, earn on liquid books only.

- **CBBTC + AAVE FROZEN** — exits allowed, new buys forbidden.
- **`forced-exit.js`** — `FORCE_EXIT_LOCKED_MAJORS` (default on) queues
  `exitonly` + piggy unlock for stranded CBBTC/AAVE. **No cascade** — proceeds
  stay ETH/WETH for profit hunting. Latch persisted so it does not loop.
- Sell gate allows `FORCE EXIT LOCKED` even if underwater (recovery).
- COST_EDGE + USD exits from prior work still refuse re-entry economics.

### Fixed — CBBTC-class entries where insert cost ate the bag (COST_EDGE)

Live lesson: bot entered wrapped BTC / high unit-price majors where hitch +
round-trip already dominated a tiny RISK stake. LOSE_ZERO leftover vs a far
BTC peak looked “covered,” then fractional bags (`≪ 1` unit) never hit
`sellable > 1` — capital sat underwater waiting forever while spending limit
collapsed.

Algorithms (practical Kelly / break-even execution cost):

- **`cost-edge-gate.js`** — refuse when hitch &gt; 8% of stake, full RT &gt; 22%,
  or near-term upside (recent high) &lt; 1.35× required break-even move.
  High-unit symbols need ≥$25/$15 and are blocked on thin books (&lt;2× floor).
- **LOSE_ZERO sizes against actual spend**, not the full tradeable book.
- **Avenue prime** uses the same COST_EDGE refuse (replaced the useless 95% RT cap).
- **USD exit thresholds** — fib / wave / stale / ripple / dust use bag USD, not
  token count &gt; 1 (CBBTC ~0.00006 units is a real $ bag).
- **CBBTC / AAVE deferred** from inject-mains; min buys $25 / $15; T1 no longer
  re-seats avenue-refused names.
- **Mistake log** — refusals + realized losses via `/costedge` for forward learning.

### Added — cascade gas floor: never deplete moves mid-cascade

Cascade was sizing the highest deploy without loss on leftover/hitch math, but could still spend the last native ETH so the next sell or cascade hop had nothing left for Base gas (WETH cannot pay gas). Thin inject-all books were the worst case: 100% deploy → stranded.

- **`cascadeGasFloorEth` / `effectiveCascadeGasFloor`** — keep fuel for the next N moves (default 3); thin books scale the floor toward `GAS_RESERVE` so ~$5 liquid can still cascade.
- **`cascadeDeployEth` gas ceiling** — highest deploy without loss still leaves the floor in liquid; refuse the hop rather than cross the depletion threshold.
- **`ensureCascadeNativeGas`** — unwrap WETH→ETH before sell (when under reserve) and before every cascade buy.
- **Buy/wrap path** — tradeable and wrap sizing subtract the cascade gas floor, not only `GAS_RESERVE`.
- **Inject prove milestone** — count successful on-chain hitch fills toward **20** with net profit; Telegram `/injectprove`; capital may increase only after prove + profit. Persisted on `positions.json`.

### Added — avenue priming: projected costs + top 2–3 cascade seats

Cascade used to cold-scan for a near-trough target only *after* a sell. Thin books often picked paths that could not clear fees+hitch without losing; rich books still waited on a full loop before the next inject seat was chosen.

- **`avenue-prime.js`** — every cycle projects round-trip cost (fees + gas + hitch + impact) per avenue vs this book’s spend size. Refuses paths where projected leftover ≤ 0 or spend &lt; min entry (lose-zero). Ranks the rest by expected net × hitch-code fit / cost.
- **Top 2–3 primed seats** (1 on inject-all, 2 on small book, 3 otherwise) re-seat T1/T2 and feed `findCascadeTarget` first — choice is ready before the cascade fires; READY/near-entry seats execute without a long wait.
- Growing capital prefers the path that makes the most **and** fits the most Eureka/code bytes for the least cost, then rolls into the next primed seat.

### Added — Guardian L1 Arena Sprints 2–5 (sideline)

`guardian-protocol/` advances from Sprint 1 instrument to a full Arena ladder without touching the live trader:

- **Sprint 2:** dashboard + replay viewer + leaderboards/Pareto + submission validation + `arena:compare`
- **Sprint 3:** ADAPTIVE / COSTOPT / PRIORITY / REDOPT strategies vs FIFO baseline
- **Sprint 4:** failure/churn/bandwidth stress, multi-replica repair, `arena:stress`
- **Sprint 5:** hitch/DA/storage adapter stubs with explicit no-root-trader boundary

### Fixed — BALANCE LOW false alarm; fragment buys strand cascade (min-entry inject-all)

Live Railway `industrious-tranquility` / `guardian-protocol-agent` @ `0bad3c9` (2026-09-08):

- Chain ETH+WETH on `0x50e1…7915` = **0.001985** — bot tradeable **0.000485** matched chain after a hard `SELL_RESERVE=0.001` ate the thin book.
- Four small buys then **Insufficient ETH+WETH** / Telegram **BALANCE LOW** while capital sat in unknown-cost bags (KEYCAT ~$0.28 etc.) that never recycled hard enough to cascade.
- Capital was updating from chain correctly — liquid was truly thin; the bug was **reserve math + fragmented entries**, not a stale RPC zero.

Changes (still LOSE_ZERO / 2× hitch sell / piggy never-sell / Eureka on leftover):

- **`cascade-rollover.js`** — min entry covers round-trip gas + fees + hitch + cascade seed; inject-all book (`<$12`) = **1 seat @ 100%**; cascade deploy only when proceeds ≥ next min entry; liquid-vs-bags status (recycle≠top-up).
- **Thin-book sell reserve** — shrink `SELL_RESERVE` under 0.01 ETH so ~$5 liquid reports real tradeable (~0.0012) instead of 0.000485.
- **Dust recycle → cascade** — when liquid starved, lower unknown-dust floor; after a profitable recycle/trim, `triggerCascade` into a near-low (piggy dust stays locked).

### Fixed — `/buy XCN $1` never filled: `minTrgh` TDZ + dead WETH book

Live Railway after PR #31 (`946cc30`): Telegram queued `/buy XCN $1`, then every `processToken(XCN)` crashed with `Cannot access 'minTrgh' before initialization`. `stopLossPrice` used `minTrgh` before `entryTroughForBuy` declared it — so **no token** could finish processToken (manual buys never reached `cmd.action === "buy"`).

Also: Uni V3 **XCN/WETH ~$212** while **XCN/USDC ~$173k** is the real book. Bot is WETH `exactInputSingle` only — a $1 XCN smoke would slip/fail even after the TDZ fix.

Changes (still LOSE_ZERO / 2× hitch sell / piggy never-sell / Eureka on leftover):

- **TDZ fix** — compute `minTrgh` (inject pullback trough) **before** `stopLossPrice`.
- **Freeze XCN** for new buys; keep wave OHLC via DexScreener/Gecko + **Binance allowlist** (same Onyxcoin asset).
- **Per-token min buy USD** (`token-mins.js`) — Telegram `/buy` and operator path refuse below the book floor (`TOKEN_MIN_BUY_USD_JSON` override).
- **Multi-source wave seed** — rank + merge GT/DS/(Binance) candles; log multi-source coverage.
- **No-loss cycle align gate** — auto buys need ≥`CYCLE_ALIGN_MIN` (default **2**) of trough/momentum/pred/pullback/leftover/smartMoney. Telegram `/cycles` shows succession streaks + live mins.

### Fixed — dragnet burns cycles; inject mains never buy; revenue flat

Live Railway `industrious-tranquility` / `guardian-protocol-agent` @ `9833348` (2026-09-07):

- Tradeable ~**0.0024 ETH (~$6)** → T1 reserved **UNI > CBBTC > LINK** at ~$1.30/slot, **T2=none**.
- UNI/LINK/CBBTC **ARMED** on 90d candle MINs (UNI buy trigger ~$3.17 while mark ~$7) → **zero fills, zero hitch**.
- SKI/DRB passed `LOSE_ZERO: leftover covers inject` every ~60s then `not in active tiers (OUT)` — hitch L1 fee RPC for nothing.
- Unknown-cost dust bags never moonshot-trimmed (`if (!entryPrice) continue`) → capital stuck, no recycle into inject trades.
- Historical `bot-state` ledger (Mar): **+$324 net / 70% WR** on larger book — cascade churn and AIXBT stop-outs were the main leaks; current live issue is **no trades at all**.

Changes (still LOSE_ZERO / 2× hitch sell floor / never lose to insert):

- **Small-book tiers** (`<$15`): 2 T1 seats @ 85%, cheaper T2 floor so leftover-covered swaps can hitch.
- **Inject pullback entry** + entry-trough climb to recent low when 90d MIN is stale; candle seed prefers 14d low for inject mains.
- **Tier gate before hitch L1 fee** so OUT tokens die without oracle spam.
- **Dust recycle** for unknown-cost bags above lottery floor (plain sale if hitch not covered).

## Released — 2026-09-07 (main)

### Fixed — new majors live but not injection-ready (OHLC + capital)

Railway @ `0930b8a` booted **24 active** including LINK/AAVE/UNI/VVV/ZORA/BNKR, then LINK/AAVE/UNI hit the 8s Dex seed timeout with no Binance fallback. Dead-wave −15 also kept no-history majors out of Tier 1/2 so hitch had nowhere to land.

- Allowlist **LINK / AAVE / UNI** for Binance OHLC (same CEX asset as Base Uni V3 contracts). BNKR/VVV stay denylisted (Base-native).
- Inject-surface score +12 for high-liquidity catalog names with &lt;2 trades so deep Uni books compete for capital.
- Boot banner prints the live active symbol list (not the stale “15 + MOG…” line).
- **UNI is a main inject player**: reserved Tier-1 seat (prefer UNI), `injectMain` + score floor for UNI/CBBTC/LINK/AAVE/AERO/MORPHO so the injector actually uses Uniswap’s own token and other majors — not only meme books with history.

### Added — top-100 Uniswap V3 majors for hitch injection

Canon catalog could see Base meme/Base-native names but not the bigger CMC top-100 books that actually trade on **Uniswap V3** (the bot’s only router). Live scout 2026-09-07 (DexScreener + factory `getPool`):

- **ADD tradeable:** LINK (`0x88Fb…e196`, fee 3000), AAVE (`0x6370…814b`, fee 3000), UNI (`0xc3De…3C83`, fee 10000).
- **UNFREEZE:** VVV (fee → 10000 — Uni V3 WETH/USDC proven), ZORA (fee → 10000), BNKR (deep Uni V3 WETH ~$1.8M).
- Entry sanity treats **AAVE** like CBBTC (unit price ≫ $50).
- **Skipped:** USDT/EURC (no wave), cbETH (V3 thin), cbXRP/CRV (wrong venue), SOL/COMP/WBTC (too thin vs CBBTC).

### Fixed — boot recon crashed on `netPositions is not defined`

Live after PR #25 (`6bb972f`): on-chain scan was honest (9 bags, unknown cost, ~$5.14 chain mark) then `CHAIN RECONCILIATION — netPositions is not defined`. `const netPositions` lived only inside the boot-scan try, so `processToken` could not read the ledger either. Hoist `let netPositions = {}` to module scope.

### Fixed — /buy went silent; account amounts were invented, not chain pings

Live Railway after PR #24: Telegram `/buy TOSHI $1` queued, then `LOSE_ZERO: block buy TOSHI no clear edge` with **no Telegram skip**. Boot copied live Dex marks into `totalInvestedEth` ("UNKNOWN ENTRY"), so leftover ≈ −fees and KEYCAT/BASECAT held forever. `getTokenBalance` `catch { return 0 }` plus `/buy` live fetch dividing by `1e18` (not real decimals) printed false zeros. `/bank` dropped bags with `b < 1` (CLANKER) and mixed lottery dust with piggy. Telegram HTML `can't parse entities` ate `/bank` and pulse.

- **Operator `/buy` is a test path.** Leftover+edge never block `MANUAL BUY (operator)`. Hitch Eureka if leftover covers 1× hitch; otherwise **plain swap**. Frozen / PRICE_INSANE / insufficient ETH / fill honesty still apply. After queue, Telegram always sends a Basescan receipt **or** the exact skip reason (`Nothing sent. No Basescan receipt`).
- **Chain is the ledger.** RPC fail keeps the last successful ping — never silent 0. Token units use `decimals()`, not 1e18. `/bank` and pulse list every bag (including dust) from a live ping. Unknown bags show "unknown cost basis — chain balance is truth"; leftover for those sells is **proceeds − fees** (not a fake breakeven at the live mark).
- Saved entries without a fill receipt / ledger buy are treated as unknown, so a restart cannot keep invented P&L.

Does **not** weaken PRICE_INSANE, QuoterV2, piggy never-sell, minOut, auto LOSE_ZERO, frozen buy, or L1 oracle.

### Fixed — hitch was freezing profitable KEYCAT/BASECAT sells

Live after PR #23: Telegram had the Eureka letter (`/prove` / hitch copy) but **no fills**. Logs: `LOSE_ZERO: hold sell KEYCAT hitch would wipe edge` every cycle. Moonshot allowed BASECAT (2× hitch), then `executeSell` re-gated and held. The 2× hitch floor was treating insertion cost as a veto on the wave.

- **Sell if leftover after fees > 0.** Hitch Eureka on the way out only when leftover also covers 2× hitch. Otherwise **plain sale** — Basescan receipt of the swap, letter skipped so we still take profit. Hold only when the trade itself would lose (leftover after fees ≤ 0). Piggy dust still never sold; 1% skim still funds piggy / pred / agent on winning fills.
- **Buy** still needs leftover covering 1× hitch + a clear wave edge so round-trips can pay piggy + agent. Eureka hitch on leftover-covered buys; `/prove` remains the dedicated 0-ETH letter.
- **Early sell** waits for MACD cross-down while still overbought / near the peak (not RSI≥75 alone) so bags can run for max profit before the target floor.

### Fixed — live bot was not trading: $3 floor + fake Telegram receipts + no Railway deploy

Railway `industrious-tranquility` / `guardian-protocol-agent` still ran **`main` @ `7ad6c85`**. This PR was never merged, so there was no restart. Live logs: KEYCAT/BASECAT `AT MIN TROUGH — BUYING` then `Wallet too small: $2.59 (need $3)` every cycle. Telegram sent **BUY RECEIPT** *before* `executeBuy`, so the chat showed buys with no Basescan hash.

- **MIN_POS_USD default $0.50** (was $3). Matches T1 slot floor. Env `MIN_POS_USD` overrides. $2.59 liquid ETH can trade again.
- **Telegram receipts only after a fill** — no BUY TRIGGERED / SELL RECEIPT / FIB ladder message before the swap. `executeBuy` / `executeSell` still send BOUGHT / WAVE COMPLETE with hitch footer + Basescan link.
- **Fib latch after fill** — `recordFibLevelExecuted` used to fire *before* `executeSell`. A hitch-hold then skipped that KEYCAT 100% rung forever.
- UTF-8 Eureka hitch stays on leftover **buys and sells**. Leftover gate still sizes the 10-byte `§$STORE§` cover so a long letter cannot freeze the book.

### Fixed — buys that did not fill were logged as wins; Eureka letter was claimed off-chain

Telegram printed `BOUGHT` + the VITA letter after `cdp.evm.sendTransaction` returned a hash. Sells already waited for receipt + ETH delta (`isSuccessfulSellFill`). Buys did not — a revert / 0-token fill still incremented `tradeCount`, wrote BTP, and claimed Eureka. Live KEYCAT sell `0x5c0a93e4…` is a **plain 228-byte** `exactInputSingle` with **no trailing UTF-8**.

Genesis / StorageToken rule (brief that landed in `masterledgerlive/StorageToken`, not this repo): hitch `§$STORE§` on a **real leftover swap**, **or** send a dedicated 0-value storage tx. Never invent a swap/hash. Never claim Telegram text is on-chain unless those bytes are in the mined calldata.

- **Buy fill gate** — `isSuccessfulBuyFill` requires receipt success **and** token-balance delta > 0. Failed buys do not increment `tradeCount`, do not BTP, do not print 💌. Slippage cooldown applies to buys too.
- **UTF-8 hitch** — leftover-covered buys/sells append `§$STORE§ Eureka! VITA lives ♥ …` after the 228-byte swap. Telegram 💌 only if those bytes were actually sent. Sell **ledger** signature uses the same gate (it used to always write the Eureka string).
- **`/prove`** — dedicated 0-ETH self-tx with the full letter; waits for a **success receipt** before claiming. `/voiceon` `/voiceoff`. Independent of BTP auto-suspend.
- **Project map** — README names this repo + Railway `industrious-tranquility` / `guardian-protocol-agent` as the live trader. StorageToken and `coinbase-agent` are not this bot.
- **VITA model cycle** — `nextVitaModel()` round-robins Anthropic ids (`claude-sonnet-4-20250514`, `claude-opus-4-20250514`). Railway `VITA_MODELS=id1,id2`. Telegram `/models`.
- **Catalog** — ADD tradeable **REI** (`0x6B25…4cFD`, Uni v3 1% ~$208k / ~$77k) and **CLANKER** (`0x1bc0…1Bcb`, Uni v3 1% ~$1.49M / ~$30k). Live DexScreener 2026-09-07. STONKEX/BLUECHIP/VELVET/KTA/VVV/TIBBIR stay frozen. BASECAT/DRB stay tradeable.
- Does **not** weaken PRICE_INSANE, QuoterV2, piggy, minOut, LOSE_ZERO, frozen buy, L1 oracle, or `HALT_NEW_ENTRIES`. This agent does not send live capital.

### Added — hitch inject cost from live Base `GasPriceOracle.getL1Fee`

LOSE_ZERO leftover and the 2× sell floor were pricing `§$STORE§` / hitch as L2 calldata-gas only (`16 gas/byte × gwei`). On Base the L1 data fee dominates what we actually pay to insert the message.

- Shared helper `l1-fee-oracle.js` builds unsigned EIP-1559 swap+hitch bytes and calls the GasPriceOracle predeploy `0x420000000000000000000000000000000000000F`. Prefers `getL1Fee(unsigned RLP)`; uses `getL1FeeUpperBound(txSize)` when full RLP is missing or `getL1Fee` fails. Hitch L1 is the incremental fee of extra hitch bytes on a typical `exactInputSingle` envelope. Optional BTP self-send gets its own L1 quote.
- `estimateInjectHitchCostEth` / buy leftover / sell+size gates prefer that live L1 (plus L2 calldata). Oracle failure keeps the previous L2-only fallback — never under-cover by inventing a fee.
- Logs `HITCH FEE — L1 … + L2 …` when hitch is sized (`executeBuy`, `executeSell`, moonshot trim).
- Does **not** weaken PRICE_INSANE, QuoterV2, piggy dust, minOut, frozen buy, 2× hitch multiplier, or DRAWDOWN / `HALT_NEW_ENTRIES`.

### Fixed — independent TOSHI spot was the Pancake VIRTUAL ghost ($69729)

PRICE_INSANE (PR #19) correctly refused TOSHI sells, but the DexScreener/Gecko **independent** side was itself polluted. `/latest/dex/tokens/TOSHI` ranks PancakeSwap TOSHI/VIRTUAL first: **$69729.86**, ~$70M reported liq, **$0 volume**. Real Uniswap v3 TOSHI/WETH is ~$0.00012. Early logs: `mark $0.0001216 vs dex/gecko $69729.86`. Later both slots stuck at $69729 and refused only via implied bag.

- **Pair picker** prefers Uniswap/Aerodrome **WETH or USDC** (plus native ETH / USDbC), requires the wanted token as `baseToken`, drops zero-volume mega-liq ghosts, and pins the known TOSHI Uni v3 WETH pool. A $69729 dex row is never selected as independent.
- **sanitizeIndependentUsd**: $69729 vs last sane / ETH-normalized ~$0.00012 is rejected as independent; sane ~1.2e-4 is kept. If mark **and** independent are both fantasy, still refuse vs last sane / ETH-normalized — do not cache the moonshot into both slots.
- **Trusted last-sane**: a verified WETH/USDC quote can replace an untrusted cached fantasy; an untrusted 100× jump cannot overwrite a sane seed or the mark cache.
- **Backoff** (optional, does not weaken refuse): after PRICE_INSANE, skip re-fetch / re-attempt for 10m and reprint the log at most every 15m (`PRICE_INSANE_RETRY_COOLDOWN_MS` / `PRICE_INSANE_LOG_COOLDOWN_MS`).
- Does **not** weaken LOSE_ZERO, frozen buy, 2× hitch, piggy dust, minOut sanitize, or Base QuoterV2.

### Fixed — PRICE_INSANE gate + Base QuoterV2 + no 0-ETH "wins"

After piggy PR #18 + minOut PR #17, ~21 TOSHI→WETH sells still failed with `Too little received`. Logs showed TOSHI mark ~$69729 while Gecko/Dex spot ~$0.000122. Quote-fallback then built `amountOutMinimum` ~91k–93k WETH on ~4335 TOSHI. `sanitizeAmountOutMinimum` could not stop that because expected/spot were derived from the same insane mark (or Quoter missed).

- **PRICE_INSANE** runs in `executeBuy` / `executeSell` (and moonshot trim) **before** hitch, LOSE_ZERO, piggy sizing, and minOut. If mark vs independent DexScreener/Gecko (or last sane seed) is outside **0.01×–100×**, or implied bag ≫ RISK start (default 100× of $15), refuse and log — do not compute hitch/minOut from fantasy. Live fixture: $69729 TOSHI vs $0.000122 spot.
- **Base QuoterV2** is now the official Uniswap deployment `0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a` (https://developers.uniswap.org/docs/protocols/v3/deployments/v3-base-deployments). The previous `0x3d4e44Eb1374240CE5F1B136041212501e4a098e` is invalid on Base and forced the USD-mark fallback.
- Cap consecutive `Too little received` (and 0-ETH fills) per symbol at **N=3**, then a 30m cooldown so the retry loop stops burning gas (`SLIP_RETRY_MAX` / `SLIP_COOLDOWN_MS`).
- Failed swaps are never logged as ✅ / WAVE COMPLETE / 0.000000 ETH received as a win. Receipt + balance delta must show a real fill before tradeCount / BTP / ledger.
- BTP strand sell no longer reads `netUsd` / `received` / `recUsd` before they are declared (TDZ: `Cannot access 'netUsd' before initialization`).
- Does **not** weaken LOSE_ZERO, frozen buy, 2× hitch, piggy dust, or minOut sanitize.

### Added — per-token piggy-bank dust (never-sell reserve)

Every token position keeps a growing dust pile. Sells must leave it. Dust is sold only when Game/operator explicitly unlocks it.

- Config: `PIGGY_BANK_PCT` (default **2%** of current token units; accepts `0.02` or `2`) and `PIGGY_BANK_MIN_USD` (default **$0.05**, converted via live price). Reserve = `max(pct × balance, minUsd / price)`, capped at balance. Hypothesis: 2% matches the old ephemeral lottery % so we do not suddenly lock more than the bot already tried to keep; a $0.05 floor leaves a real pile on micro-caps without a min-token-count (1 TOSHI is worthless, 1 CBBTC would trap the bag).
- Central `applyPiggyToSell` in `piggy-bank.js`. `executeSell` (wave, moonshot, cascade/ripple, operator `/sell` / sellhalf, fib, stale, stop-loss, clean exit) computes `sellable = balance − piggyReserve`. A 100% request still leaves dust.
- Unlock: reason prefix `PIGGY UNLOCK` or Telegram `/piggyunlock SYMBOL`. Only then can the pile be sold.
- Ratchet: floors up on buys / balance growth (`executeBuy` + each `processToken` tick). Never auto-decreases after partial sells. Cap at remaining units only.
- Persist: `token.piggyReserve` in `tokens.json` and `piggyReserves` map in `positions.json`. Restarts keep the high-water mark (`loadPiggyReserve` takes the max of both).
- Does **not** weaken LOSE_ZERO, frozen buy gate, 2× hitch sell floor, or PR #17 minOut sanity (`sanitizeAmountOutMinimum` / `toWei` real decimals). Hitch and minOut run on the reduced `piggy.tokensToSell` size (more conservative).
- Distinct from the ETH skim `/piggy` pool (`positions.piggyBank`).

### Fixed — impossible Uniswap `amountOutMinimum` can no longer brick exits

Two RISK TOSHI→WETH sells reverted with no ERC20 Transfer because `amountOutMinimum` was ~93k–93.5k WETH while selling ~4424 TOSHI:

- `0x134bb40c9807fe2ebc48ab77a5a69cdbc29dea15c636a19acd43a7458521d3c6`
- `0x693af50a02fd00cfb69ffee9e59c8a38bd86ea1f24a44be22dcdcd563033d8d3`

On-chain calldata: hitch/BTP was trailing LIBM after the 228-byte `exactInputSingle` (slot not overwritten). The floor itself was computed insane (quote/slippage/`Number(wei)` path).

- Shared `sanitizeAmountOutMinimum` in `swap-minout.js`: compare minOut to QuoterV2 expected out (preferred) or USD spot; if minOut > expected or orders of magnitude above spot, **clamp** to the slippage band and log. If there is no quote and no spot, **reject — do not send**.
- **Covered call sites:** `executeSell` (all exits: wave / moonshot / operator / stop-loss), `executeBuy` (wave / OPERATOR_BUY / `/buy` / cascade / ripple), `encodeSwap` / `encodeSwapWithReceipt` (single encoder), `MempoolOrchestrator.injectAndSend` (refuses hitch that would overwrite the swap prefix / `amountOutMinimum`).
- Sell + buy quotes both go through QuoterV2; floors use bigint slippage (`85n/100n`) instead of `Number(quotedWei) * 0.85`. Amount-in uses the token's real decimals.
- Does not weaken LOSE_ZERO, frozen buy gate, or 2× hitch-cover. Protective `minOut=0` still allowed. No capital spends.

### Catalog — freeze VVV / TIBBIR (data-only)

Desk: keep VVV and TIBBIR in the catalog but `frozen: true` until Uni V3 is proven. No capital, no unfreeze, no `tokens.json` runtime adds.

- **Freeze:** VVV `0xacfE6019Ed1A7Dc6f7B508C02d1b04ec88cC21bf`, TIBBIR `0xA4A2E2ca3fBfE21aed83471D28b6f65A233C6e00`.
- Reason: `Desk greenlight overnight — data-only until Uni V3 proven.`
- STONKEX / BLUECHIP / VELVET / KTA stay frozen. BASECAT stays tradeable. DRB untouched. Buy-gate / hitch-cover logic unchanged.

### Fixed — cascade / ripple / operator buys must cover hitch under LOSE_ZERO

Overnight capital rotated via cascade/ripple without leftover covering 1× `§$STORE§` hitch + edge. `executeBuy` skipped `buildBuyGateDecision` when `isCascade`, and `evaluateBuyGate` / `buildBuyGateDecision` auto-allowed cascade plus every `MANUAL BUY (operator)`.

- Cascade and ripple now use the same leftover + edge gate as auto buys. No silent `isCascade` allow.
- `executeBuy` calls the buy gate for cascade too (removed `!isCascade &&` skip).
- Operator /buy is lossy only if `ALLOW_LOSSY_OPERATOR_BUY=yes` (default no) — mirrors `ALLOW_LOSSY_OPERATOR_SELL`.
- Frozen catalog gate (PR #13) unchanged: `frozen=true` still blocks NEW buys entirely. Sells stay on the 2× hitch floor.

### Catalog — frozen data-only add (KTA)

Desk greenlight. Catalog-only — no capital, no unfreeze, no `tokens.json` runtime add. Buy-gate logic unchanged (PR #13).

- **ADD frozen:** KTA (Keeta) `0xc0634090F2Fe6C6D75e61Be2b949464aBb498973` (Base, 18 decimals). Top book Aerodrome KTA/WETH ~$4.27M liq (not Uni V3) — keep frozen.
- STONKEX / BLUECHIP / VELVET stay frozen. DRB / VVV / TIBBIR untouched. BASECAT stays tradeable. Skip BSTONK / FLOCK / HYDX.

### Fixed — frozen catalog names can never open NEW buys

Overnight RISK capital bought STONKEX / BLUECHIP despite `frozen: true`. Freeze was only an allocation / UI / `processToken` early-return when `entryPrice` was missing. Cascade, ripple, and frozen names that already had a bag still reached `executeBuy`.

- Shared `isCatalogFrozen` / `frozenBuySkipLog` in `lose-zero-gate.js`.
- Hard gate at the top of `executeBuy` — blocks auto wave, OPERATOR_BUY, Telegram `/buy`, cascade, and ripple. Logs a clear skip reason.
- `shouldBuy`, `findCascadeTarget`, and ripple targets also skip frozen names (no "BUY TRIGGERED" / cascade Telegram then fail).
- Frozen tokens with a bag or pending command still fall through `processToken` so OPERATOR_SELL / sellhalf / dust exits stay open.
- Catalog flags unchanged: STONKEX / BLUECHIP / VELVET stay frozen. BASECAT stays tradeable. DRB / VVV / TIBBIR untouched. No capital spends.

### Catalog — frozen data-only adds (STONKEX / BLUECHIP / VELVET)

Desk greenlight overnight. Catalog-only — no capital, no unfreeze, no `tokens.json` runtime adds.

- **ADD frozen:** STONKEX `0x5ab000ff9B9FfE0349CE5ffA5fD86f217C3680F5`, BLUECHIP `0xB200000000000000000000cFbdF64a8706a94a01`, VELVET `0xbF927b841994731C573BDF09ceB0c6B0Aa887cDd`.
- Skip FLOCK / BSTONK. KEYCAT already in catalog. BASECAT / DRB / VVV / TIBBIR unchanged (BASECAT stays tradeable).

### Scout — prune Base token universe (DexScreener live)

Sleeping-game scout of `DEFAULT_TOKENS` against live DexScreener Base pools. See `UNIVERSE.md`.

- Freeze SEAM, BASE, MOG (thin / dead book — not safe for ~$3–11 RISK + 2× hitch). TOSHI stays active.
- Mark no-pool / broken-quote rows (`noBasePool`, `brokenQuote`) and skip their 8s OHLC seed so boot does not hang on CRASH/FREN/NORMIE/OGGY/KITE/SIMBA(ezETH)/BRIUN(UNIDX)/IMAGINE.
- Correct watchlist CLANKER to tokenbot `0x1bc0c422…1Bcb` (old address was CLANKFUN).
- **ADD** liquid actives (desk greenlight, live DexScreener): BASECAT, DRB, VVV, TIBBIR. Skip BSTONK. KEYCAT not duplicated.

### Fixed — never sell at a loss to insert storage (2× hitch floor)

Moonshot trim sold TOSHI at a ledger net ~-$0.06 (`0x1ac8e214…`) because hitch / BTP character cost was not in the sell gate. Sells and cascade were ungated.

- Central `minSellProceedsEth` / `coversHitchAndEntry` / `evaluateSellGate` used by `executeSell` and moonshot trim.
- Sell floor: `sell_target = fair_exit + fees + (HITCH_COST_MULT × inject_hitch_cost)`. Default `HITCH_COST_MULT=2` (env-overridable). Buys stay 1× leftover cover.
- If leftover after fees cannot cover 2× hitch: **hold**. Once the floor is met: **sell immediately**.
- Hitch / BTP bytes sized so inject cost × 2 ≤ leftover. Extra hitch is skipped rather than selling underwater to "make room".
- Only lossy exception: reason starts with `MANUAL SELL (operator)` AND `ALLOW_LOSSY_OPERATOR_SELL=yes` (default no). Stop-loss still exits with hitch skipped.

### Fixed — `hasPosition` TDZ aborted every `processToken` (blocked OPERATOR_SELL)

Live Railway after OPERATOR_SELL #7 logged `processToken error (AERO/BRETT/...): Cannot access 'hasPosition' before initialization` on every token. Armed-idle logging read `hasPosition` before `const hasPosition = balance > 1`, so the function threw in the temporal dead zone and never reached buys, wave sells, or the MANUAL SELL / `sellhalf` operator path.

- Declare `hasPosition` before the armed-idle log.
- Buffer the calendar-bias display line until `lines` exists (same TDZ class).

### Added — native `OPERATOR_SELL=TOSHI:50` + `/sell SYMBOL [pct|all]`

Game has a live TOSHI bag from the first RISK-wallet buy and needs an operator sell proof without waiting on wave gates.

- Native `OPERATOR_SELL=TOSHI:50` queues one `{ symbol, action: "sellhalf" }` after CDP ready (same MANUAL SELL HALF path as `/sellhalf TOSHI`). Also accepts `TOSHI:50%`, `TOSHI:half`, `TOSHI:all`.
- Telegram `/sell TOSHI`, `/sell TOSHI 50`, `/sell TOSHI all` still queue a manual sell. `/sellhalf TOSHI` is unchanged.
- Reason for env / sized sells is `MANUAL SELL (operator)` so the command bypasses wave gates. Latch is set only after `executeSell` succeeds (same restart re-queue as `OPERATOR_BUY`).
- Does **not** queue a re-buy. Auto stays gated by LOSE_ZERO unless `OPERATOR_BUY` is also set.

### Fixed — boot no longer dies on llamarpc 521 / eth_getBalance

`eth_getBalance` was hitting `https://base.llamarpc.com` (Cloudflare 521) and throwing, which killed `main()` with `Fatal main() error — restarting` before `OPERATOR_BUY` could fire.

- Prefer `process.env.BASE_RPC || RPC_URL || BASE_RPC_URL` ahead of any hardcoded public list.
- Remove `base.llamarpc.com` from the RPC rotation (dead 521s).
- RPC reads failover across the full list — a single 521/timeout does not throw. `getEthBalance` soft-fails to 0 so boot continues.
- In-process `main()` restart: VITA webhook skips rebind when port 3000 is `EADDRINUSE` (log and continue).
- `OPERATOR_BUY` re-queues on each fresh process boot and on fatal in-process restart unless the swap actually executed. The idempotent latch is set only after `executeBuy` succeeds.

### Fixed — Telegram poller starts before 90-day OHLC seed

Boot used to `await loadHistoricalData(90)` (DexScreener/GT, no per-call cap) and only then start the independent Telegram poller. A hung DexScreener call froze Telegram for minutes.

- Start the 3s Telegram poller immediately after vault unlock / CDP client ready. Guarded so it cannot start twice.
- Each token seed is wrapped in an 8s `Promise.race` timeout; DexScreener fetches use `AbortSignal.timeout(8000)`.
- Native `OPERATOR_BUY=TOSHI:3` queues `{ symbol, action: "buy", usd }` once after CDP ready (idempotent). Reason remains `MANUAL BUY (operator)` so LOSE_ZERO still allows the operator path; auto stays gated.

### Added — `/buy SYMBOL [usd]` operator size + LOSE_ZERO bypass

- Telegram `/buy TOSHI`, `/buy TOSHI 3`, and `/buy TOSHI $3` queue a manual buy.
- Optional USD is converted to `forcedEth = usd / ethUsd` and passed into `executeBuy`.
- Reason is `MANUAL BUY (operator)` so LOSE_ZERO / inject-cover allow the operator path. Auto buys stay gated.

### Fixed — Binance OHLC must not overwrite Base tokens

Boot seed was picking Binance `LUNAUSDT` (~$0.047) and `KITEUSDT` (~$0.13) because those CEX series have more daily bars than Base DEX pools. That is Terra / L1 KITE, not Virtuals LUNA (~$0.005) or a Base KITE pool.

- Historical seed prefers GeckoTerminal / DexScreener Base candles whenever they exist.
- Binance OHLC is allowlisted only for CEX-equivalent Base assets (AERO, BRETT, VIRTUAL, …). LUNA, KITE, GAME, HIGHER, MIGGLES and other Base-only memes never use Binance.
- DexScreener v3 chart 404s on V2/Rocketswap — seed those pools via GeckoTerminal OHLCV instead, with 429 retries.
- If Base OHLC is still thin, pin `lastPrice` to a live Base quote and build waves from ticks. Never invent a CEX lastPrice. KITE stays disabled with no Base pool.

### Fixed — live USD quotes (MORPHO / KITE / LUNA / GAME / UNKNOWN ENTRY)

Production was treating missing prices as $0, which poisoned wave prediction and tier scores.

- Corrected Base contract typos: MORPHO, LUNA, GAME, MOCHI. Catalog addresses are now authoritative on GitHub load (saved `tokens.json` cannot override a wrong contract).
- KITE's configured Base address has no DexScreener/GeckoTerminal market. It is disabled and skipped with a clear log rather than traded on an invented quote.
- Price path now prefers DexScreener (highest-liquidity Base pair) and GeckoTerminal in chunks of 10. The previous GT batch of 28+ addresses returned HTTP 400 or silently kept only ~10 prices.
- Boot scan / unknown holdings resolve from the live market + on-chain balance. Never logs `val≈$0.00` when a market price exists. If still unquoted, the token is marked `UNKNOWN` and excluded from margin math.
- Buys/sells/prediction skip when no real USD quote is available. No $0.000001 dummy entries.
