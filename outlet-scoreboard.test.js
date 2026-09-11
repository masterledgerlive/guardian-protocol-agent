import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  V3_FEE_TIERS,
  feeTierCandidates,
  isEmptyV3Liquidity,
  enumerateViableFeeRoutes,
  pickDeepestCheapestPath,
  gameGhostFee3000Quote,
  GAME_EMPTY_FEE_3000_POOL,
} from "./v3-fee-routes.js";
import {
  packKeyLocHitchUtf8,
  measureKeyLocHitchBytes,
  measureEurekaLeftoverBytes,
  preferDenseHitch,
  maxInjectRateUnderLoseZero,
  EUREKA_LEFTOVER_BYTES,
  KEY_LOC_HITCH_BYTES_CLASS,
  L2_BYTE_LESSONS,
} from "./hitch-density.js";
import {
  buildOutletScoreboard,
  recommendOutlet,
  GAME_GHOST_CUT,
  CATALOG_CUT_FREEZES,
  CUT_CLASS,
  KEEP_CLASS,
  CAUTION_CLASS,
} from "./outlet-scoreboard.js";
import { ALWAYS_PLUS_EXIT } from "./always-plus-exit.js";
import { parseDefaultTokensFromAgentSource } from "./board-control.js";
import { encodingDoesNotLoseMoney } from "./swap-minout.js";
import { estimateInjectCostEth } from "./lose-zero-gate.js";

const root = dirname(fileURLToPath(import.meta.url));
const agentSrc = readFileSync(join(root, "agent.js"), "utf8");

describe("v3 fee routes — never send liquidity()=0", () => {
  it("enumerates all Uni V3 fees with catalog first", () => {
    assert.deepEqual(feeTierCandidates(3000), [3000, 100, 500, 10000]);
    assert.deepEqual(feeTierCandidates(10000), [10000, 100, 500, 3000]);
    assert.ok(V3_FEE_TIERS.includes(100));
  });

  it("treats liquidity()=0 as empty (GAME ghost 3000)", () => {
    assert.equal(isEmptyV3Liquidity(0n), true);
    assert.equal(isEmptyV3Liquidity(0), true);
    assert.equal(isEmptyV3Liquidity(12n), false);
    assert.equal(isEmptyV3Liquidity(null), false);
  });

  it("never picks GAME fee 3000 ghost even when a spot-like out is supplied", () => {
    const ranked = pickDeepestCheapestPath([
      gameGhostFee3000Quote({ amountOut: 274n * 10n ** 18n, quoted: true }),
      { fee: 10000, amountOut: 10n, liquidity: 50n, quoted: true, pool: "0xe5ff" },
      { fee: 500, amountOut: 0n, liquidity: 1n, quoted: false },
    ]);
    assert.equal(ranked.allow, true);
    assert.equal(ranked.fee, 10000);
    assert.ok(ranked.skippedEmpty.includes(3000));
    assert.equal(ranked.viable.some((v) => v.fee === 3000), false);
    assert.equal(GAME_EMPTY_FEE_3000_POOL.toLowerCase(), "0x70fbffe313d4a40909dba7129e0b2f4a45a645b5");
  });

  it("picks the deepest/cheapest effective path (most amountOut, then lower fee)", () => {
    const ranked = pickDeepestCheapestPath([
      { fee: 10000, amountOut: 90n, liquidity: 9_000n, quoted: true },
      { fee: 500, amountOut: 100n, liquidity: 4_000n, quoted: true },
      { fee: 3000, amountOut: 100n, liquidity: 8_000n, quoted: true },
    ]);
    assert.equal(ranked.allow, true);
    assert.equal(ranked.fee, 500, "same out → cheaper fee");
  });

  it("refuses when every fee is empty or unquoted", () => {
    const ranked = pickDeepestCheapestPath([
      { fee: 3000, amountOut: 0n, liquidity: 0n },
      { fee: 10000, amountOut: 0n, quoted: false },
    ]);
    assert.equal(ranked.allow, false);
    assert.equal(ranked.code, "NO_VIABLE_FEE");
    assert.match(ranked.log, /Not sending/);
  });

  it("enumerateViableFeeRoutes marks empty pools not viable", () => {
    const rows = enumerateViableFeeRoutes([
      { fee: 3000, liquidity: 0n, amountOut: 1n },
      { fee: 10000, liquidity: 10n, amountOut: 5n, quoted: true },
    ]);
    assert.equal(rows.find((r) => r.fee === 3000).viable, false);
    assert.equal(rows.find((r) => r.fee === 10000).viable, true);
  });
});

describe("hitch density — KEY+LOC over Eureka 229 B", () => {
  it("names-only KEY+LOC is the ~69 B class, denser than Eureka leftover", () => {
    const loc = measureKeyLocHitchBytes();
    const eureka = measureEurekaLeftoverBytes();
    assert.equal(measureKeyLocHitchBytes("n=24|t=a1b2|r=c3d4"), KEY_LOC_HITCH_BYTES_CLASS);
    assert.ok(loc >= 50 && loc <= 80, `KEY+LOC measured ${loc} B, expected ~69`);
    assert.ok(Math.abs(loc - KEY_LOC_HITCH_BYTES_CLASS) <= 20);
    assert.equal(EUREKA_LEFTOVER_BYTES, 229);
    assert.ok(loc < EUREKA_LEFTOVER_BYTES);
    assert.ok(eureka >= 60);
    assert.match(packKeyLocHitchUtf8(), /§KEY§/);
    assert.match(packKeyLocHitchUtf8(), /§LOC§/);
    assert.match(packKeyLocHitchUtf8(), /Krystian/);
    assert.doesNotMatch(packKeyLocHitchUtf8(), /The truth is the chain/);
  });

  it("prefers KEY+LOC when leftover covers it but not Eureka 229 B", () => {
    const locBytes = measureKeyLocHitchBytes();
    const gwei = 5;
    const l1Per = 1e-8;
    const locCost = estimateInjectCostEth(gwei, l1Per * locBytes, locBytes);
    const eurekaCost = estimateInjectCostEth(gwei, l1Per * 229, 229);
    const leftover = locCost * 2 * 1.05;
    assert.equal(encodingDoesNotLoseMoney({ leftoverEth: leftover / 2, hitchCostEth: locCost }), true);
    assert.ok(leftover / 2 < eurekaCost);
    const pick = preferDenseHitch({
      leftoverEth: leftover,
      gwei,
      l1FeePerByteEth: l1Per,
      hitchCostMult: 2,
      keyLocBytes: locBytes,
      eurekaBytes: 229,
    });
    assert.equal(pick.encoding, "key-loc");
    assert.equal(pick.skipHitch, false);
    assert.equal(pick.locOk, true);
    assert.equal(pick.eurekaOk, false);
  });

  it("plain swap when leftover cannot cover KEY+LOC (always-plus)", () => {
    const pick = preferDenseHitch({
      leftoverEth: 0,
      gwei: 1,
      hitchCostMult: 2,
    });
    assert.equal(pick.encoding, "plain");
    assert.equal(pick.skipHitch, true);
    const thin = preferDenseHitch({
      leftoverEth: 1e-18,
      gwei: 50,
      l1FeePerByteEth: 1e-6,
      hitchCostMult: 2,
    });
    assert.equal(thin.encoding, "plain");
  });

  it("documents max inject rate under LOSE-ZERO for a ~$3 bag without inventing P&L", () => {
    const r = maxInjectRateUnderLoseZero({ bagUsd: 3, leftoverPct: 0.02 });
    assert.match(r.kind, /simulated|estimated/);
    assert.equal(r.bagUsd, 3);
    assert.equal(r.pnlUsd, undefined);
    assert.ok(r.keyLoc.bytes < r.eurekaLeftover.bytes);
    assert.equal(r.prefer, "key-loc");
    assert.equal(r.keyLoc.hitchPerGreenExit, 1);
    assert.ok(r.densityVsEureka < 1);
    assert.equal(r.loseZero, true);
    const hold = maxInjectRateUnderLoseZero({ bagUsd: 3, leftoverPct: 0 });
    assert.equal(hold.keyLoc.hitchPerGreenExit, 0);
    assert.equal(hold.prefer, "plain");
    assert.equal(L2_BYTE_LESSONS.liveChain, "base");
    assert.equal(L2_BYTE_LESSONS.v4Deferred, true);
    assert.ok(L2_BYTE_LESSONS.lessons.some((l) => /Arbitrum/i.test(l.chain)));
    assert.ok(L2_BYTE_LESSONS.lessons.some((l) => /Solana/i.test(l.chain)));
  });
});

describe("outlet scoreboard — GAME ghost is CUT", () => {
  it("GAME observed hitch rate is 0/3 reverts, not invented P&L", () => {
    assert.equal(GAME_GHOST_CUT.class, CUT_CLASS);
    assert.equal(GAME_GHOST_CUT.hitchSuccessRate, 0);
    assert.equal(GAME_GHOST_CUT.failRevertRate, 1);
    assert.equal(GAME_GHOST_CUT.pnlUsd, null);
    assert.equal(GAME_GHOST_CUT.evidence.length, 3);
  });

  it("catalog freeze list includes GAME WELL KITE", () => {
    assert.deepEqual(CATALOG_CUT_FREEZES.map((r) => r.symbol), ["GAME", "WELL", "KITE"]);
  });

  it("scores catalog rows KEEP / CUT / CAUTION", () => {
    const rows = parseDefaultTokensFromAgentSource(agentSrc);
    const board = buildOutletScoreboard(rows, {
      injectMains: ["LINK", "UNI", "VVV", "ZORA", "BNKR", "AERO", "MORPHO"],
    });
    const by = Object.fromEntries(board.rows.map((r) => [r.symbol, r]));
    assert.equal(by.GAME.recommend, CUT_CLASS);
    assert.equal(by.GAME.frozen, true);
    assert.equal(by.GAME.hitchSuccessRate, 0);
    assert.equal(by.GAME.alwaysPlusExitOpen, true);
    assert.equal(by.WELL.recommend, CUT_CLASS);
    assert.equal(by.KITE.recommend, CUT_CLASS);
    assert.equal(by.LINK.recommend, KEEP_CLASS);
    assert.equal(by.UNI.recommend, KEEP_CLASS);
    assert.equal(by.CBBTC.recommend, CAUTION_CLASS);
    assert.equal(by.AAVE.recommend, CAUTION_CLASS);
    assert.ok(board.cut.includes("GAME"));
    assert.ok(!board.keep.includes("GAME"));
    assert.equal(board.alwaysPlus.cutClassDoesNotBlockGreenExit, true);
    assert.equal(board.v4Deferred, true);
    assert.equal(ALWAYS_PLUS_EXIT.v4Deferred, true);
  });

  it("recommendOutlet does not invent hitch rates for KEEP names", () => {
    const r = recommendOutlet({ symbol: "LINK", injectMain: true, feeTier: 3000 });
    assert.equal(r.recommend, KEEP_CLASS);
    assert.equal(r.hitchSuccessRate, null);
    assert.equal(r.pnlUsd, null);
  });

  it("GAME catalog freeze stays CUT class in agent.js", () => {
    const i = agentSrc.indexOf('symbol: "GAME"');
    const row = agentSrc.slice(i, agentSrc.indexOf("{ symbol:", i + 1));
    assert.match(row, /frozen:\s*true/);
    assert.match(row, /CUT class/);
    assert.match(row, /liquidity\(\)=0/);
    assert.match(row, /feeTier:\s*10000/, "catalog quotes live 1% book first (#61)");
    assert.ok(!/disabled:\s*true/.test(row), "GAME exits must stay open");
  });
});
