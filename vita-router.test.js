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
  vitaRouterStatus,
} from "./vita-router.js";
import {
  evaluateVitaCourse,
  formatCourseMessage,
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
} from "./swap-minout.js";
import {
  readHitchUtf8FromCalldata,
  pullLocationFromChain,
  pullMissingLocationUtf8,
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
    resetCourseStats();
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
  beforeEach(() => {
    resetLocationDepository();
    clearHitchModeOverride();
    setLastVitaPacket("");
    resetCourseStats();
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
  });

  it("round-trips last packet + sealed locations across restore", () => {
    recordLocation({ location: "0xabcdef0123456789", kind: "hitch", sealed: true });
    const plan = planSecondaryHitch({ maxBytes: 400 });
    assert.ok(plan.utf8.includes("§KEY§"));
    const snap = serializeVitaRouterState();
    resetLocationDepository();
    setLastVitaPacket("");
    restoreVitaRouterState(snap);
    assert.ok(getLastVitaPacket().includes("Krystian"));
    assert.equal(getLocationDepository().sealedCount, 1);
    assert.equal(getLocationDepository().nodes[0].location, "0xabcdef0123456789");
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
    assert.ok(node.utf8.length > 80);
    assert.ok(node.utf8.includes("Krystian"));
    assert.equal(node.utf8Preview.length <= 80, true);
    setLastVitaPacket("");
    const rec = reconstructVitaMemoryFromLocations();
    assert.equal(rec.lossy, false);
    assert.ok(rec.packed.includes("Krystian"));
    assert.ok(getLastVitaPacket().includes("Koda"));
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
    assert.ok(src.includes("ingestSealedUtf8"), "sealed hitch must ingest utf8 into recursive memory");
    assert.ok(src.includes("leftoverVoiceHitchBytes"), "leftover hitch cost must use VITA packet size");
    assert.ok(src.includes("pullMissingLocationUtf8"), "boot must re-read hitch utf8 from Base");
    assert.ok(src.includes("/vitapull"), "Telegram /vitapull must exist");
    assert.ok(src.includes("absorbVitaStrandPacket"), "strand save/recall must fold into recursive memory");
  });
});

describe("chain reader injects hitch UTF-8 without KEY loss", () => {
  beforeEach(() => {
    resetLocationDepository();
    clearHitchModeOverride();
    setLastVitaPacket("");
    resetCourseStats();
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

