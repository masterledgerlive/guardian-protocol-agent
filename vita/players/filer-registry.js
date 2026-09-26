/**
 * Filer search registry library — player names are static; chain loc is truth.
 *
 * Reference blocks in this registry are labeled ONLY `SOURCE` or `REFERENCE`.
 * A static name (garden, proven) does not hold the true place — the sealed
 * Base location does. Names can stay put because the loc is permanent.
 *
 * Never invents tx hashes.
 */

import { FORMULA_ID, MAINFRAME_ANCHORS } from "../mainframe.js";
import { identifyLoc, isTxHash } from "./identify.js";

export const FILER_ID = "vita-player-filer-v1";
export const FILER_MAGIC = "§VITAFILER§";
export const FILER_LABEL = "FILER";
export const LABEL_SOURCE = "SOURCE";
export const LABEL_REFERENCE = "REFERENCE";

const BASESCAN = MAINFRAME_ANCHORS.basescanTx || "https://basescan.org/tx/";

function classProofLoc() {
  const a = MAINFRAME_ANCHORS.known.find((x) => x.id === "vita-strand")
    || MAINFRAME_ANCHORS.known[2]
    || MAINFRAME_ANCHORS.known[0];
  return {
    location: a.tx.toLowerCase(),
    basescan: BASESCAN + a.tx,
    kind: a.kind,
    anchorId: a.id,
    classProof: true,
    note: "Class proof of the VITA engine on Base — not a song/video body loc.",
  };
}

/**
 * Static names → true place (chain). Names never move; locs are permanent.
 */
export const PLAYER_NAMES = Object.freeze({
  garden: Object.freeze({
    id: "garden",
    name: "Garden Player",
    engine: "VIN closed-garden",
    forKids: true,
    static: true,
    holder: "vita/players/garden",
    route: "/vita/players/garden",
    sourceRoutes: Object.freeze(["/vita/kids-player", "/vita/feed-player"]),
  }),
  proven: Object.freeze({
    id: "proven",
    name: "Proven Player",
    engine: "ZK-Streaming Engine",
    forKids: true,
    static: true,
    holder: "vita/players/proven",
    route: "/vita/players/proven",
    sourceRoutes: Object.freeze([]),
  }),
  token: Object.freeze({
    id: "token",
    name: "Token Player",
    engine: "DEX pulldown",
    forKids: false,
    static: true,
    holder: "vita/token-player.js",
    route: "/vita/token-player",
    sourceRoutes: Object.freeze(["/vita/token-player"]),
  }),
});

/**
 * SOURCE = original file locations (kept). REFERENCE = named holder / mirror.
 * These two labels only — never mix NAME onto a reference block.
 */
export const FILER_BLOCKS = Object.freeze([
  {
    id: "src-kids-html",
    label: LABEL_SOURCE,
    path: "public/vita-kids-player.html",
    role: "original-kids-html",
    player: "garden",
  },
  {
    id: "src-feed-html",
    label: LABEL_SOURCE,
    path: "public/vita-feed-player.html",
    role: "original-vin-html",
    player: "garden",
  },
  {
    id: "src-feed-js",
    label: LABEL_SOURCE,
    path: "vita/vita-feed-player.js",
    role: "original-vin-assemble",
    player: "garden",
  },
  {
    id: "src-url-dir",
    label: LABEL_SOURCE,
    path: "vita/url-dir.js",
    role: "original-kids-url-dir",
    player: "garden",
  },
  {
    id: "src-free-music",
    label: LABEL_SOURCE,
    path: "vita/free-music.js",
    role: "original-pd-catalog",
    player: "garden",
  },
  {
    id: "src-token-html",
    label: LABEL_SOURCE,
    path: "public/vita-token-player.html",
    role: "original-token-html",
    player: "token",
  },
  {
    id: "src-token-js",
    label: LABEL_SOURCE,
    path: "vita/token-player.js",
    role: "original-token-engine",
    player: "token",
  },
  {
    id: "ref-players-root",
    label: LABEL_REFERENCE,
    path: "vita/players/index.js",
    role: "name-and-block-holder",
    player: "garden",
  },
  {
    id: "ref-garden-holder",
    label: LABEL_REFERENCE,
    path: "vita/players/garden/player.js",
    role: "named-garden-holder",
    player: "garden",
  },
  {
    id: "ref-garden-html",
    label: LABEL_REFERENCE,
    path: "public/players/garden.html",
    role: "named-garden-html",
    player: "garden",
  },
  {
    id: "ref-proven-holder",
    label: LABEL_REFERENCE,
    path: "vita/players/proven/player.js",
    role: "named-proven-holder",
    player: "proven",
  },
  {
    id: "ref-proven-html",
    label: LABEL_REFERENCE,
    path: "public/players/proven.html",
    role: "named-proven-html",
    player: "proven",
  },
  {
    id: "ref-chain-box",
    label: LABEL_REFERENCE,
    path: "vita/players/chain-box.js",
    role: "click-through-chain-box",
    player: "garden",
  },
  {
    id: "ref-chain-box-widget",
    label: LABEL_REFERENCE,
    path: "public/players/chain-box.js",
    role: "browser-chain-box-widget",
    player: "garden",
  },
  {
    id: "ref-chain-box-learn",
    label: LABEL_REFERENCE,
    path: "vita/memory/player-chain-box-learn.json",
    role: "chain-box-click-learn",
    player: "garden",
  },
]);

export function truePlaceFor(playerId = "garden") {
  const proof = classProofLoc();
  const name = PLAYER_NAMES[playerId] || PLAYER_NAMES.garden;
  const id = identifyLoc({ location: proof.location });
  return {
    ...proof,
    player: name.id,
    staticName: name.name,
    identify: id,
    formula: FORMULA_ID,
    neverInventHashes: true,
  };
}

export function listFilerBlocks({ player = null, label = null } = {}) {
  return FILER_BLOCKS.filter((b) => {
    if (player && b.player !== player) return false;
    if (label && b.label !== label) return false;
    return true;
  }).map((b) => ({
    ...b,
    truePlace: truePlaceFor(b.player),
    note: "Name is static. True place is the chain loc in truePlace.",
  }));
}

export function searchFiler(query = "") {
  const q = String(query || "").trim().toLowerCase();
  const names = Object.values(PLAYER_NAMES).filter((n) => {
    if (!q) return true;
    return (
      n.id.includes(q) ||
      n.name.toLowerCase().includes(q) ||
      n.engine.toLowerCase().includes(q) ||
      n.route.includes(q)
    );
  });
  const blocks = FILER_BLOCKS.filter((b) => {
    if (!q) return true;
    return (
      b.id.includes(q) ||
      b.path.toLowerCase().includes(q) ||
      b.label.toLowerCase().includes(q) ||
      b.role.toLowerCase().includes(q) ||
      b.player.includes(q) ||
      q === "source" && b.label === LABEL_SOURCE ||
      q === "reference" && b.label === LABEL_REFERENCE
    );
  });
  return {
    ok: true,
    id: FILER_ID,
    filingLabel: FILER_LABEL,
    query: q,
    names: names.map((n) => ({
      ...n,
      truePlace: truePlaceFor(n.id),
      holdsTruePlace: false,
    })),
    blocks: blocks.map((b) => ({ ...b, truePlace: truePlaceFor(b.player) })),
    labelsAllowedOnReferenceBlocks: [LABEL_SOURCE, LABEL_REFERENCE],
    neverInventHashes: true,
    formula: FORMULA_ID,
  };
}

export function publicFilerState(query = "") {
  const found = searchFiler(query);
  return {
    ...found,
    classProof: classProofLoc(),
    knownAnchors: MAINFRAME_ANCHORS.known.map((a) => ({
      id: a.id,
      location: a.tx,
      basescan: BASESCAN + a.tx,
      kind: a.kind,
    })),
    note:
      "Search names are static. SOURCE = original path. REFERENCE = named holder. " +
      "True place = Basescan loc (class proof until a body seal). Never invent hashes.",
  };
}

export function isAllowedReferenceLabel(label) {
  const s = String(label || "").toUpperCase();
  return s === LABEL_SOURCE || s === LABEL_REFERENCE;
}

export { isTxHash, classProofLoc };
