/**
 * SKIP_HITCH uncovered leftover — bank a learn shard, do not unpaired burn.
 *
 * When leftover cannot cover KEY+LOC, credit hitch-bank (ETH) and file an
 * append-only note. Hitch when leftover covers is unchanged (original formula).
 * Does not call vitaSave / inscribeChunk / mother-genesis.
 */

export const SKIP_HITCH_LEARN_ID = "skip-hitch-uncovered";

export function bankSkipHitchLearnShard({
  symbol = "?",
  leftoverEth = 0,
  hitchWouldEth = 0,
  reason = "SKIP_HITCH leftover too thin",
} = {}) {
  const left = Number(leftoverEth);
  const would = Number(hitchWouldEth);
  const uncovered = !(Number.isFinite(left) && Number.isFinite(would) && left + 1e-18 >= would && would > 0);
  return {
    id: SKIP_HITCH_LEARN_ID,
    symbol: String(symbol || "?").toUpperCase(),
    leftoverEth: Number.isFinite(left) ? left : 0,
    hitchWouldEth: Number.isFinite(would) ? would : 0,
    uncovered,
    banked: true,
    burned: false,
    unpairedBurn: false,
    hitchWhenCovered: true,
    formula: "original-message-first",
    motherBrain: "untouched",
    reason: String(reason || "SKIP_HITCH leftover too thin"),
    text:
      "SKIP_HITCH leftover uncovered — bank learn shard, do not unpaired burn. "
      + "Hitch when leftover covers KEY+LOC unchanged (message-first).",
  };
}
