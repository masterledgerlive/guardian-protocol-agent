/**
 * Mother Genesis — large-payload plain / encoded inscription path.
 *
 * Does NOT replace vitaSave / inscribeChunk (5-chunk mother brain stays).
 * Telegram dumps bigger than 5 batches use:
 *   /vitamothergenesis …           plain 0-ETH self-txs, N batches as needed
 *   /vitamotherGenesisencoded …    AES + location commitment (ZK-style)
 *   /encodegenesisreveal KEY1 KEY2 pull locs + decode
 *
 * Never invents tx hashes. Never mutes hitch formula. Append-only registry.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export const MOTHER_GENESIS_ID = "vita-mother-genesis-v1";
export const MG_PLAIN_HEADER = "[MGPLAIN:";
export const MG_ENC_HEADER = "[MGENC:";
export const MG_LOCS_HEADER = "[MGLOCS:";
/** Payload bytes per plain/encoded self-tx (header sits outside this budget). */
export const MG_CHUNK_CHARS = 720;
/** Full loc-list pages stay under the same self-tx budget (squash/SNARK later). */
export const MG_LOCLIST_CHARS = 720;

/** @type {Map<string, object>} */
const strands = new Map();

function sha256Hex(text) {
  return createHash("sha256").update(String(text || ""), "utf8").digest("hex");
}

function shortHex(hex, n = 8) {
  return String(hex || "").replace(/^0x/i, "").toLowerCase().slice(0, n);
}

function padIndex(i, total) {
  const width = Math.max(2, String(total).length);
  return String(i).padStart(width, "0") + "/" + String(total).padStart(width, "0");
}

export function resetMotherGenesisRegistry() {
  strands.clear();
}

export function getMotherGenesisStrand(id) {
  return strands.get(String(id || "").toUpperCase()) || null;
}

export function listMotherGenesisStrands() {
  return [...strands.values()].map((s) => ({
    strandId: s.strandId,
    mode: s.mode,
    chunks: s.chunks.length,
    sealed: s.chunks.filter((c) => c.txHash).length,
    at: s.at,
  }));
}

export function serializeMotherGenesisRegistry() {
  return {
    id: MOTHER_GENESIS_ID,
    strands: [...strands.values()],
  };
}

export function setMotherGenesisRegistry(data) {
  strands.clear();
  for (const row of data?.strands || []) {
    if (row?.strandId) strands.set(String(row.strandId).toUpperCase(), row);
  }
}

/** Split body into as many chunks as needed (not capped at 5). */
export function planMotherGenesisChunks(body, { chunkChars = MG_CHUNK_CHARS } = {}) {
  const text = String(body || "");
  const size = Math.max(64, Math.floor(Number(chunkChars) || MG_CHUNK_CHARS));
  if (!text.length) {
    return { ok: false, reason: "empty body — paste code after the command", chunks: [], totalChunks: 0 };
  }
  const chunks = [];
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size));
  }
  return {
    ok: true,
    totalBytes: Buffer.byteLength(text, "utf8"),
    totalChars: text.length,
    chunkChars: size,
    totalChunks: chunks.length,
    chunks,
  };
}

export function mintMotherGenesisIds(mode = "plain") {
  const nonce = randomBytes(8).toString("hex");
  const strandId = "MG-" + (mode === "encoded" ? "E" : "P") + "-" + nonce.slice(0, 10).toUpperCase();
  return { strandId, nonce };
}

/**
 * Commitment that binds locations + content without revealing plaintext.
 * Not a full SNARK circuit — a hash commitment the reveal path verifies.
 */
export function buildLocZeroProof({ strandId, locations, contentCommit, nonce }) {
  const locRoot = sha256Hex((locations || []).map((x) => String(x).toLowerCase()).join("|"));
  const proof = sha256Hex([locRoot, contentCommit, strandId, nonce].join("|"));
  return {
    scheme: "mg-loc-commitment-v1",
    strandId,
    locRoot,
    contentCommit,
    chunkCount: (locations || []).length,
    nonce: String(nonce || ""),
    proof,
    note: "zero-knowledge style: locs + how-to-read are committed; payload stays encoded until two-part reveal",
  };
}

export function verifyLocZeroProof(proof, locations) {
  if (!proof || proof.scheme !== "mg-loc-commitment-v1") {
    return { ok: false, reason: "unknown proof scheme" };
  }
  const locRoot = sha256Hex((locations || []).map((x) => String(x).toLowerCase()).join("|"));
  if (locRoot !== proof.locRoot) {
    return { ok: false, reason: "location root mismatch" };
  }
  const expect = sha256Hex([proof.locRoot, proof.contentCommit, proof.strandId, proof.nonce].join("|"));
  if (expect !== proof.proof) {
    return { ok: false, reason: "proof binding mismatch" };
  }
  return { ok: true, locRoot, chunkCount: proof.chunkCount };
}

function encryptChunk(plain, key32, index) {
  const iv = Buffer.concat([
    Buffer.from("mgenciv!"),
    Buffer.from(String(index).padStart(8, "0")).subarray(0, 4),
  ]).subarray(0, 12);
  const cipher = createCipheriv("aes-256-gcm", key32, iv);
  const enc = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([tag, enc]).toString("base64");
}

function decryptChunk(b64, key32, index) {
  const raw = Buffer.from(String(b64), "base64");
  const tag = raw.subarray(0, 16);
  const data = raw.subarray(16);
  const iv = Buffer.concat([
    Buffer.from("mgenciv!"),
    Buffer.from(String(index).padStart(8, "0")).subarray(0, 4),
  ]).subarray(0, 12);
  const decipher = createDecipheriv("aes-256-gcm", key32, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

export function buildPlainChunkLine({ strandId, index, total, prevHash, body }) {
  return (
    MG_PLAIN_HEADER +
    strandId +
    ":" +
    padIndex(index, total) +
    ":" +
    shortHex(prevHash) +
    "]" +
    body
  );
}

export function buildEncodedChunkLine({ strandId, index, total, prevHash, cipherB64 }) {
  return (
    MG_ENC_HEADER +
    strandId +
    ":" +
    padIndex(index, total) +
    ":" +
    shortHex(prevHash) +
    "]" +
    cipherB64
  );
}

export function parseMotherGenesisLine(utf8) {
  const s = String(utf8 || "");
  const locs = parseMotherGenesisLocListLine(s);
  if (locs) return locs;
  const m = s.match(/^\[(MGPLAIN|MGENC):([^:\]]+):(\d+)\/(\d+):([0-9a-fA-F]+)\]([\s\S]*)$/);
  if (!m) return null;
  return {
    kind: m[1] === "MGENC" ? "encoded" : "plain",
    strandId: m[2],
    index: Number(m[3]),
    total: Number(m[4]),
    prevHash: m[5].toLowerCase(),
    body: m[6],
  };
}

/**
 * On-chain location index — whole list of sealed tx hashes (like §HASHES§ before).
 * Not squashed yet; SNARK compression can fold pages later.
 */
export function buildMotherGenesisLocListPages({
  strandId,
  mode,
  locations,
  contentCommit,
  locRoot = null,
  chunkChars = MG_LOCLIST_CHARS,
} = {}) {
  const locs = (locations || []).map((h) => String(h).toLowerCase()).filter((h) => /^0x[0-9a-f]{64}$/.test(h));
  if (!locs.length) return { ok: false, reason: "no sealed locations to list on-chain", pages: [] };

  const meta =
    "§MGLOCS§" + String(strandId).toUpperCase() + "|" + (mode || "plain") + "|n=" + locs.length + "\n" +
    "§COMMIT§" + String(contentCommit || "") + "\n" +
    (locRoot ? "§ROOT§" + String(locRoot) + "\n" : "") +
    "§LOCLIST§\n";

  const size = Math.max(200, Math.floor(Number(chunkChars) || MG_LOCLIST_CHARS));
  // Pack full 0x… hashes; never truncate a hash across pages.
  const pagesBodies = [];
  let cur = "";
  for (const loc of locs) {
    const next = (cur ? cur + "\n" : "") + loc;
    if (next.length > size && cur) {
      pagesBodies.push(cur);
      cur = loc;
    } else {
      cur = next;
    }
  }
  if (cur) pagesBodies.push(cur);

  const total = pagesBodies.length;
  const pages = pagesBodies.map((body, i) => {
    const header =
      MG_LOCS_HEADER +
      String(strandId).toUpperCase() +
      ":" +
      padIndex(i + 1, total) +
      ":n=" +
      locs.length +
      "]";
    // First page carries meta + LOCLIST; follow-ons are continuation hashes only.
    const line = i === 0 ? header + meta + body : header + "§LOCLIST§\n" + body;
    return {
      index: i + 1,
      total,
      line,
      locationsOnPage: body.split("\n").filter(Boolean),
    };
  });

  return {
    ok: true,
    strandId: String(strandId).toUpperCase(),
    locationCount: locs.length,
    pageCount: pages.length,
    locations: locs,
    pages,
    note: "full loc list on-chain (unsquashed); SNARK squash can compress later",
  };
}

export function parseMotherGenesisLocListLine(utf8) {
  const s = String(utf8 || "");
  const m = s.match(/^\[MGLOCS:([^:\]]+):(\d+)\/(\d+):n=(\d+)\]([\s\S]*)$/);
  if (!m) return null;
  const body = m[5] || "";
  const locations = [...body.matchAll(/0x[0-9a-fA-F]{64}/g)].map((x) => x[0].toLowerCase());
  const commitM = body.match(/§COMMIT§([0-9a-fA-F]*)/);
  const rootM = body.match(/§ROOT§([0-9a-fA-F]*)/);
  return {
    kind: "loclist",
    strandId: m[1],
    index: Number(m[2]),
    total: Number(m[3]),
    locationCount: Number(m[4]),
    contentCommit: commitM ? commitM[1].toLowerCase() : null,
    locRoot: rootM ? rootM[1].toLowerCase() : null,
    locations,
    body,
  };
}

/** Reader key for plain path — finds sealed locations by strand id. */
export function formatPlainReaderKey(strandId) {
  return "MGPLAIN." + String(strandId).toUpperCase();
}

/** Two-part key: part1 finds locs + verifies commitment; part2 decrypts. */
export function formatEncodedTwoPartKey({ strandId, locRoot, secretHex }) {
  const part1 = "MG1." + String(strandId).toUpperCase() + "." + shortHex(locRoot, 16);
  const part2 = "MG2." + String(secretHex);
  return { part1, part2, combined: part1 + " " + part2 };
}

export function parseRevealKey(input) {
  const raw = String(input || "").trim().replace(/\s+/g, " ");
  if (!raw) return { ok: false, reason: "usage: /encodegenesisreveal MG1.… MG2.…  (or MGPLAIN.…)" };

  if (/^MGPLAIN\./i.test(raw)) {
    return { ok: true, mode: "plain", strandId: raw.slice("MGPLAIN.".length).trim().toUpperCase() };
  }

  const parts = raw.split(/[\s|]+/).filter(Boolean);
  let part1 = parts.find((p) => /^MG1\./i.test(p));
  let part2 = parts.find((p) => /^MG2\./i.test(p));
  if (!part1 && parts[0] && parts[1]) {
    part1 = parts[0];
    part2 = parts[1];
  }
  if (!part1 || !part2) {
    return { ok: false, reason: "need two-part key: MG1.<strand>.<locRoot> MG2.<secret>" };
  }
  const a = part1.split(".");
  const strandId = (a[1] || "").toUpperCase();
  const locRootHint = (a[2] || "").toLowerCase();
  const secretHex = part2.replace(/^MG2\./i, "");
  if (!strandId || !/^[0-9a-f]+$/i.test(secretHex) || secretHex.length < 32) {
    return { ok: false, reason: "malformed two-part key" };
  }
  return { ok: true, mode: "encoded", strandId, locRootHint, secretHex };
}

/**
 * Plan plain mother genesis (no chain write yet).
 * Caller supplies sendTx(hexUtf8) → txHash for each chunk.
 */
export function preparePlainMotherGenesis(body, opts = {}) {
  const planned = planMotherGenesisChunks(body, opts);
  if (!planned.ok) return planned;
  const { strandId, nonce } = mintMotherGenesisIds("plain");
  const contentCommit = sha256Hex(String(body));
  const lines = [];
  let prev = "00000000";
  for (let i = 0; i < planned.chunks.length; i++) {
    const line = buildPlainChunkLine({
      strandId,
      index: i + 1,
      total: planned.totalChunks,
      prevHash: prev,
      body: planned.chunks[i],
    });
    const hash = shortHex(sha256Hex(line));
    lines.push({ index: i + 1, total: planned.totalChunks, line, hash, prevHash: prev });
    prev = hash;
  }
  const readerKey = formatPlainReaderKey(strandId);
  return {
    ok: true,
    mode: "plain",
    strandId,
    nonce,
    contentCommit,
    readerKey,
    totalChunks: planned.totalChunks,
    totalChars: planned.totalChars,
    lines,
    note: "plain tx path — N batches as needed; reader key finds locations",
  };
}

export function prepareEncodedMotherGenesis(body, opts = {}) {
  const planned = planMotherGenesisChunks(body, opts);
  if (!planned.ok) return planned;
  const { strandId, nonce } = mintMotherGenesisIds("encoded");
  const secret = randomBytes(32);
  const contentCommit = sha256Hex(String(body));
  const lines = [];
  let prev = "00000000";
  for (let i = 0; i < planned.chunks.length; i++) {
    const cipherB64 = encryptChunk(planned.chunks[i], secret, i + 1);
    const line = buildEncodedChunkLine({
      strandId,
      index: i + 1,
      total: planned.totalChunks,
      prevHash: prev,
      cipherB64,
    });
    const hash = shortHex(sha256Hex(line));
    lines.push({ index: i + 1, total: planned.totalChunks, line, hash, prevHash: prev });
    prev = hash;
  }
  // Placeholder locs → real locs sealed after send; proof rebuilt then.
  const provisionalProof = buildLocZeroProof({
    strandId,
    locations: lines.map((l) => "pending:" + l.index),
    contentCommit,
    nonce,
  });
  const keys = formatEncodedTwoPartKey({
    strandId,
    locRoot: provisionalProof.locRoot,
    secretHex: secret.toString("hex"),
  });
  return {
    ok: true,
    mode: "encoded",
    strandId,
    nonce,
    contentCommit,
    secretHex: secret.toString("hex"),
    keys,
    totalChunks: planned.totalChunks,
    totalChars: planned.totalChars,
    lines,
    provisionalProof,
    note: "encoded path — location commitment + AES; reveal with two-part key",
  };
}

export function registerMotherGenesisStrand(entry) {
  const row = {
    ...entry,
    strandId: String(entry.strandId).toUpperCase(),
    at: entry.at || new Date().toISOString(),
    neverForget: true,
  };
  strands.set(row.strandId, row);
  return row;
}

/**
 * After txs land: seal hashes, rebuild loc proof for encoded, refresh key part1.
 */
export function sealMotherGenesisLocations(strandId, txHashes) {
  const row = strands.get(String(strandId).toUpperCase());
  if (!row) return { ok: false, reason: "strand not found" };
  const hashes = (txHashes || []).filter((h) => /^0x[0-9a-fA-F]{64}$/.test(String(h)));
  if (hashes.length !== row.chunks.length) {
    return { ok: false, reason: "tx hash count must match chunks (never invent hashes)" };
  }
  row.chunks = row.chunks.map((c, i) => ({
    ...c,
    txHash: hashes[i],
    location: hashes[i],
    sealed: true,
  }));
  row.locations = hashes.slice();
  if (row.mode === "encoded") {
    row.proof = buildLocZeroProof({
      strandId: row.strandId,
      locations: hashes,
      contentCommit: row.contentCommit,
      nonce: row.nonce,
    });
    row.keys = formatEncodedTwoPartKey({
      strandId: row.strandId,
      locRoot: row.proof.locRoot,
      secretHex: row.secretHex,
    });
  } else {
    row.readerKey = formatPlainReaderKey(row.strandId);
  }
  strands.set(row.strandId, row);
  return { ok: true, strand: row };
}

export function utf8ToCalldataHex(text) {
  return "0x" + Buffer.from(String(text || ""), "utf8").toString("hex");
}

/**
 * Run inscription with a provided sender.
 * After all chunk txs seal, also writes the FULL location list on-chain
 * (MGLOCS pages — unsquashed; SNARK squash can come later).
 * @param sendTx async (hexData) => txHash | null
 */
export async function runMotherGenesisInscribe(prepared, sendTx) {
  if (!prepared?.ok) return prepared;
  const chunks = [];
  const txHashes = [];
  for (const line of prepared.lines) {
    const hex = utf8ToCalldataHex(line.line);
    const txHash = await sendTx(hex, line);
    if (txHash && !/^0x[0-9a-fA-F]{64}$/.test(String(txHash))) {
      return { ok: false, reason: "sender returned non-hash — refuse invent", chunks, txHashes };
    }
    chunks.push({
      index: line.index,
      total: line.total,
      hash: line.hash,
      linePreview: line.line.slice(0, 80),
      fullLine: line.line,
      txHash: txHash || null,
      sealed: Boolean(txHash),
      location: txHash || null,
    });
    if (txHash) txHashes.push(txHash);
  }

  const entry = {
    strandId: prepared.strandId,
    mode: prepared.mode,
    nonce: prepared.nonce,
    contentCommit: prepared.contentCommit,
    secretHex: prepared.secretHex || null,
    totalChunks: prepared.totalChunks,
    totalChars: prepared.totalChars,
    chunks,
    locations: txHashes.slice(),
    locListPages: [],
    locListTxs: [],
    readerKey: prepared.readerKey || null,
    keys: prepared.keys || null,
    proof: null,
    at: new Date().toISOString(),
  };

  if (txHashes.length === prepared.totalChunks) {
    registerMotherGenesisStrand(entry);
    const sealed = sealMotherGenesisLocations(prepared.strandId, txHashes);
    if (!sealed.ok) return sealed;

    // Whole location list on-chain (like §HASHES§ before) — squash later.
    const locPages = buildMotherGenesisLocListPages({
      strandId: prepared.strandId,
      mode: prepared.mode,
      locations: txHashes,
      contentCommit: prepared.contentCommit,
      locRoot: sealed.strand?.proof?.locRoot || null,
    });
    const locListTxs = [];
    const locListPages = [];
    if (locPages.ok) {
      for (const page of locPages.pages) {
        const hex = utf8ToCalldataHex(page.line);
        const txHash = await sendTx(hex, { kind: "loclist", ...page });
        if (txHash && !/^0x[0-9a-fA-F]{64}$/.test(String(txHash))) {
          return {
            ok: false,
            reason: "loc-list sender returned non-hash — refuse invent",
            strand: sealed.strand,
            locListPages,
            locListTxs,
          };
        }
        locListPages.push({
          index: page.index,
          total: page.total,
          fullLine: page.line,
          locationsOnPage: page.locationsOnPage,
          txHash: txHash || null,
          sealed: Boolean(txHash),
        });
        if (txHash) locListTxs.push(txHash);
      }
    }

    const row = getMotherGenesisStrand(prepared.strandId);
    if (row) {
      row.locListPages = locListPages;
      row.locListTxs = locListTxs;
      row.locListComplete = locListTxs.length === locListPages.length && locListPages.length > 0;
      strands.set(row.strandId, row);
    }

    return {
      ok: true,
      strand: getMotherGenesisStrand(prepared.strandId),
      locListOnChain: true,
      locListTxs,
      locListPageCount: locListPages.length,
      note: "chunk locs sealed; full loc list also inscribed on-chain (unsquashed)",
    };
  }

  // Partial / banked — still register so reveal can wait
  registerMotherGenesisStrand(entry);
  return {
    ok: true,
    banked: txHashes.length < prepared.totalChunks,
    sealedCount: txHashes.length,
    needed: prepared.totalChunks,
    strand: entry,
    reason: txHashes.length
      ? "partial seal — remaining chunks banked until send returns hashes"
      : "no hashes yet — banked locally; reader key reserved; never invent txs",
  };
}

/**
 * Reconstruct from registry + optional fetchCalldata(txHash) → hex.
 */
export async function revealMotherGenesis(keyInput, { fetchCalldata } = {}) {
  const parsed = parseRevealKey(keyInput);
  if (!parsed.ok) return parsed;

  const row = strands.get(parsed.strandId);
  if (!row) {
    return { ok: false, reason: "strand not in registry — run genesis first or restore registry" };
  }

  const locations = (row.locations || row.chunks.map((c) => c.txHash)).filter(Boolean);
  const hasFullLines = row.chunks.every((c) => c.fullLine);
  if (!locations.length && !hasFullLines) {
    return { ok: false, reason: "no sealed locations yet — txs not mined" };
  }

  if (parsed.mode === "encoded") {
    if (row.proof && locations.length) {
      const v = verifyLocZeroProof(row.proof, locations);
      if (!v.ok) return v;
      if (parsed.locRootHint && !row.proof.locRoot.startsWith(parsed.locRootHint)) {
        return { ok: false, reason: "part1 locRoot does not match sealed proof" };
      }
    }
    if (!row.secretHex || row.secretHex !== parsed.secretHex) {
      return { ok: false, reason: "part2 decode secret mismatch" };
    }
  }

  const pieces = [];
  for (let i = 0; i < row.chunks.length; i++) {
    const c = row.chunks[i];
    let utf8 = c.fullLine || null;
    if (!utf8 && c.txHash && typeof fetchCalldata === "function") {
      const hex = await fetchCalldata(c.txHash);
      utf8 = hexToUtf8(hex);
    }

    if (!utf8) {
      pieces.push(null);
      continue;
    }
    const parsedLine = parseMotherGenesisLine(utf8);
    if (!parsedLine) {
      return { ok: false, reason: "chunk " + (i + 1) + " is not mother-genesis format" };
    }
    if (row.mode === "encoded" || parsedLine.kind === "encoded") {
      if (parsed.mode !== "encoded" || !parsed.secretHex) {
        return { ok: false, reason: "encoded strand needs MG1 + MG2 two-part key" };
      }
      pieces.push(decryptChunk(parsedLine.body, Buffer.from(parsed.secretHex, "hex"), parsedLine.index));
    } else {
      pieces.push(parsedLine.body);
    }
  }

  if (pieces.some((p) => p == null)) {
    return {
      ok: false,
      reason: "missing chunk body — provide fetchCalldata or keep fullLine on seal",
      locations,
      missing: pieces.map((p, i) => (p == null ? i + 1 : null)).filter(Boolean),
    };
  }

  const body = pieces.join("");
  if (row.contentCommit && sha256Hex(body) !== row.contentCommit) {
    return { ok: false, reason: "content commitment mismatch after decode" };
  }

  return {
    ok: true,
    mode: row.mode,
    strandId: row.strandId,
    locations,
    locListTxs: row.locListTxs || [],
    totalChunks: row.chunks.length,
    chars: body.length,
    body,
    proof: row.proof || null,
  };
}

export function hexToUtf8(hex) {
  const h = String(hex || "").replace(/^0x/i, "");
  if (!h || h.length % 2) return "";
  try {
    return Buffer.from(h, "hex").toString("utf8");
  } catch {
    return "";
  }
}

/** Store full lines on chunks so local reveal works before Basescan pull. */
export function attachFullLines(strandId, lines) {
  const row = strands.get(String(strandId).toUpperCase());
  if (!row) return null;
  row.chunks = row.chunks.map((c, i) => ({
    ...c,
    fullLine: lines[i]?.line || c.fullLine || null,
  }));
  strands.set(row.strandId, row);
  return row;
}

export function formatMotherGenesisReceipt(result) {
  const s = result.strand || result;
  const lines = [];
  lines.push(s.mode === "encoded" ? "MOTHER GENESIS ENCODED" : "MOTHER GENESIS PLAIN");
  lines.push("strand " + s.strandId);
  lines.push("chunks " + (s.totalChunks || s.chunks?.length || 0) + " (N as needed — not capped at 5)");
  if (result.banked) {
    lines.push("banked " + (result.sealedCount || 0) + "/" + result.needed + " — " + (result.reason || ""));
  }
  const locs = s.locations || [];
  if (locs.length) {
    lines.push("locations (full list):");
    locs.forEach((tx, i) => lines.push("  " + (i + 1) + ". " + tx));
  }
  const locListTxs = s.locListTxs || result.locListTxs || [];
  if (locListTxs.length) {
    lines.push("on-chain loc list (" + locListTxs.length + " MGLOCS page(s), unsquashed):");
    locListTxs.forEach((tx, i) => lines.push("  L" + (i + 1) + ". " + tx));
  } else if (locs.length && result.banked) {
    lines.push("on-chain loc list: pending until all chunk txs seal");
  }
  if (s.mode === "plain" && s.readerKey) {
    lines.push("reader key: " + s.readerKey);
    lines.push("use /reader or /encodegenesisreveal " + s.readerKey);
  }
  if (s.mode === "encoded" && s.keys) {
    lines.push("two-part key:");
    lines.push("  " + s.keys.part1);
    lines.push("  " + s.keys.part2);
    lines.push("reveal: /encodegenesisreveal " + s.keys.combined);
    if (s.proof) {
      lines.push("loc proof " + s.proof.scheme + " root=" + shortHex(s.proof.locRoot, 16));
    }
  }
  return lines.join("\n");
}

/**
 * Rebuild the full location list from on-chain MGLOCS page UTF-8 (or fullLine bank).
 * Pages may be fetched later; order by index.
 */
export function reconstructLocationsFromLocListPages(pages) {
  const ordered = [...(pages || [])].sort((a, b) => Number(a.index) - Number(b.index));
  const locs = [];
  const seen = new Set();
  for (const page of ordered) {
    const parsed = typeof page === "string"
      ? parseMotherGenesisLocListLine(page)
      : parseMotherGenesisLocListLine(page.fullLine || page.line || "");
    if (!parsed || parsed.kind !== "loclist") continue;
    for (const loc of parsed.locations) {
      if (seen.has(loc)) continue;
      seen.add(loc);
      locs.push(loc);
    }
  }
  return locs;
}
