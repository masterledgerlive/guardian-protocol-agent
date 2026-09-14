/**
 * Mother Genesis — N-batch plain / encoded path (mother brain untouched).
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  MG_CHUNK_CHARS,
  attachFullLines,
  buildMotherGenesisLocListPages,
  formatMotherGenesisReceipt,
  planMotherGenesisChunks,
  prepareEncodedMotherGenesis,
  preparePlainMotherGenesis,
  parseMotherGenesisLine,
  parseMotherGenesisLocListLine,
  parseRevealKey,
  reconstructLocationsFromLocListPages,
  resetMotherGenesisRegistry,
  revealMotherGenesis,
  runMotherGenesisInscribe,
  sealMotherGenesisLocations,
  verifyLocZeroProof,
} from "./mother-genesis.js";

describe("mother-genesis chunking", () => {
  it("plans more than 5 batches when body is large", () => {
    const body = "X".repeat(MG_CHUNK_CHARS * 7 + 50);
    const plan = planMotherGenesisChunks(body);
    assert.equal(plan.ok, true);
    assert.equal(plan.totalChunks, 8);
    assert.ok(plan.totalChunks > 5);
  });

  it("refuses empty body", () => {
    assert.equal(planMotherGenesisChunks("").ok, false);
  });
});

describe("mother-genesis plain path", () => {
  beforeEach(() => resetMotherGenesisRegistry());

  it("inscribes N plain chunks and reveals with reader key", async () => {
    const body = "code-line\n".repeat(200);
    const prepared = preparePlainMotherGenesis(body, { chunkChars: 100 });
    assert.ok(prepared.totalChunks > 5);

    let n = 0;
    const fakeHashes = [];
    const result = await runMotherGenesisInscribe(prepared, async () => {
      n += 1;
      const h = "0x" + String(n).padStart(64, "a").slice(0, 64);
      fakeHashes.push(h);
      return h;
    });
    assert.equal(result.ok, true);
    assert.equal(result.strand.locations.length, prepared.totalChunks);
    assert.match(result.strand.readerKey, /^MGPLAIN\.MG-P-/);

    const revealed = await revealMotherGenesis(result.strand.readerKey);
    assert.equal(revealed.ok, true);
    assert.equal(revealed.body, body);
  });

  it("writes full location list on-chain after chunk txs (unsquashed)", async () => {
    const body = "loclist-code\n".repeat(80);
    const prepared = preparePlainMotherGenesis(body, { chunkChars: 100 });
    assert.ok(prepared.totalChunks > 5);

    let n = 0;
    const result = await runMotherGenesisInscribe(prepared, async () => {
      n += 1;
      return "0x" + String(n).padStart(64, "c").slice(0, 64);
    });
    assert.equal(result.ok, true);
    assert.equal(result.locListOnChain, true);
    assert.ok(result.locListTxs.length >= 1);
    assert.equal(result.strand.locations.length, prepared.totalChunks);
    assert.ok(result.strand.locListTxs.length >= 1);
    // loc-list txs are extra — not mixed into chunk locations
    for (const tx of result.strand.locListTxs) {
      assert.equal(result.strand.locations.includes(tx), false);
    }

    const rebuilt = reconstructLocationsFromLocListPages(result.strand.locListPages);
    assert.deepEqual(rebuilt, result.strand.locations);

    const receipt = formatMotherGenesisReceipt(result);
    assert.match(receipt, /on-chain loc list/);
    assert.match(receipt, /MGLOCS/);
  });

  it("pages a long location list without truncating hashes", () => {
    const locations = [];
    for (let i = 1; i <= 30; i++) {
      locations.push("0x" + String(i).padStart(64, "d").slice(0, 64));
    }
    const pages = buildMotherGenesisLocListPages({
      strandId: "MG-P-TEST",
      mode: "plain",
      locations,
      contentCommit: "abc",
      chunkChars: 200,
    });
    assert.equal(pages.ok, true);
    assert.ok(pages.pageCount > 1);
    const rebuilt = reconstructLocationsFromLocListPages(pages.pages);
    assert.equal(rebuilt.length, 30);
    assert.deepEqual(rebuilt, locations.map((h) => h.toLowerCase()));
    for (const page of pages.pages) {
      const parsed = parseMotherGenesisLocListLine(page.line);
      assert.equal(parsed.kind, "loclist");
      assert.ok(parsed.locations.length >= 1);
    }
  });
});

describe("mother-genesis encoded + reveal", () => {
  beforeEach(() => resetMotherGenesisRegistry());

  it("builds loc commitment and reveals with two-part key", async () => {
    const body = "secret payload " + "Z".repeat(900);
    const prepared = prepareEncodedMotherGenesis(body, { chunkChars: 120 });
    assert.ok(prepared.totalChunks > 5);
    assert.ok(prepared.keys.part1.startsWith("MG1."));
    assert.ok(prepared.keys.part2.startsWith("MG2."));

    let n = 0;
    const result = await runMotherGenesisInscribe(prepared, async () => {
      n += 1;
      return "0x" + String(n).padStart(64, "b").slice(0, 64);
    });
    assert.equal(result.ok, true);
    assert.equal(result.strand.proof.scheme, "mg-loc-commitment-v1");
    assert.equal(verifyLocZeroProof(result.strand.proof, result.strand.locations).ok, true);

    const bad = parseRevealKey(result.strand.keys.part1);
    assert.equal(bad.ok, false);

    const revealed = await revealMotherGenesis(result.strand.keys.combined);
    assert.equal(revealed.ok, true);
    assert.equal(revealed.body, body);
    assert.match(formatMotherGenesisReceipt(result), /two-part key/);
  });

  it("local bank reveal works from fullLine without inventing hashes", async () => {
    const body = "banked-only";
    const prepared = prepareEncodedMotherGenesis(body);
    const result = await runMotherGenesisInscribe(prepared, async () => null);
    assert.equal(result.banked, true);
    attachFullLines(prepared.strandId, prepared.lines);
    // keys still provisional — secret matches
    const revealed = await revealMotherGenesis(prepared.keys.combined);
    assert.equal(revealed.ok, true);
    assert.equal(revealed.body, body);
  });

  it("seal refuses mismatched hash counts", async () => {
    const prepared = preparePlainMotherGenesis("abc");
    await runMotherGenesisInscribe(prepared, async () => null);
    const bad = sealMotherGenesisLocations(prepared.strandId, [
      "0x" + "1".repeat(64),
      "0x" + "2".repeat(64),
    ]);
    assert.equal(bad.ok, false);
  });
});
