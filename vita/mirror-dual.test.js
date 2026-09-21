/**
 * Dual-path GitHub mirror + zero-proof + SNARK boot from filing CAS.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

import {
  MIRROR_BOOT_SECTIONS,
  attachZeroProofKey,
  bootMirrorSection,
  extractExportFunctionSource,
  followLeaderForFile,
  handleMirrorDualAction,
  loadInjectFilingMap,
  parseMirrorDualCommand,
  readDualPaths,
  walkMirrorTree,
} from "./mirror-dual.js";
import {
  handleVitaMirrorAction,
  parseVitaMirrorCommand,
} from "./mirror-chain.js";
import { MAINFRAME_ANCHORS } from "./mainframe.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function sha(text) {
  return createHash("sha256").update(String(text || ""), "utf8").digest("hex");
}

describe("vita mirror-dual real data paths", () => {
  it("parses tree|dual|path|boot|zero commands", () => {
    assert.equal(parseMirrorDualCommand("/vita tree vita").action, "tree");
    assert.equal(parseMirrorDualCommand("/vita tree vita").prefix, "vita");
    assert.equal(parseMirrorDualCommand("/vita dual vita/mainframe.js").action, "dual");
    assert.equal(parseMirrorDualCommand("/vita path proven vita/anchors.json").pathMode, "proven");
    assert.equal(parseMirrorDualCommand("/vita path availability vault-unlock.js").pathMode, "availability");
    assert.equal(parseMirrorDualCommand("/vita boot hitch-gate").sectionId, "hitch-gate");
    assert.equal(parseMirrorDualCommand("/vita zero vita/mainframe.js").action, "zero");
    assert.equal(parseVitaMirrorCommand("/vita dual vita/FILING.md").action, "dual");
    assert.equal(parseVitaMirrorCommand("/vita boot").action, "boot");
  });

  it("walks a real GitHub-shaped tree from disk (not a stub catalog)", () => {
    const tree = walkMirrorTree({ cwd: root, prefix: "vita", maxDepth: 2, maxEntries: 200 });
    assert.equal(tree.ok, true);
    assert.ok(tree.fileCount >= 10);
    const mainframe = tree.entries.find((e) => e.path === "vita/mainframe.js");
    assert.ok(mainframe, "vita/mainframe.js must appear under same path name");
    assert.equal(mainframe.type, "file");
    assert.ok(mainframe.contentCommit);
    assert.equal(mainframe.contentCommit, sha(readFileSync(join(root, "vita/mainframe.js"), "utf8")));
    assert.equal(mainframe.zeroProof.privateKey, false);
    assert.match(mainframe.zeroProof.key, /^VITAOPEN\./);
  });

  it("attaches zero-proof lock+key from real contentCommit (never a wallet secret)", () => {
    const body = readFileSync(join(root, "vita/anchors.json"), "utf8");
    const z = attachZeroProofKey({ name: "vita/anchors.json", content: body });
    assert.equal(z.privateKey, false);
    assert.equal(z.openSource, true);
    assert.equal(z.contentCommit, sha(body));
    assert.match(z.key, /anchors\.json/i);
  });

  it("dual-reads availability from real local file + honest proven-pending from inject filing", async () => {
    const out = await readDualPaths({
      filename: "vita/mainframe.js",
      pathMode: "dual",
      cwd: root,
    });
    assert.equal(out.ok, true);
    assert.equal(out.availability.ok, true);
    assert.match(out.availability.text, /originalFormulaHitchDecision|MAINFRAME_ANCHORS/);
    assert.equal(out.availability.contentCommit, sha(out.availability.text));
    assert.equal(out.zeroProof.privateKey, false);
    assert.ok(out.proven);
    assert.equal(out.proven.formulaAnchorsAreNotBody, true);
    // Chunks are pending — proven must NOT pretend formula anchors hold body
    assert.equal(out.followLeader.proven, false);
    assert.ok(["filing", "availability"].includes(out.followLeader.leader));
    for (const tx of MAINFRAME_ANCHORS.known.map((a) => a.tx)) {
      assert.ok(!out.proven.ok || !(out.proven.locations || []).includes(tx) || out.proven.pending);
    }
  });

  it("follow-leader: filing leads when inject plan has contentCommit but no seals", () => {
    const filing = loadInjectFilingMap({ cwd: root });
    assert.equal(filing.ok, true);
    assert.ok(filing.files["vita/mainframe.js"]?.contentCommit);
    const body = readFileSync(join(root, "vita/mainframe.js"), "utf8");
    const fl = followLeaderForFile({
      filename: "vita/mainframe.js",
      availabilityCommit: sha(body),
      filing,
    });
    assert.equal(fl.leader, "filing");
    assert.equal(fl.proven, false);
    assert.equal(fl.sealed, 0);
    assert.match(fl.note, /pending|Filing|class proof/i);
  });

  it("extracts real export source for boot sections", () => {
    for (const sec of MIRROR_BOOT_SECTIONS) {
      const text = readFileSync(join(root, sec.file), "utf8");
      const src = extractExportFunctionSource(text, sec.exportName);
      assert.ok(src, sec.file + "#" + sec.exportName);
      assert.match(src, new RegExp("function\\s+" + sec.exportName));
      assert.ok(src.includes("{") && src.trim().endsWith("}"));
    }
  });

  it("boots hitch-gate from SNARK filing CAS and matches live import", async () => {
    const result = await bootMirrorSection({
      sectionId: "hitch-gate",
      cwd: root,
      write: true,
    });
    assert.equal(result.ok, true);
    assert.equal(result.boot.ok, true);
    assert.equal(result.matchLive, true);
    assert.equal(result.boot.result.encoding, "key-loc");
    assert.equal(result.boot.result.skipHitch, false);
    assert.equal(result.zeroProof.privateKey, false);
    assert.equal(result.provenOnChain, false);
    assert.equal(result.cas.reconstructed, true);
    assert.ok(existsSync(join(root, "vita/memory/mirror-dual-ledger.json")));
    assert.ok(existsSync(join(root, "vita/strands/mirror-dual.json")));
    assert.doesNotMatch(result.note || "", /0xdeadbeef/i);
  });

  it("boots open-unlock and path-sanitize sections from real mirrored files", async () => {
    for (const id of ["open-unlock", "path-sanitize"]) {
      const result = await bootMirrorSection({ sectionId: id, cwd: root, write: true });
      assert.equal(result.ok, true, id);
      assert.equal(result.boot.ok, true, id);
      assert.equal(result.matchLive, true, id);
    }
  });

  it("handleMirrorDualAction tree + dual + boot end-to-end", async () => {
    const tree = await handleMirrorDualAction({
      action: "tree",
      prefix: "vita",
      cwd: root,
      write: false,
    });
    assert.equal(tree.ok, true);
    assert.match(tree.reply, /mainframe\.js|GitHub duplicate/i);

    const dual = await handleVitaMirrorAction({
      action: "dual",
      filename: "vita/anchors.json",
      pathMode: "dual",
      cwd: root,
      write: true,
      chatId: "test-dual",
    });
    assert.equal(dual.ok, true);
    assert.match(dual.reply, /VITADUALPATH|AVAIL|PROVEN|VITAZERO/);
    assert.equal(dual.zeroProof.privateKey, false);

    const boot = await handleVitaMirrorAction({
      action: "boot",
      sectionId: "hitch-gate",
      cwd: root,
      write: true,
      chatId: "test-boot",
    });
    assert.equal(boot.ok, true);
    assert.match(boot.reply, /VITABOOT|boot=YES/);
  });

  it("/vita read attaches zero-proof key on real vault-unlock.js", async () => {
    const out = await handleVitaMirrorAction({
      action: "read",
      filename: "vault-unlock.js",
      cwd: root,
      chatId: "test-zero-read",
    });
    assert.equal(out.ok, true);
    assert.ok(out.zeroProof?.key);
    assert.equal(out.zeroProof.privateKey, false);
    assert.match(out.reply, /VITAZERO|zero-proof/);
  });
});
