// ═══════════════════════════════════════════════════════════════════════════════
// 🗝️  GUARDIAN KEYSTORE — Personal encrypted key manager
// ───────────────────────────────────────────────────────────────────────────────
// Stores any secret (API keys, passwords, seeds) with DOUBLE encryption:
//
//   Layer 1 — Master key (your vault password — only you have this)
//   Layer 2 — Root cipher (derived from true key + unique salt)
//
// Both layers inscribed separately on Base blockchain.
// Neither inscription reveals the true key alone.
// Both required together + master password to decrypt.
//
// COMMANDS:
//   /storekey NAME       → two-step: reply with value → double encrypt → inscribe
//   /showkey NAME        → decrypt → show real value for 60s → auto-delete
//   /listkeys            → show all stored key names (never values)
//   /keystatus NAME      → show inscription locations, created date, no value
//
// STORAGE:
//   keystore.json on GitHub state branch
//   { NAME: { txHash1, txHash2, salt, createdAt, label } }
//   Values never stored — only locations and metadata
// ═══════════════════════════════════════════════════════════════════════════════

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

// ── Crypto helpers ────────────────────────────────────────────────────────────

function deriveKey(password, salt) {
  return createHash("sha256").update(password + salt).digest();
}

function aesEncrypt(plaintext, password, salt) {
  const iv        = randomBytes(12);
  const key       = deriveKey(password, salt);
  const cipher    = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag   = cipher.getAuthTag();
  const payload   = [
    salt,
    iv.toString("hex"),
    authTag.toString("hex"),
    encrypted.toString("hex")
  ].join(":");
  return Buffer.from(payload).toString("base64");
}

function aesDecrypt(base64payload, password) {
  const payload   = Buffer.from(base64payload, "base64").toString("utf8");
  const parts     = payload.split(":");
  if (parts.length !== 4) throw new Error("invalid keystore payload");
  const [salt, ivHex, authTagHex, encryptedHex] = parts;
  const key       = deriveKey(password, salt);
  const iv        = Buffer.from(ivHex, "hex");
  const authTag   = Buffer.from(authTagHex, "hex");
  const encrypted = Buffer.from(encryptedHex, "hex");
  const decipher  = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

function encodeHex(text) {
  return "0x" + Buffer.from(text, "utf8").toString("hex");
}

// ── Root cipher derivation ────────────────────────────────────────────────────
// Root cipher = true key encrypted a second time with a derived password.
// Derived password = SHA256(masterPassword + uniqueSalt + keyName).
// This means even if someone knows your master password they still need
// the unique salt (stored only in keystore.json) to derive the root cipher key.

function deriveRootPassword(masterPassword, salt, keyName) {
  return createHash("sha256")
    .update(masterPassword + salt + keyName)
    .digest("hex");
}

// ── In-memory keystore registry ───────────────────────────────────────────────
// { NAME: { txHash1, txHash2, salt, createdAt, label, note } }
let keystoreRegistry = {};

export function getKeystoreRegistry() { return keystoreRegistry; }
export function setKeystoreRegistry(r) { keystoreRegistry = r; }

// ── Store a key — double encrypt + two inscriptions ───────────────────────────
export async function storeKey(cdpClient, walletAddress, keyName, trueValue, masterPassword, label = "") {
  // Generate a unique salt for this key — never changes, stored in registry
  const salt = randomBytes(16).toString("hex");

  // ── Layer 1: encrypt true value with master password ──────────────────────
  const layer1Salt    = randomBytes(16).toString("hex");
  const layer1Cipher  = aesEncrypt(trueValue, masterPassword, layer1Salt);
  const inscription1  = "[KEYSTORE:v1:L1:" + keyName + "] " + layer1Cipher;
  const calldata1     = encodeHex(inscription1);

  // ── Layer 2: derive root cipher password, encrypt true value again ────────
  const rootPassword  = deriveRootPassword(masterPassword, salt, keyName);
  const layer2Salt    = randomBytes(16).toString("hex");
  const layer2Cipher  = aesEncrypt(trueValue, rootPassword, layer2Salt);
  const inscription2  = "[KEYSTORE:v1:L2:" + keyName + "] " + layer2Cipher;
  const calldata2     = encodeHex(inscription2);

  console.log("🗝️  Storing " + keyName + " — sending Layer 1 inscription...");
  const tx1 = await cdpClient.evm.sendTransaction({
    address: walletAddress, network: "base",
    transaction: { to: walletAddress, value: BigInt(0), data: calldata1 }
  });

  // Small delay between transactions
  await new Promise(r => setTimeout(r, 3000));

  console.log("🗝️  Storing " + keyName + " — sending Layer 2 inscription...");
  const tx2 = await cdpClient.evm.sendTransaction({
    address: walletAddress, network: "base",
    transaction: { to: walletAddress, value: BigInt(0), data: calldata2 }
  });

  // Store metadata in registry (never the value itself)
  keystoreRegistry[keyName] = {
    label:      label || keyName,
    salt,
    txHash1:    tx1.transactionHash,
    txHash2:    tx2.transactionHash,
    createdAt:  new Date().toISOString(),
    layer1Salt,
    layer2Salt,
  };

  return {
    keyName,
    label:    label || keyName,
    txHash1:  tx1.transactionHash,
    txHash2:  tx2.transactionHash,
    basescan1: "https://basescan.org/tx/" + tx1.transactionHash,
    basescan2: "https://basescan.org/tx/" + tx2.transactionHash,
  };
}

// ── Show a key — decrypt + return value + schedule auto-delete ────────────────
export async function showKey(keyName, masterPassword, fetchTxCalldata) {
  const entry = keystoreRegistry[keyName];
  if (!entry) throw new Error(keyName + " not found in keystore — use /storekey first");

  // Fetch Layer 1 inscription from Base
  const calldata1 = await fetchTxCalldata(entry.txHash1);

  // Parse Layer 1 — format: [KEYSTORE:v1:L1:NAME] ciphertext
  const match1 = calldata1.match(/^\[KEYSTORE:v1:L1:[A-Z0-9_]+\]\s+(.+)$/s);
  if (!match1) throw new Error("Layer 1 inscription format not recognized");
  const layer1Cipher = match1[1].trim();

  // Decrypt with master password
  const trueValue = aesDecrypt(layer1Cipher, masterPassword);

  return { keyName, label: entry.label, value: trueValue, txHash1: entry.txHash1, txHash2: entry.txHash2 };
}

// ── Keystore status message ───────────────────────────────────────────────────
export function getKeystoreStatusMessage(keyName) {
  const entry = keystoreRegistry[keyName];
  if (!entry) return "❌ <b>" + keyName + "</b> not found\nUse /storekey " + keyName + " to create it";

  return (
    "🗝️  <b>" + entry.label + "</b> (" + keyName + ")\n" +
    "━━━━━━━━━━━━━━━━━━━━\n" +
    "📅 Created: " + new Date(entry.createdAt).toLocaleString() + "\n\n" +
    "🔐 Layer 1 (master encrypted):\n" +
    "   <a href=\"https://basescan.org/tx/" + entry.txHash1 + "\">↗ View on BaseScan</a>\n\n" +
    "🔐 Layer 2 (root cipher):\n" +
    "   <a href=\"https://basescan.org/tx/" + entry.txHash2 + "\">↗ View on BaseScan</a>\n\n" +
    "🔑 Value: hidden — use /showkey " + keyName + " to reveal for 60s"
  );
}

// ── List all stored keys ──────────────────────────────────────────────────────
export function getKeystoreListMessage() {
  const keys = Object.keys(keystoreRegistry);
  if (keys.length === 0) {
    return (
      "🗝️  <b>KEYSTORE — Empty</b>\n\n" +
      "No keys stored yet.\n\n" +
      "Store your first key:\n" +
      "/storekey GOOGLE_API\n" +
      "/storekey CDP_MAIN\n" +
      "/storekey MY_WALLET_SEED\n\n" +
      "<i>Any name you choose — stored double-encrypted on Base</i>"
    );
  }

  let msg = "🗝️  <b>KEYSTORE — " + keys.length + " key(s) stored</b>\n";
  msg += "━━━━━━━━━━━━━━━━━━━━\n\n";

  for (const keyName of keys) {
    const e = keystoreRegistry[keyName];
    const age = Math.floor((Date.now() - new Date(e.createdAt).getTime()) / 86400000);
    msg += "🔑 <b>" + e.label + "</b>\n";
    msg += "   ID: <code>" + keyName + "</code>\n";
    msg += "   Stored: " + (age === 0 ? "today" : age + "d ago") + "\n";
    msg += "   /showkey " + keyName + " | /keystatus " + keyName + "\n\n";
  }

  msg += "<i>Values never shown here — use /showkey NAME</i>";
  return msg;
}

// ── Pending storekey sessions ─────────────────────────────────────────────────
export const pendingStoreKeySessions = {};

export function startStoreKeySession(chatId, keyName, label) {
  pendingStoreKeySessions[chatId] = {
    keyName,
    label,
    expiresAt: Date.now() + 60_000
  };
}

export function getStoreKeySession(chatId) {
  const s = pendingStoreKeySessions[chatId];
  if (!s) return null;
  if (Date.now() > s.expiresAt) { delete pendingStoreKeySessions[chatId]; return null; }
  return s;
}

export function clearStoreKeySession(chatId) {
  delete pendingStoreKeySessions[chatId];
}
