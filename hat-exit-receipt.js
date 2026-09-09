/**
 * 🎩 HAT EXIT RECEIPT — inject confirmation + spaced-chain image proof
 * ─────────────────────────────────────────────────────────────────────────────
 * When an exit can inject, the sell receipt must prove:
 *   1. The hitch actually landed (tx receipt success → location sealed)
 *   2. How many *spaced* blockchain locations (separate txs / blocks) are
 *      required to assemble the picture the reader rebuilds
 *
 * "Spaced" = distinct on-chain locations (usually different blocks). The image
 * is not in one place — the reader walks N sealed txs to rebuild pixels.
 *
 * Still never claim inject without a successful receipt + sealed txHash.
 */

import { getHatRegistry, confirmedBitCount } from "./vita-hat.js";

/** Default synthetic block gap between demo seals (proves spacing). */
export const DEMO_BLOCK_SPACING = 3;

/**
 * Sort sealed BIT/CHUNK nodes with locations for reader assembly order.
 */
export function sealedPictureLocations(nodes = getHatRegistry().nodes || []) {
  return (nodes || [])
    .filter((n) => (n.kind === "BIT" || n.kind === "CHUNK") && n.txHash)
    .slice()
    .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
    .map((n, i) => ({
      seq: n.seq ?? i,
      nodeId: n.nodeId,
      location: n.txHash,
      basescan: "https://basescan.org/tx/" + n.txHash,
      blockNumber: n.blockNumber ?? n.meta?.blockNumber ?? null,
      bitOffset: n.meta?.bitOffset ?? 0,
      bitCount: n.meta?.bitCount ?? 0,
      confirmed: !!(n.confirmed || n.meta?.confirmed),
    }));
}

/**
 * Spaced-chain proof: how many distinct txs/blocks assemble the image.
 *
 * @param {object} opts
 * @param {Array} opts.locations — sealed locations (from sealedPictureLocations)
 * @param {number} opts.totalBits — full picture bit count
 * @param {number} opts.confirmedBits — bits sealed so far
 */
export function buildSpacedChainProof({
  locations = [],
  totalBits = 0,
  confirmedBits = null,
} = {}) {
  const locs = Array.isArray(locations) ? locations : [];
  const spacedTxs = locs.length;
  const blocks = locs
    .map((l) => Number(l.blockNumber))
    .filter((b) => Number.isFinite(b) && b > 0);
  const uniqueBlocks = [...new Set(blocks)].sort((a, b) => a - b);
  const spacedBlocks = uniqueBlocks.length;
  const blockSpan =
    uniqueBlocks.length >= 2
      ? uniqueBlocks[uniqueBlocks.length - 1] - uniqueBlocks[0]
      : uniqueBlocks.length === 1
        ? 0
        : null;
  const gaps = [];
  for (let i = 1; i < uniqueBlocks.length; i++) {
    gaps.push(uniqueBlocks[i] - uniqueBlocks[i - 1]);
  }
  const avgGap =
    gaps.length > 0 ? gaps.reduce((s, g) => s + g, 0) / gaps.length : null;

  const total = Math.max(0, Number(totalBits) || 0);
  const confirmed =
    confirmedBits != null
      ? Math.max(0, Number(confirmedBits) || 0)
      : locs.reduce((s, l) => s + (Number(l.bitCount) || 0), 0);
  const remaining = Math.max(0, total - confirmed);
  const complete = total > 0 && confirmed >= total;

  return {
    spacedBlockchainLocations: spacedTxs,
    spacedBlocks,
    uniqueBlockNumbers: uniqueBlocks,
    blockSpan,
    avgBlockGap: avgGap,
    locationsNeededForFullImage: total > 0 && spacedTxs > 0
      ? // estimate remaining locations at same bits/location average
        (() => {
          const avgBits =
            confirmed > 0 && spacedTxs > 0 ? confirmed / spacedTxs : 0;
          if (!(avgBits > 0)) return spacedTxs;
          return Math.ceil(total / avgBits);
        })()
      : spacedTxs,
    locationsSealedSoFar: spacedTxs,
    locationsRemainingEstimate:
      total > 0 && confirmed > 0 && spacedTxs > 0
        ? Math.max(0, Math.ceil(total / (confirmed / spacedTxs)) - spacedTxs)
        : null,
    confirmedBits: confirmed,
    totalBits: total,
    remainingBits: remaining,
    pictureComplete: complete,
    proofLine:
      spacedTxs <= 0
        ? "No sealed locations yet — image not on chain"
        : complete
          ? `Picture assembled from ${spacedTxs} spaced blockchain location${spacedTxs === 1 ? "" : "s"}` +
            (spacedBlocks > 0
              ? ` across ${spacedBlocks} block${spacedBlocks === 1 ? "" : "s"}` +
                (blockSpan != null && blockSpan > 0 ? ` (span ${blockSpan})` : "")
              : "")
          : `Image in progress: ${spacedTxs} spaced location${spacedTxs === 1 ? "" : "s"} sealed` +
            (spacedBlocks > 0 ? ` / ${spacedBlocks} blocks` : "") +
            ` · ${confirmed}/${total} bits`,
  };
}

/**
 * Assign demo block numbers with spacing so proofs show distinct chain slots.
 * location[i] → baseBlock + i * spacing
 */
export function assignSpacedDemoBlocks(
  locations,
  { baseBlock = 10_000_000, spacing = DEMO_BLOCK_SPACING } = {}
) {
  const space = Math.max(1, Math.floor(Number(spacing) || DEMO_BLOCK_SPACING));
  const base = Math.max(1, Math.floor(Number(baseBlock) || 10_000_000));
  return (locations || []).map((l, i) => ({
    ...l,
    blockNumber: base + i * space,
  }));
}

/**
 * Confirm an exit inject only when the chain receipt succeeded.
 * Returns a receipt object for Telegram / ledger — never claims sent on fail.
 */
export function confirmExitInject({
  txHash = "",
  receiptStatus = null,
  hitchOnChain = false,
  hitchBytes = 0,
  utf8 = "",
  nodeId = null,
  blockNumber = null,
  seal = null,
} = {}) {
  const hash = String(txHash || "").trim();
  const okReceipt =
    receiptStatus === "success" ||
    receiptStatus === 1 ||
    receiptStatus === "0x1";
  if (!hitchOnChain) {
    return {
      ok: false,
      injected: false,
      reason: "exit had no on-chain hitch — plain sale",
      txHash: hash || null,
    };
  }
  if (!hash.startsWith("0x") || hash.length < 4) {
    return {
      ok: false,
      injected: false,
      reason: "no txHash — cannot seal location or claim inject",
    };
  }
  if (!okReceipt) {
    return {
      ok: false,
      injected: false,
      reason: `receipt ${receiptStatus ?? "unknown"} — inject NOT claimed`,
      txHash: hash,
    };
  }

  let sealed = null;
  if (typeof seal === "function" && nodeId) {
    sealed = seal(nodeId, hash);
    if (sealed?.ok && sealed.node && blockNumber != null) {
      sealed.node.blockNumber = Number(blockNumber);
      sealed.node.meta = {
        ...sealed.node.meta,
        blockNumber: Number(blockNumber),
        confirmed: true,
      };
      sealed.node.confirmed = true;
    }
  }

  return {
    ok: true,
    injected: true,
    reason: "exit inject confirmed — location sealed for reader",
    txHash: hash,
    basescan: "https://basescan.org/tx/" + hash,
    hitchBytes: Math.max(0, Number(hitchBytes) || 0),
    utf8: utf8 || "",
    blockNumber: blockNumber != null ? Number(blockNumber) : null,
    sealed: !!(sealed?.ok),
    nodeId: sealed?.node?.nodeId || nodeId,
  };
}

/**
 * Telegram HTML block for the exit inject receipt + spaced image proof.
 * Attach under the sell WAVE COMPLETE receipt when inject landed.
 */
export function formatHatExitInjectReceiptHtml({
  confirm = null,
  spacedProof = null,
  pictureLabel = "HAT picture",
  thisLocationSeq = null,
} = {}) {
  if (!confirm?.injected) {
    const why = confirm?.reason || "inject not confirmed";
    return (
      `🎩 <b>HAT EXIT INJECT — NOT CLAIMED</b>\n` +
      `⚠️ ${why}` +
      (confirm?.txHash
        ? `\n🔗 <a href="https://basescan.org/tx/${confirm.txHash}">Basescan</a>`
        : "")
    );
  }

  const proof = spacedProof || buildSpacedChainProof({});
  const lines = [
    `🎩 <b>HAT EXIT INJECT RECEIPT</b>`,
    `✅ Inject confirmed on exit — location sealed`,
    thisLocationSeq != null
      ? `📍 This exit = location #${thisLocationSeq}`
      : `📍 Location sealed for reader`,
    `🔗 <a href="${confirm.basescan}">View on Basescan ↗</a>`,
    confirm.hitchBytes
      ? `📡 Hitch ${confirm.hitchBytes} B on-chain (Input Data → UTF-8)`
      : null,
    `━━━━━━━━━━━━━━━━━━━━`,
    `<b>SPACED CHAIN PROOF — ${pictureLabel}</b>`,
    `🧩 Locations used: <b>${proof.spacedBlockchainLocations}</b> spaced tx${proof.spacedBlockchainLocations === 1 ? "" : "s"}`,
    proof.spacedBlocks > 0
      ? `📦 Blocks touched: <b>${proof.spacedBlocks}</b>` +
        (proof.blockSpan != null && proof.blockSpan > 0
          ? ` (span ${proof.blockSpan} blocks apart)`
          : "")
      : null,
    proof.locationsNeededForFullImage != null
      ? `📐 Full image needs ~<b>${proof.locationsNeededForFullImage}</b> spaced location${proof.locationsNeededForFullImage === 1 ? "" : "s"}`
      : null,
    proof.totalBits > 0
      ? `🔢 Bits: ${proof.confirmedBits}/${proof.totalBits}` +
        (proof.pictureComplete ? " ✓ COMPLETE" : ` (${proof.remainingBits} left)`)
      : null,
    `📖 ${proof.proofLine}`,
    `Reader: pull each location → decodeHat → assemble pixels`,
  ];
  return lines.filter((l) => l != null && l !== "").join("\n");
}

/**
 * Build exit receipt bundle after a successful sell hitch.
 * Pure: pass registry snapshot + confirm inputs.
 */
export function buildExitInjectReceiptBundle({
  txHash,
  receiptStatus,
  hitchOnChain,
  hitchBytes,
  utf8,
  nodeId = null,
  blockNumber = null,
  seal = null,
  registry = null,
  pictureLabel = "8×8 smile / HAT picture",
} = {}) {
  const confirm = confirmExitInject({
    txHash,
    receiptStatus,
    hitchOnChain,
    hitchBytes,
    utf8,
    nodeId,
    blockNumber,
    seal,
  });

  const reg = registry || getHatRegistry();
  const locs = sealedPictureLocations(reg.nodes);
  const spacedProof = buildSpacedChainProof({
    locations: locs,
    totalBits: reg.totalBits || 0,
    confirmedBits: confirmedBitCount(reg.nodes),
  });

  const html = formatHatExitInjectReceiptHtml({
    confirm,
    spacedProof,
    pictureLabel,
    thisLocationSeq: confirm.injected
      ? locs.find((l) => l.location === txHash)?.seq ?? locs.length - 1
      : null,
  });

  return { confirm, spacedProof, locations: locs, html };
}

/**
 * CLI / demo: one-line summary of spaced locations for an image.
 */
export function spacedLocationsSummary(spacedProof) {
  const p = spacedProof || {};
  if (!(p.spacedBlockchainLocations > 0)) {
    return "0 spaced blockchain locations — nothing sealed";
  }
  return (
    `${p.spacedBlockchainLocations} spaced blockchain location` +
    `${p.spacedBlockchainLocations === 1 ? "" : "s"}` +
    (p.spacedBlocks > 0 ? ` / ${p.spacedBlocks} blocks` : "") +
    (p.pictureComplete
      ? " → full image"
      : ` → ${p.confirmedBits}/${p.totalBits} bits`)
  );
}
