/**
 * Green CRT HTTP surface. Telegram opens /phosphor?popup=1.
 * Standalone container and the vita webhook share these routes.
 */

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderBundle } from "./bundle.js";
import { defaultStateDir, loadIndex, loadStark } from "./chain-store.js";
import { readBytes } from "./reader.js";
import { runStartup } from "./startup.js";
import { writeBytes } from "./writer.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = join(HERE, "public", "terminal.html");
const HTTP_MAX = 2 * 1024 * 1024;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > HTTP_MAX + 64 * 1024) {
        reject(new Error("upload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function send(res, status, body, headers = {}) {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  res.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(payload);
}

function sendJson(res, status, value) {
  send(res, status, JSON.stringify(value), { "Content-Type": "application/json; charset=utf-8" });
}

export async function handlePhosphorHttp(req, res, url, { stateDir = defaultStateDir() } = {}) {
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (path !== "/phosphor" && !path.startsWith("/phosphor/")) return false;
  try {
    if (req.method === "GET" && (path === "/phosphor" || path === "/phosphor/")) {
      send(res, 200, readFileSync(PAGE), { "Content-Type": "text/html; charset=utf-8" });
      return true;
    }
    if (req.method === "GET" && path === "/phosphor/api/status") {
      const index = loadIndex(stateDir);
      const stark = loadStark(stateDir);
      sendJson(res, 200, {
        ok: true,
        name: "PHOSPHOR",
        store: "injector-wires",
        ipfs: "outlet",
        objects: Object.keys(index.objects || {}).length,
        starkRoot: stark?.root || null,
        circuitWired: false,
        groth16Wired: false,
        winterfellWired: false,
        location: null,
        neverInventHashes: true,
      });
      return true;
    }
    if (req.method === "GET" && path === "/phosphor/api/play") {
      const commit = url.searchParams.get("c") || url.searchParams.get("commit") || "";
      const opened = await readBytes({ commit, stateDir });
      if (opened.header.keyMode === "lock") {
        sendJson(res, 401, { ok: false, reason: "lock key required — unwrap in the CRT" });
        return true;
      }
      send(res, 200, opened.raw, {
        "Content-Type": opened.header.mime || "application/octet-stream",
        "Content-Disposition": "inline; filename=\"" + opened.header.name.replace(/"/g, "") + "\"",
      });
      return true;
    }
    if (req.method === "GET" && path === "/phosphor/api/bundle") {
      const commit = url.searchParams.get("c") || "";
      const opened = await readBytes({ commit, stateDir });
      const { loadObject } = await import("./chain-store.js");
      const object = loadObject(stateDir, opened.commit);
      const source = renderBundle(object.header, object.wires);
      send(res, 200, source, {
        "Content-Type": "text/javascript; charset=utf-8",
        "Content-Disposition": "attachment; filename=\"phosphor-" + opened.commit.slice(0, 8) + ".mjs\"",
      });
      return true;
    }
    if (req.method === "POST" && path === "/phosphor/api/write") {
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      const bytes = Buffer.from(String(body.bytesBase64 || ""), "base64");
      if (!bytes.length) {
        sendJson(res, 400, { ok: false, reason: "bytesBase64 required" });
        return true;
      }
      if (bytes.length > HTTP_MAX) {
        sendJson(res, 413, { ok: false, reason: "file over 2MB on the CRT — use the CLI for larger songs" });
        return true;
      }
      const written = await writeBytes({
        bytes,
        name: body.name || "upload.bin",
        mime: body.mime || "",
        lockKey: body.lockKey || "",
        stateDir,
        tryIpfs: body.tryIpfs !== false,
      });
      sendJson(res, 200, {
        ok: true,
        commit: written.commit,
        name: written.header.name,
        mime: written.header.mime,
        keyMode: written.header.keyMode,
        keyMeta: written.header.keyMeta,
        encoder: written.header.encoder,
        rawBytes: written.header.rawBytes,
        payloadBytes: written.header.payloadBytes,
        packets: written.header.chain.packets,
        ipfs: written.ipfs,
        snark: written.snark,
        location: null,
        trace: written.trace,
        play: written.header.keyMode === "open" ? "/phosphor/api/play?c=" + written.commit : null,
        bundle: "/phosphor/api/bundle?c=" + written.commit,
      });
      return true;
    }
    if (req.method === "POST" && path === "/phosphor/api/unwrap") {
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      const opened = await readBytes({
        commit: body.commit || body.c || "",
        lockKey: body.lockKey || body.key || "",
        stateDir,
      });
      sendJson(res, 200, {
        ok: true,
        name: opened.header.name,
        mime: opened.header.mime,
        bytes: opened.raw.length,
        bytesBase64: opened.raw.toString("base64"),
        from: opened.from,
        location: null,
      });
      return true;
    }
    if (req.method === "POST" && path === "/phosphor/api/selftest") {
      const isolated = join(stateDir, "selftest-" + Date.now().toString(36));
      const result = await runStartup({ stateDir: isolated, tryIpfs: false });
      sendJson(res, result.ok ? 200 : 500, {
        ok: result.ok,
        log: result.log,
        starkRoot: result.starkRoot || null,
        wavCommit: result.wavCommit || null,
        noteCommit: result.noteCommit || null,
        location: null,
        circuitWired: false,
        error: result.error || null,
      });
      return true;
    }
    sendJson(res, 404, { ok: false, reason: "phosphor route missing" });
    return true;
  } catch (error) {
    sendJson(res, 400, { ok: false, reason: error.message || String(error) });
    return true;
  }
}

export function startPhosphorServer({ port = 8081, stateDir = defaultStateDir(), host = "0.0.0.0" } = {}) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (url.pathname === "/") url.pathname = "/phosphor";
    if (req.method === "OPTIONS") {
      send(res, 204, "", { "Access-Control-Allow-Methods": "GET, POST, OPTIONS" });
      return;
    }
    const handled = await handlePhosphorHttp(req, res, url, { stateDir });
    if (!handled) sendJson(res, 404, { ok: false, reason: "not phosphor" });
  });
  return new Promise((resolve) => {
    server.listen(port, host, () => {
      const address = server.address();
      resolve({ server, port: address.port, host });
    });
  });
}
