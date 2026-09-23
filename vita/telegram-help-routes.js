/**
 * Telegram HELP click-through + route domino systems-check.
 *
 * /help → sections → commands → (if needed) token/arg pickers.
 * Example: /sell → tap AERO → /sell AERO. Same for buy/exit/piggy/waves/…
 *
 * /vita check routes · /help check — merkle folder integrity + route
 * avenue domino cascade. PASS / QUESTIONABLE / FAIL per node. Logs under
 * vita/memory/systems-check-routes-*.json and stages §SYSCHECK§ body for
 * forced blockchain inject (Confirm|Override — never invents hashes).
 *
 * Mother brain untouched. Message-first formula untouched.
 */

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { FORMULA_ID, MAINFRAME_ANCHORS, ORIGINAL_FORMULA } from "./mainframe.js";
import { CALLBACK_DATA_MAX, telegramCallbackData } from "./mirror-chain.js";
import { HOME_SECTIONS, allHomeRouteCommands, assertHomeCallbacksFit } from "./telegram-home.js";
import {
  buildTokenCatalogKeyboard,
  buildTrackInjectBody,
  buildVitaFeedRootKeyboard,
  buildVitaFeedStagedKeyboard,
} from "./telegram-clickthrough.js";
import { listMasterDirectory } from "./vita-dir.js";
import { runSystemsCheck, SYSTEMS_CHECK_MAGIC, SYSTEMS_CHECK_LABEL } from "./chain-layer.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");
const MEMORY_DIR = join(HERE, "memory");
const STRANDS_DIR = join(HERE, "strands");
const ROUTES_LEDGER = join(MEMORY_DIR, "systems-check-routes-ledger.json");
const ROUTES_LATEST = join(MEMORY_DIR, "systems-check-routes-latest.json");
const ROUTES_STRAND = join(STRANDS_DIR, "systems-check-routes.json");

export const HELP_ROUTES_ID = "vita-telegram-help-routes-v1";
export const HELP_ROUTES_MAGIC = "§VITAHELP§";
export const HELP_ROUTES_LABEL = "VITAHELP";
export const ROUTE_CHECK_LABEL = "SYSTEMS_CHECK_ROUTES";

/** Commands that need a token symbol before they can run. */
export const TOKEN_PICK_VERBS = Object.freeze([
  "buy",
  "sell",
  "sellhalf",
  "exit",
  "exithalf",
  "piggyunlock",
  "freeze",
  "unfreeze",
  "waves",
  "fib",
  "history",
  "tok",
  "dex",
  "legit",
]);

/** Bare `/sell` (no symbol) opens a picker. `/waves` alone stays global status. */
export const BARE_PICK_VERBS = Object.freeze([
  "buy",
  "sell",
  "sellhalf",
  "exit",
  "exithalf",
  "piggyunlock",
  "freeze",
  "unfreeze",
  "tok",
  "fib",
  "history",
]);

/**
 * Help sections — every /help category is a button box.
 * Buttons either fire a command or open /pick <verb> for token args.
 */
export const HELP_SECTIONS = Object.freeze([
  {
    id: "nav",
    title: "Home",
    emoji: "🏠",
    blurb: "Sectioned HOME hub + feed click-through",
    buttons: [
      { label: "HOME", cmd: "/home" },
      { label: "Menu", cmd: "/menu" },
      { label: "Feed menu", cmd: "/vitafeed" },
      { label: "Tokens", cmd: "/tokens" },
      { label: "Dir", cmd: "/vitafeed dir" },
      { label: "Agents", cmd: "/home agents" },
      { label: "Check routes", cmd: "/vita check routes" },
    ],
  },
  {
    id: "trade",
    title: "Trade",
    emoji: "📱",
    blurb: "Pick a verb → tap a token (never invents a symbol)",
    buttons: [
      { label: "Buy…", cmd: "/pick buy" },
      { label: "Sell…", cmd: "/pick sell" },
      { label: "Sell half…", cmd: "/pick sellhalf" },
      { label: "Exit…", cmd: "/pick exit" },
      { label: "Exit half…", cmd: "/pick exithalf" },
      { label: "Piggy…", cmd: "/pick piggyunlock" },
      { label: "Freeze…", cmd: "/pick freeze" },
      { label: "Unfreeze…", cmd: "/pick unfreeze" },
      { label: "Tokens", cmd: "/tokens" },
      { label: "Player", cmd: "/tokenplayer" },
      { label: "DEX", cmd: "/dex" },
      { label: "Chains", cmd: "/chains" },
      { label: "Legit", cmd: "/legit" },
    ],
  },
  {
    id: "status",
    title: "Status",
    emoji: "📊",
    blurb: "Live book — never invent P&L",
    buttons: [
      { label: "Status", cmd: "/status" },
      { label: "Bag", cmd: "/bag" },
      { label: "Bank", cmd: "/bank" },
      { label: "Waves…", cmd: "/pick waves" },
      { label: "Tiers", cmd: "/tiers" },
      { label: "Eth", cmd: "/eth" },
      { label: "Piggy", cmd: "/piggy" },
      { label: "Gas", cmd: "/gas" },
      { label: "Cycles", cmd: "/cycles" },
      { label: "Inject prove", cmd: "/injectprove" },
    ],
  },
  {
    id: "vita",
    title: "VITA",
    emoji: "🌟",
    blurb: "Memory · mirror · systems check",
    buttons: [
      { label: "Files", cmd: "/vita files" },
      { label: "Chain", cmd: "/vita chain" },
      { label: "Check", cmd: "/vita check" },
      { label: "Check routes", cmd: "/vita check routes" },
      { label: "Recover", cmd: "/vita recover" },
      { label: "Models", cmd: "/vita models" },
      { label: "Session", cmd: "/vita session" },
      { label: "Prove", cmd: "/prove" },
      { label: "Reader", cmd: "/reader" },
      { label: "Inject", cmd: "/inject" },
      { label: "Agents chat", cmd: "/agents chat" },
    ],
  },
  {
    id: "feed",
    title: "Feed",
    emoji: "📡",
    blurb: "Exact plain / VITAFILE · confirm|override",
    buttons: [
      { label: "Feed", cmd: "/vitafeed" },
      { label: "Brain", cmd: "/vitafeed brain" },
      { label: "Dir", cmd: "/vitafeed dir" },
      { label: "Compress", cmd: "/vitafeed compress" },
      { label: "Comp add", cmd: "/vitafeed compress add" },
      { label: "Comp unwrap", cmd: "/vitafeed compress unwrap" },
      { label: "Comp dir", cmd: "/vitafeed dir COMPRESS" },
      { label: "Phosphor", cmd: "/phosphor" },
      { label: "Phos dir", cmd: "/phosphor dir" },
      { label: "Track", cmd: "/vitafeed track" },
      { label: "Dual", cmd: "/vitafeed dual help seed" },
      { label: "Backlog", cmd: "/vitafeed backlog" },
      { label: "Files", cmd: "/vitafeed files" },
      { label: "Confirm", cmd: "/vitafeed confirm" },
      { label: "Override", cmd: "/vitafeed override" },
    ],
  },
  {
    id: "compress",
    title: "Compress",
    emoji: "🗜",
    blurb: "Bake-off · add file · unwrap plain from machine · inject",
    buttons: [
      { label: "Bench", cmd: "/vitafeed compress" },
      { label: "Add file", cmd: "/vitafeed compress add" },
      { label: "Keys", cmd: "/vitafeed compress dir" },
      { label: "Unwrap", cmd: "/vitafeed compress unwrap" },
      { label: "Inject", cmd: "/vitafeed compress inject" },
      { label: "Dir", cmd: "/vitafeed dir COMPRESS" },
    ],
  },
  {
    id: "phosphor",
    title: "Phosphor",
    emoji: "🟢",
    blurb: "CRT pop-out · library PLAY/PICTURE · open key",
    buttons: [
      { label: "CRT", cmd: "/phosphor" },
      { label: "Library", cmd: "/phosphor dir" },
      { label: "PLAY", cmd: "/phosphor dir PLAY" },
      { label: "PICTURE", cmd: "/phosphor dir PICTURE" },
      { label: "Self-test", cmd: "/phosphor test" },
    ],
  },
  {
    id: "players",
    title: "Players",
    emoji: "🎬",
    blurb: "Proven Player — switch dav1d and AV2, receipt unlock, no shared playback",
    buttons: [
      { label: "Proven", cmd: "/provenplayer" },
      { label: "Manifest", cmd: "/provenplayer manifest" },
      { label: "Verify", cmd: "/provenplayer verify" },
    ],
  },
  {
    id: "wave",
    title: "WAVE",
    emoji: "🌊",
    blurb: "SIM / proof / full — paid gates stay OFF",
    buttons: [
      { label: "Wavetest", cmd: "/wavetest" },
      { label: "Waveproof", cmd: "/waveproof" },
      { label: "Wavefull", cmd: "/wavefull" },
    ],
  },
  {
    id: "check",
    title: "Syscheck",
    emoji: "✅",
    blurb: "Merkle folder + route domino · force seal stage",
    buttons: [
      { label: "Full check", cmd: "/vita check" },
      { label: "Route domino", cmd: "/vita check routes" },
      { label: "Inject locs", cmd: "/vita check locs" },
      { label: "Pull verify", cmd: "/vita check pull" },
      { label: "HOME sim", cmd: "/home sim" },
      { label: "Engines", cmd: "/home engines" },
      { label: "Track seal", cmd: "/vitafeed track SYSCHECK" },
    ],
  },
]);

function sha256Hex(text) {
  return createHash("sha256").update(String(text || ""), "utf8").digest("hex");
}

function shortHex(hex, n = 8) {
  return String(hex || "").replace(/^0x/i, "").toLowerCase().slice(0, n);
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
  for (let i = 0; i < list.length; i += perRow) rows.push(list.slice(i, i + perRow));
  return rows;
}

function ensureDirs() {
  if (!existsSync(MEMORY_DIR)) mkdirSync(MEMORY_DIR, { recursive: true });
  if (!existsSync(STRANDS_DIR)) mkdirSync(STRANDS_DIR, { recursive: true });
}

export function helpSectionById(id) {
  return HELP_SECTIONS.find((s) => s.id === String(id || "").toLowerCase()) || null;
}

export function allHelpRouteCommands() {
  const out = [];
  for (const sec of HELP_SECTIONS) {
    for (const b of sec.buttons) out.push({ section: sec.id, ...b });
  }
  return out;
}

export function assertHelpCallbacksFit() {
  const bad = [];
  for (const r of allHelpRouteCommands()) {
    if (String(r.cmd).length > CALLBACK_DATA_MAX) bad.push(r);
  }
  for (const sec of HELP_SECTIONS) {
    const open = "/help " + sec.id;
    if (open.length > CALLBACK_DATA_MAX) bad.push({ cmd: open, section: sec.id });
  }
  return { ok: bad.length === 0, bad, max: CALLBACK_DATA_MAX };
}

export function buildHelpNavKeyboard() {
  const rows = rowsOf(
    HELP_SECTIONS.map((s) => btn(s.emoji + " " + s.title, "/help " + s.id)),
    3,
  );
  rows.push([
    btn("🏠 HOME", "/home"),
    btn("✅ Route check", "/vita check routes"),
    btn("🪙 Tokens", "/tokens"),
  ]);
  rows.push([
    btn("📡 Feed", "/vitafeed"),
    btn("📂 Dir", "/vitafeed dir"),
    btn("🪞 Chain", "/vita chain"),
  ]);
  return { inline_keyboard: rows };
}

export function buildHelpSectionKeyboard(sectionId) {
  const sec = helpSectionById(sectionId);
  if (!sec) return buildHelpNavKeyboard();
  const rows = rowsOf(
    sec.buttons.map((b) => btn(b.label, b.cmd)),
    3,
  );
  rows.push([
    btn("◀ Help", "/help"),
    btn("🏠 HOME", "/home"),
    btn("✅ Check", "/vita check routes"),
  ]);
  return { inline_keyboard: rows };
}

/**
 * Token picker for a verb — /pick sell → buttons /sell AERO · /sell BRETT …
 */
export function buildTokenPickKeyboard(verb, symbols = []) {
  const v = String(verb || "").toLowerCase().replace(/^\//, "");
  if (!TOKEN_PICK_VERBS.includes(v)) {
    return buildHelpSectionKeyboard("trade");
  }
  const syms = [...new Set(
    (symbols || []).map((s) => String(s?.symbol || s || "").toUpperCase()).filter(Boolean),
  )].slice(0, 18);
  const prefix = v === "tok" ? "/tok " : "/" + v + " ";
  const rows = rowsOf(
    syms.map((sym) => {
      const cmd = prefix + sym;
      return cmd.length <= CALLBACK_DATA_MAX
        ? btn("🪙 " + sym, cmd)
        : btn("🪙 " + sym, "/tok " + sym);
    }),
    3,
  );
  rows.push([
    btn("◀ Trade", "/help trade"),
    btn("◀ Help", "/help"),
    btn("🏠 HOME", "/home"),
  ]);
  return { inline_keyboard: rows };
}

export function formatHelpCard() {
  const lines = [
    HELP_ROUTES_MAGIC + "v1|help§",
    "🏄 HELP — every command is a button",
    "━━━━━━━━━━━━━━━━━━━━",
    "Tap a section. Trade verbs open a token box.",
    "Route check = merkle folders + avenue domino → PASS/FLAG.",
    "",
  ];
  for (const sec of HELP_SECTIONS) {
    lines.push(sec.emoji + " " + sec.title + " — " + sec.blurb);
  }
  lines.push("");
  lines.push("/help trade · /pick sell · /vita check routes · /home");
  return lines.join("\n");
}

export function formatHelpSectionCard(sectionId) {
  const sec = helpSectionById(sectionId);
  if (!sec) return formatHelpCard();
  const lines = [
    HELP_ROUTES_MAGIC + "v1|section=" + sec.id + "§",
    sec.emoji + " " + sec.title.toUpperCase(),
    "━━━━━━━━━━━━━━━━━━━━",
    sec.blurb,
    "",
  ];
  for (const b of sec.buttons) {
    lines.push("• " + b.label + " → " + b.cmd);
  }
  lines.push("");
  lines.push("◀ /help · ✅ /vita check routes");
  return lines.join("\n");
}

export function formatTokenPickCard(verb, symbols = []) {
  const v = String(verb || "").toLowerCase();
  const lines = [
    HELP_ROUTES_MAGIC + "v1|pick=" + v + "§",
    "🪙 Pick a token for /" + v,
    "━━━━━━━━━━━━━━━━━━━━",
    "Tap a symbol — runs /" + v + " SYMBOL",
    "Available: " + (symbols.length ? symbols.slice(0, 24).map((s) => String(s?.symbol || s).toUpperCase()).join(" · ") : "(none)"),
  ];
  return lines.join("\n");
}

export function parseHelpCommand(raw) {
  const src = String(raw || "").trim();
  const low = src.toLowerCase();
  if (low === "/help" || low === "/commands" || low === "/?") {
    return { ok: true, action: "help" };
  }
  if (low === "/help check" || low === "/help routes" || low === "/help syscheck") {
    return { ok: true, action: "routes" };
  }
  if (low.startsWith("/help ")) {
    const id = src.slice("/help ".length).trim().toLowerCase();
    if (id === "check" || id === "routes" || id === "syscheck") {
      return { ok: true, action: "routes" };
    }
    if (helpSectionById(id)) return { ok: true, action: "section", section: id };
    return { ok: true, action: "help" };
  }
  return { ok: false, action: null };
}

export function parsePickCommand(raw) {
  const src = String(raw || "").trim();
  const low = src.toLowerCase();
  if (low === "/pick" || low === "/picktoken") {
    return { ok: true, action: "trade", verb: null };
  }
  if (low.startsWith("/pick ")) {
    const verb = src.slice("/pick ".length).trim().split(/\s+/)[0]?.toLowerCase() || "";
    if (!verb) return { ok: true, action: "trade", verb: null };
    if (!TOKEN_PICK_VERBS.includes(verb)) {
      return { ok: false, action: null, reason: "unknown verb: " + verb };
    }
    return { ok: true, action: "pick", verb };
  }
  // Bare verb with no symbol → open picker (not /waves — that stays global).
  for (const v of BARE_PICK_VERBS) {
    if (low === "/" + v) return { ok: true, action: "pick", verb: v };
  }
  return { ok: false, action: null };
}

export function handleHelpAction({
  action = "help",
  section = null,
  verb = null,
  symbols = [],
} = {}) {
  const fit = assertHelpCallbacksFit();
  if (action === "section") {
    const reply = formatHelpSectionCard(section);
    return {
      ok: true,
      action: "section",
      section,
      reply,
      html: "<pre>" + esc(reply) + "</pre>",
      keyboard: buildHelpSectionKeyboard(section),
      callbackFit: fit,
    };
  }
  if (action === "pick") {
    const reply = formatTokenPickCard(verb, symbols);
    return {
      ok: true,
      action: "pick",
      verb,
      reply,
      html: "<pre>" + esc(reply) + "</pre>",
      keyboard: buildTokenPickKeyboard(verb, symbols),
      callbackFit: fit,
    };
  }
  if (action === "trade") {
    return handleHelpAction({ action: "section", section: "trade", symbols });
  }
  const reply = formatHelpCard();
  return {
    ok: true,
    action: "help",
    reply,
    html: "<pre>" + esc(reply) + "</pre>",
    keyboard: buildHelpNavKeyboard(),
    callbackFit: fit,
  };
}

/** Folders whose integrity is walked on every route check. */
export const ROUTE_CHECK_FOLDERS = Object.freeze([
  { id: "vita", path: "vita", role: "mainframe" },
  { id: "vita-memory", path: "vita/memory", role: "append-only-notes" },
  { id: "vita-strands", path: "vita/strands", role: "sparse-plans" },
  { id: "public", path: "public", role: "html-console" },
  { id: "graft", path: "graft", role: "nursery" },
]);

/** Core files that must parse / exist for a healthy container. */
export const ROUTE_CHECK_CORE_FILES = Object.freeze([
  "vita/AGENTS.md",
  "vita/ORIGINAL_FORMULA.md",
  "vita/FILING.md",
  "vita/anchors.json",
  "vita/mainframe.js",
  "vita/telegram-home.js",
  "vita/telegram-clickthrough.js",
  "vita/telegram-help-routes.js",
  "vita/chain-layer.js",
  "vita/vita-dir.js",
  "vita/vita-feed.js",
  "vita/x404-dir.js",
  "vita/agent-chat.js",
  "public/vita.html",
  "public/vita-token-player.html",
  "public/players/garden.html",
  "vita/players/index.js",
  "vita/token-player.js",
  "public/vita-proven-player.html",
  "vita/proven-player.js",
  "vita/proven-player-verify.js",
  "vita/dex-reader.js",
  "vita/multichain-portfolio.js",
]);

function listFilesRecursive(dir, { max = 400, ext = null } = {}) {
  const out = [];
  function walk(d) {
    if (out.length >= max) return;
    let entries = [];
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (out.length >= max) return;
      const p = join(d, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === "node_modules" || ent.name === ".git") continue;
        walk(p);
      } else if (ent.isFile()) {
        if (ext && !ent.name.endsWith(ext)) continue;
        out.push(p);
      }
    }
  }
  walk(dir);
  return out;
}

function fileDigest(absPath) {
  try {
    const buf = readFileSync(absPath);
    return {
      ok: true,
      bytes: buf.length,
      sha256: sha256Hex(buf),
    };
  } catch (e) {
    return { ok: false, reason: e.message || String(e), bytes: 0, sha256: null };
  }
}

function jsonHealth(absPath) {
  try {
    const raw = readFileSync(absPath, "utf8");
    JSON.parse(raw);
    return { ok: true, parse: "json" };
  } catch (e) {
    return { ok: false, parse: "json", reason: e.message || String(e) };
  }
}

/**
 * Merkle-ish folder tree: leaf digests → folder root → container root.
 * Corrupt JSON leaves are flagged; missing core files FAIL the folder.
 */
export function buildFolderMerkleTree({ cwd = REPO_ROOT } = {}) {
  const folders = [];
  for (const f of ROUTE_CHECK_FOLDERS) {
    const abs = join(cwd, f.path);
    const exists = existsSync(abs);
    const leaves = [];
    let corrupt = 0;
    let missing = 0;
    if (!exists) {
      missing = 1;
    } else {
      const files = listFilesRecursive(abs, { max: 200 });
      for (const fp of files.slice(0, 120)) {
        const rel = relative(cwd, fp).replace(/\\/g, "/");
        const dig = fileDigest(fp);
        let status = dig.ok ? "PASS" : "FAIL";
        let detail = dig.ok ? dig.bytes + "B" : dig.reason;
        if (dig.ok && fp.endsWith(".json")) {
          const j = jsonHealth(fp);
          if (!j.ok) {
            status = "FAIL";
            corrupt += 1;
            detail = "corrupt json: " + j.reason;
          }
        }
        leaves.push({
          path: rel,
          status,
          sha256: dig.sha256 ? shortHex(dig.sha256, 12) : null,
          detail,
        });
      }
    }
    const leafRoot = sha256Hex(
      leaves.map((l) => (l.sha256 || "0") + ":" + l.status + ":" + l.path).join("|") || f.id,
    );
    const failLeaves = leaves.filter((l) => l.status === "FAIL");
    const status = !exists
      ? "FAIL"
      : failLeaves.length
        ? "QUESTIONABLE"
        : "PASS";
    folders.push({
      id: f.id,
      path: f.path,
      role: f.role,
      exists,
      leafCount: leaves.length,
      corruptJson: corrupt,
      status,
      root: shortHex(leafRoot, 16),
      rootFull: leafRoot,
      errors: failLeaves.slice(0, 12).map((l) => ({
        path: l.path,
        detail: l.detail,
      })),
      sample: leaves.slice(0, 6),
    });
  }

  const core = [];
  for (const rel of ROUTE_CHECK_CORE_FILES) {
    const abs = join(cwd, rel);
    const dig = fileDigest(abs);
    const status = dig.ok ? "PASS" : "FAIL";
    core.push({
      path: rel,
      status,
      sha256: dig.sha256 ? shortHex(dig.sha256, 12) : null,
      detail: dig.ok ? dig.bytes + "B" : dig.reason || "missing",
    });
  }

  const containerRoot = sha256Hex(
    folders.map((f) => f.rootFull).join("|") +
      "¦" +
      core.map((c) => (c.sha256 || "miss") + c.path).join("|"),
  );
  const folderFail = folders.filter((f) => f.status === "FAIL").length;
  const folderQ = folders.filter((f) => f.status === "QUESTIONABLE").length;
  const coreFail = core.filter((c) => c.status === "FAIL").length;
  let verdict = "PASS";
  if (folderFail || coreFail) verdict = "FAIL";
  else if (folderQ) verdict = "QUESTIONABLE";

  return {
    at: new Date().toISOString(),
    formula: FORMULA_ID,
    containerRoot: shortHex(containerRoot, 16),
    containerRootFull: containerRoot,
    verdict,
    folders,
    core,
    folderFail,
    folderQuestionable: folderQ,
    coreFail,
    neverInventHashes: true,
  };
}

/**
 * Avenue domino: each HOME + HELP route is a node; parent folder status
 * cascades. Min tokens prove trade pickers have a live catalog.
 */
export function runRouteAvenueDomino({
  cwd = REPO_ROOT,
  symbols = [],
  merkle = null,
} = {}) {
  const tree = merkle || buildFolderMerkleTree({ cwd });
  const folderStatus = Object.fromEntries(tree.folders.map((f) => [f.id, f.status]));
  const nodes = [];

  function addNode({ id, avenue, cmd, parentFolder, ok, status, detail }) {
    const parent = parentFolder ? folderStatus[parentFolder] || "PASS" : "PASS";
    let st = status || (ok ? "PASS" : "FAIL");
    // Domino: parent FAIL/QUESTIONABLE soft-flags children.
    if (parent === "FAIL" && st === "PASS") st = "QUESTIONABLE";
    if (parent === "QUESTIONABLE" && st === "PASS") st = "QUESTIONABLE";
    nodes.push({
      id,
      avenue,
      cmd: cmd || null,
      parentFolder: parentFolder || null,
      parentStatus: parent,
      status: st,
      detail: detail || "",
    });
  }

  // Anchors avenue
  const anchorsOk = (MAINFRAME_ANCHORS.known || []).every((a) => /^0x[0-9a-fA-F]{64}$/.test(a.tx));
  addNode({
    id: "anchors",
    avenue: "settlement",
    parentFolder: "vita",
    ok: anchorsOk,
    detail: (MAINFRAME_ANCHORS.known || []).length + " hardcoded locs",
  });

  // Dir master
  try {
    const master = listMasterDirectory();
    addNode({
      id: "vitadir",
      avenue: "filing",
      cmd: "/vitafeed dir",
      parentFolder: "vita",
      ok: master.subdirs?.length >= 8,
      detail: "subdirs=" + (master.subdirs?.length || 0),
    });
  } catch (e) {
    addNode({
      id: "vitadir",
      avenue: "filing",
      cmd: "/vitafeed dir",
      parentFolder: "vita",
      ok: false,
      detail: e.message || String(e),
    });
  }

  // HOME routes callback fit + presence
  const homeFit = assertHomeCallbacksFit();
  addNode({
    id: "home-callbacks",
    avenue: "telegram-home",
    cmd: "/home",
    parentFolder: "vita",
    ok: homeFit.ok,
    detail: homeFit.ok ? allHomeRouteCommands().length + " routes fit≤64" : "bad=" + homeFit.bad.length,
  });
  for (const sec of HOME_SECTIONS) {
    addNode({
      id: "home-" + sec.id,
      avenue: "telegram-home",
      cmd: "/home " + sec.id,
      parentFolder: "vita",
      ok: sec.buttons.length > 0,
      detail: sec.buttons.length + " buttons",
    });
  }

  // HELP routes
  const helpFit = assertHelpCallbacksFit();
  addNode({
    id: "help-callbacks",
    avenue: "telegram-help",
    cmd: "/help",
    parentFolder: "vita",
    ok: helpFit.ok,
    detail: helpFit.ok ? allHelpRouteCommands().length + " routes fit≤64" : "bad=" + helpFit.bad.length,
  });

  // Trade token pickers — min tokens prove catalog
  const syms = [...new Set(
    (symbols || []).map((s) => String(s?.symbol || s || "").toUpperCase()).filter(Boolean),
  )];
  const minTokensOk = syms.length >= 1;
  addNode({
    id: "token-catalog",
    avenue: "trade",
    cmd: "/tokens",
    parentFolder: "vita",
    ok: minTokensOk,
    status: minTokensOk ? "PASS" : "QUESTIONABLE",
    detail: minTokensOk
      ? "minTokens=" + Math.min(3, syms.length) + " of " + syms.length + " (" + syms.slice(0, 3).join(",") + ")"
      : "no tokens loaded — trade pickers empty",
  });
  for (const v of ["buy", "sell", "exit", "piggyunlock"]) {
    const kb = buildTokenPickKeyboard(v, syms.slice(0, 3));
    const cbs = (kb.inline_keyboard || []).flat().map((b) => b.callback_data);
    const ok = !minTokensOk || cbs.some((c) => c === "/" + v + " " + syms[0]);
    addNode({
      id: "pick-" + v,
      avenue: "trade",
      cmd: "/pick " + v,
      parentFolder: "vita",
      ok,
      detail: ok ? "picker → /" + v + " " + (syms[0] || "?") : "picker missing symbol wiring",
    });
  }

  // Core container files as avenue tips
  for (const c of tree.core) {
    addNode({
      id: "core:" + c.path,
      avenue: "container",
      parentFolder: c.path.startsWith("public/") ? "public" : "vita",
      ok: c.status === "PASS",
      status: c.status,
      detail: c.detail,
    });
  }

  const passed = nodes.filter((n) => n.status === "PASS").length;
  const questionable = nodes.filter((n) => n.status === "QUESTIONABLE").length;
  const failed = nodes.filter((n) => n.status === "FAIL").length;
  let verdict = "PASS";
  if (failed) verdict = "FAIL";
  else if (questionable || tree.verdict === "QUESTIONABLE") verdict = "QUESTIONABLE";
  if (tree.verdict === "FAIL") verdict = "FAIL";

  return {
    at: new Date().toISOString(),
    formula: FORMULA_ID,
    messageFirst: ORIGINAL_FORMULA.messageFirstWhenKeyLocCovered,
    containerRoot: tree.containerRoot,
    containerVerdict: tree.verdict,
    verdict,
    passed,
    questionable,
    failed,
    total: nodes.length,
    minTokensUsed: syms.slice(0, 3),
    nodes,
    merkle: tree,
    neverInventHashes: true,
  };
}

function appendRoutesLedger(entry) {
  ensureDirs();
  let cur = { version: 1, entries: [] };
  try {
    if (existsSync(ROUTES_LEDGER)) cur = JSON.parse(readFileSync(ROUTES_LEDGER, "utf8"));
  } catch { /* reset */ }
  if (!Array.isArray(cur.entries)) cur.entries = [];
  cur.entries.push(entry);
  if (cur.entries.length > 80) cur.entries = cur.entries.slice(-80);
  writeFileSync(ROUTES_LEDGER, JSON.stringify(cur, null, 2) + "\n");
}

/**
 * Full route systems check: merkle + domino + chain-layer light check.
 * Stages forced §SYSCHECK§ inject body (Confirm|Override). Logs always.
 */
export async function runRouteSystemsCheck({
  cwd = REPO_ROOT,
  symbols = [],
  write = true,
  includeChainLayer = true,
  env = process.env,
  now = Date.now(),
} = {}) {
  const started = now;
  const merkle = buildFolderMerkleTree({ cwd });
  const domino = runRouteAvenueDomino({ cwd, symbols, merkle });

  let chain = null;
  if (includeChainLayer) {
    try {
      chain = await runSystemsCheck({
        cwd,
        env,
        write,
        now,
        pull: false,
        fetchCalldata: null,
      });
    } catch (e) {
      chain = { ok: false, error: e.message || String(e) };
    }
  }

  const chainPassed = chain?.passed;
  const chainTotal = chain?.total;
  const chainOk = chain && chain.ok !== false && (chainPassed == null || chainPassed === chainTotal);

  let verdict = domino.verdict;
  if (chain && chain.ok === false) verdict = verdict === "PASS" ? "QUESTIONABLE" : verdict;
  if (chain && chainPassed != null && chainTotal != null && chainPassed < chainTotal) {
    if (verdict === "PASS") verdict = "QUESTIONABLE";
  }

  const errorLocs = [
    ...merkle.folders.flatMap((f) =>
      (f.errors || []).map((e) => ({ folder: f.path, path: e.path, detail: e.detail, kind: "folder" })),
    ),
    ...domino.nodes
      .filter((n) => n.status === "FAIL" || n.status === "QUESTIONABLE")
      .map((n) => ({
        folder: n.parentFolder,
        path: n.id,
        detail: n.detail,
        kind: "avenue",
        status: n.status,
        cmd: n.cmd,
      })),
  ];

  const forceBody =
    SYSTEMS_CHECK_MAGIC +
    "v1|routes|verdict=" +
    verdict +
    "|root=" +
    merkle.containerRoot +
    "|at=" +
    new Date(now).toISOString() +
    "§\n" +
    "CONTAINER " +
    verdict +
    " root=" +
    merkle.containerRoot +
    "\n" +
    "DOMINO pass=" +
    domino.passed +
    " q=" +
    domino.questionable +
    " fail=" +
    domino.failed +
    "/" +
    domino.total +
    "\n" +
    "MIN_TOKENS " +
    (domino.minTokensUsed || []).join(",") +
    "\n" +
    (errorLocs.length
      ? "ERRORS\n" + errorLocs.slice(0, 20).map((e) => "  " + e.kind + " " + e.path + " — " + e.detail).join("\n")
      : "ERRORS none — container good\n") +
    "\nProve: Basescan Input Data → UTF-8 after seal. Never invent tx hashes.\n" +
    buildTrackInjectBody({ symbol: "SYSCHECK", note: "route domino " + verdict + " root=" + merkle.containerRoot });

  const elapsedMs = Date.now() - started;
  const report = {
    at: new Date(now).toISOString(),
    topic: "systems-check-routes",
    filingLabel: ROUTE_CHECK_LABEL,
    magic: SYSTEMS_CHECK_MAGIC,
    formula: FORMULA_ID,
    verdict,
    containerGood: verdict === "PASS",
    containerRoot: merkle.containerRoot,
    elapsedMs,
    domino: {
      passed: domino.passed,
      questionable: domino.questionable,
      failed: domino.failed,
      total: domino.total,
      minTokensUsed: domino.minTokensUsed,
    },
    merkle: {
      verdict: merkle.verdict,
      folderFail: merkle.folderFail,
      folderQuestionable: merkle.folderQuestionable,
      coreFail: merkle.coreFail,
      folders: merkle.folders.map((f) => ({
        id: f.id,
        path: f.path,
        status: f.status,
        root: f.root,
        leafCount: f.leafCount,
        corruptJson: f.corruptJson,
        errors: f.errors,
      })),
    },
    chainLayer: chain
      ? {
          ok: chainOk,
          passed: chainPassed,
          total: chainTotal,
          snarkRoot: chain.snark?.root || chain.result?.snark?.root || null,
          error: chain.error || null,
        }
      : null,
    errorLocations: errorLocs,
    forceInjectBody: forceBody,
    forceInjectStaged: true,
    neverInventHashes: true,
    nodes: domino.nodes,
  };

  if (write) {
    ensureDirs();
    const cyclePath = join(MEMORY_DIR, "systems-check-routes-" + String(now) + ".json");
    writeFileSync(cyclePath, JSON.stringify(report, null, 2) + "\n");
    writeFileSync(ROUTES_LATEST, JSON.stringify(report, null, 2) + "\n");
    appendRoutesLedger({
      at: report.at,
      verdict,
      containerRoot: merkle.containerRoot,
      passed: domino.passed,
      questionable: domino.questionable,
      failed: domino.failed,
      total: domino.total,
      errorCount: errorLocs.length,
      elapsedMs,
    });
    writeFileSync(
      ROUTES_STRAND,
      JSON.stringify(
        {
          strandId: "systems-check-routes",
          filingLabel: ROUTE_CHECK_LABEL,
          at: report.at,
          verdict,
          containerRoot: merkle.containerRoot,
          note:
            "Route domino + folder merkle. Force-stage §SYSCHECK§ for chain seal. " +
            "Never invent hashes. Read container good vs corrupted via errorLocations.",
          locations: [],
        },
        null,
        2,
      ) + "\n",
    );
  }

  return report;
}

export function formatRouteSystemsCheckCard(report) {
  if (!report) return SYSTEMS_CHECK_MAGIC + " MISS";
  const lines = [];
  lines.push(SYSTEMS_CHECK_MAGIC + "v1|routes|verdict=" + report.verdict + "§");
  lines.push("✅ ROUTE SYSTEMS CHECK — " + report.verdict);
  lines.push("━━━━━━━━━━━━━━━━━━━━");
  lines.push("containerRoot=" + report.containerRoot);
  lines.push(
    "domino pass=" +
      report.domino.passed +
      " q=" +
      report.domino.questionable +
      " fail=" +
      report.domino.failed +
      "/" +
      report.domino.total,
  );
  lines.push("minTokens=" + ((report.domino.minTokensUsed || []).join(",") || "(none)"));
  lines.push("elapsed=" + report.elapsedMs + "ms · good=" + (report.containerGood ? "YES" : "NO"));
  if (report.chainLayer) {
    lines.push(
      "chainLayer " +
        (report.chainLayer.ok ? "OK" : "FLAG") +
        (report.chainLayer.passed != null
          ? " " + report.chainLayer.passed + "/" + report.chainLayer.total
          : "") +
        (report.chainLayer.error ? " err=" + report.chainLayer.error : ""),
    );
  }
  lines.push("");
  lines.push("— FOLDERS —");
  for (const f of report.merkle?.folders || []) {
    const mark = f.status === "PASS" ? "✓" : f.status === "QUESTIONABLE" ? "?" : "✗";
    lines.push(
      mark +
        " " +
        f.path +
        " [" +
        f.status +
        "] leaves=" +
        f.leafCount +
        " root=" +
        f.root +
        (f.corruptJson ? " corruptJson=" + f.corruptJson : ""),
    );
  }
  const flagged = (report.nodes || []).filter((n) => n.status !== "PASS").slice(0, 16);
  if (flagged.length) {
    lines.push("");
    lines.push("— FLAGGED AVENUES —");
    for (const n of flagged) {
      const mark = n.status === "QUESTIONABLE" ? "?" : "✗";
      lines.push(mark + " " + n.id + " " + (n.cmd || "") + " — " + n.detail);
    }
  } else {
    lines.push("");
    lines.push("— FLAGGED AVENUES — none");
  }
  if ((report.errorLocations || []).length) {
    lines.push("");
    lines.push("— ERROR LOCATIONS —");
    for (const e of report.errorLocations.slice(0, 12)) {
      lines.push("  " + e.kind + " · " + e.path + " · " + e.detail);
    }
  }
  lines.push("");
  lines.push("Forced inject staged — tap Confirm|Override to seal §SYSCHECK§ on Base.");
  lines.push("Log: vita/memory/systems-check-routes-latest.json");
  lines.push("Never invent tx hashes. Plain text proves; chain seal densifies.");
  return lines.join("\n");
}

export function buildRouteCheckKeyboard() {
  return {
    inline_keyboard: [
      [
        btn("✅ Re-check", "/vita check routes"),
        btn("⛓ Full check", "/vita check"),
        btn("📦 Locs", "/vita check locs"),
      ],
      [
        btn("⚡ Override seal", "/vitafeed override"),
        btn("✅ Confirm seal", "/vitafeed confirm"),
        btn("🧪 Track", "/vitafeed track SYSCHECK"),
      ],
      [
        btn("◀ Help", "/help"),
        btn("🏠 HOME", "/home"),
        btn("🪙 Tokens", "/tokens"),
      ],
    ],
  };
}

/** Re-export helpers other modules may want. */
export {
  buildVitaFeedRootKeyboard,
  buildVitaFeedStagedKeyboard,
  buildTokenCatalogKeyboard,
  SYSTEMS_CHECK_LABEL,
};
