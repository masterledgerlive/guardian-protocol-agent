// ═══════════════════════════════════════════════════════════════════════════════
// 🔐 GUARDIAN VAULT — Multi-key manager with Railway primary + blockchain fallback
// ───────────────────────────────────────────────────────────────────────────────
//
// FALLBACK CHAIN per key:
//   1. Railway env var (primary — instant, always checked first)
//   2. Blockchain inscription (fallback — fetched + decrypted if Railway missing)
//   3. Logged error, bot keeps running on whatever keys it has
//
// VAULT REGISTRY in Railway:
//   DECRYPT_PASSWORD           — master password for all vault keys
//   VAULT_TELEGRAM_BOT_TOKEN   — tx hash of encrypted TELEGRAM_BOT_TOKEN on Base
//   VAULT_CDP_API_KEY_ID       — tx hash of encrypted CDP_API_KEY_ID on Base
//   VAULT_CDP_API_KEY_SECRET   — tx hash of encrypted CDP_API_KEY_SECRET on Base
//   VAULT_CDP_WALLET_SECRET    — tx hash of encrypted CDP_WALLET_SECRET on Base
//   VAULT_GITHUB_TOKEN         — tx hash of encrypted GITHUB_TOKEN on Base
//
// Pattern: if real key missing from Railway, check VAULT_<KEYNAME> for tx hash
// and fetch + decrypt from Base blockchain automatically.
//
// TELEGRAM COMMANDS:
//   /newvault KEYNAME    — two-step: bot prompts, you reply with value privately
//   /vaultstatus         — show all keys: source + tx hash
//   /vaulttest KEYNAME   — decrypt + show preview (first 6 + last 4 chars only)
//   /vaultload KEYNAME   — force reload from chain right now
// ═══════════════════════════════════════════════════════════════════════════════

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

// ── AES-256-GCM crypto ────────────────────────────────────────────────────────

function deriveKey(password, salt) {
  return createHash("sha256").update(password + salt).digest();
}

export function vaultEncrypt(plaintext, password) {
  const salt      = randomBytes(16).toString("hex");
  const iv        = randomBytes(12);
  const key       = deriveKey(password, salt);
  const cipher    = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag   = cipher.getAuthTag();
  const payload   = [salt, iv.toString("hex"), authTag.toString("hex"), encrypted.toString("hex")].join(":");
  return Buffer.from(payload).toString("base64");
}

export function vaultDecrypt(base64payload, password) {
  const payload   = Buffer.from(base64payload, "base64").toString("utf8");
  const parts     = payload.split(":");
  if (parts.length !== 4) throw new Error("invalid vault payload format");
  const [salt, ivHex, authTagHex, encryptedHex] = parts;
  const key       = deriveKey(password, salt);
  const iv        = Buffer.from(ivHex, "hex");
  const authTag   = Buffer.from(authTagHex, "hex");
  const encrypted = Buffer.from(encryptedHex, "hex");
  const decipher  = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

// ── Calldata encoding ─────────────────────────────────────────────────────────

export function encodeVaultInscription(keyName, ciphertext) {
  const text = "[VAULT:v1:" + keyName + "] " + ciphertext;
  return { text, hex: "0x" + Buffer.from(text, "utf8").toString("hex") };
}

// ── BaseScan fetcher ──────────────────────────────────────────────────────────

export async function fetchTxCalldata(txHash) {
  // Try BaseScan API first
  try {
    const url = "https://api.basescan.org/api?module=proxy&action=eth_getTransactionByHash&txhash=" + txHash;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (res.ok) {
      const data = await res.json();
      const hex  = data?.result?.input;
      if (hex && hex !== "0x") return Buffer.from(hex.slice(2), "hex").toString("utf8");
    }
  } catch {}
  // Fallback: direct RPC
  try {
    const res = await fetch("https://mainnet.base.org", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc:"2.0", id:1, method:"eth_getTransactionByHash", params:[txHash] }),
      signal: AbortSignal.timeout(10_000)
    });
    if (res.ok) {
      const data = await res.json();
      const hex  = data?.result?.input;
      if (hex && hex !== "0x") return Buffer.from(hex.slice(2), "hex").toString("utf8");
    }
  } catch {}
  throw new Error("Could not fetch tx " + txHash.slice(0,10) + "... from chain");
}

function parseVaultInscription(text) {
  const match = text.match(/^\[VAULT:v1:([A-Z0-9_]+)\]\s+(.+)$/s);
  if (!match) throw new Error("vault inscription format not recognized");
  return { keyName: match[1], ciphertext: match[2].trim() };
}

// ── Vault registry ────────────────────────────────────────────────────────────
export const vaultRegistry = {};

const MANAGED_KEYS = [
  "TELEGRAM_BOT_TOKEN",
  "CDP_API_KEY_ID",
  "CDP_API_KEY_SECRET",
  "CDP_WALLET_SECRET",
  "GITHUB_TOKEN",
];

// ── Load one key — Railway primary, blockchain fallback ───────────────────────
async function loadOneKey(keyName, password) {
  if (process.env[keyName]) {
    vaultRegistry[keyName] = { source: "railway", loaded: true, txHash: null };
    console.log("   ✅ " + keyName + ": Railway env var (primary)");
    return true;
  }
  const txHash = process.env["VAULT_" + keyName];
  if (!txHash) {
    vaultRegistry[keyName] = { source: "missing", loaded: false, txHash: null };
    console.log("   ⚪ " + keyName + ": not set");
    return false;
  }
  if (!password) {
    vaultRegistry[keyName] = { source: "error", loaded: false, txHash, error: "DECRYPT_PASSWORD not set" };
    console.log("   ❌ " + keyName + ": vault hash found but DECRYPT_PASSWORD missing");
    return false;
  }
  try {
    console.log("   🔗 " + keyName + ": fetching from Base blockchain...");
    const calldata       = await fetchTxCalldata(txHash);
    const { ciphertext } = parseVaultInscription(calldata);
    const plaintext      = vaultDecrypt(ciphertext, password);
    process.env[keyName] = plaintext;
    vaultRegistry[keyName] = { source: "blockchain", loaded: true, txHash };
    console.log("   ✅ " + keyName + ": loaded from chain (" + plaintext.slice(0,6) + "..." + plaintext.slice(-4) + ")");
    return true;
  } catch (e) {
    vaultRegistry[keyName] = { source: "error", loaded: false, txHash, error: e.message };
    console.log("   ❌ " + keyName + ": " + e.message);
    return false;
  }
}

// ── Boot loader ───────────────────────────────────────────────────────────────
export async function loadVaultKeys() {
  const password = process.env.DECRYPT_PASSWORD;
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("🔐 GUARDIAN VAULT — loading keys");
  console.log("   Password: " + (password ? "✅ set" : "⚪ not set (blockchain fallback disabled)"));
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  let fromChain = 0, fromRailway = 0, missing = 0;
  for (const keyName of MANAGED_KEYS) {
    await loadOneKey(keyName, password);
    const r = vaultRegistry[keyName];
    if (!r?.loaded)               missing++;
    else if (r.source==="railway") fromRailway++;
    else                           fromChain++;
  }

  console.log("\n   📊 " + fromRailway + " from Railway | " + fromChain + " from blockchain | " + missing + " missing");

  if (fromChain > 0) {
    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("📡 VAULT READ RECEIPT — keys retrieved from Base blockchain");
    for (const [k, v] of Object.entries(vaultRegistry)) {
      if (v.source === "blockchain") {
        console.log("   ✅ " + k);
        console.log("      📍 https://basescan.org/tx/" + v.txHash);
      }
    }
    console.log("   💌 Eureka! VITA lives ♥ — ᛞᚨᚡᛁᛞ — The truth is the chain.");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  } else {
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  }

  return { fromRailway, fromChain, missing, registry: vaultRegistry };
}

// ── /vaultstatus message ──────────────────────────────────────────────────────
export function getVaultStatusMessage() {
  let msg = "🔐 <b>VAULT STATUS</b>\n━━━━━━━━━━━━━━━━━━━━\n\n";
  for (const keyName of MANAGED_KEYS) {
    const v = vaultRegistry[keyName];
    if (!v)                        { msg += "⚪ <b>" + keyName + "</b> — not checked\n\n"; continue; }
    if (v.source === "railway")    { msg += "✅ <b>" + keyName + "</b>\n   📦 Railway env var\n\n"; }
    else if (v.source === "blockchain") {
      msg += "🔗 <b>" + keyName + "</b>\n   📍 Base blockchain\n";
      msg += "   <a href=\"https://basescan.org/tx/" + v.txHash + "\">View inscription ↗</a>\n\n";
    }
    else if (v.source === "missing") { msg += "⚪ <b>" + keyName + "</b> — not set\n\n"; }
    else { msg += "❌ <b>" + keyName + "</b> — failed\n   " + (v.error||"") + "\n\n"; }
  }
  msg += "<i>/newvault KEYNAME — encrypt + inscribe on Base\n/vaulttest KEYNAME — verify a key loaded\n/vaultload KEYNAME — reload from chain</i>";
  return msg;
}

// ── /vaulttest KEYNAME message ────────────────────────────────────────────────
export function getVaultTestMessage(keyName) {
  const val = process.env[keyName];
  if (!val) return "❌ <b>" + keyName + "</b> not in memory — not loaded";
  const preview = val.slice(0,6) + "..." + val.slice(-4);
  const v = vaultRegistry[keyName] || { source: "unknown" };
  return (
    "✅ <b>" + keyName + "</b> loaded\n" +
    "🔑 Preview: <code>" + preview + "</code>\n" +
    "📦 Source: " + v.source + "\n" +
    (v.txHash ? "📍 <a href=\"https://basescan.org/tx/" + v.txHash + "\">Inscription ↗</a>" : "")
  );
}

// ── /vaultload KEYNAME — force reload ─────────────────────────────────────────
export async function vaultForceReload(keyName) {
  const password = process.env.DECRYPT_PASSWORD;
  if (!password) throw new Error("DECRYPT_PASSWORD not set");
  const txHash = process.env["VAULT_" + keyName];
  if (!txHash)   throw new Error("VAULT_" + keyName + " not set in Railway");
  const calldata       = await fetchTxCalldata(txHash);
  const { ciphertext } = parseVaultInscription(calldata);
  const plaintext      = vaultDecrypt(ciphertext, password);
  process.env[keyName] = plaintext;
  vaultRegistry[keyName] = { source: "blockchain", loaded: true, txHash };
  return { keyName, txHash, preview: plaintext.slice(0,6) + "..." + plaintext.slice(-4) };
}

// ── /newvault two-step session ────────────────────────────────────────────────
export const pendingVaultSessions = {};

export function startVaultSession(chatId, keyName) {
  pendingVaultSessions[chatId] = { keyName, expiresAt: Date.now() + 60_000 };
}
export function getVaultSession(chatId) {
  const s = pendingVaultSessions[chatId];
  if (!s) return null;
  if (Date.now() > s.expiresAt) { delete pendingVaultSessions[chatId]; return null; }
  return s;
}
export function clearVaultSession(chatId) {
  delete pendingVaultSessions[chatId];
}

// ── Encrypt + inscribe from Telegram ─────────────────────────────────────────
export async function vaultEncryptAndInscribe(cdpClient, walletAddress, keyName, plaintext) {
  const password = process.env.DECRYPT_PASSWORD;
  if (!password) throw new Error("DECRYPT_PASSWORD not set — add it to Railway first");

  const ciphertext = vaultEncrypt(plaintext, password);
  // Verify round-trip before spending gas
  if (vaultDecrypt(ciphertext, password) !== plaintext) throw new Error("encrypt verify failed");

  const { hex } = encodeVaultInscription(keyName, ciphertext);
  const { transactionHash } = await cdpClient.evm.sendTransaction({
    address: walletAddress, network: "base",
    transaction: { to: walletAddress, value: BigInt(0), data: hex }
  });

  process.env[keyName] = plaintext;
  vaultRegistry[keyName] = { source: "blockchain", loaded: true, txHash: transactionHash };

  return {
    txHash:      transactionHash,
    keyName,
    vaultEnvKey: "VAULT_" + keyName,
    basescan:    "https://basescan.org/tx/" + transactionHash,
  };
}
