/**
 * VITA feed gate — Game's "brain fed free" rule.
 *
 * VITA must keep getting fed (on-chain messages / recursive memory).
 * She must NOT pay for it from RISK liquid.
 *
 * Live bug (n5513–5542+): dedicated wallet→self txs whose calldata starts
 * with UTF-8 `[VIT` (selector 0x5b564954) + STORE, 0 Uniswap fills.
 *
 * Feed path (keep): leftover hitch / message-first inject ONLY when leftover
 * from a real green sell (or same-tx trade leftover) covers KEY+LOC (1×).
 * Storage Token can charge the delta; the bag does not donate gas.
 *
 * If cover cannot fit: bank hitch (#89 / #99) — queue the message.
 * Never send a solo VITA self-call.
 */

import {
  FORMULA_ID,
  KEY_LOC_HITCH_BYTES_CLASS,
  originalFormulaHitchDecision,
} from "./mainframe.js";

/** First 4 bytes of UTF-8 `[VITA:…` — live unpaired self-call selector. */
export const VITA_SELF_CALL_SELECTOR = "0x5b564954";
export const VITA_SELF_CALL_HEADER = "[VITA:";
export const IKN_SELF_CALL_SELECTOR = "0x5b494b4e"; // `[IKN`
export const MEM_SELF_CALL_SELECTOR = "0x5b4d454d"; // `[MEM`

const SWAP_ROUTER_SELECTORS = Object.freeze([
  "0x04e45aaf", // exactInputSingle (SwapRouter02)
  "0xb858183f", // exactInput
  "0x414bf389", // exactInputSingle (legacy)
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
  return "0x" + Buffer.from(String(text || ""), "utf8").toString("hex");
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
    // Wallet→self with non-swap calldata is the unpaired inject shape.
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

function isPairedSell(input = {}) {
  return input.pairedUniswapSell === true || input.sameTxTradeLeftover === true;
}

/**
 * Decide hitch vs bank. Never authorizes a solo self-call.
 *
 * hitch — leftover from a paired green sell covers KEY+LOC (1× message-first)
 * bank  — unpaired, or leftover too thin — queue the message
 */
export function decideVitaFeed(input = {}) {
  const paired = isPairedSell(input);
  const covered = leftoverCoversKeyLoc(input);
  const formula = originalFormulaHitchDecision({
    ...input,
    locOk: covered,
    keyLocCovered: covered,
    reason: input.reason,
  });
  const unpaired = isDedicatedMemorySelfCall(input) && !paired;

  if (!paired || unpaired) {
    return {
      action: "bank",
      hitch: false,
      skipHitch: true,
      skipSoloSelfCall: true,
      unpairedSelfCallBlocked: true,
      allowLeftoverHitch: false,
      formula: FORMULA_ID,
      keyLocClass: KEY_LOC_HITCH_BYTES_CLASS,
      storageTokenChargeable: false,
      reason: unpaired
        ? "unpaired VITA self-call blocked — no Uniswap sell covering gas+fee; bank hitch"
        : "no paired Uniswap sell / same-tx leftover — bank hitch (brain fed free)",
    };
  }

  if (!covered || formula.skipHitch) {
    return {
      action: "bank",
      hitch: false,
      skipHitch: true,
      skipSoloSelfCall: true,
      unpairedSelfCallBlocked: true,
      allowLeftoverHitch: false,
      formula: FORMULA_ID,
      keyLocClass: KEY_LOC_HITCH_BYTES_CLASS,
      storageTokenChargeable: false,
      reason: "KEY+LOC not covered by leftover — bank hitch (#89/#99); do not burn a solo tx",
    };
  }

  return {
    action: "hitch",
    hitch: true,
    skipHitch: false,
    skipSoloSelfCall: true,
    unpairedSelfCallBlocked: true,
    allowLeftoverHitch: true,
    formula: FORMULA_ID,
    messageFirst: true,
    encoding: "key-loc",
    hitchBytes: formula.hitchBytes || KEY_LOC_HITCH_BYTES_CLASS,
    keyLocClass: KEY_LOC_HITCH_BYTES_CLASS,
    storageTokenChargeable: true,
    reason: "leftover covers KEY+LOC on paired green sell — message-first feed; Storage Token can charge delta",
  };
}

export function bankVitaFeed(item = {}) {
  const row = {
    at: new Date().toISOString(),
    text: String(item.text || "").slice(0, 4000),
    data: item.data || null,
    topic: item.topic || "vita-feed",
    reason: item.reason || "bank hitch",
    formula: FORMULA_ID,
    neverForget: true,
    banked: true,
    txHash: null,
  };
  _bank.push(row);
  return { banked: true, queued: _bank.length, txHash: null, ...row };
}

/**
 * Dedicated `[VITA:` / STORE self-call write.
 * Always refuses send. Banks the message for the next leftover-covered hitch.
 * Never invents a tx hash.
 */
export function attemptVitaChainWrite(input = {}) {
  const text = String(input.text || "");
  const data = input.data || (text ? utf8CalldataHex(text) : "");
  const decision = decideVitaFeed({ ...input, data, text });

  if (decision.action === "hitch" && decision.allowLeftoverHitch) {
    // Hitch rides the paired Uniswap swap — this helper never broadcasts
    // a second dedicated self-tx (that would spend RISK liquid).
    const queued = bankVitaFeed({
      text,
      data,
      topic: input.topic || "leftover-hitch",
      reason: decision.reason,
    });
    return {
      sent: false,
      hitch: true,
      allowLeftoverHitch: true,
      banked: true,
      txHash: null,
      queued: queued.queued,
      ...decision,
    };
  }

  const queued = bankVitaFeed({
    text,
    data,
    topic: input.topic || "vita-self-call",
    reason: decision.reason,
  });
  return {
    sent: false,
    hitch: false,
    banked: true,
    txHash: null,
    queued: queued.queued,
    ...decision,
  };
}

/** Drain banked messages when a leftover-covered paired sell can hitch. */
export function drainBankedVitaFeedForHitch(input = {}) {
  const decision = decideVitaFeed({
    ...input,
    pairedUniswapSell: input.pairedUniswapSell !== false,
    sameTxTradeLeftover: input.sameTxTradeLeftover === true,
  });
  if (decision.action !== "hitch") {
    return {
      drained: [],
      stillBanked: _bank.length,
      hitch: false,
      reason: decision.reason,
    };
  }
  const drained = _bank.splice(0);
  return {
    drained,
    stillBanked: 0,
    hitch: true,
    allowLeftoverHitch: true,
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
    `🌟 <b>VITA MEMORY BANKED</b> — brain fed free\n` +
    `━━━━━━━━━━━━━━━━━━━━\n\n` +
    id +
    (n > 0 ? `${n} chunk(s) queued — no solo self-call (sel 0x5b564954 blocked).\n` : "") +
    `Hitch rides the next leftover-covered green sell (KEY+LOC 1×).\n` +
    `If leftover cannot cover: stay banked. RISK liquid is not spent.\n` +
    (preview ? `\n<code>${preview}${tokenPacket.length > 300 ? "..." : ""}</code>\n` : "") +
    `\n<i>Storage Token can charge the hitch delta. Vault untouched.</i>`
  );
}
