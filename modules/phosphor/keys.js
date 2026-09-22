/**
 * PHOSPHOR keys.
 * Open: PHOSOPEN is pre-embedded and derived from name + payload hash.
 *       Anyone can unwrap. It is not a wallet secret.
 * Lock: AES-256-GCM. The passphrase never enters the header.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { sha256Hex } from "./codec.js";

export function openKeyMaterial(name, payloadHash) {
  return sha256Hex(`PHOSPHOR-OPEN-v1\n${name}\n${payloadHash}`).slice(0, 16);
}

export function openKeyMeta(name, payloadHash) {
  return "open:PHOSOPEN|" + openKeyMaterial(name, payloadHash);
}

export function displayOpenKey(keyMeta) {
  const raw = String(keyMeta || "");
  return raw.startsWith("open:") ? raw.slice(5) : raw;
}

export function assertOpenKey(header) {
  const expect = openKeyMeta(header.name, header.payloadHash);
  if (header.keyMeta !== expect) {
    throw new Error("open key mismatch — header was not pre-embedded for this payload");
  }
  return displayOpenKey(expect);
}

function deriveLockKey(saltHex, passphrase) {
  const salt = Buffer.from(saltHex, "hex");
  return createHash("sha256")
    .update(Buffer.concat([salt, Buffer.from(String(passphrase), "utf8")]))
    .digest();
}

export function lockBytes(plain, passphrase) {
  if (!String(passphrase || "").length) throw new Error("lock passphrase required");
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = deriveLockKey(salt.toString("hex"), passphrase);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const bytes = Buffer.concat([cipher.update(plain), cipher.final()]);
  return {
    bytes,
    lock: {
      salt: salt.toString("hex"),
      iv: iv.toString("hex"),
      tag: cipher.getAuthTag().toString("hex"),
    },
  };
}

export function unlockBytes(stored, lock, passphrase) {
  if (!String(passphrase || "").length) {
    throw new Error("lock key required to unwrap blockchain data");
  }
  const key = deriveLockKey(lock.salt, passphrase);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(lock.iv, "hex"));
  decipher.setAuthTag(Buffer.from(lock.tag, "hex"));
  return Buffer.concat([decipher.update(stored), decipher.final()]);
}
