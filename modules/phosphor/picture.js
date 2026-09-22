/**
 * Deterministic phosphor picture. Tile repeats squash far under the raw
 * PPM. The unwrap formula is the location directory, not a second copy
 * of the pixels.
 */

export function synthPicture() {
  const width = 96;
  const height = 64;
  const header = Buffer.from("P6\n" + width + " " + height + "\n255\n", "ascii");
  const body = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      body[i] = (x >> 3) * 30;
      body[i + 1] = (y >> 2) * 20;
      body[i + 2] = ((x >> 2) + (y >> 2)) * 8;
    }
  }
  return Buffer.concat([header, body]);
}
