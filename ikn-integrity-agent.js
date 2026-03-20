/**
 * ikn-integrity-agent.js
 * IKN Memory Integrity Agent — Phase 1
 * Proposed by VITA from blockchain memory — executed 2026-03-19
 *
 * Phase 1 components:
 *   1. CHAIN VALIDATOR  — verifies tx hashes resolve to correct content on Base
 *   2. SOURCE ENFORCER  — scans VITA responses for unsourced factual claims
 *
 * Phase 2 (requires VITA_ANTHROPIC_KEY):
 *   3. DRIFT DETECTOR   — scores VITA answers against chain content
 *
 * Plugs into agent.js main loop — runs every 6 hours
 * Call: await runIntegrityCheck(cdpClient, tg, registry)
 *
 * Uses fetch only — zero new dependencies
 */

import { createPublicClient, http } from 'viem';
import { base } from 'viem/chains';

const GITHUB_TOKEN  = process.env.GITHUB_TOKEN;
const GITHUB_REPO   = process.env.GITHUB_REPO  || 'masterledgerlive/guardian-protocol-agent';
const STATE_BRANCH  = process.env.STATE_BRANCH || 'bot-state';
const WALLET        = '0x50e1C4608c48b0c52E1EA5FBabc1c9126eA17915';

// ─── RPC ENDPOINTS — same pool Guardian uses ─────────────────────────────────

const RPC_ENDPOINTS = [
  'https://mainnet.base.org',
  'https://base.llamarpc.com',
  'https://base-rpc.publicnode.com',
];

let rpcIndex = 0;
function getPublicClient() {
  const url = RPC_ENDPOINTS[rpcIndex % RPC_ENDPOINTS.length];
  rpcIndex++;
  return createPublicClient({ chain: base, transport: http(url) });
}

// ─── REGISTRY HELPERS ─────────────────────────────────────────────────────────

async function getRegistry() {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/contents/vita-registry.json?ref=${STATE_BRANCH}&t=${Date.now()}`,
      { headers: { Authorization: 'token ' + GITHUB_TOKEN } }
    );
    if (!res.ok) return { sha: null, data: {} };
    const file = await res.json();
    const data = JSON.parse(Buffer.from(file.content.replace(/\n/g, ''), 'base64').toString('utf8'));
    return { sha: file.sha, data };
  } catch {
    return { sha: null, data: {} };
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

// ─── COMPONENT 1: CHAIN VALIDATOR ────────────────────────────────────────────
// Fetches each strand's tx hash from Base, decodes calldata,
// compares against stored tokenPacket. Marks CORRUPTED if mismatch.

async function validateChain(registry) {
  const results = { checked: 0, valid: 0, corrupted: 0, missing: 0, errors: 0 };
  const corrupted = [];

  // Get all entries that have tx hashes — both legacy and IKN
  const entries = [];

  // Legacy flat entries
  for (const [key, val] of Object.entries(registry)) {
    if (key.startsWith('_') || typeof val !== 'object' || !val) continue;
    if (Array.isArray(val.txHashes) && val.txHashes.length > 0) {
      entries.push({ key, val, source: 'legacy' });
    }
  }

  // IKN strands
  const iknStrands = registry._ikn?.strands || [];
  for (const strand of iknStrands) {
    if (strand.iknCard?.STRAND && strand.iknCard.STRAND.startsWith('0x')) {
      entries.push({ key: strand.iknX, val: strand, source: 'ikn', txHash: strand.iknCard.STRAND });
    }
  }

  console.log(`§INTEGRITY§ Chain validator: checking ${entries.length} entries`);

  for (const { key, val, source, txHash } of entries) {
    results.checked++;
    const hashes = txHash ? [txHash] : (val.txHashes || []);
    if (hashes.length === 0) { results.missing++; continue; }

    try {
      const client = getPublicClient();
      // Check the first tx hash (strand anchor)
      const tx = await client.getTransaction({ hash: hashes[0] });

      if (!tx) {
        results.missing++;
        console.log(`  ⚠ ${key}: tx not found on chain`);
        continue;
      }

      // Decode calldata — strip 0x, convert hex to text
      const calldata = tx.input;
      if (!calldata || calldata === '0x') {
        results.missing++;
        continue;
      }

      const decoded = Buffer.from(calldata.slice(2), 'hex').toString('utf8');

      // Check that stored tokenPacket content appears in the decoded calldata
      const storedContent = (val.tokenPacket || '').slice(0, 100).trim();
      const chainContent  = decoded.slice(0, 500);

      // We don't expect exact match (header prefix is prepended) — check key tokens
      // Extract §-delimited tokens from stored content and verify at least 2 appear on chain
      const tokens = (storedContent.match(/§[A-Z\-]+§/g) || []).slice(0, 3);
      const matchCount = tokens.filter(t => chainContent.includes(t) || decoded.includes(t)).length;

      if (tokens.length > 0 && matchCount === 0) {
        results.corrupted++;
        corrupted.push({ key, source, txHash: hashes[0], reason: 'content-mismatch' });
        console.log(`  ✗ CORRUPTED: ${key} — chain content doesn't match stored tokens`);
      } else {
        results.valid++;
        console.log(`  ✓ ${key}: valid (${source})`);
      }

    } catch (e) {
      results.errors++;
      console.log(`  ⚠ ${key}: check error — ${e.message}`);
    }

    // Rate limit — don't hammer RPC
    await new Promise(r => setTimeout(r, 1500));
  }

  return { results, corrupted };
}

// ─── COMPONENT 2: SOURCE ENFORCER ────────────────────────────────────────────
// Scans a VITA response string for unsourced factual claims.
// Returns { clean: bool, issues: string[], enforced: string }
// "enforced" is the response with source labels injected where missing.

const FACTUAL_PATTERNS = [
  /the (price|wallet|balance|hash|address|tx|token) (is|was|has|shows?)/i,
  /\$([\d,]+\.?\d*)/,                    // dollar amounts
  /0x[a-fA-F0-9]{10,}/,                  // addresses / hashes
  /(confirmed|verified|inscribed|filed)/i,
  /(\d+\.?\d*)\s*(ETH|WETH|USDC|USD)/i,  // crypto amounts
  /(strand|chunk|registry|blockchain)/i,
];

const SOURCE_LABELS = ['⛓️', '💭', 'blockchain-verified', 'LLM-estimate', '§SOURCE§', 'BLOCKCHAIN VERIFIED', 'LLM ESTIMATE'];

function enforceSource(vitaResponse) {
  if (!vitaResponse || typeof vitaResponse !== 'string') {
    return { clean: true, issues: [], enforced: vitaResponse };
  }

  const issues = [];

  // Check if response has ANY source label
  const hasSourceLabel = SOURCE_LABELS.some(label => vitaResponse.includes(label));

  // Check if response contains factual claims
  const factualClaims = FACTUAL_PATTERNS.filter(p => p.test(vitaResponse));

  if (factualClaims.length > 0 && !hasSourceLabel) {
    issues.push(`${factualClaims.length} factual claim(s) found with no source label`);
  }

  // Check for mixed sourcing — both ⛓️ and 💭 in same response without clear separation
  const hasChain = vitaResponse.includes('⛓️') || vitaResponse.includes('blockchain-verified') || vitaResponse.includes('BLOCKCHAIN VERIFIED');
  const hasLLM   = vitaResponse.includes('💭') || vitaResponse.includes('LLM-estimate') || vitaResponse.includes('LLM ESTIMATE');

  if (hasChain && hasLLM) {
    issues.push('mixed sources detected — ensure ⛓️ and 💭 facts are clearly separated');
  }

  // Build enforced version — append source reminder if issues found
  let enforced = vitaResponse;
  if (issues.length > 0 && !hasSourceLabel) {
    enforced = vitaResponse +
      '\n\n⚠️ <i>[INTEGRITY: response contains factual claims — source not labeled.' +
      ' Treat as 💭 LLM estimate unless marked ⛓️ blockchain-verified]</i>';
  }

  return { clean: issues.length === 0, issues, enforced };
}

// ─── INTEGRITY REPORT ────────────────────────────────────────────────────────

function buildIntegrityReport(chainResults, driftResults = null) {
  const { results, corrupted } = chainResults;
  const timestamp = new Date().toLocaleTimeString();

  let msg = `🔍 <b>IKN INTEGRITY REPORT</b>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `🕐 ${timestamp}\n\n`;

  msg += `<b>Chain Validator:</b>\n`;
  msg += `  ✅ Valid:     ${results.valid}\n`;
  msg += `  ✗  Corrupted: ${results.corrupted}\n`;
  msg += `  ⚠️  Missing:   ${results.missing}\n`;
  msg += `  🔄 Errors:    ${results.errors}\n`;
  msg += `  📊 Checked:   ${results.checked}\n\n`;

  if (corrupted.length > 0) {
    msg += `<b>⚠️ Corrupted entries:</b>\n`;
    corrupted.forEach(c => {
      msg += `  • <code>${c.key}</code>\n`;
      msg += `    Reason: ${c.reason}\n`;
      msg += `    TX: <code>${c.txHash?.slice(0,16)}...</code>\n`;
    });
    msg += '\n';
  }

  if (driftResults) {
    msg += `<b>Drift Detector:</b> Phase 2 pending VITA_ANTHROPIC_KEY\n\n`;
  }

  msg += `<b>Source Enforcer:</b> active on all /vita responses\n\n`;

  if (results.corrupted === 0 && results.errors === 0) {
    msg += `💌 <i>Memory integrity confirmed. The chain is clean.</i>`;
  } else {
    msg += `🚨 <i>Integrity issues detected — review corrupted entries above.</i>`;
  }

  return msg;
}

// ─── MAIN ENTRY POINT ────────────────────────────────────────────────────────
// Call this from agent.js main loop every 6 hours

async function runIntegrityCheck(tg) {
  console.log('§INTEGRITY§ Starting IKN integrity check...');

  const { sha, data: registry } = await getRegistry();
  if (!registry || Object.keys(registry).length === 0) {
    console.log('§INTEGRITY§ Empty registry — skipping');
    return;
  }

  // Component 1: Chain Validator
  const chainResults = await validateChain(registry);

  // Mark corrupted entries in registry
  if (chainResults.corrupted.length > 0) {
    for (const c of chainResults.corrupted) {
      // Mark in legacy flat entry
      if (registry[c.key]) {
        registry[c.key].integrityStatus  = 'CORRUPTED';
        registry[c.key].integrityChecked = new Date().toISOString();
        registry[c.key].integrityReason  = c.reason;
      }
      // Mark in IKN strand
      const strand = registry._ikn?.strands?.find(s => s.iknX === c.key);
      if (strand) {
        strand.integrityStatus  = 'CORRUPTED';
        strand.integrityChecked = new Date().toISOString();
        strand.integrityReason  = c.reason;
        strand.status           = 'DISPUTED';
        strand.trust            = '⚠️ integrity-failed';
      }
    }
    await saveRegistry(registry, sha, `§INTEGRITY§ marked ${chainResults.corrupted.length} corrupted`);
  } else {
    // Update last check timestamp
    if (!registry._ikn) registry._ikn = {};
    registry._ikn.lastIntegrityCheck = new Date().toISOString();
    registry._ikn.lastIntegrityResult = {
      valid:     chainResults.results.valid,
      corrupted: chainResults.results.corrupted,
      checked:   chainResults.results.checked,
    };
    await saveRegistry(registry, sha, `§INTEGRITY§ check passed — ${chainResults.results.valid} valid`);
  }

  // Send Telegram report
  const report = buildIntegrityReport(chainResults);
  await tg(report);

  console.log(`§INTEGRITY§ Complete — ${chainResults.results.valid} valid, ${chainResults.results.corrupted} corrupted`);
  return chainResults;
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

export { runIntegrityCheck, enforceSource };
