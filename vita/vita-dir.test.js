/**
 * DOS-style VITADIR — master directory + open-source unlock.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CODEX_SEED,
  VITADIR_ROOT,
  VITADIR_SUBDIRS,
  directoryStats,
  formatDirStatsCard,
  formatMasterDirCard,
  formatSubDirCard,
  formatUnlockCard,
  listMasterDirectory,
  listSubDirectory,
  openSourceUnlockKey,
  packMachineShort,
  unlockDirectoryEntry,
  unwrapMachineShort,
} from "./vita-dir.js";
import { handleVitaFeedAction, parseVitaFeedCommand, resetVitaFeedPending } from "./vita-feed.js";
import { MAINFRAME_ANCHORS } from "./mainframe.js";

describe("vita-dir DOS master directory", () => {
  it("lists master drive with known subdirs", () => {
    const master = listMasterDirectory();
    assert.equal(master.root, VITADIR_ROOT);
    assert.equal(master.privateKey, false);
    assert.equal(master.openSourceUnlock, true);
    assert.ok(master.subdirs.length >= VITADIR_SUBDIRS.length);
    assert.ok(master.fileCount >= CODEX_SEED.length);
    assert.match(formatMasterDirCard(master), /VITA:\\/);
    assert.match(formatMasterDirCard(master), /CODEX/);
  });

  it("lists CODEX with math/theory seeds", () => {
    const listed = listSubDirectory("CODEX");
    assert.equal(listed.ok, true);
    assert.ok(listed.entries.some((e) => e.name === "math-euler.txt"));
    assert.ok(listed.entries.some((e) => e.name === "translator-codex.txt"));
    assert.match(formatSubDirCard(listed), /math-euler/);
  });

  it("open-source unlock never requires a private key", () => {
    const key = openSourceUnlockKey({ name: "math-euler.txt", content: "e^(iπ)+1=0" });
    assert.equal(key.privateKey, false);
    assert.equal(key.openSource, true);
    assert.match(key.key, /^VITAOPEN\./);

    const unlocked = unlockDirectoryEntry("CODEX\\math-euler.txt");
    assert.equal(unlocked.ok, true);
    assert.equal(unlocked.unlock.privateKey, false);
    assert.match(unlocked.reveal.english, /Euler|e\^/i);
    assert.match(unlocked.reveal.machine, /exp\(i\*pi\)|EQ/i);
    assert.equal(unlocked.packed.instantUnwrap, true);
    assert.equal(unlocked.packed.privateWitness, false);
    const unwrapped = unwrapMachineShort(unlocked.packed, {
      english: unlocked.reveal.english,
      machine: unlocked.reveal.machine,
    });
    assert.equal(unwrapped.privateKeyRequired, false);
    assert.match(formatUnlockCard(unlocked), /privateKey=NO/);
    assert.match(formatUnlockCard(unlocked), /SNARK/);
    assert.match(formatUnlockCard(unlocked), /HUMAN \(plain text/);
    assert.match(formatUnlockCard(unlocked), /MACHINE \(key exposed/);
  });

  it("unlock calculator codex cites only real anchors when present", () => {
    const unlocked = unlockDirectoryEntry("codex-calculator.txt");
    assert.equal(unlocked.ok, true);
    for (const tx of unlocked.entry.locations || []) {
      assert.ok(MAINFRAME_ANCHORS.known.some((a) => a.tx.toLowerCase() === tx.toLowerCase()));
    }
  });

  it("machine short packs ZK-class commitment", () => {
    const packed = packMachineShort({
      english: "test",
      machine: "EQ 1 1",
      locs: [MAINFRAME_ANCHORS.known[0].tx],
      trueName: "calculator",
    });
    assert.match(packed.short, /^ZK§/);
    assert.equal(packed.snarkReady, true);
    assert.equal(packed.instantUnwrap, true);
  });

  it("ingest stats card is fund-later friendly", () => {
    const stats = directoryStats();
    assert.ok(stats.memoryJson >= 1);
    assert.match(formatDirStatsCard(stats), /Fund later|ingest/i);
  });

  it("/vitafeed dir|unlock wire", async () => {
    resetVitaFeedPending();
    assert.equal(parseVitaFeedCommand("/vitafeed dir").action, "dir");
    assert.equal(parseVitaFeedCommand("/vitafeed dir CODEX").action, "dir");
    assert.equal(parseVitaFeedCommand("/vitafeed dir CODEX").body, "CODEX");
    assert.equal(parseVitaFeedCommand("/vitafeed unlock math-euler.txt").action, "unlock");

    const dir = await handleVitaFeedAction({ action: "dir", body: "", chatId: "dir-wire" });
    assert.equal(dir.ok, true);
    assert.match(dir.reply, /MASTER DIRECTORY|VITA:\\/);

    const sub = await handleVitaFeedAction({ action: "dir", body: "CODEX", chatId: "dir-wire" });
    assert.equal(sub.ok, true);
    assert.match(sub.reply, /math-euler/);

    const unlock = await handleVitaFeedAction({
      action: "unlock",
      body: "CODEX\\math-euler.txt",
      chatId: "dir-wire",
    });
    assert.equal(unlock.ok, true);
    assert.match(unlock.reply, /FILE\s+math-euler|SNARK|privateKey=NO/);
    assert.match(unlock.reply, /HUMAN \(plain text|MACHINE \(key exposed/);
    assert.ok(unlock.keyboard?.inline_keyboard?.length >= 1);
  });
});
