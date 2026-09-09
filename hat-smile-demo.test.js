import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildSmileFace8x8,
  renderSmileAscii,
  runSmileHatDemo,
  buildSmileProofHtml,
  SMILE_WIDTH,
  SMILE_HEIGHT,
  demoTxHash,
} from "./hat-smile-demo.js";
import { HAT_MAGIC } from "./vita-hat.js";

describe("hat-smile-demo", () => {
  it("builds 8×8 × 8-bit smile buffer", () => {
    const px = buildSmileFace8x8();
    assert.equal(px.length, SMILE_WIDTH * SMILE_HEIGHT);
    assert.equal(px.length, 64);
    // Eyes dark
    assert.ok(px[1 * 8 + 2] < 128);
    assert.ok(px[1 * 8 + 5] < 128);
  });

  it("renders ascii smile with eyes and mouth", () => {
    const ascii = renderSmileAscii(buildSmileFace8x8());
    const lines = ascii.split("\n");
    assert.equal(lines.length, 8);
    assert.match(lines[1], /■.*■/);
    assert.match(lines[5], /■/);
  });

  it("encodes → seals locations → reader rebuilds smile", () => {
    const demo = runSmileHatDemo({ bitsPerChunk: 64 });
    assert.equal(demo.picture.bits, 512);
    assert.equal(demo.chunkCount, 8); // 512/64
    assert.equal(demo.reconstruction.ok, true);
    assert.match(demo.reconstruction.ascii, /■/);
    assert.ok(demo.locations.every((l) => l.location.startsWith("0x")));
    assert.ok(demo.locations.every((l) => l.howToRead && l.codeLines.start >= 1));
    assert.ok(demo.locations[0].packetPreview.startsWith(HAT_MAGIC));
    // Encoded — packet is not raw 0xff paper pixels dumped as text art
    assert.equal(demo.locations[0].packetPreview.includes("········"), false);
  });

  it("reader proof HTML shows match and locations", () => {
    const full = runSmileHatDemo({ bitsPerChunk: 128 });
    assert.equal(full.chunkCount, 4);
    assert.equal(full.reconstruction.ok, true);
    const html = buildSmileProofHtml(full);
    assert.match(html, /READER MATCH/);
    assert.match(html, /Locations/);
    assert.match(html, /8×8/);
  });

  it("demo tx hashes are stable for same packet hash", () => {
    assert.equal(demoTxHash("abcd", 0), demoTxHash("abcd", 0));
    assert.notEqual(demoTxHash("abcd", 0), demoTxHash("abcd", 1));
  });
});
