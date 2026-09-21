/**
 * Proven Player — royalty-free AV1 stream with a follow-the-leader registry.
 *
 * Own player. It does not call the feed player, the kids player, or the
 * token player, and it does not share their playback buffers.
 *
 * Pipeline
 *   1. Off chain, SVT-AV1 compresses a short ingest into independent chunks.
 *   2. Each chunk gets a 448-byte receipt (chunk-binding-v1). The receipt
 *      binds source digest, AV1 digest, slice Merkle root, and encoder build.
 *   3. A local registry accepts those receipts only in order (head + 1).
 *   4. The browser verifies the receipt, then plays the MP4. Chromium and
 *      Firefox decode AV1 with dav1d. A native libVLC access module is the
 *      same gate, in vita/proven-player/libvlc_access.rs.
 *
 * What the receipt proves: the bytes you decode are the bytes that were
 * committed. What it does not prove: bit-exact SVT-AV1 execution inside a
 * zk-SNARK. That circuit does not fit. The Groth16 slot stays zero until a
 * real verifier is wired, and a nonzero slot is rejected.
 *
 * Chain status stays "availability". No registry address and no Base tx are
 * invented. Proven means a real Input Data loc later — not this file.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FORMULA_ID } from "./mainframe.js";
import {
  ENVELOPE_BYTES,
  bytesToHex,
  hexToBytes,
  merkleRoot,
  sha256Bytes,
  sliceLeaves,
  verifyChunkUnlock,
} from "./proven-player-verify.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const MEDIA_DIR = join(HERE, "proven-player", "media");
const MEMORY_DIR = join(HERE, "memory");
const STRANDS_DIR = join(HERE, "strands");
const LEARN_PATH = join(MEMORY_DIR, "proven-player-learn.json");

export const PROVEN_PLAYER_ID = "vita-proven-player-v1";
export const PROVEN_PLAYER_MAGIC = "§VITAPROVENPLAY§";
export const PROVEN_PLAYER_LABEL = "PROVEN_PLAYER";
export const PROVEN_PLAYER_PATH = "/vita/proven-player";
export const CHUNK_TARGET_MS = 5000;
export const DEMO_CHUNK_MS = 1000;
export const ENCODER_BUILD =
  "SVT-AV1 Encoder Lib v1.7.0|preset=10|crf=40|libsvtav1|pix_fmt=yuv420p";

/** Production origin already used by this avenue. Not a transaction. */
export const PROVEN_PLAYER_ORIGIN =
  "https://guardian-protocol-agent-production.up.railway.app";

export const PROOF_STATEMENT = Object.freeze({
  id: "chunk-binding-v1",
  envelopeBytes: ENVELOPE_BYTES,
  hash: "SHA-256",
  groth16Wired: false,
  proves: Object.freeze([
    "registry binding equals SHA-256 of the 448-byte envelope",
    "AV1 container bytes hash to the envelope av1Digest",
    "4096-byte slice Merkle root matches the envelope",
    "source ingest SHA-256 recorded at SVT-AV1 encode time is bound",
    "chunk N carries the first 16 bytes of chunk N-1 binding",
  ]),
  doesNotProve: Object.freeze([
    "bit-exact execution of SVT-AV1 or libaom inside a zk-SNARK",
    "perceptual quality or that a patent pool was legally avoided",
    "a Groth16 witness — the 256-byte slot is unwired and must stay zero",
  ]),
});

export const ARCHITECTURE_MERMAID = `flowchart LR
  subgraph offchain [Off-chain prover node]
    YUV[Raw ingest YUV]
    SVT[SVT-AV1 preset 10]
    REC[448-byte chunk receipt]
    YUV --> SVT --> AV1[AV1 MP4 chunk]
    SVT --> REC
    AV1 --> REC
  end
  subgraph registry [Follow-the-leader registry]
    HEAD[head = last chunk id]
    REC --> HEAD
  end
  subgraph player [Proven Player]
    GATE[Verify receipt]
    DAV[dav1d via video element or libVLC]
    HEAD --> GATE
    AV1 --> GATE --> DAV
  end
`;

let demoPromise = null;

function sha256HexSync(text) {
  return createHash("sha256").update(text).digest("hex");
}

function u8FromHex(hex) {
  return hexToBytes(hex);
}

function writeU16(view, off, n) {
  view.setUint16(off, n & 0xffff);
}

export function provenPlayerOrigin(env = process.env) {
  const explicit = String(env?.VITA_PUBLIC_URL || env?.VITA_PUBLIC_ORIGIN || "").trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const railway = String(env?.RAILWAY_PUBLIC_DOMAIN || "").trim();
  if (railway) {
    return /^https?:\/\//i.test(railway)
      ? railway.replace(/\/+$/, "")
      : "https://" + railway.replace(/\/+$/, "");
  }
  return PROVEN_PLAYER_ORIGIN;
}

export function provenPlayerHref({ popup = true, env = process.env } = {}) {
  const u = new URL(provenPlayerOrigin(env) + PROVEN_PLAYER_PATH);
  if (popup) u.searchParams.set("popup", "1");
  return u.toString();
}

export function createRegistry() {
  return { streams: new Map() };
}

/**
 * Accept a receipt only when it extends the stream head by one.
 * cid and baseTx stay null unless the caller passes a real value.
 */
export function commitChunk(registry, {
  streamIdHex,
  chunkIndex,
  bindingHex,
  envelope,
  cid = null,
  baseTx = null,
} = {}) {
  const id = String(streamIdHex || "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(id)) return { ok: false, reason: "stream-id" };
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex > 65535) {
    return { ok: false, reason: "chunk-index" };
  }
  if (baseTx != null) return { ok: false, reason: "no-invented-tx" };
  if (cid != null) return { ok: false, reason: "no-invented-cid" };

  let stream = registry.streams.get(id);
  if (!stream) {
    if (chunkIndex !== 0) return { ok: false, reason: "leader-must-start-at-zero" };
    stream = { head: -1, chunks: [] };
    registry.streams.set(id, stream);
  }
  if (chunkIndex !== stream.head + 1) return { ok: false, reason: "follow-the-leader" };

  stream.chunks.push({
    chunkIndex,
    bindingHex: String(bindingHex || "").toLowerCase(),
    envelope,
    cid: null,
    baseTx: null,
    chainStatus: "availability",
  });
  stream.head = chunkIndex;
  return { ok: true, head: stream.head, chainStatus: "availability" };
}

export function latestChunk(registry, streamIdHex) {
  const stream = registry.streams.get(String(streamIdHex || "").toLowerCase());
  if (!stream || stream.head < 0) return null;
  return stream.chunks[stream.head];
}

/**
 * Pack the public receipt. Groth16 bytes are left zero. prevBinding is the
 * previous chunk's 32-byte binding, or empty for chunk 0.
 */
export async function buildEnvelope({
  chunkIndex,
  width,
  height,
  durationMs,
  streamId,
  sourceDigest,
  av1Bytes,
  encoderBuild,
  prevBinding = null,
} = {}) {
  const env = new Uint8Array(ENVELOPE_BYTES);
  env[0] = 0x5a;
  env[1] = 0x4b;
  env[2] = 0x41;
  env[3] = 0x56;
  env[4] = 1;
  env[5] = 0;
  const view = new DataView(env.buffer);
  const leaves = await sliceLeaves(av1Bytes);
  const root = await merkleRoot(leaves);
  const av1Digest = await sha256Bytes(av1Bytes);
  writeU16(view, 6, chunkIndex);
  writeU16(view, 8, leaves.length);
  writeU16(view, 10, width);
  writeU16(view, 12, height);
  writeU16(view, 14, durationMs);
  env.set(u8FromHex(streamId).slice(0, 32), 16);
  env.set(u8FromHex(sourceDigest).slice(0, 32), 48);
  env.set(av1Digest, 80);
  env.set(root, 112);
  const enc = encoderBuild instanceof Uint8Array
    ? encoderBuild
    : await sha256Bytes(new TextEncoder().encode(String(encoderBuild || ENCODER_BUILD)));
  env.set(enc.slice(0, 32), 144);
  const prev = prevBinding == null ? new Uint8Array(16) : u8FromHex(prevBinding).slice(0, 16);
  env.set(prev, 432);
  const binding = await sha256Bytes(env);
  return {
    envelope: env,
    bindingHex: bytesToHex(binding),
    av1DigestHex: bytesToHex(av1Digest),
    sliceRootHex: bytesToHex(root),
    sliceCount: leaves.length,
  };
}

function readChunkFile(index) {
  const id = "chunk-" + String(index).padStart(3, "0");
  const mp4Path = join(MEDIA_DIR, id + ".mp4");
  const sidePath = join(MEDIA_DIR, id + ".json");
  if (!existsSync(mp4Path) || !existsSync(sidePath)) return null;
  const av1 = readFileSync(mp4Path);
  const side = JSON.parse(readFileSync(sidePath, "utf8"));
  return { id, av1, side };
}

async function sealDemo() {
  const streamKey = "vita-proven-player/demo-v1";
  const streamId = sha256HexSync(streamKey);
  const encoderBuild = await sha256Bytes(new TextEncoder().encode(ENCODER_BUILD));
  const registry = createRegistry();
  const chunks = [];
  let prev = null;
  for (let i = 0; ; i++) {
    const file = readChunkFile(i);
    if (!file) break;
    const av1Hex = createHash("sha256").update(file.av1).digest("hex");
    if (av1Hex !== String(file.side.av1Sha256 || "").toLowerCase()) {
      throw new Error("sidecar av1 digest drifted for " + file.id);
    }
    const built = await buildEnvelope({
      chunkIndex: i,
      width: Number(file.side.width) || 160,
      height: Number(file.side.height) || 90,
      durationMs: Number(file.side.durationMs) || DEMO_CHUNK_MS,
      streamId,
      sourceDigest: file.side.sourceSha256,
      av1Bytes: file.av1,
      encoderBuild,
      prevBinding: prev,
    });
    const committed = commitChunk(registry, {
      streamIdHex: streamId,
      chunkIndex: i,
      bindingHex: built.bindingHex,
      envelope: built.envelope,
    });
    if (!committed.ok) throw new Error(committed.reason);
    const unlocked = await verifyChunkUnlock({
      envelope: built.envelope,
      av1Bytes: file.av1,
      binding: built.bindingHex,
      prevBinding: prev || "00".repeat(16),
    });
    if (!unlocked.ok) throw new Error(unlocked.reason);
    chunks.push({
      chunkIndex: i,
      id: file.id,
      bytes: file.av1.length,
      mime: "video/mp4",
      codec: "av01",
      width: file.side.width,
      height: file.side.height,
      durationMs: file.side.durationMs,
      recipe: file.side.recipe,
      encoder: file.side.encoder,
      preset: file.side.preset,
      crf: file.side.crf,
      sourceSha256: file.side.sourceSha256,
      sourceRetained: false,
      av1Sha256: av1Hex,
      bindingHex: built.bindingHex,
      sliceRootHex: built.sliceRootHex,
      sliceCount: built.sliceCount,
      envelopeHex: bytesToHex(built.envelope),
      chainStatus: "availability",
      baseTx: null,
      cid: null,
      chunkUrl: PROVEN_PLAYER_PATH + "/chunk/" + i,
      proofUrl: PROVEN_PLAYER_PATH + "/proof/" + i,
    });
    prev = built.bindingHex;
  }
  if (!chunks.length) throw new Error("proven player media missing");
  return {
    streamKey,
    streamId,
    head: chunks.length - 1,
    chunkTargetMs: CHUNK_TARGET_MS,
    demoChunkMs: DEMO_CHUNK_MS,
    chunks,
    registry,
  };
}

export function loadDemoStream() {
  if (!demoPromise) {
    demoPromise = sealDemo().catch((err) => {
      demoPromise = null;
      throw err;
    });
  }
  return demoPromise;
}

export async function readChunkBytes(index) {
  const demo = await loadDemoStream();
  const n = Number(index);
  if (!Number.isInteger(n) || n < 0 || n >= demo.chunks.length) return null;
  const file = readChunkFile(n);
  return file ? file.av1 : null;
}

export async function readChunkProof(index) {
  const demo = await loadDemoStream();
  const n = Number(index);
  const row = demo.chunks[n];
  if (!row) return null;
  return {
    ok: true,
    proofClass: PROOF_STATEMENT.id,
    groth16Wired: false,
    chunkIndex: row.chunkIndex,
    binding: row.bindingHex,
    envelope: row.envelopeHex,
    mime: row.mime,
    codec: row.codec,
    chainStatus: "availability",
    baseTx: null,
  };
}

export async function verifyDemoChunk(index) {
  const demo = await loadDemoStream();
  const n = Number(index);
  const row = demo.chunks[n];
  if (!row) return { ok: false, reason: "missing-chunk" };
  const bytes = await readChunkBytes(n);
  const prev = n === 0 ? "00".repeat(16) : demo.chunks[n - 1].bindingHex;
  return verifyChunkUnlock({
    envelope: row.envelopeHex,
    av1Bytes: bytes,
    binding: row.bindingHex,
    prevBinding: prev,
  });
}

export async function publicProvenPlayerState() {
  const demo = await loadDemoStream();
  return {
    ok: true,
    id: PROVEN_PLAYER_ID,
    label: PROVEN_PLAYER_LABEL,
    magic: PROVEN_PLAYER_MAGIC,
    player: PROVEN_PLAYER_PATH,
    isolated: true,
    sharesPlaybackWith: [],
    formula: FORMULA_ID,
    proof: PROOF_STATEMENT,
    architectureMermaid: ARCHITECTURE_MERMAID,
    encoder: {
      name: "SVT-AV1",
      version: "1.7.0",
      build: ENCODER_BUILD,
      note: "CPU encoder. Ampere NVENC on an RTX A4500 does not encode AV1. CUDA is not used here.",
    },
    decoder: {
      browser: "HTML video element. Chromium and Firefox hand AV1 to dav1d.",
      native: "vita/proven-player/libvlc_access.rs gates the same bytes into libVLC with dav1d.",
    },
    chain: {
      status: "availability",
      registryAddress: null,
      baseTx: null,
      cid: null,
      note: "Local follow-the-leader mirror of ZkAv1Registry.sol. No tx hash is invented.",
    },
    stream: {
      streamId: demo.streamId,
      head: demo.head,
      chunkTargetMs: demo.chunkTargetMs,
      demoChunkMs: demo.demoChunkMs,
      chunks: demo.chunks.map((c) => ({
        chunkIndex: c.chunkIndex,
        bytes: c.bytes,
        codec: c.codec,
        width: c.width,
        height: c.height,
        durationMs: c.durationMs,
        recipe: c.recipe,
        binding: c.bindingHex,
        av1Sha256: c.av1Sha256,
        sourceSha256: c.sourceSha256,
        sliceRoot: c.sliceRootHex,
        chainStatus: c.chainStatus,
        baseTx: null,
        cid: null,
        chunkUrl: c.chunkUrl,
        proofUrl: c.proofUrl,
      })),
    },
    neverInventHashes: true,
  };
}

function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function parseProvenPlayerCommand(raw) {
  const src = String(raw || "").trim();
  const low = src.toLowerCase();
  if (low === "/provenplayer" || low === "/zkplayer" || low === "/zkav1") {
    return { ok: true, action: "player" };
  }
  if (low === "/provenplayer manifest" || low === "/zkplayer manifest") {
    return { ok: true, action: "manifest" };
  }
  if (low === "/provenplayer verify" || low === "/zkplayer verify") {
    return { ok: true, action: "verify" };
  }
  const m = low.match(/^\/(?:provenplayer|zkplayer) verify (\d+)$/);
  if (m) return { ok: true, action: "verify", chunk: Number(m[1]) };
  if (low.startsWith("/provenplayer") || low.startsWith("/zkplayer") || low.startsWith("/zkav1")) {
    return { ok: false, action: null, reason: "usage" };
  }
  return { ok: false, action: null };
}

export function provenPlayerKeyboard(href) {
  return {
    inline_keyboard: [
      [{ text: "Open Proven Player", url: href }],
      [
        { text: "Verify", callback_data: "/provenplayer verify" },
        { text: "Manifest", callback_data: "/provenplayer manifest" },
      ],
      [
        { text: "Players", callback_data: "/home players" },
        { text: "HOME", callback_data: "/home" },
      ],
    ],
  };
}

function formatPlayerCard(state) {
  const lines = [
    PROVEN_PLAYER_MAGIC + "v1|player§",
    "PROVEN PLAYER — AV1 chunk binding",
    "Own route " + PROVEN_PLAYER_PATH + ". No shared playback with other players.",
    "Encoder " + state.encoder.version + " preset 10 CRF 40.",
    "Proof " + state.proof.id + " · Groth16 slot unwired.",
    "Chain " + state.chain.status + " · registry address unset · tx unset.",
    "Head chunk " + state.stream.head + " · stream " + state.stream.streamId.slice(0, 12),
  ];
  for (const c of state.stream.chunks) {
    lines.push(
      "  #" + c.chunkIndex + " " + c.bytes + "B av1 " + c.av1Sha256.slice(0, 12) + " bind " + c.binding.slice(0, 12),
    );
  }
  lines.push("Unlock checks the receipt, then the video element decodes with dav1d.");
  return lines.join("\n");
}

export async function handleProvenPlayerAction({ action = "player", chunk = null } = {}) {
  const state = await publicProvenPlayerState();
  const href = provenPlayerHref();
  const keyboard = provenPlayerKeyboard(href);
  if (action === "verify") {
    const indexes = chunk == null ? state.stream.chunks.map((c) => c.chunkIndex) : [chunk];
    const results = [];
    for (const n of indexes) results.push({ chunk: n, ...(await verifyDemoChunk(n)) });
    const ok = results.every((r) => r.ok);
    const lines = [
      PROVEN_PLAYER_MAGIC + "v1|verify§",
      ok ? "UNLOCKED " + results.length + " chunk(s)" : "LOCKED",
    ];
    for (const r of results) lines.push("  #" + r.chunk + " " + (r.ok ? "unlocked" : r.reason));
    lines.push("Groth16 remains unwired. Chain status availability. No tx invented.");
    const reply = lines.join("\n");
    return {
      ok,
      action: "verify",
      reply,
      html: "<pre>" + esc(reply) + "</pre>",
      keyboard,
      href,
      results: results.map((r) => ({ chunk: r.chunk, ok: r.ok, reason: r.reason })),
    };
  }
  const reply = action === "manifest"
    ? formatPlayerCard(state) + "\nManifest JSON: " + PROVEN_PLAYER_PATH + "/api"
    : formatPlayerCard(state);
  return {
    ok: true,
    action: action === "manifest" ? "manifest" : "player",
    reply,
    html: "<pre>" + esc(reply) + "</pre>",
    keyboard,
    href,
    state,
  };
}

export function ensureProvenPlayerLearn() {
  if (!existsSync(MEMORY_DIR)) mkdirSync(MEMORY_DIR, { recursive: true });
  if (!existsSync(STRANDS_DIR)) mkdirSync(STRANDS_DIR, { recursive: true });
  if (existsSync(LEARN_PATH)) return { wrote: false, path: LEARN_PATH };
  const note = {
    topic: "proven-player",
    label: PROVEN_PLAYER_LABEL,
    magic: PROVEN_PLAYER_MAGIC,
    at: "2026-09-21T17:41:00.000Z",
    formula: FORMULA_ID,
    proofClass: PROOF_STATEMENT.id,
    refinement: [
      "Full SVT-AV1 inside a 448-byte Groth16 is not a real circuit. The receipt binds hashes.",
      "SVT-AV1 1.7.0 encoded three 1-second 160x90 AV1 MP4 chunks on CPU. Demo chunks are shorter than the 5-second protocol target so the leader sequence is visible.",
      "dav1d 1.4.1 decoded the containers through ffmpeg. The browser player uses the platform AV1 decoder, which is dav1d on Chromium and Firefox.",
      "Registry address, Base tx, and IPFS CID stay null. Availability until a real loc is sealed.",
      "This player does not route through feed-player, kids-player, or token-player.",
    ],
    neverInventHashes: true,
    baseTx: null,
  };
  writeFileSync(LEARN_PATH, JSON.stringify(note, null, 2) + "\n");
  return { wrote: true, path: LEARN_PATH };
}
