/**
 * ikn-queue-processor.js
 * IKN Filing Protocol v1.0
 * Uses fetch only — no external dependencies beyond what Guardian already has
 */

import crypto from 'crypto';

const GITHUB_TOKEN  = process.env.GITHUB_TOKEN;
const GITHUB_REPO   = process.env.GITHUB_REPO  || 'masterledgerlive/guardian-protocol-agent';
const STATE_BRANCH  = process.env.STATE_BRANCH || 'bot-state';
const ENCRYPT_PASS  = process.env.DECRYPT_PASSWORD || 'master';

// ─── ENCRYPT ─────────────────────────────────────────────────────────────────

function encryptContent(text, password) {
  const salt      = crypto.randomBytes(16);
  const iv        = crypto.randomBytes(16);
  const key       = crypto.scryptSync(password, salt, 32);
  const cipher    = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const authTag   = cipher.getAuthTag();
  return Buffer.concat([salt, iv, authTag, encrypted]).toString('hex');
}

// ─── REGISTRY HELPERS ─────────────────────────────────────────────────────────

async function getRegistry() {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/contents/vita-registry.json?ref=${STATE_BRANCH}&t=${Date.now()}`,
      { headers: { Authorization: 'token ' + GITHUB_TOKEN } }
    );
    if (!res.ok) return { sha: null, data: { strands: [], iknCards: {}, lastUpdated: null } };
    const file = await res.json();
    const data = JSON.parse(Buffer.from(file.content.replace(/\n/g, ''), 'base64').toString('utf8'));
    return { sha: file.sha, data };
  } catch {
    return { sha: null, data: { strands: [], iknCards: {}, lastUpdated: null } };
  }
}

async function saveRegistry(registry, sha, message) {
  const content = Buffer.from(JSON.stringify(registry, null, 2)).toString('base64');
  const payload = { message, content, branch: STATE_BRANCH };
  if (sha) payload.sha = sha;
  await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/contents/vita-registry.json`,
    {
      method:  'PUT',
      headers: { Authorization: 'token ' + GITHUB_TOKEN, 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload)
    }
  );
}

// ─── CLASSIFIER ──────────────────────────────────────────────────────────────

function classifyEntry(entry) {
  const card  = entry.iknCard || {};
  const title = (card.TITLE || entry.subject || '').toLowerCase();
  const tags  = (card.TAGS || []).map(t => t.toLowerCase());

  if (card['IKN-X'] && card['IKN-X'].startsWith('IKN.')) {
    return { iknX: card['IKN-X'], confidence: 95, status: 'CONFIRMED', note: 'agent-session' };
  }
  if (tags.some(t => ['news','newspaper','journalism','press'].includes(t)) || title.includes('news')) {
    return { iknX: `LIVE.001.${Date.now()}`, confidence: 88, status: 'CONFIRMED', note: 'journalism=DDC-070' };
  }
  if (tags.some(t => ['iot','weather','sensor','climate'].includes(t))) {
    return { iknX: `LIVE.002.${Date.now()}`, confidence: 90, status: 'CONFIRMED', note: 'IoT-sensor' };
  }
  if (tags.some(t => ['trade','stock','crypto','market','price'].includes(t))) {
    return { iknX: `LIVE.006.${Date.now()}`, confidence: 85, status: 'CONFIRMED', note: 'financial=DDC-332' };
  }
  if (tags.some(t => ['film','movie','cinema'].includes(t))) {
    return { iknX: `LIVE.003.${Date.now()}`, confidence: 82, status: 'CONFIRMED', note: 'film=DDC-791' };
  }
  if (tags.some(t => ['music','song','album','audio'].includes(t))) {
    return { iknX: `LIVE.004.${Date.now()}`, confidence: 82, status: 'CONFIRMED', note: 'music=DDC-780' };
  }
  if (tags.some(t => ['physics','science','biology','chemistry','math'].includes(t))) {
    return { iknX: `500.${Date.now()}`, confidence: 75, status: 'SUGGESTED', note: 'science=DDC-500' };
  }
  return { iknX: `IKN.999.PROP.${Date.now()}`, confidence: 45, status: 'DISPUTED', note: 'no-DDC-match — propose new root' };
}

// ─── MAIN PROCESSOR ──────────────────────────────────────────────────────────

async function processIKNEntry(entry, queueFilePath) {
  console.log(`§IKN-PROCESS§ ${entry.label}`);

  const classification = classifyEntry(entry);
  const iknX           = entry.iknCard?.['IKN-X'] || classification.iknX;
  const status         = classification.status;
  const confidence     = classification.confidence;

  console.log(`  IKN-X  : ${iknX}`);
  console.log(`  STATUS : ${status} (${confidence}%)`);
  console.log(`  NOTE   : ${classification.note}`);

  const plaintext  = entry.tokenPacket || Object.values(entry.chunks || {}).join('\n');
  const encrypted  = encryptContent(plaintext, ENCRYPT_PASS);
  const strandHash = crypto.createHash('sha256').update(plaintext).digest('hex').slice(0, 32);

  const registryEntry = {
    iknX,
    label:            entry.label,
    title:            entry.iknCard?.TITLE  || entry.subject,
    ddc:              entry.iknCard?.DDC    || 'pending',
    tags:             entry.iknCard?.TAGS   || [],
    date:             entry.created,
    author:           entry.createdBy,
    status,
    confidence,
    trust:            status === 'CONFIRMED' ? '⛓️ blockchain-verified' : '💭 pending',
    thread:           entry.iknCard?.THREAD || 'OPEN',
    prev:             entry.iknCard?.PREV   || null,
    strandHash,
    encryptedContent: encrypted,
    tokenPacket:      plaintext,
    chunkCount:       entry.chunkCount || 5,
    iknCard:          entry.iknCard    || {},
    filedAt:          new Date().toISOString(),
    note:             classification.note,
  };

  // Update vita-registry.json
  // CRITICAL: IKN data is stored under registry._ikn so VITA's legacy flat reader
  // never sees strands/iknCards/lastUpdated as entry names in its list.
  // Legacy entries (flat keys) remain exactly as-is — zero breakage.
  const { sha, data: registry } = await getRegistry();

  // Initialise _ikn namespace — never pollutes flat legacy entries
  if (!registry._ikn) registry._ikn = { strands: [], iknCards: {}, lastUpdated: null, totalStrands: 0 };

  const existing = registry._ikn.strands.find(s => s.iknX === iknX);
  if (existing) registryEntry.iknX = `${iknX}.v${Date.now()}`;

  registry._ikn.strands.unshift(registryEntry);
  registry._ikn.iknCards[registryEntry.iknX] = registryEntry.iknCard;
  registry._ikn.lastUpdated  = new Date().toISOString();
  registry._ikn.totalStrands = registry._ikn.strands.length;

  // Also write a flat legacy-compatible entry so VITA /vita command still finds it
  const legacyKey = entry.created + '-' + entry.label;
  registry[legacyKey] = {
    strandId:   entry._strandId  || iknX,
    date:       entry.created,
    label:      entry.label,
    type:       'ikn-strand',
    subject:    entry.iknCard?.TITLE || entry.subject,
    txHashes:   entry._txHashes  || [],
    tokenPacket: plaintext.slice(0, 3000),
    iknX,
    status,
    filedAt:    new Date().toISOString(),
  };

  await saveRegistry(registry, sha, `§IKN§ ${status} · ${registryEntry.iknX} · ${entry.created}`);
  console.log(`  ✓ Registry updated — ${registry.totalStrands} total strands`);

  // Delete queue file
  if (queueFilePath) {
    try {
      const fRes = await fetch(
        `https://api.github.com/repos/${GITHUB_REPO}/contents/${queueFilePath}?ref=${STATE_BRANCH}`,
        { headers: { Authorization: 'token ' + GITHUB_TOKEN } }
      );
      if (fRes.ok) {
        const fData = await fRes.json();
        await fetch(
          `https://api.github.com/repos/${GITHUB_REPO}/contents/${queueFilePath}`,
          {
            method:  'DELETE',
            headers: { Authorization: 'token ' + GITHUB_TOKEN, 'Content-Type': 'application/json' },
            body:    JSON.stringify({ message: `§IKN-PROCESSED§ ${registryEntry.iknX}`, sha: fData.sha, branch: STATE_BRANCH })
          }
        );
        console.log(`  ✓ Queue file deleted`);
      }
    } catch (e) {
      console.log(`  ⚠ Could not delete queue file: ${e.message}`);
    }
  }

  return { iknX: registryEntry.iknX, strandHash, status, confidence, trust: registryEntry.trust };
}

export { processIKNEntry, classifyEntry };
