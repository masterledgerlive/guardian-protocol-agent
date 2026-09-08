/**
 * Revenue / lose-zero research simulator.
 *
 * Does not invent live P&L. Uses the same gates as production
 * (COST_EDGE, avenue-prime, cascade min-entry, inject-all, hitch math)
 * to stress theories under labeled assumptions.
 *
 * Theories:
 *   T1 Hitch-amortized seat sizing + COST_EDGE threshold sweeps
 *   T2 Single-path inject-all vs multi-seat fragmentation
 *   T3 Unknown-cost bag recycle vs hold (capital velocity)
 *   T4 Hitch-fee budget / code bytes per $ gas
 *   T5 Capital ladder $5 → $15 → $40 → $100 (majors unlock)
 *
 * Run: node revenue-sim.js
 *      node --test revenue-sim.test.js
 */

import {
  evaluateCostEdgeGate,
  costFractions,
  requiredMovePctForCosts,
  adaptiveNearTermEdgeMult,
  MAX_HITCH_COST_PCT,
  MAX_ROUND_TRIP_COST_PCT,
  MIN_NEAR_TERM_EDGE_MULT,
  THIN_BOOK_NEAR_TERM_MULT,
  HIGH_UNIT_MIN_BUY_USD,
  isHighUnitPriceSymbol,
} from "./cost-edge-gate.js";
import {
  projectAvenue,
  primedSeatCount,
  projectRoundTripCostEth,
  hitchBytesAffordable,
} from "./avenue-prime.js";
import {
  effectiveMinEntryEth,
  injectAllBookParams,
  cascadeGasFloorEth,
  maxCascadeDeployWithoutDepletion,
  INJECT_ALL_USD,
  CASCADE_SEED_USD,
} from "./cascade-rollover.js";
import {
  tierBookParams,
  SMALL_BOOK_USD,
  shouldRecycleUnknownDust,
} from "./inject-revenue.js";
import {
  estimateInjectCostEth,
  STORE_HITCH_BYTES,
  DEFAULT_HITCH_COST_MULT,
} from "./lose-zero-gate.js";

/** Live Railway snapshot assumptions (2026-09-08) — labeled, not claimed forever. */
export const LIVE_ASSUMPTIONS = Object.freeze({
  ethUsd: 2481,
  gwei: 0.05,
  l1FeeEth: 0,
  gasCostEth: 0.00001, // ~$0.025/leg Base — matches live ~2% RT on $2–5 seats
  feePct: 0.006,
  impactPct: 0.003,
  tradeableUsd: 2.24,
  bagsUsd: 5.0, // UNI ~$4.7 + dust
  uniUnderwaterPct: -0.033,
  label: "simulated|estimated from Railway 2026-09-08",
});

/** COST_EDGE wrapper — production gate already adapts; exposes adaptive mult. */
export function evaluateCostEdgeGateAdaptive(args = {}) {
  const d = evaluateCostEdgeGate({ ...args, adaptiveNearTerm: true });
  return { ...d, adaptiveNearTermEdgeMult: d.nearTermEdgeMult };
}

/** Force baseline 1.35× (no thin-book relief) for A/B sims. */
export function evaluateCostEdgeGateBaseline(args = {}) {
  const d = evaluateCostEdgeGate({
    ...args,
    nearTermEdgeMult: args.nearTermEdgeMult ?? MIN_NEAR_TERM_EDGE_MULT,
    adaptiveNearTerm: false,
  });
  return { ...d, adaptiveNearTermEdgeMult: d.nearTermEdgeMult };
}

export { adaptiveNearTermEdgeMult, THIN_BOOK_NEAR_TERM_MULT };

/**
 * T1 — Sweep hitch/RT/near-term thresholds across book sizes.
 * Returns allow-rate and expected net when gates pass (lose-zero preserved).
 */
export function simulateCostEdgeSweep({
  bookSizesUsd = [2.24, 5, 7.5, 12, 15, 25, 40, 100],
  gasCostEth = LIVE_ASSUMPTIONS.gasCostEth,
  hitchCostEth = null,
  ethUsd = LIVE_ASSUMPTIONS.ethUsd,
  feePct = LIVE_ASSUMPTIONS.feePct,
  impactPct = LIVE_ASSUMPTIONS.impactPct,
  nearTermUpsides = [0.03, 0.05, 0.08, 0.12],
  edgeMults = [1.0, 1.15, 1.35],
  symbol = "LINK",
  price = 14,
  netMargin = 0.04,
  useAdaptive = true,
} = {}) {
  const hitch =
    hitchCostEth != null
      ? Number(hitchCostEth)
      : estimateInjectCostEth(LIVE_ASSUMPTIONS.gwei, LIVE_ASSUMPTIONS.l1FeeEth);
  const rows = [];
  for (const usd of bookSizesUsd) {
    const tradeEth = usd / ethUsd;
    for (const up of nearTermUpsides) {
      for (const mult of edgeMults) {
        const recentHigh = price * (1 + up);
        const args = {
          symbol,
          tradeEth,
          hitchCostEth: hitch,
          gasCostEth,
          feePct,
          impactPct,
          price,
          recentHigh,
          ethUsd,
          tradeableUsd: usd,
          nearTermEdgeMult: mult,
        };
        const edge = useAdaptive
          ? evaluateCostEdgeGateAdaptive(args)
          : evaluateCostEdgeGateBaseline(args);
        const fr = costFractions({
          tradeEth,
          hitchCostEth: hitch,
          gasCostEth,
          feePct,
          impactPct,
        });
        const need = requiredMovePctForCosts({
          tradeEth: fr.tradeEth,
          roundTripEth: fr.roundTripEth,
        });
        const ave = projectAvenue({
          symbol,
          tradeEth,
          gasCostEth,
          hitchCostEth: hitch,
          feePct,
          impactPct,
          netMargin,
          armed: true,
          nearEntry: true,
          injectMain: true,
          ethUsd,
          tradeableUsd: usd,
          price,
          recentHigh,
        });
        // Override avenue allow with this edge mult result for fair compare
        const allow = edge.allow && ave.allow !== false
          ? edge.allow
          : edge.allow && !(ave.refuseReason && /min entry|projected costs wipe/i.test(ave.refuseReason));
        const minE = effectiveMinEntryEth({
          gasCostEth,
          hitchCostEth: hitch,
          feePct,
          impactPct,
          ethUsd,
        });
        const belowMin = tradeEth + 1e-12 < minE;
        const pass = edge.allow && !belowMin;
        rows.push({
          bookUsd: usd,
          upsidePct: up,
          edgeMult: useAdaptive ? edge.adaptiveNearTermEdgeMult ?? mult : mult,
          requestedMult: mult,
          hitchPct: fr.hitchPct,
          roundTripPct: fr.roundTripPct,
          requiredMovePct: need,
          allow: pass,
          code: belowMin ? "below_min_entry" : edge.code,
          expectedNetUsd: pass ? tradeEth * netMargin * ethUsd - hitch * ethUsd : 0,
          hitchBytesFit: pass
            ? hitchBytesAffordable({
                leftoverEth: Math.max(0, tradeEth * netMargin - hitch),
                gwei: LIVE_ASSUMPTIONS.gwei,
                hitchCostMult: 1,
              })
            : 0,
        });
      }
    }
  }
  return {
    theory: "T1_cost_edge_sweep",
    hitchCostEth: hitch,
    gasCostEth,
    ethUsd,
    useAdaptive,
    rows,
    summary: summarizeAllowRates(rows),
  };
}

function summarizeAllowRates(rows) {
  const byBook = {};
  for (const r of rows) {
    const k = String(r.bookUsd);
    if (!byBook[k]) byBook[k] = { n: 0, allow: 0, netUsd: 0, codeBytes: 0 };
    byBook[k].n += 1;
    if (r.allow) {
      byBook[k].allow += 1;
      byBook[k].netUsd += r.expectedNetUsd;
      byBook[k].codeBytes += r.hitchBytesFit;
    }
  }
  const out = {};
  for (const [k, v] of Object.entries(byBook)) {
    out[k] = {
      allowRate: v.n ? v.allow / v.n : 0,
      avgNetUsdWhenAllowed: v.allow ? v.netUsd / v.allow : 0,
      totalCodeBytes: v.codeBytes,
    };
  }
  return out;
}

/**
 * T2 — Inject-all (1 seat) vs classic small-book (2) vs rich (3).
 * Fragmentation tax: each extra seat pays another round of gas+hitch.
 */
export function simulateSeatFragmentation({
  bookUsd = 6,
  ethUsd = LIVE_ASSUMPTIONS.ethUsd,
  gasCostEth = LIVE_ASSUMPTIONS.gasCostEth,
  hitchCostEth = null,
  feePct = LIVE_ASSUMPTIONS.feePct,
  impactPct = LIVE_ASSUMPTIONS.impactPct,
  netMargin = 0.04,
  winRate = 0.7,
  cycles = 20,
} = {}) {
  const hitch =
    hitchCostEth != null
      ? Number(hitchCostEth)
      : estimateInjectCostEth(LIVE_ASSUMPTIONS.gwei, LIVE_ASSUMPTIONS.l1FeeEth);
  const modes = [
    { name: "inject_all_1", seats: 1, forceInjectAll: true },
    { name: "small_book_2", seats: 2, forceInjectAll: false },
    { name: "classic_3", seats: 3, forceInjectAll: false },
  ];
  const results = modes.map((m) => {
    const seatUsd = bookUsd / m.seats;
    const tradeEth = seatUsd / ethUsd;
    const costs = projectRoundTripCostEth({
      tradeEth,
      gasCostEth,
      hitchCostEth: hitch,
      feePct,
      impactPct,
    });
    const minE = effectiveMinEntryEth({
      gasCostEth,
      hitchCostEth: hitch,
      feePct,
      impactPct,
      ethUsd,
    });
    const edge = evaluateCostEdgeGateAdaptive({
      symbol: "UNI",
      tradeEth,
      hitchCostEth: hitch,
      gasCostEth,
      feePct,
      impactPct,
      price: 7,
      recentHigh: 7.4,
      ethUsd,
      tradeableUsd: bookUsd,
    });
    const viable = tradeEth + 1e-12 >= minE && edge.allow && costs.costPct <= MAX_ROUND_TRIP_COST_PCT;
    let equity = bookUsd;
    let fills = 0;
    let hitchBytes = 0;
    let losses = 0;
    for (let i = 0; i < cycles; i++) {
      if (!viable) break;
      // Each cycle: attempt `seats` parallel entries (or 1 for inject-all)
      for (let s = 0; s < m.seats; s++) {
        const stake = equity / m.seats;
        if (stake < seatUsd * 0.5) continue;
        const win = Math.random() < winRate;
        const rtUsd = costs.costEth * ethUsd;
        if (win) {
          const gross = stake * netMargin;
          const net = gross - rtUsd; // gas+hitch already in rt; fees in netMargin approx
          // Conservative: subtract hitch once more only if not in rt — already in rt
          equity += Math.max(0, net);
          fills += 1;
          hitchBytes += STORE_HITCH_BYTES;
        } else {
          // Lose-zero hold: no forced loss sell — capital idle, pay nothing
          // Opportunity cost only (equity unchanged). Count as skip.
          losses += 0;
        }
      }
    }
    const book = injectAllBookParams(bookUsd, tierBookParams(bookUsd));
    return {
      mode: m.name,
      seats: m.seats,
      seatUsd,
      costPct: costs.costPct,
      viable,
      edgeCode: edge.code,
      adaptiveMult: edge.adaptiveNearTermEdgeMult,
      naturalSeats: primedSeatCount(bookUsd, book),
      naturalInjectAll: !!book.injectAll,
      endEquityUsd: equity,
      pnlUsd: equity - bookUsd,
      fills,
      hitchBytesIngested: hitchBytes,
      loseZeroViolations: losses,
    };
  });
  results.sort((a, b) => b.pnlUsd - a.pnlUsd);
  return {
    theory: "T2_seat_fragmentation",
    bookUsd,
    cycles,
    winRate,
    ranking: results,
    winner: results[0]?.mode || null,
  };
}

/**
 * T3 — Unknown-cost dust recycle velocity.
 * Holding bags that could cover fees blocks inject seats.
 */
export function simulateUnknownCostRecycle({
  liquidUsd = 2.24,
  bags = [
    { symbol: "MORPHO", usd: 0.5, unknown: true, leftoverAfterFeesUsd: -0.02 },
    { symbol: "BRETT", usd: 0.07, unknown: true, leftoverAfterFeesUsd: -0.01 },
    { symbol: "VIRTUAL", usd: 0.02, unknown: true, leftoverAfterFeesUsd: -0.01 },
    { symbol: "UNI", usd: 4.69, unknown: false, leftoverAfterFeesUsd: -0.16 },
  ],
  ethUsd = LIVE_ASSUMPTIONS.ethUsd,
  gasCostEth = LIVE_ASSUMPTIONS.gasCostEth,
  hitchCostEth = null,
  cycles = 30,
  winRate = 0.7,
  netMargin = 0.04,
} = {}) {
  const hitch =
    hitchCostEth != null
      ? Number(hitchCostEth)
      : estimateInjectCostEth(LIVE_ASSUMPTIONS.gwei, LIVE_ASSUMPTIONS.l1FeeEth);

  function run(policy) {
    let liquid = liquidUsd;
    let locked = bags.map((b) => ({ ...b }));
    let fills = 0;
    let recycled = 0;
    let hitchBytes = 0;
    let forcedLossUsd = 0;
    for (let i = 0; i < cycles; i++) {
      for (const bag of locked) {
        if (!(bag.usd > 0)) continue;
        const canProfitExit = bag.leftoverAfterFeesUsd > 0;
        const recycleDust = shouldRecycleUnknownDust({
          unknownEntry: bag.unknown,
          posUsd: bag.usd,
          moonshotHoldUsd: 0.5,
          minUsd: 0.12,
        });
        if (policy === "hold_all") continue;
        if (policy === "lose_zero_only" && canProfitExit) {
          liquid += bag.usd + bag.leftoverAfterFeesUsd;
          recycled += bag.usd;
          bag.usd = 0;
          continue;
        }
        if (policy === "aggressive_unknown" && bag.unknown && recycleDust && bag.usd >= 0.12) {
          // Sell unknown at market — leftover may be ~0 after fees; never invent profit.
          // If leftover after fees ≤ 0, lose-zero forbids (count skip).
          if (bag.leftoverAfterFeesUsd > 0) {
            liquid += bag.usd + bag.leftoverAfterFeesUsd;
            recycled += bag.usd;
            bag.usd = 0;
          }
        }
        if (policy === "force_underwater" && bag.leftoverAfterFeesUsd < 0 && bag.usd > 1) {
          // Forbidden under lose-zero — track as violation scenario only
          forcedLossUsd += Math.abs(bag.leftoverAfterFeesUsd);
          liquid += bag.usd + bag.leftoverAfterFeesUsd;
          bag.usd = 0;
        }
      }
      // Deploy liquid into one inject-all seat when viable
      const book = injectAllBookParams(liquid, tierBookParams(liquid));
      const tradeEth = liquid / ethUsd;
      const minE = effectiveMinEntryEth({
        gasCostEth,
        hitchCostEth: hitch,
        ethUsd,
      });
      const edge = evaluateCostEdgeGateAdaptive({
        symbol: "LINK",
        tradeEth,
        hitchCostEth: hitch,
        gasCostEth,
        price: 14,
        recentHigh: 14 * 1.08,
        ethUsd,
        tradeableUsd: liquid,
      });
      if (book.injectAll && tradeEth >= minE && edge.allow && Math.random() < winRate) {
        const net = liquid * netMargin - hitch * ethUsd;
        if (net > 0) {
          liquid += net;
          fills += 1;
          hitchBytes += STORE_HITCH_BYTES;
        }
      }
    }
    return {
      policy,
      endLiquidUsd: liquid,
      endBagsUsd: locked.reduce((s, b) => s + b.usd, 0),
      recycledUsd: recycled,
      fills,
      hitchBytesIngested: hitchBytes,
      forcedLossUsd,
      loseZeroOk: forcedLossUsd === 0,
    };
  }

  const policies = ["hold_all", "lose_zero_only", "aggressive_unknown", "force_underwater"].map(run);
  const safe = policies.filter((p) => p.loseZeroOk).sort((a, b) => b.endLiquidUsd - a.endLiquidUsd);
  return {
    theory: "T3_unknown_cost_recycle",
    policies,
    bestSafePolicy: safe[0]?.policy || null,
    lesson:
      "Never force underwater exits. Recycle only when leftover after fees > 0. Underwater UNI must wait or operator ALLOW_LOSSY.",
  };
}

/**
 * T4 — Hitch fee budget: maximize code bytes ingested per $ of gas+L1.
 */
export function simulateHitchBudget({
  dailyGasBudgetUsd = 0.5,
  ethUsd = LIVE_ASSUMPTIONS.ethUsd,
  gwei = LIVE_ASSUMPTIONS.gwei,
  l1FeeEth = LIVE_ASSUMPTIONS.l1FeeEth,
  hitchOnlyWhenTiered = true,
  dragnetOutRate = 0.6, // fraction of LOSE_ZERO passes that are OUT (historical)
  attemptsPerDay = 200,
} = {}) {
  const hitchEth = estimateInjectCostEth(gwei, l1FeeEth);
  const hitchUsd = hitchEth * ethUsd;
  const swapGasUsd = LIVE_ASSUMPTIONS.gasCostEth * ethUsd;
  let spent = 0;
  let bytes = 0;
  let wastedOutFees = 0;
  let successfulHitch = 0;
  for (let i = 0; i < attemptsPerDay; i++) {
    const isOut = Math.random() < dragnetOutRate;
    if (hitchOnlyWhenTiered && isOut) {
      // Fixed path: skip hitch L1 entirely for OUT — spend 0
      continue;
    }
    if (!hitchOnlyWhenTiered && isOut) {
      // Legacy bug: pay hitch fee then discover OUT
      if (spent + hitchUsd > dailyGasBudgetUsd) break;
      spent += hitchUsd;
      wastedOutFees += hitchUsd;
      continue;
    }
    // Tiered + armed: full swap + hitch
    const cost = swapGasUsd + hitchUsd;
    if (spent + cost > dailyGasBudgetUsd) break;
    spent += cost;
    bytes += STORE_HITCH_BYTES;
    successfulHitch += 1;
  }
  return {
    theory: "T4_hitch_budget",
    hitchOnlyWhenTiered,
    hitchUsdPerInsert: hitchUsd,
    spentUsd: spent,
    codeBytesIngested: bytes,
    successfulHitch,
    wastedOutFeesUsd: wastedOutFees,
    bytesPerDollar: spent > 0 ? bytes / spent : 0,
  };
}

/**
 * T5 — Capital ladder: when majors unlock and revenue compounds.
 */
export function simulateCapitalLadder({
  startUsd = 5,
  steps = [5, 7.5, 12, 15, 25, 40, 100],
  ethUsd = LIVE_ASSUMPTIONS.ethUsd,
  gasCostEth = LIVE_ASSUMPTIONS.gasCostEth,
  hitchCostEth = null,
  nearUpside = 0.08,
  netMargin = 0.04,
  winRate = 0.7,
  cyclesPerStep = 15,
} = {}) {
  const hitch =
    hitchCostEth != null
      ? Number(hitchCostEth)
      : estimateInjectCostEth(LIVE_ASSUMPTIONS.gwei, LIVE_ASSUMPTIONS.l1FeeEth);
  let equity = startUsd;
  const trail = [];
  for (const target of steps) {
    // Grow toward step via inject-all when under INJECT_ALL_USD
    for (let i = 0; i < cyclesPerStep; i++) {
      const book = injectAllBookParams(equity, tierBookParams(equity));
      const seats = primedSeatCount(equity, book);
      const tradeEth = equity / seats / ethUsd;
      const edge = evaluateCostEdgeGateAdaptive({
        symbol: equity >= HIGH_UNIT_MIN_BUY_USD * 2 ? "CBBTC" : "LINK",
        tradeEth,
        hitchCostEth: hitch,
        gasCostEth,
        price: 14,
        recentHigh: 14 * (1 + nearUpside),
        ethUsd,
        tradeableUsd: equity,
      });
      const minE = effectiveMinEntryEth({ gasCostEth, hitchCostEth: hitch, ethUsd });
      const majorsUnlocked =
        equity >= HIGH_UNIT_MIN_BUY_USD * 2 && !isHighUnitPriceSymbol("LINK");
      if (tradeEth >= minE && edge.allow && Math.random() < winRate) {
        const net = (equity / seats) * netMargin - hitch * ethUsd;
        if (net > 0) equity += net;
      }
      if (equity >= target) break;
    }
    const book = injectAllBookParams(equity, tierBookParams(equity));
    trail.push({
      stepTargetUsd: target,
      equityUsd: equity,
      injectAll: !!book.injectAll,
      smallBook: !!tierBookParams(equity).smallBook,
      seats: primedSeatCount(equity, book),
      cbbtcUnlock: equity >= HIGH_UNIT_MIN_BUY_USD * 2,
      hitchProveReady: false, // live gate: 20 profitable injects — tracked separately
    });
  }
  return {
    theory: "T5_capital_ladder",
    startUsd,
    endUsd: equity,
    growthMultiple: startUsd > 0 ? equity / startUsd : 0,
    trail,
    milestones: {
      leaveInjectAll: trail.find((t) => !t.injectAll)?.equityUsd ?? null,
      leaveSmallBook: trail.find((t) => !t.smallBook)?.equityUsd ?? null,
      unlockMajorsUsd: HIGH_UNIT_MIN_BUY_USD * 2,
    },
  };
}

/** Monte Carlo: compare baseline 1.35× vs adaptive thin-book mult. */
export function simulateAdaptiveVsBaseline({
  trials = 200,
  bookUsd = 2.24,
  ethUsd = LIVE_ASSUMPTIONS.ethUsd,
  gasCostEth = LIVE_ASSUMPTIONS.gasCostEth,
  upsideDist = [0.03, 0.05, 0.05, 0.08, 0.08, 0.12],
  netMargin = 0.04,
  winRate = 0.65,
} = {}) {
  const hitch = estimateInjectCostEth(LIVE_ASSUMPTIONS.gwei, LIVE_ASSUMPTIONS.l1FeeEth);
  const tradeEth = bookUsd / ethUsd;

  function run(useAdaptive) {
    let fills = 0;
    let refusals = 0;
    let pnl = 0;
    let bytes = 0;
    for (let t = 0; t < trials; t++) {
      const up = upsideDist[t % upsideDist.length];
      const args = {
        symbol: "LINK",
        tradeEth,
        hitchCostEth: hitch,
        gasCostEth,
        price: 14,
        recentHigh: 14 * (1 + up),
        ethUsd,
        tradeableUsd: bookUsd,
        nearTermEdgeMult: MIN_NEAR_TERM_EDGE_MULT,
      };
      const edge = useAdaptive
        ? evaluateCostEdgeGateAdaptive(args)
        : evaluateCostEdgeGateBaseline(args);
      if (!edge.allow) {
        refusals += 1;
        continue;
      }
      if (Math.random() < winRate) {
        const net = bookUsd * netMargin - hitch * ethUsd;
        if (net > 0) {
          pnl += net;
          fills += 1;
          bytes += STORE_HITCH_BYTES;
        }
      }
      // Loss path: hold (lose-zero) — pnl unchanged
    }
    return { fills, refusals, pnlUsd: pnl, hitchBytes: bytes, allowRate: fills / Math.max(1, fills + refusals) };
  }

  const baseline = run(false);
  const adaptive = run(true);
  return {
    theory: "adaptive_vs_baseline",
    bookUsd,
    trials,
    baseline,
    adaptive,
    deltaFills: adaptive.fills - baseline.fills,
    deltaPnlUsd: adaptive.pnlUsd - baseline.pnlUsd,
    deltaBytes: adaptive.hitchBytes - baseline.hitchBytes,
    recommendation:
      adaptive.pnlUsd >= baseline.pnlUsd && adaptive.fills >= baseline.fills
        ? "ADOPT_ADAPTIVE_THIN_BOOK_MULT"
        : "KEEP_BASELINE_1_35",
  };
}

/** Full research pack — all theories + live snapshot. */
export function runRevenueResearch(opts = {}) {
  const live = { ...LIVE_ASSUMPTIONS, ...(opts.live || {}) };
  const hitch = estimateInjectCostEth(live.gwei, live.l1FeeEth);
  const t1 = simulateCostEdgeSweep({
    ethUsd: live.ethUsd,
    gasCostEth: live.gasCostEth,
    hitchCostEth: hitch,
    useAdaptive: true,
  });
  const t1Base = simulateCostEdgeSweep({
    ethUsd: live.ethUsd,
    gasCostEth: live.gasCostEth,
    hitchCostEth: hitch,
    useAdaptive: false,
  });
  const t2 = simulateSeatFragmentation({
    bookUsd: Math.max(live.tradeableUsd, 5),
    ethUsd: live.ethUsd,
    gasCostEth: live.gasCostEth,
    hitchCostEth: hitch,
  });
  const t3 = simulateUnknownCostRecycle({
    liquidUsd: live.tradeableUsd,
    ethUsd: live.ethUsd,
    gasCostEth: live.gasCostEth,
    hitchCostEth: hitch,
  });
  const t4on = simulateHitchBudget({ hitchOnlyWhenTiered: true, ethUsd: live.ethUsd });
  const t4off = simulateHitchBudget({ hitchOnlyWhenTiered: false, ethUsd: live.ethUsd });
  const t5 = simulateCapitalLadder({
    startUsd: live.tradeableUsd,
    ethUsd: live.ethUsd,
    gasCostEth: live.gasCostEth,
    hitchCostEth: hitch,
  });
  const adaptive = simulateAdaptiveVsBaseline({
    bookUsd: live.tradeableUsd,
    ethUsd: live.ethUsd,
    gasCostEth: live.gasCostEth,
  });

  const gasFloor = cascadeGasFloorEth({});
  const maxDeploy = maxCascadeDeployWithoutDepletion({
    proceedsEth: live.tradeableUsd / live.ethUsd,
    liquidEth: live.tradeableUsd / live.ethUsd,
    gasFloorEth: gasFloor,
    nextMinEntryEth: 0,
  });

  return {
    generatedAt: new Date().toISOString(),
    assumptions: { ...live, hitchCostEth: hitch, hitchUsd: hitch * live.ethUsd },
    liveConstraints: {
      injectAllUsd: INJECT_ALL_USD,
      smallBookUsd: SMALL_BOOK_USD,
      cascadeSeedUsd: CASCADE_SEED_USD,
      maxHitchPct: MAX_HITCH_COST_PCT,
      maxRoundTripPct: MAX_ROUND_TRIP_COST_PCT,
      baselineNearTermMult: MIN_NEAR_TERM_EDGE_MULT,
      thinBookNearTermMult: THIN_BOOK_NEAR_TERM_MULT,
      gasFloorEth: gasFloor,
      maxDeployEthAtLive: maxDeploy,
      hitchBytes: STORE_HITCH_BYTES,
      hitchCostMultSell: DEFAULT_HITCH_COST_MULT,
    },
    theories: {
      T1_adaptive: t1,
      T1_baseline: t1Base,
      T2_seats: t2,
      T3_recycle: t3,
      T4_hitch_tiered: t4on,
      T4_hitch_legacy_out: t4off,
      T5_ladder: t5,
      adaptive_compare: adaptive,
    },
    verdicts: {
      primaryBlocker:
        "Thin-book near_term COST_EDGE (1.35×) + capital locked in underwater/unknown bags — not hitch cost (nearly free on Base today).",
      loseZeroInvariant:
        "Never sell/insert when leftover after fees ≤ 0. Hitch skipped before loss. Simulations that force underwater exits are labeled violations only.",
      adoptAdaptiveThinMult: adaptive.recommendation === "ADOPT_ADAPTIVE_THIN_BOOK_MULT",
      preferInjectAllUnder12: t2.winner === "inject_all_1" || live.tradeableUsd < INJECT_ALL_USD,
      hitchTierBeforeFee: t4on.bytesPerDollar >= t4off.bytesPerDollar,
      capitalPath: `Prove 20 profitable hitch fills, compound past $${INJECT_ALL_USD} → $${SMALL_BOOK_USD} → $${HIGH_UNIT_MIN_BUY_USD * 2} before CBBTC-class.`,
      nextCodeTune: [
        "DONE: adaptiveNearTermEdgeMult in cost-edge-gate (thin+cheap → 1.15×)",
        "Keep inject-all + avenue prime; do not re-split under $12",
        "Recycle unknown dust only when leftover after fees > 0",
        "Hold underwater UNI — lose-zero; wait for wave or operator",
        "Fix bot-state ledger 401 so cost basis returns (unlocks confident exits)",
        "Hit /injectprove 20 profitable hitch fills before sizing up",
      ],
    },
  };
}

/** CLI */
const isMain =
  process.argv[1] &&
  String(process.argv[1]).endsWith("revenue-sim.js");

if (isMain) {
  const report = runRevenueResearch();
  console.log(JSON.stringify(report, null, 2));
  const a = report.theories.adaptive_compare;
  console.error(
    `\nVERDICT: ${a.recommendation} · Δfills ${a.deltaFills} · Δpnl $${a.deltaPnlUsd.toFixed(3)} · Δbytes ${a.deltaBytes}`,
  );
  console.error(`T2 winner: ${report.theories.T2_seats.winner}`);
  console.error(`T3 best safe: ${report.theories.T3_recycle.bestSafePolicy}`);
  console.error(`T5 growth: ${report.theories.T5_ladder.growthMultiple.toFixed(2)}×`);
}
