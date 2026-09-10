import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  buildSpacedChainProof,
  assignSpacedDemoBlocks,
  confirmExitInject,
  formatHatExitInjectReceiptHtml,
  buildExitInjectReceiptBundle,
  sealedPictureLocations,
  spacedLocationsSummary,
  DEMO_BLOCK_SPACING,
} from "./hat-exit-receipt.js";
import { runSmileHatDemo } from "./hat-smile-demo.js";
import { setHatRegistry, getHatRegistry } from "./vita-hat.js";
import { formatSellReceiptHtml } from "./piggy-bank.js";

describe("hat-exit-receipt spaced chain proof", () => {
  it("counts spaced txs and block span for image assembly", () => {
    const locs = assignSpacedDemoBlocks(
      [
        { seq: 0, location: "0xaa", bitCount: 64 },
        { seq: 1, location: "0xbb", bitCount: 64 },
        { seq: 2, location: "0xcc", bitCount: 64 },
        { seq: 3, location: "0xdd", bitCount: 64 },
      ],
      { baseBlock: 1000, spacing: 3 }
    );
    const proof = buildSpacedChainProof({
      locations: locs,
      totalBits: 512,
      confirmedBits: 256,
    });
    assert.equal(proof.spacedBlockchainLocations, 4);
    assert.equal(proof.spacedBlocks, 4);
    assert.equal(proof.blockSpan, 9); // 1000..1009
    assert.equal(proof.locationsNeededForFullImage, 8);
    assert.equal(proof.pictureComplete, false);
    assert.match(proof.proofLine, /4 spaced/);
    assert.match(spacedLocationsSummary(proof), /4 spaced/);
  });

  it("marks complete when all bits sealed", () => {
    const locs = [
      { location: "0x1", bitCount: 256, blockNumber: 10 },
      { location: "0x2", bitCount: 256, blockNumber: 13 },
    ];
    const proof = buildSpacedChainProof({
      locations: locs,
      totalBits: 512,
      confirmedBits: 512,
    });
    assert.equal(proof.pictureComplete, true);
    assert.equal(proof.locationsNeededForFullImage, 2);
    assert.match(proof.proofLine, /assembled from 2/);
  });
});

describe("hat-exit-receipt confirm gate", () => {
  it("refuses claim without receipt success", () => {
    const bad = confirmExitInject({
      txHash: "0xabc123",
      receiptStatus: "reverted",
      hitchOnChain: true,
      hitchBytes: 100,
    });
    assert.equal(bad.injected, false);
    assert.match(bad.reason, /NOT claimed/i);
  });

  it("confirms inject only when hitch + receipt success", () => {
    const ok = confirmExitInject({
      txHash: "0x" + "ab".repeat(32),
      receiptStatus: "success",
      hitchOnChain: true,
      hitchBytes: 200,
      utf8: "§HAT§",
    });
    assert.equal(ok.injected, true);
    assert.ok(ok.basescan.includes("basescan"));
  });

  it("formats exit receipt HTML with spaced proof", () => {
    const html = formatHatExitInjectReceiptHtml({
      confirm: {
        injected: true,
        basescan: "https://basescan.org/tx/0xabc",
        hitchBytes: 120,
      },
      spacedProof: buildSpacedChainProof({
        locations: assignSpacedDemoBlocks(
          Array.from({ length: 8 }, (_, i) => ({
            seq: i,
            location: "0x" + i,
            bitCount: 64,
          }))
        ),
        totalBits: 512,
        confirmedBits: 512,
      }),
      pictureLabel: "8×8 smile",
      thisLocationSeq: 7,
    });
    assert.match(html, /HAT EXIT INJECT RECEIPT/);
    assert.match(html, /8 spaced/);
    assert.match(html, /location #7/);
  });
});

describe("smile demo + exit receipt + sell receipt wire", () => {
  beforeEach(() => {
    setHatRegistry({
      strandId: null,
      contentHash: null,
      lastHash: "00000000",
      nodes: [],
      totalBits: 0,
    });
  });

  it("smile demo seals spaced blocks and proves location count", () => {
    const demo = runSmileHatDemo({
      bitsPerChunk: 64,
      blockSpacing: DEMO_BLOCK_SPACING,
    });
    assert.equal(demo.reconstruction.ok, true);
    assert.equal(demo.spacedProof.spacedBlockchainLocations, 8);
    assert.equal(demo.spacedProof.spacedBlocks, 8);
    assert.equal(demo.spacedProof.blockSpan, 7 * DEMO_BLOCK_SPACING);
    assert.equal(demo.spacedProof.locationsNeededForFullImage, 8);
    assert.equal(demo.spacedProof.pictureComplete, true);
    assert.equal(demo.exitReceipts.length, 8);
    assert.match(demo.finalExitReceiptHtml, /HAT EXIT INJECT RECEIPT/);
    assert.match(demo.finalExitReceiptHtml, /8 spaced/);
    assert.ok(demo.locations.every((l) => l.blockNumber > 0));
  });

  it("sell receipt HTML includes hat inject receipt block", () => {
    const demo = runSmileHatDemo({ bitsPerChunk: 64 });
    const sell = formatSellReceiptHtml({
      symbol: "AERO",
      tradeNum: 1,
      entryPrice: 1,
      exitPrice: 1.1,
      investedUsd: 2,
      receivedEth: 0.001,
      receivedUsd: 2.2,
      netUsd: 0.2,
      earningsUsd: 0.15,
      hitchOnChain: true,
      hitchFooter: "💌 hitch",
      hatInjectReceipt: demo.finalExitReceiptHtml,
      bankedUsd: 0.05,
      piggyDustTokens: 1,
      piggyDustUsd: 0.15,
      piggySavedUsd: 0.15,
    });
    assert.match(sell, /RECEIPT — bought → sold/);
    assert.match(sell, /HAT EXIT INJECT RECEIPT/);
    assert.match(sell, /spaced/);
  });

  it("sealedPictureLocations only returns txHash nodes", () => {
    runSmileHatDemo({ bitsPerChunk: 128 });
    const locs = sealedPictureLocations(getHatRegistry().nodes);
    assert.equal(locs.length, 4);
    assert.ok(locs.every((l) => l.location.startsWith("0x")));
  });
});
