/**
 * One-file send bundle. The recipient runs it with node and gets the original bytes.
 * Node builtins only — the bundle does not import the PHOSPHOR module.
 */

const PROGRAM = `#!/usr/bin/env node
// PHOSPHOR bundle — full code, send as-is.
//   node bundle.mjs [outpath] [lock-passphrase]
import { createHash, createDecipheriv } from "node:crypto";
import { inflateRawSync, brotliDecompressSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const PACK = JSON.parse(PACK_JSON);

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}
function parseWire(wire) {
  const nl = wire.indexOf("\\n");
  const head = wire.slice(0, nl);
  const body = wire.slice(nl + 1);
  const kind = head.slice(head.lastIndexOf("|k=") + 3).replace(/§$/, "");
  const index = Number(head.slice(head.indexOf("|i=") + 3).split("|")[0]);
  return { kind, index, body };
}
function concatKind(kind) {
  return PACK.wires.map(parseWire).filter((row) => row.kind === kind)
    .sort((a, b) => a.index - b.index).map((row) => row.body).join("");
}
const stored = Buffer.from(concatKind("payload"), "base64");
if (sha256(stored) !== PACK.header.payloadHash) {
  console.error("payload hash mismatch");
  process.exit(1);
}
let crushed = stored;
if (PACK.header.keyMode === "lock") {
  const pass = process.argv[3] || "";
  if (!pass) {
    console.error("lock key required");
    process.exit(2);
  }
  const salt = Buffer.from(PACK.header.lock.salt, "hex");
  const key = createHash("sha256").update(Buffer.concat([salt, Buffer.from(pass, "utf8")])).digest();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(PACK.header.lock.iv, "hex"));
  decipher.setAuthTag(Buffer.from(PACK.header.lock.tag, "hex"));
  crushed = Buffer.concat([decipher.update(stored), decipher.final()]);
}
let raw = crushed;
if (PACK.header.encoder === "deflate-raw-v1") raw = inflateRawSync(crushed);
else if (PACK.header.encoder === "brotli-v1") raw = brotliDecompressSync(crushed);
else if (PACK.header.encoder !== "identity-v1") {
  console.error("unknown encoder");
  process.exit(3);
}
if (sha256(raw) !== PACK.header.rawHash) {
  console.error("raw hash mismatch");
  process.exit(4);
}
const dest = process.argv[2] || PACK.header.name.replace(/[\\\\/]/g, "_");
writeFileSync(dest, raw);
console.log("PHOSPHOR unwrap ok " + dest + " " + raw.length);
`;

export function renderBundle(header, wires) {
  const literal = JSON.stringify(JSON.stringify({ header, wires }));
  return PROGRAM.replace("PACK_JSON", literal);
}
