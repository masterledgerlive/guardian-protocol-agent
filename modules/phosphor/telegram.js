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
        { text: "▶ Self-test", web_app: { url: testHref } },
        { text: "↗ Self-test", url: testHref },
      ],
    ],
  };
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
    "<code>/phosphor test</code> — boot from wires and round-trip a note + beep",
    "CRT: <a href=\"" + esc(href) + "\">" + esc(href) + "</a>",
  ].join("\n");
}

export async function handlePhosphorCommand(raw) {
  const text = String(raw || "").trim().toLowerCase();
  const keyboard = buildPhosphorPopupKeyboard();
  if (text === "/phosphor test" || text === "/phosphor selftest") {
    const { runStartup } = await import("./startup.js");
    const result = await runStartup({ tryIpfs: false });
    const body = esc(result.log).slice(0, 3200);
    return {
      html: "<b>PHOSPHOR SELF-TEST</b> " + (result.ok ? "OK" : "FAIL") + "\n<pre>" + body + "</pre>",
      keyboard,
      result,
    };
  }
  return { html: phosphorHelpHtml(), keyboard, result: null };
}
