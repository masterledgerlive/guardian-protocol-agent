/**
 * Injection capacity math — what funds buy under lose-zero + hitch + BITS.
 *
 * Labeled assumptions mirror live Base hitch (calldata 16 gas/byte) and
 * ShadowWeave chunk sizing without importing root modules.
 */

export const CAPACITY_ASSUMPTIONS = Object.freeze({
  label: "hypothetical-inject-capacity-v0.1",
  eth_usd: 2481,
  gwei: 0.05,
  l1_fee_per_byte_eth: 0,
  calldata_gas_per_byte: 16,
  swap_base_gas: 180_000,
  default_payload_bytes: 10 * 1024,
  fast_payload_bytes: 20 * 1024,
  max_payload_bytes: 24 * 1024,
  header_bytes: 64,
  aes_overhead: 16,
  store_hitch_tag_bytes: 10,
  hitch_cost_mult_sell: 2,
  pause_above_gwei: 50,
  // Live thin-book snapshot (Railway 2026-09-08 — labeled)
  live_tradeable_usd: 2.24,
  live_bags_usd: 5.0,
  live_piggy_eth: 0.00007377588963825257,
  bits_per_kb: 1,
  fast_pass_bits_per_chunk: 5,
  movie_1080p_bytes: 4 * 1024 * 1024 * 1024, // ~4 GiB reference
  movie_720p_bytes: 1.5 * 1024 * 1024 * 1024,
});

/** ETH cost to hitch `bytes` of calldata at gwei (+ optional L1 per-byte). */
export function hitchCostEth(bytes, {
  gwei = CAPACITY_ASSUMPTIONS.gwei,
  l1FeePerByteEth = CAPACITY_ASSUMPTIONS.l1_fee_per_byte_eth,
} = {}) {
  const b = Math.max(0, Number(bytes) || 0);
  const g = Number(gwei);
  if (!Number.isFinite(g) || g < 0) return 0;
  const l2 = b * CAPACITY_ASSUMPTIONS.calldata_gas_per_byte * g * 1e-9;
  const l1 = b * (Number(l1FeePerByteEth) || 0);
  return l2 + l1;
}

/** Max hitch bytes affordable from leftover ETH (lose-zero). */
export function maxHitchBytes(leftoverEth, opts = {}) {
  const left = Number(leftoverEth);
  if (!(left > 0)) return 0;
  const g = Number(opts.gwei ?? CAPACITY_ASSUMPTIONS.gwei);
  const l1 = Number(opts.l1FeePerByteEth ?? CAPACITY_ASSUMPTIONS.l1_fee_per_byte_eth) || 0;
  const perByte = CAPACITY_ASSUMPTIONS.calldata_gas_per_byte * g * 1e-9 + l1;
  if (!(perByte > 0)) return Math.floor(CAPACITY_ASSUMPTIONS.max_payload_bytes);
  return Math.max(0, Math.floor(left / perByte));
}

/**
 * Chunk a file into Standby/Fast Pass sized payloads.
 */
export function planChunks(fileBytes, lane = "STANDBY", assumptions = {}) {
  const a = { ...CAPACITY_ASSUMPTIONS, ...assumptions };
  const size = Math.max(0, Number(fileBytes) || 0);
  const L = String(lane).toUpperCase();
  let payload =
    L === "FAST_PASS" ? a.fast_payload_bytes : a.default_payload_bytes;
  if (a.gwei > 5) {
    const scale = Math.max(0.4, 1 - (a.gwei - 5) / 20);
    payload = Math.floor(payload * scale);
  }
  payload = Math.min(payload, a.max_payload_bytes);
  const full = a.header_bytes + a.aes_overhead + payload;
  const chunks = payload > 0 ? Math.ceil(size / payload) || (size === 0 ? 0 : 1) : 0;
  return {
    lane: L,
    payload_bytes: payload,
    full_chunk_bytes: full,
    chunk_count: chunks,
    file_bytes: size,
    hitch_eth_per_chunk: hitchCostEth(full, { gwei: a.gwei, l1FeePerByteEth: a.l1_fee_per_byte_eth }),
  };
}

/**
 * Given funds, report what injection the system can handle now.
 */
export function computeInjectionCapacity({
  tradeableUsd = CAPACITY_ASSUMPTIONS.live_tradeable_usd,
  bagsUsd = CAPACITY_ASSUMPTIONS.live_bags_usd,
  piggyUsd = null,
  piggyEth = CAPACITY_ASSUMPTIONS.live_piggy_eth,
  bitsBalance = 0,
  leftoverEth = null,
  assumptions = {},
} = {}) {
  const a = { ...CAPACITY_ASSUMPTIONS, ...assumptions };
  const piggy =
    piggyUsd != null
      ? Number(piggyUsd)
      : (Number(piggyEth) || 0) * a.eth_usd;
  const liquid = Math.max(0, Number(tradeableUsd) || 0);
  const bags = Math.max(0, Number(bagsUsd) || 0);
  // Spendable without unlock = liquid only; with call-to-add = liquid + piggy
  const withoutUnlock = liquid;
  const withCallToAdd = liquid + piggy;
  const withBagsRecycle = liquid + piggy + bags; // still never sell underwater — labeled upper bound

  const leftEth =
    leftoverEth != null
      ? Number(leftoverEth)
      : (liquid / a.eth_usd) * 0.02; // ~2% leftover hypothesis on a seat

  const gasPaused = a.gwei > a.pause_above_gwei;
  const tagCost = hitchCostEth(a.store_hitch_tag_bytes, {
    gwei: a.gwei,
    l1FeePerByteEth: a.l1_fee_per_byte_eth,
  });
  const maxBytesNow = gasPaused ? 0 : maxHitchBytes(leftEth, a);
  const eurekaOk = !gasPaused && leftEth + 1e-18 >= tagCost;

  const standbyPlan = planChunks(maxBytesNow, "STANDBY", a);
  const fastPlan = planChunks(maxBytesNow, "FAST_PASS", a);
  const bits = Math.max(0, Number(bitsBalance) || 0);
  const fastChunksAffordable = Math.floor(bits / a.fast_pass_bits_per_chunk);
  const fastBytesFromBits = fastChunksAffordable * a.fast_payload_bytes;

  // Movie references — how many profitable cycles to fund one 720p / 1080p
  const bytesPerSuccessfulCycle = Math.min(maxBytesNow, a.default_payload_bytes);
  const cyclesFor720p =
    bytesPerSuccessfulCycle > 0
      ? Math.ceil(a.movie_720p_bytes / bytesPerSuccessfulCycle)
      : null;
  const cyclesFor1080p =
    bytesPerSuccessfulCycle > 0
      ? Math.ceil(a.movie_1080p_bytes / bytesPerSuccessfulCycle)
      : null;

  // USD → BITS conversion capacity after call-to-add (hypothesis)
  const bitsFromCall = withCallToAdd * 100; // bits_per_usd_revenue default
  const movieBits720 = planChunks(a.movie_720p_bytes, "FAST_PASS", a);
  const movieBitsCost = movieBits720.chunk_count * a.fast_pass_bits_per_chunk;

  return {
    kind: "simulated",
    assumption_label: a.label,
    funds: {
      tradeable_usd: liquid,
      piggy_usd: piggy,
      bags_usd: bags,
      without_unlock_usd: withoutUnlock,
      with_call_to_add_usd: withCallToAdd,
      with_bags_upper_bound_usd: withBagsRecycle,
      bits_balance: bits,
    },
    market: {
      eth_usd: a.eth_usd,
      gwei: a.gwei,
      gas_paused: gasPaused,
      leftover_eth_assumed: leftEth,
      eureka_tag_cost_eth: tagCost,
      eureka_ok: eurekaOk,
    },
    capacity_now: {
      max_hitch_bytes_per_swap: maxBytesNow,
      standby: standbyPlan,
      fast_pass_chunks_from_bits: fastChunksAffordable,
      fast_pass_bytes_from_bits: fastBytesFromBits,
      note: gasPaused
        ? "GAS_PAUSE — no injection until gwei drops"
        : eurekaOk
          ? "Eureka tag fits; larger payloads need leftover or Fast Pass BITS"
          : "Leftover too thin for §$STORE§ — plain swap only",
    },
    movie_horizon: {
      ref_720p_bytes: a.movie_720p_bytes,
      ref_1080p_bytes: a.movie_1080p_bytes,
      cycles_at_current_leftover_720p: cyclesFor720p,
      cycles_at_current_leftover_1080p: cyclesFor1080p,
      fast_pass_bits_needed_720p: movieBitsCost,
      bits_if_call_to_add_converts: bitsFromCall,
      call_covers_720p_fast_pass: bitsFromCall >= movieBitsCost,
    },
    equation: {
      summary:
        "capacity grows slowly while piggy locks skim; after call-to-add, liquid+piggy convert to BITS/hitch leftover and injection accelerates",
      lose_zero: "never pay hitch when leftover ≤ 0",
      sparse: "each chunk stripes across all online nodes; nodes earn BITS/KB",
    },
  };
}
