/**
 * VITA model cycle — round-robin across Anthropic model IDs so we can
 * compare answer quality without a code change. Railway `VITA_MODELS`
 * is a comma/space-separated list. First entry is the production default
 * already used by Guardian.
 *
 * Does not invent fills, hashes, or P&L. Telegram `/models` shows the ring.
 */

export const DEFAULT_VITA_MODEL_CYCLE = [
  "claude-sonnet-4-20250514",
  "claude-opus-4-20250514",
];

export function parseVitaModels(env = process.env) {
  const raw = String(env?.VITA_MODELS || "").trim();
  if (!raw) return [...DEFAULT_VITA_MODEL_CYCLE];
  const list = raw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  return list.length ? list : [...DEFAULT_VITA_MODEL_CYCLE];
}

let cursor = 0;

export function peekVitaModel(env = process.env) {
  const models = parseVitaModels(env);
  return models[cursor % models.length];
}

export function nextVitaModel(env = process.env) {
  const models = parseVitaModels(env);
  const index = cursor % models.length;
  const model = models[index];
  cursor = (cursor + 1) % models.length;
  return { model, index, cycle: models };
}

export function vitaModelStatus(env = process.env) {
  const cycle = parseVitaModels(env);
  return {
    current: cycle[cursor % cycle.length],
    index: cursor % cycle.length,
    cycle,
  };
}

export function resetVitaModelCursor() {
  cursor = 0;
}

export function vitaModelStatusMessage(env = process.env) {
  const st = vitaModelStatus(env);
  const lines = st.cycle.map((m, i) => `${i === st.index ? "→" : " "} ${i + 1}. ${m}`);
  return (
    `🧠 VITA MODEL CYCLE\n` +
    lines.join("\n") +
    `\nSet Railway VITA_MODELS=id1,id2 to change the ring.`
  );
}
