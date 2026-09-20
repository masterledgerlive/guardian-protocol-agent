/**
 * Isolated GRAFT Telegram — [GRAFT] cards, dedicated poller only.
 * SHARE_ROOT_ENV may send; it never polls the live bot token.
 */

import { GRAFT_TAG, telegramBotToken, telegramChatId, telegramConfigured, shouldPollTelegram, pollOffsetPath } from "./config.js";
import { dispatchGraftCommand } from "./commands.js";
import fs from "node:fs";
import path from "node:path";

export function prefixGraft(text) {
  const raw = String(text ?? "");
  if (raw.startsWith(GRAFT_TAG)) return raw;
  const body = raw.replace(/^\n+/, "");
  return body ? `${GRAFT_TAG}\n${body}` : GRAFT_TAG;
}

export async function sendGraftTelegram(text, { fetchImpl = globalThis.fetch, prefix = true } = {}) {
  const body = prefix === false ? String(text ?? "") : prefixGraft(text);
  const tok = telegramBotToken();
  const cid = telegramChatId();
  if (!tok || !cid) {
    return { sent: false, reason: "missing-credentials", text: body };
  }
  if (typeof fetchImpl !== "function") {
    return { sent: false, reason: "no-fetch", text: body };
  }
  try {
    const res = await fetchImpl(`https://api.telegram.org/bot${String(tok).trim()}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: String(cid).trim(),
        text: body,
        parse_mode: "HTML",
      }),
    });
    const data = typeof res?.json === "function" ? await res.json() : res;
    if (!data?.ok) {
      return { sent: false, reason: data?.description || "send-failed", text: body };
    }
    return { sent: true, text: body };
  } catch (err) {
    return { sent: false, reason: err?.message || "error", text: body };
  }
}

function readOffset() {
  try {
    const j = JSON.parse(fs.readFileSync(pollOffsetPath(), "utf8"));
    return Number(j.offset) || 0;
  } catch {
    return 0;
  }
}

function writeOffset(offset) {
  fs.mkdirSync(path.dirname(pollOffsetPath()), { recursive: true });
  fs.writeFileSync(pollOffsetPath(), JSON.stringify({ offset }, null, 2));
}

function allowedChat(chatId) {
  const want = telegramChatId();
  if (!want) return true;
  return String(chatId) === String(want);
}

export async function handleTelegramUpdate(update, { send = sendGraftTelegram } = {}) {
  const msg = update?.message || update?.edited_message;
  if (!msg) return { handled: false };
  if (!allowedChat(msg.chat?.id)) return { handled: false, reason: "chat-filter" };
  const text = String(msg.text || msg.caption || "");
  if (!/^\/graft/i.test(text.trim())) return { handled: false };
  const replyText = msg.reply_to_message?.text || msg.reply_to_message?.caption || "";
  const result = dispatchGraftCommand(text, {
    replyText,
    source: "telegram",
  });
  if (result.html) await send(result.html);
  return { handled: true, result };
}

export async function pollOnce({ fetchImpl = globalThis.fetch, send = sendGraftTelegram } = {}) {
  if (!shouldPollTelegram()) {
    return { polled: false, reason: "no-dedicated-token" };
  }
  const tok = telegramBotToken();
  const offset = readOffset();
  const url = `https://api.telegram.org/bot${String(tok).trim()}/getUpdates?offset=${offset}&timeout=20`;
  const res = await fetchImpl(url);
  const data = typeof res?.json === "function" ? await res.json() : res;
  if (!data?.ok) return { polled: true, error: data?.description || "getUpdates-failed" };
  const updates = data.result || [];
  let handled = 0;
  let last = offset;
  for (const u of updates) {
    last = (u.update_id || 0) + 1;
    const r = await handleTelegramUpdate(u, { send });
    if (r.handled) handled += 1;
  }
  if (updates.length) writeOffset(last);
  return { polled: true, updates: updates.length, handled };
}

export { telegramConfigured, shouldPollTelegram };
