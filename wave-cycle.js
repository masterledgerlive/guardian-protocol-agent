/**
 * Multi-source wave data + no-loss succession cycles.
 *
 * Sources we already keep (and prefer more than one when available):
 *   1. GeckoTerminal OHLCV (Base pool)
 *   2. DexScreener charts / live marks
 *   3. Binance klines (allowlisted CEX-equivalent only)
 *   4. Live tick history (in-process readings — always on after boot)
 *
 * Philosophy (operator brief): do not wait for a single huge outcome — ride
 * continuous no-loss cycles. Execute when ≥ ALIGN_MIN of the entry variables
 * agree, hitch Eureka / piggy when leftover covers, go again. Never force a
 * cycle that would lose after fees.
 */

export const WAVE_SOURCES = Object.freeze([
  "GeckoTerminal",
  "DexScreener",
  "Binance",
  "LiveTicks",
]);

/** Auto buys need at least this many aligned entry variables (default 2). */
export const DEFAULT_ALIGN_MIN = 2;

/**
 * Env `CYCLE_ALIGN_MIN` — require N aligned vars (2 or 3). Invalid → 2.
 * Cap at 4 so we never demand the impossible.
 */
export function cycleAlignMin(env = process.env) {
  const raw = env?.CYCLE_ALIGN_MIN;
  if (raw == null || String(raw).trim() === "") return DEFAULT_ALIGN_MIN;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_ALIGN_MIN;
  return Math.min(4, Math.max(1, Math.floor(n)));
}

/**
 * Rank OHLC seed candidates. Prefer Base DEX with the longest history; keep
 * every viable source so callers can log multi-source coverage.
 *
 * @returns {{ picked: {src,data}|null, sources: Array<{src,data,bars}>, multi: boolean }}
 */
export function rankWaveSeedSources({ gt, ds, binance, allowBinance } = {}) {
  const sources = [];
  if (Array.isArray(gt) && gt.length >= 5) {
    sources.push({ src: "GeckoTerminal", data: gt, bars: gt.length });
  }
  if (Array.isArray(ds) && ds.length >= 5) {
    sources.push({ src: "DexScreener", data: ds, bars: ds.length });
  }
  if (allowBinance && Array.isArray(binance) && binance.length >= 5) {
    sources.push({ src: "Binance", data: binance, bars: binance.length });
  }

  const base = sources.filter((s) => s.src === "GeckoTerminal" || s.src === "DexScreener");
  const cex = sources.filter((s) => s.src === "Binance");
  let picked = null;
  if (base.length) {
    base.sort((a, b) => b.bars - a.bars);
    picked = base[0];
  } else if (cex.length) {
    picked = cex[0];
  }

  return {
    picked: picked ? { src: picked.src, data: picked.data } : null,
    sources: sources.map(({ src, data, bars }) => ({ src, bars, data })),
    multi: sources.length >= 2,
  };
}

/**
 * Merge candle highs/lows across sources for a richer wave envelope.
 * Uses the primary (picked) close series; expands high/low when another
 * Base source saw a more extreme print the same day (±1d).
 */
export function mergeWaveCandles(primary, secondaryList = []) {
  if (!Array.isArray(primary) || primary.length < 5) return primary || null;
  const extras = (secondaryList || []).filter((a) => Array.isArray(a) && a.length >= 5);
  if (!extras.length) return primary.map((c) => ({ ...c }));

  const byDay = (t) => Math.floor(Number(t) / 86_400_000);
  const maps = extras.map((arr) => {
    const m = new Map();
    for (const c of arr) {
      if (!c || !(c.c > 0)) continue;
      m.set(byDay(c.t), c);
    }
    return m;
  });

  return primary.map((c) => {
    const day = byDay(c.t);
    let h = Number(c.h) || Number(c.c);
    let l = Number(c.l) || Number(c.c);
    for (const m of maps) {
      const o = m.get(day) || m.get(day - 1) || m.get(day + 1);
      if (!o) continue;
      const oh = Number(o.h) || Number(o.c);
      const ol = Number(o.l) || Number(o.c);
      if (oh > h) h = oh;
      if (ol > 0 && ol < l) l = ol;
    }
    return { ...c, h, l };
  });
}

/**
 * Entry alignment — count how many independent buy variables agree.
 * Operator wants ≥2 (or 3) before auto-executing a no-loss cycle.
 *
 * Variables:
 *   trough     — at / near confirmed MIN
 *   momentum   — RSI+MACD trough forming
 *   prediction — cycle pre-buy
 *   pullback   — inject-main recent-low pullback
 *   leftover   — LOSE_ZERO leftover would cover hitch (edge clear)
 *   smartMoney — top traders confirming buy
 */
export function scoreEntryAlignment({
  atMinTrough = false,
  momentumEntry = false,
  predBuy = false,
  injectPullback = false,
  nearProjectedLow = false,
  troughImminent = false,
  leftoverCovers = false,
  smartMoneyConfirming = false,
} = {}) {
  const vars = {
    trough: !!(atMinTrough || nearProjectedLow || troughImminent),
    momentum: !!momentumEntry,
    prediction: !!predBuy,
    pullback: !!injectPullback,
    leftover: !!leftoverCovers,
    smartMoney: !!smartMoneyConfirming,
  };
  const hit = Object.entries(vars).filter(([, v]) => v).map(([k]) => k);
  return {
    count: hit.length,
    hit,
    vars,
  };
}

/**
 * Auto buy allowed only when alignment ≥ min AND at least one price-location
 * signal (trough / pullback / momentum / pred) is true. Leftover alone is not
 * enough to chase. Operator /buy bypasses this (caller responsibility).
 */
export function canExecuteNoLossCycle(alignment, {
  alignMin = DEFAULT_ALIGN_MIN,
  hasPriceSignal = false,
  armed = false,
  frozen = false,
  fallingFast = false,
} = {}) {
  const count = Number(alignment?.count) || 0;
  const min = Math.max(1, Number(alignMin) || DEFAULT_ALIGN_MIN);
  if (frozen || fallingFast || !armed) {
    return { allow: false, reason: frozen ? "frozen" : fallingFast ? "falling" : "not-armed", count, min };
  }
  if (!hasPriceSignal) {
    return { allow: false, reason: "no-price-signal", count, min };
  }
  if (count < min) {
    return { allow: false, reason: `align ${count}/${min}`, count, min };
  }
  return { allow: true, reason: `align ${count}/${min}`, count, min };
}

/**
 * Succession streak for a symbol — consecutive no-loss cycle completes.
 * Call `recordCycleResult` after each closed wave.
 */
export function createSuccessionTracker() {
  /** @type {Record<string, { streak: number, best: number, totalWins: number, totalLosses: number, lastAt: number }>} */
  const bySym = {};
  function state(symbol) {
    const s = String(symbol || "").toUpperCase();
    if (!bySym[s]) bySym[s] = { streak: 0, best: 0, totalWins: 0, totalLosses: 0, lastAt: 0 };
    return bySym[s];
  }
  function recordCycleResult(symbol, netUsd) {
    const st = state(symbol);
    const net = Number(netUsd);
    st.lastAt = Date.now();
    if (Number.isFinite(net) && net > 0) {
      st.streak += 1;
      st.totalWins += 1;
      if (st.streak > st.best) st.best = st.streak;
    } else {
      st.streak = 0;
      st.totalLosses += 1;
    }
    return { ...st };
  }
  function snapshot(symbol) {
    return { ...state(symbol) };
  }
  function all() {
    return Object.fromEntries(Object.entries(bySym).map(([k, v]) => [k, { ...v }]));
  }
  return { recordCycleResult, snapshot, all };
}

/**
 * Human line for Telegram /cycles — how many no-loss successions per coin.
 */
export function formatSuccessionReport(trackerAll = {}) {
  const rows = Object.entries(trackerAll || {})
    .map(([sym, s]) => ({
      sym,
      streak: s.streak || 0,
      best: s.best || 0,
      wins: s.totalWins || 0,
      losses: s.totalLosses || 0,
    }))
    .filter((r) => r.wins + r.losses > 0 || r.best > 0)
    .sort((a, b) => b.best - a.best || b.streak - a.streak);
  if (!rows.length) return "No closed cycles yet — waiting for first no-loss fill.";
  return rows
    .slice(0, 24)
    .map((r) => `${r.sym}: streak ${r.streak} (best ${r.best}) · ${r.wins}W/${r.losses}L`)
    .join("\n");
}
