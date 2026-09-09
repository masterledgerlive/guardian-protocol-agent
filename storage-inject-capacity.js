/**
 * Live-injector-aligned injection capacity report.
 *
 * Uses the same hitch / leftover math as production (lose-zero-gate) and the
 * same thin-book assumptions as revenue-sim. Does not execute trades.
 *
 * Run: node storage-inject-capacity.js
 *      node --test storage-inject-capacity.test.js
 */

import {
  estimateInjectCostEth,
  estimateCalldataHitchEth,
  maxHitchBytesForLeftover,
  STORE_HITCH_BYTES,
  DEFAULT_HITCH_COST_MULT,
} from "./lose-zero-gate.js";
import { LIVE_ASSUMPTIONS } from "./revenue-sim.js";
import {
  computePiggyTarget,
  DEFAULT_PIGGY_BANK_PCT,
  DEFAULT_PIGGY_BANK_MIN_USD,
} from "./piggy-bank.js";
import {
  INJECT_ALL_USD,
  cascadeGasFloorEth,
} from "./cascade-rollover.js";

/** Reference media sizes — labeled for horizon math only. */
export const MEDIA_REF = Object.freeze({
  eureka_tag_bytes: STORE_HITCH_BYTES,
  letter_bytes: 256,
  clip_64kib: 64 * 1024,
  movie_720p: 1.5 * 1024 * 1024 * 1024,
  movie_1080p: 4 * 1024 * 1024 * 1024,
});

/**
 * @param {object} live — overrides for LIVE_ASSUMPTIONS
 */
export function reportInjectCapacity(live = {}) {
  const a = { ...LIVE_ASSUMPTIONS, ...live };
  const hitchTagEth = estimateInjectCostEth(a.gwei, a.l1FeeEth);
  const leftoverEth =
    a.leftoverEth != null
      ? Number(a.leftoverEth)
      : (a.tradeableUsd / a.ethUsd) * 0.02;
  const maxBytes = maxHitchBytesForLeftover(
    leftoverEth,
    a.gwei,
    0,
    a.l1FeeEth > 0 ? a.l1FeeEth / Math.max(1, STORE_HITCH_BYTES) : 0
  );
  const gasPaused = a.gwei > 50;
  const eurekaOk = !gasPaused && leftoverEth + 1e-18 >= hitchTagEth;
  const piggyEth = a.piggyEth ?? 0.00007377588963825257;
  const piggyUsd = piggyEth * a.ethUsd;
  const withoutUnlock = a.tradeableUsd;
  const withCallToAdd = a.tradeableUsd + piggyUsd;
  const withBags = withCallToAdd + (a.bagsUsd || 0);

  const bytesPerCycle = gasPaused ? 0 : Math.min(maxBytes, 10 * 1024);
  const cycles = (size) =>
    bytesPerCycle > 0 ? Math.ceil(size / bytesPerCycle) : null;

  const gasFloor = cascadeGasFloorEth({});
  const injectAll = a.tradeableUsd < INJECT_ALL_USD;

  return {
    generatedAt: new Date().toISOString(),
    kind: "simulated|estimated",
    assumptions: {
      ...a,
      hitchTagEth,
      hitchTagUsd: hitchTagEth * a.ethUsd,
      leftoverEth,
      piggy_bank_pct: DEFAULT_PIGGY_BANK_PCT,
      piggy_bank_min_usd: DEFAULT_PIGGY_BANK_MIN_USD,
      label: a.label || LIVE_ASSUMPTIONS.label,
    },
    funds: {
      tradeable_usd: a.tradeableUsd,
      bags_usd: a.bagsUsd,
      piggy_eth: piggyEth,
      piggy_usd: piggyUsd,
      without_unlock_usd: withoutUnlock,
      with_call_to_add_usd: withCallToAdd,
      with_bags_upper_bound_usd: withBags,
      inject_all_book: injectAll,
      cascade_gas_floor_eth: gasFloor,
    },
    capacity_now: {
      gas_paused: gasPaused,
      eureka_ok: eurekaOk,
      max_hitch_bytes_per_swap: gasPaused ? 0 : maxBytes,
      eureka_tag_cost_eth: hitchTagEth,
      sell_hitch_mult: DEFAULT_HITCH_COST_MULT,
      note: gasPaused
        ? "GAS_PAUSE — agent freezes trades above 50 gwei"
        : eurekaOk
          ? "§$STORE§ fits leftover; larger ShadowWeave chunks need more leftover or Fast Pass BITS"
          : "Leftover too thin for Eureka — plain swap only (lose-zero)",
    },
    horizons: {
      letter_cycles: cycles(MEDIA_REF.letter_bytes),
      clip_64kib_cycles: cycles(MEDIA_REF.clip_64kib),
      movie_720p_cycles: cycles(MEDIA_REF.movie_720p),
      movie_1080p_cycles: cycles(MEDIA_REF.movie_1080p),
      equation:
        "Slow: piggy locks skim each win. Faster: call-to-add unlocks piggy → more leftover/BITS → larger hitch payloads + more swarm node rewards.",
    },
    lose_zero: {
      never_hitch_when_leftover_nonpositive: true,
      never_sell_underwater_to_insert_storage: true,
      hitch_cost_10b_eth: hitchTagEth,
      hitch_cost_1kib_eth: estimateCalldataHitchEth(1024, a.gwei),
    },
    piggy_demo_target_units: computePiggyTarget(1000, 1), // 1000 units @ $1
  };
}

const isMain =
  process.argv[1] && String(process.argv[1]).endsWith("storage-inject-capacity.js");

if (isMain) {
  const report = reportInjectCapacity();
  console.log(JSON.stringify(report, null, 2));
  console.error(
    `\nNOW: ${report.capacity_now.max_hitch_bytes_per_swap} bytes/swap · Eureka ${report.capacity_now.eureka_ok ? "OK" : "SKIP"} · call-to-add $${report.funds.with_call_to_add_usd.toFixed(2)}`,
  );
  console.error(
    `720p horizon: ${report.horizons.movie_720p_cycles ?? "∞"} cycles at current leftover`,
  );
}
