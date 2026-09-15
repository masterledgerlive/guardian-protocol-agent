/**
 * VITAFEED Tailwind reader — assemble spaced locations → play file proof.
 *
 * After /vitafeed confirm|override seals every VIN packet, the reader:
 *   1. Walks sealed Basescan locations (never invents hashes)
 *   2. Rebuilds §VITAFILE§ (or plain UTF-8)
 *   3. Returns play payload + spaced-chain visual proof
 *
 * Mother brain untouched. Uses hat-exit spaced proof math for location count.
 */

import { buildSpacedChainProof } from "../hat-exit-receipt.js";
import {
  VITAFEED_BASESCAN_TX,
  parseVitaFeedLine,
  reconstructVitaFeedBody,
} from "./vita-feed.js";
import {
  isVitaFileBody,
  parseVitaFileBody,
  reconstructVitaFileFromLines,
  summarizeVitaFileForCard,
  vitaFeedLinesFromStrand,
} from "./vita-feed-file.js";

export const VITA_FEED_PLAYER_ID = "vita-feed-player-v1";

/**
 * Locations from an inscription result / strand — real hashes only.
 */
export function sealedFeedLocations(strand = {}) {
  const chunks = strand.chunks || [];
  const locs = [];
  for (const c of chunks) {
    const tx = c.txHash || c.location || null;
    if (!tx || !/^0x[0-9a-fA-F]{64}$/.test(String(tx))) continue;
    locs.push({
      index: c.index ?? locs.length + 1,
      total: c.total ?? strand.totalChunks ?? null,
      location: tx,
      basescan: c.basescan || VITAFEED_BASESCAN_TX + tx,
      vinId: c.vinId || strand.vinId,
      prevHash: c.prevHash,
      nextPtr: c.nextPtr,
      bodyBytes: c.bodyBytes,
      sealed: true,
      blockNumber: c.blockNumber ?? null,
    });
  }
  if (!locs.length && Array.isArray(strand.locations)) {
    strand.locations.forEach((tx, i) => {
      if (!/^0x[0-9a-fA-F]{64}$/.test(String(tx))) return;
      locs.push({
        index: i + 1,
        total: strand.locations.length,
        location: tx,
        basescan: VITAFEED_BASESCAN_TX + tx,
        sealed: true,
        blockNumber: null,
      });
    });
  }
  return locs;
}

/**
 * Demo / local seal: assign synthetic spaced block numbers (never claim on-chain).
 */
export function demoSealFeedLines(prepared, { blockStart = 37_000_000, spacing = 3 } = {}) {
  if (!prepared?.ok || !prepared.lines?.length) {
    return { ok: false, reason: prepared?.reason || "nothing to demo-seal" };
  }
  const chunks = prepared.lines.map((line, i) => {
    // Deterministic fake-looking hex from content hash — LABELED DEMO ONLY.
    // Must not be treated as a real Base tx (never invent for LIVE receipts).
    const h = String(line.hash || "deadbeef").padEnd(64, "0").slice(0, 64);
    const txHash = "0x" + h.replace(/[^0-9a-f]/gi, "0").toLowerCase().padEnd(64, "0").slice(0, 64);
    return {
      ...line,
      fullLine: line.line,
      txHash,
      location: txHash,
      sealed: true,
      basescan: null, // demo — do not link fake hashes as Basescan truth
      blockNumber: blockStart + i * spacing,
      demo: true,
    };
  });
  return {
    ok: true,
    demo: true,
    strand: {
      vinId: prepared.vinId,
      mode: prepared.mode || "plain",
      readerKey: prepared.readerKey,
      contentCommit: prepared.contentCommit,
      totalChunks: prepared.totalChunks,
      totalBytes: prepared.totalBytes,
      totalChars: prepared.totalChars,
      file: prepared.file || null,
      chunks,
      locations: chunks.map((c) => c.txHash),
      at: new Date().toISOString(),
      note: "DEMO seal — synthetic locations for player UI; never claim LIVE",
    },
  };
}

/**
 * Build play-proof from a sealed (or demo) strand + optional raw body.
 */
export function buildVitaFeedPlayProof({
  strand = {},
  body = null,
  lines = null,
  label = "LIVE",
} = {}) {
  const locs = sealedFeedLocations(strand);
  const feedLines = lines || vitaFeedLinesFromStrand(strand);
  let file = null;
  let plainBody = body;
  let rebuildOk = false;

  if (feedLines.length) {
    const rebuilt = reconstructVitaFileFromLines(feedLines);
    rebuildOk = rebuilt.ok === true;
    if (rebuilt.isVitaFile) {
      file = rebuilt.ok
        ? {
            name: rebuilt.name,
            mime: rebuilt.mime,
            playKind: rebuilt.playKind,
            rawBytes: rebuilt.rawBytes,
            sha256: rebuilt.sha256,
            dataUrl: rebuilt.dataUrl,
            data: rebuilt.data,
          }
        : { error: rebuilt.reason, isVitaFile: true };
    } else if (rebuilt.ok) {
      plainBody = rebuilt.body;
    }
  } else if (body != null && isVitaFileBody(body)) {
    const parsed = parseVitaFileBody(body);
    rebuildOk = parsed.ok;
    file = parsed.ok
      ? {
          name: parsed.name,
          mime: parsed.mime,
          playKind: parsed.playKind,
          rawBytes: parsed.rawBytes,
          sha256: parsed.sha256,
          dataUrl: parsed.dataUrl,
          data: parsed.data,
        }
      : { error: parsed.reason, isVitaFile: true };
  } else if (typeof body === "string") {
    plainBody = body;
    rebuildOk = true;
  }

  const totalUnits = Math.max(
    locs.length,
    strand.totalChunks || 0,
    feedLines.length,
    1,
  );
  const confirmed = locs.length;
  const spacedProof = buildSpacedChainProof({
    locations: locs,
    totalBits: totalUnits,
    confirmedBits: confirmed,
  });
  // Re-label picture → file/media for this player
  const complete =
    confirmed > 0 &&
    confirmed >= (strand.totalChunks || confirmed) &&
    rebuildOk &&
    !(file && file.error);

  const pieces = locs.map((l, i) => ({
    i: i + 1,
    location: l.location,
    basescan: l.basescan,
    blockNumber: l.blockNumber,
    sealed: l.sealed !== false,
    label: padPiece(i + 1, locs.length),
  }));

  return {
    ok: complete || (rebuildOk && confirmed === 0 && label === "LOCAL"),
    id: VITA_FEED_PLAYER_ID,
    label,
    vinId: strand.vinId || null,
    readerKey: strand.readerKey || null,
    mode: file ? "vitafile" : "plain",
    complete,
    sealedCount: confirmed,
    needed: strand.totalChunks || confirmed,
    locations: locs,
    pieces,
    spacedProof: {
      ...spacedProof,
      pictureComplete: complete,
      proofLine: complete
        ? `File assembled from ${confirmed} spaced blockchain location${confirmed === 1 ? "" : "s"}` +
          (spacedProof.spacedBlocks > 0
            ? ` across ${spacedProof.spacedBlocks} block${spacedProof.spacedBlocks === 1 ? "" : "s"}`
            : "")
        : spacedProof.proofLine.replace(/^Picture|^Image/, "File"),
    },
    file,
    plainBody: file ? null : plainBody,
    play: file && file.dataUrl
      ? {
          kind: file.playKind,
          mime: file.mime,
          name: file.name,
          dataUrl: file.dataUrl,
        }
      : plainBody != null
        ? { kind: "text", mime: "text/plain", name: "body.txt", text: plainBody }
        : null,
    card: formatPlayProofCard({
      complete,
      sealedCount: confirmed,
      needed: strand.totalChunks || confirmed,
      spacedProof,
      file,
      vinId: strand.vinId,
      readerKey: strand.readerKey,
      label,
    }),
  };
}

function padPiece(i, total) {
  const w = Math.max(2, String(total).length);
  return String(i).padStart(w, "0") + "/" + String(total).padStart(w, "0");
}

export function formatPlayProofCard({
  complete,
  sealedCount,
  needed,
  spacedProof,
  file,
  vinId,
  readerKey,
  label = "LIVE",
} = {}) {
  const lines = [];
  lines.push("VITAFEED PLAY PROOF · " + label + (complete ? " · COMPLETE" : " · IN PROGRESS"));
  if (vinId) lines.push("VIN " + vinId);
  if (readerKey) lines.push("reader " + readerKey);
  if (file && !file.error) {
    lines.push(summarizeVitaFileForCard(file));
  } else if (file?.error) {
    lines.push("VITAFILE error: " + file.error);
  }
  lines.push(
    "locations " + (sealedCount || 0) + "/" + (needed || 0) +
    " spaced · " + (spacedProof?.spacedBlockchainLocations ?? sealedCount ?? 0) + " txs",
  );
  if (spacedProof?.proofLine) lines.push(spacedProof.proofLine);
  lines.push(
    complete
      ? "PLAY — Tailwind reader peaces locations together and plays the blob"
      : "Wait for every VIN packet seal — never invent a missing hash",
  );
  return lines.join("\n");
}

/**
 * After override/confirm inscription — attach play proof when body is VITAFILE
 * or when operator asked for play-on-complete.
 */
export function playProofFromInscribeResult(result, { body = null, label = "LIVE" } = {}) {
  if (!result?.ok && !result?.strand) {
    return {
      ok: false,
      reason: result?.reason || "no inscription result",
      card: "VITAFEED PLAY PROOF — nothing sealed",
    };
  }
  const strand = result.strand || result;
  const proof = buildVitaFeedPlayProof({
    strand,
    body: body || null,
    label: result.demo ? "DEMO" : label,
  });
  return proof;
}

/**
 * Progressive visual state: which piece index just sealed (1-based).
 */
export function pieceTogetherState({ sealedCount = 0, needed = 0, pieces = [] } = {}) {
  const need = Math.max(needed, pieces.length, sealedCount);
  const slots = [];
  for (let i = 0; i < need; i++) {
    const p = pieces[i];
    slots.push({
      i: i + 1,
      filled: i < sealedCount,
      location: p?.location || null,
      basescan: p?.basescan || null,
    });
  }
  return {
    sealedCount,
    needed: need,
    complete: need > 0 && sealedCount >= need,
    slots,
    progressPct: need > 0 ? Math.min(100, Math.round((sealedCount / need) * 100)) : 0,
  };
}

/**
 * Reconstruct body from raw UTF-8 calldata strings (already VIN-wrapped).
 */
export function playFromUtf8Calldata(utf8Lines, opts = {}) {
  const lines = (utf8Lines || []).map((u) => {
    const p = parseVitaFeedLine(u);
    return p ? u : null;
  }).filter(Boolean);
  if (!lines.length) {
    const joined = reconstructVitaFeedBody(utf8Lines);
    if (!joined.ok) return { ok: false, reason: "no VITAFEED lines" };
    return buildVitaFeedPlayProof({
      strand: { totalChunks: 0, locations: [], chunks: [] },
      body: joined.body,
      label: opts.label || "LOCAL",
    });
  }
  const strand = {
    vinId: parseVitaFeedLine(lines[0])?.vinId,
    totalChunks: lines.length,
    chunks: lines.map((line, i) => ({
      index: i + 1,
      total: lines.length,
      fullLine: line,
      line,
      txHash: opts.locations?.[i] || null,
      location: opts.locations?.[i] || null,
    })),
    locations: (opts.locations || []).filter((h) => /^0x[0-9a-fA-F]{64}$/.test(String(h))),
    readerKey: opts.readerKey || null,
  };
  return buildVitaFeedPlayProof({ strand, lines, label: opts.label || "LOCAL" });
}
