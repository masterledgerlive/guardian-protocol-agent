/**
 * Piggy-bank compound model — slow start, then faster as seats + revenue grow.
 *
 * Mirrors root piggy-bank invariants conceptually (never auto-spend dust;
 * operator "call to add" unlocks) without importing production modules.
 *
 * Equation (labeled hypothesis):
 *   piggy_{t+1} = piggy_t + max(0, revenue_t * skim_pct)
 *   ready_when_called = piggy (unlock) + liquid_tradeable
 *   capacity_bytes grows with ready capital via hitch leftover math
 */

export const PIGGY_COMPOUND_ASSUMPTIONS = Object.freeze({
  label: "hypothetical-piggy-compound-v0.1",
  skim_pct: 0.05, // match DEFAULT_PIGGY_BANK_PCT / earnings buffer spirit
  agent_share_pct: 0.02, // nested agent piggy for future AI seats
  unlock_on_call_only: true,
  // Compound acceleration: each successful inject cycle multiplies skim slightly
  accel_per_success: 0.002,
  accel_cap: 0.12,
});

export class PiggyCompoundModel {
  constructor({
    initialPiggyUsd = 0,
    initialAgentUsd = 0,
    liquidUsd = 0,
    assumptions = {},
  } = {}) {
    this.assumptions = { ...PIGGY_COMPOUND_ASSUMPTIONS, ...assumptions };
    this.piggyUsd = Math.max(0, Number(initialPiggyUsd) || 0);
    this.agentUsd = Math.max(0, Number(initialAgentUsd) || 0);
    this.liquidUsd = Math.max(0, Number(liquidUsd) || 0);
    this.successes = 0;
    this.locked = true;
    this.history = [];
  }

  effectiveSkimPct() {
    const a = this.assumptions;
    return Math.min(a.accel_cap, a.skim_pct + this.successes * a.accel_per_success);
  }

  /**
   * Deposit positive revenue leftover into piggy + agent share.
   * Negative / zero revenue leaves piles untouched (lose-zero spirit).
   */
  accrue(revenueUsd, meta = {}) {
    const rev = Number(revenueUsd) || 0;
    if (!(rev > 0)) {
      this.history.push({ kind: "SKIP_ACCRUE", revenueUsd: rev, ...meta });
      return { accrued: 0, piggyUsd: this.piggyUsd, agentUsd: this.agentUsd };
    }
    const skim = this.effectiveSkimPct();
    const toPiggy = rev * skim;
    const toAgent = rev * this.assumptions.agent_share_pct;
    this.piggyUsd += toPiggy;
    this.agentUsd += toAgent;
    this.successes += 1;
    // Remainder of revenue returns to liquid tradeable (hypothesis)
    const toLiquid = Math.max(0, rev - toPiggy - toAgent);
    this.liquidUsd += toLiquid;
    const row = {
      kind: "ACCRUE",
      revenueUsd: rev,
      skim_pct: skim,
      to_piggy: toPiggy,
      to_agent: toAgent,
      to_liquid: toLiquid,
      piggyUsd: this.piggyUsd,
      agentUsd: this.agentUsd,
      liquidUsd: this.liquidUsd,
      ...meta,
    };
    this.history.push(row);
    return row;
  }

  /**
   * Operator "call to add" — unlock piggy (and optionally agent) for injection.
   */
  callToAdd({ includeAgent = false } = {}) {
    if (!this.assumptions.unlock_on_call_only) {
      this.locked = false;
    }
    const unlockedPiggy = this.piggyUsd;
    const unlockedAgent = includeAgent ? this.agentUsd : 0;
    const ready = this.liquidUsd + unlockedPiggy + unlockedAgent;
    this.liquidUsd = ready;
    this.piggyUsd = 0;
    if (includeAgent) this.agentUsd = 0;
    this.locked = false;
    const row = {
      kind: "CALL_TO_ADD",
      unlocked_piggy_usd: unlockedPiggy,
      unlocked_agent_usd: unlockedAgent,
      liquid_usd: this.liquidUsd,
      ready_usd: ready,
    };
    this.history.push(row);
    return row;
  }

  /** Capital available without unlock (liquid only while locked). */
  spendableUsd() {
    if (this.locked && this.assumptions.unlock_on_call_only) {
      return this.liquidUsd;
    }
    return this.liquidUsd + this.piggyUsd + this.agentUsd;
  }

  /**
   * Run N cycles with a revenue schedule (array or function(t)).
   * Models slow→fast: early small revenues, later larger as capital compounds.
   */
  simulateCycles(cycles, revenueAt = null) {
    const n = Math.max(0, Math.floor(Number(cycles) || 0));
    const defaultRevenue = (t) => {
      // Slow then faster: quadratic growth tempered by liquid base
      const base = Math.max(0.01, this.liquidUsd * 0.02);
      return base * (1 + 0.05 * t + 0.002 * t * t);
    };
    const fn = typeof revenueAt === "function" ? revenueAt : defaultRevenue;
    for (let t = 0; t < n; t++) {
      this.accrue(fn(t, this), { cycle: t });
    }
    return this.snapshot();
  }

  snapshot() {
    return {
      piggy_usd: this.piggyUsd,
      agent_usd: this.agentUsd,
      liquid_usd: this.liquidUsd,
      locked: this.locked,
      successes: this.successes,
      effective_skim_pct: this.effectiveSkimPct(),
      spendable_without_unlock_usd: this.spendableUsd(),
      total_reserved_usd: this.piggyUsd + this.agentUsd,
      assumption_label: this.assumptions.label,
      kind: "simulated",
      history_len: this.history.length,
    };
  }
}
