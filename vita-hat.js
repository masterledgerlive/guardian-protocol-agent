/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * 🎩 VITA HAT — Append-only encoded site preservation (Railway-style insert)
 * ───────────────────────────────────────────────────────────────────────────────
 * Same pattern as the Guardian Vault keys:
 *   Railway holds locations (tx hashes / strand id), never the plaintext HTML.
 *   The chain holds encoded bits. Reader pulls every location + how to decode.
 *
 * RULES:
 *   - Always write, never delete. Linear nodal chain (prevHash → thisHash).
 *   - First node is a ONE-BIT test (proof the inject path works).
 *   - Short-term (ST) rides the message hitch; long-term (LT) plans the full site.
 *   - Payload is encoded (hex bit-pack), not plain HTML — proof of hardcoded insert.
 *
 * RAILWAY INSERT (easy, like VAULT_*):
 *   HAT_ROOT_TX        — genesis bit node tx hash (or local node id until inscribed)
 *   HAT_STRAND_ID      — linear strand id
 *   HAT_CONTENT_HASH   — sha256 of canonical site blob at preserve time
 *   HAT_K_MASTER       — optional hex key for encrypted fragment payloads
 *
 * Usage:
 *   node vita-hat.js                 — plan + mint 1-bit test for public/*.html
 *   node vita-hat.js --bit-only      — only emit the genesis bit packet
 *   import { ... } from "./vita-hat.js"
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { createHash, randomBytes } from "crypto";
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Protocol magic — Basescan UTF-8 / calldata readers look for this. */
export const HAT_MAGIC = "§HAT§";
export const HAT_VERSION = "v1";

/** Default paths preserved as the live site proof surface. */
export const DEFAULT_SITE_PATHS = Object.freeze([
  "public/arena.html",
  "public/engine.html",
  "public/board.html",
  "public/v4.html",
]);

/** Hitch payload budgets (bytes of encoded trailer after swap / self-tx). */
export const HITCH_BUDGETS = Object.freeze({
  eureka_tag: 10,
  letter: 256,
  thin: 512,
  kib: 1024,
  fat: 4096,
  fragment: 10 * 1024,
});

// ── Append-only in-memory registry (never spliced / never deleted) ────────────
/** @type {HatNode[]} */
let hatNodes = [];
let hatStrandId = null;
let hatContentHash = null;
let lastHatHash = "00000000";

/**
 * @typedef {object} HatNode
 * @property {number} seq
 * @property {"BIT"|"ST"|"LT"|"CHUNK"} kind
 * @property {string} date
 * @property {string} prevHash
 * @property {string} hash
 * @property {string} packet          encoded packet (not plaintext HTML)
 * @property {string} encoding        how a reader decodes this node
 * @property {object} meta            locations + bit offsets + read recipe
 * @property {string|null} txHash     on-chain location when inscribed
 * @property {string} nodeId          stable local id until chain confirms
 * @property {string} savedAt
 */

export function getHatRegistry() {
  return {
    strandId: hatStrandId,
    contentHash: hatContentHash,
    lastHash: lastHatHash,
    nodes: hatNodes.slice(), // copy — callers cannot mutate chain by reference splice
    neverDelete: true,
    linear: true,
  };
}

export function setHatRegistry(data) {
  if (!data) return;
  hatStrandId = data.strandId || null;
  hatContentHash = data.contentHash || null;
  lastHatHash = data.lastHash || "00000000";
  // Append-only restore: replace only when empty or explicit bootstrap
  hatNodes = Array.isArray(data.nodes) ? data.nodes.slice() : [];
}

export function serializeHatRegistry() {
  return getHatRegistry();
}

/** Refuse deletion — vita memory grows; nodes are permanent. */
export function tryDeleteHatNode() {
  return {
    ok: false,
    reason: "HAT nodes are append-only — never deleted. Write a superseding node instead.",
  };
}

// ── Crypto / encode ───────────────────────────────────────────────────────────

export function hatHash(text) {
  return createHash("sha256").update(text).digest("hex").slice(0, 8);
}

export function contentSha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

/** Canonical multi-file site blob: path + NUL + bytes, concatenated. */
export function buildCanonicalSiteBlob(files) {
  const parts = [];
  for (const f of files) {
    const path = String(f.path || f.name || "file");
    const bytes = Buffer.isBuffer(f.bytes)
      ? f.bytes
      : Buffer.from(f.bytes ?? f.content ?? "", "utf8");
    parts.push(Buffer.from(path, "utf8"), Buffer.from([0]), bytes, Buffer.from([0]));
  }
  return Buffer.concat(parts);
}

/** Bytes → bit array (MSB first per byte). */
export function bytesToBits(buf) {
  const bits = [];
  for (const b of buf) {
    for (let i = 7; i >= 0; i--) bits.push((b >> i) & 1);
  }
  return bits;
}

/** Bit array → bytes (pads trailing zeros to full byte). */
export function bitsToBytes(bits) {
  const out = [];
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0;
    for (let j = 0; j < 8; j++) {
      v = (v << 1) | (bits[i + j] ? 1 : 0);
    }
    out.push(v);
  }
  return Buffer.from(out);
}

/**
 * Encode a slice of bits as hex (packed bytes) — not plaintext HTML.
 * Reader recipe: hex → bytes → bits → place at bitOffset.
 */
export function encodeBitSlice(bits, bitOffset, count) {
  const slice = bits.slice(bitOffset, bitOffset + count);
  const packed = bitsToBytes(slice);
  return {
    encoding: "hat-bitpack-v1",
    bitOffset,
    bitCount: slice.length,
    hex: packed.toString("hex"),
    read: "hex→bytes→MSB-bits; place at bitOffset; ignore pad bits past bitCount",
  };
}

/** Decode one hat-bitpack-v1 hex payload back to bits (truncated to bitCount). */
export function decodeBitSlice({ hex, bitCount }) {
  const bytes = Buffer.from(hex, "hex");
  const bits = bytesToBits(bytes);
  return bits.slice(0, bitCount);
}

export function encodeHatPacket({ kind, seq, prevHash, encoded, meta }) {
  // Encoded body only — no raw HTML. Meta is compact JSON for the reader.
  const body = [
    HAT_MAGIC,
    HAT_VERSION,
    kind,
    String(seq).padStart(4, "0"),
    prevHash,
    encoded.hex || "",
    "META:" + Buffer.from(JSON.stringify(meta), "utf8").toString("base64url"),
  ].join("|");
  return body;
}

export function parseHatPacket(packet) {
  const parts = String(packet).split("|");
  if (parts[0] !== HAT_MAGIC || parts[1] !== HAT_VERSION) {
    throw new Error("HAT packet magic/version mismatch");
  }
  const kind = parts[2];
  const seq = Number(parts[3]);
  const prevHash = parts[4];
  const hex = parts[5] || "";
  const metaB64 = (parts[6] || "").replace(/^META:/, "");
  const meta = metaB64
    ? JSON.parse(Buffer.from(metaB64, "base64url").toString("utf8"))
    : {};
  return { kind, seq, prevHash, hex, meta, encoding: meta.encoding || "hat-bitpack-v1" };
}

export function encodeHexCalldata(text) {
  return "0x" + Buffer.from(text, "utf8").toString("hex");
}

// ── Append node (never delete) ────────────────────────────────────────────────

function appendNode({ kind, encoded, meta, txHash = null }) {
  const seq = hatNodes.length; // linear index — always grows
  const packet = encodeHatPacket({
    kind,
    seq,
    prevHash: lastHatHash,
    encoded,
    meta: { ...meta, encoding: encoded.encoding, read: encoded.read },
  });
  const hash = hatHash(packet);
  const node = {
    seq,
    kind,
    date: new Date().toISOString().slice(0, 10),
    prevHash: lastHatHash,
    hash,
    packet,
    encoding: encoded.encoding,
    meta: {
      ...meta,
      encoding: encoded.encoding,
      read: encoded.read,
      bitOffset: encoded.bitOffset,
      bitCount: encoded.bitCount,
      hex: encoded.hex,
    },
    txHash,
    nodeId: "HAT-" + String(seq).padStart(4, "0") + "-" + hash,
    savedAt: new Date().toISOString(),
  };
  hatNodes.push(node);
  lastHatHash = hash;
  return node;
}

/**
 * Genesis: ONE BIT of the site (bit 0). Always the first written node.
 * Proves inject + encode path before we spend N messages on the full site.
 */
export function mintOneBitTest({ bits, contentHash, strandId, files }) {
  if (hatNodes.length > 0) {
    throw new Error("HAT genesis already written — append CHUNK/ST/LT nodes only");
  }
  hatStrandId = strandId || "HAT-" + randomBytes(4).toString("hex");
  hatContentHash = contentHash;
  lastHatHash = "00000000";

  const encoded = encodeBitSlice(bits, 0, 1);
  const node = appendNode({
    kind: "BIT",
    encoded,
    meta: {
      role: "genesis-one-bit",
      strandId: hatStrandId,
      contentHash,
      files: files.map((f) => ({ path: f.path, bytes: f.bytes.length })),
      totalBits: bits.length,
      neverDelete: true,
      railway: {
        HAT_ROOT_TX: "(set after inscription — this nodeId until then)",
        HAT_STRAND_ID: hatStrandId,
        HAT_CONTENT_HASH: contentHash,
      },
      reader: {
        step1: "Load HAT_ROOT_TX from Railway (or nodeId locally)",
        step2: "Fetch calldata → UTF-8 → parseHatPacket",
        step3: "decodeBitSlice({ hex, bitCount }) → place at bitOffset",
        step4: "Follow next node locations from reader manifest (append-only)",
      },
    },
  });

  // Point Railway insert at genesis
  node.meta.railway.HAT_ROOT_TX = node.nodeId;
  return node;
}

/**
 * Short-term cliff beside the message: what we just proved + next open bit.
 * Long-term plan: full message-count horizon for the site at this hash.
 */
export function mintShortAndLongBesideMessage({
  bits,
  contentHash,
  messageHint = "preserve-site",
  hitchBudgetBytes = HITCH_BUDGETS.letter,
} = {}) {
  if (hatNodes.length === 0) {
    throw new Error("mintOneBitTest first — genesis bit is always written first");
  }
  const plan = planPreservationMessages({
    totalBits: bits.length,
    hitchBudgetBytes,
  });

  const stEncoded = encodeBitSlice(bits, 0, 1); // still one bit — ST carries pointer, not bulk
  const st = appendNode({
    kind: "ST",
    encoded: stEncoded,
    meta: {
      role: "short-term",
      beside: messageHint,
      proved: "genesis-bit-0=" + bits[0],
      contentHashPrefix: contentHash.slice(0, 16),
      nextBit: 1,
      openBits: Math.max(0, bits.length - 1),
      strandId: hatStrandId,
    },
  });

  // LT node: plan only (zero payload bits) — encoded empty hex with bitCount 0
  const ltEncoded = {
    encoding: "hat-bitpack-v1",
    bitOffset: 0,
    bitCount: 0,
    hex: "",
    read: "LT plan node — no payload bits; read meta.plan for message horizons",
  };
  const lt = appendNode({
    kind: "LT",
    encoded: ltEncoded,
    meta: {
      role: "long-term",
      beside: messageHint,
      contentHash,
      strandId: hatStrandId,
      plan,
      note: "Full site is nodal: each CHUNK appends more bits; never deletes prior nodes",
    },
  });

  return { st, lt, plan };
}

/**
 * Append the next encoded chunk of site bits (after the 1-bit proof).
 * Linear: each chunk continues from the highest covered bitOffset+bitCount.
 */
export function mintNextChunk({ bits, maxBits = 64 } = {}) {
  if (hatNodes.length === 0) {
    throw new Error("mintOneBitTest first");
  }
  let covered = 0;
  for (const n of hatNodes) {
    if (n.kind === "BIT" || n.kind === "CHUNK") {
      const end = (n.meta.bitOffset || 0) + (n.meta.bitCount || 0);
      if (end > covered) covered = end;
    }
  }
  if (covered >= bits.length) {
    return { done: true, node: null, covered, totalBits: bits.length };
  }
  const count = Math.min(maxBits, bits.length - covered);
  const encoded = encodeBitSlice(bits, covered, count);
  const node = appendNode({
    kind: "CHUNK",
    encoded,
    meta: {
      role: "site-chunk",
      strandId: hatStrandId,
      contentHash: hatContentHash,
      remainingBits: bits.length - covered - count,
    },
  });
  return {
    done: covered + count >= bits.length,
    node,
    covered: covered + count,
    totalBits: bits.length,
  };
}

// ── Capacity / message planning ───────────────────────────────────────────────

/**
 * How many hitch messages to preserve `totalBits` after the genesis 1-bit test.
 * Encoded packet overhead is included via hitchBudgetBytes (payload room).
 */
export function planPreservationMessages({
  totalBits,
  hitchBudgetBytes = HITCH_BUDGETS.letter,
  bitsPerMessage = null,
} = {}) {
  const bits = Math.max(0, Number(totalBits) || 0);
  // Each hitch carries packed bits; leave ~40% of budget for HAT header/META.
  const payloadBytes =
    bitsPerMessage != null
      ? Math.max(1, Math.ceil(Number(bitsPerMessage) / 8))
      : Math.max(1, Math.floor(hitchBudgetBytes * 0.6));
  const bitsPerMsg = bitsPerMessage != null
    ? Math.max(1, Number(bitsPerMessage))
    : payloadBytes * 8;

  const genesisBits = bits > 0 ? 1 : 0;
  const remaining = Math.max(0, bits - genesisBits);
  const chunkMessages = remaining > 0 ? Math.ceil(remaining / bitsPerMsg) : 0;
  // ST + LT ride beside the first proof message (same session), not extra site bits
  const sideMessages = bits > 0 ? 1 : 0; // one message carries BIT+ST+LT or BIT alone

  return {
    totalBits: bits,
    totalBytes: Math.ceil(bits / 8),
    genesisOneBitMessages: genesisBits > 0 ? 1 : 0,
    chunkMessages,
    sideCarShortLongMessages: sideMessages,
    /** Minimum messages if BIT+ST+LT share one hitch and chunks follow. */
    minMessages: (genesisBits > 0 ? 1 : 0) + chunkMessages,
    /** Conservative: BIT alone, then ST+LT, then chunks. */
    conservativeMessages: (genesisBits > 0 ? 1 : 0) + sideMessages + chunkMessages,
    bitsPerMessage: bitsPerMsg,
    hitchBudgetBytes,
    payloadBytesPerMessage: payloadBytes,
    budgets: Object.fromEntries(
      Object.entries(HITCH_BUDGETS).map(([k, budget]) => {
        const pb = Math.max(1, Math.floor(budget * 0.6));
        const bpm = pb * 8;
        const rem = Math.max(0, bits - genesisBits);
        const chunks = rem > 0 ? Math.ceil(rem / bpm) : 0;
        return [
          k,
          {
            hitchBudgetBytes: budget,
            bitsPerMessage: bpm,
            minMessages: (genesisBits > 0 ? 1 : 0) + chunks,
          },
        ];
      })
    ),
  };
}

export function loadSiteFiles(paths = DEFAULT_SITE_PATHS, root = __dirname) {
  return paths.map((rel) => {
    const abs = join(root, rel);
    if (!existsSync(abs)) throw new Error("missing site file: " + rel);
    return { path: rel, bytes: readFileSync(abs) };
  });
}

/**
 * Full preserve bootstrap: load site → hash → 1-bit genesis → ST+LT plan.
 * Does not touch the chain; returns packets ready to hitch / Railway-insert.
 */
export function bootstrapHatPreservation({
  paths = DEFAULT_SITE_PATHS,
  root = __dirname,
  hitchBudgetBytes = HITCH_BUDGETS.letter,
  reset = true,
} = {}) {
  if (reset) {
    hatNodes = [];
    hatStrandId = null;
    hatContentHash = null;
    lastHatHash = "00000000";
  }
  const files = loadSiteFiles(paths, root);
  const blob = buildCanonicalSiteBlob(files);
  const hash = contentSha256(blob);
  const bits = bytesToBits(blob);
  const bit0 = mintOneBitTest({ bits, contentHash: hash, files });
  const { st, lt, plan } = mintShortAndLongBesideMessage({
    bits,
    contentHash: hash,
    hitchBudgetBytes,
  });

  const railwayInsert = {
    HAT_ROOT_TX: bit0.nodeId,
    HAT_STRAND_ID: hatStrandId,
    HAT_CONTENT_HASH: hash,
    note: "After on-chain inscription, replace HAT_ROOT_TX with the real Base tx hash (same as VAULT_*).",
  };

  return {
    files: files.map((f) => ({ path: f.path, bytes: f.bytes.length })),
    contentHash: hash,
    totalBits: bits.length,
    totalBytes: blob.length,
    genesis: bit0,
    shortTerm: st,
    longTerm: lt,
    plan,
    railwayInsert,
    reader: buildReaderManifest(),
    bits, // for further mintNextChunk in tests / offline packing
  };
}

/**
 * Reader must pull ALL locations and how to read each one.
 * Encoded proof — never returns plaintext HTML from the registry alone.
 */
export function buildReaderManifest() {
  const locations = hatNodes.map((n) => ({
    seq: n.seq,
    kind: n.kind,
    nodeId: n.nodeId,
    location: n.txHash || n.nodeId,
    locationType: n.txHash ? "base-tx" : "local-nodeId-pending-inscribe",
    basescan: n.txHash ? "https://basescan.org/tx/" + n.txHash : null,
    prevHash: n.prevHash,
    hash: n.hash,
    encoding: n.encoding,
    howToRead: {
      fetch: n.txHash
        ? "eth_getTransactionByHash → input calldata → UTF-8"
        : "read local registry packet until Railway HAT_ROOT_TX is set",
      parse: "parseHatPacket(utf8)",
      decode: n.meta.read || "decodeBitSlice({ hex, bitCount })",
      place: {
        bitOffset: n.meta.bitOffset ?? null,
        bitCount: n.meta.bitCount ?? null,
      },
    },
    packetPreview: n.packet.slice(0, 120) + (n.packet.length > 120 ? "…" : ""),
  }));

  return {
    strandId: hatStrandId,
    contentHash: hatContentHash,
    lastHash: lastHatHash,
    neverDelete: true,
    linear: true,
    nodeCount: hatNodes.length,
    railwayEnv: ["HAT_ROOT_TX", "HAT_STRAND_ID", "HAT_CONTENT_HASH", "HAT_K_MASTER"],
    walk: "Start at HAT_ROOT_TX (seq 0 BIT). Verify prevHash chain. Append-only: seq increases by 1.",
    reconstruct: "Collect BIT+CHUNK bits in bitOffset order → bitsToBytes → verify sha256 == HAT_CONTENT_HASH → split canonical blob by path\\0bytes\\0",
    locations,
  };
}

/**
 * Reconstruct bits from registry nodes (BIT + CHUNK only). Does not delete.
 * Returns bytes + ok flag vs content hash when complete enough.
 */
export function reconstructFromHatNodes(nodes = hatNodes, expectHash = hatContentHash) {
  const payloadNodes = nodes
    .filter((n) => n.kind === "BIT" || n.kind === "CHUNK")
    .slice()
    .sort((a, b) => (a.meta.bitOffset || 0) - (b.meta.bitOffset || 0));

  let maxBit = 0;
  const bitMap = new Map();
  for (const n of payloadNodes) {
    const slice = decodeBitSlice({
      hex: n.meta.hex,
      bitCount: n.meta.bitCount,
    });
    const off = n.meta.bitOffset || 0;
    for (let i = 0; i < slice.length; i++) bitMap.set(off + i, slice[i]);
    maxBit = Math.max(maxBit, off + slice.length);
  }
  const bits = [];
  for (let i = 0; i < maxBit; i++) bits.push(bitMap.has(i) ? bitMap.get(i) : 0);
  const bytes = bitsToBytes(bits);
  const hash = contentSha256(bytes);
  return {
    bitsCollected: bitMap.size,
    maxBit,
    bytes,
    hash,
    matchesContentHash: expectHash ? hash === expectHash : null,
    complete: expectHash ? hash === expectHash : false,
    note: "Partial reconstruction expected until all CHUNK nodes are appended.",
  };
}

/** Confirm an inscribed tx onto a node — append-only metadata update via superseding? 
 *  We allow filling txHash on the existing node (location seal), not deleting content.
 */
export function sealHatNodeLocation(nodeIdOrSeq, txHash) {
  const node =
    typeof nodeIdOrSeq === "number"
      ? hatNodes[nodeIdOrSeq]
      : hatNodes.find((n) => n.nodeId === nodeIdOrSeq || n.txHash === nodeIdOrSeq);
  if (!node) return { ok: false, reason: "node not found" };
  if (node.txHash && node.txHash !== txHash) {
    return {
      ok: false,
      reason: "location already sealed to a different tx — write a new node to amend",
    };
  }
  node.txHash = txHash;
  if (node.seq === 0 && node.meta?.railway) {
    node.meta.railway.HAT_ROOT_TX = txHash;
  }
  return { ok: true, node };
}

/** Railway-style env snapshot for easy insert. */
export function railwayHatInsertEnv() {
  const root = hatNodes[0];
  return {
    HAT_ROOT_TX: root?.txHash || root?.nodeId || "",
    HAT_STRAND_ID: hatStrandId || "",
    HAT_CONTENT_HASH: hatContentHash || "",
    HAT_K_MASTER: process.env.HAT_K_MASTER || "",
  };
}

export function loadHatFromRailwayEnv(env = process.env) {
  return {
    HAT_ROOT_TX: env.HAT_ROOT_TX || "",
    HAT_STRAND_ID: env.HAT_STRAND_ID || "",
    HAT_CONTENT_HASH: env.HAT_CONTENT_HASH || "",
    HAT_K_MASTER: env.HAT_K_MASTER || "",
    ready: Boolean(env.HAT_ROOT_TX && env.HAT_CONTENT_HASH),
  };
}

/** Persist registry locally (bot-state style) — append-only file write of full snapshot. */
export function writeHatRegistryFile(path = join(__dirname, "hat-registry.json")) {
  const data = serializeHatRegistry();
  writeFileSync(path, JSON.stringify(data, null, 2));
  return path;
}

export function readHatRegistryFile(path = join(__dirname, "hat-registry.json")) {
  if (!existsSync(path)) return null;
  const data = JSON.parse(readFileSync(path, "utf8"));
  setHatRegistry(data);
  return data;
}

// ── CLI ───────────────────────────────────────────────────────────────────────

const isMain =
  process.argv[1] &&
  String(process.argv[1]).endsWith("vita-hat.js");

if (isMain) {
  const bitOnly = process.argv.includes("--bit-only");
  const outDir = join(__dirname, "artifacts");
  try {
    mkdirSync(outDir, { recursive: true });
  } catch {}

  const boot = bootstrapHatPreservation({
    hitchBudgetBytes: HITCH_BUDGETS.letter,
  });

  if (bitOnly) {
    console.log(JSON.stringify({
      genesis: {
        nodeId: boot.genesis.nodeId,
        kind: boot.genesis.kind,
        packet: boot.genesis.packet,
        bit: boot.genesis.meta.bitCount,
        hex: boot.genesis.meta.hex,
      },
      railwayInsert: boot.railwayInsert,
      totalBits: boot.totalBits,
      planMinMessages: boot.plan.minMessages,
    }, null, 2));
  } else {
    const report = {
      kind: "vita-hat-preserve-plan",
      generatedAt: new Date().toISOString(),
      files: boot.files,
      contentHash: boot.contentHash,
      totalBytes: boot.totalBytes,
      totalBits: boot.totalBits,
      proof: {
        oneBitGenesis: true,
        bit0: Number(boot.genesis.meta.hex ? decodeBitSlice({
          hex: boot.genesis.meta.hex,
          bitCount: 1,
        })[0] : 0),
        nodeId: boot.genesis.nodeId,
        packet: boot.genesis.packet,
      },
      shortTerm: { nodeId: boot.shortTerm.nodeId, kind: "ST" },
      longTerm: { nodeId: boot.longTerm.nodeId, kind: "LT", plan: boot.plan },
      railwayInsert: boot.railwayInsert,
      reader: boot.reader,
      messageHorizons: boot.plan.budgets,
    };
    const outPath = join(outDir, "hat-preserve-plan.json");
    writeFileSync(outPath, JSON.stringify(report, null, 2));
    writeHatRegistryFile(join(outDir, "hat-registry.json"));
    console.log(JSON.stringify(report, null, 2));
    console.error(
      `\n🎩 HAT: ${boot.totalBytes}B / ${boot.totalBits} bits · ` +
      `1-bit proof minted · min messages @256B hitch: ${boot.plan.minMessages} · ` +
      `plan → ${outPath}`
    );
  }
}
