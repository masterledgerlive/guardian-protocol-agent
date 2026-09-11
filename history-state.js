/**
 * Price-history / wave-state maps must always have their arrays.
 *
 * After SKIP_OHLC_SEED (#72), boot quotes can create
 *   history[symbol] = { lastPrice }
 * with no `readings`. processToken → recordPrice then throws
 *   Cannot read properties of undefined (reading 'push')
 * for every token (AERO / DRB / BNKR / …) and OPERATOR_BUY never reaches executeBuy.
 *
 * Same hole if GitHub history.json is empty/unreadable or a token row is lastPrice-only.
 * These helpers initialize missing arrays so .push is always safe.
 */

export function ensureHistoryEntry(history, symbol, seed = {}) {
  if (!history || typeof history !== "object") {
    throw new TypeError("ensureHistoryEntry requires a history object");
  }
  const key = String(symbol || "");
  if (!key) return null;
  let cur = history[key];
  if (!cur || typeof cur !== "object" || Array.isArray(cur)) {
    cur = { readings: [], lastPrice: seed.lastPrice ?? null };
    history[key] = cur;
  }
  if (!Array.isArray(cur.readings)) cur.readings = [];
  if (cur.lastPrice == null && seed.lastPrice != null) cur.lastPrice = seed.lastPrice;
  return cur;
}

export function normalizeHistoryMap(history) {
  if (!history || typeof history !== "object") return {};
  for (const key of Object.keys(history)) ensureHistoryEntry(history, key);
  return history;
}

/**
 * Same contract as agent.js recordPrice (minus the USD gate).
 * Always ensures readings[] before push — the live #72 crash path.
 */
export function recordPriceOnHistory(history, symbol, price, now = Date.now()) {
  const h = ensureHistoryEntry(history, symbol);
  h.readings.push({ price, time: now });
  if (h.readings.length > 2000) h.readings.shift();
  h.lastPrice = price;
  return h;
}

export function ensureWaveStateEntry(waveState, symbol) {
  if (!waveState || typeof waveState !== "object") {
    throw new TypeError("ensureWaveStateEntry requires a waveState object");
  }
  const key = String(symbol || "");
  if (!key) return null;
  let ws = waveState[key];
  if (!ws || typeof ws !== "object" || Array.isArray(ws)) {
    ws = { peaks: [], troughs: [], peakScores: [], troughScores: [] };
    waveState[key] = ws;
  }
  if (!Array.isArray(ws.peaks)) ws.peaks = [];
  if (!Array.isArray(ws.troughs)) ws.troughs = [];
  if (!Array.isArray(ws.peakScores)) ws.peakScores = [];
  if (!Array.isArray(ws.troughScores)) ws.troughScores = [];
  return ws;
}
