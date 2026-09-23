/**
 * Proof-of-logs trail — creation order, key+root, race, Telegram tabs.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  handleProofLogRequest,
  requestProofLogChains,
  sealProofLogLocs,
} from "./proof-log.js";
import { fileCompression, handleCompressionRequest } from "./compression/index.js";
import { parseVitaFeedCommand } from "./vita-feed.js";
import { listSubDirectory } from "./vita-dir.js";
import { CALLBACK_DATA_MAX as CB } from "./mirror-chain.js";

function isolated() {
  const root = mkdtempSync(join(tmpdir(), "vita-prooflog-"));
  return {
    root,
    inboxDir: join(root, "inbox"),
    storeDir: join(root, "store"),
    directoryPath: join(root, "directory.json"),
    learnPath: join(root, "learn.json"),
    strandPath: join(root, "strand.json"),
    includePython: false,
    proofLog: {
      trailPath: join(root, "proof-log-trail.json"),
      learnPath: join(root, "proof-log-learn.json"),
      strandPath: join(root, "proof-log-strand.json"),
    },
  };
}

describe("proof-of-logs trail", () => {
  it("parses /vitafeed trail|log commands", () => {
    assert.equal(parseVitaFeedCommand("/vitafeed trail").action, "log");
    assert.equal(parseVitaFeedCommand("/vitafeed log").action, "log");
    assert.equal(parseVitaFeedCommand("/vitafeed log plain 1").body, "plain 1");
    assert.equal(parseVitaFeedCommand("/vitafeed log chains 2 base,ethereum").body, "chains 2 base,ethereum");
  });

  it("files compress into trail with key + root, unwrap claims race #1", () => {
    const opts = isolated();
    const note = Buffer.from("proof log morning note\n".repeat(20));
    const filed = fileCompression({
      name: "morning.txt",
      mime: "text/plain",
      kind: "personal",
      bytes: note,
      includePython: false,
    }, opts);
    assert.equal(filed.ok, true);
    assert.ok(filed.proofLog?.n >= 1);
    assert.equal(filed.proofLog.key, filed.key);
    assert.ok(filed.proofLog.rootPath);

    const unwrapped = handleCompressionRequest({ body: "unwrap " + filed.key }, opts);
    assert.equal(unwrapped.ok, true);
    assert.equal(unwrapped.unwrap, true);
    assert.ok(unwrapped.proofLog?.n);
    assert.equal(unwrapped.proofLog.verified, true);
    assert.equal(unwrapped.proofLog.messageOut, true);
    assert.equal(unwrapped.proofLog.race.slot, 1);
    assert.equal(unwrapped.proofLog.race.proofedFirst, true);
    assert.match(unwrapped.reply, /PROOFLOG #/);

    const trail = handleProofLogRequest({ body: "" }, opts.proofLog);
    assert.match(trail.reply, /PROOF-OF-LOGS TRAIL/);
    assert.ok(trail.keyboard?.inline_keyboard?.flat().some((b) => b.callback_data === "/vitafeed trail"));

    const open = handleProofLogRequest({ body: String(unwrapped.proofLog.n) }, opts.proofLog);
    assert.match(open.reply, /HUMAN \(plain text\)/);
    assert.match(open.reply, /MACHINE \(hand off to agentic AI\)/);
    const cbs = open.keyboard.inline_keyboard.flat().map((b) => b.callback_data || "");
    assert.ok(cbs.some((c) => c.includes("log plain")));
    assert.ok(cbs.some((c) => c.includes("log machine")));
    assert.ok(cbs.some((c) => c.includes("log original")));
    assert.ok(cbs.every((c) => !c || c.length <= CB));

    const plain = handleProofLogRequest({ body: "plain " + unwrapped.proofLog.n }, opts.proofLog);
    assert.match(plain.reply, /proof log morning note/);

    const chains = requestProofLogChains(unwrapped.proofLog.n, "base,ethereum,arbitrum", opts.proofLog);
    assert.equal(chains.ok, true);
    assert.ok(chains.entry.chainCredits.some((c) => c.chain === "ethereum" && c.status === "requested"));
    assert.equal(chains.entry.chainCredits.find((c) => c.chain === "ethereum").location, null);

    const fakeSeal = sealProofLogLocs(unwrapped.proofLog.n, ["not-a-hash"], opts.proofLog);
    assert.equal(fakeSeal.ok, false);

    const real =
      "0x1111111111111111111111111111111111111111111111111111111111111111";
    const sealed = sealProofLogLocs(unwrapped.proofLog.n, [real], opts.proofLog);
    assert.equal(sealed.ok, true);
    assert.equal(sealed.entry.phase, "sealed");
    assert.equal(sealed.entry.race.injectSlot, 1);
    assert.equal(sealed.entry.race.injectedFirst, true);

    rmSync(opts.root, { recursive: true, force: true });
  });

  it("PROOFLOG directory lists trail rows", () => {
    const listed = listSubDirectory("PROOFLOG");
    assert.equal(listed.ok, true);
  });

  it("second verify gets race slot 2", () => {
    const opts = isolated();
    const a = fileCompression({
      name: "a.txt",
      mime: "text/plain",
      kind: "personal",
      bytes: Buffer.from("aaa ".repeat(40)),
      includePython: false,
    }, opts);
    const b = fileCompression({
      name: "b.txt",
      mime: "text/plain",
      kind: "personal",
      bytes: Buffer.from("bbb ".repeat(40)),
      includePython: false,
    }, opts);
    const va = handleCompressionRequest({ body: "unwrap " + a.key }, opts);
    const vb = handleCompressionRequest({ body: "unwrap " + b.key }, opts);
    assert.equal(va.proofLog.race.slot, 1);
    assert.equal(vb.proofLog.race.slot, 2);
    rmSync(opts.root, { recursive: true, force: true });
  });
});
