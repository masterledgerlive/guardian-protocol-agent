/**
 * VITA Photos Drive — Earthrise + MLK hope tests + unwrap plan + open-picture key.
 */

import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  EARTHRISE_TEST,
  MLK_TEST,
  runEarthriseTest,
  runMlkTest,
  filePhoto,
  openSourcePictureKey,
  parsePhotoSource,
  packetizePhoto,
  buildUnwrapPlan,
  listPhotosOrdered,
  photosEntriesFor,
  isPhotoEnqueueSelector,
  resolvePhotoEnqueueTarget,
  PHOTOS_LABEL,
  PHOTOS_VIEWER_PATH,
} from "./photos.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const EARTH = join(HERE, "memory", "photos", EARTHRISE_TEST.fileName);
const MLK = join(HERE, "memory", "photos", MLK_TEST.fileName);

describe("vita photos drive", () => {
  it("parses drive / folder / url sources", () => {
    const folder = parsePhotoSource(
      "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz012345"
    );
    assert.equal(folder.ok, true);
    assert.equal(folder.kind, "gdrive-folder");

    const file = parsePhotoSource(
      "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/view"
    );
    assert.equal(file.ok, true);
    assert.equal(file.kind, "gdrive-file");
  });

  it("open-picture key is name+commit, never a wallet secret", () => {
    const key = openSourcePictureKey({
      name: "earthrise-apollo8.jpg",
      contentCommit: "a".repeat(64),
    });
    assert.equal(key.openSource, true);
    assert.equal(key.privateKey, false);
    assert.match(key.key, /^VITAOPEN\./);
  });

  it("Earthrise full test files into PHOTOS with compress + VIN groups", () => {
    assert.ok(existsSync(EARTH), "Earthrise fixture must exist");
    const tested = runEarthriseTest({ compress: true });
    assert.equal(tested.ok, true);
    assert.equal(tested.filed.id, "earthrise");
    assert.ok(tested.filed.zeroOpenKey.startsWith("VITAOPEN."));
    assert.equal(tested.filed.compression?.verified, true);

    const packed = packetizePhoto("earthrise");
    assert.equal(packed.ok, true);
    assert.ok(packed.groupCount >= 1);

    const plan = buildUnwrapPlan("earthrise");
    assert.equal(plan.ok, true);
    assert.ok(plan.blocks.length >= 1);
    assert.equal(plan.blocks[0].match, "LOCAL_OK");
    assert.ok(plan.viewerPath.includes(PHOTOS_VIEWER_PATH));
    assert.ok(plan.dos.path.includes("PHOTOS"));
  });

  it("MLK historical uplift files + unwrap stream plan", () => {
    assert.ok(existsSync(MLK), "MLK fixture must exist");
    const tested = runMlkTest({ compress: true });
    assert.equal(tested.ok, true);
    assert.equal(tested.filed.id, "mlk");
    assert.ok(tested.filed.zeroOpenKey.startsWith("VITAOPEN."));
    assert.equal(tested.filed.compression?.verified, true);

    const plan = buildUnwrapPlan("mlk");
    assert.equal(plan.ok, true);
    assert.ok(plan.blocks.length >= 1);
    assert.ok(plan.packetCount >= 1);
    assert.match(plan.zeroOpenKey, /mlk/i);
  });

  it("ordered searchable catalog", () => {
    const listed = listPhotosOrdered({ q: "king", sort: "title", order: "asc" });
    assert.equal(listed.ok, true);
    assert.ok(listed.photos.some((p) => p.id === "mlk"));
    const all = listPhotosOrdered({ sort: "filedAt", order: "asc" });
    assert.ok(all.total >= 2);
    assert.equal(all.photos[0].n, 1);
  });

  it("enqueue selectors resolve photo / library", () => {
    assert.equal(isPhotoEnqueueSelector("photos"), true);
    assert.equal(resolvePhotoEnqueueTarget("photo mlk").id, "mlk");
    assert.equal(PHOTOS_LABEL, "PHOTOS");
  });

  it("files a tiny png one-at-a-time", () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64"
    );
    const filed = filePhoto({
      bytes: png,
      name: "hope-pixel.png",
      mime: "image/png",
      id: "hope-pixel",
      title: "Hope pixel",
      compress: true,
    });
    assert.equal(filed.ok, true);
    assert.ok(filed.playerPath.includes("viewer"));
    assert.ok(photosEntriesFor().some((e) => e.trueName === "hope-pixel"));
  });
});
