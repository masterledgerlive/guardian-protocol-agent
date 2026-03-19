/**
 * ikn-boot-reader.js
 * IKN Filing Protocol v1.0
 * Runs at Railway startup OR when Claude needs to arm context from chain
 * Reads vita-registry.json → finds latest IKN strands → decrypts → returns context
 *
 * Usage: node ikn-boot-reader.js
 * Env required: GITHUB_TOKEN, GITHUB_REPO, STATE_BRANCH, DECRYPT_PASSWORD
 */

import { Octokit } from '@octokit/rest';
import crypto from 'crypto';

// ─── CONFIG ───────────────────────────────────────────────────────────────────

const GITHUB_TOKEN       = process.env.GITHUB_TOKEN;
const GITHUB_REPO        = process.env.GITHUB_REPO   || 'masterledgerlive/guardian-protocol-agent';
const STATE_BRANCH       = process.env.STATE_BRANCH  || 'bot-state';
const DECRYPT_PASSWORD   = process.env.DECRYPT_PASSWORD || 'master';
const MAX_STRANDS        = 5;   // how many recent strands to load at boot
const IKN_REGISTRY_PATH  = 'vita-registry.json';

const octokit = new Octokit({ auth: GITHUB_TOKEN });
const [OWNER, REPO] = GITHUB_REPO.split('/');

// ─── REGISTRY READ ────────────────────────────────────────────────────────────

async function fetchRegistry() {
  try {
    const { data } = await octokit.repos.getContent({
      owner: OWNER, repo: REPO,
      path:  IKN_REGISTRY_PATH, ref: STATE_BRANCH
    });
    const raw = Buffer.from(data.content, 'base64').toString('utf8');
    return JSON.parse(raw);
  } catch (e) {
    console.log('⚠ vita-registry.json not found — returning empty registry');
    return { strands: [], iknCards: {} };
  }
}

// ─── DECRYPT STRAND ───────────────────────────────────────────────────────────

function decryptStrand(encryptedHex, password) {
  try {
    const buf        = Buffer.from(encryptedHex, 'hex');
    const salt       = buf.slice(0, 16);
    const iv         = buf.slice(16, 32);
    const authTag    = buf.slice(32, 48);
    const ciphertext = buf.slice(48);

    const key = crypto.scryptSync(password, salt, 32);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    const dec = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return dec.toString('utf8');
  } catch {
    return null; // wrong password or corrupted — skip silently
  }
}

// ─── IKN CARD PARSER ──────────────────────────────────────────────────────────

function parseIKNCard(card) {
  if (!card) return null;
  return {
    iknX:    card['IKN-X']  || card.iknX,
    ddc:     card.DDC       || card.ddc,
    title:   card.TITLE     || card.title,
    subtitle:card.SUBTITLE  || card.subtitle,
    tags:    card.TAGS      || card.tags || [],
    trust:   card.TRUST     || card.trust,
    status:  card.STATUS    || card.status,
    thread:  card.THREAD    || card.thread,
    strand:  card.STRAND    || card.strand,
  };
}

// ─── BUILD CONTEXT PACKET ─────────────────────────────────────────────────────

function buildContextPacket(cards, strands) {
  const lines = [
    `§IKN-BOOT§[${new Date().toISOString()}]`,
    `§LOADED§[${cards.length}-cards|${strands.length}-strands]`,
    '',
  ];

  cards.forEach(c => {
    lines.push(`§CARD§[${c.iknX}]`);
    lines.push(`  DDC    : ${c.ddc}`);
    lines.push(`  TITLE  : ${c.title}`);
    lines.push(`  TRUST  : ${c.trust}`);
    lines.push(`  STATUS : ${c.status}`);
    lines.push(`  THREAD : ${c.thread}`);
    lines.push('');
  });

  strands.forEach((s, i) => {
    if (s) {
      lines.push(`§STRAND-CONTENT-${i+1}§`);
      lines.push(s.slice(0, 800)); // first 800 chars per strand
      lines.push('');
    }
  });

  return lines.join('\n');
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function bootReader() {
  console.log('§IKN-BOOT§ Reading from chain index...');

  const registry = await fetchRegistry();

  // Sort strands by date descending, take most recent N
  const allStrands = registry.strands || [];
  const recent = allStrands
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .slice(0, MAX_STRANDS);

  if (recent.length === 0) {
    console.log('⚠ No strands found in registry yet');
    console.log('§STATUS§ Fresh install — no prior context loaded');
    return null;
  }

  console.log(`Found ${recent.length} recent strands`);

  // Load IKN cards
  const cards = recent
    .map(s => parseIKNCard(s.iknCard || registry.iknCards?.[s.iknX]))
    .filter(Boolean);

  // Attempt to decrypt strand content
  const decrypted = recent.map(s => {
    if (!s.encryptedContent) return s.tokenPacket || null;
    return decryptStrand(s.encryptedContent, DECRYPT_PASSWORD);
  });

  const context = buildContextPacket(cards, decrypted);

  console.log('\n§IKN-CONTEXT§ Armed:');
  console.log(context);

  // Write to local context file for agent.js to read at boot
  const fs = await import('fs');
  fs.writeFileSync('./ikn-boot-context.txt', context, 'utf8');
  console.log('\n✓ Context written to ikn-boot-context.txt');
  console.log('✓ agent.js will read this at startup');

  return context;
}

// ─── EXPORT FOR AGENT.JS ──────────────────────────────────────────────────────

export { bootReader, fetchRegistry, parseIKNCard };

// Run directly if called as script
if (process.argv[1].includes('ikn-boot-reader')) {
  bootReader().catch(console.error);
}
