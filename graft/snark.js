/**
 * GRAFT snark-short — content-commitment squash for long code / libraries.
 * Off-chain proof class: never invents tx hashes. Instant unwrap for open data.
 * Activate + think read from local CAS — GitHub is optional inject inlet only.
 */

import { createHash } from "node:crypto";
import { sha256hex, shortId } from "./hash.js";

export const SNARK_CLASS = "graft-content-commitment-v1";
export const SNARK_MAGIC = "§GRAFTSNARK§";

function sha256bytes(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function clip(text, n = 64) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  return t.length <= n ? t : t.slice(0, n - 1) + "…";
}

/**
 * Local location — always present after file. Chain loc stays empty until harvest.
 * Format: cas://sha256:<64hex>
 */
export function casLocation(contentHash) {
  const id = String(contentHash || "").replace(/^0x/i, "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(id)) return null;
  return `cas://sha256:${id}`;
}

/**
 * Pack open English + machine form + optional file list into a snark-ready short.
 * Witness is public (open-source filing). No private key.
 */
export function packSnarkShort({
  english = "",
  machine = "",
  contentHash = null,
  title = null,
  bytes = 0,
  files = [],
} = {}) {
  const fileBits = (files || [])
    .map((f) => `${f.name || f.path || "?"}:${shortId(f.hash || "", 8)}`)
    .join(",");
  const commit = contentHash
    || sha256hex([english, machine, fileBits, String(bytes)].join("¦"));
  const loc = casLocation(commit);
  const short =
    `${SNARK_MAGIC}` +
    shortId(commit, 12) +
    (title ? `|T=${clip(title, 40)}` : "") +
    (bytes ? `|B=${bytes}` : "") +
    (files?.length ? `|N=${files.length}` : "") +
    (fileBits ? `|F=${clip(fileBits, 80)}` : "") +
    `|M=${clip(machine || english, 48)}`;
  return {
    zkClass: SNARK_CLASS,
    snarkReady: true,
    privateWitness: false,
    instantUnwrap: true,
    openSource: true,
    short,
    commit,
    loc,
    bytes: Number(bytes) || 0,
    fileCount: (files || []).length,
    neverInventHashes: true,
    note: "Local cas:// location always. Chain loc empty until human harvest into VITA.",
  };
}

export function unwrapSnarkShort(packed, { english, machine } = {}) {
  return {
    ok: true,
    instant: true,
    privateKeyRequired: false,
    english: english || "open packaged English — GRAFT snark",
    machine: machine || packed?.short || "",
    loc: packed?.loc || null,
    zkClass: packed?.zkClass || SNARK_CLASS,
    note: "Open-source unwrap — raw CAS holds the full blob; snark is the short proof.",
  };
}

/**
 * Snark-compress one raw text blob (artifact body or library file).
 */
export function snarkCompressBlob(text, {
  title = "blob",
  name = null,
} = {}) {
  const buf = Buffer.from(String(text ?? ""), "utf8");
  const hash = sha256bytes(buf);
  const english =
    `GRAFT snark of ${title}: ${buf.length} UTF-8 bytes, sha256 ${shortId(hash, 12)}… ` +
    `Activate reads local CAS — GitHub not required after inject.`;
  const machine =
    `SNARK kind=blob title=${clip(title, 32)} bytes=${buf.length} sha=${shortId(hash, 8)}`;
  return packSnarkShort({
    english,
    machine,
    contentHash: hash,
    title,
    bytes: buf.length,
    files: name ? [{ name, hash }] : [{ name: title, hash }],
  });
}

/**
 * Snark-compress a whole multi-file library (e.g. graft/*.js).
 * Merkle of file hashes → one short tag + cas:// last-root style commit.
 */
export function snarkCompressLibrary(files = [], {
  title = "GRAFT-LIB",
} = {}) {
  const rows = (files || []).map((f) => {
    const body = String(f.body ?? f.text ?? "");
    const buf = Buffer.from(body, "utf8");
    const hash = f.hash || sha256bytes(buf);
    return {
      name: String(f.name || f.path || "file"),
      hash,
      bytes: buf.length,
      body,
    };
  });
  const totalBytes = rows.reduce((n, r) => n + r.bytes, 0);
  const leaf = rows.map((r) => r.hash).sort();
  // Pairwise fold matches graft merkle style without importing store.
  let layer = leaf.slice();
  if (!layer.length) layer = [sha256hex("GRAFT:EMPTY-LIB")];
  while (layer.length > 1) {
    const next = [];
    for (let i = 0; i < layer.length; i += 2) {
      const a = layer[i];
      const b = layer[i + 1] ?? a;
      next.push(sha256hex(a + b));
    }
    layer = next;
  }
  const commit = layer[0];
  const english =
    `GRAFT library snark "${title}": ${rows.length} files, ${totalBytes} bytes, ` +
    `root ${shortId(commit, 12)}…. Filed locally — activate without GitHub.`;
  const machine =
    `SNARK kind=library title=${clip(title, 32)} files=${rows.length} bytes=${totalBytes} root=${shortId(commit, 8)}`;
  const packed = packSnarkShort({
    english,
    machine,
    contentHash: commit,
    title,
    bytes: totalBytes,
    files: rows.map((r) => ({ name: r.name, hash: r.hash })),
  });
  return {
    ...packed,
    files: rows.map((r) => ({
      name: r.name,
      hash: r.hash,
      bytes: r.bytes,
      loc: casLocation(r.hash),
      short: `${SNARK_MAGIC}${shortId(r.hash, 8)}|${r.name}`,
    })),
  };
}
