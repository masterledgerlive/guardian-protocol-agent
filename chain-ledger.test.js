import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  escapeTelegramHtml,
  sanitizeTelegramHtml,
  splitTelegramHtmlChunks,
  decodeErc20Balance,
  resolveFailedBalanceRead,
  operatorBuySkipTelegram,
  operatorBuyQueuedTelegram,
  unknownCostBasisLine,
  UNKNOWN_COST_BASIS_LABEL,
} from "./chain-ledger.js";
import {
  hasUsableCostBasis,
  costBasisEth,
  shouldTrustSavedCostBasis,
  applyUnknownChainHolding,
} from "./price-oracle.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "agent.js"), "utf8");

describe("Telegram HTML must actually send", () => {
  it("escapes stray < so Telegram does not see an empty start tag", () => {
    assert.equal(escapeTelegramHtml("a < b > c"), "a &lt; b &gt; c");
    const cleaned = sanitizeTelegramHtml("P&L <unknown> and <b>TOSHI</b>");
    assert.match(cleaned, /<b>TOSHI<\/b>/);
    assert.match(cleaned, /&lt;unknown&gt;/);
    assert.equal(sanitizeTelegramHtml("<> boom"), "&lt;&gt; boom");
  });

  it("does not split HTML tags across Telegram chunks", () => {
    const msg = "a".repeat(3990) + "<b>HELLO</b>" + "z".repeat(20);
    const chunks = splitTelegramHtmlChunks(msg, 4000);
    assert.ok(chunks.length >= 2);
    assert.ok(!chunks[0].includes("<b>HEL"));
    assert.ok(chunks.some((c) => c.includes("<b>HELLO</b>")));
  });
});

describe("chain balance ping is not a silent 0", () => {
  it("decodes ERC-20 units with the token's real decimals (not 1e18)", () => {
    assert.equal(decodeErc20Balance(1000000n, 6), 1);
    assert.equal(decodeErc20Balance(10n ** 18n, 18), 1);
  });

  it("RPC fail keeps last ping and never returns 0 as truth", () => {
    const kept = resolveFailedBalanceRead({
      error: new Error("returned no data (\"0x\")"),
      lastKnown: 4514.63,
      label: "TOSHI",
    });
    assert.equal(kept.stale, true);
    assert.equal(kept.balance, 4514.63);
    assert.throws(
      () => resolveFailedBalanceRead({ error: new Error("0x"), lastKnown: undefined, label: "TOSHI" }),
      /0x/,
    );
  });

  it("agent getTokenBalance uses decode + resolveFailedBalanceRead (not catch return 0)", () => {
    const fn = src.indexOf("async function getTokenBalance");
    const end = src.indexOf("\nasync function getFullBalance", fn);
    const body = src.slice(fn, end);
    assert.ok(body.includes("decodeErc20Balance"));
    assert.ok(body.includes("resolveFailedBalanceRead"));
    assert.ok(!/catch\s*\{\s*return 0\s*\}/.test(body));
  });
});

describe("unknown cost basis is not invented invested", () => {
  it("applyUnknownChainHolding zeros invested and keeps unknownEntry", () => {
    const t = { symbol: "TOSHI", entryPrice: null, totalInvestedEth: 0 };
    applyUnknownChainHolding(t, { units: 4514.63, priceUsd: 0.000129 });
    assert.equal(t.unknownEntry, true);
    assert.equal(t.totalInvestedEth, 0);
    assert.equal(costBasisEth(t), 0);
    assert.equal(hasUsableCostBasis(t), false);
  });

  it("shouldTrustSavedCostBasis requires a fill receipt or ledger buy", () => {
    const token = { symbol: "KEYCAT", entryPrice: 0.000754, totalInvestedEth: 0.0004, unknownEntry: false };
    assert.equal(shouldTrustSavedCostBasis(token, {}), false);
    assert.equal(shouldTrustSavedCostBasis(token, { net: { lastBuyPrice: 0.0007 } }), true);
    assert.equal(shouldTrustSavedCostBasis(token, {
      tradeLog: [{ type: "BUY", symbol: "KEYCAT", tx: "0xabc" }],
    }), true);
    assert.equal(shouldTrustSavedCostBasis(token, {
      fifoLot: { ethIn: 0.0004, tokensIn: 500, fillCostEth: 0.0004 },
    }), true);
  });

  it("agent does not copy live market into totalInvestedEth for UNKNOWN ENTRY", () => {
    assert.ok(!src.includes("UNKNOWN ENTRY resolved from live market"));
    assert.ok(src.includes("applyUnknownChainHolding"));
    assert.ok(src.includes("costBasisEth(token)"));
    assert.ok(src.includes("fifoRemainingCostEth"));
    assert.ok(!src.includes("ethIn - ethOut"));
  });
});

describe("operator /buy always reports skip or receipt", () => {
  it("skip telegram names the reason and admits nothing was sent", () => {
    const msg = operatorBuySkipTelegram("TOSHI", "LOSE_ZERO: block buy TOSHI no clear edge");
    assert.match(msg, /TOSHI BUY SKIPPED/);
    assert.match(msg, /No Basescan receipt/);
    const queued = operatorBuyQueuedTelegram("TOSHI", 1);
    assert.match(queued, /BUY TOSHI queued/);
    assert.match(queued, /\$1/);
  });

  it("executeBuy telegrams operator skips via skipBuy", () => {
    const buyFn = src.indexOf("async function executeBuy(");
    const buyEnd = src.indexOf("\nasync function executeSell", buyFn);
    const body = src.slice(buyFn, buyEnd);
    assert.ok(src.includes("async function skipBuy"));
    assert.ok(body.includes("skipBuy(reason"));
    assert.ok(body.includes("buySkipHitch"));
    assert.ok(body.includes("isSuccessfulBuyFill"));
    assert.ok(body.includes("hitchTelegramFooter"));
  });

  it("unknown cost basis label is the ledger copy", () => {
    assert.match(unknownCostBasisLine("BRETT", 364.24, 1.98), /BRETT/);
    assert.match(unknownCostBasisLine("BRETT", 364.24, 1.98), new RegExp(UNKNOWN_COST_BASIS_LABEL));
  });
});
