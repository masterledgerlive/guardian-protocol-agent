/**
 * Telegram click-through — every category + subcategory is a button.
 *
 * Paths (all ≤64B callback_data):
 *   /vitafeed              → root categories
 *   /vitafeed dir          → master VITA:\ subdirs
 *   /vitafeed dir CODEX    → files in subdir
 *   /vitafeed unlock …     → English + machine + player + dual + track
 *   /tok SYMBOL            → buy / sell / exit / piggy / status
 *   /tokens                → token catalog
 *
 * File cards put static SNARK-short + path first; human plain + machine key
 * lanes follow with ms timing so both routes prove as you click.
 *
 * Mother brain untouched. Never invents tx hashes.
 */

import { CALLBACK_DATA_MAX, telegramCallbackData } from "./mirror-chain.js";
import {
  VITADIR_SUBDIRS,
  listMasterDirectory,
  listSubDirectory,
  unlockDirectoryEntry,
} from "./vita-dir.js";

export const CLICKTHROUGH_ID = "vita-telegram-clickthrough-v1";
export const CLICKTHROUGH_MAGIC = "§VITACLICK§";

/** Re-export for callers that only import this module. */
export { CALLBACK_DATA_MAX, telegramCallbackData };

function btn(text, cmd) {
  return { text: String(text).slice(0, 64), callback_data: telegramCallbackData(cmd) };
}

function rowsOf(buttons, perRow = 2) {
  const rows = [];
  const list = Array.isArray(buttons) ? buttons.filter(Boolean) : [];
  for (let i = 0; i < list.length; i += perRow) {
    rows.push(list.slice(i, i + perRow));
  }
  return rows;
}

function clipName(name, max = 28) {
  const s = String(name || "").replace(/^vita\//, "");
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)) + "…";
}

/** Root VITAFEED categories — every next step is a tap. */
export function buildVitaFeedRootKeyboard() {
  return {
    inline_keyboard: [
      [
        btn("📂 Dir", "/vitafeed dir"),
        btn("🧒 KIDS", "/vitafeed play kids"),
        btn("📚 Files", "/vitafeed files"),
        btn("🔑 Keys", "/vitafeed keys"),
      ],
      [
        btn("🧠 Brain", "/vitafeed brain"),
        btn("📦 Backlog", "/vitafeed backlog"),
        btn("▶️ Next", "/vitafeed next"),
      ],
      [
        btn("🔤 Dual", "/vitafeed translate"),
        btn("📥 Load", "/vitafeed load"),
        btn("💡 Know", "/vitafeed know"),
      ],
      [
        btn("🔐 Cipher", "/vitafeed cipher"),
        btn("📎 File", "/vitafeed file"),
        btn("🧪 Track", "/vitafeed track"),
      ],
      [
        btn("✅ Confirm", "/vitafeed confirm"),
        btn("⚡ Override", "/vitafeed override"),
        btn("❌ Cancel", "/vitafeed cancel"),
      ],
      [
        btn("🪙 Tokens", "/tokens"),
        btn("🪞 /vita files", "/vita files"),
        btn("⛓ Chain", "/vita chain"),
      ],
      [
        btn("🤖 Agents", "/home agents"),
        btn("🏠 HOME", "/home"),
      ],
    ],
  };
}

/** Staged cost-card next steps. */
export function buildVitaFeedStagedKeyboard() {
  return {
    inline_keyboard: [
      [
        btn("✅ Confirm", "/vitafeed confirm"),
        btn("⚡ Override", "/vitafeed override"),
        btn("❌ Cancel", "/vitafeed cancel"),
      ],
      [
        btn("📂 Dir", "/vitafeed dir"),
        btn("📚 Files", "/vitafeed files"),
        btn("🏠 Menu", "/vitafeed"),
      ],
    ],
  };
}

/** Master VITA:\ — each subdir is clickable. */
export function buildDirMasterKeyboard(master = listMasterDirectory()) {
  const subBtns = (master?.subdirs || VITADIR_SUBDIRS).map((d) => {
    const name = d.name || d;
    const n = d.files != null ? ` (${d.files})` : "";
    return btn("📁 " + name + n, "/vitafeed dir " + name);
  });
  const rows = rowsOf(subBtns, 2);
  rows.push([
    btn("📊 Stats", "/vitafeed dir"),
    btn("🏠 Menu", "/vitafeed"),
    btn("🪙 Tokens", "/tokens"),
  ]);
  return { inline_keyboard: rows };
}

/** Subdir listing — each file unlocks on tap. */
export function buildDirSubKeyboard(listed) {
  if (!listed?.ok || listed.master) return buildDirMasterKeyboard();
  const sub = String(listed.subdir || "").toUpperCase();
  const fileBtns = (listed.entries || []).slice(0, 24).map((e) => {
    const path = sub + "\\" + (e.unlockName || e.name);
    const byPath = "/vitafeed unlock " + path;
    const byIndex = "/vitafeed unlock " + sub + "\\" + e.n;
    // Prefer full path; fall back to index when callback would truncate.
    const cmd = byPath.length <= CALLBACK_DATA_MAX ? byPath : byIndex;
    return btn("📄 " + clipName(e.name, 26), cmd);
  });
  const rows = rowsOf(fileBtns, 1);
  if (sub === "KIDS") {
    rows.unshift([
      btn("▶️ Play KIDS", "/vitafeed play kids"),
      btn("🔤 Dual KIDS", "/vitafeed dual kids"),
    ]);
  }
  rows.push([
    btn("⬆️ Up VITA:\\", "/vitafeed dir"),
    btn("🏠 Menu", "/vitafeed"),
  ]);
  return { inline_keyboard: rows };
}

/**
 * After unlock — human / machine / player / dual / track inject.
 * Path kept short so callback_data fits.
 */
export function buildUnlockKeyboard(result) {
  const path =
    result?.path ||
    (result?.entry?.name
      ? String(result.source || "CODEX") + "\\" + result.entry.name
      : "");
  const shortPath = String(path || "").replace(/^VITA:\\/i, "");
  const unlockCmd = shortPath ? "/vitafeed unlock " + shortPath : "/vitafeed dir";
  const playHint = result?.goalHint || "";
  const youtubePlay =
    result?.entry?.playKind === "youtube" ||
    result?.entry?.kind === "youtube" ||
    /kids url|youtube/i.test(playHint);
  const playCmd = youtubePlay
    ? (result?.entry?.playIndex
        ? "/vitafeed play kids " + result.entry.playIndex
        : "/vitafeed play kids")
    : /song|audio|movie|video|play/i.test(playHint) && result?.entry?.name
      ? "/vitafeed play " + result.entry.name
      : "/vitafeed files";
  const dualSeed = clipName(
    result?.entry?.trueName || result?.entry?.name || "open unlock",
    20,
  );
  const dualCmd =
    ("/vitafeed dual " + dualSeed).length <= CALLBACK_DATA_MAX
      ? "/vitafeed dual " + dualSeed
      : "/vitafeed dual";
  const src = String(result?.source || "").toUpperCase();
  const rows = [
    [
      btn("👁 Human", unlockCmd.length <= CALLBACK_DATA_MAX ? unlockCmd : "/vitafeed dir"),
      btn("🤖 Machine", unlockCmd.length <= CALLBACK_DATA_MAX ? unlockCmd : "/vitafeed dir"),
      btn("▶️ Play", playCmd.length <= CALLBACK_DATA_MAX ? playCmd : "/vitafeed files"),
    ],
    [
      btn("🔤 Dual lanes", dualCmd),
      btn("🧪 Track inject", "/vitafeed track"),
      btn("📡 Stage feed", "/vitafeed"),
    ],
    [
      btn("⬆️ " + (src || "Dir"), src ? "/vitafeed dir " + src : "/vitafeed dir"),
      btn("📂 Master", "/vitafeed dir"),
      btn("🏠 Menu", "/vitafeed"),
    ],
  ];
  return { inline_keyboard: rows };
}

/** Library files → play. */
export function buildLibraryFilesKeyboard(entries = []) {
  const list = Array.isArray(entries) ? entries : [];
  const fileBtns = list.slice(0, 12).map((e, i) => {
    const n = e.n != null ? e.n : i + 1;
    const name = e.name || e.entry?.name || "#" + n;
    return btn("▶️ " + clipName(name, 28), "/vitafeed play " + n);
  });
  const rows = rowsOf(fileBtns, 1);
  rows.push([
    btn("🔑 Keys", "/vitafeed keys"),
    btn("📂 Dir", "/vitafeed dir"),
    btn("🏠 Menu", "/vitafeed"),
  ]);
  return { inline_keyboard: rows };
}

/** Token catalog — tap a symbol for action submenu. */
export function buildTokenCatalogKeyboard(symbols = []) {
  const syms = (symbols || [])
    .map((s) => String(s?.symbol || s || "").toUpperCase())
    .filter(Boolean);
  const unique = [...new Set(syms)].slice(0, 18);
  const rows = rowsOf(
    unique.map((sym) => btn("🪙 " + sym, "/tok " + sym)),
    3,
  );
  rows.push([
    btn("💼 Bag", "/bag"),
    btn("📡 Vitafeed", "/vitafeed"),
    btn("📂 Dir", "/vitafeed dir"),
  ]);
  return { inline_keyboard: rows };
}

/** Token submenu — what to do with the selected symbol. */
export function buildTokenActionKeyboard(symbol) {
  const sym = String(symbol || "").toUpperCase();
  if (!sym) return buildTokenCatalogKeyboard();
  return {
    inline_keyboard: [
      [
        btn("🟢 Buy", "/buy " + sym),
        btn("🔴 Sell", "/sell " + sym),
        btn("½ Half", "/sellhalf " + sym),
      ],
      [
        btn("🚪 Exit", "/exit " + sym),
        btn("🐷 Piggy", "/piggyunlock " + sym),
        btn("📊 Status", "/status"),
      ],
      [
        btn("📡 Feed dual", "/vitafeed dual " + sym),
        btn("🧪 Track", "/vitafeed track " + sym),
        btn("⬅️ Tokens", "/tokens"),
      ],
      [btn("🏠 Menu", "/vitafeed"), btn("💼 Bag", "/bag")],
    ],
  };
}

/**
 * Attach the right keyboard for a vitafeed action result.
 */
export function keyboardForVitaFeedResult({ action, out = {}, body = "" } = {}) {
  const act = String(action || out.phase || "").toLowerCase();
  if (act === "dir") {
    if (out.listed && !out.listed.master) return buildDirSubKeyboard(out.listed);
    return buildDirMasterKeyboard(out.master || listMasterDirectory());
  }
  if (act === "unlock") {
    return buildUnlockKeyboard(out.unlocked || out);
  }
  if (act === "files") {
    return buildLibraryFilesKeyboard(out.entries || out.items || out.files || []);
  }
  if (act === "kids" || (act === "play" && (out.play?.kind === "youtube" || /kids-player/.test(String(out.reply || out.playerPath || ""))))) {
    return buildDirSubKeyboard({
      ok: true,
      master: false,
      subdir: "KIDS",
      entries: [],
    });
  }
  if (act === "preview" || act === "dual" || act === "translate" || act === "brain" || act === "next" || act === "keys" || act === "enqueue") {
    return buildVitaFeedStagedKeyboard();
  }
  if (act === "confirm" || act === "override" || act === "track") {
    return buildVitaFeedStagedKeyboard();
  }
  if (act === "usage" || act === "file" || !act) {
    return buildVitaFeedRootKeyboard();
  }
  if (act === "backlog" || act === "load" || act === "know" || act === "recall" || act === "cipher" || act === "ref" || act === "proven" || act === "learn" || act === "proof" || act === "restart") {
    return buildVitaFeedRootKeyboard();
  }
  // Fallback: keep browsing reachable.
  void body;
  return buildVitaFeedRootKeyboard();
}

/**
 * Dual-route timing proof — human plain vs machine SNARK-short.
 * Plain text alone is enough proof; SNARK key unlocks denser lane.
 */
export function timeDualRoutes({ english = "", machine = "", packed = null } = {}) {
  const t0 = Date.now();
  const human = String(english || "");
  const tHuman = Date.now();
  const machineBody = String(machine || packed?.short || "");
  const key = packed?.commit ? "ZK§" + String(packed.commit).slice(0, 12) : packed?.short || "";
  const tMachine = Date.now();
  return {
    humanMs: Math.max(0, tHuman - t0),
    machineMs: Math.max(0, tMachine - tHuman),
    totalMs: Math.max(0, tMachine - t0),
    humanBytes: Buffer.byteLength(human, "utf8"),
    machineBytes: Buffer.byteLength(machineBody, "utf8"),
    snarkKey: key,
    humanOk: human.length > 0,
    machineOk: machineBody.length > 0,
    plainTextProof: human.length > 0,
    snarkUnlocksDenser: Boolean(key),
  };
}

/** Tracking body for inject / message-sent proof (never invents hashes). */
export function buildTrackInjectBody({ symbol = "", note = "" } = {}) {
  const at = new Date().toISOString();
  const tag = String(symbol || "TRACK").toUpperCase().slice(0, 12);
  const line = String(note || "telegram click-through track — prove message + running code path");
  return (
    CLICKTHROUGH_MAGIC +
    "v1|track|" +
    tag +
    "|" +
    at +
    "§\n" +
    "HUMAN " +
    line +
    "\n" +
    "MACHINE TRACK tag=" +
    tag +
    " at=" +
    at +
    " route=telegram-clickthrough\n" +
    "Prove: Basescan Input Data → UTF-8 after seal. Never invent tx hashes."
  );
}

/**
 * Parse /tok SYMBOL and /tokens for agent wiring.
 */
export function parseTokenClickCommand(raw) {
  const src = String(raw || "").trim();
  const low = src.toLowerCase();
  if (low === "/tokens" || low === "/tok" || low === "/token") {
    return { ok: true, action: "catalog" };
  }
  if (low.startsWith("/tok ") || low.startsWith("/token ")) {
    const sym = src.replace(/^\/tok(?:en)?\s+/i, "").trim().split(/\s+/)[0]?.toUpperCase() || "";
    if (!sym) return { ok: true, action: "catalog" };
    return { ok: true, action: "token", symbol: sym };
  }
  return { ok: false, action: null };
}

export function formatTokenClickCard(symbol, { symbols = [] } = {}) {
  const sym = String(symbol || "").toUpperCase();
  if (!sym) {
    const lines = [CLICKTHROUGH_MAGIC + "v1|tokens§", "🪙 TOKEN CATALOG — tap a symbol"];
    for (const s of symbols.slice(0, 24)) {
      lines.push("  · " + String(s?.symbol || s).toUpperCase());
    }
    lines.push("", "Tap → buy / sell / exit / piggy / dual / track");
    return lines.join("\n");
  }
  return [
    CLICKTHROUGH_MAGIC + "v1|tok=" + sym + "§",
    "🪙 " + sym + " — pick an action",
    "Buy · Sell · Half · Exit · Piggy · Status",
    "Dual lane · Track inject · back to /tokens",
  ].join("\n");
}

/**
 * Smoke: walk master → first subdir → first file unlock → keyboard present.
 * Used by tests; no network, no invented hashes.
 */
export function smokeClickThroughWalk() {
  const master = listMasterDirectory();
  const masterKb = buildDirMasterKeyboard(master);
  const firstSub = (master.subdirs || [])[0]?.name || "CODEX";
  const listed = listSubDirectory(firstSub);
  const subKb = buildDirSubKeyboard(listed);
  const firstFile = listed.entries?.[0];
  const unlocked = firstFile
    ? unlockDirectoryEntry(firstSub + "\\" + (firstFile.unlockName || firstFile.name))
    : { ok: false };
  const unlockKb = unlocked.ok ? buildUnlockKeyboard(unlocked) : null;
  const rootKb = buildVitaFeedRootKeyboard();
  const allCallbacks = [
    ...rootKb.inline_keyboard,
    ...masterKb.inline_keyboard,
    ...subKb.inline_keyboard,
    ...(unlockKb?.inline_keyboard || []),
  ]
    .flat()
    .map((b) => b.callback_data || b.url || "");

  const timing = unlocked.ok
    ? timeDualRoutes({
        english: unlocked.reveal?.english,
        machine: unlocked.reveal?.machine,
        packed: unlocked.packed,
      })
    : null;

  return {
    ok: Boolean(masterKb.inline_keyboard?.length && subKb.inline_keyboard?.length && rootKb.inline_keyboard?.length),
    masterSubdirs: master.subdirs?.length || 0,
    subFiles: listed.entries?.length || 0,
    unlocked: Boolean(unlocked.ok),
    unlockPath: unlocked.path || null,
    callbackCount: allCallbacks.length,
    allFit64: allCallbacks.every((c) => !c || c.length <= CALLBACK_DATA_MAX),
    timing,
    snarkFirst: unlocked.packed?.short || null,
  };
}
