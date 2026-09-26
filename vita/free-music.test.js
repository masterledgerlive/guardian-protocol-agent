/**
 * Free-catalog songs — Maple Leaf Rag + Judy Garland lane (PD 1918 singing).
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
  JUDY_ID,
  MAPLE_ID,
  MUSIC_GROUP_VIN_CAP,
  buildFreeMusicLocProof,
  buildFreeMusicLocProofLocal,
  enqueueFreeMusicGroups,
  enqueueFreeMusicLibrary,
  formatFreeMusicCard,
  formatFreeMusicLibraryCard,
  isMusicLibraryEnqueue,
  isMusicPlaySelector,
  listCatalogSongIds,
  loadFreeMusic,
  maybeMusicDualHumanBody,
  musicDualHumanBody,
  musicMachineGroupsLine,
  packetizeFreeMusic,
  playFreeMusic,
  publicFreeMusicLocs,
  publicFreeMusicLoc,
  publicFreeMusicPlay,
  publicFreeMusicState,
  reconstructFreeMusicFromGroups,
  resolveSongId,
  sliceBytesForVinCap,
  inspectFreeMusicLoc,
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
const JUDY_OGG = join(root, "vita/memory/free-music/Im_Always_Chasing_Rainbows.ogg");
const EXPECT_SHA = "a1142a1e51ebfa69f7f7752d2f6fc9dffce18efe0fe13a5e1a108f492e5a01f2";
const JUDY_SHA = "ce6cf7bf94a93968beeb3bd5b1f854168341d9191414d4ccc2cb047becbdf115";

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

describe("Judy Garland free-catalog PD singing", () => {
  it("files I'm Always Chasing Rainbows OGG with catalog sha", () => {
    assert.equal(existsSync(JUDY_OGG), true);
    const bytes = readFileSync(JUDY_OGG);
    assert.equal(bytes.subarray(0, 4).toString("ascii"), "OggS");
    assert.equal(bytes.length, 1053294);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), JUDY_SHA);
  });

  it("resolves judy/garland/rainbow selectors", () => {
    assert.equal(resolveSongId("judy"), JUDY_ID);
    assert.equal(resolveSongId("garland"), JUDY_ID);
    assert.equal(resolveSongId("rainbow"), JUDY_ID);
    assert.equal(resolveSongId("chasing"), JUDY_ID);
    assert.equal(isMusicPlaySelector("judy"), true);
    assert.equal(isMusicPlaySelector("garland"), true);
  });

  it("packetizes into thrift-capped groups and reconstructs original OGG", () => {
    const packed = packetizeFreeMusic("judy");
    assert.equal(packed.ok, true);
    assert.equal(packed.id, JUDY_ID);
    assert.equal(packed.judyGarlandLane, true);
    assert.equal(packed.sha256, JUDY_SHA);
    assert.ok(packed.groupCount >= 2);
    for (const g of packed.groups) {
      assert.ok(g.totalChunks <= MUSIC_GROUP_VIN_CAP);
      assert.ok(g.filingPath.includes("Im_Always_Chasing_Rainbows"));
      assert.ok(g.lineCommits?.length >= 1);
    }
    const rebuilt = reconstructFreeMusicFromGroups(packed.groups);
    assert.equal(rebuilt.sha256, JUDY_SHA);
    assert.equal(Buffer.compare(rebuilt.data, readFileSync(JUDY_OGG)), 0);
  });

  it("loc daisy-chain highlights MATCH when sealed UTF-8 equals VIN data field", async () => {
    const packed = packetizeFreeMusic("judy");
    const line = packed.groups[0].lines[0].line;
    const wantCommit = packed.groups[0].lineCommits[0].contentCommit;
    const fakeTx = "0x" + "cd".repeat(32);
    const proof = await buildFreeMusicLocProof({
      id: "judy",
      packed,
      sealedLocs: [{ groupN: 1, index: 1, location: fakeTx, utf8: line }],
    });
    assert.equal(proof.ok, true);
    assert.equal(proof.matched, 1);
    assert.equal(proof.highlighted.length, 1);
    assert.equal(proof.rows[0].match, "MATCH");
    assert.equal(proof.rows[0].highlight, true);
    assert.equal(proof.rows[0].clickThrough, true);
    assert.match(proof.rows[0].basescan, /basescan\.org\/tx\/0xcd/);
    assert.equal(proof.rows[0].dataFieldCommit, wantCommit);
    assert.equal(proof.rows[0].pulledUtf8Commit, wantCommit);
  });

  it("local loc proof marks every VIN data-field LOCAL_OK from filing", () => {
    const loc = buildFreeMusicLocProofLocal("judy");
    assert.equal(loc.ok, true);
    assert.ok(loc.matched >= 10);
    assert.equal(loc.highlighted.length, loc.matched);
    assert.match(loc.rows[0].filingPath, /free-music\/Im_Always_Chasing_Rainbows/);
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

  it("expands judy into Judy lane §VITAMUSIC§ body", () => {
    const body = maybeMusicDualHumanBody("judy");
    assert.match(body, /ALWAYS CHASING RAINBOWS/i);
    assert.match(body, /Judy Garland free-catalog/);
    assert.equal(guessTransmissionName(body), "judy-chasing-rainbows");
  });
});

describe("DOS MUSIC + Telegram wire", () => {
  it("master directory includes MUSIC", () => {
    const master = listMasterDirectory();
    assert.ok(master.subdirs.some((d) => d.name === FREEMUSIC_SUBDIR));
    const listed = listSubDirectory("MUSIC");
    assert.equal(listed.ok, true);
    assert.ok(listed.entries.some((e) => e.name === "Maple_Leaf_Rag.ogg"));
    assert.ok(listed.entries.some((e) => e.name === "Im_Always_Chasing_Rainbows.ogg"));
    assert.ok(listed.entries.some((e) => e.name === "Amazing_Grace.ogg"));
    assert.ok(listed.entries.some((e) => e.name === "Daisy_Bell.ogg"));
    assert.ok(listed.entries.length >= 3);
  });

  it("/vitafeed music|play maple|enqueue maple parse", async () => {
    assert.equal(parseVitaFeedCommand("/vitafeed music").action, "music");
    assert.equal(parseVitaFeedCommand("/vitafeed play maple").action, "play");
    assert.equal(parseVitaFeedCommand("/vitafeed play maple").body, "maple");
    assert.equal(parseVitaFeedCommand("/vitafeed play judy").body, "judy");
    assert.equal(parseVitaFeedCommand("/vitafeed enqueue maple").action, "enqueue");
    assert.equal(parseVitaFeedCommand("/vitafeed dual maple").action, "dual");
    const card = await handleVitaFeedAction({ action: "music", body: "judy", chatId: "music-wire" });
    assert.equal(card.ok, true);
    assert.match(card.reply, /CHASING RAINBOWS/i);
    assert.match(card.reply, /grouped/i);
    const library = await handleVitaFeedAction({ action: "music", body: "", chatId: "music-wire" });
    assert.equal(library.ok, true);
    assert.equal(library.library, true);
    assert.match(library.reply, /LIBRARY/i);
    assert.match(library.reply, /enqueue library/);
    const play = await handleVitaFeedAction({
      action: "play",
      body: "judy",
      chatId: "music-wire",
    });
    assert.equal(play.ok, true);
    assert.equal(play.music, true);
    assert.equal(play.play?.mime, "audio/ogg");
    assert.match(play.playerHref, /music=judy/);
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
      id: "maple",
    });
    assert.equal(queued.ok, true);
    assert.ok(queued.added >= queued.groupCount);
    assert.equal(provenMusicOnChain("maple").proven, false);
    const items = queued.items.filter((x) => x.kind === "group");
    for (const it of items) {
      assert.ok((it.chunks || 0) <= MUSIC_GROUP_VIN_CAP);
    }
  });
});

describe("HTTP free-music catalog + play + locs", () => {
  it("serves catalog JSON, reconstructed OGG, and click-through loc proof", async () => {
    const html = readFileSync(join(root, "public", "vita-feed-player.html"), "utf8");
    const server = createServer(async (req, res) => {
      const u = new URL(req.url || "/", "http://127.0.0.1");
      if (u.pathname === "/vita/free-music/play") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(publicFreeMusicPlay(u.searchParams.get("id") || "maple")));
        return;
      }
      if (u.pathname === "/vita/free-music/loc") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(publicFreeMusicLoc(
          u.searchParams.get("id") || "judy",
          u.searchParams.get("g") || "1",
          u.searchParams.get("i") || "1",
        )));
        return;
      }
      if (u.pathname === "/vita/free-music/locs") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(await publicFreeMusicLocs(u.searchParams.get("id") || "judy")));
        return;
      }
      if (u.pathname.startsWith("/vita/free-music")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(publicFreeMusicState(u.searchParams.get("id") || "maple")));
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
      const cat = await fetch("http://127.0.0.1:" + port + "/vita/free-music?id=judy").then((r) => r.json());
      assert.equal(cat.ok, true);
      assert.equal(cat.filingLabel, FREEMUSIC_LABEL);
      assert.equal(cat.song.sha256, JUDY_SHA);
      assert.ok(cat.song.groupCount >= 2);
      assert.ok(cat.playlists.some((p) => p.id === "judy"));
      assert.ok(cat.playlists.length >= 10);
      assert.ok(cat.playlists.some((p) => p.id === "grace"));
      assert.ok(cat.playlists.some((p) => p.id === "daisy"));
      assert.ok(cat.playlists.some((p) => p.id === "entertainer"));
      assert.ok(cat.playlists.some((p) => p.id === "afterball"));
      const play = await fetch("http://127.0.0.1:" + port + "/vita/free-music/play?id=judy").then((r) => r.json());
      assert.equal(play.ok, true);
      assert.equal(play.play.mime, "audio/ogg");
      assert.match(play.play.dataUrl, /^data:audio\/ogg;base64,/);
      const locs = await fetch("http://127.0.0.1:" + port + "/vita/free-music/locs?id=judy").then((r) => r.json());
      assert.equal(locs.ok, true);
      assert.ok(locs.rows.length >= 10);
      assert.ok(locs.daisyChain?.length >= 2);
      assert.match(locs.rows[0].inspect, /\/vita\/free-music\/loc\?id=judy/);
      const one = await fetch("http://127.0.0.1:" + port + locs.rows[0].inspect).then((r) => r.json());
      assert.equal(one.ok, true);
      assert.equal(one.fedIntoPlayer, true);
      assert.equal(one.trueToBlock, true);
      assert.equal(one.location, null);
      assert.equal(createHash("sha256").update(one.line, "utf8").digest("hex"), one.dataFieldCommit);
      const page = await fetch("http://127.0.0.1:" + port + "/vita/feed-player?music=judy").then((r) => r.text());
      assert.match(page, /music=judy/);
      assert.match(page, /free-music\/locs/);
      assert.match(page, /free-music\/loc\?/);
      assert.match(page, /loc-match/);
      assert.match(page, /loc-rail|locBarFill|btnLocTuck/);
      assert.doesNotMatch(page, /scrollIntoView/);
      assert.match(page, /playlistPick/);
      assert.match(page, /liveReaders|readerHuman|MACHINE · SNARK/);
      assert.match(page, /timeupdate|paintLiveLoc|loc-active/);
      assert.match(page, /btnProof|Show blockchain|vitaMusicProof/);
      assert.match(page, /btnNextSong/);
      assert.match(page, /kids=1|kids-mode|proof-off/);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

describe("system playlists include judy + maple", () => {
  it("picker lists judy ahead of maple and the demo beep", () => {
    const lists = systemPlaylists();
    assert.ok(lists.some((p) => p.id === "judy"));
    assert.ok(lists.some((p) => p.id === "maple"));
    assert.ok(lists.some((p) => p.id === "demo"));
    assert.match(formatFreeMusicCard("judy"), /Chasing Rainbows/i);
  });

  it("picker lists the expanded PD library", () => {
    const lists = systemPlaylists();
    for (const id of ["grace", "daisy", "ballgame", "auld", "lining", "susanna", "entertainer", "stripes", "sweetheart", "afterball"]) {
      assert.ok(lists.some((p) => p.id === id), "missing playlist " + id);
    }
  });
});

const NEW_SONGS = [
  {
    id: "grace",
    file: "Amazing_Grace.ogg",
    sha: "31c4d55541b942b9b3aecb187ae738722ed8c23500584868816fa55559b92cc2",
    bytes: 686731,
    aliases: ["amazing", "amazing-grace"],
  },
  {
    id: "daisy",
    file: "Daisy_Bell.ogg",
    sha: "641019baa5acfc4da514c86a5d7c349ac16765a6f7951651261d35374a554aa3",
    bytes: 657145,
    aliases: ["bicycle", "daisy-bell"],
  },
  {
    id: "ballgame",
    file: "Take_Me_Out_to_the_Ball_Game.ogg",
    sha: "06bfaba89ac385002656eef2eceef25d5b4ff0fc4831e0fffc30518758f02f24",
    bytes: 530355,
    aliases: ["baseball", "take-me-out"],
  },
  {
    id: "auld",
    file: "Auld_Lang_Syne.ogg",
    sha: "d72d24c139e99ccc4d6f4549672e342b140062f449a36bcfe9599baa72d7040f",
    bytes: 753096,
    aliases: ["syne", "auld-lang-syne"],
  },
  {
    id: "lining",
    file: "Look_for_the_Silver_Lining.ogg",
    sha: "a2a2048511ff3ca629abf1fd12420313d1b1e57fe8bd77a8b516fada432ca64e",
    bytes: 1061924,
    aliases: ["silver", "silver-lining"],
  },
  {
    id: "susanna",
    file: "Oh_Susanna.ogg",
    sha: "1235438f9449dc6e0b614ec0cd013c925313309d736a3cff25e68e10884751f3",
    bytes: 1089099,
    aliases: ["oh-susanna", "foster"],
  },
];

describe("expanded free-catalog PD library", () => {
  it("files ≥4 new real OGG bitstreams matching catalog sha256", () => {
    const ids = listCatalogSongIds();
    assert.ok(ids.includes("maple"));
    assert.ok(ids.includes("judy"));
    assert.ok(ids.length >= 6);
    for (const s of NEW_SONGS) {
      const path = join(root, "vita/memory/free-music", s.file);
      assert.equal(existsSync(path), true, s.file + " missing");
      const bytes = readFileSync(path);
      assert.equal(bytes.subarray(0, 4).toString("ascii"), "OggS");
      assert.equal(bytes.length, s.bytes);
      assert.equal(createHash("sha256").update(bytes).digest("hex"), s.sha);
    }
  });

  it("resolves new aliases without stealing judy rainbow", () => {
    assert.equal(resolveSongId("rainbow"), JUDY_ID);
    assert.equal(resolveSongId("silver"), "lining");
    assert.equal(resolveSongId("lining"), "lining");
    for (const s of NEW_SONGS) {
      assert.equal(resolveSongId(s.id), s.id);
      for (const a of s.aliases) {
        assert.equal(resolveSongId(a), s.id, a + " → " + s.id);
        assert.equal(isMusicPlaySelector(a), true);
      }
    }
  });

  it("packetizes daisy and reconstructs original OGG", () => {
    const packed = packetizeFreeMusic("daisy");
    assert.equal(packed.ok, true);
    assert.equal(packed.id, "daisy");
    assert.equal(packed.sha256, NEW_SONGS.find((s) => s.id === "daisy").sha);
    for (const g of packed.groups) {
      assert.ok(g.totalChunks <= MUSIC_GROUP_VIN_CAP);
    }
    const rebuilt = reconstructFreeMusicFromGroups(packed.groups);
    assert.equal(rebuilt.sha256, packed.sha256);
  });

  it("library card lists growing catalog; local loc proof LOCAL_OK", () => {
    const card = formatFreeMusicLibraryCard();
    assert.match(card, /FREE CATALOG LIBRARY/);
    assert.match(card, /enqueue library/);
    assert.match(card, /kids=1/);
    assert.doesNotMatch(card, /VITAFEED_PAID=yes/);
    for (const s of NEW_SONGS) assert.match(card, new RegExp(s.id));
    const loc = buildFreeMusicLocProofLocal("grace");
    assert.equal(loc.ok, true);
    assert.ok(loc.matched >= 1);
    assert.equal(loc.rows[0].match, "LOCAL_OK");
    assert.equal(loc.rows[0].clickThrough, false);
    assert.equal(provenMusicOnChain("grace").chainDirName, "amazing-grace");
    assert.equal(provenMusicOnChain("grace").proven, false);
  });

  it("never files Over the Rainbow Decca; lining is rainbow-adjacent", () => {
    const lining = loadFreeMusic("lining");
    assert.equal(lining.ok, true);
    assert.match(lining.license, /not Over the Rainbow Decca/i);
    const catalog = JSON.parse(
      readFileSync(join(root, "vita/memory/free-music-catalog.json"), "utf8"),
    );
    assert.ok((catalog.skipped || []).some((x) => /Over the Rainbow/i.test(x.title || x.reason || "")));
  });
});

describe("enqueue library banks songs without flipping VITAFEED_PAID", () => {
  it("isMusicLibraryEnqueue does not steal memory-seed all", () => {
    assert.equal(isMusicLibraryEnqueue("library"), true);
    assert.equal(isMusicLibraryEnqueue("playlist"), true);
    assert.equal(isMusicLibraryEnqueue("music all"), true);
    assert.equal(isMusicLibraryEnqueue("all"), false);
    assert.equal(isMusicLibraryEnqueue("seed"), false);
    assert.equal(parseVitaFeedCommand("/vitafeed enqueue library").action, "enqueue");
    assert.equal(parseVitaFeedCommand("/vitafeed enqueue library").body, "library");
    assert.equal(parseVitaFeedCommand("/vitafeed enqueue grace").body, "grace");
    assert.equal(parseVitaFeedCommand("/vitafeed enqueue all").body, "all");
  });

  it("enqueues a subset of new ids each ≤24 VIN", () => {
    const tmp = mkdtempSync(join(tmpdir(), "vita-free-music-lib-"));
    setFeedBacklogPathForTests(join(tmp, "vitafeed-backlog.json"));
    resetFeedBacklogForTests();
    try {
      const queued = enqueueFreeMusicLibrary({
        enqueueFn: enqueueFeedBacklogItem,
        includeManifest: false,
        ids: ["grace", "daisy"],
      });
      assert.equal(queued.ok, true);
      assert.equal(queued.library, true);
      assert.deepEqual(queued.ids, ["grace", "daisy"]);
      assert.ok(queued.added >= 2);
      for (const s of queued.songs) {
        assert.equal(s.ok, true);
        assert.ok(s.groupCount >= 1);
      }
    } finally {
      setFeedBacklogPathForTests(null);
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });
});

const V4_SONGS = [
  {
    id: "entertainer",
    file: "The_Entertainer.ogg",
    sha: "5d2d3353c991422c86d590ddb52e09820d641fabaa82a043bd606ac48d6e9cd0",
    bytes: 1201443,
    aliases: ["the-entertainer", "ragtime-two-step"],
  },
  {
    id: "stripes",
    file: "Stars_and_Stripes_Forever.ogg",
    sha: "ba6296dc0875fddb2141510ee98120d05be4e4c12d7eb203364a41b187f11f14",
    bytes: 1077142,
    aliases: ["stars-and-stripes", "sousa"],
  },
  {
    id: "sweetheart",
    file: "Let_Me_Call_You_Sweetheart.ogg",
    sha: "9559e20ceb661eb04ec01860db3c46029fbfbd888108b58a65f179b5e761f7ac",
    bytes: 887184,
    aliases: ["let-me-call", "friedman"],
  },
  {
    id: "afterball",
    file: "After_the_Ball.ogg",
    sha: "44467cc6a2992e6e2dd3aae3321c2949143116922f76d82e500ff969ad61cfcb",
    bytes: 726361,
    aliases: ["after-the-ball", "gaskin"],
  },
];

describe("catalog v4 PD songs + loc inspect", () => {
  it("files four more real OGG bitstreams matching catalog sha256", () => {
    const ids = listCatalogSongIds();
    assert.ok(ids.length >= 12);
    for (const s of V4_SONGS) {
      const path = join(root, "vita/memory/free-music", s.file);
      assert.equal(existsSync(path), true, s.file + " missing");
      const bytes = readFileSync(path);
      assert.equal(bytes.subarray(0, 4).toString("ascii"), "OggS");
      assert.equal(bytes.length, s.bytes);
      assert.equal(createHash("sha256").update(bytes).digest("hex"), s.sha);
      assert.equal(resolveSongId(s.id), s.id);
      for (const a of s.aliases) {
        assert.equal(resolveSongId(a), s.id, a + " → " + s.id);
      }
    }
    assert.equal(resolveSongId("joplin"), MAPLE_ID);
    assert.equal(resolveSongId("entertainer"), "entertainer");
    assert.equal(resolveSongId("ball"), "ballgame");
    assert.equal(resolveSongId("afterball"), "afterball");
    assert.equal(resolveSongId("after-the-ball"), "afterball");
  });

  it("inspect returns exact VIN UTF-8 whose sha equals dataFieldCommit", () => {
    const packed = packetizeFreeMusic("afterball");
    assert.equal(packed.ok, true);
    const g = packed.groups[0];
    const line = g.lines[0].line;
    const inspected = inspectFreeMusicLoc({ packed, groupN: 1, index: 1 });
    assert.equal(inspected.ok, true);
    assert.equal(inspected.fedIntoPlayer, true);
    assert.equal(inspected.trueToBlock, true);
    assert.equal(inspected.line, line);
    assert.equal(inspected.dataFieldCommit, g.lineCommits[0].contentCommit);
    assert.equal(
      createHash("sha256").update(inspected.line, "utf8").digest("hex"),
      inspected.dataFieldCommit,
    );
    const again = inspectFreeMusicLoc({ id: "afterball", groupN: 1, index: 1 });
    assert.equal(again.line, inspected.line);
    assert.equal(again.dataFieldCommit, inspected.dataFieldCommit);
    assert.equal(inspected.location, null);
    assert.equal(inspected.match, "LOCAL_OK");
    assert.equal(inspected.neverInventHashes, true);
  });

  it("blockchain loc MATCH uses the same inspect line (test fixture loc, not invented seal)", async () => {
    const packed = packetizeFreeMusic("sweetheart");
    assert.equal(packed.ok, true);
    const line = packed.groups[0].lines[0].line;
    const wantCommit = packed.groups[0].lineCommits[0].contentCommit;
    const fakeTx = "0x" + "ab".repeat(32);
    const proof = await buildFreeMusicLocProof({
      id: "sweetheart",
      packed,
      sealedLocs: [{ groupN: 1, index: 1, location: fakeTx, utf8: line }],
    });
    assert.equal(proof.ok, true);
    assert.equal(proof.rows[0].match, "MATCH");
    assert.equal(proof.rows[0].dataFieldCommit, wantCommit);
    assert.equal(proof.rows[0].pulledUtf8Commit, wantCommit);
    assert.match(proof.rows[0].basescan, /basescan\.org\/tx\/0xab/);
    const inspected = inspectFreeMusicLoc({ packed, groupN: 1, index: 1 });
    assert.equal(inspected.line, line);
    assert.equal(inspected.dataFieldCommit, wantCommit);
    assert.equal(inspected.location, null);
    const publicOne = publicFreeMusicLoc("sweetheart", 1, 1);
    assert.equal(publicOne.ok, true);
    assert.equal(publicOne.line, line);
    const locLocal = buildFreeMusicLocProofLocal("stripes");
    assert.equal(locLocal.ok, true);
    assert.ok(locLocal.matched >= 1);
    assert.equal(locLocal.rows[0].match, "LOCAL_OK");
    assert.equal(provenMusicOnChain("stripes").chainDirName, "stars-and-stripes-forever");
    assert.equal(provenMusicOnChain("stripes").proven, false);
  });

  it("packetizes entertainer and reconstructs original OGG", () => {
    const packed = packetizeFreeMusic("entertainer");
    assert.equal(packed.ok, true);
    assert.equal(packed.sha256, V4_SONGS[0].sha);
    for (const g of packed.groups) {
      assert.ok(g.totalChunks <= MUSIC_GROUP_VIN_CAP);
    }
    const rebuilt = reconstructFreeMusicFromGroups(packed.groups);
    assert.equal(rebuilt.sha256, packed.sha256);
  });
});
