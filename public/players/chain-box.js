/**
 * Browser chain-box widget.
 * Fetches /vita/players/chain-box?player=… and mounts a real <a href>
 * that opens Basescan (Telegram.WebApp.openLink inside Mini Apps).
 * Visible in kids/proof-off. Hidden only when html.kids-locked.
 */
(function (global) {
  const CSS_ID = "vita-chain-box-css";

  function ensureCss(css) {
    if (document.getElementById(CSS_ID)) return;
    const s = document.createElement("style");
    s.id = CSS_ID;
    s.textContent = css || (
      ".vita-chain-box{display:inline-flex;align-items:center;gap:.45rem;position:relative;z-index:35;pointer-events:auto!important;cursor:pointer;text-decoration:none;color:inherit;border:2px solid currentColor;background:#fff;padding:.38rem .7rem;font-family:ui-monospace,monospace;font-size:.72rem}" +
      ".vita-chain-box:hover,.vita-chain-box:focus{outline:2px solid #2a9d8f;outline-offset:2px}" +
      ".vita-chain-box .cb-kind{font-size:.62rem;padding:.1rem .35rem;background:#2a9d8f;color:#fff;font-weight:700}" +
      ".vita-chain-box.class-proof .cb-kind{background:#1a6b8a}" +
      "html.kids-locked .vita-chain-box{display:none!important}"
    );
    document.head.appendChild(s);
  }

  function isTelegramMiniApp() {
    try {
      const tg = global.Telegram && global.Telegram.WebApp;
      if (!tg || typeof tg.openLink !== "function") return false;
      if (String(tg.initData || "").length > 0) return true;
      const unsafe = tg.initDataUnsafe || {};
      return Boolean(unsafe.user || unsafe.query_id || unsafe.hash);
    } catch (_) {
      return false;
    }
  }

  function openChain(href, ev) {
    if (!href || href === "#") return;
    // telegram-web-app.js always defines openLink. Using it outside a Mini App
    // preventDefault's the native <a> and Basescan never opens.
    if (isTelegramMiniApp()) {
      if (ev) {
        ev.preventDefault();
        ev.stopPropagation();
      }
      try { global.Telegram.WebApp.openLink(href); } catch (_) {
        global.open(href, "_blank", "noopener");
      }
      return;
    }
    if (ev && ev.currentTarget && String(ev.currentTarget.tagName || "").toUpperCase() === "A") {
      return;
    }
    if (ev) ev.preventDefault();
    global.open(href, "_blank", "noopener");
  }

  function bind(node) {
    if (!node || node.dataset.bound === "1") return;
    node.dataset.bound = "1";
    node.addEventListener("click", function (ev) {
      const href = node.getAttribute("href");
      openChain(href, ev);
    });
  }

  function paint(mount, box) {
    if (!mount || !box || !box.href) return null;
    ensureCss(box.css);
    const id = box.identify || {};
    const a = document.createElement("a");
    a.className = "vita-chain-box" + (box.classProof ? " class-proof" : " sealed-body");
    a.id = "vitaChainBox";
    a.href = box.href;
    a.target = "_blank";
    a.rel = "noopener";
    a.dataset.player = box.player || "";
    a.dataset.kind = box.kind || "";
    a.dataset.loc = box.location || "";
    a.title = box.note || box.label || "Open Basescan Input Data";
    a.innerHTML =
      "<span class=\"cb-name\">" + (box.name || "PLAYER") + "</span>" +
      "<span class=\"cb-id\"><b>" + (id.front || "") + "</b><i>·</i><b>" + (id.mid || "") + "</b><i>·</i><b>" + (id.back || "") + "</b></span>" +
      "<span class=\"cb-kind\">" + (box.classProof ? "CLASS PROOF" : "ON-CHAIN") + "</span>";
    mount.innerHTML = "";
    mount.appendChild(a);
    bind(a);
    return a;
  }

  async function mount(selector, opts) {
    const el = typeof selector === "string" ? document.querySelector(selector) : selector;
    if (!el) return null;
    const player = (opts && opts.player) || el.getAttribute("data-player") || "garden";
    const songId = (opts && (opts.songId || opts.music)) || "";
    const qs = "?player=" + encodeURIComponent(player) + (songId ? "&music=" + encodeURIComponent(songId) : "");
    try {
      const data = await fetch("/vita/players/chain-box" + qs).then(function (r) { return r.json(); });
      if (!data || !data.ok) return null;
      data.css = data.css || null;
      return paint(el, data);
    } catch (_) {
      return null;
    }
  }

  function bindAll(root) {
    const scope = root || document;
    scope.querySelectorAll("a.vita-chain-box, a.loc-link[href^='https://basescan.org']").forEach(bind);
  }

  global.VitaChainBox = {
    mount: mount,
    paint: paint,
    bind: bind,
    bindAll: bindAll,
    open: openChain,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { bindAll(document); });
  } else {
    bindAll(document);
  }
})(typeof window !== "undefined" ? window : globalThis);
