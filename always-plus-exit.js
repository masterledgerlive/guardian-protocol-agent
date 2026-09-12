/**
 * Always-plus exit invariant — coordinate with #62 / LOSE-ZERO on main.
 *
 * Do not fight: leftover after fees ≤ 0 → HOLD. Hitch shrinks or SKIP
 * (never turns a green exit red). No orch re-hitch after strip. CUT /
 * quote-miss freeze **new buys** only. Uni V4 stays deferred.
 */

export const ALWAYS_PLUS_EXIT = Object.freeze({
  leftoverAfterFeesMustBePositive: true,
  hitchNeverTurnsGreenExitRed: true,
  hitchOnlyWhenLeftoverCovers: true,
  microExtractWithoutHitch: true,
  hitchOnlyWhenHitchFloorClears: true,
  hitchBankOnSkip: true,
  cutClassDoesNotBlockGreenExit: true,
  quoteMissDoesNotBlockLeftoverSell: true,
  piggyNeverSell: true,
  vaultNeverSpend: true,
  noInventedPnl: true,
  v3OnlyLive: true,
  v4Deferred: true,
  sibling:
    "LOSE-ZERO sell floor (#62) + quote-gate (#61) on main (sells stay open on buy freeze). This scoreboard must not add a sell block.",
});
