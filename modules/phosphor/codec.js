/**
 * PHOSPHOR codec — squash, canonical header, injector-sized wires.
 * Packet cap matches the hitch field (720 UTF-8 bytes). Never invents tx hashes.
 */

import { createHash } from "node:crypto";
import { brotliCompressSync, brotliDecompressSync, deflateRawSync, inflateRawSync } from "node:zlib";

export const PHOSPHOR_ID = "phosphor-v1";
export const PHOSPHOR_MAGIC = "§PHOSPHOR§";
export const WIRE_MAGIC = "§PHOSPHOR§v1";
export const PACKET_MAX = 720;

export function sha256Hex(data) {
  return createHash("sha256").update(data).digest("hex");
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) out[key] = sortValue(value[key]);
    }
    return out;
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(sortValue(value));
}

/** Smallest of identity / deflate-raw / brotli. Encoder id is what the reader must use. */
export function squash(raw) {
  const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
  // Tens of megabytes stall on brotli-11. Large bodies use deflate-1 or identity.
  if (buf.length > 256 * 1024) {
    const deflated = deflateRawSync(buf, { level: 1 });
    const choices = [
      { encoder: "identity-v1", bytes: buf },
      { encoder: "deflate-raw-v1", bytes: deflated },
    ];
    choices.sort((a, b) => a.bytes.length - b.bytes.length || a.encoder.localeCompare(b.encoder));
    const best = choices[0];
    return {
      encoder: best.encoder,
      bytes: best.bytes,
      rawBytes: buf.length,
      payloadBytes: best.bytes.length,
      ratio: buf.length ? best.bytes.length / buf.length : 1,
    };
  }
  const deflated = deflateRawSync(buf, { level: 9 });
  const brotli = brotliCompressSync(buf);
  const choices = [
    { encoder: "identity-v1", bytes: buf },
    { encoder: "deflate-raw-v1", bytes: deflated },
    { encoder: "brotli-v1", bytes: brotli },
  ];
  choices.sort((a, b) => a.bytes.length - b.bytes.length || a.encoder.localeCompare(b.encoder));
  const best = choices[0];
  return {
    encoder: best.encoder,
    bytes: best.bytes,
    rawBytes: buf.length,
    payloadBytes: best.bytes.length,
    ratio: buf.length ? best.bytes.length / buf.length : 1,
  };
}

export function expand(encoder, stored) {
  const buf = Buffer.isBuffer(stored) ? stored : Buffer.from(stored);
  if (encoder === "identity-v1") return Buffer.from(buf);
  if (encoder === "deflate-raw-v1") return inflateRawSync(buf);
  if (encoder === "brotli-v1") return brotliDecompressSync(buf);
  throw new Error("unknown encoder: " + encoder);
}

export function headerCore(header) {
  return {
    version: header.version,
    encoder: header.encoder,
    name: header.name,
    mime: header.mime,
    rawBytes: header.rawBytes,
    rawHash: header.rawHash,
    payloadBytes: header.payloadBytes,
    payloadHash: header.payloadHash,
    keyMode: header.keyMode,
    keyMeta: header.keyMeta,
    lock: header.lock || null,
    timestamp: header.timestamp,
  };
}

/** commit = sha256(headerCoreHash || payloadHash). Public input for the snark short. */
export function computeCommit(header) {
  const coreHash = sha256Hex(canonicalJson(headerCore(header)));
  return sha256Hex(coreHash + header.payloadHash);
}

function wireHead(commit, index, total, kind) {
  return `${WIRE_MAGIC}|c=${commit.slice(0, 12)}|i=${index}|n=${total}|k=${kind}§`;
}

function splitBody(commit, body, kind) {
  const sample = wireHead(commit, 0, 1, kind);
  // Worst-case index width stays inside 6 digits. Measure the real head.
  const widest = wireHead(commit, 999999, 999999, kind);
  const maxBody = PACKET_MAX - Buffer.byteLength(widest + "\n", "utf8");
  if (maxBody < 8) throw new Error("packet head exceeds 720 bytes");
  const parts = [];
  const text = String(body);
  if (!text.length) parts.push("");
  for (let offset = 0; offset < text.length; offset += maxBody) {
    parts.push(text.slice(offset, offset + maxBody));
  }
  const total = parts.length;
  return parts.map((part, index) => {
    const wire = wireHead(commit, index, total, kind) + "\n" + part;
    if (Buffer.byteLength(wire, "utf8") > PACKET_MAX) {
      throw new Error("wire exceeded " + PACKET_MAX + " (" + sample.length + ")");
    }
    return wire;
  });
}

export function buildWires(commit, header, stored) {
  const headerJson = canonicalJson(header);
  const b64 = Buffer.from(stored).toString("base64");
  return [
    ...splitBody(commit, headerJson, "header"),
    ...splitBody(commit, b64, "payload"),
  ];
}

export function parseWire(wire) {
  const text = String(wire);
  const nl = text.indexOf("\n");
  if (nl < 0) throw new Error("wire missing body");
  const head = text.slice(0, nl);
  const body = text.slice(nl + 1);
  if (!head.startsWith(WIRE_MAGIC + "|")) throw new Error("bad phosphor magic");
  const kind = (head.match(/\|k=(header|payload)§$/) || [])[1];
  const index = Number((head.match(/\|i=(\d+)/) || [])[1]);
  const total = Number((head.match(/\|n=(\d+)/) || [])[1]);
  const prefix = (head.match(/\|c=([0-9a-f]+)/) || [])[1];
  if (!kind || !Number.isInteger(index) || !prefix) throw new Error("bad wire head");
  if (Buffer.byteLength(text, "utf8") > PACKET_MAX) throw new Error("wire over packet cap");
  return { head, body, kind, index, total, prefix };
}

function concatKind(wires, kind) {
  const rows = wires.map(parseWire).filter((row) => row.kind === kind);
  rows.sort((a, b) => a.index - b.index);
  if (!rows.length) throw new Error("missing " + kind + " wires");
  const total = rows[0].total;
  if (rows.length !== total) throw new Error(kind + " wire count mismatch");
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].index !== i) throw new Error(kind + " wire gap");
  }
  return rows.map((row) => row.body).join("");
}

/** Rebuild header + stored bytes from injector wires only. */
export function objectFromWires(wires) {
  const header = JSON.parse(concatKind(wires, "header"));
  const stored = Buffer.from(concatKind(wires, "payload"), "base64");
  if (sha256Hex(stored) !== header.payloadHash) {
    throw new Error("payload hash mismatch");
  }
  if (stored.length !== header.payloadBytes) {
    throw new Error("payload length mismatch");
  }
  const commit = computeCommit(header);
  if (!header.snark || header.snark.commit !== commit) {
    throw new Error("snark commit mismatch");
  }
  return { header, stored, commit, wires };
}
