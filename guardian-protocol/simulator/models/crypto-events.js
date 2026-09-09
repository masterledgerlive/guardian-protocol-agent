/**
 * Known crypto / DePIN events that can freeze or break injection + storage.
 * Each event declares: freeze behavior, survival checks, recovery hypothesis.
 * All outcomes are simulated — never claimed as production measurements.
 */

export const CRYPTO_EVENTS = Object.freeze({
  GAS_SPIKE: {
    id: "GAS_SPIKE",
    label: "Base gas > pause threshold (live: 50 gwei)",
    freezes: ["STANDBY", "FAST_PASS", "SILO", "TRADE"],
    severity: "high",
    params: { gwei: 55, pause_above_gwei: 50 },
  },
  L1_FEE_SPIKE: {
    id: "L1_FEE_SPIKE",
    label: "L1 data fee surge (hitch cost explodes)",
    freezes: ["HITCH"],
    severity: "high",
    params: { l1_fee_eth: 0.002, hitch_cost_mult: 2 },
  },
  MEMPOOL_CONGESTION: {
    id: "MEMPOOL_CONGESTION",
    label: "No organic swap seats for Standby hitch",
    freezes: ["STANDBY"],
    severity: "medium",
    params: { organic_gap_rate: 0 },
  },
  RPC_OUTAGE: {
    id: "RPC_OUTAGE",
    label: "Primary RPC dead — failover required",
    freezes: ["TRADE", "INJECT"],
    severity: "high",
    params: { rpc_alive: false, failover_ok: true },
  },
  SEQUENCER_DOWNTIME: {
    id: "SEQUENCER_DOWNTIME",
    label: "L2 sequencer halt — no new blocks",
    freezes: ["TRADE", "INJECT", "ANCHOR"],
    severity: "critical",
    params: { blocks_progressing: false },
  },
  LIQUIDITY_FREEZE: {
    id: "LIQUIDITY_FREEZE",
    label: "Thin book / inject-all seat cannot clear min entry",
    freezes: ["TRADE"],
    severity: "medium",
    params: { tradeable_usd: 0.71, min_entry_usd: 2 },
  },
  FLASH_CRASH: {
    id: "FLASH_CRASH",
    label: "Mark collapses — PRICE_INSANE / lose-zero hold",
    freezes: ["SELL_HITCH", "CASCADE"],
    severity: "high",
    params: { price_mult: 0.05, lose_zero_hold: true },
  },
  ORACLE_DESYNC: {
    id: "ORACLE_DESYNC",
    label: "DexScreener vs pool mark outside 0.01×–100×",
    freezes: ["BUY", "SELL"],
    severity: "high",
    params: { price_insane: true },
  },
  NODE_BANK_RUN: {
    id: "NODE_BANK_RUN",
    label: "Mass Tier-2 node withdrawal",
    freezes: ["RETRIEVE"],
    severity: "critical",
    params: { drop_ratio: 0.6 },
  },
  BANDWIDTH_CAP: {
    id: "BANDWIDTH_CAP",
    label: "Per-tick bandwidth ceiling hit",
    freezes: ["INJECT"],
    severity: "medium",
    params: { bandwidth_cap_bytes: 512 },
  },
  TREASURY_DRAIN: {
    id: "TREASURY_DRAIN",
    label: "Storage credits / BITS exhausted",
    freezes: ["FAST_PASS"],
    severity: "medium",
    params: { bits_balance: 0 },
  },
  STABLECOIN_DEPEG: {
    id: "STABLECOIN_DEPEG",
    label: "Payment rail depeg — agent fees unreliable",
    freezes: ["AGENT_PAY"],
    severity: "medium",
    params: { stable_mult: 0.7 },
  },
  FEE_MARKET_FREEZE: {
    id: "FEE_MARKET_FREEZE",
    label: "Dual-block small-block gas market saturated (hypothesis)",
    freezes: ["AGENT_MICRO"],
    severity: "low",
    params: { small_block_full: true },
  },
});

export function listCryptoEvents() {
  return Object.values(CRYPTO_EVENTS);
}

/**
 * Apply an event to a mutable stress context and return survival verdict.
 * Context shape is owned by system-loop / run-crypto-stress.
 */
export function applyCryptoEvent(eventId, ctx = {}) {
  const event = CRYPTO_EVENTS[eventId];
  if (!event) {
    return { ok: false, reason: "UNKNOWN_EVENT", event_id: eventId };
  }

  const c = {
    gwei: ctx.gwei ?? 0.05,
    pause_above_gwei: ctx.pause_above_gwei ?? 50,
    l1_fee_eth: ctx.l1_fee_eth ?? 0,
    hitch_cost_eth: ctx.hitch_cost_eth ?? 1e-8,
    leftover_eth: ctx.leftover_eth ?? 0.001,
    tradeable_usd: ctx.tradeable_usd ?? 5,
    min_entry_usd: ctx.min_entry_usd ?? 2,
    bits_balance: ctx.bits_balance ?? 100,
    rpc_alive: ctx.rpc_alive !== false,
    failover_ok: ctx.failover_ok !== false,
    blocks_progressing: ctx.blocks_progressing !== false,
    organic_gap_rate: ctx.organic_gap_rate ?? 0.5,
    online_nodes: ctx.online_nodes ?? 5,
    total_nodes: ctx.total_nodes ?? 5,
    price_insane: ctx.price_insane === true,
    lose_zero_hold: ctx.lose_zero_hold === true,
    bandwidth_ok: ctx.bandwidth_ok !== false,
    ...ctx,
  };

  // Mutate context from event params
  const p = event.params || {};
  if (p.gwei != null) c.gwei = p.gwei;
  if (p.l1_fee_eth != null) {
    c.l1_fee_eth = p.l1_fee_eth;
    c.hitch_cost_eth = (c.hitch_cost_eth || 0) + p.l1_fee_eth;
  }
  if (p.organic_gap_rate != null) c.organic_gap_rate = p.organic_gap_rate;
  if (p.rpc_alive != null) c.rpc_alive = p.rpc_alive;
  if (p.failover_ok != null) c.failover_ok = p.failover_ok;
  if (p.blocks_progressing != null) c.blocks_progressing = p.blocks_progressing;
  if (p.tradeable_usd != null) c.tradeable_usd = p.tradeable_usd;
  if (p.min_entry_usd != null) c.min_entry_usd = p.min_entry_usd;
  if (p.bits_balance != null) c.bits_balance = p.bits_balance;
  if (p.price_insane != null) c.price_insane = p.price_insane;
  if (p.lose_zero_hold != null) c.lose_zero_hold = p.lose_zero_hold;
  if (p.bandwidth_cap_bytes != null) {
    c.bandwidth_ok = (ctx.payload_bytes ?? 1024) <= p.bandwidth_cap_bytes;
  }
  if (p.drop_ratio != null) {
    c.online_nodes = Math.max(0, Math.floor(c.total_nodes * (1 - p.drop_ratio)));
  }

  const checks = evaluateSurvival(event, c);
  return {
    ok: checks.survives,
    event,
    context: c,
    checks,
    kind: "simulated",
  };
}

/**
 * Survival rules — what the designed system must still do under the event.
 */
export function evaluateSurvival(event, c) {
  const frozen = new Set(event.freezes || []);
  const notes = [];

  // Critical path: sequencer down → nothing progresses (honest freeze)
  if (!c.blocks_progressing) {
    notes.push("SEQUENCER_HALT_HONEST_FREEZE");
    return {
      survives: true, // system correctly freezes rather than corrupting
      mode: "SAFE_FREEZE",
      can_inject: false,
      can_trade: false,
      can_retrieve: c.online_nodes > 0,
      deferred: true,
      notes,
    };
  }

  // RPC: survive if failover works
  const rpcOk = c.rpc_alive || c.failover_ok;
  if (!rpcOk) {
    notes.push("RPC_TOTAL_FAILURE");
    return {
      survives: false,
      mode: "HARD_FAIL",
      can_inject: false,
      can_trade: false,
      can_retrieve: false,
      deferred: true,
      notes,
    };
  }
  if (!c.rpc_alive && c.failover_ok) notes.push("RPC_FAILOVER_USED");

  // Gas spike → pause trades (live agent behavior)
  const gasPaused = c.gwei > c.pause_above_gwei;
  if (gasPaused) notes.push("GAS_PAUSE");

  // Hitch only when leftover covers cost (lose-zero)
  const hitchAffordable = c.leftover_eth + 1e-18 >= c.hitch_cost_eth;
  if (!hitchAffordable) notes.push("HITCH_SKIPPED_LOSE_ZERO");

  // Liquidity
  const canTrade =
    !gasPaused &&
    !c.price_insane &&
    c.tradeable_usd + 1e-9 >= c.min_entry_usd &&
    !frozen.has("TRADE");

  // Standby needs organic gaps
  const standbyOk = !gasPaused && c.organic_gap_rate > 0 && !frozen.has("STANDBY");
  const fastPassOk =
    !gasPaused &&
    c.bits_balance >= 5 &&
    hitchAffordable &&
    !frozen.has("FAST_PASS");
  const siloOk = !gasPaused && canTrade && !frozen.has("SILO");

  const canInject =
    c.bandwidth_ok &&
    (standbyOk || fastPassOk || siloOk) &&
    !frozen.has("INJECT");

  // Retrieval: any online node keeps the swarm alive (degraded).
  // Healthy retrieve needs ≥40% nodes online (erasure/repair headroom).
  const canRetrieve = c.online_nodes >= 1;
  const retrieveHealthy =
    c.online_nodes >= Math.max(1, Math.ceil((c.total_nodes || 1) * 0.4));
  if (!retrieveHealthy) notes.push("RETRIEVE_AT_RISK");
  if (!canRetrieve) notes.push("RETRIEVE_DEAD");

  // Flash crash: hold underwater — survive by not selling at a loss
  if (c.lose_zero_hold) {
    notes.push("LOSE_ZERO_HOLD");
  }

  // System "survives" if it does not corrupt canonical data and either
  // continues a safe path OR honestly defers/freezes.
  const honestFreeze = !canInject && !canTrade;
  const survives =
    (canRetrieve || honestFreeze) &&
    !(c.price_insane && canTrade); // must not trade through PRICE_INSANE

  if (honestFreeze) notes.push("DEFERRED_OR_FROZEN");
  if (canInject) notes.push("INJECT_PATH_OPEN");

  let mode = "CONTINUE";
  if (honestFreeze) mode = "SAFE_FREEZE";
  else if (!retrieveHealthy || (!canTrade && canInject)) mode = "DEGRADED";

  return {
    survives,
    mode,
    can_inject: canInject,
    can_trade: canTrade,
    can_retrieve: canRetrieve,
    retrieve_healthy: retrieveHealthy,
    standby_ok: standbyOk,
    fast_pass_ok: fastPassOk,
    silo_ok: siloOk,
    hitch_affordable: hitchAffordable,
    deferred: !canInject,
    notes,
  };
}

/**
 * Run every catalog event against a baseline context.
 */
export function runAllCryptoEvents(baseline = {}) {
  const results = [];
  for (const event of listCryptoEvents()) {
    results.push(applyCryptoEvent(event.id, { ...baseline }));
  }
  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  return {
    BENCHMARK: "crypto-events-stress-0001",
    BENCHMARK_VERSION: "0.1.0",
    GENERATED_AT_KIND: "simulated",
    event_count: results.length,
    survived: passed,
    hard_fails: failed.map((f) => f.event?.id || f.event_id),
    results,
    STATUS: failed.length === 0 ? "PROVEN_UNDER_CATALOG" : "GAPS",
    ASSUMPTIONS: [
      "kind=simulated",
      "catalog=CRYPTO_EVENTS_v0.1",
      "lose_zero=hitch_skipped_before_loss",
      "gas_pause_above=50_gwei",
    ],
  };
}
