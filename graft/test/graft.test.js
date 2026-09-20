import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const GRAFT_DIR = path.dirname(fileURLToPath(new URL("../store.js", import.meta.url)));
const STATE = fs.mkdtempSync(path.join(os.tmpdir(), "graft-test-"));
process.env.GRAFT_STATE_DIR = STATE;
process.env.GRAFT_THINK_FREE = "no";
process.env.GRAFT_DRY_RUN = "yes";
delete process.env.GRAFT_TELEGRAM_BOT_TOKEN;
delete process.env.GRAFT_SHARE_ROOT_ENV;

const {
  merkleRoot,
  merkleProof,
  verifyMerkleProof,
  sha256hex,
  formatShortTag,
} = await import(pathToFileURL(path.join(GRAFT_DIR, "hash.js")).href);
const store = await import(pathToFileURL(path.join(GRAFT_DIR, "store.js")).href);
const { think, classifyText } = await import(pathToFileURL(path.join(GRAFT_DIR, "think.js")).href);
const { parseGraftCommand, dispatchGraftCommand } = await import(pathToFileURL(path.join(GRAFT_DIR, "commands.js")).href);
const { seedGraft } = await import(pathToFileURL(path.join(GRAFT_DIR, "seed.js")).href);
const telegram = await import(pathToFileURL(path.join(GRAFT_DIR, "telegram.js")).href);
const config = await import(pathToFileURL(path.join(GRAFT_DIR, "config.js")).href);

before(() => {
  store.ensureStore();
});

describe("GRAFT isolation", () => {
  it("graft modules do not import vita, agent.js, piggy-bank, or guardian-v4", () => {
    const files = fs.readdirSync(GRAFT_DIR).filter((f) => f.endsWith(".js"));
    const banned = /from\s+["']\.\.\/(vita\/|vita-|agent\.js|piggy-bank|guardian-v4)/;
    for (const f of files) {
      const src = fs.readFileSync(path.join(GRAFT_DIR, f), "utf8");
      assert.equal(banned.test(src), false, f);
      assert.equal(src.includes("vita/mainframe"), false, f);
    }
  });

  it("root agent.js does not wire GRAFT (live bot untouched)", () => {
    const src = fs.readFileSync(path.join(GRAFT_DIR, "..", "agent.js"), "utf8");
    assert.equal(src.includes("graft/"), false);
    assert.equal(src.includes("/graft"), false);
  });
});

describe("hash / last-root", () => {
  it("merkle inclusion verifies and empty root is typed, not a tx hash", () => {
    const empty = merkleRoot([]);
    assert.equal(empty, sha256hex("GRAFT:EMPTY"));
    assert.equal(/^0x[a-f0-9]{64}$/i.test(empty), false);
    const leaves = ["aa", "bb", "cc"].map((x) => sha256hex(x));
    const root = merkleRoot(leaves);
    const proof = merkleProof(leaves, leaves[1]);
    assert.equal(proof.ok, true);
    assert.equal(proof.root, root);
    assert.equal(verifyMerkleProof(proof), true);
  });

  it("short tag never contains a fake tx", () => {
    const tag = formatShortTag({ short: "abcdef12", root: "98765432deadbeef", snap: 3 });
    assert.match(tag, /§GRAFT§/);
    assert.equal(/0x[a-fA-F0-9]{64}/.test(tag), false);
  });
});

describe("file then activate then think", () => {
  it("seeds both LLM dumps losslessly without activating", () => {
    const seeded = seedGraft();
    assert.equal(seeded.ingested.length, 4);
    const titles = seeded.ingested.map((x) => x.artifact.title).join("\n");
    assert.match(titles, /MEMORY-INJECTOR/);
    assert.match(titles, /DAISY/);
    const daisy = store.findArtifact("DAISY");
    assert.ok(daisy);
    assert.equal(daisy.active, false);
    assert.equal(daisy.status, "filed");
    const blob = store.rawBlob(daisy);
    assert.match(blob, /Polkadot JAM/);
    assert.match(blob, /Layer 3/);
    assert.equal(store.bag().txHashes.length, 0);
  });

  it("think refuses until activate, then refuses without piggy", () => {
    const daisy = store.findArtifact("DAISY — Unified");
    const blocked = think(daisy.shortId);
    assert.equal(blocked.ok, false);
    assert.equal(blocked.error, "not-active");
    store.setActive(daisy.shortId, true);
    const broke = think(daisy.shortId);
    assert.equal(broke.ok, false);
    assert.equal(broke.error, "insufficient");
  });

  it("fund + think keeps original, writes thought log, updates last-root", () => {
    const before = store.readLedger().lastRoot;
    const funded = store.fundPiggy(0.001, "test");
    assert.equal(funded.ok, true);
    const daisy = store.findArtifact("DAISY — Unified");
    const result = think(daisy.shortId);
    assert.equal(result.ok, true);
    assert.ok(result.classify.survival > 0);
    assert.ok(result.classify.layers.some((l) => l.nodeId.startsWith("daisy-l")));
    assert.equal(store.rawBlob(daisy).includes("Polkadot JAM"), true);
    assert.equal(result.tx, null);
    assert.notEqual(store.readLedger().lastRoot, before);
    const proof = store.inclusionProof(daisy.id);
    assert.equal(proof.ok, true);
    assert.equal(verifyMerkleProof(proof), true);
    const log = store.thoughtsFor(daisy.id);
    assert.ok(log.length >= 1);
    const full = store.readThought(log[0].thoughtId);
    assert.ok(full.steps.length >= 5);
    assert.match(full.note, /never invented/);
  });
});

describe("commands", () => {
  it("parses /graft activate and insert aliases", () => {
    assert.equal(parseGraftCommand("/graft").cmd, "help");
    assert.equal(parseGraftCommand("/graft@Bot file hello").cmd, "insert");
    assert.equal(parseGraftCommand("/graft start last").cmd, "activate");
    assert.equal(parseGraftCommand("/graft off abcd").cmd, "sleep");
    assert.equal(parseGraftCommand("/vitafeed").ok, false);
  });

  it("dispatch list/activate/fund/harvest never invents txs", () => {
    const list = dispatchGraftCommand("/graft list");
    assert.match(list.html, /DAISY|MEMORY-INJECTOR|GRAFT/);
    const help = dispatchGraftCommand("/graft");
    assert.match(help.html, /\/graft activate/);
    assert.match(help.html, /never invented|none invented/i);
    const proof = dispatchGraftCommand("/graft proof");
    assert.match(proof.html, /not broadcast/);
    assert.equal(/tx\s+0x[a-fA-F0-9]{64}/.test(proof.html), false);
    const harvest = dispatchGraftCommand("/graft harvest last");
    assert.match(harvest.html, /does <b>not<\/b> write VITA|harvest-candidate/);
  });

  it("insert files a third prompt without touching prior CAS bytes", () => {
    const daisy = store.findArtifact("DAISY — Unified");
    const before = store.rawBlob(daisy);
    const r = dispatchGraftCommand("/graft insert Layer 2 ACP hire test prompt for filing");
    assert.match(r.html, /GRAFT filed/);
    assert.equal(store.rawBlob(daisy), before);
    assert.equal(r.artifact.active, false);
  });
});

describe("DAISY classification offshoot", () => {
  it("maps the unified stack dump onto L0–L4 nodes", () => {
    const text = fs.readFileSync(path.join(GRAFT_DIR, "memory/genesis-unified-agentic-stack.txt"), "utf8");
    const cls = classifyText(text);
    const ids = cls.layers.map((l) => l.nodeId);
    for (const need of ["daisy-l0", "daisy-l1", "daisy-l2", "daisy-l3", "daisy-l4"]) {
      assert.ok(ids.includes(need), need);
    }
  });
});

describe("telegram poller isolation", () => {
  it("does not poll without a dedicated GRAFT bot token", () => {
    assert.equal(config.shouldPollTelegram(), false);
  });

  it("prefix is [GRAFT] and handleTelegramUpdate dispatches insert", async () => {
    assert.equal(telegram.prefixGraft("hi").startsWith("[GRAFT]"), true);
    const sent = [];
    const r = await telegram.handleTelegramUpdate({
      message: {
        chat: { id: "1" },
        text: "/graft bag",
      },
    }, { send: async (html) => { sent.push(html); return { sent: true }; } });
    assert.equal(r.handled, true);
    assert.ok(sent[0].includes("GRAFT bag") || sent[0].includes("piggy"));
  });
});

describe("CAS integrity", () => {
  it("content hash matches blob bytes", () => {
    const daisy = store.findArtifact("DAISY — Unified");
    const buf = fs.readFileSync(store.casPathFor(daisy.id));
    const hash = createHash("sha256").update(buf).digest("hex");
    assert.equal(hash, daisy.id);
  });
});
