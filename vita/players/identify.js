/**
 * Refined block identity — front · middle · back, small enough to read.
 *
 * Names are static aliases. The true place is the permanent chain location.
 * Never invents tx hashes. Formula anchors only when no sealed body loc.
 */

const TX = /^0x[0-9a-fA-F]{64}$/;

export const IDENTIFY_ID = "vita-block-identify-v1";

export function isTxHash(h) {
  return TX.test(String(h || ""));
}

export function normalizeTx(h) {
  const s = String(h || "").trim();
  return isTxHash(s) ? s.toLowerCase() : null;
}

/**
 * Hash identity: 4 hex front + 4 mid + 4 back.
 * 0x931d8411…5bf8f05c…dbfb19db → 931d · 5bf8 · 19db
 */
export function identifyHash(hex) {
  const full = normalizeTx(hex);
  if (!full) return null;
  const h = full.slice(2);
  const midAt = Math.floor(h.length / 2) - 2;
  const front = h.slice(0, 4);
  const mid = h.slice(midAt, midAt + 4);
  const back = h.slice(-4);
  return {
    location: full,
    front,
    mid,
    back,
    display: front + "·" + mid + "·" + back,
    short: "0x" + front + "…" + back,
  };
}

/**
 * Block-number identity: front + mid + back digits, compact.
 * 37000042 → 37 … 00 … 42
 */
export function identifyBlockNumber(n) {
  if (n == null || n === "") return null;
  const num = Number(n);
  if (!Number.isFinite(num) || num < 0) return null;
  const s = String(Math.floor(num));
  if (s.length <= 4) {
    return { number: num, front: s, mid: s, back: s, display: s };
  }
  const frontLen = Math.min(2, s.length);
  const backLen = Math.min(2, s.length);
  const midStart = Math.max(0, Math.floor(s.length / 2) - 1);
  const front = s.slice(0, frontLen);
  const mid = s.slice(midStart, midStart + 2);
  const back = s.slice(-backLen);
  return {
    number: num,
    front,
    mid,
    back,
    display: front + "…" + mid + "…" + back,
  };
}

/** Combined loc + optional block number — the refined chain box label. */
export function identifyLoc(input = {}) {
  const location = normalizeTx(input.location || input.tx || input.hash);
  const hashId = identifyHash(location);
  const blockId = identifyBlockNumber(input.blockNumber ?? input.block);
  if (!hashId && !blockId) return null;
  const parts = [];
  if (blockId) parts.push("blk " + blockId.display);
  if (hashId) parts.push(hashId.display);
  return {
    location: hashId?.location || null,
    hash: hashId,
    block: blockId,
    display: parts.join("  "),
    front: hashId?.front || blockId?.front || null,
    mid: hashId?.mid || blockId?.mid || null,
    back: hashId?.back || blockId?.back || null,
  };
}
