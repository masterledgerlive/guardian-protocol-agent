// ═══════════════════════════════════════════════════════════════════════════════
// 🔑 GUARDIAN VAULT UNLOCK — Stage 1 secure boot
// ───────────────────────────────────────────────────────────────────────────────
// Railway holds NO password. Only tx hashes (locations on Base).
// At boot, bot sends Telegram message asking for your unlock password.
// You reply → bot decrypts all vault keys → password gone from memory.
// After UNLOCK_TTL (24h), memory clears → bot asks again next cycle.
// If no unlock within UNLOCK_TIMEOUT (5 min) → SAFE MODE (no trades).
//
// SAFE MODE: bot runs, monitors, sends alerts — but ZERO trades fire.
// This protects funds if bot restarts unexpectedly without you present.
//
// Commands:
//   /unlock [password]  → unlock vault (sent as a message, bot deletes immediately)
//   /lockdown           → manually clear password from memory right now
//   /unlockstatus       → show current unlock state + time remaining
// ═══════════════════════════════════════════════════════════════════════════════

// ── Unlock state ──────────────────────────────────────────────────────────────
let unlockState = {
  unlocked:    false,
  unlockedAt:  null,
  safeMode:    false,
  safeModeReason: null,
  passwordHash: null, // store hash only, never the real password
  waitingForPassword: false,
  bootRequestSent: false,
};

const UNLOCK_TTL     = 24 * 60 * 60 * 1000; // 24 hours
const UNLOCK_TIMEOUT =  5 * 60 * 1000;       // 5 minutes to respond at boot
const UNLOCK_WARN_AT =  1 * 60 * 60 * 1000; // warn 1 hour before expiry

import { createHash } from "crypto";

function hashPassword(pw) {
  return createHash("sha256").update(pw).digest("hex").slice(0, 16);
}

// ── Is the vault currently unlocked? ─────────────────────────────────────────
export function isUnlocked() {
  if (!unlockState.unlocked) return false;
  if (!unlockState.unlockedAt) return false;
  // Check TTL
  if (Date.now() - unlockState.unlockedAt > UNLOCK_TTL) {
    lockVault("24h session expired");
    return false;
  }
  return true;
}

// ── Is the bot in safe mode? ──────────────────────────────────────────────────
export function isSafeMode() {
  return unlockState.safeMode;
}

// ── Lock the vault ────────────────────────────────────────────────────────────
export function lockVault(reason = "manual") {
  unlockState.unlocked    = false;
  unlockState.unlockedAt  = null;
  unlockState.passwordHash = null;
  unlockState.safeMode    = true;
  unlockState.safeModeReason = reason;
  console.log("🔒 Vault locked: " + reason);
}

// ── Enter safe mode without locking ──────────────────────────────────────────
export function enterSafeMode(reason) {
  unlockState.safeMode       = true;
  unlockState.safeModeReason = reason;
  console.log("🛡️  Safe mode: " + reason);
}

export function exitSafeMode() {
  unlockState.safeMode       = false;
  unlockState.safeModeReason = null;
}

// ── Attempt to unlock with password ──────────────────────────────────────────
export async function attemptUnlock(password, loadVaultKeys) {
  try {
    // Temporarily set the password so vault-loader can use it
    process.env.DECRYPT_PASSWORD = password;

    // Load all vault keys from chain
    const result = await loadVaultKeys();

    // Password no longer needed in env — clear it immediately
    delete process.env.DECRYPT_PASSWORD;

    // Store a hash of the password (for re-unlock after TTL without re-fetching chain)
    unlockState.passwordHash = hashPassword(password);
    unlockState.unlocked     = true;
    unlockState.unlockedAt   = Date.now();
    unlockState.safeMode     = false;
    unlockState.safeModeReason = null;
    unlockState.waitingForPassword = false;

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("✅ VAULT UNLOCKED");
    console.log("   Keys loaded: " + result.fromChain + " from chain | " + result.fromRailway + " from Railway");
    console.log("   Session expires: " + new Date(Date.now() + UNLOCK_TTL).toLocaleString());
    console.log("   Password cleared from memory ✅");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    return { success: true, fromChain: result.fromChain, fromRailway: result.fromRailway };
  } catch (e) {
    delete process.env.DECRYPT_PASSWORD;
    console.log("❌ Unlock failed: " + e.message);
    return { success: false, error: e.message };
  }
}

// ── Get status message ────────────────────────────────────────────────────────
export function getUnlockStatusMessage() {
  if (!unlockState.unlocked) {
    return (
      "🔒 <b>VAULT STATUS — LOCKED</b>\n" +
      "━━━━━━━━━━━━━━━━━━━━\n" +
      (unlockState.safeMode
        ? "🛡️  Safe mode active: " + (unlockState.safeModeReason || "vault locked") + "\n"
        : "") +
      "\nSend: /unlock yourPassword\n" +
      "Bot will delete your message immediately."
    );
  }

  const elapsed   = Date.now() - unlockState.unlockedAt;
  const remaining = UNLOCK_TTL - elapsed;
  const hours     = Math.floor(remaining / 3600000);
  const mins      = Math.floor((remaining % 3600000) / 60000);

  return (
    "✅ <b>VAULT STATUS — UNLOCKED</b>\n" +
    "━━━━━━━━━━━━━━━━━━━━\n" +
    "⏱️  Session expires in: " + hours + "h " + mins + "m\n" +
    "🛡️  Safe mode: " + (unlockState.safeMode ? "ON — " + unlockState.safeModeReason : "OFF — trading active") + "\n\n" +
    "Commands:\n" +
    "/lockdown — lock vault immediately\n" +
    "/unlock [password] — re-unlock after expiry"
  );
}

// ── Time remaining warning ────────────────────────────────────────────────────
export function shouldWarnExpiry() {
  if (!unlockState.unlocked || !unlockState.unlockedAt) return false;
  const remaining = UNLOCK_TTL - (Date.now() - unlockState.unlockedAt);
  return remaining > 0 && remaining < UNLOCK_WARN_AT;
}

export function getExpiryWarningMessage() {
  const remaining = UNLOCK_TTL - (Date.now() - unlockState.unlockedAt);
  const mins = Math.floor(remaining / 60000);
  return (
    "⚠️ <b>VAULT EXPIRING IN " + mins + " MINUTES</b>\n" +
    "Send /unlock [password] to extend session 24h\n" +
    "If not unlocked, bot enters safe mode (no trades)"
  );
}

// ── Boot request — ask for password on startup ────────────────────────────────
export function markBootRequestSent() {
  unlockState.bootRequestSent    = true;
  unlockState.waitingForPassword = true;
  unlockState.bootRequestTime    = Date.now();
}

export function isWaitingForPassword() {
  return unlockState.waitingForPassword;
}

export function checkBootTimeout() {
  if (!unlockState.waitingForPassword) return false;
  if (!unlockState.bootRequestTime) return false;
  return Date.now() - unlockState.bootRequestTime > UNLOCK_TIMEOUT;
}

export { unlockState };
