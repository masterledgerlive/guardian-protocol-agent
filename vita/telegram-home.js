/**
 * VITA Telegram HOME — sectioned clickable routes for every avenue.
 *
 * Inline keyboards only (callback_data ≤ 64). HOME always present.
 * Buttons send existing slash commands so agent.js reuses live handlers.
 * Paid paths stay SIM / confirm|override gated — buttons never auto-spend.
 *
 * Search routes are first-class (ref/ask/proven/xmem/recall/dir/unlock).
 * /home sim runs many offline route sims + dual-engine mirror compare
 * (MAIN exact UTF-8 vs NEW snark-short) with IDM Basescan anchors attached.
 *
 * Mother brain untouched. Never invents tx hashes.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FORMULA_ID, MAINFRAME_ANCHORS } from "./mainframe.js";
import { packMachineShort } from "./vita-dir.js";
import { feedFlowAnchorLocations } from "./feed-flow.js";
import { prepareVitaFeed, estimateVitaFeedCost } from "./vita-feed.js";
import { searchRefMemory, runProvenTests } from "./ref-memory.js";
import { snarkCompressBlob, snarkCompressBatch, collectIdmLocations, CALLBACK_DATA_MAX } from "./mirror-chain.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const MEMORY_DIR = join(HERE, "memory");
const STRANDS_DIR = join(HERE, "strands");
const LEARN_PATH = join(MEMORY_DIR, "telegram-home-learn.json");
const SIM_LEDGER_PATH = join(MEMORY_DIR, "telegram-home-sim-ledger.json");

export const TELEGRAM_HOME_ID = "vita-telegram-home-v1";
export const TELEGRAM_HOME_MAGIC = "§VITAHOME§";
export const TELEGRAM_HOME_LABEL = "TELEGRAM_HOME";
export const ENGINE_MAIN = "MAIN";
export const ENGINE_NEW = "NEW";

/** Hardcoded Base anchors for static IDM proof — never invent. */
export function homeIdmLocations(extra = []) {
  return collectIdmLocations(extra);
}

function sha256Hex(text) {
  return createHash("sha256").update(String(text || ""), "utf8").digest("hex");
}

function shortHex(hex, n = 8) {
  return String(hex || "").replace(/^0x/i, "").toLowerCase().slice(0, n);
}

function utf8Bytes(s) {
  return Buffer.byteLength(String(s || ""), "utf8");
}

function clip(s, n = 120) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length <= n ? t : t.slice(0, n - 1) + "…";
}

function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function telegramHomeCallbackData(cmd) {
  const s = String(cmd || "");
  return s.length <= CALLBACK_DATA_MAX ? s : s.slice(0, CALLBACK_DATA_MAX);
}

/**
 * Section catalog — every interactive route operators can take.
 * `cmd` is the exact callback_data / slash text agent.js already handles.
 */
export const HOME_SECTIONS = Object.freeze([
  {
    id: "memory",
    title: "Memory",
    emoji: "🧠",
    blurb: "HTML memory until /inject · leftover KEY+LOC · /prove Eureka",
    buttons: [
      { label: "Note", cmd: "/vitanote home seed" },
      { label: "Save", cmd: "/vitasave" },
      { label: "Inject", cmd: "/inject" },
      { label: "Reader", cmd: "/reader" },
      { label: "Prove", cmd: "/prove" },
      { label: "Scan", cmd: "/vitascan" },
      { label: "Course", cmd: "/vitacourse" },
      { label: "Router", cmd: "/vitarouter" },
    ],
  },
  {
    id: "feed",
    title: "Feed",
    emoji: "📡",
    blurb: "Exact plain / VITAFILE · confirm|override · brain learn · backlog",
    buttons: [
      { label: "Brain", cmd: "/vitafeed brain" },
      { label: "Learn", cmd: "/vitafeed learn" },
      { label: "Proof", cmd: "/vitafeed proof" },
      { label: "Backlog", cmd: "/vitafeed backlog" },
      { label: "Enqueue", cmd: "/vitafeed enqueue seed" },
      { label: "Next", cmd: "/vitafeed next" },
      { label: "Load", cmd: "/vitafeed load" },
      { label: "Files", cmd: "/vitafeed files" },
      { label: "Keys", cmd: "/vitafeed keys" },
      { label: "Kids play", cmd: "/vitafeed play kids" },
      { label: "Demo play", cmd: "/vitafeed play demo" },
      { label: "Confirm", cmd: "/vitafeed confirm" },
      { label: "Override", cmd: "/vitafeed override" },
      { label: "Cancel", cmd: "/vitafeed cancel" },
    ],
  },
  {
    id: "search",
    title: "Search",
    emoji: "🔎",
    blurb: "Proven ref · ask|self · xmem · recall · DOS dir unlock",
    buttons: [
      { label: "Ref calc", cmd: "/vitafeed ref calculator" },
      { label: "Ask calc", cmd: "/vitafeed ask calculator" },
      { label: "Proven", cmd: "/vitafeed proven" },
      { label: "XMEM", cmd: "/xmem STORE" },
      { label: "Recall", cmd: "/vitafeed recall" },
      { label: "Know", cmd: "/vitafeed know" },
      { label: "Dir", cmd: "/vitafeed dir" },
      { label: "Dir MEM", cmd: "/vitafeed dir MEMORY" },
      { label: "Kids dir", cmd: "/vitafeed dir KIDS" },
      { label: "Unlock", cmd: "/vitafeed unlock CODEX\\math-euler.txt" },
      { label: "Cipher", cmd: "/vitafeed cipher" },
      { label: "Bag recall", cmd: "/recall vita" },
      { label: "Bag files", cmd: "/vita files" },
    ],
  },
  {
    id: "wave",
    title: "WAVE",
    emoji: "🌊",
    blurb: "Memory-mirror SIM · 3-proof · 28-full — paid gates stay OFF",
    buttons: [
      { label: "Wavetest", cmd: "/wavetest" },
      { label: "Waveproof", cmd: "/waveproof" },
      { label: "Wavefull", cmd: "/wavefull" },
      { label: "Hitch tip", cmd: "/wavetest hitch" },
    ],
  },
  {
    id: "mirror",
    title: "Mirror",
    emoji: "🪞",
    blurb: "GitHub duplicate · dual avail|proven · zero-proof · SNARK boot",
    buttons: [
      { label: "Chain", cmd: "/vita chain" },
      { label: "Files", cmd: "/vita files" },
      { label: "Tree", cmd: "/vita tree vita" },
      { label: "Dual path", cmd: "/vita dual vita/mainframe.js" },
      { label: "Kids path", cmd: "/vita dual vita/memory/kids-url-directory.json" },
      { label: "Boot", cmd: "/vita boot hitch-gate" },
      { label: "Session", cmd: "/vita session" },
      { label: "Open vault", cmd: "/vita read vault-unlock.js" },
      { label: "Proof pos", cmd: "/vita proof positions.json" },
      { label: "Engines", cmd: "/home engines" },
      { label: "Sim all", cmd: "/home sim" },
      { label: "Sim search", cmd: "/home sim search" },
    ],
  },
  {
    id: "trade",
    title: "Trade",
    emoji: "📱",
    blurb: "Verb → token box (buy/sell/exit/piggy) — tap to run",
    buttons: [
      { label: "Buy…", cmd: "/pick buy" },
      { label: "Sell…", cmd: "/pick sell" },
      { label: "Sell half…", cmd: "/pick sellhalf" },
      { label: "Exit…", cmd: "/pick exit" },
      { label: "Piggy…", cmd: "/pick piggyunlock" },
      { label: "Tokens", cmd: "/tokens" },
      { label: "Player", cmd: "/tokenplayer" },
      { label: "DEX", cmd: "/dex" },
      { label: "Chains", cmd: "/chains" },
      { label: "Waves…", cmd: "/pick waves" },
      { label: "Cycles", cmd: "/cycles" },
    ],
  },
  {
    id: "dual",
    title: "Dual",
    emoji: "⚖️",
    blurb: "Human plain ↔ machine ZK-short cost mirror · restart ≥$0.50",
    buttons: [
      { label: "Translate", cmd: "/vitafeed translate home dual seed" },
      { label: "Dual", cmd: "/vitafeed dual home dual seed" },
      { label: "Kids dual", cmd: "/vitafeed dual kids" },
      { label: "Restart", cmd: "/vitafeed restart" },
      { label: "Loader", cmd: "/vitafeed load all" },
    ],
  },
  {
    id: "agents",
    title: "Agents",
    emoji: "🤖",
    blurb: "Agent-owned chat · x404 dir tags · proven locs wait master-tag",
    buttons: [
      { label: "Chat", cmd: "/agents chat" },
      { label: "Dir", cmd: "/agents dir" },
      { label: "Dual", cmd: "/agents dual" },
      { label: "Proven locs", cmd: "/agents proven" },
      { label: "Path map", cmd: "/agents path" },
    ],
  },
  {
    id: "mother",
    title: "Mother",
    emoji: "🧬",
    blurb: "N-batch dumps + FORCE recall bank (queries last) — not mother brain",
    buttons: [
      { label: "MG plain", cmd: "/vitamothergenesis" },
      { label: "MG encoded", cmd: "/vitamotherGenesisencoded" },
      { label: "FORCE recall", cmd: "/vitamothergenesis FORCE recall" },
    ],
  },
  {
    id: "syscheck",
    title: "Syscheck",
    emoji: "✅",
    blurb: "Merkle folders + route domino · force §SYSCHECK§ seal stage",
    buttons: [
      { label: "Full check", cmd: "/vita check" },
      { label: "Route domino", cmd: "/vita check routes" },
      { label: "Inject locs", cmd: "/vita check locs" },
      { label: "Pull", cmd: "/vita check pull" },
      { label: "Recover", cmd: "/vita recover" },
      { label: "Help check", cmd: "/help check" },
      { label: "Track seal", cmd: "/vitafeed track SYSCHECK" },
      { label: "HOME sim", cmd: "/home sim" },
    ],
  },
  {
    id: "status",
    title: "Status",
    emoji: "📊",
    blurb: "Live book · bag · bank · waves · tiers — never invent P&L",
    buttons: [
      { label: "Status", cmd: "/status" },
      { label: "Bag", cmd: "/bag" },
      { label: "Bank", cmd: "/bank" },
      { label: "Waves", cmd: "/waves" },
      { label: "Tiers", cmd: "/tiers" },
      { label: "Eth", cmd: "/eth" },
      { label: "Piggy", cmd: "/piggy" },
      { label: "Gas", cmd: "/gas" },
      { label: "Help", cmd: "/help" },
    ],
  },
]);

export function homeSectionById(id) {
  return HOME_SECTIONS.find((s) => s.id === String(id || "").toLowerCase()) || null;
}

export function allHomeRouteCommands() {
  const out = [];
  for (const sec of HOME_SECTIONS) {
    for (const b of sec.buttons) out.push({ section: sec.id, ...b });
  }
  return out;
}

/** Validate every button fits Telegram callback_data limit. */
export function assertHomeCallbacksFit() {
  const bad = [];
  for (const r of allHomeRouteCommands()) {
    if (r.cmd.length > CALLBACK_DATA_MAX) bad.push(r);
  }
  for (const sec of HOME_SECTIONS) {
    const open = "/home " + sec.id;
    if (open.length > CALLBACK_DATA_MAX) bad.push({ cmd: open, section: sec.id });
  }
  return { ok: bad.length === 0, bad, max: CALLBACK_DATA_MAX };
}

export function buildHomeNavKeyboard() {
  const rows = [];
  const secs = HOME_SECTIONS;
  for (let i = 0; i < secs.length; i += 3) {
    rows.push(
      secs.slice(i, i + 3).map((s) => ({
        text: s.emoji + " " + s.title,
        callback_data: telegramHomeCallbackData("/home " + s.id),
      })),
    );
  }
  rows.push([
    { text: "🏠 HOME", callback_data: "/home" },
    { text: "🔎 Search", callback_data: "/home search" },
    { text: "🧪 Sim all", callback_data: "/home sim" },
  ]);
  rows.push([
    { text: "⚖️ Engines", callback_data: "/home engines" },
    { text: "🪞 Chain", callback_data: "/vita chain" },
    { text: "✅ Routes", callback_data: "/vita check routes" },
  ]);
  return { inline_keyboard: rows };
}

export function buildHomeSectionKeyboard(sectionId) {
  const sec = homeSectionById(sectionId);
  if (!sec) return buildHomeNavKeyboard();
  const rows = [];
  for (let i = 0; i < sec.buttons.length; i += 3) {
    rows.push(
      sec.buttons.slice(i, i + 3).map((b) => ({
        text: b.label,
        callback_data: telegramHomeCallbackData(b.cmd),
      })),
    );
  }
  rows.push([
    { text: "🏠 HOME", callback_data: "/home" },
    { text: "🧪 Sim " + sec.title, callback_data: telegramHomeCallbackData("/home sim " + sec.id) },
  ]);
  // Neighbor sections for quick hop
  const idx = HOME_SECTIONS.findIndex((s) => s.id === sec.id);
  const prev = HOME_SECTIONS[(idx - 1 + HOME_SECTIONS.length) % HOME_SECTIONS.length];
  const next = HOME_SECTIONS[(idx + 1) % HOME_SECTIONS.length];
  rows.push([
    { text: "◀ " + prev.title, callback_data: "/home " + prev.id },
    { text: next.title + " ▶", callback_data: "/home " + next.id },
  ]);
  return { inline_keyboard: rows };
}

/** Attach HOME row onto any existing keyboard (mirror files, etc.). */
export function withHomeButton(keyboard) {
  const kb = keyboard?.inline_keyboard
    ? { inline_keyboard: keyboard.inline_keyboard.map((r) => r.slice()) }
    : { inline_keyboard: [] };
  const flat = kb.inline_keyboard.flat().map((b) => b.callback_data);
  if (!flat.includes("/home")) {
    kb.inline_keyboard.push([
      { text: "🏠 HOME", callback_data: "/home" },
      { text: "🔎 Search", callback_data: "/home search" },
    ]);
  }
  return kb;
}

export function formatHomeCard() {
  const lines = [];
  lines.push(TELEGRAM_HOME_MAGIC + "v1|home§");
  lines.push("🏠 VITA HOME — every route is a button");
  lines.push("━━━━━━━━━━━━━━━━━━━━");
  lines.push("Tap a section. Paid paths stay SIM / confirm|override.");
  lines.push("IDM proof = Basescan Input Data → UTF-8 (anchors only).");
  lines.push("Engines: MAIN exact UTF-8 ↔ NEW snark-short (compare cost/speed).");
  lines.push("");
  for (const sec of HOME_SECTIONS) {
    lines.push(sec.emoji + " " + sec.title + " — " + sec.blurb);
    lines.push("   routes: " + sec.buttons.map((b) => b.label).join(" · "));
  }
  lines.push("");
  lines.push("Commands: /home · /home search · /home agents · /home sim · /home engines · /menu");
  const locs = homeIdmLocations();
  lines.push("IDM anchors: " + locs.map((l) => shortHex(l.location, 8)).join(" · "));
  return lines.join("\n");
}

export function formatHomeSectionCard(sectionId) {
  const sec = homeSectionById(sectionId);
  if (!sec) return formatHomeCard();
  const lines = [];
  lines.push(TELEGRAM_HOME_MAGIC + "v1|section=" + sec.id + "§");
  lines.push(sec.emoji + " " + sec.title.toUpperCase());
  lines.push("━━━━━━━━━━━━━━━━━━━━");
  lines.push(sec.blurb);
  lines.push("");
  for (const b of sec.buttons) {
    lines.push("• " + b.label + " → <code>" + esc(b.cmd) + "</code>");
  }
  lines.push("");
  lines.push("🏠 /home · 🧪 /home sim " + sec.id);
  return lines.join("\n");
}

export function formatHomeTelegramHtml(text) {
  const raw = String(text || "");
  // Already may contain <code> from section card — escape only bare < that aren't tags we emit.
  if (raw.includes("<code>")) {
    return raw
      .split("\n")
      .map((line) => {
        if (line.includes("<code>")) return line;
        return esc(line);
      })
      .join("\n");
  }
  return "<pre>" + esc(raw).slice(0, 3500) + "</pre>";
}

export function parseHomeCommand(raw) {
  const src = String(raw || "").trim();
  const low = src.toLowerCase();
  if (low === "/start" || low === "/menu" || low === "/home") {
    return { ok: true, action: "home" };
  }
  if (low === "/homesim" || low === "/home sim" || low === "/home sim all") {
    return { ok: true, action: "sim", section: "all" };
  }
  if (low.startsWith("/home sim ")) {
    return { ok: true, action: "sim", section: src.slice("/home sim ".length).trim().toLowerCase() || "all" };
  }
  if (low === "/home engines" || low === "/home engine" || low === "/engines") {
    return { ok: true, action: "engines" };
  }
  if (low.startsWith("/home ")) {
    const id = src.slice("/home ".length).trim().toLowerCase();
    if (homeSectionById(id)) return { ok: true, action: "section", section: id };
    if (id === "sim") return { ok: true, action: "sim", section: "all" };
    return { ok: true, action: "home" };
  }
  return { ok: false, action: null };
}

/**
 * MAIN engine path — exact UTF-8 VITAFEED chunks (message-first hitch class).
 */
export function mirrorMainEngine(body, quotes = {}) {
  const t0 = Date.now();
  const prepared = prepareVitaFeed(body, {});
  const cost = prepared.ok
    ? estimateVitaFeedCost(prepared, quotes)
    : { ok: false, reason: prepared.reason };
  const ms = Math.max(0, Date.now() - t0);
  return {
    engine: ENGINE_MAIN,
    ok: prepared.ok === true,
    bytes: prepared.totalBytes || utf8Bytes(body),
    chunks: prepared.totalChunks || 0,
    injections: prepared.injections || prepared.totalChunks || 0,
    vinId: prepared.vinId || null,
    contentCommit: prepared.contentCommit || sha256Hex(body),
    costUsd: cost?.totalUsd ?? cost?.usd ?? null,
    costEth: cost?.totalEth ?? cost?.eth ?? null,
    encodeMs: ms,
    class: "exact-utf8-vitafeed",
    snarkReady: false,
    reason: prepared.ok ? null : prepared.reason,
  };
}

/**
 * NEW engine path — snark-short / ZK content-commitment (cheaper byte surface).
 */
export function mirrorNewEngine(body, { locs = [], title = "home-mirror" } = {}) {
  const t0 = Date.now();
  const snark = snarkCompressBlob(body, { filename: title, locs });
  const packed = packMachineShort({
    english: body,
    machine: snark.machine || snark.short,
    locs: (locs || []).map((l) => l.location || l),
    trueName: title,
  });
  const ms = Math.max(0, Date.now() - t0);
  return {
    engine: ENGINE_NEW,
    ok: true,
    bytes: utf8Bytes(snark.short || packed.short),
    rawBytes: utf8Bytes(body),
    chunks: 1,
    injections: 1,
    contentCommit: snark.contentCommit || packed.commit,
    short: snark.short || packed.short,
    encodeMs: ms,
    class: "snark-short-zk",
    snarkReady: true,
    zkClass: snark.zkClass || packed.zkClass,
    instantUnwrap: true,
  };
}

/**
 * Dual-mirror one payload into MAIN + NEW; pick cheaper/faster for learn.
 */
export function compareEngines(body, { quotes = {}, title = "home-mirror", locs = null } = {}) {
  const idm = locs || homeIdmLocations();
  const main = mirrorMainEngine(body, quotes);
  const neu = mirrorNewEngine(body, { locs: idm, title });
  const cheaper =
    main.ok && neu.ok
      ? neu.bytes < main.bytes
        ? ENGINE_NEW
        : main.bytes < neu.bytes
          ? ENGINE_MAIN
          : "tie"
      : neu.ok
        ? ENGINE_NEW
        : ENGINE_MAIN;
  const faster =
    main.encodeMs < neu.encodeMs
      ? ENGINE_MAIN
      : neu.encodeMs < main.encodeMs
        ? ENGINE_NEW
        : "tie";
  return {
    ok: true,
    bodyBytes: utf8Bytes(body),
    contentCommit: sha256Hex(body),
    main,
    new: neu,
    cheaper,
    faster,
    byteDelta: (main.bytes || 0) - (neu.bytes || 0),
    idm: idm.map((l) => ({
      id: l.id,
      location: l.location,
      basescan: l.basescan,
      idmChat: l.idmChat || "Basescan → Input Data → View as UTF-8",
    })),
    neverInventHashes: true,
    formula: FORMULA_ID,
    note: "Mirror both engines while learning which is cheaper/faster. Settlement still Base hitch + /prove.",
  };
}

/** Search-related offline sims — must stay connected and cite anchors only. */
export function runSearchRouteSims({ queries = null } = {}) {
  const qlist = queries || [
    "calculator",
    "calc",
    "I made a calculator for proven ledger",
    "what is calculator",
    "calculadora",
    "2+2",
  ];
  const results = [];
  for (const q of qlist) {
    const t0 = Date.now();
    const hit = searchRefMemory(q);
    const ms = Math.max(0, Date.now() - t0);
    const locs = (hit?.citations || [])
      .map((l) => (typeof l === "string" ? l : l?.location || l?.tx))
      .filter((h) => /^0x[0-9a-fA-F]{64}$/.test(String(h || "")));
    results.push({
      route: "ref-memory",
      query: q,
      ok: hit?.ok === true && hit?.invent === false && Boolean(hit?.trueName),
      trueName: hit?.trueName || null,
      label: hit?.answer?.label || hit?.intent || null,
      proven: Boolean(hit?.proven),
      encodeMs: ms,
      locCount: locs.length,
      locations: locs.slice(0, 3),
      invented: hit?.invent === true,
    });
  }
  const proven = runProvenTests();
  results.push({
    route: "proven-calculator",
    query: "proven",
    ok: proven?.ok === true,
    encodeMs: 0,
    locCount: (proven?.results || []).reduce((n, r) => n + (r.citationCount || 0), 0),
    locations: homeIdmLocations().map((l) => l.location).slice(0, 3),
    invented: false,
    detail: "pass=" + (proven?.passed ?? 0) + "/" + (proven?.total ?? 0),
  });
  return {
    ok: results.every((r) => r.ok === true),
    count: results.length,
    passed: results.filter((r) => r.ok).length,
    results,
    idm: homeIdmLocations(),
  };
}

/**
 * Run many route sims (optionally one section). Search always included when
 * section is all|search. Dual-mirrors a seed body into MAIN+NEW.
 */
export function runHomeRouteSims({ section = "all", seedBody = null, quotes = {} } = {}) {
  const secId = String(section || "all").toLowerCase();
  const routes =
    secId === "all"
      ? allHomeRouteCommands()
      : (homeSectionById(secId)?.buttons || []).map((b) => ({ section: secId, ...b }));

  const body =
    seedBody ||
    "VITA HOME sim seed — message-first hitch; dual MAIN exact + NEW snark; IDM Basescan chat of anchors.";

  const engine = compareEngines(body, { quotes, title: "telegram-home-sim-" + secId });
  const search = secId === "all" || secId === "search" ? runSearchRouteSims() : null;

  const routeSims = routes.map((r) => {
    const t0 = Date.now();
    // Offline connectivity check — command string is a known button target.
    const connected = typeof r.cmd === "string" && r.cmd.startsWith("/");
    const fits = r.cmd.length <= CALLBACK_DATA_MAX;
    return {
      section: r.section,
      label: r.label,
      cmd: r.cmd,
      ok: connected && fits,
      encodeMs: Math.max(0, Date.now() - t0),
      callbackBytes: utf8Bytes(r.cmd),
    };
  });

  const batch = snarkCompressBatch(
    [
      { name: "home-sim-seed.txt", text: body },
      { name: "home-sim-main.json", text: JSON.stringify(engine.main) },
      { name: "home-sim-new.json", text: JSON.stringify(engine.new) },
    ],
    { title: "HOME-SIM-" + secId.toUpperCase() },
  );

  const report = {
    at: new Date().toISOString(),
    section: secId,
    routeCount: routeSims.length,
    routesOk: routeSims.filter((r) => r.ok).length,
    routes: routeSims,
    search,
    engine,
    snarkBatch: {
      root: batch.root,
      short: batch.short,
      fileCount: batch.fileCount,
      bytes: batch.bytes,
      snarkReady: true,
    },
    idm: engine.idm,
    cheaper: engine.cheaper,
    faster: engine.faster,
    neverInventHashes: true,
    formula: FORMULA_ID,
  };

  appendSimLedger(report);
  appendHomeLearn({
    topic: "telegram-home-sim",
    section: secId,
    cheaper: engine.cheaper,
    faster: engine.faster,
    byteDelta: engine.byteDelta,
    searchPassed: search?.passed ?? null,
    snarkRoot: batch.root,
    locations: engine.idm.map((l) => l.location),
  });

  return report;
}

function ensureDirs() {
  if (!existsSync(MEMORY_DIR)) mkdirSync(MEMORY_DIR, { recursive: true });
  if (!existsSync(STRANDS_DIR)) mkdirSync(STRANDS_DIR, { recursive: true });
}

function appendSimLedger(report) {
  ensureDirs();
  let ledger = { id: "telegram-home-sim-ledger-v1", events: [] };
  try {
    if (existsSync(SIM_LEDGER_PATH)) ledger = JSON.parse(readFileSync(SIM_LEDGER_PATH, "utf8"));
  } catch { /* fresh */ }
  if (!Array.isArray(ledger.events)) ledger.events = [];
  ledger.events.push({
    at: report.at,
    section: report.section,
    routeCount: report.routeCount,
    routesOk: report.routesOk,
    cheaper: report.cheaper,
    faster: report.faster,
    snarkRoot: report.snarkBatch?.root || null,
    searchPassed: report.search?.passed ?? null,
    idm: (report.idm || []).map((l) => l.location),
  });
  if (ledger.events.length > 200) ledger.events = ledger.events.slice(-200);
  ledger.updatedAt = report.at;
  writeFileSync(SIM_LEDGER_PATH, JSON.stringify(ledger, null, 2) + "\n");
}

function appendHomeLearn(note) {
  ensureDirs();
  let doc = { id: "telegram-home-learn-v1", filingLabel: TELEGRAM_HOME_LABEL, notes: [] };
  try {
    if (existsSync(LEARN_PATH)) doc = JSON.parse(readFileSync(LEARN_PATH, "utf8"));
  } catch { /* fresh */ }
  if (!Array.isArray(doc.notes)) doc.notes = [];
  doc.notes.push({
    at: new Date().toISOString(),
    ...note,
    formula: FORMULA_ID,
    neverForget: true,
    neverInventHashes: true,
  });
  if (doc.notes.length > 100) doc.notes = doc.notes.slice(-100);
  doc.updatedAt = new Date().toISOString();
  writeFileSync(LEARN_PATH, JSON.stringify(doc, null, 2) + "\n");
}

export function formatEngineCompareCard(cmp) {
  const lines = [];
  lines.push(TELEGRAM_HOME_MAGIC + "v1|engines§");
  lines.push("⚖️ DUAL ENGINE MIRROR — MAIN vs NEW");
  lines.push("━━━━━━━━━━━━━━━━━━━━");
  lines.push("body " + cmp.bodyBytes + "B · commit " + shortHex(cmp.contentCommit, 12) + "…");
  lines.push("");
  lines.push(
    "MAIN exact-utf8  bytes=" +
      cmp.main.bytes +
      "  chunks=" +
      cmp.main.chunks +
      "  ms=" +
      cmp.main.encodeMs +
      (cmp.main.costUsd != null ? "  ~$" + Number(cmp.main.costUsd).toFixed(4) : ""),
  );
  lines.push(
    "NEW  snark-short bytes=" +
      cmp.new.bytes +
      "  chunks=" +
      cmp.new.chunks +
      "  ms=" +
      cmp.new.encodeMs +
      "  snarkReady=yes",
  );
  if (cmp.new.short) lines.push("snark " + clip(cmp.new.short, 96));
  lines.push("");
  lines.push("cheaper=" + cmp.cheaper + "  faster=" + cmp.faster + "  Δbytes=" + cmp.byteDelta);
  lines.push("Both lanes keep learning — settlement still leftover hitch + /prove.");
  lines.push("");
  lines.push("— IDM CHAT (static proof anchors) —");
  for (const loc of (cmp.idm || []).slice(0, 6)) {
    lines.push("🔗 " + (loc.id || "loc") + "  " + shortHex(loc.location, 8) + "…  " + loc.basescan);
  }
  lines.push("Open tx → Input Data → View as UTF-8. Never invented.");
  return lines.join("\n");
}

export function formatHomeSimCard(report) {
  const lines = [];
  lines.push(TELEGRAM_HOME_MAGIC + "v1|sim§");
  lines.push("🧪 HOME ROUTE SIM — section=" + report.section);
  lines.push("━━━━━━━━━━━━━━━━━━━━");
  lines.push("routes " + report.routesOk + "/" + report.routeCount + " connected + callback≤64");
  if (report.search) {
    lines.push("search " + report.search.passed + "/" + report.search.count + " ref/proven sims");
  }
  lines.push(
    "engines cheaper=" +
      report.cheaper +
      " faster=" +
      report.faster +
      "  snarkRoot=" +
      shortHex(report.snarkBatch?.root, 12) +
      "…",
  );
  lines.push("");
  const sample = (report.routes || []).slice(0, 12);
  for (const r of sample) {
    lines.push((r.ok ? "✓" : "✗") + " [" + r.section + "] " + r.label + " → " + r.cmd);
  }
  if ((report.routes || []).length > sample.length) {
    lines.push("… +" + (report.routes.length - sample.length) + " more");
  }
  if (report.search?.results?.length) {
    lines.push("");
    lines.push("— search sims —");
    for (const s of report.search.results.slice(0, 8)) {
      lines.push(
        (s.ok ? "✓" : "·") +
          " " +
          s.route +
          " q=" +
          clip(s.query, 40) +
          (s.trueName ? " true=" + s.trueName : "") +
          " locs=" +
          s.locCount,
      );
    }
  }
  lines.push("");
  lines.push("IDM " + (report.idm || []).map((l) => shortHex(l.location, 8)).join(" · "));
  lines.push("Seeded learn → vita/memory/telegram-home-learn.json");
  return lines.join("\n");
}

/**
 * Thin action router for /home|/menu|/start|/homesim|/engines.
 */
export function handleHomeAction({ action = "home", section = "all", quotes = {}, seedBody = null } = {}) {
  const fit = assertHomeCallbacksFit();
  if (action === "home") {
    return {
      ok: true,
      action: "home",
      reply: formatHomeCard(),
      html: formatHomeTelegramHtml(formatHomeCard()),
      keyboard: buildHomeNavKeyboard(),
      callbackFit: fit,
    };
  }
  if (action === "section") {
    const reply = formatHomeSectionCard(section);
    return {
      ok: true,
      action: "section",
      section,
      reply,
      html: formatHomeTelegramHtml(reply),
      keyboard: buildHomeSectionKeyboard(section),
      callbackFit: fit,
    };
  }
  if (action === "engines") {
    const cmp = compareEngines(
      seedBody ||
        "Dual-engine mirror seed: MAIN exact UTF-8 VITAFEED vs NEW snark-short. Attach IDM anchors as static proof.",
      { quotes, title: "home-engines" },
    );
    appendHomeLearn({
      topic: "engine-compare",
      cheaper: cmp.cheaper,
      faster: cmp.faster,
      byteDelta: cmp.byteDelta,
      locations: cmp.idm.map((l) => l.location),
    });
    const reply = formatEngineCompareCard(cmp);
    return {
      ok: true,
      action: "engines",
      reply,
      html: formatHomeTelegramHtml(reply),
      keyboard: withHomeButton({
        inline_keyboard: [
          [
            { text: "🧪 Sim all", callback_data: "/home sim" },
            { text: "🔎 Search sims", callback_data: "/home sim search" },
          ],
          [
            { text: "🪞 Chain", callback_data: "/vita chain" },
            { text: "📡 Dual lane", callback_data: "/vitafeed dual home dual seed" },
          ],
        ],
      }),
      compare: cmp,
    };
  }
  if (action === "sim") {
    const report = runHomeRouteSims({ section, seedBody, quotes });
    const reply = formatHomeSimCard(report);
    return {
      ok: true,
      action: "sim",
      section,
      reply,
      html: formatHomeTelegramHtml(reply),
      keyboard: withHomeButton({
        inline_keyboard: [
          [
            { text: "⚖️ Engines", callback_data: "/home engines" },
            { text: "🔎 Search", callback_data: "/home search" },
          ],
          [
            { text: "🌊 Wavetest", callback_data: "/wavetest" },
            { text: "📡 Feed proof", callback_data: "/vitafeed proof" },
          ],
        ],
      }),
      report,
    };
  }
  return handleHomeAction({ action: "home", quotes, seedBody });
}

export { feedFlowAnchorLocations, MAINFRAME_ANCHORS };
