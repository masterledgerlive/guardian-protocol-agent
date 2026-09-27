import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import {
  encodeEntry, decodeEntry, buildDoorFromBytes, isVrrCalldata, sha256Hex,
  verifyDoorAgainstGithub, verifyRegistryTx, resolveDoors, VRR_DEFAULT_REPO,
} from "./vita-route-registry.js";

const COMMIT = "0xa8fa3c1b750c39c68db36edf24bdf897175b10c0";
const code = readFileSync(new URL("./vita/wave-full.js", import.meta.url));
const test = readFileSync(new URL("./vita/wave-full.test.js", import.meta.url));
const door = buildDoorFromBytes({
  doorId: "wave-recall", name: "WAVE 28/28 Heraclitus reconstruct",
  desc: "join WAVE shard bodies from calldata; PASS iff sha256+LOC8 match answer key",
  commit: COMMIT, codePath: "vita/wave-full.js", testPath: "vita/wave-full.test.js",
  testResult: { pass: 14, total: 15 }, version: 1, codeBytes: code, testBytes: test,
});

describe("VRR encode/decode", () => {
  it("round-trips a door with magic + checksum", () => {
    const hex = encodeEntry(door);
    assert.ok(hex.startsWith("0x56525201"));
    assert.ok(isVrrCalldata(hex));
    const d = decodeEntry(hex);
    assert.equal(d.ok, true, d.error);
    for (const k of ["doorId", "name", "desc", "commit", "codePath", "codeHash", "testPath", "testHash", "version"]) {
      assert.deepEqual(d.entry[k], door[k], k);
    }
    assert.deepEqual(d.entry.testResult, { pass: 14, total: 15 });
    assert.equal(d.entry.repo, VRR_DEFAULT_REPO);
    assert.equal(d.entry.codeHash, "0x" + sha256Hex(code));
  });
  it("rejects corrupted payloads", () => {
    const hex = encodeEntry(door);
    const flip = hex.slice(0, 20) + (hex[20] === "0" ? "1" : "0") + hex.slice(21);
    assert.equal(decodeEntry(flip).error, "checksum mismatch");
    assert.equal(decodeEntry("0x00" + hex.slice(4)).error, "bad magic");
    assert.equal(decodeEntry("0x1234").ok, false);
  });
  it("requires core door fields", () => {
    assert.throws(() => encodeEntry({ doorId: "x" }), /missing/);
  });
  it("encodes grade entries referencing a door tx", () => {
    const tx = "0x" + "ab".repeat(32);
    const d = decodeEntry(encodeEntry({ kind: "grade", refDoor: tx, grade: 88, grader: "agent-x" }));
    assert.equal(d.ok, true);
    assert.equal(d.entry.kind, "grade");
    assert.equal(d.entry.grade, 88);
    assert.equal(d.entry.refDoor, tx);
  });
  it("keeps non-default repo", () => {
    const d = decodeEntry(encodeEntry({ ...door, repo: "a/b" }));
    assert.equal(d.entry.repo, "a/b");
  });
});

describe("VRR verify", () => {
  const fakeFetch = (map) => async (url, opts) => {
    if (opts?.method === "POST") {
      const { method } = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ result: map[method] }) };
    }
    const body = map[url];
    return body ? { ok: true, arrayBuffer: async () => body } : { ok: false, status: 404 };
  };
  const raw = (p) => `https://raw.githubusercontent.com/${VRR_DEFAULT_REPO}/${COMMIT.slice(2)}/${p}`;
  it("passes when GitHub bytes match", async () => {
    const f = fakeFetch({ [raw("vita/wave-full.js")]: code, [raw("vita/wave-full.test.js")]: test });
    const r = await verifyDoorAgainstGithub(decodeEntry(encodeEntry(door)).entry, f);
    assert.equal(r.ok, true);
  });
  it("fails when GitHub bytes differ", async () => {
    const f = fakeFetch({ [raw("vita/wave-full.js")]: Buffer.from("x"), [raw("vita/wave-full.test.js")]: test });
    const r = await verifyDoorAgainstGithub(decodeEntry(encodeEntry(door)).entry, f);
    assert.equal(r.codeHashOk, false);
    assert.equal(r.ok, false);
  });
  it("verifies a self-call registry tx end to end (mock RPC)", async () => {
    const w = "0x50e1c4608c48b0c52e1ea5fbabc1c9126ea17915";
    const f = fakeFetch({
      eth_getTransactionByHash: { from: w, to: w, value: "0x0", input: encodeEntry(door) },
      eth_getTransactionReceipt: { status: "0x1", blockNumber: "0x10" },
      [raw("vita/wave-full.js")]: code, [raw("vita/wave-full.test.js")]: test,
    });
    const r = await verifyRegistryTx("0x" + "11".repeat(32), { expectFrom: w, fetchImpl: f });
    assert.equal(r.ok, true);
    assert.equal(r.selfCall, true);
  });
});

describe("VRR supersede", () => {
  it("newer version that supersedes head and is not worse wins", () => {
    const e1 = { ...door, testResult: { pass: 14, total: 15 } };
    const t1 = "0x" + "01".repeat(32), t2 = "0x" + "02".repeat(32), t3 = "0x" + "03".repeat(32);
    const rows = [
      { txHash: t1, entry: { ...e1, kind: "door" } },
      { txHash: t2, entry: { ...e1, kind: "door", version: 2, supersedes: t1, testResult: { pass: 15, total: 15 } } },
      { txHash: t3, entry: { ...e1, kind: "door", version: 3, supersedes: t2, testResult: { pass: 1, total: 15 } } },
      { txHash: "0x" + "04".repeat(32), entry: { kind: "grade", refDoor: t2, grade: 90, grader: "a" } },
    ];
    const r = resolveDoors(rows);
    assert.equal(r.heads["wave-recall"].txHash, t2);
    assert.equal(r.grades[t2][0].grade, 90);
  });
});
