/**
 * Named players hub — Garden (VIN/kids) + Proven (ZK-Streaming Engine).
 *
 * Mirror/reroute: original paths stay SOURCE; this folder is the name and
 * block holder. Filer search labels reference blocks SOURCE | REFERENCE only.
 */

import { FORMULA_ID } from "../mainframe.js";
import {
  PLAYER_NAMES,
  publicFilerState,
  listFilerBlocks,
  LABEL_SOURCE,
  LABEL_REFERENCE,
} from "./filer-registry.js";
import { buildReferenceBlocks, recordTouch, loadTouchLog } from "./reference-block.js";
import { buildChainBox, chainBoxCss, chainBoxHtml } from "./chain-box.js";
import { publicGardenState, GARDEN_ROUTE, GARDEN_PLAYER_ID } from "./garden/player.js";
import { publicProvenState, publicProvenVerify, PROVEN_ROUTE, PROVEN_PLAYER_ID } from "./proven/player.js";

export const PLAYERS_ID = "vita-players-v1";
export const PLAYERS_MAGIC = "§VITAPLAYERS§";
export const PLAYERS_LABEL = "PLAYERS";
export const PLAYERS_SUBDIR = "PLAYERS";

export {
  PLAYER_NAMES,
  publicFilerState,
  listFilerBlocks,
  LABEL_SOURCE,
  LABEL_REFERENCE,
  buildReferenceBlocks,
  recordTouch,
  loadTouchLog,
  buildChainBox,
  chainBoxCss,
  chainBoxHtml,
  publicGardenState,
  publicProvenState,
  publicProvenVerify,
  GARDEN_ROUTE,
  PROVEN_ROUTE,
  GARDEN_PLAYER_ID,
  PROVEN_PLAYER_ID,
};

function seedHolderTouches() {
  recordTouch({ path: "vita/players/index.js", label: LABEL_REFERENCE, role: "name-and-block-holder", player: "garden" });
  recordTouch({ path: "vita/players/garden/player.js", label: LABEL_REFERENCE, role: "named-garden-holder", player: "garden" });
  recordTouch({ path: "public/players/garden.html", label: LABEL_REFERENCE, role: "named-garden-html", player: "garden" });
  recordTouch({ path: "vita/players/proven/player.js", label: LABEL_REFERENCE, role: "named-proven-holder", player: "proven" });
  recordTouch({ path: "public/players/proven.html", label: LABEL_REFERENCE, role: "named-proven-html", player: "proven" });
  recordTouch({ path: "public/vita-kids-player.html", label: LABEL_SOURCE, role: "original-kids-html", player: "garden" });
  recordTouch({ path: "public/vita-feed-player.html", label: LABEL_SOURCE, role: "original-vin-html", player: "garden" });
}

export function publicPlayersIndex() {
  seedHolderTouches();
  const refs = buildReferenceBlocks();
  return {
    ok: true,
    id: PLAYERS_ID,
    filingLabel: PLAYERS_LABEL,
    formula: FORMULA_ID,
    neverInventHashes: true,
    names: PLAYER_NAMES,
    routes: {
      garden: GARDEN_ROUTE,
      proven: PROVEN_ROUTE,
      token: PLAYER_NAMES.token.route,
      sourceKids: "/vita/kids-player",
      sourceFeed: "/vita/feed-player",
      filer: "/vita/players/filer",
      reference: "/vita/players/reference",
      chainBox: "/vita/players/chain-box",
    },
    chainBoxes: {
      garden: buildChainBox({ player: "garden" }),
      proven: buildChainBox({ player: "proven" }),
    },
    filer: publicFilerState(""),
    reference: refs,
    note:
      "Garden = named VIN/kids engine. Proven = ZK-Streaming Engine. " +
      "Original HTML remains SOURCE. Chain box always clicks a real Basescan loc.",
  };
}

export function playerDirEntriesFor() {
  const idx = publicPlayersIndex();
  const out = [];
  let n = 1;
  for (const name of Object.values(PLAYER_NAMES)) {
    const box = buildChainBox({ player: name.id });
    out.push({
      n: n++,
      name: name.id + ".player",
      kind: "player",
      bytes: 0,
      unlockName: name.id + ".player",
      english:
        name.name + " — " + name.engine + " · named holder " + name.holder +
        " · chain " + (box.identify?.display || "") +
        " · " + (box.classProof ? "class-proof loc" : "sealed body loc"),
      machine:
        "PLAYER id=" + name.id + " route=" + name.route +
        " loc=" + box.location.slice(2, 10) + " kind=" + box.kind,
      locations: [box.location],
      trueName: name.id,
      playerHref: name.route,
    });
  }
  for (const b of listFilerBlocks()) {
    out.push({
      n: n++,
      name: b.id + ".ref",
      kind: b.label === LABEL_SOURCE ? "source" : "reference",
      bytes: 0,
      unlockName: b.path.replace(/\//g, "\\"),
      english: b.label + " · " + b.path + " · " + b.role,
      machine: "FILER label=" + b.label + " path=" + b.path + " player=" + b.player,
      locations: [b.truePlace.location],
      filingLabel: b.label,
      trueName: b.player,
    });
  }
  return { subdir: PLAYERS_SUBDIR, entries: out, index: idx.id };
}
