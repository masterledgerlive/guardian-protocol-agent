/**
 * KIDS YouTube URL directory — closed-garden player + dual-path Telegram load.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  KIDS_DIR_ID,
  URLDIR_ID,
  URLDIR_LABEL,
  URLDIR_MAGIC,
  URLDIR_SUBDIR,
  VITA_PRODUCTION_ORIGIN,
  closedGardenEmbedUrl,
  demoPlayerOpen,
  formatKidsDirCard,
  isDemoPlaySelector,
  isKidsPlaySelector,
  kidsDualHumanBody,
  kidsMachineIdsLine,
  listUrlDirectories,
  loadUrlDirectory,
  parseKidsPlayIndex,
  playKidsDirectory,
  publicUrlDirState,
  systemPlaylists,
  urlDirEntriesFor,
  vitaPlayerHref,
  vitaPublicOrigin,
} from "./url-dir.js";
import { MAINFRAME_ANCHORS } from "./mainframe.js";
import { listMasterDirectory, listSubDirectory, unlockDirectoryEntry } from "./vita-dir.js";
import {
  handleVitaFeedAction,
  parseVitaFeedCommand,
  resetVitaFeedPending,
} from "./vita-feed.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("kids url directory catalog", () => {
  it("loads the KIDS playlist URLs (closed garden)", () => {
    const dir = loadUrlDirectory("kids");
    assert.equal(dir.ok, true);
    assert.equal(dir.id, KIDS_DIR_ID);
    assert.equal(dir.label, URLDIR_SUBDIR);
    assert.equal(dir.closedGarden, true);
    assert.equal(dir.neverInventHashes, true);
    assert.ok(dir.count >= 90, "playlist should have ~100 urls");
    assert.equal(dir.items[0].videoId, "PGASxo9GdQM");
    assert.match(dir.items[0].title, /Reading Rainbow/i);
    assert.match(dir.items[0].url, /watch\?v=PGASxo9GdQM/);
    assert.equal(dir.ids.length, dir.count);
    assert.equal(new Set(dir.ids).size, dir.count);
    assert.match(formatKidsDirCard(dir), /closed garden/i);
    assert.match(formatKidsDirCard(dir), /\/vitafeed play kids/);
  });

  it("embed urls stay on youtube-nocookie with rel=0", () => {
    const u = closedGardenEmbedUrl("PGASxo9GdQM");
    assert.match(u, /youtube-nocookie\.com\/embed\/PGASxo9GdQM/);
    assert.match(u, /rel=0/);
    assert.match(u, /modestbranding=1/);
    assert.equal(closedGardenEmbedUrl("nope"), null);
  });

  it("never invents tx hashes — cites hardcoded anchors only", () => {
    const dir = loadUrlDirectory();
    for (const tx of dir.locations) {
      assert.ok(MAINFRAME_ANCHORS.known.some((a) => a.tx.toLowerCase() === tx.toLowerCase()));
    }
  });
});

describe("kids play selector + payload", () => {
  it("parses play kids N", () => {
    assert.equal(isKidsPlaySelector("kids"), true);
    assert.equal(isKidsPlaySelector("kids 3"), true);
    assert.equal(isKidsPlaySelector("KIDS?i=4"), true);
    assert.equal(isKidsPlaySelector("song.wav"), false);
    assert.equal(isDemoPlaySelector(""), true);
    assert.equal(isDemoPlaySelector("demo"), true);
    assert.equal(isDemoPlaySelector("kids"), false);
    assert.equal(parseKidsPlayIndex("kids 7"), 7);
    assert.equal(parseKidsPlayIndex("kids?i=12"), 12);
    assert.equal(parseKidsPlayIndex("kids"), 1);
  });

  it("play payload is youtube closed-garden only", () => {
    const opened = playKidsDirectory("kids 2");
    assert.equal(opened.ok, true);
    assert.equal(opened.play.kind, "youtube");
    assert.equal(opened.play.closedGarden, true);
    assert.equal(opened.n, 2);
    assert.match(opened.playerPath, /\/vita\/kids-player\?dir=kids&i=2/);
    assert.match(opened.playerHref, /^https:\/\//);
    assert.match(opened.playerHref, /popup=1/);
    assert.equal(opened.play.playlist.length, opened.count);
    assert.ok(!opened.play.embedUrl.includes("list=PL"), "must not load the YouTube playlist chrome");
  });
});

describe("dual-path HUMAN url list", () => {
  it("human body lists every video id", () => {
    const body = kidsDualHumanBody();
    assert.match(body, new RegExp("^" + URLDIR_MAGIC.replace(/[§]/g, "§")));
    assert.match(body, /PGASxo9GdQM/);
    const dir = loadUrlDirectory();
    assert.ok(body.includes(dir.ids.at(-1)));
    assert.match(kidsMachineIdsLine(dir), /closedGarden=1/);
    assert.ok(kidsMachineIdsLine(dir).includes(dir.ids[0]));
  });
});

describe("DOS KIDS subdir + Telegram wire", () => {
  it("master directory includes KIDS", () => {
    const master = listMasterDirectory();
    assert.ok(master.subdirs.some((d) => d.name === "KIDS"));
    const listed = listSubDirectory("KIDS");
    assert.equal(listed.ok, true);
    assert.ok(listed.entries.some((e) => e.name === "kids-url-dir.json"));
    assert.ok(listed.count >= 90);
    const unlocked = unlockDirectoryEntry("KIDS\\kids-url-dir.json");
    assert.equal(unlocked.ok, true);
    assert.match(unlocked.reveal.english, /closed-garden|KIDS/i);
  });

  it("/vitafeed kids|play kids|dual kids parse", async () => {
    resetVitaFeedPending();
    assert.equal(parseVitaFeedCommand("/vitafeed kids").action, "kids");
    assert.equal(parseVitaFeedCommand("/vitafeed play kids").action, "play");
    assert.equal(parseVitaFeedCommand("/vitafeed play kids").body, "kids");
    assert.equal(parseVitaFeedCommand("/vitafeed dual kids").action, "dual");
    assert.equal(parseVitaFeedCommand("/vitafeed dual kids").body, "kids");

    const card = await handleVitaFeedAction({ action: "kids", chatId: "kids-wire" });
    assert.equal(card.ok, true);
    assert.match(card.reply, /KIDS URL DIRECTORY/);
    assert.match(card.reply, /closed garden/i);

    const play = await handleVitaFeedAction({
      action: "play",
      body: "kids 1",
      chatId: "kids-wire",
    });
    assert.equal(play.ok, true);
    assert.equal(play.playProof?.play?.kind || play.play?.kind, "youtube");
    assert.match(play.reply, /kids-player/);
    assert.match(play.playerHref, /^https:\/\//);
    assert.ok(play.keyboard?.inline_keyboard?.flat().some((b) => b.web_app?.url || b.url));

    const demo = await handleVitaFeedAction({
      action: "play",
      body: "demo",
      chatId: "kids-wire",
    });
    assert.equal(demo.ok, true);
    assert.equal(demo.demo, true);
    assert.match(demo.playerHref, /feed-player\?demo=1/);
    assert.match(demo.playerHref, /popup=1/);
    assert.ok(demo.keyboard?.inline_keyboard?.flat().some((b) => b.web_app?.url || b.url));

    const dual = await handleVitaFeedAction({
      action: "dual",
      body: "kids",
      chatId: "kids-dual",
    });
    assert.equal(dual.ok, true);
    assert.equal(dual.dual, true);
    assert.equal(dual.staged, true);
    assert.match(dual.reply, /HUMAN|MACHINE/);
    assert.ok(dual.prepared?.totalChunks >= 1);
    resetVitaFeedPending();
  });
});

describe("HTTP url-dir + kids player", () => {
  it("serves catalog JSON and kids-player HTML", async () => {
    const { createServer } = await import("node:http");
    const html = readFileSync(join(root, "public", "vita-kids-player.html"), "utf8");
    const server = createServer((req, res) => {
      const u = new URL(req.url || "/", "http://127.0.0.1");
      if (u.pathname.startsWith("/vita/url-dir")) {
        const id = u.pathname.replace(/^\/vita\/url-dir\/?/, "") || "kids";
        const body = JSON.stringify(publicUrlDirState(id || "kids"));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(body);
        return;
      }
      if (u.pathname.startsWith("/vita/kids-player")) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
        return;
      }
      res.writeHead(404);
      res.end("no");
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    const base = "http://127.0.0.1:" + port;
    try {
      const cat = await fetch(base + "/vita/url-dir/kids").then((r) => r.json());
      assert.equal(cat.ok, true);
      assert.equal(cat.closedGarden, true);
      assert.ok(cat.dir.items.length >= 90);
      assert.equal(cat.dir.items[0].videoId, "PGASxo9GdQM");
      const page = await fetch(base + "/vita/kids-player?dir=kids").then((r) => r.text());
      assert.match(page, /closed garden/i);
      assert.match(page, /youtube-nocookie/);
      assert.match(page, /\/vita\/url-dir\//);
      assert.match(page, /telegram-web-app\.js/);
      assert.match(page, /playlistPick/);
      assert.ok(cat.playlists.some((p) => p.id === "kids"));
      assert.ok(cat.playlists.some((p) => p.id === "demo"));
      assert.ok(cat.playlists.some((p) => p.id === "maple"));
    } finally {
      await new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
    }
  });
});

describe("player surfaces exist", () => {
  it("kids player html is a closed garden", () => {
    const html = readFileSync(join(root, "public", "vita-kids-player.html"), "utf8");
    assert.match(html, /closed garden/i);
    assert.match(html, /youtube-nocookie/);
    assert.match(html, /\/vita\/url-dir\//);
    assert.match(html, /PlayerState\.ENDED/);
    assert.match(html, /telegram-web-app\.js/);
    assert.match(html, /btnPopout/);
    assert.match(html, /playlistPick/);
    assert.match(html, /kids-locked|vitaKidsPin|Kids PIN/);
    assert.match(html, /yt-shield|ytShield/);
    assert.match(html, /DEFAULT_PIN|0000/);
    assert.match(html, /btnPause/);
    assert.match(html, /kids=1/);
    assert.match(html, /\/vita\/free-music/);
    const hook = readFileSync(join(root, "vita-webhook.js"), "utf8");
    assert.match(hook, /\/vita\/kids-player/);
    assert.match(hook, /\/vita\/url-dir/);
    const feed = readFileSync(join(root, "public", "vita-feed-player.html"), "utf8");
    assert.match(feed, /dir=kids|loadUrlDirectory|closed garden/i);
    assert.match(feed, /telegram-web-app\.js/);
    assert.match(feed, /demo=1/);
    assert.match(feed, /music=maple/);
    assert.match(feed, /btnPopout/);
    assert.match(feed, /playlistPick/);
    assert.match(feed, /liveReaders|readerHuman|MACHINE · SNARK|timeupdate|paintLiveLoc/);
    assert.match(feed, /loc-active|loc-ticker/);
    assert.match(feed, /btnProof|Show blockchain|vitaMusicProof/);
    assert.match(feed, /btnNextSong/);
  });

  it("public HTTPS popup href + system playlists", () => {
    assert.equal(vitaPublicOrigin({}), VITA_PRODUCTION_ORIGIN);
    const href = vitaPlayerHref("/vita/feed-player?demo=1");
    assert.match(href, /^https:\/\//);
    assert.match(href, /popup=1/);
    const demo = demoPlayerOpen();
    assert.equal(demo.ok, true);
    assert.equal(demo.demo, true);
    assert.equal(demo.playerHref, href);
    const lists = systemPlaylists();
    assert.ok(lists.some((p) => p.id === "demo"));
    assert.ok(lists.some((p) => p.id === "kids"));
    assert.ok(lists.some((p) => p.id === "maple"));
  });

  it("public state lists only directory urls", () => {
    const pub = publicUrlDirState("kids");
    assert.equal(pub.ok, true);
    assert.equal(pub.id, URLDIR_ID);
    assert.equal(pub.filingLabel, URLDIR_LABEL);
    assert.ok(pub.dir.items.every((it) => /^[A-Za-z0-9_-]{11}$/.test(it.videoId)));
    assert.equal(listUrlDirectories().dirs[0].id, "kids");
    assert.ok(urlDirEntriesFor().length >= 90);
  });
});
