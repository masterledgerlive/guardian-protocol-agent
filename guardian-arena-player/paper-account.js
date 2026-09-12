/**
 * Virtual ETH paper ledger — agent-arena paper account pattern.
 * Real quotes optional; never touches RISK / V4 hot wallets.
 */

export class PaperAccount {
  constructor({ initialEth = 10, feeBps = 60, now = () => Date.now() } = {}) {
    if (!(initialEth > 0) || !(feeBps >= 0) || feeBps > 1000) {
      throw new Error("invalid paper account");
    }
    this.initialEth = initialEth;
    this.cashEth = initialEth;
    this.feeBps = feeBps;
    this.now = now;
    this.position = null; // { pair, tokens, entry, sizeEth }
    this.fills = [];
    this.realizedPnlEth = 0;
  }

  fresh(snap) {
    if (!snap || !(Number(snap.last) > 0)) return false;
    if (snap.validUntil != null && this.now() >= Number(snap.validUntil)) return false;
    return true;
  }

  buy(snap, sizeEth, slippageBps = 100) {
    if (!this.fresh(snap) || !(sizeEth > 0) || this.position) return null;
    const fee = sizeEth * (this.feeBps / 10_000);
    const total = sizeEth + fee;
    if (total > this.cashEth) return null;
    const px = Number(snap.last) * (1 + Math.max(0, slippageBps) / 10_000);
    if (!(px > 0)) return null;
    const tokens = sizeEth / px;
    this.cashEth -= total;
    this.position = {
      pair: snap.pair,
      tokens,
      entry: px,
      sizeEth,
    };
    const fill = { side: "BUY", pair: snap.pair, price: px, tokens, sizeEth, fee, at: this.now() };
    this.fills.push(fill);
    return fill;
  }

  sell(snap, slippageBps = 100) {
    if (!this.fresh(snap) || !this.position) return null;
    const px = Number(snap.last) * (1 - Math.max(0, slippageBps) / 10_000);
    if (!(px > 0)) return null;
    const quote = this.position.tokens * px;
    const fee = quote * (this.feeBps / 10_000);
    const net = quote - fee;
    const pnl = net - this.position.sizeEth;
    this.cashEth += net;
    this.realizedPnlEth += pnl;
    const fill = {
      side: "SELL",
      pair: snap.pair,
      price: px,
      tokens: this.position.tokens,
      sizeEth: net,
      fee,
      pnlEth: pnl,
      at: this.now(),
    };
    this.fills.push(fill);
    this.position = null;
    return fill;
  }

  mark(snap) {
    if (!this.position || !(Number(snap?.last) > 0)) {
      return { equityEth: this.cashEth, unrealizedEth: 0 };
    }
    const unrealizedEth = this.position.tokens * Number(snap.last) - this.position.sizeEth;
    return {
      equityEth: this.cashEth + this.position.tokens * Number(snap.last),
      unrealizedEth,
    };
  }
}
