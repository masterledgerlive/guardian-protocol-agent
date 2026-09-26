import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  HAT_MAGIC,
  DEFAULT_SITE_PATHS,
  HITCH_BUDGETS,
  bytesToBits,
  bitsToBytes,
  encodeBitSlice,
  decodeBitSlice,
  encodeHatPacket,
  parseHatPacket,
  buildCanonicalSiteBlob,
  contentSha256,
  planPreservationMessages,
  bootstrapHatPreservation,
  mintOneBitTest,
  mintShortAndLongBesideMessage,
  mintNextChunk,
  tryDeleteHatNode,
  getHatRegistry,
  setHatRegistry,
  buildReaderManifest,
  reconstructFromHatNodes,
  sealHatNodeLocation,
  railwayHatInsertEnv,
  loadHatFromRailwayEnv,
  serializeHatRegistry,
} from "./vita-hat.js";

describe("vita-hat encode / decode", () => {
  it("round-trips bits through bytes without plaintext HTML", () => {
    const raw = Buffer.from("<html>Guardian Arena</html>", "utf8");
    const bits = bytesToBits(raw);
    const back = bitsToBytes(bits);
    assert.deepEqual(back, raw);
  });

  it("encodes a one-bit slice as hex bitpack (not plain text)", () => {
    const bits = [1, 0, 1, 1];
    const enc = encodeBitSlice(bits, 0, 1);
    assert.equal(enc.encoding, "hat-bitpack-v1");
    assert.equal(enc.bitCount, 1);
    assert.ok(/^[0-9a-f]+$/i.test(enc.hex));
    assert.equal(enc.hex.includes("<html"), false);
    const decoded = decodeBitSlice(enc);
    assert.deepEqual(decoded, [1]);
  });

  it("parses HAT packets with magic and base64url meta", () => {
    const enc = encodeBitSlice([0], 0, 1);
    const packet = encodeHatPacket({
      kind: "BIT",
      seq: 0,
      prevHash: "00000000",
      encoded: enc,
      meta: { role: "genesis-one-bit" },
    });
    assert.ok(packet.startsWith(HAT_MAGIC));
    assert.equal(packet.includes("<html"), false);
    const parsed = parseHatPacket(packet);
    assert.equal(parsed.kind, "BIT");
    assert.equal(parsed.seq, 0);
    assert.equal(parsed.meta.role, "genesis-one-bit");
  });
});

describe("vita-hat append-only 1-bit + ST/LT", () => {
  beforeEach(() => {
    setHatRegistry({ strandId: null, contentHash: null, lastHash: "00000000", nodes: [] });
  });

  it("mints genesis one-bit first and refuses delete", () => {
    const files = [{ path: "public/t.html", bytes: Buffer.from("AB") }];
    const blob = buildCanonicalSiteBlob(files);
    const bits = bytesToBits(blob);
    const hash = contentSha256(blob);
    const node = mintOneBitTest({ bits, contentHash: hash, files });
    assert.equal(node.kind, "BIT");
    assert.equal(node.seq, 0);
    assert.equal(node.meta.bitCount, 1);
    assert.equal(tryDeleteHatNode().ok, false);
    assert.equal(getHatRegistry().neverDelete, true);
    assert.equal(getHatRegistry().nodes.length, 1);
  });

  it("writes ST + LT beside the message after genesis", () => {
    const files = [{ path: "a.html", bytes: Buffer.from("xy") }];
    const blob = buildCanonicalSiteBlob(files);
    const bits = bytesToBits(blob);
    const hash = contentSha256(blob);
    mintOneBitTest({ bits, contentHash: hash, files });
    const { st, lt, plan } = mintShortAndLongBesideMessage({ bits, contentHash: hash });
    assert.equal(st.kind, "ST");
    assert.equal(lt.kind, "LT");
    assert.ok(plan.minMessages >= 1);
    assert.equal(getHatRegistry().nodes.length, 3);
    // linear hashes
    const nodes = getHatRegistry().nodes;
    assert.equal(nodes[1].prevHash, nodes[0].hash);
    assert.equal(nodes[2].prevHash, nodes[1].hash);
  });

  it("chunks remaining bits linearly until done", () => {
    const files = [{ path: "a.html", bytes: Buffer.from("Hi") }];
    const blob = buildCanonicalSiteBlob(files);
    const bits = bytesToBits(blob);
    mintOneBitTest({ bits, contentHash: contentSha256(blob), files });
    let guard = 0;
    let done = false;
    while (!done && guard++ < 1000) {
      const r = mintNextChunk({ bits, maxBits: 8 });
      done = r.done;
    }
    assert.equal(done, true);
    const recon = reconstructFromHatNodes();
    assert.equal(recon.bitsCollected, bits.length);
  });
});

describe("vita-hat site preservation plan (live public HTML)", () => {
  beforeEach(() => {
    setHatRegistry({ strandId: null, contentHash: null, lastHash: "00000000", nodes: [] });
  });

  it("bootstraps arena+engine with 1-bit proof and message horizons", () => {
    const boot = bootstrapHatPreservation({
      paths: DEFAULT_SITE_PATHS,
      hitchBudgetBytes: HITCH_BUDGETS.letter,
    });
    assert.equal(boot.files.length, 4);
    assert.ok(boot.totalBytes > 80_000);
    assert.equal(boot.totalBits, boot.totalBytes * 8);
    assert.equal(boot.genesis.kind, "BIT");
    assert.equal(boot.genesis.meta.bitCount, 1);
    assert.ok(boot.genesis.packet.startsWith(HAT_MAGIC));
    assert.equal(boot.genesis.packet.toLowerCase().includes("<!doctype"), false);
    assert.equal(boot.shortTerm.kind, "ST");
    assert.equal(boot.longTerm.kind, "LT");
    assert.ok(boot.plan.minMessages > 100);
    assert.ok(boot.railwayInsert.HAT_STRAND_ID);
    assert.ok(boot.railwayInsert.HAT_CONTENT_HASH);
    assert.equal(boot.reader.nodeCount, 3);
    assert.ok(boot.reader.locations.every((l) => l.howToRead && l.encoding));
    assert.equal(boot.reader.locations[0].kind, "BIT");
  });

  it("planPreservationMessages scales with hitch budget", () => {
    const bits = 423848;
    const letter = planPreservationMessages({
      totalBits: bits,
      hitchBudgetBytes: HITCH_BUDGETS.letter,
    });
    const frag = planPreservationMessages({
      totalBits: bits,
      hitchBudgetBytes: HITCH_BUDGETS.fragment,
    });
    assert.ok(letter.minMessages > frag.minMessages);
    assert.equal(letter.genesisOneBitMessages, 1);
    assert.equal(frag.budgets.fragment.minMessages, frag.minMessages);
  });

  it("reader manifest + Railway env seal", () => {
    const boot = bootstrapHatPreservation();
    const env = railwayHatInsertEnv();
    assert.equal(env.HAT_CONTENT_HASH, boot.contentHash);
    const sealed = sealHatNodeLocation(boot.genesis.nodeId, "0xabc123");
    assert.equal(sealed.ok, true);
    assert.equal(railwayHatInsertEnv().HAT_ROOT_TX, "0xabc123");
    const loaded = loadHatFromRailwayEnv({
      HAT_ROOT_TX: "0xabc123",
      HAT_CONTENT_HASH: boot.contentHash,
      HAT_STRAND_ID: boot.railwayInsert.HAT_STRAND_ID,
    });
    assert.equal(loaded.ready, true);
    const man = buildReaderManifest();
    assert.equal(man.locations[0].location, "0xabc123");
    assert.equal(man.locations[0].locationType, "base-tx");
  });

  it("serialize registry preserves linear chain", () => {
    bootstrapHatPreservation();
    const snap = serializeHatRegistry();
    assert.equal(snap.nodes.length, 3);
    setHatRegistry({ strandId: null, contentHash: null, lastHash: "00000000", nodes: [] });
    setHatRegistry(snap);
    assert.equal(getHatRegistry().nodes.length, 3);
    assert.equal(getHatRegistry().lastHash, snap.lastHash);
  });
});
