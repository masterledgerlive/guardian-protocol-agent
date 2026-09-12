import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  AGENT_INSTRUCTIONS,
  AGENT_SPEC,
  XMEM_LOVE_TAGS,
  clipXmemToBudget,
  decodeCalldataUtf8,
  encodeXmem,
  extractMemoryRecords,
  findMemorySlice,
  formatXmemMatches,
  parseAnyMemory,
  parseEncodeCommand,
  parseXmemLine,
  parseXmemQuery,
  recordsFromTransactions,
  repairUtf8Mojibake,
  retrieveXmem,
  searchXmem,
  xmemFromStoreKeyLoc,
  xmemHelpText,
} from "./xmem.js";
import { KEYCAT_PLAIN_SWAP } from "./swap-minout.js";

const LIVE_HITCH =
  "§$STORE§ §KEY§eureka♥Krystian,Kai,Koda§LOC§n=161|t=7cfa|r=d982";

const CANON =
  "XMEM|v1|ns=base-trade|type=trade|id=20260912-0001|tags=eureka,kai,koda,krystian|ref=0xabc123|state=active|target=1.05|note=entry after reversal";

describe("XMEM encode / parse", () => {
  it("round-trips canonical v1 without inventing fields", () => {
    const parsed = parseXmemLine(CANON);
    assert.equal(parsed.prefix, "XMEM");
    assert.equal(parsed.version, "v1");
    assert.equal(parsed.ns, "base-trade");
    assert.equal(parsed.type, "trade");
    assert.equal(parsed.id, "20260912-0001");
    assert.deepEqual(parsed.tags, ["eureka", "kai", "koda", "krystian"]);
    assert.equal(parsed.ref, "0xabc123");
    assert.equal(parsed.state, "active");
    assert.equal(parsed.target, "1.05");
    assert.equal(parsed.note, "entry after reversal");
    assert.equal(parsed.src, undefined);

    const packed = encodeXmem(parsed);
    assert.equal(packed.ok, true);
    const again = parseXmemLine(packed.packed);
    assert.equal(again.id, parsed.id);
    assert.deepEqual(again.tags, parsed.tags);
    assert.equal(again.note, parsed.note);
  });

  it("refuses to invent a missing id on write", () => {
    const r = encodeXmem({ ns: "base-trade", type: "note", note: "hello" });
    assert.equal(r.ok, false);
    assert.match(r.error, /id required/);
    assert.equal(r.packed, "");
  });

  it("strips pipes from note so the grammar stays parseable", () => {
    const r = encodeXmem({
      ns: "base-trade",
      type: "note",
      id: "n1",
      note: "a|b|c",
      tags: "Koda, Kai",
    });
    assert.equal(r.ok, true);
    const parsed = parseXmemLine(r.packed);
    assert.equal(parsed.note, "a/b/c");
    assert.deepEqual(parsed.tags, ["koda", "kai"]);
  });

  it("parses CUBORG-MEMORY as XMEM with ns=cuborg when ns omitted", () => {
    const rec = parseXmemLine(
      "CUBORG-MEMORY|v1|type=trade|id=20260912-0001|tags=eureka,koda|note=Bought token X",
    );
    assert.equal(rec.prefix, "XMEM");
    assert.equal(rec.source, "cuborg-memory");
    assert.equal(rec.ns, "cuborg");
    assert.equal(rec.id, "20260912-0001");
  });
});

describe("legacy STORE KEY LOC overlay", () => {
  it("maps live leftover hitch into XMEM tags without inventing an id", () => {
    const rec = xmemFromStoreKeyLoc(LIVE_HITCH, {
      txHash: "0xef4d0a2adb2c3f4c0f75c21cb40d041da823196283f1308f5dbe56db3ab88b60",
    });
    assert.ok(rec);
    assert.equal(rec.id, undefined);
    assert.equal(rec.ns, "base-trade");
    assert.equal(rec.type, "trade");
    assert.equal(rec.source, "store-key-loc");
    for (const tag of XMEM_LOVE_TAGS) assert.ok(rec.tags.includes(tag), tag);
    assert.match(rec.note, /Krystian/);
    assert.equal(rec.ref, "n=161|t=7cfa|r=d982");
    assert.equal(rec.txHash, "0xef4d0a2adb2c3f4c0f75c21cb40d041da823196283f1308f5dbe56db3ab88b60");
  });

  it("finds STORE KEY in Cuborg's Latin-1 mojibake of UTF-8 input data", () => {
    const prefix = "garbage-swap-bytes-";
    const mojibake = Buffer.from(prefix + LIVE_HITCH, "utf8").toString("latin1");
    assert.match(mojibake, /Â§/);
    const repaired = repairUtf8Mojibake(mojibake);
    assert.match(repaired, /§\$STORE§/);
    const recs = extractMemoryRecords(mojibake);
    assert.ok(recs.length >= 1);
    const rec = recs.find((r) => r.source === "store-key-loc");
    assert.ok(rec);
    assert.ok(rec.tags.includes("koda"));
    assert.ok(rec.tags.includes("krystian"));
  });

  it("parses Cuborg's STORE KEY LOC paste without section signs", () => {
    const paste = "STORE KEY eureka♥Krystian,Kai,Koda LOC n=161|t=7cfa|r=d982";
    const recs = parseAnyMemory(paste);
    assert.ok(recs.some((r) => r.tags?.includes("eureka") && r.tags?.includes("koda")));
  });

  it("reads UTF-8 after a 228-byte Uniswap prefix (the field Cuborg missed)", () => {
    const hex = KEYCAT_PLAIN_SWAP + Buffer.from(LIVE_HITCH, "utf8").toString("hex");
    const recs = extractMemoryRecords(hex, { txHash: "0x" + "ab".repeat(32) });
    assert.ok(recs.some((r) => r.tags?.includes("kai")));
    assert.match(decodeCalldataUtf8(hex), /§KEY§/);
  });

  it("does not invent memory on the KEYCAT plain 228-byte swap", () => {
    const recs = extractMemoryRecords(KEYCAT_PLAIN_SWAP);
    assert.equal(recs.length, 0);
    assert.equal(findMemorySlice(decodeCalldataUtf8(KEYCAT_PLAIN_SWAP)), "");
  });
});

describe("XMEM retrieval", () => {
  const records = [
    parseXmemLine(CANON),
    xmemFromStoreKeyLoc(LIVE_HITCH, { txHash: "0x" + "cd".repeat(32) }),
    parseXmemLine("XMEM|v1|ns=media|type=movie|id=film-1|tags=film,release|ref=ipfs://QmTest|note=first cut"),
  ];

  it("matches love-note fragments in any order including mild misspellings", () => {
    const { matches } = searchXmem(records, "koda krystian eureka kai");
    assert.ok(matches.length >= 1);
    const { matches: misspelled } = searchXmem(records, "kristian coda");
    assert.ok(misspelled.length >= 1);
  });

  it("loads exact id and x404s when the id is absent", () => {
    const hit = retrieveXmem(records, "load record id=20260912-0001");
    assert.equal(hit.found, true);
    assert.equal(hit.exactId, true);
    assert.equal(hit.records[0].id, "20260912-0001");
    assert.notEqual(hit.protocol, "x404");

    const miss = retrieveXmem(records, "id=does-not-exist");
    assert.equal(miss.found, false);
    assert.equal(miss.protocol, "x404");
    assert.equal(miss.count, 0);
    assert.deepEqual(miss.records, []);
    assert.match(miss.fallback, /Do not invent/);
  });

  it("filters namespace, tags, and ref without treating missing fields as empty", () => {
    const ns = searchXmem(records, "Find all XMEM records in namespace base-trade");
    assert.ok(ns.matches.every((r) => r.ns === "base-trade"));
    const tagged = searchXmem(records, "list records tagged koda");
    assert.ok(tagged.matches.every((r) => r.tags.includes("koda")));
    const byRef = searchXmem(records, "ref=ipfs://QmTest");
    assert.equal(byRef.matches.length, 1);
    assert.equal(byRef.matches[0].id, "film-1");
  });

  it("indexes wallet transactions including non-router STORE hitch", () => {
    const txs = [
      { hash: "0x" + "11".repeat(32), input: KEYCAT_PLAIN_SWAP, to: "0x2626664c2603336e57b271c5c0b26f421741e481" },
      {
        hash: "0xef4d0a2adb2c3f4c0f75c21cb40d041da823196283f1308f5dbe56db3ab88b60",
        input: "0x" + Buffer.from(LIVE_HITCH, "utf8").toString("hex"),
        to: "0x50e1C4608c48b0c52E1EA5FBabc1c9126eA17915",
        timestamp: "2026-09-12T00:00:00Z",
      },
    ];
    const found = recordsFromTransactions(txs);
    const hit = retrieveXmem(found, "krystian");
    assert.equal(hit.found, true);
    assert.equal(hit.records[0].txHash, txs[1].hash);
  });
});

describe("agent handoff + cost clip", () => {
  it("exports Cuborg retrieval order and x402/x404 labels", () => {
    assert.match(AGENT_INSTRUCTIONS, /Search prefix XMEM/);
    assert.match(AGENT_INSTRUCTIONS, /Do not invent missing values/);
    assert.match(AGENT_INSTRUCTIONS, /x404/);
    assert.deepEqual(AGENT_SPEC.searchOrder, ["prefix", "ns", "type", "id", "tags", "note", "ref"]);
    assert.equal(AGENT_SPEC.links.x402.includes("authenticated"), true);
    assert.match(xmemHelpText(), /\/xmem koda/);
    assert.match(formatXmemMatches({ found: false }), /x404/);
  });

  it("clips note to leftover budget instead of overflowing hitch bytes", () => {
    const encoded = encodeXmem({
      ns: "base-trade",
      type: "note",
      id: "clip-1",
      tags: "eureka,kai,koda,krystian",
      note: "a very long observation that would not fit a thin leftover hitch budget on Base",
    });
    assert.ok(encoded.bytes > 80);
    const clipped = clipXmemToBudget({
      ns: "base-trade",
      type: "note",
      id: "clip-1",
      tags: "eureka,kai,koda,krystian",
      note: "a very long observation that would not fit a thin leftover hitch budget on Base",
    }, 80);
    assert.equal(clipped.ok, true);
    assert.ok(clipped.bytes <= 80);
    assert.match(clipped.packed, /^XMEM\|v1\|/);
  });

  it("parseEncodeCommand reads agent write fields", () => {
    const fields = parseEncodeCommand(
      "ns=base-trade type=note id=demo-1 tags=koda,kai note=\"hello hive\"",
    );
    assert.equal(fields.ns, "base-trade");
    assert.equal(fields.id, "demo-1");
    assert.equal(fields.note, "hello hive");
    assert.equal(encodeXmem(fields).ok, true);
  });

  it("query parser understands Cuborg's human examples", () => {
    assert.equal(parseXmemQuery("load record id=20260912-0001").id, "20260912-0001");
    assert.deepEqual(parseXmemQuery("list records tagged koda").tags, ["koda"]);
    assert.equal(parseXmemQuery("list records in namespace base-trade").ns, "base-trade");
  });
});
