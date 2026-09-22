/**
 * Green CRT HTTP surface. Telegram opens /phosphor?popup=1.
 * Standalone container and the vita webhook share these routes.
 */

import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertRecallKey, loadBlock, loadReceipt, recallPlain, renderBlockPage, renderReceiptPage } from "./blocks.js";
import { renderBundle } from "./bundle.js";
import { defaultStateDir, loadIndex, loadObject, loadStark, resolveCommit } from "./chain-store.js";
import { displayOpenKey } from "./keys.js";
import { ensurePlayLibrary } from "./library.js";
import { proveFromReceipt, readBytes } from "./reader.js";
import { runStartup } from "./startup.js";
import { writeBytes } from "./writer.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = join(HERE, "public", "terminal.html");
const HTTP_MAX = 2 * 1024 * 1024;
const PART_RAW_MAX = 256 * 1024;
const SESSION_MAX = 80 * 1024 * 1024;
const sessions = new Map();

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    req.on("data", (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > HTTP_MAX + 64 * 1024) {
        settled = true;
        chunks.length = 0;
        const error = new Error("upload body over 2MB — open a chunked write session");
        error.status = 413;
        reject(error);
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!settled) resolve(Buffer.concat(chunks));
    });
    req.on("error", (error) => {
      if (!settled) reject(error);
    });
  });
}

function sweepSessions() {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [id, session] of sessions) {
    if (session.at < cutoff) sessions.delete(id);
  }
}

function publicWrite(written) {
  const blocks = (written.receipt.blocks || []).slice(0, 8).map((block) => ({
    i: block.i,
    n: block.n,
    loc: block.loc,
    next: block.next,
    prev: block.prev,
    df: block.df,
    href: block.href,
  }));
  return {
    ok: true,
    commit: written.commit,
    name: written.header.name,
    mime: written.header.mime,
    keyMode: written.header.keyMode,
    keyMeta: written.header.keyMeta,
    openKey: written.header.keyMode === "open" ? displayOpenKey(written.header.keyMeta) : null,
    encoder: written.header.encoder,
    rawBytes: written.header.rawBytes,
    payloadBytes: written.header.payloadBytes,
    packets: written.header.chain.packets,
    mode: written.header.chain.mode || "wires",
    ipfs: written.ipfs,
    snark: written.snark,
    location: null,
    home: written.home,
    equation: written.equation,
    trace: written.trace,
    play: written.header.keyMode === "open" && written.header.rawBytes <= 8 * 1024 * 1024
      ? "/phosphor/api/play?c=" + written.commit
      : null,
    bundle: written.wires.length ? "/phosphor/api/bundle?c=" + written.commit : null,
    pull: "/phosphor/api/pull?c=" + written.commit,
    receipt: {
      proof: written.receipt.proof,
      recalled: written.receipt.recalled,
      filingLoc: written.receipt.filingLoc,
      starkRoot: written.receipt.starkRoot,
      blockCount: written.receipt.blockCount,
      blocksExternal: written.receipt.blocksExternal === true,
      baseLocation: null,
      home: written.home,
      href: "/phosphor/receipt?c=" + written.commit,
      blocks,
    },
  };
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
    if (req.method === "GET" && path === "/phosphor/vm.js") {
      send(res, 200, readFileSync(join(HERE, "pong.js")), { "Content-Type": "text/javascript; charset=utf-8" });
      return true;
    }
    if (req.method === "GET" && path === "/phosphor/api/library") {
      const library = await ensurePlayLibrary(stateDir);
      sendJson(res, 200, library);
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
      const object = loadObject(stateDir, opened.commit);
      if (!object.wires) {
        sendJson(res, 409, { ok: false, reason: "large file has no wire bundle — pull the bytes" });
        return true;
      }
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
        blockCount: Number(body.blockCount) || 0,
      });
      sendJson(res, 200, publicWrite(written));
      return true;
    }
    if (req.method === "POST" && path === "/phosphor/api/write/open") {
      sweepSessions();
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      const totalBytes = Number(body.totalBytes) || 0;
      if (totalBytes < 1) {
        sendJson(res, 400, { ok: false, reason: "totalBytes required" });
        return true;
      }
      if (totalBytes > SESSION_MAX) {
        sendJson(res, 413, { ok: false, reason: "file over 80MB" });
        return true;
      }
      const session = randomBytes(16).toString("hex");
      sessions.set(session, {
        name: body.name || "upload.bin",
        mime: body.mime || "",
        lockKey: body.lockKey || "",
        tryIpfs: body.tryIpfs !== false,
        blockCount: Number(body.blockCount) || 0,
        totalBytes,
        parts: [],
        received: 0,
        at: Date.now(),
      });
      sendJson(res, 200, { ok: true, session, partBytes: 200 * 1024, location: null });
      return true;
    }
    if (req.method === "POST" && path === "/phosphor/api/write/part") {
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      const session = sessions.get(String(body.session || ""));
      if (!session) {
        sendJson(res, 404, { ok: false, reason: "write session missing" });
        return true;
      }
      const index = Number(body.index);
      if (index !== session.parts.length) {
        sendJson(res, 400, { ok: false, reason: "write parts must arrive in order" });
        return true;
      }
      const bytes = Buffer.from(String(body.bytesBase64 || ""), "base64");
      if (!bytes.length) {
        sendJson(res, 400, { ok: false, reason: "bytesBase64 required" });
        return true;
      }
      if (bytes.length > PART_RAW_MAX) {
        sendJson(res, 413, { ok: false, reason: "part over 256KB — slice the file" });
        return true;
      }
      if (session.received + bytes.length > session.totalBytes) {
        sendJson(res, 400, { ok: false, reason: "parts exceed totalBytes" });
        return true;
      }
      session.parts.push(bytes);
      session.received += bytes.length;
      session.at = Date.now();
      sendJson(res, 200, { ok: true, index, received: session.received, totalBytes: session.totalBytes });
      return true;
    }
    if (req.method === "POST" && path === "/phosphor/api/write/seal") {
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      const id = String(body.session || "");
      const session = sessions.get(id);
      if (!session) {
        sendJson(res, 404, { ok: false, reason: "write session missing" });
        return true;
      }
      if (session.received !== session.totalBytes) {
        sendJson(res, 400, { ok: false, reason: "write session incomplete" });
        return true;
      }
      const bytes = Buffer.concat(session.parts);
      sessions.delete(id);
      const written = await writeBytes({
        bytes,
        name: session.name,
        mime: session.mime,
        lockKey: session.lockKey,
        stateDir,
        tryIpfs: session.tryIpfs,
        blockCount: session.blockCount,
      });
      sendJson(res, 200, publicWrite(written));
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
    if (req.method === "GET" && path === "/phosphor/receipt") {
      const commit = resolveCommit(stateDir, url.searchParams.get("c") || "");
      send(res, 200, renderReceiptPage(loadReceipt(stateDir, commit)), { "Content-Type": "text/html; charset=utf-8" });
      return true;
    }
    if (req.method === "GET" && path === "/phosphor/block") {
      const commit = resolveCommit(stateDir, url.searchParams.get("c") || "");
      const found = loadBlock(stateDir, commit, {
        i: url.searchParams.get("i"),
        loc: url.searchParams.get("loc") || "",
      });
      if (!found.block) {
        sendJson(res, 404, { ok: false, reason: "block not in receipt" });
        return true;
      }
      send(res, 200, renderBlockPage(found.block, found.receipt), { "Content-Type": "text/html; charset=utf-8" });
      return true;
    }
    if (req.method === "POST" && path === "/phosphor/api/proof") {
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      const commit = resolveCommit(stateDir, body.commit || body.c || "");
      const proof = proveFromReceipt(stateDir, commit, body.key || body.lockKey || "");
      sendJson(res, 200, proof);
      return true;
    }
    if ((req.method === "GET" || req.method === "POST") && path === "/phosphor/api/pull") {
      let key = url.searchParams.get("key") || "";
      let commitArg = url.searchParams.get("c") || url.searchParams.get("commit") || "";
      if (req.method === "POST") {
        const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
        key = body.key || body.lockKey || key;
        commitArg = body.commit || body.c || commitArg;
      }
      const commit = resolveCommit(stateDir, commitArg);
      const object = loadObject(stateDir, commit);
      const opened = await readBytes({ commit, lockKey: key, stateDir });
      if (object.header.keyMode === "open" && key !== displayOpenKey(object.header.keyMeta) && key !== object.header.keyMeta) {
        sendJson(res, 401, { ok: false, reason: "open key required to piece the blocks" });
        return true;
      }
      send(res, 200, opened.raw, {
        "Content-Type": opened.header.mime || "application/octet-stream",
        "Content-Length": String(opened.raw.length),
        "Content-Disposition": "attachment; filename=\"" + opened.header.name.replace(/"/g, "") + "\"",
        "X-Phosphor-Filing": loadReceipt(stateDir, commit).filingLoc || "",
      });
      return true;
    }
    if (req.method === "POST" && path === "/phosphor/api/recall") {
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      const commit = resolveCommit(stateDir, body.commit || body.c || "");
      const receipt = loadReceipt(stateDir, commit);
      const object = loadObject(stateDir, commit);
      assertRecallKey(object.header, body.key || body.lockKey || "");
      const raw = receipt.blocksExternal
        ? (await readBytes({ commit, lockKey: body.key || body.lockKey || "", stateDir })).raw
        : recallPlain(object.header, receipt.blocks, body.key || body.lockKey || "");
      if (raw.length > 256 * 1024) {
        sendJson(res, 200, {
          ok: true,
          proof: receipt.proof,
          recalled: true,
          filingLoc: receipt.filingLoc,
          baseLocation: null,
          bytes: raw.length,
          bytesBase64: null,
          pull: "/phosphor/api/pull?c=" + commit,
          name: receipt.name,
          mime: receipt.mime,
        });
        return true;
      }
      sendJson(res, 200, {
        ok: true,
        proof: receipt.proof,
        recalled: true,
        filingLoc: receipt.filingLoc,
        baseLocation: null,
        bytes: raw.length,
        bytesBase64: raw.toString("base64"),
        name: receipt.name,
        mime: receipt.mime,
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
    if (!res.headersSent) {
      sendJson(res, error.status || 400, { ok: false, reason: error.message || String(error) });
    }
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
