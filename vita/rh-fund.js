/**
 * Robinhood → Base dual fund ($HOME + AERO).
 *
 * Telegram: /rh · /rh fund CHIP · /rh confirm CHIP
 * Tap a chosen RH source → stage sell ~$2 on Agentic RH → Base
 * destinations $1 HOME + $1 AERO (queues /buy HOME 1 · /buy AERO 1).
 *
 * Robinhood MCP has no withdraw/bridge. RH side = sell source + optional
 * AERO/ETH hold. Base side = RISK /buy (Slipstream HOME, Uni V3 AERO).
 * Never invents tx hashes. Mother brain untouched.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ROBINHOOD_QUOTE_MIRROR } from "./wave-agent-bank.js";
import { telegramCallbackData, CALLBACK_DATA_MAX } from "./mirror-chain.js";
import { VERIFIED_HOME_SYMBOL } from "../operator-rotate.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const MEMORY_DIR = join(HERE, "memory");
const STRANDS_DIR = join(HERE, "strands");
const LEARN_PATH = join(MEMORY_DIR, "rh-fund-learn.json");
const LEDGER_PATH = join(MEMORY_DIR, "rh-fund-ledger.json");
const STRAND_PATH = join(STRANDS_DIR, "rh-fund.json");

export const RH_FUND_ID = "vita-rh-fund-v1";
export const RH_FUND_MAGIC = "§RHFUND§";
export const RH_FUND_LABEL = "RH_FUND";

/** Default notional: $2 source → $1 HOME + $1 AERO on Base. */
export const RH_FUND_USD = 2;
export const RH_DEST_USD = 1;
export const RH_DEST_SYMBOLS = Object.freeze([VERIFIED_HOME_SYMBOL, "AERO"]);

/**
 * Chosen RH sources — mirror pairs + CHIP (USD.AI) held on Agentic.
 * HOME is Base-only (defi.app); never list as an RH buy pair.
 */
export const RH_CHOSEN_SOURCES = Object.freeze([
  { symbol: "CHIP", pair: "CHIP-USD", note: "USD.AI — Agentic RH holding" },
  ...ROBINHOOD_QUOTE_MIRROR.filter((r) => r.sameToken && r.symbol !== "USDC").map((r) => ({
    symbol: r.symbol,
    pair: r.pair,
    note: r.note || "Robinhood quote mirror",
  })),
]);

const SOURCE_BY_SYM = new Map(RH_CHOSEN_SOURCES.map((r) => [r.symbol, r]));

function normSym(s) {
  return String(s || "").trim().toUpperCase();
}

function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function btn(text, cmd) {
  return { text: String(text).slice(0, 64), callback_data: telegramCallbackData(cmd) };
}

function rowsOf(buttons, perRow = 3) {
  const rows = [];
  const list = Array.isArray(buttons) ? buttons.filter(Boolean) : [];
  for (let i = 0; i < list.length; i += perRow) {
    rows.push(list.slice(i, i + perRow));
  }
  return rows;
}

function ensureDir(p) {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

function readJson(path, fallback) {
  try {
    if (!existsSync(path)) return fallback;
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(path, data) {
  ensureDir(dirname(path));
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

export function rhSourceOf(symbol) {
  return SOURCE_BY_SYM.get(normSym(symbol)) || null;
}

export function listRhFundSources() {
  return RH_CHOSEN_SOURCES.slice();
}

/**
 * Plan: sell ~usd of source on RH Agentic → Base $1 HOME + $1 AERO.
 */
export function planRhFund({ source, usd = RH_FUND_USD, destUsd = RH_DEST_USD } = {}) {
  const src = rhSourceOf(source) || (source ? { symbol: normSym(source), pair: normSym(source) + "-USD", note: "ad-hoc" } : null);
  if (!src?.symbol) {
    return { ok: false, error: "missing_source" };
  }
  const sellUsd = Math.max(0.5, Number(usd) || RH_FUND_USD);
  const each = Math.max(0.5, Number(destUsd) || RH_DEST_USD);
  const destinations = RH_DEST_SYMBOLS.map((symbol) => ({
    symbol,
    usd: each,
    chain: "base",
    telegramBuy: `/buy ${symbol} ${each}`,
  }));
  return {
    ok: true,
    source: src,
    sellUsd,
    destinations,
    totalDestUsd: destinations.reduce((a, d) => a + d.usd, 0),
    rhNote:
      "Robinhood agentic MCP can sell/buy pairs. It cannot withdraw or bridge to Base. " +
      "AERO may sit on RH; $HOME is Base-only (Slipstream). Base /buy needs RISK ETH.",
  };
}

export function formatRhFundRootCard() {
  const lines = [];
  lines.push(RH_FUND_MAGIC + "v1|root§");
  lines.push("📱 RH → Base fund");
  lines.push("━━━━━━━━━━━━━━━━━━━━");
  lines.push(`Sell ~$${RH_FUND_USD} of a chosen Robinhood token →`);
  lines.push(`$${RH_DEST_USD} ${VERIFIED_HOME_SYMBOL} + $${RH_DEST_USD} AERO on Base.`);
  lines.push("");
  lines.push("Tap a source. Confirm queues Base /buy only.");
  lines.push("RH sell still needs Agentic MCP / app (no withdraw tool).");
  lines.push("Never invents hashes. HOME never-sell stays on.");
  return lines.join("\n");
}

export function formatRhFundPlanCard(plan) {
  if (!plan?.ok) return "❓ Unknown RH source. /rh";
  const lines = [];
  lines.push(RH_FUND_MAGIC + `v1|fund=${plan.source.symbol}§`);
  lines.push(`📱 RH fund · ${plan.source.symbol}`);
  lines.push("━━━━━━━━━━━━━━━━━━━━");
  lines.push(`Source: ${plan.source.symbol} (${plan.source.pair})`);
  if (plan.source.note) lines.push(esc(plan.source.note));
  lines.push(`Sell ≈ $${plan.sellUsd.toFixed(2)} on Robinhood Agentic`);
  lines.push("Destinations (Base RISK):");
  for (const d of plan.destinations) {
    lines.push(`  · $${d.usd.toFixed(2)} ${d.symbol} → ${d.telegramBuy}`);
  }
  lines.push("");
  lines.push(esc(plan.rhNote));
  lines.push("Tap Confirm to queue Base buys + file the RH sell plan.");
  return lines.join("\n");
}

export function buildRhFundRootKeyboard() {
  const srcBtns = RH_CHOSEN_SOURCES.map((s) =>
    btn(s.symbol, `/rh fund ${s.symbol}`),
  );
  const rows = rowsOf(srcBtns, 3);
  rows.push([
    btn("🏠 HOME", "/home"),
    btn("📱 Trade", "/home trade"),
    btn("◀ Help", "/help trade"),
  ]);
  return { inline_keyboard: rows };
}

export function buildRhFundPlanKeyboard(source) {
  const sym = normSym(source);
  return {
    inline_keyboard: [
      [
        btn("✅ Confirm Base buys", `/rh confirm ${sym}`),
        btn("↩ Sources", "/rh"),
      ],
      [
        btn(`Buy ${VERIFIED_HOME_SYMBOL} $1`, `/buy ${VERIFIED_HOME_SYMBOL} 1`),
        btn("Buy AERO $1", "/buy AERO 1"),
      ],
      [
        btn("🏠 HOME", "/home"),
        btn("📱 Trade", "/home trade"),
      ],
    ],
  };
}

export function buildRhFundDoneKeyboard() {
  return {
    inline_keyboard: [
      [
        btn(`Buy ${VERIFIED_HOME_SYMBOL} $1`, `/buy ${VERIFIED_HOME_SYMBOL} 1`),
        btn("Buy AERO $1", "/buy AERO 1"),
      ],
      [
        btn("↩ RH fund", "/rh"),
        btn("🏠 HOME", "/home"),
      ],
    ],
  };
}

/**
 * Append-only learn + ledger for a confirm.
 */
export function fileRhFundConfirm(plan, { at = new Date().toISOString() } = {}) {
  if (!plan?.ok) return { ok: false };
  const entry = {
    at,
    source: plan.source.symbol,
    pair: plan.source.pair,
    sellUsd: plan.sellUsd,
    destinations: plan.destinations.map((d) => ({
      symbol: d.symbol,
      usd: d.usd,
      telegramBuy: d.telegramBuy,
    })),
    rhWithdraw: false,
    note: "Base /buy queued; RH sell is agentic/app. No invented hashes.",
  };

  const ledger = readJson(LEDGER_PATH, { id: RH_FUND_ID, filingLabel: RH_FUND_LABEL, entries: [] });
  ledger.entries.push(entry);
  writeJson(LEDGER_PATH, ledger);

  const learn = readJson(LEARN_PATH, { id: "rh-fund-learn-v1", filingLabel: RH_FUND_LABEL, notes: [] });
  learn.notes.push({
    at,
    topic: "rh-fund-confirm",
    text:
      `RH fund confirm ${plan.source.symbol} ≈$${plan.sellUsd} → ` +
      plan.destinations.map((d) => `$${d.usd} ${d.symbol}`).join(" + ") +
      ". MCP cannot withdraw RH→Base. Base RISK /buy needs ETH. HOME never-sell.",
    locations: [],
  });
  writeJson(LEARN_PATH, learn);

  writeJson(STRAND_PATH, {
    id: RH_FUND_ID,
    filingLabel: RH_FUND_LABEL,
    magic: RH_FUND_MAGIC,
    at,
    last: entry,
    learn:
      "Telegram /rh picks a chosen Robinhood source. Confirm queues Base $1 HOME + $1 AERO. " +
      "RH sell stays Agentic MCP/app. Never invent hashes. Never sell HOME.",
  });

  return { ok: true, entry };
}

export function parseRhFundCommand(raw) {
  const src = String(raw || "").trim();
  const low = src.toLowerCase();
  if (low === "/rh" || low === "/rhfund" || low === "/robinhood") {
    return { ok: true, action: "root" };
  }
  if (low.startsWith("/rh fund ") || low.startsWith("/rhfund ")) {
    const rest = src.replace(/^\/rh\s*fund\s+/i, "").trim();
    const sym = rest.split(/\s+/)[0] || "";
    return { ok: true, action: "fund", source: normSym(sym) };
  }
  if (low.startsWith("/rh confirm ") || low.startsWith("/rhconfirm ")) {
    const rest = src.replace(/^\/rh\s*confirm\s+/i, "").replace(/^\/rhconfirm\s+/i, "").trim();
    const sym = rest.split(/\s+/)[0] || "";
    return { ok: true, action: "confirm", source: normSym(sym) };
  }
  if (low.startsWith("/rh ")) {
    const rest = src.slice(4).trim();
    const [verb, ...more] = rest.split(/\s+/);
    const v = String(verb || "").toLowerCase();
    if (v === "fund" || v === "pick") {
      return { ok: true, action: "fund", source: normSym(more[0] || "") };
    }
    if (v === "confirm" || v === "go" || v === "yes") {
      return { ok: true, action: "confirm", source: normSym(more[0] || "") };
    }
    if (v === "help") return { ok: true, action: "root" };
    // bare /rh SYMBOL → fund plan
    if (verb && !more.length) return { ok: true, action: "fund", source: normSym(verb) };
  }
  return { ok: false };
}

/**
 * Handle /rh actions. Confirm returns queueBuys for agent.js to enqueue.
 */
export function handleRhFundAction({ action = "root", source = "" } = {}) {
  if (action === "root") {
    return {
      ok: true,
      reply: formatRhFundRootCard(),
      html: `<pre>${esc(formatRhFundRootCard())}</pre>`,
      keyboard: buildRhFundRootKeyboard(),
    };
  }

  if (action === "fund") {
    const plan = planRhFund({ source });
    if (!plan.ok) {
      return {
        ok: false,
        reply: "❓ Unknown RH source. Tap /rh for the chosen list.",
        html: "❓ Unknown RH source. Tap /rh for the chosen list.",
        keyboard: buildRhFundRootKeyboard(),
      };
    }
    const card = formatRhFundPlanCard(plan);
    return {
      ok: true,
      plan,
      reply: card,
      html: `<pre>${esc(card)}</pre>`,
      keyboard: buildRhFundPlanKeyboard(plan.source.symbol),
    };
  }

  if (action === "confirm") {
    const plan = planRhFund({ source });
    if (!plan.ok) {
      return {
        ok: false,
        reply: "❓ Unknown RH source. /rh",
        html: "❓ Unknown RH source. /rh",
        keyboard: buildRhFundRootKeyboard(),
      };
    }
    const filed = fileRhFundConfirm(plan);
    const lines = [
      RH_FUND_MAGIC + `v1|confirm=${plan.source.symbol}§`,
      `✅ Base buys queued · RH plan filed`,
      `Source sell (RH Agentic/app): ≈$${plan.sellUsd} ${plan.source.symbol}`,
      ...plan.destinations.map((d) => `Base: ${d.telegramBuy}`),
      "RH cannot auto-withdraw to Base via MCP.",
      "If RISK ETH is thin, top up Base first — then re-tap buys.",
      "No invented hashes.",
    ];
    const reply = lines.join("\n");
    return {
      ok: true,
      plan,
      filed,
      queueBuys: plan.destinations.map((d) => ({
        symbol: d.symbol,
        action: "buy",
        usd: d.usd,
        source: "RH_FUND",
      })),
      reply,
      html: `<pre>${esc(reply)}</pre>`,
      keyboard: buildRhFundDoneKeyboard(),
    };
  }

  return handleRhFundAction({ action: "root" });
}

/** Callback-length guard for /rh fund SYM buttons. */
export function assertRhFundCallbacksFit() {
  const bad = [];
  for (const s of RH_CHOSEN_SOURCES) {
    for (const cmd of [`/rh fund ${s.symbol}`, `/rh confirm ${s.symbol}`]) {
      if (cmd.length > CALLBACK_DATA_MAX) bad.push(cmd);
    }
  }
  return { ok: bad.length === 0, bad, max: CALLBACK_DATA_MAX };
}
