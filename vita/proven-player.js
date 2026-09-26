/**
 * Proven Player — two decode paths, one follow-the-leader registry.
 *
 * Own player. It does not call the feed player, the kids player, or the
 * token player, and it does not share their playback buffers.
 *
 * Paths
 *   dav1d — SVT-AV1 MP4. The browser decoder plays it after the receipt.
 *   av2   — AVM v1.0.0 IVF (fourcc AV02). dav2d is not linked yet, so the
 *           page paints the avmdec reference decode after the same receipt.
 *
 * Pipeline
 *   1. Off chain, each path seals its own short ingest.
 *   2. Each chunk gets a 448-byte receipt (chunk-binding-v1).
 *   3. A local registry accepts those receipts only in order (head + 1).
 *   4. The page verifies the active path, then plays that path.
 *
 * What the receipt proves: the IVF bytes are the bytes that were committed.
 * What it does not prove: bit-exact AVM execution inside a zk-SNARK. The
 * Groth16 slot stays zero until a real verifier is wired.
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
const LEARN_PATH = join(MEMORY_DIR, "proven-player-av2.json");

export const PROVEN_PLAYER_ID = "vita-proven-player-v1";
export const PROVEN_PLAYER_MAGIC = "§VITAPROVENPLAY§";
export const PROVEN_PLAYER_LABEL = "PROVEN_PLAYER";
export const PROVEN_PLAYER_PATH = "/vita/proven-player";
export const CHUNK_TARGET_MS = 5000;
export const DEMO_CHUNK_MS = 800;
export const AV2_SPEC = "AV2 v1.0.0";
export const AV2_SPEC_DATE = "2026-05-28";
export const AVM_COMMIT = "966a7d7cd6fcf60360caf5dc413b2aeeb65e144d";
export const ENCODER_BUILD =
  "AVM v1.0.0|commit=" + AVM_COMMIT + "|cpu-used=9|end-usage=q|qp=43|ivf|fourcc=AV02";
export const DAV1D_ENCODER_BUILD =
  "SVT-AV1 Encoder Lib v1.7.0|preset=10|crf=40|libsvtav1|pix_fmt=yuv420p";

/** Two decode paths on one player. dav1d is the browser path. AV2 is sealed and waiting on dav2d. */
export const PLAY_METHODS = Object.freeze([
  {
    id: "dav1d",
    label: "dav1d",
    codec: "av01",
    display: "video",
    platformDecoder: true,
    note: "SVT-AV1 MP4. Chromium and Firefox decode it with dav1d.",
  },
  {
    id: "av2",
    label: "AV2",
    codec: "av02",
    display: "canvas",
    platformDecoder: false,
    note: "AVM v1.0.0 IVF. dav2d is not linked yet, so the canvas paints the avmdec reference decode.",
  },
]);

export function normalizePlayMethod(raw) {
  const id = String(raw || "").trim().toLowerCase();
  if (id === "av2" || id === "dav2d") return "av2";
  return "dav1d";
}

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
    "AV2 IVF bytes hash to the envelope media digest",
    "4096-byte slice Merkle root matches the envelope",
    "source ingest SHA-256 recorded at AVM encode time is bound",
    "chunk N carries the first 16 bytes of chunk N-1 binding",
  ]),
  doesNotProve: Object.freeze([
    "bit-exact execution of AVM inside a zk-SNARK",
    "that dav2d or a browser decoded the IVF",
    "a Groth16 witness — the 256-byte slot is unwired and must stay zero",
  ]),
});

export const ARCHITECTURE_MERMAID = `flowchart LR
  subgraph offchain [Off-chain prover node]
    YUV[Raw ingest YUV]
    AVM[AVM v1.0.0 cpu-used 9]
    REC[448-byte chunk receipt]
    YUV --> AVM --> IVF[AV2 IVF fourcc AV02]
    AVM --> REC
    IVF --> REC
  end
  subgraph registry [Follow-the-leader registry]
    HEAD[head = last chunk id]
    REC --> HEAD
  end
  subgraph player [Proven Player]
    GATE[Verify receipt]
    REF[AVM reference decode on canvas]
    DAV[dav2d when the host has it]
    HEAD --> GATE
    IVF --> GATE --> REF
    GATE --> DAV
  end
`;

const demoCache = new Map();

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

function methodQuery(method, path) {
  return path + "?method=" + method;
}

function readChunkFile(method, index) {
  const id = "chunk-" + String(index).padStart(3, "0");
  const dir = join(MEDIA_DIR, method);
  const sidePath = join(dir, id + ".json");
  if (!existsSync(sidePath)) return null;
  const side = JSON.parse(readFileSync(sidePath, "utf8"));
  if (method === "dav1d") {
    const mp4Path = join(dir, id + ".mp4");
    if (!existsSync(mp4Path)) return null;
    return { id, bitstream: readFileSync(mp4Path), preview: null, side };
  }
  const ivfPath = join(dir, id + ".ivf");
  const rgbPath = join(dir, id + ".rgb");
  if (!existsSync(ivfPath) || !existsSync(rgbPath)) return null;
  return {
    id,
    bitstream: readFileSync(ivfPath),
    preview: readFileSync(rgbPath),
    side,
  };
}

async function sealDemo(method) {
  const spec = PLAY_METHODS.find((m) => m.id === method);
  const streamKey = method === "av2"
    ? "vita-proven-player/demo-av2-v1"
    : "vita-proven-player/demo-v1";
  const streamId = sha256HexSync(streamKey);
  const encoderText = method === "av2" ? ENCODER_BUILD : DAV1D_ENCODER_BUILD;
  const encoderBuild = await sha256Bytes(new TextEncoder().encode(encoderText));
  const registry = createRegistry();
  const chunks = [];
  let prev = null;
  for (let i = 0; ; i++) {
    const file = readChunkFile(method, i);
    if (!file) break;
    const bitHex = createHash("sha256").update(file.bitstream).digest("hex");
    const expectHex = String(
      file.side.bitstreamSha256 || file.side.av1Sha256 || "",
    ).toLowerCase();
    if (bitHex !== expectHex) throw new Error("sidecar digest drifted for " + method + " " + file.id);
    let previewHex = null;
    if (method === "av2") {
      previewHex = createHash("sha256").update(file.preview).digest("hex");
      if (previewHex !== String(file.side.previewSha256 || "").toLowerCase()) {
        throw new Error("sidecar reference-decode digest drifted for " + file.id);
      }
      if (file.bitstream.subarray(0, 4).toString("ascii") !== "DKIF") {
        throw new Error("IVF magic missing for " + file.id);
      }
      if (file.bitstream.subarray(8, 12).toString("ascii") !== "AV02") {
        throw new Error("AV2 fourcc missing for " + file.id);
      }
    }
    const built = await buildEnvelope({
      chunkIndex: i,
      width: Number(file.side.width) || 160,
      height: Number(file.side.height) || (method === "av2" ? 96 : 90),
      durationMs: Number(file.side.durationMs) || (method === "av2" ? DEMO_CHUNK_MS : 1000),
      streamId,
      sourceDigest: file.side.sourceSha256,
      av1Bytes: file.bitstream,
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
      bitstream: file.bitstream,
      binding: built.bindingHex,
      prevBinding: prev || "00".repeat(16),
    });
    if (!unlocked.ok) throw new Error(unlocked.reason);
    chunks.push({
      chunkIndex: i,
      id: file.id,
      method,
      bytes: file.bitstream.length,
      mime: method === "av2" ? "video/x-ivf" : "video/mp4",
      codec: spec.codec,
      container: method === "av2" ? "ivf" : "mp4",
      fourcc: method === "av2" ? "AV02" : "av01",
      display: spec.display,
      spec: file.side.spec || null,
      width: file.side.width,
      height: file.side.height,
      fps: file.side.fps,
      frames: file.side.frames || null,
      durationMs: file.side.durationMs,
      recipe: file.side.recipe,
      encoder: file.side.encoder,
      sourceSha256: file.side.sourceSha256,
      bitstreamSha256: bitHex,
      previewSha256: previewHex,
      previewFrames: file.side.previewFrames || null,
      previewBytes: file.preview ? file.preview.length : 0,
      platformDecoder: spec.platformDecoder,
      bindingHex: built.bindingHex,
      sliceRootHex: built.sliceRootHex,
      sliceCount: built.sliceCount,
      envelopeHex: bytesToHex(built.envelope),
      chainStatus: "availability",
      baseTx: null,
      cid: null,
      chunkUrl: methodQuery(method, PROVEN_PLAYER_PATH + "/chunk/" + i),
      proofUrl: methodQuery(method, PROVEN_PLAYER_PATH + "/proof/" + i),
      previewUrl: method === "av2" ? methodQuery(method, PROVEN_PLAYER_PATH + "/preview/" + i) : null,
    });
    prev = built.bindingHex;
  }
  if (!chunks.length) throw new Error("proven player media missing for " + method);
  return {
    method,
    streamKey,
    streamId,
    head: chunks.length - 1,
    chunkTargetMs: CHUNK_TARGET_MS,
    demoChunkMs: method === "av2" ? DEMO_CHUNK_MS : 1000,
    chunks,
    registry,
    spec,
  };
}

export function loadDemoStream(method = "dav1d") {
  const id = normalizePlayMethod(method);
  if (!demoCache.has(id)) {
    const pending = sealDemo(id).catch((err) => {
      demoCache.delete(id);
      throw err;
    });
    demoCache.set(id, pending);
  }
  return demoCache.get(id);
}

export async function readChunkBytes(index, method = "dav1d") {
  const id = normalizePlayMethod(method);
  const demo = await loadDemoStream(id);
  const n = Number(index);
  if (!Number.isInteger(n) || n < 0 || n >= demo.chunks.length) return null;
  const file = readChunkFile(id, n);
  return file ? file.bitstream : null;
}

export async function readPreviewBytes(index, method = "av2") {
  const id = normalizePlayMethod(method);
  if (id !== "av2") return null;
  const demo = await loadDemoStream(id);
  const n = Number(index);
  if (!Number.isInteger(n) || n < 0 || n >= demo.chunks.length) return null;
  const file = readChunkFile(id, n);
  return file ? file.preview : null;
}

export async function readChunkProof(index, method = "dav1d") {
  const demo = await loadDemoStream(method);
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
    method: row.method,
    mime: row.mime,
    codec: row.codec,
    container: row.container,
    fourcc: row.fourcc,
    chainStatus: "availability",
    baseTx: null,
  };
}

export async function verifyDemoChunk(index, method = "dav1d") {
  const demo = await loadDemoStream(method);
  const n = Number(index);
  const row = demo.chunks[n];
  if (!row) return { ok: false, reason: "missing-chunk" };
  const bytes = await readChunkBytes(n, method);
  const prev = n === 0 ? "00".repeat(16) : demo.chunks[n - 1].bindingHex;
  return verifyChunkUnlock({
    envelope: row.envelopeHex,
    bitstream: bytes,
    binding: row.bindingHex,
    prevBinding: prev,
  });
}

function methodView(demo) {
  return {
    id: demo.method,
    label: demo.spec.label,
    codec: demo.spec.codec,
    display: demo.spec.display,
    platformDecoder: demo.spec.platformDecoder,
    note: demo.spec.note,
    streamId: demo.streamId,
    head: demo.head,
    chunkTargetMs: demo.chunkTargetMs,
    demoChunkMs: demo.demoChunkMs,
    chunks: demo.chunks.map((c) => ({
      chunkIndex: c.chunkIndex,
      method: c.method,
      bytes: c.bytes,
      mime: c.mime,
      codec: c.codec,
      container: c.container,
      fourcc: c.fourcc,
      display: c.display,
      spec: c.spec,
      width: c.width,
      height: c.height,
      fps: c.fps,
      frames: c.frames,
      durationMs: c.durationMs,
      recipe: c.recipe,
      binding: c.bindingHex,
      bitstreamSha256: c.bitstreamSha256,
      previewSha256: c.previewSha256,
      previewFrames: c.previewFrames,
      previewBytes: c.previewBytes,
      platformDecoder: c.platformDecoder,
      sourceSha256: c.sourceSha256,
      sliceRoot: c.sliceRootHex,
      chainStatus: c.chainStatus,
      baseTx: null,
      cid: null,
      chunkUrl: c.chunkUrl,
      proofUrl: c.proofUrl,
      previewUrl: c.previewUrl,
    })),
  };
}

export async function publicProvenPlayerState({ method = "dav1d" } = {}) {
  const active = normalizePlayMethod(method);
  const methods = [];
  for (const spec of PLAY_METHODS) {
    methods.push(methodView(await loadDemoStream(spec.id)));
  }
  const current = methods.find((m) => m.id === active) || methods[0];
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
      name: "AVM",
      version: "v1.0.0",
      commit: AVM_COMMIT,
      spec: AV2_SPEC,
      specDate: AV2_SPEC_DATE,
      build: ENCODER_BUILD,
      note: "Reference encoder from the AV2 v1.0.0 tag. cpu-used 9, qp 43, IVF fourcc AV02. SVT-AV2 is not this build.",
    },
    decoder: {
      browser: "Switch dav1d or AV2. dav1d plays in the video element. AV2 paints the AVM reference decode until dav2d is linked.",
      native: "libVLC access gate is unlock_for_dav2d. The dav1d path uses the browser decoder.",
      platformDecoder: current.platformDecoder,
    },
    defaultMethod: "dav1d",
    activeMethod: current.id,
    methods,
    chain: {
      status: "availability",
      registryAddress: null,
      baseTx: null,
      cid: null,
      note: "Local follow-the-leader mirror of ZkAv1Registry.sol. No tx hash is invented.",
    },
    stream: current,
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
    "PROVEN PLAYER — dav1d and AV2",
    "Own route " + PROVEN_PLAYER_PATH + ". Switch paths on the page. No shared playback with other players.",
    "Proof " + state.proof.id + " · Groth16 slot unwired.",
    "Chain " + state.chain.status + " · registry address unset · tx unset.",
  ];
  for (const m of state.methods) {
    lines.push(m.label + " · " + m.codec + " · " + (m.platformDecoder ? "browser decoder" : "reference decode"));
    for (const c of m.chunks) {
      lines.push(
        "  #" + c.chunkIndex + " " + c.bytes + "B " + c.codec + " " + c.bitstreamSha256.slice(0, 12),
      );
    }
  }
  lines.push("dav1d plays in the video element. AV2 paints the AVM reference decode until dav2d is linked.");
  return lines.join("\n");
}

export async function handleProvenPlayerAction({ action = "player", chunk = null } = {}) {
  const state = await publicProvenPlayerState();
  const href = provenPlayerHref();
  const keyboard = provenPlayerKeyboard(href);
  if (action === "verify") {
    const indexes = chunk == null ? state.methods[0].chunks.map((c) => c.chunkIndex) : [chunk];
    const results = [];
    for (const m of state.methods) {
      for (const n of indexes) {
        results.push({ method: m.id, chunk: n, ...(await verifyDemoChunk(n, m.id)) });
      }
    }
    const ok = results.every((r) => r.ok);
    const lines = [
      PROVEN_PLAYER_MAGIC + "v1|verify§",
      ok ? "UNLOCKED " + results.length + " chunk(s)" : "LOCKED",
    ];
    for (const r of results) {
      lines.push("  " + r.method + " #" + r.chunk + " " + (r.ok ? "unlocked" : r.reason));
    }
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
    topic: "proven-player-av2",
    label: PROVEN_PLAYER_LABEL,
    magic: PROVEN_PLAYER_MAGIC,
    at: "2026-09-21T18:02:00.000Z",
    formula: FORMULA_ID,
    proofClass: PROOF_STATEMENT.id,
    refinement: [
      "Migrated the Proven Player from SVT-AV1 MP4 to AV2 IVF. Spec is AV2 v1.0.0, 28 May 2026.",
      "Encoder is AVM v1.0.0 commit 966a7d7cd6fcf60360caf5dc413b2aeeb65e144d, cpu-used 9, qp 43, fourcc AV02.",
      "Stock browsers have no AV2 decoder. After the receipt matches, the page paints the avmdec reference decode.",
      "dav2d is the intended software decoder. It is not linked here. The conformance decode for this seal is avmdec from the same tag.",
      "The 448-byte receipt still binds hashes. The Groth16 slot stays zero.",
      "Registry address, Base tx, and IPFS CID stay null.",
    ],
    neverInventHashes: true,
    baseTx: null,
  };
  writeFileSync(LEARN_PATH, JSON.stringify(note, null, 2) + "\n");
  return { wrote: true, path: LEARN_PATH };
}
