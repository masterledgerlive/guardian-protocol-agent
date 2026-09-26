/**
 * Container entry. Default path injects this program into the wire store,
 * runs the reconstructed copy, then (when asked) serves the CRT.
 */

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { readBytes } from "./reader.js";
import { startPhosphorServer } from "./server.js";
import { runStartup } from "./startup.js";
import { writeBytes } from "./writer.js";

function paint(text) {
  return "\x1b[32m" + text + "\x1b[0m";
}

async function cliWrite(path, lockKey) {
  const bytes = readFileSync(path);
  const written = await writeBytes({
    bytes,
    name: basename(path),
    lockKey,
    tryIpfs: true,
  });
  console.log(paint(written.trace.join("\n")));
}

async function cliRead(prefix, lockKey, outPath) {
  const opened = await readBytes({ commit: prefix, lockKey });
  const dest = outPath || "out-" + opened.header.name.replace(/[/\\]/g, "_");
  const { writeFileSync } = await import("node:fs");
  writeFileSync(dest, opened.raw);
  console.log(paint("READ OK " + dest + " " + opened.raw.length + " bytes from " + opened.from));
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  if (command === "write") {
    const lockAt = args.indexOf("--lock");
    const lockKey = lockAt >= 0 ? args[lockAt + 1] : "";
    if (!args[1]) {
      console.error("usage: node boot.js write <path> [--lock passphrase]");
      process.exit(1);
    }
    await cliWrite(args[1], lockKey);
    return;
  }
  if (command === "read") {
    const lockAt = args.indexOf("--lock");
    const outAt = args.indexOf("-o");
    const lockKey = lockAt >= 0 ? args[lockAt + 1] : "";
    const outPath = outAt >= 0 ? args[outAt + 1] : "";
    if (!args[1]) {
      console.error("usage: node boot.js read <commit-prefix> [--lock passphrase] [-o out]");
      process.exit(1);
    }
    await cliRead(args[1], lockKey, outPath);
    return;
  }
  const result = await runStartup({ tryIpfs: false });
  console.log(paint(result.log));
  if (!result.ok) process.exit(1);
  const serve = process.env.PHOSPHOR_SERVE === "1" || args.includes("--serve");
  if (!serve || args.includes("--test")) return;
  const port = Number(process.env.PHOSPHOR_PORT || 8081);
  await startPhosphorServer({ port });
  console.log(paint("CRT http://127.0.0.1:" + port + "/phosphor?popup=1"));
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
