/**
 * 🎩 HAT × WAVE — cost-aware memory inject on the ride up
 * ─────────────────────────────────────────────────────────────────────────────
 * One bit is only the genesis proof. Once leftover + earnings cover transmission
 * (plus an error cushion so we actually send), size the next HAT chunk larger.
 *
 * Wave math hard-codes transmission into the sell floor:
 *   sell_target ≥ entry + fees + (mult × hitch_cost(bytes)) + error_buffer
 * Every bit that rides up is paid for by that floor — we do not invent free bytes.
 *
 * Cursor: last confirmed bit offset → next-ready chunk for the next hitch.
 * Confirmation: location (txHash) sealed ONLY after on-chain send — reader trusts
 * sealed locations, never "queued" or "planned" packets.
 *
 * Exit without crash: once message is confirmed + location sealed + leftover
 * still green, allow sell on the way UP (confirmed-send exit). Do not wait for
 * a peak crash just to prove the code landed.
 *
 * Still never hitch when leftover ≤ 0. Still never claim sent without a seal.
 */

import {
  CALLDATA_GAS_PER_NONZERO_BYTE,
  DEFAULT_HITCH_COST_MULT,
  STORE_HITCH_BYTES,
  estimateCalldataHitchEth,
  estimateInjectHitchCostEth,
  leftoverAfterFeesEth,
  maxHitchBytesForLeftover,
  sizeHitchForSell,
} from "./lose-zero-gate.js";
import {
  HAT_MAGIC,
  HITCH_BUDGETS,
  encodeBitSlice,
  encodeHatPacket,
  hatHash,
  getHatRegistry,
  coveredBitCount,
  sealHatNodeLocation,
} from "./vita-hat.js";

/** Fraction of leftover reserved so gas/L1 wobble still lets the hitch land. */
export const TRANSMISSION_ERROR_PCT = 0.15;

/** Absolute ETH floor for transmission error when leftover is tiny. */
export const TRANSMISSION_ERROR_ETH_FLOOR = 0.00002;

/** Minimum payload bits after genesis — still allows 1-bit when thin. */
export const MIN_WAVE_BITS = 1;

/** Soft cap per hitch so one wave cannot starve cascade gas (bytes). */
export const MAX_WAVE_HITCH_BYTES = HITCH_BUDGETS.fragment;

/**
 * Error cushion ETH: leave room so we actually send.
 * max(floor, leftover × pct) — never spends the whole leftover on payload.
 */
export function transmissionErrorBufferEth(
  leftoverEth = 0,
  {
    pct = TRANSMISSION_ERROR_PCT,
    floorEth = TRANSMISSION_ERROR_ETH_FLOOR,
  } = {}
) {
  const left = Math.max(0, Number(leftoverEth) || 0);
  const p = Math.max(0, Math.min(0.9, Number(pct) || 0));
  const floor = Math.max(0, Number(floorEth) || 0);
  if (!(left > 0)) return 0;
  return Math.min(left * 0.5, Math.max(floor, left * p));
}

/**
 * Spendable leftover for hitch bytes after error cushion + optional earnings skim.
 * Earnings can ADD capacity (wave profit pays for more bits) without spending
 * the piggy principal — only the earnings slice is optional fuel.
 */
export function spendableForTransmissionEth({
  leftoverEth = 0,
  earningsEth = 0,
  useEarningsFraction = 0.5,
  errorPct = TRANSMISSION_ERROR_PCT,
  errorFloorEth = TRANSMISSION_ERROR_ETH_FLOOR,
} = {}) {
  const left = Math.max(0, Number(leftoverEth) || 0);
  const earn = Math.max(0, Number(earningsEth) || 0);
  const frac = Math.max(0, Math.min(1, Number(useEarningsFraction) || 0));
  const earnFuel = earn * frac;
  const pooled = left + earnFuel;
  const err = transmissionErrorBufferEth(pooled, {
    pct: errorPct,
    floorEth: errorFloorEth,
  });
  const spendable = Math.max(0, pooled - err);
  return {
    leftoverEth: left,
    earningsEth: earn,
    earningsFuelEth: earnFuel,
    pooledEth: pooled,
    errorBufferEth: err,
    spendableEth: spendable,
  };
}

/**
 * How many HAT payload bytes this wave can afford (header overhead separate).
 * Uses lose-zero sizeHitchForSell so mult×cost stays inside leftover rules.
 */
export function sizeHatBytesForWave({
  leftoverEth = 0,
  earningsEth = 0,
  gwei = 0,
  wantedBytes = MAX_WAVE_HITCH_BYTES,
  hitchCostMult: mult = DEFAULT_HITCH_COST_MULT,
  providerFeeEth = 0,
  l1FeeEth,
  l1FeePerByteEth,
  useEarningsFraction = 0.5,
  errorPct = TRANSMISSION_ERROR_PCT,
  headerOverheadBytes = 120, // §HAT§ packet + META approx
} = {}) {
  const fuel = spendableForTransmissionEth({
    leftoverEth,
    earningsEth,
    useEarningsFraction,
    errorPct,
  });
  if (!(fuel.spendableEth > 0)) {
    return {
      ...fuel,
      hitchBytes: 0,
      payloadBytes: 0,
      payloadBits: 0,
      injectCostEth: 0,
      skipHitch: true,
      reason: "no spendable leftover after transmission error buffer",
    };
  }

  const wanted = Math.max(
    0,
    Math.min(MAX_WAVE_HITCH_BYTES, Math.floor(Number(wantedBytes) || 0))
  );
  const sized = sizeHitchForSell({
    leftoverEth: fuel.spendableEth,
    wantedBytes: wanted,
    gwei,
    providerFeeEth,
    hitchCostMult: mult,
    l1FeeEth,
    l1FeePerByteEth,
  });

  const hitchBytes = sized.hitchBytes || 0;
  const payloadBytes = Math.max(0, hitchBytes - headerOverheadBytes);
  const payloadBits = payloadBytes * 8;

  return {
    ...fuel,
    hitchBytes,
    payloadBytes,
    payloadBits,
    injectCostEth: sized.injectCostEth || 0,
    hitchCostMult: sized.hitchCostMult ?? mult,
    skipHitch: sized.skipHitch || hitchBytes === 0,
    reason: sized.skipHitch
      ? "leftover too thin for hitch after error buffer"
      : payloadBits > 0
        ? "wave-paid HAT chunk"
        : hitchBytes > 0
          ? "hitch fits header only — bump leftover for payload bits"
          : "skip",
  };
}

/**
 * Sell floor with transmission hard-coded into the wave.
 * sell_target = entry_slice + fees + (mult × hitch_cost) + error_buffer
 */
export function waveSellTargetWithTransmission({
  entryEth = 0,
  sellPct = 1,
  projectedProceedsEth = 0,
  feePct = 0,
  gasCostEth = 0,
  impactPct = 0,
  hitchBytes = STORE_HITCH_BYTES,
  gwei = 0,
  providerFeeEth = 0,
  hitchCostMult: mult = DEFAULT_HITCH_COST_MULT,
  l1FeeEth,
  errorPct = TRANSMISSION_ERROR_PCT,
  errorFloorEth = TRANSMISSION_ERROR_ETH_FLOOR,
} = {}) {
  const entry =
    Math.max(0, Number(entryEth) || 0) * Math.max(0, Number(sellPct) || 0);
  const proceeds = Math.max(0, Number(projectedProceedsEth) || 0);
  const fee = Math.max(0, Number(feePct) || 0) * proceeds;
  const impact = Math.max(0, Number(impactPct) || 0) * proceeds;
  const gas = Math.max(0, Number(gasCostEth) || 0);
  const fees = fee + impact + gas;
  const hitchCost = estimateInjectHitchCostEth({
    hitchBytes,
    gwei,
    providerFeeEth,
    l1FeeEth,
  });
  const m =
    Number.isFinite(Number(mult)) && Number(mult) >= 0
      ? Number(mult)
      : DEFAULT_HITCH_COST_MULT;
  const leftover = leftoverAfterFeesEth({
    projectedProceedsEth,
    entryEth,
    sellPct,
    feePct,
    gasCostEth,
    impactPct,
  });
  const err = transmissionErrorBufferEth(leftover, {
    pct: errorPct,
    floorEth: errorFloorEth,
  });
  const sellTarget = entry + fees + m * hitchCost + err;
  const covers =
    Number.isFinite(proceeds) && proceeds + 1e-18 >= sellTarget && leftover > 0;
  return {
    sellTargetEth: sellTarget,
    entrySliceEth: entry,
    feesEth: fees,
    hitchCostEth: hitchCost,
    hitchCoverEth: m * hitchCost,
    hitchCostMult: m,
    hitchBytes: Math.max(0, Number(hitchBytes) || 0),
    errorBufferEth: err,
    leftoverAfterFeesEth: leftover,
    covers,
    edgeEth: covers ? proceeds - sellTarget : proceeds - sellTarget,
  };
}

/**
 * Next-ready cursor: first bit index not yet confirmed on a sealed BIT/CHUNK.
 * Unsealed (planned) nodes do NOT advance the cursor — only confirmed sends.
 */
export function nextReadyCursor(registry = getHatRegistry()) {
  const nodes = registry?.nodes || [];
  let confirmedBits = 0;
  let pendingUnsealed = 0;
  for (const n of nodes) {
    if (n.kind !== "BIT" && n.kind !== "CHUNK") continue;
    const count = Number(n.meta?.bitCount) || 0;
    const off = Number(n.meta?.bitOffset) || 0;
    if (n.txHash) {
      confirmedBits = Math.max(confirmedBits, off + count);
    } else {
      pendingUnsealed += 1;
    }
  }
  const totalBits =
    Number(registry?.totalBits) ||
    coveredBitCount?.(nodes) ||
    confirmedBits;
  return {
    nextBit: confirmedBits,
    confirmedBits,
    pendingUnsealed,
    remainingBits: Math.max(0, (Number(totalBits) || 0) - confirmedBits),
    ready: pendingUnsealed === 0,
    note: pendingUnsealed
      ? "wait for confirmation seal before minting next wave chunk"
      : "next-ready bit offset for wave hitch",
  };
}

/**
 * Plan one wave hitch: size from leftover+earnings, resume at next-ready cursor,
 * mint packet bytes (not plaintext). Does not claim sent — caller must confirm.
 */
export function planWaveHatRide({
  bits,
  leftoverEth = 0,
  earningsEth = 0,
  gwei = 0,
  hitchCostMult = DEFAULT_HITCH_COST_MULT,
  contentHash = null,
  strandId = null,
  registry = getHatRegistry(),
  forceMinBits = MIN_WAVE_BITS,
  ...sizeOpts
} = {}) {
  const cursor = nextReadyCursor({
    ...registry,
    totalBits: bits?.length ?? registry?.totalBits,
  });
  const sized = sizeHatBytesForWave({
    leftoverEth,
    earningsEth,
    gwei,
    hitchCostMult,
    ...sizeOpts,
  });

  if (!bits || !bits.length) {
    return {
      action: "skip",
      reason: "no bit stream",
      cursor,
      sized,
      packet: null,
    };
  }

  if (cursor.pendingUnsealed > 0) {
    return {
      action: "wait_confirm",
      reason: cursor.note,
      cursor,
      sized,
      packet: null,
    };
  }

  if (cursor.nextBit >= bits.length) {
    return {
      action: "done",
      reason: "all bits confirmed on sealed nodes",
      cursor,
      sized,
      packet: null,
    };
  }

  // Thin book: still allow genesis/min bit if we can afford header+1 bit
  let payloadBits = sized.payloadBits;
  if (payloadBits < forceMinBits && !sized.skipHitch && sized.hitchBytes > 0) {
    payloadBits = forceMinBits;
  }
  if (payloadBits < forceMinBits) {
    return {
      action: "skip",
      reason: sized.reason || "cannot afford min bits after error buffer",
      cursor,
      sized,
      packet: null,
      sellTarget: waveSellTargetWithTransmission({
        hitchBytes: STORE_HITCH_BYTES,
        gwei,
        hitchCostMult,
        projectedProceedsEth: leftoverEth + (Number(sizeOpts.entryEth) || 0),
        entryEth: sizeOpts.entryEth,
        feePct: sizeOpts.feePct,
        gasCostEth: sizeOpts.gasCostEth,
        impactPct: sizeOpts.impactPct,
      }),
    };
  }

  const count = Math.min(payloadBits, bits.length - cursor.nextBit);
  const encoded = encodeBitSlice(bits, cursor.nextBit, count);
  const prevHash =
    registry?.lastHash ||
    registry?.nodes?.[registry.nodes.length - 1]?.hash ||
    "00000000";
  const seq = registry?.nodes?.length || 0;
  const kind = cursor.nextBit === 0 && count === 1 ? "BIT" : "CHUNK";
  const meta = {
    role: kind === "BIT" ? "genesis-or-wave-bit" : "wave-chunk",
    strandId: strandId || registry?.strandId,
    contentHash: contentHash || registry?.contentHash,
    bitOffset: encoded.bitOffset,
    bitCount: encoded.bitCount,
    encoding: encoded.encoding,
    read: encoded.read,
    wavePaid: true,
    confirmed: false,
    injectCostEth: sized.injectCostEth,
    errorBufferEth: sized.errorBufferEth,
  };
  const packet = encodeHatPacket({
    kind,
    seq,
    prevHash,
    encoded,
    meta,
  });
  const hash = hatHash(packet);
  const sellTarget = waveSellTargetWithTransmission({
    hitchBytes: sized.hitchBytes || packet.length,
    gwei,
    hitchCostMult,
    projectedProceedsEth: sizeOpts.projectedProceedsEth,
    entryEth: sizeOpts.entryEth,
    sellPct: sizeOpts.sellPct,
    feePct: sizeOpts.feePct,
    gasCostEth: sizeOpts.gasCostEth,
    impactPct: sizeOpts.impactPct,
    providerFeeEth: sizeOpts.providerFeeEth,
    l1FeeEth: sizeOpts.l1FeeEth,
  });

  return {
    action: "hitch",
    reason: sized.reason,
    cursor,
    sized: { ...sized, payloadBits: count },
    packet,
    hash,
    kind,
    meta,
    nodeDraft: {
      seq,
      kind,
      prevHash,
      hash,
      packet,
      encoding: encoded.encoding,
      meta: { ...meta, hex: encoded.hex },
      txHash: null,
      nodeId: "HAT-" + String(seq).padStart(4, "0") + "-" + hash,
      confirmed: false,
    },
    sellTarget,
    // Caller's duty: hitch packet → wait receipt → confirmHatWaveSend(txHash)
    confirmRequired: true,
  };
}

/**
 * Confirmation gate: seal location only when we have a real tx hash.
 * Advances reader trust — unconfirmed drafts stay invisible to nextReadyCursor.
 */
export function confirmHatWaveSend({
  nodeIdOrSeq,
  txHash,
  seal = sealHatNodeLocation,
} = {}) {
  const hash = String(txHash || "").trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash) && !/^0x[0-9a-fA-F]{1,}$/.test(hash)) {
    // Accept any 0x hex in tests/sim; reject empty / clearly fake
    if (!hash.startsWith("0x") || hash.length < 4) {
      return {
        ok: false,
        confirmed: false,
        reason: "no on-chain txHash — do not advance cursor or claim sent",
      };
    }
  }
  const sealed = seal(nodeIdOrSeq, hash);
  if (!sealed?.ok) {
    return {
      ok: false,
      confirmed: false,
      reason: sealed?.reason || "seal failed",
    };
  }
  if (sealed.node) {
    sealed.node.meta = { ...sealed.node.meta, confirmed: true };
    sealed.node.confirmed = true;
  }
  return {
    ok: true,
    confirmed: true,
    location: hash,
    basescan: "https://basescan.org/tx/" + hash,
    node: sealed.node,
    reader: {
      location: hash,
      howToRead:
        "eth_getTransactionByHash → input UTF-8 → parseHatPacket → decodeBitSlice",
    },
  };
}

/**
 * Exit the wave UP after confirmed send — no crash required.
 * Conditions:
 *   1. messageConfirmed + locationSealed (code actually on-chain)
 *   2. leftover still covers fees (green exit — never lose to leave)
 *   3. price ≥ entry (on the way up / at least flat-green)
 * Does NOT require peak turn or fast crash.
 */
export function evaluateConfirmedSendExit({
  messageConfirmed = false,
  locationSealed = false,
  location = null,
  price = 0,
  entry = 0,
  leftoverEth = 0,
  feesEth = 0,
  netUsd = null,
  breakEvenBuffer = 0,
} = {}) {
  if (!messageConfirmed || !locationSealed) {
    return {
      sell: false,
      kind: "hold_unconfirmed",
      reason:
        "HAT message not confirmed on-chain yet — keep riding; do not claim sent",
    };
  }
  const left = Number(leftoverEth);
  const fees = Math.max(0, Number(feesEth) || 0);
  if (!(left > 0) || left + 1e-18 < fees) {
    return {
      sell: false,
      kind: "hold_thin_leftover",
      reason: "confirmed send but leftover cannot cover fees — hold (lose-zero)",
      location,
    };
  }
  const px = Number(price);
  const en = Number(entry);
  if (en > 0 && px > 0 && px + 1e-12 < en) {
    return {
      sell: false,
      kind: "hold_underwater",
      reason: "confirmed send but price under entry — hold for green exit",
      location,
    };
  }
  if (netUsd != null && Number.isFinite(Number(netUsd))) {
    const buf = Number(breakEvenBuffer) || 0;
    if (Number(netUsd) + 1e-12 < buf) {
      return {
        sell: false,
        kind: "hold_breakeven",
        reason: "confirmed send but net under break-even buffer — hold",
        location,
      };
    }
  }
  return {
    sell: true,
    kind: "confirmed_send_exit",
    reason:
      "HAT code confirmed on-chain + location sealed — exit up without waiting for crash",
    location,
    basescan: location ? "https://basescan.org/tx/" + location : null,
  };
}

/**
 * Math snapshot: bits paid by this wave's leftover+earnings (for board / telegram).
 */
export function waveBitsAffordable(args = {}) {
  const sized = sizeHatBytesForWave(args);
  return {
    bits: sized.payloadBits,
    bytes: sized.payloadBytes,
    hitchBytes: sized.hitchBytes,
    injectCostEth: sized.injectCostEth,
    errorBufferEth: sized.errorBufferEth,
    spendableEth: sized.spendableEth,
    skipHitch: sized.skipHitch,
    costPerBitEth:
      sized.payloadBits > 0 ? sized.injectCostEth / sized.payloadBits : null,
  };
}

/** Calldata gas helper re-export for board math without importing lose-zero L1. */
export function hatCalldataCostEth(bytes, gwei) {
  return estimateCalldataHitchEth(bytes, gwei);
}

export function hatGasPerNonzeroByte() {
  return CALLDATA_GAS_PER_NONZERO_BYTE;
}

export { HAT_MAGIC, STORE_HITCH_BYTES, DEFAULT_HITCH_COST_MULT, maxHitchBytesForLeftover };
