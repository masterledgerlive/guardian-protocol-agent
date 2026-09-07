/**
 * Treasury / storage-credit ledger (simulation).
 */
export class TreasuryModel {
  constructor({ initialBalance = 1.0, reserveRatio = 0.1 } = {}) {
    this.balance = initialBalance;
    this.reserveRatio = reserveRatio;
    this.spent = 0;
    this.deferredCount = 0;
  }

  available() {
    return Math.max(0, this.balance * (1 - this.reserveRatio));
  }

  canAfford(cost) {
    return cost <= this.available();
  }

  debit(cost, reason = "spend") {
    if (!this.canAfford(cost)) {
      this.deferredCount += 1;
      return { ok: false, reason: "TREASURY_LIMIT", balance: this.balance };
    }
    this.balance -= cost;
    this.spent += cost;
    return { ok: true, reason, balance: this.balance, spent: this.spent };
  }

  snapshot() {
    return {
      balance: this.balance,
      available: this.available(),
      spent: this.spent,
      reserve_ratio: this.reserveRatio,
      deferred_count: this.deferredCount,
      treasury_health: this.balance > 0 ? this.available() / Math.max(this.balance, 1e-18) : 0,
    };
  }
}
