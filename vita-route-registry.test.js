import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import {
  encodeEntry, decodeEntry, buildDoorFromBytes, isVrrCalldata, sha256Hex,
  verifyDoorAgainstGithub, verifyRegistryTx, resolveDoors, VRR_DEFAULT_REPO,
  ownerCommitment, verifyOwnerReveal, sealFields, unsealEntry, resolveAgents,
  VRR_VIS, VRR_ROLE, VRR_CHAIN_BASE,
} from "./vita-route-registry.js";

// v1 wave-recall door exactly as produced by the v1 encoder (commit 9463d84a paper test).
const V1_WAVE_RECALL = "0x565252010100010b776176652d726563616c6c0221574156452032382f32382048657261636c69747573207265636f6e737472756374034b6a6f696e205741564520736861726420626f646965732066726f6d2063616c6c646174613b205041535320696666207368613235362b4c4f4338206d6174636820616e73776572206b65790414a8fa3c1b750c39c68db36edf24bdf897175b10c00511766974612f776176652d66756c6c2e6a73062076d8362a2cbd5f8493fd6ec3bdf39ef8f3033cb7c0f5d6ec7ced6c5e68c205c00716766974612f776176652d66756c6c2e746573742e6a730820dad8acbfad84ae02e45df3d255b36ceb47703392dbdd360db8529442889d0c2c0904000e000f0a020001a8569ea9";

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
    assert.ok(hex.startsWith("0x56525202"));
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

describe("VRR v2 — backwards compat + chainId", () => {
  it("decodes a v1 entry (chainId defaults to Base 8453, plain)", () => {
    const d = decodeEntry(V1_WAVE_RECALL);
    assert.equal(d.ok, true, d.error);
    assert.equal(d.entry.version_wire, 1);
    assert.equal(d.entry.chainId, 8453);
    assert.equal(d.entry.visibility, VRR_VIS.PLAIN);
    assert.equal(d.entry.doorId, "wave-recall");
  });
  it("v2 writes chainId explicitly and supports other chains", () => {
    const d = decodeEntry(encodeEntry({ ...door, chainId: 1 }));
    assert.equal(d.entry.chainId, 1);
    assert.ok(encodeEntry(door).includes("100400002105")); // tag 0x10 len 4 → 8453
  });
});

describe("VRR v2 — agent directory (leader/follow + hidden owner)", () => {
  const secret = Buffer.alloc(32, 7);
  const commit = ownerCommitment(secret, "storage-token", VRR_CHAIN_BASE);
  const leader = { kind: "agent", agentName: "storage-token", ownerCommit: commit, role: VRR_ROLE.LEADER, visibility: VRR_VIS.PLAIN };
  it("round-trips a leader entry and proves ownership only with the secret", () => {
    const d = decodeEntry(encodeEntry(leader));
    assert.equal(d.ok, true, d.error);
    assert.equal(d.entry.kind, "agent");
    assert.equal(d.entry.agentName, "storage-token");
    assert.equal(verifyOwnerReveal(d.entry, secret), true);
    assert.equal(verifyOwnerReveal(d.entry, Buffer.alloc(32, 8)), false);
    assert.equal(verifyOwnerReveal({ ...d.entry, chainId: 1 }, secret), false); // chain-bound
    assert.ok(!encodeEntry(leader).includes(secret.toString("hex")));
  });
  it("rejects bad names and short secrets", () => {
    assert.throws(() => encodeEntry({ ...leader, agentName: "Bad Name" }), /agentName/);
    assert.throws(() => ownerCommitment("short", "x"), /16 bytes/);
  });
  it("leader links follows (repeatable) and follow points to leader", () => {
    const f1 = "0x" + "aa".repeat(32), f2 = "0x" + "bb".repeat(32);
    const d = decodeEntry(encodeEntry({ ...leader, links: [f1, f2] }));
    assert.deepEqual(d.entry.links, [f1, f2]);
    const fl = decodeEntry(encodeEntry({ ...leader, role: VRR_ROLE.FOLLOW, leader: "0x" + "cc".repeat(32) }));
    assert.equal(fl.entry.role, VRR_ROLE.FOLLOW);
    assert.equal(fl.entry.leader, "0x" + "cc".repeat(32));
  });
  it("first leader holds a name; owner update needs same commit+from+supersedes; challenger needs grades", () => {
    const L1 = "0x" + "01".repeat(32), L2 = "0x" + "02".repeat(32), X = "0x" + "03".repeat(32), F = "0x" + "04".repeat(32);
    const other = { ...leader, ownerCommit: ownerCommitment(Buffer.alloc(32, 9), "storage-token") };
    const rows = [
      { txHash: L1, from: "0xA", entry: { ...leader, chainId: 8453 } },
      { txHash: X, from: "0xB", entry: { ...other, chainId: 8453 } },
      { txHash: L2, from: "0xA", entry: { ...leader, chainId: 8453, supersedes: L1 } },
      { txHash: F, from: "0xA", entry: { ...leader, chainId: 8453, role: VRR_ROLE.FOLLOW, leader: L2 } },
    ];
    let r = resolveAgents(rows);
    assert.equal(r["8453:storage-token"].txHash, L2);
    assert.deepEqual(r["8453:storage-token"].follows, [F]);
    const g = (grader, grade) => ({ txHash: "0x" + grader.repeat(64).slice(0, 64), entry: { kind: "grade", refDoor: X, grade, grader } });
    r = resolveAgents([...rows, g("a", 95), g("b", 95), g("c", 95)]);
    assert.equal(r["8453:storage-token"].txHash, X);
  });
});

describe("VRR v2 — encoded visibility", () => {
  const key = Buffer.alloc(32, 3);
  it("seals fields (agent-decodable with key) and verifies via sealedHash", () => {
    const s = sealFields({ desc: "secret route notes", codePath: "x/y.js" }, key, Buffer.alloc(12, 1));
    const d = decodeEntry(encodeEntry({ ...door, desc: undefined, ...s }));
    assert.equal(d.ok, true, d.error);
    assert.equal(d.entry.visibility, VRR_VIS.ENCODED);
    const u = unsealEntry(d.entry, key);
    assert.equal(u.ok, true, u.error);
    assert.equal(u.fields.desc, "secret route notes");
    assert.equal(unsealEntry(d.entry, Buffer.alloc(32, 4)).ok, false);
  });
  it("encoded visibility without sealed payload is refused", () => {
    assert.throws(() => encodeEntry({ ...door, visibility: VRR_VIS.ENCODED }), /sealed/);
  });
});
