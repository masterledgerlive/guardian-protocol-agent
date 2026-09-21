/**
 * Token player + DEX reader + 32-chain other-path ETH L1.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BASE_WETH,
  TOSHI_BASE,
  TOSHI_CAKE_VIRTUAL_JUNK_PAIR,
  TOSHI_JUNK_DEX_USD,
  TOSHI_SANE_SPOT_USD,
  TOSHI_UNI_WETH_PAIR,
} from "../price-oracle.js";
import {
  dualCheckQuotes,
  readDexSnapshotFromPairs,
  thirdPartyRefs,
} from "./dex-reader.js";
import {
  ETH_L1_OTHER_PATH,
  MULTICHAIN_SEATS,
  OPERATOR_PORTFOLIO_SNAPSHOT,
  formatMultichainCard,
  listMultichainPortfolio,
  parseChainsCommand,
} from "./multichain-portfolio.js";
import {
  evaluateTokenLegit,
  handleTokenPlayerAction,
  loadTokenCatalog,
  marketTriggerValues,
  parseTokenPlayerCommand,
  seedDustPlan,
  tokenPlayerPublicState,
} from "./token-player.js";
import {
  buildTokenActionKeyboard,
  buildTokenCatalogKeyboard,
  parseTokenClickCommand,
} from "./telegram-clickthrough.js";

const HERE = dirname(fileURLToPath(import.meta.url));

function allCallbacks(kb) {
  return (kb?.inline_keyboard || []).flat().map((b) => b.callback_data || "");
}

describe("32-chain portfolio", () => {
  it("lists 32 chains and keeps ETH L1 out of Base RISK", () => {
    assert.equal(MULTICHAIN_SEATS.length, 32);
    const port = listMultichainPortfolio();
    assert.equal(port.chainCount, 32);
    assert.equal(port.notLivePnl, true);
    assert.equal(port.base.usd, 7);
    assert.equal(port.base.pct, 73);
    assert.equal(port.ethereum.usd, 3);
    assert.equal(port.ethereum.pct, 27);
    assert.equal(port.otherPath.mixIntoBaseSwapRouter, false);
    assert.equal(port.otherPath.usd, 3);
    assert.equal(ETH_L1_OTHER_PATH.mixIntoBaseRisk, false);
    assert.equal(port.emptySeats.length, 30);
    assert.equal(OPERATOR_PORTFOLIO_SNAPSHOT.kind, "operator-snapshot");
    const card = formatMultichainCard(port);
    assert.match(card, /ETH L1/);
    assert.match(card, /NOT in Base RISK/);
    assert.equal(parseChainsCommand("/chains").action, "chains");
    assert.equal(parseChainsCommand("/otherpath").action, "other-path");
  });
});

describe("DEX reader dual check", () => {
  it("drops the TOSHI Pancake ghost and keeps Uni WETH", () => {
    const pairs = [
      {
        chainId: "base",
        dexId: "pancakeswap",
        priceUsd: String(TOSHI_JUNK_DEX_USD),
        liquidity: { usd: 70_000_000 },
        volume: { h24: 0 },
        pairAddress: TOSHI_CAKE_VIRTUAL_JUNK_PAIR,
        baseToken: { address: TOSHI_BASE },
        quoteToken: { address: "0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b" },
      },
      {
        chainId: "base",
        dexId: "uniswap",
        priceUsd: String(TOSHI_SANE_SPOT_USD),
        liquidity: { usd: 1_200_000 },
        volume: { h24: 80_000 },
        pairAddress: TOSHI_UNI_WETH_PAIR,
        baseToken: { address: TOSHI_BASE },
        quoteToken: { address: BASE_WETH },
      },
    ];
    const snap = readDexSnapshotFromPairs(pairs, { symbol: "TOSHI", address: TOSHI_BASE });
    assert.equal(snap.ok, true);
    assert.ok(snap.priceUsd < 0.001);
    assert.equal(String(snap.pairAddress).toLowerCase(), TOSHI_UNI_WETH_PAIR.toLowerCase());
    const refs = thirdPartyRefs({ symbol: "TOSHI", address: TOSHI_BASE });
    assert.match(refs.basescanToken, /basescan/);
    assert.match(refs.dexscreener, /dexscreener.com\/base/);
    assert.ok(refs.coingecko);
  });

  it("flags DexScreener vs Gecko diverge and never averages a ghost", () => {
    const dual = dualCheckQuotes({
      primary: { priceUsd: 0.00012 },
      secondary: { priceUsd: 69729 },
    });
    assert.equal(dual.verdict, "QUESTIONABLE");
    assert.equal(dual.priceUsd, 0.00012);
    assert.equal(dualCheckQuotes({}).verdict, "FAIL");
  });
});

describe("token catalog + legit + seed", () => {
  it("loads purchasable Base seats and fails meme-only with no use", () => {
    const cat = loadTokenCatalog();
    const aero = cat.find((t) => t.symbol === "AERO");
    assert.equal(aero.purchasable, true);
    assert.equal(aero.neverRemoveLogSeed, true);
    assert.equal(aero.logSeedUsd, 0.05);
    assert.ok(aero.refs.basescanToken);
    const legitAero = evaluateTokenLegit(aero, {
      miss: false,
      trustedQuote: true,
      preferredDex: true,
      liquidityUsd: 1_000_000,
      volumeUsd24h: 50_000,
      dual: { verdict: "PASS", agree: true },
    });
    assert.equal(legitAero.verdict, "PASS");
    assert.equal(legitAero.memeOnly, false);

    const meme = {
      symbol: "FAKE",
      address: TOSHI_BASE,
      purchasable: true,
      fundamentals: 4,
      utility: { realUse: false, injectMain: false, noteUtility: false },
      frozen: false,
      disabled: false,
    };
    const legitMeme = evaluateTokenLegit(meme, {
      miss: false,
      trustedQuote: true,
      preferredDex: true,
      liquidityUsd: 2_000_000,
      volumeUsd24h: 80_000,
      dual: { verdict: "PASS", agree: true },
    });
    assert.equal(legitMeme.verdict, "FAIL");
    assert.equal(legitMeme.memeOnly, true);

    const seed = seedDustPlan(cat, { AERO: 1.5 }, {});
    assert.equal(seed.neverRemove, true);
    assert.ok(seed.held.some((r) => r.symbol === "AERO"));
    assert.ok(seed.missing.length >= 1);
    assert.equal(seed.simOnly, true);
  });

  it("market triggers never auto-spend and keep the nickel", () => {
    const cat = loadTokenCatalog();
    const link = cat.find((t) => t.symbol === "LINK");
    const trig = marketTriggerValues(link, { priceUsd: 20 }, {});
    assert.equal(trig.neverRemoveLogSeed, true);
    assert.equal(trig.logSeedUsd, 0.05);
    assert.equal(trig.gates.buttonsNeverAutoSpend, true);
    assert.ok(trig.options.some((o) => o.id === "autobuy" && o.spend === "sim-only"));
    assert.ok(trig.minBuyUsd > 0);
  });
});

describe("telegram + player commands", () => {
  it("parses /tokens /dex /legit /chains /tokenplayer", () => {
    assert.equal(parseTokenPlayerCommand("/tokens").action, "catalog");
    assert.equal(parseTokenClickCommand("/tok AERO").symbol, "AERO");
    assert.equal(parseTokenPlayerCommand("/dex LINK").action, "dex");
    assert.equal(parseTokenPlayerCommand("/legit UNI").action, "legit");
    assert.equal(parseTokenPlayerCommand("/chains").action, "chains");
    assert.equal(parseTokenPlayerCommand("/tokenplayer").action, "player");
  });

  it("catalog + token keyboards expose player popup, DEX, chains, ≤64B", async () => {
    const cat = buildTokenCatalogKeyboard(["AERO", "BRETT", "LINK"]);
    const cbs = allCallbacks(cat);
    assert.ok(cbs.includes("/tok AERO"));
    assert.ok(cbs.includes("/chains"));
    assert.ok(cbs.includes("/dex"));
    const urls = cat.inline_keyboard.flat().map((b) => b.url || b.web_app?.url || "").filter(Boolean);
    assert.ok(urls.some((u) => /token-player/.test(u)));
    for (const cb of cbs) assert.ok(!cb || cb.length <= 64, cb);

    const act = buildTokenActionKeyboard("AERO");
    const acb = allCallbacks(act);
    assert.ok(acb.includes("/dex AERO"));
    assert.ok(acb.includes("/legit AERO"));
    assert.ok(acb.includes("/buy AERO"));
    for (const cb of acb) assert.ok(!cb || cb.length <= 64, cb);

    const out = await handleTokenPlayerAction({ action: "chains", fetchLive: false });
    assert.equal(out.ok, true);
    assert.match(out.reply, /MULTICHAIN/);
    assert.equal(out.portfolio.otherPath.usd, 3);
  });

  it("public state includes ETH other-path and Base catalog", () => {
    const st = tokenPlayerPublicState({});
    assert.equal(st.ok, true);
    assert.equal(st.portfolio.chainCount, 32);
    const eth = st.tokens.find((t) => t.symbol === "ETH");
    assert.equal(eth.otherPath, true);
    assert.equal(eth.chainId, 1);
    assert.equal(eth.purchasable, false);
    assert.ok(st.tokens.some((t) => t.symbol === "AERO" && t.purchasable));
  });

  it("agent.js + webhook + HTML player are wired", () => {
    const agent = readFileSync(join(HERE, "..", "agent.js"), "utf8");
    assert.match(agent, /handleTokenPlayerAction/);
    assert.match(agent, /\/tokenplayer/);
    assert.match(agent, /\/chains/);
    const hook = readFileSync(join(HERE, "..", "vita-webhook.js"), "utf8");
    assert.match(hook, /token-player/);
    assert.match(hook, /dex-reader/);
    const html = readFileSync(join(HERE, "..", "public", "vita-token-player.html"), "utf8");
    assert.match(html, /tokenPick/);
    assert.match(html, /chainPick/);
    assert.match(html, /other-path/);
  });
});
