/**
 * VITA Photos Drive — Earthrise hope test + open-picture key + VIN packetize.
 */

import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  EARTHRISE_TEST,
  runEarthriseTest,
  filePhoto,
  openSourcePictureKey,
  parsePhotoSource,
  setPhotoSource,
  packetizePhoto,
  photosEntriesFor,
  isPhotoEnqueueSelector,
  resolvePhotoEnqueueTarget,
  PHOTOS_LABEL,
} from "./photos.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, "memory", "photos", EARTHRISE_TEST.fileName);

describe("vita photos drive", () => {
  it("parses drive / folder / url sources", () => {
    const folder = parsePhotoSource(
      "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz012345"
    );
    assert.equal(folder.ok, true);
    assert.equal(folder.kind, "gdrive-folder");
    assert.equal(folder.folderId, "1AbCdEfGhIjKlMnOpQrStUvWxYz012345");

    const file = parsePhotoSource(
      "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/view"
    );
    assert.equal(file.ok, true);
    assert.equal(file.kind, "gdrive-file");
    assert.ok(file.downloadUrl.includes("uc?export=download"));

    const http = parsePhotoSource(
      "https://images-assets.nasa.gov/image/as08-14-2383/as08-14-2383~medium.jpg"
    );
    assert.equal(http.ok, true);
    assert.equal(http.kind, "http-image");
  });

  it("open-picture key is name+commit, never a wallet secret", () => {
    const key = openSourcePictureKey({
      name: "earthrise-apollo8.jpg",
      contentCommit: "a".repeat(64),
    });
    assert.equal(key.openSource, true);
    assert.equal(key.privateKey, false);
    assert.equal(key.lock, false);
    assert.match(key.key, /^VITAOPEN\.earthrise-apollo8\.jpg\.[0-9a-f]{12}$/);
  });

  it("Earthrise full test files into PHOTOS with compress + VIN groups", () => {
    assert.ok(existsSync(FIXTURE), "Earthrise fixture must exist");
    const tested = runEarthriseTest({ compress: true });
    assert.equal(tested.ok, true);
    assert.equal(tested.hope, true);
    assert.equal(tested.filed.id, "earthrise");
    assert.ok(tested.filed.zeroOpenKey.startsWith("VITAOPEN."));
    assert.equal(tested.filed.compression?.verified, true);
    assert.ok(tested.filed.meta.bytes > 1000);

    const packed = packetizePhoto("earthrise");
    assert.equal(packed.ok, true);
    assert.ok(packed.groupCount >= 1);
    assert.ok(packed.packetCount >= 1);
    assert.equal(packed.contentCommit, tested.filed.contentCommit);

    const entries = photosEntriesFor();
    assert.ok(entries.some((e) => e.trueName === "earthrise"));
    assert.equal(PHOTOS_LABEL, "PHOTOS");
  });

  it("enqueue selectors resolve photo / library", () => {
    assert.equal(isPhotoEnqueueSelector("photos"), true);
    assert.equal(isPhotoEnqueueSelector("photo earthrise"), true);
    assert.equal(resolvePhotoEnqueueTarget("photos").kind, "library");
    assert.equal(resolvePhotoEnqueueTarget("earthrise").kind, "photo");
    assert.equal(resolvePhotoEnqueueTarget("photo earthrise").id, "earthrise");
  });

  it("files a tiny png one-at-a-time", () => {
    // 1x1 PNG
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
    assert.ok(filed.zeroOpenKey.includes("hope-pixel"));
    const packed = packetizePhoto("hope-pixel");
    assert.equal(packed.ok, true);
    assert.equal(packed.groupCount, 1);
  });
});
