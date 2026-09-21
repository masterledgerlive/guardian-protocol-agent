/**
 * Free-catalog Maple Leaf Rag — grouped VIN inject + original OGG playback.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import {
  FREEMUSIC_LABEL,
  FREEMUSIC_MAGIC,
  FREEMUSIC_SUBDIR,
  MAPLE_ID,
  MUSIC_GROUP_VIN_CAP,
  enqueueFreeMusicGroups,
  formatFreeMusicCard,
  isMusicPlaySelector,
  loadFreeMusic,
  maybeMusicDualHumanBody,
  musicDualHumanBody,
  musicMachineGroupsLine,
  packetizeFreeMusic,
  playFreeMusic,
  publicFreeMusicPlay,
  publicFreeMusicState,
  reconstructFreeMusicFromGroups,
  sliceBytesForVinCap,
} from "./free-music.js";
import { parseVitaFileBody } from "./vita-feed-file.js";
import { parseVitaFeedLine } from "./vita-feed.js";
import {
  handleVitaFeedAction,
  parseVitaFeedCommand,
  resetVitaFeedPending,
} from "./vita-feed.js";
import {
  enqueueFeedBacklogItem,
  resetFeedBacklogForTests,
  setFeedBacklogPathForTests,
} from "./vita-feed-backlog.js";
import {
  guessTransmissionName,
  resetChainDirForTests,
  setChainDirPathForTests,
  provenMusicOnChain,
} from "./chain-dir.js";
import { listMasterDirectory, listSubDirectory } from "./vita-dir.js";
import { isDemoPlaySelector, systemPlaylists } from "./url-dir.js";
import { MAINFRAME_ANCHORS } from "./mainframe.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OGG = join(root, "vita/memory/free-music/Maple_Leaf_Rag.ogg");
const EXPECT_SHA = "a1142a1e51ebfa69f7f7752d2f6fc9dffce18efe0fe13a5e1a108f492e5a01f2";

describe("free catalog Maple Leaf Rag file", () => {
  it("is a real Ogg bitstream matching the catalog sha", () => {
    assert.equal(existsSync(OGG), true);
    const bytes = readFileSync(OGG);
    assert.equal(bytes.subarray(0, 4).toString("ascii"), "OggS");
    assert.equal(bytes.length, 263304);
    const sha = createHash("sha256").update(bytes).digest("hex");
    assert.equal(sha, EXPECT_SHA);
  });
});

describe("grouped VIN packetize + original reconstruct", () => {
  it("splits into groups that fit the hourly VIN cap", () => {
    const cap = sliceBytesForVinCap();
    assert.ok(cap > 1000);
    const packed = packetizeFreeMusic();
    assert.equal(packed.ok, true);
    assert.equal(packed.id, MAPLE_ID);
    assert.equal(packed.sha256, EXPECT_SHA);
    assert.ok(packed.groupCount >= 2, "full song needs grouped injections");
    assert.ok(packed.totalVin > MUSIC_GROUP_VIN_CAP, "more packets than one hour");
    for (const g of packed.groups) {
      assert.ok(g.totalChunks >= 1);
      assert.ok(g.totalChunks <= MUSIC_GROUP_VIN_CAP, "group " + g.n + " over cap");
      assert.ok(g.body.startsWith("§VITAFILE§"));
      const parsedLine = parseVitaFeedLine(g.lines[0].line);
      assert.ok(parsedLine, "VIN header on group " + g.n);
    }
  });

  it("concatenates groups back to the original OGG bytes", () => {
    const packed = packetizeFreeMusic();
    const rebuilt = reconstructFreeMusicFromGroups(packed.groups);
    assert.equal(rebuilt.ok, true);
    assert.equal(rebuilt.sha256, EXPECT_SHA);
    const original = readFileSync(OGG);
    assert.equal(Buffer.compare(rebuilt.data, original), 0);
    const first = parseVitaFileBody(packed.groups[0].body);
    assert.equal(first.ok, true);
    assert.equal(first.playKind, "file");
  });

  it("never invents tx hashes on the plan", () => {
    const packed = packetizeFreeMusic();
    for (const g of packed.groups) {
      assert.equal(g.lines.every((l) => !l.txHash), true);
    }
    const dir = loadFreeMusic();
    for (const tx of dir.locations) {
      assert.ok(MAINFRAME_ANCHORS.known.some((a) => a.tx.toLowerCase() === tx.toLowerCase()));
    }
    assert.equal(dir.onChain.proven, false);
    assert.equal(dir.onChain.availability, true);
  });
});

describe("play maple · original audio (not demo WAV)", () => {
  it("selectors", () => {
    assert.equal(isMusicPlaySelector("maple"), true);
    assert.equal(isMusicPlaySelector("song"), true);
    assert.equal(isMusicPlaySelector("music"), true);
    assert.equal(isMusicPlaySelector("joplin"), true);
    assert.equal(isMusicPlaySelector("demo"), false);
    assert.equal(isDemoPlaySelector("song"), false);
    assert.equal(isDemoPlaySelector("demo"), true);
    assert.equal(isDemoPlaySelector(""), true);
  });

  it("play payload is original audio/ogg reconstructed from groups", () => {
    const opened = playFreeMusic("maple");
    assert.equal(opened.ok, true);
    assert.equal(opened.demo, false);
    assert.equal(opened.music, true);
    assert.equal(opened.play.kind, "audio");
    assert.equal(opened.play.mime, "audio/ogg");
    assert.equal(opened.play.original, true);
    assert.match(opened.play.dataUrl, /^data:audio\/ogg;base64,/);
    const b64 = opened.play.dataUrl.slice("data:audio/ogg;base64,".length);
    const bin = Buffer.from(b64, "base64");
    assert.equal(bin.subarray(0, 4).toString("ascii"), "OggS");
    assert.equal(createHash("sha256").update(bin).digest("hex"), EXPECT_SHA);
    assert.equal(opened.proven, false);
    assert.match(opened.playerHref, /music=maple/);
    assert.match(opened.playerHref, /popup=1/);
  });
});

describe("dual HUMAN catalog + MACHINE group shas", () => {
  it("expands maple into §VITAMUSIC§ body", () => {
    assert.equal(maybeMusicDualHumanBody("hello"), "hello");
    const body = maybeMusicDualHumanBody("maple");
    assert.match(body, new RegExp("^" + FREEMUSIC_MAGIC.replace(/[§]/g, "§")));
    assert.match(body, /Maple Leaf Rag/);
    assert.match(body, /g01 /);
    assert.match(musicMachineGroupsLine(), /MUSIC lane=MACHINE/);
    assert.equal(guessTransmissionName(body), "maple-leaf-rag");
  });
});

describe("DOS MUSIC + Telegram wire", () => {
  it("master directory includes MUSIC", () => {
    const master = listMasterDirectory();
    assert.ok(master.subdirs.some((d) => d.name === FREEMUSIC_SUBDIR));
    const listed = listSubDirectory("MUSIC");
    assert.equal(listed.ok, true);
    assert.ok(listed.entries.some((e) => e.name === "Maple_Leaf_Rag.ogg"));
    assert.ok(listed.entries.length >= 3);
  });

  it("/vitafeed music|play maple|enqueue maple parse", async () => {
    assert.equal(parseVitaFeedCommand("/vitafeed music").action, "music");
    assert.equal(parseVitaFeedCommand("/vitafeed play maple").action, "play");
    assert.equal(parseVitaFeedCommand("/vitafeed play maple").body, "maple");
    assert.equal(parseVitaFeedCommand("/vitafeed enqueue maple").action, "enqueue");
    assert.equal(parseVitaFeedCommand("/vitafeed dual maple").action, "dual");
    const card = await handleVitaFeedAction({ action: "music", body: "", chatId: "music-wire" });
    assert.equal(card.ok, true);
    assert.match(card.reply, /MAPLE LEAF RAG/i);
    assert.match(card.reply, /grouped/i);
    const play = await handleVitaFeedAction({
      action: "play",
      body: "maple",
      chatId: "music-wire",
    });
    assert.equal(play.ok, true);
    assert.equal(play.music, true);
    assert.equal(play.play?.mime, "audio/ogg");
    assert.match(play.playerHref, /music=maple/);
    resetVitaFeedPending();
  });

  it("dual maple stages HUMAN catalog without inventing locs", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "vita-maple-dual-"));
    setChainDirPathForTests(join(tmp, "chain-dir-ledger.json"));
    resetChainDirForTests();
    try {
      const dual = await handleVitaFeedAction({
        action: "dual",
        body: "maple",
        chatId: "music-dual",
      });
      assert.equal(dual.ok, true);
      assert.equal(dual.dual, true);
      assert.equal(dual.staged, true);
      assert.match(dual.reply, /HUMAN|MACHINE|VITADUAL/);
      assert.ok(dual.prepared?.totalChunks >= 1);
    } finally {
      resetVitaFeedPending();
      setChainDirPathForTests(null);
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });
});

describe("grouped enqueue stays under VIN cap (isolated backlog)", () => {
  let tmp;
  before(() => {
    tmp = mkdtempSync(join(tmpdir(), "vita-free-music-"));
    setFeedBacklogPathForTests(join(tmp, "vitafeed-backlog.json"));
    setChainDirPathForTests(join(tmp, "chain-dir-ledger.json"));
    resetFeedBacklogForTests();
    resetChainDirForTests();
    resetVitaFeedPending();
  });
  after(() => {
    setFeedBacklogPathForTests(null);
    setChainDirPathForTests(null);
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("enqueues one manifest + N groups each ≤24 VIN", () => {
    const queued = enqueueFreeMusicGroups({
      enqueueFn: enqueueFeedBacklogItem,
      includeManifest: true,
    });
    assert.equal(queued.ok, true);
    assert.ok(queued.added >= queued.groupCount);
    assert.equal(provenMusicOnChain().proven, false);
    const items = queued.items.filter((x) => x.kind === "group");
    for (const it of items) {
      assert.ok((it.chunks || 0) <= MUSIC_GROUP_VIN_CAP);
    }
  });
});

describe("HTTP free-music catalog + play", () => {
  it("serves catalog JSON and reconstructed OGG dataUrl", async () => {
    const html = readFileSync(join(root, "public", "vita-feed-player.html"), "utf8");
    const server = createServer((req, res) => {
      const u = new URL(req.url || "/", "http://127.0.0.1");
      if (u.pathname === "/vita/free-music/play") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(publicFreeMusicPlay("maple")));
        return;
      }
      if (u.pathname.startsWith("/vita/free-music")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(publicFreeMusicState("maple")));
        return;
      }
      if (u.pathname.startsWith("/vita/feed-player")) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(html);
        return;
      }
      res.writeHead(404);
      res.end("no");
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    try {
      const cat = await fetch("http://127.0.0.1:" + port + "/vita/free-music").then((r) => r.json());
      assert.equal(cat.ok, true);
      assert.equal(cat.filingLabel, FREEMUSIC_LABEL);
      assert.equal(cat.song.sha256, EXPECT_SHA);
      assert.ok(cat.song.groupCount >= 2);
      const play = await fetch("http://127.0.0.1:" + port + "/vita/free-music/play?id=maple").then((r) => r.json());
      assert.equal(play.ok, true);
      assert.equal(play.play.mime, "audio/ogg");
      assert.match(play.play.dataUrl, /^data:audio\/ogg;base64,/);
      const page = await fetch("http://127.0.0.1:" + port + "/vita/feed-player?music=maple").then((r) => r.text());
      assert.match(page, /music=maple/);
      assert.match(page, /free-music\/play/);
      assert.match(page, /playlistPick/);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

describe("system playlists include maple", () => {
  it("picker lists maple ahead of the demo beep", () => {
    const lists = systemPlaylists();
    assert.ok(lists.some((p) => p.id === "maple"));
    assert.ok(lists.some((p) => p.id === "demo"));
    assert.match(formatFreeMusicCard(), /Maple Leaf Rag/);
  });
});
