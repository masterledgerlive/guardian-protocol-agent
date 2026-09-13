/**
 * VITA hex feed gate — inject-thought stays; unpaid solo drain does not.
 *
 * Goal: agentic recursive AI that is never forgotten — learn forever.
 * On-chain = Section 2 hex calldata only. Section 1 JSON stays off-chain.
 *
 * Live bug (n5513–5542+): unpaired `[VITA:` / sel 0x5b564954 STORE self-calls
 * burned RISK liquid with 0 Uniswap fills. Wrong = paying from the bag.
 * Right = hex-only calldata, prefer value=0 or hitch on covered leftover /
 * any paired data tx; if gas cannot be covered, bank the hex and wait.
 *
 * Never drop the brain.
 */

import {
  FORMULA_ID,
  KEY_LOC_HITCH_BYTES_CLASS,
  originalFormulaHitchDecision,
} from "./mainframe.js";
import {
  decodeSection2Hex,
  encodeSection2Hex,
  isSection1JsonPayload,
} from "./hex-feed.js";

export {
  SECTION1_SCHEMA,
  SECTION2_EXAMPLE_HEX,
  SECTION2_EXAMPLE_UTF8,
  buildSection1Schema,
  decodeSection2Hex,
  encodeSection2Hex,
  isSection1JsonPayload,
  pointToTxHash,
} from "./hex-feed.js";

/** First 4 bytes of UTF-8 `[VITA:…` — live unpaid self-call selector. */
export const VITA_SELF_CALL_SELECTOR = "0x5b564954";
export const VITA_SELF_CALL_HEADER = "[VITA:";
export const IKN_SELF_CALL_SELECTOR = "0x5b494b4e"; // `[IKN`
export const MEM_SELF_CALL_SELECTOR = "0x5b4d454d"; // `[MEM`

const SWAP_ROUTER_SELECTORS = Object.freeze([
  "0x04e45aaf",
  "0xb858183f",
  "0x414bf389",
]);

let _bank = [];

export function resetVitaFeedBank() {
  _bank = [];
  return _bank.length;
}

export function peekBankedVitaFeed() {
  return _bank.map((row) => ({ ...row }));
}

export function utf8CalldataHex(text) {
  return encodeSection2Hex(String(text || ""));
}

export function selectorFromHex(data) {
  const hex = String(data || "").toLowerCase();
  if (!hex.startsWith("0x") || hex.length < 10) return "";
  return hex.slice(0, 10);
}

export function selectorFromUtf8(text) {
  return selectorFromHex(utf8CalldataHex(text));
}

export function isVitaSelfCallPayload({ data, text } = {}) {
  const raw = String(text || "");
  if (raw.startsWith(VITA_SELF_CALL_HEADER)) return true;
  const sel = selectorFromHex(data) || selectorFromUtf8(raw);
  return sel === VITA_SELF_CALL_SELECTOR;
}

export function isDedicatedMemorySelfCall({ data, text, to, from } = {}) {
  if (isVitaSelfCallPayload({ data, text })) return true;
  const raw = String(text || "");
  if (raw.startsWith("[IKN:") || raw.startsWith("[MEM:")) return true;
  const sel = selectorFromHex(data) || selectorFromUtf8(raw);
  if (
    sel === VITA_SELF_CALL_SELECTOR
    || sel === IKN_SELF_CALL_SELECTOR
    || sel === MEM_SELF_CALL_SELECTOR
  ) {
    return true;
  }
  const a = String(to || "").toLowerCase();
  const b = String(from || "").toLowerCase();
  if (a && b && a === b && sel && !SWAP_ROUTER_SELECTORS.includes(sel)) {
    return raw.includes("§$STORE§") || raw.includes("STORE") || sel === VITA_SELF_CALL_SELECTOR;
  }
  return false;
}

function leftoverCoversKeyLoc(input = {}) {
  if (input.locOk === true || input.keyLocCovered === true) return true;
  const leftover = Number(input.leftoverEth);
  const hitch = Number(input.hitchCostEth);
  if (!(leftover > 0) || !(hitch > 0)) return false;
  return leftover + 1e-18 >= hitch;
}

function isPairedRide(input = {}) {
  return input.pairedUniswapSell === true
    || input.sameTxTradeLeftover === true
    || input.pairedDataTx === true;
}

function isFreeRide(input = {}) {
  return input.freeRide === true || input.gasCovered === true || isPairedRide(input);
}

function isPaidValue(input = {}) {
  const v = input.value;
  if (v == null || v === 0n || v === 0 || v === "0") return false;
  if (typeof v === "bigint") return v > 0n;
  const n = Number(v);
  return Number.isFinite(n) && n > 0;
}

function resolveHex(input = {}) {
  if (input.hex && /^0x[0-9a-fA-F]+$/.test(String(input.hex))) {
    return String(input.hex);
  }
  const text = String(input.text || "");
  if (input.data && /^0x[0-9a-fA-F]+$/.test(String(input.data))) {
    return String(input.data);
  }
  if (!text) return "";
  if (isSection1JsonPayload(text)) return "";
  return encodeSection2Hex(text);
}

/**
 * Decide hitch / zero-value hex / bank.
 * Inject-thought stays. Unpaid native drain does not.
 *
 * hitch       — leftover from a paired green sell / data tx covers KEY+LOC
 * zero-value  — value=0 hex self-tx when gas is covered (free ride)
 * bank        — gas not covered — keep the hex, wait for the next ride
 */
export function decideVitaFeed(input = {}) {
  const paired = isPairedRide(input);
  const leftoverFits = leftoverCoversKeyLoc(input);
  const explicitRide = input.freeRide === true || input.gasCovered === true;
  const covered = leftoverFits && (paired || explicitRide);
  const freeRide = isFreeRide(input);
  const paid = isPaidValue(input);
  const hex = resolveHex(input);
  const formula = originalFormulaHitchDecision({
    ...input,
    locOk: covered,
    keyLocCovered: covered,
    reason: input.reason,
  });
  const unpaidSolo = isDedicatedMemorySelfCall(input) && !explicitRide && !paired;

  if (paid && !covered && !freeRide) {
    return pack("bank", {
      hitch: false,
      skipHitch: true,
      allowZeroValueHex: false,
      allowLeftoverHitch: false,
      unpaidSoloDrainBlocked: true,
      unpairedSelfCallBlocked: true,
      skipSoloSelfCall: true,
      hex,
      reason: "unpaid native drain blocked — bank hex; wait for free ride",
    });
  }

  if (unpaidSolo) {
    return pack("bank", {
      hitch: false,
      skipHitch: true,
      allowZeroValueHex: false,
      allowLeftoverHitch: false,
      unpaidSoloDrainBlocked: true,
      unpairedSelfCallBlocked: true,
      skipSoloSelfCall: true,
      hex,
      reason: "unpaid VITA self-call — no free ride / covered leftover; bank hex (never drop the brain)",
    });
  }

  if (paired && covered && !formula.skipHitch) {
    return pack("hitch", {
      hitch: true,
      skipHitch: false,
      allowZeroValueHex: true,
      allowLeftoverHitch: true,
      unpaidSoloDrainBlocked: true,
      unpairedSelfCallBlocked: true,
      skipSoloSelfCall: true,
      messageFirst: true,
      encoding: "key-loc",
      hitchBytes: formula.hitchBytes || KEY_LOC_HITCH_BYTES_CLASS,
      storageTokenChargeable: true,
      hex,
      value: 0n,
      reason: "leftover covers KEY+LOC on paired sell/data tx — hitch hex (message-first)",
    });
  }

  if (!paid && hex && (explicitRide || (paired && leftoverFits))) {
    return pack("zero-value", {
      hitch: false,
      skipHitch: false,
      allowZeroValueHex: true,
      allowLeftoverHitch: false,
      unpaidSoloDrainBlocked: true,
      unpairedSelfCallBlocked: true,
      skipSoloSelfCall: true,
      messageFirst: true,
      storageTokenChargeable: true,
      hex,
      value: 0n,
      reason: "value=0 hex calldata — sending data, not money; gas covered by free ride",
    });
  }

  if (!covered || formula.skipHitch) {
    return pack("bank", {
      hitch: false,
      skipHitch: true,
      allowZeroValueHex: false,
      allowLeftoverHitch: false,
      unpaidSoloDrainBlocked: true,
      unpairedSelfCallBlocked: true,
      skipSoloSelfCall: true,
      hex,
      reason: "gas not covered — bank hex for the next free ride; do not drop the brain",
    });
  }

  return pack("bank", {
    hitch: false,
    skipHitch: true,
    allowZeroValueHex: false,
    allowLeftoverHitch: false,
    unpaidSoloDrainBlocked: true,
    unpairedSelfCallBlocked: true,
    skipSoloSelfCall: true,
    hex,
    reason: "bank hex — wait for leftover hitch or covered value=0 ride",
  });
}

function pack(action, extra) {
  return {
    action,
    formula: FORMULA_ID,
    keyLocClass: KEY_LOC_HITCH_BYTES_CLASS,
    injectThought: true,
    section2HexOnly: true,
    ...extra,
  };
}

export function bankVitaFeed(item = {}) {
  const text = String(item.text || "");
  let hex = item.hex || item.data || "";
  if (!hex && text && !isSection1JsonPayload(text)) {
    hex = encodeSection2Hex(text);
  }
  const row = {
    at: new Date().toISOString(),
    text: text.slice(0, 4000),
    hex: hex || null,
    data: hex || item.data || null,
    utf8: hex ? decodeSection2Hex(hex) : text,
    topic: item.topic || "vita-hex-feed",
    reason: item.reason || "bank hex",
    formula: FORMULA_ID,
    neverForget: true,
    banked: true,
    txHash: null,
    value: 0n,
  };
  _bank.push(row);
  return { banked: true, queued: _bank.length, txHash: null, ...row };
}

/**
 * Plan a Section 2 hex write. Never broadcasts.
 * Returns a value=0 tx shape when a free ride / leftover covers gas.
 * Otherwise banks the hex — inject-thought is preserved.
 */
export function planHexInject(input = {}) {
  const text = String(input.text || "");
  const hex = resolveHex(input) || (text && !isSection1JsonPayload(text) ? encodeSection2Hex(text) : "");
  const decision = decideVitaFeed({ ...input, hex, text, value: input.value ?? 0n });
  const tx = decision.allowZeroValueHex || decision.allowLeftoverHitch
    ? {
        to: input.to || input.from || null,
        value: 0n,
        data: hex,
      }
    : null;
  if (decision.action === "bank" || !tx) {
    const queued = bankVitaFeed({
      text,
      hex,
      topic: input.topic || "vita-hex",
      reason: decision.reason,
    });
    return {
      sent: false,
      banked: true,
      txHash: null,
      tx: null,
      queued: queued.queued,
      ...decision,
      hex,
    };
  }
  return {
    sent: false,
    banked: false,
    hitch: decision.action === "hitch",
    zeroValue: decision.action === "zero-value",
    txHash: null,
    tx,
    hex,
    ...decision,
  };
}

/**
 * Dedicated write helper. Never broadcasts an unpaid drain.
 * Banks hex when unpaid. Plans value=0 / hitch when covered.
 */
export function attemptVitaChainWrite(input = {}) {
  return planHexInject(input);
}

/** Drain banked hex when a leftover-covered paired ride can hitch. */
export function drainBankedVitaFeedForHitch(input = {}) {
  const decision = decideVitaFeed({
    ...input,
    pairedUniswapSell: input.pairedUniswapSell !== false,
    sameTxTradeLeftover: input.sameTxTradeLeftover === true,
  });
  if (decision.action !== "hitch" && decision.action !== "zero-value") {
    return {
      drained: [],
      stillBanked: _bank.length,
      hitch: false,
      hex: [],
      reason: decision.reason,
    };
  }
  const drained = _bank.splice(0);
  return {
    drained,
    stillBanked: 0,
    hitch: decision.action === "hitch",
    zeroValue: decision.action === "zero-value",
    allowLeftoverHitch: true,
    hex: drained.map((row) => row.hex).filter(Boolean),
    reason: decision.reason,
  };
}

export function formatVitaFeedBankedHtml({
  strandId = "",
  chunkCount = 0,
  tokenPacket = "",
} = {}) {
  const id = strandId ? `Strand: <b>${strandId}</b>\n` : "";
  const n = Number(chunkCount) || 0;
  const preview = String(tokenPacket || "").slice(0, 300);
  return (
    `🌟 <b>VITA HEX BANKED</b> — inject-thought lives; brain fed free\n` +
    `━━━━━━━━━━━━━━━━━━━━\n\n` +
    id +
    (n > 0 ? `${n} chunk(s) queued as Section 2 hex — unpaid solo drain blocked (sel 0x5b564954).\n` : "") +
    `Preferred ride: value=0 hex calldata, or hitch on the next leftover-covered sell / data tx.\n` +
    `If gas cannot be covered: stay banked. Never drop the brain. RISK liquid is not spent.\n` +
    (preview ? `\n<code>${preview}${tokenPacket.length > 300 ? "..." : ""}</code>\n` : "") +
    `\n<i>Section 1 JSON stays off-chain. Section 2 = hex in tx.data. Point agents at a known hash.</i>`
  );
}
