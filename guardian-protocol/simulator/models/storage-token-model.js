/**
 * Storage Token (BITS) ledger — simulation only.
 *
 * Mirrors live hitch injector economics (Standby / Fast Pass / Silo) without
 * importing root trading modules. All values are labeled assumptions.
 *
 * Roles:
 *   - Injector pays Fast Pass in BITS (or burns standby wait).
 *   - Nodes earn BITS for storing others' fragments (per KB).
 *   - Hosts of own Silo fragments earn nothing from the public pool.
 *   - Revenue → piggy → Storage Token conversion is calculated, never assumed.
 */

export const STORAGE_TOKEN_ASSUMPTIONS = Object.freeze({
  label: "hypothetical-storage-token-v0.1",
  symbol: "BITS",
  // Live orchestrator constants (bitstorage-orchestrator.js) — mirrored
  fast_pass_cost_bits_per_chunk: 5,
  bits_per_kb_stored: 1,
  standby_cost_bits: 0,
  silo_cost_bits: 0,
  // AgenticEVM market: credits per USD of realized injector leftover (hypothesis)
  bits_per_usd_revenue: 100,
  // Minimum BITS balance before Fast Pass lane is offered
  fast_pass_min_balance: 5,
  // Node payout share of storage spend (rest stays treasury reserve)
  node_payout_ratio: 0.85,
});

export class StorageTokenLedger {
  /**
   * @param {object} opts
   * @param {number} [opts.initialBalance]
   * @param {object} [opts.assumptions]
   */
  constructor({ initialBalance = 0, assumptions = {} } = {}) {
    this.assumptions = { ...STORAGE_TOKEN_ASSUMPTIONS, ...assumptions };
    this.balance = Number(initialBalance) || 0;
    this.earned = 0;
    this.spent = 0;
    this.nodeEarnings = new Map(); // nodeId -> BITS
    this.history = [];
  }

  #push(kind, amount, meta = {}) {
    const row = {
      kind,
      amount,
      balance: this.balance,
      timestamp_index: this.history.length,
      ...meta,
    };
    this.history.push(row);
    return row;
  }

  /** Convert realized injector USD leftover into Storage Token (hypothesis). */
  mintFromRevenue(usd, reason = "REVENUE_CONVERT") {
    const u = Math.max(0, Number(usd) || 0);
    const bits = u * this.assumptions.bits_per_usd_revenue;
    this.balance += bits;
    this.earned += bits;
    return this.#push("MINT", bits, { reason, usd: u, kind_label: "simulated" });
  }

  /**
   * Cost to inject `chunkCount` fragments on a lane.
   * Standby/Silo are free in BITS (pay wait / own-trade scarcity instead).
   */
  quoteInjection({ chunkCount = 1, lane = "STANDBY" } = {}) {
    const n = Math.max(0, Math.floor(Number(chunkCount) || 0));
    const L = String(lane || "STANDBY").toUpperCase();
    let cost = 0;
    if (L === "FAST_PASS") {
      cost = n * this.assumptions.fast_pass_cost_bits_per_chunk;
    } else if (L === "SILO") {
      cost = n * this.assumptions.silo_cost_bits;
    } else {
      cost = n * this.assumptions.standby_cost_bits;
    }
    return {
      lane: L,
      chunk_count: n,
      cost_bits: cost,
      affordable: this.balance + 1e-12 >= cost,
      balance: this.balance,
      assumption_label: this.assumptions.label,
    };
  }

  /** Debit Fast Pass (or other lane) cost. */
  payInjection(quote, meta = {}) {
    const q = quote || this.quoteInjection(meta);
    if (!q.affordable) {
      return {
        ok: false,
        reason: "INSUFFICIENT_BITS",
        quote: q,
        balance: this.balance,
      };
    }
    this.balance -= q.cost_bits;
    this.spent += q.cost_bits;
    this.#push("SPEND_INJECT", q.cost_bits, { lane: q.lane, ...meta });
    return { ok: true, quote: q, balance: this.balance };
  }

  /**
   * Reward a node for storing `byteLength` of someone else's data.
   * Silo/self storage may pass { publicPool: false } to skip rewards.
   */
  rewardNode(nodeId, byteLength, { publicPool = true } = {}) {
    if (!publicPool) {
      return { ok: true, bits: 0, skipped: "SILO_OR_SELF" };
    }
    const kb = Math.ceil(Math.max(0, Number(byteLength) || 0) / 1024);
    const bits = kb * this.assumptions.bits_per_kb_stored;
    const payout = bits * this.assumptions.node_payout_ratio;
    const prev = this.nodeEarnings.get(nodeId) || 0;
    this.nodeEarnings.set(nodeId, prev + payout);
    // Mint rewards from the protocol incentive pool (modeled as earned supply)
    this.earned += payout;
    this.#push("NODE_REWARD", payout, { node_id: nodeId, byte_length: byteLength, kb });
    return { ok: true, bits: payout, node_id: nodeId, kb };
  }

  /** Total BITS paid out to all nodes. */
  totalNodeEarnings() {
    let s = 0;
    for (const v of this.nodeEarnings.values()) s += v;
    return s;
  }

  canFastPass(chunkCount = 1) {
    const q = this.quoteInjection({ chunkCount, lane: "FAST_PASS" });
    return (
      q.affordable &&
      this.balance >= this.assumptions.fast_pass_min_balance
    );
  }

  snapshot() {
    return {
      symbol: this.assumptions.symbol,
      balance: this.balance,
      earned: this.earned,
      spent: this.spent,
      node_earnings_total: this.totalNodeEarnings(),
      node_earnings: Object.fromEntries(this.nodeEarnings),
      history_len: this.history.length,
      assumption_label: this.assumptions.label,
      kind: "simulated",
    };
  }
}
