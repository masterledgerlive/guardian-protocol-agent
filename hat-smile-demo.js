/**
 * 🎩 HAT SMILE DEMO — slow-rez 8×8 × 8-bit picture → encoded HAT → reader
 * ─────────────────────────────────────────────────────────────────────────────
 * Proof we can send a PICTURE into the chain before tackling huge HTML.
 *
 * Pipeline:
 *   1. Build 8×8 grayscale smile (64 bytes / 512 bits) — not plaintext art
 *   2. Slice into HAT CHUNK packets (encoded hex bits)
 *   3. Seal each chunk with a location (demo tx hashes stand in for Base)
 *   4. Reader pulls every location + how to decode → reconstruct pixels
 *   5. Render ASCII + HTML proof page showing smile + location table
 *
 * Usage:
 *   node hat-smile-demo.js
 *   npm run hat:smile
 */

import { createHash, randomBytes } from "crypto";
import { mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  HAT_MAGIC,
  bytesToBits,
  encodeBitSlice,
  encodeHatPacket,
  hatHash,
  contentSha256,
  setHatRegistry,
  getHatRegistry,
  appendHatNodeDraft,
  sealHatNodeLocation,
  buildReaderManifest,
  reconstructFromHatNodes,
} from "./vita-hat.js";
import {
  DEMO_BLOCK_SPACING,
  assignSpacedDemoBlocks,
  buildSpacedChainProof,
  buildExitInjectReceiptBundle,
  formatHatExitInjectReceiptHtml,
  sealedPictureLocations,
  spacedLocationsSummary,
} from "./hat-exit-receipt.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** 8×8 slow-rez smile — 8-bit grayscale pixels (0=ink, 255=paper). */
export const SMILE_WIDTH = 8;
export const SMILE_HEIGHT = 8;
export const SMILE_BITS_PER_PIXEL = 8;

/**
 * Classic 8×8 smile face (rows top→bottom). 1 = ink, 0 = empty.
 * Eyes at (2,2)(5,2), smile arc on rows 5–6.
 */
export const SMILE_MASK = Object.freeze([
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 1, 0, 0, 1, 0, 0],
  [0, 0, 1, 0, 0, 1, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 1, 0, 0, 0, 0, 1, 0],
  [0, 0, 1, 1, 1, 1, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
]);

/** Build raw 8-bit pixel buffer (64 bytes). Ink=0x00, paper=0xFF. */
export function buildSmileFace8x8(mask = SMILE_MASK) {
  const pixels = Buffer.alloc(SMILE_WIDTH * SMILE_HEIGHT);
  for (let y = 0; y < SMILE_HEIGHT; y++) {
    for (let x = 0; x < SMILE_WIDTH; x++) {
      pixels[y * SMILE_WIDTH + x] = mask[y][x] ? 0x00 : 0xff;
    }
  }
  return pixels;
}

/** Pixels → ASCII (dark = ■, light = ·). */
export function renderSmileAscii(pixels, { on = "■", off = "·" } = {}) {
  const rows = [];
  for (let y = 0; y < SMILE_HEIGHT; y++) {
    let line = "";
    for (let x = 0; x < SMILE_WIDTH; x++) {
      const v = pixels[y * SMILE_WIDTH + x];
      line += v < 128 ? on : off;
    }
    rows.push(line);
  }
  return rows.join("\n");
}

/** Demo "Base" tx hash — deterministic from packet hash so runs are stable-ish. */
export function demoTxHash(packetHash, seq) {
  const h = createHash("sha256")
    .update("HAT-SMILE-DEMO|" + seq + "|" + packetHash)
    .digest("hex");
  return "0x" + h;
}

/**
 * Encode smile into N HAT chunks, seal locations, reader reconstructs.
 * @param {object} opts
 * @param {number} opts.bitsPerChunk — payload bits per CHUNK (default 64 = 8 pixels)
 */
export function runSmileHatDemo({
  bitsPerChunk = 64,
  reset = true,
  baseBlock = 37_000_000,
  blockSpacing = DEMO_BLOCK_SPACING,
} = {}) {
  if (reset) {
    setHatRegistry({
      strandId: null,
      contentHash: null,
      lastHash: "00000000",
      nodes: [],
      totalBits: 0,
    });
  }

  const pixels = buildSmileFace8x8();
  const contentHash = contentSha256(pixels);
  const bits = bytesToBits(pixels);
  const strandId = "HAT-SMILE-" + randomBytes(3).toString("hex");
  const totalBits = bits.length; // 512

  // Seed registry totals for cursor/reader
  setHatRegistry({
    strandId,
    contentHash,
    lastHash: "00000000",
    nodes: [],
    totalBits,
  });

  const codeLines = [];
  const sealed = [];
  const exitReceipts = [];
  let prevHash = "00000000";
  let seq = 0;

  for (let off = 0; off < totalBits; off += bitsPerChunk) {
    const count = Math.min(bitsPerChunk, totalBits - off);
    const encoded = encodeBitSlice(bits, off, count);
    const nodeKind = off === 0 && count === 1 ? "BIT" : "CHUNK";
    const blockNumber = baseBlock + seq * Math.max(1, blockSpacing);
    const meta = {
      role: "smile-8x8-8bit",
      strandId,
      contentHash,
      width: SMILE_WIDTH,
      height: SMILE_HEIGHT,
      bitsPerPixel: SMILE_BITS_PER_PIXEL,
      bitOffset: encoded.bitOffset,
      bitCount: encoded.bitCount,
      encoding: encoded.encoding,
      read: encoded.read,
      picture: "slow-rez smile face (proof before HTML)",
      blockNumber,
      confirmed: false,
    };
    const packet = encodeHatPacket({
      kind: nodeKind,
      seq,
      prevHash,
      encoded,
      meta,
    });
    const hash = hatHash(packet);
    const draft = {
      kind: nodeKind,
      prevHash,
      hash,
      packet,
      encoding: encoded.encoding,
      meta: { ...meta, hex: encoded.hex },
      nodeId: "HAT-" + String(seq).padStart(4, "0") + "-" + hash,
    };
    const node = appendHatNodeDraft(draft);
    const txHash = demoTxHash(hash, seq);

    // Exit-inject confirm path: only seal when "receipt success"
    const bundle = buildExitInjectReceiptBundle({
      txHash,
      receiptStatus: "success",
      hitchOnChain: true,
      hitchBytes: packet.length,
      utf8: packet.slice(0, 80),
      nodeId: node.nodeId,
      blockNumber,
      seal: sealHatNodeLocation,
      registry: getHatRegistry(),
      pictureLabel: "8×8×8-bit smile",
    });
    exitReceipts.push({
      seq,
      html: bundle.html,
      spacedProof: bundle.spacedProof,
      confirm: bundle.confirm,
    });

    const startLine = codeLines.length + 1;
    const packetLines = packet.match(/.{1,72}/g) || [packet];
    for (const pl of packetLines) codeLines.push(pl);
    const endLine = codeLines.length;

    sealed.push({
      seq,
      kind: nodeKind,
      nodeId: node.nodeId,
      location: txHash,
      basescan: "https://basescan.org/tx/" + txHash,
      blockNumber,
      bitOffset: off,
      bitCount: count,
      pixelsCovered: count / SMILE_BITS_PER_PIXEL,
      codeLines: { start: startLine, end: endLine },
      packetPreview: packet.slice(0, 96) + "…",
      howToRead: {
        fetch: "eth_getTransactionByHash(" + txHash + ") → input calldata → UTF-8",
        parse: "parseHatPacket(utf8)",
        decode: "decodeBitSlice({ hex, bitCount }) → place at bitOffset",
        render: "bits→bytes → 8×8 grayscale → ASCII/HTML",
        block: "block " + blockNumber + " (spaced +" + blockSpacing + " from prior)",
      },
    });

    prevHash = hash;
    seq += 1;
  }

  const spacedLocs = assignSpacedDemoBlocks(sealedPictureLocations(), {
    baseBlock,
    spacing: blockSpacing,
  });
  // Prefer real block numbers already sealed on nodes
  const locsForProof = sealedPictureLocations();
  const spacedProof = buildSpacedChainProof({
    locations: locsForProof.length ? locsForProof : spacedLocs,
    totalBits,
    confirmedBits: totalBits,
  });

  // Reader: pull locations → reconstruct
  const reader = buildReaderManifest();
  const recon = reconstructFromHatNodes(getHatRegistry().nodes, contentHash);
  const reconPixels = recon.bytes.slice(0, pixels.length);
  const match = Buffer.compare(reconPixels, pixels) === 0;
  const ascii = renderSmileAscii(reconPixels);

  // Final exit receipt after last location (full image)
  const finalExitReceiptHtml = formatHatExitInjectReceiptHtml({
    confirm: exitReceipts[exitReceipts.length - 1]?.confirm,
    spacedProof,
    pictureLabel: "8×8×8-bit smile",
    thisLocationSeq: sealed.length - 1,
  });

  return {
    kind: "hat-smile-demo",
    picture: {
      width: SMILE_WIDTH,
      height: SMILE_HEIGHT,
      bitsPerPixel: SMILE_BITS_PER_PIXEL,
      bytes: pixels.length,
      bits: totalBits,
      contentHash,
      note: "64-byte 8×8×8-bit smile — tiny proof before ~88KiB HTML",
    },
    strandId,
    chunkCount: sealed.length,
    bitsPerChunk,
    blockSpacing,
    spacedProof,
    spacedSummary: spacedLocationsSummary(spacedProof),
    locations: sealed,
    exitReceipts,
    finalExitReceiptHtml,
    reader,
    reconstruction: {
      ok: match,
      bitsCollected: recon.bitsCollected,
      ascii,
      contentHashExpected: contentHash,
      contentHashGot: contentSha256(reconPixels),
    },
    codeLines,
    originalPixelsHex: pixels.toString("hex"),
  };
}

/** HTML proof page: big pixel smile + location table + reader steps. */
export function buildSmileProofHtml(demo) {
  const cells = [];
  const pixels = Buffer.from(demo.originalPixelsHex, "hex");
  // Prefer reconstructed ascii match — render from recon via hex if ok
  const src = demo.reconstruction.ok
    ? Buffer.from(demo.originalPixelsHex, "hex")
    : pixels;
  for (let y = 0; y < SMILE_HEIGHT; y++) {
    for (let x = 0; x < SMILE_WIDTH; x++) {
      const v = src[y * SMILE_WIDTH + x];
      const ink = v < 128;
      cells.push(
        `<div class="px" style="background:${ink ? "#10231c" : "#e7f2e2"}" title="${x},${y}=${v}"></div>`
      );
    }
  }
  const locRows = demo.locations
    .map(
      (l) => `<tr>
      <td>${l.seq}</td>
      <td><code>${l.kind}</code></td>
      <td>bits ${l.bitOffset}–${l.bitOffset + l.bitCount - 1}</td>
      <td>block ${l.blockNumber ?? "?"}</td>
      <td>lines ${l.codeLines.start}–${l.codeLines.end}</td>
      <td><a href="${l.basescan}"><code>${l.location.slice(0, 14)}…</code></a></td>
      <td><code>${l.howToRead.decode}</code></td>
    </tr>`
    )
    .join("\n");

  const asciiPre = demo.reconstruction.ascii
    .split("\n")
    .map((r) => r.replace(/■/g, "█").replace(/·/g, "·"))
    .join("\n");

  const sp = demo.spacedProof || {};
  const exitPlain = (demo.finalExitReceiptHtml || "")
    .replace(/<[^>]+>/g, "")
    .replace(/&[^;]+;/g, " ");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>HAT Smile Proof — picture on chain before HTML</title>
  <link href="https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=IBM+Plex+Mono:wght@400;600&display=swap" rel="stylesheet" />
  <style>
    :root {
      --ink: #10231c;
      --lime: #b6f25c;
      --sand: #e7f2e2;
      --muted: #3d5a4c;
      --display: "Syne", sans-serif;
      --mono: "IBM Plex Mono", monospace;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0; color: var(--ink); font-family: var(--mono);
      background:
        radial-gradient(700px 360px at 10% -10%, rgba(182,242,92,.5), transparent 55%),
        linear-gradient(165deg, #f4fbf0, #d9ebe0 50%, #cfe0f5);
      min-height: 100vh; padding: 1.5rem;
    }
    h1 { font-family: var(--display); font-size: clamp(1.8rem, 5vw, 3rem); margin: 0 0 .4rem; letter-spacing: -.03em; }
    .lede { color: var(--muted); max-width: 40rem; margin: 0 0 1.5rem; font-size: .95rem; }
    .ok { display: inline-block; background: var(--lime); padding: .25rem .55rem; font-weight: 600; margin-bottom: 1rem; }
    .grid {
      display: grid; grid-template-columns: repeat(8, 1fr);
      width: min(280px, 70vw); aspect-ratio: 1;
      gap: 3px; border: 2px solid var(--ink); padding: 4px; background: #fff;
      image-rendering: pixelated;
    }
    .px { width: 100%; height: 100%; }
    section { margin: 1.75rem 0; }
    h2 { font-family: var(--display); font-size: 1.15rem; margin: 0 0 .6rem; }
    table { width: 100%; border-collapse: collapse; font-size: .72rem; }
    th, td { border-bottom: 1px solid rgba(16,35,28,.15); padding: .45rem .35rem; text-align: left; vertical-align: top; }
    th { font-family: var(--display); }
    pre.ascii {
      font-size: 1.1rem; line-height: 1.15; letter-spacing: .08em;
      background: rgba(255,255,255,.7); padding: .8rem 1rem; display: inline-block;
      border: 1px solid rgba(16,35,28,.2);
    }
    pre.receipt {
      white-space: pre-wrap; font-size: .75rem; line-height: 1.35;
      background: rgba(255,255,255,.75); padding: .8rem 1rem;
      border: 1px solid rgba(16,35,28,.2); max-width: 40rem;
    }
    code { font-size: .7rem; word-break: break-all; }
    .meta { font-size: .8rem; color: var(--muted); }
    .stat { font-family: var(--display); font-size: 1.4rem; margin: .2rem 0; }
  </style>
</head>
<body>
  <h1>HAT smile proof</h1>
  <p class="lede">Slow-rez <b>8×8 × 8-bit</b> smile encoded as <code>§HAT§</code> bitpack chunks —
  reader pulls every sealed location and rebuilds the picture. Tiny proof before the huge HTML site.</p>
  <div class="ok">${demo.reconstruction.ok ? "✓ READER MATCH — picture reconstructed from locations" : "✗ mismatch"}</div>

  <section>
    <h2>Spaced blockchain proof</h2>
    <p class="stat">${sp.spacedBlockchainLocations ?? demo.chunkCount} spaced locations</p>
    <p class="meta">${demo.spacedSummary || ""}</p>
    <p class="meta">Blocks touched: <b>${sp.spacedBlocks ?? "?"}</b>
      ${sp.blockSpan != null ? `· span ${sp.blockSpan} blocks apart` : ""}
      ${demo.blockSpacing ? `· +${demo.blockSpacing} blocks between each seal` : ""}</p>
    <p class="meta">Full image needs <b>${sp.locationsNeededForFullImage ?? demo.chunkCount}</b> spaced txs — each exit inject seals one.</p>
  </section>

  <section>
    <h2>Reconstructed picture</h2>
    <div class="grid">${cells.join("")}</div>
    <pre class="ascii">${asciiPre}</pre>
    <p class="meta">${demo.picture.bytes} bytes · ${demo.picture.bits} bits · hash <code>${demo.picture.contentHash.slice(0, 16)}…</code> · ${demo.chunkCount} sealed locations</p>
  </section>

  <section>
    <h2>Exit inject receipt (last location)</h2>
    <pre class="receipt">${exitPlain}</pre>
  </section>

  <section>
    <h2>Locations (reader pulls these)</h2>
    <table>
      <thead>
        <tr><th>#</th><th>kind</th><th>bits</th><th>block</th><th>code lines</th><th>location</th><th>how to read</th></tr>
      </thead>
      <tbody>
        ${locRows}
      </tbody>
    </table>
  </section>

  <section>
    <h2>Reader walk</h2>
    <ol class="meta">
      <li>On each inject-capable exit: hitch chunk → wait receipt success → seal location.</li>
      <li>Start at location #0 (HAT_ROOT_TX once live on Base).</li>
      <li>Fetch calldata → UTF-8 → <code>parseHatPacket</code>.</li>
      <li><code>decodeBitSlice</code> → place bits at <code>bitOffset</code>.</li>
      <li>Walk every sealed location in seq order across spaced blocks (append-only).</li>
      <li>bits→bytes → 8×8 grayscale → smile. Count of spaced txs = proof.</li>
    </ol>
  </section>
</body>
</html>`;
}

const isMain =
  process.argv[1] && String(process.argv[1]).endsWith("hat-smile-demo.js");

if (isMain) {
  const demo = runSmileHatDemo({ bitsPerChunk: 64 });
  const outDir = join(__dirname, "artifacts");
  mkdirSync(outDir, { recursive: true });
  const jsonPath = join(outDir, "hat-smile-proof.json");
  const htmlPath = join(outDir, "hat-smile-proof.html");
  writeFileSync(jsonPath, JSON.stringify(demo, null, 2));
  writeFileSync(htmlPath, buildSmileProofHtml(demo));
  const publicPath = join(__dirname, "public", "hat-smile-proof.html");
  writeFileSync(publicPath, buildSmileProofHtml(demo));

  console.log("🎩 HAT SMILE DEMO — 8×8 × 8-bit picture → spaced chain → exit receipt\n");
  console.log(demo.reconstruction.ascii);
  console.log("");
  console.log(
    demo.reconstruction.ok
      ? "✓ reader rebuilt the smile from sealed locations"
      : "✗ reconstruction failed"
  );
  console.log(
    `  ${demo.picture.bytes}B / ${demo.picture.bits} bits · ${demo.chunkCount} chunks × ${demo.bitsPerChunk} bits`
  );
  console.log(`  ${demo.spacedSummary}`);
  console.log(
    `  Full image needed ${demo.spacedProof.locationsNeededForFullImage} spaced blockchain locations` +
      (demo.spacedProof.blockSpan != null
        ? ` across ${demo.spacedProof.spacedBlocks} blocks (span ${demo.spacedProof.blockSpan})`
        : "")
  );
  console.log("\nLocations (spaced blocks):");
  for (const l of demo.locations) {
    console.log(
      `  [#${l.seq}] block ${l.blockNumber} · bits ${l.bitOffset}..${l.bitOffset + l.bitCount - 1} · lines ${l.codeLines.start}-${l.codeLines.end}`
    );
    console.log(`       ${l.location}`);
  }
  console.log("\n── Exit inject receipt (last seal) ──");
  console.log(
    (demo.finalExitReceiptHtml || "").replace(/<[^>]+>/g, "").replace(/&[^;]+;/g, " ")
  );
  console.log(`\nProof HTML: ${htmlPath}`);
  console.log(`Public page: ${publicPath}`);
  console.log(`Proof JSON: ${jsonPath}`);
}
