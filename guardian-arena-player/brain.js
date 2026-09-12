/**
 * Brain wrappers — never-throw decide() (agent-arena hard rule).
 */

import { hardenVerdict, skipVerdict } from "./types.js";

/**
 * Wrap any brain so decide() never throws and verdicts are hardened.
 * @param {{ decide: Function }} brain
 */
export function guardDecide(brain) {
  return {
    async decide(snap, opts = {}) {
      try {
        const raw = await Promise.resolve(brain.decide(snap, opts));
        return hardenVerdict(raw, opts);
      } catch (err) {
        return skipVerdict(`brain-error:${String(err?.message || err).slice(0, 60)}`);
      }
    },
  };
}

/**
 * Pick live brain only while agent-hour budget allows; else heuristic.
 */
export function selectBrain({
  assistAllowed,
  liveBrain = null,
  heuristicBrain,
}) {
  if (assistAllowed && liveBrain) return guardDecide(liveBrain);
  return guardDecide(heuristicBrain);
}
