import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readInjectLog, verifyFiling, walkBlocks, BLOCK_CAP, dataFieldRoom, packBlocks } from "./blocks.js";
import { PACKET_MAX, parseWire, sha256Hex, squash, expand } from "./codec.js";
import { displayOpenKey } from "./keys.js";
import { ipfsAdd } from "./ipfs-outlet.js";
import { HOME_ADDRESS } from "./home.js";
import { VERIFIED_HOME_ADDRESS } from "../../operator-rotate.js";
import { createMatch, stepMatch } from "./pong.js";
import { proveFromReceipt, readBytes } from "./reader.js";
import { renderBundle } from "./bundle.js";
import { startPhosphorServer } from "./server.js";
import { runStartup } from "./startup.js";
import { foldStark, verifyStark } from "./stark.js";
import { buildPhosphorPopupKeyboard, phosphorHref } from "./telegram.js";
import { synthWav } from "./wav.js";
import { writeBytes } from "./writer.js";

function scratch() {
  return mkdtempSync(join(tmpdir(), "phosphor-test-"));
}

test("squash round-trips text and a beep", () => {
  const note = Buffer.from("phosphor note ".repeat(40));
  const crushed = squash(note);
  assert.ok(crushed.payloadBytes < note.length);
  assert.deepEqual(expand(crushed.encoder, crushed.bytes), note);
  const wav = synthWav();
  assert.equal(wav.subarray(0, 4).toString(), "RIFF");
  const audio = squash(wav);
  assert.deepEqual(expand(audio.encoder, audio.bytes), wav);
});

test("open write and lock unwrap stay on injector wires", async () => {
  const stateDir = scratch();
  const open = await writeBytes({
    bytes: Buffer.from("hello phosphor"),
    name: "hello.txt",
    stateDir,
    tryIpfs: false,
  });
  assert.equal(open.header.chain.location, null);
  assert.equal(open.header.keyMode, "open");
  assert.match(open.header.keyMeta, /^open:PHOSOPEN\|[0-9a-f]{16}$/);
  for (const wire of open.wires) {
    assert.ok(Buffer.byteLength(wire, "utf8") <= PACKET_MAX);
    parseWire(wire);
  }
  const back = await readBytes({ commit: open.commit.slice(0, 8), stateDir });
  assert.equal(back.raw.toString(), "hello phosphor");
  assert.equal(back.from, "injector-wires");

  const secret = Buffer.from("sealed song bytes");
  const locked = await writeBytes({
    bytes: secret,
    name: "secret.bin",
    stateDir,
    lockKey: "correct-horse",
    tryIpfs: false,
  });
  await assert.rejects(
    () => readBytes({ commit: locked.commit, stateDir }),
    /lock key required/,
  );
  await assert.rejects(
    () => readBytes({ commit: locked.commit, stateDir, lockKey: "nope" }),
    /unable to authenticate|Unsupported state|auth/i,
  );
  const opened = await readBytes({ commit: locked.commit, stateDir, lockKey: "correct-horse" });
  assert.deepEqual(opened.raw, secret);
  rmSync(stateDir, { recursive: true, force: true });
});

test("stark fold detects a swapped leaf", () => {
  const stark = foldStark([
    { name: "a.js", snarkCommit: "aa".repeat(32), rawHash: "11" },
    { name: "b.js", snarkCommit: "bb".repeat(32), rawHash: "22" },
  ]);
  assert.equal(verifyStark(stark).ok, true);
  assert.equal(stark.circuitWired, false);
  assert.equal(stark.winterfellWired, false);
  assert.throws(
    () => verifyStark({ ...stark, files: stark.files.map((row, i) => i === 0 ? { ...row, snarkCommit: "cc".repeat(32) } : row) }),
    /stark root mismatch/,
  );
});

test("ipfs outlet stays standby without inventing a CID", async () => {
  const outlet = await ipfsAdd(Buffer.from("x"), {
    api: "http://127.0.0.1:9",
    timeoutMs: 300,
  });
  assert.equal(outlet.ok, false);
  assert.equal(outlet.outlet, "standby");
  assert.equal(outlet.cid, null);
  assert.equal(outlet.loc, null);
});

test("send-as-code bundle unwraps without the module", async () => {
  const stateDir = scratch();
  const body = synthWav({ seconds: 0.05, freq: 660 });
  const written = await writeBytes({
    bytes: body,
    name: "beep.wav",
    mime: "audio/wav",
    stateDir,
    tryIpfs: false,
  });
  const dir = scratch();
  const bundlePath = join(dir, "bundle.mjs");
  const outPath = join(dir, "beep-out.wav");
  writeFileSync(bundlePath, renderBundle(written.header, written.wires));
  const run = spawnSync(process.execPath, [bundlePath, outPath], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.deepEqual(readFileSync(outPath), body);
  rmSync(stateDir, { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
});

test("startup loads the library from wires and plays the beep back", async () => {
  const stateDir = scratch();
  const result = await runStartup({ stateDir, tryIpfs: false });
  assert.equal(result.ok, true, result.log);
  assert.match(result.starkRoot, /^[0-9a-f]{64}$/);
  assert.equal(result.location, null);
  assert.match(result.log, /SELF-RUN OK/);
  assert.match(result.log, /ipfs outlet STANDBY/);
  const wav = await readBytes({ commit: result.wavCommit, stateDir });
  assert.equal(sha256Hex(wav.raw), sha256Hex(synthWav()));
  rmSync(stateDir, { recursive: true, force: true });
});

test("CRT page and write route", async () => {
  const stateDir = scratch();
  const started = await startPhosphorServer({ port: 0, host: "127.0.0.1", stateDir });
  try {
    const page = await fetch("http://127.0.0.1:" + started.port + "/phosphor?popup=1");
    const html = await page.text();
    assert.equal(page.status, 200);
    assert.match(html, /PHOSPHOR/);
    assert.match(html, /#67ff78|67ff78/);
    assert.match(html, /READER/);
    assert.match(html, /LIBRARY/);
    const body = Buffer.from("crt note");
    const res = await fetch("http://127.0.0.1:" + started.port + "/phosphor/api/write", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "crt.txt",
        mime: "text/plain",
        bytesBase64: body.toString("base64"),
        tryIpfs: false,
      }),
    });
    const json = await res.json();
    assert.equal(json.ok, true);
    assert.equal(json.location, null);
    const played = await fetch("http://127.0.0.1:" + started.port + "/phosphor/api/play?c=" + json.commit.slice(0, 10));
    assert.equal(Buffer.from(await played.arrayBuffer()).toString(), "crt note");
  } finally {
    started.server.close();
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("single injected block recalls with the open key", async () => {
  const stateDir = scratch();
  const source = Buffer.from("export const one = 1;\n");
  const written = await writeBytes({
    bytes: source,
    name: "one.js",
    stateDir,
    tryIpfs: false,
    blockCount: 1,
  });
  assert.equal(written.receipt.proof, "SYSTEM_INJECTED");
  assert.equal(written.receipt.recalled, true);
  assert.equal(written.receipt.blockCount, 1);
  assert.equal(written.receipt.baseLocation, null);
  assert.match(written.receipt.filingLoc, /^stark:\/\/[0-9a-f]{16}$/);
  assert.equal(written.receipt.blocks[0].next, "END");
  assert.equal(written.receipt.blocks[0].prev, "GENESIS");
  assert.equal(written.receipt.blocks[0].machine.split("\n")[1], written.receipt.blocks[0].dataField);
  const filed = verifyFiling(written.receipt);
  assert.equal(filed.ok, true);
  const { recallPlain } = await import("./blocks.js");
  const key = displayOpenKey(written.header.keyMeta);
  assert.deepEqual(recallPlain(written.header, written.receipt.blocks, key), source);
  assert.throws(() => recallPlain(written.header, written.receipt.blocks, ""), /open key required/);
  const log = readInjectLog(stateDir);
  assert.equal(log.at(-1).proof, "SYSTEM_INJECTED");
  assert.equal(log.at(-1).filingLoc, written.receipt.filingLoc);
  assert.equal(log.at(-1).recalled, true);
  assert.equal(log.at(-1).baseLocation, null);
  rmSync(stateDir, { recursive: true, force: true });
});

test("five-block header chain points at the next block and recalls", async () => {
  const stateDir = scratch();
  const source = Buffer.alloc(220);
  for (let i = 0; i < source.length; i++) source[i] = (i * 17 + 9) & 255;
  const written = await writeBytes({
    bytes: source,
    name: "five.bin",
    stateDir,
    tryIpfs: false,
    blockCount: 5,
  });
  const blocks = written.receipt.blocks;
  assert.equal(blocks.length, 5);
  assert.equal(blocks[0].prev, "GENESIS");
  for (let i = 0; i < 4; i++) {
    assert.equal(blocks[i].next, blocks[i + 1].loc);
    assert.match(blocks[i].machine, new RegExp("next=" + blocks[i].next.replace("/", "\\/")));
  }
  assert.equal(blocks[4].next, "END");
  const joined = walkBlocks(blocks);
  assert.equal(sha256Hex(joined), written.header.payloadHash);
  const { recallPlain } = await import("./blocks.js");
  const key = displayOpenKey(written.header.keyMeta);
  assert.deepEqual(recallPlain(written.header, blocks, key), source);
  const broken = blocks.map((block, index) => {
    if (index !== 0) return block;
    const next = "stark://deadbeefdeadbeef";
    const machine = block.machine.replace("next=" + block.next, "next=" + next);
    return { ...block, next, machine, machineHash: sha256Hex(machine) };
  });
  assert.throws(() => walkBlocks(broken), /next block missing/);
  const flipped = blocks.map((block, index) => index === 2 ? { ...block, dataField: "AAAA" } : block);
  assert.throws(() => walkBlocks(flipped), /data field hash mismatch|machine record mismatch/);
  rmSync(stateDir, { recursive: true, force: true });
});

test("receipt page shows the exact data field", async () => {
  const stateDir = scratch();
  const started = await startPhosphorServer({ port: 0, host: "127.0.0.1", stateDir });
  try {
    const source = Buffer.from("block-field-note");
    const res = await fetch("http://127.0.0.1:" + started.port + "/phosphor/api/write", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "note.txt",
        mime: "text/plain",
        bytesBase64: source.toString("base64"),
        tryIpfs: false,
        blockCount: 1,
      }),
    });
    const json = await res.json();
    assert.equal(json.receipt.proof, "SYSTEM_INJECTED");
    assert.equal(json.receipt.blockCount, 1);
    const page = await fetch("http://127.0.0.1:" + started.port + json.receipt.href);
    const html = await page.text();
    assert.match(html, /SYSTEM_INJECTED|proof SYSTEM_INJECTED/);
    assert.match(html, new RegExp(json.receipt.filingLoc.replace("/", "\\/")));
    const blockUrl = json.receipt.blocks[0].href;
    const blockPage = await fetch("http://127.0.0.1:" + started.port + blockUrl);
    const blockHtml = await blockPage.text();
    const { loadReceipt } = await import("./blocks.js");
    const { resolveCommit } = await import("./chain-store.js");
    const stored = loadReceipt(stateDir, resolveCommit(stateDir, json.commit));
    assert.ok(blockHtml.includes(stored.blocks[0].dataField));
    assert.ok(blockHtml.includes(stored.blocks[0].machine.split("\n")[0]));
    assert.match(blockHtml, /next END/);
    const recalled = await fetch("http://127.0.0.1:" + started.port + "/phosphor/api/recall", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        commit: json.commit,
        key: displayOpenKey(json.keyMeta),
      }),
    });
    const back = await recalled.json();
    assert.equal(Buffer.from(back.bytesBase64, "base64").toString(), "block-field-note");
    assert.equal(back.filingLoc, json.receipt.filingLoc);
    assert.equal(back.baseLocation, null);
  } finally {
    started.server.close();
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("telegram pop-out is https with popup=1", () => {
  const href = phosphorHref({ PHOSPHOR_PUBLIC_URL: "https://example.test" });
  assert.equal(href, "https://example.test/phosphor?popup=1");
  const kb = buildPhosphorPopupKeyboard({ PHOSPHOR_PUBLIC_URL: "https://example.test" });
  const urls = kb.inline_keyboard.flat().map((button) => button.web_app?.url || button.url).filter(Boolean);
  assert.ok(urls.every((url) => url.startsWith("https://example.test/phosphor?popup=1")));
  assert.ok(kb.inline_keyboard.flat().some((button) => button.callback_data === "/phosphor dir"));
});

test("auto machine line stays inside the 720 byte hitch", () => {
  assert.equal(HOME_ADDRESS, VERIFIED_HOME_ADDRESS);
  const room = dataFieldRoom(200000);
  const packed = packBlocks(Buffer.alloc(room * 2 + 3));
  assert.ok(packed.blockCount >= 2);
  for (const block of packed.blocks) {
    assert.ok(Buffer.byteLength(block.machine, "utf8") <= BLOCK_CAP);
  }
});

test("chunked write proves the snark equation on the HOME seat", async () => {
  const stateDir = scratch();
  const started = await startPhosphorServer({ port: 0, host: "127.0.0.1", stateDir });
  const origin = "http://127.0.0.1:" + started.port;
  try {
    const size = 600 * 1024;
    const source = randomBytes(size);
    const openRes = await fetch(origin + "/phosphor/api/write/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "wide.bin",
        mime: "application/octet-stream",
        totalBytes: size,
        tryIpfs: false,
      }),
    });
    const opened = await openRes.json();
    assert.equal(opened.ok, true);
    const part = 200 * 1024;
    let index = 0;
    for (let offset = 0; offset < size; offset += part) {
      const slice = source.subarray(offset, Math.min(size, offset + part));
      const partRes = await fetch(origin + "/phosphor/api/write/part", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session: opened.session,
          index,
          bytesBase64: slice.toString("base64"),
        }),
      });
      const partJson = await partRes.json();
      assert.equal(partJson.ok, true, partJson.reason);
      index += 1;
    }
    assert.equal(index, 3);
    const sealRes = await fetch(origin + "/phosphor/api/write/seal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session: opened.session }),
    });
    const sealed = await sealRes.json();
    assert.equal(sealed.ok, true, sealed.reason);
    assert.equal(sealed.location, null);
    assert.equal(sealed.receipt.baseLocation, null);
    assert.equal(sealed.receipt.blocksExternal, true);
    assert.equal(sealed.home.address, VERIFIED_HOME_ADDRESS);
    assert.equal(sealed.home.lane, "internal");
    assert.equal(sealed.home.symbol, "HOME");
    const proofRes = await fetch(origin + "/phosphor/api/proof", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commit: sealed.commit, key: sealed.openKey }),
    });
    const proof = await proofRes.json();
    assert.equal(proof.equal, true, proof.reason);
    assert.equal(proof.equation.recallHash, proof.equation.rawHash);
    assert.equal(proof.equation.joinedHash, proof.equation.payloadHash);
    assert.equal(proof.equation.snarkCommit, proof.equation.recomputedCommit);
    assert.equal(proof.bytes, size);
    assert.equal(proof.baseLocation, null);
    assert.match(proof.equation.text, /EQUAL/);
    const denied = await fetch(origin + "/phosphor/api/proof", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commit: sealed.commit, key: "PHOSOPEN|0000000000000000" }),
    });
    assert.equal(denied.status, 400);
    const pull = await fetch(origin + "/phosphor/api/pull?c=" + sealed.commit + "&key=" + encodeURIComponent(sealed.openKey));
    assert.equal(pull.status, 200);
    assert.ok(Buffer.from(await pull.arrayBuffer()).equals(source));
    const blockPage = await fetch(origin + sealed.receipt.blocks[0].href);
    assert.equal(blockPage.status, 200);
    const blockHtml = await blockPage.text();
    assert.match(blockHtml, /GENESIS/);
    const huge = await fetch(origin + "/phosphor/api/write", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "x".repeat(3 * 1024 * 1024),
    });
    assert.equal(huge.status, 413);
  } finally {
    started.server.close();
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("large injector file recalls from external machine blocks", async () => {
  const stateDir = scratch();
  const size = Math.floor(1.2 * 1024 * 1024);
  const source = randomBytes(size);
  const written = await writeBytes({
    bytes: source,
    name: "large.bin",
    stateDir,
    tryIpfs: true,
  });
  assert.equal(written.ipfs.cid, null);
  assert.match(written.ipfs.reason, /large file/);
  assert.equal(written.header.chain.location, null);
  assert.equal(written.wires.length, 0);
  assert.equal(existsSync(join(stateDir, "objects", written.commit, "stored.bin")), true);
  assert.equal(existsSync(join(stateDir, "objects", written.commit, "wires.json")), false);
  const proof = proveFromReceipt(stateDir, written.commit, displayOpenKey(written.header.keyMeta));
  assert.equal(proof.equal, true);
  assert.equal(proof.bytes, size);
  assert.equal(proof.home.address, HOME_ADDRESS);
  assert.equal(proof.baseLocation, null);
  const { loadBlock } = await import("./blocks.js");
  const first = loadBlock(stateDir, written.commit, { i: 0 });
  const last = loadBlock(stateDir, written.commit, { i: written.receipt.blockCount - 1 });
  assert.equal(first.block.prev, "GENESIS");
  assert.equal(first.block.next.startsWith("stark://"), true);
  assert.equal(last.block.next, "END");
  const back = await readBytes({ commit: written.commit, stateDir });
  assert.ok(back.raw.equals(source));
  rmSync(stateDir, { recursive: true, force: true });
});

test("library pong plays from the recalled snark imprint", async () => {
  const stateDir = scratch();
  const started = await startPhosphorServer({ port: 0, host: "127.0.0.1", stateDir });
  const origin = "http://127.0.0.1:" + started.port;
  try {
    const page = await fetch(origin + "/phosphor/vm.js");
    assert.equal(page.status, 200);
    assert.match(await page.text(), /export function stepMatch/);
    const libRes = await fetch(origin + "/phosphor/api/library");
    const lib = await libRes.json();
    assert.equal(lib.ok, true);
    assert.equal(lib.location, null);
    const pong = lib.items.find((item) => item.play === "phosphong");
    assert.ok(pong);
    assert.equal(pong.baseLocation, null);
    assert.match(pong.filingLoc, /^stark:\/\/[0-9a-f]{16}$/);
    assert.equal(pong.shorterThanData, true);
    assert.ok(pong.directoryBytes < pong.dataFieldBytes);
    assert.match(pong.snark, /§PHOSSNARK§/);
    const source = readFileSync(new URL("./sample/pong.route", import.meta.url));
    const proofRes = await fetch(origin + "/phosphor/api/proof", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commit: pong.commit, key: pong.openKey }),
    });
    const proof = await proofRes.json();
    assert.equal(proof.equal, true, proof.reason);
    assert.equal(proof.equation.recallHash, sha256Hex(source));
    const recallRes = await fetch(origin + "/phosphor/api/recall", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commit: pong.commit, key: pong.openKey }),
    });
    const recalled = await recallRes.json();
    const text = Buffer.from(recalled.bytesBase64, "base64").toString("utf8");
    assert.equal(text, source.toString("utf8"));
    const match = createMatch(text);
    const x0 = match.ballX;
    for (let i = 0; i < 40; i++) stepMatch(match, 1 / 60);
    assert.notEqual(match.ballX, x0);
    assert.equal(match.over, false);
    assert.ok(match.routeIndex >= 0);
    const picture = lib.items.find((item) => item.play === "picture");
    assert.ok(picture);
    assert.equal(picture.folder, "PICTURE");
    assert.equal(picture.keyAttached, true);
    assert.equal(picture.baseLocation, null);
    assert.equal(picture.basescan, null);
    assert.ok(picture.payloadBytes < picture.rawBytes);
    assert.equal(picture.shorterThanData, true);
    assert.equal(picture.shorterThanRaw, true);
    assert.ok(picture.directoryBytes < picture.dataFieldBytes);
    assert.ok(picture.directoryBytes < picture.rawBytes);
    const { unwrapDirectory } = await import("./directory.js");
    const { synthPicture } = await import("./picture.js");
    const opened = unwrapDirectory(stateDir, picture.filingLoc);
    assert.ok(opened.raw.equals(synthPicture()));
    assert.deepEqual(opened.order, picture.directory.split("|L=")[1].split("+"));
    const dir = await fetch(origin + "/phosphor/api/library").then((r) => r.json());
    const folders = dir.folders.map((folder) => folder.id);
    assert.deepEqual(folders, ["PLAY", "PICTURE"]);
    const { handlePhosphorCommand } = await import("./telegram.js");
    const clicked = await handlePhosphorCommand("/phosphor dir PICTURE", {
      stateDir,
      env: { PHOSPHOR_PUBLIC_URL: "https://example.test" },
    });
    assert.match(clicked.html, /picture\.ppm/);
    assert.match(clicked.html, /stark:\/\//);
    const openedCard = await handlePhosphorCommand("/phosphor open " + picture.commit.slice(0, 12), { stateDir });
    assert.match(openedCard.html, /open key attached/);
    assert.match(openedCard.html, /directory is shorter than the data field/);
    assert.match(openedCard.html, /base loc empty/);
    assert.equal(openedCard.result.basescan, null);
    const { writeBytes } = await import("./writer.js");
    const locked = await writeBytes({
      bytes: Buffer.from("lock-me-please"),
      name: "lock.txt",
      lockKey: "given-key",
      stateDir,
      tryIpfs: false,
    });
    const asked = await handlePhosphorCommand("/phosphor key " + locked.commit.slice(0, 12), { stateDir });
    assert.match(asked.html, /key required to unwrap snark/);
    const wrong = await handlePhosphorCommand("/phosphor key " + locked.commit.slice(0, 12) + " nope", { stateDir });
    assert.match(wrong.html, /authenticate data/);
    const recovered = await handlePhosphorCommand("/phosphor key " + locked.commit.slice(0, 12) + " given-key", { stateDir });
    assert.match(recovered.html, /recovered 14 bytes/);
    assert.equal(recovered.result.basescan, null);
    assert.equal(recovered.result.baseLocation, null);
  } finally {
    started.server.close();
    rmSync(stateDir, { recursive: true, force: true });
  }
});
