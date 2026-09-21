/**
 * Proven Player — ZK-Streaming Engine client logic.
 *
 * Pipeline: prover node segments media → 448-byte keys → on-chain follow-the-
 * leader registry (class-proof loc until body seals) → client verifies each
 * cell in milliseconds → only then unlocks into the decoder (HTML5 here,
 * libVLC access module in proven/vlc-zk-access.cpp).
 *
 * For kids: same PD catalog Garden plays, but every cell is locked until the
 * key opens. Prefetch+prove cell N+1 while N is playing so the buffer never
 * starves (ByteDance-style pipeline).
 *
 * Never invents tx hashes. Mother brain untouched.
 */

import { FORMULA_ID } from "../../mainframe.js";
import { packetizeFreeMusic, playFreeMusic, listCatalogSongIds } from "../../free-music.js";
import { buildChainBox } from "../chain-box.js";
import { PLAYER_NAMES, listFilerBlocks, LABEL_REFERENCE } from "../filer-registry.js";
import { segmentIntoCells, verifyCell, ZK_PROOF_BYTES, makeCellKey } from "./zk-wrapper.js";

export const PROVEN_PLAYER_ID = "vita-proven-player-v1";
export const PROVEN_PLAYER_MAGIC = "§VITAPROVEN§";
export const PROVEN_PLAYER_LABEL = "PROVEN_PLAYER";
export const PROVEN_ROUTE = "/vita/players/proven";
export const ZK_ENGINE_NAME = "ZK-Streaming Engine";

function cellsFromSong(id = "maple") {
  const packed = packetizeFreeMusic(id);
  if (!packed.ok) return packed;
  let prev = "00".repeat(32);
  const cells = [];
  for (const g of packed.groups || []) {
    const body = Buffer.from(String(g.body || ""), "utf8");
    const segmented = segmentIntoCells(body, { cellBytes: Math.max(body.length, 1), originChunk: cells.length });
    for (const cell of segmented.cells) {
      const keyed = makeCellKey({
        cellHash: cell.cellHash,
        prevHash: prev,
        chunkId: cell.chunkId,
        sequence: cells.length,
      });
      cells.push({
        ...cell,
        keyHex: keyed.keyHex,
        prevHash: prev,
        groupN: g.n,
        filingPath: g.filingPath,
        vinId: g.vinId,
        groupSha: g.sha256,
      });
      prev = cell.cellHash;
    }
  }
  return {
    ok: true,
    id: packed.id,
    title: packed.title,
    mime: packed.mime || "audio/ogg",
    sha256: packed.sha256,
    groupCount: packed.groupCount,
    cellCount: cells.length,
    keyBytes: ZK_PROOF_BYTES,
    cells,
    player: packed.player,
  };
}

export function verifyStreamPrefix(cells, { upTo = 1 } = {}) {
  const out = [];
  let prev = "00".repeat(32);
  const n = Math.max(0, Math.min(cells.length, Number(upTo) || cells.length));
  for (let i = 0; i < n; i++) {
    const c = cells[i];
    const payload = Buffer.from(c.payloadB64, "base64");
    const v = verifyCell({
      payload,
      keyHex: c.keyHex,
      expectHash: c.cellHash,
      prevHash: prev,
    });
    out.push({
      chunkId: c.chunkId,
      sequence: c.sequence,
      groupN: c.groupN,
      open: v.open,
      dropped: v.dropped,
      reason: v.reason || null,
      cellHash: v.cellHash,
      verifyMs: v.verifyMs,
    });
    if (!v.open) break;
    prev = c.cellHash;
  }
  const opened = out.filter((r) => r.open).length;
  return {
    ok: opened === n && n > 0,
    opened,
    checked: out.length,
    total: cells.length,
    rows: out,
    starved: opened === 0,
  };
}

export function publicProvenState({ id = "maple", verify = true } = {}) {
  const box = buildChainBox({ player: "proven", songId: id });
  const stream = cellsFromSong(id);
  if (!stream.ok) {
    return { ok: false, error: stream.reason || "no stream", chainBox: box };
  }
  const proof = verify ? verifyStreamPrefix(stream.cells, { upTo: Math.min(3, stream.cells.length) }) : null;
  const play = playFreeMusic(id);
  return {
    ok: true,
    id: PROVEN_PLAYER_ID,
    filingLabel: PROVEN_PLAYER_LABEL,
    name: PLAYER_NAMES.proven.name,
    engine: ZK_ENGINE_NAME,
    route: PROVEN_ROUTE,
    song: {
      id: stream.id,
      title: stream.title,
      mime: stream.mime,
      sha256: stream.sha256,
      groupCount: stream.groupCount,
      cellCount: stream.cellCount,
    },
    keyBytes: ZK_PROOF_BYTES,
    pipeline: {
      prefetch: 2,
      proveWhilePlaying: true,
      dropOnFail: true,
      decoder: "html5-after-unlock · libVLC access module beside",
    },
    cells: stream.cells.map((c) => ({
      chunkId: c.chunkId,
      sequence: c.sequence,
      groupN: c.groupN,
      bytes: c.bytes,
      cellHash8: String(c.cellHash).slice(0, 8),
      keyBytes: c.keyBytes,
      filingPath: c.filingPath,
    })),
    verifyPrefix: proof,
    play: play.ok
      ? { kind: play.play?.kind, mime: play.play?.mime, name: play.play?.name, dataUrl: play.play?.dataUrl }
      : null,
    chainBox: box,
    catalogIds: listCatalogSongIds(),
    referenceBlocks: listFilerBlocks({ player: "proven", label: LABEL_REFERENCE }),
    architecture: "/vita/players/proven#architecture",
    formula: FORMULA_ID,
    neverInventHashes: true,
    latency:
      "Edge node emits cell N+1 + 448B key while the client plays verified cell N. " +
      "Verification is milliseconds; hardware decode only sees unlocked bytes. " +
      "If a key fails, drop that cell — buffer never accepts tampered data.",
  };
}

export function publicProvenVerify({ id = "maple", chunkId = 1, payloadB64 = null, keyHex = null } = {}) {
  const stream = cellsFromSong(id);
  if (!stream.ok) return { ok: false, error: stream.reason };
  const cell = stream.cells.find((c) => c.chunkId === Number(chunkId)) || stream.cells[0];
  const payload = payloadB64 ? Buffer.from(payloadB64, "base64") : Buffer.from(cell.payloadB64, "base64");
  const v = verifyCell({
    payload,
    keyHex: keyHex || cell.keyHex,
    expectHash: cell.cellHash,
    prevHash: cell.prevHash,
  });
  return {
    ...v,
    chunkId: cell.chunkId,
    player: PROVEN_ROUTE,
    neverInventHashes: true,
  };
}

export { cellsFromSong };
