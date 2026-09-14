/**
 * Thin outer wrap for main-loop / vita-queue / auto-learn / mother-genesis
 * self-calls.
 *
 * Does NOT replace vitaSave / inscribeChunk (mother brain stays).
 * Operators who need the root inscription path still call /vitasave
 * (and /prove) directly.
 *
 * Live bug after #101/#102: remaining AUTO callers were wrapped, but RISK
 * still paid gas-only self-calls n5551–5556 — MGPLAIN + VITA-KNOW 01/05–05/05
 * “this is a test”, hitch 0/6, 0 Uniswap fills. That was /vitamothergenesis
 * (#103) solo-sending 0-ETH batches.
 *
 * This adapter only answers: hitch (covered leftover / paired data tx)
 * or bank hex (wait for a free ride). It never broadcasts.
 *
 * Env kill-switch: VITA_AUTO_INSCRIBE (alias VITA_AUTO_QUEUE_LEARN)
 * defaults OFF → auto queue/learn/trade-loop/integrity callers bank.
 * Sibling: VITA_MOTHER_GENESIS_AUTO defaults OFF → MGPLAIN/MGENC bank.
 * Intentional paid genesis also needs operator CONFIRM. /vitasave is not gated.
 */

export const VITA_SELF_CALL_SELECTOR = "0x5b564954";
export const VITA_SELF_CALL_HEADER = "[VITA:";
export const MGPLAIN_SELF_CALL_SELECTOR = "0x5b4d4750"; // UTF-8 `[MGP`
export const MGENC_SELF_CALL_SELECTOR = "0x5b4d4745"; // UTF-8 `[MGE`
export const MGPLAIN_SELF_CALL_HEADER = "[MGPLAIN:";
export const MGENC_SELF_CALL_HEADER = "[MGENC:";
export const VITA_AUTO_INSCRIBE_ENV = "VITA_AUTO_INSCRIBE";
export const VITA_AUTO_QUEUE_LEARN_ENV = "VITA_AUTO_QUEUE_LEARN";
export const VITA_MOTHER_GENESIS_AUTO_ENV = "VITA_MOTHER_GENESIS_AUTO";
export const MOTHER_GENESIS_CONFIRM_TOKEN = "CONFIRM";

let _bank = [];

function envFlagOn(raw) {
  const v = String(raw ?? "").trim().toLowerCase();
  return v === "yes" || v === "on" || v === "1" || v === "true";
}

function envFlagOff(raw) {
  const v = String(raw ?? "").trim().toLowerCase();
  return v === "no" || v === "off" || v === "0" || v === "false";
}

/**
 * AUTO queue / learn / trade-loop / integrity paid-inscribe kill-switch.
 * Default OFF (unset / no / false) → bank hex, never solo-send.
 * Operators still call /vitasave (mother brain) regardless of this flag.
 */
export function autoPaidInscribeEnabled(env = process.env) {
  const raw = String(
    env?.[VITA_AUTO_INSCRIBE_ENV] ?? env?.[VITA_AUTO_QUEUE_LEARN_ENV] ?? "",
  );
  return envFlagOn(raw);
}

/**
 * Sibling kill-switch for /vitamothergenesis MGPLAIN + encoded batches.
 * Default OFF. Explicit VITA_MOTHER_GENESIS_AUTO=no wins over VITA_AUTO_INSCRIBE.
 * VITA_AUTO_INSCRIBE=yes can lift this gate (same family) unless genesis is no.
 */
export function motherGenesisPaidInscribeEnabled(env = process.env) {
  const genesisRaw = env?.[VITA_MOTHER_GENESIS_AUTO_ENV];
  if (envFlagOff(genesisRaw)) return false;
  if (envFlagOn(genesisRaw)) return true;
  return autoPaidInscribeEnabled(env);
}

/** Never pay gas for trivial test dumps that drained RISK (n5551–5556 class). */
export function isTrivialTestInscriptionBody(body) {
  const t = String(body || "").trim().toLowerCase().replace(/\s+/g, " ");
  return t === "this is a test" || t === "this is a test." || t === "test";
}

/**
 * Operator-explicit genesis: leading CONFIRM / CONFIRM_GENESIS / --confirm.
 * `/vitamothergenesis this is a test` is NOT confirmed.
 */
export function parseMotherGenesisOperatorIntent(raw = "") {
  const s = String(raw || "").trim();
  const m = s.match(/^(CONFIRM(?:_GENESIS)?|--confirm)(?:\s+|$)([\s\S]*)$/i);
  if (!m) return { confirmed: false, body: s, token: null };
  return { confirmed: true, body: String(m[2] || "").trim(), token: m[1] };
}

/**
 * Paid MGPLAIN/MGENC self-txs only when env is on AND operator CONFIRMed
 * AND the body is not a trivial “this is a test” dump.
 */
export function maySendMotherGenesis({ env = process.env, confirmed = false, body = "" } = {}) {
  if (isTrivialTestInscriptionBody(body)) return false;
  if (confirmed !== true) return false;
  return motherGenesisPaidInscribeEnabled(env);
}

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

function utf8FromData(data) {
  const hex = String(data || "").replace(/^0x/i, "");
  if (!hex || hex.length % 2) return "";
  try {
    return Buffer.from(hex, "hex").toString("utf8");
  } catch {
    return "";
  }
}

export function isUnpaidQueueSelfCall({ data, text, to, from } = {}) {
  const raw = String(text || "") || utf8FromData(data);
  if (raw.startsWith(VITA_SELF_CALL_HEADER) || raw.startsWith("[IKN:")) return true;
  if (raw.startsWith(MGPLAIN_SELF_CALL_HEADER) || raw.startsWith(MGENC_SELF_CALL_HEADER)) return true;
  const sel = selectorFromHex(data);
  if (sel === VITA_SELF_CALL_SELECTOR) return true;
  if (sel === MGPLAIN_SELF_CALL_SELECTOR || sel === MGENC_SELF_CALL_SELECTOR) return true;
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

/**
 * Same wrap as the queue, for remaining AUTO callers (learn / vitadata /
 * savesession / btpInscribe). Never broadcasts. Hitch hex only when leftover
 * covers KEY+LOC on a paired sell; otherwise bank.
 */
export function wrapAutoSelfCall(input = {}) {
  return wrapQueueSelfCall({ ...input, topic: input.topic || "auto" });
}

/**
 * Same hitch/bank adapter for /vitamothergenesis MGPLAIN + encoded batches.
 * Never broadcasts. Never invents tx hashes.
 */
export function wrapMotherGenesisSelfCall(input = {}) {
  const text = String(input.text || "") || utf8FromData(input.data);
  const topic = input.topic
    || (text.startsWith(MGENC_SELF_CALL_HEADER) ? "mgenc" : "mgplain");
  return wrapAutoSelfCall({ ...input, text, topic });
}
