/**
 * x404 directory tags — same display name, many plots. Never invent hashes.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MAINFRAME_ANCHORS } from "./mainframe.js";
import {
  X404_ID,
  X404_LABEL,
  X404_MAGIC,
  X404_STYLE,
  attachProvenLoc,
  formatX404Card,
  formatX404PathMapCard,
  isKnownSealedHash,
  isTxHash,
  listX404DirEntries,
  listX404Tags,
  loadX404Schema,
  lookupX404Tag,
  provenX404Locs,
  searchX404,
  waitingMasterTagPlots,
} from "./x404-dir.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

describe("x404 directory schema", () => {
  it("loads schema with same-name many plots", () => {
    const schema = loadX404Schema();
    assert.equal(schema.id, "x404-dir-v1");
    assert.equal(schema.label, X404_LABEL);
    assert.equal(schema.magic, X404_MAGIC);
    assert.equal(schema.style, X404_STYLE);
    assert.equal(schema.neverInventHashes, true);
    const names = schema.tags.map((t) => t.name);
    assert.ok(names.includes("storage-token"));
    assert.ok(names.includes("calculator"));
    const st = lookupX404Tag("storage-token", schema);
    assert.equal(st.ok, true);
    assert.ok(st.plotCount >= 2, "storage-token has many plots");
    assert.equal(st.sameNameManyPlots, true);
    assert.ok(st.plots.every((p) => p.displayName === "storage-token"));
    const nets = new Set(st.plots.map((p) => p.net));
    assert.ok(nets.size >= 2, "plots live on different nets");
  });

  it("proven locs are only hardcoded anchors — never invented", () => {
    for (const loc of provenX404Locs()) {
      assert.equal(isTxHash(loc.location), true);
      assert.equal(isKnownSealedHash(loc.location), true);
      assert.ok(
        MAINFRAME_ANCHORS.known.some((a) => a.tx.toLowerCase() === loc.location),
      );
      assert.match(loc.basescan, /basescan\.org\/tx\//);
      assert.match(loc.idmChat, /Input Data/);
    }
  });

  it("refuses invented hashes on attach", () => {
    const fake = "0x" + "a".repeat(64);
    assert.equal(isKnownSealedHash(fake), false);
    const miss = attachProvenLoc({
      plotId: "storage-token:telegram-agents-chat",
      hash: fake,
    });
    assert.equal(miss.ok, false);
    assert.match(miss.reason, /refuse|invent/i);

    const garbage = attachProvenLoc({
      plotId: "storage-token:telegram-agents-chat",
      hash: "not-a-hash",
    });
    assert.equal(garbage.ok, false);

    const real = MAINFRAME_ANCHORS.eurekaProveTx;
    const ok = attachProvenLoc({
      plotId: "storage-token:telegram-agents-chat",
      hash: real,
    });
    assert.equal(ok.ok, true);
    assert.equal(ok.plot.sealedBaseLoc, real.toLowerCase());
    assert.equal(ok.waitingMasterTag, true, "lands in directory waiting master-location tag");
  });

  it("search finds answer-key routes across nets", () => {
    const telegram = searchX404("/home agents");
    assert.equal(telegram.ok, true);
    assert.ok(telegram.count >= 1);
    const calc = searchX404("calculator");
    assert.ok(calc.hits.some((h) => h.name === "calculator"));
    const filing = searchX404("vita/agent-chat.js");
    assert.ok(filing.hits.some((h) => h.plotId.includes("filing")));
  });

  it("cards + kids dir entries never invent hashes", () => {
    const card = formatX404Card("storage-token");
    assert.match(card, /§X404§/);
    assert.match(card, /storage-token/);
    assert.match(card, /waiting master-location tag|sealed/);
    const map = formatX404PathMapCard();
    assert.match(map, /PATH MAP/);
    assert.match(map, /\/home/);
    const kids = listX404DirEntries();
    assert.ok(kids.some((e) => e.unlockName === "storage-token"));
    const waiting = waitingMasterTagPlots();
    assert.ok(waiting.length >= 1);
    const listed = listX404Tags();
    assert.ok(listed.some((t) => t.name === "vita"));
  });

  it("X404_ID constant matches reader", () => {
    assert.equal(X404_ID, "vita-x404-dir-v1");
    assert.ok(existsSync(join(HERE, "x404-dir.json")));
    const raw = JSON.parse(readFileSync(join(HERE, "x404-dir.json"), "utf8"));
    for (const tag of raw.tags) {
      for (const plot of tag.plots) {
        if (plot.sealedBaseLoc) {
          assert.match(plot.sealedBaseLoc, /^0x[0-9a-fA-F]{64}$/);
          assert.ok(
            MAINFRAME_ANCHORS.known.some(
              (a) => a.tx.toLowerCase() === plot.sealedBaseLoc.toLowerCase(),
            ),
            "schema sealed loc must be a hardcoded anchor: " + plot.plotId,
          );
        }
      }
    }
    const filing = readFileSync(join(ROOT, "vita/FILING.md"), "utf8");
    void filing;
  });
});
