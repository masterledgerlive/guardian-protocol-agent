/**
 * GRAFT raw + loc + snark library inject — prove filing system works offline.
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const GRAFT_DIR = path.dirname(fileURLToPath(new URL("../store.js", import.meta.url)));
const STATE = fs.mkdtempSync(path.join(os.tmpdir(), "graft-snark-"));
process.env.GRAFT_STATE_DIR = STATE;
process.env.GRAFT_THINK_FREE = "yes";
process.env.GRAFT_DRY_RUN = "yes";
delete process.env.GRAFT_TELEGRAM_BOT_TOKEN;

const { casLocation, snarkCompressBlob, snarkCompressLibrary, packSnarkShort } =
  await import(pathToFileURL(path.join(GRAFT_DIR, "snark.js")).href);
const store = await import(pathToFileURL(path.join(GRAFT_DIR, "store.js")).href);
const {
  injectRootedLibraryLocal,
  readRootedLibraryFiles,
  listLibraries,
} = await import(pathToFileURL(path.join(GRAFT_DIR, "libraries.js")).href);
const { parseGraftCommand, dispatchGraftCommand } =
  await import(pathToFileURL(path.join(GRAFT_DIR, "commands.js")).href);
const { think } = await import(pathToFileURL(path.join(GRAFT_DIR, "think.js")).href);
const { seedGraft } = await import(pathToFileURL(path.join(GRAFT_DIR, "seed.js")).href);

before(() => {
  store.ensureStore();
  seedGraft();
});

describe("snark compress", () => {
  it("packs a blob with cas:// loc and never invents a tx", () => {
    const packed = snarkCompressBlob("hello graft snark", { title: "demo", name: "demo.txt" });
    assert.equal(packed.snarkReady, true);
    assert.equal(packed.privateWitness, false);
    assert.match(packed.loc, /^cas:\/\/sha256:[0-9a-f]{64}$/);
    assert.match(packed.short, /§GRAFTSNARK§/);
    assert.equal(/0x[a-fA-F0-9]{64}/.test(packed.short), false);
  });

  it("snark-compresses the whole rooted graft code library", () => {
    const files = readRootedLibraryFiles();
    assert.ok(files.length >= 8, "expected rooted graft modules on disk");
    const packed = snarkCompressLibrary(files, { title: "GRAFT-ROOTED-LIB" });
    assert.ok(packed.bytes > 1000);
    assert.equal(packed.fileCount, files.length);
    assert.match(packed.loc, /^cas:\/\/sha256:/);
    assert.ok(packed.files.every((f) => f.loc.startsWith("cas://")));
  });

  it("packSnarkShort is instantly unwrap-ready", () => {
    const p = packSnarkShort({ english: "open", machine: "M=test", title: "t", bytes: 3 });
    assert.equal(p.instantUnwrap, true);
    assert.equal(p.openSource, true);
  });
});

describe("raw data + location visibility", () => {
  it("every filed artifact gets a cas:// loc (not empty)", () => {
    const daisy = store.findArtifact("DAISY — Unified");
    assert.ok(daisy);
    assert.match(daisy.loc, /^cas:\/\/sha256:[0-9a-f]{64}$/);
    assert.ok(daisy.snark);
    assert.equal(daisy.chainLoc, null);
  });

  it("/graft raw shows RAW DATA and loc", () => {
    const daisy = store.findArtifact("DAISY — Unified");
    const r = dispatchGraftCommand(`/graft raw ${daisy.shortId}`);
    assert.match(r.html, /GRAFT raw/);
    assert.match(r.html, /RAW DATA/);
    assert.match(r.html, /cas:\/\/sha256:/);
    assert.match(r.html, /Polkadot JAM|Layer/);
  });

  it("/graft dir shows cas:// locs not empty dashes", () => {
    const r = dispatchGraftCommand("/graft dir");
    assert.match(r.html, /cas:\/\//);
    assert.doesNotMatch(r.html, /loc slots empty until harvest/);
  });

  it("list includes loc short", () => {
    assert.equal(parseGraftCommand("/graft show last").cmd, "raw");
    const r = dispatchGraftCommand("/graft list");
    assert.match(r.html, /loc=/);
  });
});

describe("library inject + activate without GitHub", () => {
  it("injects rooted libraries from local disk (no network)", () => {
    const result = injectRootedLibraryLocal({ activate: false });
    assert.equal(result.ok, true);
    assert.equal(result.activateWithoutGithub, true);
    assert.equal(result.source, "local-disk");
    assert.ok(result.files.length >= 8);
    assert.match(result.snark.loc, /^cas:\/\/sha256:/);
    assert.match(result.catalog.loc, /^cas:\/\/sha256:/);
    const libs = listLibraries();
    assert.ok(libs.length >= result.files.length);
  });

  it("activate + think works offline from CAS after local inject", () => {
    const catalog = store.findArtifact("GRAFT-ROOTED-LIB");
    assert.ok(catalog);
    // Prove no GitHub needed: think reads rawBlob from local CAS only.
    store.setActive(catalog.shortId, true);
    const result = think(catalog.shortId);
    assert.equal(result.ok, true);
    assert.equal(result.tx, null);
    assert.ok(result.rootedPrefer >= 0);
    assert.match(result.artifact.loc, /^cas:\/\//);
    const blob = store.rawBlob(catalog);
    assert.match(blob, /Activate without GitHub/);
  });

  it("/graft inject local and /graft snark code never invent txs", () => {
    const inj = dispatchGraftCommand("/graft inject local");
    assert.match(inj.html, /activate without GitHub/i);
    assert.equal(/tx\s+0x[a-fA-F0-9]{64}/.test(inj.html), false);
    const snark = dispatchGraftCommand("/graft snark code");
    assert.match(snark.html, /whole rooted code library|GRAFT snark/);
    assert.match(snark.html, /cas:\/\/sha256:/);
    assert.equal(/0x[a-fA-F0-9]{64}/.test(snark.html.replace(/cas:\/\/sha256:[a-f0-9]+/g, "")), false);
  });
});

describe("casLocation helper", () => {
  it("rejects non-hashes", () => {
    assert.equal(casLocation("nope"), null);
    assert.match(casLocation("a".repeat(64)), /^cas:\/\/sha256:a{64}$/);
  });
});

describe("isolation still holds", () => {
  it("new modules do not import vita or piggy-bank", () => {
    const banned = /from\s+["']\.\.\/(vita\/|vita-|agent\.js|piggy-bank|guardian-v4)/;
    for (const f of ["snark.js", "libraries.js"]) {
      const src = fs.readFileSync(path.join(GRAFT_DIR, f), "utf8");
      assert.equal(banned.test(src), false, f);
      assert.equal(src.includes("piggy-bank"), false, f);
      assert.equal(/from\s+["'].*agent\.js["']/.test(src), false, f);
    }
  });
});
