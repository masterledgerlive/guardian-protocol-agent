/**
 * VITA token player — pulldown navigator + DEX reader + market-trigger values.
 *
 * Telegram Mini App popup + HTTPS fallback (same pattern as KIDS player).
 * Dropdown walks every catalog token. Each seat shows:
 *   our DexScreener reader, dual Gecko check, 3rd-party refs,
 *   auto buy/sell/options the market triggers must use,
 *   $0.05 logging seed that is never sold.
 *
 * Legitimacy: not a meme with no use. Agents learn PASS/QUESTIONABLE/FAIL
 * from liquidity + trusted quote + fundamentals + dual 3rd-party agree.
 * Paid paths stay SIM / confirm|override — buttons never auto-spend.
 *
 * Mother brain untouched. Never invent tx hashes.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseDefaultTokensFromAgentSource,
} from "../board-control.js";
import { minBuyUsdForToken } from "../token-mins.js";
import {
  TOKEN_LOG_SEED_USD,
  piggyBankMinUsd,
  piggyBankPct,
  tokenLogSeedUsd,
} from "../piggy-bank.js";
import { CASCADE_LEAVE_DUST_USD } from "../cascade-rollover.js";
import { isValidEvmAddress, isValidUsdPrice } from "../price-oracle.js";
import { VERIFIED_HOME_ADDRESS, VERIFIED_HOME_SYMBOL } from "../operator-rotate.js";
import { FORMULA_ID, MAINFRAME_ANCHORS } from "./mainframe.js";
import { telegramCallbackData } from "./mirror-chain.js";
import { vitaPlayerHref } from "./url-dir.js";
import {
  DEX_READER_MAGIC,
  TOKEN_PLAYER_PATH,
  appendDexReaderLearn,
  dualCheckQuotes,
  formatDexReaderCard,
  readDexForToken,
  readDexSnapshotFromPairs,
  thirdPartyRefs,
} from "./dex-reader.js";
import {
  ETH_L1_OTHER_PATH,
  formatMultichainCard,
  listMultichainPortfolio,
  parseChainsCommand,
} from "./multichain-portfolio.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const AGENT_JS = join(ROOT, "agent.js");
const MEMORY_DIR = join(HERE, "memory");
const STRANDS_DIR = join(HERE, "strands");
const LEGIT_PATH = join(MEMORY_DIR, "token-legit-learn.json");

export const TOKEN_PLAYER_ID = "vita-token-player-v1";
export const TOKEN_PLAYER_MAGIC = "§VITATOKPLAY§";
export const TOKEN_PLAYER_LABEL = "TOKEN_PLAYER";
export const TOKEN_LEGIT_LABEL = "TOKEN_LEGIT";
export const TOKEN_LEGIT_MAGIC = "§VITALEGIT§";

export { TOKEN_PLAYER_PATH, TOKEN_LOG_SEED_USD, CASCADE_LEAVE_DUST_USD };

/** Market-trigger option ids the player exposes. Buttons never auto-spend. */
export const MARKET_TRIGGER_OPTIONS = Object.freeze([
  { id: "buy", label: "Buy", cmd: "/buy", spend: "confirm", sim: true },
  { id: "sell", label: "Sell", cmd: "/sell", spend: "confirm", sim: true },
  { id: "sellhalf", label: "Half", cmd: "/sellhalf", spend: "confirm", sim: true },
  { id: "exit", label: "Exit", cmd: "/exit", spend: "confirm", sim: true },
  { id: "piggy", label: "Piggy", cmd: "/piggyunlock", spend: "confirm", sim: true },
  { id: "dual", label: "Dual", cmd: "/vitafeed dual", spend: "confirm", sim: true },
  { id: "track", label: "Track", cmd: "/vitafeed track", spend: "confirm", sim: true },
  { id: "autobuy", label: "Auto-buy SIM", cmd: "/dex", spend: "sim-only", sim: true },
  { id: "autosell", label: "Auto-sell SIM", cmd: "/legit", spend: "sim-only", sim: true },
  { id: "seed", label: "Seed $0.05 SIM", cmd: "/tok", spend: "sim-only", sim: true },
]);

/** Fundamentals below this + no inject/utility = meme-only FAIL for new buys. */
export const MEME_FUNDAMENTALS_MAX = 5;
/** Trusted-book floors for a PASS new-buy. */
export const LEGIT_MIN_LIQ_USD = 100_000;
export const LEGIT_MIN_VOL_USD = 5_000;

function sha256Hex(text) {
  return createHash("sha256").update(String(text || ""), "utf8").digest("hex");
}

function normSym(s) {
  return String(s || "").trim().toUpperCase();
}

function clip(s, n = 140) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length <= n ? t : t.slice(0, n - 1) + "…";
}

function readAgentSource(agentSrc = null) {
  if (agentSrc != null) return String(agentSrc);
  return readFileSync(AGENT_JS, "utf8");
}

function utilitySignals(row) {
  const notes = String(row.notes || "").toLowerCase();
  const inject = row.injectMain === true;
  const fund = Number(row.fundamentals);
  const cb = Number(row.coinbaseFit);
  const words = [
    "protocol", "dex", "lending", "oracle", "infrastructure", "governance",
    "uniswap", "aerodrome", "chainlink", "yield", "creator", "agent",
  ];
  const noteHit = words.some((w) => notes.includes(w));
  return {
    injectMain: inject,
    fundamentals: Number.isFinite(fund) ? fund : null,
    coinbaseFit: Number.isFinite(cb) ? cb : null,
    noteUtility: noteHit,
    realUse: inject || noteHit || (Number.isFinite(fund) && fund >= 7),
  };
}

export function loadTokenCatalog({ agentSrc = null, env = process.env } = {}) {
  const src = readAgentSource(agentSrc);
  const rows = parseDefaultTokensFromAgentSource(src);
  return rows.map((row) => enrichCatalogRow(row, env));
}

export function enrichCatalogRow(row = {}, env = process.env) {
  const symbol = normSym(row.symbol);
  const address = row.address
    || (symbol === VERIFIED_HOME_SYMBOL ? VERIFIED_HOME_ADDRESS : null);
  const piggyPct = piggyBankPct(env, { symbol, piggyBankPct: row.piggyBankPct });
  const piggyMinUsd = piggyBankMinUsd(env, { symbol, piggyBankMinUsd: row.piggyBankMinUsd });
  const minBuy = minBuyUsdForToken(
    row.minBuyUsd != null ? row : symbol,
    env,
  );
  const seedUsd = tokenLogSeedUsd(env);
  const util = utilitySignals(row);
  const frozen = row.frozen === true;
  const disabled = row.disabled === true;
  const purchasable = !frozen && !disabled && !row.noBasePool && !row.brokenQuote
    && isValidEvmAddress(address);
  return {
    symbol,
    address: address || null,
    feeTier: row.feeTier,
    poolFeePct: row.poolFeePct,
    injectMain: row.injectMain === true,
    frozen,
    disabled,
    noBasePool: row.noBasePool === true,
    brokenQuote: row.brokenQuote === true,
    frozenReason: row.frozenReason || "",
    disabledReason: row.disabledReason || "",
    notes: row.notes || "",
    scoreTotal: row.scoreTotal,
    fundamentals: row.fundamentals,
    liquidityScore: row.liquidityScore,
    coinbaseFit: row.coinbaseFit,
    community: row.community,
    minBuyUsd: minBuy,
    minNetMargin: row.minNetMargin,
    piggyPct,
    piggyMinUsd,
    logSeedUsd: seedUsd,
    cascadeLeaveDustUsd: CASCADE_LEAVE_DUST_USD,
    neverRemoveLogSeed: true,
    purchasable,
    utility: util,
    refs: thirdPartyRefs({ ...row, symbol, address }),
  };
}

export function findCatalogToken(symbol, { catalog = null, agentSrc = null, env = process.env } = {}) {
  const list = catalog || loadTokenCatalog({ agentSrc, env });
  const sym = normSym(symbol);
  return list.find((t) => t.symbol === sym) || null;
}

/**
 * Values market triggers (auto buy/sell/options) MUST read from the player.
 * Buttons stay SIM — live spend is confirm|override in Telegram.
 */
export function marketTriggerValues(token = {}, dex = null, env = process.env) {
  const seedUsd = tokenLogSeedUsd(env);
  const bagUsd = isValidUsdPrice(dex?.priceUsd) && Number(token.bagTokens) > 0
    ? dex.priceUsd * Number(token.bagTokens)
    : null;
  const seedMissing = bagUsd == null ? true : bagUsd + 1e-12 < seedUsd;
  const legit = token.legit || null;
  const allowNewBuy = token.purchasable === true
    && (!legit || legit.verdict === "PASS")
    && token.frozen !== true
    && token.disabled !== true;
  return {
    symbol: token.symbol,
    minBuyUsd: token.minBuyUsd,
    logSeedUsd: seedUsd,
    neverRemoveLogSeed: true,
    piggyPct: token.piggyPct,
    piggyMinUsd: token.piggyMinUsd,
    cascadeLeaveDustUsd: CASCADE_LEAVE_DUST_USD,
    feeTier: token.feeTier,
    poolFeePct: token.poolFeePct,
    minNetMargin: token.minNetMargin,
    allowNewBuy,
    allowSell: token.disabled !== true,
    seedMissing,
    seedPlanUsd: seedMissing ? seedUsd : 0,
    options: MARKET_TRIGGER_OPTIONS.map((o) => ({
      ...o,
      cmd: o.cmd + (token.symbol ? " " + token.symbol : ""),
    })),
    gates: {
      loseZero: true,
      alwaysPlusExit: true,
      hitchOnlyWhenCovered: true,
      buttonsNeverAutoSpend: true,
      confirmOverride: true,
      noInventedPnl: true,
    },
  };
}

/**
 * Real legitimacy — dual DexScreener ↔ Gecko + catalog fundamentals.
 * Meme-only (low fundamentals, no protocol use, no inject main) fails new buys.
 */
export function evaluateTokenLegit(token = {}, dex = null) {
  const flags = [];
  const green = [];
  let verdict = "PASS";

  if (!isValidEvmAddress(token.address)) {
    flags.push("no verified Base address");
    verdict = "FAIL";
  }
  if (token.brokenQuote) {
    flags.push("broken quote — address is the wrong token");
    verdict = "FAIL";
  }
  if (token.noBasePool) {
    flags.push("no Base pool — DexScreener miss");
    verdict = "FAIL";
  }
  if (token.disabled) {
    flags.push(token.disabledReason || "disabled");
    verdict = "FAIL";
  }
  if (dex?.ghost) {
    flags.push("ghost pair (mega-liq / zero vol)");
    verdict = "FAIL";
  }
  if (dex?.miss && token.purchasable) {
    flags.push("DEX reader miss — will not invent a quote");
    if (verdict !== "FAIL") verdict = "QUESTIONABLE";
  }

  if (token.frozen) {
    flags.push(token.frozenReason || "frozen exits-only");
    if (verdict === "PASS") verdict = "QUESTIONABLE";
  }

  const fund = Number(token.fundamentals);
  const util = token.utility || utilitySignals(token);
  if (Number.isFinite(fund) && fund <= MEME_FUNDAMENTALS_MAX && !util.realUse) {
    flags.push("meme-only — fundamentals " + fund + " / no protocol use");
    if (verdict !== "FAIL") verdict = "FAIL";
  } else if (util.realUse) {
    green.push(util.injectMain ? "inject main" : "real-use notes/fundamentals");
  }

  if (dex && !dex.miss) {
    if (dex.trustedQuote) green.push("trusted WETH|USDC quote");
    else flags.push("quote is not WETH|USDC");
    if (dex.preferredDex) green.push("Uni/Aero book");
    const liq = Number(dex.liquidityUsd) || 0;
    const vol = Number(dex.volumeUsd24h) || 0;
    if (liq > 0 && liq < LEGIT_MIN_LIQ_USD) {
      flags.push("thin liq $" + Math.round(liq));
      if (verdict === "PASS") verdict = "QUESTIONABLE";
    } else if (liq >= LEGIT_MIN_LIQ_USD) {
      green.push("liq ≥ $" + LEGIT_MIN_LIQ_USD);
    }
    if (vol > 0 && vol < LEGIT_MIN_VOL_USD) {
      flags.push("thin 24h vol $" + Math.round(vol));
      if (verdict === "PASS") verdict = "QUESTIONABLE";
    }
    if (dex.dual) {
      if (dex.dual.verdict === "FAIL") verdict = "FAIL";
      else if (dex.dual.verdict === "QUESTIONABLE" && verdict === "PASS") {
        verdict = "QUESTIONABLE";
      }
      if (dex.dual.agree) green.push("DexScreener ↔ Gecko agree");
      else if (dex.dual.reason) flags.push("dual: " + clip(dex.dual.reason, 72));
    }
  }

  if (token.purchasable && verdict === "PASS") green.push("catalog purchasable");

  return {
    symbol: token.symbol,
    verdict,
    flags,
    green,
    memeOnly: Number.isFinite(fund) && fund <= MEME_FUNDAMENTALS_MAX && !util.realUse,
    dual: dex?.dual || dualCheckQuotes({}),
    refs: token.refs || thirdPartyRefs(token),
    learn: "agents must re-check 3rd-party refs before promoting a seat",
  };
}

export function formatLegitCard(legit = {}) {
  const lines = [
    TOKEN_LEGIT_MAGIC + "v1|legit=" + (legit.symbol || "?") + "§",
    "⚖️ LEGIT — " + (legit.symbol || "?") + "  " + (legit.verdict || "?"),
    "━━━━━━━━━━━━━━━━━━━━",
  ];
  for (const g of legit.green || []) lines.push("✅ " + g);
  for (const f of legit.flags || []) lines.push("🚩 " + f);
  if (!(legit.green || []).length && !(legit.flags || []).length) {
    lines.push("(catalog-only — run live DEX for dual check)");
  }
  lines.push("Meme-only new buys: FAIL. Dual = DexScreener + Gecko + Basescan.");
  return lines.join("\n");
}

export function seedDustPlan(catalog = [], bags = {}, env = process.env) {
  const seedUsd = tokenLogSeedUsd(env);
  const missing = [];
  const held = [];
  for (const t of catalog) {
    if (!t.purchasable) continue;
    const bagUsd = Number(bags[t.symbol]);
    const has = Number.isFinite(bagUsd) && bagUsd + 1e-12 >= seedUsd;
    const row = {
      symbol: t.symbol,
      address: t.address,
      seedUsd,
      bagUsd: Number.isFinite(bagUsd) ? bagUsd : 0,
      hasSeed: has,
      buyUsd: has ? 0 : seedUsd,
    };
    if (has) held.push(row);
    else missing.push(row);
  }
  return {
    seedUsd,
    neverRemove: true,
    purchasable: catalog.filter((t) => t.purchasable).map((t) => t.symbol),
    missing,
    held,
    simOnly: true,
    otherPathEthUsd: listMultichainPortfolio().otherPath.usd,
    note: "SIM — confirm|override to buy $0.05 seed. ETH L1 $3 may fund other-path seed SIM, never Base SwapRouter02. Never auto-spend. Never sell the nickel.",
  };
}

export function tokenPlayerHref(symbol = "", { popup = true, env = process.env } = {}) {
  const sym = normSym(symbol);
  let path = TOKEN_PLAYER_PATH;
  if (sym) path += "?sym=" + encodeURIComponent(sym);
  return vitaPlayerHref(path, { popup, env });
}

export function buildTokenPlayerPopupKeyboard(symbol = "") {
  const href = tokenPlayerHref(symbol);
  const btn = (text, cmd) => ({ text: String(text).slice(0, 64), callback_data: telegramCallbackData(cmd) });
  const urlBtn = (text, u) => ({ text: String(text).slice(0, 64), url: String(u) });
  const webAppBtn = (text, u) => ({ text: String(text).slice(0, 64), web_app: { url: String(u) } });
  const rows = [
    [webAppBtn("▶ Token popup", href), urlBtn("↗ Open player", href)],
  ];
  const sym = normSym(symbol);
  if (sym) {
    rows.push([
      btn("📡 DEX " + sym, "/dex " + sym),
      btn("⚖️ Legit", "/legit " + sym),
      btn("🪙 " + sym, "/tok " + sym),
    ]);
  }
  rows.push([
    btn("🪙 Tokens", "/tokens"),
    btn("🗺 Chains", "/chains"),
    btn("🏠 HOME", "/home"),
  ]);
  return { inline_keyboard: rows };
}

export function formatTokenPlayerCard(token = {}, { dex = null, legit = null, bagUsd = null } = {}) {
  const sym = token.symbol || "?";
  const seed = token.logSeedUsd ?? TOKEN_LOG_SEED_USD;
  const bag = Number(bagUsd);
  const hasSeed = Number.isFinite(bag) && bag + 1e-12 >= seed;
  const trig = marketTriggerValues({ ...token, legit }, dex);
  const lines = [
    TOKEN_PLAYER_MAGIC + "v1|tok=" + sym + "§",
    "🎬 TOKEN PLAYER — " + sym,
    "━━━━━━━━━━━━━━━━━━━━",
    token.purchasable ? "Seat: purchasable" : "Seat: " + (token.frozen ? "frozen" : token.disabled ? "disabled" : "data"),
    "Min buy: $" + Number(token.minBuyUsd || 0).toFixed(2),
    "Piggy: " + Math.round((token.piggyPct || 0) * 100) + "% / $" + Number(token.piggyMinUsd || 0).toFixed(2),
    "Log seed: $" + seed.toFixed(2) + " NEVER REMOVE" + (hasSeed ? " · held" : " · MISSING (SIM $0.05 buy)"),
    legit ? "Legit: " + legit.verdict : "Legit: run /legit " + sym,
  ];
  if (token.notes) lines.push(clip(token.notes, 120));
  lines.push("Triggers: " + trig.options.map((o) => o.id).join(" · "));
  lines.push("Player: " + tokenPlayerHref(sym));
  return lines.join("\n");
}

export function formatTokenCatalogCard(catalog = [], { seed = null } = {}) {
  const buy = catalog.filter((t) => t.purchasable);
  const rest = catalog.filter((t) => !t.purchasable);
  const lines = [
    TOKEN_PLAYER_MAGIC + "v1|tokens§",
    "🪙 TOKEN CATALOG — tap a symbol · pop-out player",
    "Purchasable (" + buy.length + "): " + buy.map((t) => t.symbol).join(" · "),
  ];
  if (rest.length) {
    lines.push("Frozen/data (" + rest.length + "): " + rest.slice(0, 18).map((t) => t.symbol).join(" · "));
  }
  if (seed) {
    lines.push(
      "Seed $0.05: missing " + seed.missing.length + " · held " + seed.held.length + " · never remove",
    );
  }
  lines.push("ETH L1 other-path ~$3 (27%) — not Base RISK · empty 30 chains are seats");
  lines.push("Tap → DEX reader · legit · buy/sell/options · player pulldown");
  return lines.join("\n");
}

export function parseTokenPlayerCommand(raw) {
  const src = String(raw || "").trim();
  const low = src.toLowerCase();
  if (low === "/tokens" || low === "/tok" || low === "/token") {
    return { ok: true, action: "catalog" };
  }
  if (low === "/tokenplayer" || low === "/tokplay" || low === "/player tokens") {
    return { ok: true, action: "player" };
  }
  if (low.startsWith("/tokenplayer ") || low.startsWith("/tokplay ")) {
    const sym = src.split(/\s+/)[1]?.toUpperCase() || "";
    return { ok: true, action: "player", symbol: sym };
  }
  if (low === "/dex" || low === "/dexreader") {
    return { ok: true, action: "dex-catalog" };
  }
  if (low.startsWith("/dex ") || low.startsWith("/dexreader ")) {
    const sym = src.split(/\s+/)[1]?.toUpperCase() || "";
    return { ok: true, action: "dex", symbol: sym };
  }
  if (low === "/legit" || low === "/tokenlegit") {
    return { ok: true, action: "legit-catalog" };
  }
  if (low.startsWith("/legit ") || low.startsWith("/tokenlegit ")) {
    const sym = src.split(/\s+/)[1]?.toUpperCase() || "";
    return { ok: true, action: "legit", symbol: sym };
  }
  if (low.startsWith("/tok ") || low.startsWith("/token ")) {
    const sym = src.replace(/^\/tok(?:en)?\s+/i, "").trim().split(/\s+/)[0]?.toUpperCase() || "";
    if (!sym) return { ok: true, action: "catalog" };
    return { ok: true, action: "token", symbol: sym };
  }
  const chains = parseChainsCommand(src);
  if (chains.ok) return chains;
  return { ok: false, action: null };
}

export function appendLegitLearn(legit = {}) {
  try {
    mkdirSync(MEMORY_DIR, { recursive: true });
    mkdirSync(STRANDS_DIR, { recursive: true });
    let cur = { id: TOKEN_PLAYER_ID, events: [] };
    if (existsSync(LEGIT_PATH)) {
      cur = JSON.parse(readFileSync(LEGIT_PATH, "utf8"));
      if (!Array.isArray(cur.events)) cur.events = [];
    }
    const row = {
      at: new Date().toISOString(),
      formula: FORMULA_ID,
      symbol: legit.symbol,
      verdict: legit.verdict,
      memeOnly: legit.memeOnly === true,
      flags: legit.flags || [],
      green: legit.green || [],
      commit: sha256Hex(JSON.stringify({
        s: legit.symbol,
        v: legit.verdict,
        f: legit.flags,
      })),
    };
    cur.events.push(row);
    if (cur.events.length > 400) cur.events = cur.events.slice(-400);
    cur.last = row;
    writeFileSync(LEGIT_PATH, JSON.stringify(cur, null, 2) + "\n");
    return row;
  } catch {
    return null;
  }
}

/**
 * Public JSON for the HTML player pulldown. Live DEX is optional.
 */
export async function handleTokenPlayerAction({
  action = "catalog",
  symbol = "",
  bags = {},
  fetchLive = false,
  agentSrc = null,
  env = process.env,
} = {}) {
  const catalog = loadTokenCatalog({ agentSrc, env });
  const seed = seedDustPlan(catalog, bags, env);
  const act = String(action || "catalog");
  const port = listMultichainPortfolio();

  if (act === "chains" || act === "other-path") {
    return {
      ok: true,
      action: act,
      reply: formatMultichainCard(port),
      html: "<pre>" + escPre(formatMultichainCard(port)) + "</pre>",
      keyboard: buildTokenPlayerPopupKeyboard(act === "other-path" ? "ETH" : ""),
      portfolio: port,
    };
  }

  if (act === "player" || act === "dex-catalog" || act === "legit-catalog" || act === "catalog") {
    const reply = formatTokenCatalogCard(catalog, { seed });
    return {
      ok: true,
      action: act,
      reply,
      html: "<pre>" + escPre(reply) + "</pre>",
      keyboard: buildTokenPlayerPopupKeyboard(""),
      symbols: catalog.map((t) => t.symbol),
      seed,
      portfolio: port,
    };
  }

  const sym = normSym(symbol);
  if (sym === "ETH") {
    const reply = [
      TOKEN_PLAYER_MAGIC + "v1|tok=ETH§",
      "◇ ETH L1 OTHER PATH — ~$" + Number(port.otherPath.usd).toFixed(2) + " (27%)",
      "Untouched by Base SwapRouter02 hitch path.",
      "Available: ETH DEX reader · $0.05 seed SIM · confirm|override",
      "Never mix into Base RISK. Vault never. Buttons never auto-spend.",
    ].join("\n");
    return {
      ok: true,
      action: act,
      symbol: "ETH",
      reply,
      html: "<pre>" + escPre(reply) + "</pre>",
      keyboard: buildTokenPlayerPopupKeyboard("ETH"),
      portfolio: port,
    };
  }

  const token = catalog.find((t) => t.symbol === sym);
  if (!token) {
    return {
      ok: false,
      action: act,
      symbol: sym,
      reply: "Unknown token " + sym + " — tap a catalog seat.",
      html: "<pre>Unknown token " + escPre(sym) + "</pre>",
      keyboard: buildTokenPlayerPopupKeyboard(""),
    };
  }

  let dex = null;
  if (fetchLive || act === "dex" || act === "legit") {
    dex = await readDexForToken(token, { fetchLive: true });
    appendDexReaderLearn({ ...dex, verdict: dex?.dual?.verdict });
  }
  const legit = evaluateTokenLegit(token, dex);
  if (act === "legit") appendLegitLearn(legit);
  const bagUsd = bags[sym];
  const playerCard = formatTokenPlayerCard(token, { dex, legit, bagUsd });
  const dexCard = dex ? formatDexReaderCard(dex) : "";
  const legitCard = formatLegitCard(legit);
  let reply = playerCard;
  if (act === "dex") reply = dexCard + "\n\n" + playerCard;
  if (act === "legit") reply = legitCard + "\n\n" + playerCard;
  return {
    ok: true,
    action: act,
    symbol: sym,
    reply,
    html: "<pre>" + escPre(reply) + "</pre>",
    keyboard: buildTokenPlayerPopupKeyboard(sym),
    token,
    dex,
    legit,
    seed,
  };
}

function escPre(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function tokenPlayerPublicState({
  symbol = "",
  catalog = null,
  dexBySymbol = {},
  bags = {},
  env = process.env,
  agentSrc = null,
} = {}) {
  const list = catalog || loadTokenCatalog({ agentSrc, env });
  const seed = seedDustPlan(list, bags, env);
  const items = list.map((t) => {
    const dex = dexBySymbol[t.symbol] || null;
    const legit = evaluateTokenLegit(t, dex);
    const bagUsd = bags[t.symbol];
    return {
      symbol: t.symbol,
      address: t.address,
      purchasable: t.purchasable,
      frozen: t.frozen,
      disabled: t.disabled,
      injectMain: t.injectMain,
      notes: t.notes,
      scoreTotal: t.scoreTotal,
      fundamentals: t.fundamentals,
      minBuyUsd: t.minBuyUsd,
      piggyPct: t.piggyPct,
      piggyMinUsd: t.piggyMinUsd,
      logSeedUsd: t.logSeedUsd,
      feeTier: t.feeTier,
      refs: t.refs,
      triggers: marketTriggerValues({ ...t, legit, bagTokens: undefined }, dex, env),
      legit,
      dex: dex
        ? {
            priceUsd: dex.priceUsd,
            liquidityUsd: dex.liquidityUsd,
            volumeUsd24h: dex.volumeUsd24h,
            dexId: dex.dexId,
            pairAddress: dex.pairAddress,
            dual: dex.dual,
            miss: dex.miss,
          }
        : null,
      bagUsd: Number.isFinite(Number(bagUsd)) ? Number(bagUsd) : null,
      chain: "base",
      chainId: 8453,
    };
  });
  const port = listMultichainPortfolio();
  const ethPath = port.otherPath;
  items.unshift({
    symbol: "ETH",
    address: ETH_L1_OTHER_PATH.weth,
    purchasable: false,
    frozen: false,
    disabled: false,
    injectMain: false,
    notes: "Ethereum L1 native — other path. ~$" + Number(ethPath.usd || 0).toFixed(2) +
      " (27%) untouched by Base SwapRouter02. Available for ETH DEX reader / $0.05 seed SIM / confirm|override. Never mix into Base RISK. Vault never.",
    scoreTotal: 50,
    fundamentals: 10,
    minBuyUsd: 0.05,
    piggyPct: 0,
    piggyMinUsd: 0,
    logSeedUsd: tokenLogSeedUsd(env),
    feeTier: null,
    refs: {
      basescanToken: "https://etherscan.io/address/" + MAINFRAME_ANCHORS.wallet,
      dexscreener: "https://dexscreener.com/ethereum/" + ETH_L1_OTHER_PATH.weth,
      geckoterminal: "https://www.geckoterminal.com/eth/tokens/" + ETH_L1_OTHER_PATH.weth.toLowerCase(),
      coingecko: "https://www.coingecko.com/en/coins/ethereum",
    },
    triggers: {
      symbol: "ETH",
      allowNewBuy: false,
      allowSell: false,
      otherPath: true,
      mixIntoBaseRisk: false,
      seedPlanUsd: TOKEN_LOG_SEED_USD,
      options: MARKET_TRIGGER_OPTIONS.filter((o) => o.spend === "sim-only"),
      gates: { buttonsNeverAutoSpend: true, confirmOverride: true, neverMixIntoBaseSwapRouter: true },
    },
    legit: {
      symbol: "ETH",
      verdict: "PASS",
      flags: [],
      green: ["native ETH", "other-path available", "not a meme"],
      memeOnly: false,
    },
    dex: {
      priceUsd: null,
      miss: true,
      dual: null,
      note: "ETH L1 other-path — live Base DexScreener does not mark L1 native",
    },
    bagUsd: ethPath.usd,
    chain: "ethereum",
    chainId: 1,
    otherPath: true,
  });
  const sym = normSym(symbol);
  const current = items.find((t) => t.symbol === sym) || items.find((t) => t.purchasable) || items[0] || null;
  return {
    ok: true,
    id: TOKEN_PLAYER_ID,
    magic: TOKEN_PLAYER_MAGIC,
    formula: FORMULA_ID,
    neverInventHashes: true,
    wallet: MAINFRAME_ANCHORS.wallet,
    chain: "base",
    chainId: 8453,
    playerPath: TOKEN_PLAYER_PATH,
    logSeedUsd: tokenLogSeedUsd(env),
    seed,
    portfolio: port,
    current: current?.symbol || null,
    tokens: items,
  };
}

export {
  DEX_READER_MAGIC,
  formatDexReaderCard,
  formatMultichainCard,
  listMultichainPortfolio,
  readDexSnapshotFromPairs,
  thirdPartyRefs,
};
