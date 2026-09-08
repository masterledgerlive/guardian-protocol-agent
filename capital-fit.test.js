/**
 * capital-fit.js — wrapped majors vs fast RISK aisles.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isSlowMajor,
  slowMajorFitsBook,
  shouldRecycleSlowMajorForCascade,
  turnoverBias,
  refuseSlowMajorNewBuy,
  listTradeableWrappersAndMajors,
  formatWrapperAvenueGuide,
  SLOW_MAJOR_MIN_BOOK_USD,
} from "./capital-fit.js";
import { projectAvenue } from "./avenue-prime.js";

const root = dirname(fileURLToPath(import.meta.url));
const agentSrc = readFileSync(join(root, "agent.js"), "utf8");

describe("capital-fit: wrappers catalog", () => {
  it("lists CBBTC as active slow major; WBTC skipped", () => {
    const active = listTradeableWrappersAndMajors();
    assert.ok(active.some((a) => a.symbol === "CBBTC" && a.slowMajor));
    assert.ok(active.some((a) => a.symbol === "UNI" && !a.slowMajor));
    assert.equal(isSlowMajor("CBBTC"), true);
    assert.equal(isSlowMajor("UNI"), false);
    const guide = formatWrapperAvenueGuide();
    assert.match(guide.activeLine, /CBBTC/);
    assert.match(guide.skippedLine, /WBTC/);
  });
});

describe("capital-fit: thin CBBTC locks capital", () => {
  it("CBBTC does not fit a ~$10 RISK book", () => {
    assert.equal(slowMajorFitsBook("CBBTC", 10), false);
    assert.equal(slowMajorFitsBook("CBBTC", SLOW_MAJOR_MIN_BOOK_USD), true);
    const refuse = refuseSlowMajorNewBuy({ symbol: "CBBTC", tradeableUsd: 10 });
    assert.ok(refuse);
    assert.match(refuse, /UNI\/LINK\/AERO|fast/i);
  });

  it("recycles $4.78 CBBTC when faster primed path exists", () => {
    assert.equal(
      shouldRecycleSlowMajorForCascade({
        symbol: "CBBTC",
        posUsd: 4.78,
        tradeableUsd: 6,
        hasFasterPrimed: true,
      }),
      true
    );
    assert.equal(
      shouldRecycleSlowMajorForCascade({
        symbol: "CBBTC",
        posUsd: 4.78,
        tradeableUsd: 6,
        hasFasterPrimed: false,
      }),
      false
    );
    assert.equal(
      shouldRecycleSlowMajorForCascade({
        symbol: "UNI",
        posUsd: 4.78,
        tradeableUsd: 6,
        hasFasterPrimed: true,
      }),
      false
    );
  });

  it("turnover bias prefers UNI over CBBTC on thin books", () => {
    const uni = turnoverBias({ symbol: "UNI", tradeableUsd: 8, injectMain: true });
    const btc = turnoverBias({ symbol: "CBBTC", tradeableUsd: 8 });
    assert.ok(uni > btc);
  });

  it("avenue prime refuses CBBTC on thin RISK books and prefers UNI", () => {
    const base = {
      tradeEth: 0.003,
      gasCostEth: 0.00004,
      hitchCostEth: 0.00001,
      feePct: 0.003,
      netMargin: 0.05,
      armed: true,
      nearEntry: true,
      ethUsd: 2500,
      gwei: 0.05,
      minPosUsd: 0.5,
      tokenMinBuyUsd: 0,
      hitchBytesWanted: 40,
      tradeableUsd: 8,
    };
    const aUni = projectAvenue({ ...base, symbol: "UNI", injectMain: true, tokenScore: 80 });
    const aBtc = projectAvenue({ ...base, symbol: "CBBTC", injectMain: true, tokenScore: 80 });
    assert.equal(aUni.allow, true);
    assert.equal(aBtc.allow, false);
    assert.match(aBtc.refuseReason || "", /CBBTC|fast|UNI/i);
    assert.ok(aUni.outcomeScore > 0);
    assert.ok(turnoverBias({ symbol: "UNI", tradeableUsd: 8, injectMain: true }) >
      turnoverBias({ symbol: "CBBTC", tradeableUsd: 8, injectMain: true }));
  });
});

describe("capital-fit: wired into agent.js", () => {
  it("imports recycle + refuse slow-major new buys", () => {
    assert.ok(agentSrc.includes('from "./capital-fit.js"'));
    assert.ok(agentSrc.includes("shouldRecycleSlowMajorForCascade"));
    assert.ok(agentSrc.includes("refuseSlowMajorNewBuy"));
    assert.ok(agentSrc.includes("turnoverBias"));
  });
});
