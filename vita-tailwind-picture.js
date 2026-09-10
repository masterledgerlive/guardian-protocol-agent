/**
 * 🌟 VITA × TAILWIND PICTURE — sparse outbound inject on the wave-up
 * ─────────────────────────────────────────────────────────────────────────────
 * Mirrors how VITA already sparsely inserts memory IN (cliff notes / strands
 * across trades). When VITA triggers, we ARM a picture cycle; as the wave goes
 * UP, leftover hitch capacity ("tailwind" — free bytes on swaps we already pay
 * for) packs as much encoded picture data as fits until the message is complete.
 *
 * Then: seal location → reader can pull → start a NEW picture cycle (proof loop).
 *
 * Same rules as VITA / lose-zero:
 *   - Never invent free bytes — only leftover + earnings after error buffer
 *   - Never claim sent without receipt success + sealed txHash
 *   - Sparse across spaced txs (one chunk per inject-capable trade)
 */

import {
  buildSmileFace8x8,
  SMILE_WIDTH,
  SMILE_HEIGHT,
  SMILE_BITS_PER_PIXEL,
} from "./hat-smile-demo.js";
import {
  bytesToBits,
  contentSha256,
  setHatRegistry,
  getHatRegistry,
  appendHatNodeDraft,
  sealHatNodeLocation,
  HAT_MAGIC,
} from "./vita-hat.js";
import {
  planWaveHatRide,
  confirmHatWaveSend,
  sizeHatBytesForWave,
  nextReadyCursor,
} from "./hat-wave-inject.js";
import {
  buildSpacedChainProof,
  sealedPictureLocations,
  formatHatExitInjectReceiptHtml,
  confirmExitInject,
} from "./hat-exit-receipt.js";
import { appendUtf8Hitch } from "./swap-minout.js";
import { DEFAULT_HITCH_COST_MULT } from "./lose-zero-gate.js";

/** @type {null | { cycleId, bits, contentHash, strandId, armedAt, armedBy, complete }} */
let activeCycle = null;
let cycleCount = 0;
let lastPendingNodeId = null;

export function getVitaPictureCycle() {
  return activeCycle
    ? {
        ...activeCycle,
        bitsLength: activeCycle.bits.length,
        cursor: nextReadyCursor({
          ...getHatRegistry(),
          totalBits: activeCycle.bits.length,
        }),
      }
    : null;
}

export function isVitaPictureArmed() {
  return !!(activeCycle && !activeCycle.complete && activeCycle.bits?.length);
}

/**
 * VITA trigger → arm a new sparse picture cycle (smile proof by default).
 * Like starting a BTP strand after /vitasave — outbound data rides trades.
 */
export function armVitaTailwindPicture({
  triggeredBy = "vitasave",
  pixels = null,
} = {}) {
  const px = pixels || buildSmileFace8x8();
  const bits = bytesToBits(px);
  const contentHash = contentSha256(px);
  cycleCount += 1;
  const strandId =
    "VITA-PIC-" + String(cycleCount).padStart(4, "0") + "-" + contentHash.slice(0, 6);

  setHatRegistry({
    strandId,
    contentHash,
    lastHash: "00000000",
    nodes: [],
    totalBits: bits.length,
  });

  activeCycle = {
    cycleId: cycleCount,
    strandId,
    contentHash,
    bits,
    width: SMILE_WIDTH,
    height: SMILE_HEIGHT,
    bitsPerPixel: SMILE_BITS_PER_PIXEL,
    bytes: px.length,
    armedAt: new Date().toISOString(),
    armedBy: triggeredBy,
    complete: false,
    sealedLocations: 0,
  };
  lastPendingNodeId = null;

  return {
    armed: true,
    cycleId: cycleCount,
    strandId,
    contentHash,
    totalBits: bits.length,
    totalBytes: px.length,
    note:
      "VITA picture cycle armed — wave-up tailwind will sparse-inject until complete, then start next cycle",
  };
}

/**
 * Plan hitch for a trade: fill leftover (tailwind) with as much picture as fits.
 * Returns hitch fields compatible with planVoiceHitch + hatRide metadata.
 */
export function planTailwindPictureHitch(
  swapData,
  {
    skipHitch = false,
    maxBytes = null,
    leftoverEth = 0,
    earningsEth = 0,
    gwei = 0,
    hitchCostMult = DEFAULT_HITCH_COST_MULT,
    wantedBytes = null,
  } = {}
) {
  if (skipHitch || !swapData || !isVitaPictureArmed()) {
    return {
      data: swapData,
      utf8: "",
      hitchBytes: 0,
      onChain: false,
      kind: "none",
      hatRide: null,
    };
  }

  if (lastPendingNodeId) {
    return {
      data: swapData,
      utf8: "",
      hitchBytes: 0,
      onChain: false,
      kind: "wait_confirm",
      hatRide: { action: "wait_confirm", reason: "prior chunk unsealed" },
    };
  }

  const maxB =
    maxBytes != null && Number(maxBytes) > 0
      ? Math.floor(Number(maxBytes))
      : null;

  const ride = planWaveHatRide({
    bits: activeCycle.bits,
    leftoverEth,
    earningsEth,
    gwei,
    hitchCostMult,
    contentHash: activeCycle.contentHash,
    strandId: activeCycle.strandId,
    registry: getHatRegistry(),
    wantedBytes: wantedBytes ?? maxB ?? undefined,
    headerOverheadBytes: 100,
  });

  if (ride.action !== "hitch" || !ride.packet) {
    return {
      data: swapData,
      utf8: "",
      hitchBytes: 0,
      onChain: false,
      kind: ride.action || "skip",
      hatRide: ride,
    };
  }

  // Pack as much as maxBytes allows (tailwind ceiling from sell/buy gate)
  const hitch = appendUtf8Hitch(swapData, ride.packet, {
    maxBytes: maxB ?? ride.sized.hitchBytes ?? ride.packet.length,
  });
  if (!hitch.ok || !hitch.onChain) {
    return {
      data: swapData,
      utf8: "",
      hitchBytes: 0,
      onChain: false,
      kind: "skip",
      hatRide: { ...ride, action: "skip", reason: hitch.log || "append failed" },
    };
  }

  // Draft node now; seal only after receipt (same honesty as Eureka / VITA)
  const node = appendHatNodeDraft(ride.nodeDraft);
  lastPendingNodeId = node.nodeId;

  return {
    data: hitch.data,
    utf8: hitch.utf8,
    hitchBytes: hitch.hitchBytes,
    onChain: true,
    kind: "hat-picture",
    hatRide: ride,
    nodeId: node.nodeId,
    cycleId: activeCycle.cycleId,
    strandId: activeCycle.strandId,
  };
}

/**
 * After trade receipt: seal location, advance sparse cursor.
 * When picture complete → auto-arm next cycle (continuous proof).
 */
export function confirmTailwindPictureInject({
  txHash,
  receiptStatus,
  hitchOnChain = false,
  hitchBytes = 0,
  utf8 = "",
  nodeId = null,
  blockNumber = null,
  autoNextCycle = true,
} = {}) {
  const id = nodeId || lastPendingNodeId;
  const confirm = confirmExitInject({
    txHash,
    receiptStatus,
    hitchOnChain,
    hitchBytes,
    utf8,
    nodeId: id,
    blockNumber,
    seal: sealHatNodeLocation,
  });

  if (!confirm.injected) {
    // Failed receipt — drop pending so we can retry same bits (draft stays;
    // cursor waits on unsealed — clear pending flag by sealing? better: mark skip)
    // Leave draft unsealed; nextReadyCursor will wait. Clear lastPending so we
    // don't double-mint; caller should not mint again until sealed OR we remove draft.
    // For honesty: keep wait_confirm until manual resolve. Clear pending id only
    // if no hitch was on chain (never drafted).
    if (!hitchOnChain) lastPendingNodeId = null;
    return {
      ...confirm,
      cycleComplete: false,
      nextCycle: null,
      spacedProof: buildSpacedChainProof({
        locations: sealedPictureLocations(),
        totalBits: activeCycle?.bits?.length || 0,
      }),
    };
  }

  lastPendingNodeId = null;
  if (activeCycle) {
    activeCycle.sealedLocations = sealedPictureLocations().length;
  }

  const spacedProof = buildSpacedChainProof({
    locations: sealedPictureLocations(),
    totalBits: activeCycle?.bits?.length || getHatRegistry().totalBits || 0,
  });

  let nextCycle = null;
  let cycleComplete = false;
  if (spacedProof.pictureComplete && activeCycle) {
    cycleComplete = true;
    activeCycle.complete = true;
    if (autoNextCycle) {
      nextCycle = armVitaTailwindPicture({
        triggeredBy: "cycle-complete:" + activeCycle.strandId,
      });
    }
  }

  return {
    ...confirm,
    cycleComplete,
    nextCycle,
    spacedProof,
    receiptHtml: formatHatExitInjectReceiptHtml({
      confirm,
      spacedProof,
      pictureLabel: `VITA picture cycle #${activeCycle?.cycleId || "?"}`,
      thisLocationSeq: sealedPictureLocations().find((l) => l.location === txHash)
        ?.seq,
    }),
  };
}

/**
 * Prefer VITA picture tailwind when armed; else fall back to Eureka voice hitch.
 * Same sparse outbound pattern as VITA memory riding trades.
 */
export function planVitaTailwindOrVoiceHitch(
  swapData,
  {
    skipHitch = false,
    maxBytes,
    leftoverEth = 0,
    earningsEth = 0,
    gwei = 0,
    hitchCostMult = DEFAULT_HITCH_COST_MULT,
    voicePlanner = null,
    preferPicture = true,
  } = {}
) {
  if (preferPicture && isVitaPictureArmed() && !skipHitch) {
    const pic = planTailwindPictureHitch(swapData, {
      skipHitch,
      maxBytes,
      leftoverEth,
      earningsEth,
      gwei,
      hitchCostMult,
    });
    if (pic.onChain && pic.kind === "hat-picture") {
      return pic;
    }
  }
  if (typeof voicePlanner === "function") {
    return {
      ...voicePlanner(),
      kind: "voice",
      hatRide: null,
    };
  }
  return {
    data: swapData,
    utf8: "",
    hitchBytes: 0,
    onChain: false,
    kind: "none",
    hatRide: null,
  };
}

export function vitaPictureStatusMessage() {
  if (!activeCycle) {
    return (
      "🌟 <b>VITA PICTURE TAILWIND</b>\n" +
      "Not armed. /vitasave (or /vitadata /remember) arms a sparse picture cycle.\n" +
      "Wave-up leftover hitch then packs encoded smile bits until complete."
    );
  }
  const cursor = nextReadyCursor({
    ...getHatRegistry(),
    totalBits: activeCycle.bits.length,
  });
  const spaced = buildSpacedChainProof({
    locations: sealedPictureLocations(),
    totalBits: activeCycle.bits.length,
  });
  const sized = sizeHatBytesForWave({ leftoverEth: 0.001, gwei: 0.05 });
  return (
    `🌟 <b>VITA PICTURE CYCLE #${activeCycle.cycleId}</b>\n` +
    `Strand: <code>${activeCycle.strandId}</code>\n` +
    `Armed by: ${activeCycle.armedBy} @ ${activeCycle.armedAt}\n` +
    `Bits: ${cursor.confirmedBits}/${activeCycle.bits.length}` +
    (spaced.pictureComplete ? " ✓ COMPLETE" : "") +
    `\n` +
    `Spaced locations sealed: ${spaced.spacedBlockchainLocations}` +
    (spaced.locationsNeededForFullImage != null
      ? ` / ~${spaced.locationsNeededForFullImage} needed`
      : "") +
    `\n` +
    `Next-ready bit: ${cursor.nextBit}` +
    (cursor.pendingUnsealed ? " (waiting confirm)" : " (ready for tailwind)") +
    `\n` +
    `<i>Tailwind = leftover hitch on wave-up swaps — same sparse pattern as VITA memory in.</i>`
  );
}

/** Test helper */
export function resetVitaPictureCycleForTests() {
  activeCycle = null;
  cycleCount = 0;
  lastPendingNodeId = null;
  setHatRegistry({
    strandId: null,
    contentHash: null,
    lastHash: "00000000",
    nodes: [],
    totalBits: 0,
  });
}

export { HAT_MAGIC };
