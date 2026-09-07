/**
 * Chain is the ledger. Telegram numbers and cost basis must come from
 * a successful RPC ping (or last successful ping), never a silent 0 and
 * never a live mark invented as "what we paid."
 */

const TELEGRAM_HTML_TAG = /<\/?(?:b|i|u|s|code|pre|a|tg-spoiler)(?:\s[^>]*)?>/gi;

export const UNKNOWN_COST_BASIS_LABEL = "unknown cost basis — chain balance is truth";

export function escapeTelegramHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Keep real Telegram HTML tags; escape stray `<` / `>` that cause
 * "can't parse entities" (empty start tag, unclosed <b>).
 */
export function sanitizeTelegramHtml(msg) {
  const s = String(msg ?? "");
  const tags = [];
  const protectedMsg = s.replace(TELEGRAM_HTML_TAG, (m) => {
    tags.push(m);
    return `\u0000${tags.length - 1}\u0000`;
  });
  const escaped = protectedMsg
    .replace(/&(?!(?:amp|lt|gt|quot|#\d+|#x[\da-f]+);)/gi, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped.replace(/\u0000(\d+)\u0000/g, (_, i) => tags[Number(i)] || "");
}

/** Split Telegram HTML so a tag is never cut across the 4096-char limit. */
export function splitTelegramHtmlChunks(msg, maxLen = 4000) {
  const text = String(msg ?? "");
  if (text.length <= maxLen) return [text];
  const chunks = [];
  let rest = text;
  while (rest.length > maxLen) {
    let cut = rest.lastIndexOf("\n", maxLen);
    if (cut < Math.floor(maxLen * 0.5)) cut = maxLen;
    while (cut > 0 && htmlCutWouldSplitTag(rest.slice(0, cut))) {
      const lastLt = rest.lastIndexOf("<", cut - 1);
      if (lastLt <= 0) break;
      cut = lastLt;
    }
    if (cut <= 0) cut = maxLen;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest) chunks.push(rest);
  return chunks;
}

function htmlCutWouldSplitTag(slice) {
  const lastLt = slice.lastIndexOf("<");
  const lastGt = slice.lastIndexOf(">");
  if (lastLt > lastGt) return true;
  const opens = (slice.match(/<(b|i|u|s|code|pre|a|tg-spoiler)\b/gi) || []).length;
  const closes = (slice.match(/<\/(b|i|u|s|code|pre|a|tg-spoiler)>/gi) || []).length;
  return opens > closes;
}

export function decodeErc20Balance(raw, decimals) {
  const d = Number(decimals);
  const dec = Number.isFinite(d) && d >= 0 && d <= 36 ? d : 18;
  const n = typeof raw === "bigint" ? Number(raw) : Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n / Math.pow(10, dec);
}

/**
 * A failed balanceOf / eth_getBalance must not become 0.
 * Keep the last successful ping; if there is none, throw so callers
 * cannot treat "RPC down" as "wallet empty."
 */
export function resolveFailedBalanceRead({ error, lastKnown, label = "balance" } = {}) {
  if (Number.isFinite(lastKnown) && lastKnown >= 0) {
    return {
      ok: false,
      stale: true,
      balance: lastKnown,
      log: `${label} RPC failed — keeping last chain ping ${lastKnown}`,
      error,
    };
  }
  const err = error instanceof Error ? error : new Error(String(error || `${label} RPC failed`));
  err.ledger = "not-zero";
  throw err;
}

export function operatorBuySkipTelegram(symbol, detail) {
  const sym = escapeTelegramHtml(symbol || "?");
  const why = escapeTelegramHtml(String(detail || "buy skipped").replace(/^\s+/, ""));
  return (
    `⚠️ <b>${sym} BUY SKIPPED</b>\n` +
    `${why}\n` +
    `Nothing sent. No Basescan receipt.`
  );
}

export function operatorBuyQueuedTelegram(symbol, usd) {
  const sym = escapeTelegramHtml(symbol || "?");
  const size = Number(usd) > 0 ? `\n💵 Size: $${Number(usd)}` : "";
  return (
    `📱 <b>BUY ${sym} queued</b>${size}\n` +
    `Will send or report the exact skip reason + Basescan receipt if mined.`
  );
}

export function unknownCostBasisLine(symbol, units, usdNow) {
  const u = Number(units);
  const shown = Number.isFinite(u)
    ? (u >= 1 ? u.toFixed(2) : u.toFixed(6))
    : "?";
  const usd = Number.isFinite(Number(usdNow)) ? ` ≈ $${Number(usdNow).toFixed(2)}` : "";
  return `${symbol || "?"}: ${shown} on-chain${usd} — ${UNKNOWN_COST_BASIS_LABEL}`;
}
