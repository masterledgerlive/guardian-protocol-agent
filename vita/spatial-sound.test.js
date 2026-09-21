/**
 * VITA voxel spatial sound — bird prints · one-block · inject CTA honesty.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  BIRD_PRINTS,
  SPATIAL_MAGIC,
  SPATIAL_PLAYER_PATH,
  ONE_BLOCK_GOAL_BYTES,
  ensureSpatialSeedBites,
  packetizeSpatial,
  listSpatialBites,
  renderBirdPrintSamples,
  planSoundtrackFromVoxel,
  playSoundtrack,
  resolveInjectClickThrough,
  recordSpatialSeal,
  maybeRecordSoundSeals,
  resolveSpatialEnqueueTarget,
  enqueueSpatial,
  formatSpatialCard,
  buildSpatialKeyboard,
  publicSpatialState,
  publicSpatialPlay,
  publicSpatialLoc,
  createSpatialBite,
} from "./spatial-sound.js";
import { parseVitaFeedCommand, handleVitaFeedAction } from "./vita-feed.js";
import { listSubDirectory } from "./vita-dir.js";
import { resolvePadInjectClickThrough, recordPadSeal } from "./soundboard.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const SEAL_PATH = join(HERE, "memory", "spatial-sound-seals.json");
const BOARD_SEAL = join(HERE, "memory", "soundboard-seals.json");

describe("spatial bird prints + one-block", () => {
  it("has syrinx-style bird prints and seed bites", () => {
    assert.ok(Object.keys(BIRD_PRINTS).length >= 6);
    const cat = ensureSpatialSeedBites();
    assert.ok(Object.keys(cat.bites || listSpatialBites()).length >= 6);
  });

  it("renders deterministic bird PCM samples", () => {
    const a = renderBirdPrintSamples("bird.sparrow.a");
    const b = renderBirdPrintSamples("bird.sparrow.a");
    assert.equal(a.ok, true);
    assert.equal(a.samples.length, b.samples.length);
    assert.ok(a.durationSec > 0.03 && a.durationSec < 0.4);
  });

  it("packetizes every seed bite as ONE-BLOCK under 720B", () => {
    const bites = listSpatialBites();
    for (const b of Object.values(bites)) {
      const p = packetizeSpatial({
        id: b.id,
        printId: b.printId,
        x: b.x,
        y: b.y,
        z: b.z,
        title: b.title,
      });
      assert.equal(p.ok, true);
      assert.ok(p.body.includes(SPATIAL_MAGIC));
      assert.ok(p.bodyBytes <= ONE_BLOCK_GOAL_BYTES, b.id + " bytes=" + p.bodyBytes);
      assert.equal(p.oneBlock, true);
      assert.ok(p.zeroOpenKey.startsWith("VITAOPEN."));
    }
  });

  it("plans agentic soundtrack from voxel neighborhood", () => {
    const plan = planSoundtrackFromVoxel({ voxel: "0,0,0", radius: 6 });
    assert.equal(plan.ok, true);
    assert.ok(plan.count >= 1);
    const played = playSoundtrack(plan);
    assert.equal(played.ok, true);
    assert.ok((played.clips || []).length >= 1);
    assert.ok(played.clips[0].dataUrl.startsWith("data:audio"));
  });
});

describe("inject click-through honesty", () => {
  it("pending inject has no Basescan href (no invented hashes)", () => {
    // Wipe any demo seals for this id
    const seals = JSON.parse(readFileSync(SEAL_PATH, "utf8"));
    delete seals.byId?.["sparrow-nest"];
    seals.byId = seals.byId || {};
    writeFileSync(SEAL_PATH, JSON.stringify(seals, null, 2) + "\n");

    const inject = resolveInjectClickThrough({ id: "sparrow-nest", kind: "spatial" });
    assert.equal(inject.proven, false);
    assert.equal(inject.href, null);
    assert.equal(inject.clickThrough, false);
    assert.match(inject.note, /NO sealed|Nothing to click|VITAFEED_PAID/i);
  });

  it("records real seal → Basescan inject href", () => {
    const fakeTx =
      "0x" + "c1".repeat(32);
    const r = recordSpatialSeal({
      id: "sparrow-nest",
      locations: [fakeTx],
      contentCommit: "abc",
      vinId: "VIN-TEST",
    });
    assert.equal(r.ok, true);
    const inject = resolveInjectClickThrough({ id: "sparrow-nest", kind: "spatial" });
    assert.equal(inject.proven, true);
    assert.equal(inject.location, fakeTx);
    assert.ok(inject.href.includes(fakeTx));
    assert.equal(inject.classProof, false);

    // cleanup — never leave invented hashes as "production" proof
    const seals = JSON.parse(readFileSync(SEAL_PATH, "utf8"));
    delete seals.byId["sparrow-nest"];
    writeFileSync(SEAL_PATH, JSON.stringify({ ...seals, byId: seals.byId || {}, updatedAt: new Date().toISOString() }, null, 2) + "\n");
  });

  it("maybeRecordSoundSeals binds spatial body meta after confirm", () => {
    const tx = "0x" + "d2".repeat(32);
    const packed = packetizeSpatial({ id: "sparrow-nest" });
    const out = maybeRecordSoundSeals({
      body: packed.body,
      backlogItem: {
        meta: {
          spatial: true,
          spatialId: "sparrow-nest",
          contentCommit: packed.contentCommit,
          filingLabel: "SPATIAL_SOUND",
        },
      },
      locations: [tx],
      vinId: "VIN-SP",
    });
    assert.equal(out.ok, true);
    const inject = resolveInjectClickThrough({ id: "sparrow-nest" });
    assert.equal(inject.proven, true);
    assert.equal(inject.location, tx);

    const seals = JSON.parse(readFileSync(SEAL_PATH, "utf8"));
    delete seals.byId["sparrow-nest"];
    writeFileSync(SEAL_PATH, JSON.stringify(seals, null, 2) + "\n");
  });

  it("pad inject CTA stays pending until recordPadSeal", () => {
    const pending = resolvePadInjectClickThrough("airhorn");
    assert.equal(pending.proven, false);
    assert.equal(pending.href, null);
    const tx = "0x" + "e3".repeat(32);
    const sealed = recordPadSeal({ id: "airhorn", locations: [tx] });
    assert.equal(sealed.ok, true);
    const proven = resolvePadInjectClickThrough("airhorn");
    assert.equal(proven.proven, true);
    assert.ok(proven.href.includes(tx));
    // cleanup
    if (existsSync(BOARD_SEAL)) {
      const seals = JSON.parse(readFileSync(BOARD_SEAL, "utf8"));
      delete seals.byId?.airhorn;
      writeFileSync(BOARD_SEAL, JSON.stringify(seals, null, 2) + "\n");
    }
  });
});

describe("feed + dir + public surface", () => {
  it("parses /vitafeed spatial and soundtrack", () => {
    assert.equal(parseVitaFeedCommand("/vitafeed spatial").action, "spatial");
    assert.equal(parseVitaFeedCommand("/vitafeed soundtrack 1,0,-1").action, "soundtrack");
    assert.equal(parseVitaFeedCommand("/vitafeed enqueue spatial sparrow-nest").action, "enqueue");
  });

  it("handleVitaFeedAction spatial card + soundtrack", async () => {
    const card = await handleVitaFeedAction({
      action: "spatial",
      body: "",
      chatId: "spatial-test",
    });
    assert.equal(card.ok, true);
    assert.equal(card.spatial, true);
    assert.match(card.reply, /VITASPATIAL|VOXEL|SPATIAL/);

    const track = await handleVitaFeedAction({
      action: "soundtrack",
      body: "0,0,0",
      chatId: "spatial-test",
    });
    assert.equal(track.ok, true);
    assert.match(track.reply, /SOUNDTRACK/);
  });

  it("enqueue target resolves spatial library", () => {
    assert.equal(resolveSpatialEnqueueTarget("spatial").kind, "library");
    assert.equal(resolveSpatialEnqueueTarget("spatial sparrow-nest").kind, "spatial");
  });

  it("dir VOXEL lists spatial entries", () => {
    const listed = listSubDirectory("VOXEL");
    assert.ok((listed.entries || []).length >= 4);
    assert.ok(listed.entries.some((e) => /spatial/.test(e.name)));
  });

  it("public state + play + loc expose inject pending", () => {
    const st = publicSpatialState();
    assert.equal(st.ok, true);
    assert.equal(st.oneBlockGoal, true);
    assert.match(st.injectNote, /Basescan|VITAFEED_PAID/);
    const play = publicSpatialPlay("sparrow-nest");
    assert.equal(play.ok, true);
    assert.ok(play.inject);
    assert.equal(play.inject.proven, false);
    const loc = publicSpatialLoc("sparrow-nest", 1);
    assert.equal(loc.ok, true);
    assert.ok(loc.utf8.includes(SPATIAL_MAGIC));
  });

  it("HTML + keyboard exist", () => {
    assert.ok(existsSync(join(ROOT, "public", "vita-spatial.html")));
    assert.equal(SPATIAL_PLAYER_PATH, "/vita/spatial");
    const kb = buildSpatialKeyboard();
    assert.ok(kb.inline_keyboard.length >= 2);
    assert.match(formatSpatialCard("sparrow-nest"), /INJECT PROOF/);
  });

  it("createSpatialBite files a custom one-block print", () => {
    const made = createSpatialBite({
      printId: "bird.wren.a",
      x: 3.1,
      y: 1.2,
      z: -0.5,
      id: "wren-test-bite",
    });
    assert.equal(made.ok, true);
    assert.equal(made.packed.oneBlock, true);
  });

  it("enqueueSpatial calls enqueueFn with spatial meta", () => {
    const seen = [];
    const r = enqueueSpatial({
      enqueueFn: (row) => {
        seen.push(row);
        return { ok: true, item: { id: "BL-TEST" } };
      },
      id: "sparrow-nest",
    });
    assert.equal(r.ok, true);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].meta.spatial, true);
    assert.equal(seen[0].meta.spatialId, "sparrow-nest");
    assert.equal(seen[0].kind, "spatial");
  });
});
