/**
 * Cheaper leftover hitch: dense KEY+LOC vs Eureka prose.
 *
 * Live leftover hitch is already VITA KEY+LOC (`VITA_HITCH_MODE=vita`).
 * Eureka 229 B leftover (GAME fail hitch) is the expensive class — keep it
 * on /prove, not on thin leftover. This module sizes the two encodings
 * under LOSE-ZERO for a ~$3 liquid bag and records L2 byte lessons
 * (Arbitrum compression, OP-stack L1 data fee, Solana memo) without
 * leaving Base V3 for live inject. V4 stays deferred.
 *
 * Never invents P&L. Hitch only when leftover covers.
 */

import {
  STORE_HITCH_BYTES,
  DEFAULT_HITCH_COST_MULT,
  estimateInjectCostEth,
  maxHitchBytesForLeftover,
} from "./lose-zero-gate.js";
import {
  STORE_VOICE_TAG,
  VITA_PROOF_FULL,
  utf8ByteLength,
  encodingDoesNotLoseMoney,
  buildStoreVoice,
} from "./swap-minout.js";
import {
  VITA_KEY_NAMES,
  packVitaFields,
  projectLeftoverHitchFields,
} from "./vita-parse.js";
import { LIVE_ASSUMPTIONS } from "./revenue-sim.js";

/** Observed leftover Eureka trailer (GAME fail hitch / leftover-scan min). */
export const EUREKA_LEFTOVER_BYTES = 229;

/** Names-only leftover KEY+LOC class the operator asked to prefer (~69 B). */
export const KEY_LOC_HITCH_BYTES_CLASS = 69;

export function packKeyLocHitchUtf8(loc = "n=24|t=0000|r=0000") {
  const body = packVitaFields(
    projectLeftoverHitchFields({ KEY: VITA_KEY_NAMES, LOC: loc }),
    { dense: true },
  );
  return STORE_VOICE_TAG + " " + body;
}

export function measureKeyLocHitchBytes(loc = "n=24|t=0000|r=0000") {
  return utf8ByteLength(packKeyLocHitchUtf8(loc));
}

export function measureEurekaLeftoverBytes() {
  return utf8ByteLength(buildStoreVoice({
    tag: STORE_VOICE_TAG,
    message: "Eureka! VITA lives ♥ love you Krystian, Kai & Koda!",
  }));
}

export function measureEurekaProveBytes() {
  return utf8ByteLength(buildStoreVoice({
    tag: STORE_VOICE_TAG,
    message: VITA_PROOF_FULL,
  }));
}

/**
 * Prefer dense KEY+LOC when leftover is thin. Never pick leftover Eureka
 * when KEY+LOC fits. If leftover cannot cover KEY+LOC, skip hitch (plain).
 * /prove keeps the Eureka love note — not leftover swaps.
 */
export function preferDenseHitch({
  leftoverEth = 0,
  gwei = LIVE_ASSUMPTIONS.gwei,
  l1FeePerByteEth = 0,
  hitchCostMult: mult = DEFAULT_HITCH_COST_MULT,
  keyLocBytes = measureKeyLocHitchBytes(),
  eurekaBytes = EUREKA_LEFTOVER_BYTES,
} = {}) {
  const leftover = Number(leftoverEth);
  const m = Number.isFinite(Number(mult)) && Number(mult) > 0 ? Number(mult) : DEFAULT_HITCH_COST_MULT;
  const budget = leftover / m;
  const locCost = estimateInjectCostEth(gwei, l1FeePerByteEth * keyLocBytes, keyLocBytes);
  const eurekaCost = estimateInjectCostEth(gwei, l1FeePerByteEth * eurekaBytes, eurekaBytes);
  const locOk = encodingDoesNotLoseMoney({ leftoverEth: budget, hitchCostEth: locCost });
  const eurekaOk = encodingDoesNotLoseMoney({ leftoverEth: budget, hitchCostEth: eurekaCost });

  if (!(leftover > 0)) {
    return {
      encoding: "plain",
      hitchBytes: 0,
      skipHitch: true,
      locOk: false,
      eurekaOk: false,
      locCostEth: locCost,
      eurekaCostEth: eurekaCost,
      reason: "leftover after fees ≤ 0 — always-plus hold, no hitch",
    };
  }
  if (locOk) {
    return {
      encoding: "key-loc",
      hitchBytes: keyLocBytes,
      skipHitch: false,
      locOk: true,
      eurekaOk,
      locCostEth: locCost,
      eurekaCostEth: eurekaCost,
      reason: eurekaOk
        ? "leftover covers both — prefer dense KEY+LOC over Eureka leftover"
        : "leftover covers KEY+LOC but not Eureka 229 B — hitch KEY+LOC",
    };
  }
  return {
    encoding: "plain",
    hitchBytes: 0,
    skipHitch: true,
    locOk: false,
    eurekaOk: false,
    locCostEth: locCost,
    eurekaCostEth: eurekaCost,
    reason: "leftover too thin for KEY+LOC — plain swap (Eureka leftover also skipped)",
  };
}

/**
 * Original formula (message-first): when KEY+LOC is covered, always hitch.
 * Do not mute for micro extract — Storage Token can charge the delta later.
 * Eureka prose stays on /prove.
 */
export function preferOriginalFormulaHitch(opts = {}) {
  const dense = preferDenseHitch(opts);
  if (dense.locOk) {
    return {
      ...dense,
      skipHitch: false,
      messageFirst: true,
      storageTokenChargeable: true,
      formula: "original-message-first",
      reason: dense.reason
        + " — original formula: send message; charge hitch delta via Storage Token",
    };
  }
  return {
    ...dense,
    messageFirst: true,
    storageTokenChargeable: false,
    formula: "original-message-first",
  };
}

/**
 * Max leftover-covered hitch rate under LOSE-ZERO for a ~$3 liquid bag.
 * Labeled assumptions — not live P&L. One hitch per swap; rate is how many
 * green leftover exits could cover the encoding.
 */
export function maxInjectRateUnderLoseZero({
  bagUsd = 3,
  leftoverPct = 0.02,
  leftoverEth: leftoverEthArg,
  ethUsd = LIVE_ASSUMPTIONS.ethUsd,
  gwei = LIVE_ASSUMPTIONS.gwei,
  l1FeePerByteEth = 0,
  hitchCostMult: mult = DEFAULT_HITCH_COST_MULT,
  keyLocBytes = measureKeyLocHitchBytes(),
  eurekaBytes = EUREKA_LEFTOVER_BYTES,
} = {}) {
  const bag = Math.max(0, Number(bagUsd) || 0);
  const eth = Number(ethUsd) > 0 ? Number(ethUsd) : LIVE_ASSUMPTIONS.ethUsd;
  const leftoverUsdFromBag = bag * Math.max(0, Number(leftoverPct) || 0);
  const leftoverEth = leftoverEthArg != null && Number.isFinite(Number(leftoverEthArg))
    ? Number(leftoverEthArg)
    : leftoverUsdFromBag / eth;
  const leftoverUsd = leftoverEth * eth;
  const budgetEth = leftoverEth / (Number(mult) > 0 ? Number(mult) : DEFAULT_HITCH_COST_MULT);
  const maxBytes = maxHitchBytesForLeftover(budgetEth, gwei, 0, l1FeePerByteEth);
  const pick = preferDenseHitch({
    leftoverEth,
    gwei,
    l1FeePerByteEth,
    hitchCostMult: mult,
    keyLocBytes,
    eurekaBytes,
  });
  const locCost = pick.locCostEth;
  const eurekaCost = pick.eurekaCostEth;
  const locCostUsd = locCost * eth;
  const eurekaCostUsd = eurekaCost * eth;
  const locFits = maxBytes >= keyLocBytes && pick.locOk;
  const eurekaFits = maxBytes >= eurekaBytes && pick.eurekaOk;
  const density = eurekaBytes > 0 ? keyLocBytes / eurekaBytes : 1;
  const bytesPerUsdLoc = locCostUsd > 0 ? keyLocBytes / locCostUsd : null;
  const bytesPerUsdEureka = eurekaCostUsd > 0 ? eurekaBytes / eurekaCostUsd : null;

  return {
    kind: "simulated|estimated",
    label: `LOSE-ZERO hitch budget on a $${bag.toFixed(2)} bag — labeled, not live P&L`,
    bagUsd: bag,
    leftoverPct,
    leftoverUsd,
    leftoverEth,
    hitchCostMult: Number(mult) > 0 ? Number(mult) : DEFAULT_HITCH_COST_MULT,
    maxHitchBytes: Number.isFinite(maxBytes) ? maxBytes : 0,
    keyLoc: {
      bytes: keyLocBytes,
      costEth: locCost,
      costUsd: locCostUsd,
      fits: locFits,
      hitchPerGreenExit: locFits ? 1 : 0,
      bytesPerUsd: bytesPerUsdLoc,
    },
    eurekaLeftover: {
      bytes: eurekaBytes,
      costEth: eurekaCost,
      costUsd: eurekaCostUsd,
      fits: eurekaFits,
      hitchPerGreenExit: eurekaFits ? 1 : 0,
      bytesPerUsd: bytesPerUsdEureka,
    },
    prefer: pick.encoding,
    densityVsEureka: density,
    tagBytes: STORE_HITCH_BYTES,
    loseZero: leftoverEth > 0,
    note:
      "One hitch per leftover-covered swap. If leftover ≤ 0, hitch rate is 0 (always-plus hold). " +
      "KEY+LOC is denser bytes-per-$ than Eureka 229 B; live leftover hitch stays KEY+LOC. /prove keeps Eureka.",
  };
}

/**
 * Learn cheaper bytes-per-$ from other L2/calldata patterns — stay on Base V3 live.
 */
export const L2_BYTE_LESSONS = Object.freeze({
  liveChain: "base",
  liveDex: "uniswap-v3",
  liveInjector: "SwapRouter02 exactInputSingle + UTF-8 trailer",
  v4Deferred: true,
  lessons: Object.freeze([
    {
      chain: "base / OP-Stack",
      pattern: "GasPriceOracle.getL1Fee / getL1FeeUpperBound on incremental hitch bytes",
      takeaway:
        "Hitch cost is L2 calldata gas (16/nonzero) plus L1 data fee. Fewer hitch bytes → cheaper insert. Already wired in l1-fee-oracle.js.",
    },
    {
      chain: "Arbitrum",
      pattern: "Brotli-compressed L1 batches",
      takeaway:
        "Dense KEY+LOC compresses better than Eureka prose (repeated §TOKEN§ vs long UTF-8). Research only — do not send Arbitrum live.",
    },
    {
      chain: "Solana",
      pattern: "memo program vs Base hitch trailer",
      takeaway:
        "Memo is cheap DA on a different chain. Guardian live hitch stays Base Uni V3 calldata. Do not split the injector.",
    },
  ]),
});
