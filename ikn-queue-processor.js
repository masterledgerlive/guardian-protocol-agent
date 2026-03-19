/**
 * ikn-queue-processor.js
 * IKN Filing Protocol v1.0
 * Drop-in addition to existing vita-webhook.js / queue processor
 * Handles IKN strand inscription + vita-registry.json update with IKN card
 *
 * Integrate into agent.js processVitaQueue() — call processIKNEntry(entry)
 * for any queue file with type === 'ikn-strand'
 */

import { Octokit } from '@octokit/rest';
import crypto from 'crypto';

const GITHUB_TOKEN  = process.env.GITHUB_TOKEN;
const GITHUB_REPO   = process.env.GITHUB_REPO   || 'masterledgerlive/guardian-protocol-agent';
const STATE_BRANCH  = process.env.STATE_BRANCH  || 'bot-state';
const ENCRYPT_PASS  = process.env.DECRYPT_PASSWORD || 'master';

const octokit = new Octokit({ auth: GITHUB_TOKEN });
const [OWNER, REPO] = GITHUB_REPO.split('/');

// ─── ENCRYPT ─────────────────────────────────────────────────────────────────

function encryptContent(text, password) {
  const salt       = crypto.randomBytes(16);
  const iv         = crypto.randomBytes(16);
  const key        = crypto.scryptSync(password, salt, 32);
  const cipher     = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted  = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const authTag    = cipher.getAuthTag();
  return Buffer.concat([salt, iv, authTag, encrypted]).toString('hex');
}

// ─── REGISTRY HELPERS ─────────────────────────────────────────────────────────

async function getRegistry() {
  try {
    const { data } = await octokit.repos.getContent({
      owner: OWNER, repo: REPO,
      path: 'vita-registry.json', ref: STATE_BRANCH
    });
    return {
      sha:  data.sha,
      data: JSON.parse(Buffer.from(data.content, 'base64').toString('utf8'))
    };
  } catch {
    return { sha: null, data: { strands: [], iknCards: {}, lastUpdated: null } };
  }
}

async function saveRegistry(registry, sha, message) {
  const content = Buffer.from(JSON.stringify(registry, null, 2)).toString('base64');
  await octokit.repos.createOrUpdateFileContents({
    owner: OWNER, repo: REPO,
    path:  'vita-registry.json',
    message,
    content,
    branch: STATE_BRANCH,
    ...(sha ? { sha } : {})
  });
}

// ─── IKN FILING CLASSIFIER ───────────────────────────────────────────────────
// VITA auto-classification — assigns DDC anchor and confidence

function classifyEntry(entry) {
  const card  = entry.iknCard || {};
  const title = (card.TITLE || entry.subject || '').toLowerCase();
  const tags  = card.TAGS || [];

  // Already has IKN-X from handoff push — trust it
  if (card['IKN-X'] && card['IKN-X'].startsWith('IKN.')) {
    return { iknX: card['IKN-X'], confidence: 95, status: 'CONFIRMED', note: 'agent-session' };
  }

  // News / journalism
  if (tags.some(t => ['news','newspaper','journalism','press'].includes(t)) ||
      title.includes('news') || title.includes('times') || title.includes('post')) {
    return { iknX: `LIVE.001.${Date.now()}`, confidence: 88, status: 'CONFIRMED', note: 'journalism=DDC-070' };
  }

  // IoT / weather
  if (tags.some(t => ['iot','weather','sensor','climate'].includes(t))) {
    return { iknX: `LIVE.002.${Date.now()}`, confidence: 90, status: 'CONFIRMED', note: 'IoT-sensor-data' };
  }

  // Trade / financial
  if (tags.some(t => ['trade','stock','crypto','market','price'].includes(t))) {
    return { iknX: `LIVE.006.${Date.now()}`, confidence: 85, status: 'CONFIRMED', note: 'financial=DDC-332' };
  }

  // Film
  if (tags.some(t => ['film','movie','cinema','video'].includes(t))) {
    return { iknX: `LIVE.003.${Date.now()}`, confidence: 82, status: 'CONFIRMED', note: 'film=DDC-791' };
  }

  // Music
  if (tags.some(t => ['music','song','album','audio'].includes(t))) {
    return { iknX: `LIVE.004.${Date.now()}`, confidence: 82, status: 'CONFIRMED', note: 'music=DDC-780' };
  }

  // Science
  if (tags.some(t => ['physics','science','biology','chemistry','math'].includes(t))) {
    return { iknX: `500.${Date.now()}`, confidence: 75, status: 'SUGGESTED', note: 'science-branch-DDC-500' };
  }

  // Unknown — propose new root
  return {
    iknX:       `IKN.999.PROP.${Date.now()}`,
    confidence: 45,
    status:     'DISPUTED',
    note:       'no-clear-DDC-match — propose new root, awaiting 3-agent validation'
  };
}

// ─── MAIN PROCESSOR ──────────────────────────────────────────────────────────

async function processIKNEntry(entry, queueFilePath) {
  console.log(`§IKN-PROCESS§ ${entry.label}`);

  // 1. Classify / confirm filing location
  const classification = classifyEntry(entry);
  const iknX    = entry.iknCard?.['IKN-X'] || classification.iknX;
  const status  = classification.status;
  const confidence = classification.confidence;

  console.log(`  IKN-X      : ${iknX}`);
  console.log(`  STATUS     : ${status} (${confidence}% confidence)`);
  console.log(`  NOTE       : ${classification.note}`);

  // 2. Encrypt the strand content
  const plaintext = entry.tokenPacket || Object.values(entry.chunks || {}).join('\n');
  const encrypted = encryptContent(plaintext, ENCRYPT_PASS);

  // 3. Build the registry entry
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
    trust:            status === 'CONFIRMED' ? '⛓️ blockchain-verified' : '💭 pending-verification',
    thread:           entry.iknCard?.THREAD || 'OPEN',
    prev:             entry.iknCard?.PREV   || null,
    strandHash,
    encryptedContent: encrypted,
    tokenPacket:      plaintext,   // keep plaintext for boot reader (remove in prod if security needed)
    chunkCount:       entry.chunkCount || 5,
    iknCard:          entry.iknCard || {},
    filedAt:          new Date().toISOString(),
    note:             classification.note,
  };

  // 4. Update vita-registry.json
  const { sha, data: registry } = await getRegistry();
  registry.strands = registry.strands || [];
  registry.iknCards = registry.iknCards || {};

  // Check for duplicate
  const existing = registry.strands.find(s => s.iknX === iknX);
  if (existing) {
    console.log(`  ⚠ Duplicate IKN-X detected — appending as child`);
    registryEntry.iknX = `${iknX}.v${Date.now()}`;
  }

  registry.strands.unshift(registryEntry); // newest first
  registry.iknCards[registryEntry.iknX] = registryEntry.iknCard;
  registry.lastUpdated = new Date().toISOString();
  registry.totalStrands = registry.strands.length;

  await saveRegistry(
    registry, sha,
    `§IKN§ ${status} · ${registryEntry.iknX} · ${entry.created}`
  );

  console.log(`  ✓ Registry updated — ${registry.totalStrands} total strands`);

  // 5. Delete queue file after confirmed save
  if (queueFilePath) {
    try {
      const { data: qFile } = await octokit.repos.getContent({
        owner: OWNER, repo: REPO,
        path:  queueFilePath, ref: STATE_BRANCH
      });
      await octokit.repos.deleteFile({
        owner:   OWNER, repo: REPO,
        path:    queueFilePath,
        message: `§IKN-PROCESSED§ ${registryEntry.iknX}`,
        sha:     qFile.sha,
        branch:  STATE_BRANCH,
      });
      console.log(`  ✓ Queue file deleted: ${queueFilePath}`);
    } catch (e) {
      console.log(`  ⚠ Could not delete queue file: ${e.message}`);
    }
  }

  return {
    iknX:       registryEntry.iknX,
    strandHash,
    status,
    confidence,
    trust:      registryEntry.trust,
  };
}

// ─── INTEGRATION SNIPPET FOR AGENT.JS ────────────────────────────────────────
// Add this inside your existing processVitaQueue() function:
//
//   if (entry.type === 'ikn-strand') {
//     const result = await processIKNEntry(entry, queueFilePath);
//     await sendTelegram(`§IKN-FILED§\n${result.iknX}\n${result.status} ${result.trust}`);
//     continue;
//   }

export { processIKNEntry, classifyEntry };

// Run directly for testing
if (process.argv[1].includes('ikn-queue-processor')) {
  // Test with a sample entry
  const testEntry = {
    vitaQueueEntry: true,
    label: 'test-ikn-entry',
    subject: 'Test IKN filing',
    type: 'ikn-strand',
    created: new Date().toISOString().split('T')[0],
    createdBy: 'DA|test',
    iknCard: {
      DDC: '000.000',
      'IKN-X': 'IKN.000.TEST.001',
      TITLE: 'Test entry',
      SUBTITLE: 'Testing IKN filing protocol',
      TAGS: ['test','IKN'],
      THREAD: 'OPEN',
      PREV: null,
    },
    chunkCount: 1,
    tokenPacket: '§TEST§[IKN-filing-protocol-test]',
    status: 'queued'
  };

  processIKNEntry(testEntry, null)
    .then(r => console.log('\nResult:', r))
    .catch(console.error);
}
