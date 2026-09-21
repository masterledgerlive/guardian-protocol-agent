/**
 * Named Garden Player — VIN closed-garden engine for kids.
 *
 * This is the name + block holder. Original surfaces stay SOURCE:
 *   public/vita-kids-player.html
 *   public/vita-feed-player.html
 *   vita/vita-feed-player.js
 *   vita/url-dir.js
 *   vita/free-music.js
 * Routes /vita/kids-player and /vita/feed-player keep working (compat).
 * Canonical named route: /vita/players/garden
 *
 * Never invents tx hashes. Mother brain untouched.
 */

import { FORMULA_ID } from "../../mainframe.js";
import { publicUrlDirState, vitaPlayerHref } from "../../url-dir.js";
import { publicFreeMusicState, listCatalogSongIds } from "../../free-music.js";
import { buildChainBox } from "../chain-box.js";
import { PLAYER_NAMES, listFilerBlocks, LABEL_SOURCE, LABEL_REFERENCE } from "../filer-registry.js";

export const GARDEN_PLAYER_ID = "vita-garden-player-v1";
export const GARDEN_PLAYER_MAGIC = "§VITAGARDEN§";
export const GARDEN_PLAYER_LABEL = "GARDEN_PLAYER";
export const GARDEN_ROUTE = "/vita/players/garden";
export const GARDEN_SOURCE_ROUTES = Object.freeze([
  "/vita/kids-player",
  "/vita/feed-player",
]);

export function gardenReroute(fromPath = "") {
  const p = String(fromPath || "");
  const name = PLAYER_NAMES.garden;
  if (p.startsWith("/vita/kids-player") || p.startsWith("/vita/feed-player")) {
    return {
      from: p,
      to: GARDEN_ROUTE,
      reason: "named holder",
      keepSource: true,
    };
  }
  return { from: p, to: name.route, reason: "already named", keepSource: true };
}

export function publicGardenState({ dir = "kids", music = null } = {}) {
  const box = buildChainBox({ player: "garden", songId: music || null });
  const kids = publicUrlDirState(dir);
  const songs = listCatalogSongIds();
  const musicState = music ? publicFreeMusicState(music) : null;
  return {
    ok: true,
    id: GARDEN_PLAYER_ID,
    filingLabel: GARDEN_PLAYER_LABEL,
    name: PLAYER_NAMES.garden.name,
    engine: PLAYER_NAMES.garden.engine,
    route: GARDEN_ROUTE,
    sourceRoutes: [...GARDEN_SOURCE_ROUTES],
    sourceBlocks: listFilerBlocks({ player: "garden", label: LABEL_SOURCE }),
    referenceBlocks: listFilerBlocks({ player: "garden", label: LABEL_REFERENCE }),
    chainBox: box,
    kids,
    music: musicState,
    catalogIds: songs,
    playerHref: vitaPlayerHref(GARDEN_ROUTE + (music ? ("?music=" + encodeURIComponent(music)) : "?dir=kids")),
    formula: FORMULA_ID,
    neverInventHashes: true,
    note:
      "Garden Player is the named VIN/kids holder. Original HTML stays SOURCE. " +
      "Chain box always clicks through to a real Basescan loc.",
  };
}
