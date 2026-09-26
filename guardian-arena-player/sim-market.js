/**
 * Seeded sim market — offline study ticks (agent-arena sim pattern).
 */

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createSimMarket({ seed = 42, pairs = ["MEME/ETH", "PEPE/ETH", "DEGEN/ETH"] } = {}) {
  const rand = mulberry32(seed);
  const state = new Map();
  for (const pair of pairs) {
    const last = 0.0001 + rand() * 0.002;
    state.set(pair, {
      last,
      candles: Array.from({ length: 30 }, (_, i) => {
        const c = last * (1 + (rand() - 0.5) * 0.04);
        return { t: i, o: c, h: c * 1.01, l: c * 0.99, c, v: 0.5 + rand() };
      }),
      curveProgressPct: 10 + rand() * 40,
    });
  }

  return {
    kind: "sim",
    async listPairs() {
      return [...pairs];
    },
    async snapshot(pair, ctxCandles = 24) {
      const s = state.get(pair);
      if (!s) throw new Error(`unknown pair ${pair}`);
      const drift = (rand() - 0.48) * 0.02;
      const next = Math.max(1e-9, s.last * (1 + drift));
      const candle = {
        t: s.candles.length,
        o: s.last,
        h: Math.max(s.last, next) * 1.005,
        l: Math.min(s.last, next) * 0.995,
        c: next,
        v: 0.4 + rand(),
      };
      s.candles.push(candle);
      if (s.candles.length > 200) s.candles.shift();
      s.last = next;
      s.curveProgressPct = Math.min(99, s.curveProgressPct + rand() * 0.4);
      const mid = next;
      const bids = [
        { price: mid * 0.999, size: 0.8 + rand() },
        { price: mid * 0.998, size: 1.2 + rand() },
        { price: mid * 0.996, size: 2 + rand() },
      ];
      const asks = [
        { price: mid * 1.001, size: 0.8 + rand() },
        { price: mid * 1.002, size: 1.2 + rand() },
        { price: mid * 1.004, size: 2 + rand() },
      ];
      return {
        pair,
        last: mid,
        candles: s.candles.slice(-Math.max(2, ctxCandles)),
        bids,
        asks,
        ageMinutes: 3 + rand() * 20,
        uniqueBuyers: Math.floor(20 + rand() * 200),
        curveProgressPct: s.curveProgressPct,
        reserveEth: 2 + rand() * 20,
        provenance: { identity: "sim", price: "sim", book: "sim" },
        observedAt: Date.now(),
        validUntil: Date.now() + 15_000,
      };
    },
  };
}
