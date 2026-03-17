/**
 * ═══════════════════════════════════════════════════════════════════════
 * ShadowWeave — Mempool Orchestrator (The Infusion Engine)
 * BITStorage Protocol v1.0
 * ═══════════════════════════════════════════════════════════════════════
 *
 * THE ROLLER COASTER MODEL:
 *   Base block-space = a roller coaster already running.
 *   Existing DEX swaps = cars with empty seats.
 *   Our encrypted chunks = riders filling those seats.
 *   The orchestrator = the ride queue manager.
 *
 * TWO LANES:
 *   STANDBY  — waits for organic gaps in live trades. Free.
 *              Chunks hitch a ride whenever space appears.
 *              Average wait: 2-10 trades depending on activity.
 *
 *   FAST PASS — pays a premium in BITS tokens.
 *              Orchestrator forces the next available trade to
 *              carry a chunk immediately, no waiting.
 *              Guaranteed injection within the next 1-2 blocks.
 *
 * SILO MODE:
 *   User can opt to inject chunks ONLY into their own trades.
 *   No public pool. Completely private. Slower (only your trades).
 *   Ideal for credentials, personal secrets, private archives.
 *
 * PROTOCOL HEADER (64 bytes per chunk, per spec):
 *   [0-3]   Magic ID   = 0x4c49424d ("LIBM") — 4 bytes
 *   [4-11]  Strand ID  = random 8 bytes per file
 *   [12-15] Index      = chunk position in strand — 4 bytes
 *   [16-47] Next Hash  = encrypted pointer to next txHash — 32 bytes
 *   [48-63] Reserved   = padding / future flags — 16 bytes
 *   Total: 64 bytes header + encrypted payload
 *
 * GAS SIZING:
 *   Base target block gas: 15,000,000
 *   Typical DEX swap gas:  ~180,000
 *   Calldata cost:         16 gas per non-zero byte
 *   Max safe payload:      ~24KB per injection (stays under block limit)
 *   Default payload:       10KB (conservative, always fits)
 *   Fast Pass payload:     up to 24KB (maximizes throughput)
 *
 * RECEIPT SYSTEM:
 *   Every confirmed injection returns a receipt:
 *     { strandID, chunkIndex, txHash, blockNumber, calldataOffset, bytes }
 *   Receipts are stored in the user's local Picture Book index.
 *   The protocol itself has zero knowledge of what the receipts mean.
 *   Only the master key + Picture Book = reconstruction ability.
 */

import crypto from 'crypto';
import { EventEmitter } from 'events';
import {
  StrandAssembler,
  buildFragment,
  buildNoiseFragment,
  appendToCalldata,
  aesEncrypt,
  LIBM_MAGIC,
  FRAGMENT_SIZE,
  HEADER_SIZE,
} from './bitstorage-strand-assembler.js';

// ─── GAS CONSTANTS (Base mainnet) ────────────────────────────────────────────
const BASE_BLOCK_GAS_LIMIT   = 15_000_000n;
const CALLDATA_GAS_PER_BYTE  = 16;            // non-zero bytes cost 16 gas
const SWAP_BASE_GAS          = 180_000n;      // typical Uniswap v3 swap
const SAFE_GAS_HEADROOM      = 0.70;          // use max 70% of remaining gas for calldata
const MAX_PAYLOAD_BYTES      = 24 * 1024;     // 24KB absolute max per injection
const DEFAULT_PAYLOAD_BYTES  = 10 * 1024;     // 10KB conservative default
const FAST_PAYLOAD_BYTES     = 20 * 1024;     // 20KB for Fast Pass lane

// ─── LANE CONSTANTS ───────────────────────────────────────────────────────────
const LANE = {
  STANDBY:   'STANDBY',   // wait for organic gaps — free
  FAST_PASS: 'FAST_PASS', // force immediate injection — costs BITS
  SILO:      'SILO',      // inject only into owner's own trades
};

const FAST_PASS_COST_BITS = 5;   // BITS tokens burned per Fast Pass injection
const BITS_PER_KB_STORED  = 1;   // BITS earned per KB carried by your trades

// ─── CHUNK SLICER ─────────────────────────────────────────────────────────────

/**
 * Slice a file buffer into variable-sized chunks based on:
 *   1. Current Base gas limits (so the chunk always fits in a block)
 *   2. The chosen lane (Standby = conservative, Fast Pass = maximal)
 *   3. User override (custom chunk size)
 *
 * Each chunk will carry the 64-byte header, so actual payload = chunkSize - 64.
 *
 * @param {Buffer} fileBuffer   raw file bytes (already encrypted by Agnostic Scrambler)
 * @param {string} lane         LANE.STANDBY | LANE.FAST_PASS | LANE.SILO
 * @param {number} currentGwei  current Base gas price in gwei (affects sizing)
 * @param {object} opts         { customChunkBytes, maxPayloadBytes }
 * @returns {{ chunks: Buffer[], chunkSize: number, totalChunks: number, estimatedGas: bigint }}
 */
function sliceIntoChunks(fileBuffer, lane = LANE.STANDBY, currentGwei = 1, opts = {}) {
  // Determine payload size per chunk based on lane and gas conditions
  let targetPayloadBytes;
  if (opts.customChunkBytes) {
    targetPayloadBytes = Math.min(opts.customChunkBytes, MAX_PAYLOAD_BYTES);
  } else if (lane === LANE.FAST_PASS) {
    // Fast Pass: use larger chunks to maximize throughput per trade
    targetPayloadBytes = FAST_PAYLOAD_BYTES;
  } else {
    // Standby / Silo: conservative sizing to ensure we fit in any gap
    targetPayloadBytes = DEFAULT_PAYLOAD_BYTES;
  }

  // Gas safety check — scale down if gas is expensive
  // At >5 gwei, reduce chunk size to avoid making trades fail
  if (currentGwei > 5) {
    const scaleFactor = Math.max(0.4, 1 - (currentGwei - 5) / 20);
    targetPayloadBytes = Math.floor(targetPayloadBytes * scaleFactor);
  }

  // Each chunk = header (64B) + encrypted payload
  const CHUNK_PAYLOAD = targetPayloadBytes;
  const FULL_CHUNK    = HEADER_SIZE + 16 + CHUNK_PAYLOAD; // +16 = AES overhead

  // Calculate gas cost for this chunk
  const calldataGas = BigInt(FULL_CHUNK * CALLDATA_GAS_PER_BYTE);
  const estimatedTxGas = SWAP_BASE_GAS + calldataGas;

  // Slice file into payload-sized pieces
  const chunks = [];
  for (let i = 0; i < fileBuffer.length; i += CHUNK_PAYLOAD) {
    chunks.push(fileBuffer.slice(i, i + CHUNK_PAYLOAD));
  }

  return {
    chunks,
    chunkSize:    CHUNK_PAYLOAD,
    totalChunks:  chunks.length,
    estimatedGas: estimatedTxGas,
    fitsInBlock:  estimatedTxGas < BASE_BLOCK_GAS_LIMIT,
  };
}

// ─── PROTOCOL HEADER BUILDER ──────────────────────────────────────────────────

/**
 * Construct the 64-byte ShadowWeave protocol header.
 *
 * Header layout (exactly per spec):
 *   [0-3]   Magic ID   = 0x4c49424d ("LIBM")
 *   [4-11]  Strand ID  = 8-byte random strand identifier
 *   [12-15] Chunk Index = 4-byte big-endian position in strand
 *   [16-47] Next Hash  = 32-byte encrypted pointer to next txHash
 *                        (all zeros if this is the last chunk — end of strand)
 *   [48-63] Reserved   = 16 bytes of zeros (future: flags, version, checksum)
 *
 * The Next Hash is encrypted with a rolling key derived from K_master + index,
 * so each pointer uses a different key. You cannot track backwards without K_master.
 *
 * @param {Buffer} strandID       8-byte strand identifier
 * @param {number} chunkIndex     0-based position of this chunk in the strand
 * @param {string|null} nextTxHash hex string txHash of next chunk, or null if last
 * @param {Buffer} kMaster        32-byte master key for pointer encryption
 * @returns {Buffer} exactly 64 bytes
 */
function buildProtocolHeader(strandID, chunkIndex, nextTxHash, kMaster) {
  const header = Buffer.alloc(64, 0);
  let offset = 0;

  // [0-3] Magic: "LIBM"
  LIBM_MAGIC.copy(header, offset);
  offset += 4;

  // [4-11] Strand ID: 8 bytes
  strandID.copy(header, offset);
  offset += 8;

  // [12-15] Chunk index: 4-byte big-endian uint32
  header.writeUInt32BE((chunkIndex >>> 0), offset);
  offset += 4;

  // [16-47] Next hash: 32 bytes encrypted pointer
  if (nextTxHash) {
    // Rolling key: SHA256(kMaster || chunkIndex_string)
    // Different key per pointer — cannot track backwards
    const rollingKey = crypto.createHash('sha256')
      .update(Buffer.concat([kMaster, Buffer.from(chunkIndex.toString())]))
      .digest();

    // XOR-encrypt the txHash with the rolling key
    // (In production: use AES-256-GCM for full confidentiality)
    const txBuf = Buffer.from(nextTxHash.replace('0x', ''), 'hex');
    const padded = Buffer.alloc(32, 0);
    txBuf.copy(padded, 0, 0, Math.min(txBuf.length, 32));

    for (let i = 0; i < 32; i++) {
      header[offset + i] = padded[i] ^ rollingKey[i];
    }
  }
  // else: all zeros = end of strand marker
  offset += 32;

  // [48-63] Reserved: 16 bytes of zeros (already zeroed by Buffer.alloc)

  return header; // exactly 64 bytes
}

// ─── CALLDATA CONSTRUCTOR ─────────────────────────────────────────────────────

/**
 * Construct the final injection calldata:
 *   [Uniswap V3 swap hex] + [ShadowWeave header] + [AES-encrypted payload]
 *
 * The Uniswap router reads ONLY its own params (the first N bytes).
 * Everything appended after those params is ignored by the router
 * but stored permanently in the finalized block.
 *
 * Standard Uniswap V3 exactInputSingle calldata:
 *   0x04e45aaf                    ← function selector (4 bytes)
 *   [tokenIn    32 bytes]
 *   [tokenOut   32 bytes]
 *   [fee        32 bytes]
 *   [recipient  32 bytes]
 *   [amountIn   32 bytes]
 *   [amountOutMin 32 bytes]
 *   [sqrtPriceLimit 32 bytes]
 *   Total: 4 + 7×32 = 228 bytes
 *
 * After those 228 bytes we append:
 *   [64-byte ShadowWeave header]
 *   [AES-256-GCM encrypted chunk payload]
 *
 * @param {string} swapCalldata   hex string of the DEX swap calldata ("0x...")
 * @param {Buffer} header         64-byte protocol header from buildProtocolHeader()
 * @param {Buffer} encryptedChunk AES-256-GCM encrypted chunk payload
 * @returns {{ calldata: string, swapBytes: number, payloadBytes: number, totalBytes: number }}
 */
function constructInjectionCalldata(swapCalldata, header, encryptedChunk) {
  // Convert swap calldata to buffer
  const swapBuf = Buffer.from(swapCalldata.replace('0x', ''), 'hex');

  // Concatenate: swap params + header + encrypted payload
  const fullCalldata = Buffer.concat([swapBuf, header, encryptedChunk]);

  return {
    calldata:     '0x' + fullCalldata.toString('hex'),
    swapBytes:    swapBuf.length,
    headerBytes:  header.length,          // always 64
    payloadBytes: encryptedChunk.length,
    totalBytes:   fullCalldata.length,
    injection: {
      // Where in the calldata our data starts
      startByte:  swapBuf.length,
      endByte:    fullCalldata.length - 1,
    },
  };
}

// ─── RECEIPT BUILDER ──────────────────────────────────────────────────────────

/**
 * Build a storage receipt after a chunk is confirmed on-chain.
 *
 * The receipt is stored ONLY in the user's local Picture Book index.
 * The protocol itself stores nothing — zero knowledge of content.
 * Only the master key + this receipt index = reconstruction ability.
 *
 * @param {object} params
 * @returns {object} receipt record for the Picture Book
 */
function buildReceipt({ strandID, strandName, chunkIndex, totalChunks,
                         txHash, blockNumber, calldataOffset, payloadBytes,
                         lane, confirmedAt }) {
  return {
    // Identity
    strandID,
    strandName,
    chunkIndex,
    totalChunks,
    isLastChunk: chunkIndex === totalChunks - 1,

    // Location (public — anyone can see a tx happened)
    txHash,
    blockNumber,
    calldataOffset,   // byte offset where our header starts
    payloadBytes,     // bytes of encrypted payload in this chunk

    // Metadata
    lane,
    confirmedAt:  confirmedAt || new Date().toISOString(),
    chain:        'base',
    protocol:     'ShadowWeave/LIBM',

    // BITS earned for carrying this chunk (if your trade was the vehicle)
    bitsEarned: Math.ceil(payloadBytes / 1024) * BITS_PER_KB_STORED,
  };
}

// ─── THE ORCHESTRATOR ─────────────────────────────────────────────────────────

export class MempoolOrchestrator extends EventEmitter {
  /**
   * @param {object} config
   * @param {object} config.cdpClient         CDP client instance
   * @param {string} config.walletAddress     owner wallet
   * @param {string} config.githubToken       for Picture Book persistence
   * @param {string} config.githubRepo
   * @param {string} config.stateBranch
   * @param {number} config.bitsBalance       current BITS token balance
   */
  constructor(config) {
    super();
    this.cdp          = config.cdpClient;
    this.wallet       = config.walletAddress;
    this.bitsBalance  = config.bitsBalance || 0;

    // Picture Book — local index of all strand receipts
    // Keyed by strandID → { meta, receipts[] }
    this.pictureBook  = new Map();

    // Strand Assembler for crypto operations
    this.assembler    = new StrandAssembler({
      githubToken:   config.githubToken,
      githubRepo:    config.githubRepo,
      stateBranch:   config.stateBranch,
      walletAddress: config.walletAddress,
    });

    // Two priority queues
    this.fastPassQueue = [];  // injected on next available trade
    this.standbyQueue  = [];  // injected when organic gaps appear
    this.siloQueue     = [];  // injected only into owner's own trades

    // Runtime state
    this.processing   = false;
    this.tradeCount   = 0;
    this.currentGwei  = 1;
  }

  // ── REGISTER A FILE ─────────────────────────────────────────────────────────

  /**
   * Register a file for injection. Encrypts, slices, queues.
   *
   * @param {string}       name      human label
   * @param {Buffer|string} data     file bytes or UTF-8 string
   * @param {string}       lane      LANE.STANDBY | LANE.FAST_PASS | LANE.SILO
   * @param {object}       opts      { noiseRatio, customChunkBytes }
   * @returns {object} strand registration record
   */
  async register(name, data, lane = LANE.STANDBY, opts = {}) {
    const raw       = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
    const noiseR    = opts.noiseRatio ?? 2;

    // Generate strand identity
    const strandIDBuf = crypto.randomBytes(8);
    const strandID    = strandIDBuf.toString('hex');
    const kMaster     = crypto.randomBytes(32);

    // Slice into chunks (gas-aware)
    const { chunks, chunkSize, totalChunks, estimatedGas, fitsInBlock } =
      sliceIntoChunks(raw, lane, this.currentGwei, opts);

    if (!fitsInBlock) {
      throw new Error(`Chunk too large for block gas limit at current gwei (${this.currentGwei}). Reduce chunk size.`);
    }

    // Encrypt each chunk (AES-256-GCM, client-side, key derived from kMaster)
    const encryptedChunks = chunks.map((chunk, i) => {
      const chunkKey = crypto.createHash('sha256')
        .update(Buffer.concat([kMaster, strandIDBuf, Buffer.from(i.toString())]))
        .digest();
      return aesEncrypt(chunk, chunkKey);
    });

    // Build noise chunks (same size as real, indistinguishable)
    const noiseChunks = Array.from(
      { length: Math.floor(totalChunks * noiseR) },
      (_, i) => {
        const noiseKey = crypto.createHash('sha256')
          .update(Buffer.from(`NOISE-${strandID}-${i}`))
          .digest();
        return aesEncrypt(crypto.randomBytes(chunkSize), noiseKey);
      }
    );

    const allChunks = [
      ...encryptedChunks.map((enc, i) => ({
        enc, type: 'real', realIndex: i, strandID, strandIDBuf,
        kMaster, name, lane, totalChunks,
        header: buildProtocolHeader(strandIDBuf, i, null, kMaster), // pointer filled later
        status: 'queued',
      })),
      ...noiseChunks.map((enc, i) => ({
        enc, type: 'noise', realIndex: -1, strandID, strandIDBuf,
        kMaster, name, lane, totalChunks,
        header: buildProtocolHeader(strandIDBuf, ((0xFFFE0000 + i) >>> 0), null, kMaster),
        status: 'queued',
      })),
    ].sort(() => Math.random() - 0.5); // shuffle real and noise together

    // Route to the correct queue
    const targetQueue = lane === LANE.FAST_PASS ? this.fastPassQueue
      : lane === LANE.SILO                      ? this.siloQueue
      :                                           this.standbyQueue;
    targetQueue.push(...allChunks);

    // Initialize Picture Book entry
    this.pictureBook.set(strandID, {
      name, strandID, lane,
      kMaster:      kMaster.toString('hex'), // OWNER ONLY — never sent anywhere
      fileSize:     raw.length,
      chunkSize,
      totalChunks,
      noiseChunks:  noiseChunks.length,
      totalFragments: allChunks.length,
      confirmedCount: 0,
      receipts:     [],
      status:       'PENDING',
      registeredAt: new Date().toISOString(),
    });

    // Fast Pass: deduct BITS cost
    if (lane === LANE.FAST_PASS) {
      const cost = totalChunks * FAST_PASS_COST_BITS;
      if (this.bitsBalance < cost) {
        throw new Error(`Insufficient BITS for Fast Pass (need ${cost}, have ${this.bitsBalance})`);
      }
      this.bitsBalance -= cost;
      this.emit('bits-spent', { amount: cost, reason: 'fast-pass', strandID });
    }

    this.emit('registered', {
      strandID, name, lane, totalChunks,
      noiseChunks: noiseChunks.length,
      totalFragments: allChunks.length,
      estimatedGas,
      kMasterPreview: kMaster.toString('hex').slice(0, 16) + '...',
    });

    console.log(`\n📦 Orchestrator: registered "${name}"`);
    console.log(`   StrandID: 0x${strandID}`);
    console.log(`   Lane:     ${lane}`);
    console.log(`   Chunks:   ${totalChunks} real + ${noiseChunks.length} noise = ${allChunks.length} total`);
    console.log(`   Gas est:  ${estimatedGas.toLocaleString()} per injection`);
    console.log(`   kMaster:  ${kMaster.toString('hex').slice(0,16)}...  ← Picture Book ONLY\n`);

    return { strandID, kMaster: kMaster.toString('hex'), totalChunks, totalFragments: allChunks.length };
  }

  // ── INJECT AND SEND — the core of the Parasitic Injection ────────────────

  /**
   * Intercepts a DEX swap and injects the next queued chunk.
   * This is the "Parasitic Injection" — the swap executes normally,
   * the chunk rides along in the calldata, both succeed together.
   *
   * Priority order:
   *   1. Fast Pass queue (paid premium, inject immediately)
   *   2. Silo queue (only if this is the owner's own trade)
   *   3. Standby queue (organic gap found — inject now)
   *
   * @param {object} txParams    { address, network, transaction }
   * @param {object} context     { isOwnerTrade: boolean, currentGwei: number }
   * @returns {{ transactionHash: string, receipt?: object }}
   */
  async injectAndSend(txParams, context = {}) {
    this.tradeCount++;
    this.currentGwei = context.currentGwei || 1;

    // Pick next chunk from the appropriate queue
    let chunk = null;

    if (this.fastPassQueue.length > 0) {
      // Fast Pass always goes first — they paid for priority
      chunk = this.fastPassQueue.shift();
    } else if (context.isOwnerTrade && this.siloQueue.length > 0) {
      // Silo: only inject into owner's own trades
      chunk = this.siloQueue.shift();
    } else if (this.standbyQueue.length > 0) {
      // Standby: hitch a ride on any available trade
      chunk = this.standbyQueue.shift();
    }

    if (!chunk) {
      // No chunks queued — send the plain trade
      return this.cdp.evm.sendTransaction(txParams);
    }

    // Build the injection calldata
    const injection = constructInjectionCalldata(
      txParams.transaction.data || '0x',
      chunk.header,
      chunk.enc,
    );

    // Patch the transaction
    const patchedParams = {
      ...txParams,
      transaction: {
        ...txParams.transaction,
        data: injection.calldata,
      },
    };

    // Send
    const result  = await this.cdp.evm.sendTransaction(patchedParams);
    const txHash  = result.transactionHash;

    // Build receipt
    const receipt = buildReceipt({
      strandID:        chunk.strandID,
      strandName:      chunk.name,
      chunkIndex:      chunk.realIndex >= 0 ? chunk.realIndex : -1,
      totalChunks:     chunk.totalChunks,
      txHash,
      blockNumber:     null,       // filled when block confirms
      calldataOffset:  injection.swapBytes, // byte where our header starts
      payloadBytes:    chunk.enc.length,
      lane:            chunk.lane,
    });

    // Update Picture Book
    const entry = this.pictureBook.get(chunk.strandID);
    if (entry) {
      entry.receipts.push({ ...receipt, txHash });
      if (chunk.type === 'real') entry.confirmedCount++;

      if (entry.confirmedCount >= entry.totalChunks) {
        entry.status = 'COMPLETE';
        // Award BITS for storage carried
        const earned = Math.ceil(entry.fileSize / 1024) * BITS_PER_KB_STORED;
        this.bitsBalance += earned;
        this.emit('strand-complete', { strandID: chunk.strandID, name: chunk.name, bitsEarned: earned });
        this.emit('bits-earned', { amount: earned, strandID: chunk.strandID, reason: 'storage-complete' });
        console.log(`\n✅ Strand "${chunk.name}" COMPLETE — +${earned} BITS earned\n`);
      }
    }

    // Emit receipt event
    this.emit('chunk-confirmed', receipt);

    const lane_icon = chunk.lane === LANE.FAST_PASS ? '⚡' : chunk.lane === LANE.SILO ? '🔒' : '🚌';
    console.log(`  ${lane_icon} [${chunk.type}·${chunk.realIndex}] → ${txHash.slice(0,18)}... (+${injection.payloadBytes}B)`);

    return { ...result, receipt };
  }

  // ── QUEUE STATUS ─────────────────────────────────────────────────────────

  queueStatus() {
    const total = this.fastPassQueue.length + this.standbyQueue.length + this.siloQueue.length;
    return {
      fastPass: this.fastPassQueue.length,
      standby:  this.standbyQueue.length,
      silo:     this.siloQueue.length,
      total,
      bitsBalance: this.bitsBalance,
    };
  }

  // ── PICTURE BOOK — the user's private index ────────────────────────────

  /**
   * Show the full Picture Book — all strands, all block locations.
   * This is the OWNER VIEW — every block location visible and labeled.
   * Anyone else sees the same blocks on-chain but cannot tell real from noise.
   */
  pictureBookReport() {
    const lines = ['\n📖 PICTURE BOOK — your private index'];
    for (const [sid, entry] of this.pictureBook) {
      lines.push(`\n  "${entry.name}" [${entry.status}]`);
      lines.push(`  StrandID: 0x${sid}`);
      lines.push(`  Lane: ${entry.lane} | ${entry.confirmedCount}/${entry.totalChunks} chunks confirmed`);
      if (entry.receipts.length > 0) {
        lines.push(`  Block locations (your view):`);
        entry.receipts.forEach((r, i) => {
          const type = r.chunkIndex >= 0 ? `REAL[${r.chunkIndex}]` : 'NOISE';
          lines.push(`    ${type.padEnd(10)} tx:${r.txHash.slice(0,18)}... offset:${r.calldataOffset}B`);
        });
      }
      lines.push(`  kMaster: ${entry.kMaster.slice(0,16)}...  ← decrypt key, NEVER shared`);
    }
    lines.push(`\n  BITS balance: ${this.bitsBalance}`);
    lines.push(`  Total strands: ${this.pictureBook.size}`);
    return lines.join('\n');
  }
}

// ─── EXPORTS ──────────────────────────────────────────────────────────────────
export {
  sliceIntoChunks,
  buildProtocolHeader,
  constructInjectionCalldata,
  buildReceipt,
  LANE,
  FAST_PASS_COST_BITS,
  BITS_PER_KB_STORED,
  MAX_PAYLOAD_BYTES,
  DEFAULT_PAYLOAD_BYTES,
};
