/**
 * Named players — Garden + Proven, filer SOURCE|REFERENCE, clickable chain box.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MAINFRAME_ANCHORS } from "../mainframe.js";
import { identifyHash, identifyBlockNumber, identifyLoc, isTxHash } from "./identify.js";
import {
  LABEL_REFERENCE,
  LABEL_SOURCE,
  PLAYER_NAMES,
  isAllowedReferenceLabel,
  publicFilerState,
  searchFiler,
  truePlaceFor,
} from "./filer-registry.js";
import { buildChainBox, resolveChainHref, shouldUseTelegramOpenLink } from "./chain-box.js";
import { buildReferenceBlocks, recordTouch } from "./reference-block.js";
import { publicGardenState, GARDEN_ROUTE, gardenReroute } from "./garden/player.js";
import { segmentIntoCells, verifyCell, makeCellKey, ZK_PROOF_BYTES } from "./proven/zk-wrapper.js";
import { PLAYERS_SUBDIR, publicPlayersIndex, playerDirEntriesFor } from "./index.js";
import { listMasterDirectory, listSubDirectory, VITADIR_SUBDIRS } from "../vita-dir.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const strandTx = MAINFRAME_ANCHORS.vitaStrandTx;

describe("block identify front · mid · back", () => {
  it("splits a real loc into compact front mid back", () => {
    const id = identifyHash(strandTx);
    assert.ok(id);
    assert.equal(id.location, strandTx.toLowerCase());
    assert.equal(id.front.length, 4);
    assert.equal(id.mid.length, 4);
    assert.equal(id.back.length, 4);
    assert.match(id.display, /·/);
    assert.equal(id.front, strandTx.slice(2, 6).toLowerCase());
    assert.equal(id.back, strandTx.slice(-4).toLowerCase());
  });

  it("refines a block number without inventing a hash", () => {
    const b = identifyBlockNumber(37000042);
    assert.equal(b.front, "37");
    assert.equal(b.back, "42");
    assert.match(b.display, /…/);
    assert.equal(identifyLoc({ location: "nope" }), null);
  });
});

describe("filer SOURCE | REFERENCE only", () => {
  it("static names do not hold the true place", () => {
    assert.equal(PLAYER_NAMES.garden.name, "Garden Player");
    assert.equal(PLAYER_NAMES.proven.engine, "ZK-Streaming Engine");
    const place = truePlaceFor("garden");
    assert.equal(isTxHash(place.location), true);
    assert.equal(place.classProof, true);
    assert.ok(MAINFRAME_ANCHORS.known.some((a) => a.tx.toLowerCase() === place.location));
  });

  it("reference blocks only accept SOURCE or REFERENCE labels", () => {
    assert.equal(isAllowedReferenceLabel("SOURCE"), true);
    assert.equal(isAllowedReferenceLabel("REFERENCE"), true);
    assert.equal(isAllowedReferenceLabel("NAME"), false);
    const found = searchFiler("garden");
    assert.ok(found.blocks.every((b) => b.label === LABEL_SOURCE || b.label === LABEL_REFERENCE));
    const src = publicFilerState("source");
    assert.ok(src.blocks.some((b) => b.path === "public/vita-kids-player.html"));
  });
});

describe("chain box click-through", () => {
  it("always returns a real Basescan href — never a demo hash", () => {
    const box = buildChainBox({ player: "garden" });
    assert.equal(box.clickThrough, true);
    assert.match(box.href, /^https:\/\/basescan\.org\/tx\/0x[0-9a-f]{64}$/);
    assert.equal(box.location, strandTx.toLowerCase());
    assert.equal(box.identify.front.length, 4);
    const demo = resolveChainHref({ demo: true, location: "0x" + "ab".repeat(32) });
    assert.equal(demo.classProof, true);
    assert.equal(demo.location, strandTx.toLowerCase());
    assert.doesNotMatch(demo.href, /ababab/);
  });

  it("sealed body loc wins over class proof", () => {
    const loc = MAINFRAME_ANCHORS.eurekaProveTx;
    const got = resolveChainHref({ location: loc, player: "garden" });
    assert.equal(got.classProof, false);
    assert.equal(got.location, loc.toLowerCase());
    assert.ok(got.href.endsWith(loc.toLowerCase()));
  });

  it("does not steal native <a> clicks outside a Telegram Mini App", () => {
    const fakeOpenLink = () => {};
    assert.equal(shouldUseTelegramOpenLink({ openLink: fakeOpenLink, initData: "", platform: "unknown" }), false);
    assert.equal(shouldUseTelegramOpenLink({ openLink: fakeOpenLink, initData: "query_id=1", platform: "ios" }), true);
    assert.equal(shouldUseTelegramOpenLink(null), false);
  });
});

describe("Garden named holder keeps SOURCE", () => {
  it("reroutes kids/feed to /vita/players/garden without dropping source", () => {
    const r = gardenReroute("/vita/kids-player?dir=kids");
    assert.equal(r.to, GARDEN_ROUTE);
    assert.equal(r.keepSource, true);
    const state = publicGardenState({ dir: "kids" });
    assert.equal(state.name, "Garden Player");
    assert.ok(state.sourceRoutes.includes("/vita/kids-player"));
    assert.ok(state.sourceBlocks.some((b) => b.path === "public/vita-kids-player.html"));
    assert.match(state.chainBox.href, /basescan\.org\/tx\/0x/);
  });
});

describe("ZK wrapper lock and key", () => {
  it("opens only when 448-byte key matches cell hash and drops otherwise", () => {
    const payload = Buffer.from("cell-one-proof");
    const segs = segmentIntoCells(payload, { cellBytes: 64 });
    assert.equal(segs.cellCount, 1);
    assert.equal(segs.cells[0].keyHex.length, ZK_PROOF_BYTES * 2);
    const open = verifyCell({
      payload,
      keyHex: segs.cells[0].keyHex,
      expectHash: segs.cells[0].cellHash,
    });
    assert.equal(open.open, true);
    assert.equal(open.dropped, false);
    const bad = makeCellKey({ cellHash: "ff".repeat(32), chunkId: 1 });
    const shut = verifyCell({ payload, keyHex: bad.keyHex });
    assert.equal(shut.open, false);
    assert.equal(shut.dropped, true);
  });
});

describe("players hub + DOS PLAYERS dir", () => {
  it("indexes Garden and Proven and files PLAYERS in VITA:\\", () => {
    const idx = publicPlayersIndex();
    assert.equal(idx.ok, true);
    assert.ok(idx.chainBoxes.garden.clickThrough);
    assert.ok(idx.chainBoxes.proven.clickThrough);
    const names = VITADIR_SUBDIRS.map((d) => d.name);
    assert.ok(names.includes("PLAYERS"));
    const listed = listSubDirectory("PLAYERS");
    assert.equal(listed.ok, true);
    assert.ok(listed.entries.some((e) => e.name === "garden.player"));
    assert.ok(listed.entries.some((e) => e.name === "proven.player"));
    assert.ok(listed.entries.some((e) => e.kind === "source"));
    assert.ok(listed.entries.some((e) => e.kind === "reference"));
    const master = listMasterDirectory();
    assert.ok(master.subdirs.some((d) => d.name === "PLAYERS" && d.files > 0));
    const dir = playerDirEntriesFor();
    assert.equal(dir.subdir, PLAYERS_SUBDIR);
  });

  it("HTML surfaces include the chain box widget", () => {
    const garden = readFileSync(join(root, "public/players/garden.html"), "utf8");
    const proven = readFileSync(join(root, "public/players/proven.html"), "utf8");
    const kids = readFileSync(join(root, "public/vita-kids-player.html"), "utf8");
    const feed = readFileSync(join(root, "public/vita-feed-player.html"), "utf8");
    const strandHref = "https://basescan.org/tx/" + String(strandTx).toLowerCase();
    for (const html of [garden, proven, kids, feed]) {
      assert.match(html, /chain-box\.js/);
      assert.match(html, /id="chainMount"/);
      assert.match(html, /id="vitaChainBox"/);
      assert.match(html, new RegExp(strandHref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    assert.match(feed, /VitaChainBox/);
    assert.match(kids, /VitaChainBox/);
    const hook = readFileSync(join(root, "vita-webhook.js"), "utf8");
    assert.match(hook, /\/vita\/players\/garden/);
    assert.match(hook, /\/vita\/players\/proven/);
    assert.match(hook, /\/vita\/players\/chain-box/);
  });
});

describe("reference block data field follows touched paths", () => {
  it("logs SOURCE originals and REFERENCE holders", () => {
    recordTouch({
      path: "vita/players/index.js",
      label: LABEL_REFERENCE,
      role: "name-and-block-holder",
      player: "garden",
    });
    const refs = buildReferenceBlocks();
    const labels = refs.blocks.map((b) => b.filingLabel);
    assert.ok(labels.includes(LABEL_SOURCE));
    assert.ok(labels.includes(LABEL_REFERENCE));
    const src = refs.blocks.find((b) => b.id === "player-source-block");
    assert.ok(src.dataField.some((p) => p.path === "public/vita-feed-player.html"));
    assert.match(src.basescan, /basescan\.org\/tx\/0x/);
    assert.ok(src.identify.display.includes("·"));
  });
});
