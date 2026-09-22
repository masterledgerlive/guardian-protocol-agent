/**
 * Telegram pop-out for the PHOSPHOR CRT.
 * web_app is the in-chat window. url is the fallback when BotFather has no domain.
 */

const PRODUCTION = "https://guardian-protocol-agent-production.up.railway.app";

export function phosphorOrigin(env = process.env) {
  const explicit = String(env.PHOSPHOR_PUBLIC_URL || env.VITA_PUBLIC_URL || env.VITA_PUBLIC_ORIGIN || "").trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const railway = String(env.RAILWAY_PUBLIC_DOMAIN || "").trim();
  if (railway) {
    return /^https?:\/\//i.test(railway)
      ? railway.replace(/\/+$/, "")
      : "https://" + railway.replace(/\/+$/, "");
  }
  return PRODUCTION;
}

export function phosphorHref(env = process.env) {
  const url = new URL(phosphorOrigin(env) + "/phosphor");
  url.searchParams.set("popup", "1");
  return url.toString();
}

function esc(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function buildPhosphorPopupKeyboard(env = process.env) {
  const href = phosphorHref(env);
  const testHref = href + "&test=1";
  return {
    inline_keyboard: [
      [
        { text: "▶ PHOSPHOR CRT", web_app: { url: href } },
        { text: "↗ Open CRT", url: href },
      ],
      [
        { text: "LIBRARY", callback_data: "/phosphor dir" },
        { text: "▶ Self-test", web_app: { url: testHref } },
      ],
    ],
  };
}

function folderKeyboard(folders) {
  const rows = (folders || []).map((folder) => [{
    text: folder.id,
    callback_data: "/phosphor dir " + folder.id,
  }]);
  rows.push([{ text: "CRT", callback_data: "/phosphor" }]);
  return { inline_keyboard: rows };
}

function fileKeyboard(items, env) {
  const href = phosphorHref(env);
  const rows = (items || []).map((item) => [{
    text: item.name.slice(0, 40),
    callback_data: ("/phosphor open " + item.commit.slice(0, 12)).slice(0, 64),
  }, {
    text: "↗ player",
    url: href + "&play=" + item.commit.slice(0, 12),
  }]);
  rows.push([{ text: "folders", callback_data: "/phosphor dir" }]);
  return { inline_keyboard: rows };
}

export function phosphorHelpHtml() {
  const href = phosphorHref();
  return [
    "<b>PHOSPHOR</b> — chain writer / reader",
    "The injector wire store is the new IPFS. IPFS itself stays an outlet.",
    "Drop any file in the green CRT. Watch the squash, the pre-embedded <code>PHOSOPEN</code> key, and the packet count.",
    "A lock passphrase wraps AES-256-GCM and stays off the header.",
    "Each file is a snark squash. The module library folds into one stark-class root.",
    "Inject receipt: <code>SYSTEM_INJECTED</code> · click a block for its exact data field · header <code>next=</code> chains the blocks · filing loc is <code>stark://</code> compressed. Base loc stays empty. The key pieces the code back together.",
    "Groth16 and Winterfell stay unwired. Chain location stays empty until a real Base seal.",
    "",
    "<code>/phosphor</code> — this card + pop-out",
    "<code>/phosphor dir</code> — folder library (PLAY, PICTURE, FILES)",
    "<code>/phosphor open PREFIX</code> — file card, formula, and player",
    "<code>/phosphor key PREFIX PASSPHRASE</code> — unwrap when the formula says LOCK",
    "<code>/phosphor test</code> — boot from wires and round-trip a note + beep",
    "CRT: <a href=\"" + esc(href) + "\">" + esc(href) + "</a>",
  ].join("\n");
}

function fileCard(item) {
  const lines = [
    "<b>" + esc(item.folder) + "</b> · " + esc(item.name),
    "formula <code>" + esc(item.directory || "") + "</code>",
    "final <code>" + esc(item.filingLoc) + "</code>",
    "raw " + item.rawBytes + " → payload " + item.payloadBytes + " → directory " + item.directoryBytes,
    "data field " + item.dataFieldBytes + " bytes",
    item.shorterThanData ? "directory is shorter than the data field" : "directory is not shorter than the data field",
    item.shorterThanRaw ? "directory is shorter than the original" : "directory is not shorter than the original",
    item.keyAttached ? "open key attached · " + esc(item.openKey) : "lock set — send <code>/phosphor key " + esc(item.commit.slice(0, 12)) + " PASSPHRASE</code>",
    "base loc empty · basescan none until a real seal",
  ];
  return lines.join("\n");
}

export async function handlePhosphorCommand(raw, { stateDir, env = process.env } = {}) {
  const text = String(raw || "").trim();
  const lower = text.toLowerCase();
  const keyboard = buildPhosphorPopupKeyboard(env);
  if (lower === "/phosphor test" || lower === "/phosphor selftest") {
    const { runStartup } = await import("./startup.js");
    const result = await runStartup({ tryIpfs: false });
    const body = esc(result.log).slice(0, 3200);
    return {
      html: "<b>PHOSPHOR SELF-TEST</b> " + (result.ok ? "OK" : "FAIL") + "\n<pre>" + body + "</pre>",
      keyboard,
      result,
    };
  }
  if (lower === "/phosphor dir" || lower.startsWith("/phosphor dir ")) {
    const { ensurePlayLibrary } = await import("./library.js");
    const { defaultStateDir } = await import("./chain-store.js");
    const lib = await ensurePlayLibrary(stateDir || defaultStateDir());
    const folder = text.slice("/phosphor dir".length).trim().toUpperCase();
    if (!folder) {
      return {
        html: "<b>PHOSPHOR LIBRARY</b>\nClick a folder. Each file carries its unlock and the short location directory. Base loc stays empty until a real seal.",
        keyboard: folderKeyboard(lib.folders),
        result: lib,
      };
    }
    const picked = (lib.folders || []).find((row) => row.id === folder);
    if (!picked) {
      return { html: "folder missing", keyboard: folderKeyboard(lib.folders), result: lib };
    }
    return {
      html: "<b>" + esc(folder) + "</b>\n" + picked.items.map((item) => esc(item.name) + " · " + esc(item.filingLoc)).join("\n"),
      keyboard: fileKeyboard(picked.items, env),
      result: lib,
    };
  }
  if (lower.startsWith("/phosphor open ")) {
    const { ensurePlayLibrary } = await import("./library.js");
    const { defaultStateDir } = await import("./chain-store.js");
    const prefix = text.split(/\s+/)[2] || "";
    const lib = await ensurePlayLibrary(stateDir || defaultStateDir());
    const item = (lib.items || []).find((row) => row.commit.startsWith(prefix));
    if (!item) return { html: "file missing", keyboard, result: lib };
    return { html: fileCard(item), keyboard: fileKeyboard([item], env), result: item };
  }
  if (lower.startsWith("/phosphor key ")) {
    const { ensurePlayLibrary } = await import("./library.js");
    const { defaultStateDir } = await import("./chain-store.js");
    const { unwrapDirectory } = await import("./directory.js");
    const parts = text.trim().split(/\s+/);
    const prefix = parts[2] || "";
    const passphrase = parts.slice(3).join(" ");
    const dir = stateDir || defaultStateDir();
    const lib = await ensurePlayLibrary(dir);
    const item = (lib.items || []).find((row) => row.commit.startsWith(prefix));
    if (!item) return { html: "file missing", keyboard, result: lib };
    if (item.keyAttached) {
      return {
        html: "open key attached · <code>" + esc(item.openKey) + "</code>\nno passphrase required",
        keyboard: fileKeyboard([item], env),
        result: { basescan: null, bytes: item.rawBytes },
      };
    }
    if (!passphrase) {
      return {
        html: "key required to unwrap snark\nsend <code>/phosphor key " + esc(prefix) + " PASSPHRASE</code>",
        keyboard: fileKeyboard([item], env),
        result: { basescan: null, keyRequired: true },
      };
    }
    try {
      const opened = unwrapDirectory(dir, item.filingLoc, passphrase);
      return {
        html: "recovered " + opened.raw.length + " bytes\nfinal <code>" + esc(item.filingLoc) + "</code>\nbase loc empty · basescan none until a real seal",
        keyboard: fileKeyboard([item], env),
        result: { basescan: null, bytes: opened.raw.length, baseLocation: null },
      };
    } catch (error) {
      return {
        html: esc(error.message || "unwrap failed"),
        keyboard: fileKeyboard([item], env),
        result: { basescan: null },
      };
    }
  }
  return { html: phosphorHelpHtml(), keyboard, result: null };
}
