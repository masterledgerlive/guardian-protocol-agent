/**
 * Second injection — succession after a paid first inject + surplus.
 *
 * Operator brief: hit bottoms → inject → ride the wave → sell at peak
 * (never lose). Hitch Eureka rides buy and/or sell when leftover covers.
 * When that exit has paid the first inject portion (fees + hitch + piggy
 * skim math) AND surplus clears another primed READY seat's min entry
 * without depleting the cascade gas floor, fire a second injection in
 * the same succession — another avenue of revenue, same lose-zero rules.
 */

import {
  cascadeDeployEth,
  maxCascadeDeployWithoutDepletion,
} from "./cascade-rollover.js";

/** Max injects from one profitable exit (first + second). */
export const MAX_SUCCESSION_INJECTS = 2;

/** Default piggy/skim buffer fraction of first min-entry (covers 1% skim × overhead). */
export const PIGGY_MATH_BUFFER_PCT = 0.04;

/**
 * Has the first inject portion been paid with room for piggy math?
 * proceeds ≥ firstMinEntry × (1 + piggyBuffer) means cost recovered + skim runway.
 */
export function firstInjectPaid({
  proceedsEth = 0,
  firstMinEntryEth = 0,
  piggyBufferPct = PIGGY_MATH_BUFFER_PCT,
  netProfitEth = null,
} = {}) {
  const proceeds = Math.max(0, Number(proceedsEth) || 0);
  const first = Math.max(0, Number(firstMinEntryEth) || 0);
  const buf = Math.max(0, Number(piggyBufferPct) || 0);
  if (!(proceeds > 0)) {
    return { paid: false, needEth: first * (1 + buf), surplusEth: 0 };
  }
  const need = first > 0 ? first * (1 + buf) : 0;
  const paidBySize = proceeds + 1e-12 >= need;
  const profit = netProfitEth == null ? null : Number(netProfitEth);
  const paidByProfit = profit == null ? true : Number.isFinite(profit) && profit > 0;
  const surplusEth = Math.max(0, proceeds - need);
  return {
    paid: paidBySize && paidByProfit,
    needEth: need,
    surplusEth,
  };
}

/**
 * Second inject allowed only when first is paid, surplus clears next min entry,
 * gas floor survives both deploys, and the next seat is READY (requirements).
 */
export function canSecondInject({
  proceedsEth = 0,
  firstMinEntryEth = 0,
  secondMinEntryEth = 0,
  liquidEth = 0,
  gasFloorEth = 0,
  firstDeployEth = 0,
  nextReady = false,
  nextAllow = false,
  netProfitEth = null,
  piggyBufferPct = PIGGY_MATH_BUFFER_PCT,
} = {}) {
  const paid = firstInjectPaid({
    proceedsEth,
    firstMinEntryEth,
    piggyBufferPct,
    netProfitEth,
  });
  if (!paid.paid) {
    return { allow: false, reason: "first inject not paid / no piggy runway", paid, deployEth: 0 };
  }
  if (!nextAllow) {
    return { allow: false, reason: "next avenue refused (would lose)", paid, deployEth: 0 };
  }
  if (!nextReady) {
    return { allow: false, reason: "next avenue not READY (requirements)", paid, deployEth: 0 };
  }
  const secondMin = Math.max(0, Number(secondMinEntryEth) || 0);
  if (!(secondMin > 0)) {
    return { allow: false, reason: "no second min entry", paid, deployEth: 0 };
  }
  const firstDeploy = Math.max(0, Number(firstDeployEth) || 0);
  const remainingProceeds = Math.max(0, Number(proceedsEth) || 0) - firstDeploy;
  const liquid = Math.max(0, Number(liquidEth) || 0);
  // After first deploy leaves the book, liquid headroom shrinks by firstDeploy
  const liquidAfter = Math.max(0, liquid - firstDeploy);
  const floor = Math.max(0, Number(gasFloorEth) || 0);
  const maxSafe = maxCascadeDeployWithoutDepletion({
    proceedsEth: remainingProceeds,
    liquidEth: liquidAfter,
    gasFloorEth: floor,
    nextMinEntryEth: secondMin,
  });
  if (!(maxSafe > 0) || maxSafe + 1e-12 < secondMin) {
    return {
      allow: false,
      reason: "surplus cannot clear second min entry without gas depletion",
      paid,
      deployEth: 0,
      remainingProceeds,
      maxSafe,
    };
  }
  const deploy = cascadeDeployEth({
    proceedsEth: remainingProceeds,
    targetMinEntryEth: secondMin,
    netMargin: 0.04,
    gasFloorEth: floor,
    liquidEth: liquidAfter,
  });
  if (!(deploy > 0)) {
    return { allow: false, reason: "cascade deploy refused second seat", paid, deployEth: 0 };
  }
  return {
    allow: true,
    reason: "first paid + surplus meets READY second inject",
    paid,
    deployEth: deploy,
    remainingProceeds,
    maxSafe,
  };
}

/**
 * Plan up to 2 succession injects from one profitable exit.
 * Candidates: primed avenues with { symbol, minEntryEth, readyNow, allow, outcomeScore, netMargin }.
 * Never invents a seat that would lose; never crosses gas floor.
 *
 * @returns {{ injections: Array<{symbol, deployEth, seat}>, secondFired: boolean, reason: string }}
 */
export function planSuccessionInjections({
  proceedsEth = 0,
  liquidEth = 0,
  gasFloorEth = 0,
  candidates = [],
  excludeSymbol = null,
  maxInjections = MAX_SUCCESSION_INJECTS,
  netProfitEth = null,
  piggyBufferPct = PIGGY_MATH_BUFFER_PCT,
} = {}) {
  const exclude = excludeSymbol ? String(excludeSymbol).toUpperCase() : null;
  const maxN = Math.max(1, Math.min(MAX_SUCCESSION_INJECTS, Math.floor(Number(maxInjections) || MAX_SUCCESSION_INJECTS)));
  const pool = (Array.isArray(candidates) ? candidates : [])
    .filter((c) => c && c.allow !== false && c.symbol && String(c.symbol).toUpperCase() !== exclude)
    .slice()
    .sort((a, b) => {
      const rA = a.readyNow ? 1 : 0;
      const rB = b.readyNow ? 1 : 0;
      if (rB !== rA) return rB - rA;
      return (Number(b.outcomeScore) || 0) - (Number(a.outcomeScore) || 0);
    });

  const injections = [];
  let remainingProceeds = Math.max(0, Number(proceedsEth) || 0);
  let remainingLiquid = Math.max(0, Number(liquidEth) || 0);
  const floor = Math.max(0, Number(gasFloorEth) || 0);
  let reason = "no candidates";

  for (let i = 0; i < maxN && pool.length; i++) {
    const seat = pool.shift();
    const minE = Math.max(0, Number(seat.minEntryEth) || 0);
    if (i === 0) {
      // Look-ahead: if a READY second seat can be funded after first is paid,
      // reserve its min entry so the first hop does not eat the whole book.
      let secondReserve = 0;
      if (maxN >= 2) {
        const peek = pool.find((c) => c && c.readyNow && c.allow !== false);
        if (peek) {
          const paidCheck = firstInjectPaid({
            proceedsEth: remainingProceeds,
            firstMinEntryEth: minE,
            piggyBufferPct,
            netProfitEth,
          });
          const sMin = Math.max(0, Number(peek.minEntryEth) || 0);
          const headroom = Math.max(0, remainingLiquid - floor);
          if (
            paidCheck.paid &&
            sMin > 0 &&
            remainingProceeds + 1e-12 >= paidCheck.needEth + sMin &&
            headroom + 1e-12 >= minE + sMin
          ) {
            secondReserve = sMin;
          }
        }
      }
      const deploy = cascadeDeployEth({
        proceedsEth: Math.max(0, remainingProceeds - secondReserve),
        targetMinEntryEth: minE,
        netMargin: Number(seat.netMargin) || 0.03,
        gasFloorEth: floor,
        liquidEth: Math.max(0, remainingLiquid - secondReserve),
      });
      if (!(deploy > 0)) {
        reason = `first seat ${seat.symbol} below min / gas floor`;
        break;
      }
      injections.push({
        symbol: String(seat.symbol).toUpperCase(),
        deployEth: deploy,
        minEntryEth: minE,
        seat: 1,
        readyNow: !!seat.readyNow,
        hitchPreferred: true,
      });
      remainingProceeds = Math.max(0, remainingProceeds - deploy);
      remainingLiquid = Math.max(0, remainingLiquid - deploy);
      reason = "first inject planned";
      continue;
    }

    // Second inject — only if first paid + READY requirements
    const firstMin = Math.max(
      0,
      Number(injections[0]?.minEntryEth) || Number(injections[0]?.deployEth) || 0,
    );
    const gate = canSecondInject({
      proceedsEth: Number(proceedsEth) || 0,
      firstMinEntryEth: firstMin,
      secondMinEntryEth: minE,
      liquidEth: Number(liquidEth) || 0,
      gasFloorEth: floor,
      firstDeployEth: injections[0].deployEth,
      nextReady: !!seat.readyNow,
      nextAllow: seat.allow !== false,
      netProfitEth,
      piggyBufferPct,
    });
    if (!gate.allow) {
      reason = gate.reason;
      break;
    }
    injections.push({
      symbol: String(seat.symbol).toUpperCase(),
      deployEth: gate.deployEth,
      seat: 2,
      readyNow: true,
      hitchPreferred: true,
      secondInject: true,
    });
    reason = gate.reason;
    break;
  }

  return {
    injections,
    secondFired: injections.some((x) => x.seat === 2),
    reason,
    kind: "succession_inject",
  };
}

/**
 * Instant peak exit — delegated to peak-ride.js.
 * Touching hist max alone no longer sells (breakouts must ride); tick-down
 * near the ride/hist high confirms the turn with piggy-aligned profit.
 */
export { isInstantPeakSell } from "./peak-ride.js";

/**
 * Bottom inject for any primed / armed seat (not only catalog inject-mains).
 * Wider than inject-main pullback only when the avenue is already cost-primed.
 */
export function isPrimedBottomEntry({
  primedReady = false,
  primedAllow = false,
  price = 0,
  recentLow = 0,
  recentReadings = 0,
  priceFallingFast = false,
  band = 0.02,
} = {}) {
  if (!primedAllow || priceFallingFast) return false;
  if (Number(recentReadings) < 6) return false;
  const px = Number(price);
  const low = Number(recentLow);
  if (!(px > 0) || !(low > 0)) return false;
  const near = px <= low * (1 + Math.max(0, Number(band) || 0));
  // READY seats get the bottom; armed-but-not-ready still need a tight print
  if (primedReady) return near;
  return near && px <= low * 1.01;
}

/** Compact log / Telegram line for succession plan. */
export function formatSuccessionPlan(plan) {
  const list = plan?.injections || [];
  if (!list.length) return `🔁 SUCCESSION: none (${plan?.reason || "no plan"})`;
  return (
    "🔁 SUCCESSION: " +
    list
      .map(
        (x) =>
          `${x.seat}.${x.symbol}` +
          `@${Number(x.deployEth).toFixed(6)}ETH` +
          `${x.secondInject ? " 2ND" : ""}` +
          `${x.readyNow ? " READY" : ""}`
      )
      .join(" › ")
  );
}
