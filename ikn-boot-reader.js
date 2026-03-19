/**
 * ikn-boot-reader.js
 * IKN Filing Protocol v1.0
 * Uses fetch only — no external dependencies beyond what Guardian already has
 */

import crypto from 'crypto';

const GITHUB_TOKEN     = process.env.GITHUB_TOKEN;
const GITHUB_REPO      = process.env.GITHUB_REPO  || 'masterledgerlive/guardian-protocol-agent';
const STATE_BRANCH     = process.env.STATE_BRANCH || 'bot-state';
const DECRYPT_PASSWORD = process.env.DECRYPT_PASSWORD || 'master';
const MAX_STRANDS      = 5;
const REGISTRY_PATH    = 'vita-registry.json';

async function fetchRegistry() {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/contents/${REGISTRY_PATH}?ref=${STATE_BRANCH}&t=${Date.now()}`,
      { headers: { Authorization: 'token ' + GITHUB_TOKEN } }
    );
    if (!res.ok) return { strands: [], iknCards: {} };
    const data = await res.json();
    const raw  = Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf8');
    return JSON.parse(raw);
  } catch {
    return { strands: [], iknCards: {} };
  }
}

function decryptStrand(encryptedHex, password) {
  try {
    const buf        = Buffer.from(encryptedHex, 'hex');
    const salt       = buf.slice(0, 16);
    const iv         = buf.slice(16, 32);
    const authTag    = buf.slice(32, 48);
    const ciphertext = buf.slice(48);
    const key        = crypto.scryptSync(password, salt, 32);
    const decipher   = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

function buildContextPacket(cards, strands) {
  const lines = [
    `§IKN-BOOT§[${new Date().toISOString()}]`,
    `§LOADED§[${cards.length}-cards|${strands.filter(Boolean).length}-strands]`,
    '',
  ];
  cards.forEach(c => {
    if (!c) return;
    lines.push(`§CARD§[${c['IKN-X'] || c.iknX || 'unknown'}]`);
    lines.push(`  DDC    : ${c.DDC    || c.ddc    || 'pending'}`);
    lines.push(`  TITLE  : ${c.TITLE  || c.title  || ''}`);
    lines.push(`  STATUS : ${c.STATUS || c.status || ''}`);
    lines.push(`  TRUST  : ${c.TRUST  || c.trust  || ''}`);
    lines.push(`  THREAD : ${c.THREAD || c.thread || ''}`);
    lines.push('');
  });
  strands.forEach((s, i) => {
    if (s) {
      lines.push(`§STRAND-${i+1}§`);
      lines.push(s.slice(0, 600));
      lines.push('');
    }
  });
  return lines.join('\n');
}

async function bootReader() {
  console.log('📚 IKN boot reader: fetching vita-registry...');
  const registry   = await fetchRegistry();
  const allStrands = registry.strands || [];
  const strandsArr = Array.isArray(allStrands)
    ? allStrands
    : Object.values(allStrands);

  const recent = strandsArr
    .sort((a, b) => (b.date || b.filedAt || '').localeCompare(a.date || a.filedAt || ''))
    .slice(0, MAX_STRANDS);

  if (recent.length === 0) {
    console.log('📚 IKN: no strands yet — fresh registry');
    return null;
  }

  const cards     = recent.map(s => s.iknCard || null);
  const decrypted = recent.map(s => {
    if (s.encryptedContent) return decryptStrand(s.encryptedContent, DECRYPT_PASSWORD);
    return s.tokenPacket || null;
  });

  const context = buildContextPacket(cards, decrypted);

  try {
    const fs = await import('fs');
    fs.writeFileSync('./ikn-boot-context.txt', context, 'utf8');
    console.log('📚 IKN: context written to ikn-boot-context.txt');
  } catch {}

  return context;
}

export { bootReader };

if (process.argv[1] && process.argv[1].includes('ikn-boot-reader')) {
  bootReader().catch(console.error);
}
