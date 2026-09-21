/**
 * Clickable chain box — always a real Basescan href.
 *
 * The loc-rail cards were inspect-only and kids/proof-off hid them, so the
 * operator could not click through to a blockchain address. This box:
 *   - is NOT proof-chrome (visible in kids mode; hidden only when kids-locked)
 *   - is an <a href> to a real 0x loc (sealed body, else class-proof anchor)
 *   - uses Telegram.WebApp.openLink inside Mini Apps
 *   - shows refined front · mid · back identity
 *
 * Never invents tx hashes. Demo hashes never get a Basescan href.
 */

import { FORMULA_ID, MAINFRAME_ANCHORS } from "../mainframe.js";
import { identifyLoc, isTxHash, normalizeTx } from "./identify.js";
import { PLAYER_NAMES, classProofLoc, truePlaceFor } from "./filer-registry.js";
import { provenKidsOnChain, provenMusicOnChain } from "../chain-dir.js";

export const CHAIN_BOX_ID = "vita-chain-box-v1";
export const CHAIN_BOX_CSS_ID = "vita-chain-box-css";

const BASESCAN = MAINFRAME_ANCHORS.basescanTx || "https://basescan.org/tx/";

/**
 * telegram-web-app.js always exposes WebApp.openLink, even in a normal
 * browser. Calling it there preventDefault's the <a> and the loc never
 * opens. Only intercept inside a real Mini App (initData present).
 */
export function shouldUseTelegramOpenLink(webApp) {
  if (!webApp || typeof webApp.openLink !== "function") return false;
  if (String(webApp.initData || "").length > 0) return true;
  const unsafe = webApp.initDataUnsafe || {};
  return Boolean(unsafe.user || unsafe.query_id || unsafe.hash);
}

function basescanTx(tx) {
  return BASESCAN + tx;
}

/**
 * Pick the loc this box must open. Sealed body wins; else class-proof.
 * Demo / synthetic hashes are refused.
 */
export function resolveChainHref({
  location = null,
  basescan = null,
  demo = false,
  player = "garden",
  songId = null,
} = {}) {
  if (demo) {
    const proof = classProofLoc();
    const id = identifyLoc({ location: proof.location });
    return {
      href: proof.basescan,
      location: proof.location,
      identify: id,
      kind: "class-proof",
      label: "DEMO seal — class proof (not this body)",
      clickThrough: true,
      classProof: true,
    };
  }
  const loc = normalizeTx(location);
  if (loc) {
    const href = basescan && /^https?:\/\//i.test(String(basescan))
      ? String(basescan)
      : basescanTx(loc);
    return {
      href,
      location: loc,
      identify: identifyLoc({ location: loc }),
      kind: "sealed-body",
      label: "Basescan Input Data",
      clickThrough: true,
      classProof: false,
    };
  }
  if (songId) {
    const on = provenMusicOnChain(songId);
    const p = (on?.proofs || []).find((x) => isTxHash(x.tx || x.location));
    if (p) {
      const tx = String(p.tx || p.location).toLowerCase();
      return {
        href: p.basescan || basescanTx(tx),
        location: tx,
        identify: identifyLoc({ location: tx }),
        kind: "sealed-body",
        label: "song loc · Input Data",
        clickThrough: true,
        classProof: false,
      };
    }
  }
  if (player === "garden") {
    const kids = provenKidsOnChain();
    const p = (kids?.proofs || []).find((x) => isTxHash(x.tx || x.location));
    if (p) {
      const tx = String(p.tx || p.location).toLowerCase();
      return {
        href: p.basescan || basescanTx(tx),
        location: tx,
        identify: identifyLoc({ location: tx }),
        kind: "sealed-body",
        label: "KIDS dir loc · Input Data",
        clickThrough: true,
        classProof: false,
      };
    }
  }
  const named = truePlaceFor(player);
  return {
    href: named.basescan,
    location: named.location,
    identify: named.identify,
    kind: "class-proof",
    label: named.note,
    clickThrough: true,
    classProof: true,
    player: named.player,
    staticName: named.staticName,
  };
}

export function buildChainBox({
  player = "garden",
  location = null,
  basescan = null,
  demo = false,
  songId = null,
  blockNumber = null,
} = {}) {
  const name = PLAYER_NAMES[player] || PLAYER_NAMES.garden;
  const resolved = resolveChainHref({ location, basescan, demo, player, songId });
  const blockId = blockNumber != null
    ? identifyLoc({ location: resolved.location, blockNumber })
    : resolved.identify;
  return {
    ok: true,
    id: CHAIN_BOX_ID,
    player: name.id,
    name: name.name,
    engine: name.engine,
    route: name.route,
    holder: name.holder,
    href: resolved.href,
    location: resolved.location,
    identify: blockId || resolved.identify,
    kind: resolved.kind,
    label: resolved.label,
    clickThrough: true,
    classProof: resolved.classProof === true,
    formula: FORMULA_ID,
    neverInventHashes: true,
    open: {
      target: "_blank",
      rel: "noopener",
      telegram: "WebApp.openLink",
      idm: "Basescan → Input Data → View as UTF-8",
    },
    note:
      resolved.classProof
        ? "Click opens a real Base loc (class proof of the named player). Song/video body seals replace this when present."
        : "Click opens the sealed body loc — Input Data UTF-8 is the proof.",
  };
}

export function chainBoxCss() {
  return `
.vita-chain-box {
  display: inline-flex;
  align-items: center;
  gap: .45rem;
  position: relative;
  z-index: 35;
  pointer-events: auto !important;
  cursor: pointer;
  text-decoration: none;
  color: inherit;
  border: 2px solid currentColor;
  background: #fff;
  padding: .38rem .7rem;
  font-family: ui-monospace, "IBM Plex Mono", monospace;
  font-size: .72rem;
  line-height: 1.2;
  user-select: none;
}
.vita-chain-box:hover, .vita-chain-box:focus {
  outline: 2px solid #2a9d8f;
  outline-offset: 2px;
}
.vita-chain-box .cb-name { font-weight: 800; letter-spacing: .04em; }
.vita-chain-box .cb-id { font-weight: 700; }
.vita-chain-box .cb-id b { font-weight: 800; }
.vita-chain-box .cb-id i { font-style: normal; opacity: .7; }
.vita-chain-box .cb-kind {
  font-size: .62rem;
  padding: .1rem .35rem;
  background: #2a9d8f;
  color: #fff;
  font-weight: 700;
}
.vita-chain-box.class-proof .cb-kind { background: #1a6b8a; }
html.kids-locked .vita-chain-box { display: none !important; }
`.trim();
}

export function chainBoxHtml(box) {
  const id = box.identify || {};
  const cls = "vita-chain-box" + (box.classProof ? " class-proof" : " sealed-body");
  const title = String(box.note || box.label || "Open Basescan").replace(/"/g, "&quot;");
  return (
    "<a class=\"" + cls + "\" id=\"vitaChainBox\" href=\"" + box.href + "\" " +
    "target=\"_blank\" rel=\"noopener\" data-player=\"" + box.player + "\" " +
    "data-kind=\"" + box.kind + "\" data-loc=\"" + box.location + "\" " +
    "title=\"" + title + "\">" +
    "<span class=\"cb-name\">" + box.name + "</span>" +
    "<span class=\"cb-id\" aria-label=\"block identity\">" +
    "<b>" + (id.front || "") + "</b><i>·</i><b>" + (id.mid || "") + "</b><i>·</i><b>" + (id.back || "") + "</b>" +
    "</span>" +
    "<span class=\"cb-kind\">" + (box.classProof ? "CLASS PROOF" : "ON-CHAIN") + "</span>" +
    "</a>"
  );
}

export { BASESCAN, MAINFRAME_ANCHORS };
