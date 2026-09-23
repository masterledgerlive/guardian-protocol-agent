/**
 * Compression bake-off — every codec, verified key, then injection stage.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import {
  builtInSamples,
  compressionKey,
  fileCompression,
  handleCompressionRequest,
  parseCompressionInjectBody,
  runAllCompressions,
  verifyCompressionKey,
} from "./compression/index.js";
import { handleVitaFeedAction, parseVitaFeedCommand, peekVitaFeed, resetVitaFeedPending } from "./vita-feed.js";
import { listSubDirectory } from "./vita-dir.js";
import { createVitaServer } from "../vita-webhook.js";

function isolated() {
  const root = mkdtempSync(join(tmpdir(), "vita-comp-"));
  return {
    root,
    inboxDir: join(root, "inbox"),
    storeDir: join(root, "store"),
    directoryPath: join(root, "directory.json"),
    learnPath: join(root, "learn.json"),
    strandPath: join(root, "strand.json"),
    includePython: false,
  };
}

describe("compression bake-off", () => {
  it("parses /vitafeed compress commands", () => {
    assert.equal(parseVitaFeedCommand("/vitafeed compress").action, "compress");
    assert.equal(parseVitaFeedCommand("/vitafeed compress").body, "");
    assert.equal(parseVitaFeedCommand("/vitafeed compress add").wantsFile, true);
    assert.equal(parseVitaFeedCommand("/vitafeed compress dir").body, "dir");
    assert.equal(parseVitaFeedCommand("/vitafeed compress verify VITACOMP.zlib-9-v1.abcdef01").body,
      "verify VITACOMP.zlib-9-v1.abcdef01");
    assert.match(readFileSync(new URL("./compression/projects/gemini-zlib.py", import.meta.url), "utf8"), /zlib\.compress/);
  });

  it("runs every codec and verifies a round-trip on personal, program, and video", () => {
    const samples = builtInSamples();
    assert.ok(samples.some((s) => s.kind === "personal"));
    assert.ok(samples.some((s) => s.kind === "program"));
    assert.ok(samples.some((s) => s.kind === "video"));
    for (const sample of samples) {
      const bench = runAllCompressions(sample.bytes, { includePython: false });
      assert.equal(bench.ok, true, sample.id);
      assert.equal(bench.verified, true);
      assert.equal(bench.answer, true);
      assert.equal(bench.recovered, true);
      const ids = bench.rows.map((r) => r.id);
      assert.ok(ids.includes("gemini-zlib-v1"));
      assert.ok(ids.includes("identity-v1"));
      assert.ok(ids.includes("wire-b64-v1"));
      assert.ok(bench.best.payloadBytes <= sample.bytes.length);
      assert.notEqual(bench.best.id, "wire-b64-v1");
    }
    const program = samples.find((s) => s.id === "program-gemini");
    const programBench = runAllCompressions(program.bytes, { includePython: false });
    assert.ok(programBench.best.ratio < 0.5, "program text should compress");
    const video = samples.find((s) => s.id === "video-ftyp");
    const videoBench = runAllCompressions(video.bytes, { includePython: false });
    assert.ok(videoBench.best.ratio > 0.9, "dense video should not pretend a huge win");
  });

  it("accepts an extra codec so a new project is one object", () => {
    const raw = Buffer.from("abcabcabc".repeat(30));
    const bench = runAllCompressions(raw, {
      includePython: false,
      extraCodecs: [{
        id: "toy-repeat-v1",
        project: "toy",
        compress: (b) => Buffer.from(b),
        decompress: (b) => Buffer.from(b),
      }],
    });
    assert.equal(bench.rows.some((r) => r.id === "toy-repeat-v1" && r.verified === true), true);
  });

  it("returns verified with the key and recovers the original bytes", () => {
    const opts = isolated();
    const sample = builtInSamples().find((s) => s.kind === "program");
    const filed = fileCompression({ ...sample, includePython: false }, opts);
    assert.equal(filed.ok, true);
    assert.equal(filed.call, "verified");
    assert.equal(filed.verified, true);
    assert.equal(filed.answer, true);
    assert.equal(filed.recovered, true);
    assert.equal(filed.key, compressionKey(filed.codec, filed.entry.rawHash));
    assert.equal(filed.privateKey, false);
    assert.deepEqual(filed.locations, []);
    assert.equal(filed.entry.chainStatus, "availability");

    const parsed = parseCompressionInjectBody(filed.stageBody);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.verified, true);
    assert.equal(parsed.key, filed.key);
    assert.ok(parsed.payload && parsed.payload.length > 0);

    const checked = verifyCompressionKey(filed.key, opts);
    assert.equal(checked.call, "verified");
    assert.equal(checked.verified, true);
    assert.equal(checked.answer, true);
    assert.equal(checked.recovered, true);
    assert.equal(Buffer.compare(checked.bytes, sample.bytes), 0);
    rmSync(opts.root, { recursive: true, force: true });
  });

  it("stages the key directory for injection without inventing a hash", async () => {
    const opts = isolated();
    resetVitaFeedPending();
    const out = await handleVitaFeedAction({
      action: "compress",
      body: "",
      chatId: "comp-stage",
      compressionOpts: opts,
    });
    assert.equal(out.ok, true);
    assert.equal(out.call, "verified");
    assert.equal(out.verified, true);
    assert.equal(out.answer, true);
    assert.equal(out.recovered, true);
    assert.match(out.reply, /VERIFIED true/);
    assert.match(out.reply, /answer recovered=true/);
    assert.match(out.reply, /injection/i);
    assert.equal(out.staged, true);
    assert.equal(out.chainStatus, "availability");
    assert.deepEqual(out.locations, []);
    assert.equal(out.neverInventHashes, true);
    const pending = peekVitaFeed("comp-stage");
    assert.equal(pending.prepared.ok, true);
    assert.match(pending.body, /§VITACOMPDIR§/);
    assert.equal(pending.prepared.lines.some((l) => /^0x[0-9a-f]{64}$/.test(l.hex) && l.hex.length === 66), false);

    const listed = listSubDirectory("COMPRESS");
    assert.equal(listed.ok, true);
    rmSync(opts.root, { recursive: true, force: true });
    resetVitaFeedPending();
  });

  it("files a dropped inbox path and verifies that key", () => {
    const opts = isolated();
    const note = Buffer.from("personal letter ".repeat(40));
    mkdirSync(opts.inboxDir, { recursive: true });
    writeFileSync(join(opts.inboxDir, "letter.txt"), note);
    const out = handleCompressionRequest({ body: "personal letter.txt" }, opts);
    assert.equal(out.call, "verified");
    assert.equal(out.verified, true);
    assert.equal(out.kind, "personal");
    const again = handleCompressionRequest({ body: "verify " + out.key }, opts);
    assert.equal(again.call, "verified");
    assert.equal(again.recovered, true);
    assert.equal(again.answer, true);
    rmSync(opts.root, { recursive: true, force: true });
  });

  it("gemini zlib bytes inflate back to the original", () => {
    const raw = Buffer.from("gemini zlib path");
    const payload = deflateSync(raw);
    assert.equal(payload[0], 0x78);
    const bench = runAllCompressions(raw, { includePython: false });
    const row = bench.rows.find((r) => r.id === "gemini-zlib-v1");
    assert.equal(row.verified, true);
    assert.equal(row.recovered, true);
  });
});

describe("compression page", () => {
  let server;
  let base;
  before(async () => {
    server = createVitaServer();
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = "http://127.0.0.1:" + server.address().port;
  });
  after(async () => {
    if (typeof server.closeAllConnections === "function") server.closeAllConnections();
    await new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  });

  it("GET /vita/compression serves the page and the codec list", async () => {
    const page = await fetch(base + "/vita/compression");
    const html = await page.text();
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type") || "", /text\/html/);
    assert.match(html, /VITA compression/);
    assert.match(html, /VERIFIED/);
    const state = await fetch(base + "/vita/compression?json=1", { headers: { accept: "application/json" } });
    const json = await state.json();
    assert.equal(json.neverInventHashes, true);
    assert.equal(json.chainStatus, "availability");
    assert.ok(json.codecs.some((c) => c.id === "gemini-zlib-v1"));
    assert.ok(json.codecs.some((c) => c.project === "gemini-code-1790141126186"));
  });
});
