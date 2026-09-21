/**
 * Telegram click-through — every category + subcategory is a button.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CALLBACK_DATA_MAX,
  buildDirMasterKeyboard,
  buildDirSubKeyboard,
  buildLibraryFilesKeyboard,
  buildTokenActionKeyboard,
  buildTokenCatalogKeyboard,
  buildTrackInjectBody,
  buildUnlockKeyboard,
  buildVitaFeedRootKeyboard,
  buildVitaFeedStagedKeyboard,
  buildPlayerPopupKeyboard,
  formatTokenClickCard,
  keyboardForVitaFeedResult,
  parseTokenClickCommand,
  smokeClickThroughWalk,
  stripWebAppButtons,
  timeDualRoutes,
} from "./telegram-clickthrough.js";
import { listMasterDirectory, listSubDirectory, unlockDirectoryEntry } from "./vita-dir.js";
import { handleVitaFeedAction, parseVitaFeedCommand, resetVitaFeedPending } from "./vita-feed.js";

const HERE = dirname(fileURLToPath(import.meta.url));

function allCallbacks(kb) {
  return (kb?.inline_keyboard || []).flat().map((b) => b.callback_data || "");
}

function assertCallbacksFit(kb, label) {
  for (const cb of allCallbacks(kb)) {
    assert.ok(cb.length <= CALLBACK_DATA_MAX, label + " callback too long: " + cb);
  }
}

describe("telegram click-through keyboards", () => {
  it("root menu exposes dir/files/tokens/track with ≤64B callbacks", () => {
    const kb = buildVitaFeedRootKeyboard();
    const cbs = allCallbacks(kb);
    assert.ok(cbs.includes("/vitafeed dir"));
    assert.ok(cbs.includes("/vitafeed files"));
    assert.ok(cbs.includes("/vitafeed track"));
    assert.ok(cbs.includes("/tokens"));
    assert.ok(cbs.includes("/home agents"));
    assert.ok(cbs.includes("/home"));
    assertCallbacksFit(kb, "root");
  });

  it("master dir buttons open every subdir", () => {
    const master = listMasterDirectory();
    const kb = buildDirMasterKeyboard(master);
    const cbs = allCallbacks(kb);
    for (const d of master.subdirs) {
      assert.ok(
        cbs.some((c) => c === "/vitafeed dir " + d.name),
        "missing subdir button: " + d.name,
      );
    }
    assertCallbacksFit(kb, "master");
  });

  it("CODEX files are one-tap unlock", () => {
    const listed = listSubDirectory("CODEX");
    const kb = buildDirSubKeyboard(listed);
    const cbs = allCallbacks(kb);
    assert.ok(cbs.some((c) => /unlock/i.test(c) && /math-euler/i.test(c)));
    assert.ok(cbs.includes("/vitafeed dir"));
    assertCallbacksFit(kb, "codex");
  });

  it("unlock card shows SNARK first + dual timing + next-step buttons", async () => {
    resetVitaFeedPending();
    const unlocked = unlockDirectoryEntry("CODEX\\math-euler.txt");
    assert.equal(unlocked.ok, true);
    const timing = timeDualRoutes({
      english: unlocked.reveal.english,
      machine: unlocked.reveal.machine,
      packed: unlocked.packed,
    });
    assert.equal(timing.plainTextProof, true);
    assert.equal(timing.snarkUnlocksDenser, true);

    const out = await handleVitaFeedAction({
      action: "unlock",
      body: "CODEX\\math-euler.txt",
      chatId: "click-unlock",
    });
    assert.equal(out.ok, true);
    assert.match(out.reply, /SNARK/);
    assert.match(out.reply, /HUMAN \(plain text/);
    assert.match(out.reply, /MACHINE \(key exposed/);
    assert.match(out.reply, /timing human=/);
    assert.ok(out.keyboard?.inline_keyboard?.length >= 2);
    const cbs = allCallbacks(out.keyboard);
    assert.ok(cbs.some((c) => c.includes("/vitafeed dual") || c === "/vitafeed track"));
    assert.ok(cbs.includes("/vitafeed track"));
    assertCallbacksFit(out.keyboard, "unlock");
  });

  it("dir action returns clickable master keyboard", async () => {
    resetVitaFeedPending();
    const out = await handleVitaFeedAction({ action: "dir", body: "", chatId: "click-dir" });
    assert.equal(out.ok, true);
    assert.ok(out.keyboard?.inline_keyboard?.length >= 3);
    assertCallbacksFit(out.keyboard, "dir-action");
  });

  it("track stages inject proof body with staged keyboard", async () => {
    resetVitaFeedPending();
    assert.equal(parseVitaFeedCommand("/vitafeed track").action, "track");
    assert.equal(parseVitaFeedCommand("/vitafeed track AERO").body, "AERO");
    const out = await handleVitaFeedAction({
      action: "track",
      body: "AERO",
      chatId: "click-track",
      quotes: { live: false, gwei: 0.01, ethUsd: 3000, l1FeeEth: 0, gasCostEth: 0.0001 },
    });
    assert.equal(out.ok, true);
    assert.equal(out.phase, "track");
    assert.equal(out.staged, true);
    assert.match(out.reply, /TRACK INJECT|§VITACLICK§/);
    assert.match(out.reply, /plainProof=YES/);
    assert.ok(allCallbacks(out.keyboard).includes("/vitafeed confirm"));
    assert.ok(buildTrackInjectBody({ symbol: "AERO" }).includes("AERO"));
  });

  it("token catalog + submenu are fully clickable", () => {
    const symbols = ["AERO", "BRETT", "VIRTUAL", "HOME"];
    const cat = buildTokenCatalogKeyboard(symbols);
    assert.ok(allCallbacks(cat).includes("/tok AERO"));
    assert.ok(allCallbacks(cat).includes("/chains"));
    assert.ok(allCallbacks(cat).includes("/dex"));
    assertCallbacksFit(cat, "tokens");
    const act = buildTokenActionKeyboard("AERO");
    const cbs = allCallbacks(act);
    assert.ok(cbs.includes("/buy AERO"));
    assert.ok(cbs.includes("/sell AERO"));
    assert.ok(cbs.includes("/exit AERO"));
    assert.ok(cbs.includes("/dex AERO"));
    assert.ok(cbs.includes("/legit AERO"));
    assert.ok(cbs.includes("/piggyunlock AERO"));
    assert.ok(cbs.includes("/vitafeed track AERO") || cbs.includes("/vitafeed track"));
    assertCallbacksFit(act, "tok-AERO");
    assert.equal(parseTokenClickCommand("/tokens").action, "catalog");
    assert.equal(parseTokenClickCommand("/tok AERO").symbol, "AERO");
    assert.match(formatTokenClickCard("AERO"), /AERO/);
  });

  it("library keyboard plays by index", () => {
    const kb = buildLibraryFilesKeyboard([
      { n: 1, name: "song.mp3" },
      { n: 2, name: "clip.mp4" },
    ]);
    const cbs = allCallbacks(kb);
    assert.ok(cbs.includes("/vitafeed play 1"));
    assert.ok(cbs.includes("/vitafeed play 2"));
    assertCallbacksFit(kb, "library");
  });

  it("smoke walk: master → subdir → unlock → all callbacks fit", () => {
    const walk = smokeClickThroughWalk();
    assert.equal(walk.ok, true);
    assert.ok(walk.masterSubdirs >= 8);
    assert.ok(walk.subFiles >= 1);
    assert.equal(walk.unlocked, true);
    assert.equal(walk.allFit64, true);
    assert.ok(walk.urlCount >= 2);
    assert.equal(walk.httpsPlayer, true);
    assert.ok(walk.snarkFirst?.startsWith("ZK§"));
    assert.equal(walk.timing?.plainTextProof, true);
  });

  it("keyboardForVitaFeedResult maps phases", () => {
    const master = keyboardForVitaFeedResult({
      action: "dir",
      out: { master: listMasterDirectory() },
    });
    assert.ok(allCallbacks(master).some((c) => c.startsWith("/vitafeed dir ")));
    const staged = keyboardForVitaFeedResult({ action: "preview", out: {} });
    assert.ok(allCallbacks(staged).includes("/vitafeed confirm"));
    const root = keyboardForVitaFeedResult({ action: "usage", out: {} });
    assert.ok(allCallbacks(root).includes("/vitafeed dir"));
    assert.ok(allCallbacks(root).includes("/vitafeed play maple"));
    assert.ok(allCallbacks(root).includes("/vitafeed music"));
    const flatRoot = root.inline_keyboard.flat();
    assert.ok(flatRoot.some((b) => b.web_app?.url?.includes("kids-player")));
    assert.ok(flatRoot.some((b) => b.web_app?.url?.includes("/vita/players/garden")));
    assert.ok(flatRoot.some((b) => b.web_app?.url?.includes("/vita/players/proven")));
    assert.ok(flatRoot.some((b) => b.web_app?.url?.includes("demo=1")));
    assert.ok(flatRoot.some((b) => b.url?.includes("kids-player")));
  });

  it("player popup keyboard is Mini App + HTTPS url fallback", () => {
    const kb = buildPlayerPopupKeyboard({ playerPath: "/vita/kids-player?dir=kids" });
    const flat = kb.inline_keyboard.flat();
    const web = flat.find((b) => b.web_app?.url);
    const url = flat.find((b) => b.url);
    assert.ok(web, "Watch popup Mini App button");
    assert.ok(url, "Open player HTTPS fallback");
    assert.ok(allCallbacks(kb).includes("/vitafeed music"));
    assert.ok(allCallbacks(kb).includes("/vitafeed enqueue library"));
    assert.match(web.web_app.url, /^https:\/\//);
    assert.match(web.web_app.url, /popup=1/);
    assert.match(url.url, /^https:\/\//);
    const stripped = stripWebAppButtons(kb);
    assert.ok(!stripped.inline_keyboard.flat().some((b) => b.web_app));
    assert.ok(stripped.inline_keyboard.flat().some((b) => b.url));
    const demoKb = keyboardForVitaFeedResult({
      action: "play",
      out: { demo: true, playerPath: "/vita/feed-player?demo=1" },
    });
    assert.ok(demoKb.inline_keyboard.flat().some((b) => (b.web_app?.url || b.url || "").includes("demo=1")));
  });

  it("staged keyboard always offers confirm/override/cancel", () => {
    const kb = buildVitaFeedStagedKeyboard();
    const cbs = allCallbacks(kb);
    assert.ok(cbs.includes("/vitafeed confirm"));
    assert.ok(cbs.includes("/vitafeed override"));
    assert.ok(cbs.includes("/vitafeed cancel"));
  });

  it("agent.js wires reply_markup for vitafeed + tokens", () => {
    const agent = readFileSync(join(HERE, "..", "agent.js"), "utf8");
    assert.match(agent, /telegram-clickthrough/);
    assert.match(agent, /buildVitaFeedRootKeyboard/);
    assert.match(agent, /parseTokenClickCommand/);
    assert.match(agent, /reply_markup:\s*out\.keyboard/);
    assert.match(agent, /text === "\/tokens"/);
    assert.match(agent, /stripWebAppButtons/);
    assert.match(agent, /Watch popup/);
    assert.match(agent, /demoPlayerOpen/);
  });

  it("unlock keyboard callbacks fit for long paths", () => {
    const unlocked = unlockDirectoryEntry("CODEX\\theory-message-first.txt");
    assert.equal(unlocked.ok, true);
    const kb = buildUnlockKeyboard(unlocked);
    assertCallbacksFit(kb, "long-unlock");
  });
});
