/**
 * VITA GitHub-mirror chain — local read, SNARK unwrap, session keys, IDM locs.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CALLBACK_DATA_MAX,
  GITHUB_AS_CHAIN,
  MIRROR_CATALOG,
  MIRROR_PLUGINS,
  classifyFileLane,
  collectIdmLocations,
  extractSealedTxHashes,
  formatMirrorReadCard,
  handleVitaMirrorAction,
  isTxHash,
  listSessionKeys,
  mintSessionKey,
  mintSessionKeySet,
  parseVitaMirrorCommand,
  resetMirrorSessions,
  resolveLocalMirrorFile,
  sanitizeMirrorPath,
  snarkCompressBatch,
  snarkCompressBlob,
  telegramCallbackData,
} from "./mirror-chain.js";
import { MAINFRAME_ANCHORS } from "./mainframe.js";
import { decodeGithubContentsUtf8, decodeGithubContentsJson } from "../github-contents.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("vita mirror-chain GitHub-as-ledger", () => {
  beforeEach(() => resetMirrorSessions());

  it("maps GitHub infrastructure onto a chain analog + plugins", () => {
    assert.equal(GITHUB_AS_CHAIN.blobSha.includes("not a Base tx"), true);
    assert.equal(GITHUB_AS_CHAIN.secrets.includes("permanent"), true);
    assert.ok(MIRROR_PLUGINS.some((p) => p.id === "telegram"));
    assert.ok(MIRROR_PLUGINS.some((p) => p.id === "railway-keys"));
    assert.ok(MIRROR_CATALOG.some((e) => e.name === "vault-unlock.js" && e.lane === "code"));
    assert.ok(MIRROR_CATALOG.some((e) => e.name === "vita-registry.json" && e.lane === "state"));
    assert.ok(MIRROR_CATALOG.some((e) => e.name === "positions.json" && e.lane === "both"));
  });

  it("parses /vita read|files|proof|unwrap|chain|session without eating questions", () => {
    assert.equal(parseVitaMirrorCommand("/vita read vault-unlock.js").action, "read");
    assert.equal(parseVitaMirrorCommand("/vita read vault-unlock.js").filename, "vault-unlock.js");
    assert.equal(parseVitaMirrorCommand("/vita files").action, "files");
    assert.equal(parseVitaMirrorCommand("/vita proof positions.json").action, "proof");
    assert.equal(parseVitaMirrorCommand("/vita unwrap VITASESS.destroy.abc vault-unlock.js").action, "unwrap");
    assert.equal(parseVitaMirrorCommand("/vita chain").action, "chain");
    assert.equal(parseVitaMirrorCommand("/vita session").action, "session");
    assert.equal(parseVitaMirrorCommand("/vita who is KEY?").action, "ask");
    assert.equal(parseVitaMirrorCommand("/vitafeed dir").action, null);
  });

  it("sanitizes paths and classifies lanes", () => {
    assert.equal(sanitizeMirrorPath("../.env").ok, false);
    assert.equal(sanitizeMirrorPath("vault-unlock.js").ok, true);
    assert.equal(classifyFileLane("vault-unlock.js"), "code");
    assert.equal(classifyFileLane("vita-registry.json"), "state");
    assert.equal(classifyFileLane("positions.json"), "both");
    assert.ok(telegramCallbackData("/vita read vault-unlock.js").length <= CALLBACK_DATA_MAX);
  });

  it("reads vault-unlock.js from local disk (the Telegram miss)", async () => {
    const local = resolveLocalMirrorFile("vault-unlock.js", { cwd: root });
    assert.equal(local.ok, true);
    assert.match(local.text, /UNLOCK_TTL|unlock vault/i);

    const out = await handleVitaMirrorAction({
      action: "read",
      filename: "vault-unlock.js",
      cwd: root,
      chatId: "tg-1",
    });
    assert.equal(out.ok, true);
    assert.match(out.reply, /vault-unlock\.js/);
    assert.match(out.reply, /local=YES/);
    assert.match(out.reply, /VITASESS\.destroy\./);
    assert.match(out.reply, /Basescan|IDM/);
    assert.ok(out.keyboard?.inline_keyboard?.length >= 1);
    assert.ok(out.locations.every((l) => isTxHash(l.location)));
    for (const tx of out.locations.map((l) => l.location)) {
      assert.ok(
        MAINFRAME_ANCHORS.known.some((a) => a.tx.toLowerCase() === tx) || isTxHash(tx),
      );
    }
  });

  it("reads positions.json locally and SNARK-proofs existence", async () => {
    const out = await handleVitaMirrorAction({
      action: "proof",
      filename: "positions.json",
      cwd: root,
      chatId: "tg-2",
    });
    assert.equal(out.ok, true);
    assert.equal(out.exists, true);
    assert.match(out.reply, /exists=YES/);
    assert.match(out.reply, /neverInventHashes=true/i);
    assert.equal(out.snark.instantUnwrap, true);
    assert.equal(out.snark.privateWitness, false);
  });

  it("does not invent vita-registry.json when it is absent locally", async () => {
    const out = await handleVitaMirrorAction({
      action: "read",
      filename: "vita-registry.json",
      cwd: root,
      chatId: "tg-3",
      githubFetch: async () => ({ text: null, status: 404, miss: true }),
    });
    assert.equal(out.ok, false);
    assert.match(out.reply, /vita-registry\.json/);
    assert.match(out.reply, /bot-state|STATE|not found/i);
    assert.doesNotMatch(out.reply, /0xdeadbeef/);
  });

  it("falls back to GitHub CODE lane when local miss but remote hits", async () => {
    const body = "export function remoteOnly() { return 1; }\n";
    const out = await handleVitaMirrorAction({
      action: "read",
      filename: "remote-only-lib.js",
      cwd: root,
      githubFetch: async (name, branch) => {
        if (name === "remote-only-lib.js" && branch === "main") {
          return { text: body, sha: "abc", status: 200 };
        }
        return { text: null, status: 404 };
      },
      chatId: "tg-gh",
    });
    assert.equal(out.ok, true);
    assert.match(out.reply, /github=YES@main|source=github:CODE/);
    assert.match(out.preview || out.reply, /remoteOnly/);
  });

  it("unwraps with the minted destroyable key then burns it", async () => {
    const read = await handleVitaMirrorAction({
      action: "read",
      filename: "vault-unlock.js",
      cwd: root,
      chatId: "tg-unwrap",
    });
    assert.equal(read.ok, true);
    const key = read.sessionKey.key;
    const un = await handleVitaMirrorAction({
      action: "unwrap",
      key,
      chatId: "tg-unwrap",
      cwd: root,
    });
    assert.equal(un.ok, true);
    assert.equal(un.destroyed, true);
    assert.match(un.reply, /ENGLISH/);
    assert.match(un.reply, /MACHINE/);
    assert.equal(un.reveal.privateKeyRequired, false);

    const again = await handleVitaMirrorAction({
      action: "unwrap",
      key,
      chatId: "tg-unwrap",
      cwd: root,
    });
    assert.equal(again.ok, false);
    assert.match(again.reply, /need session key|not found|destroyed/i);
  });

  it("mints Railway-style permanent + ttl + destroyable keys per session", () => {
    const set = mintSessionKeySet({ chatId: "rail", filename: "vault-unlock.js" });
    assert.match(set.permanent.key, /^VITASESS\.permanent\./);
    assert.match(set.ttl.key, /^VITASESS\.ttl\./);
    assert.match(set.destroyable.key, /^VITASESS\.destroyable\./);
    assert.equal(set.permanent.privateKey, false);
    const listed = listSessionKeys("rail");
    assert.equal(listed.length, 3);
    const ttl = mintSessionKey({
      kind: "ttl",
      chatId: "rail-ttl",
      ttlMs: 10,
      now: 1000,
    });
    assert.equal(ttl.expiresAt, 1010);
    const expired = listSessionKeys("rail-ttl", 2000);
    assert.equal(expired.length, 0);
  });

  it("SNARK batch merkle is deterministic and cites only real anchors", () => {
    const a = snarkCompressBlob("hello", { filename: "a.txt" });
    const b = snarkCompressBlob("world", { filename: "b.txt" });
    const batch = snarkCompressBatch([
      { name: "a.txt", text: "hello", contentCommit: a.contentCommit },
      { name: "b.txt", text: "world", contentCommit: b.contentCommit },
    ]);
    assert.equal(batch.fileCount, 2);
    assert.equal(batch.neverInventHashes, true);
    const locs = collectIdmLocations();
    assert.equal(locs.length, MAINFRAME_ANCHORS.known.length);
    for (const loc of locs) {
      assert.ok(isTxHash(loc.location));
      assert.match(loc.basescan, /basescan\.org\/tx\/0x/);
      assert.match(loc.idmChat, /Input Data/);
    }
    const extracted = extractSealedTxHashes({
      txHashes: [MAINFRAME_ANCHORS.vitaStrandTx, "not-a-hash", "0xdead"],
    });
    assert.deepEqual(extracted, [MAINFRAME_ANCHORS.vitaStrandTx.toLowerCase()]);
  });

  it("files card lists click-through commands and local existence", async () => {
    const out = await handleVitaMirrorAction({ action: "files", cwd: root, chatId: "tg-files" });
    assert.equal(out.ok, true);
    assert.match(out.reply, /vault-unlock\.js/);
    assert.match(out.reply, /vita-registry\.json/);
    const unlock = out.files.find((f) => f.name === "vault-unlock.js");
    const registry = out.files.find((f) => f.name === "vita-registry.json");
    assert.equal(unlock.exists, true);
    assert.equal(registry.exists, false);
    const cb = out.keyboard.inline_keyboard.flat().find((b) => b.callback_data?.includes("vault-unlock"));
    assert.ok(cb);
    assert.ok(cb.callback_data.length <= CALLBACK_DATA_MAX);
  });

  it("chain card documents GitHub lanes without fake txs", async () => {
    const out = await handleVitaMirrorAction({ action: "chain" });
    assert.match(out.reply, /CODE=main/);
    assert.match(out.reply, /STATE=bot-state/);
    assert.match(out.reply, /Never invent/);
    assert.doesNotMatch(out.reply, /0x[0-9a-fA-F]{64}dead/);
  });

  it("decodes GitHub Contents as UTF-8 so .js is not JSON.parsed", () => {
    const js = "export const x = 1;\n";
    const b64 = Buffer.from(js, "utf8").toString("base64");
    assert.equal(decodeGithubContentsUtf8({ content: b64 }), js);
    assert.throws(() => decodeGithubContentsJson({ content: b64 }));
    const json = { ok: true };
    const jb = Buffer.from(JSON.stringify(json), "utf8").toString("base64");
    assert.deepEqual(decodeGithubContentsJson({ content: jb }), json);
  });

  it("agent.js wires mirror commands before Anthropic and handles callbacks", () => {
    const agent = readFileSync(join(root, "agent.js"), "utf8");
    assert.match(agent, /parseVitaMirrorCommand/);
    assert.match(agent, /handleVitaMirrorAction/);
    assert.match(agent, /callback_query/);
    assert.match(agent, /githubGetUtf8FromBranch|decodeGithubContentsUtf8/);
    const start = agent.indexOf('} else if (text && text.startsWith("/vita "))');
    assert.ok(start > 0);
    const read = agent.indexOf("vitaInput.startsWith(\"read \")", start);
    // old JSON-only githubGet read path must not be the first gate
    const anthropicGate = agent.indexOf("VITA needs VITA_ANTHROPIC_KEY", start);
    const mirrorCall = agent.indexOf("handleVitaMirrorAction", start);
    assert.ok(mirrorCall > start && mirrorCall < anthropicGate, "mirror read must not require Anthropic");
    assert.equal(read, -1, "legacy /vita read githubGet JSON path should be gone");
  });

  it("miss card still names the file (Telegram error shape)", () => {
    const card = formatMirrorReadCard({
      ok: false,
      filename: "vita-registry.json",
      lane: "state",
      tried: ["STATE:bot-state@404"],
      hint: "State files live on GitHub branch bot-state",
    });
    assert.match(card, /File not found: vita-registry.json/);
    assert.match(card, /bot-state/);
  });
});
