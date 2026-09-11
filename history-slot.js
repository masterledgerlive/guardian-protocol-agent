/**
 * Price-history / wave slots used by processToken.
 *
 * After SKIP_OHLC_SEED the 90-day seed never writes
 * `history[symbol] = { readings: [], lastPrice }`. Boot quotes / recon then
 * pin `{ lastPrice }` only. `recordPrice` used to assume readings existed
 * and throw `Cannot read properties of undefined (reading 'push')` on
 * AERO and every other quoted token.
 *
 * Same class of hole: waveState / watchlist objects missing their arrays.
 * Never invent prices or P&L — only guarantee containers exist.
 */

export function ensureArray(obj, key) {
  if (!obj || typeof obj !== "object") return [];
  if (!Array.isArray(obj[key])) obj[key] = [];
  return obj[key];
}

/**
 * Guarantee `history[symbol].readings` is an array.
 * Preserves lastPrice / candles / existing readings.
 */
export function ensureHistorySlot(history, symbol) {
  const map = history && typeof history === "object" ? history : {};
  const key = String(symbol || "");
  if (!key) return { readings: [], lastPrice: null };
  const prev = map[key] && typeof map[key] === "object" && !Array.isArray(map[key])
    ? map[key]
    : {};
  if (!Array.isArray(prev.readings)) prev.readings = [];
  if (!Object.prototype.hasOwnProperty.call(prev, "lastPrice")) prev.lastPrice = null;
  map[key] = prev;
  return prev;
}

/** Hydrate every key after GitHub load / skip-seed so live ticks cannot throw. */
export function hydrateHistoryMap(history) {
  const map = history && typeof history === "object" ? history : {};
  for (const key of Object.keys(map)) ensureHistorySlot(map, key);
  return map;
}

/**
 * Same contract as agent `recordPrice` minus the USD-validity gate
 * (caller already checked). Safe when the slot is lastPrice-only.
 */
export function recordPriceInto(history, symbol, price, now = Date.now()) {
  const slot = ensureHistorySlot(history, symbol);
  slot.readings.push({ price, time: now });
  if (slot.readings.length > 2000) slot.readings.shift();
  slot.lastPrice = price;
  return slot;
}

export function ensureWaveSlot(waveState, symbol) {
  const map = waveState && typeof waveState === "object" ? waveState : {};
  const key = String(symbol || "");
  if (!key) return { peaks: [], troughs: [], peakScores: [], troughScores: [] };
  const prev = map[key] && typeof map[key] === "object" && !Array.isArray(map[key])
    ? map[key]
    : {};
  if (!Array.isArray(prev.peaks)) prev.peaks = [];
  if (!Array.isArray(prev.troughs)) prev.troughs = [];
  if (!Array.isArray(prev.peakScores)) prev.peakScores = [];
  if (!Array.isArray(prev.troughScores)) prev.troughScores = [];
  map[key] = prev;
  return prev;
}

export function ensureWatchSlot(watchPrices, symbol) {
  const map = watchPrices && typeof watchPrices === "object" ? watchPrices : {};
  const key = String(symbol || "");
  if (!key) return { prices: [], peaks: [], troughs: [], high24h: 0, low24h: Infinity };
  const prev = map[key] && typeof map[key] === "object" && !Array.isArray(map[key])
    ? map[key]
    : {};
  if (!Array.isArray(prev.prices)) prev.prices = [];
  if (!Array.isArray(prev.peaks)) prev.peaks = [];
  if (!Array.isArray(prev.troughs)) prev.troughs = [];
  if (!Number.isFinite(prev.high24h)) prev.high24h = 0;
  if (!Number.isFinite(prev.low24h)) prev.low24h = Infinity;
  map[key] = prev;
  return prev;
}
