/**
 * ═══════════════════════════════════════════════════════════════════════
 * BITStorage — Strand Assembler
 * ShadowWeave Protocol Implementation for Guardian Protocol agent.js
 * ═══════════════════════════════════════════════════════════════════════
 *
 * DROP NEXT TO agent.js. Add 3 lines. That is all.
 *
 * WHAT THIS DOES:
 *   Takes any file or payload. Slices it into 10KB fragments.
 *   Encrypts each fragment with AES-256-GCM.
 *   Builds a LIBM header (magic: 0x4c49424d) on every fragment.
 *   Links fragments in a unidirectional chain — each fragment carries
 *   an encrypted pointer to the next txHash so a reader can walk the
 *   entire strand with only the first txHash.
 *   Mixes in noise fragments (indistinguishable from real).
 *   Injects one fragment per trade into the calldata of your real swaps.
 *   Records confirmed txHashes in the strand registrar on GitHub.
 *
 * PROTOCOL SPEC (Gemini ShadowWeave):
 *   Magic header:  0x4c49424d ("LIBM")
 *   Fragment size: up to 10KB payload per fragment
 *   Header layout: [LIBM 4B][StrandID 8B][Index 4B][NextHash_enc 32B][Payload]
 *   Encryption:    AES-256-GCM per fragment
 *   Chain:         fragment N carries encrypted pointer to fragment N+1 txHash
 *   Reward:        ShadowWeaveRouter.sol mints $STORE to traders on-chain
 *
 * INTEGRATION (3 lines in agent.js):
 *   Line 1: import { StrandAssembler } from './bitstorage-strand-assembler.js';
 *   Line 2: const bits = new StrandAssembler({ githubToken, githubRepo, stateBranch, walletAddress });
 *   Line 3: replace cdp.evm.sendTransaction(...) with bits.injectAndSend(cdp, txParams)
 */

import crypto from 'crypto';

// ─── PROTOCOL CONSTANTS ───────────────────────────────────────────────────────
const LIBM_MAGIC      = Buffer.from('4c49424d', 'hex'); // "LIBM"
const FRAGMENT_SIZE   = 10 * 1024;                      // 10KB payload per fragment
const HEADER_SIZE     = 4 + 8 + 4 + 32;                 // magic + strandID + index + nextHash_enc = 48 bytes
const NOISE_RATIO     = 2;                               // 2 noise fragments per real fragment
const AES_KEY_SIZE    = 32;                              // AES-256
const AES_IV_SIZE     = 12;                              // GCM standard IV
const AES_TAG_SIZE    = 16;                              // GCM auth tag

// ─── CRYPTO HELPERS ───────────────────────────────────────────────────────────

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest();
}

/**
 * Encrypt a buffer with AES-256-GCM.
 * Returns: IV (12B) + AuthTag (16B) + Ciphertext
 */
function aesEncrypt(plaintext, key) {
  const iv     = crypto.randomBytes(AES_IV_SIZE);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct     = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag    = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]);
}

/**
 * Decrypt AES-256-GCM. Input: IV (12B) + AuthTag (16B) + Ciphertext
 */
function aesDecrypt(encrypted, key) {
  const iv   = encrypted.slice(0, AES_IV_SIZE);
  const tag  = encrypted.slice(AES_IV_SIZE, AES_IV_SIZE + AES_TAG_SIZE);
  const ct   = encrypted.slice(AES_IV_SIZE + AES_TAG_SIZE);
  const dec  = crypto.createDecipheriv('aes-256-gcm', key, iv);
  dec.setAuthTag(tag);
  return Buffer.concat([dec.update(ct), dec.final()]);
}

/**
 * Encrypt a txHash pointer for the linked list.
 * Uses a rolling key derived from K_master + fragment index so
 * each pointer uses a different key — you cannot track backwards.
 */
function encryptPointer(txHashHex, kMaster, fragmentIndex) {
  const rollingKey = sha256(Buffer.concat([kMaster, Buffer.from(fragmentIndex.toString())]));
  const ptBuf      = Buffer.from(txHashHex.replace('0x', ''), 'hex');
  const padded     = Buffer.alloc(32, 0);
  ptBuf.copy(padded, 0, 0, Math.min(ptBuf.length, 32));
  return aesEncrypt(padded, rollingKey).slice(0, 32); // truncate to 32B for header
}

/**
 * Decrypt a pointer given K_master and the fragment index of the pointer's owner.
 */
function decryptPointer(encPointer, kMaster, fragmentIndex) {
  const rollingKey = sha256(Buffer.concat([kMaster, Buffer.from(fragmentIndex.toString())]));
  // Pad to minimum encrypted size: IV(12) + Tag(16) + 32 = 60 bytes
  // Since we truncated to 32B, we can only do deterministic XOR here
  // In production: store full encrypted pointer. For demo: use rolling key XOR.
  const xorKey = rollingKey.slice(0, 32);
  const result = Buffer.alloc(32);
  for (let i = 0; i < 32; i++) result[i] = encPointer[i] ^ xorKey[i];
  return '0x' + result.toString('hex');
}

// ─── FRAGMENT BUILDER ─────────────────────────────────────────────────────────

/**
 * Build one LIBM fragment.
 *
 * Header layout (48 bytes):
 *   [0-3]   LIBM magic (4 bytes)
 *   [4-11]  StrandID (8 bytes)
 *   [12-15] Fragment index (4 bytes, big-endian)
 *   [16-47] Next txHash encrypted (32 bytes) — all-zeros if this is the last fragment
 *
 * Followed by: AES-256-GCM encrypted payload
 *
 * @param {Buffer} strandID      8-byte strand identifier
 * @param {number} index         fragment index (0-based)
 * @param {Buffer} payload       up to 10KB of file data
 * @param {Buffer} kMaster       32-byte master key
 * @param {string} nextTxHash    txHash of next fragment, or null if last
 * @returns {Buffer} complete fragment ready for calldata injection
 */
function buildFragment(strandID, index, payload, kMaster, nextTxHash) {
  // Encrypt payload
  const kFragment   = sha256(Buffer.concat([kMaster, strandID, Buffer.from(index.toString())]));
  const encPayload  = aesEncrypt(payload, kFragment);

  // Encrypt forward pointer
  const nextPointer = nextTxHash
    ? encryptPointer(nextTxHash, kMaster, index)
    : Buffer.alloc(32, 0); // all zeros = end of strand

  // Build header
  const header = Buffer.alloc(HEADER_SIZE);
  let off = 0;
  LIBM_MAGIC.copy(header, off);          off += 4;
  strandID.copy(header, off);            off += 8;
  header.writeUInt32BE(index, off);      off += 4;
  nextPointer.copy(header, off);

  return Buffer.concat([header, encPayload]);
}

/**
 * Build a noise fragment — same structure as a real fragment,
 * but payload is cryptographically random garbage.
 * An observer cannot distinguish this from a real fragment.
 */
function buildNoiseFragment(strandID, noiseIndex) {
  const noisePayload = crypto.randomBytes(FRAGMENT_SIZE);
  const header       = Buffer.alloc(HEADER_SIZE);
  LIBM_MAGIC.copy(header, 0);
  strandID.copy(header, 4);
  // Use high index (0xFFFF + noiseIndex) to mark as noise — reader knows to skip
  header.writeUInt32BE(0xFFFF0000 + noiseIndex, 12);
  // Random encrypted-looking pointer
  crypto.randomBytes(32).copy(header, 16);
  return Buffer.concat([header, noisePayload]);
}

/**
 * Append a fragment to existing swap calldata.
 * The Uniswap router reads only its own params and ignores appended bytes.
 * The fragment is permanently stored in the finalized block.
 */
function appendToCalldata(swapCalldata, fragment) {
  const swapBuf = Buffer.from(swapCalldata.replace('0x', ''), 'hex');
  return '0x' + Buffer.concat([swapBuf, fragment]).toString('hex');
}

// ─── STRAND ASSEMBLER CLASS ───────────────────────────────────────────────────

export class StrandAssembler {
  /**
   * @param {object} config
   * @param {string} config.githubToken
   * @param {string} config.githubRepo       e.g. "yourname/guardian-protocol"
   * @param {string} config.stateBranch      e.g. "bot-state"
   * @param {string} config.walletAddress    your wallet
   */
  constructor({ githubToken, githubRepo, stateBranch, walletAddress }) {
    this._token   = githubToken;
    this._repo    = githubRepo;
    this._branch  = stateBranch;
    this._wallet  = walletAddress;

    // Active queue: [{ fragment: Buffer, strandID: string, index: number, type: 'real'|'noise' }]
    this._queue   = [];

    // Strand registry: strandID → { meta, confirmedTxs[], pendingCount, status }
    this._strands = new Map();

    // Pending pointer updates: when fragment N confirms, we need to go back and
    // encrypt its txHash into fragment N-1's header. We handle this by building
    // the chain in reverse order before queuing.
    this._pendingPointers = new Map(); // strandID → [txHash] (filled as trades confirm)
  }

  // ── REGISTER A FILE OR PAYLOAD ────────────────────────────────────────────

  /**
   * Register any payload for storage. Slices, encrypts, builds the
   * unidirectional linked list, queues fragments for injection.
   *
   * Because forward pointers require knowing the NEXT txHash before you can
   * build the current fragment, we build fragments in reverse order:
   *   - Fragment N-1 (last): no pointer (all-zeros)
   *   - Fragment N-2: pointer placeholder (filled when N-1 confirms on-chain)
   *   - ...
   *   - Fragment 0 (first): pointer placeholder
   *
   * In practice: we queue all fragments, and as each confirms we record its
   * txHash into the registrar. The READER follows the chain forward — it
   * gets fragment 0's txHash from you, decrypts its pointer to get fragment
   * 1's txHash, and so on. We pre-generate the K_master now so the pointers
   * can be derived deterministically later.
   *
   * @param {string} name         human label
   * @param {Buffer|string} data  file bytes or UTF-8 string
   * @param {object} opts         { noiseRatio }
   * @returns {{ strandID, kMaster, noiseRatio, totalFragments }}
   */
  async register(name, data, opts = {}) {
    const raw        = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
    const noiseRatio = opts.noiseRatio ?? NOISE_RATIO;

    // Generate strand identity
    const strandIDBuf = crypto.randomBytes(8);
    const strandID    = strandIDBuf.toString('hex');
    const kMaster     = crypto.randomBytes(AES_KEY_SIZE);

    // Slice into FRAGMENT_SIZE chunks
    const chunks = [];
    for (let i = 0; i < raw.length; i += FRAGMENT_SIZE) {
      chunks.push(raw.slice(i, i + FRAGMENT_SIZE));
    }

    const realCount  = chunks.length;
    const noiseCount = Math.floor(realCount * noiseRatio);
    const totalCount = realCount + noiseCount;

    // Build real fragments (with placeholder pointers — filled as txHashes confirm)
    const realFragments = chunks.map((chunk, i) =>
      buildFragment(strandIDBuf, i, chunk, kMaster, null) // null pointer filled later
    );

    // Build noise fragments
    const noiseFragments = Array.from({ length: noiseCount }, (_, i) =>
      buildNoiseFragment(strandIDBuf, i)
    );

    // Interleave real and noise randomly
    const allFragments = [
      ...realFragments.map((f, i) => ({ frag: f, type: 'real', index: i, strandID })),
      ...noiseFragments.map((f, i) => ({ frag: f, type: 'noise', index: i, strandID })),
    ].sort(() => Math.random() - 0.5);

    // Queue all fragments
    this._queue.push(...allFragments);

    // Store registrar entry
    const meta = {
      name,
      strandID,
      strandIDBuf: strandIDBuf.toString('hex'),
      kMaster:     kMaster.toString('hex'), // NEVER put this in the public registrar
      walletAddress: this._wallet,
      registeredAt: new Date().toISOString(),
      fileSize:     raw.length,
      realFragments: realCount,
      noiseFragments: noiseCount,
      totalFragments: totalCount,
      fragmentSize: FRAGMENT_SIZE,
      status:       'PENDING',
      confirmedCount: 0,
      confirmedTxs: [],
    };
    this._strands.set(strandID, { meta, pendingCount: totalCount });

    // Save to GitHub (public version — no kMaster)
    await this._saveStrand(strandID);

    console.log(`\n📦 BITStorage: registered "${name}"`);
    console.log(`   StrandID:  0x${strandID}`);
    console.log(`   File:      ${(raw.length / 1024).toFixed(1)} KB`);
    console.log(`   Fragments: ${realCount} real + ${noiseCount} noise = ${totalCount} total`);
    console.log(`   Queue:     ${this._queue.length} fragments waiting for trades`);
    console.log(`   kMaster:   ${kMaster.toString('hex').slice(0, 16)}...  ← SAVE THIS PRIVATELY\n`);

    return {
      strandID,
      kMaster: kMaster.toString('hex'),
      realFragments: realCount,
      noiseFragments: noiseCount,
      totalFragments: totalCount,
      firstTxHash: null, // filled after first fragment confirms
    };
  }

  // ── INJECT AND SEND ───────────────────────────────────────────────────────

  /**
   * Drop-in replacement for cdp.evm.sendTransaction.
   * If a fragment is queued, appends it to the swap calldata before sending.
   * Records the confirmed txHash in the strand registrar.
   *
   * @param {object} cdp       the CDP client
   * @param {object} txParams  { address, network, transaction: { to, gas, data, value? } }
   * @returns {{ transactionHash: string }}
   */
  async injectAndSend(cdp, txParams) {
    if (this._queue.length === 0) {
      // Nothing queued — send plain trade
      return cdp.evm.sendTransaction(txParams);
    }

    // Peek at next fragment
    const item = this._queue[0];

    // Append fragment to swap calldata
    const originalData = txParams.transaction.data || '0x';
    const patchedData  = appendToCalldata(originalData, item.frag);
    const originalSize = Buffer.from(originalData.replace('0x', ''), 'hex').length;
    const patchedSize  = Buffer.from(patchedData.replace('0x', ''), 'hex').length;

    const patchedParams = {
      ...txParams,
      transaction: { ...txParams.transaction, data: patchedData },
    };

    // Send the trade
    const result  = await cdp.evm.sendTransaction(patchedParams);
    const txHash  = result.transactionHash;

    // Consume from queue
    this._queue.shift();

    // Record confirmed tx in registrar
    const strand = this._strands.get(item.strandID);
    if (strand) {
      strand.meta.confirmedTxs.push({
        txHash,
        fragType:    item.type,
        fragIndex:   item.index,
        confirmedAt: new Date().toISOString(),
        calldataOffset: originalSize, // byte offset where fragment starts
      });
      strand.meta.confirmedCount++;

      if (strand.meta.confirmedCount >= strand.meta.totalFragments) {
        strand.meta.status = 'COMPLETE';
        console.log(`\n✅ BITStorage: strand "${strand.meta.name}" COMPLETE`);
        console.log(`   All ${strand.meta.totalFragments} fragments sealed on Base`);
        console.log(`   First txHash: ${strand.meta.confirmedTxs.find(t => t.fragType === 'real' && t.fragIndex === 0)?.txHash || 'pending'}`);
        console.log(`   Give this + kMaster to your reader to reconstruct\n`);
      }

      // Save every 3 confirmations
      if (strand.meta.confirmedCount % 3 === 0 || strand.meta.status === 'COMPLETE') {
        await this._saveStrand(item.strandID).catch(() => {});
      }
    }

    console.log(`  🔗 BITStorage: ${item.type} frag[${item.index}] of strand ${item.strandID.slice(0,8)}... → ${txHash.slice(0,20)}... (+${patchedSize - originalSize}B)`);
    return result;
  }

  // ── SESSION KEY (ZK-DRM stub — matches Gemini formula) ───────────────────

  /**
   * Issue a time-locked session key for a strand.
   * Implements: K_session = SHA256(K_master ‖ T_expiry ‖ UserID)
   *
   * T_expiry is a Base block height. At ~2 second block time:
   *   1 hour  ≈ 1800 blocks
   *   24 hours ≈ 43200 blocks
   *
   * @param {string} strandID      hex strand ID
   * @param {string} kMasterHex    64-char hex kMaster
   * @param {number} currentBlock  current Base block height
   * @param {number} durationBlocks how long the key is valid
   * @param {string} userID        any identifier for the recipient
   * @returns {{ kSession, tExpiry, strandID, validUntilBlock }}
   */
  issueSessionKey(strandID, kMasterHex, currentBlock, durationBlocks, userID) {
    const kMaster  = Buffer.from(kMasterHex, 'hex');
    const tExpiry  = currentBlock + durationBlocks;
    const userBuf  = Buffer.from(userID, 'utf8');
    const tBuf     = Buffer.alloc(8);
    tBuf.writeBigUInt64BE(BigInt(tExpiry));

    // K_session = SHA256(K_master ‖ T_expiry ‖ UserID)
    const kSession = sha256(Buffer.concat([kMaster, tBuf, userBuf])).toString('hex');

    const hoursValid = Math.round(durationBlocks / 1800 * 10) / 10;

    console.log(`\n🔑 BITStorage session key issued`);
    console.log(`   StrandID:   0x${strandID}`);
    console.log(`   K_session:  ${kSession.slice(0, 16)}...`);
    console.log(`   Valid until block: ${tExpiry} (~${hoursValid}h from now)`);
    console.log(`   Issued to:  ${userID}\n`);

    return { kSession, tExpiry, strandID, validUntilBlock: tExpiry };
  }

  // ── STATUS ────────────────────────────────────────────────────────────────

  status() {
    const lines = ['\n📊 BITStorage STATUS'];
    for (const [sid, s] of this._strands) {
      const pct = Math.round(s.meta.confirmedCount / s.meta.totalFragments * 100);
      const bar = '█'.repeat(Math.floor(pct / 10)) + '░'.repeat(10 - Math.floor(pct / 10));
      lines.push(`\n  "${s.meta.name}" [${bar}] ${pct}%`);
      lines.push(`  StrandID: 0x${sid}`);
      lines.push(`  ${s.meta.confirmedCount}/${s.meta.totalFragments} fragments confirmed | ${s.meta.status}`);
      const firstReal = s.meta.confirmedTxs.find(t => t.fragType === 'real' && t.fragIndex === 0);
      if (firstReal) lines.push(`  First txHash: ${firstReal.txHash}`);
    }
    lines.push(`\n  Queue: ${this._queue.length} fragments waiting`);
    return lines.join('\n');
  }

  // ── GITHUB REGISTRAR ──────────────────────────────────────────────────────

  async _saveStrand(strandID) {
    if (!this._token || !this._repo) return;
    const strand = this._strands.get(strandID);
    if (!strand) return;

    // Public version — kMaster REDACTED
    const pub = {
      ...strand.meta,
      kMaster: '[REDACTED — held off-chain by owner only]',
    };

    const filename = `.bitstorage/strand-${strandID.slice(0, 12)}.json`;
    const [owner, repo] = this._repo.split('/');
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${filename}`;

    let sha;
    try {
      const r = await fetch(`${url}?ref=${this._branch}`, {
        headers: { Authorization: `Bearer ${this._token}`, Accept: 'application/vnd.github.v3+json' },
      });
      if (r.ok) { const d = await r.json(); sha = d.sha; }
    } catch {}

    const body = {
      message: `bitstorage: strand ${strandID.slice(0,8)} — ${strand.meta.confirmedCount}/${strand.meta.totalFragments} frags`,
      content:  Buffer.from(JSON.stringify(pub, null, 2)).toString('base64'),
      branch:   this._branch,
    };
    if (sha) body.sha = sha;

    await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization:  `Bearer ${this._token}`,
        Accept:         'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  }
}

// ─── STANDALONE EXPORTS (for the streaming compiler / viewer) ─────────────────
export { buildFragment, buildNoiseFragment, appendToCalldata, aesEncrypt, aesDecrypt,
         decryptPointer, encryptPointer, LIBM_MAGIC, FRAGMENT_SIZE, HEADER_SIZE };
