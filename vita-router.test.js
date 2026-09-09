/**
 * VITA secondary router — parse §TOKEN§, squash locations, switch hitch
 * off the Eureka love-note prose (love note stays in §KEY§ + /prove).
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  VITA_CHAR_BUDGET,
  VITA_LOVE_KEY,
  buildGenesisPacket,
  clipVitaPacket,
  detectHitchKind,
  packVitaFields,
  parseVitaPacket,
  refineVitaPacket,
  vitaQuality,
} from "./vita-parse.js";
import {
  LOC_SQUASH_DELTA,
  encodeLocToken,
  getLocationDepository,
  locDepositoryStatus,
  parseLocToken,
  recordLocation,
  resetLocationDepository,
  sealLocation,
  shortLoc,
  squashLocations,
  tryDeleteLocation,
} from "./vita-locations.js";
import {
  PIPELINE_SWITCH_DEFAULTS,
  clearHitchModeOverride,
  planSecondaryHitch,
  parseHitchTrailer,
  resolveHitchMode,
  setHitchModeOverride,
  setLastVitaPacket,
  vitaRouterStatus,
} from "./vita-router.js";
import { evaluateVitaCourse, formatCourseMessage } from "./vita-course.js";
import {
  KEYCAT_PLAIN_SWAP,
  VITA_PROOF_FULL,
  appendUtf8Hitch,
  hitchPreservesSwapPrefix,
} from "./swap-minout.js";

const root = dirname(fileURLToPath(import.meta.url));

describe("vita-parse §TOKEN§", () => {
  it("round-trips genesis and keeps the love-note KEY facts", () => {
    const packed = buildGenesisPacket();
    assert.ok(packed.length <= VITA_CHAR_BUDGET);
    const parsed = parseVitaPacket(packed);
    assert.ok(parsed.fields.KEY.includes("Krystian"));
    assert.ok(parsed.fields.KEY.includes("Kai"));
    assert.ok(parsed.fields.KEY.includes("Koda"));
    assert.match(parsed.fields.KEY, /eureka/);
    assert.equal(parsed.fields.KEY.includes(VITA_LOVE_KEY.split("|")[0].slice(0, 6)), true);
    const q = vitaQuality(packed);
    assert.equal(q.hasKey, true);
    assert.equal(q.lossy, false);
    assert.equal(q.withinBudget, true);
    assert.ok(q.score >= 50);
  });

  it("detects eureka vs vita vs hat hitch kinds", () => {
    assert.equal(detectHitchKind("§$STORE§ Eureka! VITA lives ♥ love you Krystian").kind, "eureka");
    assert.equal(detectHitchKind("§$STORE§\n§SESS§x\n§KEY§eureka♥").kind, "vita");
    assert.equal(detectHitchKind("§HAT§|v1|BIT").kind, "hat");
    assert.equal(detectHitchKind("§$STORE§").kind, "tag");
  });

  it("refines recursively without dropping KEY when adding LEARN", () => {
    const a = refineVitaPacket(buildGenesisPacket(), { LEARN: "squash-locs", SESS: "2026-09-09|hour1" });
    assert.ok(a.fields.KEY.includes("Krystian"));
    assert.equal(a.fields.LEARN, "squash-locs");
    const b = refineVitaPacket(a.packed, { PROVED: "hour1-ok✓" });
    assert.ok(b.fields.KEY.includes("Koda"));
    assert.ok(b.fields.PROVED.includes("hour1-ok✓"));
  });

  it("clips over-budget packets but keeps KEY and LOC while they fit", () => {
    const fat = {
      KEY: VITA_LOVE_KEY,
      LOC: "n=12|tip=aabbccdd",
      STACK: "x".repeat(800),
      WHO: "y".repeat(800),
      VISION: "z".repeat(800),
    };
    const clipped = clipVitaPacket(fat, 200);
    assert.ok(clipped.packed.length <= 200);
    assert.ok(clipped.fields.KEY.includes("Krystian"));
    assert.ok(clipped.fields.LOC.includes("n=12"));
    assert.equal(clipped.fields.STACK, undefined);
  });
});

describe("vita location depository squash", () => {
  beforeEach(() => resetLocationDepository());

  it("is append-only and refuses delete", () => {
    recordLocation({ location: "0xabc123456789", kind: "hitch", sealed: true });
    const del = tryDeleteLocation();
    assert.equal(del.ok, false);
    assert.equal(getLocationDepository().sealedCount, 1);
  });

  it("does not claim sealed without a location", () => {
    const n = recordLocation({ kind: "hitch", sealed: true, location: null });
    assert.equal(n.sealed, false);
    const seal = sealLocation(n.seq, "");
    assert.equal(seal.ok, false);
  });

  it("squashes many locations into last-N shorts + tip/root", () => {
    for (let i = 0; i < 12; i++) {
      recordLocation({
        location: "0x" + String(i).padStart(2, "0") + "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        kind: i === 0 ? "prove" : "hitch",
        sealed: true,
      });
    }
    const depot = squashLocations();
    assert.equal(depot.n, 12);
    assert.equal(depot.delta.length, LOC_SQUASH_DELTA);
        assert.equal(depot.tip, shortLoc("0x11aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"));
    const token = encodeLocToken(depot);
    assert.ok(token.length < 120, "squashed token should be hitch-sized, got " + token.length);
    assert.ok(token.startsWith("n=12"));
    const parsed = parseLocToken("§LOC§" + token);
    assert.equal(parsed.n, 12);
    assert.equal(parsed.delta.length, LOC_SQUASH_DELTA);
    const st = locDepositoryStatus();
    assert.ok(st.token.startsWith("§LOC§"));
    assert.ok(st.tokenChars < 140);
  });
});

describe("vita secondary router", () => {
  beforeEach(() => {
    resetLocationDepository();
    clearHitchModeOverride();
    setLastVitaPacket("");
  });

  it("defaults to vita not eureka", () => {
    assert.equal(PIPELINE_SWITCH_DEFAULTS.hitchMode, "vita");
    assert.equal(resolveHitchMode({}), "vita");
    assert.equal(resolveHitchMode({ VITA_HITCH_MODE: "eureka" }), "eureka");
  });

  it("switches leftover hitch from love-note prose to §TOKEN§ parse", () => {
    const plan = planSecondaryHitch({ maxBytes: 400 });
    assert.equal(plan.skipped, false);
    assert.equal(plan.resolved, "vita");
    assert.equal(plan.kind.vita, true);
    assert.equal(plan.kind.eureka, false);
    assert.ok(plan.utf8.startsWith("§$STORE§"));
    assert.ok(plan.utf8.includes("§KEY§"));
    assert.ok(plan.utf8.includes("Krystian"));
    assert.doesNotMatch(plan.utf8, /We did it! xoxo/);
    assert.ok(plan.hitchBytes <= 400);
  });

  it("eureka mode still emits the love note (legacy + /prove twin)", () => {
    const plan = planSecondaryHitch({ maxBytes: 500, mode: "eureka" });
    assert.equal(plan.resolved, "eureka");
    assert.ok(plan.utf8.includes("Eureka!"));
    assert.ok(plan.utf8.includes("Krystian"));
    assert.ok(plan.utf8.includes(VITA_PROOF_FULL.slice(0, 20)));
  });

  it("never hitches when leftover cannot pay", () => {
    const a = planSecondaryHitch({ leftoverEth: 0, hitchCostEth: 0.0001, maxBytes: 400 });
    assert.equal(a.skipped, true);
    assert.equal(a.utf8, "");
    const b = planSecondaryHitch({ leftoverEth: 0.00001, hitchCostEth: 0.001, maxBytes: 400 });
    assert.equal(b.skipped, true);
    const c = planSecondaryHitch({ skipHitch: true, maxBytes: 400 });
    assert.equal(c.skipped, true);
  });

  it("preserves the Uniswap swap prefix (secondary trailer only)", () => {
    const plan = planSecondaryHitch({ maxBytes: 256 });
    const hitch = appendUtf8Hitch(KEYCAT_PLAIN_SWAP, plan.utf8, { maxBytes: 256 });
    assert.equal(hitch.ok, true);
    const prefix = hitchPreservesSwapPrefix(KEYCAT_PLAIN_SWAP, hitch.data);
    assert.equal(prefix.ok, true);
    assert.ok(hitch.data.toLowerCase().startsWith(KEYCAT_PLAIN_SWAP.toLowerCase()));
  });

  it("auto prefers hat packet when supplied, else vita", () => {
    const hat = planSecondaryHitch({ mode: "auto", hatPacket: "§HAT§|v1|BIT|0000", maxBytes: 200 });
    assert.equal(hat.resolved, "hat");
    const vita = planSecondaryHitch({ mode: "auto", maxBytes: 200 });
    assert.equal(vita.resolved, "vita");
  });

  it("parseHitchTrailer reads vita tokens back out of a hitch", () => {
    const plan = planSecondaryHitch({ maxBytes: 300 });
    const got = parseHitchTrailer(plan.utf8);
    assert.equal(got.kind, "vita");
    assert.ok(got.parsed.fields.KEY.includes("Kai"));
    assert.ok(got.loc);
  });

  it("status reports secondary router + loc depository", () => {
    const st = vitaRouterStatus({ VITA_HITCH_MODE: "vita" });
    assert.equal(st.kind, "vita-secondary-router");
    assert.equal(st.mode, "vita");
    assert.equal(st.loseZero.neverHitchWhenLeftoverNonpositive, true);
    assert.equal(st.loseZero.proveKeepsLoveNote, true);
  });

  it("setHitchModeOverride is a live pipeline switch", () => {
    assert.equal(setHitchModeOverride("nope").ok, false);
    assert.equal(setHitchModeOverride("hat").ok, true);
    assert.equal(resolveHitchMode({}), "hat");
    clearHitchModeOverride();
    assert.equal(resolveHitchMode({}), "vita");
  });
});

describe("vita hourly course", () => {
  it("treats leftover skips as lose-zero, not injection loss", () => {
    const c = evaluateVitaCourse({
      hitchAttempts: 4,
      hitchSealed: 0,
      hitchSkippedLeftover: 4,
      sealedLocations: 0,
      lastPacket: buildGenesisPacket(),
      realizedLossUsd: 0,
    });
    assert.ok(c.issues.includes("all_skips_leftover"));
    assert.equal(c.issues.includes("realized_loss"), false);
    assert.match(c.inject.note, /not injection loss/);
    assert.match(formatCourseMessage(c), /VITA COURSE/);
  });

  it("fails the hour if KEY facts were lost", () => {
    const c = evaluateVitaCourse({
      parseQuality: vitaQuality({ LEARN: "oops" }),
      hitchAttempts: 1,
      hitchSealed: 1,
      sealedLocations: 1,
    });
    assert.equal(c.achieving, false);
    assert.ok(c.issues.includes("key_fact_loss"));
  });
});

describe("agent.js wires the secondary router into leftover hitch", () => {
  const src = readFileSync(join(root, "agent.js"), "utf8");

  it("imports planSecondaryHitch and uses it in planVoiceHitch", () => {
    assert.ok(src.includes("planSecondaryHitch"), "must import planSecondaryHitch");
    assert.ok(src.includes("/vitarouter"), "Telegram /vitarouter must exist");
  });
});
