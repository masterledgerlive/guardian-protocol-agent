/**
 * Thin outer wrap for main-loop / vita-queue self-calls.
 *
 * Does NOT replace vitaSave / inscribeChunk (mother brain stays).
 * Operators who need the root inscription path still call those directly.
 *
 * Live bug: the trade-loop vita-queue processor sent unpaired wallet→self
 * txs (sel 0x5b564954 = UTF-8 `[VIT`) with STORE, 0 Uniswap fills.
 *
 * This adapter only answers: hitch (covered leftover / paired data tx)
 * or bank hex (wait for a free ride). It never broadcasts.
 */

export const VITA_SELF_CALL_SELECTOR = "0x5b564954";
export const VITA_SELF_CALL_HEADER = "[VITA:";

let _bank = [];

export function resetFeedWrapBank() {
  _bank = [];
  return _bank.length;
}

export function peekFeedWrapBank() {
  return _bank.map((row) => ({ ...row }));
}

export function utf8ToHex(text) {
  return "0x" + Buffer.from(String(text || ""), "utf8").toString("hex");
}

export function selectorFromHex(data) {
  const hex = String(data || "").toLowerCase();
  return hex.startsWith("0x") && hex.length >= 10 ? hex.slice(0, 10) : "";
}

export function isUnpaidQueueSelfCall({ data, text, to, from } = {}) {
  const raw = String(text || "");
  if (raw.startsWith(VITA_SELF_CALL_HEADER) || raw.startsWith("[IKN:")) return true;
  const sel = selectorFromHex(data);
  if (sel === VITA_SELF_CALL_SELECTOR) return true;
  const a = String(to || "").toLowerCase();
  const b = String(from || "").toLowerCase();
  return !!(a && b && a === b && sel && raw.includes("STORE"));
}

function leftoverCovers(input = {}) {
  if (input.keyLocCovered === true) return true;
  const leftover = Number(input.leftoverEth);
  const hitch = Number(input.hitchCostEth);
  return leftover > 0 && hitch > 0 && leftover + 1e-18 >= hitch;
}

function isPairedRide(input = {}) {
  return input.pairedUniswapSell === true
    || input.sameTxTradeLeftover === true
    || input.pairedDataTx === true;
}

/**
 * Wrap a queue/main-loop self-call.
 * @returns {{ send: false, hitch: boolean, banked: boolean, hex: string, txHash: null, reason: string }}
 */
export function wrapQueueSelfCall(input = {}) {
  const text = String(input.text || "");
  const hex = input.data && /^0x[0-9a-fA-F]+$/.test(String(input.data))
    ? String(input.data)
    : utf8ToHex(text);
  const covered = leftoverCovers(input) && isPairedRide(input);

  if (covered) {
    return {
      send: false,
      hitch: true,
      banked: false,
      hex,
      txHash: null,
      reason: "hitch hex on covered leftover / paired data tx — do not solo-send",
    };
  }

  const row = {
    at: new Date().toISOString(),
    text: text.slice(0, 4000),
    hex,
    topic: input.topic || "vita-queue",
    banked: true,
    txHash: null,
    neverForget: true,
  };
  _bank.push(row);
  return {
    send: false,
    hitch: false,
    banked: true,
    hex,
    txHash: null,
    queued: _bank.length,
    unpaired: isUnpaidQueueSelfCall({ ...input, data: hex, text }),
    reason: "unpaid queue self-call — bank hex; wait for free ride (never drop the brain)",
  };
}
