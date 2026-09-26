/**
 * GRAFT offshoot — isolated from VITA and root agent.js.
 * Separate process, state dir, and GRAFT_* env prefix.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const GRAFT_ROOT = __dirname;
export const MEMORY_DIR = path.join(__dirname, "memory");
export const DEFAULT_STATE_DIR = path.join(__dirname, "state");
export const ENV_PREFIX = "GRAFT_";
export const GRAFT_TAG = "[GRAFT]";
export const SHORT_TAG_PREFIX = "§GRAFT§";

export function env(name, fallback = undefined) {
  const keyed = process.env[`${ENV_PREFIX}${name}`];
  if (keyed != null && keyed !== "") return keyed;
  if (process.env.GRAFT_SHARE_ROOT_ENV === "yes") {
    const v = process.env[name];
    if (v != null && v !== "") return v;
  }
  return fallback;
}

function firstNonEmpty(...values) {
  for (const v of values) {
    if (v != null && String(v) !== "") return v;
  }
  return undefined;
}

/** VAULT_* holds a Base tx hash of ciphertext — never a live Telegram bot token. */
export function looksLikeVaultTxHash(value) {
  return /^0x[a-fA-F0-9]{64}$/.test(String(value ?? "").trim());
}

function usableTelegramSecret(value) {
  if (value == null || String(value) === "") return undefined;
  if (looksLikeVaultTxHash(value)) return undefined;
  return value;
}

/**
 * Prefer GRAFT_TELEGRAM_BOT_TOKEN.
 * SHARE_ROOT_ENV=yes may send via plaintext TELEGRAM_BOT_TOKEN.
 * Never treat VAULT_TELEGRAM_BOT_TOKEN (tx hash) as the bot token.
 */
export function telegramBotToken() {
  const preferred = usableTelegramSecret(env("TELEGRAM_BOT_TOKEN"));
  if (process.env.GRAFT_TELEGRAM_BOT_TOKEN) return preferred;
  if (process.env.GRAFT_SHARE_ROOT_ENV === "yes") {
    return firstNonEmpty(
      preferred,
      usableTelegramSecret(process.env.TELEGRAM_BOT_TOKEN),
    );
  }
  return preferred;
}

export function telegramChatId() {
  const preferred = usableTelegramSecret(env("TELEGRAM_CHAT_ID"));
  if (process.env.GRAFT_TELEGRAM_CHAT_ID) return preferred;
  if (process.env.GRAFT_SHARE_ROOT_ENV === "yes") {
    return firstNonEmpty(
      preferred,
      usableTelegramSecret(process.env.TELEGRAM_CHAT_ID),
    );
  }
  return preferred;
}

/** Poll getUpdates only with a dedicated GRAFT bot — never steal V3 updates. */
export function shouldPollTelegram() {
  return !!usableTelegramSecret(process.env.GRAFT_TELEGRAM_BOT_TOKEN);
}

export function telegramConfigured() {
  return !!(telegramBotToken() && telegramChatId());
}

export const DRY_RUN = String(env("DRY_RUN", "yes")).toLowerCase() !== "no";
export const THINK_FREE = String(env("THINK_FREE", "no")).toLowerCase() === "yes";
export const THINK_COST_ETH = Number(env("THINK_COST_ETH", "0.00001")) || 0.00001;

export function stateDir() {
  const override = process.env.GRAFT_STATE_DIR;
  if (override && String(override).trim()) return path.resolve(String(override).trim());
  return DEFAULT_STATE_DIR;
}

export function casDir() {
  return path.join(stateDir(), "cas");
}

export function thoughtsDir() {
  return path.join(stateDir(), "thoughts");
}

export function ledgerPath() {
  return path.join(stateDir(), "ledger.json");
}

export function pollOffsetPath() {
  return path.join(stateDir(), "telegram-offset.json");
}

export const FUND_TO = env("FUND_TO", "");
