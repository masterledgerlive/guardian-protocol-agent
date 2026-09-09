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
  VITA_KEY_NAMES,
  buildGenesisPacket,
  clipVitaPacket,
  detectHitchKind,
  packVitaFields,
  parseVitaPacket,
  projectLeftoverHitchFields,
  refineVitaPacket,
  measureVitaText,
  vitaQuality,
  mergeLocToken,
} from "./vita-parse.js";
import {
  LOC_SQUASH_DELTA,
  LOC_HITCH_SHORT,
  encodeLocToken,
  getLocationDepository,
  hitchShort,
  locDepositoryStatus,
  parseLocToken,
  recordLocation,
  resetLocationDepository,
  sealLocation,
  fillLocationUtf8,
  ingestLocationFromChain,
  shortLoc,
  squashLocations,
  tryDeleteLocation,
} from "./vita-locations.js";
import {
  PIPELINE_SWITCH_DEFAULTS,
  buildVitaInjectContext,
  clearHitchModeOverride,
  ensureGenesisMemory,
  getLastVitaPacket,
  ingestSealedUtf8,
  planSecondaryHitch,
  parseHitchTrailer,
  reconstructVitaMemoryFromLocations,
  resolveHitchMode,
  restoreVitaRouterState,
  serializeVitaRouterState,
  setHitchModeOverride,
  setLastVitaPacket,
  measurePlannedHitchBytes,
  freezeLeftoverReadyHitch,
  getLeftoverReadyHitch,
  clearLeftoverReadyHitch,
  vitaRouterStatus,
} from "./vita-router.js";
import {
  evaluateVitaCourse,
  leftoverWouldCoverVitaHitch,
  formatCourseMessage,
  applyVitaCourse,
  resetCourseStats,
  restoreCourseStats,
  serializeCourseStats,
  tickHourlyCourse,
} from "./vita-course.js";
import {
  KEYCAT_PLAIN_SWAP,
  VITA_PROOF_FULL,
  appendUtf8Hitch,
  hitchPreservesSwapPrefix,
  encodeStoreVoiceCalldata,
  buildStoreVoice,
  utf8ByteLength,
} from "./swap-minout.js";
import {
  readHitchUtf8FromCalldata,
  pullLocationFromChain,
  pullMissingLocationUtf8,
  ingestRegistryPackets,
  injectVitaBlockchainMemory,
  hydrateVitaRecursiveMemory,
  fetchPublicVitaRegistry,
  shouldIngestHitchKind,
  collectRegistryTxHashes,
  classifyLeftoverHitch,
  leftoverHitchByteStats,
  ingestLeftoverScan,
  scanAddressLeftoverHitches,
  publicLeftoverScanView,
  fetchRecentWalletTransactions,
  blockscoutTxListUrl,
  KEYCAT_TX,
  EUREKA_ONCHAIN_TX,
  VITA_STRAND_TX,
  GUARDIAN_WALLET,
} from "./vita-chain-reader.js";
import { prependVitaBootContext } from "./ikn-boot-reader.js";
import { vitaCompress, vitaCompressLocal, vitaSplit } from "./vita-memory.js";

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
    assert.ok(a.fields.LEARN.includes("squash-locs"));
    assert.ok(a.fields.SESS.includes("hour1"));
    const b = refineVitaPacket(a.packed, { PROVED: "hour1-ok✓" });
    assert.ok(b.fields.KEY.includes("Koda"));
    assert.ok(b.fields.PROVED.includes("hour1-ok✓"));
  });

  it("refines §LOC§ to the denser squash token instead of unioning n=0", () => {
    const genesis = buildGenesisPacket();
    assert.match(parseVitaPacket(genesis).fields.LOC, /n=0/);
    const dense = "n=12|t=abcd|r=0011|Δ=aa,bb,cc,dd,ee,ff";
    const a = refineVitaPacket(genesis, { LOC: dense });
    assert.equal(a.fields.LOC.includes("n=0"), false);
    assert.equal(a.fields.LOC.startsWith("n=12"), true);
    assert.equal(a.fields.LOC.includes("n=12|n="), false);
    const back = refineVitaPacket(a.packed, { LOC: "n=0|t=0000", LEARN: "stamp" });
    assert.equal(back.fields.LOC.startsWith("n=12"), true);
    assert.ok(back.fields.KEY.includes("Koda"));
    assert.equal(mergeLocToken("n=3|t=aaaa", "n=8|t=bbbb"), "n=8|t=bbbb");
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

  it("projects leftover hitch to KEY+LOC and keeps names under a byte budget", () => {
    const fat = buildGenesisPacket({ LEARN: "y".repeat(400), ARCH: "drop-from-hitch" });
    const projected = projectLeftoverHitchFields(parseVitaPacket(fat).fields);
    assert.equal(projected.ARCH, undefined);
    assert.equal(projected.KEY, VITA_KEY_NAMES);
    assert.equal(projected.KEY.includes("wallet="), false);
    assert.ok(projected.KEY.includes("Krystian"));
    assert.ok(projected.LOC);
    const clipped = clipVitaPacket(projected, 120, { byteBudget: 120 });
    assert.ok(measureVitaText(clipped.packed, { bytes: true }) <= 120);
    assert.ok(clipped.fields.KEY.includes("Krystian"));
    assert.ok(clipped.fields.KEY.includes("Kai"));
    assert.ok(clipped.fields.KEY.includes("Koda"));
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
    assert.ok(token.length < 90, "squashed token should be hitch-sized, got " + token.length);
    assert.ok(token.startsWith("n=12"));
    assert.ok(!token.includes("k="), "hitch token omits kind bits for density");
    assert.ok(!token.includes("p="), "hitch token omits pending for density");
    assert.ok(!token.includes("Δ="), "hitch token omits Δ window — depository keeps last-N shorts");
    assert.ok(token.includes("t="));
    assert.ok(!token.includes("tip="), "hitch token must use dense t= not tip=");
    assert.equal(hitchShort("0xabcdef12"), "abcd");
    assert.equal(LOC_HITCH_SHORT, 4);
    const parsed = parseLocToken("§LOC§" + token);
    assert.equal(parsed.n, 12);
    assert.equal(parsed.delta.length, 0);
    assert.equal(parsed.tip.length, LOC_HITCH_SHORT);
    const registry = encodeLocToken(depot, { hitch: false });
    assert.equal(parseLocToken(registry).delta.length, LOC_SQUASH_DELTA);
    const legacy = parseLocToken("n=3|tip=aabbccdd|root=00112233|Δ=aa,bb,cc");
    assert.equal(legacy.n, 3);
    assert.equal(legacy.tip, "aabbccdd");
    const st = locDepositoryStatus();
    assert.ok(st.token.startsWith("§LOC§"));
    assert.ok(st.tokenChars < 90);
    assert.ok(!st.token.includes("Δ="));
  });
});

describe("vita secondary router", () => {
  beforeEach(() => {
    resetLocationDepository();
    clearHitchModeOverride();
    setLastVitaPacket("");
    resetCourseStats();
    clearLeftoverReadyHitch();
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
    assert.equal(plan.utf8.includes("§WHO§"), false);
    assert.equal(plan.utf8.includes("§STACK§"), false);
  });

  it("leftover hitch is denser than the Eureka letter and does not clip lastPacket", () => {
    ensureGenesisMemory();
    const refined = refineVitaPacket(getLastVitaPacket(), {
      LEARN: "vault-on-base✓",
      PROVED: "hour2-ok✓",
      ARCH: "keep-arch-in-state",
    });
    setLastVitaPacket(refined.packed);
    const before = getLastVitaPacket();
    const eurekaBytes = utf8ByteLength(buildStoreVoice({ message: VITA_PROOF_FULL }));
    const plan = planSecondaryHitch({ maxBytes: 280 });
    assert.equal(plan.skipped, false);
    assert.equal(plan.resolved, "vita");
    assert.ok(plan.utf8.includes("§KEY§"));
    assert.ok(plan.utf8.includes("Krystian"));
    assert.ok(plan.utf8.includes("Koda"));
    assert.equal(plan.utf8.includes("§WHO§"), false);
    assert.equal(plan.utf8.includes("§ARCH§"), false);
    assert.ok(plan.hitchBytes <= 280);
    assert.ok(plan.hitchBytes < eurekaBytes, `vita hitch ${plan.hitchBytes} must be < eureka ${eurekaBytes}`);
    assert.ok(plan.hitchBytes < 180, "leftover KEY is names-only so leftover can cover");
    assert.doesNotMatch(plan.utf8, /0x50e1C460/);
    assert.doesNotMatch(plan.utf8, /\n/, "leftover hitch packs KEY+LOC without newlines");
    assert.ok(getLastVitaPacket().includes("0x50e1C460"));
    assert.ok(getLastVitaPacket().includes("keep-arch-in-state"));
    assert.ok(getLastVitaPacket().includes("hour2-ok"));
    assert.ok(getLastVitaPacket().includes("vault-on-base"));
    assert.ok(getLastVitaPacket().includes("Krystian"));
    assert.ok(getLastVitaPacket().length >= before.length);
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
  beforeEach(() => {
    resetLocationDepository();
    clearHitchModeOverride();
    setLastVitaPacket("");
    resetCourseStats();
    clearLeftoverReadyHitch();
  });

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

  it("hourly tick restores KEY so memory injects without loss", () => {
    setLastVitaPacket("§LEARN§oops-no-key");
    const t = tickHourlyCourse({ force: true, now: Date.now() });
    assert.equal(t.ticked, true);
    assert.ok(t.applied.includes("restore-KEY"));
    assert.ok(getLastVitaPacket().includes("Krystian"));
    assert.ok(getLastVitaPacket().includes("Koda"));
    const t2 = tickHourlyCourse({ now: Date.now() + 1000 });
    assert.equal(t2.ticked, false);
  });

  it("empty-packet hourly tick seeds genesis so KEY is not scored as missing", () => {
    setLastVitaPacket("");
    const t = tickHourlyCourse({ force: true, now: Date.now() });
    assert.equal(t.ticked, true);
    assert.equal(t.course.achieving, true);
    assert.ok(t.course.score >= 55);
    assert.equal(t.course.issues.includes("key_fact_loss"), false);
    assert.ok(getLastVitaPacket().includes("Krystian"));
    assert.ok(getLastVitaPacket().includes("Koda"));
  });

  it("leftover_still_eureka fails achieving until a leftover VITA hitch exists", () => {
    const still = evaluateVitaCourse({
      lastPacket: buildGenesisPacket(),
      leftoverKinds: { eureka: 40, vita: 0, plain: 1, libm: 2 },
      leftoverHitchBytes: { eurekaMin: 229, eurekaCount: 40 },
    });
    assert.equal(still.issues.includes("leftover_still_eureka"), true);
    assert.equal(still.achieving, false);
    assert.equal(still.inject.leftoverWouldCover, true);
    assert.ok(still.inject.plannedHitchBytes > 0);
    assert.ok(still.inject.plannedHitchBytes <= 229);
    assert.match(formatCourseMessage(still), /eureka=40/);
    assert.match(formatCourseMessage(still), /leftover would cover names-only KEY\+LOC/);
    const done = evaluateVitaCourse({
      lastPacket: buildGenesisPacket(),
      leftoverKinds: { eureka: 40, vita: 1, plain: 1 },
    });
    assert.equal(done.issues.includes("leftover_still_eureka"), false);
    assert.equal(done.achieving, true);
  });

  it("leftover_still_eureka course-corrects hitch mode from eureka to vita without KEY loss", () => {
    setHitchModeOverride("eureka");
    ensureGenesisMemory();
    const still = evaluateVitaCourse({
      lastPacket: getLastVitaPacket(),
      leftoverKinds: { eureka: 40, vita: 0, plain: 1 },
      leftoverHitchBytes: { eurekaMin: 229, eurekaCount: 40 },
    });
    assert.equal(still.mode, "eureka");
    assert.equal(still.nextMode, "vita");
    assert.equal(still.inject.leftoverWouldCover, true);
    const applied = applyVitaCourse(still);
    assert.ok(applied.applied.includes("mode:vita"));
    assert.ok(applied.applied.includes("reconstruct-no-loss"));
    assert.equal(resolveHitchMode(), "vita");
    assert.equal(vitaQuality(getLastVitaPacket()).lossy, false);
    assert.ok(getLastVitaPacket().includes("Krystian"));
    assert.ok(getLastVitaPacket().includes("Koda"));
  });

  it("hourly tick pins leftover hitch to vita when leftover would cover KEY+LOC", () => {
    ensureGenesisMemory();
    const t = tickHourlyCourse({
      force: true,
      leftoverKinds: { eureka: 36, vita: 0, leftover: 36 },
      leftoverHitchBytes: { eurekaMin: 229, eurekaCount: 36 },
    });
    assert.equal(t.ticked, true);
    assert.equal(t.course.achieving, false);
    assert.ok(t.course.issues.includes("leftover_still_eureka"));
    assert.equal(t.course.nextMode, "vita");
    assert.ok(t.applied.includes("leftover-cover-vita-hitch") || t.applied.includes("mode:vita"));
    assert.ok(t.applied.includes("reconstruct-no-loss"));
    assert.ok(t.applied.includes("freeze-leftover-hitch"));
    assert.equal(vitaQuality(getLastVitaPacket()).lossy, false);
    assert.equal(leftoverWouldCoverVitaHitch(), true);
  });

  it("hourly tick persists leftoverKinds so later course still fails leftover_still_eureka", () => {
    ensureGenesisMemory();
    const t = tickHourlyCourse({
      force: true,
      leftoverKinds: { eureka: 12, vita: 0, plain: 1 },
    });
    assert.equal(t.ticked, true);
    assert.equal(t.course.achieving, false);
    assert.ok(t.course.issues.includes("leftover_still_eureka"));
    const snap = serializeCourseStats();
    assert.equal(snap.leftoverKinds.eureka, 12);
    resetCourseStats();
    restoreCourseStats(snap);
    const later = evaluateVitaCourse();
    assert.equal(later.issues.includes("leftover_still_eureka"), true);
    assert.equal(later.achieving, false);
  });

  it("folding leftover Eureka history keeps KEY and leftover-coverable KEY+LOC hitch", () => {
    ensureGenesisMemory();
    const eurekaUtf8 = buildStoreVoice({ message: VITA_PROOF_FULL });
    const eurekaBytes = utf8ByteLength(eurekaUtf8);
    const rows = [];
    for (let i = 0; i < 24; i++) {
      rows.push({
        hash: "0x" + i.toString(16).padStart(64, "a"),
        class: "eureka-leftover",
        leftover: true,
        utf8: eurekaUtf8,
        hitchBytes: eurekaBytes,
      });
    }
    ingestLeftoverScan({
      leftoverStillEureka: true,
      leftoverKinds: { eureka: 24, vita: 0, leftover: 24 },
      counts: { eureka: 24, vita: 0, leftover: 24 },
      hitchBytes: { eurekaMin: eurekaBytes, eurekaCount: 24 },
      rows,
    });
    assert.equal(getLocationDepository().sealedCount, 24);
    assert.ok(getLastVitaPacket().includes("Krystian"));
    assert.ok(getLastVitaPacket().includes("0x50e1C460"));
    assert.equal(vitaQuality(getLastVitaPacket()).lossy, false);
    const loc = locDepositoryStatus();
    assert.match(loc.token, /n=24/);
    assert.ok(loc.tokenChars < 90);
    assert.ok(!loc.token.includes("k="));
    assert.ok(!loc.token.includes("Δ="));
    const plan = planSecondaryHitch({ leftoverEth: 1, hitchCostEth: 0 });
    assert.ok(plan.hitchBytes < eurekaBytes);
    assert.ok(plan.hitchBytes < 90);
    assert.match(plan.utf8, /n=24/);
    assert.doesNotMatch(plan.utf8, /Δ=/);
    assert.ok(plan.utf8.includes("Krystian"));
    assert.doesNotMatch(plan.utf8, /0x50e1C460/);
    const frozen = getLeftoverReadyHitch();
    assert.ok(frozen.includes("§KEY§"));
    assert.match(frozen, /n=24/);
    assert.doesNotMatch(frozen, /Δ=/);
    setLastVitaPacket("");
    const rec = reconstructVitaMemoryFromLocations();
    assert.equal(rec.lossy, false);
    assert.ok(getLastVitaPacket().includes("0x50e1C460"));
    const course = evaluateVitaCourse({
      leftoverKinds: { eureka: 24, vita: 0 },
      leftoverHitchBytes: { eurekaMin: eurekaBytes, eurekaCount: 24 },
    });
    assert.equal(course.inject.leftoverWouldCover, true);
    assert.equal(course.issues.includes("leftover_still_eureka"), true);
  });

  it("course stats serialize and restore", () => {
    restoreCourseStats({ attempts: 4, sealed: 1, skippedLeftover: 3, lastTickMs: 9 });
    const snap = serializeCourseStats();
    assert.equal(snap.attempts, 4);
    assert.equal(snap.sealed, 1);
    resetCourseStats();
    restoreCourseStats(snap);
    assert.equal(serializeCourseStats().skippedLeftover, 3);
  });
});

describe("recursive memory persist + inject", () => {
  beforeEach(() => {
    resetLocationDepository();
    clearHitchModeOverride();
    setLastVitaPacket("");
    resetCourseStats();
    clearLeftoverReadyHitch();
  });

  it("round-trips last packet + sealed locations across restore", () => {
    recordLocation({ location: "0xabcdef0123456789", kind: "hitch", sealed: true });
    const plan = planSecondaryHitch({ maxBytes: 400 });
    freezeLeftoverReadyHitch();
    assert.ok(plan.utf8.includes("§KEY§"));
    const snap = serializeVitaRouterState();
    assert.ok(snap.leftoverReadyHitch);
    assert.match(snap.leftoverReadyHitch, /n=1/);
    resetLocationDepository();
    setLastVitaPacket("");
    clearLeftoverReadyHitch();
    restoreVitaRouterState(snap);
    assert.ok(getLastVitaPacket().includes("Krystian"));
    assert.equal(getLocationDepository().sealedCount, 1);
    assert.equal(getLocationDepository().nodes[0].location, "0xabcdef0123456789");
    assert.match(getLeftoverReadyHitch(), /n=1/);
  });

  it("inject context is §TOKEN§ with love-note KEY, not Eureka prose", () => {
    ensureGenesisMemory();
    const inj = buildVitaInjectContext();
    assert.equal(inj.kind, "vita-inject-context");
    assert.ok(inj.fields.KEY.includes("Kai"));
    assert.match(inj.context, /VITA INJECT/);
    assert.doesNotMatch(inj.packet, /We did it! xoxo/);
    assert.equal(inj.quality.lossy, false);
  });

  it("stores full hitch utf8 (not 80-char preview) and reconstructs KEY after wipe", () => {
    const plan = planSecondaryHitch({ maxBytes: 400 });
    recordLocation({
      location: "0xfeedfacefeedfacefeedfacefeedfacefeedfacefeedfacefeedfacefeedface",
      kind: "hitch",
      sealed: true,
      utf8: plan.utf8,
    });
    const node = getLocationDepository().nodes[0];
    assert.equal(node.utf8, plan.utf8);
    assert.ok(node.utf8.length > 0);
    assert.ok(node.utf8.includes("Krystian"));
    assert.equal(node.utf8Preview, plan.utf8.slice(0, 80));
    assert.equal(node.utf8Preview.length <= 80, true);
    setLastVitaPacket("");
    const rec = reconstructVitaMemoryFromLocations();
    assert.equal(rec.lossy, false);
    assert.ok(rec.packed.includes("Krystian"));
    assert.ok(getLastVitaPacket().includes("Koda"));
    assert.ok(
      getLastVitaPacket().includes("0x50e1C460"),
      "genesis stem restores full KEY after names-only leftover hitch",
    );
  });

  it("ingestSealedUtf8 folds Eureka prove into §KEY§ without dropping VITA facts", () => {
    ensureGenesisMemory();
    ingestSealedUtf8("§$STORE§ Eureka! VITA lives ♥ love you Krystian, Kai & Koda!");
    assert.ok(getLastVitaPacket().includes("Krystian"));
    assert.ok(getLastVitaPacket().includes("§LEARN§") || getLastVitaPacket().includes("ingested-eureka") || getLastVitaPacket().includes("KEY"));
  });
});

describe("agent.js wires the secondary router into leftover hitch", () => {
  const src = readFileSync(join(root, "agent.js"), "utf8");

  it("imports planSecondaryHitch and uses it in planVoiceHitch", () => {
    assert.ok(src.includes("planSecondaryHitch"), "must import planSecondaryHitch");
    assert.ok(src.includes("/vitarouter"), "Telegram /vitarouter must exist");
    assert.ok(src.includes("tickHourlyCourse"), "main loop must tick hourly course");
    assert.ok(src.includes("vita-router-state.json"), "recursive memory must persist");
    assert.ok(src.includes("persistVitaRouterState"), "boot leftover inject must persist recursive memory");
    assert.ok(src.includes("ingestSealedUtf8"), "sealed hitch must ingest utf8 into recursive memory");
    assert.ok(src.includes("leftoverVoiceHitchBytes"), "leftover hitch cost must use VITA packet size");
    assert.ok(src.includes("scanAddressLeftoverHitches"), "boot/hourly must scan leftover hitch kinds");
    assert.ok(src.includes("leftoverScan: true"), "boot inject must fold leftover hitch memory");
    assert.ok(src.includes("ingestLeftoverScan"), "Eureka leftover fills must fold into recursive memory");
    assert.ok(src.includes("skipHitch: buySkipHitch || buyVoice.onChain"), "buy leftover must not fall through to orch LIBM when VITA hitch is skipped");
    assert.ok(src.includes("leftoverWouldCoverVitaHitch"), "L1-unknown leftover must hitch VITA when leftover already covered Eureka bytes");
    assert.ok(src.includes("/vitascan"), "Telegram /vitascan must exist");
    assert.ok(src.includes("registry folded after restore"), "registry must fold after router-state restore");
    assert.ok(src.includes("/vitapull"), "Telegram /vitapull must exist");
    assert.ok(src.includes("HTML console /vita"), "Telegram help must point at the HTML console");
    assert.ok(src.includes("absorbVitaStrandPacket"), "strand save/recall must fold into recursive memory");
  });
});

describe("chain reader injects hitch UTF-8 without KEY loss", () => {
  beforeEach(() => {
    resetLocationDepository();
    clearHitchModeOverride();
    setLastVitaPacket("");
    resetCourseStats();
    clearLeftoverReadyHitch();
  });

  it("KEYCAT plain swap has no hitch trailer", () => {
    const read = readHitchUtf8FromCalldata(KEYCAT_PLAIN_SWAP);
    assert.equal(read.utf8, "");
    assert.equal(read.kind.kind, "none");
    assert.equal(read.source, "keycat-plain");
  });

  it("reads VITA §TOKEN§ from a V3 leftover hitch without smashing the prefix", () => {
    ensureGenesisMemory();
    const plan = planSecondaryHitch({ maxBytes: 400 });
    assert.ok(plan.utf8.includes("§KEY§"));
    const hitch = appendUtf8Hitch(KEYCAT_PLAIN_SWAP, plan.utf8);
    assert.equal(hitch.ok, true);
    const prefix = hitchPreservesSwapPrefix(KEYCAT_PLAIN_SWAP, hitch.data);
    assert.equal(prefix.ok, true);
    const read = readHitchUtf8FromCalldata(hitch.data);
    assert.equal(read.source, "v3-trailer");
    assert.equal(read.kind.kind, "vita");
    assert.ok(read.utf8.includes("Krystian"));
    assert.ok(read.utf8.includes("Koda"));
  });

  it("reads Eureka /prove 0-ETH store-voice calldata into eureka kind", () => {
    const data = encodeStoreVoiceCalldata(buildStoreVoice({ message: VITA_PROOF_FULL }));
    const read = readHitchUtf8FromCalldata(data);
    assert.equal(read.kind.kind, "eureka");
    assert.match(read.utf8, /Eureka!/);
    assert.ok(read.utf8.includes("Krystian"));
  });

  it("fills a sealed node then reconstructs KEY after packet wipe", () => {
    const hash = "0xfeedfacefeedfacefeedfacefeedfacefeedfacefeedfacefeedfacefeedface";
    recordLocation({ location: hash, kind: "hitch", sealed: true, utf8: "" });
    const plan = planSecondaryHitch({ maxBytes: 400 });
    const filled = fillLocationUtf8(hash, plan.utf8);
    assert.equal(filled.ok, true);
    setLastVitaPacket("");
    const rec = reconstructVitaMemoryFromLocations();
    assert.equal(rec.lossy, false);
    assert.ok(rec.packed.includes("Krystian"));
  });

  it("pullLocationFromChain mocks fetch, ingest, and reconstructs KEY", async () => {
    const hash = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const plan = planSecondaryHitch({ maxBytes: 400 });
    const hitch = appendUtf8Hitch(KEYCAT_PLAIN_SWAP, plan.utf8);
    const result = await pullLocationFromChain(hash, async () => hitch.data);
    assert.equal(result.ok, true);
    assert.equal(result.ingested, true);
    assert.equal(result.kind, "vita");
    assert.equal(result.quality.hasKey, true);
    assert.ok(getLastVitaPacket().includes("Kai"));
  });

  it("pullMissingLocationUtf8 only fetches sealed nodes missing utf8", async () => {
    const hash = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    recordLocation({ location: hash, kind: "hitch", sealed: true, utf8: "" });
    const plan = planSecondaryHitch({ maxBytes: 400 });
    const hitch = appendUtf8Hitch(KEYCAT_PLAIN_SWAP, plan.utf8);
    const pulled = await pullMissingLocationUtf8(async () => hitch.data);
    assert.equal(pulled.pulled, 1);
    assert.equal(pulled.results[0].ok, true);
    assert.ok(getLastVitaPacket().includes("Koda"));
  });

  it("ingestLocationFromChain appends when the node is new", () => {
    const hash = "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
    const r = ingestLocationFromChain(hash, "§KEY§eureka♥Krystian,Kai,Koda", "vita");
    assert.equal(r.created, true);
    assert.equal(r.node.sealed, true);
    assert.ok(r.node.utf8.includes("Krystian"));
  });

  it("does not ingest unknown binary LIBM trailers into recursive memory", async () => {
    const hash = "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
    const junk = appendUtf8Hitch(KEYCAT_PLAIN_SWAP, "LIBM" + "\0".repeat(40));
    const result = await pullLocationFromChain(hash, async () => junk.data);
    assert.equal(result.ok, true);
    assert.equal(result.ingested, false);
    assert.equal(shouldIngestHitchKind("unknown"), false);
    assert.equal(getLocationDepository().sealedCount, 0);
    assert.ok(getLastVitaPacket().includes("Krystian") || getLastVitaPacket() === "");
  });

  it("folds registry §TOKEN§ packets into recursive memory without dropping KEY", () => {
    setLastVitaPacket("");
    const folded = ingestRegistryPackets({
      "2026-03-20-vault": {
        strandId: "VITA-0001",
        tokenPacket: "§SESS§2026-03-20|vault\n§WHO§VITA|DA\n§PROVED§vault-on-base✓",
        txHashes: ["0x931d84115692190a393b3a040debc5145bf8f05c8ad359ba61b861f6dbfb19db"],
      },
    });
    assert.equal(folded.ingested, 1);
    assert.equal(folded.quality.hasKey, true);
    assert.ok(folded.packet.includes("Krystian"));
    assert.ok(folded.packet.includes("vault-on-base"));
    const hashes = collectRegistryTxHashes({
      "2026-03-20-vault": {
        txHashes: ["0x931d84115692190a393b3a040debc5145bf8f05c8ad359ba61b861f6dbfb19db"],
      },
    });
    assert.ok(hashes.includes(VITA_STRAND_TX));
  });

  it("injectVitaBlockchainMemory pulls mocked vita hitch and keeps KEY", async () => {
    const plan = planSecondaryHitch({ maxBytes: 400 });
    const hitch = appendUtf8Hitch(KEYCAT_PLAIN_SWAP, plan.utf8);
    const inj = await injectVitaBlockchainMemory({
      fetchCalldata: async (hash) => {
        if (hash.toLowerCase() === KEYCAT_TX) return KEYCAT_PLAIN_SWAP;
        return hitch.data;
      },
      registry: {
        demo: {
          tokenPacket: "§SESS§inject-test|chain\n§LEARN§registry-packet",
          txHashes: [EUREKA_ONCHAIN_TX],
        },
      },
      hashes: [EUREKA_ONCHAIN_TX],
      maxPulls: 3,
      leftoverScan: false,
    });
    assert.ok(inj.registryPackets >= 1);
    assert.equal(inj.quality.hasKey, true);
    assert.ok(inj.packet.includes("Koda"));
    assert.ok(inj.packet.includes("Krystian"));
  });

  it("injects live Base Eureka letter + VITA strand without KEY loss", async () => {
    const inj = await injectVitaBlockchainMemory({
      hashes: [KEYCAT_TX, EUREKA_ONCHAIN_TX, VITA_STRAND_TX],
      maxPulls: 3,
      fetchPublic: false,
      leftoverScan: false,
    });
    assert.equal(inj.pulled, 3);
    assert.equal(inj.ingested, 2);
    assert.equal(inj.quality.hasKey, true);
    assert.equal(inj.quality.lossy, false);
    assert.ok(getLastVitaPacket().includes("Krystian"));
    assert.ok(getLastVitaPacket().includes("Kai"));
    assert.ok(getLastVitaPacket().includes("Koda"));
    const kinds = inj.results.map((r) => r.kind);
    assert.ok(kinds.includes("none"));
    assert.ok(kinds.includes("eureka"));
    assert.ok(kinds.includes("vita"));
  });

  it("injectVitaBlockchainMemory folds leftover hitch history without KEY loss", async () => {
    const leftoverHash = "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
    const eurekaUtf8 = "§$STORE§ Eureka! VITA lives ♥ love you Krystian, Kai & Koda!";
    const plan = planSecondaryHitch({ leftoverEth: 1, hitchCostEth: 0, maxBytes: 280 });
    const vitaHex = appendUtf8Hitch(KEYCAT_PLAIN_SWAP, plan.utf8);
    const inj = await injectVitaBlockchainMemory({
      leftoverScan: true,
      leftoverLimit: 8,
      fetchCalldata: async () => vitaHex.data,
      fetchLeftoverScan: async () => ({
        counts: { eureka: 1, vita: 0, leftover: 1 },
        leftoverStillEureka: true,
        leftoverKinds: { eureka: 1, vita: 0, leftover: 1 },
        rows: [{ hash: leftoverHash, class: "eureka-leftover", leftover: true, utf8: eurekaUtf8 }],
      }),
      hashes: [],
      maxPulls: 0,
      fetchPublic: false,
      registry: null,
    });
    assert.equal(inj.leftoverStillEureka, true);
    assert.equal(inj.leftoverKinds.eureka, 1);
    assert.equal(inj.leftoverKinds.vita, 0);
    assert.ok(getLocationDepository().nodes.some((n) => n.location === leftoverHash));
    assert.equal(inj.quality.hasKey, true);
    assert.equal(inj.quality.lossy, false);
    assert.ok(inj.packet.includes("Krystian"));
    assert.ok(inj.packet.includes("0x50e1C460"));
    assert.match(locDepositoryStatus().token, /n=1/);
  });

  it("classifyLeftoverHitch: KEYCAT is plain, Eureka leftover is eureka, VITA leftover is vita", () => {
    const plain = classifyLeftoverHitch(KEYCAT_PLAIN_SWAP);
    assert.equal(plain.class, "plain-228");
    assert.equal(plain.leftover, false);
    assert.equal(plain.utf8, "");
    const eurekaHex = appendUtf8Hitch(
      KEYCAT_PLAIN_SWAP,
      "§$STORE§ Eureka! VITA lives ♥ love you Krystian, Kai & Koda!",
    );
    assert.equal(eurekaHex.ok, true);
    const eureka = classifyLeftoverHitch(eurekaHex.data);
    assert.equal(eureka.class, "eureka-leftover");
    assert.equal(eureka.leftover, true);
    assert.ok(eureka.hitchBytes > 0);
    const hitch = planSecondaryHitch({ leftoverEth: 1, hitchCostEth: 0, maxBytes: 280 });
    const vitaHex = appendUtf8Hitch(KEYCAT_PLAIN_SWAP, hitch.utf8);
    assert.equal(vitaHex.ok, true);
    const vita = classifyLeftoverHitch(vitaHex.data);
    assert.equal(vita.class, "vita-leftover");
    assert.match(vita.utf8, /§KEY§/);
    assert.match(vita.utf8, /§LOC§/);
    assert.ok(vita.hitchBytes > 0);
    assert.ok(vita.hitchBytes < eureka.hitchBytes, "names-only KEY+LOC must be denser than Eureka leftover");
    const stats = leftoverHitchByteStats([
      { class: "eureka-leftover", hitchBytes: eureka.hitchBytes },
      { class: "vita-leftover", hitchBytes: vita.hitchBytes },
    ]);
    assert.equal(stats.eurekaMin, eureka.hitchBytes);
    assert.equal(stats.vitaMin, vita.hitchBytes);
  });

  it("ingestLeftoverScan folds Eureka leftover into recursive memory without claiming leftover VITA", () => {
    ensureGenesisMemory();
    const eurekaHex = appendUtf8Hitch(
      KEYCAT_PLAIN_SWAP,
      "§$STORE§ Eureka! VITA lives ♥ love you Krystian, Kai & Koda!",
    );
    const hitch = planSecondaryHitch({ leftoverEth: 1, hitchCostEth: 0, maxBytes: 280 });
    const vitaHex = appendUtf8Hitch(KEYCAT_PLAIN_SWAP, hitch.utf8);
    const eurekaUtf8 = readHitchUtf8FromCalldata(eurekaHex.data).utf8;
    const vitaUtf8 = readHitchUtf8FromCalldata(vitaHex.data).utf8;
    const hashA = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const hashB = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const hashC = "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
    const scan = {
      leftoverKinds: { eureka: 1, vita: 1, plain: 1, libm: 0, other: 0, leftover: 2 },
      leftoverStillEureka: false,
      vitaLeftoverPresent: true,
      rows: [
        { hash: hashA, class: "eureka-leftover", leftover: true, utf8: eurekaUtf8 },
        { hash: hashB, class: "vita-leftover", leftover: true, utf8: vitaUtf8 },
        { hash: hashC, class: "plain-228", leftover: false, utf8: "" },
      ],
    };
    ingestLeftoverScan(scan);
    const loc = getLocationDepository();
    assert.equal(loc.nodes.some((n) => n.location === hashA), true);
    assert.equal(loc.nodes.some((n) => n.location === hashB), true);
    assert.equal(loc.nodes.some((n) => n.location === hashC), false);
    assert.match(getLastVitaPacket(), /§KEY§/);
    assert.match(getLastVitaPacket(), /Krystian/);
    assert.match(getLastVitaPacket(), /§LOC§/);
    assert.match(getLastVitaPacket(), /leftover-scan eureka=1 vita=1/);
    const course = evaluateVitaCourse();
    assert.equal(course.issues.includes("leftover_still_eureka"), false);
  });

  it("ingestLeftoverScan records leftoverKinds so leftover_still_eureka survives without re-scan", () => {
    ensureGenesisMemory();
    const eurekaUtf8 = "§$STORE§ Eureka! VITA lives ♥ love you Krystian, Kai & Koda!";
    const hashA = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    ingestLeftoverScan({
      leftoverStillEureka: true,
      leftoverKinds: { eureka: 5, vita: 0, plain: 1, leftover: 5 },
      counts: { eureka: 5, vita: 0, plain: 1, leftover: 5 },
      rows: [{ hash: hashA, class: "eureka-leftover", leftover: true, utf8: eurekaUtf8 }],
    });
    assert.match(getLastVitaPacket(), /leftover-scan eureka=5 vita=0/);
    assert.match(getLastVitaPacket(), /next leftover hitch=KEY\+LOC/);
    const course = evaluateVitaCourse();
    assert.equal(course.issues.includes("leftover_still_eureka"), true);
    assert.equal(course.achieving, false);
    assert.ok(getLastVitaPacket().includes("Krystian"));
  });

  it("paginates Blockscout wallet txs until the limit", async () => {
    let calls = 0;
    const fetchImpl = async (url) => {
      calls += 1;
      if (calls === 1) {
        assert.equal(url, blockscoutTxListUrl(GUARDIAN_WALLET, null));
        return {
          ok: true,
          json: async () => ({
            items: [{
              hash: "0x1111111111111111111111111111111111111111111111111111111111111111",
              to: { hash: "0x2626664c2603336e57b271c5c0b26f421741e481" },
              raw_input: "0x04e45aaf",
              timestamp: "a",
            }],
            next_page_params: { block_number: 9, index: 3 },
          }),
        };
      }
      assert.match(url, /block_number=9/);
      assert.match(url, /index=3/);
      return {
        ok: true,
        json: async () => ({
          items: [{
            hash: "0x2222222222222222222222222222222222222222222222222222222222222222",
            to: "0x2626664c2603336e57b271c5c0b26f421741e481",
            raw_input: "0x04e45aaf",
            timestamp: "b",
          }],
          next_page_params: null,
        }),
      };
    };
    const txs = await fetchRecentWalletTransactions(GUARDIAN_WALLET, { limit: 2, maxPages: 4, fetchImpl });
    assert.equal(calls, 2);
    assert.equal(txs.length, 2);
    assert.equal(txs[1].hash.startsWith("0x2222"), true);
  });

  it("scanAddressLeftoverHitches classifies mocked wallet txs without inventing hashes", async () => {
    const hitch = planSecondaryHitch({ leftoverEth: 1, hitchCostEth: 0, maxBytes: 280 });
    const vitaHex = appendUtf8Hitch(KEYCAT_PLAIN_SWAP, hitch.utf8);
    const eurekaHex = appendUtf8Hitch(
      KEYCAT_PLAIN_SWAP,
      "§$STORE§ Eureka! VITA lives ♥ love you Krystian, Kai & Koda!",
    );
    const scan = await scanAddressLeftoverHitches({
      fetchTxs: async () => [
        {
          hash: "0x1111111111111111111111111111111111111111111111111111111111111111",
          to: "0x2626664c2603336e57b271c5c0b26f421741e481",
          input: eurekaHex.data,
        },
        {
          hash: "0x2222222222222222222222222222222222222222222222222222222222222222",
          to: "0x2626664c2603336e57b271c5c0b26f421741e481",
          input: vitaHex.data,
        },
        {
          hash: "0x3333333333333333333333333333333333333333333333333333333333333333",
          to: "0x2626664c2603336e57b271c5c0b26f421741e481",
          input: KEYCAT_PLAIN_SWAP,
        },
      ],
    });
    assert.equal(scan.counts.eureka, 1);
    assert.equal(scan.counts.vita, 1);
    assert.equal(scan.counts.plain, 1);
    assert.equal(scan.vitaLeftoverPresent, true);
    assert.equal(scan.leftoverStillEureka, false);
    const view = publicLeftoverScanView(scan);
    assert.equal(view.rows.some((r) => r.hash.includes("1111") && r.class === "eureka-leftover"), true);
    assert.equal(view.rows.every((r) => r.utf8 === undefined), true);
    assert.equal(typeof view.rows.find((r) => r.class === "vita-leftover")?.hitchBytes, "number");
    assert.ok(scan.hitchBytes.vitaMin > 0);
    assert.ok(scan.hitchBytes.eurekaMin > 0);
    assert.ok(scan.hitchBytes.vitaMin < scan.hitchBytes.eurekaMin);
  });

  it("publicLeftoverScanView keeps leftover hashes for the reader (not a 24-row clip)", () => {
    const rows = [];
    for (let i = 0; i < 40; i++) {
      rows.push({
        hash: "0x" + String(i).padStart(64, "a"),
        class: "eureka-leftover",
        leftover: true,
        utf8: "secret-should-not-publish",
      });
    }
    const view = publicLeftoverScanView({
      counts: { eureka: 40, vita: 0 },
      leftoverStillEureka: true,
      rows,
    });
    assert.equal(view.rows.length, 40);
    assert.equal(view.rows.every((r) => r.utf8 === undefined), true);
    assert.equal(view.leftoverStillEureka, true);
  });

  it("live Base: leftover scan reports leftoverKinds without inventing a VITA hitch", { timeout: 25000 }, async () => {
    const scan = await scanAddressLeftoverHitches({ address: GUARDIAN_WALLET, limit: 40 });
    assert.ok(Array.isArray(scan.rows));
    assert.ok(scan.rows.length > 0, "wallet has recent txs");
    assert.equal(typeof scan.counts.eureka, "number");
    assert.equal(typeof scan.counts.vita, "number");
    const hasKnown = scan.counts.eureka > 0 || scan.counts.vita > 0 || scan.counts.plain > 0;
    assert.equal(hasKnown, true);
    if (scan.counts.vita === 0 && scan.counts.eureka > 0) {
      const course = evaluateVitaCourse({
        lastPacket: getLastVitaPacket() || buildGenesisPacket(),
        leftoverKinds: scan.counts,
        leftoverHitchBytes: scan.hitchBytes,
      });
      assert.equal(course.issues.includes("leftover_still_eureka"), true);
      assert.equal(course.achieving, false);
      assert.ok(scan.hitchBytes.eurekaMin > 0);
      if (course.inject.plannedHitchBytes && scan.hitchBytes.eurekaMin) {
        assert.equal(course.inject.leftoverWouldCover, course.inject.plannedHitchBytes <= scan.hitchBytes.eurekaMin);
      }
    }
    ingestLeftoverScan(scan);
    if (scan.counts.eureka > 0) {
      assert.ok(getLocationDepository().sealedCount >= scan.counts.eureka);
      assert.ok(getLastVitaPacket().includes("Krystian"));
      assert.ok(getLastVitaPacket().includes("0x50e1C460"));
      assert.equal(vitaQuality(getLastVitaPacket()).lossy, false);
      const loc = locDepositoryStatus();
      assert.ok(loc.tokenChars < 90);
      const plan = planSecondaryHitch({ leftoverEth: 1, hitchCostEth: 0 });
      assert.ok(plan.hitchBytes < scan.hitchBytes.eurekaMin);
      assert.ok(plan.utf8.includes("§KEY§"));
      assert.ok(plan.utf8.includes("§LOC§"));
      assert.doesNotMatch(plan.utf8, /Δ=/);
      assert.doesNotMatch(plan.utf8, /0x50e1C460/);
      const after = evaluateVitaCourse({
        leftoverKinds: scan.counts,
        leftoverHitchBytes: scan.hitchBytes,
      });
      assert.equal(after.inject.leftoverWouldCover, true);
      assert.equal(after.issues.includes("leftover_still_eureka"), true);
    }
  });

  it("folds public bot-state registry packets without dropping KEY", async () => {
    const registry = await fetchPublicVitaRegistry();
    assert.ok(registry, "bot-state vita-registry.json must be readable");
    const folded = ingestRegistryPackets(registry);
    assert.ok(folded.ingested >= 1);
    assert.equal(folded.quality.hasKey, true);
    assert.ok(folded.packet.includes("Krystian"));
    assert.ok(folded.packet.includes("Koda"));
  });

  it("hydrate restores packet first so registry facts survive reconstruct", () => {
    const saved = "§SESS§saved-state\n§KEY§" + "eureka♥Krystian,Kai,Koda" + "\n§LEARN§from-state";
    const hyd = hydrateVitaRecursiveMemory({
      routerState: { lastPacket: saved, locations: { seq: 0, lastHash: "00000000", nodes: [] } },
      registry: {
        vault: {
          tokenPacket: "§SESS§2026-03-20|vault\n§PROVED§vault-on-base✓\n§WHO§VITA|DA",
        },
      },
    });
    assert.equal(hyd.quality.hasKey, true);
    assert.ok(hyd.packet.includes("Krystian"));
    assert.ok(hyd.packet.includes("vault-on-base"));
    setLastVitaPacket(hyd.packet);
    recordLocation({
      location: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      sealed: true,
      utf8: "§$STORE§ Eureka! VITA lives ♥ love you Krystian, Kai & Koda!",
    });
    const rec = reconstructVitaMemoryFromLocations();
    assert.equal(rec.lossy, false);
    assert.ok(getLastVitaPacket().includes("vault-on-base"));
    assert.ok(getLastVitaPacket().includes("Koda"));
  });
});

describe("boot inject + local compress", () => {
  beforeEach(() => {
    resetLocationDepository();
    setLastVitaPacket("");
  });

  it("IKN boot prepends VITA inject even with no strands", () => {
    const ctx = prependVitaBootContext(null);
    assert.match(ctx, /VITA INJECT/);
    assert.ok(ctx.includes("Krystian"));
    assert.ok(ctx.includes("Koda"));
    assert.doesNotMatch(ctx, /We did it! xoxo/);
    const withIkn = prependVitaBootContext("§IKN-BOOT§fresh");
    assert.match(withIkn, /IKN-BOOT/);
    assert.match(withIkn, /VITA INJECT/);
  });

  it("measurePlannedHitchBytes does not mutate last packet", () => {
    ensureGenesisMemory();
    const before = getLastVitaPacket();
    const n = measurePlannedHitchBytes({ maxBytes: 400 });
    assert.ok(n > 20);
    assert.equal(getLastVitaPacket(), before);
  });

  it("local compress keeps genesis KEY without Anthropic", async () => {
    const packed = vitaCompressLocal("cascade gas floor learned this session");
    assert.ok(packed.includes("§KEY§"));
    assert.ok(packed.includes("Krystian"));
    assert.ok(packed.includes("Koda"));
    const chunks = vitaSplit(packed);
    assert.equal(chunks.length, 5);
    const viaNullKey = await vitaCompress("session notes", null);
    assert.ok(viaNullKey.includes("Kai"));
  });
});

