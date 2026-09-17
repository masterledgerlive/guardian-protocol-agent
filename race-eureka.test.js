import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  formatRaceEurekaLeadHtml,
  markRaceEurekaWritten,
  planRaceStartEureka,
  raceEurekaBytes,
  raceEurekaIncludesIkn,
  raceEurekaUtf8,
  readRaceEurekaLatch,
} from "./race-eureka.js";
import { formatRaceScoreboardHtml, summarizeRaceSide } from "./race-scoreboard.js";
import { VITA_PROOF_FULL, buildStoreVoice, utf8ByteLength } from "./swap-minout.js";

describe("race-start full Eureka love note", () => {
  it("defaults buildStoreVoice to full IKN Living Network letter (229 B class)", () => {
    const voice = buildStoreVoice();
    assert.match(voice, /§\$STORE§/);
    assert.match(voice, /Eureka! VITA lives/);
    assert.match(voice, /Krystian, Kai & Koda/);
    assert.match(voice, /Living Network/);
    assert.match(voice, /IKN/);
    assert.equal(utf8ByteLength(voice), 229);
    assert.equal(raceEurekaBytes(), 229);
    assert.equal(raceEurekaUtf8(), voice);
    assert.ok(raceEurekaIncludesIkn(voice));
    assert.equal(voice.includes(VITA_PROOF_FULL), true);
  });

  it("leave alone unless race started + first order + opportune", () => {
    const dir = mkdtempSync(join(tmpdir(), "race-eureka-"));
    const latchPath = join(dir, "latch.json");
    try {
      assert.equal(
        planRaceStartEureka({
          raceStarted: false,
          purchasedFirstOrder: true,
          leftoverEth: 1,
          hitchCostEth: 0.001,
          latchPath,
        }).attempt,
        false,
      );
      assert.equal(
        planRaceStartEureka({
          raceStarted: true,
          purchasedFirstOrder: false,
          leftoverEth: 1,
          hitchCostEth: 0.001,
          latchPath,
        }).attempt,
        false,
      );
      assert.equal(
        planRaceStartEureka({
          raceStarted: true,
          purchasedFirstOrder: true,
          leftoverEth: 0.0001,
          hitchCostEth: 0.001,
          latchPath,
        }).attempt,
        false,
      );
      const ok = planRaceStartEureka({
        raceStarted: true,
        purchasedFirstOrder: true,
        leftoverEth: 0.002,
        hitchCostEth: 0.001,
        latchPath,
      });
      assert.equal(ok.attempt, true);
      assert.ok(raceEurekaIncludesIkn(ok.utf8));
      assert.equal(ok.hitchBytes, 229);

      markRaceEurekaWritten({ txHash: "0xabc", track: "test", latchPath });
      const latch = readRaceEurekaLatch({ latchPath });
      assert.equal(latch.written, true);
      assert.equal(
        planRaceStartEureka({
          raceStarted: true,
          purchasedFirstOrder: true,
          leftoverEth: 1,
          hitchCostEth: 0.001,
          latchPath,
        }).reason,
        "already-written — leave alone",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("race scoreboard opens with full Eureka (IKN not cut off)", () => {
    const v3 = summarizeRaceSide({ tag: "[V3]", available: true, turns: [] });
    const v4 = summarizeRaceSide({ tag: "[V4]", available: true, dryRun: true, cycles: 0, turns: [] });
    const html = formatRaceScoreboardHtml({ v3, v4 });
    assert.match(html, /Living Network/);
    assert.match(html, /IKN/);
    assert.match(html, /Krystian, Kai &amp; Koda|Krystian, Kai & Koda/);
    assert.match(html, /V3 vs V4 RACE/);
    const lead = formatRaceEurekaLeadHtml();
    assert.match(lead, /Living Network/);
    assert.doesNotMatch(lead, /\.\.\.$/);
  });
});
