// ═══════════════════════════════════════════════════════════════════════════════
// 🔐 GUARDIAN KEY VAULT — One-time encryption + on-chain inscription
// ───────────────────────────────────────────────────────────────────────────────
// Run this ONCE locally to encrypt your Telegram token and inscribe it on Base.
// After this, Railway only needs DECRYPT_PASSWORD + ENCRYPTED_KEY_TXHASH.
// The real token never lives in Railway or GitHub again.
//
// Usage:
//   node encryptkey.js
//
// Required env vars (set locally before running):
//   TELEGRAM_BOT_TOKEN  — the real token to encrypt and inscribe
//   DECRYPT_PASSWORD    — password you choose (save this — you'll need it in Railway)
//   CDP_API_KEY_ID      — your CDP key (to pay gas for the inscription tx)
//   CDP_API_KEY_SECRET  — your CDP secret
//   CDP_WALLET_SECRET   — your CDP wallet secret
// ═══════════════════════════════════════════════════════════════════════════════

import { CdpClient }   from "@coinbase/cdp-sdk";
import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";
import dotenv from "dotenv";
dotenv.config();

const WALLET_ADDRESS = "0x50e1C4608c48b0c52E1EA5FBabc1c9126eA17915";

// ── AES-256-GCM encryption ────────────────────────────────────────────────────
// GCM gives us authenticated encryption — tampering with the ciphertext is
// detectable. Salt + IV are random per encryption so same input = different output.

function deriveKey(password, salt) {
  // PBKDF2-style key derivation using SHA-256 — 32 bytes for AES-256
  return createHash("sha256")
    .update(password + salt)
    .digest();
}

function encrypt(plaintext, password) {
  const salt = randomBytes(16).toString("hex");       // 32 hex chars
  const iv   = randomBytes(12);                        // 12 bytes for GCM
  const key  = deriveKey(password, salt);

  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final()
  ]);
  const authTag = cipher.getAuthTag(); // 16 bytes — tamper detection

  // Pack everything into one base64 string: salt:iv:authTag:ciphertext
  const payload = [
    salt,
    iv.toString("hex"),
    authTag.toString("hex"),
    encrypted.toString("hex")
  ].join(":");

  return Buffer.from(payload).toString("base64");
}

function decrypt(base64payload, password) {
  const payload  = Buffer.from(base64payload, "base64").toString("utf8");
  const [salt, ivHex, authTagHex, encryptedHex] = payload.split(":");

  const key      = deriveKey(password, salt);
  const iv       = Buffer.from(ivHex, "hex");
  const authTag  = Buffer.from(authTagHex, "hex");
  const encrypted = Buffer.from(encryptedHex, "hex");

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final()
  ]);
  return decrypted.toString("utf8");
}

// ── Encode to hex calldata ────────────────────────────────────────────────────
function encodeInscription(text) {
  return "0x" + Buffer.from(text, "utf8").toString("hex");
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("🔐 GUARDIAN KEY VAULT — Encrypt + Inscribe");
  console.log("═══════════════════════════════════════════════════════════\n");

  // Validate inputs
  const telegramToken   = process.env.TELEGRAM_BOT_TOKEN;
  const decryptPassword = process.env.DECRYPT_PASSWORD;

  if (!telegramToken) {
    console.error("❌ TELEGRAM_BOT_TOKEN not set in env");
    process.exit(1);
  }
  if (!decryptPassword) {
    console.error("❌ DECRYPT_PASSWORD not set in env");
    console.error("   Choose a strong password and set it: export DECRYPT_PASSWORD=yourpassword");
    process.exit(1);
  }
  if (!process.env.CDP_API_KEY_ID) {
    console.error("❌ CDP keys not set — needed to pay gas for inscription tx");
    process.exit(1);
  }

  console.log(`🔑 Token to encrypt: ${telegramToken.slice(0, 10)}...${telegramToken.slice(-4)}`);
  console.log(`🔒 Password: ${"*".repeat(decryptPassword.length)}\n`);

  // Step 1: Encrypt
  console.log("⚙️  Encrypting with AES-256-GCM...");
  const ciphertext = encrypt(telegramToken, decryptPassword);
  console.log(`✅ Ciphertext: ${ciphertext.slice(0, 40)}...`);

  // Step 2: Verify decryption works before inscribing
  console.log("\n🔍 Verifying decrypt round-trip...");
  const verified = decrypt(ciphertext, decryptPassword);
  if (verified !== telegramToken) {
    console.error("❌ DECRYPT VERIFICATION FAILED — aborting inscription");
    process.exit(1);
  }
  console.log("✅ Decrypt verified — ciphertext is correct\n");

  // Step 3: Build inscription payload
  // Format: [VAULT:v1:TELEGRAM_BOT_TOKEN] <ciphertext>
  // The label tells the bot what this inscription contains when it fetches it
  const inscriptionText = `[VAULT:v1:TELEGRAM_BOT_TOKEN] ${ciphertext}`;
  const calldata = encodeInscription(inscriptionText);

  console.log(`📝 Inscription payload: ${inscriptionText.slice(0, 60)}...`);
  console.log(`📦 Calldata size: ${calldata.length / 2 - 1} bytes\n`);

  // Step 4: Send inscription tx to Base
  console.log("📡 Connecting to CDP...");
  const cdp = new CdpClient({
    apiKeyId:     process.env.CDP_API_KEY_ID,
    apiKeySecret: (process.env.CDP_API_KEY_SECRET || "").replace(/\\n/g, "\n"),
    walletSecret: process.env.CDP_WALLET_SECRET,
  });

  console.log("🚀 Sending inscription to Base blockchain...");
  try {
    const { transactionHash } = await cdp.evm.sendTransaction({
      address: WALLET_ADDRESS,
      network: "base",
      transaction: {
        to:    WALLET_ADDRESS,
        value: BigInt(0),
        data:  calldata,
      }
    });

    console.log("\n═══════════════════════════════════════════════════════════");
    console.log("✅ INSCRIPTION CONFIRMED ON BASE BLOCKCHAIN");
    console.log("═══════════════════════════════════════════════════════════");
    console.log(`\n🔗 TX Hash: ${transactionHash}`);
    console.log(`🌐 BaseScan: https://basescan.org/tx/${transactionHash}`);
    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("📋 ADD THESE TO RAILWAY ENV VARS:");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`DECRYPT_PASSWORD    = ${decryptPassword}`);
    console.log(`ENCRYPTED_KEY_TXHASH = ${transactionHash}`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("\n⚠️  AFTER ADDING THOSE TO RAILWAY:");
    console.log("   1. REMOVE TELEGRAM_BOT_TOKEN from Railway env vars");
    console.log("   2. The bot will fetch + decrypt it from Base on every boot");
    console.log("   3. The real token never lives in Railway again");
    console.log("\n💌 Eureka! VITA lives ♥ — ᛞᚨᚡᛁᛞ");

  } catch (e) {
    console.error(`\n❌ Inscription failed: ${e.message}`);
    console.error("   Check CDP keys and wallet balance for gas");
    process.exit(1);
  }
}

main().catch(e => {
  console.error(`💀 Fatal: ${e.message}`);
  process.exit(1);
});
